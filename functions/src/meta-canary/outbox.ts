import type {
  CanaryBotMessage,
  CanaryInboundRecord,
  CanaryMarketingOptOut,
} from "./contracts.js";
import {
  META_CANARY_DEFAULT_TEMPLATE,
  META_CANARY_MAX_WEBHOOK_EVENTS,
  META_CANARY_WORKSPACE_ID,
} from "./contracts.js";

/** Durable, content-free effect journal for Meta webhook and manual sends. */
export const META_CANARY_OUTBOX_COLLECTION = "canary_webhook_outbox" as const;
export const META_CANARY_PROVIDER_ROUTES_COLLECTION =
  "canary_provider_message_routes" as const;
export const META_CANARY_FATAL_RECONCILIATIONS_COLLECTION =
  "canary_outbox_reconciliations" as const;
export const META_CANARY_OUTBOX_MAX_ATTEMPTS = 5;
export const META_CANARY_OUTBOX_LEASE_MS = 30_000;
export const META_CANARY_OUTBOX_MAX_BATCH = 20;
/** Physical-retention horizon for public-test receipts and effect journals. */
export const META_CANARY_PUBLIC_JOURNAL_TTL_MS =
  30 * 24 * 60 * 60 * 1_000;
export const META_CANARY_MAX_INITIAL_OUTBOX_EFFECTS =
  META_CANARY_MAX_WEBHOOK_EVENTS * 2;

export type CanaryOutboxState =
  | "pending"
  | "processing"
  | "retryable"
  | "terminal"
  | "fatal";

export type CanaryOutboxEffectKind =
  | "inbound_metric"
  | "campaign_status"
  | "stop_suppression"
  | "bot_plan"
  | "graph_bot_reply"
  | "graph_auto_reply"
  | "graph_template_send";

export type CanaryOutboxRecord = {
  readonly id: string;
  readonly workspaceId: typeof META_CANARY_WORKSPACE_ID;
  readonly receiptId: string;
  readonly effectKind: CanaryOutboxEffectKind;
  readonly state: CanaryOutboxState;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly nextAttemptAtMs: number;
  /** Present only while work is runnable; omitted for terminal/fatal records. */
  readonly dueAtMs?: number;
  readonly leaseToken: string | null;
  readonly leaseOwner: "http_webhook" | "admin_reconciler" | null;
  readonly leaseExpiresAtMs: number | null;
  readonly dispatchStartedAtMs: number | null;
  readonly dispatchReplySource?: "ai_transient" | "durable";
  /** Opaque backend-only locator for a private bot reply reservation. */
  readonly protectedConversationId?: string;
  readonly protectedContentId?: string;
  readonly completedAtMs: number | null;
  readonly terminalReason:
    | "completed"
    | "suppressed"
    | "not_sent"
    | "unsupported_status_target"
    | "reconciled_sent"
    | "reconciled_not_sent"
    | null;
  readonly lastErrorCode: string | null;
  readonly resultProviderMessageId: string | null;
  readonly reconciliationId?: string;
  readonly reconciliationRequestSha256?: string;
  readonly reconciliationOutcome?: "confirmed_sent" | "confirmed_not_sent";
  readonly reconciliationEvidenceSha256?: string;
  readonly reconciledByUidSha256?: string;
  readonly reconciledAtMs?: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly containsMessageContent: false;
  readonly containsFullSender: false;
  readonly schemaVersion: 3;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
};

export type CanaryOutboxClaimResult =
  | { readonly action: "claimed"; readonly record: CanaryOutboxRecord }
  | { readonly action: "fatalized"; readonly record: CanaryOutboxRecord }
  | { readonly action: "noop"; readonly record: CanaryOutboxRecord };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isSafeInteger(value: unknown, min = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min;
}

function safeErrorCode(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_:-]/g, "_").slice(0, 64);
  return normalized || "unknown";
}

export function canaryOutboxEffectId(
  receiptId: string,
  effectKind: CanaryOutboxEffectKind,
  discriminator: string,
  sha256Hex: (value: string) => string,
): string {
  return `fx_${sha256Hex(
    `meta-canary-outbox:v1:${receiptId}:${effectKind}:${discriminator}`,
  ).slice(0, 40)}`;
}

export function buildCanaryOutboxRecord(input: {
  readonly id: string;
  readonly receiptId: string;
  readonly effectKind: CanaryOutboxEffectKind;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly nowMs: number;
  readonly state?: "pending" | "terminal";
}): CanaryOutboxRecord {
  const state = input.state ?? "pending";
  return {
    id: input.id,
    workspaceId: META_CANARY_WORKSPACE_ID,
    receiptId: input.receiptId,
    effectKind: input.effectKind,
    state,
    attempts: 0,
    maxAttempts: META_CANARY_OUTBOX_MAX_ATTEMPTS,
    nextAttemptAtMs: input.nowMs,
    ...(state === "pending" ? { dueAtMs: input.nowMs } : {}),
    leaseToken: null,
    leaseOwner: null,
    leaseExpiresAtMs: null,
    dispatchStartedAtMs: null,
    completedAtMs: state === "terminal" ? input.nowMs : null,
    terminalReason: state === "terminal" ? "completed" : null,
    lastErrorCode: null,
    resultProviderMessageId: null,
    payload: input.payload,
    containsMessageContent: false,
    containsFullSender: false,
    schemaVersion: 3,
    createdAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
  };
}

export function parseCanaryOutboxRecord(value: unknown): CanaryOutboxRecord | null {
  const data = asRecord(value);
  const payload = asRecord(data?.payload);
  const states: readonly CanaryOutboxState[] = [
    "pending",
    "processing",
    "retryable",
    "terminal",
    "fatal",
  ];
  const kinds: readonly CanaryOutboxEffectKind[] = [
    "inbound_metric",
    "campaign_status",
    "stop_suppression",
    "bot_plan",
    "graph_bot_reply",
    "graph_auto_reply",
    "graph_template_send",
  ];
  if (
    !data ||
    !payload ||
    typeof data.id !== "string" ||
    !/^fx_[0-9a-f]{8,64}$/.test(data.id) ||
    data.workspaceId !== META_CANARY_WORKSPACE_ID ||
    typeof data.receiptId !== "string" ||
    data.receiptId.length < 4 ||
    data.receiptId.length > 160 ||
    typeof data.effectKind !== "string" ||
    !kinds.includes(data.effectKind as CanaryOutboxEffectKind) ||
    typeof data.state !== "string" ||
    !states.includes(data.state as CanaryOutboxState) ||
    !isSafeInteger(data.attempts) ||
    !isSafeInteger(data.maxAttempts, 1) ||
    data.maxAttempts > META_CANARY_OUTBOX_MAX_ATTEMPTS ||
    !isSafeInteger(data.nextAttemptAtMs) ||
    (data.dueAtMs !== undefined && !isSafeInteger(data.dueAtMs)) ||
    (data.leaseToken !== null && typeof data.leaseToken !== "string") ||
    (data.leaseOwner !== null &&
      data.leaseOwner !== "http_webhook" &&
      data.leaseOwner !== "admin_reconciler") ||
    (data.leaseExpiresAtMs !== null && !isSafeInteger(data.leaseExpiresAtMs)) ||
    (data.dispatchStartedAtMs !== null && !isSafeInteger(data.dispatchStartedAtMs)) ||
    (data.dispatchReplySource !== undefined &&
      data.dispatchReplySource !== "ai_transient" &&
      data.dispatchReplySource !== "durable") ||
    (data.protectedConversationId !== undefined &&
      (typeof data.protectedConversationId !== "string" ||
        !/^conversation_live_[0-9a-f]{10}$/.test(data.protectedConversationId))) ||
    (data.protectedContentId !== undefined &&
      (typeof data.protectedContentId !== "string" ||
        !/^pmc_bot_[0-9a-f]{40}$/.test(data.protectedContentId))) ||
    (data.completedAtMs !== null && !isSafeInteger(data.completedAtMs)) ||
    (data.terminalReason !== null &&
      data.terminalReason !== "completed" &&
      data.terminalReason !== "suppressed" &&
      data.terminalReason !== "not_sent" &&
      data.terminalReason !== "unsupported_status_target" &&
      data.terminalReason !== "reconciled_sent" &&
      data.terminalReason !== "reconciled_not_sent") ||
    (data.lastErrorCode !== null && typeof data.lastErrorCode !== "string") ||
    (data.resultProviderMessageId !== null &&
      typeof data.resultProviderMessageId !== "string") ||
    (data.reconciliationId !== undefined &&
      (typeof data.reconciliationId !== "string" ||
        !/^fatal_reconcile_[0-9a-f]{32}$/.test(data.reconciliationId))) ||
    (data.reconciliationRequestSha256 !== undefined &&
      (typeof data.reconciliationRequestSha256 !== "string" ||
        !/^[0-9a-f]{64}$/.test(data.reconciliationRequestSha256))) ||
    (data.reconciliationOutcome !== undefined &&
      data.reconciliationOutcome !== "confirmed_sent" &&
      data.reconciliationOutcome !== "confirmed_not_sent") ||
    (data.reconciliationEvidenceSha256 !== undefined &&
      (typeof data.reconciliationEvidenceSha256 !== "string" ||
        !/^[0-9a-f]{64}$/.test(data.reconciliationEvidenceSha256))) ||
    (data.reconciledByUidSha256 !== undefined &&
      (typeof data.reconciledByUidSha256 !== "string" ||
        !/^[0-9a-f]{64}$/.test(data.reconciledByUidSha256))) ||
    (data.reconciledAtMs !== undefined && !isSafeInteger(data.reconciledAtMs)) ||
    data.containsMessageContent !== false ||
    data.containsFullSender !== false ||
    data.schemaVersion !== 3 ||
    !isSafeInteger(data.createdAtMs) ||
    !isSafeInteger(data.updatedAtMs)
  ) {
    return null;
  }
  const reconciliationValues = [
    data.reconciliationId,
    data.reconciliationRequestSha256,
    data.reconciliationOutcome,
    data.reconciliationEvidenceSha256,
    data.reconciledByUidSha256,
    data.reconciledAtMs,
  ];
  const reconciliationFieldCount = reconciliationValues.filter(
    (entry) => entry !== undefined,
  ).length;
  const reconciledReason =
    data.terminalReason === "reconciled_sent" ||
    data.terminalReason === "reconciled_not_sent";
  const protectedReferenceFieldCount = [
    data.protectedConversationId,
    data.protectedContentId,
  ].filter((entry) => entry !== undefined).length;
  if (
    ((data.state === "pending" ||
      data.state === "processing" ||
      data.state === "retryable") &&
      !isSafeInteger(data.dueAtMs)) ||
    ((data.state === "terminal" || data.state === "fatal") &&
      data.dueAtMs !== undefined) ||
    (data.state === "terminal" && data.terminalReason === null) ||
    (data.state !== "terminal" && data.terminalReason !== null) ||
    (reconciledReason && reconciliationFieldCount !== reconciliationValues.length) ||
    (!reconciledReason && reconciliationFieldCount !== 0) ||
    (data.terminalReason === "reconciled_sent" &&
      (data.reconciliationOutcome !== "confirmed_sent" ||
        typeof data.resultProviderMessageId !== "string" ||
        data.resultProviderMessageId.length === 0)) ||
    (data.terminalReason === "reconciled_not_sent" &&
      (data.reconciliationOutcome !== "confirmed_not_sent" ||
        data.resultProviderMessageId !== null)) ||
    (data.terminalReason === "not_sent" &&
      (data.dispatchStartedAtMs !== null ||
        data.resultProviderMessageId !== null ||
        typeof data.lastErrorCode !== "string" ||
        data.lastErrorCode.length === 0)) ||
    (data.dispatchReplySource !== undefined &&
      (data.effectKind !== "graph_bot_reply" ||
        data.dispatchStartedAtMs === null ||
        (data.dispatchReplySource === "ai_transient" &&
          payload.replySource !== "ai_transient"))) ||
    (protectedReferenceFieldCount !== 0 &&
      (protectedReferenceFieldCount !== 2 ||
        data.effectKind !== "graph_bot_reply" ||
        data.dispatchStartedAtMs === null ||
        data.dispatchReplySource === undefined))
  ) {
    return null;
  }
  return data as CanaryOutboxRecord;
}

