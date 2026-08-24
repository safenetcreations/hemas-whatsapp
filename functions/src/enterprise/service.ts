/**
 * Hemas Connect ENTERPRISE — transactional service layer.
 *
 * Every function here is a transaction-scoped core that binds the pure
 * contracts to Firestore documents addressed by explicit path, so the whole
 * layer is unit-testable against an in-memory transaction store. Collection
 * queries (finding due work) live in thin wrappers in `index.ts` and are
 * exercised against the emulator.
 *
 * Governance invariants enforced here:
 * - Raw recipient digits exist only in the paired `enterprise_bulk_item_secrets`
 *   document, which the dispatch runner deletes at the terminal state.
 * - The dispatch boundary is committed BEFORE any provider call
 *   (`dispatchStartedAtMs`); a stale `sending` item is only ever recovered as
 *   `not_sent`, never re-dispatched.
 * - Only the synthetic provider exists. Any other provider mode fails closed
 *   with `live_dispatch_unavailable` before a single item is touched.
 */

import { Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  ENTERPRISE_BULK_ITEM_SECRETS_COLLECTION,
  ENTERPRISE_BULK_JOB_ITEMS_COLLECTION,
  ENTERPRISE_BULK_JOBS_COLLECTION,
  ENTERPRISE_BULK_SEND_RECEIPTS_COLLECTION,
  ENTERPRISE_WORKSPACE_ID,
  EnterpriseBulkError,
  assertEnterpriseBulkJobRequest,
  assertEnterpriseIdempotencyKey,
  buildEnterpriseBulkItemRecord,
  buildEnterpriseBulkItemSecretRecord,
  buildEnterpriseBulkJobRecord,
  buildEnterpriseBulkReceiptRecord,
  decideEnterpriseBulkItemDispatch,
  decideEnterpriseBulkJobFinalization,
  decideEnterpriseBulkJobOperation,
  enterpriseBulkItemId,
  enterpriseBulkJobId,
  enterpriseBulkReceiptIdForWamid,
  enterpriseBulkRequestSha256,
  readEnterpriseBulkJobResult,
  syntheticBulkWamid,
  type EnterpriseBulkJobInput,
  type EnterpriseBulkJobResult,
} from "./contracts.js";
import {
  ENTERPRISE_CALLBACK_DELIVERIES_COLLECTION,
  ENTERPRISE_CALLBACK_ENDPOINTS_COLLECTION,
  ENTERPRISE_CALLBACK_SECRETS_COLLECTION,
  EnterpriseCallbackError,
  assertCallbackEndpointConfigInput,
  assertCallbackSigningKeyBase64,
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
  failCallbackDelivery,
  type EnterpriseCallbackEvent,
  type EnterpriseCallbackStream,
} from "./callbacks.js";

const MATERIALIZATION_CHUNK = 200;

export type Sha256Hex = (value: string) => string;

function workspacePath(collection: string, documentId: string): string {
  return `workspaces/${ENTERPRISE_WORKSPACE_ID}/${collection}/${documentId}`;
}

export function enterpriseJobPath(jobId: string): string {
  return workspacePath(ENTERPRISE_BULK_JOBS_COLLECTION, jobId);
}

export function enterpriseItemPath(itemId: string): string {
  return workspacePath(ENTERPRISE_BULK_JOB_ITEMS_COLLECTION, itemId);
}

export function enterpriseItemSecretPath(itemId: string): string {
  return workspacePath(ENTERPRISE_BULK_ITEM_SECRETS_COLLECTION, itemId);
}

export function enterpriseReceiptPath(receiptId: string): string {
  return workspacePath(ENTERPRISE_BULK_SEND_RECEIPTS_COLLECTION, receiptId);
}

export function enterpriseEndpointPath(endpointId: string): string {
  return workspacePath(ENTERPRISE_CALLBACK_ENDPOINTS_COLLECTION, endpointId);
}

export function enterpriseCallbackSecretPath(endpointId: string): string {
  return workspacePath(ENTERPRISE_CALLBACK_SECRETS_COLLECTION, endpointId);
}

export function enterpriseDeliveryPath(deliveryId: string): string {
  return workspacePath(ENTERPRISE_CALLBACK_DELIVERIES_COLLECTION, deliveryId);
}

