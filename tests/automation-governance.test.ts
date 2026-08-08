import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  authorizationPolicyForAutomationAction,
  authorizationPolicyForCareAction,
  authorizeWorkspaceAction,
  hasPermission,
  type ResourceScope,
} from "@/lib/domain/access-control";
import {
  CARE_PATHWAY_SUPPRESSIONS,
  CARE_SUPPRESSION_PRECEDENCE,
  assertAutomationActivationBinding,
  assertAutomationActivationProof,
  assertAutomationDefinitionEventBinding,
  assertAutomationRunSchedulingState,
  assertAutomationRunOperationalTransition,
  assertAutomationRunEventTrace,
  assertAutomationRunEventSecretBinding,
  assertAutomationRunSecretReceiptLink,
  assertAutomationTriggerReceiptChronology,
  assertAutomationTriggerReceiptRunBinding,
  assertAutomationTriggerReceiptIdentity,
  assertAutomationWorkItemLifecycle,
  assertCareEnrollmentCanEnd,
  assertCareEnrollmentEventTrace,
  assertCareEnrollmentReceiptIdentity,
  assertCareEnrollmentReceiptChronology,
  assertCareEnrollmentSecretReceiptLink,
  assertCareEnrollmentOperationalState,
  assertCareEnrollmentOperationalTransition,
  assertCareEnrollmentReceiptAggregateBinding,
  assertCareEscalationLifecycle,
  assertCareHandoffLifecycle,
  assertCarePathwayActivationBinding,
  assertCarePathwayActivationProof,
  assertCarePathwayEventBinding,
  assertGovernedActor,
  assertVerifiedClinicalClearance,
  canApplyAutomationRunAction,
  canApplyCareEnrollmentAction,
  careEnrollmentMustPause,
  clearCareSuppression,
  evaluateCareContactGate,
  transitionAutomationRunState,
  transitionCareEnrollmentState,
  type AuthoritativeAutomationStep,
  type AuthoritativeCarePathway,
  type AutomationRunEventSecretProjection,
  type AutomationRunOperationalSnapshot,
  type AutomationRunSecretProjection,
  type AutomationTriggerReceiptSecretProjection,
  type StaffSafeAutomationWorkItem,
  type StaffSafeAutomationDefinitionEvent,
  type StaffSafeAutomationRun,
  type StaffSafeAutomationRunEvent,
  type StaffSafeCareEnrollment,
  type StaffSafeCareEnrollmentEvent,
  type StaffSafeCareEscalation,
  type StaffSafeCareHandoff,
  type StaffSafeCarePathwayEvent,
  type CareEnrollmentReceiptSecretProjection,
  type CareEnrollmentOperationalSnapshot,
  type CareEnrollmentSecretProjection,
  type VerifiedClinicalClearance,
} from "@/lib/domain/automations";
import {
  assertAutomationDefinitionSecretCrossBinding,
  assertAutomationTriggerReceiptImmutableReplay,
  assertAutomationTriggerReceiptReplayBinding,
  assertCareEnrollmentReceiptImmutableReplay,
  assertCareEnrollmentReceiptReplayBinding,
  assertCarePathwaySecretCrossBinding,
  serializeAutomationDefinitionApproval,
  serializeAutomationDefinitionContent,
  serializeAutomationDefinitionSecretBinding,
  serializeAutomationSourceEventIdentity,
  serializeAutomationTriggerReceiptKey,
  serializeAutomationTriggerReceiptPayload,
  serializeCareEnrollmentReceiptKey,
  serializeCareEnrollmentReceiptPayload,
  serializeCareDischargeSourceIdentity,
  serializeCarePathwayApproval,
  serializeCarePathwayContent,
  serializeCarePathwaySecretBinding,
  type AutomationDefinitionContentBinding,
  type AutomationDefinitionSecretBinding,
  type AutomationSourceEventIdentityBinding,
  type AutomationTriggerReceiptKeyBinding,
  type AutomationTriggerReceiptPayloadBinding,
  type CareEnrollmentReceiptKeyBinding,
  type CareEnrollmentReceiptPayloadBinding,
  type CareDischargeSourceIdentityBinding,
  type CarePathwayContentBinding,
  type CarePathwaySecretBinding,
} from "@/lib/domain/automation-governance";
import {
  entityId,
  encryptedValueRef,
  externalReference,
  hmacDigest,
  isoDateTime,
  sha256Digest,
} from "@/lib/domain/primitives";

const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const syntheticHmac = (value: string) =>
  createHmac("sha256", "PUBLIC-SYNTHETIC-TEST-KEY-NOT-A-SECRET")
    .update(value, "utf8")
    .digest("hex");

const sendStep: AuthoritativeAutomationStep = {
  id: "step_send_appointment",
  kind: "send_template",
  templateVersionId: entityId<"TemplateVersion">("template_synthetic_appointment_en_v1"),
  templateContentHash: sha256Digest("8".repeat(64)),
  waitSeconds: null,
  appointmentAction: null,
  routeTeamId: null,
  stopReasonCode: null,
  requiredConsentPurpose: "appointment_service",
  serviceWindowBehavior: "use_approved_template",
  timeoutSeconds: 30,
  retryMaxAttempts: 3,
  retryInitialBackoffSeconds: 30,
  retryMaximumBackoffSeconds: 300,
  fallback: "create_work_item",
};

const waitStep: AuthoritativeAutomationStep = {
  id: "step_wait_reminder",
  kind: "wait",
  templateVersionId: null,
  templateContentHash: null,
  waitSeconds: 3_600,
  appointmentAction: null,
  routeTeamId: null,
  stopReasonCode: null,
  requiredConsentPurpose: "appointment_service",
  serviceWindowBehavior: "send_in_window",
  timeoutSeconds: 5,
  retryMaxAttempts: 0,
  retryInitialBackoffSeconds: 0,
  retryMaximumBackoffSeconds: 0,
  fallback: "stop_run",
};

const automationSecret: AutomationDefinitionSecretBinding = {
  workspaceId: "workspace_safenet_demo",
  definitionId: "automation_synthetic_appointment_v1",
  protectedConfigurationRef: "demo://automation/configuration/synthetic-v1",
  configurationFingerprint: "1".repeat(64),
  schemaVersion: 1,
  synthetic: true,
};

const automationSecretBindingHash = hash(
  serializeAutomationDefinitionSecretBinding(automationSecret),
);

const automationContent: AutomationDefinitionContentBinding = {
  workspaceId: "workspace_safenet_demo",
  definitionId: "automation_synthetic_appointment_v1",
  family: "appointment_service",
  version: 3,
  name: "Synthetic appointment reminder",
  trigger: "appointment_event",
  consentPurpose: "appointment_service",
  riskLevel: "medium",
  steps: [sendStep, waitStep],
  secretBindingHash: automationSecretBindingHash,
  synthetic: true,
};

const careSecret: CarePathwaySecretBinding = {
  workspaceId: "workspace_safenet_demo",
  pathwayId: "care_pathway_synthetic_followup_v1",
  protectedInstructionsRef: "demo://care/instructions/synthetic-v1",
  protectedContentFingerprint: "e".repeat(64),
  schemaVersion: 1,
  synthetic: true,
};

const careSecretBindingHash = hash(serializeCarePathwaySecretBinding(careSecret));

const careContent: CarePathwayContentBinding = {
  workspaceId: "workspace_safenet_demo",
  pathwayId: "care_pathway_synthetic_followup_v1",
  family: "post_discharge",
  protocolVersion: "v1.0",
  name: "Synthetic post-discharge follow-up",
  clinicalOwnerUid: "user_synthetic_clinical_owner",
  contactPoints: [
    {
      dayOffset: 1,
      en: {
        templateVersionId: entityId<"TemplateVersion">("template_synthetic_care_day1_en_v1"),
        contentHash: sha256Digest("2".repeat(64)),
      },
      si: {
        templateVersionId: entityId<"TemplateVersion">("template_synthetic_care_day1_si_v1"),
        contentHash: sha256Digest("3".repeat(64)),
      },
      ta: {
        templateVersionId: entityId<"TemplateVersion">("template_synthetic_care_day1_ta_v1"),
        contentHash: sha256Digest("4".repeat(64)),
      },
    },
    {
      dayOffset: 3,
      en: {
        templateVersionId: entityId<"TemplateVersion">("template_synthetic_care_day3_en_v1"),
        contentHash: sha256Digest("5".repeat(64)),
      },
      si: {
        templateVersionId: entityId<"TemplateVersion">("template_synthetic_care_day3_si_v1"),
        contentHash: sha256Digest("6".repeat(64)),
      },
      ta: {
        templateVersionId: entityId<"TemplateVersion">("template_synthetic_care_day3_ta_v1"),
        contentHash: sha256Digest("7".repeat(64)),
      },
    },
  ],
  responseSlaMinutes: 15,
  escalationTeamId: "team_synthetic_clinical_escalation",
  eligibleLocationIds: [
    "location_synthetic_thalawathugoda",
    "location_synthetic_wattala",
  ],
  afterHoursBehavior: "on_call_queue",
  writeBackRequired: true,
  instructionsSource: "clinician_authored",
  aiMayGenerateInstructions: false,
  suppressions: CARE_PATHWAY_SUPPRESSIONS,
  protectedContentHash: "e".repeat(64),
  secretBindingHash: careSecretBindingHash,
  synthetic: true,
};

const automationApprovedContentHash = hash(
  serializeAutomationDefinitionContent(automationContent),
);
const automationApprovedApprovalHash = hash(
  serializeAutomationDefinitionApproval({
    workspaceId: automationContent.workspaceId,
    definitionId: automationContent.definitionId,
    contentHash: automationApprovedContentHash,
    ownerUid: "user_synthetic_automation_owner",
    approverUid: "user_synthetic_automation_approver",
    scope: "simulation_only",
    approvedAt: "2026-08-07T09:00:00.000Z",
  }),
);
const careApprovedContentHash = hash(serializeCarePathwayContent(careContent));
const careApprovedApprovalHash = hash(
  serializeCarePathwayApproval({
    workspaceId: careContent.workspaceId,
    pathwayId: careContent.pathwayId,
    contentHash: careApprovedContentHash,
    clinicalOwnerUid: careContent.clinicalOwnerUid,
    clinicalApproverUid: "user_synthetic_clinical_approver",
    scope: "clinical_simulation_only",
    approvedAt: "2026-08-07T09:30:00.000Z",
  }),
);

const approvedCarePathway: AuthoritativeCarePathway = {
  id: entityId<"CarePathway">(careContent.pathwayId),
  workspaceId: entityId<"Workspace">(careContent.workspaceId),
  family: careContent.family,
  protocolVersion: careContent.protocolVersion,
  name: careContent.name,
  clinicalOwnerUid: entityId<"User">(careContent.clinicalOwnerUid),
  clinicalApproverUid: entityId<"User">("user_synthetic_clinical_approver"),
  contactPoints: careContent.contactPoints,
  responseSlaMinutes: careContent.responseSlaMinutes,
  escalationTeamId: entityId<"Team">(careContent.escalationTeamId),
  eligibleLocationIds: careContent.eligibleLocationIds.map((id) =>
    entityId<"Location">(id),
  ),
  afterHoursBehavior: careContent.afterHoursBehavior,
  writeBackRequired: careContent.writeBackRequired,
  instructionsSource: "clinician_authored",
  aiMayGenerateInstructions: false,
  suppressions: CARE_PATHWAY_SUPPRESSIONS,
  protectedContentHash: sha256Digest(careContent.protectedContentHash),
  secretBindingHash: sha256Digest(careSecretBindingHash),
  contentHash: sha256Digest(careApprovedContentHash),
  approvalHash: sha256Digest(careApprovedApprovalHash),
  approvalScope: "clinical_simulation_only",
  approvedAt: isoDateTime("2026-08-07T09:30:00.000Z"),
  lifecycleState: "approved",
  schemaVersion: 1,
  synthetic: true,
  createdAt: isoDateTime("2026-08-07T09:00:00.000Z"),
  updatedAt: isoDateTime("2026-08-07T09:30:00.000Z"),
};

const careScheduleAnchorAt = isoDateTime("2026-08-06T09:00:00.000Z");

function assertCareTransition(
  previous: CareEnrollmentOperationalSnapshot,
  next: CareEnrollmentOperationalSnapshot,
  event: StaffSafeCareEnrollmentEvent,
  escalationTransition: {
    readonly previous: StaffSafeCareEscalation | null;
    readonly next: StaffSafeCareEscalation | null;
  } | null = null,
  clinicalClearance: VerifiedClinicalClearance | null = null,
  handoffTransition: {
    readonly previous: StaffSafeCareHandoff | null;
    readonly next: StaffSafeCareHandoff | null;
  } | null = null,
  pathway: AuthoritativeCarePathway = approvedCarePathway,
  qualifyingDischargeAt = careScheduleAnchorAt,
): void {
  assertCareEnrollmentOperationalTransition(
    previous,
    next,
    event,
    pathway,
    {
      workspaceId: previous.workspaceId,
      enrollmentId: previous.id,
      qualifyingDischargeAt,
    },
    escalationTransition,
    handoffTransition,
    clinicalClearance,
  );
}

const authorityNow = isoDateTime("2026-08-07T09:10:00.000Z");
const clinicalScope = {
  workspaceId: entityId<"Workspace">("workspace_safenet_demo"),
  teamId: entityId<"Team">("team_synthetic_clinical_escalation"),
  locationId: entityId<"Location">("location_synthetic_wattala"),
};
const clinicalAuthority: VerifiedClinicalClearance = {
  verification: "server_verified_clinical_clearance",
  actorUid: entityId<"User">("user_synthetic_clinical_approver"),
  actorRole: "clinical_approver",
  permission: "clinical.manage_escalations",
  workspaceId: clinicalScope.workspaceId,
  teamId: clinicalScope.teamId,
  locationId: clinicalScope.locationId,
  recentAuthenticationVerified: true,
  recentAuthenticationAt: isoDateTime("2026-08-07T09:05:00.000Z"),
  mfaVerified: true,
  verifiedAt: isoDateTime("2026-08-07T09:09:00.000Z"),
};

describe("Phase 5 permission boundaries", () => {
  it("assigns the new definition and clinical capabilities without widening patient authority", () => {
    expect(hasPermission("tenant_admin", "workspace.view_connections")).toBe(true);
    expect(hasPermission("tenant_admin", "workspace.view_members")).toBe(true);
    expect(hasPermission("tenant_admin", "automations.view_definitions")).toBe(true);
    expect(hasPermission("tenant_admin", "automations.control_runs")).toBe(true);
    expect(hasPermission("tenant_admin", "automations.manage_versions")).toBe(true);
    expect(hasPermission("tenant_admin", "automations.approve_versions")).toBe(true);
    expect(hasPermission("tenant_admin", "automations.activate_versions")).toBe(true);
    expect(hasPermission("tenant_admin", "clinical.view_pathways")).toBe(true);
    expect(hasPermission("tenant_admin", "clinical.approve_pathways")).toBe(false);
    expect(hasPermission("tenant_admin", "clinical.control_enrollments")).toBe(false);
    expect(hasPermission("tenant_admin", "clinical.manage_escalations")).toBe(false);

    expect(hasPermission("supervisor", "automations.view_definitions")).toBe(true);
    expect(hasPermission("supervisor", "automations.control_runs")).toBe(true);
    expect(hasPermission("supervisor", "automations.manage_versions")).toBe(false);
    expect(hasPermission("supervisor", "clinical.control_enrollments")).toBe(false);
    expect(hasPermission("analyst", "automations.view_definitions")).toBe(true);
    expect(hasPermission("analyst", "clinical.view_pathways")).toBe(true);
    expect(hasPermission("analyst", "automations.control_runs")).toBe(false);

    expect(hasPermission("clinical_approver", "clinical.view_pathways")).toBe(true);
    expect(hasPermission("clinical_approver", "automations.view")).toBe(false);
    expect(hasPermission("clinical_approver", "automations.view_definitions")).toBe(false);
    expect(hasPermission("clinical_approver", "workspace.view_connections")).toBe(false);
    expect(hasPermission("clinical_approver", "workspace.view_members")).toBe(false);
    expect(hasPermission("clinical_approver", "clinical.approve_pathways")).toBe(true);
    expect(hasPermission("clinical_approver", "clinical.control_enrollments")).toBe(true);
    expect(hasPermission("clinical_approver", "clinical.manage_escalations")).toBe(true);
  });

  it.each([
    "platform_owner",
    "agent",
    "campaign_operator",
    "campaign_approver",
    "privacy_reviewer",
  ] as const)("does not grant new execution or clinical authority to %s", (role) => {
    expect([
      "automations.view_definitions",
      "automations.control_runs",
      "automations.manage_versions",
      "automations.approve_versions",
      "automations.activate_versions",
      "clinical.view_pathways",
      "clinical.approve_pathways",
      "clinical.control_enrollments",
      "clinical.manage_escalations",
    ].every((permission) => !hasPermission(role, permission as Parameters<typeof hasPermission>[1]))).toBe(true);
  });

  it("separates ordinary automation control from clinical enrollment and escalation actions", () => {
    expect(authorizationPolicyForAutomationAction("resume")).toEqual({
      systemAllowed: false,
      staffPermission: "automations.control_runs",
    });
    expect(authorizationPolicyForAutomationAction("retry")).toEqual({
      systemAllowed: false,
      staffPermission: "automations.control_runs",
    });
    expect(
      authorizationPolicyForAutomationAction("exercise_fallback", { fromState: "running" }),
    ).toEqual({ systemAllowed: true, staffPermission: "automations.control_runs" });
    expect(
      authorizationPolicyForAutomationAction("exercise_fallback", { fromState: "failed" }),
    ).toEqual({ systemAllowed: false, staffPermission: "automations.control_runs" });
    expect(authorizationPolicyForAutomationAction("exercise_fallback")).toEqual({
      systemAllowed: false,
      staffPermission: "automations.control_runs",
    });
    expect(authorizationPolicyForCareAction("resume")).toEqual({
      systemAllowed: false,
      staffPermission: "clinical.control_enrollments",
    });
    expect(authorizationPolicyForCareAction("resolve_escalation")).toEqual({
      systemAllowed: false,
      staffPermission: "clinical.manage_escalations",
    });
    expect(hasPermission("tenant_admin", authorizationPolicyForCareAction("resume").staffPermission!)).toBe(false);
    expect(hasPermission("supervisor", authorizationPolicyForCareAction("resume").staffPermission!)).toBe(false);
  });

  it("fails closed when a non-admin patient scope omits either team or location", () => {
    const membership = {
      id: entityId<"Member">("member_synthetic_clinical_approver"),
      workspaceId: clinicalScope.workspaceId,
      uid: clinicalAuthority.actorUid,
      displayLabel: "Synthetic clinical approver",
      role: "clinical_approver" as const,
      scopeMode: "assigned" as const,
      teamIds: [clinicalScope.teamId],
      locationIds: [clinicalScope.locationId],
      status: "active" as const,
      mfaSatisfied: true,
      lastAuthenticatedAt: clinicalAuthority.recentAuthenticationAt,
      createdAt: isoDateTime("2026-08-07T08:00:00.000Z"),
      updatedAt: isoDateTime("2026-08-07T09:00:00.000Z"),
    };
    const authorize = (resource: Parameters<typeof authorizeWorkspaceAction>[0]["resource"]) =>
      authorizeWorkspaceAction({
        membership,
        permission: "clinical.control_enrollments",
        resource,
        now: authorityNow,
      });

    expect(
      authorize({
        workspaceId: clinicalScope.workspaceId,
        sensitivity: "patient",
        teamId: clinicalScope.teamId,
        locationId: clinicalScope.locationId,
      }),
    ).toEqual({ allowed: true });
    expect(
      authorize({
        workspaceId: clinicalScope.workspaceId,
        sensitivity: "patient",
        teamId: clinicalScope.teamId,
      } as unknown as ResourceScope),
    ).toEqual({ allowed: false, reason: "invalid_scope_configuration" });
    expect(
      authorize({
        workspaceId: clinicalScope.workspaceId,
        sensitivity: "patient",
        locationId: clinicalScope.locationId,
      } as unknown as ResourceScope),
    ).toEqual({ allowed: false, reason: "invalid_scope_configuration" });

    const resource: ResourceScope = {
      workspaceId: clinicalScope.workspaceId,
      sensitivity: "patient",
      teamId: clinicalScope.teamId,
      locationId: clinicalScope.locationId,
    };
    expect(
      authorizeWorkspaceAction({
        membership: { ...membership, mfaSatisfied: false },
        permission: "clinical.control_enrollments",
        resource,
        now: authorityNow,
        requireMfa: false,
      }),
    ).toEqual({ allowed: false, reason: "mfa_required" });
    for (const recentAuthenticationWindowMinutes of [0, Number.NaN, 16]) {
      expect(
        authorizeWorkspaceAction({
          membership,
          permission: "clinical.control_enrollments",
          resource,
          now: authorityNow,
          recentAuthenticationWindowMinutes,
        }),
      ).toEqual({ allowed: false, reason: "recent_auth_required" });
    }
    expect(
      authorizeWorkspaceAction({
        membership: { ...membership, lastAuthenticatedAt: "not-a-date" as never },
        permission: "clinical.control_enrollments",
        resource,
        now: authorityNow,
      }),
    ).toEqual({ allowed: false, reason: "recent_auth_required" });
    expect(
      authorizeWorkspaceAction({
        membership,
        permission: "clinical.control_enrollments",
        resource,
        now: "2026-08-07 09:10:00Z" as never,
      }),
    ).toEqual({ allowed: false, reason: "recent_auth_required" });
  });
});

