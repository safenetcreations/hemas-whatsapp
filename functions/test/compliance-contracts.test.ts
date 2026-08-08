import assert from "node:assert/strict";
import test from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import {
  COMPLIANCE_SAFE_SUMMARY_BY_ACTION,
  FIRESTORE_AUDIT_METADATA_CONTRACTS,
  KNOWN_FIRESTORE_AUDIT_ACTIONS,
  parseClientSafeComplianceAuditEvent,
  parseFirestoreAuditRecordV1,
  parseListComplianceAuditEventsInput,
  parseListComplianceAuditEventsResult,
  projectClientSafeComplianceAuditEvent,
  type KnownComplianceAuditAction,
} from "../src/compliance/contracts.js";

const WORKSPACE_ID = "workspace_safenet_demo";
const OCCURRED_AT = Timestamp.fromDate(
  new Date("2026-08-07T13:03:00.000Z"),
);

function familyFor(action: KnownComplianceAuditAction) {
  for (const contract of Object.values(FIRESTORE_AUDIT_METADATA_CONTRACTS)) {
    if ((contract.actions as readonly string[]).includes(action)) return contract;
  }
  throw new Error(`Missing family for ${action}.`);
}

function metadataFor(action: KnownComplianceAuditAction): Readonly<Record<string, unknown>> {
  if (action === "internal-note.create") {
    return {
      purpose: "patient_support",
      noteKind: "handoff_context",
      teamId: "team_demo_general",
      locationId: "location_demo_wattala",
      synthetic: true,
    };
  }
  if (action.startsWith("appointment.")) {
    const appointmentAction = action.slice("appointment.".length);
    return {
      purpose: "appointment_service",
      appointmentAction,
      fromStatus: "confirmed",
      toStatus:
        appointmentAction === "request_reschedule"
          ? "reschedule_pending"
          : "cancel_pending",
      revision: 2,
      teamId: "team_demo_general",
      locationId: "location_demo_wattala",
      synthetic: true,
      authoritativeSystem: "simulator",
    };
  }
  if (action.startsWith("campaign.")) {
    return {
      purpose: "campaign_governance",
      campaignAction: action.slice("campaign.".length),
      fromState: "scheduled",
      toState: "dispatching",
      revision: 2,
      checkpointId: null,
      batchEligibleCount: 1_000,
      processedEligible: 1_000,
      scanOffset: 1_304,
      dispatchMode: "simulation",
      synthetic: true,
      externalCalls: 0,
      networkCalls: 0,
    };
  }
  if (action.startsWith("automation.")) {
    return {
      eventId: "automation_run_event_synthetic_001",
      fromState: "queued",
      toState: "running",
      revision: 2,
      outcomeCode: "accepted",
      resultFingerprint: "a".repeat(64),
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
    };
  }
  if (action.startsWith("care_enrollment.")) {
    return {
      eventId: "care_enrollment_event_synthetic_001",
      fromState: "queued",
      toState: "active",
      revision: 2,
      outcomeCode: "accepted",
      resultFingerprint: "b".repeat(64),
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
    };
  }
  if (action === "ai.retrospective_evaluation_recorded") {
    return {
      scenarioId: "appointment",
      outcome: "preview_only",
      evaluationScope: "retrospective_synthetic_fixture",
      synthetic: true,
      modelCallCount: 0,
      providerCallCount: 0,
      externalDispatchCount: 0,
      conversationMutationCount: 0,
      handoffMutationCount: 0,
      suppressionMutationCount: 0,
    };
  }
  return {
    eventId: "governance_event_synthetic_001",
    revision: 1,
    synthetic: true,
    externalDispatchCount: 0,
    networkCallCount: 0,
  };
}

