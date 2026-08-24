import { Timestamp } from "firebase-admin/firestore";
import { sha256Hex } from "../deterministic.js";
import type { CanaryBotMessage } from "../meta-canary/contracts.js";

/**
 * Backend-only message bodies for the governed Lite canary inbox.
 *
 * These records are intentionally stored below the conversation document at:
 * `workspaces/{workspaceId}/conversations/{conversationId}/protectedMessageContents/{id}`.
 * They rely on Firebase/Google-managed encryption at rest. Browser access must
 * remain denied; a scoped callable may return only the projection produced by
 * `parseProtectedMessageContentForProjection`.
 */
export const LITE_PROTECTED_MESSAGE_CONTENTS_COLLECTION =
  "protectedMessageContents" as const;
export const LITE_PROTECTED_MESSAGE_RETENTION_ENV =
  "HEMAS_PROTECTED_MESSAGE_RETENTION_DAYS" as const;
export const LITE_PROTECTED_MESSAGE_DEFAULT_RETENTION_DAYS = 7;
export const LITE_PROTECTED_MESSAGE_MIN_RETENTION_DAYS = 1;
export const LITE_PROTECTED_MESSAGE_MAX_RETENTION_DAYS = 30;
export const LITE_PROTECTED_MESSAGE_MAX_TEXT_LENGTH = 4_096;
export const LITE_PROTECTED_MESSAGE_SCHEMA_VERSION = 1 as const;

const DAY_MS = 24 * 60 * 60 * 1_000;
const SAFE_SCOPE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SAFE_MESSAGE_ID = /^message_live_[0-9a-f]{16}$/;
const CONTENT_ID = /^pmc_(?:in|bot|agent)_[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export type ProtectedMessageDirection = "inbound" | "outbound";
export type ProtectedMessageSource =
  | "meta_inbound"
  | "menu_bot"
  | "governed_ai"
  | "auto_reply"
  | "agent_reply";
export type ProtectedMessageContentKind =
  | "text"
  | "selection"
  | "interactive_body"
  | "media_caption";
export type ProtectedMessageState = "reserved" | "materialized" | "not_sent";

export interface ExtractedProtectedMessageContent {
  readonly contentKind: ProtectedMessageContentKind;
  readonly text: string;
}

export interface ProtectedMessageContentDocument {
  readonly id: string;
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly messageId: string | null;
  readonly direction: ProtectedMessageDirection;
  readonly source: ProtectedMessageSource;
  readonly contentKind: ProtectedMessageContentKind;
  readonly text: string;
  readonly bodySha256: string;
  readonly bodyLength: number;
  readonly teamId: string;
  readonly locationId: string;
  readonly state: ProtectedMessageState;
  readonly containsMessageContent: true;
  readonly containsPlaintextSender: false;
  readonly liveCanary: true;
  readonly synthetic: true;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly expiresAtMs: number;
  readonly expireAt: Timestamp;
  readonly schemaVersion: typeof LITE_PROTECTED_MESSAGE_SCHEMA_VERSION;
}

export interface ProtectedMessageContentProjection {
  readonly id: string;
  readonly messageId: string;
  readonly direction: ProtectedMessageDirection;
  readonly source: ProtectedMessageSource;
  readonly contentKind: ProtectedMessageContentKind;
  readonly text: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? value as UnknownRecord
    : null;
}

function isSafeMs(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function assertSafeScopeId(label: string, value: string): void {
  if (!SAFE_SCOPE_ID.test(value)) {
    throw new TypeError(`${label} must be a safe non-empty identifier.`);
  }
}

function isSafeMessageId(value: unknown): value is string {
  return typeof value === "string" && SAFE_MESSAGE_ID.test(value);
}

function assertDeterministicSourceValue(label: string, value: string): void {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 512 ||
    value.trim() !== value ||
    /[\u0000-\u001F\u007F]/.test(value)
  ) {
    throw new TypeError(`${label} must be a bounded, non-empty source identifier.`);
  }
}

/** Invalid or excessive values fail back to the conservative seven-day default. */
export function parseProtectedMessageRetentionDays(raw: unknown): number {
  if (typeof raw === "number") {
    return Number.isSafeInteger(raw) &&
        raw >= LITE_PROTECTED_MESSAGE_MIN_RETENTION_DAYS &&
        raw <= LITE_PROTECTED_MESSAGE_MAX_RETENTION_DAYS
      ? raw
      : LITE_PROTECTED_MESSAGE_DEFAULT_RETENTION_DAYS;
  }
  if (typeof raw !== "string" || !/^(?:[1-9]|[12]\d|30)$/.test(raw)) {
    return LITE_PROTECTED_MESSAGE_DEFAULT_RETENTION_DAYS;
  }
  return Number(raw);
}

/**
 * Preserve human-entered whitespace while removing unsafe controls, repairing
 * lone UTF-16 surrogates, and enforcing the Firestore/callable display bound.
 */
export function normalizeProtectedMessageText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD")
    .normalize("NFC")
    .trim();
  if (!text) return null;
  if (text.length > LITE_PROTECTED_MESSAGE_MAX_TEXT_LENGTH) {
    text = text.slice(0, LITE_PROTECTED_MESSAGE_MAX_TEXT_LENGTH);
    if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  }
  return text || null;
}

