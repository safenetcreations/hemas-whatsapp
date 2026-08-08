import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  SYNTHETIC_AUDIENCE_COUNTS,
  countSyntheticEligibleBefore,
  planSyntheticEligibleBatch,
} from "../src/campaigns/audience.js";
import {
  SYNTHETIC_AUDIENCE_SNAPSHOT_ID,
  SYNTHETIC_CAMPAIGN_APPROVER_UID,
  SYNTHETIC_CAMPAIGN_ID,
  SYNTHETIC_CAMPAIGN_OWNER_UID,
  SYNTHETIC_CAMPAIGN_TEMPLATE_CONTENT_HASHES,
  SYNTHETIC_CAMPAIGN_TEMPLATE_IDS,
  canonicalCampaignApprovalSerialization,
  canonicalTemplateContentSerialization,
  computeCampaignApprovalHash,
  assertStoredSyntheticCampaignTemplate,
  parseStoredSyntheticAudienceSnapshot,
  parseStoredSyntheticCampaign,
  parseSyntheticCampaignControlInput,
  type SyntheticCampaignControlAction,
  type SyntheticCampaignControlInput,
} from "../src/campaigns/contracts.js";
import { controlSyntheticCampaign } from "../src/campaigns/service.js";
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
            const value = staged.get(reference.path);
            return {
              exists: value !== undefined,
              data: () => value,
              ref: reference,
              id: reference.path.split("/").at(-1) ?? "",
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

const WORKSPACE_ID = "workspace_safenet_demo";
const ADMIN_UID = "user_demo_tenant_admin";
const OUTSIDER_UID = "user_demo_other_operator";
const NOW = new Date("2026-08-07T12:00:00.000Z");
const CREATED_AT = new Date("2026-08-07T10:00:00.000Z");
const STARTS_AT = new Date("2026-08-10T03:30:00.000Z");
const SNAPSHOT_CONTENT_HASH =
  "7a4d8ce2bc1bafc224e5e2b91a2fc3f8b20b5f062ff1563ca4cf25847ad0d550";
const APPROVAL_HASH =
  "6bdce27c7e31e5e064febd7b4dcbd05df208a4ddf33085003848bbfd81c1b1cd";
const GOLDEN_SERIALIZATION =
  '["hemas-connect:campaign-approval:v2","workspace_safenet_demo","campaign_synthetic_50k","audience_synthetic_50k_v1","7a4d8ce2bc1bafc224e5e2b91a2fc3f8b20b5f062ff1563ca4cf25847ad0d550","template_wellness_awareness_en_v3","0cbf38327d7d48ee61558927c6afb8e4e75c1781561906ebbab4def379e6c04f","template_wellness_awareness_si_v3","cefbdf676d18b06dfcc4263e659c0585db48de7e7843b57b32566d2215536582","template_wellness_awareness_ta_v3","c477a31ee0344bef6c66a25a0a70848f6a0a75262f0df328dd8b04e6479a2b12","health_campaigns","marketing","Open the synthetic wellness information journey","2026-08-10T03:30:00.000Z","Asia/Colombo","20:00","08:00"]';
const EN_TEMPLATE_GOLDEN_SERIALIZATION =
  '["hemas-connect:template-content:v1","workspace_safenet_demo","template_wellness_awareness_en_v3","wellness_awareness","wellness_awareness","marketing","en",3,[["body",null,"{{patient_ref}}, this approved internal synthetic template shares wellness awareness information about {{campaign_topic}}.",[]],["footer",null,"Reply STOP to stop marketing messages.",[]]],[["patient_ref","Masked synthetic patient reference",true,24,"SYN-P000862","^SYN-P[0-9]{6}$"],["campaign_topic","Approved neutral campaign topic",true,70,"Dengue prevention",null]]]';

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

const emulator = {
  projectId: "demo-hemas-connect",
  firestoreEmulatorHost: "127.0.0.1:8080",
} as const;

function membership(
  uid: string,
  role: string,
  status = "active",
): MemoryRecord {
  return {
    id: uid,
    uid,
    workspaceId: WORKSPACE_ID,
    displayLabel: "Synthetic campaign member",
    role,
    status,
    scopeMode: "assigned",
    teamIds: [],
    locationIds: [],
    synthetic: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function campaign(overrides: MemoryRecord = {}): MemoryRecord {
  return {
    id: SYNTHETIC_CAMPAIGN_ID,
    workspaceId: WORKSPACE_ID,
    name: "Synthetic 50,000-contact wellness awareness simulation",
    purpose: "health_campaigns",
    messageCategory: "marketing",
    targetAction: "Open the synthetic wellness information journey",
    ownerId: SYNTHETIC_CAMPAIGN_OWNER_UID,
    templateVersionIds: { ...SYNTHETIC_CAMPAIGN_TEMPLATE_IDS },
    audienceSnapshotId: SYNTHETIC_AUDIENCE_SNAPSHOT_ID,
    state: "scheduled",
    dispatchMode: "simulation",
    schedule: {
      startsAt: STARTS_AT,
      timeZone: "Asia/Colombo",
      quietHours: { startsAtLocal: "20:00", endsAtLocal: "08:00" },
    },
    approval: {
      required: true,
      status: "approved",
      scope: "simulation_only",
      approverId: SYNTHETIC_CAMPAIGN_APPROVER_UID,
      reviewedAt: CREATED_AT,
      approvedContentHash: APPROVAL_HASH,
    },
    revision: 0,
    canaryStatus: "not_run",
    processedEligible: 0,
    scanOffset: 0,
    nextBatchIndex: 0,
    batchSize: 1_000,
    lastCheckpointId: null,
    externalCalls: 0,
    networkCalls: 0,
    synthetic: true,
    schemaVersion: 1,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function audienceSnapshot(overrides: MemoryRecord = {}): MemoryRecord {
  return {
    id: SYNTHETIC_AUDIENCE_SNAPSHOT_ID,
    workspaceId: WORKSPACE_ID,
    campaignId: SYNTHETIC_CAMPAIGN_ID,
    criteriaSummary:
      "Synthetic consented wellness audience; deterministic aggregate exclusions only.",
    totalEvaluated: 50_000,
    eligibleCount: 38_443,
    excludedCount: 11_557,
    unknownConsentCount: 3_588,
    exclusionsByReason: {
      frequency_cap: 3_873,
      consent_missing: 3_588,
      suppressed: 2_915,
      duplicate: 444,
      invalid_contact: 442,
      language_unavailable: 295,
    },
    languageCounts: { en: 26_989, si: 12_038, ta: 10_973 },
    contentHash: SNAPSHOT_CONTENT_HASH,
    immutable: true,
    synthetic: true,
    schemaVersion: 1,
    finalizedAt: CREATED_AT,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function template(language: "en" | "si" | "ta", overrides: MemoryRecord = {}): MemoryRecord {
  const localized = {
    en: {
      body: "{{patient_ref}}, this approved internal synthetic template shares wellness awareness information about {{campaign_topic}}.",
      footer: "Reply STOP to stop marketing messages.",
    },
    si: {
      body: "{{patient_ref}}, {{campaign_topic}} පිළිබඳ සුවතා දැනුවත් කිරීම සඳහා අභ්‍යන්තරව අනුමත කළ කෘත්‍රිම ආදර්ශය මෙයයි.",
      footer: "අලෙවිකරණ පණිවිඩ නැවැත්වීමට STOP යවන්න.",
    },
    ta: {
      body: "{{patient_ref}}, {{campaign_topic}} குறித்த நலவாழ்வு விழிப்புணர்வுக்காக உள்நிலையில் அங்கீகரிக்கப்பட்ட செயற்கை வார்ப்புரு இது.",
      footer: "சந்தைப்படுத்தல் செய்திகளை நிறுத்த STOP எனப் பதிலளிக்கவும்.",
    },
  } as const;
  return {
    id: SYNTHETIC_CAMPAIGN_TEMPLATE_IDS[language],
    workspaceId: WORKSPACE_ID,
    assetKey: "wellness_awareness",
    sortKey: `wellness_awareness:${language}:0003`,
    providerName: "wellness_awareness",
    category: "marketing",
    language,
    version: 3,
    localState: "approved",
    providerState: {
      submissionState: "not_submitted",
      approvalState: "unverified",
      authority: "none",
      assetId: null,
      qualityRating: "unknown",
      checkedAt: null,
    },
    immutable: true,
    contentHash: SYNTHETIC_CAMPAIGN_TEMPLATE_CONTENT_HASHES[language],
    components: [
      {
        kind: "body",
        text: localized[language].body,
      },
      { kind: "footer", text: localized[language].footer },
    ],
    variableRules: [
      {
        key: "patient_ref",
        description: "Masked synthetic patient reference",
        required: true,
        maxLength: 24,
        exampleValue: "SYN-P000862",
        allowedPattern: "^SYN-P[0-9]{6}$",
      },
      {
        key: "campaign_topic",
        description: "Approved neutral campaign topic",
        required: true,
        maxLength: 70,
        exampleValue: "Dengue prevention",
        allowedPattern: null,
      },
    ],
    ownership: {
      ownerKind: "safenet_demo",
      ownerWorkspaceId: WORKSPACE_ID,
      transferableToHemas: false,
      productionUseAllowed: false,
      notice: "SafeNet demo asset. It is not a Hemas-owned or transferable production asset.",
    },
    synthetic: true,
    schemaVersion: 1,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function governedTemplateBindings() {
  return {
    en: assertStoredSyntheticCampaignTemplate(template("en"), {
      workspaceId: WORKSPACE_ID,
      templateId: SYNTHETIC_CAMPAIGN_TEMPLATE_IDS.en,
      language: "en",
    }),
    si: assertStoredSyntheticCampaignTemplate(template("si"), {
      workspaceId: WORKSPACE_ID,
      templateId: SYNTHETIC_CAMPAIGN_TEMPLATE_IDS.si,
      language: "si",
    }),
    ta: assertStoredSyntheticCampaignTemplate(template("ta"), {
      workspaceId: WORKSPACE_ID,
      templateId: SYNTHETIC_CAMPAIGN_TEMPLATE_IDS.ta,
      language: "ta",
    }),
  } as const;
}

function seedStore(): MemoryAdminTransactionStore {
  const store = new MemoryAdminTransactionStore();
  store.records.set(`workspaces/${WORKSPACE_ID}`, {
    id: WORKSPACE_ID,
    name: "SafeNet synthetic demo",
    status: "active",
    mode: "demo",
    dataClassification: "synthetic_only",
  });
  store.records.set(
    `workspaces/${WORKSPACE_ID}/members/${SYNTHETIC_CAMPAIGN_OWNER_UID}`,
    membership(SYNTHETIC_CAMPAIGN_OWNER_UID, "campaign_operator"),
  );
  store.records.set(
    `workspaces/${WORKSPACE_ID}/members/${SYNTHETIC_CAMPAIGN_APPROVER_UID}`,
    membership(SYNTHETIC_CAMPAIGN_APPROVER_UID, "campaign_approver"),
  );
  store.records.set(
    `workspaces/${WORKSPACE_ID}/campaigns/${SYNTHETIC_CAMPAIGN_ID}`,
    campaign(),
  );
  store.records.set(
    `workspaces/${WORKSPACE_ID}/audienceSnapshots/${SYNTHETIC_AUDIENCE_SNAPSHOT_ID}`,
    audienceSnapshot(),
  );
  for (const language of ["en", "si", "ta"] as const) {
    store.records.set(
      `workspaces/${WORKSPACE_ID}/templates/${SYNTHETIC_CAMPAIGN_TEMPLATE_IDS[language]}`,
      template(language),
    );
  }
  return store;
}

function campaignPath(): string {
  return `workspaces/${WORKSPACE_ID}/campaigns/${SYNTHETIC_CAMPAIGN_ID}`;
}

function paths(store: MemoryAdminTransactionStore, collection: string): readonly string[] {
  const marker = `/${collection}/`;
  return [...store.records.keys()].filter((path) => path.includes(marker));
}

function request(
  action: SyntheticCampaignControlAction,
  expectedRevision: number,
  idempotencyKey: string,
): SyntheticCampaignControlInput {
  return {
    workspaceId: WORKSPACE_ID,
    campaignId: SYNTHETIC_CAMPAIGN_ID,
    action,
    expectedRevision,
    idempotencyKey,
  };
}

function actor(uid: string, now: Date, ageSeconds = 60) {
  return { uid, authTime: new Date(now.getTime() - ageSeconds * 1_000) };
}

function hasCode(expected: string): (error: unknown) => boolean {
  return (error: unknown) =>
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { readonly code: unknown }).code === expected;
}

async function invoke(input: {
  readonly store: MemoryAdminTransactionStore;
  readonly request: SyntheticCampaignControlInput;
  readonly now?: Date;
  readonly actorUid?: string;
  readonly authAgeSeconds?: number;
  readonly config?: RuntimeConfig;
  readonly boundary?: typeof emulator;
}) {
  const now = input.now ?? NOW;
  const actorUid = input.actorUid ?? SYNTHETIC_CAMPAIGN_OWNER_UID;
  return controlSyntheticCampaign({
    db: input.store.db,
    config: input.config ?? runtimeConfig,
    emulator: input.boundary ?? emulator,
    actor: actor(actorUid, now, input.authAgeSeconds),
    request: input.request,
    now,
  });
}

function nextRequest(
  store: MemoryAdminTransactionStore,
  action: SyntheticCampaignControlAction,
  key: string,
): SyntheticCampaignControlInput {
  const revision = Number(store.records.get(campaignPath())?.revision);
  return request(action, revision, key);
}

async function prepareDispatch(store: MemoryAdminTransactionStore): Promise<void> {
  await invoke({
    store,
    request: nextRequest(store, "run_canary", "campaign-canary-00000001"),
    now: NOW,
  });
  await invoke({
    store,
    request: nextRequest(store, "start", "campaign-start-000000001"),
    now: new Date(NOW.getTime() + 1_000),
  });
}

test("campaign request is an exact metadata-only action allowlist", () => {
  const valid = request("run_canary", 0, "campaign-canary-00000001");
  assert.deepEqual(parseSyntheticCampaignControlInput(valid), valid);
  for (const invalid of [
    { ...valid, action: "send" },
    { ...valid, expectedRevision: -1 },
    { ...valid, idempotencyKey: "short" },
    { ...valid, campaignId: "campaign_other" },
    { ...valid, recipientIds: ["contact-1"] },
    { ...valid, messageBody: "not accepted" },
    { ...valid, providerMessageId: "not accepted" },
  ]) {
    assert.throws(() => parseSyntheticCampaignControlInput(invalid), {
      code: "invalid_service_request",
    });
  }
});

test("golden campaign approval bytes and SHA-256 match the independent seed vector", () => {
  const parsedCampaign = parseStoredSyntheticCampaign(campaign(), {
    workspaceId: WORKSPACE_ID,
    campaignId: SYNTHETIC_CAMPAIGN_ID,
  });
  const parsedSnapshot = parseStoredSyntheticAudienceSnapshot(audienceSnapshot(), {
    workspaceId: WORKSPACE_ID,
    snapshotId: SYNTHETIC_AUDIENCE_SNAPSHOT_ID,
  });
  const templates = governedTemplateBindings();
  const serialized = canonicalCampaignApprovalSerialization({
    campaign: parsedCampaign,
    snapshot: parsedSnapshot,
    templates,
  });
  assert.equal(serialized, GOLDEN_SERIALIZATION);
  assert.equal(computeCampaignApprovalHash({
    campaign: parsedCampaign,
    snapshot: parsedSnapshot,
    templates,
  }), APPROVAL_HASH);
  assert.notEqual(APPROVAL_HASH, SNAPSHOT_CONTENT_HASH);
});

test("golden template-content bytes bind actual body and variable governance", () => {
  const raw = template("en") as Record<string, unknown>;
  const serialized = canonicalTemplateContentSerialization({
    workspaceId: WORKSPACE_ID,
    id: SYNTHETIC_CAMPAIGN_TEMPLATE_IDS.en,
    assetKey: "wellness_awareness",
    providerName: "wellness_awareness",
    category: "marketing",
    language: "en",
    version: 3,
    components: raw.components as Parameters<
      typeof canonicalTemplateContentSerialization
    >[0]["components"],
    variableRules: raw.variableRules as Parameters<
      typeof canonicalTemplateContentSerialization
    >[0]["variableRules"],
  });
  assert.equal(serialized, EN_TEMPLATE_GOLDEN_SERIALIZATION);
  assert.equal(
    createHash("sha256").update(serialized, "utf8").digest("hex"),
    SYNTHETIC_CAMPAIGN_TEMPLATE_CONTENT_HASHES.en,
  );
});

test("service reparses exported input and requires the emulator-safe durable runtime", async () => {
  const invalidRequests = [
    { ...request("run_canary", 0, "campaign-canary-00000001"), action: "send" },
    { ...request("run_canary", 0, "campaign-canary-00000001"), extra: "pollution" },
  ];
  for (const unsafeRequest of invalidRequests) {
    const store = seedStore();
    await assert.rejects(
      controlSyntheticCampaign({
        db: store.db,
        config: runtimeConfig,
        emulator,
        actor: actor(SYNTHETIC_CAMPAIGN_OWNER_UID, NOW),
        request: unsafeRequest as unknown as SyntheticCampaignControlInput,
        now: NOW,
      }),
      hasCode("invalid_service_request"),
    );
    assert.equal(paths(store, "campaignEvents").length, 0);
  }

  for (const config of [
    { ...runtimeConfig, runtimeMode: "uat" as const },
    { ...runtimeConfig, providerMode: "live" as const },
    { ...runtimeConfig, hemasIntegrationMode: "disabled" as const },
    { ...runtimeConfig, auditSinkMode: "memory" as const },
    { ...runtimeConfig, outboundEnabled: true },
    { ...runtimeConfig, approvalGateRequired: false },
    { ...runtimeConfig, diagnosisEnabled: true } as unknown as RuntimeConfig,
    { ...runtimeConfig, defaultTenantId: "workspace_other_demo" },
  ]) {
    const store = seedStore();
    await assert.rejects(
      invoke({
        store,
        request: request("run_canary", 0, "campaign-canary-00000001"),
        config,
      }),
      hasCode("campaign_service_disabled"),
    );
  }

  for (const boundary of [
    { ...emulator, projectId: "production-project" },
    { ...emulator, firestoreEmulatorHost: undefined },
    { ...emulator, firestoreEmulatorHost: "firestore.googleapis.com:443" },
  ]) {
    const store = seedStore();
    await assert.rejects(
      controlSyntheticCampaign({
        db: store.db,
        config: runtimeConfig,
        emulator: boundary,
        actor: actor(SYNTHETIC_CAMPAIGN_OWNER_UID, NOW),
        request: request("run_canary", 0, "campaign-canary-00000001"),
        now: NOW,
      }),
      (error: unknown) => hasCode("invalid_audit_project")(error) ||
        hasCode("audit_emulator_required")(error) ||
        hasCode("invalid_audit_emulator")(error),
    );
  }
});

test("operator ownership, tenant-admin policy, exact owner join and recent auth fail closed", async () => {
  const ownerStore = seedStore();
  assert.equal((await invoke({
    store: ownerStore,
    request: request("run_canary", 0, "campaign-owner-00000001"),
  })).result.canaryStatus, "passed_simulation");

  const adminStore = seedStore();
  adminStore.records.set(
    `workspaces/${WORKSPACE_ID}/members/${ADMIN_UID}`,
    membership(ADMIN_UID, "tenant_admin"),
  );
  assert.equal((await invoke({
    store: adminStore,
    actorUid: ADMIN_UID,
    request: request("run_canary", 0, "campaign-admin-00000001"),
  })).result.canaryStatus, "passed_simulation");

  const outsiderStore = seedStore();
  outsiderStore.records.set(
    `workspaces/${WORKSPACE_ID}/members/${OUTSIDER_UID}`,
    membership(OUTSIDER_UID, "campaign_operator"),
  );
  await assert.rejects(
    invoke({
      store: outsiderStore,
      actorUid: OUTSIDER_UID,
      request: request("run_canary", 0, "campaign-outsider-00001"),
    }),
    hasCode("campaign_owner_denied"),
  );

  for (const ownerMutation of [
    null,
    membership(SYNTHETIC_CAMPAIGN_OWNER_UID, "campaign_operator", "revoked"),
    membership(SYNTHETIC_CAMPAIGN_OWNER_UID, "analyst"),
    {
      ...membership(SYNTHETIC_CAMPAIGN_OWNER_UID, "campaign_operator"),
      synthetic: false,
    },
    {
      ...membership(SYNTHETIC_CAMPAIGN_OWNER_UID, "campaign_operator"),
      teamIds: ["team_outpatient"],
    },
  ]) {
    const store = seedStore();
    store.records.set(
      `workspaces/${WORKSPACE_ID}/members/${ADMIN_UID}`,
      membership(ADMIN_UID, "tenant_admin"),
    );
    const ownerPath =
      `workspaces/${WORKSPACE_ID}/members/${SYNTHETIC_CAMPAIGN_OWNER_UID}`;
    if (ownerMutation === null) store.records.delete(ownerPath);
    else store.records.set(ownerPath, ownerMutation);
    await assert.rejects(
      invoke({
        store,
        actorUid: ADMIN_UID,
        request: request("run_canary", 0, `campaign-owner-join-${store.records.size}`),
      }),
      hasCode("campaign_owner_denied"),
    );
  }

  const wrongRole = seedStore();
  wrongRole.records.set(
    `workspaces/${WORKSPACE_ID}/members/${OUTSIDER_UID}`,
    membership(OUTSIDER_UID, "campaign_approver"),
  );
  await assert.rejects(
    invoke({
      store: wrongRole,
      actorUid: OUTSIDER_UID,
      request: request("run_canary", 0, "campaign-role-denied-001"),
    }),
    hasCode("role_denied"),
  );

  const stale = seedStore();
  await assert.rejects(
    invoke({
      store: stale,
      authAgeSeconds: 901,
      request: request("run_canary", 0, "campaign-stale-auth-0001"),
    }),
    hasCode("recent_auth_required"),
  );
});

test("strict campaign, snapshot, approver and three-template governance joins reject drift", async () => {
  const mutations: readonly ((store: MemoryAdminTransactionStore) => void)[] = [
    (store) => {
      const value = store.records.get(campaignPath()) ?? {};
      store.records.set(campaignPath(), { ...value, targetAction: "Changed after approval" });
    },
    (store) => {
      const path =
        `workspaces/${WORKSPACE_ID}/audienceSnapshots/${SYNTHETIC_AUDIENCE_SNAPSHOT_ID}`;
      const value = store.records.get(path) ?? {};
      store.records.set(path, { ...value, eligibleCount: 38_442 });
    },
    (store) => {
      const path =
        `workspaces/${WORKSPACE_ID}/audienceSnapshots/${SYNTHETIC_AUDIENCE_SNAPSHOT_ID}`;
      const value = store.records.get(path) ?? {};
      store.records.set(path, { ...value, contentHash: "0".repeat(64) });
    },
    (store) => {
      const path =
        `workspaces/${WORKSPACE_ID}/templates/${SYNTHETIC_CAMPAIGN_TEMPLATE_IDS.si}`;
      store.records.delete(path);
    },
    (store) => {
      const path =
        `workspaces/${WORKSPACE_ID}/templates/${SYNTHETIC_CAMPAIGN_TEMPLATE_IDS.en}`;
      const value = store.records.get(path) ?? {};
      store.records.set(path, {
        ...value,
        providerState: {
          submissionState: "submitted",
          approvalState: "approved",
          authority: "meta",
          assetId: "provider-id-forbidden",
          qualityRating: "high",
          checkedAt: NOW,
        },
      });
    },
    (store) => {
      const value = store.records.get(campaignPath()) ?? {};
      const approval = (value.approval ?? {}) as MemoryRecord;
      store.records.set(campaignPath(), {
        ...value,
        approval: {
          ...approval,
          approvedContentHash:
            "9ce71fb2c2af22d0490b939228f8b042262f78cd283de25b53e1a9a341d0e3e1",
        },
      });
    },
    (store) => {
      const path =
        `workspaces/${WORKSPACE_ID}/templates/${SYNTHETIC_CAMPAIGN_TEMPLATE_IDS.en}`;
      const value = store.records.get(path) ?? {};
      store.records.set(path, { ...value, contentHash: "0".repeat(64) });
    },
    (store) => {
      const path =
        `workspaces/${WORKSPACE_ID}/templates/${SYNTHETIC_CAMPAIGN_TEMPLATE_IDS.en}`;
      const value = store.records.get(path) ?? {};
      const components = value.components as readonly MemoryRecord[];
      store.records.set(path, {
        ...value,
        components: components.map((component) =>
          component.kind === "body"
            ? { ...component, text: "Drifted {{patient_ref}} {{campaign_topic}} body." }
            : component,
        ),
      });
    },
    (store) => {
      const path =
        `workspaces/${WORKSPACE_ID}/templates/${SYNTHETIC_CAMPAIGN_TEMPLATE_IDS.en}`;
      const value = store.records.get(path) ?? {};
      const components = value.components as readonly MemoryRecord[];
      store.records.set(path, {
        ...value,
        components: [
          ...components,
          {
            kind: "buttons",
            buttons: [
              {
                type: "quick_reply",
                label: "Open {{patient_ref}}",
                targetRef: "open:{{campaign_topic}}",
              },
            ],
          },
        ],
      });
    },
    (store) => {
      const path =
        `workspaces/${WORKSPACE_ID}/templates/${SYNTHETIC_CAMPAIGN_TEMPLATE_IDS.en}`;
      const value = store.records.get(path) ?? {};
      const variableRules = value.variableRules as readonly MemoryRecord[];
      store.records.set(path, {
        ...value,
        variableRules: variableRules.map((rule, index) =>
          index === 0 ? { ...rule, maxLength: 25 } : rule,
        ),
      });
    },
    (store) => {
      const path =
        `workspaces/${WORKSPACE_ID}/templates/${SYNTHETIC_CAMPAIGN_TEMPLATE_IDS.en}`;
      const value = store.records.get(path) ?? {};
      const components = value.components as readonly MemoryRecord[];
      store.records.set(path, {
        ...value,
        components: components.map((component) =>
          component.kind === "body"
            ? { ...component, text: `${String(component.text)} {{unknown_ref}}` }
            : component,
        ),
      });
    },
    (store) => {
      const path =
        `workspaces/${WORKSPACE_ID}/templates/${SYNTHETIC_CAMPAIGN_TEMPLATE_IDS.en}`;
      const value = store.records.get(path) ?? {};
      const variableRules = value.variableRules as readonly MemoryRecord[];
      store.records.set(path, { ...value, variableRules: variableRules.slice(0, 1) });
    },
    (store) => {
      const path =
        `workspaces/${WORKSPACE_ID}/members/${SYNTHETIC_CAMPAIGN_APPROVER_UID}`;
      store.records.set(path, membership(SYNTHETIC_CAMPAIGN_APPROVER_UID, "analyst"));
    },
    (store) => {
      const path =
        `workspaces/${WORKSPACE_ID}/members/${SYNTHETIC_CAMPAIGN_APPROVER_UID}`;
      store.records.set(path, {
        ...membership(SYNTHETIC_CAMPAIGN_APPROVER_UID, "campaign_approver"),
        synthetic: false,
      });
    },
    (store) => {
      const path =
        `workspaces/${WORKSPACE_ID}/members/${SYNTHETIC_CAMPAIGN_APPROVER_UID}`;
      store.records.set(path, {
        ...membership(SYNTHETIC_CAMPAIGN_APPROVER_UID, "campaign_approver"),
        scopeMode: "workspace_wide",
      });
    },
    (store) => {
      const path =
        `workspaces/${WORKSPACE_ID}/members/${SYNTHETIC_CAMPAIGN_APPROVER_UID}`;
      store.records.set(path, {
        ...membership(SYNTHETIC_CAMPAIGN_APPROVER_UID, "campaign_approver"),
        locationIds: ["location_wattala"],
      });
    },
  ];
  const expected = [
    "campaign_approval_invalidated",
    "campaign_snapshot_denied",
    "campaign_snapshot_denied",
    "campaign_template_denied",
    "campaign_template_denied",
    "campaign_approval_invalidated",
    "campaign_template_denied",
    "campaign_template_denied",
    "campaign_template_denied",
    "campaign_template_denied",
    "campaign_template_denied",
    "campaign_template_denied",
    "campaign_approval_denied",
    "campaign_approval_denied",
    "campaign_approval_denied",
    "campaign_approval_denied",
  ];
  for (const [index, mutate] of mutations.entries()) {
    const store = seedStore();
    mutate(store);
    await assert.rejects(
      invoke({
        store,
        request: request("run_canary", 0, `campaign-join-denial-${index}`),
      }),
      hasCode(expected[index] ?? ""),
    );
    assert.equal(paths(store, "campaignEvents").length, 0);
    assert.equal(paths(store, "idempotencyKeys").length, 0);
  }
});

test("canary atomically creates one event, redacted audit and replay record with zero calls", async () => {
  const store = seedStore();
  const canaryRequest = request("run_canary", 0, "campaign-canary-atomic-01");
  const first = await invoke({ store, request: canaryRequest, now: NOW });
  assert.equal(first.replayed, false);
  assert.deepEqual(first.result, {
    campaignId: SYNTHETIC_CAMPAIGN_ID,
    eventId: first.result.eventId,
    checkpointId: null,
    action: "run_canary",
    state: "scheduled",
    revision: 1,
    canaryStatus: "passed_simulation",
    processedEligible: 0,
    scanOffset: 0,
    nextBatchIndex: 0,
    batchEligibleCount: 25,
    synthetic: true,
    externalCalls: 0,
    networkCalls: 0,
  });
  assert.equal(paths(store, "campaignEvents").length, 1);
  assert.equal(paths(store, "campaignCheckpoints").length, 0);
  assert.equal(paths(store, "idempotencyKeys").length, 1);
  assert.equal(paths(store, "auditEvents").length, 1);
  assert.equal(paths(store, "campaignRecipients").length, 0);

  const event = store.records.get(paths(store, "campaignEvents")[0] ?? "");
  assert.deepEqual(
    {
      actorUid: event?.actorUid,
      action: event?.action,
      fromState: event?.fromState,
      toState: event?.toState,
      checkpointId: event?.checkpointId,
      externalCalls: event?.externalCalls,
      networkCalls: event?.networkCalls,
    },
    {
      actorUid: SYNTHETIC_CAMPAIGN_OWNER_UID,
      action: "run_canary",
      fromState: "scheduled",
      toState: "scheduled",
      checkpointId: null,
      externalCalls: 0,
      networkCalls: 0,
    },
  );
  const audit = store.records.get(paths(store, "auditEvents")[0] ?? "");
  assert.equal(audit?.id, first.auditEventId);
  assert.deepEqual(audit?.metadata, {
    purpose: "campaign_governance",
    campaignAction: "run_canary",
    fromState: "scheduled",
    toState: "scheduled",
    revision: 1,
    checkpointId: null,
    batchEligibleCount: 25,
    processedEligible: 0,
    scanOffset: 0,
    dispatchMode: "simulation",
    synthetic: true,
    externalCalls: 0,
    networkCalls: 0,
  });
  assert.doesNotMatch(
    JSON.stringify(audit),
    /phone|patient|messageBody|providerMessageId|recipientIds/i,
  );

  const count = store.records.size;
  const replay = await invoke({
    store,
    request: canaryRequest,
    now: new Date(NOW.getTime() + 30_000),
  });
  assert.deepEqual(replay, { ...first, replayed: true });
  assert.equal(store.records.size, count);
});

test("start requires the canary and the first advance writes one exact bounded checkpoint", async () => {
  const deniedStore = seedStore();
  await assert.rejects(
    invoke({
      store: deniedStore,
      request: request("start", 0, "campaign-start-without-canary"),
    }),
    hasCode("campaign_transition_denied"),
  );

  const store = seedStore();
  await prepareDispatch(store);
  const advance = await invoke({
    store,
    request: nextRequest(store, "advance_batch", "campaign-advance-0000001"),
    now: new Date(NOW.getTime() + 2_000),
  });
  assert.equal(advance.result.state, "dispatching");
  assert.equal(advance.result.processedEligible, 1_000);
  assert.equal(advance.result.scanOffset, 1_304);
  assert.equal(advance.result.nextBatchIndex, 1);
  assert.equal(advance.result.batchEligibleCount, 1_000);
  assert.equal(
    advance.result.checkpointId,
    "campaign_synthetic_50k:checkpoint:000000",
  );
  assert.equal(paths(store, "campaignCheckpoints").length, 1);
  assert.equal(paths(store, "campaignRecipients").length, 0);
  const checkpoint = store.records.get(paths(store, "campaignCheckpoints")[0] ?? "");
  assert.deepEqual(
    {
      batchIndex: checkpoint?.batchIndex,
      sourceOffsetStart: checkpoint?.sourceOffsetStart,
      sourceOffsetEnd: checkpoint?.sourceOffsetEnd,
      eligibleCount: checkpoint?.eligibleCount,
      languageCounts: checkpoint?.languageCounts,
      processedEligible: checkpoint?.processedEligible,
      scanComplete: checkpoint?.scanComplete,
      eventId: checkpoint?.eventId,
    },
    {
      batchIndex: 0,
      sourceOffsetStart: 0,
      sourceOffsetEnd: 1_304,
      eligibleCount: 1_000,
      languageCounts: { en: 525, si: 243, ta: 232 },
      processedEligible: 1_000,
      scanComplete: false,
      eventId: advance.result.eventId,
    },
  );
  assert.match(String(checkpoint?.digest), /^[a-f0-9]{64}$/);
});

test("39 advances reconcile 38,443 eligible records and finish with the exact 443 batch", async () => {
  const store = seedStore();
  await prepareDispatch(store);
  let finalResult: Awaited<ReturnType<typeof invoke>> | undefined;
  for (let batchIndex = 0; batchIndex < 39; batchIndex += 1) {
    finalResult = await invoke({
      store,
      request: nextRequest(
        store,
        "advance_batch",
        `campaign-advance-${String(batchIndex).padStart(8, "0")}`,
      ),
      now: new Date(NOW.getTime() + (batchIndex + 2) * 1_000),
    });
    assert.ok(finalResult.result.batchEligibleCount <= 1_000);
    assert.equal(paths(store, "campaignCheckpoints").length, batchIndex + 1);
  }
  assert.ok(finalResult);
  assert.deepEqual(
    {
      state: finalResult.result.state,
      processedEligible: finalResult.result.processedEligible,
      scanOffset: finalResult.result.scanOffset,
      nextBatchIndex: finalResult.result.nextBatchIndex,
      batchEligibleCount: finalResult.result.batchEligibleCount,
      checkpointId: finalResult.result.checkpointId,
    },
    {
      state: "completed",
      processedEligible: 38_443,
      scanOffset: 50_000,
      nextBatchIndex: 39,
      batchEligibleCount: 443,
      checkpointId: "campaign_synthetic_50k:checkpoint:000038",
    },
  );
  const finalCheckpoint = store.records.get(
    `workspaces/${WORKSPACE_ID}/campaignCheckpoints/campaign_synthetic_50k:checkpoint:000038`,
  );
  assert.deepEqual(
    {
      batchIndex: finalCheckpoint?.batchIndex,
      sourceOffsetStart: finalCheckpoint?.sourceOffsetStart,
      sourceOffsetEnd: finalCheckpoint?.sourceOffsetEnd,
      eligibleCount: finalCheckpoint?.eligibleCount,
      languageCounts: finalCheckpoint?.languageCounts,
      processedEligible: finalCheckpoint?.processedEligible,
      scanComplete: finalCheckpoint?.scanComplete,
    },
    {
      batchIndex: 38,
      sourceOffsetStart: 49_424,
      sourceOffsetEnd: 50_000,
      eligibleCount: 443,
      languageCounts: { en: 253, si: 98, ta: 92 },
      processedEligible: 38_443,
      scanComplete: true,
    },
  );
  assert.equal(paths(store, "campaignCheckpoints").length, 39);
  assert.equal(paths(store, "campaignEvents").length, 41);
  assert.equal(paths(store, "campaignRecipients").length, 0);
  assert.equal(store.records.get(campaignPath())?.externalCalls, 0);
  assert.equal(store.records.get(campaignPath())?.networkCalls, 0);
  await assert.rejects(
    invoke({
      store,
      request: nextRequest(store, "advance_batch", "campaign-after-complete-01"),
      now: new Date(NOW.getTime() + 60_000),
    }),
    hasCode("campaign_transition_denied"),
  );
});

test("pause/resume and recoverable fault/retry preserve progress and cancel is terminal", async () => {
  const store = seedStore();
  await prepareDispatch(store);
  await invoke({
    store,
    request: nextRequest(store, "advance_batch", "campaign-flow-advance-001"),
    now: new Date(NOW.getTime() + 2_000),
  });
  const before = store.records.get(campaignPath());
  const pause = await invoke({
    store,
    request: nextRequest(store, "pause", "campaign-flow-pause-0001"),
    now: new Date(NOW.getTime() + 3_000),
  });
  assert.equal(pause.result.state, "paused");
  const resume = await invoke({
    store,
    request: nextRequest(store, "resume", "campaign-flow-resume-001"),
    now: new Date(NOW.getTime() + 4_000),
  });
  assert.equal(resume.result.state, "dispatching");
  const fault = await invoke({
    store,
    request: nextRequest(store, "inject_fault", "campaign-flow-fault-0001"),
    now: new Date(NOW.getTime() + 5_000),
  });
  assert.equal(fault.result.state, "failed");
  assert.equal(fault.result.canaryStatus, "failed");
  const retry = await invoke({
    store,
    request: nextRequest(store, "retry", "campaign-flow-retry-0001"),
    now: new Date(NOW.getTime() + 6_000),
  });
  assert.equal(retry.result.state, "dispatching");
  assert.equal(retry.result.canaryStatus, "passed_simulation");
  const cancelled = await invoke({
    store,
    request: nextRequest(store, "cancel", "campaign-flow-cancel-0001"),
    now: new Date(NOW.getTime() + 7_000),
  });
  assert.equal(cancelled.result.state, "cancelled");
  assert.equal(cancelled.result.processedEligible, before?.processedEligible);
  assert.equal(cancelled.result.scanOffset, before?.scanOffset);
  assert.equal(paths(store, "campaignCheckpoints").length, 1);
  await assert.rejects(
    invoke({
      store,
      request: nextRequest(store, "resume", "campaign-flow-terminal-01"),
      now: new Date(NOW.getTime() + 8_000),
    }),
    hasCode("campaign_transition_denied"),
  );
});

test("fresh-seed cancel persists cancelled/not_run and replays without self-invalidating", async () => {
  const store = seedStore();
  const cancelRequest = request("cancel", 0, "campaign-fresh-cancel-0001");
  const first = await invoke({ store, request: cancelRequest, now: NOW });
  assert.equal(first.result.state, "cancelled");
  assert.equal(first.result.canaryStatus, "not_run");
  assert.equal(first.result.processedEligible, 0);
  const count = store.records.size;
  const replay = await invoke({
    store,
    request: cancelRequest,
    now: new Date(NOW.getTime() + 5_000),
  });
  assert.deepEqual(replay, { ...first, replayed: true });
  assert.equal(store.records.size, count);
});

test("older canary and advance idempotency keys replay after later valid actions", async () => {
  const store = seedStore();
  const canaryRequest = request("run_canary", 0, "campaign-old-canary-0001");
  const canary = await invoke({ store, request: canaryRequest, now: NOW });
  await invoke({
    store,
    request: nextRequest(store, "start", "campaign-old-start-00001"),
    now: new Date(NOW.getTime() + 1_000),
  });
  const canaryReplayCount = store.records.size;
  assert.deepEqual(
    await invoke({
      store,
      request: canaryRequest,
      now: new Date(NOW.getTime() + 2_000),
    }),
    { ...canary, replayed: true },
  );
  assert.equal(store.records.size, canaryReplayCount);

  const batchARequest = nextRequest(store, "advance_batch", "campaign-old-batch-a-001");
  const batchA = await invoke({
    store,
    request: batchARequest,
    now: new Date(NOW.getTime() + 3_000),
  });
  await invoke({
    store,
    request: nextRequest(store, "advance_batch", "campaign-old-batch-b-001"),
    now: new Date(NOW.getTime() + 4_000),
  });
  const batchReplayCount = store.records.size;
  assert.deepEqual(
    await invoke({
      store,
      request: batchARequest,
      now: new Date(NOW.getTime() + 5_000),
    }),
    { ...batchA, replayed: true },
  );
  assert.equal(store.records.size, batchReplayCount);
  assert.equal(paths(store, "campaignCheckpoints").length, 2);
  assert.equal(paths(store, "campaignEvents").length, 4);
});

test("older advance replay rejects a fully recomputed alternate checkpoint range", async () => {
  const store = seedStore();
  await prepareDispatch(store);
  const firstBatchRequest = nextRequest(
    store,
    "advance_batch",
    "campaign-old-range-bind-001",
  );
  const firstBatch = await invoke({
    store,
    request: firstBatchRequest,
    now: new Date(NOW.getTime() + 2_000),
  });
  await invoke({
    store,
    request: nextRequest(store, "advance_batch", "campaign-old-range-later-02"),
    now: new Date(NOW.getTime() + 3_000),
  });
  await invoke({
    store,
    request: nextRequest(store, "advance_batch", "campaign-old-range-later-03"),
    now: new Date(NOW.getTime() + 4_000),
  });

  const checkpointPath =
    `workspaces/${WORKSPACE_ID}/campaignCheckpoints/${String(firstBatch.result.checkpointId)}`;
  const checkpoint = store.records.get(checkpointPath) ?? {};
  const alternateBatch = planSyntheticEligibleBatch({
    sourceOffset: firstBatch.result.scanOffset,
    batchSize: 1_000,
    digestScope: [
      WORKSPACE_ID,
      SYNTHETIC_CAMPAIGN_ID,
      SNAPSHOT_CONTENT_HASH,
      APPROVAL_HASH,
      0,
    ].join(":"),
  });
  assert.notEqual(alternateBatch.sourceOffsetStart, checkpoint.sourceOffsetStart);
  assert.notEqual(alternateBatch.sourceOffsetEnd, checkpoint.sourceOffsetEnd);
  assert.notEqual(alternateBatch.digest, checkpoint.digest);
  assert.match(alternateBatch.digest, /^[a-f0-9]{64}$/);
  store.records.set(checkpointPath, {
    ...checkpoint,
    sourceOffsetStart: alternateBatch.sourceOffsetStart,
    sourceOffsetEnd: alternateBatch.sourceOffsetEnd,
    eligibleCount: alternateBatch.eligibleCount,
    languageCounts: alternateBatch.languageCounts,
    processedEligible: countSyntheticEligibleBefore(alternateBatch.sourceOffsetEnd),
    scanComplete: alternateBatch.scanComplete,
    digest: alternateBatch.digest,
  });

  const recordCount = store.records.size;
  await assert.rejects(
    invoke({
      store,
      request: firstBatchRequest,
      now: new Date(NOW.getTime() + 5_000),
    }),
    hasCode("campaign_checkpoint_denied"),
  );
  assert.equal(store.records.size, recordCount);
});

test("older idempotency evidence rejects state and timestamp rollback", async () => {
  const stateStore = seedStore();
  await invoke({
    store: stateStore,
    request: request("run_canary", 0, "campaign-rollback-canary-1"),
    now: NOW,
  });
  const stateStartRequest = nextRequest(
    stateStore,
    "start",
    "campaign-rollback-start-01",
  );
  await invoke({
    store: stateStore,
    request: stateStartRequest,
    now: new Date(NOW.getTime() + 1_000),
  });
  const currentState = stateStore.records.get(campaignPath()) ?? {};
  stateStore.records.set(campaignPath(), {
    ...currentState,
    state: "scheduled",
    revision: 3,
    updatedAt: new Date(NOW.getTime() + 2_000),
  });
  await assert.rejects(
    invoke({
      store: stateStore,
      request: stateStartRequest,
      now: new Date(NOW.getTime() + 3_000),
    }),
    hasCode("idempotency_conflict"),
  );

  const timeStore = seedStore();
  await invoke({
    store: timeStore,
    request: request("run_canary", 0, "campaign-rollback-canary-2"),
    now: NOW,
  });
  const timeStartRequest = nextRequest(
    timeStore,
    "start",
    "campaign-rollback-start-02",
  );
  await invoke({
    store: timeStore,
    request: timeStartRequest,
    now: new Date(NOW.getTime() + 1_000),
  });
  const currentTime = timeStore.records.get(campaignPath()) ?? {};
  timeStore.records.set(campaignPath(), {
    ...currentTime,
    state: "paused",
    revision: 3,
    updatedAt: new Date(NOW.getTime() - 1_000),
  });
  await assert.rejects(
    invoke({
      store: timeStore,
      request: timeStartRequest,
      now: new Date(NOW.getTime() + 3_000),
    }),
    hasCode("idempotency_conflict"),
  );
});

test("optimistic conflicts and deterministic event/checkpoint collisions roll back atomically", async () => {
  const revisionStore = seedStore();
  await assert.rejects(
    invoke({
      store: revisionStore,
      request: request("run_canary", 4, "campaign-revision-conflict"),
    }),
    hasCode("campaign_revision_conflict"),
  );
  assert.equal(paths(revisionStore, "campaignEvents").length, 0);
  assert.equal(paths(revisionStore, "auditEvents").length, 0);

  const eventStore = seedStore();
  const eventRequest = request("run_canary", 0, "campaign-event-collision-01");
  const idempotencyId = idempotencyDocumentId({
    workspaceId: WORKSPACE_ID,
    uid: SYNTHETIC_CAMPAIGN_OWNER_UID,
    action: "campaign.run_canary",
    key: eventRequest.idempotencyKey,
  });
  const eventId = deterministicId("campaign-event", idempotencyId);
  eventStore.records.set(
    `workspaces/${WORKSPACE_ID}/campaignEvents/${eventId}`,
    { id: eventId, collision: true },
  );
  await assert.rejects(
    invoke({ store: eventStore, request: eventRequest }),
    hasCode("campaign_event_collision"),
  );
  assert.equal(paths(eventStore, "idempotencyKeys").length, 0);
  assert.equal(paths(eventStore, "auditEvents").length, 0);

  const checkpointStore = seedStore();
  await prepareDispatch(checkpointStore);
  const checkpointId = "campaign_synthetic_50k:checkpoint:000000";
  checkpointStore.records.set(
    `workspaces/${WORKSPACE_ID}/campaignCheckpoints/${checkpointId}`,
    { id: checkpointId, collision: true },
  );
  const before = checkpointStore.records.size;
  await assert.rejects(
    invoke({
      store: checkpointStore,
      request: nextRequest(
        checkpointStore,
        "advance_batch",
        "campaign-checkpoint-collision",
      ),
    }),
    hasCode("campaign_checkpoint_collision"),
  );
  assert.equal(checkpointStore.records.size, before);
  assert.equal(paths(checkpointStore, "campaignEvents").length, 2);
});

test("replay rejects event, audit, idempotency and checkpoint evidence pollution", async () => {
  const mutations: readonly ((store: MemoryAdminTransactionStore) => void)[] = [
    (store) => {
      const path = paths(store, "campaignEvents").at(-1) ?? "";
      const value = store.records.get(path) ?? {};
      store.records.set(path, { ...value, toState: "cancelled" });
    },
    (store) => {
      const path = paths(store, "auditEvents").at(-1) ?? "";
      const value = store.records.get(path) ?? {};
      store.records.set(path, {
        ...value,
        metadata: { ...(value.metadata as MemoryRecord), purpose: "different" },
      });
    },
    (store) => {
      const path = paths(store, "idempotencyKeys").at(-1) ?? "";
      const value = store.records.get(path) ?? {};
      store.records.set(path, { ...value, unexpected: "pollution" });
    },
    (store) => {
      const path = paths(store, "campaignCheckpoints").at(-1) ?? "";
      const value = store.records.get(path) ?? {};
      store.records.set(path, { ...value, digest: "0".repeat(64) });
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const store = seedStore();
    await prepareDispatch(store);
    const advanceRequest = nextRequest(
      store,
      "advance_batch",
      `campaign-evidence-${String(index).padStart(8, "0")}`,
    );
    await invoke({
      store,
      request: advanceRequest,
      now: new Date(NOW.getTime() + 2_000),
    });
    mutate(store);
    await assert.rejects(
      invoke({
        store,
        request: advanceRequest,
        now: new Date(NOW.getTime() + 3_000),
      }),
      (error: unknown) => hasCode("idempotency_conflict")(error) ||
        hasCode("campaign_checkpoint_denied")(error),
    );
    assert.equal(paths(store, "campaignEvents").length, 3);
    assert.equal(paths(store, "campaignCheckpoints").length, 1);
  }
});

test("live last-checkpoint binding rejects a substituted raw scan range", async () => {
  const store = seedStore();
  await prepareDispatch(store);
  await invoke({
    store,
    request: nextRequest(store, "advance_batch", "campaign-offset-base-0001"),
    now: new Date(NOW.getTime() + 2_000),
  });
  const current = store.records.get(campaignPath()) ?? {};
  const originalOffset = Number(current.scanOffset);
  const checkpointPath = `workspaces/${WORKSPACE_ID}/campaignCheckpoints/${String(current.lastCheckpointId)}`;
  const checkpoint = store.records.get(checkpointPath) ?? {};
  const substitutedBatch = planSyntheticEligibleBatch({
    sourceOffset: originalOffset,
    batchSize: 1_000,
    digestScope: [
      WORKSPACE_ID,
      SYNTHETIC_CAMPAIGN_ID,
      SNAPSHOT_CONTENT_HASH,
      APPROVAL_HASH,
      0,
    ].join(":"),
  });
  assert.notEqual(substitutedBatch.sourceOffsetEnd, originalOffset);
  store.records.set(checkpointPath, {
    ...checkpoint,
    sourceOffsetStart: substitutedBatch.sourceOffsetStart,
    sourceOffsetEnd: substitutedBatch.sourceOffsetEnd,
    eligibleCount: substitutedBatch.eligibleCount,
    languageCounts: substitutedBatch.languageCounts,
    processedEligible: countSyntheticEligibleBefore(substitutedBatch.sourceOffsetEnd),
    scanComplete: substitutedBatch.scanComplete,
    digest: substitutedBatch.digest,
  });
  await assert.rejects(
    invoke({
      store,
      request: nextRequest(store, "pause", "campaign-offset-substitute"),
      now: new Date(NOW.getTime() + 3_000),
    }),
    hasCode("campaign_checkpoint_denied"),
  );
  assert.equal(paths(store, "campaignEvents").length, 3);
});

test("changed request reuse of an idempotency key is denied without duplicate evidence", async () => {
  const store = seedStore();
  const original = request("run_canary", 0, "campaign-idempotency-bind-1");
  await invoke({ store, request: original });
  const count = store.records.size;
  await assert.rejects(
    invoke({
      store,
      request: { ...original, expectedRevision: 1 },
      now: new Date(NOW.getTime() + 1_000),
    }),
    hasCode("idempotency_conflict"),
  );
  assert.equal(store.records.size, count);
  assert.equal(paths(store, "campaignEvents").length, 1);
  assert.equal(paths(store, "auditEvents").length, 1);
});

test("campaign control never persists recipients, provider IDs or external-call authority", async () => {
  const store = seedStore();
  await prepareDispatch(store);
  const response = await invoke({
    store,
    request: nextRequest(store, "advance_batch", "campaign-zero-calls-00001"),
    now: new Date(NOW.getTime() + 2_000),
  });
  assert.equal(response.result.externalCalls, 0);
  assert.equal(response.result.networkCalls, 0);
  assert.equal(paths(store, "campaignRecipients").length, 0);
  const serialized = JSON.stringify([...store.records.entries()]);
  assert.doesNotMatch(serialized, /providerMessageId|campaignRecipients|wamid/i);
  assert.equal(SYNTHETIC_AUDIENCE_COUNTS.eligibleCount, 38_443);
});
