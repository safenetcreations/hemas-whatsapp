import { assertSafeTenantId } from "../errors.js";

export type ReviewLanguage = "en" | "si" | "ta" | "mixed";
export type ReviewIntent =
  | "appointment_initiation"
  | "service_information"
  | "branch_information"
  | "laboratory_notification"
  | "package_information"
  | "medication_advice"
  | "report_interpretation"
  | "urgent_help"
  | "marketing_withdrawal"
  | "unknown";

export type ReviewReasonCode =
  | "approved_knowledge_only"
  | "clinical_advice_prohibited"
  | "invalid_input"
  | "low_language_confidence"
  | "stop_intent"
  | "unsupported_claim"
  | "urgent_language";

export interface SyntheticReviewInput {
  readonly tenantId: string;
  readonly syntheticConversationRef: string;
  readonly message: string;
  readonly language: ReviewLanguage;
  readonly languageConfidence: number;
  readonly intent: ReviewIntent;
  readonly approvedKnowledgeVersionIds: readonly string[];
  readonly withinServiceWindow: boolean;
  readonly humanTakeover: boolean;
}

export interface SyntheticReviewDecision {
  readonly decision: "pass" | "fail";
  readonly reasonCodes: readonly ReviewReasonCode[];
  readonly unsupportedClaim: boolean;
  readonly clinicalSafety: "pass" | "blocked";
  readonly privacy: "pass";
  readonly serviceWindow: "in_window" | "template_required";
  readonly requiredCorrection: string | null;
  readonly handoffRequired: boolean;
  readonly marketingSuppressionRequired: boolean;
  readonly ordinaryAutomationPaused: boolean;
  readonly sendMode: "preview_only" | "no_send";
  readonly chainOfThoughtStored: false;
  readonly networkCalls: 0;
  readonly simulated: true;
}

