import { FailClosedError } from "../errors.js";
import { AUTOMATION_EXECUTION_STATES } from "../automations/contracts.js";
import { CARE_ENROLLMENT_STATES } from "../care/contracts.js";
import { Timestamp } from "firebase-admin/firestore";
import {
  AI_AUDIT_METADATA_KEYS,
  AI_GOVERNANCE_ACTION,
  AI_GOVERNANCE_RESOURCE_TYPE,
  AI_PERSISTED_SCENARIO_IDS,
  AI_PERSISTED_SCENARIO_MATRIX,
} from "../ai-governance/contracts.js";

export const COMPLIANCE_AUDIT_OUTCOMES = [
  "allowed",
  "denied",
  "failed",
  "simulated",
] as const;

export type ComplianceAuditOutcome =
  (typeof COMPLIANCE_AUDIT_OUTCOMES)[number];

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const SAFE_ACTION = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/;
const SAFE_RESOURCE_TYPE = /^[a-z][a-z0-9_-]{0,79}$/;
const SAFE_METADATA_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const RESERVED_METADATA_KEYS = new Set(["constructor", "prototype", "__proto__"]);
const SHA256 = /^[a-f0-9]{64}$/;
const FIRESTORE_AUDIT_KEYS = Object.freeze([
  "id",
  "workspaceId",
  "actorUid",
  "actorType",
  "action",
  "resourceType",
  "resourceId",
  "outcome",
  "requestId",
  "occurredAt",
  "createdAt",
  "metadata",
  "synthetic",
  "schemaVersion",
]);

const INTERNAL_NOTE_ACTIONS = ["internal-note.create"] as const;
const APPOINTMENT_ACTIONS = [
  "appointment.request_reschedule",
  "appointment.request_cancellation",
] as const;
const CAMPAIGN_ACTIONS = [
  "campaign.run_canary",
  "campaign.start",
  "campaign.advance_batch",
  "campaign.pause",
  "campaign.resume",
  "campaign.inject_fault",
  "campaign.retry",
  "campaign.cancel",
] as const;
const AUTOMATION_GOVERNANCE_ACTIONS = [
  "automation_definition.create",
  "automation_definition.request_review",
  "automation_definition.approve",
  "automation_definition.activate",
  "automation_definition.retire",
] as const;
const AUTOMATION_ACTIONS = [
  "automation.start",
  "automation.advance_step",
  "automation.pause",
  "automation.resume",
  "automation.simulate_human_takeover",
  "automation.release_human_takeover",
  "automation.exercise_fallback",
  "automation.inject_failure",
  "automation.retry",
  "automation.end",
] as const;
const CARE_GOVERNANCE_ACTIONS = [
  "care_pathway.create",
  "care_pathway.request_clinical_review",
  "care_pathway.approve",
  "care_pathway.activate",
  "care_pathway.retire",
] as const;
const CARE_ACTIONS = [
  "care_enrollment.start",
  "care_enrollment.advance_contact",
  "care_enrollment.pause",
  "care_enrollment.resume",
  "care_enrollment.end",
  "care_enrollment.simulate_suppression",
  "care_enrollment.human_takeover_started",
  "care_enrollment.release_human_takeover",
  "care_enrollment.clear_clinical_hold",
  "care_enrollment.raise_red_flag",
  "care_enrollment.acknowledge_escalation",
  "care_enrollment.resolve_escalation",
  "care_enrollment.clear_safety_hold",
] as const;
const AI_RETROSPECTIVE_ACTIONS = [AI_GOVERNANCE_ACTION] as const;

export const KNOWN_FIRESTORE_AUDIT_ACTIONS = Object.freeze([
  ...INTERNAL_NOTE_ACTIONS,
  ...APPOINTMENT_ACTIONS,
  ...CAMPAIGN_ACTIONS,
  ...AUTOMATION_ACTIONS,
  ...CARE_ACTIONS,
  ...AUTOMATION_GOVERNANCE_ACTIONS,
  ...CARE_GOVERNANCE_ACTIONS,
  ...AI_RETROSPECTIVE_ACTIONS,
]);

export type KnownComplianceAuditAction =
  (typeof KNOWN_FIRESTORE_AUDIT_ACTIONS)[number];

