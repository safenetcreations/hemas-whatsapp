import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteField,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
  type AiKnowledgeDocumentId,
  type AiKnowledgeSelectionId,
  type AiPersistedScenarioId,
} from "@/lib/domain/ai-governance";
import {
  hasVerifiedProviderApproval,
  getCampaign,
  getCampaignEvent,
  getTemplateCatalogueItem,
  listAppointmentEvents,
  listAudienceSnapshots,
  listCampaignCheckpoints,
  listCampaignEvents,
  listCampaigns,
  listConsentRecordsForContact,
  listConversationMessageMetadata,
  listLabReportEvents,
  listFlowCatalogue,
  listScopedAppointments,
  listScopedContacts,
  listScopedConversations,
  listScopedLabReports,
  listSyntheticInternalNotes,
  listWorkspaceLocations,
  listWorkspaceTeams,
  listTemplateCatalogue,
  serializeTemplateContentBinding,
  updateSyntheticContactPreferences,
} from "@/lib/firebase/repositories";

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "demo-hemas-connect";
const WORKSPACE_A = "workspace-a";
const WORKSPACE_B = "workspace-b";
const WORKSPACE_UAT = "workspace-uat";
const WORKSPACE_LOCKED = "workspace-locked";
const CONNECTION_WORKSPACE = "workspace_safenet_demo";
const DEMO_CONNECTION_ID = "connection_demo_simulator";
const DEMO_HIS_INTEGRATION_ID = "integration_demo_his_simulator";
const DEMO_LIMS_INTEGRATION_ID = "integration_demo_lims_simulator";
const AI_WORKSPACE = AI_GOVERNANCE_WORKSPACE_ID;

const backendOnlyCanaryCollections = [
  "canary_inbound_events",
  "canary_outbound_events",
  "canary_opt_out_events",
  "canary_webhook_outbox",
  "canary_inbound_return_routes",
  "canary_public_quota_counters",
  "canary_public_bot_sessions",
  "canary_public_suppressions",
  "canary_outbox_reconciliations",
  "canary_agent_replies",
  "canary_reply_operations",
  "canary_reply_reconciliations",
  "canary_booking_operations",
  "canary_booking_reconciliations",
  "canary_campaign_recipient_operations",
  "canary_campaign_reconciliations",
  "canary_provider_message_routes",
  "protectedMessageAccessQuotas",
] as const;

const backendOnlyEnterpriseCollections = [
  "enterprise_bulk_item_secrets",
  "enterprise_bulk_send_receipts",
  "enterprise_callback_secrets",
  "enterprise_callback_deliveries",
] as const;

let testEnvironment: RulesTestEnvironment;

const now = () => Timestamp.fromMillis(1_800_000_000_000);
const aiEvaluatedAt = () => Timestamp.fromDate(new Date(AI_GOVERNANCE_EVALUATED_AT));
const aiTimestamp = (value: string | null): Timestamp | null =>
  value === null ? null : Timestamp.fromDate(new Date(value));
const aiFingerprint = (label: string): string =>
  createHash("sha256").update(`rules:${label}`, "utf8").digest("hex");

function staffSafeAiKnowledgeDocument(
  documentId: AiKnowledgeDocumentId,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const expected = AI_KNOWLEDGE_DOCUMENT_MATRIX[documentId];
  return {
    id: documentId,
    workspaceId: AI_WORKSPACE,
    title: expected.title,
    version: expected.version,
    language: expected.language,
    contentKind: expected.contentKind,
    ownerUid: expected.ownerUid,
    approverUid: expected.approverUid,
    approvalState: expected.approvalState,
    approvalScope: expected.approvalScope,
    approvedAt: aiTimestamp(expected.approvedAt),
    evaluatedAt: aiEvaluatedAt(),
    effectiveFrom: aiTimestamp(expected.effectiveFrom),
    effectiveUntil: aiTimestamp(expected.effectiveUntil),
    contentFingerprint: aiFingerprint(`knowledge-content:${documentId}`),
    approvalFingerprint: aiFingerprint(`knowledge-approval:${documentId}`),
    synthetic: true,
    schemaVersion: 1,
    createdAt: Timestamp.fromDate(new Date("2026-06-01T00:00:00.000Z")),
    updatedAt: now(),
    ...overrides,
  };
}

function staffSafeAiKnowledgeSelection(
  selectionId: AiKnowledgeSelectionId,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const documentId = AI_KNOWLEDGE_SELECTION_MATRIX[selectionId].documentId;
  const expected = AI_KNOWLEDGE_DOCUMENT_MATRIX[documentId];
  return {
    selectionId,
    workspaceId: AI_WORKSPACE,
    documentId,
    contentFingerprint: aiFingerprint(`knowledge-content:${documentId}`),
    approvalFingerprint: aiFingerprint(`knowledge-approval:${documentId}`),
    selectorVersionId: AI_GOVERNANCE_SELECTOR_VERSION_ID,
    selectedAt: aiEvaluatedAt(),
    evaluatedAt: aiEvaluatedAt(),
    selectionScope: "retrospective_synthetic_fixture",
    effectiveFrom: aiTimestamp(expected.effectiveFrom),
    effectiveUntil: aiTimestamp(expected.effectiveUntil),
    synthetic: true,
    selectionFingerprint: aiFingerprint(`knowledge-selection:${selectionId}`),
    schemaVersion: 1,
    createdAt: now(),
    ...overrides,
  };
}

function aiDecisionFields(scenarioId: AiPersistedScenarioId): Record<string, unknown> {
  const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
  return {
    decision: expected.decision,
    reasonCodes: [...expected.reasonCodes],
    unsupportedClaim: false,
    clinicalSafety: expected.clinicalSafety,
    privacy: "pass",
    serviceWindow: "in_window",
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
    retryCount: 0,
    eventCount: 1,
    modelCallCount: 0,
    providerCallCount: 0,
    externalDispatchCount: 0,
    conversationMutationCount: 0,
    handoffMutationCount: 0,
    suppressionMutationCount: 0,
    chainOfThoughtStored: false,
  };
}

function aiSelectionFields(scenarioId: AiPersistedScenarioId): Record<string, unknown> {
  const selectionId = AI_PERSISTED_SCENARIO_MATRIX[scenarioId].knowledgeSelectionId;
  return {
    knowledgeSelectionId: selectionId,
    knowledgeSelectionFingerprint:
      selectionId === null
        ? null
        : aiFingerprint(`knowledge-selection:${selectionId}`),
  };
}

function staffSafeAiRun(
  scenarioId: AiPersistedScenarioId,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
  return {
    id: expected.runId,
    workspaceId: AI_WORKSPACE,
    scenarioId,
    evaluationScope: "retrospective_synthetic_fixture",
    durableScenarioScope: "partial_four_of_seven",
    requestFingerprint: aiFingerprint(`request:${scenarioId}`),
    ...aiSelectionFields(scenarioId),
    modelProvider: "none",
    modelId: null,
    promptVersionId: null,
    policyVersionId: AI_GOVERNANCE_POLICY_VERSION_ID,
    reviewerVersionId: AI_GOVERNANCE_REVIEWER_VERSION_ID,
    eventId: expected.eventId,
    auditEventId: expected.auditEventId,
    evaluatedAt: aiEvaluatedAt(),
    recordedAt: now(),
    ...aiDecisionFields(scenarioId),
    synthetic: true,
    schemaVersion: 1,
    ...overrides,
  };
}

function staffSafeAiEvent(
  scenarioId: AiPersistedScenarioId,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
  return {
    id: expected.eventId,
    workspaceId: AI_WORKSPACE,
    runId: expected.runId,
    scenarioId,
    eventType: "retrospective_evaluation_recorded",
    sequence: 1,
    previousEventId: null,
    retryOfEventId: null,
    requestFingerprint: aiFingerprint(`request:${scenarioId}`),
    runFingerprint: aiFingerprint(`run:${scenarioId}`),
    ...aiSelectionFields(scenarioId),
    modelProvider: "none",
    modelId: null,
    promptVersionId: null,
    policyVersionId: AI_GOVERNANCE_POLICY_VERSION_ID,
    reviewerVersionId: AI_GOVERNANCE_REVIEWER_VERSION_ID,
    auditEventId: expected.auditEventId,
    evaluatedAt: aiEvaluatedAt(),
    createdAt: now(),
    ...aiDecisionFields(scenarioId),
    synthetic: true,
    schemaVersion: 1,
    ...overrides,
  };
}

type DemoSignalBinding = {
  readonly state: string;
  readonly source: "synthetic_fixture" | "local_policy";
  readonly detailCode: string;
};

const demoWhatsAppSignalMatrix = {
  waba: {
    state: "not_configured",
    source: "synthetic_fixture",
    detailCode: "no_meta_waba",
  },
  phoneRegistration: {
    state: "not_configured",
    source: "synthetic_fixture",
    detailCode: "no_provider_phone",
  },
  webhook: {
    state: "mock",
    source: "synthetic_fixture",
    detailCode: "synthetic_ingress_only",
  },
  appMode: {
    state: "not_configured",
    source: "synthetic_fixture",
    detailCode: "no_meta_app",
  },
  permissions: {
    state: "unverified",
    source: "synthetic_fixture",
    detailCode: "no_meta_permissions",
  },
  templates: {
    state: "not_submitted",
    source: "synthetic_fixture",
    detailCode: "provider_approved_zero",
  },
  payment: {
    state: "not_configured",
    source: "synthetic_fixture",
    detailCode: "no_payment_configuration",
  },
  sending: {
    state: "blocked",
    source: "local_policy",
    detailCode: "external_sending_disabled",
  },
  quality: {
    state: "not_available",
    source: "synthetic_fixture",
    detailCode: "no_provider_quality",
  },
  capacity: {
    state: "not_available",
    source: "synthetic_fixture",
    detailCode: "no_provider_capacity",
  },
  realDeviceCanary: {
    state: "blocked",
    source: "local_policy",
    detailCode: "no_real_device_canary",
  },
} as const satisfies Readonly<Record<string, DemoSignalBinding>>;

function demoConnectionEvidence(
  binding: DemoSignalBinding,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    state: binding.state,
    source: binding.source,
    observedAt: now(),
    lastSuccessfulVerificationAt: null,
    detailCode: binding.detailCode,
    ...overrides,
  };
}

function demoWhatsAppSignals(): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(demoWhatsAppSignalMatrix).map(([key, binding]) => [
      key,
      demoConnectionEvidence(binding),
    ]),
  );
}

function staffSafeDemoWhatsAppConnection(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: DEMO_CONNECTION_ID,
    workspaceId: CONNECTION_WORKSPACE,
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
    signals: demoWhatsAppSignals(),
    sortKey: "01_whatsapp_simulator",
    synthetic: true,
    schemaVersion: 1,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function staffSafeDemoIntegration(
  id: typeof DEMO_HIS_INTEGRATION_ID | typeof DEMO_LIMS_INTEGRATION_ID,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const isHis = id === DEMO_HIS_INTEGRATION_ID;
  const evidenceBinding: DemoSignalBinding = {
    state: "mock",
    source: "synthetic_fixture",
    detailCode: isHis
      ? "deterministic_his_simulator_only"
      : "deterministic_lims_simulator_only",
  };
  return {
    id,
    workspaceId: CONNECTION_WORKSPACE,
    kind: isHis ? "appointment_his" : "laboratory_lims",
    displayName: isHis
      ? "Local appointment HIS simulator"
      : "Local laboratory LIMS simulator",
    environment: "demo",
    adapterMode: "synthetic",
    status: "mock",
    credentialState: "not_configured",
    externalNetworkEnabled: false,
    authoritativeSystemWriteEnabled: false,
    lastSyncAt: null,
    evidence: demoConnectionEvidence(evidenceBinding),
    sortKey: isHis ? "01_his_simulator" : "02_lims_simulator",
    synthetic: true,
    schemaVersion: 1,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function withoutField(
  value: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
}

function syntheticAuditEventV1(
  auditEventId: string,
  workspaceId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const occurredAt = now();
  return {
    id: auditEventId,
    workspaceId,
    actorUid: "agent-a",
    actorType: "user",
    action: "conversation.viewed",
    resourceType: "conversation",
    resourceId: "conversation-1",
    outcome: "allowed",
    requestId: `request_${auditEventId}`,
    occurredAt,
    createdAt: occurredAt,
    metadata: {},
    synthetic: true,
    schemaVersion: 1,
    ...overrides,
  };
}

function asModularFirestore(value: unknown): Firestore {
  return value as Firestore;
}

function syntheticContact(
  contactId: string,
  workspaceId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: contactId,
    workspaceId,
    teamId: "outpatient",
    locationId: "wattala",
    maskedPhone: "Synthetic contact · no phone stored",
    displayLabel: "Synthetic contact",
    preferredLanguage: "en",
    alternateLanguages: [],
    suppression: {
      suppressAll: false,
      suppressMarketing: false,
      invalidContact: false,
      reasons: [],
      updatedAt: now(),
    },
    tags: ["appointment"],
    synthetic: true,
    preferenceRevision: 0,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function syntheticContactSecret(
  contactId: string,
  workspaceId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: contactId,
    workspaceId,
    contactId,
    phoneLookupHmac: "a".repeat(64),
    encryptedPhoneRef: `demo://phone/${contactId}`,
    encryptedDisplayNameRef: `demo://display-name/${contactId}`,
    externalPatientRef: `DEMO-${contactId}`,
    synthetic: true,
    schemaVersion: 1,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function syntheticConversation(
  conversationId: string,
  workspaceId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: conversationId,
    workspaceId,
    contactId: "contact-allowed",
    connectionId: "connection-simulator",
    teamId: "outpatient",
    locationId: "wattala",
    status: "active",
    mode: "automation",
    assigneeId: null,
    detectedLanguage: "en",
    languageConfidence: 0.99,
    purpose: "appointment",
    serviceWindowExpiresAt: now(),
    firstResponseDueAt: now(),
    handoffSummary: "Synthetic handoff metadata only.",
    unreadCount: 1,
    synthetic: true,
    lastMessageAt: now(),
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function syntheticConsentRecord(
  consentRecordId: string,
  workspaceId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: consentRecordId,
    workspaceId,
    contactId: "contact-allowed",
    teamId: "outpatient",
    locationId: "wattala",
    purpose: "appointment_service",
    channel: "whatsapp",
    category: "service",
    status: "granted",
    source: "synthetic_fixture",
    noticeVersion: "demo-notice-v1",
    language: "en",
    evidenceRef: `demo://consent/${consentRecordId}`,
    capturedAt: now(),
    withdrawnAt: null,
    supersedesRecordId: null,
    synthetic: true,
    schemaVersion: 1,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function syntheticMessageMetadata(
  messageId: string,
  workspaceId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: messageId,
    workspaceId,
    conversationId: "conversation-1",
    contactId: "contact-allowed",
    teamId: "outpatient",
    locationId: "wattala",
    direction: "inbound",
    type: "text",
    status: "received",
    externalDispatch: "not_applicable",
    actorId: null,
    receivedAt: now(),
    sentAt: null,
    deliveredAt: null,
    metadataOnly: true,
    synthetic: true,
    schemaVersion: 1,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function syntheticNote(
  noteId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: noteId,
    workspaceId: WORKSPACE_A,
    conversationId: "conversation-1",
    authorUid: "agent-a",
    teamId: "outpatient",
    locationId: "wattala",
    bodyRef: `protected://workspaces/${WORKSPACE_A}/internal-notes/${noteId}`,
    noteKind: "handoff_context",
    synthetic: true,
    schemaVersion: 1,
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

function syntheticAppointment(
  appointmentId: string,
  workspaceId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: appointmentId,
    workspaceId,
    conversationId: "conversation-1",
    contactId: "contact-allowed",
    teamId: "outpatient",
    locationId: "wattala",
    externalAppointmentRef: "DEMO-APT-0001",
    serviceRef: "synthetic-appointment",
    practitionerDisplayLabel: "Synthetic clinician schedule",
    slotStartsAt: Timestamp.fromDate(new Date("2026-08-12T04:30:00.000Z")),
    slotEndsAt: Timestamp.fromDate(new Date("2026-08-12T05:00:00.000Z")),
    slotTimeZone: "Asia/Colombo",
    status: "confirmed",
    syncState: "mock",
    reminderState: {
      confirmation: "simulated",
      twentyFourHour: "scheduled",
      twoHour: "scheduled",
    },
    authoritativeSystem: "simulator",
    lastSyncedAt: now(),
    revision: 0,
    lastActionId: null,
    synthetic: true,
    schemaVersion: 1,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function syntheticAppointmentEvent(
  eventId: string,
  workspaceId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: eventId,
    workspaceId,
    appointmentId: "appointment-1",
    conversationId: "conversation-1",
    contactId: "contact-allowed",
    teamId: "outpatient",
    locationId: "wattala",
    actionId: eventId,
    actorUid: "simulator_seed",
    action: "simulator_snapshot_seeded",
    fromStatus: null,
    toStatus: "confirmed",
    revision: 0,
    source: "simulator_seed",
    synthetic: true,
    schemaVersion: 1,
    createdAt: now(),
    ...overrides,
  };
}

function syntheticLabReport(
  labReportId: string,
  workspaceId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: labReportId,
    workspaceId,
    conversationId: "conversation-1",
    contactId: "contact-allowed",
    teamId: "outpatient",
    locationId: "wattala",
    workflowStatus: "ready",
    collectedAt: now(),
    readyAt: now(),
    secureAccess: {
      mode: "simulator_handoff",
      available: true,
      expiresAt: now(),
    },
    lastNotificationAt: null,
    authoritativeSystem: "simulator",
    revision: 0,
    synthetic: true,
    schemaVersion: 1,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function syntheticLabReportEvent(
  eventId: string,
  workspaceId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: eventId,
    workspaceId,
    labReportId: "lab-report-1",
    conversationId: "conversation-1",
    contactId: "contact-allowed",
    teamId: "outpatient",
    locationId: "wattala",
    eventType: "simulator_report_ready",
    fromStatus: "processing",
    toStatus: "ready",
    source: "simulator_seed",
    synthetic: true,
    schemaVersion: 1,
    occurredAt: now(),
    createdAt: now(),
    ...overrides,
  };
}

function syntheticLabReportSecret(
  labReportId: string,
  workspaceId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: labReportId,
    workspaceId,
    labReportId,
    externalReportRef: "DEMO-LAB-0001",
    notificationIdempotencyFingerprint: "7".repeat(64),
    secureAccess: {
      mode: "simulator_handoff",
      handoffRef:
        `protected://workspaces/${workspaceId}/lab-reports/${labReportId}/authenticated-handoff`,
    },
    synthetic: true,
    schemaVersion: 1,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function syntheticLabReportEventSecret(
  eventId: string,
  workspaceId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: eventId,
    workspaceId,
    labReportEventId: eventId,
    labReportId: "lab-report-1",
    idempotencyFingerprint: "7".repeat(64),
    synthetic: true,
    schemaVersion: 1,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function syntheticTemplateVersion(
  templateId: string,
  workspaceId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const components = [
    { kind: "body" as const, text: "Synthetic request {{appointment_ref}} remains pending." },
    { kind: "footer" as const, text: "Synthetic demonstration only." },
  ];
  const variableRules = [
    {
      key: "appointment_ref",
      description: "Opaque synthetic appointment reference",
      required: true,
      maxLength: 24,
      exampleValue: "SYN-A1842",
      allowedPattern: "^SYN-A[0-9]{4}$",
    },
  ];
  const contentHash = createHash("sha256")
    .update(
      serializeTemplateContentBinding({
        id: templateId,
        workspaceId,
        assetKey: "appointment_confirmation",
        providerName: "appointment_confirmation",
        category: "utility",
        language: "en",
        version: 1,
        components,
        variableRules,
      }),
      "utf8",
    )
    .digest("hex");
  return {
    id: templateId,
    workspaceId,
    assetKey: "appointment_confirmation",
    sortKey: "appointment_confirmation:en:0001",
    providerName: "appointment_confirmation",
    category: "utility",
    language: "en",
    version: 1,
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
    contentHash,
    components,
    variableRules,
    ownership: {
      ownerKind: "safenet_demo",
      ownerWorkspaceId: workspaceId,
      transferableToHemas: false,
      productionUseAllowed: false,
      notice: "SafeNet demo asset. It is not a Hemas-owned or transferable production asset.",
    },
    synthetic: true,
    schemaVersion: 1,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function syntheticCampaignTemplateVersion(
  language: "en" | "si" | "ta",
  workspaceId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const id = `template_wellness_awareness_${language}_v3`;
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
  const components = [
    { kind: "body" as const, text: localized[language].body },
    { kind: "footer" as const, text: localized[language].footer },
  ];
  const variableRules = [
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
  ];
  const contentHash = createHash("sha256")
    .update(
      serializeTemplateContentBinding({
        workspaceId,
        id,
        assetKey: "wellness_awareness",
        providerName: "wellness_awareness",
        category: "marketing",
        language,
        version: 3,
        components,
        variableRules,
      }),
      "utf8",
    )
    .digest("hex");
  return {
    id,
    workspaceId,
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
    contentHash,
    components,
    variableRules,
    ownership: {
      ownerKind: "safenet_demo",
      ownerWorkspaceId: workspaceId,
      transferableToHemas: false,
      productionUseAllowed: false,
      notice: "SafeNet demo asset. It is not a Hemas-owned or transferable production asset.",
    },
    synthetic: true,
    schemaVersion: 1,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function syntheticFlowVersion(
  flowId: string,
  workspaceId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: flowId,
    workspaceId,
    assetKey: "doctor_booking_flow",
    sortKey: "doctor_booking_flow:en:0001",
    definitionId: "synthetic-flow-appointment-request",
    displayName: "Appointment booking Flow",
    language: "en",
    version: 1,
    localState: "approved",
    providerState: {
      submissionState: "not_submitted",
      approvalState: "unverified",
      authority: "none",
      assetId: null,
      qualityRating: "unknown",
      checkedAt: null,
    },
    endpointMode: "endpoint_powered",
    immutable: true,
    screenIds: ["REQUEST_DETAILS", "LOCATION", "REVIEW", "PENDING_CONFIRMATION"],
    fallbackMode: "controlled_web_or_human",
    acceptsProviderPayloads: false,
    performsNetworkCalls: false,
    confirmsHemasTransaction: false,
    ownership: {
      ownerKind: "safenet_demo",
      ownerWorkspaceId: workspaceId,
      transferableToHemas: false,
      productionUseAllowed: false,
      notice: "SafeNet demo asset. It is not a Hemas-owned or transferable production asset.",
    },
    synthetic: true,
    schemaVersion: 1,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

async function seedFoundation(): Promise<void> {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await Promise.all([
      setDoc(doc(db, "workspaces", WORKSPACE_A), {
        id: WORKSPACE_A,
        status: "active",
        name: "SafeNet synthetic demo",
        mode: "demo",
        dataClassification: "synthetic_only",
      }),
      setDoc(doc(db, "workspaces", WORKSPACE_B), {
        id: WORKSPACE_B,
        status: "active",
        name: "Isolated tenant",
        mode: "demo",
        dataClassification: "synthetic_only",
      }),
      setDoc(doc(db, "workspaces", WORKSPACE_UAT), {
        id: WORKSPACE_UAT,
        status: "active",
        name: "Synthetic-shaped but UAT-classified tenant",
        mode: "uat",
        dataClassification: "approved_uat",
      }),
      setDoc(doc(db, "workspaces", WORKSPACE_LOCKED), {
        id: WORKSPACE_LOCKED,
        status: "locked",
        name: "Locked onboarding tenant",
        mode: "production",
        dataClassification: "regulated_patient_data",
      }),
      setDoc(doc(db, "workspaces", WORKSPACE_A, "members", "agent-a"), {
        id: "agent-a",
        uid: "agent-a",
        workspaceId: WORKSPACE_A,
        role: "agent",
        status: "active",
        teamIds: ["outpatient"],
        locationIds: ["wattala"],
      }),
      setDoc(doc(db, "workspaces", WORKSPACE_A, "members", "supervisor-a"), {
        id: "supervisor-a",
        uid: "supervisor-a",
        workspaceId: WORKSPACE_A,
        role: "supervisor",
        status: "active",
        teamIds: ["outpatient"],
        locationIds: ["wattala"],
      }),
      setDoc(doc(db, "workspaces", WORKSPACE_A, "members", "operator-a"), {
        id: "operator-a",
        uid: "operator-a",
        workspaceId: WORKSPACE_A,
        role: "campaign_operator",
        status: "active",
        teamIds: [],
        locationIds: [],
      }),
      setDoc(doc(db, "workspaces", WORKSPACE_A, "members", "approver-a"), {
        id: "approver-a",
        uid: "approver-a",
        workspaceId: WORKSPACE_A,
        role: "campaign_approver",
        status: "active",
        teamIds: [],
        locationIds: [],
      }),
      setDoc(doc(db, "workspaces", WORKSPACE_A, "members", "privacy-a"), {
        id: "privacy-a",
        uid: "privacy-a",
        workspaceId: WORKSPACE_A,
        role: "privacy_reviewer",
        status: "active",
        teamIds: [],
        locationIds: [],
      }),
      setDoc(doc(db, "workspaces", WORKSPACE_A, "members", "revoked-operator-a"), {
        id: "revoked-operator-a",
        uid: "revoked-operator-a",
        workspaceId: WORKSPACE_A,
        role: "campaign_operator",
        status: "revoked",
        teamIds: [],
        locationIds: [],
      }),
      setDoc(doc(db, "workspaces", WORKSPACE_A, "members", "admin-a"), {
        id: "admin-a",
        uid: "admin-a",
        workspaceId: WORKSPACE_A,
        role: "tenant_admin",
        status: "active",
        teamIds: [],
        locationIds: [],
      }),
      setDoc(doc(db, "workspaces", WORKSPACE_UAT, "members", "admin-a"), {
        id: "admin-a",
        uid: "admin-a",
        workspaceId: WORKSPACE_UAT,
        role: "tenant_admin",
        status: "active",
        teamIds: [],
        locationIds: [],
      }),
      setDoc(doc(db, "workspaces", WORKSPACE_A, "members", "revoked-a"), {
        id: "revoked-a",
        uid: "revoked-a",
        workspaceId: WORKSPACE_A,
        role: "agent",
        status: "revoked",
        teamIds: ["outpatient"],
        locationIds: ["wattala"],
      }),
      setDoc(doc(db, "workspaces", WORKSPACE_A, "members", "empty-scope-a"), {
        id: "empty-scope-a",
        uid: "empty-scope-a",
        workspaceId: WORKSPACE_A,
        role: "agent",
        status: "active",
        teamIds: [],
        locationIds: [],
      }),
      setDoc(doc(db, "workspaces", WORKSPACE_A, "members", "analyst-a"), {
        id: "analyst-a",
        uid: "analyst-a",
        workspaceId: WORKSPACE_A,
        role: "analyst",
        status: "active",
        teamIds: [],
        locationIds: [],
      }),
      setDoc(doc(db, "workspaces", WORKSPACE_A, "teams", "outpatient"), {
        id: "outpatient",
        workspaceId: WORKSPACE_A,
        name: "Synthetic outpatient team",
        queueType: "outpatient",
        locationIds: ["wattala"],
        businessHoursLabel: "Synthetic schedule",
        firstResponseSlaMinutes: 5,
        active: true,
        createdAt: now(),
        updatedAt: now(),
      }),
      setDoc(doc(db, "workspaces", WORKSPACE_A, "locations", "wattala"), {
        id: "wattala",
        workspaceId: WORKSPACE_A,
        name: "Synthetic Wattala",
        kind: "hospital",
        city: "Wattala",
        supportedServiceRefs: ["synthetic-appointment"],
        active: true,
        createdAt: now(),
        updatedAt: now(),
      }),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "contacts", "contact-allowed"),
        syntheticContact("contact-allowed", WORKSPACE_A),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "contactSecrets", "contact-allowed"),
        syntheticContactSecret("contact-allowed", WORKSPACE_A),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "contacts", "contact-other-scope"),
        syntheticContact("contact-other-scope", WORKSPACE_A, {
          teamId: "laboratory",
          locationId: "thalawathugoda",
          tags: ["laboratory"],
        }),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "contacts", "contact-not-synthetic"),
        syntheticContact("contact-not-synthetic", WORKSPACE_A, {
          teamId: "synthetic-hold",
          locationId: "synthetic-hold",
          synthetic: false,
        }),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_B, "contacts", "contact-b"),
        syntheticContact("contact-b", WORKSPACE_B),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_UAT, "contacts", "contact-uat"),
        syntheticContact("contact-uat", WORKSPACE_UAT),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "conversations", "conversation-1"),
        syntheticConversation("conversation-1", WORKSPACE_A),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "conversations", "conversation-other-scope"),
        syntheticConversation("conversation-other-scope", WORKSPACE_A, {
          contactId: "contact-other-scope",
          teamId: "laboratory",
          locationId: "thalawathugoda",
        }),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "conversations", "conversation-not-synthetic"),
        syntheticConversation("conversation-not-synthetic", WORKSPACE_A, {
          teamId: "synthetic-hold",
          locationId: "synthetic-hold",
          status: "resolved",
          synthetic: false,
        }),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_UAT, "conversations", "conversation-uat"),
        syntheticConversation("conversation-uat", WORKSPACE_UAT),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "consentRecords", "consent-allowed"),
        syntheticConsentRecord("consent-allowed", WORKSPACE_A),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "consentRecords", "consent-other-scope"),
        syntheticConsentRecord("consent-other-scope", WORKSPACE_A, {
          contactId: "contact-other-scope",
          teamId: "laboratory",
          locationId: "thalawathugoda",
        }),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_B, "consentRecords", "consent-b"),
        syntheticConsentRecord("consent-b", WORKSPACE_B, {
          contactId: "contact-b",
        }),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "messages", "message-allowed"),
        syntheticMessageMetadata("message-allowed", WORKSPACE_A),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "messages", "message-other-scope"),
        syntheticMessageMetadata("message-other-scope", WORKSPACE_A, {
          conversationId: "conversation-other-scope",
          contactId: "contact-other-scope",
          teamId: "laboratory",
          locationId: "thalawathugoda",
        }),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_B, "messages", "message-b"),
        syntheticMessageMetadata("message-b", WORKSPACE_B, {
          conversationId: "conversation-b",
          contactId: "contact-b",
        }),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "appointments", "appointment-1"),
        syntheticAppointment("appointment-1", WORKSPACE_A),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "appointments", "appointment-other-scope"),
        syntheticAppointment("appointment-other-scope", WORKSPACE_A, {
          conversationId: "conversation-other-scope",
          contactId: "contact-other-scope",
          teamId: "laboratory",
          locationId: "thalawathugoda",
        }),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "appointmentEvents", "appointment-event-seed"),
        syntheticAppointmentEvent("appointment-event-seed", WORKSPACE_A),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_B, "appointments", "appointment-b"),
        syntheticAppointment("appointment-b", WORKSPACE_B, {
          conversationId: "conversation-b",
          contactId: "contact-b",
        }),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_B, "appointmentEvents", "appointment-event-b"),
        syntheticAppointmentEvent("appointment-event-b", WORKSPACE_B, {
          appointmentId: "appointment-b",
          conversationId: "conversation-b",
          contactId: "contact-b",
        }),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "labReports", "lab-report-1"),
        syntheticLabReport("lab-report-1", WORKSPACE_A),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "labReportSecrets", "lab-report-1"),
        syntheticLabReportSecret("lab-report-1", WORKSPACE_A),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "labReports", "lab-report-other-scope"),
        syntheticLabReport("lab-report-other-scope", WORKSPACE_A, {
          conversationId: "conversation-other-scope",
          contactId: "contact-other-scope",
          teamId: "laboratory",
          locationId: "thalawathugoda",
          secureAccess: {
            mode: "simulator_handoff",
            available: true,
            expiresAt: now(),
          },
        }),
      ),
      setDoc(
        doc(
          db,
          "workspaces",
          WORKSPACE_A,
          "labReportSecrets",
          "lab-report-other-scope",
        ),
        syntheticLabReportSecret("lab-report-other-scope", WORKSPACE_A),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "labReportEvents", "lab-report-event-seed"),
        syntheticLabReportEvent("lab-report-event-seed", WORKSPACE_A),
      ),
      setDoc(
        doc(
          db,
          "workspaces",
          WORKSPACE_A,
          "labReportEventSecrets",
          "lab-report-event-seed",
        ),
        syntheticLabReportEventSecret("lab-report-event-seed", WORKSPACE_A),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "campaigns", "campaign-governed"),
        governedCampaign("campaign-governed"),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "audienceSnapshots", "audience-governed"),
        governedAudienceSnapshot("audience-governed", "campaign-governed"),
      ),
      setDoc(doc(db, "workspaces", WORKSPACE_A, "auditEvents", "audit-1"), {
        ...syntheticAuditEventV1("audit-1", WORKSPACE_A),
      }),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "templates", "template-allowed"),
        syntheticTemplateVersion("template-allowed", WORKSPACE_A),
      ),
      ...(["en", "si", "ta"] as const).map((language) =>
        setDoc(
          doc(
            db,
            "workspaces",
            WORKSPACE_A,
            "templates",
            `template_wellness_awareness_${language}_v3`,
          ),
          syntheticCampaignTemplateVersion(language, WORKSPACE_A),
        ),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "flows", "flow-allowed"),
        syntheticFlowVersion("flow-allowed", WORKSPACE_A),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_B, "templates", "template-b"),
        syntheticTemplateVersion("template-b", WORKSPACE_B),
      ),
      setDoc(
        doc(
          db,
          "workspaces",
          WORKSPACE_B,
          "templates",
          "template_wellness_awareness_en_v3",
        ),
        syntheticCampaignTemplateVersion("en", WORKSPACE_B),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_B, "flows", "flow-b"),
        syntheticFlowVersion("flow-b", WORKSPACE_B),
      ),
      setDoc(doc(db, "phoneRoutes", "provider-phone-id"), {
        workspaceId: WORKSPACE_A,
        connectionId: "connection-1",
      }),
      setDoc(doc(db, "phoneRoutes", "synthetic-phone-route-wattala-demo"), {
        id: "synthetic-phone-route-wattala-demo",
        routeRef: "synthetic-phone-route-wattala-demo",
        workspaceId: WORKSPACE_A,
        connectionId: "connection-simulator",
        teamId: "outpatient",
        locationId: "wattala",
        active: true,
        synthetic: true,
        schemaVersion: 1,
        createdAt: now(),
        updatedAt: now(),
      }),
      setDoc(doc(db, "phoneRoutes", "synthetic-phone-route-thalawathugoda-demo"), {
        id: "synthetic-phone-route-thalawathugoda-demo",
        routeRef: "synthetic-phone-route-thalawathugoda-demo",
        workspaceId: WORKSPACE_A,
        connectionId: "connection-simulator",
        teamId: "outpatient",
        locationId: "thalawathugoda",
        active: true,
        synthetic: true,
        schemaVersion: 1,
        createdAt: now(),
        updatedAt: now(),
      }),
      setDoc(doc(db, "workspaces", WORKSPACE_A, "idempotencyKeys", "request-hash-1"), {
        workspaceId: WORKSPACE_A,
        operation: "synthetic.mutation",
        state: "completed",
        createdAt: now(),
      }),
    ]);
  });
}

