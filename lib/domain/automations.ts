import type {
  AppointmentId,
  AuditEventId,
  AutomationDefinitionId,
  AutomationRunId,
  Brand,
  CareEnrollmentId,
  CarePathwayId,
  ContactId,
  ConversationId,
  EncryptedValueRef,
  ExternalReference,
  HmacDigest,
  ISODateTime,
  LocationId,
  MemberId,
  MessageId,
  Sha256Digest,
  TeamId,
  TemplateVersionId,
  UserId,
  WorkspaceScopedEntity,
} from "./primitives";
import type { ConsentPurpose, ConsentStatus } from "./contacts";

export type AutomationTrigger =
  | "inbound_intent"
  | "appointment_event"
  | "lims_report_ready"
  | "discharge_event"
  | "scheduled_time"
  | "campaign_response"
  | "agent_action";

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly initialBackoffSeconds: number;
  readonly maximumBackoffSeconds: number;
}

export interface AutomationStepPolicy {
  readonly requiredConsentPurpose: ConsentPurpose;
  readonly serviceWindowBehavior: "send_in_window" | "use_approved_template" | "do_not_send";
  readonly timeoutSeconds: number;
  readonly retry: RetryPolicy;
  readonly fallback: "create_work_item" | "route_to_human" | "stop_run";
}

export type AutomationStep =
  | {
      readonly id: string;
      readonly kind: "send_template";
      readonly templateVersionId: TemplateVersionId;
      readonly policy: AutomationStepPolicy;
    }
  | {
      readonly id: string;
      readonly kind: "wait";
      readonly waitSeconds: number;
      readonly policy: AutomationStepPolicy;
    }
  | {
      readonly id: string;
      readonly kind: "request_appointment_action";
      readonly action: "confirm" | "reschedule" | "cancel";
      readonly policy: AutomationStepPolicy;
    }
  | {
      readonly id: string;
      readonly kind: "route_to_team";
      readonly teamId: TeamId;
      readonly policy: AutomationStepPolicy;
    }
  | {
      readonly id: string;
      readonly kind: "stop";
      readonly reason: string;
      readonly policy: AutomationStepPolicy;
    };

export interface AutomationDefinition extends WorkspaceScopedEntity<AutomationDefinitionId> {
  readonly name: string;
  readonly trigger: AutomationTrigger;
  readonly version: number;
  readonly consentPurpose: ConsentPurpose;
  readonly steps: readonly AutomationStep[];
  readonly approvalState: "draft" | "review_pending" | "approved" | "retired";
  readonly approvedBy: MemberId | null;
  readonly approvedAt: ISODateTime | null;
  readonly active: boolean;
  readonly riskLevel: "low" | "medium" | "high";
  readonly synthetic: boolean;
}

export type AutomationRunState =
  | "queued"
  | "running"
  | "waiting"
  | "paused_for_human"
  | "paused_for_safety"
  | "completed"
  | "ended"
  | "failed";

export interface AutomationRun extends WorkspaceScopedEntity<AutomationRunId> {
  readonly definitionId: AutomationDefinitionId;
  readonly definitionVersion: number;
  readonly triggerEventId: string;
  readonly idempotencyKey: string;
  readonly subject: {
    readonly contactId: ContactId;
    readonly conversationId: ConversationId | null;
    readonly appointmentId: AppointmentId | null;
  };
  readonly state: AutomationRunState;
  readonly currentStepIndex: number;
  readonly completedStepIds: readonly string[];
  readonly attemptCount: number;
  readonly nextAttemptAt: ISODateTime | null;
  readonly lastMessageId: MessageId | null;
  readonly lastErrorCode: string | null;
}

export type CareSuppressionReason =
  | "readmission"
  | "transfer"
  | "death"
  | "clinical_hold"
  | "withdrawal"
  | "invalid_contact";

export interface CarePathway extends WorkspaceScopedEntity<CarePathwayId> {
  readonly name: string;
  readonly protocolVersion: string;
  readonly clinicalOwnerId: MemberId;
  readonly approvalState: "draft" | "clinical_review" | "approved" | "retired";
  readonly approvedBy: MemberId | null;
  readonly approvedAt: ISODateTime | null;
  readonly contactDayOffsets: readonly number[];
  readonly responseSlaMinutes: number;
  readonly escalationTeamId: TeamId;
  readonly afterHoursBehavior: "emergency_path" | "next_business_day" | "on_call_queue";
  readonly writeBackRequired: boolean;
  readonly instructionsSource: "clinician_authored";
  readonly aiMayGenerateInstructions: false;
  readonly synthetic: boolean;
}

export interface CarePathwayEnrollment extends WorkspaceScopedEntity<CareEnrollmentId> {
  readonly pathwayId: CarePathwayId;
  readonly pathwayProtocolVersion: string;
  readonly contactId: ContactId;
  readonly externalDischargeRef: ExternalReference;
  readonly enrolledAt: ISODateTime;
  readonly state: "active" | "paused" | "escalated" | "completed" | "withdrawn";
  readonly suppressionReasons: readonly CareSuppressionReason[];
  readonly nextContactAt: ISODateTime | null;
  readonly synthetic: boolean;
}

export function canActivateAutomation(definition: AutomationDefinition): boolean {
  return definition.approvalState === "approved" && definition.active && definition.steps.length > 0;
}

export function canActivateCarePathway(pathway: CarePathway): boolean {
  return (
    pathway.approvalState === "approved" &&
    pathway.approvedBy !== null &&
    pathway.approvedAt !== null &&
    pathway.protocolVersion.trim().length > 0 &&
    pathway.aiMayGenerateInstructions === false
  );
}

export function careEnrollmentMustPause(enrollment: CarePathwayEnrollment): boolean {
  return enrollment.suppressionReasons.length > 0 || enrollment.state !== "active";
}

/**
 * Authoritative Phase 5 contracts. Everything above this boundary is a legacy,
 * browser-only simulator contract. Persisted repositories, Functions and Rules
 * must use only the `Authoritative*`, `StaffSafe*` and `*SecretProjection`
 * contracts below. The legacy exports remain temporarily to avoid rewriting the
 * current local simulator in the same migration.
 */
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
export type AutomationExecutionState = (typeof AUTOMATION_EXECUTION_STATES)[number];

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

export const CARE_ENROLLMENT_STATES = [
  "queued",
  "active",
  "paused_by_operator",
  "paused_for_human",
  "paused_for_safety",
  "escalated",
  "completed",
  "ended",
] as const;
export type CareEnrollmentState = (typeof CARE_ENROLLMENT_STATES)[number];

export const CARE_ENROLLMENT_ACTIONS = [
  "start",
  "advance_contact",
  "pause",
  "resume",
  "end",
  "simulate_suppression",
  "human_takeover_started",
  "release_human_takeover",
  "clear_clinical_hold",
  "raise_red_flag",
  "acknowledge_escalation",
  "resolve_escalation",
  "clear_safety_hold",
] as const;
export type CareEnrollmentAction = (typeof CARE_ENROLLMENT_ACTIONS)[number];

/** Canonical PRD enumeration order bound into every approved care pathway. */
export const CARE_PATHWAY_SUPPRESSIONS = [
  "readmission",
  "transfer",
  "death",
  "clinical_hold",
  "withdrawal",
  "invalid_contact",
] as const satisfies readonly CareSuppressionReason[];

/** Operational ordering after higher-priority escalation/contact gates are evaluated. */
export const CARE_SUPPRESSION_PRECEDENCE = [
  "death",
  "invalid_contact",
  "readmission",
  "transfer",
  "clinical_hold",
  "withdrawal",
] as const satisfies readonly CareSuppressionReason[];

export type AutomationDefinitionFamily =
  | "appointment_service"
  | "laboratory_service"
  | "care_pathway"
  | "feedback"
  | "inbound_routing"
  | "campaign_response"
  | "scheduled_service";
export const EXECUTABLE_AUTOMATION_FAMILIES = [
  "appointment_service",
  "laboratory_service",
] as const satisfies readonly AutomationDefinitionFamily[];
export type ExecutableAutomationFamily = (typeof EXECUTABLE_AUTOMATION_FAMILIES)[number];
export type AutomationRiskLevel = "low" | "medium" | "high";
export type AutomationStepKind = AutomationStep["kind"];
export type AutomationStopReasonCode =
  | "policy_complete"
  | "consent_unavailable"
  | "service_window_closed"
  | "synthetic_safe_stop";

export interface AuthoritativeAutomationStep {
  readonly id: string;
  readonly kind: AutomationStepKind;
  readonly templateVersionId: TemplateVersionId | null;
  readonly templateContentHash: Sha256Digest | null;
  readonly waitSeconds: number | null;
  readonly appointmentAction: "confirm" | "reschedule" | "cancel" | null;
  readonly routeTeamId: TeamId | null;
  readonly stopReasonCode: AutomationStopReasonCode | null;
  readonly requiredConsentPurpose: ConsentPurpose;
  readonly serviceWindowBehavior: AutomationStepPolicy["serviceWindowBehavior"];
  readonly timeoutSeconds: number;
  readonly retryMaxAttempts: number;
  readonly retryInitialBackoffSeconds: number;
  readonly retryMaximumBackoffSeconds: number;
  readonly fallback: AutomationStepPolicy["fallback"];
}

export interface AuthoritativeAutomationDefinition
  extends WorkspaceScopedEntity<AutomationDefinitionId> {
  readonly family: AutomationDefinitionFamily;
  readonly version: number;
  readonly name: string;
  readonly trigger: AutomationTrigger;
  readonly consentPurpose: ConsentPurpose;
  readonly riskLevel: AutomationRiskLevel;
  readonly steps: readonly AuthoritativeAutomationStep[];
  readonly contentHash: Sha256Digest;
  readonly secretBindingHash: Sha256Digest;
  readonly ownerUid: UserId;
  readonly approverUid: UserId | null;
  readonly approvalHash: Sha256Digest | null;
  readonly approvalScope: "simulation_only" | null;
  readonly approvedAt: ISODateTime | null;
  readonly lifecycleState: "draft" | "review_pending" | "approved" | "retired";
  readonly schemaVersion: 1;
  readonly synthetic: true;
}

export type AutomationRunEventId = Brand<string, "AutomationRunEventId">;
export type AutomationWorkItemId = Brand<string, "AutomationWorkItemId">;
export type AutomationDefinitionEventId = Brand<string, "AutomationDefinitionEventId">;
export type CareEnrollmentEventId = Brand<string, "CareEnrollmentEventId">;
export type CareEscalationId = Brand<string, "CareEscalationId">;
export type CarePathwayEventId = Brand<string, "CarePathwayEventId">;
export type AutomationTriggerReceiptId = Brand<string, "AutomationTriggerReceiptId">;
export type CareEnrollmentReceiptId = Brand<string, "CareEnrollmentReceiptId">;
export type CareHandoffId = Brand<string, "CareHandoffId">;

export type GovernedActor =
  | { readonly actorKind: "system"; readonly actorUid: null }
  | { readonly actorKind: "staff"; readonly actorUid: UserId };

export type AutomationPausedFromState = "queued" | "running" | "waiting" | "failed";

export interface StaffSafeAutomationActivation {
  readonly id: ExecutableAutomationFamily;
  readonly workspaceId: AuthoritativeAutomationDefinition["workspaceId"];
  readonly family: ExecutableAutomationFamily;
  readonly activeDefinitionId: AutomationDefinitionId;
  readonly activeDefinitionVersion: number;
  readonly activeDefinitionContentHash: Sha256Digest;
  readonly activeDefinitionApprovalHash: Sha256Digest;
  readonly activeDefinitionApprovalScope: "simulation_only";
  readonly activeDefinitionSecretBindingHash: Sha256Digest;
  readonly activatedByUid: UserId;
  readonly activatedAt: ISODateTime;
  readonly activationEventId: AutomationDefinitionEventId;
  readonly activationAuditEventId: AuditEventId;
  readonly revision: number;
  readonly createdAt: ISODateTime;
  readonly updatedAt: ISODateTime;
  readonly schemaVersion: 1;
  readonly synthetic: true;
  readonly externalDispatchCount: 0;
  readonly networkCallCount: 0;
}

export function assertAutomationActivationBinding(
  activation: Pick<
    StaffSafeAutomationActivation,
    | "workspaceId"
    | "family"
    | "activeDefinitionId"
    | "activeDefinitionVersion"
    | "activeDefinitionContentHash"
    | "activeDefinitionApprovalHash"
    | "activeDefinitionApprovalScope"
    | "activeDefinitionSecretBindingHash"
  >,
  definition: Pick<
    AuthoritativeAutomationDefinition,
    | "workspaceId"
    | "id"
    | "family"
    | "version"
    | "contentHash"
    | "approvalHash"
    | "approvalScope"
    | "secretBindingHash"
    | "lifecycleState"
  >,
): void {
  if (
    !EXECUTABLE_AUTOMATION_FAMILIES.some((family) => family === definition.family) ||
    definition.lifecycleState !== "approved" ||
    definition.approvalHash === null ||
    definition.approvalScope !== "simulation_only" ||
    activation.workspaceId !== definition.workspaceId ||
    activation.family !== definition.family ||
    activation.activeDefinitionId !== definition.id ||
    activation.activeDefinitionVersion !== definition.version ||
    activation.activeDefinitionContentHash !== definition.contentHash ||
    activation.activeDefinitionApprovalHash !== definition.approvalHash ||
    activation.activeDefinitionApprovalScope !== definition.approvalScope ||
    activation.activeDefinitionSecretBindingHash !== definition.secretBindingHash
  ) {
    throw new Error("Automation activation must exactly bind an approved immutable definition.");
  }
}

interface StaffSafeAutomationDefinitionEventBase {
  readonly id: AutomationDefinitionEventId;
  readonly workspaceId: AuthoritativeAutomationDefinition["workspaceId"];
  readonly family: AutomationDefinitionFamily;
  readonly eventType: "created" | "review_requested" | "approved" | "activated" | "retired";
  readonly definitionId: AutomationDefinitionId;
  readonly definitionVersion: number;
  readonly definitionContentHash: Sha256Digest;
  readonly definitionApprovalHash: Sha256Digest | null;
  readonly definitionApprovalScope: "simulation_only" | null;
  readonly definitionSecretBindingHash: Sha256Digest;
  readonly fromLifecycleState: AuthoritativeAutomationDefinition["lifecycleState"] | null;
  readonly toLifecycleState: AuthoritativeAutomationDefinition["lifecycleState"];
  readonly revision: number;
  /** Exact-get join to the redacted audit record created in the same transaction. */
  readonly auditEventId: AuditEventId;
  readonly occurredAt: ISODateTime;
  readonly schemaVersion: 1;
  readonly synthetic: true;
  readonly externalDispatchCount: 0;
  readonly networkCallCount: 0;
}

export type StaffSafeAutomationDefinitionEvent =
  StaffSafeAutomationDefinitionEventBase & GovernedActor;

export function assertAutomationDefinitionEventBinding(
  event: StaffSafeAutomationDefinitionEvent,
): void {
  assertImmutableEventMetadata(event);
  assertGovernedActor({ actorKind: event.actorKind, actorUid: event.actorUid } as GovernedActor);
  if (event.actorKind !== "staff") {
    throw new Error("Automation definition lifecycle events require a staff actor.");
  }
  if ((event.definitionApprovalHash === null) !== (event.definitionApprovalScope === null)) {
    throw new Error("Automation definition event approval hash and scope must be written together.");
  }
  if (event.eventType === "created") {
    if (
      event.fromLifecycleState !== null ||
      event.toLifecycleState !== "draft" ||
      event.definitionApprovalHash !== null
    ) {
      throw new Error("Created automation events must enter draft from no prior lifecycle state.");
    }
  } else if (event.eventType === "review_requested") {
    if (
      event.fromLifecycleState !== "draft" ||
      event.toLifecycleState !== "review_pending" ||
      event.definitionApprovalHash !== null
    ) {
      throw new Error("Review-requested automation events must transition draft to review_pending.");
    }
  } else if (event.eventType === "approved") {
    if (
      event.fromLifecycleState !== "review_pending" ||
      event.toLifecycleState !== "approved" ||
      event.definitionApprovalHash === null
    ) {
      throw new Error("Approved automation events require matching approval evidence.");
    }
  } else if (event.eventType === "activated") {
    if (
      event.fromLifecycleState !== "approved" ||
      event.toLifecycleState !== "approved" ||
      event.definitionApprovalHash === null ||
      !EXECUTABLE_AUTOMATION_FAMILIES.some((family) => family === event.family)
    ) {
      throw new Error("Activated automation events require an approved executable definition.");
    }
  } else {
    const retiredFromApproved = event.fromLifecycleState === "approved";
    if (
      event.toLifecycleState !== "retired" ||
      event.fromLifecycleState === null ||
      event.fromLifecycleState === "retired" ||
      retiredFromApproved !== (event.definitionApprovalHash !== null)
    ) {
      throw new Error(
        "Retired automation events must preserve approval evidence exactly when retiring an approved definition.",
      );
    }
  }
}

