import { createHash, createHmac } from "node:crypto";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
  Timestamp,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import {
  DEMO_CLOCK,
  DEMO_IDS,
  demoAppointments,
  demoConsentRecords,
  demoContacts,
  demoConversations,
  demoLabReports,
  demoLocations,
  demoMessages,
  demoTeams,
  demoWorkspaces,
} from "../lib/demo";
import {
  DEMO_CONNECTION_WORKSPACE_ID,
  DEMO_INTEGRATION_BINDINGS,
  DEMO_INTEGRATION_IDS,
  DEMO_WHATSAPP_CONNECTION_ID,
  DEMO_WHATSAPP_SIGNAL_KEYS,
  DEMO_WHATSAPP_SIGNAL_MATRIX,
  assertDemoConnectionCentreV1,
  assertStaffSafeIntegrationV1,
  assertStaffSafeWhatsAppConnectionV1,
  type DemoConnectionCentreV1,
  type DemoEvidenceSignalV1,
  type StaffSafeIntegrationV1,
  type StaffSafeWhatsAppConnectionV1,
} from "../lib/domain/connections";
import {
  AI_GOVERNANCE_COLLECTIONS,
  AI_GOVERNANCE_ROLE_READ_PLANS,
  AI_GOVERNANCE_SEED_TIMESTAMPS,
  getWorkspaceAccess,
  PHASE5_COLLECTIONS,
  PHASE5_SECRET_COLLECTIONS,
  PHASE5_STAFF_COLLECTIONS,
  assertAutomationActivationGovernanceJoin,
  assertAutomationDefinitionGovernanceHashes,
  assertAutomationDefinitionSecretJoin,
  assertAutomationReceiptAggregateJoin,
  assertCarePathwayActivationGovernanceJoin,
  assertCarePathwayGovernanceHashes,
  assertCarePathwaySecretJoin,
  assertCareReceiptAggregateJoin,
  assertPhase5EventAuditJoin,
  getAutomationActivation,
  getAutomationRun,
  getCareEnrollment,
  getCarePathwayActivation,
  getGovernedCampaignBundle,
  hasVerifiedProviderApproval,
  listAudienceSnapshots,
  listAutomationDefinitions,
  listAppointmentEvents,
  listCampaignCheckpoints,
  listCampaignEvents,
  listCampaigns,
  listCarePathways,
  listConsentRecordsForContact,
  listConversationMessageMetadata,
  listLabReportEvents,
  listFlowCatalogue,
  listScopedAppointments,
  listSyntheticInternalNotes,
  listScopedContacts,
  listScopedConversations,
  listScopedLabReports,
  listWorkspaceLocations,
  listWorkspaceTeams,
  listTemplateCatalogue,
  loadAiGovernanceEvidence,
  loadDemoConnectionCentre,
  parseAutomationActivationDocument,
  parseAutomationDefinitionDocument,
  parseAutomationDefinitionEventDocument,
  parseAutomationDefinitionSecretDocument,
  parseAutomationRunDocument,
  parseAutomationRunSecretDocument,
  parseAutomationTriggerReceiptDocument,
  parseCareEnrollmentDocument,
  parseCareEnrollmentReceiptDocument,
  parseCareEnrollmentSecretDocument,
  parseCarePathwayActivationDocument,
  parseCarePathwayDocument,
  parseCarePathwayEventDocument,
  parseCarePathwaySecretDocument,
  parsePhase5AuditDocument,
  serializeCampaignApprovalBinding,
  serializeTemplateContentBinding,
  updateSyntheticContactPreferences,
} from "../lib/firebase/repositories";
import {
  serializeAutomationDefinitionApproval,
  serializeAutomationDefinitionContent,
  serializeAutomationDefinitionSecretBinding,
  serializeAutomationSourceEventIdentity,
  serializeAutomationTriggerReceiptKey,
  serializeAutomationTriggerReceiptPayload,
  serializeCareDischargeSourceIdentity,
  serializeCareEnrollmentReceiptKey,
  serializeCareEnrollmentReceiptPayload,
  serializeCarePathwayApproval,
  serializeCarePathwayContent,
  serializeCarePathwaySecretBinding,
} from "../lib/domain/automation-governance";
import {
  AI_GOVERNANCE_EVALUATED_AT,
  AI_GOVERNANCE_EXPECTED_PERSISTENCE_COUNTS,
  AI_GOVERNANCE_SELECTOR_VERSION_ID,
  AI_GOVERNANCE_WORKSPACE_ID,
  AI_KNOWLEDGE_DOCUMENT_IDS,
  AI_KNOWLEDGE_DOCUMENT_MATRIX,
  AI_KNOWLEDGE_SELECTION_IDS,
  AI_KNOWLEDGE_SELECTION_MATRIX,
  AI_PERSISTED_SCENARIO_IDS,
  AI_PERSISTED_SCENARIO_MATRIX,
  assertAiGovernancePersistenceCountModel,
  assertAiKnowledgeDocumentCrossBindingV1,
  assertAiKnowledgeDocumentSecretV1,
  assertAiKnowledgeSelectionCrossBindingV1,
  assertStaffSafeAiKnowledgeDocumentV1,
  assertStaffSafeAiKnowledgeSelectionV1,
  serializeAiKnowledgeApprovalV1,
  serializeAiKnowledgeContentV1,
  serializeAiKnowledgeSelectionV1,
  type AiKnowledgeApprovalBindingV1,
  type AiKnowledgeContentBindingV1,
  type AiKnowledgeDocumentId,
  type AiKnowledgeDocumentSecretV1,
  type AiKnowledgeSelectionBindingV1,
  type AiKnowledgeSelectionId,
  type StaffSafeAiKnowledgeDocumentV1,
  type StaffSafeAiKnowledgeSelectionV1,
} from "../lib/domain/ai-governance";
import { entityId, sha256Digest } from "../lib/domain/primitives";
import { assertSafeSeedEmulatorHosts } from "./emulator-host-safety";

const projectId = "demo-hemas-connect";
const email = "demo.admin@synthetic.invalid";
const password = process.env.DEMO_ADMIN_PASSWORD ?? "Synthetic-Demo-Only-2026!";
const syntheticPhoneRoutes = [
  {
    id: "synthetic-phone-route-wattala-demo",
    teamId: "team_demo_general",
    locationId: "location_demo_wattala",
  },
  {
    id: "synthetic-phone-route-thalawathugoda-demo",
    teamId: "team_demo_general",
    locationId: "location_demo_thalawathugoda",
  },
] as const;

const connectionSeedTimes = Object.freeze({
  createdAt: String(DEMO_CLOCK.created),
  observedAt: String(DEMO_CLOCK.recent),
  updatedAt: String(DEMO_CLOCK.recent),
});

const forbiddenConnectionSeedKeys = new Set([
  "accessToken",
  "credentialSecretRef",
  "detail",
  "endpointUrl",
  "health",
  "lastError",
  "message",
  "messagingLimit",
  "phoneNumberId",
  "providerPhoneNumberId",
  "qualityRating",
  "rawProviderState",
  "verification",
  "wabaId",
]);

function buildDemoConnectionCentreSeed(): DemoConnectionCentreV1 {
  const signals = Object.fromEntries(
    DEMO_WHATSAPP_SIGNAL_KEYS.map((key) => [
      key,
      {
        ...DEMO_WHATSAPP_SIGNAL_MATRIX[key],
        observedAt: connectionSeedTimes.observedAt,
        lastSuccessfulVerificationAt: null,
      },
    ]),
  );
  const candidate: unknown = {
    whatsappConnections: [
      {
        id: DEMO_WHATSAPP_CONNECTION_ID,
        workspaceId: DEMO_CONNECTION_WORKSPACE_ID,
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
        signals,
        sortKey: "01_whatsapp_simulator",
        synthetic: true,
        schemaVersion: 1,
        createdAt: connectionSeedTimes.createdAt,
        updatedAt: connectionSeedTimes.updatedAt,
      },
    ],
    integrations: DEMO_INTEGRATION_IDS.map((id) => {
      const binding = DEMO_INTEGRATION_BINDINGS[id];
      return {
        id,
        workspaceId: DEMO_CONNECTION_WORKSPACE_ID,
        kind: binding.kind,
        displayName: binding.displayName,
        environment: "demo",
        adapterMode: "synthetic",
        status: "mock",
        credentialState: "not_configured",
        externalNetworkEnabled: false,
        authoritativeSystemWriteEnabled: false,
        lastSyncAt: null,
        evidence: {
          state: "mock",
          source: "synthetic_fixture",
          observedAt: connectionSeedTimes.observedAt,
          lastSuccessfulVerificationAt: null,
          detailCode: binding.detailCode,
        },
        sortKey: binding.sortKey,
        synthetic: true,
        schemaVersion: 1,
        createdAt: connectionSeedTimes.createdAt,
        updatedAt: connectionSeedTimes.updatedAt,
      };
    }),
  };

  assertDemoConnectionCentreV1(candidate);
  return candidate;
}

function evidenceSignalForFirestore(signal: DemoEvidenceSignalV1) {
  return {
    ...signal,
    observedAt: asTimestamp(signal.observedAt),
  };
}

function whatsappConnectionForFirestore(connection: StaffSafeWhatsAppConnectionV1) {
  return {
    ...connection,
    signals: Object.fromEntries(
      DEMO_WHATSAPP_SIGNAL_KEYS.map((key) => [
        key,
        evidenceSignalForFirestore(connection.signals[key]),
      ]),
    ),
    createdAt: asTimestamp(connection.createdAt),
    updatedAt: asTimestamp(connection.updatedAt),
  };
}

function integrationForFirestore(integration: StaffSafeIntegrationV1) {
  return {
    ...integration,
    evidence: evidenceSignalForFirestore(integration.evidence),
    createdAt: asTimestamp(integration.createdAt),
    updatedAt: asTimestamp(integration.updatedAt),
  };
}

const seededAppointmentEventId = "appointment_event_synthetic_seed_confirmed";
const seededLabReportEventId = "lab_report_event_synthetic_ready";
const seededInternalNoteId = "note_synthetic_seed_appointment";
const seededCampaignId = "campaign_synthetic_50k";
const seededAudienceSnapshotId = "audience_synthetic_50k_v1";
const seededCampaignOwnerId = "user_demo_campaign_operator";
const seededCampaignApproverId = "user_demo_campaign_approver";
const seededCampaignTemplateVersionIds = {
  en: "template_wellness_awareness_en_v3",
  si: "template_wellness_awareness_si_v3",
  ta: "template_wellness_awareness_ta_v3",
} as const;
const seededCampaignTemplateContentHashes = {
  en: "0cbf38327d7d48ee61558927c6afb8e4e75c1781561906ebbab4def379e6c04f",
  si: "cefbdf676d18b06dfcc4263e659c0585db48de7e7843b57b32566d2215536582",
  ta: "c477a31ee0344bef6c66a25a0a70848f6a0a75262f0df328dd8b04e6479a2b12",
} as const;
const seededCampaignTemplateContentSerializations = {
  en: '["hemas-connect:template-content:v1","workspace_safenet_demo","template_wellness_awareness_en_v3","wellness_awareness","wellness_awareness","marketing","en",3,[["body",null,"{{patient_ref}}, this approved internal synthetic template shares wellness awareness information about {{campaign_topic}}.",[]],["footer",null,"Reply STOP to stop marketing messages.",[]]],[["patient_ref","Masked synthetic patient reference",true,24,"SYN-P000862","^SYN-P[0-9]{6}$"],["campaign_topic","Approved neutral campaign topic",true,70,"Dengue prevention",null]]]',
  si: '["hemas-connect:template-content:v1","workspace_safenet_demo","template_wellness_awareness_si_v3","wellness_awareness","wellness_awareness","marketing","si",3,[["body",null,"{{patient_ref}}, {{campaign_topic}} පිළිබඳ සුවතා දැනුවත් කිරීම සඳහා අභ්‍යන්තරව අනුමත කළ කෘත්‍රිම ආදර්ශය මෙයයි.",[]],["footer",null,"අලෙවිකරණ පණිවිඩ නැවැත්වීමට STOP යවන්න.",[]]],[["patient_ref","Masked synthetic patient reference",true,24,"SYN-P000862","^SYN-P[0-9]{6}$"],["campaign_topic","Approved neutral campaign topic",true,70,"Dengue prevention",null]]]',
  ta: '["hemas-connect:template-content:v1","workspace_safenet_demo","template_wellness_awareness_ta_v3","wellness_awareness","wellness_awareness","marketing","ta",3,[["body",null,"{{patient_ref}}, {{campaign_topic}} குறித்த நலவாழ்வு விழிப்புணர்வுக்காக உள்நிலையில் அங்கீகரிக்கப்பட்ட செயற்கை வார்ப்புரு இது.",[]],["footer",null,"சந்தைப்படுத்தல் செய்திகளை நிறுத்த STOP எனப் பதிலளிக்கவும்.",[]]],[["patient_ref","Masked synthetic patient reference",true,24,"SYN-P000862","^SYN-P[0-9]{6}$"],["campaign_topic","Approved neutral campaign topic",true,70,"Dengue prevention",null]]]',
} as const;
const seededAudienceContentHash =
  "7a4d8ce2bc1bafc224e5e2b91a2fc3f8b20b5f062ff1563ca4cf25847ad0d550";
const seededCampaignStartsAtIso = "2026-08-10T03:30:00.000Z";
const seededCampaignApprovalSerialization =
  '["hemas-connect:campaign-approval:v2","workspace_safenet_demo","campaign_synthetic_50k","audience_synthetic_50k_v1","7a4d8ce2bc1bafc224e5e2b91a2fc3f8b20b5f062ff1563ca4cf25847ad0d550","template_wellness_awareness_en_v3","0cbf38327d7d48ee61558927c6afb8e4e75c1781561906ebbab4def379e6c04f","template_wellness_awareness_si_v3","cefbdf676d18b06dfcc4263e659c0585db48de7e7843b57b32566d2215536582","template_wellness_awareness_ta_v3","c477a31ee0344bef6c66a25a0a70848f6a0a75262f0df328dd8b04e6479a2b12","health_campaigns","marketing","Open the synthetic wellness information journey","2026-08-10T03:30:00.000Z","Asia/Colombo","20:00","08:00"]';
const seededCampaignApprovalHash =
  "6bdce27c7e31e5e064febd7b4dcbd05df208a4ddf33085003848bbfd81c1b1cd";

const PHASE5_SYNTHETIC_HMAC_KEY = "PUBLIC-SYNTHETIC-TEST-KEY-NOT-A-SECRET";
const phase5AutomationOwnerUid = "user_demo_admin";
const phase5AutomationApproverUid = "user_demo_supervisor";
const phase5ClinicalOwnerUid = "user_demo_admin";
const phase5ClinicalApproverUid = "user_demo_clinical_approver";
const phase5AutomationRunId = String(DEMO_IDS.automationRun);
const phase5CarePathwayId = String(DEMO_IDS.carePathway);
const phase5CareEnrollmentId = String(DEMO_IDS.careEnrollment);
const phase5AppointmentTemplateId = "template_appointment_confirmation_en_v3";
const phase5AppointmentUtilityConsentId =
  "consent_synthetic_appointment_utility_phase5";
const phase5AppointmentTemplateHash =
  "548cc18fe0d5ccd7bbc3ae637c381acd784cbea28a8538fe528474aec86e7e06";
const phase5CareTemplateHashes = {
  day1: {
    en: "2df838fbe5170c16fa382cc6db70ad1a78fa613a165f95632f55be90fbfb85e8",
    si: "ef5715a5bf03c46387bc26d00db9c53dcac6244f68bc3c0db0a16926100b5a18",
    ta: "21d3822c917b2623608e3b3b197fb39467ee0ccbe8041f72d967cfe2e7d7a287",
  },
  day3: {
    en: "1f1c2c92af3e4c69b201ea6e140bfec87caf2cfc4886ac1a0a7ee1d3d71a4d67",
    si: "286204f289a1f2a599f16ff183176d5be680c88f3b0279ae72ee5b4908915d1a",
    ta: "117bea5281c07cea6bbcd210c69744296da492adcd0dad8116383578f9a88bca",
  },
} as const;
const phase5AutomationFamilies = ["appointment_service", "laboratory_service"] as const;
const phase5DefinitionVersions = [1, 2, 3] as const;
const phase5ForbiddenStaffKeys = [
  "contactId",
  "conversationId",
  "appointmentId",
  "patientId",
  "dischargeId",
  "providerMessageId",
  "messageBody",
  "clinicalText",
  "medication",
  "dose",
  "rawError",
  "triggerFingerprint",
  "idempotencyFingerprint",
  "subjectFingerprint",
  "sourceDischargeFingerprint",
  "receiptFingerprint",
  "protectedConfigurationRef",
  "protectedContactRef",
  "protectedConversationRef",
  "protectedAppointmentRef",
  "protectedQualifyingDischargeRef",
  "protectedInstructionsRef",
] as const;

const phase5SeedCollectionCounts: Readonly<
  Record<(typeof PHASE5_COLLECTIONS)[number], number>
> = Object.freeze({
  automationDefinitions: 6,
  automationActivations: 2,
  automationDefinitionEvents: 24,
  automationRuns: 1,
  automationRunEvents: 0,
  automationWorkItems: 0,
  carePathways: 1,
  carePathwayActivations: 1,
  carePathwayEvents: 4,
  careEnrollments: 1,
  careEnrollmentEvents: 0,
  careEscalations: 0,
  careHandoffs: 0,
  automationDefinitionSecrets: 6,
  automationTriggerReceipts: 1,
  automationRunSecrets: 1,
  automationRunEventSecrets: 0,
  automationWorkItemSecrets: 0,
  carePathwaySecrets: 1,
  careEnrollmentReceipts: 1,
  careEnrollmentSecrets: 1,
  careEnrollmentEventSecrets: 0,
  careEscalationSecrets: 0,
});

type AuthResponse = { localId?: string; error?: { message?: string } };
type ContactRoute = { readonly teamId: string; readonly locationId: string };

const contactRoutes = new Map<string, ContactRoute>([
  [
    String(DEMO_IDS.contacts.appointment),
    {
      teamId: String(DEMO_IDS.teams.general),
      locationId: String(DEMO_IDS.locations.wattala),
    },
  ],
  [
    String(DEMO_IDS.contacts.laboratory),
    {
      teamId: String(DEMO_IDS.teams.laboratory),
      locationId: String(DEMO_IDS.locations.labNetwork),
    },
  ],
  [
    String(DEMO_IDS.contacts.package),
    {
      teamId: String(DEMO_IDS.teams.general),
      locationId: String(DEMO_IDS.locations.thalawathugoda),
    },
  ],
  [
    String(DEMO_IDS.contacts.mixedLanguage),
    {
      teamId: String(DEMO_IDS.teams.general),
      locationId: String(DEMO_IDS.locations.wattala),
    },
  ],
  [
    String(DEMO_IDS.contacts.urgent),
    {
      teamId: String(DEMO_IDS.teams.clinicalEscalation),
      locationId: String(DEMO_IDS.locations.wattala),
    },
  ],
  [
    String(DEMO_IDS.contacts.stopped),
    {
      teamId: String(DEMO_IDS.teams.general),
      locationId: String(DEMO_IDS.locations.wattala),
    },
  ],
]);

const catalogueLanguages = ["en", "si", "ta"] as const;

function computeSeedCampaignApprovalHash(
  input: Parameters<typeof serializeCampaignApprovalBinding>[0],
): string {
  return createHash("sha256")
    .update(serializeCampaignApprovalBinding(input), "utf8")
    .digest("hex");
}

function computeSeedTemplateContentHash(
  input: Parameters<typeof serializeTemplateContentBinding>[0],
): string {
  return createHash("sha256")
    .update(serializeTemplateContentBinding(input), "utf8")
    .digest("hex");
}

function phase5Sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function phase5HmacSha256(value: string): string {
  return createHmac("sha256", PHASE5_SYNTHETIC_HMAC_KEY)
    .update(value, "utf8")
    .digest("hex");
}

