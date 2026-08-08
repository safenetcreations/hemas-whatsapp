import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type {
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Transaction,
} from "firebase-admin/firestore";
import type { RuntimeConfig } from "../src/config.js";
import {
  AI_GOVERNANCE_ACTION,
  AI_GOVERNANCE_EVALUATED_AT,
  AI_GOVERNANCE_PROJECT_ID,
  AI_GOVERNANCE_WORKSPACE_ID,
  AI_KNOWLEDGE_DOCUMENT_IDS,
  AI_KNOWLEDGE_DOCUMENT_MATRIX,
  AI_KNOWLEDGE_SELECTION_IDS,
  AI_PERSISTED_SCENARIO_IDS,
  AI_PERSISTED_SCENARIO_MATRIX,
  AI_RUNTIME_PATH_COLLECTIONS,
  aiCallRequestFingerprint,
  aiReceiptDocumentId,
  assertAiGovernanceRuntimeBoundary,
  buildAiGovernanceSeedContract,
  buildAiRuntimeAggregate,
  parseAiRetrospectiveRequestInput,
  serializeAiDecisionFixtureIdentityV1,
  serializeAiEvaluationRequestV1,
  serializeAiKnowledgeApprovalV1,
  serializeAiKnowledgeContentV1,
  serializeAiKnowledgeSelectionV1,
  serializeAiRetrospectiveEventSecretV1,
  serializeAiRetrospectiveEventV1,
  serializeAiRetrospectiveRunSecretV1,
  serializeAiRetrospectiveRunV1,
  serializeAiSourceFixtureIdentityV1,
  type AiPersistedScenarioId,
  type AiRecord,
  type AiRetrospectiveRequestInput,
} from "../src/ai-governance/contracts.js";
import { recordSyntheticAiRetrospective } from "../src/ai-governance/service.js";

type MemoryRecord = Readonly<Record<string, unknown>>;

class MemoryTransactionStore {
  readonly records = new Map<string, MemoryRecord>();
  readonly db: Firestore;
  transactionCount = 0;
  private tail: Promise<void> = Promise.resolve();

  constructor() {
    this.db = {
      doc: (path: string) => ({ path }) as DocumentReference,
      runTransaction: async <T>(handler: (transaction: Transaction) => Promise<T>) => {
        this.transactionCount += 1;
        const previous = this.tail;
        let release!: () => void;
        this.tail = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        try {
          const staged = new Map(this.records);
          const transaction = {
            get: async (reference: DocumentReference) => {
              const value = staged.get(reference.path);
              return {
                exists: value !== undefined,
                data: () => value,
                ref: reference,
                id: reference.path.split("/").at(-1) ?? "",
              } as unknown as DocumentSnapshot;
            },
            create: (reference: DocumentReference, data: DocumentData) => {
              if (staged.has(reference.path)) throw new Error(`create conflict: ${reference.path}`);
              staged.set(reference.path, data);
              return transaction;
            },
          } as unknown as Transaction;
          const result = await handler(transaction);
          this.records.clear();
          for (const [path, value] of staged) this.records.set(path, value);
          return result;
        } finally {
          release();
        }
      },
    } as unknown as Firestore;
  }
}

const NOW = new Date("2026-08-08T01:00:01.000Z");
const ACTOR_UID = "synthetic-ai-admin";
const PREFIX = `workspaces/${AI_GOVERNANCE_WORKSPACE_ID}`;
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

const config: RuntimeConfig = {
  runtimeMode: "demo",
  defaultTenantId: AI_GOVERNANCE_WORKSPACE_ID,
  providerMode: "synthetic",
  hemasIntegrationMode: "synthetic",
  auditSinkMode: "durable",
  outboundEnabled: false,
  approvalGateRequired: true,
  diagnosisEnabled: false,
  syntheticSeed: "hemas-connect-demo-v1",
  liveActivation: { id: undefined, approvedBy: undefined, expiresAt: undefined },
};
const emulator = {
  projectId: AI_GOVERNANCE_PROJECT_ID,
  firestoreEmulatorHost: "127.0.0.1:8080",
} as const;

