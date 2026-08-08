import { Timestamp } from "firebase-admin/firestore";
import type { RuntimeConfig } from "../config.js";
import { deterministicId, sha256Hex } from "../deterministic.js";
import { FailClosedError, assertSafeTenantId } from "../errors.js";

/**
 * Server-owned mirror of the frozen browser/domain AI governance contract.
 * This module intentionally has no model, provider, prompt, queue or network API.
 */
export const AI_GOVERNANCE_WORKSPACE_ID = "workspace_safenet_demo" as const;
export const AI_GOVERNANCE_PROJECT_ID = "demo-hemas-connect" as const;
export const AI_GOVERNANCE_EVALUATED_AT = "2026-08-07T12:30:00.000Z" as const;
export const AI_GOVERNANCE_ACTION = "ai.retrospective_evaluation_recorded" as const;
export const AI_GOVERNANCE_RESOURCE_TYPE = "ai_retrospective_run" as const;
export const AI_GOVERNANCE_POLICY_VERSION_ID = "ai_policy_synthetic_v1" as const;
export const AI_GOVERNANCE_REVIEWER_VERSION_ID =
  "deterministic_healthcare_reviewer_v1" as const;
export const AI_GOVERNANCE_SELECTOR_VERSION_ID =
  "deterministic_knowledge_selector_v1" as const;
export const AI_GOVERNANCE_CALL_REQUEST_PREFIX =
  "hemas-connect:ai-retrospective-call:v1" as const;

export const AI_KNOWLEDGE_CONTENT_PREFIX =
  "hemas-connect:ai-knowledge-content:v1" as const;
export const AI_KNOWLEDGE_APPROVAL_PREFIX =
  "hemas-connect:ai-knowledge-approval:v1" as const;
export const AI_KNOWLEDGE_SELECTION_PREFIX =
  "hemas-connect:ai-knowledge-selection:v1" as const;
export const AI_EVALUATION_REQUEST_PREFIX =
  "hemas-connect:ai-evaluation-request:v1" as const;
export const AI_RETROSPECTIVE_RUN_PREFIX =
  "hemas-connect:ai-retrospective-run:v1" as const;
export const AI_RETROSPECTIVE_EVENT_PREFIX =
  "hemas-connect:ai-retrospective-event:v1" as const;
export const AI_RETROSPECTIVE_RUN_SECRET_PREFIX =
  "hemas-connect:ai-retrospective-run-secret:v1" as const;
export const AI_RETROSPECTIVE_EVENT_SECRET_PREFIX =
  "hemas-connect:ai-retrospective-event-secret:v1" as const;
export const AI_SOURCE_FIXTURE_IDENTITY_PREFIX =
  "hemas-connect:ai-source-fixture:v1" as const;
export const AI_DECISION_FIXTURE_IDENTITY_PREFIX =
  "hemas-connect:ai-decision-fixture:v1" as const;

export const AI_KNOWLEDGE_DOCUMENT_CREATED_AT = "2026-06-01T00:00:00.000Z" as const;
export const AI_KNOWLEDGE_DOCUMENT_UPDATED_AT = "2026-08-08T00:00:00.000Z" as const;
export const AI_KNOWLEDGE_SECRET_CREATED_AT = "2026-08-08T00:00:00.000Z" as const;
export const AI_KNOWLEDGE_SELECTION_CREATED_AT = "2026-08-08T00:10:00.000Z" as const;

export const AI_KNOWLEDGE_DOCUMENT_IDS = [
  "kn-appointments-v3",
  "kn-labs-v2",
  "kn-urgent-v5",
  "kn-package-draft",
  "kn-old-hours",
] as const;
export type AiKnowledgeDocumentId = (typeof AI_KNOWLEDGE_DOCUMENT_IDS)[number];

export const AI_KNOWLEDGE_SELECTION_IDS = [
  "knowledge_selection_appointments_v3",
  "knowledge_selection_labs_v2",
  "knowledge_selection_urgent_v5",
] as const;
export type AiKnowledgeSelectionId = (typeof AI_KNOWLEDGE_SELECTION_IDS)[number];

export const AI_PERSISTED_SCENARIO_IDS = [
  "appointment",
  "urgent",
  "mixed",
  "stop",
] as const;
export type AiPersistedScenarioId = (typeof AI_PERSISTED_SCENARIO_IDS)[number];

export type AiKnowledgeApprovalState = "approved" | "review" | "expired";
export type AiRetrospectiveOutcome =
  | "preview_only"
  | "safety_hold_already_present"
  | "human_takeover_already_present"
  | "suppression_already_recorded";