const connectionNonAdminRoles = [
  "platform_owner",
  "supervisor",
  "agent",
  "campaign_operator",
  "campaign_approver",
  "analyst",
  "privacy_reviewer",
  "clinical_approver",
] as const;

async function seedConnectionRulesFixtures(): Promise<void> {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "workspaces", CONNECTION_WORKSPACE), {
        id: CONNECTION_WORKSPACE,
        status: "active",
        name: "SafeNet connection-centre synthetic demo",
        mode: "demo",
        dataClassification: "synthetic_only",
      }),
      setDoc(
        doc(db, "workspaces", CONNECTION_WORKSPACE, "members", "connections-admin"),
        {
          id: "connections-admin",
          uid: "connections-admin",
          workspaceId: CONNECTION_WORKSPACE,
          role: "tenant_admin",
          status: "active",
          teamIds: [],
          locationIds: [],
        },
      ),
      setDoc(
        doc(
          db,
          "workspaces",
          CONNECTION_WORKSPACE,
          "members",
          "connections-revoked-admin",
        ),
        {
          id: "connections-revoked-admin",
          uid: "connections-revoked-admin",
          workspaceId: CONNECTION_WORKSPACE,
          role: "tenant_admin",
          status: "revoked",
          teamIds: [],
          locationIds: [],
        },
      ),
      ...connectionNonAdminRoles.map((role) =>
        setDoc(
          doc(
            db,
            "workspaces",
            CONNECTION_WORKSPACE,
            "members",
            `connections-${role}`,
          ),
          {
            id: `connections-${role}`,
            uid: `connections-${role}`,
            workspaceId: CONNECTION_WORKSPACE,
            role,
            status: "active",
            teamIds: [],
            locationIds: [],
          },
        ),
      ),
      setDoc(
        doc(
          db,
          "workspaces",
          CONNECTION_WORKSPACE,
          "whatsappConnections",
          DEMO_CONNECTION_ID,
        ),
        staffSafeDemoWhatsAppConnection(),
      ),
      setDoc(
        doc(
          db,
          "workspaces",
          CONNECTION_WORKSPACE,
          "integrations",
          DEMO_HIS_INTEGRATION_ID,
        ),
        staffSafeDemoIntegration(DEMO_HIS_INTEGRATION_ID),
      ),
      setDoc(
        doc(
          db,
          "workspaces",
          CONNECTION_WORKSPACE,
          "integrations",
          DEMO_LIMS_INTEGRATION_ID,
        ),
        staffSafeDemoIntegration(DEMO_LIMS_INTEGRATION_ID),
      ),
    ]);
  });
}

async function replaceConnectionRulesFixture(
  collectionName: "whatsappConnections" | "integrations",
  documentId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(
        context.firestore(),
        "workspaces",
        CONNECTION_WORKSPACE,
        collectionName,
        documentId,
      ),
      data,
    );
  });
}

function demoConnectionListShapes(
  db: Firestore,
  collectionName: "whatsappConnections" | "integrations",
) {
  const catalogue = collection(
    db,
    "workspaces",
    CONNECTION_WORKSPACE,
    collectionName,
  );
  return [
    catalogue,
    query(catalogue, limit(1)),
    query(
      catalogue,
      where("schemaVersion", "==", 1),
      where("synthetic", "==", true),
      orderBy("sortKey", "asc"),
      limit(21),
    ),
    query(catalogue, where("schemaVersion", "==", 1), limit(21)),
  ] as const;
}

function fixedDemoConnectionRefs(db: Firestore) {
  return [
    doc(
      db,
      "workspaces",
      CONNECTION_WORKSPACE,
      "whatsappConnections",
      DEMO_CONNECTION_ID,
    ),
    doc(
      db,
      "workspaces",
      CONNECTION_WORKSPACE,
      "integrations",
      DEMO_HIS_INTEGRATION_ID,
    ),
    doc(
      db,
      "workspaces",
      CONNECTION_WORKSPACE,
      "integrations",
      DEMO_LIMS_INTEGRATION_ID,
    ),
  ] as const;
}

function governedCampaign(
  campaignId: string,
  workspaceId = WORKSPACE_A,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: campaignId,
    workspaceId,
    name: "Synthetic 50,000-contact wellness awareness simulation",
    purpose: "health_campaigns",
    messageCategory: "marketing",
    targetAction: "Open the synthetic wellness information journey",
    ownerId: "operator-a",
    templateVersionIds: {
      en: "template_wellness_awareness_en_v3",
      si: "template_wellness_awareness_si_v3",
      ta: "template_wellness_awareness_ta_v3",
    },
    audienceSnapshotId: "audience-governed",
    state: "scheduled",
    dispatchMode: "simulation",
    schedule: {
      startsAt: now(),
      timeZone: "Asia/Colombo",
      quietHours: { startsAtLocal: "20:00", endsAtLocal: "08:00" },
    },
    approval: {
      required: true,
      status: "approved",
      scope: "simulation_only",
      approverId: "approver-a",
      reviewedAt: now(),
      approvedContentHash: "9".repeat(64),
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
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function governedAudienceSnapshot(
  snapshotId: string,
  campaignId: string,
  workspaceId = WORKSPACE_A,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: snapshotId,
    workspaceId,
    campaignId,
    criteriaSummary: "Synthetic aggregate-only governed audience.",
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
    contentHash: "7".repeat(64),
    immutable: true,
    synthetic: true,
    schemaVersion: 1,
    finalizedAt: now(),
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function governedCampaignEvent(
  eventId: string,
  campaignId: string,
  workspaceId = WORKSPACE_A,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: eventId,
    workspaceId,
    campaignId,
    actorUid: "operator-a",
    action: "advance_batch",
    fromState: "dispatching",
    toState: "dispatching",
    revision: 3,
    checkpointId: `${campaignId}:checkpoint:000000`,
    externalCalls: 0,
    networkCalls: 0,
    synthetic: true,
    schemaVersion: 1,
    createdAt: now(),
    ...overrides,
  };
}

function governedCampaignCheckpoint(
  campaignId: string,
  eventId: string,
  workspaceId = WORKSPACE_A,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: `${campaignId}:checkpoint:000000`,
    workspaceId,
    campaignId,
    eventId,
    batchIndex: 0,
    sourceOffsetStart: 0,
    sourceOffsetEnd: 1_310,
    eligibleCount: 1_000,
    languageCounts: { en: 540, si: 240, ta: 220 },
    processedEligible: 1_000,
    scanComplete: false,
    digest: "8".repeat(64),
    externalCalls: 0,
    networkCalls: 0,
    synthetic: true,
    schemaVersion: 1,
    createdAt: now(),
    ...overrides,
  };
}

beforeAll(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8"),
    },
  });
});

const PHASE5_AUTO_DEFINITION_ID = "automation_synthetic_appointment_v3";
const PHASE5_AUTO_EVENT_ID = "automation_definition_event_activate_004";
const PHASE5_AUTO_RUN_ID = "automation_run_synthetic_001";
const PHASE5_AUTO_RUN_EVENT_ID = "automation_run_event_synthetic_002";
const PHASE5_AUTO_WORK_ITEM_ID = "automation_work_item_synthetic_001";
const PHASE5_CARE_PATHWAY_ID = "care_pathway_synthetic_followup_v1";
const PHASE5_CARE_EVENT_ID = "care_pathway_event_activate_004";
const PHASE5_CARE_ENROLLMENT_ID = "care_enrollment_synthetic_001";
const PHASE5_CARE_ENROLLMENT_EVENT_ID = "care_enrollment_event_start_002";
const PHASE5_CARE_ESCALATION_ID = "care_escalation_synthetic_001";
const PHASE5_CARE_HANDOFF_ID = "care_handoff_synthetic_001";
const PHASE5_AUTO_AUDIT_ID = "audit_automation_definition_activate_004";
const PHASE5_CARE_AUDIT_ID = "audit_care_pathway_activate_004";

const phase5SafeProjection = {
  schemaVersion: 1,
  synthetic: true,
  externalDispatchCount: 0,
  networkCallCount: 0,
} as const;

function phase5AutomationDefinition(overrides: Record<string, unknown> = {}) {
  return {
    id: PHASE5_AUTO_DEFINITION_ID,
    workspaceId: WORKSPACE_A,
    family: "appointment_service",
    version: 3,
    name: "Synthetic appointment automation",
    trigger: "appointment_event",
    consentPurpose: "appointment_service",
    riskLevel: "medium",
    steps: [{ id: "step_stop", kind: "stop" }],
    contentHash: "1".repeat(64),
    secretBindingHash: "2".repeat(64),
    ownerUid: "admin-a",
    approverUid: "supervisor-a",
    approvalHash: "3".repeat(64),
    approvalScope: "simulation_only",
    approvedAt: now(),
    lifecycleState: "approved",
    schemaVersion: 1,
    synthetic: true,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function phase5AutomationActivation(overrides: Record<string, unknown> = {}) {
  return {
    id: "appointment_service",
    workspaceId: WORKSPACE_A,
    family: "appointment_service",
    activeDefinitionId: PHASE5_AUTO_DEFINITION_ID,
    activeDefinitionVersion: 3,
    activeDefinitionContentHash: "1".repeat(64),
    activeDefinitionApprovalHash: "3".repeat(64),
    activeDefinitionApprovalScope: "simulation_only",
    activeDefinitionSecretBindingHash: "2".repeat(64),
    activatedByUid: "supervisor-a",
    activatedAt: now(),
    activationEventId: PHASE5_AUTO_EVENT_ID,
    activationAuditEventId: PHASE5_AUTO_AUDIT_ID,
    revision: 1,
    createdAt: now(),
    updatedAt: now(),
    ...phase5SafeProjection,
    ...overrides,
  };
}

function phase5AutomationDefinitionEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: PHASE5_AUTO_EVENT_ID,
    workspaceId: WORKSPACE_A,
    family: "appointment_service",
    eventType: "activated",
    definitionId: PHASE5_AUTO_DEFINITION_ID,
    definitionVersion: 3,
    definitionContentHash: "1".repeat(64),
    definitionApprovalHash: "3".repeat(64),
    definitionApprovalScope: "simulation_only",
    definitionSecretBindingHash: "2".repeat(64),
    fromLifecycleState: "approved",
    toLifecycleState: "approved",
    revision: 4,
    auditEventId: PHASE5_AUTO_AUDIT_ID,
    occurredAt: now(),
    ...phase5SafeProjection,
    actorKind: "staff",
    actorUid: "supervisor-a",
    ...overrides,
  };
}

