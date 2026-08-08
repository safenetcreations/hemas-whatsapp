import { describe, expect, it, vi } from "vitest";

import {
  COMPLIANCE_AUDIT_PAGE_SIZE,
  ComplianceAuditFunctionsClientError,
  evaluateComplianceAuditFunctionsPolicy,
  listComplianceAuditEventsThroughLocalFunctions,
  LOCAL_COMPLIANCE_AUDIT_FUNCTIONS_ENDPOINT,
  mapComplianceAuditCallableError,
  parseComplianceAuditFunctionsRequest,
  parseComplianceAuditFunctionsResponse,
  type ComplianceAuditEvent,
  type ComplianceAuditFunctionsRequest,
} from "@/lib/firebase/compliance-audit-functions-emulator";

const workspaceId = "workspace_safenet_demo";
const actorUid = "user_demo_admin";

function request(
  overrides: Partial<ComplianceAuditFunctionsRequest> = {},
): ComplianceAuditFunctionsRequest {
  return {
    workspaceId,
    outcome: null,
    pageSize: COMPLIANCE_AUDIT_PAGE_SIZE,
    cursor: null,
    ...overrides,
  };
}

function event(
  overrides: Partial<ComplianceAuditEvent> = {},
): ComplianceAuditEvent {
  const id = overrides.id ?? "audit_synthetic_001";
  return {
    id,
    workspaceId,
    occurredAt: "2026-08-08T07:00:00.000Z",
    actor: { type: "user", id: `event_actor:${id}` },
    action: "automation.start",
    resource: { type: "automation_run", id: `event_resource:${id}` },
    outcome: "allowed",
    safeSummaryCode: "automation_started",
    synthetic: true,
    schemaVersion: 1,
    ...overrides,
  };
}

function expectClientError(
  run: () => unknown,
  code: ComplianceAuditFunctionsClientError["code"],
) {
  expect(run).toThrowError(
    expect.objectContaining({
      name: "ComplianceAuditFunctionsClientError",
      code,
    }),
  );
}

describe("local Compliance callable endpoint policy", () => {
  const safePolicy = {
    hostname: "localhost",
    projectId: "demo-hemas-connect",
    appStage: "demo",
    useFirebaseEmulators: "true",
    externalMessagingEnabled: "false",
    realPatientDataEnabled: "false",
    functionsHostname: "127.0.0.1",
    functionsPort: 5001,
    functionsRegion: "us-central1",
    callableName: "listComplianceAuditEvents",
  } as const;

  it("pins the one approved callable endpoint", () => {
    expect(LOCAL_COMPLIANCE_AUDIT_FUNCTIONS_ENDPOINT).toEqual({
      hostname: "127.0.0.1",
      port: 5001,
      region: "us-central1",
      callableName: "listComplianceAuditEvents",
    });
    expect(evaluateComplianceAuditFunctionsPolicy(safePolicy)).toEqual({
      allowed: true,
    });
  });

  it.each([
    ["hostname", "example.com", "non_loopback_host"],
    ["projectId", "production-project", "non_demo_project"],
    ["appStage", "production", "unsafe_stage"],
    ["useFirebaseEmulators", "false", "emulators_disabled"],
    ["externalMessagingEnabled", "true", "external_messaging_enabled"],
    ["realPatientDataEnabled", "true", "real_patient_data_enabled"],
    ["functionsHostname", "localhost", "unexpected_functions_host"],
    ["functionsPort", 443, "unexpected_functions_port"],
    ["functionsRegion", "asia-south1", "unexpected_functions_region"],
    ["callableName", "listAuditEvents", "unexpected_callable"],
  ] as const)("rejects unsafe %s", (field, value, reason) => {
    expect(
      evaluateComplianceAuditFunctionsPolicy({
        ...safePolicy,
        [field]: value,
      }),
    ).toEqual({ allowed: false, reason });
  });
});