export const AI_KNOWLEDGE_DOCUMENT_MATRIX = Object.freeze({
  "kn-appointments-v3": Object.freeze({
    secretId: "knowledge_secret_appointments_v3",
    selectionId: "knowledge_selection_appointments_v3",
    title: "Appointment service guide",
    version: "3.1",
    language: "trilingual",
    contentKind: "appointment_service_guide",
    protectedContentRef: "demo://ai/knowledge/kn-appointments-v3/content-v1",
    protectedContentFingerprint: "d334592511d3c7e82299a8d6f705a60d5dbb895eb874111d57a7fd9b5b50ae2b",
    ownerUid: "user_demo_supervisor",
    approverUid: "user_demo_admin",
    approvalState: "approved",
    approvalScope: "synthetic_information_only",
    approvedAt: "2026-08-01T00:00:00.000Z",
    effectiveFrom: "2026-08-01T00:00:00.000Z",
    effectiveUntil: "2026-10-31T23:59:59.999Z",
  }),
  "kn-labs-v2": Object.freeze({
    secretId: "knowledge_secret_labs_v2",
    selectionId: "knowledge_selection_labs_v2",
    title: "Laboratory notification policy",
    version: "2.4",
    language: "trilingual",
    contentKind: "laboratory_notification_policy",
    protectedContentRef: "demo://ai/knowledge/kn-labs-v2/content-v1",
    protectedContentFingerprint: "e44d3fc81219765a3ff047b5f645b0f9eb75e4378c696c52689a65ad4b5935c3",
    ownerUid: "user_demo_clinical_approver",
    approverUid: "user_demo_admin",
    approvalState: "approved",
    approvalScope: "synthetic_information_only",
    approvedAt: "2026-07-01T00:00:00.000Z",
    effectiveFrom: "2026-07-01T00:00:00.000Z",
    effectiveUntil: "2026-09-30T23:59:59.999Z",
  }),
  "kn-urgent-v5": Object.freeze({
    secretId: "knowledge_secret_urgent_v5",
    selectionId: "knowledge_selection_urgent_v5",
    title: "Urgent-language response",
    version: "5.0",
    language: "trilingual",
    contentKind: "urgent_language_response",
    protectedContentRef: "demo://ai/knowledge/kn-urgent-v5/content-v1",
    protectedContentFingerprint: "f7e3eb28d426483efa749126f5d90c7b7803175590b2e3e6220ccd2b01b9f85a",
    ownerUid: "user_demo_clinical_approver",
    approverUid: "user_demo_admin",
    approvalState: "approved",
    approvalScope: "synthetic_information_only",
    approvedAt: "2026-08-01T00:00:00.000Z",
    effectiveFrom: "2026-08-01T00:00:00.000Z",
    effectiveUntil: "2026-08-31T23:59:59.999Z",
  }),
  "kn-package-draft": Object.freeze({
    secretId: "knowledge_secret_package_draft",
    selectionId: null,
    title: "Package information draft",
    version: "0.8",
    language: "en",
    contentKind: "package_information_draft",
    protectedContentRef: "demo://ai/knowledge/kn-package-draft/content-v1",
    protectedContentFingerprint: "64224b2192b465a3b6f7ad20960ebcc26dec838f56e67e2e5c1e21c0adf8c491",
    ownerUid: "user_demo_supervisor",
    approverUid: null,
    approvalState: "review",
    approvalScope: null,
    approvedAt: null,
    effectiveFrom: null,
    effectiveUntil: null,
  }),
  "kn-old-hours": Object.freeze({
    secretId: "knowledge_secret_old_hours",
    selectionId: null,
    title: "Archived branch-hours sample",
    version: "1.2",
    language: "en",
    contentKind: "archived_branch_hours",
    protectedContentRef: "demo://ai/knowledge/kn-old-hours/content-v1",
    protectedContentFingerprint: "41eff02986ef2a9472b9964523e3bf85fdd7902d7a9f5f03c945958217d58f80",
    ownerUid: "user_demo_supervisor",
    approverUid: "user_demo_admin",
    approvalState: "expired",
    approvalScope: "synthetic_information_only",
    approvedAt: "2026-06-01T00:00:00.000Z",
    effectiveFrom: "2026-06-01T00:00:00.000Z",
    effectiveUntil: "2026-07-31T23:59:59.999Z",
  }),
} as const);

export const AI_KNOWLEDGE_SELECTION_MATRIX = Object.freeze({
  knowledge_selection_appointments_v3: Object.freeze({ documentId: "kn-appointments-v3" }),
  knowledge_selection_labs_v2: Object.freeze({ documentId: "kn-labs-v2" }),
  knowledge_selection_urgent_v5: Object.freeze({ documentId: "kn-urgent-v5" }),
} as const);

