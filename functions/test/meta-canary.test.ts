import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import {
  META_CANARY_MAX_WEBHOOK_ARRAY_ITEMS,
  META_CANARY_MAX_WEBHOOK_EVENTS,
  MetaCanaryError,
  assertAllowlistedRecipient,
  assertMetaCanaryTemplateAuthorization,
  assertMetaWebhookAssetBinding,
  buildCanaryMarketingOptOutEvidence,
  buildCanaryMarketingSuppression,
  buildCanaryTemplateSendBody,
  canaryMarketingOptOutKeyword,
  canaryMessageRecipients,
  canaryOutboundBridgeMessageRef,
  dedupeCanaryInboundRecords,
  decideCanaryInboundBatch,
  extractCanaryInboundBotMessages,
  extractCanaryInboundMarketingOptOuts,
  extractAllowlistedCanaryBotMessages,
  extractAllowlistedCanaryMarketingOptOuts,
  extractCanaryInboundBatch,
  extractCanaryInboundRecords,
  normalizeE164,
  parseRecipientAllowlist,
  selectFreshAllowlistedCanaryMessages,
  selectNewCanaryInboundRecords,
  verifyMetaSignature,
  verifyMetaWebhookChallenge,
} from "../src/meta-canary/contracts.js";
import {
  META_CANARY_MAX_INITIAL_OUTBOX_EFFECTS,
  META_CANARY_OUTBOX_MAX_ATTEMPTS,
  assertCanaryProviderMessageId,
  assertCanaryFatalResolutionInput,
  assertMetaCanaryOperationId,
  assertMetaCanaryReconcilerAuthorization,
  buildCanaryFatalResolutionAudit,
  buildCanaryProviderRouteEvidence,
  buildCanaryOutboxRecord,
  buildCanaryTransientAiReplyEvidence,
  buildContentFreeLegacyCanaryReceipt,
  buildInitialCanaryOutboxEffects,
  canaryOutboxEffectId,
  canaryFatalResolutionRequestSha256,
  canaryProviderRouteId,
  canaryTemplatePurpose,
  canaryTemplateOperationDocumentId,
  canaryTemplateRequestSha256,
  claimCanaryOutboxRecord,
  completeCanaryOutboxRecord,
  decideCanaryAutomationConversationSuppression,
  decideCanaryFatalResolution,
  decideCanaryGraphSuppression,
  decideCanaryReceiptEffectPlan,
  decideCanaryStatusTarget,
  decideCanaryTemplateOperation,
  decideCanaryTransientAiSequence,
  failCanaryOutboxRecord,
  markCanaryOutboxDispatchStarted,
  isActiveMetaCanaryMembership,
  isCanaryReceiptEffectSequenceValid,
  parseCanaryOutboxRecord,
  planCanaryBotReplies,
  preserveCanaryOutboundConversationState,
  reconcileCanaryFatalOutboxRecord,
  resolveCanaryOutboxRecipient,
  resolveCanaryProviderRoute,
  resolveCanaryRuntimeMode,
  selectCanaryBotReply,
  selectDueCanaryOutboxRecords,
  shouldPrepareCanaryTransientAi,
  terminalizeCanaryGraphEffectWithoutDispatch,
} from "../src/meta-canary/outbox.js";
import {
  insertCanaryOutboxChildEffects,
  presentMetaCanaryPublicBot,
  presentMetaCanaryPublicTransientReply,
  reconcileFatalCanaryGraphEffect,
} from "../src/meta-canary/outbox-runner.js";
import {
  FRESH_BOT_SESSION,
  runBotEngine,
} from "../src/meta-bot/engine.js";
import {
  isMetaCanaryPublicInboundWindowOpen,
  metaCanaryPublicProviderOccurredAtMs,
} from "../src/meta-canary/index.js";

const fakeSha = (value: string) => `sha:${value.length}`;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

test("public test window and provider timestamps fail closed at exact boundaries", () => {
  const nowMs = 1_800_000_000_000;
  assert.equal(isMetaCanaryPublicInboundWindowOpen({
    enabled: "true",
    expiresAtMs: String(nowMs + 24 * 60 * 60 * 1_000),
    nowMs,
  }), true);
  assert.equal(isMetaCanaryPublicInboundWindowOpen({
    enabled: "true",
    expiresAtMs: String(nowMs),
    nowMs,
  }), false);
  assert.equal(isMetaCanaryPublicInboundWindowOpen({
    enabled: "true",
    expiresAtMs: String(nowMs + 7 * 24 * 60 * 60 * 1_000 + 1),
    nowMs,
  }), false);
  assert.equal(isMetaCanaryPublicInboundWindowOpen({
    enabled: true,
    expiresAtMs: String(nowMs + 1_000),
    nowMs,
  }), false);

  assert.equal(
    metaCanaryPublicProviderOccurredAtMs(
      String((nowMs - 5 * 60_000) / 1_000),
      nowMs,
    ),
    nowMs - 5 * 60_000,
  );
  assert.equal(
    metaCanaryPublicProviderOccurredAtMs(
      String((nowMs + 60_000) / 1_000),
      nowMs,
    ),
    nowMs + 60_000,
  );
  for (const value of [
    null,
    "0",
    "1800000000.5",
    "1.8e9",
    String((nowMs - 5 * 60_000) / 1_000 - 1),
    String((nowMs + 60_000) / 1_000 + 1),
  ]) {
    assert.equal(metaCanaryPublicProviderOccurredAtMs(value, nowMs), null);
  }
});

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

test("signed webhook payloads require the exact configured WABA and phone asset", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "123456789012345",
        changes: [
          {
            field: "messages",
            value: { metadata: { phone_number_id: "987654321098765" } },
          },
        ],
      },
    ],
  };

  assert.doesNotThrow(() =>
    assertMetaWebhookAssetBinding(payload, "123456789012345", "987654321098765"),
  );

  const assertCode = (run: () => void, code: MetaCanaryError["code"]): void => {
    assert.throws(run, (error: unknown) =>
      error instanceof MetaCanaryError && error.code === code,
    );
  };
  assertCode(
    () => assertMetaWebhookAssetBinding(payload, "555556789012345", "987654321098765"),
    "asset_mismatch",
  );
  assertCode(
    () => assertMetaWebhookAssetBinding(payload, "123456789012345", "555554321098765"),
    "asset_mismatch",
  );
  assertCode(
    () => assertMetaWebhookAssetBinding(payload, undefined, "987654321098765"),
    "asset_binding_unconfigured",
  );
  assertCode(
    () => assertMetaWebhookAssetBinding({ object: "page" }, "123456789012345", "987654321098765"),
    "asset_mismatch",
  );
  assertCode(
    () => assertMetaWebhookAssetBinding(
      { object: "whatsapp_business_account", entry: [] },
      "123456789012345",
      "987654321098765",
    ),
    "asset_mismatch",
  );

  const mixedAssets = {
    ...payload,
    entry: [
      ...payload.entry,
      {
        id: "123456789012345",
        changes: [
          {
            field: "messages",
            value: { metadata: { phone_number_id: "111114321098765" } },
          },
        ],
      },
    ],
  };
  assertCode(
    () => assertMetaWebhookAssetBinding(mixedAssets, "123456789012345", "987654321098765"),
    "asset_mismatch",
  );
});

test("every 21-item webhook envelope level is rejected without truncated records", () => {
  const wabaId = "123456789012345";
  const phoneNumberId = "987654321098765";
  const message = (index: number) => ({
    id: `wamid.bound-${index}`,
    from: "+94771234567",
    type: "text",
    text: { body: "menu" },
  });
  const status = (index: number) => ({
    id: `wamid.status-${index}`,
    status: "delivered",
  });
  const change = (overrides: Record<string, unknown> = {}) => ({
    field: "messages",
    value: {
      metadata: { phone_number_id: phoneNumberId },
      messages: [message(0)],
      statuses: [],
      ...overrides,
    },
  });
  const entry = (changes: readonly unknown[]) => ({ id: wabaId, changes });
  const oversized = [
    {
      label: "entries",
      payload: {
        object: "whatsapp_business_account",
        entry: Array.from(
          { length: META_CANARY_MAX_WEBHOOK_ARRAY_ITEMS + 1 },
          () => entry([change()]),
        ),
      },
    },
    {
      label: "changes",
      payload: {
        object: "whatsapp_business_account",
        entry: [entry(Array.from(
          { length: META_CANARY_MAX_WEBHOOK_ARRAY_ITEMS + 1 },
          () => change(),
        ))],
      },
    },
    {
      label: "messages",
      payload: {
        object: "whatsapp_business_account",
        entry: [entry([change({
          messages: Array.from(
            { length: META_CANARY_MAX_WEBHOOK_ARRAY_ITEMS + 1 },
            (_, index) => message(index),
          ),
        })])],
      },
    },
    {
      label: "statuses",
      payload: {
        object: "whatsapp_business_account",
        entry: [entry([change({
          statuses: Array.from(
            { length: META_CANARY_MAX_WEBHOOK_ARRAY_ITEMS + 1 },
            (_, index) => status(index),
          ),
        })])],
      },
    },
  ] as const;

  for (const testCase of oversized) {
    const batch = extractCanaryInboundBatch(testCase.payload, sha);
    assert.equal(batch.overflow, true, `${testCase.label} must overflow`);
    assert.deepEqual(
      decideCanaryInboundBatch(batch),
      { kind: "reject_overflow" },
      `${testCase.label} must never expose a partial acceptance`,
    );
    assert.deepEqual(
      extractCanaryInboundRecords(testCase.payload, sha),
      [],
      `${testCase.label} compatibility extraction must also fail closed`,
    );
    assert.throws(
      () => assertMetaWebhookAssetBinding(testCase.payload, wabaId, phoneNumberId),
      (error: unknown) =>
        error instanceof MetaCanaryError && error.code === "webhook_batch_overflow",
      `${testCase.label} must be rejected before persistence`,
    );
  }
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

test("public inbound accepts any signed-payload sender without widening proactive sends", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: { messages: [
      {
        id: "wamid.public-question",
        from: "+94770000000",
        type: "text",
        text: { body: "Public in-memory question" },
      },
      {
        id: "wamid.public-stop",
        from: "+94770000001",
        type: "text",
        text: { body: "STOP" },
      },
    ] } }] }],
  };
  const allowlist = parseRecipientAllowlist("+94771234567");
  assert.deepEqual(
    extractCanaryInboundBotMessages(payload, allowlist, false),
    [],
    "the exact public flag preserves the tester-only default",
  );
  const publicMessages = extractCanaryInboundBotMessages(payload, allowlist, true);
  assert.equal(publicMessages.length, 2);
  assert.deepEqual(
    extractCanaryInboundMarketingOptOuts(payload, allowlist, true),
    [{ waId: "94770000001", waMessageId: "wamid.public-stop", keyword: "STOP" }],
  );
  assert.throws(
    () => assertAllowlistedRecipient("+94770000000", allowlist),
    MetaCanaryError,
    "public inbound never widens proactive outbound",
  );
});

