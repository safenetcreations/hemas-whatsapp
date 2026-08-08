import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  where,
  type Firestore,
  type Timestamp,
} from "firebase/firestore";
import { z } from "zod";

import {
  AUTOMATION_EXECUTION_STATES,
  AUTOMATION_RUN_ACTIONS,
  CARE_ENROLLMENT_ACTIONS,
  CARE_ENROLLMENT_STATES,
  CARE_PATHWAY_SUPPRESSIONS,
  EXECUTABLE_AUTOMATION_FAMILIES,
  assertAutomationActivationProof,
  assertAutomationDefinitionEventBinding,
  assertAutomationRunEventSecretBinding,
  assertAutomationRunOperationalState,
  assertAutomationRunEventTrace,
  assertAutomationRunSecretReceiptLink,
  assertAutomationTriggerReceiptChronology,
  assertAutomationTriggerReceiptRunBinding,
  assertAutomationWorkItemLifecycle,
  assertCareEnrollmentEventTrace,
  assertCareEnrollmentOperationalState,
  assertCareEnrollmentReceiptAggregateBinding,
  assertCareEnrollmentReceiptChronology,
  assertCareEnrollmentSecretReceiptLink,
  assertCareEscalationLifecycle,
  assertCareHandoffLifecycle,
  assertCarePathwayActivationProof,
  assertCarePathwayEventBinding,
  type AuthoritativeAutomationDefinition,
  type AuthoritativeCarePathway,
  type AutomationDefinitionSecretProjection,
  type AutomationRunEventSecretProjection,
  type AutomationRunSecretProjection,
  type AutomationTriggerReceiptSecretProjection,
  type AutomationWorkItemSecretProjection,
  type CareEnrollmentEventSecretProjection,
  type CareEnrollmentReceiptSecretProjection,
  type CareEnrollmentSecretProjection,
  type CareEscalationSecretProjection,
  type CarePathwaySecretProjection,
  type StaffSafeAutomationActivation,
  type StaffSafeAutomationDefinitionEvent,
  type StaffSafeAutomationRun,
  type StaffSafeAutomationRunEvent,
  type StaffSafeAutomationWorkItem,
  type StaffSafeCareEnrollment,
  type StaffSafeCareEnrollmentEvent,
  type StaffSafeCareEscalation,
  type StaffSafeCareHandoff,
  type StaffSafeCarePathwayActivation,
  type StaffSafeCarePathwayEvent,
} from "../../domain/automations";
import {
  assertAutomationDefinitionSecretCrossBinding,
  assertCarePathwaySecretCrossBinding,
  serializeAutomationDefinitionApproval,
  serializeAutomationDefinitionContent,
  serializeCarePathwayApproval,
  serializeCarePathwayContent,
} from "../../domain/automation-governance";

/**
 * Phase 5 is a server-governed synthetic read model. These are the only new
 * collection names; every client mutation and every secret read is denied by
 * Firestore Rules.
 */
export const PHASE5_STAFF_COLLECTIONS = [
  "automationDefinitions",
  "automationActivations",
  "automationDefinitionEvents",
  "automationRuns",
  "automationRunEvents",
  "automationWorkItems",
  "carePathways",
  "carePathwayActivations",
  "carePathwayEvents",
  "careEnrollments",
  "careEnrollmentEvents",
  "careEscalations",
  "careHandoffs",
] as const;

export const PHASE5_SECRET_COLLECTIONS = [
  "automationDefinitionSecrets",
  "automationTriggerReceipts",
  "automationRunSecrets",
  "automationRunEventSecrets",
  "automationWorkItemSecrets",
  "carePathwaySecrets",
  "careEnrollmentReceipts",
  "careEnrollmentSecrets",
  "careEnrollmentEventSecrets",
  "careEscalationSecrets",
] as const;

export const PHASE5_COLLECTIONS = [
  ...PHASE5_STAFF_COLLECTIONS,
  ...PHASE5_SECRET_COLLECTIONS,
] as const;

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Identifier contains unsupported characters");
const boundedText = (maximum: number) => z.string().min(1).max(maximum);
const digest = z.string().regex(/^[0-9a-f]{64}$/, "Expected a lowercase SHA-256 digest");
const encryptedReference = z
  .string()
  .min(8)
  .max(512)
  .regex(/^(?:encrypted|demo):\/\//, "Expected an approved encrypted/demo reference");
const timestampValue = z.custom<Timestamp>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof value.toDate === "function" &&
    "toMillis" in value &&
    typeof value.toMillis === "function" &&
    Number.isFinite(value.toMillis()),
  "Expected a native Firestore Timestamp",
);
const zero = z.literal(0);
const schemaVersion = z.literal(1);
const synthetic = z.literal(true);
const revision = z.number().int().min(1).max(1_000_000);
const pageSize = z.number().int().min(1).max(100).optional();

const consentPurpose = z.enum([
  "appointment_service",
  "laboratory_service",
  "care_pathway",
  "feedback",
  "health_campaigns",
  "event_campaigns",
  "transactional_updates",
]);
const automationFamily = z.enum([
  "appointment_service",
  "laboratory_service",
  "care_pathway",
  "feedback",
  "inbound_routing",
  "campaign_response",
  "scheduled_service",
]);
const executableAutomationFamily = z.enum(EXECUTABLE_AUTOMATION_FAMILIES);
const automationTrigger = z.enum([
  "inbound_intent",
  "appointment_event",
  "lims_report_ready",
  "discharge_event",
  "scheduled_time",
  "campaign_response",
  "agent_action",
]);
const automationState = z.enum(AUTOMATION_EXECUTION_STATES);
const automationAction = z.enum(AUTOMATION_RUN_ACTIONS);
const automationOutcome = z.enum([
  "accepted",
  "step_completed",
  "wait_scheduled",
  "human_takeover_required",
  "fallback_work_item_created",
  "fallback_stopped_safely",
  "retry_scheduled",
  "completed",
  "ended_by_operator",
  "synthetic_failure",
]);
const automationReason = z.enum([
  "trigger_accepted",
  "step_policy_applied",
  "operator_requested",
  "human_takeover",
  "integration_timeout",
  "synthetic_failure",
  "retry_policy_applied",
  "fallback_policy_applied",
  "policy_complete",
  "synthetic_test",
]);
const automationLifecycle = z.enum(["draft", "review_pending", "approved", "retired"]);
const careState = z.enum(CARE_ENROLLMENT_STATES);
const careAction = z.enum(CARE_ENROLLMENT_ACTIONS);
const careSuppression = z.enum(CARE_PATHWAY_SUPPRESSIONS);
const careOutcome = z.enum([
  "accepted",
  "contact_advanced",
  "suppressed_terminal",
  "clinical_hold_applied",
  "human_takeover_required",
  "red_flag_escalated",
  "escalation_acknowledged",
  "escalation_resolved_safety_hold",
  "escalation_resolved_terminal_suppression",
  "safety_hold_cleared",
  "completed",
  "ended_by_operator",
]);
const careLifecycle = z.enum(["draft", "clinical_review", "approved", "retired"]);
const escalationState = z.enum(["open", "acknowledged", "resolved"]);

const governedActor = z.discriminatedUnion("actorKind", [
  z.object({ actorKind: z.literal("system"), actorUid: z.null() }).strict(),
  z.object({ actorKind: z.literal("staff"), actorUid: identifier }).strict(),
]);

const commonEntityShape = {
  id: identifier,
  workspaceId: identifier,
  createdAt: timestampValue,
  updatedAt: timestampValue,
};
const safeProjectionShape = {
  schemaVersion,
  synthetic,
  externalDispatchCount: zero,
  networkCallCount: zero,
};

const automationStepSchema = z
  .object({
    id: identifier,
    kind: z.enum(["send_template", "wait", "request_appointment_action", "route_to_team", "stop"]),
    templateVersionId: identifier.nullable(),
    templateContentHash: digest.nullable(),
    waitSeconds: z.number().int().min(1).max(31_536_000).nullable(),
    appointmentAction: z.enum(["confirm", "reschedule", "cancel"]).nullable(),
    routeTeamId: identifier.nullable(),
    stopReasonCode: z
      .enum([
        "policy_complete",
        "consent_unavailable",
        "service_window_closed",
        "synthetic_safe_stop",
      ])
      .nullable(),
    requiredConsentPurpose: consentPurpose,
    serviceWindowBehavior: z.enum(["send_in_window", "use_approved_template", "do_not_send"]),
    timeoutSeconds: z.number().int().min(1).max(86_400),
    retryMaxAttempts: z.number().int().min(0).max(10),
    retryInitialBackoffSeconds: z.number().int().min(0).max(86_400),
    retryMaximumBackoffSeconds: z.number().int().min(0).max(86_400),
    fallback: z.enum(["create_work_item", "route_to_human", "stop_run"]),
  })
  .strict();

const automationDefinitionDocumentSchema = z
  .object({
    ...commonEntityShape,
    family: automationFamily,
    version: z.number().int().min(1).max(1_000_000),
    name: boundedText(160),
    trigger: automationTrigger,
    consentPurpose,
    riskLevel: z.enum(["low", "medium", "high"]),
    steps: z.array(automationStepSchema).min(1).max(32),
    contentHash: digest,
    secretBindingHash: digest,
    ownerUid: identifier,
    approverUid: identifier.nullable(),
    approvalHash: digest.nullable(),
    approvalScope: z.literal("simulation_only").nullable(),
    approvedAt: timestampValue.nullable(),
    lifecycleState: automationLifecycle,
    schemaVersion,
    synthetic,
  })
  .strict()
  .superRefine((value, context) => {
    const approvalFields = [value.approverUid, value.approvalHash, value.approvalScope, value.approvedAt];
    const hasApproval = approvalFields.every((field) => field !== null);
    const hasPartialApproval = approvalFields.some((field) => field !== null) && !hasApproval;
    if (hasPartialApproval || (hasApproval && value.approverUid === value.ownerUid)) {
      context.addIssue({ code: "custom", path: ["approverUid"], message: "Approval evidence must be complete and independent" });
    }
    if ((value.lifecycleState === "approved" && !hasApproval) ||
        ((value.lifecycleState === "draft" || value.lifecycleState === "review_pending") && hasApproval)) {
      context.addIssue({ code: "custom", path: ["lifecycleState"], message: "Lifecycle and approval evidence disagree" });
    }
  });

