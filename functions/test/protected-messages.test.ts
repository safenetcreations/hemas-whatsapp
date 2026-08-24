import assert from "node:assert/strict";
import test from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import { sha256Hex } from "../src/deterministic.js";
import {
  LITE_PROTECTED_MESSAGE_CONTENTS_COLLECTION,
  LITE_PROTECTED_MESSAGE_DEFAULT_RETENTION_DAYS,
  LITE_PROTECTED_MESSAGE_MAX_TEXT_LENGTH,
  buildProtectedMessageContentDocument,
  extractProtectedInboundContent,
  extractProtectedInboundMessageContent,
  extractProtectedOutboundContent,
  normalizeProtectedMessageText,
  parseProtectedMessageContentForProjection,
  parseProtectedMessageRetentionDays,
  protectedAgentOperationContentId,
  protectedBotEffectContentId,
  protectedInboundContentId,
  protectedMessageContentCollectionPath,
} from "../src/lite/protected-messages.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const NOW_MS = Date.parse("2026-08-22T06:00:00.000Z");
const SCOPE = {
  workspaceId: "workspace_safenet_demo",
  conversationId: "conversation_live_0123456789",
  teamId: "team_demo_general",
  locationId: "location_demo_wattala",
} as const;

test("protected content retention defaults safely and accepts only 1-30 whole days", () => {
  assert.equal(parseProtectedMessageRetentionDays(undefined), 7);
  assert.equal(parseProtectedMessageRetentionDays(""), 7);
  assert.equal(parseProtectedMessageRetentionDays("1"), 1);
  assert.equal(parseProtectedMessageRetentionDays("30"), 30);
  assert.equal(parseProtectedMessageRetentionDays(1), 1);
  assert.equal(parseProtectedMessageRetentionDays(30), 30);
  for (const invalid of [0, 31, 1.5, "0", "31", "07", " 7 ", true, null]) {
    assert.equal(
      parseProtectedMessageRetentionDays(invalid),
      LITE_PROTECTED_MESSAGE_DEFAULT_RETENTION_DAYS,
    );
  }
});

test("message text normalization removes unsafe controls and enforces 4096 code units", () => {
  assert.equal(normalizeProtectedMessageText("  hello\r\nworld\u0000  "), "hello\nworld");
  assert.equal(normalizeProtectedMessageText("\uD800safe"), "�safe");
  assert.equal(normalizeProtectedMessageText("\u0000 \r\n "), null);
  assert.equal(normalizeProtectedMessageText(123), null);
  const long = `${"a".repeat(LITE_PROTECTED_MESSAGE_MAX_TEXT_LENGTH - 1)}😀tail`;
  const normalized = normalizeProtectedMessageText(long);
  assert.equal(normalized?.length, LITE_PROTECTED_MESSAGE_MAX_TEXT_LENGTH - 1);
  assert.ok(!normalized?.endsWith("\uD83D"));
});

test("inbound selection and text extract the actual bounded visible value", () => {
  assert.deepEqual(
    extractProtectedInboundContent({ kind: "selection", selectionId: "book_appointment", text: "" }),
    { contentKind: "selection", text: "book_appointment" },
  );
  assert.deepEqual(
    extractProtectedInboundContent({ kind: "text", selectionId: "", text: "  MENU\r\nplease " }),
    { contentKind: "text", text: "MENU\nplease" },
  );
  assert.equal(extractProtectedInboundContent({ kind: "text", text: "\u0000" }), null);
  assert.equal(extractProtectedInboundContent({ kind: "image" }), null);

  assert.deepEqual(
    extractProtectedInboundMessageContent({
      waId: "94700000000",
      waMessageId: "wamid.visible-selection",
      messageType: "interactive",
      protectedText: "Book appointment",
      inbound: {
        kind: "selection",
        selectionId: "book_appointment",
        text: "",
      },
    }),
    { contentKind: "selection", text: "Book appointment" },
  );
  assert.deepEqual(
    extractProtectedInboundMessageContent({
      waId: "94700000000",
      waMessageId: "wamid.typed-inbound",
      messageType: "text",
      inbound: { kind: "text", selectionId: "", text: "Typed message" },
    }),
    { contentKind: "text", text: "Typed message" },
  );
  assert.deepEqual(
    extractProtectedInboundMessageContent({
      waId: "94700000000",
      waMessageId: "wamid.typed-caption",
      messageType: "image",
      protectedText: "  Image caption ",
      inbound: { kind: "text", selectionId: "", text: "" },
    }),
    { contentKind: "media_caption", text: "Image caption" },
  );
});

