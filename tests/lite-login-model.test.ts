import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  liteSignInErrorMessage,
  prepareLiteCredentials,
} from "@/components/lite/lite-login-model";

describe("Lite login input", () => {
  it("normalizes the configured seat identifier without changing the password", () => {
    expect(
      prepareLiteCredentials("  Agent1@LITE.SYNTHETIC.INVALID  ", "  private password  "),
    ).toEqual({
      email: "agent1@lite.synthetic.invalid",
      password: "  private password  ",
    });
  });

  it.each([
    ["", "password", "Enter the seat email supplied by the demo owner."],
    ["not-an-email", "password", "Enter a valid seat email address."],
    ["agent1@lite.synthetic.invalid\u200B", "password", "Enter a valid seat email address."],
    ["agent1@lite.synthetic.invalid", "", "Enter the password supplied by the demo owner."],
  ])("rejects invalid credentials before Firebase", (email, password, expected) => {
    expect(() => prepareLiteCredentials(email, password)).toThrow(expected);
  });

  it("does not confuse a visual placeholder with a submitted credential", () => {
    const source = readFileSync(
      new URL("../components/lite/lite-shell.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('placeholder="Enter your issued seat email"');
    expect(source).toContain('placeholder="Enter your password"');
    expect(source).not.toContain('placeholder="agent1@lite.synthetic.invalid"');
    expect(source).toContain("required");
    expect(source).toContain('role="alert"');
  });
});

describe("Lite login errors", () => {
  it.each([
    ["auth/invalid-email", "Enter a valid seat email address."],
    ["auth/missing-email", "Enter a valid seat email address."],
    ["auth/user-disabled", "This demo seat has been disabled. Contact the demo owner."],
    ["auth/too-many-requests", "Too many sign-in attempts. Wait a few minutes and try again."],
    [
      "auth/network-request-failed",
      "The sign-in service could not be reached. Check your connection and try again.",
    ],
  ])("maps %s to safe copy", (code, expected) => {
    expect(liteSignInErrorMessage({ code, message: `Firebase: Error (${code}).` })).toBe(expected);
  });

  it.each([
    "auth/invalid-credential",
    "auth/invalid-login-credentials",
    "auth/user-not-found",
    "auth/wrong-password",
  ])("uses one non-enumerating credential message for %s", (code) => {
    expect(liteSignInErrorMessage({ code })).toBe(
      "The seat email or password is incorrect. Check the private demo credentials.",
    );
  });

  it("never renders an unknown provider message or provider code", () => {
    const message = liteSignInErrorMessage({
      code: "auth/internal-error",
      message: "Firebase: Error (auth/internal-error). private provider detail",
    });
    expect(message).toBe("Sign-in could not be completed. Try again or contact the demo owner.");
    expect(message).not.toMatch(/Firebase|auth\/|private provider detail/);
  });
});
