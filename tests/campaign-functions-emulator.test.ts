import { describe, expect, it, vi } from "vitest";
import {
  buildCampaignFunctionsRequest,
  CampaignFunctionsClientError,
  controlSyntheticCampaignThroughLocalFunctions,
  evaluateCampaignFunctionsPolicy,
  LOCAL_CAMPAIGN_FUNCTIONS_ENDPOINT,
  mapCampaignFunctionsCallableError,
  type CampaignFunctionsRequest,
} from "@/lib/firebase/campaign-functions-emulator";

const actorUid = "user_demo_campaign_operator";
const identity = {
  workspaceId: "workspace_safenet_demo",
  campaignId: "campaign_synthetic_50k",
  actorUid,
  action: "run_canary" as const,
  expectedRevision: 0,
};

const endpointPolicy = {
  hostname: "127.0.0.1",
  projectId: "demo-hemas-connect",
  appStage: "demo",
  useFirebaseEmulators: "true",
  externalMessagingEnabled: "false",
  realPatientDataEnabled: "false",
  functionsHostname: LOCAL_CAMPAIGN_FUNCTIONS_ENDPOINT.hostname,
  functionsPort: LOCAL_CAMPAIGN_FUNCTIONS_ENDPOINT.port,
  functionsRegion: LOCAL_CAMPAIGN_FUNCTIONS_ENDPOINT.region,
  callableName: LOCAL_CAMPAIGN_FUNCTIONS_ENDPOINT.callableName,
};

function responseFor(request: CampaignFunctionsRequest, replayed = false) {
  const byAction = {
    run_canary: {
      state: "scheduled",
      canaryStatus: "passed_simulation",
      checkpointId: null,
      batchEligibleCount: 25,
    },
    start: {
      state: "dispatching",
      canaryStatus: "passed_simulation",
      checkpointId: null,
      batchEligibleCount: 0,
    },
    advance_batch: {
      state: "dispatching",
      canaryStatus: "passed_simulation",
      checkpointId: `${request.campaignId}:checkpoint:000000`,
      batchEligibleCount: 1_000,
    },
    pause: {
      state: "paused",
      canaryStatus: "passed_simulation",
      checkpointId: null,
      batchEligibleCount: 0,
    },
    resume: {
      state: "dispatching",
      canaryStatus: "passed_simulation",
      checkpointId: null,
      batchEligibleCount: 0,
    },
    inject_fault: {
      state: "failed",
      canaryStatus: "failed",
      checkpointId: null,
      batchEligibleCount: 0,
    },
    retry: {
      state: "dispatching",
      canaryStatus: "passed_simulation",
      checkpointId: null,
      batchEligibleCount: 0,
    },
    cancel: {
      state: "cancelled",
      canaryStatus: "passed_simulation",
      checkpointId: null,
      batchEligibleCount: 0,
    },
  } as const;
  return {
    result: {
      campaignId: request.campaignId,
      eventId: "campaign-event-0123456789abcdef01234567",
      action: request.action,
      revision: request.expectedRevision + 1,
      processedEligible: request.action === "advance_batch" ? 1_000 : 0,
      scanOffset: request.action === "advance_batch" ? 1_310 : 0,
      nextBatchIndex: request.action === "advance_batch" ? 1 : 0,
      synthetic: true,
      externalCalls: 0,
      networkCalls: 0,
      ...byAction[request.action],
    },
    auditEventId: "audit-0123456789abcdef01234567",
    replayed,
  };
}

describe("local campaign Functions endpoint policy", () => {
  it("allows only the exact emulator callable", () => {
    expect(evaluateCampaignFunctionsPolicy(endpointPolicy)).toEqual({ allowed: true });
    expect(LOCAL_CAMPAIGN_FUNCTIONS_ENDPOINT).toEqual({
      hostname: "127.0.0.1",
      port: 5001,
      region: "us-central1",
      callableName: "demoControlSyntheticCampaign",
    });
  });

  it.each([
    [{ ...endpointPolicy, functionsHostname: "localhost" }, "unexpected_functions_host"],
    [{ ...endpointPolicy, functionsPort: 443 }, "unexpected_functions_port"],
    [{ ...endpointPolicy, functionsRegion: "asia-south1" }, "unexpected_functions_region"],
    [{ ...endpointPolicy, callableName: "sendCampaign" }, "unexpected_callable"],
    [{ ...endpointPolicy, hostname: "demo.example.test" }, "non_loopback_host"],
    [{ ...endpointPolicy, projectId: "hemas-production" }, "non_demo_project"],
    [{ ...endpointPolicy, externalMessagingEnabled: "true" }, "external_messaging_enabled"],
    [{ ...endpointPolicy, realPatientDataEnabled: "true" }, "real_patient_data_enabled"],
  ] as const)("rejects endpoint or environment substitution %#", (input, reason) => {
    expect(evaluateCampaignFunctionsPolicy(input)).toEqual({ allowed: false, reason });
  });
});

