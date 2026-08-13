import type { Timestamp } from "firebase/firestore";
import { z } from "zod";

const MAX_DAILY_COUNTER = 1_000_000_000;
const MAX_METRIC_DOCUMENTS = 14;

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  });

const timestamp = z.custom<Timestamp>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof value.toDate === "function",
);

const optionalCounter = z
  .number()
  .int()
  .min(0)
  .max(MAX_DAILY_COUNTER)
  .optional()
  .default(0);

const metricDocumentSchema = z
  .object({
    id: identifier,
    workspaceId: identifier,
    day,
    synthetic: z.literal(true),
    liveCanary: z.literal(true),
    containsMessageContent: z.literal(false),
    schemaVersion: z.literal(1),
    updatedAt: timestamp,
    inboundMessages: optionalCounter,
    botReplies: optionalCounter,
    aiAnswers: optionalCounter,
    aiFailures: optionalCounter,
    bookings: optionalCounter,
    staffHandoffs: optionalCounter,
    agentReplies: optionalCounter,
    campaignSends: optionalCounter,
    apiRequests: optionalCounter,
  })
  .strict();

export const WHATSAPP_COUNTER_FIELDS = [
  "inboundMessages",
  "botReplies",
  "aiAnswers",
  "aiFailures",
  "bookings",
  "staffHandoffs",
  "agentReplies",
  "campaignSends",
  "apiRequests",
] as const;

export type WhatsAppCounterField = (typeof WHATSAPP_COUNTER_FIELDS)[number];

export interface WhatsAppDailyMetric {
  readonly id: string;
  readonly day: string;
  readonly updatedAt: string;
  readonly inboundMessages: number;
  readonly botReplies: number;
  readonly aiAnswers: number;
  readonly aiFailures: number;
  readonly bookings: number;
  readonly staffHandoffs: number;
  readonly agentReplies: number;
  readonly campaignSends: number;
  readonly apiRequests: number;
}

export type WhatsAppMetricTotals = Readonly<Record<WhatsAppCounterField, number>>;

export interface WhatsAppMetricDocumentInput {
  readonly id: string;
  readonly data: unknown;
}

export class WhatsAppMetricsValidationError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_input" | "invalid_data" | "duplicate_day",
  ) {
    super(message);
    this.name = "WhatsAppMetricsValidationError";
  }
}

function parseUpdatedAt(value: Timestamp): string {
  try {
    const parsed = value.toDate();
    if (!(parsed instanceof Date) || !Number.isFinite(parsed.getTime())) {
      throw new Error("Invalid date");
    }
    return parsed.toISOString();
  } catch {
    throw new WhatsAppMetricsValidationError(
      "WhatsApp metric timestamp is invalid.",
      "invalid_data",
    );
  }
}

export function parseWhatsAppMetricDocument(
  value: unknown,
  documentId: string,
  expectedWorkspaceId: string,
): WhatsAppDailyMetric {
  if (
    !identifier.safeParse(documentId).success ||
    !identifier.safeParse(expectedWorkspaceId).success
  ) {
    throw new WhatsAppMetricsValidationError(
      "WhatsApp metric path input is invalid.",
      "invalid_input",
    );
  }

  const result = metricDocumentSchema.safeParse(value);
  if (!result.success) {
    throw new WhatsAppMetricsValidationError(
      "WhatsApp metric failed exact schema validation.",
      "invalid_data",
    );
  }

  const parsed = result.data;
  if (
    parsed.id !== documentId ||
    parsed.id !== `daily_${parsed.day}` ||
    parsed.workspaceId !== expectedWorkspaceId
  ) {
    throw new WhatsAppMetricsValidationError(
      "WhatsApp metric identity does not match its tenant path.",
      "invalid_data",
    );
  }

  return {
    id: parsed.id,
    day: parsed.day,
    updatedAt: parseUpdatedAt(parsed.updatedAt),
    inboundMessages: parsed.inboundMessages,
    botReplies: parsed.botReplies,
    aiAnswers: parsed.aiAnswers,
    aiFailures: parsed.aiFailures,
    bookings: parsed.bookings,
    staffHandoffs: parsed.staffHandoffs,
    agentReplies: parsed.agentReplies,
    campaignSends: parsed.campaignSends,
    apiRequests: parsed.apiRequests,
  };
}

export function parseWhatsAppMetricDocuments(
  records: readonly WhatsAppMetricDocumentInput[],
  expectedWorkspaceId: string,
): readonly WhatsAppDailyMetric[] {
  if (records.length > MAX_METRIC_DOCUMENTS) {
    throw new WhatsAppMetricsValidationError(
      "WhatsApp metric query exceeded its 14-document boundary.",
      "invalid_input",
    );
  }

  const rows = records.map((record) =>
    parseWhatsAppMetricDocument(record.data, record.id, expectedWorkspaceId),
  );
  const uniqueDays = new Set(rows.map((row) => row.day));
  if (uniqueDays.size !== rows.length) {
    throw new WhatsAppMetricsValidationError(
      "WhatsApp metric query returned duplicate days.",
      "duplicate_day",
    );
  }

  return [...rows].sort((left, right) => right.day.localeCompare(left.day));
}

export function aggregateWhatsAppMetrics(
  rows: readonly WhatsAppDailyMetric[],
): WhatsAppMetricTotals {
  const totals: Record<WhatsAppCounterField, number> = {
    inboundMessages: 0,
    botReplies: 0,
    aiAnswers: 0,
    aiFailures: 0,
    bookings: 0,
    staffHandoffs: 0,
    agentReplies: 0,
    campaignSends: 0,
    apiRequests: 0,
  };

  for (const row of rows) {
    for (const field of WHATSAPP_COUNTER_FIELDS) {
      const next = totals[field] + row[field];
      if (!Number.isSafeInteger(next)) {
        throw new WhatsAppMetricsValidationError(
          "WhatsApp metric aggregate exceeded the safe integer boundary.",
          "invalid_data",
        );
      }
      totals[field] = next;
    }
  }

  return totals;
}

const CSV_HEADER = [
  "day",
  "inbound_messages",
  "bot_replies",
  "ai_answers",
  "ai_failures",
  "bookings",
  "staff_handoffs",
  "agent_replies",
  "campaign_sends",
  "governed_actions",
].join(",");

export function buildWhatsAppMetricsCsv(rows: readonly WhatsAppDailyMetric[]): string {
  const chronologicalRows = [...rows].sort((left, right) => left.day.localeCompare(right.day));
  return [
    CSV_HEADER,
    ...chronologicalRows.map((row) =>
      [
        row.day,
        row.inboundMessages,
        row.botReplies,
        row.aiAnswers,
        row.aiFailures,
        row.bookings,
        row.staffHandoffs,
        row.agentReplies,
        row.campaignSends,
        row.apiRequests,
      ].join(","),
    ),
  ].join("\r\n");
}
