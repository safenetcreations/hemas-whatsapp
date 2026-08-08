import assert from "node:assert/strict";
import test from "node:test";
import {
  canAuthorizedHumanCloseUrgentEscalation,
  reviewSyntheticPatientMessage,
  type SyntheticReviewInput,
} from "../src/simulator/reviewer.js";

const base: SyntheticReviewInput = {
  tenantId: "safenet-demo",
  syntheticConversationRef: "synthetic-conversation-001",
  message: "Can you help me book a doctor appointment?",
  language: "en",
  languageConfidence: 0.99,
  intent: "appointment_initiation",
  approvedKnowledgeVersionIds: ["kn-appointment-service-v3"],
  withinServiceWindow: true,
  humanTakeover: false,
};

test("reviewer allows only a preview for an approved informational path", () => {
  const result = reviewSyntheticPatientMessage(base);
  assert.equal(result.decision, "pass");
  assert.equal(result.sendMode, "preview_only");
  assert.equal(result.networkCalls, 0);
  assert.equal(result.chainOfThoughtStored, false);
  assert.equal(result.clinicalSafety, "pass");
});

test("reviewer fails urgent language closed and pauses ordinary automation", () => {
  const result = reviewSyntheticPatientMessage({
    ...base,
    message: "I have severe chest pain and cannot breathe.",
    intent: "urgent_help",
    approvedKnowledgeVersionIds: ["kn-urgent-path-v5"],
  });
  assert.equal(result.decision, "fail");
  assert.deepEqual(result.reasonCodes, ["urgent_language"]);
  assert.equal(result.clinicalSafety, "blocked");
  assert.equal(result.handoffRequired, true);
  assert.equal(result.ordinaryAutomationPaused, true);
  assert.equal(result.sendMode, "no_send");
  assert.equal(canAuthorizedHumanCloseUrgentEscalation({
    review: result,
    actorRole: "agent",
    explicitClosure: true,
  }), false);
  assert.equal(canAuthorizedHumanCloseUrgentEscalation({
    review: result,
    actorRole: "clinical_approver",
    explicitClosure: true,
  }), true);
});

for (const intent of ["medication_advice", "report_interpretation"] as const) {
  test(`reviewer blocks prohibited clinical intent ${intent}`, () => {
    const result = reviewSyntheticPatientMessage({
      ...base,
      message: intent === "medication_advice"
        ? "Should I double my medicine dose?"
        : "Does my result mean I am sick?",
      intent,
    });
    assert.equal(result.decision, "fail");
    assert.ok(result.reasonCodes.includes("clinical_advice_prohibited"));
    assert.equal(result.clinicalSafety, "blocked");
  });
}

test("reviewer turns STOP into suppression rather than an ordinary reply", () => {
  const result = reviewSyntheticPatientMessage({
    ...base,
    message: "STOP",
    intent: "marketing_withdrawal",
    approvedKnowledgeVersionIds: [],
  });
  assert.equal(result.decision, "fail");
  assert.deepEqual(result.reasonCodes, ["stop_intent"]);
  assert.equal(result.marketingSuppressionRequired, true);
  assert.equal(result.ordinaryAutomationPaused, true);
  assert.equal(result.handoffRequired, false);
});

test("reviewer routes mixed or low-confidence language to a human", () => {
  const result = reviewSyntheticPatientMessage({
    ...base,
    message: "Doctor booking venum, date eka tomorrow?",
    language: "mixed",
    languageConfidence: 0.56,
  });
  assert.ok(result.reasonCodes.includes("low_language_confidence"));
  assert.equal(result.handoffRequired, true);
});

test("reviewer blocks unsupported facts and malformed knowledge-version IDs", () => {
  const unsupported = reviewSyntheticPatientMessage({
    ...base,
    intent: "package_information",
    message: "What is the exact current price?",
    approvedKnowledgeVersionIds: [],
  });
  assert.equal(unsupported.unsupportedClaim, true);

  const malformed = reviewSyntheticPatientMessage({
    ...base,
    approvedKnowledgeVersionIds: ["../../draft"],
  });
  assert.ok(malformed.reasonCodes.includes("unsupported_claim"));
});

test("reviewer blocks automation while a human has takeover", () => {
  const result = reviewSyntheticPatientMessage({ ...base, humanTakeover: true });
  assert.equal(result.decision, "fail");
  assert.equal(result.ordinaryAutomationPaused, true);
});

test("reviewer requires an approved template or no-send outside the service window", () => {
  const result = reviewSyntheticPatientMessage({ ...base, withinServiceWindow: false });
  assert.equal(result.decision, "fail");
  assert.equal(result.serviceWindow, "template_required");
  assert.equal(result.sendMode, "no_send");
});

test("reviewer rejects cross-tenant unsafe identifiers before policy evaluation", () => {
  assert.throws(
    () => reviewSyntheticPatientMessage({ ...base, tenantId: "../other" }),
    /A valid tenant scope is required/,
  );
});
