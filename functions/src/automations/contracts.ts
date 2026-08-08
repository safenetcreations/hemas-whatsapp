import { createHash, createHmac } from "node:crypto";
import type { RuntimeConfig } from "../config.js";
import { FailClosedError, assertSafeTenantId } from "../errors.js";

export const SYNTHETIC_PHASE5_WORKSPACE_ID = "workspace_safenet_demo" as const;
export const SYNTHETIC_PHASE5_PROJECT_ID = "demo-hemas-connect" as const;
export const SYNTHETIC_RECEIPT_HMAC_KEY =
  "PUBLIC-SYNTHETIC-TEST-KEY-NOT-A-SECRET" as const;

export const AUTOMATION_DEFINITION_CONTENT_PREFIX =
  "hemas-connect:automation-definition-content:v1" as const;
export const AUTOMATION_DEFINITION_APPROVAL_PREFIX =
  "hemas-connect:automation-definition-approval:v1" as const;
export const AUTOMATION_DEFINITION_SECRET_BINDING_PREFIX =
  "hemas-connect:automation-definition-secret:v1" as const;
export const AUTOMATION_SOURCE_EVENT_PREFIX =
  "hemas-connect:automation-source-event:v1" as const;
export const AUTOMATION_TRIGGER_RECEIPT_KEY_PREFIX =
  "hemas-connect:automation-trigger-receipt-key:v2" as const;
export const AUTOMATION_TRIGGER_RECEIPT_PAYLOAD_PREFIX =
  "hemas-connect:automation-trigger-receipt-payload:v2" as const;
export const AUTOMATION_CONTROL_RESULT_PREFIX =
  "hemas-connect:automation-control-result:v1" as const;

export const EXECUTABLE_AUTOMATION_FAMILIES = [
  "appointment_service",
  "laboratory_service",
] as const;
export type ExecutableAutomationFamily =
  (typeof EXECUTABLE_AUTOMATION_FAMILIES)[number];

export const AUTOMATION_RUN_ACTIONS = [
  "start",
  "advance_step",
  "pause",
  "resume",
  "simulate_human_takeover",
  "release_human_takeover",
  "exercise_fallback",
  "inject_failure",
  "retry",
  "end",
] as const;
export type AutomationRunAction = (typeof AUTOMATION_RUN_ACTIONS)[number];

export const AUTOMATION_EXECUTION_STATES = [
  "queued",
  "running",
  "waiting",
  "paused_by_operator",
  "paused_for_human",
  "completed",
  "ended",
  "failed",
] as const;
export type AutomationExecutionState =
  (typeof AUTOMATION_EXECUTION_STATES)[number];
export type AutomationPausedFromState = "queued" | "running" | "waiting" | "failed";

export type ConsentPurpose =
  | "appointment_service"
  | "laboratory_service"
  | "care_pathway"
  | "feedback"
  | "health_campaigns"
  | "event_campaigns"
  | "transactional_updates";
export type AutomationTrigger =
  | "inbound_intent"
  | "appointment_event"
  | "lims_report_ready"
  | "discharge_event"
  | "scheduled_time"
  | "campaign_response"
  | "agent_action";

export interface AuthoritativeAutomationStep {
  readonly id: string;
  readonly kind:
    | "send_template"
    | "wait"
    | "request_appointment_action"
    | "route_to_team"
    | "stop";
  readonly templateVersionId: string | null;
  readonly templateContentHash: string | null;
  readonly waitSeconds: number | null;
  readonly appointmentAction: "confirm" | "reschedule" | "cancel" | null;
  readonly routeTeamId: string | null;
  readonly stopReasonCode:
    | "policy_complete"
    | "consent_unavailable"
    | "service_window_closed"
    | "synthetic_safe_stop"
    | null;
  readonly requiredConsentPurpose: ConsentPurpose;
  readonly serviceWindowBehavior:
    | "send_in_window"
    | "use_approved_template"
    | "do_not_send";
  readonly timeoutSeconds: number;
  readonly retryMaxAttempts: number;
  readonly retryInitialBackoffSeconds: number;
  readonly retryMaximumBackoffSeconds: number;
  readonly fallback: "create_work_item" | "route_to_human" | "stop_run";
}