const templateCatalogueSeeds = [
  {
    assetKey: "appointment_confirmation",
    language: "en",
    category: "utility",
    version: 3,
    localState: "approved",
    components: [
      { kind: "header", format: "text", text: "Appointment request recorded" },
      {
        kind: "body",
        text: "Hello {{patient_ref}}. Synthetic appointment request {{appointment_ref}} for {{service}} at {{location}} is pending for {{date_time}}.",
      },
      {
        kind: "footer",
        text: "Synthetic demonstration — no Hemas appointment has been created.",
      },
    ],
    variableRules: [
      ["patient_ref", "Masked synthetic patient reference", 24, "SYN-P000184", "^SYN-P[0-9]{6}$"],
      ["appointment_ref", "Opaque synthetic appointment reference", 24, "SYN-A1842", "^SYN-A[0-9]{4}$"],
      ["service", "Approved neutral service label", 60, "General medicine", null],
      ["location", "Approved facility label", 40, "Wattala", null],
      ["date_time", "Asia/Colombo display time", 48, "10 Aug 2026, 10:30", null],
    ],
  },
  {
    assetKey: "lab_report_ready",
    language: "ta",
    category: "utility",
    version: 2,
    localState: "submitted",
    components: [
      { kind: "header", format: "text", text: "ஆய்வக அறிக்கை அறிவிப்பு" },
      {
        kind: "body",
        text: "{{patient_ref}}, {{request_ref}} கோரிக்கைக்கான செயற்கை அறிக்கை நிலை தயாராக உள்ளது. முடிவுகள் இந்தச் செய்தியில் இல்லை.",
      },
      { kind: "footer", text: "இது செயற்கைத் தரவு கொண்ட மாதிரி மட்டுமே." },
    ],
    variableRules: [
      ["patient_ref", "Masked synthetic patient reference", 24, "SYN-P002781", "^SYN-P[0-9]{6}$"],
      ["request_ref", "Opaque synthetic laboratory request", 24, "SYN-L0041", "^SYN-L[0-9]{4}$"],
    ],
  },
  {
    assetKey: "wellness_awareness",
    language: "si",
    category: "marketing",
    version: 4,
    localState: "draft",
    components: [
      {
        kind: "body",
        text: "{{patient_ref}}, {{campaign_topic}} පිළිබඳ අනුමත දැනුවත් කිරීමේ තොරතුරු සඳහා මෙම කෘත්‍රිම ආදර්ශය භාවිතා කරයි.",
      },
      { kind: "footer", text: "STOP යැවීමෙන් අලෙවිකරණ පණිවිඩ නවත්වන්න." },
    ],
    variableRules: [
      ["patient_ref", "Masked synthetic patient reference", 24, "SYN-P000862", "^SYN-P[0-9]{6}$"],
      ["campaign_topic", "Approved neutral campaign topic", 70, "Dengue prevention", null],
    ],
  },
  {
    assetKey: "wellness_awareness",
    language: "en",
    category: "marketing",
    version: 3,
    localState: "approved",
    components: [
      {
        kind: "body",
        text: "{{patient_ref}}, this approved internal synthetic template shares wellness awareness information about {{campaign_topic}}.",
      },
      { kind: "footer", text: "Reply STOP to stop marketing messages." },
    ],
    variableRules: [
      ["patient_ref", "Masked synthetic patient reference", 24, "SYN-P000862", "^SYN-P[0-9]{6}$"],
      ["campaign_topic", "Approved neutral campaign topic", 70, "Dengue prevention", null],
    ],
  },
  {
    assetKey: "wellness_awareness",
    language: "si",
    category: "marketing",
    version: 3,
    localState: "approved",
    components: [
      {
        kind: "body",
        text: "{{patient_ref}}, {{campaign_topic}} පිළිබඳ සුවතා දැනුවත් කිරීම සඳහා අභ්‍යන්තරව අනුමත කළ කෘත්‍රිම ආදර්ශය මෙයයි.",
      },
      { kind: "footer", text: "අලෙවිකරණ පණිවිඩ නැවැත්වීමට STOP යවන්න." },
    ],
    variableRules: [
      ["patient_ref", "Masked synthetic patient reference", 24, "SYN-P000862", "^SYN-P[0-9]{6}$"],
      ["campaign_topic", "Approved neutral campaign topic", 70, "Dengue prevention", null],
    ],
  },
  {
    assetKey: "wellness_awareness",
    language: "ta",
    category: "marketing",
    version: 3,
    localState: "approved",
    components: [
      {
        kind: "body",
        text: "{{patient_ref}}, {{campaign_topic}} குறித்த நலவாழ்வு விழிப்புணர்வுக்காக உள்நிலையில் அங்கீகரிக்கப்பட்ட செயற்கை வார்ப்புரு இது.",
      },
      { kind: "footer", text: "சந்தைப்படுத்தல் செய்திகளை நிறுத்த STOP எனப் பதிலளிக்கவும்." },
    ],
    variableRules: [
      ["patient_ref", "Masked synthetic patient reference", 24, "SYN-P000862", "^SYN-P[0-9]{6}$"],
      ["campaign_topic", "Approved neutral campaign topic", 70, "Dengue prevention", null],
    ],
  },
  {
    assetKey: "synthetic_care_day1",
    language: "en",
    category: "utility",
    version: 1,
    localState: "approved",
    components: [
      { kind: "header", format: "text", text: "Synthetic follow-up · Day 1" },
      {
        kind: "body",
        text: "Your scheduled synthetic post-discharge check-in is ready. Use the approved demo response options; no clinical advice is generated here.",
      },
      {
        kind: "footer",
        text: "Synthetic demo only. For urgent help, use the approved emergency care route.",
      },
    ],
    variableRules: [],
  },
  {
    assetKey: "synthetic_care_day1",
    language: "si",
    category: "utility",
    version: 1,
    localState: "approved",
    components: [
      { kind: "header", format: "text", text: "කෘත්‍රිම පසු විමසුම · දින 1" },
      {
        kind: "body",
        text: "ඔබගේ නියමිත කෘත්‍රිම රෝහල් පිටවීමෙන් පසු පසු විමසීම සූදානම්. අනුමත ආදර්ශ ප්‍රතිචාර විකල්ප භාවිත කරන්න; මෙහි සායනික උපදෙස් ජනනය නොකෙරේ.",
      },
      {
        kind: "footer",
        text: "කෘත්‍රිම ආදර්ශයක් පමණි. හදිසි උදව් සඳහා අනුමත හදිසි සත්කාර මාර්ගය භාවිත කරන්න.",
      },
    ],
    variableRules: [],
  },
  {
    assetKey: "synthetic_care_day1",
    language: "ta",
    category: "utility",
    version: 1,
    localState: "approved",
    components: [
      { kind: "header", format: "text", text: "செயற்கை பின்தொடர்பு · நாள் 1" },
      {
        kind: "body",
        text: "உங்கள் திட்டமிடப்பட்ட செயற்கை மருத்துவமனை வெளியேற்றத்திற்குப் பிந்தைய தொடர்பு தயாராக உள்ளது. அங்கீகரிக்கப்பட்ட மாதிரி பதில் விருப்பங்களைப் பயன்படுத்துங்கள்; இங்கு மருத்துவ ஆலோசனை உருவாக்கப்படாது.",
      },
      {
        kind: "footer",
        text: "செயற்கை மாதிரி மட்டும். அவசர உதவிக்கு அங்கீகரிக்கப்பட்ட அவசர சிகிச்சை வழியைப் பயன்படுத்துங்கள்.",
      },
    ],
    variableRules: [],
  },
  {
    assetKey: "synthetic_care_day3",
    language: "en",
    category: "utility",
    version: 1,
    localState: "approved",
    components: [
      { kind: "header", format: "text", text: "Synthetic follow-up · Day 3" },
      {
        kind: "body",
        text: "Your scheduled day-three synthetic post-discharge check-in is ready. Use the approved demo response options; no clinical advice is generated here.",
      },
      {
        kind: "footer",
        text: "Synthetic demo only. For urgent help, use the approved emergency care route.",
      },
    ],
    variableRules: [],
  },
  {
    assetKey: "synthetic_care_day3",
    language: "si",
    category: "utility",
    version: 1,
    localState: "approved",
    components: [
      { kind: "header", format: "text", text: "කෘත්‍රිම පසු විමසුම · දින 3" },
      {
        kind: "body",
        text: "ඔබගේ තුන්වන දින නියමිත කෘත්‍රිම රෝහල් පිටවීමෙන් පසු පසු විමසීම සූදානම්. අනුමත ආදර්ශ ප්‍රතිචාර විකල්ප භාවිත කරන්න; මෙහි සායනික උපදෙස් ජනනය නොකෙරේ.",
      },
      {
        kind: "footer",
        text: "කෘත්‍රිම ආදර්ශයක් පමණි. හදිසි උදව් සඳහා අනුමත හදිසි සත්කාර මාර්ගය භාවිත කරන්න.",
      },
    ],
    variableRules: [],
  },
  {
    assetKey: "synthetic_care_day3",
    language: "ta",
    category: "utility",
    version: 1,
    localState: "approved",
    components: [
      { kind: "header", format: "text", text: "செயற்கை பின்தொடர்பு · நாள் 3" },
      {
        kind: "body",
        text: "உங்கள் திட்டமிடப்பட்ட மூன்றாம் நாள் செயற்கை மருத்துவமனை வெளியேற்றத்திற்குப் பிந்தைய தொடர்பு தயாராக உள்ளது. அங்கீகரிக்கப்பட்ட மாதிரி பதில் விருப்பங்களைப் பயன்படுத்துங்கள்; இங்கு மருத்துவ ஆலோசனை உருவாக்கப்படாது.",
      },
      {
        kind: "footer",
        text: "செயற்கை மாதிரி மட்டும். அவசர உதவிக்கு அங்கீகரிக்கப்பட்ட அவசர சிகிச்சை வழியைப் பயன்படுத்துங்கள்.",
      },
    ],
    variableRules: [],
  },
] as const;

const flowCatalogueBlueprints = [
  {
    assetKey: "doctor_booking_flow",
    definitionId: "synthetic-flow-appointment-request",
    displayName: "Appointment booking Flow",
    localState: "approved",
    screenIds: ["REQUEST_DETAILS", "LOCATION", "SPECIALTY", "DOCTOR", "DATE", "SLOT", "CONSENT", "REVIEW", "PENDING_CONFIRMATION"],
  },
  {
    assetKey: "home_collection_flow",
    definitionId: "synthetic-flow-laboratory-collection-request",
    displayName: "Home collection Flow",
    localState: "submitted",
    screenIds: ["COLLECTION_MODE", "TEST", "LOCATION", "DATE", "SLOT", "PREPARATION", "CONSENT", "REVIEW", "PENDING_CONFIRMATION"],
  },
  {
    assetKey: "appointment_change_flow",
    definitionId: "synthetic-flow-appointment-change",
    displayName: "Reschedule or cancel Flow",
    localState: "paused",
    screenIds: ["APPOINTMENT", "CHANGE_ACTION", "REASON", "NEW_DATE", "NEW_SLOT", "REVIEW", "PENDING_CONFIRMATION"],
  },
  {
    assetKey: "package_enquiry_flow",
    definitionId: "synthetic-flow-package-enquiry",
    displayName: "Package enquiry Flow",
    localState: "disabled",
    screenIds: ["PACKAGE_CATEGORY", "PACKAGE_SUMMARY", "LOCATION", "DATE", "CONTACT", "PAYMENT_HANDOFF", "REVIEW", "PENDING_CONFIRMATION"],
  },
  {
    assetKey: "service_feedback_flow",
    definitionId: "synthetic-flow-feedback",
    displayName: "Service feedback Flow",
    localState: "rejected",
    screenIds: ["SERVICE_REFERENCE", "SATISFACTION", "REASONS", "OPTIONAL_COMMENT", "CONTACT_PERMISSION", "REVIEW", "PENDING_CONFIRMATION"],
  },
  {
    assetKey: "communication_preferences_flow",
    definitionId: "synthetic-flow-communication-preferences",
    displayName: "Communication preferences Flow",
    localState: "draft",
    screenIds: ["LANGUAGE", "UTILITY", "EDUCATION", "MARKETING", "FREQUENCY", "REVIEW", "PENDING_CONFIRMATION"],
  },
] as const;

function syntheticCatalogueOwnership(workspaceId: string) {
  return {
    ownerKind: "safenet_demo",
    ownerWorkspaceId: workspaceId,
    transferableToHemas: false,
    productionUseAllowed: false,
    notice: "SafeNet demo asset. It is not a Hemas-owned or transferable production asset.",
  } as const;
}

function unverifiedProviderState() {
  return {
    submissionState: "not_submitted",
    approvalState: "unverified",
    authority: "none",
    assetId: null,
    qualityRating: "unknown",
    checkedAt: null,
  } as const;
}

function asTimestamp(value: string): Timestamp {
  return Timestamp.fromDate(new Date(value));
}

function nullableTimestamp(value: string | null): Timestamp | null {
  return value === null ? null : asTimestamp(value);
}

type AiGovernanceSeedDocument = {
  readonly id: string;
  readonly data: Record<string, unknown>;
};

type AiGovernanceKnowledgeSeedDocument = AiGovernanceSeedDocument & {
  readonly canonical: StaffSafeAiKnowledgeDocumentV1;
  readonly content: AiKnowledgeContentBindingV1;
  readonly approval: AiKnowledgeApprovalBindingV1;
};

type AiGovernanceSelectionSeedDocument = AiGovernanceSeedDocument & {
  readonly canonical: StaffSafeAiKnowledgeSelectionV1;
};

type AiGovernanceSecretSeedDocument = AiGovernanceSeedDocument & {
  readonly canonical: AiKnowledgeDocumentSecretV1;
};

function aiGovernanceSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function buildAiGovernanceSeedGraph(): {
  readonly knowledgeDocuments: readonly AiGovernanceKnowledgeSeedDocument[];
  readonly knowledgeSelections: readonly AiGovernanceSelectionSeedDocument[];
  readonly knowledgeDocumentSecrets: readonly AiGovernanceSecretSeedDocument[];
} {
  const knowledgeDocuments: AiGovernanceKnowledgeSeedDocument[] = [];
  const knowledgeDocumentSecrets: AiGovernanceSecretSeedDocument[] = [];
  const publicDocumentById = new Map<AiKnowledgeDocumentId, StaffSafeAiKnowledgeDocumentV1>();

  for (const documentId of AI_KNOWLEDGE_DOCUMENT_IDS) {
    const expected = AI_KNOWLEDGE_DOCUMENT_MATRIX[documentId];
    const content: AiKnowledgeContentBindingV1 = {
      workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
      documentId,
      title: expected.title,
      version: expected.version,
      language: expected.language,
      contentKind: expected.contentKind,
      ownerUid: expected.ownerUid,
      protectedContentFingerprint: expected.protectedContentFingerprint,
      synthetic: true,
    };
    const contentFingerprint = aiGovernanceSha256(
      serializeAiKnowledgeContentV1(content),
    );
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
    const approvalFingerprint = aiGovernanceSha256(
      serializeAiKnowledgeApprovalV1(approval),
    );
    const canonical: StaffSafeAiKnowledgeDocumentV1 = {
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
      createdAt: AI_GOVERNANCE_SEED_TIMESTAMPS.knowledgeCreatedAt,
      updatedAt: AI_GOVERNANCE_SEED_TIMESTAMPS.knowledgeUpdatedAt,
    };
    const secret: AiKnowledgeDocumentSecretV1 = {
      id: expected.secretId,
      workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
      documentId,
      contentFingerprint,
      approvalFingerprint,
      protectedContentRef: expected.protectedContentRef,
      protectedContentFingerprint: expected.protectedContentFingerprint,
      synthetic: true,
      schemaVersion: 1,
      createdAt: AI_GOVERNANCE_SEED_TIMESTAMPS.knowledgeSecretCreatedAt,
    };
    assertStaffSafeAiKnowledgeDocumentV1(canonical);
    assertAiKnowledgeDocumentSecretV1(secret);
    assertAiKnowledgeDocumentCrossBindingV1(
      canonical,
      content,
      approval,
      secret,
      aiGovernanceSha256,
    );
    publicDocumentById.set(documentId, canonical);
    knowledgeDocuments.push({
      id: documentId,
      canonical,
      content,
      approval,
      data: {
        ...canonical,
        approvedAt: nullableTimestamp(canonical.approvedAt),
        evaluatedAt: asTimestamp(canonical.evaluatedAt),
        effectiveFrom: nullableTimestamp(canonical.effectiveFrom),
        effectiveUntil: nullableTimestamp(canonical.effectiveUntil),
        createdAt: asTimestamp(canonical.createdAt),
        updatedAt: asTimestamp(canonical.updatedAt),
      },
    });
    knowledgeDocumentSecrets.push({
      id: secret.id,
      canonical: secret,
      data: {
        ...secret,
        createdAt: asTimestamp(secret.createdAt),
      },
    });
  }

  const knowledgeSelections: AiGovernanceSelectionSeedDocument[] = [];
  for (const selectionId of AI_KNOWLEDGE_SELECTION_IDS) {
    const documentId = AI_KNOWLEDGE_SELECTION_MATRIX[selectionId].documentId;
    const selectedDocument = publicDocumentById.get(documentId);
    if (
      selectedDocument === undefined ||
      selectedDocument.effectiveFrom === null ||
      selectedDocument.effectiveUntil === null
    ) {
      throw new Error(`AI seed selection ${selectionId} has no approved document window.`);
    }
    const binding: AiKnowledgeSelectionBindingV1 = {
      selectionId,
      workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
      documentId,
      contentFingerprint: selectedDocument.contentFingerprint,
      approvalFingerprint: selectedDocument.approvalFingerprint,
      selectorVersionId: AI_GOVERNANCE_SELECTOR_VERSION_ID,
      selectedAt: AI_GOVERNANCE_EVALUATED_AT,
      evaluatedAt: AI_GOVERNANCE_EVALUATED_AT,
      selectionScope: "retrospective_synthetic_fixture",
      effectiveFrom: selectedDocument.effectiveFrom,
      effectiveUntil: selectedDocument.effectiveUntil,
      synthetic: true,
    };
    const canonical: StaffSafeAiKnowledgeSelectionV1 = {
      ...binding,
      selectionFingerprint: aiGovernanceSha256(
        serializeAiKnowledgeSelectionV1(binding),
      ),
      schemaVersion: 1,
      createdAt: AI_GOVERNANCE_SEED_TIMESTAMPS.knowledgeSelectionCreatedAt,
    };
    assertStaffSafeAiKnowledgeSelectionV1(canonical);
    assertAiKnowledgeSelectionCrossBindingV1(
      canonical,
      selectedDocument,
      aiGovernanceSha256,
    );
    knowledgeSelections.push({
      id: selectionId,
      canonical,
      data: {
        ...canonical,
        selectedAt: asTimestamp(canonical.selectedAt),
        evaluatedAt: asTimestamp(canonical.evaluatedAt),
        effectiveFrom: asTimestamp(canonical.effectiveFrom),
        effectiveUntil: asTimestamp(canonical.effectiveUntil),
        createdAt: asTimestamp(canonical.createdAt),
      },
    });
  }

  return {
    knowledgeDocuments,
    knowledgeSelections,
    knowledgeDocumentSecrets,
  };
}

function routeForContact(contactId: string): ContactRoute {
  const route = contactRoutes.get(contactId);
  if (!route) throw new Error(`Missing deterministic route for ${contactId}.`);
  return route;
}

type Phase5SeedDocument = {
  readonly collectionName: (typeof PHASE5_COLLECTIONS)[number];
  readonly id: string;
  readonly data: Record<string, unknown>;
};

type Phase5AuditSeedDocument = {
  readonly id: string;
  readonly data: Record<string, unknown>;
};

function phase5DefinitionId(
  family: (typeof phase5AutomationFamilies)[number],
  version: (typeof phase5DefinitionVersions)[number],
): string {
  const service = family === "appointment_service" ? "appointment" : "laboratory";
  return `automation_synthetic_${service}_v${version}`;
}

function phase5AutomationSteps(family: (typeof phase5AutomationFamilies)[number]) {
  if (family === "appointment_service") {
    return [
      {
        id: "step_send_appointment_confirmation",
        kind: "send_template",
        templateVersionId: entityId<"TemplateVersion">(phase5AppointmentTemplateId),
        templateContentHash: sha256Digest(phase5AppointmentTemplateHash),
        waitSeconds: null,
        appointmentAction: null,
        routeTeamId: null,
        stopReasonCode: null,
        requiredConsentPurpose: "appointment_service",
        serviceWindowBehavior: "use_approved_template",
        timeoutSeconds: 30,
        retryMaxAttempts: 3,
        retryInitialBackoffSeconds: 30,
        retryMaximumBackoffSeconds: 300,
        fallback: "create_work_item",
      },
      {
        id: "step_request_appointment_confirmation",
        kind: "request_appointment_action",
        templateVersionId: null,
        templateContentHash: null,
        waitSeconds: null,
        appointmentAction: "confirm",
        routeTeamId: null,
        stopReasonCode: null,
        requiredConsentPurpose: "appointment_service",
        serviceWindowBehavior: "send_in_window",
        timeoutSeconds: 30,
        retryMaxAttempts: 1,
        retryInitialBackoffSeconds: 30,
        retryMaximumBackoffSeconds: 30,
        fallback: "route_to_human",
      },
      {
        id: "step_stop_appointment_complete",
        kind: "stop",
        templateVersionId: null,
        templateContentHash: null,
        waitSeconds: null,
        appointmentAction: null,
        routeTeamId: null,
        stopReasonCode: "policy_complete",
        requiredConsentPurpose: "appointment_service",
        serviceWindowBehavior: "send_in_window",
        timeoutSeconds: 5,
        retryMaxAttempts: 0,
        retryInitialBackoffSeconds: 0,
        retryMaximumBackoffSeconds: 0,
        fallback: "stop_run",
      },
    ] as const;
  }
  return [
    {
      id: "step_route_laboratory_team",
      kind: "route_to_team",
      templateVersionId: null,
      templateContentHash: null,
      waitSeconds: null,
      appointmentAction: null,
      routeTeamId: entityId<"Team">(String(DEMO_IDS.teams.laboratory)),
      stopReasonCode: null,
      requiredConsentPurpose: "laboratory_service",
      serviceWindowBehavior: "send_in_window",
      timeoutSeconds: 30,
      retryMaxAttempts: 1,
      retryInitialBackoffSeconds: 30,
      retryMaximumBackoffSeconds: 30,
      fallback: "route_to_human",
    },
    {
      id: "step_wait_laboratory_simulation",
      kind: "wait",
      templateVersionId: null,
      templateContentHash: null,
      waitSeconds: 3600,
      appointmentAction: null,
      routeTeamId: null,
      stopReasonCode: null,
      requiredConsentPurpose: "laboratory_service",
      serviceWindowBehavior: "send_in_window",
      timeoutSeconds: 5,
      retryMaxAttempts: 0,
      retryInitialBackoffSeconds: 0,
      retryMaximumBackoffSeconds: 0,
      fallback: "stop_run",
    },
    {
      id: "step_stop_laboratory_complete",
      kind: "stop",
      templateVersionId: null,
      templateContentHash: null,
      waitSeconds: null,
      appointmentAction: null,
      routeTeamId: null,
      stopReasonCode: "policy_complete",
      requiredConsentPurpose: "laboratory_service",
      serviceWindowBehavior: "send_in_window",
      timeoutSeconds: 5,
      retryMaxAttempts: 0,
      retryInitialBackoffSeconds: 0,
      retryMaximumBackoffSeconds: 0,
      fallback: "stop_run",
    },
  ] as const;
}

function phase5LifecycleIso(familyIndex: number, versionIndex: number, eventIndex: number): string {
  const base = Date.parse("2026-08-07T09:00:00.000Z");
  return new Date(
    base + (familyIndex * 60 + versionIndex * 10 + eventIndex) * 60_000,
  ).toISOString();
}

