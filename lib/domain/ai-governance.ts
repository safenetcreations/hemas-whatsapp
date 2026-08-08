/**
 * Immutable AI/knowledge governance contracts for the local synthetic demo.
 *
 * This module deliberately models retrospective evidence, not an AI runtime.
 * It cannot represent a model/provider call, a queue/handoff write, a contact
 * mutation, an external dispatch, hidden reasoning, or a production claim.
 */

export const AI_GOVERNANCE_WORKSPACE_ID = "workspace_safenet_demo" as const;
export const AI_GOVERNANCE_EVALUATED_AT = "2026-08-07T12:30:00.000Z" as const;
export const AI_GOVERNANCE_POLICY_VERSION_ID = "ai_policy_synthetic_v1" as const;
export const AI_GOVERNANCE_REVIEWER_VERSION_ID =
  "deterministic_healthcare_reviewer_v1" as const;
export const AI_GOVERNANCE_SELECTOR_VERSION_ID =
  "deterministic_knowledge_selector_v1" as const;

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

export const AI_KNOWLEDGE_SECRET_IDS = [
  "knowledge_secret_appointments_v3",
  "knowledge_secret_labs_v2",
  "knowledge_secret_urgent_v5",
  "knowledge_secret_package_draft",
  "knowledge_secret_old_hours",
] as const;
export type AiKnowledgeSecretId = (typeof AI_KNOWLEDGE_SECRET_IDS)[number];

export const AI_PERSISTED_SCENARIO_IDS = [
  "appointment",
  "urgent",
  "mixed",
  "stop",
] as const;
export type AiPersistedScenarioId = (typeof AI_PERSISTED_SCENARIO_IDS)[number];

/** These remain deterministic in-memory checks and are not durable evidence. */
export const AI_LOCAL_ONLY_SCENARIO_IDS = [
  "medicine",
  "report",
  "price",
] as const;
export type AiLocalOnlyScenarioId = (typeof AI_LOCAL_ONLY_SCENARIO_IDS)[number];
export type AiGovernanceScenarioId = AiPersistedScenarioId | AiLocalOnlyScenarioId;
export type AiLocalOnlyReviewReason =
  | "clinical_advice_prohibited"
  | "unsupported_claim";

export const AI_LOCAL_ONLY_SCENARIO_MATRIX = Object.freeze({
  medicine: Object.freeze({ reason: "clinical_advice_prohibited" }),
  report: Object.freeze({ reason: "clinical_advice_prohibited" }),
  price: Object.freeze({ reason: "unsupported_claim" }),
} as const satisfies Readonly<Record<AiLocalOnlyScenarioId, Readonly<{
  reason: AiLocalOnlyReviewReason;
}>>>);

export const AI_GOVERNANCE_SCENARIO_IDS = [
  ...AI_PERSISTED_SCENARIO_IDS,
  ...AI_LOCAL_ONLY_SCENARIO_IDS,
] as const;

export const AI_GOVERNANCE_SCENARIO_COVERAGE = Object.freeze({
  all: AI_GOVERNANCE_SCENARIO_IDS,
  persisted: AI_PERSISTED_SCENARIO_IDS,
  localOnly: AI_LOCAL_ONLY_SCENARIO_IDS,
  durableScope: "partial_four_of_seven",
} as const);

/**
 * The emulator seed creates only the 13 immutable governance documents. Each
 * first one-shot scenario callable then atomically materializes six runtime
 * documents. Four materialized scenarios produce the terminal inventory of 37.
 */
export const AI_GOVERNANCE_EXPECTED_PERSISTENCE_COUNTS = Object.freeze({
  initialGovernanceSeed: Object.freeze({
    materializedScenarioCount: 0,
    knowledgeDocuments: 5,
    knowledgeSelections: 3,
    knowledgeSecrets: 5,
    retrospectiveRuns: 0,
    retrospectiveEvents: 0,
    retrospectiveRunSecrets: 0,
    retrospectiveEventSecrets: 0,
    idempotencyReceipts: 0,
    auditEvents: 0,
    totalDocuments: 13,
  }),
  perMaterializedScenario: Object.freeze({
    retrospectiveRuns: 1,
    retrospectiveEvents: 1,
    retrospectiveRunSecrets: 1,
    retrospectiveEventSecrets: 1,
    idempotencyReceipts: 1,
    auditEvents: 1,
    totalDocuments: 6,
  }),
  afterFirstMaterializedScenario: Object.freeze({
    materializedScenarioCount: 1,
    knowledgeDocuments: 5,
    knowledgeSelections: 3,
    knowledgeSecrets: 5,
    retrospectiveRuns: 1,
    retrospectiveEvents: 1,
    retrospectiveRunSecrets: 1,
    retrospectiveEventSecrets: 1,
    idempotencyReceipts: 1,
    auditEvents: 1,
    totalDocuments: 19,
  }),
  terminalAfterFourScenarios: Object.freeze({
    materializedScenarioCount: 4,
    knowledgeDocuments: 5,
    knowledgeSelections: 3,
    knowledgeSecrets: 5,
    retrospectiveRuns: 4,
    retrospectiveEvents: 4,
    retrospectiveRunSecrets: 4,
    retrospectiveEventSecrets: 4,
    idempotencyReceipts: 4,
    auditEvents: 4,
    totalDocuments: 37,
  }),
} as const);

export type AiKnowledgeLanguage = "en" | "si" | "ta" | "trilingual";
export type AiKnowledgeApprovalState = "approved" | "review" | "expired";
export type AiKnowledgeApprovalScope = "synthetic_information_only";
export type AiKnowledgeContentKind =
  | "appointment_service_guide"
  | "laboratory_notification_policy"
  | "urgent_language_response"
  | "package_information_draft"
  | "archived_branch_hours";

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
} as const satisfies Readonly<Record<AiKnowledgeDocumentId, Readonly<{
  secretId: AiKnowledgeSecretId;
  selectionId: AiKnowledgeSelectionId | null;
  title: string;
  version: string;
  language: AiKnowledgeLanguage;
  contentKind: AiKnowledgeContentKind;
  protectedContentRef: string;
  protectedContentFingerprint: string;
  ownerUid: string;
  approverUid: string | null;
  approvalState: AiKnowledgeApprovalState;
  approvalScope: AiKnowledgeApprovalScope | null;
  approvedAt: string | null;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
}>>>);

export const AI_KNOWLEDGE_SELECTION_MATRIX = Object.freeze({
  knowledge_selection_appointments_v3: Object.freeze({
    documentId: "kn-appointments-v3",
  }),
  knowledge_selection_labs_v2: Object.freeze({
    documentId: "kn-labs-v2",
  }),
  knowledge_selection_urgent_v5: Object.freeze({
    documentId: "kn-urgent-v5",
  }),
} as const satisfies Readonly<Record<AiKnowledgeSelectionId, Readonly<{
  documentId: AiKnowledgeDocumentId;
}>>>);

export type AiReviewLanguage = "en" | "si" | "ta" | "mixed";
export type AiReviewIntent =
  | "appointment_initiation"
  | "urgent_help"
  | "marketing_withdrawal";
export type AiUrgency = "none" | "urgent";
export type AiReviewDecision = "pass" | "fail";
export type AiReviewReason =
  | "approved_knowledge_only"
  | "urgent_language"
  | "low_language_confidence"
  | "stop_intent";
export type AiClinicalSafety = "pass" | "blocked";
export type AiSendMode = "preview_only" | "no_send";
export type AiRequiredCorrectionCode =
  | "preserve_existing_safety_hold"
  | "preserve_existing_human_takeover"
  | "honor_existing_marketing_suppression";
export type AiRetrospectiveOutcome =
  | "preview_only"
  | "safety_hold_already_present"
  | "human_takeover_already_present"
  | "suppression_already_recorded";
export type AiObservedConversationStatus =
  | "active"
  | "assigned"
  | "escalated"
  | "resolved";
export type AiObservedConversationMode =
  | "automation"
  | "human_takeover"
  | "safety_hold";
export type AiObservedConversationPurpose =
  | "appointment"
  | "urgent_escalation"
  | "general_support";

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
    language: "en",
    languageConfidence: 0.99,
    intent: "appointment_initiation",
    urgency: "none",
    withinServiceWindow: true,
    knowledgeSelectionId: "knowledge_selection_appointments_v3",
    decision: "pass",
    reasonCodes: ["approved_knowledge_only"] as const,
    unsupportedClaim: false,
    clinicalSafety: "pass",
    serviceWindow: "in_window",
    requiredCorrectionCode: null,
    marketingSuppressionRequired: false,
    sendMode: "preview_only",
    outcome: "preview_only",
    observedConversationStatus: "active",
    observedConversationMode: "automation",
    handoffRequired: false,
    urgentSafetyHoldObserved: false,
    contactMarketingSuppressionObserved: false,
    ordinaryAutomationPaused: false,
  }),
  urgent: Object.freeze({
    runId: "ai_run_demo_urgent_v1",
    eventId: "ai_run_event_demo_urgent_v1",
    runSecretId: "ai_run_secret_demo_urgent_v1",
    eventSecretId: "ai_run_event_secret_demo_urgent_v1",
    auditEventId: "audit_ai_run_demo_urgent_v1",
    syntheticConversationRef: "conversation_synthetic_urgent",
    sourceConnectionId: "connection_demo_simulator",
    sourceContactId: "contact_synthetic_urgent",
    sourceMessageId: "message_synthetic_urgent_inbound",
    sourceTeamId: "team_demo_clinical_escalation",
    sourceLocationId: "location_demo_wattala",
    sourcePurpose: "urgent_escalation",
    sourceFixtureFingerprint: "3d0893d84d05ac983641e4d1a9cc750dbf9338414764a75968fecd81889fdb86",
    decisionFixtureFingerprint: "443c30123b4ae72f8afa0bcf07175676cdd0d04833d77359866407a11c2cc789",
    language: "en",
    languageConfidence: 0.99,
    intent: "urgent_help",
    urgency: "urgent",
    withinServiceWindow: true,
    knowledgeSelectionId: "knowledge_selection_urgent_v5",
    decision: "fail",
    reasonCodes: ["urgent_language"] as const,
    unsupportedClaim: false,
    clinicalSafety: "blocked",
    serviceWindow: "in_window",
    requiredCorrectionCode: "preserve_existing_safety_hold",
    marketingSuppressionRequired: false,
    sendMode: "no_send",
    outcome: "safety_hold_already_present",
    observedConversationStatus: "escalated",
    observedConversationMode: "safety_hold",
    handoffRequired: true,
    urgentSafetyHoldObserved: true,
    contactMarketingSuppressionObserved: false,
    ordinaryAutomationPaused: true,
  }),
  mixed: Object.freeze({
    runId: "ai_run_demo_mixed_v1",
    eventId: "ai_run_event_demo_mixed_v1",
    runSecretId: "ai_run_secret_demo_mixed_v1",
    eventSecretId: "ai_run_event_secret_demo_mixed_v1",
    auditEventId: "audit_ai_run_demo_mixed_v1",
    syntheticConversationRef: "conversation_synthetic_mixed",
    sourceConnectionId: "connection_demo_simulator",
    sourceContactId: "contact_synthetic_mixed",
    sourceMessageId: "message_synthetic_mixed_inbound",
    sourceTeamId: "team_demo_general",
    sourceLocationId: "location_demo_wattala",
    sourcePurpose: "general_support",
    sourceFixtureFingerprint: "21c68bd1e6228207c76ed9558f4f78ece87240f215823f4afc1f47ce220775b3",
    decisionFixtureFingerprint: "a70e9a58a2c899bfeeba486508ba663f9b24753d5567eca5af8a3a932d1f64d1",
    language: "mixed",
    languageConfidence: 0.42,
    intent: "appointment_initiation",
    urgency: "none",
    withinServiceWindow: true,
    knowledgeSelectionId: null,
    decision: "fail",
    reasonCodes: ["low_language_confidence"] as const,
    unsupportedClaim: false,
    clinicalSafety: "pass",
    serviceWindow: "in_window",
    requiredCorrectionCode: "preserve_existing_human_takeover",
    marketingSuppressionRequired: false,
    sendMode: "no_send",
    outcome: "human_takeover_already_present",
    observedConversationStatus: "assigned",
    observedConversationMode: "human_takeover",
    handoffRequired: true,
    urgentSafetyHoldObserved: false,
    contactMarketingSuppressionObserved: false,
    ordinaryAutomationPaused: true,
  }),
  stop: Object.freeze({
    runId: "ai_run_demo_stop_v1",
    eventId: "ai_run_event_demo_stop_v1",
    runSecretId: "ai_run_secret_demo_stop_v1",
    eventSecretId: "ai_run_event_secret_demo_stop_v1",
    auditEventId: "audit_ai_run_demo_stop_v1",
    syntheticConversationRef: "conversation_synthetic_stopped",
    sourceConnectionId: "connection_demo_simulator",
    sourceContactId: "contact_synthetic_stopped",
    sourceMessageId: "message_synthetic_stop_inbound",
    sourceTeamId: "team_demo_general",
    sourceLocationId: "location_demo_wattala",
    sourcePurpose: "general_support",
    sourceFixtureFingerprint: "7dae206a7f96c3d9b25fc77dd2626544ef5857e4dfc9e50bb9c11b71f7ba6aa8",
    decisionFixtureFingerprint: "a98f88ea47e3da0ef89ddad513e85bfce09a2c552a5d1390aca99e40137083c8",
    language: "en",
    languageConfidence: 1,
    intent: "marketing_withdrawal",
    urgency: "none",
    withinServiceWindow: true,
    knowledgeSelectionId: null,
    decision: "fail",
    reasonCodes: ["stop_intent"] as const,
    unsupportedClaim: false,
    clinicalSafety: "pass",
    serviceWindow: "in_window",
    requiredCorrectionCode: "honor_existing_marketing_suppression",
    marketingSuppressionRequired: true,
    sendMode: "no_send",
    outcome: "suppression_already_recorded",
    observedConversationStatus: "resolved",
    observedConversationMode: "automation",
    handoffRequired: false,
    urgentSafetyHoldObserved: false,
    contactMarketingSuppressionObserved: true,
    ordinaryAutomationPaused: true,
  }),
} as const);

