import { createHash } from "node:crypto";

/**
 * Content-free, fixed-window quota decisions for the public Meta canary.
 *
 * The caller must:
 * - pass only fresh receipt candidates, in provider order;
 * - read and write the returned counter documents in one transaction; and
 * - treat PublicQuotaError as a fail-closed outcome.
 *
 * This module deliberately knows neither message bodies nor plaintext senders.
 */
export const META_CANARY_PUBLIC_QUOTA_COLLECTION =
  "canary_public_quota_counters" as const;
export const META_CANARY_PUBLIC_QUOTA_SCHEMA_VERSION = 1 as const;
export const META_CANARY_PUBLIC_QUOTA_MAX_CANDIDATES = 40;
export const META_CANARY_PUBLIC_MAX_MESSAGE_AGE_MS = 5 * 60_000;
export const META_CANARY_PUBLIC_MAX_MESSAGE_FUTURE_MS = 60_000;

/**
 * Bounded env override for the two AI budgets. Defaults stay the governed
 * baseline (3 model calls per sender per day, 100 per day overall). During an
 * evaluation demo the operator may raise them via
 * HEMAS_META_PUBLIC_AI_SENDER_DAY / HEMAS_META_PUBLIC_AI_GLOBAL_DAY, still
 * capped here so a typo can never remove the budget entirely.
 */
function boundedEnvLimit(name: string, fallback: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw || !/^\d{1,5}$/.test(raw)) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1 && value <= max ? value : fallback;
}

export const META_CANARY_PUBLIC_QUOTA_LIMITS = Object.freeze({
  senderMinute: 6,
  senderDay: 20,
  globalMinute: 60,
  globalDay: 500,
  aiSenderDay: boundedEnvLimit("HEMAS_META_PUBLIC_AI_SENDER_DAY", 3, 50),
  aiGlobalDay: boundedEnvLimit("HEMAS_META_PUBLIC_AI_GLOBAL_DAY", 100, 2_000),
});

export const META_CANARY_PUBLIC_QUOTA_WINDOWS_MS = Object.freeze({
  minute: 60_000,
  day: 86_400_000,
});

/** TTL is intentionally later than the fixed window; enforcement uses bucket IDs. */
export const META_CANARY_PUBLIC_QUOTA_GRACE_MS = Object.freeze({
  minute: 6 * 60_000,
  day: 86_400_000,
});

const SHA256_HEX = /^[0-9a-f]{64}$/;
const RECEIPT_ID_MAX_LENGTH = 160;

export type MetaCanaryPublicQuotaCounterKind =
  | "inbound_sender_minute"
  | "inbound_sender_day"
  | "inbound_global_minute"
  | "inbound_global_day"
  | "ai_sender_day"
  | "ai_global_day";

export type MetaCanaryPublicQuotaCandidate = {
  readonly receiptId: string;
  readonly senderSha256: string;
  /** Strict Meta provider timestamp converted from Unix seconds. */
  readonly occurredAtMs: number;
  /** Whether this admitted receipt may reserve one governed model call. */
  readonly aiEligible: boolean;
};

export type MetaCanaryPublicQuotaCounterRecord = {
  readonly schemaVersion: typeof META_CANARY_PUBLIC_QUOTA_SCHEMA_VERSION;
  readonly counterId: string;
  readonly counterKind: MetaCanaryPublicQuotaCounterKind;
  readonly scopeSha256: string;
  readonly bucketStartMs: number;
  readonly windowMs: number;
  readonly limit: number;
  readonly count: number;
  readonly expiresAtMs: number;
  readonly containsMessageContent: false;
  readonly containsPlaintextSender: false;
};

export type AllocateMetaCanaryPublicQuotaInput = {
  readonly candidates: readonly MetaCanaryPublicQuotaCandidate[];
  readonly nowMs: number;
  /** A map keyed by counterId. Missing records mean a zero count. */
  readonly currentCounterRecords: Readonly<Record<string, unknown>>;
};