function actor(uid = ACTOR_UID) {
  return { uid, authTime: new Date(NOW.getTime() - 60_000) };
}

function request(
  scenarioId: AiPersistedScenarioId,
  idempotencyKey = `ai-retrospective-${scenarioId}-0001`,
): AiRetrospectiveRequestInput {
  return { workspaceId: AI_GOVERNANCE_WORKSPACE_ID, scenarioId, idempotencyKey };
}

function nativeTimes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(nativeTimes);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => {
        if (
          typeof item === "string" &&
          (key.endsWith("At") || key === "effectiveFrom" || key === "effectiveUntil") &&
          Number.isFinite(Date.parse(item)) && new Date(Date.parse(item)).toISOString() === item
        ) return [key, new Date(item)];
        return [key, nativeTimes(item)];
      }),
    );
  }
  return value;
}

function workspace(): MemoryRecord {
  return {
    id: AI_GOVERNANCE_WORKSPACE_ID,
    name: "SafeNet Healthcare Platform Demo",
    mode: "demo",
    status: "active",
    timeZone: "Asia/Colombo",
    supportedLanguages: ["en", "si", "ta"],
    defaultLanguage: "en",
    retentionPolicyVersion: "demo-retention-v1",
    dataClassification: "synthetic_only",
    externalMessaging: {
      enabled: false,
      mode: "simulator_only",
      allowlistedRecipientHashes: [],
      verifiedCapacity: null,
      capacityVerifiedAt: null,
      disabledReason: "External delivery disabled in the synthetic demo.",
    },
    isSyntheticDemo: true,
    createdAt: new Date("2026-08-01T03:30:00.000Z"),
    updatedAt: new Date("2026-08-07T12:20:00.000Z"),
  };
}

function membership(input: {
  readonly uid?: string;
  readonly role?: string;
  readonly scopeMode?: string;
  readonly teamIds?: readonly string[];
  readonly locationIds?: readonly string[];
  readonly mfaSatisfied?: boolean;
  readonly lastAuthenticatedAt?: Date;
} = {}): MemoryRecord {
  const uid = input.uid ?? ACTOR_UID;
  return {
    id: uid,
    uid,
    workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    displayLabel: "Synthetic AI administrator",
    role: input.role ?? "tenant_admin",
    scopeMode: input.scopeMode ?? "workspace_wide",
    teamIds: input.teamIds ?? [],
    locationIds: input.locationIds ?? [],
    status: "active",
    mfaSatisfied: input.mfaSatisfied ?? true,
    lastAuthenticatedAt: input.lastAuthenticatedAt ?? new Date(NOW.getTime() - 60_000),
    synthetic: true,
    createdAt: new Date("2026-08-01T03:30:00.000Z"),
    updatedAt: new Date("2026-08-07T12:20:00.000Z"),
  };
}

const signalMatrix = {
  waba: ["not_configured", "synthetic_fixture", "no_meta_waba"],
  phoneRegistration: ["not_configured", "synthetic_fixture", "no_provider_phone"],
  webhook: ["mock", "synthetic_fixture", "synthetic_ingress_only"],
  appMode: ["not_configured", "synthetic_fixture", "no_meta_app"],
  permissions: ["unverified", "synthetic_fixture", "no_meta_permissions"],
  templates: ["not_submitted", "synthetic_fixture", "provider_approved_zero"],
  payment: ["not_configured", "synthetic_fixture", "no_payment_configuration"],
  sending: ["blocked", "local_policy", "external_sending_disabled"],
  quality: ["not_available", "synthetic_fixture", "no_provider_quality"],
  capacity: ["not_available", "synthetic_fixture", "no_provider_capacity"],
  realDeviceCanary: ["blocked", "local_policy", "no_real_device_canary"],
} as const;

