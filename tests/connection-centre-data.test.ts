import { describe, expect, it, vi } from "vitest";

import {
  DEMO_INTEGRATION_BINDINGS,
  DEMO_INTEGRATION_IDS,
  DEMO_WHATSAPP_SIGNAL_KEYS,
  DEMO_WHATSAPP_SIGNAL_MATRIX,
  type DemoIntegrationId,
} from "@/lib/domain/connections";
import type {
  VerifiedWorkspaceSession,
  WorkspaceRole,
} from "@/lib/firebase/workspace-session-model";
import {
  ConnectionCentreClientError,
  connectionCentreAccess,
  connectionCentreAuthorityKey,
  connectionCentreFailure,
  deriveConnectionCentreSummary,
  validateConnectionCentreResult,
} from "@/components/connections/connection-centre-data";
import {
  createConnectionCentreRequestGate,
  loadConnectionCentreForAuthority,
} from "@/components/connections/use-connection-centre";

const createdAt = "2026-08-08T08:00:00.000Z";
const observedAt = "2026-08-08T08:05:00.000Z";
const updatedAt = "2026-08-08T08:10:00.000Z";

function session(
  role: WorkspaceRole = "tenant_admin",
  overrides: Partial<VerifiedWorkspaceSession> = {},
): VerifiedWorkspaceSession {
  return {
    workspaceId: "workspace_safenet_demo",
    workspaceName: "SafeNet synthetic demo",
    workspaceMode: "demo",
    dataClassification: "synthetic_only",
    uid: `user_demo_${role}`,
    displayLabel: `Synthetic ${role}`,
    role,
    scopeMode: role === "tenant_admin" ? "workspace_wide" : "assigned",
    teamIds: ["team_demo_general"],
    locationIds: ["location_demo_wattala"],
    ...overrides,
  };
}

function evidence(binding: {
  readonly state: string;
  readonly source: string;
  readonly detailCode: string;
}) {
  return {
    ...binding,
    observedAt,
    lastSuccessfulVerificationAt: null,
  };
}

function integration(id: DemoIntegrationId) {
  const binding = DEMO_INTEGRATION_BINDINGS[id];
  return {
    id,
    workspaceId: "workspace_safenet_demo",
    kind: binding.kind,
    displayName: binding.displayName,
    environment: "demo",
    adapterMode: "synthetic",
    status: "mock",
    credentialState: "not_configured",
    externalNetworkEnabled: false,
    authoritativeSystemWriteEnabled: false,
    lastSyncAt: null,
    evidence: evidence({
      state: "mock",
      source: "synthetic_fixture",
      detailCode: binding.detailCode,
    }),
    sortKey: binding.sortKey,
    synthetic: true,
    schemaVersion: 1,
    createdAt,
    updatedAt,
  };
}

function completeInventory() {
  return {
    whatsappConnections: [
      {
        id: "connection_demo_simulator",
        workspaceId: "workspace_safenet_demo",
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
        signals: Object.fromEntries(
          DEMO_WHATSAPP_SIGNAL_KEYS.map((key) => [
            key,
            evidence(DEMO_WHATSAPP_SIGNAL_MATRIX[key]),
          ]),
        ),
        sortKey: "01_whatsapp_simulator",
        synthetic: true,
        schemaVersion: 1,
        createdAt,
        updatedAt,
      },
    ],
    integrations: DEMO_INTEGRATION_IDS.map(integration),
  };
}