function phase5AutomationRun(overrides: Record<string, unknown> = {}) {
  return {
    id: PHASE5_AUTO_RUN_ID,
    workspaceId: WORKSPACE_A,
    definitionId: PHASE5_AUTO_DEFINITION_ID,
    definitionVersion: 3,
    definitionContentHash: "1".repeat(64),
    teamId: "outpatient",
    locationId: "wattala",
    state: "queued",
    pausedFromState: null,
    nextEligibleAt: null,
    openWorkItemId: null,
    currentStepIndex: 0,
    completedStepCount: 0,
    attemptCount: 0,
    revision: 1,
    outcomeCode: "accepted",
    lastEventId: null,
    ...phase5SafeProjection,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function phase5AutomationRunEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: PHASE5_AUTO_RUN_EVENT_ID,
    workspaceId: WORKSPACE_A,
    runId: PHASE5_AUTO_RUN_ID,
    definitionId: PHASE5_AUTO_DEFINITION_ID,
    definitionVersion: 3,
    definitionContentHash: "1".repeat(64),
    teamId: "outpatient",
    locationId: "wattala",
    revision: 2,
    auditEventId: "audit_automation_run_advance_002",
    action: "advance_step",
    fromState: "running",
    toState: "running",
    stepIndex: 0,
    stepId: "step_stop",
    attemptNumber: 0,
    workItemId: null,
    nextEligibleAt: null,
    reasonCode: "step_policy_applied",
    evidenceFingerprint: "4".repeat(64),
    outcomeCode: "step_completed",
    occurredAt: now(),
    ...phase5SafeProjection,
    actorKind: "system",
    actorUid: null,
    ...overrides,
  };
}

function phase5AutomationWorkItem(overrides: Record<string, unknown> = {}) {
  return {
    id: PHASE5_AUTO_WORK_ITEM_ID,
    workspaceId: WORKSPACE_A,
    runId: PHASE5_AUTO_RUN_ID,
    definitionId: PHASE5_AUTO_DEFINITION_ID,
    definitionVersion: 3,
    definitionContentHash: "1".repeat(64),
    teamId: "outpatient",
    locationId: "wattala",
    reasonCode: "human_takeover",
    state: "open",
    openedAt: now(),
    slaMinutes: 15,
    dueAt: now(),
    assignedMemberUid: null,
    acknowledgedAt: null,
    acknowledgedByUid: null,
    resolvedAt: null,
    resolvedByUid: null,
    resolutionCode: null,
    revision: 1,
    lastEventId: PHASE5_AUTO_RUN_EVENT_ID,
    ...phase5SafeProjection,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function phase5CarePathway(overrides: Record<string, unknown> = {}) {
  return {
    id: PHASE5_CARE_PATHWAY_ID,
    workspaceId: WORKSPACE_A,
    family: "post_discharge",
    protocolVersion: "v1.0",
    name: "Synthetic post-discharge pathway",
    clinicalOwnerUid: "admin-a",
    clinicalApproverUid: "clinical-a",
    contactPoints: [{ dayOffset: 1 }],
    responseSlaMinutes: 15,
    escalationTeamId: "outpatient",
    eligibleLocationIds: ["wattala"],
    afterHoursBehavior: "on_call_queue",
    writeBackRequired: true,
    instructionsSource: "clinician_authored",
    aiMayGenerateInstructions: false,
    suppressions: [
      "readmission",
      "transfer",
      "death",
      "clinical_hold",
      "withdrawal",
      "invalid_contact",
    ],
    protectedContentHash: "5".repeat(64),
    secretBindingHash: "6".repeat(64),
    contentHash: "7".repeat(64),
    approvalHash: "8".repeat(64),
    approvalScope: "clinical_simulation_only",
    approvedAt: now(),
    lifecycleState: "approved",
    schemaVersion: 1,
    synthetic: true,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function phase5CareActivation(overrides: Record<string, unknown> = {}) {
  return {
    id: "post_discharge",
    workspaceId: WORKSPACE_A,
    family: "post_discharge",
    activePathwayId: PHASE5_CARE_PATHWAY_ID,
    activeProtocolVersion: "v1.0",
    activePathwayContentHash: "7".repeat(64),
    activePathwayApprovalHash: "8".repeat(64),
    activePathwayApprovalScope: "clinical_simulation_only",
    activePathwaySecretBindingHash: "6".repeat(64),
    activatedByUid: "clinical-a",
    activatedAt: now(),
    activationEventId: PHASE5_CARE_EVENT_ID,
    activationAuditEventId: PHASE5_CARE_AUDIT_ID,
    revision: 1,
    createdAt: now(),
    updatedAt: now(),
    ...phase5SafeProjection,
    ...overrides,
  };
}

function phase5CarePathwayEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: PHASE5_CARE_EVENT_ID,
    workspaceId: WORKSPACE_A,
    family: "post_discharge",
    eventType: "activated",
    pathwayId: PHASE5_CARE_PATHWAY_ID,
    pathwayProtocolVersion: "v1.0",
    pathwayContentHash: "7".repeat(64),
    pathwayApprovalHash: "8".repeat(64),
    pathwayApprovalScope: "clinical_simulation_only",
    pathwaySecretBindingHash: "6".repeat(64),
    fromLifecycleState: "approved",
    toLifecycleState: "approved",
    revision: 4,
    auditEventId: PHASE5_CARE_AUDIT_ID,
    occurredAt: now(),
    ...phase5SafeProjection,
    actorKind: "staff",
    actorUid: "clinical-a",
    ...overrides,
  };
}

function phase5CareEnrollment(overrides: Record<string, unknown> = {}) {
  return {
    id: PHASE5_CARE_ENROLLMENT_ID,
    workspaceId: WORKSPACE_A,
    pathwayId: PHASE5_CARE_PATHWAY_ID,
    pathwayProtocolVersion: "v1.0",
    pathwayContentHash: "7".repeat(64),
    teamId: "outpatient",
    locationId: "wattala",
    state: "queued",
    nextContactIndex: 0,
    nextContactAt: now(),
    activeSuppressions: [],
    openEscalationId: null,
    safetyHoldEscalationId: null,
    openHandoffId: null,
    revision: 1,
    outcomeCode: "accepted",
    lastEventId: null,
    ...phase5SafeProjection,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function phase5CareEnrollmentEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: PHASE5_CARE_ENROLLMENT_EVENT_ID,
    workspaceId: WORKSPACE_A,
    enrollmentId: PHASE5_CARE_ENROLLMENT_ID,
    pathwayId: PHASE5_CARE_PATHWAY_ID,
    pathwayProtocolVersion: "v1.0",
    pathwayContentHash: "7".repeat(64),
    teamId: "outpatient",
    locationId: "wattala",
    revision: 2,
    auditEventId: "audit_care_enrollment_start_002",
    action: "start",
    fromState: "queued",
    toState: "active",
    contactPointIndex: null,
    suppressionReason: null,
    escalationId: null,
    escalationStateBefore: null,
    escalationStateAfter: null,
    handoffId: null,
    activeSuppressionsAfter: [],
    nextContactAt: now(),
    outcomeCode: "accepted",
    occurredAt: now(),
    ...phase5SafeProjection,
    actorKind: "system",
    actorUid: null,
    ...overrides,
  };
}

function phase5CareEscalation(overrides: Record<string, unknown> = {}) {
  return {
    id: PHASE5_CARE_ESCALATION_ID,
    workspaceId: WORKSPACE_A,
    enrollmentId: PHASE5_CARE_ENROLLMENT_ID,
    pathwayId: PHASE5_CARE_PATHWAY_ID,
    pathwayProtocolVersion: "v1.0",
    pathwayContentHash: "7".repeat(64),
    teamId: "outpatient",
    locationId: "wattala",
    reasonCode: "red_flag_response",
    state: "open",
    openedAt: now(),
    responseSlaMinutes: 15,
    responseDueAt: now(),
    openedBy: { actorKind: "system", actorUid: null },
    acknowledgedAt: null,
    acknowledgedByUid: null,
    resolvedAt: null,
    resolvedByUid: null,
    resolutionCode: null,
    writeBackRequired: true,
    writeBackState: "pending",
    revision: 1,
    lastEventId: PHASE5_CARE_ENROLLMENT_EVENT_ID,
    ...phase5SafeProjection,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function phase5CareHandoff(overrides: Record<string, unknown> = {}) {
  return {
    id: PHASE5_CARE_HANDOFF_ID,
    workspaceId: WORKSPACE_A,
    enrollmentId: PHASE5_CARE_ENROLLMENT_ID,
    pathwayId: PHASE5_CARE_PATHWAY_ID,
    pathwayProtocolVersion: "v1.0",
    pathwayContentHash: "7".repeat(64),
    teamId: "outpatient",
    locationId: "wattala",
    state: "open",
    openedEventId: PHASE5_CARE_ENROLLMENT_EVENT_ID,
    openedBy: { actorKind: "staff", actorUid: "clinical-a" },
    openedAt: now(),
    releasedEventId: null,
    releasedBy: null,
    releasedAt: null,
    revision: 1,
    lastEventId: PHASE5_CARE_ENROLLMENT_EVENT_ID,
    ...phase5SafeProjection,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function phase5CatalogueAudit(input: {
  id: string;
  actorUid: string;
  action: string;
  resourceType: string;
  resourceId: string;
  eventId: string;
  revision: number;
}) {
  return {
    id: input.id,
    workspaceId: WORKSPACE_A,
    actorUid: input.actorUid,
    actorType: "user",
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    outcome: "allowed",
    requestId: `${input.id}:request`,
    occurredAt: now(),
    createdAt: now(),
    metadata: { eventId: input.eventId, revision: input.revision, synthetic: true },
    synthetic: true,
    schemaVersion: 1,
  };
}

const phase5StaffDocuments = [
  ["automationDefinitions", PHASE5_AUTO_DEFINITION_ID, phase5AutomationDefinition()],
  ["automationActivations", "appointment_service", phase5AutomationActivation()],
  ["automationDefinitionEvents", PHASE5_AUTO_EVENT_ID, phase5AutomationDefinitionEvent()],
  ["automationRuns", PHASE5_AUTO_RUN_ID, phase5AutomationRun()],
  ["automationRunEvents", PHASE5_AUTO_RUN_EVENT_ID, phase5AutomationRunEvent()],
  ["automationWorkItems", PHASE5_AUTO_WORK_ITEM_ID, phase5AutomationWorkItem()],
  ["carePathways", PHASE5_CARE_PATHWAY_ID, phase5CarePathway()],
  ["carePathwayActivations", "post_discharge", phase5CareActivation()],
  ["carePathwayEvents", PHASE5_CARE_EVENT_ID, phase5CarePathwayEvent()],
  ["careEnrollments", PHASE5_CARE_ENROLLMENT_ID, phase5CareEnrollment()],
  ["careEnrollmentEvents", PHASE5_CARE_ENROLLMENT_EVENT_ID, phase5CareEnrollmentEvent()],
  ["careEscalations", PHASE5_CARE_ESCALATION_ID, phase5CareEscalation()],
  ["careHandoffs", PHASE5_CARE_HANDOFF_ID, phase5CareHandoff()],
] as const;

const phase5SecretCollections = [
  "automationDefinitionSecrets",
  "automationTriggerReceipts",
  "automationRunSecrets",
  "automationRunEventSecrets",
  "automationWorkItemSecrets",
  "carePathwaySecrets",
  "careEnrollmentReceipts",
  "careEnrollmentSecrets",
  "careEnrollmentEventSecrets",
  "careEscalationSecrets",
] as const;

async function seedPhase5RulesFixtures(): Promise<void> {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const authorityAt = now();
    await Promise.all([
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "members", "admin-a"),
        { scopeMode: "workspace_wide", mfaSatisfied: true, lastAuthenticatedAt: authorityAt },
        { merge: true },
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "members", "supervisor-a"),
        { scopeMode: "assigned", mfaSatisfied: true, lastAuthenticatedAt: authorityAt },
        { merge: true },
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "members", "clinical-a"),
        {
          id: "clinical-a",
          uid: "clinical-a",
          workspaceId: WORKSPACE_A,
          role: "clinical_approver",
          scopeMode: "assigned",
          status: "active",
          teamIds: ["outpatient"],
          locationIds: ["wattala"],
          mfaSatisfied: true,
          lastAuthenticatedAt: authorityAt,
        },
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "members", "assigned-admin-a"),
        {
          id: "assigned-admin-a",
          uid: "assigned-admin-a",
          workspaceId: WORKSPACE_A,
          role: "tenant_admin",
          scopeMode: "assigned",
          status: "active",
          teamIds: ["outpatient"],
          locationIds: ["wattala"],
          mfaSatisfied: true,
          lastAuthenticatedAt: authorityAt,
        },
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "members", "partial-admin-a"),
        {
          id: "partial-admin-a",
          uid: "partial-admin-a",
          workspaceId: WORKSPACE_A,
          role: "tenant_admin",
          scopeMode: "assigned",
          status: "active",
          teamIds: ["outpatient"],
          locationIds: ["thalawathugoda"],
          mfaSatisfied: true,
          lastAuthenticatedAt: authorityAt,
        },
      ),
      ...phase5StaffDocuments.map(([collectionName, id, data]) =>
        setDoc(doc(db, "workspaces", WORKSPACE_A, collectionName, id), data),
      ),
      ...phase5SecretCollections.map((collectionName) =>
        setDoc(doc(db, "workspaces", WORKSPACE_A, collectionName, "secret-fixture"), {
          workspaceId: WORKSPACE_A,
          protectedContextRef: "demo://protected/fixture",
          fingerprint: "9".repeat(64),
        }),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "auditEvents", PHASE5_AUTO_AUDIT_ID),
        phase5CatalogueAudit({
          id: PHASE5_AUTO_AUDIT_ID,
          actorUid: "supervisor-a",
          action: "automation_definition.activate",
          resourceType: "automation_definition",
          resourceId: PHASE5_AUTO_DEFINITION_ID,
          eventId: PHASE5_AUTO_EVENT_ID,
          revision: 4,
        }),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "auditEvents", PHASE5_CARE_AUDIT_ID),
        phase5CatalogueAudit({
          id: PHASE5_CARE_AUDIT_ID,
          actorUid: "clinical-a",
          action: "care_pathway.activate",
          resourceType: "care_pathway",
          resourceId: PHASE5_CARE_PATHWAY_ID,
          eventId: PHASE5_CARE_EVENT_ID,
          revision: 4,
        }),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "auditEvents", "audit_phase5_polluted"),
        {
          ...phase5CatalogueAudit({
            id: "audit_phase5_polluted",
            actorUid: "supervisor-a",
            action: "automation_definition.activate",
            resourceType: "automation_definition",
            resourceId: PHASE5_AUTO_DEFINITION_ID,
            eventId: PHASE5_AUTO_EVENT_ID,
            revision: 4,
          }),
          protectedPayload: "must-not-be-readable",
        },
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "automationRuns", "automation-run-polluted"),
        phase5AutomationRun({ id: "automation-run-polluted", contactId: "contact-leak" }),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "careEnrollmentEvents", "care-event-polluted"),
        phase5CareEnrollmentEvent({ id: "care-event-polluted", patientId: "patient-leak" }),
      ),
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "automationDefinitions", "definition-polluted"),
        phase5AutomationDefinition({ id: "definition-polluted", active: true }),
      ),
    ]);
  });
}

describe("canary retention configuration", () => {
  it("enables unindexed timestamp TTL fields for every short-retention collection", () => {
    const indexes = JSON.parse(
      readFileSync(resolve(process.cwd(), "firestore.indexes.json"), "utf8"),
    ) as { fieldOverrides?: Array<Record<string, unknown>> };
    const ttlCollections = new Set(
      (indexes.fieldOverrides ?? [])
        .filter((entry) =>
          entry.fieldPath === "expireAt" &&
          entry.ttl === true &&
          Array.isArray(entry.indexes) &&
          entry.indexes.length === 0
        )
        .map((entry) => entry.collectionGroup),
    );
    expect(ttlCollections).toEqual(new Set([
      "canary_inbound_return_routes",
      "canary_public_quota_counters",
      "canary_public_bot_sessions",
      "canary_public_suppressions",
      "canary_inbound_events",
      "canary_webhook_outbox",
      "canary_provider_message_routes",
      "protectedMessageContents",
      "protectedMessageAccessAudits",
      "protectedMessageAccessQuotas",
    ]));
  });
});