function connection(): MemoryRecord {
  return {
    id: "connection_demo_simulator", workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    displayName: "Local WhatsApp journey simulator", provider: "simulator",
    environment: "demo", status: "mock", maskedNumber: "No external number",
    maskedWabaId: null, maskedPhoneNumberId: null, credentialState: "not_configured",
    externalMessagingEnabled: false, networkCallsEnabled: false,
    signals: Object.fromEntries(Object.entries(signalMatrix).map(([key, [state, source, detailCode]]) => [
      key,
      { state, source, observedAt: new Date("2026-08-07T12:20:00.000Z"), lastSuccessfulVerificationAt: null, detailCode },
    ])),
    sortKey: "01_whatsapp_simulator", synthetic: true, schemaVersion: 1,
    createdAt: new Date("2026-08-01T03:30:00.000Z"),
    updatedAt: new Date("2026-08-07T12:20:00.000Z"),
  };
}

function sourceContact(scenarioId: AiPersistedScenarioId): MemoryRecord {
  const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
  const letter = { appointment: "A", urgent: "E", mixed: "D", stop: "F" }[scenarioId];
  const stop = scenarioId === "stop";
  return {
    id: expected.sourceContactId, workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    teamId: expected.sourceTeamId, locationId: expected.sourceLocationId,
    maskedPhone: `Synthetic contact ${letter} · no phone stored`,
    displayLabel: `Synthetic Patient ${letter}`,
    preferredLanguage: scenarioId === "mixed" ? "ta" : "en",
    alternateLanguages: scenarioId === "mixed" ? ["en"] : [],
    suppression: {
      suppressAll: false, suppressMarketing: stop, invalidContact: false,
      reasons: stop ? ["stop_keyword"] : [],
      updatedAt: new Date("2026-08-07T12:20:00.000Z"),
    },
    tags: scenarioId === "appointment" ? ["appointment"]
      : scenarioId === "urgent" ? ["urgent-simulation"]
      : scenarioId === "mixed" ? ["human-handoff"] : ["marketing-suppressed"],
    preferenceRevision: scenarioId === "mixed" ? 1 : 0,
    synthetic: true,
    createdAt: new Date("2026-08-01T03:30:00.000Z"),
    updatedAt: new Date("2026-08-07T12:20:00.000Z"),
  };
}

function sourceConversation(scenarioId: AiPersistedScenarioId): MemoryRecord {
  const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
  return {
    id: expected.syntheticConversationRef, workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    contactId: expected.sourceContactId, connectionId: expected.sourceConnectionId,
    teamId: expected.sourceTeamId, locationId: expected.sourceLocationId,
    status: expected.observedConversationStatus, mode: expected.observedConversationMode,
    assigneeId: scenarioId === "mixed" ? "user_demo_agent" : null,
    detectedLanguage: expected.language === "mixed" ? "en" : expected.language,
    languageConfidence: expected.languageConfidence, purpose: expected.sourcePurpose,
    serviceWindowExpiresAt: new Date("2026-08-08T10:15:00.000Z"),
    firstResponseDueAt: new Date(scenarioId === "urgent" ? "2026-08-07T12:22:00.000Z" : "2026-08-07T12:35:00.000Z"),
    lastMessageAt: new Date("2026-08-07T12:20:00.000Z"),
    handoffSummary: "Synthetic source state only.", unreadCount: scenarioId === "stop" ? 0 : 1,
    synthetic: true, createdAt: new Date("2026-08-07T10:15:00.000Z"),
    updatedAt: new Date("2026-08-07T12:20:00.000Z"),
  };
}

function sourceMessage(scenarioId: AiPersistedScenarioId): MemoryRecord {
  const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
  const time = new Date(scenarioId === "appointment" ? "2026-08-07T10:15:00.000Z" : "2026-08-07T12:20:00.000Z");
  return {
    id: expected.sourceMessageId, workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    conversationId: expected.syntheticConversationRef, contactId: expected.sourceContactId,
    teamId: expected.sourceTeamId, locationId: expected.sourceLocationId,
    direction: "inbound", type: "text", status: "received", externalDispatch: "not_applicable",
    actorId: null, receivedAt: time, sentAt: null, deliveredAt: null,
    metadataOnly: true, synthetic: true, schemaVersion: 1, createdAt: time, updatedAt: time,
  };
}