describe("governed execution transitions", () => {
  it("releases human takeover into an operator pause and never auto-resumes", () => {
    expect(canApplyAutomationRunAction("paused_for_human", "resume")).toBe(false);
    expect(
      transitionAutomationRunState("paused_for_human", "release_human_takeover"),
    ).toBe("paused_by_operator");
    expect(() => transitionAutomationRunState("paused_by_operator", "resume")).toThrow(
      /pausedFromState/i,
    );
    expect(
      transitionAutomationRunState("paused_by_operator", "resume", {
        resumeFromState: "running",
      }),
    ).toBe("running");
    expect(
      canApplyAutomationRunAction("paused_by_operator", "simulate_human_takeover", {
        pausedFromState: "queued",
      }),
    ).toBe(false);
    expect(
      canApplyAutomationRunAction("paused_by_operator", "simulate_human_takeover", {
        pausedFromState: "running",
      }),
    ).toBe(true);
    expect(
      canApplyAutomationRunAction("paused_by_operator", "simulate_human_takeover", {
        pausedFromState: "waiting",
      }),
    ).toBe(true);
    expect(() =>
      transitionAutomationRunState("paused_by_operator", "simulate_human_takeover", {
        pausedFromState: "queued",
      }),
    ).toThrow(/not allowed/i);
  });

  it("preserves waiting schedules and applies each approved fallback safely", () => {
    const nextEligibleAt = isoDateTime("2026-08-07T10:00:00.000Z");
    expect(() =>
      assertAutomationRunSchedulingState({
        state: "paused_by_operator",
        pausedFromState: "waiting",
        nextEligibleAt,
      }),
    ).not.toThrow();
    expect(() =>
      assertAutomationRunSchedulingState({
        state: "paused_by_operator",
        pausedFromState: "waiting",
        nextEligibleAt: null,
      }),
    ).toThrow(/preserve/i);
    expect(() =>
      assertAutomationRunSchedulingState({
        state: "waiting",
        pausedFromState: null,
        nextEligibleAt: "not-a-date" as never,
      }),
    ).toThrow(/canonical ISO/i);
    expect(() =>
      assertAutomationRunSchedulingState({
        state: "paused_for_human",
        pausedFromState: "waiting",
        nextEligibleAt: "2026-08-07 10:00:00Z" as never,
      }),
    ).toThrow(/canonical ISO/i);
    expect(
      transitionAutomationRunState("paused_by_operator", "resume", {
        resumeFromState: "waiting",
      }),
    ).toBe("waiting");
    expect(
      transitionAutomationRunState("running", "exercise_fallback", {
        fallback: "create_work_item",
      }),
    ).toBe("paused_by_operator");
    expect(
      transitionAutomationRunState("running", "exercise_fallback", {
        fallback: "route_to_human",
      }),
    ).toBe("paused_for_human");
    expect(
      transitionAutomationRunState("running", "exercise_fallback", {
        fallback: "stop_run",
      }),
    ).toBe("ended");
    expect(() => transitionAutomationRunState("failed", "retry")).toThrow(
      /nextEligibleAt/i,
    );
    expect(
      transitionAutomationRunState("failed", "retry", {
        retryAt: nextEligibleAt,
      }),
    ).toBe("waiting");
    expect(() =>
      assertAutomationRunSchedulingState({
        state: "waiting",
        pausedFromState: null,
        nextEligibleAt,
      }),
    ).not.toThrow();
  });

  it("keeps escalation acknowledgement and resolution separate from clearance and resume", () => {
    expect(transitionCareEnrollmentState("active", "raise_red_flag")).toBe("escalated");
    expect(
      transitionCareEnrollmentState("escalated", "acknowledge_escalation", {
        clinicalClearance: clinicalAuthority,
        patientScope: clinicalScope,
        now: authorityNow,
      }),
    ).toBe("escalated");
    expect(canApplyCareEnrollmentAction("escalated", "resume")).toBe(false);
    expect(
      transitionCareEnrollmentState("escalated", "resolve_escalation", {
        clinicalClearance: clinicalAuthority,
        patientScope: clinicalScope,
        activeSuppressions: [],
        now: authorityNow,
      }),
    ).toBe("paused_for_safety");
    expect(
      transitionCareEnrollmentState("paused_for_safety", "clear_safety_hold", {
        activeSuppressions: [],
        openEscalationId: null,
        safetyHoldEscalationId:
          "care_escalation_synthetic_resolved" as StaffSafeCareEnrollment["safetyHoldEscalationId"],
        clinicalClearance: clinicalAuthority,
        patientScope: clinicalScope,
        now: authorityNow,
      }),
    ).toBe("paused_by_operator");
    expect(
      transitionCareEnrollmentState("paused_for_safety", "clear_clinical_hold", {
        activeSuppressions: ["clinical_hold"],
        openEscalationId: null,
        safetyHoldEscalationId:
          "care_escalation_synthetic_resolved" as StaffSafeCareEnrollment["safetyHoldEscalationId"],
        clinicalClearance: clinicalAuthority,
        patientScope: clinicalScope,
        now: authorityNow,
      }),
    ).toBe("paused_for_safety");
    expect(
      transitionCareEnrollmentState("paused_by_operator", "resume", {
        activeSuppressions: [],
        openEscalationId: null,
      }),
    ).toBe("active");
    expect(
      transitionCareEnrollmentState("escalated", "resolve_escalation", {
        clinicalClearance: clinicalAuthority,
        patientScope: clinicalScope,
        activeSuppressions: ["readmission"],
        now: authorityNow,
      }),
    ).toBe("ended");
    expect(
      transitionCareEnrollmentState("escalated", "simulate_suppression", {
        suppressionReason: "clinical_hold",
        openEscalationId:
          "care_escalation_synthetic_open" as NonNullable<
            StaffSafeCareEnrollment["openEscalationId"]
          >,
      }),
    ).toBe("escalated");
    expect(() =>
      assertCareEnrollmentOperationalState({
        state: "ended",
        nextContactIndex: 1,
        nextContactAt: null,
        activeSuppressions: ["readmission"],
        openEscalationId: null,
        safetyHoldEscalationId: null,
        openHandoffId: null,
      }),
    ).not.toThrow();
  });

  it("requires a two-step release before a human-paused care enrollment becomes active", () => {
    expect(transitionCareEnrollmentState("active", "human_takeover_started")).toBe(
      "paused_for_human",
    );
    expect(canApplyCareEnrollmentAction("paused_for_human", "pause")).toBe(false);
    expect(canApplyCareEnrollmentAction("paused_for_human", "resume")).toBe(false);
    expect(
      transitionCareEnrollmentState("paused_for_human", "release_human_takeover"),
    ).toBe("paused_by_operator");
    expect(
      transitionCareEnrollmentState("paused_by_operator", "resume", {
        activeSuppressions: [],
        openEscalationId: null,
      }),
    ).toBe("active");
  });

  it("makes terminal suppressions irreversible and clinical hold separately clearable", () => {
    const reasons = ["readmission", "clinical_hold", "death"] as const;
    expect(clearCareSuppression(reasons, "death", clinicalAuthority, clinicalScope, authorityNow)).toEqual([
      "death",
      "readmission",
      "clinical_hold",
    ]);
    expect(clearCareSuppression(reasons, "clinical_hold", null, clinicalScope, authorityNow)).toEqual([
      "death",
      "readmission",
      "clinical_hold",
    ]);
    expect(clearCareSuppression(reasons, "clinical_hold", clinicalAuthority, clinicalScope, authorityNow)).toEqual([
      "death",
      "readmission",
    ]);
    expect(
      transitionCareEnrollmentState("active", "simulate_suppression", {
        suppressionReason: "readmission",
      }),
    ).toBe("ended");
    expect(
      transitionCareEnrollmentState("active", "simulate_suppression", {
        suppressionReason: "clinical_hold",
      }),
    ).toBe("paused_for_safety");
  });

  it("fails closed for forged clinical authority and open-escalation end attempts", () => {
    expect(() =>
      assertVerifiedClinicalClearance(clinicalAuthority, clinicalScope, authorityNow),
    ).not.toThrow();
    expect(() =>
      assertVerifiedClinicalClearance(
        { ...clinicalAuthority, actorRole: "tenant_admin" } as unknown as VerifiedClinicalClearance,
        clinicalScope,
        authorityNow,
      ),
    ).toThrow(/authorized/i);
    expect(() =>
      assertVerifiedClinicalClearance(
        { ...clinicalAuthority, mfaVerified: false } as unknown as VerifiedClinicalClearance,
        clinicalScope,
        authorityNow,
      ),
    ).toThrow(/authorized/i);
    expect(() =>
      assertVerifiedClinicalClearance(
        {
          ...clinicalAuthority,
          recentAuthenticationAt: isoDateTime("2026-08-07T08:00:00.000Z"),
        },
        clinicalScope,
        authorityNow,
      ),
    ).toThrow(/stale/i);
    expect(() =>
      assertVerifiedClinicalClearance(
        {
          ...clinicalAuthority,
          verifiedAt: isoDateTime("2026-08-07T09:04:59.000Z"),
        },
        clinicalScope,
        authorityNow,
      ),
    ).toThrow(/timestamp/i);
    for (const substitutedScope of [
      { ...clinicalScope, workspaceId: entityId<"Workspace">("workspace_other_demo") },
      { ...clinicalScope, teamId: entityId<"Team">("team_other_clinical") },
      { ...clinicalScope, locationId: entityId<"Location">("location_other_hospital") },
    ]) {
      expect(() =>
        assertVerifiedClinicalClearance(clinicalAuthority, substitutedScope, authorityNow),
      ).toThrow(/exact patient scope/i);
    }
    expect(() =>
      transitionCareEnrollmentState("escalated", "resolve_escalation"),
    ).toThrow(/verified clinical authority/i);
    expect(() =>
      assertCareEnrollmentCanEnd("care_escalation_synthetic_open" as Parameters<typeof assertCareEnrollmentCanEnd>[0]),
    ).toThrow(/cannot end/i);
    expect(() =>
      transitionCareEnrollmentState("paused_by_operator", "end", {
        openEscalationId: "care_escalation_synthetic_open" as Parameters<typeof assertCareEnrollmentCanEnd>[0],
      }),
    ).toThrow(/cannot end/i);
    expect(
      transitionCareEnrollmentState("paused_by_operator", "end", {
        openEscalationId: null,
      }),
    ).toBe("ended");
  });

  it("treats every non-active legacy enrollment state as non-runnable", () => {
    const base = {
      id: entityId<"CareEnrollment">("care_enrollment_synthetic_001"),
      workspaceId: entityId<"Workspace">("workspace_safenet_demo"),
      pathwayId: entityId<"CarePathway">("care_pathway_synthetic_followup_v1"),
      pathwayProtocolVersion: "v1.0",
      contactId: entityId<"Contact">("contact_synthetic_001"),
      externalDischargeRef: externalReference("SYNTHETIC-DISCHARGE-001"),
      enrolledAt: isoDateTime("2026-08-07T08:00:00.000Z"),
      suppressionReasons: [],
      nextContactAt: null,
      synthetic: true,
      createdAt: isoDateTime("2026-08-07T08:00:00.000Z"),
      updatedAt: isoDateTime("2026-08-07T08:00:00.000Z"),
    } as const;
    expect(careEnrollmentMustPause({ ...base, state: "active" })).toBe(false);
    expect(careEnrollmentMustPause({ ...base, state: "paused" })).toBe(true);
    expect(careEnrollmentMustPause({ ...base, state: "withdrawn" })).toBe(true);
    expect(careEnrollmentMustPause({ ...base, state: "completed" })).toBe(true);
    expect(careEnrollmentMustPause({ ...base, state: "escalated" })).toBe(true);
  });
});

