import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type Firestore,
  type Timestamp,
} from "firebase/firestore";
import { z } from "zod";

export const GOVERNED_CAMPAIGN_STATES = [
  "draft",
  "audience_building",
  "compliance_review",
  "approval_pending",
  "scheduled",
  "dispatching",
  "paused",
  "completed",
  "cancelled",
  "failed",
] as const;

export const GOVERNED_CAMPAIGN_ACTIONS = [
  "run_canary",
  "start",
  "advance_batch",
  "pause",
  "resume",
  "inject_fault",
  "retry",
  "cancel",
] as const;

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Identifier contains unsupported characters");
const boundedText = (maximum: number) => z.string().min(1).max(maximum);
const sha256Digest = z.string().regex(/^[0-9a-f]{64}$/);
const localTime = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
const timestampValue = z.custom<Timestamp>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof value.toDate === "function",
  "Expected a Firestore Timestamp",
);

const campaignState = z.enum(GOVERNED_CAMPAIGN_STATES);
const campaignAction = z.enum(GOVERNED_CAMPAIGN_ACTIONS);
const canaryStatus = z.enum(["not_run", "passed_simulation", "failed"]);

const templateVersionIdsSchema = z
  .object({ en: identifier, si: identifier, ta: identifier })
  .strict()
  .superRefine((value, context) => {
    const entries = Object.entries(value) as Array<["en" | "si" | "ta", string]>;
    if (new Set(entries.map(([, id]) => id)).size !== entries.length) {
      context.addIssue({ code: "custom", message: "Template version IDs must be distinct." });
    }
    for (const [language, id] of entries) {
      if (!new RegExp(`^template_[a-z][a-z0-9_]*_${language}_v[1-9][0-9]*$`).test(id)) {
        context.addIssue({
          code: "custom",
          path: [language],
          message: "Template version ID does not match its language.",
        });
      }
    }
  });

const campaignScheduleSchema = z
  .object({
    startsAt: timestampValue,
    timeZone: z.literal("Asia/Colombo"),
    quietHours: z
      .object({ startsAtLocal: localTime, endsAtLocal: localTime })
      .strict(),
  })
  .strict();

const campaignApprovalSchema = z
  .object({
    required: z.literal(true),
    status: z.literal("approved"),
    scope: z.literal("simulation_only"),
    approverId: identifier,
    reviewedAt: timestampValue,
    approvedContentHash: sha256Digest,
  })
  .strict();

const campaignDocumentSchema = z
  .object({
    id: identifier,
    workspaceId: identifier,
    name: boundedText(160),
    purpose: z.enum(["health_campaigns", "event_campaigns"]),
    messageCategory: z.literal("marketing"),
    targetAction: boundedText(240),
    ownerId: identifier,
    templateVersionIds: templateVersionIdsSchema,
    audienceSnapshotId: identifier,
    state: campaignState,
    dispatchMode: z.literal("simulation"),
    schedule: campaignScheduleSchema,
    approval: campaignApprovalSchema,
    revision: z.number().int().min(0).max(1_000_000_000),
    canaryStatus,
    processedEligible: z.number().int().min(0).max(50_000),
    scanOffset: z.number().int().min(0).max(50_000),
    nextBatchIndex: z.number().int().min(0).max(50),
    batchSize: z.literal(1_000),
    lastCheckpointId: identifier.nullable(),
    externalCalls: z.literal(0),
    networkCalls: z.literal(0),
    synthetic: z.literal(true),
    schemaVersion: z.literal(1),
    createdAt: timestampValue,
    updatedAt: timestampValue,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.ownerId === value.approval.approverId) {
      context.addIssue({
        code: "custom",
        path: ["approval", "approverId"],
        message: "Campaign owner and approver must be distinct.",
      });
    }
    if (value.processedEligible > value.scanOffset) {
      context.addIssue({
        code: "custom",
        path: ["processedEligible"],
        message: "Processed eligible count cannot exceed the raw scan offset.",
      });
    }
    if (value.lastCheckpointId === null) {
      if (
        value.processedEligible !== 0 ||
        value.scanOffset !== 0 ||
        value.nextBatchIndex !== 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["lastCheckpointId"],
          message: "Progress without a checkpoint is invalid.",
        });
      }
    } else {
      const expectedCheckpointId = `${value.id}:checkpoint:${String(value.nextBatchIndex - 1).padStart(6, "0")}`;
      if (
        value.lastCheckpointId !== expectedCheckpointId ||
        value.scanOffset === 0 ||
        value.nextBatchIndex === 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["lastCheckpointId"],
          message: "Checkpoint identity and progress are inconsistent.",
        });
      }
    }
    if (value.nextBatchIndex !== Math.ceil(value.processedEligible / value.batchSize)) {
      context.addIssue({
        code: "custom",
        path: ["nextBatchIndex"],
        message: "Next batch index does not match cumulative eligible progress.",
      });
    }
    if (value.state === "scheduled" && value.lastCheckpointId !== null) {
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "A scheduled campaign cannot already carry batch progress.",
      });
    }
    if (value.state === "completed" && value.lastCheckpointId === null) {
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "A completed campaign requires a final checkpoint.",
      });
    }
  });

