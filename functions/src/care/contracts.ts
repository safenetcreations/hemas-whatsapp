import {
  IDEMPOTENCY_KEY,
  SHA256,
  exactRecord,
  fail,
  requireBoundedString,
  requireId,
  requireInteger,
  requireIsoDateTime,
  requireProtectedRef,
  requireSha256,
  sha256Hex,
  syntheticHmacSha256,
} from "../automations/contracts.js";
import { assertSafeTenantId } from "../errors.js";

export const CARE_PATHWAY_CONTENT_PREFIX =
  "hemas-connect:care-pathway-content:v1" as const;
export const CARE_PATHWAY_APPROVAL_PREFIX =
  "hemas-connect:care-pathway-approval:v1" as const;
export const CARE_PATHWAY_SECRET_BINDING_PREFIX =
  "hemas-connect:care-pathway-secret:v1" as const;
export const CARE_DISCHARGE_SOURCE_PREFIX =
  "hemas-connect:care-discharge-source:v1" as const;
export const CARE_ENROLLMENT_RECEIPT_KEY_PREFIX =
  "hemas-connect:care-enrollment-receipt-key:v2" as const;
export const CARE_ENROLLMENT_RECEIPT_PAYLOAD_PREFIX =
  "hemas-connect:care-enrollment-receipt-payload:v2" as const;
export const CARE_CONTROL_RESULT_PREFIX =
  "hemas-connect:care-control-result:v1" as const;

export const CARE_SUPPRESSIONS = [
  "readmission",
  "transfer",
  "death",
  "clinical_hold",
  "withdrawal",
  "invalid_contact",
] as const;
export type CareSuppressionReason = (typeof CARE_SUPPRESSIONS)[number];
export const CARE_SUPPRESSION_PRECEDENCE = [
  "death",
  "invalid_contact",
  "readmission",
  "transfer",
  "clinical_hold",
  "withdrawal",
] as const;

export const CARE_ENROLLMENT_ACTIONS = [
  "start",
  "advance_contact",
  "pause",
  "resume",
  "end",
  "simulate_suppression",
  "human_takeover_started",
  "release_human_takeover",
  "clear_clinical_hold",
  "raise_red_flag",
  "acknowledge_escalation",
  "resolve_escalation",
  "clear_safety_hold",
] as const;
export type CareEnrollmentAction = (typeof CARE_ENROLLMENT_ACTIONS)[number];
export const CARE_ENROLLMENT_STATES = [
  "queued",
  "active",
  "paused_by_operator",
  "paused_for_human",
  "paused_for_safety",
  "escalated",
  "completed",
  "ended",
] as const;
export type CareEnrollmentState = (typeof CARE_ENROLLMENT_STATES)[number];

export interface CareLocalizedTemplateBinding {
  readonly templateVersionId: string;
  readonly contentHash: string;
}

export interface CarePathwayContactPoint {
  readonly dayOffset: number;
  readonly en: CareLocalizedTemplateBinding;
  readonly si: CareLocalizedTemplateBinding;
  readonly ta: CareLocalizedTemplateBinding;
}

export interface CarePathwayContentBinding {
  readonly workspaceId: string;
  readonly pathwayId: string;
  readonly family: "post_discharge";
  readonly protocolVersion: string;
  readonly name: string;
  readonly clinicalOwnerUid: string;
  readonly contactPoints: readonly CarePathwayContactPoint[];
  readonly responseSlaMinutes: number;
  readonly escalationTeamId: string;
  readonly eligibleLocationIds: readonly string[];
  readonly afterHoursBehavior: "emergency_path" | "next_business_day" | "on_call_queue";
  readonly writeBackRequired: boolean;
  readonly instructionsSource: "clinician_authored";
  readonly aiMayGenerateInstructions: false;
  readonly suppressions: typeof CARE_SUPPRESSIONS;
  readonly protectedContentHash: string;
  readonly secretBindingHash: string;
  readonly synthetic: true;
}

export interface CarePathwayApprovalBinding {
  readonly workspaceId: string;
  readonly pathwayId: string;
  readonly contentHash: string;
  readonly clinicalOwnerUid: string;
  readonly clinicalApproverUid: string;
  readonly scope: "clinical_simulation_only";
  readonly approvedAt: string;
}

export interface CarePathwaySecretBinding {
  readonly workspaceId: string;
  readonly pathwayId: string;
  readonly protectedInstructionsRef: string;
  readonly protectedContentFingerprint: string;
  readonly schemaVersion: 1;
  readonly synthetic: true;
}

