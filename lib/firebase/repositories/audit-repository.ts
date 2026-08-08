import { Timestamp } from "firebase/firestore";
import { z } from "zod";
import {
  AUTOMATION_EXECUTION_STATES,
  AUTOMATION_RUN_ACTIONS,
  CARE_ENROLLMENT_ACTIONS,
  CARE_ENROLLMENT_STATES,
} from "../../domain/automations";
import {
  AI_PERSISTED_SCENARIO_IDS,
  AI_PERSISTED_SCENARIO_MATRIX,
} from "../../domain/ai-governance";

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
const AUTOMATION_ACTIONS = AUTOMATION_RUN_ACTIONS.map(
  (action) => `automation.${action}` as const,
);
const CARE_ENROLLMENT_AUDIT_ACTIONS = CARE_ENROLLMENT_ACTIONS.map(
  (action) => `care_enrollment.${action}` as const,
);
const AUTOMATION_DEFINITION_ACTIONS = [
  "automation_definition.create",
  "automation_definition.request_review",
  "automation_definition.approve",
  "automation_definition.activate",
  "automation_definition.retire",
] as const;
const CARE_PATHWAY_ACTIONS = [
  "care_pathway.create",
  "care_pathway.request_clinical_review",
  "care_pathway.approve",
  "care_pathway.activate",
  "care_pathway.retire",
] as const;
const AI_RETROSPECTIVE_ACTIONS = ["ai.retrospective_evaluation_recorded"] as const;
const AI_RETROSPECTIVE_METADATA_KEYS = [
  "scenarioId",
  "outcome",
  "evaluationScope",
  "synthetic",
  "modelCallCount",
  "providerCallCount",
  "externalDispatchCount",
  "conversationMutationCount",
  "handoffMutationCount",
  "suppressionMutationCount",
] as const;

/**
 * Closed metadata contracts for every currently persisted audit writer family.
 * The public shape is intentionally declarative; validation schemas remain
 * private so callers cannot bypass the canonical parser.
 */
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
    actions: Object.freeze(AUTOMATION_ACTIONS),
    resourceType: "automation_run",
    metadataKeys: Object.freeze([
      "eventId",
      "fromState",
      "toState",
      "revision",
      "outcomeCode",
      "resultFingerprint",
      "synthetic",
      "externalDispatchCount",
      "networkCallCount",
    ] as const),
  }),
  care_enrollment: Object.freeze({
    actions: Object.freeze(CARE_ENROLLMENT_AUDIT_ACTIONS),
    resourceType: "care_enrollment",
    metadataKeys: Object.freeze([
      "eventId",
      "fromState",
      "toState",
      "revision",
      "outcomeCode",
      "resultFingerprint",
      "synthetic",
      "externalDispatchCount",
      "networkCallCount",
    ] as const),
  }),
  automation_definition: Object.freeze({
    actions: AUTOMATION_DEFINITION_ACTIONS,
    resourceType: "automation_definition",
    metadataKeys: Object.freeze([
      "eventId",
      "revision",
      "synthetic",
      "externalDispatchCount",
      "networkCallCount",
    ] as const),
  }),
  care_pathway: Object.freeze({
    actions: CARE_PATHWAY_ACTIONS,
    resourceType: "care_pathway",
    metadataKeys: Object.freeze([
      "eventId",
      "revision",
      "synthetic",
      "externalDispatchCount",
      "networkCallCount",
    ] as const),
  }),
  ai_retrospective: Object.freeze({
    actions: AI_RETROSPECTIVE_ACTIONS,
    resourceType: "ai_retrospective_run",
    metadataKeys: Object.freeze(AI_RETROSPECTIVE_METADATA_KEYS),
  }),
} as const);

export type FirestoreAuditActionFamily = keyof typeof FIRESTORE_AUDIT_METADATA_CONTRACTS;
export type KnownFirestoreAuditAction =
  (typeof FIRESTORE_AUDIT_METADATA_CONTRACTS)[FirestoreAuditActionFamily]["actions"][number];

