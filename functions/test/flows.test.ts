import assert from "node:assert/strict";
import test from "node:test";

import {
  DEMO_FLOW_TOKEN_PREFIX,
  InMemoryFlowReplayGuard,
  SYNTHETIC_FLOW_ACTION_SCHEMA,
  SYNTHETIC_FLOW_DEFINITIONS,
  getSyntheticFlowDefinition,
  issueDemoFlowSessionToken,
  processSyntheticFlowAction,
  rejectLiveMetaFlowEndpoint,
  verifyDemoFlowSessionToken,
  type IssueDemoFlowSessionTokenInput,
  type SyntheticFlowActionRequest,
  type SyntheticFlowExecutionContext,
} from "../src/flows/index.js";

const SYNTHETIC_KEY = "synthetic-test-key-0123456789abcdef-ONLY-NOT-A-SECRET";
const NOW = new Date("2026-08-07T12:00:00.000Z");

const tokenInput: IssueDemoFlowSessionTokenInput = {
  runtimeMode: "demo",
  tenantId: "safenet-demo",
  purpose: "appointment_request",
  definitionId: "synthetic-flow-appointment-request",
  sessionId: "synthetic-session-appointment-0001",
  correlationId: "synthetic-correlation-appointment-0001",
  issuedAt: NOW,
  expiresInSeconds: 300,
  syntheticSigningKey: SYNTHETIC_KEY,
};

function issueToken(overrides: Partial<IssueDemoFlowSessionTokenInput> = {}): string {
  return issueDemoFlowSessionToken({ ...tokenInput, ...overrides });
}

function actionRequest(
  token: string,
  overrides: Partial<SyntheticFlowActionRequest> = {},
): SyntheticFlowActionRequest {
  return {
    schema: SYNTHETIC_FLOW_ACTION_SCHEMA,
    version: 1,
    mode: "demo",
    source: "internal_synthetic_test",
    tenantId: "safenet-demo",
    purpose: "appointment_request",
    definitionId: "synthetic-flow-appointment-request",
    sessionId: "synthetic-session-appointment-0001",
    correlationId: "synthetic-correlation-appointment-0001",
    screen: "REVIEW",
    action: "submit_pending",
    idempotencyKey: "synthetic-idempotency-appointment-0001",
    token,
    ...overrides,
  };
}