export type MetaCanaryPublicQuotaDecision = {
  readonly allowedReceiptIds: readonly string[];
  readonly suppressedReceiptIds: readonly string[];
  /** Admitted receipts that also reserved both sender/global AI counters. */
  readonly aiBudgetReceiptIds: readonly string[];
  /** Only records changed by this decision; write all of them atomically. */
  readonly updatedCounterRecords: Readonly<
    Record<string, MetaCanaryPublicQuotaCounterRecord>
  >;
};

/** All malformed inputs and stored state deliberately share one safe error. */
export class MetaCanaryPublicQuotaError extends Error {
  readonly code = "public_quota_invalid" as const;

  constructor() {
    super("Public canary quota state is invalid or unavailable.");
    this.name = "MetaCanaryPublicQuotaError";
  }
}

function refuse(): never {
  throw new MetaCanaryPublicQuotaError();
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const GLOBAL_SCOPE_SHA256 = sha256Hex("meta-canary-public-quota:global:v1");

const COUNTER_KINDS = [
  "ai_global_day",
  "ai_sender_day",
  "inbound_global_day",
  "inbound_global_minute",
  "inbound_sender_day",
  "inbound_sender_minute",
] as const satisfies readonly MetaCanaryPublicQuotaCounterKind[];

const INBOUND_COUNTER_KINDS = [
  "inbound_sender_minute",
  "inbound_sender_day",
  "inbound_global_minute",
  "inbound_global_day",
] as const satisfies readonly MetaCanaryPublicQuotaCounterKind[];

const AI_COUNTER_KINDS = [
  "ai_sender_day",
  "ai_global_day",
] as const satisfies readonly MetaCanaryPublicQuotaCounterKind[];

const COUNTER_KIND_SET = new Set<string>(COUNTER_KINDS);
const COUNTER_KIND_SHA256: Readonly<Record<MetaCanaryPublicQuotaCounterKind, string>> =
  Object.freeze({
    inbound_sender_minute: sha256Hex("public-quota-kind:inbound-sender-minute:v1"),
    inbound_sender_day: sha256Hex("public-quota-kind:inbound-sender-day:v1"),
    inbound_global_minute: sha256Hex("public-quota-kind:inbound-global-minute:v1"),
    inbound_global_day: sha256Hex("public-quota-kind:inbound-global-day:v1"),
    ai_sender_day: sha256Hex("public-quota-kind:ai-sender-day:v1"),
    ai_global_day: sha256Hex("public-quota-kind:ai-global-day:v1"),
  });

const STRICT_COUNTER_KEYS = [
  "bucketStartMs",
  "containsMessageContent",
  "containsPlaintextSender",
  "count",
  "counterId",
  "counterKind",
  "expiresAtMs",
  "limit",
  "schemaVersion",
  "scopeSha256",
  "windowMs",
] as const;

type CounterDefinition = {
  readonly windowMs: number;
  readonly graceMs: number;
  readonly limit: number;
  readonly global: boolean;
};

function counterDefinition(kind: MetaCanaryPublicQuotaCounterKind): CounterDefinition {
  switch (kind) {
    case "inbound_sender_minute":
      return {
        windowMs: META_CANARY_PUBLIC_QUOTA_WINDOWS_MS.minute,
        graceMs: META_CANARY_PUBLIC_QUOTA_GRACE_MS.minute,
        limit: META_CANARY_PUBLIC_QUOTA_LIMITS.senderMinute,
        global: false,
      };
    case "inbound_sender_day":
      return {
        windowMs: META_CANARY_PUBLIC_QUOTA_WINDOWS_MS.day,
        graceMs: META_CANARY_PUBLIC_QUOTA_GRACE_MS.day,
        limit: META_CANARY_PUBLIC_QUOTA_LIMITS.senderDay,
        global: false,
      };
    case "inbound_global_minute":
      return {
        windowMs: META_CANARY_PUBLIC_QUOTA_WINDOWS_MS.minute,
        graceMs: META_CANARY_PUBLIC_QUOTA_GRACE_MS.minute,
        limit: META_CANARY_PUBLIC_QUOTA_LIMITS.globalMinute,
        global: true,
      };
    case "inbound_global_day":
      return {
        windowMs: META_CANARY_PUBLIC_QUOTA_WINDOWS_MS.day,
        graceMs: META_CANARY_PUBLIC_QUOTA_GRACE_MS.day,
        limit: META_CANARY_PUBLIC_QUOTA_LIMITS.globalDay,
        global: true,
      };
    case "ai_sender_day":
      return {
        windowMs: META_CANARY_PUBLIC_QUOTA_WINDOWS_MS.day,
        graceMs: META_CANARY_PUBLIC_QUOTA_GRACE_MS.day,
        limit: META_CANARY_PUBLIC_QUOTA_LIMITS.aiSenderDay,
        global: false,
      };
    case "ai_global_day":
      return {
        windowMs: META_CANARY_PUBLIC_QUOTA_WINDOWS_MS.day,
        graceMs: META_CANARY_PUBLIC_QUOTA_GRACE_MS.day,
        limit: META_CANARY_PUBLIC_QUOTA_LIMITS.aiGlobalDay,
        global: true,
      };
  }
}

function isSafeTimestamp(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= 0 &&
    Number(value) <= Number.MAX_SAFE_INTEGER - 2 * META_CANARY_PUBLIC_QUOTA_WINDOWS_MS.day
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

function isCounterKind(value: unknown): value is MetaCanaryPublicQuotaCounterKind {
  return typeof value === "string" && COUNTER_KIND_SET.has(value);
}

function fixedBucketStart(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs) * windowMs;
}

function scopeForKind(
  kind: MetaCanaryPublicQuotaCounterKind,
  senderSha256: string,
): string {
  return counterDefinition(kind).global ? GLOBAL_SCOPE_SHA256 : senderSha256;
}

/**
 * Counter document IDs contain only two SHA-256 hashes and a numeric bucket.
 * They never contain a receipt ID, message body, or plaintext sender.
 */
export function metaCanaryPublicQuotaCounterId(input: {
  readonly counterKind: MetaCanaryPublicQuotaCounterKind;
  readonly scopeSha256: string;
  readonly bucketStartMs: number;
}): string {
  if (
    !isCounterKind(input.counterKind) ||
    !isSha256(input.scopeSha256) ||
    !isSafeTimestamp(input.bucketStartMs)
  ) {
    refuse();
  }
  const definition = counterDefinition(input.counterKind);
  if (input.bucketStartMs % definition.windowMs !== 0) refuse();
  return `${COUNTER_KIND_SHA256[input.counterKind]}.${input.scopeSha256}.${input.bucketStartMs}`;
}

function validateCandidates(
  candidates: readonly MetaCanaryPublicQuotaCandidate[],
  receivedAtMs: number,
): void {
  if (
    !Array.isArray(candidates) ||
    candidates.length > META_CANARY_PUBLIC_QUOTA_MAX_CANDIDATES
  ) {
    refuse();
  }

  const receiptIds = new Set<string>();
  for (const candidate of candidates) {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate)
    ) {
      refuse();
    }
    const prototype = Object.getPrototypeOf(candidate);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      Object.keys(candidate).sort().join(",") !==
        "aiEligible,occurredAtMs,receiptId,senderSha256" ||
      typeof candidate.receiptId !== "string" ||
      candidate.receiptId.length < 4 ||
      candidate.receiptId.length > RECEIPT_ID_MAX_LENGTH ||
      !isSha256(candidate.senderSha256) ||
      !isSafeTimestamp(candidate.occurredAtMs) ||
      candidate.occurredAtMs <
        Math.max(0, receivedAtMs - META_CANARY_PUBLIC_MAX_MESSAGE_AGE_MS) ||
      candidate.occurredAtMs >
        receivedAtMs + META_CANARY_PUBLIC_MAX_MESSAGE_FUTURE_MS ||
      typeof candidate.aiEligible !== "boolean" ||
      receiptIds.has(candidate.receiptId)
    ) {
      refuse();
    }
    receiptIds.add(candidate.receiptId);
  }
}

