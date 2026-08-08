import { createHash } from "node:crypto";
import type { Firestore } from "firebase/firestore";
import { describe, expect, it, vi } from "vitest";

import {
  assertAutomationActionEvidence,
  assertCareActionEvidence,
  automationWorkspaceAuthorityKey,
  availableAutomationActions,
  availableCareActions,
  buildAutomationActionRequest,
  buildCareActionRequest,
  loadAutomationWorkspace,
  SYNTHETIC_AUTOMATION_RUN_ID,
  SYNTHETIC_AUTOMATION_SCOPE,
  SYNTHETIC_CARE_ENROLLMENT_ID,
  SYNTHETIC_CARE_PATHWAY_ID,
  SYNTHETIC_CARE_SCOPE,
  type AutomationActionEvidence,
  type AutomationCatalogueRecord,
  type AutomationOperationRecord,
  type AutomationWorkspaceReads,
  type CareActionEvidence,
  type CareCatalogueRecord,
  type CareOperationRecord,
} from "@/components/automations/automation-workspace-data";
import {
  automationControlResultFingerprint,
  careControlResultFingerprint,
  type AutomationFunctionsRequest,
  type AutomationFunctionsResponse,
  type CareFunctionsRequest,
  type CareFunctionsResponse,
} from "@/lib/firebase/automation-care-functions-emulator";
import type {
  AuthoritativeAutomationDefinition,
  AuthoritativeCarePathway,
  StaffSafeAutomationActivation,
  StaffSafeAutomationDefinitionEvent,
  StaffSafeAutomationRun,
  StaffSafeAutomationRunEvent,
  StaffSafeAutomationWorkItem,
  StaffSafeCareEnrollment,
  StaffSafeCareEnrollmentEvent,
  StaffSafeCareEscalation,
  StaffSafeCareHandoff,
  StaffSafeCarePathwayActivation,
  StaffSafeCarePathwayEvent,
} from "@/lib/domain/automations";
import type { Phase5AuditRecordDTO } from "@/lib/firebase/repositories";
import { isoDateTime, type ISODateTime } from "@/lib/domain/primitives";
import type {
  VerifiedWorkspaceSession,
  WorkspaceRole,
} from "@/lib/firebase/workspace-session-model";

const workspaceId = "workspace_safenet_demo";
const activatedAt = isoDateTime("2026-08-07T13:03:00.000Z");
const createdAt = isoDateTime("2026-08-07T13:04:00.000Z");
const digest = (character: string) => character.repeat(64);
const db = {} as Firestore;

function session(
  role: WorkspaceRole,
  overrides: Partial<VerifiedWorkspaceSession> = {},
): VerifiedWorkspaceSession {
  return {
    workspaceId,
    workspaceName: "SafeNet demo",
    workspaceMode: "demo",
    dataClassification: "synthetic_only",
    uid: `user_demo_${role}`,
    displayLabel: `Synthetic ${role}`,
    role,
    scopeMode: role === "tenant_admin" ? "workspace_wide" : "assigned",
    teamIds:
      role === "clinical_approver"
        ? [SYNTHETIC_CARE_SCOPE.teamId]
        : [SYNTHETIC_AUTOMATION_SCOPE.teamId],
    locationIds: [SYNTHETIC_AUTOMATION_SCOPE.locationId],
    ...overrides,
  };
}

function definition(family: "appointment_service" | "laboratory_service") {
  const service = family === "appointment_service" ? "appointment" : "laboratory";
  return {
    id: `automation_synthetic_${service}_v3`,
    workspaceId,
    family,
    version: 3,
    name: `Synthetic ${service}`,
    trigger: family === "appointment_service" ? "appointment_event" : "lims_report_ready",
    consentPurpose: family,
    riskLevel: "medium",
    steps: [
      {
        id: "appointment_step_1",
        kind: "send_template",
        templateVersionId: "template_appointment_v1",
        templateContentHash: digest("7"),
        waitSeconds: null,
        appointmentAction: null,
        routeTeamId: null,
        stopReasonCode: null,
        requiredConsentPurpose: "appointment_service",
        serviceWindowBehavior: "use_approved_template",
        timeoutSeconds: 30,
        retryMaxAttempts: 2,
        retryInitialBackoffSeconds: 60,
        retryMaximumBackoffSeconds: 300,
        fallback: "create_work_item",
      },
    ],
    contentHash: digest(family === "appointment_service" ? "a" : "d"),
    secretBindingHash: digest(family === "appointment_service" ? "b" : "e"),
    ownerUid: "user_demo_admin",
    approverUid: "user_demo_supervisor",
    approvalHash: digest(family === "appointment_service" ? "c" : "f"),
    approvalScope: "simulation_only",
    approvedAt: "2026-08-07T13:02:00.000Z",
    lifecycleState: "approved",
    schemaVersion: 1,
    synthetic: true,
    createdAt: "2026-08-07T13:00:00.000Z",
    updatedAt: activatedAt,
  } as unknown as AuthoritativeAutomationDefinition;
}

function automationCatalogue(
  family: "appointment_service" | "laboratory_service" = "appointment_service",
): AutomationCatalogueRecord {
  const activeDefinition = definition(family);
  const activationEvent = {
    id: `event_${family}_activated`,
    workspaceId,
    family,
    eventType: "activated",
    definitionId: activeDefinition.id,
    definitionVersion: activeDefinition.version,
    definitionContentHash: activeDefinition.contentHash,
    definitionApprovalHash: activeDefinition.approvalHash,
    definitionApprovalScope: "simulation_only",
    definitionSecretBindingHash: activeDefinition.secretBindingHash,
    fromLifecycleState: "approved",
    toLifecycleState: "approved",
    revision: 4,
    auditEventId: `audit_${family}_activated`,
    occurredAt: activatedAt,
    schemaVersion: 1,
    synthetic: true,
    externalDispatchCount: 0,
    networkCallCount: 0,
    actorKind: "staff",
    actorUid: "user_demo_supervisor",
  } as unknown as StaffSafeAutomationDefinitionEvent;
  const activation = {
    id: family,
    workspaceId,
    family,
    activeDefinitionId: activeDefinition.id,
    activeDefinitionVersion: activeDefinition.version,
    activeDefinitionContentHash: activeDefinition.contentHash,
    activeDefinitionApprovalHash: activeDefinition.approvalHash,
    activeDefinitionApprovalScope: "simulation_only",
    activeDefinitionSecretBindingHash: activeDefinition.secretBindingHash,
    activatedByUid: activationEvent.actorUid,
    activatedAt,
    activationEventId: activationEvent.id,
    activationAuditEventId: activationEvent.auditEventId,
    revision: 1,
    createdAt: activatedAt,
    updatedAt: activatedAt,
    schemaVersion: 1,
    synthetic: true,
    externalDispatchCount: 0,
    networkCallCount: 0,
  } as unknown as StaffSafeAutomationActivation;
  return {
    family,
    definitions: [activeDefinition],
    activeDefinition,
    activation,
    activationEvent,
    activationAudit: auditForLifecycle(activationEvent, "automation_definition", String(activeDefinition.id)),
  };
}

function pathway() {
  return {
    id: SYNTHETIC_CARE_PATHWAY_ID,
    workspaceId,
    family: "post_discharge",
    protocolVersion: "v1.0",
    name: "Synthetic follow-up",
    clinicalOwnerUid: "user_demo_admin",
    clinicalApproverUid: "user_demo_clinical_approver",
    contactPoints: [],
    responseSlaMinutes: 15,
    escalationTeamId: SYNTHETIC_CARE_SCOPE.teamId,
    eligibleLocationIds: [SYNTHETIC_CARE_SCOPE.locationId],
    afterHoursBehavior: "on_call_queue",
    writeBackRequired: true,
    instructionsSource: "clinician_authored",
    aiMayGenerateInstructions: false,
    suppressions: ["readmission", "transfer", "death", "clinical_hold", "withdrawal", "invalid_contact"],
    protectedContentHash: digest("1"),
    secretBindingHash: digest("2"),
    contentHash: digest("3"),
    approvalHash: digest("4"),
    approvalScope: "clinical_simulation_only",
    approvedAt: "2026-08-07T13:02:00.000Z",
    lifecycleState: "approved",
    schemaVersion: 1,
    synthetic: true,
    createdAt: "2026-08-07T13:00:00.000Z",
    updatedAt: activatedAt,
  } as unknown as AuthoritativeCarePathway;
}