export function assertAutomationActivationProof(
  activation: Pick<
    StaffSafeAutomationActivation,
    | "id"
    | "workspaceId"
    | "family"
    | "activeDefinitionId"
    | "activeDefinitionVersion"
    | "activeDefinitionContentHash"
    | "activeDefinitionApprovalHash"
    | "activeDefinitionApprovalScope"
    | "activeDefinitionSecretBindingHash"
    | "activatedByUid"
    | "activatedAt"
    | "activationEventId"
    | "activationAuditEventId"
  >,
  definition: Parameters<typeof assertAutomationActivationBinding>[1],
  event: StaffSafeAutomationDefinitionEvent,
): void {
  assertAutomationActivationBinding(activation, definition);
  assertAutomationDefinitionEventBinding(event);
  if (
    activation.id !== activation.family ||
    event.eventType !== "activated" ||
    activation.workspaceId !== event.workspaceId ||
    activation.family !== event.family ||
    activation.activeDefinitionId !== event.definitionId ||
    activation.activeDefinitionVersion !== event.definitionVersion ||
    activation.activeDefinitionContentHash !== event.definitionContentHash ||
    activation.activeDefinitionApprovalHash !== event.definitionApprovalHash ||
    activation.activeDefinitionApprovalScope !== event.definitionApprovalScope ||
    activation.activeDefinitionSecretBindingHash !== event.definitionSecretBindingHash ||
    activation.activationEventId !== event.id ||
    activation.activationAuditEventId !== event.auditEventId ||
    activation.activatedByUid !== event.actorUid ||
    activation.activatedAt !== event.occurredAt
  ) {
    throw new Error(
      "Automation activation must exactly bind its approved definition and staff activation event.",
    );
  }
}

export interface AutomationTriggerReceiptSecretProjection {
  readonly id: AutomationTriggerReceiptId;
  readonly workspaceId: AuthoritativeAutomationDefinition["workspaceId"];
  readonly family: ExecutableAutomationFamily;
  readonly definitionId: AutomationDefinitionId;
  readonly definitionVersion: number;
  readonly definitionContentHash: Sha256Digest;
  readonly definitionApprovalHash: Sha256Digest;
  readonly activationEventId: AutomationDefinitionEventId;
  /** Non-reversible digest of the source event; raw provider IDs remain server-only. */
  readonly sourceEventFingerprint: Sha256Digest;
  /** HMAC over the stable v2 workspace/executable-family/source-event tuple. */
  readonly triggerFingerprint: HmacDigest;
  readonly runId: AutomationRunId;
  readonly createdAt: ISODateTime;
  readonly schemaVersion: 1;
  readonly synthetic: true;
}

export function assertAutomationTriggerReceiptIdentity(
  receipt: Pick<AutomationTriggerReceiptSecretProjection, "id" | "triggerFingerprint">,
  expectedFingerprint: HmacDigest,
): void {
  if (String(receipt.id) !== String(expectedFingerprint) || receipt.triggerFingerprint !== expectedFingerprint) {
    throw new Error("Automation trigger receipt id must equal its canonical HMAC fingerprint.");
  }
}

export type AutomationSafeOutcomeCode =
  | "accepted"
  | "step_completed"
  | "wait_scheduled"
  | "human_takeover_required"
  | "fallback_work_item_created"
  | "fallback_stopped_safely"
  | "retry_scheduled"
  | "completed"
  | "ended_by_operator"
  | "synthetic_failure";

function automationFallbackForOutcome(
  outcomeCode: AutomationSafeOutcomeCode,
): AutomationStepPolicy["fallback"] | null {
  if (outcomeCode === "fallback_work_item_created") return "create_work_item";
  if (outcomeCode === "human_takeover_required") return "route_to_human";
  if (outcomeCode === "fallback_stopped_safely") return "stop_run";
  return null;
}

export type AutomationRunEventReasonCode =
  | "trigger_accepted"
  | "step_policy_applied"
  | "operator_requested"
  | "human_takeover"
  | "integration_timeout"
  | "synthetic_failure"
  | "retry_policy_applied"
  | "fallback_policy_applied"
  | "policy_complete"
  | "synthetic_test";

export interface StaffSafeAutomationRun extends WorkspaceScopedEntity<AutomationRunId> {
  readonly definitionId: AutomationDefinitionId;
  readonly definitionVersion: number;
  readonly definitionContentHash: Sha256Digest;
  readonly teamId: TeamId;
  readonly locationId: LocationId;
  readonly state: AutomationExecutionState;
  /** Original runnable state retained across operator and human pauses. */
  readonly pausedFromState: AutomationPausedFromState | null;
  /** Queryable due time for waits/retries; preserved when a waiting run is paused. */
  readonly nextEligibleAt: ISODateTime | null;
  /** At most one unresolved work item may govern a paused or failed run. */
  readonly openWorkItemId: AutomationWorkItemId | null;
  readonly currentStepIndex: number;
  readonly completedStepCount: number;
  readonly attemptCount: number;
  readonly revision: number;
  readonly outcomeCode: AutomationSafeOutcomeCode;
  readonly lastEventId: AutomationRunEventId | null;
  readonly schemaVersion: 1;
  readonly synthetic: true;
  readonly externalDispatchCount: 0;
  readonly networkCallCount: 0;
}

interface StaffSafeAutomationRunEventBase {
  readonly id: AutomationRunEventId;
  readonly workspaceId: AuthoritativeAutomationDefinition["workspaceId"];
  readonly runId: AutomationRunId;
  readonly definitionId: AutomationDefinitionId;
  readonly definitionVersion: number;
  readonly definitionContentHash: Sha256Digest;
  readonly teamId: TeamId;
  readonly locationId: LocationId;
  readonly revision: number;
  /** Exact-get join to the redacted audit record created in the same transaction. */
  readonly auditEventId: AuditEventId;
  readonly action: AutomationRunAction;
  readonly fromState: AutomationExecutionState;
  readonly toState: AutomationExecutionState;
  readonly stepIndex: number | null;
  readonly stepId: string | null;
  readonly attemptNumber: number;
  readonly workItemId: AutomationWorkItemId | null;
  /** Required exactly when the post-action run is waiting. */
  readonly nextEligibleAt: ISODateTime | null;
  readonly reasonCode: AutomationRunEventReasonCode;
  /** Keyed HMAC over server-only evidence; never raw or guessable context. */
  readonly evidenceFingerprint: HmacDigest;
  readonly outcomeCode: AutomationSafeOutcomeCode;
  readonly occurredAt: ISODateTime;
  readonly schemaVersion: 1;
  readonly synthetic: true;
  readonly externalDispatchCount: 0;
  readonly networkCallCount: 0;
}

export type StaffSafeAutomationRunEvent = StaffSafeAutomationRunEventBase & GovernedActor;

export function assertAutomationRunEventTrace(event: StaffSafeAutomationRunEvent): void {
  assertImmutableEventMetadata(event);
  assertGovernedActor({ actorKind: event.actorKind, actorUid: event.actorUid } as GovernedActor);
  if ((event.stepIndex === null) !== (event.stepId === null)) {
    throw new Error("Automation event stepIndex and stepId must be written together.");
  }
  if (
    event.stepIndex !== null &&
    (!Number.isInteger(event.stepIndex) || event.stepIndex < 0 || event.stepIndex > 31)
  ) {
    throw new Error("Automation event stepIndex must be an integer from 0 to 31.");
  }
  if (!/^[a-f0-9]{64}$/.test(event.evidenceFingerprint)) {
    throw new Error("Automation event evidenceFingerprint must be a lowercase HMAC-SHA-256 digest.");
  }
  const stepScoped = ["advance_step", "exercise_fallback", "inject_failure", "retry"].includes(
    event.action,
  );
  if ((event.stepId !== null) !== stepScoped) {
    throw new Error("Only step-scoped automation actions may bind step evidence.");
  }
  if (
    !Number.isInteger(event.attemptNumber) ||
    (stepScoped
      ? event.attemptNumber < 1 || event.attemptNumber > 11
      : event.attemptNumber !== 0)
  ) {
    throw new Error("Automation event attemptNumber must match its action scope.");
  }
  const requiresWaitingSchedule =
    event.toState === "waiting" ||
    (event.fromState === "waiting" &&
      (event.toState === "paused_by_operator" || event.toState === "paused_for_human"));
  const mayPreservePausedSchedule =
    (event.fromState === "paused_by_operator" || event.fromState === "paused_for_human") &&
    (event.toState === "paused_by_operator" || event.toState === "paused_for_human");
  if (
    (requiresWaitingSchedule && event.nextEligibleAt === null) ||
    (!requiresWaitingSchedule && !mayPreservePausedSchedule && event.nextEligibleAt !== null)
  ) {
    throw new Error("Waiting and paused-wait automation events require exactly one nextEligibleAt.");
  }
  if (event.nextEligibleAt !== null && !isCanonicalIsoDateTime(event.nextEligibleAt)) {
    throw new Error("Automation event nextEligibleAt must be a canonical ISO date-time.");
  }
  const staffOnlyAction = [
    "pause",
    "resume",
    "release_human_takeover",
    "retry",
    "end",
  ].includes(event.action);
  const failedFallback =
    event.action === "exercise_fallback" && event.fromState === "failed";
  if ((staffOnlyAction || failedFallback) && event.actorKind !== "staff") {
    throw new Error(`Automation action ${event.action} requires a staff actor.`);
  }
  const workItemRequired =
    event.outcomeCode === "fallback_work_item_created" ||
    event.outcomeCode === "human_takeover_required" ||
    event.outcomeCode === "synthetic_failure" ||
    event.action === "retry" ||
    event.action === "release_human_takeover" ||
    (event.action === "exercise_fallback" && event.fromState === "failed");
  const workItemAllowed =
    workItemRequired || event.action === "resume" || event.action === "end";
  if (workItemRequired && event.workItemId === null) {
    throw new Error(
      "Automation failure, fallback, takeover, release and retry events require exactly one workItemId.",
    );
  }
  if (!workItemAllowed && event.workItemId !== null) {
    throw new Error("Only governed work-item creation or resolution events may bind workItemId.");
  }
  if (
    event.workItemId !== null &&
    (typeof event.workItemId !== "string" || event.workItemId.trim().length < 3)
  ) {
    throw new Error("Automation event workItemId must be a canonical identifier.");
  }

  let expectedState: AutomationExecutionState;
  let expectedOutcome: AutomationSafeOutcomeCode;
  let allowedReasons: readonly AutomationRunEventReasonCode[];
  if (event.action === "start") {
    expectedState = transitionAutomationRunState(event.fromState, event.action);
    expectedOutcome = "accepted";
    allowedReasons = ["trigger_accepted"];
  } else if (event.action === "advance_step") {
    const outcome =
      event.toState === "completed"
        ? "complete"
        : event.toState === "waiting"
          ? "wait"
          : "continue";
    expectedState = transitionAutomationRunState(event.fromState, event.action, { outcome });
    expectedOutcome =
      outcome === "complete"
        ? "completed"
        : outcome === "wait"
          ? "wait_scheduled"
          : "step_completed";
    allowedReasons = outcome === "complete" ? ["policy_complete"] : ["step_policy_applied"];
  } else if (event.action === "pause") {
    expectedState = transitionAutomationRunState(event.fromState, event.action);
    expectedOutcome = "accepted";
    allowedReasons = ["operator_requested"];
  } else if (event.action === "resume") {
    if (
      !(["queued", "running", "waiting", "failed"] as const).includes(
        event.toState as AutomationPausedFromState,
      )
    ) {
      throw new Error("Resume events must restore a persisted runnable pausedFromState.");
    }
    expectedState = transitionAutomationRunState(event.fromState, event.action, {
      resumeFromState: event.toState as AutomationPausedFromState,
    });
    expectedOutcome = "accepted";
    allowedReasons = ["operator_requested"];
  } else if (event.action === "simulate_human_takeover") {
    expectedState = transitionAutomationRunState(event.fromState, event.action, {
      pausedFromState:
        event.fromState === "paused_by_operator" ? "running" : null,
    });
    expectedOutcome = "human_takeover_required";
    allowedReasons = ["human_takeover"];
  } else if (event.action === "release_human_takeover") {
    expectedState = transitionAutomationRunState(event.fromState, event.action);
    expectedOutcome = "accepted";
    allowedReasons = ["human_takeover"];
  } else if (event.action === "exercise_fallback") {
    const fallback = automationFallbackForOutcome(event.outcomeCode);
    if (fallback === null) {
      throw new Error("Fallback actions require an exact governed fallback outcome.");
    }
    expectedState = transitionAutomationRunState(event.fromState, event.action, { fallback });
    expectedOutcome = event.outcomeCode;
    allowedReasons = ["fallback_policy_applied"];
  } else if (event.action === "inject_failure") {
    expectedState = transitionAutomationRunState(event.fromState, event.action);
    expectedOutcome = "synthetic_failure";
    allowedReasons = ["integration_timeout", "synthetic_failure"];
  } else if (event.action === "retry") {
    expectedState = transitionAutomationRunState(event.fromState, event.action, {
      retryAt: event.nextEligibleAt!,
    });
    expectedOutcome = "retry_scheduled";
    allowedReasons = ["retry_policy_applied"];
  } else {
    expectedState = transitionAutomationRunState(event.fromState, event.action);
    expectedOutcome = "ended_by_operator";
    allowedReasons = ["operator_requested"];
  }
  if (
    event.toState !== expectedState ||
    event.outcomeCode !== expectedOutcome ||
    !allowedReasons.includes(event.reasonCode)
  ) {
    throw new Error(
      `Automation action ${event.action} has an invalid state, outcome, or reason trace.`,
    );
  }
}

export interface StaffSafeAutomationWorkItem extends WorkspaceScopedEntity<AutomationWorkItemId> {
  readonly runId: AutomationRunId;
  readonly definitionId: AutomationDefinitionId;
  readonly definitionVersion: number;
  readonly definitionContentHash: Sha256Digest;
  readonly teamId: TeamId;
  readonly locationId: LocationId;
  readonly reasonCode:
    | "integration_timeout"
    | "retry_exhausted"
    | "fallback_route"
    | "human_takeover"
    | "synthetic_failure";
  readonly state: "open" | "acknowledged" | "resolved";
  readonly openedAt: ISODateTime;
  readonly slaMinutes: number;
  readonly dueAt: ISODateTime;
  readonly assignedMemberUid: UserId | null;
  readonly acknowledgedAt: ISODateTime | null;
  readonly acknowledgedByUid: UserId | null;
  readonly resolvedAt: ISODateTime | null;
  readonly resolvedByUid: UserId | null;
  readonly resolutionCode: "retried" | "routed_to_human" | "stopped_safely" | null;
  readonly revision: number;
  readonly lastEventId: AutomationRunEventId;
  readonly schemaVersion: 1;
  readonly synthetic: true;
  readonly externalDispatchCount: 0;
  readonly networkCallCount: 0;
}

export function assertGovernedActor(actor: GovernedActor): void {
  const keys = Object.keys(actor).sort();
  if (keys.length !== 2 || keys[0] !== "actorKind" || keys[1] !== "actorUid") {
    throw new Error("Governed actor evidence must use the exact actorKind/actorUid shape.");
  }
  if (actor.actorKind === "system") {
    if (actor.actorUid !== null) throw new Error("System actors must use a null actorUid.");
    return;
  }
  if (typeof actor.actorUid !== "string" || actor.actorUid.trim().length < 3) {
    throw new Error("Staff actors require a canonical actorUid.");
  }
}

