import {
  Ban,
  CheckCircle2,
  Clock3,
  DatabaseZap,
  FlaskConical,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { StatusPill } from "@/components/ui/status-pill";

export type JourneyEvent = {
  readonly id: number;
  readonly title: string;
  readonly detail: string;
  readonly time: string;
  readonly tone?: "success" | "warning" | "info" | "neutral";
};

export function SimulationBoundary({
  title,
  description,
  systemLabel,
}: {
  title: string;
  description: string;
  systemLabel: string;
}) {
  return (
    <section
      className="overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-emerald-50 shadow-[0_1px_2px_rgba(23,34,31,0.03)]"
      aria-labelledby="simulation-boundary-title"
    >
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-800">
            <DatabaseZap size={20} aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="simulation-boundary-title" className="text-sm font-bold text-slate-950 sm:text-[15px]">
                {title}
              </h2>
              <StatusPill tone="warning" dot>{systemLabel}</StatusPill>
            </div>
            <p className="mt-1.5 max-w-4xl text-xs leading-5 text-slate-600 sm:text-sm sm:leading-6">
              {description}
            </p>
          </div>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 text-center text-[10px] font-bold uppercase tracking-[0.06em] sm:flex">
          <span className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-emerald-800">
            Network calls · 0
          </span>
          <span className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-amber-800">
            External writes · 0
          </span>
        </div>
      </div>
    </section>
  );
}

export function JourneyTimeline({
  events,
  emptyText,
}: {
  events: readonly JourneyEvent[];
  emptyText: string;
}) {
  return (
    <section aria-labelledby="journey-timeline-title">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="journey-timeline-title" className="text-[15px] font-bold text-slate-950">Local event trail</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">Browser-memory events, newest first</p>
        </div>
        <StatusPill tone="neutral">Not persisted</StatusPill>
      </div>

      {events.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
          <Clock3 className="mx-auto text-slate-400" size={22} aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold text-slate-700">No journey events yet</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">{emptyText}</p>
        </div>
      ) : (
        <ol className="mt-4 space-y-3" aria-live="polite">
          {events.map((event, index) => (
            <li key={event.id} className="relative flex gap-3">
              {index < events.length - 1 ? (
                <span className="absolute bottom-[-14px] left-[15px] top-8 w-px bg-slate-200" aria-hidden="true" />
              ) : null}
              <span className={`relative z-10 mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${
                event.tone === "success"
                  ? "bg-emerald-100 text-emerald-700"
                  : event.tone === "warning"
                    ? "bg-amber-100 text-amber-700"
                    : event.tone === "info"
                      ? "bg-cyan-100 text-cyan-700"
                      : "bg-slate-100 text-slate-600"
              }`}>
                <CheckCircle2 size={15} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1 rounded-xl bg-slate-50 px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs font-bold text-slate-900">{event.title}</p>
                  <time className="shrink-0 text-[10px] font-semibold text-slate-400">{event.time}</time>
                </div>
                <p className="mt-1 text-[11px] leading-5 text-slate-600">{event.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function SafeEmptyState({
  icon = "flask",
  title,
  description,
  action,
}: {
  icon?: "flask" | "shield" | "blocked";
  title: string;
  description: string;
  action?: ReactNode;
}) {
  const Icon = icon === "shield" ? ShieldCheck : icon === "blocked" ? Ban : FlaskConical;
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-white text-slate-500 shadow-sm">
        <Icon size={20} aria-hidden="true" />
      </span>
      <h3 className="mt-3 text-sm font-bold text-slate-900">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-slate-500">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