test("public inbound effects persist only an encrypted return-route reference", () => {
  const record = {
    id: "wamid.public-route",
    workspaceId: "workspace_safenet_demo" as const,
    kind: "message" as const,
    waMessageId: "wamid.public-route",
    fromNumberSha256: sha("keyed-public-subject-fixture"),
    fromNumberLast4: null,
    toPhoneNumberId: "123456789012345",
    messageType: "text",
    statusValue: null,
    bodySha256: null,
    providerTimestamp: "1800000000",
    canary: true as const,
    containsMessageContent: false as const,
    schemaVersion: 2 as const,
  };
  const routeId = `return_route_${"a".repeat(40)}`;
  const effects = buildInitialCanaryOutboxEffects({
    records: [record],
    allowlistedMessages: [{
      waId: "94770000000",
      waMessageId: record.waMessageId,
      messageType: "text",
      inbound: { kind: "text", selectionId: "", text: "hello" },
    }],
    optOuts: [],
    inboundReturnRouteIds: new Map([[record.waMessageId, routeId]]),
    mode: "bot",
    nowMs: 1_800_000_000_000,
    sha256Hex: sha,
  });
  const botPlan = effects.find((effect) => effect.effectKind === "bot_plan");
  assert.equal(botPlan?.payload.inboundReturnRouteId, routeId);
  assert.equal(Object.hasOwn(botPlan?.payload ?? {}, "recipientLast4"), false);
  const serialized = JSON.stringify(effects);
  assert.equal(serialized.includes("94770000000"), false);
  assert.equal(serialized.includes("hello"), false);
});

test("public bot begins with a privacy notice and never creates a staff handoff", () => {
  const first = runBotEngine(
    FRESH_BOT_SESSION,
    { kind: "text", text: "hello", selectionId: "", nowMs: 1_800_000_000_000 },
    {},
  );
  const firstPresentation = presentMetaCanaryPublicBot(first, FRESH_BOT_SESSION);
  assert.equal(firstPresentation.staffHandoff, false);
  assert.match(
    JSON.stringify(firstPresentation.replies[0]),
    /Do not send medical, personal, or emergency information/,
  );

  const menuSession = {
    language: "en" as const,
    state: "menu" as const,
    departmentId: null,
    dayId: null,
    updatedAtMs: 1_800_000_000_000,
  };
  const staff = runBotEngine(
    menuSession,
    {
      kind: "selection",
      text: "",
      selectionId: "menu_staff",
      nowMs: 1_800_000_001_000,
    },
    {},
  );
  const staffPresentation = presentMetaCanaryPublicBot(staff, menuSession);
  assert.equal(staff.staffHandoff, true);
  assert.equal(staffPresentation.staffHandoff, false);
  assert.equal(staffPresentation.replies.length, 1);
  assert.match(JSON.stringify(staffPresentation.replies[0]), /cannot create a staff/);
  assert.match(
    JSON.stringify(staffPresentation.replies[0]),
    /Do not send medical, personal, or emergency information/,
  );

  const laterMenu = runBotEngine(
    menuSession,
    {
      kind: "text",
      text: "MENU",
      selectionId: "",
      nowMs: 1_800_000_002_000,
    },
    {},
  );
  const laterPresentation = presentMetaCanaryPublicBot(laterMenu, menuSession);
  assert.ok(laterPresentation.replies.length > 0);
  for (const reply of laterPresentation.replies) {
    assert.match(
      JSON.stringify(reply),
      /Do not send medical, personal, or emergency information/,
    );
  }

  const bookingPresentation = presentMetaCanaryPublicBot(
    {
      ...laterMenu,
      replies: [{ type: "text", text: { body: "recorded and will follow up" } }],
      booking: {
        departmentId: "dept_general",
        departmentLabel: "General Consultation",
        dayId: "day_1",
        dayLabel: "Tomorrow",
        slotId: "slot_0900",
        slotLabel: "9.00 AM",
        language: "en",
        reference: "HC-00001",
      },
    },
    menuSession,
  );
  const bookingBody = JSON.stringify(bookingPresentation.replies);
  assert.match(bookingBody, /Nothing was saved/);
  assert.match(bookingBody, /no staff follow-up will occur/);
  assert.doesNotMatch(bookingBody, /recorded and will follow up/);
});

test("public transient AI replies retain the privacy notice without mutating the answer", () => {
  const transientReply = {
    type: "text",
    text: {
      preview_url: false,
      body: "Synthetic governed answer.",
    },
  } as const;
  const presented = presentMetaCanaryPublicTransientReply(transientReply);
  const serialized = JSON.stringify(presented);
  assert.match(serialized, /Do not send medical, personal, or emergency information/);
  assert.match(serialized, /Synthetic governed answer/);
  assert.equal(
    JSON.stringify(transientReply).includes("Do not send medical"),
    false,
  );
});

test("template sends require a verified identity and exact boolean custom claim", () => {
  assert.equal(
    assertMetaCanaryTemplateAuthorization({
      uid: "synthetic-demo-admin-uid",
      emailVerified: true,
      hemasMetaCanary: true,
    }),
    "synthetic-demo-admin-uid",
  );

  const assertDenied = (input: {
    readonly uid: unknown;
    readonly emailVerified: unknown;
    readonly hemasMetaCanary: unknown;
  }): void => {
    assert.throws(
      () => assertMetaCanaryTemplateAuthorization(input),
      (error: unknown) =>
        error instanceof MetaCanaryError && error.code === "authentication_required",
    );
  };
  assertDenied({
    uid: "synthetic-demo-admin-uid",
    emailVerified: true,
    hemasMetaCanary: undefined,
  });
  assertDenied({
    uid: "synthetic-demo-admin-uid",
    emailVerified: true,
    hemasMetaCanary: false,
  });
  assertDenied({
    uid: "synthetic-demo-admin-uid",
    emailVerified: true,
    hemasMetaCanary: "true",
  });
  assertDenied({
    uid: "synthetic-demo-admin-uid",
    emailVerified: false,
    hemasMetaCanary: true,
  });
  assertDenied({
    uid: "synthetic-demo-admin-uid",
    emailVerified: undefined,
    hemasMetaCanary: true,
  });
  assertDenied({
    uid: "synthetic-demo-admin-uid",
    emailVerified: "true",
    hemasMetaCanary: true,
  });
  assertDenied({
    uid: "",
    emailVerified: true,
    hemasMetaCanary: true,
  });
});

