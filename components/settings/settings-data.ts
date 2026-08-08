export type SupportedLanguage = "en" | "si" | "ta";

export interface WorkspacePreferences {
  readonly timeZone: "Asia/Colombo";
  readonly languages: readonly SupportedLanguage[];
  readonly quietHoursStart: string;
  readonly quietHoursEnd: string;
  readonly firstResponseSlaMinutes: number;
  readonly handoffAckSlaMinutes: number;
  readonly qualityReviewPercent: number;
  readonly qualityTargetPercent: number;
}

export interface PreferenceImpact {
  readonly id: string;
  readonly setting: string;
  readonly before: string;
  readonly after: string;
  readonly effect: string;
  readonly tone: "info" | "warning";
}

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  timeZone: "Asia/Colombo",
  languages: ["en", "si", "ta"],
  quietHoursStart: "20:00",
  quietHoursEnd: "08:00",
  firstResponseSlaMinutes: 10,
  handoffAckSlaMinutes: 5,
  qualityReviewPercent: 10,
  qualityTargetPercent: 90,
};

export const LANGUAGE_OPTIONS: readonly {
  value: SupportedLanguage;
  label: string;
  detail: string;
}[] = [
  { value: "en", label: "English", detail: "Synthetic English fixtures" },
  { value: "si", label: "සිංහල", detail: "Synthetic Sinhala fixtures" },
  { value: "ta", label: "தமிழ்", detail: "Synthetic Tamil fixtures" },
];

export const TIME_OPTIONS: readonly string[] = Array.from(
  { length: 24 },
  (_, hour) => `${String(hour).padStart(2, "0")}:00`,
);

export const IMMUTABLE_SAFETY_FLAGS = [
  {
    label: "Application environment",
    value: "Synthetic demo",
    detail: "Cannot be changed in the browser.",
  },
  {
    label: "Real patient data",
    value: "Blocked",
    detail: "Only deterministic fixture records are permitted.",
  },
  {
    label: "External messaging",
    value: "Off",
    detail: "No outbound adapter can be activated here.",
  },
  {
    label: "Production workspace",
    value: "Unavailable",
    detail: "Requires a separately governed tenant and deployment.",
  },
  {
    label: "Secrets in browser",
    value: "Prohibited",
    detail: "No token, key, password, or webhook-secret field exists.",
  },
] as const;

export const LOCKED_CONFIGURATION = [
  {
    title: "Provider connections",
    detail: "Meta, messaging, AI, and integration credentials remain outside this UI.",
  },
  {
    title: "Firebase and data region",
    detail: "Project ownership, edition, region, and production resources are undecided.",
  },
  {
    title: "Identity and access",
    detail: "Production SSO, roles, and break-glass access require security approval.",
  },
  {
    title: "Encryption and key management",
    detail: "Key material belongs in managed server-side controls, never a browser form.",
  },
  {
    title: "Retention and deletion",
    detail: "Production schedules require privacy, legal, clinical, and records decisions.",
  },
  {
    title: "Webhook and incident controls",
    detail: "Endpoints, signatures, alerts, and paging require verified production systems.",
  },
] as const;

export function languageLabel(code: SupportedLanguage): string {
  return LANGUAGE_OPTIONS.find((option) => option.value === code)?.label ?? code;
}

function sameLanguages(
  left: readonly SupportedLanguage[],
  right: readonly SupportedLanguage[],
): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

export function preferencesEqual(
  left: WorkspacePreferences,
  right: WorkspacePreferences,
): boolean {
  return (
    left.timeZone === right.timeZone &&
    sameLanguages(left.languages, right.languages) &&
    left.quietHoursStart === right.quietHoursStart &&
    left.quietHoursEnd === right.quietHoursEnd &&
    left.firstResponseSlaMinutes === right.firstResponseSlaMinutes &&
    left.handoffAckSlaMinutes === right.handoffAckSlaMinutes &&
    left.qualityReviewPercent === right.qualityReviewPercent &&
    left.qualityTargetPercent === right.qualityTargetPercent
  );
}

