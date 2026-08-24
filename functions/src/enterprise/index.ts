/**
 * Hemas Connect ENTERPRISE — HTTP gateway and dispatch runner wiring.
 *
 * `enterpriseWhatsappApi` is the customer-facing REST surface documented in
 * docs/api/enterprise/openapi.yaml:
 *   POST /v1/whatsapp/bulk-jobs          submit a bulk template job
 *   GET  /v1/whatsapp/bulk-jobs/{jobId}  read a job snapshot
 *   PUT  /v1/whatsapp/callbacks          configure DLR/reply webhook URLs
 *
 * Authentication is a Firebase Auth bearer ID token verified server-side,
 * then the exact-boolean `hemasEnterpriseApi` claim, then a live workspace
 * membership read — claims alone are never sufficient, matching the house
 * three-layer rule.
 *
 * The lane is registered unconditionally and gated at runtime: it requires
 * `HEMAS_ENTERPRISE_GATEWAY_ENABLED=true` inside one of the two governed
 * demo homes (loopback emulator, or the cloud demo project with
 * `HEMAS_CLOUD_DEMO_ENABLED=true`). Everything else answers 403
 * `enterprise_disabled`. Dispatch is synthetic-only; callback egress stays
 * in-process unless real egress is explicitly enabled in the cloud home.
 */

import { createHmac, randomBytes } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onCall, onRequest, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { sha256Hex } from "../deterministic.js";
import { getHemasFirestore } from "../firestore-target.js";
import { assertGovernedDemoProjectBoundary } from "../governed-project.js";
import {
  ENTERPRISE_BULK_DISPATCH_BATCH_SIZE,
  ENTERPRISE_BULK_JOB_ITEMS_COLLECTION,
  ENTERPRISE_WORKSPACE_ID,
  EnterpriseBulkError,
  type EnterpriseBulkErrorCode,
} from "./contracts.js";
import {
  ENTERPRISE_CALLBACK_DELIVERIES_COLLECTION,
  EnterpriseCallbackError,
  selectDueCallbackDeliveries,
} from "./callbacks.js";
import {
  configureEnterpriseCallbacks,
  deliverEnterpriseCallback,
  dispatchEnterpriseBulkItem,
  enqueueEnterpriseDlrCallbacks,
  getEnterpriseBulkJob,
  submitEnterpriseBulkJob,
  syntheticCallbackTransport,
  type CallbackTransport,
} from "./service.js";

/** Runtime boundary: explicit enterprise flag inside a governed demo home. */
export function enterpriseBoundaryOrNull(): { projectId: string; mode: "emulator" | "cloud" } | null {
  if (process.env.HEMAS_ENTERPRISE_GATEWAY_ENABLED !== "true") {
    return null;
  }
  const projectId = process.env.GCLOUD_PROJECT ?? "";
  try {
    const mode = assertGovernedDemoProjectBoundary({
      projectId,
      firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
    });
    return { projectId, mode };
  } catch {
    return null;
  }
}

function getEnterpriseFirestore(projectId: string): Firestore {
  const app =
    getApps().find((candidate) => candidate.name === "[DEFAULT]") ??
    initializeApp({ projectId });
  return getHemasFirestore(app);
}

function enterpriseAuth(projectId: string) {
  const app =
    getApps().find((candidate) => candidate.name === "[DEFAULT]") ??
    initializeApp({ projectId });
  return getAuth(app);
}

/* ------------------------------------------------------------------ */
/* Authorization                                                       */
/* ------------------------------------------------------------------ */

type EnterpriseRole = "tenant_admin" | "supervisor";

interface EnterpriseOperator {
  readonly uid: string;
  readonly role: EnterpriseRole;
}

/** Exact booleans only; a verified email plus the gateway claim. */
export function hasEnterpriseApiClaim(rawToken: unknown): boolean {
  if (typeof rawToken !== "object" || rawToken === null) return false;
  const claims = rawToken as Record<string, unknown>;
  return claims.email_verified === true && claims.hemasEnterpriseApi === true;
}

