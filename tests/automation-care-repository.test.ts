import { createHash } from "node:crypto";
import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";

import {
  PHASE5_COLLECTIONS,
  PHASE5_SECRET_COLLECTIONS,
  PHASE5_STAFF_COLLECTIONS,
  assertAutomationDefinitionGovernanceHashes,
  assertAutomationRunEventSecretJoin,
  assertCarePathwayGovernanceHashes,
  assertPhase5EventAuditJoin,
  parseAutomationDefinitionDocument,
  parseAutomationRunDocument,
  parseAutomationRunEventDocument,
  parseAutomationRunEventSecretDocument,
  parseCareEnrollmentDocument,
  parseCareHandoffDocument,
  parseCarePathwayDocument,
  parsePhase5AuditDocument,
  prepareAutomationCatalogueListInput,
} from "@/lib/firebase/repositories/automation-care-repository";
import {
  serializeAutomationDefinitionApproval,
  serializeAutomationDefinitionContent,
  serializeCarePathwayApproval,
  serializeCarePathwayContent,
} from "@/lib/domain/automation-governance";
import { entityId, sha256Digest } from "@/lib/domain/primitives";

const workspaceId = "workspace_safenet_demo";
const at = (iso: string) => Timestamp.fromDate(new Date(iso));
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const createdAtIso = "2026-08-07T09:00:00.000Z";
const updatedAtIso = "2026-08-07T09:10:00.000Z";
const digest = "a".repeat(64);

function automationDefinitionDocument() {
  const id = "automation_synthetic_appointment_v3";
  const approvedAt = "2026-08-07T09:05:00.000Z";
  const content = {
    workspaceId,
    definitionId: id,
    family: "appointment_service" as const,
    version: 3,
    name: "Synthetic appointment service",
    trigger: "appointment_event" as const,
    consentPurpose: "appointment_service" as const,
    riskLevel: "medium" as const,
    steps: [
      {
        id: "step_send_appointment",
        kind: "send_template" as const,
        templateVersionId: entityId<"TemplateVersion">(
          "template_appointment_confirmation_en_v3",
        ),
        templateContentHash: sha256Digest("1".repeat(64)),
        waitSeconds: null,
        appointmentAction: null,
        routeTeamId: null,
        stopReasonCode: null,
        requiredConsentPurpose: "appointment_service" as const,
        serviceWindowBehavior: "use_approved_template" as const,
        timeoutSeconds: 86_400,
        retryMaxAttempts: 1,
        retryInitialBackoffSeconds: 86_400,
        retryMaximumBackoffSeconds: 86_400,
        fallback: "create_work_item" as const,
      },
    ],
    secretBindingHash: "2".repeat(64),
    synthetic: true as const,
  };
  const contentHash = hash(serializeAutomationDefinitionContent(content));
  const approvalHash = hash(
    serializeAutomationDefinitionApproval({
      workspaceId,
      definitionId: id,
      contentHash,
      ownerUid: "user_demo_admin",
      approverUid: "user_demo_supervisor",
      scope: "simulation_only",
      approvedAt,
    }),
  );
  return {
    id,
    workspaceId,
    family: content.family,
    version: content.version,
    name: content.name,
    trigger: content.trigger,
    consentPurpose: content.consentPurpose,
    riskLevel: content.riskLevel,
    steps: content.steps,
    contentHash,
    secretBindingHash: content.secretBindingHash,
    ownerUid: "user_demo_admin",
    approverUid: "user_demo_supervisor",
    approvalHash,
    approvalScope: "simulation_only",
    approvedAt: at(approvedAt),
    lifecycleState: "approved",
    schemaVersion: 1,
    synthetic: true,
    createdAt: at(createdAtIso),
    updatedAt: at(updatedAtIso),
  };
}

