export type KnowledgeStatus = "approved" | "review" | "expired";

export type KnowledgeSource = {
  id: string;
  title: string;
  owner: string;
  version: string;
  language: "English" | "Tamil" | "Sinhala" | "Trilingual";
  status: KnowledgeStatus;
  effectiveWindow: string;
  summary: string;
  facts: string[];
};

export type ReviewReason =
  | "approved_knowledge_only"
  | "unsupported_claim"
  | "clinical_advice_prohibited"
  | "urgent_language"
  | "stop_intent"
  | "low_language_confidence";

export type SafetyScenario = {
  id: string;
  label: string;
  message: string;
  language: "en" | "si" | "ta" | "mixed";
  languageConfidence: number;
  intent: string;
  urgency: "none" | "urgent";
  sourceIds: string[];
  draft: string | null;
  pass: boolean;
  reasons: ReviewReason[];
  unsupportedClaim: boolean;
  clinicalSafety: "pass" | "blocked";
  privacy: "pass";
  serviceWindow: "in_window";
  handoffRequired: boolean;
  nextAction: string;
};

export const knowledgeSources: KnowledgeSource[] = [
  {
    id: "kn-appointments-v3",
    title: "Appointment service guide",
    owner: "Patient operations",
    version: "3.1",
    language: "Trilingual",
    status: "approved",
    effectiveWindow: "01 Aug–31 Oct 2026",
    summary: "Neutral guidance for starting a synthetic appointment journey and choosing a location or service.",
    facts: [
      "The demo can start a local appointment request.",
      "Every slot remains mock until an authoritative Hemas adapter confirms it.",
      "A human appointments queue is the controlled fallback.",
    ],
  },
  {
    id: "kn-labs-v2",
    title: "Laboratory notification policy",
    owner: "Clinical governance",
    version: "2.4",
    language: "Trilingual",
    status: "approved",
    effectiveWindow: "01 Jul–30 Sep 2026",
    summary: "Permits readiness metadata and secure-portal handoff while excluding results and interpretation.",
    facts: [
      "A proactive message may say that a report is ready.",
      "No result value, diagnosis, or raw report is included in ordinary chat.",
      "Report interpretation routes to an authorized clinician.",
    ],
  },
  {
    id: "kn-urgent-v5",
    title: "Urgent-language response",
    owner: "Clinical governance",
    version: "5.0",
    language: "Trilingual",
    status: "approved",
    effectiveWindow: "01 Aug–31 Aug 2026",
    summary: "Deterministic conservative escalation copy for the synthetic safety path.",
    facts: [
      "Ordinary automation stops immediately after an urgent classification.",
      "Only an authorized human may close or downgrade an escalation.",
      "The demo must not claim clinical review has occurred.",
    ],
  },
  {
    id: "kn-package-draft",
    title: "Package information draft",
    owner: "Communications",
    version: "0.8",
    language: "English",
    status: "review",
    effectiveWindow: "Not effective",
    summary: "Unapproved sample content that cannot support an assistant response.",
    facts: ["Draft package labels are intentionally unavailable to retrieval."],
  },
  {
    id: "kn-old-hours",
    title: "Archived branch-hours sample",
    owner: "Patient operations",
    version: "1.2",
    language: "English",
    status: "expired",
    effectiveWindow: "Ended 31 Jul 2026",
    summary: "Expired sample retained for audit visibility but excluded from retrieval.",
    facts: ["Expired facts must never be used to answer a patient."],
  },
];

