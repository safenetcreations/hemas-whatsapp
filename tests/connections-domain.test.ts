import { describe, expect, it } from "vitest";

import {
  DEMO_CONNECTION_WORKSPACE_ID,
  DEMO_EVIDENCE_SIGNAL_SOURCES,
  DEMO_EVIDENCE_SIGNAL_STATES,
  DEMO_INTEGRATION_BINDINGS,
  DEMO_INTEGRATION_IDS,
  DEMO_WHATSAPP_CONNECTION_ID,
  DEMO_WHATSAPP_SIGNAL_KEYS,
  DEMO_WHATSAPP_SIGNAL_MATRIX,
  assertDemoConnectionCentreV1,
  assertStaffSafeIntegrationV1,
  assertStaffSafeWhatsAppConnectionV1,
  type DemoIntegrationId,
} from "@/lib/domain/connections";

const createdAt = "2026-08-08T08:00:00.000Z";
const observedAt = "2026-08-08T08:05:00.000Z";
const updatedAt = "2026-08-08T08:10:00.000Z";

function whatsappSignals() {
  return Object.fromEntries(
    DEMO_WHATSAPP_SIGNAL_KEYS.map((key) => [
      key,
      {
        ...DEMO_WHATSAPP_SIGNAL_MATRIX[key],
        observedAt,
        lastSuccessfulVerificationAt: null,
      },
    ]),
  );
}

function whatsapp(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: DEMO_WHATSAPP_CONNECTION_ID,
    workspaceId: DEMO_CONNECTION_WORKSPACE_ID,
    displayName: "Local WhatsApp journey simulator",
    provider: "simulator",
    environment: "demo",
    status: "mock",
    maskedNumber: "No external number",
    maskedWabaId: null,
    maskedPhoneNumberId: null,
    credentialState: "not_configured",
    externalMessagingEnabled: false,
    networkCallsEnabled: false,
    signals: whatsappSignals(),
    sortKey: "01_whatsapp_simulator",
    synthetic: true,
    schemaVersion: 1,
    createdAt,
    updatedAt,
    ...overrides,
  };
}

function integration(
  id: DemoIntegrationId,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  const binding = DEMO_INTEGRATION_BINDINGS[id];
  return {
    id,
    workspaceId: DEMO_CONNECTION_WORKSPACE_ID,
    kind: binding.kind,
    displayName: binding.displayName,
    environment: "demo",
    adapterMode: "synthetic",
    status: "mock",
    credentialState: "not_configured",
    externalNetworkEnabled: false,
    authoritativeSystemWriteEnabled: false,
    lastSyncAt: null,
    evidence: {
      state: "mock",
      source: "synthetic_fixture",
      observedAt,
      lastSuccessfulVerificationAt: null,
      detailCode: binding.detailCode,
    },
    sortKey: binding.sortKey,
    synthetic: true,
    schemaVersion: 1,
    createdAt,
    updatedAt,
    ...overrides,
  };
}