describe("audited campaign callable client contract", () => {
  it("builds one deterministic request identity without sending actor fields", async () => {
    const first = await buildCampaignFunctionsRequest(identity);
    const replay = await buildCampaignFunctionsRequest(identity);
    expect(first).toEqual(replay);
    expect(first).toEqual({
      workspaceId: identity.workspaceId,
      campaignId: identity.campaignId,
      action: identity.action,
      expectedRevision: 0,
      idempotencyKey: expect.stringMatching(/^campaign-ui-[a-f0-9]{48}$/),
    });
    expect(first).not.toHaveProperty("actorUid");

    const keys = await Promise.all(
      [
        { ...identity, workspaceId: "workspace_other" },
        { ...identity, campaignId: "campaign_other" },
        { ...identity, actorUid: "operator_other" },
        { ...identity, action: "cancel" as const },
        { ...identity, expectedRevision: 1 },
      ].map(async (value) => (await buildCampaignFunctionsRequest(value)).idempotencyKey),
    );
    expect(new Set([first.idempotencyKey, ...keys]).size).toBe(keys.length + 1);
  });

  it("rejects request pollution and forged idempotency before invocation", async () => {
    const request = await buildCampaignFunctionsRequest(identity);
    const invoke = vi.fn(async () => responseFor(request));
    await expect(
      controlSyntheticCampaignThroughLocalFunctions(
        { actorUid, request: { ...request, messageBody: "not accepted" } },
        invoke,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      controlSyntheticCampaignThroughLocalFunctions(
        { ...{ actorUid }, request: { ...request, idempotencyKey: "campaign-ui-forged000000000000000000000000000000000000" } },
        invoke,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    "run_canary",
    "start",
    "advance_batch",
    "pause",
    "resume",
    "inject_fault",
    "retry",
    "cancel",
  ] as const)("accepts exact %s response evidence with zero external counters", async (action) => {
    const request = await buildCampaignFunctionsRequest({
      ...identity,
      action,
      expectedRevision: action === "run_canary" ? 0 : 3,
    });
    const response = await controlSyntheticCampaignThroughLocalFunctions(
      { actorUid, request },
      async ({ request: invoked }) => responseFor(invoked),
    );
    expect(response.result.action).toBe(action);
    expect(response.result.externalCalls).toBe(0);
    expect(response.result.networkCalls).toBe(0);
    expect(response.auditEventId).toMatch(/^audit-/);
  });

  it("accepts exact replay and rejects polluted or mismatched result evidence", async () => {
    const request = await buildCampaignFunctionsRequest(identity);
    const replay = await controlSyntheticCampaignThroughLocalFunctions(
      { actorUid, request },
      async ({ request: invoked }) => responseFor(invoked, true),
    );
    expect(replay.replayed).toBe(true);

    const valid = responseFor(request);
    const result = valid.result;
    for (const invalid of [
      { ...valid, unexpected: true },
      { ...valid, auditEventId: null },
      { ...valid, result: { ...result, patientId: "not accepted" } },
      { ...valid, result: { ...result, campaignId: "campaign_other" } },
      { ...valid, result: { ...result, action: "cancel" } },
      { ...valid, result: { ...result, revision: 2 } },
      { ...valid, result: { ...result, eventId: null } },
      { ...valid, result: { ...result, checkpointId: "checkpoint-not-allowed" } },
      { ...valid, result: { ...result, batchEligibleCount: 0 } },
      { ...valid, result: { ...result, externalCalls: 1 } },
      { ...valid, result: { ...result, networkCalls: 1 } },
    ]) {
      await expect(
        controlSyntheticCampaignThroughLocalFunctions(
          { actorUid, request },
          async () => invalid,
        ),
      ).rejects.toMatchObject({ code: "invalid_response" });
    }
  });

  it.each(["start", "advance_batch", "pause", "resume", "retry"] as const)(
    "rejects %s when the callable contradicts the required passed canary evidence",
    async (action) => {
      const request = await buildCampaignFunctionsRequest({
        ...identity,
        action,
        expectedRevision: 3,
      });
      const response = responseFor(request);
      await expect(
        controlSyntheticCampaignThroughLocalFunctions(
          { actorUid, request },
          async () => ({
            ...response,
            result: { ...response.result, canaryStatus: "failed" },
          }),
        ),
      ).rejects.toMatchObject({ code: "invalid_response" });
    },
  );

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
  ] as const)("maps %s to sanitized %s", (sourceCode, expectedCode) => {
    const mapped = mapCampaignFunctionsCallableError({
      code: sourceCode,
      message: "provider or patient-sensitive detail",
    });
    expect(mapped).toBeInstanceOf(CampaignFunctionsClientError);
    expect(mapped.code).toBe(expectedCode);
    expect(mapped.message).not.toContain("patient-sensitive");
    expect(mapped.message).not.toContain("provider or");
  });
});
