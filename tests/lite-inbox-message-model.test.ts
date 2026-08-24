import { readFileSync } from "node:fs";
import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";
import {
  buildLiteProtectedAuthorityFingerprint,
  LITE_PROTECTED_REAUTHORIZE_INTERVAL_MS,
  parseLiteMessageDocument,
  parseLiteProtectedMessagesResponse,
} from "@/components/lite/lite-data";

const at = (iso: string) => Timestamp.fromDate(new Date(iso));

describe("Lite inbox protected message projection", () => {
  it("renders the strongest persisted delivery evidence and governed AI provenance", () => {
    const message = parseLiteMessageDocument("message_safe", {
      conversationId: "conversation_safe",
      direction: "outbound",
      type: "text",
      status: "sent",
      automationSource: "governed_ai",
      createdAt: at("2026-08-21T09:00:00.000Z"),
      sentAt: at("2026-08-21T09:00:01.000Z"),
      deliveredAt: at("2026-08-21T09:00:02.000Z"),
      readAt: at("2026-08-21T09:00:03.000Z"),
      deliveryUpdatedAt: at("2026-08-21T09:00:04.000Z"),
    });

    expect(message).toMatchObject({
      id: "message_safe",
      direction: "outbound",
      status: "read",
      automationSource: "governed_ai",
      createdAtMs: Date.parse("2026-08-21T09:00:00.000Z"),
      sentAtMs: Date.parse("2026-08-21T09:00:01.000Z"),
      deliveredAtMs: Date.parse("2026-08-21T09:00:02.000Z"),
      readAtMs: Date.parse("2026-08-21T09:00:03.000Z"),
      deliveryUpdatedAtMs: Date.parse("2026-08-21T09:00:04.000Z"),
    });
  });

  it("keeps legacy agent and inbound records accurate without inventing bot provenance", () => {
    const agent = parseLiteMessageDocument("message_agent", {
      conversationId: "conversation_safe",
      direction: "outbound",
      status: "sent",
      agentReply: true,
      sentAt: at("2026-08-21T09:01:00.000Z"),
    });
    const inbound = parseLiteMessageDocument("message_inbound", {
      conversationId: "conversation_safe",
      direction: "inbound",
      status: "unexpected-provider-value",
      createdAt: at("2026-08-21T09:02:00.000Z"),
    });
    const legacyAutomation = parseLiteMessageDocument("message_legacy", {
      conversationId: "conversation_safe",
      direction: "outbound",
      status: "sent",
    });

    expect(agent.automationSource).toBe("agent");
    expect(agent.status).toBe("sent");
    expect(inbound.status).toBe("received");
    expect(inbound.automationSource).toBeNull();
    expect(legacyAutomation.automationSource).toBeNull();
  });

  it("fails safe for unknown status/source and drops sensitive or content fields", () => {
    const message = parseLiteMessageDocument("message_safe", {
      conversationId: "conversation_safe",
      direction: "outbound",
      status: "provider-internal-state",
      automationSource: "unreviewed_model",
      providerMessageId: "secret-provider-id",
      recipientPhone: "+94000000000",
      type: "private-secret",
      body: "private message body",
      accessToken: "private-secret",
    });

    expect(message.status).toBe("pending");
    expect(message.type).toBe("other");
    expect(message.automationSource).toBeNull();
    expect(message).not.toHaveProperty("providerMessageId");
    expect(message).not.toHaveProperty("recipientPhone");
    expect(message).not.toHaveProperty("body");
    expect(message).not.toHaveProperty("accessToken");
    expect(JSON.stringify(message)).not.toMatch(/secret-provider-id|private message body|private-secret/);
  });

  it("accepts only the exact requested protected text projection", () => {
    const text = "  Appointment confirmed\nකරුණාකර MENU යවන්න  ";
    const projection = parseLiteProtectedMessagesResponse(
      {
        messages: [{ messageId: "message_live_0123456789abcdef", text }],
      },
      ["message_live_0123456789abcdef"],
    );

    expect(projection).toEqual([
      { messageId: "message_live_0123456789abcdef", text },
    ]);
    expect(projection[0]?.text).toBe(text);
  });

  it("rejects polluted protected-content projections", () => {
    const requested = ["message_live_0123456789abcdef"];
    const safeRow = {
      messageId: requested[0],
      text: "Protected text",
    };
    const inheritedPollution = Object.assign(
      Object.create({ providerMessageId: "secret-provider-id" }),
      { messages: [safeRow] },
    );

    expect(() =>
      parseLiteProtectedMessagesResponse(
        { messages: [{ ...safeRow, recipientPhone: "+94000000000" }] },
        requested,
      ),
    ).toThrow("Protected message response is invalid.");
    expect(() =>
      parseLiteProtectedMessagesResponse(
        { messages: [safeRow], providerMessageId: "secret-provider-id" },
        requested,
      ),
    ).toThrow("Protected message response is invalid.");
    expect(() =>
      parseLiteProtectedMessagesResponse(inheritedPollution, requested),
    ).toThrow("Protected message response is invalid.");
  });

  it("rejects oversized text, invalid IDs, and unrequested records", () => {
    const requested = ["message_live_0123456789abcdef"];

    expect(() =>
      parseLiteProtectedMessagesResponse(
        { messages: [{ messageId: requested[0], text: "x".repeat(4_097) }] },
        requested,
      ),
    ).toThrow("Protected message response is invalid.");
    expect(() =>
      parseLiteProtectedMessagesResponse(
        { messages: [{ messageId: "../provider-secret", text: "No" }] },
        requested,
      ),
    ).toThrow("Protected message response is invalid.");
    expect(() =>
      parseLiteProtectedMessagesResponse(
        { messages: [{ messageId: "message_live_fedcba9876543210", text: "No" }] },
        requested,
      ),
    ).toThrow("Protected message response is invalid.");
    expect(() =>
      parseLiteProtectedMessagesResponse({ messages: [] }, ["bad/id"]),
    ).toThrow("Protected message request is invalid.");
  });

  it("changes the protected-text authority fingerprint for every access boundary", () => {
    const base = {
      userId: "agent-a",
      emailVerified: true,
      memberRole: "agent",
      conversationId: "conversation-live-a",
      assigneeId: "agent-a",
      liveCanary: true,
      synthetic: true,
    };
    const fingerprint = buildLiteProtectedAuthorityFingerprint(base);

    expect(fingerprint).not.toBeNull();
    expect(buildLiteProtectedAuthorityFingerprint({ ...base, userId: "agent-b" })).not.toBe(
      fingerprint,
    );
    expect(
      buildLiteProtectedAuthorityFingerprint({ ...base, memberRole: "supervisor" }),
    ).not.toBe(fingerprint);
    expect(
      buildLiteProtectedAuthorityFingerprint({
        ...base,
        conversationId: "conversation-live-b",
      }),
    ).not.toBe(fingerprint);
    expect(
      buildLiteProtectedAuthorityFingerprint({ ...base, assigneeId: "agent-b" }),
    ).not.toBe(fingerprint);
    expect(
      buildLiteProtectedAuthorityFingerprint({ ...base, assigneeId: null }),
    ).not.toBe(fingerprint);
    expect(
      buildLiteProtectedAuthorityFingerprint({ ...base, memberRole: null }),
    ).toBeNull();
    expect(
      buildLiteProtectedAuthorityFingerprint({ ...base, emailVerified: false }),
    ).toBeNull();
    expect(
      buildLiteProtectedAuthorityFingerprint({ ...base, liveCanary: false }),
    ).toBeNull();
    expect(
      buildLiteProtectedAuthorityFingerprint({ ...base, synthetic: false }),
    ).toBeNull();
  });

  it("bounds protected-text reauthorization to thirty seconds", () => {
    expect(LITE_PROTECTED_REAUTHORIZE_INTERVAL_MS).toBe(30_000);
  });

  it("renders protected text without referencing provider IDs or masked phones", () => {
    const source = readFileSync(
      new URL("../app/lite/inbox/page.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("Governed AI reply");
    expect(source).toContain("Menu bot reply");
    expect(source).toContain("Status observed");
    expect(source).toContain("{protectedText}");
    expect(source).toContain("Content was not retained for this earlier message");
    expect(source).not.toContain("body never stored");
    expect(source).not.toContain("providerMessageId");
    expect(source).not.toContain("maskedPhone");
    expect(source).toContain("buildLiteProtectedAuthorityFingerprint");

    const dataSource = readFileSync(
      new URL("../components/lite/lite-data.ts", import.meta.url),
      "utf8",
    );
    expect(dataSource).toContain('httpsCallable(liteFunctions(), "liteListProtectedMessages"');
    expect(dataSource).toContain("LITE_PROTECTED_REAUTHORIZE_INTERVAL_MS");
    expect(dataSource).toContain('document.addEventListener("visibilitychange"');
    expect(dataSource).not.toContain('"protectedMessageContents"');
  });
});
