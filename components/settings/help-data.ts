import type { PortalRoutePath } from "@/components/auth/portal-route-access";

export interface HelpPath {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly href: PortalRoutePath;
  readonly action: string;
  readonly boundary: string;
}

export interface AcceptanceItem {
  readonly id: string;
  readonly title: string;
  readonly evidence: string;
  readonly href: PortalRoutePath;
  readonly linkLabel: string;
}

export const HELP_PATHS: readonly HelpPath[] = [
  {
    id: "scenario",
    title: "Run or reset a scenario",
    description: "Start deterministic appointment, laboratory, safety, STOP, and campaign fixtures.",
    href: "/demo-lab",
    action: "Open Demo Lab",
    boundary: "Runs locally; it creates no patient or provider event.",
  },
  {
    id: "operations",
    title: "Inspect a synthetic conversation",
    description: "Review language routing, safety holds, and explicit local human takeover.",
    href: "/inbox",
    action: "Open synthetic inbox",
    boundary: "No agent is monitoring this inbox.",
  },
  {
    id: "connections",
    title: "Diagnose readiness gates",
    description: "Separate source-ready, configured, verified, and production-accepted states.",
    href: "/connections",
    action: "Review connection centre",
    boundary: "No connection can be activated from Help.",
  },
  {
    id: "governance",
    title: "Review privacy and access boundaries",
    description: "Inspect prototype controls, audit fixtures, and unresolved production decisions.",
    href: "/compliance",
    action: "Review compliance",
    boundary: "Prototype evidence is not security or clinical approval.",
  },
];

export const ACCEPTANCE_ITEMS: readonly AcceptanceItem[] = [
  {
    id: "demo-boundary",
    title: "Persistent synthetic-demo boundary is visible",
    evidence: "Confirm the banner, synthetic labels, and external-send lock remain visible.",
    href: "/",
    linkLabel: "Review overview",
  },
  {
    id: "appointment",
    title: "Trilingual appointment fixture completes locally",
    evidence: "Exercise mock availability, confirmation, reschedule, and cancellation states.",
    href: "/appointments",
    linkLabel: "Test appointment journey",
  },
  {
    id: "urgent-handoff",
    title: "Urgent-language safety hold and takeover are demonstrated",
    evidence: "Routine automation must stop; only a local authorized-human simulation may continue.",
    href: "/inbox",
    linkLabel: "Review safety fixture",
  },
  {
    id: "consent-stop",
    title: "Consent history and STOP suppression are visible",
    evidence: "Confirm the marketing eligibility state changes without contacting anyone.",
    href: "/contacts",
    linkLabel: "Review consent controls",
  },
  {
    id: "campaign",
    title: "50,000-recipient campaign simulation reconciles",
    evidence: "Verify eligibility, exclusions, canary, batches, pause/resume, and zero delivery.",
    href: "/campaigns",
    linkLabel: "Run campaign simulation",
  },
  {
    id: "analytics",
    title: "Analytics are labelled sample aggregates",
    evidence: "Confirm filters, empty states, privacy cells, and unavailable live analytics.",
    href: "/analytics",
    linkLabel: "Review sample analytics",
  },
  {
    id: "connections-locked",
    title: "Production and provider connections remain locked",
    evidence: "No UI action should activate Firebase, Meta, HIS, LIMS, billing, or external delivery.",
    href: "/connections",
    linkLabel: "Inspect activation gates",
  },
  {
    id: "quality",
    title: "Desktop, mobile, accessibility, and failure states pass",
    evidence: "Record local evidence for keyboard use, responsive layout, empty/error states, and build checks.",
    href: "/demo-lab",
    linkLabel: "Open acceptance scenarios",
  },
];
