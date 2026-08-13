import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  META_CANARY_PUBLIC_QUOTA_GRACE_MS,
  META_CANARY_PUBLIC_QUOTA_LIMITS,
  META_CANARY_PUBLIC_QUOTA_WINDOWS_MS,
  MetaCanaryPublicQuotaError,
  allocateMetaCanaryPublicQuota,
  metaCanaryPublicQuotaCounterId,
  metaCanaryPublicQuotaCounterIds,
  parseMetaCanaryPublicQuotaCounterRecord,
  type MetaCanaryPublicQuotaCandidate,
  type MetaCanaryPublicQuotaCounterKind,
  type MetaCanaryPublicQuotaCounterRecord,
  type MetaCanaryPublicQuotaDecision,
} from "../src/meta-canary/public-quota.js";

const DAY_START_MS = Date.UTC(2026, 7, 12);
const MINUTE_MS = META_CANARY_PUBLIC_QUOTA_WINDOWS_MS.minute;
const DAY_MS = META_CANARY_PUBLIC_QUOTA_WINDOWS_MS.day;

function sha(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function candidate(
  receiptId: string,
  senderSha256: string,
  occurredAtMs = DAY_START_MS,
  aiEligible = false,
): MetaCanaryPublicQuotaCandidate {
  return { receiptId, senderSha256, occurredAtMs, aiEligible };
}

function numberedCandidates(
  prefix: string,
  count: number,
  senderAt: (index: number) => string,
  occurredAtMs = DAY_START_MS,
  aiEligible = false,
): readonly MetaCanaryPublicQuotaCandidate[] {
  return Array.from({ length: count }, (_, index) =>
    candidate(
      `${prefix}-${String(index + 1).padStart(3, "0")}`,
      senderAt(index),
      occurredAtMs,
      aiEligible,
    ),
  );
}

type CounterState = Record<string, unknown>;

function allocateAndMerge(input: {
  readonly state: CounterState;
  readonly candidates: readonly MetaCanaryPublicQuotaCandidate[];
  readonly nowMs: number;
}): MetaCanaryPublicQuotaDecision {
  const decision = allocateMetaCanaryPublicQuota({
    candidates: input.candidates,
    nowMs: input.nowMs,
    currentCounterRecords: input.state,
  });
  Object.assign(input.state, decision.updatedCounterRecords);
  return decision;
}

function records(
  state: Readonly<Record<string, unknown>>,
): readonly MetaCanaryPublicQuotaCounterRecord[] {
  return Object.values(state).map(parseMetaCanaryPublicQuotaCounterRecord);
}

function currentRecord(input: {
  readonly state: Readonly<Record<string, unknown>>;
  readonly kind: MetaCanaryPublicQuotaCounterKind;
  readonly nowMs: number;
  readonly scopeSha256?: string;
}): MetaCanaryPublicQuotaCounterRecord {
  const windowMs = input.kind.endsWith("minute") ? MINUTE_MS : DAY_MS;
  const bucketStartMs = Math.floor(input.nowMs / windowMs) * windowMs;
  const matches = records(input.state).filter((record) =>
    record.counterKind === input.kind &&
    record.bucketStartMs === bucketStartMs &&
    (input.scopeSha256 === undefined || record.scopeSha256 === input.scopeSha256),
  );
  assert.equal(matches.length, 1);
  return matches[0] as MetaCanaryPublicQuotaCounterRecord;
}

function assertQuotaError(run: () => unknown): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof MetaCanaryPublicQuotaError);
    assert.equal(error.code, "public_quota_invalid");
    assert.equal(error.message, "Public canary quota state is invalid or unavailable.");
    return true;
  });
}