async function requireEnterpriseOperator(input: {
  readonly db: Firestore;
  readonly projectId: string;
  readonly authorizationHeader: string | undefined;
  readonly adminOnly: boolean;
}): Promise<EnterpriseOperator> {
  const header = input.authorizationHeader?.trim() ?? "";
  if (!header.startsWith("Bearer ") || header.length <= 7) {
    throw new EnterpriseBulkError(
      "authentication_required",
      "A Firebase Auth bearer ID token is required.",
    );
  }
  let decoded: Record<string, unknown>;
  try {
    decoded = (await enterpriseAuth(input.projectId).verifyIdToken(
      header.slice("Bearer ".length).trim(),
    )) as unknown as Record<string, unknown>;
  } catch {
    throw new EnterpriseBulkError(
      "authentication_required",
      "The bearer token could not be verified.",
    );
  }
  if (!hasEnterpriseApiClaim(decoded) || typeof decoded.uid !== "string" || !decoded.uid) {
    throw new EnterpriseBulkError(
      "forbidden",
      "This identity is not enabled for the Enterprise gateway.",
    );
  }
  const uid = decoded.uid;
  const membership = await input.db
    .doc(`workspaces/${ENTERPRISE_WORKSPACE_ID}/members/${uid}`)
    .get();
  const member = membership.data();
  const role = member?.role;
  const allowed: readonly string[] = input.adminOnly
    ? ["tenant_admin"]
    : ["tenant_admin", "supervisor"];
  if (
    !membership.exists ||
    !member ||
    member.uid !== uid ||
    member.status !== "active" ||
    typeof role !== "string" ||
    !allowed.includes(role)
  ) {
    throw new EnterpriseBulkError(
      "forbidden",
      "This account has no active Enterprise operator membership.",
    );
  }
  return { uid, role: role as EnterpriseRole };
}

/* ------------------------------------------------------------------ */
/* Error mapping                                                       */
/* ------------------------------------------------------------------ */

const ERROR_STATUS: Readonly<Partial<Record<EnterpriseBulkErrorCode, number>>> = {
  authentication_required: 401,
  forbidden: 403,
  job_not_found: 404,
  operation_conflict: 409,
  operation_in_progress: 409,
  invalid_evidence: 500,
  live_dispatch_unavailable: 503,
};

function respondWithError(
  response: {
    status: (code: number) => { json: (body: unknown) => void };
  },
  error: unknown,
): void {
  if (error instanceof EnterpriseBulkError) {
    response
      .status(ERROR_STATUS[error.code] ?? 400)
      .json({ error: error.code, message: error.message });
    return;
  }
  if (error instanceof EnterpriseCallbackError) {
    response.status(400).json({ error: error.code, message: error.message });
    return;
  }
  logger.error("enterprise: unhandled gateway failure");
  response.status(500).json({ error: "internal", message: "The gateway failed closed." });
}

/* ------------------------------------------------------------------ */
/* REST router                                                         */
/* ------------------------------------------------------------------ */

const BULK_JOBS_PATH = /^\/v1\/whatsapp\/bulk-jobs\/?$/;
const BULK_JOB_PATH = /^\/v1\/whatsapp\/bulk-jobs\/(bulkjob_[0-9a-f]{24})\/?$/;
const CALLBACKS_PATH = /^\/v1\/whatsapp\/callbacks\/?$/;
const MAX_REQUEST_BYTES = 1_048_576;

function parseJsonBody(rawBody: Buffer | undefined): unknown {
  if (!rawBody || rawBody.length === 0) {
    throw new EnterpriseBulkError("invalid_request", "A JSON request body is required.");
  }
  if (rawBody.length > MAX_REQUEST_BYTES) {
    throw new EnterpriseBulkError("invalid_request", "Request bodies are limited to 1 MiB.");
  }
  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new EnterpriseBulkError("invalid_request", "The request body is not valid JSON.");
  }
}

