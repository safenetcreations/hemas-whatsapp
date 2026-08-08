import type { DocumentData } from "firebase-admin/firestore";
import type { RuntimeConfig } from "../config.js";
import { sha256Hex } from "../deterministic.js";
import { FailClosedError, assertSafeTenantId } from "../errors.js";
import type { MutationResult } from "../service-kernel.js";
import {
  MAX_SYNTHETIC_ELIGIBLE_BATCH,
  SYNTHETIC_AUDIENCE_COUNTS,
  SYNTHETIC_CAMPAIGN_TOTAL,
  countSyntheticEligibleBefore,
} from "./audience.js";

export const SYNTHETIC_CAMPAIGN_ID = "campaign_synthetic_50k";
export const SYNTHETIC_AUDIENCE_SNAPSHOT_ID = "audience_synthetic_50k_v1";
export const SYNTHETIC_AUDIENCE_CONTENT_HASH =
  "7a4d8ce2bc1bafc224e5e2b91a2fc3f8b20b5f062ff1563ca4cf25847ad0d550";
export const SYNTHETIC_CAMPAIGN_OWNER_UID = "user_demo_campaign_operator";
export const SYNTHETIC_CAMPAIGN_APPROVER_UID = "user_demo_campaign_approver";
export const TEMPLATE_CONTENT_BINDING_VERSION = "hemas-connect:template-content:v1";
export const CAMPAIGN_APPROVAL_BINDING_VERSION = "hemas-connect:campaign-approval:v2";

export const SYNTHETIC_CAMPAIGN_TEMPLATE_IDS = Object.freeze({
  en: "template_wellness_awareness_en_v3",
  si: "template_wellness_awareness_si_v3",
  ta: "template_wellness_awareness_ta_v3",
});
export const SYNTHETIC_CAMPAIGN_TEMPLATE_CONTENT_HASHES = Object.freeze({
  en: "0cbf38327d7d48ee61558927c6afb8e4e75c1781561906ebbab4def379e6c04f",
  si: "cefbdf676d18b06dfcc4263e659c0585db48de7e7843b57b32566d2215536582",
  ta: "c477a31ee0344bef6c66a25a0a70848f6a0a75262f0df328dd8b04e6479a2b12",
});

export const SYNTHETIC_CAMPAIGN_CONTROL_ACTIONS = [
  "run_canary",
  "start",
  "advance_batch",
  "pause",
  "resume",
  "inject_fault",
  "retry",
  "cancel",
] as const;

export const SYNTHETIC_CAMPAIGN_STATES = [
  "scheduled",
  "dispatching",
  "paused",
  "completed",
  "cancelled",
  "failed",
] as const;

export type SyntheticCampaignControlAction =
  (typeof SYNTHETIC_CAMPAIGN_CONTROL_ACTIONS)[number];
export type SyntheticCampaignState = (typeof SYNTHETIC_CAMPAIGN_STATES)[number];
export type SyntheticCampaignCanaryStatus =
  | "not_run"
  | "passed_simulation"
  | "failed";
export type SyntheticCampaignLanguage = "en" | "si" | "ta";

export interface SyntheticCampaignControlInput {
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly action: SyntheticCampaignControlAction;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
}

export interface SyntheticCampaignControlResult extends MutationResult {
  readonly campaignId: string;
  readonly eventId: string;
  readonly checkpointId: string | null;
  readonly action: SyntheticCampaignControlAction;
  readonly state: SyntheticCampaignState;
  readonly revision: number;
  readonly canaryStatus: SyntheticCampaignCanaryStatus;
  readonly processedEligible: number;
  readonly scanOffset: number;
  readonly nextBatchIndex: number;
  readonly batchEligibleCount: number;
  readonly synthetic: true;
  readonly externalCalls: 0;
  readonly networkCalls: 0;
}

