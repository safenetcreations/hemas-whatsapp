import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  automationControlResultFingerprint,
  buildAutomationFunctionsRequest,
  buildCareFunctionsRequest,
  careControlResultFingerprint,
  controlSyntheticAutomationThroughLocalFunctions,
  controlSyntheticCareThroughLocalFunctions,
  evaluatePhase5FunctionsPolicy,
  LOCAL_AUTOMATION_FUNCTIONS_ENDPOINT,
  LOCAL_CARE_FUNCTIONS_ENDPOINT,
  mapPhase5CallableError,
  Phase5FunctionsClientError,
  serializeAutomationControlResult,
  serializeCareControlResult,
  type AutomationFunctionsRequest,
  type CareFunctionsRequest,
} from "@/lib/firebase/automation-care-functions-emulator";

const actorUid = "user_demo_supervisor";
const automationIdentity = {
  workspaceId: "workspace_safenet_demo",
  runId: "automation_run_synthetic_appointment_001",
  actorUid,
  action: "start" as const,
  expectedRevision: 1,
};
const careIdentity = {
  workspaceId: "workspace_safenet_demo",
  enrollmentId: "care_enrollment_synthetic_001",
  actorUid: "user_demo_clinical_approver",
  action: "start" as const,
  expectedRevision: 1,
  suppressionReason: null,
};

const basePolicy = {
  hostname: "127.0.0.1",
  projectId: "demo-hemas-connect",
  appStage: "demo",
  useFirebaseEmulators: "true",
  externalMessagingEnabled: "false",
  realPatientDataEnabled: "false",
  functionsHostname: "127.0.0.1",
  functionsPort: 5001,
  functionsRegion: "us-central1",
  callableName: LOCAL_AUTOMATION_FUNCTIONS_ENDPOINT.callableName,
};

function automationResponse(request: AutomationFunctionsRequest, replayed = false) {
  return {
    result: {
      runId: request.runId,
      eventId: `automation_event_${request.expectedRevision + 1}`,
      action: request.action,
      state: "running" as const,
      revision: request.expectedRevision + 1,
      currentStepIndex: 0,
      completedStepCount: 0,
      attemptCount: 0,
      nextEligibleAt: null,
      openWorkItemId: null,
      outcomeCode: "accepted" as const,
      synthetic: true as const,
      externalDispatchCount: 0 as const,
      networkCallCount: 0 as const,
    },
    auditEventId: `audit_automation_event_${request.expectedRevision + 1}`,
    replayed,
  };
}

function careResponse(request: CareFunctionsRequest, replayed = false) {
  return {
    result: {
      enrollmentId: request.enrollmentId,
      eventId: `care_event_${request.expectedRevision + 1}`,
      action: request.action,
      state: "active" as const,
      revision: request.expectedRevision + 1,
      nextContactIndex: 0,
      nextContactAt: "2026-08-08T00:00:00.000Z",
      openEscalationId: null,
      safetyHoldEscalationId: null,
      openHandoffId: null,
      outcomeCode: "accepted" as const,
      synthetic: true as const,
      externalDispatchCount: 0 as const,
      networkCallCount: 0 as const,
    },
    auditEventId: `audit_care_event_${request.expectedRevision + 1}`,
    replayed,
  };
}

describe("Phase 5 localhost endpoint policy", () => {
  it("pins both callables to 127.0.0.1:5001/us-central1", () => {
    expect(evaluatePhase5FunctionsPolicy(basePolicy)).toEqual({ allowed: true });
    expect(
      evaluatePhase5FunctionsPolicy({
        ...basePolicy,
        callableName: LOCAL_CARE_FUNCTIONS_ENDPOINT.callableName,
      }),
    ).toEqual({ allowed: true });
    expect(LOCAL_AUTOMATION_FUNCTIONS_ENDPOINT).toEqual({
      hostname: "127.0.0.1",
      port: 5001,
      region: "us-central1",
      callableName: "demoControlSyntheticAutomationRun",
    });
    expect(LOCAL_CARE_FUNCTIONS_ENDPOINT.callableName).toBe(
      "demoControlSyntheticCareEnrollment",
    );
  });

  it.each([
    [{ ...basePolicy, functionsHostname: "localhost" }, "unexpected_functions_host"],
    [{ ...basePolicy, functionsPort: 443 }, "unexpected_functions_port"],
    [{ ...basePolicy, functionsRegion: "asia-south1" }, "unexpected_functions_region"],
    [{ ...basePolicy, callableName: "sendWhatsApp" }, "unexpected_callable"],
    [{ ...basePolicy, hostname: "portal.example.test" }, "non_loopback_host"],
    [{ ...basePolicy, projectId: "hemas-production" }, "non_demo_project"],
    [{ ...basePolicy, useFirebaseEmulators: "false" }, "emulators_disabled"],
    [{ ...basePolicy, externalMessagingEnabled: "true" }, "external_messaging_enabled"],
    [{ ...basePolicy, realPatientDataEnabled: "true" }, "real_patient_data_enabled"],
  ] as const)("rejects substituted endpoint or unsafe environment %#", (input, reason) => {
    expect(evaluatePhase5FunctionsPolicy(input)).toEqual({ allowed: false, reason });
  });
});