test("ordered sender-minute admission allows six and suppresses the seventh", () => {
  const plaintextSender = "+94770000001";
  const senderSha256 = sha(plaintextSender);
  const candidates = numberedCandidates("receipt-sequence", 7, () => senderSha256);
  const decision = allocateMetaCanaryPublicQuota({
    candidates,
    nowMs: DAY_START_MS,
    currentCounterRecords: {},
  });

  assert.deepEqual(decision.allowedReceiptIds, candidates.slice(0, 6).map(({ receiptId }) => receiptId));
  assert.deepEqual(decision.suppressedReceiptIds, [candidates[6]?.receiptId]);

  const updated = records(decision.updatedCounterRecords);
  assert.equal(updated.length, 4);
  assert.equal(updated.find((record) => record.counterKind === "inbound_sender_minute")?.count, 6);
  assert.equal(updated.find((record) => record.counterKind === "inbound_sender_day")?.count, 6);
  assert.equal(updated.find((record) => record.counterKind === "inbound_global_minute")?.count, 6);
  assert.equal(updated.find((record) => record.counterKind === "inbound_global_day")?.count, 6);

  const serialized = JSON.stringify(decision.updatedCounterRecords);
  assert.equal(serialized.includes(plaintextSender), false);
  assert.equal(serialized.includes("receipt-sequence"), false);
  for (const [counterId, record] of Object.entries(decision.updatedCounterRecords)) {
    assert.match(counterId, /^[0-9a-f]{64}\.[0-9a-f]{64}\.\d+$/);
    assert.equal(counterId, record.counterId);
    assert.equal(record.containsMessageContent, false);
    assert.equal(record.containsPlaintextSender, false);
    assert.equal(Object.hasOwn(record, "receiptId"), false);
    assert.equal(Object.hasOwn(record, "senderNumber"), false);
  }

  const senderMinute = updated.find(
    (record) => record.counterKind === "inbound_sender_minute",
  );
  const senderDay = updated.find((record) => record.counterKind === "inbound_sender_day");
  assert.equal(
    senderMinute?.expiresAtMs,
    DAY_START_MS + MINUTE_MS + META_CANARY_PUBLIC_QUOTA_GRACE_MS.minute,
  );
  assert.equal(
    senderDay?.expiresAtMs,
    DAY_START_MS + DAY_MS + META_CANARY_PUBLIC_QUOTA_GRACE_MS.day,
  );
});

test("fixed windows reset exactly at minute and UTC-day boundaries", () => {
  const state: CounterState = {};
  const senderSha256 = sha("boundary-sender");

  const first = allocateAndMerge({
    state,
    candidates: numberedCandidates(
      "before-minute",
      6,
      () => senderSha256,
      DAY_START_MS + MINUTE_MS - 1,
    ),
    nowMs: DAY_START_MS + MINUTE_MS - 1,
  });
  assert.equal(first.allowedReceiptIds.length, 6);

  const minuteBoundary = allocateAndMerge({
    state,
    candidates: [candidate(
      "at-minute-boundary",
      senderSha256,
      DAY_START_MS + MINUTE_MS,
    )],
    nowMs: DAY_START_MS + MINUTE_MS,
  });
  assert.deepEqual(minuteBoundary.allowedReceiptIds, ["at-minute-boundary"]);
  assert.equal(
    currentRecord({
      state,
      kind: "inbound_sender_minute",
      nowMs: DAY_START_MS + MINUTE_MS,
      scopeSha256: senderSha256,
    }).count,
    1,
  );
  assert.equal(
    currentRecord({
      state,
      kind: "inbound_sender_day",
      nowMs: DAY_START_MS + MINUTE_MS,
      scopeSha256: senderSha256,
    }).count,
    7,
  );

  const dayBoundary = allocateAndMerge({
    state,
    candidates: [candidate(
      "at-day-boundary",
      senderSha256,
      DAY_START_MS + DAY_MS,
    )],
    nowMs: DAY_START_MS + DAY_MS,
  });
  assert.deepEqual(dayBoundary.allowedReceiptIds, ["at-day-boundary"]);
  assert.equal(
    currentRecord({
      state,
      kind: "inbound_sender_day",
      nowMs: DAY_START_MS + DAY_MS,
      scopeSha256: senderSha256,
    }).count,
    1,
  );
});