export interface AutomationDefinitionContentBinding {
  readonly workspaceId: string;
  readonly definitionId: string;
  readonly family:
    | ExecutableAutomationFamily
    | "care_pathway"
    | "feedback"
    | "inbound_routing"
    | "campaign_response"
    | "scheduled_service";
  readonly version: number;
  readonly name: string;
  readonly trigger: AutomationTrigger;
  readonly consentPurpose: ConsentPurpose;
  readonly riskLevel: "low" | "medium" | "high";
  readonly steps: readonly AuthoritativeAutomationStep[];
  readonly secretBindingHash: string;
  readonly synthetic: true;
}

export interface AutomationDefinitionApprovalBinding {
  readonly workspaceId: string;
  readonly definitionId: string;
  readonly contentHash: string;
  readonly ownerUid: string;
  readonly approverUid: string;
  readonly scope: "simulation_only";
  readonly approvedAt: string;
}

export interface AutomationDefinitionSecretBinding {
  readonly workspaceId: string;
  readonly definitionId: string;
  readonly protectedConfigurationRef: string;
  readonly configurationFingerprint: string;
  readonly schemaVersion: 1;
  readonly synthetic: true;
}

export interface AutomationSourceEventIdentityBinding {
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly eventKind: AutomationTrigger;
  readonly sourceEventId: string;
}

export interface AutomationTriggerReceiptKeyBinding {
  readonly workspaceId: string;
  readonly family: ExecutableAutomationFamily;
  readonly sourceEventFingerprint: string;
}

export interface AutomationTriggerReceiptPayloadBinding {
  readonly receiptId: string;
  readonly triggerFingerprint: string;
  readonly workspaceId: string;
  readonly family: ExecutableAutomationFamily;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly definitionContentHash: string;
  readonly definitionApprovalHash: string;
  readonly activationEventId: string;
  readonly sourceEventFingerprint: string;
  readonly runId: string;
  readonly createdAt: string;
  readonly schemaVersion: 1;
  readonly synthetic: true;
}

export interface SyntheticAutomationControlInput {
  readonly workspaceId: string;
  readonly runId: string;
  readonly action: AutomationRunAction;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
}

export interface SyntheticAutomationControlResult {
  readonly runId: string;
  readonly eventId: string;
  readonly action: AutomationRunAction;
  readonly state: AutomationExecutionState;
  readonly revision: number;
  readonly currentStepIndex: number;
  readonly completedStepCount: number;
  readonly attemptCount: number;
  readonly nextEligibleAt: string | null;
  readonly openWorkItemId: string | null;
  readonly outcomeCode: string;
  readonly synthetic: true;
  readonly externalDispatchCount: 0;
  readonly networkCallCount: 0;
}

export interface SyntheticAutomationControlResponse {
  readonly result: SyntheticAutomationControlResult;
  readonly auditEventId: string;
  readonly replayed: boolean;
}

export function serializeAutomationControlResult(input: SyntheticAutomationControlResult): string {
  const data = exactRecord(input, [
    "runId", "eventId", "action", "state", "revision", "currentStepIndex",
    "completedStepCount", "attemptCount", "nextEligibleAt", "openWorkItemId",
    "outcomeCode", "synthetic", "externalDispatchCount", "networkCallCount",
  ], "automation control result", "invalid_governance_binding");
  if (!AUTOMATION_RUN_ACTIONS.includes(data.action as AutomationRunAction) || !AUTOMATION_EXECUTION_STATES.includes(data.state as AutomationExecutionState)) {
    return fail("invalid_governance_binding", "automation result action/state is invalid.");
  }
  const nextEligibleAt = data.nextEligibleAt === null ? null : requireIsoDateTime(data.nextEligibleAt, "nextEligibleAt");
  const openWorkItemId = data.openWorkItemId === null ? null : requireId(data.openWorkItemId, "openWorkItemId", "invalid_governance_binding");
  if (data.synthetic !== true || data.externalDispatchCount !== 0 || data.networkCallCount !== 0) return fail("invalid_governance_binding", "automation result safety counters are invalid.");
  return JSON.stringify([
    AUTOMATION_CONTROL_RESULT_PREFIX,
    requireId(data.runId, "runId", "invalid_governance_binding"),
    requireId(data.eventId, "eventId", "invalid_governance_binding"),
    data.action, data.state,
    requireInteger(data.revision, "revision", 2, 999_999, "invalid_governance_binding"),
    requireInteger(data.currentStepIndex, "currentStepIndex", 0, 32, "invalid_governance_binding"),
    requireInteger(data.completedStepCount, "completedStepCount", 0, 32, "invalid_governance_binding"),
    requireInteger(data.attemptCount, "attemptCount", 0, 11, "invalid_governance_binding"),
    nextEligibleAt, openWorkItemId,
    requireId(data.outcomeCode, "outcomeCode", "invalid_governance_binding"),
    true, 0, 0,
  ]);
}