export interface CareDischargeSourceIdentityBinding {
  readonly workspaceId: string;
  readonly sourceSystem: string;
  readonly connectionId: string;
  readonly dischargeEventId: string;
}

export interface CareEnrollmentReceiptKeyBinding {
  readonly workspaceId: string;
  readonly family: "post_discharge";
  readonly dischargeFingerprint: string;
}

export interface CareEnrollmentReceiptPayloadBinding {
  readonly receiptId: string;
  readonly receiptFingerprint: string;
  readonly workspaceId: string;
  readonly family: "post_discharge";
  readonly pathwayId: string;
  readonly pathwayProtocolVersion: string;
  readonly pathwayContentHash: string;
  readonly pathwayApprovalHash: string;
  readonly activationEventId: string;
  readonly dischargeFingerprint: string;
  readonly qualifyingDischargeAt: string;
  readonly enrollmentId: string;
  readonly createdAt: string;
  readonly schemaVersion: 1;
  readonly synthetic: true;
}

export interface SyntheticCareControlInput {
  readonly workspaceId: string;
  readonly enrollmentId: string;
  readonly action: CareEnrollmentAction;
  readonly expectedRevision: number;
  readonly suppressionReason: CareSuppressionReason | null;
  readonly idempotencyKey: string;
}

export interface SyntheticCareControlResult {
  readonly enrollmentId: string;
  readonly eventId: string;
  readonly action: CareEnrollmentAction;
  readonly state: CareEnrollmentState;
  readonly revision: number;
  readonly nextContactIndex: number;
  readonly nextContactAt: string | null;
  readonly openEscalationId: string | null;
  readonly safetyHoldEscalationId: string | null;
  readonly openHandoffId: string | null;
  readonly outcomeCode: string;
  readonly synthetic: true;
  readonly externalDispatchCount: 0;
  readonly networkCallCount: 0;
}

export interface SyntheticCareControlResponse {
  readonly result: SyntheticCareControlResult;
  readonly auditEventId: string;
  readonly replayed: boolean;
}

export function serializeCareControlResult(input: SyntheticCareControlResult): string {
  const data = exactRecord(input, [
    "enrollmentId", "eventId", "action", "state", "revision", "nextContactIndex",
    "nextContactAt", "openEscalationId", "safetyHoldEscalationId", "openHandoffId",
    "outcomeCode", "synthetic", "externalDispatchCount", "networkCallCount",
  ], "care control result", "invalid_governance_binding");
  if (!CARE_ENROLLMENT_ACTIONS.includes(data.action as CareEnrollmentAction) || !CARE_ENROLLMENT_STATES.includes(data.state as CareEnrollmentState)) return fail("invalid_governance_binding", "care result action/state is invalid.");
  const optionalId = (value: unknown, label: string): string | null => value === null ? null : requireId(value, label, "invalid_governance_binding");
  const nextContactAt = data.nextContactAt === null ? null : requireIsoDateTime(data.nextContactAt, "nextContactAt");
  if (data.synthetic !== true || data.externalDispatchCount !== 0 || data.networkCallCount !== 0) return fail("invalid_governance_binding", "care result safety counters are invalid.");
  return JSON.stringify([
    CARE_CONTROL_RESULT_PREFIX,
    requireId(data.enrollmentId, "enrollmentId", "invalid_governance_binding"),
    requireId(data.eventId, "eventId", "invalid_governance_binding"),
    data.action, data.state,
    requireInteger(data.revision, "revision", 2, 999_999, "invalid_governance_binding"),
    requireInteger(data.nextContactIndex, "nextContactIndex", 0, 32, "invalid_governance_binding"),
    nextContactAt,
    optionalId(data.openEscalationId, "openEscalationId"),
    optionalId(data.safetyHoldEscalationId, "safetyHoldEscalationId"),
    optionalId(data.openHandoffId, "openHandoffId"),
    requireId(data.outcomeCode, "outcomeCode", "invalid_governance_binding"),
    true, 0, 0,
  ]);
}

export const CARE_COLLECTIONS = Object.freeze({
  pathways: "carePathways",
  activations: "carePathwayActivations",
  pathwayEvents: "carePathwayEvents",
  pathwaySecrets: "carePathwaySecrets",
  enrollmentReceipts: "careEnrollmentReceipts",
  enrollments: "careEnrollments",
  enrollmentSecrets: "careEnrollmentSecrets",
  enrollmentEvents: "careEnrollmentEvents",
  enrollmentEventSecrets: "careEnrollmentEventSecrets",
  escalations: "careEscalations",
  escalationSecrets: "careEscalationSecrets",
  handoffs: "careHandoffs",
});