describe("persisted operational invariants", () => {
  it("enforces deterministic actor nullability and exact actor evidence", () => {
    expect(() => assertGovernedActor({ actorKind: "system", actorUid: null })).not.toThrow();
    expect(() =>
      assertGovernedActor({
        actorKind: "staff",
        actorUid: entityId<"User">("user_synthetic_operator"),
      }),
    ).not.toThrow();
    expect(() =>
      assertGovernedActor({
        actorKind: "system",
        actorUid: entityId<"User">("user_forged") as never,
      }),
    ).toThrow(/null actorUid/i);
    expect(() =>
      assertGovernedActor({ actorKind: "system", actorUid: null, extra: true } as never),
    ).toThrow(/exact/i);
  });

  it("requires staff lifecycle actors and state-dependent immutable approval evidence", () => {
    const automationBase = {
      id: "automation_definition_event_synthetic_001" as StaffSafeAutomationDefinitionEvent["id"],
      workspaceId: entityId<"Workspace">("workspace_safenet_demo"),
      family: "appointment_service" as const,
      definitionId: entityId<"AutomationDefinition">("automation_synthetic_appointment_v1"),
      definitionVersion: 3,
      definitionContentHash: sha256Digest(automationApprovedContentHash),
      definitionApprovalHash: null,
      definitionApprovalScope: null,
      definitionSecretBindingHash: sha256Digest(automationSecretBindingHash),
      revision: 1,
      auditEventId: entityId<"AuditEvent">("audit_automation_definition_lifecycle_001"),
      occurredAt: isoDateTime("2026-08-07T09:00:00.000Z"),
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
      actorKind: "staff" as const,
      actorUid: entityId<"User">("user_synthetic_automation_owner"),
    } as const;
    const automationApproval = {
      definitionApprovalHash: sha256Digest(automationApprovedApprovalHash),
      definitionApprovalScope: "simulation_only" as const,
    };
    const automationEvents = [
      {
        ...automationBase,
        eventType: "created",
        fromLifecycleState: null,
        toLifecycleState: "draft",
      },
      {
        ...automationBase,
        eventType: "review_requested",
        fromLifecycleState: "draft",
        toLifecycleState: "review_pending",
      },
      {
        ...automationBase,
        ...automationApproval,
        eventType: "approved",
        fromLifecycleState: "review_pending",
        toLifecycleState: "approved",
      },
      {
        ...automationBase,
        ...automationApproval,
        eventType: "activated",
        fromLifecycleState: "approved",
        toLifecycleState: "approved",
      },
      {
        ...automationBase,
        ...automationApproval,
        eventType: "retired",
        fromLifecycleState: "approved",
        toLifecycleState: "retired",
      },
      {
        ...automationBase,
        eventType: "retired",
        fromLifecycleState: "draft",
        toLifecycleState: "retired",
      },
    ] as const satisfies readonly StaffSafeAutomationDefinitionEvent[];
    automationEvents.forEach((event) =>
      expect(() => assertAutomationDefinitionEventBinding(event)).not.toThrow(),
    );
    expect(() =>
      assertAutomationDefinitionEventBinding({ ...automationEvents[0], revision: 0 }),
    ).toThrow(/revision/i);
    expect(() =>
      assertAutomationDefinitionEventBinding({
        ...automationEvents[0],
        occurredAt: "not-a-date" as never,
      }),
    ).toThrow(/occurredAt/i);
    expect(() =>
      assertAutomationDefinitionEventBinding({
        ...automationEvents[0],
        auditEventId: "bad audit id" as never,
      }),
    ).toThrow(/auditEventId/i);
    expect(() =>
      assertAutomationDefinitionEventBinding({
        ...automationEvents[0],
        ...automationApproval,
      }),
    ).toThrow(/draft/i);
    expect(() =>
      assertAutomationDefinitionEventBinding({
        ...automationEvents[1],
        ...automationApproval,
      }),
    ).toThrow(/review_pending/i);
    expect(() =>
      assertAutomationDefinitionEventBinding({
        ...automationEvents[2],
        definitionApprovalHash: null,
        definitionApprovalScope: null,
      }),
    ).toThrow(/approval evidence/i);
    expect(() =>
      assertAutomationDefinitionEventBinding({
        ...automationEvents[3],
        family: "feedback" as never,
      }),
    ).toThrow(/executable/i);
    expect(() =>
      assertAutomationDefinitionEventBinding({
        ...automationEvents[2],
        actorKind: "system",
        actorUid: null,
      } as unknown as StaffSafeAutomationDefinitionEvent),
    ).toThrow(/staff actor/i);
    expect(() =>
      assertAutomationDefinitionEventBinding({
        ...automationEvents[4],
        definitionApprovalHash: null,
        definitionApprovalScope: null,
      }),
    ).toThrow(/preserve approval evidence/i);
    expect(() =>
      assertAutomationDefinitionEventBinding({
        ...automationEvents[5],
        ...automationApproval,
      }),
    ).toThrow(/preserve approval evidence/i);

    const careBase = {
      id: "care_pathway_event_synthetic_001" as StaffSafeCarePathwayEvent["id"],
      workspaceId: entityId<"Workspace">("workspace_safenet_demo"),
      family: "post_discharge" as const,
      pathwayId: entityId<"CarePathway">("care_pathway_synthetic_followup_v1"),
      pathwayProtocolVersion: "v1.0",
      pathwayContentHash: sha256Digest(careApprovedContentHash),
      pathwayApprovalHash: null,
      pathwayApprovalScope: null,
      pathwaySecretBindingHash: sha256Digest(careSecretBindingHash),
      revision: 1,
      auditEventId: entityId<"AuditEvent">("audit_care_pathway_lifecycle_001"),
      occurredAt: isoDateTime("2026-08-07T09:00:00.000Z"),
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
      actorKind: "staff" as const,
      actorUid: entityId<"User">("user_synthetic_clinical_owner"),
    } as const;
    const careApproval = {
      pathwayApprovalHash: sha256Digest(careApprovedApprovalHash),
      pathwayApprovalScope: "clinical_simulation_only" as const,
    };
    const careEvents = [
      {
        ...careBase,
        eventType: "created",
        fromLifecycleState: null,
        toLifecycleState: "draft",
      },
      {
        ...careBase,
        eventType: "clinical_review_requested",
        fromLifecycleState: "draft",
        toLifecycleState: "clinical_review",
      },
      {
        ...careBase,
        ...careApproval,
        eventType: "approved",
        fromLifecycleState: "clinical_review",
        toLifecycleState: "approved",
      },
      {
        ...careBase,
        ...careApproval,
        eventType: "activated",
        fromLifecycleState: "approved",
        toLifecycleState: "approved",
      },
      {
        ...careBase,
        ...careApproval,
        eventType: "retired",
        fromLifecycleState: "approved",
        toLifecycleState: "retired",
      },
      {
        ...careBase,
        eventType: "retired",
        fromLifecycleState: "clinical_review",
        toLifecycleState: "retired",
      },
    ] as const satisfies readonly StaffSafeCarePathwayEvent[];
    careEvents.forEach((event) =>
      expect(() => assertCarePathwayEventBinding(event)).not.toThrow(),
    );
    expect(() =>
      assertCarePathwayEventBinding({ ...careEvents[0], revision: 0 }),
    ).toThrow(/revision/i);
    expect(() =>
      assertCarePathwayEventBinding({ ...careEvents[0], occurredAt: "not-a-date" as never }),
    ).toThrow(/occurredAt/i);
    expect(() =>
      assertCarePathwayEventBinding({ ...careEvents[0], auditEventId: "bad audit id" as never }),
    ).toThrow(/auditEventId/i);
    expect(() =>
      assertCarePathwayEventBinding({ ...careEvents[0], ...careApproval }),
    ).toThrow(/draft/i);
    expect(() =>
      assertCarePathwayEventBinding({ ...careEvents[1], ...careApproval }),
    ).toThrow(/clinical_review/i);
    expect(() =>
      assertCarePathwayEventBinding({
        ...careEvents[2],
        actorKind: "system",
        actorUid: null,
      } as unknown as StaffSafeCarePathwayEvent),
    ).toThrow(/staff actor/i);
    expect(() =>
      assertCarePathwayEventBinding({
        ...careEvents[4],
        pathwayApprovalHash: null,
        pathwayApprovalScope: null,
      }),
    ).toThrow(/preserve approval evidence/i);
    expect(() =>
      assertCarePathwayEventBinding({ ...careEvents[5], ...careApproval }),
    ).toThrow(/preserve approval evidence/i);
  });

  it("requires immutable actor, step, reason and escalation evidence on events", () => {
    const automationEvent = {
      id: "automation_run_event_synthetic_001" as StaffSafeAutomationRunEvent["id"],
      workspaceId: entityId<"Workspace">("workspace_safenet_demo"),
      runId: entityId<"AutomationRun">("automation_run_synthetic_001"),
      definitionId: entityId<"AutomationDefinition">("automation_synthetic_appointment_v1"),
      definitionVersion: 3,
      definitionContentHash: sha256Digest(automationApprovedContentHash),
      teamId: entityId<"Team">("team_synthetic_appointments"),
      locationId: entityId<"Location">("location_synthetic_wattala"),
      revision: 4,
      action: "exercise_fallback",
      fromState: "running",
      toState: "paused_by_operator",
      stepIndex: 0,
      stepId: sendStep.id,
      attemptNumber: 1,
      workItemId: "automation_work_item_synthetic_001" as StaffSafeAutomationRunEvent["workItemId"],
      nextEligibleAt: null,
      reasonCode: "fallback_policy_applied",
      evidenceFingerprint: hmacDigest("c".repeat(64)),
      outcomeCode: "fallback_work_item_created",
      auditEventId: entityId<"AuditEvent">("audit_automation_run_event_001"),
      occurredAt: isoDateTime("2026-08-07T09:04:00.000Z"),
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
      actorKind: "system",
      actorUid: null,
    } satisfies StaffSafeAutomationRunEvent;
    expect(() => assertAutomationRunEventTrace(automationEvent)).not.toThrow();
    const automationEventSecret = {
      workspaceId: automationEvent.workspaceId,
      runId: automationEvent.runId,
      eventId: automationEvent.id,
      protectedContextRef: encryptedValueRef("demo://automation/run-event/context-001"),
      contextFingerprint: automationEvent.evidenceFingerprint,
      schemaVersion: 1,
      synthetic: true,
    } satisfies AutomationRunEventSecretProjection;
    expect(() =>
      assertAutomationRunEventSecretBinding(automationEvent, automationEventSecret),
    ).not.toThrow();
    expect(() => assertAutomationRunEventSecretBinding(automationEvent, null)).toThrow(
      /required server-only evidence projection/i,
    );
    for (const substitutedSecret of [
      { ...automationEventSecret, workspaceId: entityId<"Workspace">("workspace_substituted") },
      { ...automationEventSecret, runId: entityId<"AutomationRun">("run_substituted") },
      {
        ...automationEventSecret,
        eventId: "automation_run_event_substituted" as StaffSafeAutomationRunEvent["id"],
      },
      { ...automationEventSecret, contextFingerprint: hmacDigest("d".repeat(64)) },
    ]) {
      expect(() =>
        assertAutomationRunEventSecretBinding(automationEvent, substitutedSecret),
      ).toThrow(/required server-only evidence projection/i);
    }
    expect(() =>
      assertAutomationRunEventTrace({
        ...automationEvent,
        evidenceFingerprint: undefined as never,
      }),
    ).toThrow(/evidenceFingerprint/i);
    expect(() => assertAutomationRunEventTrace({ ...automationEvent, revision: 0 })).toThrow(
      /revision/i,
    );
    expect(() =>
      assertAutomationRunEventTrace({ ...automationEvent, occurredAt: "invalid" as never }),
    ).toThrow(/occurredAt/i);
    expect(() =>
      assertAutomationRunEventTrace({ ...automationEvent, auditEventId: "bad audit id" as never }),
    ).toThrow(/auditEventId/i);
    expect(() =>
      assertAutomationRunEventTrace({ ...automationEvent, stepIndex: null, stepId: null }),
    ).toThrow(/step evidence/i);
    const humanEvent = {
      ...automationEvent,
      id: "automation_run_event_synthetic_002" as StaffSafeAutomationRunEvent["id"],
      action: "simulate_human_takeover" as const,
      toState: "paused_for_human" as const,
      stepIndex: null,
      stepId: null,
      attemptNumber: 0,
      workItemId: "automation_work_item_synthetic_002" as StaffSafeAutomationRunEvent["workItemId"],
      reasonCode: "human_takeover" as const,
      outcomeCode: "human_takeover_required" as const,
    } satisfies StaffSafeAutomationRunEvent;
    expect(() => assertAutomationRunEventTrace(humanEvent)).not.toThrow();
    expect(() =>
      assertAutomationRunEventTrace({
        ...humanEvent,
        stepIndex: 0,
        stepId: sendStep.id,
      }),
    ).toThrow(/step-scoped/i);
    expect(() =>
      assertAutomationRunEventTrace({ ...humanEvent, attemptNumber: 1 }),
    ).toThrow(/attemptNumber/i);
    expect(() =>
      assertAutomationRunEventTrace({ ...humanEvent, workItemId: null }),
    ).toThrow(/require exactly one workItemId/i);
    expect(() =>
      assertAutomationRunEventTrace({ ...humanEvent, action: "pause" }),
    ).toThrow();

    const careEvent = {
      id: "care_event_synthetic_001" as StaffSafeCareEnrollmentEvent["id"],
      workspaceId: entityId<"Workspace">("workspace_safenet_demo"),
      enrollmentId: entityId<"CareEnrollment">("care_enrollment_synthetic_001"),
      pathwayId: entityId<"CarePathway">("care_pathway_synthetic_followup_v1"),
      pathwayProtocolVersion: "v1.0",
      pathwayContentHash: sha256Digest(careApprovedContentHash),
      teamId: entityId<"Team">("team_synthetic_clinical_escalation"),
      locationId: entityId<"Location">("location_synthetic_wattala"),
      revision: 2,
      action: "raise_red_flag",
      fromState: "active",
      toState: "escalated",
      contactPointIndex: null,
      suppressionReason: null,
      escalationId: "care_escalation_synthetic_001" as StaffSafeCareEnrollmentEvent["escalationId"],
      escalationStateBefore: null,
      escalationStateAfter: "open",
      handoffId: null,
      activeSuppressionsAfter: [],
      nextContactAt: isoDateTime("2026-08-08T09:00:00.000Z"),
      outcomeCode: "red_flag_escalated",
      auditEventId: entityId<"AuditEvent">("audit_care_enrollment_event_001"),
      occurredAt: isoDateTime("2026-08-07T09:06:00.000Z"),
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
      actorKind: "system",
      actorUid: null,
    } satisfies StaffSafeCareEnrollmentEvent;
    expect(() => assertCareEnrollmentEventTrace(careEvent)).not.toThrow();
    expect(() => assertCareEnrollmentEventTrace({ ...careEvent, revision: 0 })).toThrow(
      /revision/i,
    );
    expect(() =>
      assertCareEnrollmentEventTrace({ ...careEvent, occurredAt: "invalid" as never }),
    ).toThrow(/occurredAt/i);
    expect(() =>
      assertCareEnrollmentEventTrace({ ...careEvent, auditEventId: "bad audit id" as never }),
    ).toThrow(/auditEventId/i);
    expect(() =>
      assertCareEnrollmentEventTrace({ ...careEvent, escalationId: null }),
    ).toThrow(/escalationId/i);
  });

  it("enforces the complete automation action, state, outcome, reason and actor matrix", () => {
    const rows = [
      ["start", "queued", "running", "accepted", "trigger_accepted", false, false],
      ["advance_step", "running", "running", "step_completed", "step_policy_applied", true, false],
      ["advance_step", "waiting", "waiting", "wait_scheduled", "step_policy_applied", true, false],
      ["advance_step", "running", "completed", "completed", "policy_complete", true, false],
      ["pause", "running", "paused_by_operator", "accepted", "operator_requested", false, false],
      ["pause", "waiting", "paused_by_operator", "accepted", "operator_requested", false, false],
      ["resume", "paused_by_operator", "running", "accepted", "operator_requested", false, false],
      [
        "simulate_human_takeover",
        "running",
        "paused_for_human",
        "human_takeover_required",
        "human_takeover",
        false,
        true,
      ],
      [
        "simulate_human_takeover",
        "waiting",
        "paused_for_human",
        "human_takeover_required",
        "human_takeover",
        false,
        true,
      ],
      [
        "release_human_takeover",
        "paused_for_human",
        "paused_by_operator",
        "accepted",
        "human_takeover",
        false,
        true,
      ],
      [
        "exercise_fallback",
        "running",
        "paused_by_operator",
        "fallback_work_item_created",
        "fallback_policy_applied",
        true,
        true,
      ],
      [
        "exercise_fallback",
        "waiting",
        "paused_for_human",
        "human_takeover_required",
        "fallback_policy_applied",
        true,
        true,
      ],
      [
        "exercise_fallback",
        "running",
        "ended",
        "fallback_stopped_safely",
        "fallback_policy_applied",
        true,
        false,
      ],
      [
        "exercise_fallback",
        "failed",
        "ended",
        "fallback_stopped_safely",
        "fallback_policy_applied",
        true,
        true,
      ],
      [
        "inject_failure",
        "running",
        "failed",
        "synthetic_failure",
        "synthetic_failure",
        true,
        true,
      ],
      ["retry", "failed", "waiting", "retry_scheduled", "retry_policy_applied", true, true],
      ["end", "running", "ended", "ended_by_operator", "operator_requested", false, false],
    ] as const;
    const staffOnly = new Set([
      "pause",
      "resume",
      "release_human_takeover",
      "retry",
      "end",
    ]);

    rows.forEach(([action, fromState, toState, outcomeCode, reasonCode, hasStep, hasWorkItem], index) => {
      const event = {
        id: `automation_run_event_matrix_${index}` as StaffSafeAutomationRunEvent["id"],
        workspaceId: entityId<"Workspace">("workspace_safenet_demo"),
        runId: entityId<"AutomationRun">("automation_run_synthetic_matrix"),
        definitionId: entityId<"AutomationDefinition">("automation_synthetic_appointment_v1"),
        definitionVersion: 3,
        definitionContentHash: sha256Digest(automationApprovedContentHash),
        teamId: entityId<"Team">("team_synthetic_appointments"),
        locationId: entityId<"Location">("location_synthetic_wattala"),
        revision: index + 1,
        action,
        fromState,
        toState,
        stepIndex: hasStep ? 0 : null,
        stepId: hasStep ? sendStep.id : null,
        attemptNumber: hasStep ? 1 : 0,
        workItemId: hasWorkItem
          ? (`automation_work_item_matrix_${index}` as NonNullable<
              StaffSafeAutomationRunEvent["workItemId"]
            >)
          : null,
        nextEligibleAt:
          toState === "waiting" ||
          (fromState === "waiting" &&
            (toState === "paused_by_operator" || toState === "paused_for_human"))
            ? isoDateTime("2026-08-07T09:20:00.000Z")
            : null,
        reasonCode,
        evidenceFingerprint: hmacDigest("c".repeat(64)),
        outcomeCode,
        auditEventId: entityId<"AuditEvent">(`audit_automation_run_matrix_${index}`),
        occurredAt: isoDateTime("2026-08-07T09:12:00.000Z"),
        schemaVersion: 1,
        synthetic: true,
        externalDispatchCount: 0,
        networkCallCount: 0,
        actorKind: "staff",
        actorUid: entityId<"User">("user_synthetic_operator"),
      } satisfies StaffSafeAutomationRunEvent;
      expect(() => assertAutomationRunEventTrace(event)).not.toThrow();
      if (event.nextEligibleAt !== null) {
        expect(() =>
          assertAutomationRunEventTrace({ ...event, nextEligibleAt: null }),
        ).toThrow(/nextEligibleAt/i);
        expect(() =>
          assertAutomationRunEventTrace({ ...event, nextEligibleAt: "invalid" as never }),
        ).toThrow(/canonical ISO/i);
      }
      expect(() =>
        assertAutomationRunEventTrace({ ...event, fromState: "completed" }),
      ).toThrow();
      expect(() =>
        assertAutomationRunEventTrace({
          ...event,
          toState: (event.toState === "ended" ? "completed" : "ended") as typeof event.toState,
        }),
      ).toThrow();
      expect(() =>
        assertAutomationRunEventTrace({
          ...event,
          outcomeCode: (event.outcomeCode === "accepted" ? "completed" : "accepted") as typeof event.outcomeCode,
        }),
      ).toThrow();
      expect(() =>
        assertAutomationRunEventTrace({
          ...event,
          reasonCode: "synthetic_test",
        }),
      ).toThrow();
      if (staffOnly.has(action)) {
        expect(() =>
          assertAutomationRunEventTrace({
            ...event,
            actorKind: "system",
            actorUid: null,
          } as StaffSafeAutomationRunEvent),
        ).toThrow(/staff actor/i);
      }
      if (action === "exercise_fallback" && fromState === "failed") {
        expect(() =>
          assertAutomationRunEventTrace({
            ...event,
            actorKind: "system",
            actorUid: null,
          } as StaffSafeAutomationRunEvent),
        ).toThrow(/staff actor/i);
      }
    });
  });

  it("enforces the complete care action, state, outcome, linked-field and actor matrix", () => {
    const rows = [
      ["start", "queued", "active", "accepted", null, null, false],
      ["advance_contact", "active", "active", "contact_advanced", null, null, true],
      ["advance_contact", "active", "completed", "completed", null, null, true],
      ["pause", "active", "paused_by_operator", "accepted", null, null, false],
      ["resume", "paused_by_operator", "active", "accepted", null, null, false],
      ["end", "active", "ended", "ended_by_operator", null, null, false],
      [
        "simulate_suppression",
        "active",
        "paused_for_safety",
        "clinical_hold_applied",
        "clinical_hold",
        null,
        false,
      ],
      [
        "simulate_suppression",
        "active",
        "ended",
        "suppressed_terminal",
        "readmission",
        null,
        false,
      ],
      [
        "simulate_suppression",
        "escalated",
        "escalated",
        "clinical_hold_applied",
        "clinical_hold",
        "care_escalation_synthetic_matrix",
        false,
      ],
      [
        "human_takeover_started",
        "active",
        "paused_for_human",
        "human_takeover_required",
        null,
        null,
        false,
      ],
      [
        "release_human_takeover",
        "paused_for_human",
        "paused_by_operator",
        "accepted",
        null,
        null,
        false,
      ],
      [
        "clear_clinical_hold",
        "paused_for_safety",
        "paused_by_operator",
        "safety_hold_cleared",
        null,
        null,
        false,
      ],
      [
        "raise_red_flag",
        "active",
        "escalated",
        "red_flag_escalated",
        null,
        "care_escalation_synthetic_matrix",
        false,
      ],
      [
        "acknowledge_escalation",
        "escalated",
        "escalated",
        "escalation_acknowledged",
        null,
        "care_escalation_synthetic_matrix",
        false,
      ],
      [
        "resolve_escalation",
        "escalated",
        "paused_for_safety",
        "escalation_resolved_safety_hold",
        null,
        "care_escalation_synthetic_matrix",
        false,
      ],
      [
        "resolve_escalation",
        "escalated",
        "ended",
        "escalation_resolved_terminal_suppression",
        null,
        "care_escalation_synthetic_matrix",
        false,
      ],
      [
        "clear_safety_hold",
        "paused_for_safety",
        "paused_by_operator",
        "safety_hold_cleared",
        null,
        "care_escalation_synthetic_matrix",
        false,
      ],
    ] as const;
    const staffOnly = new Set([
      "pause",
      "resume",
      "end",
      "release_human_takeover",
      "clear_clinical_hold",
      "acknowledge_escalation",
      "resolve_escalation",
      "clear_safety_hold",
    ]);

    rows.forEach(
      ([action, fromState, toState, outcomeCode, suppressionReason, escalationId, hasContact], index) => {
        const event = {
          id: `care_event_matrix_${index}` as StaffSafeCareEnrollmentEvent["id"],
          workspaceId: entityId<"Workspace">("workspace_safenet_demo"),
          enrollmentId: entityId<"CareEnrollment">("care_enrollment_synthetic_matrix"),
          pathwayId: entityId<"CarePathway">("care_pathway_synthetic_followup_v1"),
          pathwayProtocolVersion: "v1.0",
          pathwayContentHash: sha256Digest(careApprovedContentHash),
          teamId: entityId<"Team">("team_synthetic_clinical_escalation"),
          locationId: entityId<"Location">("location_synthetic_wattala"),
          revision: index + 1,
          action,
          fromState,
          toState,
          contactPointIndex: hasContact ? 0 : null,
          suppressionReason,
          escalationId: escalationId as StaffSafeCareEnrollmentEvent["escalationId"],
          escalationStateBefore:
            action === "raise_red_flag"
              ? null
              : action === "acknowledge_escalation"
                ? "open"
                : action === "resolve_escalation"
                  ? "acknowledged"
                  : action === "clear_safety_hold"
                    ? "resolved"
                    : action === "simulate_suppression" && fromState === "escalated"
                      ? "open"
                      : null,
          escalationStateAfter:
            action === "raise_red_flag"
              ? "open"
              : action === "acknowledge_escalation"
                ? "acknowledged"
                : action === "resolve_escalation" || action === "clear_safety_hold"
                  ? "resolved"
                  : action === "simulate_suppression" && fromState === "escalated"
                    ? "open"
                    : null,
          handoffId:
            action === "human_takeover_started" ||
            action === "release_human_takeover"
              ? ("care_handoff_synthetic_matrix" as StaffSafeCareEnrollmentEvent["handoffId"])
              : null,
          activeSuppressionsAfter:
            action === "simulate_suppression"
              ? [suppressionReason!]
              : action === "resolve_escalation" &&
                  outcomeCode === "escalation_resolved_terminal_suppression"
                ? ["readmission"]
                : [],
          nextContactAt:
            toState === "completed" || toState === "ended"
              ? null
              : isoDateTime("2026-08-08T09:00:00.000Z"),
          outcomeCode,
          auditEventId: entityId<"AuditEvent">(`audit_care_enrollment_matrix_${index}`),
          occurredAt: isoDateTime("2026-08-07T09:14:00.000Z"),
          schemaVersion: 1,
          synthetic: true,
          externalDispatchCount: 0,
          networkCallCount: 0,
          actorKind: "staff",
          actorUid: entityId<"User">("user_synthetic_clinical_approver"),
        } satisfies StaffSafeCareEnrollmentEvent;
        expect(() => assertCareEnrollmentEventTrace(event)).not.toThrow();
        expect(() =>
          assertCareEnrollmentEventTrace({ ...event, fromState: "completed" }),
        ).toThrow();
        expect(() =>
          assertCareEnrollmentEventTrace({
            ...event,
            toState: (event.toState === "ended" ? "completed" : "ended") as typeof event.toState,
          }),
        ).toThrow();
        expect(() =>
          assertCareEnrollmentEventTrace({
            ...event,
            outcomeCode: (event.outcomeCode === "accepted" ? "completed" : "accepted") as typeof event.outcomeCode,
          }),
        ).toThrow();
        if (staffOnly.has(action)) {
          expect(() =>
            assertCareEnrollmentEventTrace({
              ...event,
              actorKind: "system",
              actorUid: null,
            } as StaffSafeCareEnrollmentEvent),
          ).toThrow(/staff actor/i);
        }
      },
    );
  });

  it("freezes work-item SLA and lifecycle evidence", () => {
    const item = {
      state: "resolved" as const,
      openedAt: isoDateTime("2026-08-07T09:00:00.000Z"),
      slaMinutes: 15,
      dueAt: isoDateTime("2026-08-07T09:15:00.000Z"),
      acknowledgedAt: isoDateTime("2026-08-07T09:05:00.000Z"),
      acknowledgedByUid: entityId<"User">("user_synthetic_operator"),
      resolvedAt: isoDateTime("2026-08-07T09:08:00.000Z"),
      resolvedByUid: entityId<"User">("user_synthetic_operator"),
      resolutionCode: "routed_to_human" as const,
    };
    expect(() => assertAutomationWorkItemLifecycle(item)).not.toThrow();
    expect(() =>
      assertAutomationWorkItemLifecycle({
        ...item,
        dueAt: isoDateTime("2026-08-07T09:14:00.000Z"),
      }),
    ).toThrow(/frozen SLA/i);
    expect(() =>
      assertAutomationWorkItemLifecycle({ ...item, acknowledgedAt: "invalid" as never }),
    ).toThrow(/canonical ISO/i);
    expect(() =>
      assertAutomationWorkItemLifecycle({ ...item, openedAt: "2026-08-07 09:00:00Z" as never }),
    ).toThrow(/canonical ISO/i);
  });

  it("atomically binds approved step progress, wait timing, retries and work-item resolution", () => {
    const plusSeconds = (value: string, seconds: number) =>
      isoDateTime(new Date(Date.parse(value) + seconds * 1_000).toISOString());
    const runId = entityId<"AutomationRun">("automation_run_operational_001");
    const workItemId =
      "automation_work_item_operational_001" as StaffSafeAutomationWorkItem["id"];
    const definition = {
      id: entityId<"AutomationDefinition">(automationContent.definitionId),
      version: automationContent.version,
      contentHash: sha256Digest(automationApprovedContentHash),
      steps: [sendStep, waitStep],
    } as const;
    const running = {
      id: runId,
      workspaceId: entityId<"Workspace">("workspace_safenet_demo"),
      definitionId: definition.id,
      definitionVersion: definition.version,
      definitionContentHash: definition.contentHash,
      teamId: entityId<"Team">("team_synthetic_appointments"),
      locationId: entityId<"Location">("location_synthetic_wattala"),
      state: "running",
      pausedFromState: null,
      nextEligibleAt: null,
      currentStepIndex: 0,
      completedStepCount: 0,
      attemptCount: 0,
      outcomeCode: "accepted",
      revision: 1,
      openWorkItemId: null,
      lastEventId: null,
      createdAt: isoDateTime("2026-08-07T09:00:00.000Z"),
      updatedAt: isoDateTime("2026-08-07T09:00:00.000Z"),
    } satisfies AutomationRunOperationalSnapshot;
    const failureEvent = {
      id: "automation_run_event_failure_001" as StaffSafeAutomationRunEvent["id"],
      workspaceId: running.workspaceId,
      runId,
      definitionId: definition.id,
      definitionVersion: definition.version,
      definitionContentHash: definition.contentHash,
      teamId: running.teamId,
      locationId: running.locationId,
      revision: 2,
      auditEventId: entityId<"AuditEvent">("audit_automation_failure_001"),
      action: "inject_failure",
      fromState: "running",
      toState: "failed",
      stepIndex: 0,
      stepId: sendStep.id,
      attemptNumber: 1,
      workItemId,
      nextEligibleAt: null,
      reasonCode: "integration_timeout",
      evidenceFingerprint: hmacDigest("c".repeat(64)),
      outcomeCode: "synthetic_failure",
      occurredAt: isoDateTime("2026-08-07T09:01:00.000Z"),
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
      actorKind: "system",
      actorUid: null,
    } satisfies StaffSafeAutomationRunEvent;
    const failed = {
      ...running,
      state: "failed",
      attemptCount: 1,
      outcomeCode: failureEvent.outcomeCode,
      revision: 2,
      openWorkItemId: workItemId,
      lastEventId: failureEvent.id,
      updatedAt: failureEvent.occurredAt,
    } satisfies AutomationRunOperationalSnapshot;
    const openFailureItem = {
      id: workItemId,
      workspaceId: running.workspaceId,
      runId,
      definitionId: definition.id,
      definitionVersion: definition.version,
      definitionContentHash: definition.contentHash,
      teamId: running.teamId,
      locationId: running.locationId,
      reasonCode: "integration_timeout",
      state: "open",
      openedAt: failureEvent.occurredAt,
      slaMinutes: 15,
      dueAt: plusSeconds(failureEvent.occurredAt, 15 * 60),
      assignedMemberUid: null,
      acknowledgedAt: null,
      acknowledgedByUid: null,
      resolvedAt: null,
      resolvedByUid: null,
      resolutionCode: null,
      revision: 1,
      lastEventId: failureEvent.id,
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
      createdAt: failureEvent.occurredAt,
      updatedAt: failureEvent.occurredAt,
    } satisfies StaffSafeAutomationWorkItem;
    expect(() =>
      assertAutomationRunOperationalTransition(running, failed, failureEvent, definition, {
        previous: null,
        next: openFailureItem,
      }),
    ).not.toThrow();
    expect(() =>
      assertAutomationRunOperationalTransition(running, failed, failureEvent, definition, {
        previous: openFailureItem,
        next: openFailureItem,
      }),
    ).toThrow(/existence.*prior run pointer/i);
    expect(() =>
      assertAutomationRunOperationalTransition(running, failed, failureEvent, definition, {
        previous: null,
        next: {
          ...openFailureItem,
          assignedMemberUid: entityId<"User">("user_assignment_without_event"),
        },
      }),
    ).toThrow(/creation/i);

    const retryAt = isoDateTime("2026-08-07T09:02:00.000Z");
    const retryDueAt = plusSeconds(retryAt, sendStep.retryInitialBackoffSeconds);
    const retryEvent = {
      ...failureEvent,
      id: "automation_run_event_retry_001" as StaffSafeAutomationRunEvent["id"],
      revision: 3,
      auditEventId: entityId<"AuditEvent">("audit_automation_retry_001"),
      action: "retry",
      fromState: "failed",
      toState: "waiting",
      attemptNumber: 2,
      nextEligibleAt: retryDueAt,
      reasonCode: "retry_policy_applied",
      outcomeCode: "retry_scheduled",
      occurredAt: retryAt,
      actorKind: "staff",
      actorUid: entityId<"User">("user_synthetic_operator"),
    } satisfies StaffSafeAutomationRunEvent;
    const retryWaiting = {
      ...failed,
      state: "waiting",
      nextEligibleAt: retryDueAt,
      outcomeCode: retryEvent.outcomeCode,
      revision: 3,
      openWorkItemId: null,
      lastEventId: retryEvent.id,
      updatedAt: retryEvent.occurredAt,
    } satisfies AutomationRunOperationalSnapshot;
    const resolvedFailureItem = {
      ...openFailureItem,
      state: "resolved",
      acknowledgedAt: retryEvent.occurredAt,
      acknowledgedByUid: retryEvent.actorUid,
      resolvedAt: retryEvent.occurredAt,
      resolvedByUid: retryEvent.actorUid,
      resolutionCode: "retried",
      revision: 2,
      lastEventId: retryEvent.id,
      updatedAt: retryEvent.occurredAt,
    } satisfies StaffSafeAutomationWorkItem;
    expect(() =>
      assertAutomationRunOperationalTransition(failed, retryWaiting, retryEvent, definition, {
        previous: openFailureItem,
        next: resolvedFailureItem,
      }),
    ).not.toThrow();
    expect(() =>
      assertAutomationRunOperationalTransition(failed, retryWaiting, retryEvent, definition, {
        previous: resolvedFailureItem,
        next: resolvedFailureItem,
      }),
    ).toThrow(/already-resolved/i);
    expect(() =>
      assertAutomationRunOperationalTransition(
        failed,
        { ...retryWaiting, nextEligibleAt: plusSeconds(retryDueAt, 1) },
        { ...retryEvent, nextEligibleAt: plusSeconds(retryDueAt, 1) },
        definition,
        { previous: openFailureItem, next: resolvedFailureItem },
      ),
    ).toThrow(/approved schedule/i);
    for (const pollutedItem of [
      { ...resolvedFailureItem, resolutionCode: "stopped_safely" as const },
      { ...resolvedFailureItem, revision: 3 },
      {
        ...resolvedFailureItem,
        lastEventId: "automation_run_event_wrong" as StaffSafeAutomationRunEvent["id"],
      },
      { ...resolvedFailureItem, reasonCode: "synthetic_failure" as const },
      { ...resolvedFailureItem, slaMinutes: 14 },
      { ...resolvedFailureItem, openedAt: plusSeconds(openFailureItem.openedAt, 1) },
      { ...resolvedFailureItem, assignedMemberUid: entityId<"User">("user_rewritten") },
    ]) {
      expect(() =>
        assertAutomationRunOperationalTransition(failed, retryWaiting, retryEvent, definition, {
          previous: openFailureItem,
          next: pollutedItem,
        }),
      ).toThrow();
    }
    expect(() =>
      assertAutomationRunEventTrace({
        ...retryEvent,
        actorKind: "system",
        actorUid: null,
      } as StaffSafeAutomationRunEvent),
    ).toThrow(/staff actor/i);

    const maxRetryStep = {
      ...sendStep,
      retryMaxAttempts: 10,
      retryInitialBackoffSeconds: 1,
      retryMaximumBackoffSeconds: 8,
    } satisfies AuthoritativeAutomationStep;
    const maxRetryDefinition = { ...definition, steps: [maxRetryStep, waitStep] } as const;
    const exhausted = { ...failed, attemptCount: 10 };
    const maxRetryAt = isoDateTime("2026-08-07T09:03:00.000Z");
    const maxRetryEvent = {
      ...retryEvent,
      id: "automation_run_event_retry_010" as StaffSafeAutomationRunEvent["id"],
      auditEventId: entityId<"AuditEvent">("audit_automation_retry_010"),
      attemptNumber: 11,
      nextEligibleAt: plusSeconds(maxRetryAt, 8),
      occurredAt: maxRetryAt,
    } satisfies StaffSafeAutomationRunEvent;
    const maxRetryWaiting = {
      ...retryWaiting,
      attemptCount: 10,
      nextEligibleAt: maxRetryEvent.nextEligibleAt,
      lastEventId: maxRetryEvent.id,
      updatedAt: maxRetryEvent.occurredAt,
    };
    const maxResolvedItem = {
      ...resolvedFailureItem,
      acknowledgedAt: maxRetryEvent.occurredAt,
      acknowledgedByUid: maxRetryEvent.actorUid,
      resolvedAt: maxRetryEvent.occurredAt,
      resolvedByUid: maxRetryEvent.actorUid,
      lastEventId: maxRetryEvent.id,
      updatedAt: maxRetryEvent.occurredAt,
    };
    expect(() =>
      assertAutomationRunOperationalTransition(
        exhausted,
        maxRetryWaiting,
        maxRetryEvent,
        maxRetryDefinition,
        { previous: openFailureItem, next: maxResolvedItem },
      ),
    ).not.toThrow();
    expect(() =>
      assertAutomationRunOperationalTransition(
        failed,
        retryWaiting,
        retryEvent,
        { ...definition, steps: [{ ...sendStep, retryMaxAttempts: 0 }, waitStep] },
        { previous: openFailureItem, next: resolvedFailureItem },
      ),
    ).toThrow(/retry policy/i);
    expect(() =>
      assertAutomationRunEventTrace({ ...maxRetryEvent, attemptNumber: 12 }),
    ).toThrow(/attemptNumber/i);

    const waitRunning = {
      ...running,
      currentStepIndex: 1,
      completedStepCount: 1,
      revision: 4,
      lastEventId: "automation_run_event_send_complete" as StaffSafeAutomationRunEvent["id"],
      updatedAt: isoDateTime("2026-08-07T09:10:00.000Z"),
    } satisfies AutomationRunOperationalSnapshot;
    const waitAt = isoDateTime("2026-08-07T10:00:00.000Z");
    const waitDueAt = plusSeconds(waitAt, waitStep.waitSeconds!);
    const waitEvent = {
      ...failureEvent,
      id: "automation_run_event_wait_001" as StaffSafeAutomationRunEvent["id"],
      revision: 5,
      auditEventId: entityId<"AuditEvent">("audit_automation_wait_001"),
      action: "advance_step",
      fromState: "running",
      toState: "waiting",
      stepIndex: 1,
      stepId: waitStep.id,
      attemptNumber: 1,
      workItemId: null,
      nextEligibleAt: waitDueAt,
      reasonCode: "step_policy_applied",
      outcomeCode: "wait_scheduled",
      occurredAt: waitAt,
    } satisfies StaffSafeAutomationRunEvent;
    const waitingOnApprovedStep = {
      ...waitRunning,
      state: "waiting",
      nextEligibleAt: waitDueAt,
      attemptCount: 1,
      outcomeCode: waitEvent.outcomeCode,
      revision: 5,
      lastEventId: waitEvent.id,
      updatedAt: waitEvent.occurredAt,
    } satisfies AutomationRunOperationalSnapshot;
    expect(() =>
      assertAutomationRunOperationalTransition(
        waitRunning,
        waitingOnApprovedStep,
        waitEvent,
        definition,
      ),
    ).not.toThrow();
    expect(() =>
      assertAutomationRunOperationalTransition(
        waitRunning,
        { ...waitingOnApprovedStep, nextEligibleAt: plusSeconds(waitDueAt, 1) },
        { ...waitEvent, nextEligibleAt: plusSeconds(waitDueAt, 1) },
        definition,
      ),
    ).toThrow(/approved schedule/i);
    const nonWaitScheduleEvent = {
      ...waitEvent,
      id: "automation_run_event_invalid_non_wait" as StaffSafeAutomationRunEvent["id"],
      revision: 2,
      auditEventId: entityId<"AuditEvent">("audit_automation_invalid_non_wait"),
      stepIndex: 0,
      stepId: sendStep.id,
      occurredAt: isoDateTime("2026-08-07T09:01:00.000Z"),
      nextEligibleAt: isoDateTime("2026-08-07T10:01:00.000Z"),
    } satisfies StaffSafeAutomationRunEvent;
    expect(() =>
      assertAutomationRunOperationalTransition(
        running,
        {
          ...running,
          state: "waiting",
          attemptCount: 1,
          nextEligibleAt: nonWaitScheduleEvent.nextEligibleAt,
          outcomeCode: nonWaitScheduleEvent.outcomeCode,
          revision: 2,
          lastEventId: nonWaitScheduleEvent.id,
          updatedAt: nonWaitScheduleEvent.occurredAt,
        },
        nonWaitScheduleEvent,
        definition,
      ),
    ).toThrow(/wait step/i);

    const completeWaitEvent = {
      ...waitEvent,
      id: "automation_run_event_wait_complete_001" as StaffSafeAutomationRunEvent["id"],
      revision: 6,
      auditEventId: entityId<"AuditEvent">("audit_automation_wait_complete_001"),
      fromState: "waiting",
      toState: "completed",
      nextEligibleAt: null,
      outcomeCode: "completed",
      reasonCode: "policy_complete",
      occurredAt: waitDueAt,
    } satisfies StaffSafeAutomationRunEvent;
    const completed = {
      ...waitingOnApprovedStep,
      state: "completed",
      nextEligibleAt: null,
      currentStepIndex: 2,
      completedStepCount: 2,
      attemptCount: 0,
      outcomeCode: completeWaitEvent.outcomeCode,
      revision: 6,
      lastEventId: completeWaitEvent.id,
      updatedAt: completeWaitEvent.occurredAt,
    } satisfies AutomationRunOperationalSnapshot;
    expect(() =>
      assertAutomationRunOperationalTransition(
        waitingOnApprovedStep,
        completed,
        completeWaitEvent,
        definition,
      ),
    ).not.toThrow();
    const earlyWaitCompletionEvent = {
      ...completeWaitEvent,
      occurredAt: isoDateTime("2026-08-07T10:59:59.000Z"),
    };
    expect(() =>
      assertAutomationRunOperationalTransition(
        waitingOnApprovedStep,
        { ...completed, updatedAt: earlyWaitCompletionEvent.occurredAt },
        earlyWaitCompletionEvent,
        definition,
      ),
    ).toThrow(/before nextEligibleAt/i);
    const earlyCompleteEvent = {
      ...completeWaitEvent,
      id: "automation_run_event_early_complete" as StaffSafeAutomationRunEvent["id"],
      revision: 2,
      auditEventId: entityId<"AuditEvent">("audit_automation_early_complete"),
      fromState: "running",
      stepIndex: 0,
      stepId: sendStep.id,
      occurredAt: isoDateTime("2026-08-07T09:01:00.000Z"),
    } satisfies StaffSafeAutomationRunEvent;
    expect(() =>
      assertAutomationRunOperationalTransition(
        running,
        {
          ...running,
          state: "completed",
          currentStepIndex: 2,
          completedStepCount: 2,
          outcomeCode: earlyCompleteEvent.outcomeCode,
          revision: 2,
          lastEventId: earlyCompleteEvent.id,
          updatedAt: earlyCompleteEvent.occurredAt,
        },
        earlyCompleteEvent,
        definition,
      ),
    ).toThrow(/final approved step/i);
    expect(() =>
      assertAutomationRunOperationalTransition(
        waitingOnApprovedStep,
        { ...completed, state: "running", outcomeCode: "step_completed" },
        {
          ...completeWaitEvent,
          toState: "running",
          outcomeCode: "step_completed",
          reasonCode: "step_policy_applied",
        },
        definition,
      ),
    ).toThrow(/approved step sequence|final approved step/i);

    const pauseWaitEvent = {
      ...waitEvent,
      id: "automation_run_event_pause_wait_001" as StaffSafeAutomationRunEvent["id"],
      revision: 6,
      auditEventId: entityId<"AuditEvent">("audit_automation_pause_wait_001"),
      action: "pause",
      fromState: "waiting",
      toState: "paused_by_operator",
      stepIndex: null,
      stepId: null,
      attemptNumber: 0,
      nextEligibleAt: waitDueAt,
      reasonCode: "operator_requested",
      outcomeCode: "accepted",
      occurredAt: plusSeconds(waitEvent.occurredAt, 60),
      actorKind: "staff",
      actorUid: entityId<"User">("user_synthetic_operator"),
    } satisfies StaffSafeAutomationRunEvent;
    const pausedWait = {
      ...waitingOnApprovedStep,
      state: "paused_by_operator",
      pausedFromState: "waiting",
      outcomeCode: pauseWaitEvent.outcomeCode,
      revision: 6,
      lastEventId: pauseWaitEvent.id,
      updatedAt: pauseWaitEvent.occurredAt,
    } satisfies AutomationRunOperationalSnapshot;
    expect(() =>
      assertAutomationRunOperationalTransition(
        waitingOnApprovedStep,
        pausedWait,
        pauseWaitEvent,
        definition,
      ),
    ).not.toThrow();
    expect(() =>
      assertAutomationRunOperationalTransition(
        waitingOnApprovedStep,
        { ...pausedWait, nextEligibleAt: plusSeconds(waitDueAt, 1) },
        { ...pauseWaitEvent, nextEligibleAt: plusSeconds(waitDueAt, 1) },
        definition,
      ),
    ).toThrow(/approved schedule/i);

    const takeoverItemId =
      "automation_work_item_takeover_wait_001" as StaffSafeAutomationWorkItem["id"];
    const takeoverEvent = {
      ...pauseWaitEvent,
      id: "automation_run_event_takeover_wait_001" as StaffSafeAutomationRunEvent["id"],
      auditEventId: entityId<"AuditEvent">("audit_automation_takeover_wait_001"),
      action: "simulate_human_takeover",
      toState: "paused_for_human",
      workItemId: takeoverItemId,
      reasonCode: "human_takeover",
      outcomeCode: "human_takeover_required",
      actorKind: "system",
      actorUid: null,
    } satisfies StaffSafeAutomationRunEvent;
    const humanPausedWait = {
      ...pausedWait,
      state: "paused_for_human",
      openWorkItemId: takeoverItemId,
      outcomeCode: takeoverEvent.outcomeCode,
      lastEventId: takeoverEvent.id,
      updatedAt: takeoverEvent.occurredAt,
    } satisfies AutomationRunOperationalSnapshot;
    const takeoverItem = {
      ...openFailureItem,
      id: takeoverItemId,
      reasonCode: "human_takeover",
      openedAt: takeoverEvent.occurredAt,
      dueAt: plusSeconds(takeoverEvent.occurredAt, 15 * 60),
      lastEventId: takeoverEvent.id,
      createdAt: takeoverEvent.occurredAt,
      updatedAt: takeoverEvent.occurredAt,
    } satisfies StaffSafeAutomationWorkItem;
    expect(() =>
      assertAutomationRunOperationalTransition(
        waitingOnApprovedStep,
        humanPausedWait,
        takeoverEvent,
        definition,
        { previous: null, next: takeoverItem },
      ),
    ).not.toThrow();

    const nonPristineQueued = {
      ...running,
      state: "queued",
      currentStepIndex: 1,
      completedStepCount: 1,
    } satisfies AutomationRunOperationalSnapshot;
    const invalidStartEvent = {
      ...pauseWaitEvent,
      id: "automation_run_event_invalid_start" as StaffSafeAutomationRunEvent["id"],
      revision: 2,
      auditEventId: entityId<"AuditEvent">("audit_automation_invalid_start"),
      action: "start",
      fromState: "queued",
      toState: "running",
      nextEligibleAt: null,
      reasonCode: "trigger_accepted",
      outcomeCode: "accepted",
      occurredAt: isoDateTime("2026-08-07T09:01:00.000Z"),
      workItemId: null,
    } satisfies StaffSafeAutomationRunEvent;
    expect(() =>
      assertAutomationRunOperationalTransition(
        nonPristineQueued,
        {
          ...nonPristineQueued,
          state: "running",
          revision: 2,
          lastEventId: invalidStartEvent.id,
          updatedAt: invalidStartEvent.occurredAt,
        },
        invalidStartEvent,
        definition,
      ),
    ).toThrow(/pristine queued progress/i);
  });

  it("acknowledges failed-origin takeover release before governed retry or fallback", () => {
    const operatorUid = entityId<"User">("user_synthetic_operator");
    const runId = entityId<"AutomationRun">("automation_run_failed_takeover_001");
    const workItemId =
      "automation_work_item_failed_takeover_001" as StaffSafeAutomationWorkItem["id"];
    const definition = {
      id: entityId<"AutomationDefinition">(automationContent.definitionId),
      version: automationContent.version,
      contentHash: sha256Digest(automationApprovedContentHash),
      steps: [sendStep, waitStep],
    } as const;
    const humanPaused = {
      id: runId,
      workspaceId: entityId<"Workspace">("workspace_safenet_demo"),
      definitionId: definition.id,
      definitionVersion: definition.version,
      definitionContentHash: definition.contentHash,
      teamId: entityId<"Team">("team_synthetic_appointments"),
      locationId: entityId<"Location">("location_synthetic_wattala"),
      state: "paused_for_human",
      pausedFromState: "failed",
      nextEligibleAt: null,
      currentStepIndex: 0,
      completedStepCount: 0,
      attemptCount: 1,
      outcomeCode: "human_takeover_required",
      revision: 5,
      openWorkItemId: workItemId,
      lastEventId: "automation_event_takeover_005" as StaffSafeAutomationRunEvent["id"],
      createdAt: isoDateTime("2026-08-07T09:00:00.000Z"),
      updatedAt: isoDateTime("2026-08-07T09:05:00.000Z"),
    } satisfies AutomationRunOperationalSnapshot;
    const openItem = {
      id: workItemId,
      workspaceId: humanPaused.workspaceId,
      runId,
      definitionId: definition.id,
      definitionVersion: definition.version,
      definitionContentHash: definition.contentHash,
      teamId: humanPaused.teamId,
      locationId: humanPaused.locationId,
      reasonCode: "integration_timeout",
      state: "open",
      openedAt: isoDateTime("2026-08-07T09:01:00.000Z"),
      slaMinutes: 15,
      dueAt: isoDateTime("2026-08-07T09:16:00.000Z"),
      assignedMemberUid: null,
      acknowledgedAt: null,
      acknowledgedByUid: null,
      resolvedAt: null,
      resolvedByUid: null,
      resolutionCode: null,
      revision: 1,
      lastEventId: humanPaused.lastEventId!,
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
      createdAt: isoDateTime("2026-08-07T09:01:00.000Z"),
      updatedAt: isoDateTime("2026-08-07T09:05:00.000Z"),
    } satisfies StaffSafeAutomationWorkItem;
    const releaseEvent = {
      id: "automation_event_takeover_release_006" as StaffSafeAutomationRunEvent["id"],
      workspaceId: humanPaused.workspaceId,
      runId,
      definitionId: definition.id,
      definitionVersion: definition.version,
      definitionContentHash: definition.contentHash,
      teamId: humanPaused.teamId,
      locationId: humanPaused.locationId,
      revision: 6,
      auditEventId: entityId<"AuditEvent">("audit_automation_takeover_release_006"),
      action: "release_human_takeover",
      fromState: "paused_for_human",
      toState: "paused_by_operator",
      stepIndex: null,
      stepId: null,
      attemptNumber: 0,
      workItemId,
      nextEligibleAt: null,
      reasonCode: "human_takeover",
      evidenceFingerprint: hmacDigest("c".repeat(64)),
      outcomeCode: "accepted",
      occurredAt: isoDateTime("2026-08-07T09:06:00.000Z"),
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
      actorKind: "staff",
      actorUid: operatorUid,
    } satisfies StaffSafeAutomationRunEvent;
    const operatorPaused = {
      ...humanPaused,
      state: "paused_by_operator",
      outcomeCode: releaseEvent.outcomeCode,
      revision: 6,
      lastEventId: releaseEvent.id,
      updatedAt: releaseEvent.occurredAt,
    } satisfies AutomationRunOperationalSnapshot;
    const acknowledgedItem = {
      ...openItem,
      state: "acknowledged",
      acknowledgedAt: releaseEvent.occurredAt,
      acknowledgedByUid: operatorUid,
      revision: 2,
      lastEventId: releaseEvent.id,
      updatedAt: releaseEvent.occurredAt,
    } satisfies StaffSafeAutomationWorkItem;
    expect(() =>
      assertAutomationRunOperationalTransition(
        humanPaused,
        operatorPaused,
        releaseEvent,
        definition,
        { previous: openItem, next: acknowledgedItem },
      ),
    ).not.toThrow();
    expect(() =>
      assertAutomationRunOperationalTransition(
        humanPaused,
        operatorPaused,
        releaseEvent,
        definition,
        { previous: openItem, next: { ...acknowledgedItem, state: "open", acknowledgedAt: null, acknowledgedByUid: null } },
      ),
    ).toThrow(/acknowledge/i);

    const resumeEvent = {
      ...releaseEvent,
      id: "automation_event_resume_failed_007" as StaffSafeAutomationRunEvent["id"],
      revision: 7,
      auditEventId: entityId<"AuditEvent">("audit_automation_resume_failed_007"),
      action: "resume",
      fromState: "paused_by_operator",
      toState: "failed",
      reasonCode: "operator_requested",
      occurredAt: isoDateTime("2026-08-07T09:07:00.000Z"),
    } satisfies StaffSafeAutomationRunEvent;
    const resumedFailed = {
      ...operatorPaused,
      state: "failed",
      pausedFromState: null,
      revision: 7,
      lastEventId: resumeEvent.id,
      updatedAt: resumeEvent.occurredAt,
    } satisfies AutomationRunOperationalSnapshot;
    const preservedAcknowledgement = {
      ...acknowledgedItem,
      revision: 3,
      lastEventId: resumeEvent.id,
      updatedAt: resumeEvent.occurredAt,
    } satisfies StaffSafeAutomationWorkItem;
    expect(() =>
      assertAutomationRunOperationalTransition(
        operatorPaused,
        resumedFailed,
        resumeEvent,
        definition,
        { previous: acknowledgedItem, next: preservedAcknowledgement },
      ),
    ).not.toThrow();

    const fallbackEvent = {
      ...releaseEvent,
      id: "automation_event_failed_fallback_008" as StaffSafeAutomationRunEvent["id"],
      revision: 8,
      auditEventId: entityId<"AuditEvent">("audit_automation_failed_fallback_008"),
      action: "exercise_fallback",
      fromState: "failed",
      toState: "paused_by_operator",
      stepIndex: 0,
      stepId: sendStep.id,
      attemptNumber: 1,
      reasonCode: "fallback_policy_applied",
      outcomeCode: "fallback_work_item_created",
      occurredAt: isoDateTime("2026-08-07T09:08:00.000Z"),
    } satisfies StaffSafeAutomationRunEvent;
    const fallbackPaused = {
      ...resumedFailed,
      state: "paused_by_operator",
      pausedFromState: "failed",
      outcomeCode: fallbackEvent.outcomeCode,
      revision: 8,
      lastEventId: fallbackEvent.id,
      updatedAt: fallbackEvent.occurredAt,
    } satisfies AutomationRunOperationalSnapshot;
    const retainedFallbackItem = {
      ...preservedAcknowledgement,
      revision: 4,
      lastEventId: fallbackEvent.id,
      updatedAt: fallbackEvent.occurredAt,
    } satisfies StaffSafeAutomationWorkItem;
    expect(() =>
      assertAutomationRunOperationalTransition(
        resumedFailed,
        fallbackPaused,
        fallbackEvent,
        definition,
        { previous: preservedAcknowledgement, next: retainedFallbackItem },
      ),
    ).not.toThrow();
    expect(() =>
      assertAutomationRunOperationalTransition(
        resumedFailed,
        fallbackPaused,
        fallbackEvent,
        {
          ...definition,
          steps: [{ ...sendStep, fallback: "stop_run" }, waitStep],
        },
        { previous: preservedAcknowledgement, next: retainedFallbackItem },
      ),
    ).toThrow(/exact approved.*fallback/i);
  });

  it("binds every fallback outcome to the exact approved current-step policy", () => {
    const runId = entityId<"AutomationRun">("automation_run_fallback_matrix_001");
    const workspaceId = entityId<"Workspace">("workspace_safenet_demo");
    const teamId = entityId<"Team">("team_synthetic_appointments");
    const locationId = entityId<"Location">("location_synthetic_wattala");
    const definitionId = entityId<"AutomationDefinition">(automationContent.definitionId);
    const contentHash = sha256Digest(automationApprovedContentHash);
    const occurredAt = isoDateTime("2026-08-07T12:00:00.000Z");
    const running = {
      id: runId,
      workspaceId,
      definitionId,
      definitionVersion: automationContent.version,
      definitionContentHash: contentHash,
      teamId,
      locationId,
      state: "running",
      pausedFromState: null,
      nextEligibleAt: null,
      currentStepIndex: 0,
      completedStepCount: 0,
      attemptCount: 0,
      outcomeCode: "accepted",
      revision: 1,
      openWorkItemId: null,
      lastEventId: null,
      createdAt: isoDateTime("2026-08-07T11:59:00.000Z"),
      updatedAt: isoDateTime("2026-08-07T11:59:00.000Z"),
    } satisfies AutomationRunOperationalSnapshot;
    const variants = [
      {
        fallback: "create_work_item",
        toState: "paused_by_operator",
        outcomeCode: "fallback_work_item_created",
        mismatchedFallback: "route_to_human",
      },
      {
        fallback: "route_to_human",
        toState: "paused_for_human",
        outcomeCode: "human_takeover_required",
        mismatchedFallback: "stop_run",
      },
      {
        fallback: "stop_run",
        toState: "ended",
        outcomeCode: "fallback_stopped_safely",
        mismatchedFallback: "create_work_item",
      },
    ] as const;

    for (const [index, variant] of variants.entries()) {
      const workItemId =
        variant.fallback === "stop_run"
          ? null
          : (`automation_work_item_fallback_${index}` as StaffSafeAutomationWorkItem["id"]);
      const event = {
        id: `automation_event_fallback_${index}` as StaffSafeAutomationRunEvent["id"],
        workspaceId,
        runId,
        definitionId,
        definitionVersion: automationContent.version,
        definitionContentHash: contentHash,
        teamId,
        locationId,
        revision: 2,
        auditEventId: entityId<"AuditEvent">(`audit_automation_fallback_${index}`),
        action: "exercise_fallback",
        fromState: "running",
        toState: variant.toState,
        stepIndex: 0,
        stepId: sendStep.id,
        attemptNumber: 1,
        workItemId,
        nextEligibleAt: null,
        reasonCode: "fallback_policy_applied",
        evidenceFingerprint: hmacDigest(`${index + 1}`.repeat(64)),
        outcomeCode: variant.outcomeCode,
        occurredAt,
        schemaVersion: 1,
        synthetic: true,
        externalDispatchCount: 0,
        networkCallCount: 0,
        actorKind: "system",
        actorUid: null,
      } satisfies StaffSafeAutomationRunEvent;
      const next = {
        ...running,
        state: variant.toState,
        pausedFromState:
          variant.fallback === "stop_run" ? null : "running",
        attemptCount: 1,
        outcomeCode: variant.outcomeCode,
        revision: 2,
        openWorkItemId: workItemId,
        lastEventId: event.id,
        updatedAt: occurredAt,
      } satisfies AutomationRunOperationalSnapshot;
      const workItem = workItemId === null
        ? null
        : ({
            id: workItemId,
            workspaceId,
            runId,
            definitionId,
            definitionVersion: automationContent.version,
            definitionContentHash: contentHash,
            teamId,
            locationId,
            reasonCode: "fallback_route",
            state: "open",
            openedAt: occurredAt,
            slaMinutes: 15,
            dueAt: isoDateTime("2026-08-07T12:15:00.000Z"),
            assignedMemberUid: null,
            acknowledgedAt: null,
            acknowledgedByUid: null,
            resolvedAt: null,
            resolvedByUid: null,
            resolutionCode: null,
            revision: 1,
            lastEventId: event.id,
            schemaVersion: 1,
            synthetic: true,
            externalDispatchCount: 0,
            networkCallCount: 0,
            createdAt: occurredAt,
            updatedAt: occurredAt,
          } satisfies StaffSafeAutomationWorkItem);
      const definition = {
        id: definitionId,
        version: automationContent.version,
        contentHash,
        steps: [{ ...sendStep, fallback: variant.fallback }, waitStep],
      } as const;
      const transition = workItem === null ? null : { previous: null, next: workItem };

      expect(() =>
        assertAutomationRunOperationalTransition(
          running,
          next,
          event,
          definition,
          transition,
        ),
      ).not.toThrow();
      expect(() =>
        assertAutomationRunOperationalTransition(
          running,
          next,
          event,
          {
            ...definition,
            steps: [
              { ...sendStep, fallback: variant.mismatchedFallback },
              waitStep,
            ],
          },
          transition,
        ),
      ).toThrow(/exact approved.*fallback/i);
    }
  });

  it("requires activation pointers to carry the matching approval scope and hash", () => {
    const automationDefinition = {
      workspaceId: entityId<"Workspace">("workspace_safenet_demo"),
      id: entityId<"AutomationDefinition">("automation_synthetic_appointment_v1"),
      family: "appointment_service" as const,
      version: 3,
      contentHash: sha256Digest(automationApprovedContentHash),
      approvalHash: sha256Digest(automationApprovedApprovalHash),
      approvalScope: "simulation_only" as const,
      secretBindingHash: sha256Digest(automationSecretBindingHash),
      lifecycleState: "approved" as const,
    };
    const automationActivation = {
      workspaceId: automationDefinition.workspaceId,
      family: automationDefinition.family,
      activeDefinitionId: automationDefinition.id,
      activeDefinitionVersion: automationDefinition.version,
      activeDefinitionContentHash: automationDefinition.contentHash,
      activeDefinitionApprovalHash: automationDefinition.approvalHash,
      activeDefinitionApprovalScope: automationDefinition.approvalScope,
      activeDefinitionSecretBindingHash: automationDefinition.secretBindingHash,
    };
    expect(() =>
      assertAutomationActivationBinding(automationActivation, automationDefinition),
    ).not.toThrow();
    expect(() =>
      assertAutomationActivationBinding(
        { ...automationActivation, activeDefinitionApprovalHash: sha256Digest("0".repeat(64)) },
        automationDefinition,
      ),
    ).toThrow(/approved immutable definition/i);
    for (const nonExecutableFamily of [
      "care_pathway",
      "feedback",
      "inbound_routing",
      "campaign_response",
      "scheduled_service",
    ] as const) {
      expect(() =>
        assertAutomationActivationBinding(
          { ...automationActivation, family: nonExecutableFamily } as never,
          { ...automationDefinition, family: nonExecutableFamily },
        ),
      ).toThrow(/approved immutable definition/i);
    }
    const automationActivationEvent = {
      id: "automation_definition_event_synthetic_activate_001" as StaffSafeAutomationDefinitionEvent["id"],
      workspaceId: automationDefinition.workspaceId,
      family: automationDefinition.family,
      eventType: "activated",
      definitionId: automationDefinition.id,
      definitionVersion: automationDefinition.version,
      definitionContentHash: automationDefinition.contentHash,
      definitionApprovalHash: automationDefinition.approvalHash,
      definitionApprovalScope: automationDefinition.approvalScope,
      definitionSecretBindingHash: automationDefinition.secretBindingHash,
      fromLifecycleState: "approved",
      toLifecycleState: "approved",
      revision: 4,
      auditEventId: entityId<"AuditEvent">("audit_automation_activation_001"),
      occurredAt: isoDateTime("2026-08-07T09:10:00.000Z"),
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
      actorKind: "staff",
      actorUid: entityId<"User">("user_synthetic_automation_approver"),
    } satisfies StaffSafeAutomationDefinitionEvent;
    const automationProof = {
      ...automationActivation,
      id: automationDefinition.family,
      activatedByUid: automationActivationEvent.actorUid,
      activatedAt: automationActivationEvent.occurredAt,
      activationEventId: automationActivationEvent.id,
      activationAuditEventId: automationActivationEvent.auditEventId,
    };
    expect(() =>
      assertAutomationActivationProof(
        automationProof,
        automationDefinition,
        automationActivationEvent,
      ),
    ).not.toThrow();
    expect(() =>
      assertAutomationActivationProof(
        { ...automationProof, activationEventId: "automation_event_dangling" as never },
        automationDefinition,
        automationActivationEvent,
      ),
    ).toThrow(/staff activation event/i);
    expect(() =>
      assertAutomationActivationProof(
        { ...automationProof, activatedByUid: entityId<"User">("user_substituted") },
        automationDefinition,
        automationActivationEvent,
      ),
    ).toThrow(/staff activation event/i);
    expect(() =>
      assertAutomationActivationProof(
        { ...automationProof, activatedAt: isoDateTime("2026-08-07T09:11:00.000Z") },
        automationDefinition,
        automationActivationEvent,
      ),
    ).toThrow(/staff activation event/i);
    expect(() =>
      assertAutomationActivationProof(
        {
          ...automationProof,
          activationAuditEventId: entityId<"AuditEvent">("audit_substituted"),
        },
        automationDefinition,
        automationActivationEvent,
      ),
    ).toThrow(/staff activation event/i);

    const pathway = {
      workspaceId: entityId<"Workspace">("workspace_safenet_demo"),
      id: entityId<"CarePathway">("care_pathway_synthetic_followup_v1"),
      family: "post_discharge" as const,
      protocolVersion: "v1.0",
      contentHash: sha256Digest(careApprovedContentHash),
      approvalHash: sha256Digest(careApprovedApprovalHash),
      approvalScope: "clinical_simulation_only" as const,
      secretBindingHash: sha256Digest(careSecretBindingHash),
      lifecycleState: "approved" as const,
    };
    const pathwayActivation = {
      workspaceId: pathway.workspaceId,
      family: pathway.family,
      activePathwayId: pathway.id,
      activeProtocolVersion: pathway.protocolVersion,
      activePathwayContentHash: pathway.contentHash,
      activePathwayApprovalHash: pathway.approvalHash,
      activePathwayApprovalScope: pathway.approvalScope,
      activePathwaySecretBindingHash: pathway.secretBindingHash,
    };
    expect(() => assertCarePathwayActivationBinding(pathwayActivation, pathway)).not.toThrow();
    expect(() =>
      assertCarePathwayActivationBinding(
        { ...pathwayActivation, activePathwayApprovalScope: "clinical_simulation_only" },
        { ...pathway, lifecycleState: "retired" },
      ),
    ).toThrow(/approved immutable pathway/i);
    const careActivationEvent = {
      id: "care_pathway_event_synthetic_activate_001" as StaffSafeCarePathwayEvent["id"],
      workspaceId: pathway.workspaceId,
      family: pathway.family,
      eventType: "activated",
      pathwayId: pathway.id,
      pathwayProtocolVersion: pathway.protocolVersion,
      pathwayContentHash: pathway.contentHash,
      pathwayApprovalHash: pathway.approvalHash,
      pathwayApprovalScope: pathway.approvalScope,
      pathwaySecretBindingHash: pathway.secretBindingHash,
      fromLifecycleState: "approved",
      toLifecycleState: "approved",
      revision: 4,
      auditEventId: entityId<"AuditEvent">("audit_care_activation_001"),
      occurredAt: isoDateTime("2026-08-07T09:40:00.000Z"),
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
      actorKind: "staff",
      actorUid: entityId<"User">("user_synthetic_clinical_approver"),
    } satisfies StaffSafeCarePathwayEvent;
    const careProof = {
      ...pathwayActivation,
      id: pathway.family,
      activatedByUid: careActivationEvent.actorUid,
      activatedAt: careActivationEvent.occurredAt,
      activationEventId: careActivationEvent.id,
      activationAuditEventId: careActivationEvent.auditEventId,
    };
    expect(() =>
      assertCarePathwayActivationProof(careProof, pathway, careActivationEvent),
    ).not.toThrow();
    expect(() =>
      assertCarePathwayActivationProof(
        { ...careProof, activationEventId: "care_event_dangling" as never },
        pathway,
        careActivationEvent,
      ),
    ).toThrow(/staff activation event/i);
    expect(() =>
      assertCarePathwayActivationProof(
        { ...careProof, activatedByUid: entityId<"User">("user_substituted") },
        pathway,
        careActivationEvent,
      ),
    ).toThrow(/staff activation event/i);
    expect(() =>
      assertCarePathwayActivationProof(
        { ...careProof, activatedAt: isoDateTime("2026-08-07T09:41:00.000Z") },
        pathway,
        careActivationEvent,
      ),
    ).toThrow(/staff activation event/i);
    expect(() =>
      assertCarePathwayActivationProof(
        { ...careProof, activationAuditEventId: entityId<"AuditEvent">("audit_substituted") },
        pathway,
        careActivationEvent,
      ),
    ).toThrow(/staff activation event/i);
  });

  it("atomically binds care progress, handoff, escalation authority and safety-pointer lifecycle", () => {
    const enrollmentId = entityId<"CareEnrollment">("care_enrollment_operational_001");
    const newEscalationId =
      "care_escalation_operational_new" as StaffSafeCareEscalation["id"];
    const oldEscalationId =
      "care_escalation_operational_old" as StaffSafeCareEscalation["id"];
    const clinicalUid = entityId<"User">("user_synthetic_clinical_approver");
    const nextContactAt = isoDateTime("2026-08-07T09:00:00.000Z");
    const clearanceAt = (occurredAt: StaffSafeCareEnrollmentEvent["occurredAt"]): VerifiedClinicalClearance => ({
      ...clinicalAuthority,
      recentAuthenticationAt: isoDateTime("2026-08-07T09:00:00.000Z"),
      verifiedAt: occurredAt,
    });
    const active = {
      id: enrollmentId,
      workspaceId: clinicalScope.workspaceId,
      pathwayId: entityId<"CarePathway">(careContent.pathwayId),
      pathwayProtocolVersion: careContent.protocolVersion,
      pathwayContentHash: sha256Digest(careApprovedContentHash),
      teamId: clinicalScope.teamId,
      locationId: clinicalScope.locationId,
      state: "active",
      nextContactIndex: 0,
      nextContactAt,
      activeSuppressions: [],
      openEscalationId: null,
      safetyHoldEscalationId: null,
      openHandoffId: null,
      revision: 1,
      lastEventId: null,
      outcomeCode: "accepted",
      createdAt: isoDateTime("2026-08-06T09:30:00.000Z"),
      updatedAt: isoDateTime("2026-08-06T10:00:00.000Z"),
    } satisfies CareEnrollmentOperationalSnapshot;
    const contactEvent = {
      id: "care_event_contact_002" as StaffSafeCareEnrollmentEvent["id"],
      workspaceId: active.workspaceId,
      enrollmentId,
      pathwayId: active.pathwayId,
      pathwayProtocolVersion: active.pathwayProtocolVersion,
      pathwayContentHash: active.pathwayContentHash,
      teamId: active.teamId,
      locationId: active.locationId,
      revision: 2,
      auditEventId: entityId<"AuditEvent">("audit_care_contact_002"),
      action: "advance_contact",
      fromState: "active",
      toState: "active",
      contactPointIndex: 0,
      suppressionReason: null,
      escalationId: null,
      escalationStateBefore: null,
      escalationStateAfter: null,
      handoffId: null,
      activeSuppressionsAfter: [],
      nextContactAt: isoDateTime("2026-08-09T09:00:00.000Z"),
      outcomeCode: "contact_advanced",
      occurredAt: isoDateTime("2026-08-07T09:01:00.000Z"),
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
      actorKind: "system",
      actorUid: null,
    } satisfies StaffSafeCareEnrollmentEvent;
    const contactAdvanced = {
      ...active,
      nextContactIndex: 1,
      nextContactAt: contactEvent.nextContactAt,
      revision: 2,
      lastEventId: contactEvent.id,
      outcomeCode: contactEvent.outcomeCode,
      updatedAt: contactEvent.occurredAt,
    } satisfies CareEnrollmentOperationalSnapshot;
    expect(() =>
      assertCareTransition(active, contactAdvanced, contactEvent),
    ).not.toThrow();
    const earlyContactEvent = {
      ...contactEvent,
      occurredAt: isoDateTime("2026-08-07T08:59:59.000Z"),
    } satisfies StaffSafeCareEnrollmentEvent;
    expect(() =>
      assertCareTransition(
        active,
        { ...contactAdvanced, updatedAt: earlyContactEvent.occurredAt },
        earlyContactEvent,
      ),
    ).toThrow(/due approved contact/i);
    const wrongNextContactAt = isoDateTime("2026-08-09T09:00:01.000Z");
    expect(() =>
      assertCareTransition(
        active,
        { ...contactAdvanced, nextContactAt: wrongNextContactAt },
        { ...contactEvent, nextContactAt: wrongNextContactAt },
      ),
    ).toThrow(/approved discharge schedule/i);
    const prematureCompleteEvent = {
      ...contactEvent,
      toState: "completed",
      nextContactAt: null,
      outcomeCode: "completed",
    } satisfies StaffSafeCareEnrollmentEvent;
    expect(() =>
      assertCareTransition(
        active,
        {
          ...contactAdvanced,
          state: "completed",
          nextContactAt: null,
          outcomeCode: "completed",
        },
        prematureCompleteEvent,
      ),
    ).toThrow(/pathway finality/i);
    const finalContactEvent = {
      ...contactEvent,
      id: "care_event_contact_final_003" as StaffSafeCareEnrollmentEvent["id"],
      revision: 3,
      auditEventId: entityId<"AuditEvent">("audit_care_contact_final_003"),
      fromState: "active",
      toState: "completed",
      contactPointIndex: 1,
      nextContactAt: null,
      outcomeCode: "completed",
      occurredAt: isoDateTime("2026-08-09T09:00:00.000Z"),
    } satisfies StaffSafeCareEnrollmentEvent;
    const careCompleted = {
      ...contactAdvanced,
      state: "completed",
      nextContactIndex: 2,
      nextContactAt: null,
      revision: 3,
      lastEventId: finalContactEvent.id,
      outcomeCode: finalContactEvent.outcomeCode,
      updatedAt: finalContactEvent.occurredAt,
    } satisfies CareEnrollmentOperationalSnapshot;
    expect(() =>
      assertCareTransition(contactAdvanced, careCompleted, finalContactEvent),
    ).not.toThrow();
    const pastFinal = {
      ...contactAdvanced,
      nextContactIndex: 2,
      nextContactAt: isoDateTime("2026-08-11T09:00:00.000Z"),
      revision: 3,
      lastEventId: finalContactEvent.id,
      updatedAt: finalContactEvent.occurredAt,
    } satisfies CareEnrollmentOperationalSnapshot;
    const pastFinalEvent = {
      ...finalContactEvent,
      id: "care_event_contact_past_final_004" as StaffSafeCareEnrollmentEvent["id"],
      revision: 4,
      contactPointIndex: 2,
      occurredAt: isoDateTime("2026-08-11T09:00:00.000Z"),
    } satisfies StaffSafeCareEnrollmentEvent;
    expect(() =>
      assertCareTransition(
        pastFinal,
        {
          ...pastFinal,
          state: "completed",
          nextContactIndex: 3,
          nextContactAt: null,
          revision: 4,
          lastEventId: pastFinalEvent.id,
          outcomeCode: pastFinalEvent.outcomeCode,
          updatedAt: pastFinalEvent.occurredAt,
        },
        pastFinalEvent,
      ),
    ).toThrow(/approved discharge schedule/i);
    expect(() =>
      assertCareTransition(
        active,
        contactAdvanced,
        contactEvent,
        null,
        null,
        null,
        {
          ...approvedCarePathway,
          contentHash: sha256Digest("0".repeat(64)),
        },
      ),
    ).toThrow(/approved pathway/i);
    expect(() =>
      assertCareTransition(
        active,
        contactAdvanced,
        contactEvent,
        null,
        null,
        null,
        approvedCarePathway,
        isoDateTime("2026-08-06T09:00:01.000Z"),
      ),
    ).toThrow(/approved discharge schedule/i);
    expect(() =>
      assertCareTransition(
        active,
        { ...contactAdvanced, nextContactIndex: 2 },
        contactEvent,
      ),
    ).toThrow(/one due approved contact/i);
    const pauseEvent = {
      ...contactEvent,
      id: "care_event_pause_003" as StaffSafeCareEnrollmentEvent["id"],
      revision: 3,
      auditEventId: entityId<"AuditEvent">("audit_care_pause_003"),
      action: "pause",
      fromState: "active",
      toState: "paused_by_operator",
      contactPointIndex: null,
      nextContactAt: contactAdvanced.nextContactAt,
      outcomeCode: "accepted",
      occurredAt: isoDateTime("2026-08-07T09:02:00.000Z"),
      actorKind: "staff",
      actorUid: clinicalUid,
    } satisfies StaffSafeCareEnrollmentEvent;
    expect(() =>
      assertCareTransition(
        contactAdvanced,
        {
          ...contactAdvanced,
          state: "paused_by_operator",
          revision: 3,
          lastEventId: pauseEvent.id,
          outcomeCode: pauseEvent.outcomeCode,
          updatedAt: pauseEvent.occurredAt,
          nextContactAt: isoDateTime("2026-08-11T09:00:00.000Z"),
        },
        { ...pauseEvent, nextContactAt: isoDateTime("2026-08-11T09:00:00.000Z") },
      ),
    ).toThrow(/nextContactAt/i);

    const handoffId = "care_handoff_operational_001" as NonNullable<
      StaffSafeCareEnrollment["openHandoffId"]
    >;
    const takeoverEvent = {
      ...contactEvent,
      id: "care_event_takeover_003" as StaffSafeCareEnrollmentEvent["id"],
      revision: 3,
      auditEventId: entityId<"AuditEvent">("audit_care_takeover_003"),
      action: "human_takeover_started",
      fromState: "active",
      toState: "paused_for_human",
      contactPointIndex: null,
      handoffId,
      nextContactAt: contactAdvanced.nextContactAt,
      outcomeCode: "human_takeover_required",
      occurredAt: isoDateTime("2026-08-07T09:02:00.000Z"),
    } satisfies StaffSafeCareEnrollmentEvent;
    const humanPaused = {
      ...contactAdvanced,
      state: "paused_for_human",
      openHandoffId: handoffId,
      revision: 3,
      lastEventId: takeoverEvent.id,
      outcomeCode: takeoverEvent.outcomeCode,
      updatedAt: takeoverEvent.occurredAt,
    } satisfies CareEnrollmentOperationalSnapshot;
    const openHandoff = {
      id: handoffId,
      workspaceId: takeoverEvent.workspaceId,
      enrollmentId,
      pathwayId: takeoverEvent.pathwayId,
      pathwayProtocolVersion: takeoverEvent.pathwayProtocolVersion,
      pathwayContentHash: takeoverEvent.pathwayContentHash,
      teamId: takeoverEvent.teamId,
      locationId: takeoverEvent.locationId,
      state: "open",
      openedEventId: takeoverEvent.id,
      openedBy: { actorKind: takeoverEvent.actorKind, actorUid: takeoverEvent.actorUid },
      openedAt: takeoverEvent.occurredAt,
      releasedEventId: null,
      releasedBy: null,
      releasedAt: null,
      revision: 1,
      lastEventId: takeoverEvent.id,
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
      createdAt: takeoverEvent.occurredAt,
      updatedAt: takeoverEvent.occurredAt,
    } satisfies StaffSafeCareHandoff;
    expect(() => assertCareHandoffLifecycle(openHandoff)).not.toThrow();
    expect(() =>
      assertCareTransition(
        contactAdvanced,
        humanPaused,
        takeoverEvent,
      ),
    ).toThrow(/handoff document evidence/i);
    expect(() =>
      assertCareTransition(
        contactAdvanced,
        humanPaused,
        takeoverEvent,
        null,
        null,
        { previous: null, next: openHandoff },
      ),
    ).not.toThrow();
    const releaseEvent = {
      ...takeoverEvent,
      id: "care_event_takeover_release_004" as StaffSafeCareEnrollmentEvent["id"],
      revision: 4,
      auditEventId: entityId<"AuditEvent">("audit_care_takeover_release_004"),
      action: "release_human_takeover",
      fromState: "paused_for_human",
      toState: "paused_by_operator",
      outcomeCode: "accepted",
      occurredAt: isoDateTime("2026-08-07T09:03:00.000Z"),
      actorKind: "staff",
      actorUid: clinicalUid,
    } satisfies StaffSafeCareEnrollmentEvent;
    const released = {
      ...humanPaused,
      state: "paused_by_operator",
      openHandoffId: null,
      revision: 4,
      lastEventId: releaseEvent.id,
      outcomeCode: releaseEvent.outcomeCode,
      updatedAt: releaseEvent.occurredAt,
    } satisfies CareEnrollmentOperationalSnapshot;
    const releasedHandoff = {
      ...openHandoff,
      state: "released",
      releasedEventId: releaseEvent.id,
      releasedBy: { actorKind: releaseEvent.actorKind, actorUid: releaseEvent.actorUid },
      releasedAt: releaseEvent.occurredAt,
      revision: 2,
      lastEventId: releaseEvent.id,
      updatedAt: releaseEvent.occurredAt,
    } satisfies StaffSafeCareHandoff;
    expect(() =>
      assertCareTransition(
        humanPaused,
        released,
        releaseEvent,
        null,
        null,
        { previous: openHandoff, next: releasedHandoff },
      ),
    ).not.toThrow();
    for (const pollutedHandoff of [
      { ...releasedHandoff, teamId: entityId<"Team">("team_substituted") },
      { ...releasedHandoff, openedAt: isoDateTime("2026-08-07T09:02:01.000Z") },
      { ...releasedHandoff, revision: 1 },
      { ...releasedHandoff, revision: 3 },
      {
        ...releasedHandoff,
        releasedBy: { actorKind: "staff" as const, actorUid: entityId<"User">("user_substituted") },
      },
      { ...releasedHandoff, releasedAt: isoDateTime("2026-08-07T09:01:59.000Z") },
    ]) {
      expect(() =>
        assertCareTransition(
          humanPaused,
          released,
          releaseEvent,
          null,
          null,
          { previous: openHandoff, next: pollutedHandoff },
        ),
      ).toThrow();
    }
    expect(() =>
      assertCareTransition(
        humanPaused,
        released,
        {
          ...releaseEvent,
          handoffId: "care_handoff_substituted" as StaffSafeCareEnrollmentEvent["handoffId"],
        },
      ),
    ).toThrow(/handoff pointer/i);

    const existingSafety = {
      ...contactAdvanced,
      state: "paused_for_safety",
      safetyHoldEscalationId: oldEscalationId,
      revision: 5,
      lastEventId: "care_event_old_safety_005" as StaffSafeCareEnrollmentEvent["id"],
      outcomeCode: "escalation_resolved_safety_hold",
      updatedAt: isoDateTime("2026-08-07T09:04:00.000Z"),
    } satisfies CareEnrollmentOperationalSnapshot;
    const redFlagEvent = {
      ...contactEvent,
      id: "care_event_red_flag_006" as StaffSafeCareEnrollmentEvent["id"],
      revision: 6,
      auditEventId: entityId<"AuditEvent">("audit_care_red_flag_006"),
      action: "raise_red_flag",
      fromState: "paused_for_safety",
      toState: "escalated",
      contactPointIndex: null,
      escalationId: newEscalationId,
      escalationStateBefore: null,
      escalationStateAfter: "open",
      nextContactAt: existingSafety.nextContactAt,
      outcomeCode: "red_flag_escalated",
      occurredAt: isoDateTime("2026-08-07T09:05:00.000Z"),
    } satisfies StaffSafeCareEnrollmentEvent;
    const redFlagged = {
      ...existingSafety,
      state: "escalated",
      openEscalationId: newEscalationId,
      revision: 6,
      lastEventId: redFlagEvent.id,
      outcomeCode: redFlagEvent.outcomeCode,
      updatedAt: redFlagEvent.occurredAt,
    } satisfies CareEnrollmentOperationalSnapshot;
    const openEscalation = {
      id: newEscalationId,
      workspaceId: existingSafety.workspaceId,
      enrollmentId,
      pathwayId: existingSafety.pathwayId,
      pathwayProtocolVersion: existingSafety.pathwayProtocolVersion,
      pathwayContentHash: existingSafety.pathwayContentHash,
      teamId: existingSafety.teamId,
      locationId: existingSafety.locationId,
      reasonCode: "red_flag_response",
      state: "open",
      openedAt: redFlagEvent.occurredAt,
      responseSlaMinutes: 15,
      responseDueAt: isoDateTime("2026-08-07T09:20:00.000Z"),
      openedBy: { actorKind: "system", actorUid: null },
      acknowledgedAt: null,
      acknowledgedByUid: null,
      resolvedAt: null,
      resolvedByUid: null,
      resolutionCode: null,
      writeBackRequired: true,
      writeBackState: "pending",
      revision: 1,
      lastEventId: redFlagEvent.id,
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
      createdAt: redFlagEvent.occurredAt,
      updatedAt: redFlagEvent.occurredAt,
    } satisfies StaffSafeCareEscalation;
    expect(() =>
      assertCareTransition(
        existingSafety,
        redFlagged,
        redFlagEvent,
        { previous: null, next: openEscalation },
      ),
    ).not.toThrow();
    expect(() =>
      assertCareTransition(
        existingSafety,
        { ...redFlagged, safetyHoldEscalationId: null },
        redFlagEvent,
        { previous: null, next: openEscalation },
      ),
    ).toThrow(/safety pointer/i);
    expect(() =>
      assertCareTransition(
        existingSafety,
        { ...redFlagged, openEscalationId: oldEscalationId },
        { ...redFlagEvent, escalationId: oldEscalationId },
        {
          previous: null,
          next: { ...openEscalation, id: oldEscalationId },
        },
      ),
    ).toThrow(/escalation pointer/i);
    expect(() =>
      assertCareTransition(
        existingSafety,
        redFlagged,
        redFlagEvent,
        { previous: openEscalation, next: openEscalation },
      ),
    ).toThrow(/create a new document/i);

    const holdEvent = {
      ...redFlagEvent,
      id: "care_event_hold_007" as StaffSafeCareEnrollmentEvent["id"],
      revision: 7,
      auditEventId: entityId<"AuditEvent">("audit_care_hold_007"),
      action: "simulate_suppression",
      fromState: "escalated",
      toState: "escalated",
      suppressionReason: "clinical_hold",
      escalationStateBefore: "open",
      escalationStateAfter: "open",
      activeSuppressionsAfter: ["clinical_hold"],
      outcomeCode: "clinical_hold_applied",
      occurredAt: isoDateTime("2026-08-07T09:06:00.000Z"),
    } satisfies StaffSafeCareEnrollmentEvent;
    const heldEscalated = {
      ...redFlagged,
      activeSuppressions: ["clinical_hold"],
      revision: 7,
      lastEventId: holdEvent.id,
      outcomeCode: holdEvent.outcomeCode,
      updatedAt: holdEvent.occurredAt,
    } satisfies CareEnrollmentOperationalSnapshot;
    const heldEscalationDoc = {
      ...openEscalation,
      revision: 2,
      lastEventId: holdEvent.id,
      updatedAt: holdEvent.occurredAt,
    } satisfies StaffSafeCareEscalation;
    expect(() =>
      assertCareTransition(
        redFlagged,
        heldEscalated,
        holdEvent,
        { previous: openEscalation, next: heldEscalationDoc },
      ),
    ).not.toThrow();

    const acknowledgeEvent = {
      ...holdEvent,
      id: "care_event_ack_008" as StaffSafeCareEnrollmentEvent["id"],
      revision: 8,
      auditEventId: entityId<"AuditEvent">("audit_care_ack_008"),
      action: "acknowledge_escalation",
      suppressionReason: null,
      escalationStateBefore: "open",
      escalationStateAfter: "acknowledged",
      outcomeCode: "escalation_acknowledged",
      occurredAt: isoDateTime("2026-08-07T09:07:00.000Z"),
      actorKind: "staff",
      actorUid: clinicalUid,
    } satisfies StaffSafeCareEnrollmentEvent;
    const acknowledgedEnrollment = {
      ...heldEscalated,
      revision: 8,
      lastEventId: acknowledgeEvent.id,
      outcomeCode: acknowledgeEvent.outcomeCode,
      updatedAt: acknowledgeEvent.occurredAt,
    } satisfies CareEnrollmentOperationalSnapshot;
    const acknowledgedEscalation = {
      ...heldEscalationDoc,
      state: "acknowledged",
      acknowledgedAt: acknowledgeEvent.occurredAt,
      acknowledgedByUid: clinicalUid,
      revision: 3,
      lastEventId: acknowledgeEvent.id,
      updatedAt: acknowledgeEvent.occurredAt,
    } satisfies StaffSafeCareEscalation;
    const acknowledgeClearance = clearanceAt(acknowledgeEvent.occurredAt);
    expect(() =>
      assertCareTransition(
        heldEscalated,
        acknowledgedEnrollment,
        acknowledgeEvent,
        { previous: heldEscalationDoc, next: acknowledgedEscalation },
        acknowledgeClearance,
      ),
    ).not.toThrow();
    expect(() =>
      assertCareTransition(
        heldEscalated,
        acknowledgedEnrollment,
        acknowledgeEvent,
        { previous: heldEscalationDoc, next: acknowledgedEscalation },
      ),
    ).toThrow(/verified authority/i);
    for (const forgedClearance of [
      { ...acknowledgeClearance, actorUid: entityId<"User">("user_substituted") },
      { ...acknowledgeClearance, workspaceId: entityId<"Workspace">("workspace_substituted") },
      { ...acknowledgeClearance, teamId: entityId<"Team">("team_substituted") },
      { ...acknowledgeClearance, locationId: entityId<"Location">("location_substituted") },
      { ...acknowledgeClearance, verifiedAt: isoDateTime("2026-08-07T09:06:59.000Z") },
    ]) {
      expect(() =>
        assertCareTransition(
          heldEscalated,
          acknowledgedEnrollment,
          acknowledgeEvent,
          { previous: heldEscalationDoc, next: acknowledgedEscalation },
          forgedClearance,
        ),
      ).toThrow();
    }

    const resolveEvent = {
      ...acknowledgeEvent,
      id: "care_event_resolve_009" as StaffSafeCareEnrollmentEvent["id"],
      revision: 9,
      auditEventId: entityId<"AuditEvent">("audit_care_resolve_009"),
      action: "resolve_escalation",
      fromState: "escalated",
      toState: "paused_for_safety",
      escalationStateBefore: "acknowledged",
      escalationStateAfter: "resolved",
      outcomeCode: "escalation_resolved_safety_hold",
      occurredAt: isoDateTime("2026-08-07T09:08:00.000Z"),
    } satisfies StaffSafeCareEnrollmentEvent;
    const resolvedEnrollment = {
      ...acknowledgedEnrollment,
      state: "paused_for_safety",
      openEscalationId: null,
      safetyHoldEscalationId: newEscalationId,
      revision: 9,
      lastEventId: resolveEvent.id,
      outcomeCode: resolveEvent.outcomeCode,
      updatedAt: resolveEvent.occurredAt,
    } satisfies CareEnrollmentOperationalSnapshot;
    const resolvedEscalation = {
      ...acknowledgedEscalation,
      state: "resolved",
      resolvedAt: resolveEvent.occurredAt,
      resolvedByUid: clinicalUid,
      resolutionCode: "safety_hold_applied",
      writeBackState: "unavailable_in_demo",
      revision: 4,
      lastEventId: resolveEvent.id,
      updatedAt: resolveEvent.occurredAt,
    } satisfies StaffSafeCareEscalation;
    const resolveClearance = clearanceAt(resolveEvent.occurredAt);
    expect(() =>
      assertCareTransition(
        acknowledgedEnrollment,
        resolvedEnrollment,
        resolveEvent,
        { previous: acknowledgedEscalation, next: resolvedEscalation },
        resolveClearance,
      ),
    ).not.toThrow();
    expect(() =>
      assertCareTransition(
        acknowledgedEnrollment,
        { ...resolvedEnrollment, safetyHoldEscalationId: oldEscalationId },
        resolveEvent,
        { previous: acknowledgedEscalation, next: resolvedEscalation },
        resolveClearance,
      ),
    ).toThrow(/safety pointer/i);
    expect(() =>
      assertCareTransition(
        acknowledgedEnrollment,
        resolvedEnrollment,
        resolveEvent,
        { previous: heldEscalationDoc, next: resolvedEscalation },
        resolveClearance,
      ),
    ).toThrow(/acknowledged escalation|identity/i);
    for (const pollutedEscalation of [
      { ...resolvedEscalation, resolutionCode: "terminal_suppression_applied" as const },
      { ...resolvedEscalation, reasonCode: "emergency_keyword" as const },
      { ...resolvedEscalation, responseSlaMinutes: 10 },
      { ...resolvedEscalation, writeBackState: "pending" as const },
      { ...resolvedEscalation, openedBy: { actorKind: "staff" as const, actorUid: clinicalUid } },
    ]) {
      expect(() =>
        assertCareTransition(
          acknowledgedEnrollment,
          resolvedEnrollment,
          resolveEvent,
          { previous: acknowledgedEscalation, next: pollutedEscalation },
          resolveClearance,
        ),
      ).toThrow();
    }

    const clearClinicalEvent = {
      ...resolveEvent,
      id: "care_event_clear_clinical_010" as StaffSafeCareEnrollmentEvent["id"],
      revision: 10,
      auditEventId: entityId<"AuditEvent">("audit_care_clear_clinical_010"),
      action: "clear_clinical_hold",
      fromState: "paused_for_safety",
      toState: "paused_for_safety",
      escalationId: null,
      escalationStateBefore: null,
      escalationStateAfter: null,
      activeSuppressionsAfter: [],
      outcomeCode: "safety_hold_cleared",
      occurredAt: isoDateTime("2026-08-07T09:09:00.000Z"),
    } satisfies StaffSafeCareEnrollmentEvent;
    const clinicalHoldCleared = {
      ...resolvedEnrollment,
      activeSuppressions: [],
      revision: 10,
      lastEventId: clearClinicalEvent.id,
      outcomeCode: clearClinicalEvent.outcomeCode,
      updatedAt: clearClinicalEvent.occurredAt,
    } satisfies CareEnrollmentOperationalSnapshot;
    expect(() =>
      assertCareTransition(
        resolvedEnrollment,
        clinicalHoldCleared,
        clearClinicalEvent,
        null,
        clearanceAt(clearClinicalEvent.occurredAt),
      ),
    ).not.toThrow();
    expect(() =>
      assertCareTransition(
        resolvedEnrollment,
        { ...clinicalHoldCleared, state: "paused_by_operator" },
        { ...clearClinicalEvent, toState: "paused_by_operator" },
        null,
        clearanceAt(clearClinicalEvent.occurredAt),
      ),
    ).toThrow(/safety-governed state|safety pointer/i);
    const clinicalOnly = {
      ...resolvedEnrollment,
      safetyHoldEscalationId: null,
    } satisfies CareEnrollmentOperationalSnapshot;
    const clearClinicalOnlyEvent = {
      ...clearClinicalEvent,
      toState: "paused_by_operator",
    } satisfies StaffSafeCareEnrollmentEvent;
    const clinicalOnlyCleared = {
      ...clinicalHoldCleared,
      state: "paused_by_operator",
      safetyHoldEscalationId: null,
    } satisfies CareEnrollmentOperationalSnapshot;
    expect(() =>
      assertCareTransition(
        clinicalOnly,
        clinicalOnlyCleared,
        clearClinicalOnlyEvent,
        null,
        clearanceAt(clearClinicalOnlyEvent.occurredAt),
      ),
    ).not.toThrow();
    const redundantClearClinicalEvent = {
      ...clearClinicalEvent,
      id: "care_event_redundant_clear_clinical_011" as StaffSafeCareEnrollmentEvent["id"],
      revision: 11,
      auditEventId: entityId<"AuditEvent">("audit_care_redundant_clear_clinical_011"),
      occurredAt: isoDateTime("2026-08-07T09:10:00.000Z"),
    };
    expect(() =>
      assertCareTransition(
        clinicalHoldCleared,
        {
          ...clinicalHoldCleared,
          revision: 11,
          lastEventId: redundantClearClinicalEvent.id,
          updatedAt: redundantClearClinicalEvent.occurredAt,
        },
        redundantClearClinicalEvent,
        null,
        clearanceAt(redundantClearClinicalEvent.occurredAt),
      ),
    ).toThrow(/active clinical_hold/i);

    const clearSafetyEvent = {
      ...clearClinicalEvent,
      id: "care_event_clear_safety_011" as StaffSafeCareEnrollmentEvent["id"],
      revision: 11,
      auditEventId: entityId<"AuditEvent">("audit_care_clear_safety_011"),
      action: "clear_safety_hold",
      fromState: "paused_for_safety",
      toState: "paused_by_operator",
      escalationId: newEscalationId,
      escalationStateBefore: "resolved",
      escalationStateAfter: "resolved",
      occurredAt: isoDateTime("2026-08-07T09:10:00.000Z"),
    } satisfies StaffSafeCareEnrollmentEvent;
    const safetyCleared = {
      ...clinicalHoldCleared,
      state: "paused_by_operator",
      safetyHoldEscalationId: null,
      revision: 11,
      lastEventId: clearSafetyEvent.id,
      updatedAt: clearSafetyEvent.occurredAt,
    } satisfies CareEnrollmentOperationalSnapshot;
    const clearSafetyEscalation = {
      ...resolvedEscalation,
      revision: 5,
      lastEventId: clearSafetyEvent.id,
      updatedAt: clearSafetyEvent.occurredAt,
    } satisfies StaffSafeCareEscalation;
    const clearSafetyAuthority = clearanceAt(clearSafetyEvent.occurredAt);
    expect(() =>
      assertCareTransition(
        clinicalHoldCleared,
        safetyCleared,
        clearSafetyEvent,
        { previous: resolvedEscalation, next: clearSafetyEscalation },
        clearSafetyAuthority,
      ),
    ).not.toThrow();
    expect(() =>
      assertCareTransition(
        clinicalHoldCleared,
        safetyCleared,
        { ...clearSafetyEvent, escalationId: oldEscalationId },
        { previous: resolvedEscalation, next: clearSafetyEscalation },
        clearSafetyAuthority,
      ),
    ).toThrow(/escalation pointer|cross-bind/i);

    const terminalSuppressionEvent = {
      ...acknowledgeEvent,
      id: "care_event_terminal_suppression_009" as StaffSafeCareEnrollmentEvent["id"],
      revision: 9,
      auditEventId: entityId<"AuditEvent">("audit_care_terminal_suppression_009"),
      action: "simulate_suppression",
      fromState: "escalated",
      toState: "escalated",
      suppressionReason: "readmission",
      escalationStateBefore: "acknowledged",
      escalationStateAfter: "acknowledged",
      activeSuppressionsAfter: ["readmission", "clinical_hold"],
      outcomeCode: "suppressed_terminal",
      occurredAt: isoDateTime("2026-08-07T09:08:00.000Z"),
      actorKind: "system",
      actorUid: null,
    } satisfies StaffSafeCareEnrollmentEvent;
    const terminalSuppressedEnrollment = {
      ...acknowledgedEnrollment,
      activeSuppressions: ["readmission", "clinical_hold"],
      revision: 9,
      lastEventId: terminalSuppressionEvent.id,
      outcomeCode: terminalSuppressionEvent.outcomeCode,
      updatedAt: terminalSuppressionEvent.occurredAt,
    } satisfies CareEnrollmentOperationalSnapshot;
    const terminalSuppressedEscalation = {
      ...acknowledgedEscalation,
      revision: 4,
      lastEventId: terminalSuppressionEvent.id,
      updatedAt: terminalSuppressionEvent.occurredAt,
    } satisfies StaffSafeCareEscalation;
    expect(() =>
      assertCareTransition(
        acknowledgedEnrollment,
        terminalSuppressedEnrollment,
        terminalSuppressionEvent,
        { previous: acknowledgedEscalation, next: terminalSuppressedEscalation },
      ),
    ).not.toThrow();

    const terminalResolveEvent = {
      ...resolveEvent,
      id: "care_event_terminal_resolve_010" as StaffSafeCareEnrollmentEvent["id"],
      revision: 10,
      auditEventId: entityId<"AuditEvent">("audit_care_terminal_resolve_010"),
      toState: "ended",
      activeSuppressionsAfter: ["readmission", "clinical_hold"],
      nextContactAt: null,
      outcomeCode: "escalation_resolved_terminal_suppression",
      occurredAt: isoDateTime("2026-08-07T09:09:00.000Z"),
    } satisfies StaffSafeCareEnrollmentEvent;
    const terminalEnded = {
      ...terminalSuppressedEnrollment,
      state: "ended",
      nextContactAt: null,
      openEscalationId: null,
      safetyHoldEscalationId: null,
      activeSuppressions: ["readmission", "clinical_hold"],
      revision: 10,
      lastEventId: terminalResolveEvent.id,
      outcomeCode: terminalResolveEvent.outcomeCode,
      updatedAt: terminalResolveEvent.occurredAt,
    } satisfies CareEnrollmentOperationalSnapshot;
    const terminalResolvedEscalation = {
      ...terminalSuppressedEscalation,
      state: "resolved",
      resolvedAt: terminalResolveEvent.occurredAt,
      resolvedByUid: clinicalUid,
      resolutionCode: "terminal_suppression_applied",
      writeBackState: "unavailable_in_demo",
      revision: 5,
      lastEventId: terminalResolveEvent.id,
      updatedAt: terminalResolveEvent.occurredAt,
    } satisfies StaffSafeCareEscalation;
    const terminalAuthority = clearanceAt(terminalResolveEvent.occurredAt);
    expect(() =>
      assertCareTransition(
        terminalSuppressedEnrollment,
        terminalEnded,
        terminalResolveEvent,
        { previous: terminalSuppressedEscalation, next: terminalResolvedEscalation },
        terminalAuthority,
      ),
    ).not.toThrow();
    expect(() =>
      assertCareTransition(
        terminalSuppressedEnrollment,
        { ...terminalEnded, activeSuppressions: ["clinical_hold"] },
        { ...terminalResolveEvent, activeSuppressionsAfter: ["clinical_hold"] },
        { previous: terminalSuppressedEscalation, next: terminalResolvedEscalation },
        terminalAuthority,
      ),
    ).toThrow(/terminal suppression|drop or rewrite/i);
    expect(() =>
      assertCareTransition(
        terminalSuppressedEnrollment,
        terminalEnded,
        terminalResolveEvent,
        {
          previous: terminalSuppressedEscalation,
          next: { ...terminalResolvedEscalation, resolutionCode: "safety_hold_applied" },
        },
        terminalAuthority,
      ),
    ).toThrow(/acknowledged escalation/i);
  });

  it("keeps care schedules, escalation identity, SLA and demo write-back claims coherent", () => {
    const escalationId = "care_escalation_synthetic_001" as NonNullable<
      StaffSafeCareEnrollment["openEscalationId"]
    >;
    expect(() =>
      assertCareEnrollmentOperationalState({
        state: "escalated",
        nextContactIndex: 1,
        nextContactAt: isoDateTime("2026-08-08T09:00:00.000Z"),
        activeSuppressions: ["death"],
        openEscalationId: escalationId,
        safetyHoldEscalationId: null,
        openHandoffId: null,
      }),
    ).not.toThrow();
    expect(() =>
      assertCareEnrollmentOperationalState({
        state: "active",
        nextContactIndex: 1,
        nextContactAt: null,
        activeSuppressions: [],
        openEscalationId: null,
        safetyHoldEscalationId: null,
        openHandoffId: null,
      }),
    ).toThrow(/nextContactAt/i);
    expect(() =>
      assertCareEnrollmentOperationalState({
        state: "active",
        nextContactIndex: 1,
        nextContactAt: "invalid" as never,
        activeSuppressions: [],
        openEscalationId: null,
        safetyHoldEscalationId: null,
        openHandoffId: null,
      }),
    ).toThrow(/canonical ISO/i);

    const escalation = {
      state: "open" as const,
      openedAt: isoDateTime("2026-08-07T09:00:00.000Z"),
      responseSlaMinutes: 15,
      responseDueAt: isoDateTime("2026-08-07T09:15:00.000Z"),
      openedBy: { actorKind: "system" as const, actorUid: null },
      acknowledgedAt: null,
      acknowledgedByUid: null,
      resolvedAt: null,
      resolvedByUid: null,
      resolutionCode: null,
      writeBackRequired: true,
      writeBackState: "pending" as const,
    };
    expect(() => assertCareEscalationLifecycle(escalation)).not.toThrow();
    expect(() =>
      assertCareEscalationLifecycle({
        ...escalation,
        state: "acknowledged",
        acknowledgedAt: "invalid" as never,
        acknowledgedByUid: entityId<"User">("user_synthetic_clinical_approver"),
      }),
    ).toThrow(/canonical ISO/i);
    expect(() =>
      assertCareEscalationLifecycle({
        ...escalation,
        writeBackState: "recorded",
      } as never),
    ).toThrow(/cannot claim/i);
  });
});