function carePathwayDocument(locationCount = 2) {
  const id = "care_pathway_synthetic_followup_v1";
  const approvedAt = "2026-08-07T09:06:00.000Z";
  const eligibleLocationIds = Array.from(
    { length: locationCount },
    (_, index) => `location_${String(index + 1).padStart(3, "0")}`,
  );
  const content = {
    workspaceId,
    pathwayId: id,
    family: "post_discharge" as const,
    protocolVersion: "v1.0",
    name: "Synthetic post-discharge pathway",
    clinicalOwnerUid: "user_demo_admin",
    contactPoints: [
      {
        dayOffset: 1,
        en: {
          templateVersionId: entityId<"TemplateVersion">(
            "template_synthetic_care_day1_en_v1",
          ),
          contentHash: sha256Digest("3".repeat(64)),
        },
        si: {
          templateVersionId: entityId<"TemplateVersion">(
            "template_synthetic_care_day1_si_v1",
          ),
          contentHash: sha256Digest("4".repeat(64)),
        },
        ta: {
          templateVersionId: entityId<"TemplateVersion">(
            "template_synthetic_care_day1_ta_v1",
          ),
          contentHash: sha256Digest("5".repeat(64)),
        },
      },
    ],
    responseSlaMinutes: 15,
    escalationTeamId: "team_demo_clinical_escalation",
    eligibleLocationIds,
    afterHoursBehavior: "on_call_queue" as const,
    writeBackRequired: true,
    instructionsSource: "clinician_authored" as const,
    aiMayGenerateInstructions: false as const,
    suppressions: [
      "readmission",
      "transfer",
      "death",
      "clinical_hold",
      "withdrawal",
      "invalid_contact",
    ] as const,
    protectedContentHash: "6".repeat(64),
    secretBindingHash: "7".repeat(64),
    synthetic: true as const,
  };
  const contentHash = hash(serializeCarePathwayContent(content));
  const approvalHash = hash(
    serializeCarePathwayApproval({
      workspaceId,
      pathwayId: id,
      contentHash,
      clinicalOwnerUid: content.clinicalOwnerUid,
      clinicalApproverUid: "user_demo_clinical_approver",
      scope: "clinical_simulation_only",
      approvedAt,
    }),
  );
  return {
    id,
    workspaceId,
    family: content.family,
    protocolVersion: content.protocolVersion,
    name: content.name,
    clinicalOwnerUid: content.clinicalOwnerUid,
    clinicalApproverUid: "user_demo_clinical_approver",
    contactPoints: content.contactPoints,
    responseSlaMinutes: content.responseSlaMinutes,
    escalationTeamId: content.escalationTeamId,
    eligibleLocationIds,
    afterHoursBehavior: content.afterHoursBehavior,
    writeBackRequired: content.writeBackRequired,
    instructionsSource: content.instructionsSource,
    aiMayGenerateInstructions: content.aiMayGenerateInstructions,
    suppressions: content.suppressions,
    protectedContentHash: content.protectedContentHash,
    secretBindingHash: content.secretBindingHash,
    contentHash,
    approvalHash,
    approvalScope: "clinical_simulation_only",
    approvedAt: at(approvedAt),
    lifecycleState: "approved",
    schemaVersion: 1,
    synthetic: true,
    createdAt: at(createdAtIso),
    updatedAt: at(updatedAtIso),
  };
}

function automationRunDocument() {
  return {
    id: "automation_run_synthetic_appointment_001",
    workspaceId,
    definitionId: "automation_synthetic_appointment_v3",
    definitionVersion: 3,
    definitionContentHash: digest,
    teamId: "team_demo_general",
    locationId: "location_demo_wattala",
    state: "failed",
    pausedFromState: null,
    nextEligibleAt: null,
    openWorkItemId: "automation_work_item_synthetic_011",
    currentStepIndex: 0,
    completedStepCount: 0,
    attemptCount: 11,
    revision: 11,
    outcomeCode: "synthetic_failure",
    lastEventId: "automation_run_event_synthetic_011",
    schemaVersion: 1,
    synthetic: true,
    externalDispatchCount: 0,
    networkCallCount: 0,
    createdAt: at(createdAtIso),
    updatedAt: at(updatedAtIso),
  };
}