const exclusionCountsSchema = z
  .object({
    frequency_cap: z.number().int().min(0).max(50_000),
    consent_missing: z.number().int().min(0).max(50_000),
    suppressed: z.number().int().min(0).max(50_000),
    duplicate: z.number().int().min(0).max(50_000),
    invalid_contact: z.number().int().min(0).max(50_000),
    language_unavailable: z.number().int().min(0).max(50_000),
  })
  .strict();

const languageCountsSchema = z
  .object({
    en: z.number().int().min(0).max(50_000),
    si: z.number().int().min(0).max(50_000),
    ta: z.number().int().min(0).max(50_000),
  })
  .strict();

const audienceSnapshotDocumentSchema = z
  .object({
    id: identifier,
    workspaceId: identifier,
    campaignId: identifier,
    criteriaSummary: boundedText(500),
    totalEvaluated: z.number().int().min(1).max(50_000),
    eligibleCount: z.number().int().min(0).max(50_000),
    excludedCount: z.number().int().min(0).max(50_000),
    unknownConsentCount: z.number().int().min(0).max(50_000),
    exclusionsByReason: exclusionCountsSchema,
    languageCounts: languageCountsSchema,
    contentHash: sha256Digest,
    immutable: z.literal(true),
    synthetic: z.literal(true),
    schemaVersion: z.literal(1),
    finalizedAt: timestampValue,
    createdAt: timestampValue,
    updatedAt: timestampValue,
  })
  .strict()
  .superRefine((value, context) => {
    const exclusionTotal = Object.values(value.exclusionsByReason).reduce(
      (total, count) => total + count,
      0,
    );
    const languageTotal = Object.values(value.languageCounts).reduce(
      (total, count) => total + count,
      0,
    );
    if (value.eligibleCount + value.excludedCount !== value.totalEvaluated) {
      context.addIssue({ code: "custom", message: "Audience totals do not reconcile." });
    }
    if (exclusionTotal !== value.excludedCount) {
      context.addIssue({ code: "custom", message: "Exclusion counts do not reconcile." });
    }
    if (languageTotal !== value.totalEvaluated) {
      context.addIssue({ code: "custom", message: "Language counts do not reconcile." });
    }
    if (value.unknownConsentCount !== value.exclusionsByReason.consent_missing) {
      context.addIssue({
        code: "custom",
        message: "Unknown consent must equal the consent-missing exclusion count.",
      });
    }
  });

