import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import type {
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Transaction,
} from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import {
  ENTERPRISE_BULK_DISPATCH_STALE_MS,
  EnterpriseBulkError,
  enterpriseBulkItemId,
  enterpriseBulkJobId,
  ENTERPRISE_WORKSPACE_ID,
} from "../src/enterprise/contracts.js";
import {
  configureEnterpriseCallbacks,
  deliverEnterpriseCallback,
  dispatchEnterpriseBulkItem,
  enqueueEnterpriseDlrCallbacks,
  enqueueEnterpriseReplyCallback,
  enterpriseCallbackSecretPath,
  enterpriseDeliveryPath,
  enterpriseEndpointPath,
  enterpriseItemPath,
  enterpriseItemSecretPath,
  enterpriseJobPath,
  enterpriseReceiptPath,
  getEnterpriseBulkJob,
  submitEnterpriseBulkJob,
  syntheticCallbackTransport,
  type SignedCallbackRequest,
} from "../src/enterprise/service.js";
import {
  callbackSignatureBase,
  enterpriseCallbackDeliveryId,
  enterpriseCallbackEndpointId,
  enterpriseDlrEventId,
} from "../src/enterprise/callbacks.js";

type MemoryRecord = Readonly<Record<string, unknown>>;

class MemoryAdminTransactionStore {
  readonly records = new Map<string, MemoryRecord>();
  readonly db: Firestore;

  constructor() {
    this.db = {
      doc: (path: string) => ({
        path,
        get: async () => this.snapshot(path),
      }) as unknown as DocumentReference,
      runTransaction: async <T>(handler: (transaction: Transaction) => Promise<T>) => {
        const staged = new Map(this.records);
        const transaction = {
          get: async (reference: DocumentReference) => {
            const path = reference.path;
            const value = staged.get(path);
            return {
              exists: value !== undefined,
              data: () => value,
              ref: reference,
              id: path.split("/").at(-1) ?? "",
            } as unknown as DocumentSnapshot;
          },
          create: (reference: DocumentReference, data: DocumentData) => {
            if (staged.has(reference.path)) {
              throw new Error(`create conflict: ${reference.path}`);
            }
            staged.set(reference.path, data);
            return transaction;
          },
          update: (reference: DocumentReference, data: DocumentData) => {
            const current = staged.get(reference.path);
            if (!current) throw new Error(`missing update target: ${reference.path}`);
            staged.set(reference.path, { ...current, ...data });
            return transaction;
          },
          delete: (reference: DocumentReference) => {
            staged.delete(reference.path);
            return transaction;
          },
        } as unknown as Transaction;
        const result = await handler(transaction);
        this.records.clear();
        for (const [path, value] of staged) this.records.set(path, value);
        return result;
      },
    } as unknown as Firestore;
  }

  private snapshot(path: string) {
    const value = this.records.get(path);
    return {
      exists: value !== undefined,
      data: () => value,
      id: path.split("/").at(-1) ?? "",
    };
  }
}

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const NOW_MS = 1_756_000_000_000;
const ACTOR = "uid_enterprise_admin";
const IDEMPOTENCY_KEY = "bulk-2026-08-24-000001";
const SIGNING_KEY = Buffer.alloc(32, 9).toString("base64");

const submitBody = {
  clientBatchId: "batch_demo_20260824_001",
  template: {
    templateName: "hemas_visit_summary_cta",
    bodyParams: ["Amara"],
    ctaSuffix: "visits/v-0042",
  },
  items: [
    { to: "+94771234567", clientReference: "crm-0001" },
    { to: "+94770000001", clientReference: "crm-0002" },
  ],
};

async function submitFixture(store: MemoryAdminTransactionStore) {
  return submitEnterpriseBulkJob({
    db: store.db,
    actorUid: ACTOR,
    idempotencyKey: IDEMPOTENCY_KEY,
    body: submitBody,
    nowMs: NOW_MS,
    sha256Hex,
  });
}

function itemIds(jobId: string): readonly string[] {
  return submitBody.items.map((item) =>
    enterpriseBulkItemId(
      jobId,
      sha256Hex(`enterprise-recipient:${item.to.replace(/[^0-9]/g, "")}`),
      sha256Hex,
    ),
  );
}

async function configureFixture(store: MemoryAdminTransactionStore) {
  return configureEnterpriseCallbacks({
    db: store.db,
    actorUid: ACTOR,
    body: {
      dlrUrl: "https://api.hemas-crm.example/webhooks/dlr",
      replyUrl: "https://api.hemas-crm.example/webhooks/replies",
    },
    nowMs: NOW_MS,
    sha256Hex,
    newSigningKeyBase64: SIGNING_KEY,
  });
}

/* ------------------------------------------------------------------ */
/* Submission                                                          */
/* ------------------------------------------------------------------ */

