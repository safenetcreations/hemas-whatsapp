import {
  CARE_PATHWAY_SUPPRESSIONS,
  type AuthoritativeAutomationStep,
  type AutomationDefinitionFamily,
  type AutomationRiskLevel,
  type AutomationTrigger,
  type CareAfterHoursBehavior,
  type CarePathwayContactPoint,
  type CarePathwayFamily,
  type CareSuppressionReason,
  type ExecutableAutomationFamily,
} from "./automations";
import type { ConsentPurpose } from "./contacts";

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
export const CARE_PATHWAY_CONTENT_PREFIX = "hemas-connect:care-pathway-content:v1" as const;
export const CARE_PATHWAY_APPROVAL_PREFIX = "hemas-connect:care-pathway-approval:v1" as const;
export const CARE_PATHWAY_SECRET_BINDING_PREFIX =
  "hemas-connect:care-pathway-secret:v1" as const;
export const CARE_DISCHARGE_SOURCE_PREFIX =
  "hemas-connect:care-discharge-source:v1" as const;
export const CARE_ENROLLMENT_RECEIPT_KEY_PREFIX =
  "hemas-connect:care-enrollment-receipt-key:v2" as const;
export const CARE_ENROLLMENT_RECEIPT_PAYLOAD_PREFIX =
  "hemas-connect:care-enrollment-receipt-payload:v2" as const;

/**
 * Receipt prefixes version canonical bytes, not HMAC key material. The local
 * synthetic demo uses one public test key; production must add managed key
 * version routing and rotation before any external event ingestion.
 */

