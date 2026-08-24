/**
 * Hemas Connect ENTERPRISE — customer callback router pure contracts.
 *
 * Normalizes provider events into two customer-facing webhook streams:
 * - `whatsapp.dlr.v1`   — delivery status for a bulk item, echoing the
 *                         customer's opaque client_reference (the "custom
 *                         key in DLR" requirement).
 * - `whatsapp.reply.v1` — an inbound reply, content-free by default; text
 *                         is attached only under the same eligibility policy
 *                         that governs the protected inbox.
 *
 * Delivery guarantees follow the outbox pattern used across the engine:
 * deterministic event ids, idempotent enqueue, bounded signed retries and a
 * terminal dead-letter state that is visible, never silent.
 *
 * The signing secret lives in a separate server-only collection so no client
 * read can ever expose it; the endpoint configuration document itself stays
 * staff-readable without secrets.
 */

export const ENTERPRISE_CALLBACK_ENDPOINTS_COLLECTION =
  "enterprise_callback_endpoints" as const;
export const ENTERPRISE_CALLBACK_SECRETS_COLLECTION =
  "enterprise_callback_secrets" as const;
export const ENTERPRISE_CALLBACK_DELIVERIES_COLLECTION =
  "enterprise_callback_deliveries" as const;

export const ENTERPRISE_CALLBACK_MAX_ATTEMPTS = 8;
export const ENTERPRISE_CALLBACK_LEASE_MS = 2 * 60 * 1_000;
export const ENTERPRISE_CALLBACK_SIGNATURE_HEADER = "x-hemas-signature-256" as const;
export const ENTERPRISE_CALLBACK_EVENT_ID_HEADER = "x-hemas-event-id" as const;
export const ENTERPRISE_CALLBACK_TIMESTAMP_HEADER = "x-hemas-timestamp" as const;

export type EnterpriseCallbackErrorCode =
  | "invalid_callback_url"
  | "invalid_callback_config"
  | "invalid_signing_key"
  | "invalid_event"
  | "invalid_evidence"
  | "delivery_conflict";

export class EnterpriseCallbackError extends Error {
  constructor(
    readonly code: EnterpriseCallbackErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EnterpriseCallbackError";
  }
}

/* ------------------------------------------------------------------ */
/* Endpoint configuration                                              */
/* ------------------------------------------------------------------ */

const PRIVATE_HOST_PATTERN =
  /^(localhost|.*\.local|.*\.internal|.*\.localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-fA-F:]+\])$/;

/**
 * Customer callback destinations must be public HTTPS with no credentials —
 * the router will never be a proxy into private address space.
 */
export function assertCustomerCallbackUrl(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value || value.length > 512) {
    throw new EnterpriseCallbackError(
      "invalid_callback_url",
      "Callback URLs must be 1-512 characters.",
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new EnterpriseCallbackError("invalid_callback_url", "Callback URL is not valid.");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    !url.hostname.includes(".") ||
    PRIVATE_HOST_PATTERN.test(url.hostname)
  ) {
    throw new EnterpriseCallbackError(
      "invalid_callback_url",
      "Callback URLs must be public HTTPS without credentials or fragments.",
    );
  }
  return url.toString();
}

export interface EnterpriseCallbackEndpointConfig {
  readonly dlrUrl: string | null;
  readonly replyUrl: string | null;
}

/** Exact-key config: each stream is independently configurable or off (null). */
export function assertCallbackEndpointConfigInput(
  raw: unknown,
): EnterpriseCallbackEndpointConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new EnterpriseCallbackError(
      "invalid_callback_config",
      "Callback configuration is required.",
    );
  }
  const value = raw as Record<string, unknown>;
  const keys = Object.keys(value);
  const allowed = ["dlrUrl", "replyUrl"];
  if (keys.length !== allowed.length || !keys.every((key) => allowed.includes(key))) {
    throw new EnterpriseCallbackError(
      "invalid_callback_config",
      "Callback configuration must contain exactly dlrUrl and replyUrl.",
    );
  }
  const dlrUrl = value.dlrUrl === null ? null : assertCustomerCallbackUrl(value.dlrUrl);
  const replyUrl = value.replyUrl === null ? null : assertCustomerCallbackUrl(value.replyUrl);
  if (dlrUrl === null && replyUrl === null) {
    throw new EnterpriseCallbackError(
      "invalid_callback_config",
      "At least one callback stream must be configured.",
    );
  }
  return { dlrUrl, replyUrl };
}