/** Extract the actual text retained from a verified inbound bot candidate. */
export function extractProtectedInboundContent(
  inbound: unknown,
): ExtractedProtectedMessageContent | null {
  const value = asRecord(inbound);
  if (!value) return null;
  if (value.kind === "selection") {
    const text = normalizeProtectedMessageText(value.selectionId);
    return text ? { contentKind: "selection", text } : null;
  }
  if (value.kind === "text") {
    const text = normalizeProtectedMessageText(value.text);
    return text ? { contentKind: "text", text } : null;
  }
  return null;
}

/** Type-safe bridge from the verified Meta extractor into protected storage. */
export function extractProtectedInboundMessageContent(
  message: CanaryBotMessage,
): ExtractedProtectedMessageContent | null {
  if (message.inbound.kind === "selection") {
    const text = normalizeProtectedMessageText(
      message.protectedText ?? message.inbound.selectionId,
    );
    return text ? { contentKind: "selection", text } : null;
  }
  if (
    (message.messageType === "image" ||
      message.messageType === "video" ||
      message.messageType === "document") &&
    message.protectedText !== undefined
  ) {
    const text = normalizeProtectedMessageText(message.protectedText);
    return text ? { contentKind: "media_caption", text } : null;
  }
  if (message.protectedText !== undefined) {
    return extractProtectedInboundContent({
      ...message.inbound,
      text: message.protectedText,
    });
  }
  return extractProtectedInboundContent(message.inbound);
}

/** Extract visible copy from a WhatsApp Graph body without retaining media IDs. */
export function extractProtectedOutboundContent(
  body: unknown,
): ExtractedProtectedMessageContent | null {
  const value = asRecord(body);
  if (!value || typeof value.type !== "string") return null;
  if (value.type === "text") {
    const textObject = asRecord(value.text);
    const text = normalizeProtectedMessageText(textObject?.body);
    return text ? { contentKind: "text", text } : null;
  }
  if (value.type === "interactive") {
    const interactive = asRecord(value.interactive);
    const interactiveBody = asRecord(interactive?.body);
    const text = normalizeProtectedMessageText(interactiveBody?.text);
    return text ? { contentKind: "interactive_body", text } : null;
  }
  if (value.type === "image" || value.type === "video" || value.type === "document") {
    const media = asRecord(value[value.type]);
    const text = normalizeProtectedMessageText(media?.caption);
    return text ? { contentKind: "media_caption", text } : null;
  }
  return null;
}

function protectedContentId(
  kind: "in" | "bot" | "agent",
  sourceValue: string,
): string {
  assertDeterministicSourceValue(`${kind} source`, sourceValue);
  return `pmc_${kind}_${sha256Hex(
    `hemas-lite-protected-message:v1:${kind}:${sourceValue}`,
  ).slice(0, 40)}`;
}

export function protectedInboundContentId(waMessageId: string): string {
  return protectedContentId("in", waMessageId);
}

export function protectedBotEffectContentId(effectId: string): string {
  return protectedContentId("bot", effectId);
}

export function protectedAgentOperationContentId(operationId: string): string {
  return protectedContentId("agent", operationId);
}