const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function parseLocalizedTemplate(value: unknown, label: string): CareLocalizedTemplateBinding {
  const data = exactRecord(value, ["templateVersionId", "contentHash"], label, "invalid_governance_binding");
  return {
    templateVersionId: requireId(data.templateVersionId, `${label} template`, "invalid_governance_binding"),
    contentHash: requireSha256(data.contentHash, `${label} hash`, "invalid_governance_binding"),
  };
}

export function parseCareContactPoint(value: unknown, index: number): CarePathwayContactPoint {
  const data = exactRecord(value, ["dayOffset", "en", "si", "ta"], `care contact point ${index}`, "invalid_governance_binding");
  return {
    dayOffset: requireInteger(data.dayOffset, `care contact point ${index} day`, 1, 365, "invalid_governance_binding"),
    en: parseLocalizedTemplate(data.en, `care contact point ${index} en`),
    si: parseLocalizedTemplate(data.si, `care contact point ${index} si`),
    ta: parseLocalizedTemplate(data.ta, `care contact point ${index} ta`),
  };
}

export function serializeCarePathwaySecretBinding(input: CarePathwaySecretBinding): string {
  const data = exactRecord(input, [
    "workspaceId", "pathwayId", "protectedInstructionsRef",
    "protectedContentFingerprint", "schemaVersion", "synthetic",
  ], "care pathway secret", "invalid_governance_binding");
  const workspaceId = requireId(data.workspaceId, "workspaceId", "invalid_governance_binding");
  const pathwayId = requireId(data.pathwayId, "pathwayId", "invalid_governance_binding");
  const protectedInstructionsRef = requireProtectedRef(data.protectedInstructionsRef, "protectedInstructionsRef", "invalid_governance_binding");
  const protectedContentFingerprint = requireSha256(data.protectedContentFingerprint, "protectedContentFingerprint", "invalid_governance_binding");
  if (data.schemaVersion !== 1 || data.synthetic !== true) return fail("invalid_governance_binding", "care secret version is invalid.");
  return JSON.stringify([
    CARE_PATHWAY_SECRET_BINDING_PREFIX, workspaceId, pathwayId,
    protectedInstructionsRef, protectedContentFingerprint, 1, true,
  ]);
}

