import type {
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Transaction,
} from "firebase-admin/firestore";
import { createTenantAuditEvent } from "../audit.js";
import { toFirestoreAuditRecord } from "../audit-firestore.js";
import type { RuntimeConfig } from "../config.js";
import { deterministicId } from "../deterministic.js";
import { FailClosedError } from "../errors.js";
import {
  assertLatestSyntheticConsent,
  assertPhase5Authorization,
  assertSyntheticLocation,
  assertSyntheticTeam,
  assertSyntheticTemplate,
  ensureNoUnexpectedClinicalText,
  parsePhase5Idempotency,
  parseSyntheticContact,
  parseSyntheticConversation,
  phase5EscalationProtectedRef,
  phase5EventProtectedRef,
  phase5IdempotencyId,
  resolveSyntheticProtectedRef,
  type Phase5Actor,
} from "../automations/runtime.js";
import {
  assertPhase5DemoRuntimeBoundary,
  exactRecord,
  fail,
  requireBoundedString,
  requireId,
  requireInteger,
  requireProtectedRef,
  requireSha256,
  sha256Hex,
  syntheticHmacSha256,
  timestampToDate,
} from "../automations/contracts.js";
import {
  CARE_COLLECTIONS,
  CARE_ENROLLMENT_ACTIONS,
  CARE_ENROLLMENT_STATES,
  CARE_SUPPRESSIONS,
  assertCareReceiptReplayBinding,
  orderCareSuppressions,
  parseCareContactPoint,
  parseSyntheticCareControlInput,
  serializeCarePathwayApproval,
  serializeCareControlResult,
  serializeCarePathwayContent,
  serializeCarePathwaySecretBinding,
  type CareEnrollmentAction,
  type CareEnrollmentState,
  type CarePathwayContactPoint,
  type CareSuppressionReason,
  type SyntheticCareControlInput,
  type SyntheticCareControlResponse,
  type SyntheticCareControlResult,
} from "./contracts.js";

type EmulatorBoundary = {
  readonly projectId: string;
  readonly firestoreEmulatorHost: string | undefined;
};

