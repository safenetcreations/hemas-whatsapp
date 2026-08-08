import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import * as aiGovernance from "@/lib/domain/ai-governance";
import {
  AI_GOVERNANCE_EVALUATED_AT,
  AI_GOVERNANCE_EXPECTED_PERSISTENCE_COUNTS,
  AI_GOVERNANCE_POLICY_VERSION_ID,
  AI_GOVERNANCE_REVIEWER_VERSION_ID,
  AI_GOVERNANCE_SCENARIO_COVERAGE,
  AI_GOVERNANCE_SCENARIO_IDS,
  AI_GOVERNANCE_SELECTOR_VERSION_ID,
  AI_GOVERNANCE_WORKSPACE_ID,
  AI_KNOWLEDGE_DOCUMENT_IDS,
  AI_KNOWLEDGE_DOCUMENT_MATRIX,
  AI_KNOWLEDGE_SELECTION_IDS,
  AI_KNOWLEDGE_SELECTION_MATRIX,
  AI_LOCAL_ONLY_SCENARIO_IDS,
  AI_LOCAL_ONLY_SCENARIO_MATRIX,
  AI_PERSISTED_SCENARIO_IDS,
  AI_PERSISTED_SCENARIO_MATRIX,
  assertAiEvaluationRequestBindingV1,
  assertAiGovernancePersistenceCountModel,
  assertAiKnowledgeApprovalBindingV1,
  assertAiKnowledgeContentBindingV1,
  assertAiKnowledgeDocumentCrossBindingV1,
  assertAiKnowledgeDocumentSecretV1,
  assertAiKnowledgeSelectionCrossBindingV1,
  assertAiScenarioFixtureFingerprintDerivationV1,
  assertAiRetrospectiveEventCrossBindingV1,
  assertAiRetrospectiveEventSecretV1,
  assertAiRetrospectiveRequestRunCrossBindingV1,
  assertAiRetrospectiveRunSecretV1,
  assertStaffSafeAiKnowledgeDocumentV1,
  assertStaffSafeAiKnowledgeSelectionV1,
  assertStaffSafeAiRetrospectiveEventV1,
  assertStaffSafeAiRetrospectiveRunV1,
  serializeAiEvaluationRequestV1,
  serializeAiKnowledgeApprovalV1,
  serializeAiKnowledgeContentV1,
  serializeAiKnowledgeSelectionV1,
  serializeAiRetrospectiveEventSecretV1,
  serializeAiRetrospectiveEventV1,
  serializeAiRetrospectiveRunSecretV1,
  serializeAiRetrospectiveRunV1,
  serializeAiSourceFixtureIdentityV1,
  serializeAiDecisionFixtureIdentityV1,
  type AiEvaluationRequestBindingV1,
  type AiKnowledgeApprovalBindingV1,
  type AiKnowledgeContentBindingV1,
  type AiKnowledgeDocumentId,
  type AiKnowledgeDocumentSecretV1,
  type AiKnowledgeSelectionId,
  type AiPersistedScenarioId,
  type AiRetrospectiveEventSecretV1,
  type AiRetrospectiveRunSecretV1,
  type StaffSafeAiKnowledgeDocumentV1,
  type StaffSafeAiKnowledgeSelectionV1,
  type StaffSafeAiRetrospectiveEventV1,
  type StaffSafeAiRetrospectiveRunV1,
} from "@/lib/domain/ai-governance";

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

const SERVER_RECORDED_AT: Readonly<Record<AiPersistedScenarioId, string>> = {
  appointment: "2026-08-08T01:00:01.000Z",
  urgent: "2026-08-08T01:00:02.000Z",
  mixed: "2026-08-08T01:00:03.000Z",
  stop: "2026-08-08T01:00:04.000Z",
};

function knowledgeAggregate(documentId: AiKnowledgeDocumentId) {
  const expected = AI_KNOWLEDGE_DOCUMENT_MATRIX[documentId];
  const protectedContentFingerprint = sha256(`protected-content:${documentId}:v1`);
  const content: AiKnowledgeContentBindingV1 = {
    workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    documentId,
    title: expected.title,
    version: expected.version,
    language: expected.language,
    contentKind: expected.contentKind,
    ownerUid: expected.ownerUid,
    protectedContentFingerprint,
    synthetic: true,
  };
  const contentFingerprint = sha256(serializeAiKnowledgeContentV1(content));
  const approval: AiKnowledgeApprovalBindingV1 = {
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
  };
  const approvalFingerprint = sha256(serializeAiKnowledgeApprovalV1(approval));
  const document: StaffSafeAiKnowledgeDocumentV1 = {
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
    approvedAt: expected.approvedAt,
    evaluatedAt: AI_GOVERNANCE_EVALUATED_AT,
    effectiveFrom: expected.effectiveFrom,
    effectiveUntil: expected.effectiveUntil,
    contentFingerprint,
    approvalFingerprint,
    synthetic: true,
    schemaVersion: 1,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  };
  const secret: AiKnowledgeDocumentSecretV1 = {
    id: expected.secretId,
    workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    documentId,
    contentFingerprint,
    approvalFingerprint,
    protectedContentRef: `demo://ai/knowledge/${documentId}/content-v1`,
    protectedContentFingerprint,
    synthetic: true,
    schemaVersion: 1,
    createdAt: "2026-08-08T00:00:00.000Z",
  };
  return { content, approval, document, secret };
}