function isCanonicalIsoDateTime(value: unknown): value is ISODateTime {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function assertImmutableEventMetadata(event: {
  readonly revision: number;
  readonly auditEventId: AuditEventId;
  readonly occurredAt: ISODateTime;
}): void {
  if (!Number.isInteger(event.revision) || event.revision < 1 || event.revision > 1_000_000) {
    throw new Error("Immutable event revision must be an integer from 1 to 1000000.");
  }
  if (!isCanonicalIsoDateTime(event.occurredAt)) {
    throw new Error("Immutable event occurredAt must be a canonical ISO date-time.");
  }
  if (
    typeof event.auditEventId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(event.auditEventId)
  ) {
    throw new Error("Immutable event auditEventId must be a canonical exact-get identifier.");
  }
}

export function assertAutomationWorkItemLifecycle(
  item: Pick<
    StaffSafeAutomationWorkItem,
    | "state"
    | "openedAt"
    | "slaMinutes"
    | "dueAt"
    | "acknowledgedAt"
    | "acknowledgedByUid"
    | "resolvedAt"
    | "resolvedByUid"
    | "resolutionCode"
  >,
): void {
  if (
    !isCanonicalIsoDateTime(item.openedAt) ||
    !isCanonicalIsoDateTime(item.dueAt) ||
    (item.acknowledgedAt !== null && !isCanonicalIsoDateTime(item.acknowledgedAt)) ||
    (item.resolvedAt !== null && !isCanonicalIsoDateTime(item.resolvedAt))
  ) {
    throw new Error("Automation work-item timestamps must be canonical ISO date-times.");
  }
  if (!Number.isInteger(item.slaMinutes) || item.slaMinutes < 1 || item.slaMinutes > 1_440) {
    throw new Error("Automation work-item SLA must be 1 to 1440 minutes.");
  }
  if (Date.parse(item.dueAt) - Date.parse(item.openedAt) !== item.slaMinutes * 60_000) {
    throw new Error("Automation work-item dueAt must exactly match its frozen SLA.");
  }
  if ((item.acknowledgedAt === null) !== (item.acknowledgedByUid === null)) {
    throw new Error("Work-item acknowledgement actor and timestamp must be written together.");
  }
  const resolutionNulls = [item.resolvedAt, item.resolvedByUid, item.resolutionCode].filter(
    (value) => value === null,
  ).length;
  if (resolutionNulls !== 0 && resolutionNulls !== 3) {
    throw new Error("Work-item resolution actor, timestamp and code must be written together.");
  }
  const hasAcknowledgement = item.acknowledgedAt !== null && item.acknowledgedByUid !== null;
  const hasResolution =
    item.resolvedAt !== null && item.resolvedByUid !== null && item.resolutionCode !== null;
  if (item.state === "open" && (hasAcknowledgement || hasResolution)) {
    throw new Error("Open work items cannot contain acknowledgement or resolution evidence.");
  }
  if (item.state === "acknowledged" && (!hasAcknowledgement || hasResolution)) {
    throw new Error("Acknowledged work items require only acknowledgement evidence.");
  }
  if (item.state === "resolved" && (!hasAcknowledgement || !hasResolution)) {
    throw new Error("Resolved work items require acknowledgement and resolution evidence.");
  }
  if (
    (item.acknowledgedAt !== null && Date.parse(item.acknowledgedAt) < Date.parse(item.openedAt)) ||
    (item.resolvedAt !== null &&
      item.acknowledgedAt !== null &&
      Date.parse(item.resolvedAt) < Date.parse(item.acknowledgedAt))
  ) {
    throw new Error("Work-item lifecycle timestamps must be monotonic.");
  }
}

export interface AutomationDefinitionSecretProjection {
  readonly workspaceId: AuthoritativeAutomationDefinition["workspaceId"];
  readonly definitionId: AutomationDefinitionId;
  readonly protectedConfigurationRef: EncryptedValueRef;
  readonly configurationFingerprint: Sha256Digest;
  readonly schemaVersion: 1;
  readonly synthetic: true;
}

export interface AutomationRunSecretProjection {
  readonly workspaceId: AuthoritativeAutomationDefinition["workspaceId"];
  readonly runId: AutomationRunId;
  readonly protectedContactRef: EncryptedValueRef;
  readonly protectedConversationRef: EncryptedValueRef;
  readonly protectedAppointmentRef: EncryptedValueRef | null;
  readonly triggerFingerprint: HmacDigest;
  readonly idempotencyFingerprint: HmacDigest;
  readonly schemaVersion: 1;
  readonly synthetic: true;
}

/** Proves a run secret can join its immutable trigger receipt without a query. */
export function assertAutomationRunSecretReceiptLink(
  secret: Pick<AutomationRunSecretProjection, "workspaceId" | "runId" | "triggerFingerprint">,
  receipt: Pick<
    AutomationTriggerReceiptSecretProjection,
    "id" | "workspaceId" | "runId" | "triggerFingerprint"
  >,
): void {
  assertAutomationTriggerReceiptIdentity(receipt, receipt.triggerFingerprint);
  if (
    secret.workspaceId !== receipt.workspaceId ||
    secret.runId !== receipt.runId ||
    secret.triggerFingerprint !== receipt.triggerFingerprint ||
    String(secret.triggerFingerprint) !== String(receipt.id)
  ) {
    throw new Error("Automation run secret must exactly cross-bind its immutable trigger receipt.");
  }
}

export function assertAutomationTriggerReceiptRunBinding(
  receipt: Pick<
    AutomationTriggerReceiptSecretProjection,
    | "workspaceId"
    | "runId"
    | "definitionId"
    | "definitionVersion"
    | "definitionContentHash"
  >,
  run: Pick<
    StaffSafeAutomationRun,
    | "workspaceId"
    | "id"
    | "definitionId"
    | "definitionVersion"
    | "definitionContentHash"
  >,
): void {
  if (
    receipt.workspaceId !== run.workspaceId ||
    receipt.runId !== run.id ||
    receipt.definitionId !== run.definitionId ||
    receipt.definitionVersion !== run.definitionVersion ||
    receipt.definitionContentHash !== run.definitionContentHash
  ) {
    throw new Error("Automation trigger receipt must exactly bind its staff-safe run aggregate.");
  }
}

/**
 * Proves that one immutable trigger receipt was created only after the exact
 * active definition became authoritative and in the same transaction as its
 * staff-safe run aggregate.
 */
export function assertAutomationTriggerReceiptChronology(
  activation: Pick<
    StaffSafeAutomationActivation,
    | "workspaceId"
    | "family"
    | "activeDefinitionId"
    | "activeDefinitionVersion"
    | "activeDefinitionContentHash"
    | "activeDefinitionApprovalHash"
    | "activationEventId"
    | "activatedAt"
  >,
  receipt: Pick<
    AutomationTriggerReceiptSecretProjection,
    | "workspaceId"
    | "family"
    | "definitionId"
    | "definitionVersion"
    | "definitionContentHash"
    | "definitionApprovalHash"
    | "activationEventId"
    | "runId"
    | "createdAt"
  >,
  run: Pick<StaffSafeAutomationRun, "workspaceId" | "id" | "createdAt">,
): void {
  if (
    !isCanonicalIsoDateTime(activation.activatedAt) ||
    !isCanonicalIsoDateTime(receipt.createdAt) ||
    !isCanonicalIsoDateTime(run.createdAt) ||
    activation.workspaceId !== receipt.workspaceId ||
    activation.family !== receipt.family ||
    activation.activeDefinitionId !== receipt.definitionId ||
    activation.activeDefinitionVersion !== receipt.definitionVersion ||
    activation.activeDefinitionContentHash !== receipt.definitionContentHash ||
    activation.activeDefinitionApprovalHash !== receipt.definitionApprovalHash ||
    activation.activationEventId !== receipt.activationEventId ||
    receipt.workspaceId !== run.workspaceId ||
    receipt.runId !== run.id ||
    Date.parse(activation.activatedAt) > Date.parse(receipt.createdAt) ||
    receipt.createdAt !== run.createdAt
  ) {
    throw new Error(
      "Automation trigger receipt chronology must bind the exact prior activation and same-createdAt run aggregate.",
    );
  }
}

export interface AutomationRunEventSecretProjection {
  readonly workspaceId: AuthoritativeAutomationDefinition["workspaceId"];
  readonly runId: AutomationRunId;
  readonly eventId: AutomationRunEventId;
  readonly protectedContextRef: EncryptedValueRef;
  /** Same managed-key HMAC exposed on the staff-safe event for an exact no-query join. */
  readonly contextFingerprint: HmacDigest;
  readonly schemaVersion: 1;
  readonly synthetic: true;
}

/** Every public run event must exact-link one client-denied protected context projection. */
export function assertAutomationRunEventSecretBinding(
  event: Pick<
    StaffSafeAutomationRunEvent,
    "id" | "workspaceId" | "runId" | "evidenceFingerprint"
  >,
  secret: Pick<
    AutomationRunEventSecretProjection,
    "workspaceId" | "runId" | "eventId" | "contextFingerprint"
  > | null,
): void {
  if (
    secret === null ||
    secret.workspaceId !== event.workspaceId ||
    secret.runId !== event.runId ||
    secret.eventId !== event.id ||
    secret.contextFingerprint !== event.evidenceFingerprint
  ) {
    throw new Error(
      "Automation run event must exactly bind its required server-only evidence projection.",
    );
  }
}

export interface AutomationWorkItemSecretProjection {
  readonly workspaceId: AuthoritativeAutomationDefinition["workspaceId"];
  readonly runId: AutomationRunId;
  readonly workItemId: AutomationWorkItemId;
  readonly protectedContextRef: EncryptedValueRef;
  readonly contextFingerprint: Sha256Digest;
  readonly schemaVersion: 1;
  readonly synthetic: true;
}

export type CarePathwayFamily = "post_discharge";
export type CareAfterHoursBehavior = CarePathway["afterHoursBehavior"];

export interface CareLocalizedTemplateBinding {
  readonly templateVersionId: TemplateVersionId;
  readonly contentHash: Sha256Digest;
}

export interface CarePathwayContactPoint {
  readonly dayOffset: number;
  readonly en: CareLocalizedTemplateBinding;
  readonly si: CareLocalizedTemplateBinding;
  readonly ta: CareLocalizedTemplateBinding;
}

export interface AuthoritativeCarePathway extends WorkspaceScopedEntity<CarePathwayId> {
  readonly family: CarePathwayFamily;
  readonly protocolVersion: string;
  readonly name: string;
  readonly clinicalOwnerUid: UserId;
  readonly clinicalApproverUid: UserId | null;
  readonly contactPoints: readonly CarePathwayContactPoint[];
  readonly responseSlaMinutes: number;
  readonly escalationTeamId: TeamId;
  readonly eligibleLocationIds: readonly LocationId[];
  readonly afterHoursBehavior: CareAfterHoursBehavior;
  readonly writeBackRequired: boolean;
  readonly instructionsSource: "clinician_authored";
  readonly aiMayGenerateInstructions: false;
  readonly suppressions: typeof CARE_PATHWAY_SUPPRESSIONS;
  readonly protectedContentHash: Sha256Digest;
  readonly secretBindingHash: Sha256Digest;
  readonly contentHash: Sha256Digest;
  readonly approvalHash: Sha256Digest | null;
  readonly approvalScope: "clinical_simulation_only" | null;
  readonly approvedAt: ISODateTime | null;
  readonly lifecycleState: "draft" | "clinical_review" | "approved" | "retired";
  readonly schemaVersion: 1;
  readonly synthetic: true;
}

export type CareSafeOutcomeCode =
  | "accepted"
  | "contact_advanced"
  | "suppressed_terminal"
  | "clinical_hold_applied"
  | "human_takeover_required"
  | "red_flag_escalated"
  | "escalation_acknowledged"
  | "escalation_resolved_safety_hold"
  | "escalation_resolved_terminal_suppression"
  | "safety_hold_cleared"
  | "completed"
  | "ended_by_operator";

export interface StaffSafeCarePathwayActivation {
  readonly id: CarePathwayFamily;
  readonly workspaceId: AuthoritativeCarePathway["workspaceId"];
  readonly family: CarePathwayFamily;
  readonly activePathwayId: CarePathwayId;
  readonly activeProtocolVersion: string;
  readonly activePathwayContentHash: Sha256Digest;
  readonly activePathwayApprovalHash: Sha256Digest;
  readonly activePathwayApprovalScope: "clinical_simulation_only";
  readonly activePathwaySecretBindingHash: Sha256Digest;
  readonly activatedByUid: UserId;
  readonly activatedAt: ISODateTime;
  readonly activationEventId: CarePathwayEventId;
  readonly activationAuditEventId: AuditEventId;
  readonly revision: number;
  readonly createdAt: ISODateTime;
  readonly updatedAt: ISODateTime;
  readonly schemaVersion: 1;
  readonly synthetic: true;
  readonly externalDispatchCount: 0;
  readonly networkCallCount: 0;
}

export function assertCarePathwayActivationBinding(
  activation: Pick<
    StaffSafeCarePathwayActivation,
    | "workspaceId"
    | "family"
    | "activePathwayId"
    | "activeProtocolVersion"
    | "activePathwayContentHash"
    | "activePathwayApprovalHash"
    | "activePathwayApprovalScope"
    | "activePathwaySecretBindingHash"
  >,
  pathway: Pick<
    AuthoritativeCarePathway,
    | "workspaceId"
    | "id"
    | "family"
    | "protocolVersion"
    | "contentHash"
    | "approvalHash"
    | "approvalScope"
    | "secretBindingHash"
    | "lifecycleState"
  >,
): void {
  if (
    pathway.lifecycleState !== "approved" ||
    pathway.approvalHash === null ||
    pathway.approvalScope !== "clinical_simulation_only" ||
    activation.workspaceId !== pathway.workspaceId ||
    activation.family !== pathway.family ||
    activation.activePathwayId !== pathway.id ||
    activation.activeProtocolVersion !== pathway.protocolVersion ||
    activation.activePathwayContentHash !== pathway.contentHash ||
    activation.activePathwayApprovalHash !== pathway.approvalHash ||
    activation.activePathwayApprovalScope !== pathway.approvalScope ||
    activation.activePathwaySecretBindingHash !== pathway.secretBindingHash
  ) {
    throw new Error("Care activation must exactly bind an approved immutable pathway.");
  }
}

interface StaffSafeCarePathwayEventBase {
  readonly id: CarePathwayEventId;
  readonly workspaceId: AuthoritativeCarePathway["workspaceId"];
  readonly family: CarePathwayFamily;
  readonly eventType:
    | "created"
    | "clinical_review_requested"
    | "approved"
    | "activated"
    | "retired";
  readonly pathwayId: CarePathwayId;
  readonly pathwayProtocolVersion: string;
  readonly pathwayContentHash: Sha256Digest;
  readonly pathwayApprovalHash: Sha256Digest | null;
  readonly pathwayApprovalScope: "clinical_simulation_only" | null;
  readonly pathwaySecretBindingHash: Sha256Digest;
  readonly fromLifecycleState: AuthoritativeCarePathway["lifecycleState"] | null;
  readonly toLifecycleState: AuthoritativeCarePathway["lifecycleState"];
  readonly revision: number;
  /** Exact-get join to the redacted audit record created in the same transaction. */
  readonly auditEventId: AuditEventId;
  readonly occurredAt: ISODateTime;
  readonly schemaVersion: 1;
  readonly synthetic: true;
  readonly externalDispatchCount: 0;
  readonly networkCallCount: 0;
}

export type StaffSafeCarePathwayEvent = StaffSafeCarePathwayEventBase & GovernedActor;

export function assertCarePathwayEventBinding(event: StaffSafeCarePathwayEvent): void {
  assertImmutableEventMetadata(event);
  assertGovernedActor({ actorKind: event.actorKind, actorUid: event.actorUid } as GovernedActor);
  if (event.actorKind !== "staff") {
    throw new Error("Care pathway lifecycle events require a staff actor.");
  }
  if ((event.pathwayApprovalHash === null) !== (event.pathwayApprovalScope === null)) {
    throw new Error("Care pathway event approval hash and scope must be written together.");
  }
  if (event.eventType === "created") {
    if (
      event.fromLifecycleState !== null ||
      event.toLifecycleState !== "draft" ||
      event.pathwayApprovalHash !== null
    ) {
      throw new Error("Created care events must enter draft from no prior lifecycle state.");
    }
  } else if (event.eventType === "clinical_review_requested") {
    if (
      event.fromLifecycleState !== "draft" ||
      event.toLifecycleState !== "clinical_review" ||
      event.pathwayApprovalHash !== null
    ) {
      throw new Error("Care review events must transition draft to clinical_review.");
    }
  } else if (event.eventType === "approved") {
    if (
      event.fromLifecycleState !== "clinical_review" ||
      event.toLifecycleState !== "approved" ||
      event.pathwayApprovalHash === null
    ) {
      throw new Error("Approved care events require matching clinical approval evidence.");
    }
  } else if (event.eventType === "activated") {
    if (
      event.fromLifecycleState !== "approved" ||
      event.toLifecycleState !== "approved" ||
      event.pathwayApprovalHash === null
    ) {
      throw new Error("Activated care events require an already-approved pathway.");
    }
  } else {
    const retiredFromApproved = event.fromLifecycleState === "approved";
    if (
      event.toLifecycleState !== "retired" ||
      event.fromLifecycleState === null ||
      event.fromLifecycleState === "retired" ||
      retiredFromApproved !== (event.pathwayApprovalHash !== null)
    ) {
      throw new Error(
        "Retired care events must preserve approval evidence exactly when retiring an approved pathway.",
      );
    }
  }
}

export function assertCarePathwayActivationProof(
  activation: Pick<
    StaffSafeCarePathwayActivation,
    | "id"
    | "workspaceId"
    | "family"
    | "activePathwayId"
    | "activeProtocolVersion"
    | "activePathwayContentHash"
    | "activePathwayApprovalHash"
    | "activePathwayApprovalScope"
    | "activePathwaySecretBindingHash"
    | "activatedByUid"
    | "activatedAt"
    | "activationEventId"
    | "activationAuditEventId"
  >,
  pathway: Parameters<typeof assertCarePathwayActivationBinding>[1],
  event: StaffSafeCarePathwayEvent,
): void {
  assertCarePathwayActivationBinding(activation, pathway);
  assertCarePathwayEventBinding(event);
  if (
    activation.id !== activation.family ||
    event.eventType !== "activated" ||
    activation.workspaceId !== event.workspaceId ||
    activation.family !== event.family ||
    activation.activePathwayId !== event.pathwayId ||
    activation.activeProtocolVersion !== event.pathwayProtocolVersion ||
    activation.activePathwayContentHash !== event.pathwayContentHash ||
    activation.activePathwayApprovalHash !== event.pathwayApprovalHash ||
    activation.activePathwayApprovalScope !== event.pathwayApprovalScope ||
    activation.activePathwaySecretBindingHash !== event.pathwaySecretBindingHash ||
    activation.activationEventId !== event.id ||
    activation.activationAuditEventId !== event.auditEventId ||
    activation.activatedByUid !== event.actorUid ||
    activation.activatedAt !== event.occurredAt
  ) {
    throw new Error(
      "Care activation must exactly bind its approved pathway and staff activation event.",
    );
  }
}

export interface StaffSafeCareEnrollment extends WorkspaceScopedEntity<CareEnrollmentId> {
  readonly pathwayId: CarePathwayId;
  readonly pathwayProtocolVersion: string;
  readonly pathwayContentHash: Sha256Digest;
  readonly teamId: TeamId;
  readonly locationId: LocationId;
  readonly state: CareEnrollmentState;
  readonly nextContactIndex: number;
  readonly nextContactAt: ISODateTime | null;
  readonly activeSuppressions: readonly CareSuppressionReason[];
  readonly openEscalationId: CareEscalationId | null;
  readonly safetyHoldEscalationId: CareEscalationId | null;
  readonly openHandoffId: CareHandoffId | null;
  readonly revision: number;
  readonly outcomeCode: CareSafeOutcomeCode;
  readonly lastEventId: CareEnrollmentEventId | null;
  readonly schemaVersion: 1;
  readonly synthetic: true;
  readonly externalDispatchCount: 0;
  readonly networkCallCount: 0;
}

export interface StaffSafeCareHandoff extends WorkspaceScopedEntity<CareHandoffId> {
  readonly enrollmentId: CareEnrollmentId;
  readonly pathwayId: CarePathwayId;
  readonly pathwayProtocolVersion: string;
  readonly pathwayContentHash: Sha256Digest;
  readonly teamId: TeamId;
  readonly locationId: LocationId;
  readonly state: "open" | "released";
  readonly openedEventId: CareEnrollmentEventId;
  readonly openedBy: GovernedActor;
  readonly openedAt: ISODateTime;
  readonly releasedEventId: CareEnrollmentEventId | null;
  readonly releasedBy: GovernedActor | null;
  readonly releasedAt: ISODateTime | null;
  readonly revision: number;
  readonly lastEventId: CareEnrollmentEventId;
  readonly schemaVersion: 1;
  readonly synthetic: true;
  readonly externalDispatchCount: 0;
  readonly networkCallCount: 0;
}

interface StaffSafeCareEnrollmentEventBase {
  readonly id: CareEnrollmentEventId;
  readonly workspaceId: AuthoritativeCarePathway["workspaceId"];
  readonly enrollmentId: CareEnrollmentId;
  readonly pathwayId: CarePathwayId;
  readonly pathwayProtocolVersion: string;
  readonly pathwayContentHash: Sha256Digest;
  readonly teamId: TeamId;
  readonly locationId: LocationId;
  readonly revision: number;
  /** Exact-get join to the redacted audit record created in the same transaction. */
  readonly auditEventId: AuditEventId;
  readonly action: CareEnrollmentAction;
  readonly fromState: CareEnrollmentState;
  readonly toState: CareEnrollmentState;
  readonly contactPointIndex: number | null;
  readonly suppressionReason: CareSuppressionReason | null;
  readonly escalationId: CareEscalationId | null;
  readonly escalationStateBefore: StaffSafeCareEscalation["state"] | null;
  readonly escalationStateAfter: StaffSafeCareEscalation["state"] | null;
  readonly handoffId: CareHandoffId | null;
  readonly activeSuppressionsAfter: readonly CareSuppressionReason[];
  readonly nextContactAt: ISODateTime | null;
  readonly outcomeCode: CareSafeOutcomeCode;
  readonly occurredAt: ISODateTime;
  readonly schemaVersion: 1;
  readonly synthetic: true;
  readonly externalDispatchCount: 0;
  readonly networkCallCount: 0;
}

export type StaffSafeCareEnrollmentEvent = StaffSafeCareEnrollmentEventBase & GovernedActor;

export function assertCareEnrollmentEventTrace(event: StaffSafeCareEnrollmentEvent): void {
  assertImmutableEventMetadata(event);
  assertGovernedActor({ actorKind: event.actorKind, actorUid: event.actorUid } as GovernedActor);
  if (!canApplyCareEnrollmentAction(event.fromState, event.action)) {
    throw new Error(`Care action ${event.action} is not allowed from ${event.fromState}.`);
  }
  const staffOnlyAction = [
    "pause",
    "resume",
    "end",
    "release_human_takeover",
    "clear_clinical_hold",
    "acknowledge_escalation",
    "resolve_escalation",
    "clear_safety_hold",
  ].includes(event.action);
  if (staffOnlyAction && event.actorKind !== "staff") {
    throw new Error(`Care action ${event.action} requires a staff actor.`);
  }
  if (
    event.contactPointIndex !== null &&
    (!Number.isInteger(event.contactPointIndex) ||
      event.contactPointIndex < 0 ||
      event.contactPointIndex > 31)
  ) {
    throw new Error("Care event contactPointIndex must be an integer from 0 to 31.");
  }
  if ((event.action === "advance_contact") !== (event.contactPointIndex !== null)) {
    throw new Error("Only contact-advance events may bind a contactPointIndex.");
  }
  if ((event.action === "simulate_suppression") !== (event.suppressionReason !== null)) {
    throw new Error("Only suppression events may bind a suppressionReason.");
  }
  const suppressionWithinEscalation =
    event.action === "simulate_suppression" &&
    (event.fromState === "escalated" || event.toState === "escalated");
  const escalationAction = [
    "raise_red_flag",
    "acknowledge_escalation",
    "resolve_escalation",
    "clear_safety_hold",
  ].includes(event.action) || suppressionWithinEscalation;
  if (escalationAction !== (event.escalationId !== null)) {
    throw new Error("Escalation lifecycle events must bind exactly one escalationId.");
  }
  const hasEscalationState =
    event.escalationStateBefore !== null || event.escalationStateAfter !== null;
  if (escalationAction !== hasEscalationState) {
    throw new Error("Escalation events require an exact before/after escalation state snapshot.");
  }
  if (escalationAction) {
    const validEscalationTransition =
      (event.action === "raise_red_flag" &&
        event.escalationStateBefore === null &&
        event.escalationStateAfter === "open") ||
      (event.action === "acknowledge_escalation" &&
        event.escalationStateBefore === "open" &&
        event.escalationStateAfter === "acknowledged") ||
      (event.action === "resolve_escalation" &&
        event.escalationStateBefore === "acknowledged" &&
        event.escalationStateAfter === "resolved") ||
      (event.action === "clear_safety_hold" &&
        event.escalationStateBefore === "resolved" &&
        event.escalationStateAfter === "resolved") ||
      (suppressionWithinEscalation &&
        event.escalationStateBefore === event.escalationStateAfter &&
        (event.escalationStateBefore === "open" ||
          event.escalationStateBefore === "acknowledged"));
    if (!validEscalationTransition) {
      throw new Error("Care escalation state transition is not governed for this action.");
    }
  }
  const handoffRequired =
    event.action === "human_takeover_started" ||
    event.action === "release_human_takeover" ||
    event.fromState === "paused_for_human";
  if (handoffRequired !== (event.handoffId !== null)) {
    throw new Error("Care human-takeover lifecycle events must bind exactly one handoffId.");
  }
  const canonicalSuppressions = orderCareSuppressions(event.activeSuppressionsAfter);
  if (
    canonicalSuppressions.length !== event.activeSuppressionsAfter.length ||
    canonicalSuppressions.some(
      (reason, index) => reason !== event.activeSuppressionsAfter[index],
    )
  ) {
    throw new Error("Care event suppressions must be unique and in canonical precedence order.");
  }
  if (event.nextContactAt !== null && !isCanonicalIsoDateTime(event.nextContactAt)) {
    throw new Error("Care event nextContactAt must be a canonical ISO date-time.");
  }
  if (
    (event.toState === "completed" || event.toState === "ended") &&
    event.nextContactAt !== null
  ) {
    throw new Error("Terminal care events cannot retain nextContactAt.");
  }
  if (
    event.action === "simulate_suppression" &&
    !event.activeSuppressionsAfter.includes(event.suppressionReason!)
  ) {
    throw new Error("Suppression events must retain the applied reason in the post-action snapshot.");
  }
  if (
    event.action === "clear_clinical_hold" &&
    (event.activeSuppressionsAfter.includes("clinical_hold") ||
      event.activeSuppressionsAfter.some(isTerminalCareSuppression))
  ) {
    throw new Error("Clinical-hold clearance cannot retain a hold or terminal suppression.");
  }
  if (event.action === "clear_safety_hold" && event.activeSuppressionsAfter.length !== 0) {
    throw new Error("Safety-hold clearance requires an empty post-action suppression snapshot.");
  }
  if (event.action === "resolve_escalation") {
    const hasTerminalSuppression = event.activeSuppressionsAfter.some(isTerminalCareSuppression);
    const terminalOutcome =
      event.outcomeCode === "escalation_resolved_terminal_suppression";
    if (hasTerminalSuppression !== terminalOutcome) {
      throw new Error("Escalation resolution outcome must bind its terminal suppression snapshot.");
    }
  }

  let expectedState: CareEnrollmentState;
  let expectedOutcome: CareSafeOutcomeCode;
  if (event.action === "start") {
    expectedState = "active";
    expectedOutcome = "accepted";
  } else if (event.action === "advance_contact") {
    const completes = event.outcomeCode === "completed";
    expectedState = completes ? "completed" : "active";
    expectedOutcome = completes ? "completed" : "contact_advanced";
  } else if (event.action === "pause") {
    expectedState = "paused_by_operator";
    expectedOutcome = "accepted";
  } else if (event.action === "resume") {
    expectedState = "active";
    expectedOutcome = "accepted";
  } else if (event.action === "end") {
    expectedState = "ended";
    expectedOutcome = "ended_by_operator";
  } else if (event.action === "simulate_suppression") {
    const reason = event.suppressionReason!;
    expectedState =
      event.fromState === "escalated" || event.escalationId !== null
        ? "escalated"
        : isTerminalCareSuppression(reason)
          ? "ended"
          : "paused_for_safety";
    expectedOutcome = isTerminalCareSuppression(reason)
      ? "suppressed_terminal"
      : "clinical_hold_applied";
  } else if (event.action === "human_takeover_started") {
    expectedState = "paused_for_human";
    expectedOutcome = "human_takeover_required";
  } else if (event.action === "release_human_takeover") {
    expectedState = "paused_by_operator";
    expectedOutcome = "accepted";
  } else if (event.action === "clear_clinical_hold") {
    if (
      event.toState !== "paused_by_operator" &&
      event.toState !== "paused_for_safety"
    ) {
      throw new Error("Clinical-hold clearance must remain safe or enter operator pause.");
    }
    expectedState = event.toState;
    expectedOutcome = "safety_hold_cleared";
  } else if (event.action === "raise_red_flag") {
    expectedState = "escalated";
    expectedOutcome = "red_flag_escalated";
  } else if (event.action === "acknowledge_escalation") {
    expectedState = "escalated";
    expectedOutcome = "escalation_acknowledged";
  } else if (event.action === "resolve_escalation") {
    if (event.outcomeCode === "escalation_resolved_terminal_suppression") {
      expectedState = "ended";
      expectedOutcome = "escalation_resolved_terminal_suppression";
    } else {
      expectedState = "paused_for_safety";
      expectedOutcome = "escalation_resolved_safety_hold";
    }
  } else {
    expectedState = "paused_by_operator";
    expectedOutcome = "safety_hold_cleared";
  }
  if (event.toState !== expectedState || event.outcomeCode !== expectedOutcome) {
    throw new Error(`Care action ${event.action} has an invalid state or outcome trace.`);
  }
}

export interface StaffSafeCareEscalation extends WorkspaceScopedEntity<CareEscalationId> {
  readonly enrollmentId: CareEnrollmentId;
  readonly pathwayId: CarePathwayId;
  readonly pathwayProtocolVersion: string;
  readonly pathwayContentHash: Sha256Digest;
  readonly teamId: TeamId;
  readonly locationId: LocationId;
  readonly reasonCode: "red_flag_response" | "emergency_keyword" | "clinical_review_required";
  readonly state: "open" | "acknowledged" | "resolved";
  readonly openedAt: ISODateTime;
  readonly responseSlaMinutes: number;
  readonly responseDueAt: ISODateTime;
  readonly openedBy: GovernedActor;
  readonly acknowledgedAt: ISODateTime | null;
  readonly acknowledgedByUid: UserId | null;
  readonly resolvedAt: ISODateTime | null;
  readonly resolvedByUid: UserId | null;
  readonly resolutionCode:
    | "safety_hold_applied"
    | "terminal_suppression_applied"
    | null;
  readonly writeBackRequired: boolean;
  readonly writeBackState: "not_required" | "pending" | "unavailable_in_demo";
  readonly revision: number;
  readonly lastEventId: CareEnrollmentEventId;
  readonly schemaVersion: 1;
  readonly synthetic: true;
  readonly externalDispatchCount: 0;
  readonly networkCallCount: 0;
}

export function assertCareEnrollmentOperationalState(
  enrollment: Pick<
    StaffSafeCareEnrollment,
    | "state"
    | "nextContactIndex"
    | "nextContactAt"
    | "activeSuppressions"
    | "openEscalationId"
    | "safetyHoldEscalationId"
    | "openHandoffId"
  >,
): void {
  if (enrollment.nextContactAt !== null && !isCanonicalIsoDateTime(enrollment.nextContactAt)) {
    throw new Error("Care enrollment nextContactAt must be a canonical ISO date-time.");
  }
  if (
    !Number.isInteger(enrollment.nextContactIndex) ||
    enrollment.nextContactIndex < 0 ||
    enrollment.nextContactIndex > 32
  ) {
    throw new Error("Care nextContactIndex must be an integer from 0 to 32.");
  }
  const canonicalSuppressions = orderCareSuppressions(enrollment.activeSuppressions);
  if (
    canonicalSuppressions.length !== enrollment.activeSuppressions.length ||
    canonicalSuppressions.some((reason, index) => reason !== enrollment.activeSuppressions[index])
  ) {
    throw new Error("Active care suppressions must be unique and in canonical precedence order.");
  }
  const terminalSuppression = enrollment.activeSuppressions.some(isTerminalCareSuppression);
  const isEscalated = enrollment.state === "escalated";
  if (isEscalated !== (enrollment.openEscalationId !== null)) {
    throw new Error("Care escalation state and openEscalationId must change atomically.");
  }
  if ((enrollment.state === "paused_for_human") !== (enrollment.openHandoffId !== null)) {
    throw new Error("Care human-pause state and openHandoffId must change atomically.");
  }
  if (
    enrollment.safetyHoldEscalationId !== null &&
    enrollment.state !== "paused_for_safety" &&
    enrollment.state !== "escalated"
  ) {
    throw new Error("A resolved escalation safety pointer requires a safety-governed state.");
  }
  if (
    (enrollment.state === "completed" || enrollment.state === "ended") &&
    (enrollment.openEscalationId !== null ||
      enrollment.safetyHoldEscalationId !== null ||
      enrollment.openHandoffId !== null)
  ) {
    throw new Error("Terminal care enrollments cannot retain actionable lifecycle pointers.");
  }
  if (
    terminalSuppression &&
    enrollment.state !== "ended" &&
    !(enrollment.state === "escalated" && enrollment.openEscalationId !== null)
  ) {
    throw new Error("Terminal care suppressions must end sends while preserving an open escalation.");
  }
  if (
    enrollment.activeSuppressions.includes("clinical_hold") &&
    !["paused_for_safety", "escalated", "ended"].includes(enrollment.state)
  ) {
    throw new Error("A clinical hold requires a safety-paused, escalated, or ended enrollment.");
  }
  const isTerminalState = enrollment.state === "completed" || enrollment.state === "ended";
  if (isTerminalState === (enrollment.nextContactAt !== null)) {
    throw new Error("Only non-terminal care enrollments may retain nextContactAt.");
  }
}

export type CareEnrollmentOperationalSnapshot = Pick<
  StaffSafeCareEnrollment,
  | "id"
  | "workspaceId"
  | "pathwayId"
  | "pathwayProtocolVersion"
  | "pathwayContentHash"
  | "teamId"
  | "locationId"
  | "state"
  | "nextContactIndex"
  | "nextContactAt"
  | "activeSuppressions"
  | "openEscalationId"
  | "safetyHoldEscalationId"
  | "openHandoffId"
  | "revision"
  | "lastEventId"
  | "outcomeCode"
  | "createdAt"
  | "updatedAt"
>;

export function assertCareHandoffLifecycle(
  handoff: Pick<
    StaffSafeCareHandoff,
    | "state"
    | "openedEventId"
    | "openedBy"
    | "openedAt"
    | "releasedEventId"
    | "releasedBy"
    | "releasedAt"
    | "revision"
    | "lastEventId"
    | "createdAt"
    | "updatedAt"
  >,
): void {
  assertGovernedActor(handoff.openedBy);
  if (handoff.releasedBy !== null) assertGovernedActor(handoff.releasedBy);
  if (
    !Number.isInteger(handoff.revision) ||
    handoff.revision < 1 ||
    handoff.revision > 999_999 ||
    !isCanonicalIsoDateTime(handoff.openedAt) ||
    !isCanonicalIsoDateTime(handoff.createdAt) ||
    !isCanonicalIsoDateTime(handoff.updatedAt) ||
    (handoff.releasedAt !== null && !isCanonicalIsoDateTime(handoff.releasedAt)) ||
    handoff.createdAt !== handoff.openedAt ||
    Date.parse(handoff.updatedAt) < Date.parse(handoff.createdAt)
  ) {
    throw new Error("Care handoff lifecycle timestamps and revision must be canonical.");
  }
  const releaseNulls = [
    handoff.releasedEventId,
    handoff.releasedBy,
    handoff.releasedAt,
  ].filter((value) => value === null).length;
  if (releaseNulls !== 0 && releaseNulls !== 3) {
    throw new Error("Care handoff release event, actor and timestamp must be written together.");
  }
  if (
    (handoff.state === "open" &&
      (releaseNulls !== 3 ||
        handoff.revision !== 1 ||
        handoff.lastEventId !== handoff.openedEventId ||
        handoff.updatedAt !== handoff.openedAt)) ||
    (handoff.state === "released" &&
      (releaseNulls !== 0 ||
        handoff.revision < 2 ||
        handoff.releasedEventId !== handoff.lastEventId ||
        handoff.updatedAt !== handoff.releasedAt ||
        Date.parse(handoff.releasedAt!) < Date.parse(handoff.openedAt)))
  ) {
    throw new Error("Care handoff state must exactly bind its open or release evidence.");
  }
}

/** Validates the atomic enrollment/event escalation, handoff and suppression join. */
export function assertCareEnrollmentOperationalTransition(
  previous: CareEnrollmentOperationalSnapshot,
  next: CareEnrollmentOperationalSnapshot,
  event: StaffSafeCareEnrollmentEvent,
  approvedPathway: Pick<
    AuthoritativeCarePathway,
    | "id"
    | "workspaceId"
    | "protocolVersion"
    | "contentHash"
    | "contactPoints"
    | "approvalHash"
    | "approvalScope"
    | "lifecycleState"
  >,
  scheduleEvidence: Pick<
    CareEnrollmentSecretProjection,
    "workspaceId" | "enrollmentId" | "qualifyingDischargeAt"
  >,
  escalationTransition: {
    readonly previous: StaffSafeCareEscalation | null;
    readonly next: StaffSafeCareEscalation | null;
  } | null = null,
  handoffTransition: {
    readonly previous: StaffSafeCareHandoff | null;
    readonly next: StaffSafeCareHandoff | null;
  } | null = null,
  clinicalClearance: VerifiedClinicalClearance | null = null,
): void {
  assertCareEnrollmentOperationalState(previous);
  assertCareEnrollmentEventTrace(event);
  const requiresClinicalClearance = [
    "clear_clinical_hold",
    "acknowledge_escalation",
    "resolve_escalation",
    "clear_safety_hold",
  ].includes(event.action);
  if (requiresClinicalClearance) {
    if (clinicalClearance === null) {
      throw new Error("Clinical care transitions require server-verified authority evidence.");
    }
    assertVerifiedClinicalClearance(
      clinicalClearance,
      {
        workspaceId: event.workspaceId,
        teamId: event.teamId,
        locationId: event.locationId,
      },
      event.occurredAt,
    );
    if (
      event.actorKind !== "staff" ||
      event.actorUid !== clinicalClearance.actorUid ||
      clinicalClearance.verifiedAt !== event.occurredAt
    ) {
      throw new Error(
        "Clinical care event actor, patient scope and verification time must exactly bind authority evidence.",
      );
    }
  } else if (clinicalClearance !== null) {
    throw new Error("Non-clinical care transitions cannot attach unrelated authority evidence.");
  }
  if (
    previous.id !== next.id ||
    previous.workspaceId !== next.workspaceId ||
    previous.pathwayId !== next.pathwayId ||
    previous.pathwayProtocolVersion !== next.pathwayProtocolVersion ||
    previous.pathwayContentHash !== next.pathwayContentHash ||
    previous.teamId !== next.teamId ||
    previous.locationId !== next.locationId ||
    previous.createdAt !== next.createdAt ||
    !Number.isInteger(previous.revision) ||
    previous.revision < 1 ||
    previous.revision > 999_999 ||
    !isCanonicalIsoDateTime(previous.createdAt) ||
    !isCanonicalIsoDateTime(previous.updatedAt) ||
    !isCanonicalIsoDateTime(next.updatedAt) ||
    Date.parse(previous.updatedAt) > Date.parse(event.occurredAt) ||
    next.updatedAt !== event.occurredAt ||
    Date.parse(next.createdAt) > Date.parse(next.updatedAt) ||
    event.enrollmentId !== next.id ||
    event.workspaceId !== next.workspaceId ||
    event.pathwayId !== next.pathwayId ||
    event.pathwayProtocolVersion !== next.pathwayProtocolVersion ||
    event.pathwayContentHash !== next.pathwayContentHash ||
    event.teamId !== next.teamId ||
    event.locationId !== next.locationId ||
    event.fromState !== previous.state ||
    event.toState !== next.state ||
    next.revision !== previous.revision + 1 ||
    event.revision !== next.revision ||
    next.lastEventId !== event.id ||
    next.outcomeCode !== event.outcomeCode
  ) {
    throw new Error("Care enrollment transition must exactly cross-bind its immutable event revision.");
  }
  if (
    approvedPathway.lifecycleState !== "approved" ||
    approvedPathway.approvalHash === null ||
    approvedPathway.approvalScope !== "clinical_simulation_only" ||
    approvedPathway.id !== previous.pathwayId ||
    approvedPathway.workspaceId !== previous.workspaceId ||
    approvedPathway.protocolVersion !== previous.pathwayProtocolVersion ||
    approvedPathway.contentHash !== previous.pathwayContentHash ||
    scheduleEvidence.workspaceId !== previous.workspaceId ||
    scheduleEvidence.enrollmentId !== previous.id ||
    !isCanonicalIsoDateTime(scheduleEvidence.qualifyingDischargeAt) ||
    approvedPathway.contactPoints.length < 1 ||
    approvedPathway.contactPoints.length > 32 ||
    approvedPathway.contactPoints.some(
      (point, index) =>
        !Number.isInteger(point.dayOffset) ||
        point.dayOffset < 1 ||
        point.dayOffset > 365 ||
        (index > 0 && approvedPathway.contactPoints[index - 1]!.dayOffset >= point.dayOffset),
    )
  ) {
    throw new Error(
      "Care enrollment transition must bind an approved pathway and canonical qualifying-discharge schedule.",
    );
  }

  const scheduledContactAt = (index: number): ISODateTime | null => {
    const point = approvedPathway.contactPoints[index];
    if (!point) return null;
    return new Date(
      Date.parse(scheduleEvidence.qualifyingDischargeAt) + point.dayOffset * 86_400_000,
    ).toISOString() as ISODateTime;
  };
  const previousScheduledAt = scheduledContactAt(previous.nextContactIndex);
  if (previousScheduledAt === null || previous.nextContactAt !== previousScheduledAt) {
    throw new Error(
      "Care enrollment must retain the exact next contact due from its approved discharge schedule.",
    );
  }

  const expectedSuppressions =
    event.action === "simulate_suppression"
      ? orderCareSuppressions([
          ...previous.activeSuppressions,
          event.suppressionReason!,
        ])
      : event.action === "clear_clinical_hold"
        ? orderCareSuppressions(
            previous.activeSuppressions.filter((reason) => reason !== "clinical_hold"),
          )
        : orderCareSuppressions(previous.activeSuppressions);
  if (
    event.action === "clear_clinical_hold" &&
    !previous.activeSuppressions.includes("clinical_hold")
  ) {
    throw new Error("Clinical-hold clearance requires an active clinical_hold suppression.");
  }
  if (
    event.action === "clear_clinical_hold" &&
    next.state !==
      (previous.safetyHoldEscalationId === null
        ? "paused_by_operator"
        : "paused_for_safety")
  ) {
    throw new Error(
      "Clinical-hold clearance must remain safety-paused exactly while an escalation safety pointer remains.",
    );
  }
  if (
    event.activeSuppressionsAfter.length !== expectedSuppressions.length ||
    event.activeSuppressionsAfter.some(
      (reason, index) => reason !== expectedSuppressions[index],
    ) ||
    next.activeSuppressions.length !== expectedSuppressions.length ||
    next.activeSuppressions.some((reason, index) => reason !== expectedSuppressions[index])
  ) {
    throw new Error("Care transition cannot drop or rewrite the canonical suppression snapshot.");
  }

  if (event.action === "advance_contact") {
    const finalContact =
      previous.nextContactIndex === approvedPathway.contactPoints.length - 1;
    if (
      event.contactPointIndex !== previous.nextContactIndex ||
      next.nextContactIndex !== previous.nextContactIndex + 1 ||
      Date.parse(event.occurredAt) < Date.parse(previous.nextContactAt) ||
      (finalContact &&
        (next.state !== "completed" || event.outcomeCode !== "completed")) ||
      (!finalContact &&
        (next.state !== "active" || event.outcomeCode !== "contact_advanced"))
    ) {
      throw new Error(
        "Care contact advancement must consume one due approved contact and honor pathway finality.",
      );
    }
  } else if (next.nextContactIndex !== previous.nextContactIndex) {
    throw new Error("Non-contact care actions must preserve nextContactIndex.");
  }
  const terminalNext = next.state === "completed" || next.state === "ended";
  const expectedNextContactAt = terminalNext
    ? null
    : event.action === "advance_contact"
      ? scheduledContactAt(next.nextContactIndex)
      : previous.nextContactAt;
  if (
    (!terminalNext && expectedNextContactAt === null) ||
    event.nextContactAt !== next.nextContactAt ||
    next.nextContactAt !== expectedNextContactAt
  ) {
    throw new Error(
      "Care transition nextContactAt must match the exact approved discharge schedule and terminal state.",
    );
  }

  if (event.action === "raise_red_flag") {
    if (
      previous.openEscalationId !== null ||
      event.escalationId === previous.safetyHoldEscalationId ||
      next.openEscalationId !== event.escalationId
    ) {
      throw new Error("Red-flag escalation must atomically set the event escalation pointer.");
    }
  } else if (
    event.action === "acknowledge_escalation" ||
    (event.action === "simulate_suppression" && previous.state === "escalated")
  ) {
    if (
      previous.openEscalationId === null ||
      event.escalationId !== previous.openEscalationId ||
      next.openEscalationId !== previous.openEscalationId
    ) {
      throw new Error("Open escalation updates must preserve the exact escalation pointer.");
    }
  } else if (event.action === "resolve_escalation") {
    if (
      previous.openEscalationId === null ||
      event.escalationId !== previous.openEscalationId ||
      next.openEscalationId !== null
    ) {
      throw new Error("Escalation resolution must atomically clear the exact open escalation.");
    }
  } else if (event.action === "clear_safety_hold") {
    if (previous.openEscalationId !== null || next.openEscalationId !== null) {
      throw new Error("Safety-hold clearance can only reference an already-resolved escalation.");
    }
  } else if (next.openEscalationId !== previous.openEscalationId) {
    throw new Error("This care action cannot mutate the escalation pointer.");
  }

  if (event.action === "resolve_escalation") {
    const expectedSafetyPointer =
      event.outcomeCode === "escalation_resolved_safety_hold"
        ? event.escalationId
        : null;
    if (next.safetyHoldEscalationId !== expectedSafetyPointer) {
      throw new Error("Escalation resolution must set exactly its governed safety pointer.");
    }
  } else if (event.action === "clear_safety_hold") {
    if (
      previous.safetyHoldEscalationId === null ||
      event.escalationId !== previous.safetyHoldEscalationId ||
      next.safetyHoldEscalationId !== null
    ) {
      throw new Error("Safety-hold clearance must match and clear the retained escalation pointer.");
    }
  } else if (terminalNext) {
    if (next.safetyHoldEscalationId !== null) {
      throw new Error("Terminal care transitions must clear the resolved-escalation safety pointer.");
    }
  } else if (next.safetyHoldEscalationId !== previous.safetyHoldEscalationId) {
    throw new Error("This care action cannot mutate the resolved-escalation safety pointer.");
  }

  if (event.action === "human_takeover_started") {
    if (previous.openHandoffId !== null || next.openHandoffId !== event.handoffId) {
      throw new Error("Human takeover must atomically set the event handoff pointer.");
    }
  } else if (previous.state === "paused_for_human") {
    if (
      previous.openHandoffId === null ||
      event.handoffId !== previous.openHandoffId ||
      next.openHandoffId !== null
    ) {
      throw new Error("Leaving human pause must atomically clear the exact handoff pointer.");
    }
  } else if (next.openHandoffId !== previous.openHandoffId || event.handoffId !== null) {
    throw new Error("This care action cannot mutate the handoff pointer.");
  }
  if (event.handoffId === null) {
    if (handoffTransition !== null) {
      throw new Error("A care event without handoffId cannot mutate a handoff document.");
    }
  } else {
    if (handoffTransition === null || handoffTransition.next === null) {
      throw new Error("Care handoff events require previous/next handoff document evidence.");
    }
    const priorHandoff = handoffTransition.previous;
    const nextHandoff = handoffTransition.next;
    const createsHandoff = event.action === "human_takeover_started";
    if (createsHandoff !== (priorHandoff === null)) {
      throw new Error("Human takeover must create one handoff; later exit must release it.");
    }
    if (
      nextHandoff.id !== event.handoffId ||
      nextHandoff.workspaceId !== event.workspaceId ||
      nextHandoff.enrollmentId !== event.enrollmentId ||
      nextHandoff.pathwayId !== event.pathwayId ||
      nextHandoff.pathwayProtocolVersion !== event.pathwayProtocolVersion ||
      nextHandoff.pathwayContentHash !== event.pathwayContentHash ||
      nextHandoff.teamId !== event.teamId ||
      nextHandoff.locationId !== event.locationId ||
      nextHandoff.lastEventId !== event.id ||
      nextHandoff.updatedAt !== event.occurredAt
    ) {
      throw new Error("Care handoff must exactly cross-bind the enrollment event aggregate.");
    }
    if (priorHandoff === null) {
      if (
        !createsHandoff ||
        nextHandoff.state !== "open" ||
        nextHandoff.openedEventId !== event.id ||
        nextHandoff.openedBy.actorKind !== event.actorKind ||
        nextHandoff.openedBy.actorUid !== event.actorUid ||
        nextHandoff.openedAt !== event.occurredAt ||
        nextHandoff.releasedEventId !== null ||
        nextHandoff.releasedBy !== null ||
        nextHandoff.releasedAt !== null ||
        nextHandoff.revision !== 1 ||
        nextHandoff.createdAt !== event.occurredAt
      ) {
        throw new Error("Care takeover must atomically create one open handoff with actor evidence.");
      }
    } else {
      assertCareHandoffLifecycle(priorHandoff);
      if (
        priorHandoff.id !== nextHandoff.id ||
        priorHandoff.workspaceId !== nextHandoff.workspaceId ||
        priorHandoff.enrollmentId !== nextHandoff.enrollmentId ||
        priorHandoff.pathwayId !== nextHandoff.pathwayId ||
        priorHandoff.pathwayProtocolVersion !== nextHandoff.pathwayProtocolVersion ||
        priorHandoff.pathwayContentHash !== nextHandoff.pathwayContentHash ||
        priorHandoff.teamId !== nextHandoff.teamId ||
        priorHandoff.locationId !== nextHandoff.locationId ||
        priorHandoff.openedEventId !== nextHandoff.openedEventId ||
        priorHandoff.openedBy.actorKind !== nextHandoff.openedBy.actorKind ||
        priorHandoff.openedBy.actorUid !== nextHandoff.openedBy.actorUid ||
        priorHandoff.openedAt !== nextHandoff.openedAt ||
        priorHandoff.createdAt !== nextHandoff.createdAt ||
        priorHandoff.state !== "open" ||
        priorHandoff.releasedEventId !== null ||
        priorHandoff.releasedBy !== null ||
        priorHandoff.releasedAt !== null ||
        nextHandoff.state !== "released" ||
        nextHandoff.releasedEventId !== event.id ||
        nextHandoff.releasedBy?.actorKind !== event.actorKind ||
        nextHandoff.releasedBy?.actorUid !== event.actorUid ||
        nextHandoff.releasedAt !== event.occurredAt ||
        nextHandoff.revision !== priorHandoff.revision + 1 ||
        Date.parse(priorHandoff.updatedAt) > Date.parse(event.occurredAt)
      ) {
        throw new Error(
          "Care handoff release must preserve its opening evidence and bind the exit event actor.",
        );
      }
    }
    assertCareHandoffLifecycle(nextHandoff);
  }
  if (event.escalationId === null) {
    if (escalationTransition !== null) {
      throw new Error("A care event without escalationId cannot mutate an escalation document.");
    }
  } else {
    if (escalationTransition === null || escalationTransition.next === null) {
      throw new Error("Escalation events require previous/next escalation document evidence.");
    }
    const priorEscalation = escalationTransition.previous;
    const nextEscalation = escalationTransition.next;
    if ((event.action === "raise_red_flag") !== (priorEscalation === null)) {
      throw new Error("Red-flag escalation must create a new document; later actions must update it.");
    }
    if (
      nextEscalation.id !== event.escalationId ||
      nextEscalation.workspaceId !== event.workspaceId ||
      nextEscalation.enrollmentId !== event.enrollmentId ||
      nextEscalation.pathwayId !== event.pathwayId ||
      nextEscalation.pathwayProtocolVersion !== event.pathwayProtocolVersion ||
      nextEscalation.pathwayContentHash !== event.pathwayContentHash ||
      nextEscalation.teamId !== event.teamId ||
      nextEscalation.locationId !== event.locationId ||
      nextEscalation.lastEventId !== event.id ||
      nextEscalation.updatedAt !== event.occurredAt ||
      nextEscalation.state !== event.escalationStateAfter
    ) {
      throw new Error("Care escalation must exactly cross-bind the enrollment event aggregate.");
    }
    if (priorEscalation === null) {
      if (
        event.action !== "raise_red_flag" ||
        nextEscalation.state !== "open" ||
        nextEscalation.openedAt !== event.occurredAt ||
        nextEscalation.openedBy.actorKind !== event.actorKind ||
        nextEscalation.openedBy.actorUid !== event.actorUid ||
        nextEscalation.createdAt !== event.occurredAt ||
        nextEscalation.revision !== 1 ||
        nextEscalation.writeBackState !==
          (nextEscalation.writeBackRequired ? "pending" : "not_required")
      ) {
        throw new Error("Red flag must atomically create one open escalation with actor evidence.");
      }
    } else {
      assertCareEscalationLifecycle(priorEscalation);
      if (
        priorEscalation.id !== nextEscalation.id ||
        priorEscalation.workspaceId !== nextEscalation.workspaceId ||
        priorEscalation.enrollmentId !== nextEscalation.enrollmentId ||
        priorEscalation.pathwayId !== nextEscalation.pathwayId ||
        priorEscalation.pathwayProtocolVersion !== nextEscalation.pathwayProtocolVersion ||
        priorEscalation.pathwayContentHash !== nextEscalation.pathwayContentHash ||
        priorEscalation.teamId !== nextEscalation.teamId ||
        priorEscalation.locationId !== nextEscalation.locationId ||
        priorEscalation.reasonCode !== nextEscalation.reasonCode ||
        priorEscalation.createdAt !== nextEscalation.createdAt ||
        !isCanonicalIsoDateTime(priorEscalation.createdAt) ||
        !isCanonicalIsoDateTime(priorEscalation.updatedAt) ||
        !isCanonicalIsoDateTime(nextEscalation.createdAt) ||
        Date.parse(priorEscalation.updatedAt) > Date.parse(event.occurredAt) ||
        Date.parse(nextEscalation.createdAt) > Date.parse(nextEscalation.updatedAt) ||
        priorEscalation.openedAt !== nextEscalation.openedAt ||
        priorEscalation.responseSlaMinutes !== nextEscalation.responseSlaMinutes ||
        priorEscalation.responseDueAt !== nextEscalation.responseDueAt ||
        priorEscalation.openedBy.actorKind !== nextEscalation.openedBy.actorKind ||
        priorEscalation.openedBy.actorUid !== nextEscalation.openedBy.actorUid ||
        priorEscalation.writeBackRequired !== nextEscalation.writeBackRequired ||
        nextEscalation.revision !== priorEscalation.revision + 1 ||
        priorEscalation.state !== event.escalationStateBefore
      ) {
        throw new Error("Care escalation update must preserve identity and increment revision.");
      }
      if (event.action === "acknowledge_escalation") {
        if (
          event.actorKind !== "staff" ||
          priorEscalation.state !== "open" ||
          nextEscalation.state !== "acknowledged" ||
          nextEscalation.acknowledgedAt !== event.occurredAt ||
          nextEscalation.acknowledgedByUid !== event.actorUid ||
          nextEscalation.writeBackState !==
            (nextEscalation.writeBackRequired ? "pending" : "not_required") ||
          nextEscalation.resolvedAt !== null ||
          nextEscalation.resolvedByUid !== null ||
          nextEscalation.resolutionCode !== null
        ) {
          throw new Error("Escalation acknowledgement must bind the open escalation and staff actor.");
        }
      } else if (event.action === "resolve_escalation") {
        if (
          event.actorKind !== "staff" ||
          priorEscalation.state !== "acknowledged" ||
          nextEscalation.state !== "resolved" ||
          nextEscalation.acknowledgedAt !== priorEscalation.acknowledgedAt ||
          nextEscalation.acknowledgedByUid !== priorEscalation.acknowledgedByUid ||
          nextEscalation.resolvedAt !== event.occurredAt ||
          nextEscalation.resolvedByUid !== event.actorUid ||
          nextEscalation.resolutionCode !==
            (event.outcomeCode === "escalation_resolved_terminal_suppression"
              ? "terminal_suppression_applied"
              : "safety_hold_applied") ||
          nextEscalation.writeBackState !==
            (nextEscalation.writeBackRequired
              ? "unavailable_in_demo"
              : "not_required")
        ) {
          throw new Error("Escalation resolution requires an actually acknowledged escalation.");
        }
      } else if (
        nextEscalation.state !== priorEscalation.state ||
        nextEscalation.acknowledgedAt !== priorEscalation.acknowledgedAt ||
        nextEscalation.acknowledgedByUid !== priorEscalation.acknowledgedByUid ||
        nextEscalation.resolvedAt !== priorEscalation.resolvedAt ||
        nextEscalation.resolvedByUid !== priorEscalation.resolvedByUid ||
        nextEscalation.resolutionCode !== priorEscalation.resolutionCode ||
        nextEscalation.writeBackState !== priorEscalation.writeBackState
      ) {
        throw new Error("Escalation trace updates cannot fabricate lifecycle evidence.");
      }
    }
    assertCareEscalationLifecycle(nextEscalation);
  }
  assertCareEnrollmentOperationalState(next);
}

export function assertCareEscalationLifecycle(
  escalation: Pick<
    StaffSafeCareEscalation,
    | "state"
    | "openedAt"
    | "responseSlaMinutes"
    | "responseDueAt"
    | "openedBy"
    | "acknowledgedAt"
    | "acknowledgedByUid"
    | "resolvedAt"
    | "resolvedByUid"
    | "resolutionCode"
    | "writeBackRequired"
    | "writeBackState"
  >,
): void {
  assertGovernedActor(escalation.openedBy);
  if (
    !isCanonicalIsoDateTime(escalation.openedAt) ||
    !isCanonicalIsoDateTime(escalation.responseDueAt) ||
    (escalation.acknowledgedAt !== null &&
      !isCanonicalIsoDateTime(escalation.acknowledgedAt)) ||
    (escalation.resolvedAt !== null && !isCanonicalIsoDateTime(escalation.resolvedAt))
  ) {
    throw new Error("Care escalation timestamps must be canonical ISO date-times.");
  }
  if (
    !Number.isInteger(escalation.responseSlaMinutes) ||
    escalation.responseSlaMinutes < 1 ||
    escalation.responseSlaMinutes > 1_440 ||
    Date.parse(escalation.responseDueAt) - Date.parse(escalation.openedAt) !==
      escalation.responseSlaMinutes * 60_000
  ) {
    throw new Error("Care escalation responseDueAt must exactly match its frozen SLA.");
  }
  const hasAcknowledgement =
    escalation.acknowledgedAt !== null && escalation.acknowledgedByUid !== null;
  const hasResolution =
    escalation.resolvedAt !== null &&
    escalation.resolvedByUid !== null &&
    escalation.resolutionCode !== null;
  if ((escalation.acknowledgedAt === null) !== (escalation.acknowledgedByUid === null)) {
    throw new Error("Escalation acknowledgement actor and timestamp must be written together.");
  }
  const resolutionNulls = [
    escalation.resolvedAt,
    escalation.resolvedByUid,
    escalation.resolutionCode,
  ].filter((value) => value === null).length;
  if (resolutionNulls !== 0 && resolutionNulls !== 3) {
    throw new Error("Escalation resolution actor, timestamp and code must be written together.");
  }
  if (escalation.state === "open" && (hasAcknowledgement || hasResolution)) {
    throw new Error("Open care escalations cannot contain later lifecycle evidence.");
  }
  if (escalation.state === "acknowledged" && (!hasAcknowledgement || hasResolution)) {
    throw new Error("Acknowledged care escalations require only acknowledgement evidence.");
  }
  if (escalation.state === "resolved" && (!hasAcknowledgement || !hasResolution)) {
    throw new Error("Resolved care escalations require acknowledgement and resolution evidence.");
  }
  if (
    (escalation.acknowledgedAt !== null &&
      Date.parse(escalation.acknowledgedAt) < Date.parse(escalation.openedAt)) ||
    (escalation.resolvedAt !== null &&
      escalation.acknowledgedAt !== null &&
      Date.parse(escalation.resolvedAt) < Date.parse(escalation.acknowledgedAt))
  ) {
    throw new Error("Care escalation lifecycle timestamps must be monotonic.");
  }
  if (
    (escalation.writeBackRequired && escalation.writeBackState === "not_required") ||
    (!escalation.writeBackRequired && escalation.writeBackState !== "not_required")
  ) {
    throw new Error("Care escalation write-back state must match the pathway requirement.");
  }
  if (
    escalation.writeBackState !== "not_required" &&
    escalation.writeBackState !== "pending" &&
    escalation.writeBackState !== "unavailable_in_demo"
  ) {
    throw new Error("Synthetic care escalations cannot claim an external write-back occurred.");
  }
}

export interface CareEnrollmentSecretProjection {
  readonly workspaceId: AuthoritativeCarePathway["workspaceId"];
  readonly enrollmentId: CareEnrollmentId;
  readonly protectedContactRef: EncryptedValueRef;
  readonly protectedConversationRef: EncryptedValueRef;
  readonly protectedQualifyingDischargeRef: EncryptedValueRef;
  /** Backend-only immutable schedule anchor from the qualifying discharge evidence. */
  readonly qualifyingDischargeAt: ISODateTime;
  readonly subjectFingerprint: HmacDigest;
  /** Same source SHA bound into the receipt key/payload; never a raw discharge ID. */
  readonly sourceDischargeFingerprint: Sha256Digest;
  readonly receiptId: CareEnrollmentReceiptId;
  readonly receiptFingerprint: HmacDigest;
  readonly schemaVersion: 1;
  readonly synthetic: true;
}

export interface CareEnrollmentReceiptSecretProjection {
  readonly id: CareEnrollmentReceiptId;
  readonly workspaceId: AuthoritativeCarePathway["workspaceId"];
  readonly family: CarePathwayFamily;
  readonly pathwayId: CarePathwayId;
  readonly pathwayProtocolVersion: string;
  readonly pathwayContentHash: Sha256Digest;
  readonly pathwayApprovalHash: Sha256Digest;
  readonly activationEventId: CarePathwayEventId;
  /** Non-reversible digest of the qualifying discharge event. */
  readonly dischargeFingerprint: Sha256Digest;
  /** Immutable backend-only discharge time bound into the canonical receipt payload. */
  readonly qualifyingDischargeAt: ISODateTime;
  /** HMAC over the stable v2 workspace/post-discharge-family/discharge tuple. */
  readonly receiptFingerprint: HmacDigest;
  readonly enrollmentId: CareEnrollmentId;
  readonly createdAt: ISODateTime;
  readonly schemaVersion: 1;
  readonly synthetic: true;
}

export function assertCareEnrollmentReceiptIdentity(
  receipt: Pick<CareEnrollmentReceiptSecretProjection, "id" | "receiptFingerprint">,
  expectedFingerprint: HmacDigest,
): void {
  if (String(receipt.id) !== String(expectedFingerprint) || receipt.receiptFingerprint !== expectedFingerprint) {
    throw new Error("Care enrollment receipt id must equal its canonical HMAC fingerprint.");
  }
}

export function assertCareEnrollmentSecretReceiptLink(
  secret: Pick<
    CareEnrollmentSecretProjection,
    | "workspaceId"
    | "enrollmentId"
    | "qualifyingDischargeAt"
    | "sourceDischargeFingerprint"
    | "receiptId"
    | "receiptFingerprint"
  >,
  receipt: Pick<
    CareEnrollmentReceiptSecretProjection,
    | "id"
    | "workspaceId"
    | "enrollmentId"
    | "dischargeFingerprint"
    | "qualifyingDischargeAt"
    | "receiptFingerprint"
    | "createdAt"
  >,
): void {
  assertCareEnrollmentReceiptIdentity(
    { id: secret.receiptId, receiptFingerprint: secret.receiptFingerprint },
    secret.receiptFingerprint,
  );
  assertCareEnrollmentReceiptIdentity(receipt, receipt.receiptFingerprint);
  if (
    secret.workspaceId !== receipt.workspaceId ||
    secret.enrollmentId !== receipt.enrollmentId ||
    !isCanonicalIsoDateTime(secret.qualifyingDischargeAt) ||
    secret.qualifyingDischargeAt !== receipt.qualifyingDischargeAt ||
    !isCanonicalIsoDateTime(receipt.createdAt) ||
    Date.parse(secret.qualifyingDischargeAt) > Date.parse(receipt.createdAt) ||
    secret.sourceDischargeFingerprint !== receipt.dischargeFingerprint ||
    String(secret.receiptId) !== String(receipt.id) ||
    secret.receiptFingerprint !== receipt.receiptFingerprint
  ) {
    throw new Error("Care enrollment secret must exactly cross-bind its immutable receipt.");
  }
}

export function assertCareEnrollmentReceiptAggregateBinding(
  receipt: Pick<
    CareEnrollmentReceiptSecretProjection,
    | "workspaceId"
    | "enrollmentId"
    | "pathwayId"
    | "pathwayProtocolVersion"
    | "pathwayContentHash"
  >,
  enrollment: Pick<
    StaffSafeCareEnrollment,
    | "workspaceId"
    | "id"
    | "pathwayId"
    | "pathwayProtocolVersion"
    | "pathwayContentHash"
  >,
): void {
  if (
    receipt.workspaceId !== enrollment.workspaceId ||
    receipt.enrollmentId !== enrollment.id ||
    receipt.pathwayId !== enrollment.pathwayId ||
    receipt.pathwayProtocolVersion !== enrollment.pathwayProtocolVersion ||
    receipt.pathwayContentHash !== enrollment.pathwayContentHash
  ) {
    throw new Error("Care enrollment receipt must exactly bind its staff-safe enrollment aggregate.");
  }
}

/**
 * Proves that one immutable care receipt was created only after the exact
 * pathway activation, never before its qualifying discharge, and in the same
 * transaction as its staff-safe enrollment aggregate.
 */
export function assertCareEnrollmentReceiptChronology(
  activation: Pick<
    StaffSafeCarePathwayActivation,
    | "workspaceId"
    | "family"
    | "activePathwayId"
    | "activeProtocolVersion"
    | "activePathwayContentHash"
    | "activePathwayApprovalHash"
    | "activationEventId"
    | "activatedAt"
  >,
  receipt: Pick<
    CareEnrollmentReceiptSecretProjection,
    | "workspaceId"
    | "family"
    | "pathwayId"
    | "pathwayProtocolVersion"
    | "pathwayContentHash"
    | "pathwayApprovalHash"
    | "activationEventId"
    | "enrollmentId"
    | "qualifyingDischargeAt"
    | "createdAt"
  >,
  enrollment: Pick<StaffSafeCareEnrollment, "workspaceId" | "id" | "createdAt">,
): void {
  if (
    !isCanonicalIsoDateTime(activation.activatedAt) ||
    !isCanonicalIsoDateTime(receipt.qualifyingDischargeAt) ||
    !isCanonicalIsoDateTime(receipt.createdAt) ||
    !isCanonicalIsoDateTime(enrollment.createdAt) ||
    activation.workspaceId !== receipt.workspaceId ||
    activation.family !== receipt.family ||
    activation.activePathwayId !== receipt.pathwayId ||
    activation.activeProtocolVersion !== receipt.pathwayProtocolVersion ||
    activation.activePathwayContentHash !== receipt.pathwayContentHash ||
    activation.activePathwayApprovalHash !== receipt.pathwayApprovalHash ||
    activation.activationEventId !== receipt.activationEventId ||
    receipt.workspaceId !== enrollment.workspaceId ||
    receipt.enrollmentId !== enrollment.id ||
    Date.parse(activation.activatedAt) > Date.parse(receipt.createdAt) ||
    Date.parse(receipt.qualifyingDischargeAt) > Date.parse(receipt.createdAt) ||
    receipt.createdAt !== enrollment.createdAt
  ) {
    throw new Error(
      "Care enrollment receipt chronology must bind the exact prior activation, discharge anchor, and same-createdAt enrollment aggregate.",
    );
  }
}

export interface CarePathwaySecretProjection {
  readonly workspaceId: AuthoritativeCarePathway["workspaceId"];
  readonly pathwayId: CarePathwayId;
  readonly protectedInstructionsRef: EncryptedValueRef;
  readonly protectedContentFingerprint: Sha256Digest;
  readonly schemaVersion: 1;
  readonly synthetic: true;
}

export interface CareEnrollmentEventSecretProjection {
  readonly workspaceId: AuthoritativeCarePathway["workspaceId"];
  readonly enrollmentId: CareEnrollmentId;
  readonly eventId: CareEnrollmentEventId;
  readonly protectedContextRef: EncryptedValueRef;
  readonly contextFingerprint: Sha256Digest;
  readonly schemaVersion: 1;
  readonly synthetic: true;
}

export interface CareEscalationSecretProjection {
  readonly workspaceId: AuthoritativeCarePathway["workspaceId"];
  readonly enrollmentId: CareEnrollmentId;
  readonly escalationId: CareEscalationId;
  readonly protectedContextRef: EncryptedValueRef;
  readonly contextFingerprint: Sha256Digest;
  readonly schemaVersion: 1;
  readonly synthetic: true;
}

const AUTOMATION_ACTIONS_BY_STATE: Readonly<
  Record<AutomationExecutionState, readonly AutomationRunAction[]>
> = {
  queued: ["start", "pause", "end"],
  running: ["advance_step", "pause", "simulate_human_takeover", "exercise_fallback", "inject_failure", "end"],
  waiting: ["advance_step", "pause", "simulate_human_takeover", "exercise_fallback", "inject_failure", "end"],
  paused_by_operator: ["resume", "simulate_human_takeover", "end"],
  paused_for_human: ["release_human_takeover", "end"],
  completed: [],
  ended: [],
  failed: ["exercise_fallback", "retry", "end"],
};

export function canApplyAutomationRunAction(
  state: AutomationExecutionState,
  action: AutomationRunAction,
  context?: { readonly pausedFromState: AutomationPausedFromState | null },
): boolean {
  if (state === "paused_by_operator" && action === "simulate_human_takeover") {
    return context?.pausedFromState != null && context.pausedFromState !== "queued";
  }
  return AUTOMATION_ACTIONS_BY_STATE[state].includes(action);
}

export interface AutomationRunSchedulingSnapshot {
  readonly state: AutomationExecutionState;
  readonly pausedFromState: AutomationPausedFromState | null;
  readonly nextEligibleAt: ISODateTime | null;
}

export interface AutomationRunOperationalSnapshot extends AutomationRunSchedulingSnapshot {
  readonly id: AutomationRunId;
  readonly workspaceId: AuthoritativeAutomationDefinition["workspaceId"];
  readonly definitionId: AutomationDefinitionId;
  readonly definitionVersion: number;
  readonly definitionContentHash: Sha256Digest;
  readonly teamId: TeamId;
  readonly locationId: LocationId;
  readonly currentStepIndex: number;
  readonly completedStepCount: number;
  readonly attemptCount: number;
  readonly outcomeCode: AutomationSafeOutcomeCode;
  readonly revision: number;
  readonly openWorkItemId: AutomationWorkItemId | null;
  readonly lastEventId: AutomationRunEventId | null;
  readonly createdAt: ISODateTime;
  readonly updatedAt: ISODateTime;
}

/**
 * Fails closed when a persisted run cannot safely preserve a wait across a
 * pause. Functions must validate this invariant before every run write.
 */
export function assertAutomationRunSchedulingState(
  snapshot: AutomationRunSchedulingSnapshot,
): void {
  if (snapshot.nextEligibleAt !== null && !isCanonicalIsoDateTime(snapshot.nextEligibleAt)) {
    throw new Error("Automation nextEligibleAt must be a canonical ISO date-time.");
  }
  const isPaused =
    snapshot.state === "paused_by_operator" || snapshot.state === "paused_for_human";
  if (snapshot.state === "waiting") {
    if (snapshot.pausedFromState !== null || snapshot.nextEligibleAt === null) {
      throw new Error("A waiting automation run requires nextEligibleAt and no pausedFromState.");
    }
    return;
  }
  if (isPaused) {
    if (snapshot.pausedFromState === null) {
      throw new Error("A paused automation run must retain pausedFromState.");
    }
    if (snapshot.state === "paused_for_human" && snapshot.pausedFromState === "queued") {
      throw new Error("Human takeover cannot originate from a queued automation run.");
    }
    const pausedWait = snapshot.pausedFromState === "waiting";
    if (pausedWait !== (snapshot.nextEligibleAt !== null)) {
      throw new Error("A paused waiting run must preserve exactly one nextEligibleAt value.");
    }
    return;
  }
  if (snapshot.pausedFromState !== null || snapshot.nextEligibleAt !== null) {
    throw new Error("Runnable and terminal automation states cannot retain pause scheduling fields.");
  }
}

export function assertAutomationRunOperationalState(
  run: AutomationRunOperationalSnapshot,
): void {
  assertAutomationRunSchedulingState(run);
  if (
    !Number.isInteger(run.revision) ||
    run.revision < 1 ||
    run.revision > 1_000_000 ||
    !isCanonicalIsoDateTime(run.createdAt) ||
    !isCanonicalIsoDateTime(run.updatedAt) ||
    Date.parse(run.createdAt) > Date.parse(run.updatedAt)
  ) {
    throw new Error("Automation run revision and timestamps must be canonical and monotonic.");
  }
  if (
    !Number.isInteger(run.currentStepIndex) ||
    run.currentStepIndex < 0 ||
    run.currentStepIndex > 32 ||
    !Number.isInteger(run.completedStepCount) ||
    run.completedStepCount < 0 ||
    run.completedStepCount > run.currentStepIndex ||
    !Number.isInteger(run.attemptCount) ||
    run.attemptCount < 0 ||
    run.attemptCount > 11
  ) {
    throw new Error("Automation run step progress and attempt counters are invalid.");
  }
  const requiresOpenWorkItem =
    run.state === "failed" ||
    run.state === "paused_for_human" ||
    (run.state === "paused_by_operator" && run.pausedFromState === "failed");
  const mayRetainOpenWorkItem = requiresOpenWorkItem || run.state === "paused_by_operator";
  if (
    (run.state === "failed" ||
      run.state === "waiting" ||
      ((run.state === "paused_by_operator" || run.state === "paused_for_human") &&
        run.pausedFromState === "waiting")) &&
    run.attemptCount < 1
  ) {
    throw new Error("Failed and waiting automation runs require persisted attempt evidence.");
  }
  if (requiresOpenWorkItem !== (run.openWorkItemId !== null) && requiresOpenWorkItem) {
    throw new Error("Failed and human-paused automation runs require one openWorkItemId.");
  }
  if (!mayRetainOpenWorkItem && run.openWorkItemId !== null) {
    throw new Error("Runnable and terminal automation runs cannot retain an open work item.");
  }
}

/** Validates the atomic run/event/work-item pointer join for one revision. */
export function assertAutomationRunOperationalTransition(
  previous: AutomationRunOperationalSnapshot,
  next: AutomationRunOperationalSnapshot,
  event: StaffSafeAutomationRunEvent,
  approvedDefinition: Pick<
    AuthoritativeAutomationDefinition,
    "id" | "version" | "contentHash" | "steps"
  >,
  workItemTransition: {
    readonly previous: StaffSafeAutomationWorkItem | null;
    readonly next: StaffSafeAutomationWorkItem | null;
  } | null = null,
): void {
  assertAutomationRunOperationalState(previous);
  assertAutomationRunEventTrace(event);
  if (
    previous.id !== next.id ||
    previous.workspaceId !== next.workspaceId ||
    previous.definitionId !== next.definitionId ||
    previous.definitionVersion !== next.definitionVersion ||
    previous.definitionContentHash !== next.definitionContentHash ||
    previous.teamId !== next.teamId ||
    previous.locationId !== next.locationId ||
    previous.createdAt !== next.createdAt ||
    Date.parse(previous.updatedAt) > Date.parse(event.occurredAt) ||
    next.updatedAt !== event.occurredAt ||
    Date.parse(next.createdAt) > Date.parse(next.updatedAt) ||
    event.runId !== next.id ||
    event.workspaceId !== next.workspaceId ||
    event.definitionId !== next.definitionId ||
    event.definitionVersion !== next.definitionVersion ||
    event.definitionContentHash !== next.definitionContentHash ||
    event.teamId !== next.teamId ||
    event.locationId !== next.locationId ||
    event.fromState !== previous.state ||
    event.toState !== next.state ||
    next.revision !== previous.revision + 1 ||
    event.revision !== next.revision ||
    event.nextEligibleAt !== next.nextEligibleAt ||
    next.lastEventId !== event.id ||
    next.outcomeCode !== event.outcomeCode ||
    approvedDefinition.id !== next.definitionId ||
    approvedDefinition.version !== next.definitionVersion ||
    approvedDefinition.contentHash !== next.definitionContentHash
  ) {
    throw new Error("Automation run transition must exactly cross-bind its immutable event revision.");
  }

  const stepScoped = ["advance_step", "exercise_fallback", "inject_failure", "retry"].includes(
    event.action,
  );
  if (
    approvedDefinition.steps.length < 1 ||
    approvedDefinition.steps.length > 32 ||
    previous.completedStepCount !== previous.currentStepIndex ||
    next.completedStepCount !== next.currentStepIndex ||
    previous.currentStepIndex > approvedDefinition.steps.length ||
    next.currentStepIndex > approvedDefinition.steps.length ||
    (previous.state !== "completed" &&
      previous.state !== "ended" &&
      previous.currentStepIndex >= approvedDefinition.steps.length) ||
    (next.state === "completed" &&
      (next.currentStepIndex !== approvedDefinition.steps.length ||
        next.completedStepCount !== approvedDefinition.steps.length))
  ) {
    throw new Error("Automation run progress must remain inside the approved step sequence.");
  }
  const approvedStep = approvedDefinition.steps[previous.currentStepIndex];
  if (
    stepScoped &&
    (!approvedStep ||
      event.stepIndex !== previous.currentStepIndex ||
      event.stepId !== approvedStep.id)
  ) {
    throw new Error("Automation step event must bind the exact approved current step.");
  }
  let expectedStepIndex = previous.currentStepIndex;
  let expectedCompletedCount = previous.completedStepCount;
  let expectedAttemptCount = previous.attemptCount;
  if (event.action === "start") {
    if (
      previous.currentStepIndex !== 0 ||
      previous.completedStepCount !== 0 ||
      previous.attemptCount !== 0
    ) {
      throw new Error("Automation start requires pristine queued progress.");
    }
  } else if (event.action === "advance_step") {
    const completingScheduledWait = approvedStep?.kind === "wait" && previous.state === "waiting";
    const expectedAttemptNumber = completingScheduledWait
      ? previous.attemptCount
      : previous.attemptCount + 1;
    if (!approvedStep || expectedAttemptNumber < 1 || event.attemptNumber !== expectedAttemptNumber) {
      throw new Error("Automation step advancement has an invalid attempt number.");
    }
    if (
      previous.state === "waiting" &&
      (previous.nextEligibleAt === null ||
        Date.parse(event.occurredAt) < Date.parse(previous.nextEligibleAt))
    ) {
      throw new Error("Automation waiting steps cannot execute before nextEligibleAt.");
    }
    if (event.toState === "waiting") {
      if (
        approvedStep.kind !== "wait" ||
        previous.state !== "running" ||
        approvedStep.waitSeconds === null
      ) {
        throw new Error("Only a running approved wait step may schedule a wait.");
      }
      expectedAttemptCount = event.attemptNumber;
    } else {
      if (approvedStep.kind === "wait" && previous.state !== "waiting") {
        throw new Error("An approved wait step must be scheduled before it can complete.");
      }
      const isFinalStep = previous.currentStepIndex === approvedDefinition.steps.length - 1;
      if (
        (isFinalStep &&
          (event.toState !== "completed" || event.outcomeCode !== "completed")) ||
        (!isFinalStep &&
          (event.toState !== "running" || event.outcomeCode !== "step_completed"))
      ) {
        throw new Error("Only the final approved step may complete; non-final success advances once.");
      }
      expectedStepIndex += 1;
      expectedCompletedCount += 1;
      expectedAttemptCount = 0;
    }
  } else if (event.action === "inject_failure") {
    if (!approvedStep || event.attemptNumber !== previous.attemptCount + 1) {
      throw new Error("Automation failure has an invalid attempt number.");
    }
    expectedAttemptCount = event.attemptNumber;
  } else if (event.action === "retry") {
    if (!approvedStep || event.attemptNumber !== previous.attemptCount + 1) {
      throw new Error("Automation retry has an invalid next attempt number.");
    }
  } else if (event.action === "exercise_fallback") {
    const expectedFallbackAttempt =
      previous.state === "failed" ? previous.attemptCount : previous.attemptCount + 1;
    const exercisedFallback = automationFallbackForOutcome(event.outcomeCode);
    if (
      !approvedStep ||
      event.attemptNumber !== expectedFallbackAttempt ||
      exercisedFallback === null ||
      exercisedFallback !== approvedStep.fallback
    ) {
      throw new Error(
        "Automation fallback must match the exact approved current-step fallback and attempt.",
      );
    }
    expectedAttemptCount = expectedFallbackAttempt;
  }
  if (
    approvedStep &&
    stepScoped &&
    event.attemptNumber > approvedStep.retryMaxAttempts + 1
  ) {
    throw new Error("Automation event exceeds the approved step retry policy.");
  }
  if (
    next.currentStepIndex !== expectedStepIndex ||
    next.completedStepCount !== expectedCompletedCount ||
    next.attemptCount !== expectedAttemptCount
  ) {
    throw new Error("Automation run progress does not match the atomic step event.");
  }

  let expectedPausedFromState: AutomationPausedFromState | null = null;
  if (event.action === "pause") {
    expectedPausedFromState = previous.state as AutomationPausedFromState;
  } else if (event.action === "simulate_human_takeover") {
    expectedPausedFromState =
      previous.state === "paused_by_operator"
        ? previous.pausedFromState
        : (previous.state as AutomationPausedFromState);
  } else if (
    event.action === "exercise_fallback" &&
    (next.state === "paused_by_operator" || next.state === "paused_for_human")
  ) {
    expectedPausedFromState = previous.state as AutomationPausedFromState;
  } else if (event.action === "release_human_takeover") {
    expectedPausedFromState = previous.pausedFromState;
  } else if (event.action === "resume") {
    if (previous.pausedFromState === null || next.state !== previous.pausedFromState) {
      throw new Error("Automation resume must restore the exact persisted pausedFromState.");
    }
  }
  if (next.pausedFromState !== expectedPausedFromState) {
    throw new Error("Automation pause transition cannot invent or discard its origin state.");
  }

  let expectedNextEligibleAt: ISODateTime | null = null;
  if (event.action === "retry") {
    const retryExponent = event.attemptNumber - 2;
    const retryDelaySeconds = Math.min(
      approvedStep!.retryInitialBackoffSeconds * 2 ** retryExponent,
      approvedStep!.retryMaximumBackoffSeconds,
    );
    expectedNextEligibleAt = new Date(
      Date.parse(event.occurredAt) + retryDelaySeconds * 1_000,
    ).toISOString() as ISODateTime;
  } else if (event.action === "advance_step" && event.toState === "waiting") {
    expectedNextEligibleAt = new Date(
      Date.parse(event.occurredAt) + approvedStep!.waitSeconds! * 1_000,
    ).toISOString() as ISODateTime;
  } else if (
    next.state === "waiting" ||
    ((next.state === "paused_by_operator" || next.state === "paused_for_human") &&
      next.pausedFromState === "waiting")
  ) {
    expectedNextEligibleAt = previous.nextEligibleAt;
  }
  if (
    expectedNextEligibleAt === null
      ? next.nextEligibleAt !== null || event.nextEligibleAt !== null
      : next.nextEligibleAt !== expectedNextEligibleAt || event.nextEligibleAt !== expectedNextEligibleAt
  ) {
    throw new Error("Automation wait/retry due time must exactly follow the approved schedule.");
  }

  const priorWorkItem = previous.openWorkItemId;
  let expectedOpenWorkItem = priorWorkItem;
  if (event.action === "inject_failure") {
    if (priorWorkItem !== null || event.workItemId === null) {
      throw new Error("Automation work-item creation requires no prior open work item.");
    }
    expectedOpenWorkItem = event.workItemId;
  } else if (event.action === "simulate_human_takeover") {
    if (event.workItemId === null) {
      throw new Error("Human takeover must bind exactly one work item.");
    }
    if (priorWorkItem !== null && event.workItemId !== priorWorkItem) {
      throw new Error("Human takeover must reuse an existing governed work item.");
    }
    expectedOpenWorkItem = priorWorkItem ?? event.workItemId;
  } else if (event.action === "exercise_fallback") {
    if (previous.state === "failed") {
      if (priorWorkItem === null || event.workItemId !== priorWorkItem) {
        throw new Error("Failed-run fallback must reuse the existing failure work item.");
      }
      expectedOpenWorkItem =
        event.outcomeCode === "fallback_stopped_safely" ? null : priorWorkItem;
    } else if (
      event.outcomeCode === "fallback_work_item_created" ||
      event.outcomeCode === "human_takeover_required"
    ) {
      if (priorWorkItem !== null || event.workItemId === null) {
        throw new Error("Automation fallback cannot create a duplicate open work item.");
      }
      expectedOpenWorkItem = event.workItemId;
    } else {
      if (priorWorkItem !== null || event.workItemId !== null) {
        throw new Error("Safe-stop fallback cannot retain an unrelated work item.");
      }
      expectedOpenWorkItem = null;
    }
  } else if (event.action === "retry") {
    if (priorWorkItem === null || event.workItemId !== priorWorkItem) {
      throw new Error("Retry must resolve the exact open work item.");
    }
    expectedOpenWorkItem = null;
  } else if (event.action === "release_human_takeover") {
    if (priorWorkItem === null || event.workItemId !== priorWorkItem) {
      throw new Error("Takeover release must bind the exact open work item.");
    }
    expectedOpenWorkItem = previous.pausedFromState === "failed" ? priorWorkItem : null;
  } else if (event.action === "resume" || event.action === "end") {
    if (event.workItemId !== priorWorkItem) {
      throw new Error("Operator resolution must cross-link the exact prior work item.");
    }
    expectedOpenWorkItem =
      event.action === "resume" && previous.pausedFromState === "failed"
        ? priorWorkItem
        : null;
  } else if (event.workItemId !== null) {
    throw new Error("This automation transition cannot mutate an open work item.");
  }
  if (next.openWorkItemId !== expectedOpenWorkItem) {
    throw new Error("Automation run openWorkItemId does not match the atomic event outcome.");
  }
  if (event.workItemId === null) {
    if (workItemTransition !== null) {
      throw new Error("A transition without workItemId cannot mutate a work-item document.");
    }
  } else {
    if (workItemTransition === null || workItemTransition.next === null) {
      throw new Error("Work-item events require previous/next document evidence.");
    }
    const priorItem = workItemTransition.previous;
    const nextItem = workItemTransition.next;
    if ((priorWorkItem === null) !== (priorItem === null)) {
      throw new Error("Automation work-item document existence must match the prior run pointer.");
    }
    if (priorItem !== null && priorItem.state === "resolved") {
      throw new Error("An openWorkItemId cannot reference an already-resolved work item.");
    }
    if (
      nextItem.id !== event.workItemId ||
      nextItem.workspaceId !== event.workspaceId ||
      nextItem.runId !== event.runId ||
      nextItem.definitionId !== event.definitionId ||
      nextItem.definitionVersion !== event.definitionVersion ||
      nextItem.definitionContentHash !== event.definitionContentHash ||
      nextItem.teamId !== event.teamId ||
      nextItem.locationId !== event.locationId ||
      nextItem.lastEventId !== event.id ||
      nextItem.updatedAt !== event.occurredAt
    ) {
      throw new Error("Automation work item must exactly cross-bind the run event aggregate.");
    }
    if (priorItem === null) {
      const expectedReason =
        event.action === "inject_failure"
          ? event.reasonCode === "integration_timeout"
            ? "integration_timeout"
            : "synthetic_failure"
          : event.action === "simulate_human_takeover"
            ? "human_takeover"
            : "fallback_route";
      if (
        nextItem.state !== "open" ||
        nextItem.reasonCode !== expectedReason ||
        nextItem.assignedMemberUid !== null ||
        nextItem.openedAt !== event.occurredAt ||
        nextItem.createdAt !== event.occurredAt ||
        nextItem.revision !== 1
      ) {
        throw new Error("Automation work-item creation must atomically create one open item.");
      }
    } else {
      if (
        priorItem.id !== nextItem.id ||
        priorItem.workspaceId !== nextItem.workspaceId ||
        priorItem.runId !== nextItem.runId ||
        priorItem.definitionId !== nextItem.definitionId ||
        priorItem.definitionVersion !== nextItem.definitionVersion ||
        priorItem.definitionContentHash !== nextItem.definitionContentHash ||
        priorItem.teamId !== nextItem.teamId ||
        priorItem.locationId !== nextItem.locationId ||
        priorItem.reasonCode !== nextItem.reasonCode ||
        priorItem.openedAt !== nextItem.openedAt ||
        priorItem.slaMinutes !== nextItem.slaMinutes ||
        priorItem.dueAt !== nextItem.dueAt ||
        priorItem.assignedMemberUid !== nextItem.assignedMemberUid ||
        priorItem.createdAt !== nextItem.createdAt ||
        !isCanonicalIsoDateTime(priorItem.createdAt) ||
        !isCanonicalIsoDateTime(priorItem.updatedAt) ||
        !isCanonicalIsoDateTime(nextItem.createdAt) ||
        Date.parse(priorItem.updatedAt) > Date.parse(event.occurredAt) ||
        Date.parse(nextItem.createdAt) > Date.parse(nextItem.updatedAt) ||
        nextItem.revision !== priorItem.revision + 1
      ) {
        throw new Error("Automation work-item update must preserve identity and increment revision.");
      }
      assertAutomationWorkItemLifecycle(priorItem);
      const resolvesItem = expectedOpenWorkItem === null;
      if (resolvesItem) {
        const expectedResolutionCode =
          event.action === "release_human_takeover"
            ? "routed_to_human"
            : event.action === "end" || event.outcomeCode === "fallback_stopped_safely"
              ? "stopped_safely"
              : "retried";
        const expectedAcknowledgedAt =
          priorItem.state === "open" ? event.occurredAt : priorItem.acknowledgedAt;
        const expectedAcknowledgedByUid =
          priorItem.state === "open" ? event.actorUid : priorItem.acknowledgedByUid;
        if (
          event.actorKind !== "staff" ||
          (priorItem.state !== "open" && priorItem.state !== "acknowledged") ||
          nextItem.state !== "resolved" ||
          nextItem.acknowledgedAt !== expectedAcknowledgedAt ||
          nextItem.acknowledgedByUid !== expectedAcknowledgedByUid ||
          nextItem.resolvedAt !== event.occurredAt ||
          nextItem.resolvedByUid !== event.actorUid ||
          nextItem.resolutionCode !== expectedResolutionCode
        ) {
          throw new Error("Automation work-item resolution requires acknowledged staff evidence.");
        }
      } else {
        const acknowledgesFailedRelease =
          event.action === "release_human_takeover" && previous.pausedFromState === "failed";
        if (acknowledgesFailedRelease && priorItem.state === "open") {
          if (
            event.actorKind !== "staff" ||
            nextItem.state !== "acknowledged" ||
            nextItem.acknowledgedAt !== event.occurredAt ||
            nextItem.acknowledgedByUid !== event.actorUid ||
            nextItem.resolvedAt !== null ||
            nextItem.resolvedByUid !== null ||
            nextItem.resolutionCode !== null
          ) {
            throw new Error("Failed-origin takeover release must acknowledge its open work item.");
          }
        } else if (
          nextItem.state !== priorItem.state ||
          nextItem.acknowledgedAt !== priorItem.acknowledgedAt ||
          nextItem.acknowledgedByUid !== priorItem.acknowledgedByUid ||
          nextItem.resolvedAt !== priorItem.resolvedAt ||
          nextItem.resolvedByUid !== priorItem.resolvedByUid ||
          nextItem.resolutionCode !== priorItem.resolutionCode
        ) {
          throw new Error("Automation work-item pointer updates cannot fabricate lifecycle evidence.");
        }
      }
    }
    assertAutomationWorkItemLifecycle(nextItem);
  }
  assertAutomationRunOperationalState(next);
}

export interface AutomationRunTransitionOptions {
  readonly outcome?: "continue" | "wait" | "complete";
  readonly fallback?: AutomationStepPolicy["fallback"];
  readonly resumeFromState?: AutomationPausedFromState;
  readonly retryAt?: ISODateTime;
  readonly pausedFromState?: AutomationPausedFromState | null;
}

export function transitionAutomationRunState(
  state: AutomationExecutionState,
  action: AutomationRunAction,
  options: AutomationRunTransitionOptions = {},
): AutomationExecutionState {
  if (
    !canApplyAutomationRunAction(state, action, {
      pausedFromState: options.pausedFromState ?? null,
    })
  ) {
    throw new Error(`Automation action ${action} is not allowed from ${state}.`);
  }
  if (action === "start") return "running";
  if (action === "retry") {
    if (
      !options.retryAt ||
      !Number.isFinite(Date.parse(options.retryAt)) ||
      new Date(Date.parse(options.retryAt)).toISOString() !== options.retryAt
    ) {
      throw new Error("Retry requires a canonical nextEligibleAt schedule.");
    }
    return "waiting";
  }
  if (action === "resume") {
    if (!options.resumeFromState) {
      throw new Error("Resuming an automation run requires its persisted pausedFromState.");
    }
    return options.resumeFromState;
  }
  if (action === "advance_step") {
    return options.outcome === "complete"
      ? "completed"
      : options.outcome === "wait"
        ? "waiting"
        : "running";
  }
  if (action === "pause" || action === "release_human_takeover") return "paused_by_operator";
  if (action === "simulate_human_takeover") return "paused_for_human";
  if (action === "exercise_fallback") {
    if (!options.fallback) throw new Error("Exercising a fallback requires its approved fallback policy.");
    if (options.fallback === "create_work_item") return "paused_by_operator";
    return options.fallback === "route_to_human" ? "paused_for_human" : "ended";
  }
  if (action === "inject_failure") return "failed";
  return "ended";
}

const CARE_ACTIONS_BY_STATE: Readonly<Record<CareEnrollmentState, readonly CareEnrollmentAction[]>> = {
  queued: ["start", "end", "simulate_suppression"],
  active: ["advance_contact", "pause", "end", "simulate_suppression", "human_takeover_started", "raise_red_flag"],
  paused_by_operator: ["resume", "end", "simulate_suppression", "human_takeover_started", "raise_red_flag"],
  paused_for_human: ["release_human_takeover", "end", "simulate_suppression", "raise_red_flag"],
  paused_for_safety: ["clear_clinical_hold", "clear_safety_hold", "end", "simulate_suppression", "raise_red_flag"],
  escalated: ["acknowledge_escalation", "resolve_escalation", "simulate_suppression"],
  completed: [],
  ended: [],
};

export function canApplyCareEnrollmentAction(
  state: CareEnrollmentState,
  action: CareEnrollmentAction,
): boolean {
  return CARE_ACTIONS_BY_STATE[state].includes(action);
}

export function isTerminalCareSuppression(reason: CareSuppressionReason): boolean {
  return reason !== "clinical_hold";
}

export function orderCareSuppressions(
  reasons: readonly CareSuppressionReason[],
): readonly CareSuppressionReason[] {
  const selected = new Set(reasons);
  return CARE_SUPPRESSION_PRECEDENCE.filter((reason) => selected.has(reason));
}

export function clearCareSuppression(
  reasons: readonly CareSuppressionReason[],
  reason: CareSuppressionReason,
  clearance: VerifiedClinicalClearance | null,
  expectedScope: ClinicalPatientScope,
  now: ISODateTime,
): readonly CareSuppressionReason[] {
  if (reason !== "clinical_hold" || clearance === null) return orderCareSuppressions(reasons);
  assertVerifiedClinicalClearance(clearance, expectedScope, now);
  return orderCareSuppressions(reasons.filter((candidate) => candidate !== "clinical_hold"));
}

export interface ClinicalPatientScope {
  readonly workspaceId: AuthoritativeCarePathway["workspaceId"];
  readonly teamId: TeamId;
  readonly locationId: LocationId;
}

/** Constructed only by trusted service code after RBAC, MFA and step-up checks. */
export interface VerifiedClinicalClearance {
  readonly verification: "server_verified_clinical_clearance";
  readonly actorUid: UserId;
  readonly actorRole: "clinical_approver";
  readonly permission: "clinical.manage_escalations";
  readonly workspaceId: AuthoritativeCarePathway["workspaceId"];
  readonly teamId: TeamId;
  readonly locationId: LocationId;
  readonly recentAuthenticationVerified: true;
  readonly recentAuthenticationAt: ISODateTime;
  readonly mfaVerified: true;
  readonly verifiedAt: ISODateTime;
}

export function assertVerifiedClinicalClearance(
  authority: VerifiedClinicalClearance,
  expectedScope: ClinicalPatientScope,
  now: ISODateTime,
): void {
  const expectedKeys = [
    "actorRole",
    "actorUid",
    "locationId",
    "mfaVerified",
    "permission",
    "recentAuthenticationAt",
    "recentAuthenticationVerified",
    "teamId",
    "verification",
    "verifiedAt",
    "workspaceId",
  ];
  const actualKeys = Object.keys(authority).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error("Clinical authority evidence must use the exact trusted shape.");
  }
  if (
    authority.verification !== "server_verified_clinical_clearance" ||
    authority.actorRole !== "clinical_approver" ||
    authority.permission !== "clinical.manage_escalations" ||
    authority.workspaceId !== expectedScope.workspaceId ||
    authority.teamId !== expectedScope.teamId ||
    authority.locationId !== expectedScope.locationId ||
    authority.recentAuthenticationVerified !== true ||
    authority.mfaVerified !== true ||
    typeof authority.actorUid !== "string" ||
    authority.actorUid.trim().length < 3
  ) {
    throw new Error("Clinical authority evidence is not authorized for the exact patient scope.");
  }
  const nowMs = Date.parse(now);
  const authenticatedMs = Date.parse(authority.recentAuthenticationAt);
  const verifiedMs = Date.parse(authority.verifiedAt);
  const maximumAgeMs = 15 * 60_000;
  if (
    !isCanonicalIsoDateTime(now) ||
    !isCanonicalIsoDateTime(authority.recentAuthenticationAt) ||
    !isCanonicalIsoDateTime(authority.verifiedAt) ||
    authenticatedMs > nowMs ||
    verifiedMs < authenticatedMs ||
    verifiedMs > nowMs ||
    nowMs - authenticatedMs > maximumAgeMs ||
    nowMs - verifiedMs > maximumAgeMs
  ) {
    throw new Error("Clinical authority evidence is stale or has an invalid timestamp.");
  }
}