function counterIdFor(
  kind: MetaCanaryPublicQuotaCounterKind,
  senderSha256: string,
  nowMs: number,
): string {
  const definition = counterDefinition(kind);
  return metaCanaryPublicQuotaCounterId({
    counterKind: kind,
    scopeSha256: scopeForKind(kind, senderSha256),
    bucketStartMs: fixedBucketStart(nowMs, definition.windowMs),
  });
}

/** IDs the caller must transactionally read before allocating this batch. */
export function metaCanaryPublicQuotaCounterIds(input: {
  readonly candidates: readonly MetaCanaryPublicQuotaCandidate[];
  readonly nowMs: number;
}): readonly string[] {
  if (!isSafeTimestamp(input.nowMs)) refuse();
  validateCandidates(input.candidates, input.nowMs);

  const ids = new Set<string>();
  for (const candidate of input.candidates) {
    for (const kind of INBOUND_COUNTER_KINDS) {
      ids.add(counterIdFor(kind, candidate.senderSha256, candidate.occurredAtMs));
    }
    if (candidate.aiEligible) {
      for (const kind of AI_COUNTER_KINDS) {
        ids.add(counterIdFor(kind, candidate.senderSha256, candidate.occurredAtMs));
      }
    }
  }
  return [...ids].sort();
}