function team(scenarioId: AiPersistedScenarioId): MemoryRecord {
  const clinical = scenarioId === "urgent";
  return {
    id: clinical ? "team_demo_clinical_escalation" : "team_demo_general",
    workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    name: clinical ? "Clinical safety escalation — simulator" : "General patient services",
    queueType: clinical ? "clinical_escalation" : "general",
    locationIds: ["location_demo_wattala", "location_demo_thalawathugoda"],
    businessHoursLabel: clinical ? "Synthetic on-call path" : "Synthetic schedule: 08:00–20:00 Asia/Colombo",
    firstResponseSlaMinutes: clinical ? 2 : 5,
    active: true, createdAt: new Date("2026-08-01T03:30:00.000Z"),
    updatedAt: new Date("2026-08-07T12:20:00.000Z"),
  };
}

function location(): MemoryRecord {
  return {
    id: "location_demo_wattala", workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    name: "Demo Hospital — Wattala", kind: "hospital", city: "Wattala",
    supportedServiceRefs: ["demo-general-medicine", "demo-channeling", "demo-laboratory"],
    active: true, createdAt: new Date("2026-08-01T03:30:00.000Z"),
    updatedAt: new Date("2026-08-07T12:20:00.000Z"),
  };
}

function stopConsent(status: "granted" | "withdrawn"): MemoryRecord {
  const granted = status === "granted";
  const time = new Date(granted ? "2026-08-01T05:00:00.000Z" : "2026-08-07T12:20:00.000Z");
  return {
    id: granted ? "consent_synthetic_stop_granted" : "consent_synthetic_stop_withdrawn",
    workspaceId: AI_GOVERNANCE_WORKSPACE_ID, contactId: "contact_synthetic_stopped",
    teamId: "team_demo_general", locationId: "location_demo_wattala",
    purpose: "health_campaigns", channel: "whatsapp", category: "marketing", status,
    source: granted ? "synthetic_fixture" : "inbound_keyword",
    noticeVersion: "demo-marketing-notice-v1", language: "en",
    evidenceRef: granted ? "demo://consent/stop-before" : "demo://consent/stop-keyword-event",
    capturedAt: time, withdrawnAt: granted ? null : time,
    supersedesRecordId: granted ? null : "consent_synthetic_stop_granted",
    synthetic: true, schemaVersion: 1, createdAt: time, updatedAt: time,
  };
}

function seedStore(): MemoryTransactionStore {
  const store = new MemoryTransactionStore();
  store.records.set(`workspaces/${AI_GOVERNANCE_WORKSPACE_ID}`, workspace());
  store.records.set(`${PREFIX}/members/${ACTOR_UID}`, membership());
  store.records.set(`${PREFIX}/whatsappConnections/connection_demo_simulator`, connection());
  store.records.set(`${PREFIX}/locations/location_demo_wattala`, location());
  for (const scenarioId of AI_PERSISTED_SCENARIO_IDS) {
    const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
    store.records.set(`${PREFIX}/contacts/${expected.sourceContactId}`, sourceContact(scenarioId));
    store.records.set(`${PREFIX}/conversations/${expected.syntheticConversationRef}`, sourceConversation(scenarioId));
    store.records.set(`${PREFIX}/messages/${expected.sourceMessageId}`, sourceMessage(scenarioId));
    store.records.set(`${PREFIX}/teams/${expected.sourceTeamId}`, team(scenarioId));
  }
  store.records.set(`${PREFIX}/consentRecords/consent_synthetic_stop_granted`, stopConsent("granted"));
  store.records.set(`${PREFIX}/consentRecords/consent_synthetic_stop_withdrawn`, stopConsent("withdrawn"));
  const governance = buildAiGovernanceSeedContract();
  for (const id of AI_KNOWLEDGE_DOCUMENT_IDS) {
    store.records.set(`${PREFIX}/knowledgeDocuments/${id}`, nativeTimes(governance.documents[id]) as MemoryRecord);
    const secretId = AI_KNOWLEDGE_DOCUMENT_MATRIX[id].secretId;
    store.records.set(`${PREFIX}/knowledgeDocumentSecrets/${secretId}`, nativeTimes(governance.secrets[secretId]) as MemoryRecord);
  }
  for (const id of AI_KNOWLEDGE_SELECTION_IDS) {
    store.records.set(`${PREFIX}/knowledgeSelections/${id}`, nativeTimes(governance.selections[id]) as MemoryRecord);
  }
  return store;
}

