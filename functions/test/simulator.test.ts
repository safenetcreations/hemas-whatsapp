import assert from "node:assert/strict";
import test from "node:test";
import {
  generateSyntheticCampaignRecipients,
  summarizeSyntheticCampaign,
} from "../src/simulator/campaign.js";
import { generateSyntheticMessages } from "../src/simulator/messages.js";

test("synthetic messages are deterministic and contain no patient or phone identifiers", () => {
  const options = {
    tenantId: "safenet-demo",
    conversationId: "conversation-demo-1",
    count: 9,
    seed: "deterministic-seed",
    startAt: new Date("2026-08-07T00:00:00.000Z"),
  };
  const first = generateSyntheticMessages(options);
  const second = generateSyntheticMessages(options);
  assert.deepEqual(first, second);
  assert.deepEqual([...new Set(first.map((message) => message.language))].sort(), ["en", "si", "ta"]);
  assert.ok(first.every((message) => message.syntheticContactId.startsWith("synthetic-contact-")));
  assert.ok(first.every((message) => !message.text.includes("+94")));
});

test("50K campaign simulation is deterministic and performs zero network calls", () => {
  const spec = {
    tenantId: "safenet-demo",
    campaignId: "campaign-50000-demo",
    recipientCount: 50_000,
    seed: "campaign-seed-v1",
  };
  const first = summarizeSyntheticCampaign(spec);
  const second = summarizeSyntheticCampaign(spec);
  assert.deepEqual(first, second);
  assert.equal(first.total, 50_000);
  assert.equal(first.eligible, first.accepted + first.failed);
  assert.equal(first.sent, first.accepted);
  assert.equal(first.networkCalls, 0);
  assert.equal(first.simulated, true);
});

test("recipient generation is lazy and synthetic-only", () => {
  const iterator = generateSyntheticCampaignRecipients({
    tenantId: "safenet-demo",
    campaignId: "campaign-demo",
    recipientCount: 10,
    seed: "campaign-seed-v1",
  });
  const first = iterator.next().value;
  assert.ok(first);
  assert.equal(first.simulated, true);
  assert.match(first.syntheticContactId, /^synthetic-contact-/);
});
