import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { Timestamp, type Firestore } from "firebase/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const firestoreSpies = vi.hoisted(() => ({
  doc: vi.fn((database: unknown, ...path: string[]) => ({ database, path })),
  getDocFromServer: vi.fn(),
  collection: vi.fn(),
  query: vi.fn(),
  getDocs: vi.fn(),
  getDocsFromServer: vi.fn(),
  onSnapshot: vi.fn(),
}));

vi.mock("firebase/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("firebase/firestore")>();
  return {
    ...actual,
    doc: firestoreSpies.doc,
    getDocFromServer: firestoreSpies.getDocFromServer,
    collection: firestoreSpies.collection,
    query: firestoreSpies.query,
    getDocs: firestoreSpies.getDocs,
    getDocsFromServer: firestoreSpies.getDocsFromServer,
    onSnapshot: firestoreSpies.onSnapshot,
  };
});

import {
  AI_GOVERNANCE_EVALUATED_AT,
  AI_GOVERNANCE_POLICY_VERSION_ID,
  AI_GOVERNANCE_REVIEWER_VERSION_ID,
  AI_GOVERNANCE_SELECTOR_VERSION_ID,
  AI_GOVERNANCE_WORKSPACE_ID,
  AI_KNOWLEDGE_DOCUMENT_IDS,
  AI_KNOWLEDGE_DOCUMENT_MATRIX,
  AI_KNOWLEDGE_SELECTION_IDS,
  AI_KNOWLEDGE_SELECTION_MATRIX,
  AI_PERSISTED_SCENARIO_IDS,
  AI_PERSISTED_SCENARIO_MATRIX,
  serializeAiEvaluationRequestV1,
  serializeAiKnowledgeApprovalV1,
  serializeAiKnowledgeContentV1,
  serializeAiKnowledgeSelectionV1,
  serializeAiRetrospectiveRunV1,
  type AiKnowledgeDocumentId,
  type AiKnowledgeSelectionId,
  type AiPersistedScenarioId,
  type StaffSafeAiKnowledgeDocumentV1,
  type StaffSafeAiKnowledgeSelectionV1,
  type StaffSafeAiRetrospectiveEventV1,
  type StaffSafeAiRetrospectiveRunV1,
} from "@/lib/domain/ai-governance";
import {
  AI_GOVERNANCE_COLLECTIONS,
  AI_GOVERNANCE_ROLE_READ_PLANS,
  AI_GOVERNANCE_SEED_TIMESTAMPS,
  AiGovernanceRepositoryError,
  loadAiGovernanceEvidence,
  type AiGovernanceRoleReadPlan,
} from "@/lib/firebase/repositories/ai-governance-repository";

const db = {} as Firestore;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function timestamp(value: string): Timestamp {
  return Timestamp.fromDate(new Date(value));
}

function knowledgeDocument(documentId: AiKnowledgeDocumentId) {
  const expected = AI_KNOWLEDGE_DOCUMENT_MATRIX[documentId];
  const contentFingerprint = sha256(
    serializeAiKnowledgeContentV1({
      workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
      documentId,
      title: expected.title,
      version: expected.version,
      language: expected.language,
      contentKind: expected.contentKind,
      ownerUid: expected.ownerUid,
      protectedContentFingerprint: expected.protectedContentFingerprint,
      synthetic: true,
    }),
  );
  const approvalFingerprint = sha256(
    serializeAiKnowledgeApprovalV1({
      workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
      documentId,
      contentFingerprint,
      ownerUid: expected.ownerUid,
      approverUid: expected.approverUid,
      approvalState: expected.approvalState,
      approvalScope: expected.approvalScope,
      approvedAt: expected.approvedAt,
      evaluatedAt: AI_GOVERNANCE_EVALUATED_AT,
      effectiveFrom: expected.effectiveFrom,
      effectiveUntil: expected.effectiveUntil,
      synthetic: true,
    }),
  );
  return {
    id: documentId,
    workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    title: expected.title,
    version: expected.version,
    language: expected.language,
    contentKind: expected.contentKind,
    ownerUid: expected.ownerUid,
    approverUid: expected.approverUid,
    approvalState: expected.approvalState,
    approvalScope: expected.approvalScope,
    approvedAt: expected.approvedAt === null ? null : timestamp(expected.approvedAt),
    evaluatedAt: timestamp(AI_GOVERNANCE_EVALUATED_AT),
    effectiveFrom: expected.effectiveFrom === null ? null : timestamp(expected.effectiveFrom),
    effectiveUntil: expected.effectiveUntil === null ? null : timestamp(expected.effectiveUntil),
    contentFingerprint,
    approvalFingerprint,
    synthetic: true as const,
    schemaVersion: 1 as const,
    createdAt: timestamp(AI_GOVERNANCE_SEED_TIMESTAMPS.knowledgeCreatedAt),
    updatedAt: timestamp(AI_GOVERNANCE_SEED_TIMESTAMPS.knowledgeUpdatedAt),
  };
}