function runtimePaths(store: MemoryTransactionStore): readonly string[] {
  return [...store.records.keys()].filter((path) =>
    Object.values(AI_RUNTIME_PATH_COLLECTIONS)
      .slice(0, 6)
      .some((collection) => path.includes(`/${collection}/`)),
  );
}

function code(expected: string): (error: unknown) => boolean {
  return (error) => Boolean(error && typeof error === "object" && "code" in error && (error as { code: unknown }).code === expected);
}

async function call(
  store: MemoryTransactionStore,
  scenarioId: AiPersistedScenarioId,
  options: {
    readonly key?: string;
    readonly uid?: string;
    readonly now?: Date;
    readonly runtimeConfig?: RuntimeConfig;
    readonly boundary?: typeof emulator;
  } = {},
) {
  return recordSyntheticAiRetrospective({
    db: store.db,
    config: options.runtimeConfig ?? config,
    emulator: options.boundary ?? emulator,
    actor: actor(options.uid),
    request: request(scenarioId, options.key),
    now: options.now ?? NOW,
  });
}

test("call input and boundary are exact and fail before Firestore I/O", async () => {
  const valid = request("appointment");
  assert.deepEqual(parseAiRetrospectiveRequestInput(valid), valid);
  for (const invalid of [
    { ...valid, prompt: "forbidden" },
    { ...valid, sourceId: "forbidden" },
    { ...valid, outcome: "preview_only" },
    { ...valid, idempotencyKey: "short" },
    { ...valid, scenarioId: "medicine" },
  ]) assert.throws(() => parseAiRetrospectiveRequestInput(invalid));

  const store = seedStore();
  for (const runtimeConfig of [
    { ...config, runtimeMode: "production" as const },
    { ...config, providerMode: "live" as const },
    { ...config, hemasIntegrationMode: "live" as const },
    { ...config, auditSinkMode: "memory" as const },
    { ...config, outboundEnabled: true },
    { ...config, approvalGateRequired: false },
  ]) {
    await assert.rejects(call(store, "appointment", { runtimeConfig }), code("ai_governance_service_disabled"));
  }
  for (const boundary of [
    { projectId: "real-project", firestoreEmulatorHost: "127.0.0.1:8080" },
    { projectId: AI_GOVERNANCE_PROJECT_ID, firestoreEmulatorHost: undefined },
    { projectId: AI_GOVERNANCE_PROJECT_ID, firestoreEmulatorHost: "firestore.googleapis.com:443" },
  ]) {
    await assert.rejects(
      recordSyntheticAiRetrospective({
        db: store.db, config, emulator: boundary, actor: actor(), request: valid, now: NOW,
      }),
      code("ai_governance_service_disabled"),
    );
  }
  assert.equal(store.transactionCount, 0);
});

