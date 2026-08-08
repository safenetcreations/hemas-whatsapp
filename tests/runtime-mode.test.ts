import { describe, expect, it } from "vitest";
import {
  evaluateCloudDemoRuntime,
  isAllowedCloudDemoHostname,
  type CloudDemoRuntimeEnvironment,
} from "@/lib/firebase/runtime-mode";

const syntacticallyValidTestApiKey = `AIza${"A".repeat(35)}`;

const cloudEnvironment: CloudDemoRuntimeEnvironment = {
  NEXT_PUBLIC_APP_STAGE: "uat",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "hemas-whatsapp",
  NEXT_PUBLIC_USE_FIREBASE_EMULATORS: "false",
  NEXT_PUBLIC_EXTERNAL_MESSAGING_ENABLED: "false",
  NEXT_PUBLIC_REAL_PATIENT_DATA_ENABLED: "false",
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_DESCRIPTOR_ENABLED: "true",
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_RUNTIME_ENABLED: "true",
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_ANALYTICS_ENABLED: "false",
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_PROJECT_ID: "hemas-whatsapp",
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_API_KEY: syntacticallyValidTestApiKey,
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_AUTH_DOMAIN: "hemas-whatsapp.firebaseapp.com",
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_STORAGE_BUCKET:
    "hemas-whatsapp.firebasestorage.app",
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_MESSAGING_SENDER_ID: "504137546315",
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_APP_ID:
    "1:504137546315:web:7c2108b26a0639893b2bce",
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_MEASUREMENT_ID: "G-BN46X4FB7W",
};

const hostedAppHostname = "hemas-connect--hemas-whatsapp.us-central1.hosted.app";

describe("governed cloud demo runtime", () => {
  it("stays fully inert for the default local demo stage", () => {
    expect(
      evaluateCloudDemoRuntime(
        { NEXT_PUBLIC_APP_STAGE: "demo" },
        hostedAppHostname,
      ),
    ).toEqual({ active: false, refused: false });
    expect(evaluateCloudDemoRuntime({}, "localhost")).toEqual({
      active: false,
      refused: false,
    });
    expect(
      evaluateCloudDemoRuntime(
        { NEXT_PUBLIC_APP_STAGE: "development" },
        "localhost",
      ),
    ).toEqual({ active: false, refused: false });
  });

  it("activates only for the complete explicit UAT configuration", () => {
    const result = evaluateCloudDemoRuntime(cloudEnvironment, hostedAppHostname);
    expect(result).toMatchObject({ active: true, refused: false });
    if (result.active) {
      expect(result.descriptor.projectId).toBe("hemas-whatsapp");
      expect(result.apiKey).toBe(syntacticallyValidTestApiKey);
    }
  });

  it.each([
    [
      "emulators still enabled",
      { NEXT_PUBLIC_USE_FIREBASE_EMULATORS: "true" },
      "emulators_not_disabled",
    ],
    [
      "emulators flag missing",
      { NEXT_PUBLIC_USE_FIREBASE_EMULATORS: undefined },
      "emulators_not_disabled",
    ],
    [
      "wrong runtime project",
      { NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-hemas-connect" },
      "project_id_mismatch",
    ],
    [
      "external messaging flag flipped",
      { NEXT_PUBLIC_EXTERNAL_MESSAGING_ENABLED: "true" },
      "external_messaging_enabled",
    ],
    [
      "real patient flag flipped",
      { NEXT_PUBLIC_REAL_PATIENT_DATA_ENABLED: "true" },
      "real_patient_data_enabled",
    ],
    [
      "cloud runtime gate off",
      { NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_RUNTIME_ENABLED: "false" },
      "cloud_runtime_not_approved",
    ],
    [
      "descriptor disabled",
      { NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_DESCRIPTOR_ENABLED: "false" },
      "cloud_runtime_not_approved",
    ],
    [
      "analytics flipped",
      { NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_ANALYTICS_ENABLED: "true" },
      "cloud_runtime_not_approved",
    ],
    [
      "invalid api key",
      { NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_API_KEY: "not-a-key" },
      "cloud_runtime_not_approved",
    ],
  ] as const)(
    "refuses rather than degrades when %s",
    (_label, override, reason) => {
      expect(
        evaluateCloudDemoRuntime(
          { ...cloudEnvironment, ...override },
          hostedAppHostname,
        ),
      ).toEqual({ active: false, refused: true, reason });
    },
  );

  it("refuses unknown hostnames in UAT", () => {
    expect(
      evaluateCloudDemoRuntime(cloudEnvironment, "evil.example.com"),
    ).toEqual({ active: false, refused: true, reason: "hostname_not_allowed" });
    expect(
      evaluateCloudDemoRuntime(cloudEnvironment, "hosted.app"),
    ).toEqual({ active: false, refused: true, reason: "hostname_not_allowed" });
  });

  it("allows the App Hosting domain, loopback and one explicit extra host", () => {
    expect(isAllowedCloudDemoHostname(hostedAppHostname, undefined)).toBe(true);
    expect(isAllowedCloudDemoHostname("localhost", undefined)).toBe(true);
    expect(isAllowedCloudDemoHostname("127.0.0.1", undefined)).toBe(true);
    expect(
      isAllowedCloudDemoHostname("uat.hemasconnect.example", "uat.hemasconnect.example"),
    ).toBe(true);
    expect(isAllowedCloudDemoHostname("uat.hemasconnect.example", undefined)).toBe(false);
    expect(isAllowedCloudDemoHostname("nothosted.app", undefined)).toBe(false);
    expect(isAllowedCloudDemoHostname("hosted.app", undefined)).toBe(false);
  });
});
