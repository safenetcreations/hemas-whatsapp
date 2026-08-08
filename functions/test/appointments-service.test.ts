import assert from "node:assert/strict";
import test from "node:test";
import type {
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Transaction,
} from "firebase-admin/firestore";
import type { RuntimeConfig } from "../src/config.js";
import { deterministicId } from "../src/deterministic.js";
import {
  assertSyntheticAppointmentRuntimeBoundary,
  parseSyntheticAppointmentRequestInput,
  type SyntheticAppointmentRequestInput,
} from "../src/appointments/contracts.js";
import { requestSyntheticAppointmentAction } from "../src/appointments/service.js";
import { idempotencyDocumentId } from "../src/service-kernel.js";

type MemoryRecord = Readonly<Record<string, unknown>>;

class MemoryAdminTransactionStore {
  readonly records = new Map<string, MemoryRecord>();
  readonly db: Firestore;

  constructor() {
    this.db = {
      doc: (path: string) => ({ path }) as DocumentReference,
      runTransaction: async <T>(handler: (transaction: Transaction) => Promise<T>) => {
        const staged = new Map(this.records);
        const transaction = {
          get: async (reference: DocumentReference) => {
            const path = reference.path;
            const value = staged.get(path);
            return {
              exists: value !== undefined,
              data: () => value,
              ref: reference,
              id: path.split("/").at(-1) ?? "",
            } as unknown as DocumentSnapshot;
          },
          create: (reference: DocumentReference, data: DocumentData) => {
            if (staged.has(reference.path)) {
              throw new Error(`create conflict: ${reference.path}`);
            }
            staged.set(reference.path, data);
            return transaction;
          },
          update: (reference: DocumentReference, data: DocumentData) => {
            const current = staged.get(reference.path);
            if (!current) throw new Error(`missing update target: ${reference.path}`);
            staged.set(reference.path, { ...current, ...data });
            return transaction;
          },
        } as unknown as Transaction;
        const result = await handler(transaction);
        this.records.clear();
        for (const [path, value] of staged) this.records.set(path, value);
        return result;
      },
    } as unknown as Firestore;
  }
}

const NOW = new Date("2026-08-07T12:00:00.000Z");
const WORKSPACE_ID = "workspace_safenet_demo";
const APPOINTMENT_ID = "appointment_synthetic_001";
const TEAM_ID = "team_demo_general";
const LOCATION_ID = "location_demo_wattala";
const ACTOR_UID = "synthetic-agent-001";

const runtimeConfig: RuntimeConfig = {
  runtimeMode: "demo",
  defaultTenantId: WORKSPACE_ID,
  providerMode: "synthetic",
  hemasIntegrationMode: "synthetic",
  auditSinkMode: "durable",
  outboundEnabled: false,
  approvalGateRequired: true,
  diagnosisEnabled: false,
  syntheticSeed: "hemas-connect-demo-v1",
  liveActivation: {
    id: undefined,
    approvedBy: undefined,
    expiresAt: undefined,
  },
};

const request: SyntheticAppointmentRequestInput = {
  workspaceId: WORKSPACE_ID,
  appointmentId: APPOINTMENT_ID,
  teamId: TEAM_ID,
  locationId: LOCATION_ID,
  action: "request_reschedule",
  expectedRevision: 0,
  idempotencyKey: "appointment-request-00000001",
};

function appointment(overrides: MemoryRecord = {}): MemoryRecord {
  return {
    id: APPOINTMENT_ID,
    workspaceId: WORKSPACE_ID,
    conversationId: "conversation_synthetic_appointment",
    contactId: "contact_synthetic_appointment",
    teamId: TEAM_ID,
    locationId: LOCATION_ID,
    externalAppointmentRef: "DEMO-APT-0001",
    serviceRef: "demo-general-medicine",
    practitionerDisplayLabel: "Synthetic clinician schedule",
    slotStartsAt: new Date("2026-08-12T04:30:00.000Z"),
    slotEndsAt: new Date("2026-08-12T05:00:00.000Z"),
    slotTimeZone: "Asia/Colombo",
    status: "confirmed",
    syncState: "mock",
    reminderState: {
      confirmation: "simulated",
      twentyFourHour: "scheduled",
      twoHour: "scheduled",
    },
    authoritativeSystem: "simulator",
    lastSyncedAt: new Date("2026-08-07T10:00:00.000Z"),
    revision: 0,
    lastActionId: null,
    synthetic: true,
    schemaVersion: 1,
    createdAt: new Date("2026-08-07T10:00:00.000Z"),
    updatedAt: new Date("2026-08-07T10:00:00.000Z"),
    ...overrides,
  };
}