export interface AutomationDefinitionContentBinding {
  readonly workspaceId: string;
  readonly definitionId: string;
  readonly family: AutomationDefinitionFamily;
  readonly version: number;
  readonly name: string;
  readonly trigger: AutomationTrigger;
  readonly consentPurpose: ConsentPurpose;
  readonly riskLevel: AutomationRiskLevel;
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

export interface AutomationDefinitionSecretBindingTarget {
  readonly workspaceId: string;
  readonly definitionId: string;
  readonly secretBindingHash: string;
}

export interface AutomationTriggerReceiptKeyBinding {
  readonly workspaceId: string;
  readonly family: ExecutableAutomationFamily;
  readonly sourceEventFingerprint: string;
}

export interface AutomationSourceEventIdentityBinding {
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly eventKind: AutomationTrigger;
  readonly sourceEventId: string;
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

export interface CarePathwayContentBinding {
  readonly workspaceId: string;
  readonly pathwayId: string;
  readonly family: CarePathwayFamily;
  readonly protocolVersion: string;
  readonly name: string;
  readonly clinicalOwnerUid: string;
  readonly contactPoints: readonly CarePathwayContactPoint[];
  readonly responseSlaMinutes: number;
  readonly escalationTeamId: string;
  readonly eligibleLocationIds: readonly string[];
  readonly afterHoursBehavior: CareAfterHoursBehavior;
  readonly writeBackRequired: boolean;
  readonly instructionsSource: "clinician_authored";
  readonly aiMayGenerateInstructions: false;
  readonly suppressions: readonly CareSuppressionReason[];
  readonly protectedContentHash: string;
  readonly secretBindingHash: string;
  readonly synthetic: true;
}

export interface CarePathwayApprovalBinding {
  readonly workspaceId: string;
  readonly pathwayId: string;
  readonly contentHash: string;
  readonly clinicalOwnerUid: string;
  readonly clinicalApproverUid: string;
  readonly scope: "clinical_simulation_only";
  readonly approvedAt: string;
}

export interface CarePathwaySecretBinding {
  readonly workspaceId: string;
  readonly pathwayId: string;
  readonly protectedInstructionsRef: string;
  readonly protectedContentFingerprint: string;
  readonly schemaVersion: 1;
  readonly synthetic: true;
}

export interface CarePathwaySecretBindingTarget {
  readonly workspaceId: string;
  readonly pathwayId: string;
  readonly protectedContentHash: string;
  readonly secretBindingHash: string;
}

export interface CareEnrollmentReceiptKeyBinding {
  readonly workspaceId: string;
  readonly family: CarePathwayFamily;
  readonly dischargeFingerprint: string;
}

export interface CareDischargeSourceIdentityBinding {
  readonly workspaceId: string;
  readonly sourceSystem: string;
  readonly connectionId: string;
  readonly dischargeEventId: string;
}

export interface CareEnrollmentReceiptPayloadBinding {
  readonly receiptId: string;
  readonly receiptFingerprint: string;
  readonly workspaceId: string;
  readonly family: CarePathwayFamily;
  readonly pathwayId: string;
  readonly pathwayProtocolVersion: string;
  readonly pathwayContentHash: string;
  readonly pathwayApprovalHash: string;
  readonly activationEventId: string;
  readonly dischargeFingerprint: string;
  readonly qualifyingDischargeAt: string;
  readonly enrollmentId: string;
  readonly createdAt: string;
  readonly schemaVersion: 1;
  readonly synthetic: true;
}

export type AutomationStepContentTuple = readonly [
  id: string,
  kind: AuthoritativeAutomationStep["kind"],
  templateVersionId: string | null,
  templateContentHash: string | null,
  waitSeconds: number | null,
  appointmentAction: AuthoritativeAutomationStep["appointmentAction"],
  routeTeamId: string | null,
  stopReasonCode: AuthoritativeAutomationStep["stopReasonCode"],
  requiredConsentPurpose: ConsentPurpose,
  serviceWindowBehavior: AuthoritativeAutomationStep["serviceWindowBehavior"],
  timeoutSeconds: number,
  retryMaxAttempts: number,
  retryInitialBackoffSeconds: number,
  retryMaximumBackoffSeconds: number,
  fallback: AuthoritativeAutomationStep["fallback"],
];

export type AutomationDefinitionContentTuple = readonly [
  prefix: typeof AUTOMATION_DEFINITION_CONTENT_PREFIX,
  workspaceId: string,
  definitionId: string,
  family: AutomationDefinitionFamily,
  version: number,
  name: string,
  trigger: AutomationTrigger,
  consentPurpose: ConsentPurpose,
  riskLevel: AutomationRiskLevel,
  steps: readonly AutomationStepContentTuple[],
  secretBindingHash: string,
  synthetic: true,
];

export type AutomationDefinitionApprovalTuple = readonly [
  prefix: typeof AUTOMATION_DEFINITION_APPROVAL_PREFIX,
  workspaceId: string,
  definitionId: string,
  contentHash: string,
  ownerUid: string,
  approverUid: string,
  scope: "simulation_only",
  approvedAt: string,
];

export type AutomationDefinitionSecretBindingTuple = readonly [
  prefix: typeof AUTOMATION_DEFINITION_SECRET_BINDING_PREFIX,
  workspaceId: string,
  definitionId: string,
  protectedConfigurationRef: string,
  configurationFingerprint: string,
  schemaVersion: 1,
  synthetic: true,
];

export type AutomationTriggerReceiptKeyTuple = readonly [
  prefix: typeof AUTOMATION_TRIGGER_RECEIPT_KEY_PREFIX,
  workspaceId: string,
  family: ExecutableAutomationFamily,
  sourceEventFingerprint: string,
];

export type AutomationSourceEventIdentityTuple = readonly [
  prefix: typeof AUTOMATION_SOURCE_EVENT_PREFIX,
  workspaceId: string,
  connectionId: string,
  eventKind: AutomationTrigger,
  sourceEventId: string,
];

export type AutomationTriggerReceiptPayloadTuple = readonly [
  prefix: typeof AUTOMATION_TRIGGER_RECEIPT_PAYLOAD_PREFIX,
  receiptId: string,
  triggerFingerprint: string,
  workspaceId: string,
  family: ExecutableAutomationFamily,
  definitionId: string,
  definitionVersion: number,
  definitionContentHash: string,
  definitionApprovalHash: string,
  activationEventId: string,
  sourceEventFingerprint: string,
  runId: string,
  createdAt: string,
  schemaVersion: 1,
  synthetic: true,
];

export type CareContactPointContentTuple = readonly [
  dayOffset: number,
  enTemplateVersionId: string,
  enContentHash: string,
  siTemplateVersionId: string,
  siContentHash: string,
  taTemplateVersionId: string,
  taContentHash: string,
];

export type CarePathwayContentTuple = readonly [
  prefix: typeof CARE_PATHWAY_CONTENT_PREFIX,
  workspaceId: string,
  pathwayId: string,
  family: CarePathwayFamily,
  protocolVersion: string,
  name: string,
  clinicalOwnerUid: string,
  contactPoints: readonly CareContactPointContentTuple[],
  responseSlaMinutes: number,
  escalationTeamId: string,
  eligibleLocationIds: readonly string[],
  afterHoursBehavior: CareAfterHoursBehavior,
  writeBackRequired: boolean,
  instructionsSource: "clinician_authored",
  aiMayGenerateInstructions: false,
  suppressions: readonly CareSuppressionReason[],
  protectedContentHash: string,
  secretBindingHash: string,
  synthetic: true,
];

export type CarePathwayApprovalTuple = readonly [
  prefix: typeof CARE_PATHWAY_APPROVAL_PREFIX,
  workspaceId: string,
  pathwayId: string,
  contentHash: string,
  clinicalOwnerUid: string,
  clinicalApproverUid: string,
  scope: "clinical_simulation_only",
  approvedAt: string,
];

export type CarePathwaySecretBindingTuple = readonly [
  prefix: typeof CARE_PATHWAY_SECRET_BINDING_PREFIX,
  workspaceId: string,
  pathwayId: string,
  protectedInstructionsRef: string,
  protectedContentFingerprint: string,
  schemaVersion: 1,
  synthetic: true,
];

export type CareEnrollmentReceiptKeyTuple = readonly [
  prefix: typeof CARE_ENROLLMENT_RECEIPT_KEY_PREFIX,
  workspaceId: string,
  family: CarePathwayFamily,
  dischargeFingerprint: string,
];

export type CareDischargeSourceIdentityTuple = readonly [
  prefix: typeof CARE_DISCHARGE_SOURCE_PREFIX,
  workspaceId: string,
  sourceSystem: string,
  connectionId: string,
  dischargeEventId: string,
];

export type CareEnrollmentReceiptPayloadTuple = readonly [
  prefix: typeof CARE_ENROLLMENT_RECEIPT_PAYLOAD_PREFIX,
  receiptId: string,
  receiptFingerprint: string,
  workspaceId: string,
  family: CarePathwayFamily,
  pathwayId: string,
  pathwayProtocolVersion: string,
  pathwayContentHash: string,
  pathwayApprovalHash: string,
  activationEventId: string,
  dischargeFingerprint: string,
  qualifyingDischargeAt: string,
  enrollmentId: string,
  createdAt: string,
  schemaVersion: 1,
  synthetic: true,
];

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const AUTOMATION_FAMILIES = new Set<AutomationDefinitionFamily>([
  "appointment_service",
  "laboratory_service",
  "care_pathway",
  "feedback",
  "inbound_routing",
  "campaign_response",
  "scheduled_service",
]);
const EXECUTABLE_AUTOMATION_FAMILIES = new Set<ExecutableAutomationFamily>([
  "appointment_service",
  "laboratory_service",
]);
const TRIGGERS = new Set<AutomationTrigger>([
  "inbound_intent",
  "appointment_event",
  "lims_report_ready",
  "discharge_event",
  "scheduled_time",
  "campaign_response",
  "agent_action",
]);
const CONSENT_PURPOSES = new Set<ConsentPurpose>([
  "appointment_service",
  "laboratory_service",
  "care_pathway",
  "feedback",
  "health_campaigns",
  "event_campaigns",
  "transactional_updates",
]);
const RISKS = new Set<AutomationRiskLevel>(["low", "medium", "high"]);
const STEP_KINDS = new Set<AuthoritativeAutomationStep["kind"]>([
  "send_template",
  "wait",
  "request_appointment_action",
  "route_to_team",
  "stop",
]);
const SERVICE_WINDOW_BEHAVIORS = new Set<
  AuthoritativeAutomationStep["serviceWindowBehavior"]
>(["send_in_window", "use_approved_template", "do_not_send"]);
const FALLBACKS = new Set<AuthoritativeAutomationStep["fallback"]>([
  "create_work_item",
  "route_to_human",
  "stop_run",
]);
const APPOINTMENT_ACTIONS = new Set(["confirm", "reschedule", "cancel"]);
const STOP_REASONS = new Set([
  "policy_complete",
  "consent_unavailable",
  "service_window_closed",
  "synthetic_safe_stop",
]);
const AFTER_HOURS = new Set<CareAfterHoursBehavior>([
  "emergency_path",
  "next_business_day",
  "on_call_queue",
]);

function fail(message: string): never {
  throw new Error(`Invalid governance binding: ${message}`);
}

function assertExactKeys(label: string, value: unknown, expectedKeys: readonly string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be a plain object with an exact key set.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(`${label} must be a plain object.`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) {
    fail(`${label} cannot contain symbol keys.`);
  }
  const actual = (ownKeys as string[]).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exactly: ${expected.join(", ")}.`);
  }
}

function assertIdentifier(label: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) fail(`${label} is not a canonical identifier.`);
}

function assertSha256(label: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`${label} must be a lowercase SHA-256 digest.`);
}

function assertProtectedReference(label: string, value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length < 8 ||
    value.length > 512 ||
    value.trim() !== value ||
    (!value.startsWith("encrypted://") && !value.startsWith("demo://"))
  ) {
    fail(`${label} must be a bounded encrypted:// or demo:// reference.`);
  }
}

function assertInteger(label: string, value: unknown, minimum: number, maximum: number): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
}