export function buildPreferenceImpacts(
  saved: WorkspacePreferences,
  draft: WorkspacePreferences,
): readonly PreferenceImpact[] {
  const impacts: PreferenceImpact[] = [];

  if (!sameLanguages(saved.languages, draft.languages)) {
    impacts.push({
      id: "languages",
      setting: "Supported languages",
      before: saved.languages.map(languageLabel).join(", "),
      after: draft.languages.map(languageLabel).join(", ") || "None",
      effect: "Changes which deterministic language fixtures appear available in this tab.",
      tone: draft.languages.length < saved.languages.length ? "warning" : "info",
    });
  }

  if (
    saved.quietHoursStart !== draft.quietHoursStart ||
    saved.quietHoursEnd !== draft.quietHoursEnd
  ) {
    impacts.push({
      id: "quiet-hours",
      setting: "Quiet hours",
      before: `${saved.quietHoursStart}–${saved.quietHoursEnd}`,
      after: `${draft.quietHoursStart}–${draft.quietHoursEnd}`,
      effect: "Updates the displayed mock scheduling window; it creates no reminder job.",
      tone: "warning",
    });
  }

  if (saved.firstResponseSlaMinutes !== draft.firstResponseSlaMinutes) {
    impacts.push({
      id: "first-response",
      setting: "First-response sample SLA",
      before: `${saved.firstResponseSlaMinutes} minutes`,
      after: `${draft.firstResponseSlaMinutes} minutes`,
      effect: "Re-labels local queue quality thresholds only.",
      tone: "info",
    });
  }

  if (saved.handoffAckSlaMinutes !== draft.handoffAckSlaMinutes) {
    impacts.push({
      id: "handoff",
      setting: "Handoff acknowledgement sample SLA",
      before: `${saved.handoffAckSlaMinutes} minutes`,
      after: `${draft.handoffAckSlaMinutes} minutes`,
      effect: "Changes the synthetic handoff warning threshold; nobody is paged.",
      tone: "warning",
    });
  }

  if (saved.qualityReviewPercent !== draft.qualityReviewPercent) {
    impacts.push({
      id: "quality-sample",
      setting: "Quality review sample",
      before: `${saved.qualityReviewPercent}%`,
      after: `${draft.qualityReviewPercent}%`,
      effect: "Adjusts the displayed proportion of fixture events selected for local review.",
      tone: "info",
    });
  }

  if (saved.qualityTargetPercent !== draft.qualityTargetPercent) {
    impacts.push({
      id: "quality-target",
      setting: "Quality target",
      before: `${saved.qualityTargetPercent}%`,
      after: `${draft.qualityTargetPercent}%`,
      effect: "Changes a sample score target and makes no clinical or operational claim.",
      tone: "info",
    });
  }

  return impacts;
}

export function validatePreferences(
  preferences: WorkspacePreferences,
): readonly string[] {
  const errors: string[] = [];

  if (preferences.languages.length === 0) {
    errors.push("Select at least one supported synthetic language.");
  }
  if (preferences.quietHoursStart === preferences.quietHoursEnd) {
    errors.push("Quiet-hours start and end must be different.");
  }
  if (
    preferences.firstResponseSlaMinutes < 1 ||
    preferences.firstResponseSlaMinutes > 60
  ) {
    errors.push("First-response sample SLA must be between 1 and 60 minutes.");
  }
  if (
    preferences.handoffAckSlaMinutes < 1 ||
    preferences.handoffAckSlaMinutes > 30
  ) {
    errors.push("Handoff acknowledgement sample SLA must be between 1 and 30 minutes.");
  }
  if (
    preferences.qualityReviewPercent < 1 ||
    preferences.qualityReviewPercent > 100
  ) {
    errors.push("Quality review sample must be between 1% and 100%.");
  }
  if (
    preferences.qualityTargetPercent < 50 ||
    preferences.qualityTargetPercent > 100
  ) {
    errors.push("Quality target must be between 50% and 100%.");
  }

  return errors;
}
