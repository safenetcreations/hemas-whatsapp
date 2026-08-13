"use client";

// Dashboard — Stripe-inspired structure (DESIGN.md: hairline borders, subtle
// card lift, tabular numerics, quiet hierarchy) on the Hemas palette.

import Link from "next/link";
import { useLiteAuth } from "@/components/lite/lite-auth";
import { useLiteConversations, useLiteMetrics } from "@/components/lite/lite-data";
import { LITE_SEAT_HINTS } from "@/components/lite/lite-config";
import { publicEnv } from "@/lib/config/public-env";

const CARD = "rounded-xl border border-[#e3e8ee] bg-white shadow-[0_1px_3px_rgba(0,55,112,0.08)]";
const ACTION_ALLOWANCE = 10_000;
const isLocalSyntheticDemo = publicEnv.appStage === "demo";

const CAPABILITIES = [
  "Governed service-information assistant · EN / සිංහල / தமிழ்",
  "Canary appointment requests with WhatsApp confirmations",
  "Allowlisted inbox · 3 synthetic agent seats · governed replies",
  "Canary templates with per-recipient delivery tracking",
  "Privacy-safe CRM capture + supervisor CSV export",
] as const;

const ACTIONS = [
  { href: "/lite/inbox", title: "Open the inbox", sub: "Governed chats, claim & reply" },
  { href: "/lite/campaigns", title: "New campaign", sub: "Review template send controls" },
  { href: "/lite/appointments", title: "Appointments", sub: "Confirm today's bookings" },
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
  const value = (n: number) => (conversations.loading || metrics.loading ? "–" : n);
  const telemetryError = conversations.error ?? metrics.error;
  const telemetryReady = conversations.rows.length > 0 || metrics.rows.length > 0;

  const stats = [
    { label: "Canary chats", value: value(conversations.rows.length), sub: "allowlisted test line" },
    { label: "AI answers", value: value(totals.ai), sub: "this month" },
    { label: "Bookings", value: value(totals.bookings), sub: "this month" },
    { label: "Assigned to me", value: value(mine), sub: member?.role ?? "seat" },
  ] as const;

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">
            Hello{member ? `, ${member.displayLabel.split(" — ")[0]}` : ""}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            One governed canary line, one helpdesk — synthetic records on the Hemas Connect engine.
          </p>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-[#e3e8ee] bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-[0_1px_3px_rgba(0,55,112,0.08)]">
          <span
            className={`h-2 w-2 rounded-full ${telemetryError ? "bg-rose-500" : telemetryReady ? "bg-emerald-500" : "bg-amber-500"}`}
          />
          {telemetryError
            ? "Canary telemetry unavailable"
            : telemetryReady
              ? isLocalSyntheticDemo
                ? "Synthetic telemetry loaded"
                : "Canary telemetry received"
              : "Canary ready · awaiting traffic"}
        </span>
      </section>

      {conversations.error ? (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-xs text-rose-700">{conversations.error}</p>
      ) : null}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className={`${CARD} p-5`}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              {stat.label}
            </p>
            <p className="mt-2 text-[32px] font-semibold leading-none tracking-tight text-slate-900 [font-variant-numeric:tabular-nums]">
              {stat.value}
            </p>
            <p className="mt-2 text-xs text-slate-500">{stat.sub}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {ACTIONS.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className={`${CARD} group flex items-center gap-3 p-4 transition hover:border-[#1863DC]/40 hover:shadow-[0_8px_24px_rgba(0,55,112,0.08),0_2px_6px_rgba(0,55,112,0.04)]`}
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">{action.title}</p>
              <p className="mt-0.5 truncate text-xs text-slate-500">{action.sub}</p>
            </div>
            <span className="ml-auto text-lg text-[#1863DC] transition group-hover:translate-x-0.5">→</span>
          </Link>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className={`${CARD} p-5`}>
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Available in this workspace</h2>
            <span className="rounded-full bg-[#1863DC]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#1863DC]">
              Governed canary
            </span>
          </div>
          <ul className="mt-4 space-y-2.5">
            {CAPABILITIES.map((capability) => (
              <li key={capability} className="flex items-start gap-2.5 text-sm text-slate-700">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#1863DC] text-[9px] font-bold text-white">
                  ✓
                </span>
                {capability}
              </li>
            ))}
          </ul>
          <div className="mt-5 border-t border-[#e3e8ee] pt-4">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-semibold text-slate-600">Governed actions this month</span>
              <span className="text-slate-500 [font-variant-numeric:tabular-nums]">
                {totals.api.toLocaleString()} / {ACTION_ALLOWANCE.toLocaleString()}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#eef2f7]">
              <div
                className="h-full rounded-full bg-[#1863DC] transition-all"
                style={{ width: `${Math.max(2, quotaPct)}%` }}
              />
            </div>
          </div>
        </div>

        <div className={`${CARD} p-5`}>
          <h2 className="text-sm font-semibold text-slate-900">Agent seats</h2>
          <ul className="mt-3 divide-y divide-[#eef2f7]">
            {LITE_SEAT_HINTS.map((seat) => (
              <li key={seat.email} className="flex items-center gap-3 py-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1863DC]/10 text-xs font-semibold text-[#1863DC]">
                  {seat.label.split("·")[1]?.trim().slice(0, 1) ?? "S"}
                </span>
                <span className="text-sm text-slate-700">{seat.label}</span>
                <span className="ml-auto rounded-full border border-[#e3e8ee] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {seat.role}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-slate-400">
            Each privately provisioned seat signs in on its own device. Provider replies require
            the separate canary claim and an owned conversation.
          </p>
        </div>
      </section>
    </div>
  );
}