function seedStore(input: {
  readonly membership?: MemoryRecord;
  readonly team?: MemoryRecord;
  readonly location?: MemoryRecord;
  readonly appointment?: MemoryRecord;
} = {}): MemoryAdminTransactionStore {
  const store = new MemoryAdminTransactionStore();
  store.records.set(`workspaces/${WORKSPACE_ID}`, {
    id: WORKSPACE_ID,
    name: "SafeNet synthetic demo",
    status: "active",
    mode: "demo",
    dataClassification: "synthetic_only",
  });
  store.records.set(`workspaces/${WORKSPACE_ID}/members/${ACTOR_UID}`, input.membership ?? {
    id: ACTOR_UID,
    uid: ACTOR_UID,
    workspaceId: WORKSPACE_ID,
    role: "agent",
    status: "active",
    teamIds: [TEAM_ID],
    locationIds: [LOCATION_ID],
  });
  store.records.set(`workspaces/${WORKSPACE_ID}/teams/${TEAM_ID}`, input.team ?? {
    id: TEAM_ID,
    workspaceId: WORKSPACE_ID,
    name: "General patient services",
    locationIds: [LOCATION_ID],
    active: true,
  });
  store.records.set(
    `workspaces/${WORKSPACE_ID}/locations/${LOCATION_ID}`,
    input.location ?? {
      id: LOCATION_ID,
      workspaceId: WORKSPACE_ID,
      name: "Demo Hospital — Wattala",
      active: true,
    },
  );
  store.records.set(
    `workspaces/${WORKSPACE_ID}/appointments/${APPOINTMENT_ID}`,
    input.appointment ?? appointment(),
  );
  return store;
}

function actor(uid = ACTOR_UID) {
  return { uid, authTime: new Date(NOW.getTime() - 60_000) };
}

function hasCode(expected: string): (error: unknown) => boolean {
  return (error: unknown) =>
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { readonly code: unknown }).code === expected;
}

function paths(store: MemoryAdminTransactionStore, collection: string): readonly string[] {
  const marker = `/${collection}/`;
  return [...store.records.keys()].filter((path) => path.includes(marker));
}

test("appointment callable input is exact, metadata-only and action allowlisted", () => {
  assert.deepEqual(parseSyntheticAppointmentRequestInput(request), request);
  for (const invalid of [
    { ...request, messageBody: "not accepted" },
    { ...request, patientPhone: "+94000000000" },
    { ...request, action: "confirm" },
    { ...request, expectedRevision: -1 },
    { ...request, idempotencyKey: "short" },
    { ...request, appointmentId: "unsafe/path" },
  ]) {
    assert.throws(() => parseSyntheticAppointmentRequestInput(invalid), {
      code: "invalid_service_request",
    });
  }
});

test("exported service reparses its request and rejects runtime action or field bypasses", async () => {
  for (const unsafeRequest of [
    { ...request, action: "approve" },
    { ...request, unexpected: "pollution" },
  ]) {
    const store = seedStore();
    await assert.rejects(
      requestSyntheticAppointmentAction({
        db: store.db,
        config: runtimeConfig,
        actor: actor(),
        request: unsafeRequest as unknown as SyntheticAppointmentRequestInput,
        now: NOW,
      }),
      hasCode("invalid_service_request"),
    );
    assert.equal(paths(store, "appointmentEvents").length, 0);
    assert.equal(paths(store, "auditEvents").length, 0);
  }
});

test("runtime boundary requires demo, synthetic adapters, durable audit and outbound off", () => {
  assert.doesNotThrow(() =>
    assertSyntheticAppointmentRuntimeBoundary(runtimeConfig, WORKSPACE_ID),
  );
  for (const config of [
    { ...runtimeConfig, runtimeMode: "uat" as const },
    { ...runtimeConfig, providerMode: "live" as const },
    { ...runtimeConfig, hemasIntegrationMode: "disabled" as const },
    { ...runtimeConfig, auditSinkMode: "memory" as const },
    { ...runtimeConfig, outboundEnabled: true },
    { ...runtimeConfig, defaultTenantId: "workspace_other_demo" },
  ]) {
    assert.throws(
      () => assertSyntheticAppointmentRuntimeBoundary(config, WORKSPACE_ID),
      { code: "appointment_service_disabled" },
    );
  }
});