function canonicalKnowledgeDocument(
  persisted: ReturnType<typeof knowledgeDocument>,
): StaffSafeAiKnowledgeDocumentV1 {
  return {
    ...persisted,
    approvedAt: persisted.approvedAt?.toDate().toISOString() ?? null,
    evaluatedAt: persisted.evaluatedAt.toDate().toISOString() as typeof AI_GOVERNANCE_EVALUATED_AT,
    effectiveFrom: persisted.effectiveFrom?.toDate().toISOString() ?? null,
    effectiveUntil: persisted.effectiveUntil?.toDate().toISOString() ?? null,
    createdAt: persisted.createdAt.toDate().toISOString(),
    updatedAt: persisted.updatedAt.toDate().toISOString(),
  };
}

function knowledgeSelection(selectionId: AiKnowledgeSelectionId) {
  const documentId = AI_KNOWLEDGE_SELECTION_MATRIX[selectionId].documentId;
  const document = canonicalKnowledgeDocument(knowledgeDocument(documentId));
  if (document.effectiveFrom === null || document.effectiveUntil === null) {
    throw new Error("Selected test document must have an effective window.");
  }
  const binding = {
    selectionId,
    workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    documentId,
    contentFingerprint: document.contentFingerprint,
    approvalFingerprint: document.approvalFingerprint,
    selectorVersionId: AI_GOVERNANCE_SELECTOR_VERSION_ID,
    selectedAt: AI_GOVERNANCE_EVALUATED_AT,
    evaluatedAt: AI_GOVERNANCE_EVALUATED_AT,
    selectionScope: "retrospective_synthetic_fixture" as const,
    effectiveFrom: document.effectiveFrom,
    effectiveUntil: document.effectiveUntil,
    synthetic: true as const,
  };
  return {
    ...binding,
    selectedAt: timestamp(binding.selectedAt),
    evaluatedAt: timestamp(binding.evaluatedAt),
    effectiveFrom: timestamp(binding.effectiveFrom),
    effectiveUntil: timestamp(binding.effectiveUntil),
    selectionFingerprint: sha256(serializeAiKnowledgeSelectionV1(binding)),
    schemaVersion: 1 as const,
    createdAt: timestamp(AI_GOVERNANCE_SEED_TIMESTAMPS.knowledgeSelectionCreatedAt),
  };
}

function canonicalSelection(
  persisted: ReturnType<typeof knowledgeSelection>,
): StaffSafeAiKnowledgeSelectionV1 {
  return {
    ...persisted,
    selectedAt: persisted.selectedAt.toDate().toISOString() as typeof AI_GOVERNANCE_EVALUATED_AT,
    evaluatedAt: persisted.evaluatedAt.toDate().toISOString() as typeof AI_GOVERNANCE_EVALUATED_AT,
    effectiveFrom: persisted.effectiveFrom.toDate().toISOString(),
    effectiveUntil: persisted.effectiveUntil.toDate().toISOString(),
    createdAt: persisted.createdAt.toDate().toISOString(),
  };
}

