import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { assertDemoAuditEmulatorBoundary } from "../audit-firestore.js";
import { ConfigValidationError, loadRuntimeConfig } from "../config.js";
import { FailClosedError } from "../errors.js";
import { parseSyntheticAppointmentRequestInput } from "./contracts.js";
import { requestSyntheticAppointmentAction } from "./service.js";

function getDemoFirestore(): Firestore {
  const projectId = process.env.GCLOUD_PROJECT ?? "";
  assertDemoAuditEmulatorBoundary({
    projectId,
    firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
  });
  const app = getApps().length > 0 ? getApp() : initializeApp({ projectId });
  if (app.options.projectId && app.options.projectId !== projectId) {
    throw new FailClosedError(
      "invalid_audit_project",
      "The initialized Admin app does not match the emulator-safe demo project.",
    );
  }
  return getFirestore(app);
}

function authenticatedActor(request: CallableRequest<unknown>): {
  readonly uid: string;
  readonly authTime: Date;
} {
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

function mapCallableError(error: unknown): HttpsError {
  if (error instanceof ConfigValidationError) {
    return new HttpsError(
      "failed-precondition",
      "The synthetic appointment service configuration is not ready.",
    );
  }
  if (!(error instanceof FailClosedError)) {
    return new HttpsError("internal", "The synthetic appointment service failed closed.");
  }
  if (error.code === "authentication_required") {
    return new HttpsError("unauthenticated", error.message);
  }
  if (error.code === "appointment_revision_conflict") {
    return new HttpsError("aborted", error.message);
  }
  if (error.code === "idempotency_conflict" || error.code === "appointment_event_collision") {
    return new HttpsError("already-exists", error.message);
  }
  if (
    error.code === "appointment_service_disabled" ||
    error.code === "recent_auth_required" ||
    error.code === "appointment_denied"
  ) {
    return new HttpsError("failed-precondition", error.message);
  }
  if (error.code === "invalid_service_request" || error.code.startsWith("invalid_")) {
    return new HttpsError("invalid-argument", error.message);
  }
  return new HttpsError("permission-denied", error.message);
}

export const demoRequestSyntheticAppointment = onCall(
  {
    memory: "128MiB",
    timeoutSeconds: 10,
    maxInstances: 3,
    concurrency: 10,
    enforceAppCheck: false,
  },
  async (request) => {
    try {
      const actor = authenticatedActor(request);
      const parsed = parseSyntheticAppointmentRequestInput(request.data);
      const config = loadRuntimeConfig();
      return await requestSyntheticAppointmentAction({
        db: getDemoFirestore(),
        config,
        actor,
        request: parsed,
      });
    } catch (error) {
      throw mapCallableError(error);
    }
  },
);
