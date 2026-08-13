import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta WhatsApp canary contracts — pure, dependency-free logic for the
 * governed live canary lane.
 *
 * Scope, deliberately narrow:
 * - Verify Meta webhook GET verification handshakes.
 * - Verify X-Hub-Signature-256 on webhook POSTs (HMAC-SHA256, app secret).
 * - Reduce inbound WhatsApp payloads to CONTENT-FREE metadata records
 *   (message bodies are hashed, never stored).
 * - Enforce an explicit E.164 recipient allowlist for outbound canary sends.
 *
 * The canary lane runs ONLY inside the governed cloud demo boundary and
 * carries no patient data. It is a connectivity proof, not a messaging
 * product surface.
 */

export const META_CANARY_WORKSPACE_ID = "workspace_safenet_demo" as const;
export const META_CANARY_INBOUND_COLLECTION = "canary_inbound_events" as const;
export const META_CANARY_OUTBOUND_COLLECTION = "canary_outbound_events" as const;
export const META_CANARY_DEFAULT_TEMPLATE = "hello_world" as const;
export const META_CANARY_DEFAULT_LANGUAGE = "en_US" as const;
export const META_CANARY_MAX_ALLOWLIST = 5;

export class MetaCanaryError extends Error {
  constructor(
    message: string,
    readonly code:
      | "canary_disabled"
      | "invalid_signature"
      | "invalid_verify_request"
      | "invalid_request"
      | "recipient_not_allowlisted"
      | "authentication_required"
      | "provider_error",
  ) {
    super(message);
    this.name = "MetaCanaryError";
  }
}

export function verifyMetaWebhookChallenge(query: {
  readonly mode: string | undefined;
  readonly verifyToken: string | undefined;
  readonly challenge: string | undefined;
  readonly expectedVerifyToken: string;
}): string {
  if (
    query.mode !== "subscribe" ||
    !query.verifyToken ||
    !query.challenge ||
    query.expectedVerifyToken.length < 16 ||
    query.verifyToken !== query.expectedVerifyToken
  ) {
    throw new MetaCanaryError(
      "Webhook verification challenge failed.",
      "invalid_verify_request",
    );
  }
  return query.challenge;
}