function decisionFields(scenarioId: AiPersistedScenarioId) {
  const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
  return {
    decision: expected.decision,
    reasonCodes: [...expected.reasonCodes] as [typeof expected.reasonCodes[0]],
    unsupportedClaim: false as const,
    clinicalSafety: expected.clinicalSafety,
    privacy: "pass" as const,
    serviceWindow: "in_window" as const,
    requiredCorrectionCode: expected.requiredCorrectionCode,
    marketingSuppressionRequired: expected.marketingSuppressionRequired,
    sendMode: expected.sendMode,
    outcome: expected.outcome,
    observedConversationStatus: expected.observedConversationStatus,
    observedConversationMode: expected.observedConversationMode,
    handoffRequired: expected.handoffRequired,
    urgentSafetyHoldObserved: expected.urgentSafetyHoldObserved,
    contactMarketingSuppressionObserved: expected.contactMarketingSuppressionObserved,
    ordinaryAutomationPaused: expected.ordinaryAutomationPaused,
    retryCount: 0 as const,
    eventCount: 1 as const,
    modelCallCount: 0 as const,
    providerCallCount: 0 as const,
    externalDispatchCount: 0 as const,
    conversationMutationCount: 0 as const,
    handoffMutationCount: 0 as const,
    suppressionMutationCount: 0 as const,
    chainOfThoughtStored: false as const,
  };
}

function runtimePair(scenarioId: AiPersistedScenarioId) {
  const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
  const selected =
    expected.knowledgeSelectionId === null
      ? null
      : canonicalSelection(knowledgeSelection(expected.knowledgeSelectionId));
  const requestFingerprint = sha256(
    serializeAiEvaluationRequestV1({
      workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
      scenarioId,
      syntheticConversationRef: expected.syntheticConversationRef,
      language: expected.language,
      languageConfidence: expected.languageConfidence,
      intent: expected.intent,
      urgency: expected.urgency,
      withinServiceWindow: true,
      observedConversationStatus: expected.observedConversationStatus,
      observedConversationMode: expected.observedConversationMode,
      observedHandoffRequired: expected.handoffRequired,
      knowledgeSelectionId: expected.knowledgeSelectionId,
      knowledgeSelectionFingerprint: selected?.selectionFingerprint ?? null,
      policyVersionId: AI_GOVERNANCE_POLICY_VERSION_ID,
      reviewerVersionId: AI_GOVERNANCE_REVIEWER_VERSION_ID,
      evaluatedAt: AI_GOVERNANCE_EVALUATED_AT,
      synthetic: true,
    }),
  );
  const recordedAt = `2026-08-08T0${AI_PERSISTED_SCENARIO_IDS.indexOf(scenarioId) + 1}:00:00.000Z`;
  const run: StaffSafeAiRetrospectiveRunV1 = {
    id: expected.runId,
    workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    scenarioId,
    evaluationScope: "retrospective_synthetic_fixture",
    durableScenarioScope: "partial_four_of_seven",
    requestFingerprint,
    knowledgeSelectionId: expected.knowledgeSelectionId,
    knowledgeSelectionFingerprint: selected?.selectionFingerprint ?? null,
    modelProvider: "none",
    modelId: null,
    promptVersionId: null,
    policyVersionId: AI_GOVERNANCE_POLICY_VERSION_ID,
    reviewerVersionId: AI_GOVERNANCE_REVIEWER_VERSION_ID,
    eventId: expected.eventId,
    auditEventId: expected.auditEventId,
    evaluatedAt: AI_GOVERNANCE_EVALUATED_AT,
    recordedAt,
    ...decisionFields(scenarioId),
    synthetic: true,
    schemaVersion: 1,
  };
  const runFingerprint = sha256(serializeAiRetrospectiveRunV1(run));
  const event: StaffSafeAiRetrospectiveEventV1 = {
    id: expected.eventId,
    workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    runId: expected.runId,
    scenarioId,
    eventType: "retrospective_evaluation_recorded",
    sequence: 1,
    previousEventId: null,
    retryOfEventId: null,
    requestFingerprint,
    runFingerprint,
    knowledgeSelectionId: expected.knowledgeSelectionId,
    knowledgeSelectionFingerprint: selected?.selectionFingerprint ?? null,
    modelProvider: "none",
    modelId: null,
    promptVersionId: null,
    policyVersionId: AI_GOVERNANCE_POLICY_VERSION_ID,
    reviewerVersionId: AI_GOVERNANCE_REVIEWER_VERSION_ID,
    auditEventId: expected.auditEventId,
    evaluatedAt: AI_GOVERNANCE_EVALUATED_AT,
    createdAt: recordedAt,
    ...decisionFields(scenarioId),
    synthetic: true,
    schemaVersion: 1,
  };
  return {
    run: { ...run, evaluatedAt: timestamp(run.evaluatedAt), recordedAt: timestamp(run.recordedAt) },
    event: { ...event, evaluatedAt: timestamp(event.evaluatedAt), createdAt: timestamp(event.createdAt) },
  };
}

