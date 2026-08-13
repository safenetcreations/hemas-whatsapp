"use client";

import { useMemo } from "react";
import { useLiteAuth } from "@/components/lite/lite-auth";
import { useLiteMetrics, type LiteDailyMetrics } from "@/components/lite/lite-data";
import { publicEnv } from "@/lib/config/public-env";

const MONTHLY_ACTION_ALLOWANCE = 10_000; // Demo packaging allowance; final commercial plan pending.
const isLocalSyntheticDemo = publicEnv.appStage === "demo";

function monthOf(day: string): string {
  return day.slice(0, 7);
}

export default function LiteAnalyticsPage() {
  const { status } = useLiteAuth();
  const metrics = useLiteMetrics(status === "ready");

  const { monthRows, totals, last14 } = useMemo(() => {
    const rows = metrics.rows;
    const currentMonth = rows.length > 0 ? monthOf(rows[0]!.day) : "";
    const monthRows = rows.filter((row) => monthOf(row.day) === currentMonth);
    const totals = monthRows.reduce(
      (acc, row) => ({
        inboundMessages: acc.inboundMessages + row.inboundMessages,
        botReplies: acc.botReplies + row.botReplies,
        aiAnswers: acc.aiAnswers + row.aiAnswers,
        bookings: acc.bookings + row.bookings,
        agentReplies: acc.agentReplies + row.agentReplies,
        campaignSends: acc.campaignSends + row.campaignSends,
        apiRequests: acc.apiRequests + row.apiRequests,
      }),
      {
        inboundMessages: 0,
        botReplies: 0,
        aiAnswers: 0,
        bookings: 0,
        agentReplies: 0,
        campaignSends: 0,
        apiRequests: 0,
      },
    );
    const last14: LiteDailyMetrics[] = [...rows.slice(0, 14)].reverse();
    return { monthRows, totals, last14 };
  }, [metrics.rows]);

  const quotaPct = Math.min(100, Math.round((totals.apiRequests / MONTHLY_ACTION_ALLOWANCE) * 100));
  const maxBar = Math.max(1, ...last14.map((row) => row.inboundMessages + row.botReplies));

  const cards = [
    { label: "Messages in", value: totals.inboundMessages },
    { label: "Bot replies", value: totals.botReplies },
    { label: "AI answers", value: totals.aiAnswers },
    { label: "Bookings", value: totals.bookings },
    { label: "Agent replies", value: totals.agentReplies },
    { label: "Campaign sends", value: totals.campaignSends },
  ] as const;

  return (
    <div className="space-y-5">
      <section>
        <h1 className="text-xl font-semibold text-slate-900">Analytics</h1>
        <p className="mt-1 text-sm text-slate-500">
          Automatic aggregate counter contract — this month ({monthRows.length} recorded day
          {monthRows.length === 1 ? "" : "s"}). {isLocalSyntheticDemo
            ? "The local emulator uses content-free synthetic fixtures with zero campaign sends."
            : "UAT reads content-free telemetry from the governed allowlisted canary path."} These
          are not production Hemas performance claims.
        </p>
      </section>

      {metrics.error ? (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-xs text-rose-700">{metrics.error}</p>
      ) : null}
      {metrics.loading ? <p className="text-xs text-slate-400">Loading aggregate counters…</p> : null}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-blue-900/5 bg-white p-4 shadow-sm"
          >
            <p className="text-2xl font-semibold text-blue-700">
              {metrics.loading ? "–" : card.value}
            </p>
            <p className="mt-1 text-[11px] font-medium text-slate-500">{card.label}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-blue-900/5 bg-white p-5 shadow-sm">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Governed actions this month</h2>
          <span className="text-xs text-slate-500">
            {totals.apiRequests.toLocaleString()} / {MONTHLY_ACTION_ALLOWANCE.toLocaleString()} (demo allowance)
          </span>
        </div>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-all ${
              quotaPct > 90 ? "bg-rose-500" : quotaPct > 70 ? "bg-amber-500" : "bg-blue-500"
            }`}
            style={{ width: `${Math.max(2, quotaPct)}%` }}
          />
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          Every governed action counts here — inbound, bot, AI, agent replies and campaign sends.
          This is a demo consumption counter derived from governed canary actions; it is not an
          API-request count, provider invoice, or finalized commercial quota.
        </p>
      </section>

      <section className="rounded-2xl border border-blue-900/5 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Last 14 recorded days — conversation volume</h2>
        <div className="mt-4 flex h-36 items-end gap-1.5">
          {last14.length === 0 ? (
            <p className="text-xs text-slate-400">Counters appear after governed activity is recorded.</p>
          ) : (
            last14.map((row) => {
              const volume = row.inboundMessages + row.botReplies;
              return (
                <div key={row.id} className="group flex flex-1 flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t-lg bg-blue-500/80 transition group-hover:bg-[#1863DC]"
                    style={{ height: `${Math.max(4, Math.round((volume / maxBar) * 120))}px` }}
                    title={`${row.day}: ${volume} messages`}
                  />
                  <span className="text-[9px] text-slate-400">{row.day.slice(8)}</span>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
