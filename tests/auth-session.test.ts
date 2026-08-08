import { describe, expect, it } from "vitest";
import {
  evaluateLocalAuthPolicy,
  isExpectedSyntheticIdentity,
  isLoopbackHostname,
  syntheticAuthProjectId,
} from "@/lib/firebase/auth-policy";
import {
  loginReasonForStatus,
  portalSessionDecision,
} from "@/components/auth/session-model";

describe("local Firebase Auth boundary", () => {
  it.each(["localhost", "127.0.0.1", "::1", "[::1]"])(
    "recognizes %s as a loopback hostname",
    (hostname) => {
      expect(isLoopbackHostname(hostname)).toBe(true);
    },
  );

  it("allows only the safe synthetic emulator defaults", () => {
    expect(evaluateLocalAuthPolicy({ hostname: "localhost" })).toEqual({ allowed: true });
    expect(
      evaluateLocalAuthPolicy({
        hostname: "127.0.0.1",
        projectId: syntheticAuthProjectId,
        appStage: "development",
        useFirebaseEmulators: "true",
        externalMessagingEnabled: "false",
        realPatientDataEnabled: "false",
      }),
    ).toEqual({ allowed: true });
  });

  it.each([
    [{ hostname: "demo.example.test" }, "non_loopback_host"],
    [{ hostname: "localhost", projectId: "hemas-production" }, "non_demo_project"],
    [{ hostname: "localhost", appStage: "uat" }, "unsafe_stage"],
    [{ hostname: "localhost", useFirebaseEmulators: "false" }, "emulators_disabled"],
    [{ hostname: "localhost", externalMessagingEnabled: "true" }, "external_messaging_enabled"],
    [{ hostname: "localhost", realPatientDataEnabled: "true" }, "real_patient_data_enabled"],
  ] as const)("rejects unsafe configuration %#", (input, reason) => {
    expect(evaluateLocalAuthPolicy(input)).toEqual({ allowed: false, reason });
  });

  it("recognizes only the seeded synthetic identity", () => {
    expect(isExpectedSyntheticIdentity("demo.admin@synthetic.invalid")).toBe(true);
    expect(isExpectedSyntheticIdentity("DEMO.ADMIN@SYNTHETIC.INVALID")).toBe(true);
    expect(isExpectedSyntheticIdentity("operator@example.com")).toBe(false);
    expect(isExpectedSyntheticIdentity(null)).toBe(false);
  });
});

describe("portal session decisions", () => {
  it("allows only an authenticated session", () => {
    expect(portalSessionDecision("authenticated")).toBe("allow");
    expect(portalSessionDecision("checking")).toBe("wait");
    expect(portalSessionDecision("unauthenticated")).toBe("redirect");
    expect(portalSessionDecision("unavailable")).toBe("redirect");
  });

  it("keeps unavailable failures distinguishable at login", () => {
    expect(loginReasonForStatus("unavailable")).toBe("auth-unavailable");
    expect(loginReasonForStatus("unauthenticated")).toBe("session-required");
  });
});
