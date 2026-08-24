"use client";

import {
  ArrowRight,
  Bot,
  CalendarCheck2,
  CircleCheck,
  Gauge,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useLiteAuth } from "@/components/lite/lite-auth";
import { useLiteConversations, useLiteMetrics } from "@/components/lite/lite-data";
import { LITE_SEAT_HINTS } from "@/components/lite/lite-config";
import {
  LITE_PANEL,
  LiteMetricCard,
  LiteNotice,
  LitePageHeader,
  LiteSectionHeader,
  LiteStatus,
  liteCx,
} from "@/components/lite/lite-ui";
import { publicEnv } from "@/lib/config/public-env";

const ACTION_ALLOWANCE = 10_000;
const isLocalSyntheticDemo = publicEnv.appStage === "demo";

const CAPABILITIES = [
  "Service information in English, Sinhala, and Tamil",
  "WhatsApp appointment requests with confirmation controls",
  "Multi-agent inbox with governed live replies",
  "Approved templates with delivery-status evidence",
  "Privacy-safe contact capture and CRM export",
] as const;

const ACTIONS: readonly {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    href: "/lite/inbox",
    title: "Manage conversations",
    description: "Review live chats, ownership, and delivery status",
    icon: MessageSquareText,
  },
  {
    href: "/lite/appointments",
    title: "Review appointments",
    description: "Confirm or cancel incoming booking requests",
    icon: CalendarCheck2,
  },
  {
    href: "/lite/campaigns",
    title: "Prepare a campaign",
    description: "Build an approved, allowlisted template send",
    icon: Sparkles,
  },
] as const;