test("server mirror pins frozen root hashes and canonical golden parity", () => {
  const rootContract = readFileSync(new URL("../../../lib/domain/ai-governance.ts", import.meta.url));
  const rootTests = readFileSync(new URL("../../../tests/ai-governance.test.ts", import.meta.url));
  assert.equal(sha256(rootContract.toString("utf8")), "c15836b067a288879303570fd9aa5465ee72792decf9ff0ae2555587c5549e3f");
  assert.equal(sha256(rootTests.toString("utf8")), "ddc39c054d2a7a92f73c6598e59fcf2e585e9694c43dd80be29021bae7345d69");
  const governance = buildAiGovernanceSeedContract();
  const document = governance.documents["kn-appointments-v3"];
  const selection = governance.selections.knowledge_selection_appointments_v3;
  const content = {
    workspaceId: document.workspaceId as string,
    documentId: "kn-appointments-v3" as const,
    title: document.title as string,
    version: document.version as string,
    language: document.language as string,
    contentKind: document.contentKind as string,
    ownerUid: document.ownerUid as string,
    protectedContentFingerprint: AI_KNOWLEDGE_DOCUMENT_MATRIX["kn-appointments-v3"].protectedContentFingerprint,
    synthetic: true as const,
  };
  const approval = {
    workspaceId: document.workspaceId as string,
    documentId: "kn-appointments-v3" as const,
    contentFingerprint: document.contentFingerprint as string,
    ownerUid: document.ownerUid as string,
    approverUid: document.approverUid as string,
    approvalState: "approved" as const,
    approvalScope: document.approvalScope as string,
    approvedAt: document.approvedAt as string,
    evaluatedAt: document.evaluatedAt as string,
    effectiveFrom: document.effectiveFrom as string,
    effectiveUntil: document.effectiveUntil as string,
    synthetic: true as const,
  };
  const selectionBinding = Object.fromEntries(
    Object.entries(selection).filter(([key]) => !["selectionFingerprint", "schemaVersion", "createdAt"].includes(key)),
  ) as Parameters<typeof serializeAiKnowledgeSelectionV1>[0];
  const aggregate = buildAiRuntimeAggregate("appointment", "2026-08-08T01:00:01.000Z", selection);
  assert.deepEqual({
    content: sha256(serializeAiKnowledgeContentV1(content)),
    approval: sha256(serializeAiKnowledgeApprovalV1(approval)),
    selection: sha256(serializeAiKnowledgeSelectionV1(selectionBinding)),
    request: sha256(serializeAiEvaluationRequestV1(aggregate.requestBinding)),
    run: sha256(serializeAiRetrospectiveRunV1(aggregate.run)),
    event: sha256(serializeAiRetrospectiveEventV1(aggregate.event)),
    runSecret: sha256(serializeAiRetrospectiveRunSecretV1(aggregate.runSecret)),
    eventSecret: sha256(serializeAiRetrospectiveEventSecretV1(aggregate.eventSecret)),
    source: sha256(serializeAiSourceFixtureIdentityV1("appointment")),
    decision: sha256(serializeAiDecisionFixtureIdentityV1("appointment")),
  }, {
    content: "e007461619755ef801408cdf81c01d4f175f75e30d77466fd0a3b532f9818b2d",
    approval: "483194e6270375177f9e6c24eddf2e3ea05539aed54f8edba50ecbf8922290ee",
    selection: "97647436b47b0cc63f628ec0668f5ef0c97a7a6303f849c704aae00ac658794e",
    request: "846c8cd96ba70ec05b244683a328a302e68d307d104521a049bbe6927760e289",
    run: "91a95a245ca7f97b955278dba43a8f9746f741ca00da775fd93f401ae9504935",
    event: "c223e23abe8f05519ac60afc60660534550729b67c7c22a4b55275a047e78d69",
    runSecret: "0ee51150ab96f143ef8a1411fd9e748748cb330603988dffbee849caef7fe701",
    eventSecret: "df0ef78793c2f9dacee2a08467f991a530c17d8d4b36ad8c165e9ffdadb3b0d6",
    source: AI_PERSISTED_SCENARIO_MATRIX.appointment.sourceFixtureFingerprint,
    decision: AI_PERSISTED_SCENARIO_MATRIX.appointment.decisionFixtureFingerprint,
  });
});