describe("deterministic care contact gating", () => {
  const base = {
    suppressionReasons: [],
    contactSuppressAll: false,
    contactSuppressMarketing: false,
    contactInvalid: false,
    careConsentStatus: "granted",
    humanTakeoverActive: false,
    openEscalation: false,
  } as const;

  it("keeps configured pathway order distinct from operational precedence", () => {
    expect(CARE_PATHWAY_SUPPRESSIONS).toEqual([
      "readmission",
      "transfer",
      "death",
      "clinical_hold",
      "withdrawal",
      "invalid_contact",
    ]);
    expect(CARE_SUPPRESSION_PRECEDENCE).toEqual([
      "death",
      "invalid_contact",
      "readmission",
      "transfer",
      "clinical_hold",
      "withdrawal",
    ]);
  });

  it("applies the exact safety precedence", () => {
    expect(
      evaluateCareContactGate({
        ...base,
        suppressionReasons: ["readmission", "death", "clinical_hold"],
        openEscalation: true,
        contactSuppressAll: true,
        contactInvalid: true,
      }).reason,
    ).toBe("death");
    expect(
      evaluateCareContactGate({ ...base, suppressionReasons: ["readmission"], openEscalation: true }).reason,
    ).toBe("open_escalation");
    expect(
      evaluateCareContactGate({ ...base, suppressionReasons: ["readmission"], contactSuppressAll: true }).reason,
    ).toBe("contact_suppress_all");
    expect(
      evaluateCareContactGate({ ...base, suppressionReasons: ["readmission"], contactInvalid: true }).reason,
    ).toBe("invalid_contact");
    expect(
      evaluateCareContactGate({ ...base, suppressionReasons: ["readmission", "transfer"] }).reason,
    ).toBe("readmission");
    expect(
      evaluateCareContactGate({ ...base, suppressionReasons: ["transfer", "clinical_hold"] }).reason,
    ).toBe("transfer");
    expect(
      evaluateCareContactGate({ ...base, suppressionReasons: ["clinical_hold", "withdrawal"] }).reason,
    ).toBe("clinical_hold");
    expect(
      evaluateCareContactGate({ ...base, suppressionReasons: ["withdrawal"], humanTakeoverActive: true }).reason,
    ).toBe("withdrawal");
    expect(
      evaluateCareContactGate({ ...base, careConsentStatus: "unknown", humanTakeoverActive: true }).reason,
    ).toBe("care_consent_unavailable");
    expect(evaluateCareContactGate({ ...base, humanTakeoverActive: true }).reason).toBe(
      "human_takeover",
    );
  });

  it("does not let marketing-only suppression block justified care utility", () => {
    expect(evaluateCareContactGate({ ...base, contactSuppressMarketing: true })).toEqual({
      allowed: true,
      reason: null,
      terminalWithinEnrollment: false,
      clinicalClearanceRequired: false,
    });
  });
});

