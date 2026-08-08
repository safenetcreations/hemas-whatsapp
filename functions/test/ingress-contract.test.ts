import assert from "node:assert/strict";
import test from "node:test";

import {
  assertAuthorizedSyntheticIngressRoute,
  authorizeSyntheticIngressRoute,
  loadSyntheticIngressBoundary,
  type AuthorizedSyntheticIngressRoute,
} from "../src/ingress/boundary.js";
import {
  authenticateAndParseSyntheticWebhook,
  createSyntheticWebhookFixtureSignature,
  MAX_SYNTHETIC_WEBHOOK_BYTES,
  PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET,
  SYNTHETIC_WEBHOOK_SCHEMA,
  verifySyntheticWebhookChallenge,
  verifySyntheticWebhookSignature,
} from "../src/ingress/contracts.js";

function hasCode(expected: string): (error: unknown) => boolean {
  return (error: unknown) =>
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { readonly code: unknown }).code === expected;
}

function demoEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    GCLOUD_PROJECT: "demo-hemas-connect",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    HEMAS_RUNTIME_MODE: "demo",
    HEMAS_PROVIDER_MODE: "synthetic",
    HEMAS_INTEGRATION_MODE: "synthetic",
    HEMAS_OUTBOUND_ENABLED: "false",
    HEMAS_DIAGNOSIS_ENABLED: "false",
    HEMAS_SYNTHETIC_INGRESS_SECRET: PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET,
    ...overrides,
  };
}

function inboundPayload(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    schema: SYNTHETIC_WEBHOOK_SCHEMA,
    version: 1,
    mode: "demo",
    eventId: "synthetic-event-inbound-0001",
    routeRef: "synthetic-phone-route-wattala-demo",
    occurredAt: "2026-08-07T12:00:00.000Z",
    event: {
      kind: "message_inbound",
      providerMessageRef: "synthetic-message-inbound-0001",
      contactRef: "synthetic-contact-ingress-0001",
      scenarioCode: "appointment_request",
      textCode: "APPOINTMENT_REQUEST_EN",
      language: "en",
    },
    ...overrides,
  };
}

function signedRaw(value: unknown): {
  readonly rawBody: Buffer;
  readonly signatureHeader: string;
} {
  const rawBody = Buffer.from(JSON.stringify(value), "utf8");
  return { rawBody, signatureHeader: createSyntheticWebhookFixtureSignature(rawBody) };
}

test("accepts only the explicit demo project, loopback emulator and public fixture material", () => {
  assert.ok(Buffer.byteLength(PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET, "utf8") >= 32);
  const boundary = loadSyntheticIngressBoundary(demoEnvironment());
  assert.equal(boundary.projectId, "demo-hemas-connect");
  assert.equal(boundary.firestoreEmulatorHost, "127.0.0.1:8080");

  for (const overrides of [
    { GCLOUD_PROJECT: "hemas-production" },
    { FIRESTORE_EMULATOR_HOST: "firestore.googleapis.com:443" },
    { FIRESTORE_EMULATOR_HOST: "" },
    { HEMAS_RUNTIME_MODE: "production" },
    { HEMAS_PROVIDER_MODE: "live" },
    { HEMAS_INTEGRATION_MODE: "live" },
    { HEMAS_OUTBOUND_ENABLED: "true" },
    { HEMAS_DIAGNOSIS_ENABLED: "true" },
    { HEMAS_SYNTHETIC_INGRESS_SECRET: "a-real-looking-private-secret-that-is-long-enough" },
  ]) {
    assert.throws(
      () => loadSyntheticIngressBoundary(demoEnvironment(overrides)),
      hasCode("synthetic_ingress_boundary_denied"),
    );
  }
});

test("resolves the caller route only through the server-side synthetic registry", () => {
  const boundary = loadSyntheticIngressBoundary(demoEnvironment());
  const authorization = authorizeSyntheticIngressRoute(
    boundary,
    "synthetic-phone-route-wattala-demo",
  );
  assert.equal(authorization.route.workspaceId, "workspace_safenet_demo");
  assert.equal(authorization.route.teamId, "team_demo_general");
  assert.doesNotThrow(() => assertAuthorizedSyntheticIngressRoute(authorization));
  assert.throws(
    () => authorizeSyntheticIngressRoute(boundary, "synthetic-phone-route-unregistered"),
    hasCode("synthetic_route_denied"),
  );
  assert.throws(
    () => assertAuthorizedSyntheticIngressRoute({
      boundary,
      route: authorization.route,
    } as AuthorizedSyntheticIngressRoute),
    hasCode("synthetic_ingress_boundary_denied"),
  );
});

test("implements an exact GET verification contract with constant-time token comparison", () => {
  const challenge = verifySyntheticWebhookChallenge({
    query: {
      "hub.mode": "subscribe",
      "hub.verify_token": PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET,
      "hub.challenge": "synthetic-challenge-abcdefgh",
    },
    syntheticFixtureSecret: PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET,
  });
  assert.equal(challenge, "synthetic-challenge-abcdefgh");
  assert.throws(() => verifySyntheticWebhookChallenge({
    query: {
      "hub.mode": "subscribe",
      "hub.verify_token": "wrong-token-that-is-not-the-public-synthetic-fixture",
      "hub.challenge": "synthetic-challenge-abcdefgh",
    },
    syntheticFixtureSecret: PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET,
  }), hasCode("invalid_synthetic_verification_token"));
  assert.throws(() => verifySyntheticWebhookChallenge({
    query: {
      "hub.mode": "subscribe",
      "hub.verify_token": PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET,
      "hub.challenge": "synthetic-challenge-abcdefgh",
      tenantId: "must-not-be-accepted",
    },
    syntheticFixtureSecret: PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET,
  }), hasCode("invalid_synthetic_verification"));
});