export const COMPLIANCE_SAFE_SUMMARY_BY_ACTION = Object.freeze({
  "internal-note.create": "internal_note_created",
  "appointment.request_reschedule": "appointment_reschedule_requested",
  "appointment.request_cancellation": "appointment_cancellation_requested",
  "campaign.run_canary": "campaign_canary_run",
  "campaign.start": "campaign_started",
  "campaign.advance_batch": "campaign_batch_advanced",
  "campaign.pause": "campaign_paused",
  "campaign.resume": "campaign_resumed",
  "campaign.inject_fault": "campaign_fault_injected",
  "campaign.retry": "campaign_retry_requested",
  "campaign.cancel": "campaign_cancelled",
  "automation.start": "automation_started",
  "automation.advance_step": "automation_step_advanced",
  "automation.pause": "automation_paused",
  "automation.resume": "automation_resumed",
  "automation.simulate_human_takeover": "automation_human_takeover_started",
  "automation.release_human_takeover": "automation_human_takeover_released",
  "automation.exercise_fallback": "automation_fallback_exercised",
  "automation.inject_failure": "automation_failure_injected",
  "automation.retry": "automation_retry_requested",
  "automation.end": "automation_ended",
  "care_enrollment.start": "care_enrollment_started",
  "care_enrollment.advance_contact": "care_contact_advanced",
  "care_enrollment.pause": "care_enrollment_paused",
  "care_enrollment.resume": "care_enrollment_resumed",
  "care_enrollment.end": "care_enrollment_ended",
  "care_enrollment.simulate_suppression": "care_suppression_simulated",
  "care_enrollment.human_takeover_started": "care_human_takeover_started",
  "care_enrollment.release_human_takeover": "care_human_takeover_released",
  "care_enrollment.clear_clinical_hold": "care_clinical_hold_cleared",
  "care_enrollment.raise_red_flag": "care_red_flag_raised",
  "care_enrollment.acknowledge_escalation": "care_escalation_acknowledged",
  "care_enrollment.resolve_escalation": "care_escalation_resolved",
  "care_enrollment.clear_safety_hold": "care_safety_hold_cleared",
  "automation_definition.create": "automation_definition_created",
  "automation_definition.request_review": "automation_definition_review_requested",
  "automation_definition.approve": "automation_definition_approved",
  "automation_definition.activate": "automation_definition_activated",
  "automation_definition.retire": "automation_definition_retired",
  "care_pathway.create": "care_pathway_created",
  "care_pathway.request_clinical_review": "care_pathway_clinical_review_requested",
  "care_pathway.approve": "care_pathway_approved",
  "care_pathway.activate": "care_pathway_activated",
  "care_pathway.retire": "care_pathway_retired",
  [AI_GOVERNANCE_ACTION]: "ai_retrospective_evidence_recorded",
} as const satisfies Record<KnownComplianceAuditAction, string>);

export type ComplianceSafeSummaryCode =
  | (typeof COMPLIANCE_SAFE_SUMMARY_BY_ACTION)[KnownComplianceAuditAction]
  | "unsupported_event";

export type ComplianceAuditScalar = string | number | boolean | null;

export interface FirestoreAuditRecordV1 {
  readonly id: string;
  readonly workspaceId: string;
  readonly actorUid: string;
  readonly actorType: "user" | "service" | "system";
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly outcome: ComplianceAuditOutcome;
  readonly requestId: string;
  readonly occurredAt: Date;
  readonly createdAt: Date;
  readonly metadata: Readonly<Record<string, ComplianceAuditScalar>>;
  readonly synthetic: true;
  readonly schemaVersion: 1;
}

export interface ComplianceAuditCursor {
  readonly createdAt: string;
  readonly id: string;
}

export interface ListComplianceAuditEventsInput {
  readonly workspaceId: string;
  readonly outcome: ComplianceAuditOutcome | null;
  readonly pageSize: number;
  readonly cursor: ComplianceAuditCursor | null;
}

export interface ClientSafeComplianceAuditEvent {
  readonly id: string;
  readonly workspaceId: string;
  readonly occurredAt: string;
  readonly actor: {
    readonly type: FirestoreAuditRecordV1["actorType"];
    readonly id: string;
  };
  readonly action: KnownComplianceAuditAction | "unsupported_event";
  readonly resource: {
    readonly type: string;
    readonly id: string;
  };
  readonly outcome: ComplianceAuditOutcome;
  readonly safeSummaryCode: ComplianceSafeSummaryCode;
  readonly synthetic: true;
  readonly schemaVersion: 1;
}