function assertBoundedText(label: string, value: unknown, maximum: number): asserts value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || value.trim() !== value) {
    fail(`${label} must be non-empty, trimmed, and at most ${maximum} characters.`);
  }
}

function assertIsoDateTime(label: string, value: unknown): asserts value is string {
  if (typeof value !== "string") fail(`${label} must be an ISO date-time.`);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    fail(`${label} must be a canonical ISO date-time.`);
  }
}

function assertSortedUniqueIdentifiers(label: string, values: readonly string[]): void {
  if (values.length < 1 || values.length > 64) fail(`${label} must contain 1 to 64 identifiers.`);
  values.forEach((value, index) => {
    assertIdentifier(`${label}[${index}]`, value);
    if (index > 0 && values[index - 1]! >= value) fail(`${label} must be strictly ordered and unique.`);
  });
}

function assertAutomationStep(step: AuthoritativeAutomationStep, index: number): void {
  assertExactKeys(`steps[${index}]`, step, [
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
  ]);
  assertIdentifier(`steps[${index}].id`, step.id);
  if (!STEP_KINDS.has(step.kind)) fail(`steps[${index}].kind is unsupported.`);
  if (!CONSENT_PURPOSES.has(step.requiredConsentPurpose)) fail(`steps[${index}].requiredConsentPurpose is unsupported.`);
  if (!SERVICE_WINDOW_BEHAVIORS.has(step.serviceWindowBehavior)) fail(`steps[${index}].serviceWindowBehavior is unsupported.`);
  if (!FALLBACKS.has(step.fallback)) fail(`steps[${index}].fallback is unsupported.`);
  assertInteger(`steps[${index}].timeoutSeconds`, step.timeoutSeconds, 1, 86_400);
  assertInteger(`steps[${index}].retryMaxAttempts`, step.retryMaxAttempts, 0, 10);
  assertInteger(`steps[${index}].retryInitialBackoffSeconds`, step.retryInitialBackoffSeconds, 0, 86_400);
  assertInteger(`steps[${index}].retryMaximumBackoffSeconds`, step.retryMaximumBackoffSeconds, 0, 86_400);
  if (step.retryMaximumBackoffSeconds < step.retryInitialBackoffSeconds) fail(`steps[${index}] retry backoff is inverted.`);
  if (step.retryMaxAttempts === 0 && (step.retryInitialBackoffSeconds !== 0 || step.retryMaximumBackoffSeconds !== 0)) {
    fail(`steps[${index}] retry backoff must be zero when retries are disabled.`);
  }

  const required = (value: unknown, label: string) => {
    if (value === null || value === undefined) fail(`steps[${index}].${label} is required for ${step.kind}.`);
  };
  const absent = (value: unknown, label: string) => {
    if (value !== null) fail(`steps[${index}].${label} must be null for ${step.kind}.`);
  };
  if (step.kind === "send_template") {
    required(step.templateVersionId, "templateVersionId");
    assertIdentifier(`steps[${index}].templateVersionId`, step.templateVersionId);
    required(step.templateContentHash, "templateContentHash");
    assertSha256(`steps[${index}].templateContentHash`, step.templateContentHash);
    absent(step.waitSeconds, "waitSeconds");
    absent(step.appointmentAction, "appointmentAction");
    absent(step.routeTeamId, "routeTeamId");
    absent(step.stopReasonCode, "stopReasonCode");
  } else if (step.kind === "wait") {
    absent(step.templateVersionId, "templateVersionId");
    absent(step.templateContentHash, "templateContentHash");
    required(step.waitSeconds, "waitSeconds");
    assertInteger(`steps[${index}].waitSeconds`, step.waitSeconds, 1, 31_536_000);
    absent(step.appointmentAction, "appointmentAction");
    absent(step.routeTeamId, "routeTeamId");
    absent(step.stopReasonCode, "stopReasonCode");
  } else if (step.kind === "request_appointment_action") {
    absent(step.templateVersionId, "templateVersionId");
    absent(step.templateContentHash, "templateContentHash");
    absent(step.waitSeconds, "waitSeconds");
    required(step.appointmentAction, "appointmentAction");
    if (!APPOINTMENT_ACTIONS.has(step.appointmentAction as string)) fail(`steps[${index}].appointmentAction is unsupported.`);
    absent(step.routeTeamId, "routeTeamId");
    absent(step.stopReasonCode, "stopReasonCode");
  } else if (step.kind === "route_to_team") {
    absent(step.templateVersionId, "templateVersionId");
    absent(step.templateContentHash, "templateContentHash");
    absent(step.waitSeconds, "waitSeconds");
    absent(step.appointmentAction, "appointmentAction");
    required(step.routeTeamId, "routeTeamId");
    assertIdentifier(`steps[${index}].routeTeamId`, step.routeTeamId);
    absent(step.stopReasonCode, "stopReasonCode");
  } else {
    absent(step.templateVersionId, "templateVersionId");
    absent(step.templateContentHash, "templateContentHash");
    absent(step.waitSeconds, "waitSeconds");
    absent(step.appointmentAction, "appointmentAction");
    absent(step.routeTeamId, "routeTeamId");
    required(step.stopReasonCode, "stopReasonCode");
    if (!STOP_REASONS.has(step.stopReasonCode as string)) fail(`steps[${index}].stopReasonCode is unsupported.`);
  }
}