function buildPhase5SeedGraph(workspaceId: string): {
  readonly documents: readonly Phase5SeedDocument[];
  readonly audits: readonly Phase5AuditSeedDocument[];
} {
  const documents: Phase5SeedDocument[] = [];
  const audits: Phase5AuditSeedDocument[] = [];
  const approvedDefinitions = new Map<
    (typeof phase5AutomationFamilies)[number],
    { id: string; version: number; contentHash: string; approvalHash: string; secretBindingHash: string; activationEventId: string; activationAuditEventId: string; activatedAt: string }
  >();

  for (const [familyIndex, family] of phase5AutomationFamilies.entries()) {
    for (const [versionIndex, version] of phase5DefinitionVersions.entries()) {
      const definitionId = phase5DefinitionId(family, version);
      const secret = {
        workspaceId,
        definitionId,
        protectedConfigurationRef:
          family === "appointment_service"
            ? "demo://automation/configuration/synthetic-v1"
            : "demo://automation/configuration/synthetic-laboratory-v1",
        configurationFingerprint: phase5Sha256(
          `hemas-connect:synthetic-automation-configuration:${family}:v${version}`,
        ),
        schemaVersion: 1 as const,
        synthetic: true as const,
      };
      const secretBindingHash = phase5Sha256(
        serializeAutomationDefinitionSecretBinding(secret),
      );
      const content = {
        workspaceId,
        definitionId,
        family,
        version,
        name:
          family === "appointment_service"
            ? `Synthetic appointment service v${version}`
            : `Synthetic laboratory routing v${version}`,
        trigger: family === "appointment_service" ? "appointment_event" as const : "lims_report_ready" as const,
        consentPurpose: family,
        riskLevel: family === "appointment_service" ? "medium" as const : "low" as const,
        steps: phase5AutomationSteps(family),
        secretBindingHash,
        synthetic: true as const,
      };
      const contentHash = phase5Sha256(serializeAutomationDefinitionContent(content));
      const createdAtIso = phase5LifecycleIso(familyIndex, versionIndex, 0);
      const reviewAtIso = phase5LifecycleIso(familyIndex, versionIndex, 1);
      const approvedAtIso = phase5LifecycleIso(familyIndex, versionIndex, 2);
      const finalAtIso = phase5LifecycleIso(familyIndex, versionIndex, 3);
      const approvalHash = phase5Sha256(
        serializeAutomationDefinitionApproval({
          workspaceId,
          definitionId,
          contentHash,
          ownerUid: phase5AutomationOwnerUid,
          approverUid: phase5AutomationApproverUid,
          scope: "simulation_only",
          approvedAt: approvedAtIso,
        }),
      );
      const finalEventType = version === 3 ? "activated" : "retired";
      const lifecycleEvents = [
        {
          eventType: "created",
          fromLifecycleState: null,
          toLifecycleState: "draft",
          revision: 1,
          actorUid: phase5AutomationOwnerUid,
          occurredAt: createdAtIso,
          hasApproval: false,
        },
        {
          eventType: "review_requested",
          fromLifecycleState: "draft",
          toLifecycleState: "review_pending",
          revision: 2,
          actorUid: phase5AutomationOwnerUid,
          occurredAt: reviewAtIso,
          hasApproval: false,
        },
        {
          eventType: "approved",
          fromLifecycleState: "review_pending",
          toLifecycleState: "approved",
          revision: 3,
          actorUid: phase5AutomationApproverUid,
          occurredAt: approvedAtIso,
          hasApproval: true,
        },
        {
          eventType: finalEventType,
          fromLifecycleState: "approved",
          toLifecycleState: version === 3 ? "approved" : "retired",
          revision: 4,
          actorUid: phase5AutomationApproverUid,
          occurredAt: finalAtIso,
          hasApproval: true,
        },
      ] as const;

      documents.push(
        {
          collectionName: "automationDefinitions",
          id: definitionId,
          data: {
            id: definitionId,
            workspaceId,
            family,
            version,
            name: content.name,
            trigger: content.trigger,
            consentPurpose: content.consentPurpose,
            riskLevel: content.riskLevel,
            steps: content.steps.map((step) => ({ ...step })),
            contentHash,
            secretBindingHash,
            ownerUid: phase5AutomationOwnerUid,
            approverUid: phase5AutomationApproverUid,
            approvalHash,
            approvalScope: "simulation_only",
            approvedAt: asTimestamp(approvedAtIso),
            lifecycleState: version === 3 ? "approved" : "retired",
            schemaVersion: 1,
            synthetic: true,
            createdAt: asTimestamp(createdAtIso),
            updatedAt: asTimestamp(finalAtIso),
          },
        },
        {
          collectionName: "automationDefinitionSecrets",
          id: definitionId,
          data: secret,
        },
      );

      for (const lifecycle of lifecycleEvents) {
        const eventId = `automation_definition_event_${family}_${version}_${lifecycle.eventType}`;
        const auditEventId = `audit_${eventId}`;
        documents.push({
          collectionName: "automationDefinitionEvents",
          id: eventId,
          data: {
            id: eventId,
            workspaceId,
            family,
            eventType: lifecycle.eventType,
            definitionId,
            definitionVersion: version,
            definitionContentHash: contentHash,
            definitionApprovalHash: lifecycle.hasApproval ? approvalHash : null,
            definitionApprovalScope: lifecycle.hasApproval ? "simulation_only" : null,
            definitionSecretBindingHash: secretBindingHash,
            fromLifecycleState: lifecycle.fromLifecycleState,
            toLifecycleState: lifecycle.toLifecycleState,
            revision: lifecycle.revision,
            auditEventId,
            occurredAt: asTimestamp(lifecycle.occurredAt),
            schemaVersion: 1,
            synthetic: true,
            externalDispatchCount: 0,
            networkCallCount: 0,
            actorKind: "staff",
            actorUid: lifecycle.actorUid,
          },
        });
        const actionSuffix =
          lifecycle.eventType === "created"
            ? "create"
            : lifecycle.eventType === "review_requested"
              ? "request_review"
              : lifecycle.eventType === "approved"
                ? "approve"
                : lifecycle.eventType === "activated"
                  ? "activate"
                  : "retire";
        audits.push({
          id: auditEventId,
          data: {
            id: auditEventId,
            workspaceId,
            actorUid: lifecycle.actorUid,
            actorType: "user",
            action: `automation_definition.${actionSuffix}`,
            resourceType: "automation_definition",
            resourceId: definitionId,
            outcome: "allowed",
            requestId: `request_${eventId}`,
            occurredAt: asTimestamp(lifecycle.occurredAt),
            createdAt: asTimestamp(lifecycle.occurredAt),
            metadata: {
              eventId,
              revision: lifecycle.revision,
              synthetic: true,
              externalDispatchCount: 0,
              networkCallCount: 0,
            },
            synthetic: true,
            schemaVersion: 1,
          },
        });
        if (version === 3 && lifecycle.eventType === "activated") {
          approvedDefinitions.set(family, {
            id: definitionId,
            version,
            contentHash,
            approvalHash,
            secretBindingHash,
            activationEventId: eventId,
            activationAuditEventId: auditEventId,
            activatedAt: lifecycle.occurredAt,
          });
        }
      }
    }
  }

  for (const family of phase5AutomationFamilies) {
    const active = approvedDefinitions.get(family);
    if (!active) throw new Error(`Missing active Phase 5 definition for ${family}.`);
    documents.push({
      collectionName: "automationActivations",
      id: family,
      data: {
        id: family,
        workspaceId,
        family,
        activeDefinitionId: active.id,
        activeDefinitionVersion: active.version,
        activeDefinitionContentHash: active.contentHash,
        activeDefinitionApprovalHash: active.approvalHash,
        activeDefinitionApprovalScope: "simulation_only",
        activeDefinitionSecretBindingHash: active.secretBindingHash,
        activatedByUid: phase5AutomationApproverUid,
        activatedAt: asTimestamp(active.activatedAt),
        activationEventId: active.activationEventId,
        activationAuditEventId: active.activationAuditEventId,
        revision: 1,
        createdAt: asTimestamp(active.activatedAt),
        updatedAt: asTimestamp(active.activatedAt),
        schemaVersion: 1,
        synthetic: true,
        externalDispatchCount: 0,
        networkCallCount: 0,
      },
    });
  }

  const activeAppointment = approvedDefinitions.get("appointment_service");
  if (!activeAppointment) throw new Error("Missing active appointment definition.");
  const automationReceiptCreatedAt = "2026-08-07T12:30:00.000Z";
  const sourceEventFingerprint = phase5Sha256(
    serializeAutomationSourceEventIdentity({
      workspaceId,
      connectionId: String(DEMO_IDS.connections.simulator),
      eventKind: "appointment_event",
      sourceEventId: "appointment_event_synthetic_phase5_seed",
    }),
  );
  const triggerFingerprint = phase5HmacSha256(
    serializeAutomationTriggerReceiptKey({
      workspaceId,
      family: "appointment_service",
      sourceEventFingerprint,
    }),
  );
  const automationReceipt = {
    id: triggerFingerprint,
    workspaceId,
    family: "appointment_service" as const,
    definitionId: activeAppointment.id,
    definitionVersion: activeAppointment.version,
    definitionContentHash: activeAppointment.contentHash,
    definitionApprovalHash: activeAppointment.approvalHash,
    activationEventId: activeAppointment.activationEventId,
    sourceEventFingerprint,
    triggerFingerprint,
    runId: phase5AutomationRunId,
    createdAt: asTimestamp(automationReceiptCreatedAt),
    schemaVersion: 1 as const,
    synthetic: true as const,
  };
  serializeAutomationTriggerReceiptPayload({
    receiptId: automationReceipt.id,
    triggerFingerprint: automationReceipt.triggerFingerprint,
    workspaceId: automationReceipt.workspaceId,
    family: automationReceipt.family,
    definitionId: automationReceipt.definitionId,
    definitionVersion: automationReceipt.definitionVersion,
    definitionContentHash: automationReceipt.definitionContentHash,
    definitionApprovalHash: automationReceipt.definitionApprovalHash,
    activationEventId: automationReceipt.activationEventId,
    sourceEventFingerprint: automationReceipt.sourceEventFingerprint,
    runId: automationReceipt.runId,
    createdAt: automationReceiptCreatedAt,
    schemaVersion: 1,
    synthetic: true,
  });
  documents.push(
    {
      collectionName: "automationTriggerReceipts",
      id: automationReceipt.id,
      data: automationReceipt,
    },
    {
      collectionName: "automationRuns",
      id: phase5AutomationRunId,
      data: {
        id: phase5AutomationRunId,
        workspaceId,
        definitionId: activeAppointment.id,
        definitionVersion: activeAppointment.version,
        definitionContentHash: activeAppointment.contentHash,
        teamId: String(DEMO_IDS.teams.general),
        locationId: String(DEMO_IDS.locations.wattala),
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
        schemaVersion: 1,
        synthetic: true,
        externalDispatchCount: 0,
        networkCallCount: 0,
        createdAt: asTimestamp(automationReceiptCreatedAt),
        updatedAt: asTimestamp(automationReceiptCreatedAt),
      },
    },
    {
      collectionName: "automationRunSecrets",
      id: phase5AutomationRunId,
      data: {
        workspaceId,
        runId: phase5AutomationRunId,
        protectedContactRef: "demo://automation/contact/synthetic-v1",
        protectedConversationRef: "demo://automation/conversation/synthetic-v1",
        protectedAppointmentRef: "demo://automation/appointment/synthetic-v1",
        triggerFingerprint,
        idempotencyFingerprint: phase5HmacSha256(
          `hemas-connect:automation-seed-idempotency:${workspaceId}:${phase5AutomationRunId}`,
        ),
        schemaVersion: 1,
        synthetic: true,
      },
    },
  );

  const careSecret = {
    workspaceId,
    pathwayId: phase5CarePathwayId,
    protectedInstructionsRef: "demo://care/instructions/post-discharge-v1",
    protectedContentFingerprint: phase5Sha256(
      "hemas-connect:synthetic-clinician-authored-post-discharge-instructions:v1",
    ),
    schemaVersion: 1 as const,
    synthetic: true as const,
  };
  const careSecretBindingHash = phase5Sha256(serializeCarePathwaySecretBinding(careSecret));
  const careContactPoints = [
    {
      dayOffset: 1,
      en: { templateVersionId: entityId<"TemplateVersion">("template_synthetic_care_day1_en_v1"), contentHash: sha256Digest(phase5CareTemplateHashes.day1.en) },
      si: { templateVersionId: entityId<"TemplateVersion">("template_synthetic_care_day1_si_v1"), contentHash: sha256Digest(phase5CareTemplateHashes.day1.si) },
      ta: { templateVersionId: entityId<"TemplateVersion">("template_synthetic_care_day1_ta_v1"), contentHash: sha256Digest(phase5CareTemplateHashes.day1.ta) },
    },
    {
      dayOffset: 3,
      en: { templateVersionId: entityId<"TemplateVersion">("template_synthetic_care_day3_en_v1"), contentHash: sha256Digest(phase5CareTemplateHashes.day3.en) },
      si: { templateVersionId: entityId<"TemplateVersion">("template_synthetic_care_day3_si_v1"), contentHash: sha256Digest(phase5CareTemplateHashes.day3.si) },
      ta: { templateVersionId: entityId<"TemplateVersion">("template_synthetic_care_day3_ta_v1"), contentHash: sha256Digest(phase5CareTemplateHashes.day3.ta) },
    },
  ] as const;
  const careApprovedAt = "2026-08-07T13:02:00.000Z";
  const careActivatedAt = "2026-08-07T13:03:00.000Z";
  const careContent = {
    workspaceId,
    pathwayId: phase5CarePathwayId,
    family: "post_discharge" as const,
    protocolVersion: "v1.0",
    name: "Synthetic post-discharge follow-up",
    clinicalOwnerUid: phase5ClinicalOwnerUid,
    contactPoints: careContactPoints,
    responseSlaMinutes: 15,
    escalationTeamId: entityId<"Team">(String(DEMO_IDS.teams.clinicalEscalation)),
    eligibleLocationIds: [
      entityId<"Location">(String(DEMO_IDS.locations.thalawathugoda)),
      entityId<"Location">(String(DEMO_IDS.locations.wattala)),
    ],
    afterHoursBehavior: "on_call_queue" as const,
    writeBackRequired: true,
    instructionsSource: "clinician_authored" as const,
    aiMayGenerateInstructions: false as const,
    suppressions: [
      "readmission", "transfer", "death", "clinical_hold", "withdrawal", "invalid_contact",
    ] as const,
    protectedContentHash: careSecret.protectedContentFingerprint,
    secretBindingHash: careSecretBindingHash,
    synthetic: true as const,
  };
  const careContentHash = phase5Sha256(serializeCarePathwayContent(careContent));
  const careApprovalHash = phase5Sha256(
    serializeCarePathwayApproval({
      workspaceId,
      pathwayId: phase5CarePathwayId,
      contentHash: careContentHash,
      clinicalOwnerUid: phase5ClinicalOwnerUid,
      clinicalApproverUid: phase5ClinicalApproverUid,
      scope: "clinical_simulation_only",
      approvedAt: careApprovedAt,
    }),
  );
  documents.push(
    {
      collectionName: "carePathways",
      id: phase5CarePathwayId,
      data: {
        id: phase5CarePathwayId,
        workspaceId,
        family: "post_discharge",
        protocolVersion: careContent.protocolVersion,
        name: careContent.name,
        clinicalOwnerUid: phase5ClinicalOwnerUid,
        clinicalApproverUid: phase5ClinicalApproverUid,
        contactPoints: careContactPoints.map((point) => ({
          ...point,
          en: { ...point.en }, si: { ...point.si }, ta: { ...point.ta },
        })),
        responseSlaMinutes: careContent.responseSlaMinutes,
        escalationTeamId: careContent.escalationTeamId,
        eligibleLocationIds: [...careContent.eligibleLocationIds],
        afterHoursBehavior: careContent.afterHoursBehavior,
        writeBackRequired: careContent.writeBackRequired,
        instructionsSource: careContent.instructionsSource,
        aiMayGenerateInstructions: careContent.aiMayGenerateInstructions,
        suppressions: [...careContent.suppressions],
        protectedContentHash: careContent.protectedContentHash,
        secretBindingHash: careSecretBindingHash,
        contentHash: careContentHash,
        approvalHash: careApprovalHash,
        approvalScope: "clinical_simulation_only",
        approvedAt: asTimestamp(careApprovedAt),
        lifecycleState: "approved",
        schemaVersion: 1,
        synthetic: true,
        createdAt: asTimestamp("2026-08-07T13:00:00.000Z"),
        updatedAt: asTimestamp(careActivatedAt),
      },
    },
    { collectionName: "carePathwaySecrets", id: phase5CarePathwayId, data: careSecret },
  );

  const careLifecycleEvents = [
    { eventType: "created", from: null, to: "draft", revision: 1, actorUid: phase5ClinicalOwnerUid, at: "2026-08-07T13:00:00.000Z", hasApproval: false },
    { eventType: "clinical_review_requested", from: "draft", to: "clinical_review", revision: 2, actorUid: phase5ClinicalOwnerUid, at: "2026-08-07T13:01:00.000Z", hasApproval: false },
    { eventType: "approved", from: "clinical_review", to: "approved", revision: 3, actorUid: phase5ClinicalApproverUid, at: careApprovedAt, hasApproval: true },
    { eventType: "activated", from: "approved", to: "approved", revision: 4, actorUid: phase5ClinicalApproverUid, at: careActivatedAt, hasApproval: true },
  ] as const;
  let careActivationEventId = "";
  let careActivationAuditId = "";
  for (const lifecycle of careLifecycleEvents) {
    const eventId = `care_pathway_event_post_discharge_${lifecycle.eventType}`;
    const auditEventId = `audit_${eventId}`;
    documents.push({
      collectionName: "carePathwayEvents",
      id: eventId,
      data: {
        id: eventId,
        workspaceId,
        family: "post_discharge",
        eventType: lifecycle.eventType,
        pathwayId: phase5CarePathwayId,
        pathwayProtocolVersion: careContent.protocolVersion,
        pathwayContentHash: careContentHash,
        pathwayApprovalHash: lifecycle.hasApproval ? careApprovalHash : null,
        pathwayApprovalScope: lifecycle.hasApproval ? "clinical_simulation_only" : null,
        pathwaySecretBindingHash: careSecretBindingHash,
        fromLifecycleState: lifecycle.from,
        toLifecycleState: lifecycle.to,
        revision: lifecycle.revision,
        auditEventId,
        occurredAt: asTimestamp(lifecycle.at),
        schemaVersion: 1,
        synthetic: true,
        externalDispatchCount: 0,
        networkCallCount: 0,
        actorKind: "staff",
        actorUid: lifecycle.actorUid,
      },
    });
    const actionSuffix =
      lifecycle.eventType === "created"
        ? "create"
        : lifecycle.eventType === "clinical_review_requested"
          ? "request_clinical_review"
          : lifecycle.eventType === "approved"
            ? "approve"
            : "activate";
    audits.push({
      id: auditEventId,
      data: {
        id: auditEventId,
        workspaceId,
        actorUid: lifecycle.actorUid,
        actorType: "user",
        action: `care_pathway.${actionSuffix}`,
        resourceType: "care_pathway",
        resourceId: phase5CarePathwayId,
        outcome: "allowed",
        requestId: `request_${eventId}`,
        occurredAt: asTimestamp(lifecycle.at),
        createdAt: asTimestamp(lifecycle.at),
        metadata: {
          eventId,
          revision: lifecycle.revision,
          synthetic: true,
          externalDispatchCount: 0,
          networkCallCount: 0,
        },
        synthetic: true,
        schemaVersion: 1,
      },
    });
    if (lifecycle.eventType === "activated") {
      careActivationEventId = eventId;
      careActivationAuditId = auditEventId;
    }
  }
  documents.push({
    collectionName: "carePathwayActivations",
    id: "post_discharge",
    data: {
      id: "post_discharge",
      workspaceId,
      family: "post_discharge",
      activePathwayId: phase5CarePathwayId,
      activeProtocolVersion: careContent.protocolVersion,
      activePathwayContentHash: careContentHash,
      activePathwayApprovalHash: careApprovalHash,
      activePathwayApprovalScope: "clinical_simulation_only",
      activePathwaySecretBindingHash: careSecretBindingHash,
      activatedByUid: phase5ClinicalApproverUid,
      activatedAt: asTimestamp(careActivatedAt),
      activationEventId: careActivationEventId,
      activationAuditEventId: careActivationAuditId,
      revision: 1,
      createdAt: asTimestamp(careActivatedAt),
      updatedAt: asTimestamp(careActivatedAt),
      schemaVersion: 1,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
    },
  });

  const qualifyingDischargeAt = "2026-08-06T00:00:00.000Z";
  const careReceiptCreatedAt = "2026-08-07T13:04:00.000Z";
  const dischargeFingerprint = phase5Sha256(
    serializeCareDischargeSourceIdentity({
      workspaceId,
      sourceSystem: "simulator",
      connectionId: String(DEMO_IDS.connections.simulator),
      dischargeEventId: "discharge_event_synthetic_phase5_001",
    }),
  );
  const careReceiptFingerprint = phase5HmacSha256(
    serializeCareEnrollmentReceiptKey({
      workspaceId,
      family: "post_discharge",
      dischargeFingerprint,
    }),
  );
  const careReceipt = {
    id: careReceiptFingerprint,
    workspaceId,
    family: "post_discharge" as const,
    pathwayId: phase5CarePathwayId,
    pathwayProtocolVersion: careContent.protocolVersion,
    pathwayContentHash: careContentHash,
    pathwayApprovalHash: careApprovalHash,
    activationEventId: careActivationEventId,
    dischargeFingerprint,
    qualifyingDischargeAt: asTimestamp(qualifyingDischargeAt),
    receiptFingerprint: careReceiptFingerprint,
    enrollmentId: phase5CareEnrollmentId,
    createdAt: asTimestamp(careReceiptCreatedAt),
    schemaVersion: 1 as const,
    synthetic: true as const,
  };
  serializeCareEnrollmentReceiptPayload({
    receiptId: careReceipt.id,
    receiptFingerprint: careReceipt.receiptFingerprint,
    workspaceId: careReceipt.workspaceId,
    family: careReceipt.family,
    pathwayId: careReceipt.pathwayId,
    pathwayProtocolVersion: careReceipt.pathwayProtocolVersion,
    pathwayContentHash: careReceipt.pathwayContentHash,
    pathwayApprovalHash: careReceipt.pathwayApprovalHash,
    activationEventId: careReceipt.activationEventId,
    dischargeFingerprint: careReceipt.dischargeFingerprint,
    qualifyingDischargeAt,
    enrollmentId: careReceipt.enrollmentId,
    createdAt: careReceiptCreatedAt,
    schemaVersion: 1,
    synthetic: true,
  });
  documents.push(
    { collectionName: "careEnrollmentReceipts", id: careReceipt.id, data: careReceipt },
    {
      collectionName: "careEnrollments",
      id: phase5CareEnrollmentId,
      data: {
        id: phase5CareEnrollmentId,
        workspaceId,
        pathwayId: phase5CarePathwayId,
        pathwayProtocolVersion: careContent.protocolVersion,
        pathwayContentHash: careContentHash,
        teamId: String(DEMO_IDS.teams.clinicalEscalation),
        locationId: String(DEMO_IDS.locations.wattala),
        state: "queued",
        nextContactIndex: 0,
        nextContactAt: asTimestamp("2026-08-07T00:00:00.000Z"),
        activeSuppressions: [],
        openEscalationId: null,
        safetyHoldEscalationId: null,
        openHandoffId: null,
        revision: 1,
        outcomeCode: "accepted",
        lastEventId: null,
        schemaVersion: 1,
        synthetic: true,
        externalDispatchCount: 0,
        networkCallCount: 0,
        createdAt: asTimestamp(careReceiptCreatedAt),
        updatedAt: asTimestamp(careReceiptCreatedAt),
      },
    },
    {
      collectionName: "careEnrollmentSecrets",
      id: phase5CareEnrollmentId,
      data: {
        workspaceId,
        enrollmentId: phase5CareEnrollmentId,
        protectedContactRef: "demo://care/contact/synthetic-001",
        protectedConversationRef: "demo://care/conversation/synthetic-001",
        protectedQualifyingDischargeRef: "demo://care/discharge/synthetic-001",
        qualifyingDischargeAt: asTimestamp(qualifyingDischargeAt),
        subjectFingerprint: phase5HmacSha256(
          `hemas-connect:care-subject:${workspaceId}:${String(DEMO_IDS.contacts.urgent)}`,
        ),
        sourceDischargeFingerprint: dischargeFingerprint,
        receiptId: careReceipt.id,
        receiptFingerprint: careReceipt.receiptFingerprint,
        schemaVersion: 1,
        synthetic: true,
      },
    },
  );

  if (documents.length !== 51 || audits.length !== 28) {
    throw new Error(
      `Phase 5 seed graph drifted: expected 51 collection documents and 28 audits; received ${documents.length} and ${audits.length}.`,
    );
  }
  if (
    PHASE5_COLLECTIONS.length !== 23 ||
    PHASE5_STAFF_COLLECTIONS.length !== 13 ||
    PHASE5_SECRET_COLLECTIONS.length !== 10
  ) {
    throw new Error("Phase 5 collection constants drifted from the frozen 13+10 split.");
  }
  return { documents, audits };
}