/* ------------------------------------------------------------------ */
/* Provider mode                                                       */
/* ------------------------------------------------------------------ */

/** Only the synthetic provider exists pre-Addendum; anything else fails closed. */
export function assertSyntheticEnterpriseProvider(): void {
  const mode = process.env.HEMAS_ENTERPRISE_PROVIDER_MODE?.trim() ?? "synthetic";
  if (mode !== "synthetic") {
    throw new EnterpriseBulkError(
      "live_dispatch_unavailable",
      "No live Enterprise dispatch lane exists before the Technical Addendum.",
    );
  }
}

/* ------------------------------------------------------------------ */
/* Bulk job intake                                                     */
/* ------------------------------------------------------------------ */

export interface SubmitEnterpriseBulkJobInput {
  readonly db: Firestore;
  readonly actorUid: string;
  readonly idempotencyKey: unknown;
  readonly body: unknown;
  readonly nowMs: number;
  readonly sha256Hex: Sha256Hex;
}

/**
 * Validate, reserve under the idempotency key, then deterministically
 * materialize the item ledger in bounded chunks. Identical replays are safe
 * at any interruption point because every document id is derived from the
 * request itself.
 */
export async function submitEnterpriseBulkJob(
  input: SubmitEnterpriseBulkJobInput,
): Promise<EnterpriseBulkJobResult> {
  assertSyntheticEnterpriseProvider();
  const idempotencyKey = assertEnterpriseIdempotencyKey(input.idempotencyKey);
  const request = assertEnterpriseBulkJobRequest(input.body, input.sha256Hex);
  const requestSha256 = enterpriseBulkRequestSha256(request, input.sha256Hex);
  const jobId = enterpriseBulkJobId(ENTERPRISE_WORKSPACE_ID, idempotencyKey, input.sha256Hex);
  const jobRef = input.db.doc(enterpriseJobPath(jobId));
  const now = Timestamp.fromMillis(input.nowMs);

  const decision = await input.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    const operation = decideEnterpriseBulkJobOperation(snapshot.data(), {
      jobId,
      actorUid: input.actorUid,
      idempotencyKey,
      requestSha256,
    });
    if (operation.kind === "reserve") {
      transaction.create(jobRef, {
        ...buildEnterpriseBulkJobRecord({
          jobId,
          workspaceId: ENTERPRISE_WORKSPACE_ID,
          actorUid: input.actorUid,
          idempotencyKey,
          requestSha256,
          clientBatchId: request.clientBatchId,
          template: request.template,
          itemCount: request.items.length,
        }),
        createdAt: now,
        updatedAt: now,
      });
    }
    return operation;
  });

  if (decision.kind === "replay") {
    const jobSnapshot = await input.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(jobRef);
      return snapshot.data();
    });
    const materialized =
      typeof jobSnapshot === "object" &&
      jobSnapshot !== null &&
      (jobSnapshot as Record<string, unknown>).itemsMaterialized === true;
    if (materialized) {
      return decision.result;
    }
  }

  await materializeEnterpriseBulkItems({
    db: input.db,
    jobId,
    request,
    nowMs: input.nowMs,
    sha256Hex: input.sha256Hex,
  });

  return {
    jobId,
    clientBatchId: request.clientBatchId,
    status: "accepted",
    itemCount: request.items.length,
    queuedCount: request.items.length,
    sentCount: 0,
    notSentCount: 0,
    suppressedCount: 0,
    idempotent: decision.kind === "replay",
  };
}

