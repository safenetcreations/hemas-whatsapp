import { randomUUID } from "node:crypto";
import {
  FieldValue,
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import { sha256Hex } from "../deterministic.js";
import {
  BRIDGE_WORKSPACE_ID,
  buildLiveContactDocument,
  buildLiveConversationDocument,
  buildLiveMessageDocument,
  liveIds,
} from "../meta-bot/bridge.js";
import {
  FRESH_BOT_SESSION,
  runBotEngine,
  type BotLanguage,
  type BotSession,
} from "../meta-bot/engine.js";
import {
  LITE_BOOKING_OPERATIONS_COLLECTION,
} from "../lite/booking-operations.js";
import {
  LITE_CAMPAIGN_SENDS_COLLECTION,
  sendDocIdForWamid,
  shouldAdvanceSendStatus,
} from "../lite/campaigns.js";
import {
  LITE_LOCATION_ID,
  LITE_REPLY_OPERATIONS_COLLECTION,
  LITE_TEAM_ID,
} from "../lite/contracts.js";
import { METRICS_COLLECTION, metricsDayId } from "../lite/metrics.js";
import {
  LITE_PROTECTED_MESSAGE_CONTENTS_COLLECTION,
  LITE_PROTECTED_MESSAGE_RETENTION_ENV,
  buildProtectedMessageContentDocument,
  extractProtectedOutboundContent,
  protectedBotEffectContentId,
  type ExtractedProtectedMessageContent,
} from "../lite/protected-messages.js";
import {
  META_CANARY_INBOUND_COLLECTION,
  META_CANARY_OUTBOUND_COLLECTION,
  META_CANARY_WORKSPACE_ID,
  buildCanaryTemplateSendBody,
  canaryOutboundBridgeMessageRef,
  parseRecipientAllowlist,
} from "./contracts.js";
import { sendGraphMessage } from "./graph.js";
import {
  META_CANARY_RETURN_ROUTES_COLLECTION,
  decryptMetaCanaryReturnRoute,
  metaCanaryReturnRoutePhoneAssetSha256,
} from "./return-route.js";
import {
  META_CANARY_OUTBOX_COLLECTION,
  META_CANARY_OUTBOX_MAX_BATCH,
  META_CANARY_PUBLIC_JOURNAL_TTL_MS,
  META_CANARY_FATAL_RECONCILIATIONS_COLLECTION,
  META_CANARY_PROVIDER_ROUTES_COLLECTION,
  assertCanaryProviderMessageId,
  buildCanaryFatalResolutionAudit,
  buildCanaryProviderRouteEvidence,
  buildCanaryOutboxRecord,
  buildCanaryTransientAiReplyEvidence,
  canaryOutboxEffectId,
  canaryProviderRouteId,
  claimCanaryOutboxRecord,
  completeCanaryOutboxRecord,
  decideCanaryAutomationConversationSuppression,
  decideCanaryFatalResolution,
  decideCanaryGraphSuppression,
  decideCanaryStatusTarget,
  decodeDurableBotInput,
  failCanaryOutboxRecord,
  markCanaryOutboxDispatchStarted,
  parseCanaryOutboxRecord,
  planCanaryBotReplies,
  preserveCanaryOutboundConversationState,
  reconcileCanaryFatalOutboxRecord,
  resolveCanaryOutboxRecipient,
  resolveCanaryProviderRoute,
  selectCanaryBotReply,
  selectDueCanaryOutboxRecords,
  terminalizeCanaryGraphEffectWithoutDispatch,
  type CanaryOutboxRecord,
  type CanaryFatalResolutionInput,
} from "./outbox.js";

const AUTO_REPLY_TEXT =
  "✅ Hemas Connect received your message. This is a synthetic SafeNet demo — a care-team agent reviews and responds through the governed portal. No real patient data is processed here.";
const META_CANARY_PUBLIC_SESSIONS_COLLECTION = "canary_public_bot_sessions";
const META_CANARY_PUBLIC_SUPPRESSIONS_COLLECTION = "canary_public_suppressions";
const PUBLIC_SESSION_TTL_MS = 24 * 60 * 60 * 1_000;
const PUBLIC_TEST_NOTICE_REPLY = Object.freeze({
  type: "text",
  text: Object.freeze({
    preview_url: false,
    body: "Public bot test only. Do not send medical, personal, or emergency information. No diagnosis or real booking is provided. Choose a language to continue.",
  }),
});
const PUBLIC_TEST_NOTICE =
  "Public bot test only. Do not send medical, personal, or emergency information. No diagnosis or real booking is provided.";
const PUBLIC_TEST_STAFF_REPLY = Object.freeze({
  type: "text",
  text: Object.freeze({
    preview_url: false,
    body: "This public test cannot create a staff or clinical case. For urgent help, contact the hospital or local emergency service directly.",
  }),
});
const PUBLIC_TEST_BOOKING_REPLY = Object.freeze({
  type: "text",
  text: Object.freeze({
    preview_url: false,
    body: "The booking journey demonstration is complete. Nothing was saved, no booking was created, and no staff follow-up will occur. Reply MENU for more options.",
  }),
});

type LeaseOwner = "http_webhook" | "admin_reconciler";

export type CanaryPublicInboundRouteConfig = {
  readonly enabled: boolean;
  readonly identitySecretBase64: string;
  readonly currentKeyVersion: number;
  readonly encryptionKeysByVersion: ReadonlyMap<number, string>;
};

export type CanaryTransientBotOverride = {
  readonly receiptId: string;
  readonly reply: Readonly<Record<string, unknown>>;
};

export type CanaryTransientBotCandidate = {
  readonly receiptId: string;
  readonly recipient: string;
  readonly session: BotSession;
};

export type CanaryPublicTransientBotCandidate = {
  readonly receiptId: string;
  readonly subjectSha256: string;
  readonly session: BotSession;
};

export type CanaryOutboxProcessResult = {
  readonly disposition:
    | "terminal"
    | "suppressed"
    | "retryable"
    | "fatal"
    | "deferred";
  readonly childEffectIds: readonly string[];
};

export type CanaryOutboxBatchResult = {
  readonly attempted: number;
  readonly terminal: number;
  readonly suppressed: number;
  readonly retryable: number;
  readonly fatal: number;
  readonly deferred: number;
};

export function insertCanaryOutboxChildEffects(
  queue: string[],
  seen: Set<string>,
  afterIndex: number,
  childEffectIds: readonly string[],
): void {
  const fresh: string[] = [];
  for (const childId of childEffectIds) {
    if (seen.has(childId)) continue;
    seen.add(childId);
    fresh.push(childId);
  }
  if (fresh.length > 0) queue.splice(afterIndex + 1, 0, ...fresh);
}

function workspace(db: Firestore) {
  return db.collection("workspaces").doc(META_CANARY_WORKSPACE_ID);
}

function outbox(db: Firestore) {
  return workspace(db).collection(META_CANARY_OUTBOX_COLLECTION);
}

type ProtectedBotDispatchContent = ExtractedProtectedMessageContent & {
  readonly source: "menu_bot" | "governed_ai";
};

const PROTECTED_RETENTION_DAY_MS = 24 * 60 * 60 * 1_000;

function protectedBotSource(
  replySource: "ai_transient" | "durable",
): ProtectedBotDispatchContent["source"] {
  return replySource === "ai_transient" ? "governed_ai" : "menu_bot";
}

function sameProtectedDocumentValue(left: unknown, right: unknown): boolean {
  if (left instanceof Timestamp || right instanceof Timestamp) {
    return left instanceof Timestamp &&
      right instanceof Timestamp &&
      left.toMillis() === right.toMillis();
  }
  return left === right;
}

/**
 * Validate an existing reservation without projecting or logging its text.
 * Rebuilding the exact document also verifies its hash, retention window,
 * provenance flags, and complete key set.
 */
function assertReservedProtectedBotContent(input: {
  readonly raw: unknown;
  readonly id: string;
  readonly conversationId: string;
  readonly source: ProtectedBotDispatchContent["source"];
  readonly nowMs: number;
  readonly expectedContent?: ExtractedProtectedMessageContent;
  readonly allowExpired?: boolean;
}): { readonly expired: boolean } {
  const data = asRecord(input.raw);
  try {
    const expired =
      typeof data?.expiresAtMs === "number" &&
      data.expiresAtMs <= input.nowMs;
    if (
      !data ||
      !(data.createdAt instanceof Timestamp) ||
      !(data.updatedAt instanceof Timestamp) ||
      !(data.expireAt instanceof Timestamp) ||
      typeof data.expiresAtMs !== "number" ||
      !Number.isSafeInteger(data.expiresAtMs) ||
      data.expiresAtMs !== data.expireAt.toMillis() ||
      data.updatedAt.toMillis() > input.nowMs ||
      (!input.allowExpired && expired)
    ) {
      throw new Error("invalid_timestamps");
    }
    const createdAtMs = data.createdAt.toMillis();
    const retentionDays =
      (data.expiresAtMs - createdAtMs) / PROTECTED_RETENTION_DAY_MS;
    const actualContent = input.expectedContent ?? {
      contentKind: data.contentKind as ExtractedProtectedMessageContent["contentKind"],
      text: data.text as string,
    };
    const expected = buildProtectedMessageContentDocument({
      id: input.id,
      workspaceId: META_CANARY_WORKSPACE_ID,
      conversationId: input.conversationId,
      messageId: null,
      direction: "outbound",
      source: input.source,
      contentKind: actualContent.contentKind,
      text: actualContent.text,
      teamId: LITE_TEAM_ID,
      locationId: LITE_LOCATION_ID,
      state: "reserved",
      createdAtMs,
      nowMs: data.updatedAt.toMillis(),
      retentionDays,
    });
    const expectedRecord = expected as unknown as Record<string, unknown>;
    const actualKeys = Object.keys(data).sort();
    const expectedKeys = Object.keys(expectedRecord).sort();
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key, index) => key !== expectedKeys[index]) ||
      expectedKeys.some((key) =>
        !sameProtectedDocumentValue(data[key], expectedRecord[key])
      )
    ) {
      throw new Error("document_mismatch");
    }
    return { expired };
  } catch {
    throw new Error("protected_bot_content_invalid");
  }
}

/**
 * Read only the current automation gates needed before any inbound text can be
 * sent to the AI provider. No message body is accepted or returned here.
 */
export async function selectCanaryTransientBotCandidates(input: {
  readonly db: Firestore;
  readonly receiptIds: ReadonlySet<string>;
  readonly recipientsByReceipt: ReadonlyMap<string, string>;
}): Promise<ReadonlyMap<string, CanaryTransientBotCandidate>> {
  const candidates = new Map<string, CanaryTransientBotCandidate>();
  const unique = [...new Set(input.receiptIds)];
  await Promise.all(unique.map(async (receiptId) => {
    const recipient = input.recipientsByReceipt.get(receiptId);
    if (!recipient) return;
    const ids = liveIds(recipient);
    const ws = workspace(input.db);
    try {
      const [sessionSnapshot, contactSnapshot, conversationSnapshot] = await Promise.all([
        ws.collection("canary_bot_sessions").doc(ids.key).get(),
        ws.collection("contacts").doc(ids.contactId).get(),
        ws.collection("conversations").doc(ids.conversationId).get(),
      ]);
      const contactDecision = decideCanaryGraphSuppression({
        effectKind: "graph_bot_reply",
        expectedContactId: ids.contactId,
        contact: contactSnapshot.exists ? contactSnapshot.data() : null,
      });
      const conversationDecision = decideCanaryAutomationConversationSuppression({
        effectKind: "bot_plan",
        expectedConversationId: ids.conversationId,
        conversation: conversationSnapshot.exists ? conversationSnapshot.data() : null,
      });
      if (contactDecision.kind !== "allow" || conversationDecision.kind !== "allow") {
        return;
      }
      candidates.set(receiptId, {
        receiptId,
        recipient,
        session: parseSession(sessionSnapshot.data()),
      });
    } catch {
      return;
    }
  }));
  return candidates;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredString(
  value: unknown,
  pattern: RegExp,
  label: string,
): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`invalid_${label}`);
  }
  return value;
}

function requiredMs(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`invalid_${label}`);
  }
  return value;
}