test("atomically persists a pending request, immutable event, replay key and redacted audit", async () => {
  const store = seedStore();
  const response = await requestSyntheticAppointmentAction({
    db: store.db,
    config: runtimeConfig,
    actor: actor(),
    request,
    now: NOW,
  });
  assert.equal(response.replayed, false);
  assert.deepEqual(response.result, {
    appointmentId: APPOINTMENT_ID,
    eventId: response.result.eventId,
    action: "request_reschedule",
    status: "reschedule_pending",
    syncState: "pending",
    authoritativeSystem: "simulator",
    revision: 1,
    synthetic: true,
    externalCalls: 0,
  });

  const updated = store.records.get(
    `workspaces/${WORKSPACE_ID}/appointments/${APPOINTMENT_ID}`,
  );
  assert.deepEqual(
    {
      status: updated?.status,
      syncState: updated?.syncState,
      revision: updated?.revision,
      lastActionId: updated?.lastActionId,
      updatedAt: updated?.updatedAt,
    },
    {
      status: "reschedule_pending",
      syncState: "pending",
      revision: 1,
      lastActionId: response.result.eventId,
      updatedAt: NOW,
    },
  );
  assert.equal(paths(store, "appointmentEvents").length, 1);
  assert.equal(paths(store, "idempotencyKeys").length, 1);
  assert.equal(paths(store, "auditEvents").length, 1);

  const event = store.records.get(paths(store, "appointmentEvents")[0] ?? "");
  assert.deepEqual(
    {
      id: event?.id,
      actorUid: event?.actorUid,
      action: event?.action,
      fromStatus: event?.fromStatus,
      toStatus: event?.toStatus,
      revision: event?.revision,
      source: event?.source,
    },
    {
      id: response.result.eventId,
      actorUid: ACTOR_UID,
      action: "request_reschedule",
      fromStatus: "confirmed",
      toStatus: "reschedule_pending",
      revision: 1,
      source: "authenticated_client",
    },
  );

  const audit = store.records.get(paths(store, "auditEvents")[0] ?? "");
  assert.equal(audit?.id, response.auditEventId);
  assert.deepEqual(audit?.metadata, {
    purpose: "appointment_service",
    appointmentAction: "request_reschedule",
    fromStatus: "confirmed",
    toStatus: "reschedule_pending",
    revision: 1,
    teamId: TEAM_ID,
    locationId: LOCATION_ID,
    synthetic: true,
    authoritativeSystem: "simulator",
  });
  const serializedAudit = JSON.stringify(audit);
  assert.doesNotMatch(serializedAudit, /contact|conversation|phone|message|patient/i);
});

test("replays the identical request without another domain or audit write", async () => {
  const store = seedStore();
  const first = await requestSyntheticAppointmentAction({
    db: store.db,
    config: runtimeConfig,
    actor: actor(),
    request,
    now: NOW,
  });
  const count = store.records.size;
  const second = await requestSyntheticAppointmentAction({
    db: store.db,
    config: runtimeConfig,
    actor: actor(),
    request,
    now: new Date(NOW.getTime() + 30_000),
  });
  assert.deepEqual(second, { ...first, replayed: true });
  assert.equal(store.records.size, count);
  assert.equal(paths(store, "appointmentEvents").length, 1);
  assert.equal(paths(store, "auditEvents").length, 1);
});

test("rejects idempotency substitution and preserves the first committed request", async () => {
  const store = seedStore();
  await requestSyntheticAppointmentAction({
    db: store.db,
    config: runtimeConfig,
    actor: actor(),
    request,
    now: NOW,
  });
  const count = store.records.size;
  await assert.rejects(
    requestSyntheticAppointmentAction({
      db: store.db,
      config: runtimeConfig,
      actor: actor(),
      request: { ...request, expectedRevision: 1 },
      now: new Date(NOW.getTime() + 30_000),
    }),
    hasCode("idempotency_conflict"),
  );
  assert.equal(store.records.size, count);
  assert.equal(
    store.records.get(`workspaces/${WORKSPACE_ID}/appointments/${APPOINTMENT_ID}`)
      ?.status,
    "reschedule_pending",
  );
});

test("optimistic revision conflict creates no event, idempotency key or audit", async () => {
  const store = seedStore();
  await assert.rejects(
    requestSyntheticAppointmentAction({
      db: store.db,
      config: runtimeConfig,
      actor: actor(),
      request: { ...request, expectedRevision: 4 },
      now: NOW,
    }),
    hasCode("appointment_revision_conflict"),
  );
  assert.equal(paths(store, "appointmentEvents").length, 0);
  assert.equal(paths(store, "idempotencyKeys").length, 0);
  assert.equal(paths(store, "auditEvents").length, 0);
  assert.equal(
    store.records.get(`workspaces/${WORKSPACE_ID}/appointments/${APPOINTMENT_ID}`)
      ?.revision,
    0,
  );
});