export type AiRetrospectiveRunId =
  (typeof AI_PERSISTED_SCENARIO_MATRIX)[AiPersistedScenarioId]["runId"];
export type AiRetrospectiveEventId =
  (typeof AI_PERSISTED_SCENARIO_MATRIX)[AiPersistedScenarioId]["eventId"];
export type AiRetrospectiveRunSecretId =
  (typeof AI_PERSISTED_SCENARIO_MATRIX)[AiPersistedScenarioId]["runSecretId"];
export type AiRetrospectiveEventSecretId =
  (typeof AI_PERSISTED_SCENARIO_MATRIX)[AiPersistedScenarioId]["eventSecretId"];
export type AiRetrospectiveAuditEventId =
  (typeof AI_PERSISTED_SCENARIO_MATRIX)[AiPersistedScenarioId]["auditEventId"];

export interface AiKnowledgeContentBindingV1 {
  readonly workspaceId: typeof AI_GOVERNANCE_WORKSPACE_ID;
  readonly documentId: AiKnowledgeDocumentId;
  readonly title: string;
  readonly version: string;
  readonly language: AiKnowledgeLanguage;
  readonly contentKind: AiKnowledgeContentKind;
  readonly ownerUid: string;
  readonly protectedContentFingerprint: string;
  readonly synthetic: true;
}

export interface AiKnowledgeApprovalBindingV1 {
  readonly workspaceId: typeof AI_GOVERNANCE_WORKSPACE_ID;
  readonly documentId: AiKnowledgeDocumentId;
  readonly contentFingerprint: string;
  readonly ownerUid: string;
  readonly approverUid: string | null;
  readonly approvalState: AiKnowledgeApprovalState;
  readonly approvalScope: AiKnowledgeApprovalScope | null;
  readonly approvedAt: string | null;
  readonly evaluatedAt: typeof AI_GOVERNANCE_EVALUATED_AT;
  readonly effectiveFrom: string | null;
  readonly effectiveUntil: string | null;
  readonly synthetic: true;
}