test("bot extraction admits only allowlisted inbound messages and dedupes provider ids", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              messages: [
                {
                  id: "wamid.allowed-text",
                  from: "+94771234567",
                  type: "text",
                  text: { body: "Allowed in-memory question" },
                },
                {
                  id: "wamid.blocked-text",
                  from: "+94770000000",
                  type: "text",
                  text: { body: "Blocked sender content" },
                },
                {
                  id: "wamid.allowed-selection",
                  from: "94771234567",
                  type: "interactive",
                  interactive: { button_reply: { id: "book_appointment" } },
                },
                {
                  id: "wamid.allowed-text",
                  from: "+94771234567",
                  type: "text",
                  text: { body: "Duplicate provider delivery" },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const messages = extractAllowlistedCanaryBotMessages(
    payload,
    parseRecipientAllowlist("+94771234567"),
  );
  assert.equal(messages.length, 2);
  assert.deepEqual(messages.map((message) => message.waMessageId), [
    "wamid.allowed-text",
    "wamid.allowed-selection",
  ]);
  assert.equal(messages[0]?.inbound.text, "Allowed in-memory question");
  assert.equal(messages[1]?.inbound.selectionId, "book_appointment");
  assert.equal(JSON.stringify(messages).includes("Blocked sender content"), false);
  assert.deepEqual(extractAllowlistedCanaryBotMessages(payload, []), []);

  const freshMessages = selectFreshAllowlistedCanaryMessages(
    payload,
    parseRecipientAllowlist("+94771234567"),
    new Set(["wamid.allowed-selection"]),
  );
  assert.deepEqual(
    freshMessages.map((message) => message.waMessageId),
    ["wamid.allowed-selection"],
  );
  assert.deepEqual(canaryMessageRecipients(freshMessages), ["94771234567"]);
  assert.deepEqual(
    selectFreshAllowlistedCanaryMessages(
      payload,
      parseRecipientAllowlist("+94771234567"),
      new Set(),
    ),
    [],
    "a duplicate provider event cannot yield a bot or automatic-reply recipient",
  );
  assert.deepEqual(canaryMessageRecipients([]), []);
});

test("STOP and UNSUBSCRIBE produce deterministic content-free suppression evidence", () => {
  assert.equal(canaryMarketingOptOutKeyword(" stop \n"), "STOP");
  assert.equal(canaryMarketingOptOutKeyword("UnSuBsCrIbE"), "UNSUBSCRIBE");
  for (const ordinaryText of ["please stop", "STOP ALL", "STOP!", "subscription help", ""]) {
    assert.equal(canaryMarketingOptOutKeyword(ordinaryText), null);
  }

  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              messages: [
                { id: "wamid.stop", from: "+94771234567", type: "text", text: { body: "STOP" } },
                {
                  id: "wamid.unsubscribe",
                  from: "+94771234567",
                  type: "text",
                  text: { body: " unsubscribe " },
                },
                {
                  id: "wamid.not-allowlisted",
                  from: "+94770000000",
                  type: "text",
                  text: { body: "STOP" },
                },
                {
                  id: "wamid.not-exact",
                  from: "+94771234567",
                  type: "text",
                  text: { body: "please stop" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const optOuts = extractAllowlistedCanaryMarketingOptOuts(
    payload,
    parseRecipientAllowlist("+94771234567"),
  );
  assert.deepEqual(optOuts, [
    { waId: "94771234567", waMessageId: "wamid.stop", keyword: "STOP" },
    { waId: "94771234567", waMessageId: "wamid.unsubscribe", keyword: "UNSUBSCRIBE" },
  ]);

  const evidence = buildCanaryMarketingOptOutEvidence({
    providerMessageId: "wamid.stop",
    contactId: "contact_live_1234567890",
    keyword: "STOP",
    sha256Hex: fakeSha,
  });
  assert.equal(evidence.containsMessageContent, false);
  assert.equal(evidence.status, "withdrawn");
  assert.equal(evidence.category, "marketing");
  assert.equal(JSON.stringify(evidence).includes("wamid.stop"), false);
  assert.equal("body" in evidence, false);
  assert.equal("text" in evidence, false);

  const first = buildCanaryMarketingSuppression(
    {
      suppressAll: false,
      suppressMarketing: false,
      invalidContact: false,
      reasons: ["complaint"],
    },
    "first-timestamp",
  );
  assert.deepEqual(first, {
    suppression: {
      suppressAll: false,
      suppressMarketing: true,
      invalidContact: false,
      reasons: ["complaint", "stop_keyword"],
      updatedAt: "first-timestamp",
    },
    preferenceRevisionIncrement: 1,
  });
  const replay = buildCanaryMarketingSuppression(first.suppression, "second-timestamp");
  assert.equal(replay.preferenceRevisionIncrement, 0);
  assert.deepEqual(replay.suppression.reasons, ["complaint", "stop_keyword"]);
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

test("inbound extraction is content-free, sender-minimized and shape-tolerant", () => {
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
  assert.equal(message.fromNumberSha256, fakeSha("canary-sender:94771234567"));
  assert.equal(message.fromNumberLast4, "4567");
  assert.equal(message.bodySha256, fakeSha("Hello Hemas Connect"));
  assert.equal(message.containsMessageContent, false);
  assert.equal(message.schemaVersion, 2);
  assert.equal("fromNumber" in message, false);
  assert.equal(JSON.stringify(records).includes("94771234567"), false);
  assert.equal(JSON.stringify(records).includes("Hello Hemas Connect"), false);
  assert.equal(status.kind, "status");
  assert.equal(status.statusValue, "delivered");
  assert.equal(status.fromNumberSha256, null);
  assert.equal(status.fromNumberLast4, null);

  assert.deepEqual(extractCanaryInboundRecords({ object: "page" }, fakeSha), []);
  assert.deepEqual(extractCanaryInboundRecords(null, fakeSha), []);
  assert.deepEqual(extractCanaryInboundRecords("string", fakeSha), []);
});

test("global webhook cap rejects an oversized signed delivery before partial planning", () => {
  const payloadWithMessages = (count: number) => ({
    object: "whatsapp_business_account",
    entry: [{
      id: "123456789012345",
      changes: Array.from({ length: Math.ceil(count / 20) }, (_, changeIndex) => ({
        field: "messages",
        value: {
          metadata: { phone_number_id: "987654321098765" },
          messages: Array.from(
            { length: Math.min(20, count - changeIndex * 20) },
            (_, messageIndex) => {
              const index = changeIndex * 20 + messageIndex;
              return {
                id: `wamid.bulk-${index}`,
                from: "+94771234567",
                type: "text",
                text: { body: "menu" },
              };
            },
          ),
        },
      })),
    }],
  });

  const exactPayload = payloadWithMessages(META_CANARY_MAX_WEBHOOK_EVENTS);
  const exact = extractCanaryInboundBatch(exactPayload, sha);
  assert.equal(exact.overflow, false);
  assert.equal(exact.records.length, META_CANARY_MAX_WEBHOOK_EVENTS);
  const accepted = decideCanaryInboundBatch(exact);
  assert.equal(accepted.kind, "accept");

  const largePayload = payloadWithMessages(META_CANARY_MAX_WEBHOOK_EVENTS + 20);
  const overflow = extractCanaryInboundBatch(largePayload, sha);
  assert.equal(overflow.overflow, true);
  assert.equal(overflow.records.length, META_CANARY_MAX_WEBHOOK_EVENTS);
  const rejected = decideCanaryInboundBatch(overflow);
  assert.deepEqual(rejected, { kind: "reject_overflow" });
  assert.equal("records" in rejected, false, "truncated records cannot reach persistence");
  assert.deepEqual(
    extractCanaryInboundBatch(largePayload, sha).records.map((record) => record.id),
    overflow.records.map((record) => record.id),
    "the global cut-off is deterministic across Meta retries",
  );

  const allowlist = parseRecipientAllowlist("+94771234567");
  const effects = buildInitialCanaryOutboxEffects({
    records: exact.records,
    allowlistedMessages: extractAllowlistedCanaryBotMessages(exactPayload, allowlist),
    optOuts: [],
    mode: "bot",
    nowMs: 1_000,
    sha256Hex: sha,
  });
  assert.equal(effects.length, META_CANARY_MAX_INITIAL_OUTBOX_EFFECTS);
  assert.throws(
    () => buildInitialCanaryOutboxEffects({
      records: [...exact.records, exact.records[0]!],
      allowlistedMessages: [],
      optOuts: [],
      mode: "none",
      nowMs: 1_000,
      sha256Hex: sha,
    }),
    /meta_canary_webhook_batch_overflow/,
  );
});

test("provider-event receipt selection dedupes deliveries and excludes existing ids", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "123456789012345",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "987654321098765" },
              messages: [
                { id: "wamid.same-message", from: "+94771234567", type: "text" },
                { id: "wamid.same-message", from: "+94771234567", type: "text" },
              ],
              statuses: [
                { id: "wamid.outbound", status: "delivered" },
                { id: "wamid.outbound", status: "delivered" },
              ],
            },
          },
        ],
      },
    ],
  };
  const records = extractCanaryInboundRecords(payload, fakeSha);
  assert.equal(records.length, 4, "the extractor preserves provider delivery order");

  const unique = dedupeCanaryInboundRecords(records);
  assert.equal(unique.length, 2);
  assert.deepEqual(unique.map((record) => record.kind), ["message", "status"]);

  const onlyNewStatus = selectNewCanaryInboundRecords(
    records,
    new Set([unique[0]!.id]),
  );
  assert.equal(onlyNewStatus.length, 1);
  assert.equal(onlyNewStatus[0]?.kind, "status");
  assert.deepEqual(
    selectNewCanaryInboundRecords(records, new Set(unique.map((record) => record.id))),
    [],
  );
});

test("each bot reply receives a distinct content-free outbound bridge reference", () => {
  const refs = [0, 1, 2].map((replyIndex) =>
    canaryOutboundBridgeMessageRef("wamid.provider-reply", "wamid.inbound", replyIndex),
  );
  assert.equal(new Set(refs).size, 3);
  assert.deepEqual(refs, [
    "wamid.provider-reply:reply:0",
    "wamid.provider-reply:reply:1",
    "wamid.provider-reply:reply:2",
  ]);
  assert.notEqual(
    canaryOutboundBridgeMessageRef(null, "wamid.inbound", 0),
    canaryOutboundBridgeMessageRef(null, "wamid.inbound", 1),
  );
  const effectIds = [0, 1, 2].map((replyIndex) => canaryOutboxEffectId(
    "receipt.multi-reply",
    "graph_bot_reply",
    `plan:${replyIndex}`,
    sha,
  ));
  assert.equal(new Set(effectIds).size, 3);
});

test("durable planner creates deterministic per-effect ids and STOP blocks bot side effects", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        field: "messages",
        value: {
          metadata: { phone_number_id: "987654321098765" },
          messages: [
            {
              id: "wamid.stop-durable",
              from: "+94771234567",
              type: "text",
              text: { body: "STOP" },
            },
            {
              id: "wamid.menu-durable",
              from: "+94771234567",
              type: "text",
              text: { body: "menu" },
            },
          ],
        },
      }],
    }],
  };
  const allowlist = parseRecipientAllowlist("+94771234567");
  const records = extractCanaryInboundRecords(payload, sha);
  const messages = extractAllowlistedCanaryBotMessages(payload, allowlist);
  const optOuts = extractAllowlistedCanaryMarketingOptOuts(payload, allowlist);
  const first = buildInitialCanaryOutboxEffects({
    records,
    allowlistedMessages: messages,
    optOuts,
    mode: "bot",
    nowMs: 1_000,
    sha256Hex: sha,
  });
  const replay = buildInitialCanaryOutboxEffects({
    records,
    allowlistedMessages: messages,
    optOuts,
    mode: "bot",
    nowMs: 9_000,
    sha256Hex: sha,
  });
  assert.deepEqual(first.map((effect) => effect.id), replay.map((effect) => effect.id));
  assert.equal(new Set(first.map((effect) => effect.id)).size, first.length);

  const stopReceipt = records.find((record) => record.waMessageId === "wamid.stop-durable")!.id;
  const stopEffects = first.filter((effect) => effect.receiptId === stopReceipt);
  assert.deepEqual(stopEffects.map((effect) => effect.effectKind), [
    "inbound_metric",
    "stop_suppression",
  ]);
  assert.equal(stopEffects.some((effect) => effect.effectKind === "bot_plan"), false);
  assert.equal(stopEffects.find((effect) => effect.effectKind === "stop_suppression")?.state, "terminal");

  const menuReceipt = records.find((record) => record.waMessageId === "wamid.menu-durable")!.id;
  assert.deepEqual(
    first.filter((effect) => effect.receiptId === menuReceipt).map((effect) => effect.effectKind),
    ["inbound_metric", "bot_plan"],
  );
  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes("94771234567"), false);
  assert.equal(serialized.includes('"body"'), false);
  assert.ok(first.every((effect) =>
    effect.containsMessageContent === false && effect.containsFullSender === false
  ));
});

