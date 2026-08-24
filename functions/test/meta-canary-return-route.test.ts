import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  MetaCanaryReturnRouteError,
  buildMetaCanaryReturnRouteId,
  decryptMetaCanaryReturnRoute,
  encryptMetaCanaryReturnRoute,
  metaCanaryReturnRouteSenderSha256,
  parseMetaCanaryReturnRouteKeyring,
  type MetaCanaryReturnRouteRecord,
} from "../src/meta-canary/return-route.js";

const identitySecretBase64 = Buffer.alloc(32, 0x2a).toString("base64");
const encryptionSecretBase64 = Buffer.alloc(32, 0x3b).toString("base64");
const wrongSecretBase64 = Buffer.alloc(32, 0x4b).toString("base64");
const senderE164 = "+94771234567";
const senderDigits = "94771234567";
const receiptId = "wamid.public-test-receipt";
const workspaceId = "workspace_safenet_demo";
const phoneNumberAssetSha256 = createHash("sha256")
  .update("canary-phone-number-asset:test", "utf8")
  .digest("hex");
const senderSha256 = metaCanaryReturnRouteSenderSha256(
  senderE164,
  identitySecretBase64,
);
const receiptSha256 = createHash("sha256")
  .update(`meta-canary-route-receipt:v1:${receiptId}`, "utf8")
  .digest("hex");
const createdAtMs = 1_800_000_000_000;
const expiresAtMs = createdAtMs + 5 * 60_000;

function encrypt(): MetaCanaryReturnRouteRecord {
  return encryptMetaCanaryReturnRoute({
    senderE164,
    receiptId,
    workspaceId,
    phoneNumberAssetSha256,
    identitySecretBase64,
    encryptionSecretBase64,
    keyVersion: 1,
    createdAtMs,
    expiresAtMs,
  });
}

function decrypt(record: unknown, overrides: Partial<{
  expectedWorkspaceId: string;
  expectedPhoneNumberAssetSha256: string;
  expectedSenderSha256: string;
  expectedKeyVersion: number;
  identitySecretBase64: string;
  encryptionSecretBase64: string;
  nowMs: number;
}> = {}): string {
  return decryptMetaCanaryReturnRoute({
    record,
    expectedWorkspaceId: overrides.expectedWorkspaceId ?? workspaceId,
    expectedPhoneNumberAssetSha256:
      overrides.expectedPhoneNumberAssetSha256 ?? phoneNumberAssetSha256,
    expectedSenderSha256: overrides.expectedSenderSha256 ?? senderSha256,
    expectedKeyVersion: overrides.expectedKeyVersion ?? 1,
    identitySecretBase64:
      overrides.identitySecretBase64 ?? identitySecretBase64,
    encryptionSecretBase64:
      overrides.encryptionSecretBase64 ?? encryptionSecretBase64,
    nowMs: overrides.nowMs ?? createdAtMs + 1,
  });
}

function assertRefused(run: () => unknown): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof MetaCanaryReturnRouteError);
    assert.equal(error.code, "return_route_invalid");
    assert.equal(error.message, "Encrypted return route is invalid or unavailable.");
    assert.doesNotMatch(error.message, /9477|1234567|workspace_safenet_demo/);
    return true;
  });
}

function tamperBase64(value: string): string {
  const bytes = Buffer.from(value, "base64");
  bytes[0] = (bytes[0] ?? 0) ^ 0x01;
  return bytes.toString("base64");
}

test("encrypted return routes round-trip with a stable id and random nonce", () => {
  const first = encrypt();
  const second = encrypt();

  assert.equal(decrypt(first), senderDigits);
  assert.equal(first.routeId, second.routeId);
  assert.equal(
    first.routeId,
    buildMetaCanaryReturnRouteId({
      workspaceId,
      phoneNumberAssetSha256,
      senderSha256,
      receiptSha256,
    }),
  );
  assert.notEqual(first.nonce, second.nonce);
  assert.notEqual(first.ciphertext, second.ciphertext);
  const differentReceipt = encryptMetaCanaryReturnRoute({
    senderE164,
    receiptId: `${receiptId}-different`,
    workspaceId,
    phoneNumberAssetSha256,
    identitySecretBase64,
    encryptionSecretBase64,
    keyVersion: 1,
    createdAtMs,
    expiresAtMs,
  });
  assert.notEqual(first.routeId, differentReceipt.routeId);
  assert.equal(Buffer.from(first.nonce, "base64").length, 12);
  assert.equal(Buffer.from(first.tag, "base64").length, 16);
});

test("serialized records contain neither plaintext sender nor message content", () => {
  const record = encrypt();
  const serialized = JSON.stringify(record);

  assert.equal(record.source, "signed_inbound");
  assert.equal(record.containsMessageContent, false);
  assert.equal(record.containsPlaintextSender, false);
  assert.equal(record.senderSha256, senderSha256);
  assert.equal(record.receiptSha256, receiptSha256);
  assert.notEqual(
    record.senderSha256,
    createHash("sha256").update(`canary-sender:${senderDigits}`).digest("hex"),
  );
  assert.equal(serialized.includes(senderE164), false);
  assert.equal(serialized.includes(senderDigits), false);
  assert.equal(Object.hasOwn(record, "senderE164"), false);
  assert.equal(Object.hasOwn(record, "senderLast4"), false);
  assert.equal(Object.hasOwn(record, "messageBody"), false);
});

