/** Pure idempotency contracts for Lite booking-status notifications. */

export const LITE_BOOKING_OPERATIONS_COLLECTION = "canary_booking_operations";
export const LITE_BOOKING_RECONCILIATIONS_COLLECTION =
  "canary_booking_reconciliations";
export const LITE_BOOKING_SEND_STALE_MS = 5 * 60 * 1_000;

export class LiteBookingOperationError extends Error {
  constructor(
    readonly code:
      | "invalid_operation"
      | "operation_conflict"
      | "operation_in_progress"
      | "operation_uncertain"
      | "invalid_evidence"
      | "reconciliation_conflict"
      | "status_already_applied",
    message: string,
  ) {
    super(message);
    this.name = "LiteBookingOperationError";
  }
}

export function assertBookingOperationId(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!/^booking_[A-Za-z0-9_-]{16,64}$/.test(value)) {
    throw new LiteBookingOperationError("invalid_operation", "Booking operation id is invalid.");
  }
  return value;
}

/** Different operation ids cannot notify the same already-applied transition. */
export function assertBookingTransitionCanReserve(
  currentStatus: unknown,
  targetStatus: "confirmed" | "cancelled",
): void {
  if (currentStatus === targetStatus) {
    throw new LiteBookingOperationError(
      "status_already_applied",
      "This booking status transition is already applied.",
    );
  }
}

export function bookingOperationDocumentId(
  operationId: string,
  sha256Hex: (value: string) => string,
): string {
  return `booking_op_${sha256Hex(`lite-booking-operation:${operationId}`).slice(0, 24)}`;
}

export function bookingReconciliationDocumentId(
  operationId: string,
  outcome: "sent" | "not_sent",
  providerEvidenceSha256: string,
  sha256Hex: (value: string) => string,
): string {
  return `booking_reconcile_${sha256Hex(
    `lite-booking-reconciliation:${operationId}:${outcome}:${providerEvidenceSha256}`,
  ).slice(0, 32)}`;
}

export function bookingRequestSha256(
  input: {
    readonly operationId: string;
    readonly bookingId: string;
    readonly status: "confirmed" | "cancelled";
  },
  sha256Hex: (value: string) => string,
): string {
  return sha256Hex(
    JSON.stringify([
      "hemas-lite-booking-status-request:v1",
      input.operationId,
      input.bookingId,
      input.status,
    ]),
  );
}

export interface LiteBookingOperationResult {
  readonly ok: true;
  readonly bookingId: string;
  readonly status: "confirmed" | "cancelled";
  readonly notified: boolean;
  readonly idempotent: boolean;
}

export type LiteBookingOperationDecision =
  | { readonly kind: "reserve" }
  | { readonly kind: "resume_reserved" }
  | { readonly kind: "replay"; readonly result: LiteBookingOperationResult };

function record(raw: unknown): Record<string, unknown> | null {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;
}

export interface LiteBookingReconciliationInput {
  readonly operationId: string;
  readonly requestSha256: string;
  readonly outcome: "sent" | "not_sent";
  readonly providerMessageId: string | null;
  readonly providerEvidenceSha256: string;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function providerMessageIdOrNull(raw: unknown): string | null {
  return typeof raw === "string" ? raw.trim() : null;
}

/** Exact, content-free evidence produced after a private provider lookup. */
export function assertBookingReconciliationInput(
  raw: unknown,
): LiteBookingReconciliationInput {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new LiteBookingOperationError("invalid_evidence", "Booking reconciliation evidence is required.");
  }
  const value = raw as Record<string, unknown>;
  const keys = [
    "operationId",
    "requestSha256",
    "outcome",
    "providerMessageId",
    "providerEvidenceSha256",
  ] as const;
  if (!exactKeys(value, keys)) {
    throw new LiteBookingOperationError(
      "invalid_evidence",
      "Booking reconciliation must contain the exact evidence fields.",
    );
  }
  const operationId = assertBookingOperationId(value.operationId);
  const requestSha256 = typeof value.requestSha256 === "string" ? value.requestSha256.trim() : "";
  const providerEvidenceSha256 =
    typeof value.providerEvidenceSha256 === "string"
      ? value.providerEvidenceSha256.trim()
      : "";
  if (!/^[0-9a-f]{64}$/.test(requestSha256) || !/^[0-9a-f]{64}$/.test(providerEvidenceSha256)) {
    throw new LiteBookingOperationError(
      "invalid_evidence",
      "Booking request and provider evidence must be SHA-256 digests.",
    );
  }
  if (value.outcome !== "sent" && value.outcome !== "not_sent") {
    throw new LiteBookingOperationError(
      "invalid_evidence",
      "Booking provider outcome must be sent or not_sent.",
    );
  }
  const providerMessageId = providerMessageIdOrNull(value.providerMessageId);
  if (
    (value.outcome === "sent" &&
      (providerMessageId === null ||
        providerMessageId.length < 8 ||
        providerMessageId.length > 512 ||
        !/^[A-Za-z0-9._:-]+$/.test(providerMessageId))) ||
    (value.outcome === "not_sent" && providerMessageId !== null)
  ) {
    throw new LiteBookingOperationError(
      "invalid_evidence",
      "Booking provider message evidence does not match the outcome.",
    );
  }
  return {
    operationId,
    requestSha256,
    outcome: value.outcome,
    providerMessageId,
    providerEvidenceSha256,
  };
}

