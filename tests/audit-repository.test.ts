import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";
import {
  FIRESTORE_AUDIT_METADATA_CONTRACTS,
  KNOWN_FIRESTORE_AUDIT_ACTIONS,
  AuditRepositoryError,
  parseClientSafeAuditEventProjection,
  parseFirestoreAuditRecordV1,
  projectClientSafeAuditEvent,
  type FirestoreAuditMetadataValue,
  type KnownFirestoreAuditAction,
} from "@/lib/firebase/repositories/audit-repository";

const workspaceId = "workspace_safenet_demo";
const occurredAtIso = "2026-08-07T13:03:00.000Z";
const occurredAt = Timestamp.fromDate(new Date(occurredAtIso));

function familyFor(action: string): keyof typeof FIRESTORE_AUDIT_METADATA_CONTRACTS {
  const entry = Object.entries(FIRESTORE_AUDIT_METADATA_CONTRACTS).find(([, contract]) =>
    (contract.actions as readonly string[]).includes(action),
  );
  if (!entry) throw new Error(`Missing test family for ${action}.`);
  return entry[0] as keyof typeof FIRESTORE_AUDIT_METADATA_CONTRACTS;
}

function metadataFor(
  action: KnownFirestoreAuditAction,
): Readonly<Record<string, FirestoreAuditMetadataValue>> {
  const family = familyFor(action);
  if (family === "internal_note") {
    return {
      purpose: "patient_support",
      noteKind: "handoff_context",
      teamId: "team_demo_patient_support",
      locationId: "location_demo_wattala",
      synthetic: true,
    };
  }
  if (family === "appointment") {
    const appointmentAction = action.slice("appointment.".length) as
      | "request_reschedule"
      | "request_cancellation";
    return {
      purpose: "appointment_service",
      appointmentAction,
      fromStatus: "confirmed",
      toStatus:
        appointmentAction === "request_reschedule"
          ? "reschedule_pending"
          : "cancel_pending",
      revision: 2,
      teamId: "team_demo_appointment",
      locationId: "location_demo_wattala",
      synthetic: true,
      authoritativeSystem: "simulator",
    };
  }
  if (family === "campaign") {
    return {
      purpose: "campaign_governance",
      campaignAction: action.slice("campaign.".length),
      fromState: "scheduled",
      toState: "dispatching",
      revision: 2,
      checkpointId: null,
      batchEligibleCount: 1_000,
      processedEligible: 1_000,
      scanOffset: 1_200,
      dispatchMode: "simulation",
      synthetic: true,
      externalCalls: 0,
      networkCalls: 0,
    };
  }
  if (family === "automation_run") {
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
  if (family === "care_enrollment") {
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
  if (family === "ai_retrospective") {
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
    eventId: `${family}_event_synthetic_001`,
    revision: 1,
    synthetic: true,
    externalDispatchCount: 0,
    networkCallCount: 0,
  };
}

function auditRecord(
  action: KnownFirestoreAuditAction | string = "automation_definition.activate",
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  const family = KNOWN_FIRESTORE_AUDIT_ACTIONS.includes(action as KnownFirestoreAuditAction)
    ? familyFor(action)
    : null;
  return {
    id: "audit_synthetic_001",
    workspaceId,
    actorUid: "user_demo_automation_approver",
    actorType: "user",
    action,
    resourceType:
      family === null ? "privacy_export" : FIRESTORE_AUDIT_METADATA_CONTRACTS[family].resourceType,
    resourceId: "resource_synthetic_001",
    outcome: "allowed",
    requestId: "request_synthetic_001",
    occurredAt,
    createdAt: occurredAt,
    metadata:
      family === null
        ? { reasonCode: "synthetic_review", revision: 1, synthetic: true }
        : metadataFor(action as KnownFirestoreAuditAction),
    synthetic: true,
    schemaVersion: 1,
    ...overrides,
  };
}

describe("strict FirestoreAuditRecord v1 contract", () => {
  it("keeps one unique golden action contract for every current writer action", () => {
    expect(KNOWN_FIRESTORE_AUDIT_ACTIONS).toHaveLength(45);
    expect(new Set(KNOWN_FIRESTORE_AUDIT_ACTIONS).size).toBe(45);

    for (const action of KNOWN_FIRESTORE_AUDIT_ACTIONS) {
      const raw = auditRecord(action);
      const parsed = parseFirestoreAuditRecordV1(
        raw,
        "audit_synthetic_001",
        workspaceId,
      );
      expect(parsed.action).toBe(action);
      expect(parsed.occurredAt).toBe(occurredAtIso);
      expect(parsed.createdAt).toBe(occurredAtIso);
      expect(Object.keys(parsed.metadata).sort()).toEqual(
        [...FIRESTORE_AUDIT_METADATA_CONTRACTS[familyFor(action)].metadataKeys].sort(),
      );
    }
  });

  it("requires the exact 14 top-level keys, native timestamps and immutable time equality", () => {
    const raw = auditRecord();
    const parsed = parseFirestoreAuditRecordV1(raw);
    expect(Object.keys(parsed).sort()).toEqual([
      "action",
      "actorType",
      "actorUid",
      "createdAt",
      "id",
      "metadata",
      "occurredAt",
      "outcome",
      "requestId",
      "resourceId",
      "resourceType",
      "schemaVersion",
      "synthetic",
      "workspaceId",
    ]);
    expect(() => parseFirestoreAuditRecordV1({ ...raw, extra: true })).toThrow(
      AuditRepositoryError,
    );
    expect(() =>
      parseFirestoreAuditRecordV1({ ...raw, occurredAt: new Date(occurredAtIso) }),
    ).toThrow(/strict v1 validation/i);
    expect(() =>
      parseFirestoreAuditRecordV1({
        ...raw,
        createdAt: Timestamp.fromMillis(occurredAt.toMillis() + 1),
      }),
    ).toThrow(/must be equal/i);
  });

  it("rejects sub-millisecond Firestore timestamps before lossy ISO conversion", () => {
    const raw = auditRecord();
    const subMillisecond = new Timestamp(occurredAt.seconds, 1);
    expect(() =>
      parseFirestoreAuditRecordV1({
        ...raw,
        occurredAt: subMillisecond,
        createdAt: subMillisecond,
      }),
    ).toThrow(/millisecond precision/i);

    const millisecondAligned = new Timestamp(occurredAt.seconds, 123_000_000);
    const parsed = parseFirestoreAuditRecordV1({
      ...raw,
      occurredAt: millisecondAligned,
      createdAt: millisecondAligned,
    });
    expect(parsed.occurredAt).toBe("2026-08-07T13:03:00.123Z");
    expect(parsed.createdAt).toBe(parsed.occurredAt);
  });

  it("enforces path identity and actor, outcome, schema and synthetic bounds", () => {
    const raw = auditRecord();
    expect(() => parseFirestoreAuditRecordV1(raw, "audit_substituted", workspaceId)).toThrow(
      /document path/i,
    );
    expect(() =>
      parseFirestoreAuditRecordV1(raw, "audit_synthetic_001", "workspace_substituted"),
    ).toThrow(/document path/i);
    for (const substitution of [
      { actorType: "patient" },
      { outcome: "success" },
      { synthetic: false },
      { schemaVersion: 2 },
    ]) {
      expect(() => parseFirestoreAuditRecordV1({ ...raw, ...substitution })).toThrow(
        /strict v1 validation/i,
      );
    }
  });

  it("rejects nested metadata and known-action missing, extra or substituted fields", () => {
    const automation = auditRecord("automation.start");
    expect(() =>
      parseFirestoreAuditRecordV1({
        ...automation,
        metadata: { ...automation.metadata as object, nested: { patient: "protected" } },
      }),
    ).toThrow(/strict v1 validation/i);
    expect(() =>
      parseFirestoreAuditRecordV1({
        ...automation,
        metadata: { ...automation.metadata as object, teamId: "team_substituted" },
      }),
    ).toThrow(/exact family contract/i);
    const metadata = { ...(automation.metadata as Record<string, unknown>) };
    delete metadata.resultFingerprint;
    expect(() => parseFirestoreAuditRecordV1({ ...automation, metadata })).toThrow(
      /exact family contract/i,
    );
    expect(() =>
      parseFirestoreAuditRecordV1({
        ...automation,
        metadata: { ...automation.metadata as object, resultFingerprint: "A".repeat(64) },
      }),
    ).toThrow(/exact family contract/i);
  });

  it("cross-binds appointment and campaign action metadata and known resource types", () => {
    const appointment = auditRecord("appointment.request_reschedule");
    expect(() =>
      parseFirestoreAuditRecordV1({
        ...appointment,
        metadata: {
          ...(appointment.metadata as object),
          appointmentAction: "request_cancellation",
          toStatus: "cancel_pending",
        },
      }),
    ).toThrow(/substituted/i);
    const campaign = auditRecord("campaign.start");
    expect(() =>
      parseFirestoreAuditRecordV1({
        ...campaign,
        metadata: { ...(campaign.metadata as object), campaignAction: "pause" },
      }),
    ).toThrow(/substituted/i);
    expect(() =>
      parseFirestoreAuditRecordV1({ ...campaign, resourceType: "care_enrollment" }),
    ).toThrow(/resource type/i);
  });
});

describe("client-safe audit projection", () => {
  it("projects known events with exact safe keys and no stable IDs or raw evidence", () => {
    const parsed = parseFirestoreAuditRecordV1(auditRecord("automation.start"));
    const projected = projectClientSafeAuditEvent(parsed);
    expect(Object.keys(projected).sort()).toEqual([
      "action",
      "actor",
      "id",
      "occurredAt",
      "outcome",
      "resource",
      "safeSummaryCode",
      "schemaVersion",
      "synthetic",
      "workspaceId",
    ]);
    expect(projected).toMatchObject({
      action: "automation.start",
      actor: { type: "user", id: "event_actor:audit_synthetic_001" },
      resource: { type: "automation_run", id: "event_resource:audit_synthetic_001" },
      safeSummaryCode: "automation_started",
    });
    const serialized = JSON.stringify(projected);
    for (const protectedValue of [
      parsed.actorUid,
      parsed.resourceId,
      parsed.requestId,
      "team_demo_patient_support",
      "location_demo_wattala",
      "resultFingerprint",
      "metadata",
    ]) {
      expect(serialized).not.toContain(protectedValue);
    }
  });

  it("normalizes structurally valid unknown actions to one unsupported event", () => {
    const raw = auditRecord("privacy.export_requested", {
      actorUid: "same_actor",
      resourceId: "same_resource",
      metadata: {
        innocuousLabel: "protected value hidden under a benign key",
        revision: 1,
        synthetic: true,
      },
    });
    const first = projectClientSafeAuditEvent(parseFirestoreAuditRecordV1(raw));
    const second = projectClientSafeAuditEvent(
      parseFirestoreAuditRecordV1({ ...raw, id: "audit_synthetic_002" }),
    );
    expect(first).toMatchObject({
      action: "unsupported_event",
      resource: { type: "unsupported_event" },
      safeSummaryCode: "unsupported_event",
    });
    expect(JSON.stringify(first)).not.toContain("protected value");
    expect(first.actor.id).not.toBe(second.actor.id);
    expect(first.resource.id).not.toBe(second.resource.id);
  });

  it("rejects nested unknown metadata and polluted or substituted projections", () => {
    const raw = auditRecord("privacy.export_requested");
    expect(() =>
      parseFirestoreAuditRecordV1({
        ...raw,
        metadata: { nested: { protectedValue: "must not be retained" } },
      }),
    ).toThrow(/strict v1 validation/i);

    const projected = projectClientSafeAuditEvent(parseFirestoreAuditRecordV1(raw));
    expect(() =>
      parseClientSafeAuditEventProjection({ ...projected, requestId: "must_not_appear" }),
    ).toThrow(/strict validation/i);
    expect(() =>
      parseClientSafeAuditEventProjection({
        ...projected,
        actor: { ...projected.actor, id: "event_actor:audit_substituted" },
      }),
    ).toThrow(/exactly one event/i);

    const known = projectClientSafeAuditEvent(
      parseFirestoreAuditRecordV1(auditRecord("care_pathway.activate")),
    );
    expect(() =>
      parseClientSafeAuditEventProjection({
        ...known,
        safeSummaryCode: "care_pathway_approved",
      }),
    ).toThrow(/do not match/i);
  });
});