export function canaryOutboxBackoffMs(attempts: number): number {
  const bounded = Math.max(1, Math.min(META_CANARY_OUTBOX_MAX_ATTEMPTS, attempts));
  return Math.min(60_000, 1_000 * (2 ** (bounded - 1)));
}

export function claimCanaryOutboxRecord(input: {
  readonly record: CanaryOutboxRecord;
  readonly nowMs: number;
  readonly leaseToken: string;
  readonly leaseOwner: "http_webhook" | "admin_reconciler";
  readonly leaseMs?: number;
}): CanaryOutboxClaimResult {
  const { record } = input;
  if (record.state === "terminal" || record.state === "fatal") {
    return { action: "noop", record };
  }
  if (record.state === "processing") {
    if ((record.leaseExpiresAtMs ?? Number.MAX_SAFE_INTEGER) > input.nowMs) {
      return { action: "noop", record };
    }
    if (record.dispatchStartedAtMs !== null) {
      const { dueAtMs: _dueAtMs, ...withoutDueAt } = record;
      return {
        action: "fatalized",
        record: {
          ...withoutDueAt,
          state: "fatal",
          leaseToken: null,
          leaseOwner: null,
          leaseExpiresAtMs: null,
          lastErrorCode: "ambiguous_provider_outcome",
          updatedAtMs: input.nowMs,
        },
      };
    }
  } else if (record.nextAttemptAtMs > input.nowMs) {
    return { action: "noop", record };
  }
  if (record.attempts >= record.maxAttempts) {
    const { dueAtMs: _dueAtMs, ...withoutDueAt } = record;
    return {
      action: "fatalized",
      record: {
        ...withoutDueAt,
        state: "fatal",
        leaseToken: null,
        leaseOwner: null,
        leaseExpiresAtMs: null,
        lastErrorCode: "attempt_limit_exhausted",
        updatedAtMs: input.nowMs,
      },
    };
  }
  const leaseMs = Math.max(5_000, Math.min(120_000, input.leaseMs ?? META_CANARY_OUTBOX_LEASE_MS));
  return {
    action: "claimed",
    record: {
      ...record,
      state: "processing",
      attempts: record.attempts + 1,
      leaseToken: input.leaseToken,
      leaseOwner: input.leaseOwner,
      leaseExpiresAtMs: input.nowMs + leaseMs,
      dueAtMs: input.nowMs + leaseMs,
      dispatchStartedAtMs: null,
      nextAttemptAtMs: input.nowMs,
      lastErrorCode: null,
      updatedAtMs: input.nowMs,
    },
  };
}

function assertLease(record: CanaryOutboxRecord, leaseToken: string): void {
  if (record.state !== "processing" || record.leaseToken !== leaseToken) {
    throw new Error("meta canary outbox lease mismatch");
  }
}

export function markCanaryOutboxDispatchStarted(
  record: CanaryOutboxRecord,
  leaseToken: string,
  nowMs: number,
  dispatchReplySource?: "ai_transient" | "durable",
  protectedReference?: {
    readonly conversationId: string;
    readonly contentId: string;
  },
): CanaryOutboxRecord {
  assertLease(record, leaseToken);
  if (dispatchReplySource && record.effectKind !== "graph_bot_reply") {
    throw new Error("invalid_dispatch_reply_source");
  }
  if (
    dispatchReplySource === "ai_transient" &&
    record.payload.replySource !== "ai_transient"
  ) {
    throw new Error("invalid_dispatch_reply_source");
  }
  if (
    protectedReference &&
    (record.effectKind !== "graph_bot_reply" ||
      !dispatchReplySource ||
      !/^conversation_live_[0-9a-f]{10}$/.test(
        protectedReference.conversationId,
      ) ||
      !/^pmc_bot_[0-9a-f]{40}$/.test(protectedReference.contentId))
  ) {
    throw new Error("invalid_protected_dispatch_reference");
  }
  return {
    ...record,
    dispatchStartedAtMs: nowMs,
    ...(dispatchReplySource ? { dispatchReplySource } : {}),
    ...(protectedReference
      ? {
        protectedConversationId: protectedReference.conversationId,
        protectedContentId: protectedReference.contentId,
      }
      : {}),
    updatedAtMs: nowMs,
  };
}

export function completeCanaryOutboxRecord(input: {
  readonly record: CanaryOutboxRecord;
  readonly leaseToken: string;
  readonly nowMs: number;
  readonly providerMessageId?: string | null;
  readonly terminalReason?:
    | "completed"
    | "suppressed"
    | "unsupported_status_target";
}): CanaryOutboxRecord {
  assertLease(input.record, input.leaseToken);
  const { dueAtMs: _dueAtMs, ...withoutDueAt } = input.record;
  return {
    ...withoutDueAt,
    state: "terminal",
    leaseToken: null,
    leaseOwner: null,
    leaseExpiresAtMs: null,
    completedAtMs: input.nowMs,
    terminalReason: input.terminalReason ?? "completed",
    resultProviderMessageId: input.providerMessageId ?? null,
    lastErrorCode: null,
    updatedAtMs: input.nowMs,
  };
}

