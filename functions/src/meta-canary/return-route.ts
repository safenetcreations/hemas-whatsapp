import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * A short-lived, content-free return route recovered only after a signed
 * inbound webhook. The caller is responsible for verifying the Meta webhook
 * signature before creating this record.
 */
export const META_CANARY_RETURN_ROUTE_SCHEMA_VERSION = 1 as const;
export const META_CANARY_RETURN_ROUTE_SOURCE = "signed_inbound" as const;
export const META_CANARY_RETURN_ROUTE_ALGORITHM = "aes-256-gcm" as const;
export const META_CANARY_RETURN_ROUTES_COLLECTION =
  "canary_inbound_return_routes" as const;

const AES_256_KEY_BYTES = 32;
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
const MAX_ROUTE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const WORKSPACE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const ROUTE_ID = /^return_route_[0-9a-f]{40}$/;
const CANONICAL_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_KEYRING_KEYS = 4;

export type MetaCanaryReturnRouteRecord = {
  readonly schemaVersion: typeof META_CANARY_RETURN_ROUTE_SCHEMA_VERSION;
  readonly keyVersion: number;
  readonly algorithm: typeof META_CANARY_RETURN_ROUTE_ALGORITHM;
  readonly workspaceId: string;
  readonly routeId: string;
  readonly source: typeof META_CANARY_RETURN_ROUTE_SOURCE;
  readonly phoneNumberAssetSha256: string;
  readonly senderSha256: string;
  readonly receiptSha256: string;
  readonly ciphertext: string;
  readonly nonce: string;
  readonly tag: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly containsMessageContent: false;
  readonly containsPlaintextSender: false;
};

export type EncryptMetaCanaryReturnRouteInput = {
  /** WhatsApp/Meta E.164 digits, with an optional leading plus sign. */
  readonly senderE164: string;
  /** Content-free provider receipt identifier; never the message body. */
  readonly receiptId: string;
  readonly workspaceId: string;
  readonly phoneNumberAssetSha256: string;
  /** Stable identity-HMAC key: canonical base64 encoding of exactly 32 bytes. */
  readonly identitySecretBase64: string;
  /** Versioned AES return-route key: canonical base64 encoding of exactly 32 bytes. */
  readonly encryptionSecretBase64: string;
  readonly keyVersion: number;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
};

export type DecryptMetaCanaryReturnRouteInput = {
  readonly record: unknown;
  readonly expectedWorkspaceId: string;
  readonly expectedPhoneNumberAssetSha256: string;
  readonly expectedSenderSha256: string;
  readonly expectedKeyVersion: number;
  /** Stable identity-HMAC key: canonical base64 encoding of exactly 32 bytes. */
  readonly identitySecretBase64: string;
  /** AES key selected from the route keyring using expectedKeyVersion. */
  readonly encryptionSecretBase64: string;
  readonly nowMs: number;
};

/** All validation and authentication failures deliberately share one message. */
export class MetaCanaryReturnRouteError extends Error {
  readonly code = "return_route_invalid" as const;

  constructor() {
    super("Encrypted return route is invalid or unavailable.");
    this.name = "MetaCanaryReturnRouteError";
  }
}

function refuse(): never {
  throw new MetaCanaryReturnRouteError();
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeE164Digits(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 16) return null;
  const candidate = value.startsWith("+") ? value.slice(1) : value;
  return /^[1-9]\d{7,14}$/.test(candidate) ? candidate : null;
}

function isWorkspaceId(value: unknown): value is string {
  return typeof value === "string" && WORKSPACE_ID.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

function isKeyVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 65_535;
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function decodeCanonicalBase64(value: unknown, expectedBytes?: number): Buffer | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    !CANONICAL_BASE64.test(value)
  ) {
    return null;
  }
  const decoded = Buffer.from(value, "base64");
  if (
    decoded.toString("base64") !== value ||
    (expectedBytes !== undefined && decoded.length !== expectedBytes)
  ) {
    decoded.fill(0);
    return null;
  }
  return decoded;
}

/**
 * Strict secret payload for versioned route decryption, for example
 * {"1":"<base64>"}. Old keys remain present until every route at that
 * version has expired, while the stable identity secret is rotated separately.
 */
