"use client";

import {
  ArrowLeft,
  Ban,
  Clock3,
  Download,
  Languages,
  LoaderCircle,
  LockKeyhole,
  MessageSquareOff,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  ShieldOff,
  Tag,
  UserRound,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ConsentStatus, SupportedLanguage } from "@/lib/domain";
import {
  SAFE_CONTACT_TAGS,
  type SafeContactTag,
} from "@/lib/firebase/repositories";
import {
  normalizedMarketingStatus,
  preferenceDraftChanged,
  preferenceDraftFromContact,
} from "./contact-workspace-model";
import type {
  ContactDirectoryRecord,
  ContactPreferenceDraft,
  LocalContactActivity,
  PreferenceSaveStatus,
} from "./types";

const LANGUAGE_LABELS = {
  en: "English",
  si: "සිංහල",
  ta: "தமிழ்",
} as const;

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-LK", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Colombo",
  }).format(new Date(value));
}

function consentStatusStyle(status: ConsentStatus): string {
  if (status === "granted") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "withdrawn" || status === "denied") {
    return "border-red-200 bg-red-50 text-red-800";
  }
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function saveStatusStyle(status: PreferenceSaveStatus): string {
  if (status.kind === "success") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (status.kind === "conflict") return "border-amber-300 bg-amber-50 text-amber-950";
  if (status.kind === "error") return "border-red-200 bg-red-50 text-red-900";
  return "border-cyan-200 bg-cyan-50 text-cyan-900";
}

