import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeSyntheticIngressRoute,
  loadSyntheticIngressBoundary,
} from "../src/ingress/boundary.js";
import {
  parseSyntheticWebhookEnvelope,
  PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET,
  SYNTHETIC_WEBHOOK_SCHEMA,
  type SyntheticMessageStatus,
  type SyntheticWebhookEnvelope,
} from "../src/ingress/contracts.js";
import {
  deriveMonotonicSyntheticStatus,
  processSyntheticWebhookEvent,
  syntheticIngressDocumentIds,
  type SyntheticIngressSnapshot,
  type SyntheticIngressStore,
  type SyntheticIngressTransaction,
} from "../src/ingress/persistence.js";

function hasCode(expected: string): (error: unknown) => boolean {
  return (error: unknown) =>
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { readonly code: unknown }).code === expected;
}

class MemoryIngressStore implements SyntheticIngressStore {
  readonly records = new Map<string, Readonly<Record<string, unknown>>>();

  async runTransaction<T>(
    handler: (transaction: SyntheticIngressTransaction) => Promise<T>,
  ): Promise<T> {
    const staged = new Map(this.records);
    const transaction: SyntheticIngressTransaction = {
      get: async (path): Promise<SyntheticIngressSnapshot> => ({
        exists: staged.has(path),
        data: () => staged.get(path),
      }),
      create: (path, data) => {
        if (staged.has(path)) throw new Error(`create conflict: ${path}`);
        staged.set(path, data);
      },
      update: (path, data) => {
        const current = staged.get(path);
        if (!current) throw new Error(`missing update target: ${path}`);
        staged.set(path, { ...current, ...data });
      },
    };
    const result = await handler(transaction);
    this.records.clear();
    for (const [path, data] of staged) this.records.set(path, data);
    return result;
  }
}

const NOW = new Date("2026-08-07T12:10:00.000Z");

function authorization() {
  const boundary = loadSyntheticIngressBoundary({
    GCLOUD_PROJECT: "demo-hemas-connect",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    HEMAS_RUNTIME_MODE: "demo",
    HEMAS_PROVIDER_MODE: "synthetic",
    HEMAS_INTEGRATION_MODE: "synthetic",
    HEMAS_OUTBOUND_ENABLED: "false",
    HEMAS_DIAGNOSIS_ENABLED: "false",
    HEMAS_SYNTHETIC_INGRESS_SECRET: PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET,
  });
  return authorizeSyntheticIngressRoute(boundary, "synthetic-phone-route-wattala-demo");
}

function rawEnvelope(overrides: Readonly<Record<string, unknown>> = {}): Buffer {
  return Buffer.from(JSON.stringify({
    schema: SYNTHETIC_WEBHOOK_SCHEMA,
    version: 1,
    mode: "demo",
    eventId: "synthetic-event-pipeline-0001",
    routeRef: "synthetic-phone-route-wattala-demo",
    occurredAt: "2026-08-07T12:00:00.000Z",
    event: {
      kind: "message_inbound",
      providerMessageRef: "synthetic-message-pipeline-0001",
      contactRef: "synthetic-contact-pipeline-0001",
      scenarioCode: "appointment_request",
      textCode: "APPOINTMENT_REQUEST_EN",
      language: "en",
    },
    ...overrides,
  }), "utf8");
}

function envelope(overrides: Readonly<Record<string, unknown>> = {}): SyntheticWebhookEnvelope {
  return parseSyntheticWebhookEnvelope(rawEnvelope(overrides));
}

function requestHash(value: SyntheticWebhookEnvelope): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function statusEnvelope(
  eventId: string,
  status: SyntheticMessageStatus,
  providerMessageRef = "synthetic-message-pipeline-0001",
): SyntheticWebhookEnvelope {
  return envelope({
    eventId,
    occurredAt: "2026-08-07T12:05:00.000Z",
    event: {
      kind: "message_status",
      providerMessageRef,
      contactRef: "synthetic-contact-pipeline-0001",
      status,
      statusCode: status === "failed"
        ? "SYNTHETIC_FAILURE_SIMULATED"
        : "SYNTHETIC_STATUS_OK",
    },
  });
}

