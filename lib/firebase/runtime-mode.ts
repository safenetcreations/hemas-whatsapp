import {
  HEMAS_CLOUD_FIREBASE_DESCRIPTOR,
  evaluateHemasCloudFirebaseConfig,
  type HemasCloudFirebaseEnvironment,
} from "./cloud-project-config";

/**
 * Governed cloud demo runtime resolver.
 *
 * The product has exactly two governed homes:
 *
 * 1. "local demo" — the default. Loopback Firebase emulators under the
 *    reserved `demo-hemas-connect` project. Everything behaves exactly as
 *    before this module existed.
 * 2. "cloud demo" — the SAME synthetic demo, served from Firebase App
 *    Hosting against the Hemas-owned `hemas-whatsapp` project. It activates
 *    only when every condition below holds, and a UAT stage with an invalid
 *    configuration REFUSES to run rather than falling back to emulators or
 *    any partial mode.
 *
 * External messaging and real-patient-data gates are unchanged: both remain
 * literal-"false" hard stops in every mode.
 */
export type CloudDemoRuntimeEnvironment = HemasCloudFirebaseEnvironment &
  Readonly<{
    NEXT_PUBLIC_APP_STAGE?: string;
    NEXT_PUBLIC_FIREBASE_PROJECT_ID?: string;
    NEXT_PUBLIC_USE_FIREBASE_EMULATORS?: string;
    NEXT_PUBLIC_EXTERNAL_MESSAGING_ENABLED?: string;
    NEXT_PUBLIC_REAL_PATIENT_DATA_ENABLED?: string;
    NEXT_PUBLIC_HEMAS_CLOUD_ALLOWED_HOST?: string;
  }>;

export type CloudDemoRuntimeResult =
  | Readonly<{ active: false; refused: false }>
  | Readonly<{
      active: false;
      refused: true;
      reason:
        | "emulators_not_disabled"
        | "project_id_mismatch"
        | "external_messaging_enabled"
        | "real_patient_data_enabled"
        | "cloud_runtime_not_approved"
        | "hostname_not_allowed";
    }>
  | Readonly<{
      active: true;
      refused: false;
      apiKey: string;
      descriptor: typeof HEMAS_CLOUD_FIREBASE_DESCRIPTOR;
    }>;

export function isAllowedCloudDemoHostname(
  hostname: string,
  allowedHost: string | undefined,
): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  ) {
    // Loopback stays allowed so an operator can verify a production build
    // locally before App Hosting serves it. Activation still requires the
    // full explicit UAT environment; a default local start never gets here.
    return true;
  }
  const allowed = allowedHost?.trim().toLowerCase();
  return Boolean(allowed && normalized === allowed);
}

export function evaluateCloudDemoRuntime(
  environment: CloudDemoRuntimeEnvironment,
  hostname: string,
): CloudDemoRuntimeResult {
  if ((environment.NEXT_PUBLIC_APP_STAGE ?? "demo") !== "uat") {
    return { active: false, refused: false };
  }

  // From here on the operator has explicitly asked for the connected UAT
  // stage; any invalid combination refuses instead of degrading.
  if ((environment.NEXT_PUBLIC_USE_FIREBASE_EMULATORS ?? "true") !== "false") {
    return { active: false, refused: true, reason: "emulators_not_disabled" };
  }
  if (
    environment.NEXT_PUBLIC_FIREBASE_PROJECT_ID !==
    HEMAS_CLOUD_FIREBASE_DESCRIPTOR.projectId
  ) {
    return { active: false, refused: true, reason: "project_id_mismatch" };
  }
  if ((environment.NEXT_PUBLIC_EXTERNAL_MESSAGING_ENABLED ?? "false") !== "false") {
    return { active: false, refused: true, reason: "external_messaging_enabled" };
  }
  if ((environment.NEXT_PUBLIC_REAL_PATIENT_DATA_ENABLED ?? "false") !== "false") {
    return { active: false, refused: true, reason: "real_patient_data_enabled" };
  }

  const cloudConfig = evaluateHemasCloudFirebaseConfig(environment);
  if (cloudConfig.status !== "runtime-approved") {
    return { active: false, refused: true, reason: "cloud_runtime_not_approved" };
  }

  if (
    !isAllowedCloudDemoHostname(
      hostname,
      environment.NEXT_PUBLIC_HEMAS_CLOUD_ALLOWED_HOST,
    )
  ) {
    return { active: false, refused: true, reason: "hostname_not_allowed" };
  }

  return {
    active: true,
    refused: false,
    apiKey: cloudConfig.apiKey,
    descriptor: HEMAS_CLOUD_FIREBASE_DESCRIPTOR,
  };
}

/**
 * Browser-bound resolver reading the statically inlined NEXT_PUBLIC_*
 * values. Next.js replaces each property access at build time, so every
 * key must be referenced explicitly.
 */
export function currentCloudDemoRuntime(): CloudDemoRuntimeResult {
  if (typeof window === "undefined") {
    return { active: false, refused: false };
  }
  return evaluateCloudDemoRuntime(
    {
      NEXT_PUBLIC_APP_STAGE: process.env.NEXT_PUBLIC_APP_STAGE,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      NEXT_PUBLIC_USE_FIREBASE_EMULATORS:
        process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS,
      NEXT_PUBLIC_EXTERNAL_MESSAGING_ENABLED:
        process.env.NEXT_PUBLIC_EXTERNAL_MESSAGING_ENABLED,
      NEXT_PUBLIC_REAL_PATIENT_DATA_ENABLED:
        process.env.NEXT_PUBLIC_REAL_PATIENT_DATA_ENABLED,
      NEXT_PUBLIC_HEMAS_CLOUD_ALLOWED_HOST:
        process.env.NEXT_PUBLIC_HEMAS_CLOUD_ALLOWED_HOST,
      NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_DESCRIPTOR_ENABLED:
        process.env.NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_DESCRIPTOR_ENABLED,
      NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_RUNTIME_ENABLED:
        process.env.NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_RUNTIME_ENABLED,
      NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_ANALYTICS_ENABLED:
        process.env.NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_ANALYTICS_ENABLED,
      NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_PROJECT_ID:
        process.env.NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_PROJECT_ID,
      NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_API_KEY:
        process.env.NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_API_KEY,
      NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_AUTH_DOMAIN:
        process.env.NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_AUTH_DOMAIN,
      NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_STORAGE_BUCKET:
        process.env.NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_STORAGE_BUCKET,
      NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_MESSAGING_SENDER_ID:
        process.env.NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_MESSAGING_SENDER_ID,
      NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_APP_ID:
        process.env.NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_APP_ID,
      NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_MEASUREMENT_ID:
        process.env.NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_MEASUREMENT_ID,
    },
    window.location.hostname,
  );
}

export function cloudDemoFirebaseConfig(
  runtime: Extract<CloudDemoRuntimeResult, { active: true }>,
): {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
} {
  return {
    apiKey: runtime.apiKey,
    authDomain: runtime.descriptor.authDomain,
    projectId: runtime.descriptor.projectId,
    storageBucket: runtime.descriptor.storageBucket,
    messagingSenderId: runtime.descriptor.messagingSenderId,
    appId: runtime.descriptor.appId,
  };
}