test("all four first calls create exactly six documents and replay the full immutable graph", async () => {
  const store = seedStore();
  assert.equal(runtimePaths(store).length, 0);
  const fetchBefore = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = (async () => { networkCalls += 1; throw new Error("network forbidden"); }) as typeof fetch;
  try {
    for (const [index, scenarioId] of AI_PERSISTED_SCENARIO_IDS.entries()) {
      const response = await call(store, scenarioId, {
        now: new Date(NOW.getTime() + index),
      });
      assert.equal(response.replayed, false);
      assert.deepEqual(Object.keys(response).sort(), ["auditEventId", "replayed", "result"]);
      assert.deepEqual(Object.keys(response.result).sort(), [...[
        "scenarioId", "runId", "eventId", "auditEventId", "outcome", "recordedAt",
        "modelCallCount", "providerCallCount", "externalDispatchCount",
        "conversationMutationCount", "handoffMutationCount", "suppressionMutationCount",
      ]].sort());
      assert.equal(runtimePaths(store).length, (index + 1) * 6);
      const replay = await call(store, scenarioId, {
        now: new Date(NOW.getTime() + index + 30_000),
      });
      assert.equal(replay.replayed, true);
      assert.deepEqual(replay.result, response.result);
      assert.equal(runtimePaths(store).length, (index + 1) * 6);
    }
  } finally {
    globalThis.fetch = fetchBefore;
  }
  assert.equal(networkCalls, 0);
  assert.equal(runtimePaths(store).length, 24);
});

test("same-key replay is atomic under concurrency and changed requests conflict with zero writes", async () => {
  const store = seedStore();
  const key = "ai-retrospective-concurrent-0001";
  const [left, right] = await Promise.all([
    call(store, "appointment", { key }),
    call(store, "appointment", { key }),
  ]);
  assert.deepEqual([left.replayed, right.replayed].sort(), [false, true]);
  assert.equal(runtimePaths(store).length, 6);
  const before = new Map(store.records);
  await assert.rejects(call(store, "urgent", { key }), code("idempotency_conflict"));
  await assert.rejects(
    call(store, "appointment", { key: "ai-retrospective-different-0002" }),
    code("idempotency_conflict"),
  );
  store.records.set(`${PREFIX}/members/synthetic-ai-second-admin`, membership({ uid: "synthetic-ai-second-admin" }));
  await assert.rejects(
    call(store, "appointment", { uid: "synthetic-ai-second-admin", key: "ai-retrospective-second-actor-0003" }),
    code("idempotency_conflict"),
  );
  for (const [path, value] of before) assert.deepEqual(store.records.get(path), value);
  assert.equal(runtimePaths(store).length, 6);
});

test("partial and substituted runtime graphs fail closed without repair writes", async () => {
  const partial = seedStore();
  partial.records.set(`${PREFIX}/aiRuns/${AI_PERSISTED_SCENARIO_MATRIX.appointment.runId}`, { polluted: true });
  const beforePartial = new Map(partial.records);
  await assert.rejects(call(partial, "appointment"), code("idempotency_conflict"));
  assert.deepEqual(partial.records, beforePartial);

  const replay = seedStore();
  await call(replay, "appointment");
  const runPath = `${PREFIX}/aiRuns/${AI_PERSISTED_SCENARIO_MATRIX.appointment.runId}`;
  replay.records.set(runPath, { ...replay.records.get(runPath), modelCallCount: 1 });
  const beforeReplay = new Map(replay.records);
  await assert.rejects(call(replay, "appointment"), code("invalid_ai_governance_evidence"));
  assert.deepEqual(replay.records, beforeReplay);
});