export interface ListComplianceAuditEventsResult {
  readonly events: readonly ClientSafeComplianceAuditEvent[];
  readonly nextCursor: ComplianceAuditCursor | null;
}

type MetadataContract = {
  readonly resourceType: string;
  readonly keys: readonly string[];
};

const GOVERNANCE_METADATA_KEYS = Object.freeze([
  "eventId",
  "revision",
  "synthetic",
  "externalDispatchCount",
  "networkCallCount",
]);
const RUNTIME_METADATA_KEYS = Object.freeze([
  "eventId",
  "fromState",
  "toState",
  "revision",
  "outcomeCode",
  "resultFingerprint",
  "synthetic",
  "externalDispatchCount",
  "networkCallCount",
]);
export const FIRESTORE_AUDIT_METADATA_CONTRACTS = Object.freeze({
  internal_note: Object.freeze({
    actions: INTERNAL_NOTE_ACTIONS,
    resourceType: "internal-note",
    metadataKeys: Object.freeze([
      "purpose",
      "noteKind",
      "teamId",
      "locationId",
      "synthetic",
    ] as const),
  }),
  appointment: Object.freeze({
    actions: APPOINTMENT_ACTIONS,
    resourceType: "appointment",
    metadataKeys: Object.freeze([
      "purpose",
      "appointmentAction",
      "fromStatus",
      "toStatus",
      "revision",
      "teamId",
      "locationId",
      "synthetic",
      "authoritativeSystem",
    ] as const),
  }),
  campaign: Object.freeze({
    actions: CAMPAIGN_ACTIONS,
    resourceType: "campaign",
    metadataKeys: Object.freeze([
      "purpose",
      "campaignAction",
      "fromState",
      "toState",
      "revision",
      "checkpointId",
      "batchEligibleCount",
      "processedEligible",
      "scanOffset",
      "dispatchMode",
      "synthetic",
      "externalCalls",
      "networkCalls",
    ] as const),
  }),
  automation_run: Object.freeze({
    actions: AUTOMATION_ACTIONS,
    resourceType: "automation_run",
    metadataKeys: RUNTIME_METADATA_KEYS,
  }),
  care_enrollment: Object.freeze({
    actions: CARE_ACTIONS,
    resourceType: "care_enrollment",
    metadataKeys: RUNTIME_METADATA_KEYS,
  }),
  automation_definition: Object.freeze({
    actions: AUTOMATION_GOVERNANCE_ACTIONS,
    resourceType: "automation_definition",
    metadataKeys: GOVERNANCE_METADATA_KEYS,
  }),
  care_pathway: Object.freeze({
    actions: CARE_GOVERNANCE_ACTIONS,
    resourceType: "care_pathway",
    metadataKeys: GOVERNANCE_METADATA_KEYS,
  }),
  ai_retrospective: Object.freeze({
    actions: AI_RETROSPECTIVE_ACTIONS,
    resourceType: AI_GOVERNANCE_RESOURCE_TYPE,
    metadataKeys: AI_AUDIT_METADATA_KEYS,
  }),
} as const);
const AUTOMATION_OUTCOME_CODES = Object.freeze([
  "accepted",
  "step_completed",
  "wait_scheduled",
  "human_takeover_required",
  "fallback_work_item_created",
  "fallback_stopped_safely",
  "retry_scheduled",
  "completed",
  "ended_by_operator",
  "synthetic_failure",
]);
const CARE_OUTCOME_CODES = Object.freeze([
  "accepted",
  "contact_advanced",
  "suppressed_terminal",
  "clinical_hold_applied",
  "human_takeover_required",
  "red_flag_escalated",
  "escalation_acknowledged",
  "escalation_resolved_safety_hold",
  "escalation_resolved_terminal_suppression",
  "safety_hold_cleared",
  "completed",
  "ended_by_operator",
]);