export function serializeCarePathwayContent(input: CarePathwayContentBinding): string {
  const data = exactRecord(input, [
    "workspaceId", "pathwayId", "family", "protocolVersion", "name",
    "clinicalOwnerUid", "contactPoints", "responseSlaMinutes", "escalationTeamId",
    "eligibleLocationIds", "afterHoursBehavior", "writeBackRequired",
    "instructionsSource", "aiMayGenerateInstructions", "suppressions",
    "protectedContentHash", "secretBindingHash", "synthetic",
  ], "care pathway content", "invalid_governance_binding");
  const workspaceId = requireId(data.workspaceId, "workspaceId", "invalid_governance_binding");
  const pathwayId = requireId(data.pathwayId, "pathwayId", "invalid_governance_binding");
  if (data.family !== "post_discharge") return fail("invalid_governance_binding", "care family is invalid.");
  if (typeof data.protocolVersion !== "string" || !VERSION.test(data.protocolVersion)) return fail("invalid_governance_binding", "care protocol version is invalid.");
  const name = requireBoundedString(data.name, "name", 160, "invalid_governance_binding");
  const clinicalOwnerUid = requireId(data.clinicalOwnerUid, "clinicalOwnerUid", "invalid_governance_binding");
  if (!Array.isArray(data.contactPoints) || data.contactPoints.length < 1 || data.contactPoints.length > 32) return fail("invalid_governance_binding", "care contact points are invalid.");
  const contactPoints = data.contactPoints.map(parseCareContactPoint);
  if (contactPoints.some((point, index) => index > 0 && contactPoints[index - 1]!.dayOffset >= point.dayOffset)) return fail("invalid_governance_binding", "care contact points must be strictly ordered.");
  const responseSlaMinutes = requireInteger(data.responseSlaMinutes, "responseSlaMinutes", 1, 1_440, "invalid_governance_binding");
  const escalationTeamId = requireId(data.escalationTeamId, "escalationTeamId", "invalid_governance_binding");
  if (!Array.isArray(data.eligibleLocationIds) || data.eligibleLocationIds.length < 1 || data.eligibleLocationIds.length > 64) return fail("invalid_governance_binding", "eligible locations are invalid.");
  const eligibleLocationIds = data.eligibleLocationIds.map((id, index) => requireId(id, `eligible location ${index}`, "invalid_governance_binding"));
  if (eligibleLocationIds.some((id, index) => index > 0 && eligibleLocationIds[index - 1]! >= id)) return fail("invalid_governance_binding", "eligible locations must be strictly ordered.");
  if (!["emergency_path", "next_business_day", "on_call_queue"].includes(data.afterHoursBehavior as string)) return fail("invalid_governance_binding", "after-hours policy is invalid.");
  if (typeof data.writeBackRequired !== "boolean" || data.instructionsSource !== "clinician_authored" || data.aiMayGenerateInstructions !== false) return fail("invalid_governance_binding", "care instruction governance is invalid.");
  if (!Array.isArray(data.suppressions) || data.suppressions.length !== CARE_SUPPRESSIONS.length || data.suppressions.some((item, index) => item !== CARE_SUPPRESSIONS[index])) return fail("invalid_governance_binding", "care suppressions are invalid.");
  const protectedContentHash = requireSha256(data.protectedContentHash, "protectedContentHash", "invalid_governance_binding");
  const secretBindingHash = requireSha256(data.secretBindingHash, "secretBindingHash", "invalid_governance_binding");
  if (data.synthetic !== true) return fail("invalid_governance_binding", "care pathway must be synthetic.");
  return JSON.stringify([
    CARE_PATHWAY_CONTENT_PREFIX, workspaceId, pathwayId, "post_discharge",
    data.protocolVersion, name, clinicalOwnerUid,
    contactPoints.map((point) => [
      point.dayOffset, point.en.templateVersionId, point.en.contentHash,
      point.si.templateVersionId, point.si.contentHash,
      point.ta.templateVersionId, point.ta.contentHash,
    ]),
    responseSlaMinutes, escalationTeamId, eligibleLocationIds,
    data.afterHoursBehavior, data.writeBackRequired, "clinician_authored", false,
    [...CARE_SUPPRESSIONS], protectedContentHash, secretBindingHash, true,
  ]);
}

export function serializeCarePathwayApproval(input: CarePathwayApprovalBinding): string {
  const data = exactRecord(input, [
    "workspaceId", "pathwayId", "contentHash", "clinicalOwnerUid",
    "clinicalApproverUid", "scope", "approvedAt",
  ], "care pathway approval", "invalid_governance_binding");
  const workspaceId = requireId(data.workspaceId, "workspaceId", "invalid_governance_binding");
  const pathwayId = requireId(data.pathwayId, "pathwayId", "invalid_governance_binding");
  const contentHash = requireSha256(data.contentHash, "contentHash", "invalid_governance_binding");
  const owner = requireId(data.clinicalOwnerUid, "clinicalOwnerUid", "invalid_governance_binding");
  const approver = requireId(data.clinicalApproverUid, "clinicalApproverUid", "invalid_governance_binding");
  if (owner === approver || data.scope !== "clinical_simulation_only") return fail("invalid_governance_binding", "care approval separation is invalid.");
  const approvedAt = requireIsoDateTime(data.approvedAt, "approvedAt");
  return JSON.stringify([
    CARE_PATHWAY_APPROVAL_PREFIX, workspaceId, pathwayId, contentHash,
    owner, approver, "clinical_simulation_only", approvedAt,
  ]);
}

export function serializeCareDischargeSourceIdentity(input: CareDischargeSourceIdentityBinding): string {
  const data = exactRecord(input, ["workspaceId", "sourceSystem", "connectionId", "dischargeEventId"], "care discharge identity", "invalid_governance_binding");
  return JSON.stringify([
    CARE_DISCHARGE_SOURCE_PREFIX,
    requireId(data.workspaceId, "workspaceId", "invalid_governance_binding"),
    requireId(data.sourceSystem, "sourceSystem", "invalid_governance_binding"),
    requireId(data.connectionId, "connectionId", "invalid_governance_binding"),
    requireBoundedString(data.dischargeEventId, "dischargeEventId", 256, "invalid_governance_binding"),
  ]);
}