test("authorization fails closed for wrong role, revoked identity, scope and inactive route", async () => {
  const cases = [
    seedStore({
      membership: {
        id: ACTOR_UID,
        uid: ACTOR_UID,
        workspaceId: WORKSPACE_ID,
        role: "analyst",
        status: "active",
        teamIds: [TEAM_ID],
        locationIds: [LOCATION_ID],
      },
    }),
    seedStore({
      membership: {
        id: ACTOR_UID,
        uid: ACTOR_UID,
        workspaceId: WORKSPACE_ID,
        role: "agent",
        status: "revoked",
        teamIds: [TEAM_ID],
        locationIds: [LOCATION_ID],
      },
    }),
    seedStore({
      membership: {
        id: ACTOR_UID,
        uid: ACTOR_UID,
        workspaceId: WORKSPACE_ID,
        role: "agent",
        status: "active",
        teamIds: ["team_other"],
        locationIds: [LOCATION_ID],
      },
    }),
    seedStore({
      team: {
        id: TEAM_ID,
        workspaceId: WORKSPACE_ID,
        locationIds: [LOCATION_ID],
        active: false,
      },
    }),
  ];
  const expectedCodes = ["role_denied", "membership_denied", "scope_denied", "scope_denied"];
  for (const [index, store] of cases.entries()) {
    await assert.rejects(
      requestSyntheticAppointmentAction({
        db: store.db,
        config: runtimeConfig,
        actor: actor(),
        request,
        now: NOW,
      }),
      hasCode(expectedCodes[index] ?? ""),
    );
    assert.equal(paths(store, "auditEvents").length, 0);
  }
});

test("tenant admin is workspace-wide while supervisor remains exact-route scoped", async () => {
  const memberships: readonly MemoryRecord[] = [
    {
      id: ACTOR_UID,
      uid: ACTOR_UID,
      workspaceId: WORKSPACE_ID,
      role: "tenant_admin",
      status: "active",
      teamIds: [],
      locationIds: [],
    },
    {
      id: ACTOR_UID,
      uid: ACTOR_UID,
      workspaceId: WORKSPACE_ID,
      role: "supervisor",
      status: "active",
      teamIds: [TEAM_ID],
      locationIds: [LOCATION_ID],
    },
  ];
  for (const membership of memberships) {
    const store = seedStore({ membership });
    const response = await requestSyntheticAppointmentAction({
      db: store.db,
      config: runtimeConfig,
      actor: actor(),
      request,
      now: NOW,
    });
    assert.equal(response.result.status, "reschedule_pending");
  }

  const wrongUidStore = seedStore();
  await assert.rejects(
    requestSyntheticAppointmentAction({
      db: wrongUidStore.db,
      config: runtimeConfig,
      actor: actor("different-authenticated-uid"),
      request,
      now: NOW,
    }),
    hasCode("membership_denied"),
  );
  assert.equal(paths(wrongUidStore, "appointmentEvents").length, 0);
});

test("non-active, non-synthetic, non-simulator and schema-polluted appointments are denied", async () => {
  const variants = [
    appointment({ status: "cancel_pending" }),
    appointment({ synthetic: false }),
    appointment({ authoritativeSystem: "hemas_appointment_system" }),
    appointment({ diagnosis: "not allowed" }),
    appointment({ practitionerDisplayLabel: "unsafe\u0000label" }),
  ];
  for (const value of variants) {
    const store = seedStore({ appointment: value });
    await assert.rejects(
      requestSyntheticAppointmentAction({
        db: store.db,
        config: runtimeConfig,
        actor: actor(),
        request,
        now: NOW,
      }),
      hasCode("appointment_denied"),
    );
    assert.equal(paths(store, "appointmentEvents").length, 0);
    assert.equal(paths(store, "auditEvents").length, 0);
  }
});

test("cancellation is the only other allowed transition and remains simulator-pending", async () => {
  const store = seedStore();
  const cancellation = {
    ...request,
    action: "request_cancellation" as const,
    idempotencyKey: "appointment-request-00000002",
  };
  const response = await requestSyntheticAppointmentAction({
    db: store.db,
    config: runtimeConfig,
    actor: actor(),
    request: cancellation,
    now: NOW,
  });
  assert.equal(response.result.status, "cancel_pending");
  assert.equal(response.result.externalCalls, 0);
  assert.equal(
    store.records.get(`workspaces/${WORKSPACE_ID}/appointments/${APPOINTMENT_ID}`)
      ?.status,
    "cancel_pending",
  );
});