test("outbound extraction covers text, interactive body, and media captions only", () => {
  assert.deepEqual(
    extractProtectedOutboundContent({ type: "text", text: { body: " Reply " } }),
    { contentKind: "text", text: "Reply" },
  );
  assert.deepEqual(
    extractProtectedOutboundContent({
      type: "interactive",
      interactive: { body: { text: "Choose a department" } },
    }),
    { contentKind: "interactive_body", text: "Choose a department" },
  );
  for (const type of ["image", "video", "document"] as const) {
    assert.deepEqual(
      extractProtectedOutboundContent({ type, [type]: { id: "not-retained", caption: "Welcome" } }),
      { contentKind: "media_caption", text: "Welcome" },
    );
  }
  assert.equal(extractProtectedOutboundContent({ type: "audio", audio: { caption: "ignore" } }), null);
  assert.equal(extractProtectedOutboundContent({ type: "text", text: { body: "" } }), null);
});

test("protected content ids are deterministic, domain-separated, and source opaque", () => {
  const inbound = protectedInboundContentId("wamid.provider-secret");
  const bot = protectedBotEffectContentId("fx_0123456789abcdef");
  const agent = protectedAgentOperationContentId("reply_op_0123456789abcdef");
  assert.equal(inbound, protectedInboundContentId("wamid.provider-secret"));
  assert.match(inbound, /^pmc_in_[0-9a-f]{40}$/);
  assert.match(bot, /^pmc_bot_[0-9a-f]{40}$/);
  assert.match(agent, /^pmc_agent_[0-9a-f]{40}$/);
  assert.equal(new Set([inbound, bot, agent]).size, 3);
  assert.doesNotMatch(inbound, /provider-secret/);
  assert.notEqual(inbound, protectedInboundContentId("wamid.other"));
  assert.throws(() => protectedInboundContentId(" bad "), TypeError);
});

test("builder creates an exact TTL-bound materialized record below its conversation", () => {
  const id = protectedInboundContentId("wamid.inbound-1");
  const document = buildProtectedMessageContentDocument({
    id,
    ...SCOPE,
    messageId: "message_live_0123456789abcdef",
    direction: "inbound",
    source: "meta_inbound",
    contentKind: "text",
    text: "Hello",
    state: "materialized",
    nowMs: NOW_MS,
    retentionDays: "1",
  });
  assert.equal(LITE_PROTECTED_MESSAGE_CONTENTS_COLLECTION, "protectedMessageContents");
  assert.equal(
    protectedMessageContentCollectionPath(SCOPE.workspaceId, SCOPE.conversationId),
    `workspaces/${SCOPE.workspaceId}/conversations/${SCOPE.conversationId}/protectedMessageContents`,
  );
  assert.equal(document.bodySha256, sha256Hex("Hello"));
  assert.equal(document.bodyLength, 5);
  assert.equal(document.containsMessageContent, true);
  assert.equal(document.containsPlaintextSender, false);
  assert.equal(document.expiresAtMs, NOW_MS + DAY_MS);
  assert.equal(document.expireAt.toMillis(), document.expiresAtMs);
  assert.ok(document.createdAt instanceof Timestamp);
  assert.ok(document.updatedAt instanceof Timestamp);
});