test("per-sender daily quota suppresses message 21 without consuming global capacity", () => {
  const state: CounterState = {};
  const senderSha256 = sha("daily-limited-sender");

  for (let minute = 0; minute < 4; minute += 1) {
    const decision = allocateAndMerge({
      state,
      candidates: numberedCandidates(
        `day-${minute}`,
        5,
        () => senderSha256,
        DAY_START_MS + minute * MINUTE_MS,
      ),
      nowMs: DAY_START_MS + minute * MINUTE_MS,
    });
    assert.equal(decision.allowedReceiptIds.length, 5);
  }

  const suppressed = allocateAndMerge({
    state,
    candidates: [candidate(
      "daily-message-021",
      senderSha256,
      DAY_START_MS + 4 * MINUTE_MS,
    )],
    nowMs: DAY_START_MS + 4 * MINUTE_MS,
  });
  assert.deepEqual(suppressed.allowedReceiptIds, []);
  assert.deepEqual(suppressed.suppressedReceiptIds, ["daily-message-021"]);
  assert.equal(
    currentRecord({
      state,
      kind: "inbound_sender_day",
      nowMs: DAY_START_MS,
      scopeSha256: senderSha256,
    }).count,
    META_CANARY_PUBLIC_QUOTA_LIMITS.senderDay,
  );
  assert.equal(
    currentRecord({ state, kind: "inbound_global_day", nowMs: DAY_START_MS }).count,
    META_CANARY_PUBLIC_QUOTA_LIMITS.senderDay,
  );
});

test("global minute quota admits only the first 60 candidates across senders", () => {
  const state: CounterState = {};
  const first = allocateAndMerge({
    state,
    candidates: numberedCandidates("global-minute-a", 40, (index) => sha(`gm-a-${index}`)),
    nowMs: DAY_START_MS,
  });
  const secondCandidates = numberedCandidates(
    "global-minute-b",
    21,
    (index) => sha(`gm-b-${index}`),
  );
  const second = allocateAndMerge({
    state,
    candidates: secondCandidates,
    nowMs: DAY_START_MS,
  });

  assert.equal(first.allowedReceiptIds.length, 40);
  assert.equal(second.allowedReceiptIds.length, 20);
  assert.deepEqual(second.suppressedReceiptIds, [secondCandidates[20]?.receiptId]);
  assert.equal(
    currentRecord({ state, kind: "inbound_global_minute", nowMs: DAY_START_MS }).count,
    META_CANARY_PUBLIC_QUOTA_LIMITS.globalMinute,
  );
});

test("global day quota caps inbound at 500", () => {
  const state: CounterState = {};
  let allowed = 0;
  let suppressed = 0;
  let senderIndex = 0;

  for (let minute = 0; minute < 12; minute += 1) {
    const batch = numberedCandidates(`global-day-${minute}`, 40, () => {
      const hash = sha(`global-day-sender-${senderIndex}`);
      senderIndex += 1;
      return hash;
    });
    const decision = allocateAndMerge({
      state,
      candidates: batch.map((item) => ({
        ...item,
        occurredAtMs: DAY_START_MS + minute * MINUTE_MS,
      })),
      nowMs: DAY_START_MS + minute * MINUTE_MS,
    });
    allowed += decision.allowedReceiptIds.length;
    suppressed += decision.suppressedReceiptIds.length;
  }

  const finalBatch = numberedCandidates("global-day-final", 21, () => {
    const hash = sha(`global-day-sender-${senderIndex}`);
    senderIndex += 1;
    return hash;
  });
  const final = allocateAndMerge({
    state,
    candidates: finalBatch.map((item) => ({
      ...item,
      occurredAtMs: DAY_START_MS + 12 * MINUTE_MS,
    })),
    nowMs: DAY_START_MS + 12 * MINUTE_MS,
  });
  allowed += final.allowedReceiptIds.length;
  suppressed += final.suppressedReceiptIds.length;

  assert.equal(allowed, META_CANARY_PUBLIC_QUOTA_LIMITS.globalDay);
  assert.equal(suppressed, 1);
  assert.equal(final.allowedReceiptIds.length, 20);
  assert.deepEqual(final.suppressedReceiptIds, [finalBatch[20]?.receiptId]);
  assert.equal(
    currentRecord({ state, kind: "inbound_global_day", nowMs: DAY_START_MS }).count,
    META_CANARY_PUBLIC_QUOTA_LIMITS.globalDay,
  );
});

