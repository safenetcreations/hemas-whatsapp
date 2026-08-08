import type {
  AudienceSnapshotId,
  CampaignId,
  CampaignRecipientId,
  ContactId,
  HmacDigest,
  ISODateTime,
  MemberId,
  Sha256Digest,
  SupportedLanguage,
  TemplateVersionId,
  WorkspaceScopedEntity,
} from "./primitives";
import type { ConsentPurpose, ConsentRecord, MessageCategory, Contact } from "./contacts";
import { canContactReceiveCategory, effectiveConsent } from "./contacts";
import type { MessageTemplateVersion } from "./templates";
import { isTemplateEligible } from "./templates";
import type { Workspace } from "./workspaces";

export type CampaignState =
  | "draft"
  | "audience_building"
  | "compliance_review"
  | "approval_pending"
  | "scheduled"
  | "dispatching"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

export type CampaignDispatchMode = "simulation" | "external";

export interface CampaignSchedule {
  readonly startsAt: ISODateTime | null;
  readonly timeZone: "Asia/Colombo";
  readonly quietHours: {
    readonly startsAtLocal: string;
    readonly endsAtLocal: string;
  };
}

export interface CampaignApproval {
  readonly required: boolean;
  readonly status: "not_requested" | "pending" | "approved" | "rejected" | "invalidated";
  readonly approverId: MemberId | null;
  readonly reviewedAt: ISODateTime | null;
  readonly approvedContentHash: Sha256Digest | null;
  readonly comment: string | null;
}

export interface Campaign extends WorkspaceScopedEntity<CampaignId> {
  readonly name: string;
  readonly purpose: ConsentPurpose;
  readonly messageCategory: MessageCategory;
  readonly ownerId: MemberId;
  readonly targetAction: string;
  readonly templateVersionId: TemplateVersionId;
  readonly audienceSnapshotId: AudienceSnapshotId | null;
  readonly state: CampaignState;
  readonly dispatchMode: CampaignDispatchMode;
  readonly schedule: CampaignSchedule;
  readonly approval: CampaignApproval;
  readonly allowlistTestStatus: "not_run" | "passed_simulation" | "passed_external" | "failed";
  readonly estimatedUsageUnits: number;
  readonly synthetic: boolean;
}

export type CampaignExclusionReason =
  | "suppressed"
  | "invalid_contact"
  | "consent_missing"
  | "consent_withdrawn"
  | "language_unavailable"
  | "frequency_cap"
  | "duplicate"
  | "capacity_unverified";

export interface AudienceSnapshot extends WorkspaceScopedEntity<AudienceSnapshotId> {
  readonly campaignId: CampaignId;
  readonly criteriaSummary: string;
  readonly totalEvaluated: number;
  readonly eligibleCount: number;
  readonly excludedCount: number;
  readonly unknownConsentCount: number;
  readonly exclusionsByReason: Readonly<Partial<Record<CampaignExclusionReason, number>>>;
  readonly languageCounts: Readonly<Record<SupportedLanguage, number>>;
  readonly contentHash: Sha256Digest;
  readonly finalizedAt: ISODateTime;
  readonly immutable: true;
}

export type CampaignRecipientStatus =
  | "pending"
  | "queued"
  | "simulated"
  | "accepted"
  | "sent"
  | "delivered"
  | "failed"
  | "suppressed"
  | "send_uncertain"
  | "reconciled";

export interface CampaignRecipient extends WorkspaceScopedEntity<CampaignRecipientId> {
  readonly campaignId: CampaignId;
  readonly contactId: ContactId;
  readonly deterministicHmacId: HmacDigest;
  readonly eligible: boolean;
  readonly exclusionReason: CampaignExclusionReason | null;
  readonly taskName: string | null;
  readonly providerMessageId: string | null;
  readonly status: CampaignRecipientStatus;
  readonly attemptCount: number;
  readonly nextAttemptAt: ISODateTime | null;
  readonly lastErrorCode: string | null;
}

export interface CampaignEligibilityDecision {
  readonly eligible: boolean;
  readonly reason: CampaignExclusionReason | null;
}

export function evaluateCampaignEligibility(input: {
  readonly contact: Contact;
  readonly consentRecords: readonly ConsentRecord[];
  readonly campaign: Pick<Campaign, "purpose" | "messageCategory">;
}): CampaignEligibilityDecision {
  if (input.contact.suppression.invalidContact) {
    return { eligible: false, reason: "invalid_contact" };
  }

  if (!canContactReceiveCategory(input.contact, input.campaign.messageCategory)) {
    return { eligible: false, reason: "suppressed" };
  }

  const consent = effectiveConsent(input.consentRecords, {
    purpose: input.campaign.purpose,
    category: input.campaign.messageCategory,
  });

  if (consent.status === "unknown") {
    return { eligible: false, reason: "consent_missing" };
  }

  if (consent.status !== "granted") {
    return { eligible: false, reason: "consent_withdrawn" };
  }

  return { eligible: true, reason: null };
}

export type CampaignLaunchBlocker =
  | "campaign_not_ready"
  | "audience_not_finalized"
  | "approval_missing"
  | "allowlist_test_missing"
  | "template_not_eligible"
  | "external_messaging_disabled"
  | "capacity_unverified"
  | "capacity_insufficient";

export interface CampaignLaunchDecision {
  readonly allowed: boolean;
  readonly blockers: readonly CampaignLaunchBlocker[];
}

export function evaluateCampaignLaunch(input: {
  readonly campaign: Campaign;
  readonly audience: AudienceSnapshot | null;
  readonly templateVersion: MessageTemplateVersion;
  readonly workspace: Workspace;
}): CampaignLaunchDecision {
  const blockers: CampaignLaunchBlocker[] = [];
  const { campaign, audience, templateVersion, workspace } = input;

  if (campaign.state !== "scheduled" && campaign.state !== "paused") {
    blockers.push("campaign_not_ready");
  }
  if (!audience || !audience.immutable || campaign.audienceSnapshotId !== audience.id) {
    blockers.push("audience_not_finalized");
  }
  if (campaign.approval.required && campaign.approval.status !== "approved") {
    blockers.push("approval_missing");
  }
  if (
    campaign.allowlistTestStatus !== "passed_simulation" &&
    campaign.allowlistTestStatus !== "passed_external"
  ) {
    blockers.push("allowlist_test_missing");
  }
  if (!isTemplateEligible({ version: templateVersion, dispatchMode: campaign.dispatchMode })) {
    blockers.push("template_not_eligible");
  }

  if (campaign.dispatchMode === "external") {
    if (!workspace.externalMessaging.enabled) {
      blockers.push("external_messaging_disabled");
    }
    if (workspace.externalMessaging.verifiedCapacity === null) {
      blockers.push("capacity_unverified");
    } else if (audience && audience.eligibleCount > workspace.externalMessaging.verifiedCapacity) {
      blockers.push("capacity_insufficient");
    }
  }

  return { allowed: blockers.length === 0, blockers };
}