test("provider receipt replay remains bound across auto and bot mode switches", () => {
  assert.equal(resolveCanaryRuntimeMode({ botEnabled: true, autoReplyEnabled: false }), "bot");
  assert.equal(
    resolveCanaryRuntimeMode({ botEnabled: false, autoReplyEnabled: true }),
    "auto_reply",
  );
  assert.equal(resolveCanaryRuntimeMode({ botEnabled: false, autoReplyEnabled: false }), "none");
  assert.throws(
    () => resolveCanaryRuntimeMode({ botEnabled: true, autoReplyEnabled: true }),
    /meta_canary_mode_conflict/,
  );
  const payload = {
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        field: "messages",
        value: {
          metadata: { phone_number_id: "987654321098765" },
          messages: [{
            id: "wamid.cross-mode",
            from: "+94771234567",
            type: "text",
            timestamp: "1754650000",
            text: { body: "menu" },
          }],
        },
      }],
    }],
  };
  const record = extractCanaryInboundRecords(payload, sha)[0]!;
  const messages = extractAllowlistedCanaryBotMessages(
    payload,
    parseRecipientAllowlist("+94771234567"),
  );
  const plan = (mode: "bot" | "auto_reply") => buildInitialCanaryOutboxEffects({
    records: [record],
    allowlistedMessages: messages,
    optOuts: [],
    mode,
    nowMs: 1_000,
    sha256Hex: sha,
  });
  const autoEffects = plan("auto_reply");
  const botEffects = plan("bot");
  const autoIds = autoEffects.map((effect) => effect.id);
  const botIds = botEffects.map((effect) => effect.id);
  assert.notDeepEqual(autoIds, botIds, "the two modes intentionally have different reply effects");
  assert.equal(autoEffects[1]?.effectKind, "graph_auto_reply");
  assert.equal(botEffects[1]?.effectKind, "bot_plan");

  const autoReceipt = {
    ...record,
    outboxEffectIds: autoIds,
    outboxPlanMode: "auto_reply",
    outboxPlanVersion: 1,
  };
  assert.deepEqual(decideCanaryReceiptEffectPlan({
    existingReceipt: autoReceipt,
    record,
    currentMode: "bot",
    currentPlannedEffectIds: botIds,
  }), {
    kind: "replay",
    effectIds: autoIds,
    planMode: "auto_reply",
  }, "auto to bot replay reuses only the original auto plan");

  const botReceipt = {
    ...record,
    outboxEffectIds: botIds,
    outboxPlanMode: "bot",
    outboxPlanVersion: 1,
  };
  assert.deepEqual(decideCanaryReceiptEffectPlan({
    existingReceipt: botReceipt,
    record,
    currentMode: "auto_reply",
    currentPlannedEffectIds: autoIds,
  }), {
    kind: "replay",
    effectIds: botIds,
    planMode: "bot",
  }, "bot to auto replay reuses only the original bot plan");

  assert.equal(isCanaryReceiptEffectSequenceValid({
    recordKind: "message",
    planMode: "auto_reply",
    effectKinds: autoEffects.map((effect) => effect.effectKind),
  }), true);
  assert.equal(isCanaryReceiptEffectSequenceValid({
    recordKind: "message",
    planMode: "bot",
    effectKinds: autoEffects.map((effect) => effect.effectKind),
  }), false);
  assert.deepEqual(decideCanaryReceiptEffectPlan({
    existingReceipt: record,
    record,
    currentMode: "bot",
    currentPlannedEffectIds: botIds,
  }), {
    kind: "legacy_replay",
    effectIds: [],
    planMode: "none",
    migrateReceipt: true,
  }, "an exact pre-outbox receipt is acknowledged without creating or resending effects");
  const legacyV1MessageReceipt = {
    id: record.id,
    workspaceId: record.workspaceId,
    kind: record.kind,
    waMessageId: record.waMessageId,
    fromNumber: "94771234567",
    toPhoneNumberId: record.toPhoneNumberId,
    messageType: record.messageType,
    statusValue: record.statusValue,
    bodySha256: record.bodySha256,
    providerTimestamp: record.providerTimestamp,
    canary: true,
    containsMessageContent: false,
    schemaVersion: 1,
  };
  assert.deepEqual(decideCanaryReceiptEffectPlan({
    existingReceipt: legacyV1MessageReceipt,
    record,
    currentMode: "bot",
    currentPlannedEffectIds: botIds,
    sha256Hex: sha,
  }), {
    kind: "legacy_replay",
    effectIds: [],
    planMode: "none",
    migrateReceipt: true,
  }, "an exact schema-v1 message receipt is acknowledged without a resend");
  const migratedMessageReceipt = buildContentFreeLegacyCanaryReceipt({
    existingReceipt: legacyV1MessageReceipt,
    record,
    receivedAtFallback: "fallback-time",
    migratedAt: "migration-time",
  });
  assert.equal(JSON.stringify(migratedMessageReceipt).includes("94771234567"), false);
  assert.equal("fromNumber" in migratedMessageReceipt, false);
  assert.deepEqual(decideCanaryReceiptEffectPlan({
    existingReceipt: migratedMessageReceipt,
    record,
    currentMode: "bot",
    currentPlannedEffectIds: botIds,
    sha256Hex: sha,
  }), {
    kind: "legacy_replay",
    effectIds: [],
    planMode: "none",
    migrateReceipt: false,
  }, "a redacted legacy marker remains a stable no-resend replay");
  assert.throws(() => decideCanaryReceiptEffectPlan({
    existingReceipt: { ...legacyV1MessageReceipt, fromNumber: "94770000000" },
    record,
    currentMode: "bot",
    currentPlannedEffectIds: botIds,
    sha256Hex: sha,
  }), /meta_canary_receipt_collision/, "a substituted legacy sender still fails closed");

  const statusRecord = extractCanaryInboundRecords({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: {
      metadata: { phone_number_id: "987654321098765" },
      statuses: [{ id: "wamid.legacy-status", status: "read", timestamp: "1754650001" }],
    } }] }],
  }, sha)[0]!;
  const statusEffects = buildInitialCanaryOutboxEffects({
    records: [statusRecord],
    allowlistedMessages: [],
    optOuts: [],
    mode: "bot",
    nowMs: 1_000,
    sha256Hex: sha,
  });
  assert.deepEqual(decideCanaryReceiptEffectPlan({
    existingReceipt: {
      id: statusRecord.id,
      workspaceId: statusRecord.workspaceId,
      kind: statusRecord.kind,
      waMessageId: statusRecord.waMessageId,
      fromNumber: null,
      toPhoneNumberId: statusRecord.toPhoneNumberId,
      messageType: statusRecord.messageType,
      statusValue: statusRecord.statusValue,
      bodySha256: statusRecord.bodySha256,
      providerTimestamp: statusRecord.providerTimestamp,
      canary: true,
      containsMessageContent: false,
      schemaVersion: 1,
    },
    record: statusRecord,
    currentMode: "bot",
    currentPlannedEffectIds: statusEffects.map((effect) => effect.id),
    sha256Hex: sha,
  }), {
    kind: "legacy_replay",
    effectIds: [],
    planMode: "none",
    migrateReceipt: true,
  }, "an exact schema-v1 status receipt is acknowledged without replay effects");
  assert.throws(() => decideCanaryReceiptEffectPlan({
    existingReceipt: {
      ...autoReceipt,
      outboxPlanVersion: undefined,
      outboxEffectIds: botIds,
      outboxPlanMode: undefined,
    },
    record,
    currentMode: "bot",
    currentPlannedEffectIds: botIds,
  }), /meta_canary_receipt_collision/, "a partially migrated receipt still fails closed");
});

test("public minimization accepts only the signed pre-minimization message identity for replay", () => {
  const sender = "94771112233";
  const payload = {
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: {
      metadata: { phone_number_id: "987654321098765" },
      messages: [{
        id: "wamid.public-strict-replay",
        from: sender,
        type: "text",
        timestamp: "1754650100",
        text: { body: "What services are available?" },
      }],
    } }] }],
  };
  const strictReplayRecord = extractCanaryInboundRecords(payload, sha)[0]!;
  const minimizedRecord = {
    ...strictReplayRecord,
    fromNumberSha256: sha(`public-identity:${sender}`),
    fromNumberLast4: null,
    bodySha256: null,
  };
  const messages = extractAllowlistedCanaryBotMessages(
    payload,
    parseRecipientAllowlist(sender),
  );
  const effects = buildInitialCanaryOutboxEffects({
    records: [strictReplayRecord],
    allowlistedMessages: messages,
    optOuts: [],
    mode: "bot",
    nowMs: 1_000,
    sha256Hex: sha,
  });
  const effectIds = effects.map((effect) => effect.id);
  const plannedReceipt = {
    ...strictReplayRecord,
    outboxEffectIds: effectIds,
    outboxPlanMode: "bot",
    outboxPlanVersion: 1,
  };
  assert.deepEqual(decideCanaryReceiptEffectPlan({
    existingReceipt: plannedReceipt,
    record: minimizedRecord,
    strictReplayRecord,
    currentMode: "bot",
    currentPlannedEffectIds: effectIds,
    sha256Hex: sha,
  }), {
    kind: "replay",
    effectIds,
    planMode: "bot",
  }, "a schema-v2 planned receipt remains replayable after public minimization");

  const legacyReceipt = {
    id: strictReplayRecord.id,
    workspaceId: strictReplayRecord.workspaceId,
    kind: strictReplayRecord.kind,
    waMessageId: strictReplayRecord.waMessageId,
    fromNumber: sender,
    toPhoneNumberId: strictReplayRecord.toPhoneNumberId,
    messageType: strictReplayRecord.messageType,
    statusValue: strictReplayRecord.statusValue,
    bodySha256: strictReplayRecord.bodySha256,
    providerTimestamp: strictReplayRecord.providerTimestamp,
    canary: true,
    containsMessageContent: false,
    schemaVersion: 1,
  };
  assert.deepEqual(decideCanaryReceiptEffectPlan({
    existingReceipt: legacyReceipt,
    record: minimizedRecord,
    strictReplayRecord,
    currentMode: "bot",
    currentPlannedEffectIds: effectIds,
    sha256Hex: sha,
  }), {
    kind: "legacy_replay",
    effectIds: [],
    planMode: "none",
    migrateReceipt: true,
  }, "a schema-v1 receipt is migrated only after matching the signed sender and body identity");

  const mismatchedStrictRecord = {
    ...strictReplayRecord,
    fromNumberSha256: sha("canary-sender:94779990000"),
    fromNumberLast4: "0000",
  };
  assert.throws(() => decideCanaryReceiptEffectPlan({
    existingReceipt: legacyReceipt,
    record: minimizedRecord,
    strictReplayRecord: mismatchedStrictRecord,
    currentMode: "bot",
    currentPlannedEffectIds: effectIds,
    sha256Hex: sha,
  }), /meta_canary_receipt_collision/, "an alternate sender identity cannot authorize a legacy replay");
  assert.throws(() => decideCanaryReceiptEffectPlan({
    existingReceipt: plannedReceipt,
    record: minimizedRecord,
    strictReplayRecord: {
      ...strictReplayRecord,
      bodySha256: sha("substituted body"),
    },
    currentMode: "bot",
    currentPlannedEffectIds: effectIds,
    sha256Hex: sha,
  }), /meta_canary_receipt_collision/, "an alternate body identity cannot authorize a planned replay");
  assert.throws(() => decideCanaryReceiptEffectPlan({
    existingReceipt: plannedReceipt,
    record: {
      ...minimizedRecord,
      providerTimestamp: "1754650101",
    },
    strictReplayRecord,
    currentMode: "bot",
    currentPlannedEffectIds: effectIds,
    sha256Hex: sha,
  }), /meta_canary_receipt_collision/, "message timestamps remain part of the strict replay identity");
});