describe("Phase 5 automation and care persistence rules", () => {
  beforeEach(seedPhase5RulesFixtures);

  it("allows a workspace-wide tenant admin to exact-get all 13 strict staff projections", async () => {
    const db = testEnvironment.authenticatedContext("admin-a").firestore();
    for (const [collectionName, id] of phase5StaffDocuments) {
      await assertSucceeds(getDoc(doc(db, "workspaces", WORKSPACE_A, collectionName, id)));
    }
  });

  it("keeps automation and clinical roles separated while analysts see catalogue only", async () => {
    const supervisor = testEnvironment.authenticatedContext("supervisor-a").firestore();
    const clinical = testEnvironment.authenticatedContext("clinical-a").firestore();
    const analyst = testEnvironment.authenticatedContext("analyst-a").firestore();
    const agent = testEnvironment.authenticatedContext("agent-a").firestore();

    await assertSucceeds(getDoc(doc(supervisor, "workspaces", WORKSPACE_A, "automationDefinitions", PHASE5_AUTO_DEFINITION_ID)));
    await assertSucceeds(getDoc(doc(supervisor, "workspaces", WORKSPACE_A, "automationRuns", PHASE5_AUTO_RUN_ID)));
    await assertFails(getDoc(doc(supervisor, "workspaces", WORKSPACE_A, "carePathways", PHASE5_CARE_PATHWAY_ID)));
    await assertFails(getDoc(doc(supervisor, "workspaces", WORKSPACE_A, "careEnrollments", PHASE5_CARE_ENROLLMENT_ID)));

    await assertSucceeds(getDoc(doc(clinical, "workspaces", WORKSPACE_A, "carePathways", PHASE5_CARE_PATHWAY_ID)));
    await assertSucceeds(getDoc(doc(clinical, "workspaces", WORKSPACE_A, "careEnrollments", PHASE5_CARE_ENROLLMENT_ID)));
    await assertFails(getDoc(doc(clinical, "workspaces", WORKSPACE_A, "automationDefinitions", PHASE5_AUTO_DEFINITION_ID)));
    await assertFails(getDoc(doc(clinical, "workspaces", WORKSPACE_A, "automationRuns", PHASE5_AUTO_RUN_ID)));

    await assertSucceeds(getDoc(doc(analyst, "workspaces", WORKSPACE_A, "automationDefinitions", PHASE5_AUTO_DEFINITION_ID)));
    await assertSucceeds(getDoc(doc(analyst, "workspaces", WORKSPACE_A, "carePathways", PHASE5_CARE_PATHWAY_ID)));
    await assertFails(getDoc(doc(analyst, "workspaces", WORKSPACE_A, "automationRuns", PHASE5_AUTO_RUN_ID)));
    await assertFails(getDoc(doc(analyst, "workspaces", WORKSPACE_A, "careEnrollments", PHASE5_CARE_ENROLLMENT_ID)));

    await assertFails(getDoc(doc(agent, "workspaces", WORKSPACE_A, "automationDefinitions", PHASE5_AUTO_DEFINITION_ID)));
    await assertFails(getDoc(doc(agent, "workspaces", WORKSPACE_A, "carePathways", PHASE5_CARE_PATHWAY_ID)));
  });

  it("allows assigned tenant admins only for the exact team and location pair", async () => {
    const exact = testEnvironment.authenticatedContext("assigned-admin-a").firestore();
    const partial = testEnvironment.authenticatedContext("partial-admin-a").firestore();
    await assertSucceeds(getDoc(doc(exact, "workspaces", WORKSPACE_A, "automationRuns", PHASE5_AUTO_RUN_ID)));
    await assertSucceeds(getDoc(doc(exact, "workspaces", WORKSPACE_A, "careEnrollments", PHASE5_CARE_ENROLLMENT_ID)));
    await assertFails(getDoc(doc(partial, "workspaces", WORKSPACE_A, "automationRuns", PHASE5_AUTO_RUN_ID)));
    await assertFails(getDoc(doc(partial, "workspaces", WORKSPACE_A, "careEnrollments", PHASE5_CARE_ENROLLMENT_ID)));
  });

  it("permits only bounded catalogue queries and denies every execution list", async () => {
    const supervisor = testEnvironment.authenticatedContext("supervisor-a").firestore();
    await assertSucceeds(
      getDocs(
        query(
          collection(supervisor, "workspaces", WORKSPACE_A, "automationDefinitions"),
          where("family", "==", "appointment_service"),
          orderBy("version", "desc"),
          limit(100),
        ),
      ),
    );
    await assertFails(getDocs(collection(supervisor, "workspaces", WORKSPACE_A, "automationDefinitions")));
    await assertFails(
      getDocs(
        query(
          collection(supervisor, "workspaces", WORKSPACE_A, "automationDefinitions"),
          where("family", "==", "appointment_service"),
          limit(101),
        ),
      ),
    );
    await assertFails(
      getDocs(
        query(
          collection(supervisor, "workspaces", WORKSPACE_A, "automationRuns"),
          limit(1),
        ),
      ),
    );
  });

  it("denies all reads, queries and writes for every secret or receipt collection", async () => {
    for (const uid of ["admin-a", "supervisor-a", "clinical-a", "analyst-a"]) {
      const db = testEnvironment.authenticatedContext(uid).firestore();
      for (const collectionName of phase5SecretCollections) {
        await assertFails(getDoc(doc(db, "workspaces", WORKSPACE_A, collectionName, "secret-fixture")));
        await assertFails(getDocs(query(collection(db, "workspaces", WORKSPACE_A, collectionName), limit(1))));
        await assertFails(setDoc(doc(db, "workspaces", WORKSPACE_A, collectionName, "forged"), { synthetic: true }));
      }
    }
  });

  it("rejects polluted staff-safe projections and every direct client mutation", async () => {
    const db = testEnvironment.authenticatedContext("admin-a").firestore();
    await assertFails(getDoc(doc(db, "workspaces", WORKSPACE_A, "automationRuns", "automation-run-polluted")));
    await assertFails(getDoc(doc(db, "workspaces", WORKSPACE_A, "careEnrollmentEvents", "care-event-polluted")));
    await assertFails(getDoc(doc(db, "workspaces", WORKSPACE_A, "automationDefinitions", "definition-polluted")));
    for (const [collectionName] of phase5StaffDocuments) {
      await assertFails(setDoc(doc(db, "workspaces", WORKSPACE_A, collectionName, "forged"), {}));
    }
    await assertFails(updateDoc(doc(db, "workspaces", WORKSPACE_A, "automationRuns", PHASE5_AUTO_RUN_ID), { revision: 2 }));
    await assertFails(deleteDoc(doc(db, "workspaces", WORKSPACE_A, "carePathways", PHASE5_CARE_PATHWAY_ID)));
  });

  it("grants only narrow exact catalogue-lifecycle audit reads", async () => {
    const supervisor = testEnvironment.authenticatedContext("supervisor-a").firestore();
    const clinical = testEnvironment.authenticatedContext("clinical-a").firestore();
    const analyst = testEnvironment.authenticatedContext("analyst-a").firestore();
    const agent = testEnvironment.authenticatedContext("agent-a").firestore();
    await assertSucceeds(getDoc(doc(supervisor, "workspaces", WORKSPACE_A, "auditEvents", PHASE5_AUTO_AUDIT_ID)));
    await assertSucceeds(getDoc(doc(analyst, "workspaces", WORKSPACE_A, "auditEvents", PHASE5_AUTO_AUDIT_ID)));
    await assertFails(getDoc(doc(clinical, "workspaces", WORKSPACE_A, "auditEvents", PHASE5_AUTO_AUDIT_ID)));
    await assertSucceeds(getDoc(doc(clinical, "workspaces", WORKSPACE_A, "auditEvents", PHASE5_CARE_AUDIT_ID)));
    await assertSucceeds(getDoc(doc(analyst, "workspaces", WORKSPACE_A, "auditEvents", PHASE5_CARE_AUDIT_ID)));
    await assertFails(getDoc(doc(supervisor, "workspaces", WORKSPACE_A, "auditEvents", PHASE5_CARE_AUDIT_ID)));
    await assertFails(getDoc(doc(agent, "workspaces", WORKSPACE_A, "auditEvents", PHASE5_AUTO_AUDIT_ID)));
    await assertFails(getDoc(doc(supervisor, "workspaces", WORKSPACE_A, "auditEvents", "audit_phase5_polluted")));
    await assertFails(getDoc(doc(analyst, "workspaces", WORKSPACE_A, "auditEvents", "audit_phase5_polluted")));
    await assertFails(getDocs(query(collection(analyst, "workspaces", WORKSPACE_A, "auditEvents"), limit(10))));
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await seedFoundation();
});

afterAll(async () => {
  await testEnvironment.cleanup();
});

describe("default deny and tenant isolation", () => {
  it("denies public get and collection list operations", async () => {
    const db = testEnvironment.unauthenticatedContext().firestore();

    await assertFails(
      getDoc(doc(db, "workspaces", WORKSPACE_A, "contacts", "contact-allowed")),
    );
    await assertFails(getDocs(collection(db, "workspaces", WORKSPACE_A, "contacts")));
  });

  it("allows an active member to read their workspace and own membership", async () => {
    const db = testEnvironment.authenticatedContext("agent-a").firestore();

    const workspace = await assertSucceeds(getDoc(doc(db, "workspaces", WORKSPACE_A)));
    const membership = await assertSucceeds(
      getDoc(doc(db, "workspaces", WORKSPACE_A, "members", "agent-a")),
    );

    expect(workspace.exists()).toBe(true);
    expect(membership.data()?.role).toBe("agent");
  });

  it("keeps a locked onboarding workspace and absent membership unreadable", async () => {
    const db = testEnvironment.authenticatedContext("admin-a").firestore();

    await assertFails(getDoc(doc(db, "workspaces", WORKSPACE_LOCKED)));
    await assertFails(
      getDoc(doc(db, "workspaces", WORKSPACE_LOCKED, "members", "admin-a")),
    );
    await assertFails(
      getDocs(query(collection(db, "workspaces", WORKSPACE_LOCKED, "contacts"), limit(10))),
    );
  });

  it("allows a scoped patient record read and denies a record outside team/location scope", async () => {
    const db = testEnvironment.authenticatedContext("agent-a").firestore();

    await assertSucceeds(
      getDoc(doc(db, "workspaces", WORKSPACE_A, "contacts", "contact-allowed")),
    );
    await assertFails(
      getDoc(doc(db, "workspaces", WORKSPACE_A, "contacts", "contact-other-scope")),
    );
  });

  it("allows only the literal true live-canary extension on the strict contact read model", async () => {
    const contactId = "contact-live-rules";
    const contactPath = ["workspaces", WORKSPACE_A, "contacts", contactId] as const;
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), ...contactPath),
        syntheticContact(contactId, WORKSPACE_A, { liveCanary: true }),
      );
    });

    const db = testEnvironment.authenticatedContext("agent-a").firestore();
    await assertSucceeds(getDoc(doc(db, ...contactPath)));

    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), ...contactPath), { liveCanary: false });
    });
    await assertFails(getDoc(doc(db, ...contactPath)));

    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), ...contactPath));
    });
  });

  it("keeps provider-send reply leases entirely backend-only", async () => {
    const leaseRef = [
      "workspaces",
      WORKSPACE_A,
      "canary_reply_leases",
      "conversation-1",
    ] as const;
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), ...leaseRef), {
        id: "conversation-1",
        workspaceId: WORKSPACE_A,
        conversationId: "conversation-1",
        operationId: "reply_1234567890abcdef",
        actorUid: "agent-a",
        bodySha256: "a".repeat(64),
        status: "sending",
        providerMessageId: null,
        containsMessageContent: false,
        createdAt: now(),
        updatedAt: now(),
        schemaVersion: 1,
      });
    });

    const db = testEnvironment.authenticatedContext("agent-a").firestore();
    await assertFails(getDoc(doc(db, ...leaseRef)));
    await assertFails(updateDoc(doc(db, ...leaseRef), { status: "sent" }));

    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), ...leaseRef));
    });
  });

  it("keeps every canary receipt, operation and reconciliation collection backend-only", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      for (const collectionName of backendOnlyCanaryCollections) {
        await setDoc(
          doc(
            context.firestore(),
            "workspaces",
            WORKSPACE_A,
            collectionName,
            "control-plane-fixture",
          ),
          {
            workspaceId: WORKSPACE_A,
            containsMessageContent: false,
            synthetic: true,
          },
        );
      }
    });

    for (const uid of ["admin-a", "supervisor-a", "agent-a", "analyst-a"]) {
      const db = testEnvironment.authenticatedContext(uid).firestore();
      for (const collectionName of backendOnlyCanaryCollections) {
        const controlPlaneDoc = doc(
          db,
          "workspaces",
          WORKSPACE_A,
          collectionName,
          "control-plane-fixture",
        );
        await assertFails(getDoc(controlPlaneDoc));
        await assertFails(
          getDocs(
            query(
              collection(db, "workspaces", WORKSPACE_A, collectionName),
              limit(1),
            ),
          ),
        );
        await assertFails(setDoc(controlPlaneDoc, { forged: true }));
        await assertFails(updateDoc(controlPlaneDoc, { forged: true }));
        await assertFails(deleteDoc(controlPlaneDoc));
      }
    }
  });

  it("keeps enterprise bulk secrets, receipts and callback lanes backend-only", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      for (const collectionName of backendOnlyEnterpriseCollections) {
        await setDoc(
          doc(
            context.firestore(),
            "workspaces",
            WORKSPACE_A,
            collectionName,
            "control-plane-fixture",
          ),
          {
            workspaceId: WORKSPACE_A,
            containsMessageContent: false,
            synthetic: true,
          },
        );
      }
    });

    for (const uid of ["admin-a", "supervisor-a", "agent-a", "analyst-a"]) {
      const db = testEnvironment.authenticatedContext(uid).firestore();
      for (const collectionName of backendOnlyEnterpriseCollections) {
        const controlPlaneDoc = doc(
          db,
          "workspaces",
          WORKSPACE_A,
          collectionName,
          "control-plane-fixture",
        );
        await assertFails(getDoc(controlPlaneDoc));
        await assertFails(
          getDocs(
            query(
              collection(db, "workspaces", WORKSPACE_A, collectionName),
              limit(1),
            ),
          ),
        );
        await assertFails(setDoc(controlPlaneDoc, { forged: true }));
        await assertFails(updateDoc(controlPlaneDoc, { forged: true }));
        await assertFails(deleteDoc(controlPlaneDoc));
      }
    }
  });

  it("serves enterprise bulk ledgers as member read models and callback config to admins only", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "workspaces", WORKSPACE_A, "enterprise_bulk_jobs", "bulkjob-fixture"),
        {
          id: "bulkjob-fixture",
          workspaceId: WORKSPACE_A,
          clientBatchId: "batch_demo_20260824_001",
          status: "dispatching",
          itemCount: 2,
          queuedCount: 1,
          sentCount: 1,
          notSentCount: 0,
          suppressedCount: 0,
          containsMessageContent: false,
          synthetic: true,
        },
      );
      await setDoc(
        doc(
          context.firestore(),
          "workspaces",
          WORKSPACE_A,
          "enterprise_bulk_job_items",
          "bulkitem-fixture",
        ),
        {
          id: "bulkitem-fixture",
          workspaceId: WORKSPACE_A,
          jobId: "bulkjob-fixture",
          clientBatchId: "batch_demo_20260824_001",
          toNumberSha256: "f".repeat(64),
          toNumberLast4: "4567",
          clientReference: "crm-0001",
          status: "sent",
          containsMessageContent: false,
          synthetic: true,
        },
      );
      await setDoc(
        doc(
          context.firestore(),
          "workspaces",
          WORKSPACE_A,
          "enterprise_callback_endpoints",
          "cbend-fixture",
        ),
        {
          id: "cbend-fixture",
          workspaceId: WORKSPACE_A,
          dlrUrl: "https://api.hemas-crm.example/webhooks/dlr",
          replyUrl: null,
          secretVersion: 1,
          synthetic: true,
        },
      );
    });

    const agentDb = testEnvironment.authenticatedContext("agent-a").firestore();
    const adminDb = testEnvironment.authenticatedContext("admin-a").firestore();

    await assertSucceeds(
      getDoc(doc(agentDb, "workspaces", WORKSPACE_A, "enterprise_bulk_jobs", "bulkjob-fixture")),
    );
    await assertSucceeds(
      getDoc(
        doc(agentDb, "workspaces", WORKSPACE_A, "enterprise_bulk_job_items", "bulkitem-fixture"),
      ),
    );
    await assertFails(
      setDoc(
        doc(agentDb, "workspaces", WORKSPACE_A, "enterprise_bulk_jobs", "forged"),
        { id: "forged", workspaceId: WORKSPACE_A, containsMessageContent: false },
      ),
    );
    await assertFails(
      updateDoc(
        doc(adminDb, "workspaces", WORKSPACE_A, "enterprise_bulk_jobs", "bulkjob-fixture"),
        { sentCount: 2 },
      ),
    );

    await assertFails(
      getDoc(
        doc(agentDb, "workspaces", WORKSPACE_A, "enterprise_callback_endpoints", "cbend-fixture"),
      ),
    );
    await assertSucceeds(
      getDoc(
        doc(adminDb, "workspaces", WORKSPACE_A, "enterprise_callback_endpoints", "cbend-fixture"),
      ),
    );
    await assertFails(
      updateDoc(
        doc(adminDb, "workspaces", WORKSPACE_A, "enterprise_callback_endpoints", "cbend-fixture"),
        { dlrUrl: "https://attacker.example/hook" },
      ),
    );
  });

  it("allows only bounded patient-list queries that prove an agent's exact scope", async () => {
    const db = testEnvironment.authenticatedContext("agent-a").firestore();
    const contacts = collection(db, "workspaces", WORKSPACE_A, "contacts");

    const allowed = await assertSucceeds(
      getDocs(
        query(
          contacts,
          where("teamId", "==", "outpatient"),
          where("locationId", "==", "wattala"),
          limit(50),
        ),
      ),
    );
    expect(allowed.docs.map((record) => record.id)).toEqual(["contact-allowed"]);

    await assertFails(
      getDocs(
        query(
          contacts,
          where("teamId", "==", "laboratory"),
          where("locationId", "==", "thalawathugoda"),
          limit(50),
        ),
      ),
    );
    await assertFails(getDocs(query(contacts, limit(50))));
  });

  it("allows a tenant admin a bounded tenant list but denies an unbounded list", async () => {
    const db = testEnvironment.authenticatedContext("admin-a").firestore();
    const contacts = collection(db, "workspaces", WORKSPACE_A, "contacts");

    const bounded = await assertSucceeds(getDocs(query(contacts, limit(100))));
    expect(bounded.size).toBe(3);
    await assertFails(getDocs(contacts));
  });

  it("runs the indexed tenant-admin status plus last-message conversation query", async () => {
    const db = testEnvironment.authenticatedContext("admin-a").firestore();
    const conversations = await listScopedConversations(asModularFirestore(db), {
      workspaceId: WORKSPACE_A,
      statuses: ["active", "assigned"],
      pageSize: 50,
    });

    expect(conversations).toHaveLength(2);
    expect(conversations.every((item) => item.workspaceId === WORKSPACE_A)).toBe(true);
  });

  it("lists bounded team/location references but denies unbounded and cross-tenant queries", async () => {
    const agentDb = testEnvironment.authenticatedContext("agent-a").firestore();
    const [teams, locations] = await Promise.all([
      listWorkspaceTeams(asModularFirestore(agentDb), {
        workspaceId: WORKSPACE_A,
        pageSize: 100,
      }),
      listWorkspaceLocations(asModularFirestore(agentDb), {
        workspaceId: WORKSPACE_A,
        pageSize: 100,
      }),
    ]);
    expect(teams.map((team) => team.id)).toEqual(["outpatient"]);
    expect(locations.map((location) => location.id)).toEqual(["wattala"]);

    await assertFails(getDocs(collection(agentDb, "workspaces", WORKSPACE_A, "teams")));
    await assertFails(
      getDocs(
        query(
          collection(agentDb, "workspaces", WORKSPACE_A, "locations"),
          orderBy("name", "asc"),
          limit(101),
        ),
      ),
    );
    await assertFails(
      getDocs(
        query(
          collection(agentDb, "workspaces", WORKSPACE_B, "teams"),
          orderBy("name", "asc"),
          limit(10),
        ),
      ),
    );
  });

  it("denies cross-tenant reads even when target scope labels match", async () => {
    const db = testEnvironment.authenticatedContext("agent-a").firestore();

    await assertFails(getDoc(doc(db, "workspaces", WORKSPACE_B)));
    await assertFails(
      getDoc(doc(db, "workspaces", WORKSPACE_B, "contacts", "contact-b")),
    );
  });

  it("denies cross-tenant writes even when the caller has a role elsewhere", async () => {
    const db = testEnvironment.authenticatedContext("operator-a").firestore();

    await assertFails(
      setDoc(
        doc(db, "workspaces", WORKSPACE_B, "campaigns", "campaign-cross-tenant"),
        governedCampaign("campaign-cross-tenant", WORKSPACE_B),
      ),
    );
  });

  it("denies revoked members", async () => {
    const db = testEnvironment.authenticatedContext("revoked-a").firestore();

    await assertFails(getDoc(doc(db, "workspaces", WORKSPACE_A)));
    await assertFails(
      getDoc(doc(db, "workspaces", WORKSPACE_A, "contacts", "contact-allowed")),
    );
  });

  it("treats empty non-admin scope arrays as no patient-record access", async () => {
    const db = testEnvironment.authenticatedContext("empty-scope-a").firestore();

    await assertSucceeds(getDoc(doc(db, "workspaces", WORKSPACE_A)));
    await assertFails(
      getDoc(doc(db, "workspaces", WORKSPACE_A, "contacts", "contact-allowed")),
    );
  });

  it("denies every client access to global routing collections", async () => {
    const db = testEnvironment.authenticatedContext("admin-a").firestore();

    await assertFails(getDoc(doc(db, "phoneRoutes", "provider-phone-id")));
    await assertFails(
      getDoc(doc(db, "phoneRoutes", "synthetic-phone-route-wattala-demo")),
    );
    await assertFails(
      getDoc(doc(db, "phoneRoutes", "synthetic-phone-route-thalawathugoda-demo")),
    );
    await assertFails(
      setDoc(doc(db, "webhookEvents", "forged-event"), {
        workspaceId: WORKSPACE_A,
      }),
    );
  });

  it("denies every client read and write to backend idempotency evidence", async () => {
    const db = testEnvironment.authenticatedContext("admin-a").firestore();
    const evidenceRef = doc(
      db,
      "workspaces",
      WORKSPACE_A,
      "idempotencyKeys",
      "request-hash-1",
    );

    await assertFails(getDoc(evidenceRef));
    await assertFails(
      setDoc(doc(db, "workspaces", WORKSPACE_A, "idempotencyKeys", "forged"), {
        workspaceId: WORKSPACE_A,
        operation: "role.promote",
        state: "completed",
        createdAt: serverTimestamp(),
      }),
    );
    await assertFails(updateDoc(evidenceRef, { state: "replayed" }));
    await assertFails(deleteDoc(evidenceRef));
  });

  it("keeps protected contact identifiers out of staff contacts and denies every contact-secret operation", async () => {
    const agentDb = testEnvironment.authenticatedContext("agent-a").firestore();
    const adminDb = testEnvironment.authenticatedContext("admin-a").firestore();
    const publicDb = testEnvironment.unauthenticatedContext().firestore();
    const contact = await assertSucceeds(
      getDoc(doc(agentDb, "workspaces", WORKSPACE_A, "contacts", "contact-allowed")),
    );
    for (const protectedField of [
      "phoneLookupHmac",
      "encryptedPhoneRef",
      "encryptedDisplayNameRef",
      "externalPatientRef",
    ]) {
      expect(contact.data()).not.toHaveProperty(protectedField);
    }

    const secretPath = [
      "workspaces",
      WORKSPACE_A,
      "contactSecrets",
      "contact-allowed",
    ] as const;
    await assertFails(getDoc(doc(publicDb, ...secretPath)));
    await assertFails(getDoc(doc(agentDb, ...secretPath)));
    await assertFails(getDoc(doc(adminDb, ...secretPath)));
    await assertFails(
      getDocs(
        query(
          collection(adminDb, "workspaces", WORKSPACE_A, "contactSecrets"),
          limit(100),
        ),
      ),
    );
    await assertFails(
      setDoc(
        doc(adminDb, "workspaces", WORKSPACE_A, "contactSecrets", "forged"),
        syntheticContactSecret("forged", WORKSPACE_A),
      ),
    );
    await assertFails(updateDoc(doc(adminDb, ...secretPath), { externalPatientRef: "forged" }));
    await assertFails(deleteDoc(doc(adminDb, ...secretPath)));
  });
});