const STOP_PATTERN = /^(?:stop|unsubscribe|cancel marketing)$/i;
const URGENT_PATTERNS = [
  /(?:severe|sudden) chest pain/i,
  /(?:cannot|can't|unable to) breathe/i,
  /severe bleeding/i,
  /unconscious/i,
  /(?:kill|harm) myself/i,
  /மூச்சு விட முடியவில்லை/u,
  /கடுமையான மார்பு வலி/u,
  /හුස්ම ගන්න බැහැ/u,
  /දැඩි පපුවේ වේදනාව/u,
] as const;

const CLINICAL_INTENTS: readonly ReviewIntent[] = [
  "medication_advice",
  "report_interpretation",
];
const APPROVED_INFORMATION_INTENTS: readonly ReviewIntent[] = [
  "appointment_initiation",
  "service_information",
  "branch_information",
  "laboratory_notification",
  "package_information",
];

function hasUrgentLanguage(message: string): boolean {
  return URGENT_PATTERNS.some((pattern) => pattern.test(message));
}

function failDecision(input: {
  reasonCodes: readonly ReviewReasonCode[];
  unsupportedClaim?: boolean;
  clinicalSafety?: "pass" | "blocked";
  requiredCorrection: string;
  handoffRequired: boolean;
  marketingSuppressionRequired?: boolean;
  ordinaryAutomationPaused?: boolean;
  withinServiceWindow: boolean;
}): SyntheticReviewDecision {
  return {
    decision: "fail",
    reasonCodes: input.reasonCodes,
    unsupportedClaim: input.unsupportedClaim ?? false,
    clinicalSafety: input.clinicalSafety ?? "pass",
    privacy: "pass",
    serviceWindow: input.withinServiceWindow ? "in_window" : "template_required",
    requiredCorrection: input.requiredCorrection,
    handoffRequired: input.handoffRequired,
    marketingSuppressionRequired: input.marketingSuppressionRequired ?? false,
    ordinaryAutomationPaused: input.ordinaryAutomationPaused ?? false,
    sendMode: "no_send",
    chainOfThoughtStored: false,
    networkCalls: 0,
    simulated: true,
  };
}

/**
 * Deterministic policy simulator. It performs no diagnosis, model inference,
 * retrieval, persistence, or provider call.
 */
export function reviewSyntheticPatientMessage(
  input: SyntheticReviewInput,
): SyntheticReviewDecision {
  assertSafeTenantId(input.tenantId);
  const message = input.message.trim();
  if (
    !input.syntheticConversationRef.startsWith("synthetic-") ||
    !message ||
    message.length > 2_000 ||
    !Number.isFinite(input.languageConfidence) ||
    input.languageConfidence < 0 ||
    input.languageConfidence > 1
  ) {
    return failDecision({
      reasonCodes: ["invalid_input"],
      clinicalSafety: "blocked",
      requiredCorrection: "Use a bounded synthetic message and validated language confidence.",
      handoffRequired: true,
      withinServiceWindow: input.withinServiceWindow,
    });
  }

  if (STOP_PATTERN.test(message) || input.intent === "marketing_withdrawal") {
    return failDecision({
      reasonCodes: ["stop_intent"],
      requiredCorrection: "Apply purpose-specific marketing suppression before ordinary automation.",
      handoffRequired: false,
      marketingSuppressionRequired: true,
      ordinaryAutomationPaused: true,
      withinServiceWindow: input.withinServiceWindow,
    });
  }

  if (hasUrgentLanguage(message) || input.intent === "urgent_help") {
    return failDecision({
      reasonCodes: ["urgent_language"],
      clinicalSafety: "blocked",
      requiredCorrection: "Use the approved immediate safety path and assign an authorized human.",
      handoffRequired: true,
      ordinaryAutomationPaused: true,
      withinServiceWindow: input.withinServiceWindow,
    });
  }

  if (input.humanTakeover) {
    return failDecision({
      reasonCodes: ["invalid_input"],
      requiredCorrection: "Keep automated drafts paused until the authorized human releases takeover.",
      handoffRequired: true,
      ordinaryAutomationPaused: true,
      withinServiceWindow: input.withinServiceWindow,
    });
  }

  if (input.language === "mixed" || input.languageConfidence < 0.7) {
    return failDecision({
      reasonCodes: ["low_language_confidence"],
      requiredCorrection: "Ask for a language choice or use a multilingual human handoff.",
      handoffRequired: true,
      withinServiceWindow: input.withinServiceWindow,
    });
  }

  if (CLINICAL_INTENTS.includes(input.intent)) {
    return failDecision({
      reasonCodes: ["clinical_advice_prohibited"],
      clinicalSafety: "blocked",
      requiredCorrection: "Do not diagnose, interpret a report, or recommend a medication or dose.",
      handoffRequired: true,
      withinServiceWindow: input.withinServiceWindow,
    });
  }

  if (
    !APPROVED_INFORMATION_INTENTS.includes(input.intent) ||
    input.approvedKnowledgeVersionIds.length === 0 ||
    input.approvedKnowledgeVersionIds.length > 20 ||
    input.approvedKnowledgeVersionIds.some((id) => !/^kn-[a-z0-9-]{3,80}-v\d+$/.test(id))
  ) {
    return failDecision({
      reasonCodes: ["unsupported_claim"],
      unsupportedClaim: true,
      requiredCorrection: "Use a current approved knowledge version or route to a human fact owner.",
      handoffRequired: true,
      withinServiceWindow: input.withinServiceWindow,
    });
  }

  if (!input.withinServiceWindow) {
    return failDecision({
      reasonCodes: ["invalid_input"],
      requiredCorrection: "Select a matching approved template or use the no-send path outside the service window.",
      handoffRequired: false,
      withinServiceWindow: false,
    });
  }

  return {
    decision: "pass",
    reasonCodes: ["approved_knowledge_only"],
    unsupportedClaim: false,
    clinicalSafety: "pass",
    privacy: "pass",
    serviceWindow: "in_window",
    requiredCorrection: null,
    handoffRequired: false,
    marketingSuppressionRequired: false,
    ordinaryAutomationPaused: false,
    sendMode: "preview_only",
    chainOfThoughtStored: false,
    networkCalls: 0,
    simulated: true,
  };
}

export function canAuthorizedHumanCloseUrgentEscalation(input: {
  readonly review: SyntheticReviewDecision;
  readonly actorRole: "agent" | "supervisor" | "clinical_approver" | "system";
  readonly explicitClosure: boolean;
}): boolean {
  if (!input.review.reasonCodes.includes("urgent_language")) return false;
  return (
    input.explicitClosure &&
    (input.actorRole === "supervisor" || input.actorRole === "clinical_approver")
  );
}