export function enterpriseCallbackEndpointId(
  workspaceId: string,
  sha256Hex: (value: string) => string,
): string {
  return `cbend_${sha256Hex(`enterprise-callback-endpoint:${workspaceId}`).slice(0, 20)}`;
}

/** Strict canonical base64 for a 32-byte key, like the return-route keyring. */
export function assertCallbackSigningKeyBase64(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new EnterpriseCallbackError(
      "invalid_signing_key",
      "Callback signing keys must be canonical base64 for exactly 32 bytes.",
    );
  }
  return value;
}

export function buildCallbackEndpointRecord(input: {
  readonly endpointId: string;
  readonly workspaceId: string;
  readonly actorUid: string;
  readonly config: EnterpriseCallbackEndpointConfig;
  readonly secretVersion: number;
}): Record<string, unknown> {
  if (!Number.isInteger(input.secretVersion) || input.secretVersion < 1) {
    throw new EnterpriseCallbackError("invalid_evidence", "Secret version must be a positive integer.");
  }
  return {
    id: input.endpointId,
    workspaceId: input.workspaceId,
    actorUid: input.actorUid,
    dlrUrl: input.config.dlrUrl,
    replyUrl: input.config.replyUrl,
    secretVersion: input.secretVersion,
    synthetic: true,
  };
}

/** Server-only signing material paired 1:1 with the endpoint document. */
export function buildCallbackSecretRecord(input: {
  readonly endpointId: string;
  readonly workspaceId: string;
  readonly signingKeyBase64: string;
  readonly secretVersion: number;
}): Record<string, unknown> {
  return {
    id: input.endpointId,
    workspaceId: input.workspaceId,
    signingKeyBase64: assertCallbackSigningKeyBase64(input.signingKeyBase64),
    secretVersion: input.secretVersion,
    synthetic: true,
  };
}

/* ------------------------------------------------------------------ */
/* Normalized events                                                   */
/* ------------------------------------------------------------------ */

export type EnterpriseCallbackStream = "dlr" | "reply";

export const ENTERPRISE_DLR_STATUSES = ["sent", "delivered", "read", "failed"] as const;
export type EnterpriseDlrStatus = (typeof ENTERPRISE_DLR_STATUSES)[number];

export interface EnterpriseDlrCallbackEvent {
  readonly event: "whatsapp.dlr.v1";
  readonly eventId: string;
  readonly occurredAtMs: number;
  readonly data: {
    readonly clientBatchId: string;
    readonly clientReference: string;
    readonly providerMessageId: string;
    readonly status: EnterpriseDlrStatus;
    readonly recipientLast4: string;
  };
}

export interface EnterpriseReplyCallbackEvent {
  readonly event: "whatsapp.reply.v1";
  readonly eventId: string;
  readonly occurredAtMs: number;
  readonly data: {
    readonly conversationKey: string;
    readonly senderLast4: string;
    readonly messageType: string;
    /** Present only when the protected-inbox eligibility policy allows it. */
    readonly text: string | null;
  };
}

export type EnterpriseCallbackEvent =
  | EnterpriseDlrCallbackEvent
  | EnterpriseReplyCallbackEvent;

function assertOccurredAtMs(raw: number): number {
  if (!Number.isSafeInteger(raw) || raw <= 0) {
    throw new EnterpriseCallbackError("invalid_event", "Event timestamps must be epoch milliseconds.");
  }
  return raw;
}

/** Deterministic per-(wamid,status) id — provider retries stay idempotent. */
export function enterpriseDlrEventId(
  wamid: string,
  status: EnterpriseDlrStatus,
  sha256Hex: (value: string) => string,
): string {
  return `evt_${sha256Hex(`enterprise-dlr:${wamid}:${status}`).slice(0, 32)}`;
}

export function enterpriseReplyEventId(
  waMessageId: string,
  sha256Hex: (value: string) => string,
): string {
  return `evt_${sha256Hex(`enterprise-reply:${waMessageId}`).slice(0, 32)}`;
}

