"use client";

import {
  CheckCircle2,
  Clock3,
  Languages,
  LockKeyhole,
  RotateCcw,
  Save,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState } from "react";

import { StatusPill } from "@/components/ui/status-pill";

import { ChangeImpactPreview } from "./change-impact-preview";
import { PreferenceForm } from "./preference-form";
import { ImmutableSafetyFlags, LockedConfigurationPanel } from "./safety-boundaries";
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  buildPreferenceImpacts,
  preferencesEqual,
  validatePreferences,
  type WorkspacePreferences,
} from "./settings-data";

function SummaryCard({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Settings;
  tone: "blue" | "emerald" | "amber" | "violet";
}) {
  const colors = {
    blue: "bg-blue-50 text-blue-700",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    violet: "bg-violet-50 text-violet-700",
  };

  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-slate-500">{label}</p>
          <p className="mt-2 text-xl font-bold tracking-[-0.03em] text-slate-950">{value}</p>
        </div>
        <span className={`grid h-10 w-10 place-items-center rounded-xl ${colors[tone]}`}>
          <Icon size={18} aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 text-[11px] leading-5 text-slate-500">{detail}</p>
    </article>
  );
}

export function SettingsWorkspace() {
  const [savedPreferences, setSavedPreferences] = useState<WorkspacePreferences>(
    DEFAULT_WORKSPACE_PREFERENCES,
  );
  const [draftPreferences, setDraftPreferences] = useState<WorkspacePreferences>(
    DEFAULT_WORKSPACE_PREFERENCES,
  );
  const [feedback, setFeedback] = useState(
    "Seeded local defaults loaded. No preference data has been persisted.",
  );
  const impacts = useMemo(
    () => buildPreferenceImpacts(savedPreferences, draftPreferences),
    [draftPreferences, savedPreferences],
  );
  const errors = useMemo(
    () => validatePreferences(draftPreferences),
    [draftPreferences],
  );
  const hasUnsavedChanges = !preferencesEqual(savedPreferences, draftPreferences);

  function updateDraft(preferences: WorkspacePreferences) {
    setDraftPreferences(preferences);
    setFeedback("");
  }

  function applyLocally() {
    if (!hasUnsavedChanges || errors.length > 0) return;
    setSavedPreferences(draftPreferences);
    setFeedback(
      `${impacts.length} preference ${impacts.length === 1 ? "change" : "changes"} applied to this tab only. Reloading restores seeded defaults.`,
    );
  }

  function resetUnsaved() {
    setDraftPreferences(savedPreferences);
    setFeedback("Unsaved changes discarded. No external state was changed.");
  }

  function restoreDefaults() {
    setDraftPreferences(DEFAULT_WORKSPACE_PREFERENCES);
    setFeedback(
      preferencesEqual(savedPreferences, DEFAULT_WORKSPACE_PREFERENCES)
        ? "The current tab already uses seeded defaults."
        : "Seeded defaults prepared as an unsaved local draft.",
    );
  }

  return (
    <div className="space-y-6 lg:space-y-8">
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700">
            <Settings size={21} aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--brand)]">
                Workspace configuration
              </p>
              <StatusPill tone="info" dot>
                Browser state only
              </StatusPill>
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-[-0.035em] text-slate-950 sm:text-3xl">
              Settings workspace
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              Exercise synthetic locale, quiet-hours, SLA, and quality preferences while
              production, provider, security, and secret-bearing configuration stays locked.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill tone="success">Asia/Colombo</StatusPill>
          <StatusPill tone={hasUnsavedChanges ? "warning" : "neutral"}>
            {hasUnsavedChanges ? `${impacts.length} unsaved` : "No unsaved changes"}
          </StatusPill>
        </div>
      </section>

      <section
        className="overflow-hidden rounded-2xl border border-red-200 bg-gradient-to-r from-red-50 via-white to-amber-50 p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5"
        aria-labelledby="settings-boundary-title"
      >
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-red-100 text-red-700">
            <LockKeyhole size={20} aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="settings-boundary-title" className="text-sm font-bold text-slate-950">
                Local preference preview only
              </h2>
              <StatusPill tone="danger">No persistence or network</StatusPill>
            </div>
            <p className="mt-1.5 max-w-4xl text-xs leading-5 text-slate-600 sm:text-sm sm:leading-6">
              Applying a draft updates in-memory React state in this tab. It cannot write
              Firebase, activate a provider, change access control, store a secret, schedule
              work, or modify another user&apos;s settings.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Settings safety summary">
        <SummaryCard
          label="Environment"
          value="Synthetic demo"
          detail="Immutable browser-visible classification"
          icon={ShieldCheck}
          tone="emerald"
        />
        <SummaryCard
          label="Timezone"
          value={draftPreferences.timeZone}
          detail="Fixed for deterministic calculations"
          icon={Clock3}
          tone="blue"
        />
        <SummaryCard
          label="Languages enabled"
          value={String(draftPreferences.languages.length)}
          detail="English, Sinhala, and Tamil fixture controls"
          icon={Languages}
          tone="violet"
        />
        <SummaryCard
          label="Draft impact"
          value={hasUnsavedChanges ? `${impacts.length} changes` : "None"}
          detail={errors.length > 0 ? `${errors.length} validation issues` : "Local preview is valid"}
          icon={hasUnsavedChanges ? Save : CheckCircle2}
          tone="amber"
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(330px,0.7fr)]">
        <PreferenceForm preferences={draftPreferences} onChange={updateDraft} />
        <div className="space-y-6">
          <ChangeImpactPreview impacts={impacts} errors={errors} />
          <ImmutableSafetyFlags />
        </div>
      </section>

      <section
        className={`rounded-2xl border p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5 ${
          hasUnsavedChanges
            ? "border-amber-200 bg-amber-50/70"
            : "border-emerald-200 bg-emerald-50/70"
        }`}
        aria-labelledby="settings-draft-state-title"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2
              id="settings-draft-state-title"
              className={`text-sm font-bold ${hasUnsavedChanges ? "text-amber-950" : "text-emerald-950"}`}
            >
              {hasUnsavedChanges ? "Unsaved local draft" : "Local tab state is reconciled"}
            </h2>
            <p
              className={`mt-1 text-xs leading-5 ${hasUnsavedChanges ? "text-amber-900" : "text-emerald-900"}`}
              aria-live="polite"
            >
              {feedback ||
                `${impacts.length} preference ${impacts.length === 1 ? "change needs" : "changes need"} review. Nothing has been stored.`}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={restoreDefaults}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RotateCcw size={14} aria-hidden="true" /> Seeded defaults
            </button>
            <button
              type="button"
              disabled={!hasUnsavedChanges}
              onClick={resetUnsaved}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
            >
              <RotateCcw size={14} aria-hidden="true" /> Discard unsaved
            </button>
            <button
              type="button"
              disabled={!hasUnsavedChanges || errors.length > 0}
              onClick={applyLocally}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 text-xs font-bold text-white hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Save size={14} aria-hidden="true" /> Apply to this tab
            </button>
          </div>
        </div>
      </section>

      <LockedConfigurationPanel />
    </div>
  );
}