/** Strict parser for stored quota state. Any mismatch fails closed. */
export function parseMetaCanaryPublicQuotaCounterRecord(
  value: unknown,
): MetaCanaryPublicQuotaCounterRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) refuse();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) refuse();

  const data = value as Record<string, unknown>;
  const keys = Object.keys(data).sort();
  if (
    keys.length !== STRICT_COUNTER_KEYS.length ||
    keys.some((key, index) => key !== STRICT_COUNTER_KEYS[index]) ||
    data.schemaVersion !== META_CANARY_PUBLIC_QUOTA_SCHEMA_VERSION ||
    typeof data.counterId !== "string" ||
    !isCounterKind(data.counterKind) ||
    !isSha256(data.scopeSha256) ||
    !isSafeTimestamp(data.bucketStartMs) ||
    !Number.isSafeInteger(data.windowMs) ||
    !Number.isSafeInteger(data.limit) ||
    !Number.isSafeInteger(data.count) ||
    !isSafeTimestamp(data.expiresAtMs) ||
    data.containsMessageContent !== false ||
    data.containsPlaintextSender !== false
  ) {
    refuse();
  }

  const kind = data.counterKind;
  const definition = counterDefinition(kind);
  const bucketStartMs = data.bucketStartMs;
  const expectedCounterId = metaCanaryPublicQuotaCounterId({
    counterKind: kind,
    scopeSha256: data.scopeSha256,
    bucketStartMs,
  });
  if (
    data.counterId !== expectedCounterId ||
    (definition.global && data.scopeSha256 !== GLOBAL_SCOPE_SHA256) ||
    data.windowMs !== definition.windowMs ||
    data.limit !== definition.limit ||
    Number(data.count) < 0 ||
    Number(data.count) > definition.limit ||
    data.expiresAtMs !== bucketStartMs + definition.windowMs + definition.graceMs
  ) {
    refuse();
  }

  return data as MetaCanaryPublicQuotaCounterRecord;
}

