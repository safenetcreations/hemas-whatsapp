import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import {
  ENTERPRISE_CALLBACK_LEASE_MS,
  ENTERPRISE_CALLBACK_MAX_ATTEMPTS,
  EnterpriseCallbackError,
  assertCallbackEndpointConfigInput,
  assertCallbackSigningKeyBase64,
  assertCustomerCallbackUrl,
  buildCallbackDeliveryRecord,
  buildCallbackEndpointRecord,
  buildCallbackSecretRecord,
  buildDlrCallbackEvent,
  buildReplyCallbackEvent,
  callbackSignatureBase,
  claimCallbackDelivery,
  completeCallbackDelivery,
  enterpriseCallbackDeliveryId,
  enterpriseCallbackEndpointId,
  enterpriseDlrEventId,
  enterpriseReplyEventId,
  failCallbackDelivery,
  nextCallbackAttemptDelayMs,
  selectDueCallbackDeliveries,
  shouldIncludeReplyText,
} from "../src/enterprise/callbacks.js";

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const callbackError = (code: string) => (error: unknown) =>
  error instanceof EnterpriseCallbackError && error.code === code;

/* ------------------------------------------------------------------ */
/* Endpoint configuration                                              */
/* ------------------------------------------------------------------ */

test("customer callback URLs must be public HTTPS destinations", () => {
  assert.equal(
    assertCustomerCallbackUrl("https://api.hemas-crm.example/webhooks/dlr"),
    "https://api.hemas-crm.example/webhooks/dlr",
  );
  const rejected = [
    "http://api.hemas-crm.example/webhooks/dlr",
    "https://user:pass@api.hemas-crm.example/hook",
    "https://api.hemas-crm.example/hook#fragment",
    "https://localhost/hook",
    "https://10.0.0.4/hook",
    "https://crm.internal/hook",
    "https://no-dot-host/hook",
    "",
  ];
  for (const candidate of rejected) {
    assert.throws(() => assertCustomerCallbackUrl(candidate), callbackError("invalid_callback_url"));
  }
});

test("endpoint configuration is exact-key with at least one stream", () => {
  const config = assertCallbackEndpointConfigInput({
    dlrUrl: "https://api.hemas-crm.example/webhooks/dlr",
    replyUrl: null,
  });
  assert.equal(config.dlrUrl, "https://api.hemas-crm.example/webhooks/dlr");
  assert.equal(config.replyUrl, null);
  assert.throws(
    () => assertCallbackEndpointConfigInput({ dlrUrl: null, replyUrl: null }),
    callbackError("invalid_callback_config"),
  );
  assert.throws(
    () =>
      assertCallbackEndpointConfigInput({
        dlrUrl: "https://api.hemas-crm.example/webhooks/dlr",
      }),
    callbackError("invalid_callback_config"),
  );
  assert.throws(
    () =>
      assertCallbackEndpointConfigInput({
        dlrUrl: "https://api.hemas-crm.example/webhooks/dlr",
        replyUrl: null,
        extra: true,
      }),
    callbackError("invalid_callback_config"),
  );
});

test("signing keys are canonical base64 for exactly 32 bytes", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  assert.equal(assertCallbackSigningKeyBase64(key), key);
  for (const candidate of [
    Buffer.alloc(16, 7).toString("base64"),
    Buffer.alloc(33, 7).toString("base64"),
    "not-base64!",
    "",
  ]) {
    assert.throws(
      () => assertCallbackSigningKeyBase64(candidate),
      callbackError("invalid_signing_key"),
    );
  }
});

test("endpoint and secret records stay paired and separately shaped", () => {
  const endpointId = enterpriseCallbackEndpointId("workspace_safenet_demo", sha256Hex);
  assert.match(endpointId, /^cbend_[0-9a-f]{20}$/);
  const config = assertCallbackEndpointConfigInput({
    dlrUrl: "https://api.hemas-crm.example/webhooks/dlr",
    replyUrl: "https://api.hemas-crm.example/webhooks/replies",
  });
  const endpoint = buildCallbackEndpointRecord({
    endpointId,
    workspaceId: "workspace_safenet_demo",
    actorUid: "uid_admin",
    config,
    secretVersion: 1,
  });
  assert.equal(endpoint.secretVersion, 1);
  assert.equal("signingKeyBase64" in endpoint, false);
  const secret = buildCallbackSecretRecord({
    endpointId,
    workspaceId: "workspace_safenet_demo",
    signingKeyBase64: Buffer.alloc(32, 7).toString("base64"),
    secretVersion: 1,
  });
  assert.equal(secret.id, endpointId);
  assert.equal(typeof secret.signingKeyBase64, "string");
  assert.throws(
    () =>
      buildCallbackEndpointRecord({
        endpointId,
        workspaceId: "workspace_safenet_demo",
        actorUid: "uid_admin",
        config,
        secretVersion: 0,
      }),
    callbackError("invalid_evidence"),
  );
});