export interface StaffSafeAiKnowledgeDocumentV1 {
  readonly id: AiKnowledgeDocumentId;
  readonly workspaceId: typeof AI_GOVERNANCE_WORKSPACE_ID;
  readonly title: string;
  readonly version: string;
  readonly language: AiKnowledgeLanguage;
  readonly contentKind: AiKnowledgeContentKind;
  readonly ownerUid: string;
  readonly approverUid: string | null;
  readonly approvalState: AiKnowledgeApprovalState;
  readonly approvalScope: AiKnowledgeApprovalScope | null;
  readonly approvedAt: string | null;
  readonly evaluatedAt: typeof AI_GOVERNANCE_EVALUATED_AT;
  readonly effectiveFrom: string | null;
  readonly effectiveUntil: string | null;
  readonly contentFingerprint: string;
  readonly approvalFingerprint: string;
  readonly synthetic: true;
  readonly schemaVersion: 1;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AiKnowledgeDocumentSecretV1 {
  readonly id: AiKnowledgeSecretId;
  readonly workspaceId: typeof AI_GOVERNANCE_WORKSPACE_ID;
  readonly documentId: AiKnowledgeDocumentId;
  readonly contentFingerprint: string;
  readonly approvalFingerprint: string;
  readonly protectedContentRef: string;
  readonly protectedContentFingerprint: string;
  readonly synthetic: true;
  readonly schemaVersion: 1;
  readonly createdAt: string;
}

export interface AiKnowledgeSelectionBindingV1 {
  readonly selectionId: AiKnowledgeSelectionId;
  readonly workspaceId: typeof AI_GOVERNANCE_WORKSPACE_ID;
  readonly documentId: AiKnowledgeDocumentId;
  readonly contentFingerprint: string;
  readonly approvalFingerprint: string;
  readonly selectorVersionId: typeof AI_GOVERNANCE_SELECTOR_VERSION_ID;
  readonly selectedAt: typeof AI_GOVERNANCE_EVALUATED_AT;
  readonly evaluatedAt: typeof AI_GOVERNANCE_EVALUATED_AT;
  readonly selectionScope: "retrospective_synthetic_fixture";
  readonly effectiveFrom: string;
  readonly effectiveUntil: string;
  readonly synthetic: true;
}

export interface StaffSafeAiKnowledgeSelectionV1
  extends AiKnowledgeSelectionBindingV1 {
  readonly selectionFingerprint: string;
  readonly schemaVersion: 1;
  readonly createdAt: string;
}

export interface AiEvaluationRequestBindingV1 {
  readonly workspaceId: typeof AI_GOVERNANCE_WORKSPACE_ID;
  readonly scenarioId: AiPersistedScenarioId;
  readonly syntheticConversationRef: string;
  readonly language: AiReviewLanguage;
  readonly languageConfidence: number;
  readonly intent: AiReviewIntent;
  readonly urgency: AiUrgency;
  readonly withinServiceWindow: true;
  readonly observedConversationStatus: AiObservedConversationStatus;
  readonly observedConversationMode: AiObservedConversationMode;
  readonly observedHandoffRequired: boolean;
  readonly knowledgeSelectionId: AiKnowledgeSelectionId | null;
  readonly knowledgeSelectionFingerprint: string | null;
  readonly policyVersionId: typeof AI_GOVERNANCE_POLICY_VERSION_ID;
  readonly reviewerVersionId: typeof AI_GOVERNANCE_REVIEWER_VERSION_ID;
  readonly evaluatedAt: typeof AI_GOVERNANCE_EVALUATED_AT;
  readonly synthetic: true;
}

interface AiRetrospectiveDecisionFieldsV1 {
  readonly decision: AiReviewDecision;
  readonly reasonCodes: readonly [AiReviewReason];
  readonly unsupportedClaim: false;
  readonly clinicalSafety: AiClinicalSafety;
  readonly privacy: "pass";
  readonly serviceWindow: "in_window";
  readonly requiredCorrectionCode: AiRequiredCorrectionCode | null;
  readonly marketingSuppressionRequired: boolean;
  readonly sendMode: AiSendMode;
  readonly outcome: AiRetrospectiveOutcome;
  readonly observedConversationStatus: AiObservedConversationStatus;
  readonly observedConversationMode: AiObservedConversationMode;
  readonly handoffRequired: boolean;
  readonly urgentSafetyHoldObserved: boolean;
  readonly contactMarketingSuppressionObserved: boolean;
  readonly ordinaryAutomationPaused: boolean;
  readonly retryCount: 0;
  readonly eventCount: 1;
  readonly modelCallCount: 0;
  readonly providerCallCount: 0;
  readonly externalDispatchCount: 0;
  readonly conversationMutationCount: 0;
  readonly handoffMutationCount: 0;
  readonly suppressionMutationCount: 0;
  readonly chainOfThoughtStored: false;
}

export interface StaffSafeAiRetrospectiveRunV1
  extends AiRetrospectiveDecisionFieldsV1 {
  readonly id: AiRetrospectiveRunId;
  readonly workspaceId: typeof AI_GOVERNANCE_WORKSPACE_ID;
  readonly scenarioId: AiPersistedScenarioId;
  readonly evaluationScope: "retrospective_synthetic_fixture";
  readonly durableScenarioScope: "partial_four_of_seven";
  readonly requestFingerprint: string;
  readonly knowledgeSelectionId: AiKnowledgeSelectionId | null;
  readonly knowledgeSelectionFingerprint: string | null;
  readonly modelProvider: "none";
  readonly modelId: null;
  readonly promptVersionId: null;
  readonly policyVersionId: typeof AI_GOVERNANCE_POLICY_VERSION_ID;
  readonly reviewerVersionId: typeof AI_GOVERNANCE_REVIEWER_VERSION_ID;
  readonly eventId: AiRetrospectiveEventId;
  readonly auditEventId: AiRetrospectiveAuditEventId;
  readonly evaluatedAt: typeof AI_GOVERNANCE_EVALUATED_AT;
  readonly recordedAt: string;
  readonly synthetic: true;
  readonly schemaVersion: 1;
}

export interface StaffSafeAiRetrospectiveEventV1
  extends AiRetrospectiveDecisionFieldsV1 {
  readonly id: AiRetrospectiveEventId;
  readonly workspaceId: typeof AI_GOVERNANCE_WORKSPACE_ID;
  readonly runId: AiRetrospectiveRunId;
  readonly scenarioId: AiPersistedScenarioId;
  readonly eventType: "retrospective_evaluation_recorded";
  readonly sequence: 1;
  readonly previousEventId: null;
  readonly retryOfEventId: null;
  readonly requestFingerprint: string;
  readonly runFingerprint: string;
  readonly knowledgeSelectionId: AiKnowledgeSelectionId | null;
  readonly knowledgeSelectionFingerprint: string | null;
  readonly modelProvider: "none";
  readonly modelId: null;
  readonly promptVersionId: null;
  readonly policyVersionId: typeof AI_GOVERNANCE_POLICY_VERSION_ID;
  readonly reviewerVersionId: typeof AI_GOVERNANCE_REVIEWER_VERSION_ID;
  readonly auditEventId: AiRetrospectiveAuditEventId;
  readonly evaluatedAt: typeof AI_GOVERNANCE_EVALUATED_AT;
  readonly createdAt: string;
  readonly synthetic: true;
  readonly schemaVersion: 1;
}

export interface AiStopSuppressionEvidenceV1 {
  readonly contactId: "contact_synthetic_stopped";
  readonly grantedConsentRecordId: "consent_synthetic_stop_granted";
  readonly grantedConsentStatus: "granted";
  readonly grantedConsentCapturedAt: "2026-08-01T05:00:00.000Z";
  readonly grantedConsentEvidenceRef: "demo://consent/stop-before";
  readonly withdrawnConsentRecordId: "consent_synthetic_stop_withdrawn";
  readonly withdrawnConsentStatus: "withdrawn";
  readonly withdrawnSupersedesRecordId: "consent_synthetic_stop_granted";
  readonly withdrawnConsentCapturedAt: "2026-08-07T12:20:00.000Z";
  readonly withdrawnAt: "2026-08-07T12:20:00.000Z";
  readonly withdrawnConsentEvidenceRef: "demo://consent/stop-keyword-event";
  readonly purpose: "health_campaigns";
  readonly category: "marketing";
  readonly channel: "whatsapp";
  readonly suppressionMarketing: true;
  readonly suppressionAll: false;
  readonly suppressionReason: "stop_keyword";
  readonly suppressionUpdatedAt: "2026-08-07T12:20:00.000Z";
  readonly consentEvidenceFingerprint: "8849f90377522b41a74b2d21958ca885c6f5d84222be607eb3fbd382d88b700f";
  readonly contactSuppressionEvidenceRef: "demo://ai/stop/contact-suppression-evidence-v1";
  readonly contactSuppressionEvidenceFingerprint: "039cc24be8127bf8e3e79a0d660f9bb14013268279945854535365019252adcd";
}

export interface AiRetrospectiveRunSecretV1 {
  readonly id: AiRetrospectiveRunSecretId;
  readonly workspaceId: typeof AI_GOVERNANCE_WORKSPACE_ID;
  readonly runId: AiRetrospectiveRunId;
  readonly scenarioId: AiPersistedScenarioId;
  readonly requestFingerprint: string;
  readonly runFingerprint: string;
  readonly sourceConnectionId: "connection_demo_simulator";
  readonly sourceConversationId: string;
  readonly sourceContactId: string;
  readonly sourceMessageId: string;
  readonly sourceTeamId: string;
  readonly sourceLocationId: string;
  readonly sourcePurpose: AiObservedConversationPurpose;
  readonly protectedRequestFixtureRef: string;
  readonly protectedRequestFixtureFingerprint: string;
  readonly stopSuppressionEvidence: AiStopSuppressionEvidenceV1 | null;
  readonly synthetic: true;
  readonly schemaVersion: 1;
  readonly createdAt: string;
}

export interface AiRetrospectiveEventSecretV1 {
  readonly id: AiRetrospectiveEventSecretId;
  readonly workspaceId: typeof AI_GOVERNANCE_WORKSPACE_ID;
  readonly eventId: AiRetrospectiveEventId;
  readonly runId: AiRetrospectiveRunId;
  readonly scenarioId: AiPersistedScenarioId;
  readonly requestFingerprint: string;
  readonly runFingerprint: string;
  readonly eventFingerprint: string;
  readonly protectedDecisionFixtureRef: string;
  readonly protectedDecisionFixtureFingerprint: string;
  readonly synthetic: true;
  readonly schemaVersion: 1;
  readonly createdAt: string;
}

const KNOWLEDGE_CONTENT_KEYS = [
  "workspaceId",
  "documentId",
  "title",
  "version",
  "language",
  "contentKind",
  "ownerUid",
  "protectedContentFingerprint",
  "synthetic",
] as const;
const KNOWLEDGE_APPROVAL_KEYS = [
  "workspaceId",
  "documentId",
  "contentFingerprint",
  "ownerUid",
  "approverUid",
  "approvalState",
  "approvalScope",
  "approvedAt",
  "evaluatedAt",
  "effectiveFrom",
  "effectiveUntil",
  "synthetic",
] as const;
const KNOWLEDGE_DOCUMENT_KEYS = [
  "id",
  "workspaceId",
  "title",
  "version",
  "language",
  "contentKind",
  "ownerUid",
  "approverUid",
  "approvalState",
  "approvalScope",
  "approvedAt",
  "evaluatedAt",
  "effectiveFrom",
  "effectiveUntil",
  "contentFingerprint",
  "approvalFingerprint",
  "synthetic",
  "schemaVersion",
  "createdAt",
  "updatedAt",
] as const;
const KNOWLEDGE_SECRET_KEYS = [
  "id",
  "workspaceId",
  "documentId",
  "contentFingerprint",
  "approvalFingerprint",
  "protectedContentRef",
  "protectedContentFingerprint",
  "synthetic",
  "schemaVersion",
  "createdAt",
] as const;
const KNOWLEDGE_SELECTION_BINDING_KEYS = [
  "selectionId",
  "workspaceId",
  "documentId",
  "contentFingerprint",
  "approvalFingerprint",
  "selectorVersionId",
  "selectedAt",
  "evaluatedAt",
  "selectionScope",
  "effectiveFrom",
  "effectiveUntil",
  "synthetic",
] as const;
const KNOWLEDGE_SELECTION_KEYS = [
  ...KNOWLEDGE_SELECTION_BINDING_KEYS,
  "selectionFingerprint",
  "schemaVersion",
  "createdAt",
] as const;
const EVALUATION_REQUEST_KEYS = [
  "workspaceId",
  "scenarioId",
  "syntheticConversationRef",
  "language",
  "languageConfidence",
  "intent",
  "urgency",
  "withinServiceWindow",
  "observedConversationStatus",
  "observedConversationMode",
  "observedHandoffRequired",
  "knowledgeSelectionId",
  "knowledgeSelectionFingerprint",
  "policyVersionId",
  "reviewerVersionId",
  "evaluatedAt",
  "synthetic",
] as const;
const DECISION_KEYS = [
  "decision",
  "reasonCodes",
  "unsupportedClaim",
  "clinicalSafety",
  "privacy",
  "serviceWindow",
  "requiredCorrectionCode",
  "marketingSuppressionRequired",
  "sendMode",
  "outcome",
  "observedConversationStatus",
  "observedConversationMode",
  "handoffRequired",
  "urgentSafetyHoldObserved",
  "contactMarketingSuppressionObserved",
  "ordinaryAutomationPaused",
  "retryCount",
  "eventCount",
  "modelCallCount",
  "providerCallCount",
  "externalDispatchCount",
  "conversationMutationCount",
  "handoffMutationCount",
  "suppressionMutationCount",
  "chainOfThoughtStored",
] as const;
const RUN_KEYS = [
  "id",
  "workspaceId",
  "scenarioId",
  "evaluationScope",
  "durableScenarioScope",
  "requestFingerprint",
  "knowledgeSelectionId",
  "knowledgeSelectionFingerprint",
  "modelProvider",
  "modelId",
  "promptVersionId",
  "policyVersionId",
  "reviewerVersionId",
  "eventId",
  "auditEventId",
  "evaluatedAt",
  "recordedAt",
  ...DECISION_KEYS,
  "synthetic",
  "schemaVersion",
] as const;
const EVENT_KEYS = [
  "id",
  "workspaceId",
  "runId",
  "scenarioId",
  "eventType",
  "sequence",
  "previousEventId",
  "retryOfEventId",
  "requestFingerprint",
  "runFingerprint",
  "knowledgeSelectionId",
  "knowledgeSelectionFingerprint",
  "modelProvider",
  "modelId",
  "promptVersionId",
  "policyVersionId",
  "reviewerVersionId",
  "auditEventId",
  "evaluatedAt",
  "createdAt",
  ...DECISION_KEYS,
  "synthetic",
  "schemaVersion",
] as const;
const STOP_EVIDENCE_KEYS = [
  "contactId",
  "grantedConsentRecordId",
  "grantedConsentStatus",
  "grantedConsentCapturedAt",
  "grantedConsentEvidenceRef",
  "withdrawnConsentRecordId",
  "withdrawnConsentStatus",
  "withdrawnSupersedesRecordId",
  "withdrawnConsentCapturedAt",
  "withdrawnAt",
  "withdrawnConsentEvidenceRef",
  "purpose",
  "category",
  "channel",
  "suppressionMarketing",
  "suppressionAll",
  "suppressionReason",
  "suppressionUpdatedAt",
  "consentEvidenceFingerprint",
  "contactSuppressionEvidenceRef",
  "contactSuppressionEvidenceFingerprint",
] as const;
const RUN_SECRET_KEYS = [
  "id",
  "workspaceId",
  "runId",
  "scenarioId",
  "requestFingerprint",
  "runFingerprint",
  "sourceConnectionId",
  "sourceConversationId",
  "sourceContactId",
  "sourceMessageId",
  "sourceTeamId",
  "sourceLocationId",
  "sourcePurpose",
  "protectedRequestFixtureRef",
  "protectedRequestFixtureFingerprint",
  "stopSuppressionEvidence",
  "synthetic",
  "schemaVersion",
  "createdAt",
] as const;
const EVENT_SECRET_KEYS = [
  "id",
  "workspaceId",
  "eventId",
  "runId",
  "scenarioId",
  "requestFingerprint",
  "runFingerprint",
  "eventFingerprint",
  "protectedDecisionFixtureRef",
  "protectedDecisionFixtureFingerprint",
  "synthetic",
  "schemaVersion",
  "createdAt",
] as const;

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: unknown,
  keys: readonly string[],
  label: string,
): asserts value is Readonly<Record<string, unknown>> {
  if (!isRecord(value)) fail(`${label} must be an object.`);
  const actual = Object.keys(value);
  const expected = new Set(keys);
  if (actual.length !== keys.length || actual.some((key) => !expected.has(key))) {
    fail(`${label} must use its exact v1 keys.`);
  }
}

function assertLiteral(value: unknown, expected: unknown, label: string): void {
  if (value !== expected) fail(`${label} does not match the fixed synthetic contract.`);
}

function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_-]{2,119}$/.test(value)) {
    fail(`${label} must be a canonical identifier.`);
  }
}

function assertBoundedString(
  value: unknown,
  label: string,
  maxLength: number,
): asserts value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength || value.trim() !== value) {
    fail(`${label} must be a non-empty bounded string without edge whitespace.`);
  }
}

function assertFingerprint(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    fail(`${label} must be a lowercase SHA-256 fingerprint.`);
  }
}

function canonicalMillis(value: unknown, label: string): number {
  if (typeof value !== "string") fail(`${label} must be a timestamp.`);
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== value) {
    fail(`${label} must be a canonical millisecond ISO timestamp.`);
  }
  return millis;
}

function assertDemoRef(value: unknown, prefix: string, label: string): asserts value is string {
  if (typeof value !== "string" || !value.startsWith(prefix) || value.length > 180) {
    fail(`${label} must be a bounded synthetic demo reference.`);
  }
}

function assertScenarioId(value: unknown, label: string): asserts value is AiPersistedScenarioId {
  if (!AI_PERSISTED_SCENARIO_IDS.includes(value as AiPersistedScenarioId)) {
    fail(`${label} is not one of the four persisted retrospective scenarios.`);
  }
}

function assertKnowledgeDocumentId(
  value: unknown,
  label: string,
): asserts value is AiKnowledgeDocumentId {
  if (!AI_KNOWLEDGE_DOCUMENT_IDS.includes(value as AiKnowledgeDocumentId)) {
    fail(`${label} is not a fixed knowledge document ID.`);
  }
}

function assertKnowledgeSelectionId(
  value: unknown,
  label: string,
): asserts value is AiKnowledgeSelectionId {
  if (!AI_KNOWLEDGE_SELECTION_IDS.includes(value as AiKnowledgeSelectionId)) {
    fail(`${label} is not a fixed knowledge selection ID.`);
  }
}

function assertNullableSelectionBinding(
  selectionId: unknown,
  selectionFingerprint: unknown,
  scenarioId: AiPersistedScenarioId,
  label: string,
): void {
  const expectedId = AI_PERSISTED_SCENARIO_MATRIX[scenarioId].knowledgeSelectionId;
  assertLiteral(selectionId, expectedId, `${label} selection ID`);
  if (expectedId === null) {
    assertLiteral(selectionFingerprint, null, `${label} selection fingerprint`);
  } else {
    assertFingerprint(selectionFingerprint, `${label} selection fingerprint`);
  }
}