export const AI_PERSISTED_SCENARIO_MATRIX = Object.freeze({
  appointment: Object.freeze({
    runId: "ai_run_demo_appointment_v1",
    eventId: "ai_run_event_demo_appointment_v1",
    runSecretId: "ai_run_secret_demo_appointment_v1",
    eventSecretId: "ai_run_event_secret_demo_appointment_v1",
    auditEventId: "audit_ai_run_demo_appointment_v1",
    syntheticConversationRef: "conversation_synthetic_appointment",
    sourceConnectionId: "connection_demo_simulator",
    sourceContactId: "contact_synthetic_appointment",
    sourceMessageId: "message_synthetic_appointment_inbound",
    sourceTeamId: "team_demo_general",
    sourceLocationId: "location_demo_wattala",
    sourcePurpose: "appointment",
    sourceFixtureFingerprint: "5125b9e1dada8b2213c0231038f29581c5c0bf060bb1637a988098f0b711b5da",
    decisionFixtureFingerprint: "5267fbb66f42a1b584c7b06872b041ebdea1c2b303e5eb348db8e35b489fbfea",
    language: "en", languageConfidence: 0.99, intent: "appointment_initiation",
    urgency: "none", knowledgeSelectionId: "knowledge_selection_appointments_v3",
    decision: "pass", reasonCodes: ["approved_knowledge_only"] as const,
    clinicalSafety: "pass", requiredCorrectionCode: null,
    marketingSuppressionRequired: false, sendMode: "preview_only", outcome: "preview_only",
    observedConversationStatus: "active", observedConversationMode: "automation",
    handoffRequired: false, urgentSafetyHoldObserved: false,
    contactMarketingSuppressionObserved: false, ordinaryAutomationPaused: false,
  }),
  urgent: Object.freeze({
    runId: "ai_run_demo_urgent_v1", eventId: "ai_run_event_demo_urgent_v1",
    runSecretId: "ai_run_secret_demo_urgent_v1", eventSecretId: "ai_run_event_secret_demo_urgent_v1",
    auditEventId: "audit_ai_run_demo_urgent_v1",
    syntheticConversationRef: "conversation_synthetic_urgent",
    sourceConnectionId: "connection_demo_simulator", sourceContactId: "contact_synthetic_urgent",
    sourceMessageId: "message_synthetic_urgent_inbound",
    sourceTeamId: "team_demo_clinical_escalation", sourceLocationId: "location_demo_wattala",
    sourcePurpose: "urgent_escalation",
    sourceFixtureFingerprint: "3d0893d84d05ac983641e4d1a9cc750dbf9338414764a75968fecd81889fdb86",
    decisionFixtureFingerprint: "443c30123b4ae72f8afa0bcf07175676cdd0d04833d77359866407a11c2cc789",
    language: "en", languageConfidence: 0.99, intent: "urgent_help", urgency: "urgent",
    knowledgeSelectionId: "knowledge_selection_urgent_v5", decision: "fail",
    reasonCodes: ["urgent_language"] as const, clinicalSafety: "blocked",
    requiredCorrectionCode: "preserve_existing_safety_hold",
    marketingSuppressionRequired: false, sendMode: "no_send",
    outcome: "safety_hold_already_present", observedConversationStatus: "escalated",
    observedConversationMode: "safety_hold", handoffRequired: true,
    urgentSafetyHoldObserved: true, contactMarketingSuppressionObserved: false,
    ordinaryAutomationPaused: true,
  }),
  mixed: Object.freeze({
    runId: "ai_run_demo_mixed_v1", eventId: "ai_run_event_demo_mixed_v1",
    runSecretId: "ai_run_secret_demo_mixed_v1", eventSecretId: "ai_run_event_secret_demo_mixed_v1",
    auditEventId: "audit_ai_run_demo_mixed_v1",
    syntheticConversationRef: "conversation_synthetic_mixed",
    sourceConnectionId: "connection_demo_simulator", sourceContactId: "contact_synthetic_mixed",
    sourceMessageId: "message_synthetic_mixed_inbound", sourceTeamId: "team_demo_general",
    sourceLocationId: "location_demo_wattala", sourcePurpose: "general_support",
    sourceFixtureFingerprint: "21c68bd1e6228207c76ed9558f4f78ece87240f215823f4afc1f47ce220775b3",
    decisionFixtureFingerprint: "a70e9a58a2c899bfeeba486508ba663f9b24753d5567eca5af8a3a932d1f64d1",
    language: "mixed", languageConfidence: 0.42, intent: "appointment_initiation",
    urgency: "none", knowledgeSelectionId: null, decision: "fail",
    reasonCodes: ["low_language_confidence"] as const, clinicalSafety: "pass",
    requiredCorrectionCode: "preserve_existing_human_takeover",
    marketingSuppressionRequired: false, sendMode: "no_send",
    outcome: "human_takeover_already_present", observedConversationStatus: "assigned",
    observedConversationMode: "human_takeover", handoffRequired: true,
    urgentSafetyHoldObserved: false, contactMarketingSuppressionObserved: false,
    ordinaryAutomationPaused: true,
  }),
  stop: Object.freeze({
    runId: "ai_run_demo_stop_v1", eventId: "ai_run_event_demo_stop_v1",
    runSecretId: "ai_run_secret_demo_stop_v1", eventSecretId: "ai_run_event_secret_demo_stop_v1",
    auditEventId: "audit_ai_run_demo_stop_v1",
    syntheticConversationRef: "conversation_synthetic_stopped",
    sourceConnectionId: "connection_demo_simulator", sourceContactId: "contact_synthetic_stopped",
    sourceMessageId: "message_synthetic_stop_inbound", sourceTeamId: "team_demo_general",
    sourceLocationId: "location_demo_wattala", sourcePurpose: "general_support",
    sourceFixtureFingerprint: "7dae206a7f96c3d9b25fc77dd2626544ef5857e4dfc9e50bb9c11b71f7ba6aa8",
    decisionFixtureFingerprint: "a98f88ea47e3da0ef89ddad513e85bfce09a2c552a5d1390aca99e40137083c8",
    language: "en", languageConfidence: 1, intent: "marketing_withdrawal", urgency: "none",
    knowledgeSelectionId: null, decision: "fail", reasonCodes: ["stop_intent"] as const,
    clinicalSafety: "pass", requiredCorrectionCode: "honor_existing_marketing_suppression",
    marketingSuppressionRequired: true, sendMode: "no_send",
    outcome: "suppression_already_recorded", observedConversationStatus: "resolved",
    observedConversationMode: "automation", handoffRequired: false,
    urgentSafetyHoldObserved: false, contactMarketingSuppressionObserved: true,
    ordinaryAutomationPaused: true,
  }),
} as const);

export interface AiRetrospectiveRequestInput {
  readonly workspaceId: typeof AI_GOVERNANCE_WORKSPACE_ID;
  readonly scenarioId: AiPersistedScenarioId;
  readonly idempotencyKey: string;
}

export interface AiRetrospectiveResult {
  readonly scenarioId: AiPersistedScenarioId;
  readonly runId: string;
  readonly eventId: string;
  readonly auditEventId: string;
  readonly outcome: AiRetrospectiveOutcome;
  readonly recordedAt: string;
  readonly modelCallCount: 0;
  readonly providerCallCount: 0;
  readonly externalDispatchCount: 0;
  readonly conversationMutationCount: 0;
  readonly handoffMutationCount: 0;
  readonly suppressionMutationCount: 0;
}

export interface AiRetrospectiveResponse {
  readonly result: AiRetrospectiveResult;
  readonly auditEventId: string;
  readonly replayed: boolean;
}