type StoredPathway = {
  readonly id: string;
  readonly workspaceId: string;
  readonly family: "post_discharge";
  readonly protocolVersion: string;
  readonly name: string;
  readonly clinicalOwnerUid: string;
  readonly clinicalApproverUid: string;
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
  readonly contentHash: string;
  readonly approvalHash: string;
  readonly approvalScope: "clinical_simulation_only";
  readonly approvedAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

type StoredActivation = {
  readonly id: "post_discharge";
  readonly workspaceId: string;
  readonly activePathwayId: string;
  readonly activeProtocolVersion: string;
  readonly activePathwayContentHash: string;
  readonly activePathwayApprovalHash: string;
  readonly activePathwaySecretBindingHash: string;
  readonly activatedByUid: string;
  readonly activatedAt: Date;
  readonly activationEventId: string;
  readonly activationAuditEventId: string;
};

type StoredEnrollment = {
  readonly id: string;
  readonly workspaceId: string;
  readonly pathwayId: string;
  readonly pathwayProtocolVersion: string;
  readonly pathwayContentHash: string;
  readonly teamId: string;
  readonly locationId: string;
  readonly state: CareEnrollmentState;
  readonly nextContactIndex: number;
  readonly nextContactAt: Date | null;
  readonly activeSuppressions: readonly CareSuppressionReason[];
  readonly openEscalationId: string | null;
  readonly safetyHoldEscalationId: string | null;
  readonly openHandoffId: string | null;
  readonly revision: number;
  readonly outcomeCode: string;
  readonly lastEventId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

type StoredEnrollmentSecret = {
  readonly workspaceId: string;
  readonly enrollmentId: string;
  readonly protectedContactRef: string;
  readonly protectedConversationRef: string;
  readonly protectedQualifyingDischargeRef: string;
  readonly qualifyingDischargeAt: Date;
  readonly subjectFingerprint: string;
  readonly sourceDischargeFingerprint: string;
  readonly receiptId: string;
  readonly receiptFingerprint: string;
};

type StoredEscalation = {
  readonly id: string;
  readonly workspaceId: string;
  readonly enrollmentId: string;
  readonly pathwayId: string;
  readonly pathwayProtocolVersion: string;
  readonly pathwayContentHash: string;
  readonly teamId: string;
  readonly locationId: string;
  readonly reasonCode: "red_flag_response" | "emergency_keyword" | "clinical_review_required";
  readonly state: "open" | "acknowledged" | "resolved";
  readonly openedAt: Date;
  readonly responseSlaMinutes: number;
  readonly responseDueAt: Date;
  readonly openedBy: { readonly actorKind: "staff" | "system"; readonly actorUid: string | null };
  readonly acknowledgedAt: Date | null;
  readonly acknowledgedByUid: string | null;
  readonly resolvedAt: Date | null;
  readonly resolvedByUid: string | null;
  readonly resolutionCode: "safety_hold_applied" | "terminal_suppression_applied" | null;
  readonly writeBackRequired: boolean;
  readonly writeBackState: "not_required" | "pending" | "unavailable_in_demo";
  readonly revision: number;
  readonly lastEventId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

type StoredHandoff = {
  readonly id: string;
  readonly workspaceId: string;
  readonly enrollmentId: string;
  readonly pathwayId: string;
  readonly pathwayProtocolVersion: string;
  readonly pathwayContentHash: string;
  readonly teamId: string;
  readonly locationId: string;
  readonly state: "open" | "released";
  readonly openedEventId: string;
  readonly openedBy: { readonly actorKind: "staff" | "system"; readonly actorUid: string | null };
  readonly openedAt: Date;
  readonly releasedEventId: string | null;
  readonly releasedBy: { readonly actorKind: "staff" | "system"; readonly actorUid: string | null } | null;
  readonly releasedAt: Date | null;
  readonly revision: number;
  readonly lastEventId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

type CarePlan = {
  readonly state: CareEnrollmentState;
  readonly nextContactIndex: number;
  readonly nextContactAt: Date | null;
  readonly suppressions: readonly CareSuppressionReason[];
  readonly openEscalationId: string | null;
  readonly safetyHoldEscalationId: string | null;
  readonly openHandoffId: string | null;
  readonly contactPointIndex: number | null;
  readonly outcomeCode: string;
  readonly escalationMode: "none" | "create" | "acknowledge" | "resolve" | "touch_resolved" | "preserve";
  readonly handoffMode: "none" | "create" | "release";
};

const PATHWAY_KEYS = [
  "id", "workspaceId", "family", "protocolVersion", "name", "clinicalOwnerUid",
  "clinicalApproverUid", "contactPoints", "responseSlaMinutes", "escalationTeamId",
  "eligibleLocationIds", "afterHoursBehavior", "writeBackRequired", "instructionsSource",
  "aiMayGenerateInstructions", "suppressions", "protectedContentHash", "secretBindingHash",
  "contentHash", "approvalHash", "approvalScope", "approvedAt", "lifecycleState",
  "schemaVersion", "synthetic", "createdAt", "updatedAt",
] as const;
const PATHWAY_SECRET_KEYS = [
  "workspaceId", "pathwayId", "protectedInstructionsRef", "protectedContentFingerprint",
  "schemaVersion", "synthetic",
] as const;
const ACTIVATION_KEYS = [
  "id", "workspaceId", "family", "activePathwayId", "activeProtocolVersion",
  "activePathwayContentHash", "activePathwayApprovalHash", "activePathwayApprovalScope",
  "activePathwaySecretBindingHash", "activatedByUid", "activatedAt", "activationEventId",
  "activationAuditEventId", "revision", "createdAt", "updatedAt", "schemaVersion",
  "synthetic", "externalDispatchCount", "networkCallCount",
] as const;
const PATHWAY_EVENT_KEYS = [
  "id", "workspaceId", "family", "eventType", "pathwayId", "pathwayProtocolVersion",
  "pathwayContentHash", "pathwayApprovalHash", "pathwayApprovalScope",
  "pathwaySecretBindingHash", "fromLifecycleState", "toLifecycleState", "revision",
  "auditEventId", "occurredAt", "schemaVersion", "synthetic", "externalDispatchCount",
  "networkCallCount", "actorKind", "actorUid",
] as const;
const RECEIPT_KEYS = [
  "id", "workspaceId", "family", "pathwayId", "pathwayProtocolVersion",
  "pathwayContentHash", "pathwayApprovalHash", "activationEventId",
  "dischargeFingerprint", "qualifyingDischargeAt", "receiptFingerprint", "enrollmentId",
  "createdAt", "schemaVersion", "synthetic",
] as const;
const ENROLLMENT_KEYS = [
  "id", "workspaceId", "pathwayId", "pathwayProtocolVersion", "pathwayContentHash",
  "teamId", "locationId", "state", "nextContactIndex", "nextContactAt",
  "activeSuppressions", "openEscalationId", "safetyHoldEscalationId", "openHandoffId",
  "revision", "outcomeCode", "lastEventId", "schemaVersion", "synthetic",
  "externalDispatchCount", "networkCallCount", "createdAt", "updatedAt",
] as const;
const ENROLLMENT_SECRET_KEYS = [
  "workspaceId", "enrollmentId", "protectedContactRef", "protectedConversationRef",
  "protectedQualifyingDischargeRef", "qualifyingDischargeAt", "subjectFingerprint",
  "sourceDischargeFingerprint", "receiptId", "receiptFingerprint", "schemaVersion", "synthetic",
] as const;
const ESCALATION_KEYS = [
  "id", "workspaceId", "enrollmentId", "pathwayId", "pathwayProtocolVersion",
  "pathwayContentHash", "teamId", "locationId", "reasonCode", "state", "openedAt",
  "responseSlaMinutes", "responseDueAt", "openedBy", "acknowledgedAt",
  "acknowledgedByUid", "resolvedAt", "resolvedByUid", "resolutionCode",
  "writeBackRequired", "writeBackState", "revision", "lastEventId", "schemaVersion",
  "synthetic", "externalDispatchCount", "networkCallCount", "createdAt", "updatedAt",
] as const;
const HANDOFF_KEYS = [
  "id", "workspaceId", "enrollmentId", "pathwayId", "pathwayProtocolVersion",
  "pathwayContentHash", "teamId", "locationId", "state", "openedEventId", "openedBy",
  "openedAt", "releasedEventId", "releasedBy", "releasedAt", "revision", "lastEventId",
  "schemaVersion", "synthetic", "externalDispatchCount", "networkCallCount", "createdAt", "updatedAt",
] as const;
const AUDIT_KEYS = [
  "id", "workspaceId", "actorUid", "actorType", "action", "resourceType", "resourceId",
  "outcome", "requestId", "occurredAt", "createdAt", "metadata", "synthetic", "schemaVersion",
] as const;
const ENROLLMENT_EVENT_KEYS = [
  "id", "workspaceId", "enrollmentId", "pathwayId", "pathwayProtocolVersion",
  "pathwayContentHash", "teamId", "locationId", "revision", "auditEventId", "action",
  "fromState", "toState", "contactPointIndex", "suppressionReason", "escalationId",
  "escalationStateBefore", "escalationStateAfter", "handoffId", "activeSuppressionsAfter",
  "nextContactAt", "outcomeCode", "occurredAt", "schemaVersion", "synthetic",
  "externalDispatchCount", "networkCallCount", "actorKind", "actorUid",
] as const;
const EVENT_SECRET_KEYS = [
  "workspaceId", "enrollmentId", "eventId", "protectedContextRef", "contextFingerprint",
  "schemaVersion", "synthetic",
] as const;

function root(workspaceId: string): string { return `workspaces/${workspaceId}`; }
function iso(value: Date | null): string | null { return value?.toISOString() ?? null; }
function data(snapshot: DocumentSnapshot, code: string, message: string): DocumentData {
  if (!snapshot.exists || !snapshot.data()) throw new FailClosedError(code, message);
  return snapshot.data()!;
}
async function get(transaction: Transaction, reference: DocumentReference): Promise<DocumentSnapshot> {
  return transaction.get(reference);
}
function nullableDate(value: unknown, label: string, code: string): Date | null {
  return value === null ? null : timestampToDate(value, label, code);
}
function actor(value: unknown, label: string): { actorKind: "staff" | "system"; actorUid: string | null } {
  const record = exactRecord(value, ["actorKind", "actorUid"], label, "care_lifecycle_denied");
  if (record.actorKind === "staff") return { actorKind: "staff", actorUid: requireId(record.actorUid, `${label} UID`, "care_lifecycle_denied") };
  if (record.actorKind === "system" && record.actorUid === null) return { actorKind: "system", actorUid: null };
  return fail("care_lifecycle_denied", `${label} is invalid.`);
}

function parsePathway(value: unknown, expected: { workspaceId: string; pathwayId: string }): StoredPathway {
  const record = exactRecord(value, PATHWAY_KEYS, "care pathway", "care_pathway_denied");
  if (
    record.id !== expected.pathwayId || record.workspaceId !== expected.workspaceId ||
    record.family !== "post_discharge" || record.lifecycleState !== "approved" ||
    record.approvalScope !== "clinical_simulation_only" || record.approvalHash === null ||
    record.synthetic !== true || record.schemaVersion !== 1 ||
    record.instructionsSource !== "clinician_authored" || record.aiMayGenerateInstructions !== false
  ) return fail("care_pathway_denied", "An approved clinician-authored synthetic pathway is required.");
  const contactPoints = Array.isArray(record.contactPoints)
    ? record.contactPoints.map(parseCareContactPoint)
    : fail("care_pathway_denied", "Care pathway contact points are invalid.");
  if (contactPoints.length < 1 || contactPoints.length > 32) return fail("care_pathway_denied", "Care pathway contact points are invalid.");
  const locations = Array.isArray(record.eligibleLocationIds)
    ? record.eligibleLocationIds.map((item) => requireId(item, "eligible location", "care_pathway_denied"))
    : fail("care_pathway_denied", "Care pathway locations are invalid.");
  const clinicalOwnerUid = requireId(record.clinicalOwnerUid, "clinical owner", "care_pathway_denied");
  const clinicalApproverUid = requireId(record.clinicalApproverUid, "clinical approver", "care_pathway_denied");
  const approvedAt = timestampToDate(record.approvedAt, "pathway approvedAt", "care_pathway_denied");
  const pathway: StoredPathway = {
    id: expected.pathwayId,
    workspaceId: expected.workspaceId,
    family: "post_discharge",
    protocolVersion: requireBoundedString(record.protocolVersion, "pathway protocol", 64, "care_pathway_denied"),
    name: requireBoundedString(record.name, "pathway name", 160, "care_pathway_denied"),
    clinicalOwnerUid,
    clinicalApproverUid,
    contactPoints,
    responseSlaMinutes: requireInteger(record.responseSlaMinutes, "pathway SLA", 1, 1_440, "care_pathway_denied"),
    escalationTeamId: requireId(record.escalationTeamId, "escalation team", "care_pathway_denied"),
    eligibleLocationIds: locations,
    afterHoursBehavior: record.afterHoursBehavior as StoredPathway["afterHoursBehavior"],
    writeBackRequired: record.writeBackRequired === true,
    instructionsSource: "clinician_authored",
    aiMayGenerateInstructions: false,
    suppressions: record.suppressions as typeof CARE_SUPPRESSIONS,
    protectedContentHash: requireSha256(record.protectedContentHash, "protected content", "care_pathway_denied"),
    secretBindingHash: requireSha256(record.secretBindingHash, "pathway secret binding", "care_pathway_denied"),
    contentHash: requireSha256(record.contentHash, "pathway content", "care_pathway_denied"),
    approvalHash: requireSha256(record.approvalHash, "pathway approval", "care_pathway_denied"),
    approvalScope: "clinical_simulation_only",
    approvedAt,
    createdAt: timestampToDate(record.createdAt, "pathway createdAt", "care_pathway_denied"),
    updatedAt: timestampToDate(record.updatedAt, "pathway updatedAt", "care_pathway_denied"),
  };
  const contentHash = sha256Hex(serializeCarePathwayContent({
    workspaceId: pathway.workspaceId,
    pathwayId: pathway.id,
    family: "post_discharge",
    protocolVersion: pathway.protocolVersion,
    name: pathway.name,
    clinicalOwnerUid: pathway.clinicalOwnerUid,
    contactPoints: pathway.contactPoints,
    responseSlaMinutes: pathway.responseSlaMinutes,
    escalationTeamId: pathway.escalationTeamId,
    eligibleLocationIds: pathway.eligibleLocationIds,
    afterHoursBehavior: pathway.afterHoursBehavior,
    writeBackRequired: pathway.writeBackRequired,
    instructionsSource: "clinician_authored",
    aiMayGenerateInstructions: false,
    suppressions: CARE_SUPPRESSIONS,
    protectedContentHash: pathway.protectedContentHash,
    secretBindingHash: pathway.secretBindingHash,
    synthetic: true,
  }));
  const approvalHash = sha256Hex(serializeCarePathwayApproval({
    workspaceId: pathway.workspaceId,
    pathwayId: pathway.id,
    contentHash: pathway.contentHash,
    clinicalOwnerUid,
    clinicalApproverUid,
    scope: "clinical_simulation_only",
    approvedAt: approvedAt.toISOString(),
  }));
  if (
    contentHash !== pathway.contentHash || approvalHash !== pathway.approvalHash ||
    clinicalOwnerUid === clinicalApproverUid || pathway.createdAt > pathway.updatedAt ||
    !CARE_SUPPRESSIONS.every((reason, index) => record.suppressions instanceof Array && record.suppressions[index] === reason) ||
    record.writeBackRequired !== pathway.writeBackRequired ||
    !["emergency_path", "next_business_day", "on_call_queue"].includes(pathway.afterHoursBehavior)
  ) return fail("care_pathway_denied", "Care pathway governance evidence is invalid.");
  return pathway;
}

function assertPathwaySecret(value: unknown, pathway: StoredPathway): void {
  const record = exactRecord(value, PATHWAY_SECRET_KEYS, "care pathway secret", "care_pathway_denied");
  const protectedInstructionsRef = requireProtectedRef(record.protectedInstructionsRef, "pathway instructions reference", "care_pathway_denied");
  if (
    record.workspaceId !== pathway.workspaceId || record.pathwayId !== pathway.id ||
    !new Set(["demo://care/instructions/synthetic-v1", "demo://care/instructions/post-discharge-v1"]).has(protectedInstructionsRef) ||
    record.protectedContentFingerprint !== pathway.protectedContentHash ||
    record.schemaVersion !== 1 || record.synthetic !== true
  ) return fail("care_pathway_denied", "Care pathway secret projection is invalid.");
  const hash = sha256Hex(serializeCarePathwaySecretBinding({
    workspaceId: pathway.workspaceId,
    pathwayId: pathway.id,
    protectedInstructionsRef,
    protectedContentFingerprint: requireSha256(record.protectedContentFingerprint, "pathway protected fingerprint", "care_pathway_denied"),
    schemaVersion: 1,
    synthetic: true,
  }));
  if (hash !== pathway.secretBindingHash) return fail("care_pathway_denied", "Care pathway secret binding hash is invalid.");
}

function parseActivation(value: unknown, pathway: StoredPathway): StoredActivation {
  const record = exactRecord(value, ACTIVATION_KEYS, "care pathway activation", "care_activation_denied");
  if (
    record.id !== "post_discharge" || record.workspaceId !== pathway.workspaceId || record.family !== "post_discharge" ||
    record.activePathwayId !== pathway.id || record.activeProtocolVersion !== pathway.protocolVersion ||
    record.activePathwayContentHash !== pathway.contentHash || record.activePathwayApprovalHash !== pathway.approvalHash ||
    record.activePathwayApprovalScope !== "clinical_simulation_only" ||
    record.activePathwaySecretBindingHash !== pathway.secretBindingHash || record.synthetic !== true ||
    record.schemaVersion !== 1 || record.externalDispatchCount !== 0 || record.networkCallCount !== 0
  ) return fail("care_activation_denied", "Care activation does not bind the approved pathway.");
  timestampToDate(record.createdAt, "activation createdAt", "care_activation_denied");
  timestampToDate(record.updatedAt, "activation updatedAt", "care_activation_denied");
  requireInteger(record.revision, "activation revision", 1, 999_999, "care_activation_denied");
  return {
    id: "post_discharge", workspaceId: pathway.workspaceId, activePathwayId: pathway.id,
    activeProtocolVersion: pathway.protocolVersion, activePathwayContentHash: pathway.contentHash,
    activePathwayApprovalHash: pathway.approvalHash, activePathwaySecretBindingHash: pathway.secretBindingHash,
    activatedByUid: requireId(record.activatedByUid, "activation actor", "care_activation_denied"),
    activatedAt: timestampToDate(record.activatedAt, "activation time", "care_activation_denied"),
    activationEventId: requireId(record.activationEventId, "activation event", "care_activation_denied"),
    activationAuditEventId: requireId(record.activationAuditEventId, "activation audit", "care_activation_denied"),
  };
}

function assertActivationEvent(value: unknown, activation: StoredActivation): number {
  const record = exactRecord(value, PATHWAY_EVENT_KEYS, "care activation event", "care_activation_denied");
  if (
    record.id !== activation.activationEventId || record.workspaceId !== activation.workspaceId ||
    record.family !== "post_discharge" || record.eventType !== "activated" ||
    record.pathwayId !== activation.activePathwayId || record.pathwayProtocolVersion !== activation.activeProtocolVersion ||
    record.pathwayContentHash !== activation.activePathwayContentHash ||
    record.pathwayApprovalHash !== activation.activePathwayApprovalHash ||
    record.pathwayApprovalScope !== "clinical_simulation_only" ||
    record.pathwaySecretBindingHash !== activation.activePathwaySecretBindingHash ||
    record.fromLifecycleState !== "approved" || record.toLifecycleState !== "approved" ||
    record.auditEventId !== activation.activationAuditEventId || record.actorKind !== "staff" ||
    record.actorUid !== activation.activatedByUid || record.synthetic !== true || record.schemaVersion !== 1 ||
    record.externalDispatchCount !== 0 || record.networkCallCount !== 0 ||
    timestampToDate(record.occurredAt, "activation event time", "care_activation_denied").getTime() !== activation.activatedAt.getTime()
  ) return fail("care_activation_denied", "Care activation event is missing or substituted.");
  return requireInteger(record.revision, "activation event revision", 1, 999_999, "care_activation_denied");
}

function assertAudit(value: unknown, expected: {
  id: string; workspaceId: string; actorUid: string; action: string;
  resourceType: "care_pathway" | "care_enrollment"; resourceId: string;
  occurredAt: Date; requestId?: string;
  metadata: Readonly<Record<string, string | number | boolean>>;
}): void {
  const record = exactRecord(value, AUDIT_KEYS, "care audit", "care_audit_denied");
  const metadata = exactRecord(record.metadata, Object.keys(expected.metadata), "care audit metadata", "care_audit_denied");
  if (
    record.id !== expected.id || record.workspaceId !== expected.workspaceId || record.actorUid !== expected.actorUid ||
    record.actorType !== "user" || record.action !== expected.action || record.resourceType !== expected.resourceType ||
    record.resourceId !== expected.resourceId || (record.outcome !== "allowed" && record.outcome !== "simulated") ||
    (expected.requestId !== undefined && record.requestId !== expected.requestId) || record.synthetic !== true ||
    record.schemaVersion !== 1 ||
    timestampToDate(record.occurredAt, "audit occurredAt", "care_audit_denied").getTime() !== expected.occurredAt.getTime() ||
    timestampToDate(record.createdAt, "audit createdAt", "care_audit_denied").getTime() !== expected.occurredAt.getTime() ||
    Object.entries(expected.metadata).some(([key, value]) => metadata[key] !== value)
  ) return fail("care_audit_denied", "Care audit does not bind its immutable lifecycle event.");
  requireId(record.requestId, "audit request", "care_audit_denied");
}

function parseEnrollment(value: unknown, expected: { workspaceId: string; enrollmentId: string; now: Date }): StoredEnrollment {
  const record = exactRecord(value, ENROLLMENT_KEYS, "care enrollment", "care_enrollment_denied");
  if (
    record.id !== expected.enrollmentId || record.workspaceId !== expected.workspaceId ||
    !CARE_ENROLLMENT_STATES.includes(record.state as CareEnrollmentState) || record.synthetic !== true ||
    record.schemaVersion !== 1 || record.externalDispatchCount !== 0 || record.networkCallCount !== 0
  ) return fail("care_enrollment_denied", "A matching synthetic care enrollment is required.");
  if (!Array.isArray(record.activeSuppressions) || record.activeSuppressions.some((item) => !CARE_SUPPRESSIONS.includes(item as CareSuppressionReason))) {
    return fail("care_enrollment_denied", "Care suppressions are invalid.");
  }
  const rawSuppressions = record.activeSuppressions as CareSuppressionReason[];
  const suppressions = orderCareSuppressions(rawSuppressions);
  if (suppressions.length !== rawSuppressions.length || suppressions.some((item, index) => item !== rawSuppressions[index])) {
    return fail("care_enrollment_denied", "Care suppressions are not canonical.");
  }
  const enrollment: StoredEnrollment = {
    id: expected.enrollmentId, workspaceId: expected.workspaceId,
    pathwayId: requireId(record.pathwayId, "enrollment pathway", "care_enrollment_denied"),
    pathwayProtocolVersion: requireBoundedString(record.pathwayProtocolVersion, "enrollment protocol", 64, "care_enrollment_denied"),
    pathwayContentHash: requireSha256(record.pathwayContentHash, "enrollment pathway hash", "care_enrollment_denied"),
    teamId: requireId(record.teamId, "enrollment team", "care_enrollment_denied"),
    locationId: requireId(record.locationId, "enrollment location", "care_enrollment_denied"),
    state: record.state as CareEnrollmentState,
    nextContactIndex: requireInteger(record.nextContactIndex, "next contact index", 0, 32, "care_enrollment_denied"),
    nextContactAt: nullableDate(record.nextContactAt, "next contact time", "care_enrollment_denied"),
    activeSuppressions: suppressions,
    openEscalationId: record.openEscalationId === null ? null : requireId(record.openEscalationId, "open escalation", "care_enrollment_denied"),
    safetyHoldEscalationId: record.safetyHoldEscalationId === null ? null : requireId(record.safetyHoldEscalationId, "safety escalation", "care_enrollment_denied"),
    openHandoffId: record.openHandoffId === null ? null : requireId(record.openHandoffId, "open handoff", "care_enrollment_denied"),
    revision: requireInteger(record.revision, "enrollment revision", 1, 999_999, "care_enrollment_denied"),
    outcomeCode: requireId(record.outcomeCode, "enrollment outcome", "care_enrollment_denied"),
    lastEventId: record.lastEventId === null ? null : requireId(record.lastEventId, "enrollment event", "care_enrollment_denied"),
    createdAt: timestampToDate(record.createdAt, "enrollment createdAt", "care_enrollment_denied"),
    updatedAt: timestampToDate(record.updatedAt, "enrollment updatedAt", "care_enrollment_denied"),
  };
  const terminal = enrollment.state === "completed" || enrollment.state === "ended";
  const hasTerminalSuppression = enrollment.activeSuppressions.some((reason) => reason !== "clinical_hold");
  const validOutcomeForState: Readonly<Record<CareEnrollmentState, readonly string[]>> = {
    queued: ["accepted"],
    active: ["accepted", "contact_advanced"],
    paused_by_operator: ["accepted", "safety_hold_cleared"],
    paused_for_human: ["human_takeover_required"],
    paused_for_safety: [
      "clinical_hold_applied",
      "escalation_resolved_safety_hold",
      "safety_hold_cleared",
    ],
    escalated: ["red_flag_escalated", "escalation_acknowledged", "clinical_hold_applied", "suppressed_terminal"],
    completed: ["completed"],
    ended: ["ended_by_operator", "suppressed_terminal", "escalation_resolved_terminal_suppression"],
  };
  if (
    (enrollment.state === "escalated") !== (enrollment.openEscalationId !== null) ||
    (enrollment.state === "paused_for_human") !== (enrollment.openHandoffId !== null) ||
    (enrollment.safetyHoldEscalationId !== null && !["paused_for_safety", "escalated"].includes(enrollment.state)) ||
    (terminal && (enrollment.nextContactAt !== null || enrollment.openEscalationId !== null || enrollment.safetyHoldEscalationId !== null || enrollment.openHandoffId !== null)) ||
    (!terminal && enrollment.nextContactAt === null) ||
    (hasTerminalSuppression && enrollment.state !== "ended" && enrollment.state !== "escalated") ||
    (enrollment.activeSuppressions.includes("clinical_hold") && !["paused_for_safety", "escalated", "ended"].includes(enrollment.state)) ||
    (enrollment.revision === 1 && (enrollment.state !== "queued" || enrollment.nextContactIndex !== 0 || enrollment.activeSuppressions.length !== 0 || enrollment.lastEventId !== null || enrollment.outcomeCode !== "accepted")) ||
    (enrollment.revision > 1 && enrollment.lastEventId === null) ||
    !validOutcomeForState[enrollment.state].includes(enrollment.outcomeCode) ||
    enrollment.createdAt > enrollment.updatedAt || enrollment.updatedAt > expected.now
  ) return fail("care_enrollment_denied", "Care enrollment operational pointers are invalid.");
  return enrollment;
}

function parseEnrollmentSecret(value: unknown, enrollment: StoredEnrollment): StoredEnrollmentSecret {
  const record = exactRecord(value, ENROLLMENT_SECRET_KEYS, "care enrollment secret", "care_enrollment_denied");
  if (record.workspaceId !== enrollment.workspaceId || record.enrollmentId !== enrollment.id || record.schemaVersion !== 1 || record.synthetic !== true) {
    return fail("care_enrollment_denied", "Care enrollment secret does not bind its aggregate.");
  }
  const receiptId = requireSha256(record.receiptId, "care receipt ID", "care_enrollment_denied");
  const receiptFingerprint = requireSha256(record.receiptFingerprint, "care receipt fingerprint", "care_enrollment_denied");
  if (receiptId !== receiptFingerprint) return fail("care_enrollment_denied", "Care receipt identity diverges.");
  return {
    workspaceId: enrollment.workspaceId, enrollmentId: enrollment.id,
    protectedContactRef: requireProtectedRef(record.protectedContactRef, "care contact reference", "care_enrollment_denied"),
    protectedConversationRef: requireProtectedRef(record.protectedConversationRef, "care conversation reference", "care_enrollment_denied"),
    protectedQualifyingDischargeRef: requireProtectedRef(record.protectedQualifyingDischargeRef, "care discharge reference", "care_enrollment_denied"),
    qualifyingDischargeAt: timestampToDate(record.qualifyingDischargeAt, "qualifying discharge time", "care_enrollment_denied"),
    subjectFingerprint: requireSha256(record.subjectFingerprint, "care subject fingerprint", "care_enrollment_denied"),
    sourceDischargeFingerprint: requireSha256(record.sourceDischargeFingerprint, "care discharge fingerprint", "care_enrollment_denied"),
    receiptId, receiptFingerprint,
  };
}

function assertReceipt(value: unknown, input: { enrollment: StoredEnrollment; secret: StoredEnrollmentSecret; pathway: StoredPathway; activation: StoredActivation }): void {
  const record = exactRecord(value, RECEIPT_KEYS, "care enrollment receipt", "care_receipt_denied");
  const qualifyingDischargeAt = timestampToDate(
    record.qualifyingDischargeAt,
    "receipt discharge time",
    "care_receipt_denied",
  );
  const createdAt = timestampToDate(record.createdAt, "receipt createdAt", "care_receipt_denied");
  const receipt = {
    receiptId: requireSha256(record.id, "receipt ID", "care_receipt_denied"),
    receiptFingerprint: requireSha256(record.receiptFingerprint, "receipt fingerprint", "care_receipt_denied"),
    workspaceId: requireId(record.workspaceId, "receipt workspace", "care_receipt_denied"),
    family: record.family as "post_discharge",
    pathwayId: requireId(record.pathwayId, "receipt pathway", "care_receipt_denied"),
    pathwayProtocolVersion: requireBoundedString(record.pathwayProtocolVersion, "receipt protocol", 64, "care_receipt_denied"),
    pathwayContentHash: requireSha256(record.pathwayContentHash, "receipt content", "care_receipt_denied"),
    pathwayApprovalHash: requireSha256(record.pathwayApprovalHash, "receipt approval", "care_receipt_denied"),
    activationEventId: requireId(record.activationEventId, "receipt activation", "care_receipt_denied"),
    dischargeFingerprint: requireSha256(record.dischargeFingerprint, "receipt discharge", "care_receipt_denied"),
    qualifyingDischargeAt: qualifyingDischargeAt.toISOString(),
    enrollmentId: requireId(record.enrollmentId, "receipt enrollment", "care_receipt_denied"),
    createdAt: createdAt.toISOString(),
    schemaVersion: 1 as const, synthetic: true as const,
  };
  if (
    record.family !== "post_discharge" || record.schemaVersion !== 1 || record.synthetic !== true ||
    receipt.receiptId !== input.secret.receiptId || receipt.receiptFingerprint !== input.secret.receiptFingerprint ||
    receipt.workspaceId !== input.enrollment.workspaceId || receipt.enrollmentId !== input.enrollment.id ||
    receipt.pathwayId !== input.enrollment.pathwayId || receipt.pathwayProtocolVersion !== input.enrollment.pathwayProtocolVersion ||
    receipt.pathwayContentHash !== input.enrollment.pathwayContentHash || receipt.pathwayApprovalHash !== input.pathway.approvalHash ||
    receipt.activationEventId !== input.activation.activationEventId ||
    receipt.dischargeFingerprint !== input.secret.sourceDischargeFingerprint ||
    receipt.qualifyingDischargeAt !== input.secret.qualifyingDischargeAt.toISOString() ||
    input.activation.activatedAt.getTime() > createdAt.getTime() ||
    input.enrollment.createdAt.getTime() !== createdAt.getTime() ||
    qualifyingDischargeAt.getTime() > createdAt.getTime()
  ) return fail("care_receipt_denied", "Care receipt does not bind the enrollment aggregate and schedule.");
  assertCareReceiptReplayBinding(receipt);
}

function scheduledContactAt(pathway: StoredPathway, dischargeAt: Date, index: number): Date | null {
  const point = pathway.contactPoints[index];
  return point ? new Date(dischargeAt.getTime() + point.dayOffset * 86_400_000) : null;
}

function parseEscalation(value: unknown, enrollment: StoredEnrollment, escalationId: string): StoredEscalation {
  const record = exactRecord(value, ESCALATION_KEYS, "care escalation", "care_escalation_denied");
  const openedBy = actor(record.openedBy, "escalation opening actor");
  const escalation: StoredEscalation = {
    id: escalationId,
    workspaceId: enrollment.workspaceId,
    enrollmentId: enrollment.id,
    pathwayId: enrollment.pathwayId,
    pathwayProtocolVersion: enrollment.pathwayProtocolVersion,
    pathwayContentHash: enrollment.pathwayContentHash,
    teamId: enrollment.teamId,
    locationId: enrollment.locationId,
    reasonCode: record.reasonCode as StoredEscalation["reasonCode"],
    state: record.state as StoredEscalation["state"],
    openedAt: timestampToDate(record.openedAt, "escalation openedAt", "care_escalation_denied"),
    responseSlaMinutes: requireInteger(record.responseSlaMinutes, "escalation SLA", 1, 1_440, "care_escalation_denied"),
    responseDueAt: timestampToDate(record.responseDueAt, "escalation dueAt", "care_escalation_denied"),
    openedBy,
    acknowledgedAt: nullableDate(record.acknowledgedAt, "escalation acknowledgedAt", "care_escalation_denied"),
    acknowledgedByUid: record.acknowledgedByUid === null ? null : requireId(record.acknowledgedByUid, "escalation acknowledge actor", "care_escalation_denied"),
    resolvedAt: nullableDate(record.resolvedAt, "escalation resolvedAt", "care_escalation_denied"),
    resolvedByUid: record.resolvedByUid === null ? null : requireId(record.resolvedByUid, "escalation resolve actor", "care_escalation_denied"),
    resolutionCode: record.resolutionCode as StoredEscalation["resolutionCode"],
    writeBackRequired: record.writeBackRequired === true,
    writeBackState: record.writeBackState as StoredEscalation["writeBackState"],
    revision: requireInteger(record.revision, "escalation revision", 1, 999_999, "care_escalation_denied"),
    lastEventId: requireId(record.lastEventId, "escalation last event", "care_escalation_denied"),
    createdAt: timestampToDate(record.createdAt, "escalation createdAt", "care_escalation_denied"),
    updatedAt: timestampToDate(record.updatedAt, "escalation updatedAt", "care_escalation_denied"),
  };
  const ackComplete = escalation.acknowledgedAt !== null && escalation.acknowledgedByUid !== null;
  const resolutionComplete = escalation.resolvedAt !== null && escalation.resolvedByUid !== null && escalation.resolutionCode !== null;
  if (
    record.id !== escalationId || record.workspaceId !== enrollment.workspaceId || record.enrollmentId !== enrollment.id ||
    record.pathwayId !== enrollment.pathwayId || record.pathwayProtocolVersion !== enrollment.pathwayProtocolVersion ||
    record.pathwayContentHash !== enrollment.pathwayContentHash || record.teamId !== enrollment.teamId ||
    record.locationId !== enrollment.locationId || record.synthetic !== true || record.schemaVersion !== 1 ||
    record.externalDispatchCount !== 0 || record.networkCallCount !== 0 ||
    !["red_flag_response", "emergency_keyword", "clinical_review_required"].includes(escalation.reasonCode) ||
    !["open", "acknowledged", "resolved"].includes(escalation.state) ||
    escalation.responseDueAt.getTime() - escalation.openedAt.getTime() !== escalation.responseSlaMinutes * 60_000 ||
    escalation.createdAt.getTime() !== escalation.openedAt.getTime() || escalation.updatedAt < escalation.createdAt ||
    (escalation.acknowledgedAt === null) !== (escalation.acknowledgedByUid === null) ||
    [escalation.resolvedAt, escalation.resolvedByUid, escalation.resolutionCode].filter((item) => item === null).length % 3 !== 0 ||
    (escalation.state === "open" && (ackComplete || resolutionComplete)) ||
    (escalation.state === "acknowledged" && (!ackComplete || resolutionComplete)) ||
    (escalation.state === "resolved" && (!ackComplete || !resolutionComplete)) ||
    (escalation.acknowledgedAt !== null && escalation.acknowledgedAt < escalation.openedAt) ||
    (escalation.resolvedAt !== null && escalation.acknowledgedAt !== null && escalation.resolvedAt < escalation.acknowledgedAt) ||
    (escalation.writeBackRequired && escalation.writeBackState === "not_required") ||
    (!escalation.writeBackRequired && escalation.writeBackState !== "not_required") ||
    !["not_required", "pending", "unavailable_in_demo"].includes(escalation.writeBackState)
  ) return fail("care_escalation_denied", "Care escalation lifecycle evidence is invalid.");
  return escalation;
}

function assertEscalationSecret(value: unknown, enrollment: StoredEnrollment, escalation: StoredEscalation): void {
  const record = exactRecord(value, [
    "workspaceId", "enrollmentId", "escalationId", "protectedContextRef",
    "contextFingerprint", "schemaVersion", "synthetic",
  ], "care escalation secret", "care_escalation_denied");
  const expectedFingerprint = sha256Hex(JSON.stringify([
    enrollment.workspaceId, enrollment.id, escalation.id, escalation.reasonCode,
  ]));
  if (
    record.workspaceId !== enrollment.workspaceId || record.enrollmentId !== enrollment.id ||
    record.escalationId !== escalation.id || record.protectedContextRef !== phase5EscalationProtectedRef(escalation.id) ||
    record.contextFingerprint !== expectedFingerprint || record.schemaVersion !== 1 || record.synthetic !== true
  ) return fail("care_escalation_denied", "Care escalation secret is missing or substituted.");
}

function parseHandoff(value: unknown, enrollment: StoredEnrollment, handoffId: string): StoredHandoff {
  const record = exactRecord(value, HANDOFF_KEYS, "care handoff", "care_handoff_denied");
  const openedBy = actor(record.openedBy, "handoff opening actor");
  const releasedBy = record.releasedBy === null ? null : actor(record.releasedBy, "handoff release actor");
  const handoff: StoredHandoff = {
    id: handoffId, workspaceId: enrollment.workspaceId, enrollmentId: enrollment.id,
    pathwayId: enrollment.pathwayId, pathwayProtocolVersion: enrollment.pathwayProtocolVersion,
    pathwayContentHash: enrollment.pathwayContentHash, teamId: enrollment.teamId, locationId: enrollment.locationId,
    state: record.state as StoredHandoff["state"],
    openedEventId: requireId(record.openedEventId, "handoff opening event", "care_handoff_denied"),
    openedBy,
    openedAt: timestampToDate(record.openedAt, "handoff openedAt", "care_handoff_denied"),
    releasedEventId: record.releasedEventId === null ? null : requireId(record.releasedEventId, "handoff release event", "care_handoff_denied"),
    releasedBy,
    releasedAt: nullableDate(record.releasedAt, "handoff releasedAt", "care_handoff_denied"),
    revision: requireInteger(record.revision, "handoff revision", 1, 999_999, "care_handoff_denied"),
    lastEventId: requireId(record.lastEventId, "handoff last event", "care_handoff_denied"),
    createdAt: timestampToDate(record.createdAt, "handoff createdAt", "care_handoff_denied"),
    updatedAt: timestampToDate(record.updatedAt, "handoff updatedAt", "care_handoff_denied"),
  };
  const releaseNullCount = [handoff.releasedEventId, handoff.releasedBy, handoff.releasedAt].filter((item) => item === null).length;
  if (
    record.id !== handoffId || record.workspaceId !== enrollment.workspaceId || record.enrollmentId !== enrollment.id ||
    record.pathwayId !== enrollment.pathwayId || record.pathwayProtocolVersion !== enrollment.pathwayProtocolVersion ||
    record.pathwayContentHash !== enrollment.pathwayContentHash || record.teamId !== enrollment.teamId ||
    record.locationId !== enrollment.locationId || record.synthetic !== true || record.schemaVersion !== 1 ||
    record.externalDispatchCount !== 0 || record.networkCallCount !== 0 ||
    !["open", "released"].includes(handoff.state) || releaseNullCount !== 0 && releaseNullCount !== 3 ||
    handoff.createdAt.getTime() !== handoff.openedAt.getTime() || handoff.updatedAt < handoff.createdAt ||
    (handoff.state === "open" && (releaseNullCount !== 3 || handoff.revision !== 1 || handoff.lastEventId !== handoff.openedEventId)) ||
    (handoff.state === "released" && (releaseNullCount !== 0 || handoff.revision < 2 || handoff.lastEventId !== handoff.releasedEventId || handoff.updatedAt.getTime() !== handoff.releasedAt!.getTime()))
  ) return fail("care_handoff_denied", "Care handoff lifecycle evidence is invalid.");
  return handoff;
}

function actionAllowed(state: CareEnrollmentState, action: CareEnrollmentAction): boolean {
  const matrix: Readonly<Record<CareEnrollmentState, readonly CareEnrollmentAction[]>> = {
    queued: ["start", "end", "simulate_suppression"],
    active: ["advance_contact", "pause", "end", "simulate_suppression", "human_takeover_started", "raise_red_flag"],
    paused_by_operator: ["resume", "end", "simulate_suppression", "human_takeover_started", "raise_red_flag"],
    paused_for_human: ["release_human_takeover", "end", "simulate_suppression", "raise_red_flag"],
    paused_for_safety: ["clear_clinical_hold", "clear_safety_hold", "end", "simulate_suppression", "raise_red_flag"],
    escalated: ["acknowledge_escalation", "resolve_escalation", "simulate_suppression"],
    completed: [], ended: [],
  };
  return matrix[state].includes(action);
}

function terminalSuppression(reason: CareSuppressionReason): boolean { return reason !== "clinical_hold"; }

function planCare(input: {
  enrollment: StoredEnrollment;
  pathway: StoredPathway;
  action: CareEnrollmentAction;
  suppressionReason: CareSuppressionReason | null;
  now: Date;
  createdEscalationId: string;
  createdHandoffId: string;
}): CarePlan {
  const { enrollment, pathway, action, suppressionReason, now } = input;
  if (!actionAllowed(enrollment.state, action)) return fail("care_transition_denied", `Action ${action} is not allowed from ${enrollment.state}.`);
  const base: CarePlan = {
    state: enrollment.state,
    nextContactIndex: enrollment.nextContactIndex,
    nextContactAt: enrollment.nextContactAt,
    suppressions: enrollment.activeSuppressions,
    openEscalationId: enrollment.openEscalationId,
    safetyHoldEscalationId: enrollment.safetyHoldEscalationId,
    openHandoffId: enrollment.openHandoffId,
    contactPointIndex: null,
    outcomeCode: "accepted",
    escalationMode: "none",
    handoffMode: enrollment.state === "paused_for_human" ? "release" : "none",
  };
  if (action === "start") return { ...base, state: "active" };
  if (action === "pause") return { ...base, state: "paused_by_operator" };
  if (action === "resume") {
    if (enrollment.activeSuppressions.length > 0 || enrollment.openEscalationId !== null || enrollment.safetyHoldEscalationId !== null) {
      return fail("care_transition_denied", "Care cannot resume while safety evidence remains active.");
    }
    return { ...base, state: "active" };
  }
  if (action === "end") {
    if (enrollment.openEscalationId !== null) return fail("care_transition_denied", "Care cannot end while escalation remains open.");
    return { ...base, state: "ended", nextContactAt: null, safetyHoldEscalationId: null, openHandoffId: null, outcomeCode: "ended_by_operator" };
  }
  if (action === "advance_contact") {
    if (enrollment.nextContactAt === null || now < enrollment.nextContactAt) return fail("care_schedule_denied", "Care contact is not due.");
    const nextIndex = enrollment.nextContactIndex + 1;
    const complete = nextIndex === pathway.contactPoints.length;
    return {
      ...base,
      state: complete ? "completed" : "active",
      nextContactIndex: nextIndex,
      nextContactAt: complete ? null : scheduledContactAt(pathway, new Date(enrollment.nextContactAt.getTime() - pathway.contactPoints[enrollment.nextContactIndex]!.dayOffset * 86_400_000), nextIndex),
      contactPointIndex: enrollment.nextContactIndex,
      outcomeCode: complete ? "completed" : "contact_advanced",
    };
  }
  if (action === "simulate_suppression") {
    if (suppressionReason === null) return fail("care_transition_denied", "Suppression reason is required.");
    const suppressions = orderCareSuppressions([...enrollment.activeSuppressions, suppressionReason]);
    const preserveEscalation = enrollment.openEscalationId !== null;
    return {
      ...base,
      state: preserveEscalation ? "escalated" : terminalSuppression(suppressionReason) ? "ended" : "paused_for_safety",
      nextContactAt: preserveEscalation ? enrollment.nextContactAt : terminalSuppression(suppressionReason) ? null : enrollment.nextContactAt,
      suppressions,
      openHandoffId: null,
      safetyHoldEscalationId: preserveEscalation ? enrollment.safetyHoldEscalationId : terminalSuppression(suppressionReason) ? null : enrollment.safetyHoldEscalationId,
      outcomeCode: terminalSuppression(suppressionReason) ? "suppressed_terminal" : "clinical_hold_applied",
      escalationMode: preserveEscalation ? "preserve" : "none",
    };
  }
  if (action === "human_takeover_started") return {
    ...base, state: "paused_for_human", openHandoffId: input.createdHandoffId,
    outcomeCode: "human_takeover_required", handoffMode: "create",
  };
  if (action === "release_human_takeover") return {
    ...base, state: "paused_by_operator", openHandoffId: null, handoffMode: "release",
  };
  if (action === "clear_clinical_hold") {
    if (!enrollment.activeSuppressions.includes("clinical_hold") || enrollment.activeSuppressions.some(terminalSuppression) || enrollment.openEscalationId !== null) {
      return fail("care_transition_denied", "Clinical hold cannot be cleared with terminal or escalation evidence.");
    }
    const suppressions = orderCareSuppressions(enrollment.activeSuppressions.filter((reason) => reason !== "clinical_hold"));
    return { ...base, state: enrollment.safetyHoldEscalationId ? "paused_for_safety" : "paused_by_operator", suppressions, outcomeCode: "safety_hold_cleared" };
  }
  if (action === "raise_red_flag") return {
    ...base, state: "escalated", openEscalationId: input.createdEscalationId,
    openHandoffId: null, outcomeCode: "red_flag_escalated", escalationMode: "create",
  };
  if (action === "acknowledge_escalation") return { ...base, outcomeCode: "escalation_acknowledged", escalationMode: "acknowledge" };
  if (action === "resolve_escalation") {
    const terminal = enrollment.activeSuppressions.some(terminalSuppression);
    return {
      ...base, state: terminal ? "ended" : "paused_for_safety", nextContactAt: terminal ? null : enrollment.nextContactAt,
      openEscalationId: null, safetyHoldEscalationId: terminal ? null : enrollment.openEscalationId,
      outcomeCode: terminal ? "escalation_resolved_terminal_suppression" : "escalation_resolved_safety_hold",
      escalationMode: "resolve",
    };
  }
  if (enrollment.openEscalationId !== null || enrollment.safetyHoldEscalationId === null || enrollment.activeSuppressions.length > 0) {
    return fail("care_transition_denied", "Safety hold cannot clear while escalation or suppression evidence remains.");
  }
  return {
    ...base, state: "paused_by_operator", safetyHoldEscalationId: null,
    outcomeCode: "safety_hold_cleared", escalationMode: "touch_resolved",
  };
}

function parseStoredResult(value: unknown, expectedEnrollmentId?: string): SyntheticCareControlResult {
  const record = exactRecord(value, [
    "enrollmentId", "eventId", "action", "state", "revision", "nextContactIndex",
    "nextContactAt", "openEscalationId", "safetyHoldEscalationId", "openHandoffId",
    "outcomeCode", "synthetic", "externalDispatchCount", "networkCallCount",
  ], "care result", "invalid_idempotency_record");
  if (
    (expectedEnrollmentId !== undefined && record.enrollmentId !== expectedEnrollmentId) ||
    !CARE_ENROLLMENT_ACTIONS.includes(record.action as CareEnrollmentAction) ||
    !CARE_ENROLLMENT_STATES.includes(record.state as CareEnrollmentState) || record.synthetic !== true ||
    record.externalDispatchCount !== 0 || record.networkCallCount !== 0
  ) return fail("invalid_idempotency_record", "Stored care result is invalid.");
  return {
    enrollmentId: requireId(record.enrollmentId, "result enrollment", "invalid_idempotency_record"),
    eventId: requireId(record.eventId, "result event", "invalid_idempotency_record"),
    action: record.action as CareEnrollmentAction,
    state: record.state as CareEnrollmentState,
    revision: requireInteger(record.revision, "result revision", 2, 999_999, "invalid_idempotency_record"),
    nextContactIndex: requireInteger(record.nextContactIndex, "result contact index", 0, 32, "invalid_idempotency_record"),
    nextContactAt: record.nextContactAt === null ? null : timestampToDate(record.nextContactAt, "result contact time", "invalid_idempotency_record").toISOString(),
    openEscalationId: record.openEscalationId === null ? null : requireId(record.openEscalationId, "result escalation", "invalid_idempotency_record"),
    safetyHoldEscalationId: record.safetyHoldEscalationId === null ? null : requireId(record.safetyHoldEscalationId, "result safety escalation", "invalid_idempotency_record"),
    openHandoffId: record.openHandoffId === null ? null : requireId(record.openHandoffId, "result handoff", "invalid_idempotency_record"),
    outcomeCode: requireId(record.outcomeCode, "result outcome", "invalid_idempotency_record"),
    synthetic: true, externalDispatchCount: 0, networkCallCount: 0,
  };
}

function resultFor(enrollment: StoredEnrollment, eventId: string, action: CareEnrollmentAction): SyntheticCareControlResult {
  return {
    enrollmentId: enrollment.id, eventId, action, state: enrollment.state,
    revision: enrollment.revision, nextContactIndex: enrollment.nextContactIndex,
    nextContactAt: iso(enrollment.nextContactAt), openEscalationId: enrollment.openEscalationId,
    safetyHoldEscalationId: enrollment.safetyHoldEscalationId, openHandoffId: enrollment.openHandoffId,
    outcomeCode: enrollment.outcomeCode, synthetic: true, externalDispatchCount: 0, networkCallCount: 0,
  };
}

function careResultFingerprint(result: SyntheticCareControlResult): string {
  return sha256Hex(serializeCareControlResult(result));
}

function careEventFingerprint(input: {
  workspaceId: string; enrollmentId: string; eventId: string; revision: number;
  pathwayId: string; pathwayProtocolVersion: string; pathwayContentHash: string;
  teamId: string; locationId: string; auditEventId: string;
  action: CareEnrollmentAction; fromState: CareEnrollmentState; toState: CareEnrollmentState;
  contactPointIndex: number | null; suppressionReason: CareSuppressionReason | null;
  escalationId: string | null; escalationStateBefore: string | null; escalationStateAfter: string | null;
  handoffId: string | null; activeSuppressionsAfter: readonly CareSuppressionReason[];
  nextContactAt: Date | null; outcomeCode: string; occurredAt: Date; actorUid: string;
}): string {
  return syntheticHmacSha256(JSON.stringify([
    "hemas-connect:care-enrollment-event-evidence:v1", input.workspaceId,
    input.enrollmentId, input.eventId, input.pathwayId, input.pathwayProtocolVersion,
    input.pathwayContentHash, input.teamId, input.locationId, input.revision,
    input.auditEventId, input.action, input.fromState, input.toState,
    input.contactPointIndex, input.suppressionReason, input.escalationId,
    input.escalationStateBefore, input.escalationStateAfter, input.handoffId,
    [...input.activeSuppressionsAfter], iso(input.nextContactAt), input.outcomeCode,
    input.occurredAt.toISOString(), "staff", input.actorUid, 1, true, 0, 0,
  ]));
}

function assertReplay(input: {
  eventValue: unknown; secretValue: unknown; auditValue: unknown;
  enrollment: StoredEnrollment; request: SyntheticCareControlInput;
  result: SyntheticCareControlResult; auditEventId: string; actorUid: string;
  idempotencyId: string;
}): { escalationId: string | null; handoffId: string | null } {
  const event = exactRecord(input.eventValue, ENROLLMENT_EVENT_KEYS, "care replay event", "idempotency_conflict");
  const secret = exactRecord(input.secretValue, EVENT_SECRET_KEYS, "care replay event secret", "idempotency_conflict");
  if (!Array.isArray(event.activeSuppressionsAfter) || event.activeSuppressionsAfter.some((reason) => !CARE_SUPPRESSIONS.includes(reason as CareSuppressionReason))) {
    return fail("idempotency_conflict", "Replay suppression evidence is invalid.");
  }
  const rawSuppressionsAfter = event.activeSuppressionsAfter as CareSuppressionReason[];
  const activeSuppressionsAfter = orderCareSuppressions(rawSuppressionsAfter);
  if (activeSuppressionsAfter.length !== rawSuppressionsAfter.length || activeSuppressionsAfter.some((reason, index) => reason !== rawSuppressionsAfter[index])) {
    return fail("idempotency_conflict", "Replay suppression evidence is not canonical.");
  }
  const fromState = CARE_ENROLLMENT_STATES.includes(event.fromState as CareEnrollmentState)
    ? event.fromState as CareEnrollmentState
    : fail("idempotency_conflict", "Replay from-state is invalid.");
  const toState = CARE_ENROLLMENT_STATES.includes(event.toState as CareEnrollmentState)
    ? event.toState as CareEnrollmentState
    : fail("idempotency_conflict", "Replay to-state is invalid.");
  const contactPointIndex = event.contactPointIndex === null
    ? null
    : requireInteger(event.contactPointIndex, "event contact point", 0, 31, "idempotency_conflict");
  const suppressionReason = event.suppressionReason === null
    ? null
    : (CARE_SUPPRESSIONS.includes(event.suppressionReason as CareSuppressionReason)
      ? event.suppressionReason as CareSuppressionReason
      : fail("idempotency_conflict", "Replay suppression reason is invalid."));
  const occurredAt = timestampToDate(event.occurredAt, "event occurredAt", "idempotency_conflict");
  const nextContactAt = event.nextContactAt === null ? null : timestampToDate(event.nextContactAt, "event nextContactAt", "idempotency_conflict");
  const escalationId = event.escalationId === null ? null : requireId(event.escalationId, "event escalation", "idempotency_conflict");
  const handoffId = event.handoffId === null ? null : requireId(event.handoffId, "event handoff", "idempotency_conflict");
  const escalationStateBefore = event.escalationStateBefore === null ? null : requireBoundedString(event.escalationStateBefore, "event escalation state", 32, "idempotency_conflict");
  const escalationStateAfter = event.escalationStateAfter === null ? null : requireBoundedString(event.escalationStateAfter, "event escalation state", 32, "idempotency_conflict");
  const expectedFingerprint = careEventFingerprint({
    workspaceId: input.request.workspaceId, enrollmentId: input.request.enrollmentId,
    eventId: input.result.eventId, revision: input.result.revision, action: input.request.action,
    pathwayId: input.enrollment.pathwayId, pathwayProtocolVersion: input.enrollment.pathwayProtocolVersion,
    pathwayContentHash: input.enrollment.pathwayContentHash, teamId: input.enrollment.teamId,
    locationId: input.enrollment.locationId, auditEventId: input.auditEventId,
    fromState, toState,
    contactPointIndex,
    suppressionReason, escalationId,
    escalationStateBefore, escalationStateAfter, handoffId, activeSuppressionsAfter,
    nextContactAt, outcomeCode: input.result.outcomeCode, occurredAt, actorUid: input.actorUid,
  });
  if (
    input.result.action !== input.request.action || event.id !== input.result.eventId ||
    event.workspaceId !== input.request.workspaceId || event.enrollmentId !== input.request.enrollmentId ||
    event.pathwayId !== input.enrollment.pathwayId || event.pathwayProtocolVersion !== input.enrollment.pathwayProtocolVersion ||
    event.pathwayContentHash !== input.enrollment.pathwayContentHash || event.teamId !== input.enrollment.teamId ||
    event.locationId !== input.enrollment.locationId || event.revision !== input.result.revision ||
    event.auditEventId !== input.auditEventId || event.action !== input.request.action ||
    toState !== input.result.state || iso(nextContactAt) !== input.result.nextContactAt ||
    suppressionReason !== input.request.suppressionReason ||
    event.outcomeCode !== input.result.outcomeCode || event.actorKind !== "staff" || event.actorUid !== input.actorUid ||
    event.synthetic !== true || event.schemaVersion !== 1 || event.externalDispatchCount !== 0 || event.networkCallCount !== 0 ||
    secret.workspaceId !== input.request.workspaceId || secret.enrollmentId !== input.request.enrollmentId ||
    secret.eventId !== input.result.eventId || secret.protectedContextRef !== phase5EventProtectedRef("care", input.result.eventId) ||
    secret.contextFingerprint !== expectedFingerprint || secret.schemaVersion !== 1 || secret.synthetic !== true ||
    input.enrollment.revision < input.result.revision || input.enrollment.updatedAt < occurredAt ||
    (input.enrollment.revision === input.result.revision && (
      input.enrollment.updatedAt.getTime() !== occurredAt.getTime() ||
      input.enrollment.state !== input.result.state || input.enrollment.nextContactIndex !== input.result.nextContactIndex ||
      iso(input.enrollment.nextContactAt) !== input.result.nextContactAt || input.enrollment.openEscalationId !== input.result.openEscalationId ||
      input.enrollment.safetyHoldEscalationId !== input.result.safetyHoldEscalationId || input.enrollment.openHandoffId !== input.result.openHandoffId ||
      input.enrollment.outcomeCode !== input.result.outcomeCode || input.enrollment.lastEventId !== input.result.eventId ||
      input.enrollment.activeSuppressions.length !== activeSuppressionsAfter.length ||
      input.enrollment.activeSuppressions.some((reason, index) => reason !== activeSuppressionsAfter[index])
    ))
  ) return fail("idempotency_conflict", "Replay event, secret or aggregate evidence is substituted.");
  assertAudit(input.auditValue, {
    id: input.auditEventId, workspaceId: input.request.workspaceId, actorUid: input.actorUid,
    action: `care_enrollment.${input.request.action}`, resourceType: "care_enrollment",
    resourceId: input.request.enrollmentId, occurredAt, requestId: input.idempotencyId,
    metadata: {
      eventId: input.result.eventId,
      fromState,
      toState: input.result.state,
      revision: input.result.revision,
      outcomeCode: input.result.outcomeCode,
      resultFingerprint: careResultFingerprint(input.result),
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
    },
  });
  return { escalationId, handoffId };
}

async function assertCurrentEnrollmentEvidence(input: {
  db: Firestore; transaction: Transaction; base: string; enrollment: StoredEnrollment;
}): Promise<void> {
  if (input.enrollment.lastEventId === null) return;
  const eventSnapshot = await get(input.transaction, input.db.doc(`${input.base}/${CARE_COLLECTIONS.enrollmentEvents}/${input.enrollment.lastEventId}`));
  const eventValue = data(eventSnapshot, "care_enrollment_denied", "Current care event is missing.");
  const envelope = exactRecord(eventValue, ENROLLMENT_EVENT_KEYS, "current care event", "care_enrollment_denied");
  if (!CARE_ENROLLMENT_ACTIONS.includes(envelope.action as CareEnrollmentAction) || envelope.actorKind !== "staff") {
    return fail("care_enrollment_denied", "Current care event actor or action is invalid.");
  }
  const action = envelope.action as CareEnrollmentAction;
  const actorUid = requireId(envelope.actorUid, "current care actor", "care_enrollment_denied");
  const auditEventId = requireId(envelope.auditEventId, "current care audit", "care_enrollment_denied");
  const [secretSnapshot, auditSnapshot] = await Promise.all([
    get(input.transaction, input.db.doc(`${input.base}/${CARE_COLLECTIONS.enrollmentEventSecrets}/${input.enrollment.lastEventId}`)),
    get(input.transaction, input.db.doc(`${input.base}/auditEvents/${auditEventId}`)),
  ]);
  const auditValue = data(auditSnapshot, "care_enrollment_denied", "Current care audit is missing.");
  const audit = exactRecord(auditValue, AUDIT_KEYS, "current care audit", "care_enrollment_denied");
  const auditRequestId = requireId(audit.requestId, "current care audit request", "care_enrollment_denied");
  const suppressionReason = envelope.suppressionReason === null
    ? null
    : (CARE_SUPPRESSIONS.includes(envelope.suppressionReason as CareSuppressionReason)
      ? envelope.suppressionReason as CareSuppressionReason
      : fail("care_enrollment_denied", "Current care suppression reason is invalid."));
  const result = resultFor(input.enrollment, input.enrollment.lastEventId, action);
  const references = assertReplay({
    eventValue,
    secretValue: data(secretSnapshot, "care_enrollment_denied", "Current care event secret is missing."),
    auditValue,
    enrollment: input.enrollment,
    request: {
      workspaceId: input.enrollment.workspaceId,
      enrollmentId: input.enrollment.id,
      action,
      expectedRevision: Math.max(1, input.enrollment.revision - 1),
      suppressionReason,
      idempotencyKey: "current-care-evidence-only",
    },
    result,
    auditEventId,
    actorUid,
    idempotencyId: auditRequestId,
  });
  if (references.escalationId !== null) {
    const [escalationSnapshot, escalationSecretSnapshot] = await Promise.all([
      get(input.transaction, input.db.doc(`${input.base}/${CARE_COLLECTIONS.escalations}/${references.escalationId}`)),
      get(input.transaction, input.db.doc(`${input.base}/${CARE_COLLECTIONS.escalationSecrets}/${references.escalationId}`)),
    ]);
    const escalation = parseEscalation(data(escalationSnapshot, "care_enrollment_denied", "Current event escalation is missing."), input.enrollment, references.escalationId);
    assertEscalationSecret(data(escalationSecretSnapshot, "care_enrollment_denied", "Current escalation secret is missing."), input.enrollment, escalation);
  }
  if (references.handoffId !== null) {
    const handoffSnapshot = await get(input.transaction, input.db.doc(`${input.base}/${CARE_COLLECTIONS.handoffs}/${references.handoffId}`));
    parseHandoff(data(handoffSnapshot, "care_enrollment_denied", "Current event handoff is missing."), input.enrollment, references.handoffId);
  }
}

export async function controlSyntheticCareEnrollment(input: {
  readonly db: Firestore;
  readonly config: RuntimeConfig;
  readonly emulator: EmulatorBoundary;
  readonly actor: Phase5Actor;
  readonly request: SyntheticCareControlInput;
  readonly now?: Date;
}): Promise<SyntheticCareControlResponse> {
  const request = parseSyntheticCareControlInput(input.request);
  ensureNoUnexpectedClinicalText(request);
  assertPhase5DemoRuntimeBoundary(input.config, input.emulator, request.workspaceId);
  const now = input.now ?? new Date();
  const actionName = `care_enrollment.${request.action}`;
  const requestHash = sha256Hex(JSON.stringify({
    workspaceId: request.workspaceId,
    enrollmentId: request.enrollmentId,
    action: request.action,
    expectedRevision: request.expectedRevision,
    suppressionReason: request.suppressionReason,
    idempotencyKey: request.idempotencyKey,
  }));
  const idempotencyId = phase5IdempotencyId({
    workspaceId: request.workspaceId,
    actorUid: input.actor.uid,
    action: actionName,
    key: request.idempotencyKey,
  });
  const base = root(request.workspaceId);
  const refs = {
    workspace: input.db.doc(base),
    membership: input.db.doc(`${base}/members/${input.actor.uid}`),
    enrollment: input.db.doc(`${base}/${CARE_COLLECTIONS.enrollments}/${request.enrollmentId}`),
    enrollmentSecret: input.db.doc(`${base}/${CARE_COLLECTIONS.enrollmentSecrets}/${request.enrollmentId}`),
    idempotency: input.db.doc(`${base}/idempotencyKeys/${idempotencyId}`),
  };

  return input.db.runTransaction(async (transaction) => {
    const [workspaceSnapshot, membershipSnapshot, enrollmentSnapshot, enrollmentSecretSnapshot, idempotencySnapshot] = await Promise.all([
      get(transaction, refs.workspace), get(transaction, refs.membership), get(transaction, refs.enrollment),
      get(transaction, refs.enrollmentSecret), get(transaction, refs.idempotency),
    ]);
    const enrollment = parseEnrollment(data(enrollmentSnapshot, "care_enrollment_denied", "Care enrollment is missing."), {
      workspaceId: request.workspaceId, enrollmentId: request.enrollmentId, now,
    });
    const clinicalAction = [
      "clear_clinical_hold", "acknowledge_escalation", "resolve_escalation", "clear_safety_hold",
    ].includes(request.action);
    const authorization = assertPhase5Authorization({
      workspaceId: request.workspaceId,
      workspace: workspaceSnapshot.data(), membership: membershipSnapshot.data(), actor: input.actor,
      permission: clinicalAction ? "clinical.manage_escalations" : "clinical.control_enrollments",
      patientScope: { teamId: enrollment.teamId, locationId: enrollment.locationId }, now,
    });
    const enrollmentSecret = parseEnrollmentSecret(data(enrollmentSecretSnapshot, "care_enrollment_denied", "Care enrollment secret is missing."), enrollment);
    const pathwayRef = input.db.doc(`${base}/${CARE_COLLECTIONS.pathways}/${enrollment.pathwayId}`);
    const pathwaySecretRef = input.db.doc(`${base}/${CARE_COLLECTIONS.pathwaySecrets}/${enrollment.pathwayId}`);
    const receiptRef = input.db.doc(`${base}/${CARE_COLLECTIONS.enrollmentReceipts}/${enrollmentSecret.receiptId}`);
    const [pathwaySnapshot, pathwaySecretSnapshot, receiptSnapshot] = await Promise.all([
      get(transaction, pathwayRef), get(transaction, pathwaySecretRef), get(transaction, receiptRef),
    ]);
    const pathway = parsePathway(data(pathwaySnapshot, "care_pathway_denied", "Care pathway is missing."), {
      workspaceId: enrollment.workspaceId, pathwayId: enrollment.pathwayId,
    });
    if (
      pathway.protocolVersion !== enrollment.pathwayProtocolVersion ||
      pathway.contentHash !== enrollment.pathwayContentHash ||
      pathway.escalationTeamId !== enrollment.teamId ||
      !pathway.eligibleLocationIds.includes(enrollment.locationId)
    ) return fail("care_pathway_denied", "Care enrollment is not pinned to the approved pathway and patient scope.");
    assertPathwaySecret(data(pathwaySecretSnapshot, "care_pathway_denied", "Care pathway secret is missing."), pathway);
    const activationSnapshot = await get(transaction, input.db.doc(`${base}/${CARE_COLLECTIONS.activations}/post_discharge`));
    const activation = parseActivation(data(activationSnapshot, "care_activation_denied", "Care activation is missing."), pathway);
    const activationEventSnapshot = await get(transaction, input.db.doc(`${base}/${CARE_COLLECTIONS.pathwayEvents}/${activation.activationEventId}`));
    const activationEventRevision = assertActivationEvent(data(activationEventSnapshot, "care_activation_denied", "Care activation event is missing."), activation);
    const activationAuditSnapshot = await get(transaction, input.db.doc(`${base}/auditEvents/${activation.activationAuditEventId}`));
    assertAudit(data(activationAuditSnapshot, "care_activation_denied", "Care activation audit is missing."), {
      id: activation.activationAuditEventId, workspaceId: activation.workspaceId,
      actorUid: activation.activatedByUid, action: "care_pathway.activate", resourceType: "care_pathway",
      resourceId: pathway.id, occurredAt: activation.activatedAt,
      metadata: {
        eventId: activation.activationEventId, revision: activationEventRevision,
        synthetic: true, externalDispatchCount: 0, networkCallCount: 0,
      },
    });
    assertReceipt(data(receiptSnapshot, "care_receipt_denied", "Care enrollment receipt is missing."), {
      enrollment, secret: enrollmentSecret, pathway, activation,
    });
    await assertCurrentEnrollmentEvidence({ db: input.db, transaction, base, enrollment });
    if (enrollmentSecret.qualifyingDischargeAt > enrollment.createdAt) {
      return fail("care_schedule_denied", "Qualifying discharge cannot follow enrollment creation.");
    }
    const expectedCurrentContactAt = scheduledContactAt(pathway, enrollmentSecret.qualifyingDischargeAt, enrollment.nextContactIndex);
    const terminal = enrollment.state === "completed" || enrollment.state === "ended";
    if (
      (!terminal && (expectedCurrentContactAt === null || enrollment.nextContactAt?.getTime() !== expectedCurrentContactAt.getTime())) ||
      (terminal && enrollment.nextContactAt !== null)
    ) return fail("care_schedule_denied", "Care contact schedule does not match the immutable discharge anchor.");

    const contactId = resolveSyntheticProtectedRef(enrollmentSecret.protectedContactRef, "contact");
    const conversationId = resolveSyntheticProtectedRef(enrollmentSecret.protectedConversationRef, "conversation");
    resolveSyntheticProtectedRef(enrollmentSecret.protectedQualifyingDischargeRef, "discharge");
    const [contactSnapshot, conversationSnapshot, teamSnapshot, locationSnapshot] = await Promise.all([
      get(transaction, input.db.doc(`${base}/contacts/${contactId}`)),
      get(transaction, input.db.doc(`${base}/conversations/${conversationId}`)),
      get(transaction, input.db.doc(`${base}/teams/${enrollment.teamId}`)),
      get(transaction, input.db.doc(`${base}/locations/${enrollment.locationId}`)),
    ]);
    const contact = parseSyntheticContact(data(contactSnapshot, "contact_gate_denied", "Care contact is missing."), {
      workspaceId: enrollment.workspaceId, contactId, teamId: enrollment.teamId, locationId: enrollment.locationId,
    });
    const conversation = parseSyntheticConversation(data(conversationSnapshot, "conversation_gate_denied", "Care conversation is missing."), {
      workspaceId: enrollment.workspaceId, conversationId, contactId, teamId: enrollment.teamId, locationId: enrollment.locationId,
    });
    assertSyntheticTeam(teamSnapshot.data(), {
      workspaceId: enrollment.workspaceId, teamId: enrollment.teamId, locationId: enrollment.locationId,
    });
    assertSyntheticLocation(locationSnapshot.data(), { workspaceId: enrollment.workspaceId, locationId: enrollment.locationId });

    if (idempotencySnapshot.exists) {
      const stored = parsePhase5Idempotency(idempotencySnapshot.data(), {
        id: idempotencyId, workspaceId: enrollment.workspaceId, actorUid: authorization.uid,
        action: actionName, purpose: "care_pathway", requestHash, aggregateId: enrollment.id,
        resultParser: (value) => parseStoredResult(value, enrollment.id),
      });
      const [eventSnapshot, secretSnapshot, auditSnapshot] = await Promise.all([
        get(transaction, input.db.doc(`${base}/${CARE_COLLECTIONS.enrollmentEvents}/${stored.eventId}`)),
        get(transaction, input.db.doc(`${base}/${CARE_COLLECTIONS.enrollmentEventSecrets}/${stored.eventId}`)),
        get(transaction, input.db.doc(`${base}/auditEvents/${stored.auditEventId}`)),
      ]);
      const references = assertReplay({
        eventValue: data(eventSnapshot, "idempotency_conflict", "Care replay event is missing."),
        secretValue: data(secretSnapshot, "idempotency_conflict", "Care replay secret is missing."),
        auditValue: data(auditSnapshot, "idempotency_conflict", "Care replay audit is missing."),
        enrollment, request, result: stored.result, auditEventId: stored.auditEventId,
        actorUid: authorization.uid, idempotencyId,
      });
      if (references.escalationId !== null) {
        const [escalationSnapshot, escalationSecretSnapshot] = await Promise.all([
          get(transaction, input.db.doc(`${base}/${CARE_COLLECTIONS.escalations}/${references.escalationId}`)),
          get(transaction, input.db.doc(`${base}/${CARE_COLLECTIONS.escalationSecrets}/${references.escalationId}`)),
        ]);
        const escalation = parseEscalation(data(escalationSnapshot, "idempotency_conflict", "Replay escalation is missing."), enrollment, references.escalationId);
        assertEscalationSecret(data(escalationSecretSnapshot, "idempotency_conflict", "Replay escalation secret is missing."), enrollment, escalation);
      }
      if (references.handoffId !== null) {
        const handoffSnapshot = await get(transaction, input.db.doc(`${base}/${CARE_COLLECTIONS.handoffs}/${references.handoffId}`));
        parseHandoff(data(handoffSnapshot, "idempotency_conflict", "Replay handoff is missing."), enrollment, references.handoffId);
      }
      return { result: stored.result, auditEventId: stored.auditEventId, replayed: true };
    }

    if (enrollment.revision !== request.expectedRevision) throw new FailClosedError("care_revision_conflict", "Care enrollment revision changed.");
    if (request.action === "start" || request.action === "advance_contact") {
      if (contact.suppressAll || contact.invalidContact || enrollment.activeSuppressions.length > 0) {
        return fail("care_contact_denied", "Care contact is blocked by current suppression evidence.");
      }
      if (conversation.mode !== "automation") return fail("care_contact_denied", "Care contact is blocked by human takeover or safety hold.");
      const consentQuery = input.db.collection(`${base}/consentRecords`)
        .where("contactId", "==", contactId)
        .where("teamId", "==", enrollment.teamId)
        .where("locationId", "==", enrollment.locationId)
        .where("purpose", "==", "care_pathway")
        .where("channel", "==", "whatsapp")
        .where("category", "==", "utility")
        .orderBy("capturedAt", "desc")
        .limit(2);
      const consentSnapshot = await transaction.get(consentQuery);
      assertLatestSyntheticConsent(consentSnapshot.docs.map((document) => document.data()), {
        workspaceId: enrollment.workspaceId, contactId, teamId: enrollment.teamId,
        locationId: enrollment.locationId, purpose: "care_pathway",
      });
      if (request.action === "advance_contact") {
        const point = pathway.contactPoints[enrollment.nextContactIndex];
        if (!point) return fail("care_schedule_denied", "Approved contact point is missing.");
        const binding = point[contact.preferredLanguage];
        const templateSnapshot = await get(transaction, input.db.doc(`${base}/templates/${binding.templateVersionId}`));
        assertSyntheticTemplate(data(templateSnapshot, "template_binding_denied", "Care template is missing."), {
          workspaceId: enrollment.workspaceId, templateId: binding.templateVersionId,
          contentHash: binding.contentHash, category: "utility", language: contact.preferredLanguage,
        });
      }
    }

    const nextRevision = enrollment.revision + 1;
    const eventId = deterministicId("care-event", `${enrollment.workspaceId}:${enrollment.id}:${nextRevision}:${request.action}:${request.idempotencyKey}`);
    const createdEscalationId = deterministicId("care-escalation", `${enrollment.workspaceId}:${enrollment.id}:${eventId}`);
    const createdHandoffId = deterministicId("care-handoff", `${enrollment.workspaceId}:${enrollment.id}:${eventId}`);
    let plan = planCare({ enrollment, pathway, action: request.action, suppressionReason: request.suppressionReason, now, createdEscalationId, createdHandoffId });
    if (plan.state !== "completed" && plan.state !== "ended") {
      const due = scheduledContactAt(pathway, enrollmentSecret.qualifyingDischargeAt, plan.nextContactIndex);
      if (due === null) return fail("care_schedule_denied", "Non-terminal care state requires an approved next contact.");
      plan = { ...plan, nextContactAt: due };
    }
    const eventEscalationId = plan.escalationMode === "create"
      ? createdEscalationId
      : plan.escalationMode === "touch_resolved"
        ? enrollment.safetyHoldEscalationId
        : plan.escalationMode === "none" ? null : enrollment.openEscalationId;
    const eventHandoffId = plan.handoffMode === "create"
      ? createdHandoffId
      : plan.handoffMode === "release" ? enrollment.openHandoffId : null;
    const eventRef = input.db.doc(`${base}/${CARE_COLLECTIONS.enrollmentEvents}/${eventId}`);
    const eventSecretRef = input.db.doc(`${base}/${CARE_COLLECTIONS.enrollmentEventSecrets}/${eventId}`);
    const escalationRef = eventEscalationId ? input.db.doc(`${base}/${CARE_COLLECTIONS.escalations}/${eventEscalationId}`) : null;
    const escalationSecretRef = eventEscalationId ? input.db.doc(`${base}/${CARE_COLLECTIONS.escalationSecrets}/${eventEscalationId}`) : null;
    const handoffRef = eventHandoffId ? input.db.doc(`${base}/${CARE_COLLECTIONS.handoffs}/${eventHandoffId}`) : null;
    const [eventCollision, eventSecretCollision, escalationSnapshot, escalationSecretSnapshot, handoffSnapshot] = await Promise.all([
      get(transaction, eventRef), get(transaction, eventSecretRef),
      escalationRef ? get(transaction, escalationRef) : Promise.resolve(null),
      escalationSecretRef ? get(transaction, escalationSecretRef) : Promise.resolve(null),
      handoffRef ? get(transaction, handoffRef) : Promise.resolve(null),
    ]);
    if (eventCollision.exists || eventSecretCollision.exists) throw new FailClosedError("care_event_collision", "Deterministic care event already exists without replay evidence.");
    let existingEscalation: StoredEscalation | null = null;
    if (eventEscalationId !== null) {
      if (plan.escalationMode === "create") {
        if (escalationSnapshot?.exists || escalationSecretSnapshot?.exists) throw new FailClosedError("care_escalation_collision", "Deterministic escalation already exists.");
      } else {
        existingEscalation = parseEscalation(data(escalationSnapshot!, "care_escalation_denied", "Care escalation is missing."), enrollment, eventEscalationId);
        assertEscalationSecret(data(escalationSecretSnapshot!, "care_escalation_denied", "Care escalation secret is missing."), enrollment, existingEscalation);
      }
    }
    let existingHandoff: StoredHandoff | null = null;
    if (eventHandoffId !== null) {
      if (plan.handoffMode === "create") {
        if (handoffSnapshot?.exists) throw new FailClosedError("care_handoff_collision", "Deterministic handoff already exists.");
      } else {
        existingHandoff = parseHandoff(data(handoffSnapshot!, "care_handoff_denied", "Care handoff is missing."), enrollment, eventHandoffId);
        if (existingHandoff.state !== "open") return fail("care_handoff_denied", "Only an open handoff may be released.");
      }
    }
    if (plan.escalationMode === "acknowledge" && existingEscalation?.state !== "open") return fail("care_escalation_denied", "Only an open escalation may be acknowledged.");
    if (plan.escalationMode === "resolve" && existingEscalation?.state !== "acknowledged") return fail("care_escalation_denied", "Escalation must be acknowledged before resolution.");
    if (plan.escalationMode === "touch_resolved" && existingEscalation?.state !== "resolved") return fail("care_escalation_denied", "Safety clearance must bind a resolved escalation.");

    const nextEnrollment: StoredEnrollment = {
      ...enrollment, state: plan.state, nextContactIndex: plan.nextContactIndex,
      nextContactAt: plan.nextContactAt, activeSuppressions: plan.suppressions,
      openEscalationId: plan.openEscalationId, safetyHoldEscalationId: plan.safetyHoldEscalationId,
      openHandoffId: plan.openHandoffId, revision: nextRevision, outcomeCode: plan.outcomeCode,
      lastEventId: eventId, updatedAt: now,
    };
    const escalationStateBefore = existingEscalation?.state ?? null;
    const escalationStateAfter = plan.escalationMode === "create" ? "open"
      : plan.escalationMode === "acknowledge" ? "acknowledged"
        : plan.escalationMode === "resolve" ? "resolved"
          : existingEscalation?.state ?? null;
    const result = resultFor(nextEnrollment, eventId, request.action);
    const auditEvent = createTenantAuditEvent({
      tenantId: enrollment.workspaceId, actor: { type: "user", id: authorization.uid },
      action: actionName, resource: { type: "care_enrollment", id: enrollment.id },
      outcome: "allowed", requestId: idempotencyId, occurredAt: now,
      metadata: {
        eventId, fromState: enrollment.state, toState: nextEnrollment.state,
        revision: nextRevision, outcomeCode: nextEnrollment.outcomeCode,
        resultFingerprint: careResultFingerprint(result),
        synthetic: true, externalDispatchCount: 0, networkCallCount: 0,
      },
    });
    const fingerprint = careEventFingerprint({
      workspaceId: enrollment.workspaceId, enrollmentId: enrollment.id, eventId,
      pathwayId: enrollment.pathwayId, pathwayProtocolVersion: enrollment.pathwayProtocolVersion,
      pathwayContentHash: enrollment.pathwayContentHash, teamId: enrollment.teamId,
      locationId: enrollment.locationId, revision: nextRevision, auditEventId: auditEvent.id,
      action: request.action, fromState: enrollment.state, toState: nextEnrollment.state,
      contactPointIndex: plan.contactPointIndex, suppressionReason: request.suppressionReason,
      escalationId: eventEscalationId, escalationStateBefore, escalationStateAfter,
      handoffId: eventHandoffId, activeSuppressionsAfter: nextEnrollment.activeSuppressions,
      nextContactAt: nextEnrollment.nextContactAt, outcomeCode: nextEnrollment.outcomeCode,
      occurredAt: now, actorUid: authorization.uid,
    });
    const auditRef = input.db.doc(`${base}/auditEvents/${auditEvent.id}`);
    const auditCollision = await get(transaction, auditRef);
    if (auditCollision.exists) throw new FailClosedError("care_audit_collision", "Deterministic care audit already exists.");

    transaction.update(refs.enrollment, {
      state: nextEnrollment.state, nextContactIndex: nextEnrollment.nextContactIndex,
      nextContactAt: nextEnrollment.nextContactAt, activeSuppressions: [...nextEnrollment.activeSuppressions],
      openEscalationId: nextEnrollment.openEscalationId,
      safetyHoldEscalationId: nextEnrollment.safetyHoldEscalationId,
      openHandoffId: nextEnrollment.openHandoffId, revision: nextRevision,
      outcomeCode: nextEnrollment.outcomeCode, lastEventId: eventId, updatedAt: now,
    });
    transaction.create(eventRef, {
      id: eventId, workspaceId: enrollment.workspaceId, enrollmentId: enrollment.id,
      pathwayId: enrollment.pathwayId, pathwayProtocolVersion: enrollment.pathwayProtocolVersion,
      pathwayContentHash: enrollment.pathwayContentHash, teamId: enrollment.teamId,
      locationId: enrollment.locationId, revision: nextRevision, auditEventId: auditEvent.id,
      action: request.action, fromState: enrollment.state, toState: nextEnrollment.state,
      contactPointIndex: plan.contactPointIndex, suppressionReason: request.suppressionReason,
      escalationId: eventEscalationId, escalationStateBefore, escalationStateAfter,
      handoffId: eventHandoffId, activeSuppressionsAfter: [...nextEnrollment.activeSuppressions],
      nextContactAt: nextEnrollment.nextContactAt, outcomeCode: nextEnrollment.outcomeCode,
      occurredAt: now, schemaVersion: 1, synthetic: true, externalDispatchCount: 0,
      networkCallCount: 0, actorKind: "staff", actorUid: authorization.uid,
    });
    transaction.create(eventSecretRef, {
      workspaceId: enrollment.workspaceId, enrollmentId: enrollment.id, eventId,
      protectedContextRef: phase5EventProtectedRef("care", eventId), contextFingerprint: fingerprint,
      schemaVersion: 1, synthetic: true,
    });

    if (escalationRef && eventEscalationId) {
      if (plan.escalationMode === "create") {
        const writeBackState = pathway.writeBackRequired ? "pending" : "not_required";
        transaction.create(escalationRef, {
          id: eventEscalationId, workspaceId: enrollment.workspaceId, enrollmentId: enrollment.id,
          pathwayId: enrollment.pathwayId, pathwayProtocolVersion: enrollment.pathwayProtocolVersion,
          pathwayContentHash: enrollment.pathwayContentHash, teamId: enrollment.teamId,
          locationId: enrollment.locationId, reasonCode: "red_flag_response", state: "open",
          openedAt: now, responseSlaMinutes: pathway.responseSlaMinutes,
          responseDueAt: new Date(now.getTime() + pathway.responseSlaMinutes * 60_000),
          openedBy: { actorKind: "staff", actorUid: authorization.uid },
          acknowledgedAt: null, acknowledgedByUid: null, resolvedAt: null, resolvedByUid: null,
          resolutionCode: null, writeBackRequired: pathway.writeBackRequired, writeBackState,
          revision: 1, lastEventId: eventId, schemaVersion: 1, synthetic: true,
          externalDispatchCount: 0, networkCallCount: 0, createdAt: now, updatedAt: now,
        });
        transaction.create(escalationSecretRef!, {
          workspaceId: enrollment.workspaceId, enrollmentId: enrollment.id, escalationId: eventEscalationId,
          protectedContextRef: phase5EscalationProtectedRef(eventEscalationId),
          contextFingerprint: sha256Hex(JSON.stringify([enrollment.workspaceId, enrollment.id, eventEscalationId, "red_flag_response"])),
          schemaVersion: 1, synthetic: true,
        });
      } else if (existingEscalation) {
        const update: Record<string, unknown> = {
          revision: existingEscalation.revision + 1, lastEventId: eventId, updatedAt: now,
        };
        if (plan.escalationMode === "acknowledge") {
          update.state = "acknowledged"; update.acknowledgedAt = now; update.acknowledgedByUid = authorization.uid;
        } else if (plan.escalationMode === "resolve") {
          update.state = "resolved"; update.resolvedAt = now; update.resolvedByUid = authorization.uid;
          update.resolutionCode = nextEnrollment.state === "ended" ? "terminal_suppression_applied" : "safety_hold_applied";
          update.writeBackState = pathway.writeBackRequired ? "unavailable_in_demo" : "not_required";
        }
        transaction.update(escalationRef, update);
      }
    }
    if (handoffRef && eventHandoffId) {
      if (plan.handoffMode === "create") {
        transaction.create(handoffRef, {
          id: eventHandoffId, workspaceId: enrollment.workspaceId, enrollmentId: enrollment.id,
          pathwayId: enrollment.pathwayId, pathwayProtocolVersion: enrollment.pathwayProtocolVersion,
          pathwayContentHash: enrollment.pathwayContentHash, teamId: enrollment.teamId,
          locationId: enrollment.locationId, state: "open", openedEventId: eventId,
          openedBy: { actorKind: "staff", actorUid: authorization.uid }, openedAt: now,
          releasedEventId: null, releasedBy: null, releasedAt: null, revision: 1,
          lastEventId: eventId, schemaVersion: 1, synthetic: true, externalDispatchCount: 0,
          networkCallCount: 0, createdAt: now, updatedAt: now,
        });
      } else if (existingHandoff) {
        transaction.update(handoffRef, {
          state: "released", releasedEventId: eventId,
          releasedBy: { actorKind: "staff", actorUid: authorization.uid }, releasedAt: now,
          revision: existingHandoff.revision + 1, lastEventId: eventId, updatedAt: now,
        });
      }
    }
    transaction.create(auditRef, toFirestoreAuditRecord(auditEvent));
    transaction.create(refs.idempotency, {
      id: idempotencyId, workspaceId: enrollment.workspaceId, actorUid: authorization.uid,
      action: actionName, purpose: "care_pathway", requestHash, aggregateId: enrollment.id,
      eventId, result: { ...result, nextContactAt: result.nextContactAt === null ? null : new Date(result.nextContactAt) },
      auditEventId: auditEvent.id, createdAt: now, synthetic: true, schemaVersion: 1,
    });
    return { result, auditEventId: auditEvent.id, replayed: false };
  });
}