export function verifyMetaSignature(input: {
  readonly rawBody: Buffer;
  readonly signatureHeader: string | undefined;
  readonly appSecret: string;
}): void {
  const header = input.signatureHeader?.trim() ?? "";
  if (!header.startsWith("sha256=") || input.appSecret.length < 8) {
    throw new MetaCanaryError(
      "The webhook payload signature is missing or malformed.",
      "invalid_signature",
    );
  }
  const presented = header.slice("sha256=".length).toLowerCase();
  const expected = createHmac("sha256", input.appSecret)
    .update(input.rawBody)
    .digest("hex");
  const presentedBuffer = Buffer.from(presented, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (
    presentedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(presentedBuffer, expectedBuffer)
  ) {
    throw new MetaCanaryError(
      "The webhook payload signature does not match the app secret.",
      "invalid_signature",
    );
  }
}

export function parseRecipientAllowlist(raw: string | undefined): readonly string[] {
  const entries = (raw ?? "")
    .split(",")
    .map((value) => normalizeE164(value))
    .filter((value): value is string => value !== null);
  const unique = [...new Set(entries)];
  return unique.slice(0, META_CANARY_MAX_ALLOWLIST);
}

export function normalizeE164(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim().replace(/[\s()-]/g, "");
  const candidate = trimmed.startsWith("+") ? trimmed.slice(1) : trimmed;
  if (!/^[1-9]\d{7,14}$/.test(candidate)) {
    return null;
  }
  return candidate;
}

export function assertAllowlistedRecipient(
  to: string | undefined,
  allowlist: readonly string[],
): string {
  const normalized = normalizeE164(to);
  if (!normalized || allowlist.length === 0 || !allowlist.includes(normalized)) {
    throw new MetaCanaryError(
      "Canary sends are limited to the explicit test recipient allowlist.",
      "recipient_not_allowlisted",
    );
  }
  return normalized;
}

export type CanaryInboundRecord = {
  readonly id: string;
  readonly workspaceId: typeof META_CANARY_WORKSPACE_ID;
  readonly kind: "message" | "status";
  readonly waMessageId: string;
  readonly fromNumber: string | null;
  readonly toPhoneNumberId: string | null;
  readonly messageType: string | null;
  readonly statusValue: string | null;
  readonly bodySha256: string | null;
  readonly providerTimestamp: string | null;
  readonly canary: true;
  readonly containsMessageContent: false;
  readonly schemaVersion: 1;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 512
    ? value
    : null;
}

function safeId(value: string | null, fallback: string): string {
  const cleaned = (value ?? "")
    .replace(/[^A-Za-z0-9._:-]/g, "-")
    .replace(/^-+/, "")
    .slice(0, 120);
  return cleaned.length >= 4 ? cleaned : fallback;
}

/**
 * Reduce a Meta WhatsApp webhook POST body to content-free inbound records.
 * Text bodies are hashed via the supplied hasher and never returned verbatim.
 */
export function extractCanaryInboundRecords(
  payload: unknown,
  sha256Hex: (value: string) => string,
): readonly CanaryInboundRecord[] {
  const root = asRecord(payload);
  if (!root || root.object !== "whatsapp_business_account") {
    return [];
  }
  const records: CanaryInboundRecord[] = [];
  const entries = Array.isArray(root.entry) ? root.entry.slice(0, 20) : [];
  for (const entryValue of entries) {
    const entry = asRecord(entryValue);
    const changes = entry && Array.isArray(entry.changes) ? entry.changes.slice(0, 20) : [];
    for (const changeValue of changes) {
      const change = asRecord(changeValue);
      if (!change || change.field !== "messages") continue;
      const value = asRecord(change.value);
      if (!value) continue;
      const metadata = asRecord(value.metadata);
      const phoneNumberId = asString(metadata?.phone_number_id);

      const messages = Array.isArray(value.messages) ? value.messages.slice(0, 20) : [];
      for (const messageValue of messages) {
        const message = asRecord(messageValue);
        if (!message) continue;
        const waMessageId = asString(message.id);
        const textRecord = asRecord(message.text);
        const body = asString(textRecord?.body);
        records.push({
          id: safeId(waMessageId, `inbound-${records.length + 1}`),
          workspaceId: META_CANARY_WORKSPACE_ID,
          kind: "message",
          waMessageId: waMessageId ?? "unknown",
          fromNumber: normalizeE164(asString(message.from) ?? undefined),
          toPhoneNumberId: phoneNumberId,
          messageType: asString(message.type),
          statusValue: null,
          bodySha256: body ? sha256Hex(body) : null,
          providerTimestamp: asString(message.timestamp),
          canary: true,
          containsMessageContent: false,
          schemaVersion: 1,
        });
      }

      const statuses = Array.isArray(value.statuses) ? value.statuses.slice(0, 20) : [];
      for (const statusValue of statuses) {
        const status = asRecord(statusValue);
        if (!status) continue;
        const waMessageId = asString(status.id);
        records.push({
          id: safeId(
            waMessageId ? `${waMessageId}-${asString(status.status) ?? "status"}` : null,
            `status-${records.length + 1}`,
          ),
          workspaceId: META_CANARY_WORKSPACE_ID,
          kind: "status",
          waMessageId: waMessageId ?? "unknown",
          fromNumber: null,
          toPhoneNumberId: phoneNumberId,
          messageType: null,
          statusValue: asString(status.status),
          bodySha256: null,
          providerTimestamp: asString(status.timestamp),
          canary: true,
          containsMessageContent: false,
          schemaVersion: 1,
        });
      }
    }
  }
  return records;
}

export function buildCanaryTemplateSendBody(input: {
  readonly to: string;
  readonly templateName: string;
  readonly languageCode: string;
}): UnknownRecord {
  if (
    !/^[a-z0-9_]{1,120}$/.test(input.templateName) ||
    !/^[A-Za-z_]{2,10}$/.test(input.languageCode)
  ) {
    throw new MetaCanaryError(
      "The canary template request failed strict validation.",
      "invalid_request",
    );
  }
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.to,
    type: "template",
    template: {
      name: input.templateName,
      language: { code: input.languageCode },
    },
  };
}