function executionContext(
  replayGuard = new InMemoryFlowReplayGuard(),
  overrides: Partial<SyntheticFlowExecutionContext> = {},
): SyntheticFlowExecutionContext {
  return {
    runtimeMode: "demo",
    transport: "internal_synthetic",
    expectedTenantId: "safenet-demo",
    syntheticSigningKey: SYNTHETIC_KEY,
    replayGuard,
    now: NOW,
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

test("models static and endpoint-powered definitions without provider capability", () => {
  assert.equal(SYNTHETIC_FLOW_DEFINITIONS.length, 7);
  const staticDefinition = getSyntheticFlowDefinition("synthetic-flow-service-information");
  const endpointDefinition = getSyntheticFlowDefinition("synthetic-flow-appointment-request");
  assert.equal(staticDefinition.dataMode, "static");
  assert.equal(endpointDefinition.dataMode, "endpoint_powered");
  assert.deepEqual(
    SYNTHETIC_FLOW_DEFINITIONS
      .filter((definition) => definition.dataMode === "endpoint_powered")
      .map((definition) => definition.purpose),
    [
      "appointment_request",
      "appointment_change_request",
      "laboratory_collection_request",
      "package_enquiry",
      "feedback",
      "communication_preferences",
    ],
  );
  for (const definition of SYNTHETIC_FLOW_DEFINITIONS) {
    assert.equal(Object.isFrozen(definition), true);
    assert.equal(Object.isFrozen(definition.screens), true);
    assert.equal(definition.mode, "demo");
    assert.equal(definition.acceptsProviderPayloads, false);
    assert.equal(definition.performsNetworkCalls, false);
    assert.equal(definition.confirmsHemasTransaction, false);
    assert.equal(definition.persistsSubmittedValues, false);
    assert.equal(definition.clinicalDecisioningAllowed, false);
    assert.equal(definition.marketingDefaultsSelected, false);
    assert.ok(definition.screens.some((screen) => screen.id === definition.initialScreen));
    assert.equal(
      new Set(definition.screens.map((screen) => screen.id)).size,
      definition.screens.length,
    );
    for (const screen of definition.screens) {
      assert.equal(Object.isFrozen(screen), true);
      assert.equal(Object.isFrozen(screen.fields), true);
      assert.equal(Object.isFrozen(screen.allowedActions), true);
    }
    if (definition.dataMode === "endpoint_powered") {
      assert.deepEqual(
        definition.screens.find((screen) => screen.id === "REVIEW")?.allowedActions,
        ["submit_pending"],
      );
      assert.equal(
        definition.screens.find((screen) => screen.id === "PENDING_CONFIRMATION")?.terminal,
        true,
      );
    }
  }
});

test("all six endpoint journeys stop at synthetic pending confirmation", () => {
  const endpoints = SYNTHETIC_FLOW_DEFINITIONS.filter(
    (definition) => definition.dataMode === "endpoint_powered",
  );
  assert.equal(endpoints.length, 6);

  endpoints.forEach((definition, index) => {
    const suffix = `catalogue-${String(index + 1).padStart(2, "0")}`;
    const sessionId = `synthetic-session-${suffix}`;
    const correlationId = `synthetic-correlation-${suffix}`;
    const token = issueToken({
      purpose: definition.purpose,
      definitionId: definition.id,
      sessionId,
      correlationId,
    });
    const response = processSyntheticFlowAction(
      actionRequest(token, {
        purpose: definition.purpose,
        definitionId: definition.id,
        sessionId,
        correlationId,
        idempotencyKey: `synthetic-idempotency-${suffix}`,
      }),
      executionContext(),
    );
    assert.equal(response.purpose, definition.purpose);
    assert.equal(response.status, "pending_confirmation");
    assert.equal(response.transactionConfirmed, false);
    assert.equal(response.providerWritePerformed, false);
    assert.equal(response.networkCalls, 0);
  });
});

test("issues deterministic expiring tokens bound to tenant, purpose, session and correlation", () => {
  const first = issueToken();
  const second = issueToken();
  assert.equal(first, second);
  assert.ok(first.startsWith(`${DEMO_FLOW_TOKEN_PREFIX}.`));

  const claims = verifyDemoFlowSessionToken({
    token: first,
    syntheticSigningKey: SYNTHETIC_KEY,
    expectedTenantId: tokenInput.tenantId,
    expectedPurpose: tokenInput.purpose,
    expectedDefinitionId: tokenInput.definitionId,
    expectedSessionId: tokenInput.sessionId,
    expectedCorrelationId: tokenInput.correlationId,
    now: NOW,
  });
  assert.equal(claims.expiresAt - claims.issuedAt, 300);
  assert.equal(claims.mode, "demo");
});

test("requires a caller-provided synthetic key of at least 32 bytes", () => {
  assert.throws(
    () => issueToken({ syntheticSigningKey: "too-short" }),
    hasCode("synthetic_signing_key_too_short"),
  );
  assert.throws(
    () => verifyDemoFlowSessionToken({
      token: issueToken(),
      syntheticSigningKey: new Uint8Array(31),
      expectedTenantId: "safenet-demo",
      now: NOW,
    }),
    hasCode("synthetic_signing_key_too_short"),
  );
});

test("rejects payload and signature tampering before trusting claims", () => {
  const token = issueToken();
  const [prefix, payload, signature] = token.split(".");
  assert.ok(prefix && payload && signature);
  const tamperedPayload = `${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}`;
  const tamperedSignature = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;

  for (const tampered of [
    `${prefix}.${tamperedPayload}.${signature}`,
    `${prefix}.${payload}.${tamperedSignature}`,
  ]) {
    assert.throws(
      () => verifyDemoFlowSessionToken({
        token: tampered,
        syntheticSigningKey: SYNTHETIC_KEY,
        expectedTenantId: "safenet-demo",
        now: NOW,
      }),
      hasCode("invalid_flow_token_signature"),
    );
  }
});

test("denies expiry and cross-tenant token use", () => {
  const token = issueToken();
  assert.throws(
    () => verifyDemoFlowSessionToken({
      token,
      syntheticSigningKey: SYNTHETIC_KEY,
      expectedTenantId: "safenet-demo",
      now: new Date("2026-08-07T12:05:00.000Z"),
    }),
    hasCode("flow_token_expired"),
  );
  assert.throws(
    () => verifyDemoFlowSessionToken({
      token,
      syntheticSigningKey: SYNTHETIC_KEY,
      expectedTenantId: "other-demo",
      now: NOW,
    }),
    hasCode("tenant_mismatch"),
  );
});

test("denies purpose, definition, session and correlation substitution", () => {
  const token = issueToken();
  const base = {
    token,
    syntheticSigningKey: SYNTHETIC_KEY,
    expectedTenantId: "safenet-demo",
    now: NOW,
  };
  assert.throws(
    () => verifyDemoFlowSessionToken({ ...base, expectedPurpose: "service_information" }),
    hasCode("flow_purpose_mismatch"),
  );
  assert.throws(
    () => verifyDemoFlowSessionToken({
      ...base,
      expectedDefinitionId: "synthetic-flow-service-information",
    }),
    hasCode("flow_definition_mismatch"),
  );
  assert.throws(
    () => verifyDemoFlowSessionToken({
      ...base,
      expectedSessionId: "synthetic-session-appointment-9999",
    }),
    hasCode("flow_session_mismatch"),
  );
  assert.throws(
    () => verifyDemoFlowSessionToken({
      ...base,
      expectedCorrelationId: "synthetic-correlation-appointment-9999",
    }),
    hasCode("flow_correlation_mismatch"),
  );
});

test("returns pending-confirmation metadata only and performs no external work", () => {
  const response = processSyntheticFlowAction(
    actionRequest(issueToken()),
    executionContext(),
  );
  assert.equal(response.status, "pending_confirmation");
  assert.equal(response.nextScreen, "PENDING_CONFIRMATION");
  assert.equal(response.transactionConfirmed, false);
  assert.equal(response.hemasWritePerformed, false);
  assert.equal(response.providerWritePerformed, false);
  assert.equal(response.persisted, false);
  assert.equal(response.networkCalls, 0);
  assert.equal(response.replayed, false);
  assert.equal(response.synthetic, true);
});

test("replays an identical idempotent request from memory without re-execution", () => {
  const replayGuard = new InMemoryFlowReplayGuard();
  const request = actionRequest(issueToken());
  const context = executionContext(replayGuard);
  const first = processSyntheticFlowAction(request, context);
  const second = processSyntheticFlowAction(request, context);
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(second.responseId, first.responseId);
  assert.equal(replayGuard.size, 1);
});

test("rejects a second idempotency key for an already consumed session action", () => {
  const replayGuard = new InMemoryFlowReplayGuard();
  const token = issueToken();
  processSyntheticFlowAction(actionRequest(token), executionContext(replayGuard));
  assert.throws(
    () => processSyntheticFlowAction(
      actionRequest(token, { idempotencyKey: "synthetic-idempotency-appointment-0002" }),
      executionContext(replayGuard),
    ),
    hasCode("flow_replay_detected"),
  );
});

test("rejects reuse of an idempotency key for a different signed request", () => {
  const replayGuard = new InMemoryFlowReplayGuard();
  const firstToken = issueToken();
  const secondToken = issueToken({
    issuedAt: new Date("2026-08-07T12:00:01.000Z"),
    expiresInSeconds: 299,
  });
  processSyntheticFlowAction(actionRequest(firstToken), executionContext(replayGuard));
  assert.throws(
    () => processSyntheticFlowAction(actionRequest(secondToken), executionContext(replayGuard)),
    hasCode("flow_idempotency_conflict"),
  );
});

test("rejects malformed schemas, versions, actions, screens and extra fields", () => {
  const token = issueToken();
  const base = actionRequest(token);
  const cases: ReadonlyArray<{ readonly payload: unknown; readonly code: string }> = [
    { payload: null, code: "malformed_flow_action" },
    { payload: { ...base, version: 2 }, code: "unsupported_flow_action_version" },
    { payload: { ...base, schema: "other.schema" }, code: "unsupported_flow_action_version" },
    { payload: { ...base, action: "confirm" }, code: "invalid_flow_action" },
    { payload: { ...base, screen: "PENDING_CONFIRMATION" }, code: "flow_action_screen_mismatch" },
    { payload: { ...base, unexpected: true }, code: "malformed_flow_action" },
  ];

  for (const scenario of cases) {
    assert.throws(
      () => processSyntheticFlowAction(scenario.payload, executionContext()),
      hasCode(scenario.code),
    );
  }
});

test("does not accept provider-shaped or encrypted Flow payloads", () => {
  assert.throws(
    () => processSyntheticFlowAction({
      encrypted_flow_data: "provider-data-is-never-accepted",
      encrypted_aes_key: "provider-key-is-never-accepted",
      initial_vector: "provider-vector-is-never-accepted",
    }, executionContext()),
    hasCode("provider_flow_payload_denied"),
  );
});

test("models static definitions without creating an endpoint", () => {
  const token = issueToken({
    purpose: "service_information",
    definitionId: "synthetic-flow-service-information",
    sessionId: "synthetic-session-service-info-0001",
    correlationId: "synthetic-correlation-service-info-0001",
  });
  assert.throws(
    () => processSyntheticFlowAction(actionRequest(token, {
      purpose: "service_information",
      definitionId: "synthetic-flow-service-information",
      sessionId: "synthetic-session-service-info-0001",
      correlationId: "synthetic-correlation-service-info-0001",
      screen: "SERVICE_OVERVIEW",
      action: "continue",
    }), executionContext()),
    hasCode("static_flow_has_no_endpoint"),
  );
});

test("only implements the pending-confirmation transition", () => {
  assert.throws(
    () => processSyntheticFlowAction(actionRequest(issueToken(), {
      screen: "REQUEST_DETAILS",
      action: "continue",
    }), executionContext()),
    hasCode("flow_action_not_implemented"),
  );
});

test("fails closed for non-demo and live/Meta endpoint attempts", () => {
  assert.throws(
    () => issueToken({ runtimeMode: "live" }),
    hasCode("non_demo_flow_denied"),
  );
  assert.throws(
    () => processSyntheticFlowAction(
      actionRequest(issueToken()),
      executionContext(new InMemoryFlowReplayGuard(), { runtimeMode: "live" }),
    ),
    hasCode("non_demo_flow_denied"),
  );
  assert.throws(
    () => processSyntheticFlowAction(
      actionRequest(issueToken()),
      executionContext(new InMemoryFlowReplayGuard(), { transport: "meta" }),
    ),
    hasCode("meta_flow_endpoint_not_implemented"),
  );
  assert.throws(
    () => rejectLiveMetaFlowEndpoint({ any: "payload" }),
    hasCode("meta_flow_endpoint_not_implemented"),
  );
});

test("denies cross-tenant action context before token processing", () => {
  assert.throws(
    () => processSyntheticFlowAction(
      actionRequest(issueToken()),
      executionContext(new InMemoryFlowReplayGuard(), { expectedTenantId: "other-demo" }),
    ),
    hasCode("tenant_mismatch"),
  );
});
