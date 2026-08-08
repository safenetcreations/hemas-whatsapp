import { createHmac, timingSafeEqual } from "node:crypto";

import { FailClosedError } from "../errors.js";

export const SYNTHETIC_WEBHOOK_SCHEMA = "hemas.synthetic.webhook" as const;
export const SYNTHETIC_WEBHOOK_VERSION = 1 as const;
export const SYNTHETIC_SIGNATURE_HEADER = "x-hub-signature-256" as const;
export const SYNTHETIC_RAW_CONTENT_TYPE = "application/octet-stream" as const;
export const MAX_SYNTHETIC_WEBHOOK_BYTES = 16 * 1_024;

/**
 * Deliberately public, synthetic-only fixture material. This is not a secret and
 * must never be replaced with a Meta or Hemas credential.
 */
export const PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET =
  "PUBLIC-SYNTHETIC-WEBHOOK-FIXTURE-NOT-A-SECRET-2026" as const;

export const SYNTHETIC_INBOUND_SCENARIOS = [
  "appointment_request",
  "laboratory_collection_request",
  "report_ready_question",
  "stop_request",
  "urgent_help",
] as const;

export const SYNTHETIC_TEXT_CODES = [
  "APPOINTMENT_REQUEST_EN",
  "APPOINTMENT_REQUEST_SI",
  "APPOINTMENT_REQUEST_TA",
  "LAB_COLLECTION_REQUEST_EN",
  "LAB_COLLECTION_REQUEST_SI",
  "LAB_COLLECTION_REQUEST_TA",
  "REPORT_READY_QUESTION_EN",
  "REPORT_READY_QUESTION_SI",
  "REPORT_READY_QUESTION_TA",
  "STOP_REQUEST_EN",
  "STOP_REQUEST_SI",
  "STOP_REQUEST_TA",
  "URGENT_HELP_EN",
  "URGENT_HELP_SI",
  "URGENT_HELP_TA",
] as const;

export const SYNTHETIC_MESSAGE_STATUSES = [
  "sent",
  "failed",
  "delivered",
  "read",
] as const;

export type SyntheticInboundScenario = (typeof SYNTHETIC_INBOUND_SCENARIOS)[number];
export type SyntheticTextCode = (typeof SYNTHETIC_TEXT_CODES)[number];
export type SyntheticMessageStatus = (typeof SYNTHETIC_MESSAGE_STATUSES)[number];
export type SyntheticLanguage = "en" | "si" | "ta";

export interface SyntheticInboundMessageEvent {
  readonly kind: "message_inbound";
  readonly providerMessageRef: string;
  readonly contactRef: string;
  readonly scenarioCode: SyntheticInboundScenario;
  readonly textCode: SyntheticTextCode;
  readonly language: SyntheticLanguage;
}

export interface SyntheticMessageStatusEvent {
  readonly kind: "message_status";
  readonly providerMessageRef: string;
  readonly contactRef: string;
  readonly status: SyntheticMessageStatus;
  readonly statusCode: "SYNTHETIC_STATUS_OK" | "SYNTHETIC_FAILURE_SIMULATED";
}

export interface SyntheticWebhookEnvelope {
  readonly schema: typeof SYNTHETIC_WEBHOOK_SCHEMA;
  readonly version: typeof SYNTHETIC_WEBHOOK_VERSION;
  readonly mode: "demo";
  readonly eventId: string;
  readonly routeRef: string;
  readonly occurredAt: string;
  readonly event: SyntheticInboundMessageEvent | SyntheticMessageStatusEvent;
}

const TOP_LEVEL_KEYS = [
  "event",
  "eventId",
  "mode",
  "occurredAt",
  "routeRef",
  "schema",
  "version",
] as const;
const INBOUND_KEYS = [
  "contactRef",
  "kind",
  "language",
  "providerMessageRef",
  "scenarioCode",
  "textCode",
] as const;
const STATUS_KEYS = [
  "contactRef",
  "kind",
  "providerMessageRef",
  "status",
  "statusCode",
] as const;