async function materializeEnterpriseBulkItems(input: {
  readonly db: Firestore;
  readonly jobId: string;
  readonly request: EnterpriseBulkJobInput;
  readonly nowMs: number;
  readonly sha256Hex: Sha256Hex;
}): Promise<void> {
  const now = Timestamp.fromMillis(input.nowMs);
  for (let offset = 0; offset < input.request.items.length; offset += MATERIALIZATION_CHUNK) {
    const chunk = input.request.items.slice(offset, offset + MATERIALIZATION_CHUNK);
    await input.db.runTransaction(async (transaction) => {
      const refs = chunk.map((item) => {
        const itemId = enterpriseBulkItemId(input.jobId, item.toNumberSha256, input.sha256Hex);
        return {
          item,
          itemId,
          itemRef: input.db.doc(enterpriseItemPath(itemId)),
          secretRef: input.db.doc(enterpriseItemSecretPath(itemId)),
        };
      });
      const snapshots = await Promise.all(refs.map(({ itemRef }) => transaction.get(itemRef)));
      refs.forEach(({ item, itemId, itemRef, secretRef }, index) => {
        if (snapshots[index]!.exists) return;
        transaction.create(itemRef, {
          ...buildEnterpriseBulkItemRecord({
            itemId,
            workspaceId: ENTERPRISE_WORKSPACE_ID,
            jobId: input.jobId,
            clientBatchId: input.request.clientBatchId,
            item,
          }),
          createdAt: now,
          updatedAt: now,
        });
        transaction.create(secretRef, {
          ...buildEnterpriseBulkItemSecretRecord({
            itemId,
            workspaceId: ENTERPRISE_WORKSPACE_ID,
            jobId: input.jobId,
            toDigits: item.toDigits,
          }),
          createdAt: now,
        });
      });
    });
  }

  const jobRef = input.db.doc(enterpriseJobPath(input.jobId));
  await input.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    if (!snapshot.exists) {
      throw new EnterpriseBulkError("invalid_evidence", "Bulk job vanished during materialization.");
    }
    transaction.update(jobRef, { itemsMaterialized: true, updatedAt: now });
  });
}

/* ------------------------------------------------------------------ */
/* Job snapshot                                                        */
/* ------------------------------------------------------------------ */

export async function getEnterpriseBulkJob(
  db: Firestore,
  jobId: string,
): Promise<EnterpriseBulkJobResult> {
  if (!/^bulkjob_[0-9a-f]{24}$/.test(jobId)) {
    throw new EnterpriseBulkError("job_not_found", "Unknown bulk job id.");
  }
  const data = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(db.doc(enterpriseJobPath(jobId)));
    return snapshot.data();
  });
  if (data === undefined) {
    throw new EnterpriseBulkError("job_not_found", "Unknown bulk job id.");
  }
  return readEnterpriseBulkJobResult(data, false);
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

export interface DispatchEnterpriseBulkItemInput {
  readonly db: Firestore;
  readonly jobId: string;
  readonly itemId: string;
  readonly nowMs: number;
  readonly sha256Hex: Sha256Hex;
}

export type EnterpriseItemDispatchOutcome =
  | "sent"
  | "recovered_stale"
  | "skipped_terminal"
  | "skipped_active";

export interface EnterpriseItemDispatchResult {
  readonly outcome: EnterpriseItemDispatchOutcome;
  /** Present only for a fresh `sent`, for the DLR callback enqueue. */
  readonly sent?: {
    readonly wamid: string;
    readonly clientBatchId: string;
    readonly clientReference: string;
    readonly toNumberLast4: string;
  };
}

/**
 * Two-transaction dispatch honouring the dispatch boundary:
 * T1 commits `sending` + `dispatchStartedAtMs` before any provider work;
 * T2 records the synthetic provider result, writes the wamid receipt,
 * deletes the recipient secret and advances the job counters.
 */