describe("authoritative synthetic connection domain", () => {
  it("freezes the finite evidence vocabulary, exact IDs and 11-signal matrix", () => {
    expect(DEMO_EVIDENCE_SIGNAL_STATES).toEqual([
      "not_configured",
      "not_submitted",
      "unverified",
      "mock",
      "blocked",
      "not_available",
    ]);
    expect(DEMO_EVIDENCE_SIGNAL_SOURCES).toEqual([
      "synthetic_fixture",
      "local_policy",
    ]);
    expect(DEMO_INTEGRATION_IDS).toEqual([
      "integration_demo_his_simulator",
      "integration_demo_lims_simulator",
    ]);
    expect(DEMO_WHATSAPP_SIGNAL_KEYS).toHaveLength(11);
    expect(DEMO_WHATSAPP_SIGNAL_MATRIX.sending).toEqual({
      state: "blocked",
      source: "local_policy",
      detailCode: "external_sending_disabled",
    });
    expect(DEMO_WHATSAPP_SIGNAL_MATRIX.realDeviceCanary).toEqual({
      state: "blocked",
      source: "local_policy",
      detailCode: "no_real_device_canary",
    });
  });

  it("accepts only the exact zero-network WhatsApp simulator chronology", () => {
    const valid = whatsapp();
    expect(() => assertStaffSafeWhatsAppConnectionV1(valid)).not.toThrow();
    expect(valid).toMatchObject({
      id: "connection_demo_simulator",
      workspaceId: "workspace_safenet_demo",
      externalMessagingEnabled: false,
      networkCallsEnabled: false,
    });

    const signals = whatsappSignals() as Record<string, unknown>;
    const sending = signals.sending as Record<string, unknown>;
    for (const invalid of [
      whatsapp({ networkCallsEnabled: true }),
      whatsapp({ externalMessagingEnabled: true }),
      whatsapp({ maskedWabaId: "raw-waba-id" }),
      whatsapp({ credentialSecretRef: "secret://forbidden" }),
      whatsapp({ createdAt: "2026-08-08T08:11:00.000Z" }),
      whatsapp({ updatedAt: "2026-08-08T08:04:00.000Z" }),
      whatsapp({
        signals: {
          ...signals,
          sending: { ...sending, state: "mock" },
        },
      }),
      whatsapp({
        signals: {
          ...signals,
          sending: { ...sending, detail: "free-form provider health" },
        },
      }),
      whatsapp({
        signals: {
          ...signals,
          sending: { ...sending, observedAt: "2026-08-08T07:59:59.999Z" },
        },
      }),
    ]) {
      expect(() => assertStaffSafeWhatsAppConnectionV1(invalid)).toThrow();
    }
  });

  it("binds both integrations to exact kind, sort, evidence and zero-call policy", () => {
    for (const id of DEMO_INTEGRATION_IDS) {
      expect(() => assertStaffSafeIntegrationV1(integration(id))).not.toThrow();
    }

    for (const invalid of [
      integration("integration_demo_his_simulator", {
        kind: "laboratory_lims",
      }),
      integration("integration_demo_his_simulator", {
        sortKey: "02_lims_simulator",
      }),
      integration("integration_demo_his_simulator", {
        externalNetworkEnabled: true,
      }),
      integration("integration_demo_lims_simulator", {
        authoritativeSystemWriteEnabled: true,
      }),
      integration("integration_demo_his_simulator", {
        evidence: {
          ...integration("integration_demo_his_simulator").evidence,
          detailCode: "deterministic_lims_simulator_only",
        },
      }),
      integration("integration_demo_his_simulator", {
        evidence: {
          ...integration("integration_demo_his_simulator").evidence,
          observedAt: "2026-08-08T08:10:00.001Z",
        },
      }),
      integration("integration_demo_his_simulator", {
        endpointUrl: "https://provider.invalid",
      }),
      integration("integration_demo_his_simulator", {
        displayName: "Live appointment connector",
      }),
      integration("integration_demo_his_simulator", {
        displayName: "Production-ready simulator",
      }),
    ]) {
      expect(() => assertStaffSafeIntegrationV1(invalid)).toThrow();
    }
  });

  it("accepts only an honest empty state or the complete unique sorted inventory", () => {
    const centre = {
      whatsappConnections: [whatsapp()],
      integrations: DEMO_INTEGRATION_IDS.map((id) => integration(id)),
    };
    expect(() => assertDemoConnectionCentreV1(centre)).not.toThrow();
    expect(() =>
      assertDemoConnectionCentreV1({ whatsappConnections: [], integrations: [] }),
    ).not.toThrow();

    for (const invalid of [
      { ...centre, whatsappConnections: [] },
      { ...centre, integrations: [] },
      { ...centre, whatsappConnections: [whatsapp(), whatsapp()] },
      { ...centre, integrations: [integration("integration_demo_his_simulator")] },
      { ...centre, integrations: [...centre.integrations].reverse() },
      {
        ...centre,
        integrations: [
          integration("integration_demo_his_simulator"),
          integration("integration_demo_his_simulator"),
        ],
      },
      { ...centre, rawProviderState: true },
    ]) {
      expect(() => assertDemoConnectionCentreV1(invalid)).toThrow();
    }
  });
});