export type CanaryPortalMessageProjectionTarget = {
  readonly messageId: string;
  readonly agentReply: boolean;
  readonly automationSource?: "menu_bot" | "governed_ai";
};

/** Resolve a provider route to the content-free portal message it represents. */
export function canaryPortalMessageProjectionTarget(input: {
  readonly targetKind:
    | "manual_template"
    | "meta_outbox_effect"
    | "lite_agent_reply"
    | "lite_booking_notification";
  readonly targetId: string;
  readonly target: unknown;
  readonly providerMessageRef: string;
}): CanaryPortalMessageProjectionTarget | null {
  if (input.targetKind === "lite_agent_reply") {
    return {
      messageId: `message_live_${sha256Hex(`${input.targetId}:agent`).slice(0, 16)}`,
      agentReply: true,
    };
  }
  if (input.targetKind !== "meta_outbox_effect") return null;
  const effect = parseCanaryOutboxRecord(input.target);
  if (
    !effect ||
    effect.effectKind !== "graph_bot_reply" ||
    isPublicInboundEffect(effect) ||
    effect.resultProviderMessageId !== input.providerMessageRef
  ) {
    return null;
  }
  const inboundProviderRef = requiredString(
    effect.payload.providerMessageRef,
    /^.{1,512}$/,
    "provider_message_ref",
  );
  const replyIndex = effect.payload.replyIndex;
  if (!Number.isSafeInteger(replyIndex) || (replyIndex as number) < 0 ||
      (replyIndex as number) > 20) {
    throw new Error("invalid_reply_index");
  }
  const outboundMessageRef = canaryOutboundBridgeMessageRef(
    input.providerMessageRef,
    inboundProviderRef,
    replyIndex as number,
  );
  const automationSource = effect.dispatchReplySource === "ai_transient"
    ? "governed_ai" as const
    : effect.dispatchReplySource === "durable"
      ? "menu_bot" as const
      : undefined;
  return {
    messageId:
      `message_live_${sha256Hex(`${outboundMessageRef}:outbound`).slice(0, 16)}`,
    agentReply: false,
    ...(automationSource ? { automationSource } : {}),
  };
}

export function isCanaryPortalMessageProjectionValid(input: {
  readonly message: unknown;
  readonly target: CanaryPortalMessageProjectionTarget;
}): boolean {
  const message = asRecord(input.message);
  return Boolean(
    message &&
    message.id === input.target.messageId &&
    message.workspaceId === META_CANARY_WORKSPACE_ID &&
    message.direction === "outbound" &&
    message.externalDispatch === "dispatched" &&
    message.metadataOnly === true &&
    message.synthetic === true &&
    message.liveCanary === true &&
    (input.target.automationSource === undefined ||
      message.automationSource === undefined ||
      message.automationSource === input.target.automationSource) &&
    (input.target.agentReply
      ? message.agentReply === true && typeof message.actorId === "string"
      : message.agentReply !== true && message.actorId === null),
  );
}

function welcomeMediaId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requiredString(value, /^[A-Za-z0-9._:-]{5,128}$/, "welcome_media_id");
}

function parseSession(value: unknown): BotSession {
  const data = asRecord(value);
  if (!data) return FRESH_BOT_SESSION;
  const language = data.language;
  const state = data.state;
  if (
    language !== null && language !== "en" && language !== "si" && language !== "ta"
  ) {
    return FRESH_BOT_SESSION;
  }
  if (
    state !== "language" &&
    state !== "menu" &&
    state !== "book_department" &&
    state !== "book_day" &&
    state !== "book_slot" &&
    state !== "idle"
  ) {
    return FRESH_BOT_SESSION;
  }
  return {
    language,
    state,
    departmentId: typeof data.departmentId === "string" ? data.departmentId : null,
    dayId: typeof data.dayId === "string" ? data.dayId : null,
    updatedAtMs:
      typeof data.updatedAtMs === "number" && Number.isSafeInteger(data.updatedAtMs)
        ? data.updatedAtMs
        : 0,
  };
}

function isPublicInboundEffect(record: CanaryOutboxRecord): boolean {
  return typeof record.payload.inboundReturnRouteId === "string";
}

function isActivePublicSuppression(
  value: unknown,
  subjectSha256: string,
  nowMs: number,
): boolean {
  const suppression = asRecord(value);
  if (
    !suppression ||
    suppression.active !== true ||
    suppression.subjectSha256 !== subjectSha256 ||
    typeof suppression.lastOptOutReceiptSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(suppression.lastOptOutReceiptSha256) ||
    suppression.containsMessageContent !== false ||
    suppression.containsPlaintextSender !== false ||
    suppression.schemaVersion !== 1 ||
    !(suppression.expireAt instanceof Timestamp) ||
    typeof suppression.expiresAtMs !== "number" ||
    suppression.expireAt.toMillis() !== suppression.expiresAtMs
  ) {
    throw new Error("meta_canary_public_suppression_invalid");
  }
  return suppression.expiresAtMs > nowMs;
}

export function presentMetaCanaryPublicBot(
  result: ReturnType<typeof runBotEngine>,
  _previous: BotSession,
): {
  readonly replies: readonly Readonly<Record<string, unknown>>[];
  readonly staffHandoff: boolean;
} {
  const sourceReplies = result.staffHandoff
    ? [PUBLIC_TEST_STAFF_REPLY]
    : result.booking
    ? [PUBLIC_TEST_BOOKING_REPLY]
    : result.replies;
  return {
    replies: sourceReplies.map(withPublicTestNotice),
    staffHandoff: false,
  };
}

/** Public AI keeps the same privacy notice while the model body stays transient. */
export function presentMetaCanaryPublicTransientReply(
  reply: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return withPublicTestNotice(reply);
}

function withPublicTestNotice(
  reply: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const type = reply.type;
  if (type === "text") {
    const text = asRecord(reply.text);
    const body = typeof text?.body === "string" ? text.body : "";
    return {
      ...reply,
      text: {
        ...(text ?? {}),
        preview_url: false,
        body: `${PUBLIC_TEST_NOTICE}\n\n${body}`.slice(0, 4_096),
      },
    };
  }
  if (type === "interactive") {
    const interactive = asRecord(reply.interactive);
    const body = asRecord(interactive?.body);
    const bodyText = typeof body?.text === "string" ? body.text : "";
    if (!interactive || !body || !bodyText) return PUBLIC_TEST_NOTICE_REPLY;
    return {
      ...reply,
      interactive: {
        ...interactive,
        body: {
          ...body,
          text: `${PUBLIC_TEST_NOTICE}\n\n${bodyText}`.slice(0, 1_024),
        },
      },
    };
  }
  if (type === "image") {
    const image = asRecord(reply.image);
    if (!image) return PUBLIC_TEST_NOTICE_REPLY;
    const caption = typeof image.caption === "string" ? image.caption : "";
    return {
      ...reply,
      image: {
        ...image,
        caption: `${PUBLIC_TEST_NOTICE}\n\n${caption}`.slice(0, 1_024),
      },
    };
  }
  return PUBLIC_TEST_NOTICE_REPLY;
}

function parsePublicSession(value: unknown, nowMs: number): BotSession {
  const data = asRecord(value);
  if (!data) return FRESH_BOT_SESSION;
  if (
    data.publicInboundTest !== true ||
    data.synthetic !== false ||
    data.containsMessageContent !== false ||
    !(data.expireAt instanceof Timestamp) ||
    typeof data.expiresAtMs !== "number" ||
    !Number.isSafeInteger(data.expiresAtMs) ||
    data.expireAt.toMillis() !== data.expiresAtMs ||
    data.expiresAtMs <= nowMs
  ) {
    return FRESH_BOT_SESSION;
  }
  return parseSession(data);
}

/**
 * Read only keyed public-session and STOP state before an in-memory question is
 * sent to Gemini. This selector never accepts or returns a plaintext sender or
 * message body.
 */
export async function selectCanaryPublicTransientBotCandidates(input: {
  readonly db: Firestore;
  readonly receiptIds: ReadonlySet<string>;
  readonly subjectsByReceipt: ReadonlyMap<string, string>;
  readonly nowMs: number;
}): Promise<ReadonlyMap<string, CanaryPublicTransientBotCandidate>> {
  const candidates = new Map<string, CanaryPublicTransientBotCandidate>();
  const unique = [...new Set(input.receiptIds)];
  await Promise.all(unique.map(async (receiptId) => {
    const subjectSha256 = input.subjectsByReceipt.get(receiptId);
    if (!subjectSha256 || !/^[0-9a-f]{64}$/.test(subjectSha256)) return;
    const ws = workspace(input.db);
    try {
      const [sessionSnapshot, suppressionSnapshot] = await Promise.all([
        ws.collection(META_CANARY_PUBLIC_SESSIONS_COLLECTION)
          .doc(subjectSha256)
          .get(),
        ws.collection(META_CANARY_PUBLIC_SUPPRESSIONS_COLLECTION)
          .doc(subjectSha256)
          .get(),
      ]);
      if (
        suppressionSnapshot.exists &&
        isActivePublicSuppression(
          suppressionSnapshot.data(),
          subjectSha256,
          input.nowMs,
        )
      ) {
        return;
      }
      candidates.set(receiptId, {
        receiptId,
        subjectSha256,
        session: parsePublicSession(sessionSnapshot.data(), input.nowMs),
      });
    } catch {
      // Public AI fails closed to the deterministic reply path.
    }
  }));
  return candidates;
}

function allowlistedRecipientFor(record: CanaryOutboxRecord): string | null {
  return resolveCanaryOutboxRecipient({
    recipientSha256: record.payload.recipientSha256,
    recipientLast4: record.payload.recipientLast4,
    allowlist: parseRecipientAllowlist(process.env.HEMAS_META_ALLOWLISTED_RECIPIENTS),
    sha256Hex,
  });
}

/**
 * Public bot replies resolve only from a short-lived encrypted route produced
 * by the signed inbound webhook. Proactive templates never call this route
 * path and remain restricted to the explicit tester allowlist.
 */
async function recipientFor(
  db: Firestore,
  record: CanaryOutboxRecord,
  phoneNumberId: string,
  publicInboundRoute: CanaryPublicInboundRouteConfig | undefined,
  nowMs: number,
  transaction?: Transaction,
  expectedPhoneAssetSha256?: string,
): Promise<string | null> {
  const routeId = record.payload.inboundReturnRouteId;
  if (routeId === undefined) return allowlistedRecipientFor(record);
  if (
    record.effectKind !== "bot_plan" &&
    record.effectKind !== "graph_bot_reply" &&
    record.effectKind !== "graph_auto_reply"
  ) {
    return null;
  }
  if (
    typeof routeId !== "string" ||
    !/^return_route_[0-9a-f]{40}$/.test(routeId) ||
    publicInboundRoute?.enabled !== true ||
    publicInboundRoute.identitySecretBase64.length === 0 ||
    publicInboundRoute.encryptionKeysByVersion.size < 1
  ) {
    return null;
  }
  const recipientSha256 = record.payload.recipientSha256;
  if (
    typeof recipientSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(recipientSha256)
  ) {
    return null;
  }
  try {
    const routeRef = workspace(db)
      .collection(META_CANARY_RETURN_ROUTES_COLLECTION)
      .doc(routeId);
    const routeSnapshot = transaction
      ? await transaction.get(routeRef)
      : await routeRef.get();
    if (!routeSnapshot.exists) return null;
    const routeData = routeSnapshot.data();
    const expireAt = routeData?.expireAt;
    const expiresAtMs = routeData?.expiresAtMs;
    const providerMessageRef = record.payload.providerMessageRef;
    const routeKeyVersion = routeData?.keyVersion;
    const encryptionSecretBase64 = typeof routeKeyVersion === "number"
      ? publicInboundRoute.encryptionKeysByVersion.get(routeKeyVersion)
      : undefined;
    if (
      !(expireAt instanceof Timestamp) ||
      typeof expiresAtMs !== "number" ||
      expireAt.toMillis() !== expiresAtMs ||
      routeData?.routeId !== routeId ||
      !Number.isSafeInteger(routeKeyVersion) ||
      !encryptionSecretBase64 ||
      typeof providerMessageRef !== "string" ||
      routeData?.receiptSha256 !== sha256Hex(
        `meta-canary-route-receipt:v1:${providerMessageRef}`,
      )
    ) {
      return null;
    }
    const { expireAt: _expireAt, ...encryptedRoute } = routeData as Record<string, unknown>;
    const recipient = decryptMetaCanaryReturnRoute({
      record: encryptedRoute,
      expectedWorkspaceId: META_CANARY_WORKSPACE_ID,
      expectedPhoneNumberAssetSha256: expectedPhoneAssetSha256 ??
        metaCanaryReturnRoutePhoneAssetSha256(phoneNumberId),
      expectedSenderSha256: recipientSha256,
      expectedKeyVersion: routeKeyVersion,
      identitySecretBase64: publicInboundRoute.identitySecretBase64,
      encryptionSecretBase64,
      nowMs,
    });
    return recipient;
  } catch {
    return null;
  }
}