export const KNOWN_FIRESTORE_AUDIT_ACTIONS = Object.freeze([
  ...INTERNAL_NOTE_ACTIONS,
  ...APPOINTMENT_ACTIONS,
  ...CAMPAIGN_ACTIONS,
  ...AUTOMATION_ACTIONS,
  ...CARE_ENROLLMENT_AUDIT_ACTIONS,
  ...AUTOMATION_DEFINITION_ACTIONS,
  ...CARE_PATHWAY_ACTIONS,
  ...AI_RETROSPECTIVE_ACTIONS,
] satisfies readonly KnownFirestoreAuditAction[]);

export type FirestoreAuditOutcome = "allowed" | "denied" | "failed" | "simulated";
export type FirestoreAuditActorType = "user" | "service" | "system";
export type FirestoreAuditMetadataValue = string | number | boolean | null;

export interface FirestoreAuditRecordV1DTO {
  readonly id: string;
  readonly workspaceId: string;
  readonly actorUid: string;
  readonly actorType: FirestoreAuditActorType;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly outcome: FirestoreAuditOutcome;
  readonly requestId: string;
  readonly occurredAt: string;
  readonly createdAt: string;
  readonly metadata: Readonly<Record<string, FirestoreAuditMetadataValue>>;
  readonly synthetic: true;
  readonly schemaVersion: 1;
}

const SAFE_SUMMARY_CODES = Object.freeze({
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
  "ai.retrospective_evaluation_recorded": "ai_retrospective_evidence_recorded",
} as const satisfies Record<KnownFirestoreAuditAction, string>);

export type ClientSafeAuditSummaryCode =
  | (typeof SAFE_SUMMARY_CODES)[KnownFirestoreAuditAction]
  | "unsupported_event";

export interface ClientSafeAuditEventDTO {
  readonly id: string;
  readonly workspaceId: string;
  readonly occurredAt: string;
  readonly actor: {
    readonly type: FirestoreAuditActorType;
    /** Per-event alias. It is never the durable actorUid. */
    readonly id: string;
  };
  readonly action: KnownFirestoreAuditAction | "unsupported_event";
  readonly resource: {
    readonly type: string;
    /** Per-event alias. It is never the durable resourceId. */
    readonly id: string;
  };
  readonly outcome: FirestoreAuditOutcome;
  readonly safeSummaryCode: ClientSafeAuditSummaryCode;
  readonly synthetic: true;
  readonly schemaVersion: 1;
}

const safeIdentifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Identifier contains unsupported characters");
const actionName = z
  .string()
  .min(3)
  .max(160)
  .regex(
    /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/,
    "Audit action must use a namespaced safe code",
  );
