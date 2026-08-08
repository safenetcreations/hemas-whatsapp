import type {
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Transaction,
} from "firebase-admin/firestore";
import { createTenantAuditEvent } from "../audit.js";
import { toFirestoreAuditRecord } from "../audit-firestore.js";
import type { RuntimeConfig } from "../config.js";
import { deterministicId } from "../deterministic.js";
import { FailClosedError } from "../errors.js";
import { parseStoredSyntheticAppointment } from "../appointments/contracts.js";
import {
  AUTOMATION_COLLECTIONS,
  AUTOMATION_EXECUTION_STATES,
  AUTOMATION_RUN_ACTIONS,
  EXECUTABLE_AUTOMATION_FAMILIES,
  assertAutomationReceiptReplayBinding,
  assertPhase5DemoRuntimeBoundary,
  exactRecord,
  fail,
  parseAuthoritativeAutomationStep,
  parseSyntheticAutomationControlInput,
  requireBoundedString,
  requireId,
  requireInteger,
  requireProtectedRef,
  requireSha256,
  serializeAutomationDefinitionApproval,
  serializeAutomationDefinitionContent,
  serializeAutomationDefinitionSecretBinding,
  serializeAutomationControlResult,
  sha256Hex,
  syntheticHmacSha256,
  timestampToDate,
  type AuthoritativeAutomationStep,
  type AutomationDefinitionContentBinding,
  type AutomationExecutionState,
  type AutomationPausedFromState,
  type AutomationRunAction,
  type AutomationTrigger,
  type ExecutableAutomationFamily,
  type SyntheticAutomationControlInput,
  type SyntheticAutomationControlResponse,
  type SyntheticAutomationControlResult,
} from "./contracts.js";
import {
  assertPhase5Authorization,
  assertLatestSyntheticConsent,
  assertSyntheticLocation,
  assertSyntheticTeam,
  assertSyntheticTemplate,
  ensureNoUnexpectedClinicalText,
  parsePhase5Idempotency,
  parseSyntheticContact,
  parseSyntheticConversation,
  phase5EventProtectedRef,
  phase5IdempotencyId,
  phase5WorkItemProtectedRef,
  resolveSyntheticProtectedRef,
  type Phase5Actor,
} from "./runtime.js";

type EmulatorBoundary = {
  readonly projectId: string;
  readonly firestoreEmulatorHost: string | undefined;
};