export const AUTOMATION_COLLECTIONS = Object.freeze({
  definitions: "automationDefinitions",
  activations: "automationActivations",
  definitionEvents: "automationDefinitionEvents",
  definitionSecrets: "automationDefinitionSecrets",
  triggerReceipts: "automationTriggerReceipts",
  runs: "automationRuns",
  runSecrets: "automationRunSecrets",
  runEvents: "automationRunEvents",
  runEventSecrets: "automationRunEventSecrets",
  workItems: "automationWorkItems",
  workItemSecrets: "automationWorkItemSecrets",
});

export const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
export const SHA256 = /^[a-f0-9]{64}$/;
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PROTECTED_REF = /^(?:demo|encrypted):\/\/[A-Za-z0-9][A-Za-z0-9._:/-]{5,500}$/;

export function fail(code: string, message: string): never {
  throw new FailClosedError(code, message);
}

export function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
  code = "invalid_phase5_record",
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail(code, `${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return fail(code, `${label} must be a plain object.`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) {
    return fail(code, `${label} contains an unsupported key.`);
  }
  const actual = (ownKeys as string[]).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    return fail(code, `${label} fields are invalid.`);
  }
  return value as Record<string, unknown>;
}

export function requireId(value: unknown, label: string, code = "invalid_phase5_record"): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) return fail(code, `${label} is invalid.`);
  return value;
}

export function requireSha256(
  value: unknown,
  label: string,
  code = "invalid_phase5_record",
): string {
  if (typeof value !== "string" || !SHA256.test(value)) return fail(code, `${label} is invalid.`);
  return value;
}

export function requireProtectedRef(
  value: unknown,
  label: string,
  code = "invalid_phase5_record",
): string {
  if (typeof value !== "string" || !PROTECTED_REF.test(value)) return fail(code, `${label} is invalid.`);
  return value;
}

export function requireInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  code = "invalid_phase5_record",
): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    return fail(code, `${label} is invalid.`);
  }
  return value as number;
}

export function requireBoundedString(
  value: unknown,
  label: string,
  maximum: number,
  code = "invalid_phase5_record",
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return fail(code, `${label} is invalid.`);
  }
  return value;
}

export function timestampToDate(
  value: unknown,
  label: string,
  code = "invalid_phase5_record",
): Date {
  if (value instanceof Date && Number.isFinite(value.getTime())) return new Date(value.getTime());
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const date = value.toDate();
    if (date instanceof Date && Number.isFinite(date.getTime())) return new Date(date.getTime());
  }
  return fail(code, `${label} must be a native Firestore timestamp.`);
}

export function requireIsoDateTime(
  value: unknown,
  label: string,
  code = "invalid_governance_binding",
): string {
  if (typeof value !== "string") return fail(code, `${label} is invalid.`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return fail(code, `${label} is invalid.`);
  }
  return value;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function syntheticHmacSha256(value: string): string {
  return createHmac("sha256", SYNTHETIC_RECEIPT_HMAC_KEY)
    .update(value, "utf8")
    .digest("hex");
}

export function assertPhase5DemoRuntimeBoundary(
  config: RuntimeConfig,
  boundary: { readonly projectId: string; readonly firestoreEmulatorHost: string | undefined },
  workspaceId: string,
): void {
  assertSafeTenantId(workspaceId);
  if (
    workspaceId !== SYNTHETIC_PHASE5_WORKSPACE_ID ||
    config.runtimeMode !== "demo" ||
    config.defaultTenantId !== workspaceId ||
    config.providerMode !== "synthetic" ||
    config.hemasIntegrationMode !== "synthetic" ||
    config.auditSinkMode !== "durable" ||
    config.outboundEnabled ||
    !config.approvalGateRequired ||
    config.diagnosisEnabled ||
    boundary.projectId !== SYNTHETIC_PHASE5_PROJECT_ID ||
    !boundary.firestoreEmulatorHost
  ) {
    return fail("phase5_service_disabled", "Phase 5 controls are restricted to the synthetic emulator boundary.");
  }
  const normalized = boundary.firestoreEmulatorHost.includes("://")
    ? boundary.firestoreEmulatorHost
    : `http://${boundary.firestoreEmulatorHost}`;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return fail("phase5_service_disabled", "A loopback Firestore emulator is required.");
  }
  if (
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    !/^\d{1,5}$/.test(url.port) ||
    Number(url.port) < 1 ||
    Number(url.port) > 65_535 ||
    url.username ||
    url.password ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search ||
    url.hash
  ) {
    return fail("phase5_service_disabled", "A loopback Firestore emulator is required.");
  }
}