const automationActivationDocumentSchema = z
  .object({
    id: executableAutomationFamily,
    workspaceId: identifier,
    family: executableAutomationFamily,
    activeDefinitionId: identifier,
    activeDefinitionVersion: z.number().int().min(1).max(1_000_000),
    activeDefinitionContentHash: digest,
    activeDefinitionApprovalHash: digest,
    activeDefinitionApprovalScope: z.literal("simulation_only"),
    activeDefinitionSecretBindingHash: digest,
    activatedByUid: identifier,
    activatedAt: timestampValue,
    activationEventId: identifier,
    activationAuditEventId: identifier,
    revision,
    createdAt: timestampValue,
    updatedAt: timestampValue,
    ...safeProjectionShape,
  })
  .strict();

const automationDefinitionEventDocumentSchema = z
  .object({
    id: identifier,
    workspaceId: identifier,
    family: automationFamily,
    eventType: z.enum(["created", "review_requested", "approved", "activated", "retired"]),
    definitionId: identifier,
    definitionVersion: z.number().int().min(1).max(1_000_000),
    definitionContentHash: digest,
    definitionApprovalHash: digest.nullable(),
    definitionApprovalScope: z.literal("simulation_only").nullable(),
    definitionSecretBindingHash: digest,
    fromLifecycleState: automationLifecycle.nullable(),
    toLifecycleState: automationLifecycle,
    revision,
    auditEventId: identifier,
    occurredAt: timestampValue,
    ...safeProjectionShape,
    actorKind: z.literal("staff"),
    actorUid: identifier,
  })
  .strict();

const automationRunDocumentSchema = z
  .object({
    ...commonEntityShape,
    definitionId: identifier,
    definitionVersion: z.number().int().min(1).max(1_000_000),
    definitionContentHash: digest,
    teamId: identifier,
    locationId: identifier,
    state: automationState,
    pausedFromState: z.enum(["queued", "running", "waiting", "failed"]).nullable(),
    nextEligibleAt: timestampValue.nullable(),
    openWorkItemId: identifier.nullable(),
    currentStepIndex: z.number().int().min(0).max(32),
    completedStepCount: z.number().int().min(0).max(32),
    attemptCount: z.number().int().min(0).max(11),
    revision,
    outcomeCode: automationOutcome,
    lastEventId: identifier.nullable(),
    ...safeProjectionShape,
  })
  .strict();

const automationRunEventDocumentSchema = z
  .object({
    id: identifier,
    workspaceId: identifier,
    runId: identifier,
    definitionId: identifier,
    definitionVersion: z.number().int().min(1).max(1_000_000),
    definitionContentHash: digest,
    teamId: identifier,
    locationId: identifier,
    revision,
    auditEventId: identifier,
    action: automationAction,
    fromState: automationState,
    toState: automationState,
    stepIndex: z.number().int().min(0).max(31).nullable(),
    stepId: identifier.nullable(),
    attemptNumber: z.number().int().min(0).max(11),
    workItemId: identifier.nullable(),
    nextEligibleAt: timestampValue.nullable(),
    reasonCode: automationReason,
    evidenceFingerprint: digest,
    outcomeCode: automationOutcome,
    occurredAt: timestampValue,
    ...safeProjectionShape,
    actorKind: z.enum(["system", "staff"]),
    actorUid: identifier.nullable(),
  })
  .strict();

const automationWorkItemDocumentSchema = z
  .object({
    ...commonEntityShape,
    runId: identifier,
    definitionId: identifier,
    definitionVersion: z.number().int().min(1).max(1_000_000),
    definitionContentHash: digest,
    teamId: identifier,
    locationId: identifier,
    reasonCode: z.enum([
      "integration_timeout",
      "retry_exhausted",
      "fallback_route",
      "human_takeover",
      "synthetic_failure",
    ]),
    state: z.enum(["open", "acknowledged", "resolved"]),
    openedAt: timestampValue,
    slaMinutes: z.number().int().min(1).max(1_440),
    dueAt: timestampValue,
    assignedMemberUid: identifier.nullable(),
    acknowledgedAt: timestampValue.nullable(),
    acknowledgedByUid: identifier.nullable(),
    resolvedAt: timestampValue.nullable(),
    resolvedByUid: identifier.nullable(),
    resolutionCode: z.enum(["retried", "routed_to_human", "stopped_safely"]).nullable(),
    revision,
    lastEventId: identifier,
    ...safeProjectionShape,
  })
  .strict();

const localizedTemplateBindingSchema = z
  .object({ templateVersionId: identifier, contentHash: digest })
  .strict();
const careContactPointSchema = z
  .object({
    dayOffset: z.number().int().min(1).max(365),
    en: localizedTemplateBindingSchema,
    si: localizedTemplateBindingSchema,
    ta: localizedTemplateBindingSchema,
  })
  .strict();

const carePathwayDocumentSchema = z
  .object({
    ...commonEntityShape,
    family: z.literal("post_discharge"),
    protocolVersion: boundedText(64),
    name: boundedText(160),
    clinicalOwnerUid: identifier,
    clinicalApproverUid: identifier.nullable(),
    contactPoints: z.array(careContactPointSchema).min(1).max(32),
    responseSlaMinutes: z.number().int().min(1).max(1_440),
    escalationTeamId: identifier,
    eligibleLocationIds: z.array(identifier).min(1).max(64),
    afterHoursBehavior: z.enum(["emergency_path", "next_business_day", "on_call_queue"]),
    writeBackRequired: z.boolean(),
    instructionsSource: z.literal("clinician_authored"),
    aiMayGenerateInstructions: z.literal(false),
    suppressions: z.tuple([
      z.literal("readmission"),
      z.literal("transfer"),
      z.literal("death"),
      z.literal("clinical_hold"),
      z.literal("withdrawal"),
      z.literal("invalid_contact"),
    ]),
    protectedContentHash: digest,
    secretBindingHash: digest,
    contentHash: digest,
    approvalHash: digest.nullable(),
    approvalScope: z.literal("clinical_simulation_only").nullable(),
    approvedAt: timestampValue.nullable(),
    lifecycleState: careLifecycle,
    schemaVersion,
    synthetic,
  })
  .strict()
  .superRefine((value, context) => {
    const approvalFields = [value.clinicalApproverUid, value.approvalHash, value.approvalScope, value.approvedAt];
    const hasApproval = approvalFields.every((field) => field !== null);
    const hasPartialApproval = approvalFields.some((field) => field !== null) && !hasApproval;
    if (hasPartialApproval || (hasApproval && value.clinicalApproverUid === value.clinicalOwnerUid)) {
      context.addIssue({ code: "custom", path: ["clinicalApproverUid"], message: "Clinical approval evidence must be complete and independent" });
    }
    if ((value.lifecycleState === "approved" && !hasApproval) ||
        ((value.lifecycleState === "draft" || value.lifecycleState === "clinical_review") && hasApproval)) {
      context.addIssue({ code: "custom", path: ["lifecycleState"], message: "Lifecycle and clinical approval evidence disagree" });
    }
  });

const carePathwayActivationDocumentSchema = z
  .object({
    id: z.literal("post_discharge"),
    workspaceId: identifier,
    family: z.literal("post_discharge"),
    activePathwayId: identifier,
    activeProtocolVersion: boundedText(64),
    activePathwayContentHash: digest,
    activePathwayApprovalHash: digest,
    activePathwayApprovalScope: z.literal("clinical_simulation_only"),
    activePathwaySecretBindingHash: digest,
    activatedByUid: identifier,
    activatedAt: timestampValue,
    activationEventId: identifier,
    activationAuditEventId: identifier,
    revision,
    createdAt: timestampValue,
    updatedAt: timestampValue,
    ...safeProjectionShape,
  })
  .strict();

const carePathwayEventDocumentSchema = z
  .object({
    id: identifier,
    workspaceId: identifier,
    family: z.literal("post_discharge"),
    eventType: z.enum(["created", "clinical_review_requested", "approved", "activated", "retired"]),
    pathwayId: identifier,
    pathwayProtocolVersion: boundedText(64),
    pathwayContentHash: digest,
    pathwayApprovalHash: digest.nullable(),
    pathwayApprovalScope: z.literal("clinical_simulation_only").nullable(),
    pathwaySecretBindingHash: digest,
    fromLifecycleState: careLifecycle.nullable(),
    toLifecycleState: careLifecycle,
    revision,
    auditEventId: identifier,
    occurredAt: timestampValue,
    ...safeProjectionShape,
    actorKind: z.literal("staff"),
    actorUid: identifier,
  })
  .strict();

const careEnrollmentDocumentSchema = z
  .object({
    ...commonEntityShape,
    pathwayId: identifier,
    pathwayProtocolVersion: boundedText(64),
    pathwayContentHash: digest,
    teamId: identifier,
    locationId: identifier,
    state: careState,
    nextContactIndex: z.number().int().min(0).max(32),
    nextContactAt: timestampValue.nullable(),
    activeSuppressions: z.array(careSuppression).max(6),
    openEscalationId: identifier.nullable(),
    safetyHoldEscalationId: identifier.nullable(),
    openHandoffId: identifier.nullable(),
    revision,
    outcomeCode: careOutcome,
    lastEventId: identifier.nullable(),
    ...safeProjectionShape,
  })
  .strict();