const campaignEventDocumentSchema = z
  .object({
    id: identifier,
    workspaceId: identifier,
    campaignId: identifier,
    actorUid: identifier,
    action: campaignAction,
    fromState: campaignState,
    toState: campaignState,
    revision: z.number().int().min(1).max(1_000_000_000),
    checkpointId: identifier.nullable(),
    externalCalls: z.literal(0),
    networkCalls: z.literal(0),
    synthetic: z.literal(true),
    schemaVersion: z.literal(1),
    createdAt: timestampValue,
  })
  .strict()
  .superRefine((value, context) => {
    const transitionAllowed =
      (value.action === "run_canary" &&
        value.fromState === "scheduled" &&
        value.toState === "scheduled") ||
      (value.action === "start" &&
        value.fromState === "scheduled" &&
        value.toState === "dispatching") ||
      (value.action === "advance_batch" &&
        value.fromState === "dispatching" &&
        (value.toState === "dispatching" || value.toState === "completed")) ||
      (value.action === "pause" &&
        value.fromState === "dispatching" &&
        value.toState === "paused") ||
      (value.action === "resume" &&
        value.fromState === "paused" &&
        value.toState === "dispatching") ||
      (value.action === "inject_fault" &&
        value.fromState === "dispatching" &&
        value.toState === "failed") ||
      (value.action === "retry" &&
        value.fromState === "failed" &&
        value.toState === "dispatching") ||
      (value.action === "cancel" &&
        ["scheduled", "dispatching", "paused", "failed"].includes(value.fromState) &&
        value.toState === "cancelled");

    if (!transitionAllowed) {
      context.addIssue({ code: "custom", message: "Campaign event transition is invalid." });
    }
    if (value.action === "advance_batch") {
      const expectedPrefix = `${value.campaignId}:checkpoint:`;
      const checkpointSuffix = value.checkpointId?.slice(expectedPrefix.length);
      if (
        value.checkpointId === null ||
        !value.checkpointId.startsWith(expectedPrefix) ||
        checkpointSuffix?.length !== 6 ||
        !/^[0-9]{6}$/.test(checkpointSuffix)
      ) {
        context.addIssue({
          code: "custom",
          path: ["checkpointId"],
          message: "Batch advancement requires its campaign-bound checkpoint.",
        });
      }
    } else if (value.checkpointId !== null) {
      context.addIssue({
        code: "custom",
        path: ["checkpointId"],
        message: "Only batch advancement can bind a checkpoint.",
      });
    }
  });

const campaignCheckpointDocumentSchema = z
  .object({
    id: identifier,
    workspaceId: identifier,
    campaignId: identifier,
    eventId: identifier,
    batchIndex: z.number().int().min(0).max(49),
    sourceOffsetStart: z.number().int().min(0).max(49_999),
    sourceOffsetEnd: z.number().int().min(1).max(50_000),
    eligibleCount: z.number().int().min(1).max(1_000),
    languageCounts: languageCountsSchema,
    processedEligible: z.number().int().min(1).max(50_000),
    scanComplete: z.boolean(),
    digest: sha256Digest,
    externalCalls: z.literal(0),
    networkCalls: z.literal(0),
    synthetic: z.literal(true),
    schemaVersion: z.literal(1),
    createdAt: timestampValue,
  })
  .strict()
  .superRefine((value, context) => {
    const expectedId = `${value.campaignId}:checkpoint:${String(value.batchIndex).padStart(6, "0")}`;
    const batchLanguageTotal = Object.values(value.languageCounts).reduce(
      (total, count) => total + count,
      0,
    );
    if (value.id !== expectedId) {
      context.addIssue({ code: "custom", path: ["id"], message: "Checkpoint ID is invalid." });
    }
    if (value.sourceOffsetEnd <= value.sourceOffsetStart) {
      context.addIssue({ code: "custom", message: "Checkpoint offsets must be half-open." });
    }
    if (value.batchIndex === 0 && value.sourceOffsetStart !== 0) {
      context.addIssue({ code: "custom", message: "The first checkpoint must begin at zero." });
    }
    if (batchLanguageTotal !== value.eligibleCount) {
      context.addIssue({ code: "custom", message: "Batch language counts do not reconcile." });
    }
    if (value.processedEligible > value.sourceOffsetEnd) {
      context.addIssue({ code: "custom", message: "Processed count exceeds scanned records." });
    }
    if (value.scanComplete !== (value.sourceOffsetEnd === 50_000)) {
      context.addIssue({ code: "custom", message: "Final scan state and offset disagree." });
    }
    if (!value.scanComplete && value.eligibleCount !== 1_000) {
      context.addIssue({ code: "custom", message: "A non-final batch must contain 1,000 eligible records." });
    }
    const lowerProcessedBound = value.batchIndex * 1_000;
    const upperProcessedBound = (value.batchIndex + 1) * 1_000;
    if (
      value.processedEligible <= lowerProcessedBound ||
      value.processedEligible > upperProcessedBound ||
      (!value.scanComplete && value.processedEligible !== upperProcessedBound)
    ) {
      context.addIssue({ code: "custom", message: "Cumulative batch progress is invalid." });
    }
  });

const workspaceListInputSchema = z
  .object({
    workspaceId: identifier,
    pageSize: z.number().int().min(1).max(100).optional(),
  })
  .strict();

const campaignSubjectListInputSchema = z
  .object({
    workspaceId: identifier,
    campaignId: identifier,
    pageSize: z.number().int().min(1).max(100).optional(),
  })
  .strict();