export function failCanaryOutboxRecord(input: {
  readonly record: CanaryOutboxRecord;
  readonly leaseToken: string;
  readonly nowMs: number;
  readonly errorCode: string;
  readonly safeToRetry: boolean;
}): CanaryOutboxRecord {
  assertLease(input.record, input.leaseToken);
  const fatal =
    !input.safeToRetry ||
    input.record.dispatchStartedAtMs !== null ||
    input.record.attempts >= input.record.maxAttempts;
  const nextAttemptAtMs = fatal
    ? input.record.nextAttemptAtMs
    : input.nowMs + canaryOutboxBackoffMs(input.record.attempts);
  const { dueAtMs: _dueAtMs, ...withoutDueAt } = input.record;
  return {
    ...withoutDueAt,
    state: fatal ? "fatal" : "retryable",
    leaseToken: null,
    leaseOwner: null,
    leaseExpiresAtMs: null,
    nextAttemptAtMs,
    ...(!fatal ? { dueAtMs: nextAttemptAtMs } : {}),
    lastErrorCode: safeErrorCode(input.errorCode),
    updatedAtMs: input.nowMs,
  };
}

/**
 * Exhausted Graph work that never crossed the dispatch boundary is a durable
 * no-send, not a provider ambiguity. No reconciliation evidence is required.
 */
export function terminalizeCanaryGraphEffectWithoutDispatch(input: {
  readonly record: CanaryOutboxRecord;
  readonly nowMs: number;
  readonly errorCode?: string;
}): CanaryOutboxRecord {
  if (
    (input.record.effectKind !== "graph_bot_reply" &&
      input.record.effectKind !== "graph_auto_reply" &&
      input.record.effectKind !== "graph_template_send") ||
    input.record.state !== "fatal" ||
    input.record.dispatchStartedAtMs !== null
  ) {
    throw new Error("meta_canary_graph_effect_crossed_dispatch_boundary");
  }
  const { dueAtMs: _dueAtMs, ...withoutDueAt } = input.record;
  return {
    ...withoutDueAt,
    state: "terminal",
    leaseToken: null,
    leaseOwner: null,
    leaseExpiresAtMs: null,
    completedAtMs: input.nowMs,
    terminalReason: "not_sent",
    resultProviderMessageId: null,
    lastErrorCode: safeErrorCode(
      input.errorCode ?? input.record.lastErrorCode ?? "pre_dispatch_attempts_exhausted",
    ),
    updatedAtMs: input.nowMs,
  };
}

/** Deterministic bounded selection used by the single-field due-work query. */
export function selectDueCanaryOutboxRecords(
  records: readonly CanaryOutboxRecord[],
  nowMs: number,
  limit = META_CANARY_OUTBOX_MAX_BATCH,
): readonly CanaryOutboxRecord[] {
  const boundedLimit = Math.max(1, Math.min(META_CANARY_OUTBOX_MAX_BATCH, limit));
  return records
    .filter((record) =>
      record.dueAtMs !== undefined &&
      record.dueAtMs <= nowMs &&
      (record.state === "pending" ||
        record.state === "retryable" ||
        record.state === "processing")
    )
    .sort((left, right) =>
      (left.dueAtMs ?? Number.MAX_SAFE_INTEGER) -
        (right.dueAtMs ?? Number.MAX_SAFE_INTEGER) ||
      left.id.localeCompare(right.id)
    )
    .slice(0, boundedLimit);
}

export type DurableBotTextCode =
  | "language_en"
  | "language_si"
  | "language_ta"
  | "menu_en"
  | "menu_si"
  | "menu_ta"
  | "book_en"
  | "book_si"
  | "book_ta"
  | "lab_en"
  | "lab_si"
  | "lab_ta"
  | "unknown_en"
  | "unknown_si"
  | "unknown_ta";

export type DurableBotInput =
  | { readonly kind: "selection"; readonly selectionId: string }
  | { readonly kind: "text_code"; readonly textCode: DurableBotTextCode }
  | { readonly kind: "unsupported" };

export type CanaryTransientAiReplyEvidence = {
  readonly replySource: "ai_transient";
  readonly transientReplySha256: string;
  readonly durableFallbackReplySha256: string;
};

export type CanaryBotReplyPlan = {
  readonly reply: Readonly<Record<string, unknown>>;
  readonly durableFallbackReply: Readonly<Record<string, unknown>>;
  readonly replyIndex: number;
  readonly transient: boolean;
};

/** An AI substitution recovers to the final deterministic menu, not its nudge. */
export function planCanaryBotReplies(
  durableReplies: readonly Readonly<Record<string, unknown>>[],
  transientReply?: Readonly<Record<string, unknown>>,
): readonly CanaryBotReplyPlan[] {
  if (durableReplies.length === 0) throw new Error("missing_bot_reply");
  if (transientReply) {
    const replyIndex = durableReplies.length - 1;
    const durableFallbackReply = durableReplies[replyIndex];
    if (!durableFallbackReply) throw new Error("missing_bot_fallback_reply");
    return [{
      reply: transientReply,
      durableFallbackReply,
      replyIndex,
      transient: true,
    }];
  }
  return durableReplies.map((reply, replyIndex) => ({
    reply,
    durableFallbackReply: reply,
    replyIndex,
    transient: false,
  }));
}

/**
 * Persist only proof of an in-memory AI reply. The reply body remains request
 * scoped; a later retry deliberately falls back to the durable menu reply.
 */
export function buildCanaryTransientAiReplyEvidence(
  transientReply: Readonly<Record<string, unknown>>,
  durableFallbackReply: Readonly<Record<string, unknown>>,
  sha256Hex: (value: string) => string,
): CanaryTransientAiReplyEvidence {
  return {
    replySource: "ai_transient",
    transientReplySha256: sha256Hex(JSON.stringify(transientReply)),
    durableFallbackReplySha256: sha256Hex(JSON.stringify(durableFallbackReply)),
  };
}

/** Accept a transient AI body only when it matches the durable content-free proof. */
export function matchesCanaryTransientAiReply(
  payload: Readonly<Record<string, unknown>>,
  reply: Readonly<Record<string, unknown>>,
  sha256Hex: (value: string) => string,
): boolean {
  return payload.replySource === "ai_transient" &&
    typeof payload.transientReplySha256 === "string" &&
    /^[0-9a-f]{64}$/.test(payload.transientReplySha256) &&
    sha256Hex(JSON.stringify(reply)) === payload.transientReplySha256;
}

/**
 * Use the request-scoped AI body when present. Recovery never persists or
 * recreates that body; it sends the precommitted deterministic fallback.
 */
export function selectCanaryBotReply(input: {
  readonly payload: Readonly<Record<string, unknown>>;
  readonly durableReply: Readonly<Record<string, unknown>>;
  readonly transientReply?: Readonly<Record<string, unknown>>;
  readonly sha256Hex: (value: string) => string;
}): Readonly<Record<string, unknown>> {
  if (input.payload.replySource === "ai_transient") {
    if (
      typeof input.payload.durableFallbackReplySha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(input.payload.durableFallbackReplySha256) ||
      input.sha256Hex(JSON.stringify(input.durableReply)) !==
        input.payload.durableFallbackReplySha256
    ) {
      throw new Error("bot_fallback_plan_mismatch");
    }
    if (
      input.transientReply &&
      matchesCanaryTransientAiReply(
        input.payload,
        input.transientReply,
        input.sha256Hex,
      )
    ) {
      return input.transientReply;
    }
    return input.durableReply;
  }
  if (
    typeof input.payload.replySha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(input.payload.replySha256) ||
    input.sha256Hex(JSON.stringify(input.durableReply)) !== input.payload.replySha256
  ) {
    throw new Error("bot_reply_plan_mismatch");
  }
  return input.durableReply;
}

const SAFE_SELECTION = /^(?:lang_(?:en|si|ta)|menu_(?:language|appointment|lab|clinic|staff)|dept_(?:general|cardiology|ortho|gyn|urology|gastro|eye|physio)|day_\d{4}-\d{2}-\d{2}|slot_(?:0900|1030|1200|1400|1530|1700|1830))$/;
const MENU_LATIN = /^(menu|start|hi|hello|hey|ayubowan|vanakkam)\b/i;
const MENU_NATIVE = /^(මෙනුව|ආයුබෝවන්|வணக்கம்|பட்டியல்)/;
const BOOK = /(?:\b(?:book(?:ing)?|appoint(?:ment|ments)?|channel(?:ing)?)\b|වෙන්|හමුවීම|சந்திப்பு|பதிவு)/i;
const LAB = /(?:\b(?:lab|laboratory|results?|reports?)\b|රසායනාගාර|ප්‍රතිඵල|ஆய்வக|முடிவு)/i;

function script(text: string): "en" | "si" | "ta" {
  if (/[඀-෿]/.test(text)) return "si";
  if (/[஀-௿]/.test(text)) return "ta";
  return "en";
}

