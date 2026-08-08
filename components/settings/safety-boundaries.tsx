import { CheckCircle2, LockKeyhole, ShieldCheck } from "lucide-react";

import { StatusPill } from "@/components/ui/status-pill";

import {
  IMMUTABLE_SAFETY_FLAGS,
  LOCKED_CONFIGURATION,
} from "./settings-data";

export function ImmutableSafetyFlags() {
  return (
    <article className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-emerald-800">
            Immutable environment safety
          </p>
          <h2 className="mt-1 text-[15px] font-bold text-emerald-950">
            Fail-closed demo flags
          </h2>
        </div>
        <ShieldCheck size={20} className="text-emerald-700" aria-hidden="true" />
      </div>
      <div className="mt-4 space-y-2.5">
        {IMMUTABLE_SAFETY_FLAGS.map((flag) => (
          <div className="rounded-xl bg-white/80 p-3" key={flag.label}>
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-xs font-semibold text-emerald-950">
                <CheckCircle2 size={14} className="text-emerald-600" aria-hidden="true" />
                {flag.label}
              </p>
              <StatusPill tone="success">{flag.value}</StatusPill>
            </div>
            <p className="mt-1.5 pl-[22px] text-[10px] leading-4 text-emerald-800">
              {flag.detail}
            </p>
          </div>
        ))}
      </div>
    </article>
  );
}

export function LockedConfigurationPanel() {
  return (
    <article className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_1px_2px_rgba(23,34,31,0.03)]">
      <div className="flex flex-col gap-3 border-b border-[var(--line)] px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-red-700">
            Server and governance boundary
          </p>
          <h2 className="mt-1 text-[15px] font-bold text-slate-950">
            Production-sensitive settings are unavailable
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
            These controls require ownership, approvals, and server-side enforcement.
            This page intentionally contains no secret or credential fields.
          </p>
        </div>
        <StatusPill tone="danger" dot>
          Locked
        </StatusPill>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">
        {LOCKED_CONFIGURATION.map((item) => (
          <section className="rounded-xl border border-slate-200 bg-slate-50 p-3.5" key={item.title}>
            <div className="flex items-center gap-2">
              <LockKeyhole size={15} className="shrink-0 text-slate-500" aria-hidden="true" />
              <h3 className="text-xs font-bold text-slate-800">{item.title}</h3>
            </div>
            <p className="mt-2 text-[10px] leading-4 text-slate-500">{item.detail}</p>
            <button
              type="button"
              disabled
              className="mt-3 h-8 w-full cursor-not-allowed rounded-lg bg-slate-200 text-[10px] font-bold uppercase tracking-[0.06em] text-slate-400"
            >
              Unavailable in demo
            </button>
          </section>
        ))}
      </div>
    </article>
  );
}