describe("canonical idempotency receipt keys and payloads", () => {
  it("derives source fingerprints from provider-isolated canonical identities", () => {
    const automationSource: AutomationSourceEventIdentityBinding = {
      workspaceId: "workspace_safenet_demo",
      connectionId: "connection_synthetic_meta_001",
      eventKind: "appointment_event",
      sourceEventId: "evt_immutable_001",
    };
    const careSource: CareDischargeSourceIdentityBinding = {
      workspaceId: "workspace_safenet_demo",
      sourceSystem: "synthetic_his",
      connectionId: "connection_synthetic_his_001",
      dischargeEventId: "discharge_immutable_001",
    };
    const automationCanonical = serializeAutomationSourceEventIdentity(automationSource);
    const careCanonical = serializeCareDischargeSourceIdentity(careSource);

    expect(automationCanonical).toBe(
      `["hemas-connect:automation-source-event:v1","workspace_safenet_demo","connection_synthetic_meta_001","appointment_event","evt_immutable_001"]`,
    );
    expect(hash(automationCanonical)).toBe(
      "e77480afae474fd70b72f30f59a5a9b0bfa7fb66a8bf96cfe15a9c0248c138a5",
    );
    expect(careCanonical).toBe(
      `["hemas-connect:care-discharge-source:v1","workspace_safenet_demo","synthetic_his","connection_synthetic_his_001","discharge_immutable_001"]`,
    );
    expect(hash(careCanonical)).toBe(
      "13ead8b4e5d35a286d65aba978ed86ef9cc5145d4b095e0fb54dea94e0ab147e",
    );
    expect(hash(serializeAutomationSourceEventIdentity({ ...automationSource }))).toBe(
      hash(automationCanonical),
    );
    expect(
      new Set([
        hash(serializeAutomationSourceEventIdentity({
          ...automationSource,
          connectionId: "connection_synthetic_meta_002",
        })),
        hash(serializeAutomationSourceEventIdentity({
          ...automationSource,
          eventKind: "lims_report_ready",
        })),
        hash(serializeAutomationSourceEventIdentity({
          ...automationSource,
          sourceEventId: "evt_immutable_002",
        })),
      ]).has(hash(automationCanonical)),
    ).toBe(false);
    expect(
      new Set([
        hash(serializeCareDischargeSourceIdentity({
          ...careSource,
          sourceSystem: "synthetic_lims",
        })),
        hash(serializeCareDischargeSourceIdentity({
          ...careSource,
          connectionId: "connection_synthetic_his_002",
        })),
        hash(serializeCareDischargeSourceIdentity({
          ...careSource,
          dischargeEventId: "discharge_immutable_002",
        })),
      ]).has(hash(careCanonical)),
    ).toBe(false);
    expect(() =>
      serializeAutomationSourceEventIdentity({
        ...automationSource,
        rawPayload: "forbidden",
      } as unknown as AutomationSourceEventIdentityBinding),
    ).toThrow(/exactly/i);
    expect(() =>
      serializeCareDischargeSourceIdentity({
        ...careSource,
        patientReference: "forbidden",
      } as unknown as CareDischargeSourceIdentityBinding),
    ).toThrow(/exactly/i);
  });

  it("keeps the automation receipt key stable across substituted run and definition versions", () => {
    const keyBinding: AutomationTriggerReceiptKeyBinding = {
      workspaceId: automationContent.workspaceId,
      family: "appointment_service",
      sourceEventFingerprint: "9".repeat(64),
    };
    const key = serializeAutomationTriggerReceiptKey(keyBinding);
    const fingerprint = syntheticHmac(key);
    const payload = (runId: string): AutomationTriggerReceiptPayloadBinding => ({
      receiptId: fingerprint,
      triggerFingerprint: fingerprint,
      workspaceId: keyBinding.workspaceId,
      family: keyBinding.family,
      definitionId: automationContent.definitionId,
      definitionVersion: automationContent.version,
      definitionContentHash: automationApprovedContentHash,
      definitionApprovalHash: automationApprovedApprovalHash,
      activationEventId: "automation_definition_event_synthetic_activate_001",
      sourceEventFingerprint: keyBinding.sourceEventFingerprint,
      runId,
      createdAt: "2026-08-07T09:45:00.000Z",
      schemaVersion: 1,
      synthetic: true,
    });
    const first = payload("automation_run_synthetic_001");
    const substituted = payload("automation_run_synthetic_999");
    const substitutedVersion = {
      ...first,
      definitionId: "automation_synthetic_appointment_v2",
      definitionVersion: 4,
    };

    expect(key).toBe(
      `["hemas-connect:automation-trigger-receipt-key:v2","workspace_safenet_demo","appointment_service","${"9".repeat(64)}"]`,
    );
    expect(key).not.toContain(first.runId);
    expect(key).not.toContain(first.definitionId);
    expect(fingerprint).toBe("5acca6071572070b4c030323feb6b3457fc1f3c3cdf629e51a0e3b745a9cbc7b");
    expect(first.receiptId).toBe(substituted.receiptId);
    expect(first.receiptId).toBe(substitutedVersion.receiptId);
    expect(serializeAutomationTriggerReceiptPayload(first)).not.toBe(
      serializeAutomationTriggerReceiptPayload(substituted),
    );
    expect(serializeAutomationTriggerReceiptPayload(first)).not.toBe(
      serializeAutomationTriggerReceiptPayload(substitutedVersion),
    );
    expect(serializeAutomationTriggerReceiptPayload(first)).toBe(
      `["hemas-connect:automation-trigger-receipt-payload:v2","${fingerprint}","${fingerprint}","workspace_safenet_demo","appointment_service","automation_synthetic_appointment_v1",3,"${automationApprovedContentHash}","${automationApprovedApprovalHash}","automation_definition_event_synthetic_activate_001","${"9".repeat(64)}","automation_run_synthetic_001","2026-08-07T09:45:00.000Z",1,true]`,
    );
    expect(hash(serializeAutomationTriggerReceiptPayload(first))).toBe(
      "de32e2f8e5e73dd11a0f01390e3d3064e088dc4a34355fd2b8703a31b4dad8ec",
    );
    expect(() =>
      assertAutomationTriggerReceiptIdentity(
        {
          id: fingerprint as never,
          triggerFingerprint: hmacDigest(fingerprint),
        },
        hmacDigest(fingerprint),
      ),
    ).not.toThrow();
    expect(() => assertAutomationTriggerReceiptReplayBinding(first, syntheticHmac)).not.toThrow();
    expect(() =>
      assertAutomationTriggerReceiptImmutableReplay(first, { ...first }, syntheticHmac),
    ).not.toThrow();
    expect(() =>
      assertAutomationTriggerReceiptImmutableReplay(first, substituted, syntheticHmac),
    ).toThrow(/every immutable payload field/i);

    const receiptProjection = {
      id: fingerprint as AutomationTriggerReceiptSecretProjection["id"],
      workspaceId: entityId<"Workspace">(first.workspaceId),
      family: first.family,
      definitionId: entityId<"AutomationDefinition">(first.definitionId),
      definitionVersion: first.definitionVersion,
      definitionContentHash: sha256Digest(first.definitionContentHash),
      definitionApprovalHash: sha256Digest(first.definitionApprovalHash),
      activationEventId:
        first.activationEventId as AutomationTriggerReceiptSecretProjection["activationEventId"],
      sourceEventFingerprint: sha256Digest(first.sourceEventFingerprint),
      triggerFingerprint: hmacDigest(first.triggerFingerprint),
      runId: entityId<"AutomationRun">(first.runId),
      createdAt: isoDateTime(first.createdAt),
      schemaVersion: 1,
      synthetic: true,
    } satisfies AutomationTriggerReceiptSecretProjection;
    const runSecret = {
      workspaceId: receiptProjection.workspaceId,
      runId: receiptProjection.runId,
      protectedContactRef: encryptedValueRef("demo://automation/contact/synthetic-001"),
      protectedConversationRef: encryptedValueRef("demo://automation/conversation/synthetic-001"),
      protectedAppointmentRef: encryptedValueRef("demo://automation/appointment/synthetic-001"),
      triggerFingerprint: receiptProjection.triggerFingerprint,
      idempotencyFingerprint: receiptProjection.triggerFingerprint,
      schemaVersion: 1,
      synthetic: true,
    } satisfies AutomationRunSecretProjection;
    const run = {
      id: receiptProjection.runId,
      workspaceId: receiptProjection.workspaceId,
      definitionId: receiptProjection.definitionId,
      definitionVersion: receiptProjection.definitionVersion,
      definitionContentHash: receiptProjection.definitionContentHash,
      teamId: entityId<"Team">("team_synthetic_appointments"),
      locationId: entityId<"Location">("location_synthetic_wattala"),
      state: "running",
      pausedFromState: null,
      nextEligibleAt: null,
      openWorkItemId: null,
      currentStepIndex: 0,
      completedStepCount: 0,
      attemptCount: 0,
      revision: 1,
      outcomeCode: "accepted",
      lastEventId: null,
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
      createdAt: isoDateTime("2026-08-07T09:45:00.000Z"),
      updatedAt: isoDateTime("2026-08-07T09:45:00.000Z"),
    } satisfies StaffSafeAutomationRun;
    const activation = {
      workspaceId: receiptProjection.workspaceId,
      family: receiptProjection.family,
      activeDefinitionId: receiptProjection.definitionId,
      activeDefinitionVersion: receiptProjection.definitionVersion,
      activeDefinitionContentHash: receiptProjection.definitionContentHash,
      activeDefinitionApprovalHash: receiptProjection.definitionApprovalHash,
      activationEventId: receiptProjection.activationEventId,
      activatedAt: isoDateTime("2026-08-07T09:44:00.000Z"),
    };
    expect(() => assertAutomationRunSecretReceiptLink(runSecret, receiptProjection)).not.toThrow();
    expect(() => assertAutomationTriggerReceiptRunBinding(receiptProjection, run)).not.toThrow();
    expect(() =>
      assertAutomationTriggerReceiptChronology(activation, receiptProjection, run),
    ).not.toThrow();
    expect(() =>
      assertAutomationTriggerReceiptChronology(
        { ...activation, activatedAt: isoDateTime("2026-08-07T09:46:00.000Z") },
        receiptProjection,
        run,
      ),
    ).toThrow(/chronology/i);
    for (const substitutedActivation of [
      {
        ...activation,
        activeDefinitionId: entityId<"AutomationDefinition">(
          "automation_definition_substituted",
        ),
      },
      { ...activation, activeDefinitionVersion: activation.activeDefinitionVersion + 1 },
      {
        ...activation,
        activeDefinitionContentHash: sha256Digest("0".repeat(64)),
      },
      {
        ...activation,
        activeDefinitionApprovalHash: sha256Digest("1".repeat(64)),
      },
    ]) {
      expect(() =>
        assertAutomationTriggerReceiptChronology(
          substitutedActivation,
          receiptProjection,
          run,
        ),
      ).toThrow(/chronology/i);
    }
    expect(() =>
      assertAutomationTriggerReceiptChronology(
        activation,
        receiptProjection,
        { ...run, createdAt: isoDateTime("2026-08-07T09:45:01.000Z") },
      ),
    ).toThrow(/chronology/i);
    for (const substitutedRun of [
      { ...run, workspaceId: entityId<"Workspace">("workspace_substituted") },
      { ...run, id: entityId<"AutomationRun">("automation_run_substituted") },
      { ...run, definitionId: entityId<"AutomationDefinition">("automation_definition_substituted") },
      { ...run, definitionVersion: 4 },
      { ...run, definitionContentHash: sha256Digest("0".repeat(64)) },
    ]) {
      expect(() =>
        assertAutomationTriggerReceiptRunBinding(receiptProjection, substitutedRun),
      ).toThrow(/staff-safe run aggregate/i);
    }
    expect(() =>
      assertAutomationRunSecretReceiptLink(
        { ...runSecret, triggerFingerprint: hmacDigest("0".repeat(64)) },
        receiptProjection,
      ),
    ).toThrow(/cross-bind/i);
    expect(() =>
      serializeAutomationTriggerReceiptKey({
        ...keyBinding,
        runId: first.runId,
      } as unknown as AutomationTriggerReceiptKeyBinding),
    ).toThrow(/exactly/i);
    expect(() =>
      serializeAutomationTriggerReceiptPayload({ ...first, receiptId: "0".repeat(64) }),
    ).toThrow(/must equal/i);
    expect(() =>
      serializeAutomationTriggerReceiptPayload({
        ...first,
        unapprovedField: true,
      } as unknown as AutomationTriggerReceiptPayloadBinding),
    ).toThrow(/exactly/i);
    for (const family of [
      "care_pathway",
      "feedback",
      "inbound_routing",
      "campaign_response",
      "scheduled_service",
    ]) {
      expect(() =>
        serializeAutomationTriggerReceiptKey({ ...keyBinding, family } as never),
      ).toThrow(/not executable/i);
      expect(() =>
        serializeAutomationTriggerReceiptPayload({ ...first, family } as never),
      ).toThrow(/not executable/i);
    }
  });

  it("keeps the care receipt key stable across substituted enrollment and protocol versions", () => {
    const keyBinding: CareEnrollmentReceiptKeyBinding = {
      workspaceId: careContent.workspaceId,
      family: careContent.family,
      dischargeFingerprint: "a".repeat(64),
    };
    const key = serializeCareEnrollmentReceiptKey(keyBinding);
    const fingerprint = syntheticHmac(key);
    const payload = (enrollmentId: string): CareEnrollmentReceiptPayloadBinding => ({
      receiptId: fingerprint,
      receiptFingerprint: fingerprint,
      workspaceId: keyBinding.workspaceId,
      family: keyBinding.family,
      pathwayId: careContent.pathwayId,
      pathwayProtocolVersion: careContent.protocolVersion,
      pathwayContentHash: careApprovedContentHash,
      pathwayApprovalHash: careApprovedApprovalHash,
      activationEventId: "care_pathway_event_synthetic_activate_001",
      dischargeFingerprint: keyBinding.dischargeFingerprint,
      qualifyingDischargeAt: careScheduleAnchorAt,
      enrollmentId,
      createdAt: "2026-08-07T09:50:00.000Z",
      schemaVersion: 1,
      synthetic: true,
    });
    const first = payload("care_enrollment_synthetic_001");
    const substituted = payload("care_enrollment_synthetic_999");
    const substitutedProtocol = {
      ...first,
      pathwayId: "care_pathway_synthetic_followup_v2",
      pathwayProtocolVersion: "v2.0",
    };

    expect(key).toBe(
      `["hemas-connect:care-enrollment-receipt-key:v2","workspace_safenet_demo","post_discharge","${"a".repeat(64)}"]`,
    );
    expect(key).not.toContain(first.enrollmentId);
    expect(key).not.toContain(first.pathwayId);
    expect(fingerprint).toBe("8d1993ce7faa843b278bc88047800822e9556f272f1e8fbac290a69479064507");
    expect(first.receiptId).toBe(substituted.receiptId);
    expect(first.receiptId).toBe(substitutedProtocol.receiptId);
    expect(serializeCareEnrollmentReceiptPayload(first)).not.toBe(
      serializeCareEnrollmentReceiptPayload(substituted),
    );
    expect(serializeCareEnrollmentReceiptPayload(first)).not.toBe(
      serializeCareEnrollmentReceiptPayload(substitutedProtocol),
    );
    expect(serializeCareEnrollmentReceiptPayload(first)).toBe(
      `["hemas-connect:care-enrollment-receipt-payload:v2","${fingerprint}","${fingerprint}","workspace_safenet_demo","post_discharge","care_pathway_synthetic_followup_v1","v1.0","${careApprovedContentHash}","${careApprovedApprovalHash}","care_pathway_event_synthetic_activate_001","${"a".repeat(64)}","${careScheduleAnchorAt}","care_enrollment_synthetic_001","2026-08-07T09:50:00.000Z",1,true]`,
    );
    expect(hash(serializeCareEnrollmentReceiptPayload(first))).toBe(
      "655e8138077ee67d026f8a3d9a16f5654db4c3f1b73b3d1f3794b1e6a8a9a9bd",
    );
    expect(() =>
      assertCareEnrollmentReceiptIdentity(
        {
          id: fingerprint as never,
          receiptFingerprint: hmacDigest(fingerprint),
        },
        hmacDigest(fingerprint),
      ),
    ).not.toThrow();
    expect(() => assertCareEnrollmentReceiptReplayBinding(first, syntheticHmac)).not.toThrow();
    expect(() =>
      assertCareEnrollmentReceiptImmutableReplay(first, { ...first }, syntheticHmac),
    ).not.toThrow();
    expect(() =>
      assertCareEnrollmentReceiptImmutableReplay(first, substituted, syntheticHmac),
    ).toThrow(/every immutable payload field/i);
    expect(() =>
      assertCareEnrollmentReceiptImmutableReplay(
        first,
        {
          ...first,
          qualifyingDischargeAt: "2026-08-06T09:00:01.000Z",
        },
        syntheticHmac,
      ),
    ).toThrow(/every immutable payload field/i);
    const receiptProjection = {
      id: fingerprint as CareEnrollmentReceiptSecretProjection["id"],
      workspaceId: entityId<"Workspace">("workspace_safenet_demo"),
      family: "post_discharge",
      pathwayId: entityId<"CarePathway">(careContent.pathwayId),
      pathwayProtocolVersion: careContent.protocolVersion,
      pathwayContentHash: sha256Digest(careApprovedContentHash),
      pathwayApprovalHash: sha256Digest(careApprovedApprovalHash),
      activationEventId:
        "care_pathway_event_synthetic_activate_001" as CareEnrollmentReceiptSecretProjection["activationEventId"],
      dischargeFingerprint: sha256Digest(keyBinding.dischargeFingerprint),
      qualifyingDischargeAt: careScheduleAnchorAt,
      receiptFingerprint: hmacDigest(fingerprint),
      enrollmentId: entityId<"CareEnrollment">(first.enrollmentId),
      createdAt: isoDateTime(first.createdAt),
      schemaVersion: 1,
      synthetic: true,
    } satisfies CareEnrollmentReceiptSecretProjection;
    const enrollmentSecret = {
      workspaceId: receiptProjection.workspaceId,
      enrollmentId: receiptProjection.enrollmentId,
      protectedContactRef: encryptedValueRef("demo://care/contact/synthetic-001"),
      protectedConversationRef: encryptedValueRef("demo://care/conversation/synthetic-001"),
      protectedQualifyingDischargeRef: encryptedValueRef("demo://care/discharge/synthetic-001"),
      qualifyingDischargeAt: careScheduleAnchorAt,
      subjectFingerprint: hmacDigest("b".repeat(64)),
      sourceDischargeFingerprint: receiptProjection.dischargeFingerprint,
      receiptId: receiptProjection.id,
      receiptFingerprint: receiptProjection.receiptFingerprint,
      schemaVersion: 1,
      synthetic: true,
    } satisfies CareEnrollmentSecretProjection;
    expect(() =>
      assertCareEnrollmentSecretReceiptLink(enrollmentSecret, receiptProjection),
    ).not.toThrow();
    expect(() =>
      assertCareEnrollmentSecretReceiptLink(
        {
          ...enrollmentSecret,
          qualifyingDischargeAt: isoDateTime("2026-08-08T00:00:00.000Z"),
        },
        receiptProjection,
      ),
    ).toThrow(/immutable receipt/i);
    const enrollment = {
      id: receiptProjection.enrollmentId,
      workspaceId: receiptProjection.workspaceId,
      pathwayId: receiptProjection.pathwayId,
      pathwayProtocolVersion: receiptProjection.pathwayProtocolVersion,
      pathwayContentHash: receiptProjection.pathwayContentHash,
      teamId: entityId<"Team">("team_synthetic_clinical_escalation"),
      locationId: entityId<"Location">("location_synthetic_wattala"),
      state: "queued",
      nextContactIndex: 0,
      nextContactAt: isoDateTime("2026-08-08T09:00:00.000Z"),
      activeSuppressions: [],
      openEscalationId: null,
      safetyHoldEscalationId: null,
      openHandoffId: null,
      revision: 1,
      outcomeCode: "accepted",
      lastEventId: null,
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
      createdAt: isoDateTime("2026-08-07T09:50:00.000Z"),
      updatedAt: isoDateTime("2026-08-07T09:50:00.000Z"),
    } satisfies StaffSafeCareEnrollment;
    const activation = {
      workspaceId: receiptProjection.workspaceId,
      family: receiptProjection.family,
      activePathwayId: receiptProjection.pathwayId,
      activeProtocolVersion: receiptProjection.pathwayProtocolVersion,
      activePathwayContentHash: receiptProjection.pathwayContentHash,
      activePathwayApprovalHash: receiptProjection.pathwayApprovalHash,
      activationEventId: receiptProjection.activationEventId,
      activatedAt: isoDateTime("2026-08-07T09:49:00.000Z"),
    };
    expect(() =>
      assertCareEnrollmentReceiptAggregateBinding(receiptProjection, enrollment),
    ).not.toThrow();
    expect(() =>
      assertCareEnrollmentReceiptChronology(activation, receiptProjection, enrollment),
    ).not.toThrow();
    expect(() =>
      assertCareEnrollmentReceiptChronology(
        { ...activation, activatedAt: isoDateTime("2026-08-07T09:51:00.000Z") },
        receiptProjection,
        enrollment,
      ),
    ).toThrow(/chronology/i);
    for (const substitutedActivation of [
      {
        ...activation,
        activePathwayId: entityId<"CarePathway">("care_pathway_substituted"),
      },
      { ...activation, activeProtocolVersion: "v2.0" },
      {
        ...activation,
        activePathwayContentHash: sha256Digest("0".repeat(64)),
      },
      {
        ...activation,
        activePathwayApprovalHash: sha256Digest("1".repeat(64)),
      },
    ]) {
      expect(() =>
        assertCareEnrollmentReceiptChronology(
          substitutedActivation,
          receiptProjection,
          enrollment,
        ),
      ).toThrow(/chronology/i);
    }
    expect(() =>
      assertCareEnrollmentReceiptChronology(
        activation,
        receiptProjection,
        { ...enrollment, createdAt: isoDateTime("2026-08-07T09:50:01.000Z") },
      ),
    ).toThrow(/chronology/i);
    expect(() =>
      assertCareEnrollmentReceiptChronology(
        activation,
        {
          ...receiptProjection,
          qualifyingDischargeAt: isoDateTime("2026-08-07T09:50:01.000Z"),
        },
        enrollment,
      ),
    ).toThrow(/chronology/i);
    for (const substitutedEnrollment of [
      { ...enrollment, workspaceId: entityId<"Workspace">("workspace_substituted") },
      { ...enrollment, id: entityId<"CareEnrollment">("care_enrollment_substituted") },
      { ...enrollment, pathwayId: entityId<"CarePathway">("care_pathway_substituted") },
      { ...enrollment, pathwayProtocolVersion: "v2.0" },
      { ...enrollment, pathwayContentHash: sha256Digest("0".repeat(64)) },
    ]) {
      expect(() =>
        assertCareEnrollmentReceiptAggregateBinding(receiptProjection, substitutedEnrollment),
      ).toThrow(/staff-safe enrollment aggregate/i);
    }
    expect(() =>
      assertCareEnrollmentSecretReceiptLink(
        { ...enrollmentSecret, sourceDischargeFingerprint: sha256Digest("c".repeat(64)) },
        receiptProjection,
      ),
    ).toThrow(/cross-bind/i);
    expect(() =>
      assertCareEnrollmentSecretReceiptLink(
        { ...enrollmentSecret, receiptFingerprint: hmacDigest("d".repeat(64)) },
        receiptProjection,
      ),
    ).toThrow(/canonical HMAC/i);
    expect(() =>
      serializeCareEnrollmentReceiptKey({
        ...keyBinding,
        enrollmentId: first.enrollmentId,
      } as unknown as CareEnrollmentReceiptKeyBinding),
    ).toThrow(/exactly/i);
    expect(() =>
      serializeCareEnrollmentReceiptPayload({
        ...first,
        receiptFingerprint: "0".repeat(64),
      }),
    ).toThrow(/must equal/i);
    expect(() =>
      serializeCareEnrollmentReceiptPayload({
        ...first,
        unapprovedField: true,
      } as unknown as CareEnrollmentReceiptPayloadBinding),
    ).toThrow(/exactly/i);
    const {
      qualifyingDischargeAt: _omittedQualifyingDischargeAt,
      ...missingScheduleAnchor
    } = first;
    expect(_omittedQualifyingDischargeAt).toBe(careScheduleAnchorAt);
    expect(() =>
      serializeCareEnrollmentReceiptPayload(
        missingScheduleAnchor as unknown as CareEnrollmentReceiptPayloadBinding,
      ),
    ).toThrow(/exactly/i);
  });
});