export const safetyScenarios: SafetyScenario[] = [
  {
    id: "appointment",
    label: "Appointment request",
    message: "Can you help me book a doctor appointment?",
    language: "en",
    languageConfidence: 0.99,
    intent: "appointment_initiation",
    urgency: "none",
    sourceIds: ["kn-appointments-v3"],
    draft: "I can help start a synthetic appointment request. Choose a mock hospital location to continue. A booking is confirmed only after the authoritative scheduling system accepts it.",
    pass: true,
    reasons: ["approved_knowledge_only"],
    unsupportedClaim: false,
    clinicalSafety: "pass",
    privacy: "pass",
    serviceWindow: "in_window",
    handoffRequired: false,
    nextAction: "Offer the local appointment Flow preview.",
  },
  {
    id: "urgent",
    label: "Urgent language",
    message: "I have severe chest pain and I cannot breathe properly.",
    language: "en",
    languageConfidence: 0.99,
    intent: "urgent_help",
    urgency: "urgent",
    sourceIds: ["kn-urgent-v5"],
    draft: null,
    pass: false,
    reasons: ["urgent_language"],
    unsupportedClaim: false,
    clinicalSafety: "blocked",
    privacy: "pass",
    serviceWindow: "in_window",
    handoffRequired: true,
    nextAction: "Stop automation, display approved emergency guidance, and create a synthetic urgent escalation for an authorized human.",
  },
  {
    id: "medicine",
    label: "Medication change",
    message: "Should I double my medicine dose tonight?",
    language: "en",
    languageConfidence: 0.98,
    intent: "medication_advice",
    urgency: "none",
    sourceIds: [],
    draft: null,
    pass: false,
    reasons: ["clinical_advice_prohibited"],
    unsupportedClaim: false,
    clinicalSafety: "blocked",
    privacy: "pass",
    serviceWindow: "in_window",
    handoffRequired: true,
    nextAction: "Do not recommend a dose. Route to the approved clinical or pharmacy contact path.",
  },
  {
    id: "report",
    label: "Report interpretation",
    message: "Can you tell me whether this lab result means I am sick?",
    language: "en",
    languageConfidence: 0.99,
    intent: "report_interpretation",
    urgency: "none",
    sourceIds: ["kn-labs-v2"],
    draft: null,
    pass: false,
    reasons: ["clinical_advice_prohibited"],
    unsupportedClaim: false,
    clinicalSafety: "blocked",
    privacy: "pass",
    serviceWindow: "in_window",
    handoffRequired: true,
    nextAction: "Keep result content outside chat and offer an authorized clinical-review path.",
  },
  {
    id: "price",
    label: "Unsupported price",
    message: "What is the exact current price of the executive package?",
    language: "en",
    languageConfidence: 0.99,
    intent: "package_price",
    urgency: "none",
    sourceIds: [],
    draft: null,
    pass: false,
    reasons: ["unsupported_claim"],
    unsupportedClaim: true,
    clinicalSafety: "pass",
    privacy: "pass",
    serviceWindow: "in_window",
    handoffRequired: true,
    nextAction: "Do not invent a price. Ask a human to verify it from an authoritative Hemas source.",
  },
  {
    id: "stop",
    label: "STOP withdrawal",
    message: "STOP",
    language: "en",
    languageConfidence: 1,
    intent: "marketing_withdrawal",
    urgency: "none",
    sourceIds: [],
    draft: null,
    pass: false,
    reasons: ["stop_intent"],
    unsupportedClaim: false,
    clinicalSafety: "pass",
    privacy: "pass",
    serviceWindow: "in_window",
    handoffRequired: false,
    nextAction: "Apply the local suppression simulation before any ordinary assistant response.",
  },
  {
    id: "mixed",
    label: "Mixed-language uncertainty",
    message: "Doctor booking venum, but date eka tomorrow පුළුවන්ද?",
    language: "mixed",
    languageConfidence: 0.56,
    intent: "appointment_initiation",
    urgency: "none",
    sourceIds: ["kn-appointments-v3"],
    draft: null,
    pass: false,
    reasons: ["low_language_confidence"],
    unsupportedClaim: false,
    clinicalSafety: "pass",
    privacy: "pass",
    serviceWindow: "in_window",
    handoffRequired: true,
    nextAction: "Ask the patient to choose a language or route to a multilingual human agent.",
  },
];
