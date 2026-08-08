import {
  CheckCircle2,
  CircleAlert,
  FileCheck2,
  LockKeyhole,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import type { CampaignPreflightCheck } from "./campaign-control-data";
import type { CampaignWorkspaceRecord } from "./campaign-workspace-data";
import { formatDate } from "./formatters";

export function PreflightPanel({
  checks,
}: {
  checks: readonly CampaignPreflightCheck[];
}) {
  const passedCount = checks.filter((check) => check.pass).length;
  const ready = passedCount === checks.length;

  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--brand)]">
            Persisted preflight evidence
          </p>
          <h2 className="mt-1 text-[15px] font-bold text-slate-950">
            {ready ? "Synthetic controls reconciled" : "Campaign controls blocked"}
          </h2>
        </div>
        <span
          className={`grid h-10 w-10 place-items-center rounded-xl ${
            ready ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
          }`}
        >
          {ready ? <ShieldCheck size={19} aria-hidden="true" /> : <CircleAlert size={19} aria-hidden="true" />}
        </span>
      </div>
      <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
        <span className="text-xs font-semibold text-slate-700">Checks passed</span>
        <strong className="text-sm tabular-nums text-slate-950">
          {passedCount}/{checks.length}
        </strong>
      </div>
      <ul className="mt-3 space-y-2" aria-label="Campaign governance checks">
        {checks.map((check) => (
          <li className="flex items-start gap-2.5 rounded-xl border border-slate-100 px-3 py-2.5" key={check.label}>
            {check.pass ? (
              <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={15} aria-hidden="true" />
            ) : (
              <XCircle className="mt-0.5 shrink-0 text-red-600" size={15} aria-hidden="true" />
            )}
            <span>
              <span className="block text-xs font-semibold text-slate-800">{check.label}</span>
              <span className="mt-0.5 block text-[10px] leading-4 text-slate-500">{check.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}

export function ApprovalEvidence({ record }: { record: CampaignWorkspaceRecord }) {
  const { approval } = record.campaign;

  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--brand)]">
            SafeNet internal governance
          </p>
          <h2 className="mt-1 text-[15px] font-bold text-slate-950">
            Simulation-only approval evidence
          </h2>
        </div>
        <FileCheck2 size={20} className="text-emerald-700" aria-hidden="true" />
      </div>

      <dl className="mt-4 space-y-3">
        <div className="rounded-xl bg-slate-50 p-3">
          <dt className="text-[10px] font-bold uppercase tracking-[0.07em] text-slate-500">
            Local decision
          </dt>
          <dd className="mt-1 flex items-center gap-2 text-xs font-semibold text-slate-900">
            <CheckCircle2 size={14} className="text-emerald-600" aria-hidden="true" />
            Approved for deterministic simulation only
          </dd>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-[var(--line)] p-3">
            <dt className="text-[10px] font-semibold text-slate-500">Approver separation</dt>
            <dd className="mt-1 text-xs font-bold leading-5 text-slate-900">Owner differs from approver</dd>
          </div>
          <div className="rounded-xl border border-[var(--line)] p-3">
            <dt className="text-[10px] font-semibold text-slate-500">Reviewed</dt>
            <dd className="mt-1 text-xs font-bold leading-5 text-slate-900">{formatDate(approval.reviewedAt)}</dd>
          </div>
        </div>
        <div className="rounded-xl border border-[var(--line)] p-3">
          <dt className="text-[10px] font-semibold text-slate-500">Approval binding</dt>
          <dd className="mt-1 text-[11px] leading-5 text-slate-700">
            Audience hash, all three template IDs, purpose, target action, schedule,
            timezone, and quiet hours were re-hashed and verified by the loader.
          </dd>
        </div>
      </dl>

      <div className="mt-3 space-y-2">
        {record.templates.map((template) => (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2.5" key={template.id}>
            <span className="text-[11px] font-semibold uppercase text-amber-950">
              {template.language} · internal approved v{template.version}
            </span>
            <span className="text-[10px] font-bold text-amber-800">
              provider not submitted · unverified
            </span>
          </div>
        ))}
      </div>

      <p className="mt-3 flex items-start gap-2 text-[11px] leading-5 text-red-700">
        <LockKeyhole size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        This is not Meta approval, not Hemas ownership, and cannot authorize external delivery.
      </p>
    </article>
  );
}