test("AI-eligible inbound reserves only the first three sender-daily model calls", () => {
  const plaintextSender = "+94770000991";
  const senderSha256 = sha(plaintextSender);
  const candidates = numberedCandidates(
    "ai-sender-receipt",
    4,
    () => senderSha256,
    DAY_START_MS,
    true,
  );
  const decision = allocateMetaCanaryPublicQuota({
    candidates,
    nowMs: DAY_START_MS,
    currentCounterRecords: {},
  });

  assert.deepEqual(decision.allowedReceiptIds, candidates.map(({ receiptId }) => receiptId));
  assert.equal(decision.suppressedReceiptIds.length, 0);
  assert.deepEqual(
    decision.aiBudgetReceiptIds,
    candidates.slice(0, 3).map(({ receiptId }) => receiptId),
  );

  const updated = records(decision.updatedCounterRecords);
  assert.equal(updated.length, 6);
  assert.equal(META_CANARY_PUBLIC_QUOTA_LIMITS.aiSenderDay, 3);
  assert.equal(META_CANARY_PUBLIC_QUOTA_LIMITS.aiGlobalDay, 100);
  assert.equal(
    updated.find((record) => record.counterKind === "ai_sender_day")?.count,
    META_CANARY_PUBLIC_QUOTA_LIMITS.aiSenderDay,
  );
  assert.equal(
    updated.find((record) => record.counterKind === "ai_global_day")?.count,
    META_CANARY_PUBLIC_QUOTA_LIMITS.aiSenderDay,
  );
  assert.equal(
    updated.find((record) => record.counterKind === "inbound_sender_day")?.count,
    4,
  );
  const aiRecords = updated.filter((record) => record.counterKind.startsWith("ai_"));
  assert.equal(aiRecords.length, 2);
  for (const record of aiRecords) {
    assert.equal(record.windowMs, DAY_MS);
    assert.equal(
      record.expiresAtMs,
      DAY_START_MS + DAY_MS + META_CANARY_PUBLIC_QUOTA_GRACE_MS.day,
    );
    assert.equal(record.containsMessageContent, false);
    assert.equal(record.containsPlaintextSender, false);
    assert.equal(Object.hasOwn(record, "receiptId"), false);
    assert.equal(Object.hasOwn(record, "aiEligible"), false);
  }
  const serializedCounters = JSON.stringify(decision.updatedCounterRecords);
  assert.equal(serializedCounters.includes(plaintextSender), false);
  assert.equal(serializedCounters.includes("ai-sender-receipt"), false);
});

test("AI sender exhaustion preserves inbound admission and global AI capacity", () => {
  const state: CounterState = {};
  const limitedSender = sha("ai-limited-sender");
  const otherSender = sha("ai-other-sender");

  const first = allocateAndMerge({
    state,
    candidates: numberedCandidates(
      "ai-limited",
      4,
      () => limitedSender,
      DAY_START_MS,
      true,
    ),
    nowMs: DAY_START_MS,
  });
  assert.equal(first.allowedReceiptIds.length, 4);
  assert.equal(first.aiBudgetReceiptIds.length, 3);
  assert.equal(
    currentRecord({ state, kind: "ai_global_day", nowMs: DAY_START_MS }).count,
    3,
  );

  const other = allocateAndMerge({
    state,
    candidates: [candidate("ai-other-receipt", otherSender, DAY_START_MS, true)],
    nowMs: DAY_START_MS,
  });
  assert.deepEqual(other.allowedReceiptIds, ["ai-other-receipt"]);
  assert.deepEqual(other.aiBudgetReceiptIds, ["ai-other-receipt"]);
  assert.equal(
    currentRecord({ state, kind: "ai_global_day", nowMs: DAY_START_MS }).count,
    4,
  );
});