export function toAutomationDefinitionContentTuple(
  input: AutomationDefinitionContentBinding,
): AutomationDefinitionContentTuple {
  assertExactKeys("automation definition content", input, [
    "workspaceId",
    "definitionId",
    "family",
    "version",
    "name",
    "trigger",
    "consentPurpose",
    "riskLevel",
    "steps",
    "secretBindingHash",
    "synthetic",
  ]);
  assertIdentifier("workspaceId", input.workspaceId);
  assertIdentifier("definitionId", input.definitionId);
  if (!AUTOMATION_FAMILIES.has(input.family)) fail("family is unsupported.");
  assertInteger("version", input.version, 1, 1_000_000);
  assertBoundedText("name", input.name, 160);
  if (!TRIGGERS.has(input.trigger)) fail("trigger is unsupported.");
  if (!CONSENT_PURPOSES.has(input.consentPurpose)) fail("consentPurpose is unsupported.");
  if (!RISKS.has(input.riskLevel)) fail("riskLevel is unsupported.");
  if (!Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > 32) fail("steps must contain 1 to 32 entries.");
  const stepIds = new Set<string>();
  input.steps.forEach((step, index) => {
    assertAutomationStep(step, index);
    if (stepIds.has(step.id)) fail("step identifiers must be unique.");
    stepIds.add(step.id);
  });
  assertSha256("secretBindingHash", input.secretBindingHash);
  if (input.synthetic !== true) fail("synthetic must be true.");

  return [
    AUTOMATION_DEFINITION_CONTENT_PREFIX,
    input.workspaceId,
    input.definitionId,
    input.family,
    input.version,
    input.name,
    input.trigger,
    input.consentPurpose,
    input.riskLevel,
    input.steps.map((step) => [
      step.id,
      step.kind,
      step.templateVersionId,
      step.templateContentHash,
      step.waitSeconds,
      step.appointmentAction,
      step.routeTeamId,
      step.stopReasonCode,
      step.requiredConsentPurpose,
      step.serviceWindowBehavior,
      step.timeoutSeconds,
      step.retryMaxAttempts,
      step.retryInitialBackoffSeconds,
      step.retryMaximumBackoffSeconds,
      step.fallback,
    ] as const),
    input.secretBindingHash,
    true,
  ];
}

export function serializeAutomationDefinitionContent(input: AutomationDefinitionContentBinding): string {
  return JSON.stringify(toAutomationDefinitionContentTuple(input));
}

export function toAutomationDefinitionApprovalTuple(
  input: AutomationDefinitionApprovalBinding,
): AutomationDefinitionApprovalTuple {
  assertExactKeys("automation definition approval", input, [
    "workspaceId",
    "definitionId",
    "contentHash",
    "ownerUid",
    "approverUid",
    "scope",
    "approvedAt",
  ]);
  assertIdentifier("workspaceId", input.workspaceId);
  assertIdentifier("definitionId", input.definitionId);
  assertSha256("contentHash", input.contentHash);
  assertIdentifier("ownerUid", input.ownerUid);
  assertIdentifier("approverUid", input.approverUid);
  if (input.ownerUid === input.approverUid) fail("ownerUid and approverUid must be different.");
  if (input.scope !== "simulation_only") fail("scope must be simulation_only.");
  assertIsoDateTime("approvedAt", input.approvedAt);
  return [
    AUTOMATION_DEFINITION_APPROVAL_PREFIX,
    input.workspaceId,
    input.definitionId,
    input.contentHash,
    input.ownerUid,
    input.approverUid,
    "simulation_only",
    input.approvedAt,
  ];
}