function assertApprovalWindow(
  state: AiKnowledgeApprovalState,
  approvedAt: unknown,
  effectiveFrom: unknown,
  effectiveUntil: unknown,
  evaluatedAt: unknown,
  label: string,
): void {
  const evaluated = canonicalMillis(evaluatedAt, `${label} evaluatedAt`);
  if (state === "review") {
    if (approvedAt !== null || effectiveFrom !== null || effectiveUntil !== null) {
      fail(`${label} under review cannot have approval or effective-window timestamps.`);
    }
    return;
  }
  const approved = canonicalMillis(approvedAt, `${label} approvedAt`);
  const from = canonicalMillis(effectiveFrom, `${label} effectiveFrom`);
  const until = canonicalMillis(effectiveUntil, `${label} effectiveUntil`);
  if (approved > from || from > until) fail(`${label} approval chronology is invalid.`);
  if (state === "approved" && (evaluated < from || evaluated > until)) {
    fail(`${label} approved window must contain evaluatedAt.`);
  }
  if (state === "expired" && evaluated <= until) {
    fail(`${label} expired window must end before evaluatedAt.`);
  }
}

export function assertAiKnowledgeContentBindingV1(
  value: unknown,
): asserts value is AiKnowledgeContentBindingV1 {
  assertExactKeys(value, KNOWLEDGE_CONTENT_KEYS, "AI knowledge content binding");
  assertKnowledgeDocumentId(value.documentId, "AI knowledge content document ID");
  const expected = AI_KNOWLEDGE_DOCUMENT_MATRIX[value.documentId];
  assertLiteral(value.workspaceId, AI_GOVERNANCE_WORKSPACE_ID, "AI knowledge content workspace");
  assertBoundedString(value.title, "AI knowledge content title", 120);
  assertBoundedString(value.version, "AI knowledge content version", 24);
  assertIdentifier(value.ownerUid, "AI knowledge content owner");
  assertLiteral(value.title, expected.title, "AI knowledge content title");
  assertLiteral(value.version, expected.version, "AI knowledge content version");
  assertLiteral(value.language, expected.language, "AI knowledge content language");
  assertLiteral(value.contentKind, expected.contentKind, "AI knowledge content kind");
  assertLiteral(value.ownerUid, expected.ownerUid, "AI knowledge content owner");
  assertFingerprint(value.protectedContentFingerprint, "AI knowledge protected-content fingerprint");
  assertLiteral(
    value.protectedContentFingerprint,
    expected.protectedContentFingerprint,
    "AI knowledge allowlisted protected-content fingerprint",
  );
  assertLiteral(value.synthetic, true, "AI knowledge content synthetic marker");
}

export function assertAiKnowledgeApprovalBindingV1(
  value: unknown,
): asserts value is AiKnowledgeApprovalBindingV1 {
  assertExactKeys(value, KNOWLEDGE_APPROVAL_KEYS, "AI knowledge approval binding");
  assertKnowledgeDocumentId(value.documentId, "AI knowledge approval document ID");
  const expected = AI_KNOWLEDGE_DOCUMENT_MATRIX[value.documentId];
  assertLiteral(value.workspaceId, AI_GOVERNANCE_WORKSPACE_ID, "AI knowledge approval workspace");
  assertFingerprint(value.contentFingerprint, "AI knowledge approval content fingerprint");
  assertLiteral(value.ownerUid, expected.ownerUid, "AI knowledge approval owner");
  assertLiteral(value.approverUid, expected.approverUid, "AI knowledge approver");
  assertLiteral(value.approvalState, expected.approvalState, "AI knowledge approval state");
  assertLiteral(value.approvalScope, expected.approvalScope, "AI knowledge approval scope");
  assertLiteral(value.approvedAt, expected.approvedAt, "AI knowledge approvedAt");
  assertLiteral(value.evaluatedAt, AI_GOVERNANCE_EVALUATED_AT, "AI knowledge evaluatedAt");
  assertLiteral(value.effectiveFrom, expected.effectiveFrom, "AI knowledge effectiveFrom");
  assertLiteral(value.effectiveUntil, expected.effectiveUntil, "AI knowledge effectiveUntil");
  assertLiteral(value.synthetic, true, "AI knowledge approval synthetic marker");
  assertApprovalWindow(
    value.approvalState as AiKnowledgeApprovalState,
    value.approvedAt,
    value.effectiveFrom,
    value.effectiveUntil,
    value.evaluatedAt,
    "AI knowledge approval",
  );
}

export function assertStaffSafeAiKnowledgeDocumentV1(
  value: unknown,
): asserts value is StaffSafeAiKnowledgeDocumentV1 {
  assertExactKeys(value, KNOWLEDGE_DOCUMENT_KEYS, "AI knowledge document");
  assertKnowledgeDocumentId(value.id, "AI knowledge document ID");
  const expected = AI_KNOWLEDGE_DOCUMENT_MATRIX[value.id];
  assertLiteral(value.workspaceId, AI_GOVERNANCE_WORKSPACE_ID, "AI knowledge document workspace");
  for (const [key, expectedValue] of Object.entries({
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
  })) {
    assertLiteral(value[key], expectedValue, `AI knowledge document ${key}`);
  }
  assertFingerprint(value.contentFingerprint, "AI knowledge document content fingerprint");
  assertFingerprint(value.approvalFingerprint, "AI knowledge document approval fingerprint");
  assertLiteral(value.synthetic, true, "AI knowledge document synthetic marker");
  assertLiteral(value.schemaVersion, 1, "AI knowledge document schema version");
  const created = canonicalMillis(value.createdAt, "AI knowledge document createdAt");
  const updated = canonicalMillis(value.updatedAt, "AI knowledge document updatedAt");
  if (created > updated) fail("AI knowledge document timestamps must be monotonic.");
  assertApprovalWindow(
    value.approvalState as AiKnowledgeApprovalState,
    value.approvedAt,
    value.effectiveFrom,
    value.effectiveUntil,
    value.evaluatedAt,
    "AI knowledge document",
  );
}

export function assertAiKnowledgeDocumentSecretV1(
  value: unknown,
): asserts value is AiKnowledgeDocumentSecretV1 {
  assertExactKeys(value, KNOWLEDGE_SECRET_KEYS, "AI knowledge secret");
  assertKnowledgeDocumentId(value.documentId, "AI knowledge secret document ID");
  const expected = AI_KNOWLEDGE_DOCUMENT_MATRIX[value.documentId];
  assertLiteral(value.id, expected.secretId, "AI knowledge secret ID");
  assertLiteral(value.workspaceId, AI_GOVERNANCE_WORKSPACE_ID, "AI knowledge secret workspace");
  assertFingerprint(value.contentFingerprint, "AI knowledge secret content fingerprint");
  assertFingerprint(value.approvalFingerprint, "AI knowledge secret approval fingerprint");
  assertDemoRef(value.protectedContentRef, "demo://ai/knowledge/", "AI knowledge protected-content ref");
  assertLiteral(value.protectedContentRef, expected.protectedContentRef, "AI knowledge protected-content ref");
  assertFingerprint(value.protectedContentFingerprint, "AI knowledge protected-content fingerprint");
  assertLiteral(
    value.protectedContentFingerprint,
    expected.protectedContentFingerprint,
    "AI knowledge allowlisted protected-content fingerprint",
  );
  assertLiteral(value.synthetic, true, "AI knowledge secret synthetic marker");
  assertLiteral(value.schemaVersion, 1, "AI knowledge secret schema version");
  const created = canonicalMillis(value.createdAt, "AI knowledge secret createdAt");
  if (created <= Date.parse(AI_GOVERNANCE_EVALUATED_AT)) {
    fail("AI knowledge secret server createdAt must be later than evaluatedAt.");
  }
}

export function assertAiKnowledgeSelectionBindingV1(
  value: unknown,
): asserts value is AiKnowledgeSelectionBindingV1 {
  assertExactKeys(value, KNOWLEDGE_SELECTION_BINDING_KEYS, "AI knowledge selection binding");
  assertKnowledgeSelectionId(value.selectionId, "AI knowledge selection ID");
  const selectedDocumentId = AI_KNOWLEDGE_SELECTION_MATRIX[value.selectionId].documentId;
  const expectedDocument = AI_KNOWLEDGE_DOCUMENT_MATRIX[selectedDocumentId];
  assertLiteral(value.workspaceId, AI_GOVERNANCE_WORKSPACE_ID, "AI knowledge selection workspace");
  assertLiteral(value.documentId, selectedDocumentId, "AI knowledge selected document");
  assertFingerprint(value.contentFingerprint, "AI knowledge selection content fingerprint");
  assertFingerprint(value.approvalFingerprint, "AI knowledge selection approval fingerprint");
  assertLiteral(value.selectorVersionId, AI_GOVERNANCE_SELECTOR_VERSION_ID, "AI knowledge selector");
  assertLiteral(value.selectedAt, AI_GOVERNANCE_EVALUATED_AT, "AI knowledge selectedAt");
  assertLiteral(value.evaluatedAt, AI_GOVERNANCE_EVALUATED_AT, "AI knowledge selection evaluatedAt");
  assertLiteral(value.selectionScope, "retrospective_synthetic_fixture", "AI knowledge selection scope");
  assertLiteral(value.effectiveFrom, expectedDocument.effectiveFrom, "AI knowledge selection effectiveFrom");
  assertLiteral(value.effectiveUntil, expectedDocument.effectiveUntil, "AI knowledge selection effectiveUntil");
  assertLiteral(value.synthetic, true, "AI knowledge selection synthetic marker");
  if (expectedDocument.approvalState !== "approved") {
    fail("AI knowledge selection must be a strict subset of approved documents.");
  }
  const evaluated = canonicalMillis(value.evaluatedAt, "AI knowledge selection evaluatedAt");
  const from = canonicalMillis(value.effectiveFrom, "AI knowledge selection effectiveFrom");
  const until = canonicalMillis(value.effectiveUntil, "AI knowledge selection effectiveUntil");
  if (evaluated < from || evaluated > until) {
    fail("AI knowledge selection effective window must contain evaluatedAt.");
  }
}

export function assertStaffSafeAiKnowledgeSelectionV1(
  value: unknown,
): asserts value is StaffSafeAiKnowledgeSelectionV1 {
  assertExactKeys(value, KNOWLEDGE_SELECTION_KEYS, "AI knowledge selection");
  const binding = Object.fromEntries(
    KNOWLEDGE_SELECTION_BINDING_KEYS.map((key) => [key, value[key]]),
  );
  assertAiKnowledgeSelectionBindingV1(binding);
  assertFingerprint(value.selectionFingerprint, "AI knowledge selection fingerprint");
  assertLiteral(value.schemaVersion, 1, "AI knowledge selection schema version");
  const created = canonicalMillis(value.createdAt, "AI knowledge selection createdAt");
  if (created <= Date.parse(AI_GOVERNANCE_EVALUATED_AT)) {
    fail("AI knowledge selection server createdAt must be later than evaluatedAt.");
  }
}