const SYNTHETIC_EVENT_ID = /^synthetic-event-[a-z0-9][a-z0-9-]{7,63}$/;
const SYNTHETIC_ROUTE_REF = /^synthetic-phone-route-[a-z0-9][a-z0-9-]{3,47}$/;
const SYNTHETIC_MESSAGE_REF = /^synthetic-message-[a-z0-9][a-z0-9-]{5,63}$/;
const SYNTHETIC_CONTACT_REF = /^synthetic-contact-[a-z0-9][a-z0-9-]{3,47}$/;
const SYNTHETIC_CHALLENGE = /^synthetic-challenge-[A-Za-z0-9_-]{8,128}$/;
const SHA256_SIGNATURE = /^sha256=([a-f0-9]{64})$/;
const CANONICAL_TIMESTAMP = /^20(?:2[5-9]|3[0-5])-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/;

const TEXT_RULES: Readonly<Record<SyntheticTextCode, {
  readonly scenario: SyntheticInboundScenario;
  readonly language: SyntheticLanguage;
}>> = {
  APPOINTMENT_REQUEST_EN: { scenario: "appointment_request", language: "en" },
  APPOINTMENT_REQUEST_SI: { scenario: "appointment_request", language: "si" },
  APPOINTMENT_REQUEST_TA: { scenario: "appointment_request", language: "ta" },
  LAB_COLLECTION_REQUEST_EN: { scenario: "laboratory_collection_request", language: "en" },
  LAB_COLLECTION_REQUEST_SI: { scenario: "laboratory_collection_request", language: "si" },
  LAB_COLLECTION_REQUEST_TA: { scenario: "laboratory_collection_request", language: "ta" },
  REPORT_READY_QUESTION_EN: { scenario: "report_ready_question", language: "en" },
  REPORT_READY_QUESTION_SI: { scenario: "report_ready_question", language: "si" },
  REPORT_READY_QUESTION_TA: { scenario: "report_ready_question", language: "ta" },
  STOP_REQUEST_EN: { scenario: "stop_request", language: "en" },
  STOP_REQUEST_SI: { scenario: "stop_request", language: "si" },
  STOP_REQUEST_TA: { scenario: "stop_request", language: "ta" },
  URGENT_HELP_EN: { scenario: "urgent_help", language: "en" },
  URGENT_HELP_SI: { scenario: "urgent_help", language: "si" },
  URGENT_HELP_TA: { scenario: "urgent_help", language: "ta" },
};

function requireExactObject(
  value: unknown,
  keys: readonly string[],
  code = "invalid_synthetic_webhook",
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FailClosedError(code, "A bounded webhook object is required.");
  }
  const object = value as Readonly<Record<string, unknown>>;
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new FailClosedError(code, "Webhook fields do not match the synthetic schema.");
  }
  return object;
}

function requirePattern(value: unknown, pattern: RegExp, field: string): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new FailClosedError("invalid_synthetic_webhook", `${field} is invalid.`);
  }
  return value;
}

function requireOccurredAt(value: unknown): string {
  if (typeof value !== "string" || !CANONICAL_TIMESTAMP.test(value)) {
    throw new FailClosedError(
      "invalid_synthetic_webhook",
      "A canonical bounded synthetic occurrence timestamp is required.",
    );
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new FailClosedError(
      "invalid_synthetic_webhook",
      "The synthetic occurrence timestamp is invalid.",
    );
  }
  return value;
}