export interface AiGovernanceActor {
  readonly uid: string;
  readonly authTime: Date;
}

export interface AiGovernanceEmulatorBoundary {
  readonly projectId: string;
  readonly firestoreEmulatorHost: string | undefined;
}

export type AiRecord = Readonly<Record<string, unknown>>;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;

function fail(code: string, message: string): never {
  throw new FailClosedError(code, message);
}

export function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
  code = "invalid_ai_governance_evidence",
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail(code, `${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    return fail(code, `${label} must use its exact v1 fields.`);
  }
  return record;
}

export function timestampIso(value: unknown, label: string): string {
  let date: Date;
  if (value instanceof Timestamp) date = value.toDate();
  else if (value instanceof Date) date = value;
  else if (typeof value === "string") date = new Date(value);
  else return fail("invalid_ai_governance_evidence", `${label} must be a timestamp.`);
  const millis = date.getTime();
  if (!Number.isFinite(millis)) return fail("invalid_ai_governance_evidence", `${label} is invalid.`);
  const iso = date.toISOString();
  if (typeof value === "string" && value !== iso) {
    return fail("invalid_ai_governance_evidence", `${label} must use canonical millisecond ISO time.`);
  }
  return iso;
}

export function parseAiRetrospectiveRequestInput(value: unknown): AiRetrospectiveRequestInput {
  const record = exactRecord(
    value,
    ["workspaceId", "scenarioId", "idempotencyKey"],
    "AI retrospective request",
    "invalid_service_request",
  );
  if (record.workspaceId !== AI_GOVERNANCE_WORKSPACE_ID) {
    return fail("invalid_service_request", "The AI retrospective workspace is invalid.");
  }
  if (!AI_PERSISTED_SCENARIO_IDS.includes(record.scenarioId as AiPersistedScenarioId)) {
    return fail("invalid_service_request", "The AI retrospective scenario is invalid.");
  }
  if (typeof record.idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(record.idempotencyKey)) {
    return fail(
      "invalid_idempotency_key",
      "Idempotency key must contain 16 to 128 safe characters.",
    );
  }
  return record as unknown as AiRetrospectiveRequestInput;
}

function loopbackEmulatorHost(host: string | undefined): boolean {
  if (!host) return false;
  const normalized = host.includes("://") ? host : `http://${host}`;
  try {
    const url = new URL(normalized);
    return (
      ["127.0.0.1", "localhost", "::1"].includes(url.hostname) &&
      /^\d{1,5}$/.test(url.port) &&
      Number(url.port) >= 1 && Number(url.port) <= 65_535 &&
      !url.username && !url.password &&
      (url.pathname === "" || url.pathname === "/") &&
      !url.search && !url.hash
    );
  } catch {
    return false;
  }
}

export function assertAiGovernanceRuntimeBoundary(
  config: RuntimeConfig,
  boundary: AiGovernanceEmulatorBoundary,
  workspaceId: string,
): void {
  assertSafeTenantId(workspaceId);
  if (
    workspaceId !== AI_GOVERNANCE_WORKSPACE_ID ||
    config.runtimeMode !== "demo" ||
    config.defaultTenantId !== workspaceId ||
    config.providerMode !== "synthetic" ||
    config.hemasIntegrationMode !== "synthetic" ||
    config.auditSinkMode !== "durable" ||
    config.outboundEnabled ||
    !config.approvalGateRequired ||
    config.diagnosisEnabled ||
    boundary.projectId !== AI_GOVERNANCE_PROJECT_ID ||
    !loopbackEmulatorHost(boundary.firestoreEmulatorHost)
  ) {
    return fail(
      "ai_governance_service_disabled",
      "AI retrospective evidence is restricted to the synthetic loopback emulator boundary.",
    );
  }
}

export function aiReceiptDocumentId(input: {
  readonly actorUid: string;
  readonly action: typeof AI_GOVERNANCE_ACTION;
  readonly idempotencyKey: string;
}): string {
  if (!SAFE_ID.test(input.actorUid) || !IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
    return fail("invalid_service_request", "AI retrospective receipt identity is invalid.");
  }
  return deterministicId(
    "ai-retro-key",
    JSON.stringify([input.actorUid, input.action, input.idempotencyKey]),
  );
}

export function aiCallRequestFingerprint(input: {
  readonly actorUid: string;
  readonly workspaceId: typeof AI_GOVERNANCE_WORKSPACE_ID;
  readonly scenarioId: AiPersistedScenarioId;
}): string {
  return sha256Hex(JSON.stringify([
    AI_GOVERNANCE_CALL_REQUEST_PREFIX,
    input.actorUid,
    input.workspaceId,
    input.scenarioId,
    AI_GOVERNANCE_ACTION,
  ]));
}

type KnowledgeContentBinding = {
  readonly workspaceId: string; readonly documentId: AiKnowledgeDocumentId;
  readonly title: string; readonly version: string; readonly language: string;
  readonly contentKind: string; readonly ownerUid: string;
  readonly protectedContentFingerprint: string; readonly synthetic: true;
};
type KnowledgeApprovalBinding = {
  readonly workspaceId: string; readonly documentId: AiKnowledgeDocumentId;
  readonly contentFingerprint: string; readonly ownerUid: string;
  readonly approverUid: string | null; readonly approvalState: AiKnowledgeApprovalState;
  readonly approvalScope: string | null; readonly approvedAt: string | null;
  readonly evaluatedAt: string; readonly effectiveFrom: string | null;
  readonly effectiveUntil: string | null; readonly synthetic: true;
};
type KnowledgeSelectionBinding = {
  readonly selectionId: AiKnowledgeSelectionId; readonly workspaceId: string;
  readonly documentId: AiKnowledgeDocumentId; readonly contentFingerprint: string;
  readonly approvalFingerprint: string; readonly selectorVersionId: string;
  readonly selectedAt: string; readonly evaluatedAt: string;
  readonly selectionScope: "retrospective_synthetic_fixture";
  readonly effectiveFrom: string; readonly effectiveUntil: string; readonly synthetic: true;
};