export interface ParsedSyntheticCampaign {
  readonly id: string;
  readonly workspaceId: string;
  readonly ownerId: string;
  readonly purpose: "health_campaigns";
  readonly messageCategory: "marketing";
  readonly targetAction: string;
  readonly templateVersionIds: Readonly<Record<SyntheticCampaignLanguage, string>>;
  readonly audienceSnapshotId: string;
  readonly state: SyntheticCampaignState;
  readonly dispatchMode: "simulation";
  readonly schedule: {
    readonly startsAt: Date;
    readonly timeZone: "Asia/Colombo";
    readonly quietHours: {
      readonly startsAtLocal: string;
      readonly endsAtLocal: string;
    };
  };
  readonly approval: {
    readonly required: true;
    readonly status: "approved";
    readonly scope: "simulation_only";
    readonly approverId: string;
    readonly approvedContentHash: string;
  };
  readonly revision: number;
  readonly canaryStatus: SyntheticCampaignCanaryStatus;
  readonly processedEligible: number;
  readonly scanOffset: number;
  readonly nextBatchIndex: number;
  readonly batchSize: 1_000;
  readonly lastCheckpointId: string | null;
  readonly externalCalls: 0;
  readonly networkCalls: 0;
  readonly synthetic: true;
}

export interface ParsedSyntheticAudienceSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly contentHash: string;
  readonly immutable: true;
  readonly synthetic: true;
}

export type SyntheticTemplateButton = Readonly<{
  type: "quick_reply" | "url" | "flow";
  label: string;
  targetRef: string;
}>;

export type SyntheticTemplateComponent =
  | Readonly<{ kind: "header"; format: "text"; text: string }>
  | Readonly<{ kind: "body"; text: string }>
  | Readonly<{ kind: "footer"; text: string }>
  | Readonly<{ kind: "buttons"; buttons: readonly SyntheticTemplateButton[] }>;

export type SyntheticTemplateVariableRule = Readonly<{
  key: string;
  description: string;
  required: boolean;
  maxLength: number;
  exampleValue: string;
  allowedPattern: string | null;
}>;

export interface TemplateContentBindingInput {
  readonly workspaceId: string;
  readonly id: string;
  readonly assetKey: string;
  readonly providerName: string;
  readonly category: "utility" | "marketing" | "authentication";
  readonly language: SyntheticCampaignLanguage;
  readonly version: number;
  readonly components: readonly SyntheticTemplateComponent[];
  readonly variableRules: readonly SyntheticTemplateVariableRule[];
}