async function authRequest(endpoint: "signUp" | "signInWithPassword"): Promise<AuthResponse> {
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:${endpoint}?key=demo-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  return (await response.json()) as AuthResponse;
}

async function ensureSyntheticAuthUser(): Promise<string> {
  const signup = await authRequest("signUp");
  if (signup.localId) return signup.localId;

  if (signup.error?.message?.includes("EMAIL_EXISTS")) {
    const signin = await authRequest("signInWithPassword");
    if (signin.localId) return signin.localId;
    throw new Error(`Could not sign in existing synthetic user: ${signin.error?.message ?? "unknown"}`);
  }

  throw new Error(`Could not create synthetic Auth user: ${signup.error?.message ?? "unknown"}`);
}

async function assertClientDenied(
  operation: () => Promise<unknown>,
  label: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if ((error as { code?: unknown }).code === "permission-denied") return;
    throw error;
  }
  throw new Error(`${label} unexpectedly allowed a direct client read.`);
}

async function seedSyntheticGraph(db: Firestore, uid: string): Promise<void> {
  const safeNetWorkspaceId = String(DEMO_IDS.workspaces.safeNet);
  const createdAt = asTimestamp(DEMO_CLOCK.created);
  const updatedAt = asTimestamp(DEMO_CLOCK.recent);
  // Phase 5 callable controls require native, MFA-backed authentication evidence
  // no older than fifteen minutes. This value is intentionally regenerated for
  // every emulator seed run and is not a production credential or session.
  const authEvidenceAt = Timestamp.now();

  const writes: Promise<void>[] = [];

  for (const workspace of demoWorkspaces) {
    writes.push(
      setDoc(doc(db, "workspaces", String(workspace.id)), {
        id: String(workspace.id),
        name: workspace.name,
        mode: workspace.mode,
        status: workspace.status,
        timeZone: String(workspace.timeZone),
        supportedLanguages: [...workspace.supportedLanguages],
        defaultLanguage: workspace.defaultLanguage,
        retentionPolicyVersion: workspace.retentionPolicyVersion,
        dataClassification: workspace.dataClassification,
        externalMessaging: {
          ...workspace.externalMessaging,
          allowlistedRecipientHashes: [...workspace.externalMessaging.allowlistedRecipientHashes],
          capacityVerifiedAt: nullableTimestamp(workspace.externalMessaging.capacityVerifiedAt),
        },
        isSyntheticDemo: workspace.isSyntheticDemo,
        createdAt: asTimestamp(workspace.createdAt),
        updatedAt: asTimestamp(workspace.updatedAt),
      }),
    );
  }

  // Auth UIDs are the only valid membership document IDs. The locked Hemas
  // workspace intentionally receives no membership or patient documents.
  writes.push(
    setDoc(doc(db, "workspaces", safeNetWorkspaceId, "members", uid), {
      id: uid,
      uid,
      workspaceId: safeNetWorkspaceId,
      displayLabel: "Demo tenant administrator",
      role: "tenant_admin",
      status: "active",
      scopeMode: "workspace_wide",
      teamIds: [],
      locationIds: [],
      mfaSatisfied: true,
      lastAuthenticatedAt: authEvidenceAt,
      synthetic: true,
      createdAt,
      updatedAt,
    }),
    setDoc(
      doc(db, "workspaces", safeNetWorkspaceId, "members", seededCampaignOwnerId),
      {
        id: seededCampaignOwnerId,
        uid: seededCampaignOwnerId,
        workspaceId: safeNetWorkspaceId,
        displayLabel: "Synthetic campaign operator",
        role: "campaign_operator",
        status: "active",
        scopeMode: "assigned",
        teamIds: [],
        locationIds: [],
        mfaSatisfied: true,
        lastAuthenticatedAt: authEvidenceAt,
        synthetic: true,
        createdAt,
        updatedAt,
      },
    ),
    setDoc(
      doc(db, "workspaces", safeNetWorkspaceId, "members", seededCampaignApproverId),
      {
        id: seededCampaignApproverId,
        uid: seededCampaignApproverId,
        workspaceId: safeNetWorkspaceId,
        displayLabel: "Synthetic campaign approver",
        role: "campaign_approver",
        status: "active",
        scopeMode: "assigned",
        teamIds: [],
        locationIds: [],
        mfaSatisfied: true,
        lastAuthenticatedAt: authEvidenceAt,
        synthetic: true,
        createdAt,
        updatedAt,
      },
    ),
    setDoc(
      doc(db, "workspaces", safeNetWorkspaceId, "members", phase5AutomationOwnerUid),
      {
        id: phase5AutomationOwnerUid,
        uid: phase5AutomationOwnerUid,
        workspaceId: safeNetWorkspaceId,
        displayLabel: "Synthetic Phase 5 tenant administrator",
        role: "tenant_admin",
        status: "active",
        scopeMode: "workspace_wide",
        teamIds: [],
        locationIds: [],
        mfaSatisfied: true,
        lastAuthenticatedAt: authEvidenceAt,
        synthetic: true,
        createdAt,
        updatedAt,
      },
    ),
    setDoc(
      doc(db, "workspaces", safeNetWorkspaceId, "members", phase5AutomationApproverUid),
      {
        id: phase5AutomationApproverUid,
        uid: phase5AutomationApproverUid,
        workspaceId: safeNetWorkspaceId,
        displayLabel: "Synthetic Phase 5 automation supervisor",
        role: "supervisor",
        status: "active",
        scopeMode: "assigned",
        teamIds: [
          String(DEMO_IDS.teams.general),
          String(DEMO_IDS.teams.laboratory),
        ],
        locationIds: [
          String(DEMO_IDS.locations.wattala),
          String(DEMO_IDS.locations.thalawathugoda),
          String(DEMO_IDS.locations.labNetwork),
        ],
        mfaSatisfied: true,
        lastAuthenticatedAt: authEvidenceAt,
        synthetic: true,
        createdAt,
        updatedAt,
      },
    ),
    setDoc(
      doc(db, "workspaces", safeNetWorkspaceId, "members", phase5ClinicalApproverUid),
      {
        id: phase5ClinicalApproverUid,
        uid: phase5ClinicalApproverUid,
        workspaceId: safeNetWorkspaceId,
        displayLabel: "Synthetic Phase 5 clinical approver",
        role: "clinical_approver",
        status: "active",
        scopeMode: "assigned",
        teamIds: [String(DEMO_IDS.teams.clinicalEscalation)],
        locationIds: [
          String(DEMO_IDS.locations.wattala),
          String(DEMO_IDS.locations.thalawathugoda),
        ],
        mfaSatisfied: true,
        lastAuthenticatedAt: authEvidenceAt,
        synthetic: true,
        createdAt,
        updatedAt,
      },
    ),
  );

  for (const team of demoTeams) {
    writes.push(
      setDoc(doc(db, "workspaces", safeNetWorkspaceId, "teams", String(team.id)), {
        id: String(team.id),
        workspaceId: safeNetWorkspaceId,
        name: team.name,
        queueType: team.queueType,
        locationIds: team.locationIds.map(String),
        businessHoursLabel: team.businessHoursLabel,
        firstResponseSlaMinutes: team.firstResponseSlaMinutes,
        active: team.active,
        createdAt: asTimestamp(team.createdAt),
        updatedAt: asTimestamp(team.updatedAt),
      }),
    );
  }

  for (const location of demoLocations) {
    writes.push(
      setDoc(doc(db, "workspaces", safeNetWorkspaceId, "locations", String(location.id)), {
        id: String(location.id),
        workspaceId: safeNetWorkspaceId,
        name: location.name,
        kind: location.kind,
        city: location.city,
        supportedServiceRefs: [...location.supportedServiceRefs],
        active: location.active,
        createdAt: asTimestamp(location.createdAt),
        updatedAt: asTimestamp(location.updatedAt),
      }),
    );
  }

  if (
    safeNetWorkspaceId !== DEMO_CONNECTION_WORKSPACE_ID ||
    String(DEMO_IDS.connections.simulator) !== DEMO_WHATSAPP_CONNECTION_ID
  ) {
    throw new Error("Synthetic connection IDs drifted from the governed v1 catalogue.");
  }
  const connectionCentreSeed = buildDemoConnectionCentreSeed();
  for (const connection of connectionCentreSeed.whatsappConnections) {
    writes.push(
      setDoc(
        doc(
          db,
          "workspaces",
          safeNetWorkspaceId,
          "whatsappConnections",
          connection.id,
        ),
        whatsappConnectionForFirestore(connection),
      ),
    );
  }
  for (const integration of connectionCentreSeed.integrations) {
    writes.push(
      setDoc(
        doc(
          db,
          "workspaces",
          safeNetWorkspaceId,
          "integrations",
          integration.id,
        ),
        integrationForFirestore(integration),
      ),
    );
  }

  for (const template of templateCatalogueSeeds) {
    const id = `template_${template.assetKey}_${template.language}_v${template.version}`;
    const components = template.components.map((component) => ({ ...component }));
    const variableRules = template.variableRules.map(
      ([key, description, maxLength, exampleValue, allowedPattern]) => ({
        key,
        description,
        required: true,
        maxLength,
        exampleValue,
        allowedPattern,
      }),
    );
    const contentBinding = {
      workspaceId: safeNetWorkspaceId,
      id,
      assetKey: template.assetKey,
      providerName: template.assetKey,
      category: template.category,
      language: template.language,
      version: template.version,
      components,
      variableRules,
    } as const;
    const contentSerialization = serializeTemplateContentBinding(contentBinding);
    const contentHash = computeSeedTemplateContentHash(contentBinding);
    if (
      template.assetKey === "wellness_awareness" &&
      template.version === 3 &&
      (
        contentSerialization !==
          seededCampaignTemplateContentSerializations[template.language] ||
        contentHash !== seededCampaignTemplateContentHashes[template.language]
      )
    ) {
      throw new Error(`Campaign template ${id} drifted from its golden content binding.`);
    }
    writes.push(
      setDoc(doc(db, "workspaces", safeNetWorkspaceId, "templates", id), {
        id,
        workspaceId: safeNetWorkspaceId,
        assetKey: template.assetKey,
        sortKey: `${template.assetKey}:${template.language}:${String(template.version).padStart(4, "0")}`,
        providerName: template.assetKey,
        category: template.category,
        language: template.language,
        version: template.version,
        localState: template.localState,
        providerState: unverifiedProviderState(),
        immutable: template.localState !== "draft",
        contentHash,
        components,
        variableRules,
        ownership: syntheticCatalogueOwnership(safeNetWorkspaceId),
        synthetic: true,
        schemaVersion: 1,
        createdAt,
        updatedAt,
      }),
    );
  }

  const campaignApprovalBinding = {
    workspaceId: safeNetWorkspaceId,
    campaignId: seededCampaignId,
    audienceSnapshotId: seededAudienceSnapshotId,
    snapshotContentHash: seededAudienceContentHash,
    templateVersionIds: seededCampaignTemplateVersionIds,
    templateContentHashes: seededCampaignTemplateContentHashes,
    purpose: "health_campaigns" as const,
    messageCategory: "marketing" as const,
    targetAction: "Open the synthetic wellness information journey",
    schedule: {
      startsAtIso: seededCampaignStartsAtIso,
      timeZone: "Asia/Colombo" as const,
      quietHours: { startsAtLocal: "20:00", endsAtLocal: "08:00" },
    },
  };
  const campaignApprovalHash = computeSeedCampaignApprovalHash(campaignApprovalBinding);
  const campaignSeedBatch = writeBatch(db);
  campaignSeedBatch.set(
    doc(db, "workspaces", safeNetWorkspaceId, "campaigns", seededCampaignId),
    {
      id: seededCampaignId,
      workspaceId: safeNetWorkspaceId,
      name: "Synthetic 50,000-contact wellness awareness simulation",
      purpose: campaignApprovalBinding.purpose,
      messageCategory: campaignApprovalBinding.messageCategory,
      targetAction: campaignApprovalBinding.targetAction,
      ownerId: seededCampaignOwnerId,
      templateVersionIds: { ...seededCampaignTemplateVersionIds },
      audienceSnapshotId: seededAudienceSnapshotId,
      state: "scheduled",
      dispatchMode: "simulation",
      schedule: {
        startsAt: Timestamp.fromDate(new Date(seededCampaignStartsAtIso)),
        timeZone: campaignApprovalBinding.schedule.timeZone,
        quietHours: { ...campaignApprovalBinding.schedule.quietHours },
      },
      approval: {
        required: true,
        status: "approved",
        scope: "simulation_only",
        approverId: seededCampaignApproverId,
        reviewedAt: updatedAt,
        approvedContentHash: campaignApprovalHash,
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
      createdAt,
      updatedAt,
    },
  );
  campaignSeedBatch.set(
    doc(
      db,
      "workspaces",
      safeNetWorkspaceId,
      "audienceSnapshots",
      seededAudienceSnapshotId,
    ),
    {
      id: seededAudienceSnapshotId,
      workspaceId: safeNetWorkspaceId,
      campaignId: seededCampaignId,
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
      contentHash: seededAudienceContentHash,
      immutable: true,
      synthetic: true,
      schemaVersion: 1,
      finalizedAt: updatedAt,
      createdAt: updatedAt,
      updatedAt,
    },
  );

  for (const flow of flowCatalogueBlueprints) {
    for (const flowLanguage of catalogueLanguages) {
      const id = `flow_${flow.assetKey}_${flowLanguage}_v1`;
      writes.push(
        setDoc(doc(db, "workspaces", safeNetWorkspaceId, "flows", id), {
          id,
          workspaceId: safeNetWorkspaceId,
          assetKey: flow.assetKey,
          sortKey: `${flow.assetKey}:${flowLanguage}:0001`,
          definitionId: flow.definitionId,
          displayName: flow.displayName,
          language: flowLanguage,
          version: 1,
          localState: flow.localState,
          providerState: unverifiedProviderState(),
          endpointMode: "endpoint_powered",
          immutable: flow.localState !== "draft",
          screenIds: [...flow.screenIds],
          fallbackMode: "controlled_web_or_human",
          acceptsProviderPayloads: false,
          performsNetworkCalls: false,
          confirmsHemasTransaction: false,
          ownership: syntheticCatalogueOwnership(safeNetWorkspaceId),
          synthetic: true,
          schemaVersion: 1,
          createdAt,
          updatedAt,
        }),
      );
    }
  }

  for (const [index, contact] of demoContacts.entries()) {
    const contactId = String(contact.id);
    const route = routeForContact(contactId);
    writes.push(
      setDoc(doc(db, "workspaces", safeNetWorkspaceId, "contacts", contactId), {
        id: contactId,
        workspaceId: safeNetWorkspaceId,
        teamId: route.teamId,
        locationId: route.locationId,
        maskedPhone: `Synthetic contact ${String.fromCharCode(65 + index)} · no phone stored`,
        displayLabel: contact.displayLabel,
        preferredLanguage: contact.preferredLanguage,
        alternateLanguages: [...contact.alternateLanguages],
        suppression: {
          ...contact.suppression,
          reasons: [...contact.suppression.reasons],
          updatedAt: asTimestamp(contact.suppression.updatedAt),
        },
        tags: [...contact.tags],
        preferenceRevision: 0,
        synthetic: true,
        createdAt: asTimestamp(contact.createdAt),
        updatedAt: asTimestamp(contact.updatedAt),
      }),
      setDoc(doc(db, "workspaces", safeNetWorkspaceId, "contactSecrets", contactId), {
        id: contactId,
        workspaceId: safeNetWorkspaceId,
        contactId,
        phoneLookupHmac: String(contact.phoneLookupHmac),
        encryptedPhoneRef: String(contact.encryptedPhoneRef),
        encryptedDisplayNameRef:
          contact.encryptedDisplayNameRef === null
            ? null
            : String(contact.encryptedDisplayNameRef),
        externalPatientRef:
          contact.externalPatientRef === null ? null : String(contact.externalPatientRef),
        synthetic: true,
        schemaVersion: 1,
        createdAt: asTimestamp(contact.createdAt),
        updatedAt: asTimestamp(contact.updatedAt),
      }),
    );
  }

  for (const consent of demoConsentRecords) {
    const contactId = String(consent.contactId);
    const route = routeForContact(contactId);
    writes.push(
      setDoc(
        doc(db, "workspaces", safeNetWorkspaceId, "consentRecords", String(consent.id)),
        {
          id: String(consent.id),
          workspaceId: safeNetWorkspaceId,
          contactId,
          teamId: route.teamId,
          locationId: route.locationId,
          purpose: consent.purpose,
          channel: consent.channel,
          category: consent.category,
          status: consent.status,
          source: consent.source,
          noticeVersion: consent.noticeVersion,
          language: consent.language,
          evidenceRef: consent.evidenceRef,
          capturedAt: asTimestamp(consent.capturedAt),
          withdrawnAt: nullableTimestamp(consent.withdrawnAt),
          supersedesRecordId:
            consent.supersedesRecordId === null ? null : String(consent.supersedesRecordId),
          synthetic: true,
          schemaVersion: 1,
          createdAt: asTimestamp(consent.createdAt),
          updatedAt: asTimestamp(consent.updatedAt),
        },
      ),
    );
  }

  // Preserve the legacy service-category fixture while adding the exact
  // utility-category evidence required by the Phase 5 appointment executor.
  writes.push(
    setDoc(
      doc(
        db,
        "workspaces",
        safeNetWorkspaceId,
        "consentRecords",
        phase5AppointmentUtilityConsentId,
      ),
      {
        id: phase5AppointmentUtilityConsentId,
        workspaceId: safeNetWorkspaceId,
        contactId: String(DEMO_IDS.contacts.appointment),
        teamId: String(DEMO_IDS.teams.general),
        locationId: String(DEMO_IDS.locations.wattala),
        purpose: "appointment_service",
        channel: "whatsapp",
        category: "utility",
        status: "granted",
        source: "synthetic_fixture",
        noticeVersion: "demo-utility-notice-v1",
        language: "en",
        evidenceRef: "demo://consent/appointment-utility-phase5",
        capturedAt: updatedAt,
        withdrawnAt: null,
        supersedesRecordId: null,
        synthetic: true,
        schemaVersion: 1,
        createdAt: updatedAt,
        updatedAt,
      },
    ),
  );

  for (const conversation of demoConversations) {
    const contactId = String(conversation.contactId);
    const route = routeForContact(contactId);
    writes.push(
      setDoc(
        doc(db, "workspaces", safeNetWorkspaceId, "conversations", String(conversation.id)),
        {
          id: String(conversation.id),
          workspaceId: safeNetWorkspaceId,
          contactId,
          connectionId: String(conversation.connectionId),
          teamId: String(conversation.teamId),
          locationId: route.locationId,
          status: conversation.status,
          mode: conversation.mode,
          assigneeId: conversation.assigneeId === null ? null : uid,
          detectedLanguage: conversation.detectedLanguage,
          languageConfidence: conversation.languageConfidence,
          purpose: conversation.purpose,
          serviceWindowExpiresAt: nullableTimestamp(conversation.serviceWindowExpiresAt),
          firstResponseDueAt: asTimestamp(conversation.firstResponseDueAt),
          lastMessageAt: asTimestamp(conversation.lastMessageAt),
          handoffSummary: conversation.handoffSummary,
          unreadCount: conversation.unreadCount,
          synthetic: true,
          createdAt: asTimestamp(conversation.createdAt),
          updatedAt: asTimestamp(conversation.updatedAt),
        },
      ),
    );
  }

  for (const message of demoMessages) {
    const contactId = String(message.contactId);
    const route = routeForContact(contactId);
    writes.push(
      setDoc(doc(db, "workspaces", safeNetWorkspaceId, "messages", String(message.id)), {
        id: String(message.id),
        workspaceId: safeNetWorkspaceId,
        conversationId: String(message.conversationId),
        contactId,
        teamId: route.teamId,
        locationId: route.locationId,
        direction: message.direction,
        type: message.type,
        status: message.status,
        externalDispatch: message.externalDispatch,
        actorId: message.actorId === null ? null : String(message.actorId),
        receivedAt: nullableTimestamp(message.receivedAt),
        sentAt: nullableTimestamp(message.sentAt),
        deliveredAt: nullableTimestamp(message.deliveredAt),
        metadataOnly: true,
        synthetic: true,
        schemaVersion: 1,
        createdAt: asTimestamp(message.createdAt),
        updatedAt: asTimestamp(message.updatedAt),
      }),
    );
  }

  const appointment = demoAppointments[0];
  if (!appointment) throw new Error("Synthetic appointment fixture is missing.");
  writes.push(
    setDoc(
      doc(db, "workspaces", safeNetWorkspaceId, "appointments", String(appointment.id)),
      {
        id: String(appointment.id),
        workspaceId: safeNetWorkspaceId,
        conversationId: String(DEMO_IDS.conversations.appointment),
        contactId: String(appointment.contactId),
        teamId: String(DEMO_IDS.teams.general),
        locationId: String(appointment.locationId),
        externalAppointmentRef: String(appointment.externalAppointmentRef),
        serviceRef: appointment.serviceRef,
        practitionerDisplayLabel: appointment.practitionerDisplayLabel,
        slotStartsAt: asTimestamp(appointment.slot.startsAt),
        slotEndsAt: asTimestamp(appointment.slot.endsAt),
        slotTimeZone: String(appointment.slot.timeZone),
        status: appointment.status,
        syncState: appointment.syncState,
        reminderState: {
          confirmation: "simulated",
          twentyFourHour: "scheduled",
          twoHour: "scheduled",
        },
        authoritativeSystem: "simulator",
        lastSyncedAt: nullableTimestamp(appointment.lastSyncedAt),
        revision: 0,
        lastActionId: null,
        synthetic: true,
        schemaVersion: 1,
        createdAt: asTimestamp(appointment.createdAt),
        updatedAt: asTimestamp(appointment.updatedAt),
      },
    ),
    setDoc(
      doc(db, "workspaces", safeNetWorkspaceId, "appointmentEvents", seededAppointmentEventId),
      {
        id: seededAppointmentEventId,
        workspaceId: safeNetWorkspaceId,
        appointmentId: String(appointment.id),
        conversationId: String(DEMO_IDS.conversations.appointment),
        contactId: String(appointment.contactId),
        teamId: String(DEMO_IDS.teams.general),
        locationId: String(appointment.locationId),
        actionId: seededAppointmentEventId,
        actorUid: "simulator_seed",
        action: "simulator_snapshot_seeded",
        fromStatus: null,
        toStatus: appointment.status,
        revision: 0,
        source: "simulator_seed",
        synthetic: true,
        schemaVersion: 1,
        createdAt: asTimestamp(appointment.updatedAt),
      },
    ),
  );

  const labReport = demoLabReports[0];
  if (!labReport) throw new Error("Synthetic laboratory report fixture is missing.");
  const labReportId = String(labReport.id);
  const labFingerprint = "7".repeat(64);
  const labSecretBatch = writeBatch(db);
  labSecretBatch.set(
    doc(db, "workspaces", safeNetWorkspaceId, "labReports", labReportId),
    {
      id: labReportId,
      workspaceId: safeNetWorkspaceId,
      conversationId: String(DEMO_IDS.conversations.laboratory),
      contactId: String(labReport.contactId),
      teamId: String(DEMO_IDS.teams.laboratory),
      locationId: String(labReport.locationId),
      workflowStatus: labReport.workflowStatus,
      collectedAt: nullableTimestamp(labReport.collectedAt),
      readyAt: nullableTimestamp(labReport.readyAt),
      secureAccess:
        labReport.secureAccess.mode === "not_available"
          ? { mode: "not_available", available: false, expiresAt: null }
          : {
              mode: "simulator_handoff",
              available: true,
              expiresAt: asTimestamp(labReport.secureAccess.expiresAt),
            },
      lastNotificationAt: nullableTimestamp(labReport.lastNotificationAt),
      authoritativeSystem: "simulator",
      revision: 0,
      synthetic: true,
      schemaVersion: 1,
      createdAt: asTimestamp(labReport.createdAt),
      updatedAt: asTimestamp(labReport.updatedAt),
    },
  );
  labSecretBatch.set(
    doc(db, "workspaces", safeNetWorkspaceId, "labReportSecrets", labReportId),
    {
      id: labReportId,
      workspaceId: safeNetWorkspaceId,
      labReportId,
      externalReportRef: String(labReport.externalReportRef),
      notificationIdempotencyFingerprint: labFingerprint,
      secureAccess: {
        mode: "simulator_handoff",
        handoffRef:
          `protected://workspaces/${safeNetWorkspaceId}/lab-reports/${labReportId}/authenticated-handoff`,
      },
      synthetic: true,
      schemaVersion: 1,
      createdAt: asTimestamp(labReport.createdAt),
      updatedAt: asTimestamp(labReport.updatedAt),
    },
  );
  labSecretBatch.set(
    doc(db, "workspaces", safeNetWorkspaceId, "labReportEvents", seededLabReportEventId),
    {
      id: seededLabReportEventId,
      workspaceId: safeNetWorkspaceId,
      labReportId,
      conversationId: String(DEMO_IDS.conversations.laboratory),
      contactId: String(labReport.contactId),
      teamId: String(DEMO_IDS.teams.laboratory),
      locationId: String(labReport.locationId),
      eventType: "simulator_report_ready",
      fromStatus: "processing",
      toStatus: labReport.workflowStatus,
      source: "simulator_seed",
      synthetic: true,
      schemaVersion: 1,
      occurredAt: asTimestamp(labReport.updatedAt),
      createdAt: asTimestamp(labReport.updatedAt),
    },
  );
  labSecretBatch.set(
    doc(
      db,
      "workspaces",
      safeNetWorkspaceId,
      "labReportEventSecrets",
      seededLabReportEventId,
    ),
    {
      id: seededLabReportEventId,
      workspaceId: safeNetWorkspaceId,
      labReportEventId: seededLabReportEventId,
      labReportId,
      idempotencyFingerprint: labFingerprint,
      synthetic: true,
      schemaVersion: 1,
      createdAt: asTimestamp(labReport.updatedAt),
      updatedAt: asTimestamp(labReport.updatedAt),
    },
  );

  // Internal-note creation is backend-only. This protected-reference fixture
  // is seeded under the privileged emulator context solely to verify scoped
  // client reads; no note body or free-form clinical text is persisted.
  writes.push(
    setDoc(
      doc(db, "workspaces", safeNetWorkspaceId, "internalNotes", seededInternalNoteId),
      {
        id: seededInternalNoteId,
        workspaceId: safeNetWorkspaceId,
        conversationId: String(DEMO_IDS.conversations.appointment),
        authorUid: uid,
        teamId: String(DEMO_IDS.teams.general),
        locationId: String(DEMO_IDS.locations.wattala),
        bodyRef:
          `protected://workspaces/${safeNetWorkspaceId}/internal-notes/${seededInternalNoteId}`,
        noteKind: "handoff_context",
        synthetic: true,
        schemaVersion: 1,
        createdAt: updatedAt,
      },
    ),
  );

  // These exact route IDs match the two allowlisted synthetic ingress refs.
  // They contain no real number or Meta identifier and remain client-denied.
  for (const route of syntheticPhoneRoutes) {
    writes.push(
      setDoc(doc(db, "phoneRoutes", route.id), {
        id: route.id,
        routeRef: route.id,
        workspaceId: safeNetWorkspaceId,
        connectionId: String(DEMO_IDS.connections.simulator),
        teamId: route.teamId,
        locationId: route.locationId,
        active: true,
        synthetic: true,
        schemaVersion: 1,
        createdAt,
        updatedAt,
      }),
    );
  }

  const phase5SeedGraph = buildPhase5SeedGraph(safeNetWorkspaceId);
  for (const seedDocument of phase5SeedGraph.documents) {
    writes.push(
      setDoc(
        doc(
          db,
          "workspaces",
          safeNetWorkspaceId,
          seedDocument.collectionName,
          seedDocument.id,
        ),
        seedDocument.data,
      ),
    );
  }
  for (const audit of phase5SeedGraph.audits) {
    writes.push(
      setDoc(
        doc(db, "workspaces", safeNetWorkspaceId, "auditEvents", audit.id),
        audit.data,
      ),
    );
  }

  const aiGovernanceSeedGraph = buildAiGovernanceSeedGraph();
  for (const seedDocument of aiGovernanceSeedGraph.knowledgeDocuments) {
    writes.push(
      setDoc(
        doc(
          db,
          "workspaces",
          safeNetWorkspaceId,
          AI_GOVERNANCE_COLLECTIONS.knowledgeDocuments,
          seedDocument.id,
        ),
        seedDocument.data,
      ),
    );
  }
  for (const seedDocument of aiGovernanceSeedGraph.knowledgeSelections) {
    writes.push(
      setDoc(
        doc(
          db,
          "workspaces",
          safeNetWorkspaceId,
          AI_GOVERNANCE_COLLECTIONS.knowledgeSelections,
          seedDocument.id,
        ),
        seedDocument.data,
      ),
    );
  }
  for (const seedDocument of aiGovernanceSeedGraph.knowledgeDocumentSecrets) {
    writes.push(
      setDoc(
        doc(
          db,
          "workspaces",
          safeNetWorkspaceId,
          AI_GOVERNANCE_COLLECTIONS.knowledgeDocumentSecrets,
          seedDocument.id,
        ),
        seedDocument.data,
      ),
    );
  }

  await Promise.all([
    ...writes,
    campaignSeedBatch.commit(),
    labSecretBatch.commit(),
  ]);
}

function assertPhase5StaffProjectionSafe(value: unknown, label: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertPhase5StaffProjectionSafe(item, `${label}[${index}]`),
    );
    return;
  }
  if (value === null || typeof value !== "object" || value instanceof Timestamp) return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if ((phase5ForbiddenStaffKeys as readonly string[]).includes(key)) {
      throw new Error(`${label} exposed forbidden staff-safe field ${key}.`);
    }
    assertPhase5StaffProjectionSafe(nested, `${label}.${key}`);
  }
}

