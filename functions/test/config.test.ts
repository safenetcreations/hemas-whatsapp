import assert from "node:assert/strict";
import test from "node:test";
import { ConfigValidationError, loadRuntimeConfig } from "../src/config.js";

test("runtime config defaults to a safe simulator-only demo", () => {
  const config = loadRuntimeConfig({});
  assert.equal(config.runtimeMode, "demo");
  assert.equal(config.defaultTenantId, "workspace_safenet_demo");
  assert.equal(config.providerMode, "synthetic");
  assert.equal(config.hemasIntegrationMode, "synthetic");
  assert.equal(config.outboundEnabled, false);
  assert.equal(config.diagnosisEnabled, false);
});

test("tenant identifiers accept canonical opaque demo IDs and reject unsafe paths", () => {
  assert.equal(
    loadRuntimeConfig({ HEMAS_DEFAULT_TENANT_ID: "workspace_safenet_demo" })
      .defaultTenantId,
    "workspace_safenet_demo",
  );
  assert.throws(
    () => loadRuntimeConfig({ HEMAS_DEFAULT_TENANT_ID: "workspaces/demo" }),
    ConfigValidationError,
  );
  assert.throws(
    () => loadRuntimeConfig({ HEMAS_DEFAULT_TENANT_ID: "Workspace_Demo" }),
    ConfigValidationError,
  );
});

test("medical diagnosis cannot be enabled", () => {
  assert.throws(
    () => loadRuntimeConfig({ HEMAS_DIAGNOSIS_ENABLED: "true" }),
    (error: unknown) => error instanceof ConfigValidationError &&
      error.issues.includes("HEMAS_DIAGNOSIS_ENABLED must remain false"),
  );
});

test("demo cannot select a live provider", () => {
  assert.throws(
    () => loadRuntimeConfig({ HEMAS_PROVIDER_MODE: "live" }),
    ConfigValidationError,
  );
});

test("non-demo cannot use synthetic providers or ephemeral audit", () => {
  assert.throws(
    () => loadRuntimeConfig({ HEMAS_RUNTIME_MODE: "production" }),
    (error: unknown) => error instanceof ConfigValidationError && error.issues.length === 3,
  );
});

test("future live configuration requires explicit activation metadata", () => {
  assert.throws(
    () => loadRuntimeConfig({
      HEMAS_RUNTIME_MODE: "production",
      HEMAS_PROVIDER_MODE: "live",
      HEMAS_INTEGRATION_MODE: "live",
      HEMAS_AUDIT_SINK_MODE: "durable",
      HEMAS_OUTBOUND_ENABLED: "true",
    }),
    ConfigValidationError,
  );
});

test("complete future live governance config validates but does not implement an adapter", () => {
  const now = new Date("2026-08-07T00:00:00.000Z");
  const config = loadRuntimeConfig({
    HEMAS_RUNTIME_MODE: "production",
    HEMAS_PROVIDER_MODE: "live",
    HEMAS_INTEGRATION_MODE: "live",
    HEMAS_AUDIT_SINK_MODE: "durable",
    HEMAS_OUTBOUND_ENABLED: "true",
    HEMAS_APPROVAL_GATE_REQUIRED: "true",
    HEMAS_LIVE_ACTIVATION_ID: "activation-change-001",
    HEMAS_LIVE_ACTIVATION_APPROVED_BY: "hemas-approver-001",
    HEMAS_LIVE_ACTIVATION_EXPIRES_AT: "2026-08-08T00:00:00.000Z",
  }, now);
  assert.equal(config.runtimeMode, "production");
  assert.equal(config.outboundEnabled, true);
});