export function durableBotInput(message: CanaryBotMessage): DurableBotInput {
  if (message.inbound.kind === "selection") {
    return SAFE_SELECTION.test(message.inbound.selectionId)
      ? { kind: "selection", selectionId: message.inbound.selectionId }
      : { kind: "unsupported" };
  }
  const text = message.inbound.text.trim();
  if (/^(english|eng)\b/i.test(text)) return { kind: "text_code", textCode: "language_en" };
  if (/^(sinhala|සිංහල|සිංහලෙන්)/i.test(text)) return { kind: "text_code", textCode: "language_si" };
  if (/^(tamil|தமிழ்|தமிழில்)/i.test(text)) return { kind: "text_code", textCode: "language_ta" };
  const language = script(text);
  if (MENU_LATIN.test(text) || MENU_NATIVE.test(text)) {
    return { kind: "text_code", textCode: `menu_${language}` as DurableBotTextCode };
  }
  if (BOOK.test(text)) {
    return { kind: "text_code", textCode: `book_${language}` as DurableBotTextCode };
  }
  if (LAB.test(text)) {
    return { kind: "text_code", textCode: `lab_${language}` as DurableBotTextCode };
  }
  return { kind: "text_code", textCode: `unknown_${language}` as DurableBotTextCode };
}

const BOT_TEXT: Record<DurableBotTextCode, string> = {
  language_en: "English",
  language_si: "සිංහල",
  language_ta: "தமிழ்",
  menu_en: "MENU",
  menu_si: "මෙනුව",
  menu_ta: "பட்டியல்",
  book_en: "book appointment",
  book_si: "හමුවීම",
  book_ta: "சந்திப்பு",
  lab_en: "lab results",
  lab_si: "රසායනාගාර ප්‍රතිඵල",
  lab_ta: "ஆய்வக முடிவு",
  unknown_en: "?",
  unknown_si: "ආ",
  unknown_ta: "அ",
};

export function decodeDurableBotInput(input: DurableBotInput): {
  readonly kind: "text" | "selection";
  readonly text: string;
  readonly selectionId: string;
} | null {
  if (input.kind === "unsupported") return null;
  return input.kind === "selection"
    ? { kind: "selection", text: "", selectionId: input.selectionId }
    : { kind: "text", text: BOT_TEXT[input.textCode], selectionId: "" };
}

export function resolveCanaryOutboxRecipient(input: {
  readonly recipientSha256: unknown;
  readonly recipientLast4: unknown;
  readonly allowlist: readonly string[];
  readonly sha256Hex: (value: string) => string;
}): string | null {
  if (
    typeof input.recipientSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(input.recipientSha256) ||
    typeof input.recipientLast4 !== "string" ||
    !/^\d{4}$/.test(input.recipientLast4)
  ) {
    return null;
  }
  const recipientSha256 = input.recipientSha256;
  const recipientLast4 = input.recipientLast4;
  return input.allowlist.find((digits) =>
    digits.endsWith(recipientLast4) &&
    input.sha256Hex(`canary-sender:${digits}`) === recipientSha256
  ) ?? null;
}

export type CanaryTemplatePurpose = "marketing" | "non_marketing_canary";

/** Only Meta's connectivity-test template is treated as non-marketing. */
export function canaryTemplatePurpose(templateName: string): CanaryTemplatePurpose {
  return templateName === META_CANARY_DEFAULT_TEMPLATE
    ? "non_marketing_canary"
    : "marketing";
}

export type CanaryGraphSuppressionDecision =
  | { readonly kind: "allow" }
  | {
    readonly kind: "suppress";
    readonly reason:
      | "invalid_contact_state"
      | "invalid_conversation_state"
      | "invalid_contact"
      | "suppress_all"
      | "stop_suppression"
      | "marketing_eligibility_missing"
      | "marketing_suppression"
      | "human_handoff";
  };

/**
 * Last-moment provider policy. A STOP quiets queued bot/flat replies. Marketing
 * templates honor marketing suppression; the fixed non-marketing connectivity
 * template still honors suppress-all and invalid-contact holds.
 */
export function decideCanaryGraphSuppression(input: {
  readonly effectKind: "graph_bot_reply" | "graph_auto_reply" | "graph_template_send";
  readonly expectedContactId: string;
  readonly contact: unknown;
  readonly templatePurpose?: unknown;
}): CanaryGraphSuppressionDecision {
  if (input.contact === undefined || input.contact === null) {
    return input.effectKind === "graph_template_send" &&
        input.templatePurpose === "marketing"
      ? { kind: "suppress", reason: "marketing_eligibility_missing" }
      : input.effectKind === "graph_template_send" &&
          input.templatePurpose !== "non_marketing_canary"
        ? { kind: "suppress", reason: "invalid_contact_state" }
        : { kind: "allow" };
  }
  const contact = asRecord(input.contact);
  const suppression = asRecord(contact?.suppression);
  if (
    !contact ||
    contact.id !== input.expectedContactId ||
    contact.workspaceId !== META_CANARY_WORKSPACE_ID ||
    contact.synthetic !== true ||
    contact.liveCanary !== true ||
    !suppression ||
    typeof suppression.suppressAll !== "boolean" ||
    typeof suppression.suppressMarketing !== "boolean" ||
    typeof suppression.invalidContact !== "boolean"
  ) {
    return { kind: "suppress", reason: "invalid_contact_state" };
  }
  if (suppression.invalidContact) {
    return { kind: "suppress", reason: "invalid_contact" };
  }
  if (suppression.suppressAll) {
    return { kind: "suppress", reason: "suppress_all" };
  }
  const tags = Array.isArray(contact.tags) ? contact.tags : [];
  const marketingSuppressed =
    suppression.suppressMarketing || tags.includes("marketing-suppressed");
  if (
    marketingSuppressed &&
    (input.effectKind === "graph_bot_reply" ||
      input.effectKind === "graph_auto_reply")
  ) {
    return { kind: "suppress", reason: "stop_suppression" };
  }
  if (input.effectKind === "graph_template_send") {
    if (
      input.templatePurpose !== "marketing" &&
      input.templatePurpose !== "non_marketing_canary"
    ) {
      return { kind: "suppress", reason: "invalid_contact_state" };
    }
    if (marketingSuppressed && input.templatePurpose === "marketing") {
      return { kind: "suppress", reason: "marketing_suppression" };
    }
  }
  return { kind: "allow" };
}

/** A claimed/handoff conversation owns the channel; automation must stay quiet. */
export function decideCanaryAutomationConversationSuppression(input: {
  readonly effectKind: "graph_bot_reply" | "graph_auto_reply" | "bot_plan";
  readonly expectedConversationId: string;
  readonly conversation: unknown;
  readonly currentHandoffReply?: boolean;
}): CanaryGraphSuppressionDecision {
  if (input.conversation === undefined || input.conversation === null) {
    return { kind: "allow" };
  }
  const conversation = asRecord(input.conversation);
  if (
    !conversation ||
    conversation.id !== input.expectedConversationId ||
    conversation.workspaceId !== META_CANARY_WORKSPACE_ID ||
    conversation.synthetic !== true ||
    conversation.liveCanary !== true
  ) {
    return { kind: "suppress", reason: "invalid_conversation_state" };
  }
  const assigneeId =
    typeof conversation.assigneeId === "string" && conversation.assigneeId.trim()
      ? conversation.assigneeId.trim()
      : null;
  const inHandoff =
    conversation.mode === "human_takeover" ||
    conversation.status === "assigned" ||
    assigneeId !== null;
  if (!inHandoff) return { kind: "allow" };
  if (
    input.effectKind === "graph_bot_reply" &&
    input.currentHandoffReply === true &&
    assigneeId === null &&
    conversation.mode === "human_takeover"
  ) {
    return { kind: "allow" };
  }
  return { kind: "suppress", reason: "human_handoff" };
}

function timestampLikeMillis(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const toMillis = (value as { toMillis?: unknown }).toMillis;
  if (typeof toMillis !== "function") return null;
  try {
    const millis = toMillis.call(value);
    return typeof millis === "number" && Number.isSafeInteger(millis) && millis >= 0
      ? millis
      : null;
  } catch {
    return null;
  }
}

/**
 * An outbound bot evidence write must not reopen an inbound-derived service
 * window or erase a newer human handoff. Malformed/cross-tenant state fails
 * closed instead of being repaired by the write.
 */
