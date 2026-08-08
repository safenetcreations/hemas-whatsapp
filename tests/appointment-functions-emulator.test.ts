import { describe, expect, it, vi } from "vitest";
import {
  AppointmentFunctionsClientError,
  buildAppointmentFunctionsRequest,
  evaluateAppointmentFunctionsPolicy,
  LOCAL_APPOINTMENT_FUNCTIONS_ENDPOINT,
  mapAppointmentFunctionsCallableError,
  requestSyntheticAppointmentThroughLocalFunctions,
  type AppointmentFunctionsRequest,
} from "@/lib/firebase/appointment-functions-emulator";

const actorUid = "synthetic-agent-001";
const identity = {
  workspaceId: "workspace_safenet_demo",
  appointmentId: "appointment_synthetic_001",
  teamId: "team_demo_general",
  locationId: "location_demo_wattala",
  actorUid,
  action: "request_reschedule" as const,
  expectedRevision: 0,
};

const endpointPolicy = {
  hostname: "127.0.0.1",
  projectId: "demo-hemas-connect",
  appStage: "demo",
  useFirebaseEmulators: "true",
  externalMessagingEnabled: "false",
  realPatientDataEnabled: "false",
  functionsHostname: LOCAL_APPOINTMENT_FUNCTIONS_ENDPOINT.hostname,
  functionsPort: LOCAL_APPOINTMENT_FUNCTIONS_ENDPOINT.port,
  functionsRegion: LOCAL_APPOINTMENT_FUNCTIONS_ENDPOINT.region,
  callableName: LOCAL_APPOINTMENT_FUNCTIONS_ENDPOINT.callableName,
};

function callableResponse(
  request: AppointmentFunctionsRequest,
  replayed = false,
): Record<string, unknown> {
  return {
    result: {
      appointmentId: request.appointmentId,
      eventId: "appointment-event-0123456789abcdef01234567",
      action: request.action,
      status:
        request.action === "request_reschedule"
          ? "reschedule_pending"
          : "cancel_pending",
      syncState: "pending",
      authoritativeSystem: "simulator",
      revision: request.expectedRevision + 1,
      synthetic: true,
      externalCalls: 0,
    },
    auditEventId: "audit-0123456789abcdef01234567",
    replayed,
  };
}

describe("local appointment Functions endpoint policy", () => {
  it("allows only the exact emulator-safe callable endpoint", () => {
    expect(evaluateAppointmentFunctionsPolicy(endpointPolicy)).toEqual({ allowed: true });
    expect(LOCAL_APPOINTMENT_FUNCTIONS_ENDPOINT).toEqual({
      hostname: "127.0.0.1",
      port: 5001,
      region: "us-central1",
      callableName: "demoRequestSyntheticAppointment",
    });
  });

  it.each([
    [{ ...endpointPolicy, functionsHostname: "localhost" }, "unexpected_functions_host"],
    [{ ...endpointPolicy, functionsHostname: "functions.example.test" }, "unexpected_functions_host"],
    [{ ...endpointPolicy, functionsPort: 443 }, "unexpected_functions_port"],
    [{ ...endpointPolicy, functionsRegion: "asia-south1" }, "unexpected_functions_region"],
    [{ ...endpointPolicy, callableName: "otherCallable" }, "unexpected_callable"],
    [{ ...endpointPolicy, hostname: "demo.example.test" }, "non_loopback_host"],
    [{ ...endpointPolicy, projectId: "hemas-production" }, "non_demo_project"],
    [{ ...endpointPolicy, externalMessagingEnabled: "true" }, "external_messaging_enabled"],
  ] as const)("rejects endpoint or environment substitution %#", (input, reason) => {
    expect(evaluateAppointmentFunctionsPolicy(input)).toEqual({ allowed: false, reason });
  });
});

