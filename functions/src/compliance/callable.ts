import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  HttpsError,
  onCall,
  type CallableRequest,
} from "firebase-functions/v2/https";
import { assertDemoAuditEmulatorBoundary } from "../audit-firestore.js";
import { FailClosedError } from "../errors.js";
import { parseListComplianceAuditEventsInput } from "./contracts.js";
import { createFirestoreComplianceAuditSource } from "./firestore.js";
import { listSyntheticComplianceAuditEvents } from "./service.js";

function emulatorBoundary(): {
  readonly projectId: string;
  readonly firestoreEmulatorHost: string | undefined;
} {
  return {
    projectId: process.env.GCLOUD_PROJECT ?? "",
    firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
  };
}

function getDemoFirestore(
  boundary: ReturnType<typeof emulatorBoundary>,
): Firestore {
  assertDemoAuditEmulatorBoundary(boundary);
  const app = getApps().length > 0
    ? getApp()
    : initializeApp({ projectId: boundary.projectId });
  if (app.options.projectId && app.options.projectId !== boundary.projectId) {
    throw new FailClosedError(
      "invalid_audit_project",
      "The Admin app does not match the synthetic demo project.",
    );
  }
  return getFirestore(app);
}

function authenticatedUid(request: CallableRequest<unknown>): string {
  if (!request.auth) {
    throw new FailClosedError(
      "authentication_required",
      "Authentication is required.",
    );
  }
  return request.auth.uid;
}

function callableError(error: unknown): HttpsError {
  if (!(error instanceof FailClosedError)) {
    return new HttpsError(
      "internal",
      "The synthetic Compliance timeline failed closed.",
    );
  }
  if (error.code === "authentication_required") {
    return new HttpsError("unauthenticated", error.message);
  }
  if (
    error.code === "invalid_compliance_request" ||
    error.code === "invalid_compliance_cursor"
  ) {
    return new HttpsError("invalid-argument", error.message);
  }
  if (error.code === "compliance_access_denied") {
    return new HttpsError("permission-denied", error.message);
  }
  return new HttpsError(
    "failed-precondition",
    "The minimized Compliance timeline is unavailable.",
  );
}

export const listComplianceAuditEvents = onCall(
  {
    memory: "128MiB",
    timeoutSeconds: 15,
    maxInstances: 3,
    concurrency: 10,
    enforceAppCheck: false,
  },
  async (request) => {
    try {
      const boundary = emulatorBoundary();
      const actor = { uid: authenticatedUid(request) };
      const parsed = parseListComplianceAuditEventsInput(request.data);
      const source = createFirestoreComplianceAuditSource(
        getDemoFirestore(boundary),
      );
      return await listSyntheticComplianceAuditEvents({
        source,
        actor,
        request: parsed,
      });
    } catch (error) {
      throw callableError(error);
    }
  },
);