function auditRecord(
  action: KnownComplianceAuditAction | string = "automation.start",
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  const known = KNOWN_FIRESTORE_AUDIT_ACTIONS.includes(
    action as KnownComplianceAuditAction,
  );
  const contract = known ? familyFor(action as KnownComplianceAuditAction) : null;
  return {
    id: "audit_synthetic_001",
    workspaceId: WORKSPACE_ID,
    actorUid: "user_demo_admin",
    actorType: "user",
    action,
    resourceType: contract?.resourceType ?? "privacy_export",
    resourceId: "resource_synthetic_001",
    outcome: "allowed",
    requestId: "request_synthetic_001",
    occurredAt: OCCURRED_AT,
    createdAt: OCCURRED_AT,
    metadata: known
      ? metadataFor(action as KnownComplianceAuditAction)
      : { reasonCode: "synthetic_review", revision: 1, synthetic: true },
    synthetic: true,
    schemaVersion: 1,
    ...overrides,
  };
}

function hasCode(expected: string): (error: unknown) => boolean {
  return (error: unknown) =>
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { readonly code: unknown }).code === expected;
}

test("Compliance request and cursor schema are exact and bounded", () => {
  const valid = {
    workspaceId: WORKSPACE_ID,
    outcome: null,
    pageSize: 25,
    cursor: {
      createdAt: "2026-08-07T13:03:00.000Z",
      id: "audit_synthetic_001",
    },
  } as const;
  assert.deepEqual(parseListComplianceAuditEventsInput(valid), valid);
  assert.equal(
    parseListComplianceAuditEventsInput({ ...valid, pageSize: 1 }).pageSize,
    1,
  );
  assert.equal(
    parseListComplianceAuditEventsInput({ ...valid, pageSize: 50 }).pageSize,
    50,
  );
  for (const invalid of [
    { ...valid, extra: true },
    { ...valid, workspaceId: "unsafe/path" },
    { ...valid, outcome: "safety_hold" },
    { ...valid, pageSize: 0 },
    { ...valid, pageSize: 51 },
    { ...valid, cursor: { ...valid.cursor, createdAt: "not-a-time" } },
    { ...valid, cursor: { ...valid.cursor, extra: true } },
  ]) {
    assert.throws(
      () => parseListComplianceAuditEventsInput(invalid),
      hasCode("invalid_compliance_request"),
    );
  }
});

test("all 45 known audit actions retain exact metadata and projection vocabulary", () => {
  assert.equal(KNOWN_FIRESTORE_AUDIT_ACTIONS.length, 45);
  assert.equal(new Set(KNOWN_FIRESTORE_AUDIT_ACTIONS).size, 45);
  for (const action of KNOWN_FIRESTORE_AUDIT_ACTIONS) {
    const parsed = parseFirestoreAuditRecordV1(
      auditRecord(action),
      "audit_synthetic_001",
      WORKSPACE_ID,
    );
    const projection = projectClientSafeComplianceAuditEvent(parsed);
    assert.equal(projection.action, action);
    assert.equal(projection.resource.type, familyFor(action).resourceType);
    assert.equal(
      projection.safeSummaryCode,
      COMPLIANCE_SAFE_SUMMARY_BY_ACTION[action],
    );
    assert.equal(projection.actor.id, "event_actor:audit_synthetic_001");
    assert.equal(projection.resource.id, "event_resource:audit_synthetic_001");
  }
});