describe("audited appointment callable client contract", () => {
  it("builds one exact deterministic request identity without sending actor fields", async () => {
    const first = await buildAppointmentFunctionsRequest(identity);
    const replay = await buildAppointmentFunctionsRequest(identity);
    expect(first).toEqual(replay);
    expect(first).toEqual({
      workspaceId: identity.workspaceId,
      appointmentId: identity.appointmentId,
      teamId: identity.teamId,
      locationId: identity.locationId,
      action: identity.action,
      expectedRevision: identity.expectedRevision,
      idempotencyKey: expect.stringMatching(/^appointment-ui-[a-f0-9]{48}$/),
    });
    expect(first).not.toHaveProperty("actorUid");

    const substitutions = [
      { ...identity, workspaceId: "workspace_other_demo" },
      { ...identity, appointmentId: "appointment_synthetic_002" },
      { ...identity, teamId: "team_demo_other" },
      { ...identity, locationId: "location_demo_other" },
      { ...identity, actorUid: "synthetic-agent-002" },
      { ...identity, action: "request_cancellation" as const },
      { ...identity, expectedRevision: 1 },
    ];
    const keys = await Promise.all(
      substitutions.map(async (value) =>
        (await buildAppointmentFunctionsRequest(value)).idempotencyKey,
      ),
    );
    expect(new Set([first.idempotencyKey, ...keys]).size).toBe(keys.length + 1);
  });

  it("rejects request pollution and a substituted idempotency identity before invocation", async () => {
    const request = await buildAppointmentFunctionsRequest(identity);
    const invoke = vi.fn(async () => callableResponse(request));

    await expect(
      requestSyntheticAppointmentThroughLocalFunctions(
        { actorUid, request: { ...request, patientPhone: "+94000000000" } },
        invoke,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      requestSyntheticAppointmentThroughLocalFunctions(
        { actorUid, request: { ...request, idempotencyKey: "appointment-ui-forged000000000000000000000000000000000000" } },
        invoke,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      buildAppointmentFunctionsRequest({ ...identity, messageBody: "not accepted" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("accepts a first result and an exact replay with externalCalls fixed at zero", async () => {
    const request = await buildAppointmentFunctionsRequest(identity);
    const first = await requestSyntheticAppointmentThroughLocalFunctions(
      { actorUid, request },
      async ({ request: invokedRequest }) => callableResponse(invokedRequest),
    );
    const replay = await requestSyntheticAppointmentThroughLocalFunctions(
      { actorUid, request },
      async ({ request: invokedRequest }) => callableResponse(invokedRequest, true),
    );
    expect(first.replayed).toBe(false);
    expect(replay).toEqual({ ...first, replayed: true });
    expect(replay.result.externalCalls).toBe(0);
  });

  it("rejects polluted or identity-mismatched callable output", async () => {
    const request = await buildAppointmentFunctionsRequest(identity);
    const valid = callableResponse(request);
    const validResult = valid.result as Record<string, unknown>;
    const invalidResponses = [
      { ...valid, unexpected: true },
      { ...valid, result: { ...validResult, patientName: "not accepted" } },
      { ...valid, result: { ...validResult, appointmentId: "appointment_other" } },
      { ...valid, result: { ...validResult, action: "request_cancellation" } },
      { ...valid, result: { ...validResult, revision: 2 } },
      { ...valid, result: { ...validResult, externalCalls: 1 } },
    ];

    for (const response of invalidResponses) {
      await expect(
        requestSyntheticAppointmentThroughLocalFunctions(
          { actorUid, request },
          async () => response,
        ),
      ).rejects.toMatchObject({ code: "invalid_response" });
    }
  });

  it.each([
    ["functions/aborted", "revision_conflict"],
    ["functions/already-exists", "idempotency_conflict"],
    ["functions/unauthenticated", "authentication_required"],
    ["functions/permission-denied", "permission_denied"],
    ["functions/failed-precondition", "service_denied"],
    ["functions/invalid-argument", "invalid_request"],
    ["functions/unavailable", "emulator_unavailable"],
    ["functions/deadline-exceeded", "emulator_unavailable"],
    ["functions/internal", "invocation_failed"],
  ] as const)("maps %s to the safe %s client error", (sourceCode, expectedCode) => {
    const mapped = mapAppointmentFunctionsCallableError({
      code: sourceCode,
      message: "patient-sensitive provider detail",
    });
    expect(mapped).toBeInstanceOf(AppointmentFunctionsClientError);
    expect(mapped.code).toBe(expectedCode);
    expect(mapped.message).not.toContain("patient-sensitive");
    expect(mapped.message).not.toContain("provider detail");
  });

  it("maps an invoked revision conflict without trusting the callable message", async () => {
    const request = await buildAppointmentFunctionsRequest(identity);
    await expect(
      requestSyntheticAppointmentThroughLocalFunctions(
        { actorUid, request },
        async () => {
          throw { code: "functions/aborted", message: "sensitive raw detail" };
        },
      ),
    ).rejects.toMatchObject({
      code: "revision_conflict",
      message: "The simulator appointment changed before the audited transaction committed.",
    });
  });
});