export function preserveCanaryOutboundConversationState(input: {
  readonly expectedConversationId: string;
  readonly existingConversation: unknown;
  readonly builtConversation: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> {
  const existing = asRecord(input.existingConversation);
  const assigneeId = existing?.assigneeId === null
    ? null
    : typeof existing?.assigneeId === "string" && existing.assigneeId.trim()
      ? existing.assigneeId.trim()
      : undefined;
  const automationState =
    existing?.mode === "automation" &&
    existing.status === "active" &&
    assigneeId === null;
  const handoffState =
    existing?.mode === "human_takeover" &&
    existing.status === "assigned" &&
    assigneeId !== undefined;
  if (
    !existing ||
    existing.id !== input.expectedConversationId ||
    existing.workspaceId !== META_CANARY_WORKSPACE_ID ||
    existing.synthetic !== true ||
    existing.liveCanary !== true ||
    (!automationState && !handoffState) ||
    timestampLikeMillis(existing.serviceWindowExpiresAt) === null
  ) {
    throw new Error("invalid_outbound_conversation_state");
  }
  return {
    ...input.builtConversation,
    mode: existing.mode,
    status: existing.status,
    assigneeId,
    serviceWindowExpiresAt: existing.serviceWindowExpiresAt,
  };
}

export function canaryProviderRouteId(
  providerMessageId: string,
  sha256Hex: (value: string) => string,
): string {
  return `route_${sha256Hex(
    `meta-canary-provider-route:v1:${providerMessageId}`,
  ).slice(0, 40)}`;
}

export type CanaryProviderRouteEvidence = {
  readonly id: string;
  readonly workspaceId: typeof META_CANARY_WORKSPACE_ID;
  readonly targetKind: CanaryProviderRouteTargetKind;
  readonly targetId: string;
  readonly providerMessageIdSha256: string;
  readonly canary: true;
  readonly containsMessageContent: false;
  readonly containsFullRecipient: false;
  readonly schemaVersion: 1;
};

export type CanaryProviderRouteTargetKind =
  | "manual_template"
  | "meta_outbox_effect"
  | "lite_agent_reply"
  | "lite_booking_notification";

function validCanaryProviderRouteTarget(
  targetKind: unknown,
  targetId: unknown,
): targetKind is CanaryProviderRouteTargetKind {
  if (typeof targetId !== "string") return false;
  if (targetKind === "manual_template") return /^manual_[0-9a-f]{32}$/.test(targetId);
  if (targetKind === "meta_outbox_effect") return /^fx_[0-9a-f]{8,64}$/.test(targetId);
  if (targetKind === "lite_agent_reply") {
    return /^reply_[A-Za-z0-9_-]{16,80}$/.test(targetId);
  }
  return targetKind === "lite_booking_notification" &&
    /^booking_op_[0-9a-f]{24}$/.test(targetId);
}

/** Content-free provider-id route persisted atomically with a manual send. */
export function buildCanaryProviderRouteEvidence(input: {
  readonly providerMessageId: string;
  readonly targetKind: CanaryProviderRouteTargetKind;
  readonly targetId: string;
  readonly sha256Hex: (value: string) => string;
}): CanaryProviderRouteEvidence {
  const providerMessageId = assertCanaryProviderMessageId(input.providerMessageId);
  if (!validCanaryProviderRouteTarget(input.targetKind, input.targetId)) {
    throw new Error("invalid_provider_route_target");
  }
  return {
    id: canaryProviderRouteId(providerMessageId, input.sha256Hex),
    workspaceId: META_CANARY_WORKSPACE_ID,
    targetKind: input.targetKind,
    targetId: input.targetId,
    providerMessageIdSha256: input.sha256Hex(providerMessageId),
    canary: true,
    containsMessageContent: false,
    containsFullRecipient: false,
    schemaVersion: 1,
  };
}

/** Resolve only an exact, content-free route bound to this provider event. */
export function resolveCanaryProviderRoute(input: {
  readonly route: unknown;
  readonly providerMessageId: string;
  readonly sha256Hex: (value: string) => string;
}): {
  readonly targetKind: CanaryProviderRouteTargetKind;
  readonly targetId: string;
} | null {
  const route = asRecord(input.route);
  const providerMessageId = assertCanaryProviderMessageId(input.providerMessageId);
  if (
    !route ||
    route.id !== canaryProviderRouteId(providerMessageId, input.sha256Hex) ||
    route.workspaceId !== META_CANARY_WORKSPACE_ID ||
    !validCanaryProviderRouteTarget(route.targetKind, route.targetId) ||
    route.providerMessageIdSha256 !== input.sha256Hex(providerMessageId) ||
    route.canary !== true ||
    route.containsMessageContent !== false ||
    route.containsFullRecipient !== false ||
    route.schemaVersion !== 1
  ) {
    return null;
  }
  return {
    targetKind: route.targetKind,
    targetId: route.targetId as string,
  };
}

export type CanaryStatusTargetDecision =
  | { readonly kind: "retry_missing_target" }
  | { readonly kind: "campaign" }
  | { readonly kind: "provider_route" };

export function decideCanaryStatusTarget(input: {
  readonly campaignSendExists: boolean;
  readonly providerRouteExists: boolean;
}): CanaryStatusTargetDecision {
  if (input.campaignSendExists) return { kind: "campaign" };
  if (input.providerRouteExists) return { kind: "provider_route" };
  return { kind: "retry_missing_target" };
}

export type CanaryReceiptPlanMode = "bot" | "auto_reply" | "none";

export function resolveCanaryRuntimeMode(input: {
  readonly botEnabled: unknown;
  readonly autoReplyEnabled: unknown;
}): CanaryReceiptPlanMode {
  const bot = input.botEnabled === true;
  const autoReply = input.autoReplyEnabled === true;
  if (bot && autoReply) throw new Error("meta_canary_mode_conflict");
  return bot ? "bot" : autoReply ? "auto_reply" : "none";
}

export function shouldPrepareCanaryTransientAi(input: {
  readonly mode: CanaryReceiptPlanMode;
  readonly aiEnabled: unknown;
  readonly hasFreshBotPlan: boolean;
}): boolean {
  return input.mode === "bot" &&
    input.aiEnabled === true &&
    input.hasFreshBotPlan;
}

export function decideCanaryTransientAiSequence(input: {
  readonly recipientBlocked: boolean;
  readonly staffHandoff: boolean;
  readonly aiQuery: unknown;
}): "skip" | "block_recipient" | "candidate" {
  if (input.recipientBlocked) return "skip";
  if (input.staffHandoff) return "block_recipient";
  return typeof input.aiQuery === "string" && input.aiQuery.length > 0
    ? "candidate"
    : "skip";
}

export type CanaryReceiptEffectPlanDecision =
  | {
    readonly kind: "create";
    readonly effectIds: readonly string[];
    readonly planMode: CanaryReceiptPlanMode;
  }
  | {
    readonly kind: "replay";
    readonly effectIds: readonly string[];
    readonly planMode: CanaryReceiptPlanMode;
  }
  | {
    readonly kind: "legacy_replay";
    readonly effectIds: readonly [];
    readonly planMode: "none";
    readonly migrateReceipt: boolean;
  };

const LEGACY_CANARY_RECEIPT_KEYS = new Set([
  "id",
  "workspaceId",
  "kind",
  "waMessageId",
  "fromNumber",
  "toPhoneNumberId",
  "messageType",
  "statusValue",
  "bodySha256",
  "providerTimestamp",
  "canary",
  "containsMessageContent",
  "schemaVersion",
  "receivedAt",
]);

function isExactLegacyCanaryReceipt(
  existing: Readonly<Record<string, unknown>>,
  record: CanaryInboundRecord,
  sha256Hex: (value: string) => string,
): boolean {
  if (Object.keys(existing).some((key) => !LEGACY_CANARY_RECEIPT_KEYS.has(key))) {
    return false;
  }
  const fromNumber = existing.fromNumber;
  const legacySenderMatches = record.kind === "status"
    ? fromNumber === null &&
      record.fromNumberSha256 === null &&
      record.fromNumberLast4 === null
    : typeof fromNumber === "string" &&
      /^\d{8,15}$/.test(fromNumber) &&
      sha256Hex(`canary-sender:${fromNumber}`) === record.fromNumberSha256 &&
      fromNumber.slice(-4) === record.fromNumberLast4;
  const providerTimestampMatches =
    existing.providerTimestamp === record.providerTimestamp ||
    (
      record.kind === "status" &&
      typeof existing.providerTimestamp === "string" &&
      /^[1-9]\d{9,10}$/.test(existing.providerTimestamp) &&
      typeof record.providerTimestamp === "string" &&
      /^[1-9]\d{9,10}$/.test(record.providerTimestamp)
    );
  return existing.id === record.id &&
    existing.workspaceId === record.workspaceId &&
    existing.kind === record.kind &&
    existing.waMessageId === record.waMessageId &&
    legacySenderMatches &&
    existing.toPhoneNumberId === record.toPhoneNumberId &&
    existing.messageType === record.messageType &&
    existing.statusValue === record.statusValue &&
    existing.bodySha256 === record.bodySha256 &&
    providerTimestampMatches &&
    existing.canary === true &&
    existing.containsMessageContent === false &&
    existing.schemaVersion === 1 &&
    existing.outboxPlanVersion === undefined &&
    existing.outboxEffectIds === undefined &&
    existing.outboxPlanMode === undefined &&
    existing.fromNumberSha256 === undefined &&
    existing.fromNumberLast4 === undefined;
}

/**
 * Public inbound records replace the standard sender/body fingerprints before
 * persistence. A provider replay may therefore need to be compared with the
 * original content-free fingerprints extracted from the same signed payload.
 * Keep every stable field identical so this can never degrade into receipt-id
 * only matching.
 */
function isStrictPublicReplayIdentityPair(
  record: CanaryInboundRecord,
  strictReplayRecord: CanaryInboundRecord,
): boolean {
  return record.kind === "message" &&
    strictReplayRecord.kind === "message" &&
    typeof record.fromNumberSha256 === "string" &&
    record.fromNumberLast4 === null &&
    record.bodySha256 === null &&
    typeof strictReplayRecord.fromNumberSha256 === "string" &&
    typeof strictReplayRecord.fromNumberLast4 === "string" &&
    record.id === strictReplayRecord.id &&
    record.workspaceId === strictReplayRecord.workspaceId &&
    record.waMessageId === strictReplayRecord.waMessageId &&
    record.toPhoneNumberId === strictReplayRecord.toPhoneNumberId &&
    record.messageType === strictReplayRecord.messageType &&
    record.statusValue === strictReplayRecord.statusValue &&
    record.providerTimestamp === strictReplayRecord.providerTimestamp &&
    record.canary === strictReplayRecord.canary &&
    record.containsMessageContent === strictReplayRecord.containsMessageContent &&
    record.schemaVersion === strictReplayRecord.schemaVersion;
}

function hasCurrentCanaryReceiptIdentity(
  existing: Readonly<Record<string, unknown>>,
  record: CanaryInboundRecord,
): boolean {
  const providerTimestampMatches =
    existing.providerTimestamp === record.providerTimestamp ||
    (
      record.kind === "status" &&
      typeof existing.providerTimestamp === "string" &&
      /^[1-9]\d{9,10}$/.test(existing.providerTimestamp) &&
      typeof record.providerTimestamp === "string" &&
      /^[1-9]\d{9,10}$/.test(record.providerTimestamp)
    );
  return existing.id === record.id &&
    existing.workspaceId === record.workspaceId &&
    existing.kind === record.kind &&
    existing.waMessageId === record.waMessageId &&
    existing.fromNumberSha256 === record.fromNumberSha256 &&
    existing.fromNumberLast4 === record.fromNumberLast4 &&
    existing.toPhoneNumberId === record.toPhoneNumberId &&
    existing.messageType === record.messageType &&
    existing.statusValue === record.statusValue &&
    existing.bodySha256 === record.bodySha256 &&
    providerTimestampMatches &&
    existing.canary === true &&
    existing.containsMessageContent === false &&
    existing.schemaVersion === record.schemaVersion;
}

export function buildContentFreeLegacyCanaryReceipt(input: {
  readonly existingReceipt: unknown;
  readonly record: CanaryInboundRecord;
  readonly receivedAtFallback: unknown;
  readonly migratedAt: unknown;
}): Readonly<Record<string, unknown>> {
  const existing = asRecord(input.existingReceipt);
  return {
    ...input.record,
    outboxEffectIds: [],
    outboxPlanMode: "none",
    outboxPlanVersion: 1,
    legacyReceiptNoEffects: true,
    receivedAt: existing?.receivedAt ?? input.receivedAtFallback,
    migratedAt: input.migratedAt,
  };
}

function boundedEffectIds(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) return null;
  const ids = value.filter(
    (id): id is string => typeof id === "string" && /^fx_[0-9a-f]{8,64}$/.test(id),
  );
  return ids.length === value.length && new Set(ids).size === ids.length ? ids : null;
}

/**
 * Provider replays are forever bound to the plan committed with the receipt.
 * The caller's current bot/auto mode is considered only for a brand-new receipt.
 */
export function decideCanaryReceiptEffectPlan(input: {
  readonly existingReceipt: unknown;
  readonly record: CanaryInboundRecord;
  readonly strictReplayRecord?: CanaryInboundRecord;
  readonly currentMode: CanaryReceiptPlanMode;
  readonly currentPlannedEffectIds: readonly string[];
  readonly sha256Hex?: (value: string) => string;
}): CanaryReceiptEffectPlanDecision {
  const plannedIds = boundedEffectIds(input.currentPlannedEffectIds);
  if (!plannedIds) throw new Error("invalid_current_receipt_effect_plan");
  const existing = asRecord(input.existingReceipt);
  if (!existing) {
    return {
      kind: "create",
      effectIds: plannedIds,
      planMode: input.currentMode,
    };
  }
  const strictReplayRecord = input.strictReplayRecord &&
      isStrictPublicReplayIdentityPair(input.record, input.strictReplayRecord)
    ? input.strictReplayRecord
    : undefined;
  const exactLegacyReplay = input.sha256Hex &&
    (
      isExactLegacyCanaryReceipt(existing, input.record, input.sha256Hex) ||
      (
        strictReplayRecord !== undefined &&
        isExactLegacyCanaryReceipt(existing, strictReplayRecord, input.sha256Hex)
      )
    );
  if (exactLegacyReplay) {
    return {
      kind: "legacy_replay",
      effectIds: [],
      planMode: "none",
      migrateReceipt: true,
    };
  }
  const storedIds = boundedEffectIds(existing.outboxEffectIds);
  const storedMode = existing.outboxPlanMode;
  if (
    !hasCurrentCanaryReceiptIdentity(existing, input.record) &&
    !(
      strictReplayRecord &&
      hasCurrentCanaryReceiptIdentity(existing, strictReplayRecord)
    )
  ) {
    throw new Error("meta_canary_receipt_collision");
  }
  if (
    existing.outboxPlanVersion === 1 &&
    existing.outboxPlanMode === "none" &&
    Array.isArray(existing.outboxEffectIds) &&
    existing.outboxEffectIds.length === 0 &&
    existing.legacyReceiptNoEffects === true &&
    existing.fromNumber === undefined
  ) {
    return {
      kind: "legacy_replay",
      effectIds: [],
      planMode: "none",
      migrateReceipt: false,
    };
  }
  if (
    existing.outboxPlanVersion === undefined &&
    existing.outboxEffectIds === undefined &&
    existing.outboxPlanMode === undefined
  ) {
    return {
      kind: "legacy_replay",
      effectIds: [],
      planMode: "none",
      migrateReceipt: true,
    };
  }
  if (
    existing.outboxPlanVersion !== 1 ||
    (storedMode !== "bot" && storedMode !== "auto_reply" && storedMode !== "none") ||
    !storedIds ||
    existing.legacyReceiptNoEffects !== undefined ||
    existing.migratedAt !== undefined
  ) {
    throw new Error("meta_canary_receipt_collision");
  }
  return {
    kind: "replay",
    effectIds: storedIds,
    planMode: storedMode,
  };
}

export function isCanaryReceiptEffectSequenceValid(input: {
  readonly recordKind: CanaryInboundRecord["kind"];
  readonly planMode: CanaryReceiptPlanMode;
  readonly effectKinds: readonly CanaryOutboxEffectKind[];
}): boolean {
  if (input.recordKind === "status") {
    return input.effectKinds.length === 1 && input.effectKinds[0] === "campaign_status";
  }
  if (input.effectKinds[0] !== "inbound_metric" || input.effectKinds.length > 2) {
    return false;
  }
  const second = input.effectKinds[1];
  if (second === undefined) return true;
  if (second === "stop_suppression") return true;
  if (input.planMode === "bot") return second === "bot_plan";
  if (input.planMode === "auto_reply") return second === "graph_auto_reply";
  return false;
}

export function buildInitialCanaryOutboxEffects(input: {
  readonly records: readonly CanaryInboundRecord[];
  readonly allowlistedMessages: readonly CanaryBotMessage[];
  readonly optOuts: readonly CanaryMarketingOptOut[];
  /** Signed-inbound encrypted return route, keyed by provider message id. */
  readonly inboundReturnRouteIds?: ReadonlyMap<string, string>;
  readonly mode: "bot" | "auto_reply" | "none";
  readonly welcomeMediaId?: string | null;
  readonly nowMs: number;
  readonly sha256Hex: (value: string) => string;
}): readonly CanaryOutboxRecord[] {
  if (input.records.length > META_CANARY_MAX_WEBHOOK_EVENTS) {
    throw new Error("meta_canary_webhook_batch_overflow");
  }
  const messages = new Map(input.allowlistedMessages.map((message) => [message.waMessageId, message]));
  const optOuts = new Map(input.optOuts.map((optOut) => [optOut.waMessageId, optOut]));
  const optedOutWaIds = new Set(input.optOuts.map((optOut) => optOut.waId));
  const effects: CanaryOutboxRecord[] = [];
  const welcomeMediaId =
    typeof input.welcomeMediaId === "string" &&
    /^[A-Za-z0-9._:-]{5,128}$/.test(input.welcomeMediaId)
      ? input.welcomeMediaId
      : null;
  for (const record of input.records) {
    if (record.kind === "status") {
      const id = canaryOutboxEffectId(record.id, "campaign_status", record.statusValue ?? "status", input.sha256Hex);
      effects.push(buildCanaryOutboxRecord({
        id,
        receiptId: record.id,
        effectKind: "campaign_status",
        payload: {
          providerMessageRef: record.waMessageId,
          status: record.statusValue,
        },
        nowMs: input.nowMs,
      }));
      continue;
    }

    const metricId = canaryOutboxEffectId(record.id, "inbound_metric", "message", input.sha256Hex);
    effects.push(buildCanaryOutboxRecord({
      id: metricId,
      receiptId: record.id,
      effectKind: "inbound_metric",
      payload: { occurredAtMs: input.nowMs },
      nowMs: input.nowMs,
    }));

    const optOut = optOuts.get(record.waMessageId);
    if (optOut) {
      const id = canaryOutboxEffectId(record.id, "stop_suppression", optOut.keyword, input.sha256Hex);
      effects.push(buildCanaryOutboxRecord({
        id,
        receiptId: record.id,
        effectKind: "stop_suppression",
        payload: {
          recipientSha256: record.fromNumberSha256,
          recipientLast4: record.fromNumberLast4,
          keywordCode: optOut.keyword,
        },
        nowMs: input.nowMs,
        state: "terminal",
      }));
      continue;
    }

    const message = messages.get(record.waMessageId);
    if (message && optedOutWaIds.has(message.waId)) {
      // A private STOP/UNSUBSCRIBE suppresses every automation candidate from
      // the same sender in this signed envelope, not just the exact STOP event.
      continue;
    }
    const inboundReturnRouteId = input.inboundReturnRouteIds?.get(record.waMessageId);
    if (
      inboundReturnRouteId !== undefined &&
      !/^return_route_[0-9a-f]{40}$/.test(inboundReturnRouteId)
    ) {
      throw new Error("invalid_inbound_return_route_id");
    }
    if (
      !message ||
      !record.fromNumberSha256 ||
      (!record.fromNumberLast4 && !inboundReturnRouteId) ||
      input.mode === "none"
    ) {
      continue;
    }
    const effectKind = input.mode === "bot" ? "bot_plan" : "graph_auto_reply";
    const id = canaryOutboxEffectId(record.id, effectKind, "primary", input.sha256Hex);
    effects.push(buildCanaryOutboxRecord({
      id,
      receiptId: record.id,
      effectKind,
      payload: {
        recipientSha256: record.fromNumberSha256,
        ...(record.fromNumberLast4
          ? { recipientLast4: record.fromNumberLast4 }
          : {}),
        providerMessageRef: record.waMessageId,
        messageType: message.messageType,
        ...(effectKind === "bot_plan" ? { botInput: durableBotInput(message) } : {}),
        ...(effectKind === "bot_plan" ? { welcomeMediaId } : {}),
        ...(inboundReturnRouteId ? { inboundReturnRouteId } : {}),
        occurredAtMs: input.nowMs,
      },
      nowMs: input.nowMs,
    }));
  }
  if (effects.length > META_CANARY_MAX_INITIAL_OUTBOX_EFFECTS) {
    throw new Error("meta_canary_effect_batch_overflow");
  }
  return effects;
}

export function assertMetaCanaryReconcilerAuthorization(input: {
  readonly uid: unknown;
  readonly emailVerified: unknown;
  readonly hemasMetaCanary: unknown;
  readonly hemasMetaCanaryAdmin: unknown;
}): string {
  if (
    typeof input.uid !== "string" ||
    input.uid.length === 0 ||
    input.uid.length > 128 ||
    input.emailVerified !== true ||
    input.hemasMetaCanary !== true ||
    input.hemasMetaCanaryAdmin !== true
  ) {
    throw new Error("meta canary reconciler authorization required");
  }
  return input.uid;
}

/** Token claims are inert unless the matching workspace membership is active. */
export function isActiveMetaCanaryMembership(input: {
  readonly membership: unknown;
  readonly uid: string;
  readonly requireAdmin: boolean;
}): boolean {
  const member = asRecord(input.membership);
  if (
    !member ||
    !input.uid ||
    member.id !== input.uid ||
    member.uid !== input.uid ||
    member.workspaceId !== META_CANARY_WORKSPACE_ID ||
    member.status !== "active" ||
    member.synthetic !== true ||
    (member.role !== "agent" &&
      member.role !== "supervisor" &&
      member.role !== "tenant_admin")
  ) {
    return false;
  }
  return !input.requireAdmin || member.role === "tenant_admin";
}

export function assertMetaCanaryOperationId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{15,95}$/.test(value)
  ) {
    throw new Error("meta canary operation id is invalid");
  }
  return value;
}