export async function dispatchEnterpriseBulkItem(
  input: DispatchEnterpriseBulkItemInput,
): Promise<EnterpriseItemDispatchResult> {
  assertSyntheticEnterpriseProvider();
  const itemRef = input.db.doc(enterpriseItemPath(input.itemId));
  const jobRef = input.db.doc(enterpriseJobPath(input.jobId));
  const secretRef = input.db.doc(enterpriseItemSecretPath(input.itemId));
  const now = Timestamp.fromMillis(input.nowMs);

  const claim = await input.db.runTransaction(async (transaction) => {
    const [itemSnapshot, jobSnapshot] = await Promise.all([
      transaction.get(itemRef),
      transaction.get(jobRef),
    ]);
    const job = jobSnapshot.data() as Record<string, unknown> | undefined;
    if (!job || job.id !== input.jobId || job.itemsMaterialized !== true) {
      throw new EnterpriseBulkError("invalid_evidence", "Bulk job is not dispatchable.");
    }
    const decision = decideEnterpriseBulkItemDispatch(itemSnapshot.data(), {
      itemId: input.itemId,
      jobId: input.jobId,
      nowMs: input.nowMs,
    });
    if (decision.kind === "skip_terminal" || decision.kind === "skip_active") {
      return decision.kind;
    }
    if (decision.kind === "recover_stale") {
      // The dispatch boundary was crossed with no recorded result; the item
      // is terminal not_sent and never re-dispatched.
      transaction.update(itemRef, {
        status: "not_sent",
        failureCode: "stale_dispatch_recovered",
        updatedAt: now,
      });
      transaction.update(jobRef, {
        queuedCount: (job.queuedCount as number) - 1,
        sendingCount: Math.max(0, (job.sendingCount as number) - 1),
        notSentCount: (job.notSentCount as number) + 1,
        updatedAt: now,
      });
      return "recover_stale";
    }
    transaction.update(itemRef, {
      status: "sending",
      attemptCount: 1,
      dispatchStartedAtMs: input.nowMs,
      updatedAt: now,
    });
    transaction.update(jobRef, {
      status: "dispatching",
      sendingCount: (job.sendingCount as number) + 1,
      updatedAt: now,
    });
    return "dispatch";
  });

  if (claim === "skip_terminal") return { outcome: "skipped_terminal" };
  if (claim === "skip_active") return { outcome: "skipped_active" };
  if (claim === "recover_stale") {
    await finalizeEnterpriseBulkJob(input.db, input.jobId, input.nowMs);
    return { outcome: "recovered_stale" };
  }

  // Synthetic provider "call": deterministic, in-process, zero-network.
  const wamid = syntheticBulkWamid(input.jobId, input.itemId, input.sha256Hex);
  const receiptId = enterpriseBulkReceiptIdForWamid(wamid, input.sha256Hex);

  const sentDetails = await input.db.runTransaction(async (transaction) => {
    const [itemSnapshot, jobSnapshot, secretSnapshot, receiptSnapshot] = await Promise.all([
      transaction.get(itemRef),
      transaction.get(jobRef),
      transaction.get(secretRef),
      transaction.get(input.db.doc(enterpriseReceiptPath(receiptId))),
    ]);
    const item = itemSnapshot.data() as Record<string, unknown> | undefined;
    const job = jobSnapshot.data() as Record<string, unknown> | undefined;
    if (!item || !job || item.status !== "sending") {
      throw new EnterpriseBulkError("invalid_evidence", "Bulk item left the sending state.");
    }
    transaction.update(itemRef, {
      status: "sent",
      providerMessageId: wamid,
      deliveryStatus: "sent",
      updatedAt: now,
    });
    if (!receiptSnapshot.exists) {
      transaction.create(input.db.doc(enterpriseReceiptPath(receiptId)), {
        ...buildEnterpriseBulkReceiptRecord({
          receiptId,
          workspaceId: ENTERPRISE_WORKSPACE_ID,
          jobId: input.jobId,
          itemId: input.itemId,
          clientBatchId: item.clientBatchId as string,
          clientReference: item.clientReference as string,
          toNumberLast4: item.toNumberLast4 as string,
        }),
        createdAt: now,
      });
    }
    if (secretSnapshot.exists) {
      transaction.delete(input.db.doc(enterpriseItemSecretPath(input.itemId)));
    }
    transaction.update(jobRef, {
      queuedCount: (job.queuedCount as number) - 1,
      sendingCount: Math.max(0, (job.sendingCount as number) - 1),
      sentCount: (job.sentCount as number) + 1,
      updatedAt: now,
    });
    return {
      wamid,
      clientBatchId: item.clientBatchId as string,
      clientReference: item.clientReference as string,
      toNumberLast4: item.toNumberLast4 as string,
    };
  });

  await finalizeEnterpriseBulkJob(input.db, input.jobId, input.nowMs);
  return { outcome: "sent", sent: sentDetails };
}