const STEP_KEYS = [
  "id",
  "kind",
  "templateVersionId",
  "templateContentHash",
  "waitSeconds",
  "appointmentAction",
  "routeTeamId",
  "stopReasonCode",
  "requiredConsentPurpose",
  "serviceWindowBehavior",
  "timeoutSeconds",
  "retryMaxAttempts",
  "retryInitialBackoffSeconds",
  "retryMaximumBackoffSeconds",
  "fallback",
] as const;
const STEP_KINDS = new Set(["send_template", "wait", "request_appointment_action", "route_to_team", "stop"]);
const CONSENT_PURPOSES = new Set<ConsentPurpose>([
  "appointment_service", "laboratory_service", "care_pathway", "feedback",
  "health_campaigns", "event_campaigns", "transactional_updates",
]);
const TRIGGERS = new Set<AutomationTrigger>([
  "inbound_intent", "appointment_event", "lims_report_ready", "discharge_event",
  "scheduled_time", "campaign_response", "agent_action",
]);

export function parseAuthoritativeAutomationStep(value: unknown, index: number): AuthoritativeAutomationStep {
  const data = exactRecord(value, STEP_KEYS, `automation step ${index}`, "invalid_governance_binding");
  const id = requireId(data.id, `automation step ${index} id`, "invalid_governance_binding");
  if (typeof data.kind !== "string" || !STEP_KINDS.has(data.kind)) {
    return fail("invalid_governance_binding", `automation step ${index} kind is invalid.`);
  }
  if (typeof data.requiredConsentPurpose !== "string" || !CONSENT_PURPOSES.has(data.requiredConsentPurpose as ConsentPurpose)) {
    return fail("invalid_governance_binding", `automation step ${index} consent purpose is invalid.`);
  }
  if (!["send_in_window", "use_approved_template", "do_not_send"].includes(data.serviceWindowBehavior as string)) {
    return fail("invalid_governance_binding", `automation step ${index} service-window policy is invalid.`);
  }
  if (!["create_work_item", "route_to_human", "stop_run"].includes(data.fallback as string)) {
    return fail("invalid_governance_binding", `automation step ${index} fallback is invalid.`);
  }
  const timeoutSeconds = requireInteger(data.timeoutSeconds, "timeoutSeconds", 1, 86_400, "invalid_governance_binding");
  const retryMaxAttempts = requireInteger(data.retryMaxAttempts, "retryMaxAttempts", 0, 10, "invalid_governance_binding");
  const retryInitialBackoffSeconds = requireInteger(data.retryInitialBackoffSeconds, "retryInitialBackoffSeconds", 0, 86_400, "invalid_governance_binding");
  const retryMaximumBackoffSeconds = requireInteger(data.retryMaximumBackoffSeconds, "retryMaximumBackoffSeconds", 0, 86_400, "invalid_governance_binding");
  if (
    retryMaximumBackoffSeconds < retryInitialBackoffSeconds ||
    (retryMaxAttempts === 0 && (retryInitialBackoffSeconds !== 0 || retryMaximumBackoffSeconds !== 0))
  ) {
    return fail("invalid_governance_binding", `automation step ${index} retry policy is invalid.`);
  }
  const nullableId = (item: unknown, label: string): string | null =>
    item === null ? null : requireId(item, label, "invalid_governance_binding");
  const nullableSha = (item: unknown, label: string): string | null =>
    item === null ? null : requireSha256(item, label, "invalid_governance_binding");
  const step = {
    id,
    kind: data.kind,
    templateVersionId: nullableId(data.templateVersionId, "templateVersionId"),
    templateContentHash: nullableSha(data.templateContentHash, "templateContentHash"),
    waitSeconds: data.waitSeconds === null ? null : requireInteger(data.waitSeconds, "waitSeconds", 1, 31_536_000, "invalid_governance_binding"),
    appointmentAction: data.appointmentAction,
    routeTeamId: nullableId(data.routeTeamId, "routeTeamId"),
    stopReasonCode: data.stopReasonCode,
    requiredConsentPurpose: data.requiredConsentPurpose,
    serviceWindowBehavior: data.serviceWindowBehavior,
    timeoutSeconds,
    retryMaxAttempts,
    retryInitialBackoffSeconds,
    retryMaximumBackoffSeconds,
    fallback: data.fallback,
  } as AuthoritativeAutomationStep;
  const only = (...values: unknown[]) => values.every((item) => item === null);
  if (
    (step.kind === "send_template" && (!step.templateVersionId || !step.templateContentHash || !only(step.waitSeconds, step.appointmentAction, step.routeTeamId, step.stopReasonCode))) ||
    (step.kind === "wait" && (step.waitSeconds === null || !only(step.templateVersionId, step.templateContentHash, step.appointmentAction, step.routeTeamId, step.stopReasonCode))) ||
    (step.kind === "request_appointment_action" && (!["confirm", "reschedule", "cancel"].includes(step.appointmentAction ?? "") || !only(step.templateVersionId, step.templateContentHash, step.waitSeconds, step.routeTeamId, step.stopReasonCode))) ||
    (step.kind === "route_to_team" && (!step.routeTeamId || !only(step.templateVersionId, step.templateContentHash, step.waitSeconds, step.appointmentAction, step.stopReasonCode))) ||
    (step.kind === "stop" && (!["policy_complete", "consent_unavailable", "service_window_closed", "synthetic_safe_stop"].includes(step.stopReasonCode ?? "") || !only(step.templateVersionId, step.templateContentHash, step.waitSeconds, step.appointmentAction, step.routeTeamId)))
  ) {
    return fail("invalid_governance_binding", `automation step ${index} kind fields are invalid.`);
  }
  return step;
}