function newCounterRecord(
  kind: MetaCanaryPublicQuotaCounterKind,
  senderSha256: string,
  nowMs: number,
): MetaCanaryPublicQuotaCounterRecord {
  const definition = counterDefinition(kind);
  const scopeSha256 = scopeForKind(kind, senderSha256);
  const bucketStartMs = fixedBucketStart(nowMs, definition.windowMs);
  return {
    schemaVersion: META_CANARY_PUBLIC_QUOTA_SCHEMA_VERSION,
    counterId: metaCanaryPublicQuotaCounterId({
      counterKind: kind,
      scopeSha256,
      bucketStartMs,
    }),
    counterKind: kind,
    scopeSha256,
    bucketStartMs,
    windowMs: definition.windowMs,
    limit: definition.limit,
    count: 0,
    expiresAtMs: bucketStartMs + definition.windowMs + definition.graceMs,
    containsMessageContent: false,
    containsPlaintextSender: false,
  };
}

/**
 * Allocates inbound quota in candidate order.
 *
 * Inbound admission is all-or-nothing across sender/global minute/day counters.
 * After inbound admission, an AI-eligible receipt atomically reserves both its
 * sender/global daily AI counters. Exhausted AI capacity never suppresses the
 * inbound receipt; callers must use the deterministic bot fallback instead.
 */
export function allocateMetaCanaryPublicQuota(
  input: AllocateMetaCanaryPublicQuotaInput,
): MetaCanaryPublicQuotaDecision {
  if (!isSafeTimestamp(input.nowMs)) refuse();
  validateCandidates(input.candidates, input.nowMs);
  if (
    typeof input.currentCounterRecords !== "object" ||
    input.currentCounterRecords === null ||
    Array.isArray(input.currentCounterRecords)
  ) {
    refuse();
  }
  const mapPrototype = Object.getPrototypeOf(input.currentCounterRecords);
  if (mapPrototype !== Object.prototype && mapPrototype !== null) refuse();

  const working = new Map<string, MetaCanaryPublicQuotaCounterRecord>();
  for (const [key, value] of Object.entries(input.currentCounterRecords)) {
    const record = parseMetaCanaryPublicQuotaCounterRecord(value);
    if (key !== record.counterId || working.has(key)) refuse();
    working.set(key, record);
  }

  const allowedReceiptIds: string[] = [];
  const suppressedReceiptIds: string[] = [];
  const aiBudgetReceiptIds: string[] = [];
  const updatedCounterRecords: Record<string, MetaCanaryPublicQuotaCounterRecord> = {};

  const readCounter = (
    kind: MetaCanaryPublicQuotaCounterKind,
    senderSha256: string,
    occurredAtMs: number,
  ): MetaCanaryPublicQuotaCounterRecord => {
    const fresh = newCounterRecord(kind, senderSha256, occurredAtMs);
    return working.get(fresh.counterId) ?? fresh;
  };

  const increment = (
    record: MetaCanaryPublicQuotaCounterRecord,
  ): MetaCanaryPublicQuotaCounterRecord => {
    if (record.count >= record.limit) refuse();
    const next: MetaCanaryPublicQuotaCounterRecord = {
      ...record,
      count: record.count + 1,
    };
    working.set(next.counterId, next);
    updatedCounterRecords[next.counterId] = next;
    return next;
  };

  for (const candidate of input.candidates) {
    const inbound = INBOUND_COUNTER_KINDS.map((kind) =>
      readCounter(kind, candidate.senderSha256, candidate.occurredAtMs)
    );

    if (inbound.some((record) => record.count >= record.limit)) {
      suppressedReceiptIds.push(candidate.receiptId);
      continue;
    }

    for (const record of inbound) increment(record);
    allowedReceiptIds.push(candidate.receiptId);

    if (!candidate.aiEligible) continue;
    const ai = AI_COUNTER_KINDS.map((kind) =>
      readCounter(kind, candidate.senderSha256, candidate.occurredAtMs)
    );
    if (ai.some((record) => record.count >= record.limit)) continue;
    for (const record of ai) increment(record);
    aiBudgetReceiptIds.push(candidate.receiptId);
  }

  return {
    allowedReceiptIds,
    suppressedReceiptIds,
    aiBudgetReceiptIds,
    updatedCounterRecords,
  };
}
