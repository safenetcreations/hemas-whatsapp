export type SampleDateRange = "7d" | "14d" | "30d";
export type SampleJourney = "appointment" | "laboratory" | "general" | "campaign";
export type SampleLocation = "wattala" | "thalawathugoda" | "lab_network";
export type SampleLanguage = "en" | "si" | "ta";

export interface DimensionFilters {
  readonly dateRange: SampleDateRange;
  readonly journey: "all" | SampleJourney;
  readonly location: "all" | SampleLocation;
  readonly language: "all" | SampleLanguage;
}

export const DEFAULT_DIMENSION_FILTERS: DimensionFilters = {
  dateRange: "7d",
  journey: "all",
  location: "all",
  language: "all",
};

export interface AnalyticsSampleRow {
  readonly id: string;
  readonly date: string;
  readonly journey: SampleJourney;
  readonly location: SampleLocation;
  readonly language: SampleLanguage;
  readonly entered: number;
  readonly automationEligible: number;
  readonly routed: number;
  readonly completed: number;
  readonly handoffs: number;
  readonly safetyBlocks: number;
  readonly urgentEscalations: number;
  readonly responseSeconds: number;
}

export type UsageChannel =
  | "simulator_inbox"
  | "campaign_simulator"
  | "local_workflow"
  | "safety_harness";

export type UsageEvent =
  | "inbound_event"
  | "queue_job"
  | "workflow_step"
  | "safety_review"
  | "flow_session"
  | "audit_event";

export interface UsageSampleRow {
  readonly id: string;
  readonly date: string;
  readonly journey: SampleJourney;
  readonly location: SampleLocation;
  readonly language: SampleLanguage;
  readonly channel: UsageChannel;
  readonly functionLabel: string;
  readonly event: UsageEvent;
  readonly count: number;
  readonly unit: "events" | "jobs" | "steps" | "reviews" | "sessions";
  readonly costLowLkr: number;
  readonly costHighLkr: number;
}

export const SAMPLE_AS_OF_DATE = "2026-08-07";
export const SAMPLE_AGGREGATION_VERSION = "synthetic-aggregate-v1";
export const PRIVACY_COHORT_THRESHOLD = 20;

export const JOURNEY_LABELS: Readonly<Record<SampleJourney, string>> = {
  appointment: "Appointment enquiry",
  laboratory: "Laboratory journey",
  general: "General enquiry",
  campaign: "Campaign simulation",
};

export const LOCATION_LABELS: Readonly<Record<SampleLocation, string>> = {
  wattala: "Wattala",
  thalawathugoda: "Thalawathugoda",
  lab_network: "Nationwide lab network",
};

export const LANGUAGE_LABELS: Readonly<Record<SampleLanguage, string>> = {
  en: "English",
  si: "සිංහල",
  ta: "தமிழ்",
};

export const CHANNEL_LABELS: Readonly<Record<UsageChannel, string>> = {
  simulator_inbox: "Simulator inbox",
  campaign_simulator: "Campaign simulator",
  local_workflow: "Local workflow",
  safety_harness: "Safety harness",
};

export const EVENT_LABELS: Readonly<Record<UsageEvent, string>> = {
  inbound_event: "Inbound event",
  queue_job: "Queue job",
  workflow_step: "Workflow step",
  safety_review: "Safety review",
  flow_session: "Flow session",
  audit_event: "Audit event",
};