const careEnrollmentEventDocumentSchema = z
  .object({
    id: identifier,
    workspaceId: identifier,
    enrollmentId: identifier,
    pathwayId: identifier,
    pathwayProtocolVersion: boundedText(64),
    pathwayContentHash: digest,
    teamId: identifier,
    locationId: identifier,
    revision,
    auditEventId: identifier,
    action: careAction,
    fromState: careState,
    toState: careState,
    contactPointIndex: z.number().int().min(0).max(31).nullable(),
    suppressionReason: careSuppression.nullable(),
    escalationId: identifier.nullable(),
    escalationStateBefore: escalationState.nullable(),
    escalationStateAfter: escalationState.nullable(),
    handoffId: identifier.nullable(),
    activeSuppressionsAfter: z.array(careSuppression).max(6),
    nextContactAt: timestampValue.nullable(),
    outcomeCode: careOutcome,
    occurredAt: timestampValue,
    ...safeProjectionShape,
    actorKind: z.enum(["system", "staff"]),
    actorUid: identifier.nullable(),
  })
  .strict();

const careEscalationDocumentSchema = z
  .object({
    ...commonEntityShape,
    enrollmentId: identifier,
    pathwayId: identifier,
    pathwayProtocolVersion: boundedText(64),
    pathwayContentHash: digest,
    teamId: identifier,
    locationId: identifier,
    reasonCode: z.enum(["red_flag_response", "emergency_keyword", "clinical_review_required"]),
    state: escalationState,
    openedAt: timestampValue,
    responseSlaMinutes: z.number().int().min(1).max(1_440),
    responseDueAt: timestampValue,
    openedBy: governedActor,
    acknowledgedAt: timestampValue.nullable(),
    acknowledgedByUid: identifier.nullable(),
    resolvedAt: timestampValue.nullable(),
    resolvedByUid: identifier.nullable(),
    resolutionCode: z.enum(["safety_hold_applied", "terminal_suppression_applied"]).nullable(),
    writeBackRequired: z.boolean(),
    writeBackState: z.enum(["not_required", "pending", "unavailable_in_demo"]),
    revision,
    lastEventId: identifier,
    ...safeProjectionShape,
  })
  .strict();

const careHandoffDocumentSchema = z
  .object({
    ...commonEntityShape,
    enrollmentId: identifier,
    pathwayId: identifier,
    pathwayProtocolVersion: boundedText(64),
    pathwayContentHash: digest,
    teamId: identifier,
    locationId: identifier,
    state: z.enum(["open", "released"]),
    openedEventId: identifier,
    openedBy: governedActor,
    openedAt: timestampValue,
    releasedEventId: identifier.nullable(),
    releasedBy: governedActor.nullable(),
    releasedAt: timestampValue.nullable(),
    revision: z.number().int().min(1).max(999_999),
    lastEventId: identifier,
    ...safeProjectionShape,
  })
  .strict();

const auditMetadataValue = z.union([z.string().max(256), z.number().finite(), z.boolean(), z.null()]);
const phase5AuditDocumentSchema = z
  .object({
    id: identifier,
    workspaceId: identifier,
    actorUid: identifier,
    actorType: z.enum(["user", "service", "system"]),
    action: boundedText(128),
    resourceType: boundedText(80),
    resourceId: identifier,
    requestId: identifier,
    outcome: z.enum(["allowed", "denied", "failed", "simulated"]),
    metadata: z
      .record(z.string().min(1).max(64), auditMetadataValue)
      .refine((value) => Object.keys(value).length <= 32, "Audit metadata is bounded to 32 fields"),
    occurredAt: timestampValue,
    createdAt: timestampValue,
    synthetic,
    schemaVersion,
  })
  .strict();

const automationDefinitionSecretSchema = z
  .object({
    workspaceId: identifier,
    definitionId: identifier,
    protectedConfigurationRef: encryptedReference,
    configurationFingerprint: digest,
    schemaVersion,
    synthetic,
  })
  .strict();
const automationTriggerReceiptSchema = z
  .object({
    id: digest,
    workspaceId: identifier,
    family: executableAutomationFamily,
    definitionId: identifier,
    definitionVersion: z.number().int().min(1).max(1_000_000),
    definitionContentHash: digest,
    definitionApprovalHash: digest,
    activationEventId: identifier,
    sourceEventFingerprint: digest,
    triggerFingerprint: digest,
    runId: identifier,
    createdAt: timestampValue,
    schemaVersion,
    synthetic,
  })
  .strict();
const automationRunSecretSchema = z
  .object({
    workspaceId: identifier,
    runId: identifier,
    protectedContactRef: encryptedReference,
    protectedConversationRef: encryptedReference,
    protectedAppointmentRef: encryptedReference.nullable(),
    triggerFingerprint: digest,
    idempotencyFingerprint: digest,
    schemaVersion,
    synthetic,
  })
  .strict();
const automationRunEventSecretSchema = z
  .object({
    workspaceId: identifier,
    runId: identifier,
    eventId: identifier,
    protectedContextRef: encryptedReference,
    contextFingerprint: digest,
    schemaVersion,
    synthetic,
  })
  .strict();
const automationWorkItemSecretSchema = z
  .object({
    workspaceId: identifier,
    runId: identifier,
    workItemId: identifier,
    protectedContextRef: encryptedReference,
    contextFingerprint: digest,
    schemaVersion,
    synthetic,
  })
  .strict();
const carePathwaySecretSchema = z
  .object({
    workspaceId: identifier,
    pathwayId: identifier,
    protectedInstructionsRef: encryptedReference,
    protectedContentFingerprint: digest,
    schemaVersion,
    synthetic,
  })
  .strict();
const careEnrollmentReceiptSchema = z
  .object({
    id: digest,
    workspaceId: identifier,
    family: z.literal("post_discharge"),
    pathwayId: identifier,
    pathwayProtocolVersion: boundedText(64),
    pathwayContentHash: digest,
    pathwayApprovalHash: digest,
    activationEventId: identifier,
    dischargeFingerprint: digest,
    qualifyingDischargeAt: timestampValue,
    receiptFingerprint: digest,
    enrollmentId: identifier,
    createdAt: timestampValue,
    schemaVersion,
    synthetic,
  })
  .strict();
const careEnrollmentSecretSchema = z
  .object({
    workspaceId: identifier,
    enrollmentId: identifier,
    protectedContactRef: encryptedReference,
    protectedConversationRef: encryptedReference,
    protectedQualifyingDischargeRef: encryptedReference,
    qualifyingDischargeAt: timestampValue,
    subjectFingerprint: digest,
    sourceDischargeFingerprint: digest,
    receiptId: digest,
    receiptFingerprint: digest,
    schemaVersion,
    synthetic,
  })
  .strict();
const careEnrollmentEventSecretSchema = z
  .object({
    workspaceId: identifier,
    enrollmentId: identifier,
    eventId: identifier,
    protectedContextRef: encryptedReference,
    contextFingerprint: digest,
    schemaVersion,
    synthetic,
  })
  .strict();
const careEscalationSecretSchema = z
  .object({
    workspaceId: identifier,
    enrollmentId: identifier,
    escalationId: identifier,
    protectedContextRef: encryptedReference,
    contextFingerprint: digest,
    schemaVersion,
    synthetic,
  })
  .strict();

const automationCatalogueListInputSchema = z
  .object({ workspaceId: identifier, family: executableAutomationFamily, pageSize })
  .strict();
const definitionEventListInputSchema = z
  .object({ workspaceId: identifier, definitionId: identifier, pageSize })
  .strict();
const careCatalogueListInputSchema = z
  .object({ workspaceId: identifier, family: z.literal("post_discharge"), pageSize })
  .strict();
const pathwayEventListInputSchema = z
  .object({ workspaceId: identifier, pathwayId: identifier, pageSize })
  .strict();
const exactGetInputSchema = z
  .object({ workspaceId: identifier, id: identifier })
  .strict();
const automationActivationGetInputSchema = z
  .object({ workspaceId: identifier, family: executableAutomationFamily })
  .strict();
const carePathwayActivationGetInputSchema = z
  .object({ workspaceId: identifier })
  .strict();

export type AutomationCatalogueListInput = z.infer<typeof automationCatalogueListInputSchema>;
export type AutomationDefinitionEventListInput = z.infer<typeof definitionEventListInputSchema>;
export type CareCatalogueListInput = z.infer<typeof careCatalogueListInputSchema>;
export type CarePathwayEventListInput = z.infer<typeof pathwayEventListInputSchema>;
export type Phase5ExactGetInput = z.infer<typeof exactGetInputSchema>;
export type AutomationActivationGetInput = z.infer<
  typeof automationActivationGetInputSchema
>;
export type CarePathwayActivationGetInput = z.infer<
  typeof carePathwayActivationGetInputSchema
>;
export interface Phase5AuditRecordDTO {
  readonly id: string;
  readonly workspaceId: string;
  readonly actorUid: string;
  readonly actorType: "user" | "service" | "system";
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly outcome: "allowed" | "denied" | "failed" | "simulated";
  readonly requestId: string;
  readonly occurredAt: string;
  readonly createdAt: string;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
  readonly synthetic: true;
  readonly schemaVersion: 1;
}

export class AutomationCareRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_input" | "invalid_persisted_data" | "not_found",
  ) {
    super(message);
    this.name = "AutomationCareRepositoryError";
  }
}

type Sha256 = (canonicalValue: string) => string;

function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AutomationCareRepositoryError("Automation/care input failed validation.", "invalid_input");
  }
  return parsed.data;
}

function parsePersisted<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AutomationCareRepositoryError(
      `${label} failed strict persisted schema validation.`,
      "invalid_persisted_data",
    );
  }
  return parsed.data;
}