/** Recompute the job status once no in-flight work remains. */
export async function finalizeEnterpriseBulkJob(
  db: Firestore,
  jobId: string,
  nowMs: number,
): Promise<void> {
  const jobRef = db.doc(enterpriseJobPath(jobId));
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    const job = snapshot.data() as Record<string, unknown> | undefined;
    if (!job) return;
    const status = decideEnterpriseBulkJobFinalization({
      itemCount: job.itemCount as number,
      queuedCount: (job.queuedCount as number) - (job.sendingCount as number),
      sendingCount: job.sendingCount as number,
      sentCount: job.sentCount as number,
      notSentCount: job.notSentCount as number,
      suppressedCount: job.suppressedCount as number,
    });
    if (status !== job.status) {
      transaction.update(jobRef, { status, updatedAt: Timestamp.fromMillis(nowMs) });
    }
  });
}

/* ------------------------------------------------------------------ */
/* Callback configuration                                              */
/* ------------------------------------------------------------------ */

export interface ConfigureEnterpriseCallbacksInput {
  readonly db: Firestore;
  readonly actorUid: string;
  readonly body: unknown;
  readonly nowMs: number;
  readonly sha256Hex: Sha256Hex;
  readonly newSigningKeyBase64: string;
}

export interface EnterpriseCallbackConfigResult {
  readonly endpointId: string;
  readonly dlrUrl: string | null;
  readonly replyUrl: string | null;
  readonly secretVersion: number;
  /** Returned exactly once per rotation; never persisted outside the secret pair. */
  readonly signingKey: string;
}

export async function configureEnterpriseCallbacks(
  input: ConfigureEnterpriseCallbacksInput,
): Promise<EnterpriseCallbackConfigResult> {
  const config = assertCallbackEndpointConfigInput(input.body);
  const signingKey = assertCallbackSigningKeyBase64(input.newSigningKeyBase64);
  const endpointId = enterpriseCallbackEndpointId(ENTERPRISE_WORKSPACE_ID, input.sha256Hex);
  const endpointRef = input.db.doc(enterpriseEndpointPath(endpointId));
  const secretRef = input.db.doc(enterpriseCallbackSecretPath(endpointId));
  const now = Timestamp.fromMillis(input.nowMs);

  const secretVersion = await input.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(endpointRef);
    const existing = snapshot.data() as Record<string, unknown> | undefined;
    const nextVersion =
      existing && Number.isInteger(existing.secretVersion)
        ? (existing.secretVersion as number) + 1
        : 1;
    const endpointRecord = {
      ...buildCallbackEndpointRecord({
        endpointId,
        workspaceId: ENTERPRISE_WORKSPACE_ID,
        actorUid: input.actorUid,
        config,
        secretVersion: nextVersion,
      }),
      updatedAt: now,
    };
    const secretRecord = {
      ...buildCallbackSecretRecord({
        endpointId,
        workspaceId: ENTERPRISE_WORKSPACE_ID,
        signingKeyBase64: signingKey,
        secretVersion: nextVersion,
      }),
      updatedAt: now,
    };
    if (existing) {
      transaction.update(endpointRef, endpointRecord);
      transaction.update(secretRef, secretRecord);
    } else {
      transaction.create(endpointRef, { ...endpointRecord, createdAt: now });
      transaction.create(secretRef, { ...secretRecord, createdAt: now });
    }
    return nextVersion;
  });

  return {
    endpointId,
    dlrUrl: config.dlrUrl,
    replyUrl: config.replyUrl,
    secretVersion,
    signingKey,
  };
}

/* ------------------------------------------------------------------ */
/* Callback enqueue                                                    */
/* ------------------------------------------------------------------ */

/**
 * Idempotently enqueue one normalized event onto a stream. Returns false
 * when the stream is unconfigured or the delivery already exists.
 */