export function assertAiEvaluationRequestBindingV1(
  value: unknown,
): asserts value is AiEvaluationRequestBindingV1 {
  assertExactKeys(value, EVALUATION_REQUEST_KEYS, "AI evaluation request binding");
  assertScenarioId(value.scenarioId, "AI evaluation request scenario ID");
  const expected = AI_PERSISTED_SCENARIO_MATRIX[value.scenarioId];
  assertLiteral(value.workspaceId, AI_GOVERNANCE_WORKSPACE_ID, "AI evaluation request workspace");
  assertLiteral(
    value.syntheticConversationRef,
    expected.syntheticConversationRef,
    "AI evaluation request conversation ref",
  );
  assertLiteral(value.language, expected.language, "AI evaluation request language");
  if (
    typeof value.languageConfidence !== "number" ||
    !Number.isFinite(value.languageConfidence) ||
    value.languageConfidence < 0 ||
    value.languageConfidence > 1
  ) {
    fail("AI evaluation request language confidence must be between zero and one.");
  }
  assertLiteral(
    value.languageConfidence,
    expected.languageConfidence,
    "AI evaluation request language confidence",
  );
  assertLiteral(value.intent, expected.intent, "AI evaluation request intent");
  assertLiteral(value.urgency, expected.urgency, "AI evaluation request urgency");
  assertLiteral(value.withinServiceWindow, true, "AI evaluation request service window");
  assertLiteral(
    value.observedConversationStatus,
    expected.observedConversationStatus,
    "AI evaluation request observed status",
  );
  assertLiteral(
    value.observedConversationMode,
    expected.observedConversationMode,
    "AI evaluation request observed mode",
  );
  assertLiteral(
    value.observedHandoffRequired,
    expected.handoffRequired,
    "AI evaluation request observed handoff requirement",
  );
  assertNullableSelectionBinding(
    value.knowledgeSelectionId,
    value.knowledgeSelectionFingerprint,
    value.scenarioId,
    "AI evaluation request",
  );
  assertLiteral(value.policyVersionId, AI_GOVERNANCE_POLICY_VERSION_ID, "AI evaluation policy");
  assertLiteral(
    value.reviewerVersionId,
    AI_GOVERNANCE_REVIEWER_VERSION_ID,
    "AI evaluation reviewer",
  );
  assertLiteral(value.evaluatedAt, AI_GOVERNANCE_EVALUATED_AT, "AI evaluation request evaluatedAt");
  canonicalMillis(value.evaluatedAt, "AI evaluation request evaluatedAt");
  assertLiteral(value.synthetic, true, "AI evaluation request synthetic marker");
}

function assertDecisionFields(
  value: Readonly<Record<string, unknown>>,
  scenarioId: AiPersistedScenarioId,
  label: string,
): void {
  const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
  assertLiteral(value.decision, expected.decision, `${label} decision`);
  if (
    !Array.isArray(value.reasonCodes) ||
    value.reasonCodes.length !== 1 ||
    value.reasonCodes[0] !== expected.reasonCodes[0]
  ) {
    fail(`${label} must retain its exact single ordered reason code.`);
  }
  for (const [key, expectedValue] of Object.entries({
    unsupportedClaim: expected.unsupportedClaim,
    clinicalSafety: expected.clinicalSafety,
    privacy: "pass",
    serviceWindow: expected.serviceWindow,
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
    retryCount: 0,
    eventCount: 1,
    modelCallCount: 0,
    providerCallCount: 0,
    externalDispatchCount: 0,
    conversationMutationCount: 0,
    handoffMutationCount: 0,
    suppressionMutationCount: 0,
    chainOfThoughtStored: false,
  })) {
    assertLiteral(value[key], expectedValue, `${label} ${key}`);
  }
}

export function assertStaffSafeAiRetrospectiveRunV1(
  value: unknown,
): asserts value is StaffSafeAiRetrospectiveRunV1 {
  assertExactKeys(value, RUN_KEYS, "AI retrospective run");
  assertScenarioId(value.scenarioId, "AI retrospective run scenario ID");
  const expected = AI_PERSISTED_SCENARIO_MATRIX[value.scenarioId];
  assertLiteral(value.id, expected.runId, "AI retrospective run ID");
  assertLiteral(value.workspaceId, AI_GOVERNANCE_WORKSPACE_ID, "AI retrospective run workspace");
  assertLiteral(value.evaluationScope, "retrospective_synthetic_fixture", "AI retrospective run scope");
  assertLiteral(value.durableScenarioScope, "partial_four_of_seven", "AI retrospective durable scope");
  assertFingerprint(value.requestFingerprint, "AI retrospective run request fingerprint");
  assertNullableSelectionBinding(
    value.knowledgeSelectionId,
    value.knowledgeSelectionFingerprint,
    value.scenarioId,
    "AI retrospective run",
  );
  assertLiteral(value.modelProvider, "none", "AI retrospective model provider");
  assertLiteral(value.modelId, null, "AI retrospective model ID");
  assertLiteral(value.promptVersionId, null, "AI retrospective prompt version ID");
  assertLiteral(value.policyVersionId, AI_GOVERNANCE_POLICY_VERSION_ID, "AI retrospective policy");
  assertLiteral(
    value.reviewerVersionId,
    AI_GOVERNANCE_REVIEWER_VERSION_ID,
    "AI retrospective reviewer",
  );
  assertLiteral(value.eventId, expected.eventId, "AI retrospective event ID");
  assertLiteral(value.auditEventId, expected.auditEventId, "AI retrospective audit event ID");
  assertLiteral(value.evaluatedAt, AI_GOVERNANCE_EVALUATED_AT, "AI retrospective evaluatedAt");
  const evaluated = canonicalMillis(value.evaluatedAt, "AI retrospective evaluatedAt");
  const recorded = canonicalMillis(value.recordedAt, "AI retrospective recordedAt");
  if (recorded <= evaluated) fail("AI retrospective server recordedAt must be later than evaluatedAt.");
  assertDecisionFields(value, value.scenarioId, "AI retrospective run");
  assertLiteral(value.synthetic, true, "AI retrospective run synthetic marker");
  assertLiteral(value.schemaVersion, 1, "AI retrospective run schema version");
}

export function assertStaffSafeAiRetrospectiveEventV1(
  value: unknown,
): asserts value is StaffSafeAiRetrospectiveEventV1 {
  assertExactKeys(value, EVENT_KEYS, "AI retrospective event");
  assertScenarioId(value.scenarioId, "AI retrospective event scenario ID");
  const expected = AI_PERSISTED_SCENARIO_MATRIX[value.scenarioId];
  assertLiteral(value.id, expected.eventId, "AI retrospective event ID");
  assertLiteral(value.workspaceId, AI_GOVERNANCE_WORKSPACE_ID, "AI retrospective event workspace");
  assertLiteral(value.runId, expected.runId, "AI retrospective event parent run ID");
  assertLiteral(value.eventType, "retrospective_evaluation_recorded", "AI retrospective event type");
  assertLiteral(value.sequence, 1, "AI retrospective event sequence");
  assertLiteral(value.previousEventId, null, "AI retrospective previous event ID");
  assertLiteral(value.retryOfEventId, null, "AI retrospective retry parent ID");
  assertFingerprint(value.requestFingerprint, "AI retrospective event request fingerprint");
  assertFingerprint(value.runFingerprint, "AI retrospective event parent run fingerprint");
  assertNullableSelectionBinding(
    value.knowledgeSelectionId,
    value.knowledgeSelectionFingerprint,
    value.scenarioId,
    "AI retrospective event",
  );
  assertLiteral(value.modelProvider, "none", "AI retrospective event model provider");
  assertLiteral(value.modelId, null, "AI retrospective event model ID");
  assertLiteral(value.promptVersionId, null, "AI retrospective event prompt version ID");
  assertLiteral(value.policyVersionId, AI_GOVERNANCE_POLICY_VERSION_ID, "AI retrospective event policy");
  assertLiteral(
    value.reviewerVersionId,
    AI_GOVERNANCE_REVIEWER_VERSION_ID,
    "AI retrospective event reviewer",
  );
  assertLiteral(value.auditEventId, expected.auditEventId, "AI retrospective event audit ID");
  assertLiteral(value.evaluatedAt, AI_GOVERNANCE_EVALUATED_AT, "AI retrospective event evaluatedAt");
  const evaluated = canonicalMillis(value.evaluatedAt, "AI retrospective event evaluatedAt");
  const created = canonicalMillis(value.createdAt, "AI retrospective event createdAt");
  if (created <= evaluated) fail("AI retrospective event server createdAt must be later than evaluatedAt.");
  assertDecisionFields(value, value.scenarioId, "AI retrospective event");
  assertLiteral(value.synthetic, true, "AI retrospective event synthetic marker");
  assertLiteral(value.schemaVersion, 1, "AI retrospective event schema version");
}

function assertStopSuppressionEvidenceV1(
  value: unknown,
): asserts value is AiStopSuppressionEvidenceV1 {
  assertExactKeys(value, STOP_EVIDENCE_KEYS, "AI STOP suppression evidence");
  for (const [key, expectedValue] of Object.entries({
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
    purpose: "health_campaigns",
    category: "marketing",
    channel: "whatsapp",
    suppressionMarketing: true,
    suppressionAll: false,
    suppressionReason: "stop_keyword",
    suppressionUpdatedAt: "2026-08-07T12:20:00.000Z",
    contactSuppressionEvidenceRef: "demo://ai/stop/contact-suppression-evidence-v1",
  })) {
    assertLiteral(value[key], expectedValue, `AI STOP suppression evidence ${key}`);
  }
  assertFingerprint(value.consentEvidenceFingerprint, "AI STOP consent evidence fingerprint");
  assertLiteral(
    value.consentEvidenceFingerprint,
    "8849f90377522b41a74b2d21958ca885c6f5d84222be607eb3fbd382d88b700f",
    "AI STOP consent evidence fingerprint",
  );
  assertFingerprint(
    value.contactSuppressionEvidenceFingerprint,
    "AI STOP contact-suppression evidence fingerprint",
  );
  assertLiteral(
    value.contactSuppressionEvidenceFingerprint,
    "039cc24be8127bf8e3e79a0d660f9bb14013268279945854535365019252adcd",
    "AI STOP contact-suppression evidence fingerprint",
  );
  if (
    canonicalMillis(value.suppressionUpdatedAt, "AI STOP suppression updatedAt") >=
    Date.parse(AI_GOVERNANCE_EVALUATED_AT)
  ) {
    fail("AI STOP suppression evidence must pre-exist evaluatedAt.");
  }
}

export function assertAiRetrospectiveRunSecretV1(
  value: unknown,
): asserts value is AiRetrospectiveRunSecretV1 {
  assertExactKeys(value, RUN_SECRET_KEYS, "AI retrospective run secret");
  assertScenarioId(value.scenarioId, "AI retrospective run secret scenario ID");
  const expected = AI_PERSISTED_SCENARIO_MATRIX[value.scenarioId];
  assertLiteral(value.id, expected.runSecretId, "AI retrospective run secret ID");
  assertLiteral(value.workspaceId, AI_GOVERNANCE_WORKSPACE_ID, "AI retrospective run secret workspace");
  assertLiteral(value.runId, expected.runId, "AI retrospective run secret parent run ID");
  assertFingerprint(value.requestFingerprint, "AI retrospective run secret request fingerprint");
  assertFingerprint(value.runFingerprint, "AI retrospective run secret run fingerprint");
  assertLiteral(value.sourceConnectionId, expected.sourceConnectionId, "AI retrospective source connection ID");
  assertLiteral(value.sourceConversationId, expected.syntheticConversationRef, "AI retrospective source conversation ID");
  assertLiteral(value.sourceContactId, expected.sourceContactId, "AI retrospective source contact ID");
  assertLiteral(value.sourceMessageId, expected.sourceMessageId, "AI retrospective source message ID");
  assertLiteral(value.sourceTeamId, expected.sourceTeamId, "AI retrospective source team ID");
  assertLiteral(value.sourceLocationId, expected.sourceLocationId, "AI retrospective source location ID");
  assertLiteral(value.sourcePurpose, expected.sourcePurpose, "AI retrospective source purpose");
  assertLiteral(
    value.protectedRequestFixtureRef,
    `demo://ai/requests/${value.scenarioId}-v1`,
    "AI retrospective protected request fixture ref",
  );
  assertFingerprint(
    value.protectedRequestFixtureFingerprint,
    "AI retrospective protected request fixture fingerprint",
  );
  assertLiteral(
    value.protectedRequestFixtureFingerprint,
    expected.sourceFixtureFingerprint,
    "AI retrospective allowlisted source fixture fingerprint",
  );
  if (value.scenarioId === "stop") {
    assertStopSuppressionEvidenceV1(value.stopSuppressionEvidence);
  } else if (value.stopSuppressionEvidence !== null) {
    fail("Only the STOP run secret may contain suppression evidence.");
  }
  assertLiteral(value.synthetic, true, "AI retrospective run secret synthetic marker");
  assertLiteral(value.schemaVersion, 1, "AI retrospective run secret schema version");
  const created = canonicalMillis(value.createdAt, "AI retrospective run secret createdAt");
  if (created <= Date.parse(AI_GOVERNANCE_EVALUATED_AT)) {
    fail("AI retrospective run secret server createdAt must be later than evaluatedAt.");
  }
}