export function serializeAutomationDefinitionApproval(input: AutomationDefinitionApprovalBinding): string {
  return JSON.stringify(toAutomationDefinitionApprovalTuple(input));
}

export function toAutomationDefinitionSecretBindingTuple(
  input: AutomationDefinitionSecretBinding,
): AutomationDefinitionSecretBindingTuple {
  assertExactKeys("automation definition secret", input, [
    "workspaceId",
    "definitionId",
    "protectedConfigurationRef",
    "configurationFingerprint",
    "schemaVersion",
    "synthetic",
  ]);
  assertIdentifier("workspaceId", input.workspaceId);
  assertIdentifier("definitionId", input.definitionId);
  assertProtectedReference("protectedConfigurationRef", input.protectedConfigurationRef);
  assertSha256("configurationFingerprint", input.configurationFingerprint);
  if (input.schemaVersion !== 1) fail("schemaVersion must be 1.");
  if (input.synthetic !== true) fail("synthetic must be true.");
  return [
    AUTOMATION_DEFINITION_SECRET_BINDING_PREFIX,
    input.workspaceId,
    input.definitionId,
    input.protectedConfigurationRef,
    input.configurationFingerprint,
    1,
    true,
  ];
}

export function serializeAutomationDefinitionSecretBinding(
  input: AutomationDefinitionSecretBinding,
): string {
  return JSON.stringify(toAutomationDefinitionSecretBindingTuple(input));
}

export function assertAutomationDefinitionSecretCrossBinding(
  secret: AutomationDefinitionSecretBinding,
  target: AutomationDefinitionSecretBindingTarget,
  sha256: (canonicalValue: string) => string,
): void {
  assertExactKeys("automation definition secret target", target, [
    "workspaceId",
    "definitionId",
    "secretBindingHash",
  ]);
  assertIdentifier("target.workspaceId", target.workspaceId);
  assertIdentifier("target.definitionId", target.definitionId);
  assertSha256("target.secretBindingHash", target.secretBindingHash);
  const computedHash = sha256(serializeAutomationDefinitionSecretBinding(secret));
  assertSha256("computed automation secret binding hash", computedHash);
  if (
    secret.workspaceId !== target.workspaceId ||
    secret.definitionId !== target.definitionId ||
    computedHash !== target.secretBindingHash
  ) {
    fail("automation definition secret does not match its public binding.");
  }
}

export function toAutomationSourceEventIdentityTuple(
  input: AutomationSourceEventIdentityBinding,
): AutomationSourceEventIdentityTuple {
  assertExactKeys("automation source event identity", input, [
    "workspaceId",
    "connectionId",
    "eventKind",
    "sourceEventId",
  ]);
  assertIdentifier("workspaceId", input.workspaceId);
  assertIdentifier("connectionId", input.connectionId);
  if (!TRIGGERS.has(input.eventKind)) fail("eventKind is unsupported.");
  assertBoundedText("sourceEventId", input.sourceEventId, 256);
  return [
    AUTOMATION_SOURCE_EVENT_PREFIX,
    input.workspaceId,
    input.connectionId,
    input.eventKind,
    input.sourceEventId,
  ];
}

export function serializeAutomationSourceEventIdentity(
  input: AutomationSourceEventIdentityBinding,
): string {
  return JSON.stringify(toAutomationSourceEventIdentityTuple(input));
}

export function toAutomationTriggerReceiptKeyTuple(
  input: AutomationTriggerReceiptKeyBinding,
): AutomationTriggerReceiptKeyTuple {
  assertExactKeys("automation trigger receipt key", input, [
    "workspaceId",
    "family",
    "sourceEventFingerprint",
  ]);
  assertIdentifier("workspaceId", input.workspaceId);
  if (!EXECUTABLE_AUTOMATION_FAMILIES.has(input.family)) {
    fail("family is not executable in Phase 5.");
  }
  assertSha256("sourceEventFingerprint", input.sourceEventFingerprint);
  return [
    AUTOMATION_TRIGGER_RECEIPT_KEY_PREFIX,
    input.workspaceId,
    input.family,
    input.sourceEventFingerprint,
  ];
}

export function serializeAutomationTriggerReceiptKey(
  input: AutomationTriggerReceiptKeyBinding,
): string {
  return JSON.stringify(toAutomationTriggerReceiptKeyTuple(input));
}

export function toAutomationTriggerReceiptPayloadTuple(
  input: AutomationTriggerReceiptPayloadBinding,
): AutomationTriggerReceiptPayloadTuple {
  assertExactKeys("automation trigger receipt payload", input, [
    "receiptId",
    "triggerFingerprint",
    "workspaceId",
    "family",
    "definitionId",
    "definitionVersion",
    "definitionContentHash",
    "definitionApprovalHash",
    "activationEventId",
    "sourceEventFingerprint",
    "runId",
    "createdAt",
    "schemaVersion",
    "synthetic",
  ]);
  assertSha256("receiptId", input.receiptId);
  assertSha256("triggerFingerprint", input.triggerFingerprint);
  if (input.receiptId !== input.triggerFingerprint) fail("receiptId must equal triggerFingerprint.");
  assertIdentifier("workspaceId", input.workspaceId);
  if (!EXECUTABLE_AUTOMATION_FAMILIES.has(input.family)) {
    fail("family is not executable in Phase 5.");
  }
  assertIdentifier("definitionId", input.definitionId);
  assertInteger("definitionVersion", input.definitionVersion, 1, 1_000_000);
  assertSha256("definitionContentHash", input.definitionContentHash);
  assertSha256("definitionApprovalHash", input.definitionApprovalHash);
  assertIdentifier("activationEventId", input.activationEventId);
  assertSha256("sourceEventFingerprint", input.sourceEventFingerprint);
  assertIdentifier("runId", input.runId);
  assertIsoDateTime("createdAt", input.createdAt);
  if (input.schemaVersion !== 1) fail("schemaVersion must be 1.");
  if (input.synthetic !== true) fail("synthetic must be true.");
  return [
    AUTOMATION_TRIGGER_RECEIPT_PAYLOAD_PREFIX,
    input.receiptId,
    input.triggerFingerprint,
    input.workspaceId,
    input.family,
    input.definitionId,
    input.definitionVersion,
    input.definitionContentHash,
    input.definitionApprovalHash,
    input.activationEventId,
    input.sourceEventFingerprint,
    input.runId,
    input.createdAt,
    1,
    true,
  ];
}

