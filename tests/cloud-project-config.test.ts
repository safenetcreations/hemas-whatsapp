import { describe, expect, it } from "vitest";
import {
  evaluateHemasCloudFirebaseConfig,
  HEMAS_CLOUD_FIREBASE_DESCRIPTOR,
  readHemasCloudFirebaseConfig,
  type HemasCloudFirebaseEnvironment,
} from "@/lib/firebase/cloud-project-config";

const syntacticallyValidTestApiKey = `AIza${"A".repeat(35)}`;

const validEnvironment = {
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_DESCRIPTOR_ENABLED: "true",
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_RUNTIME_ENABLED: "false",
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_ANALYTICS_ENABLED: "false",
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_PROJECT_ID:
    HEMAS_CLOUD_FIREBASE_DESCRIPTOR.projectId,
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_API_KEY: syntacticallyValidTestApiKey,
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_AUTH_DOMAIN:
    HEMAS_CLOUD_FIREBASE_DESCRIPTOR.authDomain,
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_STORAGE_BUCKET:
    HEMAS_CLOUD_FIREBASE_DESCRIPTOR.storageBucket,
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_MESSAGING_SENDER_ID:
    HEMAS_CLOUD_FIREBASE_DESCRIPTOR.messagingSenderId,
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_APP_ID:
    HEMAS_CLOUD_FIREBASE_DESCRIPTOR.appId,
  NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_MEASUREMENT_ID:
    HEMAS_CLOUD_FIREBASE_DESCRIPTOR.measurementId,
} satisfies HemasCloudFirebaseEnvironment;

describe("Hemas cloud Firebase descriptor", () => {
  it.each([
    {},
    {
      ...validEnvironment,
      NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_DESCRIPTOR_ENABLED: "",
    },
    {
      ...validEnvironment,
      NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_DESCRIPTOR_ENABLED: "false",
    },
  ])("stays disabled by default without validating or exposing credentials", (environment) => {
    expect(evaluateHemasCloudFirebaseConfig(environment)).toEqual({
      status: "disabled",
      configurationValid: false,
      runtimeActivationAllowed: false,
      reason: "disabled_by_default",
    });
  });

  it.each(["TRUE", "1", "yes", " true "])(
    "rejects non-literal activation flag %s",
    (descriptorEnableFlag) => {
      expect(
        evaluateHemasCloudFirebaseConfig({
          ...validEnvironment,
          NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_DESCRIPTOR_ENABLED:
            descriptorEnableFlag,
        }),
      ).toEqual({
        status: "invalid",
        configurationValid: false,
        runtimeActivationAllowed: false,
        reason: "invalid_descriptor_enable_flag",
      });
    },
  );

  it.each([undefined, "", "true", "TRUE", "0"])(
    "never permits runtime activation for gate %s",
    (runtimeFlag) => {
      expect(
        evaluateHemasCloudFirebaseConfig({
          ...validEnvironment,
          NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_RUNTIME_ENABLED: runtimeFlag,
        }),
      ).toEqual({
        status: "invalid",
        configurationValid: false,
        runtimeActivationAllowed: false,
        reason: "runtime_activation_not_permitted",
      });
    },
  );

  it.each([undefined, "", "true", "TRUE", "0"])(
    "never permits Analytics for gate %s",
    (analyticsFlag) => {
      expect(
        evaluateHemasCloudFirebaseConfig({
          ...validEnvironment,
          NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_ANALYTICS_ENABLED: analyticsFlag,
        }),
      ).toEqual({
        status: "invalid",
        configurationValid: false,
        runtimeActivationAllowed: false,
        reason: "analytics_not_permitted",
      });
    },
  );

  it.each([undefined, "", "not-a-firebase-web-key"])(
    "rejects an absent or malformed API key without returning it",
    (apiKey) => {
      const result = evaluateHemasCloudFirebaseConfig({
        ...validEnvironment,
        NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_API_KEY: apiKey,
      });

      expect(result).toEqual({
        status: "invalid",
        configurationValid: false,
        runtimeActivationAllowed: false,
        reason: "invalid_api_key",
      });
      expect(result).not.toHaveProperty("apiKey");
      if (apiKey) {
        expect(JSON.stringify(result)).not.toContain(apiKey);
      }
    },
  );

  it.each([
    ["NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_PROJECT_ID", "project_id_mismatch"],
    ["NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_AUTH_DOMAIN", "auth_domain_mismatch"],
    ["NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_STORAGE_BUCKET", "storage_bucket_mismatch"],
    [
      "NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_MESSAGING_SENDER_ID",
      "messaging_sender_id_mismatch",
    ],
    ["NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_APP_ID", "app_id_mismatch"],
    ["NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_MEASUREMENT_ID", "measurement_id_mismatch"],
  ] as const)("rejects a mismatched %s", (field, reason) => {
    expect(
      evaluateHemasCloudFirebaseConfig({
        ...validEnvironment,
        [field]: "unexpected-value",
      }),
    ).toEqual({
      status: "invalid",
      configurationValid: false,
      runtimeActivationAllowed: false,
      reason,
    });
  });

  it("marks only the exact project identity configured without allowing activation", () => {
    const result = readHemasCloudFirebaseConfig(validEnvironment);

    expect(result).toEqual({
      status: "configured",
      configurationValid: true,
      runtimeActivationAllowed: false,
      analyticsEnabled: false,
      descriptor: HEMAS_CLOUD_FIREBASE_DESCRIPTOR,
    });
    expect(JSON.stringify(result)).not.toContain(syntacticallyValidTestApiKey);
    expect(Object.isFrozen(HEMAS_CLOUD_FIREBASE_DESCRIPTOR)).toBe(true);
  });
});
