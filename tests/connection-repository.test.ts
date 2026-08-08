import { Timestamp, type Firestore } from "firebase/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const firestoreSpies = vi.hoisted(() => ({
  doc: vi.fn((database: unknown, ...path: string[]) => ({
    kind: "document",
    database,
    path,
  })),
  getDocFromServer: vi.fn(),
  collection: vi.fn(),
  query: vi.fn(),
  getDocsFromServer: vi.fn(),
}));

vi.mock("firebase/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("firebase/firestore")>();
  return {
    ...actual,
    doc: firestoreSpies.doc,
    getDocFromServer: firestoreSpies.getDocFromServer,
    collection: firestoreSpies.collection,
    query: firestoreSpies.query,
    getDocsFromServer: firestoreSpies.getDocsFromServer,
  };
});

import {
  DEMO_INTEGRATION_BINDINGS,
  DEMO_INTEGRATION_IDS,
  DEMO_WHATSAPP_SIGNAL_KEYS,
  DEMO_WHATSAPP_SIGNAL_MATRIX,
  type DemoIntegrationId,
} from "@/lib/domain/connections";
import {
  ConnectionRepositoryError,
  loadDemoConnectionCentre,
} from "@/lib/firebase/repositories/connection-repository";

const db = {} as Firestore;
const workspaceId = "workspace_safenet_demo" as const;
const createdAt = Timestamp.fromDate(new Date("2026-08-08T08:00:00.000Z"));
const observedAt = Timestamp.fromDate(new Date("2026-08-08T08:05:00.000Z"));
const updatedAt = Timestamp.fromDate(new Date("2026-08-08T08:10:00.000Z"));

function evidence(
  binding: {
    readonly state: string;
    readonly source: string;
    readonly detailCode: string;
  },
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    ...binding,
    observedAt,
    lastSuccessfulVerificationAt: null,
    ...overrides,
  };
}

function whatsappDocument(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: "connection_demo_simulator",
    workspaceId,
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
    ...overrides,
  };
}

function integrationDocument(
  id: DemoIntegrationId,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  const binding = DEMO_INTEGRATION_BINDINGS[id];
  return {
    id,
    workspaceId,
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
    ...overrides,
  };
}

interface SnapshotStub {
  readonly id: string;
  readonly exists: () => boolean;
  readonly data: () => Readonly<Record<string, unknown>> | undefined;
}

function presentSnapshot(
  id: string,
  data: Readonly<Record<string, unknown>>,
): SnapshotStub {
  return {
    id,
    exists: () => true,
    data: () => data,
  };
}

function whatsappSnapshot(
  data: Readonly<Record<string, unknown>> = whatsappDocument(),
  documentId = "connection_demo_simulator",
): SnapshotStub {
  return presentSnapshot(documentId, data);
}

function integrationSnapshot(
  id: DemoIntegrationId,
  data: Readonly<Record<string, unknown>> = integrationDocument(id),
  documentId: string = id,
): SnapshotStub {
  return presentSnapshot(documentId, data);
}

function missingSnapshot(id: string): SnapshotStub {
  return {
    id,
    exists: () => false,
    data: () => undefined,
  };
}

function arrange(
  whatsapp = whatsappSnapshot(),
  his = integrationSnapshot("integration_demo_his_simulator"),
  lims = integrationSnapshot("integration_demo_lims_simulator"),
): void {
  firestoreSpies.getDocFromServer
    .mockResolvedValueOnce(whatsapp)
    .mockResolvedValueOnce(his)
    .mockResolvedValueOnce(lims);
}