test("global AI daily quota returns fallback-only admission for model call 101", () => {
  const state: CounterState = {};
  let senderIndex = 0;
  let admitted = 0;
  let aiBudgeted = 0;

  for (let minute = 0; minute < 2; minute += 1) {
    const decision = allocateAndMerge({
      state,
      candidates: numberedCandidates(
        `ai-global-${minute}`,
        40,
        () => sha(`ai-global-sender-${senderIndex++}`),
        DAY_START_MS + minute * MINUTE_MS,
        true,
      ),
      nowMs: DAY_START_MS + minute * MINUTE_MS,
    });
    admitted += decision.allowedReceiptIds.length;
    aiBudgeted += decision.aiBudgetReceiptIds.length;
  }

  const finalCandidates = numberedCandidates(
    "ai-global-final",
    21,
    () => sha(`ai-global-sender-${senderIndex++}`),
    DAY_START_MS + 2 * MINUTE_MS,
    true,
  );
  const final = allocateAndMerge({
    state,
    candidates: finalCandidates,
    nowMs: DAY_START_MS + 2 * MINUTE_MS,
  });
  admitted += final.allowedReceiptIds.length;
  aiBudgeted += final.aiBudgetReceiptIds.length;

  assert.equal(admitted, 101);
  assert.equal(aiBudgeted, META_CANARY_PUBLIC_QUOTA_LIMITS.aiGlobalDay);
  assert.equal(final.allowedReceiptIds.length, 21);
  assert.equal(final.suppressedReceiptIds.length, 0);
  assert.deepEqual(
    final.aiBudgetReceiptIds,
    finalCandidates.slice(0, 20).map(({ receiptId }) => receiptId),
  );
  assert.equal(
    currentRecord({ state, kind: "ai_global_day", nowMs: DAY_START_MS }).count,
    META_CANARY_PUBLIC_QUOTA_LIMITS.aiGlobalDay,
  );
});

test("non-AI and inbound-suppressed candidates never consume AI counters", () => {
  const state: CounterState = {};
  const senderSha256 = sha("no-ai-budget-sender");
  const inboundOnly = allocateAndMerge({
    state,
    candidates: numberedCandidates("inbound-only", 6, () => senderSha256),
    nowMs: DAY_START_MS,
  });
  assert.equal(inboundOnly.allowedReceiptIds.length, 6);
  assert.deepEqual(inboundOnly.aiBudgetReceiptIds, []);
  assert.equal(records(state).some((record) => record.counterKind.startsWith("ai_")), false);

  const suppressed = allocateAndMerge({
    state,
    candidates: [candidate("suppressed-ai-receipt", senderSha256, DAY_START_MS, true)],
    nowMs: DAY_START_MS,
  });
  assert.deepEqual(suppressed.allowedReceiptIds, []);
  assert.deepEqual(suppressed.suppressedReceiptIds, ["suppressed-ai-receipt"]);
  assert.deepEqual(suppressed.aiBudgetReceiptIds, []);
  assert.equal(records(state).some((record) => record.counterKind.startsWith("ai_")), false);
});

test("AI daily counters reset at the UTC-day boundary", () => {
  const state: CounterState = {};
  const senderSha256 = sha("ai-day-boundary-sender");
  const beforeBoundary = DAY_START_MS + DAY_MS - 1;
  const filled = allocateAndMerge({
    state,
    candidates: numberedCandidates(
      "ai-before-boundary",
      3,
      () => senderSha256,
      beforeBoundary,
      true,
    ),
    nowMs: beforeBoundary,
  });
  assert.equal(filled.aiBudgetReceiptIds.length, 3);

  const reset = allocateAndMerge({
    state,
    candidates: [candidate(
      "ai-at-boundary",
      senderSha256,
      DAY_START_MS + DAY_MS,
      true,
    )],
    nowMs: DAY_START_MS + DAY_MS,
  });
  assert.deepEqual(reset.aiBudgetReceiptIds, ["ai-at-boundary"]);
  assert.equal(
    currentRecord({
      state,
      kind: "ai_sender_day",
      nowMs: DAY_START_MS + DAY_MS,
      scopeSha256: senderSha256,
    }).count,
    1,
  );
});