export const ANALYTICS_SAMPLE_ROWS: readonly AnalyticsSampleRow[] = [
  { id: "agg-001", date: "2026-07-10", journey: "appointment", location: "wattala", language: "en", entered: 420, automationEligible: 350, routed: 330, completed: 289, handoffs: 71, safetyBlocks: 10, urgentEscalations: 2, responseSeconds: 132 },
  { id: "agg-002", date: "2026-07-14", journey: "laboratory", location: "lab_network", language: "ta", entered: 380, automationEligible: 310, routed: 296, completed: 251, handoffs: 62, safetyBlocks: 9, urgentEscalations: 3, responseSeconds: 145 },
  { id: "agg-003", date: "2026-07-18", journey: "general", location: "thalawathugoda", language: "si", entered: 460, automationEligible: 360, routed: 338, completed: 267, handoffs: 95, safetyBlocks: 16, urgentEscalations: 4, responseSeconds: 161 },
  { id: "agg-004", date: "2026-07-20", journey: "laboratory", location: "lab_network", language: "en", entered: 410, automationEligible: 342, routed: 323, completed: 276, handoffs: 68, safetyBlocks: 8, urgentEscalations: 2, responseSeconds: 137 },
  { id: "agg-005", date: "2026-07-22", journey: "campaign", location: "lab_network", language: "en", entered: 900, automationEligible: 782, routed: 741, completed: 604, handoffs: 98, safetyBlocks: 24, urgentEscalations: 1, responseSeconds: 118 },
  { id: "agg-006", date: "2026-07-25", journey: "appointment", location: "thalawathugoda", language: "ta", entered: 510, automationEligible: 421, routed: 399, completed: 344, handoffs: 83, safetyBlocks: 14, urgentEscalations: 3, responseSeconds: 139 },
  { id: "agg-007", date: "2026-07-28", journey: "laboratory", location: "wattala", language: "si", entered: 430, automationEligible: 352, routed: 329, completed: 282, handoffs: 72, safetyBlocks: 12, urgentEscalations: 2, responseSeconds: 151 },
  { id: "agg-008", date: "2026-07-30", journey: "general", location: "wattala", language: "ta", entered: 475, automationEligible: 369, routed: 346, completed: 269, handoffs: 109, safetyBlocks: 21, urgentEscalations: 7, responseSeconds: 179 },
  { id: "agg-009", date: "2026-08-01", journey: "general", location: "lab_network", language: "en", entered: 620, automationEligible: 490, routed: 455, completed: 359, handoffs: 128, safetyBlocks: 23, urgentEscalations: 8, responseSeconds: 176 },
  { id: "agg-010", date: "2026-08-02", journey: "appointment", location: "wattala", language: "ta", entered: 585, automationEligible: 492, routed: 468, completed: 411, handoffs: 89, safetyBlocks: 13, urgentEscalations: 4, responseSeconds: 124 },
  { id: "agg-011", date: "2026-08-03", journey: "laboratory", location: "thalawathugoda", language: "en", entered: 540, automationEligible: 459, routed: 431, completed: 374, handoffs: 81, safetyBlocks: 11, urgentEscalations: 2, responseSeconds: 116 },
  { id: "agg-012", date: "2026-08-04", journey: "campaign", location: "wattala", language: "si", entered: 1200, automationEligible: 1040, routed: 1008, completed: 856, handoffs: 132, safetyBlocks: 31, urgentEscalations: 2, responseSeconds: 101 },
  { id: "agg-013", date: "2026-08-05", journey: "appointment", location: "lab_network", language: "si", entered: 660, automationEligible: 552, routed: 526, completed: 459, handoffs: 107, safetyBlocks: 18, urgentEscalations: 5, responseSeconds: 129 },
  { id: "agg-014", date: "2026-08-05", journey: "general", location: "thalawathugoda", language: "ta", entered: 590, automationEligible: 455, routed: 423, completed: 322, handoffs: 139, safetyBlocks: 27, urgentEscalations: 9, responseSeconds: 188 },
  { id: "agg-015", date: "2026-08-06", journey: "laboratory", location: "lab_network", language: "ta", entered: 720, automationEligible: 607, routed: 578, completed: 501, handoffs: 112, safetyBlocks: 16, urgentEscalations: 4, responseSeconds: 121 },
  { id: "agg-016", date: "2026-08-06", journey: "appointment", location: "thalawathugoda", language: "en", entered: 645, automationEligible: 548, routed: 520, completed: 456, handoffs: 94, safetyBlocks: 12, urgentEscalations: 3, responseSeconds: 115 },
  { id: "agg-017", date: "2026-08-07", journey: "campaign", location: "lab_network", language: "ta", entered: 1500, automationEligible: 1293, routed: 1248, completed: 1065, handoffs: 171, safetyBlocks: 39, urgentEscalations: 3, responseSeconds: 98 },
  { id: "agg-018", date: "2026-08-07", journey: "general", location: "wattala", language: "si", entered: 710, automationEligible: 553, routed: 521, completed: 403, handoffs: 166, safetyBlocks: 32, urgentEscalations: 10, responseSeconds: 183 },
];