export const enterpriseWhatsappApi = onRequest(
  {
    cors: false,
    memory: "256MiB",
    timeoutSeconds: 60,
    maxInstances: 2,
    concurrency: 20,
  },
  async (request, response) => {
    response.set({
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });
    const boundary = enterpriseBoundaryOrNull();
    if (!boundary) {
      response.status(403).json({
        error: "enterprise_disabled",
        message: "The Enterprise gateway is not enabled in this environment.",
      });
      return;
    }
    const db = getEnterpriseFirestore(boundary.projectId);
    const path = request.path || "/";

    try {
      if (BULK_JOBS_PATH.test(path)) {
        if (request.method !== "POST") {
          response.set("Allow", "POST");
          response.status(405).json({ error: "method_not_allowed", message: "Use POST." });
          return;
        }
        const operator = await requireEnterpriseOperator({
          db,
          projectId: boundary.projectId,
          authorizationHeader: request.header("authorization"),
          adminOnly: false,
        });
        const result = await submitEnterpriseBulkJob({
          db,
          actorUid: operator.uid,
          idempotencyKey: request.header("idempotency-key"),
          body: parseJsonBody(request.rawBody),
          nowMs: Date.now(),
          sha256Hex,
        });
        logger.info("enterprise: bulk job accepted", {
          itemCount: result.itemCount,
          idempotent: result.idempotent,
        });
        response.status(202).json(result);
        return;
      }

      const jobMatch = path.match(BULK_JOB_PATH);
      if (jobMatch) {
        if (request.method !== "GET") {
          response.set("Allow", "GET");
          response.status(405).json({ error: "method_not_allowed", message: "Use GET." });
          return;
        }
        await requireEnterpriseOperator({
          db,
          projectId: boundary.projectId,
          authorizationHeader: request.header("authorization"),
          adminOnly: false,
        });
        response.status(200).json(await getEnterpriseBulkJob(db, jobMatch[1]!));
        return;
      }

      if (CALLBACKS_PATH.test(path)) {
        if (request.method !== "PUT") {
          response.set("Allow", "PUT");
          response.status(405).json({ error: "method_not_allowed", message: "Use PUT." });
          return;
        }
        const operator = await requireEnterpriseOperator({
          db,
          projectId: boundary.projectId,
          authorizationHeader: request.header("authorization"),
          adminOnly: true,
        });
        const result = await configureEnterpriseCallbacks({
          db,
          actorUid: operator.uid,
          body: parseJsonBody(request.rawBody),
          nowMs: Date.now(),
          sha256Hex,
          newSigningKeyBase64: randomBytes(32).toString("base64"),
        });
        logger.info("enterprise: callback endpoints configured", {
          secretVersion: result.secretVersion,
          dlrConfigured: result.dlrUrl !== null,
          replyConfigured: result.replyUrl !== null,
        });
        response.status(200).json(result);
        return;
      }

      response.status(404).json({ error: "not_found", message: "Unknown gateway path." });
    } catch (error) {
      respondWithError(response, error);
    }
  },
);

/* ------------------------------------------------------------------ */
/* Dispatch + delivery runner                                          */
/* ------------------------------------------------------------------ */

function hmacSha256Hex(keyBase64: string, base: string): string {
  return createHmac("sha256", Buffer.from(keyBase64, "base64")).update(base).digest("hex");
}

function realCallbackTransport(): CallbackTransport {
  return async (request) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(request.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hemas-Signature-256": request.signatureHeader,
          "X-Hemas-Event-Id": request.eventId,
          "X-Hemas-Timestamp": String(request.timestampMs),
        },
        body: request.rawBody,
        signal: controller.signal,
      });
      return { responseStatus: response.status };
    } finally {
      clearTimeout(timer);
    }
  };
}

function callbackTransportForBoundary(mode: "emulator" | "cloud"): CallbackTransport {
  const egressEnabled =
    mode === "cloud" && process.env.HEMAS_ENTERPRISE_CALLBACK_EGRESS_ENABLED === "true";
  return egressEnabled ? realCallbackTransport() : syntheticCallbackTransport;
}

function workspaceCollection(db: Firestore, collectionId: string) {
  return db
    .collection("workspaces")
    .doc(ENTERPRISE_WORKSPACE_ID)
    .collection(collectionId);
}

/**
 * Private bounded runner. This slice intentionally provisions no Cloud
 * Scheduler; an authorized operator invokes the callable, mirroring the
 * canary outbox reconciler.
 */
