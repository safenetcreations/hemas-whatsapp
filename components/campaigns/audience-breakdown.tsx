import { Languages } from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";
import type { CampaignWorkspaceRecord } from "./campaign-workspace-data";
import { formatNumber, formatPercent } from "./formatters";

type ExclusionReason = keyof CampaignWorkspaceRecord["audience"]["exclusionsByReason"];

const exclusionRows: readonly {
  reason: ExclusionReason;
  label: string;
  detail: string;
  barClass: string;
}[] = [
  {
    reason: "suppressed",
    label: "Suppressed",
    detail: "STOP, complaint, hold, or active suppression",
    barClass: "bg-red-500",
  },
  {
    reason: "invalid_contact",
    label: "Invalid contact",
    detail: "Synthetic record failed deterministic validation",
    barClass: "bg-rose-400",
  },
  {
    reason: "consent_missing",
    label: "Consent missing",
    detail: "No qualifying marketing-consent evidence",
    barClass: "bg-amber-500",
  },
  {
    reason: "frequency_cap",
    label: "Frequency cap",
    detail: "Recent synthetic contact limit reached",
    barClass: "bg-violet-500",
  },
  {
    reason: "duplicate",
    label: "Duplicate",
    detail: "Deterministic identity already represented",
    barClass: "bg-blue-500",
  },
  {
    reason: "language_unavailable",
    label: "Language unavailable",
    detail: "No matching internal language version",
    barClass: "bg-cyan-500",
  },
];

export function AudienceBreakdown({
  snapshot,
}: {
  snapshot: CampaignWorkspaceRecord["audience"];
}) {
  const eligibleWidth = snapshot.totalEvaluated
    ? (snapshot.eligibleCount / snapshot.totalEvaluated) * 100
    : 0;
  const excludedWidth = 100 - eligibleWidth;
  const summedExclusions = exclusionRows.reduce(
    (sum, row) => sum + snapshot.exclusionsByReason[row.reason],
    0,
  );

  return (
    <article className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_1px_2px_rgba(23,34,31,0.03)]">
      <div className="border-b border-[var(--line)] px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--brand)]">
              Immutable audience snapshot
            </p>
            <h2 className="mt-1 text-[15px] font-bold text-slate-950">
              Exact aggregate eligibility evidence
            </h2>
          </div>
          <StatusPill tone="success">
            {formatNumber(snapshot.totalEvaluated)} reconciled
          </StatusPill>
        </div>
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
          {snapshot.criteriaSummary} No recipient array, contact identity, or HMAC is
          downloaded by this view.
        </p>
      </div>

      <div className="p-4 sm:p-5">
        <div
          className="flex h-3 overflow-hidden rounded-full bg-slate-100"
          role="img"
          aria-label={`${formatNumber(snapshot.eligibleCount)} eligible and ${formatNumber(snapshot.excludedCount)} excluded`}
        >
          <span className="bg-emerald-500" style={{ width: `${eligibleWidth}%` }} />
          <span className="bg-amber-400" style={{ width: `${excludedWidth}%` }} />
        </div>

        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            ["Eligible", snapshot.eligibleCount, "emerald"],
            ["Excluded", snapshot.excludedCount, "amber"],
          ].map(([label, count, tone]) => (
            <div
              key={String(label)}
              className={`rounded-xl border p-3.5 ${
                tone === "emerald"
                  ? "border-emerald-100 bg-emerald-50/70"
                  : "border-amber-100 bg-amber-50/70"
              }`}
            >
              <dt className="text-xs font-semibold text-slate-700">{label}</dt>
              <dd className="mt-1 flex items-end justify-between gap-2">
                <strong className="text-xl tracking-[-0.03em] text-slate-950">
                  {formatNumber(Number(count))}
                </strong>
                <span className="text-xs font-semibold text-slate-600">
                  {formatPercent(Number(count), snapshot.totalEvaluated)}
                </span>
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-slate-500">
              Exclusion ledger
            </h3>
            <span className="text-[11px] text-slate-500">
              Sum {formatNumber(summedExclusions)}
            </span>
          </div>
          <div className="mt-2 divide-y divide-[var(--line)]">
            {exclusionRows.map((row) => {
              const count = snapshot.exclusionsByReason[row.reason];
              const width = snapshot.excludedCount
                ? (count / snapshot.excludedCount) * 100
                : 0;
              return (
                <div
                  className="grid gap-2 py-3 sm:grid-cols-[minmax(170px,0.9fr)_minmax(160px,1fr)_74px] sm:items-center"
                  key={row.reason}
                >
                  <div>
                    <p className="text-xs font-semibold text-slate-800">{row.label}</p>
                    <p className="mt-0.5 text-[10px] leading-4 text-slate-500">
                      {row.detail}
                    </p>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <span
                      className={`block h-full rounded-full ${row.barClass}`}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                  <div className="text-left sm:text-right">
                    <span className="text-xs font-bold tabular-nums text-slate-900">
                      {formatNumber(count)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-[11px] leading-5 text-slate-600">
            Unknown consent is {formatNumber(snapshot.unknownConsentCount)} and is
            included exactly once in consent missing.
          </p>
        </div>

        <div className="mt-5 border-t border-[var(--line)] pt-4">
          <div className="flex items-center gap-2">
            <Languages size={15} className="text-[var(--brand)]" aria-hidden="true" />
            <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-slate-500">
              Language across evaluated records
            </h3>
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2">
            {[
              ["English", snapshot.languageCounts.en],
              ["සිංහල", snapshot.languageCounts.si],
              ["தமிழ்", snapshot.languageCounts.ta],
            ].map(([label, count]) => (
              <div className="rounded-xl bg-slate-50 p-3" key={String(label)}>
                <dt className="text-[10px] font-semibold text-slate-500">{label}</dt>
                <dd className="mt-1 text-sm font-bold tabular-nums text-slate-900">
                  {formatNumber(Number(count))}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </article>
  );
}
