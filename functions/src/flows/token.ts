import { createHmac, timingSafeEqual } from "node:crypto";

import { FailClosedError, assertSafeTenantId, assertSameTenant } from "../errors.js";

export const DEMO_FLOW_TOKEN_SCHEMA = "hemas.synthetic.flow-session" as const;
export const DEMO_FLOW_TOKEN_VERSION = 1 as const;
export const DEMO_FLOW_TOKEN_PREFIX = "hcf-demo-v1" as const;
export const MAX_DEMO_FLOW_TOKEN_TTL_SECONDS = 15 * 60;

export type SyntheticFlowPurpose =
  | "appointment_request"
  | "appointment_change_request"
  | "laboratory_collection_request"
  | "package_enquiry"
  | "feedback"
  | "communication_preferences"
  | "service_information";

export type SyntheticSigningKey = string | Uint8Array;

export interface DemoFlowSessionClaims {
  readonly schema: typeof DEMO_FLOW_TOKEN_SCHEMA;
  readonly version: typeof DEMO_FLOW_TOKEN_VERSION;
  readonly mode: "demo";
  readonly tenantId: string;
  readonly purpose: SyntheticFlowPurpose;
  readonly definitionId: string;
  readonly sessionId: string;
  readonly correlationId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface IssueDemoFlowSessionTokenInput {
  readonly runtimeMode: "demo" | "live";
  readonly tenantId: string;
  readonly purpose: SyntheticFlowPurpose;
  readonly definitionId: string;
  readonly sessionId: string;
  readonly correlationId: string;
  readonly issuedAt: Date;
  readonly expiresInSeconds: number;
  readonly syntheticSigningKey: SyntheticSigningKey;
}

export interface VerifyDemoFlowSessionTokenInput {
  readonly token: string;
  readonly syntheticSigningKey: SyntheticSigningKey;
  readonly expectedTenantId: string;
  readonly expectedPurpose?: SyntheticFlowPurpose;
  readonly expectedDefinitionId?: string;
  readonly expectedSessionId?: string;
  readonly expectedCorrelationId?: string;
  readonly now?: Date;
}

const PURPOSES: readonly SyntheticFlowPurpose[] = [
  "appointment_request",
  "appointment_change_request",
  "laboratory_collection_request",
  "package_enquiry",
  "feedback",
  "communication_preferences",
  "service_information",
];

const CLAIM_KEYS = [
  "correlationId",
  "definitionId",
  "expiresAt",
  "issuedAt",
  "mode",
  "purpose",
  "schema",
  "sessionId",
  "tenantId",
  "version",
] as const;

const SAFE_DEFINITION_ID = /^synthetic-flow-[a-z0-9-]{3,80}$/;
const SAFE_SESSION_ID = /^synthetic-session-[a-z0-9-]{6,80}$/;
const SAFE_CORRELATION_ID = /^synthetic-correlation-[a-z0-9-]{6,80}$/;
const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;

function normalizeSyntheticKey(key: SyntheticSigningKey): Buffer {
  const normalized = typeof key === "string" ? Buffer.from(key, "utf8") : Buffer.from(key);
  if (normalized.byteLength < 32) {
    throw new FailClosedError(
      "synthetic_signing_key_too_short",
      "A caller-provided synthetic signing key of at least 32 bytes is required.",
    );
  }
  if (normalized.byteLength > 4_096) {
    throw new FailClosedError(
      "synthetic_signing_key_too_long",
      "The synthetic signing key exceeds the bounded demo limit.",
    );
  }
  return normalized;
}

function assertSafeDefinitionId(value: string): void {
  if (!SAFE_DEFINITION_ID.test(value)) {
    throw new FailClosedError("invalid_flow_definition", "A synthetic flow definition ID is required.");
  }
}

function assertSafeSessionId(value: string): void {
  if (!SAFE_SESSION_ID.test(value)) {
    throw new FailClosedError("invalid_flow_session", "A synthetic flow session ID is required.");
  }
}

function assertSafeCorrelationId(value: string): void {
  if (!SAFE_CORRELATION_ID.test(value)) {
    throw new FailClosedError(
      "invalid_flow_correlation",
      "A synthetic flow correlation ID is required.",
    );
  }
}

function assertPurpose(value: unknown): asserts value is SyntheticFlowPurpose {
  if (typeof value !== "string" || !PURPOSES.includes(value as SyntheticFlowPurpose)) {
    throw new FailClosedError("invalid_flow_purpose", "The flow purpose is not supported.");
  }
}

function assertExactClaimKeys(value: Readonly<Record<string, unknown>>): void {
  const actual = Object.keys(value).sort();
  if (
    actual.length !== CLAIM_KEYS.length ||
    actual.some((key, index) => key !== CLAIM_KEYS[index])
  ) {
    throw new FailClosedError("invalid_flow_token_claims", "Flow token claims are malformed.");
  }
}

function parseClaims(payloadSegment: string): DemoFlowSessionClaims {
  if (
    payloadSegment.length < 8 ||
    payloadSegment.length > 2_048 ||
    !BASE64URL_SEGMENT.test(payloadSegment)
  ) {
    throw new FailClosedError("invalid_flow_token", "Flow token payload encoding is invalid.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"));
  } catch {
    throw new FailClosedError("invalid_flow_token_claims", "Flow token claims are not valid JSON.");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new FailClosedError("invalid_flow_token_claims", "Flow token claims must be an object.");
  }
  const value = parsed as Readonly<Record<string, unknown>>;
  assertExactClaimKeys(value);

