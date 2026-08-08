import { describe, expect, it } from "vitest";
import {
  assertSafeSeedEmulatorHosts,
  requireExactLoopbackEmulatorHost,
} from "@/scripts/emulator-host-safety";

describe("privileged emulator seed host guard", () => {
  it("accepts only the expected loopback host and port pairs", () => {
    expect(
      assertSafeSeedEmulatorHosts({
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
        FIREBASE_AUTH_EMULATOR_HOST: "localhost:9099",
      }),
    ).toEqual({ firestore: "127.0.0.1:8080", auth: "localhost:9099" });
  });

  it("rejects missing, non-loopback, malformed and wrong-port targets", () => {
    for (const value of [
      undefined,
      "0.0.0.0:8080",
      "::1:8080",
      "firestore.googleapis.com:8080",
      "127.0.0.1:8081",
      "http://127.0.0.1:8080",
      "127.0.0.1:8080/path",
      "127.0.0.1:8080.example.com",
      " 127.0.0.1:8080",
    ]) {
      expect(() =>
        requireExactLoopbackEmulatorHost(value, "FIRESTORE_EMULATOR_HOST", 8080),
      ).toThrow(/Refusing privileged seed/);
    }
  });

  it("fails the combined guard when either emulator points at the wrong service port", () => {
    expect(() =>
      assertSafeSeedEmulatorHosts({
        FIRESTORE_EMULATOR_HOST: "localhost:8080",
        FIREBASE_AUTH_EMULATOR_HOST: "localhost:8080",
      }),
    ).toThrow(/9099/);
  });
});
