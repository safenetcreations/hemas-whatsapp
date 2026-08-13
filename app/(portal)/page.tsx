"use client";

import {
  Activity,
  AlarmClock,
  ArrowRight,
  Bot,
  CalendarCheck2,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  ContactRound,
  Inbox,
  Languages,
  MessageCircleMore,
  PauseCircle,
  Send,
  ShieldCheck,
  Siren,
  UserRoundCheck,
} from "lucide-react";
import Link from "next/link";
import { visiblePortalRoutePaths } from "@/components/auth/portal-route-access";
import { useWorkspaceSession } from "@/components/auth/workspace-session";
import { MetricCard } from "@/components/ui/metric-card";
import { StatusPill } from "@/components/ui/status-pill";
import { isSafeDemo } from "@/lib/config/public-env";

const queueRows = [
  { name: "General enquiries", open: 12, waiting: 3, sla: "6m", state: "Healthy" },
  { name: "Appointments", open: 8, waiting: 2, sla: "9m", state: "Healthy" },
  { name: "Laboratory", open: 5, waiting: 1, sla: "14m", state: "Attention" },
  { name: "Urgent escalation", open: 3, waiting: 0, sla: "<1m", state: "Escalated" },
];

const activity = [
  { icon: Siren, title: "Urgent-language safeguard triggered", detail: "Conversation SYN-C009 · routed to supervisor", time: "Seed event", tone: "text-red-700 bg-red-50" },
  { icon: UserRoundCheck, title: "Human takeover accepted", detail: "Tamil appointment enquiry · Synthetic Agent 04", time: "Seed event", tone: "text-blue-700 bg-blue-50" },
  { icon: CalendarCheck2, title: "Mock appointment rescheduled", detail: "Reference SYN-A1842 · no external write", time: "Seed event", tone: "text-emerald-700 bg-emerald-50" },
  { icon: PauseCircle, title: "Campaign simulation paused", detail: "50K Wellness Awareness · quality safeguard test", time: "Seed event", tone: "text-amber-700 bg-amber-50" },
];

