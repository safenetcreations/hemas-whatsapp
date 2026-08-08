import { describe, expect, it } from "vitest";
import {
  assertSyntheticAggregateEvidence,
  assertSyntheticAggregateLifecycle,
  countSyntheticAggregateEligibleBefore,
  planSyntheticAggregateBatch,
  summarizeSyntheticAggregateAlgorithm,
  SYNTHETIC_AGGREGATE_BATCH_COUNT,
  type SyntheticAggregateBatchPlan,
} from "@/components/campaigns/campaign-aggregate-validator";
import type {
  AudienceSnapshotDTO,
  CampaignCheckpointDTO,
  CampaignDTO,
} from "@/lib/firebase/repositories";

const workspaceId = "workspace_safenet_demo";
const campaignId = "campaign_synthetic_50k";
const snapshotHash =
  "7a4d8ce2bc1bafc224e5e2b91a2fc3f8b20b5f062ff1563ca4cf25847ad0d550";
const approvalHash =
  "6bdce27c7e31e5e064febd7b4dcbd05df208a4ddf33085003848bbfd81c1b1cd";
const timestamp = "2026-08-07T05:00:00.000Z";

function campaign(overrides: Partial<CampaignDTO> = {}): CampaignDTO {
  return {
    id: campaignId,
    workspaceId,
    name: "Synthetic 50,000-contact wellness awareness simulation",
    purpose: "health_campaigns",
    messageCategory: "marketing",
    targetAction: "Open the synthetic wellness information journey",
    ownerId: "user_demo_campaign_operator",
    templateVersionIds: {
      en: "template_wellness_awareness_en_v3",
      si: "template_wellness_awareness_si_v3",
      ta: "template_wellness_awareness_ta_v3",
    },
    audienceSnapshotId: "audience_synthetic_50k_v1",
    state: "scheduled",
    dispatchMode: "simulation",
    schedule: {
      startsAt: "2026-08-10T03:30:00.000Z",
      timeZone: "Asia/Colombo",
      quietHours: { startsAtLocal: "20:00", endsAtLocal: "08:00" },
    },
    approval: {
      required: true,
      status: "approved",
      scope: "simulation_only",
      approverId: "user_demo_campaign_approver",
      reviewedAt: timestamp,
      approvedContentHash: approvalHash,
    },
    revision: 0,
    canaryStatus: "not_run",
    processedEligible: 0,
    scanOffset: 0,
    nextBatchIndex: 0,
    batchSize: 1_000,
    lastCheckpointId: null,
    externalCalls: 0,
    networkCalls: 0,
    synthetic: true,
    schemaVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function audience(): AudienceSnapshotDTO {
  return {
    id: "audience_synthetic_50k_v1",
    workspaceId,
    campaignId,
    criteriaSummary:
      "Synthetic consented wellness audience; deterministic aggregate exclusions only.",
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
    contentHash: snapshotHash,
    immutable: true,
    synthetic: true,
    schemaVersion: 1,
    finalizedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function planAt(
  batchIndex: number,
  sourceOffset: number,
): Promise<SyntheticAggregateBatchPlan> {
  return planSyntheticAggregateBatch({
    workspaceId,
    campaignId,
    snapshotContentHash: snapshotHash,
    approvalContentHash: approvalHash,
    batchIndex,
    sourceOffset,
  });
}

function checkpoint(
  batchIndex: number,
  plan: SyntheticAggregateBatchPlan,
  processedEligible: number,
): CampaignCheckpointDTO {
  return {
    id: `${campaignId}:checkpoint:${String(batchIndex).padStart(6, "0")}`,
    workspaceId,
    campaignId,
    eventId: `campaign-event-aggregate-${String(batchIndex).padStart(6, "0")}`,
    batchIndex,
    ...plan,
    processedEligible,
    externalCalls: 0,
    networkCalls: 0,
    synthetic: true,
    schemaVersion: 1,
    createdAt: timestamp,
  };
}

describe("client-safe synthetic campaign aggregate algorithm", () => {
  it("recomputes the exact fixed audience summary from seed and exclusion precedence", () => {
    expect(summarizeSyntheticAggregateAlgorithm()).toEqual({
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

  it("reproduces all 39 approval-scoped batch transcripts and the exact final 443 plan", async () => {
    const checkpoints: CampaignCheckpointDTO[] = [];
    const eligibleLanguages = { en: 0, si: 0, ta: 0 };
    let sourceOffset = 0;
    let processedEligible = 0;
    let finalPlan: SyntheticAggregateBatchPlan | null = null;

    for (let batchIndex = 0; batchIndex < SYNTHETIC_AGGREGATE_BATCH_COUNT; batchIndex += 1) {
      const plan = await planAt(batchIndex, sourceOffset);
      if (batchIndex === 0) {
        expect(plan).toEqual({
          sourceOffsetStart: 0,
          sourceOffsetEnd: 1_304,
          eligibleCount: 1_000,
          languageCounts: { en: 525, si: 243, ta: 232 },
          scanComplete: false,
          digest:
            "206b1911a55e0fed38ff01cab8148f752196ae6bdcc6585fe3a22638d72726a7",
        });
      }
      sourceOffset = plan.sourceOffsetEnd;
      processedEligible += plan.eligibleCount;
      eligibleLanguages.en += plan.languageCounts.en;
      eligibleLanguages.si += plan.languageCounts.si;
      eligibleLanguages.ta += plan.languageCounts.ta;
      checkpoints.push(checkpoint(batchIndex, plan, processedEligible));
      finalPlan = plan;
    }

    expect({ sourceOffset, processedEligible, eligibleLanguages }).toEqual({
      sourceOffset: 50_000,
      processedEligible: 38_443,
      eligibleLanguages: { en: 20_743, si: 9_255, ta: 8_445 },
    });
    expect(finalPlan).toEqual({
      sourceOffsetStart: 49_424,
      sourceOffsetEnd: 50_000,
      eligibleCount: 443,
      languageCounts: { en: 253, si: 98, ta: 92 },
      scanComplete: true,
      digest:
        "bc9a90a525e48baca66b1fc4f61bff42babb2e09dd3af3bca287bf883d39ea61",
    });

    const completed = campaign({
      state: "completed",
      canaryStatus: "passed_simulation",
      processedEligible,
      scanOffset: sourceOffset,
      nextBatchIndex: 39,
      lastCheckpointId: `${campaignId}:checkpoint:000038`,
    });
    await expect(
      assertSyntheticAggregateEvidence({
        campaign: completed,
        audience: audience(),
        checkpoints,
      }),
    ).resolves.toBeUndefined();
  });

  it("enforces cancelled canary combinations and rejects full progress outside completed", async () => {
    const first = await planAt(0, 0);
    const progressed = {
      processedEligible: 1_000,
      scanOffset: first.sourceOffsetEnd,
      nextBatchIndex: 1,
      lastCheckpointId: `${campaignId}:checkpoint:000000`,
    } as const;
    expect(() =>
      assertSyntheticAggregateLifecycle(
        campaign({ state: "cancelled", canaryStatus: "not_run", ...progressed }),
      ),
    ).toThrow();
    for (const canaryStatus of ["passed_simulation", "failed"] as const) {
      expect(() =>
        assertSyntheticAggregateLifecycle(
          campaign({ state: "cancelled", canaryStatus, ...progressed }),
        ),
      ).not.toThrow();
    }
    expect(() =>
      assertSyntheticAggregateLifecycle(
        campaign({ state: "cancelled", canaryStatus: "not_run" }),
      ),
    ).not.toThrow();
    expect(() =>
      assertSyntheticAggregateLifecycle(
        campaign({
          state: "dispatching",
          canaryStatus: "passed_simulation",
          processedEligible: 38_443,
          scanOffset: 50_000,
          nextBatchIndex: 39,
          lastCheckpointId: `${campaignId}:checkpoint:000038`,
        }),
      ),
    ).toThrow();
  });

  it("rejects noncanonical current offsets and checkpoint offset, language, or digest evidence", async () => {
    const plan = await planAt(0, 0);
    const canonicalCheckpoint = checkpoint(0, plan, 1_000);
    const current = campaign({
      state: "dispatching",
      canaryStatus: "passed_simulation",
      processedEligible: 1_000,
      scanOffset: plan.sourceOffsetEnd,
      nextBatchIndex: 1,
      lastCheckpointId: canonicalCheckpoint.id,
    });
    await expect(
      assertSyntheticAggregateEvidence({
        campaign: current,
        audience: audience(),
        checkpoints: [canonicalCheckpoint],
      }),
    ).resolves.toBeUndefined();
    expect(countSyntheticAggregateEligibleBefore(plan.sourceOffsetEnd)).toBe(1_000);

    expect(() =>
      assertSyntheticAggregateLifecycle(
        campaign({ ...current, scanOffset: plan.sourceOffsetEnd - 1 }),
      ),
    ).toThrow();
    for (const changed of [
      { ...canonicalCheckpoint, sourceOffsetEnd: plan.sourceOffsetEnd + 1 },
      {
        ...canonicalCheckpoint,
        languageCounts: {
          ...canonicalCheckpoint.languageCounts,
          en: canonicalCheckpoint.languageCounts.en + 1,
        },
      },
      { ...canonicalCheckpoint, digest: "0".repeat(64) },
    ]) {
      await expect(
        assertSyntheticAggregateEvidence({
          campaign: current,
          audience: audience(),
          checkpoints: [changed],
        }),
      ).rejects.toThrow();
    }
  });
});
