import { createHash } from "node:crypto";
import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { logger } from "firebase-functions";
import type { Response } from "firebase-functions/v1";
import { onRequest } from "firebase-functions/v2/https";

import { FailClosedError } from "../errors.js";
import { getHemasFirestore } from "../firestore-target.js";
import {
  authorizeSyntheticIngressRoute,
  loadSyntheticIngressBoundary,
  type AuthorizedSyntheticIngressRoute,
} from "./boundary.js";
import {
  authenticateAndParseSyntheticWebhook,
  SYNTHETIC_RAW_CONTENT_TYPE,
  SYNTHETIC_SIGNATURE_HEADER,
  verifySyntheticWebhookChallenge,
} from "./contracts.js";
import {
  createAdminFirestoreIngressStore,
  processSyntheticWebhookEvent,
} from "./persistence.js";

const SERVICE = "hemas-connect-synthetic-ingress" as const;
const ADMIN_APP_NAME = "hemas-connect-synthetic-ingress-demo";

function getAuthorizedDemoStore(authorization: AuthorizedSyntheticIngressRoute) {
  const { projectId } = authorization.boundary;
  const existing = getApps().find((app) => app.name === ADMIN_APP_NAME);
  const app = existing ?? initializeApp({ projectId }, ADMIN_APP_NAME);
  if (app.options.projectId !== projectId || getApp(ADMIN_APP_NAME) !== app) {
    throw new FailClosedError(
      "synthetic_ingress_boundary_denied",
      "Synthetic ingress Admin SDK binding does not match the demo project.",
    );
  }
  return createAdminFirestoreIngressStore({
    db: getHemasFirestore(app),
    authorization,
  });
}

function responseStatus(error: FailClosedError): number {
  if (
    error.code === "synthetic_ingress_boundary_denied" ||
    error.code.startsWith("invalid_audit_") ||
    error.code === "audit_emulator_required"
  ) return 503;
  if (error.code === "invalid_synthetic_webhook_signature") return 401;
  if (error.code === "invalid_synthetic_verification_token") return 403;
  if (
    error.code === "synthetic_route_denied" ||
    error.code === "synthetic_workspace_denied" ||
    error.code === "synthetic_record_scope_denied"
  ) return 403;
  if (
    error.code === "synthetic_webhook_idempotency_conflict" ||
    error.code === "synthetic_message_not_found" ||
    error.code === "synthetic_ingress_state_invalid"
  ) return 409;
  return 400;
}

function reject(response: Response, error: unknown): void {
  const failure = error instanceof FailClosedError
    ? error
    : new FailClosedError("synthetic_ingress_failed_closed", "Synthetic ingress failed closed.");
  logger.warn("Synthetic ingress request rejected.", {
    code: failure.code,
    synthetic: true,
    payloadLogged: false,
    networkCalls: 0,
  });
  response.status(responseStatus(failure)).json({
    service: SERVICE,
    status: "rejected",
    code: failure.code,
    synthetic: true,
    safeMode: true,
    payloadLogged: false,
    networkCalls: 0,
  });
}

export const syntheticInboundWebhook = onRequest(
  {
    cors: false,
    memory: "128MiB",
    timeoutSeconds: 15,
    maxInstances: 3,
    concurrency: 1,
    cpu: "gcf_gen1",
  },
  async (request, response) => {
    response.set({
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    });

    try {
      const boundary = loadSyntheticIngressBoundary();

      if (request.method === "GET") {
        const challenge = verifySyntheticWebhookChallenge({
          query: request.query,
          syntheticFixtureSecret: boundary.syntheticFixtureSecret,
        });
        response.type("text/plain; charset=utf-8").status(200).send(challenge);
        return;
      }

      if (request.method !== "POST") {
        response.set("Allow", "GET, POST");
        response.status(405).json({
          service: SERVICE,
          status: "method_not_allowed",
          synthetic: true,
          safeMode: true,
          networkCalls: 0,
        });
        return;
      }

      if (!Buffer.isBuffer(request.rawBody)) {
        throw new FailClosedError(
          "invalid_synthetic_webhook_body",
          "The raw synthetic webhook body is required.",
        );
      }
      const envelope = authenticateAndParseSyntheticWebhook({
        rawBody: request.rawBody,
        signatureHeader: request.get(SYNTHETIC_SIGNATURE_HEADER),
        syntheticFixtureSecret: boundary.syntheticFixtureSecret,
      });
      const contentType = request.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      // Cloud Functions parses application/json before user code. Requiring a
      // raw octet stream is what makes signature verification-before-JSON a
      // real transport invariant instead of only an internal call-order claim.
      if (contentType !== SYNTHETIC_RAW_CONTENT_TYPE) {
        throw new FailClosedError(
          "invalid_synthetic_webhook_content_type",
          `Synthetic webhook content type must be ${SYNTHETIC_RAW_CONTENT_TYPE}.`,
        );
      }
      const authorization = authorizeSyntheticIngressRoute(boundary, envelope.routeRef);
      const store = getAuthorizedDemoStore(authorization);
      const requestHash = createHash("sha256").update(request.rawBody).digest("hex");
      const result = await processSyntheticWebhookEvent({
        store,
        authorization,
        envelope,
        requestHash,
      });
      response.status(200).json({
        service: SERVICE,
        status: "accepted",
        receipt: result,
        safeMode: true,
        payloadLogged: false,
        externalDispatch: "disabled",
      });
    } catch (error) {
      reject(response, error);
    }
  },
);