describe("Phase 5 deterministic callable contracts", () => {
  it("builds deterministic automation identity without actor or patient fields", async () => {
    const first = await buildAutomationFunctionsRequest(automationIdentity);
    expect(await buildAutomationFunctionsRequest(automationIdentity)).toEqual(first);
    expect(first).toEqual({
      workspaceId: automationIdentity.workspaceId,
      runId: automationIdentity.runId,
      action: "start",
      expectedRevision: 1,
      idempotencyKey: expect.stringMatching(/^phase5-automation-ui-[a-f0-9]{44}$/),
    });
    expect(first).not.toHaveProperty("actorUid");
    const substitutions = await Promise.all(
      [
        { ...automationIdentity, workspaceId: "workspace_other_demo" },
        { ...automationIdentity, runId: "automation_run_other" },
        { ...automationIdentity, actorUid: "user_demo_other" },
        { ...automationIdentity, action: "pause" as const },
        { ...automationIdentity, expectedRevision: 2 },
      ].map(async (identity) =>
        (await buildAutomationFunctionsRequest(identity)).idempotencyKey,
      ),
    );
    expect(new Set([first.idempotencyKey, ...substitutions]).size).toBe(6);
  });

  it("binds care suppression into deterministic identity and sends it only for suppression", async () => {
    const first = await buildCareFunctionsRequest(careIdentity);
    const suppression = await buildCareFunctionsRequest({
      ...careIdentity,
      action: "simulate_suppression",
      suppressionReason: "clinical_hold",
    });
    const withdrawal = await buildCareFunctionsRequest({
      ...careIdentity,
      action: "simulate_suppression",
      suppressionReason: "withdrawal",
    });
    expect(first).not.toHaveProperty("actorUid");
    expect(first.idempotencyKey).toMatch(/^phase5-care-ui-[a-f0-9]{44}$/);
    expect(new Set([first.idempotencyKey, suppression.idempotencyKey, withdrawal.idempotencyKey]).size).toBe(3);
    await expect(
      buildCareFunctionsRequest({
        ...careIdentity,
        action: "simulate_suppression",
        suppressionReason: null,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      buildCareFunctionsRequest({ ...careIdentity, suppressionReason: "clinical_hold" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("rejects request pollution and forged deterministic keys before invocation", async () => {
    const automationRequest = await buildAutomationFunctionsRequest(automationIdentity);
    const careRequest = await buildCareFunctionsRequest(careIdentity);
    const automationInvoke = vi.fn(async () => automationResponse(automationRequest));
    const careInvoke = vi.fn(async () => careResponse(careRequest));
    await expect(
      controlSyntheticAutomationThroughLocalFunctions(
        { actorUid, request: { ...automationRequest, patientId: "forbidden" } },
        automationInvoke,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      controlSyntheticAutomationThroughLocalFunctions(
        { actorUid, request: { ...automationRequest, idempotencyKey: "phase5-automation-ui-forged00000000000000000000000000000000000000" } },
        automationInvoke,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      controlSyntheticCareThroughLocalFunctions(
        { actorUid: careIdentity.actorUid, request: { ...careRequest, clinicalText: "forbidden" } },
        careInvoke,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(automationInvoke).not.toHaveBeenCalled();
    expect(careInvoke).not.toHaveBeenCalled();
  });

  it("accepts exact first results and exact replays with both safety counters zero", async () => {
    const automationRequest = await buildAutomationFunctionsRequest(automationIdentity);
    const careRequest = await buildCareFunctionsRequest(careIdentity);
    const automation = await controlSyntheticAutomationThroughLocalFunctions(
      { actorUid, request: automationRequest },
      async ({ request }) => automationResponse(request),
    );
    const automationReplay = await controlSyntheticAutomationThroughLocalFunctions(
      { actorUid, request: automationRequest },
      async ({ request }) => automationResponse(request, true),
    );
    const care = await controlSyntheticCareThroughLocalFunctions(
      { actorUid: careIdentity.actorUid, request: careRequest },
      async ({ request }) => careResponse(request),
    );
    expect(automation.replayed).toBe(false);
    expect(automationReplay).toEqual({ ...automation, replayed: true });
    expect(care.result.externalDispatchCount).toBe(0);
    expect(care.result.networkCallCount).toBe(0);
  });

  it("accepts service-valid waiting+accepted and failed+accepted result envelopes", async () => {
    const waitingRequest = await buildAutomationFunctionsRequest({
      ...automationIdentity,
      action: "resume",
      expectedRevision: 7,
    });
    const waiting = automationResponse(waitingRequest);
    const acceptedWaiting = await controlSyntheticAutomationThroughLocalFunctions(
      { actorUid, request: waitingRequest },
      async () => ({
        ...waiting,
        result: {
          ...waiting.result,
          state: "waiting",
          nextEligibleAt: "2026-08-08T01:00:00.000Z",
        },
      }),
    );
    const acceptedFailed = await controlSyntheticAutomationThroughLocalFunctions(
      { actorUid, request: waitingRequest },
      async () => ({
        ...waiting,
        result: { ...waiting.result, state: "failed", nextEligibleAt: null },
      }),
    );
    expect(acceptedWaiting.result.outcomeCode).toBe("accepted");
    expect(acceptedFailed.result.outcomeCode).toBe("accepted");
  });

  it("rejects polluted, mismatched, noncanonical, and nonzero automation responses", async () => {
    const request = await buildAutomationFunctionsRequest(automationIdentity);
    const valid = automationResponse(request);
    for (const invalid of [
      { ...valid, unexpected: true },
      { ...valid, result: { ...valid.result, patientPhone: "+94000000000" } },
      { ...valid, result: { ...valid.result, runId: "automation_run_other" } },
      { ...valid, result: { ...valid.result, action: "pause" } },
      { ...valid, result: { ...valid.result, revision: 99 } },
      { ...valid, result: { ...valid.result, nextEligibleAt: "not-a-date" } },
      { ...valid, result: { ...valid.result, externalDispatchCount: 1 } },
      { ...valid, result: { ...valid.result, networkCallCount: 1 } },
    ]) {
      await expect(
        controlSyntheticAutomationThroughLocalFunctions(
          { actorUid, request },
          async () => invalid,
        ),
      ).rejects.toMatchObject({ code: "invalid_response" });
    }
  });

  it("rejects polluted, mismatched, noncanonical, and nonzero care responses", async () => {
    const request = await buildCareFunctionsRequest(careIdentity);
    const valid = careResponse(request);
    for (const invalid of [
      { ...valid, unexpected: true },
      { ...valid, result: { ...valid.result, patientName: "forbidden" } },
      { ...valid, result: { ...valid.result, enrollmentId: "care_other" } },
      { ...valid, result: { ...valid.result, action: "pause" } },
      { ...valid, result: { ...valid.result, revision: 99 } },
      { ...valid, result: { ...valid.result, nextContactAt: "tomorrow" } },
      { ...valid, result: { ...valid.result, externalDispatchCount: 1 } },
      { ...valid, result: { ...valid.result, networkCallCount: 1 } },
    ]) {
      await expect(
        controlSyntheticCareThroughLocalFunctions(
          { actorUid: careIdentity.actorUid, request },
          async () => invalid,
        ),
      ).rejects.toMatchObject({ code: "invalid_response" });
    }
  });

  it("serializes and fingerprints complete response evidence with canonical prefixes", async () => {
    const automationRequest = await buildAutomationFunctionsRequest(automationIdentity);
    const careRequest = await buildCareFunctionsRequest(careIdentity);
    const automationResult = automationResponse(automationRequest).result;
    const careResult = careResponse(careRequest).result;
    const automationSerialized = serializeAutomationControlResult(automationResult);
    const careSerialized = serializeCareControlResult(careResult);
    expect(JSON.parse(automationSerialized)).toHaveLength(15);
    expect(JSON.parse(careSerialized)).toHaveLength(15);
    expect(JSON.parse(automationSerialized)[0]).toBe(
      "hemas-connect:automation-control-result:v1",
    );
    expect(JSON.parse(careSerialized)[0]).toBe("hemas-connect:care-control-result:v1");
    expect(await automationControlResultFingerprint(automationResult)).toBe(
      createHash("sha256").update(automationSerialized).digest("hex"),
    );
    expect(await careControlResultFingerprint(careResult)).toBe(
      createHash("sha256").update(careSerialized).digest("hex"),
    );
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
  ] as const)("maps %s to safe %s without raw provider text", (sourceCode, expected) => {
    const mapped = mapPhase5CallableError({
      code: sourceCode,
      message: "patient-sensitive provider detail",
    });
    expect(mapped).toBeInstanceOf(Phase5FunctionsClientError);
    expect(mapped.code).toBe(expected);
    expect(mapped.message).not.toContain("patient-sensitive");
    expect(mapped.message).not.toContain("provider detail");
  });
});