function seedSyntheticOutboundMessage(input: {
  readonly store: MemoryIngressStore;
  readonly contactEnvelope: SyntheticWebhookEnvelope;
  readonly providerMessageRef: string;
}): void {
  const status = statusEnvelope(
    "synthetic-event-outbound-seed-placeholder",
    "sent",
    input.providerMessageRef,
  );
  const ids = syntheticIngressDocumentIds(authorization(), status);
  const contactIds = syntheticIngressDocumentIds(authorization(), input.contactEnvelope);
  input.store.records.set(
    `workspaces/workspace_safenet_demo/messages/${ids.messageId}`,
    {
      id: ids.messageId,
      workspaceId: "workspace_safenet_demo",
      conversationId: contactIds.conversationId,
      contactId: contactIds.contactId,
      teamId: "team_demo_general",
      locationId: "location_demo_wattala",
      direction: "outbound",
      type: "interactive",
      status: "sent",
      externalDispatch: "simulation_only",
      actorId: null,
      receivedAt: null,
      sentAt: new Date("2026-08-07T12:02:00.000Z"),
      deliveredAt: null,
      metadataOnly: true,
      synthetic: true,
      schemaVersion: 1,
      createdAt: new Date("2026-08-07T12:02:00.000Z"),
      updatedAt: new Date("2026-08-07T12:02:00.000Z"),
    },
  );
}

function stopEnvelope(input: {
  readonly eventId: string;
  readonly providerMessageRef: string;
  readonly occurredAt?: string;
}): SyntheticWebhookEnvelope {
  return envelope({
    eventId: input.eventId,
    occurredAt: input.occurredAt ?? "2026-08-07T12:08:00.000Z",
    event: {
      kind: "message_inbound",
      providerMessageRef: input.providerMessageRef,
      contactRef: "synthetic-contact-pipeline-0001",
      scenarioCode: "stop_request",
      textCode: "STOP_REQUEST_EN",
      language: "en",
    },
  });
}

function seedWorkspace(store: MemoryIngressStore, mode = "demo"): void {
  store.records.set("workspaces/workspace_safenet_demo", {
    id: "workspace_safenet_demo",
    name: "Synthetic ingress test workspace",
    status: "active",
    mode,
    dataClassification: "synthetic_only",
  });
  store.records.set("phoneRoutes/synthetic-phone-route-wattala-demo", {
    id: "synthetic-phone-route-wattala-demo",
    routeRef: "synthetic-phone-route-wattala-demo",
    workspaceId: "workspace_safenet_demo",
    connectionId: "connection_demo_simulator",
    teamId: "team_demo_general",
    locationId: "location_demo_wattala",
    active: true,
    synthetic: true,
    schemaVersion: 1,
    createdAt: new Date("2026-08-07T10:00:00.000Z"),
    updatedAt: new Date("2026-08-07T10:00:00.000Z"),
  });
}

async function process(
  store: MemoryIngressStore,
  value: SyntheticWebhookEnvelope,
  receivedAt = NOW,
) {
  const authorized = authorization();
  return processSyntheticWebhookEvent({
    store,
    authorization: authorized,
    envelope: value,
    requestHash: requestHash(value),
    receivedAt,
  });
}

