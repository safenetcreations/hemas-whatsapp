import { createHash } from "node:crypto";
import { FailClosedError } from "../errors.js";

export const SYNTHETIC_CAMPAIGN_TOTAL = 50_000;
export const SYNTHETIC_CAMPAIGN_SEED = 20_260_807;
export const MAX_SYNTHETIC_ELIGIBLE_BATCH = 1_000;

export const SYNTHETIC_AUDIENCE_COUNTS = Object.freeze({
  totalEvaluated: 50_000,
  eligibleCount: 38_443,
  excludedCount: 11_557,
  unknownConsentCount: 3_588,
  exclusionsByReason: Object.freeze({
    frequency_cap: 3_873,
    consent_missing: 3_588,
    suppressed: 2_915,
    duplicate: 444,
    invalid_contact: 442,
    language_unavailable: 295,
  }),
  languageCounts: Object.freeze({ en: 26_989, si: 12_038, ta: 10_973 }),
});

export type SyntheticCampaignLanguage = "en" | "si" | "ta";
export type SyntheticCampaignExclusionReason =
  | "frequency_cap"
  | "consent_missing"
  | "suppressed"
  | "duplicate"
  | "invalid_contact"
  | "language_unavailable";

export interface SyntheticAudienceDecision {
  readonly ordinal: number;
  readonly language: SyntheticCampaignLanguage;
  readonly eligible: boolean;
  readonly exclusionReason: SyntheticCampaignExclusionReason | null;
}

export interface SyntheticEligibleBatch {
  readonly sourceOffsetStart: number;
  readonly sourceOffsetEnd: number;
  readonly eligibleCount: number;
  readonly languageCounts: Readonly<Record<SyntheticCampaignLanguage, number>>;
  readonly scanComplete: boolean;
  readonly digest: string;
}