export async function enqueueEnterpriseCallback(input: {
  readonly db: Firestore;
  readonly stream: EnterpriseCallbackStream;
  readonly event: EnterpriseCallbackEvent;
  readonly nowMs: number;
  readonly sha256Hex: Sha256Hex;
}): Promise<boolean> {
  const endpointId = enterpriseCallbackEndpointId(ENTERPRISE_WORKSPACE_ID, input.sha256Hex);
  const deliveryId = enterpriseCallbackDeliveryId(
    input.event.eventId,
    input.stream,
    input.sha256Hex,
  );
  const endpointRef = input.db.doc(enterpriseEndpointPath(endpointId));
  const deliveryRef = input.db.doc(enterpriseDeliveryPath(deliveryId));

  return input.db.runTransaction(async (transaction) => {
    const [endpointSnapshot, deliverySnapshot] = await Promise.all([
      transaction.get(endpointRef),
      transaction.get(deliveryRef),
    ]);
    const endpoint = endpointSnapshot.data() as Record<string, unknown> | undefined;
    const streamUrl =
      input.stream === "dlr" ? endpoint?.dlrUrl : endpoint?.replyUrl;
    if (!endpoint || typeof streamUrl !== "string" || streamUrl.length === 0) {
      return false;
    }
    if (deliverySnapshot.exists) {
      return false;
    }
    transaction.create(deliveryRef, {
      ...buildCallbackDeliveryRecord({
        deliveryId,
        workspaceId: ENTERPRISE_WORKSPACE_ID,
        endpointId,
        stream: input.stream,
        event: input.event,
        nowMs: input.nowMs,
      }),
      createdAt: Timestamp.fromMillis(input.nowMs),
      updatedAt: Timestamp.fromMillis(input.nowMs),
    });
    return true;
  });
}

/** Build + enqueue the synthetic DLR progression for a sent bulk item. */
export async function enqueueEnterpriseDlrCallbacks(input: {
  readonly db: Firestore;
  readonly wamid: string;
  readonly clientBatchId: string;
  readonly clientReference: string;
  readonly recipientLast4: string;
  readonly nowMs: number;
  readonly sha256Hex: Sha256Hex;
  readonly statuses?: readonly ("sent" | "delivered" | "read" | "failed")[];
}): Promise<number> {
  const statuses = input.statuses ?? ["sent", "delivered"];
  let enqueued = 0;
  for (const status of statuses) {
    const event = buildDlrCallbackEvent({
      wamid: input.wamid,
      status,
      occurredAtMs: input.nowMs,
      clientBatchId: input.clientBatchId,
      clientReference: input.clientReference,
      recipientLast4: input.recipientLast4,
      sha256Hex: input.sha256Hex,
    });
    if (
      await enqueueEnterpriseCallback({
        db: input.db,
        stream: "dlr",
        event,
        nowMs: input.nowMs,
        sha256Hex: input.sha256Hex,
      })
    ) {
      enqueued += 1;
    }
  }
  return enqueued;
}

/** Content-free by default; text only under the protected-inbox gate. */
export async function enqueueEnterpriseReplyCallback(input: {
  readonly db: Firestore;
  readonly waMessageId: string;
  readonly conversationKey: string;
  readonly senderLast4: string;
  readonly messageType: string;
  readonly text: string | null;
  readonly nowMs: number;
  readonly sha256Hex: Sha256Hex;
}): Promise<boolean> {
  const event = buildReplyCallbackEvent({
    waMessageId: input.waMessageId,
    conversationKey: input.conversationKey,
    senderLast4: input.senderLast4,
    messageType: input.messageType,
    occurredAtMs: input.nowMs,
    text: input.text,
    sha256Hex: input.sha256Hex,
  });
  return enqueueEnterpriseCallback({
    db: input.db,
    stream: "reply",
    event,
    nowMs: input.nowMs,
    sha256Hex: input.sha256Hex,
  });
}

/* ------------------------------------------------------------------ */
/* Callback delivery                                                   */
/* ------------------------------------------------------------------ */

export interface SignedCallbackRequest {
  readonly url: string;
  readonly rawBody: string;
  readonly signatureHeader: string;
  readonly eventId: string;
  readonly timestampMs: number;
}

export type CallbackTransport = (
  request: SignedCallbackRequest,
) => Promise<{ readonly responseStatus: number | null }>;

/**
 * Synthetic transport: verifies the state machine and signature construction
 * without any network egress, which is the demo boundary's requirement.
 */
export const syntheticCallbackTransport: CallbackTransport = async () => ({
  responseStatus: 204,
});

export type EnterpriseCallbackDeliveryOutcome =
  | "delivered"
  | "requeued"
  | "dead_letter"
  | "skipped";