function careCatalogue(): CareCatalogueRecord {
  const activePathway = pathway();
  const activationEvent = {
    id: "care_pathway_event_activated",
    workspaceId,
    family: "post_discharge",
    eventType: "activated",
    pathwayId: activePathway.id,
    pathwayProtocolVersion: activePathway.protocolVersion,
    pathwayContentHash: activePathway.contentHash,
    pathwayApprovalHash: activePathway.approvalHash,
    pathwayApprovalScope: "clinical_simulation_only",
    pathwaySecretBindingHash: activePathway.secretBindingHash,
    fromLifecycleState: "approved",
    toLifecycleState: "approved",
    revision: 4,
    auditEventId: "audit_care_pathway_activated",
    occurredAt: activatedAt,
    schemaVersion: 1,
    synthetic: true,
    externalDispatchCount: 0,
    networkCallCount: 0,
    actorKind: "staff",
    actorUid: "user_demo_clinical_approver",
  } as unknown as StaffSafeCarePathwayEvent;
  const activation = {
    id: "post_discharge",
    workspaceId,
    family: "post_discharge",
    activePathwayId: activePathway.id,
    activeProtocolVersion: activePathway.protocolVersion,
    activePathwayContentHash: activePathway.contentHash,
    activePathwayApprovalHash: activePathway.approvalHash,
    activePathwayApprovalScope: "clinical_simulation_only",
    activePathwaySecretBindingHash: activePathway.secretBindingHash,
    activatedByUid: activationEvent.actorUid,
    activatedAt,
    activationEventId: activationEvent.id,
    activationAuditEventId: activationEvent.auditEventId,
    revision: 1,
    createdAt: activatedAt,
    updatedAt: activatedAt,
    schemaVersion: 1,
    synthetic: true,
    externalDispatchCount: 0,
    networkCallCount: 0,
  } as unknown as StaffSafeCarePathwayActivation;
  return {
    pathways: [activePathway],
    activePathway,
    activation,
    activationEvent,
    activationAudit: auditForLifecycle(activationEvent, "care_pathway", String(activePathway.id)),
  };
}

function auditForLifecycle(
  event: StaffSafeAutomationDefinitionEvent | StaffSafeCarePathwayEvent,
  resourceType: "automation_definition" | "care_pathway",
  resourceId: string,
): Phase5AuditRecordDTO {
  const action =
    resourceType === "automation_definition"
      ? "automation_definition.activate"
      : "care_pathway.activate";
  return {
    id: String(event.auditEventId),
    workspaceId,
    actorUid: String(event.actorUid),
    actorType: "user",
    action,
    resourceType,
    resourceId,
    outcome: "allowed",
    requestId: `request_${event.id}`,
    occurredAt: event.occurredAt,
    createdAt: event.occurredAt,
    metadata: { eventId: String(event.id), revision: event.revision },
    synthetic: true,
    schemaVersion: 1,
  };
}

function run(overrides: Partial<StaffSafeAutomationRun> = {}) {
  const active = definition("appointment_service");
  return {
    id: SYNTHETIC_AUTOMATION_RUN_ID,
    workspaceId,
    definitionId: active.id,
    definitionVersion: active.version,
    definitionContentHash: active.contentHash,
    teamId: SYNTHETIC_AUTOMATION_SCOPE.teamId,
    locationId: SYNTHETIC_AUTOMATION_SCOPE.locationId,
    state: "queued",
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
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  } as unknown as StaffSafeAutomationRun;
}

function enrollment(overrides: Partial<StaffSafeCareEnrollment> = {}) {
  const active = pathway();
  return {
    id: SYNTHETIC_CARE_ENROLLMENT_ID,
    workspaceId,
    pathwayId: active.id,
    pathwayProtocolVersion: active.protocolVersion,
    pathwayContentHash: active.contentHash,
    teamId: SYNTHETIC_CARE_SCOPE.teamId,
    locationId: SYNTHETIC_CARE_SCOPE.locationId,
    state: "queued",
    nextContactIndex: 0,
    nextContactAt: "2026-08-08T00:00:00.000Z",
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
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  } as unknown as StaffSafeCareEnrollment;
}

function automationOperation(
  overrides: Partial<StaffSafeAutomationRun> = {},
): AutomationOperationRecord {
  return {
    definition: definition("appointment_service"),
    run: run(overrides),
    latestEvent: null,
    latestAudit: null,
    workItem: null,
  };
}

function careOperation(
  overrides: Partial<StaffSafeCareEnrollment> = {},
): CareOperationRecord {
  return {
    pathway: pathway(),
    enrollment: enrollment(overrides),
    latestEvent: null,
    latestAudit: null,
    eventEscalation: null,
    openEscalation: null,
    safetyHoldEscalation: null,
    handoff: null,
  };
}

function readsForInitialGraph(options: {
  runCreatedAt?: ISODateTime;
  enrollmentCreatedAt?: ISODateTime;
} = {}): AutomationWorkspaceReads {
  const automationByFamily = {
    appointment_service: automationCatalogue("appointment_service"),
    laboratory_service: automationCatalogue("laboratory_service"),
  } as const;
  const care = careCatalogue();
  return {
    listDefinitions: vi.fn(async (_db, input: { family: keyof typeof automationByFamily }) => automationByFamily[input.family].definitions),
    getDefinition: vi.fn(async (_db, input) => {
      const found = Object.values(automationByFamily)
        .map((item) => item.activeDefinition)
        .find((item) => item.id === input.id);
      if (!found) throw new Error("missing definition");
      return found;
    }),
    getAutomationActivation: vi.fn(async (_db, input: { family: keyof typeof automationByFamily }) => automationByFamily[input.family].activation),
    getAutomationDefinitionEvent: vi.fn(async (_db, input) => {
      const found = Object.values(automationByFamily)
        .map((item) => item.activationEvent)
        .find((item) => item.id === input.id);
      if (!found) throw new Error("missing event");
      return found;
    }),
    getAutomationRun: vi.fn(async () =>
      run({ createdAt: options.runCreatedAt ?? createdAt, updatedAt: options.runCreatedAt ?? createdAt }),
    ),
    getAutomationRunEvent: vi.fn(async () => { throw new Error("not expected"); }),
    getAutomationWorkItem: vi.fn(async () => { throw new Error("not expected"); }),
    listCarePathways: vi.fn(async () => care.pathways),
    getCarePathway: vi.fn(async () => care.activePathway),
    getCarePathwayActivation: vi.fn(async () => care.activation),
    getCarePathwayEvent: vi.fn(async () => care.activationEvent),
    getCareEnrollment: vi.fn(async () =>
      enrollment({
        createdAt: options.enrollmentCreatedAt ?? createdAt,
        updatedAt: options.enrollmentCreatedAt ?? createdAt,
      }),
    ),
    getCareEnrollmentEvent: vi.fn(async () => { throw new Error("not expected"); }),
    getCareEscalation: vi.fn(async () => { throw new Error("not expected"); }),
    getCareHandoff: vi.fn(async () => { throw new Error("not expected"); }),
    getAudit: vi.fn(async (_db, input) => {
      const audits = [
        ...Object.values(automationByFamily).map((item) => item.activationAudit),
        care.activationAudit,
      ];
      const found = audits.find((item) => item.id === input.id);
      if (!found) throw new Error("missing audit");
      return found;
    }),
  } as unknown as AutomationWorkspaceReads;
}