  if (value.schema !== DEMO_FLOW_TOKEN_SCHEMA || value.version !== DEMO_FLOW_TOKEN_VERSION) {
    throw new FailClosedError(
      "unsupported_flow_token_version",
      "Flow token schema or version is unsupported.",
    );
  }
  if (value.mode !== "demo") {
    throw new FailClosedError("non_demo_flow_denied", "Flow session tokens are demo-only.");
  }
  if (
    typeof value.tenantId !== "string" ||
    typeof value.definitionId !== "string" ||
    typeof value.sessionId !== "string" ||
    typeof value.correlationId !== "string"
  ) {
    throw new FailClosedError("invalid_flow_token_claims", "Flow token identity claims are malformed.");
  }
  assertSafeTenantId(value.tenantId);
  assertPurpose(value.purpose);
  assertSafeDefinitionId(value.definitionId);
  assertSafeSessionId(value.sessionId);
  assertSafeCorrelationId(value.correlationId);

  if (
    typeof value.issuedAt !== "number" ||
    typeof value.expiresAt !== "number" ||
    !Number.isSafeInteger(value.issuedAt) ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= value.issuedAt ||
    value.expiresAt - value.issuedAt > MAX_DEMO_FLOW_TOKEN_TTL_SECONDS
  ) {
    throw new FailClosedError("invalid_flow_token_lifetime", "Flow token lifetime is invalid.");
  }

  return {
    schema: DEMO_FLOW_TOKEN_SCHEMA,
    version: DEMO_FLOW_TOKEN_VERSION,
    mode: "demo",
    tenantId: value.tenantId,
    purpose: value.purpose,
    definitionId: value.definitionId,
    sessionId: value.sessionId,
    correlationId: value.correlationId,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
  };
}

function signPayload(payloadSegment: string, key: Buffer): Buffer {
  return createHmac("sha256", key)
    .update(`${DEMO_FLOW_TOKEN_PREFIX}.${payloadSegment}`, "utf8")
    .digest();
}

/**
 * Issues a deterministic, bounded HMAC token for an internal synthetic test.
 * The caller must provide a test-only key; this module does not read secrets or environment state.
 */
export function issueDemoFlowSessionToken(input: IssueDemoFlowSessionTokenInput): string {
  if (input.runtimeMode !== "demo") {
    throw new FailClosedError("non_demo_flow_denied", "Synthetic flow tokens cannot be issued live.");
  }
  assertSafeTenantId(input.tenantId);
  assertPurpose(input.purpose);
  assertSafeDefinitionId(input.definitionId);
  assertSafeSessionId(input.sessionId);
  assertSafeCorrelationId(input.correlationId);
  if (
    !Number.isSafeInteger(input.expiresInSeconds) ||
    input.expiresInSeconds < 1 ||
    input.expiresInSeconds > MAX_DEMO_FLOW_TOKEN_TTL_SECONDS
  ) {
    throw new FailClosedError(
      "invalid_flow_token_lifetime",
      `Synthetic token lifetime must be between 1 and ${MAX_DEMO_FLOW_TOKEN_TTL_SECONDS} seconds.`,
    );
  }
  const issuedAtMs = input.issuedAt.getTime();
  if (!Number.isFinite(issuedAtMs)) {
    throw new FailClosedError("invalid_flow_token_lifetime", "Token issue time is invalid.");
  }

  const issuedAt = Math.floor(issuedAtMs / 1_000);
  const claims: DemoFlowSessionClaims = {
    schema: DEMO_FLOW_TOKEN_SCHEMA,
    version: DEMO_FLOW_TOKEN_VERSION,
    mode: "demo",
    tenantId: input.tenantId,
    purpose: input.purpose,
    definitionId: input.definitionId,
    sessionId: input.sessionId,
    correlationId: input.correlationId,
    issuedAt,
    expiresAt: issuedAt + input.expiresInSeconds,
  };
  const payloadSegment = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signature = signPayload(payloadSegment, normalizeSyntheticKey(input.syntheticSigningKey));
  return `${DEMO_FLOW_TOKEN_PREFIX}.${payloadSegment}.${signature.toString("base64url")}`;
}