async function expectInvalid(
  whatsapp = whatsappSnapshot(),
  his = integrationSnapshot("integration_demo_his_simulator"),
  lims = integrationSnapshot("integration_demo_lims_simulator"),
): Promise<void> {
  arrange(whatsapp, his, lims);
  await expect(
    loadDemoConnectionCentre(db, { workspaceId }),
  ).rejects.toMatchObject({
    name: "ConnectionRepositoryError",
    code: "invalid_persisted_data",
  } satisfies Partial<ConnectionRepositoryError>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("staff-safe connection repository", () => {
  it("issues exactly three fixed-path authoritative reads concurrently", async () => {
    let resolveWhatsApp: ((value: ReturnType<typeof whatsappSnapshot>) => void) | undefined;
    const pendingWhatsApp = new Promise<ReturnType<typeof whatsappSnapshot>>((resolve) => {
      resolveWhatsApp = resolve;
    });
    firestoreSpies.getDocFromServer
      .mockImplementationOnce(() => pendingWhatsApp)
      .mockResolvedValueOnce(integrationSnapshot("integration_demo_his_simulator"))
      .mockResolvedValueOnce(integrationSnapshot("integration_demo_lims_simulator"));

    const pending = loadDemoConnectionCentre(db, { workspaceId });
    expect(firestoreSpies.getDocFromServer).toHaveBeenCalledTimes(3);
    resolveWhatsApp?.(whatsappSnapshot());
    await pending;

    expect(firestoreSpies.doc).toHaveBeenNthCalledWith(
      1,
      db,
      "workspaces",
      workspaceId,
      "whatsappConnections",
      "connection_demo_simulator",
    );
    expect(firestoreSpies.doc).toHaveBeenNthCalledWith(
      2,
      db,
      "workspaces",
      workspaceId,
      "integrations",
      "integration_demo_his_simulator",
    );
    expect(firestoreSpies.doc).toHaveBeenNthCalledWith(
      3,
      db,
      "workspaces",
      workspaceId,
      "integrations",
      "integration_demo_lims_simulator",
    );
    expect(firestoreSpies.collection).not.toHaveBeenCalled();
    expect(firestoreSpies.query).not.toHaveBeenCalled();
    expect(firestoreSpies.getDocsFromServer).not.toHaveBeenCalled();
  });

  it("returns exactly one WhatsApp and two immutable integration DTOs", async () => {
    arrange();
    const result = await loadDemoConnectionCentre(db, { workspaceId });

    expect(result.whatsappConnections).toHaveLength(1);
    expect(result.integrations.map((item) => item.id)).toEqual(DEMO_INTEGRATION_IDS);
    expect(result.whatsappConnections[0]).toMatchObject({
      id: "connection_demo_simulator",
      maskedWabaId: null,
      maskedPhoneNumberId: null,
      externalMessagingEnabled: false,
      networkCallsEnabled: false,
      createdAt: "2026-08-08T08:00:00.000Z",
      updatedAt: "2026-08-08T08:10:00.000Z",
    });
    expect(result.integrations.every((item) => !item.externalNetworkEnabled)).toBe(true);
    expect(
      result.integrations.every((item) => !item.authoritativeSystemWriteEnabled),
    ).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.whatsappConnections)).toBe(true);
    expect(Object.isFrozen(result.whatsappConnections[0]?.signals)).toBe(true);
    expect(Object.isFrozen(result.whatsappConnections[0]?.signals.waba)).toBe(true);
    expect(Object.isFrozen(result.integrations)).toBe(true);
    expect(Object.isFrozen(result.integrations[0]?.evidence)).toBe(true);

    const serialized = JSON.stringify(result);
    for (const forbiddenKey of [
      "providerPhoneNumberId",
      "phoneNumberId",
      "wabaId",
      "credentialSecretRef",
      "accessToken",
      "endpointUrl",
      "health",
      "lastError",
    ]) {
      expect(serialized).not.toContain(`\"${forbiddenKey}\"`);
    }
  });

  it("returns an honest immutable empty state when all three fixed records are absent", async () => {
    arrange(
      missingSnapshot("connection_demo_simulator"),
      missingSnapshot("integration_demo_his_simulator"),
      missingSnapshot("integration_demo_lims_simulator"),
    );
    const result = await loadDemoConnectionCentre(db, { workspaceId });
    expect(result).toEqual({ whatsappConnections: [], integrations: [] });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.whatsappConnections)).toBe(true);
    expect(Object.isFrozen(result.integrations)).toBe(true);
  });

  it("rejects unsafe workspace input before any Firestore read", async () => {
    await expect(
      loadDemoConnectionCentre(db, { workspaceId: "workspace_other" } as never),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      loadDemoConnectionCentre(db, { workspaceId, extra: true } as never),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(firestoreSpies.getDocFromServer).not.toHaveBeenCalled();
  });

  it("rejects every partial-presence permutation", async () => {
    for (let presenceMask = 1; presenceMask < 7; presenceMask += 1) {
      await expectInvalid(
        presenceMask & 1
          ? whatsappSnapshot()
          : missingSnapshot("connection_demo_simulator"),
        presenceMask & 2
          ? integrationSnapshot("integration_demo_his_simulator")
          : missingSnapshot("integration_demo_his_simulator"),
        presenceMask & 4
          ? integrationSnapshot("integration_demo_lims_simulator")
          : missingSnapshot("integration_demo_lims_simulator"),
      );
      vi.clearAllMocks();
    }
  });

  it("strictly parses an existing polluted record before rejecting a partial inventory", async () => {
    arrange(
      whatsappSnapshot(whatsappDocument({ credentialSecretRef: "secret://forbidden" })),
      missingSnapshot("integration_demo_his_simulator"),
      missingSnapshot("integration_demo_lims_simulator"),
    );
    await expect(
      loadDemoConnectionCentre(db, { workspaceId }),
    ).rejects.toMatchObject({
      code: "invalid_persisted_data",
      message: "WhatsApp connection failed strict staff-safe v1 validation.",
    });
  });

  it("rejects path, tenant, native-timestamp and chronology attacks", async () => {
    const attacks: readonly [
      ReturnType<typeof whatsappSnapshot>,
      ReturnType<typeof integrationSnapshot>,
      ReturnType<typeof integrationSnapshot>,
    ][] = [
      [
        whatsappSnapshot(whatsappDocument(), "connection_other"),
        integrationSnapshot("integration_demo_his_simulator"),
        integrationSnapshot("integration_demo_lims_simulator"),
      ],
      [
        whatsappSnapshot(whatsappDocument({ workspaceId: "workspace_other" })),
        integrationSnapshot("integration_demo_his_simulator"),
        integrationSnapshot("integration_demo_lims_simulator"),
      ],
      [
        whatsappSnapshot(whatsappDocument({ createdAt: new Date(createdAt.toMillis()) })),
        integrationSnapshot("integration_demo_his_simulator"),
        integrationSnapshot("integration_demo_lims_simulator"),
      ],
      [
        whatsappSnapshot(
          whatsappDocument({ createdAt: new Timestamp(createdAt.seconds, 1) }),
        ),
        integrationSnapshot("integration_demo_his_simulator"),
        integrationSnapshot("integration_demo_lims_simulator"),
      ],
      [
        whatsappSnapshot(whatsappDocument({ updatedAt: Timestamp.fromMillis(createdAt.toMillis() - 1) })),
        integrationSnapshot("integration_demo_his_simulator"),
        integrationSnapshot("integration_demo_lims_simulator"),
      ],
      [
        whatsappSnapshot(),
        integrationSnapshot(
          "integration_demo_his_simulator",
          integrationDocument("integration_demo_his_simulator"),
          "integration_other",
        ),
        integrationSnapshot("integration_demo_lims_simulator"),
      ],
      [
        whatsappSnapshot(),
        integrationSnapshot(
          "integration_demo_his_simulator",
          integrationDocument("integration_demo_his_simulator", {
            workspaceId: "workspace_other",
          }),
        ),
        integrationSnapshot("integration_demo_lims_simulator"),
      ],
      [
        whatsappSnapshot(),
        integrationSnapshot(
          "integration_demo_his_simulator",
          integrationDocument("integration_demo_his_simulator", {
            evidence: evidence(
              {
                state: "mock",
                source: "synthetic_fixture",
                detailCode: "deterministic_his_simulator_only",
              },
              { observedAt: Timestamp.fromMillis(updatedAt.toMillis() + 1) },
            ),
          }),
        ),
        integrationSnapshot("integration_demo_lims_simulator"),
      ],
    ];

    for (const [whatsapp, his, lims] of attacks) {
      await expectInvalid(whatsapp, his, lims);
      vi.clearAllMocks();
    }
  });

  it("rejects signal substitutions and every raw secret/provider/free-form field", async () => {
    const baseSignals = whatsappDocument().signals as Record<string, Record<string, unknown>>;
    const whatsappAttacks = [
      whatsappDocument({ networkCallsEnabled: true }),
      whatsappDocument({ externalMessagingEnabled: true }),
      whatsappDocument({ providerPhoneNumberId: "raw-phone-id" }),
      whatsappDocument({ wabaId: "raw-waba-id" }),
      whatsappDocument({ credentialSecretRef: "secret://forbidden" }),
      whatsappDocument({ health: "healthy" }),
      whatsappDocument({
        signals: {
          ...baseSignals,
          sending: { ...baseSignals.sending, state: "mock" },
        },
      }),
      whatsappDocument({
        signals: {
          ...baseSignals,
          waba: { ...baseSignals.waba, detail: "provider says healthy" },
        },
      }),
    ];
    for (const attack of whatsappAttacks) {
      await expectInvalid(whatsappSnapshot(attack));
      vi.clearAllMocks();
    }

    const integrationAttacks = [
      integrationDocument("integration_demo_his_simulator", {
        kind: "laboratory_lims",
      }),
      integrationDocument("integration_demo_his_simulator", {
        sortKey: "02_lims_simulator",
      }),
      integrationDocument("integration_demo_his_simulator", {
        externalNetworkEnabled: true,
      }),
      integrationDocument("integration_demo_his_simulator", {
        authoritativeSystemWriteEnabled: true,
      }),
      integrationDocument("integration_demo_his_simulator", {
        credentialSecretRef: "secret://forbidden",
      }),
      integrationDocument("integration_demo_his_simulator", {
        endpointUrl: "https://provider.invalid",
      }),
      integrationDocument("integration_demo_his_simulator", {
        health: { message: "free-form" },
      }),
      integrationDocument("integration_demo_his_simulator", {
        displayName: "Production-ready simulator",
      }),
      integrationDocument("integration_demo_his_simulator", {
        evidence: {
          ...integrationDocument("integration_demo_his_simulator").evidence,
          detailCode: "deterministic_lims_simulator_only",
        },
      }),
    ];
    for (const attack of integrationAttacks) {
      await expectInvalid(
        whatsappSnapshot(),
        integrationSnapshot("integration_demo_his_simulator", attack),
        integrationSnapshot("integration_demo_lims_simulator"),
      );
      vi.clearAllMocks();
    }
  });
});