function metricWrite(
  transaction: Transaction,
  db: Firestore,
  nowMs: number,
  fields: Readonly<Record<string, number>>,
): void {
  const entries = Object.entries(fields).filter(([, value]) =>
    Number.isFinite(value) && value > 0
  );
  if (entries.length === 0) return;
  const id = metricsDayId(nowMs);
  let total = 0;
  const increments: Record<string, unknown> = {};
  for (const [field, value] of entries) {
    increments[field] = FieldValue.increment(value);
    if (field !== "apiRequests") total += value;
  }
  if (!("apiRequests" in increments) && total > 0) {
    increments.apiRequests = FieldValue.increment(total);
  }
  transaction.set(
    workspace(db).collection(METRICS_COLLECTION).doc(id),
    {
      id,
      workspaceId: BRIDGE_WORKSPACE_ID,
      day: id.replace(/^daily_/, ""),
      synthetic: true,
      liveCanary: true,
      containsMessageContent: false,
      schemaVersion: 1,
      updatedAt: Timestamp.fromMillis(nowMs),
      ...increments,
    },
    { merge: true },
  );
}

async function claimEffect(
  db: Firestore,
  effectId: string,
  leaseOwner: LeaseOwner,
  nowMs: number,
): Promise<
  | { readonly action: "claimed"; readonly record: CanaryOutboxRecord; readonly leaseToken: string }
  | { readonly action: "fatalized"; readonly record: CanaryOutboxRecord }
  | { readonly action: "noop"; readonly record: CanaryOutboxRecord }
> {
  const leaseToken = randomUUID();
  return db.runTransaction(async (transaction) => {
    const ref = outbox(db).doc(effectId);
    const snapshot = await transaction.get(ref);
    const current = parseCanaryOutboxRecord(snapshot.data());
    if (!current || current.id !== effectId) {
      throw new Error("invalid_outbox_record");
    }
    const decision = claimCanaryOutboxRecord({
      record: current,
      nowMs,
      leaseToken,
      leaseOwner,
    });
    const preDispatchNoSend =
      decision.action === "fatalized" &&
      decision.record.dispatchStartedAtMs === null &&
      (decision.record.effectKind === "graph_bot_reply" ||
        decision.record.effectKind === "graph_auto_reply" ||
        decision.record.effectKind === "graph_template_send");
    const durableRecord = preDispatchNoSend
      ? terminalizeCanaryGraphEffectWithoutDispatch({
        record: decision.record,
        nowMs,
      })
      : decision.record;
    if (decision.action !== "noop") {
      transaction.set(ref, durableRecord, { merge: false });
      if (
        decision.action === "fatalized" &&
        decision.record.effectKind === "graph_template_send" &&
        typeof decision.record.payload.outboundId === "string"
      ) {
        transaction.set(
          workspace(db)
            .collection(META_CANARY_OUTBOUND_COLLECTION)
            .doc(decision.record.payload.outboundId),
          preDispatchNoSend
            ? {
              status: "not_sent",
              providerMessageId: null,
              failureReasonCode:
                durableRecord.lastErrorCode ?? "pre_dispatch_attempts_exhausted",
              completedAt: Timestamp.fromMillis(nowMs),
              updatedAt: Timestamp.fromMillis(nowMs),
            }
            : {
              status: "uncertain",
              updatedAt: Timestamp.fromMillis(nowMs),
            },
          { merge: true },
        );
      }
    }
    if (preDispatchNoSend) {
      return { action: "noop" as const, record: durableRecord };
    }
    return decision.action === "claimed"
      ? { action: "claimed" as const, record: decision.record, leaseToken }
      : { action: decision.action, record: decision.record };
  });
}

async function failClaimedEffect(input: {
  readonly db: Firestore;
  readonly effectId: string;
  readonly leaseToken: string;
  readonly nowMs: number;
  readonly errorCode: string;
  readonly safeToRetry: boolean;
  readonly templateOutboundId?: string;
}): Promise<"terminal" | "retryable" | "fatal"> {
  return input.db.runTransaction(async (transaction) => {
    const ref = outbox(input.db).doc(input.effectId);
    const snapshot = await transaction.get(ref);
    const current = parseCanaryOutboxRecord(snapshot.data());
    if (!current) throw new Error("invalid_outbox_record");
    if (current.state === "terminal" || current.state === "fatal") {
      return current.state;
    }
    const failed = failCanaryOutboxRecord({
      record: current,
      leaseToken: input.leaseToken,
      nowMs: input.nowMs,
      errorCode: input.errorCode,
      safeToRetry: input.safeToRetry,
    });
    const preDispatchNoSend =
      failed.state === "fatal" &&
      failed.dispatchStartedAtMs === null &&
      (failed.effectKind === "graph_bot_reply" ||
        failed.effectKind === "graph_auto_reply" ||
        failed.effectKind === "graph_template_send");
    const durableRecord = preDispatchNoSend
      ? terminalizeCanaryGraphEffectWithoutDispatch({
        record: failed,
        nowMs: input.nowMs,
        errorCode: input.errorCode,
      })
      : failed;
    transaction.set(ref, durableRecord, { merge: false });
    if (input.templateOutboundId && (failed.state === "fatal" || preDispatchNoSend)) {
      transaction.set(
        workspace(input.db)
          .collection(META_CANARY_OUTBOUND_COLLECTION)
          .doc(input.templateOutboundId),
        preDispatchNoSend
          ? {
            status: "not_sent",
            providerMessageId: null,
            failureReasonCode:
              durableRecord.lastErrorCode ?? "pre_dispatch_attempts_exhausted",
            completedAt: Timestamp.fromMillis(input.nowMs),
            updatedAt: Timestamp.fromMillis(input.nowMs),
          }
          : {
            status: "uncertain",
            updatedAt: Timestamp.fromMillis(input.nowMs),
          },
        { merge: true },
      );
    }
    return durableRecord.state === "terminal"
      ? "terminal"
      : durableRecord.state === "retryable"
        ? "retryable"
        : "fatal";
  });
}

async function completeUnsupportedStatusTarget(input: {
  readonly db: Firestore;
  readonly effectId: string;
  readonly leaseToken: string;
  readonly nowMs: number;
}): Promise<void> {
  await input.db.runTransaction(async (transaction) => {
    const ref = outbox(input.db).doc(input.effectId);
    const snapshot = await transaction.get(ref);
    const current = parseCanaryOutboxRecord(snapshot.data());
    if (!current || current.effectKind !== "campaign_status") {
      throw new Error("invalid_status_outbox_record");
    }
    transaction.set(
      ref,
      completeCanaryOutboxRecord({
        record: current,
        leaseToken: input.leaseToken,
        nowMs: input.nowMs,
        terminalReason: "unsupported_status_target",
      }),
      { merge: false },
    );
  });
}

function reconstructBotReply(
  record: CanaryOutboxRecord,
  transientBotOverride?: CanaryTransientBotOverride,
): {
  readonly reply: Record<string, unknown>;
  readonly replyType: string;
  readonly language: BotLanguage | null;
  readonly purpose: "general_support" | "appointment" | "laboratory";
  readonly staffHandoff: boolean;
  readonly replyIndex: number;
  readonly inboundProviderRef: string;
  readonly replySource: "ai_transient" | "durable";
} {
  const botInput = asRecord(record.payload.botInput);
  const decoded = decodeDurableBotInput(
    botInput as Parameters<typeof decodeDurableBotInput>[0],
  );
  if (!decoded) throw new Error("invalid_bot_input");
  const previous = parseSession(record.payload.sessionBefore);
  const occurredAtMs = requiredMs(record.payload.occurredAtMs, "occurred_at");
  const replyIndex = requiredMs(record.payload.replyIndex, "reply_index");
  const result = runBotEngine(
    previous,
    { ...decoded, nowMs: occurredAtMs },
    { welcomeMediaId: welcomeMediaId(record.payload.welcomeMediaId) },
  );
  const presentation = isPublicInboundEffect(record)
    ? presentMetaCanaryPublicBot(result, previous)
    : { replies: result.replies, staffHandoff: result.staffHandoff };
  const durableReply = presentation.replies[replyIndex];
  if (!durableReply) throw new Error("missing_bot_reply");
  const rawTransientReply = result.aiQuery &&
      transientBotOverride?.receiptId === record.receiptId
    ? transientBotOverride.reply
    : undefined;
  const transientReply = rawTransientReply && isPublicInboundEffect(record)
    ? presentMetaCanaryPublicTransientReply(rawTransientReply)
    : rawTransientReply;
  const reply = selectCanaryBotReply({
    payload: record.payload,
    durableReply,
    ...(transientReply ? { transientReply } : {}),
    sha256Hex,
  });
  return {
    reply,
    replyType: typeof reply.type === "string" ? reply.type : "text",
    language: result.session.language,
    purpose: result.purpose,
    staffHandoff: presentation.staffHandoff,
    replyIndex,
    inboundProviderRef: requiredString(
      record.payload.providerMessageRef,
      /^.{1,512}$/,
      "provider_message_ref",
    ),
    replySource: transientReply && reply === transientReply
      ? "ai_transient"
      : "durable",
  };
}

async function processInboundMetric(
  db: Firestore,
  claimed: CanaryOutboxRecord,
  leaseToken: string,
  nowMs: number,
): Promise<void> {
  await db.runTransaction(async (transaction) => {
    const ref = outbox(db).doc(claimed.id);
    const snapshot = await transaction.get(ref);
    const current = parseCanaryOutboxRecord(snapshot.data());
    if (!current) throw new Error("invalid_outbox_record");
    const completed = completeCanaryOutboxRecord({ record: current, leaseToken, nowMs });
    transaction.set(ref, completed, { merge: false });
    metricWrite(transaction, db, requiredMs(current.payload.occurredAtMs, "occurred_at"), {
      inboundMessages: 1,
    });
  });
}