export type LiteBookingReconciliationDecision =
  | {
      readonly kind: "apply";
      readonly bookingId: string;
      readonly status: "confirmed" | "cancelled";
      readonly notified: boolean;
    }
  | {
      readonly kind: "already_reconciled";
      readonly bookingId: string;
      readonly status: "confirmed" | "cancelled";
      readonly notified: boolean;
    };

function millis(raw: unknown): number | null {
  if (typeof raw !== "object" || raw === null) return null;
  const toMillis = (raw as { toMillis?: unknown }).toMillis;
  if (typeof toMillis !== "function") return null;
  const value = (toMillis as () => unknown).call(raw);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export type LiteBookingNotificationPolicy =
  | { readonly eligible: true }
  | {
      readonly eligible: false;
      readonly reason:
        | "conversation_invalid"
        | "service_window_closed"
        | "contact_invalid"
        | "contact_suppressed";
    };

/** Fail closed for operational free-form notifications outside the live window. */
export function evaluateBookingNotificationPolicy(
  rawConversation: unknown,
  rawContact: unknown,
  expected: {
    readonly workspaceId: string;
    readonly conversationId: string;
    readonly contactId: string;
    readonly nowMs: number;
  },
): LiteBookingNotificationPolicy {
  const conversation = record(rawConversation);
  if (
    !conversation ||
    conversation.id !== expected.conversationId ||
    conversation.workspaceId !== expected.workspaceId ||
    conversation.contactId !== expected.contactId ||
    conversation.synthetic !== true ||
    conversation.liveCanary !== true
  ) {
    return { eligible: false, reason: "conversation_invalid" };
  }
  const expiresAt = millis(conversation.serviceWindowExpiresAt);
  if (expiresAt === null || expiresAt <= expected.nowMs) {
    return { eligible: false, reason: "service_window_closed" };
  }
  const contact = record(rawContact);
  if (
    !contact ||
    contact.id !== expected.contactId ||
    contact.workspaceId !== expected.workspaceId ||
    contact.synthetic !== true ||
    contact.liveCanary !== true ||
    typeof contact.suppression !== "object" ||
    contact.suppression === null
  ) {
    return { eligible: false, reason: "contact_invalid" };
  }
  const suppression = contact.suppression as Record<string, unknown>;
  const suppressionUpdatedAt = suppression.updatedAt as { toDate?: unknown } | undefined;
  if (
    typeof suppression.suppressAll !== "boolean" ||
    typeof suppression.suppressMarketing !== "boolean" ||
    typeof suppression.invalidContact !== "boolean" ||
    !Array.isArray(suppression.reasons) ||
    typeof suppressionUpdatedAt !== "object" ||
    suppressionUpdatedAt === null ||
    typeof suppressionUpdatedAt.toDate !== "function" ||
    !Array.isArray(contact.tags)
  ) {
    return { eligible: false, reason: "contact_invalid" };
  }
  if (suppression.suppressAll || suppression.invalidContact) {
    return { eligible: false, reason: "contact_suppressed" };
  }
  return { eligible: true };
}

/**
 * Resolve provider uncertainty without granting send authority. A plain
 * `sending` record is reconcilable only after the callable's timeout window
 * has safely elapsed; `send_uncertain` is already terminally blocked.
 */
export function decideBookingReconciliation(
  raw: unknown,
  input: LiteBookingReconciliationInput,
  expected: {
    readonly documentId: string;
    readonly workspaceId: string;
    readonly nowMs: number;
  },
): LiteBookingReconciliationDecision {
  const operation = record(raw);
  if (
    !operation ||
    operation.id !== expected.documentId ||
    operation.workspaceId !== expected.workspaceId ||
    operation.operationId !== input.operationId ||
    operation.requestSha256 !== input.requestSha256 ||
    typeof operation.actorUid !== "string" ||
    !operation.actorUid ||
    typeof operation.bookingId !== "string" ||
    !/^HC-\d{5}-[0-9a-f]{10}$/.test(operation.bookingId) ||
    (operation.targetStatus !== "confirmed" && operation.targetStatus !== "cancelled") ||
    typeof operation.toNumberSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(operation.toNumberSha256) ||
    typeof operation.toNumberLast4 !== "string" ||
    !/^\d{4}$/.test(operation.toNumberLast4)
  ) {
    throw new LiteBookingOperationError(
      "invalid_evidence",
      "Booking operation evidence is missing or malformed.",
    );
  }
  const notified = input.outcome === "sent";
  if (operation.status === "completed") {
    if (
      operation.notified === notified &&
      operation.reconciliationOutcome === input.outcome &&
      operation.reconciliationRequestSha256 === input.requestSha256 &&
      operation.reconciliationEvidenceSha256 === input.providerEvidenceSha256 &&
      operation.providerMessageId === input.providerMessageId
    ) {
      return {
        kind: "already_reconciled",
        bookingId: operation.bookingId,
        status: operation.targetStatus,
        notified,
      };
    }
    throw new LiteBookingOperationError(
      "operation_conflict",
      "Booking operation already has different terminal evidence.",
    );
  }
  if (operation.status !== "send_uncertain" && operation.status !== "sending") {
    throw new LiteBookingOperationError(
      "invalid_evidence",
      "Booking operation is not reconcilable.",
    );
  }
  if (operation.status === "sending") {
    const updatedAtMs = millis(operation.updatedAt);
    if (
      updatedAtMs === null ||
      updatedAtMs > expected.nowMs - LITE_BOOKING_SEND_STALE_MS
    ) {
      throw new LiteBookingOperationError(
        "operation_in_progress",
        "Booking notification may still be sending; wait for the stale-send boundary.",
      );
    }
  }
  return {
    kind: "apply",
    bookingId: operation.bookingId,
    status: operation.targetStatus,
    notified,
  };
}

export function decideBookingOperation(
  raw: unknown,
  expected: {
    readonly documentId: string;
    readonly operationId: string;
    readonly actorUid: string;
    readonly bookingId: string;
    readonly status: "confirmed" | "cancelled";
    readonly requestSha256: string;
  },
): LiteBookingOperationDecision {
  const operation = record(raw);
  if (!operation) return { kind: "reserve" };
  if (
    operation.id !== expected.documentId ||
    operation.operationId !== expected.operationId ||
    operation.actorUid !== expected.actorUid ||
    operation.bookingId !== expected.bookingId ||
    operation.targetStatus !== expected.status ||
    operation.requestSha256 !== expected.requestSha256
  ) {
    throw new LiteBookingOperationError(
      "operation_conflict",
      "Booking operation id is already bound to a different request.",
    );
  }
  if (operation.status === "sending") {
    throw new LiteBookingOperationError(
      "operation_in_progress",
      "Booking notification is already sending and cannot be retried yet.",
    );
  }
  if (operation.status === "reserved") {
    return { kind: "resume_reserved" };
  }
  if (operation.status === "send_uncertain") {
    throw new LiteBookingOperationError(
      "operation_uncertain",
      "Booking notification outcome is uncertain and requires reconciliation.",
    );
  }
  if (operation.status !== "completed" || typeof operation.notified !== "boolean") {
    throw new LiteBookingOperationError(
      "invalid_evidence",
      "Completed booking operation evidence is malformed.",
    );
  }
  return {
    kind: "replay",
    result: {
      ok: true,
      bookingId: expected.bookingId,
      status: expected.status,
      notified: operation.notified,
      idempotent: true,
    },
  };
}