export function assertAiRetrospectiveEventSecretV1(
  value: unknown,
): asserts value is AiRetrospectiveEventSecretV1 {
  assertExactKeys(value, EVENT_SECRET_KEYS, "AI retrospective event secret");
  assertScenarioId(value.scenarioId, "AI retrospective event secret scenario ID");
  const expected = AI_PERSISTED_SCENARIO_MATRIX[value.scenarioId];
  assertLiteral(value.id, expected.eventSecretId, "AI retrospective event secret ID");
  assertLiteral(value.workspaceId, AI_GOVERNANCE_WORKSPACE_ID, "AI retrospective event secret workspace");
  assertLiteral(value.eventId, expected.eventId, "AI retrospective event secret event ID");
  assertLiteral(value.runId, expected.runId, "AI retrospective event secret run ID");
  assertFingerprint(value.requestFingerprint, "AI retrospective event secret request fingerprint");
  assertFingerprint(value.runFingerprint, "AI retrospective event secret run fingerprint");
  assertFingerprint(value.eventFingerprint, "AI retrospective event secret event fingerprint");
  assertLiteral(
    value.protectedDecisionFixtureRef,
    `demo://ai/decisions/${value.scenarioId}-v1`,
    "AI retrospective protected decision fixture ref",
  );
  assertFingerprint(
    value.protectedDecisionFixtureFingerprint,
    "AI retrospective protected decision fixture fingerprint",
  );
  assertLiteral(
    value.protectedDecisionFixtureFingerprint,
    expected.decisionFixtureFingerprint,
    "AI retrospective allowlisted decision fixture fingerprint",
  );
  assertLiteral(value.synthetic, true, "AI retrospective event secret synthetic marker");
  assertLiteral(value.schemaVersion, 1, "AI retrospective event secret schema version");
  const created = canonicalMillis(value.createdAt, "AI retrospective event secret createdAt");
  if (created <= Date.parse(AI_GOVERNANCE_EVALUATED_AT)) {
    fail("AI retrospective event secret server createdAt must be later than evaluatedAt.");
  }
}

export type AiSourceFixtureIdentityTupleV1 = readonly [
  prefix: typeof AI_SOURCE_FIXTURE_IDENTITY_PREFIX,
  workspaceId: typeof AI_GOVERNANCE_WORKSPACE_ID,
  evaluationScope: "retrospective_synthetic_fixture",
  connectionId: "connection_demo_simulator",
  conversationId: string,
  contactId: string,
  inboundMessageId: string,
  teamId: string,
  locationId: string,
  purpose: AiObservedConversationPurpose,
  observedConversationStatus: AiObservedConversationStatus,
  observedConversationMode: AiObservedConversationMode,
  observedHandoffRequired: boolean,
  synthetic: true,
];

export type AiDecisionFixtureIdentityTupleV1 = readonly [
  prefix: typeof AI_DECISION_FIXTURE_IDENTITY_PREFIX,
  workspaceId: typeof AI_GOVERNANCE_WORKSPACE_ID,
  scenarioId: AiPersistedScenarioId,
  decision: AiReviewDecision,
  reasonCodes: readonly [AiReviewReason],
  outcome: AiRetrospectiveOutcome,
  evaluatedAt: typeof AI_GOVERNANCE_EVALUATED_AT,
  synthetic: true,
];

export type AiKnowledgeContentTupleV1 = readonly [
  prefix: typeof AI_KNOWLEDGE_CONTENT_PREFIX,
  workspaceId: typeof AI_GOVERNANCE_WORKSPACE_ID,
  documentId: AiKnowledgeDocumentId,
  title: string,
  version: string,
  language: AiKnowledgeLanguage,
  contentKind: AiKnowledgeContentKind,
  ownerUid: string,
  protectedContentFingerprint: string,
  synthetic: true,
];

export type AiKnowledgeApprovalTupleV1 = readonly [
  prefix: typeof AI_KNOWLEDGE_APPROVAL_PREFIX,
  workspaceId: typeof AI_GOVERNANCE_WORKSPACE_ID,
  documentId: AiKnowledgeDocumentId,
  contentFingerprint: string,
  ownerUid: string,
  approverUid: string | null,
  approvalState: AiKnowledgeApprovalState,
  approvalScope: AiKnowledgeApprovalScope | null,
  approvedAt: string | null,
  evaluatedAt: typeof AI_GOVERNANCE_EVALUATED_AT,
  effectiveFrom: string | null,
  effectiveUntil: string | null,
  synthetic: true,
];

export type AiKnowledgeSelectionTupleV1 = readonly [
  prefix: typeof AI_KNOWLEDGE_SELECTION_PREFIX,
  selectionId: AiKnowledgeSelectionId,
  workspaceId: typeof AI_GOVERNANCE_WORKSPACE_ID,
  documentId: AiKnowledgeDocumentId,
  contentFingerprint: string,
  approvalFingerprint: string,
  selectorVersionId: typeof AI_GOVERNANCE_SELECTOR_VERSION_ID,
  selectedAt: typeof AI_GOVERNANCE_EVALUATED_AT,
  evaluatedAt: typeof AI_GOVERNANCE_EVALUATED_AT,
  selectionScope: "retrospective_synthetic_fixture",
  effectiveFrom: string,
  effectiveUntil: string,
  synthetic: true,
];

export type AiEvaluationRequestTupleV1 = readonly [
  prefix: typeof AI_EVALUATION_REQUEST_PREFIX,
  workspaceId: typeof AI_GOVERNANCE_WORKSPACE_ID,
  scenarioId: AiPersistedScenarioId,
  syntheticConversationRef: string,
  language: AiReviewLanguage,
  languageConfidence: number,
  intent: AiReviewIntent,
  urgency: AiUrgency,
  withinServiceWindow: true,
  observedConversationStatus: AiObservedConversationStatus,
  observedConversationMode: AiObservedConversationMode,
  observedHandoffRequired: boolean,
  knowledgeSelectionId: AiKnowledgeSelectionId | null,
  knowledgeSelectionFingerprint: string | null,
  policyVersionId: typeof AI_GOVERNANCE_POLICY_VERSION_ID,
  reviewerVersionId: typeof AI_GOVERNANCE_REVIEWER_VERSION_ID,
  evaluatedAt: typeof AI_GOVERNANCE_EVALUATED_AT,
  synthetic: true,
];

export type AiRetrospectiveDecisionTupleV1 = readonly [
  decision: AiReviewDecision,
  reasonCodes: readonly [AiReviewReason],
  unsupportedClaim: false,
  clinicalSafety: AiClinicalSafety,
  privacy: "pass",
  serviceWindow: "in_window",
  requiredCorrectionCode: AiRequiredCorrectionCode | null,
  marketingSuppressionRequired: boolean,
  sendMode: AiSendMode,
  outcome: AiRetrospectiveOutcome,
  observedConversationStatus: AiObservedConversationStatus,
  observedConversationMode: AiObservedConversationMode,
  handoffRequired: boolean,
  urgentSafetyHoldObserved: boolean,
  contactMarketingSuppressionObserved: boolean,
  ordinaryAutomationPaused: boolean,
  retryCount: 0,
  eventCount: 1,
  modelCallCount: 0,
  providerCallCount: 0,
  externalDispatchCount: 0,
  conversationMutationCount: 0,
  handoffMutationCount: 0,
  suppressionMutationCount: 0,
  chainOfThoughtStored: false,
];

export type AiRetrospectiveRunTupleV1 = readonly [
  prefix: typeof AI_RETROSPECTIVE_RUN_PREFIX,
  id: AiRetrospectiveRunId,
  workspaceId: typeof AI_GOVERNANCE_WORKSPACE_ID,
  scenarioId: AiPersistedScenarioId,
  evaluationScope: "retrospective_synthetic_fixture",
  durableScenarioScope: "partial_four_of_seven",
  requestFingerprint: string,
  knowledgeSelectionId: AiKnowledgeSelectionId | null,
  knowledgeSelectionFingerprint: string | null,
  modelProvider: "none",
  modelId: null,
  promptVersionId: null,
  policyVersionId: typeof AI_GOVERNANCE_POLICY_VERSION_ID,
  reviewerVersionId: typeof AI_GOVERNANCE_REVIEWER_VERSION_ID,
  eventId: AiRetrospectiveEventId,
  auditEventId: AiRetrospectiveAuditEventId,
  evaluatedAt: typeof AI_GOVERNANCE_EVALUATED_AT,
  recordedAt: string,
  decision: AiRetrospectiveDecisionTupleV1,
  synthetic: true,
  schemaVersion: 1,
];

export type AiRetrospectiveEventTupleV1 = readonly [
  prefix: typeof AI_RETROSPECTIVE_EVENT_PREFIX,
  id: AiRetrospectiveEventId,
  workspaceId: typeof AI_GOVERNANCE_WORKSPACE_ID,
  runId: AiRetrospectiveRunId,
  scenarioId: AiPersistedScenarioId,
  eventType: "retrospective_evaluation_recorded",
  sequence: 1,
  previousEventId: null,
  retryOfEventId: null,
  requestFingerprint: string,
  runFingerprint: string,
  knowledgeSelectionId: AiKnowledgeSelectionId | null,
  knowledgeSelectionFingerprint: string | null,
  modelProvider: "none",
  modelId: null,
  promptVersionId: null,
  policyVersionId: typeof AI_GOVERNANCE_POLICY_VERSION_ID,
  reviewerVersionId: typeof AI_GOVERNANCE_REVIEWER_VERSION_ID,
  auditEventId: AiRetrospectiveAuditEventId,
  evaluatedAt: typeof AI_GOVERNANCE_EVALUATED_AT,
  createdAt: string,
  decision: AiRetrospectiveDecisionTupleV1,
  synthetic: true,
  schemaVersion: 1,
];

export type AiStopSuppressionEvidenceTupleV1 = readonly [
  contactId: AiStopSuppressionEvidenceV1["contactId"],
  grantedConsentRecordId: AiStopSuppressionEvidenceV1["grantedConsentRecordId"],
  grantedConsentStatus: "granted",
  grantedConsentCapturedAt: AiStopSuppressionEvidenceV1["grantedConsentCapturedAt"],
  grantedConsentEvidenceRef: AiStopSuppressionEvidenceV1["grantedConsentEvidenceRef"],
  withdrawnConsentRecordId: AiStopSuppressionEvidenceV1["withdrawnConsentRecordId"],
  withdrawnConsentStatus: "withdrawn",
  withdrawnSupersedesRecordId: AiStopSuppressionEvidenceV1["withdrawnSupersedesRecordId"],
  withdrawnConsentCapturedAt: AiStopSuppressionEvidenceV1["withdrawnConsentCapturedAt"],
  withdrawnAt: AiStopSuppressionEvidenceV1["withdrawnAt"],
  withdrawnConsentEvidenceRef: AiStopSuppressionEvidenceV1["withdrawnConsentEvidenceRef"],
  purpose: "health_campaigns",
  category: "marketing",
  channel: "whatsapp",
  suppressionMarketing: true,
  suppressionAll: false,
  suppressionReason: "stop_keyword",
  suppressionUpdatedAt: AiStopSuppressionEvidenceV1["suppressionUpdatedAt"],
  consentEvidenceFingerprint: string,
  contactSuppressionEvidenceRef: AiStopSuppressionEvidenceV1["contactSuppressionEvidenceRef"],
  contactSuppressionEvidenceFingerprint: string,
];