/* ------------------------------------------------------------------ */
/* Normalized events                                                   */
/* ------------------------------------------------------------------ */

test("DLR events echo the client reference with deterministic ids", () => {
  const event = buildDlrCallbackEvent({
    wamid: "wamid.SYN-abc123456789",
    status: "delivered",
    occurredAtMs: 1_750_000_000_000,
    clientBatchId: "batch_demo_20260824_001",
    clientReference: "crm-0001",
    recipientLast4: "4567",
    sha256Hex,
  });
  assert.equal(event.event, "whatsapp.dlr.v1");
  assert.equal(event.data.clientReference, "crm-0001");
  assert.equal(event.data.status, "delivered");
  assert.equal(
    event.eventId,
    enterpriseDlrEventId("wamid.SYN-abc123456789", "delivered", sha256Hex),
  );
  assert.match(event.eventId, /^evt_[0-9a-f]{32}$/);
  assert.throws(
    () =>
      buildDlrCallbackEvent({
        wamid: "wamid.SYN-abc123456789",
        status: "queued",
        occurredAtMs: 1_750_000_000_000,
        clientBatchId: "batch_demo_20260824_001",
        clientReference: "crm-0001",
        recipientLast4: "4567",
        sha256Hex,
      }),
    callbackError("invalid_event"),
  );
  assert.throws(
    () =>
      buildDlrCallbackEvent({
        wamid: "short",
        status: "sent",
        occurredAtMs: 1_750_000_000_000,
        clientBatchId: "batch_demo_20260824_001",
        clientReference: "crm-0001",
        recipientLast4: "4567",
        sha256Hex,
      }),
    callbackError("invalid_event"),
  );
  assert.throws(
    () =>
      buildDlrCallbackEvent({
        wamid: "wamid.SYN-abc123456789",
        status: "sent",
        occurredAtMs: 0,
        clientBatchId: "batch_demo_20260824_001",
        clientReference: "crm-0001",
        recipientLast4: "4567",
        sha256Hex,
      }),
    callbackError("invalid_event"),
  );
});

test("reply events are content-free unless the protected-inbox gate allows text", () => {
  assert.equal(shouldIncludeReplyText(false, true), true);
  assert.equal(shouldIncludeReplyText(true, true), false);
  assert.equal(shouldIncludeReplyText(false, false), false);
  assert.equal(shouldIncludeReplyText(true, false), false);

  const event = buildReplyCallbackEvent({
    waMessageId: "wamid.reply-1234567890",
    conversationKey: "abcdef0123",
    senderLast4: "4567",
    messageType: "text",
    occurredAtMs: 1_750_000_000_000,
    text: null,
    sha256Hex,
  });
  assert.equal(event.event, "whatsapp.reply.v1");
  assert.equal(event.data.text, null);
  assert.equal(event.eventId, enterpriseReplyEventId("wamid.reply-1234567890", sha256Hex));

  const withText = buildReplyCallbackEvent({
    waMessageId: "wamid.reply-1234567890",
    conversationKey: "abcdef0123",
    senderLast4: "4567",
    messageType: "text",
    occurredAtMs: 1_750_000_000_000,
    text: "x".repeat(5_000),
    sha256Hex,
  });
  assert.equal(withText.data.text?.length, 1_024);

  assert.throws(
    () =>
      buildReplyCallbackEvent({
        waMessageId: "wamid.reply-1234567890",
        conversationKey: "NOT-A-KEY!",
        senderLast4: "4567",
        messageType: "text",
        occurredAtMs: 1_750_000_000_000,
        text: null,
        sha256Hex,
      }),
    callbackError("invalid_event"),
  );
  assert.throws(
    () =>
      buildReplyCallbackEvent({
        waMessageId: "wamid.reply-1234567890",
        conversationKey: "abcdef0123",
        senderLast4: "4567",
        messageType: "Weird Type",
        occurredAtMs: 1_750_000_000_000,
        text: null,
        sha256Hex,
      }),
    callbackError("invalid_event"),
  );
});