describe("connection-centre authority boundary", () => {
  it("allows only a verified tenant administrator in the frozen synthetic workspace", () => {
    expect(connectionCentreAccess(session())).toBe("allowed");
    expect(
      connectionCentreAccess(session("tenant_admin", { scopeMode: "assigned" })),
    ).toBe("allowed");

    for (const role of [
      "platform_owner",
      "supervisor",
      "agent",
      "campaign_operator",
      "campaign_approver",
      "analyst",
      "privacy_reviewer",
      "clinical_approver",
    ] as const) {
      expect(connectionCentreAccess(session(role))).toBe("denied");
    }

    expect(
      connectionCentreAccess(
        session("tenant_admin", { workspaceId: "workspace_other" }),
      ),
    ).toBe("denied");
    expect(
      connectionCentreAccess(
        {
          ...session(),
          workspaceMode: "uat",
        } as unknown as VerifiedWorkspaceSession,
      ),
    ).toBe("denied");
    expect(
      connectionCentreAccess(
        {
          ...session(),
          dataClassification: "regulated_patient_data",
        } as unknown as VerifiedWorkspaceSession,
      ),
    ).toBe("denied");
  });

  it("changes the remount key for every authority-bearing session field", () => {
    const baseline = session();
    const variants: VerifiedWorkspaceSession[] = [
      { ...baseline, workspaceId: "workspace_other" },
      { ...baseline, uid: "user_other" },
      { ...baseline, role: "supervisor" },
      { ...baseline, scopeMode: "assigned" },
      { ...baseline, workspaceMode: "local" },
      {
        ...baseline,
        dataClassification: "approved_uat",
      } as unknown as VerifiedWorkspaceSession,
      { ...baseline, teamIds: ["team_other"] },
      { ...baseline, locationIds: ["location_other"] },
    ];
    const baselineKey = connectionCentreAuthorityKey(baseline);
    for (const variant of variants) {
      expect(connectionCentreAuthorityKey(variant)).not.toBe(baselineKey);
    }
  });

  it("refuses hostile authority before invoking a repository loader", async () => {
    const loader = vi.fn(async () => completeInventory());
    await expect(
      loadConnectionCentreForAuthority(session("supervisor"), loader),
    ).rejects.toMatchObject({ code: "access_denied" });
    expect(loader).not.toHaveBeenCalled();
  });

  it("uses only the frozen workspace input for an allowed repository load", async () => {
    const loader = vi.fn(async () => completeInventory());
    const result = await loadConnectionCentreForAuthority(session(), loader);
    expect(result.whatsappConnections).toHaveLength(1);
    expect(result.integrations).toHaveLength(2);
    expect(loader).toHaveBeenCalledExactlyOnceWith({
      workspaceId: "workspace_safenet_demo",
    });
  });
});

describe("connection-centre response and source guards", () => {
  it("derives exact counts and every false gate from the persisted DTOs", () => {
    expect(deriveConnectionCentreSummary(completeInventory())).toEqual({
      mockWhatsAppSimulators: 1,
      mockSystemSimulators: 2,
      externalProviderConnections: 0,
      externalSendingEnabled: false,
      externalNetworkEnabled: false,
      authoritativeWritesEnabled: false,
    });
  });

  it("accepts the honest all-absent state without inventing inventory", () => {
    expect(
      deriveConnectionCentreSummary({
        whatsappConnections: [],
        integrations: [],
      }),
    ).toEqual({
      mockWhatsAppSimulators: 0,
      mockSystemSimulators: 0,
      externalProviderConnections: 0,
      externalSendingEnabled: false,
      externalNetworkEnabled: false,
      authoritativeWritesEnabled: false,
    });
  });

  it("rejects partial, schema-polluted, gate-enabled and substituted-source responses", () => {
    const complete = completeInventory();
    const whatsapp = complete.whatsappConnections[0]!;
    const waba = whatsapp.signals.waba as Record<string, unknown>;
    const hostile = [
      { ...complete, integrations: [complete.integrations[0]] },
      {
        ...complete,
        whatsappConnections: [{ ...whatsapp, endpointUrl: "https://forbidden.invalid" }],
      },
      {
        ...complete,
        whatsappConnections: [{ ...whatsapp, externalMessagingEnabled: true }],
      },
      {
        ...complete,
        whatsappConnections: [
          {
            ...whatsapp,
            signals: {
              ...whatsapp.signals,
              waba: { ...waba, source: "local_policy" },
            },
          },
        ],
      },
    ];

    for (const value of hostile) {
      expect(() => validateConnectionCentreResult(value)).toThrowError(
        ConnectionCentreClientError,
      );
      expect(() => validateConnectionCentreResult(value)).toThrow(
        /governed synthetic v1 contract/u,
      );
    }
  });

  it("never echoes hostile error details into UI messages", () => {
    const secret = "credential-secret-material-must-not-render";
    for (const failure of [
      connectionCentreFailure({ code: "permission-denied", message: secret }),
      connectionCentreFailure({ code: "invalid_persisted_data", message: secret }),
      connectionCentreFailure(new Error(secret)),
    ]) {
      expect(failure.message).not.toContain(secret);
      expect(failure.message).toMatch(/No |no /u);
    }
  });
});

describe("connection-centre stale-response gate", () => {
  it("invalidates an older request after retry, authority change, or unmount", () => {
    const gate = createConnectionCentreRequestGate();
    const first = gate.begin();
    expect(gate.isCurrent(first)).toBe(true);

    const retry = gate.begin();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(retry)).toBe(true);

    gate.invalidate();
    expect(gate.isCurrent(retry)).toBe(false);
  });
});