export function serializeAutomationTriggerReceiptPayload(
  input: AutomationTriggerReceiptPayloadBinding,
): string {
  return JSON.stringify(toAutomationTriggerReceiptPayloadTuple(input));
}

/**
 * Trusted service replay guard for a server-only, create-only receipt. The
 * service must run this against every exact immutable payload before reusing a
 * run; no protected reference or HMAC key is persisted in the canonical tuple.
 */
export function assertAutomationTriggerReceiptReplayBinding(
  receipt: AutomationTriggerReceiptPayloadBinding,
  hmacSha256: (canonicalKey: string) => string,
): void {
  serializeAutomationTriggerReceiptPayload(receipt);
  const expectedFingerprint = hmacSha256(
    serializeAutomationTriggerReceiptKey({
      workspaceId: receipt.workspaceId,
      family: receipt.family,
      sourceEventFingerprint: receipt.sourceEventFingerprint,
    }),
  );
  assertSha256("computed automation receipt HMAC", expectedFingerprint);
  if (
    receipt.receiptId !== expectedFingerprint ||
    receipt.triggerFingerprint !== expectedFingerprint
  ) {
    fail("automation trigger receipt does not match its stable v2 canonical key HMAC.");
  }
}

export function assertAutomationTriggerReceiptImmutableReplay(
  stored: AutomationTriggerReceiptPayloadBinding,
  candidate: AutomationTriggerReceiptPayloadBinding,
  hmacSha256: (canonicalKey: string) => string,
): void {
  assertAutomationTriggerReceiptReplayBinding(stored, hmacSha256);
  assertAutomationTriggerReceiptReplayBinding(candidate, hmacSha256);
  if (
    serializeAutomationTriggerReceiptPayload(stored) !==
    serializeAutomationTriggerReceiptPayload(candidate)
  ) {
    fail("automation trigger receipt replay must match every immutable payload field.");
  }
}

function assertCareContactPoint(point: CarePathwayContactPoint, index: number): void {
  assertExactKeys(`contactPoints[${index}]`, point, ["dayOffset", "en", "si", "ta"]);
  assertInteger(`contactPoints[${index}].dayOffset`, point.dayOffset, 1, 365);
  (["en", "si", "ta"] as const).forEach((language) => {
    const binding = point[language];
    assertExactKeys(`contactPoints[${index}].${language}`, binding, [
      "templateVersionId",
      "contentHash",
    ]);
    assertIdentifier(`contactPoints[${index}].${language}.templateVersionId`, binding.templateVersionId);
    assertSha256(`contactPoints[${index}].${language}.contentHash`, binding.contentHash);
  });
}

export function toCarePathwayContentTuple(input: CarePathwayContentBinding): CarePathwayContentTuple {
  assertExactKeys("care pathway content", input, [
    "workspaceId",
    "pathwayId",
    "family",
    "protocolVersion",
    "name",
    "clinicalOwnerUid",
    "contactPoints",
    "responseSlaMinutes",
    "escalationTeamId",
    "eligibleLocationIds",
    "afterHoursBehavior",
    "writeBackRequired",
    "instructionsSource",
    "aiMayGenerateInstructions",
    "suppressions",
    "protectedContentHash",
    "secretBindingHash",
    "synthetic",
  ]);
  assertIdentifier("workspaceId", input.workspaceId);
  assertIdentifier("pathwayId", input.pathwayId);
  if (input.family !== "post_discharge") fail("family must be post_discharge.");
  if (typeof input.protocolVersion !== "string" || !VERSION.test(input.protocolVersion)) fail("protocolVersion is invalid.");
  assertBoundedText("name", input.name, 160);
  assertIdentifier("clinicalOwnerUid", input.clinicalOwnerUid);
  if (!Array.isArray(input.contactPoints) || input.contactPoints.length < 1 || input.contactPoints.length > 32) {
    fail("contactPoints must contain 1 to 32 entries.");
  }
  input.contactPoints.forEach((point, index) => {
    assertCareContactPoint(point, index);
    if (index > 0 && input.contactPoints[index - 1]!.dayOffset >= point.dayOffset) {
      fail("contact day offsets must be strictly ordered and unique.");
    }
  });
  assertInteger("responseSlaMinutes", input.responseSlaMinutes, 1, 1_440);
  assertIdentifier("escalationTeamId", input.escalationTeamId);
  assertSortedUniqueIdentifiers("eligibleLocationIds", input.eligibleLocationIds);
  if (!AFTER_HOURS.has(input.afterHoursBehavior)) fail("afterHoursBehavior is unsupported.");
  if (typeof input.writeBackRequired !== "boolean") fail("writeBackRequired must be boolean.");
  if (input.instructionsSource !== "clinician_authored") fail("instructionsSource must be clinician_authored.");
  if (input.aiMayGenerateInstructions !== false) fail("aiMayGenerateInstructions must be false.");
  if (
    input.suppressions.length !== CARE_PATHWAY_SUPPRESSIONS.length ||
    input.suppressions.some((reason, index) => reason !== CARE_PATHWAY_SUPPRESSIONS[index])
  ) {
    fail("suppressions must match the fixed governance order.");
  }
  assertSha256("protectedContentHash", input.protectedContentHash);
  assertSha256("secretBindingHash", input.secretBindingHash);
  if (input.synthetic !== true) fail("synthetic must be true.");

  return [
    CARE_PATHWAY_CONTENT_PREFIX,
    input.workspaceId,
    input.pathwayId,
    input.family,
    input.protocolVersion,
    input.name,
    input.clinicalOwnerUid,
    input.contactPoints.map((point) => [
      point.dayOffset,
      point.en.templateVersionId,
      point.en.contentHash,
      point.si.templateVersionId,
      point.si.contentHash,
      point.ta.templateVersionId,
      point.ta.contentHash,
    ] as const),
    input.responseSlaMinutes,
    input.escalationTeamId,
    [...input.eligibleLocationIds],
    input.afterHoursBehavior,
    input.writeBackRequired,
    "clinician_authored",
    false,
    [...CARE_PATHWAY_SUPPRESSIONS],
    input.protectedContentHash,
    input.secretBindingHash,
    true,
  ];
}

