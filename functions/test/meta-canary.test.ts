import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  MetaCanaryError,
  assertAllowlistedRecipient,
  buildCanaryTemplateSendBody,
  extractCanaryInboundRecords,
  normalizeE164,
  parseRecipientAllowlist,
  verifyMetaSignature,
  verifyMetaWebhookChallenge,
} from "../src/meta-canary/contracts.js";

const fakeSha = (value: string) => `sha:${value.length}`;

test("webhook challenge echoes only on an exact verify-token match", () => {
  const challenge = verifyMetaWebhookChallenge({
    mode: "subscribe",
    verifyToken: "a-long-enough-verify-token",
    challenge: "12345",
    expectedVerifyToken: "a-long-enough-verify-token",
  });
  assert.equal(challenge, "12345");

  for (const bad of [
    { mode: "unsubscribe", verifyToken: "a-long-enough-verify-token" },
    { mode: "subscribe", verifyToken: "wrong-token-entirely-here" },
    { mode: "subscribe", verifyToken: undefined },
  ]) {
    assert.throws(
      () =>
        verifyMetaWebhookChallenge({
          mode: bad.mode,
          verifyToken: bad.verifyToken,
          challenge: "12345",
          expectedVerifyToken: "a-long-enough-verify-token",
        }),
      MetaCanaryError,
    );
  }

  assert.throws(
    () =>
      verifyMetaWebhookChallenge({
        mode: "subscribe",
        verifyToken: "short",
        challenge: "12345",
        expectedVerifyToken: "short",
      }),
    MetaCanaryError,
    "verify tokens under 16 chars are refused outright",
  );
});

test("signature verification accepts only the exact HMAC of the raw body", () => {
  const secret = "test-app-secret-value";
  const body = Buffer.from(JSON.stringify({ object: "whatsapp_business_account" }));
  const good = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  verifyMetaSignature({ rawBody: body, signatureHeader: good, appSecret: secret });

  assert.throws(
    () =>
      verifyMetaSignature({
        rawBody: Buffer.concat([body, Buffer.from(" ")]),
        signatureHeader: good,
        appSecret: secret,
      }),
    MetaCanaryError,
  );
  assert.throws(
    () => verifyMetaSignature({ rawBody: body, signatureHeader: undefined, appSecret: secret }),
    MetaCanaryError,
  );
  assert.throws(
    () =>
      verifyMetaSignature({
        rawBody: body,
        signatureHeader: good.replace("sha256=", "sha1="),
        appSecret: secret,
      }),
    MetaCanaryError,
  );
});

test("allowlist parsing normalizes, dedupes and caps at five", () => {
  assert.deepEqual(parseRecipientAllowlist("+94 77 123-4567, 94771234567, +14155550100"), [
    "94771234567",
    "14155550100",
  ]);
  assert.deepEqual(
    parseRecipientAllowlist("1,2,3,not-a-number,+94770000001,+94770000002,+94770000003,+94770000004,+94770000005,+94770000006"),
    ["94770000001", "94770000002", "94770000003", "94770000004", "94770000005"],
  );
  assert.equal(normalizeE164("0771234567"), null, "local-format numbers without country code are refused");
});

test("outbound sends require an allowlisted recipient", () => {
  const allowlist = parseRecipientAllowlist("+94771234567");
  assert.equal(assertAllowlistedRecipient("+94 771 234 567", allowlist), "94771234567");
  assert.throws(() => assertAllowlistedRecipient("+94770000000", allowlist), MetaCanaryError);
  assert.throws(() => assertAllowlistedRecipient(undefined, allowlist), MetaCanaryError);
  assert.throws(() => assertAllowlistedRecipient("+94771234567", []), MetaCanaryError);
});

test("template body builder enforces strict names and languages", () => {
  const body = buildCanaryTemplateSendBody({
    to: "94771234567",
    templateName: "hello_world",
    languageCode: "en_US",
  });
  assert.deepEqual(body, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "94771234567",
    type: "template",
    template: { name: "hello_world", language: { code: "en_US" } },
  });
  assert.throws(
    () =>
      buildCanaryTemplateSendBody({
        to: "94771234567",
        templateName: "Hello World!",
        languageCode: "en_US",
      }),
    MetaCanaryError,
  );
});

test("inbound extraction is content-free and shape-tolerant", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-1",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "111222333" },
              messages: [
                {
                  id: "wamid.ABC==",
                  from: "+94771234567",
                  type: "text",
                  timestamp: "1754650000",
                  text: { body: "Hello Hemas Connect" },
                },
              ],
              statuses: [
                { id: "wamid.XYZ==", status: "delivered", timestamp: "1754650001" },
              ],
            },
          },
          { field: "other", value: {} },
        ],
      },
    ],
  };
  const records = extractCanaryInboundRecords(payload, fakeSha);
  assert.equal(records.length, 2);
  const message = records[0]!;
  const status = records[1]!;
  assert.equal(message.kind, "message");
  assert.equal(message.fromNumber, "94771234567");
  assert.equal(message.bodySha256, fakeSha("Hello Hemas Connect"));
  assert.equal(message.containsMessageContent, false);
  assert.equal(JSON.stringify(records).includes("Hello Hemas Connect"), false);
  assert.equal(status.kind, "status");
  assert.equal(status.statusValue, "delivered");

  assert.deepEqual(extractCanaryInboundRecords({ object: "page" }, fakeSha), []);
  assert.deepEqual(extractCanaryInboundRecords(null, fakeSha), []);
  assert.deepEqual(extractCanaryInboundRecords("string", fakeSha), []);
});