export function parseMetaCanaryReturnRouteKeyring(
  value: string,
): ReadonlyMap<number, string> {
  try {
    if (typeof value !== "string" || value.length < 48 || value.length > 1_024) {
      refuse();
    }
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      refuse();
    }
    const prototype = Object.getPrototypeOf(parsed);
    if (prototype !== Object.prototype && prototype !== null) refuse();
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length < 1 || entries.length > MAX_KEYRING_KEYS) refuse();

    const keyring = new Map<number, string>();
    for (const [rawVersion, rawKey] of entries) {
      if (!/^[1-9]\d{0,4}$/.test(rawVersion)) refuse();
      const version = Number(rawVersion);
      if (!isKeyVersion(version) || keyring.has(version)) refuse();
      const decoded = decodeCanonicalBase64(rawKey, AES_256_KEY_BYTES);
      if (!decoded || typeof rawKey !== "string") refuse();
      decoded.fill(0);
      keyring.set(version, rawKey);
    }
    return keyring;
  } catch {
    throw new MetaCanaryReturnRouteError();
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

/** Secret-keyed public identity; unlike a plain phone hash it is not enumerable. */
export function metaCanaryReturnRouteSenderSha256(
  senderE164: string,
  identitySecretBase64: string,
): string {
  const senderDigits = normalizeE164Digits(senderE164);
  const key = decodeCanonicalBase64(identitySecretBase64, AES_256_KEY_BYTES);
  if (!senderDigits || !key) refuse();
  try {
    const identityKey = createHmac("sha256", key)
      .update("meta-canary-public-identity-key:v1", "utf8")
      .digest();
    try {
      return createHmac("sha256", identityKey)
        .update(`meta-canary-public-sender:v1:${senderDigits}`, "utf8")
        .digest("hex");
    } finally {
      identityKey.fill(0);
    }
  } finally {
    key.fill(0);
  }
}

/** Content-free binding for the exact Meta phone-number asset. */
export function metaCanaryReturnRoutePhoneAssetSha256(phoneNumberId: string): string {
  if (!/^\d{5,32}$/.test(phoneNumberId)) refuse();
  return sha256Hex(`meta-canary-phone-asset:${phoneNumberId}`);
}

/**
 * Stable across nonce and encryption-key rotation for the same receipt. Inputs
 * are already content-free, so the document identifier cannot reveal the
 * sender number. The separate identity key must remain stable while receipts,
 * public sessions, or STOP suppressions remain within retention.
 */
export function buildMetaCanaryReturnRouteId(input: {
  readonly workspaceId: string;
  readonly phoneNumberAssetSha256: string;
  readonly senderSha256: string;
  readonly receiptSha256: string;
}): string {
  if (
    !isWorkspaceId(input.workspaceId) ||
    !isSha256(input.phoneNumberAssetSha256) ||
    !isSha256(input.senderSha256) ||
    !isSha256(input.receiptSha256)
  ) {
    refuse();
  }
  const digest = sha256Hex(JSON.stringify([
    "meta-canary-return-route",
    META_CANARY_RETURN_ROUTE_SCHEMA_VERSION,
    META_CANARY_RETURN_ROUTE_SOURCE,
    input.workspaceId,
    input.phoneNumberAssetSha256,
    input.senderSha256,
    input.receiptSha256,
  ]));
  return `return_route_${digest.slice(0, 40)}`;
}

type ReturnRouteAad = Pick<
  MetaCanaryReturnRouteRecord,
  | "schemaVersion"
  | "keyVersion"
  | "algorithm"
  | "workspaceId"
  | "routeId"
  | "source"
  | "phoneNumberAssetSha256"
  | "senderSha256"
  | "receiptSha256"
  | "createdAtMs"
  | "expiresAtMs"
  | "containsMessageContent"
  | "containsPlaintextSender"
>;

function aadBytes(record: ReturnRouteAad): Buffer {
  return Buffer.from(JSON.stringify({
    schemaVersion: record.schemaVersion,
    keyVersion: record.keyVersion,
    algorithm: record.algorithm,
    workspaceId: record.workspaceId,
    routeId: record.routeId,
    source: record.source,
    phoneNumberAssetSha256: record.phoneNumberAssetSha256,
    senderSha256: record.senderSha256,
    receiptSha256: record.receiptSha256,
    createdAtMs: record.createdAtMs,
    expiresAtMs: record.expiresAtMs,
    containsMessageContent: record.containsMessageContent,
    containsPlaintextSender: record.containsPlaintextSender,
  }), "utf8");
}

const STRICT_RECORD_KEYS = [
  "algorithm",
  "ciphertext",
  "containsMessageContent",
  "containsPlaintextSender",
  "createdAtMs",
  "expiresAtMs",
  "keyVersion",
  "nonce",
  "phoneNumberAssetSha256",
  "receiptSha256",
  "routeId",
  "schemaVersion",
  "senderSha256",
  "source",
  "tag",
  "workspaceId",
] as const;

function parseStrictRecord(value: unknown): MetaCanaryReturnRouteRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) refuse();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) refuse();

  const data = value as Record<string, unknown>;
  const keys = Object.keys(data).sort();
  if (
    keys.length !== STRICT_RECORD_KEYS.length ||
    keys.some((key, index) => key !== STRICT_RECORD_KEYS[index])
  ) {
    refuse();
  }

  if (
    data.schemaVersion !== META_CANARY_RETURN_ROUTE_SCHEMA_VERSION ||
    !isKeyVersion(data.keyVersion) ||
    data.algorithm !== META_CANARY_RETURN_ROUTE_ALGORITHM ||
    !isWorkspaceId(data.workspaceId) ||
    typeof data.routeId !== "string" ||
    !ROUTE_ID.test(data.routeId) ||
    data.source !== META_CANARY_RETURN_ROUTE_SOURCE ||
    !isSha256(data.phoneNumberAssetSha256) ||
    !isSha256(data.senderSha256) ||
    !isSha256(data.receiptSha256) ||
    typeof data.ciphertext !== "string" ||
    typeof data.nonce !== "string" ||
    typeof data.tag !== "string" ||
    !isTimestamp(data.createdAtMs) ||
    !isTimestamp(data.expiresAtMs) ||
    data.expiresAtMs <= data.createdAtMs ||
    data.expiresAtMs - data.createdAtMs > MAX_ROUTE_LIFETIME_MS ||
    data.containsMessageContent !== false ||
    data.containsPlaintextSender !== false
  ) {
    refuse();
  }

  return data as MetaCanaryReturnRouteRecord;
}

