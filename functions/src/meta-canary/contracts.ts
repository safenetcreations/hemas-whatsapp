import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta WhatsApp canary contracts — pure, dependency-free logic for the
 * governed live canary lane.
 *
 * Scope, deliberately narrow:
 * - Verify Meta webhook GET verification handshakes.
 * - Verify X-Hub-Signature-256 on webhook POSTs (HMAC-SHA256, app secret).
 * - Reduce inbound WhatsApp payloads to CONTENT-FREE metadata records
 *   (message bodies and sender numbers are never stored verbatim).
 * - Enforce an explicit E.164 recipient allowlist for outbound canary sends.
 *
 * The canary lane runs ONLY inside the governed cloud demo boundary and
 * carries no patient data. It is a connectivity proof, not a messaging
 * product surface.
 */

export const META_CANARY_WORKSPACE_ID = "workspace_safenet_demo" as const;
export const META_CANARY_INBOUND_COLLECTION = "canary_inbound_events" as const;
export const META_CANARY_OUTBOUND_COLLECTION = "canary_outbound_events" as const;
export const META_CANARY_OPT_OUT_COLLECTION = "canary_opt_out_events" as const;
export const META_CANARY_DEFAULT_TEMPLATE = "hello_world" as const;
export const META_CANARY_DEFAULT_LANGUAGE = "en_US" as const;
export const META_CANARY_MAX_ALLOWLIST = 5;
/** Per Meta envelope level; larger arrays are rejected, never truncated. */
export const META_CANARY_MAX_WEBHOOK_ARRAY_ITEMS = 20;
/** Keeps one receipt + worst-case effects/suppression well below 500 writes. */
export const META_CANARY_MAX_WEBHOOK_EVENTS = 40;

export class MetaCanaryError extends Error {
  constructor(
    message: string,
    readonly code:
      | "canary_disabled"
      | "invalid_signature"
      | "invalid_verify_request"
      | "invalid_request"
      | "asset_binding_unconfigured"
      | "asset_mismatch"
      | "webhook_batch_overflow"
      | "recipient_not_allowlisted"
      | "authentication_required"
      | "provider_error",
  ) {
    super(message);
    this.name = "MetaCanaryError";
  }
}

export function verifyMetaWebhookChallenge(query: {
  readonly mode: string | undefined;
  readonly verifyToken: string | undefined;
  readonly challenge: string | undefined;
  readonly expectedVerifyToken: string;
}): string {
  if (
    query.mode !== "subscribe" ||
    !query.verifyToken ||
    !query.challenge ||
    query.expectedVerifyToken.length < 16 ||
    query.verifyToken !== query.expectedVerifyToken
  ) {
    throw new MetaCanaryError(
      "Webhook verification challenge failed.",
      "invalid_verify_request",
    );
  }
  return query.challenge;
}