describe("Compliance callable request contract", () => {
  it("accepts only the exact bounded request and canonical cursor", () => {
    const valid = request({
      outcome: "failed",
      pageSize: 50,
      cursor: {
        createdAt: "2026-08-08T07:00:00.000Z",
        id: "audit_synthetic_001",
      },
    });
    expect(parseComplianceAuditFunctionsRequest(valid)).toEqual(valid);
    expect(parseComplianceAuditFunctionsRequest(request({ pageSize: 1 }))).toEqual(
      request({ pageSize: 1 }),
    );
  });

  it.each([
    { ...request(), extra: true },
    request({ workspaceId: "unsafe/path" }),
    request({ outcome: "safety_hold" as never }),
    request({ pageSize: 0 }),
    request({ pageSize: 51 }),
    request({ pageSize: 1.5 }),
    request({
      cursor: { createdAt: "2026-08-08T07:00:00Z", id: "audit_1" },
    }),
    request({
      cursor: {
        createdAt: "2026-08-08T07:00:00.000Z",
        id: "unsafe/path",
      },
    }),
    request({
      cursor: {
        createdAt: "2026-08-08T07:00:00.000Z",
        id: "audit_1",
        extra: true,
      } as never,
    }),
  ])("rejects hostile request %#", (invalid) => {
    expectClientError(
      () => parseComplianceAuditFunctionsRequest(invalid),
      "invalid_request",
    );
  });
});

describe("Compliance callable response projection", () => {
  it("accepts an exact request-bound minimized response", () => {
    const projected = event();
    expect(
      parseComplianceAuditFunctionsResponse(
        { events: [projected], nextCursor: null },
        request(),
      ),
    ).toEqual({ events: [projected], nextCursor: null });
  });

  it("accepts only the fully minimized unsupported-event triple", () => {
    const projected = event({
      action: "unsupported_event",
      resource: {
        type: "unsupported_event",
        id: "event_resource:audit_synthetic_001",
      },
      safeSummaryCode: "unsupported_event",
    });
    expect(
      parseComplianceAuditFunctionsResponse(
        { events: [projected], nextCursor: null },
        request(),
      ).events,
    ).toEqual([projected]);
  });

  it.each([
    {
      action: "unsupported_event",
      resource: {
        type: "automation_run",
        id: "event_resource:audit_synthetic_001",
      },
      safeSummaryCode: "unsupported_event",
    },
    {
      action: "unsupported_event",
      resource: {
        type: "unsupported_event",
        id: "event_resource:audit_synthetic_001",
      },
      safeSummaryCode: "automation_started",
    },
    {
      action: "privacy.export_requested",
      resource: {
        type: "unsupported_event",
        id: "event_resource:audit_synthetic_001",
      },
      safeSummaryCode: "unsupported_event",
    },
  ])("rejects partially normalized unknown evidence %#", (overrides) => {
    expectClientError(
      () =>
        parseComplianceAuditFunctionsResponse(
          { events: [event(overrides as never)], nextCursor: null },
          request(),
        ),
      "invalid_response",
    );
  });

  it.each([
    { requestId: "raw_request" },
    { metadata: { teamId: "private_team" } },
    { teamId: "private_team" },
    { locationId: "private_location" },
    { eventId: "raw_event" },
    { checkpointId: "raw_checkpoint" },
    { resultFingerprint: "a".repeat(64) },
    { patientName: "private_patient" },
    { clinicalInstruction: "private_clinical_text" },
  ])("rejects forbidden projected event fields %#", (pollution) => {
    expectClientError(
      () =>
        parseComplianceAuditFunctionsResponse(
          { events: [{ ...event(), ...pollution }], nextCursor: null },
          request(),
        ),
      "invalid_response",
    );
  });

  it.each([
    { ...event(), workspaceId: "workspace_other" },
    { ...event(), occurredAt: "08 Aug 2026" },
    { ...event(), actor: { type: "user", id: "user_demo_admin" } },
    {
      ...event(),
      actor: {
        ...event().actor,
        extra: "raw_actor",
      },
    },
    {
      ...event(),
      resource: { type: "care_enrollment", id: event().resource.id },
    },
    {
      ...event(),
      resource: { ...event().resource, extra: "raw_resource" },
    },
    { ...event(), safeSummaryCode: "automation_paused" },
    { ...event(), synthetic: false },
    { ...event(), schemaVersion: 2 },
  ])("rejects substituted projection %#", (invalid) => {
    expectClientError(
      () =>
        parseComplianceAuditFunctionsResponse(
          { events: [invalid], nextCursor: null },
          request(),
        ),
      "invalid_response",
    );
  });

  it("binds the outcome filter and exact envelope", () => {
    expectClientError(
      () =>
        parseComplianceAuditFunctionsResponse(
          { events: [event()], nextCursor: null },
          request({ outcome: "denied" }),
        ),
      "invalid_response",
    );
    expectClientError(
      () =>
        parseComplianceAuditFunctionsResponse(
          { events: [event()], nextCursor: null, raw: true },
          request(),
        ),
      "invalid_response",
    );
  });

  it("enforces descending time and document-ID order without duplicates", () => {
    const first = event({
      id: "audit_002",
      actor: { type: "user", id: "event_actor:audit_002" },
      resource: {
        type: "automation_run",
        id: "event_resource:audit_002",
      },
    });
    const second = event({
      id: "audit_001",
      actor: { type: "user", id: "event_actor:audit_001" },
      resource: {
        type: "automation_run",
        id: "event_resource:audit_001",
      },
    });
    const pageRequest = request({ pageSize: 2 });
    expect(
      parseComplianceAuditFunctionsResponse(
        {
          events: [first, second],
          nextCursor: { createdAt: second.occurredAt, id: second.id },
        },
        pageRequest,
      ).events,
    ).toEqual([first, second]);
    for (const events of [[second, first], [first, first]]) {
      expectClientError(
        () =>
          parseComplianceAuditFunctionsResponse(
            {
              events,
              nextCursor: {
                createdAt: events[1].occurredAt,
                id: events[1].id,
              },
            },
            pageRequest,
          ),
        "invalid_response",
      );
    }
  });

  it("requires exact page-bound cursor semantics", () => {
    const projected = event();
    expectClientError(
      () =>
        parseComplianceAuditFunctionsResponse(
          {
            events: [projected],
            nextCursor: {
              createdAt: projected.occurredAt,
              id: projected.id,
            },
          },
          request(),
        ),
      "invalid_response",
    );
    expectClientError(
      () =>
        parseComplianceAuditFunctionsResponse(
          { events: [projected], nextCursor: null },
          request({ pageSize: 1 }),
        ),
      "invalid_response",
    );
    expectClientError(
      () =>
        parseComplianceAuditFunctionsResponse(
          {
            events: [projected],
            nextCursor: {
              createdAt: projected.occurredAt,
              id: "audit_substituted",
            },
          },
          request({ pageSize: 1 }),
        ),
      "invalid_response",
    );
  });

  it("requires a next page to progress strictly after the request cursor", () => {
    const cursor = {
      createdAt: "2026-08-08T07:00:00.000Z",
      id: "audit_synthetic_001",
    } as const;
    expectClientError(
      () =>
        parseComplianceAuditFunctionsResponse(
          { events: [event()], nextCursor: null },
          request({ cursor }),
        ),
      "invalid_response",
    );
    const older = event({
      id: "audit_synthetic_000",
      occurredAt: "2026-08-08T06:59:59.000Z",
      actor: { type: "user", id: "event_actor:audit_synthetic_000" },
      resource: {
        type: "automation_run",
        id: "event_resource:audit_synthetic_000",
      },
    });
    expect(
      parseComplianceAuditFunctionsResponse(
        { events: [older], nextCursor: null },
        request({ cursor }),
      ).events,
    ).toEqual([older]);
  });
});

