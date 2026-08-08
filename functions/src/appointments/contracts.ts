import type { RuntimeConfig } from "../config.js";
import { FailClosedError, assertSafeTenantId } from "../errors.js";
import type { MutationResult } from "../service-kernel.js";

export const SYNTHETIC_APPOINTMENT_REQUEST_ACTIONS = [
  "request_reschedule",
  "request_cancellation",
] as const;

export type SyntheticAppointmentRequestAction =
  (typeof SYNTHETIC_APPOINTMENT_REQUEST_ACTIONS)[number];
export type SyntheticAppointmentPendingStatus =
  | "reschedule_pending"
  | "cancel_pending";

export interface SyntheticAppointmentRequestInput {
  readonly workspaceId: string;
  readonly appointmentId: string;
  readonly teamId: string;
  readonly locationId: string;
  readonly action: SyntheticAppointmentRequestAction;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
}

export interface SyntheticAppointmentRequestResult extends MutationResult {
  readonly appointmentId: string;
  readonly eventId: string;
  readonly action: SyntheticAppointmentRequestAction;
  readonly status: SyntheticAppointmentPendingStatus;
  readonly syncState: "pending";
  readonly authoritativeSystem: "simulator";
  readonly revision: number;
  readonly synthetic: true;
  readonly externalCalls: 0;
}

export interface ParsedSyntheticAppointment {
  readonly id: string;
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly contactId: string;
  readonly teamId: string;
  readonly locationId: string;
  readonly status: "confirmed";
  readonly syncState: "mock";
  readonly revision: number;
  readonly synthetic: true;
  readonly authoritativeSystem: "simulator";
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const IDEMPOTENCY_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{15,127}$/;
const SAFE_STORED_APPOINTMENT_KEYS = Object.freeze([
  "authoritativeSystem",
  "contactId",
  "conversationId",
  "createdAt",
  "externalAppointmentRef",
  "id",
  "lastActionId",
  "lastSyncedAt",
  "locationId",
  "practitionerDisplayLabel",
  "reminderState",
  "revision",
  "schemaVersion",
  "serviceRef",
  "slotEndsAt",
  "slotStartsAt",
  "slotTimeZone",
  "status",
  "syncState",
  "synthetic",
  "teamId",
  "updatedAt",
  "workspaceId",
]);
const SAFE_REMINDER_KEYS = Object.freeze([
  "confirmation",
  "twentyFourHour",
  "twoHour",
]);
const SAFE_REMINDER_STATES = Object.freeze([
  "not_scheduled",
  "scheduled",
  "simulated",
  "cancelled",
  "failed",
]);

function requireExactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FailClosedError("invalid_service_request", "A request object is required.");
  }
  const data = value as Record<string, unknown>;
  const actual = Object.keys(data).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new FailClosedError("invalid_service_request", "Request fields are invalid.");
  }
  return data;
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new FailClosedError("invalid_service_request", `${label} is invalid.`);
  }
  return value;
}

function requireBoundedString(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new FailClosedError("invalid_appointment_record", `${label} is invalid.`);
  }
  return value;
}

function timestampMillis(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (
    value &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof value.toMillis === "function"
  ) {
    const millis = value.toMillis();
    return typeof millis === "number" && Number.isFinite(millis) ? millis : null;
  }
  return null;
}

function requireTimestamp(value: unknown, label: string): void {
  if (timestampMillis(value) === null) {
    throw new FailClosedError("invalid_appointment_record", `${label} is invalid.`);
  }
}

function requireReminderState(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FailClosedError(
      "invalid_appointment_record",
      "Appointment reminder state is invalid.",
    );
  }
  const data = value as Record<string, unknown>;
  const keys = Object.keys(data).sort();
  const expected = [...SAFE_REMINDER_KEYS].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index]) ||
    expected.some(
      (key) =>
        typeof data[key] !== "string" ||
        !SAFE_REMINDER_STATES.includes(data[key] as (typeof SAFE_REMINDER_STATES)[number]),
    )
  ) {
    throw new FailClosedError(
      "invalid_appointment_record",
      "Appointment reminder state is invalid.",
    );
  }
}

export function parseSyntheticAppointmentRequestInput(
  value: unknown,
): SyntheticAppointmentRequestInput {
  const data = requireExactObject(value, [
    "workspaceId",
    "appointmentId",
    "teamId",
    "locationId",
    "action",
    "expectedRevision",
    "idempotencyKey",
  ]);
  const workspaceId = requireId(data.workspaceId, "Workspace ID");
  assertSafeTenantId(workspaceId);
  if (
    typeof data.action !== "string" ||
    !SYNTHETIC_APPOINTMENT_REQUEST_ACTIONS.includes(
      data.action as SyntheticAppointmentRequestAction,
    )
  ) {
    throw new FailClosedError("invalid_service_request", "Appointment action is invalid.");
  }
  if (
    typeof data.expectedRevision !== "number" ||
    !Number.isInteger(data.expectedRevision) ||
    data.expectedRevision < 0 ||
    data.expectedRevision > 999_999_999
  ) {
    throw new FailClosedError(
      "invalid_service_request",
      "Expected appointment revision is invalid.",
    );
  }
  if (
    typeof data.idempotencyKey !== "string" ||
    !IDEMPOTENCY_KEY.test(data.idempotencyKey)
  ) {
    throw new FailClosedError("invalid_service_request", "Idempotency key is invalid.");
  }
  return {
    workspaceId,
    appointmentId: requireId(data.appointmentId, "Appointment ID"),
    teamId: requireId(data.teamId, "Team ID"),
    locationId: requireId(data.locationId, "Location ID"),
    action: data.action as SyntheticAppointmentRequestAction,
    expectedRevision: data.expectedRevision,
    idempotencyKey: data.idempotencyKey,
  };
}

