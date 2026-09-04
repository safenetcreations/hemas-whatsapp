import {
  doc,
  getDocFromServer,
  type Firestore,
  type Timestamp,
} from "firebase/firestore";
import { z } from "zod";
import {
  buildCampaignFunctionsRequest,
  type CampaignFunctionsRequest,
  type CampaignFunctionsResponse,
} from "@/lib/firebase/campaign-functions-emulator";
import {
  getGovernedCampaignBundle,
  getCampaignEvent,
  getTemplateCatalogueItem,
  listCampaignCheckpoints,
  listCampaignEvents,
  listCampaigns,
  parseCampaignCheckpointDocument,
  serializeCampaignApprovalBinding,
  verifyTemplateContentHash,
  type CampaignAction,
  type CampaignCheckpointDTO,
  type CampaignDTO,
  type CampaignEventDTO,
  type CampaignListInput,
  type CampaignEventGetInput,
  type CampaignSubjectListInput,
  type GovernedCampaignBundleDTO,
  type TemplateCatalogueItemDTO,
  type CatalogueGetInput,
} from "@/lib/firebase/repositories";
import type {
  VerifiedWorkspaceSession,
  WorkspaceRole,
} from "@/lib/firebase/workspace-session-model";
import { assertSyntheticAggregateEvidence } from "./campaign-aggregate-validator";
import { DATA_SOURCE } from "@/lib/firebase/boundary-copy";

export const SYNTHETIC_CAMPAIGN_ID = "campaign_synthetic_50k";
const CAMPAIGN_PAGE_SIZE = 50;
const SYNTHETIC_SNAPSHOT_ID = "audience_synthetic_50k_v1";
const SYNTHETIC_CAMPAIGN_OWNER_ID = "user_demo_campaign_operator";
const SYNTHETIC_CAMPAIGN_APPROVER_ID = "user_demo_campaign_approver";
const SYNTHETIC_CAMPAIGN_NAME =
  "Synthetic 50,000-contact wellness awareness simulation";
const SYNTHETIC_CAMPAIGN_TARGET =
  "Open the synthetic wellness information journey";
const SYNTHETIC_CAMPAIGN_START = "2026-08-10T03:30:00.000Z";
const SYNTHETIC_AUDIENCE_CRITERIA =
  "Synthetic consented wellness audience; deterministic aggregate exclusions only.";
const SYNTHETIC_AUDIENCE_HASH =
  "7a4d8ce2bc1bafc224e5e2b91a2fc3f8b20b5f062ff1563ca4cf25847ad0d550";
const SYNTHETIC_APPROVAL_HASH =
  "6bdce27c7e31e5e064febd7b4dcbd05df208a4ddf33085003848bbfd81c1b1cd";
