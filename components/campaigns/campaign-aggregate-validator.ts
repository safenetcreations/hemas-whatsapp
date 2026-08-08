import type {
  AudienceSnapshotDTO,
  CampaignCheckpointDTO,
  CampaignDTO,
} from "@/lib/firebase/repositories";

export const SYNTHETIC_AGGREGATE_TOTAL = 50_000;
export const SYNTHETIC_AGGREGATE_ELIGIBLE = 38_443;
export const SYNTHETIC_AGGREGATE_BATCH_SIZE = 1_000;
export const SYNTHETIC_AGGREGATE_BATCH_COUNT = 39;
const SYNTHETIC_AGGREGATE_SEED = 20_260_807;

type AggregateLanguage = "en" | "si" | "ta";
type AggregateExclusion =
  | "frequency_cap"
  | "consent_missing"
  | "suppressed"
  | "duplicate"
  | "invalid_contact"
  | "language_unavailable";

export type SyntheticAggregateSummary = {
  readonly totalEvaluated: number;
  readonly eligibleCount: number;
  readonly excludedCount: number;
  readonly unknownConsentCount: number;
  readonly exclusionsByReason: Readonly<Record<AggregateExclusion, number>>;
  readonly languageCounts: Readonly<Record<AggregateLanguage, number>>;
};

export type SyntheticAggregateBatchPlan = {
  readonly sourceOffsetStart: number;
  readonly sourceOffsetEnd: number;
  readonly eligibleCount: number;
  readonly languageCounts: Readonly<Record<AggregateLanguage, number>>;
  readonly scanComplete: boolean;
  readonly digest: string;
};

type AggregateCampaign = Pick<
  CampaignDTO,
  | "id"
  | "workspaceId"
  | "state"
  | "canaryStatus"
  | "processedEligible"
  | "scanOffset"
  | "nextBatchIndex"
  | "batchSize"
  | "lastCheckpointId"
  | "approval"
>;

type AggregateAudience = Pick<
  AudienceSnapshotDTO,
  | "contentHash"
  | "totalEvaluated"
  | "eligibleCount"
  | "excludedCount"
  | "unknownConsentCount"
  | "exclusionsByReason"
  | "languageCounts"
>;

export class SyntheticAggregateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyntheticAggregateValidationError";
  }
}

function fail(message: string): never {
  throw new SyntheticAggregateValidationError(message);
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

function languageAt(ordinal: number): AggregateLanguage {
  const bucket = mixSeed(SYNTHETIC_AGGREGATE_SEED, ordinal) % 100;
  if (bucket < 54) return "en";
  if (bucket < 78) return "si";
  return "ta";
}

function exclusionAt(sourceOrdinal: number): AggregateExclusion | null {
  if (sourceOrdinal % 113 === 0) return "invalid_contact";
  if (sourceOrdinal % 17 === 0) return "suppressed";
  if (sourceOrdinal % 13 === 0) return "consent_missing";
  if (sourceOrdinal % 97 === 0) return "duplicate";
  if (sourceOrdinal % 11 === 0) return "frequency_cap";
  if (sourceOrdinal % 131 === 0) return "language_unavailable";
  return null;
}

function assertSourceOffset(sourceOffset: number): void {
  if (
    !Number.isInteger(sourceOffset) ||
    sourceOffset < 0 ||
    sourceOffset > SYNTHETIC_AGGREGATE_TOTAL
  ) {
    fail("The aggregate source offset is outside the fixed synthetic source.");
  }
}

export function countSyntheticAggregateEligibleBefore(sourceOffset: number): number {
  assertSourceOffset(sourceOffset);
  let eligibleCount = 0;
  for (let ordinal = 0; ordinal < sourceOffset; ordinal += 1) {
    if (exclusionAt(ordinal + 1) === null) eligibleCount += 1;
  }
  return eligibleCount;
}

export function summarizeSyntheticAggregateAlgorithm(): SyntheticAggregateSummary {
  const exclusionsByReason: Record<AggregateExclusion, number> = {
    frequency_cap: 0,
    consent_missing: 0,
    suppressed: 0,
    duplicate: 0,
    invalid_contact: 0,
    language_unavailable: 0,
  };
  const languageCounts: Record<AggregateLanguage, number> = {
    en: 0,
    si: 0,
    ta: 0,
  };
  let eligibleCount = 0;

  for (let ordinal = 0; ordinal < SYNTHETIC_AGGREGATE_TOTAL; ordinal += 1) {
    languageCounts[languageAt(ordinal)] += 1;
    const exclusion = exclusionAt(ordinal + 1);
    if (exclusion === null) eligibleCount += 1;
    else exclusionsByReason[exclusion] += 1;
  }

  return {
    totalEvaluated: SYNTHETIC_AGGREGATE_TOTAL,
    eligibleCount,
    excludedCount: SYNTHETIC_AGGREGATE_TOTAL - eligibleCount,
    unknownConsentCount: exclusionsByReason.consent_missing,
    exclusionsByReason,
    languageCounts,
  };
}

async function sha256Hex(transcript: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) fail("The aggregate checkpoint transcript cannot be verified.");
  try {
    const digest = await subtle.digest(
      "SHA-256",
      new TextEncoder().encode(transcript),
    );
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return fail("The aggregate checkpoint transcript could not be verified.");
  }
}