test("status replays tolerate a canonical duplicate timestamp but not changed target identity", () => {
  const originalStatus = extractCanaryInboundRecords({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: {
      metadata: { phone_number_id: "987654321098765" },
      statuses: [{
        id: "wamid.status-later-timestamp",
        status: "delivered",
        timestamp: "1754650200",
      }],
    } }] }],
  }, sha)[0]!;
  const laterStatus = {
    ...originalStatus,
    providerTimestamp: "1754650260",
  };
  const statusEffects = buildInitialCanaryOutboxEffects({
    records: [laterStatus],
    allowlistedMessages: [],
    optOuts: [],
    mode: "none",
    nowMs: 1_000,
    sha256Hex: sha,
  });
  const effectIds = statusEffects.map((effect) => effect.id);
  const plannedReceipt = {
    ...originalStatus,
    outboxEffectIds: effectIds,
    outboxPlanMode: "none",
    outboxPlanVersion: 1,
  };
  assert.deepEqual(decideCanaryReceiptEffectPlan({
    existingReceipt: plannedReceipt,
    record: laterStatus,
    currentMode: "none",
    currentPlannedEffectIds: effectIds,
    sha256Hex: sha,
  }), {
    kind: "replay",
    effectIds,
    planMode: "none",
  }, "an otherwise-identical schema-v2 status replay may carry a later provider timestamp");

  const legacyReceipt = {
    id: originalStatus.id,
    workspaceId: originalStatus.workspaceId,
    kind: originalStatus.kind,
    waMessageId: originalStatus.waMessageId,
    fromNumber: null,
    toPhoneNumberId: originalStatus.toPhoneNumberId,
    messageType: originalStatus.messageType,
    statusValue: originalStatus.statusValue,
    bodySha256: originalStatus.bodySha256,
    providerTimestamp: originalStatus.providerTimestamp,
    canary: true,
    containsMessageContent: false,
    schemaVersion: 1,
  };
  assert.deepEqual(decideCanaryReceiptEffectPlan({
    existingReceipt: legacyReceipt,
    record: laterStatus,
    currentMode: "none",
    currentPlannedEffectIds: effectIds,
    sha256Hex: sha,
  }), {
    kind: "legacy_replay",
    effectIds: [],
    planMode: "none",
    migrateReceipt: true,
  }, "an otherwise-identical schema-v1 status replay also accepts the later timestamp");

  assert.deepEqual(decideCanaryReceiptEffectPlan({
    existingReceipt: plannedReceipt,
    record: { ...laterStatus, providerTimestamp: "1754650140" },
    currentMode: "none",
    currentPlannedEffectIds: effectIds,
    sha256Hex: sha,
  }), {
    kind: "replay",
    effectIds,
    planMode: "none",
  }, "out-of-order duplicate status callbacks remain idempotent");

  for (const providerTimestamp of ["0", "123.4", "1e10", "123456789012"]) {
    assert.throws(() => decideCanaryReceiptEffectPlan({
      existingReceipt: plannedReceipt,
      record: { ...laterStatus, providerTimestamp },
      currentMode: "none",
      currentPlannedEffectIds: effectIds,
      sha256Hex: sha,
    }), /meta_canary_receipt_collision/, "noncanonical status time remains collision-bound");
  }

  for (const [label, substitutedStatus] of [
    ["status value", { ...laterStatus, statusValue: "read" }],
    ["phone asset", { ...laterStatus, toPhoneNumberId: "111111111111111" }],
    ["provider message id", { ...laterStatus, waMessageId: "wamid.other-status" }],
  ] as const) {
    assert.throws(() => decideCanaryReceiptEffectPlan({
      existingReceipt: plannedReceipt,
      record: substitutedStatus,
      currentMode: "none",
      currentPlannedEffectIds: effectIds,
      sha256Hex: sha,
    }), /meta_canary_receipt_collision/, `${label} remains collision-bound`);
  }
});

test("transient AI replies are content-free at rest and recover to the durable fallback", () => {
  const transientReply = {
    type: "text",
    text: { preview_url: false, body: "Transient answer that must not be stored." },
  };
  const durableFallback = {
    type: "text",
    text: { preview_url: false, body: "Actual interactive menu." },
  };
  const plans = planCanaryBotReplies([
    { type: "text", text: { body: "Please choose below." } },
    durableFallback,
  ], transientReply);
  assert.equal(plans.length, 1);
  assert.equal(plans[0]?.replyIndex, 1);
  assert.deepEqual(plans[0]?.durableFallbackReply, durableFallback);
  const evidence = buildCanaryTransientAiReplyEvidence(
    plans[0]!.reply,
    plans[0]!.durableFallbackReply,
    sha,
  );
  const serializedEvidence = JSON.stringify(evidence);
  assert.equal(serializedEvidence.includes("Transient answer"), false);
  assert.equal(serializedEvidence.includes("Please choose"), false);
  assert.deepEqual(selectCanaryBotReply({
    payload: evidence,
    durableReply: durableFallback,
    transientReply,
    sha256Hex: sha,
  }), transientReply, "the same webhook request can use its in-memory AI answer");
  assert.deepEqual(selectCanaryBotReply({
    payload: evidence,
    durableReply: durableFallback,
    sha256Hex: sha,
  }), durableFallback, "a later retry sends the deterministic fallback without recreating content");
  assert.throws(() => selectCanaryBotReply({
    payload: evidence,
    durableReply: { ...durableFallback, type: "interactive" },
    transientReply,
    sha256Hex: sha,
  }), /bot_fallback_plan_mismatch/, "fallback integrity is checked before dispatching AI");

  const aiEffect = buildCanaryOutboxRecord({
    id: canaryOutboxEffectId("receipt.ai-source", "graph_bot_reply", "primary", sha),
    receiptId: "receipt.ai-source",
    effectKind: "graph_bot_reply",
    payload: evidence,
    nowMs: 1_000,
  });
  const aiClaim = claimCanaryOutboxRecord({
    record: aiEffect,
    nowMs: 1_100,
    leaseToken: "ai-source-lease",
    leaseOwner: "http_webhook",
  });
  assert.equal(aiClaim.action, "claimed");
  if (aiClaim.action !== "claimed") return;
  const aiDispatch = markCanaryOutboxDispatchStarted(
    aiClaim.record,
    "ai-source-lease",
    1_200,
    "ai_transient",
  );
  assert.equal(aiDispatch.dispatchReplySource, "ai_transient");
  assert.deepEqual(parseCanaryOutboxRecord(aiDispatch), aiDispatch);

  const autoEffect = buildCanaryOutboxRecord({
    id: canaryOutboxEffectId("receipt.auto-source", "graph_auto_reply", "primary", sha),
    receiptId: "receipt.auto-source",
    effectKind: "graph_auto_reply",
    payload: {},
    nowMs: 1_000,
  });
  const autoClaim = claimCanaryOutboxRecord({
    record: autoEffect,
    nowMs: 1_100,
    leaseToken: "auto-source-lease",
    leaseOwner: "http_webhook",
  });
  assert.equal(autoClaim.action, "claimed");
  if (autoClaim.action === "claimed") {
    assert.throws(() => markCanaryOutboxDispatchStarted(
      autoClaim.record,
      "auto-source-lease",
      1_200,
      "ai_transient",
    ), /invalid_dispatch_reply_source/);
  }
});

test("transient AI preparation requires a fresh bot plan and exact bot mode", () => {
  assert.equal(shouldPrepareCanaryTransientAi({
    mode: "bot",
    aiEnabled: true,
    hasFreshBotPlan: true,
  }), true);
  for (const input of [
    { mode: "auto_reply" as const, aiEnabled: true, hasFreshBotPlan: true },
    { mode: "none" as const, aiEnabled: true, hasFreshBotPlan: true },
    { mode: "bot" as const, aiEnabled: false, hasFreshBotPlan: true },
    { mode: "bot" as const, aiEnabled: true, hasFreshBotPlan: false },
  ]) {
    assert.equal(shouldPrepareCanaryTransientAi(input), false);
  }
  assert.equal(decideCanaryTransientAiSequence({
    recipientBlocked: false,
    staffHandoff: true,
    aiQuery: null,
  }), "block_recipient");
  assert.equal(decideCanaryTransientAiSequence({
    recipientBlocked: true,
    staffHandoff: false,
    aiQuery: "later free text",
  }), "skip", "later text in the same handoff envelope never becomes an AI candidate");
  assert.equal(decideCanaryTransientAiSequence({
    recipientBlocked: false,
    staffHandoff: false,
    aiQuery: "eligible free text",
  }), "candidate");
});

test("inline batches prioritize generated reply effects even when the initial queue is full", () => {
  const queue = Array.from({ length: 8 }, (_, index) => `fx_initial_${index}`);
  const seen = new Set(queue);
  insertCanaryOutboxChildEffects(queue, seen, 1, ["fx_ai_reply", "fx_ai_reply"]);
  assert.equal(queue.length, 9);
  assert.equal(queue[2], "fx_ai_reply");
  assert.equal(seen.size, 9);
});

test("STOP committed between bot planning and child dispatch suppresses without Graph evidence", () => {
  const contactId = "contact_live_1234567890";
  const contact = (suppressMarketing: boolean, suppressAll = false) => ({
    id: contactId,
    workspaceId: "workspace_safenet_demo",
    synthetic: true,
    liveCanary: true,
    tags: suppressMarketing ? ["marketing-suppressed"] : [],
    suppression: {
      suppressAll,
      suppressMarketing,
      invalidContact: false,
      reasons: suppressMarketing ? ["stop_keyword"] : [],
    },
  });

  assert.deepEqual(decideCanaryGraphSuppression({
    effectKind: "graph_bot_reply",
    expectedContactId: contactId,
    contact: contact(false),
  }), { kind: "allow" });
  assert.deepEqual(decideCanaryGraphSuppression({
    effectKind: "graph_bot_reply",
    expectedContactId: contactId,
    contact: contact(true),
  }), { kind: "suppress", reason: "stop_suppression" });
  assert.deepEqual(decideCanaryGraphSuppression({
    effectKind: "graph_auto_reply",
    expectedContactId: contactId,
    contact: contact(true),
  }), { kind: "suppress", reason: "stop_suppression" });

  assert.equal(canaryTemplatePurpose("hello_world"), "non_marketing_canary");
  assert.equal(canaryTemplatePurpose("health_campaign"), "marketing");
  assert.deepEqual(decideCanaryGraphSuppression({
    effectKind: "graph_template_send",
    expectedContactId: contactId,
    contact: contact(true),
    templatePurpose: "non_marketing_canary",
  }), { kind: "allow" }, "marketing-only STOP does not redefine the connectivity canary");
  assert.deepEqual(decideCanaryGraphSuppression({
    effectKind: "graph_template_send",
    expectedContactId: contactId,
    contact: contact(true),
    templatePurpose: "marketing",
  }), { kind: "suppress", reason: "marketing_suppression" });
  assert.deepEqual(decideCanaryGraphSuppression({
    effectKind: "graph_template_send",
    expectedContactId: contactId,
    contact: null,
    templatePurpose: "marketing",
  }), { kind: "suppress", reason: "marketing_eligibility_missing" });
  assert.deepEqual(decideCanaryGraphSuppression({
    effectKind: "graph_template_send",
    expectedContactId: contactId,
    contact: contact(false, true),
    templatePurpose: "non_marketing_canary",
  }), { kind: "suppress", reason: "suppress_all" });

  const pending = buildCanaryOutboxRecord({
    id: canaryOutboxEffectId("wamid.stop-race", "graph_bot_reply", "reply-0", sha),
    receiptId: "wamid.stop-race",
    effectKind: "graph_bot_reply",
    payload: {
      recipientSha256: sha("canary-sender:94771234567"),
      recipientLast4: "4567",
    },
    nowMs: 1_000,
  });
  const claim = claimCanaryOutboxRecord({
    record: pending,
    nowMs: 1_100,
    leaseToken: "stop-race-lease",
    leaseOwner: "http_webhook",
  });
  assert.equal(claim.action, "claimed");
  if (claim.action !== "claimed") return;
  const suppressed = completeCanaryOutboxRecord({
    record: claim.record,
    leaseToken: "stop-race-lease",
    nowMs: 1_200,
    terminalReason: "suppressed",
  });
  assert.equal(suppressed.state, "terminal");
  assert.equal(suppressed.terminalReason, "suppressed");
  assert.equal(suppressed.dispatchStartedAtMs, null);
  assert.equal(suppressed.resultProviderMessageId, null);
  assert.equal("dueAtMs" in suppressed, false);
  assert.equal(claimCanaryOutboxRecord({
    record: suppressed,
    nowMs: 9_000,
    leaseToken: "stop-race-replay",
    leaseOwner: "admin_reconciler",
  }).action, "noop", "suppression evidence is idempotently terminal");
});

