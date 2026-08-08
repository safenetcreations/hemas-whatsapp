import { Activity, DatabaseZap, FileClock } from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";
import type { CampaignWorkspaceRecord } from "./campaign-workspace-data";
import { formatDate, formatNumber } from "./formatters";

export function CampaignEvidencePanel({
  record,
}: {
  record: CampaignWorkspaceRecord;
}) {
  const events = record.events.slice(0, 8);
  const checkpoints = record.checkpoints.slice(0, 6);

  return (
    <section className="grid min-w-0 gap-6 xl:grid-cols-2" aria-label="Persisted campaign evidence">
      <article className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_1px_2px_rgba(23,34,31,0.03)]">
        <div className="border-b border-[var(--line)] px-4 py-4 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--brand)]">
                Content-free lifecycle evidence
              </p>
              <h2 className="mt-1 text-[15px] font-bold text-slate-950">
                Latest authoritative events
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Bounded metadata only. No recipient, message, contact, or provider payload.
              </p>
            </div>
            <FileClock className="shrink-0 text-[var(--brand)]" size={19} aria-hidden="true" />
          </div>
        </div>
        {events.length === 0 ? (
          <div className="grid min-h-52 place-items-center p-6 text-center" role="status">
            <div>
              <Activity className="mx-auto text-slate-300" size={25} aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold text-slate-700">
                No persisted actions yet
              </p>
              <p className="mt-1 text-xs text-slate-500">
                The scheduled seed is still at revision zero.
              </p>
            </div>
          </div>
        ) : (
          <ol className="divide-y divide-[var(--line)]">
            {events.map((event) => (
              <li className="flex items-start gap-3 px-4 py-3.5 sm:px-5" key={event.id}>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700">
                  <Activity size={14} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-bold text-slate-900">
                      {event.action.replaceAll("_", " ")}
                    </p>
                    <span className="text-[10px] font-semibold text-slate-500">
                      revision {event.revision}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-600">
                    {event.fromState.replaceAll("_", " ")} → {event.toState.replaceAll("_", " ")}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-400">
                    {formatDate(event.createdAt)} · external 0 · network 0
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </article>

      <article className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_1px_2px_rgba(23,34,31,0.03)]">
        <div className="border-b border-[var(--line)] px-4 py-4 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--brand)]">
                Bounded queue checkpoints
              </p>
              <h2 className="mt-1 text-[15px] font-bold text-slate-950">
                Latest persisted batches
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Aggregate offsets and counts only; digest values are not rendered.
              </p>
            </div>
            <DatabaseZap className="shrink-0 text-violet-700" size={19} aria-hidden="true" />
          </div>
        </div>
        {checkpoints.length === 0 ? (
          <div className="grid min-h-52 place-items-center p-6 text-center" role="status">
            <div>
              <DatabaseZap className="mx-auto text-slate-300" size={25} aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold text-slate-700">
                No checkpoint written
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Start and advance the simulation through the audited callable.
              </p>
            </div>
          </div>
        ) : (
          <ol className="divide-y divide-[var(--line)]">
            {checkpoints.map((checkpoint) => (
              <li className="px-4 py-3.5 sm:px-5" key={checkpoint.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-bold text-slate-900">
                    Batch {checkpoint.batchIndex + 1}
                  </p>
                  <StatusPill tone={checkpoint.scanComplete ? "success" : "info"}>
                    {checkpoint.scanComplete ? "Final scan" : `${formatNumber(checkpoint.eligibleCount)} eligible`}
                  </StatusPill>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-slate-500">
                  <div>
                    <dt>Source offset</dt>
                    <dd className="mt-0.5 font-semibold text-slate-700">
                      {formatNumber(checkpoint.sourceOffsetStart)}–{formatNumber(checkpoint.sourceOffsetEnd)}
                    </dd>
                  </div>
                  <div>
                    <dt>Cumulative eligible</dt>
                    <dd className="mt-0.5 font-semibold text-slate-700">
                      {formatNumber(checkpoint.processedEligible)}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ol>
        )}
      </article>
    </section>
  );
}