export function assertCareEnrollmentCanEnd(openEscalationId: CareEscalationId | null): void {
  if (openEscalationId !== null) {
    throw new Error("A care enrollment cannot end while an escalation remains open.");
  }
}

export interface CareContactGateInput {
  readonly suppressionReasons: readonly CareSuppressionReason[];
  readonly contactSuppressAll: boolean;
  readonly contactSuppressMarketing: boolean;
  readonly contactInvalid: boolean;
  readonly careConsentStatus: ConsentStatus;
  readonly humanTakeoverActive: boolean;
  readonly openEscalation: boolean;
}

export type CareContactGateReason =
  | CareSuppressionReason
  | "contact_suppress_all"
  | "care_consent_unavailable"
  | "human_takeover"
  | "open_escalation";

export interface CareContactGateDecision {
  readonly allowed: boolean;
  readonly reason: CareContactGateReason | null;
  readonly terminalWithinEnrollment: boolean;
  readonly clinicalClearanceRequired: boolean;
}

export function evaluateCareContactGate(input: CareContactGateInput): CareContactGateDecision {
  const reasons = new Set(input.suppressionReasons);
  const blockedBy = (suppression: CareSuppressionReason): CareContactGateDecision => ({
    allowed: false,
    reason: suppression,
    terminalWithinEnrollment: isTerminalCareSuppression(suppression),
    clinicalClearanceRequired: suppression === "clinical_hold",
  });
  if (reasons.has("death")) return blockedBy("death");
  if (input.openEscalation) {
    return { allowed: false, reason: "open_escalation", terminalWithinEnrollment: false, clinicalClearanceRequired: false };
  }
  if (input.contactSuppressAll) {
    return { allowed: false, reason: "contact_suppress_all", terminalWithinEnrollment: false, clinicalClearanceRequired: false };
  }
  if (input.contactInvalid || reasons.has("invalid_contact")) return blockedBy("invalid_contact");
  if (reasons.has("readmission")) return blockedBy("readmission");
  if (reasons.has("transfer")) return blockedBy("transfer");
  if (reasons.has("clinical_hold")) return blockedBy("clinical_hold");
  if (reasons.has("withdrawal") || input.careConsentStatus === "withdrawn") {
    return blockedBy("withdrawal");
  }
  if (input.careConsentStatus !== "granted") {
    return {
      allowed: false,
      reason: "care_consent_unavailable",
      terminalWithinEnrollment: false,
      clinicalClearanceRequired: false,
    };
  }
  if (input.humanTakeoverActive) {
    return { allowed: false, reason: "human_takeover", terminalWithinEnrollment: false, clinicalClearanceRequired: false };
  }
  // Marketing-only STOP/suppression does not override justified, consented care utility.
  void input.contactSuppressMarketing;
  return { allowed: true, reason: null, terminalWithinEnrollment: false, clinicalClearanceRequired: false };
}