async function processCampaignStatus(
  db: Firestore,
  claimed: CanaryOutboxRecord,
  leaseToken: string,
  nowMs: number,
): Promise<void> {
  const providerMessageRef = requiredString(
    claimed.payload.providerMessageRef,
    /^.{1,512}$/,
    "provider_message_ref",
  );
  const status = requiredString(
    claimed.payload.status,
    /^(?:sent|delivered|read|failed)$/,
    "campaign_status",
  );
  await db.runTransaction(async (transaction) => {
    const effectRef = outbox(db).doc(claimed.id);
    const sendRef = workspace(db)
      .collection(LITE_CAMPAIGN_SENDS_COLLECTION)
      .doc(sendDocIdForWamid(providerMessageRef, sha256Hex));
    const routeRef = workspace(db)
      .collection(META_CANARY_PROVIDER_ROUTES_COLLECTION)
      .doc(canaryProviderRouteId(providerMessageRef, sha256Hex));
    const [effectSnapshot, sendSnapshot, routeSnapshot] = await Promise.all([
      transaction.get(effectRef),
      transaction.get(sendRef),
      transaction.get(routeRef),
    ]);
    const current = parseCanaryOutboxRecord(effectSnapshot.data());
    if (!current) throw new Error("invalid_outbox_record");
    const target = decideCanaryStatusTarget({
      campaignSendExists: sendSnapshot.exists,
      providerRouteExists: routeSnapshot.exists,
    });
    if (target.kind === "retry_missing_target") {
      throw new Error("provider_status_target_not_materialized");
    }
    if (
      target.kind === "campaign" &&
      shouldAdvanceSendStatus(sendSnapshot.data()?.status, status)
    ) {
      transaction.set(
        sendRef,
        { status, updatedAt: Timestamp.fromMillis(nowMs) },
        { merge: true },
      );
    }
    let isPublicStatus = false;
    if (target.kind === "provider_route") {
      const expectedProviderHash = sha256Hex(providerMessageRef);
      const routed = resolveCanaryProviderRoute({
        route: routeSnapshot.data(),
        providerMessageId: providerMessageRef,
        sha256Hex,
      });
      if (!routed) {
        throw new Error("invalid_provider_status_route");
      }
      const targetRef = routed.targetKind === "manual_template"
        ? workspace(db).collection(META_CANARY_OUTBOUND_COLLECTION).doc(routed.targetId)
        : routed.targetKind === "meta_outbox_effect"
          ? outbox(db).doc(routed.targetId)
          : routed.targetKind === "lite_agent_reply"
            ? workspace(db).collection(LITE_REPLY_OPERATIONS_COLLECTION).doc(routed.targetId)
            : workspace(db)
              .collection(LITE_BOOKING_OPERATIONS_COLLECTION)
              .doc(routed.targetId);
      const targetSnapshot = await transaction.get(targetRef);
      const targetRecord = asRecord(targetSnapshot.data());
      isPublicStatus = routed.targetKind === "meta_outbox_effect" &&
        targetRecord?.publicInboundTest === true;
      const routedProviderMessageId = routed.targetKind === "meta_outbox_effect"
        ? targetRecord?.resultProviderMessageId
        : targetRecord?.providerMessageId;
      const providerBound =
        typeof routedProviderMessageId === "string" &&
        sha256Hex(routedProviderMessageId) === expectedProviderHash;
      const commonValid =
        targetSnapshot.exists &&
        targetRecord?.id === routed.targetId &&
        targetRecord.workspaceId === META_CANARY_WORKSPACE_ID &&
        providerBound;
      const kindValid = routed.targetKind === "manual_template"
        ? targetRecord?.status === "sent" &&
          targetRecord.containsMessageContent === false &&
          targetRecord.containsFullRecipient === false
        : routed.targetKind === "meta_outbox_effect"
          ? (() => {
            const effect = parseCanaryOutboxRecord(targetSnapshot.data());
            return Boolean(
              effect &&
              effect.state === "terminal" &&
              (effect.terminalReason === "completed" ||
                effect.terminalReason === "reconciled_sent") &&
              effect.resultProviderMessageId === providerMessageRef &&
              (effect.effectKind === "graph_bot_reply" ||
                effect.effectKind === "graph_auto_reply"),
            );
          })()
          : routed.targetKind === "lite_agent_reply"
            ? targetRecord?.status === "sent" &&
              targetRecord.containsMessageContent === false
            : targetRecord?.status === "completed" &&
              targetRecord.notified === true &&
              targetRecord.containsMessageContent === false;
      if (
        !commonValid ||
        !kindValid
      ) {
        throw new Error("provider_status_target_not_materialized");
      }
      const portalMessageTarget = canaryPortalMessageProjectionTarget({
        targetKind: routed.targetKind,
        targetId: routed.targetId,
        target: targetSnapshot.data(),
        providerMessageRef,
      });
      const portalMessageRef = portalMessageTarget
        ? workspace(db).collection("messages").doc(portalMessageTarget.messageId)
        : null;
      const portalMessageSnapshot = portalMessageRef
        ? await transaction.get(portalMessageRef)
        : null;
      if (
        portalMessageTarget &&
        (!portalMessageSnapshot?.exists ||
          !isCanaryPortalMessageProjectionValid({
            message: portalMessageSnapshot.data(),
            target: portalMessageTarget,
          }))
      ) {
        throw new Error("provider_status_message_not_materialized");
      }
      if (shouldAdvanceSendStatus(targetRecord?.deliveryStatus ?? "sent", status)) {
        transaction.set(
          targetRef,
          {
            deliveryStatus: status,
            deliveryUpdatedAt: Timestamp.fromMillis(nowMs),
            updatedAt: Timestamp.fromMillis(nowMs),
          },
          { merge: true },
        );
      }
      if (portalMessageTarget && portalMessageRef && portalMessageSnapshot) {
        const portalMessage = asRecord(portalMessageSnapshot.data());
        if (!portalMessage) throw new Error("provider_status_message_not_materialized");
        const statusAdvances = shouldAdvanceSendStatus(
          portalMessage.status ?? "sent",
          status,
        );
        const sourceNeedsBackfill = Boolean(
          portalMessageTarget.automationSource &&
          portalMessage.automationSource === undefined,
        );
        if (statusAdvances || sourceNeedsBackfill) {
          const observedAt = Timestamp.fromMillis(nowMs);
          const reachedDelivery = status === "delivered" || status === "read";
          transaction.set(
            portalMessageRef,
            {
              ...(statusAdvances
                ? {
                  status,
                  deliveryUpdatedAt: observedAt,
                  updatedAt: observedAt,
                  ...(reachedDelivery && !(portalMessage.deliveredAt instanceof Timestamp)
                    ? { deliveredAt: observedAt }
                    : {}),
                }
                : {}),
              ...(sourceNeedsBackfill
                ? { automationSource: portalMessageTarget.automationSource }
                : {}),
            },
            { merge: true },
          );
        }
      }
    }
    const completed = completeCanaryOutboxRecord({
      record: current,
      leaseToken,
      nowMs,
    });
    const statusExpiresAtMs = nowMs + META_CANARY_PUBLIC_JOURNAL_TTL_MS;
    transaction.set(
      effectRef,
      {
        ...completed,
        ...(isPublicStatus
          ? {
            publicInboundTest: true,
            expiresAtMs: statusExpiresAtMs,
            expireAt: Timestamp.fromMillis(statusExpiresAtMs),
          }
          : {}),
      },
      { merge: false },
    );
    if (isPublicStatus) {
      transaction.set(
        workspace(db)
          .collection(META_CANARY_INBOUND_COLLECTION)
          .doc(current.receiptId),
        {
          publicInboundTest: true,
          expiresAtMs: statusExpiresAtMs,
          expireAt: Timestamp.fromMillis(statusExpiresAtMs),
        },
        { merge: true },
      );
    }
  });
}

async function processPublicBotPlan(
  db: Firestore,
  claimed: CanaryOutboxRecord,
  leaseToken: string,
  nowMs: number,
  transientBotOverride?: CanaryTransientBotOverride,
): Promise<readonly string[]> {
  const botInput = asRecord(claimed.payload.botInput);
  const decoded = decodeDurableBotInput(
    botInput as Parameters<typeof decodeDurableBotInput>[0],
  );
  if (!decoded) throw new Error("invalid_bot_input");
  const occurredAtMs = requiredMs(claimed.payload.occurredAtMs, "occurred_at");
  const providerMessageRef = requiredString(
    claimed.payload.providerMessageRef,
    /^.{1,512}$/,
    "provider_message_ref",
  );
  const plannedWelcomeMediaId = welcomeMediaId(claimed.payload.welcomeMediaId);
  const subjectSha256 = requiredString(
    claimed.payload.recipientSha256,
    /^[0-9a-f]{64}$/,
    "public_subject_sha256",
  );
  const routeId = requiredString(
    claimed.payload.inboundReturnRouteId,
    /^return_route_[0-9a-f]{40}$/,
    "inbound_return_route_id",
  );

  return db.runTransaction(async (transaction) => {
    const ws = workspace(db);
    const effectRef = outbox(db).doc(claimed.id);
    const sessionRef = ws
      .collection(META_CANARY_PUBLIC_SESSIONS_COLLECTION)
      .doc(subjectSha256);
    const suppressionRef = ws
      .collection(META_CANARY_PUBLIC_SUPPRESSIONS_COLLECTION)
      .doc(subjectSha256);
    const [effectSnapshot, sessionSnapshot, suppressionSnapshot] =
      await transaction.getAll(effectRef, sessionRef, suppressionRef);
    if (!effectSnapshot || !sessionSnapshot || !suppressionSnapshot) {
      throw new Error("public_bot_snapshot_missing");
    }
    const current = parseCanaryOutboxRecord(effectSnapshot.data());
    if (!current || current.state !== "processing" || current.leaseToken !== leaseToken) {
      throw new Error("outbox_lease_mismatch");
    }
    if (
      suppressionSnapshot.exists &&
      isActivePublicSuppression(
        suppressionSnapshot.data(),
        subjectSha256,
        nowMs,
      )
    ) {
      transaction.set(
        effectRef,
        completeCanaryOutboxRecord({
          record: current,
          leaseToken,
          nowMs,
          terminalReason: "suppressed",
        }),
        { merge: false },
      );
      return [];
    }

    const previous = parsePublicSession(sessionSnapshot.data(), nowMs);
    const result = runBotEngine(
      previous,
      { ...decoded, nowMs: occurredAtMs },
      { welcomeMediaId: plannedWelcomeMediaId },
    );
    const presentation = presentMetaCanaryPublicBot(result, previous);
    const transientAiReply = result.aiQuery &&
        transientBotOverride?.receiptId === current.receiptId
      ? presentMetaCanaryPublicTransientReply(transientBotOverride.reply)
      : null;
    const replyPlans = planCanaryBotReplies(
      presentation.replies,
      transientAiReply ?? undefined,
    );
    const childEffects = replyPlans.map((replyPlan) => {
      const { reply, durableFallbackReply, replyIndex } = replyPlan;
      const id = canaryOutboxEffectId(
        current.receiptId,
        "graph_bot_reply",
        `${current.id}:${replyIndex}`,
        sha256Hex,
      );
      return buildCanaryOutboxRecord({
        id,
        receiptId: current.receiptId,
        effectKind: "graph_bot_reply",
        payload: {
          recipientSha256: subjectSha256,
          providerMessageRef,
          inboundReturnRouteId: routeId,
          botInput,
          welcomeMediaId: plannedWelcomeMediaId,
          sessionBefore: previous,
          occurredAtMs,
          replyIndex,
          replySha256: sha256Hex(JSON.stringify(reply)),
          ...(replyPlan.transient
            ? buildCanaryTransientAiReplyEvidence(
                reply,
                durableFallbackReply,
                sha256Hex,
              )
            : {}),
          currentHandoffReply: false,
          publicInboundTest: true,
        },
        nowMs,
      });
    });
    const childRefs = childEffects.map((child) => outbox(db).doc(child.id));
    const childSnapshots = childRefs.length > 0
      ? await transaction.getAll(...childRefs)
      : [];

    const expiresAtMs = nowMs + PUBLIC_SESSION_TTL_MS;
    const journalExpiresAtMs = nowMs + META_CANARY_PUBLIC_JOURNAL_TTL_MS;
    transaction.set(
      sessionRef,
      {
        ...result.session,
        publicInboundTest: true,
        synthetic: false,
        containsMessageContent: false,
        containsPlaintextSender: false,
        expiresAtMs,
        expireAt: Timestamp.fromMillis(expiresAtMs),
      },
      { merge: false },
    );
    for (const [index, child] of childEffects.entries()) {
      const snapshot = childSnapshots[index];
      const existing = parseCanaryOutboxRecord(snapshot?.data());
      if (snapshot?.exists) {
        if (
          !existing ||
          existing.id !== child.id ||
          existing.receiptId !== child.receiptId ||
          existing.effectKind !== child.effectKind
        ) {
          throw new Error("outbox_child_collision");
        }
      } else {
        transaction.create(outbox(db).doc(child.id), {
          ...child,
          publicInboundTest: true,
          expiresAtMs: journalExpiresAtMs,
          expireAt: Timestamp.fromMillis(journalExpiresAtMs),
        });
      }
    }
    transaction.set(
      effectRef,
      completeCanaryOutboxRecord({ record: current, leaseToken, nowMs }),
      { merge: false },
    );
    return childEffects.map((child) => child.id);
  });
}