export function pendingStatusForAction(
  action: SyntheticAppointmentRequestAction,
): SyntheticAppointmentPendingStatus {
  if (action === "request_reschedule") return "reschedule_pending";
  if (action === "request_cancellation") return "cancel_pending";
  throw new FailClosedError("invalid_service_request", "Appointment action is invalid.");
}

export function assertSyntheticAppointmentRuntimeBoundary(
  config: RuntimeConfig,
  workspaceId: string,
): void {
  assertSafeTenantId(workspaceId);
  if (
    config.runtimeMode !== "demo" ||
    config.providerMode !== "synthetic" ||
    config.hemasIntegrationMode !== "synthetic" ||
    config.auditSinkMode !== "durable" ||
    config.outboundEnabled ||
    config.diagnosisEnabled ||
    config.defaultTenantId !== workspaceId
  ) {
    throw new FailClosedError(
      "appointment_service_disabled",
      "The synthetic appointment request service is disabled for this runtime.",
    );
  }
}

export function parseStoredSyntheticAppointment(
  value: unknown,
  expected: {
    readonly workspaceId: string;
    readonly appointmentId: string;
    readonly teamId: string;
    readonly locationId: string;
  },
): ParsedSyntheticAppointment {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FailClosedError(
      "appointment_denied",
      "A matching active synthetic simulator appointment is required.",
    );
  }
  const data = value as Record<string, unknown>;
  const keys = Object.keys(data).sort();
  const expectedKeys = [...SAFE_STORED_APPOINTMENT_KEYS].sort();
  const denied = () => {
    throw new FailClosedError(
      "appointment_denied",
      "A matching active synthetic simulator appointment is required.",
    );
  };
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index]) ||
    data.id !== expected.appointmentId ||
    data.workspaceId !== expected.workspaceId ||
    data.teamId !== expected.teamId ||
    data.locationId !== expected.locationId ||
    data.synthetic !== true ||
    data.authoritativeSystem !== "simulator" ||
    data.status !== "confirmed" ||
    data.syncState !== "mock" ||
    data.schemaVersion !== 1 ||
    typeof data.revision !== "number" ||
    !Number.isInteger(data.revision) ||
    data.revision < 0 ||
    data.revision > 999_999_999
  ) {
    denied();
  }
  try {
    const conversationId = requireId(data.conversationId, "Conversation ID");
    const contactId = requireId(data.contactId, "Contact ID");
    requireId(data.serviceRef, "Service reference");
    requireBoundedString(data.externalAppointmentRef, "External appointment reference", 128);
    if (data.practitionerDisplayLabel !== null) {
      requireBoundedString(
        data.practitionerDisplayLabel,
        "Practitioner display label",
        160,
      );
    }
    if (data.slotTimeZone !== "Asia/Colombo") denied();
    requireTimestamp(data.slotStartsAt, "Appointment slot start");
    requireTimestamp(data.slotEndsAt, "Appointment slot end");
    if (
      (timestampMillis(data.slotEndsAt) ?? 0) <=
      (timestampMillis(data.slotStartsAt) ?? 0)
    ) {
      denied();
    }
    requireTimestamp(data.createdAt, "Appointment creation time");
    requireTimestamp(data.updatedAt, "Appointment update time");
    if (data.lastSyncedAt !== null) requireTimestamp(data.lastSyncedAt, "Last sync time");
    if (data.lastActionId !== null) requireId(data.lastActionId, "Last action ID");
    requireReminderState(data.reminderState);
    return {
      id: expected.appointmentId,
      workspaceId: expected.workspaceId,
      conversationId,
      contactId,
      teamId: expected.teamId,
      locationId: expected.locationId,
      status: "confirmed",
      syncState: "mock",
      revision: data.revision as number,
      synthetic: true,
      authoritativeSystem: "simulator",
    };
  } catch (error) {
    if (error instanceof FailClosedError) denied();
    throw error;
  }
}

export function parseStoredAppointmentRequestResult(
  value: unknown,
  expected: {
    readonly appointmentId: string;
    readonly action: SyntheticAppointmentRequestAction;
  },
): SyntheticAppointmentRequestResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FailClosedError("invalid_idempotency_record", "Stored result is invalid.");
  }
  const data = value as Record<string, unknown>;
  const keys = Object.keys(data).sort();
  const expectedKeys = [
    "action",
    "appointmentId",
    "authoritativeSystem",
    "eventId",
    "externalCalls",
    "revision",
    "status",
    "syncState",
    "synthetic",
  ].sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index]) ||
    data.appointmentId !== expected.appointmentId ||
    data.action !== expected.action ||
    typeof data.eventId !== "string" ||
    !SAFE_ID.test(data.eventId) ||
    data.status !== pendingStatusForAction(expected.action) ||
    data.syncState !== "pending" ||
    data.authoritativeSystem !== "simulator" ||
    typeof data.revision !== "number" ||
    !Number.isInteger(data.revision) ||
    data.revision < 1 ||
    data.revision > 1_000_000_000 ||
    data.synthetic !== true ||
    data.externalCalls !== 0
  ) {
    throw new FailClosedError("invalid_idempotency_record", "Stored result is invalid.");
  }
  return data as unknown as SyntheticAppointmentRequestResult;
}