const campaignGetInputSchema = z
  .object({ workspaceId: identifier, campaignId: identifier })
  .strict();
const snapshotGetInputSchema = z
  .object({ workspaceId: identifier, snapshotId: identifier, campaignId: identifier.optional() })
  .strict();
const campaignEventGetInputSchema = z
  .object({ workspaceId: identifier, campaignId: identifier, eventId: identifier })
  .strict();

type CampaignDocument = z.infer<typeof campaignDocumentSchema>;
type AudienceSnapshotDocument = z.infer<typeof audienceSnapshotDocumentSchema>;
type CampaignEventDocument = z.infer<typeof campaignEventDocumentSchema>;
type CampaignCheckpointDocument = z.infer<typeof campaignCheckpointDocumentSchema>;

export type CampaignState = z.infer<typeof campaignState>;
export type CampaignAction = z.infer<typeof campaignAction>;
export type CampaignListInput = z.infer<typeof workspaceListInputSchema>;
export type CampaignSubjectListInput = z.infer<typeof campaignSubjectListInputSchema>;
export type CampaignEventGetInput = z.infer<typeof campaignEventGetInputSchema>;

export type CampaignDTO = Omit<
  CampaignDocument,
  "schedule" | "approval" | "createdAt" | "updatedAt"
> & {
  readonly schedule: Omit<CampaignDocument["schedule"], "startsAt"> & {
    readonly startsAt: string;
  };
  readonly approval: Omit<CampaignDocument["approval"], "reviewedAt"> & {
    readonly reviewedAt: string;
  };
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type AudienceSnapshotDTO = Omit<
  AudienceSnapshotDocument,
  "finalizedAt" | "createdAt" | "updatedAt"
> & {
  readonly finalizedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type CampaignEventDTO = Omit<CampaignEventDocument, "createdAt"> & {
  readonly createdAt: string;
};

export type CampaignCheckpointDTO = Omit<CampaignCheckpointDocument, "createdAt"> & {
  readonly createdAt: string;
};

export interface GovernedCampaignBundleDTO {
  readonly campaign: CampaignDTO;
  readonly audienceSnapshot: AudienceSnapshotDTO;
}

export interface CampaignApprovalBindingInput {
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly audienceSnapshotId: string;
  readonly snapshotContentHash: string;
  readonly templateVersionIds: Readonly<{ en: string; si: string; ta: string }>;
  readonly templateContentHashes: Readonly<{ en: string; si: string; ta: string }>;
  readonly purpose: "health_campaigns" | "event_campaigns";
  readonly messageCategory: "marketing";
  readonly targetAction: string;
  readonly schedule: Readonly<{
    startsAtIso: string;
    timeZone: "Asia/Colombo";
    quietHours: Readonly<{ startsAtLocal: string; endsAtLocal: string }>;
  }>;
}

export class CampaignRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_input" | "invalid_persisted_data" | "not_found",
  ) {
    super(message);
    this.name = "CampaignRepositoryError";
  }
}

export function serializeCampaignApprovalBinding(
  input: CampaignApprovalBindingInput,
): string {
  return JSON.stringify([
    "hemas-connect:campaign-approval:v2",
    input.workspaceId,
    input.campaignId,
    input.audienceSnapshotId,
    input.snapshotContentHash,
    input.templateVersionIds.en,
    input.templateContentHashes.en,
    input.templateVersionIds.si,
    input.templateContentHashes.si,
    input.templateVersionIds.ta,
    input.templateContentHashes.ta,
    input.purpose,
    input.messageCategory,
    input.targetAction,
    input.schedule.startsAtIso,
    input.schedule.timeZone,
    input.schedule.quietHours.startsAtLocal,
    input.schedule.quietHours.endsAtLocal,
  ]);
}

function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new CampaignRepositoryError("Campaign input failed validation.", "invalid_input");
  }
  return result.data;
}

function parsePersisted<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new CampaignRepositoryError(
      `${label} failed persisted schema validation.`,
      "invalid_persisted_data",
    );
  }
  return result.data;
}

function assertIdentity(
  value: { readonly id: string; readonly workspaceId: string; readonly campaignId?: string },
  documentId: string,
  workspaceId: string,
  expectedCampaignId: string | undefined,
  label: string,
): void {
  if (
    value.id !== documentId ||
    value.workspaceId !== workspaceId ||
    (expectedCampaignId !== undefined && value.campaignId !== expectedCampaignId)
  ) {
    throw new CampaignRepositoryError(
      `${label} identity does not match its tenant/path join.`,
      "invalid_persisted_data",
    );
  }
}

