import assert from "node:assert/strict";
import test from "node:test";
import { sha256Hex } from "../src/deterministic.js";
import { BRIDGE_WORKSPACE_ID, liveIds } from "../src/meta-bot/bridge.js";
import { parseRecipientAllowlist } from "../src/meta-canary/contracts.js";
import {
  LITE_SEATS,
  LITE_WORKSPACE_ID,
  LiteError,
  assertLiteAction,
  assertValidReplyText,
  buildAgentReplyBody,
  buildLiteMemberDocument,
  liveConversationKey,
  resolveAllowlistedWaId,
} from "../src/lite/contracts.js";

test("lite workspace matches the bridge workspace", () => {
  assert.equal(LITE_WORKSPACE_ID, BRIDGE_WORKSPACE_ID);
});

test("seats are synthetic-only identities with valid roles", () => {
  assert.equal(LITE_SEATS.length, 3);
  for (const seat of LITE_SEATS) {
    assert.ok(seat.email.endsWith("@lite.synthetic.invalid"), seat.email);
    assert.ok(["agent", "supervisor"].includes(seat.role));
    assert.ok(seat.password.length >= 12);
    assert.ok(seat.displayLabel.includes("synthetic"));
  }
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

test("reply text validation strips control chars and bounds length", () => {
  assert.equal(assertValidReplyText("  hello there  "), "hello there");
  assert.throws(() => assertValidReplyText(""), LiteError);
  assert.throws(() => assertValidReplyText(undefined), LiteError);
  assert.throws(() => assertValidReplyText("x".repeat(1025)), LiteError);
  assert.equal(assertValidReplyText("සුබ දවසක්! நன்றி"), "සුබ දවසක්! நன்றி");
});

test("live conversation key extraction rejects foreign ids", () => {
  const { conversationId, key } = liveIds("94705667755");
  assert.equal(liveConversationKey(conversationId), key);
  assert.throws(() => liveConversationKey("conversation_demo_123"), LiteError);
  assert.throws(() => liveConversationKey("conversation_live_ZZZ"), LiteError);
  assert.throws(() => liveConversationKey(42), LiteError);
});

test("allowlist routing recovers the number only for allowlisted visitors", () => {
  const allowlist = parseRecipientAllowlist("+94705667755,+94777123456");
  const { key } = liveIds("94705667755");
  assert.equal(resolveAllowlistedWaId(key, allowlist, sha256Hex), "94705667755");

  const stranger = liveIds("94711111111");
  assert.equal(resolveAllowlistedWaId(stranger.key, allowlist, sha256Hex), null);
});

test("agent reply body is a plain WhatsApp text payload", () => {
  assert.deepEqual(buildAgentReplyBody("On the way!"), {
    type: "text",
    text: { preview_url: false, body: "On the way!" },
  });
});

test("claim actions are strictly claim or release", () => {
  assert.equal(assertLiteAction("claim"), "claim");
  assert.equal(assertLiteAction("release"), "release");
  assert.throws(() => assertLiteAction("assign"), LiteError);
  assert.throws(() => assertLiteAction(null), LiteError);
});

test("campaign contracts: names, templates, ids, status ordering", async () => {
  const {
    LiteCampaignError,
    assertTemplateSelection,
    assertValidCampaignName,
    campaignId,
    extractDeliveryStatusEvents,
    sendDocIdForWamid,
    shouldAdvanceSendStatus,
  } = await import("../src/lite/campaigns.js");

  assert.equal(assertValidCampaignName("  OPD  reminder (Aug) "), "OPD reminder (Aug)");
  assert.throws(() => assertValidCampaignName("ab"), LiteCampaignError);
  assert.throws(() => assertValidCampaignName("<script>"), LiteCampaignError);

  assert.deepEqual(assertTemplateSelection(undefined, undefined, "hello_world", "en_US"), {
    templateName: "hello_world",
    languageCode: "en_US",
  });
  assert.deepEqual(assertTemplateSelection("hemas_canary_hello", "en_US", "x", "y"), {
    templateName: "hemas_canary_hello",
    languageCode: "en_US",
  });
  assert.throws(() => assertTemplateSelection("Bad Name!", "en_US", "x", "en_US"), LiteCampaignError);

  assert.equal(campaignId("A", 1, sha256Hex), campaignId("A", 1, sha256Hex));
  assert.notEqual(campaignId("A", 1, sha256Hex), campaignId("A", 2, sha256Hex));
  assert.match(sendDocIdForWamid("wamid.X", sha256Hex), /^send_[0-9a-f]{32}$/);

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

test("metrics day ids roll on Colombo local days", async () => {
  const { metricsDayId } = await import("../src/lite/metrics.js");
  // 2026-08-10T21:33:20Z is already 2026-08-11 03:03 in Colombo (+05:30).
  assert.equal(metricsDayId(1_786_400_000_000), "daily_2026-08-11");
  // 2026-08-10T18:00:00Z is 2026-08-10 23:30 in Colombo — still the 10th.
  assert.equal(metricsDayId(Date.UTC(2026, 7, 10, 18, 0, 0)), "daily_2026-08-10");
});