const SYNTHETIC_TEMPLATE_IDS = Object.freeze({
  en: "template_wellness_awareness_en_v3",
  si: "template_wellness_awareness_si_v3",
  ta: "template_wellness_awareness_ta_v3",
});
const SYNTHETIC_TEMPLATE_CONTENT_HASHES = Object.freeze({
  en: "0cbf38327d7d48ee61558927c6afb8e4e75c1781561906ebbab4def379e6c04f",
  si: "cefbdf676d18b06dfcc4263e659c0585db48de7e7843b57b32566d2215536582",
  ta: "c477a31ee0344bef6c66a25a0a70848f6a0a75262f0df328dd8b04e6479a2b12",
});
const SYNTHETIC_AUDIENCE_COUNTS = Object.freeze({
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

const CAMPAIGN_READ_ROLES: readonly WorkspaceRole[] = [
  "tenant_admin",
  "campaign_operator",
  "campaign_approver",
  "analyst",
];

export type CampaignTemplateEvidence = {
  readonly id: string;
  readonly language: "en" | "si" | "ta";
  readonly version: 3;
  readonly localState: "approved";
  readonly providerSubmissionState: "not_submitted";
  readonly providerApprovalState: "unverified";
  readonly contentHash: string;
  readonly ownershipNotice: string;
};

export type CampaignWorkspaceRecord = {
  readonly campaign: CampaignDTO;
  readonly audience: GovernedCampaignBundleDTO["audienceSnapshot"];
  readonly templates: readonly CampaignTemplateEvidence[];
  readonly events: readonly CampaignEventDTO[];
  readonly checkpoints: readonly CampaignCheckpointDTO[];
};

export type CampaignWorkspaceResult = {
  readonly campaigns: readonly CampaignDTO[];
  readonly selected: CampaignWorkspaceRecord | null;
};

const auditTimestamp = z.custom<Timestamp>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof value.toDate === "function",
);

const campaignAuditEvidenceSchema = z
  .object({
    id: z.string().min(1).max(128),
    workspaceId: z.string().min(1).max(128),
    actorType: z.literal("user"),
    actorUid: z.string().min(1).max(128),
    action: z.enum([
      "campaign.run_canary",
      "campaign.start",
      "campaign.advance_batch",
      "campaign.pause",
      "campaign.resume",
      "campaign.inject_fault",
      "campaign.retry",
      "campaign.cancel",
    ]),
    resourceType: z.literal("campaign"),
    resourceId: z.string().min(1).max(128),
    outcome: z.literal("allowed"),
    requestId: z.string().min(1).max(128),
    occurredAt: auditTimestamp,
    createdAt: auditTimestamp,
    metadata: z
      .object({
        purpose: z.literal("campaign_governance"),
        campaignAction: z.enum([
          "run_canary",
          "start",
          "advance_batch",
          "pause",
          "resume",
          "inject_fault",
          "retry",
          "cancel",
        ]),
        fromState: z.enum([
          "scheduled",
          "dispatching",
          "paused",
          "completed",
          "cancelled",
          "failed",
        ]),
        toState: z.enum([
          "scheduled",
          "dispatching",
          "paused",
          "completed",
          "cancelled",
          "failed",
        ]),
        revision: z.number().int().min(1).max(1_000_000_000),
        checkpointId: z.string().min(1).max(128).nullable(),
        batchEligibleCount: z.number().int().min(0).max(1_000),
        processedEligible: z.number().int().min(0).max(50_000),
        scanOffset: z.number().int().min(0).max(50_000),
        dispatchMode: z.literal("simulation"),
        synthetic: z.literal(true),
        externalCalls: z.literal(0),
        networkCalls: z.literal(0),
      })
      .strict(),
    synthetic: z.literal(true),
    schemaVersion: z.literal(1),
  })
  .strict();

type CampaignAuditDocument = z.infer<typeof campaignAuditEvidenceSchema>;

export type CampaignActionAuditEvidence = Omit<
  CampaignAuditDocument,
  "occurredAt" | "createdAt"
> & {
  readonly occurredAt: string;
  readonly createdAt: string;
};

export type CampaignActionImmutableEvidence = {
  readonly event: CampaignEventDTO;
  readonly checkpoint: CampaignCheckpointDTO | null;
};

export interface CampaignWorkspaceReads {
  readonly listCampaigns: (
    db: Firestore,
    input: CampaignListInput,
  ) => Promise<readonly CampaignDTO[]>;
  readonly getBundle: (
    db: Firestore,
    input: { readonly workspaceId: string; readonly campaignId: string },
  ) => Promise<GovernedCampaignBundleDTO>;
  readonly getTemplate: (
    db: Firestore,
    input: CatalogueGetInput,
  ) => Promise<TemplateCatalogueItemDTO>;
  readonly listEvents: (
    db: Firestore,
    input: CampaignSubjectListInput,
  ) => Promise<readonly CampaignEventDTO[]>;
  readonly listCheckpoints: (
    db: Firestore,
    input: CampaignSubjectListInput,
  ) => Promise<readonly CampaignCheckpointDTO[]>;
  readonly getEvent: (
    db: Firestore,
    input: CampaignEventGetInput,
  ) => Promise<CampaignEventDTO>;
}

const defaultReads: CampaignWorkspaceReads = {
  listCampaigns,
  getBundle: getGovernedCampaignBundle,
  getTemplate: getTemplateCatalogueItem,
  listEvents: listCampaignEvents,
  listCheckpoints: listCampaignCheckpoints,
  getEvent: getCampaignEvent,
};

export class CampaignWorkspaceDataError extends Error {
  constructor(
    message: string,
    readonly code: "access_denied" | "invalid_join" | "load_failed",
    readonly sourceCode = "",
  ) {
    super(message);
    this.name = "CampaignWorkspaceDataError";
  }
}

function invalidJoin(message: string): never {
  throw new CampaignWorkspaceDataError(message, "invalid_join");
}

export function roleCanReadCampaignWorkspace(role: WorkspaceRole): boolean {
  return CAMPAIGN_READ_ROLES.some((allowedRole) => allowedRole === role);
}

export function campaignWorkspaceAuthorityKey(
  session: VerifiedWorkspaceSession,
): string {
  return JSON.stringify([
    session.workspaceId,
    session.uid,
    session.role,
    [...session.teamIds].sort(),
    [...session.locationIds].sort(),
  ]);
}

export function roleCanControlCampaign(
  session: VerifiedWorkspaceSession,
  campaign: Pick<CampaignDTO, "workspaceId" | "ownerId">,
): boolean {
  return (
    campaign.workspaceId === session.workspaceId &&
    (session.role === "tenant_admin" ||
      (session.role === "campaign_operator" && campaign.ownerId === session.uid))
  );
}

function assertSyntheticSession(session: VerifiedWorkspaceSession): void {
  if (
    !session.workspaceId ||
    !session.uid ||
    (session.workspaceMode !== "local" && session.workspaceMode !== "demo") ||
    session.dataClassification !== "synthetic_only" ||
    !roleCanReadCampaignWorkspace(session.role)
  ) {
    throw new CampaignWorkspaceDataError(
      "The verified member cannot read this synthetic campaign workspace.",
      "access_denied",
    );
  }
}

async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) invalidJoin("Campaign approval evidence cannot be verified in this browser.");
  try {
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return invalidJoin("Campaign approval evidence could not be verified.");
  }
}

