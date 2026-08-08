"use client";

import {
  Activity,
  Calculator,
  CircleDollarSign,
  Download,
  Layers3,
  ReceiptText,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState } from "react";

import { StatusPill } from "@/components/ui/status-pill";

import { DimensionFilterBar } from "./dimension-filters";
import { formatLkrRange, formatNumber } from "./formatters";
import {
  CHANNEL_LABELS,
  DEFAULT_DIMENSION_FILTERS,
  EVENT_LABELS,
  SAMPLE_AS_OF_DATE,
  USAGE_SAMPLE_ROWS,
  matchesDimensionFilters,
  type DimensionFilters,
  type UsageChannel,
  type UsageEvent,
  type UsageSampleRow,
} from "./sample-data";
import {
  AggregateEmptyState,
  AggregateMetric,
  LiveAnalyticsLock,
} from "./workspace-primitives";

type ChannelFilter = "all" | UsageChannel;
type EventFilter = "all" | UsageEvent;

function UsageSecondaryFilters({
  channel,
  event,
  onChannelChange,
  onEventChange,
  onReset,
}: {
  channel: ChannelFilter;
  event: EventFilter;
  onChannelChange: (value: ChannelFilter) => void;
  onEventChange: (value: EventFilter) => void;
  onReset: () => void;
}) {
  const active = channel !== "all" || event !== "all";

  return (
    <div className="grid gap-3 border-t border-[var(--line)] pt-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
      <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
        Synthetic channel
        <select
          value={channel}
          onChange={(changeEvent) =>
            onChannelChange(changeEvent.target.value as ChannelFilter)
          }
          className="h-10 rounded-xl border border-[var(--line)] bg-slate-50 px-3 text-sm font-medium text-slate-800 outline-none focus:border-[var(--brand)] focus:bg-white"
        >
          <option value="all">All synthetic channels</option>
          {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
        Event type
        <select
          value={event}
          onChange={(changeEvent) =>
            onEventChange(changeEvent.target.value as EventFilter)
          }
          className="h-10 rounded-xl border border-[var(--line)] bg-slate-50 px-3 text-sm font-medium text-slate-800 outline-none focus:border-[var(--brand)] focus:bg-white"
        >
          <option value="all">All event types</option>
          {Object.entries(EVENT_LABELS).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={!active}
        onClick={onReset}
        className="h-10 rounded-xl border border-[var(--line)] px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
      >
        Clear ledger filters
      </button>
    </div>
  );
}

function UsageLedgerTable({ rows }: { rows: readonly UsageSampleRow[] }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_1px_2px_rgba(23,34,31,0.03)]">
      <div className="flex flex-col gap-3 border-b border-[var(--line)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--brand)]">
            Deterministic usage ledger
          </p>
          <h2 className="mt-1 text-[15px] font-bold text-slate-950">
            Channel, function, and event counts
          </h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Counts are aggregate fixtures; cost bands are fictional planning values.
          </p>
        </div>
        <StatusPill tone="warning">Non-billing data</StatusPill>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] text-left">
          <thead>
            <tr className="border-b border-[var(--line)] bg-slate-50/70 text-[9px] font-bold uppercase tracking-[0.08em] text-slate-500">
              <th className="px-5 py-3">Channel</th>
              <th className="px-4 py-3">Function</th>
              <th className="px-4 py-3">Event</th>
              <th className="px-4 py-3">Count</th>
              <th className="px-5 py-3 text-right">Fictional range</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {rows.map((row) => (
              <tr className="text-xs hover:bg-slate-50/60" key={row.id}>
                <td className="px-5 py-4 font-semibold text-slate-900">
                  {CHANNEL_LABELS[row.channel]}
                </td>
                <td className="px-4 py-4 text-slate-700">{row.functionLabel}</td>
                <td className="px-4 py-4 text-slate-600">
                  {EVENT_LABELS[row.event]}
                </td>
                <td className="px-4 py-4 font-semibold tabular-nums text-slate-800">
                  {formatNumber(row.count)} {row.unit}
                </td>
                <td className="px-5 py-4 text-right">
                  <div className="font-semibold tabular-nums text-slate-800">
                    {formatLkrRange(row.costLowLkr, row.costHighLkr)}
                  </div>
                  <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.06em] text-amber-700">
                    Non-billing simulation
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-2 border-t border-[var(--line)] px-5 py-3 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <span>{rows.length} synthetic ledger rows · no reference IDs or message bodies</span>
        <button
          type="button"
          disabled
          title="Invoices and ledger exports are unavailable in the synthetic prototype"
          className="inline-flex cursor-not-allowed items-center gap-1.5 text-slate-400"
        >
          <Download size={13} aria-hidden="true" /> Invoice/export unavailable
        </button>
      </div>
    </article>
  );
}

function ChannelSummary({ rows }: { rows: readonly UsageSampleRow[] }) {
  const channels = (Object.keys(CHANNEL_LABELS) as UsageChannel[])
    .map((channel) => ({
      channel,
      value: rows
        .filter((row) => row.channel === channel)
        .reduce((sum, row) => sum + row.count, 0),
    }))
    .filter((item) => item.value > 0);
  const maximum = Math.max(...channels.map((item) => item.value), 1);

  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-slate-950">Count by channel</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Relative volume across the filtered local ledger.
          </p>
        </div>
        <Layers3 size={19} className="text-[var(--brand)]" aria-hidden="true" />
      </div>
      <div className="mt-5 space-y-4">
        {channels.map(({ channel, value }) => (
          <div key={channel}>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-semibold text-slate-700">
                {CHANNEL_LABELS[channel]}
              </span>
              <span className="font-bold tabular-nums text-slate-900">
                {formatNumber(value)}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <span
                className="block h-full rounded-full bg-violet-500"
                style={{ width: `${(value / maximum) * 100}%` }}
                aria-hidden="true"
              />
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function CostTruthPanel() {
  return (
    <article className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
          <ShieldCheck size={19} aria-hidden="true" />
        </span>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-amber-800">
            Cost truth boundary
          </p>
          <h2 className="mt-1 text-[15px] font-bold text-amber-950">
            Planning ranges are fictional
          </h2>
        </div>
      </div>
      <p className="mt-4 text-xs leading-5 text-amber-900">
        The LKR bands are deterministic UI-test fixtures. They are not derived from any
        provider rate, contract, invoice, exchange rate, or Hemas volume commitment.
      </p>
      <dl className="mt-4 space-y-2">
        {[
          ["Live billing account", "None"],
          ["Provider rate source", "Not connected"],
          ["Actual cloud charges", "Unavailable"],
          ["Prototype network calls", "Zero"],
        ].map(([label, value]) => (
          <div
            className="flex items-center justify-between gap-3 rounded-xl bg-white/75 px-3 py-2.5"
            key={label}
          >
            <dt className="text-xs font-medium text-amber-900">{label}</dt>
            <dd className="text-right text-[10px] font-bold uppercase tracking-[0.05em] text-amber-800">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export function UsageWorkspace() {
  const [filters, setFilters] = useState<DimensionFilters>(DEFAULT_DIMENSION_FILTERS);
  const [channel, setChannel] = useState<ChannelFilter>("all");
  const [event, setEvent] = useState<EventFilter>("all");
  const filteredRows = useMemo(
    () =>
      USAGE_SAMPLE_ROWS.filter(
        (row) =>
          matchesDimensionFilters(row, filters) &&
          (channel === "all" || row.channel === channel) &&
          (event === "all" || row.event === event),
      ),
    [channel, event, filters],
  );
  const totals = useMemo(
    () =>
      filteredRows.reduce(
        (result, row) => ({
          count: result.count + row.count,
          low: result.low + row.costLowLkr,
          high: result.high + row.costHighLkr,
        }),
        { count: 0, low: 0, high: 0 },
      ),
    [filteredRows],
  );
  const channelCount = new Set(filteredRows.map((row) => row.channel)).size;
  const functionCount = new Set(filteredRows.map((row) => row.functionLabel)).size;

  function resetAllFilters() {
    setFilters(DEFAULT_DIMENSION_FILTERS);
    setChannel("all");
    setEvent("all");
  }

  return (
    <div className="space-y-6 lg:space-y-8">
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700">
            <CircleDollarSign size={21} aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--brand)]">
                Commercial visibility
              </p>
              <StatusPill tone="warning" dot>
                Non-billing simulation
              </StatusPill>
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-[-0.035em] text-slate-950 sm:text-3xl">
              Usage workspace
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              Reconcile deterministic event counts and exercise fictional planning ranges
              without creating provider usage, invoices, exports, or production claims.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill tone="success">As of {SAMPLE_AS_OF_DATE}</StatusPill>
          <StatusPill tone="neutral">Actual bill unavailable</StatusPill>
        </div>
      </section>

      <LiveAnalyticsLock context="usage" />

      <div className="space-y-4">
        <DimensionFilterBar
          filters={filters}
          onChange={setFilters}
          resultCount={filteredRows.length}
          resultLabel="ledger rows"
        />
        <section className="rounded-2xl border border-[var(--line)] bg-white px-4 pb-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:px-5 sm:pb-5">
          <UsageSecondaryFilters
            channel={channel}
            event={event}
            onChannelChange={setChannel}
            onEventChange={setEvent}
            onReset={() => {
              setChannel("all");
              setEvent("all");
            }}
          />
        </section>
      </div>

      {filteredRows.length === 0 ? (
        <AggregateEmptyState
          title="No synthetic ledger entries match"
          description="The selected dimensions and ledger filters have no deterministic row. No usage or cost was inferred."
          onReset={resetAllFilters}
        />
      ) : (
        <>
          <section
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
            aria-label="Filtered synthetic usage totals"
          >
            <AggregateMetric
              label="Synthetic event count"
              value={formatNumber(totals.count)}
              detail={`${filteredRows.length} aggregate ledger rows`}
              icon={Activity}
              tone="blue"
            />
            <AggregateMetric
              label="Fictional planning range"
              value={formatLkrRange(totals.low, totals.high)}
              detail="Non-billing UI fixture; not a quote or forecast"
              icon={Calculator}
              tone="amber"
            />
            <AggregateMetric
              label="Functions represented"
              value={formatNumber(functionCount)}
              detail={`${channelCount} local synthetic channels`}
              icon={Layers3}
              tone="violet"
            />
            <AggregateMetric
              label="Actual invoice total"
              value="Unavailable"
              detail="No live billing account or provider data source"
              icon={ReceiptText}
              tone="emerald"
            />
          </section>

          <UsageLedgerTable rows={filteredRows} />

          <section className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
            <ChannelSummary rows={filteredRows} />
            <CostTruthPanel />
          </section>
        </>
      )}
    </div>
  );
}