export function serializeAiKnowledgeContentV1(input: KnowledgeContentBinding): string {
  return JSON.stringify([
    AI_KNOWLEDGE_CONTENT_PREFIX, input.workspaceId, input.documentId, input.title,
    input.version, input.language, input.contentKind, input.ownerUid,
    input.protectedContentFingerprint, input.synthetic,
  ]);
}

export function serializeAiKnowledgeApprovalV1(input: KnowledgeApprovalBinding): string {
  return JSON.stringify([
    AI_KNOWLEDGE_APPROVAL_PREFIX, input.workspaceId, input.documentId,
    input.contentFingerprint, input.ownerUid, input.approverUid, input.approvalState,
    input.approvalScope, input.approvedAt, input.evaluatedAt, input.effectiveFrom,
    input.effectiveUntil, input.synthetic,
  ]);
}

export function serializeAiKnowledgeSelectionV1(input: KnowledgeSelectionBinding): string {
  return JSON.stringify([
    AI_KNOWLEDGE_SELECTION_PREFIX, input.selectionId, input.workspaceId, input.documentId,
    input.contentFingerprint, input.approvalFingerprint, input.selectorVersionId,
    input.selectedAt, input.evaluatedAt, input.selectionScope, input.effectiveFrom,
    input.effectiveUntil, input.synthetic,
  ]);
}

export function buildAiGovernanceSeedContract(): {
  readonly documents: Readonly<Record<AiKnowledgeDocumentId, AiRecord>>;
  readonly secrets: Readonly<Record<string, AiRecord>>;
  readonly selections: Readonly<Record<AiKnowledgeSelectionId, AiRecord>>;
} {
  const documents = {} as Record<AiKnowledgeDocumentId, AiRecord>;
  const secrets: Record<string, AiRecord> = {};
  for (const id of AI_KNOWLEDGE_DOCUMENT_IDS) {
    const item = AI_KNOWLEDGE_DOCUMENT_MATRIX[id];
    const content: KnowledgeContentBinding = {
      workspaceId: AI_GOVERNANCE_WORKSPACE_ID, documentId: id, title: item.title,
      version: item.version, language: item.language, contentKind: item.contentKind,
      ownerUid: item.ownerUid, protectedContentFingerprint: item.protectedContentFingerprint,
      synthetic: true,
    };
    const contentFingerprint = sha256Hex(serializeAiKnowledgeContentV1(content));
    const approval: KnowledgeApprovalBinding = {
      workspaceId: AI_GOVERNANCE_WORKSPACE_ID, documentId: id, contentFingerprint,
      ownerUid: item.ownerUid, approverUid: item.approverUid,
      approvalState: item.approvalState, approvalScope: item.approvalScope,
      approvedAt: item.approvedAt, evaluatedAt: AI_GOVERNANCE_EVALUATED_AT,
      effectiveFrom: item.effectiveFrom, effectiveUntil: item.effectiveUntil, synthetic: true,
    };
    const approvalFingerprint = sha256Hex(serializeAiKnowledgeApprovalV1(approval));
    documents[id] = {
      id, workspaceId: AI_GOVERNANCE_WORKSPACE_ID, title: item.title, version: item.version,
      language: item.language, contentKind: item.contentKind, ownerUid: item.ownerUid,
      approverUid: item.approverUid, approvalState: item.approvalState,
      approvalScope: item.approvalScope, approvedAt: item.approvedAt,
      evaluatedAt: AI_GOVERNANCE_EVALUATED_AT, effectiveFrom: item.effectiveFrom,
      effectiveUntil: item.effectiveUntil, contentFingerprint, approvalFingerprint,
      synthetic: true, schemaVersion: 1, createdAt: AI_KNOWLEDGE_DOCUMENT_CREATED_AT,
      updatedAt: AI_KNOWLEDGE_DOCUMENT_UPDATED_AT,
    };
    secrets[item.secretId] = {
      id: item.secretId, workspaceId: AI_GOVERNANCE_WORKSPACE_ID, documentId: id,
      contentFingerprint, approvalFingerprint, protectedContentRef: item.protectedContentRef,
      protectedContentFingerprint: item.protectedContentFingerprint, synthetic: true,
      schemaVersion: 1, createdAt: AI_KNOWLEDGE_SECRET_CREATED_AT,
    };
  }
  const selections = {} as Record<AiKnowledgeSelectionId, AiRecord>;
  for (const selectionId of AI_KNOWLEDGE_SELECTION_IDS) {
    const documentId = AI_KNOWLEDGE_SELECTION_MATRIX[selectionId].documentId;
    const document = documents[documentId];
    const effectiveFrom = document.effectiveFrom as string;
    const effectiveUntil = document.effectiveUntil as string;
    const binding: KnowledgeSelectionBinding = {
      selectionId, workspaceId: AI_GOVERNANCE_WORKSPACE_ID, documentId,
      contentFingerprint: document.contentFingerprint as string,
      approvalFingerprint: document.approvalFingerprint as string,
      selectorVersionId: AI_GOVERNANCE_SELECTOR_VERSION_ID,
      selectedAt: AI_GOVERNANCE_EVALUATED_AT, evaluatedAt: AI_GOVERNANCE_EVALUATED_AT,
      selectionScope: "retrospective_synthetic_fixture", effectiveFrom, effectiveUntil,
      synthetic: true,
    };
    selections[selectionId] = {
      ...binding, selectionFingerprint: sha256Hex(serializeAiKnowledgeSelectionV1(binding)),
      schemaVersion: 1, createdAt: AI_KNOWLEDGE_SELECTION_CREATED_AT,
    };
  }
  return { documents, secrets, selections };
}