function validateDomain(label: string, validate: () => void): void {
  try {
    validate();
  } catch {
    throw new AutomationCareRepositoryError(
      `${label} failed governed domain validation.`,
      "invalid_persisted_data",
    );
  }
}

function timestampToIso(value: Timestamp): string {
  return value.toDate().toISOString();
}

function nullableTimestampToIso(value: Timestamp | null): string | null {
  return value === null ? null : timestampToIso(value);
}

async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new AutomationCareRepositoryError(
      "Governed content hash verification is unavailable.",
      "invalid_persisted_data",
    );
  }
  const result = await subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(result)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function assertPathIdentity(
  value: { readonly id: string; readonly workspaceId: string },
  documentId: string,
  workspaceId: string,
  label: string,
): void {
  if (value.id !== documentId || value.workspaceId !== workspaceId) {
    throw new AutomationCareRepositoryError(
      `${label} identity does not match its tenant document path.`,
      "invalid_persisted_data",
    );
  }
}

function assertSecretPathIdentity(
  actualId: string,
  actualWorkspaceId: string,
  documentId: string,
  workspaceId: string,
  label: string,
): void {
  if (actualId !== documentId || actualWorkspaceId !== workspaceId) {
    throw new AutomationCareRepositoryError(
      `${label} identity does not match its server-only tenant path.`,
      "invalid_persisted_data",
    );
  }
}

function assertEntityTimestamps(
  value: { readonly createdAt: Timestamp; readonly updatedAt: Timestamp },
  label: string,
): void {
  if (value.updatedAt.toMillis() < value.createdAt.toMillis()) {
    throw new AutomationCareRepositoryError(
      `${label} timestamps are not monotonic.`,
      "invalid_persisted_data",
    );
  }
}

function assertCareEnrollmentAggregateEnvelope(enrollment: StaffSafeCareEnrollment): void {
  const isInitial = enrollment.revision === 1;
  const outcomeMatchesState =
    (enrollment.state === "queued" && enrollment.outcomeCode === "accepted") ||
    (enrollment.state === "active" &&
      ["accepted", "contact_advanced"].includes(enrollment.outcomeCode)) ||
    (enrollment.state === "paused_by_operator" &&
      ["accepted", "safety_hold_cleared"].includes(enrollment.outcomeCode)) ||
    (enrollment.state === "paused_for_safety" &&
      [
        "clinical_hold_applied",
        "escalation_resolved_safety_hold",
        "safety_hold_cleared",
      ].includes(enrollment.outcomeCode)) ||
    (enrollment.state === "paused_for_human" &&
      enrollment.outcomeCode === "human_takeover_required") ||
    (enrollment.state === "escalated" &&
      [
        "red_flag_escalated",
        "escalation_acknowledged",
        "suppressed_terminal",
        "clinical_hold_applied",
      ].includes(enrollment.outcomeCode)) ||
    (enrollment.state === "completed" && enrollment.outcomeCode === "completed") ||
    (enrollment.state === "ended" &&
      [
        "suppressed_terminal",
        "escalation_resolved_terminal_suppression",
        "ended_by_operator",
      ].includes(enrollment.outcomeCode));
  if (
    enrollment.revision < 1 ||
    enrollment.revision > 1_000_000 ||
    (isInitial &&
      (enrollment.lastEventId !== null ||
        enrollment.state !== "queued" ||
        enrollment.outcomeCode !== "accepted")) ||
    (!isInitial && enrollment.lastEventId === null) ||
    !outcomeMatchesState
  ) {
    throw new AutomationCareRepositoryError(
      "Care enrollment revision, event pointer, state and outcome are inconsistent.",
      "invalid_persisted_data",
    );
  }
}

function assertAutomationRunAggregateEnvelope(run: StaffSafeAutomationRun): void {
  const isInitial = run.revision === 1;
  const outcomeMatchesState =
    (run.state === "queued" && run.outcomeCode === "accepted") ||
    (run.state === "running" && ["accepted", "step_completed"].includes(run.outcomeCode)) ||
    (run.state === "waiting" &&
      ["accepted", "wait_scheduled", "retry_scheduled"].includes(run.outcomeCode)) ||
    (run.state === "paused_for_human" &&
      run.outcomeCode === "human_takeover_required") ||
    (run.state === "paused_by_operator" &&
      ["accepted", "fallback_work_item_created"].includes(run.outcomeCode)) ||
    (run.state === "failed" &&
      ["accepted", "synthetic_failure"].includes(run.outcomeCode)) ||
    (run.state === "completed" && run.outcomeCode === "completed") ||
    (run.state === "ended" &&
      ["fallback_stopped_safely", "ended_by_operator"].includes(run.outcomeCode));
  if (
    (isInitial &&
      (run.lastEventId !== null ||
        run.state !== "queued" ||
        run.outcomeCode !== "accepted" ||
        run.currentStepIndex !== 0 ||
        run.completedStepCount !== 0 ||
        run.attemptCount !== 0 ||
        run.openWorkItemId !== null)) ||
    (!isInitial && run.lastEventId === null) ||
    run.completedStepCount !== run.currentStepIndex ||
    (run.state === "running" && run.attemptCount !== 0) ||
    !outcomeMatchesState
  ) {
    throw new AutomationCareRepositoryError(
      "Automation run revision, event pointer, state and outcome are inconsistent.",
      "invalid_persisted_data",
    );
  }
}

export function prepareAutomationCatalogueListInput(
  input: AutomationCatalogueListInput,
): AutomationCatalogueListInput {
  return parseInput(automationCatalogueListInputSchema, input);
}

export function prepareAutomationDefinitionEventListInput(
  input: AutomationDefinitionEventListInput,
): AutomationDefinitionEventListInput {
  return parseInput(definitionEventListInputSchema, input);
}

export function prepareCareCatalogueListInput(input: CareCatalogueListInput): CareCatalogueListInput {
  return parseInput(careCatalogueListInputSchema, input);
}

export function prepareCarePathwayEventListInput(
  input: CarePathwayEventListInput,
): CarePathwayEventListInput {
  return parseInput(pathwayEventListInputSchema, input);
}

export function preparePhase5ExactGetInput(input: Phase5ExactGetInput): Phase5ExactGetInput {
  return parseInput(exactGetInputSchema, input);
}

export function parseAutomationDefinitionDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): AuthoritativeAutomationDefinition {
  const parsed = parsePersisted(
    automationDefinitionDocumentSchema,
    value,
    "Automation definition",
  );
  assertPathIdentity(parsed, documentId, workspaceId, "Automation definition");
  assertEntityTimestamps(parsed, "Automation definition");
  const dto = {
    ...parsed,
    createdAt: timestampToIso(parsed.createdAt),
    updatedAt: timestampToIso(parsed.updatedAt),
    approvedAt: nullableTimestampToIso(parsed.approvedAt),
  } as unknown as AuthoritativeAutomationDefinition;
  validateDomain("Automation definition", () => {
    serializeAutomationDefinitionContent({
      workspaceId: dto.workspaceId,
      definitionId: dto.id,
      family: dto.family,
      version: dto.version,
      name: dto.name,
      trigger: dto.trigger,
      consentPurpose: dto.consentPurpose,
      riskLevel: dto.riskLevel,
      steps: dto.steps,
      secretBindingHash: dto.secretBindingHash,
      synthetic: dto.synthetic,
    });
    if (
      dto.approverUid !== null &&
      dto.approvalHash !== null &&
      dto.approvalScope !== null &&
      dto.approvedAt !== null
    ) {
      serializeAutomationDefinitionApproval({
        workspaceId: dto.workspaceId,
        definitionId: dto.id,
        contentHash: dto.contentHash,
        ownerUid: dto.ownerUid,
        approverUid: dto.approverUid,
        scope: dto.approvalScope,
        approvedAt: dto.approvedAt,
      });
    }
  });
  return dto;
}

export function assertAutomationDefinitionGovernanceHashes(
  definition: AuthoritativeAutomationDefinition,
  sha256: Sha256,
): void {
  const computedContentHash = sha256(
    serializeAutomationDefinitionContent({
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
      synthetic: definition.synthetic,
    }),
  );
  if (computedContentHash !== definition.contentHash) {
    throw new AutomationCareRepositoryError(
      "Automation definition contentHash does not bind its canonical content.",
      "invalid_persisted_data",
    );
  }
  if (
    definition.approverUid !== null &&
    definition.approvalHash !== null &&
    definition.approvalScope !== null &&
    definition.approvedAt !== null
  ) {
    const computedApprovalHash = sha256(
      serializeAutomationDefinitionApproval({
        workspaceId: definition.workspaceId,
        definitionId: definition.id,
        contentHash: definition.contentHash,
        ownerUid: definition.ownerUid,
        approverUid: definition.approverUid,
        scope: definition.approvalScope,
        approvedAt: definition.approvedAt,
      }),
    );
    if (computedApprovalHash !== definition.approvalHash) {
      throw new AutomationCareRepositoryError(
        "Automation definition approvalHash does not bind its approval evidence.",
        "invalid_persisted_data",
      );
    }
  }
}

export async function verifyAutomationDefinitionGovernanceHashes(
  definition: AuthoritativeAutomationDefinition,
): Promise<AuthoritativeAutomationDefinition> {
  const digestCache = new Map<string, string>();
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
    synthetic: definition.synthetic,
  });
  digestCache.set(canonicalContent, await sha256Hex(canonicalContent));
  if (
    definition.approverUid !== null &&
    definition.approvalHash !== null &&
    definition.approvalScope !== null &&
    definition.approvedAt !== null
  ) {
    const canonicalApproval = serializeAutomationDefinitionApproval({
      workspaceId: definition.workspaceId,
      definitionId: definition.id,
      contentHash: definition.contentHash,
      ownerUid: definition.ownerUid,
      approverUid: definition.approverUid,
      scope: definition.approvalScope,
      approvedAt: definition.approvedAt,
    });
    digestCache.set(canonicalApproval, await sha256Hex(canonicalApproval));
  }
  assertAutomationDefinitionGovernanceHashes(definition, (value) => {
    const computed = digestCache.get(value);
    if (computed === undefined) {
      throw new AutomationCareRepositoryError(
        "Automation governance digest verification was incomplete.",
        "invalid_persisted_data",
      );
    }
    return computed;
  });
  return definition;
}