test("source, governance and STOP substitutions fail with no runtime writes", async () => {
  const cases: Array<(store: MemoryTransactionStore) => void> = [
    (store) => {
      const path = `${PREFIX}/conversations/conversation_synthetic_appointment`;
      store.records.set(path, { ...store.records.get(path), contactId: "contact_synthetic_stopped" });
    },
    (store) => {
      const path = `${PREFIX}/knowledgeSelections/knowledge_selection_appointments_v3`;
      store.records.set(path, { ...store.records.get(path), selectionFingerprint: "0".repeat(64) });
    },
    (store) => {
      const path = `${PREFIX}/consentRecords/consent_synthetic_stop_withdrawn`;
      store.records.set(path, { ...store.records.get(path), status: "granted" });
    },
    (store) => {
      const path = `${PREFIX}/contacts/contact_synthetic_stopped`;
      const current = store.records.get(path)!;
      store.records.set(path, {
        ...current,
        suppression: { ...(current.suppression as MemoryRecord), suppressMarketing: false },
      });
    },
  ];
  for (const [index, mutate] of cases.entries()) {
    const store = seedStore();
    mutate(store);
    await assert.rejects(
      call(store, index < 2 ? "appointment" : "stop"),
      code(index === 1 ? "invalid_ai_governance_evidence" : "invalid_ai_source_fixture"),
    );
    assert.equal(runtimePaths(store).length, 0);
  }
});

test("role, assigned scope, MFA and both recent-auth clocks are enforced", async () => {
  const denied = [
    membership({ role: "privacy_reviewer", scopeMode: "assigned", teamIds: ["team_demo_general"], locationIds: ["location_demo_wattala"] }),
    membership({ mfaSatisfied: false }),
    membership({ role: "supervisor", scopeMode: "assigned", teamIds: ["team_demo_general"], locationIds: ["location_demo_thalawathugoda"] }),
    membership({ lastAuthenticatedAt: new Date(NOW.getTime() - 16 * 60_000) }),
  ];
  for (const member of denied) {
    const store = seedStore();
    store.records.set(`${PREFIX}/members/${ACTOR_UID}`, member);
    await assert.rejects(call(store, "appointment"));
    assert.equal(runtimePaths(store).length, 0);
  }
  const staleToken = seedStore();
  await assert.rejects(
    recordSyntheticAiRetrospective({
      db: staleToken.db, config, emulator,
      actor: { uid: ACTOR_UID, authTime: new Date(NOW.getTime() - 16 * 60_000) },
      request: request("appointment"), now: NOW,
    }),
    code("recent_auth_required"),
  );
  const supervisor = seedStore();
  supervisor.records.set(`${PREFIX}/members/${ACTOR_UID}`, membership({
    role: "supervisor", scopeMode: "assigned",
    teamIds: ["team_demo_general"], locationIds: ["location_demo_wattala"],
  }));
  assert.equal((await call(supervisor, "mixed")).result.outcome, "human_takeover_already_present");
  const clinical = seedStore();
  clinical.records.set(`${PREFIX}/members/${ACTOR_UID}`, membership({
    role: "clinical_approver", scopeMode: "assigned",
    teamIds: ["team_demo_clinical_escalation"], locationIds: ["location_demo_wattala"],
  }));
  assert.equal((await call(clinical, "urgent")).result.outcome, "safety_hold_already_present");
});

test("receipt identity is scenario-independent while request hash binds the scenario", () => {
  const key = "ai-retrospective-shared-key-0001";
  const receiptId = aiReceiptDocumentId({ actorUid: ACTOR_UID, action: AI_GOVERNANCE_ACTION, idempotencyKey: key });
  assert.equal(
    receiptId,
    aiReceiptDocumentId({ actorUid: ACTOR_UID, action: AI_GOVERNANCE_ACTION, idempotencyKey: key }),
  );
  assert.notEqual(
    aiCallRequestFingerprint({ actorUid: ACTOR_UID, workspaceId: AI_GOVERNANCE_WORKSPACE_ID, scenarioId: "appointment" }),
    aiCallRequestFingerprint({ actorUid: ACTOR_UID, workspaceId: AI_GOVERNANCE_WORKSPACE_ID, scenarioId: "urgent" }),
  );
  assert.doesNotThrow(() => assertAiGovernanceRuntimeBoundary(config, emulator, AI_GOVERNANCE_WORKSPACE_ID));
  assert.ok(Date.parse(AI_GOVERNANCE_EVALUATED_AT) < NOW.getTime());
});
