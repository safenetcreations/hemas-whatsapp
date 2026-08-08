import assert from "node:assert/strict";
import test from "node:test";
import { createHemasSystemAdapters } from "../src/adapters/hemas-systems.js";
import { assertApprovedLiveOperation } from "../src/adapters/contracts.js";
import { createWhatsAppMetaAdapter } from "../src/adapters/whatsapp-meta.js";
import { loadRuntimeConfig } from "../src/config.js";
import { generateSyntheticMessages } from "../src/simulator/messages.js";

const demoContext = {
  tenantId: "safenet-demo",
  requestId: "request-demo-1",
  actorId: "synthetic-user-1",
};

test("synthetic WhatsApp adapter returns a deterministic fake ID without a network call", async () => {
  const config = loadRuntimeConfig({});
  const adapter = createWhatsAppMetaAdapter(config);
  const contact = generateSyntheticMessages({
    tenantId: "safenet-demo",
    conversationId: "conversation-1",
    count: 1,
    seed: "adapter-seed-v1",
  })[0];
  assert.ok(contact);
  const result = await adapter.sendApprovedTemplate({
    tenantId: "safenet-demo",
    recipientRef: contact.syntheticContactId,
    templateName: "appointment_demo",
    language: "en",
    parameterRefs: [],
  }, demoContext);
  assert.equal(result.networkCalls, 0);
  assert.equal(result.simulated, true);
  assert.match(result.providerMessageId, /^synthetic-wamid-/);
});

test("synthetic WhatsApp adapter rejects non-synthetic recipients", async () => {
  const adapter = createWhatsAppMetaAdapter(loadRuntimeConfig({}));
  await assert.rejects(
    adapter.sendApprovedTemplate({
      tenantId: "safenet-demo",
      recipientRef: "real-contact-ref",
      templateName: "appointment_demo",
      language: "en",
      parameterRefs: [],
    }, demoContext),
    { code: "non_synthetic_recipient" },
  );
});

test("synthetic Hemas adapters expose slots and report-ready state without clinical results", async () => {
  const adapters = createHemasSystemAdapters(loadRuntimeConfig({}));
  const slots = await adapters.his.listAppointmentSlots({
    tenantId: "safenet-demo",
    locationRef: "location-demo",
    specialtyRef: "specialty-demo",
    date: "2026-08-08",
  }, demoContext);
  assert.equal(slots.length, 3);
  const report = await adapters.lims.getReportNotificationState({
    tenantId: "safenet-demo",
    syntheticContactRef: "synthetic-contact-demo",
    externalReportRef: "synthetic-report-demo",
  }, demoContext);
  assert.equal(report.includesClinicalResult, false);
  assert.equal(report.networkCalls, 0);
});

test("cross-tenant adapter requests fail closed", async () => {
  const adapters = createHemasSystemAdapters(loadRuntimeConfig({}));
  await assert.rejects(
    adapters.his.listAppointmentSlots({
      tenantId: "other-demo",
      locationRef: "location-demo",
      specialtyRef: "specialty-demo",
      date: "2026-08-08",
    }, demoContext),
    { code: "tenant_mismatch" },
  );
});

test("future live configuration still creates only fail-closed adapters", async () => {
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
  const adapter = createWhatsAppMetaAdapter(config);
  assert.equal(adapter.readiness().ready, false);
  assert.equal(adapter.readiness().networkCallsEnabled, false);
  await assert.rejects(
    adapter.sendApprovedTemplate({
      tenantId: "hemas-prod",
      recipientRef: "contact-ref",
      templateName: "appointment_reminder",
      language: "en",
      parameterRefs: [],
    }, { tenantId: "hemas-prod", requestId: "request-1", actorId: "service-1" }),
    { code: "whatsapp_provider_disabled" },
  );
});

test("live-operation approval enforces separation of duties and operation hash", () => {
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
  const approval = assertApprovedLiveOperation(config, {
    tenantId: "hemas-prod",
    requestId: "request-1",
    actorId: "creator-1",
    approval: {
      status: "approved",
      tenantId: "hemas-prod",
      requestedBy: "creator-1",
      approvedBy: "approver-1",
      operationHash: "hash-1",
      approvedAt: "2026-08-07T00:01:00.000Z",
      expiresAt: "2026-08-07T01:00:00.000Z",
    },
  }, "hash-1", new Date("2026-08-07T00:30:00.000Z"));
  assert.equal(approval.approvedBy, "approver-1");
});