function mixSeed(seed: number, ordinal: number): number {
  let value = (seed ^ Math.imul(ordinal + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  value ^= value >>> 16;
  return value >>> 0;
}

function languageFor(value: number): SyntheticCampaignLanguage {
  const bucket = value % 100;
  if (bucket < 54) return "en";
  if (bucket < 78) return "si";
  return "ta";
}

function exclusionFor(sourceOrdinal: number): SyntheticCampaignExclusionReason | null {
  if (sourceOrdinal % 113 === 0) return "invalid_contact";
  if (sourceOrdinal % 17 === 0) return "suppressed";
  if (sourceOrdinal % 13 === 0) return "consent_missing";
  if (sourceOrdinal % 97 === 0) return "duplicate";
  if (sourceOrdinal % 11 === 0) return "frequency_cap";
  if (sourceOrdinal % 131 === 0) return "language_unavailable";
  return null;
}

export function syntheticAudienceDecisionAt(ordinal: number): SyntheticAudienceDecision {
  if (
    !Number.isInteger(ordinal) ||
    ordinal < 0 ||
    ordinal >= SYNTHETIC_CAMPAIGN_TOTAL
  ) {
    throw new FailClosedError(
      "invalid_campaign_batch",
      "Synthetic audience ordinal is outside the fixed campaign source.",
    );
  }
  const exclusionReason = exclusionFor(ordinal + 1);
  return {
    ordinal,
    language: languageFor(mixSeed(SYNTHETIC_CAMPAIGN_SEED, ordinal)),
    eligible: exclusionReason === null,
    exclusionReason,
  };
}

export function planSyntheticEligibleBatch(input: {
  readonly sourceOffset: number;
  readonly batchSize: number;
  readonly digestScope: string;
}): SyntheticEligibleBatch {
  if (
    !Number.isInteger(input.sourceOffset) ||
    input.sourceOffset < 0 ||
    input.sourceOffset > SYNTHETIC_CAMPAIGN_TOTAL
  ) {
    throw new FailClosedError(
      "invalid_campaign_batch",
      "Campaign source offset is invalid.",
    );
  }
  if (
    !Number.isInteger(input.batchSize) ||
    input.batchSize < 1 ||
    input.batchSize > MAX_SYNTHETIC_ELIGIBLE_BATCH
  ) {
    throw new FailClosedError(
      "invalid_campaign_batch",
      "Campaign eligible batch size must be between 1 and 1,000.",
    );
  }
  if (
    input.digestScope.length < 1 ||
    input.digestScope.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(input.digestScope)
  ) {
    throw new FailClosedError(
      "invalid_campaign_batch",
      "Campaign checkpoint digest scope is invalid.",
    );
  }

  const hash = createHash("sha256");
  hash.update(`campaign-eligible-batch-v1\n${input.digestScope}\n`);
  const languageCounts: Record<SyntheticCampaignLanguage, number> = {
    en: 0,
    si: 0,
    ta: 0,
  };
  let sourceOffsetEnd = input.sourceOffset;
  let eligibleCount = 0;

  while (
    sourceOffsetEnd < SYNTHETIC_CAMPAIGN_TOTAL &&
    eligibleCount < input.batchSize
  ) {
    const member = syntheticAudienceDecisionAt(sourceOffsetEnd);
    sourceOffsetEnd += 1;
    if (!member.eligible) continue;
    eligibleCount += 1;
    languageCounts[member.language] += 1;
    hash.update(`${member.ordinal}:${member.language}\n`);
  }
  const scanComplete = sourceOffsetEnd === SYNTHETIC_CAMPAIGN_TOTAL;
  hash.update(
    `source:${input.sourceOffset}:${sourceOffsetEnd};eligible:${eligibleCount};complete:${scanComplete}`,
  );

  return {
    sourceOffsetStart: input.sourceOffset,
    sourceOffsetEnd,
    eligibleCount,
    languageCounts,
    scanComplete,
    digest: hash.digest("hex"),
  };
}

export function countSyntheticEligibleBefore(sourceOffset: number): number {
  if (
    !Number.isInteger(sourceOffset) ||
    sourceOffset < 0 ||
    sourceOffset > SYNTHETIC_CAMPAIGN_TOTAL
  ) {
    throw new FailClosedError(
      "invalid_campaign_batch",
      "Campaign source offset is invalid.",
    );
  }
  let eligibleCount = 0;
  for (let ordinal = 0; ordinal < sourceOffset; ordinal += 1) {
    if (syntheticAudienceDecisionAt(ordinal).eligible) eligibleCount += 1;
  }
  return eligibleCount;
}

export function summarizeSyntheticAudienceAlgorithm(): typeof SYNTHETIC_AUDIENCE_COUNTS {
  const exclusions: Record<SyntheticCampaignExclusionReason, number> = {
    frequency_cap: 0,
    consent_missing: 0,
    suppressed: 0,
    duplicate: 0,
    invalid_contact: 0,
    language_unavailable: 0,
  };
  const languageCounts: Record<SyntheticCampaignLanguage, number> = {
    en: 0,
    si: 0,
    ta: 0,
  };
  let eligibleCount = 0;

  for (let ordinal = 0; ordinal < SYNTHETIC_CAMPAIGN_TOTAL; ordinal += 1) {
    const member = syntheticAudienceDecisionAt(ordinal);
    languageCounts[member.language] += 1;
    if (member.eligible) {
      eligibleCount += 1;
    } else if (member.exclusionReason) {
      exclusions[member.exclusionReason] += 1;
    }
  }

  const result = {
    totalEvaluated: SYNTHETIC_CAMPAIGN_TOTAL,
    eligibleCount,
    excludedCount: SYNTHETIC_CAMPAIGN_TOTAL - eligibleCount,
    unknownConsentCount: exclusions.consent_missing,
    exclusionsByReason: exclusions,
    languageCounts,
  };
  if (JSON.stringify(result) !== JSON.stringify(SYNTHETIC_AUDIENCE_COUNTS)) {
    throw new FailClosedError(
      "invalid_campaign_algorithm",
      "Synthetic campaign audience reconciliation drifted from the persisted contract.",
    );
  }
  return SYNTHETIC_AUDIENCE_COUNTS;
}