test("creates tenant-scoped contact, conversation, inbound message and webhook receipt atomically", async () => {
  const store = new MemoryIngressStore();
  seedWorkspace(store);
  const value = envelope();
  const authorized = authorization();
  const ids = syntheticIngressDocumentIds(authorized, value);
  const result = await processSyntheticWebhookEvent({
    store,
    authorization: authorized,
    envelope: value,
    requestHash: requestHash(value),
    receivedAt: NOW,
  });
  assert.deepEqual(result, {
    receiptId: ids.webhookEventId,
    eventKind: "message_inbound",
    action: "inbound_message_created",
    replayed: false,
    duplicate: false,
    stateChanged: true,
    currentStatus: "received",
    synthetic: true,
    networkCalls: 0,
  });

  const root = "workspaces/workspace_safenet_demo";
  const contact = store.records.get(`${root}/contacts/${ids.contactId}`);
  const contactSecret = store.records.get(`${root}/contactSecrets/${ids.contactId}`);
  const conversation = store.records.get(`${root}/conversations/${ids.conversationId}`);
  const message = store.records.get(`${root}/messages/${ids.messageId}`);
  const receipt = store.records.get(`${root}/webhookEvents/${ids.webhookEventId}`);
  assert.equal(contact?.maskedPhone, "Synthetic fixture contact · no phone stored");
  assert.equal("phoneLookupHmac" in (contact ?? {}), false);
  assert.equal("encryptedPhoneRef" in (contact ?? {}), false);
  assert.equal("encryptedDisplayNameRef" in (contact ?? {}), false);
  assert.equal("externalPatientRef" in (contact ?? {}), false);
  assert.match(String(contactSecret?.phoneLookupHmac), /^[a-f0-9]{64}$/);
  assert.match(String(contactSecret?.encryptedPhoneRef), /^demo:\/\/protected-phone-ref\//);
  assert.match(
    String(contactSecret?.encryptedDisplayNameRef),
    /^demo:\/\/protected-display-name-ref\//,
  );
  assert.equal(contactSecret?.externalPatientRef, null);
  assert.equal(conversation?.unreadCount, 1);
  assert.equal(message?.metadataOnly, true);
  assert.equal(message?.schemaVersion, 1);
  assert.equal(message?.status, "received");
  assert.equal(receipt?.eventKind, "message_inbound");
  assert.equal("body" in (message ?? {}), false);
  assert.equal("text" in (message ?? {}), false);
  assert.equal("safePreview" in (message ?? {}), false);
  assert.equal("phoneNumber" in (contact ?? {}), false);
  assert.equal(
    [...store.records.keys()].filter((path) => path.startsWith(`${root}/consentRecords/`)).length,
    0,
  );
  assert.deepEqual(Object.keys(contact ?? {}).sort(), [
    "alternateLanguages",
    "createdAt",
    "displayLabel",
    "id",
    "locationId",
    "maskedPhone",
    "preferenceRevision",
    "preferredLanguage",
    "suppression",
    "synthetic",
    "tags",
    "teamId",
    "updatedAt",
    "workspaceId",
  ]);
  assert.deepEqual(Object.keys(contactSecret ?? {}).sort(), [
    "contactId",
    "createdAt",
    "encryptedDisplayNameRef",
    "encryptedPhoneRef",
    "externalPatientRef",
    "id",
    "phoneLookupHmac",
    "schemaVersion",
    "synthetic",
    "updatedAt",
    "workspaceId",
  ]);
  assert.deepEqual(Object.keys(conversation ?? {}).sort(), [
    "assigneeId",
    "connectionId",
    "contactId",
    "createdAt",
    "detectedLanguage",
    "firstResponseDueAt",
    "handoffSummary",
    "id",
    "languageConfidence",
    "lastMessageAt",
    "locationId",
    "mode",
    "purpose",
    "serviceWindowExpiresAt",
    "status",
    "synthetic",
    "teamId",
    "unreadCount",
    "updatedAt",
    "workspaceId",
  ]);
  assert.deepEqual(Object.keys(message ?? {}).sort(), [
    "actorId",
    "contactId",
    "conversationId",
    "createdAt",
    "deliveredAt",
    "direction",
    "externalDispatch",
    "id",
    "locationId",
    "metadataOnly",
    "receivedAt",
    "schemaVersion",
    "sentAt",
    "status",
    "synthetic",
    "teamId",
    "type",
    "updatedAt",
    "workspaceId",
  ]);
});

test("rejects partial contact/contact-secret states without committing inbound mutations", async () => {
  const firstEnvelope = envelope();
  const firstIds = syntheticIngressDocumentIds(authorization(), firstEnvelope);
  const root = "workspaces/workspace_safenet_demo";
  const contactPath = `${root}/contacts/${firstIds.contactId}`;
  const secretPath = `${root}/contactSecrets/${firstIds.contactId}`;
  const nextEnvelope = envelope({
    eventId: "synthetic-event-contact-secret-partial-0002",
    occurredAt: "2026-08-07T12:07:00.000Z",
    event: {
      ...firstEnvelope.event,
      providerMessageRef: "synthetic-message-contact-secret-partial-0002",
    },
  });

  for (const missingPath of [contactPath, secretPath]) {
    const store = new MemoryIngressStore();
    seedWorkspace(store);
    await process(store, firstEnvelope);
    store.records.delete(missingPath);
    const before = new Map(store.records);

    await assert.rejects(
      process(store, nextEnvelope),
      hasCode("synthetic_ingress_state_invalid"),
    );
    assert.deepEqual(store.records, before);
  }
});

test("binds the server-only contact secret to the exact inbound contact reference", async () => {
  const store = new MemoryIngressStore();
  seedWorkspace(store);
  const originalEnvelope = envelope();
  await process(store, originalEnvelope);
  const originalIds = syntheticIngressDocumentIds(authorization(), originalEnvelope);
  const root = "workspaces/workspace_safenet_demo";
  const originalContact = store.records.get(`${root}/contacts/${originalIds.contactId}`);
  const originalSecret = store.records.get(
    `${root}/contactSecrets/${originalIds.contactId}`,
  );
  assert.ok(originalContact);
  assert.ok(originalSecret);

  const substitutedEnvelope = envelope({
    eventId: "synthetic-event-contact-ref-substitution-0002",
    occurredAt: "2026-08-07T12:07:00.000Z",
    event: {
      kind: "message_inbound",
      providerMessageRef: "synthetic-message-contact-ref-substitution-0002",
      contactRef: "synthetic-contact-substituted-0002",
      scenarioCode: "appointment_request",
      textCode: "APPOINTMENT_REQUEST_EN",
      language: "en",
    },
  });
  const substitutedIds = syntheticIngressDocumentIds(authorization(), substitutedEnvelope);
  store.records.set(`${root}/contacts/${substitutedIds.contactId}`, {
    ...originalContact,
    id: substitutedIds.contactId,
  });
  store.records.set(`${root}/contactSecrets/${substitutedIds.contactId}`, {
    ...originalSecret,
    id: substitutedIds.contactId,
    contactId: substitutedIds.contactId,
    encryptedPhoneRef:
      `demo://protected-phone-ref/workspace_safenet_demo/${substitutedIds.contactId}`,
    encryptedDisplayNameRef:
      `demo://protected-display-name-ref/workspace_safenet_demo/${substitutedIds.contactId}`,
  });
  const before = new Map(store.records);

  await assert.rejects(
    process(store, substitutedEnvelope),
    hasCode("synthetic_record_scope_denied"),
  );
  assert.deepEqual(store.records, before);
});

test("validates the exact contact-secret schema before processing status callbacks", async () => {
  const store = new MemoryIngressStore();
  seedWorkspace(store);
  const inbound = envelope();
  await process(store, inbound);
  const outboundRef = "synthetic-message-outbound-secret-schema-0001";
  seedSyntheticOutboundMessage({
    store,
    contactEnvelope: inbound,
    providerMessageRef: outboundRef,
  });
  const inboundIds = syntheticIngressDocumentIds(authorization(), inbound);
  const secretPath =
    `workspaces/workspace_safenet_demo/contactSecrets/${inboundIds.contactId}`;
  store.records.set(secretPath, {
    ...store.records.get(secretPath),
    unexpectedStaffReadableField: "reject",
  });
  const before = new Map(store.records);
  const delivered = statusEnvelope(
    "synthetic-event-status-secret-schema-0001",
    "delivered",
    outboundRef,
  );

  await assert.rejects(
    process(store, delivered),
    hasCode("synthetic_ingress_state_invalid"),
  );
  assert.deepEqual(store.records, before);
});

test("replays identical events and observes provider duplicates without duplicating message actions", async () => {
  const store = new MemoryIngressStore();
  seedWorkspace(store);
  const firstEnvelope = envelope();
  const first = await process(store, firstEnvelope);
  const sizeAfterFirst = store.records.size;
  const replay = await process(store, firstEnvelope);
  assert.equal(replay.replayed, true);
  assert.equal(replay.action, "inbound_message_created");
  assert.equal(store.records.size, sizeAfterFirst);

  const transportDuplicate = envelope({ eventId: "synthetic-event-pipeline-duplicate-0002" });
  const duplicate = await process(store, transportDuplicate);
  assert.equal(duplicate.replayed, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.action, "duplicate_message_observed");
  assert.equal(duplicate.stateChanged, false);
  assert.equal(store.records.size, sizeAfterFirst + 1);

  const ids = syntheticIngressDocumentIds(authorization(), firstEnvelope);
  assert.equal(
    store.records.get(
      `workspaces/workspace_safenet_demo/conversations/${ids.conversationId}`,
    )?.unreadCount,
    1,
  );
  assert.equal(first.receiptId, ids.webhookEventId);
});

test("updates an existing synthetic contact and conversation for a distinct inbound message", async () => {
  const store = new MemoryIngressStore();
  seedWorkspace(store);
  const firstEnvelope = envelope();
  await process(store, firstEnvelope);
  const secondEnvelope = envelope({
    eventId: "synthetic-event-pipeline-0002",
    occurredAt: "2026-08-07T12:07:00.000Z",
    event: {
      ...firstEnvelope.event,
      providerMessageRef: "synthetic-message-pipeline-0002",
    },
  });
  await process(store, secondEnvelope, new Date("2026-08-07T12:11:00.000Z"));
  const ids = syntheticIngressDocumentIds(authorization(), firstEnvelope);
  const root = "workspaces/workspace_safenet_demo";
  assert.equal(store.records.get(`${root}/conversations/${ids.conversationId}`)?.unreadCount, 2);
  assert.deepEqual(
    store.records.get(`${root}/contacts/${ids.contactId}`)?.updatedAt,
    new Date("2026-08-07T12:11:00.000Z"),
  );
});

test("maps the allowlisted STOP code to the canonical contact suppression state", async () => {
  const store = new MemoryIngressStore();
  seedWorkspace(store);
  const firstEnvelope = envelope();
  await process(store, firstEnvelope);
  const stop = stopEnvelope({
    eventId: "synthetic-event-pipeline-stop-0002",
    providerMessageRef: "synthetic-message-pipeline-stop-0002",
  });
  await process(store, stop, new Date("2026-08-07T12:12:00.000Z"));
  const ids = syntheticIngressDocumentIds(authorization(), firstEnvelope);
  const stopIds = syntheticIngressDocumentIds(authorization(), stop);
  const root = "workspaces/workspace_safenet_demo";
  const contact = store.records.get(`${root}/contacts/${ids.contactId}`);
  const conversation = store.records.get(`${root}/conversations/${ids.conversationId}`);
  const consent = store.records.get(`${root}/consentRecords/${stopIds.consentRecordId}`);
  assert.deepEqual(contact?.suppression, {
    suppressAll: false,
    suppressMarketing: true,
    invalidContact: false,
    reasons: ["stop_keyword"],
    updatedAt: new Date("2026-08-07T12:12:00.000Z"),
  });
  assert.deepEqual(contact?.tags, ["appointment", "marketing-suppressed"]);
  assert.equal(contact?.preferenceRevision, 1);
  assert.equal(
    (contact?.suppression as { readonly suppressAll: boolean }).suppressAll,
    false,
    "A marketing STOP must not suppress service or utility operations.",
  );
  assert.equal(conversation?.status, "resolved");
  assert.equal(conversation?.unreadCount, 0);
  assert.deepEqual(consent, {
    id: stopIds.consentRecordId,
    workspaceId: "workspace_safenet_demo",
    contactId: ids.contactId,
    teamId: "team_demo_general",
    locationId: "location_demo_wattala",
    purpose: "health_campaigns",
    channel: "whatsapp",
    category: "marketing",
    status: "withdrawn",
    source: "inbound_keyword",
    noticeVersion: "demo-marketing-notice-v1",
    language: "en",
    evidenceRef:
      `demo://protected-synthetic-consent/workspace_safenet_demo/${stopIds.consentRecordId}`,
    capturedAt: new Date("2026-08-07T12:08:00.000Z"),
    withdrawnAt: new Date("2026-08-07T12:08:00.000Z"),
    supersedesRecordId: null,
    synthetic: true,
    schemaVersion: 1,
    createdAt: new Date("2026-08-07T12:12:00.000Z"),
    updatedAt: new Date("2026-08-07T12:12:00.000Z"),
  });
  assert.deepEqual(Object.keys(consent ?? {}).sort(), [
    "capturedAt",
    "category",
    "channel",
    "contactId",
    "createdAt",
    "evidenceRef",
    "id",
    "language",
    "locationId",
    "noticeVersion",
    "purpose",
    "schemaVersion",
    "source",
    "status",
    "supersedesRecordId",
    "synthetic",
    "teamId",
    "updatedAt",
    "withdrawnAt",
    "workspaceId",
  ]);
  assert.equal("body" in (consent ?? {}), false);
  assert.equal("text" in (consent ?? {}), false);
});

test("replays one STOP withdrawal idempotently and retains distinct immutable evidence per event", async () => {
  const store = new MemoryIngressStore();
  seedWorkspace(store);
  const firstStop = stopEnvelope({
    eventId: "synthetic-event-stop-evidence-0001",
    providerMessageRef: "synthetic-message-stop-evidence-0001",
  });
  const first = await process(store, firstStop, new Date("2026-08-07T12:12:00.000Z"));
  assert.equal(first.replayed, false);
  const sizeAfterFirst = store.records.size;
  const replay = await process(store, firstStop, new Date("2026-08-07T12:30:00.000Z"));
  assert.equal(replay.replayed, true);
  assert.equal(store.records.size, sizeAfterFirst);

  const secondStop = stopEnvelope({
    eventId: "synthetic-event-stop-evidence-0002",
    providerMessageRef: "synthetic-message-stop-evidence-0002",
    occurredAt: "2026-08-07T12:18:00.000Z",
  });
  await process(store, secondStop, new Date("2026-08-07T12:22:00.000Z"));
  const firstIds = syntheticIngressDocumentIds(authorization(), firstStop);
  const secondIds = syntheticIngressDocumentIds(authorization(), secondStop);
  assert.notEqual(firstIds.consentRecordId, secondIds.consentRecordId);
  const root = "workspaces/workspace_safenet_demo";
  const consents = [...store.records.entries()].filter(([path]) =>
    path.startsWith(`${root}/consentRecords/`));
  assert.equal(consents.length, 2);
  assert.equal(
    store.records.get(`${root}/consentRecords/${firstIds.consentRecordId}`)?.capturedAt
      instanceof Date,
    true,
  );
  assert.deepEqual(
    store.records.get(`${root}/contacts/${firstIds.contactId}`)?.suppression,
    {
      suppressAll: false,
      suppressMarketing: true,
      invalidContact: false,
      reasons: ["stop_keyword"],
      updatedAt: new Date("2026-08-07T12:22:00.000Z"),
    },
  );
});

test("bumps the contact preference revision whenever ingress adds a browser-editable tag", async () => {
  const store = new MemoryIngressStore();
  seedWorkspace(store);
  const first = envelope();
  await process(store, first);
  const second = envelope({
    eventId: "synthetic-event-laboratory-tag-0002",
    occurredAt: "2026-08-07T12:07:00.000Z",
    event: {
      kind: "message_inbound",
      providerMessageRef: "synthetic-message-laboratory-tag-0002",
      contactRef: "synthetic-contact-pipeline-0001",
      scenarioCode: "laboratory_collection_request",
      textCode: "LAB_COLLECTION_REQUEST_EN",
      language: "en",
    },
  });
  await process(store, second, new Date("2026-08-07T12:11:00.000Z"));

  const ids = syntheticIngressDocumentIds(authorization(), first);
  const contact = store.records.get(
    `workspaces/workspace_safenet_demo/contacts/${ids.contactId}`,
  );
  assert.deepEqual(contact?.tags, ["appointment", "laboratory"]);
  assert.equal(contact?.preferenceRevision, 1);
});

test("keeps newer safety hold state when older or ordinary inbound events arrive", async () => {
  const store = new MemoryIngressStore();
  seedWorkspace(store);
  const urgent = envelope({
    eventId: "synthetic-event-urgent-state-0001",
    occurredAt: "2026-08-07T12:10:00.000Z",
    event: {
      kind: "message_inbound",
      providerMessageRef: "synthetic-message-urgent-state-0001",
      contactRef: "synthetic-contact-pipeline-0001",
      scenarioCode: "urgent_help",
      textCode: "URGENT_HELP_EN",
      language: "en",
    },
  });
  await process(store, urgent, new Date("2026-08-07T12:11:00.000Z"));
  const ids = syntheticIngressDocumentIds(authorization(), urgent);
  const conversationPath =
    `workspaces/workspace_safenet_demo/conversations/${ids.conversationId}`;
  const urgentState = store.records.get(conversationPath);
  assert.equal(urgentState?.mode, "safety_hold");
  assert.equal(urgentState?.purpose, "urgent_escalation");
  assert.deepEqual(urgentState?.lastMessageAt, new Date("2026-08-07T12:10:00.000Z"));

  const olderAppointment = envelope({
    eventId: "synthetic-event-older-appointment-0002",
    occurredAt: "2026-08-07T12:05:00.000Z",
    event: {
      kind: "message_inbound",
      providerMessageRef: "synthetic-message-older-appointment-0002",
      contactRef: "synthetic-contact-pipeline-0001",
      scenarioCode: "appointment_request",
      textCode: "APPOINTMENT_REQUEST_EN",
      language: "en",
    },
  });
  await process(store, olderAppointment, new Date("2026-08-07T12:20:00.000Z"));
  const afterOlder = store.records.get(conversationPath);
  assert.equal(afterOlder?.mode, "safety_hold");
  assert.equal(afterOlder?.purpose, "urgent_escalation");
  assert.deepEqual(afterOlder?.lastMessageAt, new Date("2026-08-07T12:10:00.000Z"));

  const newerAppointment = envelope({
    eventId: "synthetic-event-newer-appointment-0003",
    occurredAt: "2026-08-07T12:15:00.000Z",
    event: {
      kind: "message_inbound",
      providerMessageRef: "synthetic-message-newer-appointment-0003",
      contactRef: "synthetic-contact-pipeline-0001",
      scenarioCode: "appointment_request",
      textCode: "APPOINTMENT_REQUEST_EN",
      language: "en",
    },
  });
  await process(store, newerAppointment, new Date("2026-08-07T12:21:00.000Z"));
  const afterNewer = store.records.get(conversationPath);
  assert.equal(afterNewer?.mode, "safety_hold");
  assert.equal(afterNewer?.purpose, "urgent_escalation");
  assert.deepEqual(afterNewer?.lastMessageAt, new Date("2026-08-07T12:15:00.000Z"));

  const messagePaths = [...store.records.keys()].filter((path) =>
    path.startsWith("workspaces/workspace_safenet_demo/messages/"));
  assert.equal(messagePaths.length, 3, "All valid inbound metadata events remain preserved.");
});

test("fails closed on a pre-existing STOP consent ID collision without partial mutation", async () => {
  const store = new MemoryIngressStore();
  seedWorkspace(store);
  const stop = stopEnvelope({
    eventId: "synthetic-event-stop-collision-0001",
    providerMessageRef: "synthetic-message-stop-collision-0001",
  });
  const ids = syntheticIngressDocumentIds(authorization(), stop);
  const consentPath =
    `workspaces/workspace_safenet_demo/consentRecords/${ids.consentRecordId}`;
  store.records.set(consentPath, {
    id: ids.consentRecordId,
    workspaceId: "workspace_safenet_demo",
    synthetic: true,
    maliciousExtraField: "must-not-be-trusted",
  });
  const before = new Map(store.records);
  await assert.rejects(
    process(store, stop),
    hasCode("synthetic_ingress_state_invalid"),
  );
  assert.deepEqual(store.records, before);
});

test("persists out-of-order status callbacks while deriving a monotonic current message status", async () => {
  const store = new MemoryIngressStore();
  seedWorkspace(store);
  const inbound = envelope();
  await process(store, inbound);
  const outboundRef = "synthetic-message-outbound-status-0001";
  seedSyntheticOutboundMessage({ store, contactEnvelope: inbound, providerMessageRef: outboundRef });

  const delivered = statusEnvelope(
    "synthetic-event-status-delivered-0001",
    "delivered",
    outboundRef,
  );
  const deliveredResult = await process(store, delivered);
  assert.equal(deliveredResult.action, "status_advanced");
  assert.equal(deliveredResult.currentStatus, "delivered");

  const lateSent = statusEnvelope(
    "synthetic-event-status-sent-late-0001",
    "sent",
    outboundRef,
  );
  const lateResult = await process(store, lateSent);
  assert.equal(lateResult.action, "status_observed");
  assert.equal(lateResult.stateChanged, false);
  assert.equal(lateResult.currentStatus, "delivered");

  const read = statusEnvelope("synthetic-event-status-read-0001", "read", outboundRef);
  await process(store, read);
  const lateFailure = statusEnvelope(
    "synthetic-event-status-failed-late-0001",
    "failed",
    outboundRef,
  );
  const failureResult = await process(store, lateFailure);
  assert.equal(failureResult.currentStatus, "read");
  assert.equal(failureResult.stateChanged, false);

  const ids = syntheticIngressDocumentIds(authorization(), delivered);
  const message = store.records.get(
    `workspaces/workspace_safenet_demo/messages/${ids.messageId}`,
  );
  assert.equal(message?.status, "read");
  const statusEvents = [...store.records.keys()].filter((path) =>
    path.startsWith("workspaces/workspace_safenet_demo/messageStatusEvents/"));
  assert.equal(statusEvents.length, 4);

  const sizeBeforeReplay = store.records.size;
  const replay = await process(store, lateFailure);
  assert.equal(replay.replayed, true);
  assert.equal(store.records.size, sizeBeforeReplay);
});

test("rejects delivery callbacks for inbound messages and leaves them received", async () => {
  const store = new MemoryIngressStore();
  seedWorkspace(store);
  const inbound = envelope();
  await process(store, inbound);
  const inboundIds = syntheticIngressDocumentIds(authorization(), inbound);
  const delivered = statusEnvelope("synthetic-event-inbound-delivery-denied-0001", "delivered");

  await assert.rejects(
    process(store, delivered),
    hasCode("synthetic_record_scope_denied"),
  );
  const message = store.records.get(
    `workspaces/workspace_safenet_demo/messages/${inboundIds.messageId}`,
  );
  assert.equal(message?.direction, "inbound");
  assert.equal(message?.status, "received");
  assert.equal(message?.sentAt, null);
  assert.equal(message?.deliveredAt, null);
});

test("fills a missing delivered timestamp from a late callback without lowering read status", async () => {
  const store = new MemoryIngressStore();
  seedWorkspace(store);
  const inbound = envelope();
  await process(store, inbound);
  const outboundRef = "synthetic-message-outbound-read-first-0001";
  seedSyntheticOutboundMessage({ store, contactEnvelope: inbound, providerMessageRef: outboundRef });

  const read = statusEnvelope("synthetic-event-read-before-delivered-0001", "read", outboundRef);
  await process(store, read, new Date("2026-08-07T12:11:00.000Z"));
  const delivered = statusEnvelope(
    "synthetic-event-delivered-after-read-0002",
    "delivered",
    outboundRef,
  );
  const late = await process(store, delivered, new Date("2026-08-07T12:12:00.000Z"));
  assert.equal(late.action, "status_observed");
  assert.equal(late.currentStatus, "read");
  assert.equal(late.stateChanged, true);

  const ids = syntheticIngressDocumentIds(authorization(), delivered);
  const message = store.records.get(
    `workspaces/workspace_safenet_demo/messages/${ids.messageId}`,
  );
  assert.equal(message?.status, "read");
  assert.deepEqual(message?.deliveredAt, new Date("2026-08-07T12:05:00.000Z"));
});

test("binds each provider message reference to immutable inbound semantics", async () => {
  const store = new MemoryIngressStore();
  seedWorkspace(store);
  const first = envelope();
  await process(store, first);
  const before = new Map(store.records);
  const conflictingStop = stopEnvelope({
    eventId: "synthetic-event-provider-ref-conflict-0002",
    providerMessageRef: "synthetic-message-pipeline-0001",
  });

  await assert.rejects(
    process(store, conflictingStop, new Date("2026-08-07T12:12:00.000Z")),
    hasCode("synthetic_webhook_idempotency_conflict"),
  );
  assert.deepEqual(store.records, before);
});

test("requires the server-only route record to match the outer synthetic allowlist", async () => {
  const missingRouteStore = new MemoryIngressStore();
  seedWorkspace(missingRouteStore);
  missingRouteStore.records.delete("phoneRoutes/synthetic-phone-route-wattala-demo");
  await assert.rejects(process(missingRouteStore, envelope()), hasCode("synthetic_route_denied"));
  assert.equal(missingRouteStore.records.size, 1);

  const mismatchedRouteStore = new MemoryIngressStore();
  seedWorkspace(mismatchedRouteStore);
  const routePath = "phoneRoutes/synthetic-phone-route-wattala-demo";
  mismatchedRouteStore.records.set(routePath, {
    ...mismatchedRouteStore.records.get(routePath),
    locationId: "location_demo_thalawathugoda",
  });
  const before = new Map(mismatchedRouteStore.records);
  await assert.rejects(process(mismatchedRouteStore, envelope()), hasCode("synthetic_route_denied"));
  assert.deepEqual(mismatchedRouteStore.records, before);
});

test("rejects synthetic webhook timestamps outside the bounded receipt window", async () => {
  const oldStore = new MemoryIngressStore();
  seedWorkspace(oldStore);
  const oldBefore = new Map(oldStore.records);
  await assert.rejects(
    process(oldStore, envelope(), new Date("2026-08-08T12:00:00.001Z")),
    hasCode("invalid_synthetic_ingress_time"),
  );
  assert.deepEqual(oldStore.records, oldBefore);

  const futureStore = new MemoryIngressStore();
  seedWorkspace(futureStore);
  const future = envelope({ occurredAt: "2026-08-07T12:15:00.001Z" });
  await assert.rejects(
    process(futureStore, future, new Date("2026-08-07T12:10:00.000Z")),
    hasCode("invalid_synthetic_ingress_time"),
  );
});

test("rejects event-ID collisions, unknown messages, route substitution and non-demo workspaces atomically", async () => {
  const store = new MemoryIngressStore();
  seedWorkspace(store);
  const first = envelope();
  await process(store, first);
  const size = store.records.size;

  const collision = envelope({
    event: {
      kind: "message_inbound",
      providerMessageRef: "synthetic-message-pipeline-collision",
      contactRef: "synthetic-contact-pipeline-0001",
      scenarioCode: "appointment_request",
      textCode: "APPOINTMENT_REQUEST_TA",
      language: "ta",
    },
  });
  await assert.rejects(process(store, collision), hasCode("synthetic_webhook_idempotency_conflict"));
  assert.equal(store.records.size, size);

  const unknownStore = new MemoryIngressStore();
  seedWorkspace(unknownStore);
  const unknown = statusEnvelope("synthetic-event-status-unknown-0001", "sent");
  await assert.rejects(process(unknownStore, unknown), hasCode("synthetic_message_not_found"));
  assert.equal(unknownStore.records.size, 2);

  const wrongRoute = envelope({ routeRef: "synthetic-phone-route-thalawathugoda-demo" });
  await assert.rejects(process(store, wrongRoute), hasCode("synthetic_route_denied"));

  const uatStore = new MemoryIngressStore();
  seedWorkspace(uatStore, "uat");
  await assert.rejects(process(uatStore, first), hasCode("synthetic_workspace_denied"));
  assert.equal(uatStore.records.size, 2);
});

test("status rank helper is monotonic across success and simulated failure observations", () => {
  assert.deepEqual(
    deriveMonotonicSyntheticStatus({ current: "received", observed: "sent" }),
    { currentStatus: "sent", stateChanged: true },
  );
  assert.deepEqual(
    deriveMonotonicSyntheticStatus({ current: "delivered", observed: "failed" }),
    { currentStatus: "delivered", stateChanged: false },
  );
  assert.deepEqual(
    deriveMonotonicSyntheticStatus({ current: "read", observed: "sent" }),
    { currentStatus: "read", stateChanged: false },
  );
});