describe("canonical automation and care governance serialization", () => {
  it("pins the complete automation definition and approval tuples", () => {
    const secret = serializeAutomationDefinitionSecretBinding(automationSecret);
    const content = serializeAutomationDefinitionContent(automationContent);
    const contentHash = hash(content);
    const approval = serializeAutomationDefinitionApproval({
      workspaceId: automationContent.workspaceId,
      definitionId: automationContent.definitionId,
      contentHash,
      ownerUid: "user_synthetic_automation_owner",
      approverUid: "user_synthetic_automation_approver",
      scope: "simulation_only",
      approvedAt: "2026-08-07T09:00:00.000Z",
    });

    expect(secret).toBe(
      `["hemas-connect:automation-definition-secret:v1","workspace_safenet_demo","automation_synthetic_appointment_v1","demo://automation/configuration/synthetic-v1","${"1".repeat(64)}",1,true]`,
    );
    expect(content).toBe(
      `["hemas-connect:automation-definition-content:v1","workspace_safenet_demo","automation_synthetic_appointment_v1","appointment_service",3,"Synthetic appointment reminder","appointment_event","appointment_service","medium",[["step_send_appointment","send_template","template_synthetic_appointment_en_v1","${"8".repeat(64)}",null,null,null,null,"appointment_service","use_approved_template",30,3,30,300,"create_work_item"],["step_wait_reminder","wait",null,null,3600,null,null,null,"appointment_service","send_in_window",5,0,0,0,"stop_run"]],"${automationSecretBindingHash}",true]`,
    );
    expect(approval).toBe(
      `["hemas-connect:automation-definition-approval:v1","workspace_safenet_demo","automation_synthetic_appointment_v1","${contentHash}","user_synthetic_automation_owner","user_synthetic_automation_approver","simulation_only","2026-08-07T09:00:00.000Z"]`,
    );
    expect(hash(secret)).toBe("1a75cb75bd5c351e9cd4cb9746046c5110e15fa65bf8cf64d2712e0ce86f167e");
    expect(contentHash).toBe("df2941cf44b03b5fcdc56d346cafeee97dc3a52633e6e95b280c088e2dd107f3");
    expect(hash(approval)).toBe("2e4980aa95dec0c060852d5cb15b118cd5c8051c589fe92c6afd575c291ff42e");
  });

  it("pins ordered care days, locations, suppressions and localized template hashes", () => {
    const secret = serializeCarePathwaySecretBinding(careSecret);
    const content = serializeCarePathwayContent(careContent);
    const contentHash = hash(content);
    const approval = serializeCarePathwayApproval({
      workspaceId: careContent.workspaceId,
      pathwayId: careContent.pathwayId,
      contentHash,
      clinicalOwnerUid: careContent.clinicalOwnerUid,
      clinicalApproverUid: "user_synthetic_clinical_approver",
      scope: "clinical_simulation_only",
      approvedAt: "2026-08-07T09:30:00.000Z",
    });

    expect(secret).toBe(
      `["hemas-connect:care-pathway-secret:v1","workspace_safenet_demo","care_pathway_synthetic_followup_v1","demo://care/instructions/synthetic-v1","${"e".repeat(64)}",1,true]`,
    );
    expect(content).toBe(
      `["hemas-connect:care-pathway-content:v1","workspace_safenet_demo","care_pathway_synthetic_followup_v1","post_discharge","v1.0","Synthetic post-discharge follow-up","user_synthetic_clinical_owner",[[1,"template_synthetic_care_day1_en_v1","${"2".repeat(64)}","template_synthetic_care_day1_si_v1","${"3".repeat(64)}","template_synthetic_care_day1_ta_v1","${"4".repeat(64)}"],[3,"template_synthetic_care_day3_en_v1","${"5".repeat(64)}","template_synthetic_care_day3_si_v1","${"6".repeat(64)}","template_synthetic_care_day3_ta_v1","${"7".repeat(64)}"]],15,"team_synthetic_clinical_escalation",["location_synthetic_thalawathugoda","location_synthetic_wattala"],"on_call_queue",true,"clinician_authored",false,["readmission","transfer","death","clinical_hold","withdrawal","invalid_contact"],"${"e".repeat(64)}","${careSecretBindingHash}",true]`,
    );
    expect(approval).toBe(
      `["hemas-connect:care-pathway-approval:v1","workspace_safenet_demo","care_pathway_synthetic_followup_v1","${contentHash}","user_synthetic_clinical_owner","user_synthetic_clinical_approver","clinical_simulation_only","2026-08-07T09:30:00.000Z"]`,
    );
    expect(hash(secret)).toBe("551f7f7ce48404c0c0e9927445122912ca927e2a5402b2db20d47b658075da27");
    expect(contentHash).toBe("d21cba789b3a0adc799bb91a6b07b23d3af5029ecb4404d1b614ebea07789475");
    expect(hash(approval)).toBe("c247b7e129cd0b10922f0188e25e6fc09ebc9a3bc9f8710cf3c856cba7a076e2");
  });

  it("cross-binds each server-only secret projection to its public immutable hashes", () => {
    expect(() =>
      assertAutomationDefinitionSecretCrossBinding(
        automationSecret,
        {
          workspaceId: automationContent.workspaceId,
          definitionId: automationContent.definitionId,
          secretBindingHash: automationContent.secretBindingHash,
        },
        hash,
      ),
    ).not.toThrow();
    expect(() =>
      assertAutomationDefinitionSecretCrossBinding(
        { ...automationSecret, configurationFingerprint: "0".repeat(64) },
        {
          workspaceId: automationContent.workspaceId,
          definitionId: automationContent.definitionId,
          secretBindingHash: automationContent.secretBindingHash,
        },
        hash,
      ),
    ).toThrow(/does not match/i);

    expect(() =>
      assertCarePathwaySecretCrossBinding(
        careSecret,
        {
          workspaceId: careContent.workspaceId,
          pathwayId: careContent.pathwayId,
          protectedContentHash: careContent.protectedContentHash,
          secretBindingHash: careContent.secretBindingHash,
        },
        hash,
      ),
    ).not.toThrow();
    expect(() =>
      assertCarePathwaySecretCrossBinding(
        careSecret,
        {
          workspaceId: careContent.workspaceId,
          pathwayId: careContent.pathwayId,
          protectedContentHash: "d".repeat(64),
          secretBindingHash: careContent.secretBindingHash,
        },
        hash,
      ),
    ).toThrow(/does not match/i);
    expect(() =>
      assertCarePathwaySecretCrossBinding(
        careSecret,
        {
          workspaceId: careContent.workspaceId,
          pathwayId: careContent.pathwayId,
          protectedContentHash: careContent.protectedContentHash,
          secretBindingHash: "0".repeat(64),
        },
        hash,
      ),
    ).toThrow(/does not match/i);
  });

  it("rejects tuple ambiguity, missing kind fields, bad hashes and same-person approval", () => {
    expect(() =>
      serializeAutomationDefinitionContent({
        ...automationContent,
        steps: [...automationContent.steps, sendStep],
      }),
    ).toThrow(/unique/i);
    expect(() =>
      serializeAutomationDefinitionContent({
        ...automationContent,
        steps: [{ ...waitStep, waitSeconds: null }],
      }),
    ).toThrow(/waitSeconds is required/i);
    expect(() =>
      serializeAutomationDefinitionContent({
        ...automationContent,
        steps: [{ ...sendStep, templateContentHash: null }],
      }),
    ).toThrow(/templateContentHash is required/i);
    expect(() =>
      serializeAutomationDefinitionContent({
        ...automationContent,
        secretBindingHash: "not-a-hash",
      }),
    ).toThrow(/SHA-256/i);
    expect(() =>
      serializeAutomationDefinitionContent({
        ...automationContent,
        steps: Array.from({ length: 33 }, (_, index) => ({
          ...sendStep,
          id: `step_synthetic_${String(index).padStart(2, "0")}`,
        })),
      }),
    ).toThrow(/1 to 32/i);
    expect(() =>
      serializeAutomationDefinitionApproval({
        workspaceId: automationContent.workspaceId,
        definitionId: automationContent.definitionId,
        contentHash: "a".repeat(64),
        ownerUid: "user_synthetic_same",
        approverUid: "user_synthetic_same",
        scope: "simulation_only",
        approvedAt: "2026-08-07T09:00:00.000Z",
      }),
    ).toThrow(/must be different/i);
  });

  it("rejects unknown fields recursively across content, approval and secret bindings", () => {
    expect(() =>
      serializeAutomationDefinitionContent({
        ...automationContent,
        skipConsent: true,
      } as unknown as AutomationDefinitionContentBinding),
    ).toThrow(/exactly/i);
    expect(() =>
      serializeAutomationDefinitionContent({
        ...automationContent,
        steps: [{ ...sendStep, unapprovedTemplateText: "unsafe" } as unknown as AuthoritativeAutomationStep],
      }),
    ).toThrow(/exactly/i);
    expect(() =>
      serializeAutomationDefinitionApproval({
        workspaceId: automationContent.workspaceId,
        definitionId: automationContent.definitionId,
        contentHash: hash(serializeAutomationDefinitionContent(automationContent)),
        ownerUid: "user_synthetic_owner",
        approverUid: "user_synthetic_approver",
        scope: "simulation_only",
        approvedAt: "2026-08-07T09:00:00.000Z",
        bypassReview: true,
      } as unknown as Parameters<typeof serializeAutomationDefinitionApproval>[0]),
    ).toThrow(/exactly/i);
    expect(() =>
      serializeAutomationDefinitionSecretBinding({
        ...automationSecret,
        rawSecret: "must-never-be-stored",
      } as unknown as AutomationDefinitionSecretBinding),
    ).toThrow(/exactly/i);

    expect(() =>
      serializeCarePathwayContent({
        ...careContent,
        aiGeneratedInstructions: true,
      } as unknown as CarePathwayContentBinding),
    ).toThrow(/exactly/i);
    expect(() =>
      serializeCarePathwayContent({
        ...careContent,
        contactPoints: [
          { ...careContent.contactPoints[0]!, hiddenInstruction: "unsafe" } as never,
        ],
      }),
    ).toThrow(/exactly/i);
    expect(() =>
      serializeCarePathwayContent({
        ...careContent,
        contactPoints: [
          {
            ...careContent.contactPoints[0]!,
            en: { ...careContent.contactPoints[0]!.en, rawText: "unsafe" } as never,
          },
        ],
      }),
    ).toThrow(/exactly/i);
    expect(() =>
      serializeCarePathwayApproval({
        workspaceId: careContent.workspaceId,
        pathwayId: careContent.pathwayId,
        contentHash: hash(serializeCarePathwayContent(careContent)),
        clinicalOwnerUid: careContent.clinicalOwnerUid,
        clinicalApproverUid: "user_synthetic_clinical_approver",
        scope: "clinical_simulation_only",
        approvedAt: "2026-08-07T09:30:00.000Z",
        bypassClinicalReview: true,
      } as unknown as Parameters<typeof serializeCarePathwayApproval>[0]),
    ).toThrow(/exactly/i);
    expect(() =>
      serializeCarePathwaySecretBinding({
        ...careSecret,
        medicationText: "unsafe",
      } as unknown as CarePathwaySecretBinding),
    ).toThrow(/exactly/i);
  });

  it("rejects unordered or duplicate care schedule and location bindings", () => {
    expect(() =>
      serializeCarePathwayContent({
        ...careContent,
        contactPoints: [careContent.contactPoints[1]!, careContent.contactPoints[0]!],
      }),
    ).toThrow(/strictly ordered/i);
    expect(() =>
      serializeCarePathwayContent({
        ...careContent,
        contactPoints: [
          careContent.contactPoints[0]!,
          { ...careContent.contactPoints[1]!, dayOffset: 1 },
        ],
      }),
    ).toThrow(/strictly ordered/i);
    expect(() =>
      serializeCarePathwayContent({
        ...careContent,
        eligibleLocationIds: [
          "location_synthetic_wattala",
          "location_synthetic_thalawathugoda",
        ],
      }),
    ).toThrow(/strictly ordered/i);
    expect(() =>
      serializeCarePathwayContent({
        ...careContent,
        eligibleLocationIds: [
          "location_synthetic_wattala",
          "location_synthetic_wattala",
        ],
      }),
    ).toThrow(/strictly ordered/i);
    expect(() =>
      serializeCarePathwayApproval({
        workspaceId: careContent.workspaceId,
        pathwayId: careContent.pathwayId,
        contentHash: "b".repeat(64),
        clinicalOwnerUid: "user_synthetic_same",
        clinicalApproverUid: "user_synthetic_same",
        scope: "clinical_simulation_only",
        approvedAt: "2026-08-07T09:30:00.000Z",
      }),
    ).toThrow(/must be different/i);
  });
});

