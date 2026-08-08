import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_SYNTHETIC_ELIGIBLE_BATCH,
  SYNTHETIC_AUDIENCE_COUNTS,
  SYNTHETIC_CAMPAIGN_TOTAL,
  planSyntheticEligibleBatch,
  summarizeSyntheticAudienceAlgorithm,
} from "../src/campaigns/audience.js";

test("campaign audience algorithm matches the canonical 50K snapshot exactly", () => {
  assert.deepEqual(summarizeSyntheticAudienceAlgorithm(), {
    totalEvaluated: 50_000,
    eligibleCount: 38_443,
    excludedCount: 11_557,
    unknownConsentCount: 3_588,
    exclusionsByReason: {
      frequency_cap: 3_873,
      consent_missing: 3_588,
      suppressed: 2_915,
      duplicate: 444,
      invalid_contact: 442,
      language_unavailable: 295,
    },
    languageCounts: { en: 26_989, si: 12_038, ta: 10_973 },
  });
});

test("eligible planning is lazy, bounded to 1,000 and finishes with the exact 443 batch", () => {
  let sourceOffset = 0;
  let processedEligible = 0;
  const eligibleLanguageCounts = { en: 0, si: 0, ta: 0 };
  const digests = new Set<string>();
  const batchSizes: number[] = [];

  while (sourceOffset < SYNTHETIC_CAMPAIGN_TOTAL) {
    const batch = planSyntheticEligibleBatch({
      sourceOffset,
      batchSize: MAX_SYNTHETIC_ELIGIBLE_BATCH,
      digestScope: `workspace_safenet_demo:campaign_synthetic_50k:${batchSizes.length}`,
    });
    assert.equal(batch.sourceOffsetStart, sourceOffset);
    assert.ok(batch.sourceOffsetEnd > batch.sourceOffsetStart);
    assert.ok(batch.eligibleCount > 0);
    assert.ok(batch.eligibleCount <= MAX_SYNTHETIC_ELIGIBLE_BATCH);
    assert.match(batch.digest, /^[a-f0-9]{64}$/);
    assert.equal(digests.has(batch.digest), false);
    digests.add(batch.digest);
    batchSizes.push(batch.eligibleCount);
    processedEligible += batch.eligibleCount;
    eligibleLanguageCounts.en += batch.languageCounts.en;
    eligibleLanguageCounts.si += batch.languageCounts.si;
    eligibleLanguageCounts.ta += batch.languageCounts.ta;
    sourceOffset = batch.sourceOffsetEnd;
  }

  assert.equal(sourceOffset, SYNTHETIC_CAMPAIGN_TOTAL);
  assert.equal(processedEligible, SYNTHETIC_AUDIENCE_COUNTS.eligibleCount);
  assert.equal(batchSizes.length, 39);
  assert.deepEqual(batchSizes.slice(0, -1), Array.from({ length: 38 }, () => 1_000));
  assert.equal(batchSizes.at(-1), 443);
  assert.deepEqual(eligibleLanguageCounts, { en: 20_743, si: 9_255, ta: 8_445 });
});

test("checkpoint planning is deterministic and returns counts rather than a recipient array", () => {
  const input = {
    sourceOffset: 0,
    batchSize: 1_000,
    digestScope: "workspace_safenet_demo:campaign_synthetic_50k:0",
  };
  const first = planSyntheticEligibleBatch(input);
  const second = planSyntheticEligibleBatch(input);
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first).sort(), [
    "digest",
    "eligibleCount",
    "languageCounts",
    "scanComplete",
    "sourceOffsetEnd",
    "sourceOffsetStart",
  ]);
  assert.ok(JSON.stringify(first).length < 512);
});

test("checkpoint planning rejects oversized batches, invalid offsets and polluted digest scope", () => {
  for (const input of [
    { sourceOffset: -1, batchSize: 1_000, digestScope: "valid-scope" },
    { sourceOffset: 50_001, batchSize: 1_000, digestScope: "valid-scope" },
    { sourceOffset: 0, batchSize: 1_001, digestScope: "valid-scope" },
    { sourceOffset: 0, batchSize: 0, digestScope: "valid-scope" },
    { sourceOffset: 0, batchSize: 1_000, digestScope: "unsafe\ncontent" },
  ]) {
    assert.throws(() => planSyntheticEligibleBatch(input), {
      code: "invalid_campaign_batch",
    });
  }
});
