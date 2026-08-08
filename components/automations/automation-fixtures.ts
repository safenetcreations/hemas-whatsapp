import type {
  AutomationRunState,
  AutomationStepPolicy,
  AutomationTrigger,
  CareSuppressionReason,
} from "@/lib/domain/automations";
import type { ConsentPurpose } from "@/lib/domain/contacts";

export type LocalRunState = "idle" | AutomationRunState;

export type LocalPolicyStep = {
  readonly id: string;
  readonly label: string;
  readonly kind:
    | "send_template"
    | "wait"
    | "request_appointment_action"
    | "route_to_team"
    | "stop";
  readonly consentPurpose: ConsentPurpose;
  readonly serviceWindowBehavior: AutomationStepPolicy["serviceWindowBehavior"];
  readonly timeoutSeconds: number;
  readonly retry: AutomationStepPolicy["retry"];
  readonly fallback: AutomationStepPolicy["fallback"];
};

export type DefinitionVersion = {
  readonly version: number;
  readonly state: "approved" | "retired" | "draft";
  readonly note: string;
};

export type AutomationDefinitionFixture = {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly version: number;
  readonly trigger: AutomationTrigger;
  readonly approvalState: "draft" | "review_pending" | "approved" | "retired";
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly riskLevel: "low" | "medium" | "high";
  readonly active: boolean;
  readonly synthetic: true;
  readonly steps: readonly LocalPolicyStep[];
  readonly versionHistory: readonly DefinitionVersion[];
};

const appointmentPolicy: Omit<LocalPolicyStep, "id" | "label" | "kind"> = {
  consentPurpose: "appointment_service",
  serviceWindowBehavior: "use_approved_template",
  timeoutSeconds: 20,
  retry: {
    maxAttempts: 3,
    initialBackoffSeconds: 30,
    maximumBackoffSeconds: 300,
  },
  fallback: "route_to_human",
};

const laboratoryPolicy: Omit<LocalPolicyStep, "id" | "label" | "kind"> = {
  consentPurpose: "laboratory_service",
  serviceWindowBehavior: "use_approved_template",
  timeoutSeconds: 20,
  retry: {
    maxAttempts: 2,
    initialBackoffSeconds: 60,
    maximumBackoffSeconds: 300,
  },
  fallback: "create_work_item",
};

export const automationDefinitions: readonly AutomationDefinitionFixture[] = [
  {
    id: "auto-appointment-reminder",
    name: "Appointment reminder sequence",
    summary:
      "Exercises confirmation, reminder timing, and a human fallback against synthetic appointment references.",
    version: 3,
    trigger: "appointment_event",
    approvalState: "approved",
    approvedBy: "Synthetic Operations Approver",
    approvedAt: "2026-08-07T08:30:00.000Z",
    riskLevel: "medium",
    active: true,
    synthetic: true,
    versionHistory: [
      { version: 3, state: "approved", note: "Current immutable simulator version" },
      { version: 2, state: "retired", note: "Replaced reminder fallback policy" },
      { version: 1, state: "retired", note: "Initial local prototype" },
    ],
    steps: [
      {
        id: "confirm-action",
        label: "Request appointment confirmation",
        kind: "request_appointment_action",
        ...appointmentPolicy,
      },
      {
        id: "wait-until-reminder",
        label: "Wait until synthetic reminder point",
        kind: "wait",
        ...appointmentPolicy,
        serviceWindowBehavior: "send_in_window",
        timeoutSeconds: 5,
        retry: { maxAttempts: 0, initialBackoffSeconds: 0, maximumBackoffSeconds: 0 },
        fallback: "stop_run",
      },
      {
        id: "reminder-template",
        label: "Render approved reminder fixture",
        kind: "send_template",
        ...appointmentPolicy,
      },
    ],
  },
  {
    id: "auto-lab-ready",
    name: "Lab-ready notification",
    summary:
      "Exercises a report-ready metadata notification without loading report content or clinical values.",
    version: 2,
    trigger: "lims_report_ready",
    approvalState: "approved",
    approvedBy: "Synthetic Laboratory Approver",
    approvedAt: "2026-08-07T07:45:00.000Z",
    riskLevel: "medium",
    active: true,
    synthetic: true,
    versionHistory: [
      { version: 2, state: "approved", note: "Secure-link metadata gate added" },
      { version: 1, state: "retired", note: "Initial local prototype" },
    ],
    steps: [
      {
        id: "readiness-gate",
        label: "Inspect synthetic readiness metadata",
        kind: "wait",
        ...laboratoryPolicy,
        serviceWindowBehavior: "send_in_window",
        retry: { maxAttempts: 0, initialBackoffSeconds: 0, maximumBackoffSeconds: 0 },
        fallback: "stop_run",
      },
      {
        id: "ready-template",
        label: "Render approved report-ready fixture",
        kind: "send_template",
        ...laboratoryPolicy,
      },
      {
        id: "exception-work-item",
        label: "Create local exception work item",
        kind: "route_to_team",
        ...laboratoryPolicy,
        serviceWindowBehavior: "do_not_send",
      },
    ],
  },
  {
    id: "auto-feedback-request",
    name: "Visit feedback request",
    summary:
      "Draft-only feedback workflow showing how approval gates block even a local run from being represented as active.",
    version: 1,
    trigger: "scheduled_time",
    approvalState: "review_pending",
    approvedBy: null,
    approvedAt: null,
    riskLevel: "low",
    active: false,
    synthetic: true,
    versionHistory: [
      { version: 1, state: "draft", note: "Awaiting local governance review" },
    ],
    steps: [
      {
        id: "feedback-template",
        label: "Render feedback request fixture",
        kind: "send_template",
        consentPurpose: "feedback",
        serviceWindowBehavior: "use_approved_template",
        timeoutSeconds: 20,
        retry: { maxAttempts: 1, initialBackoffSeconds: 60, maximumBackoffSeconds: 60 },
        fallback: "stop_run",
      },
    ],
  },
] as const;