async function processBotPlan(
  db: Firestore,
  claimed: CanaryOutboxRecord,
  leaseToken: string,
  recipient: string,
  nowMs: number,
  transientBotOverride?: CanaryTransientBotOverride,
): Promise<readonly string[]> {
  if (isPublicInboundEffect(claimed)) {
    return processPublicBotPlan(
      db,
      claimed,
      leaseToken,
      nowMs,
      transientBotOverride,
    );
  }
  const ids = liveIds(recipient);
  const botInput = asRecord(claimed.payload.botInput);
  const decoded = decodeDurableBotInput(
    botInput as Parameters<typeof decodeDurableBotInput>[0],
  );
  if (!decoded) throw new Error("invalid_bot_input");
  const occurredAtMs = requiredMs(claimed.payload.occurredAtMs, "occurred_at");
  const providerMessageRef = requiredString(
    claimed.payload.providerMessageRef,
    /^.{1,512}$/,
    "provider_message_ref",
  );
  const inboundMessageType = requiredString(
    claimed.payload.messageType,
    /^.{1,64}$/,
    "message_type",
  );
  const plannedWelcomeMediaId = welcomeMediaId(claimed.payload.welcomeMediaId);
  return db.runTransaction(async (transaction) => {
    const ws = workspace(db);
    const effectRef = outbox(db).doc(claimed.id);
    const sessionRef = ws.collection("canary_bot_sessions").doc(ids.key);
    const contactRef = ws.collection("contacts").doc(ids.contactId);
    const conversationRef = ws.collection("conversations").doc(ids.conversationId);
    const [effectSnapshot, sessionSnapshot, contactSnapshot, conversationSnapshot] =
      await Promise.all([
        transaction.get(effectRef),
        transaction.get(sessionRef),
        transaction.get(contactRef),
        transaction.get(conversationRef),
      ]);
    const current = parseCanaryOutboxRecord(effectSnapshot.data());
    if (!current || current.state !== "processing" || current.leaseToken !== leaseToken) {
      throw new Error("outbox_lease_mismatch");
    }
    const previous = parseSession(sessionSnapshot.data());
    const preexistingHandoff = decideCanaryAutomationConversationSuppression({
      effectKind: "bot_plan",
      expectedConversationId: ids.conversationId,
      conversation: conversationSnapshot.exists ? conversationSnapshot.data() : null,
    });
    if (
      preexistingHandoff.kind === "suppress" &&
      preexistingHandoff.reason === "human_handoff"
    ) {
      const inboundBridge = {
        direction: "inbound" as const,
        waMessageId: providerMessageRef,
        messageType: inboundMessageType,
        language: previous.language,
        purpose: "general_support" as const,
        staffHandoff: true,
        last4: recipient.slice(-4),
      };
      const existingContact = contactSnapshot.data();
      const existingConversation = conversationSnapshot.data();
      transaction.set(
        contactRef,
        buildLiveContactDocument({
          contactId: ids.contactId,
          last4: recipient.slice(-4),
          language: previous.language ?? "en",
          nowMs,
          ...(contactSnapshot.exists && existingContact ? { existing: existingContact } : {}),
          addTags: ["human-handoff"],
        }),
        { merge: false },
      );
      transaction.set(
        conversationRef,
        buildLiveConversationDocument({
          contactId: ids.contactId,
          conversationId: ids.conversationId,
          message: inboundBridge,
          nowMs,
          ...(conversationSnapshot.exists && existingConversation
            ? { existing: existingConversation }
            : {}),
        }),
        { merge: false },
      );
      const inboundMessageId =
        `message_live_${sha256Hex(`${providerMessageRef}:inbound`).slice(0, 16)}`;
      transaction.set(
        ws.collection("messages").doc(inboundMessageId),
        buildLiveMessageDocument({
          messageId: inboundMessageId,
          contactId: ids.contactId,
          conversationId: ids.conversationId,
          message: inboundBridge,
          nowMs,
        }),
        { merge: false },
      );
      transaction.set(
        effectRef,
        completeCanaryOutboxRecord({
          record: current,
          leaseToken,
          nowMs,
          terminalReason: "suppressed",
        }),
        { merge: false },
      );
      return [];
    }
    if (preexistingHandoff.kind === "suppress") {
      throw new Error(preexistingHandoff.reason);
    }
    const result = runBotEngine(
      previous,
      { ...decoded, nowMs: occurredAtMs },
      { welcomeMediaId: plannedWelcomeMediaId },
    );
    const transientAiReply = result.aiQuery &&
        transientBotOverride?.receiptId === current.receiptId
      ? transientBotOverride.reply
      : null;
    const replyPlans = planCanaryBotReplies(
      result.replies,
      transientAiReply ?? undefined,
    );
    const childEffects = replyPlans.map((replyPlan) => {
      const { reply, durableFallbackReply, replyIndex } = replyPlan;
      const id = canaryOutboxEffectId(
        current.receiptId,
        "graph_bot_reply",
        `${current.id}:${replyIndex}`,
        sha256Hex,
      );
      return buildCanaryOutboxRecord({
        id,
        receiptId: current.receiptId,
        effectKind: "graph_bot_reply",
        payload: {
          recipientSha256: current.payload.recipientSha256,
          recipientLast4: current.payload.recipientLast4,
          providerMessageRef,
          ...(typeof current.payload.inboundReturnRouteId === "string"
            ? { inboundReturnRouteId: current.payload.inboundReturnRouteId }
            : {}),
          botInput,
          welcomeMediaId: plannedWelcomeMediaId,
          sessionBefore: previous,
          occurredAtMs,
          replyIndex,
          replySha256: sha256Hex(JSON.stringify(reply)),
          ...(replyPlan.transient
            ? buildCanaryTransientAiReplyEvidence(
                reply,
                durableFallbackReply,
                sha256Hex,
              )
            : {}),
          currentHandoffReply: result.staffHandoff,
        },
        nowMs,
      });
    });
    const childSnapshots = [];
    for (const child of childEffects) {
      childSnapshots.push(await transaction.get(outbox(db).doc(child.id)));
    }

    transaction.set(
      sessionRef,
      { ...result.session, canary: true, containsMessageContent: false },
      { merge: false },
    );
    const inboundBridge = {
      direction: "inbound" as const,
      waMessageId: providerMessageRef,
      messageType: inboundMessageType,
      language: result.session.language,
      purpose: result.purpose,
      staffHandoff: result.staffHandoff,
      last4: recipient.slice(-4),
    };
    const addTags: Array<"appointment" | "human-handoff"> = [];
    if (result.booking) addTags.push("appointment");
    if (result.staffHandoff) addTags.push("human-handoff");
    const existingContact = contactSnapshot.data();
    const existingConversation = conversationSnapshot.data();
    transaction.set(
      contactRef,
      buildLiveContactDocument({
        contactId: ids.contactId,
        last4: recipient.slice(-4),
        language: result.session.language ?? "en",
        nowMs,
        ...(contactSnapshot.exists && existingContact ? { existing: existingContact } : {}),
        ...(addTags.length > 0 ? { addTags } : {}),
      }),
      { merge: false },
    );
    transaction.set(
      conversationRef,
      buildLiveConversationDocument({
        contactId: ids.contactId,
        conversationId: ids.conversationId,
        message: inboundBridge,
        nowMs,
        ...(conversationSnapshot.exists && existingConversation
          ? { existing: existingConversation }
          : {}),
      }),
      { merge: false },
    );
    const inboundMessageId =
      `message_live_${sha256Hex(`${providerMessageRef}:inbound`).slice(0, 16)}`;
    transaction.set(
      ws.collection("messages").doc(inboundMessageId),
      buildLiveMessageDocument({
        messageId: inboundMessageId,
        contactId: ids.contactId,
        conversationId: ids.conversationId,
        message: inboundBridge,
        nowMs,
      }),
      { merge: false },
    );
    if (result.booking) {
      const bookingId = `${result.booking.reference}-${ids.key}`;
      transaction.set(
        ws.collection("canary_bookings").doc(bookingId),
        {
          id: bookingId,
          workspaceId: BRIDGE_WORKSPACE_ID,
          conversationId: ids.conversationId,
          visitorKey: ids.key,
          visitorNumberSha256: sha256Hex(recipient),
          departmentId: result.booking.departmentId,
          dayId: result.booking.dayId,
          slotId: result.booking.slotId,
          language: result.booking.language,
          reference: result.booking.reference,
          selectionsOnly: true,
          containsMessageContent: false,
          canary: true,
          demo: true,
          createdAt: Timestamp.fromMillis(nowMs),
          schemaVersion: 1,
        },
        { merge: false },
      );
    }
    for (const [index, child] of childEffects.entries()) {
      const existing = parseCanaryOutboxRecord(childSnapshots[index]?.data());
      if (childSnapshots[index]?.exists) {
        if (
          !existing ||
          existing.id !== child.id ||
          existing.receiptId !== child.receiptId ||
          existing.effectKind !== child.effectKind
        ) {
          throw new Error("outbox_child_collision");
        }
      } else {
        transaction.create(outbox(db).doc(child.id), child);
      }
    }
    metricWrite(transaction, db, nowMs, {
      bookings: result.booking ? 1 : 0,
      staffHandoffs: result.staffHandoff ? 1 : 0,
    });
    transaction.set(
      effectRef,
      completeCanaryOutboxRecord({ record: current, leaseToken, nowMs }),
      { merge: false },
    );
    return childEffects.map((child) => child.id);
  });
}

async function markDispatchStarted(input: {
  readonly db: Firestore;
  readonly effectId: string;
  readonly leaseToken: string;
  readonly recipient: string;
  readonly nowMs: number;
  readonly templateOutboundId?: string;
  readonly dispatchReplySource?: "ai_transient" | "durable";
  readonly protectedBotContent?: ProtectedBotDispatchContent;
}): Promise<
  | { readonly action: "dispatch"; readonly record: CanaryOutboxRecord }
  | { readonly action: "suppressed"; readonly record: CanaryOutboxRecord }