describe("immutable consent and metadata-only message read models", () => {
  it("cross-parses strict ingress-shaped contact, conversation and message documents", async () => {
    const db = testEnvironment.authenticatedContext("agent-a").firestore();
    const scope = {
      workspaceId: WORKSPACE_A,
      teamId: "outpatient",
      locationId: "wattala",
      pageSize: 50,
    } as const;
    const [contacts, conversations, messages] = await Promise.all([
      listScopedContacts(asModularFirestore(db), scope),
      listScopedConversations(asModularFirestore(db), scope),
      listConversationMessageMetadata(asModularFirestore(db), {
        ...scope,
        conversationId: "conversation-1",
      }),
    ]);

    expect(contacts.map((record) => record.id)).toEqual(["contact-allowed"]);
    expect(conversations.map((record) => record.id)).toEqual(["conversation-1"]);
    expect(messages.map((record) => record.id)).toEqual(["message-allowed"]);
    expect(contacts[0]).toMatchObject({
      preferenceRevision: 0,
      suppression: { suppressAll: false, suppressMarketing: false },
    });
    expect(contacts[0]).not.toHaveProperty("phoneLookupHmac");
    expect(contacts[0]).not.toHaveProperty("encryptedPhoneRef");
    expect(contacts[0]).not.toHaveProperty("encryptedDisplayNameRef");
    expect(contacts[0]).not.toHaveProperty("externalPatientRef");
    expect(conversations[0]).toMatchObject({
      mode: "automation",
      purpose: "appointment",
    });
    expect(messages[0]).not.toHaveProperty("content");
  });

  it("loads a contact's immutable consent history through the exact bounded scope query", async () => {
    const db = testEnvironment.authenticatedContext("agent-a").firestore();
    const records = await listConsentRecordsForContact(asModularFirestore(db), {
      workspaceId: WORKSPACE_A,
      contactId: "contact-allowed",
      teamId: "outpatient",
      locationId: "wattala",
      pageSize: 50,
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: "consent-allowed",
      contactId: "contact-allowed",
      status: "granted",
      synthetic: true,
      schemaVersion: 1,
    });
  });

  it("denies unscoped, out-of-scope, oversized, role-ineligible and cross-tenant consent lists", async () => {
    const agentDb = testEnvironment.authenticatedContext("agent-a").firestore();
    const operatorDb = testEnvironment.authenticatedContext("operator-a").firestore();
    const consentCollection = collection(
      agentDb,
      "workspaces",
      WORKSPACE_A,
      "consentRecords",
    );

    await assertFails(getDocs(query(consentCollection, limit(50))));
    await assertFails(
      getDocs(
        query(
          consentCollection,
          where("contactId", "==", "contact-other-scope"),
          where("teamId", "==", "laboratory"),
          where("locationId", "==", "thalawathugoda"),
          orderBy("capturedAt", "desc"),
          limit(50),
        ),
      ),
    );
    await assertFails(
      getDocs(
        query(
          consentCollection,
          where("contactId", "==", "contact-allowed"),
          where("teamId", "==", "outpatient"),
          where("locationId", "==", "wattala"),
          orderBy("capturedAt", "desc"),
          limit(101),
        ),
      ),
    );
    await assertFails(
      getDoc(
        doc(operatorDb, "workspaces", WORKSPACE_A, "consentRecords", "consent-allowed"),
      ),
    );
    await assertFails(
      listConsentRecordsForContact(asModularFirestore(agentDb), {
        workspaceId: WORKSPACE_B,
        contactId: "contact-b",
        teamId: "outpatient",
        locationId: "wattala",
        pageSize: 50,
      }),
    );
  });

  it("keeps consent evidence append-only and rejects client schema/resource abuse", async () => {
    const db = testEnvironment.authenticatedContext("admin-a").firestore();
    const consentRef = doc(
      db,
      "workspaces",
      WORKSPACE_A,
      "consentRecords",
      "consent-allowed",
    );

    await assertFails(
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "consentRecords", "consent-forged"),
        syntheticConsentRecord("consent-forged", WORKSPACE_A, {
          evidenceRef: `demo://${"x".repeat(500_000)}`,
          pollutedAuthority: "tenant_admin",
        }),
      ),
    );
    await assertFails(updateDoc(consentRef, { status: "withdrawn" }));
    await assertFails(deleteDoc(consentRef));
  });

  it("lists strict metadata-only messages for one conversation and scope", async () => {
    const db = testEnvironment.authenticatedContext("agent-a").firestore();
    const records = await listConversationMessageMetadata(asModularFirestore(db), {
      workspaceId: WORKSPACE_A,
      conversationId: "conversation-1",
      teamId: "outpatient",
      locationId: "wattala",
      pageSize: 50,
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: "message-allowed",
      conversationId: "conversation-1",
      metadataOnly: true,
      synthetic: true,
      schemaVersion: 1,
    });
    expect(records[0]).not.toHaveProperty("content");
  });

  it("denies unscoped, out-of-scope, oversized, ineligible-role and cross-tenant message queries", async () => {
    const agentDb = testEnvironment.authenticatedContext("agent-a").firestore();
    const operatorDb = testEnvironment.authenticatedContext("operator-a").firestore();
    const messages = collection(agentDb, "workspaces", WORKSPACE_A, "messages");

    await assertFails(getDocs(query(messages, limit(50))));
    await assertFails(
      getDocs(
        query(
          messages,
          where("conversationId", "==", "conversation-other-scope"),
          where("teamId", "==", "laboratory"),
          where("locationId", "==", "thalawathugoda"),
          orderBy("createdAt", "desc"),
          limit(50),
        ),
      ),
    );
    await assertFails(
      getDocs(
        query(
          messages,
          where("conversationId", "==", "conversation-1"),
          where("teamId", "==", "outpatient"),
          where("locationId", "==", "wattala"),
          orderBy("createdAt", "desc"),
          limit(101),
        ),
      ),
    );
    await assertFails(
      getDoc(doc(operatorDb, "workspaces", WORKSPACE_A, "messages", "message-allowed")),
    );
    await assertFails(
      listConversationMessageMetadata(asModularFirestore(agentDb), {
        workspaceId: WORKSPACE_B,
        conversationId: "conversation-b",
        teamId: "outpatient",
        locationId: "wattala",
        pageSize: 50,
      }),
    );
  });

  it("keeps every message mutation server-only, including polluted and oversized creates", async () => {
    const db = testEnvironment.authenticatedContext("admin-a").firestore();
    const messageRef = doc(db, "workspaces", WORKSPACE_A, "messages", "message-allowed");

    await assertFails(
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "messages", "message-forged"),
        syntheticMessageMetadata("message-forged", WORKSPACE_A, {
          content: "x".repeat(500_000),
          providerAuthority: "accepted",
        }),
      ),
    );
    await assertFails(updateDoc(messageRef, { status: "delivered" }));
    await assertFails(deleteDoc(messageRef));
  });

  it("keeps protected conversation message content backend-only for every browser role", async () => {
    const protectedPath = [
      "workspaces",
      WORKSPACE_A,
      "conversations",
      "conversation-1",
      "protectedMessageContents",
      "protected-message-1",
    ] as const;
    const protectedCollectionPath = [
      "workspaces",
      WORKSPACE_A,
      "conversations",
      "conversation-1",
      "protectedMessageContents",
    ] as const;
    const accessAuditPath = [
      "workspaces",
      WORKSPACE_A,
      "protectedMessageAccessAudits",
      "protected-access-1",
    ] as const;
    const accessQuotaPath = [
      "workspaces",
      WORKSPACE_A,
      "protectedMessageAccessQuotas",
      "protected-quota-1",
    ] as const;
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, ...protectedPath), {
        id: "protected-message-1",
        workspaceId: WORKSPACE_A,
        conversationId: "conversation-1",
        messageId: "message-allowed",
        teamId: "outpatient",
        locationId: "wattala",
        direction: "inbound",
        source: "whatsapp_user",
        contentKind: "text",
        text: "synthetic protected fixture",
        bodySha256: "a".repeat(64),
        bodyLength: 27,
        state: "materialized",
        containsMessageContent: true,
        containsPlaintextSender: false,
        liveCanary: true,
        synthetic: true,
        createdAt: now(),
        updatedAt: now(),
        expiresAtMs: now().toMillis() + 60_000,
        expireAt: Timestamp.fromMillis(now().toMillis() + 60_000),
        schemaVersion: 1,
      });
      await setDoc(doc(db, ...accessAuditPath), {
        id: "protected-access-1",
        workspaceId: WORKSPACE_A,
        actorUid: "agent-a",
        actorRole: "agent",
        conversationId: "conversation-1",
        teamId: "outpatient",
        locationId: "wattala",
        action: "conversation.protected_text_viewed",
        accessMode: "agent_assigned_self",
        outcome: "allowed",
        recordCount: 1,
        purpose: "canary_support",
        containsMessageContent: false,
        occurredAt: now(),
        schemaVersion: 1,
      });
      const quotaWindowStartMs = Math.floor(now().toMillis() / 60_000) * 60_000;
      await setDoc(doc(db, ...accessQuotaPath), {
        id: "protected-quota-1",
        workspaceId: WORKSPACE_A,
        actorUid: "agent-a",
        requestCount: 1,
        limit: 6,
        windowStartMs: quotaWindowStartMs,
        windowStartedAt: Timestamp.fromMillis(quotaWindowStartMs),
        lastRequestAt: now(),
        expiresAtMs: quotaWindowStartMs + 300_000,
        expireAt: Timestamp.fromMillis(quotaWindowStartMs + 300_000),
        containsMessageContent: false,
        schemaVersion: 1,
      });
    });

    const unauthenticatedDb = testEnvironment.unauthenticatedContext().firestore();
    const agentDb = testEnvironment.authenticatedContext("agent-a").firestore();
    const supervisorDb = testEnvironment.authenticatedContext("supervisor-a").firestore();
    const adminDb = testEnvironment.authenticatedContext("admin-a").firestore();
    const analystDb = testEnvironment.authenticatedContext("analyst-a").firestore();

    for (const db of [unauthenticatedDb, agentDb, supervisorDb, adminDb, analystDb]) {
      await assertFails(getDoc(doc(db, ...protectedPath)));
      await assertFails(getDocs(query(collection(db, ...protectedCollectionPath), limit(60))));
      await assertFails(getDoc(doc(db, ...accessAuditPath)));
      await assertFails(getDoc(doc(db, ...accessQuotaPath)));
      await assertFails(
        getDocs(
          query(
            collection(db, "workspaces", WORKSPACE_A, "protectedMessageAccessAudits"),
            limit(60),
          ),
        ),
      );
      await assertFails(
        getDocs(
          query(
            collection(db, "workspaces", WORKSPACE_A, "protectedMessageAccessQuotas"),
            limit(1),
          ),
        ),
      );
      await assertFails(
        setDoc(
          doc(
            db,
            ...protectedCollectionPath,
            `forged-${db === adminDb ? "admin" : db === supervisorDb ? "supervisor" : "other"}`,
          ),
          {
            workspaceId: WORKSPACE_A,
            conversationId: "conversation-1",
            messageId: "message-forged",
            text: "forged browser content",
          },
        ),
      );
      await assertFails(
        setDoc(
          doc(
            db,
            "workspaces",
            WORKSPACE_A,
            "protectedMessageAccessAudits",
            `forged-${db === adminDb ? "admin" : db === supervisorDb ? "supervisor" : "other"}`,
          ),
          {
            workspaceId: WORKSPACE_A,
            actorUid: "forged",
            recordCount: 60,
          },
        ),
      );
      await assertFails(
        setDoc(
          doc(
            db,
            "workspaces",
            WORKSPACE_A,
            "protectedMessageAccessQuotas",
            `forged-${db === adminDb ? "admin" : db === supervisorDb ? "supervisor" : "other"}`,
          ),
          {
            workspaceId: WORKSPACE_A,
            actorUid: "forged",
            requestCount: 0,
          },
        ),
      );
    }

    await assertFails(updateDoc(doc(adminDb, ...protectedPath), { text: "overwritten" }));
    await assertFails(deleteDoc(doc(adminDb, ...protectedPath)));
    await assertFails(updateDoc(doc(adminDb, ...accessAuditPath), { recordCount: 99 }));
    await assertFails(deleteDoc(doc(adminDb, ...accessAuditPath)));
    await assertFails(updateDoc(doc(adminDb, ...accessQuotaPath), { requestCount: 0 }));
    await assertFails(deleteDoc(doc(adminDb, ...accessQuotaPath)));
    await assertFails(
      getDoc(
        doc(
          agentDb,
          "workspaces",
          WORKSPACE_B,
          "conversations",
          "conversation-b",
          "protectedMessageContents",
          "protected-message-b",
        ),
      ),
    );
  });
});

describe("synthetic template and Flow catalogue governance", () => {
  it("allows only bounded catalogue reads for roles with template-view authority", async () => {
    const agentDb = testEnvironment.authenticatedContext("agent-a").firestore();
    const operatorDb = testEnvironment.authenticatedContext("operator-a").firestore();
    const analystDb = testEnvironment.authenticatedContext("analyst-a").firestore();
    const [templates, flows, englishFlows] = await Promise.all([
      listTemplateCatalogue(asModularFirestore(agentDb), {
        workspaceId: WORKSPACE_A,
        pageSize: 100,
      }),
      listFlowCatalogue(asModularFirestore(agentDb), {
        workspaceId: WORKSPACE_A,
        pageSize: 100,
      }),
      listFlowCatalogue(asModularFirestore(operatorDb), {
        workspaceId: WORKSPACE_A,
        language: "en",
        pageSize: 100,
      }),
    ]);
    expect(templates.map((record) => record.id)).toEqual([
      "template-allowed",
      "template_wellness_awareness_en_v3",
      "template_wellness_awareness_si_v3",
      "template_wellness_awareness_ta_v3",
    ]);
    expect(flows.map((record) => record.id)).toEqual(["flow-allowed"]);
    expect(englishFlows).toHaveLength(1);
    expect(hasVerifiedProviderApproval(templates[0])).toBe(false);
    expect(hasVerifiedProviderApproval(flows[0])).toBe(false);
    expect(templates[0].localState).toBe("approved");
    expect(templates[0].providerState.approvalState).toBe("unverified");

    await assertFails(
      getDocs(collection(agentDb, "workspaces", WORKSPACE_A, "templates")),
    );
    await assertFails(
      getDocs(
        query(
          collection(agentDb, "workspaces", WORKSPACE_A, "flows"),
          orderBy("sortKey", "asc"),
          limit(101),
        ),
      ),
    );
    await assertFails(
      getDoc(doc(analystDb, "workspaces", WORKSPACE_A, "templates", "template-allowed")),
    );
    await assertFails(
      getDocs(
        query(
          collection(analystDb, "workspaces", WORKSPACE_A, "templates"),
          orderBy("sortKey", "asc"),
          limit(100),
        ),
      ),
    );
    await assertFails(
      getDocs(
        query(
          collection(analystDb, "workspaces", WORKSPACE_A, "flows"),
          orderBy("sortKey", "asc"),
          limit(100),
        ),
      ),
    );
  });

  it("allows analysts only exact, hash-verified campaign-template gets", async () => {
    const analystDb = testEnvironment.authenticatedContext("analyst-a").firestore();
    const templates = await Promise.all(
      (["en", "si", "ta"] as const).map((language) =>
        getTemplateCatalogueItem(asModularFirestore(analystDb), {
          workspaceId: WORKSPACE_A,
          templateId: `template_wellness_awareness_${language}_v3`,
        }),
      ),
    );
    expect(templates.map((template) => template.language)).toEqual(["en", "si", "ta"]);
    expect(templates.every((template) => /^[0-9a-f]{64}$/.test(template.contentHash))).toBe(
      true,
    );
    await assertFails(
      getDoc(doc(analystDb, "workspaces", WORKSPACE_A, "templates", "template-allowed")),
    );
    await assertFails(
      getDoc(
        doc(
          analystDb,
          "workspaces",
          WORKSPACE_A,
          "templates",
          "template_wellness_awareness_si_v4",
        ),
      ),
    );
  });

  it("fails analyst campaign-template reads closed on schema or content-hash pollution", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const drifted = syntheticCampaignTemplateVersion("en", WORKSPACE_A);
      const components = drifted.components as readonly Record<string, unknown>[];
      await Promise.all([
        setDoc(
          doc(
            db,
            "workspaces",
            WORKSPACE_A,
            "templates",
            "template_wellness_awareness_en_v3",
          ),
          {
            ...drifted,
            components: components.map((component) =>
              component.kind === "body"
                ? { ...component, text: "Changed {{patient_ref}} {{campaign_topic}} body." }
                : component,
            ),
          },
        ),
        setDoc(
          doc(
            db,
            "workspaces",
            WORKSPACE_A,
            "templates",
            "template_wellness_awareness_si_v3",
          ),
          syntheticCampaignTemplateVersion("si", WORKSPACE_A, {
            providerSecret: "forbidden",
          }),
        ),
      ]);
    });
    const analystDb = testEnvironment.authenticatedContext("analyst-a").firestore();
    await expect(
      getTemplateCatalogueItem(asModularFirestore(analystDb), {
        workspaceId: WORKSPACE_A,
        templateId: "template_wellness_awareness_en_v3",
      }),
    ).rejects.toMatchObject({ code: "invalid_data" });
    await assertFails(
      getDoc(
        doc(
          analystDb,
          "workspaces",
          WORKSPACE_A,
          "templates",
          "template_wellness_awareness_si_v3",
        ),
      ),
    );
  });

  it("denies cross-tenant and revoked catalogue reads", async () => {
    const agentDb = testEnvironment.authenticatedContext("agent-a").firestore();
    const analystDb = testEnvironment.authenticatedContext("analyst-a").firestore();
    const revokedDb = testEnvironment.authenticatedContext("revoked-a").firestore();

    await assertFails(
      getDoc(doc(agentDb, "workspaces", WORKSPACE_B, "templates", "template-b")),
    );
    await assertFails(
      getDoc(
        doc(
          analystDb,
          "workspaces",
          WORKSPACE_B,
          "templates",
          "template_wellness_awareness_en_v3",
        ),
      ),
    );
    await assertFails(getDoc(doc(agentDb, "workspaces", WORKSPACE_B, "flows", "flow-b")));
    await assertFails(
      getDoc(doc(revokedDb, "workspaces", WORKSPACE_A, "templates", "template-allowed")),
    );
    await assertFails(
      getDoc(
        doc(
          revokedDb,
          "workspaces",
          WORKSPACE_A,
          "templates",
          "template_wellness_awareness_en_v3",
        ),
      ),
    );
    await assertFails(
      getDocs(
        query(
          collection(revokedDb, "workspaces", WORKSPACE_A, "flows"),
          orderBy("sortKey", "asc"),
          limit(100),
        ),
      ),
    );
  });

  it("prevents role escalation from unlocking catalogue access", async () => {
    const analystDb = testEnvironment.authenticatedContext("analyst-a").firestore();
    await assertFails(
      updateDoc(doc(analystDb, "workspaces", WORKSPACE_A, "members", "analyst-a"), {
        role: "campaign_operator",
      }),
    );
    await assertFails(
      getDoc(doc(analystDb, "workspaces", WORKSPACE_A, "templates", "template-allowed")),
    );
  });

  it("keeps provider approval, released template metadata and Flow state server-only", async () => {
    const adminDb = testEnvironment.authenticatedContext("admin-a").firestore();
    const templateRef = doc(
      adminDb,
      "workspaces",
      WORKSPACE_A,
      "templates",
      "template-allowed",
    );
    const flowRef = doc(adminDb, "workspaces", WORKSPACE_A, "flows", "flow-allowed");

    await assertFails(
      updateDoc(templateRef, {
        providerState: {
          submissionState: "submitted",
          approvalState: "approved",
          authority: "meta",
          assetId: "forged-provider-template",
          qualityRating: "high",
          checkedAt: serverTimestamp(),
        },
      }),
    );
    await assertFails(
      updateDoc(templateRef, {
        language: "ta",
        version: 2,
        components: [{ kind: "body", text: "Forged released content" }],
        immutable: false,
      }),
    );
    await assertFails(
      setDoc(
        doc(adminDb, "workspaces", WORKSPACE_A, "templates", "template-forged"),
        syntheticTemplateVersion("template-forged", WORKSPACE_A, {
          localState: "draft",
          immutable: false,
        }),
      ),
    );
    await assertFails(deleteDoc(templateRef));

    await assertFails(
      updateDoc(flowRef, {
        providerState: {
          submissionState: "submitted",
          approvalState: "approved",
          authority: "meta",
          assetId: "forged-provider-flow",
          qualityRating: "high",
          checkedAt: serverTimestamp(),
        },
        acceptsProviderPayloads: true,
        performsNetworkCalls: true,
      }),
    );
    await assertFails(
      setDoc(
        doc(adminDb, "workspaces", WORKSPACE_A, "flows", "flow-forged"),
        syntheticFlowVersion("flow-forged", WORKSPACE_A),
      ),
    );
    await assertFails(deleteDoc(flowRef));
  });
});

describe("server-managed authority and evidence", () => {
  it("prevents a member from promoting themselves", async () => {
    const db = testEnvironment.authenticatedContext("agent-a").firestore();

    await assertFails(
      updateDoc(doc(db, "workspaces", WORKSPACE_A, "members", "agent-a"), {
        role: "tenant_admin",
      }),
    );
  });

  it("prevents even a tenant admin from changing membership directly", async () => {
    const db = testEnvironment.authenticatedContext("admin-a").firestore();

    await assertFails(
      updateDoc(doc(db, "workspaces", WORKSPACE_A, "members", "agent-a"), {
        role: "supervisor",
      }),
    );
    await assertFails(
      setDoc(doc(db, "workspaces", WORKSPACE_A, "members", "attacker"), {
        id: "attacker",
        uid: "attacker",
        workspaceId: WORKSPACE_A,
        role: "tenant_admin",
        status: "active",
        teamIds: [],
        locationIds: [],
      }),
    );
  });

  it("keeps audit evidence server-authored and immutable", async () => {
    const db = testEnvironment.authenticatedContext("agent-a").firestore();

    await assertSucceeds(
      getDoc(doc(db, "workspaces", WORKSPACE_A, "auditEvents", "audit-1")),
    );
    await assertFails(
      setDoc(doc(db, "workspaces", WORKSPACE_A, "auditEvents", "forged-audit"), {
        id: "forged-audit",
        workspaceId: WORKSPACE_A,
        actorUid: "agent-a",
        action: "role.approved",
        requestId: "forged",
        metadata: {},
        createdAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(db, "workspaces", WORKSPACE_A, "auditEvents", "audit-1"), {
        action: "role.approved",
      }),
    );
    await assertFails(
      deleteDoc(doc(db, "workspaces", WORKSPACE_A, "auditEvents", "audit-1")),
    );
  });

  it("requires the full v1 audit schema for admin, privacy and own-actor exact gets", async () => {
    const missingField = syntheticAuditEventV1("audit-missing", WORKSPACE_A);
    delete missingField.resourceType;
    const otherTime = Timestamp.fromMillis(now().toMillis() + 1);
    const invalidRecords = [
      syntheticAuditEventV1("audit-extra", WORKSPACE_A, { extra: true }),
      missingField,
      syntheticAuditEventV1("audit-time-type", WORKSPACE_A, {
        occurredAt: "2026-08-07T00:00:00.000Z",
        createdAt: "2026-08-07T00:00:00.000Z",
      }),
      syntheticAuditEventV1("audit-time-mismatch", WORKSPACE_A, {
        createdAt: otherTime,
      }),
      syntheticAuditEventV1("audit-schema", WORKSPACE_A, { schemaVersion: 2 }),
      syntheticAuditEventV1("audit-synthetic", WORKSPACE_A, { synthetic: false }),
      syntheticAuditEventV1("audit-action-namespace", WORKSPACE_A, {
        action: "conversation_viewed",
      }),
      syntheticAuditEventV1("audit-action-oversized", WORKSPACE_A, {
        action: `a.${"b".repeat(159)}`,
      }),
      syntheticAuditEventV1("audit-payload-tenant", WORKSPACE_B),
    ];

    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all(
        invalidRecords.map((record) =>
          setDoc(
            doc(db, "workspaces", WORKSPACE_A, "auditEvents", String(record.id)),
            record,
          ),
        ),
      );
    });

    for (const uid of ["admin-a", "privacy-a", "agent-a"]) {
      const db = testEnvironment.authenticatedContext(uid).firestore();
      for (const record of invalidRecords) {
        await assertFails(
          getDoc(
            doc(db, "workspaces", WORKSPACE_A, "auditEvents", String(record.id)),
          ),
        );
      }
    }
  });

  it("accepts the 160-character namespaced action boundary and rejects wrong actors", async () => {
    const boundaryId = "audit-action-boundary";
    const wrongActorId = "audit-wrong-actor";
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(
          doc(db, "workspaces", WORKSPACE_A, "auditEvents", boundaryId),
          syntheticAuditEventV1(boundaryId, WORKSPACE_A, {
            action: `a.${"b".repeat(158)}`,
          }),
        ),
        setDoc(
          doc(db, "workspaces", WORKSPACE_A, "auditEvents", wrongActorId),
          syntheticAuditEventV1(wrongActorId, WORKSPACE_A, {
            actorUid: "supervisor-a",
          }),
        ),
        setDoc(
          doc(db, "workspaces", WORKSPACE_B, "auditEvents", "audit-tenant-b"),
          syntheticAuditEventV1("audit-tenant-b", WORKSPACE_B),
        ),
      ]);
    });

    const agent = testEnvironment.authenticatedContext("agent-a").firestore();
    const supervisor = testEnvironment.authenticatedContext("supervisor-a").firestore();
    const admin = testEnvironment.authenticatedContext("admin-a").firestore();
    const privacy = testEnvironment.authenticatedContext("privacy-a").firestore();
    await assertSucceeds(
      getDoc(doc(agent, "workspaces", WORKSPACE_A, "auditEvents", boundaryId)),
    );
    await assertFails(
      getDoc(doc(agent, "workspaces", WORKSPACE_A, "auditEvents", wrongActorId)),
    );
    await assertFails(
      getDoc(doc(supervisor, "workspaces", WORKSPACE_A, "auditEvents", boundaryId)),
    );
    await assertSucceeds(
      getDoc(doc(admin, "workspaces", WORKSPACE_A, "auditEvents", wrongActorId)),
    );
    await assertSucceeds(
      getDoc(doc(privacy, "workspaces", WORKSPACE_A, "auditEvents", wrongActorId)),
    );
    for (const db of [agent, admin, privacy]) {
      await assertFails(
        getDoc(doc(db, "workspaces", WORKSPACE_B, "auditEvents", "audit-tenant-b")),
      );
    }
  });

  it("denies every audit list and direct write for actor and governance roles", async () => {
    for (const uid of ["agent-a", "admin-a", "privacy-a"]) {
      const db = testEnvironment.authenticatedContext(uid).firestore();
      await assertFails(
        getDocs(
          query(
            collection(db, "workspaces", WORKSPACE_A, "auditEvents"),
            limit(10),
          ),
        ),
      );
      await assertFails(
        setDoc(
          doc(db, "workspaces", WORKSPACE_A, "auditEvents", `audit-forged-${uid}`),
          syntheticAuditEventV1(`audit-forged-${uid}`, WORKSPACE_A, { actorUid: uid }),
        ),
      );
      await assertFails(
        updateDoc(doc(db, "workspaces", WORKSPACE_A, "auditEvents", "audit-1"), {
          outcome: "failed",
        }),
      );
      await assertFails(
        deleteDoc(doc(db, "workspaces", WORKSPACE_A, "auditEvents", "audit-1")),
      );
    }
  });
});