function metadataContractForAction(action: string): MetadataContract | null {
  if (INTERNAL_NOTE_ACTIONS.includes(action as never)) {
    return {
      resourceType: "internal-note",
      keys: ["locationId", "noteKind", "purpose", "synthetic", "teamId"],
    };
  }
  if (APPOINTMENT_ACTIONS.includes(action as never)) {
    return {
      resourceType: "appointment",
      keys: [
        "purpose",
        "appointmentAction",
        "fromStatus",
        "toStatus",
        "revision",
        "teamId",
        "locationId",
        "synthetic",
        "authoritativeSystem",
      ],
    };
  }
  if (CAMPAIGN_ACTIONS.includes(action as never)) {
    return {
      resourceType: "campaign",
      keys: [
        "purpose",
        "campaignAction",
        "fromState",
        "toState",
        "revision",
        "checkpointId",
        "batchEligibleCount",
        "processedEligible",
        "scanOffset",
        "dispatchMode",
        "synthetic",
        "externalCalls",
        "networkCalls",
      ],
    };
  }
  if (AUTOMATION_GOVERNANCE_ACTIONS.includes(action as never)) {
    return {
      resourceType: "automation_definition",
      keys: GOVERNANCE_METADATA_KEYS,
    };
  }
  if (AUTOMATION_ACTIONS.includes(action as never)) {
    return {
      resourceType: "automation_run",
      keys: RUNTIME_METADATA_KEYS,
    };
  }
  if (CARE_GOVERNANCE_ACTIONS.includes(action as never)) {
    return {
      resourceType: "care_pathway",
      keys: GOVERNANCE_METADATA_KEYS,
    };
  }
  if (CARE_ACTIONS.includes(action as never)) {
    return {
      resourceType: "care_enrollment",
      keys: RUNTIME_METADATA_KEYS,
    };
  }
  if (AI_RETROSPECTIVE_ACTIONS.includes(action as never)) {
    return {
      resourceType: AI_GOVERNANCE_RESOURCE_TYPE,
      keys: AI_AUDIT_METADATA_KEYS,
    };
  }
  return null;
}