export async function planSyntheticAggregateBatch(input: {
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly snapshotContentHash: string;
  readonly approvalContentHash: string;
  readonly batchIndex: number;
  readonly sourceOffset: number;
  readonly batchSize?: number;
}): Promise<SyntheticAggregateBatchPlan> {
  assertSourceOffset(input.sourceOffset);
  const batchSize = input.batchSize ?? SYNTHETIC_AGGREGATE_BATCH_SIZE;
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > SYNTHETIC_AGGREGATE_BATCH_SIZE ||
    !Number.isInteger(input.batchIndex) ||
    input.batchIndex < 0 ||
    input.batchIndex >= SYNTHETIC_AGGREGATE_BATCH_COUNT ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.workspaceId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.campaignId) ||
    !/^[a-f0-9]{64}$/.test(input.snapshotContentHash) ||
    !/^[a-f0-9]{64}$/.test(input.approvalContentHash)
  ) {
    fail("The aggregate checkpoint planning scope is invalid.");
  }

  const digestScope = [
    input.workspaceId,
    input.campaignId,
    input.snapshotContentHash,
    input.approvalContentHash,
    input.batchIndex,
  ].join(":");
  const transcript = [
    `campaign-eligible-batch-v1\n${digestScope}\n`,
  ];
  const languageCounts: Record<AggregateLanguage, number> = {
    en: 0,
    si: 0,
    ta: 0,
  };
  let sourceOffsetEnd = input.sourceOffset;
  let eligibleCount = 0;

  while (
    sourceOffsetEnd < SYNTHETIC_AGGREGATE_TOTAL &&
    eligibleCount < batchSize
  ) {
    const ordinal = sourceOffsetEnd;
    sourceOffsetEnd += 1;
    if (exclusionAt(ordinal + 1) !== null) continue;
    const language = languageAt(ordinal);
    eligibleCount += 1;
    languageCounts[language] += 1;
    transcript.push(`${ordinal}:${language}\n`);
  }
  const scanComplete = sourceOffsetEnd === SYNTHETIC_AGGREGATE_TOTAL;
  transcript.push(
    `source:${input.sourceOffset}:${sourceOffsetEnd};eligible:${eligibleCount};complete:${scanComplete}`,
  );

  return {
    sourceOffsetStart: input.sourceOffset,
    sourceOffsetEnd,
    eligibleCount,
    languageCounts,
    scanComplete,
    digest: await sha256Hex(transcript.join("")),
  };
}

function exactNumberMap(
  actual: Readonly<Record<string, number>>,
  expected: Readonly<Record<string, number>>,
): boolean {
  return (
    Object.keys(actual).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, value]) => actual[key] === value)
  );
}

function expectedCheckpointId(campaignId: string, batchIndex: number): string {
  return `${campaignId}:checkpoint:${String(batchIndex).padStart(6, "0")}`;
}