describe("governed campaign aggregate persistence", () => {
  it("allows only the four governance roles to read bounded aggregate data", async () => {
    for (const uid of ["admin-a", "operator-a", "approver-a", "analyst-a"]) {
      const db = testEnvironment.authenticatedContext(uid).firestore();
      await assertSucceeds(
        getDoc(doc(db, "workspaces", WORKSPACE_A, "campaigns", "campaign-governed")),
      );
      await assertSucceeds(
        getDoc(
          doc(db, "workspaces", WORKSPACE_A, "audienceSnapshots", "audience-governed"),
        ),
      );
      const [campaigns, snapshots, events, checkpoints] = await Promise.all([
        listCampaigns(asModularFirestore(db), { workspaceId: WORKSPACE_A, pageSize: 100 }),
        listAudienceSnapshots(asModularFirestore(db), {
          workspaceId: WORKSPACE_A,
          campaignId: "campaign-governed",
          pageSize: 100,
        }),
        listCampaignEvents(asModularFirestore(db), {
          workspaceId: WORKSPACE_A,
          campaignId: "campaign-governed",
          pageSize: 100,
        }),
        listCampaignCheckpoints(asModularFirestore(db), {
          workspaceId: WORKSPACE_A,
          campaignId: "campaign-governed",
          pageSize: 100,
        }),
      ]);
      expect(campaigns.map((record) => record.id)).toEqual(["campaign-governed"]);
      expect(snapshots.map((record) => record.id)).toEqual(["audience-governed"]);
      expect(events).toEqual([]);
      expect(checkpoints).toEqual([]);
    }

    for (const uid of ["agent-a", "supervisor-a", "privacy-a", "revoked-operator-a"]) {
      const db = testEnvironment.authenticatedContext(uid).firestore();
      await assertFails(
        getDoc(doc(db, "workspaces", WORKSPACE_A, "campaigns", "campaign-governed")),
      );
      await assertFails(
        getDocs(
          query(
            collection(db, "workspaces", WORKSPACE_A, "campaigns"),
            orderBy("updatedAt", "desc"),
            limit(100),
          ),
        ),
      );
    }
  });

  it("denies public, unbounded, oversized and cross-tenant aggregate reads", async () => {
    const publicDb = testEnvironment.unauthenticatedContext().firestore();
    const operatorDb = testEnvironment.authenticatedContext("operator-a").firestore();
    await assertFails(
      getDoc(
        doc(publicDb, "workspaces", WORKSPACE_A, "campaigns", "campaign-governed"),
      ),
    );
    await assertFails(
      getDocs(collection(operatorDb, "workspaces", WORKSPACE_A, "campaigns")),
    );
    await assertFails(
      getDocs(
        query(
          collection(operatorDb, "workspaces", WORKSPACE_A, "campaigns"),
          orderBy("updatedAt", "desc"),
          limit(101),
        ),
      ),
    );

    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await Promise.all([
        setDoc(
          doc(context.firestore(), "workspaces", WORKSPACE_B, "campaigns", "campaign-b"),
          governedCampaign("campaign-b", WORKSPACE_B, {
            audienceSnapshotId: "audience-b",
          }),
        ),
        setDoc(
          doc(
            context.firestore(),
            "workspaces",
            WORKSPACE_B,
            "audienceSnapshots",
            "audience-b",
          ),
          governedAudienceSnapshot("audience-b", "campaign-b", WORKSPACE_B),
        ),
      ]);
    });
    await assertFails(
      getDoc(doc(operatorDb, "workspaces", WORKSPACE_B, "campaigns", "campaign-b")),
    );
  });

  it("denies every client mutation of campaigns, snapshots, events and checkpoints", async () => {
    const eventId = "campaign-event-advance-001";
    const checkpointId = "campaign-governed:checkpoint:000000";
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await Promise.all([
        setDoc(
          doc(context.firestore(), "workspaces", WORKSPACE_A, "campaignEvents", eventId),
          governedCampaignEvent(eventId, "campaign-governed"),
        ),
        setDoc(
          doc(
            context.firestore(),
            "workspaces",
            WORKSPACE_A,
            "campaignCheckpoints",
            checkpointId,
          ),
          governedCampaignCheckpoint("campaign-governed", eventId),
        ),
      ]);
    });

    for (const uid of ["admin-a", "operator-a", "approver-a", "analyst-a"]) {
      const db = testEnvironment.authenticatedContext(uid).firestore();
      const campaignRef = doc(
        db,
        "workspaces",
        WORKSPACE_A,
        "campaigns",
        "campaign-governed",
      );
      const snapshotRef = doc(
        db,
        "workspaces",
        WORKSPACE_A,
        "audienceSnapshots",
        "audience-governed",
      );
      const eventRef = doc(db, "workspaces", WORKSPACE_A, "campaignEvents", eventId);
      const checkpointRef = doc(
        db,
        "workspaces",
        WORKSPACE_A,
        "campaignCheckpoints",
        checkpointId,
      );
      await assertFails(
        setDoc(
          doc(db, "workspaces", WORKSPACE_A, "campaigns", `forged-${uid}`),
          governedCampaign(`forged-${uid}`),
        ),
      );
      await assertFails(updateDoc(campaignRef, { state: "dispatching" }));
      await assertFails(deleteDoc(campaignRef));
      await assertFails(updateDoc(snapshotRef, { eligibleCount: 50_000 }));
      await assertFails(deleteDoc(snapshotRef));
      await assertFails(updateDoc(eventRef, { revision: 4 }));
      await assertFails(deleteDoc(eventRef));
      await assertFails(updateDoc(checkpointRef, { processedEligible: 2_000 }));
      await assertFails(deleteDoc(checkpointRef));
    }
  });

  it("reads strict immutable events and half-open checkpoints through the repository", async () => {
    const eventId = "campaign-event-advance-001";
    const checkpointId = "campaign-governed:checkpoint:000000";
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await Promise.all([
        setDoc(
          doc(context.firestore(), "workspaces", WORKSPACE_A, "campaignEvents", eventId),
          governedCampaignEvent(eventId, "campaign-governed"),
        ),
        setDoc(
          doc(
            context.firestore(),
            "workspaces",
            WORKSPACE_A,
            "campaignCheckpoints",
            checkpointId,
          ),
          governedCampaignCheckpoint("campaign-governed", eventId),
        ),
      ]);
    });
    const db = testEnvironment.authenticatedContext("approver-a").firestore();
    await assertSucceeds(
      getDoc(doc(db, "workspaces", WORKSPACE_A, "campaignEvents", eventId)),
    );
    await assertSucceeds(
      getDoc(doc(db, "workspaces", WORKSPACE_A, "campaignCheckpoints", checkpointId)),
    );
    const [exactEvent, events, checkpoints] = await Promise.all([
      getCampaignEvent(asModularFirestore(db), {
        workspaceId: WORKSPACE_A,
        campaignId: "campaign-governed",
        eventId,
      }),
      listCampaignEvents(asModularFirestore(db), {
        workspaceId: WORKSPACE_A,
        campaignId: "campaign-governed",
        pageSize: 100,
      }),
      listCampaignCheckpoints(asModularFirestore(db), {
        workspaceId: WORKSPACE_A,
        campaignId: "campaign-governed",
        pageSize: 100,
      }),
    ]);
    expect(exactEvent).toMatchObject({ id: eventId, campaignId: "campaign-governed" });
    expect(events).toHaveLength(1);
    expect(checkpoints).toEqual([
      expect.objectContaining({
        id: checkpointId,
        sourceOffsetStart: 0,
        sourceOffsetEnd: 1_310,
        eligibleCount: 1_000,
        processedEligible: 1_000,
      }),
    ]);
    await expect(
      getCampaignEvent(asModularFirestore(db), {
        workspaceId: WORKSPACE_A,
        campaignId: "campaign-substituted",
        eventId,
      }),
    ).rejects.toMatchObject({ code: "invalid_persisted_data" });
  });

  it("pages campaign events by authoritative revision rather than timestamps", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(
          doc(db, "workspaces", WORKSPACE_A, "campaignEvents", "campaign-event-rev-4"),
          governedCampaignEvent("campaign-event-rev-4", "campaign-governed", WORKSPACE_A, {
            action: "pause",
            fromState: "dispatching",
            toState: "paused",
            revision: 4,
            checkpointId: null,
            createdAt: Timestamp.fromMillis(1_800_000_100_000),
          }),
        ),
        setDoc(
          doc(db, "workspaces", WORKSPACE_A, "campaignEvents", "campaign-event-rev-5"),
          governedCampaignEvent("campaign-event-rev-5", "campaign-governed", WORKSPACE_A, {
            action: "resume",
            fromState: "paused",
            toState: "dispatching",
            revision: 5,
            checkpointId: null,
            createdAt: Timestamp.fromMillis(1_800_000_000_000),
          }),
        ),
      ]);
    });
    const events = await listCampaignEvents(
      asModularFirestore(testEnvironment.authenticatedContext("analyst-a").firestore()),
      {
        workspaceId: WORKSPACE_A,
        campaignId: "campaign-governed",
        pageSize: 2,
      },
    );
    expect(events.map((event) => event.revision)).toEqual([5, 4]);
  });

  it("fails closed on schema pollution, count corruption and identity substitution", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(
          doc(db, "workspaces", WORKSPACE_A, "campaigns", "campaign-polluted"),
          governedCampaign("campaign-polluted", WORKSPACE_A, { recipients: ["patient-1"] }),
        ),
        setDoc(
          doc(db, "workspaces", WORKSPACE_A, "campaigns", "campaign-substituted"),
          governedCampaign("different-campaign-id"),
        ),
        setDoc(
          doc(db, "workspaces", WORKSPACE_A, "campaigns", "campaign-progress-corrupt"),
          governedCampaign("campaign-progress-corrupt", WORKSPACE_A, {
            state: "dispatching",
            revision: 3,
            canaryStatus: "passed_simulation",
            processedEligible: 1_000,
            scanOffset: 1_310,
            nextBatchIndex: 1,
            lastCheckpointId: "campaign-progress-corrupt:checkpoint:000001",
          }),
        ),
        setDoc(
          doc(db, "workspaces", WORKSPACE_A, "audienceSnapshots", "audience-corrupt"),
          governedAudienceSnapshot("audience-corrupt", "campaign-governed", WORKSPACE_A, {
            eligibleCount: 38_442,
          }),
        ),
        setDoc(
          doc(db, "workspaces", WORKSPACE_A, "campaignEvents", "event-corrupt"),
          governedCampaignEvent("event-corrupt", "campaign-governed", WORKSPACE_A, {
            checkpointId: "campaign-other:checkpoint:000000",
          }),
        ),
        setDoc(
          doc(
            db,
            "workspaces",
            WORKSPACE_A,
            "campaignCheckpoints",
            "campaign-governed:checkpoint:000001",
          ),
          governedCampaignCheckpoint("campaign-governed", "event-corrupt", WORKSPACE_A, {
            id: "campaign-governed:checkpoint:000001",
          }),
        ),
      ]);
    });
    const db = testEnvironment.authenticatedContext("admin-a").firestore();
    await assertFails(
      getDoc(doc(db, "workspaces", WORKSPACE_A, "campaigns", "campaign-polluted")),
    );
    await assertFails(
      getDoc(doc(db, "workspaces", WORKSPACE_A, "campaigns", "campaign-substituted")),
    );
    await assertSucceeds(
      getDoc(doc(db, "workspaces", WORKSPACE_A, "campaigns", "campaign-progress-corrupt")),
    );
    await expect(
      getCampaign(asModularFirestore(db), {
        workspaceId: WORKSPACE_A,
        campaignId: "campaign-progress-corrupt",
      }),
    ).rejects.toMatchObject({ code: "invalid_persisted_data" });
    await assertFails(
      getDoc(
        doc(db, "workspaces", WORKSPACE_A, "audienceSnapshots", "audience-corrupt"),
      ),
    );
    await assertFails(
      getDoc(doc(db, "workspaces", WORKSPACE_A, "campaignEvents", "event-corrupt")),
    );
    await assertFails(
      getDoc(
        doc(
          db,
          "workspaces",
          WORKSPACE_A,
          "campaignCheckpoints",
          "campaign-governed:checkpoint:000001",
        ),
      ),
    );
    await expect(
      listCampaigns(asModularFirestore(db), { workspaceId: WORKSPACE_A, pageSize: 100 }),
    ).rejects.toMatchObject({ code: "invalid_persisted_data" });
    await expect(
      listAudienceSnapshots(asModularFirestore(db), {
        workspaceId: WORKSPACE_A,
        campaignId: "campaign-governed",
        pageSize: 100,
      }),
    ).rejects.toMatchObject({ code: "invalid_persisted_data" });
  });

  it("keeps campaign recipients entirely backend-owned and unseeded", async () => {
    const db = testEnvironment.authenticatedContext("admin-a").firestore();
    const recipientRef = doc(
      db,
      "workspaces",
      WORKSPACE_A,
      "campaignRecipients",
      "recipient-1",
    );
    await assertFails(getDoc(recipientRef));
    await assertFails(
      getDocs(
        query(
          collection(db, "workspaces", WORKSPACE_A, "campaignRecipients"),
          limit(100),
        ),
      ),
    );
    await assertFails(setDoc(recipientRef, { campaignId: "campaign-governed" }));
    await assertFails(updateDoc(recipientRef, { status: "sent" }));
    await assertFails(deleteDoc(recipientRef));
  });
});