async function assertPhase5SeedGraph(
  db: Firestore,
  authenticatedUid: string,
): Promise<void> {
  const workspaceId = String(DEMO_IDS.workspaces.safeNet);
  const collectionEntries = await Promise.all(
    PHASE5_COLLECTIONS.map(async (collectionName) => {
      const snapshot = await getDocs(
        collection(db, "workspaces", workspaceId, collectionName),
      );
      return [
        collectionName,
        new Map(snapshot.docs.map((record) => [record.id, record.data()])),
      ] as const;
    }),
  );
  const phase5Documents = new Map<string, ReadonlyMap<string, unknown>>(
    collectionEntries,
  );
  const readPhase5Document = (collectionName: string, documentId: string): unknown => {
    const value = phase5Documents.get(collectionName)?.get(documentId);
    if (value === undefined) {
      throw new Error(`Phase 5 seed is missing ${collectionName}/${documentId}.`);
    }
    return value;
  };

  let phase5DocumentCount = 0;
  for (const collectionName of PHASE5_COLLECTIONS) {
    const actual = phase5Documents.get(collectionName)?.size ?? 0;
    const expected = phase5SeedCollectionCounts[collectionName];
    if (actual !== expected) {
      throw new Error(
        `Phase 5 ${collectionName} expected ${expected} documents; received ${actual}.`,
      );
    }
    phase5DocumentCount += actual;
  }
  if (phase5DocumentCount !== 51) {
    throw new Error(`Phase 5 expected 51 collection documents; received ${phase5DocumentCount}.`);
  }

  for (const collectionName of PHASE5_STAFF_COLLECTIONS) {
    for (const [documentId, value] of phase5Documents.get(collectionName) ?? []) {
      assertPhase5StaffProjectionSafe(value, `${collectionName}/${documentId}`);
      if (
        (collectionName === "automationDefinitions" ||
          collectionName === "carePathways") &&
        value !== null &&
        typeof value === "object" &&
        "active" in value
      ) {
        throw new Error(`${collectionName}/${documentId} persisted a forbidden active flag.`);
      }
    }
  }

  const auditSnapshot = await getDocs(
    collection(db, "workspaces", workspaceId, "auditEvents"),
  );
  if (auditSnapshot.size !== 28) {
    throw new Error(`Phase 5 expected 28 lifecycle audit joins; received ${auditSnapshot.size}.`);
  }
  const rawAudits = new Map(auditSnapshot.docs.map((record) => [record.id, record.data()]));
  const parsedAudits = new Map(
    auditSnapshot.docs.map((record) => [
      record.id,
      parsePhase5AuditDocument(record.data(), record.id, workspaceId),
    ]),
  );
  const usedAuditIds = new Set<string>();
  const assertLifecycleAuditMetadata = (auditId: string): void => {
    const audit = parsedAudits.get(auditId);
    if (!audit) throw new Error(`Phase 5 audit ${auditId} is missing.`);
    const keys = Object.keys(audit.metadata).sort();
    const expectedKeys = [
      "eventId",
      "externalDispatchCount",
      "networkCallCount",
      "revision",
      "synthetic",
    ].sort();
    if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
      throw new Error(
        `Lifecycle audit ${auditId} does not use the exact redacted metadata keyset.`,
      );
    }
    if (
      audit.metadata.synthetic !== true ||
      audit.metadata.externalDispatchCount !== 0 ||
      audit.metadata.networkCallCount !== 0
    ) {
      throw new Error(`Lifecycle audit ${auditId} inferred an external side effect.`);
    }
    usedAuditIds.add(auditId);
  };

  const definitions = new Map<
    string,
    ReturnType<typeof parseAutomationDefinitionDocument>
  >();
  for (const [documentId, value] of phase5Documents.get("automationDefinitions") ?? []) {
    const definition = parseAutomationDefinitionDocument(value, documentId, workspaceId);
    assertAutomationDefinitionGovernanceHashes(definition, phase5Sha256);
    const secret = parseAutomationDefinitionSecretDocument(
      readPhase5Document("automationDefinitionSecrets", documentId),
      documentId,
      workspaceId,
    );
    assertAutomationDefinitionSecretJoin(definition, secret, phase5Sha256);
    const expectedConfigurationRef =
      definition.family === "appointment_service"
        ? "demo://automation/configuration/synthetic-v1"
        : "demo://automation/configuration/synthetic-laboratory-v1";
    if (secret.protectedConfigurationRef !== expectedConfigurationRef) {
      throw new Error(`Automation definition ${documentId} used a non-allowlisted configuration ref.`);
    }
    definitions.set(documentId, definition);
  }

  const definitionEvents = new Map<
    string,
    ReturnType<typeof parseAutomationDefinitionEventDocument>
  >();
  for (const [documentId, value] of phase5Documents.get("automationDefinitionEvents") ?? []) {
    const event = parseAutomationDefinitionEventDocument(value, documentId, workspaceId);
    const definition = definitions.get(String(event.definitionId));
    const audit = parsedAudits.get(String(event.auditEventId));
    if (!definition || !audit) {
      throw new Error(`Automation definition event ${documentId} has an unresolved exact join.`);
    }
    if (
      event.definitionVersion !== definition.version ||
      event.definitionContentHash !== definition.contentHash ||
      event.definitionSecretBindingHash !== definition.secretBindingHash
    ) {
      throw new Error(`Automation definition event ${documentId} substituted governed content.`);
    }
    assertPhase5EventAuditJoin(event, audit, "automation_definition", definition.id);
    assertLifecycleAuditMetadata(String(event.auditEventId));
    definitionEvents.set(documentId, event);
  }

  const automationActivations = new Map<
    string,
    ReturnType<typeof parseAutomationActivationDocument>
  >();
  for (const [documentId, value] of phase5Documents.get("automationActivations") ?? []) {
    const activation = parseAutomationActivationDocument(value, documentId, workspaceId);
    const definition = definitions.get(String(activation.activeDefinitionId));
    const event = definitionEvents.get(String(activation.activationEventId));
    const audit = parsedAudits.get(String(activation.activationAuditEventId));
    if (!definition || !event || !audit) {
      throw new Error(`Automation activation ${documentId} has an unresolved proof chain.`);
    }
    assertAutomationActivationGovernanceJoin(activation, definition, event, audit);
    automationActivations.set(documentId, activation);
  }

  const runRaw = readPhase5Document("automationRuns", phase5AutomationRunId);
  const run = parseAutomationRunDocument(runRaw, phase5AutomationRunId, workspaceId);
  const runSecret = parseAutomationRunSecretDocument(
    readPhase5Document("automationRunSecrets", phase5AutomationRunId),
    phase5AutomationRunId,
    workspaceId,
  );
  const receiptId = String(runSecret.triggerFingerprint);
  const receipt = parseAutomationTriggerReceiptDocument(
    readPhase5Document("automationTriggerReceipts", receiptId),
    receiptId,
    workspaceId,
  );
  const runActivation = automationActivations.get(receipt.family);
  if (!runActivation) {
    throw new Error("Automation receipt has no exact active-family chronology proof.");
  }
  assertAutomationReceiptAggregateJoin(receipt, run, runSecret, runActivation);
  const expectedSourceEventFingerprint = phase5Sha256(
    serializeAutomationSourceEventIdentity({
      workspaceId,
      connectionId: String(DEMO_IDS.connections.simulator),
      eventKind: "appointment_event",
      sourceEventId: "appointment_event_synthetic_phase5_seed",
    }),
  );
  const expectedTriggerFingerprint = phase5HmacSha256(
    serializeAutomationTriggerReceiptKey({
      workspaceId,
      family: "appointment_service",
      sourceEventFingerprint: expectedSourceEventFingerprint,
    }),
  );
  if (
    receipt.sourceEventFingerprint !== expectedSourceEventFingerprint ||
    receipt.triggerFingerprint !== expectedTriggerFingerprint ||
    receipt.id !== expectedTriggerFingerprint ||
    runSecret.protectedContactRef !== "demo://automation/contact/synthetic-v1" ||
    runSecret.protectedConversationRef !== "demo://automation/conversation/synthetic-v1" ||
    runSecret.protectedAppointmentRef !== "demo://automation/appointment/synthetic-v1"
  ) {
    throw new Error("Automation receipt or protected-reference seed binding drifted.");
  }

  const pathway = parseCarePathwayDocument(
    readPhase5Document("carePathways", phase5CarePathwayId),
    phase5CarePathwayId,
    workspaceId,
  );
  assertCarePathwayGovernanceHashes(pathway, phase5Sha256);
  const pathwaySecret = parseCarePathwaySecretDocument(
    readPhase5Document("carePathwaySecrets", phase5CarePathwayId),
    phase5CarePathwayId,
    workspaceId,
  );
  assertCarePathwaySecretJoin(pathway, pathwaySecret, phase5Sha256);

  const pathwayEvents = new Map<
    string,
    ReturnType<typeof parseCarePathwayEventDocument>
  >();
  for (const [documentId, value] of phase5Documents.get("carePathwayEvents") ?? []) {
    const event = parseCarePathwayEventDocument(value, documentId, workspaceId);
    const audit = parsedAudits.get(String(event.auditEventId));
    if (!audit) throw new Error(`Care pathway event ${documentId} has no exact audit.`);
    if (
      event.pathwayId !== pathway.id ||
      event.pathwayProtocolVersion !== pathway.protocolVersion ||
      event.pathwayContentHash !== pathway.contentHash ||
      event.pathwaySecretBindingHash !== pathway.secretBindingHash
    ) {
      throw new Error(`Care pathway event ${documentId} substituted governed content.`);
    }
    assertPhase5EventAuditJoin(event, audit, "care_pathway", pathway.id);
    assertLifecycleAuditMetadata(String(event.auditEventId));
    pathwayEvents.set(documentId, event);
  }

  const pathwayActivation = parseCarePathwayActivationDocument(
    readPhase5Document("carePathwayActivations", "post_discharge"),
    "post_discharge",
    workspaceId,
  );
  const pathwayActivationEvent = pathwayEvents.get(
    String(pathwayActivation.activationEventId),
  );
  const pathwayActivationAudit = parsedAudits.get(
    String(pathwayActivation.activationAuditEventId),
  );
  if (!pathwayActivationEvent || !pathwayActivationAudit) {
    throw new Error("Care pathway activation has an unresolved proof chain.");
  }
  assertCarePathwayActivationGovernanceJoin(
    pathwayActivation,
    pathway,
    pathwayActivationEvent,
    pathwayActivationAudit,
  );

  const enrollment = parseCareEnrollmentDocument(
    readPhase5Document("careEnrollments", phase5CareEnrollmentId),
    phase5CareEnrollmentId,
    workspaceId,
  );
  const enrollmentSecret = parseCareEnrollmentSecretDocument(
    readPhase5Document("careEnrollmentSecrets", phase5CareEnrollmentId),
    phase5CareEnrollmentId,
    workspaceId,
  );
  const enrollmentReceiptId = String(enrollmentSecret.receiptId);
  const enrollmentReceipt = parseCareEnrollmentReceiptDocument(
    readPhase5Document("careEnrollmentReceipts", enrollmentReceiptId),
    enrollmentReceiptId,
    workspaceId,
  );
  assertCareReceiptAggregateJoin(
    enrollmentReceipt,
    enrollment,
    enrollmentSecret,
    pathwayActivation,
  );
  const expectedDischargeFingerprint = phase5Sha256(
    serializeCareDischargeSourceIdentity({
      workspaceId,
      sourceSystem: "simulator",
      connectionId: String(DEMO_IDS.connections.simulator),
      dischargeEventId: "discharge_event_synthetic_phase5_001",
    }),
  );
  const expectedCareReceiptFingerprint = phase5HmacSha256(
    serializeCareEnrollmentReceiptKey({
      workspaceId,
      family: "post_discharge",
      dischargeFingerprint: expectedDischargeFingerprint,
    }),
  );
  const dayOneAt = Date.parse(String(enrollmentSecret.qualifyingDischargeAt)) + 86_400_000;
  if (
    enrollmentReceipt.dischargeFingerprint !== expectedDischargeFingerprint ||
    enrollmentReceipt.receiptFingerprint !== expectedCareReceiptFingerprint ||
    enrollmentReceipt.id !== expectedCareReceiptFingerprint ||
    enrollmentSecret.protectedContactRef !== "demo://care/contact/synthetic-001" ||
    enrollmentSecret.protectedConversationRef !== "demo://care/conversation/synthetic-001" ||
    enrollmentSecret.protectedQualifyingDischargeRef !== "demo://care/discharge/synthetic-001" ||
    enrollment.nextContactAt === null ||
    Date.parse(String(enrollment.nextContactAt)) !== dayOneAt
  ) {
    throw new Error("Care receipt, protected-reference or schedule anchor seed binding drifted.");
  }

  if (usedAuditIds.size !== 28 || usedAuditIds.size !== rawAudits.size) {
    throw new Error(
      `Phase 5 expected every one of 28 audits to join once; joined ${usedAuditIds.size}.`,
    );
  }

  const authorityExpectations = [
    {
      uid: authenticatedUid,
      role: "tenant_admin",
      scopeMode: "workspace_wide",
      teamIds: [] as readonly string[],
      locationIds: [] as readonly string[],
    },
    {
      uid: phase5AutomationOwnerUid,
      role: "tenant_admin",
      scopeMode: "workspace_wide",
      teamIds: [] as readonly string[],
      locationIds: [] as readonly string[],
    },
    {
      uid: phase5AutomationApproverUid,
      role: "supervisor",
      scopeMode: "assigned",
      teamIds: [String(DEMO_IDS.teams.general), String(DEMO_IDS.teams.laboratory)],
      locationIds: [
        String(DEMO_IDS.locations.wattala),
        String(DEMO_IDS.locations.thalawathugoda),
        String(DEMO_IDS.locations.labNetwork),
      ],
    },
    {
      uid: phase5ClinicalApproverUid,
      role: "clinical_approver",
      scopeMode: "assigned",
      teamIds: [String(DEMO_IDS.teams.clinicalEscalation)],
      locationIds: [
        String(DEMO_IDS.locations.wattala),
        String(DEMO_IDS.locations.thalawathugoda),
      ],
    },
  ] as const;
  const nowMillis = Date.now();
  for (const expected of authorityExpectations) {
    const snapshot = await getDoc(
      doc(db, "workspaces", workspaceId, "members", expected.uid),
    );
    const member = snapshot.data();
    if (
      !snapshot.exists() ||
      member?.id !== expected.uid ||
      member.uid !== expected.uid ||
      member.workspaceId !== workspaceId ||
      member.role !== expected.role ||
      member.status !== "active" ||
      member.scopeMode !== expected.scopeMode ||
      member.mfaSatisfied !== true ||
      !(member.lastAuthenticatedAt instanceof Timestamp) ||
      JSON.stringify(member.teamIds) !== JSON.stringify(expected.teamIds) ||
      JSON.stringify(member.locationIds) !== JSON.stringify(expected.locationIds) ||
      member.lastAuthenticatedAt.toMillis() > nowMillis + 5_000 ||
      nowMillis - member.lastAuthenticatedAt.toMillis() > 15 * 60_000
    ) {
      throw new Error(`Phase 5 authority membership ${expected.uid} is invalid or stale.`);
    }
  }

  const utilityConsent = await getDoc(
    doc(
      db,
      "workspaces",
      workspaceId,
      "consentRecords",
      phase5AppointmentUtilityConsentId,
    ),
  );
  const consent = utilityConsent.data();
  if (
    !utilityConsent.exists() ||
    consent?.id !== phase5AppointmentUtilityConsentId ||
    consent.contactId !== String(DEMO_IDS.contacts.appointment) ||
    consent.teamId !== String(DEMO_IDS.teams.general) ||
    consent.locationId !== String(DEMO_IDS.locations.wattala) ||
    consent.purpose !== "appointment_service" ||
    consent.channel !== "whatsapp" ||
    consent.category !== "utility" ||
    consent.status !== "granted" ||
    !(consent.capturedAt instanceof Timestamp)
  ) {
    throw new Error("Phase 5 appointment utility consent evidence is missing or invalid.");
  }
}