export function assertSyntheticAggregateLifecycle(
  campaign: AggregateCampaign,
): void {
  const allowedState = [
    "scheduled",
    "dispatching",
    "paused",
    "completed",
    "cancelled",
    "failed",
  ].includes(campaign.state);
  if (
    !allowedState ||
    campaign.batchSize !== SYNTHETIC_AGGREGATE_BATCH_SIZE ||
    !Number.isInteger(campaign.processedEligible) ||
    campaign.processedEligible < 0 ||
    campaign.processedEligible > SYNTHETIC_AGGREGATE_ELIGIBLE ||
    !Number.isInteger(campaign.scanOffset) ||
    campaign.scanOffset < 0 ||
    campaign.scanOffset > SYNTHETIC_AGGREGATE_TOTAL ||
    !Number.isInteger(campaign.nextBatchIndex) ||
    campaign.nextBatchIndex < 0 ||
    campaign.nextBatchIndex > SYNTHETIC_AGGREGATE_BATCH_COUNT
  ) {
    fail("Campaign lifecycle values are outside the fixed aggregate bounds.");
  }

  const expectedProcessed = countSyntheticAggregateEligibleBefore(
    campaign.scanOffset,
  );
  const expectedBatchIndex = Math.ceil(
    campaign.processedEligible / SYNTHETIC_AGGREGATE_BATCH_SIZE,
  );
  const expectedLastCheckpoint =
    expectedBatchIndex === 0
      ? null
      : expectedCheckpointId(campaign.id, expectedBatchIndex - 1);

  if (
    campaign.processedEligible !== expectedProcessed ||
    campaign.nextBatchIndex !== expectedBatchIndex ||
    campaign.lastCheckpointId !== expectedLastCheckpoint ||
    (campaign.state === "scheduled" &&
      (campaign.processedEligible !== 0 ||
        campaign.scanOffset !== 0 ||
        campaign.lastCheckpointId !== null)) ||
    (campaign.canaryStatus === "not_run" &&
      (!["scheduled", "cancelled"].includes(campaign.state) ||
        campaign.processedEligible !== 0 ||
        campaign.scanOffset !== 0)) ||
    (campaign.state === "failed" && campaign.canaryStatus !== "failed") ||
    (campaign.canaryStatus === "failed" &&
      campaign.state !== "failed" &&
      campaign.state !== "cancelled") ||
    (["dispatching", "paused", "completed"].includes(campaign.state) &&
      campaign.canaryStatus !== "passed_simulation") ||
    (campaign.state === "completed" &&
      (campaign.processedEligible !== SYNTHETIC_AGGREGATE_ELIGIBLE ||
        campaign.scanOffset !== SYNTHETIC_AGGREGATE_TOTAL ||
        campaign.nextBatchIndex !== SYNTHETIC_AGGREGATE_BATCH_COUNT)) ||
    (campaign.state !== "completed" &&
      campaign.processedEligible === SYNTHETIC_AGGREGATE_ELIGIBLE)
  ) {
    fail("Campaign state, canary, and aggregate progress are not canonical.");
  }
}

export async function assertSyntheticAggregateEvidence(input: {
  readonly campaign: AggregateCampaign;
  readonly audience: AggregateAudience;
  readonly checkpoints: readonly CampaignCheckpointDTO[];
}): Promise<void> {
  assertSyntheticAggregateLifecycle(input.campaign);
  const summary = summarizeSyntheticAggregateAlgorithm();
  if (
    input.audience.totalEvaluated !== summary.totalEvaluated ||
    input.audience.eligibleCount !== summary.eligibleCount ||
    input.audience.excludedCount !== summary.excludedCount ||
    input.audience.unknownConsentCount !== summary.unknownConsentCount ||
    !exactNumberMap(
      input.audience.exclusionsByReason,
      summary.exclusionsByReason,
    ) ||
    !exactNumberMap(input.audience.languageCounts, summary.languageCounts)
  ) {
    fail("The audience snapshot does not match the fixed aggregate algorithm.");
  }

  const checkpoints = [...input.checkpoints].sort(
    (left, right) => left.batchIndex - right.batchIndex,
  );
  if (checkpoints.length !== input.campaign.nextBatchIndex) {
    fail("The complete aggregate checkpoint plan is not present.");
  }

  let sourceOffset = 0;
  let processedEligible = 0;
  for (let batchIndex = 0; batchIndex < checkpoints.length; batchIndex += 1) {
    const checkpoint = checkpoints[batchIndex]!;
    const plan = await planSyntheticAggregateBatch({
      workspaceId: input.campaign.workspaceId,
      campaignId: input.campaign.id,
      snapshotContentHash: input.audience.contentHash,
      approvalContentHash: input.campaign.approval.approvedContentHash,
      batchIndex,
      sourceOffset,
      batchSize: input.campaign.batchSize,
    });
    processedEligible += plan.eligibleCount;
    if (
      checkpoint.batchIndex !== batchIndex ||
      checkpoint.id !== expectedCheckpointId(input.campaign.id, batchIndex) ||
      checkpoint.workspaceId !== input.campaign.workspaceId ||
      checkpoint.campaignId !== input.campaign.id ||
      checkpoint.sourceOffsetStart !== plan.sourceOffsetStart ||
      checkpoint.sourceOffsetEnd !== plan.sourceOffsetEnd ||
      checkpoint.eligibleCount !== plan.eligibleCount ||
      !exactNumberMap(checkpoint.languageCounts, plan.languageCounts) ||
      checkpoint.processedEligible !== processedEligible ||
      checkpoint.processedEligible !==
        countSyntheticAggregateEligibleBefore(plan.sourceOffsetEnd) ||
      checkpoint.scanComplete !== plan.scanComplete ||
      checkpoint.digest !== plan.digest ||
      checkpoint.externalCalls !== 0 ||
      checkpoint.networkCalls !== 0 ||
      checkpoint.synthetic !== true ||
      checkpoint.schemaVersion !== 1
    ) {
      fail("A persisted checkpoint does not match its canonical aggregate batch.");
    }
    sourceOffset = plan.sourceOffsetEnd;
  }

  if (
    processedEligible !== input.campaign.processedEligible ||
    sourceOffset !== input.campaign.scanOffset
  ) {
    fail("The canonical checkpoint sequence does not match current campaign progress.");
  }
}