export function ContactDetail({
  record,
  draft,
  suppressionPreview,
  activities,
  saveStatus,
  canPersistPreferences,
  onBack,
  onLanguageChange,
  onTagsChange,
  onSuppressionChange,
  onDiscardPreferenceDraft,
  onSavePreferences,
}: {
  record: ContactDirectoryRecord;
  draft: ContactPreferenceDraft | undefined;
  suppressionPreview: boolean | undefined;
  activities: readonly LocalContactActivity[];
  saveStatus: PreferenceSaveStatus;
  canPersistPreferences: boolean;
  onBack: () => void;
  onLanguageChange: (language: SupportedLanguage) => void;
  onTagsChange: (tags: readonly SafeContactTag[]) => void;
  onSuppressionChange: (suppressed: boolean) => void;
  onDiscardPreferenceDraft: () => void;
  onSavePreferences: () => void;
}) {
  const [tagChoice, setTagChoice] = useState<"" | SafeContactTag>("");
  const { contact, consentRecords } = record;
  const preferences = draft ?? preferenceDraftFromContact(contact);
  const hasUnsavedPreferences = preferenceDraftChanged(contact, draft);
  const sourceSuppressed =
    contact.suppression.suppressMarketing ||
    contact.suppression.suppressAll ||
    contact.suppression.invalidContact;
  const marketingSuppressed = suppressionPreview ?? sourceSuppressed;
  const isSaving = saveStatus.kind === "working";

  const consentTimeline = useMemo(
    () =>
      [...consentRecords].sort(
        (left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt),
      ),
    [consentRecords],
  );
  const marketingConsent = normalizedMarketingStatus(consentRecords);
  const availableTags = SAFE_CONTACT_TAGS.filter((tag) => !preferences.tags.includes(tag));

  function addTag() {
    if (!tagChoice || preferences.tags.includes(tagChoice)) return;
    onTagsChange([...preferences.tags, tagChoice]);
    setTagChoice("");
  }

  return (
    <section
      aria-label={`Synthetic contact details for ${contact.displayLabel}`}
      className="scrollbar-subtle min-h-[72dvh] min-w-0 overflow-y-auto rounded-2xl border border-[var(--line)] bg-white shadow-[0_1px_2px_rgba(23,34,31,0.04)] md:h-full md:min-h-0"
    >
      <header className="sticky top-0 z-10 border-b border-[var(--line)] bg-white/95 px-3.5 py-3 backdrop-blur sm:px-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[var(--line)] text-slate-600 hover:bg-slate-50 md:hidden"
            aria-label="Back to synthetic contact directory"
          >
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
          <span
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-xs font-bold ${marketingSuppressed ? "bg-red-100 text-red-700" : "bg-[var(--brand-soft)] text-[var(--brand)]"}`}
            aria-hidden="true"
          >
            {contact.displayLabel.slice(-1)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-[15px] font-bold text-slate-950">
                {contact.displayLabel}
              </h2>
              <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] text-violet-700">
                Synthetic
              </span>
              {hasUnsavedPreferences ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] text-amber-800">
                  Unsaved preferences
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-[11px] text-slate-500">
              {contact.maskedPhone} · preference revision {contact.preferenceRevision}
            </p>
          </div>
          <button
            type="button"
            disabled
            title="Outbound messaging is unavailable in the synthetic contacts workspace"
            className="hidden h-9 cursor-not-allowed items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[11px] font-bold text-slate-400 sm:inline-flex"
          >
            <MessageSquareOff size={13} aria-hidden="true" /> Message unavailable
          </button>
        </div>
      </header>

      <div className="space-y-4 p-3.5 sm:p-5">
        <div className="flex items-start gap-2 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2.5 text-[10px] leading-5 text-cyan-950">
          <LockKeyhole size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            <strong>Emulator-backed synthetic record:</strong> approved language and tag changes
            can be saved with conflict protection. Consent and source suppression remain immutable;
            protected identifiers are never rendered.
          </span>
        </div>

        {saveStatus.kind !== "idle" ? (
          <div
            className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[10px] leading-5 ${saveStatusStyle(saveStatus)}`}
            role={saveStatus.kind === "error" || saveStatus.kind === "conflict" ? "alert" : "status"}
            aria-live="polite"
            data-testid="contact-preference-save-status"
            data-save-kind={saveStatus.kind}
          >
            {saveStatus.kind === "working" ? (
              <LoaderCircle size={14} className="mt-0.5 shrink-0 animate-spin" aria-hidden="true" />
            ) : saveStatus.kind === "success" ? (
              <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            ) : (
              <RotateCcw size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            )}
            <span>{saveStatus.message}</span>
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
          <div className="space-y-4">
            <article className="rounded-2xl border border-[var(--line)] p-4">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-950">
                  <UserRound size={15} className="text-[var(--brand)]" aria-hidden="true" />
                  Contact identity
                </h3>
                <p className="mt-1 text-[10px] text-slate-500">
                  Minimum-necessary masked data from the authenticated Firestore query
                </p>
              </div>
              <dl className="mt-4 grid gap-3 text-[11px] sm:grid-cols-2">
                <div className="rounded-xl bg-slate-50 p-3">
                  <dt className="text-slate-500">Display label</dt>
                  <dd className="mt-1 font-bold text-slate-800">{contact.displayLabel}</dd>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <dt className="text-slate-500">Masked phone</dt>
                  <dd className="mt-1 font-bold text-slate-800">{contact.maskedPhone}</dd>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 sm:col-span-2">
                  <dt className="text-slate-500">Protected identity values</dt>
                  <dd className="mt-1 font-bold text-emerald-700">
                    Excluded from this view model and browser UI
                  </dd>
                </div>
              </dl>
            </article>

            <article className="rounded-2xl border border-[var(--line)] p-4">
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-950">
                <Languages size={15} className="text-[var(--brand)]" aria-hidden="true" />
                Communication preference
              </h3>
              <p className="mt-1 text-[10px] leading-4 text-slate-500">
                Stage a preferred language, then explicitly save it to the local Firestore
                emulator. Template approval remains a separate control.
              </p>
              <fieldset className="mt-3 grid gap-2 sm:grid-cols-3" disabled={isSaving || !canPersistPreferences}>
                <legend className="sr-only">Preferred language</legend>
                {(["en", "si", "ta"] as const).map((language) => (
                  <label
                    key={language}
                    className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 text-[11px] font-bold transition ${isSaving || !canPersistPreferences ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${preferences.preferredLanguage === language ? "border-emerald-500 bg-emerald-50 text-emerald-900" : "border-[var(--line)] text-slate-600 hover:bg-slate-50"}`}
                  >
                    <input
                      type="radio"
                      name="preferred-language"
                      value={language}
                      checked={preferences.preferredLanguage === language}
                      onChange={() => onLanguageChange(language)}
                      className="h-4 w-4 accent-emerald-700"
                    />
                    {LANGUAGE_LABELS[language]}
                  </label>
                ))}
              </fieldset>
            </article>

            <article className="rounded-2xl border border-[var(--line)] p-4">
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-950">
                <Tag size={15} className="text-[var(--brand)]" aria-hidden="true" />
                Operational tags
              </h3>
              <p className="mt-1 text-[10px] leading-4 text-slate-500">
                Only repository-allowlisted non-clinical tags can be saved. Health-condition
                inference is unavailable.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {preferences.tags.length === 0 ? (
                  <span className="text-[11px] text-slate-500">No operational tags</span>
                ) : (
                  preferences.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-2.5 pr-1 text-[10px] font-bold text-slate-700"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => onTagsChange(preferences.tags.filter((item) => item !== tag))}
                        disabled={isSaving || !canPersistPreferences}
                        className="grid h-6 w-6 place-items-center rounded-full text-slate-500 hover:bg-white hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={`Remove unsaved tag ${tag}`}
                      >
                        <X size={11} aria-hidden="true" />
                      </button>
                    </span>
                  ))
                )}
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Choose an approved operational tag</span>
                  <select
                    value={tagChoice}
                    onChange={(event) => setTagChoice(event.target.value as "" | SafeContactTag)}
                    disabled={isSaving || !canPersistPreferences}
                    className="h-10 w-full rounded-xl border border-[var(--line)] bg-white px-3 text-[11px] font-medium text-slate-700 outline-none focus:border-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100"
                  >
                    <option value="">Choose approved demo tag</option>
                    {availableTags.map((tag) => (
                      <option key={tag} value={tag}>
                        {tag}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={addTag}
                  disabled={!tagChoice || isSaving || !canPersistPreferences}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[var(--brand)] px-3 text-[11px] font-bold text-white hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <Plus size={13} aria-hidden="true" /> Add to draft
                </button>
              </div>

              <div className="mt-4 flex flex-col gap-2 border-t border-[var(--line)] pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[10px] leading-4 text-slate-500">
                  {canPersistPreferences
                    ? hasUnsavedPreferences
                      ? `Ready to save against revision ${contact.preferenceRevision}.`
                      : `Synced with Firestore revision ${contact.preferenceRevision}.`
                    : "Your verified role does not permit contact preference changes."}
                </p>
                <div className="flex gap-2">
                  {hasUnsavedPreferences ? (
                    <button
                      type="button"
                      onClick={onDiscardPreferenceDraft}
                      disabled={isSaving}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[var(--line)] px-3 text-[10px] font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50"
                    >
                      <RotateCcw size={12} aria-hidden="true" /> Discard
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={onSavePreferences}
                    disabled={!hasUnsavedPreferences || isSaving || !canPersistPreferences}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[var(--brand)] px-3 text-[10px] font-bold text-white hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {isSaving ? (
                      <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Save size={12} aria-hidden="true" />
                    )}
                    {isSaving ? "Saving…" : "Save preferences"}
                  </button>
                </div>
              </div>
            </article>

            <article
              className={`rounded-2xl border p-4 ${marketingSuppressed ? "border-red-200 bg-red-50" : "border-[var(--line)]"}`}
            >
              <h3
                className={`flex items-center gap-2 text-sm font-bold ${marketingSuppressed ? "text-red-900" : "text-slate-950"}`}
              >
                {marketingSuppressed ? (
                  <ShieldOff size={15} aria-hidden="true" />
                ) : (
                  <ShieldCheck size={15} className="text-[var(--brand)]" aria-hidden="true" />
                )}
                Marketing suppression preview
              </h3>
              <p
                className={`mt-1 text-[10px] leading-4 ${marketingSuppressed ? "text-red-800" : "text-slate-500"}`}
              >
                Effective marketing consent: {marketingConsent}. Preview suppression: {marketingSuppressed ? "on" : "off"}.
                This control never writes suppression or STOP evidence.
              </p>
              <div className="mt-3">
                {sourceSuppressed ? (
                  <button
                    type="button"
                    disabled
                    className="inline-flex h-9 cursor-not-allowed items-center gap-1.5 rounded-lg bg-red-100 px-3 text-[10px] font-bold text-red-800"
                    title="Source-backed suppression cannot be changed by this client"
                  >
                    <Ban size={13} aria-hidden="true" /> Source-backed suppression cannot be cleared
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSuppressionChange(!marketingSuppressed)}
                    className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[10px] font-bold ${marketingSuppressed ? "border border-red-200 bg-white text-red-800 hover:bg-red-50" : "bg-slate-900 text-white hover:bg-slate-800"}`}
                  >
                    {marketingSuppressed ? (
                      <RotateCcw size={13} aria-hidden="true" />
                    ) : (
                      <ShieldOff size={13} aria-hidden="true" />
                    )}
                    {marketingSuppressed ? "Remove local preview" : "Preview suppression locally"}
                  </button>
                )}
              </div>
            </article>
          </div>

          <div className="space-y-4">
            <article className="rounded-2xl border border-[var(--line)] p-4">
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-950">
                <ShieldCheck size={15} className="text-[var(--brand)]" aria-hidden="true" />
                Consent and suppression timeline
              </h3>
              <p className="mt-1 text-[10px] leading-4 text-slate-500">
                Immutable synthetic evidence loaded from Firestore, newest first. Local previews never alter it.
              </p>
              <ol className="mt-4 space-y-3">
                {consentTimeline.length === 0 ? (
                  <li className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center">
                    <p className="text-[11px] font-bold text-slate-700">No consent evidence</p>
                    <p className="mt-1 text-[10px] leading-4 text-slate-500">
                      Eligibility remains unknown until governed evidence exists.
                    </p>
                  </li>
                ) : (
                  consentTimeline.map((consent, index) => (
                    <li key={consent.id} className="relative pl-6">
                      {index < consentTimeline.length - 1 ? (
                        <span
                          className="absolute bottom-[-14px] left-[7px] top-4 w-px bg-slate-200"
                          aria-hidden="true"
                        />
                      ) : null}
                      <span
                        className={`absolute left-0 top-1.5 h-3.5 w-3.5 rounded-full border-2 border-white shadow-sm ${consent.status === "granted" ? "bg-emerald-500" : "bg-red-500"}`}
                        aria-hidden="true"
                      />
                      <div className="rounded-xl border border-[var(--line)] bg-slate-50 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[10px] font-bold capitalize text-slate-800">
                            {consent.purpose.replaceAll("_", " ")}
                          </p>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.05em] ${consentStatusStyle(consent.status)}`}
                          >
                            {consent.status}
                          </span>
                        </div>
                        <p className="mt-1 text-[9px] capitalize text-slate-500">
                          {consent.category} · {consent.channel} · {consent.source.replaceAll("_", " ")}
                        </p>
                        <p className="mt-1.5 flex items-center gap-1 text-[9px] text-slate-500">
                          <Clock3 size={10} aria-hidden="true" /> {formatDateTime(consent.capturedAt)}
                        </p>
                        <p className="mt-1 text-[9px] text-slate-400">
                          Notice {consent.noticeVersion} · Immutable synthetic evidence retained
                        </p>
                      </div>
                    </li>
                  ))
                )}
              </ol>
            </article>

            <article className="rounded-2xl border border-violet-200 bg-violet-50 p-4" aria-live="polite">
              <h3 className="text-sm font-bold text-violet-950">Session activity</h3>
              <p className="mt-1 text-[10px] leading-4 text-violet-800">
                UI receipts only; immutable audit evidence is owned by the backend.
              </p>
              {activities.length === 0 ? (
                <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-[10px] text-violet-700">
                  No preference or preview activity in this browser session.
                </p>
              ) : (
                <ol className="mt-3 space-y-2">
                  {activities
                    .slice()
                    .reverse()
                    .map((activity) => (
                      <li
                        key={activity.id}
                        className="rounded-lg bg-white/80 px-3 py-2 text-[10px] text-violet-900"
                      >
                        <p className="font-semibold">{activity.label}</p>
                        <p className="mt-0.5 text-[9px] text-violet-600">
                          {formatDateTime(activity.occurredAt)}
                        </p>
                      </li>
                    ))}
                </ol>
              )}
            </article>

            <article className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <h3 className="flex items-center gap-2 text-xs font-bold text-amber-950">
                <MessageSquareOff size={14} aria-hidden="true" /> Restricted actions
              </h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                <button
                  type="button"
                  disabled
                  className="inline-flex h-9 cursor-not-allowed items-center justify-center gap-1.5 rounded-lg border border-amber-200 bg-white/70 px-3 text-[10px] font-bold text-amber-700"
                >
                  <Download size={12} aria-hidden="true" /> Export unavailable
                </button>
                <button
                  type="button"
                  disabled
                  className="inline-flex h-9 cursor-not-allowed items-center justify-center gap-1.5 rounded-lg border border-amber-200 bg-white/70 px-3 text-[10px] font-bold text-amber-700"
                >
                  <MessageSquareOff size={12} aria-hidden="true" /> Outbound unavailable
                </button>
              </div>
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}
