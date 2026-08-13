import { getApp, getApps, initializeApp } from "firebase-admin/app";
import type { Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { ConfigValidationError, loadRuntimeConfig } from "../config.js";
import { FailClosedError } from "../errors.js";
import { getHemasFirestore } from "../firestore-target.js";
import {
  assertAiGovernanceRuntimeBoundary,
  parseAiRetrospectiveRequestInput,
  type AiGovernanceActor,
  type AiGovernanceEmulatorBoundary,
} from "./contracts.js";
import { isCloudDemoEnabled } from "../governed-project.js";
import { recordSyntheticAiRetrospective } from "./service.js";

function emulatorBoundary(): AiGovernanceEmulatorBoundary {
  return {
    projectId: process.env.GCLOUD_PROJECT ?? "",
    firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
    cloudDemoEnabled: isCloudDemoEnabled(),
  };
}

function getDemoFirestore(boundary: AiGovernanceEmulatorBoundary): Firestore {
  const app = getApps().length > 0
    ? getApp()
    : initializeApp({ projectId: boundary.projectId });
  if (app.options.projectId && app.options.projectId !== boundary.projectId) {
    throw new FailClosedError(
      "invalid_ai_governance_project",
      "The Admin app does not match the synthetic demo project.",
    );
  }
  return getHemasFirestore(app);
}

function authenticatedActor(request: CallableRequest<unknown>): AiGovernanceActor {
  if (!request.auth) {
    throw new FailClosedError("authentication_required", "Authentication is required.");
  }
  const authTime = request.auth.token.auth_time;
  if (typeof authTime !== "number" || !Number.isFinite(authTime)) {
    throw new FailClosedError(
      "authentication_required",
      "Authentication time is unavailable.",
    );
  }
  return { uid: request.auth.uid, authTime: new Date(authTime * 1_000) };
}

function callableError(error: unknown): HttpsError {
  if (error instanceof ConfigValidationError) {
    return new HttpsError(
      "failed-precondition",
      "The synthetic AI governance runtime is not ready.",
    );
  }
  if (!(error instanceof FailClosedError)) {
    return new HttpsError("internal", "The synthetic AI governance service failed closed.");
  }
  if (error.code === "authentication_required") {
    return new HttpsError("unauthenticated", error.message);
  }
  if (error.code === "idempotency_conflict") {
    return new HttpsError("already-exists", error.message);
  }
  if (
    error.code === "recent_auth_required" ||
    error.code === "ai_governance_service_disabled" ||
    error.code === "invalid_ai_governance_project"
  ) {
    return new HttpsError("failed-precondition", error.message);
  }
  if (
    error.code === "invalid_service_request" ||
    error.code === "invalid_idempotency_key" ||
    error.code === "invalid_ai_governance_time"
  ) {
    return new HttpsError("invalid-argument", error.message);
  }
  if (
    error.code === "ai_authorization_denied" ||
    error.code === "ai_scope_denied"
  ) {
    return new HttpsError("permission-denied", error.message);
  }
  return new HttpsError("failed-precondition", "AI evidence validation failed closed.");
}

export const demoRecordSyntheticAiRetrospective = onCall(
  {
    memory: "128MiB",
    timeoutSeconds: 30,
    maxInstances: 3,
    concurrency: 10,
    enforceAppCheck: false,
  },
  async (request) => {
    try {
      const actor = authenticatedActor(request);
      const parsed = parseAiRetrospectiveRequestInput(request.data);
      const config = loadRuntimeConfig();
      const boundary = emulatorBoundary();
      // Repeat the complete boundary before Admin SDK initialization or I/O.
      assertAiGovernanceRuntimeBoundary(config, boundary, parsed.workspaceId);
      return await recordSyntheticAiRetrospective({
        db: getDemoFirestore(boundary),
        config,
        emulator: boundary,
        actor,
        request: parsed,
      });
    } catch (error) {
      throw callableError(error);
    }
  },
);