export interface ParsedSyntheticCampaignTemplate {
  readonly id: string;
  readonly workspaceId: string;
  readonly language: SyntheticCampaignLanguage;
  readonly contentHash: string;
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const IDEMPOTENCY_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{15,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const CAMPAIGN_KEYS = Object.freeze([
  "approval",
  "audienceSnapshotId",
  "batchSize",
  "canaryStatus",
  "createdAt",
  "dispatchMode",
  "externalCalls",
  "id",
  "lastCheckpointId",
  "messageCategory",
  "name",
  "networkCalls",
  "nextBatchIndex",
  "ownerId",
  "processedEligible",
  "purpose",
  "revision",
  "scanOffset",
  "schedule",
  "schemaVersion",
  "state",
  "synthetic",
  "targetAction",
  "templateVersionIds",
  "updatedAt",
  "workspaceId",
]);
const SNAPSHOT_KEYS = Object.freeze([
  "campaignId",
  "contentHash",
  "createdAt",
  "criteriaSummary",
  "eligibleCount",
  "excludedCount",
  "exclusionsByReason",
  "finalizedAt",
  "id",
  "immutable",
  "languageCounts",
  "schemaVersion",
  "synthetic",
  "totalEvaluated",
  "unknownConsentCount",
  "updatedAt",
  "workspaceId",
]);
const TEMPLATE_KEYS = Object.freeze([
  "assetKey",
  "category",
  "components",
  "contentHash",
  "createdAt",
  "id",
  "immutable",
  "language",
  "localState",
  "ownership",
  "providerName",
  "providerState",
  "schemaVersion",
  "sortKey",
  "synthetic",
  "updatedAt",
  "variableRules",
  "version",
  "workspaceId",
]);
const RESULT_KEYS = Object.freeze([
  "action",
  "batchEligibleCount",
  "campaignId",
  "canaryStatus",
  "checkpointId",
  "eventId",
  "externalCalls",
  "networkCalls",
  "nextBatchIndex",
  "processedEligible",
  "revision",
  "scanOffset",
  "state",
  "synthetic",
]);

export function hasExactKeys(
  value: DocumentData,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function requireExactObject(value: unknown, keys: readonly string[]): DocumentData {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FailClosedError("invalid_service_request", "A request object is required.");
  }
  const data = value as DocumentData;
  if (!hasExactKeys(data, keys)) {
    throw new FailClosedError("invalid_service_request", "Request fields are invalid.");
  }
  return data;
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new FailClosedError("invalid_service_request", `${label} is invalid.`);
  }
  return value;
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export function timestampMillis(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (
    value &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof value.toMillis === "function"
  ) {
    try {
      const millis = value.toMillis();
      return typeof millis === "number" && Number.isFinite(millis) ? millis : null;
    } catch {
      return null;
    }
  }
  return null;
}

function timestampDate(value: unknown): Date | null {
  const millis = timestampMillis(value);
  return millis === null ? null : new Date(millis);
}

function isIntegerBetween(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

export function campaignCheckpointId(campaignId: string, batchIndex: number): string {
  requireId(campaignId, "Campaign ID");
  if (!Number.isInteger(batchIndex) || batchIndex < 0 || batchIndex > 999_999) {
    throw new FailClosedError("invalid_campaign_batch", "Campaign batch index is invalid.");
  }
  return `${campaignId}:checkpoint:${String(batchIndex).padStart(6, "0")}`;
}

export function parseSyntheticCampaignControlInput(
  value: unknown,
): SyntheticCampaignControlInput {
  const data = requireExactObject(value, [
    "workspaceId",
    "campaignId",
    "action",
    "expectedRevision",
    "idempotencyKey",
  ]);
  const workspaceId = requireId(data.workspaceId, "Workspace ID");
  assertSafeTenantId(workspaceId);
  const campaignId = requireId(data.campaignId, "Campaign ID");
  if (campaignId !== SYNTHETIC_CAMPAIGN_ID) {
    throw new FailClosedError(
      "invalid_service_request",
      "Only the fixed synthetic campaign can be controlled.",
    );
  }
  if (
    typeof data.action !== "string" ||
    !SYNTHETIC_CAMPAIGN_CONTROL_ACTIONS.includes(
      data.action as SyntheticCampaignControlAction,
    )
  ) {
    throw new FailClosedError("invalid_service_request", "Campaign action is invalid.");
  }
  if (!isIntegerBetween(data.expectedRevision, 0, 999_999_999)) {
    throw new FailClosedError(
      "invalid_service_request",
      "Expected campaign revision is invalid.",
    );
  }
  if (typeof data.idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(data.idempotencyKey)) {
    throw new FailClosedError("invalid_service_request", "Idempotency key is invalid.");
  }
  return {
    workspaceId,
    campaignId,
    action: data.action as SyntheticCampaignControlAction,
    expectedRevision: data.expectedRevision,
    idempotencyKey: data.idempotencyKey,
  };
}

export function assertSyntheticCampaignRuntimeBoundary(
  config: RuntimeConfig,
  workspaceId: string,
): void {
  assertSafeTenantId(workspaceId);
  if (
    config.runtimeMode !== "demo" ||
    config.providerMode !== "synthetic" ||
    config.hemasIntegrationMode !== "synthetic" ||
    config.auditSinkMode !== "durable" ||
    config.outboundEnabled ||
    !config.approvalGateRequired ||
    config.diagnosisEnabled ||
    config.defaultTenantId !== workspaceId
  ) {
    throw new FailClosedError(
      "campaign_service_disabled",
      "The synthetic campaign control service is disabled for this runtime.",
    );
  }
}

function parseSchedule(value: unknown): ParsedSyntheticCampaign["schedule"] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as DocumentData;
  if (!hasExactKeys(data, ["startsAt", "timeZone", "quietHours"])) return null;
  const startsAt = timestampDate(data.startsAt);
  const quietHours = data.quietHours;
  if (
    !startsAt ||
    data.timeZone !== "Asia/Colombo" ||
    !quietHours ||
    typeof quietHours !== "object" ||
    Array.isArray(quietHours) ||
    !hasExactKeys(quietHours as DocumentData, ["startsAtLocal", "endsAtLocal"])
  ) {
    return null;
  }
  const quiet = quietHours as DocumentData;
  if (
    typeof quiet.startsAtLocal !== "string" ||
    typeof quiet.endsAtLocal !== "string" ||
    !TIME.test(quiet.startsAtLocal) ||
    !TIME.test(quiet.endsAtLocal)
  ) {
    return null;
  }
  return {
    startsAt,
    timeZone: "Asia/Colombo",
    quietHours: {
      startsAtLocal: quiet.startsAtLocal,
      endsAtLocal: quiet.endsAtLocal,
    },
  };
}

function parseApproval(value: unknown): ParsedSyntheticCampaign["approval"] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as DocumentData;
  if (
    !hasExactKeys(data, [
      "required",
      "status",
      "scope",
      "approverId",
      "reviewedAt",
      "approvedContentHash",
    ]) ||
    data.required !== true ||
    data.status !== "approved" ||
    data.scope !== "simulation_only" ||
    data.approverId !== SYNTHETIC_CAMPAIGN_APPROVER_UID ||
    data.approverId === SYNTHETIC_CAMPAIGN_OWNER_UID ||
    timestampMillis(data.reviewedAt) === null ||
    typeof data.approvedContentHash !== "string" ||
    !SHA256.test(data.approvedContentHash)
  ) {
    return null;
  }
  return {
    required: true,
    status: "approved",
    scope: "simulation_only",
    approverId: data.approverId,
    approvedContentHash: data.approvedContentHash,
  };
}

export function parseStoredSyntheticCampaign(
  value: unknown,
  expected: { readonly workspaceId: string; readonly campaignId: string },
): ParsedSyntheticCampaign {
  const denied = (): never => {
    throw new FailClosedError(
      "campaign_denied",
      "A matching governed synthetic campaign is required.",
    );
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) denied();
  const data = value as DocumentData;
  const schedule = parseSchedule(data.schedule);
  const approval = parseApproval(data.approval);
  const templateVersionIds = data.templateVersionIds;
  const createdAt = timestampMillis(data.createdAt);
  const updatedAt = timestampMillis(data.updatedAt);
  if (
    !hasExactKeys(data, CAMPAIGN_KEYS) ||
    data.id !== expected.campaignId ||
    data.id !== SYNTHETIC_CAMPAIGN_ID ||
    data.workspaceId !== expected.workspaceId ||
    !isBoundedText(data.name, 160) ||
    data.purpose !== "health_campaigns" ||
    data.messageCategory !== "marketing" ||
    !isBoundedText(data.targetAction, 240) ||
    data.ownerId !== SYNTHETIC_CAMPAIGN_OWNER_UID ||
    !templateVersionIds ||
    typeof templateVersionIds !== "object" ||
    Array.isArray(templateVersionIds) ||
    !hasExactKeys(templateVersionIds as DocumentData, ["en", "si", "ta"]) ||
    (templateVersionIds as DocumentData).en !== SYNTHETIC_CAMPAIGN_TEMPLATE_IDS.en ||
    (templateVersionIds as DocumentData).si !== SYNTHETIC_CAMPAIGN_TEMPLATE_IDS.si ||
    (templateVersionIds as DocumentData).ta !== SYNTHETIC_CAMPAIGN_TEMPLATE_IDS.ta ||
    data.audienceSnapshotId !== SYNTHETIC_AUDIENCE_SNAPSHOT_ID ||
    typeof data.state !== "string" ||
    !SYNTHETIC_CAMPAIGN_STATES.includes(data.state as SyntheticCampaignState) ||
    data.dispatchMode !== "simulation" ||
    !schedule ||
    !approval ||
    !isIntegerBetween(data.revision, 0, 999_999_999) ||
    !["not_run", "passed_simulation", "failed"].includes(data.canaryStatus as string) ||
    !isIntegerBetween(data.processedEligible, 0, SYNTHETIC_AUDIENCE_COUNTS.eligibleCount) ||
    !isIntegerBetween(data.scanOffset, 0, SYNTHETIC_CAMPAIGN_TOTAL) ||
    !isIntegerBetween(data.nextBatchIndex, 0, 39) ||
    data.batchSize !== MAX_SYNTHETIC_ELIGIBLE_BATCH ||
    (data.lastCheckpointId !== null &&
      (typeof data.lastCheckpointId !== "string" || !SAFE_ID.test(data.lastCheckpointId))) ||
    data.externalCalls !== 0 ||
    data.networkCalls !== 0 ||
    data.synthetic !== true ||
    data.schemaVersion !== 1 ||
    createdAt === null ||
    updatedAt === null ||
    updatedAt < createdAt
  ) {
    denied();
  }

  const processedEligible = data.processedEligible as number;
  const scanOffset = data.scanOffset as number;
  const nextBatchIndex = data.nextBatchIndex as number;
  const expectedProcessed = countSyntheticEligibleBefore(scanOffset);
  const expectedBatchIndex = Math.ceil(processedEligible / MAX_SYNTHETIC_ELIGIBLE_BATCH);
  const expectedCheckpointId =
    nextBatchIndex === 0
      ? null
      : campaignCheckpointId(expected.campaignId, nextBatchIndex - 1);
  if (
    processedEligible !== expectedProcessed ||
    nextBatchIndex !== expectedBatchIndex ||
    data.lastCheckpointId !== expectedCheckpointId ||
    (data.state === "scheduled" &&
      (processedEligible !== 0 || scanOffset !== 0 || data.lastCheckpointId !== null)) ||
    (data.canaryStatus === "not_run" &&
      (!["scheduled", "cancelled"].includes(data.state as string) ||
        processedEligible !== 0 ||
        scanOffset !== 0)) ||
    (data.state === "failed" && data.canaryStatus !== "failed") ||
    (data.canaryStatus === "failed" &&
      data.state !== "failed" && data.state !== "cancelled") ||
    (["dispatching", "paused", "completed"].includes(data.state as string) &&
      data.canaryStatus !== "passed_simulation") ||
    (data.state === "completed" &&
      (processedEligible !== SYNTHETIC_AUDIENCE_COUNTS.eligibleCount ||
        scanOffset !== SYNTHETIC_CAMPAIGN_TOTAL ||
        nextBatchIndex !== 39)) ||
    (data.state !== "completed" &&
      processedEligible === SYNTHETIC_AUDIENCE_COUNTS.eligibleCount)
  ) {
    denied();
  }
  const validatedSchedule = schedule ?? denied();
  const validatedApproval = approval ?? denied();

  return {
    id: expected.campaignId,
    workspaceId: expected.workspaceId,
    ownerId: SYNTHETIC_CAMPAIGN_OWNER_UID,
    purpose: "health_campaigns",
    messageCategory: "marketing",
    targetAction: data.targetAction as string,
    templateVersionIds: SYNTHETIC_CAMPAIGN_TEMPLATE_IDS,
    audienceSnapshotId: SYNTHETIC_AUDIENCE_SNAPSHOT_ID,
    state: data.state as SyntheticCampaignState,
    dispatchMode: "simulation",
    schedule: validatedSchedule,
    approval: validatedApproval,
    revision: data.revision as number,
    canaryStatus: data.canaryStatus as SyntheticCampaignCanaryStatus,
    processedEligible,
    scanOffset,
    nextBatchIndex,
    batchSize: MAX_SYNTHETIC_ELIGIBLE_BATCH,
    lastCheckpointId: data.lastCheckpointId as string | null,
    externalCalls: 0,
    networkCalls: 0,
    synthetic: true,
  };
}

function exactNumberMap(
  value: unknown,
  expected: Readonly<Record<string, number>>,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as DocumentData;
  return (
    hasExactKeys(data, Object.keys(expected)) &&
    Object.entries(expected).every(([key, count]) => data[key] === count)
  );
}

export function parseStoredSyntheticAudienceSnapshot(
  value: unknown,
  expected: { readonly workspaceId: string; readonly snapshotId: string },
): ParsedSyntheticAudienceSnapshot {
  const denied = (): never => {
    throw new FailClosedError(
      "campaign_snapshot_denied",
      "The immutable canonical synthetic audience snapshot is required.",
    );
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) denied();
  const data = value as DocumentData;
  if (
    !hasExactKeys(data, SNAPSHOT_KEYS) ||
    data.id !== expected.snapshotId ||
    data.id !== SYNTHETIC_AUDIENCE_SNAPSHOT_ID ||
    data.workspaceId !== expected.workspaceId ||
    data.campaignId !== SYNTHETIC_CAMPAIGN_ID ||
    !isBoundedText(data.criteriaSummary, 500) ||
    data.totalEvaluated !== SYNTHETIC_AUDIENCE_COUNTS.totalEvaluated ||
    data.eligibleCount !== SYNTHETIC_AUDIENCE_COUNTS.eligibleCount ||
    data.excludedCount !== SYNTHETIC_AUDIENCE_COUNTS.excludedCount ||
    data.unknownConsentCount !== SYNTHETIC_AUDIENCE_COUNTS.unknownConsentCount ||
    !exactNumberMap(data.exclusionsByReason, SYNTHETIC_AUDIENCE_COUNTS.exclusionsByReason) ||
    !exactNumberMap(data.languageCounts, SYNTHETIC_AUDIENCE_COUNTS.languageCounts) ||
    data.contentHash !== SYNTHETIC_AUDIENCE_CONTENT_HASH ||
    timestampMillis(data.finalizedAt) === null ||
    data.immutable !== true ||
    data.synthetic !== true ||
    data.schemaVersion !== 1 ||
    timestampMillis(data.createdAt) === null ||
    timestampMillis(data.updatedAt) === null
  ) {
    denied();
  }
  return {
    id: expected.snapshotId,
    workspaceId: expected.workspaceId,
    campaignId: SYNTHETIC_CAMPAIGN_ID,
    contentHash: data.contentHash,
    immutable: true,
    synthetic: true,
  };
}

function validProviderState(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    hasExactKeys(value as DocumentData, [
      "submissionState",
      "approvalState",
      "authority",
      "assetId",
      "qualityRating",
      "checkedAt",
    ]) &&
    (value as DocumentData).submissionState === "not_submitted" &&
    (value as DocumentData).approvalState === "unverified" &&
    (value as DocumentData).authority === "none" &&
    (value as DocumentData).assetId === null &&
    (value as DocumentData).qualityRating === "unknown" &&
    (value as DocumentData).checkedAt === null,
  );
}