export function encryptMetaCanaryReturnRoute(
  input: EncryptMetaCanaryReturnRouteInput,
): MetaCanaryReturnRouteRecord {
  let key: Buffer | null = null;
  let plaintext: Buffer | null = null;
  let nonce: Buffer | null = null;
  try {
    const senderDigits = normalizeE164Digits(input.senderE164);
    if (
      !senderDigits ||
      !isWorkspaceId(input.workspaceId) ||
      !isSha256(input.phoneNumberAssetSha256) ||
      !isKeyVersion(input.keyVersion) ||
      !isTimestamp(input.createdAtMs) ||
      !isTimestamp(input.expiresAtMs) ||
      input.expiresAtMs <= input.createdAtMs ||
      input.expiresAtMs - input.createdAtMs > MAX_ROUTE_LIFETIME_MS ||
      typeof input.receiptId !== "string" ||
      input.receiptId.length < 4 ||
      input.receiptId.length > 160
    ) {
      refuse();
    }

    key = decodeCanonicalBase64(input.encryptionSecretBase64, AES_256_KEY_BYTES);
    if (!key) refuse();

    const senderSha256 = metaCanaryReturnRouteSenderSha256(
      senderDigits,
      input.identitySecretBase64,
    );
    const receiptSha256 = sha256Hex(`meta-canary-route-receipt:v1:${input.receiptId}`);
    const metadata: ReturnRouteAad = {
      schemaVersion: META_CANARY_RETURN_ROUTE_SCHEMA_VERSION,
      keyVersion: input.keyVersion,
      algorithm: META_CANARY_RETURN_ROUTE_ALGORITHM,
      workspaceId: input.workspaceId,
      routeId: buildMetaCanaryReturnRouteId({
        workspaceId: input.workspaceId,
        phoneNumberAssetSha256: input.phoneNumberAssetSha256,
        senderSha256,
        receiptSha256,
      }),
      source: META_CANARY_RETURN_ROUTE_SOURCE,
      phoneNumberAssetSha256: input.phoneNumberAssetSha256,
      senderSha256,
      receiptSha256,
      createdAtMs: input.createdAtMs,
      expiresAtMs: input.expiresAtMs,
      containsMessageContent: false,
      containsPlaintextSender: false,
    };

    nonce = randomBytes(GCM_NONCE_BYTES);
    plaintext = Buffer.from(senderDigits, "utf8");
    const cipher = createCipheriv(META_CANARY_RETURN_ROUTE_ALGORITHM, key, nonce, {
      authTagLength: GCM_TAG_BYTES,
    });
    cipher.setAAD(aadBytes(metadata));
    const ciphertextBytes = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tagBytes = cipher.getAuthTag();

    return {
      ...metadata,
      ciphertext: ciphertextBytes.toString("base64"),
      nonce: nonce.toString("base64"),
      tag: tagBytes.toString("base64"),
    };
  } catch {
    throw new MetaCanaryReturnRouteError();
  } finally {
    key?.fill(0);
    plaintext?.fill(0);
    nonce?.fill(0);
  }
}