describe("staff-safe execution projections", () => {
  it("contain only governed metadata and zero synthetic external counters", () => {
    const run = {
      id: entityId<"AutomationRun">("automation_run_synthetic_001"),
      workspaceId: entityId<"Workspace">("workspace_safenet_demo"),
      definitionId: entityId<"AutomationDefinition">("automation_synthetic_appointment_v1"),
      definitionVersion: 3,
      definitionContentHash: sha256Digest("a".repeat(64)),
      teamId: entityId<"Team">("team_synthetic_appointments"),
      locationId: entityId<"Location">("location_synthetic_wattala"),
      state: "waiting",
      pausedFromState: null,
      nextEligibleAt: isoDateTime("2026-08-07T10:05:00.000Z"),
      openWorkItemId: null,
      currentStepIndex: 1,
      completedStepCount: 1,
      attemptCount: 1,
      revision: 4,
      outcomeCode: "wait_scheduled",
      lastEventId: "automation_event_synthetic_004" as StaffSafeAutomationRun["lastEventId"],
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
      createdAt: isoDateTime("2026-08-07T09:00:00.000Z"),
      updatedAt: isoDateTime("2026-08-07T09:05:00.000Z"),
    } satisfies StaffSafeAutomationRun;
    const enrollment = {
      id: entityId<"CareEnrollment">("care_enrollment_synthetic_001"),
      workspaceId: entityId<"Workspace">("workspace_safenet_demo"),
      pathwayId: entityId<"CarePathway">("care_pathway_synthetic_followup_v1"),
      pathwayProtocolVersion: "v1.0",
      pathwayContentHash: sha256Digest("b".repeat(64)),
      teamId: entityId<"Team">("team_synthetic_clinical_escalation"),
      locationId: entityId<"Location">("location_synthetic_wattala"),
      state: "paused_for_safety",
      nextContactIndex: 1,
      nextContactAt: isoDateTime("2026-08-08T09:00:00.000Z"),
      activeSuppressions: ["clinical_hold"],
      openEscalationId: null,
      safetyHoldEscalationId: null,
      openHandoffId: null,
      revision: 7,
      outcomeCode: "clinical_hold_applied",
      lastEventId: "care_event_synthetic_007" as StaffSafeCareEnrollment["lastEventId"],
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
      createdAt: isoDateTime("2026-08-07T09:00:00.000Z"),
      updatedAt: isoDateTime("2026-08-07T09:10:00.000Z"),
    } satisfies StaffSafeCareEnrollment;

    const serialized = JSON.stringify({ run, enrollment });
    expect(serialized).not.toMatch(
      /triggerEventId|idempotencyKey|messageId|providerId|externalDischargeRef|contactId|conversationId|appointmentId|clinicalText|medication|dose|rawError/i,
    );
    expect(run.externalDispatchCount).toBe(0);
    expect(run.networkCallCount).toBe(0);
    expect(enrollment.externalDispatchCount).toBe(0);
    expect(enrollment.networkCallCount).toBe(0);
  });
});