function validOwnership(value: unknown, workspaceId: string): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    hasExactKeys(value as DocumentData, [
      "ownerKind",
      "ownerWorkspaceId",
      "transferableToHemas",
      "productionUseAllowed",
      "notice",
    ]) &&
    (value as DocumentData).ownerKind === "safenet_demo" &&
    (value as DocumentData).ownerWorkspaceId === workspaceId &&
    (value as DocumentData).transferableToHemas === false &&
    (value as DocumentData).productionUseAllowed === false &&
    (value as DocumentData).notice ===
      "SafeNet demo asset. It is not a Hemas-owned or transferable production asset.",
  );
}

function validVariableRule(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as DocumentData;
  return (
    hasExactKeys(data, [
      "key",
      "description",
      "required",
      "maxLength",
      "exampleValue",
      "allowedPattern",
    ]) &&
    typeof data.key === "string" &&
    /^[a-z][a-z0-9_]{0,63}$/.test(data.key) &&
    isBoundedText(data.description, 240) &&
    typeof data.required === "boolean" &&
    isIntegerBetween(data.maxLength, 1, 500) &&
    isBoundedText(data.exampleValue, 500) &&
    (data.allowedPattern === null || isBoundedText(data.allowedPattern, 240))
  );
}

function validTemplateComponent(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as DocumentData;
  if (data.kind === "header") {
    return (
      hasExactKeys(data, ["kind", "format", "text"]) &&
      data.format === "text" &&
      isBoundedText(data.text, 240)
    );
  }
  if (data.kind === "body" || data.kind === "footer") {
    return (
      hasExactKeys(data, ["kind", "text"]) &&
      isBoundedText(data.text, data.kind === "body" ? 2_048 : 240)
    );
  }
  if (data.kind !== "buttons" || !hasExactKeys(data, ["kind", "buttons"])) return false;
  if (!Array.isArray(data.buttons) || data.buttons.length < 1 || data.buttons.length > 10) {
    return false;
  }
  return data.buttons.every((button: unknown) => {
    if (!button || typeof button !== "object" || Array.isArray(button)) return false;
    const item = button as DocumentData;
    return (
      hasExactKeys(item, ["type", "label", "targetRef"]) &&
      ["quick_reply", "url", "flow"].includes(item.type as string) &&
      isBoundedText(item.label, 80) &&
      isBoundedText(item.targetRef, 240)
    );
  });
}