export function parseAutomationActivationDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): StaffSafeAutomationActivation {
  const parsed = parsePersisted(
    automationActivationDocumentSchema,
    value,
    "Automation activation",
  );
  assertPathIdentity(parsed, documentId, workspaceId, "Automation activation");
  assertEntityTimestamps(parsed, "Automation activation");
  if (parsed.id !== parsed.family) {
    throw new AutomationCareRepositoryError(
      "Automation activation path must equal its executable family.",
      "invalid_persisted_data",
    );
  }
  return {
    ...parsed,
    activatedAt: timestampToIso(parsed.activatedAt),
    createdAt: timestampToIso(parsed.createdAt),
    updatedAt: timestampToIso(parsed.updatedAt),
  } as unknown as StaffSafeAutomationActivation;
}

export function parseAutomationDefinitionEventDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): StaffSafeAutomationDefinitionEvent {
  const parsed = parsePersisted(
    automationDefinitionEventDocumentSchema,
    value,
    "Automation definition event",
  );
  assertPathIdentity(parsed, documentId, workspaceId, "Automation definition event");
  const dto = {
    ...parsed,
    occurredAt: timestampToIso(parsed.occurredAt),
  } as unknown as StaffSafeAutomationDefinitionEvent;
  validateDomain("Automation definition event", () => assertAutomationDefinitionEventBinding(dto));
  return dto;
}

export function parseAutomationRunDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): StaffSafeAutomationRun {
  const parsed = parsePersisted(automationRunDocumentSchema, value, "Automation run");
  assertPathIdentity(parsed, documentId, workspaceId, "Automation run");
  assertEntityTimestamps(parsed, "Automation run");
  const dto = {
    ...parsed,
    nextEligibleAt: nullableTimestampToIso(parsed.nextEligibleAt),
    createdAt: timestampToIso(parsed.createdAt),
    updatedAt: timestampToIso(parsed.updatedAt),
  } as unknown as StaffSafeAutomationRun;
  validateDomain("Automation run", () => assertAutomationRunOperationalState(dto));
  assertAutomationRunAggregateEnvelope(dto);
  return dto;
}

export function parseAutomationRunEventDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): StaffSafeAutomationRunEvent {
  const parsed = parsePersisted(
    automationRunEventDocumentSchema,
    value,
    "Automation run event",
  );
  assertPathIdentity(parsed, documentId, workspaceId, "Automation run event");
  const dto = {
    ...parsed,
    nextEligibleAt: nullableTimestampToIso(parsed.nextEligibleAt),
    occurredAt: timestampToIso(parsed.occurredAt),
  } as unknown as StaffSafeAutomationRunEvent;
  validateDomain("Automation run event", () => assertAutomationRunEventTrace(dto));
  return dto;
}

export function parseAutomationWorkItemDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): StaffSafeAutomationWorkItem {
  const parsed = parsePersisted(
    automationWorkItemDocumentSchema,
    value,
    "Automation work item",
  );
  assertPathIdentity(parsed, documentId, workspaceId, "Automation work item");
  assertEntityTimestamps(parsed, "Automation work item");
  const dto = {
    ...parsed,
    openedAt: timestampToIso(parsed.openedAt),
    dueAt: timestampToIso(parsed.dueAt),
    acknowledgedAt: nullableTimestampToIso(parsed.acknowledgedAt),
    resolvedAt: nullableTimestampToIso(parsed.resolvedAt),
    createdAt: timestampToIso(parsed.createdAt),
    updatedAt: timestampToIso(parsed.updatedAt),
  } as unknown as StaffSafeAutomationWorkItem;
  validateDomain("Automation work item", () => assertAutomationWorkItemLifecycle(dto));
  return dto;
}

export function parseCarePathwayDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): AuthoritativeCarePathway {
  const parsed = parsePersisted(carePathwayDocumentSchema, value, "Care pathway");
  assertPathIdentity(parsed, documentId, workspaceId, "Care pathway");
  assertEntityTimestamps(parsed, "Care pathway");
  const dto = {
    ...parsed,
    approvedAt: nullableTimestampToIso(parsed.approvedAt),
    createdAt: timestampToIso(parsed.createdAt),
    updatedAt: timestampToIso(parsed.updatedAt),
  } as unknown as AuthoritativeCarePathway;
  validateDomain("Care pathway", () => {
    serializeCarePathwayContent({
      workspaceId: dto.workspaceId,
      pathwayId: dto.id,
      family: dto.family,
      protocolVersion: dto.protocolVersion,
      name: dto.name,
      clinicalOwnerUid: dto.clinicalOwnerUid,
      contactPoints: dto.contactPoints,
      responseSlaMinutes: dto.responseSlaMinutes,
      escalationTeamId: dto.escalationTeamId,
      eligibleLocationIds: dto.eligibleLocationIds,
      afterHoursBehavior: dto.afterHoursBehavior,
      writeBackRequired: dto.writeBackRequired,
      instructionsSource: dto.instructionsSource,
      aiMayGenerateInstructions: dto.aiMayGenerateInstructions,
      suppressions: dto.suppressions,
      protectedContentHash: dto.protectedContentHash,
      secretBindingHash: dto.secretBindingHash,
      synthetic: dto.synthetic,
    });
    if (
      dto.clinicalApproverUid !== null &&
      dto.approvalHash !== null &&
      dto.approvalScope !== null &&
      dto.approvedAt !== null
    ) {
      serializeCarePathwayApproval({
        workspaceId: dto.workspaceId,
        pathwayId: dto.id,
        contentHash: dto.contentHash,
        clinicalOwnerUid: dto.clinicalOwnerUid,
        clinicalApproverUid: dto.clinicalApproverUid,
        scope: dto.approvalScope,
        approvedAt: dto.approvedAt,
      });
    }
  });
  return dto;
}

export function assertCarePathwayGovernanceHashes(
  pathway: AuthoritativeCarePathway,
  sha256: Sha256,
): void {
  const computedContentHash = sha256(
    serializeCarePathwayContent({
      workspaceId: pathway.workspaceId,
      pathwayId: pathway.id,
      family: pathway.family,
      protocolVersion: pathway.protocolVersion,
      name: pathway.name,
      clinicalOwnerUid: pathway.clinicalOwnerUid,
      contactPoints: pathway.contactPoints,
      responseSlaMinutes: pathway.responseSlaMinutes,
      escalationTeamId: pathway.escalationTeamId,
      eligibleLocationIds: pathway.eligibleLocationIds,
      afterHoursBehavior: pathway.afterHoursBehavior,
      writeBackRequired: pathway.writeBackRequired,
      instructionsSource: pathway.instructionsSource,
      aiMayGenerateInstructions: pathway.aiMayGenerateInstructions,
      suppressions: pathway.suppressions,
      protectedContentHash: pathway.protectedContentHash,
      secretBindingHash: pathway.secretBindingHash,
      synthetic: pathway.synthetic,
    }),
  );
  if (computedContentHash !== pathway.contentHash) {
    throw new AutomationCareRepositoryError(
      "Care pathway contentHash does not bind its canonical content.",
      "invalid_persisted_data",
    );
  }
  if (
    pathway.clinicalApproverUid !== null &&
    pathway.approvalHash !== null &&
    pathway.approvalScope !== null &&
    pathway.approvedAt !== null
  ) {
    const computedApprovalHash = sha256(
      serializeCarePathwayApproval({
        workspaceId: pathway.workspaceId,
        pathwayId: pathway.id,
        contentHash: pathway.contentHash,
        clinicalOwnerUid: pathway.clinicalOwnerUid,
        clinicalApproverUid: pathway.clinicalApproverUid,
        scope: pathway.approvalScope,
        approvedAt: pathway.approvedAt,
      }),
    );
    if (computedApprovalHash !== pathway.approvalHash) {
      throw new AutomationCareRepositoryError(
        "Care pathway approvalHash does not bind its clinical approval evidence.",
        "invalid_persisted_data",
      );
    }
  }
}

export async function verifyCarePathwayGovernanceHashes(
  pathway: AuthoritativeCarePathway,
): Promise<AuthoritativeCarePathway> {
  const digestCache = new Map<string, string>();
  const canonicalContent = serializeCarePathwayContent({
    workspaceId: pathway.workspaceId,
    pathwayId: pathway.id,
    family: pathway.family,
    protocolVersion: pathway.protocolVersion,
    name: pathway.name,
    clinicalOwnerUid: pathway.clinicalOwnerUid,
    contactPoints: pathway.contactPoints,
    responseSlaMinutes: pathway.responseSlaMinutes,
    escalationTeamId: pathway.escalationTeamId,
    eligibleLocationIds: pathway.eligibleLocationIds,
    afterHoursBehavior: pathway.afterHoursBehavior,
    writeBackRequired: pathway.writeBackRequired,
    instructionsSource: pathway.instructionsSource,
    aiMayGenerateInstructions: pathway.aiMayGenerateInstructions,
    suppressions: pathway.suppressions,
    protectedContentHash: pathway.protectedContentHash,
    secretBindingHash: pathway.secretBindingHash,
    synthetic: pathway.synthetic,
  });
  digestCache.set(canonicalContent, await sha256Hex(canonicalContent));
  if (
    pathway.clinicalApproverUid !== null &&
    pathway.approvalHash !== null &&
    pathway.approvalScope !== null &&
    pathway.approvedAt !== null
  ) {
    const canonicalApproval = serializeCarePathwayApproval({
      workspaceId: pathway.workspaceId,
      pathwayId: pathway.id,
      contentHash: pathway.contentHash,
      clinicalOwnerUid: pathway.clinicalOwnerUid,
      clinicalApproverUid: pathway.clinicalApproverUid,
      scope: pathway.approvalScope,
      approvedAt: pathway.approvedAt,
    });
    digestCache.set(canonicalApproval, await sha256Hex(canonicalApproval));
  }
  assertCarePathwayGovernanceHashes(pathway, (value) => {
    const computed = digestCache.get(value);
    if (computed === undefined) {
      throw new AutomationCareRepositoryError(
        "Care governance digest verification was incomplete.",
        "invalid_persisted_data",
      );
    }
    return computed;
  });
  return pathway;
}

