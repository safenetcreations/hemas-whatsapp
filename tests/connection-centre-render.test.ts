import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEMO_INTEGRATION_BINDINGS,
  DEMO_INTEGRATION_IDS,
  DEMO_WHATSAPP_SIGNAL_KEYS,
  DEMO_WHATSAPP_SIGNAL_MATRIX,
  type DemoConnectionCentreV1,
  type DemoIntegrationId,
} from "@/lib/domain/connections";
import type { WorkspaceSessionSnapshot } from "@/components/auth/workspace-session";
import type {
  VerifiedWorkspaceSession,
  WorkspaceRole,
} from "@/lib/firebase/workspace-session-model";

const harness = vi.hoisted(() => ({
  workspace: { current: null as unknown },
  useConnectionCentre: vi.fn<(...args: unknown[]) => unknown>(() => ({
    status: "loading",
    inventory: null,
    message: "Loading the governed synthetic v1 inventory from local Firestore…",
    retry: vi.fn(),
  })),
}));

vi.mock("@/components/auth/workspace-session", () => ({
  useWorkspaceSession: () => harness.workspace.current,
}));

vi.mock("@/components/connections/use-connection-centre", () => ({
  useConnectionCentre: (...args: unknown[]) =>
    harness.useConnectionCentre(...args),
}));

import { ConnectionCentre } from "@/components/connections/connection-centre";

const createdAt = "2026-08-08T08:00:00.000Z";
const observedAt = "2026-08-08T08:05:00.000Z";
const updatedAt = "2026-08-08T08:10:00.000Z";

function session(role: WorkspaceRole = "tenant_admin"): VerifiedWorkspaceSession {
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
  };
}

function verified(role: WorkspaceRole = "tenant_admin"): WorkspaceSessionSnapshot {
  return { status: "verified", session: session(role), message: null };
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

function completeInventory(): DemoConnectionCentreV1 {
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
        ) as DemoConnectionCentreV1["whatsappConnections"][number]["signals"],
        sortKey: "01_whatsapp_simulator",
        synthetic: true,
        schemaVersion: 1,
        createdAt,
        updatedAt,
      },
    ],
    integrations: DEMO_INTEGRATION_IDS.map(integration) as unknown as DemoConnectionCentreV1["integrations"],
  };
}

describe("connection-centre authority-bound rendering", () => {
  beforeEach(() => {
    harness.workspace.current = verified();
    harness.useConnectionCentre.mockClear();
    harness.useConnectionCentre.mockReturnValue({
      status: "loading",
      inventory: null,
      message: "Loading the governed synthetic v1 inventory from local Firestore…",
      retry: vi.fn(),
    });
  });

  it("mounts the authoritative hook only for the active tenant administrator", () => {
    const markup = renderToStaticMarkup(createElement(ConnectionCentre));
    expect(markup).toContain('data-connections-access="allowed"');
    expect(markup).toContain('data-connections-load-state="loading"');
    expect(markup).toContain("Three fixed authoritative server reads");
    expect(harness.useConnectionCentre).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ role: "tenant_admin" }),
    );
  });

  it.each([
    "platform_owner",
    "supervisor",
    "agent",
    "campaign_operator",
    "campaign_approver",
    "analyst",
    "privacy_reviewer",
    "clinical_approver",
  ] as const)("makes zero inventory reads for hostile role %s", (role) => {
    harness.workspace.current = verified(role);
    const markup = renderToStaticMarkup(createElement(ConnectionCentre));
    expect(markup).toContain('data-connections-access="denied"');
    expect(markup).toContain("No inventory read was attempted");
    expect(markup).not.toContain("Loading persisted inventory");
    expect(harness.useConnectionCentre).not.toHaveBeenCalled();
  });

  it("renders nothing before verified authority exists", () => {
    harness.workspace.current = {
      status: "checking",
      session: null,
      message: null,
    } satisfies WorkspaceSessionSnapshot;
    expect(renderToStaticMarkup(createElement(ConnectionCentre))).toBe("");
    expect(harness.useConnectionCentre).not.toHaveBeenCalled();
  });

  it("synchronously removes prior inventory after an authority downgrade", () => {
    harness.useConnectionCentre.mockReturnValue({
      status: "ready",
      inventory: completeInventory(),
      message: null,
      retry: vi.fn(),
    });
    const allowed = renderToStaticMarkup(createElement(ConnectionCentre));
    expect(allowed).toContain("Local WhatsApp journey simulator");
    expect(harness.useConnectionCentre).toHaveBeenCalledOnce();

    harness.workspace.current = verified("supervisor");
    const denied = renderToStaticMarkup(createElement(ConnectionCentre));
    expect(denied).toContain("Connections access unavailable");
    expect(denied).not.toContain("Local WhatsApp journey simulator");
    expect(harness.useConnectionCentre).toHaveBeenCalledOnce();
  });
});