function expectedTemplateId(language: "en" | "si" | "ta"): string {
  return SYNTHETIC_TEMPLATE_IDS[language];
}

async function templateEvidenceForCampaign(
  campaign: CampaignDTO,
  templates: readonly TemplateCatalogueItemDTO[],
): Promise<readonly CampaignTemplateEvidence[]> {
  const seen = new Set<string>();
  for (const template of templates) {
    if (seen.has(template.id)) invalidJoin("The template catalogue contained duplicate IDs.");
    seen.add(template.id);
  }

  return Promise.all((["en", "si", "ta"] as const).map(async (language) => {
    const templateId = campaign.templateVersionIds[language];
    const candidate = templates.find((item) => item.id === templateId);
    if (!candidate) {
      invalidJoin(`The ${language} campaign template is missing.`);
    }
    let template: TemplateCatalogueItemDTO;
    try {
      template = await verifyTemplateContentHash(candidate);
    } catch {
      return invalidJoin(
        `The ${language} campaign template content hash does not match its governed body and variables.`,
      );
    }
    if (
      templateId !== expectedTemplateId(language) ||
      template.contentHash !== SYNTHETIC_TEMPLATE_CONTENT_HASHES[language] ||
      template.workspaceId !== campaign.workspaceId ||
      template.assetKey !== "wellness_awareness" ||
      template.providerName !== "wellness_awareness" ||
      template.category !== "marketing" ||
      template.language !== language ||
      template.version !== 3 ||
      template.localState !== "approved" ||
      !template.immutable ||
      template.providerState.submissionState !== "not_submitted" ||
      template.providerState.approvalState !== "unverified" ||
      template.providerState.authority !== "none" ||
      template.providerState.assetId !== null ||
      template.providerState.qualityRating !== "unknown" ||
      template.providerState.checkedAt !== null ||
      template.ownership.ownerKind !== "safenet_demo" ||
      template.ownership.ownerWorkspaceId !== campaign.workspaceId ||
      template.ownership.transferableToHemas !== false ||
      template.ownership.productionUseAllowed !== false ||
      !template.synthetic ||
      template.schemaVersion !== 1
    ) {
      invalidJoin(
        `The ${language} campaign template did not match its immutable SafeNet demo evidence.`,
      );
    }

    return {
      id: template.id,
      language,
      version: 3,
      localState: "approved",
      providerSubmissionState: "not_submitted",
      providerApprovalState: "unverified",
      contentHash: template.contentHash,
      ownershipNotice: template.ownership.notice,
    };
  }));
}

async function assertApprovalBinding(
  campaign: CampaignDTO,
  snapshot: GovernedCampaignBundleDTO["audienceSnapshot"],
  templates: readonly CampaignTemplateEvidence[],
): Promise<void> {
  const contentHashes = Object.fromEntries(
    templates.map((template) => [template.language, template.contentHash]),
  ) as { en: string; si: string; ta: string };
  const serialized = serializeCampaignApprovalBinding({
    workspaceId: campaign.workspaceId,
    campaignId: campaign.id,
    audienceSnapshotId: snapshot.id,
    snapshotContentHash: snapshot.contentHash,
    templateVersionIds: campaign.templateVersionIds,
    templateContentHashes: contentHashes,
    purpose: campaign.purpose,
    messageCategory: campaign.messageCategory,
    targetAction: campaign.targetAction,
    schedule: {
      startsAtIso: campaign.schedule.startsAt,
      timeZone: campaign.schedule.timeZone,
      quietHours: campaign.schedule.quietHours,
    },
  });
  if (
    campaign.approval.approvedContentHash !== SYNTHETIC_APPROVAL_HASH ||
    (await sha256Hex(serialized)) !== campaign.approval.approvedContentHash
  ) {
    invalidJoin(
      "The approval hash no longer binds the audience, templates, purpose, target, and schedule.",
    );
  }
}

function orderedEvents(
  campaign: CampaignDTO,
  events: readonly CampaignEventDTO[],
): readonly CampaignEventDTO[] {
  if (events.length > CAMPAIGN_PAGE_SIZE) {
    invalidJoin("The bounded lifecycle event window exceeded its fixed page size.");
  }
  const ids = new Set<string>();
  const revisions = new Set<number>();
  const ordered = [...events].sort((left, right) => right.revision - left.revision);

  for (const event of ordered) {
    if (
      ids.has(event.id) ||
      revisions.has(event.revision) ||
      !eventHasValidCampaignEnvelope(campaign, event)
    ) {
      invalidJoin("Campaign events failed tenant, revision, or zero-call validation.");
    }
    ids.add(event.id);
    revisions.add(event.revision);
  }

  if (ordered.length !== Math.min(campaign.revision, CAMPAIGN_PAGE_SIZE)) {
    invalidJoin("The lifecycle event window is not the exact bounded revision suffix.");
  }

  if (campaign.revision === 0 && ordered.length !== 0) {
    invalidJoin("A revision-zero campaign cannot carry lifecycle events.");
  }
  if (
    campaign.revision > 0 &&
    (ordered.length === 0 ||
      ordered[0]?.revision !== campaign.revision ||
      ordered[0]?.toState !== campaign.state ||
      ordered[0]?.createdAt !== campaign.updatedAt)
  ) {
    invalidJoin(
      "The latest lifecycle event does not match current campaign state and update time.",
    );
  }
  for (let index = 1; index < ordered.length; index += 1) {
    const newer = ordered[index - 1]!;
    const older = ordered[index]!;
    if (
      newer.revision - older.revision !== 1 ||
      newer.fromState !== older.toState ||
      Date.parse(newer.createdAt) < Date.parse(older.createdAt)
    ) {
      invalidJoin(
        "The bounded lifecycle event sequence contains a revision, state, or time discontinuity.",
      );
    }
  }
  return ordered;
}

