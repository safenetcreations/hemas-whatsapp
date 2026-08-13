"use client";

import {
  Activity,
  BarChart3,
  CheckCircle2,
  Clock3,
  Handshake,
  Languages,
  MapPinned,
  ShieldCheck,
  Siren,
  UserRoundCheck,
} from "lucide-react";
import { useMemo, useState } from "react";

import { StatusPill } from "@/components/ui/status-pill";

import { DimensionFilterBar } from "./dimension-filters";
import { formatDuration, formatNumber, formatPercent } from "./formatters";
import { WhatsAppMetricsPanel } from "./whatsapp-metrics-panel";
import {
  ANALYTICS_SAMPLE_ROWS,
  DEFAULT_DIMENSION_FILTERS,
  JOURNEY_LABELS,
  LANGUAGE_LABELS,
  LOCATION_LABELS,
  PRIVACY_COHORT_THRESHOLD,
  SAMPLE_AGGREGATION_VERSION,
  SAMPLE_AS_OF_DATE,
  matchesDimensionFilters,
  type AnalyticsSampleRow,
  type DimensionFilters,
  type SampleJourney,
  type SampleLanguage,
  type SampleLocation,
} from "./sample-data";
import { AggregateEmptyState, AggregateMetric } from "./workspace-primitives";

interface AggregateTotals {
  entered: number;
  automationEligible: number;
  routed: number;
  completed: number;
  handoffs: number;
  safetyBlocks: number;
  urgentEscalations: number;
  responseWeight: number;
}

const EMPTY_TOTALS: AggregateTotals = {
  entered: 0,
  automationEligible: 0,
  routed: 0,
  completed: 0,
  handoffs: 0,
  safetyBlocks: 0,
  urgentEscalations: 0,
  responseWeight: 0,
};

function aggregateRows(rows: readonly AnalyticsSampleRow[]): AggregateTotals {
  return rows.reduce<AggregateTotals>(
    (totals, row) => ({
      entered: totals.entered + row.entered,
      automationEligible: totals.automationEligible + row.automationEligible,
      routed: totals.routed + row.routed,
      completed: totals.completed + row.completed,
      handoffs: totals.handoffs + row.handoffs,
      safetyBlocks: totals.safetyBlocks + row.safetyBlocks,
      urgentEscalations: totals.urgentEscalations + row.urgentEscalations,
      responseWeight: totals.responseWeight + row.responseSeconds * row.entered,
    }),
    EMPTY_TOTALS,
  );
}