/**
 * Authenticates the fixed-size HMAC with timingSafeEqual before parsing any claim data.
 */
export function verifyDemoFlowSessionToken(
  input: VerifyDemoFlowSessionTokenInput,
): DemoFlowSessionClaims {
  if (typeof input.token !== "string" || input.token.length > 4_096) {
    throw new FailClosedError("invalid_flow_token", "A bounded flow token is required.");
  }
  const segments = input.token.split(".");
  if (segments.length !== 3 || segments[0] !== DEMO_FLOW_TOKEN_PREFIX) {
    throw new FailClosedError("invalid_flow_token", "Flow token format is invalid.");
  }
  const payloadSegment = segments[1] ?? "";
  const signatureSegment = segments[2] ?? "";
  const key = normalizeSyntheticKey(input.syntheticSigningKey);
  const expectedSignature = signPayload(payloadSegment, key);

  let suppliedSignature = Buffer.alloc(0);
  if (BASE64URL_SEGMENT.test(signatureSegment) && signatureSegment.length <= 128) {
    suppliedSignature = Buffer.from(signatureSegment, "base64url");
  }
  const fixedLengthSupplied = Buffer.alloc(expectedSignature.length);
  suppliedSignature.copy(
    fixedLengthSupplied,
    0,
    0,
    Math.min(suppliedSignature.length, expectedSignature.length),
  );
  const signatureMatches = timingSafeEqual(expectedSignature, fixedLengthSupplied);
  const signatureEncodingIsCanonical =
    suppliedSignature.toString("base64url") === signatureSegment;
  if (
    !signatureMatches ||
    suppliedSignature.length !== expectedSignature.length ||
    !signatureEncodingIsCanonical
  ) {
    throw new FailClosedError("invalid_flow_token_signature", "Flow token signature is invalid.");
  }

  const claims = parseClaims(payloadSegment);
  assertSameTenant(input.expectedTenantId, claims.tenantId);
  if (input.expectedPurpose !== undefined && input.expectedPurpose !== claims.purpose) {
    throw new FailClosedError("flow_purpose_mismatch", "Flow token purpose does not match the request.");
  }
  if (
    input.expectedDefinitionId !== undefined &&
    input.expectedDefinitionId !== claims.definitionId
  ) {
    throw new FailClosedError(
      "flow_definition_mismatch",
      "Flow token definition does not match the request.",
    );
  }
  if (input.expectedSessionId !== undefined && input.expectedSessionId !== claims.sessionId) {
    throw new FailClosedError("flow_session_mismatch", "Flow token session does not match the request.");
  }
  if (
    input.expectedCorrelationId !== undefined &&
    input.expectedCorrelationId !== claims.correlationId
  ) {
    throw new FailClosedError(
      "flow_correlation_mismatch",
      "Flow token correlation does not match the request.",
    );
  }

  const nowMs = (input.now ?? new Date()).getTime();
  if (!Number.isFinite(nowMs)) {
    throw new FailClosedError("invalid_flow_clock", "Flow verification clock is invalid.");
  }
  const nowSeconds = Math.floor(nowMs / 1_000);
  if (claims.issuedAt > nowSeconds + 30) {
    throw new FailClosedError("flow_token_not_yet_valid", "Flow token issue time is in the future.");
  }
  if (claims.expiresAt <= nowSeconds) {
    throw new FailClosedError("flow_token_expired", "Flow token has expired.");
  }

  return claims;
}