function requireConnectionSeedRecord(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a Firestore map.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function connectionSeedTimestampToIso(value: unknown, label: string): string {
  if (
    !(value instanceof Timestamp) ||
    !Number.isInteger(value.seconds) ||
    !Number.isInteger(value.nanoseconds) ||
    value.nanoseconds % 1_000_000 !== 0
  ) {
    throw new Error(`${label} must be a millisecond-aligned native Firestore Timestamp.`);
  }
  return value.toDate().toISOString();
}

function projectConnectionEvidenceSignal(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  const signal = requireConnectionSeedRecord(value, label);
  return {
    ...signal,
    observedAt: connectionSeedTimestampToIso(signal.observedAt, `${label}.observedAt`),
  };
}

function projectWhatsAppConnectionSeed(
  value: unknown,
  documentId: string,
): StaffSafeWhatsAppConnectionV1 {
  const connection = requireConnectionSeedRecord(value, `whatsappConnections/${documentId}`);
  const rawSignals = requireConnectionSeedRecord(
    connection.signals,
    `whatsappConnections/${documentId}.signals`,
  );
  const candidate: unknown = {
    ...connection,
    signals: Object.fromEntries(
      Object.entries(rawSignals).map(([key, signal]) => [
        key,
        projectConnectionEvidenceSignal(
          signal,
          `whatsappConnections/${documentId}.signals.${key}`,
        ),
      ]),
    ),
    createdAt: connectionSeedTimestampToIso(
      connection.createdAt,
      `whatsappConnections/${documentId}.createdAt`,
    ),
    updatedAt: connectionSeedTimestampToIso(
      connection.updatedAt,
      `whatsappConnections/${documentId}.updatedAt`,
    ),
  };
  assertStaffSafeWhatsAppConnectionV1(candidate);
  if (candidate.id !== documentId) {
    throw new Error(`whatsappConnections/${documentId} does not match its document path.`);
  }
  return candidate;
}

function projectIntegrationSeed(
  value: unknown,
  documentId: string,
): StaffSafeIntegrationV1 {
  const integration = requireConnectionSeedRecord(value, `integrations/${documentId}`);
  const candidate: unknown = {
    ...integration,
    evidence: projectConnectionEvidenceSignal(
      integration.evidence,
      `integrations/${documentId}.evidence`,
    ),
    createdAt: connectionSeedTimestampToIso(
      integration.createdAt,
      `integrations/${documentId}.createdAt`,
    ),
    updatedAt: connectionSeedTimestampToIso(
      integration.updatedAt,
      `integrations/${documentId}.updatedAt`,
    ),
  };
  assertStaffSafeIntegrationV1(candidate);
  if (candidate.id !== documentId) {
    throw new Error(`integrations/${documentId} does not match its document path.`);
  }
  return candidate;
}

function assertNoForbiddenConnectionSeedKeys(value: unknown, label: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoForbiddenConnectionSeedKeys(item, `${label}[${index}]`),
    );
    return;
  }
  if (value === null || typeof value !== "object" || value instanceof Timestamp) return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenConnectionSeedKeys.has(key)) {
      throw new Error(`${label} persisted forbidden provider, secret or free-form key ${key}.`);
    }
    assertNoForbiddenConnectionSeedKeys(nested, `${label}.${key}`);
  }
}

function assertExactConnectionSeedIds(
  actualIds: readonly string[],
  expectedIds: readonly string[],
  label: string,
): void {
  const actual = [...actualIds].sort();
  const expected = [...expectedIds].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} IDs do not match the frozen synthetic inventory.`);
  }
}

function aiTimestampToIso(value: unknown, label: string): string {
  if (
    !(value instanceof Timestamp) ||
    !Number.isInteger(value.seconds) ||
    !Number.isInteger(value.nanoseconds) ||
    value.nanoseconds % 1_000_000 !== 0
  ) {
    throw new Error(`${label} must be a millisecond-aligned native Firestore Timestamp.`);
  }
  return value.toDate().toISOString();
}

function aiRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an exact persisted record.`);
  }
  return value as Record<string, unknown>;
}

function parseSeededAiKnowledgeDocument(
  value: unknown,
  documentId: AiKnowledgeDocumentId,
): StaffSafeAiKnowledgeDocumentV1 {
  const raw = aiRecord(value, `AI knowledge document ${documentId}`);
  const candidate: unknown = {
    ...raw,
    approvedAt:
      raw.approvedAt === null
        ? null
        : aiTimestampToIso(raw.approvedAt, `AI knowledge document ${documentId}.approvedAt`),
    evaluatedAt: aiTimestampToIso(
      raw.evaluatedAt,
      `AI knowledge document ${documentId}.evaluatedAt`,
    ),
    effectiveFrom:
      raw.effectiveFrom === null
        ? null
        : aiTimestampToIso(
            raw.effectiveFrom,
            `AI knowledge document ${documentId}.effectiveFrom`,
          ),
    effectiveUntil:
      raw.effectiveUntil === null
        ? null
        : aiTimestampToIso(
            raw.effectiveUntil,
            `AI knowledge document ${documentId}.effectiveUntil`,
          ),
    createdAt: aiTimestampToIso(
      raw.createdAt,
      `AI knowledge document ${documentId}.createdAt`,
    ),
    updatedAt: aiTimestampToIso(
      raw.updatedAt,
      `AI knowledge document ${documentId}.updatedAt`,
    ),
  };
  assertStaffSafeAiKnowledgeDocumentV1(candidate);
  if (candidate.id !== documentId) {
    throw new Error(`AI knowledge document ${documentId} path identity drifted.`);
  }
  return candidate;
}

function parseSeededAiKnowledgeSecret(
  value: unknown,
  secretId: string,
): AiKnowledgeDocumentSecretV1 {
  const raw = aiRecord(value, `AI knowledge secret ${secretId}`);
  const candidate: unknown = {
    ...raw,
    createdAt: aiTimestampToIso(
      raw.createdAt,
      `AI knowledge secret ${secretId}.createdAt`,
    ),
  };
  assertAiKnowledgeDocumentSecretV1(candidate);
  if (candidate.id !== secretId) {
    throw new Error(`AI knowledge secret ${secretId} path identity drifted.`);
  }
  return candidate;
}

function parseSeededAiKnowledgeSelection(
  value: unknown,
  selectionId: AiKnowledgeSelectionId,
): StaffSafeAiKnowledgeSelectionV1 {
  const raw = aiRecord(value, `AI knowledge selection ${selectionId}`);
  const candidate: unknown = {
    ...raw,
    selectedAt: aiTimestampToIso(
      raw.selectedAt,
      `AI knowledge selection ${selectionId}.selectedAt`,
    ),
    evaluatedAt: aiTimestampToIso(
      raw.evaluatedAt,
      `AI knowledge selection ${selectionId}.evaluatedAt`,
    ),
    effectiveFrom: aiTimestampToIso(
      raw.effectiveFrom,
      `AI knowledge selection ${selectionId}.effectiveFrom`,
    ),
    effectiveUntil: aiTimestampToIso(
      raw.effectiveUntil,
      `AI knowledge selection ${selectionId}.effectiveUntil`,
    ),
    createdAt: aiTimestampToIso(
      raw.createdAt,
      `AI knowledge selection ${selectionId}.createdAt`,
    ),
  };
  assertStaffSafeAiKnowledgeSelectionV1(candidate);
  if (candidate.selectionId !== selectionId) {
    throw new Error(`AI knowledge selection ${selectionId} path identity drifted.`);
  }
  return candidate;
}

const forbiddenAiPublicSeedKeys = new Set([
  "rawContent",
  "content",
  "protectedContentRef",
  "protectedContentFingerprint",
  "sourceConnectionId",
  "sourceConversationId",
  "sourceContactId",
  "sourceMessageId",
  "sourceTeamId",
  "sourceLocationId",
  "protectedRequestFixtureRef",
  "protectedRequestFixtureFingerprint",
  "stopSuppressionEvidence",
  "providerRequest",
  "providerResponse",
]);