export const USAGE_SAMPLE_ROWS: readonly UsageSampleRow[] = [
  { id: "use-001", date: "2026-07-10", journey: "appointment", location: "wattala", language: "en", channel: "simulator_inbox", functionLabel: "Intent routing", event: "inbound_event", count: 420, unit: "events", costLowLkr: 36, costHighLkr: 64 },
  { id: "use-002", date: "2026-07-14", journey: "laboratory", location: "lab_network", language: "ta", channel: "local_workflow", functionLabel: "Report-ready handoff", event: "workflow_step", count: 296, unit: "steps", costLowLkr: 24, costHighLkr: 42 },
  { id: "use-003", date: "2026-07-18", journey: "general", location: "thalawathugoda", language: "si", channel: "safety_harness", functionLabel: "Safety classification", event: "safety_review", count: 460, unit: "reviews", costLowLkr: 54, costHighLkr: 91 },
  { id: "use-004", date: "2026-07-22", journey: "campaign", location: "lab_network", language: "en", channel: "campaign_simulator", functionLabel: "Audience preflight", event: "queue_job", count: 9000, unit: "jobs", costLowLkr: 82, costHighLkr: 138 },
  { id: "use-005", date: "2026-07-25", journey: "appointment", location: "thalawathugoda", language: "ta", channel: "local_workflow", functionLabel: "Appointment confirmation", event: "flow_session", count: 421, unit: "sessions", costLowLkr: 41, costHighLkr: 69 },
  { id: "use-006", date: "2026-07-28", journey: "laboratory", location: "wattala", language: "si", channel: "simulator_inbox", functionLabel: "Human routing", event: "audit_event", count: 72, unit: "events", costLowLkr: 8, costHighLkr: 14 },
  { id: "use-007", date: "2026-07-30", journey: "general", location: "wattala", language: "ta", channel: "safety_harness", functionLabel: "Urgent-language review", event: "safety_review", count: 130, unit: "reviews", costLowLkr: 18, costHighLkr: 31 },
  { id: "use-008", date: "2026-08-01", journey: "general", location: "lab_network", language: "en", channel: "simulator_inbox", functionLabel: "Intent routing", event: "inbound_event", count: 620, unit: "events", costLowLkr: 49, costHighLkr: 81 },
  { id: "use-009", date: "2026-08-02", journey: "appointment", location: "wattala", language: "ta", channel: "local_workflow", functionLabel: "Booking flow", event: "flow_session", count: 492, unit: "sessions", costLowLkr: 46, costHighLkr: 78 },
  { id: "use-010", date: "2026-08-03", journey: "laboratory", location: "thalawathugoda", language: "en", channel: "local_workflow", functionLabel: "Collection journey", event: "workflow_step", count: 431, unit: "steps", costLowLkr: 34, costHighLkr: 57 },
  { id: "use-011", date: "2026-08-04", journey: "campaign", location: "wattala", language: "si", channel: "campaign_simulator", functionLabel: "Batch exercise", event: "queue_job", count: 15000, unit: "jobs", costLowLkr: 128, costHighLkr: 214 },
  { id: "use-012", date: "2026-08-05", journey: "appointment", location: "lab_network", language: "si", channel: "local_workflow", functionLabel: "Reminder sequence", event: "workflow_step", count: 1052, unit: "steps", costLowLkr: 76, costHighLkr: 126 },
  { id: "use-013", date: "2026-08-05", journey: "general", location: "thalawathugoda", language: "ta", channel: "safety_harness", functionLabel: "Safety classification", event: "safety_review", count: 590, unit: "reviews", costLowLkr: 67, costHighLkr: 112 },
  { id: "use-014", date: "2026-08-06", journey: "laboratory", location: "lab_network", language: "ta", channel: "simulator_inbox", functionLabel: "Service routing", event: "inbound_event", count: 720, unit: "events", costLowLkr: 56, costHighLkr: 94 },
  { id: "use-015", date: "2026-08-06", journey: "appointment", location: "thalawathugoda", language: "en", channel: "local_workflow", functionLabel: "Appointment confirmation", event: "flow_session", count: 548, unit: "sessions", costLowLkr: 51, costHighLkr: 84 },
  { id: "use-016", date: "2026-08-07", journey: "campaign", location: "lab_network", language: "ta", channel: "campaign_simulator", functionLabel: "Deterministic dispatch", event: "queue_job", count: 38443, unit: "jobs", costLowLkr: 290, costHighLkr: 480 },
  { id: "use-017", date: "2026-08-07", journey: "general", location: "wattala", language: "si", channel: "safety_harness", functionLabel: "Urgent-language review", event: "safety_review", count: 208, unit: "reviews", costLowLkr: 26, costHighLkr: 43 },
  { id: "use-018", date: "2026-08-07", journey: "general", location: "wattala", language: "si", channel: "simulator_inbox", functionLabel: "Human handoff audit", event: "audit_event", count: 166, unit: "events", costLowLkr: 12, costHighLkr: 21 },
];

const DATE_RANGE_START: Readonly<Record<SampleDateRange, string>> = {
  "7d": "2026-08-01",
  "14d": "2026-07-25",
  "30d": "2026-07-09",
};

export function matchesDimensionFilters(
  row: Pick<AnalyticsSampleRow, "date" | "journey" | "location" | "language">,
  filters: DimensionFilters,
): boolean {
  return (
    row.date >= DATE_RANGE_START[filters.dateRange] &&
    (filters.journey === "all" || row.journey === filters.journey) &&
    (filters.location === "all" || row.location === filters.location) &&
    (filters.language === "all" || row.language === filters.language)
  );
}