export function parseCarePathwayActivationDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): StaffSafeCarePathwayActivation {
  const parsed = parsePersisted(
    carePathwayActivationDocumentSchema,
    value,
    "Care pathway activation",
  );
  assertPathIdentity(parsed, documentId, workspaceId, "Care pathway activation");
  assertEntityTimestamps(parsed, "Care pathway activation");
  if (parsed.id !== parsed.family) {
    throw new AutomationCareRepositoryError(
      "Care activation path must equal its pathway family.",
      "invalid_persisted_data",
    );
  }
  return {
    ...parsed,
    activatedAt: timestampToIso(parsed.activatedAt),
    createdAt: timestampToIso(parsed.createdAt),
    updatedAt: timestampToIso(parsed.updatedAt),
  } as unknown as StaffSafeCarePathwayActivation;
}

export function parseCarePathwayEventDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): StaffSafeCarePathwayEvent {
  const parsed = parsePersisted(
    carePathwayEventDocumentSchema,
    value,
    "Care pathway event",
  );
  assertPathIdentity(parsed, documentId, workspaceId, "Care pathway event");
  const dto = {
    ...parsed,
    occurredAt: timestampToIso(parsed.occurredAt),
  } as unknown as StaffSafeCarePathwayEvent;
  validateDomain("Care pathway event", () => assertCarePathwayEventBinding(dto));
  return dto;
}

export function parseCareEnrollmentDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): StaffSafeCareEnrollment {
  const parsed = parsePersisted(careEnrollmentDocumentSchema, value, "Care enrollment");
  assertPathIdentity(parsed, documentId, workspaceId, "Care enrollment");
  assertEntityTimestamps(parsed, "Care enrollment");
  const dto = {
    ...parsed,
    nextContactAt: nullableTimestampToIso(parsed.nextContactAt),
    createdAt: timestampToIso(parsed.createdAt),
    updatedAt: timestampToIso(parsed.updatedAt),
  } as unknown as StaffSafeCareEnrollment;
  validateDomain("Care enrollment", () => assertCareEnrollmentOperationalState(dto));
  assertCareEnrollmentAggregateEnvelope(dto);
  return dto;
}

export function parseCareEnrollmentEventDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): StaffSafeCareEnrollmentEvent {
  const parsed = parsePersisted(
    careEnrollmentEventDocumentSchema,
    value,
    "Care enrollment event",
  );
  assertPathIdentity(parsed, documentId, workspaceId, "Care enrollment event");
  const dto = {
    ...parsed,
    nextContactAt: nullableTimestampToIso(parsed.nextContactAt),
    occurredAt: timestampToIso(parsed.occurredAt),
  } as unknown as StaffSafeCareEnrollmentEvent;
  validateDomain("Care enrollment event", () => assertCareEnrollmentEventTrace(dto));
  return dto;
}

export function parseCareEscalationDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): StaffSafeCareEscalation {
  const parsed = parsePersisted(careEscalationDocumentSchema, value, "Care escalation");
  assertPathIdentity(parsed, documentId, workspaceId, "Care escalation");
  assertEntityTimestamps(parsed, "Care escalation");
  const dto = {
    ...parsed,
    openedAt: timestampToIso(parsed.openedAt),
    responseDueAt: timestampToIso(parsed.responseDueAt),
    acknowledgedAt: nullableTimestampToIso(parsed.acknowledgedAt),
    resolvedAt: nullableTimestampToIso(parsed.resolvedAt),
    createdAt: timestampToIso(parsed.createdAt),
    updatedAt: timestampToIso(parsed.updatedAt),
  } as unknown as StaffSafeCareEscalation;
  validateDomain("Care escalation", () => assertCareEscalationLifecycle(dto));
  return dto;
}

export function parseCareHandoffDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): StaffSafeCareHandoff {
  const parsed = parsePersisted(careHandoffDocumentSchema, value, "Care handoff");
  assertPathIdentity(parsed, documentId, workspaceId, "Care handoff");
  assertEntityTimestamps(parsed, "Care handoff");
  const dto = {
    ...parsed,
    openedAt: timestampToIso(parsed.openedAt),
    releasedAt: nullableTimestampToIso(parsed.releasedAt),
    createdAt: timestampToIso(parsed.createdAt),
    updatedAt: timestampToIso(parsed.updatedAt),
  } as unknown as StaffSafeCareHandoff;
  validateDomain("Care handoff", () => assertCareHandoffLifecycle(dto));
  return dto;
}

export function parsePhase5AuditDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): Phase5AuditRecordDTO {
  const parsed = parsePersisted(phase5AuditDocumentSchema, value, "Phase 5 audit event");
  assertPathIdentity(parsed, documentId, workspaceId, "Phase 5 audit event");
  if (parsed.createdAt.toMillis() !== parsed.occurredAt.toMillis()) {
    throw new AutomationCareRepositoryError(
      "Phase 5 audit createdAt must equal its immutable occurrence time.",
      "invalid_persisted_data",
    );
  }
  const forbiddenKey = Object.keys(parsed.metadata).find((key) =>
    /(?:authorization|secret|token|password|cookie|phone|patient|message|body|content|report|diagnos|prescription|payment)/i.test(
      key,
    ),
  );
  if (forbiddenKey !== undefined) {
    throw new AutomationCareRepositoryError(
      "Phase 5 audit metadata contains a protected field name.",
      "invalid_persisted_data",
    );
  }
  return {
    ...parsed,
    occurredAt: timestampToIso(parsed.occurredAt),
    createdAt: timestampToIso(parsed.createdAt),
  } as Phase5AuditRecordDTO;
}

export function parseAutomationDefinitionSecretDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): AutomationDefinitionSecretProjection {
  const parsed = parsePersisted(
    automationDefinitionSecretSchema,
    value,
    "Automation definition secret",
  );
  assertSecretPathIdentity(
    parsed.definitionId,
    parsed.workspaceId,
    documentId,
    workspaceId,
    "Automation definition secret",
  );
  return parsed as unknown as AutomationDefinitionSecretProjection;
}

export function parseAutomationTriggerReceiptDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): AutomationTriggerReceiptSecretProjection {
  const parsed = parsePersisted(
    automationTriggerReceiptSchema,
    value,
    "Automation trigger receipt",
  );
  assertPathIdentity(parsed, documentId, workspaceId, "Automation trigger receipt");
  if (parsed.id !== parsed.triggerFingerprint) {
    throw new AutomationCareRepositoryError(
      "Automation trigger receipt path must equal its canonical HMAC.",
      "invalid_persisted_data",
    );
  }
  return {
    ...parsed,
    createdAt: timestampToIso(parsed.createdAt),
  } as unknown as AutomationTriggerReceiptSecretProjection;
}

export function parseAutomationRunSecretDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): AutomationRunSecretProjection {
  const parsed = parsePersisted(automationRunSecretSchema, value, "Automation run secret");
  assertSecretPathIdentity(
    parsed.runId,
    parsed.workspaceId,
    documentId,
    workspaceId,
    "Automation run secret",
  );
  return parsed as unknown as AutomationRunSecretProjection;
}

export function parseAutomationRunEventSecretDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): AutomationRunEventSecretProjection {
  const parsed = parsePersisted(
    automationRunEventSecretSchema,
    value,
    "Automation run event secret",
  );
  assertSecretPathIdentity(
    parsed.eventId,
    parsed.workspaceId,
    documentId,
    workspaceId,
    "Automation run event secret",
  );
  return parsed as unknown as AutomationRunEventSecretProjection;
}

export function parseAutomationWorkItemSecretDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): AutomationWorkItemSecretProjection {
  const parsed = parsePersisted(
    automationWorkItemSecretSchema,
    value,
    "Automation work item secret",
  );
  assertSecretPathIdentity(
    parsed.workItemId,
    parsed.workspaceId,
    documentId,
    workspaceId,
    "Automation work item secret",
  );
  return parsed as unknown as AutomationWorkItemSecretProjection;
}

export function parseCarePathwaySecretDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): CarePathwaySecretProjection {
  const parsed = parsePersisted(carePathwaySecretSchema, value, "Care pathway secret");
  assertSecretPathIdentity(
    parsed.pathwayId,
    parsed.workspaceId,
    documentId,
    workspaceId,
    "Care pathway secret",
  );
  return parsed as unknown as CarePathwaySecretProjection;
}

export function parseCareEnrollmentReceiptDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): CareEnrollmentReceiptSecretProjection {
  const parsed = parsePersisted(
    careEnrollmentReceiptSchema,
    value,
    "Care enrollment receipt",
  );
  assertPathIdentity(parsed, documentId, workspaceId, "Care enrollment receipt");
  if (parsed.id !== parsed.receiptFingerprint) {
    throw new AutomationCareRepositoryError(
      "Care enrollment receipt path must equal its canonical HMAC.",
      "invalid_persisted_data",
    );
  }
  return {
    ...parsed,
    qualifyingDischargeAt: timestampToIso(parsed.qualifyingDischargeAt),
    createdAt: timestampToIso(parsed.createdAt),
  } as unknown as CareEnrollmentReceiptSecretProjection;
}

export function parseCareEnrollmentSecretDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): CareEnrollmentSecretProjection {
  const parsed = parsePersisted(
    careEnrollmentSecretSchema,
    value,
    "Care enrollment secret",
  );
  assertSecretPathIdentity(
    parsed.enrollmentId,
    parsed.workspaceId,
    documentId,
    workspaceId,
    "Care enrollment secret",
  );
  return {
    ...parsed,
    qualifyingDischargeAt: timestampToIso(parsed.qualifyingDischargeAt),
  } as unknown as CareEnrollmentSecretProjection;
}

export function parseCareEnrollmentEventSecretDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): CareEnrollmentEventSecretProjection {
  const parsed = parsePersisted(
    careEnrollmentEventSecretSchema,
    value,
    "Care enrollment event secret",
  );
  assertSecretPathIdentity(
    parsed.eventId,
    parsed.workspaceId,
    documentId,
    workspaceId,
    "Care enrollment event secret",
  );
  return parsed as unknown as CareEnrollmentEventSecretProjection;
}

export function parseCareEscalationSecretDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): CareEscalationSecretProjection {
  const parsed = parsePersisted(
    careEscalationSecretSchema,
    value,
    "Care escalation secret",
  );
  assertSecretPathIdentity(
    parsed.escalationId,
    parsed.workspaceId,
    documentId,
    workspaceId,
    "Care escalation secret",
  );
  return parsed as unknown as CareEscalationSecretProjection;
}

type Phase5AuditedEvent = {
  readonly id: string;
  readonly workspaceId: string;
  readonly auditEventId: string;
  readonly revision: number;
  readonly occurredAt: string;
  readonly actorKind: "system" | "staff";
  readonly actorUid: string | null;
} & (
  | { readonly action: string; readonly eventType?: never }
  | { readonly eventType: string; readonly action?: never }
);

function expectedPhase5AuditAction(
  event: Phase5AuditedEvent,
  resourceType: "automation_definition" | "automation_run" | "care_pathway" | "care_enrollment",
): string {
  if (event.action !== undefined) {
    if (resourceType === "automation_run") return `automation.${event.action}`;
    if (resourceType === "care_enrollment") return `care_enrollment.${event.action}`;
    throw new AutomationCareRepositoryError(
      "Runtime event action was paired with a catalogue audit resource.",
      "invalid_persisted_data",
    );
  }
  const lifecycleActions: Readonly<Record<string, string>> =
    resourceType === "automation_definition"
      ? {
          created: "automation_definition.create",
          review_requested: "automation_definition.request_review",
          approved: "automation_definition.approve",
          activated: "automation_definition.activate",
          retired: "automation_definition.retire",
        }
      : resourceType === "care_pathway"
        ? {
            created: "care_pathway.create",
            clinical_review_requested: "care_pathway.request_clinical_review",
            approved: "care_pathway.approve",
            activated: "care_pathway.activate",
            retired: "care_pathway.retire",
          }
        : {};
  const expected = lifecycleActions[event.eventType];
  if (expected === undefined) {
    throw new AutomationCareRepositoryError(
      "Lifecycle event type has no governed audit action mapping.",
      "invalid_persisted_data",
    );
  }
  return expected;
}

export function assertPhase5EventAuditJoin(
  event: Phase5AuditedEvent,
  audit: Phase5AuditRecordDTO,
  resourceType: "automation_definition" | "automation_run" | "care_pathway" | "care_enrollment",
  resourceId: string,
): void {
  const actorMatches =
    (event.actorKind === "system" &&
      event.actorUid === null &&
      (audit.actorType === "system" || audit.actorType === "service")) ||
    (event.actorKind === "staff" &&
      event.actorUid !== null &&
      audit.actorType === "user" &&
      audit.actorUid === event.actorUid);
  const expectedAction = expectedPhase5AuditAction(event, resourceType);
  const runtimeResultFingerprintIsValid =
    (resourceType !== "automation_run" && resourceType !== "care_enrollment") ||
    (typeof audit.metadata.resultFingerprint === "string" &&
      /^[0-9a-f]{64}$/.test(audit.metadata.resultFingerprint));
  if (
    audit.id !== event.auditEventId ||
    audit.workspaceId !== event.workspaceId ||
    audit.resourceType !== resourceType ||
    audit.resourceId !== resourceId ||
    audit.action !== expectedAction ||
    audit.occurredAt !== event.occurredAt ||
    (audit.outcome !== "allowed" && audit.outcome !== "simulated") ||
    audit.metadata.eventId !== event.id ||
    audit.metadata.revision !== event.revision ||
    !runtimeResultFingerprintIsValid ||
    !actorMatches
  ) {
    throw new AutomationCareRepositoryError(
      "Phase 5 event and redacted audit record failed their exact join.",
      "invalid_persisted_data",
    );
  }
}

export function assertAutomationDefinitionSecretJoin(
  definition: AuthoritativeAutomationDefinition,
  secret: AutomationDefinitionSecretProjection,
  sha256: Sha256,
): void {
  validateDomain("Automation definition secret join", () =>
    assertAutomationDefinitionSecretCrossBinding(
      secret,
      {
        workspaceId: definition.workspaceId,
        definitionId: definition.id,
        secretBindingHash: definition.secretBindingHash,
      },
      sha256,
    ),
  );
}

export function assertCarePathwaySecretJoin(
  pathway: AuthoritativeCarePathway,
  secret: CarePathwaySecretProjection,
  sha256: Sha256,
): void {
  validateDomain("Care pathway secret join", () =>
    assertCarePathwaySecretCrossBinding(
      secret,
      {
        workspaceId: pathway.workspaceId,
        pathwayId: pathway.id,
        protectedContentHash: pathway.protectedContentHash,
        secretBindingHash: pathway.secretBindingHash,
      },
      sha256,
    ),
  );
}

export function assertAutomationActivationGovernanceJoin(
  activation: StaffSafeAutomationActivation,
  definition: AuthoritativeAutomationDefinition,
  event: StaffSafeAutomationDefinitionEvent,
  audit: Phase5AuditRecordDTO,
): void {
  validateDomain("Automation activation governance join", () =>
    assertAutomationActivationProof(activation, definition, event),
  );
  assertPhase5EventAuditJoin(event, audit, "automation_definition", definition.id);
}

export function assertCarePathwayActivationGovernanceJoin(
  activation: StaffSafeCarePathwayActivation,
  pathway: AuthoritativeCarePathway,
  event: StaffSafeCarePathwayEvent,
  audit: Phase5AuditRecordDTO,
): void {
  validateDomain("Care pathway activation governance join", () =>
    assertCarePathwayActivationProof(activation, pathway, event),
  );
  assertPhase5EventAuditJoin(event, audit, "care_pathway", pathway.id);
}

export function assertAutomationReceiptAggregateJoin(
  receipt: AutomationTriggerReceiptSecretProjection,
  run: StaffSafeAutomationRun,
  secret: AutomationRunSecretProjection,
  activation: StaffSafeAutomationActivation,
): void {
  validateDomain("Automation receipt/run join", () => {
    assertAutomationTriggerReceiptRunBinding(receipt, run);
    assertAutomationRunSecretReceiptLink(secret, receipt);
    assertAutomationTriggerReceiptChronology(activation, receipt, run);
  });
}

export function assertCareReceiptAggregateJoin(
  receipt: CareEnrollmentReceiptSecretProjection,
  enrollment: StaffSafeCareEnrollment,
  secret: CareEnrollmentSecretProjection,
  activation: StaffSafeCarePathwayActivation,
): void {
  validateDomain("Care receipt/enrollment join", () => {
    assertCareEnrollmentReceiptAggregateBinding(receipt, enrollment);
    assertCareEnrollmentSecretReceiptLink(secret, receipt);
    assertCareEnrollmentReceiptChronology(activation, receipt, enrollment);
  });
}

export function assertAutomationRunEventSecretJoin(
  event: StaffSafeAutomationRunEvent,
  secret: AutomationRunEventSecretProjection | null,
): void {
  validateDomain("Automation run event secret join", () =>
    assertAutomationRunEventSecretBinding(event, secret),
  );
}

export function assertAutomationWorkItemSecretJoin(
  workItem: StaffSafeAutomationWorkItem,
  secret: AutomationWorkItemSecretProjection,
): void {
  if (
    workItem.workspaceId !== secret.workspaceId ||
    workItem.runId !== secret.runId ||
    workItem.id !== secret.workItemId
  ) {
    throw new AutomationCareRepositoryError(
      "Automation work item and secret failed their exact join.",
      "invalid_persisted_data",
    );
  }
}

export function assertCareEnrollmentEventSecretJoin(
  event: StaffSafeCareEnrollmentEvent,
  secret: CareEnrollmentEventSecretProjection,
): void {
  if (
    event.workspaceId !== secret.workspaceId ||
    event.enrollmentId !== secret.enrollmentId ||
    event.id !== secret.eventId
  ) {
    throw new AutomationCareRepositoryError(
      "Care enrollment event and secret failed their exact join.",
      "invalid_persisted_data",
    );
  }
}

export function assertCareEscalationSecretJoin(
  escalation: StaffSafeCareEscalation,
  secret: CareEscalationSecretProjection,
): void {
  if (
    escalation.workspaceId !== secret.workspaceId ||
    escalation.enrollmentId !== secret.enrollmentId ||
    escalation.id !== secret.escalationId
  ) {
    throw new AutomationCareRepositoryError(
      "Care escalation and secret failed their exact join.",
      "invalid_persisted_data",
    );
  }
}

type Phase5DocumentParser<T> = (
  value: unknown,
  documentId: string,
  workspaceId: string,
) => T;