export function verifyMetaSignature(input: {
  readonly rawBody: Buffer;
  readonly signatureHeader: string | undefined;
  readonly appSecret: string;
}): void {
  const header = input.signatureHeader?.trim() ?? "";
  if (!header.startsWith("sha256=") || input.appSecret.length < 8) {
    throw new MetaCanaryError(
      "The webhook payload signature is missing or malformed.",
      "invalid_signature",
    );
  }
  const presented = header.slice("sha256=".length).toLowerCase();
  const expected = createHmac("sha256", input.appSecret)
    .update(input.rawBody)
    .digest("hex");
  const presentedBuffer = Buffer.from(presented, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (
    presentedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(presentedBuffer, expectedBuffer)
  ) {
    throw new MetaCanaryError(
      "The webhook payload signature does not match the app secret.",
      "invalid_signature",
    );
  }
}

export function parseRecipientAllowlist(raw: string | undefined): readonly string[] {
  const entries = (raw ?? "")
    .split(",")
    .map((value) => normalizeE164(value))
    .filter((value): value is string => value !== null);
  const unique = [...new Set(entries)];
  return unique.slice(0, META_CANARY_MAX_ALLOWLIST);
}

export function normalizeE164(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim().replace(/[\s()-]/g, "");
  const candidate = trimmed.startsWith("+") ? trimmed.slice(1) : trimmed;
  if (!/^[1-9]\d{7,14}$/.test(candidate)) {
    return null;
  }
  return candidate;
}

export function assertAllowlistedRecipient(
  to: string | undefined,
  allowlist: readonly string[],
): string {
  const normalized = normalizeE164(to);
  if (!normalized || allowlist.length === 0 || !allowlist.includes(normalized)) {
    throw new MetaCanaryError(
      "Canary sends are limited to the explicit test recipient allowlist.",
      "recipient_not_allowlisted",
    );
  }
  return normalized;
}

/**
 * A verified Firebase identity and a server-issued exact boolean custom claim
 * are both required. Email address values are never authorization inputs.
 */
export function assertMetaCanaryTemplateAuthorization(input: {
  readonly uid: unknown;
  readonly emailVerified: unknown;
  readonly hemasMetaCanary: unknown;
}): string {
  if (
    typeof input.uid !== "string" ||
    input.uid.length === 0 ||
    input.uid.length > 128 ||
    input.emailVerified !== true ||
    input.hemasMetaCanary !== true
  ) {
    throw new MetaCanaryError(
      "Canary sends require the explicitly authorized synthetic demo identity.",
      "authentication_required",
    );
  }
  return input.uid;
}

export type CanaryInboundRecord = {
  readonly id: string;
  readonly workspaceId: typeof META_CANARY_WORKSPACE_ID;
  readonly kind: "message" | "status";
  readonly waMessageId: string;
  readonly fromNumberSha256: string | null;
  readonly fromNumberLast4: string | null;
  readonly toPhoneNumberId: string | null;
  readonly messageType: string | null;
  readonly statusValue: string | null;
  readonly bodySha256: string | null;
  readonly providerTimestamp: string | null;
  readonly canary: true;
  readonly containsMessageContent: false;
  readonly schemaVersion: 2;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 512
    ? value
    : null;
}

function safeId(value: string | null, fallback: string): string {
  const cleaned = (value ?? "")
    .replace(/[^A-Za-z0-9._:-]/g, "-")
    .replace(/^-+/, "")
    .slice(0, 120);
  return cleaned.length >= 4 ? cleaned : fallback;
}

/**
 * Bind a signed webhook payload to the one configured WhatsApp Business
 * Account and phone-number asset. This must run only after HMAC verification
 * and before the payload can cause storage or provider side effects.
 */
export function assertMetaWebhookAssetBinding(
  payload: unknown,
  expectedWabaId: string | undefined,
  expectedPhoneNumberId: string | undefined,
): void {
  const wabaId = expectedWabaId?.trim() ?? "";
  const phoneNumberId = expectedPhoneNumberId?.trim() ?? "";
  if (!/^\d{5,32}$/.test(wabaId) || !/^\d{5,32}$/.test(phoneNumberId)) {
    throw new MetaCanaryError(
      "The Meta webhook asset binding is not configured.",
      "asset_binding_unconfigured",
    );
  }

  const root = asRecord(payload);
  if (!root || root.object !== "whatsapp_business_account") {
    throw new MetaCanaryError(
      "The signed webhook payload is not bound to the configured Meta assets.",
      "asset_mismatch",
    );
  }

  const entries = Array.isArray(root.entry) ? root.entry : [];
  if (entries.length === 0) {
    throw new MetaCanaryError(
      "The signed webhook payload is not bound to the configured Meta assets.",
      "asset_mismatch",
    );
  }
  if (entries.length > META_CANARY_MAX_WEBHOOK_ARRAY_ITEMS) {
    throw new MetaCanaryError(
      "The signed webhook payload exceeds the bounded envelope size.",
      "webhook_batch_overflow",
    );
  }
  for (const entryValue of entries) {
    const entry = asRecord(entryValue);
    if (asString(entry?.id) !== wabaId) {
      throw new MetaCanaryError(
        "The signed webhook payload is not bound to the configured Meta assets.",
        "asset_mismatch",
      );
    }
    const changes = entry && Array.isArray(entry.changes) ? entry.changes : [];
    if (changes.length > META_CANARY_MAX_WEBHOOK_ARRAY_ITEMS) {
      throw new MetaCanaryError(
        "The signed webhook payload exceeds the bounded envelope size.",
        "webhook_batch_overflow",
      );
    }
    for (const changeValue of changes) {
      const change = asRecord(changeValue);
      const changeValueRecord = asRecord(change?.value);
      if (
        (Array.isArray(changeValueRecord?.messages) &&
          changeValueRecord.messages.length > META_CANARY_MAX_WEBHOOK_ARRAY_ITEMS) ||
        (Array.isArray(changeValueRecord?.statuses) &&
          changeValueRecord.statuses.length > META_CANARY_MAX_WEBHOOK_ARRAY_ITEMS)
      ) {
        throw new MetaCanaryError(
          "The signed webhook payload exceeds the bounded envelope size.",
          "webhook_batch_overflow",
        );
      }
      if (!change || change.field !== "messages") continue;
      const value = changeValueRecord;
      const metadata = asRecord(value?.metadata);
      if (asString(metadata?.phone_number_id) !== phoneNumberId) {
        throw new MetaCanaryError(
          "The signed webhook payload is not bound to the configured Meta assets.",
          "asset_mismatch",
        );
      }
    }
  }
}

export type CanaryBotMessage = {
  readonly waId: string;
  readonly waMessageId: string;
  readonly messageType: string;
  readonly inbound:
    | { readonly kind: "selection"; readonly selectionId: string; readonly text: "" }
    | { readonly kind: "text"; readonly selectionId: ""; readonly text: string };
};

/**
 * Extract bot-relevant messages in memory. Public inbound is an exact,
 * independently gated mode; when it is off this preserves the original
 * explicit tester allowlist. Message text and full sender digits are transient
 * request-memory values and callers must never persist or log them.
 */
export function extractCanaryInboundBotMessages(
  payload: unknown,
  allowlist: readonly string[],
  publicInboundEnabled: boolean,
): readonly CanaryBotMessage[] {
  if (!publicInboundEnabled && allowlist.length === 0) return [];
  const root = asRecord(payload);
  if (!root || root.object !== "whatsapp_business_account") return [];

  const out: CanaryBotMessage[] = [];
  const seenMessageIds = new Set<string>();
  const entries = Array.isArray(root.entry) ? root.entry : [];
  if (entries.length > META_CANARY_MAX_WEBHOOK_ARRAY_ITEMS) {
    throw new MetaCanaryError(
      "The signed webhook payload exceeds the bounded envelope size.",
      "webhook_batch_overflow",
    );
  }
  for (const entryValue of entries) {
    const entry = asRecord(entryValue);
    const changes = entry && Array.isArray(entry.changes) ? entry.changes : [];
    if (changes.length > META_CANARY_MAX_WEBHOOK_ARRAY_ITEMS) {
      throw new MetaCanaryError(
        "The signed webhook payload exceeds the bounded envelope size.",
        "webhook_batch_overflow",
      );
    }
    for (const changeValue of changes) {
      const change = asRecord(changeValue);
      if (!change || change.field !== "messages") continue;
      const value = asRecord(change.value);
      const messages = value && Array.isArray(value.messages) ? value.messages : [];
      const statuses = value && Array.isArray(value.statuses) ? value.statuses : [];
      if (
        messages.length > META_CANARY_MAX_WEBHOOK_ARRAY_ITEMS ||
        statuses.length > META_CANARY_MAX_WEBHOOK_ARRAY_ITEMS
      ) {
        throw new MetaCanaryError(
          "The signed webhook payload exceeds the bounded envelope size.",
          "webhook_batch_overflow",
        );
      }
      for (const messageValue of messages) {
        const message = asRecord(messageValue);
        if (!message) continue;
        const waId = normalizeE164(asString(message.from) ?? undefined);
        const waMessageId = asString(message.id);
        if (
          !waId ||
          !waMessageId ||
          seenMessageIds.has(waMessageId) ||
          (!publicInboundEnabled && !allowlist.includes(waId))
        ) {
          continue;
        }
        seenMessageIds.add(waMessageId);

        const messageType = asString(message.type) ?? "unknown";
        const interactive = asRecord(message.interactive);
        const buttonReply = asRecord(interactive?.button_reply);
        const listReply = asRecord(interactive?.list_reply);
        const selectionId = asString(buttonReply?.id) ?? asString(listReply?.id) ?? "";
        const textRecord = asRecord(message.text);
        const text =
          messageType === "text" && typeof textRecord?.body === "string"
            ? textRecord.body.slice(0, 512)
            : "";
        out.push({
          waId,
          waMessageId,
          messageType,
          inbound: selectionId
            ? { kind: "selection", selectionId, text: "" }
            : { kind: "text", selectionId: "", text },
        });
      }
    }
  }
  return out;
}

/** Tester-only compatibility wrapper used by proactive canary surfaces. */
export function extractAllowlistedCanaryBotMessages(
  payload: unknown,
  allowlist: readonly string[],
): readonly CanaryBotMessage[] {
  return extractCanaryInboundBotMessages(payload, allowlist, false);
}

/**
 * Keep only newly created provider receipts before any bot or automatic-reply
 * send. Returned sender digits remain transient request-memory data.
 */
export function selectFreshAllowlistedCanaryMessages(
  payload: unknown,
  allowlist: readonly string[],
  freshMessageIds: ReadonlySet<string>,
): readonly CanaryBotMessage[] {
  return extractAllowlistedCanaryBotMessages(payload, allowlist)
    .filter((message) => freshMessageIds.has(message.waMessageId));
}

export type CanaryMarketingOptOutKeyword = "STOP" | "UNSUBSCRIBE";

/** Exact, deterministic marketing opt-out keywords; never fuzzy-match prose. */
export function canaryMarketingOptOutKeyword(
  text: string,
): CanaryMarketingOptOutKeyword | null {
  const normalized = text.normalize("NFKC").trim().toUpperCase();
  return normalized === "STOP" || normalized === "UNSUBSCRIBE" ? normalized : null;
}

export type CanaryMarketingOptOut = {
  readonly waId: string;
  readonly waMessageId: string;
  readonly keyword: CanaryMarketingOptOutKeyword;
};

/** Extract content-free opt-out classifications from allowlisted text events. */
export function extractAllowlistedCanaryMarketingOptOuts(
  payload: unknown,
  allowlist: readonly string[],
): readonly CanaryMarketingOptOut[] {
  return extractCanaryInboundMarketingOptOuts(payload, allowlist, false);
}

/** STOP/UNSUBSCRIBE applies equally to an explicitly enabled public inbound. */
export function extractCanaryInboundMarketingOptOuts(
  payload: unknown,
  allowlist: readonly string[],
  publicInboundEnabled: boolean,
): readonly CanaryMarketingOptOut[] {
  const optOuts: CanaryMarketingOptOut[] = [];
  for (const message of extractCanaryInboundBotMessages(
    payload,
    allowlist,
    publicInboundEnabled,
  )) {
    if (message.inbound.kind !== "text") continue;
    const keyword = canaryMarketingOptOutKeyword(message.inbound.text);
    if (keyword) {
      optOuts.push({
        waId: message.waId,
        waMessageId: message.waMessageId,
        keyword,
      });
    }
  }
  return optOuts;
}

export type CanaryMarketingOptOutEvidence = {
  readonly id: string;
  readonly workspaceId: typeof META_CANARY_WORKSPACE_ID;
  readonly contactId: string;
  readonly providerEventSha256: string;
  readonly keywordCode: CanaryMarketingOptOutKeyword;
  readonly purpose: "health_campaigns";
  readonly category: "marketing";
  readonly channel: "whatsapp";
  readonly status: "withdrawn";
  readonly source: "inbound_keyword";
  readonly canary: true;
  readonly liveCanary: true;
  readonly synthetic: true;
  readonly containsMessageContent: false;
  readonly schemaVersion: 1;
};

/** Deterministic, content-free evidence metadata for one provider event. */
export function buildCanaryMarketingOptOutEvidence(input: {
  readonly providerMessageId: string;
  readonly contactId: string;
  readonly keyword: CanaryMarketingOptOutKeyword;
  readonly sha256Hex: (value: string) => string;
}): CanaryMarketingOptOutEvidence {
  const providerEventSha256 = input.sha256Hex(input.providerMessageId);
  return {
    id: `optout_${input.sha256Hex(`optout:${input.providerMessageId}`).slice(0, 32)}`,
    workspaceId: META_CANARY_WORKSPACE_ID,
    contactId: input.contactId,
    providerEventSha256,
    keywordCode: input.keyword,
    purpose: "health_campaigns",
    category: "marketing",
    channel: "whatsapp",
    status: "withdrawn",
    source: "inbound_keyword",
    canary: true,
    liveCanary: true,
    synthetic: true,
    containsMessageContent: false,
    schemaVersion: 1,
  };
}

export type CanaryMarketingSuppression = {
  readonly suppressAll: boolean;
  readonly suppressMarketing: true;
  readonly invalidContact: boolean;
  readonly reasons: readonly string[];
  readonly updatedAt: unknown;
};

const CANARY_SAFE_SUPPRESSION_REASONS = [
  "stop_keyword",
  "manual_withdrawal",
  "complaint",
  "invalid_number",
  "guardian_authority_missing",
  "clinical_hold",
] as const;

/** Preserve canonical holds while adding the marketing STOP suppression once. */
export function buildCanaryMarketingSuppression(
  raw: unknown,
  updatedAt: unknown,
): { readonly suppression: CanaryMarketingSuppression; readonly preferenceRevisionIncrement: 0 | 1 } {
  const existing = asRecord(raw);
  const safeReasons = new Set<string>(CANARY_SAFE_SUPPRESSION_REASONS);
  const reasons = Array.isArray(existing?.reasons)
    ? existing.reasons.filter(
      (reason): reason is string => typeof reason === "string" && safeReasons.has(reason),
    )
    : [];
  const uniqueReasons = [
    ...new Set(reasons.filter((reason) => reason !== "stop_keyword")),
  ].slice(0, CANARY_SAFE_SUPPRESSION_REASONS.length - 1);
  uniqueReasons.push("stop_keyword");
  return {
    suppression: {
      suppressAll: typeof existing?.suppressAll === "boolean" ? existing.suppressAll : false,
      suppressMarketing: true,
      invalidContact:
        typeof existing?.invalidContact === "boolean" ? existing.invalidContact : false,
      reasons: uniqueReasons,
      updatedAt,
    },
    preferenceRevisionIncrement: existing?.suppressMarketing === true ? 0 : 1,
  };
}

/**
 * Unique transient recipients from already allowlist-filtered in-memory
 * messages. These values must be used for immediate provider sends only.
 */
export function canaryMessageRecipients(
  messages: readonly CanaryBotMessage[],
): readonly string[] {
  const recipients = new Set<string>();
  for (const message of messages) {
    recipients.add(message.waId);
  }
  return [...recipients];
}

/** Collapse repeated provider events within one delivery by their receipt id. */
export function dedupeCanaryInboundRecords(
  records: readonly CanaryInboundRecord[],
): readonly CanaryInboundRecord[] {
  const unique = new Map<string, CanaryInboundRecord>();
  for (const record of records) {
    if (!unique.has(record.id)) unique.set(record.id, record);
  }
  return [...unique.values()];
}

/** Select only provider events that do not already have a create-only receipt. */
export function selectNewCanaryInboundRecords(
  records: readonly CanaryInboundRecord[],
  existingIds: ReadonlySet<string>,
): readonly CanaryInboundRecord[] {
  return dedupeCanaryInboundRecords(records).filter((record) => !existingIds.has(record.id));
}

/**
 * Transient identifier used by the content-free inbox bridge. The reply index
 * guarantees one outbound bridge record per bot reply, even without a Meta id.
 */
export function canaryOutboundBridgeMessageRef(
  providerMessageId: string | null,
  inboundWaMessageId: string,
  replyIndex: number,
): string {
  const source = providerMessageId?.trim() || inboundWaMessageId;
  return `${source}:reply:${replyIndex}`;
}

/**
 * Reduce a Meta WhatsApp webhook POST body to content-free, identifier-minimized
 * inbound records. Text bodies and sender numbers are hashed via the supplied
 * hasher; only the sender's last four digits remain for operational display.
 */
export type CanaryInboundBatch = {
  readonly records: readonly CanaryInboundRecord[];
  readonly overflow: boolean;
};

export type CanaryInboundBatchDecision =
  | { readonly kind: "accept"; readonly records: readonly CanaryInboundRecord[] }
  | { readonly kind: "reject_overflow" };

/** Never expose a truncated record list to the persistence path. */
export function decideCanaryInboundBatch(
  batch: CanaryInboundBatch,
): CanaryInboundBatchDecision {
  return batch.overflow
    ? { kind: "reject_overflow" }
    : { kind: "accept", records: batch.records };
}

/**
 * Globally cap one signed delivery. `overflow` must be rejected before any
 * durable write so Meta can retry the complete delivery without partial work.
 */
export function extractCanaryInboundBatch(
  payload: unknown,
  sha256Hex: (value: string) => string,
): CanaryInboundBatch {
  const root = asRecord(payload);
  if (!root || root.object !== "whatsapp_business_account") {
    return { records: [], overflow: false };
  }
  const records: CanaryInboundRecord[] = [];
  const entries = Array.isArray(root.entry) ? root.entry : [];
  if (entries.length > META_CANARY_MAX_WEBHOOK_ARRAY_ITEMS) {
    return { records: [], overflow: true };
  }
  for (const entryValue of entries) {
    const entry = asRecord(entryValue);
    const changes = entry && Array.isArray(entry.changes) ? entry.changes : [];
    if (changes.length > META_CANARY_MAX_WEBHOOK_ARRAY_ITEMS) {
      return { records: [], overflow: true };
    }
    for (const changeValue of changes) {
      const change = asRecord(changeValue);
      if (!change || change.field !== "messages") continue;
      const value = asRecord(change.value);
      if (!value) continue;
      const metadata = asRecord(value.metadata);
      const phoneNumberId = asString(metadata?.phone_number_id);

      const messages = Array.isArray(value.messages) ? value.messages : [];
      const statuses = Array.isArray(value.statuses) ? value.statuses : [];
      if (
        messages.length > META_CANARY_MAX_WEBHOOK_ARRAY_ITEMS ||
        statuses.length > META_CANARY_MAX_WEBHOOK_ARRAY_ITEMS
      ) {
        return { records: [], overflow: true };
      }
      for (const messageValue of messages) {
        const message = asRecord(messageValue);
        if (!message) continue;
        if (records.length >= META_CANARY_MAX_WEBHOOK_EVENTS) {
          return { records, overflow: true };
        }
        const waMessageId = asString(message.id);
        const textRecord = asRecord(message.text);
        const body = asString(textRecord?.body);
        const fromNumber = normalizeE164(asString(message.from) ?? undefined);
        records.push({
          id: safeId(waMessageId, `inbound-${records.length + 1}`),
          workspaceId: META_CANARY_WORKSPACE_ID,
          kind: "message",
          waMessageId: waMessageId ?? "unknown",
          fromNumberSha256: fromNumber
            ? sha256Hex(`canary-sender:${fromNumber}`)
            : null,
          fromNumberLast4: fromNumber ? fromNumber.slice(-4) : null,
          toPhoneNumberId: phoneNumberId,
          messageType: asString(message.type),
          statusValue: null,
          bodySha256: body ? sha256Hex(body) : null,
          providerTimestamp: asString(message.timestamp),
          canary: true,
          containsMessageContent: false,
          schemaVersion: 2,
        });
      }

      for (const statusValue of statuses) {
        const status = asRecord(statusValue);
        if (!status) continue;
        if (records.length >= META_CANARY_MAX_WEBHOOK_EVENTS) {
          return { records, overflow: true };
        }
        const waMessageId = asString(status.id);
        records.push({
          id: safeId(
            waMessageId ? `${waMessageId}-${asString(status.status) ?? "status"}` : null,
            `status-${records.length + 1}`,
          ),
          workspaceId: META_CANARY_WORKSPACE_ID,
          kind: "status",
          waMessageId: waMessageId ?? "unknown",
          fromNumberSha256: null,
          fromNumberLast4: null,
          toPhoneNumberId: phoneNumberId,
          messageType: null,
          statusValue: asString(status.status),
          bodySha256: null,
          providerTimestamp: asString(status.timestamp),
          canary: true,
          containsMessageContent: false,
          schemaVersion: 2,
        });
      }
    }
  }
  return { records, overflow: false };
}

/** Compatibility projection that also fails closed instead of exposing a prefix. */
export function extractCanaryInboundRecords(
  payload: unknown,
  sha256Hex: (value: string) => string,
): readonly CanaryInboundRecord[] {
  const batch = extractCanaryInboundBatch(payload, sha256Hex);
  return batch.overflow ? [] : batch.records;
}

export function buildCanaryTemplateSendBody(input: {
  readonly to: string;
  readonly templateName: string;
  readonly languageCode: string;
}): UnknownRecord {
  if (
    !/^[a-z0-9_]{1,120}$/.test(input.templateName) ||
    !/^[A-Za-z_]{2,10}$/.test(input.languageCode)
  ) {
    throw new MetaCanaryError(
      "The canary template request failed strict validation.",
      "invalid_request",
    );
  }
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.to,
    type: "template",
    template: {
      name: input.templateName,
      language: { code: input.languageCode },
    },
  };
}