/** A successful Graph dispatch is not durable evidence without its provider id. */
export function assertCanaryProviderMessageId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > 512
  ) {
    throw new Error("missing_provider_message_id");
  }
  return value;
}

export type CanaryFatalResolutionEffectKind =
  | "graph_bot_reply"
  | "graph_auto_reply"
  | "graph_template_send";
export type CanaryFatalResolutionOutcome =
  | "confirmed_sent"
  | "confirmed_not_sent";

export type CanaryFatalResolutionInput = {
  readonly effectId: string;
  readonly requestSha256: string;
  readonly effectKind: CanaryFatalResolutionEffectKind;
  readonly outcome: CanaryFatalResolutionOutcome;
  readonly providerMessageId: string | null;
  readonly providerEvidenceSha256: string;
};

export function canaryFatalResolutionRequestSha256(
  input: Omit<CanaryFatalResolutionInput, "requestSha256">,
  sha256Hex: (value: string) => string,
): string {
  return sha256Hex(JSON.stringify([
    "meta-canary-fatal-resolution:v1",
    input.effectId,
    input.effectKind,
    input.outcome,
    input.providerMessageId,
    input.providerEvidenceSha256,
  ]));
}

/** Exact evidence-only admin input. It never carries send authority. */
export function assertCanaryFatalResolutionInput(
  raw: unknown,
  sha256Hex: (value: string) => string,
): CanaryFatalResolutionInput {
  const input = asRecord(raw);
  const exactKeys = [
    "effectId",
    "requestSha256",
    "effectKind",
    "outcome",
    "providerMessageId",
    "providerEvidenceSha256",
  ];
  if (
    !input ||
    Object.keys(input).length !== exactKeys.length ||
    !Object.keys(input).every((key) => exactKeys.includes(key)) ||
    typeof input.effectId !== "string" ||
    !/^fx_[0-9a-f]{8,64}$/.test(input.effectId) ||
    typeof input.requestSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(input.requestSha256) ||
    (input.effectKind !== "graph_bot_reply" &&
      input.effectKind !== "graph_auto_reply" &&
      input.effectKind !== "graph_template_send") ||
    (input.outcome !== "confirmed_sent" &&
      input.outcome !== "confirmed_not_sent") ||
    typeof input.providerEvidenceSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(input.providerEvidenceSha256)
  ) {
    throw new Error("invalid_meta_canary_fatal_resolution_input");
  }
  const providerMessageId = input.outcome === "confirmed_sent"
    ? assertCanaryProviderMessageId(input.providerMessageId)
    : input.providerMessageId === null
      ? null
      : (() => {
        throw new Error("confirmed_not_sent_requires_null_provider_id");
      })();
  const parsed: CanaryFatalResolutionInput = {
    effectId: input.effectId,
    requestSha256: input.requestSha256,
    effectKind: input.effectKind,
    outcome: input.outcome,
    providerMessageId,
    providerEvidenceSha256: input.providerEvidenceSha256,
  };
  if (
    canaryFatalResolutionRequestSha256(
      {
        effectId: parsed.effectId,
        effectKind: parsed.effectKind,
        outcome: parsed.outcome,
        providerMessageId: parsed.providerMessageId,
        providerEvidenceSha256: parsed.providerEvidenceSha256,
      },
      sha256Hex,
    ) !== parsed.requestSha256
  ) {
    throw new Error("meta_canary_fatal_resolution_request_hash_mismatch");
  }
  return parsed;
}