const knowledge = Object.fromEntries(
  AI_KNOWLEDGE_DOCUMENT_IDS.map((id) => [id, knowledgeAggregate(id)]),
) as Record<AiKnowledgeDocumentId, ReturnType<typeof knowledgeAggregate>>;

function knowledgeSelection(selectionId: AiKnowledgeSelectionId) {
  const documentId = AI_KNOWLEDGE_SELECTION_MATRIX[selectionId].documentId;
  const document = knowledge[documentId].document;
  if (document.effectiveFrom === null || document.effectiveUntil === null) {
    throw new Error("Selected fixture must have an effective window.");
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
  const selection: StaffSafeAiKnowledgeSelectionV1 = {
    ...binding,
    selectionFingerprint: sha256(serializeAiKnowledgeSelectionV1(binding)),
    schemaVersion: 1,
    createdAt: "2026-08-08T00:10:00.000Z",
  };
  return selection;
}

const selections = Object.fromEntries(
  AI_KNOWLEDGE_SELECTION_IDS.map((id) => [id, knowledgeSelection(id)]),
) as Record<AiKnowledgeSelectionId, StaffSafeAiKnowledgeSelectionV1>;

function decisionFields(scenarioId: AiPersistedScenarioId) {
  const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
  return {
    decision: expected.decision,
    reasonCodes: expected.reasonCodes,
    unsupportedClaim: expected.unsupportedClaim,
    clinicalSafety: expected.clinicalSafety,
    privacy: "pass" as const,
    serviceWindow: expected.serviceWindow,
    requiredCorrectionCode: expected.requiredCorrectionCode,
    marketingSuppressionRequired: expected.marketingSuppressionRequired,
    sendMode: expected.sendMode,
    outcome: expected.outcome,
    observedConversationStatus: expected.observedConversationStatus,
    observedConversationMode: expected.observedConversationMode,
    handoffRequired: expected.handoffRequired,
    urgentSafetyHoldObserved: expected.urgentSafetyHoldObserved,
    contactMarketingSuppressionObserved:
      expected.contactMarketingSuppressionObserved,
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

function stopEvidence() {
  return {
    contactId: "contact_synthetic_stopped" as const,
    grantedConsentRecordId: "consent_synthetic_stop_granted" as const,
    grantedConsentStatus: "granted" as const,
    grantedConsentCapturedAt: "2026-08-01T05:00:00.000Z" as const,
    grantedConsentEvidenceRef: "demo://consent/stop-before" as const,
    withdrawnConsentRecordId: "consent_synthetic_stop_withdrawn" as const,
    withdrawnConsentStatus: "withdrawn" as const,
    withdrawnSupersedesRecordId: "consent_synthetic_stop_granted" as const,
    withdrawnConsentCapturedAt: "2026-08-07T12:20:00.000Z" as const,
    withdrawnAt: "2026-08-07T12:20:00.000Z" as const,
    withdrawnConsentEvidenceRef: "demo://consent/stop-keyword-event" as const,
    purpose: "health_campaigns" as const,
    category: "marketing" as const,
    channel: "whatsapp" as const,
    suppressionMarketing: true as const,
    suppressionAll: false as const,
    suppressionReason: "stop_keyword" as const,
    suppressionUpdatedAt: "2026-08-07T12:20:00.000Z" as const,
    consentEvidenceFingerprint:
      "8849f90377522b41a74b2d21958ca885c6f5d84222be607eb3fbd382d88b700f" as const,
    contactSuppressionEvidenceRef:
      "demo://ai/stop/contact-suppression-evidence-v1" as const,
    contactSuppressionEvidenceFingerprint:
      "039cc24be8127bf8e3e79a0d660f9bb14013268279945854535365019252adcd" as const,
  };
}

function retrospectiveAggregate(scenarioId: AiPersistedScenarioId) {
  const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
  const selection =
    expected.knowledgeSelectionId === null
      ? null
      : selections[expected.knowledgeSelectionId];
  const selectionFingerprint = selection?.selectionFingerprint ?? null;
  const request: AiEvaluationRequestBindingV1 = {
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
    knowledgeSelectionFingerprint: selectionFingerprint,
    policyVersionId: AI_GOVERNANCE_POLICY_VERSION_ID,
    reviewerVersionId: AI_GOVERNANCE_REVIEWER_VERSION_ID,
    evaluatedAt: AI_GOVERNANCE_EVALUATED_AT,
    synthetic: true,
  };
  const requestFingerprint = sha256(serializeAiEvaluationRequestV1(request));
  const run: StaffSafeAiRetrospectiveRunV1 = {
    id: expected.runId,
    workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    scenarioId,
    evaluationScope: "retrospective_synthetic_fixture",
    durableScenarioScope: "partial_four_of_seven",
    requestFingerprint,
    knowledgeSelectionId: expected.knowledgeSelectionId,
    knowledgeSelectionFingerprint: selectionFingerprint,
    modelProvider: "none",
    modelId: null,
    promptVersionId: null,
    policyVersionId: AI_GOVERNANCE_POLICY_VERSION_ID,
    reviewerVersionId: AI_GOVERNANCE_REVIEWER_VERSION_ID,
    eventId: expected.eventId,
    auditEventId: expected.auditEventId,
    evaluatedAt: AI_GOVERNANCE_EVALUATED_AT,
    recordedAt: SERVER_RECORDED_AT[scenarioId],
    ...decisionFields(scenarioId),
    synthetic: true,
    schemaVersion: 1,
  };
  const runFingerprint = sha256(serializeAiRetrospectiveRunV1(run));
  const runSecret: AiRetrospectiveRunSecretV1 = {
    id: expected.runSecretId,
    workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    runId: expected.runId,
    scenarioId,
    requestFingerprint,
    runFingerprint,
    sourceConnectionId: expected.sourceConnectionId,
    sourceConversationId: expected.syntheticConversationRef,
    sourceContactId: expected.sourceContactId,
    sourceMessageId: expected.sourceMessageId,
    sourceTeamId: expected.sourceTeamId,
    sourceLocationId: expected.sourceLocationId,
    sourcePurpose: expected.sourcePurpose,
    protectedRequestFixtureRef: `demo://ai/requests/${scenarioId}-v1`,
    protectedRequestFixtureFingerprint: expected.sourceFixtureFingerprint,
    stopSuppressionEvidence: scenarioId === "stop" ? stopEvidence() : null,
    synthetic: true,
    schemaVersion: 1,
    createdAt: SERVER_RECORDED_AT[scenarioId],
  };
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
    knowledgeSelectionFingerprint: selectionFingerprint,
    modelProvider: "none",
    modelId: null,
    promptVersionId: null,
    policyVersionId: AI_GOVERNANCE_POLICY_VERSION_ID,
    reviewerVersionId: AI_GOVERNANCE_REVIEWER_VERSION_ID,
    auditEventId: expected.auditEventId,
    evaluatedAt: AI_GOVERNANCE_EVALUATED_AT,
    createdAt: SERVER_RECORDED_AT[scenarioId],
    ...decisionFields(scenarioId),
    synthetic: true,
    schemaVersion: 1,
  };
  const eventFingerprint = sha256(serializeAiRetrospectiveEventV1(event));
  const eventSecret: AiRetrospectiveEventSecretV1 = {
    id: expected.eventSecretId,
    workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    eventId: expected.eventId,
    runId: expected.runId,
    scenarioId,
    requestFingerprint,
    runFingerprint,
    eventFingerprint,
    protectedDecisionFixtureRef: `demo://ai/decisions/${scenarioId}-v1`,
    protectedDecisionFixtureFingerprint: expected.decisionFixtureFingerprint,
    synthetic: true,
    schemaVersion: 1,
    createdAt: SERVER_RECORDED_AT[scenarioId],
  };
  return { request, run, runSecret, event, eventSecret, selection };
}

const retrospectives = Object.fromEntries(
  AI_PERSISTED_SCENARIO_IDS.map((id) => [id, retrospectiveAggregate(id)]),
) as Record<AiPersistedScenarioId, ReturnType<typeof retrospectiveAggregate>>;

function withField<T extends object>(value: T, key: string, replacement: unknown) {
  return { ...value, [key]: replacement };
}

function persistenceSnapshot(materializedScenarioCount: number) {
  return {
    materializedScenarioCount,
    knowledgeDocuments: 5,
    knowledgeSelections: 3,
    knowledgeSecrets: 5,
    retrospectiveRuns: materializedScenarioCount,
    retrospectiveEvents: materializedScenarioCount,
    retrospectiveRunSecrets: materializedScenarioCount,
    retrospectiveEventSecrets: materializedScenarioCount,
    idempotencyReceipts: materializedScenarioCount,
    auditEvents: materializedScenarioCount,
    totalDocuments: 13 + materializedScenarioCount * 6,
  };
}

describe("AI/Knowledge corrected durable scope", () => {
  it("freezes the exact seven-scenario join and partial four-scenario durable scope", () => {
    expect(AI_KNOWLEDGE_DOCUMENT_IDS).toHaveLength(5);
    expect(AI_KNOWLEDGE_SELECTION_IDS).toHaveLength(3);
    expect(AI_PERSISTED_SCENARIO_IDS).toEqual([
      "appointment",
      "urgent",
      "mixed",
      "stop",
    ]);
    expect(AI_LOCAL_ONLY_SCENARIO_IDS).toEqual([
      "medicine",
      "report",
      "price",
    ]);
    expect(AI_GOVERNANCE_SCENARIO_IDS).toEqual([
      "appointment",
      "urgent",
      "mixed",
      "stop",
      "medicine",
      "report",
      "price",
    ]);
    expect(AI_GOVERNANCE_SCENARIO_COVERAGE.all).toEqual(
      AI_GOVERNANCE_SCENARIO_IDS,
    );
    expect(new Set(AI_GOVERNANCE_SCENARIO_IDS).size).toBe(7);
    expect(AI_LOCAL_ONLY_SCENARIO_MATRIX.price).toEqual({
      reason: "unsupported_claim",
    });
    expect(AI_GOVERNANCE_SCENARIO_COVERAGE.durableScope).toBe(
      "partial_four_of_seven",
    );
  });

  it("freezes 13 seeded governance docs and six atomic docs per materialized scenario", () => {
    expect(AI_GOVERNANCE_EXPECTED_PERSISTENCE_COUNTS.initialGovernanceSeed).toEqual(
      persistenceSnapshot(0),
    );
    expect(
      AI_GOVERNANCE_EXPECTED_PERSISTENCE_COUNTS.perMaterializedScenario,
    ).toEqual({
      retrospectiveRuns: 1,
      retrospectiveEvents: 1,
      retrospectiveRunSecrets: 1,
      retrospectiveEventSecrets: 1,
      idempotencyReceipts: 1,
      auditEvents: 1,
      totalDocuments: 6,
    });
    expect(
      AI_GOVERNANCE_EXPECTED_PERSISTENCE_COUNTS.afterFirstMaterializedScenario,
    ).toEqual(persistenceSnapshot(1));
    expect(
      AI_GOVERNANCE_EXPECTED_PERSISTENCE_COUNTS.terminalAfterFourScenarios,
    ).toEqual(persistenceSnapshot(4));

    for (const phase of [0, 1, 4]) {
      expect(() =>
        assertAiGovernancePersistenceCountModel(persistenceSnapshot(phase)),
      ).not.toThrow();
    }

    expect(() =>
      assertAiGovernancePersistenceCountModel({
        ...persistenceSnapshot(0),
        retrospectiveRuns: 1,
      }),
    ).toThrow(/retrospectiveRuns/);
    expect(() =>
      assertAiGovernancePersistenceCountModel({
        ...persistenceSnapshot(1),
        totalDocuments: 20,
      }),
    ).toThrow(/19/);
    expect(() =>
      assertAiGovernancePersistenceCountModel({
        ...persistenceSnapshot(4),
        auditEvents: 3,
      }),
    ).toThrow(/auditEvents/);
    expect(() =>
      assertAiGovernancePersistenceCountModel(persistenceSnapshot(5)),
    ).toThrow(/zero to four/);
  });

  it("uses existing demo actors and source fixture IDs without a handoff aggregate", () => {
    const actors = Object.values(AI_KNOWLEDGE_DOCUMENT_MATRIX).flatMap((entry) => [
      entry.ownerUid,
      entry.approverUid,
    ]);
    expect(new Set(actors)).toEqual(
      new Set([
        "user_demo_supervisor",
        "user_demo_clinical_approver",
        "user_demo_admin",
        null,
      ]),
    );
    expect(
      AI_PERSISTED_SCENARIO_IDS.map(
        (id) => AI_PERSISTED_SCENARIO_MATRIX[id].syntheticConversationRef,
      ),
    ).toEqual([
      "conversation_synthetic_appointment",
      "conversation_synthetic_urgent",
      "conversation_synthetic_mixed",
      "conversation_synthetic_stopped",
    ]);
    expect(Object.keys(aiGovernance).some((key) => /handoff.*document/i.test(key))).toBe(
      false,
    );
  });
});

describe("AI knowledge content, approval, secret and selection binding", () => {
  it("accepts all five exact documents and their protected-content bindings", () => {
    for (const id of AI_KNOWLEDGE_DOCUMENT_IDS) {
      const aggregate = knowledge[id];
      expect(() => assertAiKnowledgeContentBindingV1(aggregate.content)).not.toThrow();
      expect(() => assertAiKnowledgeApprovalBindingV1(aggregate.approval)).not.toThrow();
      expect(() => assertStaffSafeAiKnowledgeDocumentV1(aggregate.document)).not.toThrow();
      expect(() => assertAiKnowledgeDocumentSecretV1(aggregate.secret)).not.toThrow();
      expect(() =>
        assertAiKnowledgeDocumentCrossBindingV1(
          aggregate.document,
          aggregate.content,
          aggregate.approval,
          aggregate.secret,
          sha256,
        ),
      ).not.toThrow();
    }
  });

  it("selects only the three approved documents whose windows include evaluatedAt", () => {
    for (const id of AI_KNOWLEDGE_SELECTION_IDS) {
      const selection = selections[id];
      const document = knowledge[selection.documentId].document;
      expect(() => assertStaffSafeAiKnowledgeSelectionV1(selection)).not.toThrow();
      expect(() =>
        assertAiKnowledgeSelectionCrossBindingV1(selection, document, sha256),
      ).not.toThrow();
    }
    expect(Object.values(AI_KNOWLEDGE_SELECTION_MATRIX).map((value) => value.documentId)).toEqual([
      "kn-appointments-v3",
      "kn-labs-v2",
      "kn-urgent-v5",
    ]);
  });

  it("rejects orphan actors, substituted content, extra keys and invalid windows", () => {
    const aggregate = knowledge["kn-appointments-v3"];
    for (const invalid of [
      withField(aggregate.content, "ownerUid", "user_synthetic_orphan_owner"),
      withField(aggregate.content, "rawContent", "forbidden"),
      withField(aggregate.content, "protectedContentFingerprint", "A".repeat(64)),
    ]) {
      expect(() => assertAiKnowledgeContentBindingV1(invalid)).toThrow();
    }
    expect(() =>
      assertAiKnowledgeApprovalBindingV1(
        withField(aggregate.approval, "evaluatedAt", "2026-11-01T00:00:00.000Z"),
      ),
    ).toThrow();
    expect(() =>
      assertStaffSafeAiKnowledgeDocumentV1(
        withField(aggregate.document, "updatedAt", "2026-06-01T00:00:00Z"),
      ),
    ).toThrow(/canonical millisecond/i);
    expect(() =>
      assertAiKnowledgeDocumentCrossBindingV1(
        aggregate.document,
        aggregate.content,
        aggregate.approval,
        withField(aggregate.secret, "protectedContentFingerprint", sha256("substitute")) as never,
        sha256,
      ),
    ).toThrow();
  });

  it("rejects a selection substituted across document/hash/window boundaries", () => {
    const selection = selections.knowledge_selection_appointments_v3;
    for (const invalid of [
      withField(selection, "documentId", "kn-old-hours"),
      withField(selection, "effectiveUntil", "2026-08-07T12:29:59.999Z"),
      withField(selection, "selectedAt", "2026-08-07T12:30:00Z"),
    ]) {
      expect(() => assertStaffSafeAiKnowledgeSelectionV1(invalid)).toThrow();
    }
    expect(() =>
      assertAiKnowledgeSelectionCrossBindingV1(
        {
          ...selection,
          selectionFingerprint: sha256("substituted-selection"),
        },
        knowledge["kn-appointments-v3"].document,
        sha256,
      ),
    ).toThrow(/bound/);
  });

  it("keeps historical evaluatedAt distinct from every actual server persistence time", () => {
    const knowledgeSecret = knowledge["kn-appointments-v3"].secret;
    const selection = selections.knowledge_selection_appointments_v3;
    const aggregate = retrospectives.appointment;

    expect(() =>
      assertAiKnowledgeDocumentSecretV1({
        ...knowledgeSecret,
        createdAt: AI_GOVERNANCE_EVALUATED_AT,
      }),
    ).toThrow(/later than evaluatedAt/);
    expect(() =>
      assertStaffSafeAiKnowledgeSelectionV1({
        ...selection,
        createdAt: AI_GOVERNANCE_EVALUATED_AT,
      }),
    ).toThrow(/later than evaluatedAt/);
    expect(() =>
      assertStaffSafeAiRetrospectiveRunV1({
        ...aggregate.run,
        recordedAt: AI_GOVERNANCE_EVALUATED_AT,
      }),
    ).toThrow(/later than evaluatedAt/);
    expect(() =>
      assertStaffSafeAiRetrospectiveEventV1({
        ...aggregate.event,
        createdAt: AI_GOVERNANCE_EVALUATED_AT,
      }),
    ).toThrow(/later than evaluatedAt/);
    expect(() =>
      assertAiRetrospectiveRunSecretV1({
        ...aggregate.runSecret,
        createdAt: AI_GOVERNANCE_EVALUATED_AT,
      }),
    ).toThrow(/later than evaluatedAt/);
    expect(() =>
      assertAiRetrospectiveEventSecretV1({
        ...aggregate.eventSecret,
        createdAt: AI_GOVERNANCE_EVALUATED_AT,
      }),
    ).toThrow(/later than evaluatedAt/);
  });
});

describe("retrospective AI run and one-shot event state matrices", () => {
  it("accepts the four exact observational outcomes and their cross-bindings", () => {
    expect(
      AI_PERSISTED_SCENARIO_IDS.map(
        (id) => AI_PERSISTED_SCENARIO_MATRIX[id].outcome,
      ),
    ).toEqual([
      "preview_only",
      "safety_hold_already_present",
      "human_takeover_already_present",
      "suppression_already_recorded",
    ]);
    for (const id of AI_PERSISTED_SCENARIO_IDS) {
      const aggregate = retrospectives[id];
      expect(() => assertAiEvaluationRequestBindingV1(aggregate.request)).not.toThrow();
      expect(() => assertStaffSafeAiRetrospectiveRunV1(aggregate.run)).not.toThrow();
      expect(() => assertAiRetrospectiveRunSecretV1(aggregate.runSecret)).not.toThrow();
      expect(() => assertStaffSafeAiRetrospectiveEventV1(aggregate.event)).not.toThrow();
      expect(() => assertAiRetrospectiveEventSecretV1(aggregate.eventSecret)).not.toThrow();
      expect(() =>
        assertAiRetrospectiveRequestRunCrossBindingV1(
          aggregate.request,
          aggregate.run,
          aggregate.runSecret,
          aggregate.selection,
          sha256,
        ),
      ).not.toThrow();
      expect(() =>
        assertAiRetrospectiveEventCrossBindingV1(
          aggregate.run,
          aggregate.event,
          aggregate.eventSecret,
          sha256,
        ),
      ).not.toThrow();
    }
  });

  it("keeps mixed and STOP knowledge-null with one event and no retry", () => {
    for (const id of ["mixed", "stop"] as const) {
      const { run, event } = retrospectives[id];
      expect(run.knowledgeSelectionId).toBeNull();
      expect(run.knowledgeSelectionFingerprint).toBeNull();
      expect(run.eventCount).toBe(1);
      expect(run.retryCount).toBe(0);
      expect(event.sequence).toBe(1);
      expect(event.previousEventId).toBeNull();
      expect(event.retryOfEventId).toBeNull();
    }
  });

  it("records observed safety state while every model/provider/mutation counter stays zero", () => {
    const urgent = retrospectives.urgent.run;
    const mixed = retrospectives.mixed.run;
    const stop = retrospectives.stop.run;
    expect(urgent).toMatchObject({
      observedConversationStatus: "escalated",
      observedConversationMode: "safety_hold",
      urgentSafetyHoldObserved: true,
      outcome: "safety_hold_already_present",
    });
    expect(mixed).toMatchObject({
      observedConversationStatus: "assigned",
      observedConversationMode: "human_takeover",
      handoffRequired: true,
      outcome: "human_takeover_already_present",
    });
    expect(stop).toMatchObject({
      observedConversationStatus: "resolved",
      contactMarketingSuppressionObserved: true,
      outcome: "suppression_already_recorded",
    });
    for (const id of AI_PERSISTED_SCENARIO_IDS) {
      expect(retrospectives[id].run).toMatchObject({
        modelProvider: "none",
        modelId: null,
        promptVersionId: null,
        retryCount: 0,
        modelCallCount: 0,
        providerCallCount: 0,
        externalDispatchCount: 0,
        conversationMutationCount: 0,
        handoffMutationCount: 0,
        suppressionMutationCount: 0,
        chainOfThoughtStored: false,
      });
    }
  });

  it("binds each request secret to the existing exact fixture identity and fingerprint", () => {
    for (const id of AI_PERSISTED_SCENARIO_IDS) {
      const expected = AI_PERSISTED_SCENARIO_MATRIX[id];
      const secret = retrospectives[id].runSecret;
      expect(() => assertAiScenarioFixtureFingerprintDerivationV1(id, sha256)).not.toThrow();
      expect(sha256(serializeAiSourceFixtureIdentityV1(id))).toBe(
        expected.sourceFixtureFingerprint,
      );
      expect(sha256(serializeAiDecisionFixtureIdentityV1(id))).toBe(
        expected.decisionFixtureFingerprint,
      );
      expect(secret).toMatchObject({
        sourceConnectionId: "connection_demo_simulator",
        sourceConversationId: expected.syntheticConversationRef,
        sourceContactId: expected.sourceContactId,
        sourceMessageId: expected.sourceMessageId,
        sourceTeamId: expected.sourceTeamId,
        sourceLocationId: expected.sourceLocationId,
        sourcePurpose: expected.sourcePurpose,
        protectedRequestFixtureFingerprint: expected.sourceFixtureFingerprint,
      });
      for (const invalid of [
        withField(secret, "sourceConversationId", "conversation_synthetic_package"),
        withField(secret, "sourceContactId", "contact_synthetic_package"),
        withField(secret, "sourceMessageId", "message_synthetic_package_inbound"),
        withField(secret, "sourceTeamId", "team_demo_laboratory"),
        withField(secret, "sourceLocationId", "location_demo_thalawathugoda"),
        withField(secret, "sourcePurpose", "package"),
        withField(secret, "protectedRequestFixtureFingerprint", sha256("substitute")),
      ]) {
        expect(() => assertAiRetrospectiveRunSecretV1(invalid)).toThrow();
      }
    }
  });

  it("binds STOP to the existing granted-withdrawn consent chain without claiming a mutation", () => {
    const { run, runSecret } = retrospectives.stop;
    expect(run.suppressionMutationCount).toBe(0);
    expect(run.outcome).toBe("suppression_already_recorded");
    expect(runSecret.stopSuppressionEvidence).toMatchObject({
      contactId: "contact_synthetic_stopped",
      grantedConsentRecordId: "consent_synthetic_stop_granted",
      grantedConsentStatus: "granted",
      withdrawnConsentRecordId: "consent_synthetic_stop_withdrawn",
      withdrawnConsentStatus: "withdrawn",
      withdrawnSupersedesRecordId: "consent_synthetic_stop_granted",
      suppressionMarketing: true,
      suppressionAll: false,
      suppressionReason: "stop_keyword",
    });
    const evidence = runSecret.stopSuppressionEvidence!;
    for (const invalidEvidence of [
      withField(evidence, "withdrawnConsentStatus", "granted"),
      withField(evidence, "withdrawnSupersedesRecordId", "consent_substituted"),
      withField(evidence, "suppressionMarketing", false),
      withField(evidence, "suppressionUpdatedAt", AI_GOVERNANCE_EVALUATED_AT),
    ]) {
      expect(() =>
        assertAiRetrospectiveRunSecretV1({
          ...runSecret,
          stopSuppressionEvidence: invalidEvidence as never,
        }),
      ).toThrow();
    }
  });

  it("rejects model calls, mutation claims, retries, extra public IDs and chronology drift", () => {
    const aggregate = retrospectives.appointment;
    for (const invalid of [
      withField(aggregate.run, "modelProvider", "gemini"),
      withField(aggregate.run, "modelCallCount", 1),
      withField(aggregate.run, "conversationMutationCount", 1),
      withField(aggregate.run, "handoffId", "handoff_forbidden"),
      withField(aggregate.run, "auditRequestId", "request_forbidden"),
      withField(aggregate.run, "idempotencyReceiptId", "receipt_forbidden"),
      withField(aggregate.run, "recordedAt", "2026-08-07T12:29:59.999Z"),
    ]) {
      expect(() => assertStaffSafeAiRetrospectiveRunV1(invalid)).toThrow();
    }
    for (const invalid of [
      withField(aggregate.event, "sequence", 2),
      withField(aggregate.event, "retryOfEventId", aggregate.event.id),
      withField(aggregate.event, "retryCount", 1),
      withField(aggregate.event, "createdAt", "2026-08-07T12:30:00Z"),
    ]) {
      expect(() => assertStaffSafeAiRetrospectiveEventV1(invalid)).toThrow();
    }
  });

  it("rejects nullable-binding, parent, decision and public-fingerprint substitutions", () => {
    const mixed = retrospectives.mixed;
    expect(() =>
      assertStaffSafeAiRetrospectiveRunV1({
        ...mixed.run,
        knowledgeSelectionId: "knowledge_selection_appointments_v3",
        knowledgeSelectionFingerprint:
          selections.knowledge_selection_appointments_v3.selectionFingerprint,
      }),
    ).toThrow(/selection/i);

    const appointment = retrospectives.appointment;
    expect(() =>
      assertAiRetrospectiveRequestRunCrossBindingV1(
        withField(
          appointment.request,
          "syntheticConversationRef",
          "conversation_synthetic_package",
        ) as never,
        appointment.run,
        appointment.runSecret,
        appointment.selection,
        sha256,
      ),
    ).toThrow();
    expect(() =>
      assertAiRetrospectiveEventCrossBindingV1(
        appointment.run,
        { ...appointment.event, handoffRequired: true } as never,
        appointment.eventSecret,
        sha256,
      ),
    ).toThrow();
    expect(() =>
      assertAiRetrospectiveEventCrossBindingV1(
        appointment.run,
        appointment.event,
        { ...appointment.eventSecret, eventFingerprint: sha256("substitute") },
        sha256,
      ),
    ).toThrow(/cross-bound/);
  });
});

describe("versioned canonical AI governance serialization", () => {
  it("uses JSON arrays, exact list order, nulls and canonical millisecond time", () => {
    const appointment = retrospectives.appointment;
    const content = knowledge["kn-appointments-v3"].content;
    const selection = selections.knowledge_selection_appointments_v3;
    const selectionBinding = {
      selectionId: selection.selectionId,
      workspaceId: selection.workspaceId,
      documentId: selection.documentId,
      contentFingerprint: selection.contentFingerprint,
      approvalFingerprint: selection.approvalFingerprint,
      selectorVersionId: selection.selectorVersionId,
      selectedAt: selection.selectedAt,
      evaluatedAt: selection.evaluatedAt,
      selectionScope: selection.selectionScope,
      effectiveFrom: selection.effectiveFrom,
      effectiveUntil: selection.effectiveUntil,
      synthetic: selection.synthetic,
    };
    const contentTuple = JSON.parse(serializeAiKnowledgeContentV1(content));
    const requestTuple = JSON.parse(serializeAiEvaluationRequestV1(appointment.request));
    const runTuple = JSON.parse(serializeAiRetrospectiveRunV1(appointment.run));
    const eventTuple = JSON.parse(serializeAiRetrospectiveEventV1(appointment.event));
    expect(contentTuple[0]).toBe("hemas-connect:ai-knowledge-content:v1");
    expect(JSON.parse(serializeAiKnowledgeSelectionV1(selectionBinding))[0]).toBe(
      "hemas-connect:ai-knowledge-selection:v1",
    );
    expect(requestTuple.slice(11, 14)).toEqual([
      false,
      "knowledge_selection_appointments_v3",
      selection.selectionFingerprint,
    ]);
    expect(runTuple[9]).toBe("none");
    expect(runTuple.slice(10, 12)).toEqual([null, null]);
    expect(runTuple[16]).toBe(AI_GOVERNANCE_EVALUATED_AT);
    expect(runTuple[18][1]).toEqual(["approved_knowledge_only"]);
    expect(eventTuple[6]).toBe(1);
    expect(eventTuple.slice(7, 9)).toEqual([null, null]);
  });

  it("pins golden SHA-256 digests for all eight canonical serializers", () => {
    const document = knowledge["kn-appointments-v3"];
    const selection = selections.knowledge_selection_appointments_v3;
    const selectionBinding = {
      selectionId: selection.selectionId,
      workspaceId: selection.workspaceId,
      documentId: selection.documentId,
      contentFingerprint: selection.contentFingerprint,
      approvalFingerprint: selection.approvalFingerprint,
      selectorVersionId: selection.selectorVersionId,
      selectedAt: selection.selectedAt,
      evaluatedAt: selection.evaluatedAt,
      selectionScope: selection.selectionScope,
      effectiveFrom: selection.effectiveFrom,
      effectiveUntil: selection.effectiveUntil,
      synthetic: selection.synthetic,
    };
    const appointment = retrospectives.appointment;
    const actual = {
      content: sha256(serializeAiKnowledgeContentV1(document.content)),
      approval: sha256(serializeAiKnowledgeApprovalV1(document.approval)),
      selection: sha256(serializeAiKnowledgeSelectionV1(selectionBinding)),
      request: sha256(serializeAiEvaluationRequestV1(appointment.request)),
      run: sha256(serializeAiRetrospectiveRunV1(appointment.run)),
      event: sha256(serializeAiRetrospectiveEventV1(appointment.event)),
      runSecret: sha256(serializeAiRetrospectiveRunSecretV1(appointment.runSecret)),
      eventSecret: sha256(
        serializeAiRetrospectiveEventSecretV1(appointment.eventSecret),
      ),
      stopRunSecret: sha256(
        serializeAiRetrospectiveRunSecretV1(retrospectives.stop.runSecret),
      ),
    };
    expect(actual).toEqual({
      content: "e007461619755ef801408cdf81c01d4f175f75e30d77466fd0a3b532f9818b2d",
      approval: "483194e6270375177f9e6c24eddf2e3ea05539aed54f8edba50ecbf8922290ee",
      selection: "97647436b47b0cc63f628ec0668f5ef0c97a7a6303f849c704aae00ac658794e",
      request: "846c8cd96ba70ec05b244683a328a302e68d307d104521a049bbe6927760e289",
      run: "91a95a245ca7f97b955278dba43a8f9746f741ca00da775fd93f401ae9504935",
      event: "c223e23abe8f05519ac60afc60660534550729b67c7c22a4b55275a047e78d69",
      runSecret: "0ee51150ab96f143ef8a1411fd9e748748cb330603988dffbee849caef7fe701",
      eventSecret: "df0ef78793c2f9dacee2a08467f991a530c17d8d4b36ad8c165e9ffdadb3b0d6",
      stopRunSecret: "05042333f06784fb508acd93c98e319eed3139c6c6a12ec7e67547a58104b7e3",
    });
  });
});