test("raw v1 parser rejects polluted, nested, time, path and known metadata substitutions", () => {
  const raw = auditRecord("automation.start");
  const metadata = raw.metadata as Readonly<Record<string, unknown>>;
  for (const invalid of [
    { ...raw, extra: true },
    { ...raw, schemaVersion: 2 },
    { ...raw, synthetic: false },
    { ...raw, actorType: "patient" },
    { ...raw, outcome: "success" },
    { ...raw, resourceType: "care_enrollment" },
    { ...raw, occurredAt: new Date("2026-08-07T13:03:00.000Z") },
    {
      ...raw,
      occurredAt: new Timestamp(OCCURRED_AT.seconds, 1),
      createdAt: new Timestamp(OCCURRED_AT.seconds, 1),
    },
    { ...raw, createdAt: Timestamp.fromMillis(OCCURRED_AT.toMillis() + 1) },
    { ...raw, metadata: { ...metadata, nested: { patient: "hidden" } } },
    { ...raw, metadata: { ...metadata, teamId: "team_substituted" } },
    { ...raw, metadata: { ...metadata, fromState: "active" } },
    { ...raw, metadata: { ...metadata, outcomeCode: "clinical_hold_applied" } },
    { ...raw, metadata: { ...metadata, resultFingerprint: "A".repeat(64) } },
  ]) {
    assert.throws(
      () => parseFirestoreAuditRecordV1(invalid),
      hasCode("invalid_compliance_audit"),
    );
  }
  assert.throws(
    () => parseFirestoreAuditRecordV1(raw, "audit_substituted", WORKSPACE_ID),
    hasCode("invalid_compliance_audit"),
  );
});

test("appointment and campaign action metadata cannot be substituted", () => {
  const appointment = auditRecord("appointment.request_reschedule");
  assert.throws(() =>
    parseFirestoreAuditRecordV1({
      ...appointment,
      metadata: {
        ...(appointment.metadata as object),
        appointmentAction: "request_cancellation",
        toStatus: "cancel_pending",
      },
    }),
  );
  const campaign = auditRecord("campaign.start");
  assert.throws(() =>
    parseFirestoreAuditRecordV1({
      ...campaign,
      metadata: { ...(campaign.metadata as object), campaignAction: "pause" },
    }),
  );
});

test("unknown actions are minimized and raw evidence cannot enter the projection", () => {
  const parsed = parseFirestoreAuditRecordV1(
    auditRecord("privacy.export_requested", {
      actorUid: "private_actor",
      resourceId: "private_resource",
      requestId: "private_request",
      metadata: {
        innocuousLabel: "private clinical value",
        revision: 1,
        synthetic: true,
      },
    }),
  );
  const projected = projectClientSafeComplianceAuditEvent(parsed);
  assert.deepEqual(
    {
      action: projected.action,
      resourceType: projected.resource.type,
      summary: projected.safeSummaryCode,
    },
    {
      action: "unsupported_event",
      resourceType: "unsupported_event",
      summary: "unsupported_event",
    },
  );
  const serialized = JSON.stringify(projected);
  for (const secret of [
    "private_actor",
    "private_resource",
    "private_request",
    "private clinical value",
    "metadata",
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("client projection and response parsers reject aliases, extras and cursor substitution", () => {
  const event = projectClientSafeComplianceAuditEvent(
    parseFirestoreAuditRecordV1(auditRecord("care_pathway.activate")),
  );
  assert.deepEqual(
    parseClientSafeComplianceAuditEvent(event, WORKSPACE_ID, "allowed"),
    event,
  );
  for (const invalid of [
    { ...event, requestId: "raw_request" },
    { ...event, actor: { ...event.actor, id: "event_actor:substituted" } },
    { ...event, resource: { ...event.resource, type: "care_enrollment" } },
    { ...event, safeSummaryCode: "care_pathway_approved" },
    { ...event, workspaceId: "workspace_other" },
  ]) {
    assert.throws(
      () => parseClientSafeComplianceAuditEvent(invalid, WORKSPACE_ID, "allowed"),
      hasCode("invalid_compliance_projection"),
    );
  }
  const response = {
    events: [event],
    nextCursor: { createdAt: event.occurredAt, id: event.id },
  };
  assert.deepEqual(
    parseListComplianceAuditEventsResult(response, WORKSPACE_ID, "allowed"),
    response,
  );
  assert.throws(
    () =>
      parseListComplianceAuditEventsResult({
        ...response,
        nextCursor: { ...response.nextCursor, id: "audit_substituted" },
      }),
    hasCode("invalid_compliance_projection"),
  );
});
