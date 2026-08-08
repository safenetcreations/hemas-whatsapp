import type {
  ConnectionId,
  DailyMetricId,
  ISODate,
  ISODateTime,
  UsageLedgerId,
  WorkspaceScopedEntity,
} from "./primitives";

export type UsageType =
  | "inbound_message"
  | "outbound_message"
  | "template_send"
  | "ai_request"
  | "ai_model_unit"
  | "storage_byte"
  | "flow_session"
  | "queue_job";

export interface UsageLedgerEntry extends WorkspaceScopedEntity<UsageLedgerId> {
  readonly connectionId: ConnectionId | null;
  readonly type: UsageType;
  readonly quantity: number;
  readonly unit: "count" | "token" | "byte" | "job";
  readonly provider: "simulator" | "meta" | "firebase" | "google_cloud" | "ai_provider";
  readonly referenceType: string;
  readonly referenceId: string;
  readonly occurredAt: ISODateTime;
  readonly synthetic: boolean;
}

export type MetricDimension =
  | "message"
  | "conversation"
  | "agent"
  | "flow"
  | "appointment"
  | "campaign"
  | "automation";

export interface DailyMetric extends WorkspaceScopedEntity<DailyMetricId> {
  readonly date: ISODate;
  readonly metricVersion: string;
  readonly dimension: MetricDimension;
  readonly counts: Readonly<Record<string, number>>;
  readonly sampleData: boolean;
}

export function sumUsage(
  entries: readonly UsageLedgerEntry[],
  type: UsageType,
): number {
  return entries
    .filter((entry) => entry.type === type)
    .reduce((sum, entry) => sum + entry.quantity, 0);
}