function eventHasValidCampaignEnvelope(
  campaign: CampaignDTO,
  event: CampaignEventDTO,
): boolean {
  return (
    event.workspaceId === campaign.workspaceId &&
    event.campaignId === campaign.id &&
    Number.isInteger(event.revision) &&
    event.revision >= 1 &&
    event.revision <= campaign.revision &&
    event.externalCalls === 0 &&
    event.networkCalls === 0 &&
    event.synthetic === true &&
    event.schemaVersion === 1 &&
    Number.isFinite(Date.parse(event.createdAt))
  );
}

function orderedCheckpoints(
  campaign: CampaignDTO,
  events: readonly CampaignEventDTO[],
  checkpoints: readonly CampaignCheckpointDTO[],
  latestCheckpointEvent: CampaignEventDTO | null,
): readonly CampaignCheckpointDTO[] {
  const ids = new Set<string>();
  const batchIndexes = new Set<number>();
  const ordered = [...checkpoints].sort(
    (left, right) => right.batchIndex - left.batchIndex,
  );

  for (const checkpoint of ordered) {
    if (
      ids.has(checkpoint.id) ||
      batchIndexes.has(checkpoint.batchIndex) ||
      checkpoint.workspaceId !== campaign.workspaceId ||
      checkpoint.campaignId !== campaign.id ||
      checkpoint.externalCalls !== 0 ||
      checkpoint.networkCalls !== 0 ||
      !checkpoint.synthetic ||
      checkpoint.schemaVersion !== 1
    ) {
      invalidJoin("Campaign checkpoints failed tenant, batch, or zero-call validation.");
    }
    ids.add(checkpoint.id);
    batchIndexes.add(checkpoint.batchIndex);
  }

  if (ordered.length !== campaign.nextBatchIndex) {
    invalidJoin("The complete bounded checkpoint sequence is missing or duplicated.");
  }
  for (let index = 0; index < ordered.length; index += 1) {
    if (ordered[index]!.batchIndex !== campaign.nextBatchIndex - index - 1) {
      invalidJoin("Campaign checkpoint indexes are not contiguous.");
    }
  }

  const ascending = [...ordered].reverse();
  for (let index = 1; index < ascending.length; index += 1) {
    if (ascending[index - 1]!.sourceOffsetEnd !== ascending[index]!.sourceOffsetStart) {
      invalidJoin("Campaign checkpoint scan offsets are not contiguous.");
    }
  }

  const latest = ordered[0];
  if (latest) {
    const linkedWindowEvent = events.find((event) => event.id === latest.eventId);
    const linkedEvent = linkedWindowEvent ?? latestCheckpointEvent;
    if (!linkedWindowEvent) {
      const oldestWindowEvent = events.at(-1);
      if (
        events.length !== CAMPAIGN_PAGE_SIZE ||
        !oldestWindowEvent ||
        !latestCheckpointEvent ||
        !eventHasValidCampaignEnvelope(campaign, latestCheckpointEvent) ||
        latestCheckpointEvent.revision >= oldestWindowEvent.revision ||
        Date.parse(latestCheckpointEvent.createdAt) >
          Date.parse(oldestWindowEvent.createdAt)
      ) {
        invalidJoin(
          "The checkpoint event was missing from, or did not predate, the complete bounded lifecycle window.",
        );
      }
    }
    if (
      campaign.lastCheckpointId !== latest.id ||
      campaign.processedEligible !== latest.processedEligible ||
      campaign.scanOffset !== latest.sourceOffsetEnd ||
      !linkedEvent ||
      linkedEvent.id !== latest.eventId ||
      linkedEvent.workspaceId !== campaign.workspaceId ||
      linkedEvent.campaignId !== campaign.id ||
      linkedEvent.action !== "advance_batch" ||
      linkedEvent.checkpointId !== latest.id ||
      linkedEvent.createdAt !== latest.createdAt
    ) {
      invalidJoin("The latest checkpoint does not match campaign progress and event evidence.");
    }
  } else if (
    campaign.lastCheckpointId !== null ||
    campaign.processedEligible !== 0 ||
    campaign.scanOffset !== 0
  ) {
    invalidJoin("Campaign progress exists without checkpoint evidence.");
  }

  for (const event of events) {
    if (event.action !== "advance_batch") continue;
    const checkpoint = ordered.find((candidate) => candidate.id === event.checkpointId);
    if (!checkpoint || checkpoint.eventId !== event.id) {
      invalidJoin("A batch lifecycle event is missing its exact checkpoint evidence.");
    }
  }
  return ordered;
}

