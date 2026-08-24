import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sha256Hex } from "../src/deterministic.js";
import {
  BRIDGE_WORKSPACE_ID,
  buildLiveContactDocument,
  buildLiveConversationDocument,
  buildLiveMessageDocument,
  liveIds,
} from "../src/meta-bot/bridge.js";
import { parseRecipientAllowlist } from "../src/meta-canary/contracts.js";
import {
  META_CANARY_PROVIDER_ROUTES_COLLECTION,
  buildCanaryProviderRouteEvidence,
  canaryProviderRouteId,
  resolveCanaryProviderRoute,
} from "../src/meta-canary/outbox.js";
import {
  LiteBookingOperationError,
  assertBookingOperationId,
  assertBookingReconciliationInput,
  assertBookingTransitionCanReserve,
  bookingOperationDocumentId,
  bookingReconciliationDocumentId,
  bookingRequestSha256,
  decideBookingOperation,
  decideBookingReconciliation,
  evaluateBookingNotificationPolicy,
} from "../src/lite/booking-operations.js";
import {
  LITE_SEATS,
  LITE_WORKSPACE_ID,
  LiteError,
  assertLiteAction,
  assertLiteReplyOperationId,
  assertLiteReplyReconciliationInput,
  assertNoActiveLiteReplyLease,
  assertLiteReplyOwnership,
  assertLiteRoutingActionAllowed,
  assertValidReplyText,
  buildAgentReplyBody,
  buildLiteMemberDocument,
  decideLiteReplyOperation,
  decideLiteReplyReconciliation,
  evaluateLiteServiceReplyContactPolicy,
  hasLiteAdminSetupClaim,
  hasLiteCanarySendClaim,
  isActiveLiteTenantAdminMembership,
  liveConversationKey,
  resolveAllowlistedWaId,
} from "../src/lite/contracts.js";

/** Static contracts must inspect authoritative TypeScript, never stale build output. */
function readLiteIndexSource(): string {
  return readFileSync(new URL("../../src/lite/index.ts", import.meta.url), "utf8");
}

test("lite workspace matches the bridge workspace", () => {
  assert.equal(LITE_WORKSPACE_ID, BRIDGE_WORKSPACE_ID);
});

test("seats are synthetic-only identities with valid roles", () => {
  assert.equal(LITE_SEATS.length, 3);
  for (const seat of LITE_SEATS) {
    assert.ok(seat.email.endsWith("@lite.synthetic.invalid"), seat.email);
    assert.ok(["agent", "supervisor"].includes(seat.role));
    assert.equal("password" in seat, false);
    assert.ok(seat.displayLabel.includes("synthetic"));
  }
});