export const postDischargePathway = {
  id: "care-post-discharge-general",
  name: "Post-discharge structured check-in",
  protocolVersion: "2.1",
  nextWorkingVersion: "2.2",
  clinicalOwner: "Dr. N. Perera · synthetic clinical owner",
  clinicalApprover: "Synthetic Clinical Governance Board",
  approvedAt: "2026-08-07T09:30:00.000Z",
  approvalState: "approved" as const,
  approvedDayOffsets: [1, 3, 7, 14] as readonly number[],
  responseSlaMinutes: 15,
  escalationTeam: "Synthetic nurse escalation queue",
  afterHoursBehavior: "on_call_queue" as const,
  instructionsSource: "clinician_authored" as const,
  aiMayGenerateInstructions: false as const,
  synthetic: true as const,
};

export type SuppressionOption = {
  readonly reason: CareSuppressionReason;
  readonly label: string;
  readonly detail: string;
};

export const suppressionOptions: readonly SuppressionOption[] = [
  {
    reason: "readmission",
    label: "Readmission",
    detail: "Stop routine follow-up because a new admission supersedes it.",
  },
  {
    reason: "transfer",
    label: "Transfer",
    detail: "Pause contacts after care responsibility changes.",
  },
  {
    reason: "death",
    label: "Death notification",
    detail: "Suppress all routine messages immediately and sensitively.",
  },
  {
    reason: "clinical_hold",
    label: "Clinical hold",
    detail: "A clinician has paused the pathway pending review.",
  },
  {
    reason: "withdrawal",
    label: "Consent withdrawal",
    detail: "No further pathway contact is permitted.",
  },
  {
    reason: "invalid_contact",
    label: "Invalid contact",
    detail: "Prevent retries to an invalid synthetic destination.",
  },
] as const;

export const triggerLabels: Record<AutomationTrigger, string> = {
  inbound_intent: "Inbound intent",
  appointment_event: "Appointment event",
  lims_report_ready: "LIMS report-ready event",
  discharge_event: "Discharge event",
  scheduled_time: "Scheduled time",
  campaign_response: "Campaign response",
  agent_action: "Agent action",
};

export const consentLabels: Record<ConsentPurpose, string> = {
  appointment_service: "Appointment service",
  laboratory_service: "Laboratory service",
  care_pathway: "Care pathway",
  feedback: "Feedback",
  health_campaigns: "Health campaigns",
  event_campaigns: "Event campaigns",
  transactional_updates: "Transactional updates",
};

export const serviceWindowLabels: Record<
  AutomationStepPolicy["serviceWindowBehavior"],
  string
> = {
  send_in_window: "Send only in service window",
  use_approved_template: "Require approved template outside window",
  do_not_send: "Do not send outside window",
};

export const fallbackLabels: Record<AutomationStepPolicy["fallback"], string> = {
  create_work_item: "Create local work item",
  route_to_human: "Route to human",
  stop_run: "Stop run",
};