test("submission reserves, materializes a content-free ledger and replays identically", async () => {
  const store = new MemoryAdminTransactionStore();
  const result = await submitFixture(store);
  assert.equal(result.status, "accepted");
  assert.equal(result.itemCount, 2);
  assert.equal(result.idempotent, false);

  const job = store.records.get(enterpriseJobPath(result.jobId));
  assert.ok(job);
  assert.equal(job.itemsMaterialized, true);
  assert.equal(job.containsMessageContent, false);

  const [firstItemId, secondItemId] = itemIds(result.jobId);
  const item = store.records.get(enterpriseItemPath(firstItemId!));
  assert.ok(item);
  assert.equal(item.status, "queued");
  assert.equal(JSON.stringify(item).includes("94771234567"), false);
  const secret = store.records.get(enterpriseItemSecretPath(firstItemId!));
  assert.ok(secret);
  assert.equal(secret.toDigits, "94771234567");
  assert.ok(store.records.get(enterpriseItemPath(secondItemId!)));

  const replay = await submitFixture(store);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.jobId, result.jobId);
  assert.equal(
    [...store.records.keys()].filter((path) => path.includes("enterprise_bulk_job_items")).length,
    2,
  );

  await assert.rejects(
    submitEnterpriseBulkJob({
      db: store.db,
      actorUid: ACTOR,
      idempotencyKey: IDEMPOTENCY_KEY,
      body: { ...submitBody, clientBatchId: "batch_demo_20260824_002" },
      nowMs: NOW_MS,
      sha256Hex,
    }),
    (error: unknown) =>
      error instanceof EnterpriseBulkError && error.code === "operation_conflict",
  );
});

test("a non-synthetic provider mode fails closed before any write", async () => {
  const store = new MemoryAdminTransactionStore();
  process.env.HEMAS_ENTERPRISE_PROVIDER_MODE = "live";
  try {
    await assert.rejects(
      submitFixture(store),
      (error: unknown) =>
        error instanceof EnterpriseBulkError && error.code === "live_dispatch_unavailable",
    );
    assert.equal(store.records.size, 0);
  } finally {
    delete process.env.HEMAS_ENTERPRISE_PROVIDER_MODE;
  }
});

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

test("dispatch honours the boundary, deletes the secret and finalizes the job", async () => {
  const store = new MemoryAdminTransactionStore();
  const submitted = await submitFixture(store);
  const [firstItemId, secondItemId] = itemIds(submitted.jobId);

  const first = await dispatchEnterpriseBulkItem({
    db: store.db,
    jobId: submitted.jobId,
    itemId: firstItemId!,
    nowMs: NOW_MS + 1_000,
    sha256Hex,
  });
  assert.equal(first.outcome, "sent");
  assert.equal(first.sent?.clientReference, "crm-0001");
  assert.equal(first.sent?.toNumberLast4, "4567");
  assert.match(first.sent!.wamid, /^wamid\.SYN-[0-9a-f]{24}$/);

  const item = store.records.get(enterpriseItemPath(firstItemId!));
  assert.equal(item?.status, "sent");
  assert.equal(item?.deliveryStatus, "sent");
  assert.equal(store.records.has(enterpriseItemSecretPath(firstItemId!)), false);
  assert.ok(
    store.records.has(
      enterpriseReceiptPath(
        `bulkreceipt_${sha256Hex(`enterprise-wamid:${first.sent!.wamid}`).slice(0, 32)}`,
      ),
    ),
  );

  const midJob = await getEnterpriseBulkJob(store.db, submitted.jobId);
  assert.equal(midJob.status, "dispatching");
  assert.equal(midJob.sentCount, 1);
  assert.equal(midJob.queuedCount, 1);

  const replayDispatch = await dispatchEnterpriseBulkItem({
    db: store.db,
    jobId: submitted.jobId,
    itemId: firstItemId!,
    nowMs: NOW_MS + 2_000,
    sha256Hex,
  });
  assert.equal(replayDispatch.outcome, "skipped_terminal");

  const second = await dispatchEnterpriseBulkItem({
    db: store.db,
    jobId: submitted.jobId,
    itemId: secondItemId!,
    nowMs: NOW_MS + 3_000,
    sha256Hex,
  });
  assert.equal(second.outcome, "sent");

  const finalJob = await getEnterpriseBulkJob(store.db, submitted.jobId);
  assert.equal(finalJob.status, "completed");
  assert.equal(finalJob.sentCount, 2);
  assert.equal(finalJob.queuedCount, 0);
});