export default function OverviewPage() {
  const workspace = useWorkspaceSession();
  if (workspace.status !== "verified" || !workspace.session) return null;

  const visibleRoutes = visiblePortalRoutePaths({
    session: workspace.session,
    syntheticStage: isSafeDemo,
  });

  return (
    <div className="space-y-6 lg:space-y-8">
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusPill tone="success" dot>Enterprise fixture ready</StatusPill>
            <StatusPill tone="warning" dot>Production outbound locked</StatusPill>
          </div>
          <h1 className="text-2xl font-bold tracking-[-0.035em] text-slate-950 sm:text-3xl">Operations overview</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Review fixed synthetic journeys, team queues, safeguards, and campaign readiness across the governed management workspace.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {visibleRoutes.has("/demo-lab") ? (
            <Link href="/demo-lab" className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
              <Bot size={16} aria-hidden="true" /> Run demo scenario
            </Link>
          ) : null}
          {visibleRoutes.has("/inbox") ? (
            <Link href="/inbox" className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--brand)] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[var(--brand-strong)]">
              Open inbox <ArrowRight size={16} aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Fixed demonstration metrics">
        <MetricCard label="Open conversations" value="28" detail="Fixed demo fixture · 6 need attention" icon={Inbox} tone="brand" />
        <MetricCard label="Waiting over 10 min" value="6" detail="Fixed fixture · 2 above sample target" icon={AlarmClock} tone="amber" />
        <MetricCard label="Appointments today" value="42" detail="Fixed mock schedule · 31 confirmed" icon={CalendarCheck2} tone="blue" />
        <MetricCard label="Consent-eligible audience" value="38,443" detail="Fixed 50K cohort after policy exclusions" icon={ContactRound} tone="violet" />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
        <article className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_1px_2px_rgba(23,34,31,0.03)]">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-4 sm:px-5">
            <div>
              <h2 className="text-[15px] font-bold text-slate-950">Queue health</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">Fixed synthetic workload by routing queue</p>
            </div>
            {visibleRoutes.has("/team") ? (
              <Link href="/team" className="hidden items-center gap-1 text-xs font-semibold text-[var(--brand)] hover:underline sm:flex">
                View routing <ChevronRight size={14} aria-hidden="true" />
              </Link>
            ) : null}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left">
              <thead>
                <tr className="border-b border-[var(--line)] bg-slate-50/70 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
                  <th className="px-5 py-3">Queue</th>
                  <th className="px-4 py-3">Open</th>
                  <th className="px-4 py-3">Unassigned</th>
                  <th className="px-4 py-3">Oldest wait</th>
                  <th className="px-5 py-3 text-right">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {queueRows.map((row) => (
                  <tr key={row.name} className="text-sm transition hover:bg-slate-50/60">
                    <td className="px-5 py-4 font-semibold text-slate-900">{row.name}</td>
                    <td className="px-4 py-4 tabular-nums text-slate-700">{row.open}</td>
                    <td className="px-4 py-4 tabular-nums text-slate-700">{row.waiting}</td>
                    <td className="px-4 py-4 text-slate-700">{row.sla}</td>
                    <td className="px-5 py-4 text-right">
                      <StatusPill tone={row.state === "Healthy" ? "success" : row.state === "Attention" ? "warning" : "danger"}>{row.state}</StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[0_1px_2px_rgba(23,34,31,0.03)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--brand)]">Connection centre</p>
              <h2 className="mt-1 text-lg font-bold tracking-[-0.02em] text-slate-950">Production remains locked</h2>
            </div>
            <ShieldCheck className="text-[var(--brand)]" size={23} aria-hidden="true" />
          </div>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            Enterprise production messaging is locked. The separate Lite canary remains allowlisted and must pass provider and real-device verification before any live claim.
          </p>
          <div className="mt-5 space-y-3">
            {[
              ["Enterprise Firebase emulator", "Ready", true],
              ["Lite WhatsApp canary", "Separate · gated", false],
              ["Hemas HIS / LIMS", "Locked", false],
              ["Real patient data", "Blocked", false],
            ].map(([label, value, ready]) => (
              <div key={String(label)} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
                <span className="flex items-center gap-2 text-xs font-medium text-slate-700">
                  {ready ? <CheckCircle2 size={15} className="text-emerald-600" aria-hidden="true" /> : <CircleAlert size={15} className="text-amber-600" aria-hidden="true" />}
                  {label}
                </span>
                <span className="text-[11px] font-semibold text-slate-500">{value}</span>
              </div>
            ))}
          </div>
          {visibleRoutes.has("/connections") ? (
            <Link href="/connections" className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[var(--line)] text-sm font-semibold text-slate-700 hover:bg-slate-50">
              View activation gates <ArrowRight size={15} aria-hidden="true" />
            </Link>
          ) : null}
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <article className="min-w-0 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[0_1px_2px_rgba(23,34,31,0.03)] xl:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[15px] font-bold text-slate-950">Fixed synthetic activity</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">Seeded scenarios · no patient identities or provider events</p>
            </div>
            <Activity size={18} className="text-slate-400" aria-hidden="true" />
          </div>
          <div className="mt-4 divide-y divide-[var(--line)]">
            {activity.map((item) => {
              const Icon = item.icon;
              return (
                <div className="flex items-start gap-3 py-3.5 first:pt-1" key={item.title}>
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${item.tone}`}><Icon size={17} aria-hidden="true" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                    <p className="mt-1 truncate text-xs text-[var(--muted)]">{item.detail}</p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-slate-400"><Clock3 size={11} aria-hidden="true" />{item.time}</span>
                </div>
              );
            })}
          </div>
        </article>

        <article className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[#073f3a] p-5 text-white shadow-sm">
          <div className="flex items-center justify-between">
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-emerald-100">Governed AI</span>
            <Bot size={21} className="text-emerald-200" aria-hidden="true" />
          </div>
          <h2 className="mt-5 text-xl font-bold tracking-[-0.025em]">Assist, review, then hand off.</h2>
          <p className="mt-2 text-sm leading-6 text-emerald-50/75">
            The demo can classify intent, switch language, and draft service-navigation replies. Diagnosis, treatment advice, and autonomous report interpretation stay blocked.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl bg-white/8 p-3"><Languages size={16} className="mb-2 text-emerald-200" /><strong className="block">3 languages</strong><span className="mt-1 block text-emerald-100/65">English · தமிழ் · සිංහල</span></div>
            <div className="rounded-xl bg-white/8 p-3"><MessageCircleMore size={16} className="mb-2 text-emerald-200" /><strong className="block">Human override</strong><span className="mt-1 block text-emerald-100/65">Always available</span></div>
          </div>
          {visibleRoutes.has("/ai-knowledge") ? (
            <Link href="/ai-knowledge" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-white hover:underline">Review safety controls <ArrowRight size={15} /></Link>
          ) : null}
        </article>
      </section>

      <section className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[0_1px_2px_rgba(23,34,31,0.03)]">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700"><Send size={19} aria-hidden="true" /></span>
            <div>
              <div className="flex flex-wrap items-center gap-2"><h2 className="text-[15px] font-bold text-slate-950">50K Wellness Awareness simulation</h2><StatusPill tone="info">Approval ready</StatusPill></div>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">50,000 synthetic records · 38,443 eligible · 11,557 excluded by consent, suppression, validity, language, duplicate, or frequency policy</p>
            </div>
          </div>
          {visibleRoutes.has("/campaigns") ? (
            <Link href="/campaigns" className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800">Open campaign control <ArrowRight size={15} /></Link>
          ) : null}
        </div>
      </section>
    </div>
  );
}