export function serializeCarePathwayContent(input: CarePathwayContentBinding): string {
  return JSON.stringify(toCarePathwayContentTuple(input));
}

export function toCarePathwayApprovalTuple(input: CarePathwayApprovalBinding): CarePathwayApprovalTuple {
  assertExactKeys("care pathway approval", input, [
    "workspaceId",
    "pathwayId",
    "contentHash",
    "clinicalOwnerUid",
    "clinicalApproverUid",
    "scope",
    "approvedAt",
  ]);
  assertIdentifier("workspaceId", input.workspaceId);
  assertIdentifier("pathwayId", input.pathwayId);
  assertSha256("contentHash", input.contentHash);
  assertIdentifier("clinicalOwnerUid", input.clinicalOwnerUid);
  assertIdentifier("clinicalApproverUid", input.clinicalApproverUid);
  if (input.clinicalOwnerUid === input.clinicalApproverUid) fail("clinical owner and approver must be different.");
  if (input.scope !== "clinical_simulation_only") fail("scope must be clinical_simulation_only.");
  assertIsoDateTime("approvedAt", input.approvedAt);
  return [
    CARE_PATHWAY_APPROVAL_PREFIX,
    input.workspaceId,
    input.pathwayId,
    input.contentHash,
    input.clinicalOwnerUid,
    input.clinicalApproverUid,
    "clinical_simulation_only",
    input.approvedAt,
  ];
}

export function serializeCarePathwayApproval(input: CarePathwayApprovalBinding): string {
  return JSON.stringify(toCarePathwayApprovalTuple(input));
}

export function toCarePathwaySecretBindingTuple(
  input: CarePathwaySecretBinding,
): CarePathwaySecretBindingTuple {
  assertExactKeys("care pathway secret", input, [
    "workspaceId",
    "pathwayId",
    "protectedInstructionsRef",
    "protectedContentFingerprint",
    "schemaVersion",
    "synthetic",
  ]);
  assertIdentifier("workspaceId", input.workspaceId);
  assertIdentifier("pathwayId", input.pathwayId);
  assertProtectedReference("protectedInstructionsRef", input.protectedInstructionsRef);
  assertSha256("protectedContentFingerprint", input.protectedContentFingerprint);
  if (input.schemaVersion !== 1) fail("schemaVersion must be 1.");
  if (input.synthetic !== true) fail("synthetic must be true.");
  return [
    CARE_PATHWAY_SECRET_BINDING_PREFIX,
    input.workspaceId,
    input.pathwayId,
    input.protectedInstructionsRef,
    input.protectedContentFingerprint,
    1,
    true,
  ];
}

export function serializeCarePathwaySecretBinding(input: CarePathwaySecretBinding): string {
  return JSON.stringify(toCarePathwaySecretBindingTuple(input));
}

export function assertCarePathwaySecretCrossBinding(
  secret: CarePathwaySecretBinding,
  target: CarePathwaySecretBindingTarget,
  sha256: (canonicalValue: string) => string,
): void {
  assertExactKeys("care pathway secret target", target, [
    "workspaceId",
    "pathwayId",
    "protectedContentHash",
    "secretBindingHash",
  ]);
  assertIdentifier("target.workspaceId", target.workspaceId);
  assertIdentifier("target.pathwayId", target.pathwayId);
  assertSha256("target.protectedContentHash", target.protectedContentHash);
  assertSha256("target.secretBindingHash", target.secretBindingHash);
  const computedHash = sha256(serializeCarePathwaySecretBinding(secret));
  assertSha256("computed care secret binding hash", computedHash);
  if (
    secret.workspaceId !== target.workspaceId ||
    secret.pathwayId !== target.pathwayId ||
    secret.protectedContentFingerprint !== target.protectedContentHash ||
    computedHash !== target.secretBindingHash
  ) {
    fail("care pathway secret does not match its public content and secret bindings.");
  }
}

export function toCareDischargeSourceIdentityTuple(
  input: CareDischargeSourceIdentityBinding,
): CareDischargeSourceIdentityTuple {
  assertExactKeys("care discharge source identity", input, [
    "workspaceId",
    "sourceSystem",
    "connectionId",
    "dischargeEventId",
  ]);
  assertIdentifier("workspaceId", input.workspaceId);
  assertIdentifier("sourceSystem", input.sourceSystem);
  assertIdentifier("connectionId", input.connectionId);
  assertBoundedText("dischargeEventId", input.dischargeEventId, 256);
  return [
    CARE_DISCHARGE_SOURCE_PREFIX,
    input.workspaceId,
    input.sourceSystem,
    input.connectionId,
    input.dischargeEventId,
  ];
}