test("a stale sending item is recovered as not_sent, never re-dispatched", async () => {
  const store = new MemoryAdminTransactionStore();
  const submitted = await submitFixture(store);
  const [firstItemId, secondItemId] = itemIds(submitted.jobId);

  const staleMs = NOW_MS - ENTERPRISE_BULK_DISPATCH_STALE_MS - 1;
  const jobPath = enterpriseJobPath(submitted.jobId);
  const job = store.records.get(jobPath)!;
  store.records.set(jobPath, { ...job, sendingCount: 1 });
  const itemPath = enterpriseItemPath(firstItemId!);
  store.records.set(itemPath, {
    ...store.records.get(itemPath)!,
    status: "sending",
    attemptCount: 1,
    updatedAt: Timestamp.fromMillis(staleMs),
  });

  const recovered = await dispatchEnterpriseBulkItem({
    db: store.db,
    jobId: submitted.jobId,
    itemId: firstItemId!,
    nowMs: NOW_MS,
    sha256Hex,
  });
  assert.equal(recovered.outcome, "recovered_stale");
  assert.equal(store.records.get(itemPath)?.status, "not_sent");
  assert.equal(store.records.get(itemPath)?.failureCode, "stale_dispatch_recovered");

  await dispatchEnterpriseBulkItem({
    db: store.db,
    jobId: submitted.jobId,
    itemId: secondItemId!,
    nowMs: NOW_MS + 1_000,
    sha256Hex,
  });
  const finalJob = await getEnterpriseBulkJob(store.db, submitted.jobId);
  assert.equal(finalJob.status, "completed_partial");
  assert.equal(finalJob.notSentCount, 1);
  assert.equal(finalJob.sentCount, 1);
});

test("unknown job snapshots fail with job_not_found", async () => {
  const store = new MemoryAdminTransactionStore();
  await assert.rejects(
    getEnterpriseBulkJob(store.db, enterpriseBulkJobId(ENTERPRISE_WORKSPACE_ID, "missing-key-000001", sha256Hex)),
    (error: unknown) => error instanceof EnterpriseBulkError && error.code === "job_not_found",
  );
  await assert.rejects(
    getEnterpriseBulkJob(store.db, "not-a-job-id"),
    (error: unknown) => error instanceof EnterpriseBulkError && error.code === "job_not_found",
  );
});

/* ------------------------------------------------------------------ */
/* Callback configuration + enqueue                                    */
/* ------------------------------------------------------------------ */

test("callback configuration rotates the secret and splits the pair", async () => {
  const store = new MemoryAdminTransactionStore();
  const first = await configureFixture(store);
  assert.equal(first.secretVersion, 1);
  assert.equal(first.signingKey, SIGNING_KEY);

  const endpoint = store.records.get(enterpriseEndpointPath(first.endpointId));
  assert.ok(endpoint);
  assert.equal("signingKeyBase64" in endpoint, false);
  const secret = store.records.get(enterpriseCallbackSecretPath(first.endpointId));
  assert.equal(secret?.signingKeyBase64, SIGNING_KEY);

  const second = await configureFixture(store);
  assert.equal(second.secretVersion, 2);
});

test("DLR enqueue is endpoint-gated and idempotent per event", async () => {
  const store = new MemoryAdminTransactionStore();
  const enqueueInput = {
    db: store.db,
    wamid: "wamid.SYN-abc123456789ffff",
    clientBatchId: "batch_demo_20260824_001",
    clientReference: "crm-0001",
    recipientLast4: "4567",
    nowMs: NOW_MS,
    sha256Hex,
  };
  assert.equal(await enqueueEnterpriseDlrCallbacks(enqueueInput), 0);

  await configureFixture(store);
  assert.equal(await enqueueEnterpriseDlrCallbacks(enqueueInput), 2);
  assert.equal(await enqueueEnterpriseDlrCallbacks(enqueueInput), 0);

  const deliveryId = enterpriseCallbackDeliveryId(
    enterpriseDlrEventId(enqueueInput.wamid, "sent", sha256Hex),
    "dlr",
    sha256Hex,
  );
  const delivery = store.records.get(enterpriseDeliveryPath(deliveryId));
  assert.equal(delivery?.status, "queued");
  assert.equal(delivery?.attemptCount, 0);
});

test("reply callbacks stay content-free by default", async () => {
  const store = new MemoryAdminTransactionStore();
  await configureFixture(store);
  const enqueued = await enqueueEnterpriseReplyCallback({
    db: store.db,
    waMessageId: "wamid.reply-1234567890",
    conversationKey: "abcdef0123",
    senderLast4: "4567",
    messageType: "text",
    text: null,
    nowMs: NOW_MS,
    sha256Hex,
  });
  assert.equal(enqueued, true);
  const stored = [...store.records.entries()].find(([path]) =>
    path.includes("enterprise_callback_deliveries"),
  );
  assert.ok(stored);
  const payload = stored[1].payload as { data: { text: string | null } };
  assert.equal(payload.data.text, null);
});

/* ------------------------------------------------------------------ */
/* Callback delivery                                                   */
/* ------------------------------------------------------------------ */