export type AiRetrospectiveRunSecretTupleV1 = readonly [
  prefix: typeof AI_RETROSPECTIVE_RUN_SECRET_PREFIX,
  id: AiRetrospectiveRunSecretId,
  workspaceId: typeof AI_GOVERNANCE_WORKSPACE_ID,
  runId: AiRetrospectiveRunId,
  scenarioId: AiPersistedScenarioId,
  requestFingerprint: string,
  runFingerprint: string,
  sourceConnectionId: "connection_demo_simulator",
  sourceConversationId: string,
  sourceContactId: string,
  sourceMessageId: string,
  sourceTeamId: string,
  sourceLocationId: string,
  sourcePurpose: AiObservedConversationPurpose,
  protectedRequestFixtureRef: string,
  protectedRequestFixtureFingerprint: string,
  stopSuppressionEvidence: AiStopSuppressionEvidenceTupleV1 | null,
  synthetic: true,
  schemaVersion: 1,
  createdAt: string,
];

export type AiRetrospectiveEventSecretTupleV1 = readonly [
  prefix: typeof AI_RETROSPECTIVE_EVENT_SECRET_PREFIX,
  id: AiRetrospectiveEventSecretId,
  workspaceId: typeof AI_GOVERNANCE_WORKSPACE_ID,
  eventId: AiRetrospectiveEventId,
  runId: AiRetrospectiveRunId,
  scenarioId: AiPersistedScenarioId,
  requestFingerprint: string,
  runFingerprint: string,
  eventFingerprint: string,
  protectedDecisionFixtureRef: string,
  protectedDecisionFixtureFingerprint: string,
  synthetic: true,
  schemaVersion: 1,
  createdAt: string,
];

function decisionTuple(input: AiRetrospectiveDecisionFieldsV1): AiRetrospectiveDecisionTupleV1 {
  return [
    input.decision,
    input.reasonCodes,
    input.unsupportedClaim,
    input.clinicalSafety,
    input.privacy,
    input.serviceWindow,
    input.requiredCorrectionCode,
    input.marketingSuppressionRequired,
    input.sendMode,
    input.outcome,
    input.observedConversationStatus,
    input.observedConversationMode,
    input.handoffRequired,
    input.urgentSafetyHoldObserved,
    input.contactMarketingSuppressionObserved,
    input.ordinaryAutomationPaused,
    input.retryCount,
    input.eventCount,
    input.modelCallCount,
    input.providerCallCount,
    input.externalDispatchCount,
    input.conversationMutationCount,
    input.handoffMutationCount,
    input.suppressionMutationCount,
    input.chainOfThoughtStored,
  ];
}

export function serializeAiSourceFixtureIdentityV1(
  scenarioId: AiPersistedScenarioId,
): string {
  assertScenarioId(scenarioId, "AI source fixture scenario ID");
  const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
  const tuple: AiSourceFixtureIdentityTupleV1 = [
    AI_SOURCE_FIXTURE_IDENTITY_PREFIX,
    AI_GOVERNANCE_WORKSPACE_ID,
    "retrospective_synthetic_fixture",
    expected.sourceConnectionId,
    expected.syntheticConversationRef,
    expected.sourceContactId,
    expected.sourceMessageId,
    expected.sourceTeamId,
    expected.sourceLocationId,
    expected.sourcePurpose,
    expected.observedConversationStatus,
    expected.observedConversationMode,
    expected.handoffRequired,
    true,
  ];
  return JSON.stringify(tuple);
}

export function serializeAiDecisionFixtureIdentityV1(
  scenarioId: AiPersistedScenarioId,
): string {
  assertScenarioId(scenarioId, "AI decision fixture scenario ID");
  const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
  const tuple: AiDecisionFixtureIdentityTupleV1 = [
    AI_DECISION_FIXTURE_IDENTITY_PREFIX,
    AI_GOVERNANCE_WORKSPACE_ID,
    scenarioId,
    expected.decision,
    expected.reasonCodes,
    expected.outcome,
    AI_GOVERNANCE_EVALUATED_AT,
    true,
  ];
  return JSON.stringify(tuple);
}

export function assertAiScenarioFixtureFingerprintDerivationV1(
  scenarioId: AiPersistedScenarioId,
  sha256: (canonicalValue: string) => string,
): void {
  assertScenarioId(scenarioId, "AI fixture derivation scenario ID");
  const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
  const sourceFingerprint = sha256(serializeAiSourceFixtureIdentityV1(scenarioId));
  const decisionFingerprint = sha256(serializeAiDecisionFixtureIdentityV1(scenarioId));
  assertCalculatedFingerprint(sourceFingerprint, "Calculated AI source fixture fingerprint");
  assertCalculatedFingerprint(decisionFingerprint, "Calculated AI decision fixture fingerprint");
  if (
    sourceFingerprint !== expected.sourceFixtureFingerprint ||
    decisionFingerprint !== expected.decisionFixtureFingerprint
  ) {
    fail("AI scenario fixture fingerprints do not match their canonical identities.");
  }
}

function stopEvidenceTuple(
  input: AiStopSuppressionEvidenceV1,
): AiStopSuppressionEvidenceTupleV1 {
  return [
    input.contactId,
    input.grantedConsentRecordId,
    input.grantedConsentStatus,
    input.grantedConsentCapturedAt,
    input.grantedConsentEvidenceRef,
    input.withdrawnConsentRecordId,
    input.withdrawnConsentStatus,
    input.withdrawnSupersedesRecordId,
    input.withdrawnConsentCapturedAt,
    input.withdrawnAt,
    input.withdrawnConsentEvidenceRef,
    input.purpose,
    input.category,
    input.channel,
    input.suppressionMarketing,
    input.suppressionAll,
    input.suppressionReason,
    input.suppressionUpdatedAt,
    input.consentEvidenceFingerprint,
    input.contactSuppressionEvidenceRef,
    input.contactSuppressionEvidenceFingerprint,
  ];
}

export function serializeAiKnowledgeContentV1(input: AiKnowledgeContentBindingV1): string {
  assertAiKnowledgeContentBindingV1(input);
  const tuple: AiKnowledgeContentTupleV1 = [
    AI_KNOWLEDGE_CONTENT_PREFIX,
    input.workspaceId,
    input.documentId,
    input.title,
    input.version,
    input.language,
    input.contentKind,
    input.ownerUid,
    input.protectedContentFingerprint,
    input.synthetic,
  ];
  return JSON.stringify(tuple);
}

export function serializeAiKnowledgeApprovalV1(input: AiKnowledgeApprovalBindingV1): string {
  assertAiKnowledgeApprovalBindingV1(input);
  const tuple: AiKnowledgeApprovalTupleV1 = [
    AI_KNOWLEDGE_APPROVAL_PREFIX,
    input.workspaceId,
    input.documentId,
    input.contentFingerprint,
    input.ownerUid,
    input.approverUid,
    input.approvalState,
    input.approvalScope,
    input.approvedAt,
    input.evaluatedAt,
    input.effectiveFrom,
    input.effectiveUntil,
    input.synthetic,
  ];
  return JSON.stringify(tuple);
}

export function serializeAiKnowledgeSelectionV1(input: AiKnowledgeSelectionBindingV1): string {
  assertAiKnowledgeSelectionBindingV1(input);
  const tuple: AiKnowledgeSelectionTupleV1 = [
    AI_KNOWLEDGE_SELECTION_PREFIX,
    input.selectionId,
    input.workspaceId,
    input.documentId,
    input.contentFingerprint,
    input.approvalFingerprint,
    input.selectorVersionId,
    input.selectedAt,
    input.evaluatedAt,
    input.selectionScope,
    input.effectiveFrom,
    input.effectiveUntil,
    input.synthetic,
  ];
  return JSON.stringify(tuple);
}

export function serializeAiEvaluationRequestV1(input: AiEvaluationRequestBindingV1): string {
  assertAiEvaluationRequestBindingV1(input);
  const tuple: AiEvaluationRequestTupleV1 = [
    AI_EVALUATION_REQUEST_PREFIX,
    input.workspaceId,
    input.scenarioId,
    input.syntheticConversationRef,
    input.language,
    input.languageConfidence,
    input.intent,
    input.urgency,
    input.withinServiceWindow,
    input.observedConversationStatus,
    input.observedConversationMode,
    input.observedHandoffRequired,
    input.knowledgeSelectionId,
    input.knowledgeSelectionFingerprint,
    input.policyVersionId,
    input.reviewerVersionId,
    input.evaluatedAt,
    input.synthetic,
  ];
  return JSON.stringify(tuple);
}

export function serializeAiRetrospectiveRunV1(input: StaffSafeAiRetrospectiveRunV1): string {
  assertStaffSafeAiRetrospectiveRunV1(input);
  const tuple: AiRetrospectiveRunTupleV1 = [
    AI_RETROSPECTIVE_RUN_PREFIX,
    input.id,
    input.workspaceId,
    input.scenarioId,
    input.evaluationScope,
    input.durableScenarioScope,
    input.requestFingerprint,
    input.knowledgeSelectionId,
    input.knowledgeSelectionFingerprint,
    input.modelProvider,
    input.modelId,
    input.promptVersionId,
    input.policyVersionId,
    input.reviewerVersionId,
    input.eventId,
    input.auditEventId,
    input.evaluatedAt,
    input.recordedAt,
    decisionTuple(input),
    input.synthetic,
    input.schemaVersion,
  ];
  return JSON.stringify(tuple);
}

export function serializeAiRetrospectiveEventV1(
  input: StaffSafeAiRetrospectiveEventV1,
): string {
  assertStaffSafeAiRetrospectiveEventV1(input);
  const tuple: AiRetrospectiveEventTupleV1 = [
    AI_RETROSPECTIVE_EVENT_PREFIX,
    input.id,
    input.workspaceId,
    input.runId,
    input.scenarioId,
    input.eventType,
    input.sequence,
    input.previousEventId,
    input.retryOfEventId,
    input.requestFingerprint,
    input.runFingerprint,
    input.knowledgeSelectionId,
    input.knowledgeSelectionFingerprint,
    input.modelProvider,
    input.modelId,
    input.promptVersionId,
    input.policyVersionId,
    input.reviewerVersionId,
    input.auditEventId,
    input.evaluatedAt,
    input.createdAt,
    decisionTuple(input),
    input.synthetic,
    input.schemaVersion,
  ];
  return JSON.stringify(tuple);
}

export function serializeAiRetrospectiveRunSecretV1(
  input: AiRetrospectiveRunSecretV1,
): string {
  assertAiRetrospectiveRunSecretV1(input);
  const tuple: AiRetrospectiveRunSecretTupleV1 = [
    AI_RETROSPECTIVE_RUN_SECRET_PREFIX,
    input.id,
    input.workspaceId,
    input.runId,
    input.scenarioId,
    input.requestFingerprint,
    input.runFingerprint,
    input.sourceConnectionId,
    input.sourceConversationId,
    input.sourceContactId,
    input.sourceMessageId,
    input.sourceTeamId,
    input.sourceLocationId,
    input.sourcePurpose,
    input.protectedRequestFixtureRef,
    input.protectedRequestFixtureFingerprint,
    input.stopSuppressionEvidence === null
      ? null
      : stopEvidenceTuple(input.stopSuppressionEvidence),
    input.synthetic,
    input.schemaVersion,
    input.createdAt,
  ];
  return JSON.stringify(tuple);
}

export function serializeAiRetrospectiveEventSecretV1(
  input: AiRetrospectiveEventSecretV1,
): string {
  assertAiRetrospectiveEventSecretV1(input);
  const tuple: AiRetrospectiveEventSecretTupleV1 = [
    AI_RETROSPECTIVE_EVENT_SECRET_PREFIX,
    input.id,
    input.workspaceId,
    input.eventId,
    input.runId,
    input.scenarioId,
    input.requestFingerprint,
    input.runFingerprint,
    input.eventFingerprint,
    input.protectedDecisionFixtureRef,
    input.protectedDecisionFixtureFingerprint,
    input.synthetic,
    input.schemaVersion,
    input.createdAt,
  ];
  return JSON.stringify(tuple);
}