export const enterpriseRunBulkDispatch = onCall(
  {
    memory: "256MiB",
    timeoutSeconds: 120,
    maxInstances: 1,
    concurrency: 1,
  },
  async (request: CallableRequest<unknown>) => {
    const boundary = enterpriseBoundaryOrNull();
    if (!boundary) {
      throw new HttpsError("failed-precondition", "The Enterprise gateway is not enabled.");
    }
    if (
      request.auth?.token.email_verified !== true ||
      request.auth.token.hemasEnterpriseApi !== true
    ) {
      throw new HttpsError("permission-denied", "This identity cannot run Enterprise dispatch.");
    }
    const db = getEnterpriseFirestore(boundary.projectId);
    const membership = await db
      .doc(`workspaces/${ENTERPRISE_WORKSPACE_ID}/members/${request.auth.uid}`)
      .get();
    const member = membership.data();
    if (!membership.exists || member?.status !== "active" || member.role !== "tenant_admin") {
      throw new HttpsError("permission-denied", "Enterprise dispatch requires a tenant admin seat.");
    }

    const nowMs = Date.now();
    const counts = { sent: 0, recovered: 0, skipped: 0, dlrEnqueued: 0, callbacksDelivered: 0, callbacksRequeued: 0, callbacksDeadLettered: 0 };

    const queuedSnapshot = await workspaceCollection(db, ENTERPRISE_BULK_JOB_ITEMS_COLLECTION)
      .where("status", "==", "queued")
      .limit(ENTERPRISE_BULK_DISPATCH_BATCH_SIZE)
      .get();
    const staleSnapshot = await workspaceCollection(db, ENTERPRISE_BULK_JOB_ITEMS_COLLECTION)
      .where("status", "==", "sending")
      .limit(20)
      .get();

    for (const doc of [...queuedSnapshot.docs, ...staleSnapshot.docs]) {
      const data = doc.data();
      const jobId = data.jobId;
      if (typeof jobId !== "string") continue;
      try {
        const result = await dispatchEnterpriseBulkItem({
          db,
          jobId,
          itemId: doc.id,
          nowMs,
          sha256Hex,
        });
        if (result.outcome === "sent" && result.sent) {
          counts.sent += 1;
          counts.dlrEnqueued += await enqueueEnterpriseDlrCallbacks({
            db,
            wamid: result.sent.wamid,
            clientBatchId: result.sent.clientBatchId,
            clientReference: result.sent.clientReference,
            recipientLast4: result.sent.toNumberLast4,
            nowMs,
            sha256Hex,
          });
        } else if (result.outcome === "recovered_stale") {
          counts.recovered += 1;
        } else {
          counts.skipped += 1;
        }
      } catch (error) {
        logger.warn("enterprise: item dispatch failed closed", {
          code: error instanceof EnterpriseBulkError ? error.code : "unknown",
        });
      }
    }

    const dueSnapshot = await workspaceCollection(db, ENTERPRISE_CALLBACK_DELIVERIES_COLLECTION)
      .where("nextAttemptAtMs", "<=", nowMs)
      .orderBy("nextAttemptAtMs", "asc")
      .limit(20)
      .get();
    const dueDeliveries = selectDueCallbackDeliveries(
      dueSnapshot.docs.map((doc) => doc.data()),
      nowMs,
      20,
    );
    const transport = callbackTransportForBoundary(boundary.mode);
    for (const claim of dueDeliveries) {
      try {
        const outcome = await deliverEnterpriseCallback({
          db,
          deliveryId: claim.deliveryId,
          nowMs,
          transport,
          hmacSha256Hex,
        });
        if (outcome === "delivered") counts.callbacksDelivered += 1;
        else if (outcome === "requeued") counts.callbacksRequeued += 1;
        else if (outcome === "dead_letter") counts.callbacksDeadLettered += 1;
      } catch (error) {
        logger.warn("enterprise: callback delivery failed closed", {
          code: error instanceof EnterpriseCallbackError ? error.code : "unknown",
        });
      }
    }

    logger.info("enterprise: dispatch pass complete", counts);
    return { ...counts, containsMessageContent: false };
  },
);