function assertAiPublicSeedSafe(value: unknown, label: string): void {
  if (Array.isArray(value)) {
    value.forEach((nested, index) => assertAiPublicSeedSafe(nested, `${label}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object" || value instanceof Timestamp) return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenAiPublicSeedKeys.has(key)) {
      throw new Error(`${label} exposed forbidden protected/provider field ${key}.`);
    }
    assertAiPublicSeedSafe(nested, `${label}.${key}`);
  }
}

function isAiGovernanceIdempotencyReceipt(value: unknown): boolean {
  const record = aiRecord(value, "AI idempotency receipt probe");
  const action = typeof record.action === "string" ? record.action : "";
  if (
    action === "record_ai_retrospective_evaluation" ||
    action.startsWith("ai.") ||
    action.startsWith("ai_")
  ) {
    return true;
  }
  const fixedAuditIds = new Set(
    AI_PERSISTED_SCENARIO_IDS.map(
      (scenarioId) => AI_PERSISTED_SCENARIO_MATRIX[scenarioId].auditEventId,
    ),
  );
  if (typeof record.auditEventId === "string" && fixedAuditIds.has(record.auditEventId as never)) {
    return true;
  }
  const result =
    record.result !== null && typeof record.result === "object" && !Array.isArray(record.result)
      ? (record.result as Record<string, unknown>)
      : null;
  if (result === null) return false;
  return AI_PERSISTED_SCENARIO_IDS.some((scenarioId) => {
    const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
    return (
      result.scenarioId === scenarioId ||
      result.runId === expected.runId ||
      result.eventId === expected.eventId
    );
  });
}

async function assertAiGovernanceSeedGraph(db: Firestore): Promise<void> {
  const workspaceId = AI_GOVERNANCE_WORKSPACE_ID;
  const expectedGraph = buildAiGovernanceSeedGraph();
  const [
    knowledgeCollection,
    selectionCollection,
    secretCollection,
    runCollection,
    eventCollection,
    runSecretCollection,
    eventSecretCollection,
    idempotencyCollection,
    auditCollection,
    ...exactSnapshots
  ] = await Promise.all([
    getDocs(collection(db, "workspaces", workspaceId, AI_GOVERNANCE_COLLECTIONS.knowledgeDocuments)),
    getDocs(collection(db, "workspaces", workspaceId, AI_GOVERNANCE_COLLECTIONS.knowledgeSelections)),
    getDocs(collection(db, "workspaces", workspaceId, AI_GOVERNANCE_COLLECTIONS.knowledgeDocumentSecrets)),
    getDocs(collection(db, "workspaces", workspaceId, AI_GOVERNANCE_COLLECTIONS.retrospectiveRuns)),
    getDocs(collection(db, "workspaces", workspaceId, AI_GOVERNANCE_COLLECTIONS.retrospectiveEvents)),
    getDocs(collection(db, "workspaces", workspaceId, AI_GOVERNANCE_COLLECTIONS.retrospectiveRunSecrets)),
    getDocs(collection(db, "workspaces", workspaceId, AI_GOVERNANCE_COLLECTIONS.retrospectiveEventSecrets)),
    getDocs(collection(db, "workspaces", workspaceId, AI_GOVERNANCE_COLLECTIONS.idempotencyReceipts)),
    getDocs(collection(db, "workspaces", workspaceId, AI_GOVERNANCE_COLLECTIONS.auditEvents)),
    ...AI_KNOWLEDGE_DOCUMENT_IDS.map((documentId) =>
      getDoc(
        doc(
          db,
          "workspaces",
          workspaceId,
          AI_GOVERNANCE_COLLECTIONS.knowledgeDocuments,
          documentId,
        ),
      ),
    ),
    ...AI_KNOWLEDGE_SELECTION_IDS.map((selectionId) =>
      getDoc(
        doc(
          db,
          "workspaces",
          workspaceId,
          AI_GOVERNANCE_COLLECTIONS.knowledgeSelections,
          selectionId,
        ),
      ),
    ),
    ...AI_KNOWLEDGE_DOCUMENT_IDS.map((documentId) => {
      const secretId = AI_KNOWLEDGE_DOCUMENT_MATRIX[documentId].secretId;
      return getDoc(
        doc(
          db,
          "workspaces",
          workspaceId,
          AI_GOVERNANCE_COLLECTIONS.knowledgeDocumentSecrets,
          secretId,
        ),
      );
    }),
    ...AI_PERSISTED_SCENARIO_IDS.map((scenarioId) =>
      getDoc(
        doc(
          db,
          "workspaces",
          workspaceId,
          AI_GOVERNANCE_COLLECTIONS.auditEvents,
          AI_PERSISTED_SCENARIO_MATRIX[scenarioId].auditEventId,
        ),
      ),
    ),
  ]);

  const aiReceipts = idempotencyCollection.docs.filter((snapshot) =>
    isAiGovernanceIdempotencyReceipt(snapshot.data()),
  );
  const fixedAiAuditIds = new Set(
    AI_PERSISTED_SCENARIO_IDS.map(
      (scenarioId) => AI_PERSISTED_SCENARIO_MATRIX[scenarioId].auditEventId,
    ),
  );
  const aiAudits = auditCollection.docs.filter((snapshot) => fixedAiAuditIds.has(snapshot.id as never));
  const baseline = AI_GOVERNANCE_EXPECTED_PERSISTENCE_COUNTS.initialGovernanceSeed;
  assertAiGovernancePersistenceCountModel({
    materializedScenarioCount: 0,
    knowledgeDocuments: knowledgeCollection.size,
    knowledgeSelections: selectionCollection.size,
    knowledgeSecrets: secretCollection.size,
    retrospectiveRuns: runCollection.size,
    retrospectiveEvents: eventCollection.size,
    retrospectiveRunSecrets: runSecretCollection.size,
    retrospectiveEventSecrets: eventSecretCollection.size,
    idempotencyReceipts: aiReceipts.length,
    auditEvents: aiAudits.length,
    totalDocuments:
      knowledgeCollection.size +
      selectionCollection.size +
      secretCollection.size +
      runCollection.size +
      eventCollection.size +
      runSecretCollection.size +
      eventSecretCollection.size +
      aiReceipts.length +
      aiAudits.length,
  });
  if (
    knowledgeCollection.size !== baseline.knowledgeDocuments ||
    selectionCollection.size !== baseline.knowledgeSelections ||
    secretCollection.size !== baseline.knowledgeSecrets ||
    auditCollection.size !== 28
  ) {
    throw new Error("AI seed changed its exact 13-document inventory or the 28-audit baseline.");
  }

  const documentOffset = 0;
  const selectionOffset = AI_KNOWLEDGE_DOCUMENT_IDS.length;
  const secretOffset = selectionOffset + AI_KNOWLEDGE_SELECTION_IDS.length;
  const auditOffset = secretOffset + AI_KNOWLEDGE_DOCUMENT_IDS.length;
  const actualDocuments = new Map<AiKnowledgeDocumentId, StaffSafeAiKnowledgeDocumentV1>();
  for (const [index, expectedSeed] of expectedGraph.knowledgeDocuments.entries()) {
    const snapshot = exactSnapshots[documentOffset + index];
    if (!snapshot?.exists() || snapshot.id !== expectedSeed.id) {
      throw new Error(`AI seed exact public document ${expectedSeed.id} is missing.`);
    }
    assertAiPublicSeedSafe(snapshot.data(), `knowledgeDocuments/${expectedSeed.id}`);
    const actual = parseSeededAiKnowledgeDocument(snapshot.data(), expectedSeed.canonical.id);
    if (JSON.stringify(actual) !== JSON.stringify(expectedSeed.canonical)) {
      throw new Error(`AI seed public document ${expectedSeed.id} changed exact lifecycle bytes.`);
    }
    actualDocuments.set(actual.id, actual);
  }
  for (const [index, expectedSeed] of expectedGraph.knowledgeDocumentSecrets.entries()) {
    const snapshot = exactSnapshots[secretOffset + index];
    if (!snapshot?.exists() || snapshot.id !== expectedSeed.id) {
      throw new Error(`AI seed exact knowledge secret ${expectedSeed.id} is missing.`);
    }
    const actualSecret = parseSeededAiKnowledgeSecret(snapshot.data(), expectedSeed.id);
    const publicSeed = expectedGraph.knowledgeDocuments[index];
    const actualPublic = publicSeed && actualDocuments.get(publicSeed.canonical.id);
    if (publicSeed === undefined || actualPublic === undefined) {
      throw new Error(`AI seed knowledge secret ${expectedSeed.id} lost its public parent.`);
    }
    assertAiKnowledgeDocumentCrossBindingV1(
      actualPublic,
      publicSeed.content,
      publicSeed.approval,
      actualSecret,
      aiGovernanceSha256,
    );
    if (JSON.stringify(actualSecret) !== JSON.stringify(expectedSeed.canonical)) {
      throw new Error(`AI seed knowledge secret ${expectedSeed.id} changed exact protected binding.`);
    }
  }
  for (const [index, expectedSeed] of expectedGraph.knowledgeSelections.entries()) {
    const snapshot = exactSnapshots[selectionOffset + index];
    if (!snapshot?.exists() || snapshot.id !== expectedSeed.id) {
      throw new Error(`AI seed exact selection ${expectedSeed.id} is missing.`);
    }
    assertAiPublicSeedSafe(snapshot.data(), `knowledgeSelections/${expectedSeed.id}`);
    const actual = parseSeededAiKnowledgeSelection(
      snapshot.data(),
      expectedSeed.canonical.selectionId,
    );
    const selectedDocument = actualDocuments.get(actual.documentId);
    if (selectedDocument === undefined) {
      throw new Error(`AI seed selection ${expectedSeed.id} lost its approved document.`);
    }
    assertAiKnowledgeSelectionCrossBindingV1(actual, selectedDocument, aiGovernanceSha256);
    if (JSON.stringify(actual) !== JSON.stringify(expectedSeed.canonical)) {
      throw new Error(`AI seed selection ${expectedSeed.id} changed exact selection bytes.`);
    }
  }
  for (let index = 0; index < AI_PERSISTED_SCENARIO_IDS.length; index += 1) {
    const snapshot = exactSnapshots[auditOffset + index];
    if (snapshot?.exists()) {
      throw new Error(`AI seed created forbidden runtime audit ${snapshot.id}.`);
    }
  }
}

async function assertSyntheticConnectionSeed(db: Firestore): Promise<void> {
  const workspaceId = DEMO_CONNECTION_WORKSPACE_ID;
  const [
    whatsappConnections,
    integrations,
    whatsappConnectionSecrets,
    integrationSecrets,
    phoneRoutes,
    wabaRoutes,
  ] = await Promise.all([
    getDocs(collection(db, "workspaces", workspaceId, "whatsappConnections")),
    getDocs(collection(db, "workspaces", workspaceId, "integrations")),
    getDocs(collection(db, "workspaces", workspaceId, "whatsappConnectionSecrets")),
    getDocs(collection(db, "workspaces", workspaceId, "integrationSecrets")),
    getDocs(collection(db, "phoneRoutes")),
    getDocs(collection(db, "wabaRoutes")),
  ]);

  if (
    whatsappConnections.size !== 1 ||
    integrations.size !== 2 ||
    whatsappConnectionSecrets.size !== 0 ||
    integrationSecrets.size !== 0 ||
    phoneRoutes.size !== 2 ||
    wabaRoutes.size !== 0
  ) {
    throw new Error(
      `Connection seed expected physical counts 1/2/0/0/2/0; received ${whatsappConnections.size}/${integrations.size}/${whatsappConnectionSecrets.size}/${integrationSecrets.size}/${phoneRoutes.size}/${wabaRoutes.size}.`,
    );
  }

  assertExactConnectionSeedIds(
    whatsappConnections.docs.map((record) => record.id),
    [DEMO_WHATSAPP_CONNECTION_ID],
    "WhatsApp connection",
  );
  assertExactConnectionSeedIds(
    integrations.docs.map((record) => record.id),
    DEMO_INTEGRATION_IDS,
    "Integration",
  );
  assertExactConnectionSeedIds(
    phoneRoutes.docs.map((record) => record.id),
    syntheticPhoneRoutes.map((route) => route.id),
    "Global phone route",
  );

  const projectedConnections = whatsappConnections.docs.map((record) => {
    const data = record.data();
    assertNoForbiddenConnectionSeedKeys(data, `whatsappConnections/${record.id}`);
    return projectWhatsAppConnectionSeed(data, record.id);
  });
  const projectedIntegrations = integrations.docs
    .map((record) => {
      const data = record.data();
      assertNoForbiddenConnectionSeedKeys(data, `integrations/${record.id}`);
      return projectIntegrationSeed(data, record.id);
    })
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey));
  const centre: unknown = {
    whatsappConnections: projectedConnections,
    integrations: projectedIntegrations,
  };
  assertDemoConnectionCentreV1(centre);

  if (
    centre.whatsappConnections.some(
      (connection) =>
        connection.externalMessagingEnabled || connection.networkCallsEnabled,
    ) ||
    centre.integrations.some(
      (integration) =>
        integration.externalNetworkEnabled ||
        integration.authoritativeSystemWriteEnabled,
    )
  ) {
    throw new Error("Connection seed enabled an external network or authoritative write gate.");
  }
}

const protectedContactFields = [
  "phoneLookupHmac",
  "encryptedPhoneRef",
  "encryptedDisplayNameRef",
  "externalPatientRef",
] as const;

const contactSecretFields = [
  "id",
  "workspaceId",
  "contactId",
  ...protectedContactFields,
  "synthetic",
  "schemaVersion",
  "createdAt",
  "updatedAt",
] as const;

async function assertProtectedContactSeedSplit(db: Firestore): Promise<void> {
  const workspaceId = String(DEMO_IDS.workspaces.safeNet);
  const [contacts, contactSecrets] = await Promise.all([
    getDocs(collection(db, "workspaces", workspaceId, "contacts")),
    getDocs(collection(db, "workspaces", workspaceId, "contactSecrets")),
  ]);
  if (contacts.size !== demoContacts.length || contactSecrets.size !== demoContacts.length) {
    throw new Error(
      `Expected ${demoContacts.length} staff contacts and protected contact secrets; received ${contacts.size} and ${contactSecrets.size}.`,
    );
  }

  for (const contact of contacts.docs) {
    const leakedField = protectedContactFields.find((field) => field in contact.data());
    if (leakedField) {
      throw new Error(`Staff contact ${contact.id} contains protected field ${leakedField}.`);
    }
  }

  const expectedKeys = [...contactSecretFields].sort();
  for (const secret of contactSecrets.docs) {
    const data = secret.data();
    const actualKeys = Object.keys(data).sort();
    if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
      throw new Error(`Contact secret ${secret.id} does not match the protected schema.`);
    }
    if (
      data.id !== secret.id ||
      data.contactId !== secret.id ||
      data.workspaceId !== workspaceId ||
      data.synthetic !== true ||
      data.schemaVersion !== 1
    ) {
      throw new Error(`Contact secret ${secret.id} does not match its tenant path or schema.`);
    }
  }
}

const staffSafeLabReportFields = [
  "id",
  "workspaceId",
  "conversationId",
  "contactId",
  "teamId",
  "locationId",
  "workflowStatus",
  "collectedAt",
  "readyAt",
  "secureAccess",
  "lastNotificationAt",
  "authoritativeSystem",
  "revision",
  "synthetic",
  "schemaVersion",
  "createdAt",
  "updatedAt",
] as const;

const staffSafeLabReportEventFields = [
  "id",
  "workspaceId",
  "labReportId",
  "conversationId",
  "contactId",
  "teamId",
  "locationId",
  "eventType",
  "fromStatus",
  "toStatus",
  "source",
  "synthetic",
  "schemaVersion",
  "occurredAt",
  "createdAt",
] as const;

const labReportSecretFields = [
  "id",
  "workspaceId",
  "labReportId",
  "externalReportRef",
  "notificationIdempotencyFingerprint",
  "secureAccess",
  "synthetic",
  "schemaVersion",
  "createdAt",
  "updatedAt",
] as const;

const labReportEventSecretFields = [
  "id",
  "workspaceId",
  "labReportEventId",
  "labReportId",
  "idempotencyFingerprint",
  "synthetic",
  "schemaVersion",
  "createdAt",
  "updatedAt",
] as const;

function hasExactKeys(
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort());
}

function isSyntheticSecretTimestamp(value: unknown): boolean {
  return value instanceof Timestamp;
}

async function assertProtectedLaboratorySeedSplit(db: Firestore): Promise<void> {
  const workspaceId = String(DEMO_IDS.workspaces.safeNet);
  const [reports, reportSecrets, events, eventSecrets] = await Promise.all([
    getDocs(collection(db, "workspaces", workspaceId, "labReports")),
    getDocs(collection(db, "workspaces", workspaceId, "labReportSecrets")),
    getDocs(collection(db, "workspaces", workspaceId, "labReportEvents")),
    getDocs(collection(db, "workspaces", workspaceId, "labReportEventSecrets")),
  ]);

  if (
    reports.size !== 1 ||
    reportSecrets.size !== reports.size ||
    events.size !== 1 ||
    eventSecrets.size !== events.size
  ) {
    throw new Error(
      `Expected atomic one-to-one laboratory workflow/secret pairs; received ${reports.size} reports, ${reportSecrets.size} report secrets, ${events.size} events and ${eventSecrets.size} event secrets.`,
    );
  }

  const reportIds = new Set(reports.docs.map((record) => record.id));
  const eventIds = new Set(events.docs.map((record) => record.id));

  for (const report of reports.docs) {
    const data = report.data();
    const access = data.secureAccess as Record<string, unknown>;
    if (
      !hasExactKeys(data, staffSafeLabReportFields) ||
      "externalReportRef" in data ||
      "notificationIdempotencyFingerprint" in data ||
      !hasExactKeys(access, ["mode", "available", "expiresAt"]) ||
      "handoffRef" in access ||
      data.id !== report.id ||
      data.workspaceId !== workspaceId ||
      data.synthetic !== true ||
      data.schemaVersion !== 1
    ) {
      throw new Error(`Staff-safe laboratory report ${report.id} failed split validation.`);
    }
    if (!reportSecrets.docs.some((secret) => secret.id === report.id)) {
      throw new Error(`Laboratory report ${report.id} is missing its atomic secret pair.`);
    }
  }

  for (const secret of reportSecrets.docs) {
    const data = secret.data();
    const access = data.secureAccess as Record<string, unknown>;
    const expectedHandoffRef =
      `protected://workspaces/${workspaceId}/lab-reports/${secret.id}/authenticated-handoff`;
    if (
      !hasExactKeys(data, labReportSecretFields) ||
      !hasExactKeys(access, ["mode", "handoffRef"]) ||
      data.id !== secret.id ||
      data.labReportId !== secret.id ||
      data.workspaceId !== workspaceId ||
      data.synthetic !== true ||
      data.schemaVersion !== 1 ||
      typeof data.externalReportRef !== "string" ||
      data.externalReportRef.length === 0 ||
      typeof data.notificationIdempotencyFingerprint !== "string" ||
      !/^[0-9a-f]{64}$/.test(data.notificationIdempotencyFingerprint) ||
      access.mode !== "simulator_handoff" ||
      access.handoffRef !== expectedHandoffRef ||
      !isSyntheticSecretTimestamp(data.createdAt) ||
      !isSyntheticSecretTimestamp(data.updatedAt) ||
      !reportIds.has(secret.id)
    ) {
      throw new Error(`Laboratory report secret ${secret.id} failed tenant/path validation.`);
    }
  }

  for (const event of events.docs) {
    const data = event.data();
    if (
      !hasExactKeys(data, staffSafeLabReportEventFields) ||
      "idempotencyFingerprint" in data ||
      data.id !== event.id ||
      data.workspaceId !== workspaceId ||
      data.synthetic !== true ||
      data.schemaVersion !== 1 ||
      typeof data.labReportId !== "string" ||
      !reportIds.has(data.labReportId)
    ) {
      throw new Error(`Staff-safe laboratory event ${event.id} failed split validation.`);
    }
    if (!eventSecrets.docs.some((secret) => secret.id === event.id)) {
      throw new Error(`Laboratory event ${event.id} is missing its atomic secret pair.`);
    }
  }

  for (const secret of eventSecrets.docs) {
    const data = secret.data();
    if (
      !hasExactKeys(data, labReportEventSecretFields) ||
      data.id !== secret.id ||
      data.labReportEventId !== secret.id ||
      data.workspaceId !== workspaceId ||
      data.synthetic !== true ||
      data.schemaVersion !== 1 ||
      typeof data.labReportId !== "string" ||
      !reportIds.has(data.labReportId) ||
      typeof data.idempotencyFingerprint !== "string" ||
      !/^[0-9a-f]{64}$/.test(data.idempotencyFingerprint) ||
      !isSyntheticSecretTimestamp(data.createdAt) ||
      !isSyntheticSecretTimestamp(data.updatedAt) ||
      !eventIds.has(secret.id)
    ) {
      throw new Error(`Laboratory event secret ${secret.id} failed tenant/path validation.`);
    }
  }
}

async function assertSyntheticCatalogueSeed(db: Firestore): Promise<void> {
  const workspaceId = String(DEMO_IDS.workspaces.safeNet);
  const [templates, flows] = await Promise.all([
    listTemplateCatalogue(db, { workspaceId, pageSize: 100 }),
    listFlowCatalogue(db, { workspaceId, pageSize: 100 }),
  ]);
  if (templates.length !== 12 || flows.length !== 18) {
    throw new Error(
      `Expected twelve template versions and eighteen singular-language Flow versions; received ${templates.length} and ${flows.length}.`,
    );
  }

  const allAssets = [...templates, ...flows];
  if (
    allAssets.some(
      (asset) =>
        hasVerifiedProviderApproval(asset) ||
        asset.providerState.submissionState !== "not_submitted" ||
        asset.providerState.approvalState !== "unverified" ||
        asset.providerState.authority !== "none" ||
        asset.providerState.assetId !== null ||
        asset.ownership.ownerKind !== "safenet_demo" ||
        asset.ownership.ownerWorkspaceId !== workspaceId ||
        asset.ownership.transferableToHemas ||
        asset.ownership.productionUseAllowed,
    )
  ) {
    throw new Error("Synthetic catalogue inferred provider approval or transferable ownership.");
  }

  const localStates = new Set<string>(allAssets.map((asset) => asset.localState));
  if (
    ![
      "draft",
      "submitted",
      "approved",
      "paused",
      "disabled",
      "rejected",
    ].every((state) => localStates.has(state))
  ) {
    throw new Error("Synthetic catalogue does not exercise every distinct local lifecycle state.");
  }

  for (const flow of flowCatalogueBlueprints) {
    const variants = flows.filter((record) => record.assetKey === flow.assetKey);
    if (
      variants.length !== catalogueLanguages.length ||
      new Set(variants.map((record) => record.language)).size !== catalogueLanguages.length
    ) {
      throw new Error(`Flow ${flow.assetKey} is missing a singular-language variant.`);
    }
  }

  const governedCampaignTemplates = templates.filter(
    (record) => record.assetKey === "wellness_awareness" && record.version === 3,
  );
  for (const record of governedCampaignTemplates) {
    const contentSerialization = serializeTemplateContentBinding(record);
    const recomputedContentHash = createHash("sha256")
      .update(contentSerialization, "utf8")
      .digest("hex");
    if (
      contentSerialization !== seededCampaignTemplateContentSerializations[record.language] ||
      recomputedContentHash !== seededCampaignTemplateContentHashes[record.language] ||
      record.contentHash !== recomputedContentHash
    ) {
      throw new Error(`Governed campaign template ${record.id} failed its golden binding.`);
    }
  }
  if (
    governedCampaignTemplates.length !== catalogueLanguages.length ||
    governedCampaignTemplates.some(
      (record) =>
        record.id !== seededCampaignTemplateVersionIds[record.language] ||
        record.contentHash !== seededCampaignTemplateContentHashes[record.language] ||
        record.localState !== "approved" ||
        !record.immutable ||
        record.providerState.submissionState !== "not_submitted" ||
        record.providerState.approvalState !== "unverified" ||
        record.providerState.authority !== "none" ||
        record.providerState.assetId !== null ||
        record.ownership.transferableToHemas ||
        record.ownership.productionUseAllowed,
    )
  ) {
    throw new Error(
      "Governed campaign templates are not exact internal-approved, provider-unverified v3 language records.",
    );
  }
  const sinhalaDraft = templates.find(
    (record) =>
      record.assetKey === "wellness_awareness" &&
      record.language === "si" &&
      record.version === 4,
  );
  if (!sinhalaDraft || sinhalaDraft.localState !== "draft" || sinhalaDraft.immutable) {
    throw new Error("The distinct Sinhala wellness-awareness v4 draft was not preserved.");
  }

  const expectedUtilityTemplates = new Map<string, string>([
    [phase5AppointmentTemplateId, phase5AppointmentTemplateHash],
    ["template_synthetic_care_day1_en_v1", phase5CareTemplateHashes.day1.en],
    ["template_synthetic_care_day1_si_v1", phase5CareTemplateHashes.day1.si],
    ["template_synthetic_care_day1_ta_v1", phase5CareTemplateHashes.day1.ta],
    ["template_synthetic_care_day3_en_v1", phase5CareTemplateHashes.day3.en],
    ["template_synthetic_care_day3_si_v1", phase5CareTemplateHashes.day3.si],
    ["template_synthetic_care_day3_ta_v1", phase5CareTemplateHashes.day3.ta],
  ]);
  for (const [templateId, expectedHash] of expectedUtilityTemplates) {
    const template = templates.find((record) => record.id === templateId);
    if (
      !template ||
      template.category !== "utility" ||
      template.localState !== "approved" ||
      !template.immutable ||
      template.contentHash !== expectedHash ||
      computeSeedTemplateContentHash(template) !== expectedHash ||
      template.providerState.submissionState !== "not_submitted" ||
      template.providerState.approvalState !== "unverified" ||
      template.providerState.authority !== "none" ||
      template.providerState.assetId !== null ||
      template.ownership.transferableToHemas ||
      template.ownership.productionUseAllowed
    ) {
      throw new Error(`Purpose-safe utility template ${templateId} failed its exact binding.`);
    }
  }
}

async function assertSyntheticCampaignSeed(db: Firestore): Promise<void> {
  const workspaceId = String(DEMO_IDS.workspaces.safeNet);
  const [bundle, campaigns, snapshots, events, checkpoints, recipients, owner, approver, templates] =
    await Promise.all([
      getGovernedCampaignBundle(db, { workspaceId, campaignId: seededCampaignId }),
      getDocs(collection(db, "workspaces", workspaceId, "campaigns")),
      getDocs(collection(db, "workspaces", workspaceId, "audienceSnapshots")),
      getDocs(collection(db, "workspaces", workspaceId, "campaignEvents")),
      getDocs(collection(db, "workspaces", workspaceId, "campaignCheckpoints")),
      getDocs(collection(db, "workspaces", workspaceId, "campaignRecipients")),
      getDoc(doc(db, "workspaces", workspaceId, "members", seededCampaignOwnerId)),
      getDoc(doc(db, "workspaces", workspaceId, "members", seededCampaignApproverId)),
      listTemplateCatalogue(db, { workspaceId, pageSize: 100 }),
    ]);

  if (
    campaigns.size !== 1 ||
    snapshots.size !== 1 ||
    events.size !== 0 ||
    checkpoints.size !== 0 ||
    recipients.size !== 0
  ) {
    throw new Error(
      `Expected one governed campaign/snapshot and no event, checkpoint or recipient seeds; received ${campaigns.size}, ${snapshots.size}, ${events.size}, ${checkpoints.size} and ${recipients.size}.`,
    );
  }
  if (
    !owner.exists() ||
    !approver.exists() ||
    owner.data()?.id !== seededCampaignOwnerId ||
    owner.data()?.uid !== seededCampaignOwnerId ||
    owner.data()?.role !== "campaign_operator" ||
    owner.data()?.status !== "active" ||
    owner.data()?.scopeMode !== "assigned" ||
    !Array.isArray(owner.data()?.teamIds) ||
    owner.data()?.teamIds.length !== 0 ||
    !Array.isArray(owner.data()?.locationIds) ||
    owner.data()?.locationIds.length !== 0 ||
    approver.data()?.id !== seededCampaignApproverId ||
    approver.data()?.uid !== seededCampaignApproverId ||
    approver.data()?.role !== "campaign_approver" ||
    approver.data()?.status !== "active" ||
    approver.data()?.scopeMode !== "assigned" ||
    !Array.isArray(approver.data()?.teamIds) ||
    approver.data()?.teamIds.length !== 0 ||
    !Array.isArray(approver.data()?.locationIds) ||
    approver.data()?.locationIds.length !== 0 ||
    owner.data()?.id === approver.data()?.id
  ) {
    throw new Error("Campaign owner/approver membership or separation is invalid.");
  }

  const { campaign, audienceSnapshot } = bundle;
  const campaignTemplateContentHashes = Object.fromEntries(
    catalogueLanguages.map((language) => {
      const expectedId = seededCampaignTemplateVersionIds[language];
      const template = templates.find((record) => record.id === expectedId);
      if (!template) throw new Error(`Campaign template ${expectedId} is missing.`);
      return [language, template.contentHash];
    }),
  ) as Record<(typeof catalogueLanguages)[number], string>;
  if (
    campaign.id !== String(DEMO_IDS.campaign) ||
    audienceSnapshot.id !== String(DEMO_IDS.audience) ||
    campaign.state !== "scheduled" ||
    campaign.dispatchMode !== "simulation" ||
    campaign.revision !== 0 ||
    campaign.canaryStatus !== "not_run" ||
    campaign.processedEligible !== 0 ||
    campaign.scanOffset !== 0 ||
    campaign.nextBatchIndex !== 0 ||
    campaign.batchSize !== 1_000 ||
    campaign.lastCheckpointId !== null ||
    campaign.externalCalls !== 0 ||
    campaign.networkCalls !== 0 ||
    campaign.ownerId !== seededCampaignOwnerId ||
    campaign.approval.approverId !== seededCampaignApproverId ||
    campaign.approval.scope !== "simulation_only" ||
    JSON.stringify(campaign.templateVersionIds) !==
      JSON.stringify(seededCampaignTemplateVersionIds)
  ) {
    throw new Error("Governed campaign seed does not match the simulation-only contract.");
  }

  if (
    audienceSnapshot.totalEvaluated !== 50_000 ||
    audienceSnapshot.eligibleCount !== 38_443 ||
    audienceSnapshot.excludedCount !== 11_557 ||
    audienceSnapshot.unknownConsentCount !== 3_588 ||
    JSON.stringify(audienceSnapshot.exclusionsByReason) !==
      JSON.stringify({
        frequency_cap: 3_873,
        consent_missing: 3_588,
        suppressed: 2_915,
        duplicate: 444,
        invalid_contact: 442,
        language_unavailable: 295,
      }) ||
    JSON.stringify(audienceSnapshot.languageCounts) !==
      JSON.stringify({ en: 26_989, si: 12_038, ta: 10_973 }) ||
    audienceSnapshot.contentHash !== seededAudienceContentHash ||
    !audienceSnapshot.immutable
  ) {
    throw new Error("Governed audience aggregate counts or content hash changed.");
  }

  const canonicalBinding = serializeCampaignApprovalBinding({
    workspaceId: campaign.workspaceId,
    campaignId: campaign.id,
    audienceSnapshotId: campaign.audienceSnapshotId,
    snapshotContentHash: audienceSnapshot.contentHash,
    templateVersionIds: campaign.templateVersionIds,
    templateContentHashes: campaignTemplateContentHashes,
    purpose: campaign.purpose,
    messageCategory: campaign.messageCategory,
    targetAction: campaign.targetAction,
    schedule: {
      startsAtIso: campaign.schedule.startsAt,
      timeZone: campaign.schedule.timeZone,
      quietHours: campaign.schedule.quietHours,
    },
  });
  const recomputedApprovalHash = createHash("sha256")
    .update(canonicalBinding, "utf8")
    .digest("hex");
  if (
    JSON.stringify(campaignTemplateContentHashes) !==
      JSON.stringify(seededCampaignTemplateContentHashes) ||
    canonicalBinding !== seededCampaignApprovalSerialization ||
    recomputedApprovalHash !== seededCampaignApprovalHash ||
    campaign.approval.approvedContentHash !== recomputedApprovalHash ||
    String(campaign.approval.approvedContentHash) === String(audienceSnapshot.contentHash)
  ) {
    throw new Error("Campaign approval hash does not match the canonical governed binding.");
  }

  const forbiddenAggregateFields = [
    "recipients",
    "recipientIds",
    "contacts",
    "contactIds",
    "patients",
    "patientIds",
    "phoneNumbers",
  ];
  for (const record of [campaigns.docs[0]?.data(), snapshots.docs[0]?.data()]) {
    if (!record) throw new Error("Governed aggregate document is missing.");
    const leaked = forbiddenAggregateFields.find((field) => field in record);
    if (leaked) {
      throw new Error(`Governed campaign aggregate exposed forbidden field ${leaked}.`);
    }
  }
}

async function verifySyntheticGraph(authenticatedDb: Firestore, uid: string): Promise<string> {
  const workspaceId = String(DEMO_IDS.workspaces.safeNet);
  const access = await getWorkspaceAccess(authenticatedDb, { workspaceId, uid });
  const [
    connectionCentre,
    contacts,
    conversations,
    appointments,
    labReports,
    templates,
    flows,
    tamilFlows,
    campaignBundle,
    campaigns,
    audienceSnapshots,
    campaignEvents,
    campaignCheckpoints,
    appointmentDefinitions,
    laboratoryDefinitions,
    carePathways,
    appointmentActivation,
    laboratoryActivation,
    automationRun,
    careActivation,
    careEnrollment,
    aiGovernanceEvidence,
  ] = await Promise.all([
      loadDemoConnectionCentre(authenticatedDb, {
        workspaceId: DEMO_CONNECTION_WORKSPACE_ID,
      }),
      listScopedContacts(authenticatedDb, { workspaceId, pageSize: 100 }),
      listScopedConversations(authenticatedDb, { workspaceId, pageSize: 100 }),
      listScopedAppointments(authenticatedDb, { workspaceId, pageSize: 100 }),
      listScopedLabReports(authenticatedDb, { workspaceId, pageSize: 100 }),
      listTemplateCatalogue(authenticatedDb, { workspaceId, pageSize: 100 }),
      listFlowCatalogue(authenticatedDb, { workspaceId, pageSize: 100 }),
      listFlowCatalogue(authenticatedDb, { workspaceId, language: "ta", pageSize: 100 }),
      getGovernedCampaignBundle(authenticatedDb, {
        workspaceId,
        campaignId: seededCampaignId,
      }),
      listCampaigns(authenticatedDb, { workspaceId, pageSize: 100 }),
      listAudienceSnapshots(authenticatedDb, {
        workspaceId,
        campaignId: seededCampaignId,
        pageSize: 100,
      }),
      listCampaignEvents(authenticatedDb, {
        workspaceId,
        campaignId: seededCampaignId,
        pageSize: 100,
      }),
      listCampaignCheckpoints(authenticatedDb, {
        workspaceId,
        campaignId: seededCampaignId,
        pageSize: 100,
      }),
      listAutomationDefinitions(authenticatedDb, {
        workspaceId,
        family: "appointment_service",
        pageSize: 10,
      }),
      listAutomationDefinitions(authenticatedDb, {
        workspaceId,
        family: "laboratory_service",
        pageSize: 10,
      }),
      listCarePathways(authenticatedDb, {
        workspaceId,
        family: "post_discharge",
        pageSize: 10,
      }),
      getAutomationActivation(authenticatedDb, {
        workspaceId,
        family: "appointment_service",
      }),
      getAutomationActivation(authenticatedDb, {
        workspaceId,
        family: "laboratory_service",
      }),
      getAutomationRun(authenticatedDb, {
        workspaceId,
        id: phase5AutomationRunId,
      }),
      getCarePathwayActivation(authenticatedDb, { workspaceId }),
      getCareEnrollment(authenticatedDb, {
        workspaceId,
        id: phase5CareEnrollmentId,
      }),
      loadAiGovernanceEvidence(authenticatedDb, {
        workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
        plan: AI_GOVERNANCE_ROLE_READ_PLANS.tenant_admin,
      }),
    ]);

  const phase5CareConversation = conversations.find(
    (conversation) => conversation.id === DEMO_IDS.conversations.phase5Care,
  );
  const urgentSafetyConversation = conversations.find(
    (conversation) => conversation.id === DEMO_IDS.conversations.urgent,
  );
  if (
    connectionCentre.whatsappConnections.length !== 1 ||
    connectionCentre.whatsappConnections[0]?.id !== DEMO_WHATSAPP_CONNECTION_ID ||
    connectionCentre.integrations.length !== 2 ||
    connectionCentre.integrations.some(
      (integration, index) => integration.id !== DEMO_INTEGRATION_IDS[index],
    ) ||
    contacts.length !== 6 ||
    conversations.length !== 7 ||
    appointments.length !== 1 ||
    labReports.length !== 1 ||
    templates.length !== 12 ||
    flows.length !== 18 ||
    tamilFlows.length !== 6 ||
    campaigns.length !== 1 ||
    audienceSnapshots.length !== 1 ||
    campaignEvents.length !== 0 ||
    campaignCheckpoints.length !== 0 ||
    appointmentDefinitions.length !== 3 ||
    laboratoryDefinitions.length !== 3 ||
    carePathways.length !== 1 ||
    appointmentActivation.activeDefinitionId !== "automation_synthetic_appointment_v3" ||
    laboratoryActivation.activeDefinitionId !== "automation_synthetic_laboratory_v3" ||
    automationRun.id !== phase5AutomationRunId ||
    automationRun.state !== "queued" ||
    careActivation.activePathwayId !== phase5CarePathwayId ||
    careEnrollment.id !== phase5CareEnrollmentId ||
    careEnrollment.state !== "queued" ||
    aiGovernanceEvidence.role !== "tenant_admin" ||
    aiGovernanceEvidence.governance.status !== "ready" ||
    aiGovernanceEvidence.governance.documents.length !== 5 ||
    aiGovernanceEvidence.governance.selections.length !== 3 ||
    aiGovernanceEvidence.scenarios.length !== 4 ||
    aiGovernanceEvidence.scenarios.some((scenario) => scenario.status !== "not_recorded") ||
    phase5CareConversation?.contactId !== DEMO_IDS.contacts.urgent ||
    phase5CareConversation.connectionId !== DEMO_IDS.connections.simulator ||
    phase5CareConversation.teamId !== DEMO_IDS.teams.clinicalEscalation ||
    phase5CareConversation.locationId !== DEMO_IDS.locations.wattala ||
    phase5CareConversation.mode !== "automation" ||
    phase5CareConversation.status !== "active" ||
    phase5CareConversation.purpose !== "care_pathway" ||
    urgentSafetyConversation?.workspaceId !== DEMO_IDS.workspaces.safeNet ||
    urgentSafetyConversation.contactId !== DEMO_IDS.contacts.urgent ||
    urgentSafetyConversation.connectionId !== DEMO_IDS.connections.simulator ||
    urgentSafetyConversation.teamId !== DEMO_IDS.teams.clinicalEscalation ||
    urgentSafetyConversation.locationId !== DEMO_IDS.locations.wattala ||
    urgentSafetyConversation?.mode !== "safety_hold" ||
    urgentSafetyConversation.status !== "escalated" ||
    urgentSafetyConversation.purpose !== "urgent_escalation"
  ) {
    throw new Error(
      `Unexpected graph counts: ${contacts.length} contacts, ${conversations.length} conversations, ${appointments.length} appointments, ${labReports.length} lab reports, ${templates.length} templates, ${flows.length} Flows, ${tamilFlows.length} Tamil Flows, ${campaigns.length} campaigns, ${audienceSnapshots.length} audience snapshots, ${campaignEvents.length} campaign events, ${campaignCheckpoints.length} checkpoints, ${appointmentDefinitions.length + laboratoryDefinitions.length} automation versions and ${carePathways.length} care pathways.`,
    );
  }
  if ([...templates, ...flows].some((asset) => hasVerifiedProviderApproval(asset))) {
    throw new Error("Authenticated catalogue read inferred provider approval.");
  }
  if (
    campaignBundle.campaign.id !== seededCampaignId ||
    campaignBundle.audienceSnapshot.id !== seededAudienceSnapshotId ||
    campaignBundle.campaign.approval.scope !== "simulation_only" ||
    campaignBundle.campaign.externalCalls !== 0 ||
    campaignBundle.campaign.networkCalls !== 0
  ) {
    throw new Error("Authenticated governed campaign bundle failed simulation-only checks.");
  }

  const rawContact = await getDoc(
    doc(
      authenticatedDb,
      "workspaces",
      workspaceId,
      "contacts",
      String(DEMO_IDS.contacts.appointment),
    ),
  );
  const leakedField = protectedContactFields.find((field) => field in (rawContact.data() ?? {}));
  if (leakedField) {
    throw new Error(`Authenticated staff contact read exposed protected field ${leakedField}.`);
  }

  const [rawLabReport, rawLabReportEvent] = await Promise.all([
    getDoc(
      doc(
        authenticatedDb,
        "workspaces",
        workspaceId,
        "labReports",
        String(DEMO_IDS.labReport),
      ),
    ),
    getDoc(
      doc(
        authenticatedDb,
        "workspaces",
        workspaceId,
        "labReportEvents",
        seededLabReportEventId,
      ),
    ),
  ]);
  const rawLabReportData = rawLabReport.data() ?? {};
  const rawLabAccess = (rawLabReportData.secureAccess ?? {}) as Record<string, unknown>;
  if (
    "externalReportRef" in rawLabReportData ||
    "notificationIdempotencyFingerprint" in rawLabReportData ||
    "handoffRef" in rawLabAccess
  ) {
    throw new Error("Authenticated staff laboratory read exposed a protected report field.");
  }
  if ("idempotencyFingerprint" in (rawLabReportEvent.data() ?? {})) {
    throw new Error("Authenticated staff laboratory event exposed a protected fingerprint.");
  }

  const [appointmentEvents, labReportEvents] = await Promise.all([
    listAppointmentEvents(authenticatedDb, {
      workspaceId,
      subjectId: String(DEMO_IDS.appointment),
      teamId: String(DEMO_IDS.teams.general),
      locationId: String(DEMO_IDS.locations.wattala),
      pageSize: 25,
    }),
    listLabReportEvents(authenticatedDb, {
      workspaceId,
      subjectId: String(DEMO_IDS.labReport),
      teamId: String(DEMO_IDS.teams.laboratory),
      locationId: String(DEMO_IDS.locations.labNetwork),
      pageSize: 25,
    }),
  ]);
  if (appointmentEvents.length !== 1 || labReportEvents.length !== 1) {
    throw new Error("Expected one immutable seed event for each journey.");
  }

  const consentGroups = await Promise.all(
    contacts.map((contact) =>
      listConsentRecordsForContact(authenticatedDb, {
        workspaceId,
        contactId: contact.id,
        teamId: contact.teamId,
        locationId: contact.locationId,
        pageSize: 100,
      }),
    ),
  );
  const messageGroups = await Promise.all(
    conversations.map((conversation) =>
      listConversationMessageMetadata(authenticatedDb, {
        workspaceId,
        conversationId: conversation.id,
        teamId: conversation.teamId,
        locationId: conversation.locationId,
        pageSize: 100,
      }),
    ),
  );
  const consentCount = consentGroups.reduce((total, records) => total + records.length, 0);
  const messageCount = messageGroups.reduce((total, records) => total + records.length, 0);
  if (consentCount !== 7 || messageCount !== 7) {
    throw new Error(
      `Expected seven consent events and seven message metadata records; received ${consentCount} and ${messageCount}.`,
    );
  }

  const preferenceUpdate = await updateSyntheticContactPreferences(authenticatedDb, {
    workspaceId,
    // Exercise the client mutation boundary on a contact that is not bound to
    // the Phase 5 appointment/care execution fixtures. The appointment contact
    // must remain English so its exact approved EN template stays executable.
    contactId: String(DEMO_IDS.contacts.mixedLanguage),
    preferredLanguage: "ta",
    alternateLanguages: ["en"],
    tags: ["human-handoff"],
    expectedPreferenceRevision: 0,
  });
  const notes = await listSyntheticInternalNotes(authenticatedDb, {
    workspaceId,
    conversationId: String(DEMO_IDS.conversations.appointment),
    teamId: String(DEMO_IDS.teams.general),
    locationId: String(DEMO_IDS.locations.wattala),
    pageSize: 25,
  });

  const [teams, locations] = await Promise.all([
    listWorkspaceTeams(authenticatedDb, { workspaceId, pageSize: 100 }),
    listWorkspaceLocations(authenticatedDb, { workspaceId, pageSize: 100 }),
  ]);
  if (teams.length !== 3 || locations.length !== 3) {
    throw new Error(
      `Expected three teams and locations; received ${teams.length} and ${locations.length}.`,
    );
  }

  await assertClientDenied(
    () => getDoc(doc(authenticatedDb, "workspaces", String(DEMO_IDS.workspaces.hemasLocked))),
    "Locked Hemas workspace",
  );
  await assertClientDenied(
    () =>
      getDoc(
        doc(
          authenticatedDb,
          "workspaces",
          String(DEMO_IDS.workspaces.hemasLocked),
          "members",
          uid,
        ),
      ),
    "Locked Hemas membership",
  );
  await assertClientDenied(
    () => getDoc(doc(authenticatedDb, "phoneRoutes", syntheticPhoneRoutes[0].id)),
    "Server-only Wattala synthetic phone route",
  );
  await assertClientDenied(
    () => getDoc(doc(authenticatedDb, "phoneRoutes", syntheticPhoneRoutes[1].id)),
    "Server-only Thalawathugoda synthetic phone route",
  );
  await assertClientDenied(
    () => getDocs(collection(authenticatedDb, "phoneRoutes")),
    "Server-only global phone route collection",
  );
  await assertClientDenied(
    () => getDoc(doc(authenticatedDb, "wabaRoutes", "synthetic-waba-route-not-seeded")),
    "Server-only global WABA route",
  );
  await assertClientDenied(
    () => getDocs(collection(authenticatedDb, "wabaRoutes")),
    "Server-only global WABA route collection",
  );
  await assertClientDenied(
    () =>
      getDoc(
        doc(
          authenticatedDb,
          "workspaces",
          workspaceId,
          "whatsappConnectionSecrets",
          DEMO_WHATSAPP_CONNECTION_ID,
        ),
      ),
    "Server-only WhatsApp connection secret",
  );
  await assertClientDenied(
    () =>
      getDocs(
        collection(
          authenticatedDb,
          "workspaces",
          workspaceId,
          "whatsappConnectionSecrets",
        ),
      ),
    "Server-only WhatsApp connection secret collection",
  );
  await assertClientDenied(
    () =>
      getDoc(
        doc(
          authenticatedDb,
          "workspaces",
          workspaceId,
          "integrationSecrets",
          DEMO_INTEGRATION_IDS[0],
        ),
      ),
    "Server-only integration secret",
  );
  await assertClientDenied(
    () =>
      getDocs(
        collection(
          authenticatedDb,
          "workspaces",
          workspaceId,
          "integrationSecrets",
        ),
      ),
    "Server-only integration secret collection",
  );
  await assertClientDenied(
    () =>
      getDoc(
        doc(
          authenticatedDb,
          "workspaces",
          workspaceId,
          "contactSecrets",
          String(DEMO_IDS.contacts.appointment),
        ),
      ),
    "Server-only contact secret",
  );
  await assertClientDenied(
    () => getDocs(collection(authenticatedDb, "workspaces", workspaceId, "contactSecrets")),
    "Server-only contact secret collection",
  );
  await assertClientDenied(
    () =>
      getDoc(
        doc(
          authenticatedDb,
          "workspaces",
          workspaceId,
          "labReportSecrets",
          String(DEMO_IDS.labReport),
        ),
      ),
    "Server-only laboratory report secret",
  );
  await assertClientDenied(
    () => getDocs(collection(authenticatedDb, "workspaces", workspaceId, "labReportSecrets")),
    "Server-only laboratory report secret collection",
  );
  await assertClientDenied(
    () =>
      getDoc(
        doc(
          authenticatedDb,
          "workspaces",
          workspaceId,
          "labReportEventSecrets",
          seededLabReportEventId,
        ),
      ),
    "Server-only laboratory event secret",
  );
  await assertClientDenied(
    () =>
      getDocs(
        collection(authenticatedDb, "workspaces", workspaceId, "labReportEventSecrets"),
      ),
    "Server-only laboratory event secret collection",
  );
  await assertClientDenied(
    () =>
      getDoc(
        doc(
          authenticatedDb,
          "workspaces",
          workspaceId,
          "campaignRecipients",
          "recipient-not-seeded",
        ),
      ),
    "Server-only campaign recipient",
  );
  await assertClientDenied(
    () =>
      getDocs(collection(authenticatedDb, "workspaces", workspaceId, "campaignRecipients")),
    "Server-only campaign recipient collection",
  );

  const automationSourceFingerprint = phase5Sha256(
    serializeAutomationSourceEventIdentity({
      workspaceId,
      connectionId: String(DEMO_IDS.connections.simulator),
      eventKind: "appointment_event",
      sourceEventId: "appointment_event_synthetic_phase5_seed",
    }),
  );
  const automationReceiptId = phase5HmacSha256(
    serializeAutomationTriggerReceiptKey({
      workspaceId,
      family: "appointment_service",
      sourceEventFingerprint: automationSourceFingerprint,
    }),
  );
  const careDischargeFingerprint = phase5Sha256(
    serializeCareDischargeSourceIdentity({
      workspaceId,
      sourceSystem: "simulator",
      connectionId: String(DEMO_IDS.connections.simulator),
      dischargeEventId: "discharge_event_synthetic_phase5_001",
    }),
  );
  const careReceiptId = phase5HmacSha256(
    serializeCareEnrollmentReceiptKey({
      workspaceId,
      family: "post_discharge",
      dischargeFingerprint: careDischargeFingerprint,
    }),
  );
  const phase5SecretProbeIds: Readonly<
    Record<(typeof PHASE5_SECRET_COLLECTIONS)[number], string>
  > = {
    automationDefinitionSecrets: "automation_synthetic_appointment_v3",
    automationTriggerReceipts: automationReceiptId,
    automationRunSecrets: phase5AutomationRunId,
    automationRunEventSecrets: "automation_run_event_not_seeded",
    automationWorkItemSecrets: "automation_work_item_not_seeded",
    carePathwaySecrets: phase5CarePathwayId,
    careEnrollmentReceipts: careReceiptId,
    careEnrollmentSecrets: phase5CareEnrollmentId,
    careEnrollmentEventSecrets: "care_enrollment_event_not_seeded",
    careEscalationSecrets: "care_escalation_not_seeded",
  };
  for (const secretCollection of PHASE5_SECRET_COLLECTIONS) {
    await assertClientDenied(
      () =>
        getDoc(
          doc(
            authenticatedDb,
            "workspaces",
            workspaceId,
            secretCollection,
            phase5SecretProbeIds[secretCollection],
          ),
        ),
      `Phase 5 server-only ${secretCollection} exact read`,
    );
    await assertClientDenied(
      () =>
        getDocs(
          collection(authenticatedDb, "workspaces", workspaceId, secretCollection),
        ),
      `Phase 5 server-only ${secretCollection} list`,
    );
  }

  for (const publicCollection of [
    AI_GOVERNANCE_COLLECTIONS.knowledgeDocuments,
    AI_GOVERNANCE_COLLECTIONS.knowledgeSelections,
    AI_GOVERNANCE_COLLECTIONS.retrospectiveRuns,
    AI_GOVERNANCE_COLLECTIONS.retrospectiveEvents,
  ] as const) {
    await assertClientDenied(
      () => getDocs(collection(authenticatedDb, "workspaces", workspaceId, publicCollection)),
      `AI governance staff-safe ${publicCollection} list`,
    );
  }

  const aiServerOnlyProbeIds = Object.freeze({
    [AI_GOVERNANCE_COLLECTIONS.knowledgeDocumentSecrets]:
      AI_KNOWLEDGE_DOCUMENT_MATRIX[AI_KNOWLEDGE_DOCUMENT_IDS[0]].secretId,
    [AI_GOVERNANCE_COLLECTIONS.retrospectiveRunSecrets]:
      AI_PERSISTED_SCENARIO_MATRIX.appointment.runSecretId,
    [AI_GOVERNANCE_COLLECTIONS.retrospectiveEventSecrets]:
      AI_PERSISTED_SCENARIO_MATRIX.appointment.eventSecretId,
    [AI_GOVERNANCE_COLLECTIONS.idempotencyReceipts]: "ai_idempotency_not_seeded",
  });
  for (const [secretCollection, documentId] of Object.entries(aiServerOnlyProbeIds)) {
    await assertClientDenied(
      () =>
        getDoc(
          doc(
            authenticatedDb,
            "workspaces",
            workspaceId,
            secretCollection,
            documentId,
          ),
        ),
      `AI governance server-only ${secretCollection} exact read`,
    );
    await assertClientDenied(
      () =>
        getDocs(collection(authenticatedDb, "workspaces", workspaceId, secretCollection)),
      `AI governance server-only ${secretCollection} list`,
    );
  }

  return `${access.membership.role} access for ${email}: 1 governed staff-safe WhatsApp simulator and 2 deterministic zero-network integrations with no connection secret documents, 6 staff-safe contacts with 6 server-only contact secrets, 12 strict template versions and 18 singular-language Flow versions with provider state unverified/not submitted, 1 governed 50,000-record simulation campaign with immutable aggregate snapshot and no seeded recipients/events/checkpoints, 7 immutable consent events, 7 conversations including a distinct Phase 5 care-control route while the urgent safety-hold fixture remains intact, 7 metadata-only messages, 1 appointment plus event, 1 staff-safe lab workflow/event with atomic server-only secret pairs, 3 teams, 3 locations, 51 Phase 5 documents across the exact 13 staff/governance plus 10 server-only collection contract with 28 lifecycle audit joins, 13 immutable AI governance seed documents with zero runtime records, receipts or AI audits, 6 automation versions, 2 activations, 1 queued run, 1 approved care pathway/activation and 1 queued care enrollment, contact preference revision ${preferenceUpdate.preferenceRevision}, ${notes.length} backend-seeded protected-reference note; locked Hemas membership, phone/WABA routes, connection/contact/laboratory/campaign/AI secrets, AI idempotency and all 10 Phase 5 secret/receipt collections denied to the client`;
}

async function main(): Promise<void> {
  assertSafeSeedEmulatorHosts({
    FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
    FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST,
  });

  const uid = await ensureSyntheticAuthUser();
  const environment = await initializeTestEnvironment({ projectId });
  await environment.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore() as unknown as Firestore;
    await seedSyntheticGraph(adminDb, uid);
    await assertProtectedContactSeedSplit(adminDb);
    await assertProtectedLaboratorySeedSplit(adminDb);
    await assertSyntheticCatalogueSeed(adminDb);
    await assertSyntheticCampaignSeed(adminDb);
    await assertPhase5SeedGraph(adminDb, uid);
    await assertAiGovernanceSeedGraph(adminDb);
    await assertSyntheticConnectionSeed(adminDb);
  });

  const verifierApp = initializeApp(
    {
      apiKey: "demo-api-key",
      authDomain: `${projectId}.firebaseapp.com`,
      projectId,
    },
    "synthetic-seed-verifier",
  );

  try {
    const auth = getAuth(verifierApp);
    connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, {
      disableWarnings: true,
    });
    await signInWithEmailAndPassword(auth, email, password);

    const firestoreEndpoint = new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST}`);
    const authenticatedDb = getFirestore(verifierApp);
    connectFirestoreEmulator(
      authenticatedDb,
      firestoreEndpoint.hostname,
      Number(firestoreEndpoint.port),
    );

    const evidence = await verifySyntheticGraph(authenticatedDb, uid);
    process.stdout.write(`Seeded and verified ${evidence}.\n`);
  } finally {
    await Promise.all([deleteApp(verifierApp), environment.cleanup()]);
  }
}

await main();