test("an existing human handoff suppresses bot planning and queued automation", () => {
  const conversationId = "conversation_live_1234567890";
  const conversation = (overrides: Record<string, unknown> = {}) => ({
    id: conversationId,
    workspaceId: "workspace_safenet_demo",
    mode: "automation",
    status: "active",
    assigneeId: null,
    synthetic: true,
    liveCanary: true,
    ...overrides,
  });
  assert.deepEqual(decideCanaryAutomationConversationSuppression({
    effectKind: "bot_plan",
    expectedConversationId: conversationId,
    conversation: conversation(),
  }), { kind: "allow" });

  const claimed = conversation({
    mode: "human_takeover",
    status: "assigned",
    assigneeId: "agent_synthetic_1",
  });
  for (const effectKind of ["bot_plan", "graph_auto_reply"] as const) {
    assert.deepEqual(decideCanaryAutomationConversationSuppression({
      effectKind,
      expectedConversationId: conversationId,
      conversation: claimed,
    }), { kind: "suppress", reason: "human_handoff" });
  }
  assert.deepEqual(decideCanaryAutomationConversationSuppression({
    effectKind: "graph_bot_reply",
    expectedConversationId: conversationId,
    conversation: conversation({
      mode: "human_takeover",
      status: "assigned",
      assigneeId: null,
    }),
    currentHandoffReply: true,
  }), { kind: "allow" }, "only the transition acknowledgement may finish");
  assert.deepEqual(decideCanaryAutomationConversationSuppression({
    effectKind: "graph_bot_reply",
    expectedConversationId: conversationId,
    conversation: claimed,
    currentHandoffReply: true,
  }), { kind: "suppress", reason: "human_handoff" }, "a concurrent agent claim wins");
  assert.deepEqual(decideCanaryAutomationConversationSuppression({
    effectKind: "bot_plan",
    expectedConversationId: conversationId,
    conversation: { ...claimed, id: "conversation_live_substituted" },
  }), { kind: "suppress", reason: "invalid_conversation_state" });
});

test("Graph success without a provider message id is rejected before terminal evidence", () => {
  assert.equal(assertCanaryProviderMessageId("wamid.provider-result"), "wamid.provider-result");
  for (const invalid of [null, undefined, "", "   ", 200]) {
    assert.throws(
      () => assertCanaryProviderMessageId(invalid),
      /missing_provider_message_id/,
    );
  }
});

test("fatal post-dispatch Graph ambiguity resolves once from exact provider evidence", () => {
  const makeFatal = (receiptId: string) => {
    const pending = buildCanaryOutboxRecord({
      id: canaryOutboxEffectId(receiptId, "graph_auto_reply", "provider", sha),
      receiptId,
      effectKind: "graph_auto_reply",
      payload: {
        recipientSha256: sha("canary-sender:94771234567"),
        recipientLast4: "4567",
      },
      nowMs: 1_000,
    });
    const claim = claimCanaryOutboxRecord({
      record: pending,
      nowMs: 1_100,
      leaseToken: `lease-${receiptId}`,
      leaseOwner: "admin_reconciler",
    });
    assert.equal(claim.action, "claimed");
    if (claim.action !== "claimed") throw new Error("expected claim");
    return failCanaryOutboxRecord({
      record: markCanaryOutboxDispatchStarted(
        claim.record,
        `lease-${receiptId}`,
        1_200,
      ),
      leaseToken: `lease-${receiptId}`,
      nowMs: 1_300,
      errorCode: "missing_provider_message_id",
      safeToRetry: true,
    });
  };

  const fatal = makeFatal("wamid.fatal-resolution-sent");
  assert.equal(fatal.state, "fatal");
  assert.notEqual(fatal.dispatchStartedAtMs, null);
  const sentCore = {
    effectId: fatal.id,
    effectKind: "graph_auto_reply" as const,
    outcome: "confirmed_sent" as const,
    providerMessageId: "wamid.provider-confirmed-sent",
    providerEvidenceSha256: sha("provider-console-evidence-sent"),
  };
  const sent = assertCanaryFatalResolutionInput({
    ...sentCore,
    requestSha256: canaryFatalResolutionRequestSha256(sentCore, sha),
  }, sha);
  const sentAudit = buildCanaryFatalResolutionAudit({
    resolution: sent,
    actorUid: "synthetic-tenant-admin",
    sha256Hex: sha,
  });
  assert.equal(sentAudit.providerMessageIdSha256, sha(sentCore.providerMessageId));
  assert.equal(JSON.stringify(sentAudit).includes(sentCore.providerMessageId), false);
  assert.deepEqual(decideCanaryFatalResolution({
    rawEffect: fatal,
    rawAudit: undefined,
    resolution: sent,
    expectedAudit: sentAudit,
  }), { kind: "apply", effect: fatal });

  const reconciledSent = reconcileCanaryFatalOutboxRecord({
    effect: fatal,
    resolution: sent,
    audit: sentAudit,
    nowMs: 2_000,
  });
  assert.equal(reconciledSent.state, "terminal");
  assert.equal(reconciledSent.terminalReason, "reconciled_sent");
  assert.equal(reconciledSent.resultProviderMessageId, sentCore.providerMessageId);
  assert.deepEqual(parseCanaryOutboxRecord(reconciledSent), reconciledSent);
  assert.deepEqual(decideCanaryFatalResolution({
    rawEffect: reconciledSent,
    rawAudit: sentAudit,
    resolution: sent,
    expectedAudit: sentAudit,
  }), { kind: "replay", effect: reconciledSent }, "identical evidence is idempotent");

  const changedCore = {
    ...sentCore,
    providerEvidenceSha256: sha("changed-provider-evidence"),
  };
  const changed = assertCanaryFatalResolutionInput({
    ...changedCore,
    requestSha256: canaryFatalResolutionRequestSha256(changedCore, sha),
  }, sha);
  const changedAudit = buildCanaryFatalResolutionAudit({
    resolution: changed,
    actorUid: "synthetic-tenant-admin",
    sha256Hex: sha,
  });
  assert.throws(() => decideCanaryFatalResolution({
    rawEffect: reconciledSent,
    rawAudit: sentAudit,
    resolution: changed,
    expectedAudit: changedAudit,
  }), /meta_canary_fatal_resolution_conflict/);

  const notSentFatal = makeFatal("wamid.fatal-resolution-not-sent");
  const notSentCore = {
    effectId: notSentFatal.id,
    effectKind: "graph_auto_reply" as const,
    outcome: "confirmed_not_sent" as const,
    providerMessageId: null,
    providerEvidenceSha256: sha("provider-console-evidence-not-sent"),
  };
  const notSent = assertCanaryFatalResolutionInput({
    ...notSentCore,
    requestSha256: canaryFatalResolutionRequestSha256(notSentCore, sha),
  }, sha);
  const notSentAudit = buildCanaryFatalResolutionAudit({
    resolution: notSent,
    actorUid: "synthetic-tenant-admin",
    sha256Hex: sha,
  });
  const reconciledNotSent = reconcileCanaryFatalOutboxRecord({
    effect: notSentFatal,
    resolution: notSent,
    audit: notSentAudit,
    nowMs: 2_100,
  });
  assert.equal(reconciledNotSent.terminalReason, "reconciled_not_sent");
  assert.equal(reconciledNotSent.resultProviderMessageId, null);
  assert.deepEqual(parseCanaryOutboxRecord(reconciledNotSent), reconciledNotSent);

  assert.throws(() => assertCanaryFatalResolutionInput({
    ...sent,
    unexpected: true,
  }, sha), /invalid_meta_canary_fatal_resolution_input/);
  assert.throws(() => assertCanaryFatalResolutionInput({
    ...sent,
    requestSha256: sha("substituted-request"),
  }, sha), /request_hash_mismatch/);
  assert.throws(() => assertCanaryFatalResolutionInput({
    ...sent,
    providerMessageId: null,
  }, sha), /missing_provider_message_id/);
  assert.throws(() => assertCanaryFatalResolutionInput({
    ...notSent,
    providerMessageId: "wamid.must-be-null",
  }, sha), /confirmed_not_sent_requires_null_provider_id/);
  assert.doesNotMatch(
    reconcileFatalCanaryGraphEffect.toString(),
    /sendGraphMessage|accessToken|phoneNumberId/,
    "the evidence resolver has no Graph authority or send dependency",
  );
  assert.match(
    reconcileFatalCanaryGraphEffect.toString(),
    /preserveCanaryOutboundConversationState/,
    "fatal sent bot evidence uses the handoff/window preservation gate",
  );
});

test("outbound bot evidence preserves a newer handoff and the inbound service window", () => {
  const conversationId = "conversation_live_1234567890";
  const inboundExpiry = { toMillis: () => 50_000 };
  const newerUnassignedHandoff = {
    id: conversationId,
    workspaceId: "workspace_safenet_demo",
    mode: "human_takeover",
    status: "assigned",
    assigneeId: null,
    serviceWindowExpiresAt: inboundExpiry,
    synthetic: true,
    liveCanary: true,
  };
  const rebuilt = preserveCanaryOutboundConversationState({
    expectedConversationId: conversationId,
    existingConversation: newerUnassignedHandoff,
    builtConversation: {
      ...newerUnassignedHandoff,
      mode: "automation",
      status: "active",
      serviceWindowExpiresAt: { toMillis: () => 9_999_999 },
    },
  });
  assert.equal(rebuilt.mode, "human_takeover");
  assert.equal(rebuilt.status, "assigned");
  assert.equal(rebuilt.assigneeId, null);
  assert.equal(rebuilt.serviceWindowExpiresAt, inboundExpiry);
  assert.equal(
    (rebuilt.serviceWindowExpiresAt as { toMillis: () => number }).toMillis(),
    50_000,
    "outbound evidence never extends the inbound-derived free-form window",
  );

  assert.throws(() => preserveCanaryOutboundConversationState({
    expectedConversationId: conversationId,
    existingConversation: { ...newerUnassignedHandoff, workspaceId: "workspace_other" },
    builtConversation: rebuilt,
  }), /invalid_outbound_conversation_state/);
  assert.throws(() => preserveCanaryOutboundConversationState({
    expectedConversationId: conversationId,
    existingConversation: {
      ...newerUnassignedHandoff,
      mode: "automation",
      status: "assigned",
    },
    builtConversation: rebuilt,
  }), /invalid_outbound_conversation_state/, "malformed domain evidence is not repaired");
});