export default function LiteDashboardPage() {
  const { status, user, member } = useLiteAuth();
  const conversations = useLiteConversations(status === "ready", true);
  const metrics = useLiteMetrics(status === "ready");

  const month = metrics.rows.length > 0 ? metrics.rows[0]!.day.slice(0, 7) : "";
  const totals = metrics.rows
    .filter((row) => row.day.startsWith(month))
    .reduce(
      (acc, row) => ({
        ai: acc.ai + row.aiAnswers,
        bookings: acc.bookings + row.bookings,
        api: acc.api + row.apiRequests,
      }),
      { ai: 0, bookings: 0, api: 0 },
    );
  const mine = conversations.rows.filter((row) => row.assigneeId === user?.uid).length;
  const quotaPct = Math.min(100, Math.round((totals.api / ACTION_ALLOWANCE) * 100));
  const telemetryError = conversations.error ?? metrics.error;
  const telemetryReady = conversations.rows.length > 0 || metrics.rows.length > 0;

  const conversationValue = (value: number) =>
    conversations.loading ? "–" : conversations.error ? "Unavailable" : value;
  const metricValue = (value: number) =>
    metrics.loading ? "–" : metrics.error ? "Unavailable" : value;

  const stats = [
    {
      label: "Live conversations",
      value: conversationValue(conversations.rows.length),
      detail: "Allowlisted WhatsApp canary line",
      icon: MessageSquareText,
      accent: "teal" as const,
    },
    {
      label: "AI answers",
      value: metricValue(totals.ai),
      detail: month ? `Recorded in ${month}` : "Current reporting month",
      icon: Bot,
      accent: "blue" as const,
    },
    {
      label: "Appointments",
      value: metricValue(totals.bookings),
      detail: month ? `Requested in ${month}` : "Current reporting month",
      icon: CalendarCheck2,
      accent: "orange" as const,
    },
    {
      label: "Assigned to me",
      value: conversationValue(mine),
      detail: member?.role?.replace("_", " ") ?? "Provisioned seat",
      icon: UsersRound,
      accent: "violet" as const,
    },
  ] as const;

  return (
    <div className="space-y-7">
      <LitePageHeader
        eyebrow="Operations overview"
        title={<>Welcome{member ? `, ${member.displayLabel.split(" — ")[0]}` : ""}</>}
        description="Monitor the WhatsApp canary, coordinate the care team, and review patient-engagement activity from one governed workspace."
        actions={
          <LiteStatus
            tone={telemetryError ? "danger" : telemetryReady ? "success" : "warning"}
            dot
          >
            {telemetryError
              ? "Telemetry unavailable"
              : telemetryReady
                ? isLocalSyntheticDemo
                  ? "Synthetic telemetry loaded"
                  : "Canary telemetry live"
                : "Awaiting canary traffic"}
          </LiteStatus>
        }
      />

      {telemetryError ? (
        <LiteNotice tone="danger">
          Live operational counters are temporarily unavailable. Existing permissions and
          messaging controls remain unchanged.
        </LiteNotice>
      ) : null}

      <section className="relative overflow-hidden rounded-2xl bg-[linear-gradient(125deg,#073f50_0%,#007392_58%,#1392b6_100%)] px-5 py-6 text-white shadow-[0_20px_60px_rgba(5,63,80,0.16)] sm:px-7 sm:py-7">
        <div className="absolute -right-16 -top-28 h-64 w-64 rounded-full border-[42px] border-white/[0.055]" />
        <div className="absolute -bottom-24 right-36 h-48 w-48 rounded-full border-[30px] border-white/[0.04]" />
        <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-cyan-100/80">
              <ShieldCheck size={16} aria-hidden="true" />
              Connected-care control centre
            </div>
            <h2 className="font-display mt-3 text-2xl font-bold tracking-[-0.03em] sm:text-[1.7rem]">
              Governed WhatsApp operations, in one clear workspace.
            </h2>
            <p className="mt-2 text-sm leading-6 text-cyan-50/75">
              Review new conversations, route requests to the right seat, and follow delivery
              evidence without exposing full phone numbers or placing message text in operational
              records.
            </p>
          </div>
          <Link
            href="/lite/inbox"
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 self-start rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-[var(--lite-brand-strong)] shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl lg:self-center"
          >
            Open inbox
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Workspace metrics">
        {stats.map((stat) => (
          <LiteMetricCard key={stat.label} {...stat} />
        ))}
      </section>

      <section>
        <LiteSectionHeader
          title="Priority actions"
          description="The most common management tasks for this workspace."
        />
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.href}
                href={action.href}
                className={liteCx(
                  LITE_PANEL,
                  "group flex min-h-32 items-start gap-4 p-5 transition hover:-translate-y-0.5 hover:border-[var(--lite-brand)]/35 hover:shadow-[0_18px_42px_rgba(19,52,63,0.09)]",
                )}
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--lite-brand-soft)] text-[var(--lite-brand)] transition group-hover:bg-[var(--lite-brand)] group-hover:text-white">
                  <Icon size={20} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-display block text-[15px] font-bold text-[var(--lite-ink)]">
                    {action.title}
                  </span>
                  <span className="mt-1 block text-sm leading-5 text-[var(--lite-muted)]">
                    {action.description}
                  </span>
                </span>
                <ArrowRight
                  size={17}
                  className="mt-1 shrink-0 text-[var(--lite-brand)] transition group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </Link>
            );
          })}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.16fr_0.84fr]">
        <div className={liteCx(LITE_PANEL, "p-5 sm:p-6")}>
          <LiteSectionHeader
            title="Workspace capability"
            description="Included in the current governed Lite environment."
            icon={Gauge}
            action={<LiteStatus tone="brand">Lite canary</LiteStatus>}
          />
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {CAPABILITIES.map((capability) => (
              <li
                key={capability}
                className="flex min-h-12 items-start gap-3 rounded-xl border border-[var(--lite-line)] bg-[#fbfdfd] px-3.5 py-3 text-sm leading-5 text-[var(--lite-ink-secondary)]"
              >
                <CircleCheck
                  size={18}
                  className="mt-0.5 shrink-0 text-[var(--lite-brand)]"
                  aria-hidden="true"
                />
                {capability}
              </li>
            ))}
          </ul>
          <div className="mt-5 border-t border-[var(--lite-line)] pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-semibold text-[var(--lite-ink-secondary)]">
                Governed actions this month
              </span>
              <span className="font-semibold text-[var(--lite-muted)] [font-variant-numeric:tabular-nums]">
                {totals.api.toLocaleString()} / {ACTION_ALLOWANCE.toLocaleString()}
              </span>
            </div>
            <div
              className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100"
              role="progressbar"
              aria-label="Governed actions used this month"
              aria-valuemin={0}
              aria-valuemax={ACTION_ALLOWANCE}
              aria-valuenow={Math.min(ACTION_ALLOWANCE, totals.api)}
              aria-valuetext={`${totals.api.toLocaleString()} of ${ACTION_ALLOWANCE.toLocaleString()} governed actions used`}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-[var(--lite-brand)] to-[var(--lite-brand-bright)] transition-all"
                style={{ width: `${quotaPct}%` }}
              />
            </div>
          </div>
        </div>

        <div className={liteCx(LITE_PANEL, "p-5 sm:p-6")}>
          <LiteSectionHeader
            title="Care team"
            description="Three privately provisioned Lite seats."
            icon={UsersRound}
          />
          <ul className="mt-4 divide-y divide-[var(--lite-line)]">
            {LITE_SEAT_HINTS.map((seat) => (
              <li key={seat.email} className="flex items-center gap-3 py-3.5 first:pt-1">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--lite-brand-soft)] text-sm font-bold text-[var(--lite-brand)]">
                  {seat.label.split("·")[1]?.trim().slice(0, 1) ?? "S"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[var(--lite-ink)]">
                    {seat.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--lite-muted)]">
                    Provisioned on a private device
                  </span>
                </span>
                <LiteStatus tone="neutral">{seat.role}</LiteStatus>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-start gap-3 rounded-xl bg-[var(--lite-brand-soft)] px-4 py-3">
            <ShieldCheck
              size={18}
              className="mt-0.5 shrink-0 text-[var(--lite-brand)]"
              aria-hidden="true"
            />
            <p className="text-xs leading-5 text-[var(--lite-ink-secondary)]">
              Live provider replies require the separate canary permission and ownership of the
              selected conversation.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