export function canaryFatalResolutionId(
  effectId: string,
  requestSha256: string,
  sha256Hex: (value: string) => string,
): string {
  return `fatal_reconcile_${sha256Hex(
    `meta-canary-fatal-reconciliation:v1:${effectId}:${requestSha256}`,
  ).slice(0, 32)}`;
}

export type CanaryFatalResolutionAudit = {
  readonly id: string;
  readonly workspaceId: typeof META_CANARY_WORKSPACE_ID;
  readonly effectId: string;
  readonly effectKind: CanaryFatalResolutionEffectKind;
  readonly requestSha256: string;
  readonly outcome: CanaryFatalResolutionOutcome;
  readonly providerMessageIdSha256: string | null;
  readonly providerEvidenceSha256: string;
  readonly reconciledByUidSha256: string;
  readonly containsMessageContent: false;
  readonly containsFullSender: false;
  readonly schemaVersion: 1;
};

export function buildCanaryFatalResolutionAudit(input: {
  readonly resolution: CanaryFatalResolutionInput;
  readonly actorUid: string;
  readonly sha256Hex: (value: string) => string;
}): CanaryFatalResolutionAudit {
  if (!input.actorUid || input.actorUid.length > 128) {
    throw new Error("invalid_meta_canary_reconciliation_actor");
  }
  return {
    id: canaryFatalResolutionId(
      input.resolution.effectId,
      input.resolution.requestSha256,
      input.sha256Hex,
    ),
    workspaceId: META_CANARY_WORKSPACE_ID,
    effectId: input.resolution.effectId,
    effectKind: input.resolution.effectKind,
    requestSha256: input.resolution.requestSha256,
    outcome: input.resolution.outcome,
    providerMessageIdSha256: input.resolution.providerMessageId
      ? input.sha256Hex(input.resolution.providerMessageId)
      : null,
    providerEvidenceSha256: input.resolution.providerEvidenceSha256,
    reconciledByUidSha256: input.sha256Hex(
      `meta-canary-reconciliation-actor:${input.actorUid}`,
    ),
    containsMessageContent: false,
    containsFullSender: false,
    schemaVersion: 1,
  };
}