export function transitionCareEnrollmentState(
  state: CareEnrollmentState,
  action: CareEnrollmentAction,
  options: {
    readonly suppressionReason?: CareSuppressionReason;
    readonly complete?: boolean;
    readonly activeSuppressions?: readonly CareSuppressionReason[];
    readonly openEscalationId?: CareEscalationId | null;
    readonly safetyHoldEscalationId?: CareEscalationId | null;
    readonly clinicalClearance?: VerifiedClinicalClearance | null;
    readonly patientScope?: ClinicalPatientScope;
    readonly now?: ISODateTime;
  } = {},
): CareEnrollmentState {
  if (!canApplyCareEnrollmentAction(state, action)) {
    throw new Error(`Care action ${action} is not allowed from ${state}.`);
  }
  if (action === "start") return "active";
  if (action === "resume") {
    if (options.openEscalationId !== null || !options.activeSuppressions) {
      throw new Error("Resuming care requires an explicit closed-escalation and suppression snapshot.");
    }
    if (options.activeSuppressions.length > 0) {
      throw new Error("A care enrollment with active suppressions cannot resume.");
    }
    return "active";
  }
  if (action === "advance_contact") return options.complete ? "completed" : "active";
  if (action === "pause" || action === "release_human_takeover") return "paused_by_operator";
  if (action === "human_takeover_started") return "paused_for_human";
  if (action === "clear_clinical_hold") {
    if (
      options.openEscalationId !== null ||
      !options.activeSuppressions ||
      !options.activeSuppressions.includes("clinical_hold") ||
      options.activeSuppressions.some(isTerminalCareSuppression) ||
      !options.clinicalClearance ||
      !options.patientScope ||
      !options.now
    ) {
      throw new Error("Clinical hold clearance requires verified authority and no terminal suppression or open escalation.");
    }
    assertVerifiedClinicalClearance(options.clinicalClearance, options.patientScope, options.now);
    return options.safetyHoldEscalationId
      ? "paused_for_safety"
      : "paused_by_operator";
  }
  if (action === "clear_safety_hold") {
    if (
      options.openEscalationId !== null ||
      !options.safetyHoldEscalationId ||
      !options.activeSuppressions ||
      options.activeSuppressions.length > 0 ||
      !options.clinicalClearance ||
      !options.patientScope ||
      !options.now
    ) {
      throw new Error("A safety hold cannot clear while an escalation or suppression remains active.");
    }
    assertVerifiedClinicalClearance(options.clinicalClearance, options.patientScope, options.now);
    return "paused_by_operator";
  }
  if (action === "raise_red_flag") return "escalated";
  if (action === "acknowledge_escalation" || action === "resolve_escalation") {
    if (!options.clinicalClearance || !options.patientScope || !options.now) {
      throw new Error("Escalation actions require verified clinical authority.");
    }
    assertVerifiedClinicalClearance(options.clinicalClearance, options.patientScope, options.now);
    if (action === "acknowledge_escalation") return "escalated";
    if (!options.activeSuppressions) {
      throw new Error("Resolving an escalation requires an explicit suppression snapshot.");
    }
    return options.activeSuppressions.some(isTerminalCareSuppression)
      ? "ended"
      : "paused_for_safety";
  }
  if (action === "simulate_suppression") {
    if (!options.suppressionReason) throw new Error("A suppression reason is required.");
    if (state === "escalated" || options.openEscalationId) return "escalated";
    if (!isTerminalCareSuppression(options.suppressionReason)) return "paused_for_safety";
    return "ended";
  }
  if (options.openEscalationId === undefined) {
    throw new Error("Ending care requires an explicit openEscalationId snapshot.");
  }
  assertCareEnrollmentCanEnd(options.openEscalationId);
  return "ended";
}
