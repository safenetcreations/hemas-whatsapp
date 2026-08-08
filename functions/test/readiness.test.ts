import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntimeConfig } from "../src/config.js";
import { buildReadinessReport } from "../src/readiness.js";

test("default demo readiness is safe, simulator-only and diagnosis-free", () => {
  const report = buildReadinessReport(
    loadRuntimeConfig({}),
    new Date("2026-08-07T00:00:00.000Z"),
  );
  assert.equal(report.status, "ready");
  assert.equal(report.safeMode, true);
  assert.equal(report.checks.whatsapp, "synthetic");
  assert.equal(report.checks.outboundNetwork, "blocked");
  assert.equal(report.checks.medicalDiagnosis, "disabled");
});

test("future live settings remain not-ready because adapters are not implemented", () => {
  const now = new Date("2026-08-07T00:00:00.000Z");
  const config = loadRuntimeConfig({
    HEMAS_RUNTIME_MODE: "production",
    HEMAS_PROVIDER_MODE: "live",
    HEMAS_INTEGRATION_MODE: "live",
    HEMAS_AUDIT_SINK_MODE: "durable",
    HEMAS_OUTBOUND_ENABLED: "true",
    HEMAS_LIVE_ACTIVATION_ID: "change-001",
    HEMAS_LIVE_ACTIVATION_APPROVED_BY: "hemas-approver",
    HEMAS_LIVE_ACTIVATION_EXPIRES_AT: "2026-08-08T00:00:00.000Z",
  }, now);
  const report = buildReadinessReport(config, now);
  assert.equal(report.status, "not_ready");
  assert.equal(report.checks.whatsapp, "live_adapter_not_implemented");
  assert.equal(report.checks.hemasSystems, "live_adapters_not_implemented");
  assert.equal(report.checks.audit, "durable_adapter_requires_runtime_binding");
  assert.equal(report.checks.outboundNetwork, "blocked");
});