function decisionFields(scenarioId: AiPersistedScenarioId): AiRecord {
  const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
  return {
    decision: expected.decision, reasonCodes: expected.reasonCodes,
    unsupportedClaim: false, clinicalSafety: expected.clinicalSafety, privacy: "pass",
    serviceWindow: "in_window", requiredCorrectionCode: expected.requiredCorrectionCode,
    marketingSuppressionRequired: expected.marketingSuppressionRequired,
    sendMode: expected.sendMode, outcome: expected.outcome,
    observedConversationStatus: expected.observedConversationStatus,
    observedConversationMode: expected.observedConversationMode,
    handoffRequired: expected.handoffRequired,
    urgentSafetyHoldObserved: expected.urgentSafetyHoldObserved,
    contactMarketingSuppressionObserved: expected.contactMarketingSuppressionObserved,
    ordinaryAutomationPaused: expected.ordinaryAutomationPaused,
    retryCount: 0, eventCount: 1, modelCallCount: 0, providerCallCount: 0,
    externalDispatchCount: 0, conversationMutationCount: 0, handoffMutationCount: 0,
    suppressionMutationCount: 0, chainOfThoughtStored: false,
  };
}

function decisionTuple(input: AiRecord): readonly unknown[] {
  return [
    input.decision, input.reasonCodes, input.unsupportedClaim, input.clinicalSafety,
    input.privacy, input.serviceWindow, input.requiredCorrectionCode,
    input.marketingSuppressionRequired, input.sendMode, input.outcome,
    input.observedConversationStatus, input.observedConversationMode,
    input.handoffRequired, input.urgentSafetyHoldObserved,
    input.contactMarketingSuppressionObserved, input.ordinaryAutomationPaused,
    input.retryCount, input.eventCount, input.modelCallCount, input.providerCallCount,
    input.externalDispatchCount, input.conversationMutationCount,
    input.handoffMutationCount, input.suppressionMutationCount, input.chainOfThoughtStored,
  ];
}

export function serializeAiSourceFixtureIdentityV1(scenarioId: AiPersistedScenarioId): string {
  const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
  return JSON.stringify([
    AI_SOURCE_FIXTURE_IDENTITY_PREFIX, AI_GOVERNANCE_WORKSPACE_ID,
    "retrospective_synthetic_fixture", expected.sourceConnectionId,
    expected.syntheticConversationRef, expected.sourceContactId, expected.sourceMessageId,
    expected.sourceTeamId, expected.sourceLocationId, expected.sourcePurpose,
    expected.observedConversationStatus, expected.observedConversationMode,
    expected.handoffRequired, true,
  ]);
}

export function serializeAiDecisionFixtureIdentityV1(scenarioId: AiPersistedScenarioId): string {
  const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
  return JSON.stringify([
    AI_DECISION_FIXTURE_IDENTITY_PREFIX, AI_GOVERNANCE_WORKSPACE_ID, scenarioId,
    expected.decision, expected.reasonCodes, expected.outcome,
    AI_GOVERNANCE_EVALUATED_AT, true,
  ]);
}

export function serializeAiEvaluationRequestV1(input: AiRecord): string {
  return JSON.stringify([
    AI_EVALUATION_REQUEST_PREFIX, input.workspaceId, input.scenarioId,
    input.syntheticConversationRef, input.language, input.languageConfidence, input.intent,
    input.urgency, input.withinServiceWindow, input.observedConversationStatus,
    input.observedConversationMode, input.observedHandoffRequired,
    input.knowledgeSelectionId, input.knowledgeSelectionFingerprint,
    input.policyVersionId, input.reviewerVersionId, input.evaluatedAt, input.synthetic,
  ]);
}

export function serializeAiRetrospectiveRunV1(input: AiRecord): string {
  return JSON.stringify([
    AI_RETROSPECTIVE_RUN_PREFIX, input.id, input.workspaceId, input.scenarioId,
    input.evaluationScope, input.durableScenarioScope, input.requestFingerprint,
    input.knowledgeSelectionId, input.knowledgeSelectionFingerprint, input.modelProvider,
    input.modelId, input.promptVersionId, input.policyVersionId, input.reviewerVersionId,
    input.eventId, input.auditEventId, input.evaluatedAt, input.recordedAt,
    decisionTuple(input), input.synthetic, input.schemaVersion,
  ]);
}

export function serializeAiRetrospectiveEventV1(input: AiRecord): string {
  return JSON.stringify([
    AI_RETROSPECTIVE_EVENT_PREFIX, input.id, input.workspaceId, input.runId,
    input.scenarioId, input.eventType, input.sequence, input.previousEventId,
    input.retryOfEventId, input.requestFingerprint, input.runFingerprint,
    input.knowledgeSelectionId, input.knowledgeSelectionFingerprint, input.modelProvider,
    input.modelId, input.promptVersionId, input.policyVersionId, input.reviewerVersionId,
    input.auditEventId, input.evaluatedAt, input.createdAt, decisionTuple(input),
    input.synthetic, input.schemaVersion,
  ]);
}