function fail(code: string, message: string): never {
  throw new FailClosedError(code, message);
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
  code = "invalid_compliance_audit",
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail(code, `${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    return fail(code, `${label} fields are invalid.`);
  }
  return record;
}

function requireSafeId(
  value: unknown,
  label: string,
  code = "invalid_compliance_audit",
): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    return fail(code, `${label} is invalid.`);
  }
  return value;
}

function requireAction(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 160 ||
    !SAFE_ACTION.test(value)
  ) {
    return fail("invalid_compliance_audit", "Audit action is invalid.");
  }
  return value;
}

function timestampToDate(value: unknown, label: string): Date {
  if (value instanceof Timestamp) {
    if (value.nanoseconds % 1_000_000 !== 0) {
      return fail(
        "invalid_compliance_audit",
        `${label} must use lossless millisecond precision.`,
      );
    }
    const date = value.toDate();
    if (Number.isFinite(date.getTime())) return date;
  }
  return fail("invalid_compliance_audit", `${label} must be a timestamp.`);
}

function parseMetadata(value: unknown): Readonly<Record<string, ComplianceAuditScalar>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail("invalid_compliance_audit", "Audit metadata must be a map.");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (
    entries.length > 32 ||
    entries.some(
      ([key, item]) =>
        !SAFE_METADATA_KEY.test(key) ||
        RESERVED_METADATA_KEYS.has(key) ||
        !(
          item === null ||
          typeof item === "boolean" ||
          (typeof item === "number" && Number.isFinite(item)) ||
          (typeof item === "string" && item.length <= 256)
        ),
    )
  ) {
    return fail(
      "invalid_compliance_audit",
      "Audit metadata must contain bounded scalar values only.",
    );
  }
  return Object.fromEntries(entries) as Readonly<
    Record<string, ComplianceAuditScalar>
  >;
}

function exactMetadata(
  metadata: Readonly<Record<string, ComplianceAuditScalar>>,
  keys: readonly string[],
): void {
  const actual = Object.keys(metadata).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(
      "invalid_compliance_audit",
      "Known audit action metadata fields are invalid.",
    );
  }
}

function requireLiteral(
  metadata: Readonly<Record<string, ComplianceAuditScalar>>,
  key: string,
  value: ComplianceAuditScalar,
): void {
  if (metadata[key] !== value) {
    fail("invalid_compliance_audit", `Audit metadata ${key} is invalid.`);
  }
}

function requireMetadataId(
  metadata: Readonly<Record<string, ComplianceAuditScalar>>,
  key: string,
  nullable = false,
): void {
  const value = metadata[key];
  if (nullable && value === null) return;
  requireSafeId(value, `Audit metadata ${key}`);
}

function requireMetadataInteger(
  metadata: Readonly<Record<string, ComplianceAuditScalar>>,
  key: string,
  minimum: number,
  maximum: number,
): void {
  const value = metadata[key];
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail("invalid_compliance_audit", `Audit metadata ${key} is invalid.`);
  }
}

function requireOneOf(
  metadata: Readonly<Record<string, ComplianceAuditScalar>>,
  key: string,
  values: readonly string[],
): void {
  if (
    typeof metadata[key] !== "string" ||
    !values.includes(metadata[key] as string)
  ) {
    fail("invalid_compliance_audit", `Audit metadata ${key} is invalid.`);
  }
}

function validateKnownMetadata(
  action: string,
  metadata: Readonly<Record<string, ComplianceAuditScalar>>,
): MetadataContract | null {
  const contract = metadataContractForAction(action);
  if (!contract) return null;
  exactMetadata(metadata, contract.keys);
  requireLiteral(metadata, "synthetic", true);

  if (INTERNAL_NOTE_ACTIONS.includes(action as never)) {
    requireLiteral(metadata, "purpose", "patient_support");
    requireMetadataId(metadata, "teamId");
    requireMetadataId(metadata, "locationId");
    requireOneOf(metadata, "noteKind", [
      "handoff_context",
      "appointment_context",
      "safety_context",
    ]);
    return contract;
  }

  if (APPOINTMENT_ACTIONS.includes(action as never)) {
    requireLiteral(metadata, "purpose", "appointment_service");
    requireLiteral(metadata, "appointmentAction", action.split(".")[1] ?? "");
    requireLiteral(metadata, "fromStatus", "confirmed");
    requireOneOf(metadata, "toStatus", [
      "reschedule_pending",
      "cancel_pending",
    ]);
    const expectedToStatus = action === "appointment.request_reschedule"
      ? "reschedule_pending"
      : "cancel_pending";
    requireLiteral(metadata, "toStatus", expectedToStatus);
    requireMetadataInteger(metadata, "revision", 1, 1_000_000_000);
    requireMetadataId(metadata, "teamId");
    requireMetadataId(metadata, "locationId");
    requireLiteral(metadata, "authoritativeSystem", "simulator");
    return contract;
  }

  if (CAMPAIGN_ACTIONS.includes(action as never)) {
    requireLiteral(metadata, "purpose", "campaign_governance");
    requireLiteral(metadata, "campaignAction", action.split(".")[1] ?? "");
    requireOneOf(metadata, "fromState", [
      "scheduled",
      "dispatching",
      "paused",
      "completed",
      "cancelled",
      "failed",
    ]);
    requireOneOf(metadata, "toState", [
      "scheduled",
      "dispatching",
      "paused",
      "completed",
      "cancelled",
      "failed",
    ]);
    requireMetadataInteger(metadata, "revision", 1, 1_000_000_000);
    requireMetadataId(metadata, "checkpointId", true);
    requireMetadataInteger(metadata, "batchEligibleCount", 0, 1_000);
    requireMetadataInteger(metadata, "processedEligible", 0, 50_000);
    requireMetadataInteger(metadata, "scanOffset", 0, 50_000);
    requireLiteral(metadata, "dispatchMode", "simulation");
    requireLiteral(metadata, "externalCalls", 0);
    requireLiteral(metadata, "networkCalls", 0);
    return contract;
  }

  if (AI_RETROSPECTIVE_ACTIONS.includes(action as never)) {
    requireOneOf(metadata, "scenarioId", AI_PERSISTED_SCENARIO_IDS);
    const scenarioId = metadata.scenarioId as (typeof AI_PERSISTED_SCENARIO_IDS)[number];
    requireLiteral(metadata, "outcome", AI_PERSISTED_SCENARIO_MATRIX[scenarioId].outcome);
    requireLiteral(metadata, "evaluationScope", "retrospective_synthetic_fixture");
    for (const key of [
      "modelCallCount",
      "providerCallCount",
      "externalDispatchCount",
      "conversationMutationCount",
      "handoffMutationCount",
      "suppressionMutationCount",
    ]) {
      requireLiteral(metadata, key, 0);
    }
    return contract;
  }

  if (
    AUTOMATION_GOVERNANCE_ACTIONS.includes(action as never) ||
    CARE_GOVERNANCE_ACTIONS.includes(action as never)
  ) {
    requireMetadataId(metadata, "eventId");
    requireMetadataInteger(metadata, "revision", 1, 1_000_000);
    requireLiteral(metadata, "externalDispatchCount", 0);
    requireLiteral(metadata, "networkCallCount", 0);
    return contract;
  }

  requireMetadataId(metadata, "eventId");
  requireMetadataInteger(metadata, "revision", 1, 1_000_000);
  if (AUTOMATION_ACTIONS.includes(action as never)) {
    requireOneOf(metadata, "fromState", AUTOMATION_EXECUTION_STATES);
    requireOneOf(metadata, "toState", AUTOMATION_EXECUTION_STATES);
    requireOneOf(metadata, "outcomeCode", AUTOMATION_OUTCOME_CODES);
  } else {
    requireOneOf(metadata, "fromState", CARE_ENROLLMENT_STATES);
    requireOneOf(metadata, "toState", CARE_ENROLLMENT_STATES);
    requireOneOf(metadata, "outcomeCode", CARE_OUTCOME_CODES);
  }
  if (
    typeof metadata.resultFingerprint !== "string" ||
    !SHA256.test(metadata.resultFingerprint)
  ) {
    fail(
      "invalid_compliance_audit",
      "Audit metadata resultFingerprint is invalid.",
    );
  }
  requireLiteral(metadata, "externalDispatchCount", 0);
  requireLiteral(metadata, "networkCallCount", 0);
  return contract;
}

export function parseFirestoreAuditRecordV1(
  value: unknown,
  expectedDocumentId?: string,
  expectedWorkspaceId?: string,
): FirestoreAuditRecordV1 {
  const record = exactRecord(value, FIRESTORE_AUDIT_KEYS, "Audit record");
  const id = requireSafeId(record.id, "Audit ID");
  const workspaceId = requireSafeId(record.workspaceId, "Audit workspace ID");
  const actorUid = requireSafeId(record.actorUid, "Audit actor UID");
  const actorType = record.actorType;
  const action = requireAction(record.action);
  const resourceType = record.resourceType;
  const resourceId = requireSafeId(record.resourceId, "Audit resource ID");
  const outcome = record.outcome;
  const requestId = requireSafeId(record.requestId, "Audit request ID");
  const occurredAt = timestampToDate(record.occurredAt, "Audit occurredAt");
  const createdAt = timestampToDate(record.createdAt, "Audit createdAt");
  const metadata = parseMetadata(record.metadata);
  if (typeof resourceType !== "string" || !SAFE_RESOURCE_TYPE.test(resourceType)) {
    fail("invalid_compliance_audit", "Audit resource type is invalid.");
  }
  if (expectedDocumentId !== undefined && id !== expectedDocumentId) {
    fail("invalid_compliance_audit", "Audit document ID does not match its path.");
  }
  if (expectedWorkspaceId !== undefined && workspaceId !== expectedWorkspaceId) {
    fail("invalid_compliance_audit", "Audit workspace does not match its path.");
  }
  if (!(["user", "service", "system"] as const).includes(actorType as never)) {
    fail("invalid_compliance_audit", "Audit actor type is invalid.");
  }
  if (!COMPLIANCE_AUDIT_OUTCOMES.includes(outcome as never)) {
    fail("invalid_compliance_audit", "Audit outcome is invalid.");
  }
  if (record.synthetic !== true || record.schemaVersion !== 1) {
    fail("invalid_compliance_audit", "Only synthetic audit schema v1 is supported.");
  }
  if (occurredAt.getTime() !== createdAt.getTime()) {
    fail(
      "invalid_compliance_audit",
      "Audit creation time must equal occurrence time.",
    );
  }
  const contract = validateKnownMetadata(action, metadata);
  if (contract && resourceType !== contract.resourceType) {
    fail(
      "invalid_compliance_audit",
      "Known audit action does not match its resource type.",
    );
  }
  return {
    id,
    workspaceId,
    actorUid,
    actorType: actorType as FirestoreAuditRecordV1["actorType"],
    action,
    resourceType,
    resourceId,
    outcome: outcome as ComplianceAuditOutcome,
    requestId,
    occurredAt,
    createdAt,
    metadata,
    synthetic: true,
    schemaVersion: 1,
  };
}

function isCanonicalIso(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

export function parseListComplianceAuditEventsInput(
  value: unknown,
): ListComplianceAuditEventsInput {
  const record = exactRecord(
    value,
    ["workspaceId", "outcome", "pageSize", "cursor"],
    "Compliance audit request",
    "invalid_compliance_request",
  );
  const workspaceId = requireSafeId(
    record.workspaceId,
    "Workspace ID",
    "invalid_compliance_request",
  );
  const outcome = record.outcome;
  if (
    outcome !== null &&
    !COMPLIANCE_AUDIT_OUTCOMES.includes(outcome as never)
  ) {
    fail("invalid_compliance_request", "Audit outcome filter is invalid.");
  }
  if (
    typeof record.pageSize !== "number" ||
    !Number.isInteger(record.pageSize) ||
    record.pageSize < 1 ||
    record.pageSize > 50
  ) {
    fail("invalid_compliance_request", "Audit page size must be from 1 to 50.");
  }
  let cursor: ComplianceAuditCursor | null = null;
  if (record.cursor !== null) {
    const parsedCursor = exactRecord(
      record.cursor,
      ["createdAt", "id"],
      "Compliance audit cursor",
      "invalid_compliance_request",
    );
    if (
      typeof parsedCursor.createdAt !== "string" ||
      !isCanonicalIso(parsedCursor.createdAt)
    ) {
      fail("invalid_compliance_request", "Audit cursor timestamp is invalid.");
    }
    cursor = {
      createdAt: parsedCursor.createdAt,
      id: requireSafeId(
        parsedCursor.id,
        "Audit cursor ID",
        "invalid_compliance_request",
      ),
    };
  }
  return {
    workspaceId,
    outcome: outcome as ComplianceAuditOutcome | null,
    pageSize: record.pageSize,
    cursor,
  };
}

export function projectClientSafeComplianceAuditEvent(
  record: FirestoreAuditRecordV1,
): ClientSafeComplianceAuditEvent {
  const contract = metadataContractForAction(record.action);
  const supported = contract !== null;
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    occurredAt: record.occurredAt.toISOString(),
    actor: {
      type: record.actorType,
      id: `event_actor:${record.id}`,
    },
    action: supported
      ? (record.action as KnownComplianceAuditAction)
      : "unsupported_event",
    resource: {
      type: supported ? record.resourceType : "unsupported_event",
      id: `event_resource:${record.id}`,
    },
    outcome: record.outcome,
    safeSummaryCode: supported
      ? COMPLIANCE_SAFE_SUMMARY_BY_ACTION[
          record.action as KnownComplianceAuditAction
        ]
      : "unsupported_event",
    synthetic: true,
    schemaVersion: 1,
  };
}

export function parseClientSafeComplianceAuditEvent(
  value: unknown,
  expectedWorkspaceId?: string,
  expectedOutcome?: ComplianceAuditOutcome | null,
): ClientSafeComplianceAuditEvent {
  const record = exactRecord(
    value,
    [
      "id",
      "workspaceId",
      "occurredAt",
      "actor",
      "action",
      "resource",
      "outcome",
      "safeSummaryCode",
      "synthetic",
      "schemaVersion",
    ],
    "Client-safe audit event",
    "invalid_compliance_projection",
  );
  const id = requireSafeId(
    record.id,
    "Client-safe audit event ID",
    "invalid_compliance_projection",
  );
  const workspaceId = requireSafeId(
    record.workspaceId,
    "Client-safe audit workspace ID",
    "invalid_compliance_projection",
  );
  if (expectedWorkspaceId !== undefined && workspaceId !== expectedWorkspaceId) {
    fail("invalid_compliance_projection", "Audit projection workspace is invalid.");
  }
  if (typeof record.occurredAt !== "string" || !isCanonicalIso(record.occurredAt)) {
    fail("invalid_compliance_projection", "Audit projection timestamp is invalid.");
  }
  const actor = exactRecord(
    record.actor,
    ["type", "id"],
    "Audit projection actor",
    "invalid_compliance_projection",
  );
  if (!( ["user", "service", "system"] as const).includes(actor.type as never)) {
    fail("invalid_compliance_projection", "Audit projection actor type is invalid.");
  }
  if (actor.id !== `event_actor:${id}`) {
    fail("invalid_compliance_projection", "Audit projection actor alias is invalid.");
  }
  const resource = exactRecord(
    record.resource,
    ["type", "id"],
    "Audit projection resource",
    "invalid_compliance_projection",
  );
  if (resource.id !== `event_resource:${id}`) {
    fail("invalid_compliance_projection", "Audit projection resource alias is invalid.");
  }
  if (!COMPLIANCE_AUDIT_OUTCOMES.includes(record.outcome as never)) {
    fail("invalid_compliance_projection", "Audit projection outcome is invalid.");
  }
  if (expectedOutcome !== undefined && expectedOutcome !== null && record.outcome !== expectedOutcome) {
    fail("invalid_compliance_projection", "Audit projection outcome filter is invalid.");
  }
  const action = record.action;
  if (action === "unsupported_event") {
    if (
      resource.type !== "unsupported_event" ||
      record.safeSummaryCode !== "unsupported_event"
    ) {
      fail("invalid_compliance_projection", "Unsupported audit projection is invalid.");
    }
  } else {
    if (
      typeof action !== "string" ||
      !KNOWN_FIRESTORE_AUDIT_ACTIONS.includes(action as never)
    ) {
      fail("invalid_compliance_projection", "Audit projection action is invalid.");
    }
    const contract = metadataContractForAction(action);
    if (
      !contract ||
      resource.type !== contract.resourceType ||
      record.safeSummaryCode !==
        COMPLIANCE_SAFE_SUMMARY_BY_ACTION[action as KnownComplianceAuditAction]
    ) {
      fail("invalid_compliance_projection", "Audit projection evidence is inconsistent.");
    }
  }
  if (record.synthetic !== true || record.schemaVersion !== 1) {
    fail("invalid_compliance_projection", "Audit projection schema is invalid.");
  }
  return {
    id,
    workspaceId,
    occurredAt: record.occurredAt,
    actor: {
      type: actor.type as FirestoreAuditRecordV1["actorType"],
      id: actor.id as string,
    },
    action: action as KnownComplianceAuditAction | "unsupported_event",
    resource: {
      type: resource.type as string,
      id: resource.id as string,
    },
    outcome: record.outcome as ComplianceAuditOutcome,
    safeSummaryCode: record.safeSummaryCode as ComplianceSafeSummaryCode,
    synthetic: true,
    schemaVersion: 1,
  };
}

export function parseListComplianceAuditEventsResult(
  value: unknown,
  expectedWorkspaceId?: string,
  expectedOutcome?: ComplianceAuditOutcome | null,
): ListComplianceAuditEventsResult {
  const record = exactRecord(
    value,
    ["events", "nextCursor"],
    "Compliance audit response",
    "invalid_compliance_projection",
  );
  if (!Array.isArray(record.events) || record.events.length > 50) {
    fail("invalid_compliance_projection", "Audit response events are invalid.");
  }
  const events = record.events.map((event) =>
    parseClientSafeComplianceAuditEvent(
      event,
      expectedWorkspaceId,
      expectedOutcome,
    ),
  );
  if (new Set(events.map((event) => event.id)).size !== events.length) {
    fail("invalid_compliance_projection", "Audit response event IDs must be unique.");
  }
  let nextCursor: ComplianceAuditCursor | null = null;
  if (record.nextCursor !== null) {
    const parsedCursor = exactRecord(
      record.nextCursor,
      ["createdAt", "id"],
      "Compliance audit response cursor",
      "invalid_compliance_projection",
    );
    if (
      typeof parsedCursor.createdAt !== "string" ||
      !isCanonicalIso(parsedCursor.createdAt)
    ) {
      fail("invalid_compliance_projection", "Audit response cursor time is invalid.");
    }
    nextCursor = {
      createdAt: parsedCursor.createdAt,
      id: requireSafeId(
        parsedCursor.id,
        "Audit response cursor ID",
        "invalid_compliance_projection",
      ),
    };
    const last = events.at(-1);
    if (
      !last ||
      last.id !== nextCursor.id ||
      last.occurredAt !== nextCursor.createdAt
    ) {
      fail("invalid_compliance_projection", "Audit response cursor is not page-bound.");
    }
  }
  return { events, nextCursor };
}