function assertCalculatedFingerprint(
  value: string,
  label: string,
): void {
  assertFingerprint(value, label);
}

function selectionBindingFromDocument(
  selection: StaffSafeAiKnowledgeSelectionV1,
): AiKnowledgeSelectionBindingV1 {
  return {
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
}

export function assertAiKnowledgeDocumentCrossBindingV1(
  document: StaffSafeAiKnowledgeDocumentV1,
  content: AiKnowledgeContentBindingV1,
  approval: AiKnowledgeApprovalBindingV1,
  secret: AiKnowledgeDocumentSecretV1,
  sha256: (canonicalValue: string) => string,
): void {
  assertStaffSafeAiKnowledgeDocumentV1(document);
  assertAiKnowledgeContentBindingV1(content);
  assertAiKnowledgeApprovalBindingV1(approval);
  assertAiKnowledgeDocumentSecretV1(secret);

  const contentFingerprint = sha256(serializeAiKnowledgeContentV1(content));
  const approvalFingerprint = sha256(serializeAiKnowledgeApprovalV1(approval));
  assertCalculatedFingerprint(contentFingerprint, "Calculated AI knowledge content fingerprint");
  assertCalculatedFingerprint(approvalFingerprint, "Calculated AI knowledge approval fingerprint");

  if (
    document.id !== content.documentId ||
    document.id !== approval.documentId ||
    document.id !== secret.documentId ||
    document.workspaceId !== content.workspaceId ||
    document.workspaceId !== approval.workspaceId ||
    document.workspaceId !== secret.workspaceId ||
    document.title !== content.title ||
    document.version !== content.version ||
    document.language !== content.language ||
    document.contentKind !== content.contentKind ||
    document.ownerUid !== content.ownerUid ||
    document.ownerUid !== approval.ownerUid ||
    document.approverUid !== approval.approverUid ||
    document.approvalState !== approval.approvalState ||
    document.approvalScope !== approval.approvalScope ||
    document.approvedAt !== approval.approvedAt ||
    document.evaluatedAt !== approval.evaluatedAt ||
    document.effectiveFrom !== approval.effectiveFrom ||
    document.effectiveUntil !== approval.effectiveUntil ||
    document.contentFingerprint !== contentFingerprint ||
    approval.contentFingerprint !== contentFingerprint ||
    document.approvalFingerprint !== approvalFingerprint ||
    secret.contentFingerprint !== contentFingerprint ||
    secret.approvalFingerprint !== approvalFingerprint ||
    secret.protectedContentFingerprint !== content.protectedContentFingerprint
  ) {
    fail("AI knowledge content, approval, public document and secret are not cross-bound.");
  }
}

export function assertAiKnowledgeSelectionCrossBindingV1(
  selection: StaffSafeAiKnowledgeSelectionV1,
  document: StaffSafeAiKnowledgeDocumentV1,
  sha256: (canonicalValue: string) => string,
): void {
  assertStaffSafeAiKnowledgeSelectionV1(selection);
  assertStaffSafeAiKnowledgeDocumentV1(document);
  const calculated = sha256(
    serializeAiKnowledgeSelectionV1(selectionBindingFromDocument(selection)),
  );
  assertCalculatedFingerprint(calculated, "Calculated AI knowledge selection fingerprint");
  if (
    selection.selectionFingerprint !== calculated ||
    selection.workspaceId !== document.workspaceId ||
    selection.documentId !== document.id ||
    selection.contentFingerprint !== document.contentFingerprint ||
    selection.approvalFingerprint !== document.approvalFingerprint ||
    selection.effectiveFrom !== document.effectiveFrom ||
    selection.effectiveUntil !== document.effectiveUntil ||
    selection.evaluatedAt !== document.evaluatedAt ||
    document.approvalState !== "approved" ||
    document.approvalScope !== "synthetic_information_only"
  ) {
    fail("AI knowledge selection is not bound to the exact approved document window.");
  }
}

export function assertAiRetrospectiveRequestRunCrossBindingV1(
  request: AiEvaluationRequestBindingV1,
  run: StaffSafeAiRetrospectiveRunV1,
  runSecret: AiRetrospectiveRunSecretV1,
  knowledgeSelection: StaffSafeAiKnowledgeSelectionV1 | null,
  sha256: (canonicalValue: string) => string,
): void {
  assertAiEvaluationRequestBindingV1(request);
  assertStaffSafeAiRetrospectiveRunV1(run);
  assertAiRetrospectiveRunSecretV1(runSecret);
  assertAiScenarioFixtureFingerprintDerivationV1(run.scenarioId, sha256);
  if (knowledgeSelection !== null) assertStaffSafeAiKnowledgeSelectionV1(knowledgeSelection);

  const requestFingerprint = sha256(serializeAiEvaluationRequestV1(request));
  const runFingerprint = sha256(serializeAiRetrospectiveRunV1(run));
  assertCalculatedFingerprint(requestFingerprint, "Calculated AI request fingerprint");
  assertCalculatedFingerprint(runFingerprint, "Calculated AI run fingerprint");
  const expectedSelectionId = AI_PERSISTED_SCENARIO_MATRIX[run.scenarioId].knowledgeSelectionId;

  if (
    request.workspaceId !== run.workspaceId ||
    request.scenarioId !== run.scenarioId ||
    request.observedConversationStatus !== run.observedConversationStatus ||
    request.observedConversationMode !== run.observedConversationMode ||
    request.observedHandoffRequired !== run.handoffRequired ||
    request.knowledgeSelectionId !== run.knowledgeSelectionId ||
    request.knowledgeSelectionFingerprint !== run.knowledgeSelectionFingerprint ||
    request.policyVersionId !== run.policyVersionId ||
    request.reviewerVersionId !== run.reviewerVersionId ||
    request.evaluatedAt !== run.evaluatedAt ||
    run.requestFingerprint !== requestFingerprint ||
    runSecret.workspaceId !== run.workspaceId ||
    runSecret.runId !== run.id ||
    runSecret.scenarioId !== run.scenarioId ||
    runSecret.requestFingerprint !== requestFingerprint ||
    runSecret.runFingerprint !== runFingerprint ||
    runSecret.createdAt !== run.recordedAt
  ) {
    fail("AI evaluation request, public retrospective run and run secret are not cross-bound.");
  }

  if (expectedSelectionId === null) {
    if (knowledgeSelection !== null) {
      fail("Mixed-language and STOP retrospective runs must have null knowledge bindings.");
    }
  } else if (
    knowledgeSelection === null ||
    knowledgeSelection.selectionId !== expectedSelectionId ||
    knowledgeSelection.selectionFingerprint !== run.knowledgeSelectionFingerprint
  ) {
    fail("AI retrospective run is not bound to its exact approved knowledge selection.");
  }
}

export function assertAiRetrospectiveEventCrossBindingV1(
  run: StaffSafeAiRetrospectiveRunV1,
  event: StaffSafeAiRetrospectiveEventV1,
  eventSecret: AiRetrospectiveEventSecretV1,
  sha256: (canonicalValue: string) => string,
): void {
  assertStaffSafeAiRetrospectiveRunV1(run);
  assertStaffSafeAiRetrospectiveEventV1(event);
  assertAiRetrospectiveEventSecretV1(eventSecret);
  assertAiScenarioFixtureFingerprintDerivationV1(run.scenarioId, sha256);
  const runFingerprint = sha256(serializeAiRetrospectiveRunV1(run));
  const eventFingerprint = sha256(serializeAiRetrospectiveEventV1(event));
  assertCalculatedFingerprint(runFingerprint, "Calculated AI run fingerprint");
  assertCalculatedFingerprint(eventFingerprint, "Calculated AI event fingerprint");

  for (const key of DECISION_KEYS) {
    const runValue = run[key as keyof StaffSafeAiRetrospectiveRunV1];
    const eventValue = event[key as keyof StaffSafeAiRetrospectiveEventV1];
    if (JSON.stringify(runValue) !== JSON.stringify(eventValue)) {
      fail(`AI retrospective event does not preserve parent decision field ${key}.`);
    }
  }
  if (
    event.workspaceId !== run.workspaceId ||
    event.runId !== run.id ||
    event.id !== run.eventId ||
    event.scenarioId !== run.scenarioId ||
    event.requestFingerprint !== run.requestFingerprint ||
    event.runFingerprint !== runFingerprint ||
    event.knowledgeSelectionId !== run.knowledgeSelectionId ||
    event.knowledgeSelectionFingerprint !== run.knowledgeSelectionFingerprint ||
    event.modelProvider !== run.modelProvider ||
    event.modelId !== run.modelId ||
    event.promptVersionId !== run.promptVersionId ||
    event.policyVersionId !== run.policyVersionId ||
    event.reviewerVersionId !== run.reviewerVersionId ||
    event.auditEventId !== run.auditEventId ||
    event.evaluatedAt !== run.evaluatedAt ||
    event.createdAt !== run.recordedAt ||
    eventSecret.workspaceId !== event.workspaceId ||
    eventSecret.eventId !== event.id ||
    eventSecret.runId !== run.id ||
    eventSecret.scenarioId !== run.scenarioId ||
    eventSecret.requestFingerprint !== run.requestFingerprint ||
    eventSecret.runFingerprint !== runFingerprint ||
    eventSecret.eventFingerprint !== eventFingerprint ||
    eventSecret.createdAt !== event.createdAt
  ) {
    fail("AI retrospective run, one-shot event and event secret are not cross-bound.");
  }
}

export interface AiGovernancePersistenceCountSnapshotV1 {
  readonly materializedScenarioCount: number;
  readonly knowledgeDocuments: number;
  readonly knowledgeSelections: number;
  readonly knowledgeSecrets: number;
  readonly retrospectiveRuns: number;
  readonly retrospectiveEvents: number;
  readonly retrospectiveRunSecrets: number;
  readonly retrospectiveEventSecrets: number;
  readonly idempotencyReceipts: number;
  readonly auditEvents: number;
  readonly totalDocuments: number;
}

export function assertAiGovernancePersistenceCountModel(
  input: AiGovernancePersistenceCountSnapshotV1,
): void {
  const keys = [
    "materializedScenarioCount",
    "knowledgeDocuments",
    "knowledgeSelections",
    "knowledgeSecrets",
    "retrospectiveRuns",
    "retrospectiveEvents",
    "retrospectiveRunSecrets",
    "retrospectiveEventSecrets",
    "idempotencyReceipts",
    "auditEvents",
    "totalDocuments",
  ] as const;
  assertExactKeys(
    input,
    keys,
    "AI governance persistence count model",
  );
  const materialized = input.materializedScenarioCount;
  if (!Number.isInteger(materialized) || materialized < 0 || materialized > 4) {
    fail("AI governance materialized-scenario count must be an integer from zero to four.");
  }
  const baseline = AI_GOVERNANCE_EXPECTED_PERSISTENCE_COUNTS.initialGovernanceSeed;
  for (const key of [
    "knowledgeDocuments",
    "knowledgeSelections",
    "knowledgeSecrets",
  ] as const) {
    if (!Number.isInteger(input[key]) || input[key] !== baseline[key]) {
      fail(`AI governance ${key} count must remain at its 13-document seed baseline.`);
    }
  }
  for (const key of [
    "retrospectiveRuns",
    "retrospectiveEvents",
    "retrospectiveRunSecrets",
    "retrospectiveEventSecrets",
    "idempotencyReceipts",
    "auditEvents",
  ] as const) {
    if (!Number.isInteger(input[key]) || input[key] !== materialized) {
      fail(`AI governance ${key} count must equal the materialized-scenario count.`);
    }
  }
  const expectedTotal =
    baseline.totalDocuments +
    materialized *
      AI_GOVERNANCE_EXPECTED_PERSISTENCE_COUNTS.perMaterializedScenario.totalDocuments;
  if (!Number.isInteger(input.totalDocuments) || input.totalDocuments !== expectedTotal) {
    fail(`AI governance phase total must equal ${expectedTotal} documents.`);
  }
}