> {
  return input.db.runTransaction(async (transaction) => {
    const ref = outbox(input.db).doc(input.effectId);
    const snapshot = await transaction.get(ref);
    const current = parseCanaryOutboxRecord(snapshot.data());
    if (!current) throw new Error("invalid_outbox_record");
    if (
      current.effectKind !== "graph_bot_reply" &&
      current.effectKind !== "graph_auto_reply" &&
      current.effectKind !== "graph_template_send"
    ) {
      throw new Error("invalid_graph_effect_kind");
    }
    if (isPublicInboundEffect(current)) {
      const subjectSha256 = requiredString(
        current.payload.recipientSha256,
        /^[0-9a-f]{64}$/,
        "public_subject_sha256",
      );
      const suppressionSnapshot = await transaction.get(
        workspace(input.db)
          .collection(META_CANARY_PUBLIC_SUPPRESSIONS_COLLECTION)
          .doc(subjectSha256),
      );
      if (
        suppressionSnapshot.exists &&
        isActivePublicSuppression(
          suppressionSnapshot.data(),
          subjectSha256,
          input.nowMs,
        )
      ) {
        const completed = completeCanaryOutboxRecord({
          record: current,
          leaseToken: input.leaseToken,
          nowMs: input.nowMs,
          terminalReason: "suppressed",
        });
        transaction.set(ref, completed, { merge: false });
        return { action: "suppressed" as const, record: completed };
      }
      const dispatching = markCanaryOutboxDispatchStarted(
        current,
        input.leaseToken,
        input.nowMs,
        input.dispatchReplySource,
      );
      transaction.set(ref, dispatching, { merge: false });
      return { action: "dispatch" as const, record: dispatching };
    }
    if (
      current.effectKind === "graph_bot_reply" &&
      (
        !input.protectedBotContent ||
        !input.dispatchReplySource ||
        input.protectedBotContent.source !== protectedBotSource(
          input.dispatchReplySource,
        )
      )
    ) {
      throw new Error("protected_bot_content_required");
    }
    if (
      current.effectKind !== "graph_bot_reply" &&
      input.protectedBotContent
    ) {
      throw new Error("protected_bot_content_wrong_effect");
    }
    const ids = liveIds(input.recipient);
    const contactId = ids.contactId;
    const contactRef = workspace(input.db).collection("contacts").doc(contactId);
    const conversationRef = workspace(input.db)
      .collection("conversations")
      .doc(ids.conversationId);
    const protectedContentId = input.protectedBotContent
      ? protectedBotEffectContentId(current.id)
      : null;
    const protectedContentRef = protectedContentId
      ? conversationRef
        .collection(LITE_PROTECTED_MESSAGE_CONTENTS_COLLECTION)
        .doc(protectedContentId)
      : null;
    const [contactSnapshot, conversationSnapshot, protectedContentSnapshot] =
      await Promise.all([
      transaction.get(contactRef),
      transaction.get(conversationRef),
      protectedContentRef
        ? transaction.get(protectedContentRef)
        : Promise.resolve(null),
    ]);
    let suppression = decideCanaryGraphSuppression({
      effectKind: current.effectKind,
      expectedContactId: contactId,
      contact: contactSnapshot.exists ? contactSnapshot.data() : null,
      templatePurpose: current.payload.templatePurpose,
    });
    if (
      suppression.kind === "allow" &&
      (current.effectKind === "graph_bot_reply" ||
        current.effectKind === "graph_auto_reply")
    ) {
      suppression = decideCanaryAutomationConversationSuppression({
        effectKind: current.effectKind,
        expectedConversationId: ids.conversationId,
        conversation: conversationSnapshot.exists ? conversationSnapshot.data() : null,
        currentHandoffReply: current.payload.currentHandoffReply === true,
      });
    }
    if (suppression.kind === "suppress") {
      const completed = completeCanaryOutboxRecord({
        record: current,
        leaseToken: input.leaseToken,
        nowMs: input.nowMs,
        terminalReason: "suppressed",
      });
      transaction.set(ref, completed, { merge: false });
      if (input.templateOutboundId) {
        transaction.set(
          workspace(input.db)
            .collection(META_CANARY_OUTBOUND_COLLECTION)
            .doc(input.templateOutboundId),
          {
            status: "suppressed",
            suppressionReasonCode: suppression.reason,
            providerMessageId: null,
            completedAt: Timestamp.fromMillis(input.nowMs),
            updatedAt: Timestamp.fromMillis(input.nowMs),
          },
          { merge: true },
        );
      }
      return { action: "suppressed" as const, record: completed };
    }
    if (
      protectedContentRef &&
      protectedContentId &&
      protectedContentSnapshot &&
      input.protectedBotContent
    ) {
      if (protectedContentSnapshot.exists) {
        assertReservedProtectedBotContent({
          raw: protectedContentSnapshot.data(),
          id: protectedContentId,
          conversationId: ids.conversationId,
          source: input.protectedBotContent.source,
          nowMs: input.nowMs,
          expectedContent: input.protectedBotContent,
        });
      } else {
        transaction.create(
          protectedContentRef,
          buildProtectedMessageContentDocument({
            id: protectedContentId,
            workspaceId: META_CANARY_WORKSPACE_ID,
            conversationId: ids.conversationId,
            messageId: null,
            direction: "outbound",
            source: input.protectedBotContent.source,
            contentKind: input.protectedBotContent.contentKind,
            text: input.protectedBotContent.text,
            teamId: LITE_TEAM_ID,
            locationId: LITE_LOCATION_ID,
            state: "reserved",
            nowMs: input.nowMs,
            retentionDays:
              process.env[LITE_PROTECTED_MESSAGE_RETENTION_ENV],
          }),
        );
      }
    }
    const dispatching = markCanaryOutboxDispatchStarted(
      current,
      input.leaseToken,
      input.nowMs,
      input.dispatchReplySource,
      protectedContentId
        ? {
          conversationId: ids.conversationId,
          contentId: protectedContentId,
        }
        : undefined,
    );
    transaction.set(ref, dispatching, { merge: false });
    if (input.templateOutboundId) {
      transaction.set(
        workspace(input.db)
          .collection(META_CANARY_OUTBOUND_COLLECTION)
          .doc(input.templateOutboundId),
        {
          status: "processing",
          dispatchStartedAt: Timestamp.fromMillis(input.nowMs),
          updatedAt: Timestamp.fromMillis(input.nowMs),
        },
        { merge: true },
      );
    }
    return { action: "dispatch" as const, record: dispatching };
  });
}

async function completeGraphEffect(input: {
  readonly db: Firestore;
  readonly record: CanaryOutboxRecord;
  readonly leaseToken: string;
  readonly recipient: string;
  readonly nowMs: number;
  readonly providerMessageId: string;
  readonly botPlan?: ReturnType<typeof reconstructBotReply>;
  readonly templateOutboundId?: string;
}): Promise<void> {
  await input.db.runTransaction(async (transaction) => {
    const ws = workspace(input.db);
    const effectRef = outbox(input.db).doc(input.record.id);
    const effectSnapshot = await transaction.get(effectRef);
    const current = parseCanaryOutboxRecord(effectSnapshot.data());
    if (!current) throw new Error("invalid_outbox_record");

    let contactSnapshot: DocumentSnapshot | undefined;
    let conversationSnapshot: DocumentSnapshot | undefined;
    let ids: ReturnType<typeof liveIds> | null = null;
    let protectedContentRef: DocumentReference | null = null;
    let protectedContentSnapshot: DocumentSnapshot | null = null;
    let protectedBotContent: ProtectedBotDispatchContent | null = null;
    if (input.botPlan && !isPublicInboundEffect(current)) {
      if (current.effectKind !== "graph_bot_reply") {
        throw new Error("protected_bot_content_wrong_effect");
      }
      const extracted = extractProtectedOutboundContent(input.botPlan.reply);
      if (!extracted) throw new Error("protected_bot_content_required");
      protectedBotContent = {
        ...extracted,
        source: protectedBotSource(input.botPlan.replySource),
      };
      ids = liveIds(input.recipient);
      const protectedContentId = protectedBotEffectContentId(current.id);
      if (
        current.protectedConversationId !== ids.conversationId ||
        current.protectedContentId !== protectedContentId
      ) {
        throw new Error("protected_bot_reference_invalid");
      }
      protectedContentRef = ws
        .collection("conversations")
        .doc(ids.conversationId)
        .collection(LITE_PROTECTED_MESSAGE_CONTENTS_COLLECTION)
        .doc(protectedContentId);
      [contactSnapshot, conversationSnapshot, protectedContentSnapshot] =
        await Promise.all([
        transaction.get(ws.collection("contacts").doc(ids.contactId)),
        transaction.get(ws.collection("conversations").doc(ids.conversationId)),
        transaction.get(protectedContentRef),
      ]);
      if (!protectedContentSnapshot.exists) {
        throw new Error("protected_bot_content_missing");
      }
      assertReservedProtectedBotContent({
        raw: protectedContentSnapshot.data(),
        id: protectedContentId,
        conversationId: ids.conversationId,
        source: protectedBotContent.source,
        nowMs: input.nowMs,
        expectedContent: protectedBotContent,
      });
    }
    const routeTarget = input.templateOutboundId
      ? { targetKind: "manual_template" as const, targetId: input.templateOutboundId }
      : { targetKind: "meta_outbox_effect" as const, targetId: current.id };
    const providerRouteRef = ws
      .collection(META_CANARY_PROVIDER_ROUTES_COLLECTION)
      .doc(canaryProviderRouteId(input.providerMessageId, sha256Hex));
    const providerRouteSnapshot = await transaction.get(providerRouteRef);
    const routeEvidence = buildCanaryProviderRouteEvidence({
      providerMessageId: input.providerMessageId,
      ...routeTarget,
      sha256Hex,
    });
    {
      const existingRoute = asRecord(providerRouteSnapshot.data());
      if (providerRouteSnapshot.exists) {
        const resolvedRoute = resolveCanaryProviderRoute({
          route: existingRoute,
          providerMessageId: input.providerMessageId,
          sha256Hex,
        });
        if (
          !existingRoute ||
          resolvedRoute?.targetKind !== routeTarget.targetKind ||
          resolvedRoute.targetId !== routeTarget.targetId
        ) {
          throw new Error("provider_route_collision");
        }
      } else {
        const publicRouteExpiresAtMs =
          input.nowMs + META_CANARY_PUBLIC_JOURNAL_TTL_MS;
        transaction.create(providerRouteRef, {
          ...routeEvidence,
          createdAt: Timestamp.fromMillis(input.nowMs),
          updatedAt: Timestamp.fromMillis(input.nowMs),
          ...(isPublicInboundEffect(current)
            ? {
              publicInboundTest: true,
              expiresAtMs: publicRouteExpiresAtMs,
              expireAt: Timestamp.fromMillis(publicRouteExpiresAtMs),
            }
            : {}),
        });
      }
    }

    transaction.set(
      effectRef,
      completeCanaryOutboxRecord({
        record: current,
        leaseToken: input.leaseToken,
        nowMs: input.nowMs,
        providerMessageId: input.providerMessageId,
      }),
      { merge: false },
    );
    if (input.templateOutboundId) {
      transaction.set(
        ws.collection(META_CANARY_OUTBOUND_COLLECTION).doc(input.templateOutboundId),
        {
          status: "sent",
          deliveryStatus: "sent",
          providerMessageId: input.providerMessageId,
          providerStatus: 200,
          completedAt: Timestamp.fromMillis(input.nowMs),
          updatedAt: Timestamp.fromMillis(input.nowMs),
        },
        { merge: true },
      );
    }
    if (input.botPlan && ids && contactSnapshot && conversationSnapshot) {
      const existingContact = contactSnapshot.data();
      const existingConversation = conversationSnapshot.data();
      const message = {
        direction: "outbound" as const,
        waMessageId: canaryOutboundBridgeMessageRef(
          input.providerMessageId,
          input.botPlan.inboundProviderRef,
          input.botPlan.replyIndex,
        ),
        messageType: input.botPlan.replyType,
        language: input.botPlan.language,
        purpose: input.botPlan.purpose,
        staffHandoff: input.botPlan.staffHandoff,
        last4: input.recipient.slice(-4),
        automationSource: input.botPlan.replySource === "ai_transient"
          ? "governed_ai" as const
          : "menu_bot" as const,
      };
      transaction.set(
        ws.collection("contacts").doc(ids.contactId),
        buildLiveContactDocument({
          contactId: ids.contactId,
          last4: input.recipient.slice(-4),
          language: input.botPlan.language ?? "en",
          nowMs: input.nowMs,
          ...(contactSnapshot.exists && existingContact ? { existing: existingContact } : {}),
          ...(input.botPlan.staffHandoff ? { addTags: ["human-handoff"] } : {}),
        }),
        { merge: false },
      );
      transaction.set(
        ws.collection("conversations").doc(ids.conversationId),
        preserveCanaryOutboundConversationState({
          expectedConversationId: ids.conversationId,
          existingConversation,
          builtConversation: buildLiveConversationDocument({
            contactId: ids.contactId,
            conversationId: ids.conversationId,
            message,
            nowMs: input.nowMs,
            ...(conversationSnapshot.exists && existingConversation
              ? { existing: existingConversation }
              : {}),
          }),
        }),
        { merge: false },
      );
      const messageId = `message_live_${sha256Hex(`${message.waMessageId}:outbound`).slice(0, 16)}`;
      if (protectedContentRef && protectedBotContent) {
        transaction.set(
          protectedContentRef,
          {
            messageId,
            state: "materialized",
            updatedAt: Timestamp.fromMillis(input.nowMs),
          },
          { merge: true },
        );
      }
      transaction.set(
        ws.collection("messages").doc(messageId),
        buildLiveMessageDocument({
          messageId,
          contactId: ids.contactId,
          conversationId: ids.conversationId,
          message,
          nowMs: input.nowMs,
        }),
        { merge: false },
      );
      metricWrite(transaction, input.db, input.nowMs, { botReplies: 1 });
    }
  });
}

export type CanaryFatalGraphResolutionResult = {
  readonly resolved: true;
  readonly effectId: string;
  readonly effectKind:
    | "graph_bot_reply"
    | "graph_auto_reply"
    | "graph_template_send";
  readonly outcome: "confirmed_sent" | "confirmed_not_sent";
  readonly providerMessageId: string | null;
  readonly canary: true;
  readonly idempotent: boolean;
  readonly containsMessageContent: false;
};

