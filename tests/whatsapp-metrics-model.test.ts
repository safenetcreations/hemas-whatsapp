import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";
import {
  aggregateWhatsAppMetrics,
  buildWhatsAppMetricsCsv,
  parseWhatsAppMetricDocument,
  parseWhatsAppMetricDocuments,
  WhatsAppMetricsValidationError,
  type WhatsAppDailyMetric,
} from "@/components/analytics/whatsapp-metrics-model";

const workspaceId = "workspace_safenet_demo";

function metricDocument(
  day: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: `daily_${day}`,
    workspaceId,
    day,
    synthetic: true,
    liveCanary: true,
    containsMessageContent: false,
    schemaVersion: 1,
    updatedAt: Timestamp.fromDate(new Date(`${day}T09:30:00.000Z`)),
    inboundMessages: 12,
    botReplies: 9,
    aiAnswers: 4,
    aiFailures: 1,
    bookings: 2,
    staffHandoffs: 3,
    agentReplies: 5,
    campaignSends: 7,
    apiRequests: 43,
    ...overrides,
  };
}

function parsedMetric(day: string, overrides: Partial<WhatsAppDailyMetric> = {}) {
  return {
    id: `daily_${day}`,
    day,
    updatedAt: `${day}T09:30:00.000Z`,
    inboundMessages: 12,
    botReplies: 9,
    aiAnswers: 4,
    aiFailures: 1,
    bookings: 2,
    staffHandoffs: 3,
    agentReplies: 5,
    campaignSends: 7,
    apiRequests: 43,
    ...overrides,
  } satisfies WhatsAppDailyMetric;
}

describe("automatic WhatsApp metric parsing", () => {
  it("accepts the exact content-free v1 writer contract and defaults absent counters to zero", () => {
    const value = metricDocument("2026-08-11");
    delete value.aiFailures;
    delete value.campaignSends;

    const parsed = parseWhatsAppMetricDocument(
      value,
      "daily_2026-08-11",
      workspaceId,
    );

    expect(parsed).toMatchObject({
      id: "daily_2026-08-11",
      day: "2026-08-11",
      aiFailures: 0,
      campaignSends: 0,
      inboundMessages: 12,
    });
    expect(parsed).not.toHaveProperty("workspaceId");
    expect(parsed).not.toHaveProperty("containsMessageContent");
  });

  it.each([
    metricDocument("2026-08-11", { inboundMessages: -1 }),
    metricDocument("2026-08-11", { botReplies: 1.5 }),
    metricDocument("2026-08-11", { bookings: "2" }),
    metricDocument("2026-08-11", { apiRequests: 1_000_000_001 }),
    metricDocument("2026-02-30"),
    metricDocument("2026-08-11", { containsMessageContent: true }),
    metricDocument("2026-08-11", { synthetic: false }),
    metricDocument("2026-08-11", { schemaVersion: 2 }),
    metricDocument("2026-08-11", { workspaceId: "workspace_other" }),
    metricDocument("2026-08-11", { id: "daily_2026-08-10" }),
    metricDocument("2026-08-11", { updatedAt: new Date("2026-08-11") }),
    metricDocument("2026-08-11", { messageBody: "must never enter analytics" }),
  ])("fails closed for malformed, cross-tenant or schema-polluted documents", (value) => {
    expect(() =>
      parseWhatsAppMetricDocument(value, "daily_2026-08-11", workspaceId),
    ).toThrowError(expect.objectContaining<Partial<WhatsAppMetricsValidationError>>({
      code: "invalid_data",
    }));
  });

  it("sorts verified rows newest-first and rejects duplicate days or unbounded results", () => {
    const rows = parseWhatsAppMetricDocuments(
      ["2026-08-09", "2026-08-11", "2026-08-10"].map((value) => ({
        id: `daily_${value}`,
        data: metricDocument(value),
      })),
      workspaceId,
    );
    expect(rows.map((row) => row.day)).toEqual([
      "2026-08-11",
      "2026-08-10",
      "2026-08-09",
    ]);

    expect(() =>
      parseWhatsAppMetricDocuments(
        [
          { id: "daily_2026-08-11", data: metricDocument("2026-08-11") },
          { id: "daily_2026-08-11", data: metricDocument("2026-08-11") },
        ],
        workspaceId,
      ),
    ).toThrowError(expect.objectContaining({ code: "duplicate_day" }));

    const unbounded = Array.from({ length: 15 }, (_, index) => {
      const value = `2026-07-${String(index + 1).padStart(2, "0")}`;
      return { id: `daily_${value}`, data: metricDocument(value) };
    });
    expect(() => parseWhatsAppMetricDocuments(unbounded, workspaceId)).toThrowError(
      expect.objectContaining({ code: "invalid_input" }),
    );
  });
});

describe("WhatsApp aggregate calculations and export", () => {
  it("adds each content-free counter across the verified window", () => {
    const totals = aggregateWhatsAppMetrics([
      parsedMetric("2026-08-10"),
      parsedMetric("2026-08-11", {
        inboundMessages: 8,
        botReplies: 6,
        bookings: 1,
        apiRequests: 30,
      }),
    ]);

    expect(totals).toEqual({
      inboundMessages: 20,
      botReplies: 15,
      aiAnswers: 8,
      aiFailures: 2,
      bookings: 3,
      staffHandoffs: 6,
      agentReplies: 10,
      campaignSends: 14,
      apiRequests: 73,
    });
  });

  it("exports chronological aggregate numbers without document, tenant or content fields", () => {
    const csv = buildWhatsAppMetricsCsv([
      parsedMetric("2026-08-11"),
      parsedMetric("2026-08-10", { inboundMessages: 3, bookings: 0 }),
    ]);

    expect(csv.split("\r\n")).toEqual([
      "day,inbound_messages,bot_replies,ai_answers,ai_failures,bookings,staff_handoffs,agent_replies,campaign_sends,governed_actions",
      "2026-08-10,3,9,4,1,0,3,5,7,43",
      "2026-08-11,12,9,4,1,2,3,5,7,43",
    ]);
    expect(csv).not.toContain("workspace_safenet_demo");
    expect(csv).not.toContain("daily_");
    expect(csv).not.toContain("messageBody");
    expect(csv).not.toContain("updatedAt");
  });
});