test("Lite setup never creates Auth users or embeds/resets credentials", () => {
  const setupSource = readLiteIndexSource();
  assert.doesNotMatch(setupSource, /\.createUser\s*\(/);
  assert.doesNotMatch(setupSource, /\.updateUser\s*\(/);
  assert.doesNotMatch(setupSource, /password\s*:/);
  const setupStart = setupSource.indexOf("export const liteDemoSetup");
  const setupEnd = setupSource.indexOf("export const liteUpsertDoctor", setupStart);
  assert.ok(setupStart >= 0 && setupEnd > setupStart);
  const setupCallable = setupSource.slice(setupStart, setupEnd);
  assert.doesNotMatch(setupCallable, /lite_doctors|DOCTOR_SEED/);
});

test("provider sends and setup require separate exact-boolean custom claims", () => {
  assert.equal(
    hasLiteCanarySendClaim({ email_verified: true, hemasLiteCanary: true }),
    true,
  );
  assert.equal(
    hasLiteCanarySendClaim({ email_verified: true, hemasLiteCanary: "true" }),
    false,
  );
  assert.equal(hasLiteCanarySendClaim({ email_verified: true, hemasLiteAdmin: true }), false);
  assert.equal(hasLiteCanarySendClaim({ hemasLiteCanary: true }), false);
  assert.equal(hasLiteCanarySendClaim({ email_verified: false, hemasLiteCanary: true }), false);
  assert.equal(hasLiteCanarySendClaim({ email_verified: "true", hemasLiteCanary: true }), false);
  assert.equal(hasLiteCanarySendClaim(undefined), false);

  assert.equal(hasLiteAdminSetupClaim({ email_verified: true, hemasLiteAdmin: true }), true);
  assert.equal(hasLiteAdminSetupClaim({ email_verified: true, hemasLiteAdmin: 1 }), false);
  assert.equal(hasLiteAdminSetupClaim({ email_verified: true, hemasLiteCanary: true }), false);
  assert.equal(hasLiteAdminSetupClaim({ hemasLiteAdmin: true }), false);
  assert.equal(hasLiteAdminSetupClaim({ email_verified: false, hemasLiteAdmin: true }), false);
  assert.equal(hasLiteAdminSetupClaim({ email_verified: "true", hemasLiteAdmin: true }), false);
  assert.equal(hasLiteAdminSetupClaim(null), false);

  const source = readLiteIndexSource();
  const providerCallables = [
    "liteSetBookingStatus",
    "liteSendAgentReply",
    "liteSendCampaign",
  ] as const;
  for (const [index, callable] of providerCallables.entries()) {
    const start = source.indexOf(`export const ${callable}`);
    const nextCallable = providerCallables[index + 1];
    const end = nextCallable ? source.indexOf(`export const ${nextCallable}`, start) : source.length;
    assert.ok(start >= 0 && end > start);
    assert.match(source.slice(start, end), /hasLiteCanarySendClaim\(request\.auth\?\.token\)/);
  }
  assert.doesNotMatch(source, /demo\.admin@synthetic\.invalid/);
  assert.match(source, /request\.auth\?\.token\.email_verified !== true/);
  assert.match(source, /function requireVerifiedLiteAdmin/);
  assert.match(source, /isActiveLiteTenantAdminMembership\(membership\.data\(\), uid\)/);

  const activeAdmin = {
    id: "admin-uid",
    uid: "admin-uid",
    workspaceId: LITE_WORKSPACE_ID,
    status: "active",
    role: "tenant_admin",
  };
  assert.equal(isActiveLiteTenantAdminMembership(activeAdmin, "admin-uid"), true);
  assert.equal(
    isActiveLiteTenantAdminMembership({ ...activeAdmin, status: "disabled" }, "admin-uid"),
    false,
  );
  assert.equal(
    isActiveLiteTenantAdminMembership({ ...activeAdmin, role: "supervisor" }, "admin-uid"),
    false,
  );
  assert.equal(isActiveLiteTenantAdminMembership(undefined, "admin-uid"), false);
  assert.equal(isActiveLiteTenantAdminMembership(activeAdmin, "different-uid"), false);
});

test("every Lite admin mutation rechecks current tenant-admin membership before writes", () => {
  const source = readLiteIndexSource();
  const boundaries = [
    ["liteDemoSetup", "liteUpsertDoctor"],
    ["liteReconcileBookingNotification", "liteClaimConversation"],
    ["liteReconcileAgentReply", "liteSendCampaign"],
    ["liteReconcileCampaign", null],
  ] as const;
  for (const [name, next] of boundaries) {
    const start = source.indexOf(`export const ${name}`);
    const end = next ? source.indexOf(`export const ${next}`, start) : source.length;
    assert.ok(start >= 0 && end > start);
    const callable = source.slice(start, end);
    const guard = callable.indexOf("await requireVerifiedLiteAdmin(db, request)");
    assert.ok(guard >= 0, `${name} is missing the live membership guard`);
    const mutationCandidates = [
      callable.indexOf(".runTransaction("),
      callable.indexOf(".batch("),
      callable.indexOf("sendGraphMessage("),
    ].filter((position) => position >= 0);
    assert.ok(
      mutationCandidates.length === 0 || guard < Math.min(...mutationCandidates),
      `${name} can mutate before its live membership guard`,
    );
  }
});

test("every Lite outbound callable durably reserves before its first Graph send", () => {
  const source = readLiteIndexSource();
  const slices = [
    ["liteSetBookingStatus", "liteClaimConversation", "transaction.create(operationRef"],
    ["liteSendAgentReply", "liteReconcileAgentReply", "transaction.create(operationRef"],
    ["liteSendCampaign", null, "transaction.create(campaignRef"],
  ] as const;
  for (const [callableName, nextCallableName, reservationMarker] of slices) {
    const start = source.indexOf(`export const ${callableName}`);
    const end = nextCallableName
      ? source.indexOf(`export const ${nextCallableName}`, start)
      : source.length;
    assert.ok(start >= 0 && end > start);
    const callable = source.slice(start, end);
    const reservation = callable.indexOf(reservationMarker);
    const graphSend = callable.indexOf("sendGraphMessage(");
    assert.ok(reservation >= 0, `${callableName} is missing its durable reservation`);
    assert.ok(graphSend > reservation, `${callableName} sends before durable reservation`);
  }
  assert.match(source, /getHemasFirestore\(liteAdminApp\(projectId\)\)/);
  assert.doesNotMatch(source, /getFirestore\s*\(/);
});

test("Lite outbound terminal evidence and analytics counters share one atomic write", () => {
  const source = readLiteIndexSource();
  assert.doesNotMatch(source, /bumpDailyMetrics\s*\(/);
  assert.doesNotMatch(source, /void\s+buildDailyMetricIncrement/);
  assert.match(source, /completedBatch\.set[\s\S]*bookingMetric[\s\S]*completedBatch\.commit\(\)/);
  assert.match(source, /replyMetric[\s\S]*batch\.commit\(\)/);
  assert.match(source, /campaignMetric[\s\S]*campaignCompletionBatch\.commit\(\)/);
  assert.match(source, /\{ agentReplies: 1 \}/);
  assert.match(source, /\{ campaignSends: result\.result\.sent \}/);
  assert.match(source, /\{ apiRequests: 1 \}/);
});

test("Lite terminal sends atomically create content-free provider status routes", () => {
  assert.equal(META_CANARY_PROVIDER_ROUTES_COLLECTION, "canary_provider_message_routes");
  const cases = [
    {
      targetKind: "lite_agent_reply" as const,
      targetId: "reply_providerroute123456",
    },
    {
      targetKind: "lite_booking_notification" as const,
      targetId: `booking_op_${"a".repeat(24)}`,
    },
  ];
  for (const [index, target] of cases.entries()) {
    const providerMessageId = `wamid.lite-route-${index}`;
    const route = buildCanaryProviderRouteEvidence({
      providerMessageId,
      ...target,
      sha256Hex,
    });
    assert.equal(route.id, canaryProviderRouteId(providerMessageId, sha256Hex));
    assert.equal(route.providerMessageIdSha256, sha256Hex(providerMessageId));
    assert.equal(route.targetKind, target.targetKind);
    assert.equal(route.targetId, target.targetId);
    assert.equal(route.containsMessageContent, false);
    assert.equal(route.containsFullRecipient, false);
    assert.equal(JSON.stringify(route).includes(providerMessageId), false);
    assert.deepEqual(
      resolveCanaryProviderRoute({ route, providerMessageId, sha256Hex }),
      target,
    );
    assert.equal(
      resolveCanaryProviderRoute({
        route,
        providerMessageId: `${providerMessageId}-substituted`,
        sha256Hex,
      }),
      null,
    );
  }

  const source = readLiteIndexSource();
  const bookingStart = source.indexOf("export const liteSetBookingStatus");
  const bookingReconcileStart = source.indexOf(
    "export const liteReconcileBookingNotification",
  );
  const replyStart = source.indexOf("export const liteSendAgentReply");
  const replyReconcileStart = source.indexOf("export const liteReconcileAgentReply");
  const campaignStart = source.indexOf("export const liteSendCampaign");
  const booking = source.slice(bookingStart, bookingReconcileStart);
  const bookingReconcile = source.slice(bookingReconcileStart, source.indexOf(
    "export const liteClaimConversation",
    bookingReconcileStart,
  ));
  const reply = source.slice(replyStart, replyReconcileStart);
  const replyReconcile = source.slice(replyReconcileStart, campaignStart);
  assert.match(
    booking,
    /targetKind: "lite_booking_notification"[\s\S]*completedBatch\.create[\s\S]*completedBatch\.commit\(\)/,
  );
  assert.match(
    bookingReconcile,
    /targetKind: "lite_booking_notification"[\s\S]*transaction\.create\(providerRouteRef/,
  );
  assert.match(
    reply,
    /targetKind: "lite_agent_reply"[\s\S]*batch\.create[\s\S]*batch\.commit\(\)/,
  );
  assert.match(
    replyReconcile,
    /targetKind: "lite_agent_reply"[\s\S]*transaction\.create\(providerRouteRef/,
  );
  assert.doesNotMatch(source, /targetKind: "lite_(?:agent_reply|booking_notification)"[\s\S]{0,240}status: "send_uncertain"/);
});

test("member documents satisfy rules + client parser shape", () => {
  const doc = buildLiteMemberDocument("uid_123", LITE_SEATS[0]!) as Record<string, unknown>;
  assert.equal(doc.id, "uid_123");
  assert.equal(doc.uid, "uid_123");
  assert.equal(doc.workspaceId, "workspace_safenet_demo");
  assert.equal(doc.status, "active");
  assert.equal(doc.scopeMode, "assigned");
  assert.deepEqual(doc.teamIds, ["team_demo_general"]);
  assert.deepEqual(doc.locationIds, ["location_demo_wattala"]);
  assert.equal(doc.synthetic, true);
});

test("booking status operations reserve before send and replay completed evidence", () => {
  const operationId = "booking_1234567890abcdef";
  const bookingId = "HC-12345-0123456789";
  const status = "confirmed" as const;
  assert.equal(assertBookingOperationId(operationId), operationId);
  assert.throws(() => assertBookingOperationId("booking_short"), LiteBookingOperationError);
  const documentId = bookingOperationDocumentId(operationId, sha256Hex);
  const requestSha256 = bookingRequestSha256(
    { operationId, bookingId, status },
    sha256Hex,
  );
  assert.notEqual(
    requestSha256,
    bookingRequestSha256({ operationId, bookingId, status: "cancelled" }, sha256Hex),
  );
  const binding = {
    documentId,
    operationId,
    actorUid: "agent-a",
    bookingId,
    status,
    requestSha256,
  };
  assert.deepEqual(decideBookingOperation(undefined, binding), { kind: "reserve" });
  const sending = {
    id: documentId,
    operationId,
    actorUid: binding.actorUid,
    bookingId,
    targetStatus: status,
    requestSha256,
    status: "sending",
  };
  assert.throws(
    () => decideBookingOperation(sending, binding),
    (error: unknown) =>
      error instanceof LiteBookingOperationError && error.code === "operation_in_progress",
  );
  assert.deepEqual(
    decideBookingOperation({ ...sending, status: "reserved" }, binding),
    { kind: "resume_reserved" },
  );
  assert.throws(
    () => decideBookingOperation({ ...sending, status: "send_uncertain" }, binding),
    (error: unknown) =>
      error instanceof LiteBookingOperationError && error.code === "operation_uncertain",
  );
  assert.throws(
    () =>
      decideBookingOperation(
        { ...sending, operationId: "booking_fedcba0987654321" },
        binding,
      ),
    (error: unknown) =>
      error instanceof LiteBookingOperationError && error.code === "operation_conflict",
  );
  assert.deepEqual(
    decideBookingOperation({ ...sending, status: "completed", notified: true }, binding),
    {
      kind: "replay",
      result: {
        ok: true,
        bookingId,
        status,
        notified: true,
        idempotent: true,
      },
    },
  );
});

test("booking free-form policy requires a live window and current non-suppressed contact", () => {
  const nowMs = Date.UTC(2026, 7, 11, 18, 0, 0);
  const expected = {
    workspaceId: LITE_WORKSPACE_ID,
    conversationId: "conversation_live_0123456789",
    contactId: "contact_live_0123456789",
    nowMs,
  };
  const conversation = {
    id: expected.conversationId,
    workspaceId: expected.workspaceId,
    contactId: expected.contactId,
    synthetic: true,
    liveCanary: true,
    serviceWindowExpiresAt: { toMillis: () => nowMs + 60_000 },
  };
  const contact = {
    id: expected.contactId,
    workspaceId: expected.workspaceId,
    synthetic: true,
    liveCanary: true,
    suppression: {
      suppressAll: false,
      suppressMarketing: true,
      invalidContact: false,
      reasons: [],
      updatedAt: { toDate: () => new Date(nowMs) },
    },
    tags: [],
  };
  assert.deepEqual(evaluateBookingNotificationPolicy(conversation, contact, expected), {
    eligible: true,
  });
  assert.deepEqual(
    evaluateBookingNotificationPolicy(
      {
        ...conversation,
        serviceWindowExpiresAt: { toMillis: () => nowMs },
      },
      contact,
      expected,
    ),
    { eligible: false, reason: "service_window_closed" },
  );
  for (const field of ["suppressAll", "invalidContact"] as const) {
    assert.deepEqual(
      evaluateBookingNotificationPolicy(
        conversation,
        {
          ...contact,
          suppression: { ...contact.suppression, [field]: true },
        },
        expected,
      ),
      { eligible: false, reason: "contact_suppressed" },
    );
  }
  assert.deepEqual(
    evaluateBookingNotificationPolicy(
      conversation,
      { ...contact, suppression: { suppressAll: false } },
      expected,
    ),
    { eligible: false, reason: "contact_invalid" },
  );

  const source = readLiteIndexSource();
  const start = source.indexOf("export const liteSetBookingStatus");
  const end = source.indexOf("export const liteReconcileBookingNotification", start);
  const callable = source.slice(start, end);
  assert.match(callable, /transaction\.get\(ws\.collection\("conversations"\)/);
  assert.match(callable, /transaction\.get\(ws\.collection\("contacts"\)/);
  assert.ok(
    callable.lastIndexOf("evaluateBookingNotificationPolicy(") <
      callable.indexOf("sendGraphMessage("),
  );
});

test("concurrent booking transitions allow one sender per target and a later opposite status", async () => {
  let status: "pending" | "confirmed" | "cancelled" = "pending";
  let activeOperationId: string | null = null;
  let tail = Promise.resolve();
  let providerCalls = 0;

  async function reserve(operationId: string, target: "confirmed" | "cancelled") {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      if (activeOperationId) {
        throw new LiteBookingOperationError(
          "operation_in_progress",
          "Another booking transition is active.",
        );
      }
      assertBookingTransitionCanReserve(status, target);
      status = target;
      activeOperationId = operationId;
    } finally {
      release();
    }
    providerCalls += 1;
  }

  const sameTransition = await Promise.allSettled([
    reserve("booking_first123456789", "confirmed"),
    reserve("booking_second12345678", "confirmed"),
  ]);
  assert.equal(sameTransition.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(sameTransition.filter((result) => result.status === "rejected").length, 1);
  const rejected = sameTransition.find((result) => result.status === "rejected");
  assert.ok(
    rejected?.status === "rejected" &&
      rejected.reason instanceof LiteBookingOperationError &&
      rejected.reason.code === "operation_in_progress",
  );
  assert.equal(providerCalls, 1);

  await assert.rejects(
    () => reserve("booking_opposite123456", "cancelled"),
    (error: unknown) =>
      error instanceof LiteBookingOperationError && error.code === "operation_in_progress",
  );
  activeOperationId = null;
  await reserve("booking_opposite123456", "cancelled");
  assert.equal(status, "cancelled");
  assert.equal(providerCalls, 2);
});

test("booking reconciliation is exact, stale-safe and idempotent", () => {
  const nowMs = Date.UTC(2026, 7, 11, 18, 0, 0);
  const operationId = "booking_reconcile1234567";
  const documentId = bookingOperationDocumentId(operationId, sha256Hex);
  const requestSha256 = "a".repeat(64);
  const input = assertBookingReconciliationInput({
    operationId,
    requestSha256,
    outcome: "sent",
    providerMessageId: "wamid.booking-123",
    providerEvidenceSha256: "b".repeat(64),
  });
  assert.match(
    bookingReconciliationDocumentId(
      operationId,
      input.outcome,
      input.providerEvidenceSha256,
      sha256Hex,
    ),
    /^booking_reconcile_[0-9a-f]{32}$/,
  );
  for (const invalid of [
    { ...input, providerMessageId: null },
    { ...input, requestSha256: "a".repeat(63) },
    { ...input, extra: true },
    {
      ...input,
      outcome: "not_sent",
      providerMessageId: "wamid.booking-123",
    },
  ]) {
    assert.throws(() => assertBookingReconciliationInput(invalid), LiteBookingOperationError);
  }

  const operation = {
    id: documentId,
    workspaceId: LITE_WORKSPACE_ID,
    operationId,
    requestSha256,
    actorUid: "agent-a",
    bookingId: "HC-12345-0123456789",
    targetStatus: "confirmed",
    toNumberSha256: "c".repeat(64),
    toNumberLast4: "6789",
    status: "send_uncertain",
    updatedAt: { toMillis: () => nowMs - 1_000 },
  };
  const expected = { documentId, workspaceId: LITE_WORKSPACE_ID, nowMs };
  assert.deepEqual(decideBookingReconciliation(operation, input, expected), {
    kind: "apply",
    bookingId: operation.bookingId,
    status: "confirmed",
    notified: true,
  });
  assert.throws(
    () =>
      decideBookingReconciliation(
        { ...operation, status: "sending", updatedAt: { toMillis: () => nowMs - 1_000 } },
        input,
        expected,
      ),
    (error: unknown) =>
      error instanceof LiteBookingOperationError && error.code === "operation_in_progress",
  );
  assert.deepEqual(
    decideBookingReconciliation(
      {
        ...operation,
        status: "sending",
        updatedAt: { toMillis: () => nowMs - 10 * 60_000 },
      },
      input,
      expected,
    ),
    {
      kind: "apply",
      bookingId: operation.bookingId,
      status: "confirmed",
      notified: true,
    },
  );
  const terminal = {
    ...operation,
    status: "completed",
    notified: true,
    providerMessageId: input.providerMessageId,
    reconciliationOutcome: input.outcome,
    reconciliationRequestSha256: input.requestSha256,
    reconciliationEvidenceSha256: input.providerEvidenceSha256,
  };
  assert.deepEqual(decideBookingReconciliation(terminal, input, expected), {
    kind: "already_reconciled",
    bookingId: operation.bookingId,
    status: "confirmed",
    notified: true,
  });
  assert.throws(
    () =>
      decideBookingReconciliation(
        terminal,
        { ...input, providerEvidenceSha256: "d".repeat(64) },
        expected,
      ),
    (error: unknown) =>
      error instanceof LiteBookingOperationError && error.code === "operation_conflict",
  );

  const source = readLiteIndexSource();
  const start = source.indexOf("export const liteReconcileBookingNotification");
  const end = source.indexOf("export const liteClaimConversation", start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(source.slice(start, end), /sendGraphMessage\s*\(/);
});

test("reply text validation strips control chars and bounds length", () => {
  assert.equal(assertValidReplyText("  hello there  "), "hello there");
  assert.throws(() => assertValidReplyText(""), LiteError);
  assert.throws(() => assertValidReplyText(undefined), LiteError);
  assert.throws(() => assertValidReplyText("x".repeat(1025)), LiteError);
  assert.equal(assertValidReplyText("සුබ දවසක්! நன்றி"), "සුබ දවසක්! நன்றி");
});

test("live conversation key extraction rejects foreign ids", () => {
  const { conversationId, key } = liveIds("15555550100");
  assert.equal(liveConversationKey(conversationId), key);
  assert.throws(() => liveConversationKey("conversation_demo_123"), LiteError);
  assert.throws(() => liveConversationKey("conversation_live_ZZZ"), LiteError);
  assert.throws(() => liveConversationKey(42), LiteError);
});

test("allowlist routing recovers the number only for allowlisted visitors", () => {
  const allowlist = parseRecipientAllowlist("+15555550100,+15555550101");
  const { key } = liveIds("15555550100");
  assert.equal(resolveAllowlistedWaId(key, allowlist, sha256Hex), "15555550100");

  const stranger = liveIds("15555550102");
  assert.equal(resolveAllowlistedWaId(stranger.key, allowlist, sha256Hex), null);
});

test("agent reply body is a plain WhatsApp text payload", () => {
  assert.deepEqual(buildAgentReplyBody("On the way!"), {
    type: "text",
    text: { preview_url: false, body: "On the way!" },
  });
});

test("service replies allow STOP-only contacts but block current all-channel holds", () => {
  const contactId = "contact_live_0123456789";
  const contact = {
    id: contactId,
    workspaceId: LITE_WORKSPACE_ID,
    synthetic: true,
    liveCanary: true,
    tags: ["marketing-suppressed"],
    suppression: {
      suppressAll: false,
      suppressMarketing: true,
      invalidContact: false,
      reasons: ["stop_keyword"],
      updatedAt: { toDate: () => new Date() },
    },
  };
  assert.deepEqual(evaluateLiteServiceReplyContactPolicy(contact, contactId), {
    eligible: true,
  });
  assert.deepEqual(
    evaluateLiteServiceReplyContactPolicy(
      {
        ...contact,
        suppression: { ...contact.suppression, suppressAll: true },
      },
      contactId,
    ),
    { eligible: false, reason: "suppress_all" },
  );
  assert.deepEqual(
    evaluateLiteServiceReplyContactPolicy(
      {
        ...contact,
        suppression: { ...contact.suppression, invalidContact: true },
      },
      contactId,
    ),
    { eligible: false, reason: "invalid_contact" },
  );
  for (const malformed of [
    undefined,
    { ...contact, id: "contact_live_substituted" },
    { ...contact, suppression: { suppressAll: false } },
    {
      ...contact,
      suppression: { ...contact.suppression, unexpected: true },
    },
  ]) {
    assert.deepEqual(
      evaluateLiteServiceReplyContactPolicy(malformed, contactId),
      { eligible: false, reason: "contact_invalid" },
    );
  }

  const source = readLiteIndexSource();
  const start = source.indexOf("export const liteSendAgentReply");
  const end = source.indexOf("export const liteReconcileAgentReply", start);
  const callable = source.slice(start, end);
  const graphSend = callable.indexOf("sendGraphMessage(");
  const policyChecks = [
    ...callable.matchAll(/evaluateLiteServiceReplyContactPolicy\(/g),
  ].map((match) => match.index);
  assert.equal(policyChecks.length, 2);
  assert.ok(policyChecks.every((position) => position < graphSend));
  assert.equal([...callable.matchAll(/transaction\.get\(contactRef\)/g)].length, 2);
  assert.match(
    callable,
    /status: "not_sent"[\s\S]*lastResolution: "policy_blocked"[\s\S]*if \(!preSend\.send\)/,
  );
  assert.match(callable, /routingReason = "routing_changed"/);
  assert.match(callable, /windowClosed[\s\S]*"service_window_closed"/);
  assert.ok(
    callable.indexOf('status: "not_sent"', callable.indexOf("const preSend")) < graphSend,
  );
});

test("claim actions are strictly claim or release", () => {
  assert.equal(assertLiteAction("claim"), "claim");
  assert.equal(assertLiteAction("release"), "release");
  assert.throws(() => assertLiteAction("assign"), LiteError);
  assert.throws(() => assertLiteAction(null), LiteError);
});

test("routing ownership permits only unassigned/self claims and self release/reply", () => {
  assert.doesNotThrow(() => assertLiteRoutingActionAllowed("claim", null, "agent-a"));
  assert.doesNotThrow(() => assertLiteRoutingActionAllowed("claim", "agent-a", "agent-a"));
  assert.throws(
    () => assertLiteRoutingActionAllowed("claim", "agent-b", "agent-a"),
    (error: unknown) => error instanceof LiteError && error.code === "already_assigned",
  );
  assert.doesNotThrow(() => assertLiteRoutingActionAllowed("release", "agent-a", "agent-a"));
  assert.throws(
    () => assertLiteRoutingActionAllowed("release", null, "agent-a"),
    (error: unknown) => error instanceof LiteError && error.code === "not_assignee",
  );
  assert.throws(
    () => assertLiteRoutingActionAllowed("release", "agent-b", "agent-a"),
    (error: unknown) => error instanceof LiteError && error.code === "not_assignee",
  );

  assert.doesNotThrow(() =>
    assertLiteReplyOwnership(
      { assigneeId: "agent-a", status: "assigned", mode: "human_takeover" },
      "agent-a",
    ),
  );
  assert.throws(
    () =>
      assertLiteReplyOwnership(
        { assigneeId: "agent-b", status: "assigned", mode: "human_takeover" },
        "agent-a",
      ),
    (error: unknown) => error instanceof LiteError && error.code === "not_assignee",
  );
  assert.throws(
    () =>
      assertLiteReplyOwnership(
        { assigneeId: "agent-a", status: "active", mode: "automation" },
        "agent-a",
      ),
    (error: unknown) => error instanceof LiteError && error.code === "invalid_routing_state",
  );
});

test("reply lock plus durable operation history closes races and preserves old replay", () => {
  const operationId = "reply_1234567890abcdef";
  const conversationId = "conversation_live_0123456789";
  const bodySha256 = sha256Hex("hello");
  assert.equal(assertLiteReplyOperationId(operationId), operationId);
  assert.throws(() => assertLiteReplyOperationId("94700000000"), LiteError);

  assert.doesNotThrow(() => assertNoActiveLiteReplyLease(undefined));
  assert.doesNotThrow(() => assertNoActiveLiteReplyLease({ status: "idle" }));
  assert.doesNotThrow(() => assertNoActiveLiteReplyLease({ status: "sent" }));
  assert.doesNotThrow(() => assertNoActiveLiteReplyLease({ status: "failed" }));
  for (const status of ["sending", "send_uncertain", "malformed"]) {
    assert.throws(
      () => assertNoActiveLiteReplyLease({ status }),
      (error: unknown) => error instanceof LiteError && error.code === "reply_in_progress",
    );
  }
  assert.throws(
    () => assertNoActiveLiteReplyLease({ status: "idle", activeOperationId: operationId }),
    (error: unknown) => error instanceof LiteError && error.code === "reply_in_progress",
  );

  assert.deepEqual(
    decideLiteReplyOperation(
      undefined,
      operationId,
      conversationId,
      "agent-a",
      bodySha256,
    ),
    { kind: "reserve" },
  );
  const sending = {
    operationId,
    conversationId,
    actorUid: "agent-a",
    bodySha256,
    status: "sending",
    providerMessageId: null,
  };
  assert.throws(
    () =>
      decideLiteReplyOperation(
        sending,
        operationId,
        conversationId,
        "agent-a",
        bodySha256,
      ),
    (error: unknown) => error instanceof LiteError && error.code === "reply_in_progress",
  );
  assert.throws(
    () =>
      decideLiteReplyOperation(
        sending,
        "reply_fedcba0987654321",
        conversationId,
        "agent-b",
        bodySha256,
      ),
    (error: unknown) => error instanceof LiteError && error.code === "invalid_operation",
  );
  assert.deepEqual(
    decideLiteReplyOperation(
      { ...sending, status: "sent", providerMessageId: "wamid.synthetic" },
      operationId,
      conversationId,
      "agent-a",
      bodySha256,
    ),
    { kind: "already_sent", providerMessageId: "wamid.synthetic" },
  );
  assert.throws(
    () =>
      decideLiteReplyOperation(
        { ...sending, status: "sent", providerMessageId: "wamid.synthetic" },
        operationId,
        conversationId,
        "agent-a",
        sha256Hex("different"),
      ),
    (error: unknown) => error instanceof LiteError && error.code === "invalid_operation",
  );
  assert.throws(
    () =>
      decideLiteReplyOperation(
        { ...sending, status: "not_sent" },
        operationId,
        conversationId,
        "agent-a",
        bodySha256,
      ),
    (error: unknown) => error instanceof LiteError && error.code === "operation_terminal",
  );

  // A newer conversation lock does not erase or weaken the old operation receipt.
  assert.throws(
    () => assertNoActiveLiteReplyLease({ status: "sending", activeOperationId: "reply_new" }),
    LiteError,
  );
  assert.deepEqual(
    decideLiteReplyOperation(
      { ...sending, status: "sent", providerMessageId: "wamid.synthetic" },
      operationId,
      conversationId,
      "agent-a",
      bodySha256,
    ),
    { kind: "already_sent", providerMessageId: "wamid.synthetic" },
  );
});

test("reply reconciliation requires exact provider evidence and never authorizes a resend", () => {
  const nowMs = Date.UTC(2026, 7, 11, 18, 0, 0);
  const input = assertLiteReplyReconciliationInput({
    conversationId: "conversation_live_0123456789",
    operationId: "reply_1234567890abcdef",
    outcome: "sent",
    providerMessageId: "wamid.provider-123",
    providerEvidenceSha256: "a".repeat(64),
  });
  assert.equal(input.outcome, "sent");
  assert.deepEqual(
    assertLiteReplyReconciliationInput({
      ...input,
      outcome: "not_sent",
      providerMessageId: null,
    }),
    { ...input, outcome: "not_sent", providerMessageId: null },
  );
  for (const invalid of [
    { ...input, providerEvidenceSha256: "a".repeat(63) },
    { ...input, outcome: "not_sent", providerMessageId: "wamid.provider-123" },
    { ...input, outcome: "sent", providerMessageId: null },
    { ...input, extra: true },
  ]) {
    assert.throws(() => assertLiteReplyReconciliationInput(invalid), LiteError);
  }

  const operation = {
    operationId: input.operationId,
    conversationId: input.conversationId,
    status: "send_uncertain",
  };
  const lease = {
    activeOperationId: input.operationId,
    status: "send_uncertain",
  };
  assert.deepEqual(decideLiteReplyReconciliation(operation, lease, input, nowMs), { kind: "apply" });
  assert.throws(
    () =>
      decideLiteReplyReconciliation(
        operation,
        { ...lease, activeOperationId: "reply_different123456" },
        input,
        nowMs,
      ),
    (error: unknown) => error instanceof LiteError && error.code === "reconciliation_conflict",
  );

  const terminal = {
    ...operation,
    status: "sent",
    providerMessageId: input.providerMessageId,
    reconciliationEvidenceSha256: input.providerEvidenceSha256,
  };
  assert.deepEqual(decideLiteReplyReconciliation(terminal, { status: "idle" }, input, nowMs), {
    kind: "already_reconciled",
  });
  assert.throws(
    () =>
      decideLiteReplyReconciliation(
        terminal,
        { status: "idle" },
        { ...input, providerEvidenceSha256: "b".repeat(64) },
        nowMs,
      ),
    (error: unknown) => error instanceof LiteError && error.code === "reconciliation_conflict",
  );

  const source = readLiteIndexSource();
  const start = source.indexOf("export const liteReconcileAgentReply");
  const end = source.indexOf("export const liteSendCampaign", start);
  assert.ok(start >= 0 && end > start);
  const callable = source.slice(start, end);
  assert.match(callable, /requireVerifiedLiteAdmin\(db, request\)/);
  assert.doesNotMatch(callable, /sendGraphMessage\s*\(/);

  const sending = {
    ...operation,
    status: "sending",
    updatedAt: { toMillis: () => nowMs - 1_000 },
  };
  assert.throws(
    () =>
      decideLiteReplyReconciliation(
        sending,
        {
          ...lease,
          status: "sending",
          updatedAt: { toMillis: () => nowMs - 1_000 },
        },
        input,
        nowMs,
      ),
    (error: unknown) => error instanceof LiteError && error.code === "reply_in_progress",
  );
  assert.deepEqual(
    decideLiteReplyReconciliation(
      { ...sending, updatedAt: { toMillis: () => nowMs - 10 * 60_000 } },
      {
        ...lease,
        status: "sending",
        updatedAt: { toMillis: () => nowMs - 10 * 60_000 },
      },
      input,
      nowMs,
    ),
    { kind: "apply" },
  );
});

test("concurrent reply operations acquire one conversation lock while history stays replayable", async () => {
  const conversationId = "conversation_live_0123456789";
  const actorUid = "agent-a";
  const bodySha256 = sha256Hex("hello");
  const operationIds = ["reply_concurrent123456", "reply_concurrent654321"] as const;
  const operations = new Map<string, Record<string, unknown>>();
  let lease: Record<string, unknown> | undefined;
  let tail = Promise.resolve();

  async function reserve(operationId: string) {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const decision = decideLiteReplyOperation(
        operations.get(operationId),
        operationId,
        conversationId,
        actorUid,
        bodySha256,
      );
      if (decision.kind === "reserve") {
        assertNoActiveLiteReplyLease(lease);
        operations.set(operationId, {
          operationId,
          conversationId,
          actorUid,
          bodySha256,
          status: "sending",
        });
        lease = { status: "sending", activeOperationId: operationId };
      }
      return { operationId, decision };
    } finally {
      release();
    }
  }

  const competing = await Promise.allSettled(operationIds.map((operationId) => reserve(operationId)));
  const winner = competing.find((result) => result.status === "fulfilled");
  assert.ok(winner && winner.status === "fulfilled");
  assert.equal(competing.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(competing.filter((result) => result.status === "rejected").length, 1);
  const winnerId = winner.value.operationId;
  operations.set(winnerId, {
    ...operations.get(winnerId),
    status: "sent",
    providerMessageId: "wamid.concurrent",
  });
  lease = { status: "idle", activeOperationId: null, lastOperationId: winnerId };

  const loserId = operationIds.find((operationId) => operationId !== winnerId)!;
  assert.deepEqual((await reserve(loserId)).decision, { kind: "reserve" });
  assert.deepEqual(
    decideLiteReplyOperation(
      operations.get(winnerId),
      winnerId,
      conversationId,
      actorUid,
      bodySha256,
    ),
    { kind: "already_sent", providerMessageId: "wamid.concurrent" },
  );
});

test("live bridge builders emit canonical strict documents and preserve ownership", () => {
  const nowMs = Date.UTC(2026, 7, 11, 10, 0, 0);
  const ids = liveIds("94700000000");
  const inbound = {
    direction: "inbound" as const,
    waMessageId: "wamid.synthetic",
    messageType: "text",
    language: "en" as const,
    purpose: "general_support" as const,
    staffHandoff: false,
    last4: "0000",
  };
  const contact = buildLiveContactDocument({
    contactId: ids.contactId,
    last4: inbound.last4,
    language: "en",
    nowMs,
    existing: {
      tags: ["crm_engaged", "marketing-suppressed"],
      suppression: { status: "none", reasons: [] },
    },
  });
  assert.deepEqual(contact.tags, ["marketing-suppressed"]);
  assert.deepEqual(Object.keys(contact.suppression as object).sort(), [
    "invalidContact",
    "reasons",
    "suppressAll",
    "suppressMarketing",
    "updatedAt",
  ]);
  assert.equal(contact.liveCanary, true);

  const conversation = buildLiveConversationDocument({
    contactId: ids.contactId,
    conversationId: ids.conversationId,
    message: inbound,
    nowMs,
    existing: { assigneeId: "agent-a", unreadCount: 4 },
  });
  assert.equal(conversation.assigneeId, "agent-a");
  assert.equal(conversation.mode, "human_takeover");
  assert.equal(conversation.unreadCount, 5);

  const inboundServiceWindow = conversation.serviceWindowExpiresAt;
  const outboundDuringUnassignedHandoff = buildLiveConversationDocument({
    contactId: ids.contactId,
    conversationId: ids.conversationId,
    message: { ...inbound, direction: "outbound" },
    nowMs: nowMs + 48 * 60 * 60 * 1000,
    existing: {
      ...conversation,
      mode: "human_takeover",
      status: "assigned",
      assigneeId: null,
    },
  });
  assert.equal(outboundDuringUnassignedHandoff.mode, "human_takeover");
  assert.equal(outboundDuringUnassignedHandoff.status, "assigned");
  assert.equal(outboundDuringUnassignedHandoff.assigneeId, null);
  assert.equal(
    outboundDuringUnassignedHandoff.serviceWindowExpiresAt,
    inboundServiceWindow,
    "outbound evidence preserves rather than reopens the inbound service window",
  );

  const inboundMessage = buildLiveMessageDocument({
    messageId: "message_live_0000000000000000",
    contactId: ids.contactId,
    conversationId: ids.conversationId,
    message: inbound,
    nowMs,
  });
  assert.equal(inboundMessage.externalDispatch, "not_applicable");
  const outboundMessage = buildLiveMessageDocument({
    messageId: "message_live_1111111111111111",
    contactId: ids.contactId,
    conversationId: ids.conversationId,
    message: { ...inbound, direction: "outbound" },
    nowMs,
  });
  assert.equal(outboundMessage.externalDispatch, "dispatched");
});

test("campaign contracts: names, templates, ids, status ordering", async () => {
  const {
    LiteCampaignError,
    assertCampaignOperationId,
    assertCampaignReconciliationInput,
    assertTemplateSelection,
    assertValidCampaignName,
    campaignId,
    campaignReconciliationDocumentId,
    campaignRecipientOperationId,
    campaignRequestSha256,
    decideCampaignOperation,
    decideCampaignReconciliation,
    extractDeliveryStatusEvents,
    isEligibleCanaryCampaignContact,
    resolveAllowlistedContactAudience,
    sendDocIdForWamid,
    shouldAdvanceSendStatus,
  } = await import("../src/lite/campaigns.js");

  assert.equal(assertValidCampaignName("  OPD  reminder (Aug) "), "OPD reminder (Aug)");
  assert.throws(() => assertValidCampaignName("ab"), LiteCampaignError);
  assert.throws(() => assertValidCampaignName("<script>"), LiteCampaignError);

  assert.deepEqual(assertTemplateSelection("hemas_canary_hello", undefined), {
    templateName: "hemas_canary_hello",
    languageCode: "en_US",
  });
  assert.deepEqual(assertTemplateSelection("hemas_welcome_visual", "en_US"), {
    templateName: "hemas_welcome_visual",
    languageCode: "en_US",
  });
  assert.throws(() => assertTemplateSelection(undefined, undefined), LiteCampaignError);
  assert.throws(() => assertTemplateSelection("hello_world", "en_US"), LiteCampaignError);
  assert.throws(() => assertTemplateSelection("appointment_reminder", "en_US"), LiteCampaignError);
  assert.throws(() => assertTemplateSelection("hemas_canary_hello", "en"), LiteCampaignError);
  assert.throws(() => assertTemplateSelection("hemas_welcome_visual", "si_LK"), LiteCampaignError);

  const operationId = "campaign_1234567890abcdef";
  assert.equal(assertCampaignOperationId(operationId), operationId);
  assert.throws(() => assertCampaignOperationId("campaign_short"), LiteCampaignError);
  assert.equal(campaignId(operationId, sha256Hex), campaignId(operationId, sha256Hex));
  assert.notEqual(
    campaignId(operationId, sha256Hex),
    campaignId("campaign_fedcba0987654321", sha256Hex),
  );
  assert.match(sendDocIdForWamid("wamid.X", sha256Hex), /^send_[0-9a-f]{32}$/);

  const allowlist = parseRecipientAllowlist("+94700000000,+94700000001");
  const firstContactId = liveIds(allowlist[0]!).contactId;
  const secondContactId = liveIds(allowlist[1]!).contactId;
  const id = campaignId(operationId, sha256Hex);
  const requestSha256 = campaignRequestSha256(
    {
      operationId,
      name: "OPD reminder (Aug)",
      templateName: "hemas_canary_hello",
      languageCode: "en_US",
      contactIds: [secondContactId, firstContactId],
    },
    sha256Hex,
  );
  assert.equal(
    requestSha256,
    campaignRequestSha256(
      {
        operationId,
        name: "OPD reminder (Aug)",
        templateName: "hemas_canary_hello",
        languageCode: "en_US",
        contactIds: [firstContactId, secondContactId, firstContactId],
      },
      sha256Hex,
    ),
  );
  assert.match(
    campaignRecipientOperationId(id, firstContactId, sha256Hex),
    /^camp_recipient_[0-9a-f]{24}$/,
  );
  const binding = {
    campaignId: id,
    operationId,
    actorUid: "supervisor-a",
    requestSha256,
  };
  assert.deepEqual(decideCampaignOperation(undefined, binding), { kind: "reserve" });
  const sendingOperation = {
    id,
    operationId,
    actorUid: binding.actorUid,
    requestSha256,
    status: "sending",
  };
  assert.throws(
    () => decideCampaignOperation(sendingOperation, binding),
    (error: unknown) =>
      error instanceof LiteCampaignError && error.code === "operation_in_progress",
  );
  assert.throws(
    () => decideCampaignOperation({ ...sendingOperation, status: "send_uncertain" }, binding),
    (error: unknown) =>
      error instanceof LiteCampaignError && error.code === "operation_uncertain",
  );
  assert.throws(
    () =>
      decideCampaignOperation(
        { ...sendingOperation, status: "sent", requestSha256: "f".repeat(64) },
        binding,
      ),
    (error: unknown) =>
      error instanceof LiteCampaignError && error.code === "operation_conflict",
  );
  assert.deepEqual(
    decideCampaignOperation(
      {
        ...sendingOperation,
        status: "sent",
        audienceCount: 2,
        excludedCount: 0,
        sentCount: 2,
        failedCount: 0,
      },
      binding,
    ),
    {
      kind: "replay",
      result: {
        campaignId: id,
        audience: 2,
        excluded: 0,
        sent: 2,
        failed: 0,
        idempotent: true,
      },
    },
  );
  assert.deepEqual(
    resolveAllowlistedContactAudience(
      [firstContactId],
      allowlist,
      (digits) => liveIds(digits).contactId,
    ),
    [allowlist[0]],
  );
  assert.throws(
    () =>
      resolveAllowlistedContactAudience(
        [allowlist[0]],
        allowlist,
        (digits) => liveIds(digits).contactId,
      ),
    LiteCampaignError,
  );
  assert.throws(
    () =>
      resolveAllowlistedContactAudience(
        [liveIds("94799999999").contactId],
        allowlist,
        (digits) => liveIds(digits).contactId,
      ),
    LiteCampaignError,
  );

  const eligibleContact = buildLiveContactDocument({
    contactId: firstContactId,
    last4: "0000",
    language: "en",
    nowMs: Date.UTC(2026, 7, 11, 10, 0, 0),
  });
  assert.equal(
    isEligibleCanaryCampaignContact(eligibleContact, firstContactId, LITE_WORKSPACE_ID),
    true,
  );
  for (const field of ["suppressAll", "suppressMarketing", "invalidContact"] as const) {
    const suppression = eligibleContact.suppression as Record<string, unknown>;
    assert.equal(
      isEligibleCanaryCampaignContact(
        {
          ...eligibleContact,
          suppression: { ...suppression, [field]: true },
        },
        firstContactId,
        LITE_WORKSPACE_ID,
      ),
      false,
    );
  }
  assert.equal(
    isEligibleCanaryCampaignContact(
      { ...eligibleContact, tags: ["marketing-suppressed"] },
      firstContactId,
      LITE_WORKSPACE_ID,
    ),
    false,
  );

  const reconciliationNowMs = Date.UTC(2026, 7, 11, 18, 0, 0);
  const thirdContactId = liveIds("94700000002").contactId;
  const recipientEvidence = [firstContactId, secondContactId, thirdContactId].map(
    (contactId, index) => ({
      id: campaignRecipientOperationId(id, contactId, sha256Hex),
      workspaceId: LITE_WORKSPACE_ID,
      campaignId: id,
      campaignOperationId: operationId,
      requestSha256,
      contactId,
      toNumberSha256: sha256Hex(`9470000000${index}`),
      toNumberLast4: `000${index}`,
      status: index === 0 ? "sent" : index === 1 ? "send_uncertain" : "reserved",
      updatedAt: { toMillis: () => reconciliationNowMs - 1_000 },
    }),
  );
  const reconcileInput = assertCampaignReconciliationInput({
    operationId,
    requestSha256,
    recipientOperationId: recipientEvidence[1]!.id,
    outcome: "sent",
    providerMessageId: "wamid.campaign-123",
    providerEvidenceSha256: "b".repeat(64),
  });
  assert.match(
    campaignReconciliationDocumentId(
      operationId,
      reconcileInput.outcome,
      reconcileInput.recipientOperationId,
      reconcileInput.providerEvidenceSha256,
      sha256Hex,
    ),
    /^campaign_reconcile_[0-9a-f]{32}$/,
  );
  for (const invalid of [
    { ...reconcileInput, providerMessageId: null },
    { ...reconcileInput, requestSha256: "a".repeat(63) },
    { ...reconcileInput, extra: true },
    {
      ...reconcileInput,
      outcome: "finalize_recorded",
      recipientOperationId: reconcileInput.recipientOperationId,
      providerMessageId: null,
    },
  ]) {
    assert.throws(() => assertCampaignReconciliationInput(invalid), LiteCampaignError);
  }
  const campaignEvidence = {
    id,
    workspaceId: LITE_WORKSPACE_ID,
    operationId,
    requestSha256,
    actorUid: "supervisor-a",
    audienceCount: 3,
    excludedCount: 0,
    sentCount: 1,
    failedCount: 0,
    status: "send_uncertain",
    uncertainRecipientOperationId: recipientEvidence[1]!.id,
    updatedAt: { toMillis: () => reconciliationNowMs - 1_000 },
  };
  const reconciliationExpected = {
    campaignId: id,
    workspaceId: LITE_WORKSPACE_ID,
    nowMs: reconciliationNowMs,
    sha256Hex,
  };
  const applyReconciliation = decideCampaignReconciliation(
    campaignEvidence,
    recipientEvidence,
    reconcileInput,
    reconciliationExpected,
  );
  assert.deepEqual(applyReconciliation, {
    kind: "apply",
    targetOperationId: recipientEvidence[1]!.id,
    targetStatus: "sent",
    haltOperationIds: [recipientEvidence[2]!.id],
    status: "reconciled_halted",
    result: {
      campaignId: id,
      audience: 3,
      excluded: 0,
      sent: 2,
      failed: 1,
      idempotent: false,
    },
  });
  const terminalCampaign = {
    ...campaignEvidence,
    status: "reconciled_halted",
    sentCount: 2,
    failedCount: 1,
    reconciliationOutcome: reconcileInput.outcome,
    reconciliationRequestSha256: reconcileInput.requestSha256,
    reconciliationRecipientOperationId: reconcileInput.recipientOperationId,
    reconciliationProviderMessageId: reconcileInput.providerMessageId,
    reconciliationEvidenceSha256: reconcileInput.providerEvidenceSha256,
  };
  const terminalRecipients = recipientEvidence.map((recipient, index) => ({
    ...recipient,
    status: index < 2 ? "sent" : "not_sent",
  }));
  assert.deepEqual(
    decideCampaignReconciliation(
      terminalCampaign,
      terminalRecipients,
      reconcileInput,
      reconciliationExpected,
    ),
    {
      kind: "already_reconciled",
      result: {
        campaignId: id,
        audience: 3,
        excluded: 0,
        sent: 2,
        failed: 1,
        idempotent: true,
      },
    },
  );
  assert.throws(
    () =>
      decideCampaignReconciliation(
        { ...campaignEvidence, status: "sending" },
        recipientEvidence.map((recipient, index) => ({
          ...recipient,
          status: index === 0 ? "sent" : index === 1 ? "sending" : "reserved",
        })),
        reconcileInput,
        reconciliationExpected,
      ),
    (error: unknown) =>
      error instanceof LiteCampaignError && error.code === "operation_in_progress",
  );
  const finalizeInput = assertCampaignReconciliationInput({
    operationId,
    requestSha256,
    recipientOperationId: null,
    outcome: "finalize_recorded",
    providerMessageId: null,
    providerEvidenceSha256: "c".repeat(64),
  });
  assert.deepEqual(
    decideCampaignReconciliation(
      {
        ...campaignEvidence,
        status: "sending",
        sentCount: 3,
        updatedAt: { toMillis: () => reconciliationNowMs - 10 * 60_000 },
      },
      recipientEvidence.map((recipient) => ({ ...recipient, status: "sent" })),
      finalizeInput,
      reconciliationExpected,
    ),
    {
      kind: "apply",
      targetOperationId: null,
      targetStatus: null,
      haltOperationIds: [],
      status: "sent",
      result: {
        campaignId: id,
        audience: 3,
        excluded: 0,
        sent: 3,
        failed: 0,
        idempotent: false,
      },
    },
  );
  const haltInput = assertCampaignReconciliationInput({
    operationId,
    requestSha256,
    recipientOperationId: null,
    outcome: "halt_reserved",
    providerMessageId: null,
    providerEvidenceSha256: "d".repeat(64),
  });
  assert.deepEqual(
    decideCampaignReconciliation(
      {
        ...campaignEvidence,
        status: "sending",
        sentCount: 1,
        failedCount: 0,
        updatedAt: { toMillis: () => reconciliationNowMs - 10 * 60_000 },
      },
      recipientEvidence.map((recipient, index) => ({
        ...recipient,
        status: index === 0 ? "sent" : "reserved",
      })),
      haltInput,
      reconciliationExpected,
    ),
    {
      kind: "apply",
      targetOperationId: null,
      targetStatus: null,
      haltOperationIds: [recipientEvidence[1]!.id, recipientEvidence[2]!.id].sort(),
      status: "reconciled_halted",
      result: {
        campaignId: id,
        audience: 3,
        excluded: 0,
        sent: 1,
        failed: 2,
        idempotent: false,
      },
    },
  );

  const liteIndexSource = readLiteIndexSource();
  const sendStart = liteIndexSource.indexOf("export const liteSendCampaign");
  const reconcileStart = liteIndexSource.indexOf("export const liteReconcileCampaign");
  assert.ok(sendStart >= 0 && reconcileStart > sendStart);
  const sendCallable = liteIndexSource.slice(sendStart, reconcileStart);
  const contactRecheck = sendCallable.lastIndexOf(
    'transaction.get(ws.collection("contacts").doc(recipient.contactId))',
  );
  const providerSend = sendCallable.indexOf("sendGraphMessage(");
  assert.ok(contactRecheck >= 0 && contactRecheck < providerSend);
  assert.match(sendCallable, /policyReason: "contact_no_longer_eligible"/);
  assert.match(sendCallable, /status: failed === 0 \? "sent" : "completed_partial"/);
  assert.doesNotMatch(liteIndexSource.slice(reconcileStart), /sendGraphMessage\s*\(/);

  assert.equal(shouldAdvanceSendStatus(undefined, "sent"), true);
  assert.equal(shouldAdvanceSendStatus("sent", "delivered"), true);
  assert.equal(shouldAdvanceSendStatus("read", "delivered"), false);
  assert.equal(shouldAdvanceSendStatus("delivered", "failed"), true);
  assert.equal(shouldAdvanceSendStatus("sent", "bogus"), false);

  const events = extractDeliveryStatusEvents({
    entry: [
      {
        changes: [
          {
            value: {
              statuses: [
                { id: "wamid.A", status: "delivered" },
                { id: "wamid.B", status: "unknown_state" },
                { status: "read" },
              ],
            },
          },
        ],
      },
    ],
  });
  assert.deepEqual(events, [{ wamid: "wamid.A", status: "delivered" }]);
});

test("concurrent campaign reservations produce one sender and completed retries only replay", async () => {
  const {
    LiteCampaignError,
    campaignId,
    decideCampaignOperation,
  } = await import("../src/lite/campaigns.js");
  const operationId = "campaign_concurrent123456";
  const id = campaignId(operationId, sha256Hex);
  const binding = {
    campaignId: id,
    operationId,
    actorUid: "supervisor-a",
    requestSha256: "a".repeat(64),
  };
  let record: Record<string, unknown> | undefined;
  let tail = Promise.resolve();
  let providerCalls = 0;
  let announceReservation!: () => void;
  const reservationCreated = new Promise<void>((resolve) => { announceReservation = resolve; });
  let releaseProvider!: () => void;
  const providerGate = new Promise<void>((resolve) => { releaseProvider = resolve; });

  async function transactionReserve() {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const decision = decideCampaignOperation(record, binding);
      if (decision.kind === "reserve") {
        record = { ...binding, id, status: "sending" };
      }
      return decision;
    } finally {
      release();
    }
  }

  async function invoke() {
    const decision = await transactionReserve();
    if (decision.kind === "replay") return decision.result;
    providerCalls += 1;
    announceReservation();
    await providerGate;
    record = {
      ...record,
      status: "sent",
      audienceCount: 2,
      excludedCount: 0,
      sentCount: 2,
      failedCount: 0,
    };
    return { campaignId: id, audience: 2, excluded: 0, sent: 2, failed: 0, idempotent: false };
  }

  const first = invoke();
  await reservationCreated;
  const competitors = await Promise.allSettled(Array.from({ length: 19 }, () => invoke()));
  assert.equal(providerCalls, 1);
  assert.equal(competitors.filter((result) => result.status === "rejected").length, 19);
  for (const result of competitors) {
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") {
      assert.ok(
        result.reason instanceof LiteCampaignError &&
          result.reason.code === "operation_in_progress",
      );
    }
  }
  releaseProvider();
  assert.equal((await first).idempotent, false);

  const replay = await invoke();
  assert.equal(replay.idempotent, true);
  assert.equal(providerCalls, 1);

  record = { ...record, status: "send_uncertain" };
  await assert.rejects(
    transactionReserve,
    (error: unknown) =>
      error instanceof LiteCampaignError && error.code === "operation_uncertain",
  );
  assert.equal(providerCalls, 1);
});

test("metrics day ids roll on Colombo local days", async () => {
  const { metricsDayId } = await import("../src/lite/metrics.js");
  // 2026-08-10T21:33:20Z is already 2026-08-11 03:03 in Colombo (+05:30).
  assert.equal(metricsDayId(1_786_400_000_000), "daily_2026-08-11");
  // 2026-08-10T18:00:00Z is 2026-08-10 23:30 in Colombo — still the 10th.
  assert.equal(metricsDayId(Date.UTC(2026, 7, 10, 18, 0, 0)), "daily_2026-08-10");
});