describe("synthetic contact preference and tag transactions", () => {
  it("updates through the typed repository and rejects a stale optimistic revision", async () => {
    const db = testEnvironment.authenticatedContext("admin-a").firestore();

    const result = await updateSyntheticContactPreferences(asModularFirestore(db), {
      workspaceId: WORKSPACE_A,
      contactId: "contact-allowed",
      preferredLanguage: "ta",
      alternateLanguages: ["en"],
      tags: ["appointment", "human-handoff"],
      expectedPreferenceRevision: 0,
    });

    expect(result).toMatchObject({
      contactId: "contact-allowed",
      preferredLanguage: "ta",
      preferenceRevision: 1,
    });
    expect(
      (
        await getDoc(
          doc(db, "workspaces", WORKSPACE_A, "contacts", "contact-allowed"),
        )
      ).data(),
    ).toMatchObject({
      preferredLanguage: "ta",
      alternateLanguages: ["en"],
      tags: ["appointment", "human-handoff"],
      preferenceRevision: 1,
    });

    await expect(
      updateSyntheticContactPreferences(asModularFirestore(db), {
        workspaceId: WORKSPACE_A,
        contactId: "contact-allowed",
        preferredLanguage: "si",
        alternateLanguages: [],
        tags: ["appointment"],
        expectedPreferenceRevision: 0,
      }),
    ).rejects.toMatchObject({
      code: "contact_preference_conflict",
    });
  });

  it("denies contact creation/deletion and roles without contacts.manage authority", async () => {
    const agentDb = testEnvironment.authenticatedContext("agent-a").firestore();
    const operatorDb = testEnvironment.authenticatedContext("operator-a").firestore();
    const contactRef = doc(
      agentDb,
      "workspaces",
      WORKSPACE_A,
      "contacts",
      "contact-allowed",
    );

    for (const db of [agentDb, operatorDb]) {
      await assertFails(
        updateDoc(doc(db, "workspaces", WORKSPACE_A, "contacts", "contact-allowed"), {
          preferredLanguage: "ta",
          preferenceRevision: 1,
          updatedAt: serverTimestamp(),
        }),
      );
    }
    await assertFails(
      setDoc(
        doc(agentDb, "workspaces", WORKSPACE_A, "contacts", "forged-contact"),
        syntheticContact("forged-contact", WORKSPACE_A),
      ),
    );
    await assertFails(deleteDoc(contactRef));
  });

  it("denies immutable-field changes, revision bypasses, and timestamp manipulation", async () => {
    const db = testEnvironment.authenticatedContext("admin-a").firestore();
    const contactRef = doc(db, "workspaces", WORKSPACE_A, "contacts", "contact-allowed");

    await assertFails(
      updateDoc(contactRef, {
        teamId: "laboratory",
        preferenceRevision: 1,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(contactRef, {
        suppression: {
          suppressAll: true,
          suppressMarketing: true,
          invalidContact: false,
          reasons: ["manual_withdrawal"],
          updatedAt: serverTimestamp(),
        },
        preferenceRevision: 1,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(contactRef, {
        preferredLanguage: "ta",
        preferenceRevision: 2,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(contactRef, {
        preferredLanguage: "ta",
        preferenceRevision: 1,
        updatedAt: now(),
      }),
    );
  });

  it("runs a full strict validator on update and denies schema/type/list pollution", async () => {
    const db = testEnvironment.authenticatedContext("admin-a").firestore();
    const contactRef = doc(db, "workspaces", WORKSPACE_A, "contacts", "contact-allowed");

    await assertFails(
      updateDoc(contactRef, {
        extraData: "malicious",
        preferenceRevision: 1,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(contactRef, {
        phoneLookupHmac: "b".repeat(64),
        preferenceRevision: 1,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(contactRef, {
        preferredLanguage: 42,
        preferenceRevision: 1,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(contactRef, {
        alternateLanguages: ["en", "en"],
        preferenceRevision: 1,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(contactRef, {
        tags: [
          "appointment",
          "laboratory",
          "package",
          "human-handoff",
          "urgent-simulation",
          "marketing-suppressed",
          "oversized-seventh-tag",
        ],
        preferenceRevision: 1,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(contactRef, {
        tags: ["x".repeat(500_000)],
        preferenceRevision: 1,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(contactRef, {
        alternateLanguages: deleteField(),
        preferenceRevision: 1,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("denies non-synthetic records, non-demo workspaces, and cross-tenant updates", async () => {
    const db = testEnvironment.authenticatedContext("admin-a").firestore();

    await assertFails(
      updateDoc(
        doc(db, "workspaces", WORKSPACE_A, "contacts", "contact-not-synthetic"),
        {
          preferredLanguage: "ta",
          preferenceRevision: 1,
          updatedAt: serverTimestamp(),
        },
      ),
    );
    await assertFails(
      updateDoc(doc(db, "workspaces", WORKSPACE_UAT, "contacts", "contact-uat"), {
        preferredLanguage: "ta",
        preferenceRevision: 1,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(db, "workspaces", WORKSPACE_B, "contacts", "contact-b"), {
        preferredLanguage: "ta",
        preferenceRevision: 1,
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

describe("backend-only synthetic internal conversation notes", () => {
  it("lists a backend-seeded scoped note through the typed read repository", async () => {
    const db = testEnvironment.authenticatedContext("agent-a").firestore();
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "workspaces", WORKSPACE_A, "internalNotes", "note-repository-1"),
        { ...syntheticNote("note-repository-1"), createdAt: now() },
      );
    });

    const notes = await listSyntheticInternalNotes(asModularFirestore(db), {
      workspaceId: WORKSPACE_A,
      conversationId: "conversation-1",
      teamId: "outpatient",
      locationId: "wattala",
      pageSize: 25,
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      id: "note-repository-1",
      authorUid: "agent-a",
    });
  });

  it("denies direct client creation, overwrite, update and delete", async () => {
    const db = testEnvironment.authenticatedContext("agent-a").firestore();
    const noteRef = doc(db, "workspaces", WORKSPACE_A, "internalNotes", "note-1");

    await assertFails(setDoc(noteRef, syntheticNote("note-1")));
    await assertFails(
      setDoc(noteRef, syntheticNote("note-1", { noteKind: "appointment_context" })),
    );
    await assertFails(updateDoc(noteRef, { noteKind: "safety_context" }));
    await assertFails(deleteDoc(noteRef));
  });

  it("denies author spoofing, cross-scope and cross-tenant note creation", async () => {
    const db = testEnvironment.authenticatedContext("agent-a").firestore();

    await assertFails(
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "internalNotes", "note-spoof"),
        syntheticNote("note-spoof", { authorUid: "admin-a" }),
      ),
    );
    await assertFails(
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "internalNotes", "note-scope"),
        syntheticNote("note-scope", {
          teamId: "laboratory",
          locationId: "thalawathugoda",
        }),
      ),
    );
    await assertFails(
      setDoc(
        doc(db, "workspaces", WORKSPACE_B, "internalNotes", "note-cross-tenant"),
        syntheticNote("note-cross-tenant", {
          workspaceId: WORKSPACE_B,
          bodyRef: `protected://workspaces/${WORKSPACE_B}/internal-notes/note-cross-tenant`,
        }),
      ),
    );
  });

  it("denies roles without inbox note authority and empty patient scope", async () => {
    const operatorDb = testEnvironment.authenticatedContext("operator-a").firestore();
    const emptyScopeDb = testEnvironment.authenticatedContext("empty-scope-a").firestore();

    await assertFails(
      setDoc(
        doc(operatorDb, "workspaces", WORKSPACE_A, "internalNotes", "note-operator"),
        syntheticNote("note-operator", { authorUid: "operator-a" }),
      ),
    );
    await assertFails(
      setDoc(
        doc(emptyScopeDb, "workspaces", WORKSPACE_A, "internalNotes", "note-empty"),
        syntheticNote("note-empty", { authorUid: "empty-scope-a" }),
      ),
    );
  });

  it("denies schema pollution, invalid note kinds, path traversal and oversized references", async () => {
    const db = testEnvironment.authenticatedContext("agent-a").firestore();

    await assertFails(
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "internalNotes", "note-extra"),
        syntheticNote("note-extra", { messageBody: "must never be accepted" }),
      ),
    );
    await assertFails(
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "internalNotes", "note-type"),
        syntheticNote("note-type", { noteKind: "clinical_advice" }),
      ),
    );
    await assertFails(
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "internalNotes", "note-path"),
        syntheticNote("note-path", {
          bodyRef: "protected://workspaces/workspace-b/internalNotes/escape",
        }),
      ),
    );
    await assertFails(
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "internalNotes", "note-large"),
        syntheticNote("note-large", { bodyRef: `protected://${"x".repeat(401)}` }),
      ),
    );
    await assertFails(
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "internalNotes", "note-huge"),
        syntheticNote("note-huge", { bodyRef: `protected://${"x".repeat(500_000)}` }),
      ),
    );
  });

  it("denies non-synthetic conversations and UAT-classified workspace writes", async () => {
    const db = testEnvironment.authenticatedContext("admin-a").firestore();

    await assertFails(
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "internalNotes", "note-non-synthetic"),
        syntheticNote("note-non-synthetic", {
          conversationId: "conversation-not-synthetic",
          authorUid: "admin-a",
          teamId: "synthetic-hold",
          locationId: "synthetic-hold",
        }),
      ),
    );
    await assertFails(
      setDoc(
        doc(db, "workspaces", WORKSPACE_UAT, "internalNotes", "note-uat"),
        syntheticNote("note-uat", {
          workspaceId: WORKSPACE_UAT,
          conversationId: "conversation-uat",
          authorUid: "admin-a",
          bodyRef: `protected://workspaces/${WORKSPACE_UAT}/internal-notes/note-uat`,
        }),
      ),
    );
  });

  it("allows only bounded note queries that prove an agent's exact scope", async () => {
    const db = testEnvironment.authenticatedContext("agent-a").firestore();
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "workspaces", WORKSPACE_A, "internalNotes", "note-seeded"),
        {
          ...syntheticNote("note-seeded"),
          createdAt: now(),
        },
      );
    });
    const notes = collection(db, "workspaces", WORKSPACE_A, "internalNotes");

    await assertSucceeds(
      getDocs(
        query(
          notes,
          where("conversationId", "==", "conversation-1"),
          where("teamId", "==", "outpatient"),
          where("locationId", "==", "wattala"),
          where("synthetic", "==", true),
          limit(50),
        ),
      ),
    );
    await assertFails(getDocs(query(notes, limit(50))));
    await assertFails(
      getDocs(
        query(
          notes,
          where("teamId", "==", "laboratory"),
          where("locationId", "==", "thalawathugoda"),
          where("synthetic", "==", true),
          limit(50),
        ),
      ),
    );
    await assertFails(getDocs(notes));
  });
});

describe("synthetic appointment and laboratory persistence", () => {
  it("keeps one-to-one laboratory secret records server-only for every client", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      const [report, reportSecret, event, eventSecret] = await Promise.all([
        getDoc(doc(admin, "workspaces", WORKSPACE_A, "labReports", "lab-report-1")),
        getDoc(
          doc(admin, "workspaces", WORKSPACE_A, "labReportSecrets", "lab-report-1"),
        ),
        getDoc(
          doc(
            admin,
            "workspaces",
            WORKSPACE_A,
            "labReportEvents",
            "lab-report-event-seed",
          ),
        ),
        getDoc(
          doc(
            admin,
            "workspaces",
            WORKSPACE_A,
            "labReportEventSecrets",
            "lab-report-event-seed",
          ),
        ),
      ]);

      expect(report.exists()).toBe(true);
      expect(reportSecret.exists()).toBe(true);
      expect(event.exists()).toBe(true);
      expect(eventSecret.exists()).toBe(true);
      expect(report.data()).not.toHaveProperty("externalReportRef");
      expect(report.data()).not.toHaveProperty("notificationIdempotencyFingerprint");
      expect(report.data()?.secureAccess).not.toHaveProperty("handoffRef");
      expect(event.data()).not.toHaveProperty("idempotencyFingerprint");
      expect(reportSecret.data()).toMatchObject({
        id: "lab-report-1",
        workspaceId: WORKSPACE_A,
        labReportId: "lab-report-1",
        synthetic: true,
        schemaVersion: 1,
      });
      expect(eventSecret.data()).toMatchObject({
        id: "lab-report-event-seed",
        workspaceId: WORKSPACE_A,
        labReportEventId: "lab-report-event-seed",
        labReportId: "lab-report-1",
        synthetic: true,
        schemaVersion: 1,
      });
    });

    const contexts = [
      testEnvironment.unauthenticatedContext().firestore(),
      testEnvironment.authenticatedContext("agent-a").firestore(),
      testEnvironment.authenticatedContext("admin-a").firestore(),
    ];
    for (const db of contexts) {
      await assertFails(
        getDoc(doc(db, "workspaces", WORKSPACE_A, "labReportSecrets", "lab-report-1")),
      );
      await assertFails(
        getDocs(
          query(
            collection(db, "workspaces", WORKSPACE_A, "labReportSecrets"),
            limit(100),
          ),
        ),
      );
      await assertFails(
        getDoc(
          doc(
            db,
            "workspaces",
            WORKSPACE_A,
            "labReportEventSecrets",
            "lab-report-event-seed",
          ),
        ),
      );
      await assertFails(
        getDocs(
          query(
            collection(db, "workspaces", WORKSPACE_A, "labReportEventSecrets"),
            limit(100),
          ),
        ),
      );
    }

    const adminDb = testEnvironment.authenticatedContext("admin-a").firestore();
    const reportSecretRef = doc(
      adminDb,
      "workspaces",
      WORKSPACE_A,
      "labReportSecrets",
      "lab-report-1",
    );
    const eventSecretRef = doc(
      adminDb,
      "workspaces",
      WORKSPACE_A,
      "labReportEventSecrets",
      "lab-report-event-seed",
    );
    await assertFails(
      setDoc(
        doc(
          adminDb,
          "workspaces",
          WORKSPACE_A,
          "labReportSecrets",
          "forged-report-secret",
        ),
        syntheticLabReportSecret("forged-report-secret", WORKSPACE_A),
      ),
    );
    await assertFails(updateDoc(reportSecretRef, { externalReportRef: "forged" }));
    await assertFails(deleteDoc(reportSecretRef));
    await assertFails(
      setDoc(
        doc(
          adminDb,
          "workspaces",
          WORKSPACE_A,
          "labReportEventSecrets",
          "forged-event-secret",
        ),
        syntheticLabReportEventSecret("forged-event-secret", WORKSPACE_A),
      ),
    );
    await assertFails(updateDoc(eventSecretRef, { idempotencyFingerprint: "8".repeat(64) }));
    await assertFails(deleteDoc(eventSecretRef));
    await assertFails(
      getDoc(
        doc(
          adminDb,
          "workspaces",
          WORKSPACE_B,
          "labReportSecrets",
          "lab-report-1",
        ),
      ),
    );
  });

  it("fails closed on polluted staff documents and orphan or substituted secrets", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      await Promise.all([
        setDoc(
          doc(admin, "workspaces", WORKSPACE_A, "labReports", "lab-protected-pollution"),
          syntheticLabReport("lab-protected-pollution", WORKSPACE_A, {
            externalReportRef: "must-remain-server-only",
          }),
        ),
        setDoc(
          doc(admin, "workspaces", WORKSPACE_A, "labReports", "lab-id-substitution"),
          syntheticLabReport("different-lab-id", WORKSPACE_A),
        ),
        setDoc(
          doc(admin, "workspaces", WORKSPACE_A, "labReports", "lab-tenant-substitution"),
          syntheticLabReport("lab-tenant-substitution", WORKSPACE_B),
        ),
        setDoc(
          doc(
            admin,
            "workspaces",
            WORKSPACE_A,
            "labReportEvents",
            "event-fingerprint-pollution",
          ),
          syntheticLabReportEvent("event-fingerprint-pollution", WORKSPACE_A, {
            idempotencyFingerprint: "9".repeat(64),
          }),
        ),
        setDoc(
          doc(
            admin,
            "workspaces",
            WORKSPACE_A,
            "labReportEvents",
            "event-id-substitution",
          ),
          syntheticLabReportEvent("different-event-id", WORKSPACE_A),
        ),
        setDoc(
          doc(
            admin,
            "workspaces",
            WORKSPACE_A,
            "labReportSecrets",
            "orphan-secret",
          ),
          syntheticLabReportSecret("substituted-secret-id", WORKSPACE_B, {
            labReportId: "another-report",
          }),
        ),
      ]);
    });

    const adminDb = testEnvironment.authenticatedContext("admin-a").firestore();
    for (const reportId of [
      "lab-protected-pollution",
      "lab-id-substitution",
      "lab-tenant-substitution",
    ]) {
      await assertFails(
        getDoc(doc(adminDb, "workspaces", WORKSPACE_A, "labReports", reportId)),
      );
    }
    for (const eventId of ["event-fingerprint-pollution", "event-id-substitution"]) {
      await assertFails(
        getDoc(
          doc(adminDb, "workspaces", WORKSPACE_A, "labReportEvents", eventId),
        ),
      );
    }
    await expect(
      listScopedLabReports(asModularFirestore(adminDb), {
        workspaceId: WORKSPACE_A,
        pageSize: 100,
      }),
    ).rejects.toMatchObject({ code: "invalid_persisted_data" });
    await expect(
      listLabReportEvents(asModularFirestore(adminDb), {
        workspaceId: WORKSPACE_A,
        subjectId: "lab-report-1",
        teamId: "outpatient",
        locationId: "wattala",
        pageSize: 100,
      }),
    ).rejects.toMatchObject({ code: "invalid_persisted_data" });
    await assertFails(
      getDoc(
        doc(
          adminDb,
          "workspaces",
          WORKSPACE_A,
          "labReportSecrets",
          "orphan-secret",
        ),
      ),
    );
  });

  it("lists only bounded tenant or exact-scope workflow metadata and immutable events", async () => {
    const agentDb = testEnvironment.authenticatedContext("agent-a").firestore();
    const adminDb = testEnvironment.authenticatedContext("admin-a").firestore();

    const [appointments, appointmentEvents, labReports, labEvents] = await Promise.all([
      listScopedAppointments(asModularFirestore(agentDb), {
        workspaceId: WORKSPACE_A,
        teamId: "outpatient",
        locationId: "wattala",
        pageSize: 25,
      }),
      listAppointmentEvents(asModularFirestore(agentDb), {
        workspaceId: WORKSPACE_A,
        subjectId: "appointment-1",
        teamId: "outpatient",
        locationId: "wattala",
        pageSize: 25,
      }),
      listScopedLabReports(asModularFirestore(agentDb), {
        workspaceId: WORKSPACE_A,
        teamId: "outpatient",
        locationId: "wattala",
        pageSize: 25,
      }),
      listLabReportEvents(asModularFirestore(agentDb), {
        workspaceId: WORKSPACE_A,
        subjectId: "lab-report-1",
        teamId: "outpatient",
        locationId: "wattala",
        pageSize: 25,
      }),
    ]);

    expect(appointments.map((item) => item.id)).toEqual(["appointment-1"]);
    expect(appointmentEvents.map((event) => event.id)).toEqual([
      "appointment-event-seed",
    ]);
    expect(labReports.map((item) => item.id)).toEqual(["lab-report-1"]);
    expect(labReports[0]?.secureAccess).not.toHaveProperty("handoffRef");
    expect(labEvents.map((event) => event.id)).toEqual(["lab-report-event-seed"]);

    const adminAppointments = await listScopedAppointments(asModularFirestore(adminDb), {
      workspaceId: WORKSPACE_A,
      pageSize: 100,
    });
    expect(adminAppointments).toHaveLength(2);

    await assertFails(
      getDocs(
        query(
          collection(agentDb, "workspaces", WORKSPACE_A, "appointments"),
          orderBy("slotStartsAt", "asc"),
          limit(25),
        ),
      ),
    );
    await assertFails(
      getDoc(
        doc(
          agentDb,
          "workspaces",
          WORKSPACE_A,
          "labReports",
          "lab-report-other-scope",
        ),
      ),
    );
  });

  it("denies every direct appointment and appointment-event mutation for all client authorities", async () => {
    const clients = [
      {
        label: "tenant-admin",
        uid: "admin-a",
        workspaceId: WORKSPACE_A,
        appointmentId: "appointment-1",
        eventId: "appointment-event-seed",
      },
      {
        label: "supervisor",
        uid: "supervisor-a",
        workspaceId: WORKSPACE_A,
        appointmentId: "appointment-1",
        eventId: "appointment-event-seed",
      },
      {
        label: "agent",
        uid: "agent-a",
        workspaceId: WORKSPACE_A,
        appointmentId: "appointment-1",
        eventId: "appointment-event-seed",
      },
      {
        label: "cross-tenant-agent",
        uid: "agent-a",
        workspaceId: WORKSPACE_B,
        appointmentId: "appointment-b",
        eventId: "appointment-event-b",
      },
      {
        label: "revoked-agent",
        uid: "revoked-a",
        workspaceId: WORKSPACE_A,
        appointmentId: "appointment-1",
        eventId: "appointment-event-seed",
      },
    ] as const;

    for (const client of clients) {
      const db = testEnvironment.authenticatedContext(client.uid).firestore();
      const newAppointmentId = `forged-appointment-${client.label}`;
      const newEventId = `forged-appointment-event-${client.label}`;
      const appointmentRef = doc(
        db,
        "workspaces",
        client.workspaceId,
        "appointments",
        client.appointmentId,
      );
      const eventRef = doc(
        db,
        "workspaces",
        client.workspaceId,
        "appointmentEvents",
        client.eventId,
      );

      await assertFails(
        setDoc(
          doc(
            db,
            "workspaces",
            client.workspaceId,
            "appointments",
            newAppointmentId,
          ),
          syntheticAppointment(newAppointmentId, client.workspaceId),
        ),
      );
      await assertFails(
        updateDoc(appointmentRef, {
          status: "reschedule_pending",
          syncState: "pending",
          revision: 1,
          lastActionId: newEventId,
          updatedAt: serverTimestamp(),
        }),
      );
      await assertFails(deleteDoc(appointmentRef));

      await assertFails(
        setDoc(
          doc(
            db,
            "workspaces",
            client.workspaceId,
            "appointmentEvents",
            newEventId,
          ),
          syntheticAppointmentEvent(newEventId, client.workspaceId, {
            appointmentId: client.appointmentId,
            actorUid: client.uid,
            action: "request_reschedule",
            fromStatus: "confirmed",
            toStatus: "reschedule_pending",
            revision: 1,
            source: "authenticated_client",
            createdAt: serverTimestamp(),
          }),
        ),
      );
      await assertFails(updateDoc(eventRef, { toStatus: "cancelled" }));
      await assertFails(deleteDoc(eventRef));
    }
  });

  it("keeps laboratory state and both event histories immutable to every client", async () => {
    const db = testEnvironment.authenticatedContext("admin-a").firestore();
    const labRef = doc(db, "workspaces", WORKSPACE_A, "labReports", "lab-report-1");
    const labEventRef = doc(
      db,
      "workspaces",
      WORKSPACE_A,
      "labReportEvents",
      "lab-report-event-seed",
    );
    const appointmentEventRef = doc(
      db,
      "workspaces",
      WORKSPACE_A,
      "appointmentEvents",
      "appointment-event-seed",
    );

    await assertFails(updateDoc(labRef, { workflowStatus: "accessed" }));
    await assertFails(deleteDoc(labRef));
    await assertFails(
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "labReports", "lab-report-forged"),
        syntheticLabReport("lab-report-forged", WORKSPACE_A, {
          resultValues: ["must not be stored"],
        }),
      ),
    );
    await assertFails(updateDoc(labEventRef, { toStatus: "accessed" }));
    await assertFails(deleteDoc(labEventRef));
    await assertFails(
      setDoc(
        doc(db, "workspaces", WORKSPACE_A, "labReportEvents", "lab-event-forged"),
        syntheticLabReportEvent("lab-event-forged", WORKSPACE_A),
      ),
    );
    await assertFails(updateDoc(appointmentEventRef, { toStatus: "cancelled" }));
    await assertFails(deleteDoc(appointmentEventRef));
  });
});

describe("strict synthetic connection-centre persistence", () => {
  beforeEach(seedConnectionRulesFixtures);

  it("allows the active tenant admin to get the complete strict inventory by its three fixed paths", async () => {
    const db = testEnvironment.authenticatedContext("connections-admin").firestore();
    const [connection, his, lims] = await Promise.all(
      fixedDemoConnectionRefs(asModularFirestore(db)).map((reference) =>
        assertSucceeds(getDoc(reference)),
      ),
    );

    expect(connection.id).toBe(DEMO_CONNECTION_ID);
    expect(his.id).toBe(DEMO_HIS_INTEGRATION_ID);
    expect(lims.id).toBe(DEMO_LIMS_INTEGRATION_ID);
    expect(connection.exists()).toBe(true);
    expect(his.exists()).toBe(true);
    expect(lims.exists()).toBe(true);
  });

  it("lets the active tenant admin observe an honestly missing fixed inventory", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all(
        fixedDemoConnectionRefs(asModularFirestore(db)).map((reference) =>
          deleteDoc(reference),
        ),
      );
      await Promise.all([
        setDoc(
          doc(
            db,
            "workspaces",
            CONNECTION_WORKSPACE,
            "whatsappConnections",
            "connection_unknown",
          ),
          staffSafeDemoWhatsAppConnection(),
        ),
        setDoc(
          doc(
            db,
            "workspaces",
            CONNECTION_WORKSPACE,
            "integrations",
            "integration_unknown",
          ),
          staffSafeDemoIntegration(DEMO_HIS_INTEGRATION_ID),
        ),
      ]);
    });

    const db = testEnvironment.authenticatedContext("connections-admin").firestore();
    const snapshots = await Promise.all(
      fixedDemoConnectionRefs(asModularFirestore(db)).map((reference) =>
        assertSucceeds(getDoc(reference)),
      ),
    );
    expect(snapshots.every((snapshot) => !snapshot.exists())).toBe(true);

    await assertFails(
      getDoc(
        doc(
          db,
          "workspaces",
          CONNECTION_WORKSPACE,
          "whatsappConnections",
          "connection_unknown",
        ),
      ),
    );
    await assertFails(
      getDoc(
        doc(
          db,
          "workspaces",
          CONNECTION_WORKSPACE,
          "integrations",
          "integration_unknown",
        ),
      ),
    );
  });

  it("denies all three fixed gets to public, revoked, cross-tenant and every non-admin role", async () => {
    const databases = [
      testEnvironment.unauthenticatedContext().firestore(),
      testEnvironment.authenticatedContext("connections-revoked-admin").firestore(),
      testEnvironment.authenticatedContext("admin-a").firestore(),
      ...connectionNonAdminRoles.map((role) =>
        testEnvironment
          .authenticatedContext(`connections-${role}`)
          .firestore(),
      ),
    ];

    for (const db of databases) {
      for (const reference of fixedDemoConnectionRefs(asModularFirestore(db))) {
        await assertFails(getDoc(reference));
      }
    }
  });

  it("denies every collection and query list shape to every role including the active admin", async () => {
    const databases = [
      testEnvironment.unauthenticatedContext().firestore(),
      testEnvironment.authenticatedContext("connections-admin").firestore(),
      testEnvironment.authenticatedContext("connections-revoked-admin").firestore(),
      testEnvironment.authenticatedContext("admin-a").firestore(),
      ...connectionNonAdminRoles.map((role) =>
        testEnvironment
          .authenticatedContext(`connections-${role}`)
          .firestore(),
      ),
    ];

    for (const db of databases) {
      for (const collectionName of [
        "whatsappConnections",
        "integrations",
      ] as const) {
        for (const listShape of demoConnectionListShapes(
          asModularFirestore(db),
          collectionName,
        )) {
          await assertFails(getDocs(listShape));
        }
      }
    }
  });

  it("rejects raw-secret pollution, missing fields, state changes and identity substitution", async () => {
    const db = testEnvironment.authenticatedContext("connections-admin").firestore();
    const connectionRef = doc(
      db,
      "workspaces",
      CONNECTION_WORKSPACE,
      "whatsappConnections",
      DEMO_CONNECTION_ID,
    );
    const base = staffSafeDemoWhatsAppConnection();
    const baseSignals = base.signals as Record<string, Record<string, unknown>>;
    const connectionAttacks = [
      { ...base, credentialSecretRef: "projects/demo/secrets/forbidden" },
      { ...base, accessToken: "forbidden" },
      withoutField(base, "networkCallsEnabled"),
      { ...base, id: "connection_substituted" },
      { ...base, workspaceId: WORKSPACE_A },
      { ...base, externalMessagingEnabled: true },
      { ...base, networkCallsEnabled: true },
      {
        ...base,
        signals: {
          ...baseSignals,
          sending: { ...baseSignals.sending, state: "mock" },
        },
      },
      {
        ...base,
        signals: {
          ...baseSignals,
          waba: {
            ...baseSignals.waba,
            lastSuccessfulVerificationAt: now(),
          },
        },
      },
      {
        ...base,
        signals: {
          ...baseSignals,
          waba: {
            ...baseSignals.waba,
            rawProviderState: "forbidden",
          },
        },
      },
      {
        ...base,
        signals: {
          ...baseSignals,
          providerHealth: baseSignals.waba,
        },
      },
      {
        ...base,
        signals: {
          ...baseSignals,
          webhook: {
            ...baseSignals.webhook,
            detailCode: "no_meta_waba",
          },
        },
      },
      {
        ...base,
        createdAt: Timestamp.fromMillis(now().toMillis() + 1),
      },
    ];

    for (const attack of connectionAttacks) {
      await replaceConnectionRulesFixture(
        "whatsappConnections",
        DEMO_CONNECTION_ID,
        attack,
      );
      await assertFails(getDoc(connectionRef));
    }
  });

  it("rejects integration kind, evidence, gate, schema and path substitutions", async () => {
    const db = testEnvironment.authenticatedContext("connections-admin").firestore();
    const integrationRef = doc(
      db,
      "workspaces",
      CONNECTION_WORKSPACE,
      "integrations",
      DEMO_HIS_INTEGRATION_ID,
    );
    const base = staffSafeDemoIntegration(DEMO_HIS_INTEGRATION_ID);
    const baseEvidence = base.evidence as Record<string, unknown>;
    const attacks = [
      { ...base, kind: "laboratory_lims" },
      { ...base, displayName: "Local laboratory LIMS simulator" },
      { ...base, sortKey: "02_lims_simulator" },
      { ...base, id: DEMO_LIMS_INTEGRATION_ID },
      { ...base, workspaceId: WORKSPACE_A },
      { ...base, externalNetworkEnabled: true },
      { ...base, authoritativeSystemWriteEnabled: true },
      { ...base, endpointUrl: "https://provider.invalid" },
      withoutField(base, "credentialState"),
      {
        ...base,
        evidence: {
          ...baseEvidence,
          detailCode: "deterministic_lims_simulator_only",
        },
      },
      {
        ...base,
        evidence: {
          ...baseEvidence,
          source: "local_policy",
        },
      },
      {
        ...base,
        evidence: {
          ...baseEvidence,
          lastSuccessfulVerificationAt: now(),
        },
      },
    ];

    for (const attack of attacks) {
      await replaceConnectionRulesFixture(
        "integrations",
        DEMO_HIS_INTEGRATION_ID,
        attack,
      );
      await assertFails(getDoc(integrationRef));
    }
  });

  it("denies every direct connection and integration mutation", async () => {
    const db = testEnvironment.authenticatedContext("connections-admin").firestore();
    const connectionRef = doc(
      db,
      "workspaces",
      CONNECTION_WORKSPACE,
      "whatsappConnections",
      DEMO_CONNECTION_ID,
    );
    const integrationRef = doc(
      db,
      "workspaces",
      CONNECTION_WORKSPACE,
      "integrations",
      DEMO_HIS_INTEGRATION_ID,
    );

    await assertFails(
      setDoc(
        doc(
          db,
          "workspaces",
          CONNECTION_WORKSPACE,
          "whatsappConnections",
          "connection_forged",
        ),
        staffSafeDemoWhatsAppConnection({ id: "connection_forged" }),
      ),
    );
    await assertFails(updateDoc(connectionRef, { status: "ready" }));
    await assertFails(deleteDoc(connectionRef));
    await assertFails(
      setDoc(
        doc(
          db,
          "workspaces",
          CONNECTION_WORKSPACE,
          "integrations",
          "integration_forged",
        ),
        staffSafeDemoIntegration(DEMO_HIS_INTEGRATION_ID, {
          id: "integration_forged",
        }),
      ),
    );
    await assertFails(updateDoc(integrationRef, { status: "ready" }));
    await assertFails(deleteDoc(integrationRef));
  });

  it("totally denies both secret collections and preserves global route denial", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(
          doc(
            db,
            "workspaces",
            CONNECTION_WORKSPACE,
            "whatsappConnectionSecrets",
            DEMO_CONNECTION_ID,
          ),
          {
            id: DEMO_CONNECTION_ID,
            workspaceId: CONNECTION_WORKSPACE,
            credentialSecretRef: "projects/demo/secrets/fixture",
          },
        ),
        setDoc(
          doc(
            db,
            "workspaces",
            CONNECTION_WORKSPACE,
            "integrationSecrets",
            DEMO_HIS_INTEGRATION_ID,
          ),
          {
            id: DEMO_HIS_INTEGRATION_ID,
            workspaceId: CONNECTION_WORKSPACE,
            endpointSecretRef: "projects/demo/secrets/fixture",
          },
        ),
        setDoc(doc(db, "wabaRoutes", "waba-fixture"), {
          workspaceId: CONNECTION_WORKSPACE,
          connectionId: DEMO_CONNECTION_ID,
        }),
      ]);
    });

    const db = testEnvironment.authenticatedContext("connections-admin").firestore();
    for (const [collectionName, documentId] of [
      ["whatsappConnectionSecrets", DEMO_CONNECTION_ID],
      ["integrationSecrets", DEMO_HIS_INTEGRATION_ID],
    ] as const) {
      const secretRef = doc(
        db,
        "workspaces",
        CONNECTION_WORKSPACE,
        collectionName,
        documentId,
      );
      await assertFails(getDoc(secretRef));
      await assertFails(
        getDocs(
          query(
            collection(db, "workspaces", CONNECTION_WORKSPACE, collectionName),
            limit(1),
          ),
        ),
      );
      await assertFails(
        setDoc(
          doc(
            db,
            "workspaces",
            CONNECTION_WORKSPACE,
            collectionName,
            "forged",
          ),
          { synthetic: true },
        ),
      );
      await assertFails(updateDoc(secretRef, { compromised: true }));
      await assertFails(deleteDoc(secretRef));
    }

    await assertFails(getDoc(doc(db, "phoneRoutes", "provider-phone-id")));
    await assertFails(getDoc(doc(db, "wabaRoutes", "waba-fixture")));
    await assertFails(
      setDoc(doc(db, "phoneRoutes", "forged-phone-route"), {
        workspaceId: CONNECTION_WORKSPACE,
      }),
    );
    await assertFails(
      setDoc(doc(db, "wabaRoutes", "forged-waba-route"), {
        workspaceId: CONNECTION_WORKSPACE,
      }),
    );
  });
});