test("ciphertext, nonce, tag, and authenticated metadata tampering fail closed", () => {
  const record = encrypt();
  const tamperedRecords: unknown[] = [
    { ...record, ciphertext: tamperBase64(record.ciphertext) },
    { ...record, nonce: tamperBase64(record.nonce) },
    { ...record, tag: tamperBase64(record.tag) },
    { ...record, receiptSha256: "0".repeat(64) },
    { ...record, expiresAtMs: record.expiresAtMs + 1 },
    { ...record, source: "manual" },
  ];

  for (const tampered of tamperedRecords) {
    assertRefused(() => decrypt(tampered));
  }
});

test("wrong asset, sender binding, key version, and secret fail closed", () => {
  const record = encrypt();
  const otherHash = createHash("sha256").update("other", "utf8").digest("hex");

  assertRefused(() => decrypt(record, { expectedPhoneNumberAssetSha256: otherHash }));
  assertRefused(() => decrypt(record, { expectedSenderSha256: otherHash }));
  assertRefused(() => decrypt(record, { expectedKeyVersion: 2 }));
  assertRefused(() => decrypt(record, {
    encryptionSecretBase64: wrongSecretBase64,
  }));
  assertRefused(() => decrypt(record, {
    identitySecretBase64: wrongSecretBase64,
  }));
});

test("expired and not-yet-valid routes fail closed", () => {
  const record = encrypt();

  assertRefused(() => decrypt(record, { nowMs: expiresAtMs }));
  assertRefused(() => decrypt(record, { nowMs: createdAtMs - 1 }));
});

test("strict schema and canonical encodings reject malformed records", () => {
  const record = encrypt();
  const malformedRecords: unknown[] = [
    null,
    [],
    { ...record, unexpected: true },
    { ...record, schemaVersion: 2 },
    { ...record, containsMessageContent: true },
    { ...record, containsPlaintextSender: true },
    { ...record, nonce: "not-base64" },
    { ...record, nonce: Buffer.alloc(11).toString("base64") },
    { ...record, tag: Buffer.alloc(15).toString("base64") },
    { ...record, ciphertext: "" },
    { ...record, routeId: `return_route_${"0".repeat(40)}` },
    { ...record, senderSha256: record.senderSha256.toUpperCase() },
    { ...record, expiresAtMs: record.createdAtMs },
  ];

  for (const malformed of malformedRecords) {
    assertRefused(() => decrypt(malformed));
  }
});

test("encryption rejects malformed E.164 values and non-32-byte secrets", () => {
  assertRefused(() => encryptMetaCanaryReturnRoute({
    senderE164: "077 123 4567",
    receiptId,
    workspaceId,
    phoneNumberAssetSha256,
    identitySecretBase64,
    encryptionSecretBase64,
    keyVersion: 1,
    createdAtMs,
    expiresAtMs,
  }));
  assertRefused(() => encryptMetaCanaryReturnRoute({
    senderE164,
    receiptId,
    workspaceId,
    phoneNumberAssetSha256,
    identitySecretBase64,
    encryptionSecretBase64: Buffer.alloc(31).toString("base64"),
    keyVersion: 1,
    createdAtMs,
    expiresAtMs,
  }));
  assertRefused(() => encryptMetaCanaryReturnRoute({
    senderE164,
    receiptId,
    workspaceId,
    phoneNumberAssetSha256,
    identitySecretBase64: "not-base64",
    encryptionSecretBase64,
    keyVersion: 1,
    createdAtMs,
    expiresAtMs,
  }));
  assertRefused(() => encryptMetaCanaryReturnRoute({
    senderE164,
    receiptId,
    workspaceId,
    phoneNumberAssetSha256,
    identitySecretBase64,
    encryptionSecretBase64,
    keyVersion: 1,
    createdAtMs,
    expiresAtMs: createdAtMs + 7 * 24 * 60 * 60 * 1_000 + 1,
  }));
});

test("keyring parsing supports bounded route-key rotation", () => {
  const secondKey = Buffer.alloc(32, 0x5c).toString("base64");
  const keyring = parseMetaCanaryReturnRouteKeyring(JSON.stringify({
    1: encryptionSecretBase64,
    2: secondKey,
  }));
  assert.equal(keyring.get(1), encryptionSecretBase64);
  assert.equal(keyring.get(2), secondKey);
  assert.equal(
    metaCanaryReturnRouteSenderSha256(senderE164, identitySecretBase64),
    senderSha256,
  );
  assertRefused(() => parseMetaCanaryReturnRouteKeyring("{}"));
  assertRefused(() => parseMetaCanaryReturnRouteKeyring(JSON.stringify({
    0: encryptionSecretBase64,
  })));
});