function stopEvidenceTuple(input: AiRecord): readonly unknown[] {
  return [
    input.contactId, input.grantedConsentRecordId, input.grantedConsentStatus,
    input.grantedConsentCapturedAt, input.grantedConsentEvidenceRef,
    input.withdrawnConsentRecordId, input.withdrawnConsentStatus,
    input.withdrawnSupersedesRecordId, input.withdrawnConsentCapturedAt,
    input.withdrawnAt, input.withdrawnConsentEvidenceRef, input.purpose, input.category,
    input.channel, input.suppressionMarketing, input.suppressionAll,
    input.suppressionReason, input.suppressionUpdatedAt, input.consentEvidenceFingerprint,
    input.contactSuppressionEvidenceRef, input.contactSuppressionEvidenceFingerprint,
  ];
}

export function serializeAiRetrospectiveRunSecretV1(input: AiRecord): string {
  return JSON.stringify([
    AI_RETROSPECTIVE_RUN_SECRET_PREFIX, input.id, input.workspaceId, input.runId,
    input.scenarioId, input.requestFingerprint, input.runFingerprint,
    input.sourceConnectionId, input.sourceConversationId, input.sourceContactId,
    input.sourceMessageId, input.sourceTeamId, input.sourceLocationId, input.sourcePurpose,
    input.protectedRequestFixtureRef, input.protectedRequestFixtureFingerprint,
    input.stopSuppressionEvidence === null
      ? null
      : stopEvidenceTuple(input.stopSuppressionEvidence as AiRecord),
    input.synthetic, input.schemaVersion, input.createdAt,
  ]);
}

export function serializeAiRetrospectiveEventSecretV1(input: AiRecord): string {
  return JSON.stringify([
    AI_RETROSPECTIVE_EVENT_SECRET_PREFIX, input.id, input.workspaceId, input.eventId,
    input.runId, input.scenarioId, input.requestFingerprint, input.runFingerprint,
    input.eventFingerprint, input.protectedDecisionFixtureRef,
    input.protectedDecisionFixtureFingerprint, input.synthetic, input.schemaVersion,
    input.createdAt,
  ]);
}

export const AI_STOP_SUPPRESSION_EVIDENCE = Object.freeze({
  contactId: "contact_synthetic_stopped",
  grantedConsentRecordId: "consent_synthetic_stop_granted",
  grantedConsentStatus: "granted",
  grantedConsentCapturedAt: "2026-08-01T05:00:00.000Z",
  grantedConsentEvidenceRef: "demo://consent/stop-before",
  withdrawnConsentRecordId: "consent_synthetic_stop_withdrawn",
  withdrawnConsentStatus: "withdrawn",
  withdrawnSupersedesRecordId: "consent_synthetic_stop_granted",
  withdrawnConsentCapturedAt: "2026-08-07T12:20:00.000Z",
  withdrawnAt: "2026-08-07T12:20:00.000Z",
  withdrawnConsentEvidenceRef: "demo://consent/stop-keyword-event",
  purpose: "health_campaigns", category: "marketing", channel: "whatsapp",
  suppressionMarketing: true, suppressionAll: false, suppressionReason: "stop_keyword",
  suppressionUpdatedAt: "2026-08-07T12:20:00.000Z",
  consentEvidenceFingerprint: "8849f90377522b41a74b2d21958ca885c6f5d84222be607eb3fbd382d88b700f",
  contactSuppressionEvidenceRef: "demo://ai/stop/contact-suppression-evidence-v1",
  contactSuppressionEvidenceFingerprint: "039cc24be8127bf8e3e79a0d660f9bb14013268279945854535365019252adcd",
} as const);

export interface AiRuntimeAggregate {
  readonly requestBinding: AiRecord;
  readonly run: AiRecord;
  readonly event: AiRecord;
  readonly runSecret: AiRecord;
  readonly eventSecret: AiRecord;
  readonly result: AiRetrospectiveResult;
  readonly runFingerprint: string;
  readonly eventFingerprint: string;
}

