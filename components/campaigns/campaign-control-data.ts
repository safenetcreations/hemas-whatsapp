import type { CampaignWorkspaceRecord } from "./campaign-workspace-data";

export type CampaignControlData = CampaignWorkspaceRecord;

export interface CampaignPreflightCheck {
  readonly label: string;
  readonly detail: string;
  readonly pass: boolean;
}

export function buildCampaignPreflightChecks(
  data: CampaignControlData,
): readonly CampaignPreflightCheck[] {
  const { audience, campaign, templates } = data;
  const exclusionTotal = Object.values(audience.exclusionsByReason).reduce(
    (total, count) => total + count,
    0,
  );
  const languageTotal = Object.values(audience.languageCounts).reduce(
    (total, count) => total + count,
    0,
  );

  return [
    {
      label: "Synthetic tenant boundary",
      detail: "Persisted records are workspace-bound and schema-versioned",
      pass:
        campaign.synthetic &&
        audience.synthetic &&
        campaign.workspaceId === audience.workspaceId,
    },
    {
      label: "Immutable audience snapshot",
      detail: "Campaign and snapshot identities are joined exactly",
      pass:
        audience.immutable &&
        campaign.audienceSnapshotId === audience.id &&
        audience.campaignId === campaign.id,
    },
    {
      label: "Audience counts reconcile",
      detail: "Eligible, excluded, reason, consent, and language totals agree",
      pass:
        audience.eligibleCount + audience.excludedCount === audience.totalEvaluated &&
        exclusionTotal === audience.excludedCount &&
        languageTotal === audience.totalEvaluated &&
        audience.unknownConsentCount ===
          audience.exclusionsByReason.consent_missing,
    },
    {
      label: "Three immutable language versions",
      detail: "English, Sinhala, and Tamil each bind to local SafeNet v3 metadata",
      pass:
        templates.length === 3 &&
        templates.every(
          (template) => template.version === 3 && template.localState === "approved",
        ),
    },
    {
      label: "Provider evidence is honest",
      detail: "Every template remains not submitted and unverified by Meta",
      pass: templates.every(
        (template) =>
          template.providerSubmissionState === "not_submitted" &&
          template.providerApprovalState === "unverified",
      ),
    },
    {
      label: "Independent simulation approval",
      detail: "Owner and approver differ; the loader verified the complete approval hash",
      pass:
        campaign.approval.status === "approved" &&
        campaign.approval.scope === "simulation_only" &&
        campaign.ownerId !== campaign.approval.approverId,
    },
    {
      label: "Bounded checkpoint progress",
      detail: "At most 1,000 eligible synthetic records enter each persisted batch",
      pass:
        campaign.batchSize === 1_000 &&
        campaign.processedEligible <= audience.eligibleCount &&
        campaign.scanOffset <= audience.totalEvaluated,
    },
    {
      label: "External delivery hard lock",
      detail: "Simulation mode and both external counters remain exactly zero",
      pass:
        campaign.dispatchMode === "simulation" &&
        campaign.externalCalls === 0 &&
        campaign.networkCalls === 0,
    },
  ];
}