function templateComponentTuple(component: SyntheticTemplateComponent): readonly unknown[] {
  if (component.kind === "header") return ["header", "text", component.text, []];
  if (component.kind === "body") return ["body", null, component.text, []];
  if (component.kind === "footer") return ["footer", null, component.text, []];
  return [
    "buttons",
    null,
    null,
    component.buttons.map((button) => [button.type, button.label, button.targetRef]),
  ];
}

export function canonicalTemplateContentSerialization(
  input: TemplateContentBindingInput,
): string {
  return JSON.stringify([
    TEMPLATE_CONTENT_BINDING_VERSION,
    input.workspaceId,
    input.id,
    input.assetKey,
    input.providerName,
    input.category,
    input.language,
    input.version,
    input.components.map(templateComponentTuple),
    input.variableRules.map((rule) => [
      rule.key,
      rule.description,
      rule.required,
      rule.maxLength,
      rule.exampleValue,
      rule.allowedPattern,
    ]),
  ]);
}

function templatePlaceholderKeys(
  components: readonly SyntheticTemplateComponent[],
): ReadonlySet<string> {
  const keys = new Set<string>();
  const collect = (text: string): void => {
    for (const match of text.matchAll(/\{\{([a-z][a-z0-9_]*)\}\}/g)) {
      const key = match[1];
      if (key) keys.add(key);
    }
  };
  for (const component of components) {
    if (component.kind === "buttons") {
      for (const button of component.buttons) {
        collect(button.label);
        collect(button.targetRef);
      }
    } else {
      collect(component.text);
    }
  }
  return keys;
}