export function buildAiRuntimeAggregate(
  scenarioId: AiPersistedScenarioId,
  recordedAt: string,
  selection: AiRecord | null,
): AiRuntimeAggregate {
  const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
  const selectionFingerprint = selection?.selectionFingerprint ?? null;
  if (
    selectionFingerprint !== null &&
    (typeof selectionFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(selectionFingerprint))
  ) {
    return fail("invalid_ai_governance_evidence", "Knowledge selection fingerprint is invalid.");
  }
  if (expected.knowledgeSelectionId === null ? selection !== null : selection?.selectionId !== expected.knowledgeSelectionId) {
    return fail("invalid_ai_governance_evidence", "Knowledge selection is substituted.");
  }
  const recordedMillis = Date.parse(recordedAt);
  if (
    !Number.isFinite(recordedMillis) ||
    new Date(recordedMillis).toISOString() !== recordedAt ||
    recordedMillis <= Date.parse(AI_GOVERNANCE_EVALUATED_AT)
  ) {
    return fail("invalid_ai_governance_time", "Server recordedAt must be canonical and later than evaluatedAt.");
  }
  const requestBinding: AiRecord = {
    workspaceId: AI_GOVERNANCE_WORKSPACE_ID, scenarioId,
    syntheticConversationRef: expected.syntheticConversationRef,
    language: expected.language, languageConfidence: expected.languageConfidence,
    intent: expected.intent, urgency: expected.urgency, withinServiceWindow: true,
    observedConversationStatus: expected.observedConversationStatus,
    observedConversationMode: expected.observedConversationMode,
    observedHandoffRequired: expected.handoffRequired,
    knowledgeSelectionId: expected.knowledgeSelectionId, knowledgeSelectionFingerprint: selectionFingerprint,
    policyVersionId: AI_GOVERNANCE_POLICY_VERSION_ID,
    reviewerVersionId: AI_GOVERNANCE_REVIEWER_VERSION_ID,
    evaluatedAt: AI_GOVERNANCE_EVALUATED_AT, synthetic: true,
  };
  const requestFingerprint = sha256Hex(serializeAiEvaluationRequestV1(requestBinding));
  const common = decisionFields(scenarioId);
  const run: AiRecord = {
    id: expected.runId, workspaceId: AI_GOVERNANCE_WORKSPACE_ID, scenarioId,
    evaluationScope: "retrospective_synthetic_fixture",
    durableScenarioScope: "partial_four_of_seven", requestFingerprint,
    knowledgeSelectionId: expected.knowledgeSelectionId,
    knowledgeSelectionFingerprint: selectionFingerprint, modelProvider: "none",
    modelId: null, promptVersionId: null, policyVersionId: AI_GOVERNANCE_POLICY_VERSION_ID,
    reviewerVersionId: AI_GOVERNANCE_REVIEWER_VERSION_ID, eventId: expected.eventId,
    auditEventId: expected.auditEventId, evaluatedAt: AI_GOVERNANCE_EVALUATED_AT,
    recordedAt, ...common, synthetic: true, schemaVersion: 1,
  };
  const runFingerprint = sha256Hex(serializeAiRetrospectiveRunV1(run));
  const event: AiRecord = {
    id: expected.eventId, workspaceId: AI_GOVERNANCE_WORKSPACE_ID, runId: expected.runId,
    scenarioId, eventType: "retrospective_evaluation_recorded", sequence: 1,
    previousEventId: null, retryOfEventId: null, requestFingerprint, runFingerprint,
    knowledgeSelectionId: expected.knowledgeSelectionId,
    knowledgeSelectionFingerprint: selectionFingerprint, modelProvider: "none",
    modelId: null, promptVersionId: null, policyVersionId: AI_GOVERNANCE_POLICY_VERSION_ID,
    reviewerVersionId: AI_GOVERNANCE_REVIEWER_VERSION_ID,
    auditEventId: expected.auditEventId, evaluatedAt: AI_GOVERNANCE_EVALUATED_AT,
    createdAt: recordedAt, ...common, synthetic: true, schemaVersion: 1,
  };
  const eventFingerprint = sha256Hex(serializeAiRetrospectiveEventV1(event));
  const runSecret: AiRecord = {
    id: expected.runSecretId, workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    runId: expected.runId, scenarioId, requestFingerprint, runFingerprint,
    sourceConnectionId: expected.sourceConnectionId,
    sourceConversationId: expected.syntheticConversationRef,
    sourceContactId: expected.sourceContactId, sourceMessageId: expected.sourceMessageId,
    sourceTeamId: expected.sourceTeamId, sourceLocationId: expected.sourceLocationId,
    sourcePurpose: expected.sourcePurpose,
    protectedRequestFixtureRef: `demo://ai/requests/${scenarioId}-v1`,
    protectedRequestFixtureFingerprint: expected.sourceFixtureFingerprint,
    stopSuppressionEvidence: scenarioId === "stop" ? AI_STOP_SUPPRESSION_EVIDENCE : null,
    synthetic: true, schemaVersion: 1, createdAt: recordedAt,
  };
  const eventSecret: AiRecord = {
    id: expected.eventSecretId, workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    eventId: expected.eventId, runId: expected.runId, scenarioId,
    requestFingerprint, runFingerprint, eventFingerprint,
    protectedDecisionFixtureRef: `demo://ai/decisions/${scenarioId}-v1`,
    protectedDecisionFixtureFingerprint: expected.decisionFixtureFingerprint,
    synthetic: true, schemaVersion: 1, createdAt: recordedAt,
  };
  const result: AiRetrospectiveResult = {
    scenarioId, runId: expected.runId, eventId: expected.eventId,
    auditEventId: expected.auditEventId, outcome: expected.outcome, recordedAt,
    modelCallCount: 0, providerCallCount: 0, externalDispatchCount: 0,
    conversationMutationCount: 0, handoffMutationCount: 0, suppressionMutationCount: 0,
  };
  return { requestBinding, run, event, runSecret, eventSecret, result, runFingerprint, eventFingerprint };
}

export const AI_AUDIT_METADATA_KEYS = Object.freeze([
  "scenarioId", "outcome", "evaluationScope", "synthetic", "modelCallCount",
  "providerCallCount", "externalDispatchCount", "conversationMutationCount",
  "handoffMutationCount", "suppressionMutationCount",
] as const);

export function aiAuditMetadata(result: AiRetrospectiveResult): AiRecord {
  return {
    scenarioId: result.scenarioId, outcome: result.outcome,
    evaluationScope: "retrospective_synthetic_fixture", synthetic: true,
    modelCallCount: 0, providerCallCount: 0, externalDispatchCount: 0,
    conversationMutationCount: 0, handoffMutationCount: 0, suppressionMutationCount: 0,
  };
}

export function toFirestoreTimes(record: AiRecord, timeKeys: readonly string[]): AiRecord {
  const output: Record<string, unknown> = { ...record };
  for (const key of timeKeys) output[key] = new Date(record[key] as string);
  return output;
}

export const AI_RUNTIME_PATH_COLLECTIONS = Object.freeze({
  run: "aiRuns", event: "aiRunEvents", runSecret: "aiRunSecrets",
  eventSecret: "aiRunEventSecrets", receipt: "idempotencyKeys", audit: "auditEvents",
  knowledgeDocument: "knowledgeDocuments", knowledgeSelection: "knowledgeSelections",
  knowledgeSecret: "knowledgeDocumentSecrets",
} as const);
