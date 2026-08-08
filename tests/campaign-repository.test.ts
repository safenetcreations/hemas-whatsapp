import { createHash } from "node:crypto";
import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";
import {
  assertCampaignAudienceJoin,
  CampaignRepositoryError,
  parseAudienceSnapshotDocument,
  parseCampaignCheckpointDocument,
  parseCampaignDocument,
  parseCampaignEventDocument,
  prepareCampaignEventGetInput,
  prepareCampaignListInput,
  prepareCampaignSubjectListInput,
  serializeCampaignApprovalBinding,
} from "@/lib/firebase/repositories";

const workspaceId = "workspace_safenet_demo";
const campaignId = "campaign_synthetic_50k";
const snapshotId = "audience_synthetic_50k_v1";
const startsAt = Timestamp.fromDate(new Date("2026-08-10T03:30:00.000Z"));
const createdAt = Timestamp.fromDate(new Date("2026-08-07T05:00:00.000Z"));
const audienceContentHash =
  "7a4d8ce2bc1bafc224e5e2b91a2fc3f8b20b5f062ff1563ca4cf25847ad0d550";
const approvalHash = "6bdce27c7e31e5e064febd7b4dcbd05df208a4ddf33085003848bbfd81c1b1cd";
const templateVersionIds = {
  en: "template_wellness_awareness_en_v3",
  si: "template_wellness_awareness_si_v3",
  ta: "template_wellness_awareness_ta_v3",
} as const;
const templateContentHashes = {
  en: "0cbf38327d7d48ee61558927c6afb8e4e75c1781561906ebbab4def379e6c04f",
  si: "cefbdf676d18b06dfcc4263e659c0585db48de7e7843b57b32566d2215536582",
  ta: "c477a31ee0344bef6c66a25a0a70848f6a0a75262f0df328dd8b04e6479a2b12",
} as const;

function campaignDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: campaignId,
    workspaceId,
    name: "Synthetic 50,000-contact wellness awareness simulation",
    purpose: "health_campaigns",
    messageCategory: "marketing",
    targetAction: "Open the synthetic wellness information journey",
    ownerId: "user_demo_campaign_operator",
    templateVersionIds: { ...templateVersionIds },
    audienceSnapshotId: snapshotId,
    state: "scheduled",
    dispatchMode: "simulation",
    schedule: {
      startsAt,
      timeZone: "Asia/Colombo",
      quietHours: { startsAtLocal: "20:00", endsAtLocal: "08:00" },
    },
    approval: {
      required: true,
      status: "approved",
      scope: "simulation_only",
      approverId: "user_demo_campaign_approver",
      reviewedAt: createdAt,
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
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function audienceSnapshotDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: snapshotId,
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
    contentHash: audienceContentHash,
    immutable: true,
    synthetic: true,
    schemaVersion: 1,
    finalizedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function campaignEventDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: "campaign-event-advance-001",
    workspaceId,
    campaignId,
    actorUid: "user_demo_campaign_operator",
    action: "advance_batch",
    fromState: "dispatching",
    toState: "dispatching",
    revision: 3,
    checkpointId: `${campaignId}:checkpoint:000000`,
    externalCalls: 0,
    networkCalls: 0,
    synthetic: true,
    schemaVersion: 1,
    createdAt,
    ...overrides,
  };
}

function campaignCheckpointDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: `${campaignId}:checkpoint:000000`,
    workspaceId,
    campaignId,
    eventId: "campaign-event-advance-001",
    batchIndex: 0,
    sourceOffsetStart: 0,
    sourceOffsetEnd: 1_310,
    eligibleCount: 1_000,
    languageCounts: { en: 540, si: 240, ta: 220 },
    processedEligible: 1_000,
    scanComplete: false,
    digest: "8".repeat(64),
    externalCalls: 0,
    networkCalls: 0,
    synthetic: true,
    schemaVersion: 1,
    createdAt,
    ...overrides,
  };
}