export function serializeCareDischargeSourceIdentity(
  input: CareDischargeSourceIdentityBinding,
): string {
  return JSON.stringify(toCareDischargeSourceIdentityTuple(input));
}

export function toCareEnrollmentReceiptKeyTuple(
  input: CareEnrollmentReceiptKeyBinding,
): CareEnrollmentReceiptKeyTuple {
  assertExactKeys("care enrollment receipt key", input, [
    "workspaceId",
    "family",
    "dischargeFingerprint",
  ]);
  assertIdentifier("workspaceId", input.workspaceId);
  if (input.family !== "post_discharge") fail("family must be post_discharge.");
  assertSha256("dischargeFingerprint", input.dischargeFingerprint);
  return [
    CARE_ENROLLMENT_RECEIPT_KEY_PREFIX,
    input.workspaceId,
    input.family,
    input.dischargeFingerprint,
  ];
}

export function serializeCareEnrollmentReceiptKey(input: CareEnrollmentReceiptKeyBinding): string {
  return JSON.stringify(toCareEnrollmentReceiptKeyTuple(input));
}

export function toCareEnrollmentReceiptPayloadTuple(
  input: CareEnrollmentReceiptPayloadBinding,
): CareEnrollmentReceiptPayloadTuple {
  assertExactKeys("care enrollment receipt payload", input, [
    "receiptId",
    "receiptFingerprint",
    "workspaceId",
    "family",
    "pathwayId",
    "pathwayProtocolVersion",
    "pathwayContentHash",
    "pathwayApprovalHash",
    "activationEventId",
    "dischargeFingerprint",
    "qualifyingDischargeAt",
    "enrollmentId",
    "createdAt",
    "schemaVersion",
    "synthetic",
  ]);
  assertSha256("receiptId", input.receiptId);
  assertSha256("receiptFingerprint", input.receiptFingerprint);
  if (input.receiptId !== input.receiptFingerprint) fail("receiptId must equal receiptFingerprint.");
  assertIdentifier("workspaceId", input.workspaceId);
  if (input.family !== "post_discharge") fail("family must be post_discharge.");
  assertIdentifier("pathwayId", input.pathwayId);
  if (
    typeof input.pathwayProtocolVersion !== "string" ||
    !VERSION.test(input.pathwayProtocolVersion)
  ) {
    fail("pathwayProtocolVersion is invalid.");
  }
  assertSha256("pathwayContentHash", input.pathwayContentHash);
  assertSha256("pathwayApprovalHash", input.pathwayApprovalHash);
  assertIdentifier("activationEventId", input.activationEventId);
  assertSha256("dischargeFingerprint", input.dischargeFingerprint);
  assertIsoDateTime("qualifyingDischargeAt", input.qualifyingDischargeAt);
  assertIdentifier("enrollmentId", input.enrollmentId);
  assertIsoDateTime("createdAt", input.createdAt);
  if (Date.parse(input.qualifyingDischargeAt) > Date.parse(input.createdAt)) {
    fail("qualifyingDischargeAt cannot be after receipt createdAt.");
  }
  if (input.schemaVersion !== 1) fail("schemaVersion must be 1.");
  if (input.synthetic !== true) fail("synthetic must be true.");
  return [
    CARE_ENROLLMENT_RECEIPT_PAYLOAD_PREFIX,
    input.receiptId,
    input.receiptFingerprint,
    input.workspaceId,
    input.family,
    input.pathwayId,
    input.pathwayProtocolVersion,
    input.pathwayContentHash,
    input.pathwayApprovalHash,
    input.activationEventId,
    input.dischargeFingerprint,
    input.qualifyingDischargeAt,
    input.enrollmentId,
    input.createdAt,
    1,
    true,
  ];
}

export function serializeCareEnrollmentReceiptPayload(
  input: CareEnrollmentReceiptPayloadBinding,
): string {
  return JSON.stringify(toCareEnrollmentReceiptPayloadTuple(input));
}

/** Care equivalent of the server-only, create-only immutable receipt guard. */
export function assertCareEnrollmentReceiptReplayBinding(
  receipt: CareEnrollmentReceiptPayloadBinding,
  hmacSha256: (canonicalKey: string) => string,
): void {
  serializeCareEnrollmentReceiptPayload(receipt);
  const expectedFingerprint = hmacSha256(
    serializeCareEnrollmentReceiptKey({
      workspaceId: receipt.workspaceId,
      family: receipt.family,
      dischargeFingerprint: receipt.dischargeFingerprint,
    }),
  );
  assertSha256("computed care receipt HMAC", expectedFingerprint);
  if (
    receipt.receiptId !== expectedFingerprint ||
    receipt.receiptFingerprint !== expectedFingerprint
  ) {
    fail("care enrollment receipt does not match its stable v2 canonical key HMAC.");
  }
}

export function assertCareEnrollmentReceiptImmutableReplay(
  stored: CareEnrollmentReceiptPayloadBinding,
  candidate: CareEnrollmentReceiptPayloadBinding,
  hmacSha256: (canonicalKey: string) => string,
): void {
  assertCareEnrollmentReceiptReplayBinding(stored, hmacSha256);
  assertCareEnrollmentReceiptReplayBinding(candidate, hmacSha256);
  if (
    serializeCareEnrollmentReceiptPayload(stored) !==
    serializeCareEnrollmentReceiptPayload(candidate)
  ) {
    fail("care enrollment receipt replay must match every immutable payload field.");
  }
}