/** Evidence-only fatal resolution. This function has no provider-send path. */
export async function reconcileFatalCanaryGraphEffect(input: {
  readonly db: Firestore;
  readonly resolution: CanaryFatalResolutionInput;
  readonly actorUid: string;
  readonly nowMs?: number;
  readonly returnRouteAssetSha256?: string;
  readonly publicInboundRoute?: CanaryPublicInboundRouteConfig;
}): Promise<CanaryFatalGraphResolutionResult> {
  const nowMs = input.nowMs ?? Date.now();
  const expectedAudit = buildCanaryFatalResolutionAudit({
    resolution: input.resolution,
    actorUid: input.actorUid,
    sha256Hex,
  });
  return input.db.runTransaction(async (transaction) => {
    const ws = workspace(input.db);
    const effectRef = outbox(input.db).doc(input.resolution.effectId);
    const auditRef = ws
      .collection(META_CANARY_FATAL_RECONCILIATIONS_COLLECTION)
      .doc(expectedAudit.id);
    const [effectSnapshot, auditSnapshot] = await Promise.all([
      transaction.get(effectRef),
      transaction.get(auditRef),
    ]);
    const decision = decideCanaryFatalResolution({
      rawEffect: effectSnapshot.data(),
      rawAudit: auditSnapshot.exists ? auditSnapshot.data() : undefined,
      resolution: input.resolution,
      expectedAudit,
    });
    if (decision.kind === "replay") {
      return {
        resolved: true as const,
        effectId: input.resolution.effectId,
        effectKind: input.resolution.effectKind,
        outcome: input.resolution.outcome,
        providerMessageId: input.resolution.providerMessageId,
        canary: true as const,
        idempotent: true,
        containsMessageContent: false as const,
      };
    }

    const effect = decision.effect;
    const confirmedSent = input.resolution.outcome === "confirmed_sent";
    const providerMessageId = input.resolution.providerMessageId;
    const templateOutboundId = effect.effectKind === "graph_template_send"
      ? requiredString(effect.payload.outboundId, /^manual_[0-9a-f]{32}$/, "outbound_id")
      : null;

    let outboundRef: DocumentReference | null = null;
    let outboundSnapshot: DocumentSnapshot | null = null;
    if (templateOutboundId) {
      outboundRef = ws.collection(META_CANARY_OUTBOUND_COLLECTION).doc(templateOutboundId);
      outboundSnapshot = await transaction.get(outboundRef);
      const outbound = asRecord(outboundSnapshot.data());
      if (
        !outboundSnapshot.exists ||
        !outbound ||
        outbound.id !== templateOutboundId ||
        outbound.workspaceId !== META_CANARY_WORKSPACE_ID ||
        outbound.outboxEffectId !== effect.id ||
        outbound.requestSha256 !== effect.payload.requestSha256 ||
        outbound.status !== "uncertain" ||
        outbound.containsMessageContent !== false ||
        outbound.containsFullRecipient !== false
      ) {
        throw new Error("fatal_template_target_is_not_uncertain");
      }
    }

    let routeRef: DocumentReference | null = null;
    let routeSnapshot: DocumentSnapshot | null = null;
    let routeEvidence: ReturnType<typeof buildCanaryProviderRouteEvidence> | null = null;
    if (confirmedSent && providerMessageId) {
      routeEvidence = buildCanaryProviderRouteEvidence({
        providerMessageId,
        targetKind: templateOutboundId ? "manual_template" : "meta_outbox_effect",
        targetId: templateOutboundId ?? effect.id,
        sha256Hex,
      });
      routeRef = ws
        .collection(META_CANARY_PROVIDER_ROUTES_COLLECTION)
        .doc(routeEvidence.id);
      routeSnapshot = await transaction.get(routeRef);
      if (routeSnapshot.exists) {
        const routed = resolveCanaryProviderRoute({
          route: routeSnapshot.data(),
          providerMessageId,
          sha256Hex,
        });
        if (
          routed?.targetKind !== routeEvidence.targetKind ||
          routed.targetId !== routeEvidence.targetId
        ) {
          throw new Error("fatal_resolution_provider_route_collision");
        }
      }
    }

    let botRecipient: string | null = null;
    let botPlan: ReturnType<typeof reconstructBotReply> | null = null;
    let botIds: ReturnType<typeof liveIds> | null = null;
    let contactSnapshot: DocumentSnapshot | null = null;
    let conversationSnapshot: DocumentSnapshot | null = null;
    let messageRef: DocumentReference | null = null;
    let messageSnapshot: DocumentSnapshot | null = null;
    let protectedContentRef: DocumentReference | null = null;
    let protectedContentSnapshot: DocumentSnapshot | null = null;
    let protectedConversationId: string | null = null;
    let protectedContentExpired = false;
    if (effect.effectKind === "graph_bot_reply") {
      if (
        effect.payload.replySource === "ai_transient" &&
        effect.dispatchReplySource === undefined
      ) {
        throw new Error("fatal_resolution_ai_reply_source_unknown");
      }
      const reconstructed = reconstructBotReply(effect);
      if (isPublicInboundEffect(effect)) {
        // Public test effects never create portal contact/conversation records.
        // Provider evidence can therefore be committed without decrypting an
        // expired route or retaining a plaintext destination.
        botPlan = null;
      } else {
        const persistedProtectedConversationId = effect.protectedConversationId;
        const persistedProtectedContentId = effect.protectedContentId;
        if (
          (persistedProtectedConversationId === undefined) !==
            (persistedProtectedContentId === undefined)
        ) {
          throw new Error("fatal_resolution_protected_reference_invalid");
        }
        if (
          persistedProtectedConversationId &&
          persistedProtectedContentId
        ) {
          if (
            persistedProtectedContentId !==
              protectedBotEffectContentId(effect.id)
          ) {
            throw new Error("fatal_resolution_protected_reference_invalid");
          }
          protectedConversationId = persistedProtectedConversationId;
          protectedContentRef = ws
            .collection("conversations")
            .doc(persistedProtectedConversationId)
            .collection(LITE_PROTECTED_MESSAGE_CONTENTS_COLLECTION)
            .doc(persistedProtectedContentId);
        }
        botRecipient = await recipientFor(
          input.db,
          effect,
          "",
          input.publicInboundRoute,
          nowMs,
          transaction,
          input.returnRouteAssetSha256,
        );
        if (!botRecipient) {
          if (confirmedSent) {
            throw new Error("fatal_resolution_recipient_unavailable");
          }
        } else {
          botIds = liveIds(botRecipient);
          const conversationRef = ws
            .collection("conversations")
            .doc(botIds.conversationId);
          const protectedContentId = protectedBotEffectContentId(effect.id);
          if (
            protectedContentRef &&
            (protectedConversationId !== botIds.conversationId ||
              persistedProtectedContentId !== protectedContentId)
          ) {
            throw new Error("fatal_resolution_protected_reference_mismatch");
          }
          protectedConversationId = botIds.conversationId;
          protectedContentRef ??= conversationRef
            .collection(LITE_PROTECTED_MESSAGE_CONTENTS_COLLECTION)
            .doc(protectedContentId);

          if (confirmedSent && providerMessageId) {
            botPlan = effect.dispatchReplySource === "ai_transient"
              ? { ...reconstructed, replyType: "text", replySource: "ai_transient" }
              : reconstructed;
            const contactRef = ws.collection("contacts").doc(botIds.contactId);
            const outboundMessageRef = canaryOutboundBridgeMessageRef(
              providerMessageId,
              botPlan.inboundProviderRef,
              botPlan.replyIndex,
            );
            const messageId =
              `message_live_${sha256Hex(`${outboundMessageRef}:outbound`).slice(0, 16)}`;
            messageRef = ws.collection("messages").doc(messageId);
            [
              contactSnapshot,
              conversationSnapshot,
              messageSnapshot,
              protectedContentSnapshot,
            ] = await Promise.all([
              transaction.get(contactRef),
              transaction.get(conversationRef),
              transaction.get(messageRef),
              transaction.get(protectedContentRef),
            ]);
            if (messageSnapshot.exists) {
              throw new Error("fatal_resolution_bridge_message_collision");
            }
          }
        }

        if (!confirmedSent && protectedContentRef) {
          protectedContentSnapshot = await transaction.get(protectedContentRef);
        }

        if (
          protectedContentSnapshot?.exists &&
          protectedConversationId &&
          protectedContentRef
        ) {
          const expectedContent = effect.dispatchReplySource === "ai_transient"
            ? undefined
            : extractProtectedOutboundContent(reconstructed.reply) ?? undefined;
          const validation = assertReservedProtectedBotContent({
            raw: protectedContentSnapshot.data(),
            id: protectedContentRef.id,
            conversationId: protectedConversationId,
            source: effect.dispatchReplySource === "ai_transient"
              ? "governed_ai"
              : "menu_bot",
            nowMs,
            allowExpired: true,
            ...(expectedContent ? { expectedContent } : {}),
          });
          protectedContentExpired = validation.expired;
        }
      }
    }

    const reconciledEffect = reconcileCanaryFatalOutboxRecord({
      effect,
      resolution: input.resolution,
      audit: expectedAudit,
      nowMs,
    });
    transaction.set(effectRef, reconciledEffect, { merge: false });
    transaction.create(auditRef, {
      ...expectedAudit,
      createdAt: Timestamp.fromMillis(nowMs),
      updatedAt: Timestamp.fromMillis(nowMs),
    });

    if (routeRef && routeSnapshot && routeEvidence && !routeSnapshot.exists) {
      const publicRouteExpiresAtMs = nowMs + META_CANARY_PUBLIC_JOURNAL_TTL_MS;
      transaction.create(routeRef, {
        ...routeEvidence,
        createdAt: Timestamp.fromMillis(nowMs),
        updatedAt: Timestamp.fromMillis(nowMs),
        ...(isPublicInboundEffect(effect)
          ? {
            publicInboundTest: true,
            expiresAtMs: publicRouteExpiresAtMs,
            expireAt: Timestamp.fromMillis(publicRouteExpiresAtMs),
          }
          : {}),
      });
    }
    if (outboundRef && templateOutboundId) {
      transaction.set(
        outboundRef,
        {
          status: confirmedSent ? "sent" : "not_sent",
          ...(confirmedSent ? { deliveryStatus: "sent" } : {}),
          ...(!confirmedSent
            ? { failureReasonCode: "provider_evidence_confirmed_not_sent" }
            : {}),
          providerMessageId,
          providerStatus: null,
          reconciliationId: expectedAudit.id,
          reconciliationOutcome: input.resolution.outcome,
          reconciliationRequestSha256: input.resolution.requestSha256,
          reconciliationEvidenceSha256: input.resolution.providerEvidenceSha256,
          reconciledAt: Timestamp.fromMillis(nowMs),
          completedAt: Timestamp.fromMillis(nowMs),
          updatedAt: Timestamp.fromMillis(nowMs),
        },
        { merge: true },
      );
    }

    if (protectedContentRef && protectedContentSnapshot?.exists) {
      if (protectedContentExpired) {
        // TTL deletion is asynchronous. Treat expired text as unavailable now
        // so provider-evidence reconciliation is deterministic either side of
        // the background TTL sweep.
        transaction.delete(protectedContentRef);
      } else if (!confirmedSent) {
        transaction.set(
          protectedContentRef,
          {
            messageId: null,
            state: "not_sent",
            updatedAt: Timestamp.fromMillis(nowMs),
          },
          { merge: true },
        );
      }
    }

    if (
      confirmedSent &&
      providerMessageId &&
      botRecipient &&
      botPlan &&
      botIds &&
      contactSnapshot &&
      conversationSnapshot &&
      messageRef
    ) {
      const existingContact = contactSnapshot.data();
      const existingConversation = conversationSnapshot.data();
      const message = {
        direction: "outbound" as const,
        waMessageId: canaryOutboundBridgeMessageRef(
          providerMessageId,
          botPlan.inboundProviderRef,
          botPlan.replyIndex,
        ),
        messageType: botPlan.replyType,
        language: botPlan.language,
        purpose: botPlan.purpose,
        staffHandoff: botPlan.staffHandoff,
        last4: botRecipient.slice(-4),
        automationSource: botPlan.replySource === "ai_transient"
          ? "governed_ai" as const
          : "menu_bot" as const,
      };
      transaction.set(
        ws.collection("contacts").doc(botIds.contactId),
        buildLiveContactDocument({
          contactId: botIds.contactId,
          last4: botRecipient.slice(-4),
          language: botPlan.language ?? "en",
          nowMs,
          ...(contactSnapshot.exists && existingContact ? { existing: existingContact } : {}),
          ...(botPlan.staffHandoff ? { addTags: ["human-handoff"] } : {}),
        }),
        { merge: false },
      );
      transaction.set(
        ws.collection("conversations").doc(botIds.conversationId),
        preserveCanaryOutboundConversationState({
          expectedConversationId: botIds.conversationId,
          existingConversation,
          builtConversation: buildLiveConversationDocument({
            contactId: botIds.contactId,
            conversationId: botIds.conversationId,
            message,
            nowMs,
            ...(conversationSnapshot.exists && existingConversation
              ? { existing: existingConversation }
              : {}),
          }),
        }),
        { merge: false },
      );
      transaction.create(
        messageRef,
        buildLiveMessageDocument({
          messageId: messageRef.id,
          contactId: botIds.contactId,
          conversationId: botIds.conversationId,
          message,
          nowMs,
        }),
      );
      if (
        protectedContentRef &&
        protectedContentSnapshot?.exists &&
        !protectedContentExpired
      ) {
        transaction.set(
          protectedContentRef,
          {
            messageId: messageRef.id,
            state: "materialized",
            updatedAt: Timestamp.fromMillis(nowMs),
          },
          { merge: true },
        );
      }
      metricWrite(transaction, input.db, nowMs, { botReplies: 1 });
    }

    return {
      resolved: true as const,
      effectId: input.resolution.effectId,
      effectKind: input.resolution.effectKind,
      outcome: input.resolution.outcome,
      providerMessageId: input.resolution.providerMessageId,
      canary: true as const,
      idempotent: false,
      containsMessageContent: false as const,
    };
  });
}