export function assertStoredSyntheticCampaignTemplate(
  value: unknown,
  expected: {
    readonly workspaceId: string;
    readonly templateId: string;
    readonly language: SyntheticCampaignLanguage;
  },
): ParsedSyntheticCampaignTemplate {
  const denied = (): never => {
    throw new FailClosedError(
      "campaign_template_denied",
      "All three immutable internally approved synthetic template versions are required.",
    );
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) denied();
  const data = value as DocumentData;
  if (
    !hasExactKeys(data, TEMPLATE_KEYS) ||
    data.id !== expected.templateId ||
    expected.templateId !== SYNTHETIC_CAMPAIGN_TEMPLATE_IDS[expected.language] ||
    data.workspaceId !== expected.workspaceId ||
    data.assetKey !== "wellness_awareness" ||
    data.sortKey !== `wellness_awareness:${expected.language}:0003` ||
    data.providerName !== "wellness_awareness" ||
    data.category !== "marketing" ||
    data.language !== expected.language ||
    data.version !== 3 ||
    data.localState !== "approved" ||
    !validProviderState(data.providerState) ||
    data.immutable !== true ||
    typeof data.contentHash !== "string" ||
    !SHA256.test(data.contentHash) ||
    !Array.isArray(data.components) ||
    data.components.length < 1 ||
    data.components.length > 8 ||
    !data.components.every(validTemplateComponent) ||
    !Array.isArray(data.variableRules) ||
    data.variableRules.length > 20 ||
    !data.variableRules.every(validVariableRule) ||
    new Set(data.variableRules.map((rule: DocumentData) => rule.key)).size !==
      data.variableRules.length ||
    !validOwnership(data.ownership, expected.workspaceId) ||
    data.synthetic !== true ||
    data.schemaVersion !== 1 ||
    timestampMillis(data.createdAt) === null ||
    timestampMillis(data.updatedAt) === null
  ) {
    denied();
  }
  const components = data.components as readonly SyntheticTemplateComponent[];
  const variableRules = data.variableRules as readonly SyntheticTemplateVariableRule[];
  const placeholderKeys = templatePlaceholderKeys(components);
  const governedKeys = new Set(variableRules.map((rule) => rule.key));
  if (
    placeholderKeys.size !== governedKeys.size ||
    [...placeholderKeys].some((key) => !governedKeys.has(key))
  ) {
    denied();
  }
  const recomputedContentHash = sha256Hex(
    canonicalTemplateContentSerialization({
      workspaceId: expected.workspaceId,
      id: expected.templateId,
      assetKey: "wellness_awareness",
      providerName: "wellness_awareness",
      category: "marketing",
      language: expected.language,
      version: 3,
      components,
      variableRules,
    }),
  );
  if (
    data.contentHash !== recomputedContentHash ||
    data.contentHash !== SYNTHETIC_CAMPAIGN_TEMPLATE_CONTENT_HASHES[expected.language]
  ) {
    denied();
  }
  return {
    id: expected.templateId,
    workspaceId: expected.workspaceId,
    language: expected.language,
    contentHash: data.contentHash,
  };
}