function assertExactSyntheticDemoContract(
  campaign: CampaignDTO,
  audience: GovernedCampaignBundleDTO["audienceSnapshot"],
): void {
  const exactNumberMap = (
    actual: Readonly<Record<string, number>>,
    expected: Readonly<Record<string, number>>,
  ) =>
    Object.keys(actual).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, value]) => actual[key] === value);

  if (
    campaign.id !== SYNTHETIC_CAMPAIGN_ID ||
    audience.id !== SYNTHETIC_SNAPSHOT_ID ||
    campaign.audienceSnapshotId !== SYNTHETIC_SNAPSHOT_ID ||
    audience.campaignId !== SYNTHETIC_CAMPAIGN_ID ||
    campaign.name !== SYNTHETIC_CAMPAIGN_NAME ||
    campaign.ownerId !== SYNTHETIC_CAMPAIGN_OWNER_ID ||
    campaign.approval.approverId !== SYNTHETIC_CAMPAIGN_APPROVER_ID ||
    campaign.purpose !== "health_campaigns" ||
    campaign.messageCategory !== "marketing" ||
    campaign.targetAction !== SYNTHETIC_CAMPAIGN_TARGET ||
    campaign.templateVersionIds.en !== SYNTHETIC_TEMPLATE_IDS.en ||
    campaign.templateVersionIds.si !== SYNTHETIC_TEMPLATE_IDS.si ||
    campaign.templateVersionIds.ta !== SYNTHETIC_TEMPLATE_IDS.ta ||
    campaign.schedule.startsAt !== SYNTHETIC_CAMPAIGN_START ||
    campaign.schedule.timeZone !== "Asia/Colombo" ||
    campaign.schedule.quietHours.startsAtLocal !== "20:00" ||
    campaign.schedule.quietHours.endsAtLocal !== "08:00" ||
    campaign.batchSize !== 1_000 ||
    campaign.nextBatchIndex > 39 ||
    audience.criteriaSummary !== SYNTHETIC_AUDIENCE_CRITERIA ||
    audience.totalEvaluated !== SYNTHETIC_AUDIENCE_COUNTS.totalEvaluated ||
    audience.eligibleCount !== SYNTHETIC_AUDIENCE_COUNTS.eligibleCount ||
    audience.excludedCount !== SYNTHETIC_AUDIENCE_COUNTS.excludedCount ||
    audience.unknownConsentCount !== SYNTHETIC_AUDIENCE_COUNTS.unknownConsentCount ||
    audience.contentHash !== SYNTHETIC_AUDIENCE_HASH ||
    !exactNumberMap(
      audience.exclusionsByReason,
      SYNTHETIC_AUDIENCE_COUNTS.exclusionsByReason,
    ) ||
    !exactNumberMap(
      audience.languageCounts,
      SYNTHETIC_AUDIENCE_COUNTS.languageCounts,
    )
  ) {
    invalidJoin("Persisted data drifted from the fixed synthetic 50,000-record demo contract.");
  }
}

function assertSafeCampaignReadPlan(
  campaign: CampaignDTO,
  workspaceId: string,
): void {
  if (
    campaign.id !== SYNTHETIC_CAMPAIGN_ID ||
    campaign.workspaceId !== workspaceId ||
    campaign.audienceSnapshotId !== SYNTHETIC_SNAPSHOT_ID ||
    campaign.templateVersionIds.en !== SYNTHETIC_TEMPLATE_IDS.en ||
    campaign.templateVersionIds.si !== SYNTHETIC_TEMPLATE_IDS.si ||
    campaign.templateVersionIds.ta !== SYNTHETIC_TEMPLATE_IDS.ta ||
    campaign.dispatchMode !== "simulation" ||
    campaign.externalCalls !== 0 ||
    campaign.networkCalls !== 0 ||
    !campaign.synthetic ||
    campaign.schemaVersion !== 1
  ) {
    invalidJoin(
      "The campaign list could not authorize the fixed snapshot and template read plan.",
    );
  }
}