interface SnapshotStub {
  readonly id: string;
  readonly exists: () => boolean;
  readonly data: () => Readonly<Record<string, unknown>> | undefined;
}

function present(id: string, data: Readonly<Record<string, unknown>>): SnapshotStub {
  return { id, exists: () => true, data: () => data };
}

function missing(id: string): SnapshotStub {
  return { id, exists: () => false, data: () => undefined };
}

type FixtureMap = Map<string, SnapshotStub>;

function key(collectionName: string, documentId: string): string {
  return `${collectionName}/${documentId}`;
}

function governanceFixtures(): FixtureMap {
  const fixtures = new Map<string, SnapshotStub>();
  for (const documentId of AI_KNOWLEDGE_DOCUMENT_IDS) {
    fixtures.set(key(AI_GOVERNANCE_COLLECTIONS.knowledgeDocuments, documentId), present(documentId, knowledgeDocument(documentId)));
  }
  for (const selectionId of AI_KNOWLEDGE_SELECTION_IDS) {
    fixtures.set(key(AI_GOVERNANCE_COLLECTIONS.knowledgeSelections, selectionId), present(selectionId, knowledgeSelection(selectionId)));
  }
  return fixtures;
}

function withRuntime(fixtures: FixtureMap, ...scenarioIds: readonly AiPersistedScenarioId[]): FixtureMap {
  for (const scenarioId of scenarioIds) {
    const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
    const pair = runtimePair(scenarioId);
    fixtures.set(key(AI_GOVERNANCE_COLLECTIONS.retrospectiveRuns, expected.runId), present(expected.runId, pair.run));
    fixtures.set(key(AI_GOVERNANCE_COLLECTIONS.retrospectiveEvents, expected.eventId), present(expected.eventId, pair.event));
  }
  return fixtures;
}

function arrange(fixtures: FixtureMap): void {
  firestoreSpies.getDocFromServer.mockImplementation((reference: { path: string[] }) => {
    const collectionName = reference.path.at(-2) ?? "";
    const documentId = reference.path.at(-1) ?? "";
    return Promise.resolve(fixtures.get(key(collectionName, documentId)) ?? missing(documentId));
  });
}

