import { describe, expect, it } from "vitest";
import { parsePublicEnv } from "@/lib/config/public-env";

describe("public environment safety boundary", () => {
  it("defaults to the fail-closed synthetic demo", () => {
    expect(parsePublicEnv({})).toEqual({
      appStage: "demo",
      externalMessagingEnabled: false,
      realPatientDataEnabled: false,
    });
  });

  it("permits connected UAT only with messaging and patient data disabled", () => {
    expect(parsePublicEnv({
      NEXT_PUBLIC_APP_STAGE: "uat",
      NEXT_PUBLIC_EXTERNAL_MESSAGING_ENABLED: "false",
      NEXT_PUBLIC_REAL_PATIENT_DATA_ENABLED: "false",
    })).toEqual({
      appStage: "uat",
      externalMessagingEnabled: false,
      realPatientDataEnabled: false,
    });
  });

  it.each([
    { NEXT_PUBLIC_EXTERNAL_MESSAGING_ENABLED: "true" },
    { NEXT_PUBLIC_REAL_PATIENT_DATA_ENABLED: "true" },
    { NEXT_PUBLIC_APP_STAGE: "production" },
  ])("rejects unsupported activation input %o", (input) => {
    expect(() => parsePublicEnv(input)).toThrow();
  });
});