function FunnelPanel({ totals }: { totals: AggregateTotals }) {
  const stages = [
    { label: "Entered sample journey", value: totals.entered, color: "bg-blue-500" },
    {
      label: "Automation eligible",
      value: totals.automationEligible,
      color: "bg-cyan-500",
    },
    { label: "Routed successfully", value: totals.routed, color: "bg-violet-500" },
    { label: "Mock goal completed", value: totals.completed, color: "bg-emerald-500" },
  ];

  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--brand)]">
            Operational funnel
          </p>
          <h2 className="mt-1 text-[15px] font-bold text-slate-950">
            Synthetic journey progression
          </h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Aggregate fixtures only; percentages use the filtered sample entry count.
          </p>
        </div>
        <BarChart3 size={20} className="shrink-0 text-[var(--brand)]" aria-hidden="true" />
      </div>

      <ol className="mt-5 space-y-4">
        {stages.map((stage) => {
          const width = totals.entered ? (stage.value / totals.entered) * 100 : 0;
          return (
            <li key={stage.label}>
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-semibold text-slate-700">{stage.label}</span>
                <span className="font-bold tabular-nums text-slate-900">
                  {formatNumber(stage.value)} · {formatPercent(stage.value, totals.entered)}
                </span>
              </div>
              <div
                className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100"
                role="progressbar"
                aria-label={`${stage.label}: ${formatNumber(stage.value)} sample events`}
                aria-valuemin={0}
                aria-valuemax={totals.entered}
                aria-valuenow={stage.value}
              >
                <span
                  className={`block h-full rounded-full ${stage.color}`}
                  style={{ width: `${width}%` }}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </article>
  );
}

function SafetyPanel({ totals }: { totals: AggregateTotals }) {
  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-red-700">
            Safety and handoff
          </p>
          <h2 className="mt-1 text-[15px] font-bold text-slate-950">
            Human control signals
          </h2>
        </div>
        <Siren size={20} className="shrink-0 text-red-600" aria-hidden="true" />
      </div>
      <dl className="mt-4 space-y-3">
        <div className="flex items-center justify-between gap-4 rounded-xl bg-blue-50 p-3">
          <dt className="flex items-center gap-2 text-xs font-semibold text-blue-900">
            <Handshake size={15} aria-hidden="true" /> Human handoffs
          </dt>
          <dd className="text-sm font-bold tabular-nums text-blue-950">
            {formatNumber(totals.handoffs)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-xl bg-amber-50 p-3">
          <dt className="flex items-center gap-2 text-xs font-semibold text-amber-900">
            <ShieldCheck size={15} aria-hidden="true" /> Safety blocks
          </dt>
          <dd className="text-sm font-bold tabular-nums text-amber-950">
            {formatNumber(totals.safetyBlocks)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-xl bg-red-50 p-3">
          <dt className="flex items-center gap-2 text-xs font-semibold text-red-900">
            <Siren size={15} aria-hidden="true" /> Urgent escalations
          </dt>
          <dd className="text-sm font-bold tabular-nums text-red-950">
            {formatNumber(totals.urgentEscalations)}
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-[11px] leading-5 text-slate-500">
        These counts exercise safeguard reporting; they do not describe Hemas operations
        or patient outcomes.
      </p>
    </article>
  );
}

function JourneyPerformanceTable({ rows }: { rows: readonly AnalyticsSampleRow[] }) {
  const journeyRows = (Object.keys(JOURNEY_LABELS) as SampleJourney[])
    .map((journey) => {
      const totals = aggregateRows(rows.filter((row) => row.journey === journey));
      return { journey, totals };
    })
    .filter(({ totals }) => totals.entered > 0);

  return (
    <article className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_1px_2px_rgba(23,34,31,0.03)]">
      <div className="border-b border-[var(--line)] px-4 py-4 sm:px-5">
        <h2 className="text-[15px] font-bold text-slate-950">Journey performance</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Privacy-preserving aggregates by journey; no conversation-level drill-down.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-left">
          <thead>
            <tr className="border-b border-[var(--line)] bg-slate-50/70 text-[9px] font-bold uppercase tracking-[0.08em] text-slate-500">
              <th className="px-5 py-3">Journey</th>
              <th className="px-4 py-3">Sample volume</th>
              <th className="px-4 py-3">Mock completion</th>
              <th className="px-4 py-3">Human handoff</th>
              <th className="px-5 py-3 text-right">Safety blocks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {journeyRows.map(({ journey, totals }) => (
              <tr className="text-xs hover:bg-slate-50/60" key={journey}>
                <td className="px-5 py-4 font-semibold text-slate-900">
                  {JOURNEY_LABELS[journey]}
                </td>
                <td className="px-4 py-4 tabular-nums text-slate-700">
                  {formatNumber(totals.entered)}
                </td>
                <td className="px-4 py-4 font-semibold text-emerald-700">
                  {formatPercent(totals.completed, totals.entered)}
                </td>
                <td className="px-4 py-4 font-semibold text-blue-700">
                  {formatPercent(totals.handoffs, totals.entered)}
                </td>
                <td className="px-5 py-4 text-right font-semibold text-amber-700">
                  {formatNumber(totals.safetyBlocks)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function DistributionPanel({ rows }: { rows: readonly AnalyticsSampleRow[] }) {
  const locations = (Object.keys(LOCATION_LABELS) as SampleLocation[])
    .map((location) => ({
      label: LOCATION_LABELS[location],
      value: rows
        .filter((row) => row.location === location)
        .reduce((sum, row) => sum + row.entered, 0),
    }))
    .filter((item) => item.value > 0);
  const languages = (Object.keys(LANGUAGE_LABELS) as SampleLanguage[])
    .map((language) => ({
      label: LANGUAGE_LABELS[language],
      value: rows
        .filter((row) => row.language === language)
        .reduce((sum, row) => sum + row.entered, 0),
    }))
    .filter((item) => item.value > 0);
  const total = rows.reduce((sum, row) => sum + row.entered, 0);

  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5">
      <h2 className="text-[15px] font-bold text-slate-950">Aggregate distribution</h2>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        Coarse dimensions only; small-cell detail is not exposed.
      </p>
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        {[
          { title: "Location", icon: MapPinned, items: locations },
          { title: "Language", icon: Languages, items: languages },
        ].map(({ title, icon: Icon, items }) => (
          <section key={title} aria-label={`${title} distribution`}>
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-slate-500">
              <Icon size={14} className="text-[var(--brand)]" aria-hidden="true" />
              {title}
            </h3>
            <div className="mt-3 space-y-3">
              {items.map((item) => (
                <div key={item.label}>
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-semibold text-slate-700">{item.label}</span>
                    <span className="tabular-nums text-slate-500">
                      {formatNumber(item.value)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <span
                      className="block h-full rounded-full bg-[var(--brand)]"
                      style={{ width: `${total ? (item.value / total) * 100 : 0}%` }}
                      aria-hidden="true"
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}

function PrivacyPanel() {
  return (
    <article className="overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
          <ShieldCheck size={19} aria-hidden="true" />
        </span>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-emerald-800">
            Privacy-preserving view
          </p>
          <h2 className="mt-1 text-[15px] font-bold text-emerald-950">
            Minimum aggregate disclosure
          </h2>
        </div>
      </div>
      <dl className="mt-4 grid gap-2 sm:grid-cols-2">
        {[
          ["Message bodies", "Excluded"],
          ["Direct identifiers", "Excluded"],
          ["Minimum cohort", `${PRIVACY_COHORT_THRESHOLD} fixtures`],
          ["Aggregate version", SAMPLE_AGGREGATION_VERSION],
        ].map(([label, value]) => (
          <div className="rounded-xl bg-white/80 p-3" key={label}>
            <dt className="text-[10px] font-semibold text-emerald-800">{label}</dt>
            <dd className="mt-1 break-all text-xs font-bold text-emerald-950">{value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export function AnalyticsWorkspace() {
  const [filters, setFilters] = useState<DimensionFilters>(DEFAULT_DIMENSION_FILTERS);
  const filteredRows = useMemo(
    () => ANALYTICS_SAMPLE_ROWS.filter((row) => matchesDimensionFilters(row, filters)),
    [filters],
  );
  const totals = useMemo(() => aggregateRows(filteredRows), [filteredRows]);
  const averageResponseSeconds = totals.entered
    ? totals.responseWeight / totals.entered
    : 0;

  return (
    <div className="space-y-6 lg:space-y-8">
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700">
            <BarChart3 size={21} aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--brand)]">
                Governed operational reporting
              </p>
              <StatusPill tone="info" dot>
                Automatic + scenario views
              </StatusPill>
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-[-0.035em] text-slate-950 sm:text-3xl">
              Analytics workspace
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              Review content-free WhatsApp counters from the authenticated workspace,
              then explore the clearly separated deterministic scenario model below.
            </p>
          </div>
        </div>
      </section>

      <WhatsAppMetricsPanel />

      <section
        className="space-y-6 border-t border-[var(--line)] pt-6 lg:space-y-8 lg:pt-8"
        aria-labelledby="scenario-analytics-title"
      >
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-violet-700">
                Separate deterministic model
              </p>
              <StatusPill tone="info" dot>
                Fixtures only
              </StatusPill>
            </div>
            <h2
              id="scenario-analytics-title"
              className="mt-1 text-xl font-bold tracking-[-0.025em] text-slate-950"
            >
              Scenario analytics
            </h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600 sm:text-sm sm:leading-6">
              Explore synthetic funnels, handoffs and safeguards. These values do not come
              from the automatic WhatsApp feed and are not Hemas performance claims.
            </p>
          </div>
          <StatusPill tone="neutral">Fixture as of {SAMPLE_AS_OF_DATE}</StatusPill>
        </div>

        <DimensionFilterBar
          filters={filters}
          onChange={setFilters}
          resultCount={filteredRows.length}
        />

        {filteredRows.length === 0 ? (
          <AggregateEmptyState
            title="No aggregate fixture matches"
            description="This combination has no deterministic sample cell. Nothing was inferred or backfilled."
            onReset={() => setFilters(DEFAULT_DIMENSION_FILTERS)}
          />
        ) : (
          <>
            <section
              className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
              aria-label="Filtered sample analytics"
            >
              <AggregateMetric
                label="Sample journey entries"
                value={formatNumber(totals.entered)}
                detail={`${filteredRows.length} deterministic aggregate slices`}
                icon={Activity}
                tone="blue"
              />
              <AggregateMetric
                label="Mock completion"
                value={formatPercent(totals.completed, totals.entered)}
                detail={`${formatNumber(totals.completed)} completed fixture goals`}
                icon={CheckCircle2}
                tone="emerald"
              />
              <AggregateMetric
                label="Human handoff"
                value={formatPercent(totals.handoffs, totals.entered)}
                detail={`${formatNumber(totals.handoffs)} sample handoff events`}
                icon={UserRoundCheck}
                tone="violet"
              />
              <AggregateMetric
                label="Weighted response"
                value={formatDuration(averageResponseSeconds)}
                detail="Generated sample timing; not a service-level result"
                icon={Clock3}
                tone="amber"
              />
            </section>

            <section className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.7fr)]">
              <FunnelPanel totals={totals} />
              <SafetyPanel totals={totals} />
            </section>

            <JourneyPerformanceTable rows={filteredRows} />

            <section className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
              <DistributionPanel rows={filteredRows} />
              <PrivacyPanel />
            </section>
          </>
        )}
      </section>
    </div>
  );
}