export function canonicalCampaignApprovalSerialization(input: {
  readonly campaign: ParsedSyntheticCampaign;
  readonly snapshot: ParsedSyntheticAudienceSnapshot;
  readonly templates: Readonly<
    Record<SyntheticCampaignLanguage, ParsedSyntheticCampaignTemplate>
  >;
}): string {
  return JSON.stringify([
    CAMPAIGN_APPROVAL_BINDING_VERSION,
    input.campaign.workspaceId,
    input.campaign.id,
    input.campaign.audienceSnapshotId,
    input.snapshot.contentHash,
    input.campaign.templateVersionIds.en,
    input.templates.en.contentHash,
    input.campaign.templateVersionIds.si,
    input.templates.si.contentHash,
    input.campaign.templateVersionIds.ta,
    input.templates.ta.contentHash,
    input.campaign.purpose,
    input.campaign.messageCategory,
    input.campaign.targetAction,
    input.campaign.schedule.startsAt.toISOString(),
    input.campaign.schedule.timeZone,
    input.campaign.schedule.quietHours.startsAtLocal,
    input.campaign.schedule.quietHours.endsAtLocal,
  ]);
}

export function computeCampaignApprovalHash(input: {
  readonly campaign: ParsedSyntheticCampaign;
  readonly snapshot: ParsedSyntheticAudienceSnapshot;
  readonly templates: Readonly<
    Record<SyntheticCampaignLanguage, ParsedSyntheticCampaignTemplate>
  >;
}): string {
  return sha256Hex(canonicalCampaignApprovalSerialization(input));
}