async function expectRepositoryError(
  plan: AiGovernanceRoleReadPlan,
  fixtures: FixtureMap,
  code: AiGovernanceRepositoryError["code"],
): Promise<void> {
  arrange(fixtures);
  await expect(
    loadAiGovernanceEvidence(db, { workspaceId: AI_GOVERNANCE_WORKSPACE_ID, plan }),
  ).rejects.toMatchObject({ name: "AiGovernanceRepositoryError", code });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AI governance fixed-read repository", () => {
  it("issues the tenant-admin 16 fixed authoritative reads concurrently and no query/list/cache API", async () => {
    const fixtures = governanceFixtures();
    let release: ((value: SnapshotStub) => void) | undefined;
    const pending = new Promise<SnapshotStub>((resolve) => { release = resolve; });
    let first = true;
    firestoreSpies.getDocFromServer.mockImplementation((reference: { path: string[] }) => {
      const collectionName = reference.path.at(-2) ?? "";
      const documentId = reference.path.at(-1) ?? "";
      const snapshot = fixtures.get(key(collectionName, documentId)) ?? missing(documentId);
      if (first) {
        first = false;
        return pending;
      }
      return Promise.resolve(snapshot);
    });

    const loading = loadAiGovernanceEvidence(db, {
      workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
      plan: AI_GOVERNANCE_ROLE_READ_PLANS.tenant_admin,
    });
    expect(firestoreSpies.getDocFromServer).toHaveBeenCalledTimes(16);
    release?.(present(AI_KNOWLEDGE_DOCUMENT_IDS[0], knowledgeDocument(AI_KNOWLEDGE_DOCUMENT_IDS[0])));
    const result = await loading;

    expect(result.governance.status).toBe("ready");
    expect(result.scenarios.map(({ status }) => status)).toEqual([
      "not_recorded", "not_recorded", "not_recorded", "not_recorded",
    ]);
    expect(firestoreSpies.doc).toHaveBeenNthCalledWith(
      1,
      db,
      "workspaces",
      AI_GOVERNANCE_WORKSPACE_ID,
      "knowledgeDocuments",
      "kn-appointments-v3",
    );
    expect(firestoreSpies.doc).toHaveBeenNthCalledWith(
      16,
      db,
      "workspaces",
      AI_GOVERNANCE_WORKSPACE_ID,
      "aiRunEvents",
      "ai_run_event_demo_stop_v1",
    );
    for (const forbidden of ["collection", "query", "getDocs", "getDocsFromServer", "onSnapshot"] as const) {
      expect(firestoreSpies[forbidden]).not.toHaveBeenCalled();
    }
  });

  it("keeps the four canonical role plans at exactly 16, 8, 10 and 6 permitted reads", async () => {
    const expectedCounts = {
      tenant_admin: 16,
      privacy_reviewer: 8,
      supervisor: 10,
      clinical_approver: 6,
    } as const;
    for (const role of Object.keys(expectedCounts) as (keyof typeof expectedCounts)[]) {
      arrange(governanceFixtures());
      const result = await loadAiGovernanceEvidence(db, {
        workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
        plan: AI_GOVERNANCE_ROLE_READ_PLANS[role],
      });
      expect(result.role).toBe(role);
      expect(firestoreSpies.getDocFromServer).toHaveBeenCalledTimes(expectedCounts[role]);
      vi.clearAllMocks();
    }
  });

  it("returns honest deeply frozen not-seeded and not-recorded states when every exact record is absent", async () => {
    arrange(new Map());
    const result = await loadAiGovernanceEvidence(db, {
      workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
      plan: AI_GOVERNANCE_ROLE_READ_PLANS.tenant_admin,
    });
    expect(result.governance).toEqual({ status: "not_seeded", documents: [], selections: [] });
    expect(result.scenarios.every((scenario) => scenario.status === "not_recorded")).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.governance)).toBe(true);
    expect(Object.isFrozen(result.governance.documents)).toBe(true);
    expect(Object.isFrozen(result.scenarios)).toBe(true);
    expect(Object.isFrozen(result.scenarios[0])).toBe(true);
  });

  it("loads exact runtime pairs, validates public joins and exposes no protected source or raw content", async () => {
    arrange(withRuntime(governanceFixtures(), ...AI_PERSISTED_SCENARIO_IDS));
    const result = await loadAiGovernanceEvidence(db, {
      workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
      plan: AI_GOVERNANCE_ROLE_READ_PLANS.tenant_admin,
    });
    expect(result.scenarios.every((scenario) => scenario.status === "recorded")).toBe(true);
    const appointment = result.scenarios[0];
    expect(appointment.status).toBe("recorded");
    if (appointment.status !== "recorded") throw new Error("Expected recorded fixture.");
    expect(appointment.run.outcome).toBe("preview_only");
    expect(appointment.run.modelProvider).toBe("none");
    expect(Object.isFrozen(appointment.run)).toBe(true);
    expect(Object.isFrozen(appointment.run.reasonCodes)).toBe(true);
    expect(Object.isFrozen(appointment.event)).toBe(true);
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "protectedContentRef", "protectedContentFingerprint", "sourceConversationId",
      "sourceContactId", "sourceMessageId", "stopSuppressionEvidence", "rawContent",
    ]) {
      expect(serialized).not.toContain(`\"${forbidden}\"`);
    }
  });

  it("fails closed on every partial governance inventory and run/event pair", async () => {
    const partialGovernance = governanceFixtures();
    partialGovernance.delete(key(AI_GOVERNANCE_COLLECTIONS.knowledgeSelections, AI_KNOWLEDGE_SELECTION_IDS[2]));
    await expectRepositoryError(AI_GOVERNANCE_ROLE_READ_PLANS.tenant_admin, partialGovernance, "integrity_error");

    const runOnly = governanceFixtures();
    const appointment = runtimePair("appointment");
    runOnly.set(
      key(AI_GOVERNANCE_COLLECTIONS.retrospectiveRuns, AI_PERSISTED_SCENARIO_MATRIX.appointment.runId),
      present(AI_PERSISTED_SCENARIO_MATRIX.appointment.runId, appointment.run),
    );
    await expectRepositoryError(AI_GOVERNANCE_ROLE_READ_PLANS.tenant_admin, runOnly, "integrity_error");

    const runtimeWithoutGovernance = withRuntime(new Map(), "appointment");
    await expectRepositoryError(AI_GOVERNANCE_ROLE_READ_PLANS.tenant_admin, runtimeWithoutGovernance, "integrity_error");
  });

  it("rejects unordered, duplicate, expanded and extra-key plans before any read", async () => {
    const planAttacks: unknown[] = [
      {
        ...AI_GOVERNANCE_ROLE_READ_PLANS.tenant_admin,
        knowledgeDocumentIds: [...AI_KNOWLEDGE_DOCUMENT_IDS].reverse(),
      },
      {
        ...AI_GOVERNANCE_ROLE_READ_PLANS.supervisor,
        scenarioIds: ["appointment", "mixed", "mixed"],
      },
      {
        ...AI_GOVERNANCE_ROLE_READ_PLANS.clinical_approver,
        knowledgeDocumentIds: ["kn-labs-v2", "kn-urgent-v5", "kn-old-hours"],
      },
      { ...AI_GOVERNANCE_ROLE_READ_PLANS.privacy_reviewer, extra: true },
    ];
    for (const plan of planAttacks) {
      await expect(
        loadAiGovernanceEvidence(db, {
          workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
          plan,
        } as never),
      ).rejects.toMatchObject({ code: "invalid_input" });
    }
    await expect(
      loadAiGovernanceEvidence(db, {
        workspaceId: "workspace_other",
        plan: AI_GOVERNANCE_ROLE_READ_PLANS.tenant_admin,
      } as never),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(firestoreSpies.getDocFromServer).not.toHaveBeenCalled();
  });

  it("rejects non-native, sub-millisecond, same-evaluation, lifecycle and extra/secret-key pollution", async () => {
    const attacks: Record<string, unknown>[] = [
      knowledgeDocument("kn-appointments-v3"),
      knowledgeDocument("kn-appointments-v3"),
      knowledgeSelection("knowledge_selection_appointments_v3"),
      knowledgeSelection("knowledge_selection_appointments_v3"),
      knowledgeDocument("kn-appointments-v3"),
      knowledgeDocument("kn-appointments-v3"),
    ];
    attacks[0]!.createdAt = new Date(AI_GOVERNANCE_SEED_TIMESTAMPS.knowledgeCreatedAt);
    attacks[1]!.createdAt = new Timestamp(timestamp(AI_GOVERNANCE_SEED_TIMESTAMPS.knowledgeCreatedAt).seconds, 1);
    attacks[2]!.createdAt = timestamp(AI_GOVERNANCE_EVALUATED_AT);
    attacks[3]!.createdAt = timestamp("2026-08-08T00:10:00.001Z");
    attacks[4]!.updatedAt = timestamp("2026-08-07T23:59:59.999Z");
    attacks[5]!.protectedContentRef = "demo://ai/knowledge/leak";

    for (const [index, attacked] of attacks.entries()) {
      const fixtures = governanceFixtures();
      if (index === 2 || index === 3) {
        fixtures.set(
          key(AI_GOVERNANCE_COLLECTIONS.knowledgeSelections, "knowledge_selection_appointments_v3"),
          present("knowledge_selection_appointments_v3", attacked),
        );
      } else {
        fixtures.set(
          key(AI_GOVERNANCE_COLLECTIONS.knowledgeDocuments, "kn-appointments-v3"),
          present("kn-appointments-v3", attacked),
        );
      }
      await expectRepositoryError(AI_GOVERNANCE_ROLE_READ_PLANS.tenant_admin, fixtures, "invalid_persisted_data");
      vi.clearAllMocks();
    }
  });

  it("rejects hostile canonical-binding, path, selection and run/event substitutions", async () => {
    const attacks: FixtureMap[] = [];

    const content = governanceFixtures();
    const changedContent = { ...knowledgeDocument("kn-appointments-v3"), contentFingerprint: "a".repeat(64) };
    content.set(key(AI_GOVERNANCE_COLLECTIONS.knowledgeDocuments, "kn-appointments-v3"), present("kn-appointments-v3", changedContent));
    attacks.push(content);

    const selection = governanceFixtures();
    const changedSelection = { ...knowledgeSelection("knowledge_selection_appointments_v3"), selectionFingerprint: "b".repeat(64) };
    selection.set(key(AI_GOVERNANCE_COLLECTIONS.knowledgeSelections, "knowledge_selection_appointments_v3"), present("knowledge_selection_appointments_v3", changedSelection));
    attacks.push(selection);

    const substitutedPath = governanceFixtures();
    substitutedPath.set(
      key(AI_GOVERNANCE_COLLECTIONS.knowledgeDocuments, "kn-appointments-v3"),
      present("kn-labs-v2", knowledgeDocument("kn-appointments-v3")),
    );
    attacks.push(substitutedPath);

    const runtime = withRuntime(governanceFixtures(), "appointment");
    const expected = AI_PERSISTED_SCENARIO_MATRIX.appointment;
    const pair = runtimePair("appointment");
    runtime.set(
      key(AI_GOVERNANCE_COLLECTIONS.retrospectiveEvents, expected.eventId),
      present(expected.eventId, { ...pair.event, runFingerprint: "c".repeat(64) }),
    );
    attacks.push(runtime);

    for (const fixtures of attacks) {
      await expectRepositoryError(AI_GOVERNANCE_ROLE_READ_PLANS.tenant_admin, fixtures, "integrity_error");
      vi.clearAllMocks();
    }
  });

  it("statically imports no query, list, listener, cache or fixture API", async () => {
    const source = await readFile(
      new URL("../lib/firebase/repositories/ai-governance-repository.ts", import.meta.url),
      "utf8",
    );
    const firestoreImport = source.match(/import \{[\s\S]*?\} from "firebase\/firestore";/)?.[0] ?? "";
    expect(firestoreImport).toContain("getDocFromServer");
    for (const forbidden of [
      "collection", "query", "getDocs", "getDocsFromServer", "getDoc,", "onSnapshot",
      "enableIndexedDbPersistence", "localStorage", "sessionStorage", "../../demo",
    ]) {
      expect(firestoreImport.includes(forbidden) || source.includes(`from \"${forbidden}\"`)).toBe(false);
    }
  });
});