test("a pre-existing deterministic event collision rolls back every staged write", async () => {
  const store = seedStore();
  const idempotencyId = idempotencyDocumentId({
    workspaceId: WORKSPACE_ID,
    uid: ACTOR_UID,
    action: "appointment.request_reschedule",
    key: request.idempotencyKey,
  });
  const eventId = deterministicId("appointment-event", idempotencyId);
  store.records.set(`workspaces/${WORKSPACE_ID}/appointmentEvents/${eventId}`, {
    id: eventId,
    collision: true,
  });
  const before = store.records.size;
  await assert.rejects(
    requestSyntheticAppointmentAction({
      db: store.db,
      config: runtimeConfig,
      actor: actor(),
      request,
      now: NOW,
    }),
    hasCode("appointment_event_collision"),
  );
  assert.equal(store.records.size, before);
  assert.equal(paths(store, "idempotencyKeys").length, 0);
  assert.equal(paths(store, "auditEvents").length, 0);
});

test("replay fails closed if durable audit evidence is missing or altered", async () => {
  const store = seedStore();
  await requestSyntheticAppointmentAction({
    db: store.db,
    config: runtimeConfig,
    actor: actor(),
    request,
    now: NOW,
  });
  const auditPath = paths(store, "auditEvents")[0];
  assert.ok(auditPath);
  const audit = store.records.get(auditPath);
  assert.ok(audit);
  store.records.set(auditPath, {
    ...audit,
    metadata: { ...(audit.metadata as MemoryRecord), purpose: "different_purpose" },
  });
  await assert.rejects(
    requestSyntheticAppointmentAction({
      db: store.db,
      config: runtimeConfig,
      actor: actor(),
      request,
      now: new Date(NOW.getTime() + 30_000),
    }),
    hasCode("idempotency_conflict"),
  );
  assert.equal(paths(store, "appointmentEvents").length, 1);
  assert.equal(paths(store, "auditEvents").length, 1);
});

test("replay rejects polluted, misjoined or revision-substituted durable evidence", async () => {
  const mutations: readonly ((store: MemoryAdminTransactionStore) => void)[] = [
    (store) => {
      const path = paths(store, "idempotencyKeys")[0] ?? "";
      const record = store.records.get(path) ?? {};
      store.records.set(path, { ...record, unexpected: "pollution" });
    },
    (store) => {
      const path = paths(store, "idempotencyKeys")[0] ?? "";
      const record = store.records.get(path) ?? {};
      store.records.set(path, {
        ...record,
        result: { ...(record.result as MemoryRecord), revision: 2 },
      });
    },
    (store) => {
      const path = paths(store, "idempotencyKeys")[0] ?? "";
      const record = store.records.get(path) ?? {};
      store.records.set(path, { ...record, createdAt: "patient content is forbidden" });
    },
    (store) => {
      const path = paths(store, "appointmentEvents")[0] ?? "";
      const record = store.records.get(path) ?? {};
      store.records.set(path, { ...record, contactId: "contact_other_synthetic" });
    },
    (store) => {
      const path = `workspaces/${WORKSPACE_ID}/appointments/${APPOINTMENT_ID}`;
      const record = store.records.get(path) ?? {};
      store.records.set(path, {
        ...record,
        updatedAt: new Date(NOW.getTime() + 1_000),
      });
    },
    (store) => {
      const path = `workspaces/${WORKSPACE_ID}/appointments/${APPOINTMENT_ID}`;
      const record = store.records.get(path) ?? {};
      store.records.set(path, { ...record, slotStartsAt: "patient content is forbidden" });
    },
  ];

  for (const mutate of mutations) {
    const store = seedStore();
    await requestSyntheticAppointmentAction({
      db: store.db,
      config: runtimeConfig,
      actor: actor(),
      request,
      now: NOW,
    });
    mutate(store);
    await assert.rejects(
      requestSyntheticAppointmentAction({
        db: store.db,
        config: runtimeConfig,
        actor: actor(),
        request,
        now: new Date(NOW.getTime() + 30_000),
      }),
      hasCode("idempotency_conflict"),
    );
    assert.equal(paths(store, "appointmentEvents").length, 1);
    assert.equal(paths(store, "auditEvents").length, 1);
  }
});