describe("governed campaign repository", () => {
  it("accepts only bounded workspace and campaign-subject list inputs", () => {
    expect(prepareCampaignListInput({ workspaceId, pageSize: 100 })).toEqual({
      workspaceId,
      pageSize: 100,
    });
    expect(
      prepareCampaignSubjectListInput({ workspaceId, campaignId, pageSize: 50 }),
    ).toEqual({ workspaceId, campaignId, pageSize: 50 });
    expect(
      prepareCampaignEventGetInput({
        workspaceId,
        campaignId,
        eventId: "campaign-event-advance-001",
      }),
    ).toEqual({ workspaceId, campaignId, eventId: "campaign-event-advance-001" });

    for (const input of [
      { workspaceId, pageSize: 101 },
      { workspaceId, pageSize: 0 },
      { workspaceId, extra: true },
      { workspaceId, campaignId, eventId: "bad event id" },
    ]) {
      expect(() => prepareCampaignListInput(input as never)).toThrowError(
        expect.objectContaining<Partial<CampaignRepositoryError>>({ code: "invalid_input" }),
      );
    }
  });

  it("locks the canonical approval serialization and lowercase SHA-256 golden vector", () => {
    const serialized = serializeCampaignApprovalBinding({
      workspaceId,
      campaignId,
      audienceSnapshotId: snapshotId,
      snapshotContentHash: audienceContentHash,
      templateVersionIds,
      templateContentHashes,
      purpose: "health_campaigns",
      messageCategory: "marketing",
      targetAction: "Open the synthetic wellness information journey",
      schedule: {
        startsAtIso: "2026-08-10T03:30:00.000Z",
        timeZone: "Asia/Colombo",
        quietHours: { startsAtLocal: "20:00", endsAtLocal: "08:00" },
      },
    });
    expect(serialized).toBe(
      '["hemas-connect:campaign-approval:v2","workspace_safenet_demo","campaign_synthetic_50k","audience_synthetic_50k_v1","7a4d8ce2bc1bafc224e5e2b91a2fc3f8b20b5f062ff1563ca4cf25847ad0d550","template_wellness_awareness_en_v3","0cbf38327d7d48ee61558927c6afb8e4e75c1781561906ebbab4def379e6c04f","template_wellness_awareness_si_v3","cefbdf676d18b06dfcc4263e659c0585db48de7e7843b57b32566d2215536582","template_wellness_awareness_ta_v3","c477a31ee0344bef6c66a25a0a70848f6a0a75262f0df328dd8b04e6479a2b12","health_campaigns","marketing","Open the synthetic wellness information journey","2026-08-10T03:30:00.000Z","Asia/Colombo","20:00","08:00"]',
    );
    expect(createHash("sha256").update(serialized, "utf8").digest("hex")).toBe(
      approvalHash,
    );
  });

  it("parses the strict simulation campaign without recipient or patient fields", () => {
    const parsed = parseCampaignDocument(campaignDocument(), campaignId, workspaceId);
    expect(parsed).toMatchObject({
      state: "scheduled",
      dispatchMode: "simulation",
      canaryStatus: "not_run",
      batchSize: 1_000,
      externalCalls: 0,
      networkCalls: 0,
    });
    expect(parsed.schedule.startsAt).toBe("2026-08-10T03:30:00.000Z");
    const serialized = JSON.stringify(parsed);
    for (const forbidden of ["recipients", "recipientIds", "patientIds", "contactIds"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("rejects campaign pollution, identity changes and checkpoint/progress substitution", () => {
    const checkpoint38 = `${campaignId}:checkpoint:000038`;
    for (const value of [
      campaignDocument({ recipients: ["patient-1"] }),
      campaignDocument({ ownerUid: "legacy-client-owner" }),
      campaignDocument({ dispatchMode: "external" }),
      campaignDocument({ externalCalls: 1 }),
      campaignDocument({ nextBatchIndex: 51 }),
      campaignDocument({ workspaceId: "workspace_other" }),
      campaignDocument({ id: "campaign_substituted" }),
      campaignDocument({
        approval: {
          ...campaignDocument().approval,
          approverId: "user_demo_campaign_operator",
        },
      }),
      campaignDocument({
        templateVersionIds: {
          ...templateVersionIds,
          en: templateVersionIds.ta,
        },
      }),
      campaignDocument({
        state: "completed",
        processedEligible: 38_443,
        scanOffset: 50_000,
        nextBatchIndex: 39,
        lastCheckpointId: `${campaignId}:checkpoint:000037`,
      }),
      campaignDocument({
        state: "completed",
        processedEligible: 38_443,
        scanOffset: 50_000,
        nextBatchIndex: 38,
        lastCheckpointId: checkpoint38,
      }),
      campaignDocument({
        state: "completed",
        processedEligible: 38_443,
        scanOffset: 38_000,
        nextBatchIndex: 39,
        lastCheckpointId: checkpoint38,
      }),
    ]) {
      expect(() => parseCampaignDocument(value, campaignId, workspaceId)).toThrowError(
        expect.objectContaining({ code: "invalid_persisted_data" }),
      );
    }
  });

  it("reconciles the immutable 50,000-record audience aggregate", () => {
    const parsed = parseAudienceSnapshotDocument(
      audienceSnapshotDocument(),
      snapshotId,
      workspaceId,
      campaignId,
    );
    expect(parsed.eligibleCount).toBe(38_443);
    expect(parsed.excludedCount).toBe(11_557);
    expect(parsed.languageCounts).toEqual({ en: 26_989, si: 12_038, ta: 10_973 });

    for (const value of [
      audienceSnapshotDocument({ eligibleCount: 38_442 }),
      audienceSnapshotDocument({ unknownConsentCount: 3_587 }),
      audienceSnapshotDocument({ languageCounts: { en: 26_988, si: 12_038, ta: 10_973 } }),
      audienceSnapshotDocument({ recipients: ["patient-1"] }),
      audienceSnapshotDocument({ workspaceId: "workspace_other" }),
      audienceSnapshotDocument({ campaignId: "campaign_other" }),
    ]) {
      expect(() =>
        parseAudienceSnapshotDocument(value, snapshotId, workspaceId, campaignId),
      ).toThrowError(expect.objectContaining({ code: "invalid_persisted_data" }));
    }
  });

  it("validates campaign/snapshot joins and completed progress", () => {
    const campaign = parseCampaignDocument(campaignDocument(), campaignId, workspaceId);
    const snapshot = parseAudienceSnapshotDocument(
      audienceSnapshotDocument(),
      snapshotId,
      workspaceId,
      campaignId,
    );
    expect(() => assertCampaignAudienceJoin(campaign, snapshot)).not.toThrow();

    const completed = parseCampaignDocument(
      campaignDocument({
        state: "completed",
        revision: 41,
        canaryStatus: "passed_simulation",
        processedEligible: 38_443,
        scanOffset: 50_000,
        nextBatchIndex: 39,
        lastCheckpointId: `${campaignId}:checkpoint:000038`,
      }),
      campaignId,
      workspaceId,
    );
    expect(() => assertCampaignAudienceJoin(completed, snapshot)).not.toThrow();

    const wrongSnapshot = parseAudienceSnapshotDocument(
      audienceSnapshotDocument({ id: "audience_other" }),
      "audience_other",
      workspaceId,
      campaignId,
    );
    expect(() => assertCampaignAudienceJoin(campaign, wrongSnapshot)).toThrowError(
      expect.objectContaining({ code: "invalid_persisted_data" }),
    );
  });

  it("accepts only immutable event transitions with exact checkpoint binding", () => {
    const parsed = parseCampaignEventDocument(
      campaignEventDocument(),
      "campaign-event-advance-001",
      workspaceId,
      campaignId,
    );
    expect(parsed.action).toBe("advance_batch");

    for (const value of [
      campaignEventDocument({ toState: "scheduled" }),
      campaignEventDocument({ checkpointId: null }),
      campaignEventDocument({ checkpointId: `${campaignId}:checkpoint:not001` }),
      campaignEventDocument({ checkpointId: "campaign_other:checkpoint:000000" }),
      campaignEventDocument({ action: "pause", toState: "paused" }),
      campaignEventDocument({ externalCalls: 1 }),
      campaignEventDocument({ recipientIds: ["patient-1"] }),
      campaignEventDocument({ campaignId: "campaign_other" }),
      campaignEventDocument({ id: "event-substituted" }),
    ]) {
      expect(() =>
        parseCampaignEventDocument(
          value,
          "campaign-event-advance-001",
          workspaceId,
          campaignId,
        ),
      ).toThrowError(expect.objectContaining({ code: "invalid_persisted_data" }));
    }
  });

  it("enforces half-open checkpoint offsets and cumulative batch reconciliation", () => {
    const first = parseCampaignCheckpointDocument(
      campaignCheckpointDocument(),
      `${campaignId}:checkpoint:000000`,
      workspaceId,
      campaignId,
    );
    expect(first.processedEligible).toBe(1_000);

    const final = parseCampaignCheckpointDocument(
      campaignCheckpointDocument({
        id: `${campaignId}:checkpoint:000038`,
        eventId: "campaign-event-final-039",
        batchIndex: 38,
        sourceOffsetStart: 48_700,
        sourceOffsetEnd: 50_000,
        eligibleCount: 443,
        languageCounts: { en: 239, si: 107, ta: 97 },
        processedEligible: 38_443,
        scanComplete: true,
      }),
      `${campaignId}:checkpoint:000038`,
      workspaceId,
      campaignId,
    );
    expect(final).toMatchObject({ scanComplete: true, eligibleCount: 443 });

    for (const value of [
      campaignCheckpointDocument({ id: `${campaignId}:checkpoint:000001` }),
      campaignCheckpointDocument({ batchIndex: 1 }),
      campaignCheckpointDocument({ sourceOffsetEnd: 0 }),
      campaignCheckpointDocument({ languageCounts: { en: 539, si: 240, ta: 220 } }),
      campaignCheckpointDocument({ processedEligible: 999 }),
      campaignCheckpointDocument({ eligibleCount: 999 }),
      campaignCheckpointDocument({ scanComplete: true }),
      campaignCheckpointDocument({ campaignId: "campaign_other" }),
      campaignCheckpointDocument({ recipientIds: ["patient-1"] }),
    ]) {
      expect(() =>
        parseCampaignCheckpointDocument(
          value,
          `${campaignId}:checkpoint:000000`,
          workspaceId,
          campaignId,
        ),
      ).toThrowError(expect.objectContaining({ code: "invalid_persisted_data" }));
    }
  });
});
