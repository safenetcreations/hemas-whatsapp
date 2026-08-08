import {
  Ban,
  DatabaseZap,
  LockKeyhole,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";

import { StatusPill } from "@/components/ui/status-pill";

export function LiveAnalyticsLock({ context }: { context: "analytics" | "usage" }) {
  const label = context === "analytics" ? "Live analytics" : "Live billing and usage";

  return (
    <section
      className="overflow-hidden rounded-2xl border border-red-200 bg-gradient-to-r from-red-50 via-white to-amber-50 shadow-[0_1px_2px_rgba(23,34,31,0.03)]"
      aria-labelledby={`${context}-lock-title`}
    >
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-red-100 text-red-700">
            <LockKeyhole size={20} aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id={`${context}-lock-title`}
                className="text-sm font-bold text-slate-950 sm:text-[15px]"
              >
                {label} unavailable
              </h2>
              <StatusPill tone="danger" dot>
                Production disconnected
              </StatusPill>
            </div>
            <p className="mt-1.5 max-w-3xl text-xs leading-5 text-slate-600 sm:text-sm sm:leading-6">
              Every value on this page comes from deterministic aggregate fixtures.
              There are no provider connections, production events, message bodies,
              patient identities, exports, or network requests.
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled
          title="Unavailable until production governance, ownership, connections, and verification are complete"
          className="inline-flex h-10 shrink-0 cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-slate-200 px-4 text-sm font-semibold text-slate-500"
        >
          <Ban size={16} aria-hidden="true" /> Open live view
        </button>
      </div>
    </section>
  );
}

export function AggregateMetric({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone: "emerald" | "blue" | "amber" | "violet";
}) {
  const toneClasses = {
    emerald: "bg-emerald-50 text-emerald-700",
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    violet: "bg-violet-50 text-violet-700",
  };

  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-[var(--muted)]">{label}</p>
          <p className="mt-2 text-2xl font-bold tracking-[-0.035em] text-slate-950">
            {value}
          </p>
        </div>
        <span
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${toneClasses[tone]}`}
        >
          <Icon size={18} aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 text-[11px] leading-5 text-slate-500">{detail}</p>
    </article>
  );
}

export function AggregateEmptyState({
  title,
  description,
  onReset,
}: {
  title: string;
  description: string;
  onReset: () => void;
}) {
  return (
    <div
      className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-6 text-center"
      role="status"
    >
      <div className="max-w-sm">
        <DatabaseZap className="mx-auto text-slate-300" size={30} aria-hidden="true" />
        <h2 className="mt-3 text-sm font-bold text-slate-800">{title}</h2>
        <p className="mt-1.5 text-xs leading-5 text-slate-500">{description}</p>
        <button
          type="button"
          onClick={onReset}
          className="mt-4 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-slate-900 px-3.5 text-xs font-semibold text-white hover:bg-slate-800"
        >
          <RotateCcw size={14} aria-hidden="true" /> Reset filters
        </button>
      </div>
    </div>
  );
}