function parseInboundEvent(value: Readonly<Record<string, unknown>>): SyntheticInboundMessageEvent {
  const data = requireExactObject(value, INBOUND_KEYS);
  if (
    typeof data.scenarioCode !== "string" ||
    !SYNTHETIC_INBOUND_SCENARIOS.includes(data.scenarioCode as SyntheticInboundScenario) ||
    typeof data.textCode !== "string" ||
    !SYNTHETIC_TEXT_CODES.includes(data.textCode as SyntheticTextCode) ||
    (data.language !== "en" && data.language !== "si" && data.language !== "ta")
  ) {
    throw new FailClosedError(
      "invalid_synthetic_webhook",
      "Inbound scenario, text code, or language is not allowlisted.",
    );
  }
  const textCode = data.textCode as SyntheticTextCode;
  const rule = TEXT_RULES[textCode];
  if (rule.scenario !== data.scenarioCode || rule.language !== data.language) {
    throw new FailClosedError(
      "invalid_synthetic_webhook",
      "Inbound scenario and language must match the allowlisted text code.",
    );
  }
  return {
    kind: "message_inbound",
    providerMessageRef: requirePattern(
      data.providerMessageRef,
      SYNTHETIC_MESSAGE_REF,
      "Provider message reference",
    ),
    contactRef: requirePattern(data.contactRef, SYNTHETIC_CONTACT_REF, "Contact reference"),
    scenarioCode: data.scenarioCode as SyntheticInboundScenario,
    textCode,
    language: data.language,
  };
}

function parseStatusEvent(value: Readonly<Record<string, unknown>>): SyntheticMessageStatusEvent {
  const data = requireExactObject(value, STATUS_KEYS);
  if (
    typeof data.status !== "string" ||
    !SYNTHETIC_MESSAGE_STATUSES.includes(data.status as SyntheticMessageStatus)
  ) {
    throw new FailClosedError("invalid_synthetic_webhook", "Message status is not allowlisted.");
  }
  const status = data.status as SyntheticMessageStatus;
  const expectedStatusCode = status === "failed"
    ? "SYNTHETIC_FAILURE_SIMULATED"
    : "SYNTHETIC_STATUS_OK";
  if (data.statusCode !== expectedStatusCode) {
    throw new FailClosedError(
      "invalid_synthetic_webhook",
      "Message status and synthetic status code do not match.",
    );
  }
  return {
    kind: "message_status",
    providerMessageRef: requirePattern(
      data.providerMessageRef,
      SYNTHETIC_MESSAGE_REF,
      "Provider message reference",
    ),
    contactRef: requirePattern(data.contactRef, SYNTHETIC_CONTACT_REF, "Contact reference"),
    status,
    statusCode: expectedStatusCode,
  };
}