/* ------------------------------------------------------------------ */
/* Signature                                                           */
/* ------------------------------------------------------------------ */

test("the signature base binds timestamp, event id and raw body", () => {
  const eventId = enterpriseReplyEventId("wamid.reply-1234567890", sha256Hex);
  const rawBody = JSON.stringify({ event: "whatsapp.reply.v1" });
  const base = callbackSignatureBase(1_750_000_000_000, eventId, rawBody);
  assert.equal(base, `1750000000000.${eventId}.${rawBody}`);

  const key = Buffer.alloc(32, 7);
  const signature = createHmac("sha256", key).update(base).digest("hex");
  const verifier = createHmac("sha256", key)
    .update(callbackSignatureBase(1_750_000_000_000, eventId, rawBody))
    .digest("hex");
  assert.equal(signature, verifier);
  const tampered = createHmac("sha256", key)
    .update(callbackSignatureBase(1_750_000_000_001, eventId, rawBody))
    .digest("hex");
  assert.notEqual(signature, tampered);

  assert.throws(
    () => callbackSignatureBase(0, eventId, rawBody),
    callbackError("invalid_event"),
  );
  assert.throws(
    () => callbackSignatureBase(1_750_000_000_000, "evt_bad", rawBody),
    callbackError("invalid_event"),
  );
});

/* ------------------------------------------------------------------ */
/* Delivery state machine                                              */
/* ------------------------------------------------------------------ */

const nowMs = 1_750_000_000_000;

function deliveryRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const event = buildDlrCallbackEvent({
    wamid: "wamid.SYN-abc123456789",
    status: "sent",
    occurredAtMs: nowMs,
    clientBatchId: "batch_demo_20260824_001",
    clientReference: "crm-0001",
    recipientLast4: "4567",
    sha256Hex,
  });
  return {
    ...buildCallbackDeliveryRecord({
      deliveryId: enterpriseCallbackDeliveryId(event.eventId, "dlr", sha256Hex),
      workspaceId: "workspace_safenet_demo",
      endpointId: enterpriseCallbackEndpointId("workspace_safenet_demo", sha256Hex),
      stream: "dlr",
      event,
      nowMs,
    }),
    ...overrides,
  };
}

test("deliveries enqueue idempotently per event and stream", () => {
  const record = deliveryRecord();
  assert.match(record.id as string, /^cbdel_[0-9a-f]{28}$/);
  assert.equal(record.status, "queued");
  assert.equal(record.attemptCount, 0);
  assert.equal(record.nextAttemptAtMs, nowMs);
  assert.equal(
    record.id,
    enterpriseCallbackDeliveryId(record.eventId as string, "dlr", sha256Hex),
  );
  assert.notEqual(
    enterpriseCallbackDeliveryId(record.eventId as string, "dlr", sha256Hex),
    enterpriseCallbackDeliveryId(record.eventId as string, "reply", sha256Hex),
  );
});

test("the due selector filters leases, future work and malformed records", () => {
  const due = deliveryRecord();
  const future = deliveryRecord({ id: "cbdel_" + "b".repeat(28), nextAttemptAtMs: nowMs + 60_000 });
  const leased = deliveryRecord({ id: "cbdel_" + "c".repeat(28), leaseExpiresAtMs: nowMs + 30_000 });
  const staleLease = deliveryRecord({
    id: "cbdel_" + "d".repeat(28),
    nextAttemptAtMs: nowMs - 10_000,
    leaseExpiresAtMs: nowMs - 1,
  });
  const delivered = deliveryRecord({ id: "cbdel_" + "e".repeat(28), status: "delivered" });
  const crashedDelivering = deliveryRecord({
    id: "cbdel_" + "f".repeat(28),
    status: "delivering",
    attemptCount: 1,
    nextAttemptAtMs: nowMs - 20_000,
    leaseExpiresAtMs: nowMs - 1,
  });
  const activeDelivering = deliveryRecord({
    id: "cbdel_" + "1".repeat(28),
    status: "delivering",
    attemptCount: 1,
    leaseExpiresAtMs: nowMs + 30_000,
  });
  const malformed = { id: 42 };

  const selected = selectDueCallbackDeliveries(
    [due, future, leased, staleLease, delivered, crashedDelivering, activeDelivering, malformed, null],
    nowMs,
    10,
  );
  assert.deepEqual(
    selected.map((claim) => claim.deliveryId),
    [crashedDelivering.id, staleLease.id, due.id],
  );
  assert.equal(selected[0]!.attemptNumber, 2);
  assert.equal(selectDueCallbackDeliveries([due, staleLease], nowMs, 1).length, 1);
});