function automationEventDocument() {
  return {
    id: "automation_run_event_synthetic_004",
    workspaceId,
    runId: "automation_run_synthetic_appointment_001",
    definitionId: "automation_synthetic_appointment_v3",
    definitionVersion: 3,
    definitionContentHash: digest,
    teamId: "team_demo_general",
    locationId: "location_demo_wattala",
    revision: 4,
    auditEventId: "audit_automation_run_event_004",
    action: "exercise_fallback",
    fromState: "running",
    toState: "paused_by_operator",
    stepIndex: 0,
    stepId: "step_send_appointment",
    attemptNumber: 1,
    workItemId: "automation_work_item_synthetic_001",
    nextEligibleAt: null,
    reasonCode: "fallback_policy_applied",
    evidenceFingerprint: "c".repeat(64),
    outcomeCode: "fallback_work_item_created",
    occurredAt: at(updatedAtIso),
    schemaVersion: 1,
    synthetic: true,
    externalDispatchCount: 0,
    networkCallCount: 0,
    actorKind: "system",
    actorUid: null,
  };
}

describe("automation/care persistence contract", () => {
  it("freezes exactly 13 staff and 10 server-only collections", () => {
    expect(PHASE5_STAFF_COLLECTIONS).toHaveLength(13);
    expect(PHASE5_SECRET_COLLECTIONS).toHaveLength(10);
    expect(PHASE5_COLLECTIONS).toHaveLength(23);
    expect(new Set(PHASE5_COLLECTIONS).size).toBe(23);
  });

  it("accepts attempt 11 and rejects attempt 12 or aggregate pointer drift", () => {
    const valid = automationRunDocument();
    expect(
      parseAutomationRunDocument(valid, valid.id, workspaceId).attemptCount,
    ).toBe(11);
    expect(() =>
      parseAutomationRunDocument({ ...valid, attemptCount: 12 }, valid.id, workspaceId),
    ).toThrow(/strict persisted schema/i);
    expect(() =>
      parseAutomationRunDocument({ ...valid, lastEventId: null }, valid.id, workspaceId),
    ).toThrow(/state and outcome/i);
    expect(() =>
      parseAutomationRunDocument(
        { ...valid, currentStepIndex: 1, completedStepCount: 0 },
        valid.id,
        workspaceId,
      ),
    ).toThrow(/state and outcome/i);
    expect(() =>
      parseAutomationRunDocument({ ...valid, contactId: "contact_leak" }, valid.id, workspaceId),
    ).toThrow(/strict persisted schema/i);
    const pristine = {
      ...valid,
      state: "queued",
      openWorkItemId: null,
      attemptCount: 0,
      revision: 1,
      outcomeCode: "accepted",
      lastEventId: null,
      updatedAt: at(createdAtIso),
    };
    expect(
      parseAutomationRunDocument(pristine, pristine.id, workspaceId).revision,
    ).toBe(1);
  });

  it("accepts exact waiting and failed resume outcomes and rejects substitutions", () => {
    const failed = automationRunDocument();
    const waitingAccepted = {
      ...failed,
      state: "waiting",
      pausedFromState: null,
      nextEligibleAt: at("2026-08-07T09:15:00.000Z"),
      openWorkItemId: null,
      attemptCount: 1,
      outcomeCode: "accepted",
    };
    expect(
      parseAutomationRunDocument(
        waitingAccepted,
        waitingAccepted.id,
        workspaceId,
      ).outcomeCode,
    ).toBe("accepted");
    expect(() =>
      parseAutomationRunDocument(
        { ...waitingAccepted, outcomeCode: "synthetic_failure" },
        waitingAccepted.id,
        workspaceId,
      ),
    ).toThrow(/state and outcome/i);

    const failedAccepted = { ...failed, outcomeCode: "accepted" };
    expect(
      parseAutomationRunDocument(failedAccepted, failedAccepted.id, workspaceId)
        .outcomeCode,
    ).toBe("accepted");
    expect(() =>
      parseAutomationRunDocument(
        { ...failedAccepted, outcomeCode: "step_completed" },
        failedAccepted.id,
        workspaceId,
      ),
    ).toThrow(/state and outcome/i);
  });

  it("enforces frozen automation step bounds and canonical governance hashes", () => {
    const raw = automationDefinitionDocument();
    const parsed = parseAutomationDefinitionDocument(raw, raw.id, workspaceId);
    expect(() => assertAutomationDefinitionGovernanceHashes(parsed, hash)).not.toThrow();
    expect(() =>
      assertAutomationDefinitionGovernanceHashes({ ...parsed, name: "Substituted" }, hash),
    ).toThrow(/contentHash/i);
    expect(() =>
      parseAutomationDefinitionDocument(
        {
          ...raw,
          steps: [{ ...raw.steps[0], timeoutSeconds: 86_401 }],
        },
        raw.id,
        workspaceId,
      ),
    ).toThrow(/strict persisted schema/i);
  });

  it("accepts 64 care locations, rejects 65, and binds content plus approval", () => {
    const raw = carePathwayDocument(64);
    const parsed = parseCarePathwayDocument(raw, raw.id, workspaceId);
    expect(parsed.eligibleLocationIds).toHaveLength(64);
    expect(() => assertCarePathwayGovernanceHashes(parsed, hash)).not.toThrow();
    expect(() =>
      assertCarePathwayGovernanceHashes(
        { ...parsed, approvalHash: "f".repeat(64) as typeof parsed.approvalHash },
        hash,
      ),
    ).toThrow(/approvalHash/i);
    const tooMany = {
      ...raw,
      eligibleLocationIds: [...raw.eligibleLocationIds, "location_065"],
    };
    expect(() => parseCarePathwayDocument(tooMany, tooMany.id, workspaceId)).toThrow(
      /strict persisted schema/i,
    );
  });

  it("fails closed for care enrollment revision, event and protected-field drift", () => {
    const enrollment = {
      id: "care_enrollment_synthetic_001",
      workspaceId,
      pathwayId: "care_pathway_synthetic_followup_v1",
      pathwayProtocolVersion: "v1.0",
      pathwayContentHash: digest,
      teamId: "team_demo_clinical_escalation",
      locationId: "location_demo_wattala",
      state: "queued",
      nextContactIndex: 0,
      nextContactAt: at("2026-08-08T09:00:00.000Z"),
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
      createdAt: at(createdAtIso),
      updatedAt: at(createdAtIso),
    };
    expect(
      parseCareEnrollmentDocument(enrollment, enrollment.id, workspaceId).state,
    ).toBe("queued");
    expect(() =>
      parseCareEnrollmentDocument(
        { ...enrollment, revision: 2 },
        enrollment.id,
        workspaceId,
      ),
    ).toThrow(/state and outcome/i);
    expect(() =>
      parseCareEnrollmentDocument(
        { ...enrollment, state: "active" },
        enrollment.id,
        workspaceId,
      ),
    ).toThrow(/state and outcome/i);
    expect(() =>
      parseCareEnrollmentDocument(
        { ...enrollment, patientId: "patient_leak" },
        enrollment.id,
        workspaceId,
      ),
    ).toThrow(/strict persisted schema/i);
  });

  it("requires the same-ID mandatory HMAC event secret", () => {
    const eventRaw = automationEventDocument();
    const event = parseAutomationRunEventDocument(eventRaw, eventRaw.id, workspaceId);
    const secretRaw = {
      workspaceId,
      runId: event.runId,
      eventId: event.id,
      protectedContextRef: "demo://automation/run-event/context-004",
      contextFingerprint: event.evidenceFingerprint,
      schemaVersion: 1,
      synthetic: true,
    };
    const secret = parseAutomationRunEventSecretDocument(
      secretRaw,
      event.id,
      workspaceId,
    );
    expect(() => assertAutomationRunEventSecretJoin(event, secret)).not.toThrow();
    expect(() => assertAutomationRunEventSecretJoin(event, null)).toThrow(
      /governed domain validation/i,
    );
    expect(() =>
      assertAutomationRunEventSecretJoin(event, {
        ...secret,
        contextFingerprint: "d".repeat(64) as typeof secret.contextFingerprint,
      }),
    ).toThrow(/governed domain validation/i);
  });

  it("parses the deployed audit wire shape and exactly joins event evidence", () => {
    const eventRaw = automationEventDocument();
    const event = parseAutomationRunEventDocument(eventRaw, eventRaw.id, workspaceId);
    const auditRaw = {
      id: event.auditEventId,
      workspaceId,
      actorUid: "phase5-automation-service",
      actorType: "service",
      action: "automation.exercise_fallback",
      resourceType: "automation_run",
      resourceId: event.runId,
      outcome: "simulated",
      requestId: "request_automation_004",
      occurredAt: at(updatedAtIso),
      createdAt: at(updatedAtIso),
      metadata: {
        eventId: event.id,
        revision: event.revision,
        resultFingerprint: "e".repeat(64),
        synthetic: true,
      },
      synthetic: true,
      schemaVersion: 1,
    };
    const audit = parsePhase5AuditDocument(auditRaw, auditRaw.id, workspaceId);
    expect(() =>
      assertPhase5EventAuditJoin(event, audit, "automation_run", event.runId),
    ).not.toThrow();
    expect(() =>
      assertPhase5EventAuditJoin(
        event,
        { ...audit, resourceId: "automation_run_substituted" },
        "automation_run",
        event.runId,
      ),
    ).toThrow(/exact join/i);
    expect(() =>
      assertPhase5EventAuditJoin(
        event,
        { ...audit, metadata: { ...audit.metadata, resultFingerprint: null } },
        "automation_run",
        event.runId,
      ),
    ).toThrow(/exact join/i);
    expect(() =>
      assertPhase5EventAuditJoin(
        event,
        { ...audit, action: "automation.pause" },
        "automation_run",
        event.runId,
      ),
    ).toThrow(/exact join/i);
    expect(() =>
      parsePhase5AuditDocument(
        { ...auditRaw, metadata: { patientId: "protected" } },
        auditRaw.id,
        workspaceId,
      ),
    ).toThrow(/protected field/i);
  });

  it("enforces the atomic care handoff lifecycle and strict top-level keys", () => {
    const raw = {
      id: "care_handoff_synthetic_001",
      workspaceId,
      enrollmentId: "care_enrollment_synthetic_001",
      pathwayId: "care_pathway_synthetic_followup_v1",
      pathwayProtocolVersion: "v1.0",
      pathwayContentHash: digest,
      teamId: "team_demo_clinical_escalation",
      locationId: "location_demo_wattala",
      state: "open",
      openedEventId: "care_enrollment_event_handoff_001",
      openedBy: { actorKind: "staff", actorUid: "user_demo_clinical_approver" },
      openedAt: at(updatedAtIso),
      releasedEventId: null,
      releasedBy: null,
      releasedAt: null,
      revision: 1,
      lastEventId: "care_enrollment_event_handoff_001",
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
      createdAt: at(updatedAtIso),
      updatedAt: at(updatedAtIso),
    };
    expect(parseCareHandoffDocument(raw, raw.id, workspaceId).state).toBe("open");
    expect(() =>
      parseCareHandoffDocument({ ...raw, dischargeId: "protected" }, raw.id, workspaceId),
    ).toThrow(/strict persisted schema/i);
  });

  it("bounds catalogue queries and rejects non-executable families", () => {
    expect(
      prepareAutomationCatalogueListInput({
        workspaceId,
        family: "appointment_service",
        pageSize: 100,
      }).pageSize,
    ).toBe(100);
    expect(() =>
      prepareAutomationCatalogueListInput({
        workspaceId,
        family: "appointment_service",
        pageSize: 101,
      }),
    ).toThrow(/input failed validation/i);
    expect(() =>
      prepareAutomationCatalogueListInput({
        workspaceId,
        family: "feedback" as "appointment_service",
      }),
    ).toThrow(/input failed validation/i);
  });
});