describe("connection-centre persisted states", () => {
  beforeEach(() => {
    harness.workspace.current = verified();
    harness.useConnectionCentre.mockClear();
  });

  it("renders exactly one WhatsApp and two HIS/LIMS mock rows from DTOs", () => {
    harness.useConnectionCentre.mockReturnValue({
      status: "ready",
      inventory: completeInventory(),
      message: null,
      retry: vi.fn(),
    });
    const markup = renderToStaticMarkup(createElement(ConnectionCentre));

    expect(markup.match(/data-connection-kind="whatsapp-simulator"/gu)).toHaveLength(1);
    expect(markup.match(/data-connection-kind="system-simulator"/gu)).toHaveLength(2);
    expect(markup).toContain("Local WhatsApp journey simulator");
    expect(markup).toContain("Local appointment HIS simulator");
    expect(markup).toContain("Local laboratory LIMS simulator");
    expect(markup).toContain("Mock WhatsApp");
    expect(markup).toContain("Mock HIS / LIMS");
    expect(markup).toContain(">1<");
    expect(markup).toContain(">2<");
    expect(markup).toContain("External providers");
    expect(markup).toContain(">0<");
  });

  it("shows literal evidence sources, timestamps, never-verification and every false gate", () => {
    harness.useConnectionCentre.mockReturnValue({
      status: "ready",
      inventory: completeInventory(),
      message: null,
      retry: vi.fn(),
    });
    const markup = renderToStaticMarkup(createElement(ConnectionCentre));

    expect(markup).toContain("synthetic_fixture");
    expect(markup).toContain("local_policy");
    expect(markup).toContain(observedAt);
    expect(markup).toContain(createdAt);
    expect(markup).toContain(updatedAt);
    expect(markup.match(/Never verified/gu)).toHaveLength(13);
    expect(markup).toContain("External messaging enabled");
    expect(markup).toContain("Network calls enabled");
    expect(markup.match(/External network enabled/gu)).toHaveLength(2);
    expect(markup.match(/Authoritative system write enabled/gu)).toHaveLength(2);
    expect(markup.match(/>false</gu)?.length ?? 0).toBeGreaterThanOrEqual(6);
  });

  it("does not render raw identifiers, endpoints, secrets or mutation controls", () => {
    harness.useConnectionCentre.mockReturnValue({
      status: "ready",
      inventory: completeInventory(),
      message: null,
      retry: vi.fn(),
    });
    const markup = renderToStaticMarkup(createElement(ConnectionCentre));
    for (const forbidden of [
      "workspace_safenet_demo",
      "connection_demo_simulator",
      "integration_demo_his_simulator",
      "integration_demo_lims_simulator",
      "01_whatsapp_simulator",
      "01_his_simulator",
      "02_lims_simulator",
      "WABA ID",
      "Phone number ID",
      "Endpoint URL",
      "Secret Manager",
      "Access token",
      "Connect asset",
      "Connected UAT",
      "Production release",
    ]) {
      expect(markup).not.toContain(forbidden);
    }
  });

  it("renders an honest all-absent state with no fixture inventory", () => {
    harness.useConnectionCentre.mockReturnValue({
      status: "empty",
      inventory: { whatsappConnections: [], integrations: [] },
      message:
        "No governed synthetic v1 inventory is present in the local Firestore emulator. All three fixed records are absent; no connection state was inferred.",
      retry: vi.fn(),
    });
    const markup = renderToStaticMarkup(createElement(ConnectionCentre));
    expect(markup).toContain('data-connections-load-state="empty"');
    expect(markup).toContain("No governed synthetic v1 inventory");
    expect(markup).toContain("no connection state was inferred");
    expect(markup).not.toContain("Local WhatsApp journey simulator");
  });

  it.each(["denied", "invalid_response", "error"] as const)(
    "renders sanitized %s state with an accessible retry and no retained rows",
    (status) => {
      harness.useConnectionCentre.mockReturnValue({
        status,
        inventory: null,
        message: "Sanitized authoritative-read failure.",
        retry: vi.fn(),
      });
      const markup = renderToStaticMarkup(createElement(ConnectionCentre));
      expect(markup).toContain('role="alert"');
      expect(markup).toContain("Sanitized authoritative-read failure");
      expect(markup).toContain("Retry authoritative read");
      expect(markup).not.toContain("Local WhatsApp journey simulator");
    },
  );
});

describe("connection-centre source boundary", () => {
  it("contains no Firestore query, fixture, cache, mutation, or legacy environment catalogue", () => {
    const componentSource = readFileSync(
      "components/connections/connection-centre.tsx",
      "utf8",
    );
    const hookSource = readFileSync(
      "components/connections/use-connection-centre.ts",
      "utf8",
    );
    const dataSource = readFileSync(
      "components/connections/connection-centre-data.ts",
      "utf8",
    );
    const componentSources = [componentSource, hookSource, dataSource].join("\n");
    const moduleSource = readFileSync(
      "app/(portal)/_data/module-configs.ts",
      "utf8",
    );
    const connectionsBlock = moduleSource.slice(
      moduleSource.indexOf("  connections: {"),
      moduleSource.indexOf("  team: {"),
    );

    expect(hookSource).toContain("loadDemoConnectionCentre");
    expect(hookSource).toContain("getLocalEmulatorFirestore");
    for (const forbidden of [
      'from "firebase/firestore"',
      "getDocs",
      "collection(",
      "query(",
      "onSnapshot",
      "lib/demo",
      "connectionGates",
      "environmentLabels",
      "Connected UAT",
      "Connect production asset",
      "credentialSecretRef",
      "accessToken",
      "endpointUrl",
    ]) {
      expect(componentSources).not.toContain(forbidden);
      expect(connectionsBlock).not.toContain(forbidden);
    }
  });
});