test("builder supports outbound reservation/materialization while preventing false send claims", () => {
  const id = protectedAgentOperationContentId("reply_op_0123456789abcdef");
  const reserved = buildProtectedMessageContentDocument({
    id,
    ...SCOPE,
    messageId: null,
    direction: "outbound",
    source: "agent_reply",
    contentKind: "text",
    text: "We can help.",
    state: "reserved",
    nowMs: NOW_MS,
  });
  assert.equal(reserved.state, "reserved");
  assert.equal(reserved.messageId, null);

  const materialized = buildProtectedMessageContentDocument({
    id,
    ...SCOPE,
    messageId: "message_live_fedcba9876543210",
    direction: "outbound",
    source: "agent_reply",
    contentKind: "text",
    text: "We can help.",
    state: "materialized",
    createdAtMs: NOW_MS,
    nowMs: NOW_MS + 1_000,
  });
  assert.equal(materialized.createdAt.toMillis(), NOW_MS);
  assert.equal(materialized.updatedAt.toMillis(), NOW_MS + 1_000);
  assert.equal(materialized.expiresAtMs, NOW_MS + 7 * DAY_MS);

  const notSent = buildProtectedMessageContentDocument({
    id,
    ...SCOPE,
    messageId: null,
    direction: "outbound",
    source: "agent_reply",
    contentKind: "text",
    text: "We can help.",
    state: "not_sent",
    createdAtMs: NOW_MS,
    nowMs: NOW_MS + 2_000,
  });
  assert.equal(notSent.state, "not_sent");
  assert.equal(notSent.messageId, null);

  assert.throws(
    () => buildProtectedMessageContentDocument({
      ...materialized,
      state: "reserved",
      nowMs: NOW_MS + 2_000,
    }),
    /must not claim a messageId/,
  );
  assert.throws(
    () => buildProtectedMessageContentDocument({
      ...materialized,
      messageId: "message_demo_not_live",
      nowMs: NOW_MS + 2_000,
    }),
    /requires a safe messageId/,
  );
});

function validMaterialized() {
  return buildProtectedMessageContentDocument({
    id: protectedBotEffectContentId("fx_0123456789abcdef"),
    ...SCOPE,
    messageId: "message_live_aaaaaaaaaaaaaaaa",
    direction: "outbound",
    source: "menu_bot",
    contentKind: "interactive_body",
    text: "Choose an option",
    state: "materialized",
    nowMs: NOW_MS,
  });
}

function project(raw: unknown, nowMs = NOW_MS + 1_000) {
  return parseProtectedMessageContentForProjection(raw, { ...SCOPE, nowMs });
}

test("strict projection parser exposes only materialized scoped display fields", () => {
  const document = validMaterialized();
  assert.deepEqual(project(document), {
    id: document.id,
    messageId: document.messageId,
    direction: "outbound",
    source: "menu_bot",
    contentKind: "interactive_body",
    text: "Choose an option",
    createdAtMs: NOW_MS,
    updatedAtMs: NOW_MS,
  });
  assert.equal("bodySha256" in project(document)!, false);
  assert.equal("workspaceId" in project(document)!, false);
});

test("strict projection parser rejects pollution, tampering, and malformed timestamps", () => {
  const document = validMaterialized();
  const rejected = [
    { ...document, extra: true },
    { ...document, bodySha256: sha256Hex("different") },
    { ...document, bodyLength: document.bodyLength + 1 },
    { ...document, text: " Choose an option " },
    { ...document, containsPlaintextSender: true },
    { ...document, synthetic: false },
    { ...document, expireAt: Timestamp.fromMillis(document.expiresAtMs + 1) },
    { ...document, createdAt: new Date(document.createdAt.toMillis()) },
    { ...document, id: protectedAgentOperationContentId("reply_op_other"), source: "menu_bot" },
  ];
  for (const value of rejected) assert.equal(project(value), null);

  const pollutedPrototype = Object.assign(Object.create({ admin: true }), document);
  assert.equal(project(pollutedPrototype), null);
});

test("strict projection parser rejects cross-scope, expired, and non-materialized records", () => {
  const document = validMaterialized();
  for (const scopeChange of [
    { workspaceId: "workspace_other" },
    { conversationId: "conversation_live_ffffffffff" },
    { teamId: "team_other" },
    { locationId: "location_other" },
  ]) {
    assert.equal(
      parseProtectedMessageContentForProjection(document, {
        ...SCOPE,
        ...scopeChange,
        nowMs: NOW_MS + 1_000,
      }),
      null,
    );
  }
  assert.equal(project(document, document.expiresAtMs), null);
  assert.equal(project({ ...document, state: "reserved", messageId: null }), null);
  assert.equal(project({ ...document, state: "not_sent", messageId: null }), null);
});