export function prepareCampaignListInput(value: CampaignListInput): CampaignListInput {
  return parseInput(workspaceListInputSchema, value);
}

export function prepareCampaignSubjectListInput(
  value: CampaignSubjectListInput,
): CampaignSubjectListInput {
  return parseInput(campaignSubjectListInputSchema, value);
}

export function prepareCampaignEventGetInput(
  value: CampaignEventGetInput,
): CampaignEventGetInput {
  return parseInput(campaignEventGetInputSchema, value);
}

export function parseCampaignDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): CampaignDTO {
  const parsed = parsePersisted(campaignDocumentSchema, value, "Campaign");
  assertIdentity(parsed, documentId, workspaceId, undefined, "Campaign");
  return {
    ...parsed,
    schedule: {
      ...parsed.schedule,
      startsAt: parsed.schedule.startsAt.toDate().toISOString(),
    },
    approval: {
      ...parsed.approval,
      reviewedAt: parsed.approval.reviewedAt.toDate().toISOString(),
    },
    createdAt: parsed.createdAt.toDate().toISOString(),
    updatedAt: parsed.updatedAt.toDate().toISOString(),
  };
}

export function parseAudienceSnapshotDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
  expectedCampaignId?: string,
): AudienceSnapshotDTO {
  const parsed = parsePersisted(
    audienceSnapshotDocumentSchema,
    value,
    "Audience snapshot",
  );
  assertIdentity(parsed, documentId, workspaceId, expectedCampaignId, "Audience snapshot");
  return {
    ...parsed,
    finalizedAt: parsed.finalizedAt.toDate().toISOString(),
    createdAt: parsed.createdAt.toDate().toISOString(),
    updatedAt: parsed.updatedAt.toDate().toISOString(),
  };
}

export function parseCampaignEventDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
  expectedCampaignId?: string,
): CampaignEventDTO {
  const parsed = parsePersisted(campaignEventDocumentSchema, value, "Campaign event");
  assertIdentity(parsed, documentId, workspaceId, expectedCampaignId, "Campaign event");
  return { ...parsed, createdAt: parsed.createdAt.toDate().toISOString() };
}

export function parseCampaignCheckpointDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
  expectedCampaignId?: string,
): CampaignCheckpointDTO {
  const parsed = parsePersisted(
    campaignCheckpointDocumentSchema,
    value,
    "Campaign checkpoint",
  );
  assertIdentity(parsed, documentId, workspaceId, expectedCampaignId, "Campaign checkpoint");
  return { ...parsed, createdAt: parsed.createdAt.toDate().toISOString() };
}

export function assertCampaignAudienceJoin(
  campaign: CampaignDTO,
  snapshot: AudienceSnapshotDTO,
): void {
  if (
    campaign.workspaceId !== snapshot.workspaceId ||
    campaign.id !== snapshot.campaignId ||
    campaign.audienceSnapshotId !== snapshot.id ||
    campaign.processedEligible > snapshot.eligibleCount ||
    campaign.scanOffset > snapshot.totalEvaluated
  ) {
    throw new CampaignRepositoryError(
      "Campaign and audience snapshot failed identity or progress reconciliation.",
      "invalid_persisted_data",
    );
  }
  if (
    campaign.state === "completed" &&
    (campaign.processedEligible !== snapshot.eligibleCount ||
      campaign.scanOffset !== snapshot.totalEvaluated)
  ) {
    throw new CampaignRepositoryError(
      "Completed campaign progress does not reconcile with its immutable audience.",
      "invalid_persisted_data",
    );
  }
}

export async function listCampaigns(
  db: Firestore,
  rawInput: CampaignListInput,
): Promise<readonly CampaignDTO[]> {
  const input = prepareCampaignListInput(rawInput);
  const snapshot = await getDocs(
    query(
      collection(db, "workspaces", input.workspaceId, "campaigns"),
      orderBy("updatedAt", "desc"),
      limit(input.pageSize ?? 50),
    ),
  );
  return snapshot.docs.map((record) =>
    parseCampaignDocument(record.data(), record.id, input.workspaceId),
  );
}

