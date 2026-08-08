import type {
  DocumentData,
  Firestore,
  Transaction,
} from "firebase-admin/firestore";
import { createTenantAuditEvent } from "../audit.js";
import { toFirestoreAuditRecord } from "../audit-firestore.js";
import type { RuntimeConfig } from "../config.js";
import { deterministicId } from "../deterministic.js";
import { FailClosedError } from "../errors.js";
import {
  assertWorkspaceAuthorization,
  fingerprintServiceRequest,
  idempotencyDocumentId,
  type AuthenticatedActor,
} from "../service-kernel.js";
import {
  assertSyntheticAppointmentRuntimeBoundary,
  parseStoredAppointmentRequestResult,
  parseStoredSyntheticAppointment,
  parseSyntheticAppointmentRequestInput,
  pendingStatusForAction,
  type SyntheticAppointmentRequestAction,
  type SyntheticAppointmentRequestInput,
  type SyntheticAppointmentRequestResult,
} from "./contracts.js";

export interface SyntheticAppointmentRequestResponse {
  readonly result: SyntheticAppointmentRequestResult;
  readonly auditEventId: string;
  readonly replayed: boolean;
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const APPOINTMENT_EVENT_KEYS = Object.freeze([
  "action",
  "actionId",
  "actorUid",
  "appointmentId",
  "contactId",
  "conversationId",
  "createdAt",
  "fromStatus",
  "id",
  "locationId",
  "revision",
  "schemaVersion",
  "source",
  "synthetic",
  "teamId",
  "toStatus",
  "workspaceId",
]);
const APPOINTMENT_RECORD_KEYS = Object.freeze([
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
const AUDIT_RECORD_KEYS = Object.freeze([
  "action",
  "actorType",
  "actorUid",
  "createdAt",
  "id",
  "metadata",
  "occurredAt",
  "outcome",
  "requestId",
  "resourceId",
  "resourceType",
  "schemaVersion",
  "synthetic",
  "workspaceId",
]);
const AUDIT_METADATA_KEYS = Object.freeze([
  "appointmentAction",
  "authoritativeSystem",
  "fromStatus",
  "locationId",
  "purpose",
  "revision",
  "synthetic",
  "teamId",
  "toStatus",
]);
const IDEMPOTENCY_RECORD_KEYS = Object.freeze([
  "action",
  "actorUid",
  "auditEventId",
  "createdAt",
  "eventId",
  "id",
  "purpose",
  "requestHash",
  "result",
  "schemaVersion",
  "synthetic",
  "workspaceId",
]);
const REMINDER_STATE_KEYS = Object.freeze([
  "confirmation",
  "twentyFourHour",
  "twoHour",
]);
const REMINDER_STATES = Object.freeze([
  "not_scheduled",
  "scheduled",
  "simulated",
  "cancelled",
  "failed",
]);

function actionName(action: SyntheticAppointmentRequestAction): string {
  return `appointment.${action}`;
}

function hasExactKeys(value: DocumentData, expectedKeys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function timestampMillis(value: unknown): number | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() : null;
  }
  if (
    value &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof value.toMillis === "function"
  ) {
    try {
      const millis = value.toMillis();
      return typeof millis === "number" && Number.isFinite(millis) ? millis : null;
    } catch {
      return null;
    }
  }
  return null;
}

function isBoundedText(value: unknown, maxLength: number): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function hasValidReminderState(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const reminder = value as DocumentData;
  return (
    hasExactKeys(reminder, REMINDER_STATE_KEYS) &&
    REMINDER_STATE_KEYS.every(
      (key) =>
        typeof reminder[key] === "string" &&
        REMINDER_STATES.includes(reminder[key] as (typeof REMINDER_STATES)[number]),
    )
  );
}

function assertSyntheticWorkspace(value: DocumentData | undefined, workspaceId: string): void {
  if (
    !value ||
    value.id !== workspaceId ||
    value.status !== "active" ||
    value.mode !== "demo" ||
    value.dataClassification !== "synthetic_only"
  ) {
    throw new FailClosedError(
      "workspace_denied",
      "An active synthetic demo workspace is required.",
    );
  }
}

function assertActiveRoute(input: {
  readonly workspaceId: string;
  readonly teamId: string;
  readonly locationId: string;
  readonly team: DocumentData | undefined;
  readonly location: DocumentData | undefined;
}): void {
  const locationIds = input.team?.locationIds;
  if (
    !input.team ||
    input.team.id !== input.teamId ||
    input.team.workspaceId !== input.workspaceId ||
    input.team.active !== true ||
    !Array.isArray(locationIds) ||
    locationIds.length < 1 ||
    locationIds.length > 50 ||
    locationIds.some((value) => typeof value !== "string" || !SAFE_ID.test(value)) ||
    !locationIds.includes(input.locationId) ||
    !input.location ||
    input.location.id !== input.locationId ||
    input.location.workspaceId !== input.workspaceId ||
    input.location.active !== true
  ) {
    throw new FailClosedError(
      "scope_denied",
      "An active authorized team and location route is required.",
    );
  }
}

function assertStoredEvent(input: {
  readonly value: DocumentData | undefined;
  readonly request: SyntheticAppointmentRequestInput;
  readonly actorUid: string;
  readonly eventId: string;
  readonly result: SyntheticAppointmentRequestResult;
  readonly conversationId: string;
  readonly contactId: string;
  readonly occurredAtMillis: number;
}): void {
  const value = input.value;
  if (
    !value ||
    !hasExactKeys(value, APPOINTMENT_EVENT_KEYS) ||
    value.id !== input.eventId ||
    value.actionId !== input.eventId ||
    value.workspaceId !== input.request.workspaceId ||
    value.appointmentId !== input.request.appointmentId ||
    value.conversationId !== input.conversationId ||
    value.contactId !== input.contactId ||
    value.teamId !== input.request.teamId ||
    value.locationId !== input.request.locationId ||
    value.actorUid !== input.actorUid ||
    value.action !== input.request.action ||
    value.fromStatus !== "confirmed" ||
    value.toStatus !== input.result.status ||
    value.revision !== input.result.revision ||
    value.source !== "authenticated_client" ||
    value.synthetic !== true ||
    value.schemaVersion !== 1 ||
    timestampMillis(value.createdAt) !== input.occurredAtMillis
  ) {
    throw new FailClosedError(
      "idempotency_conflict",
      "Stored appointment request evidence does not match this replay.",
    );
  }
}

function assertReplayedAppointment(input: {
  readonly value: DocumentData | undefined;
  readonly request: SyntheticAppointmentRequestInput;
  readonly result: SyntheticAppointmentRequestResult;
  readonly occurredAtMillis: number;
}): { readonly conversationId: string; readonly contactId: string } {
  const value = input.value;
  const createdAtMillis = timestampMillis(value?.createdAt);
  const slotStartsAtMillis = timestampMillis(value?.slotStartsAt);
  const slotEndsAtMillis = timestampMillis(value?.slotEndsAt);
  const lastSyncedAtMillis =
    value?.lastSyncedAt === null ? null : timestampMillis(value?.lastSyncedAt);
  if (
    !value ||
    !hasExactKeys(value, APPOINTMENT_RECORD_KEYS) ||
    value.id !== input.request.appointmentId ||
    value.workspaceId !== input.request.workspaceId ||
    value.teamId !== input.request.teamId ||
    value.locationId !== input.request.locationId ||
    value.status !== input.result.status ||
    value.syncState !== "pending" ||
    value.revision !== input.result.revision ||
    value.lastActionId !== input.result.eventId ||
    value.synthetic !== true ||
    value.authoritativeSystem !== "simulator" ||
    value.schemaVersion !== 1 ||
    typeof value.conversationId !== "string" ||
    !SAFE_ID.test(value.conversationId) ||
    typeof value.contactId !== "string" ||
    !SAFE_ID.test(value.contactId) ||
    typeof value.serviceRef !== "string" ||
    !SAFE_ID.test(value.serviceRef) ||
    !isBoundedText(value.externalAppointmentRef, 128) ||
    (value.practitionerDisplayLabel !== null &&
      !isBoundedText(value.practitionerDisplayLabel, 160)) ||
    value.slotTimeZone !== "Asia/Colombo" ||
    slotStartsAtMillis === null ||
    slotEndsAtMillis === null ||
    slotEndsAtMillis <= slotStartsAtMillis ||
    !hasValidReminderState(value.reminderState) ||
    createdAtMillis === null ||
    (value.lastSyncedAt !== null && lastSyncedAtMillis === null) ||
    timestampMillis(value.updatedAt) !== input.occurredAtMillis
  ) {
    throw new FailClosedError(
      "idempotency_conflict",
      "Stored appointment state does not match this replay.",
    );
  }
  return {
    conversationId: value.conversationId,
    contactId: value.contactId,
  };
}

function assertStoredAudit(input: {
  readonly value: DocumentData | undefined;
  readonly request: SyntheticAppointmentRequestInput;
  readonly actorUid: string;
  readonly action: string;
  readonly idempotencyId: string;
  readonly auditEventId: string;
  readonly result: SyntheticAppointmentRequestResult;
  readonly occurredAtMillis: number;
}): void {
  const value = input.value;
  const metadata = value?.metadata;
  if (
    !value ||
    !hasExactKeys(value, AUDIT_RECORD_KEYS) ||
    value.id !== input.auditEventId ||
    value.workspaceId !== input.request.workspaceId ||
    value.actorUid !== input.actorUid ||
    value.actorType !== "user" ||
    value.action !== input.action ||
    value.resourceType !== "appointment" ||
    value.resourceId !== input.request.appointmentId ||
    value.outcome !== "allowed" ||
    value.requestId !== input.idempotencyId ||
    value.synthetic !== true ||
    value.schemaVersion !== 1 ||
    timestampMillis(value.occurredAt) !== input.occurredAtMillis ||
    timestampMillis(value.createdAt) !== input.occurredAtMillis ||
    !metadata ||
    typeof metadata !== "object" ||
    Array.isArray(metadata) ||
    !hasExactKeys(metadata as DocumentData, AUDIT_METADATA_KEYS) ||
    metadata.purpose !== "appointment_service" ||
    metadata.appointmentAction !== input.request.action ||
    metadata.fromStatus !== "confirmed" ||
    metadata.toStatus !== input.result.status ||
    metadata.revision !== input.result.revision ||
    metadata.teamId !== input.request.teamId ||
    metadata.locationId !== input.request.locationId ||
    metadata.synthetic !== true ||
    metadata.authoritativeSystem !== "simulator"
  ) {
    throw new FailClosedError(
      "idempotency_conflict",
      "Durable appointment audit evidence does not match this replay.",
    );
  }
}

async function replayExistingRequest(input: {
  readonly db: Firestore;
  readonly transaction: Transaction;
  readonly idempotency: DocumentData;
  readonly appointment: DocumentData | undefined;
  readonly event: DocumentData | undefined;
  readonly request: SyntheticAppointmentRequestInput;
  readonly actorUid: string;
  readonly action: string;
  readonly requestHash: string;
  readonly idempotencyId: string;
  readonly eventId: string;
}): Promise<SyntheticAppointmentRequestResponse> {
  const stored = input.idempotency;
  const occurredAtMillis = timestampMillis(stored.createdAt);
  if (
    !hasExactKeys(stored, IDEMPOTENCY_RECORD_KEYS) ||
    stored.id !== input.idempotencyId ||
    stored.workspaceId !== input.request.workspaceId ||
    stored.actorUid !== input.actorUid ||
    stored.action !== input.action ||
    stored.purpose !== "appointment_service" ||
    stored.requestHash !== input.requestHash ||
    stored.eventId !== input.eventId ||
    stored.synthetic !== true ||
    stored.schemaVersion !== 1 ||
    occurredAtMillis === null ||
    typeof stored.auditEventId !== "string" ||
    !SAFE_ID.test(stored.auditEventId)
  ) {
    throw new FailClosedError(
      "idempotency_conflict",
      "The idempotency key is already bound to another appointment request.",
    );
  }
  const result = parseStoredAppointmentRequestResult(stored.result, {
    appointmentId: input.request.appointmentId,
    action: input.request.action,
  });
  if (
    result.eventId !== input.eventId ||
    result.revision !== input.request.expectedRevision + 1
  ) {
    throw new FailClosedError(
      "idempotency_conflict",
      "Stored appointment request evidence does not match this replay.",
    );
  }
  const appointmentEvidence = assertReplayedAppointment({
    value: input.appointment,
    request: input.request,
    result,
    occurredAtMillis,
  });
  assertStoredEvent({
    value: input.event,
    request: input.request,
    actorUid: input.actorUid,
    eventId: input.eventId,
    result,
    conversationId: appointmentEvidence.conversationId,
    contactId: appointmentEvidence.contactId,
    occurredAtMillis,
  });
  const auditSnapshot = await input.transaction.get(
    input.db.doc(
      `workspaces/${input.request.workspaceId}/auditEvents/${stored.auditEventId}`,
    ),
  );
  assertStoredAudit({
    value: auditSnapshot.data(),
    request: input.request,
    actorUid: input.actorUid,
    action: input.action,
    idempotencyId: input.idempotencyId,
    auditEventId: stored.auditEventId,
    result,
    occurredAtMillis,
  });
  return { result, auditEventId: stored.auditEventId, replayed: true };
}

export async function requestSyntheticAppointmentAction(rawInput: {
  readonly db: Firestore;
  readonly config: RuntimeConfig;
  readonly actor: AuthenticatedActor;
  readonly request: SyntheticAppointmentRequestInput;
  readonly now?: Date;
}): Promise<SyntheticAppointmentRequestResponse> {
  const parsedRequest = parseSyntheticAppointmentRequestInput(rawInput.request);
  const input = { ...rawInput, request: parsedRequest };
  assertSyntheticAppointmentRuntimeBoundary(input.config, input.request.workspaceId);
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new FailClosedError("invalid_service_request", "Request time is invalid.");
  }
  const action = actionName(input.request.action);
  const requestHash = fingerprintServiceRequest({
    workspaceId: input.request.workspaceId,
    appointmentId: input.request.appointmentId,
    teamId: input.request.teamId,
    locationId: input.request.locationId,
    action: input.request.action,
    expectedRevision: input.request.expectedRevision,
  });
  const idempotencyId = idempotencyDocumentId({
    workspaceId: input.request.workspaceId,
    uid: input.actor.uid,
    action,
    key: input.request.idempotencyKey,
  });
  const eventId = deterministicId("appointment-event", idempotencyId);

  const workspaceRef = input.db.doc(`workspaces/${input.request.workspaceId}`);
  const membershipRef = input.db.doc(
    `workspaces/${input.request.workspaceId}/members/${input.actor.uid}`,
  );
  const teamRef = input.db.doc(
    `workspaces/${input.request.workspaceId}/teams/${input.request.teamId}`,
  );
  const locationRef = input.db.doc(
    `workspaces/${input.request.workspaceId}/locations/${input.request.locationId}`,
  );
  const appointmentRef = input.db.doc(
    `workspaces/${input.request.workspaceId}/appointments/${input.request.appointmentId}`,
  );
  const eventRef = input.db.doc(
    `workspaces/${input.request.workspaceId}/appointmentEvents/${eventId}`,
  );
  const idempotencyRef = input.db.doc(
    `workspaces/${input.request.workspaceId}/idempotencyKeys/${idempotencyId}`,
  );

  return input.db.runTransaction(async (transaction) => {
    const [
      workspaceSnapshot,
      membershipSnapshot,
      teamSnapshot,
      locationSnapshot,
      appointmentSnapshot,
      eventSnapshot,
      idempotencySnapshot,
    ] = await Promise.all([
      transaction.get(workspaceRef),
      transaction.get(membershipRef),
      transaction.get(teamRef),
      transaction.get(locationRef),
      transaction.get(appointmentRef),
      transaction.get(eventRef),
      transaction.get(idempotencyRef),
    ]);

    const workspace = workspaceSnapshot.data();
    assertSyntheticWorkspace(workspace, input.request.workspaceId);
    const context = assertWorkspaceAuthorization({
      workspaceId: input.request.workspaceId,
      actor: input.actor,
      workspace,
      membership: membershipSnapshot.data(),
      policy: {
        allowedRoles: ["tenant_admin", "supervisor", "agent"],
        patientScope: {
          teamId: input.request.teamId,
          locationId: input.request.locationId,
        },
        recentAuthMaxAgeSeconds: 3_600,
      },
      now,
    });
    assertActiveRoute({
      workspaceId: input.request.workspaceId,
      teamId: input.request.teamId,
      locationId: input.request.locationId,
      team: teamSnapshot.data(),
      location: locationSnapshot.data(),
    });

    if (idempotencySnapshot.exists) {
      return replayExistingRequest({
        db: input.db,
        transaction,
        idempotency: idempotencySnapshot.data() ?? {},
        appointment: appointmentSnapshot.data(),
        event: eventSnapshot.data(),
        request: input.request,
        actorUid: context.uid,
        action,
        requestHash,
        idempotencyId,
        eventId,
      });
    }
    if (eventSnapshot.exists) {
      throw new FailClosedError(
        "appointment_event_collision",
        "The deterministic appointment event ID is already in use.",
      );
    }

    const appointment = parseStoredSyntheticAppointment(appointmentSnapshot.data(), {
      workspaceId: input.request.workspaceId,
      appointmentId: input.request.appointmentId,
      teamId: input.request.teamId,
      locationId: input.request.locationId,
    });
    if (appointment.revision !== input.request.expectedRevision) {
      throw new FailClosedError(
        "appointment_revision_conflict",
        "The appointment changed since this request was prepared.",
      );
    }

    const status = pendingStatusForAction(input.request.action);
    const revision = appointment.revision + 1;
    const result: SyntheticAppointmentRequestResult = {
      appointmentId: appointment.id,
      eventId,
      action: input.request.action,
      status,
      syncState: "pending",
      authoritativeSystem: "simulator",
      revision,
      synthetic: true,
      externalCalls: 0,
    };
    const auditEvent = createTenantAuditEvent({
      tenantId: input.request.workspaceId,
      actor: { type: "user", id: context.uid },
      action,
      resource: { type: "appointment", id: appointment.id },
      outcome: "allowed",
      requestId: idempotencyId,
      occurredAt: now,
      metadata: {
        purpose: "appointment_service",
        appointmentAction: input.request.action,
        fromStatus: "confirmed",
        toStatus: status,
        revision,
        teamId: input.request.teamId,
        locationId: input.request.locationId,
        synthetic: true,
        authoritativeSystem: "simulator",
      },
    });
    const auditRef = input.db.doc(
      `workspaces/${input.request.workspaceId}/auditEvents/${auditEvent.id}`,
    );

    transaction.update(appointmentRef, {
      status,
      syncState: "pending",
      revision,
      lastActionId: eventId,
      updatedAt: now,
    });
    transaction.create(eventRef, {
      id: eventId,
      workspaceId: input.request.workspaceId,
      appointmentId: appointment.id,
      conversationId: appointment.conversationId,
      contactId: appointment.contactId,
      teamId: input.request.teamId,
      locationId: input.request.locationId,
      actionId: eventId,
      actorUid: context.uid,
      action: input.request.action,
      fromStatus: "confirmed",
      toStatus: status,
      revision,
      source: "authenticated_client",
      synthetic: true,
      schemaVersion: 1,
      createdAt: now,
    });
    transaction.create(auditRef, toFirestoreAuditRecord(auditEvent));
    transaction.create(idempotencyRef, {
      id: idempotencyId,
      workspaceId: input.request.workspaceId,
      actorUid: context.uid,
      action,
      purpose: "appointment_service",
      requestHash,
      eventId,
      result,
      auditEventId: auditEvent.id,
      createdAt: now,
      synthetic: true,
      schemaVersion: 1,
    });
    return { result, auditEventId: auditEvent.id, replayed: false };
  });
}