export async function assembleCampaignWorkspaceRecord(input: {
  readonly session: VerifiedWorkspaceSession;
  readonly bundle: GovernedCampaignBundleDTO;
  readonly templates: readonly TemplateCatalogueItemDTO[];
  readonly events: readonly CampaignEventDTO[];
  readonly checkpoints: readonly CampaignCheckpointDTO[];
  readonly latestCheckpointEvent?: CampaignEventDTO | null;
}): Promise<CampaignWorkspaceRecord> {
  assertSyntheticSession(input.session);
  const { audienceSnapshot: audience, campaign } = input.bundle;
  const campaignCreatedAt = Date.parse(campaign.createdAt);
  const campaignUpdatedAt = Date.parse(campaign.updatedAt);
  assertExactSyntheticDemoContract(campaign, audience);
  if (
    campaign.id !== SYNTHETIC_CAMPAIGN_ID ||
    campaign.workspaceId !== input.session.workspaceId ||
    audience.workspaceId !== input.session.workspaceId ||
    audience.campaignId !== campaign.id ||
    campaign.audienceSnapshotId !== audience.id ||
    campaign.dispatchMode !== "simulation" ||
    campaign.externalCalls !== 0 ||
    campaign.networkCalls !== 0 ||
    !campaign.synthetic ||
    !audience.synthetic ||
    !audience.immutable ||
    campaign.schemaVersion !== 1 ||
    audience.schemaVersion !== 1 ||
    !Number.isFinite(campaignCreatedAt) ||
    !Number.isFinite(campaignUpdatedAt) ||
    campaignUpdatedAt < campaignCreatedAt ||
    campaign.processedEligible > audience.eligibleCount ||
    campaign.scanOffset > audience.totalEvaluated
  ) {
    invalidJoin("Campaign and audience records failed their synthetic tenant join.");
  }
  const canaryRelationValid =
    (campaign.state === "scheduled" &&
      (campaign.canaryStatus === "not_run" ||
        campaign.canaryStatus === "passed_simulation") &&
      campaign.processedEligible === 0 &&
      campaign.scanOffset === 0 &&
      campaign.nextBatchIndex === 0) ||
    (["dispatching", "paused", "completed"] as const).some(
      (state) =>
        campaign.state === state &&
        campaign.canaryStatus === "passed_simulation",
    ) ||
    (campaign.state === "failed" && campaign.canaryStatus === "failed") ||
    campaign.state === "cancelled";
  if (!canaryRelationValid) {
    invalidJoin("Campaign state and simulator canary evidence do not agree.");
  }
  if (
    campaign.approval.status !== "approved" ||
    campaign.approval.scope !== "simulation_only" ||
    campaign.ownerId === campaign.approval.approverId
  ) {
    invalidJoin("Campaign approval is not independent simulation-only evidence.");
  }

  const templates = await templateEvidenceForCampaign(campaign, input.templates);
  await assertApprovalBinding(campaign, audience, templates);
  const events = orderedEvents(campaign, input.events);
  const checkpoints = orderedCheckpoints(
    campaign,
    events,
    input.checkpoints,
    input.latestCheckpointEvent ?? null,
  );
  try {
    await assertSyntheticAggregateEvidence({ campaign, audience, checkpoints });
  } catch {
    invalidJoin(
      "Campaign lifecycle or checkpoint evidence failed the fixed aggregate simulator algorithm.",
    );
  }
  return { campaign, audience, templates, events, checkpoints };
}

export function availableCampaignActions(
  session: VerifiedWorkspaceSession,
  record: CampaignWorkspaceRecord,
): readonly CampaignAction[] {
  const { campaign, audience } = record;
  if (!roleCanControlCampaign(session, campaign)) return [];
  switch (campaign.state) {
    case "scheduled":
      if (campaign.canaryStatus === "not_run") return ["run_canary", "cancel"];
      if (campaign.canaryStatus === "passed_simulation") return ["start", "cancel"];
      return [];
    case "dispatching":
      return campaign.processedEligible < audience.eligibleCount
        ? ["advance_batch", "pause", "inject_fault", "cancel"]
        : [];
    case "paused":
      return ["resume", "cancel"];
    case "failed":
      return ["retry", "cancel"];
    default:
      return [];
  }
}

export async function buildCampaignActionRequest(input: {
  readonly session: VerifiedWorkspaceSession;
  readonly record: CampaignWorkspaceRecord;
  readonly action: CampaignAction;
}): Promise<CampaignFunctionsRequest> {
  if (!availableCampaignActions(input.session, input.record).includes(input.action)) {
    throw new CampaignWorkspaceDataError(
      "The verified member cannot request this campaign transition.",
      "access_denied",
    );
  }
  return buildCampaignFunctionsRequest({
    workspaceId: input.session.workspaceId,
    campaignId: input.record.campaign.id,
    actorUid: input.session.uid,
    action: input.action,
    expectedRevision: input.record.campaign.revision,
  });
}

export async function readCampaignActionAuditEvidence(
  db: Firestore,
  input: {
    readonly workspaceId: string;
    readonly auditEventId: string;
    readonly actorUid: string;
  },
): Promise<CampaignActionAuditEvidence> {
  try {
    const snapshot = await getDocFromServer(
      doc(
        db,
        "workspaces",
        input.workspaceId,
        "auditEvents",
        input.auditEventId,
      ),
    );
    if (!snapshot.exists()) invalidJoin("The callable audit event is missing.");
    const parsed = campaignAuditEvidenceSchema.safeParse(snapshot.data());
    if (
      !parsed.success ||
      parsed.data.id !== snapshot.id ||
      parsed.data.id !== input.auditEventId ||
      parsed.data.workspaceId !== input.workspaceId ||
      parsed.data.actorUid !== input.actorUid
    ) {
      invalidJoin("The callable audit event failed its exact tenant and actor binding.");
    }
    return {
      ...parsed.data,
      occurredAt: parsed.data.occurredAt.toDate().toISOString(),
      createdAt: parsed.data.createdAt.toDate().toISOString(),
    };
  } catch (error) {
    if (error instanceof CampaignWorkspaceDataError) throw error;
    const sourceCode =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    throw new CampaignWorkspaceDataError(
      "The callable audit event could not be verified.",
      "load_failed",
      sourceCode,
    );
  }
}

