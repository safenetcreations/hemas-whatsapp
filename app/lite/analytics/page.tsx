"use client";

import { Activity, Bot, CalendarCheck2, Gauge, Megaphone, MessageCircle, UserRoundCheck } from "lucide-react";
import { useMemo } from "react";
import { useLiteAuth } from "@/components/lite/lite-auth";
import { useLiteMetrics, type LiteDailyMetrics } from "@/components/lite/lite-data";
import { publicEnv } from "@/lib/config/public-env";
import {
  LITE_PANEL,
  LiteMetricCard,
  LiteNotice,
  LitePageHeader,
  LiteSectionHeader,
  LiteStatus,
  liteCx,
} from "@/components/lite/lite-ui";

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
    { label: "Messages in", value: totals.inboundMessages, icon: MessageCircle, accent: "teal" as const },
    { label: "Bot replies", value: totals.botReplies, icon: Activity, accent: "blue" as const },
    { label: "AI answers", value: totals.aiAnswers, icon: Bot, accent: "violet" as const },
    { label: "Bookings", value: totals.bookings, icon: CalendarCheck2, accent: "orange" as const },
    { label: "Agent replies", value: totals.agentReplies, icon: UserRoundCheck, accent: "teal" as const },
    { label: "Campaign sends", value: totals.campaignSends, icon: Megaphone, accent: "blue" as const },
  ] as const;
  const reportingMonth = monthRows[0]?.day
    ? new Date(`${monthRows[0].day.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric",
      })
    : "Current month";

  return (
    <div className="space-y-6">
      <LitePageHeader
        eyebrow="Performance visibility"
        title="Analytics"
        description={`Content-free activity for ${reportingMonth} across ${monthRows.length} recorded day${monthRows.length === 1 ? "" : "s"}. These are governed canary counters, not production Hemas performance claims.`}
        actions={<LiteStatus tone="brand">{reportingMonth}</LiteStatus>}
      />

      {metrics.error ? <LiteNotice tone="danger">Aggregate activity is temporarily unavailable.</LiteNotice> : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6" aria-label="Activity totals">
        {cards.map((card) => (
          <LiteMetricCard
            key={card.label}
            label={card.label}
            value={metrics.loading ? "–" : metrics.error ? "Unavailable" : card.value}
            detail={reportingMonth}
            icon={card.icon}
            accent={card.accent}
          />
        ))}
      </section>

      <section className={liteCx(LITE_PANEL, "p-5 sm:p-6")}>
        <LiteSectionHeader
          title="Governed actions"
          description="Monthly consumption against the current demonstration allowance."
          icon={Gauge}
          action={
            <span className="text-sm font-bold text-[var(--lite-ink-secondary)] [font-variant-numeric:tabular-nums]">
              {totals.apiRequests.toLocaleString()} / {MONTHLY_ACTION_ALLOWANCE.toLocaleString()}
            </span>
          }
        />
        <div
          className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-label="Governed actions used this month"
          aria-valuemin={0}
          aria-valuemax={MONTHLY_ACTION_ALLOWANCE}
          aria-valuenow={Math.min(MONTHLY_ACTION_ALLOWANCE, totals.apiRequests)}
          aria-valuetext={`${totals.apiRequests.toLocaleString()} of ${MONTHLY_ACTION_ALLOWANCE.toLocaleString()} governed actions used`}
        >
          <div
            className={`h-full rounded-full transition-all ${
              quotaPct > 90
                ? "bg-rose-500"
                : quotaPct > 70
                  ? "bg-amber-500"
                  : "bg-gradient-to-r from-[var(--lite-brand)] to-[var(--lite-brand-bright)]"
            }`}
            style={{ width: `${quotaPct}%` }}
          />
        </div>
        <p className="mt-3 max-w-4xl text-xs leading-5 text-[var(--lite-muted)]">
          Inbound activity, bot and AI answers, agent replies, bookings, and campaign sends all
          contribute to this governed demo counter. It is not a provider invoice or finalized
          commercial quota.
        </p>
      </section>

      <section className={liteCx(LITE_PANEL, "p-5 sm:p-6")}>
        <LiteSectionHeader
          title="Conversation volume"
          description={`Last ${last14.length || 14} recorded days · inbound messages plus bot replies`}
          icon={Activity}
          action={<LiteStatus tone={isLocalSyntheticDemo ? "neutral" : "success"}>{isLocalSyntheticDemo ? "Synthetic" : "Canary live"}</LiteStatus>}
        />
        <div className="mt-6 flex h-48 items-end gap-2 border-b border-l border-[var(--lite-line)] px-2 pt-3 sm:gap-3">
          {last14.length === 0 ? (
            <p className="self-center text-sm text-[var(--lite-muted)]">Counters appear after governed activity is recorded.</p>
          ) : (
            last14.map((row) => {
              const volume = row.inboundMessages + row.botReplies;
              return (
                <div key={row.id} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
                  <span className="text-[11px] font-bold text-[var(--lite-muted)] [font-variant-numeric:tabular-nums]">
                    {volume}
                  </span>
                  <div
                    className="w-full max-w-12 rounded-t-lg bg-gradient-to-t from-[var(--lite-brand)] to-[var(--lite-brand-bright)] transition group-hover:brightness-110"
                    style={{ height: `${Math.max(4, Math.round((volume / maxBar) * 132))}px` }}
                    title={`${row.day}: ${volume} total messages`}
                  />
                  <span className="pb-2 text-[10px] font-semibold text-[var(--lite-muted)]">{row.day.slice(8)}</span>
                </div>
              );
            })
          )}
        </div>
        {last14.length > 0 ? (
          <table className="sr-only">
            <caption>Accessible conversation volume by recorded day</caption>
            <thead><tr><th>Date</th><th>Inbound</th><th>Bot replies</th><th>Total</th></tr></thead>
            <tbody>
              {last14.map((row) => (
                <tr key={row.id}>
                  <td>{row.day}</td>
                  <td>{row.inboundMessages}</td>
                  <td>{row.botReplies}</td>
                  <td>{row.inboundMessages + row.botReplies}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </div>
  );
}
