import { Clock3, Gauge, Languages, MapPin } from "lucide-react";

import {
  LANGUAGE_OPTIONS,
  TIME_OPTIONS,
  type SupportedLanguage,
  type WorkspacePreferences,
} from "./settings-data";

export function PreferenceForm({
  preferences,
  onChange,
}: {
  preferences: WorkspacePreferences;
  onChange: (preferences: WorkspacePreferences) => void;
}) {
  function toggleLanguage(language: SupportedLanguage, checked: boolean) {
    const selected = new Set(preferences.languages);
    if (checked) selected.add(language);
    else selected.delete(language);

    onChange({
      ...preferences,
      languages: LANGUAGE_OPTIONS.map((option) => option.value).filter((value) =>
        selected.has(value),
      ),
    });
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_1px_2px_rgba(23,34,31,0.03)]">
      <div className="border-b border-[var(--line)] px-4 py-4 sm:px-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--brand)]">
          Local workspace preferences
        </p>
        <h2 className="mt-1 text-[15px] font-bold text-slate-950">
          Synthetic operating defaults
        </h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Draft changes affect this browser tab only. Reloading restores the seeded demo.
        </p>
      </div>

      <div className="space-y-6 p-4 sm:p-5">
        <section aria-labelledby="locale-settings-title">
          <h3
            id="locale-settings-title"
            className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-slate-500"
          >
            <MapPin size={14} className="text-[var(--brand)]" aria-hidden="true" />
            Locale and languages
          </h3>
          <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(220px,0.65fr)_minmax(0,1.35fr)]">
            <label className="grid content-start gap-1.5 text-xs font-semibold text-slate-700">
              Workspace timezone
              <select
                value={preferences.timeZone}
                disabled
                aria-describedby="timezone-help"
                className="h-11 cursor-not-allowed rounded-xl border border-[var(--line)] bg-slate-100 px-3 text-sm font-semibold text-slate-600"
              >
                <option value="Asia/Colombo">Asia/Colombo (UTC+05:30)</option>
              </select>
              <span id="timezone-help" className="text-[10px] font-normal leading-4 text-slate-500">
                Fixed for deterministic date and quiet-hours calculations.
              </span>
            </label>

            <fieldset>
              <legend className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <Languages size={14} className="text-[var(--brand)]" aria-hidden="true" />
                Supported synthetic languages
              </legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {LANGUAGE_OPTIONS.map((option) => (
                  <label
                    className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[var(--line)] p-3 hover:bg-slate-50"
                    key={option.value}
                  >
                    <input
                      type="checkbox"
                      checked={preferences.languages.includes(option.value)}
                      onChange={(event) =>
                        toggleLanguage(option.value, event.target.checked)
                      }
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-[var(--brand)]"
                    />
                    <span>
                      <span className="block text-xs font-bold text-slate-800">
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-[10px] leading-4 text-slate-500">
                        {option.detail}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </section>

        <section className="border-t border-[var(--line)] pt-5" aria-labelledby="quiet-hours-title">
          <h3
            id="quiet-hours-title"
            className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-slate-500"
          >
            <Clock3 size={14} className="text-[var(--brand)]" aria-hidden="true" />
            Quiet hours · Asia/Colombo
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
              Starts at
              <select
                value={preferences.quietHoursStart}
                onChange={(event) =>
                  onChange({ ...preferences, quietHoursStart: event.target.value })
                }
                className="h-11 rounded-xl border border-[var(--line)] bg-slate-50 px-3 text-sm font-semibold text-slate-800 outline-none focus:border-[var(--brand)] focus:bg-white"
              >
                {TIME_OPTIONS.map((time) => (
                  <option key={time}>{time}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
              Ends at
              <select
                value={preferences.quietHoursEnd}
                onChange={(event) =>
                  onChange({ ...preferences, quietHoursEnd: event.target.value })
                }
                className="h-11 rounded-xl border border-[var(--line)] bg-slate-50 px-3 text-sm font-semibold text-slate-800 outline-none focus:border-[var(--brand)] focus:bg-white"
              >
                {TIME_OPTIONS.map((time) => (
                  <option key={time}>{time}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="mt-2 text-[10px] leading-4 text-slate-500">
            This preview never schedules, pauses, or sends a real message.
          </p>
        </section>

        <section className="border-t border-[var(--line)] pt-5" aria-labelledby="quality-thresholds-title">
          <h3
            id="quality-thresholds-title"
            className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-slate-500"
          >
            <Gauge size={14} className="text-[var(--brand)]" aria-hidden="true" />
            Sample SLA and quality thresholds
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <NumberPreference
              label="First-response SLA"
              value={preferences.firstResponseSlaMinutes}
              min={1}
              max={60}
              suffix="minutes"
              onChange={(value) =>
                onChange({ ...preferences, firstResponseSlaMinutes: value })
              }
            />
            <NumberPreference
              label="Handoff acknowledgement SLA"
              value={preferences.handoffAckSlaMinutes}
              min={1}
              max={30}
              suffix="minutes"
              onChange={(value) =>
                onChange({ ...preferences, handoffAckSlaMinutes: value })
              }
            />
            <NumberPreference
              label="Quality review sample"
              value={preferences.qualityReviewPercent}
              min={1}
              max={100}
              suffix="percent"
              onChange={(value) =>
                onChange({ ...preferences, qualityReviewPercent: value })
              }
            />
            <NumberPreference
              label="Quality target"
              value={preferences.qualityTargetPercent}
              min={50}
              max={100}
              suffix="percent"
              onChange={(value) =>
                onChange({ ...preferences, qualityTargetPercent: value })
              }
            />
          </div>
          <p className="mt-3 rounded-xl bg-blue-50 px-3 py-2.5 text-[11px] leading-5 text-blue-800">
            Thresholds annotate synthetic queues and QA fixtures only. They are not Hemas
            service levels, staffing commitments, clinical targets, or monitoring rules.
          </p>
        </section>
      </div>
    </article>
  );
}

function NumberPreference({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: "minutes" | "percent";
  onChange: (value: number) => void;
}) {
  return (
    <label className="rounded-xl border border-[var(--line)] p-3.5">
      <span className="block text-xs font-semibold text-slate-700">{label}</span>
      <span className="mt-2 flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(event) => {
            const nextValue = event.target.valueAsNumber;
            onChange(Number.isFinite(nextValue) ? nextValue : min);
          }}
          className="h-10 min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-slate-50 px-3 text-sm font-bold tabular-nums text-slate-900 outline-none focus:border-[var(--brand)] focus:bg-white"
        />
        <span className="w-16 text-[10px] font-semibold text-slate-500">
          {suffix === "percent" ? "%" : suffix}
        </span>
      </span>
      <span className="mt-1.5 block text-[10px] text-slate-400">
        Allowed local range: {min}–{max}{suffix === "percent" ? "%" : " minutes"}
      </span>
    </label>
  );
}