test("claims lease due queued work and recover crashed delivering work", () => {
  const record = deliveryRecord();
  const claimed = claimCallbackDelivery(record, { deliveryId: record.id as string, nowMs });
  assert.equal(claimed.status, "delivering");
  assert.equal(claimed.attemptCount, 1);
  assert.equal(claimed.leaseExpiresAtMs, nowMs + ENTERPRISE_CALLBACK_LEASE_MS);
  assert.throws(
    () => claimCallbackDelivery(claimed, { deliveryId: record.id as string, nowMs }),
    callbackError("delivery_conflict"),
  );
  assert.throws(
    () =>
      claimCallbackDelivery(deliveryRecord({ nextAttemptAtMs: nowMs + 1 }), {
        deliveryId: record.id as string,
        nowMs,
      }),
    callbackError("delivery_conflict"),
  );
  assert.throws(
    () => claimCallbackDelivery(undefined, { deliveryId: record.id as string, nowMs }),
    callbackError("invalid_evidence"),
  );

  const crashed = { ...claimed, leaseExpiresAtMs: nowMs - 1 };
  const reclaimed = claimCallbackDelivery(crashed, {
    deliveryId: record.id as string,
    nowMs,
  });
  assert.equal(reclaimed.status, "delivering");
  assert.equal(reclaimed.attemptCount, 2);
  assert.throws(
    () =>
      claimCallbackDelivery(
        { ...crashed, attemptCount: ENTERPRISE_CALLBACK_MAX_ATTEMPTS },
        { deliveryId: record.id as string, nowMs },
      ),
    callbackError("delivery_conflict"),
  );
});

test("completion requires a delivering record with a 2xx response", () => {
  const record = deliveryRecord();
  const claimed = claimCallbackDelivery(record, { deliveryId: record.id as string, nowMs });
  const completed = completeCallbackDelivery(claimed, {
    deliveryId: record.id as string,
    responseStatus: 204,
  });
  assert.equal(completed.status, "delivered");
  assert.equal(completed.leaseExpiresAtMs, null);
  assert.equal(completed.lastResponseStatus, 204);
  assert.equal("nextAttemptAtMs" in completed, false);
  assert.throws(
    () =>
      completeCallbackDelivery(claimed, { deliveryId: record.id as string, responseStatus: 500 }),
    callbackError("invalid_evidence"),
  );
  assert.throws(
    () =>
      completeCallbackDelivery(record, { deliveryId: record.id as string, responseStatus: 200 }),
    callbackError("invalid_evidence"),
  );
});

test("failures requeue on the bounded schedule and dead-letter at the cap", () => {
  assert.equal(nextCallbackAttemptDelayMs(1), 60_000);
  assert.equal(nextCallbackAttemptDelayMs(7), 12 * 60 * 60_000);
  assert.equal(nextCallbackAttemptDelayMs(20), 12 * 60 * 60_000);
  assert.throws(() => nextCallbackAttemptDelayMs(0), callbackError("invalid_evidence"));

  const record = deliveryRecord();
  const claimed = claimCallbackDelivery(record, { deliveryId: record.id as string, nowMs });
  const failed = failCallbackDelivery(claimed, {
    deliveryId: record.id as string,
    nowMs,
    responseStatus: 503,
  });
  assert.equal(failed.status, "queued");
  assert.equal(failed.nextAttemptAtMs, nowMs + 60_000);
  assert.equal(failed.lastResponseStatus, 503);

  const exhausted = failCallbackDelivery(
    { ...claimed, attemptCount: ENTERPRISE_CALLBACK_MAX_ATTEMPTS },
    { deliveryId: record.id as string, nowMs, responseStatus: null },
  );
  assert.equal(exhausted.status, "dead_letter");
  assert.equal(exhausted.leaseExpiresAtMs, null);
  assert.equal("nextAttemptAtMs" in exhausted, false);
  assert.throws(
    () => failCallbackDelivery(record, { deliveryId: record.id as string, nowMs, responseStatus: null }),
    callbackError("invalid_evidence"),
  );
});