async function processGraphEffect(input: {
  readonly db: Firestore;
  readonly claimed: CanaryOutboxRecord;
  readonly leaseToken: string;
  readonly recipient: string;
  readonly phoneNumberId: string;
  readonly accessToken: string;
  readonly nowMs: number;
  readonly transientBotOverride?: CanaryTransientBotOverride;
}): Promise<"sent" | "suppressed"> {
  let body: Record<string, unknown>;
  let botPlan: ReturnType<typeof reconstructBotReply> | undefined;
  let templateOutboundId: string | undefined;
  if (input.claimed.effectKind === "graph_bot_reply") {
    botPlan = reconstructBotReply(input.claimed, input.transientBotOverride);
    body = botPlan.reply;
  } else if (input.claimed.effectKind === "graph_auto_reply") {
    body = isPublicInboundEffect(input.claimed)
      ? PUBLIC_TEST_NOTICE_REPLY
      : { type: "text", text: { preview_url: false, body: AUTO_REPLY_TEXT } };
  } else if (input.claimed.effectKind === "graph_template_send") {
    templateOutboundId = requiredString(
      input.claimed.payload.outboundId,
      /^manual_[0-9a-f]{32}$/,
      "outbound_id",
    );
    const templateName = requiredString(
      input.claimed.payload.templateName,
      /^[a-z0-9_]{1,120}$/,
      "template_name",
    );
    const languageCode = requiredString(
      input.claimed.payload.languageCode,
      /^[A-Za-z_]{2,10}$/,
      "language_code",
    );
    const full = buildCanaryTemplateSendBody({
      to: input.recipient,
      templateName,
      languageCode,
    });
    body = {
      type: full.type,
      template: full.template,
    };
  } else {
    throw new Error("invalid_graph_effect_kind");
  }

  let protectedBotContent: ProtectedBotDispatchContent | undefined;
  if (botPlan && !isPublicInboundEffect(input.claimed)) {
    const extracted = extractProtectedOutboundContent(body);
    if (!extracted) throw new Error("protected_bot_content_required");
    protectedBotContent = {
      ...extracted,
      source: protectedBotSource(botPlan.replySource),
    };
  }

  const dispatch = await markDispatchStarted({
    db: input.db,
    effectId: input.claimed.id,
    leaseToken: input.leaseToken,
    recipient: input.recipient,
    nowMs: input.nowMs,
    ...(templateOutboundId ? { templateOutboundId } : {}),
    ...(botPlan ? { dispatchReplySource: botPlan.replySource } : {}),
    ...(protectedBotContent ? { protectedBotContent } : {}),
  });
  if (dispatch.action === "suppressed") return "suppressed";
  const sent = await sendGraphMessage(
    input.phoneNumberId,
    input.accessToken,
    input.recipient,
    body,
  );
  const providerMessageId = assertCanaryProviderMessageId(sent.providerMessageId);
  await completeGraphEffect({
    db: input.db,
    record: input.claimed,
    leaseToken: input.leaseToken,
    recipient: input.recipient,
    nowMs: Date.now(),
    providerMessageId,
    ...(botPlan ? { botPlan } : {}),
    ...(templateOutboundId ? { templateOutboundId } : {}),
  });
  return "sent";
}

export async function processCanaryOutboxEffect(input: {
  readonly db: Firestore;
  readonly effectId: string;
  readonly leaseOwner: LeaseOwner;
  readonly phoneNumberId: string;
  readonly accessToken: string;
  readonly nowMs?: number;
  readonly transientBotOverrides?: readonly CanaryTransientBotOverride[];
  readonly publicInboundRoute?: CanaryPublicInboundRouteConfig;
}): Promise<CanaryOutboxProcessResult> {
  const nowMs = input.nowMs ?? Date.now();
  const claimed = await claimEffect(input.db, input.effectId, input.leaseOwner, nowMs);
  if (claimed.action === "noop") {
    return {
      disposition: claimed.record.state === "terminal"
        ? claimed.record.terminalReason === "suppressed"
          ? "suppressed"
          : "terminal"
        : claimed.record.state === "fatal"
          ? "fatal"
          : "deferred",
      childEffectIds: [],
    };
  }
  if (claimed.action === "fatalized") {
    return { disposition: "fatal", childEffectIds: [] };
  }

  const { record, leaseToken } = claimed;
  const transientBotOverride = input.transientBotOverrides?.find(
    (candidate) => candidate.receiptId === record.receiptId,
  );
  try {
    if (record.effectKind === "inbound_metric") {
      await processInboundMetric(input.db, record, leaseToken, nowMs);
      return { disposition: "terminal", childEffectIds: [] };
    }
    if (record.effectKind === "campaign_status") {
      await processCampaignStatus(input.db, record, leaseToken, nowMs);
      return { disposition: "terminal", childEffectIds: [] };
    }
    if (record.effectKind === "bot_plan") {
      const recipient = await recipientFor(
        input.db,
        record,
        input.phoneNumberId,
        input.publicInboundRoute,
        nowMs,
      );
      if (!recipient) throw new Error("recipient_unavailable");
      const childEffectIds = await processBotPlan(
        input.db,
        record,
        leaseToken,
        recipient,
        nowMs,
        transientBotOverride,
      );
      return { disposition: "terminal", childEffectIds };
    }
    if (
      record.effectKind === "graph_bot_reply" ||
      record.effectKind === "graph_auto_reply" ||
      record.effectKind === "graph_template_send"
    ) {
      const recipient = record.effectKind === "graph_template_send"
        ? allowlistedRecipientFor(record)
        : await recipientFor(
            input.db,
            record,
            input.phoneNumberId,
            input.publicInboundRoute,
            nowMs,
          );
      if (!recipient) throw new Error("recipient_unavailable");
      if (!/^\d{5,32}$/.test(input.phoneNumberId) || input.accessToken.length === 0) {
        throw new Error("provider_configuration_unavailable");
      }
      const graphResult = await processGraphEffect({
        db: input.db,
        claimed: record,
        leaseToken,
        recipient,
        phoneNumberId: input.phoneNumberId,
        accessToken: input.accessToken,
        nowMs,
        ...(transientBotOverride ? { transientBotOverride } : {}),
      });
      return {
        disposition: graphResult === "suppressed" ? "suppressed" : "terminal",
        childEffectIds: [],
      };
    }
    throw new Error("unsupported_effect_kind");
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (
      record.effectKind === "campaign_status" &&
      record.attempts >= record.maxAttempts &&
      (message === "provider_status_target_not_materialized" ||
        message === "invalid_provider_status_route")
    ) {
      try {
        await completeUnsupportedStatusTarget({
          db: input.db,
          effectId: record.id,
          leaseToken,
          nowMs: Date.now(),
        });
        return { disposition: "terminal", childEffectIds: [] };
      } catch {
        // Fall through to the ordinary fatal path if terminal evidence cannot commit.
      }
    }
    const afterDispatch = await outbox(input.db).doc(record.id).get()
      .then((snapshot) => parseCanaryOutboxRecord(snapshot.data())?.dispatchStartedAtMs !== null)
      .catch(() => false);
    const templateOutboundId = record.effectKind === "graph_template_send" &&
        typeof record.payload.outboundId === "string"
      ? record.payload.outboundId
      : undefined;
    const disposition = await failClaimedEffect({
      db: input.db,
      effectId: record.id,
      leaseToken,
      nowMs: Date.now(),
      errorCode: message,
      safeToRetry: !afterDispatch,
      ...(templateOutboundId ? { templateOutboundId } : {}),
    }).catch(() => "fatal" as const);
    return { disposition, childEffectIds: [] };
  }
}

export async function processCanaryOutboxBatch(input: {
  readonly db: Firestore;
  readonly effectIds: readonly string[];
  readonly leaseOwner: LeaseOwner;
  readonly phoneNumberId: string;
  readonly accessToken: string;
  readonly maxEffects?: number;
  readonly transientBotOverrides?: readonly CanaryTransientBotOverride[];
  readonly publicInboundRoute?: CanaryPublicInboundRouteConfig;
}): Promise<CanaryOutboxBatchResult> {
  const maxEffects = Math.max(
    1,
    Math.min(META_CANARY_OUTBOX_MAX_BATCH, input.maxEffects ?? META_CANARY_OUTBOX_MAX_BATCH),
  );
  const queue = [...new Set(input.effectIds)];
  const seen = new Set(queue);
  const counts = {
    attempted: 0,
    terminal: 0,
    suppressed: 0,
    retryable: 0,
    fatal: 0,
    deferred: 0,
  };
  for (
    let index = 0;
    index < queue.length && counts.attempted < maxEffects;
    index += 1
  ) {
    const effectId = queue[index];
    if (!effectId) continue;
    const result = await processCanaryOutboxEffect({
      db: input.db,
      effectId,
      leaseOwner: input.leaseOwner,
      phoneNumberId: input.phoneNumberId,
      accessToken: input.accessToken,
      ...(input.transientBotOverrides
        ? { transientBotOverrides: input.transientBotOverrides }
        : {}),
      ...(input.publicInboundRoute
        ? { publicInboundRoute: input.publicInboundRoute }
        : {}),
    });
    counts.attempted += 1;
    counts[result.disposition] += 1;
    insertCanaryOutboxChildEffects(queue, seen, index, result.childEffectIds);
  }
  return counts;
}

export async function reconcileDueCanaryOutbox(input: {
  readonly db: Firestore;
  readonly phoneNumberId: string;
  readonly accessToken: string;
  readonly nowMs?: number;
  readonly publicInboundRoute?: CanaryPublicInboundRouteConfig;
}): Promise<CanaryOutboxBatchResult> {
  const nowMs = input.nowMs ?? Date.now();
  // `dueAtMs` is absent on terminal/fatal records, so this automatic
  // single-field-index query cannot be crowded out by future leases or done
  // work. No composite index or post-limit due filtering is required.
  const snapshot = await outbox(input.db)
    .where("dueAtMs", "<=", nowMs)
    .orderBy("dueAtMs", "asc")
    .limit(META_CANARY_OUTBOX_MAX_BATCH)
    .get();
  const candidates = selectDueCanaryOutboxRecords(
    snapshot.docs
      .map((document) => parseCanaryOutboxRecord(document.data()))
      .filter((record): record is CanaryOutboxRecord => record !== null),
    nowMs,
  );
  return processCanaryOutboxBatch({
    db: input.db,
    effectIds: candidates.map((record) => record.id),
    leaseOwner: "admin_reconciler",
    phoneNumberId: input.phoneNumberId,
    accessToken: input.accessToken,
    ...(input.publicInboundRoute
      ? { publicInboundRoute: input.publicInboundRoute }
      : {}),
  });
}