test("counter read IDs deduplicate shared global and repeated sender scopes", () => {
  const firstSender = sha("first-sender");
  const secondSender = sha("second-sender");
  const ids = metaCanaryPublicQuotaCounterIds({
    candidates: [
      candidate("read-id-one", firstSender),
      candidate("read-id-two", firstSender),
      candidate("read-id-three", secondSender),
    ],
    nowMs: DAY_START_MS,
  });

  // Two shared global counters plus two sender counters for each unique sender.
  assert.equal(ids.length, 6);
  assert.deepEqual(ids, [...ids].sort());
  for (const id of ids) assert.match(id, /^[0-9a-f]{64}\.[0-9a-f]{64}\.\d+$/);
});

test("counter read IDs include AI day scopes only for AI-eligible candidates", () => {
  const firstSender = sha("ai-read-first");
  const secondSender = sha("ai-read-second");
  const ids = metaCanaryPublicQuotaCounterIds({
    candidates: [
      candidate("ai-read-one", firstSender, DAY_START_MS, true),
      candidate("ai-read-two", firstSender),
      candidate("ai-read-three", secondSender, DAY_START_MS, true),
    ],
    nowMs: DAY_START_MS,
  });

  // Six inbound IDs plus one shared AI-global and two AI-sender day IDs.
  assert.equal(ids.length, 9);
  assert.deepEqual(ids, [...ids].sort());
});

test("provider event time fixes replay buckets across receipt-time rollover", () => {
  const state: CounterState = {};
  const senderSha256 = sha("provider-time-sender");
  const occurredAtMs = DAY_START_MS + 1_000;
  const firstSix = numberedCandidates(
    "provider-time",
    6,
    () => senderSha256,
    occurredAtMs,
  );
  assert.equal(allocateAndMerge({
    state,
    candidates: firstSix,
    nowMs: occurredAtMs + 1_000,
  }).allowedReceiptIds.length, 6);

  const delayedReceivedAtMs = occurredAtMs + MINUTE_MS + 5_000;
  const delayed = candidate("provider-time-delayed", senderSha256, occurredAtMs);
  const decision = allocateAndMerge({
    state,
    candidates: [delayed],
    nowMs: delayedReceivedAtMs,
  });
  assert.deepEqual(decision.allowedReceiptIds, []);
  assert.deepEqual(decision.suppressedReceiptIds, [delayed.receiptId]);
  assert.equal(
    currentRecord({
      state,
      kind: "inbound_sender_minute",
      nowMs: occurredAtMs,
      scopeSha256: senderSha256,
    }).count,
    6,
  );
});

test("each candidate allocates its own provider minute while sharing its UTC day", () => {
  const senderSha256 = sha("multi-bucket-sender");
  const firstOccurredAtMs = DAY_START_MS + MINUTE_MS - 1_000;
  const secondOccurredAtMs = DAY_START_MS + MINUTE_MS + 1_000;
  const decision = allocateMetaCanaryPublicQuota({
    candidates: [
      candidate("multi-bucket-first", senderSha256, firstOccurredAtMs),
      candidate("multi-bucket-second", senderSha256, secondOccurredAtMs),
    ],
    nowMs: secondOccurredAtMs,
    currentCounterRecords: {},
  });
  assert.deepEqual(decision.allowedReceiptIds, [
    "multi-bucket-first",
    "multi-bucket-second",
  ]);
  const updated = records(decision.updatedCounterRecords);
  assert.equal(
    updated.filter((record) => record.counterKind.endsWith("minute")).length,
    4,
  );
  assert.equal(
    updated.find((record) =>
      record.counterKind === "inbound_sender_day"
    )?.count,
    2,
  );
  assert.equal(
    updated.find((record) =>
      record.counterKind === "inbound_global_day"
    )?.count,
    2,
  );
});