export async function readCampaignActionImmutableEvidence(
  db: Firestore,
  input: {
    readonly workspaceId: string;
    readonly campaignId: string;
    readonly eventId: string;
    readonly checkpointId: string | null;
  },
): Promise<CampaignActionImmutableEvidence> {
  try {
    const event = await getCampaignEvent(db, {
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      eventId: input.eventId,
    });

    if (input.checkpointId === null) return { event, checkpoint: null };
    const checkpointSnapshot = await getDocFromServer(
      doc(
        db,
        "workspaces",
        input.workspaceId,
        "campaignCheckpoints",
        input.checkpointId,
      ),
    );
    if (!checkpointSnapshot.exists()) invalidJoin("The callable checkpoint is missing.");
    return {
      event,
      checkpoint: parseCampaignCheckpointDocument(
        checkpointSnapshot.data(),
        checkpointSnapshot.id,
        input.workspaceId,
        input.campaignId,
      ),
    };
  } catch (error) {
    if (error instanceof CampaignWorkspaceDataError) throw error;
    const sourceCode =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    throw new CampaignWorkspaceDataError(
      "The callable immutable event or checkpoint could not be verified.",
      "load_failed",
      sourceCode,
    );
  }
}

export function assertCampaignActionEvidence(input: {
  readonly session: VerifiedWorkspaceSession;
  readonly previous: CampaignWorkspaceRecord;
  readonly current: CampaignWorkspaceRecord;
  readonly response: CampaignFunctionsResponse;
  readonly audit: CampaignActionAuditEvidence;
  readonly immutable: CampaignActionImmutableEvidence;
}): void {
  const { audit, current, immutable, previous, response, session } = input;
  const result = response.result;
  const campaign = current.campaign;
  const exactCurrentRevision = campaign.revision === result.revision;
  if (
    previous.campaign.workspaceId !== session.workspaceId ||
    previous.campaign.id !== result.campaignId ||
    previous.campaign.revision + 1 !== result.revision ||
    campaign.workspaceId !== session.workspaceId ||
    campaign.id !== result.campaignId ||
    campaign.revision < result.revision ||
    campaign.processedEligible < result.processedEligible ||
    campaign.scanOffset < result.scanOffset ||
    campaign.nextBatchIndex < result.nextBatchIndex ||
    (exactCurrentRevision &&
      (campaign.state !== result.state ||
        campaign.canaryStatus !== result.canaryStatus ||
        campaign.processedEligible !== result.processedEligible ||
        campaign.scanOffset !== result.scanOffset ||
        campaign.nextBatchIndex !== result.nextBatchIndex)) ||
    campaign.externalCalls !== 0 ||
    campaign.networkCalls !== 0
  ) {
    invalidJoin("The callable result does not match authoritative campaign state.");
  }

  const event = immutable.event;
  if (
    event.id !== result.eventId ||
    event.workspaceId !== session.workspaceId ||
    event.campaignId !== campaign.id ||
    event.actorUid !== session.uid ||
    event.action !== result.action ||
    event.fromState !== previous.campaign.state ||
    event.toState !== result.state ||
    event.revision !== result.revision ||
    event.checkpointId !== result.checkpointId ||
    event.externalCalls !== 0 ||
    event.networkCalls !== 0
  ) {
    invalidJoin("The callable event ID does not match authoritative lifecycle evidence.");
  }

  if (result.checkpointId === null) {
    if (result.action === "advance_batch" || immutable.checkpoint !== null) {
      invalidJoin("Batch advancement returned no checkpoint evidence.");
    }
  } else {
    const checkpoint = immutable.checkpoint;
    if (
      result.action !== "advance_batch" ||
      !checkpoint ||
      checkpoint.id !== result.checkpointId ||
      checkpoint.workspaceId !== session.workspaceId ||
      checkpoint.campaignId !== campaign.id ||
      checkpoint.eventId !== result.eventId ||
      checkpoint.eligibleCount !== result.batchEligibleCount ||
      checkpoint.processedEligible !== result.processedEligible ||
      checkpoint.sourceOffsetEnd !== result.scanOffset ||
      (exactCurrentRevision && campaign.lastCheckpointId !== checkpoint.id) ||
      checkpoint.externalCalls !== 0 ||
      checkpoint.networkCalls !== 0
    ) {
      invalidJoin("The callable checkpoint ID does not match authoritative batch evidence.");
    }
  }

  if (
    audit.id !== response.auditEventId ||
    audit.workspaceId !== session.workspaceId ||
    audit.actorUid !== session.uid ||
    audit.action !== `campaign.${result.action}` ||
    audit.resourceId !== campaign.id ||
    audit.metadata.campaignAction !== result.action ||
    audit.metadata.fromState !== previous.campaign.state ||
    audit.metadata.toState !== result.state ||
    audit.metadata.revision !== result.revision ||
    audit.metadata.checkpointId !== result.checkpointId ||
    audit.metadata.batchEligibleCount !== result.batchEligibleCount ||
    audit.metadata.processedEligible !== result.processedEligible ||
    audit.metadata.scanOffset !== result.scanOffset ||
    audit.metadata.externalCalls !== 0 ||
    audit.metadata.networkCalls !== 0
  ) {
    invalidJoin("The callable audit ID does not match authoritative action evidence.");
  }
  if (
    event.createdAt !== audit.occurredAt ||
    event.createdAt !== audit.createdAt ||
    (immutable.checkpoint !== null &&
      immutable.checkpoint.createdAt !== event.createdAt) ||
    (exactCurrentRevision && campaign.updatedAt !== event.createdAt)
  ) {
    invalidJoin("Campaign action timestamps do not bind the event, checkpoint, audit, and current revision.");
  }
}