export function serializeAutomationDefinitionSecretBinding(input: AutomationDefinitionSecretBinding): string {
  const data = exactRecord(input, [
    "workspaceId", "definitionId", "protectedConfigurationRef",
    "configurationFingerprint", "schemaVersion", "synthetic",
  ], "automation definition secret", "invalid_governance_binding");
  const workspaceId = requireId(data.workspaceId, "workspaceId", "invalid_governance_binding");
  const definitionId = requireId(data.definitionId, "definitionId", "invalid_governance_binding");
  const protectedConfigurationRef = requireProtectedRef(data.protectedConfigurationRef, "protectedConfigurationRef", "invalid_governance_binding");
  const configurationFingerprint = requireSha256(data.configurationFingerprint, "configurationFingerprint", "invalid_governance_binding");
  if (data.schemaVersion !== 1 || data.synthetic !== true) return fail("invalid_governance_binding", "automation definition secret version is invalid.");
  return JSON.stringify([
    AUTOMATION_DEFINITION_SECRET_BINDING_PREFIX, workspaceId, definitionId,
    protectedConfigurationRef, configurationFingerprint, 1, true,
  ]);
}

export function serializeAutomationDefinitionContent(input: AutomationDefinitionContentBinding): string {
  const data = exactRecord(input, [
    "workspaceId", "definitionId", "family", "version", "name", "trigger",
    "consentPurpose", "riskLevel", "steps", "secretBindingHash", "synthetic",
  ], "automation definition content", "invalid_governance_binding");
  const workspaceId = requireId(data.workspaceId, "workspaceId", "invalid_governance_binding");
  const definitionId = requireId(data.definitionId, "definitionId", "invalid_governance_binding");
  if (typeof data.family !== "string" || ![
    ...EXECUTABLE_AUTOMATION_FAMILIES, "care_pathway", "feedback", "inbound_routing",
    "campaign_response", "scheduled_service",
  ].includes(data.family as never)) return fail("invalid_governance_binding", "automation family is invalid.");
  const version = requireInteger(data.version, "version", 1, 1_000_000, "invalid_governance_binding");
  const name = requireBoundedString(data.name, "name", 160, "invalid_governance_binding");
  if (typeof data.trigger !== "string" || !TRIGGERS.has(data.trigger as AutomationTrigger)) return fail("invalid_governance_binding", "automation trigger is invalid.");
  if (typeof data.consentPurpose !== "string" || !CONSENT_PURPOSES.has(data.consentPurpose as ConsentPurpose)) return fail("invalid_governance_binding", "automation consent purpose is invalid.");
  if (!["low", "medium", "high"].includes(data.riskLevel as string)) return fail("invalid_governance_binding", "automation risk is invalid.");
  if (!Array.isArray(data.steps) || data.steps.length < 1 || data.steps.length > 32) return fail("invalid_governance_binding", "automation steps are invalid.");
  const steps = data.steps.map(parseAuthoritativeAutomationStep);
  if (new Set(steps.map((step) => step.id)).size !== steps.length) return fail("invalid_governance_binding", "automation step identifiers must be unique.");
  const secretBindingHash = requireSha256(data.secretBindingHash, "secretBindingHash", "invalid_governance_binding");
  if (data.synthetic !== true) return fail("invalid_governance_binding", "automation definition must be synthetic.");
  return JSON.stringify([
    AUTOMATION_DEFINITION_CONTENT_PREFIX, workspaceId, definitionId, data.family, version,
    name, data.trigger, data.consentPurpose, data.riskLevel,
    steps.map((step) => [
      step.id, step.kind, step.templateVersionId, step.templateContentHash,
      step.waitSeconds, step.appointmentAction, step.routeTeamId, step.stopReasonCode,
      step.requiredConsentPurpose, step.serviceWindowBehavior, step.timeoutSeconds,
      step.retryMaxAttempts, step.retryInitialBackoffSeconds,
      step.retryMaximumBackoffSeconds, step.fallback,
    ]),
    secretBindingHash, true,
  ]);
}