test("pre-dispatch exhausted Graph work closes as durable not-sent evidence", () => {
  const pending = {
    ...buildCanaryOutboxRecord({
      id: canaryOutboxEffectId(
        "manual-predispatch-exhausted",
        "graph_template_send",
        "provider",
        sha,
      ),
      receiptId: "manual-predispatch-exhausted",
      effectKind: "graph_template_send" as const,
      payload: { outboundId: `manual_${"a".repeat(32)}` },
      nowMs: 1_000,
    }),
    attempts: META_CANARY_OUTBOX_MAX_ATTEMPTS,
  };
  const exhausted = claimCanaryOutboxRecord({
    record: pending,
    nowMs: 2_000,
    leaseToken: "must-not-dispatch",
    leaseOwner: "admin_reconciler",
  });
  assert.equal(exhausted.action, "fatalized");
  if (exhausted.action !== "fatalized") return;
  const notSent = terminalizeCanaryGraphEffectWithoutDispatch({
    record: exhausted.record,
    nowMs: 2_100,
  });
  assert.equal(notSent.state, "terminal");
  assert.equal(notSent.terminalReason, "not_sent");
  assert.equal(notSent.dispatchStartedAtMs, null);
  assert.equal(notSent.resultProviderMessageId, null);
  assert.equal("dueAtMs" in notSent, false);
  assert.deepEqual(parseCanaryOutboxRecord(notSent), notSent);
  assert.throws(() => terminalizeCanaryGraphEffectWithoutDispatch({
    record: { ...exhausted.record, dispatchStartedAtMs: 2_050 },
    nowMs: 2_100,
  }), /crossed_dispatch_boundary/);
});

test("all outbound classes route delivery evidence without provider identifiers", () => {
  const providerMessageId = "wamid.manual-delivery-result";
  const targets = [
    { targetKind: "manual_template" as const, targetId: `manual_${"a".repeat(32)}` },
    { targetKind: "meta_outbox_effect" as const, targetId: `fx_${"b".repeat(40)}` },
    { targetKind: "lite_agent_reply" as const, targetId: `reply_${"c".repeat(16)}` },
    {
      targetKind: "lite_booking_notification" as const,
      targetId: `booking_op_${"d".repeat(24)}`,
    },
  ];
  for (const target of targets) {
    const route = buildCanaryProviderRouteEvidence({
      providerMessageId,
      ...target,
      sha256Hex: sha,
    });
    assert.equal(route.id, canaryProviderRouteId(providerMessageId, sha));
    assert.equal(route.providerMessageIdSha256, sha(providerMessageId));
    assert.equal(route.containsMessageContent, false);
    assert.equal(route.containsFullRecipient, false);
    assert.equal(JSON.stringify(route).includes(providerMessageId), false);
    assert.deepEqual(resolveCanaryProviderRoute({
      route,
      providerMessageId,
      sha256Hex: sha,
    }), target);
    assert.equal(resolveCanaryProviderRoute({
      route,
      providerMessageId: "wamid.substituted",
      sha256Hex: sha,
    }), null);
  }
  assert.deepEqual(decideCanaryStatusTarget({
    campaignSendExists: false,
    providerRouteExists: false,
  }), { kind: "retry_missing_target" }, "a fast status waits for send evidence");
  assert.deepEqual(decideCanaryStatusTarget({
    campaignSendExists: false,
    providerRouteExists: true,
  }), { kind: "provider_route" });
  assert.deepEqual(decideCanaryStatusTarget({
    campaignSendExists: true,
    providerRouteExists: false,
  }), { kind: "campaign" });

  const finalAttempt = claimCanaryOutboxRecord({
    record: {
      ...buildCanaryOutboxRecord({
        id: canaryOutboxEffectId("wamid.unknown-status", "campaign_status", "read", sha),
        receiptId: "wamid.unknown-status",
        effectKind: "campaign_status",
        payload: { providerMessageRef: "wamid.unknown", status: "read" },
        nowMs: 1_000,
      }),
      attempts: META_CANARY_OUTBOX_MAX_ATTEMPTS - 1,
    },
    nowMs: 2_000,
    leaseToken: "unknown-status-final",
    leaseOwner: "admin_reconciler",
  });
  assert.equal(finalAttempt.action, "claimed");
  if (finalAttempt.action !== "claimed") return;
  const unsupported = completeCanaryOutboxRecord({
    record: finalAttempt.record,
    leaseToken: "unknown-status-final",
    nowMs: 2_100,
    terminalReason: "unsupported_status_target",
  });
  assert.equal(unsupported.state, "terminal");
  assert.equal(unsupported.terminalReason, "unsupported_status_target");
});

test("crash after durable receipt leaves pending effects recoverable without the signed body", () => {
  const id = canaryOutboxEffectId("wamid.crash", "inbound_metric", "message", sha);
  const pending = buildCanaryOutboxRecord({
    id,
    receiptId: "wamid.crash",
    effectKind: "inbound_metric",
    payload: { occurredAtMs: 1_000 },
    nowMs: 1_000,
  });
  assert.equal(pending.state, "pending");
  const recovered = claimCanaryOutboxRecord({
    record: pending,
    nowMs: 2_000,
    leaseToken: "lease-after-crash",
    leaseOwner: "admin_reconciler",
  });
  assert.equal(recovered.action, "claimed");
  if (recovered.action !== "claimed") return;
  const completed = completeCanaryOutboxRecord({
    record: recovered.record,
    leaseToken: "lease-after-crash",
    nowMs: 2_100,
  });
  assert.equal(completed.state, "terminal");
});

test("partial effect completion is isolated and replay never reclaims terminal work", () => {
  const first = buildCanaryOutboxRecord({
    id: canaryOutboxEffectId("receipt.partial", "inbound_metric", "one", sha),
    receiptId: "receipt.partial",
    effectKind: "inbound_metric",
    payload: { occurredAtMs: 1_000 },
    nowMs: 1_000,
  });
  const second = buildCanaryOutboxRecord({
    id: canaryOutboxEffectId("receipt.partial", "bot_plan", "two", sha),
    receiptId: "receipt.partial",
    effectKind: "bot_plan",
    payload: {},
    nowMs: 1_000,
  });
  const firstClaim = claimCanaryOutboxRecord({
    record: first,
    nowMs: 1_000,
    leaseToken: "lease-first",
    leaseOwner: "http_webhook",
  });
  assert.equal(firstClaim.action, "claimed");
  if (firstClaim.action !== "claimed") return;
  const terminalFirst = completeCanaryOutboxRecord({
    record: firstClaim.record,
    leaseToken: "lease-first",
    nowMs: 1_100,
  });
  assert.equal(
    claimCanaryOutboxRecord({
      record: terminalFirst,
      nowMs: 2_000,
      leaseToken: "lease-replay",
      leaseOwner: "admin_reconciler",
    }).action,
    "noop",
  );
  assert.equal(
    claimCanaryOutboxRecord({
      record: second,
      nowMs: 2_000,
      leaseToken: "lease-second",
      leaseOwner: "admin_reconciler",
    }).action,
    "claimed",
  );
});

test("concurrent webhook claims and completed replay cannot duplicate a provider send", () => {
  const pending = buildCanaryOutboxRecord({
    id: canaryOutboxEffectId("wamid.concurrent", "graph_auto_reply", "primary", sha),
    receiptId: "wamid.concurrent",
    effectKind: "graph_auto_reply",
    payload: {
      recipientSha256: sha("canary-sender:94771234567"),
      recipientLast4: "4567",
    },
    nowMs: 1_000,
  });
  const winner = claimCanaryOutboxRecord({
    record: pending,
    nowMs: 1_000,
    leaseToken: "winner",
    leaseOwner: "http_webhook",
  });
  assert.equal(winner.action, "claimed");
  if (winner.action !== "claimed") return;
  const concurrent = claimCanaryOutboxRecord({
    record: winner.record,
    nowMs: 1_001,
    leaseToken: "loser",
    leaseOwner: "http_webhook",
  });
  assert.equal(concurrent.action, "noop");

  const dispatching = markCanaryOutboxDispatchStarted(winner.record, "winner", 1_010);
  const completed = completeCanaryOutboxRecord({
    record: dispatching,
    leaseToken: "winner",
    nowMs: 1_020,
    providerMessageId: "wamid.provider-result",
  });
  const replay = claimCanaryOutboxRecord({
    record: completed,
    nowMs: 99_000,
    leaseToken: "replay",
    leaseOwner: "admin_reconciler",
  });
  assert.equal(replay.action, "noop");
  assert.equal(replay.record.resultProviderMessageId, "wamid.provider-result");
});

test("expired pre-dispatch work retries, but post-dispatch crash is fatal and never resent", () => {
  const pending = buildCanaryOutboxRecord({
    id: canaryOutboxEffectId("wamid.lease", "graph_auto_reply", "primary", sha),
    receiptId: "wamid.lease",
    effectKind: "graph_auto_reply",
    payload: {},
    nowMs: 1_000,
  });
  const first = claimCanaryOutboxRecord({
    record: pending,
    nowMs: 1_000,
    leaseToken: "first",
    leaseOwner: "http_webhook",
    leaseMs: 5_000,
  });
  assert.equal(first.action, "claimed");
  if (first.action !== "claimed") return;
  const preDispatchRecovery = claimCanaryOutboxRecord({
    record: first.record,
    nowMs: 6_001,
    leaseToken: "recovered",
    leaseOwner: "admin_reconciler",
  });
  assert.equal(preDispatchRecovery.action, "claimed");
  if (preDispatchRecovery.action !== "claimed") return;
  assert.equal(preDispatchRecovery.record.attempts, 2);

  const dispatching = markCanaryOutboxDispatchStarted(
    preDispatchRecovery.record,
    "recovered",
    6_010,
  );
  const ambiguous = claimCanaryOutboxRecord({
    record: dispatching,
    nowMs: 40_000,
    leaseToken: "must-not-send",
    leaseOwner: "admin_reconciler",
  });
  assert.equal(ambiguous.action, "fatalized");
  assert.equal(ambiguous.record.state, "fatal");
  assert.equal(ambiguous.record.lastErrorCode, "ambiguous_provider_outcome");
});