export type CanaryFatalResolutionDecision =
  | { readonly kind: "apply"; readonly effect: CanaryOutboxRecord }
  | { readonly kind: "replay"; readonly effect: CanaryOutboxRecord };

function exactCanaryFatalAudit(
  raw: unknown,
  expected: CanaryFatalResolutionAudit,
): boolean {
  const audit = asRecord(raw);
  return Boolean(
    audit &&
    audit.id === expected.id &&
    audit.workspaceId === expected.workspaceId &&
    audit.effectId === expected.effectId &&
    audit.effectKind === expected.effectKind &&
    audit.requestSha256 === expected.requestSha256 &&
    audit.outcome === expected.outcome &&
    audit.providerMessageIdSha256 === expected.providerMessageIdSha256 &&
    audit.providerEvidenceSha256 === expected.providerEvidenceSha256 &&
    typeof audit.reconciledByUidSha256 === "string" &&
    /^[0-9a-f]{64}$/.test(audit.reconciledByUidSha256) &&
    audit.containsMessageContent === false &&
    audit.containsFullSender === false &&
    audit.schemaVersion === 1,
  );
}

export function decideCanaryFatalResolution(input: {
  readonly rawEffect: unknown;
  readonly rawAudit: unknown;
  readonly resolution: CanaryFatalResolutionInput;
  readonly expectedAudit: CanaryFatalResolutionAudit;
}): CanaryFatalResolutionDecision {
  const effect = parseCanaryOutboxRecord(input.rawEffect);
  if (!effect || effect.id !== input.resolution.effectId) {
    throw new Error("meta_canary_fatal_effect_missing");
  }
  if (effect.effectKind !== input.resolution.effectKind) {
    throw new Error("meta_canary_fatal_effect_kind_conflict");
  }
  if (
    effect.state === "terminal" &&
    (effect.terminalReason === "reconciled_sent" ||
      effect.terminalReason === "reconciled_not_sent")
  ) {
    if (
      effect.reconciliationId !== input.expectedAudit.id ||
      effect.reconciliationRequestSha256 !== input.resolution.requestSha256 ||
      effect.reconciliationOutcome !== input.resolution.outcome ||
      effect.reconciliationEvidenceSha256 !==
        input.resolution.providerEvidenceSha256 ||
      effect.resultProviderMessageId !== input.resolution.providerMessageId ||
      asRecord(input.rawAudit)?.reconciledByUidSha256 !==
        effect.reconciledByUidSha256 ||
      !exactCanaryFatalAudit(input.rawAudit, input.expectedAudit)
    ) {
      throw new Error("meta_canary_fatal_resolution_conflict");
    }
    return { kind: "replay", effect };
  }
  if (
    effect.state !== "fatal" ||
    effect.dispatchStartedAtMs === null ||
    effect.completedAtMs !== null ||
    effect.terminalReason !== null ||
    effect.resultProviderMessageId !== null ||
    effect.lastErrorCode === null ||
    input.rawAudit !== undefined
  ) {
    throw new Error("meta_canary_effect_is_not_fatal_post_dispatch");
  }
  return { kind: "apply", effect };
}

export function reconcileCanaryFatalOutboxRecord(input: {
  readonly effect: CanaryOutboxRecord;
  readonly resolution: CanaryFatalResolutionInput;
  readonly audit: CanaryFatalResolutionAudit;
  readonly nowMs: number;
}): CanaryOutboxRecord {
  if (
    input.effect.state !== "fatal" ||
    input.effect.dispatchStartedAtMs === null ||
    input.effect.effectKind !== input.resolution.effectKind ||
    input.effect.id !== input.resolution.effectId
  ) {
    throw new Error("meta_canary_effect_is_not_reconcilable");
  }
  const { dueAtMs: _dueAtMs, ...withoutDueAt } = input.effect;
  return {
    ...withoutDueAt,
    state: "terminal",
    completedAtMs: input.nowMs,
    terminalReason: input.resolution.outcome === "confirmed_sent"
      ? "reconciled_sent"
      : "reconciled_not_sent",
    resultProviderMessageId: input.resolution.providerMessageId,
    reconciliationId: input.audit.id,
    reconciliationRequestSha256: input.resolution.requestSha256,
    reconciliationOutcome: input.resolution.outcome,
    reconciliationEvidenceSha256: input.resolution.providerEvidenceSha256,
    reconciledByUidSha256: input.audit.reconciledByUidSha256,
    reconciledAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
  };
}

export function canaryTemplateOperationDocumentId(
  operationId: string,
  sha256Hex: (value: string) => string,
): string {
  return `manual_${sha256Hex(`meta-canary-template-operation:v1:${operationId}`).slice(0, 32)}`;
}

export function canaryTemplateRequestSha256(
  input: {
    readonly operationId: string;
    readonly actorUid: string;
    readonly recipient: string;
    readonly templateName: string;
    readonly languageCode: string;
  },
  sha256Hex: (value: string) => string,
): string {
  return sha256Hex(JSON.stringify([
    "meta-canary-template-request:v1",
    input.operationId,
    input.actorUid,
    input.recipient,
    input.templateName,
    input.languageCode,
  ]));
}

export type CanaryTemplateOperationDecision =
  | { readonly kind: "reserve" }
  | { readonly kind: "process" }
  | {
    readonly kind: "suppressed";
    readonly reasonCode: string;
  }
  | {
    readonly kind: "not_sent";
    readonly reasonCode: string;
  }
  | {
    readonly kind: "replay";
    readonly result: {
      readonly sent: true;
      readonly providerMessageId: string;
      readonly toLast4: string;
      readonly canary: true;
      readonly idempotent: true;
    };
  };

/** Pure collision/replay guard for one manual template-send operation. */
export function decideCanaryTemplateOperation(
  raw: unknown,
  expected: {
    readonly id: string;
    readonly operationId: string;
    readonly actorUid: string;
    readonly requestSha256: string;
    readonly toLast4: string;
  },
): CanaryTemplateOperationDecision {
  const record = asRecord(raw);
  if (!record) return { kind: "reserve" };
  if (
    record.id !== expected.id ||
    record.operationId !== expected.operationId ||
    record.actorUid !== expected.actorUid ||
    record.requestSha256 !== expected.requestSha256 ||
    record.toNumberLast4 !== expected.toLast4 ||
    record.containsMessageContent !== false ||
    record.containsFullRecipient !== false
  ) {
    throw new Error("meta canary template operation conflict");
  }
  if (record.status === "reserved") return { kind: "process" };
  if (record.status === "sent") {
    const providerMessageId = assertCanaryProviderMessageId(record.providerMessageId);
    return {
      kind: "replay",
      result: {
        sent: true,
        providerMessageId,
        toLast4: expected.toLast4,
        canary: true,
        idempotent: true,
      },
    };
  }
  if (record.status === "suppressed") {
    if (
      record.providerMessageId !== null ||
      typeof record.suppressionReasonCode !== "string" ||
      !/^[a-z_]{3,64}$/.test(record.suppressionReasonCode)
    ) {
      throw new Error("meta canary template suppression evidence is malformed");
    }
    return {
      kind: "suppressed",
      reasonCode: record.suppressionReasonCode,
    };
  }
  if (record.status === "not_sent") {
    if (
      record.providerMessageId !== null ||
      typeof record.failureReasonCode !== "string" ||
      !/^[a-z0-9_:-]{3,64}$/.test(record.failureReasonCode)
    ) {
      throw new Error("meta canary template no-send evidence is malformed");
    }
    return {
      kind: "not_sent",
      reasonCode: record.failureReasonCode,
    };
  }
  if (record.status === "processing" || record.status === "uncertain") {
    throw new Error("meta canary template provider outcome is ambiguous");
  }
  throw new Error("meta canary template operation evidence is malformed");
}