export function serializeAutomationDefinitionApproval(input: AutomationDefinitionApprovalBinding): string {
  const data = exactRecord(input, [
    "workspaceId", "definitionId", "contentHash", "ownerUid", "approverUid",
    "scope", "approvedAt",
  ], "automation definition approval", "invalid_governance_binding");
  const workspaceId = requireId(data.workspaceId, "workspaceId", "invalid_governance_binding");
  const definitionId = requireId(data.definitionId, "definitionId", "invalid_governance_binding");
  const contentHash = requireSha256(data.contentHash, "contentHash", "invalid_governance_binding");
  const ownerUid = requireId(data.ownerUid, "ownerUid", "invalid_governance_binding");
  const approverUid = requireId(data.approverUid, "approverUid", "invalid_governance_binding");
  if (ownerUid === approverUid || data.scope !== "simulation_only") return fail("invalid_governance_binding", "automation approval separation is invalid.");
  const approvedAt = requireIsoDateTime(data.approvedAt, "approvedAt");
  return JSON.stringify([
    AUTOMATION_DEFINITION_APPROVAL_PREFIX, workspaceId, definitionId, contentHash,
    ownerUid, approverUid, "simulation_only", approvedAt,
  ]);
}

export function serializeAutomationSourceEventIdentity(input: AutomationSourceEventIdentityBinding): string {
  const data = exactRecord(input, ["workspaceId", "connectionId", "eventKind", "sourceEventId"], "automation source identity", "invalid_governance_binding");
  const workspaceId = requireId(data.workspaceId, "workspaceId", "invalid_governance_binding");
  const connectionId = requireId(data.connectionId, "connectionId", "invalid_governance_binding");
  if (typeof data.eventKind !== "string" || !TRIGGERS.has(data.eventKind as AutomationTrigger)) return fail("invalid_governance_binding", "eventKind is invalid.");
  const sourceEventId = requireBoundedString(data.sourceEventId, "sourceEventId", 256, "invalid_governance_binding");
  return JSON.stringify([AUTOMATION_SOURCE_EVENT_PREFIX, workspaceId, connectionId, data.eventKind, sourceEventId]);
}