export function serializeCareEnrollmentReceiptKey(input: CareEnrollmentReceiptKeyBinding): string {
  const data = exactRecord(input, ["workspaceId", "family", "dischargeFingerprint"], "care receipt key", "invalid_governance_binding");
  if (data.family !== "post_discharge") return fail("invalid_governance_binding", "care receipt family is invalid.");
  return JSON.stringify([
    CARE_ENROLLMENT_RECEIPT_KEY_PREFIX,
    requireId(data.workspaceId, "workspaceId", "invalid_governance_binding"),
    "post_discharge",
    requireSha256(data.dischargeFingerprint, "dischargeFingerprint", "invalid_governance_binding"),
  ]);
}

export function serializeCareEnrollmentReceiptPayload(input: CareEnrollmentReceiptPayloadBinding): string {
  const data = exactRecord(input, [
    "receiptId", "receiptFingerprint", "workspaceId", "family", "pathwayId",
    "pathwayProtocolVersion", "pathwayContentHash", "pathwayApprovalHash",
    "activationEventId", "dischargeFingerprint", "qualifyingDischargeAt",
    "enrollmentId", "createdAt", "schemaVersion", "synthetic",
  ], "care receipt payload", "invalid_governance_binding");
  const receiptId = requireSha256(data.receiptId, "receiptId", "invalid_governance_binding");
  const receiptFingerprint = requireSha256(data.receiptFingerprint, "receiptFingerprint", "invalid_governance_binding");
  if (receiptId !== receiptFingerprint || data.family !== "post_discharge") return fail("invalid_governance_binding", "care receipt identity is invalid.");
  const workspaceId = requireId(data.workspaceId, "workspaceId", "invalid_governance_binding");
  const pathwayId = requireId(data.pathwayId, "pathwayId", "invalid_governance_binding");
  if (typeof data.pathwayProtocolVersion !== "string" || !VERSION.test(data.pathwayProtocolVersion)) return fail("invalid_governance_binding", "care receipt protocol is invalid.");
  const pathwayContentHash = requireSha256(data.pathwayContentHash, "pathwayContentHash", "invalid_governance_binding");
  const pathwayApprovalHash = requireSha256(data.pathwayApprovalHash, "pathwayApprovalHash", "invalid_governance_binding");
  const activationEventId = requireId(data.activationEventId, "activationEventId", "invalid_governance_binding");
  const dischargeFingerprint = requireSha256(data.dischargeFingerprint, "dischargeFingerprint", "invalid_governance_binding");
  const qualifyingDischargeAt = requireIsoDateTime(data.qualifyingDischargeAt, "qualifyingDischargeAt");
  const enrollmentId = requireId(data.enrollmentId, "enrollmentId", "invalid_governance_binding");
  const createdAt = requireIsoDateTime(data.createdAt, "createdAt");
  if (Date.parse(qualifyingDischargeAt) > Date.parse(createdAt) || data.schemaVersion !== 1 || data.synthetic !== true) return fail("invalid_governance_binding", "care receipt schedule/version is invalid.");
  return JSON.stringify([
    CARE_ENROLLMENT_RECEIPT_PAYLOAD_PREFIX, receiptId, receiptFingerprint,
    workspaceId, "post_discharge", pathwayId, data.pathwayProtocolVersion,
    pathwayContentHash, pathwayApprovalHash, activationEventId,
    dischargeFingerprint, qualifyingDischargeAt, enrollmentId, createdAt, 1, true,
  ]);
}

export function assertCareReceiptReplayBinding(input: CareEnrollmentReceiptPayloadBinding): void {
  serializeCareEnrollmentReceiptPayload(input);
  const expected = syntheticHmacSha256(serializeCareEnrollmentReceiptKey({
    workspaceId: input.workspaceId,
    family: "post_discharge",
    dischargeFingerprint: input.dischargeFingerprint,
  }));
  if (input.receiptId !== expected || input.receiptFingerprint !== expected) return fail("care_receipt_denied", "Care receipt does not match its canonical v2 HMAC key.");
}

export function orderCareSuppressions(reasons: readonly CareSuppressionReason[]): readonly CareSuppressionReason[] {
  const selected = new Set(reasons);
  return CARE_SUPPRESSION_PRECEDENCE.filter((reason) => selected.has(reason));
}