const resourceType = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_-]*$/, "Audit resource type is invalid");
const firestoreTimestamp = z.custom<Timestamp>(
  (value) => value instanceof Timestamp,
  "Expected a native Firestore Timestamp",
);
const auditOutcome = z.enum(["allowed", "denied", "failed", "simulated"]);
const auditActorType = z.enum(["user", "service", "system"]);
const sha256Digest = z.string().regex(/^[0-9a-f]{64}$/, "Expected a lowercase SHA-256 digest");
const revision = z.number().int().min(1).max(1_000_000);
const genericMetadataValue = z.union([
  z.string().max(256),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const genericMetadata = z
  .record(
    z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "Audit metadata keys are invalid"),
    genericMetadataValue,
  )
  .refine((value) => Object.keys(value).length <= 32, "Audit metadata is limited to 32 fields")
  .refine(
    (value) =>
      !Object.keys(value).some((key) =>
        ["constructor", "prototype", "__proto__"].includes(key),
      ),
    "Audit metadata contains a reserved key",
  );

const internalNoteMetadata = z
  .object({
    purpose: z.literal("patient_support"),
    noteKind: z.enum(["handoff_context", "appointment_context", "safety_context"]),
    teamId: safeIdentifier,
    locationId: safeIdentifier,
    synthetic: z.literal(true),
  })
  .strict();

const appointmentMetadata = z
  .object({
    purpose: z.literal("appointment_service"),
    appointmentAction: z.enum(["request_reschedule", "request_cancellation"]),
    fromStatus: z.literal("confirmed"),
    toStatus: z.enum(["reschedule_pending", "cancel_pending"]),
    revision: z.number().int().min(1).max(1_000_000_000),
    teamId: safeIdentifier,
    locationId: safeIdentifier,
    synthetic: z.literal(true),
    authoritativeSystem: z.literal("simulator"),
  })
  .strict();

const campaignMetadata = z
  .object({
    purpose: z.literal("campaign_governance"),
    campaignAction: z.enum([
      "run_canary",
      "start",
      "advance_batch",
      "pause",
      "resume",
      "inject_fault",
      "retry",
      "cancel",
    ]),
    fromState: z.enum(["scheduled", "dispatching", "paused", "completed", "cancelled", "failed"]),
    toState: z.enum(["scheduled", "dispatching", "paused", "completed", "cancelled", "failed"]),
    revision: z.number().int().min(1).max(1_000_000_000),
    checkpointId: safeIdentifier.nullable(),
    batchEligibleCount: z.number().int().min(0).max(1_000),
    processedEligible: z.number().int().min(0).max(50_000),
    scanOffset: z.number().int().min(0).max(50_000),
    dispatchMode: z.literal("simulation"),
    synthetic: z.literal(true),
    externalCalls: z.literal(0),
    networkCalls: z.literal(0),
  })
  .strict();

const automationOutcomeCode = z.enum([
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
const automationMetadata = z
  .object({
    eventId: safeIdentifier,
    fromState: z.enum(AUTOMATION_EXECUTION_STATES),
    toState: z.enum(AUTOMATION_EXECUTION_STATES),
    revision,
    outcomeCode: automationOutcomeCode,
    resultFingerprint: sha256Digest,
    synthetic: z.literal(true),
    externalDispatchCount: z.literal(0),
    networkCallCount: z.literal(0),
  })
  .strict();

const careOutcomeCode = z.enum([
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
const careEnrollmentMetadata = z
  .object({
    eventId: safeIdentifier,
    fromState: z.enum(CARE_ENROLLMENT_STATES),
    toState: z.enum(CARE_ENROLLMENT_STATES),
    revision,
    outcomeCode: careOutcomeCode,
    resultFingerprint: sha256Digest,
    synthetic: z.literal(true),
    externalDispatchCount: z.literal(0),
    networkCallCount: z.literal(0),
  })
  .strict();

const lifecycleMetadata = z
  .object({
    eventId: safeIdentifier,
    revision,
    synthetic: z.literal(true),
    externalDispatchCount: z.literal(0),
    networkCallCount: z.literal(0),
  })
  .strict();

const aiRetrospectiveMetadata = z
  .object({
    scenarioId: z.enum(AI_PERSISTED_SCENARIO_IDS),
    outcome: z.enum([
      "preview_only",
      "safety_hold_already_present",
      "human_takeover_already_present",
      "suppression_already_recorded",
    ]),
    evaluationScope: z.literal("retrospective_synthetic_fixture"),
    synthetic: z.literal(true),
    modelCallCount: z.literal(0),
    providerCallCount: z.literal(0),
    externalDispatchCount: z.literal(0),
    conversationMutationCount: z.literal(0),
    handoffMutationCount: z.literal(0),
    suppressionMutationCount: z.literal(0),
  })
  .strict()
  .refine(
    (value) => value.outcome === AI_PERSISTED_SCENARIO_MATRIX[value.scenarioId].outcome,
    "AI retrospective scenario and outcome are substituted",
  );

const firestoreAuditRecordV1Schema = z
  .object({
    id: safeIdentifier,
    workspaceId: safeIdentifier,
    actorUid: safeIdentifier,
    actorType: auditActorType,
    action: actionName,
    resourceType,
    resourceId: safeIdentifier,
    outcome: auditOutcome,
    requestId: safeIdentifier,
    occurredAt: firestoreTimestamp,
    createdAt: firestoreTimestamp,
    metadata: genericMetadata,
    synthetic: z.literal(true),
    schemaVersion: z.literal(1),
  })
  .strict();

const canonicalIsoDateTime = z.string().refine((value) => {
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}, "Expected a canonical ISO timestamp");

const clientSafeAuditEventSchema = z
  .object({
    id: safeIdentifier,
    workspaceId: safeIdentifier,
    occurredAt: canonicalIsoDateTime,
    actor: z
      .object({
        type: auditActorType,
        id: z.string().min(1).max(160),
      })
      .strict(),
    action: z.string().min(1).max(160),
    resource: z
      .object({
        type: z.string().min(1).max(80),
        id: z.string().min(1).max(160),
      })
      .strict(),
    outcome: auditOutcome,
    safeSummaryCode: z.string().min(1).max(160),
    synthetic: z.literal(true),
    schemaVersion: z.literal(1),
  })
  .strict();

type ParsedFirestoreAuditRecord = z.infer<typeof firestoreAuditRecordV1Schema>;

export class AuditRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_persisted_data" | "invalid_projection",
  ) {
    super(message);
    this.name = "AuditRepositoryError";
  }
}

function actionFamilyFor(action: string): FirestoreAuditActionFamily | null {
  for (const [family, contract] of Object.entries(FIRESTORE_AUDIT_METADATA_CONTRACTS)) {
    if ((contract.actions as readonly string[]).includes(action)) {
      return family as FirestoreAuditActionFamily;
    }
  }
  return null;
}

export function isKnownFirestoreAuditAction(
  action: string,
): action is KnownFirestoreAuditAction {
  return actionFamilyFor(action) !== null;
}

function metadataSchemaForFamily(family: FirestoreAuditActionFamily): z.ZodType {
  if (family === "internal_note") return internalNoteMetadata;
  if (family === "appointment") return appointmentMetadata;
  if (family === "campaign") return campaignMetadata;
  if (family === "automation_run") return automationMetadata;
  if (family === "care_enrollment") return careEnrollmentMetadata;
  if (family === "ai_retrospective") return aiRetrospectiveMetadata;
  return lifecycleMetadata;
}

function assertKnownActionContract(record: ParsedFirestoreAuditRecord): void {
  const family = actionFamilyFor(record.action);
  if (family === null) return;
  const contract = FIRESTORE_AUDIT_METADATA_CONTRACTS[family];
  if (record.resourceType !== contract.resourceType) {
    throw new AuditRepositoryError(
      "Known audit action does not match its exact resource type.",
      "invalid_persisted_data",
    );
  }
  const parsedMetadata = metadataSchemaForFamily(family).safeParse(record.metadata);
  if (!parsedMetadata.success) {
    throw new AuditRepositoryError(
      "Known audit action metadata failed its exact family contract.",
      "invalid_persisted_data",
    );
  }
  if (family === "appointment") {
    const metadata = parsedMetadata.data as z.infer<typeof appointmentMetadata>;
    const expectedAction = `appointment.${metadata.appointmentAction}`;
    const expectedStatus =
      metadata.appointmentAction === "request_reschedule"
        ? "reschedule_pending"
        : "cancel_pending";
    if (record.action !== expectedAction || metadata.toStatus !== expectedStatus) {
      throw new AuditRepositoryError(
        "Appointment audit action and status metadata are substituted.",
        "invalid_persisted_data",
      );
    }
  }
  if (family === "campaign") {
    const metadata = parsedMetadata.data as z.infer<typeof campaignMetadata>;
    if (record.action !== `campaign.${metadata.campaignAction}`) {
      throw new AuditRepositoryError(
        "Campaign audit action metadata is substituted.",
        "invalid_persisted_data",
      );
    }
  }
}

function timestampToIso(value: Timestamp, label: string): string {
  const date = value.toDate();
  if (!Number.isFinite(date.getTime())) {
    throw new AuditRepositoryError(`${label} is not a valid timestamp.`, "invalid_persisted_data");
  }
  return date.toISOString();
}

function assertLosslessIsoTimestamp(value: Timestamp, label: string): void {
  if (value.nanoseconds % 1_000_000 !== 0) {
    throw new AuditRepositoryError(
      `${label} must use millisecond precision for a lossless ISO cursor roundtrip.`,
      "invalid_persisted_data",
    );
  }
}

/** Parse the immutable 14-field FirestoreAuditRecord v1 wire without widening it. */
export function parseFirestoreAuditRecordV1(
  value: unknown,
  expectedDocumentId?: string,
  expectedWorkspaceId?: string,
): FirestoreAuditRecordV1DTO {
  const result = firestoreAuditRecordV1Schema.safeParse(value);
  if (!result.success) {
    throw new AuditRepositoryError(
      "Firestore audit record failed strict v1 validation.",
      "invalid_persisted_data",
    );
  }
  const record = result.data;
  if (
    (expectedDocumentId !== undefined && record.id !== expectedDocumentId) ||
    (expectedWorkspaceId !== undefined && record.workspaceId !== expectedWorkspaceId)
  ) {
    throw new AuditRepositoryError(
      "Firestore audit record does not match its document path.",
      "invalid_persisted_data",
    );
  }
  assertLosslessIsoTimestamp(record.occurredAt, "Firestore audit occurrence time");
  assertLosslessIsoTimestamp(record.createdAt, "Firestore audit creation time");
  if (record.occurredAt.toMillis() !== record.createdAt.toMillis()) {
    throw new AuditRepositoryError(
      "Firestore audit occurrence and creation timestamps must be equal.",
      "invalid_persisted_data",
    );
  }
  assertKnownActionContract(record);
  return {
    ...record,
    occurredAt: timestampToIso(record.occurredAt, "Audit occurrence time"),
    createdAt: timestampToIso(record.createdAt, "Audit creation time"),
  };
}

function eventActorAlias(eventId: string): string {
  return `event_actor:${eventId}`;
}

function eventResourceAlias(eventId: string): string {
  return `event_resource:${eventId}`;
}

/**
 * Produce the only client-list-safe projection. Stable subject identifiers,
 * request identity, metadata and fingerprints are intentionally absent.
 */
export function projectClientSafeAuditEvent(
  record: FirestoreAuditRecordV1DTO,
): ClientSafeAuditEventDTO {
  const known = isKnownFirestoreAuditAction(record.action);
  const action = known ? record.action : "unsupported_event";
  const projection: ClientSafeAuditEventDTO = {
    id: record.id,
    workspaceId: record.workspaceId,
    occurredAt: record.occurredAt,
    actor: {
      type: record.actorType,
      id: eventActorAlias(record.id),
    },
    action,
    resource: {
      type: known ? record.resourceType : "unsupported_event",
      id: eventResourceAlias(record.id),
    },
    outcome: record.outcome,
    safeSummaryCode: known ? SAFE_SUMMARY_CODES[record.action] : "unsupported_event",
    synthetic: true,
    schemaVersion: 1,
  };
  return parseClientSafeAuditEventProjection(projection);
}

/** Strictly validate the callable/repository-safe projection before UI use. */
export function parseClientSafeAuditEventProjection(
  value: unknown,
): ClientSafeAuditEventDTO {
  const result = clientSafeAuditEventSchema.safeParse(value);
  if (!result.success) {
    throw new AuditRepositoryError(
      "Client-safe audit projection failed strict validation.",
      "invalid_projection",
    );
  }
  const projection = result.data;
  if (
    projection.actor.id !== eventActorAlias(projection.id) ||
    projection.resource.id !== eventResourceAlias(projection.id)
  ) {
    throw new AuditRepositoryError(
      "Client-safe audit aliases must be scoped to exactly one event.",
      "invalid_projection",
    );
  }
  if (projection.action === "unsupported_event") {
    if (
      projection.safeSummaryCode !== "unsupported_event" ||
      projection.resource.type !== "unsupported_event"
    ) {
      throw new AuditRepositoryError(
        "Unsupported audit events must remain fully minimized.",
        "invalid_projection",
      );
    }
  } else if (
    !isKnownFirestoreAuditAction(projection.action) ||
    projection.safeSummaryCode !== SAFE_SUMMARY_CODES[projection.action] ||
    projection.resource.type !==
      FIRESTORE_AUDIT_METADATA_CONTRACTS[actionFamilyFor(projection.action)!].resourceType
  ) {
    throw new AuditRepositoryError(
      "Client-safe audit action, resource and summary evidence do not match.",
      "invalid_projection",
    );
  }
  return projection as ClientSafeAuditEventDTO;
}
