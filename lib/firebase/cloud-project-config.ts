/**
 * Identity-only descriptor for the future Hemas cloud/UAT Firebase Web app.
 *
 * This module deliberately does not initialize a Firebase SDK, Analytics, or
 * any networked service. The API key is accepted only as validation input and
 * is never returned by the readiness result.
 */

export const HEMAS_CLOUD_FIREBASE_DESCRIPTOR = Object.freeze({
  projectId: "hemas-whatsapp",
  authDomain: "hemas-whatsapp.firebaseapp.com",
  storageBucket: "hemas-whatsapp.firebasestorage.app",
  messagingSenderId: "504137546315",
  appId: "1:504137546315:web:7c2108b26a0639893b2bce",
  measurementId: "G-BN46X4FB7W",
} as const);

export type HemasCloudFirebaseEnvironment = Readonly<{
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_DESCRIPTOR_ENABLED?: string;
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_RUNTIME_ENABLED?: string;
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_ANALYTICS_ENABLED?: string;
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_PROJECT_ID?: string;
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_API_KEY?: string;
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_AUTH_DOMAIN?: string;
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_STORAGE_BUCKET?: string;
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_MESSAGING_SENDER_ID?: string;
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_APP_ID?: string;
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_MEASUREMENT_ID?: string;
}>;

export type HemasCloudFirebaseConfigResult =
  | Readonly<{
      status: "disabled";
      configurationValid: false;
      runtimeActivationAllowed: false;
      reason: "disabled_by_default";
    }>
  | Readonly<{
      status: "invalid";
      configurationValid: false;
      runtimeActivationAllowed: false;
      reason:
        | "invalid_descriptor_enable_flag"
        | "runtime_activation_not_permitted"
        | "analytics_not_permitted"
        | "invalid_api_key"
        | "project_id_mismatch"
        | "auth_domain_mismatch"
        | "storage_bucket_mismatch"
        | "messaging_sender_id_mismatch"
        | "app_id_mismatch"
        | "measurement_id_mismatch";
    }>
  | Readonly<{
      status: "configured";
      configurationValid: true;
      runtimeActivationAllowed: false;
      analyticsEnabled: false;
      descriptor: typeof HEMAS_CLOUD_FIREBASE_DESCRIPTOR;
    }>
  | Readonly<{
      /**
       * The governed cloud demo runtime is explicitly approved. This is the
       * ONLY state that permits initializing a Firebase SDK against the
       * Hemas cloud project, and it still keeps Analytics, external
       * messaging and real-patient gates hard-off.
       */
      status: "runtime-approved";
      configurationValid: true;
      runtimeActivationAllowed: true;
      analyticsEnabled: false;
      apiKey: string;
      descriptor: typeof HEMAS_CLOUD_FIREBASE_DESCRIPTOR;
    }>;

const firebaseWebApiKeyPattern = /^AIza[0-9A-Za-z_-]{35}$/;

export function evaluateHemasCloudFirebaseConfig(
  environment: HemasCloudFirebaseEnvironment,
): HemasCloudFirebaseConfigResult {
  const descriptorEnableFlag =
    environment.NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_DESCRIPTOR_ENABLED;

  if (
    descriptorEnableFlag === undefined ||
    descriptorEnableFlag === "" ||
    descriptorEnableFlag === "false"
  ) {
    return {
      status: "disabled",
      configurationValid: false,
      runtimeActivationAllowed: false,
      reason: "disabled_by_default",
    };
  }

  if (descriptorEnableFlag !== "true") {
    return {
      status: "invalid",
      configurationValid: false,
      runtimeActivationAllowed: false,
      reason: "invalid_descriptor_enable_flag",
    };
  }

  const runtimeFlag = environment.NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_RUNTIME_ENABLED;
  if (runtimeFlag !== "false" && runtimeFlag !== "true") {
    return {
      status: "invalid",
      configurationValid: false,
      runtimeActivationAllowed: false,
      reason: "runtime_activation_not_permitted",
    };
  }

  if (environment.NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_ANALYTICS_ENABLED !== "false") {
    return {
      status: "invalid",
      configurationValid: false,
      runtimeActivationAllowed: false,
      reason: "analytics_not_permitted",
    };
  }

  if (
    !firebaseWebApiKeyPattern.test(
      environment.NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_API_KEY ?? "",
    )
  ) {
    return {
      status: "invalid",
      configurationValid: false,
      runtimeActivationAllowed: false,
      reason: "invalid_api_key",
    };
  }

  if (
    environment.NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_PROJECT_ID !==
    HEMAS_CLOUD_FIREBASE_DESCRIPTOR.projectId
  ) {
    return {
      status: "invalid",
      configurationValid: false,
      runtimeActivationAllowed: false,
      reason: "project_id_mismatch",
    };
  }

  if (
    environment.NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_AUTH_DOMAIN !==
    HEMAS_CLOUD_FIREBASE_DESCRIPTOR.authDomain
  ) {
    return {
      status: "invalid",
      configurationValid: false,
      runtimeActivationAllowed: false,
      reason: "auth_domain_mismatch",
    };
  }

  if (
    environment.NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_STORAGE_BUCKET !==
    HEMAS_CLOUD_FIREBASE_DESCRIPTOR.storageBucket
  ) {
    return {
      status: "invalid",
      configurationValid: false,
      runtimeActivationAllowed: false,
      reason: "storage_bucket_mismatch",
    };
  }

  if (
    environment.NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_MESSAGING_SENDER_ID !==
    HEMAS_CLOUD_FIREBASE_DESCRIPTOR.messagingSenderId
  ) {
    return {
      status: "invalid",
      configurationValid: false,
      runtimeActivationAllowed: false,
      reason: "messaging_sender_id_mismatch",
    };
  }

  if (
    environment.NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_APP_ID !==
    HEMAS_CLOUD_FIREBASE_DESCRIPTOR.appId
  ) {
    return {
      status: "invalid",
      configurationValid: false,
      runtimeActivationAllowed: false,
      reason: "app_id_mismatch",
    };
  }

  if (
    environment.NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_MEASUREMENT_ID !==
    HEMAS_CLOUD_FIREBASE_DESCRIPTOR.measurementId
  ) {
    return {
      status: "invalid",
      configurationValid: false,
      runtimeActivationAllowed: false,
      reason: "measurement_id_mismatch",
    };
  }

  if (runtimeFlag === "true") {
    return {
      status: "runtime-approved",
      configurationValid: true,
      runtimeActivationAllowed: true,
      analyticsEnabled: false,
      apiKey: environment.NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_API_KEY ?? "",
      descriptor: HEMAS_CLOUD_FIREBASE_DESCRIPTOR,
    };
  }

  return {
    status: "configured",
    configurationValid: true,
    runtimeActivationAllowed: false,
    analyticsEnabled: false,
    descriptor: HEMAS_CLOUD_FIREBASE_DESCRIPTOR,
  };
}

export function readHemasCloudFirebaseConfig(
  environment?: HemasCloudFirebaseEnvironment,
): HemasCloudFirebaseConfigResult {
  const source =
    environment ??
    ({
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
    } satisfies HemasCloudFirebaseEnvironment);

  return evaluateHemasCloudFirebaseConfig(source);
}
