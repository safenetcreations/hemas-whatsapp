import {
  CheckCircle2,
  CircleAlert,
  GitCompareArrows,
  Info,
} from "lucide-react";

import { StatusPill } from "@/components/ui/status-pill";

import type { PreferenceImpact } from "./settings-data";

export function ChangeImpactPreview({
  impacts,
  errors,
}: {
  impacts: readonly PreferenceImpact[];
  errors: readonly string[];
}) {
  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--brand)]">
            Change-impact preview
          </p>
          <h2 className="mt-1 text-[15px] font-bold text-slate-950">
            Local draft comparison
          </h2>
        </div>
        <GitCompareArrows size={20} className="text-[var(--brand)]" aria-hidden="true" />
      </div>

      {errors.length > 0 ? (
        <div
          className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3"
          role="alert"
          aria-labelledby="preference-errors-title"
        >
          <p
            id="preference-errors-title"
            className="flex items-center gap-2 text-xs font-bold text-red-900"
          >
            <CircleAlert size={15} aria-hidden="true" /> Resolve before applying
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] leading-5 text-red-800">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {impacts.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-5 text-center" role="status">
          <CheckCircle2 className="mx-auto text-emerald-600" size={23} aria-hidden="true" />
          <p className="mt-2 text-xs font-bold text-slate-800">No unsaved preference changes</p>
          <p className="mt-1 text-[10px] leading-4 text-slate-500">
            Edit a local preference to preview its exact scope before applying it to this tab.
          </p>
        </div>
      ) : (
        <ol className="mt-4 space-y-3" aria-label="Unsaved preference impacts">
          {impacts.map((impact) => (
            <li className="rounded-xl border border-slate-200 p-3" key={impact.id}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-bold text-slate-800">{impact.setting}</p>
                <StatusPill tone={impact.tone}>{impact.tone === "warning" ? "Review" : "Local"}</StatusPill>
              </div>
              <dl className="mt-2 grid gap-2 text-[10px] sm:grid-cols-2">
                <div className="rounded-lg bg-slate-50 p-2.5">
                  <dt className="font-semibold text-slate-500">Current tab value</dt>
                  <dd className="mt-1 font-bold leading-4 text-slate-800">{impact.before}</dd>
                </div>
                <div className="rounded-lg bg-blue-50 p-2.5">
                  <dt className="font-semibold text-blue-700">Draft value</dt>
                  <dd className="mt-1 font-bold leading-4 text-blue-950">{impact.after}</dd>
                </div>
              </dl>
              <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-4 text-slate-500">
                <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                {impact.effect}
              </p>
            </li>
          ))}
        </ol>
      )}

      <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2.5 text-[11px] leading-5 text-amber-900">
        Applying changes updates React state in this browser tab only. Nothing is stored,
        synchronized, scheduled, or sent.
      </p>
    </article>
  );
}
