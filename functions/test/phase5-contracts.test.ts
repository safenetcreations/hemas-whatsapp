import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import {
  AUTOMATION_GOLDEN_VECTORS,
  SYNTHETIC_RECEIPT_HMAC_KEY,
  assertAutomationGoldenVectors,
  serializeAutomationTriggerReceiptKey,
  serializeAutomationTriggerReceiptPayload,
} from "../src/automations/contracts.js";
import {
  CARE_GOLDEN_VECTORS,
  assertCareGoldenVectors,
  serializeCareEnrollmentReceiptKey,
  serializeCareEnrollmentReceiptPayload,
} from "../src/care/contracts.js";

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
const hmac = (value: string) =>
  createHmac("sha256", SYNTHETIC_RECEIPT_HMAC_KEY)
    .update(value, "utf8")
    .digest("hex");

test("Functions independently pins every frozen automation governance vector", () => {
  assert.doesNotThrow(() => assertAutomationGoldenVectors());
  assert.equal(sha256(AUTOMATION_GOLDEN_VECTORS.secret.serialized), AUTOMATION_GOLDEN_VECTORS.secret.hash);
  assert.equal(sha256(AUTOMATION_GOLDEN_VECTORS.content.serialized), AUTOMATION_GOLDEN_VECTORS.content.hash);
  assert.equal(sha256(AUTOMATION_GOLDEN_VECTORS.approval.serialized), AUTOMATION_GOLDEN_VECTORS.approval.hash);
  assert.equal(sha256(AUTOMATION_GOLDEN_VECTORS.controlResult.serialized), AUTOMATION_GOLDEN_VECTORS.controlResult.hash);
});

test("Functions independently pins every frozen care governance vector", () => {
  assert.doesNotThrow(() => assertCareGoldenVectors());
  assert.equal(sha256(CARE_GOLDEN_VECTORS.secret.serialized), CARE_GOLDEN_VECTORS.secret.hash);
  assert.equal(sha256(CARE_GOLDEN_VECTORS.content.serialized), CARE_GOLDEN_VECTORS.content.hash);
  assert.equal(sha256(CARE_GOLDEN_VECTORS.approval.serialized), CARE_GOLDEN_VECTORS.approval.hash);
  assert.equal(sha256(CARE_GOLDEN_VECTORS.controlResult.serialized), CARE_GOLDEN_VECTORS.controlResult.hash);
});

test("automation v2 receipt identity is family/source stable and payload immutable", () => {
  const sourceEventFingerprint = "9".repeat(64);
  const key = serializeAutomationTriggerReceiptKey({
    workspaceId: "workspace_safenet_demo",
    family: "appointment_service",
    sourceEventFingerprint,
  });
  const receiptId = hmac(key);
  const payload = serializeAutomationTriggerReceiptPayload({
    receiptId,
    triggerFingerprint: receiptId,
    workspaceId: "workspace_safenet_demo",
    family: "appointment_service",
    definitionId: "automation_synthetic_appointment_v1",
    definitionVersion: 3,
    definitionContentHash: AUTOMATION_GOLDEN_VECTORS.content.hash,
    definitionApprovalHash: AUTOMATION_GOLDEN_VECTORS.approval.hash,
    activationEventId: "automation_definition_event_synthetic_activate_001",
    sourceEventFingerprint,
    runId: "automation_run_synthetic_001",
    createdAt: "2026-08-07T09:45:00.000Z",
    schemaVersion: 1,
    synthetic: true,
  });

  assert.equal(
    key,
    `["hemas-connect:automation-trigger-receipt-key:v2","workspace_safenet_demo","appointment_service","${sourceEventFingerprint}"]`,
  );
  assert.equal(receiptId, "5acca6071572070b4c030323feb6b3457fc1f3c3cdf629e51a0e3b745a9cbc7b");
  assert.equal(sha256(payload), "de32e2f8e5e73dd11a0f01390e3d3064e088dc4a34355fd2b8703a31b4dad8ec");
});

test("care v2 receipt payload immutably includes its qualifying-discharge schedule anchor", () => {
  const dischargeFingerprint = "a".repeat(64);
  const key = serializeCareEnrollmentReceiptKey({
    workspaceId: "workspace_safenet_demo",
    family: "post_discharge",
    dischargeFingerprint,
  });
  const receiptId = hmac(key);
  const input = {
    receiptId,
    receiptFingerprint: receiptId,
    workspaceId: "workspace_safenet_demo",
    family: "post_discharge" as const,
    pathwayId: "care_pathway_synthetic_followup_v1",
    pathwayProtocolVersion: "v1.0",
    pathwayContentHash: CARE_GOLDEN_VECTORS.content.hash,
    pathwayApprovalHash: CARE_GOLDEN_VECTORS.approval.hash,
    activationEventId: "care_pathway_event_synthetic_activate_001",
    dischargeFingerprint,
    qualifyingDischargeAt: "2026-08-06T09:00:00.000Z",
    enrollmentId: "care_enrollment_synthetic_001",
    createdAt: "2026-08-07T09:50:00.000Z",
    schemaVersion: 1 as const,
    synthetic: true as const,
  };
  const payload = serializeCareEnrollmentReceiptPayload(input);

  assert.equal(
    key,
    `["hemas-connect:care-enrollment-receipt-key:v2","workspace_safenet_demo","post_discharge","${dischargeFingerprint}"]`,
  );
  assert.equal(receiptId, "8d1993ce7faa843b278bc88047800822e9556f272f1e8fbac290a69479064507");
  assert.equal(sha256(payload), "655e8138077ee67d026f8a3d9a16f5654db4c3f1b73b3d1f3794b1e6a8a9a9bd");
  assert.notEqual(
    payload,
    serializeCareEnrollmentReceiptPayload({
      ...input,
      qualifyingDischargeAt: "2026-08-06T09:00:01.000Z",
    }),
  );
});
