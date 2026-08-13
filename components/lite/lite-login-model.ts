/**
 * Pure Lite sign-in input and error handling.
 *
 * Keep Firebase provider details out of the management-demo UI and normalize
 * the seat identifier exactly once before it reaches Firebase Auth.
 */

export type PreparedLiteCredentials = {
  readonly email: string;
  readonly password: string;
};

type LiteLoginInputErrorCode =
  | "lite/email-required"
  | "lite/email-invalid"
  | "lite/password-required";

export class LiteLoginInputError extends Error {
  constructor(readonly code: LiteLoginInputErrorCode, message: string) {
    super(message);
    this.name = "LiteLoginInputError";
  }
}

export function normalizeLiteSeatEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function isPlausibleEmail(email: string): boolean {
  if (email.length > 254 || /[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/u.test(email)) {
    return false;
  }
  if (email.startsWith(".") || email.endsWith(".") || email.includes("..")) {
    return false;
  }
  return /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u.test(email);
}

export function prepareLiteCredentials(
  rawEmail: string,
  password: string,
): PreparedLiteCredentials {
  const email = normalizeLiteSeatEmail(rawEmail);
  if (!email) {
    throw new LiteLoginInputError(
      "lite/email-required",
      "Enter the seat email supplied by the demo owner.",
    );
  }
  if (!isPlausibleEmail(email)) {
    throw new LiteLoginInputError(
      "lite/email-invalid",
      "Enter a valid seat email address.",
    );
  }
  if (!password) {
    throw new LiteLoginInputError(
      "lite/password-required",
      "Enter the password supplied by the demo owner.",
    );
  }
  return { email, password };
}

function errorCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) return "";
  return typeof error.code === "string" ? error.code : "";
}

/** Account-safe copy: unknown-user and wrong-password deliberately match. */
export function liteSignInErrorMessage(error: unknown): string {
  if (error instanceof LiteLoginInputError) return error.message;

  switch (errorCode(error)) {
    case "auth/invalid-email":
    case "auth/missing-email":
      return "Enter a valid seat email address.";
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
    case "auth/user-not-found":
    case "auth/wrong-password":
      return "The seat email or password is incorrect. Check the private demo credentials.";
    case "auth/user-disabled":
      return "This demo seat has been disabled. Contact the demo owner.";
    case "auth/too-many-requests":
      return "Too many sign-in attempts. Wait a few minutes and try again.";
    case "auth/network-request-failed":
      return "The sign-in service could not be reached. Check your connection and try again.";
    default:
      return "Sign-in could not be completed. Try again or contact the demo owner.";
  }
}