export function parseSyntheticCareControlInput(value: unknown): SyntheticCareControlInput {
  const data = exactRecord(value, [
    "workspaceId", "enrollmentId", "action", "expectedRevision",
    "suppressionReason", "idempotencyKey",
  ], "care control request", "invalid_service_request");
  const workspaceId = requireId(data.workspaceId, "Workspace ID", "invalid_service_request");
  assertSafeTenantId(workspaceId);
  if (!CARE_ENROLLMENT_ACTIONS.includes(data.action as CareEnrollmentAction)) return fail("invalid_service_request", "Care action is invalid.");
  const suppressionReason = data.suppressionReason === null
    ? null
    : (CARE_SUPPRESSIONS.includes(data.suppressionReason as CareSuppressionReason)
      ? data.suppressionReason as CareSuppressionReason
      : fail("invalid_service_request", "Care suppression reason is invalid."));
  if ((data.action === "simulate_suppression") !== (suppressionReason !== null)) return fail("invalid_service_request", "Suppression reason must be supplied only for simulate_suppression.");
  const expectedRevision = requireInteger(data.expectedRevision, "Expected revision", 1, 999_999, "invalid_service_request");
  if (typeof data.idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(data.idempotencyKey)) return fail("invalid_service_request", "Idempotency key is invalid.");
  return {
    workspaceId,
    enrollmentId: requireId(data.enrollmentId, "Enrollment ID", "invalid_service_request"),
    action: data.action as CareEnrollmentAction,
    expectedRevision,
    suppressionReason,
    idempotencyKey: data.idempotencyKey,
  };
}

export const CARE_GOLDEN_VECTORS = Object.freeze({
  controlResult: Object.freeze({
    serialized: '["hemas-connect:care-control-result:v1","care_enrollment_synthetic_001","care_event_synthetic_002","start","active",2,0,"2026-08-07T09:00:00.000Z",null,null,null,"accepted",true,0,0]',
    hash: "af0c2c6fef17b892686bc5dbec22506ebbc56b93d9bb41b7f77e1a49e27bb825",
  }),
  secret: Object.freeze({
    serialized: '["hemas-connect:care-pathway-secret:v1","workspace_safenet_demo","care_pathway_synthetic_followup_v1","demo://care/instructions/synthetic-v1","eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",1,true]',
    hash: "551f7f7ce48404c0c0e9927445122912ca927e2a5402b2db20d47b658075da27",
  }),
  content: Object.freeze({
    serialized: '["hemas-connect:care-pathway-content:v1","workspace_safenet_demo","care_pathway_synthetic_followup_v1","post_discharge","v1.0","Synthetic post-discharge follow-up","user_synthetic_clinical_owner",[[1,"template_synthetic_care_day1_en_v1","2222222222222222222222222222222222222222222222222222222222222222","template_synthetic_care_day1_si_v1","3333333333333333333333333333333333333333333333333333333333333333","template_synthetic_care_day1_ta_v1","4444444444444444444444444444444444444444444444444444444444444444"],[3,"template_synthetic_care_day3_en_v1","5555555555555555555555555555555555555555555555555555555555555555","template_synthetic_care_day3_si_v1","6666666666666666666666666666666666666666666666666666666666666666","template_synthetic_care_day3_ta_v1","7777777777777777777777777777777777777777777777777777777777777777"]],15,"team_synthetic_clinical_escalation",["location_synthetic_thalawathugoda","location_synthetic_wattala"],"on_call_queue",true,"clinician_authored",false,["readmission","transfer","death","clinical_hold","withdrawal","invalid_contact"],"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","551f7f7ce48404c0c0e9927445122912ca927e2a5402b2db20d47b658075da27",true]',
    hash: "d21cba789b3a0adc799bb91a6b07b23d3af5029ecb4404d1b614ebea07789475",
  }),
  approval: Object.freeze({
    serialized: '["hemas-connect:care-pathway-approval:v1","workspace_safenet_demo","care_pathway_synthetic_followup_v1","d21cba789b3a0adc799bb91a6b07b23d3af5029ecb4404d1b614ebea07789475","user_synthetic_clinical_owner","user_synthetic_clinical_approver","clinical_simulation_only","2026-08-07T09:30:00.000Z"]',
    hash: "c247b7e129cd0b10922f0188e25e6fc09ebc9a3bc9f8710cf3c856cba7a076e2",
  }),
});

export function assertCareGoldenVectors(): void {
  for (const vector of Object.values(CARE_GOLDEN_VECTORS)) {
    if (!SHA256.test(vector.hash) || sha256Hex(vector.serialized) !== vector.hash) return fail("care_contract_drift", "Frozen care governance vector drifted.");
  }
}

assertCareGoldenVectors();
