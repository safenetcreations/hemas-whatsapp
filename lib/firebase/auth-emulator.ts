import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  getIdToken,
  type Auth,
  type User,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from "firebase/firestore";
import {
  evaluateLocalAuthPolicy,
  isExpectedSyntheticIdentity,
  syntheticAuthProjectId,
} from "./auth-policy";
import {
  cloudDemoFirebaseConfig,
  currentCloudDemoRuntime,
  type CloudDemoRuntimeResult,
} from "./runtime-mode";

const authAppName = "hemas-connect-local-auth";
const cloudAuthAppName = "hemas-connect-cloud-demo-auth";
const authEmulatorUrl = "http://127.0.0.1:9099";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "demo-api-key",
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ??
    `${syntheticAuthProjectId}.firebaseapp.com`,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? syntheticAuthProjectId,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "demo-app-id",
};

export class LocalAuthBoundaryError extends Error {
  constructor(
    message: string,
    readonly reason: "configuration" | "identity" | "emulator_unavailable",
  ) {
    super(message);
    this.name = "LocalAuthBoundaryError";
  }
}

declare global {
  var __hemasLocalEmulatorAuth: Auth | undefined;
  var __hemasLocalEmulatorFirestore: Firestore | undefined;
}

function currentCloudRuntimeOrThrow(): CloudDemoRuntimeResult {
  const cloudRuntime = currentCloudDemoRuntime();
  if (cloudRuntime.refused) {
    throw new LocalAuthBoundaryError(
      `Cloud demo Firebase Auth refused unsafe configuration: ${cloudRuntime.reason}.`,
      "configuration",
    );
  }
  return cloudRuntime;
}

function currentPolicy() {
  if (typeof window === "undefined") {
    throw new LocalAuthBoundaryError(
      "Local Firebase Auth can only initialize in a browser.",
      "configuration",
    );
  }

  return evaluateLocalAuthPolicy({
    hostname: window.location.hostname,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appStage: process.env.NEXT_PUBLIC_APP_STAGE,
    useFirebaseEmulators: process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS,
    externalMessagingEnabled: process.env.NEXT_PUBLIC_EXTERNAL_MESSAGING_ENABLED,
    realPatientDataEnabled: process.env.NEXT_PUBLIC_REAL_PATIENT_DATA_ENABLED,
  });
}

function getLocalEmulatorApp(): FirebaseApp {
  if (typeof window === "undefined") {
    throw new LocalAuthBoundaryError(
      "Local Firebase Auth can only initialize in a browser.",
      "configuration",
    );
  }

  const cloudRuntime = currentCloudRuntimeOrThrow();
  if (cloudRuntime.active) {
    const existingCloudApp = getApps().find((app) => app.name === cloudAuthAppName);
    return (
      existingCloudApp ??
      initializeApp(cloudDemoFirebaseConfig(cloudRuntime), cloudAuthAppName)
    );
  }

  const policy = currentPolicy();
  if (!policy.allowed) {
    throw new LocalAuthBoundaryError(
      `Local Firebase Auth refused unsafe configuration: ${policy.reason}.`,
      "configuration",
    );
  }

  const existingApp = getApps().find((app) => app.name === authAppName);
  return existingApp ?? initializeApp(firebaseConfig, authAppName);
}

export function getLocalEmulatorAuth(): Auth {
  const app = getLocalEmulatorApp();
  if (globalThis.__hemasLocalEmulatorAuth) {
    return globalThis.__hemasLocalEmulatorAuth;
  }

  const auth = getAuth(app);

  if (!currentCloudRuntimeOrThrow().active) {
    // This is deliberately unconditional after the policy check. The dedicated
    // Auth app has no code path that can fall through to a cloud Auth endpoint.
    connectAuthEmulator(auth, authEmulatorUrl, { disableWarnings: true });
  }
  globalThis.__hemasLocalEmulatorAuth = auth;
  return auth;
}

export function getLocalEmulatorFirestore(): Firestore {
  const app = getLocalEmulatorApp();
  if (globalThis.__hemasLocalEmulatorFirestore) {
    return globalThis.__hemasLocalEmulatorFirestore;
  }

  const db = getFirestore(app);
  if (!currentCloudRuntimeOrThrow().active) {
    // Like Auth, this connection is unconditional after the local policy passes.
    // The workspace session therefore has no cloud Firestore fallback path.
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
  globalThis.__hemasLocalEmulatorFirestore = db;
  return db;
}

export async function verifySyntheticEmulatorUser(user: User): Promise<void> {
  if (!isExpectedSyntheticIdentity(user.email)) {
    throw new LocalAuthBoundaryError(
      "Only the seeded synthetic identity may enter this local workspace.",
      "identity",
    );
  }

  try {
    // Force a token refresh so a persisted browser user is not accepted when
    // the Auth emulator is stopped or unavailable.
    await getIdToken(user, true);
  } catch {
    throw new LocalAuthBoundaryError(
      "The Firebase Auth emulator could not verify the local session.",
      "emulator_unavailable",
    );
  }
}

export function describeLocalAuthError(error: unknown): string {
  if (error instanceof LocalAuthBoundaryError) {
    if (error.reason === "identity") {
      return "This browser identity is not the seeded synthetic account. The portal remains locked.";
    }
    if (error.reason === "configuration") {
      return "Local authentication is disabled because the environment is not an approved synthetic emulator configuration.";
    }
    return "Firebase Auth emulator is unavailable. Start the local emulators and try again.";
  }

  const code =
    typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code.includes("auth/network-request-failed")) {
    return "Firebase Auth emulator is not reachable. Start `npm run emulators`, then seed the synthetic account.";
  }
  if (
    code.includes("auth/invalid-credential") ||
    code.includes("auth/user-not-found") ||
    code.includes("auth/wrong-password")
  ) {
    return "The synthetic account is missing or the fixture credentials do not match. Run `npm run emulators:seed`.";
  }
  if (code.includes("auth/too-many-requests")) {
    return "The local emulator temporarily refused more attempts. Wait briefly, then try again.";
  }
  return "Local sign-in failed safely. No cloud or production account was contacted.";
}