test("verifies raw-body sha256 signatures before attempting JSON parsing", () => {
  const malformed = Buffer.from("{not-json", "utf8");
  assert.throws(() => authenticateAndParseSyntheticWebhook({
    rawBody: malformed,
    signatureHeader: "sha256=" + "0".repeat(64),
    syntheticFixtureSecret: PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET,
  }), hasCode("invalid_synthetic_webhook_signature"));
  assert.throws(() => authenticateAndParseSyntheticWebhook({
    rawBody: malformed,
    signatureHeader: createSyntheticWebhookFixtureSignature(malformed),
    syntheticFixtureSecret: PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET,
  }), hasCode("invalid_synthetic_webhook_json"));

  const valid = signedRaw(inboundPayload());
  assert.doesNotThrow(() => verifySyntheticWebhookSignature({
    ...valid,
    syntheticFixtureSecret: PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET,
  }));
  assert.equal(
    authenticateAndParseSyntheticWebhook({
      ...valid,
      syntheticFixtureSecret: PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET,
    }).event.kind,
    "message_inbound",
  );
});

test("accepts only bounded allowlisted references and codes, never free-form patient content", () => {
  const valid = signedRaw(inboundPayload());
  const parsed = authenticateAndParseSyntheticWebhook({
    ...valid,
    syntheticFixtureSecret: PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET,
  });
  assert.equal(parsed.event.kind, "message_inbound");

  for (const event of [
    { scenarioCode: "stop_request", textCode: "STOP_REQUEST_SI", language: "si" },
    { scenarioCode: "stop_request", textCode: "STOP_REQUEST_TA", language: "ta" },
    { scenarioCode: "urgent_help", textCode: "URGENT_HELP_SI", language: "si" },
    { scenarioCode: "urgent_help", textCode: "URGENT_HELP_TA", language: "ta" },
  ]) {
    const localized = signedRaw(inboundPayload({
      event: { ...inboundPayload().event, ...event },
    }));
    assert.equal(authenticateAndParseSyntheticWebhook({
      ...localized,
      syntheticFixtureSecret: PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET,
    }).event.kind, "message_inbound");
  }

  const invalidEvents = [
    { ...inboundPayload().event, body: "free-form patient text" },
    { ...inboundPayload().event, phoneNumber: "+94770000000" },
    { ...inboundPayload().event, textCode: "UNAPPROVED_TEXT" },
    { ...inboundPayload().event, textCode: "APPOINTMENT_REQUEST_TA", language: "en" },
    { ...inboundPayload().event, providerMessageRef: "real-provider-id" },
  ];
  for (const event of invalidEvents) {
    const signed = signedRaw(inboundPayload({ event }));
    assert.throws(() => authenticateAndParseSyntheticWebhook({
      ...signed,
      syntheticFixtureSecret: PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET,
    }), hasCode("invalid_synthetic_webhook"));
  }
  const tenantInjected = signedRaw(inboundPayload({ tenantId: "hemas-production" }));
  assert.throws(() => authenticateAndParseSyntheticWebhook({
    ...tenantInjected,
    syntheticFixtureSecret: PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET,
  }), hasCode("invalid_synthetic_webhook"));
  const oversized = Buffer.alloc(MAX_SYNTHETIC_WEBHOOK_BYTES + 1, 0x61);
  assert.throws(() => verifySyntheticWebhookSignature({
    rawBody: oversized,
    signatureHeader: "sha256=" + "0".repeat(64),
    syntheticFixtureSecret: PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET,
  }), hasCode("invalid_synthetic_webhook_body"));
});

test("validates exact status callback schemas and failure-code pairing", () => {
  const status = signedRaw(inboundPayload({
    eventId: "synthetic-event-status-0001",
    event: {
      kind: "message_status",
      providerMessageRef: "synthetic-message-inbound-0001",
      contactRef: "synthetic-contact-ingress-0001",
      status: "delivered",
      statusCode: "SYNTHETIC_STATUS_OK",
    },
  }));
  assert.equal(authenticateAndParseSyntheticWebhook({
    ...status,
    syntheticFixtureSecret: PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET,
  }).event.kind, "message_status");

  const mismatch = signedRaw(inboundPayload({
    eventId: "synthetic-event-status-0002",
    event: {
      kind: "message_status",
      providerMessageRef: "synthetic-message-inbound-0001",
      contactRef: "synthetic-contact-ingress-0001",
      status: "failed",
      statusCode: "SYNTHETIC_STATUS_OK",
    },
  }));
  assert.throws(() => authenticateAndParseSyntheticWebhook({
    ...mismatch,
    syntheticFixtureSecret: PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET,
  }), hasCode("invalid_synthetic_webhook"));
});