/** Returns canonical WhatsApp/Meta E.164 digits, without a leading plus sign. */
export function decryptMetaCanaryReturnRoute(
  input: DecryptMetaCanaryReturnRouteInput,
): string {
  let key: Buffer | null = null;
  let nonce: Buffer | null = null;
  let tag: Buffer | null = null;
  let ciphertext: Buffer | null = null;
  let plaintext: Buffer | null = null;
  try {
    const record = parseStrictRecord(input.record);
    if (
      !isTimestamp(input.nowMs) ||
      !isWorkspaceId(input.expectedWorkspaceId) ||
      !isSha256(input.expectedPhoneNumberAssetSha256) ||
      !isSha256(input.expectedSenderSha256) ||
      !isKeyVersion(input.expectedKeyVersion) ||
      input.nowMs < record.createdAtMs ||
      input.nowMs >= record.expiresAtMs ||
      !safeEqual(record.workspaceId, input.expectedWorkspaceId) ||
      !safeEqual(record.phoneNumberAssetSha256, input.expectedPhoneNumberAssetSha256) ||
      !safeEqual(record.senderSha256, input.expectedSenderSha256) ||
      record.keyVersion !== input.expectedKeyVersion
    ) {
      refuse();
    }

    const expectedRouteId = buildMetaCanaryReturnRouteId({
      workspaceId: record.workspaceId,
      phoneNumberAssetSha256: record.phoneNumberAssetSha256,
      senderSha256: record.senderSha256,
      receiptSha256: record.receiptSha256,
    });
    if (!safeEqual(record.routeId, expectedRouteId)) refuse();

    key = decodeCanonicalBase64(input.encryptionSecretBase64, AES_256_KEY_BYTES);
    nonce = decodeCanonicalBase64(record.nonce, GCM_NONCE_BYTES);
    tag = decodeCanonicalBase64(record.tag, GCM_TAG_BYTES);
    ciphertext = decodeCanonicalBase64(record.ciphertext);
    if (
      !key ||
      !nonce ||
      !tag ||
      !ciphertext ||
      ciphertext.length < 8 ||
      ciphertext.length > 15
    ) {
      refuse();
    }

    const decipher = createDecipheriv(META_CANARY_RETURN_ROUTE_ALGORITHM, key, nonce, {
      authTagLength: GCM_TAG_BYTES,
    });
    decipher.setAAD(aadBytes(record));
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    const senderDigits = plaintext.toString("utf8");
    const normalized = normalizeE164Digits(senderDigits);
    if (
      !normalized ||
      senderDigits !== normalized ||
      !safeEqual(
        metaCanaryReturnRouteSenderSha256(
          normalized,
          input.identitySecretBase64,
        ),
        record.senderSha256,
      )
    ) {
      refuse();
    }
    return normalized;
  } catch {
    throw new MetaCanaryReturnRouteError();
  } finally {
    key?.fill(0);
    nonce?.fill(0);
    tag?.fill(0);
    ciphertext?.fill(0);
    plaintext?.fill(0);
  }
}