export function serializeAutomationTriggerReceiptKey(input: AutomationTriggerReceiptKeyBinding): string {
  const data = exactRecord(input, ["workspaceId", "family", "sourceEventFingerprint"], "automation receipt key", "invalid_governance_binding");
  const workspaceId = requireId(data.workspaceId, "workspaceId", "invalid_governance_binding");
  if (!EXECUTABLE_AUTOMATION_FAMILIES.includes(data.family as ExecutableAutomationFamily)) return fail("invalid_governance_binding", "automation receipt family is invalid.");
  const sourceEventFingerprint = requireSha256(data.sourceEventFingerprint, "sourceEventFingerprint", "invalid_governance_binding");
  return JSON.stringify([AUTOMATION_TRIGGER_RECEIPT_KEY_PREFIX, workspaceId, data.family, sourceEventFingerprint]);
}

export function serializeAutomationTriggerReceiptPayload(input: AutomationTriggerReceiptPayloadBinding): string {
  const data = exactRecord(input, [
    "receiptId", "triggerFingerprint", "workspaceId", "family", "definitionId",
    "definitionVersion", "definitionContentHash", "definitionApprovalHash",
    "activationEventId", "sourceEventFingerprint", "runId", "createdAt",
    "schemaVersion", "synthetic",
  ], "automation receipt payload", "invalid_governance_binding");
  const receiptId = requireSha256(data.receiptId, "receiptId", "invalid_governance_binding");
  const triggerFingerprint = requireSha256(data.triggerFingerprint, "triggerFingerprint", "invalid_governance_binding");
  if (receiptId !== triggerFingerprint) return fail("invalid_governance_binding", "automation receipt identity is invalid.");
  const workspaceId = requireId(data.workspaceId, "workspaceId", "invalid_governance_binding");
  if (!EXECUTABLE_AUTOMATION_FAMILIES.includes(data.family as ExecutableAutomationFamily)) return fail("invalid_governance_binding", "automation receipt family is invalid.");
  const definitionId = requireId(data.definitionId, "definitionId", "invalid_governance_binding");
  const definitionVersion = requireInteger(data.definitionVersion, "definitionVersion", 1, 1_000_000, "invalid_governance_binding");
  const definitionContentHash = requireSha256(data.definitionContentHash, "definitionContentHash", "invalid_governance_binding");
  const definitionApprovalHash = requireSha256(data.definitionApprovalHash, "definitionApprovalHash", "invalid_governance_binding");
  const activationEventId = requireId(data.activationEventId, "activationEventId", "invalid_governance_binding");
  const sourceEventFingerprint = requireSha256(data.sourceEventFingerprint, "sourceEventFingerprint", "invalid_governance_binding");
  const runId = requireId(data.runId, "runId", "invalid_governance_binding");
  const createdAt = requireIsoDateTime(data.createdAt, "createdAt");
  if (data.schemaVersion !== 1 || data.synthetic !== true) return fail("invalid_governance_binding", "automation receipt version is invalid.");
  return JSON.stringify([
    AUTOMATION_TRIGGER_RECEIPT_PAYLOAD_PREFIX, receiptId, triggerFingerprint,
    workspaceId, data.family, definitionId, definitionVersion,
    definitionContentHash, definitionApprovalHash, activationEventId,
    sourceEventFingerprint, runId, createdAt, 1, true,
  ]);
}

