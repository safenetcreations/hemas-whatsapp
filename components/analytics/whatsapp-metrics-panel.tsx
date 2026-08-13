"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  BrainCircuit,
  CalendarCheck2,
  DatabaseZap,
  Download,
  Gauge,
  Handshake,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { useMemo } from "react";
import { useWorkspaceSession } from "@/components/auth/workspace-session";
import { StatusPill } from "@/components/ui/status-pill";
import { publicEnv } from "@/lib/config/public-env";
import { AggregateMetric } from "./workspace-primitives";
import { formatNumber } from "./formatters";
import { useWhatsAppMetrics } from "./use-whatsapp-metrics";
import {
  aggregateWhatsAppMetrics,
  buildWhatsAppMetricsCsv,
  type WhatsAppDailyMetric,
} from "./whatsapp-metrics-model";

const isLocalSyntheticDemo = publicEnv.appStage === "demo";

const dayFormatter = new Intl.DateTimeFormat("en-LK", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});

const statusTimeFormatter = new Intl.DateTimeFormat("en-LK", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Colombo",
});

function formatDay(value: string): string {
  return dayFormatter.format(new Date(`${value}T00:00:00.000Z`));
}

function formatStatusTime(value: string): string {
  return statusTimeFormatter.format(new Date(value));
}

function LoadingState() {
  return (
    <section
      className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700">
          <LoaderCircle className="animate-spin" size={18} aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-sm font-bold text-slate-950">Loading automatic WhatsApp counters</h2>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Waiting for a server-verified aggregate snapshot from the authenticated workspace.
          </p>
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="h-28 animate-pulse rounded-2xl bg-slate-100" key={index} />
        ))}
      </div>
    </section>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section
      className="rounded-2xl border border-red-200 bg-white p-5 shadow-[0_1px_2px_rgba(23,34,31,0.03)]"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-50 text-red-700">
          <AlertTriangle size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-slate-950">Automatic metrics unavailable</h2>
          <p className="mt-1 text-xs leading-5 text-slate-600">{message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[var(--brand)] px-3.5 text-xs font-bold text-white hover:brightness-95"
          >
            <RefreshCw size={13} aria-hidden="true" /> Retry Firestore read
          </button>
        </div>
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <section
      className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center"
      role="status"
    >
      <div className="max-w-md">
        <DatabaseZap className="mx-auto text-slate-300" size={30} aria-hidden="true" />
        <h2 className="mt-3 text-sm font-bold text-slate-900">No aggregate counters recorded yet</h2>
        <p className="mt-1.5 text-xs leading-5 text-slate-500">
          The authenticated query succeeded and returned no daily documents. Counters will
          appear automatically after governed WhatsApp activity; nothing is inferred or
          backfilled.
        </p>
      </div>
    </section>
  );
}