function decodeRawJson(rawBody: Buffer): unknown {
  if (rawBody.byteLength < 2 || rawBody.byteLength > MAX_SYNTHETIC_WEBHOOK_BYTES) {
    throw new FailClosedError(
      "invalid_synthetic_webhook_body",
      "Synthetic webhook body size is outside the accepted range.",
    );
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
  } catch {
    throw new FailClosedError(
      "invalid_synthetic_webhook_json",
      "Synthetic webhook body must be valid UTF-8 JSON.",
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new FailClosedError(
      "invalid_synthetic_webhook_json",
      "Synthetic webhook body must be valid JSON.",
    );
  }
}

function normalizeFixtureKey(secret: string): Buffer {
  const key = Buffer.from(secret, "utf8");
  if (key.byteLength < 32 || key.byteLength > 256) {
    throw new FailClosedError(
      "invalid_synthetic_fixture_secret",
      "Synthetic fixture material must contain between 32 and 256 bytes.",
    );
  }
  return key;
}

export function createSyntheticWebhookFixtureSignature(rawBody: Buffer): string {
  const digest = createHmac(
    "sha256",
    normalizeFixtureKey(PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET),
  ).update(rawBody).digest("hex");
  return `sha256=${digest}`;
}

/** Authenticates the raw bytes with fixed-length comparison before any JSON parsing. */
export function verifySyntheticWebhookSignature(input: {
  readonly rawBody: Buffer;
  readonly signatureHeader: string | undefined;
  readonly syntheticFixtureSecret: string;
}): void {
  if (input.rawBody.byteLength < 2 || input.rawBody.byteLength > MAX_SYNTHETIC_WEBHOOK_BYTES) {
    throw new FailClosedError(
      "invalid_synthetic_webhook_body",
      "Synthetic webhook body size is outside the accepted range.",
    );
  }
  const key = normalizeFixtureKey(input.syntheticFixtureSecret);
  const suppliedMatch = input.signatureHeader?.match(SHA256_SIGNATURE);
  const supplied = suppliedMatch ? Buffer.from(suppliedMatch[1] ?? "", "hex") : Buffer.alloc(0);
  const expected = createHmac("sha256", key).update(input.rawBody).digest();
  const fixedLengthSupplied = Buffer.alloc(expected.byteLength);
  supplied.copy(fixedLengthSupplied, 0, 0, Math.min(supplied.length, expected.length));
  const matches = timingSafeEqual(expected, fixedLengthSupplied);
  if (!matches || supplied.length !== expected.length || !suppliedMatch) {
    throw new FailClosedError(
      "invalid_synthetic_webhook_signature",
      "Synthetic webhook signature is invalid.",
    );
  }
}

export function parseSyntheticWebhookEnvelope(rawBody: Buffer): SyntheticWebhookEnvelope {
  const value = requireExactObject(decodeRawJson(rawBody), TOP_LEVEL_KEYS);
  if (
    value.schema !== SYNTHETIC_WEBHOOK_SCHEMA ||
    value.version !== SYNTHETIC_WEBHOOK_VERSION ||
    value.mode !== "demo"
  ) {
    throw new FailClosedError(
      "invalid_synthetic_webhook",
      "Synthetic webhook schema, version, or mode is unsupported.",
    );
  }
  const eventObject = requireExactObject(
    value.event,
    typeof (value.event as { readonly kind?: unknown } | undefined)?.kind === "string" &&
      (value.event as { readonly kind: string }).kind === "message_status"
      ? STATUS_KEYS
      : INBOUND_KEYS,
  );
  const event = eventObject.kind === "message_inbound"
    ? parseInboundEvent(eventObject)
    : eventObject.kind === "message_status"
      ? parseStatusEvent(eventObject)
      : (() => {
        throw new FailClosedError(
          "invalid_synthetic_webhook",
          "Webhook event kind is unsupported.",
        );
      })();
  return {
    schema: SYNTHETIC_WEBHOOK_SCHEMA,
    version: SYNTHETIC_WEBHOOK_VERSION,
    mode: "demo",
    eventId: requirePattern(value.eventId, SYNTHETIC_EVENT_ID, "Event ID"),
    routeRef: requirePattern(value.routeRef, SYNTHETIC_ROUTE_REF, "Route reference"),
    occurredAt: requireOccurredAt(value.occurredAt),
    event,
  };
}

export function authenticateAndParseSyntheticWebhook(input: {
  readonly rawBody: Buffer;
  readonly signatureHeader: string | undefined;
  readonly syntheticFixtureSecret: string;
}): SyntheticWebhookEnvelope {
  verifySyntheticWebhookSignature(input);
  return parseSyntheticWebhookEnvelope(input.rawBody);
}

export function verifySyntheticWebhookChallenge(input: {
  readonly query: Readonly<Record<string, unknown>>;
  readonly syntheticFixtureSecret: string;
}): string {
  normalizeFixtureKey(input.syntheticFixtureSecret);
  const data = requireExactObject(
    input.query,
    ["hub.challenge", "hub.mode", "hub.verify_token"],
    "invalid_synthetic_verification",
  );
  if (data["hub.mode"] !== "subscribe") {
    throw new FailClosedError(
      "invalid_synthetic_verification",
      "Synthetic webhook verification mode is invalid.",
    );
  }
  const supplied = typeof data["hub.verify_token"] === "string"
    ? Buffer.from(data["hub.verify_token"], "utf8")
    : Buffer.alloc(0);
  const expected = Buffer.from(input.syntheticFixtureSecret, "utf8");
  const fixedLengthSupplied = Buffer.alloc(expected.byteLength);
  supplied.copy(fixedLengthSupplied, 0, 0, Math.min(supplied.length, expected.length));
  const matches = timingSafeEqual(expected, fixedLengthSupplied);
  if (!matches || supplied.length !== expected.length) {
    throw new FailClosedError(
      "invalid_synthetic_verification_token",
      "Synthetic webhook verification token is invalid.",
    );
  }
  return requirePattern(
    data["hub.challenge"],
    SYNTHETIC_CHALLENGE,
    "Synthetic verification challenge",
  );
}