/**
 * Claim → sign → deliver → complete/fail for one delivery. The HMAC is
 * computed with the endpoint's current secret over
 * `${timestampMs}.${eventId}.${rawBody}`.
 */
export async function deliverEnterpriseCallback(input: {
  readonly db: Firestore;
  readonly deliveryId: string;
  readonly nowMs: number;
  readonly transport: CallbackTransport;
  readonly hmacSha256Hex: (keyBase64: string, base: string) => string;
}): Promise<EnterpriseCallbackDeliveryOutcome> {
  const deliveryRef = input.db.doc(enterpriseDeliveryPath(input.deliveryId));

  const claimed = await input.db.runTransaction(async (transaction) => {
    const deliverySnapshot = await transaction.get(deliveryRef);
    if (!deliverySnapshot.exists) return null;
    let record: Record<string, unknown>;
    try {
      record = claimCallbackDelivery(deliverySnapshot.data(), {
        deliveryId: input.deliveryId,
        nowMs: input.nowMs,
      });
    } catch (error) {
      if (error instanceof EnterpriseCallbackError && error.code === "delivery_conflict") {
        return null;
      }
      throw error;
    }
    const endpointId = record.endpointId as string;
    const [endpointSnapshot, secretSnapshot] = await Promise.all([
      transaction.get(input.db.doc(enterpriseEndpointPath(endpointId))),
      transaction.get(input.db.doc(enterpriseCallbackSecretPath(endpointId))),
    ]);
    const endpoint = endpointSnapshot.data() as Record<string, unknown> | undefined;
    const secret = secretSnapshot.data() as Record<string, unknown> | undefined;
    const url =
      record.stream === "dlr" ? endpoint?.dlrUrl : endpoint?.replyUrl;
    if (
      !endpoint ||
      !secret ||
      typeof url !== "string" ||
      url.length === 0 ||
      typeof secret.signingKeyBase64 !== "string"
    ) {
      // Endpoint was unconfigured after enqueue: terminal, visible, never silent.
      const { nextAttemptAtMs: _nextAttemptAtMs, ...terminal } = record;
      transaction.update(deliveryRef, {
        ...terminal,
        status: "dead_letter",
        leaseExpiresAtMs: null,
        lastResponseStatus: null,
        updatedAt: Timestamp.fromMillis(input.nowMs),
      });
      return { record: null };
    }
    transaction.update(deliveryRef, {
      ...record,
      updatedAt: Timestamp.fromMillis(input.nowMs),
    });
    return {
      record,
      url,
      signingKeyBase64: secret.signingKeyBase64,
    };
  });

  if (!claimed) return "skipped";
  if (!claimed.record) return "dead_letter";

  const payload = claimed.record.payload as EnterpriseCallbackEvent;
  const rawBody = JSON.stringify(payload);
  const base = callbackSignatureBase(input.nowMs, payload.eventId, rawBody);
  const signatureHeader = `sha256=${input.hmacSha256Hex(claimed.signingKeyBase64 as string, base)}`;

  let responseStatus: number | null = null;
  try {
    const response = await input.transport({
      url: claimed.url as string,
      rawBody,
      signatureHeader,
      eventId: payload.eventId,
      timestampMs: input.nowMs,
    });
    responseStatus = response.responseStatus;
  } catch {
    responseStatus = null;
  }

  return input.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(deliveryRef);
    const now = Timestamp.fromMillis(input.nowMs);
    if (responseStatus !== null && responseStatus >= 200 && responseStatus <= 299) {
      transaction.update(deliveryRef, {
        ...completeCallbackDelivery(snapshot.data(), {
          deliveryId: input.deliveryId,
          responseStatus,
        }),
        nextAttemptAtMs: null,
        updatedAt: now,
      });
      return "delivered";
    }
    const failed = failCallbackDelivery(snapshot.data(), {
      deliveryId: input.deliveryId,
      nowMs: input.nowMs,
      responseStatus,
    });
    transaction.update(deliveryRef, {
      ...failed,
      ...(failed.status === "dead_letter" ? { nextAttemptAtMs: null } : {}),
      updatedAt: now,
    });
    return failed.status === "dead_letter" ? "dead_letter" : "requeued";
  });
}