test("malformed current records and candidate batches fail closed", () => {
  const senderSha256 = sha("strict-sender");
  const candidateInput = [candidate("strict-receipt", senderSha256)];
  const valid = allocateMetaCanaryPublicQuota({
    candidates: candidateInput,
    nowMs: DAY_START_MS,
    currentCounterRecords: {},
  });
  const firstRecord = Object.values(valid.updatedCounterRecords)[0];
  assert.ok(firstRecord);

  const malformedRecords: unknown[] = [
    { ...firstRecord, unexpected: true },
    { ...firstRecord, count: firstRecord.limit + 1 },
    { ...firstRecord, counterId: `${firstRecord.counterId}0` },
    { ...firstRecord, expiresAtMs: firstRecord.expiresAtMs + 1 },
    { ...firstRecord, containsMessageContent: true },
    { ...firstRecord, containsPlaintextSender: true },
  ];
  for (const malformed of malformedRecords) {
    assertQuotaError(() =>
      allocateMetaCanaryPublicQuota({
        candidates: candidateInput,
        nowMs: DAY_START_MS,
        currentCounterRecords: { [firstRecord.counterId]: malformed },
      }),
    );
  }

  assertQuotaError(() =>
    allocateMetaCanaryPublicQuota({
      candidates: candidateInput,
      nowMs: DAY_START_MS,
      currentCounterRecords: { [`${firstRecord.counterId}0`]: firstRecord },
    }),
  );

  const globalRecord = Object.values(valid.updatedCounterRecords).find(
    (record) => record.counterKind === "inbound_global_day",
  );
  assert.ok(globalRecord);
  const wrongGlobalScope = sha("not-the-global-scope");
  const wrongGlobalId = metaCanaryPublicQuotaCounterId({
    counterKind: globalRecord.counterKind,
    scopeSha256: wrongGlobalScope,
    bucketStartMs: globalRecord.bucketStartMs,
  });
  assertQuotaError(() =>
    allocateMetaCanaryPublicQuota({
      candidates: candidateInput,
      nowMs: DAY_START_MS,
      currentCounterRecords: {
        [wrongGlobalId]: {
          ...globalRecord,
          counterId: wrongGlobalId,
          scopeSha256: wrongGlobalScope,
        },
      },
    }),
  );
  assertQuotaError(() =>
    allocateMetaCanaryPublicQuota({
      candidates: [candidate("same-receipt", senderSha256), candidate("same-receipt", senderSha256)],
      nowMs: DAY_START_MS,
      currentCounterRecords: {},
    }),
  );
  assertQuotaError(() =>
    allocateMetaCanaryPublicQuota({
      candidates: [candidate("bad-hash-receipt", "not-a-sha256")],
      nowMs: DAY_START_MS,
      currentCounterRecords: {},
    }),
  );

  const exactCandidate = candidate(
    "strict-ai-eligible",
    senderSha256,
    DAY_START_MS,
    true,
  );
  const { aiEligible: _missingAiEligibility, ...missingAiEligibility } = exactCandidate;
  for (const malformedCandidate of [
    missingAiEligibility,
    { ...exactCandidate, aiEligible: "true" },
    { ...exactCandidate, modelName: "must-not-enter-quota-state" },
  ]) {
    assertQuotaError(() =>
      allocateMetaCanaryPublicQuota({
        candidates: [malformedCandidate as MetaCanaryPublicQuotaCandidate],
        nowMs: DAY_START_MS,
        currentCounterRecords: {},
      }),
    );
  }

  const aiValid = allocateMetaCanaryPublicQuota({
    candidates: [exactCandidate],
    nowMs: DAY_START_MS,
    currentCounterRecords: {},
  });
  const aiSenderRecord = Object.values(aiValid.updatedCounterRecords).find(
    (record) => record.counterKind === "ai_sender_day",
  );
  assert.ok(aiSenderRecord);
  for (const malformedAiRecord of [
    { ...aiSenderRecord, limit: META_CANARY_PUBLIC_QUOTA_LIMITS.aiSenderDay + 1 },
    { ...aiSenderRecord, windowMs: MINUTE_MS },
    { ...aiSenderRecord, expiresAtMs: aiSenderRecord.expiresAtMs + 1 },
  ]) {
    assertQuotaError(() =>
      parseMetaCanaryPublicQuotaCounterRecord(malformedAiRecord),
    );
  }
});