export function buildDlrCallbackEvent(input: {
  readonly wamid: string;
  readonly status: string;
  readonly occurredAtMs: number;
  readonly clientBatchId: string;
  readonly clientReference: string;
  readonly recipientLast4: string;
  readonly sha256Hex: (value: string) => string;
}): EnterpriseDlrCallbackEvent {
  if (!(ENTERPRISE_DLR_STATUSES as readonly string[]).includes(input.status)) {
    throw new EnterpriseCallbackError("invalid_event", "DLR status is not a normalized status.");
  }
  const wamid = input.wamid.trim();
  if (wamid.length < 8 || wamid.length > 512 || !/^[A-Za-z0-9._:=+/-]+$/.test(wamid)) {
    throw new EnterpriseCallbackError("invalid_event", "Provider message id is malformed.");
  }
  if (!/^\d{4}$/.test(input.recipientLast4)) {
    throw new EnterpriseCallbackError("invalid_event", "Recipient last4 evidence is malformed.");
  }
  return {
    event: "whatsapp.dlr.v1",
    eventId: enterpriseDlrEventId(wamid, input.status as EnterpriseDlrStatus, input.sha256Hex),
    occurredAtMs: assertOccurredAtMs(input.occurredAtMs),
    data: {
      clientBatchId: input.clientBatchId,
      clientReference: input.clientReference,
      providerMessageId: wamid,
      status: input.status as EnterpriseDlrStatus,
      recipientLast4: input.recipientLast4,
    },
  };
}

/**
 * Reply text is attached only when public inbound is OFF and the sender is
 * an allowlisted tester — exactly the protected-inbox eligibility gate.
 */
export function shouldIncludeReplyText(
  publicInboundEnabled: boolean,
  senderAllowlisted: boolean,
): boolean {
  return !publicInboundEnabled && senderAllowlisted;
}