type StoredAutomationDefinition = AutomationDefinitionContentBinding & {
  readonly id: string;
  readonly family: ExecutableAutomationFamily;
  readonly contentHash: string;
  readonly ownerUid: string;
  readonly approverUid: string;
  readonly approvalHash: string;
  readonly approvalScope: "simulation_only";
  readonly approvedAt: Date;
  readonly lifecycleState: "approved";
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

type StoredAutomationActivation = {
  readonly id: ExecutableAutomationFamily;
  readonly workspaceId: string;
  readonly family: ExecutableAutomationFamily;
  readonly activeDefinitionId: string;
  readonly activeDefinitionVersion: number;
  readonly activeDefinitionContentHash: string;
  readonly activeDefinitionApprovalHash: string;
  readonly activeDefinitionApprovalScope: "simulation_only";
  readonly activeDefinitionSecretBindingHash: string;
  readonly activatedByUid: string;
  readonly activatedAt: Date;
  readonly activationEventId: string;
  readonly activationAuditEventId: string;
  readonly revision: number;
};

type StoredAutomationRun = {
  readonly id: string;
  readonly workspaceId: string;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly definitionContentHash: string;
  readonly teamId: string;
  readonly locationId: string;
  readonly state: AutomationExecutionState;
  readonly pausedFromState: AutomationPausedFromState | null;
  readonly nextEligibleAt: Date | null;
  readonly openWorkItemId: string | null;
  readonly currentStepIndex: number;
  readonly completedStepCount: number;
  readonly attemptCount: number;
  readonly revision: number;
  readonly outcomeCode: string;
  readonly lastEventId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

type StoredRunSecret = {
  readonly workspaceId: string;
  readonly runId: string;
  readonly protectedContactRef: string;
  readonly protectedConversationRef: string;
  readonly protectedAppointmentRef: string | null;
  readonly triggerFingerprint: string;
  readonly idempotencyFingerprint: string;
};

type StoredWorkItem = {
  readonly id: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly definitionContentHash: string;
  readonly teamId: string;
  readonly locationId: string;
  readonly reasonCode: "integration_timeout" | "retry_exhausted" | "fallback_route" | "human_takeover" | "synthetic_failure";
  readonly state: "open" | "acknowledged" | "resolved";
  readonly openedAt: Date;
  readonly slaMinutes: number;
  readonly dueAt: Date;
  readonly assignedMemberUid: string | null;
  readonly acknowledgedAt: Date | null;
  readonly acknowledgedByUid: string | null;
  readonly resolvedAt: Date | null;
  readonly resolvedByUid: string | null;
  readonly resolutionCode: "retried" | "routed_to_human" | "stopped_safely" | null;
  readonly revision: number;
  readonly lastEventId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

type TransitionPlan = {
  readonly nextState: AutomationExecutionState;
  readonly pausedFromState: AutomationPausedFromState | null;
  readonly nextEligibleAt: Date | null;
  readonly currentStepIndex: number;
  readonly completedStepCount: number;
  readonly attemptCount: number;
  readonly stepIndex: number | null;
  readonly stepId: string | null;
  readonly eventAttemptNumber: number;
  readonly outcomeCode: string;
  readonly reasonCode: string;
  readonly workItemMode: "none" | "create_failure" | "create_fallback" | "create_takeover" | "preserve" | "acknowledge" | "resolve_retry" | "resolve_human" | "resolve_stop";
};

const DEFINITION_KEYS = [
  "id", "workspaceId", "family", "version", "name", "trigger", "consentPurpose",
  "riskLevel", "steps", "contentHash", "secretBindingHash", "ownerUid", "approverUid",
  "approvalHash", "approvalScope", "approvedAt", "lifecycleState", "schemaVersion",
  "synthetic", "createdAt", "updatedAt",
] as const;
const DEFINITION_SECRET_KEYS = [
  "workspaceId", "definitionId", "protectedConfigurationRef",
  "configurationFingerprint", "schemaVersion", "synthetic",
] as const;
const ACTIVATION_KEYS = [
  "id", "workspaceId", "family", "activeDefinitionId", "activeDefinitionVersion",
  "activeDefinitionContentHash", "activeDefinitionApprovalHash",
  "activeDefinitionApprovalScope", "activeDefinitionSecretBindingHash",
  "activatedByUid", "activatedAt", "activationEventId", "activationAuditEventId",
  "revision", "createdAt", "updatedAt", "schemaVersion", "synthetic",
  "externalDispatchCount", "networkCallCount",
] as const;
const DEFINITION_EVENT_KEYS = [
  "id", "workspaceId", "family", "eventType", "definitionId", "definitionVersion",
  "definitionContentHash", "definitionApprovalHash", "definitionApprovalScope",
  "definitionSecretBindingHash", "fromLifecycleState", "toLifecycleState", "revision",
  "auditEventId", "occurredAt", "schemaVersion", "synthetic", "externalDispatchCount",
  "networkCallCount", "actorKind", "actorUid",
] as const;
const RECEIPT_KEYS = [
  "id", "workspaceId", "family", "definitionId", "definitionVersion",
  "definitionContentHash", "definitionApprovalHash", "activationEventId",
  "sourceEventFingerprint", "triggerFingerprint", "runId", "createdAt",
  "schemaVersion", "synthetic",
] as const;
const RUN_KEYS = [
  "id", "workspaceId", "definitionId", "definitionVersion", "definitionContentHash",
  "teamId", "locationId", "state", "pausedFromState", "nextEligibleAt",
  "openWorkItemId", "currentStepIndex", "completedStepCount", "attemptCount",
  "revision", "outcomeCode", "lastEventId", "schemaVersion", "synthetic",
  "externalDispatchCount", "networkCallCount", "createdAt", "updatedAt",
] as const;
const RUN_SECRET_KEYS = [
  "workspaceId", "runId", "protectedContactRef", "protectedConversationRef",
  "protectedAppointmentRef", "triggerFingerprint", "idempotencyFingerprint",
  "schemaVersion", "synthetic",
] as const;
const WORK_ITEM_KEYS = [
  "id", "workspaceId", "runId", "definitionId", "definitionVersion",
  "definitionContentHash", "teamId", "locationId", "reasonCode", "state", "openedAt",
  "slaMinutes", "dueAt", "assignedMemberUid", "acknowledgedAt", "acknowledgedByUid",
  "resolvedAt", "resolvedByUid", "resolutionCode", "revision", "lastEventId",
  "schemaVersion", "synthetic", "externalDispatchCount", "networkCallCount",
  "createdAt", "updatedAt",
] as const;
const WORK_ITEM_SECRET_KEYS = [
  "workspaceId", "runId", "workItemId", "protectedContextRef",
  "contextFingerprint", "schemaVersion", "synthetic",
] as const;
const AUDIT_KEYS = [
  "id", "workspaceId", "actorUid", "actorType", "action", "resourceType",
  "resourceId", "outcome", "requestId", "occurredAt", "createdAt", "metadata",
  "synthetic", "schemaVersion",
] as const;
const RUN_EVENT_KEYS = [
  "id", "workspaceId", "runId", "definitionId", "definitionVersion",
  "definitionContentHash", "teamId", "locationId", "revision", "auditEventId",
  "action", "fromState", "toState", "stepIndex", "stepId", "attemptNumber",
  "workItemId", "nextEligibleAt", "reasonCode", "evidenceFingerprint", "outcomeCode",
  "occurredAt", "schemaVersion", "synthetic", "externalDispatchCount",
  "networkCallCount", "actorKind", "actorUid",
] as const;

function root(workspaceId: string): string {
  return `workspaces/${workspaceId}`;
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function documentData(snapshot: DocumentSnapshot, code: string, message: string): DocumentData {
  if (!snapshot.exists) throw new FailClosedError(code, message);
  const data = snapshot.data();
  if (!data) throw new FailClosedError(code, message);
  return data;
}

function parseDefinition(value: unknown, expected: { workspaceId: string; definitionId: string }): StoredAutomationDefinition {
  const data = exactRecord(value, DEFINITION_KEYS, "automation definition", "automation_definition_denied");
  if (
    data.id !== expected.definitionId ||
    data.workspaceId !== expected.workspaceId ||
    !EXECUTABLE_AUTOMATION_FAMILIES.includes(data.family as ExecutableAutomationFamily) ||
    data.lifecycleState !== "approved" ||
    data.approvalScope !== "simulation_only" ||
    data.synthetic !== true ||
    data.schemaVersion !== 1 ||
    data.externalDispatchCount !== undefined ||
    data.networkCallCount !== undefined
  ) {
    return fail("automation_definition_denied", "An approved immutable synthetic definition is required.");
  }
  const approverUid = requireId(data.approverUid, "definition approver", "automation_definition_denied");
  const approvedAt = timestampToDate(data.approvedAt, "definition approvedAt", "automation_definition_denied");
  const steps = Array.isArray(data.steps)
    ? data.steps.map(parseAuthoritativeAutomationStep)
    : fail("automation_definition_denied", "Definition steps are invalid.");
  const definition: StoredAutomationDefinition = {
    id: expected.definitionId,
    workspaceId: expected.workspaceId,
    definitionId: expected.definitionId,
    family: data.family as ExecutableAutomationFamily,
    version: requireInteger(data.version, "definition version", 1, 1_000_000, "automation_definition_denied"),
    name: requireBoundedString(data.name, "definition name", 160, "automation_definition_denied"),
    trigger: data.trigger as AutomationTrigger,
    consentPurpose: data.consentPurpose as AutomationDefinitionContentBinding["consentPurpose"],
    riskLevel: data.riskLevel as AutomationDefinitionContentBinding["riskLevel"],
    steps,
    secretBindingHash: requireSha256(data.secretBindingHash, "definition secret binding", "automation_definition_denied"),
    synthetic: true,
    contentHash: requireSha256(data.contentHash, "definition content hash", "automation_definition_denied"),
    ownerUid: requireId(data.ownerUid, "definition owner", "automation_definition_denied"),
    approverUid,
    approvalHash: requireSha256(data.approvalHash, "definition approval hash", "automation_definition_denied"),
    approvalScope: "simulation_only",
    approvedAt,
    lifecycleState: "approved",
    createdAt: timestampToDate(data.createdAt, "definition createdAt", "automation_definition_denied"),
    updatedAt: timestampToDate(data.updatedAt, "definition updatedAt", "automation_definition_denied"),
  };
  const canonicalContent = serializeAutomationDefinitionContent({
    workspaceId: definition.workspaceId,
    definitionId: definition.id,
    family: definition.family,
    version: definition.version,
    name: definition.name,
    trigger: definition.trigger,
    consentPurpose: definition.consentPurpose,
    riskLevel: definition.riskLevel,
    steps: definition.steps,
    secretBindingHash: definition.secretBindingHash,
    synthetic: true,
  });
  if (sha256Hex(canonicalContent) !== definition.contentHash) return fail("automation_definition_denied", "Definition content hash is invalid.");
  const canonicalApproval = serializeAutomationDefinitionApproval({
    workspaceId: definition.workspaceId,
    definitionId: definition.id,
    contentHash: definition.contentHash,
    ownerUid: definition.ownerUid,
    approverUid: definition.approverUid,
    scope: "simulation_only",
    approvedAt: definition.approvedAt.toISOString(),
  });
  if (sha256Hex(canonicalApproval) !== definition.approvalHash || definition.ownerUid === definition.approverUid) return fail("automation_definition_denied", "Definition approval evidence is invalid.");
  return definition;
}

function assertDefinitionSecret(value: unknown, definition: StoredAutomationDefinition): void {
  const data = exactRecord(value, DEFINITION_SECRET_KEYS, "automation definition secret", "automation_definition_denied");
  const allowedConfigurationRefs = new Set([
    "demo://automation/configuration/synthetic-v1",
    "demo://automation/configuration/synthetic-laboratory-v1",
  ]);
  const protectedConfigurationRef = requireProtectedRef(data.protectedConfigurationRef, "definition configuration reference", "automation_definition_denied");
  if (
    data.workspaceId !== definition.workspaceId ||
    data.definitionId !== definition.id ||
    !allowedConfigurationRefs.has(protectedConfigurationRef) ||
    data.synthetic !== true ||
    data.schemaVersion !== 1
  ) return fail("automation_definition_denied", "Definition secret projection is invalid.");
  const serialized = serializeAutomationDefinitionSecretBinding({
    workspaceId: definition.workspaceId,
    definitionId: definition.id,
    protectedConfigurationRef,
    configurationFingerprint: requireSha256(data.configurationFingerprint, "configuration fingerprint", "automation_definition_denied"),
    schemaVersion: 1,
    synthetic: true,
  });
  if (sha256Hex(serialized) !== definition.secretBindingHash) return fail("automation_definition_denied", "Definition secret binding hash is invalid.");
}

function parseActivation(value: unknown, definition: StoredAutomationDefinition): StoredAutomationActivation {
  const data = exactRecord(value, ACTIVATION_KEYS, "automation activation", "automation_activation_denied");
  if (
    data.id !== definition.family ||
    data.workspaceId !== definition.workspaceId ||
    data.family !== definition.family ||
    data.activeDefinitionId !== definition.id ||
    data.activeDefinitionVersion !== definition.version ||
    data.activeDefinitionContentHash !== definition.contentHash ||
    data.activeDefinitionApprovalHash !== definition.approvalHash ||
    data.activeDefinitionApprovalScope !== "simulation_only" ||
    data.activeDefinitionSecretBindingHash !== definition.secretBindingHash ||
    data.synthetic !== true ||
    data.schemaVersion !== 1 ||
    data.externalDispatchCount !== 0 ||
    data.networkCallCount !== 0
  ) return fail("automation_activation_denied", "Active pointer does not bind the approved definition.");
  timestampToDate(data.createdAt, "activation createdAt", "automation_activation_denied");
  timestampToDate(data.updatedAt, "activation updatedAt", "automation_activation_denied");
  return {
    id: definition.family,
    workspaceId: definition.workspaceId,
    family: definition.family,
    activeDefinitionId: definition.id,
    activeDefinitionVersion: definition.version,
    activeDefinitionContentHash: definition.contentHash,
    activeDefinitionApprovalHash: definition.approvalHash,
    activeDefinitionApprovalScope: "simulation_only",
    activeDefinitionSecretBindingHash: definition.secretBindingHash,
    activatedByUid: requireId(data.activatedByUid, "activation actor", "automation_activation_denied"),
    activatedAt: timestampToDate(data.activatedAt, "activation time", "automation_activation_denied"),
    activationEventId: requireId(data.activationEventId, "activation event", "automation_activation_denied"),
    activationAuditEventId: requireId(data.activationAuditEventId, "activation audit", "automation_activation_denied"),
    revision: requireInteger(data.revision, "activation revision", 1, 1_000_000, "automation_activation_denied"),
  };
}

function assertActivationEvent(value: unknown, activation: StoredAutomationActivation): number {
  const data = exactRecord(value, DEFINITION_EVENT_KEYS, "automation activation event", "automation_activation_denied");
  if (
    data.id !== activation.activationEventId ||
    data.workspaceId !== activation.workspaceId ||
    data.family !== activation.family ||
    data.eventType !== "activated" ||
    data.definitionId !== activation.activeDefinitionId ||
    data.definitionVersion !== activation.activeDefinitionVersion ||
    data.definitionContentHash !== activation.activeDefinitionContentHash ||
    data.definitionApprovalHash !== activation.activeDefinitionApprovalHash ||
    data.definitionApprovalScope !== activation.activeDefinitionApprovalScope ||
    data.definitionSecretBindingHash !== activation.activeDefinitionSecretBindingHash ||
    data.fromLifecycleState !== "approved" ||
    data.toLifecycleState !== "approved" ||
    data.auditEventId !== activation.activationAuditEventId ||
    data.actorKind !== "staff" ||
    data.actorUid !== activation.activatedByUid ||
    data.synthetic !== true ||
    data.schemaVersion !== 1 ||
    data.externalDispatchCount !== 0 ||
    data.networkCallCount !== 0 ||
    timestampToDate(data.occurredAt, "activation event time", "automation_activation_denied").getTime() !== activation.activatedAt.getTime()
  ) return fail("automation_activation_denied", "Activation does not bind its immutable staff event.");
  return requireInteger(data.revision, "activation event revision", 1, 1_000_000, "automation_activation_denied");
}

function assertAuditRecord(value: unknown, expected: {
  readonly id: string;
  readonly workspaceId: string;
  readonly actorUid: string;
  readonly action: string;
  readonly resourceType: "automation_definition" | "automation_run";
  readonly resourceId: string;
  readonly occurredAt: Date;
  readonly requestId?: string;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}): void {
  const data = exactRecord(value, AUDIT_KEYS, "automation audit evidence", "automation_audit_denied");
  const metadata = exactRecord(data.metadata, Object.keys(expected.metadata), "automation audit metadata", "automation_audit_denied");
  if (
    data.id !== expected.id ||
    data.workspaceId !== expected.workspaceId ||
    data.actorUid !== expected.actorUid ||
    data.actorType !== "user" ||
    data.action !== expected.action ||
    data.resourceType !== expected.resourceType ||
    data.resourceId !== expected.resourceId ||
    (data.outcome !== "allowed" && data.outcome !== "simulated") ||
    (expected.requestId !== undefined && data.requestId !== expected.requestId) ||
    data.synthetic !== true ||
    data.schemaVersion !== 1 ||
    timestampToDate(data.occurredAt, "audit occurredAt", "automation_audit_denied").getTime() !== expected.occurredAt.getTime() ||
    timestampToDate(data.createdAt, "audit createdAt", "automation_audit_denied").getTime() !== expected.occurredAt.getTime() ||
    Object.entries(expected.metadata).some(([key, expectedValue]) => metadata[key] !== expectedValue)
  ) return fail("automation_audit_denied", "Audit evidence does not bind its immutable lifecycle event.");
  requireId(data.requestId, "audit requestId", "automation_audit_denied");
}

function parseRun(value: unknown, expected: { workspaceId: string; runId: string; now: Date }): StoredAutomationRun {
  const data = exactRecord(value, RUN_KEYS, "automation run", "automation_run_denied");
  if (
    data.id !== expected.runId ||
    data.workspaceId !== expected.workspaceId ||
    !AUTOMATION_EXECUTION_STATES.includes(data.state as AutomationExecutionState) ||
    data.synthetic !== true ||
    data.schemaVersion !== 1 ||
    data.externalDispatchCount !== 0 ||
    data.networkCallCount !== 0
  ) return fail("automation_run_denied", "A matching synthetic run is required.");
  const state = data.state as AutomationExecutionState;
  const pausedFromState = data.pausedFromState === null
    ? null
    : (["queued", "running", "waiting", "failed"].includes(data.pausedFromState as string)
      ? data.pausedFromState as AutomationPausedFromState
      : fail("automation_run_denied", "Run pause origin is invalid."));
  const nextEligibleAt = data.nextEligibleAt === null
    ? null
    : timestampToDate(data.nextEligibleAt, "run nextEligibleAt", "automation_run_denied");
  const openWorkItemId = data.openWorkItemId === null
    ? null
    : requireId(data.openWorkItemId, "open work item", "automation_run_denied");
  const run: StoredAutomationRun = {
    id: expected.runId,
    workspaceId: expected.workspaceId,
    definitionId: requireId(data.definitionId, "run definition", "automation_run_denied"),
    definitionVersion: requireInteger(data.definitionVersion, "run definition version", 1, 1_000_000, "automation_run_denied"),
    definitionContentHash: requireSha256(data.definitionContentHash, "run definition hash", "automation_run_denied"),
    teamId: requireId(data.teamId, "run team", "automation_run_denied"),
    locationId: requireId(data.locationId, "run location", "automation_run_denied"),
    state,
    pausedFromState,
    nextEligibleAt,
    openWorkItemId,
    currentStepIndex: requireInteger(data.currentStepIndex, "current step", 0, 32, "automation_run_denied"),
    completedStepCount: requireInteger(data.completedStepCount, "completed step count", 0, 32, "automation_run_denied"),
    attemptCount: requireInteger(data.attemptCount, "attempt count", 0, 11, "automation_run_denied"),
    revision: requireInteger(data.revision, "run revision", 1, 1_000_000, "automation_run_denied"),
    outcomeCode: requireId(data.outcomeCode, "run outcome", "automation_run_denied"),
    lastEventId: data.lastEventId === null ? null : requireId(data.lastEventId, "last event", "automation_run_denied"),
    createdAt: timestampToDate(data.createdAt, "run createdAt", "automation_run_denied"),
    updatedAt: timestampToDate(data.updatedAt, "run updatedAt", "automation_run_denied"),
  };
  const isPaused = state === "paused_by_operator" || state === "paused_for_human";
  const terminal = state === "completed" || state === "ended";
  const validOutcomeForState: Readonly<Record<AutomationExecutionState, readonly string[]>> = {
    queued: ["accepted"],
    running: ["accepted", "step_completed"],
    waiting: ["accepted", "wait_scheduled", "retry_scheduled"],
    paused_by_operator: ["accepted", "fallback_work_item_created"],
    paused_for_human: ["human_takeover_required"],
    completed: ["completed"],
    ended: ["ended_by_operator", "fallback_stopped_safely"],
    failed: ["accepted", "synthetic_failure"],
  };
  if (
    run.completedStepCount !== run.currentStepIndex ||
    (state === "waiting" && (pausedFromState !== null || nextEligibleAt === null)) ||
    (isPaused && pausedFromState === null) ||
    (!isPaused && state !== "waiting" && (pausedFromState !== null || nextEligibleAt !== null)) ||
    (isPaused && (pausedFromState === "waiting") !== (nextEligibleAt !== null)) ||
    (state === "paused_for_human" && pausedFromState === "queued") ||
    (["failed", "paused_for_human"].includes(state) && openWorkItemId === null) ||
    (!["failed", "paused_for_human", "paused_by_operator"].includes(state) && openWorkItemId !== null) ||
    (["failed", "waiting"].includes(state) && run.attemptCount < 1) ||
    (state === "queued" && (run.currentStepIndex !== 0 || run.completedStepCount !== 0 || run.attemptCount !== 0)) ||
    (run.revision === 1 && (state !== "queued" || run.lastEventId !== null || run.outcomeCode !== "accepted")) ||
    (run.revision > 1 && run.lastEventId === null) ||
    !validOutcomeForState[state].includes(run.outcomeCode) ||
    (terminal && (run.nextEligibleAt !== null || run.openWorkItemId !== null)) ||
    run.createdAt.getTime() > run.updatedAt.getTime() ||
    run.updatedAt.getTime() > expected.now.getTime()
  ) return fail("automation_run_denied", "Run operational pointers are invalid.");
  return run;
}

function parseRunSecret(value: unknown, run: StoredAutomationRun): StoredRunSecret {
  const data = exactRecord(value, RUN_SECRET_KEYS, "automation run secret", "automation_run_denied");
  if (
    data.workspaceId !== run.workspaceId ||
    data.runId !== run.id ||
    data.synthetic !== true ||
    data.schemaVersion !== 1
  ) return fail("automation_run_denied", "Run secret projection does not bind the run.");
  const triggerFingerprint = requireSha256(data.triggerFingerprint, "run trigger fingerprint", "automation_run_denied");
  const idempotencyFingerprint = requireSha256(data.idempotencyFingerprint, "run idempotency fingerprint", "automation_run_denied");
  return {
    workspaceId: run.workspaceId,
    runId: run.id,
    protectedContactRef: requireProtectedRef(data.protectedContactRef, "run contact reference", "automation_run_denied"),
    protectedConversationRef: requireProtectedRef(data.protectedConversationRef, "run conversation reference", "automation_run_denied"),
    protectedAppointmentRef: data.protectedAppointmentRef === null ? null : requireProtectedRef(data.protectedAppointmentRef, "run appointment reference", "automation_run_denied"),
    triggerFingerprint,
    idempotencyFingerprint,
  };
}

function assertReceipt(value: unknown, input: {
  readonly run: StoredAutomationRun;
  readonly definition: StoredAutomationDefinition;
  readonly activation: StoredAutomationActivation;
  readonly triggerFingerprint: string;
}): void {
  const data = exactRecord(value, RECEIPT_KEYS, "automation trigger receipt", "automation_receipt_denied");
  const createdAt = timestampToDate(data.createdAt, "receipt createdAt", "automation_receipt_denied");
  const receipt = {
    receiptId: requireSha256(data.id, "receipt id", "automation_receipt_denied"),
    triggerFingerprint: requireSha256(data.triggerFingerprint, "receipt fingerprint", "automation_receipt_denied"),
    workspaceId: requireId(data.workspaceId, "receipt workspace", "automation_receipt_denied"),
    family: data.family as ExecutableAutomationFamily,
    definitionId: requireId(data.definitionId, "receipt definition", "automation_receipt_denied"),
    definitionVersion: requireInteger(data.definitionVersion, "receipt definition version", 1, 1_000_000, "automation_receipt_denied"),
    definitionContentHash: requireSha256(data.definitionContentHash, "receipt content hash", "automation_receipt_denied"),
    definitionApprovalHash: requireSha256(data.definitionApprovalHash, "receipt approval hash", "automation_receipt_denied"),
    activationEventId: requireId(data.activationEventId, "receipt activation event", "automation_receipt_denied"),
    sourceEventFingerprint: requireSha256(data.sourceEventFingerprint, "receipt source fingerprint", "automation_receipt_denied"),
    runId: requireId(data.runId, "receipt run", "automation_receipt_denied"),
    createdAt: createdAt.toISOString(),
    schemaVersion: 1 as const,
    synthetic: true as const,
  };
  if (
    data.schemaVersion !== 1 || data.synthetic !== true ||
    receipt.receiptId !== input.triggerFingerprint ||
    receipt.triggerFingerprint !== input.triggerFingerprint ||
    receipt.workspaceId !== input.run.workspaceId ||
    receipt.family !== input.definition.family ||
    receipt.definitionId !== input.run.definitionId ||
    receipt.definitionVersion !== input.run.definitionVersion ||
    receipt.definitionContentHash !== input.run.definitionContentHash ||
    receipt.definitionApprovalHash !== input.definition.approvalHash ||
    receipt.activationEventId !== input.activation.activationEventId ||
    receipt.runId !== input.run.id ||
    input.activation.activatedAt.getTime() > createdAt.getTime() ||
    input.run.createdAt.getTime() !== createdAt.getTime()
  ) return fail("automation_receipt_denied", "Receipt does not bind the active run aggregate.");
  assertAutomationReceiptReplayBinding(receipt);
}

function parseWorkItem(value: unknown, run: StoredAutomationRun, id: string): StoredWorkItem {
  const data = exactRecord(value, WORK_ITEM_KEYS, "automation work item", "automation_work_item_denied");
  const dateOrNull = (item: unknown, label: string): Date | null => item === null ? null : timestampToDate(item, label, "automation_work_item_denied");
  const item: StoredWorkItem = {
    id,
    workspaceId: run.workspaceId,
    runId: run.id,
    definitionId: run.definitionId,
    definitionVersion: run.definitionVersion,
    definitionContentHash: run.definitionContentHash,
    teamId: run.teamId,
    locationId: run.locationId,
    reasonCode: data.reasonCode as StoredWorkItem["reasonCode"],
    state: data.state as StoredWorkItem["state"],
    openedAt: timestampToDate(data.openedAt, "work item openedAt", "automation_work_item_denied"),
    slaMinutes: requireInteger(data.slaMinutes, "work item SLA", 1, 1_440, "automation_work_item_denied"),
    dueAt: timestampToDate(data.dueAt, "work item dueAt", "automation_work_item_denied"),
    assignedMemberUid: data.assignedMemberUid === null ? null : requireId(data.assignedMemberUid, "assigned member", "automation_work_item_denied"),
    acknowledgedAt: dateOrNull(data.acknowledgedAt, "work item acknowledgedAt"),
    acknowledgedByUid: data.acknowledgedByUid === null ? null : requireId(data.acknowledgedByUid, "work item acknowledge actor", "automation_work_item_denied"),
    resolvedAt: dateOrNull(data.resolvedAt, "work item resolvedAt"),
    resolvedByUid: data.resolvedByUid === null ? null : requireId(data.resolvedByUid, "work item resolve actor", "automation_work_item_denied"),
    resolutionCode: data.resolutionCode as StoredWorkItem["resolutionCode"],
    revision: requireInteger(data.revision, "work item revision", 1, 1_000_000, "automation_work_item_denied"),
    lastEventId: requireId(data.lastEventId, "work item last event", "automation_work_item_denied"),
    createdAt: timestampToDate(data.createdAt, "work item createdAt", "automation_work_item_denied"),
    updatedAt: timestampToDate(data.updatedAt, "work item updatedAt", "automation_work_item_denied"),
  };
  if (
    data.id !== id || data.workspaceId !== run.workspaceId || data.runId !== run.id ||
    data.definitionId !== run.definitionId || data.definitionVersion !== run.definitionVersion ||
    data.definitionContentHash !== run.definitionContentHash || data.teamId !== run.teamId ||
    data.locationId !== run.locationId || data.synthetic !== true || data.schemaVersion !== 1 ||
    data.externalDispatchCount !== 0 || data.networkCallCount !== 0 ||
    !["integration_timeout", "retry_exhausted", "fallback_route", "human_takeover", "synthetic_failure"].includes(item.reasonCode) ||
    !["open", "acknowledged", "resolved"].includes(item.state) ||
    item.dueAt.getTime() - item.openedAt.getTime() !== item.slaMinutes * 60_000 ||
    item.createdAt.getTime() !== item.openedAt.getTime() ||
    item.updatedAt.getTime() < item.createdAt.getTime()
  ) return fail("automation_work_item_denied", "Work item identity or lifecycle is invalid.");
  const ackComplete = item.acknowledgedAt !== null && item.acknowledgedByUid !== null;
  const resolutionComplete = item.resolvedAt !== null && item.resolvedByUid !== null && item.resolutionCode !== null;
  if (
    (item.acknowledgedAt === null) !== (item.acknowledgedByUid === null) ||
    [item.resolvedAt, item.resolvedByUid, item.resolutionCode].filter((entry) => entry === null).length % 3 !== 0 ||
    (item.state === "open" && (ackComplete || resolutionComplete)) ||
    (item.state === "acknowledged" && (!ackComplete || resolutionComplete)) ||
    (item.state === "resolved" && (!ackComplete || !resolutionComplete)) ||
    (item.acknowledgedAt && item.acknowledgedAt.getTime() < item.openedAt.getTime()) ||
    (item.resolvedAt && item.acknowledgedAt && item.resolvedAt.getTime() < item.acknowledgedAt.getTime())
  ) return fail("automation_work_item_denied", "Work item lifecycle evidence is invalid.");
  return item;
}

function assertWorkItemSecret(value: unknown, run: StoredAutomationRun, item: StoredWorkItem): void {
  const data = exactRecord(value, WORK_ITEM_SECRET_KEYS, "automation work-item secret", "automation_work_item_denied");
  const expectedFingerprint = sha256Hex(JSON.stringify([
    run.workspaceId, run.id, item.id, item.reasonCode,
  ]));
  if (
    data.workspaceId !== run.workspaceId ||
    data.runId !== run.id ||
    data.workItemId !== item.id ||
    data.protectedContextRef !== phase5WorkItemProtectedRef(item.id) ||
    data.contextFingerprint !== expectedFingerprint ||
    data.schemaVersion !== 1 ||
    data.synthetic !== true
  ) return fail("automation_work_item_denied", "Work-item secret projection is missing or substituted.");
}

function actionAllowed(state: AutomationExecutionState, action: AutomationRunAction, pausedFrom: AutomationPausedFromState | null): boolean {
  const matrix: Readonly<Record<AutomationExecutionState, readonly AutomationRunAction[]>> = {
    queued: ["start", "pause", "end"],
    running: ["advance_step", "pause", "simulate_human_takeover", "exercise_fallback", "inject_failure", "end"],
    waiting: ["advance_step", "pause", "simulate_human_takeover", "exercise_fallback", "inject_failure", "end"],
    paused_by_operator: ["resume", "simulate_human_takeover", "end"],
    paused_for_human: ["release_human_takeover", "end"],
    completed: [],
    ended: [],
    failed: ["exercise_fallback", "retry", "end"],
  };
  return matrix[state].includes(action) && !(state === "paused_by_operator" && action === "simulate_human_takeover" && pausedFrom === "queued");
}

function planTransition(run: StoredAutomationRun, definition: StoredAutomationDefinition, action: AutomationRunAction, now: Date): TransitionPlan {
  if (!actionAllowed(run.state, action, run.pausedFromState)) return fail("automation_transition_denied", `Action ${action} is not allowed from ${run.state}.`);
  if (run.currentStepIndex >= definition.steps.length && !["completed", "ended"].includes(run.state)) return fail("automation_transition_denied", "Run progress exceeds the approved definition.");
  const step = definition.steps[run.currentStepIndex];
  const base = {
    nextState: run.state,
    pausedFromState: null as AutomationPausedFromState | null,
    nextEligibleAt: null as Date | null,
    currentStepIndex: run.currentStepIndex,
    completedStepCount: run.completedStepCount,
    attemptCount: run.attemptCount,
    stepIndex: null as number | null,
    stepId: null as string | null,
    eventAttemptNumber: 0,
    outcomeCode: "accepted",
    reasonCode: "operator_requested",
    workItemMode: "none" as TransitionPlan["workItemMode"],
  };
  if (action === "start") return { ...base, nextState: "running", reasonCode: "trigger_accepted" };
  if (action === "pause") return {
    ...base,
    nextState: "paused_by_operator",
    pausedFromState: run.state as AutomationPausedFromState,
    nextEligibleAt: run.nextEligibleAt,
  };
  if (action === "resume") return {
    ...base,
    nextState: run.pausedFromState!,
    nextEligibleAt: run.pausedFromState === "waiting" ? run.nextEligibleAt : null,
    workItemMode: run.openWorkItemId
      ? (run.pausedFromState === "failed" ? "preserve" : "resolve_retry")
      : "none",
  };
  if (action === "simulate_human_takeover") return {
    ...base,
    nextState: "paused_for_human",
    pausedFromState: run.state === "paused_by_operator" ? run.pausedFromState : run.state as AutomationPausedFromState,
    nextEligibleAt: run.state === "waiting" || run.pausedFromState === "waiting" ? run.nextEligibleAt : null,
    outcomeCode: "human_takeover_required",
    reasonCode: "human_takeover",
    workItemMode: run.openWorkItemId ? "preserve" : "create_takeover",
  };
  if (action === "release_human_takeover") return {
    ...base,
    nextState: "paused_by_operator",
    pausedFromState: run.pausedFromState,
    nextEligibleAt: run.pausedFromState === "waiting" ? run.nextEligibleAt : null,
    reasonCode: "human_takeover",
    workItemMode: run.pausedFromState === "failed" ? "acknowledge" : "resolve_human",
  };
  if (action === "end") return {
    ...base,
    nextState: "ended",
    outcomeCode: "ended_by_operator",
    workItemMode: run.openWorkItemId ? "resolve_stop" : "none",
  };
  if (!step) return fail("automation_transition_denied", "A governed current step is required.");
  const stepBase = { ...base, stepIndex: run.currentStepIndex, stepId: step.id };
  if (action === "advance_step") {
    if (run.state === "waiting") {
      if (!run.nextEligibleAt || now.getTime() < run.nextEligibleAt.getTime()) return fail("automation_schedule_denied", "Waiting step is not due.");
      const nextIndex = run.currentStepIndex + 1;
      const completed = nextIndex === definition.steps.length;
      const eventAttemptNumber = step.kind === "wait" ? run.attemptCount : run.attemptCount + 1;
      if (eventAttemptNumber > step.retryMaxAttempts + 1) return fail("automation_retry_exhausted", "Approved retry policy is exhausted.");
      return {
        ...stepBase,
        nextState: completed ? "completed" : "running",
        currentStepIndex: nextIndex,
        completedStepCount: nextIndex,
        attemptCount: 0,
        eventAttemptNumber,
        outcomeCode: completed ? "completed" : "step_completed",
        reasonCode: completed ? "policy_complete" : "step_policy_applied",
      };
    }
    const eventAttemptNumber = run.attemptCount + 1;
    if (eventAttemptNumber > step.retryMaxAttempts + 1) return fail("automation_retry_exhausted", "Approved retry policy is exhausted.");
    if (step.kind === "wait") {
      const nextEligibleAt = new Date(now.getTime() + step.waitSeconds! * 1_000);
      return {
        ...stepBase,
        nextState: "waiting",
        nextEligibleAt,
        attemptCount: eventAttemptNumber,
        eventAttemptNumber,
        outcomeCode: "wait_scheduled",
        reasonCode: "step_policy_applied",
      };
    }
    const nextIndex = run.currentStepIndex + 1;
    const completed = nextIndex === definition.steps.length;
    return {
      ...stepBase,
      nextState: completed ? "completed" : "running",
      currentStepIndex: nextIndex,
      completedStepCount: nextIndex,
      attemptCount: 0,
      eventAttemptNumber,
      outcomeCode: completed ? "completed" : "step_completed",
      reasonCode: completed ? "policy_complete" : "step_policy_applied",
    };
  }
  if (action === "inject_failure") {
    const attempt = run.attemptCount + 1;
    if (attempt > step.retryMaxAttempts + 1) return fail("automation_retry_exhausted", "Approved retry policy is exhausted.");
    return {
      ...stepBase,
      nextState: "failed",
      attemptCount: attempt,
      eventAttemptNumber: attempt,
      outcomeCode: "synthetic_failure",
      reasonCode: "integration_timeout",
      workItemMode: "create_failure",
    };
  }
  if (action === "retry") {
    const attempt = run.attemptCount + 1;
    if (attempt > step.retryMaxAttempts + 1) return fail("automation_retry_exhausted", "Approved retry policy is exhausted.");
    const exponent = attempt - 2;
    const delay = Math.min(step.retryInitialBackoffSeconds * 2 ** exponent, step.retryMaximumBackoffSeconds);
    return {
      ...stepBase,
      nextState: "waiting",
      nextEligibleAt: new Date(now.getTime() + delay * 1_000),
      eventAttemptNumber: attempt,
      outcomeCode: "retry_scheduled",
      reasonCode: "retry_policy_applied",
      workItemMode: "resolve_retry",
    };
  }
  const attempt = run.state === "failed" ? run.attemptCount : run.attemptCount + 1;
  if (attempt > step.retryMaxAttempts + 1) return fail("automation_retry_exhausted", "Approved step policy is exhausted.");
  if (step.fallback === "create_work_item") return {
    ...stepBase,
    nextState: "paused_by_operator",
    pausedFromState: run.state as AutomationPausedFromState,
    nextEligibleAt: run.nextEligibleAt,
    attemptCount: attempt,
    eventAttemptNumber: attempt,
    outcomeCode: "fallback_work_item_created",
    reasonCode: "fallback_policy_applied",
    workItemMode: run.openWorkItemId ? "preserve" : "create_fallback",
  };
  if (step.fallback === "route_to_human") return {
    ...stepBase,
    nextState: "paused_for_human",
    pausedFromState: run.state as AutomationPausedFromState,
    nextEligibleAt: run.nextEligibleAt,
    attemptCount: attempt,
    eventAttemptNumber: attempt,
    outcomeCode: "human_takeover_required",
    reasonCode: "fallback_policy_applied",
    workItemMode: run.openWorkItemId ? "preserve" : "create_fallback",
  };
  return {
    ...stepBase,
    nextState: "ended",
    attemptCount: attempt,
    eventAttemptNumber: attempt,
    outcomeCode: "fallback_stopped_safely",
    reasonCode: "fallback_policy_applied",
    workItemMode: run.openWorkItemId ? "resolve_stop" : "none",
  };
}

function parseStoredResult(value: unknown, expectedRunId?: string): SyntheticAutomationControlResult {
  const data = exactRecord(value, [
    "runId", "eventId", "action", "state", "revision", "currentStepIndex",
    "completedStepCount", "attemptCount", "nextEligibleAt", "openWorkItemId",
    "outcomeCode", "synthetic", "externalDispatchCount", "networkCallCount",
  ], "automation result", "invalid_idempotency_record");
  if (
    (expectedRunId !== undefined && data.runId !== expectedRunId) ||
    !AUTOMATION_RUN_ACTIONS.includes(data.action as AutomationRunAction) ||
    !AUTOMATION_EXECUTION_STATES.includes(data.state as AutomationExecutionState) ||
    data.synthetic !== true || data.externalDispatchCount !== 0 || data.networkCallCount !== 0
  ) return fail("invalid_idempotency_record", "Stored automation result is invalid.");
  return {
    runId: requireId(data.runId, "result run", "invalid_idempotency_record"),
    eventId: requireId(data.eventId, "result event", "invalid_idempotency_record"),
    action: data.action as AutomationRunAction,
    state: data.state as AutomationExecutionState,
    revision: requireInteger(data.revision, "result revision", 2, 1_000_000, "invalid_idempotency_record"),
    currentStepIndex: requireInteger(data.currentStepIndex, "result step", 0, 32, "invalid_idempotency_record"),
    completedStepCount: requireInteger(data.completedStepCount, "result completed", 0, 32, "invalid_idempotency_record"),
    attemptCount: requireInteger(data.attemptCount, "result attempt", 0, 11, "invalid_idempotency_record"),
    nextEligibleAt: data.nextEligibleAt === null ? null : timestampToDate(data.nextEligibleAt, "result nextEligibleAt", "invalid_idempotency_record").toISOString(),
    openWorkItemId: data.openWorkItemId === null ? null : requireId(data.openWorkItemId, "result work item", "invalid_idempotency_record"),
    outcomeCode: requireId(data.outcomeCode, "result outcome", "invalid_idempotency_record"),
    synthetic: true,
    externalDispatchCount: 0,
    networkCallCount: 0,
  };
}

function automationEventFingerprint(input: {
  readonly workspaceId: string;
  readonly runId: string;
  readonly eventId: string;
  readonly revision: number;
  readonly action: AutomationRunAction;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly definitionContentHash: string;
  readonly teamId: string;
  readonly locationId: string;
  readonly auditEventId: string;
  readonly fromState: AutomationExecutionState;
  readonly toState: AutomationExecutionState;
  readonly stepIndex: number | null;
  readonly stepId: string | null;
  readonly attemptNumber: number;
  readonly workItemId: string | null;
  readonly nextEligibleAt: Date | null;
  readonly reasonCode: string;
  readonly outcomeCode: string;
  readonly occurredAt: Date;
  readonly actorUid: string;
}): string {
  return syntheticHmacSha256(JSON.stringify([
    "hemas-connect:automation-run-event-evidence:v1", input.workspaceId, input.runId,
    input.eventId, input.definitionId, input.definitionVersion, input.definitionContentHash,
    input.teamId, input.locationId, input.revision, input.auditEventId, input.action,
    input.fromState, input.toState, input.stepIndex, input.stepId, input.attemptNumber,
    input.workItemId, iso(input.nextEligibleAt), input.reasonCode, input.outcomeCode,
    input.occurredAt.toISOString(), "staff", input.actorUid, 1, true, 0, 0,
  ]));
}

function resultFor(run: StoredAutomationRun, eventId: string, action: AutomationRunAction): SyntheticAutomationControlResult {
  return {
    runId: run.id,
    eventId,
    action,
    state: run.state,
    revision: run.revision,
    currentStepIndex: run.currentStepIndex,
    completedStepCount: run.completedStepCount,
    attemptCount: run.attemptCount,
    nextEligibleAt: iso(run.nextEligibleAt),
    openWorkItemId: run.openWorkItemId,
    outcomeCode: run.outcomeCode,
    synthetic: true,
    externalDispatchCount: 0,
    networkCallCount: 0,
  };
}

function automationResultFingerprint(result: SyntheticAutomationControlResult): string {
  return sha256Hex(serializeAutomationControlResult(result));
}

async function get(transaction: Transaction, reference: DocumentReference): Promise<DocumentSnapshot> {
  return transaction.get(reference);
}

function assertReplayEvidence(input: {
  readonly event: DocumentData;
  readonly eventSecret: DocumentData;
  readonly audit: DocumentData;
  readonly request: SyntheticAutomationControlInput;
  readonly result: SyntheticAutomationControlResult;
  readonly auditEventId: string;
  readonly run: StoredAutomationRun;
  readonly actorUid: string;
  readonly idempotencyId: string;
}): string | null {
  const event = exactRecord(input.event, RUN_EVENT_KEYS, "automation replay event", "idempotency_conflict");
  const secret = exactRecord(input.eventSecret, [
    "workspaceId", "runId", "eventId", "protectedContextRef", "contextFingerprint",
    "schemaVersion", "synthetic",
  ], "automation replay event secret", "idempotency_conflict");
  const fromState = AUTOMATION_EXECUTION_STATES.includes(event.fromState as AutomationExecutionState)
    ? event.fromState as AutomationExecutionState
    : fail("idempotency_conflict", "Replay from-state is invalid.");
  const toState = AUTOMATION_EXECUTION_STATES.includes(event.toState as AutomationExecutionState)
    ? event.toState as AutomationExecutionState
    : fail("idempotency_conflict", "Replay to-state is invalid.");
  const stepId = event.stepId === null ? null : requireId(event.stepId, "event step", "idempotency_conflict");
  const stepIndex = event.stepIndex === null ? null : requireInteger(event.stepIndex, "event step index", 0, 31, "idempotency_conflict");
  const workItemId = event.workItemId === null ? null : requireId(event.workItemId, "event work item", "idempotency_conflict");
  const nextEligibleAt = event.nextEligibleAt === null ? null : timestampToDate(event.nextEligibleAt, "event nextEligibleAt", "idempotency_conflict");
  const attemptNumber = requireInteger(event.attemptNumber, "event attempt", 0, 11, "idempotency_conflict");
  const occurredAt = timestampToDate(event.occurredAt, "event occurredAt", "idempotency_conflict");
  const expectedEvidence = automationEventFingerprint({
    workspaceId: input.request.workspaceId, runId: input.request.runId,
    eventId: input.result.eventId, revision: input.result.revision,
    definitionId: input.run.definitionId, definitionVersion: input.run.definitionVersion,
    definitionContentHash: input.run.definitionContentHash, teamId: input.run.teamId,
    locationId: input.run.locationId, auditEventId: input.auditEventId,
    action: input.request.action, fromState, toState, stepId, attemptNumber,
    stepIndex, workItemId, nextEligibleAt,
    reasonCode: event.reasonCode as string, outcomeCode: input.result.outcomeCode,
    occurredAt, actorUid: input.actorUid,
  });
  if (
    input.result.action !== input.request.action ||
    event.id !== input.result.eventId || event.workspaceId !== input.request.workspaceId ||
    event.runId !== input.request.runId || event.action !== input.request.action ||
    event.definitionId !== input.run.definitionId || event.definitionVersion !== input.run.definitionVersion ||
    event.definitionContentHash !== input.run.definitionContentHash || event.teamId !== input.run.teamId ||
    event.locationId !== input.run.locationId ||
    event.toState !== input.result.state || event.revision !== input.result.revision ||
    iso(nextEligibleAt) !== input.result.nextEligibleAt ||
    event.outcomeCode !== input.result.outcomeCode || event.auditEventId !== input.auditEventId ||
    (stepId === null) !== (stepIndex === null) ||
    event.reasonCode === null || typeof event.reasonCode !== "string" ||
    event.actorKind !== "staff" || event.actorUid !== input.actorUid ||
    event.synthetic !== true || event.externalDispatchCount !== 0 || event.networkCallCount !== 0 ||
    secret.workspaceId !== event.workspaceId || secret.runId !== event.runId ||
    secret.eventId !== event.id || secret.contextFingerprint !== event.evidenceFingerprint ||
    event.evidenceFingerprint !== expectedEvidence ||
    secret.protectedContextRef !== phase5EventProtectedRef("automation", input.result.eventId) ||
    secret.synthetic !== true || secret.schemaVersion !== 1 ||
    input.run.revision < input.result.revision || input.run.updatedAt < occurredAt ||
    (input.run.revision === input.result.revision && (
      input.run.updatedAt.getTime() !== occurredAt.getTime() ||
      input.run.state !== input.result.state || input.run.currentStepIndex !== input.result.currentStepIndex ||
      input.run.completedStepCount !== input.result.completedStepCount || input.run.attemptCount !== input.result.attemptCount ||
      iso(input.run.nextEligibleAt) !== input.result.nextEligibleAt || input.run.openWorkItemId !== input.result.openWorkItemId ||
      input.run.outcomeCode !== input.result.outcomeCode || input.run.lastEventId !== input.result.eventId
    ))
  ) return fail("idempotency_conflict", "Replay evidence is missing or substituted.");
  requireSha256(event.evidenceFingerprint, "event evidence", "idempotency_conflict");
  assertAuditRecord(input.audit, {
    id: input.auditEventId,
    workspaceId: input.request.workspaceId,
    actorUid: input.actorUid,
    action: `automation.${input.request.action}`,
    resourceType: "automation_run",
    resourceId: input.request.runId,
    occurredAt,
    requestId: input.idempotencyId,
    metadata: {
      eventId: input.result.eventId,
      fromState,
      toState,
      revision: input.result.revision,
      outcomeCode: input.result.outcomeCode,
      resultFingerprint: automationResultFingerprint(input.result),
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
    },
  });
  return workItemId;
}

async function assertCurrentRunEvidence(input: {
  readonly db: Firestore;
  readonly transaction: Transaction;
  readonly base: string;
  readonly run: StoredAutomationRun;
}): Promise<void> {
  if (input.run.lastEventId === null) return;
  const eventSnapshot = await get(input.transaction, input.db.doc(`${input.base}/${AUTOMATION_COLLECTIONS.runEvents}/${input.run.lastEventId}`));
  const eventValue = documentData(eventSnapshot, "automation_run_denied", "Current run event is missing.");
  const envelope = exactRecord(eventValue, RUN_EVENT_KEYS, "current automation event", "automation_run_denied");
  if (!AUTOMATION_RUN_ACTIONS.includes(envelope.action as AutomationRunAction) || envelope.actorKind !== "staff") {
    return fail("automation_run_denied", "Current run event actor or action is invalid.");
  }
  const auditEventId = requireId(envelope.auditEventId, "current event audit", "automation_run_denied");
  const actorUid = requireId(envelope.actorUid, "current event actor", "automation_run_denied");
  const [secretSnapshot, auditSnapshot] = await Promise.all([
    get(input.transaction, input.db.doc(`${input.base}/${AUTOMATION_COLLECTIONS.runEventSecrets}/${input.run.lastEventId}`)),
    get(input.transaction, input.db.doc(`${input.base}/auditEvents/${auditEventId}`)),
  ]);
  const auditValue = documentData(auditSnapshot, "automation_run_denied", "Current run audit is missing.");
  const audit = exactRecord(auditValue, AUDIT_KEYS, "current automation audit", "automation_run_denied");
  const auditRequestId = requireId(audit.requestId, "current audit request", "automation_run_denied");
  const action = envelope.action as AutomationRunAction;
  const result = resultFor(input.run, input.run.lastEventId, action);
  const workItemId = assertReplayEvidence({
    event: eventValue,
    eventSecret: documentData(secretSnapshot, "automation_run_denied", "Current run event secret is missing."),
    audit: auditValue,
    request: {
      workspaceId: input.run.workspaceId,
      runId: input.run.id,
      action,
      expectedRevision: Math.max(1, input.run.revision - 1),
      idempotencyKey: "current-run-evidence-only",
    },
    result,
    auditEventId,
    run: input.run,
    actorUid,
    idempotencyId: auditRequestId,
  });
  if (workItemId !== null) {
    const [itemSnapshot, itemSecretSnapshot] = await Promise.all([
      get(input.transaction, input.db.doc(`${input.base}/${AUTOMATION_COLLECTIONS.workItems}/${workItemId}`)),
      get(input.transaction, input.db.doc(`${input.base}/${AUTOMATION_COLLECTIONS.workItemSecrets}/${workItemId}`)),
    ]);
    const item = parseWorkItem(documentData(itemSnapshot, "automation_run_denied", "Current event work item is missing."), input.run, workItemId);
    assertWorkItemSecret(documentData(itemSecretSnapshot, "automation_run_denied", "Current work-item secret is missing."), input.run, item);
  }
}

export async function controlSyntheticAutomationRun(input: {
  readonly db: Firestore;
  readonly config: RuntimeConfig;
  readonly emulator: EmulatorBoundary;
  readonly actor: Phase5Actor;
  readonly request: SyntheticAutomationControlInput;
  readonly now?: Date;
}): Promise<SyntheticAutomationControlResponse> {
  const request = parseSyntheticAutomationControlInput(input.request);
  ensureNoUnexpectedClinicalText(request);
  assertPhase5DemoRuntimeBoundary(input.config, input.emulator, request.workspaceId);
  const now = input.now ?? new Date();
  const requestHash = sha256Hex(JSON.stringify({
    workspaceId: request.workspaceId,
    runId: request.runId,
    action: request.action,
    expectedRevision: request.expectedRevision,
    idempotencyKey: request.idempotencyKey,
  }));
  const actionName = `automation.${request.action}`;
  const idempotencyId = phase5IdempotencyId({
    workspaceId: request.workspaceId,
    actorUid: input.actor.uid,
    action: actionName,
    key: request.idempotencyKey,
  });
  const base = root(request.workspaceId);
  const refs = {
    workspace: input.db.doc(base),
    membership: input.db.doc(`${base}/members/${input.actor.uid}`),
    run: input.db.doc(`${base}/${AUTOMATION_COLLECTIONS.runs}/${request.runId}`),
    runSecret: input.db.doc(`${base}/${AUTOMATION_COLLECTIONS.runSecrets}/${request.runId}`),
    idempotency: input.db.doc(`${base}/idempotencyKeys/${idempotencyId}`),
  };

  return input.db.runTransaction(async (transaction) => {
    const [workspaceSnapshot, membershipSnapshot, runSnapshot, runSecretSnapshot, idempotencySnapshot] = await Promise.all([
      get(transaction, refs.workspace),
      get(transaction, refs.membership),
      get(transaction, refs.run),
      get(transaction, refs.runSecret),
      get(transaction, refs.idempotency),
    ]);
    const run = parseRun(documentData(runSnapshot, "automation_run_denied", "Synthetic run is missing."), {
      workspaceId: request.workspaceId,
      runId: request.runId,
      now,
    });
    const authorization = assertPhase5Authorization({
      workspaceId: request.workspaceId,
      workspace: workspaceSnapshot.data(),
      membership: membershipSnapshot.data(),
      actor: input.actor,
      permission: "automations.control_runs",
      patientScope: { teamId: run.teamId, locationId: run.locationId },
      now,
    });

    const runSecret = parseRunSecret(documentData(runSecretSnapshot, "automation_run_denied", "Run secret is missing."), run);
    const definitionRef = input.db.doc(`${base}/${AUTOMATION_COLLECTIONS.definitions}/${run.definitionId}`);
    const definitionSecretRef = input.db.doc(`${base}/${AUTOMATION_COLLECTIONS.definitionSecrets}/${run.definitionId}`);
    const receiptRef = input.db.doc(`${base}/${AUTOMATION_COLLECTIONS.triggerReceipts}/${runSecret.triggerFingerprint}`);
    const [definitionSnapshot, definitionSecretSnapshot, receiptSnapshot] = await Promise.all([
      get(transaction, definitionRef), get(transaction, definitionSecretRef), get(transaction, receiptRef),
    ]);
    const definition = parseDefinition(documentData(definitionSnapshot, "automation_definition_denied", "Definition is missing."), {
      workspaceId: request.workspaceId,
      definitionId: run.definitionId,
    });
    if (definition.version !== run.definitionVersion || definition.contentHash !== run.definitionContentHash) return fail("automation_definition_denied", "Run is not pinned to the loaded definition.");
    assertDefinitionSecret(documentData(definitionSecretSnapshot, "automation_definition_denied", "Definition secret is missing."), definition);
    const activationRef = input.db.doc(`${base}/${AUTOMATION_COLLECTIONS.activations}/${definition.family}`);
    const activationSnapshot = await get(transaction, activationRef);
    const activation = parseActivation(documentData(activationSnapshot, "automation_activation_denied", "Activation is missing."), definition);
    const activationEventSnapshot = await get(transaction, input.db.doc(`${base}/${AUTOMATION_COLLECTIONS.definitionEvents}/${activation.activationEventId}`));
    const activationEventRevision = assertActivationEvent(documentData(activationEventSnapshot, "automation_activation_denied", "Activation event is missing."), activation);
    const activationAuditSnapshot = await get(transaction, input.db.doc(`${base}/auditEvents/${activation.activationAuditEventId}`));
    assertAuditRecord(documentData(activationAuditSnapshot, "automation_activation_denied", "Activation audit is missing."), {
      id: activation.activationAuditEventId,
      workspaceId: activation.workspaceId,
      actorUid: activation.activatedByUid,
      action: "automation_definition.activate",
      resourceType: "automation_definition",
      resourceId: definition.id,
      occurredAt: activation.activatedAt,
      metadata: {
        eventId: activation.activationEventId,
        revision: activationEventRevision,
        synthetic: true,
        externalDispatchCount: 0,
        networkCallCount: 0,
      },
    });
    assertReceipt(documentData(receiptSnapshot, "automation_receipt_denied", "Trigger receipt is missing."), {
      run, definition, activation, triggerFingerprint: runSecret.triggerFingerprint,
    });
    await assertCurrentRunEvidence({ db: input.db, transaction, base, run });

    const contactId = resolveSyntheticProtectedRef(runSecret.protectedContactRef, "contact");
    const conversationId = resolveSyntheticProtectedRef(runSecret.protectedConversationRef, "conversation");
    const appointmentId = runSecret.protectedAppointmentRef === null ? null : resolveSyntheticProtectedRef(runSecret.protectedAppointmentRef, "appointment");
    if (definition.family === "appointment_service" && appointmentId === null) return fail("protected_reference_denied", "Appointment automation requires its protected appointment reference.");
    if (definition.family === "laboratory_service" && appointmentId !== null) return fail("protected_reference_denied", "Laboratory automation cannot bind an appointment reference.");
    const contactRef = input.db.doc(`${base}/contacts/${contactId}`);
    const conversationRef = input.db.doc(`${base}/conversations/${conversationId}`);
    const teamRef = input.db.doc(`${base}/teams/${run.teamId}`);
    const locationRef = input.db.doc(`${base}/locations/${run.locationId}`);
    const [contactSnapshot, conversationSnapshot, teamSnapshot, locationSnapshot] = await Promise.all([
      get(transaction, contactRef), get(transaction, conversationRef), get(transaction, teamRef), get(transaction, locationRef),
    ]);
    const contact = parseSyntheticContact(documentData(contactSnapshot, "contact_gate_denied", "Contact is missing."), {
      workspaceId: run.workspaceId, contactId, teamId: run.teamId, locationId: run.locationId,
    });
    const conversation = parseSyntheticConversation(documentData(conversationSnapshot, "conversation_gate_denied", "Conversation is missing."), {
      workspaceId: run.workspaceId, conversationId, contactId, teamId: run.teamId, locationId: run.locationId,
    });
    const workItemSlaMinutes = assertSyntheticTeam(teamSnapshot.data(), {
      workspaceId: run.workspaceId, teamId: run.teamId, locationId: run.locationId,
    });
    assertSyntheticLocation(locationSnapshot.data(), { workspaceId: run.workspaceId, locationId: run.locationId });

    if (idempotencySnapshot.exists) {
      const stored = parsePhase5Idempotency(idempotencySnapshot.data(), {
        id: idempotencyId, workspaceId: request.workspaceId, actorUid: authorization.uid,
        action: actionName, purpose: "automation", requestHash, aggregateId: run.id,
        resultParser: (value) => parseStoredResult(value, run.id),
      });
      const [eventSnapshot, secretSnapshot, auditSnapshot] = await Promise.all([
        get(transaction, input.db.doc(`${base}/${AUTOMATION_COLLECTIONS.runEvents}/${stored.eventId}`)),
        get(transaction, input.db.doc(`${base}/${AUTOMATION_COLLECTIONS.runEventSecrets}/${stored.eventId}`)),
        get(transaction, input.db.doc(`${base}/auditEvents/${stored.auditEventId}`)),
      ]);
      const workItemId = assertReplayEvidence({
        event: documentData(eventSnapshot, "idempotency_conflict", "Replay event is missing."),
        eventSecret: documentData(secretSnapshot, "idempotency_conflict", "Replay event secret is missing."),
        audit: documentData(auditSnapshot, "idempotency_conflict", "Replay audit is missing."),
        request, result: stored.result, auditEventId: stored.auditEventId, run,
        actorUid: authorization.uid, idempotencyId,
      });
      if (stored.result.openWorkItemId !== null && workItemId === null) {
        return fail("idempotency_conflict", "Replay result lost its governed work-item evidence.");
      }
      if (workItemId !== null) {
        const [workItemSnapshot, workItemSecretSnapshot] = await Promise.all([
          get(transaction, input.db.doc(`${base}/${AUTOMATION_COLLECTIONS.workItems}/${workItemId}`)),
          get(transaction, input.db.doc(`${base}/${AUTOMATION_COLLECTIONS.workItemSecrets}/${workItemId}`)),
        ]);
        const item = parseWorkItem(documentData(workItemSnapshot, "idempotency_conflict", "Replay work item is missing."), run, workItemId);
        assertWorkItemSecret(documentData(workItemSecretSnapshot, "idempotency_conflict", "Replay work-item secret is missing."), run, item);
      }
      return { result: stored.result, auditEventId: stored.auditEventId, replayed: true };
    }
    if (run.revision !== request.expectedRevision) throw new FailClosedError("automation_revision_conflict", "Automation revision changed.");

    const currentStep = definition.steps[run.currentStepIndex];
    if ((request.action === "start" || request.action === "advance_step") && currentStep) {
      if (contact.suppressAll || contact.invalidContact) return fail("consent_denied", "Contact suppression blocks this automation step.");
      if (conversation.mode !== "automation") return fail("human_takeover_required", "Automation is paused by conversation takeover or safety hold.");
      const consentQuery = input.db.collection(`${base}/consentRecords`)
        .where("contactId", "==", contactId)
        .where("teamId", "==", run.teamId)
        .where("locationId", "==", run.locationId)
        .where("purpose", "==", currentStep.requiredConsentPurpose)
        .where("channel", "==", "whatsapp")
        .where("category", "==", "utility")
        .orderBy("capturedAt", "desc")
        .limit(2);
      const consentSnapshot = await transaction.get(consentQuery);
      assertLatestSyntheticConsent(consentSnapshot.docs.map((document) => document.data()), {
        workspaceId: run.workspaceId, contactId, teamId: run.teamId,
        locationId: run.locationId, purpose: currentStep.requiredConsentPurpose,
      });
      if (request.action === "advance_step" && currentStep.kind === "send_template") {
        const templateSnapshot = await get(transaction, input.db.doc(`${base}/templates/${currentStep.templateVersionId!}`));
        assertSyntheticTemplate(documentData(templateSnapshot, "template_binding_denied", "Template is missing."), {
          workspaceId: run.workspaceId,
          templateId: currentStep.templateVersionId!,
          contentHash: currentStep.templateContentHash!,
          category: "utility",
          language: contact.preferredLanguage,
        });
        const inWindow = conversation.serviceWindowExpiresAt !== null && now.getTime() <= conversation.serviceWindowExpiresAt.getTime();
        if (!inWindow && currentStep.serviceWindowBehavior !== "use_approved_template") return fail("service_window_denied", "Approved step policy prohibits an out-of-window send.");
      }
      if (request.action === "advance_step" && currentStep.kind === "request_appointment_action") {
        const appointmentSnapshot = await get(transaction, input.db.doc(`${base}/appointments/${appointmentId!}`));
        parseStoredSyntheticAppointment(documentData(appointmentSnapshot, "appointment_denied", "Appointment is missing."), {
          workspaceId: run.workspaceId, appointmentId: appointmentId!, teamId: run.teamId, locationId: run.locationId,
        });
      }
    }

    const transition = planTransition(run, definition, request.action, now);
    const nextRevision = run.revision + 1;
    const eventId = deterministicId("automation-event", `${run.workspaceId}:${run.id}:${nextRevision}:${request.action}:${request.idempotencyKey}`);
    const willCreateWorkItem = ["create_failure", "create_fallback", "create_takeover"].includes(transition.workItemMode);
    const workItemId = willCreateWorkItem
      ? deterministicId("automation-work-item", `${run.workspaceId}:${run.id}:${eventId}`)
      : run.openWorkItemId;
    if (transition.workItemMode !== "none" && workItemId === null) return fail("automation_work_item_denied", "Transition requires one exact work item.");
    const eventRef = input.db.doc(`${base}/${AUTOMATION_COLLECTIONS.runEvents}/${eventId}`);
    const eventSecretRef = input.db.doc(`${base}/${AUTOMATION_COLLECTIONS.runEventSecrets}/${eventId}`);
    const workItemRef = workItemId === null ? null : input.db.doc(`${base}/${AUTOMATION_COLLECTIONS.workItems}/${workItemId}`);
    const workItemSecretRef = workItemId === null ? null : input.db.doc(`${base}/${AUTOMATION_COLLECTIONS.workItemSecrets}/${workItemId}`);
    const [eventCollision, secretCollision, workItemSnapshot, workItemSecretSnapshot] = await Promise.all([
      get(transaction, eventRef),
      get(transaction, eventSecretRef),
      workItemRef ? get(transaction, workItemRef) : Promise.resolve(null),
      workItemSecretRef ? get(transaction, workItemSecretRef) : Promise.resolve(null),
    ]);
    if (eventCollision.exists || secretCollision.exists) throw new FailClosedError("automation_event_collision", "Deterministic automation event already exists without replay evidence.");
    let existingWorkItem: StoredWorkItem | null = null;
    if (workItemId !== null) {
      if (willCreateWorkItem) {
        if (workItemSnapshot?.exists || workItemSecretSnapshot?.exists) throw new FailClosedError("automation_work_item_collision", "Deterministic work item already exists.");
      } else {
        existingWorkItem = parseWorkItem(documentData(workItemSnapshot!, "automation_work_item_denied", "Open work item is missing."), run, workItemId);
        assertWorkItemSecret(documentData(workItemSecretSnapshot!, "automation_work_item_denied", "Work-item secret projection is missing."), run, existingWorkItem);
      }
    }

    const nextOpenWorkItemId = ["resolve_retry", "resolve_human", "resolve_stop"].includes(transition.workItemMode)
      ? null
      : workItemId;
    const nextRun: StoredAutomationRun = {
      ...run,
      state: transition.nextState,
      pausedFromState: transition.pausedFromState,
      nextEligibleAt: transition.nextEligibleAt,
      openWorkItemId: nextOpenWorkItemId,
      currentStepIndex: transition.currentStepIndex,
      completedStepCount: transition.completedStepCount,
      attemptCount: transition.attemptCount,
      revision: nextRevision,
      outcomeCode: transition.outcomeCode,
      lastEventId: eventId,
      updatedAt: now,
    };
    const result = resultFor(nextRun, eventId, request.action);
    const auditEvent = createTenantAuditEvent({
      tenantId: run.workspaceId,
      actor: { type: "user", id: authorization.uid },
      action: actionName,
      resource: { type: "automation_run", id: run.id },
      outcome: "allowed",
      requestId: idempotencyId,
      occurredAt: now,
      metadata: {
        eventId,
        fromState: run.state,
        toState: nextRun.state,
        revision: nextRevision,
        outcomeCode: nextRun.outcomeCode,
        resultFingerprint: automationResultFingerprint(result),
        synthetic: true,
        externalDispatchCount: 0,
        networkCallCount: 0,
      },
    });
    const evidenceFingerprint = automationEventFingerprint({
      workspaceId: run.workspaceId, runId: run.id, eventId,
      definitionId: run.definitionId, definitionVersion: run.definitionVersion,
      definitionContentHash: run.definitionContentHash, teamId: run.teamId,
      locationId: run.locationId, revision: nextRevision, auditEventId: auditEvent.id,
      action: request.action, fromState: run.state, toState: nextRun.state,
      stepIndex: transition.stepIndex, stepId: transition.stepId,
      attemptNumber: transition.eventAttemptNumber, workItemId,
      nextEligibleAt: nextRun.nextEligibleAt, reasonCode: transition.reasonCode,
      outcomeCode: transition.outcomeCode, occurredAt: now, actorUid: authorization.uid,
    });
    const auditRef = input.db.doc(`${base}/auditEvents/${auditEvent.id}`);
    const auditCollision = await get(transaction, auditRef);
    if (auditCollision.exists) throw new FailClosedError("automation_audit_collision", "Deterministic audit event already exists.");

    transaction.update(refs.run, {
      state: nextRun.state,
      pausedFromState: nextRun.pausedFromState,
      nextEligibleAt: nextRun.nextEligibleAt,
      openWorkItemId: nextRun.openWorkItemId,
      currentStepIndex: nextRun.currentStepIndex,
      completedStepCount: nextRun.completedStepCount,
      attemptCount: nextRun.attemptCount,
      revision: nextRun.revision,
      outcomeCode: nextRun.outcomeCode,
      lastEventId: eventId,
      updatedAt: now,
    });
    transaction.create(eventRef, {
      id: eventId,
      workspaceId: run.workspaceId,
      runId: run.id,
      definitionId: run.definitionId,
      definitionVersion: run.definitionVersion,
      definitionContentHash: run.definitionContentHash,
      teamId: run.teamId,
      locationId: run.locationId,
      revision: nextRevision,
      auditEventId: auditEvent.id,
      action: request.action,
      fromState: run.state,
      toState: nextRun.state,
      stepIndex: transition.stepIndex,
      stepId: transition.stepId,
      attemptNumber: transition.eventAttemptNumber,
      workItemId,
      nextEligibleAt: nextRun.nextEligibleAt,
      reasonCode: transition.reasonCode,
      evidenceFingerprint,
      outcomeCode: transition.outcomeCode,
      occurredAt: now,
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
      actorKind: "staff",
      actorUid: authorization.uid,
    });
    transaction.create(eventSecretRef, {
      workspaceId: run.workspaceId,
      runId: run.id,
      eventId,
      protectedContextRef: phase5EventProtectedRef("automation", eventId),
      contextFingerprint: evidenceFingerprint,
      schemaVersion: 1,
      synthetic: true,
    });

    if (workItemRef && workItemSecretRef && workItemId) {
      if (willCreateWorkItem) {
        const reasonCode = transition.workItemMode === "create_failure"
          ? "integration_timeout"
          : transition.workItemMode === "create_takeover"
            ? "human_takeover"
            : "fallback_route";
        transaction.create(workItemRef, {
          id: workItemId,
          workspaceId: run.workspaceId,
          runId: run.id,
          definitionId: run.definitionId,
          definitionVersion: run.definitionVersion,
          definitionContentHash: run.definitionContentHash,
          teamId: run.teamId,
          locationId: run.locationId,
          reasonCode,
          state: "open",
          openedAt: now,
          slaMinutes: workItemSlaMinutes,
          dueAt: new Date(now.getTime() + workItemSlaMinutes * 60_000),
          assignedMemberUid: null,
          acknowledgedAt: null,
          acknowledgedByUid: null,
          resolvedAt: null,
          resolvedByUid: null,
          resolutionCode: null,
          revision: 1,
          lastEventId: eventId,
          schemaVersion: 1,
          synthetic: true,
          externalDispatchCount: 0,
          networkCallCount: 0,
          createdAt: now,
          updatedAt: now,
        });
        transaction.create(workItemSecretRef, {
          workspaceId: run.workspaceId,
          runId: run.id,
          workItemId,
          protectedContextRef: phase5WorkItemProtectedRef(workItemId),
          contextFingerprint: sha256Hex(JSON.stringify([run.workspaceId, run.id, workItemId, reasonCode])),
          schemaVersion: 1,
          synthetic: true,
        });
      } else {
        const item = existingWorkItem!;
        const update: Record<string, unknown> = {
          revision: item.revision + 1,
          lastEventId: eventId,
          updatedAt: now,
        };
        if (transition.workItemMode === "acknowledge") {
          if (item.state === "resolved") return fail("automation_work_item_denied", "Resolved work item cannot be acknowledged again.");
          update.state = "acknowledged";
          update.acknowledgedAt = item.acknowledgedAt ?? now;
          update.acknowledgedByUid = item.acknowledgedByUid ?? authorization.uid;
        } else if (["resolve_retry", "resolve_human", "resolve_stop"].includes(transition.workItemMode)) {
          if (item.state === "resolved") return fail("automation_work_item_denied", "Resolved work item cannot be resolved again.");
          update.state = "resolved";
          update.acknowledgedAt = item.acknowledgedAt ?? now;
          update.acknowledgedByUid = item.acknowledgedByUid ?? authorization.uid;
          update.resolvedAt = now;
          update.resolvedByUid = authorization.uid;
          update.resolutionCode = transition.workItemMode === "resolve_retry"
            ? "retried"
            : transition.workItemMode === "resolve_human"
              ? "routed_to_human"
              : "stopped_safely";
        }
        transaction.update(workItemRef, update);
      }
    }
    transaction.create(auditRef, toFirestoreAuditRecord(auditEvent));
    transaction.create(refs.idempotency, {
      id: idempotencyId,
      workspaceId: run.workspaceId,
      actorUid: authorization.uid,
      action: actionName,
      purpose: "automation",
      requestHash,
      aggregateId: run.id,
      eventId,
      result: {
        ...result,
        nextEligibleAt: result.nextEligibleAt === null ? null : new Date(result.nextEligibleAt),
      },
      auditEventId: auditEvent.id,
      createdAt: now,
      synthetic: true,
      schemaVersion: 1,
    });
    return { result, auditEventId: auditEvent.id, replayed: false };
  });
}