export async function loadCampaignWorkspace(
  db: Firestore,
  session: VerifiedWorkspaceSession,
  reads: CampaignWorkspaceReads = defaultReads,
): Promise<CampaignWorkspaceResult> {
  assertSyntheticSession(session);
  try {
    const campaigns = await reads.listCampaigns(db, {
      workspaceId: session.workspaceId,
      pageSize: CAMPAIGN_PAGE_SIZE,
    });
    if (new Set(campaigns.map((campaign) => campaign.id)).size !== campaigns.length) {
      invalidJoin("The campaign list contained duplicate document identities.");
    }
    if (campaigns.length === 0) return { campaigns: [], selected: null };

    const campaign = campaigns.find((candidate) => candidate.id === SYNTHETIC_CAMPAIGN_ID);
    if (!campaign) {
      invalidJoin("The fixed governed synthetic campaign is missing from the bounded list.");
    }
    assertSafeCampaignReadPlan(campaign, session.workspaceId);
    const subjectInput = {
      workspaceId: session.workspaceId,
      campaignId: campaign.id,
      pageSize: CAMPAIGN_PAGE_SIZE,
    } as const;
    const [bundle, templates, events, checkpoints] = await Promise.all([
      reads.getBundle(db, {
        workspaceId: session.workspaceId,
        campaignId: campaign.id,
      }),
      Promise.all(
        (["en", "si", "ta"] as const).map((language) =>
          reads.getTemplate(db, {
            workspaceId: session.workspaceId,
            templateId: SYNTHETIC_TEMPLATE_IDS[language],
          }),
        ),
      ),
      reads.listEvents(db, subjectInput),
      reads.listCheckpoints(db, subjectInput),
    ]);
    if (
      campaign.revision !== bundle.campaign.revision ||
      campaign.updatedAt !== bundle.campaign.updatedAt
    ) {
      invalidJoin("The campaign changed between its list and authoritative detail reads.");
    }
    const latestCheckpoint = [...checkpoints].sort(
      (left, right) => right.batchIndex - left.batchIndex,
    )[0];
    const latestCheckpointEvent =
      latestCheckpoint &&
      !events.some((event) => event.id === latestCheckpoint.eventId)
        ? await reads.getEvent(db, {
            workspaceId: session.workspaceId,
            campaignId: campaign.id,
            eventId: latestCheckpoint.eventId,
          })
        : null;
    return {
      campaigns,
      selected: await assembleCampaignWorkspaceRecord({
        session,
        bundle,
        templates,
        events,
        checkpoints,
        latestCheckpointEvent,
      }),
    };
  } catch (error) {
    if (error instanceof CampaignWorkspaceDataError) throw error;
    const sourceCode =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    throw new CampaignWorkspaceDataError(
      "The tenant-scoped campaign workspace could not be loaded.",
      "load_failed",
      sourceCode,
    );
  }
}

export function describeCampaignWorkspaceError(error: unknown): string {
  const sourceCode =
    error instanceof CampaignWorkspaceDataError
      ? error.sourceCode
      : typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
  if (
    error instanceof CampaignWorkspaceDataError &&
    error.code === "access_denied"
  ) {
    return "This verified role cannot read campaign governance metadata.";
  }
  if (sourceCode.includes("permission-denied")) {
    return "Campaign access was denied by the verified workspace role or tenant boundary.";
  }
  if (sourceCode.includes("failed-precondition")) {
    return "The local Firestore indexes are not ready for the bounded campaign queries.";
  }
  if (
    error instanceof CampaignWorkspaceDataError &&
    error.code === "invalid_join"
  ) {
    return "Persisted campaign evidence failed tenant, approval, template, or checkpoint validation, so the view stayed closed.";
  }
  return `${DATA_SOURCE.charAt(0).toUpperCase()}${DATA_SOURCE.slice(1)} could not load persisted campaign evidence. No fixture fallback was attempted.`;
}
