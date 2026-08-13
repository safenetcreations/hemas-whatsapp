import { getApp, getApps, initializeApp } from "firebase-admin/app";
import type { Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { assertDemoAuditEmulatorBoundary } from "../audit-firestore.js";
import { ConfigValidationError, loadRuntimeConfig } from "../config.js";
import { FailClosedError } from "../errors.js";
import { getHemasFirestore } from "../firestore-target.js";
import { parseSyntheticCareControlInput } from "./contracts.js";
import { isCloudDemoEnabled } from "../governed-project.js";
import { controlSyntheticCareEnrollment } from "./service.js";

function emulatorBoundary(): {
  projectId: string;
  firestoreEmulatorHost: string | undefined;
  cloudDemoEnabled: boolean;
} {
  return {
    projectId: process.env.GCLOUD_PROJECT ?? "",
    firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
    cloudDemoEnabled: isCloudDemoEnabled(),
  };
}
function getDemoFirestore(boundary: ReturnType<typeof emulatorBoundary>): Firestore {
  assertDemoAuditEmulatorBoundary(boundary);
  const app = getApps().length > 0 ? getApp() : initializeApp({ projectId: boundary.projectId });
  if (app.options.projectId && app.options.projectId !== boundary.projectId) throw new FailClosedError("invalid_audit_project", "The Admin app does not match the synthetic demo project.");
  return getHemasFirestore(app);
}
function authenticatedActor(request: CallableRequest<unknown>): { uid: string; authTime: Date } {
  if (!request.auth) throw new FailClosedError("authentication_required", "Authentication is required.");
  const authTime = request.auth.token.auth_time;
  if (typeof authTime !== "number" || !Number.isFinite(authTime)) throw new FailClosedError("authentication_required", "Authentication time is unavailable.");
  return { uid: request.auth.uid, authTime: new Date(authTime * 1_000) };
}
function callableError(error: unknown): HttpsError {
  if (error instanceof ConfigValidationError) return new HttpsError("failed-precondition", "The synthetic care runtime is not ready.");
  if (!(error instanceof FailClosedError)) return new HttpsError("internal", "The synthetic care service failed closed.");
  if (error.code === "authentication_required") return new HttpsError("unauthenticated", error.message);
  if (error.code === "care_revision_conflict") return new HttpsError("aborted", error.message);
  if (error.code === "idempotency_conflict" || error.code.includes("collision")) return new HttpsError("already-exists", error.message);
  if (error.code === "invalid_service_request" || error.code.startsWith("invalid_")) return new HttpsError("invalid-argument", error.message);
  if (error.code.includes("schedule") || error.code.includes("transition") || error.code === "recent_auth_required") return new HttpsError("failed-precondition", error.message);
  return new HttpsError("permission-denied", error.message);
}

export const demoControlSyntheticCareEnrollment = onCall(
  { memory: "128MiB", timeoutSeconds: 30, maxInstances: 3, concurrency: 10, enforceAppCheck: false },
  async (request) => {
    try {
      const boundary = emulatorBoundary();
      const actor = authenticatedActor(request);
      const parsed = parseSyntheticCareControlInput(request.data);
      return await controlSyntheticCareEnrollment({
        db: getDemoFirestore(boundary), config: loadRuntimeConfig(), emulator: boundary,
        actor, request: parsed,
      });
    } catch (error) {
      throw callableError(error);
    }
  },
);