export async function listAudienceSnapshots(
  db: Firestore,
  rawInput: CampaignSubjectListInput,
): Promise<readonly AudienceSnapshotDTO[]> {
  const input = prepareCampaignSubjectListInput(rawInput);
  const snapshot = await getDocs(
    query(
      collection(db, "workspaces", input.workspaceId, "audienceSnapshots"),
      where("campaignId", "==", input.campaignId),
      orderBy("finalizedAt", "desc"),
      limit(input.pageSize ?? 50),
    ),
  );
  return snapshot.docs.map((record) =>
    parseAudienceSnapshotDocument(
      record.data(),
      record.id,
      input.workspaceId,
      input.campaignId,
    ),
  );
}

export async function listCampaignEvents(
  db: Firestore,
  rawInput: CampaignSubjectListInput,
): Promise<readonly CampaignEventDTO[]> {
  const input = prepareCampaignSubjectListInput(rawInput);
  const snapshot = await getDocs(
    query(
      collection(db, "workspaces", input.workspaceId, "campaignEvents"),
      where("campaignId", "==", input.campaignId),
      orderBy("revision", "desc"),
      limit(input.pageSize ?? 50),
    ),
  );
  return snapshot.docs.map((record) =>
    parseCampaignEventDocument(record.data(), record.id, input.workspaceId, input.campaignId),
  );
}

export async function listCampaignCheckpoints(
  db: Firestore,
  rawInput: CampaignSubjectListInput,
): Promise<readonly CampaignCheckpointDTO[]> {
  const input = prepareCampaignSubjectListInput(rawInput);
  const snapshot = await getDocs(
    query(
      collection(db, "workspaces", input.workspaceId, "campaignCheckpoints"),
      where("campaignId", "==", input.campaignId),
      orderBy("batchIndex", "desc"),
      limit(input.pageSize ?? 50),
    ),
  );
  return snapshot.docs.map((record) =>
    parseCampaignCheckpointDocument(
      record.data(),
      record.id,
      input.workspaceId,
      input.campaignId,
    ),
  );
}

export async function getCampaign(
  db: Firestore,
  rawInput: { readonly workspaceId: string; readonly campaignId: string },
): Promise<CampaignDTO> {
  const input = parseInput(campaignGetInputSchema, rawInput);
  const snapshot = await getDoc(
    doc(db, "workspaces", input.workspaceId, "campaigns", input.campaignId),
  );
  if (!snapshot.exists()) {
    throw new CampaignRepositoryError("Campaign was not found.", "not_found");
  }
  return parseCampaignDocument(snapshot.data(), snapshot.id, input.workspaceId);
}

export async function getCampaignEvent(
  db: Firestore,
  rawInput: CampaignEventGetInput,
): Promise<CampaignEventDTO> {
  const input = prepareCampaignEventGetInput(rawInput);
  const snapshot = await getDoc(
    doc(db, "workspaces", input.workspaceId, "campaignEvents", input.eventId),
  );
  if (!snapshot.exists()) {
    throw new CampaignRepositoryError("Campaign event was not found.", "not_found");
  }
  return parseCampaignEventDocument(
    snapshot.data(),
    snapshot.id,
    input.workspaceId,
    input.campaignId,
  );
}

export async function getAudienceSnapshot(
  db: Firestore,
  rawInput: {
    readonly workspaceId: string;
    readonly snapshotId: string;
    readonly campaignId?: string;
  },
): Promise<AudienceSnapshotDTO> {
  const input = parseInput(snapshotGetInputSchema, rawInput);
  const snapshot = await getDoc(
    doc(db, "workspaces", input.workspaceId, "audienceSnapshots", input.snapshotId),
  );
  if (!snapshot.exists()) {
    throw new CampaignRepositoryError("Audience snapshot was not found.", "not_found");
  }
  return parseAudienceSnapshotDocument(
    snapshot.data(),
    snapshot.id,
    input.workspaceId,
    input.campaignId,
  );
}

export async function getGovernedCampaignBundle(
  db: Firestore,
  rawInput: { readonly workspaceId: string; readonly campaignId: string },
): Promise<GovernedCampaignBundleDTO> {
  const input = parseInput(campaignGetInputSchema, rawInput);
  const campaign = await getCampaign(db, input);
  const audienceSnapshot = await getAudienceSnapshot(db, {
    workspaceId: input.workspaceId,
    snapshotId: campaign.audienceSnapshotId,
    campaignId: campaign.id,
  });
  assertCampaignAudienceJoin(campaign, audienceSnapshot);
  return { campaign, audienceSnapshot };
}