export function protectedMessageContentCollectionPath(
  workspaceId: string,
  conversationId: string,
): string {
  assertSafeScopeId("workspaceId", workspaceId);
  assertSafeScopeId("conversationId", conversationId);
  return `workspaces/${workspaceId}/conversations/${conversationId}/${LITE_PROTECTED_MESSAGE_CONTENTS_COLLECTION}`;
}

function validSourceDirectionAndKind(input: {
  readonly id: string;
  readonly source: ProtectedMessageSource;
  readonly direction: ProtectedMessageDirection;
  readonly contentKind: ProtectedMessageContentKind;
}): boolean {
  if (input.source === "meta_inbound") {
    return input.id.startsWith("pmc_in_") &&
      input.direction === "inbound" &&
      (input.contentKind === "text" ||
        input.contentKind === "selection" ||
        input.contentKind === "media_caption");
  }
  if (input.source === "agent_reply") {
    return input.id.startsWith("pmc_agent_") &&
      input.direction === "outbound" &&
      input.contentKind === "text";
  }
  return input.id.startsWith("pmc_bot_") &&
    input.direction === "outbound" &&
    input.contentKind !== "selection";
}

export function buildProtectedMessageContentDocument(input: {
  readonly id: string;
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly messageId: string | null;
  readonly direction: ProtectedMessageDirection;
  readonly source: ProtectedMessageSource;
  readonly contentKind: ProtectedMessageContentKind;
  readonly text: string;
  readonly teamId: string;
  readonly locationId: string;
  readonly state: ProtectedMessageState;
  readonly nowMs: number;
  readonly createdAtMs?: number;
  readonly retentionDays?: unknown;
}): ProtectedMessageContentDocument {
  assertSafeScopeId("workspaceId", input.workspaceId);
  assertSafeScopeId("conversationId", input.conversationId);
  assertSafeScopeId("teamId", input.teamId);
  assertSafeScopeId("locationId", input.locationId);
  if (!CONTENT_ID.test(input.id)) throw new TypeError("id is not a protected-content id.");
  if (!validSourceDirectionAndKind(input)) {
    throw new TypeError("source, direction, content kind, and id provenance do not agree.");
  }
  if (!isSafeMs(input.nowMs)) throw new TypeError("nowMs must be a safe millisecond value.");
  const createdAtMs = input.createdAtMs ?? input.nowMs;
  if (!isSafeMs(createdAtMs) || createdAtMs > input.nowMs) {
    throw new TypeError("createdAtMs must be a safe value no later than nowMs.");
  }
  const text = normalizeProtectedMessageText(input.text);
  if (!text) throw new TypeError("text must contain safe, non-empty message content.");

  if (input.state === "materialized") {
    if (!isSafeMessageId(input.messageId)) {
      throw new TypeError("materialized content requires a safe messageId.");
    }
  } else if (input.messageId !== null) {
    throw new TypeError("non-materialized content must not claim a messageId.");
  }
  if (input.direction === "inbound" && input.state !== "materialized") {
    throw new TypeError("inbound content must already be materialized.");
  }

  const retentionDays = parseProtectedMessageRetentionDays(input.retentionDays);
  const expiresAtMs = createdAtMs + retentionDays * DAY_MS;
  if (!Number.isSafeInteger(expiresAtMs)) {
    throw new TypeError("retention expiry exceeds the safe millisecond range.");
  }
  const createdAt = Timestamp.fromMillis(createdAtMs);
  const updatedAt = Timestamp.fromMillis(input.nowMs);
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    messageId: input.messageId,
    direction: input.direction,
    source: input.source,
    contentKind: input.contentKind,
    text,
    bodySha256: sha256Hex(text),
    bodyLength: text.length,
    teamId: input.teamId,
    locationId: input.locationId,
    state: input.state,
    containsMessageContent: true,
    containsPlaintextSender: false,
    liveCanary: true,
    synthetic: true,
    createdAt,
    updatedAt,
    expiresAtMs,
    expireAt: Timestamp.fromMillis(expiresAtMs),
    schemaVersion: LITE_PROTECTED_MESSAGE_SCHEMA_VERSION,
  };
}

const DOCUMENT_KEYS = [
  "id",
  "workspaceId",
  "conversationId",
  "messageId",
  "direction",
  "source",
  "contentKind",
  "text",
  "bodySha256",
  "bodyLength",
  "teamId",
  "locationId",
  "state",
  "containsMessageContent",
  "containsPlaintextSender",
  "liveCanary",
  "synthetic",
  "createdAt",
  "updatedAt",
  "expiresAtMs",
  "expireAt",
  "schemaVersion",
] as const;