function MetricsChart({ rows }: { rows: readonly WhatsAppDailyMetric[] }) {
  const chronologicalRows = useMemo(
    () => [...rows].sort((left, right) => left.day.localeCompare(right.day)),
    [rows],
  );
  const maximumVolume = Math.max(
    1,
    ...chronologicalRows.map(
      (row) => row.inboundMessages + row.botReplies + row.agentReplies,
    ),
  );

  return (
    <figure
      className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5"
      aria-labelledby="whatsapp-chart-title"
      aria-describedby="whatsapp-chart-description"
    >
      <figcaption>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--brand)]">
              {isLocalSyntheticDemo ? "Automatic fixture trend" : "Automatic aggregate trend"}
            </p>
            <h2 id="whatsapp-chart-title" className="mt-1 text-[15px] font-bold text-slate-950">
              14-day WhatsApp activity
            </h2>
            <p id="whatsapp-chart-description" className="mt-1 text-xs leading-5 text-slate-500">
              Up to 14 latest recorded days. Bars stack inbound, bot and agent replies;
              missing dates are left missing, never inferred as zero.
              {isLocalSyntheticDemo
                ? " Local values are aggregate-only synthetic fixtures, not provider results."
                : ""}
            </p>
          </div>
          <BarChart3 className="shrink-0 text-[var(--brand)]" size={20} aria-hidden="true" />
        </div>
      </figcaption>

      <div className="mt-5 overflow-x-auto pb-1">
        <div
          className="grid min-w-[650px] grid-cols-[repeat(14,minmax(0,1fr))] gap-2"
          aria-hidden="true"
        >
          {chronologicalRows.map((row) => {
            const volume = row.inboundMessages + row.botReplies + row.agentReplies;
            const stackHeight = volume === 0 ? 3 : Math.max(10, (volume / maximumVolume) * 144);
            return (
              <div className="flex min-w-0 flex-col items-center" key={row.id}>
                <span className="mb-1 text-[9px] font-semibold tabular-nums text-slate-500">
                  {formatNumber(volume)}
                </span>
                <div className="flex h-36 w-full items-end justify-center">
                  {volume === 0 ? (
                    <span className="block w-full rounded-full bg-slate-200" style={{ height: stackHeight }} />
                  ) : (
                    <span
                      className="flex w-full flex-col-reverse overflow-hidden rounded-t-md"
                      style={{ height: stackHeight }}
                    >
                      <span
                        className="block bg-blue-600"
                        style={{ height: `${(row.inboundMessages / volume) * 100}%` }}
                      />
                      <span
                        className="block bg-emerald-500"
                        style={{ height: `${(row.botReplies / volume) * 100}%` }}
                      />
                      <span
                        className="block bg-violet-500"
                        style={{ height: `${(row.agentReplies / volume) * 100}%` }}
                      />
                    </span>
                  )}
                </div>
                <time
                  dateTime={row.day}
                  className="mt-2 whitespace-nowrap text-[9px] font-semibold text-slate-500"
                >
                  {formatDay(row.day)}
                </time>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[10px] font-semibold text-slate-600" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-blue-600" />Inbound</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />Bot replies</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-violet-500" />Agent replies</span>
      </div>

      <table className="sr-only">
        <caption>Exact daily values represented in the 14-day WhatsApp activity chart</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Inbound messages</th>
            <th scope="col">Bot replies</th>
            <th scope="col">Agent replies</th>
          </tr>
        </thead>
        <tbody>
          {chronologicalRows.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.day}</th>
              <td>{row.inboundMessages}</td>
              <td>{row.botReplies}</td>
              <td>{row.agentReplies}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function downloadMetricsCsv(rows: readonly WhatsAppDailyMetric[]): void {
  const chronologicalRows = [...rows].sort((left, right) => left.day.localeCompare(right.day));
  const firstDay = chronologicalRows[0]?.day ?? "empty";
  const lastDay = chronologicalRows.at(-1)?.day ?? "empty";
  const objectUrl = URL.createObjectURL(
    new Blob([buildWhatsAppMetricsCsv(chronologicalRows)], {
      type: "text/csv;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = `whatsapp-aggregate-metrics-${firstDay}-to-${lastDay}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

export function WhatsAppMetricsPanel() {
  const workspace = useWorkspaceSession();
  const workspaceId =
    workspace.status === "verified" ? (workspace.session?.workspaceId ?? null) : null;
  const metrics = useWhatsAppMetrics(workspaceId);
  const totals = useMemo(() => aggregateWhatsAppMetrics(metrics.rows), [metrics.rows]);

  if (workspace.status === "checking") return <LoadingState />;
  if (workspace.status !== "verified" || !workspaceId) {
    return (
      <ErrorState
        message="An authenticated workspace session is required before aggregate metrics can be read."
        onRetry={metrics.retry}
      />
    );
  }
  if (metrics.status === "loading") return <LoadingState />;
  if (metrics.status === "error") {
    return (
      <ErrorState
        message={metrics.message ?? "The aggregate metrics read failed safely."}
        onRetry={metrics.retry}
      />
    );
  }

  return (
    <section className="space-y-5" aria-labelledby="automatic-whatsapp-metrics-title">
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 sm:p-5 xl:flex-row xl:items-start">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-800">
            <ShieldCheck size={20} aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-800">
                Authenticated aggregate feed
              </p>
              <StatusPill tone={metrics.status === "empty" ? "neutral" : "success"} dot>
                {metrics.status === "empty"
                  ? "Server verified · empty"
                  : isLocalSyntheticDemo
                    ? "Server verified · synthetic fixtures"
                    : "Server verified · automatic"}
              </StatusPill>
            </div>
            <h2 id="automatic-whatsapp-metrics-title" className="mt-1 text-lg font-bold text-emerald-950">
              WhatsApp operational counters
            </h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-emerald-900 sm:text-sm sm:leading-6">
              Content-free daily counters from this signed-in workspace only. No phone
              numbers, names, message bodies, recipient lists, clinical content or credentials
              are read by this view.
            </p>
            <p className="mt-2 max-w-3xl text-[11px] leading-5 text-emerald-800">
              {isLocalSyntheticDemo
                ? "The local emulator seeds aggregate-only fixture days so management can review the dashboard. Campaign sends remain zero."
                : "This status confirms an authorized aggregate snapshot, not provider delivery, clinical outcomes or production readiness."}
            </p>
          </div>
        </div>
        {metrics.status === "ready" ? (
          <div className="flex shrink-0 flex-col items-start gap-2 xl:items-end">
            <StatusPill tone="info">
              Updated {formatStatusTime(metrics.rows[0]?.updatedAt ?? "")}
            </StatusPill>
            <button
              type="button"
              onClick={() => downloadMetricsCsv(metrics.rows)}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-white px-3 text-xs font-bold text-emerald-900 hover:bg-emerald-50"
            >
              <Download size={13} aria-hidden="true" /> Export aggregate CSV
            </button>
            <span className="text-[10px] text-emerald-800">Daily numbers only · no identifiers</span>
          </div>
        ) : null}
      </div>

      {metrics.status === "empty" ? (
        <EmptyState />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="WhatsApp aggregate key performance indicators">
            <AggregateMetric label="Messages in" value={formatNumber(totals.inboundMessages)} detail={`${metrics.rows.length} recorded days · inbound count only`} icon={Activity} tone="blue" />
            <AggregateMetric label="Bot replies" value={formatNumber(totals.botReplies)} detail="Automated reply count; no generated text" icon={Bot} tone="emerald" />
            <AggregateMetric label="AI answers" value={formatNumber(totals.aiAnswers)} detail={`${formatNumber(totals.aiFailures)} aggregate AI failures`} icon={BrainCircuit} tone="violet" />
            <AggregateMetric label="Bookings" value={formatNumber(totals.bookings)} detail="Booking events only; no patient fields" icon={CalendarCheck2} tone="emerald" />
            <AggregateMetric label="Staff handoffs" value={formatNumber(totals.staffHandoffs)} detail="Human takeover signals only" icon={Handshake} tone="amber" />
            <AggregateMetric label="Agent replies" value={formatNumber(totals.agentReplies)} detail="Staff reply count; no staff identity" icon={UserRoundCheck} tone="violet" />
            <AggregateMetric label="Campaign sends" value={formatNumber(totals.campaignSends)} detail="Aggregate sends; no recipient list" icon={BarChart3} tone="blue" />
            <AggregateMetric label="Governed actions" value={formatNumber(totals.apiRequests)} detail="Business-event counter; not raw API traffic" icon={Gauge} tone="amber" />
          </section>

          <MetricsChart rows={metrics.rows} />
        </>
      )}
    </section>
  );
}