function aiMember(
  uid: string,
  role: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: uid,
    uid,
    workspaceId: AI_WORKSPACE,
    role,
    status: "active",
    scopeMode: role === "tenant_admin" ? "workspace_wide" : "assigned",
    teamIds:
      role === "supervisor"
        ? ["team_demo_general"]
        : role === "clinical_approver"
          ? ["team_demo_clinical_escalation"]
          : [],
    locationIds:
      role === "supervisor" || role === "clinical_approver"
        ? ["location_demo_wattala"]
        : [],
    mfaSatisfied: true,
    lastAuthenticatedAt: now(),
    ...overrides,
  };
}

async function seedAiGovernanceRulesFixtures(): Promise<void> {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const memberWrites = [
      setDoc(
        doc(db, "workspaces", AI_WORKSPACE, "members", "ai-admin"),
        aiMember("ai-admin", "tenant_admin"),
      ),
      setDoc(
        doc(db, "workspaces", AI_WORKSPACE, "members", "ai-supervisor"),
        aiMember("ai-supervisor", "supervisor"),
      ),
      setDoc(
        doc(db, "workspaces", AI_WORKSPACE, "members", "ai-clinical"),
        aiMember("ai-clinical", "clinical_approver"),
      ),
      setDoc(
        doc(db, "workspaces", AI_WORKSPACE, "members", "ai-privacy"),
        aiMember("ai-privacy", "privacy_reviewer"),
      ),
      setDoc(
        doc(db, "workspaces", AI_WORKSPACE, "members", "ai-revoked-admin"),
        aiMember("ai-revoked-admin", "tenant_admin", { status: "revoked" }),
      ),
      setDoc(
        doc(db, "workspaces", AI_WORKSPACE, "members", "ai-no-mfa-admin"),
        aiMember("ai-no-mfa-admin", "tenant_admin", { mfaSatisfied: false }),
      ),
      setDoc(
        doc(db, "workspaces", AI_WORKSPACE, "members", "ai-assigned-admin"),
        aiMember("ai-assigned-admin", "tenant_admin", { scopeMode: "assigned" }),
      ),
      setDoc(
        doc(db, "workspaces", AI_WORKSPACE, "members", "ai-unscoped-supervisor"),
        aiMember("ai-unscoped-supervisor", "supervisor", { teamIds: [] }),
      ),
      setDoc(
        doc(db, "workspaces", AI_WORKSPACE, "members", "ai-unscoped-clinical"),
        aiMember("ai-unscoped-clinical", "clinical_approver", { locationIds: [] }),
      ),
      setDoc(
        doc(db, "workspaces", AI_WORKSPACE, "members", "ai-wide-privacy"),
        aiMember("ai-wide-privacy", "privacy_reviewer", { scopeMode: "workspace_wide" }),
      ),
      ...[
        "platform_owner",
        "agent",
        "campaign_operator",
        "campaign_approver",
        "analyst",
      ].map((role) =>
        setDoc(
          doc(db, "workspaces", AI_WORKSPACE, "members", `ai-${role}`),
          aiMember(`ai-${role}`, role),
        ),
      ),
    ];

    await Promise.all([
      setDoc(doc(db, "workspaces", AI_WORKSPACE), {
        id: AI_WORKSPACE,
        status: "active",
        name: "SafeNet AI governance synthetic demo",
        mode: "demo",
        dataClassification: "synthetic_only",
      }),
      ...memberWrites,
      ...AI_KNOWLEDGE_DOCUMENT_IDS.map((documentId) =>
        setDoc(
          doc(db, "workspaces", AI_WORKSPACE, "knowledgeDocuments", documentId),
          staffSafeAiKnowledgeDocument(documentId),
        ),
      ),
      ...AI_KNOWLEDGE_SELECTION_IDS.map((selectionId) =>
        setDoc(
          doc(db, "workspaces", AI_WORKSPACE, "knowledgeSelections", selectionId),
          staffSafeAiKnowledgeSelection(selectionId),
        ),
      ),
      ...AI_PERSISTED_SCENARIO_IDS.flatMap((scenarioId) => {
        const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
        return [
          setDoc(
            doc(db, "workspaces", AI_WORKSPACE, "aiRuns", expected.runId),
            staffSafeAiRun(scenarioId),
          ),
          setDoc(
            doc(db, "workspaces", AI_WORKSPACE, "aiRunEvents", expected.eventId),
            staffSafeAiEvent(scenarioId),
          ),
        ];
      }),
      setDoc(
        doc(
          db,
          "workspaces",
          AI_WORKSPACE,
          "knowledgeDocumentSecrets",
          "knowledge_secret_appointments_v3",
        ),
        { protectedContentRef: "demo://ai/protected/fixture" },
      ),
      setDoc(
        doc(db, "workspaces", AI_WORKSPACE, "aiRunSecrets", "ai_run_secret_demo_appointment_v1"),
        { protectedRequestFixtureRef: "demo://ai/protected/request" },
      ),
      setDoc(
        doc(
          db,
          "workspaces",
          AI_WORKSPACE,
          "aiRunEventSecrets",
          "ai_run_event_secret_demo_appointment_v1",
        ),
        { protectedDecisionFixtureRef: "demo://ai/protected/decision" },
      ),
      setDoc(
        doc(db, "workspaces", AI_WORKSPACE, "idempotencyKeys", "ai_run_receipt_demo_appointment_v1"),
        { operation: "ai.retrospective_evaluation_recorded" },
      ),
      setDoc(
        doc(db, "workspaces", AI_WORKSPACE, "handoffSessions", "handoff-forbidden"),
        { id: "handoff-forbidden", workspaceId: AI_WORKSPACE },
      ),
    ]);
  });
}

function fixedAiStaffRefs(db: Firestore) {
  return [
    ...AI_KNOWLEDGE_DOCUMENT_IDS.map((documentId) =>
      doc(db, "workspaces", AI_WORKSPACE, "knowledgeDocuments", documentId),
    ),
    ...AI_KNOWLEDGE_SELECTION_IDS.map((selectionId) =>
      doc(db, "workspaces", AI_WORKSPACE, "knowledgeSelections", selectionId),
    ),
    ...AI_PERSISTED_SCENARIO_IDS.flatMap((scenarioId) => {
      const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
      return [
        doc(db, "workspaces", AI_WORKSPACE, "aiRuns", expected.runId),
        doc(db, "workspaces", AI_WORKSPACE, "aiRunEvents", expected.eventId),
      ];
    }),
  ];
}

async function replaceAiFixture(
  collectionName: "knowledgeDocuments" | "knowledgeSelections" | "aiRuns" | "aiRunEvents",
  documentId: string,
  value: Record<string, unknown>,
): Promise<void> {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), "workspaces", AI_WORKSPACE, collectionName, documentId),
      value,
    );
  });
}

describe("fixed-path AI and knowledge governance persistence", () => {
  beforeEach(seedAiGovernanceRulesFixtures);

  it("keeps the maximum valid tenant-admin fixed-get inventory within the Rules budget", async () => {
    const db = asModularFirestore(
      testEnvironment.authenticatedContext("ai-admin").firestore(),
    );
    const snapshots = await Promise.all(
      fixedAiStaffRefs(db).map((reference) => assertSucceeds(getDoc(reference))),
    );
    expect(snapshots).toHaveLength(16);
    expect(snapshots.every((snapshot) => snapshot.exists())).toBe(true);
  });

  it("allows authorized users to observe honestly missing fixed paths", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await Promise.all(
        fixedAiStaffRefs(asModularFirestore(context.firestore())).map((reference) =>
          deleteDoc(reference),
        ),
      );
    });

    const db = asModularFirestore(
      testEnvironment.authenticatedContext("ai-admin").firestore(),
    );
    const snapshots = await Promise.all(
      fixedAiStaffRefs(db).map((reference) => assertSucceeds(getDoc(reference))),
    );
    expect(snapshots.every((snapshot) => !snapshot.exists())).toBe(true);
  });

  it("enforces the exact governance and runtime role/scope matrix", async () => {
    const supervisor = asModularFirestore(
      testEnvironment.authenticatedContext("ai-supervisor").firestore(),
    );
    const clinical = asModularFirestore(
      testEnvironment.authenticatedContext("ai-clinical").firestore(),
    );
    const privacy = asModularFirestore(
      testEnvironment.authenticatedContext("ai-privacy").firestore(),
    );

    for (const documentId of [
      "kn-appointments-v3",
      "kn-package-draft",
      "kn-old-hours",
    ] as const) {
      await assertSucceeds(
        getDoc(doc(supervisor, "workspaces", AI_WORKSPACE, "knowledgeDocuments", documentId)),
      );
    }
    for (const documentId of ["kn-labs-v2", "kn-urgent-v5"] as const) {
      await assertFails(
        getDoc(doc(supervisor, "workspaces", AI_WORKSPACE, "knowledgeDocuments", documentId)),
      );
      await assertSucceeds(
        getDoc(doc(clinical, "workspaces", AI_WORKSPACE, "knowledgeDocuments", documentId)),
      );
    }
    await assertSucceeds(
      getDoc(
        doc(
          supervisor,
          "workspaces",
          AI_WORKSPACE,
          "knowledgeSelections",
          "knowledge_selection_appointments_v3",
        ),
      ),
    );
    for (const selectionId of [
      "knowledge_selection_labs_v2",
      "knowledge_selection_urgent_v5",
    ] as const) {
      await assertFails(
        getDoc(doc(supervisor, "workspaces", AI_WORKSPACE, "knowledgeSelections", selectionId)),
      );
      await assertSucceeds(
        getDoc(doc(clinical, "workspaces", AI_WORKSPACE, "knowledgeSelections", selectionId)),
      );
    }

    for (const scenarioId of AI_PERSISTED_SCENARIO_IDS) {
      const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
      const supervisorAllowed = scenarioId !== "urgent";
      const clinicalAllowed = scenarioId === "urgent";
      for (const reference of [
        doc(supervisor, "workspaces", AI_WORKSPACE, "aiRuns", expected.runId),
        doc(supervisor, "workspaces", AI_WORKSPACE, "aiRunEvents", expected.eventId),
      ]) {
        await (supervisorAllowed ? assertSucceeds(getDoc(reference)) : assertFails(getDoc(reference)));
      }
      for (const reference of [
        doc(clinical, "workspaces", AI_WORKSPACE, "aiRuns", expected.runId),
        doc(clinical, "workspaces", AI_WORKSPACE, "aiRunEvents", expected.eventId),
      ]) {
        await (clinicalAllowed ? assertSucceeds(getDoc(reference)) : assertFails(getDoc(reference)));
      }
    }

    for (const documentId of AI_KNOWLEDGE_DOCUMENT_IDS) {
      await assertSucceeds(
        getDoc(doc(privacy, "workspaces", AI_WORKSPACE, "knowledgeDocuments", documentId)),
      );
    }
    for (const selectionId of AI_KNOWLEDGE_SELECTION_IDS) {
      await assertSucceeds(
        getDoc(doc(privacy, "workspaces", AI_WORKSPACE, "knowledgeSelections", selectionId)),
      );
    }
    for (const scenarioId of AI_PERSISTED_SCENARIO_IDS) {
      const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
      await assertFails(
        getDoc(doc(privacy, "workspaces", AI_WORKSPACE, "aiRuns", expected.runId)),
      );
      await assertFails(
        getDoc(doc(privacy, "workspaces", AI_WORKSPACE, "aiRunEvents", expected.eventId)),
      );
    }
  });

  it("denies public, revoked, false-MFA, invalid-scope, excluded-role and cross-tenant gets", async () => {
    const databases = [
      testEnvironment.unauthenticatedContext().firestore(),
      ...[
        "ai-revoked-admin",
        "ai-no-mfa-admin",
        "ai-assigned-admin",
        "ai-unscoped-supervisor",
        "ai-unscoped-clinical",
        "ai-wide-privacy",
        "ai-platform_owner",
        "ai-agent",
        "ai-campaign_operator",
        "ai-campaign_approver",
        "ai-analyst",
        "admin-a",
      ].map((uid) => testEnvironment.authenticatedContext(uid).firestore()),
    ];
    for (const database of databases) {
      await assertFails(
        getDoc(
          doc(
            asModularFirestore(database),
            "workspaces",
            AI_WORKSPACE,
            "knowledgeDocuments",
            "kn-appointments-v3",
          ),
        ),
      );
    }

    const aiAdmin = asModularFirestore(
      testEnvironment.authenticatedContext("ai-admin").firestore(),
    );
    await assertFails(
      getDoc(
        doc(aiAdmin, "workspaces", WORKSPACE_A, "knowledgeDocuments", "kn-appointments-v3"),
      ),
    );

    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), "workspaces", AI_WORKSPACE), {
        mode: "local",
      });
    });
    await assertFails(
      getDoc(
        doc(
          aiAdmin,
          "workspaces",
          AI_WORKSPACE,
          "knowledgeDocuments",
          "kn-appointments-v3",
        ),
      ),
    );
  });

  it("denies every list/query shape and every non-fixed path", async () => {
    const databases = [
      testEnvironment.unauthenticatedContext().firestore(),
      ...["ai-admin", "ai-supervisor", "ai-clinical", "ai-privacy"].map((uid) =>
        testEnvironment.authenticatedContext(uid).firestore(),
      ),
    ];
    for (const database of databases) {
      const db = asModularFirestore(database);
      for (const collectionName of [
        "knowledgeDocuments",
        "knowledgeSelections",
        "aiRuns",
        "aiRunEvents",
      ] as const) {
        const reference = collection(db, "workspaces", AI_WORKSPACE, collectionName);
        await assertFails(getDocs(reference));
        await assertFails(getDocs(query(reference, limit(1))));
        await assertFails(
          getDocs(
            query(
              reference,
              where("schemaVersion", "==", 1),
              where("synthetic", "==", true),
              orderBy("createdAt", "desc"),
              limit(100),
            ),
          ),
        );
      }
    }

    const admin = asModularFirestore(
      testEnvironment.authenticatedContext("ai-admin").firestore(),
    );
    for (const [collectionName, documentId] of [
      ["knowledgeDocuments", "kn-unknown"],
      ["knowledgeSelections", "knowledge_selection_unknown"],
      ["aiRuns", "ai_run_demo_unknown_v1"],
      ["aiRunEvents", "ai_run_event_demo_unknown_v1"],
    ] as const) {
      await assertFails(
        getDoc(doc(admin, "workspaces", AI_WORKSPACE, collectionName, documentId)),
      );
    }
  });

  it("rejects missing/extra keys, state substitutions and timestamp corruption", async () => {
    const admin = asModularFirestore(
      testEnvironment.authenticatedContext("ai-admin").firestore(),
    );
    const documentId = "kn-appointments-v3" as const;
    const documentRef = doc(
      admin,
      "workspaces",
      AI_WORKSPACE,
      "knowledgeDocuments",
      documentId,
    );
    const baseDocument = staffSafeAiKnowledgeDocument(documentId);
    for (const attack of [
      withoutField(baseDocument, "approvalFingerprint"),
      { ...baseDocument, rawContent: "forbidden" },
      { ...baseDocument, approvalState: "review" },
      { ...baseDocument, ownerUid: "user_demo_admin" },
      { ...baseDocument, evaluatedAt: now() },
      { ...baseDocument, createdAt: now(), updatedAt: aiEvaluatedAt() },
    ]) {
      await replaceAiFixture("knowledgeDocuments", documentId, attack);
      await assertFails(getDoc(documentRef));
    }

    const selectionId = "knowledge_selection_appointments_v3" as const;
    const selectionRef = doc(
      admin,
      "workspaces",
      AI_WORKSPACE,
      "knowledgeSelections",
      selectionId,
    );
    const baseSelection = staffSafeAiKnowledgeSelection(selectionId);
    for (const attack of [
      withoutField(baseSelection, "selectionFingerprint"),
      { ...baseSelection, protectedContentRef: "forbidden" },
      { ...baseSelection, documentId: "kn-old-hours" },
      { ...baseSelection, selectedAt: now() },
      { ...baseSelection, createdAt: aiEvaluatedAt() },
    ]) {
      await replaceAiFixture("knowledgeSelections", selectionId, attack);
      await assertFails(getDoc(selectionRef));
    }
  });

  it("rejects runtime outcome, counter, parent, provider and actual-time substitution", async () => {
    const admin = asModularFirestore(
      testEnvironment.authenticatedContext("ai-admin").firestore(),
    );
    const expected = AI_PERSISTED_SCENARIO_MATRIX.appointment;
    const runRef = doc(admin, "workspaces", AI_WORKSPACE, "aiRuns", expected.runId);
    const baseRun = staffSafeAiRun("appointment");
    for (const attack of [
      withoutField(baseRun, "providerCallCount"),
      { ...baseRun, rawPrompt: "forbidden" },
      { ...baseRun, outcome: "safety_hold_already_present" },
      { ...baseRun, providerCallCount: 1 },
      { ...baseRun, modelProvider: "external" },
      { ...baseRun, eventId: AI_PERSISTED_SCENARIO_MATRIX.urgent.eventId },
      { ...baseRun, evaluatedAt: now() },
      { ...baseRun, recordedAt: aiEvaluatedAt() },
    ]) {
      await replaceAiFixture("aiRuns", expected.runId, attack);
      await assertFails(getDoc(runRef));
    }

    const eventRef = doc(
      admin,
      "workspaces",
      AI_WORKSPACE,
      "aiRunEvents",
      expected.eventId,
    );
    const baseEvent = staffSafeAiEvent("appointment");
    for (const attack of [
      withoutField(baseEvent, "runFingerprint"),
      { ...baseEvent, hiddenReasoning: "forbidden" },
      { ...baseEvent, sequence: 2 },
      { ...baseEvent, retryOfEventId: "retry-forbidden" },
      { ...baseEvent, conversationMutationCount: 1 },
      { ...baseEvent, runId: AI_PERSISTED_SCENARIO_MATRIX.urgent.runId },
      { ...baseEvent, createdAt: aiEvaluatedAt() },
    ]) {
      await replaceAiFixture("aiRunEvents", expected.eventId, attack);
      await assertFails(getDoc(eventRef));
    }
  });

  it("denies every direct staff-safe mutation", async () => {
    const admin = asModularFirestore(
      testEnvironment.authenticatedContext("ai-admin").firestore(),
    );
    for (const [collectionName, documentId, value] of [
      ["knowledgeDocuments", "kn-appointments-v3", staffSafeAiKnowledgeDocument("kn-appointments-v3")],
      [
        "knowledgeSelections",
        "knowledge_selection_appointments_v3",
        staffSafeAiKnowledgeSelection("knowledge_selection_appointments_v3"),
      ],
      ["aiRuns", "ai_run_demo_appointment_v1", staffSafeAiRun("appointment")],
      ["aiRunEvents", "ai_run_event_demo_appointment_v1", staffSafeAiEvent("appointment")],
    ] as const) {
      const reference = doc(admin, "workspaces", AI_WORKSPACE, collectionName, documentId);
      await assertFails(updateDoc(reference, { synthetic: false }));
      await assertFails(deleteDoc(reference));
      await assertFails(
        setDoc(
          doc(admin, "workspaces", AI_WORKSPACE, collectionName, `${documentId}_forged`),
          value,
        ),
      );
    }
  });

  it("totally denies all AI secrets, receipts and handoff documents", async () => {
    const databases = [
      testEnvironment.unauthenticatedContext().firestore(),
      ...["ai-admin", "ai-supervisor", "ai-clinical", "ai-privacy"].map((uid) =>
        testEnvironment.authenticatedContext(uid).firestore(),
      ),
    ];
    for (const database of databases) {
      const db = asModularFirestore(database);
      for (const [collectionName, documentId] of [
        ["knowledgeDocumentSecrets", "knowledge_secret_appointments_v3"],
        ["aiRunSecrets", "ai_run_secret_demo_appointment_v1"],
        ["aiRunEventSecrets", "ai_run_event_secret_demo_appointment_v1"],
        ["idempotencyKeys", "ai_run_receipt_demo_appointment_v1"],
        ["handoffSessions", "handoff-forbidden"],
      ] as const) {
        const reference = doc(db, "workspaces", AI_WORKSPACE, collectionName, documentId);
        await assertFails(getDoc(reference));
        await assertFails(
          getDocs(query(collection(db, "workspaces", AI_WORKSPACE, collectionName), limit(1))),
        );
        await assertFails(setDoc(doc(db, "workspaces", AI_WORKSPACE, collectionName, "forged"), {}));
        await assertFails(updateDoc(reference, { compromised: true }));
        await assertFails(deleteDoc(reference));
      }
    }
  });
});
