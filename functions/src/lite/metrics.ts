/**
 * Live usage metrics — content-free daily counters (Phase 4 backend).
 *
 * One document per Colombo day under the demo workspace:
 *   workspaces/{ws}/canary_metrics/daily_YYYY-MM-DD
 *
 * Counters only — no identifiers, no bodies, no per-visitor data. These feed
 * the Analytics page and the governed-action demo allowance. The legacy
 * `apiRequests` field name is retained for schema compatibility; it does not
 * represent raw network or provider request volume.
 */

import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";

export const METRICS_COLLECTION = "canary_metrics";

const COLOMBO_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export type MetricField =
  | "inboundMessages"
  | "botReplies"
  | "aiAnswers"
  | "aiFailures"
  | "bookings"
  | "staffHandoffs"
  | "agentReplies"
  | "campaignSends"
  | "apiRequests";

export interface DailyMetricIncrement {
  readonly id: string;
  readonly data: Record<string, unknown>;
}

/** Colombo-local day id for a timestamp, e.g. "daily_2026-08-11". */
export function metricsDayId(nowMs: number): string {
  const d = new Date(nowMs + COLOMBO_OFFSET_MS);
  const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
  return `daily_${iso}`;
}

/** Build one merge-safe increment for inclusion in a domain transaction/batch. */
export function buildDailyMetricIncrement(
  workspaceId: string,
  nowMs: number,
  fields: Partial<Record<MetricField, number>>,
): DailyMetricIncrement | null {
  const entries = Object.entries(fields).filter(
    (entry): entry is [MetricField, number] =>
      typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] > 0,
  );
  if (entries.length === 0) return null;
  const id = metricsDayId(nowMs);
  const increments: Record<string, unknown> = {};
  let total = 0;
  for (const [field, amount] of entries) {
    increments[field] = FieldValue.increment(amount);
    if (field !== "apiRequests") total += amount;
  }
  if (!("apiRequests" in increments) && total > 0) {
    increments.apiRequests = FieldValue.increment(total);
  }
  return {
    id,
    data: {
      id,
      workspaceId,
      day: id.replace(/^daily_/, ""),
      synthetic: true,
      liveCanary: true,
      containsMessageContent: false,
      schemaVersion: 1,
      updatedAt: Timestamp.fromMillis(nowMs),
      ...increments,
    },
  };
}

/**
 * Increment daily counters (fire-and-forget safe: never throws).
 * The legacy `apiRequests` counter is bumped automatically by the sum of all
 * other business-event increments unless explicitly provided.
 */
export async function bumpDailyMetrics(
  db: Firestore,
  workspaceId: string,
  nowMs: number,
  fields: Partial<Record<MetricField, number>>,
): Promise<void> {
  try {
    const increment = buildDailyMetricIncrement(workspaceId, nowMs, fields);
    if (!increment) return;
    await db
      .collection("workspaces").doc(workspaceId)
      .collection(METRICS_COLLECTION).doc(increment.id)
      .set(increment.data, { merge: true });
  } catch {
    // Metrics never break the message path.
  }
}