async function getStrictStaffDocument<T>(
  db: Firestore,
  input: Phase5ExactGetInput,
  collectionName: (typeof PHASE5_STAFF_COLLECTIONS)[number] | "auditEvents",
  label: string,
  parser: Phase5DocumentParser<T>,
): Promise<T> {
  const snapshot = await getDocFromServer(
    doc(db, "workspaces", input.workspaceId, collectionName, input.id),
  );
  if (!snapshot.exists()) {
    throw new AutomationCareRepositoryError(`${label} was not found.`, "not_found");
  }
  return parser(snapshot.data(), snapshot.id, input.workspaceId);
}

/**
 * Catalogue-only list. Execution projections deliberately have no list API:
 * they must always be opened through an exact, already-authorized identifier.
 */
export async function listAutomationDefinitions(
  db: Firestore,
  rawInput: AutomationCatalogueListInput,
): Promise<readonly AuthoritativeAutomationDefinition[]> {
  const input = prepareAutomationCatalogueListInput(rawInput);
  const snapshot = await getDocsFromServer(
    query(
      collection(db, "workspaces", input.workspaceId, "automationDefinitions"),
      where("family", "==", input.family),
      orderBy("version", "desc"),
      limit(input.pageSize ?? 50),
    ),
  );
  const definitions = snapshot.docs.map((record) => {
    const definition = parseAutomationDefinitionDocument(
      record.data(),
      record.id,
      input.workspaceId,
    );
    if (definition.family !== input.family) {
      throw new AutomationCareRepositoryError(
        "Automation catalogue query returned a definition from another family.",
        "invalid_persisted_data",
      );
    }
    return definition;
  });
  return Promise.all(definitions.map(verifyAutomationDefinitionGovernanceHashes));
}

export async function listAutomationDefinitionEvents(
  db: Firestore,
  rawInput: AutomationDefinitionEventListInput,
): Promise<readonly StaffSafeAutomationDefinitionEvent[]> {
  const input = prepareAutomationDefinitionEventListInput(rawInput);
  const snapshot = await getDocsFromServer(
    query(
      collection(db, "workspaces", input.workspaceId, "automationDefinitionEvents"),
      where("definitionId", "==", input.definitionId),
      orderBy("revision", "desc"),
      limit(input.pageSize ?? 50),
    ),
  );
  return snapshot.docs.map((record) => {
    const event = parseAutomationDefinitionEventDocument(
      record.data(),
      record.id,
      input.workspaceId,
    );
    if (event.definitionId !== input.definitionId) {
      throw new AutomationCareRepositoryError(
        "Automation governance query returned an event for another definition.",
        "invalid_persisted_data",
      );
    }
    return event;
  });
}

export async function listCarePathways(
  db: Firestore,
  rawInput: CareCatalogueListInput,
): Promise<readonly AuthoritativeCarePathway[]> {
  const input = prepareCareCatalogueListInput(rawInput);
  const snapshot = await getDocsFromServer(
    query(
      collection(db, "workspaces", input.workspaceId, "carePathways"),
      where("family", "==", input.family),
      orderBy("updatedAt", "desc"),
      limit(input.pageSize ?? 50),
    ),
  );
  const pathways = snapshot.docs.map((record) => {
    const pathway = parseCarePathwayDocument(record.data(), record.id, input.workspaceId);
    if (pathway.family !== input.family) {
      throw new AutomationCareRepositoryError(
        "Care catalogue query returned a pathway from another family.",
        "invalid_persisted_data",
      );
    }
    return pathway;
  });
  return Promise.all(pathways.map(verifyCarePathwayGovernanceHashes));
}

export async function listCarePathwayEvents(
  db: Firestore,
  rawInput: CarePathwayEventListInput,
): Promise<readonly StaffSafeCarePathwayEvent[]> {
  const input = prepareCarePathwayEventListInput(rawInput);
  const snapshot = await getDocsFromServer(
    query(
      collection(db, "workspaces", input.workspaceId, "carePathwayEvents"),
      where("pathwayId", "==", input.pathwayId),
      orderBy("revision", "desc"),
      limit(input.pageSize ?? 50),
    ),
  );
  return snapshot.docs.map((record) => {
    const event = parseCarePathwayEventDocument(record.data(), record.id, input.workspaceId);
    if (event.pathwayId !== input.pathwayId) {
      throw new AutomationCareRepositoryError(
        "Care governance query returned an event for another pathway.",
        "invalid_persisted_data",
      );
    }
    return event;
  });
}

export async function getAutomationDefinition(
  db: Firestore,
  rawInput: Phase5ExactGetInput,
): Promise<AuthoritativeAutomationDefinition> {
  const input = preparePhase5ExactGetInput(rawInput);
  const definition = await getStrictStaffDocument(
    db,
    input,
    "automationDefinitions",
    "Automation definition",
    parseAutomationDefinitionDocument,
  );
  return verifyAutomationDefinitionGovernanceHashes(definition);
}

export async function getAutomationActivation(
  db: Firestore,
  rawInput: AutomationActivationGetInput,
): Promise<StaffSafeAutomationActivation> {
  const input = parseInput(automationActivationGetInputSchema, rawInput);
  return getStrictStaffDocument(
    db,
    { workspaceId: input.workspaceId, id: input.family },
    "automationActivations",
    "Automation activation",
    parseAutomationActivationDocument,
  );
}

export async function getAutomationDefinitionEvent(
  db: Firestore,
  rawInput: Phase5ExactGetInput,
): Promise<StaffSafeAutomationDefinitionEvent> {
  const input = preparePhase5ExactGetInput(rawInput);
  return getStrictStaffDocument(
    db,
    input,
    "automationDefinitionEvents",
    "Automation definition event",
    parseAutomationDefinitionEventDocument,
  );
}

export async function getAutomationRun(
  db: Firestore,
  rawInput: Phase5ExactGetInput,
): Promise<StaffSafeAutomationRun> {
  const input = preparePhase5ExactGetInput(rawInput);
  return getStrictStaffDocument(
    db,
    input,
    "automationRuns",
    "Automation run",
    parseAutomationRunDocument,
  );
}

export async function getAutomationRunEvent(
  db: Firestore,
  rawInput: Phase5ExactGetInput,
): Promise<StaffSafeAutomationRunEvent> {
  const input = preparePhase5ExactGetInput(rawInput);
  return getStrictStaffDocument(
    db,
    input,
    "automationRunEvents",
    "Automation run event",
    parseAutomationRunEventDocument,
  );
}

export async function getAutomationWorkItem(
  db: Firestore,
  rawInput: Phase5ExactGetInput,
): Promise<StaffSafeAutomationWorkItem> {
  const input = preparePhase5ExactGetInput(rawInput);
  return getStrictStaffDocument(
    db,
    input,
    "automationWorkItems",
    "Automation work item",
    parseAutomationWorkItemDocument,
  );
}

export async function getCarePathway(
  db: Firestore,
  rawInput: Phase5ExactGetInput,
): Promise<AuthoritativeCarePathway> {
  const input = preparePhase5ExactGetInput(rawInput);
  const pathway = await getStrictStaffDocument(
    db,
    input,
    "carePathways",
    "Care pathway",
    parseCarePathwayDocument,
  );
  return verifyCarePathwayGovernanceHashes(pathway);
}

export async function getCarePathwayActivation(
  db: Firestore,
  rawInput: CarePathwayActivationGetInput,
): Promise<StaffSafeCarePathwayActivation> {
  const input = parseInput(carePathwayActivationGetInputSchema, rawInput);
  return getStrictStaffDocument(
    db,
    { workspaceId: input.workspaceId, id: "post_discharge" },
    "carePathwayActivations",
    "Care pathway activation",
    parseCarePathwayActivationDocument,
  );
}

export async function getCarePathwayEvent(
  db: Firestore,
  rawInput: Phase5ExactGetInput,
): Promise<StaffSafeCarePathwayEvent> {
  const input = preparePhase5ExactGetInput(rawInput);
  return getStrictStaffDocument(
    db,
    input,
    "carePathwayEvents",
    "Care pathway event",
    parseCarePathwayEventDocument,
  );
}

export async function getCareEnrollment(
  db: Firestore,
  rawInput: Phase5ExactGetInput,
): Promise<StaffSafeCareEnrollment> {
  const input = preparePhase5ExactGetInput(rawInput);
  return getStrictStaffDocument(
    db,
    input,
    "careEnrollments",
    "Care enrollment",
    parseCareEnrollmentDocument,
  );
}

export async function getCareEnrollmentEvent(
  db: Firestore,
  rawInput: Phase5ExactGetInput,
): Promise<StaffSafeCareEnrollmentEvent> {
  const input = preparePhase5ExactGetInput(rawInput);
  return getStrictStaffDocument(
    db,
    input,
    "careEnrollmentEvents",
    "Care enrollment event",
    parseCareEnrollmentEventDocument,
  );
}

export async function getCareEscalation(
  db: Firestore,
  rawInput: Phase5ExactGetInput,
): Promise<StaffSafeCareEscalation> {
  const input = preparePhase5ExactGetInput(rawInput);
  return getStrictStaffDocument(
    db,
    input,
    "careEscalations",
    "Care escalation",
    parseCareEscalationDocument,
  );
}

export async function getCareHandoff(
  db: Firestore,
  rawInput: Phase5ExactGetInput,
): Promise<StaffSafeCareHandoff> {
  const input = preparePhase5ExactGetInput(rawInput);
  return getStrictStaffDocument(
    db,
    input,
    "careHandoffs",
    "Care handoff",
    parseCareHandoffDocument,
  );
}

export async function getPhase5AuditEvent(
  db: Firestore,
  rawInput: Phase5ExactGetInput,
): Promise<Phase5AuditRecordDTO> {
  const input = preparePhase5ExactGetInput(rawInput);
  return getStrictStaffDocument(
    db,
    input,
    "auditEvents",
    "Phase 5 audit event",
    parsePhase5AuditDocument,
  );
}