function hasExactDocumentKeys(value: UnknownRecord): boolean {
  const actual = Object.keys(value);
  return actual.length === DOCUMENT_KEYS.length &&
    DOCUMENT_KEYS.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

/**
 * Fail-closed parser used immediately before a callable exposes plaintext.
 * It returns only the minimum UI projection and rejects extra fields, altered
 * hashes, bad flags, cross-scope records, expired content, and non-terminal
 * send states.
 */
export function parseProtectedMessageContentForProjection(
  raw: unknown,
  scope: {
    readonly workspaceId: string;
    readonly conversationId: string;
    readonly teamId: string;
    readonly locationId: string;
    readonly nowMs: number;
  },
): ProtectedMessageContentProjection | null {
  const data = asRecord(raw);
  if (!data || !hasExactDocumentKeys(data) || !isSafeMs(scope.nowMs)) return null;
  if (
    data.workspaceId !== scope.workspaceId ||
    data.conversationId !== scope.conversationId ||
    data.teamId !== scope.teamId ||
    data.locationId !== scope.locationId ||
    typeof data.id !== "string" ||
    !CONTENT_ID.test(data.id) ||
    !isSafeMessageId(data.messageId) ||
    (data.direction !== "inbound" && data.direction !== "outbound") ||
    (data.source !== "meta_inbound" &&
      data.source !== "menu_bot" &&
      data.source !== "governed_ai" &&
      data.source !== "auto_reply" &&
      data.source !== "agent_reply") ||
    (data.contentKind !== "text" &&
      data.contentKind !== "selection" &&
      data.contentKind !== "interactive_body" &&
      data.contentKind !== "media_caption") ||
    data.state !== "materialized" ||
    data.containsMessageContent !== true ||
    data.containsPlaintextSender !== false ||
    data.liveCanary !== true ||
    data.synthetic !== true ||
    data.schemaVersion !== LITE_PROTECTED_MESSAGE_SCHEMA_VERSION ||
    !(data.createdAt instanceof Timestamp) ||
    !(data.updatedAt instanceof Timestamp) ||
    !(data.expireAt instanceof Timestamp) ||
    !isSafeMs(data.expiresAtMs) ||
    typeof data.text !== "string" ||
    typeof data.bodySha256 !== "string" ||
    !SHA256.test(data.bodySha256) ||
    typeof data.bodyLength !== "number" ||
    !Number.isSafeInteger(data.bodyLength)
  ) {
    return null;
  }

  const typedIdentity = {
    id: data.id,
    source: data.source as ProtectedMessageSource,
    direction: data.direction as ProtectedMessageDirection,
    contentKind: data.contentKind as ProtectedMessageContentKind,
  };
  if (!validSourceDirectionAndKind(typedIdentity)) return null;

  const text = normalizeProtectedMessageText(data.text);
  const createdAtMs = data.createdAt.toMillis();
  const updatedAtMs = data.updatedAt.toMillis();
  const expireAtMs = data.expireAt.toMillis();
  const retentionMs = data.expiresAtMs - createdAtMs;
  if (
    !text ||
    text !== data.text ||
    data.bodySha256 !== sha256Hex(text) ||
    data.bodyLength !== text.length ||
    !Number.isSafeInteger(createdAtMs) ||
    !Number.isSafeInteger(updatedAtMs) ||
    !Number.isSafeInteger(expireAtMs) ||
    createdAtMs > updatedAtMs ||
    updatedAtMs > scope.nowMs ||
    expireAtMs !== data.expiresAtMs ||
    data.expiresAtMs <= scope.nowMs ||
    retentionMs % DAY_MS !== 0 ||
    retentionMs < LITE_PROTECTED_MESSAGE_MIN_RETENTION_DAYS * DAY_MS ||
    retentionMs > LITE_PROTECTED_MESSAGE_MAX_RETENTION_DAYS * DAY_MS
  ) {
    return null;
  }

  return {
    id: data.id,
    messageId: data.messageId,
    direction: typedIdentity.direction,
    source: typedIdentity.source,
    contentKind: typedIdentity.contentKind,
    text,
    createdAtMs,
    updatedAtMs,
  };
}