export function assertCampaignApprovalBinding(input: {
  readonly campaign: ParsedSyntheticCampaign;
  readonly snapshot: ParsedSyntheticAudienceSnapshot;
  readonly templates: Readonly<
    Record<SyntheticCampaignLanguage, ParsedSyntheticCampaignTemplate>
  >;
}): void {
  if (
    input.snapshot.campaignId !== input.campaign.id ||
    input.snapshot.id !== input.campaign.audienceSnapshotId ||
    input.templates.en.id !== input.campaign.templateVersionIds.en ||
    input.templates.si.id !== input.campaign.templateVersionIds.si ||
    input.templates.ta.id !== input.campaign.templateVersionIds.ta ||
    Object.values(input.templates).some(
      (template) => template.workspaceId !== input.campaign.workspaceId,
    ) ||
    computeCampaignApprovalHash(input) !== input.campaign.approval.approvedContentHash
  ) {
    throw new FailClosedError(
      "campaign_approval_invalidated",
      "Campaign governance binding no longer matches the approved content hash.",
    );
  }
}

export function parseStoredCampaignControlResult(
  value: unknown,
  expected: {
    readonly campaignId: string;
    readonly action: SyntheticCampaignControlAction;
  },
): SyntheticCampaignControlResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FailClosedError("invalid_idempotency_record", "Stored campaign result is invalid.");
  }
  const data = value as DocumentData;
  if (
    !hasExactKeys(data, RESULT_KEYS) ||
    data.campaignId !== expected.campaignId ||
    typeof data.eventId !== "string" ||
    !SAFE_ID.test(data.eventId) ||
    (data.checkpointId !== null &&
      (typeof data.checkpointId !== "string" || !SAFE_ID.test(data.checkpointId))) ||
    data.action !== expected.action ||
    typeof data.state !== "string" ||
    !SYNTHETIC_CAMPAIGN_STATES.includes(data.state as SyntheticCampaignState) ||
    !isIntegerBetween(data.revision, 1, 1_000_000_000) ||
    !["not_run", "passed_simulation", "failed"].includes(data.canaryStatus as string) ||
    !isIntegerBetween(data.processedEligible, 0, SYNTHETIC_AUDIENCE_COUNTS.eligibleCount) ||
    !isIntegerBetween(data.scanOffset, 0, SYNTHETIC_CAMPAIGN_TOTAL) ||
    !isIntegerBetween(data.nextBatchIndex, 0, 39) ||
    !isIntegerBetween(data.batchEligibleCount, 0, MAX_SYNTHETIC_ELIGIBLE_BATCH) ||
    data.synthetic !== true ||
    data.externalCalls !== 0 ||
    data.networkCalls !== 0
  ) {
    throw new FailClosedError("invalid_idempotency_record", "Stored campaign result is invalid.");
  }
  return data as SyntheticCampaignControlResult;
}