export function assertAutomationReceiptReplayBinding(input: AutomationTriggerReceiptPayloadBinding): void {
  serializeAutomationTriggerReceiptPayload(input);
  const expected = syntheticHmacSha256(serializeAutomationTriggerReceiptKey({
    workspaceId: input.workspaceId,
    family: input.family,
    sourceEventFingerprint: input.sourceEventFingerprint,
  }));
  if (input.receiptId !== expected || input.triggerFingerprint !== expected) {
    return fail("automation_receipt_denied", "Automation receipt does not match its canonical v2 HMAC key.");
  }
}

export function parseSyntheticAutomationControlInput(value: unknown): SyntheticAutomationControlInput {
  const data = exactRecord(value, [
    "workspaceId", "runId", "action", "expectedRevision", "idempotencyKey",
  ], "automation control request", "invalid_service_request");
  const workspaceId = requireId(data.workspaceId, "Workspace ID", "invalid_service_request");
  assertSafeTenantId(workspaceId);
  if (!AUTOMATION_RUN_ACTIONS.includes(data.action as AutomationRunAction)) return fail("invalid_service_request", "Automation action is invalid.");
  const expectedRevision = requireInteger(data.expectedRevision, "Expected revision", 1, 999_999, "invalid_service_request");
  if (typeof data.idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(data.idempotencyKey)) return fail("invalid_service_request", "Idempotency key is invalid.");
  return {
    workspaceId,
    runId: requireId(data.runId, "Run ID", "invalid_service_request"),
    action: data.action as AutomationRunAction,
    expectedRevision,
    idempotencyKey: data.idempotencyKey,
  };
}

export const AUTOMATION_GOLDEN_VECTORS = Object.freeze({
  controlResult: Object.freeze({
    serialized: '["hemas-connect:automation-control-result:v1","automation_run_synthetic_001","automation_event_synthetic_002","start","running",2,0,0,0,null,null,"accepted",true,0,0]',
    hash: "5c38a50e92c15b69c44d75cce34106460ca1c35ec1d60e0b6a8076ab21c2e364",
  }),
  secret: Object.freeze({
    serialized: '["hemas-connect:automation-definition-secret:v1","workspace_safenet_demo","automation_synthetic_appointment_v1","demo://automation/configuration/synthetic-v1","1111111111111111111111111111111111111111111111111111111111111111",1,true]',
    hash: "1a75cb75bd5c351e9cd4cb9746046c5110e15fa65bf8cf64d2712e0ce86f167e",
  }),
  content: Object.freeze({
    serialized: '["hemas-connect:automation-definition-content:v1","workspace_safenet_demo","automation_synthetic_appointment_v1","appointment_service",3,"Synthetic appointment reminder","appointment_event","appointment_service","medium",[["step_send_appointment","send_template","template_synthetic_appointment_en_v1","8888888888888888888888888888888888888888888888888888888888888888",null,null,null,null,"appointment_service","use_approved_template",30,3,30,300,"create_work_item"],["step_wait_reminder","wait",null,null,3600,null,null,null,"appointment_service","send_in_window",5,0,0,0,"stop_run"]],"1a75cb75bd5c351e9cd4cb9746046c5110e15fa65bf8cf64d2712e0ce86f167e",true]',
    hash: "df2941cf44b03b5fcdc56d346cafeee97dc3a52633e6e95b280c088e2dd107f3",
  }),
  approval: Object.freeze({
    serialized: '["hemas-connect:automation-definition-approval:v1","workspace_safenet_demo","automation_synthetic_appointment_v1","df2941cf44b03b5fcdc56d346cafeee97dc3a52633e6e95b280c088e2dd107f3","user_synthetic_automation_owner","user_synthetic_automation_approver","simulation_only","2026-08-07T09:00:00.000Z"]',
    hash: "2e4980aa95dec0c060852d5cb15b118cd5c8051c589fe92c6afd575c291ff42e",
  }),
});

export function assertAutomationGoldenVectors(): void {
  for (const vector of Object.values(AUTOMATION_GOLDEN_VECTORS)) {
    if (sha256Hex(vector.serialized) !== vector.hash) {
      return fail("automation_contract_drift", "Frozen automation governance vector drifted.");
    }
  }
}

// Fail deployment/build-time tests immediately if the independent mirror drifts.
assertAutomationGoldenVectors();