test("retryable effects use bounded backoff and terminate at the attempt limit", () => {
  let record = buildCanaryOutboxRecord({
    id: canaryOutboxEffectId("receipt.retry", "inbound_metric", "metric", sha),
    receiptId: "receipt.retry",
    effectKind: "inbound_metric",
    payload: { occurredAtMs: 1_000 },
    nowMs: 1_000,
  });
  let nowMs = 1_000;
  for (let attempt = 1; attempt <= META_CANARY_OUTBOX_MAX_ATTEMPTS; attempt += 1) {
    const leaseToken = `retry-${attempt}`;
    const claimed = claimCanaryOutboxRecord({
      record,
      nowMs,
      leaseToken,
      leaseOwner: "admin_reconciler",
    });
    assert.equal(claimed.action, "claimed");
    if (claimed.action !== "claimed") return;
    const failed = failCanaryOutboxRecord({
      record: claimed.record,
      leaseToken,
      nowMs: nowMs + 10,
      errorCode: "temporary firestore failure",
      safeToRetry: true,
    });
    if (attempt < META_CANARY_OUTBOX_MAX_ATTEMPTS) {
      assert.equal(failed.state, "retryable");
      assert.equal(
        claimCanaryOutboxRecord({
          record: failed,
          nowMs: failed.nextAttemptAtMs - 1,
          leaseToken: "too-early",
          leaseOwner: "admin_reconciler",
        }).action,
        "noop",
      );
      nowMs = failed.nextAttemptAtMs;
    } else {
      assert.equal(failed.state, "fatal");
      assert.equal(failed.lastErrorCode, "temporary_firestore_failure");
    }
    record = failed;
  }
});

test("due-work selection cannot be starved by future leases or terminal records", () => {
  const future = Array.from({ length: 25 }, (_, index) => buildCanaryOutboxRecord({
    id: canaryOutboxEffectId(`future-${index}`, "inbound_metric", "metric", sha),
    receiptId: `future-${index}`,
    effectKind: "inbound_metric",
    payload: { occurredAtMs: 50_000 },
    nowMs: 50_000 + index,
  }));
  const dueLater = buildCanaryOutboxRecord({
    id: canaryOutboxEffectId("due-later", "inbound_metric", "metric", sha),
    receiptId: "due-later",
    effectKind: "inbound_metric",
    payload: { occurredAtMs: 900 },
    nowMs: 900,
  });
  const dueFirst = buildCanaryOutboxRecord({
    id: canaryOutboxEffectId("due-first", "inbound_metric", "metric", sha),
    receiptId: "due-first",
    effectKind: "inbound_metric",
    payload: { occurredAtMs: 800 },
    nowMs: 800,
  });
  const claimed = claimCanaryOutboxRecord({
    record: buildCanaryOutboxRecord({
      id: canaryOutboxEffectId("done", "inbound_metric", "metric", sha),
      receiptId: "done",
      effectKind: "inbound_metric",
      payload: { occurredAtMs: 700 },
      nowMs: 700,
    }),
    nowMs: 700,
    leaseToken: "done-lease",
    leaseOwner: "admin_reconciler",
  });
  assert.equal(claimed.action, "claimed");
  if (claimed.action !== "claimed") return;
  const terminal = completeCanaryOutboxRecord({
    record: claimed.record,
    leaseToken: "done-lease",
    nowMs: 750,
  });
  assert.equal("dueAtMs" in terminal, false);
  assert.deepEqual(
    selectDueCanaryOutboxRecords(
      [...future, terminal, dueLater, dueFirst],
      1_000,
      20,
    ).map((record) => record.receiptId),
    ["due-first", "due-later"],
  );
});

test("outbox recovery resolves recipients only from the fresh server allowlist", () => {
  const allowlist = parseRecipientAllowlist("+94771234567,+14155550100");
  assert.equal(
    resolveCanaryOutboxRecipient({
      recipientSha256: sha("canary-sender:94771234567"),
      recipientLast4: "4567",
      allowlist,
      sha256Hex: sha,
    }),
    "94771234567",
  );
  assert.equal(
    resolveCanaryOutboxRecipient({
      recipientSha256: sha("canary-sender:94770000000"),
      recipientLast4: "0000",
      allowlist,
      sha256Hex: sha,
    }),
    null,
  );
  assert.equal(
    resolveCanaryOutboxRecipient({
      recipientSha256: "94771234567",
      recipientLast4: "4567",
      allowlist,
      sha256Hex: sha,
    }),
    null,
  );
});

test("reconciler requires verified auth and both exact boolean canary claims", () => {
  assert.equal(
    assertMetaCanaryReconcilerAuthorization({
      uid: "admin-uid",
      emailVerified: true,
      hemasMetaCanary: true,
      hemasMetaCanaryAdmin: true,
    }),
    "admin-uid",
  );
  for (const claims of [
    { hemasMetaCanary: false, hemasMetaCanaryAdmin: true },
    { hemasMetaCanary: true, hemasMetaCanaryAdmin: false },
    { hemasMetaCanary: true, hemasMetaCanaryAdmin: "true" },
  ]) {
    assert.throws(() => assertMetaCanaryReconcilerAuthorization({
      uid: "admin-uid",
      emailVerified: true,
      ...claims,
    }));
  }
  for (const emailVerified of [undefined, false, "true"]) {
    assert.throws(() => assertMetaCanaryReconcilerAuthorization({
      uid: "admin-uid",
      emailVerified,
      hemasMetaCanary: true,
      hemasMetaCanaryAdmin: true,
    }));
  }
});

test("Meta claims remain inert without exact active server-side membership", () => {
  const uid = "synthetic-meta-operator";
  const membership = (role: "agent" | "supervisor" | "tenant_admin") => ({
    id: uid,
    uid,
    workspaceId: "workspace_safenet_demo",
    status: "active",
    role,
    synthetic: true,
  });
  assert.equal(isActiveMetaCanaryMembership({
    membership: membership("agent"),
    uid,
    requireAdmin: false,
  }), true);
  assert.equal(isActiveMetaCanaryMembership({
    membership: membership("tenant_admin"),
    uid,
    requireAdmin: true,
  }), true);
  assert.equal(isActiveMetaCanaryMembership({
    membership: membership("supervisor"),
    uid,
    requireAdmin: true,
  }), false);
  for (const invalid of [
    undefined,
    { ...membership("agent"), status: "disabled" },
    { ...membership("agent"), id: "other" },
    { ...membership("agent"), uid: "other" },
    { ...membership("agent"), workspaceId: "workspace_other" },
    { ...membership("agent"), synthetic: false },
  ]) {
    assert.equal(isActiveMetaCanaryMembership({
      membership: invalid,
      uid,
      requireAdmin: false,
    }), false);
  }
});

test("manual template operation ids reserve once, replay results, and fail closed on ambiguity", () => {
  const operationId = "meta_send_1234567890abcdef";
  assert.equal(assertMetaCanaryOperationId(operationId), operationId);
  for (const invalid of [undefined, "short", " has_whitespace_1234567890 ", "bad/1234567890123456"]) {
    assert.throws(() => assertMetaCanaryOperationId(invalid));
  }
  const id = canaryTemplateOperationDocumentId(operationId, sha);
  assert.match(id, /^manual_[0-9a-f]{32}$/);
  const requestSha256 = canaryTemplateRequestSha256({
    operationId,
    actorUid: "synthetic-admin",
    recipient: "94771234567",
    templateName: "hello_world",
    languageCode: "en_US",
  }, sha);
  const expected = {
    id,
    operationId,
    actorUid: "synthetic-admin",
    requestSha256,
    toLast4: "4567",
  };
  assert.deepEqual(decideCanaryTemplateOperation(undefined, expected), { kind: "reserve" });
  const reserved = {
    ...expected,
    toNumberLast4: "4567",
    containsMessageContent: false,
    containsFullRecipient: false,
    status: "reserved",
  };
  assert.deepEqual(decideCanaryTemplateOperation(reserved, expected), { kind: "process" });
  const sent = {
    ...reserved,
    status: "sent",
    providerMessageId: "wamid.template-result",
  };
  assert.deepEqual(decideCanaryTemplateOperation(sent, expected), {
    kind: "replay",
    result: {
      sent: true,
      providerMessageId: "wamid.template-result",
      toLast4: "4567",
      canary: true,
      idempotent: true,
    },
  });
  const suppressed = {
    ...reserved,
    status: "suppressed",
    providerMessageId: null,
    suppressionReasonCode: "marketing_suppression",
  };
  assert.deepEqual(decideCanaryTemplateOperation(suppressed, expected), {
    kind: "suppressed",
    reasonCode: "marketing_suppression",
  });
  assert.deepEqual(
    decideCanaryTemplateOperation(suppressed, expected),
    { kind: "suppressed", reasonCode: "marketing_suppression" },
    "a replay remains a stable no-send decision",
  );
  const notSent = {
    ...reserved,
    status: "not_sent",
    providerMessageId: null,
    failureReasonCode: "provider_configuration_unavailable",
  };
  assert.deepEqual(decideCanaryTemplateOperation(notSent, expected), {
    kind: "not_sent",
    reasonCode: "provider_configuration_unavailable",
  });
  assert.deepEqual(
    decideCanaryTemplateOperation(notSent, expected),
    { kind: "not_sent", reasonCode: "provider_configuration_unavailable" },
    "pre-dispatch exhaustion is stable and never becomes ambiguous on replay",
  );
  assert.throws(() => decideCanaryTemplateOperation(
    { ...notSent, providerMessageId: "wamid.must-not-exist" },
    expected,
  ));
  assert.throws(() => decideCanaryTemplateOperation(
    { ...suppressed, providerMessageId: "wamid.must-not-exist" },
    expected,
  ));
  assert.throws(() => decideCanaryTemplateOperation(
    { ...reserved, status: "sent", providerMessageId: null },
    expected,
  ));
  assert.throws(() => decideCanaryTemplateOperation(
    { ...reserved, status: "processing" },
    expected,
  ));
  assert.throws(() => decideCanaryTemplateOperation(
    { ...reserved, status: "uncertain" },
    expected,
  ));
  assert.throws(() => decideCanaryTemplateOperation(
    { ...reserved, requestSha256: sha("different request") },
    expected,
  ));
  assert.notEqual(
    requestSha256,
    canaryTemplateRequestSha256({
      operationId,
      actorUid: "synthetic-admin",
      recipient: "94770000000",
      templateName: "hello_world",
      languageCode: "en_US",
    }, sha),
  );
});