export function buildReplyCallbackEvent(input: {
  readonly waMessageId: string;
  readonly conversationKey: string;
  readonly senderLast4: string;
  readonly messageType: string;
  readonly occurredAtMs: number;
  readonly text: string | null;
  readonly sha256Hex: (value: string) => string;
}): EnterpriseReplyCallbackEvent {
  const waMessageId = input.waMessageId.trim();
  if (waMessageId.length < 8 || waMessageId.length > 512) {
    throw new EnterpriseCallbackError("invalid_event", "Inbound message id is malformed.");
  }
  if (!/^[0-9a-f]{10}$/.test(input.conversationKey)) {
    throw new EnterpriseCallbackError("invalid_event", "Conversation key evidence is malformed.");
  }
  if (!/^\d{4}$/.test(input.senderLast4)) {
    throw new EnterpriseCallbackError("invalid_event", "Sender last4 evidence is malformed.");
  }
  const messageType = input.messageType.trim();
  if (!/^[a-z_]{2,32}$/.test(messageType)) {
    throw new EnterpriseCallbackError("invalid_event", "Inbound message type is malformed.");
  }
  const text = input.text === null ? null : input.text.slice(0, 1_024);
  return {
    event: "whatsapp.reply.v1",
    eventId: enterpriseReplyEventId(waMessageId, input.sha256Hex),
    occurredAtMs: assertOccurredAtMs(input.occurredAtMs),
    data: {
      conversationKey: input.conversationKey,
      senderLast4: input.senderLast4,
      messageType,
      text,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Signature                                                           */
/* ------------------------------------------------------------------ */

/**
 * Canonical signature base: `${timestampMs}.${eventId}.${rawBody}` signed
 * with HMAC-SHA256. Binding the timestamp and event id defeats replay and
 * body-swap attacks; consumers must verify with a constant-time compare.
 */
export function callbackSignatureBase(
  timestampMs: number,
  eventId: string,
  rawBody: string,
): string {
  if (!Number.isSafeInteger(timestampMs) || timestampMs <= 0) {
    throw new EnterpriseCallbackError("invalid_event", "Signature timestamps must be epoch milliseconds.");
  }
  if (!/^evt_[0-9a-f]{32}$/.test(eventId)) {
    throw new EnterpriseCallbackError("invalid_event", "Signature event id is malformed.");
  }
  return `${timestampMs}.${eventId}.${rawBody}`;
}

/* ------------------------------------------------------------------ */
/* Delivery state machine (outbox pattern)                             */
/* ------------------------------------------------------------------ */

export type EnterpriseCallbackDeliveryStatus =
  | "queued"
  | "delivering"
  | "delivered"
  | "dead_letter";

/** Bounded backoff schedule; attempt is 1-based. */
export function nextCallbackAttemptDelayMs(attempt: number): number {
  const schedule = [
    60_000,
    5 * 60_000,
    15 * 60_000,
    60 * 60_000,
    3 * 60 * 60_000,
    6 * 60 * 60_000,
    12 * 60 * 60_000,
  ];
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new EnterpriseCallbackError("invalid_evidence", "Attempt numbers are 1-based integers.");
  }
  return schedule[Math.min(attempt, schedule.length) - 1]!;
}

/** Idempotent enqueue: one delivery per (event, stream). */
export function enterpriseCallbackDeliveryId(
  eventId: string,
  stream: EnterpriseCallbackStream,
  sha256Hex: (value: string) => string,
): string {
  return `cbdel_${sha256Hex(`enterprise-callback-delivery:${eventId}:${stream}`).slice(0, 28)}`;
}

export function buildCallbackDeliveryRecord(input: {
  readonly deliveryId: string;
  readonly workspaceId: string;
  readonly endpointId: string;
  readonly stream: EnterpriseCallbackStream;
  readonly event: EnterpriseCallbackEvent;
  readonly nowMs: number;
}): Record<string, unknown> {
  return {
    id: input.deliveryId,
    workspaceId: input.workspaceId,
    endpointId: input.endpointId,
    stream: input.stream,
    eventId: input.event.eventId,
    eventName: input.event.event,
    payload: input.event,
    status: "queued" satisfies EnterpriseCallbackDeliveryStatus,
    attemptCount: 0,
    nextAttemptAtMs: input.nowMs,
    leaseExpiresAtMs: null,
    lastResponseStatus: null,
    synthetic: true,
  };
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;
}

export interface EnterpriseCallbackDeliveryClaim {
  readonly deliveryId: string;
  readonly stream: EnterpriseCallbackStream;
  readonly eventId: string;
  readonly attemptNumber: number;
}

function leaseActive(record: Record<string, unknown>, nowMs: number): boolean {
  const leaseExpiresAtMs = record.leaseExpiresAtMs;
  return (
    leaseExpiresAtMs !== null &&
    Number.isSafeInteger(leaseExpiresAtMs) &&
    (leaseExpiresAtMs as number) > nowMs
  );
}

/**
 * Runner filter: due queued work plus crashed `delivering` work whose lease
 * expired. Redelivery after a crash is safe because consumers deduplicate on
 * the event id; that is a documented consumer contract.
 */
export function selectDueCallbackDeliveries(
  records: readonly unknown[],
  nowMs: number,
  limit: number,
): readonly EnterpriseCallbackDeliveryClaim[] {
  const due: Array<EnterpriseCallbackDeliveryClaim & { readonly dueAtMs: number }> = [];
  for (const raw of records) {
    const record = asRecord(raw);
    if (!record) continue;
    if (typeof record.id !== "string" || typeof record.eventId !== "string") continue;
    if (record.stream !== "dlr" && record.stream !== "reply") continue;
    if (!Number.isInteger(record.attemptCount) || (record.attemptCount as number) < 0) continue;
    const nextAttemptAtMs = record.nextAttemptAtMs;
    if (!Number.isSafeInteger(nextAttemptAtMs)) continue;
    const claimable =
      (record.status === "queued" &&
        (nextAttemptAtMs as number) <= nowMs &&
        !leaseActive(record, nowMs)) ||
      (record.status === "delivering" && !leaseActive(record, nowMs));
    if (!claimable) continue;
    due.push({
      deliveryId: record.id,
      stream: record.stream,
      eventId: record.eventId,
      attemptNumber: (record.attemptCount as number) + 1,
      dueAtMs: nextAttemptAtMs as number,
    });
  }
  return due
    .sort((a, b) => a.dueAtMs - b.dueAtMs)
    .slice(0, Math.max(0, limit))
    .map(({ dueAtMs: _dueAtMs, ...claim }) => claim);
}

/**
 * Transactional claim: flips due queued work — or crashed delivering work
 * with an expired lease — into a freshly leased delivering state.
 */
export function claimCallbackDelivery(
  raw: unknown,
  expected: { readonly deliveryId: string; readonly nowMs: number },
): Record<string, unknown> {
  const record = asRecord(raw);
  if (!record || record.id !== expected.deliveryId) {
    throw new EnterpriseCallbackError("invalid_evidence", "Callback delivery record is missing.");
  }
  if (record.status === "queued") {
    const nextAttemptAtMs = record.nextAttemptAtMs;
    if (!Number.isSafeInteger(nextAttemptAtMs) || (nextAttemptAtMs as number) > expected.nowMs) {
      throw new EnterpriseCallbackError("delivery_conflict", "Callback delivery is not yet due.");
    }
    if (leaseActive(record, expected.nowMs)) {
      throw new EnterpriseCallbackError("delivery_conflict", "Callback delivery is leased.");
    }
  } else if (record.status === "delivering") {
    if (leaseActive(record, expected.nowMs)) {
      throw new EnterpriseCallbackError("delivery_conflict", "Callback delivery is leased.");
    }
    if ((record.attemptCount as number) >= ENTERPRISE_CALLBACK_MAX_ATTEMPTS) {
      throw new EnterpriseCallbackError("delivery_conflict", "Callback delivery attempts are exhausted.");
    }
  } else {
    throw new EnterpriseCallbackError("delivery_conflict", "Callback delivery is not claimable.");
  }
  return {
    ...record,
    status: "delivering" satisfies EnterpriseCallbackDeliveryStatus,
    attemptCount: (record.attemptCount as number) + 1,
    leaseExpiresAtMs: expected.nowMs + ENTERPRISE_CALLBACK_LEASE_MS,
  };
}

export function completeCallbackDelivery(
  raw: unknown,
  expected: { readonly deliveryId: string; readonly responseStatus: number },
): Record<string, unknown> {
  const record = asRecord(raw);
  if (!record || record.id !== expected.deliveryId || record.status !== "delivering") {
    throw new EnterpriseCallbackError("invalid_evidence", "Only a delivering callback can complete.");
  }
  if (
    !Number.isInteger(expected.responseStatus) ||
    expected.responseStatus < 200 ||
    expected.responseStatus > 299
  ) {
    throw new EnterpriseCallbackError("invalid_evidence", "Completion requires a 2xx response status.");
  }
  // Terminal records drop nextAttemptAtMs so the runner's single-field
  // due-work query can never be crowded out by finished deliveries.
  const { nextAttemptAtMs: _nextAttemptAtMs, ...terminal } = record;
  return {
    ...terminal,
    status: "delivered" satisfies EnterpriseCallbackDeliveryStatus,
    leaseExpiresAtMs: null,
    lastResponseStatus: expected.responseStatus,
  };
}

/** Failure: requeue with bounded backoff, or dead-letter after max attempts. */
export function failCallbackDelivery(
  raw: unknown,
  expected: {
    readonly deliveryId: string;
    readonly nowMs: number;
    readonly responseStatus: number | null;
  },
): Record<string, unknown> {
  const record = asRecord(raw);
  if (!record || record.id !== expected.deliveryId || record.status !== "delivering") {
    throw new EnterpriseCallbackError("invalid_evidence", "Only a delivering callback can fail.");
  }
  const attemptCount = record.attemptCount;
  if (!Number.isInteger(attemptCount) || (attemptCount as number) < 1) {
    throw new EnterpriseCallbackError("invalid_evidence", "Callback attempt evidence is malformed.");
  }
  const responseStatus =
    expected.responseStatus === null
      ? null
      : Number.isInteger(expected.responseStatus)
        ? expected.responseStatus
        : null;
  if ((attemptCount as number) >= ENTERPRISE_CALLBACK_MAX_ATTEMPTS) {
    const { nextAttemptAtMs: _nextAttemptAtMs, ...terminal } = record;
    return {
      ...terminal,
      status: "dead_letter" satisfies EnterpriseCallbackDeliveryStatus,
      leaseExpiresAtMs: null,
      lastResponseStatus: responseStatus,
    };
  }
  return {
    ...record,
    status: "queued" satisfies EnterpriseCallbackDeliveryStatus,
    leaseExpiresAtMs: null,
    lastResponseStatus: responseStatus,
    nextAttemptAtMs: expected.nowMs + nextCallbackAttemptDelayMs(attemptCount as number),
  };
}