async function enqueueOneDelivery(store: MemoryAdminTransactionStore): Promise<string> {
  await configureFixture(store);
  await enqueueEnterpriseDlrCallbacks({
    db: store.db,
    wamid: "wamid.SYN-abc123456789ffff",
    clientBatchId: "batch_demo_20260824_001",
    clientReference: "crm-0001",
    recipientLast4: "4567",
    nowMs: NOW_MS,
    sha256Hex,
    statuses: ["sent"],
  });
  return enterpriseCallbackDeliveryId(
    enterpriseDlrEventId("wamid.SYN-abc123456789ffff", "sent", sha256Hex),
    "dlr",
    sha256Hex,
  );
}

const hmacSha256Hex = (keyBase64: string, base: string): string =>
  createHmac("sha256", Buffer.from(keyBase64, "base64")).update(base).digest("hex");

test("delivery signs the exact canonical base and completes on 2xx", async () => {
  const store = new MemoryAdminTransactionStore();
  const deliveryId = await enqueueOneDelivery(store);

  const seen: SignedCallbackRequest[] = [];
  const outcome = await deliverEnterpriseCallback({
    db: store.db,
    deliveryId,
    nowMs: NOW_MS + 5_000,
    transport: async (request) => {
      seen.push(request);
      return { responseStatus: 204 };
    },
    hmacSha256Hex,
  });
  assert.equal(outcome, "delivered");
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.url, "https://api.hemas-crm.example/webhooks/dlr");

  const expectedBase = callbackSignatureBase(
    NOW_MS + 5_000,
    seen[0]!.eventId,
    seen[0]!.rawBody,
  );
  assert.equal(seen[0]!.signatureHeader, `sha256=${hmacSha256Hex(SIGNING_KEY, expectedBase)}`);

  const delivery = store.records.get(enterpriseDeliveryPath(deliveryId));
  assert.equal(delivery?.status, "delivered");
  assert.equal(delivery?.lastResponseStatus, 204);
  assert.equal(delivery?.nextAttemptAtMs, null);

  assert.equal(
    await deliverEnterpriseCallback({
      db: store.db,
      deliveryId,
      nowMs: NOW_MS + 6_000,
      transport: syntheticCallbackTransport,
      hmacSha256Hex,
    }),
    "skipped",
  );
});

test("failed deliveries requeue on the schedule and dead-letter at the cap", async () => {
  const store = new MemoryAdminTransactionStore();
  const deliveryId = await enqueueOneDelivery(store);

  const failed = await deliverEnterpriseCallback({
    db: store.db,
    deliveryId,
    nowMs: NOW_MS + 5_000,
    transport: async () => ({ responseStatus: 503 }),
    hmacSha256Hex,
  });
  assert.equal(failed, "requeued");
  const requeued = store.records.get(enterpriseDeliveryPath(deliveryId));
  assert.equal(requeued?.status, "queued");
  assert.equal(requeued?.nextAttemptAtMs, NOW_MS + 5_000 + 60_000);
  assert.equal(requeued?.lastResponseStatus, 503);

  const thrown = await deliverEnterpriseCallback({
    db: store.db,
    deliveryId,
    nowMs: NOW_MS + 5_000 + 60_000,
    transport: async () => {
      throw new Error("socket hangup");
    },
    hmacSha256Hex,
  });
  assert.equal(thrown, "requeued");

  const path = enterpriseDeliveryPath(deliveryId);
  store.records.set(path, {
    ...store.records.get(path)!,
    attemptCount: 7,
    nextAttemptAtMs: NOW_MS + 900_000,
  });
  const exhausted = await deliverEnterpriseCallback({
    db: store.db,
    deliveryId,
    nowMs: NOW_MS + 1_000_000,
    transport: async () => ({ responseStatus: 500 }),
    hmacSha256Hex,
  });
  assert.equal(exhausted, "dead_letter");
  assert.equal(store.records.get(path)?.status, "dead_letter");
  assert.equal(store.records.get(path)?.nextAttemptAtMs, null);
});

test("a delivery whose endpoint was unconfigured dead-letters visibly", async () => {
  const store = new MemoryAdminTransactionStore();
  const deliveryId = await enqueueOneDelivery(store);
  const endpointId = enterpriseCallbackEndpointId(ENTERPRISE_WORKSPACE_ID, sha256Hex);
  store.records.delete(enterpriseCallbackSecretPath(endpointId));

  const outcome = await deliverEnterpriseCallback({
    db: store.db,
    deliveryId,
    nowMs: NOW_MS + 5_000,
    transport: syntheticCallbackTransport,
    hmacSha256Hex,
  });
  assert.equal(outcome, "dead_letter");
  assert.equal(store.records.get(enterpriseDeliveryPath(deliveryId))?.status, "dead_letter");
});