describe("persisted automation/care authority model", () => {
  it("uses every authority field in the synchronous remount key", () => {
    const base = session("tenant_admin");
    const variants = [
      { ...base, workspaceId: "workspace_other" },
      { ...base, uid: "user_other" },
      { ...base, role: "supervisor" as const },
      { ...base, scopeMode: "assigned" as const },
      { ...base, workspaceMode: "local" as const },
      { ...base, dataClassification: "synthetic_only" as const, teamIds: ["team_other"] },
      { ...base, locationIds: ["location_other"] },
    ];
    expect(new Set([automationWorkspaceAuthorityKey(base), ...variants.map(automationWorkspaceAuthorityKey)]).size).toBe(8);
  });

  it("enforces the frozen role/family/action matrix", () => {
    expect(availableAutomationActions(session("supervisor"), automationOperation())).toEqual(["start", "pause", "end"]);
    expect(availableAutomationActions(session("analyst"), automationOperation())).toEqual([]);
    expect(availableAutomationActions(session("clinical_approver"), automationOperation())).toEqual([]);
    expect(availableCareActions(session("clinical_approver"), careOperation())).toEqual(["start", "end", "simulate_suppression"]);
    expect(availableCareActions(session("tenant_admin"), careOperation())).toEqual([]);
  });

  it("does not narrow service-valid waiting+accepted or failed+accepted aggregates", () => {
    expect(
      availableAutomationActions(
        session("supervisor"),
        automationOperation({ state: "waiting", outcomeCode: "accepted", nextEligibleAt: isoDateTime("2026-08-08T01:00:00.000Z") }),
      ),
    ).toEqual(["advance_step", "pause", "simulate_human_takeover", "exercise_fallback", "inject_failure", "end"]);
    expect(
      availableAutomationActions(
        session("supervisor"),
        automationOperation({ state: "failed", outcomeCode: "accepted" }),
      ),
    ).toEqual(["exercise_fallback", "retry", "end"]);
  });

  it("requires both exact team and location before exposing controls", () => {
    const wrongLocation = session("supervisor", { locationIds: ["location_other"] });
    expect(availableAutomationActions(wrongLocation, automationOperation())).toEqual([]);
    const wrongTeam = session("clinical_approver", { teamIds: ["team_other"] });
    expect(availableCareActions(wrongTeam, careOperation())).toEqual([]);
  });

  it.each([
    {
      label: "resume with a clinical hold",
      operation: () => careOperation({ state: "paused_by_operator", activeSuppressions: ["clinical_hold"] }),
      hidden: "resume" as const,
    },
    {
      label: "end with an open escalation pointer",
      operation: () => careOperation({ state: "active", openEscalationId: "care_escalation_1" as never }),
      hidden: "end" as const,
    },
    {
      label: "clinical clearance without clinical_hold",
      operation: () => careOperation({ state: "paused_for_safety", activeSuppressions: [] }),
      hidden: "clear_clinical_hold" as const,
    },
    {
      label: "safety clearance without a resolved pointer",
      operation: () => careOperation({ state: "paused_for_safety", safetyHoldEscalationId: null }),
      hidden: "clear_safety_hold" as const,
    },
    {
      label: "escalation acknowledgement without exact aggregate",
      operation: () => careOperation({ state: "escalated", openEscalationId: "care_escalation_1" as never }),
      hidden: "acknowledge_escalation" as const,
    },
    {
      label: "escalation resolution before acknowledgement",
      operation: () => ({
        ...careOperation({ state: "escalated", openEscalationId: "care_escalation_1" as never }),
        openEscalation: { id: "care_escalation_1", state: "open" } as never,
      }),
      hidden: "resolve_escalation" as const,
    },
    {
      label: "handoff release without exact open handoff",
      operation: () => careOperation({ state: "paused_for_human", openHandoffId: "care_handoff_1" as never }),
      hidden: "release_human_takeover" as const,
    },
    {
      label: "takeover while suppression evidence remains",
      operation: () => careOperation({ state: "active", activeSuppressions: ["clinical_hold"] }),
      hidden: "human_takeover_started" as const,
    },
    {
      label: "red flag while an escalation is already open",
      operation: () => ({
        ...careOperation({ state: "active", openEscalationId: "care_escalation_1" as never }),
        openEscalation: { id: "care_escalation_1", state: "open" } as never,
      }),
      hidden: "raise_red_flag" as const,
    },
    {
      label: "contact advancement before the due time",
      operation: () => ({
        ...careOperation({ state: "active", nextContactAt: isoDateTime("2026-08-09T00:00:00.000Z") }),
        pathway: { ...pathway(), contactPoints: [{}] } as never,
      }),
      hidden: "advance_contact" as const,
    },
  ])("hides callable-impossible $label", ({ operation, hidden }) => {
    expect(
      availableCareActions(
        session("clinical_approver"),
        operation(),
        new Date("2026-08-08T00:00:00.000Z"),
      ),
    ).not.toContain(hidden);
  });

  it("shows clinical lifecycle actions only with their exact aggregate states", () => {
    const openEscalation = {
      ...careOperation({ state: "escalated", openEscalationId: "care_escalation_1" as never }),
      openEscalation: { id: "care_escalation_1", state: "open" } as never,
    };
    const acknowledgedEscalation = {
      ...openEscalation,
      openEscalation: { id: "care_escalation_1", state: "acknowledged" } as never,
    };
    const resolvedSafety = {
      ...careOperation({
        state: "paused_for_safety",
        safetyHoldEscalationId: "care_escalation_1" as never,
        activeSuppressions: [],
      }),
      safetyHoldEscalation: { id: "care_escalation_1", state: "resolved" } as never,
    };
    const openHandoff = {
      ...careOperation({ state: "paused_for_human", openHandoffId: "care_handoff_1" as never }),
      handoff: { id: "care_handoff_1", state: "open" } as never,
    };
    expect(availableCareActions(session("clinical_approver"), openEscalation)).toContain("acknowledge_escalation");
    expect(availableCareActions(session("clinical_approver"), openEscalation)).not.toContain("resolve_escalation");
    expect(availableCareActions(session("clinical_approver"), acknowledgedEscalation)).toContain("resolve_escalation");
    expect(availableCareActions(session("clinical_approver"), resolvedSafety)).toContain("clear_safety_hold");
    expect(availableCareActions(session("clinical_approver"), openHandoff)).toContain("release_human_takeover");
  });

  it("builds revision-bound actions only after authority and state checks", async () => {
    const automation = automationOperation();
    const request = await buildAutomationActionRequest({
      session: session("supervisor"),
      operation: automation,
      action: "start",
    });
    expect(request.expectedRevision).toBe(1);
    await expect(
      buildAutomationActionRequest({ session: session("analyst"), operation: automation, action: "start" }),
    ).rejects.toMatchObject({ code: "access_denied" });
    await expect(
      buildCareActionRequest({
        session: session("clinical_approver"),
        operation: careOperation(),
        action: "simulate_suppression",
        suppressionReason: null,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("loads catalogues plus only exact authorized aggregates and never an execution list", async () => {
    const reads = readsForInitialGraph();
    const result = await loadAutomationWorkspace(db, session("tenant_admin"), reads);
    expect(result.automationCatalogues).toHaveLength(2);
    expect(result.careCatalogue?.activePathway.id).toBe(SYNTHETIC_CARE_PATHWAY_ID);
    expect(result.automationOperation.status).toBe("available");
    expect(result.careOperation.status).toBe("available");
    expect(reads.getAutomationRun).toHaveBeenCalledOnce();
    expect(reads.getCareEnrollment).toHaveBeenCalledOnce();
  });

  it("keeps analysts catalogue-only without exact operation reads", async () => {
    const reads = readsForInitialGraph();
    const result = await loadAutomationWorkspace(db, session("analyst"), reads);
    expect(result.automationOperation.status).toBe("not_authorized");
    expect(result.careOperation.status).toBe("not_authorized");
    expect(reads.getAutomationRun).not.toHaveBeenCalled();
    expect(reads.getCareEnrollment).not.toHaveBeenCalled();
  });

  it("preflights assigned scope and performs no exact aggregate read when either half is missing", async () => {
    const reads = readsForInitialGraph();
    const assignedAdmin = session("tenant_admin", {
      scopeMode: "assigned",
      teamIds: [SYNTHETIC_AUTOMATION_SCOPE.teamId],
      locationIds: [SYNTHETIC_AUTOMATION_SCOPE.locationId],
    });
    const result = await loadAutomationWorkspace(db, assignedAdmin, reads);
    expect(result.automationOperation.status).toBe("available");
    expect(result.careOperation.status).toBe("out_of_scope");
    expect(reads.getAutomationRun).toHaveBeenCalledOnce();
    expect(reads.getCareEnrollment).not.toHaveBeenCalled();
  });

  it.each(["run", "enrollment"] as const)(
    "fails closed when a client-readable %s aggregate predates activation",
    async (target) => {
      const reads = readsForInitialGraph(
        target === "run"
          ? { runCreatedAt: isoDateTime("2026-08-07T13:02:59.999Z") }
          : { enrollmentCreatedAt: isoDateTime("2026-08-07T13:02:59.999Z") },
      );
      await expect(
        loadAutomationWorkspace(db, session("tenant_admin"), reads),
      ).rejects.toMatchObject({ code: "evidence_mismatch" });
    },
  );

  it("fails initial load when an open work-item pointer is absent from the latest event", async () => {
    const authority = session("supervisor");
    const baseline = readsForInitialGraph();
    const occurredAt = isoDateTime("2026-08-07T13:05:00.000Z");
    const latestEvent = {
      id: "automation_event_pause",
      workspaceId,
      runId: SYNTHETIC_AUTOMATION_RUN_ID,
      definitionId: definition("appointment_service").id,
      definitionVersion: 3,
      definitionContentHash: definition("appointment_service").contentHash,
      teamId: SYNTHETIC_AUTOMATION_SCOPE.teamId,
      locationId: SYNTHETIC_AUTOMATION_SCOPE.locationId,
      revision: 2,
      auditEventId: "audit_automation_event_pause",
      action: "pause",
      fromState: "running",
      toState: "paused_by_operator",
      stepIndex: null,
      stepId: null,
      attemptNumber: 0,
      workItemId: null,
      nextEligibleAt: null,
      reasonCode: "operator_requested",
      evidenceFingerprint: digest("6"),
      outcomeCode: "accepted",
      occurredAt,
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
      actorKind: "staff",
      actorUid: authority.uid,
    } as unknown as StaffSafeAutomationRunEvent;
    const latestAudit = runtimeAudit({
      id: String(latestEvent.auditEventId),
      actorUid: authority.uid,
      action: "automation.pause",
      resourceType: "automation_run",
      resourceId: SYNTHETIC_AUTOMATION_RUN_ID,
      eventId: String(latestEvent.id),
      revision: 2,
      occurredAt,
      resultFingerprint: digest("5"),
    });
    const originalGetAudit = baseline.getAudit;
    const reads = {
      ...baseline,
      getAutomationRun: vi.fn(async () =>
        run({
          state: "paused_by_operator",
          pausedFromState: "running",
          openWorkItemId: "automation_work_item_substituted" as never,
          revision: 2,
          outcomeCode: "accepted",
          lastEventId: latestEvent.id,
          updatedAt: occurredAt,
        }),
      ),
      getAutomationRunEvent: vi.fn(async () => latestEvent),
      getAudit: vi.fn(async (database: Firestore, input: { id: string }) =>
        input.id === latestAudit.id
          ? latestAudit
          : originalGetAudit(database, input as never),
      ),
    } as unknown as AutomationWorkspaceReads;

    await expect(
      loadAutomationWorkspace(db, authority, reads),
    ).rejects.toMatchObject({ code: "evidence_mismatch" });
    expect(reads.getAutomationWorkItem).not.toHaveBeenCalled();
  });

  it("fails initial load when the open escalation differs from the latest event", async () => {
    const authority = session("clinical_approver");
    const baseline = readsForInitialGraph();
    const occurredAt = isoDateTime("2026-08-07T13:05:00.000Z");
    const latestEvent = {
      id: "care_event_red_flag",
      workspaceId,
      enrollmentId: SYNTHETIC_CARE_ENROLLMENT_ID,
      pathwayId: SYNTHETIC_CARE_PATHWAY_ID,
      pathwayProtocolVersion: "v1.0",
      pathwayContentHash: pathway().contentHash,
      teamId: SYNTHETIC_CARE_SCOPE.teamId,
      locationId: SYNTHETIC_CARE_SCOPE.locationId,
      revision: 2,
      auditEventId: "audit_care_event_red_flag",
      action: "raise_red_flag",
      fromState: "active",
      toState: "escalated",
      contactPointIndex: null,
      suppressionReason: null,
      escalationId: "care_escalation_event" as never,
      escalationStateBefore: null,
      escalationStateAfter: "open",
      handoffId: null,
      activeSuppressionsAfter: [],
      nextContactAt: isoDateTime("2026-08-08T00:00:00.000Z"),
      outcomeCode: "red_flag_escalated",
      occurredAt,
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
      actorKind: "staff",
      actorUid: authority.uid,
    } as unknown as StaffSafeCareEnrollmentEvent;
    const latestAudit = runtimeAudit({
      id: String(latestEvent.auditEventId),
      actorUid: authority.uid,
      action: "care_enrollment.raise_red_flag",
      resourceType: "care_enrollment",
      resourceId: SYNTHETIC_CARE_ENROLLMENT_ID,
      eventId: String(latestEvent.id),
      revision: 2,
      occurredAt,
      resultFingerprint: digest("4"),
    });
    const originalGetAudit = baseline.getAudit;
    const reads = {
      ...baseline,
      getCareEnrollment: vi.fn(async () =>
        enrollment({
          state: "escalated",
          openEscalationId: "care_escalation_substituted" as never,
          revision: 2,
          outcomeCode: "red_flag_escalated",
          lastEventId: latestEvent.id,
          updatedAt: occurredAt,
        }),
      ),
      getCareEnrollmentEvent: vi.fn(async () => latestEvent),
      getAudit: vi.fn(async (database: Firestore, input: { id: string }) =>
        input.id === latestAudit.id
          ? latestAudit
          : originalGetAudit(database, input as never),
      ),
    } as unknown as AutomationWorkspaceReads;

    await expect(
      loadAutomationWorkspace(db, authority, reads),
    ).rejects.toMatchObject({ code: "evidence_mismatch" });
    expect(reads.getCareEscalation).not.toHaveBeenCalled();
  });

  it("fails closed on a polluted activation/audit join", async () => {
    const baseline = readsForInitialGraph();
    const reads: AutomationWorkspaceReads = { ...baseline, getAudit: vi.fn(async (database, input) => {
      const original = baseline.getAudit;
      const audit = await original(database, input);
      return input.id.includes("appointment")
        ? { ...audit, resourceId: "automation_other" }
        : audit;
    }) };
    await expect(
      loadAutomationWorkspace(db, session("tenant_admin"), reads),
    ).rejects.toMatchObject({ code: "evidence_mismatch" });
  });
});

function runtimeAudit(input: {
  id: string;
  actorUid: string;
  action: string;
  resourceType: "automation_run" | "care_enrollment";
  resourceId: string;
  eventId: string;
  revision: number;
  occurredAt: string;
  resultFingerprint: string;
}): Phase5AuditRecordDTO {
  return {
    id: input.id,
    workspaceId,
    actorUid: input.actorUid,
    actorType: "user",
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    outcome: "allowed",
    requestId: `request_${input.eventId}`,
    occurredAt: input.occurredAt,
    createdAt: input.occurredAt,
    metadata: {
      eventId: input.eventId,
      revision: input.revision,
      resultFingerprint: input.resultFingerprint,
    },
    synthetic: true,
    schemaVersion: 1,
  };
}

function automationWorkItem(
  overrides: Partial<StaffSafeAutomationWorkItem> = {},
): StaffSafeAutomationWorkItem {
  const active = definition("appointment_service");
  const openedAt = isoDateTime("2026-08-07T13:05:00.000Z");
  return {
    id: "automation_work_item_1",
    workspaceId,
    runId: SYNTHETIC_AUTOMATION_RUN_ID,
    definitionId: active.id,
    definitionVersion: active.version,
    definitionContentHash: active.contentHash,
    teamId: SYNTHETIC_AUTOMATION_SCOPE.teamId,
    locationId: SYNTHETIC_AUTOMATION_SCOPE.locationId,
    reasonCode: "fallback_route",
    state: "open",
    openedAt,
    slaMinutes: 15,
    dueAt: isoDateTime("2026-08-07T13:20:00.000Z"),
    assignedMemberUid: null,
    acknowledgedAt: null,
    acknowledgedByUid: null,
    resolvedAt: null,
    resolvedByUid: null,
    resolutionCode: null,
    revision: 1,
    lastEventId: "automation_event_2",
    schemaVersion: 1,
    synthetic: true,
    externalDispatchCount: 0,
    networkCallCount: 0,
    createdAt: openedAt,
    updatedAt: openedAt,
    ...overrides,
  } as unknown as StaffSafeAutomationWorkItem;
}

function careEscalation(
  overrides: Partial<StaffSafeCareEscalation> = {},
): StaffSafeCareEscalation {
  const openedAt = isoDateTime("2026-08-07T13:05:00.000Z");
  return {
    id: "care_escalation_1",
    workspaceId,
    enrollmentId: SYNTHETIC_CARE_ENROLLMENT_ID,
    pathwayId: SYNTHETIC_CARE_PATHWAY_ID,
    pathwayProtocolVersion: "v1.0",
    pathwayContentHash: pathway().contentHash,
    teamId: SYNTHETIC_CARE_SCOPE.teamId,
    locationId: SYNTHETIC_CARE_SCOPE.locationId,
    reasonCode: "red_flag_response",
    state: "open",
    openedAt,
    responseSlaMinutes: 15,
    responseDueAt: isoDateTime("2026-08-07T13:20:00.000Z"),
    openedBy: { actorKind: "staff", actorUid: "user_demo_clinical_approver" },
    acknowledgedAt: null,
    acknowledgedByUid: null,
    resolvedAt: null,
    resolvedByUid: null,
    resolutionCode: null,
    writeBackRequired: true,
    writeBackState: "pending",
    revision: 1,
    lastEventId: "care_event_red_flag",
    schemaVersion: 1,
    synthetic: true,
    externalDispatchCount: 0,
    networkCallCount: 0,
    createdAt: openedAt,
    updatedAt: openedAt,
    ...overrides,
  } as unknown as StaffSafeCareEscalation;
}

function careHandoff(
  overrides: Partial<StaffSafeCareHandoff> = {},
): StaffSafeCareHandoff {
  const openedAt = isoDateTime("2026-08-07T13:05:00.000Z");
  return {
    id: "care_handoff_1",
    workspaceId,
    enrollmentId: SYNTHETIC_CARE_ENROLLMENT_ID,
    pathwayId: SYNTHETIC_CARE_PATHWAY_ID,
    pathwayProtocolVersion: "v1.0",
    pathwayContentHash: pathway().contentHash,
    teamId: SYNTHETIC_CARE_SCOPE.teamId,
    locationId: SYNTHETIC_CARE_SCOPE.locationId,
    state: "open",
    openedEventId: "care_event_takeover",
    openedBy: { actorKind: "staff", actorUid: "user_demo_clinical_approver" },
    openedAt,
    releasedEventId: null,
    releasedBy: null,
    releasedAt: null,
    revision: 1,
    lastEventId: "care_event_takeover",
    schemaVersion: 1,
    synthetic: true,
    externalDispatchCount: 0,
    networkCallCount: 0,
    createdAt: openedAt,
    updatedAt: openedAt,
    ...overrides,
  } as unknown as StaffSafeCareHandoff;
}

describe("post-call authoritative evidence reconciliation", () => {
  it("accepts an exact automation aggregate/event/audit/result fingerprint join", async () => {
    const authority = session("supervisor");
    const previous = automationOperation();
    const request: AutomationFunctionsRequest = {
      workspaceId,
      runId: SYNTHETIC_AUTOMATION_RUN_ID,
      action: "start",
      expectedRevision: 1,
      idempotencyKey: "phase5-automation-ui-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    const result: AutomationFunctionsResponse["result"] = {
      runId: SYNTHETIC_AUTOMATION_RUN_ID,
      eventId: "automation_event_2",
      action: "start",
      state: "running",
      revision: 2,
      currentStepIndex: 0,
      completedStepCount: 0,
      attemptCount: 0,
      nextEligibleAt: null,
      openWorkItemId: null,
      outcomeCode: "accepted",
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
    };
    const response: AutomationFunctionsResponse = {
      result,
      auditEventId: "audit_automation_event_2",
      replayed: false,
    };
    const occurredAt = isoDateTime("2026-08-07T13:05:00.000Z");
    const event = {
      id: result.eventId,
      workspaceId,
      runId: result.runId,
      definitionId: previous.run.definitionId,
      definitionVersion: previous.run.definitionVersion,
      definitionContentHash: previous.run.definitionContentHash,
      teamId: previous.run.teamId,
      locationId: previous.run.locationId,
      revision: 2,
      auditEventId: response.auditEventId,
      action: "start",
      fromState: "queued",
      toState: "running",
      stepIndex: null,
      stepId: null,
      attemptNumber: 0,
      workItemId: null,
      nextEligibleAt: null,
      reasonCode: "trigger_accepted",
      evidenceFingerprint: digest("9"),
      outcomeCode: "accepted",
      occurredAt,
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
      actorKind: "staff",
      actorUid: authority.uid,
    } as unknown as StaffSafeAutomationRunEvent;
    const current = automationOperation({
      state: "running",
      revision: 2,
      lastEventId: event.id,
      updatedAt: occurredAt,
    });
    const evidence: AutomationActionEvidence = {
      event,
      audit: runtimeAudit({
        id: response.auditEventId,
        actorUid: authority.uid,
        action: "automation.start",
        resourceType: "automation_run",
        resourceId: result.runId,
        eventId: result.eventId,
        revision: 2,
        occurredAt,
        resultFingerprint: await automationControlResultFingerprint(result),
      }),
      workItem: null,
    };
    await expect(
      assertAutomationActionEvidence({
        session: authority,
        previous,
        current,
        request,
        response,
        evidence,
      }),
    ).resolves.toBeUndefined();
    const laterCurrent = automationOperation({
      state: "paused_by_operator",
      pausedFromState: "running",
      revision: 3,
      lastEventId: "automation_event_3" as never,
      updatedAt: isoDateTime("2026-08-07T13:06:00.000Z"),
    });
    await expect(
      assertAutomationActionEvidence({
        session: authority,
        previous,
        current: laterCurrent,
        request,
        response: { ...response, replayed: true },
        evidence,
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertAutomationActionEvidence({
        session: authority,
        previous,
        current: laterCurrent,
        request,
        response: { ...response, replayed: true },
        evidence: {
          ...evidence,
          event: {
            ...event,
            definitionContentHash: digest("0") as never,
          },
        },
      }),
    ).rejects.toMatchObject({ code: "evidence_mismatch" });
  });

  it("installs no success when the automation audit result fingerprint is substituted", async () => {
    const authority = session("supervisor");
    const previous = automationOperation();
    const request: AutomationFunctionsRequest = {
      workspaceId,
      runId: SYNTHETIC_AUTOMATION_RUN_ID,
      action: "start",
      expectedRevision: 1,
      idempotencyKey: "phase5-automation-ui-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    };
    const response = {
      result: {
        runId: SYNTHETIC_AUTOMATION_RUN_ID,
        eventId: "automation_event_2",
        action: "start",
        state: "running",
        revision: 2,
        currentStepIndex: 0,
        completedStepCount: 0,
        attemptCount: 0,
        nextEligibleAt: null,
        openWorkItemId: null,
        outcomeCode: "accepted",
        synthetic: true,
        externalDispatchCount: 0,
        networkCallCount: 0,
      },
      auditEventId: "audit_automation_event_2",
      replayed: false,
    } as const satisfies AutomationFunctionsResponse;
    const occurredAt = isoDateTime("2026-08-07T13:05:00.000Z");
    const event = {
      id: response.result.eventId,
      workspaceId,
      runId: response.result.runId,
      definitionId: previous.run.definitionId,
      definitionVersion: previous.run.definitionVersion,
      definitionContentHash: previous.run.definitionContentHash,
      teamId: previous.run.teamId,
      locationId: previous.run.locationId,
      revision: 2,
      auditEventId: response.auditEventId,
      action: "start",
      fromState: "queued",
      toState: "running",
      nextEligibleAt: null,
      outcomeCode: "accepted",
      occurredAt,
      actorKind: "staff",
      actorUid: authority.uid,
    } as unknown as StaffSafeAutomationRunEvent;
    await expect(
      assertAutomationActionEvidence({
        session: authority,
        previous,
        current: automationOperation({ state: "running", revision: 2, lastEventId: event.id }),
        request,
        response,
        evidence: {
          event,
          audit: runtimeAudit({
            id: response.auditEventId,
            actorUid: authority.uid,
            action: "automation.start",
            resourceType: "automation_run",
            resourceId: response.result.runId,
            eventId: response.result.eventId,
            revision: 2,
            occurredAt,
            resultFingerprint: createHash("sha256").update("substituted").digest("hex"),
          }),
          workItem: null,
        },
      }),
    ).rejects.toMatchObject({ code: "evidence_mismatch" });
  });

  it("accepts exact care event/audit evidence and rejects a suppression substitution", async () => {
    const authority = session("clinical_approver");
    const previous = careOperation();
    const request: CareFunctionsRequest = {
      workspaceId,
      enrollmentId: SYNTHETIC_CARE_ENROLLMENT_ID,
      action: "simulate_suppression",
      expectedRevision: 1,
      suppressionReason: "clinical_hold",
      idempotencyKey: "phase5-care-ui-cccccccccccccccccccccccccccccccccccccccccccc",
    };
    const result: CareFunctionsResponse["result"] = {
      enrollmentId: SYNTHETIC_CARE_ENROLLMENT_ID,
      eventId: "care_event_2",
      action: "simulate_suppression",
      state: "paused_for_safety",
      revision: 2,
      nextContactIndex: 0,
      nextContactAt: "2026-08-08T00:00:00.000Z",
      openEscalationId: null,
      safetyHoldEscalationId: null,
      openHandoffId: null,
      outcomeCode: "clinical_hold_applied",
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
    };
    const response: CareFunctionsResponse = {
      result,
      auditEventId: "audit_care_event_2",
      replayed: false,
    };
    const occurredAt = isoDateTime("2026-08-07T13:05:00.000Z");
    const event = {
      id: result.eventId,
      workspaceId,
      enrollmentId: result.enrollmentId,
      pathwayId: previous.enrollment.pathwayId,
      pathwayProtocolVersion: previous.enrollment.pathwayProtocolVersion,
      pathwayContentHash: previous.enrollment.pathwayContentHash,
      teamId: previous.enrollment.teamId,
      locationId: previous.enrollment.locationId,
      revision: 2,
      auditEventId: response.auditEventId,
      action: "simulate_suppression",
      fromState: "queued",
      toState: "paused_for_safety",
      contactPointIndex: null,
      suppressionReason: "clinical_hold",
      escalationId: null,
      escalationStateBefore: null,
      escalationStateAfter: null,
      handoffId: null,
      activeSuppressionsAfter: ["clinical_hold"],
      nextContactAt: result.nextContactAt,
      outcomeCode: result.outcomeCode,
      occurredAt,
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
      actorKind: "staff",
      actorUid: authority.uid,
    } as unknown as StaffSafeCareEnrollmentEvent;
    const current = careOperation({
      state: result.state,
      activeSuppressions: ["clinical_hold"],
      outcomeCode: result.outcomeCode,
      revision: 2,
      lastEventId: event.id,
      updatedAt: occurredAt,
    });
    const evidence: CareActionEvidence = {
      event,
      audit: runtimeAudit({
        id: response.auditEventId,
        actorUid: authority.uid,
        action: "care_enrollment.simulate_suppression",
        resourceType: "care_enrollment",
        resourceId: result.enrollmentId,
        eventId: result.eventId,
        revision: 2,
        occurredAt,
        resultFingerprint: await careControlResultFingerprint(result),
      }),
      escalations: [],
      handoff: null,
    };
    await expect(
      assertCareActionEvidence({ session: authority, previous, current, request, response, evidence }),
    ).resolves.toBeUndefined();
    const laterCurrent = careOperation({
      state: "paused_by_operator",
      activeSuppressions: [],
      outcomeCode: "safety_hold_cleared",
      revision: 3,
      lastEventId: "care_event_3" as never,
      updatedAt: isoDateTime("2026-08-07T13:06:00.000Z"),
    });
    await expect(
      assertCareActionEvidence({
        session: authority,
        previous,
        current: laterCurrent,
        request,
        response: { ...response, replayed: true },
        evidence,
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertCareActionEvidence({
        session: authority,
        previous,
        current: laterCurrent,
        request,
        response: { ...response, replayed: true },
        evidence: {
          ...evidence,
          event: { ...event, activeSuppressionsAfter: [] },
        },
      }),
    ).rejects.toMatchObject({ code: "evidence_mismatch" });
    await expect(
      assertCareActionEvidence({
        session: authority,
        previous,
        current,
        request,
        response,
        evidence: { ...evidence, event: { ...event, suppressionReason: "withdrawal" } },
      }),
    ).rejects.toMatchObject({ code: "evidence_mismatch" });
  });

  it("requires the exact fallback work-item lifecycle before automation success", async () => {
    const authority = session("supervisor");
    const previous = automationOperation({ state: "running" });
    const occurredAt = isoDateTime("2026-08-07T13:05:00.000Z");
    const workItemId = "automation_work_item_1";
    const request: AutomationFunctionsRequest = {
      workspaceId,
      runId: SYNTHETIC_AUTOMATION_RUN_ID,
      action: "exercise_fallback",
      expectedRevision: 1,
      idempotencyKey: "phase5-automation-ui-dddddddddddddddddddddddddddddddddddddddddddd",
    };
    const result: AutomationFunctionsResponse["result"] = {
      runId: SYNTHETIC_AUTOMATION_RUN_ID,
      eventId: "automation_event_2",
      action: "exercise_fallback",
      state: "paused_by_operator",
      revision: 2,
      currentStepIndex: 0,
      completedStepCount: 0,
      attemptCount: 1,
      nextEligibleAt: null,
      openWorkItemId: workItemId,
      outcomeCode: "fallback_work_item_created",
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
    };
    const response: AutomationFunctionsResponse = {
      result,
      auditEventId: "audit_automation_event_2",
      replayed: false,
    };
    const event = {
      id: result.eventId,
      workspaceId,
      runId: result.runId,
      definitionId: previous.run.definitionId,
      definitionVersion: previous.run.definitionVersion,
      definitionContentHash: previous.run.definitionContentHash,
      teamId: previous.run.teamId,
      locationId: previous.run.locationId,
      revision: result.revision,
      auditEventId: response.auditEventId,
      action: result.action,
      fromState: "running",
      toState: result.state,
      stepIndex: 0,
      stepId: "appointment_step_1",
      attemptNumber: 1,
      workItemId,
      nextEligibleAt: null,
      reasonCode: "fallback_policy_applied",
      evidenceFingerprint: digest("8"),
      outcomeCode: result.outcomeCode,
      occurredAt,
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
      actorKind: "staff",
      actorUid: authority.uid,
    } as unknown as StaffSafeAutomationRunEvent;
    const item = automationWorkItem({
      id: workItemId as never,
      lastEventId: event.id,
      openedAt: occurredAt,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    });
    const current = {
      ...automationOperation({
        state: result.state,
        pausedFromState: "running",
        currentStepIndex: result.currentStepIndex,
        completedStepCount: result.completedStepCount,
        attemptCount: result.attemptCount,
        openWorkItemId: workItemId as never,
        outcomeCode: result.outcomeCode,
        revision: result.revision,
        lastEventId: event.id,
        updatedAt: occurredAt,
      }),
      workItem: item,
    };
    const evidence: AutomationActionEvidence = {
      event,
      audit: runtimeAudit({
        id: response.auditEventId,
        actorUid: authority.uid,
        action: "automation.exercise_fallback",
        resourceType: "automation_run",
        resourceId: result.runId,
        eventId: result.eventId,
        revision: result.revision,
        occurredAt,
        resultFingerprint: await automationControlResultFingerprint(result),
      }),
      workItem: item,
    };
    await expect(
      assertAutomationActionEvidence({
        session: authority,
        previous,
        current,
        request,
        response,
        evidence,
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertAutomationActionEvidence({
        session: authority,
        previous,
        current,
        request,
        response,
        evidence: {
          ...evidence,
          workItem: {
            ...item,
            state: "acknowledged",
            acknowledgedAt: occurredAt,
            acknowledgedByUid: authority.uid as never,
          },
        },
      }),
    ).rejects.toMatchObject({ code: "evidence_mismatch" });
  });

  it("requires acknowledgement to advance the exact open escalation aggregate", async () => {
    const authority = session("clinical_approver");
    const escalationId = "care_escalation_1";
    const occurredAt = isoDateTime("2026-08-07T13:06:00.000Z");
    const priorEscalation = careEscalation({ id: escalationId as never });
    const previous = {
      ...careOperation({
        state: "escalated",
        openEscalationId: escalationId as never,
        revision: 2,
        outcomeCode: "red_flag_escalated",
        lastEventId: "care_event_red_flag" as never,
        updatedAt: priorEscalation.updatedAt,
      }),
      eventEscalation: priorEscalation,
      openEscalation: priorEscalation,
    };
    const request: CareFunctionsRequest = {
      workspaceId,
      enrollmentId: SYNTHETIC_CARE_ENROLLMENT_ID,
      action: "acknowledge_escalation",
      expectedRevision: 2,
      suppressionReason: null,
      idempotencyKey: "phase5-care-ui-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    };
    const result: CareFunctionsResponse["result"] = {
      enrollmentId: SYNTHETIC_CARE_ENROLLMENT_ID,
      eventId: "care_event_ack",
      action: request.action,
      state: "escalated",
      revision: 3,
      nextContactIndex: 0,
      nextContactAt: previous.enrollment.nextContactAt,
      openEscalationId: escalationId,
      safetyHoldEscalationId: null,
      openHandoffId: null,
      outcomeCode: "escalation_acknowledged",
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
    };
    const response: CareFunctionsResponse = {
      result,
      auditEventId: "audit_care_event_ack",
      replayed: false,
    };
    const event = {
      id: result.eventId,
      workspaceId,
      enrollmentId: result.enrollmentId,
      pathwayId: previous.enrollment.pathwayId,
      pathwayProtocolVersion: previous.enrollment.pathwayProtocolVersion,
      pathwayContentHash: previous.enrollment.pathwayContentHash,
      teamId: previous.enrollment.teamId,
      locationId: previous.enrollment.locationId,
      revision: result.revision,
      auditEventId: response.auditEventId,
      action: request.action,
      fromState: "escalated",
      toState: result.state,
      contactPointIndex: null,
      suppressionReason: null,
      escalationId,
      escalationStateBefore: "open",
      escalationStateAfter: "acknowledged",
      handoffId: null,
      activeSuppressionsAfter: [],
      nextContactAt: result.nextContactAt,
      outcomeCode: result.outcomeCode,
      occurredAt,
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
      actorKind: "staff",
      actorUid: authority.uid,
    } as unknown as StaffSafeCareEnrollmentEvent;
    const acknowledged = careEscalation({
      id: escalationId as never,
      state: "acknowledged",
      acknowledgedAt: occurredAt,
      acknowledgedByUid: authority.uid as never,
      revision: 2,
      lastEventId: event.id,
      updatedAt: occurredAt,
    });
    const current = {
      ...careOperation({
        state: result.state,
        openEscalationId: escalationId as never,
        revision: result.revision,
        outcomeCode: result.outcomeCode,
        lastEventId: event.id,
        updatedAt: occurredAt,
      }),
      eventEscalation: acknowledged,
      openEscalation: acknowledged,
    };
    const evidence: CareActionEvidence = {
      event,
      audit: runtimeAudit({
        id: response.auditEventId,
        actorUid: authority.uid,
        action: "care_enrollment.acknowledge_escalation",
        resourceType: "care_enrollment",
        resourceId: result.enrollmentId,
        eventId: result.eventId,
        revision: result.revision,
        occurredAt,
        resultFingerprint: await careControlResultFingerprint(result),
      }),
      escalations: [acknowledged],
      handoff: null,
    };
    await expect(
      assertCareActionEvidence({
        session: authority,
        previous,
        current,
        request,
        response,
        evidence,
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertCareActionEvidence({
        session: authority,
        previous,
        current,
        request,
        response,
        evidence: {
          ...evidence,
          escalations: [
            {
              ...acknowledged,
              state: "open",
              acknowledgedAt: null,
              acknowledgedByUid: null,
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "evidence_mismatch" });
  });

  it("requires resolution to persist a resolved safety escalation aggregate", async () => {
    const authority = session("clinical_approver");
    const escalationId = "care_escalation_1";
    const acknowledgedAt = isoDateTime("2026-08-07T13:06:00.000Z");
    const occurredAt = isoDateTime("2026-08-07T13:07:00.000Z");
    const priorEscalation = careEscalation({
      id: escalationId as never,
      state: "acknowledged",
      acknowledgedAt,
      acknowledgedByUid: authority.uid as never,
      revision: 2,
      lastEventId: "care_event_ack" as never,
      updatedAt: acknowledgedAt,
    });
    const previous = {
      ...careOperation({
        state: "escalated",
        openEscalationId: escalationId as never,
        revision: 3,
        outcomeCode: "escalation_acknowledged",
        lastEventId: "care_event_ack" as never,
        updatedAt: acknowledgedAt,
      }),
      eventEscalation: priorEscalation,
      openEscalation: priorEscalation,
    };
    const request: CareFunctionsRequest = {
      workspaceId,
      enrollmentId: SYNTHETIC_CARE_ENROLLMENT_ID,
      action: "resolve_escalation",
      expectedRevision: 3,
      suppressionReason: null,
      idempotencyKey: "phase5-care-ui-ffffffffffffffffffffffffffffffffffffffffffff",
    };
    const result: CareFunctionsResponse["result"] = {
      enrollmentId: SYNTHETIC_CARE_ENROLLMENT_ID,
      eventId: "care_event_resolve",
      action: request.action,
      state: "paused_for_safety",
      revision: 4,
      nextContactIndex: 0,
      nextContactAt: previous.enrollment.nextContactAt,
      openEscalationId: null,
      safetyHoldEscalationId: escalationId,
      openHandoffId: null,
      outcomeCode: "escalation_resolved_safety_hold",
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
    };
    const response: CareFunctionsResponse = {
      result,
      auditEventId: "audit_care_event_resolve",
      replayed: false,
    };
    const event = {
      id: result.eventId,
      workspaceId,
      enrollmentId: result.enrollmentId,
      pathwayId: previous.enrollment.pathwayId,
      pathwayProtocolVersion: previous.enrollment.pathwayProtocolVersion,
      pathwayContentHash: previous.enrollment.pathwayContentHash,
      teamId: previous.enrollment.teamId,
      locationId: previous.enrollment.locationId,
      revision: result.revision,
      auditEventId: response.auditEventId,
      action: request.action,
      fromState: "escalated",
      toState: result.state,
      contactPointIndex: null,
      suppressionReason: null,
      escalationId,
      escalationStateBefore: "acknowledged",
      escalationStateAfter: "resolved",
      handoffId: null,
      activeSuppressionsAfter: [],
      nextContactAt: result.nextContactAt,
      outcomeCode: result.outcomeCode,
      occurredAt,
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
      actorKind: "staff",
      actorUid: authority.uid,
    } as unknown as StaffSafeCareEnrollmentEvent;
    const resolved = careEscalation({
      ...priorEscalation,
      state: "resolved",
      resolvedAt: occurredAt,
      resolvedByUid: authority.uid as never,
      resolutionCode: "safety_hold_applied",
      writeBackState: "unavailable_in_demo",
      revision: 3,
      lastEventId: event.id,
      updatedAt: occurredAt,
    });
    const current = {
      ...careOperation({
        state: result.state,
        openEscalationId: null,
        safetyHoldEscalationId: escalationId as never,
        revision: result.revision,
        outcomeCode: result.outcomeCode,
        lastEventId: event.id,
        updatedAt: occurredAt,
      }),
      eventEscalation: resolved,
      safetyHoldEscalation: resolved,
    };
    const evidence: CareActionEvidence = {
      event,
      audit: runtimeAudit({
        id: response.auditEventId,
        actorUid: authority.uid,
        action: "care_enrollment.resolve_escalation",
        resourceType: "care_enrollment",
        resourceId: result.enrollmentId,
        eventId: result.eventId,
        revision: result.revision,
        occurredAt,
        resultFingerprint: await careControlResultFingerprint(result),
      }),
      escalations: [resolved],
      handoff: null,
    };
    await expect(
      assertCareActionEvidence({
        session: authority,
        previous,
        current,
        request,
        response,
        evidence,
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertCareActionEvidence({
        session: authority,
        previous,
        current,
        request,
        response,
        evidence: {
          ...evidence,
          escalations: [
            {
              ...resolved,
              state: "acknowledged",
              resolvedAt: null,
              resolvedByUid: null,
              resolutionCode: null,
              writeBackState: "pending",
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "evidence_mismatch" });
  });

  it("requires release to close the exact care handoff aggregate", async () => {
    const authority = session("clinical_approver");
    const handoffId = "care_handoff_1";
    const occurredAt = isoDateTime("2026-08-07T13:06:00.000Z");
    const priorHandoff = careHandoff({ id: handoffId as never });
    const previous = {
      ...careOperation({
        state: "paused_for_human",
        openHandoffId: handoffId as never,
        revision: 2,
        outcomeCode: "human_takeover_required",
        lastEventId: "care_event_takeover" as never,
        updatedAt: priorHandoff.updatedAt,
      }),
      handoff: priorHandoff,
    };
    const request: CareFunctionsRequest = {
      workspaceId,
      enrollmentId: SYNTHETIC_CARE_ENROLLMENT_ID,
      action: "release_human_takeover",
      expectedRevision: 2,
      suppressionReason: null,
      idempotencyKey: "phase5-care-ui-gggggggggggggggggggggggggggggggggggggggggggg",
    };
    const result: CareFunctionsResponse["result"] = {
      enrollmentId: SYNTHETIC_CARE_ENROLLMENT_ID,
      eventId: "care_event_release",
      action: request.action,
      state: "paused_by_operator",
      revision: 3,
      nextContactIndex: 0,
      nextContactAt: previous.enrollment.nextContactAt,
      openEscalationId: null,
      safetyHoldEscalationId: null,
      openHandoffId: null,
      outcomeCode: "accepted",
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
    };
    const response: CareFunctionsResponse = {
      result,
      auditEventId: "audit_care_event_release",
      replayed: false,
    };
    const event = {
      id: result.eventId,
      workspaceId,
      enrollmentId: result.enrollmentId,
      pathwayId: previous.enrollment.pathwayId,
      pathwayProtocolVersion: previous.enrollment.pathwayProtocolVersion,
      pathwayContentHash: previous.enrollment.pathwayContentHash,
      teamId: previous.enrollment.teamId,
      locationId: previous.enrollment.locationId,
      revision: result.revision,
      auditEventId: response.auditEventId,
      action: request.action,
      fromState: "paused_for_human",
      toState: result.state,
      contactPointIndex: null,
      suppressionReason: null,
      escalationId: null,
      escalationStateBefore: null,
      escalationStateAfter: null,
      handoffId,
      activeSuppressionsAfter: [],
      nextContactAt: result.nextContactAt,
      outcomeCode: result.outcomeCode,
      occurredAt,
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
      actorKind: "staff",
      actorUid: authority.uid,
    } as unknown as StaffSafeCareEnrollmentEvent;
    const released = careHandoff({
      ...priorHandoff,
      state: "released",
      releasedEventId: event.id,
      releasedBy: { actorKind: "staff", actorUid: authority.uid as never },
      releasedAt: occurredAt,
      revision: 2,
      lastEventId: event.id,
      updatedAt: occurredAt,
    });
    const current = {
      ...careOperation({
        state: result.state,
        openHandoffId: null,
        revision: result.revision,
        outcomeCode: result.outcomeCode,
        lastEventId: event.id,
        updatedAt: occurredAt,
      }),
      handoff: released,
    };
    const evidence: CareActionEvidence = {
      event,
      audit: runtimeAudit({
        id: response.auditEventId,
        actorUid: authority.uid,
        action: "care_enrollment.release_human_takeover",
        resourceType: "care_enrollment",
        resourceId: result.enrollmentId,
        eventId: result.eventId,
        revision: result.revision,
        occurredAt,
        resultFingerprint: await careControlResultFingerprint(result),
      }),
      escalations: [],
      handoff: released,
    };
    await expect(
      assertCareActionEvidence({
        session: authority,
        previous,
        current,
        request,
        response,
        evidence,
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertCareActionEvidence({
        session: authority,
        previous,
        current,
        request,
        response,
        evidence: {
          ...evidence,
          handoff: {
            ...released,
            state: "open",
            releasedEventId: null,
            releasedBy: null,
            releasedAt: null,
          },
        },
      }),
    ).rejects.toMatchObject({ code: "evidence_mismatch" });
  });
});