describe("Compliance callable invocation and sanitized errors", () => {
  it("passes only the verified actor and exact request to the injectable invoker", async () => {
    const projected = event();
    const invoke = vi.fn(async () => ({ events: [projected], nextCursor: null }));
    await expect(
      listComplianceAuditEventsThroughLocalFunctions(
        { actorUid, request: request() },
        invoke,
      ),
    ).resolves.toEqual({ events: [projected], nextCursor: null });
    expect(invoke).toHaveBeenCalledWith({ actorUid, request: request() });
  });

  it("rejects an invalid actor before invocation", async () => {
    const invoke = vi.fn();
    await expect(
      listComplianceAuditEventsThroughLocalFunctions(
        { actorUid: "unsafe/user", request: request() },
        invoke,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    ["functions/unauthenticated", "authentication_required"],
    ["functions/permission-denied", "permission_denied"],
    ["functions/invalid-argument", "invalid_request"],
    ["functions/failed-precondition", "service_unavailable"],
    ["functions/unavailable", "emulator_unavailable"],
    ["functions/deadline-exceeded", "emulator_unavailable"],
    ["functions/internal", "invocation_failed"],
  ] as const)("maps %s without exposing server text", (source, code) => {
    const mapped = mapComplianceAuditCallableError({
      code: source,
      message: "private server metadata and patient text",
    });
    expect(mapped).toMatchObject({ code, sourceCode: source.slice(10) });
    expect(mapped.message).not.toContain("private server metadata");
    expect(mapped.message).not.toContain("patient text");
  });
});
