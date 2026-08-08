import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Download,
  Filter,
  Plus,
  Search,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { StatusPill } from "@/components/ui/status-pill";

type PillTone = "neutral" | "success" | "warning" | "danger" | "info";

export type ModuleConfig = {
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
  actionLabel: string;
  actionHref?: string;
  actionDisabled?: boolean;
  metrics: Array<{ label: string; value: string; detail: string }>;
  table: {
    title: string;
    description: string;
    columns: [string, string, string, string];
    rows: Array<{
      primary: string;
      secondary: string;
      third: string;
      status: string;
      tone: PillTone;
    }>;
  };
  guardrail: {
    title: string;
    description: string;
    checks: Array<{ label: string; value: string; ready: boolean }>;
    href: string;
    linkLabel: string;
  };
};

export function ModuleScaffold({ config }: { config: ModuleConfig }) {
  const Icon = config.icon;

  return (
    <div className="space-y-6 lg:space-y-8">
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
            <Icon size={21} aria-hidden="true" />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--brand)]">{config.eyebrow}</p>
            <h1 className="mt-1 text-2xl font-bold tracking-[-0.035em] text-slate-950 sm:text-3xl">{config.title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">{config.description}</p>
          </div>
        </div>
        {config.actionDisabled ? (
          <button type="button" disabled title="Unavailable until a governed provider connection is approved" className="inline-flex h-10 cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-slate-300 px-4 text-sm font-semibold text-white">
            <Plus size={16} aria-hidden="true" /> {config.actionLabel}
          </button>
        ) : (
          <Link href={config.actionHref ?? "/demo-lab"} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[var(--brand-strong)]">
            <Plus size={16} aria-hidden="true" /> {config.actionLabel}
          </Link>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={`${config.title} sample metrics`}>
        {config.metrics.map((metric) => (
          <article key={metric.label} className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5">
            <p className="text-xs font-semibold text-[var(--muted)]">{metric.label}</p>
            <p className="mt-2 text-2xl font-bold tracking-[-0.03em] text-slate-950">{metric.value}</p>
            <p className="mt-2 text-[11px] leading-5 text-slate-500">{metric.detail}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(310px,0.68fr)]">
        <article className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_1px_2px_rgba(23,34,31,0.03)]">
          <div className="flex flex-col gap-3 border-b border-[var(--line)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <h2 className="text-[15px] font-bold text-slate-950">{config.table.title}</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">{config.table.description}</p>
            </div>
            <div className="flex gap-2">
              <label className="relative min-w-0 flex-1 sm:w-48">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <span className="sr-only">Search sample records</span>
                <input type="search" placeholder="Search sample data" className="h-9 w-full rounded-lg border border-[var(--line)] bg-slate-50 pl-9 pr-3 text-xs outline-none focus:border-[var(--brand)] focus:bg-white" />
              </label>
              <button type="button" className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--line)] text-slate-600 hover:bg-slate-50" aria-label="Filter sample records"><Filter size={15} aria-hidden="true" /></button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left">
              <thead>
                <tr className="border-b border-[var(--line)] bg-slate-50/70 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
                  {config.table.columns.map((column, index) => <th key={column} className={`px-5 py-3 ${index === 3 ? "text-right" : ""}`}>{column}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {config.table.rows.map((row) => (
                  <tr key={`${row.primary}-${row.secondary}`} className="text-sm transition hover:bg-slate-50/60">
                    <td className="px-5 py-4 font-semibold text-slate-900">{row.primary}</td>
                    <td className="px-5 py-4 text-slate-600">{row.secondary}</td>
                    <td className="px-5 py-4 text-slate-600">{row.third}</td>
                    <td className="px-5 py-4 text-right"><StatusPill tone={row.tone}>{row.status}</StatusPill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-[var(--line)] px-5 py-3 text-[11px] text-slate-500">
            <span>Showing deterministic synthetic records</span>
            <button type="button" disabled className="inline-flex cursor-not-allowed items-center gap-1.5 text-slate-400" title="Exports are disabled in the synthetic demo"><Download size={13} aria-hidden="true" /> Export disabled</button>
          </div>
        </article>

        <article className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[0_1px_2px_rgba(23,34,31,0.03)]">
          <h2 className="text-[15px] font-bold text-slate-950">{config.guardrail.title}</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{config.guardrail.description}</p>
          <div className="mt-5 space-y-2.5">
            {config.guardrail.checks.map((check) => (
              <div key={check.label} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
                <span className="flex items-center gap-2 text-xs font-medium text-slate-700">
                  {check.ready ? <CheckCircle2 size={15} className="shrink-0 text-emerald-600" aria-hidden="true" /> : <CircleAlert size={15} className="shrink-0 text-amber-600" aria-hidden="true" />}
                  {check.label}
                </span>
                <span className="text-right text-[10px] font-bold uppercase tracking-[0.05em] text-slate-500">{check.value}</span>
              </div>
            ))}
          </div>
          <Link href={config.guardrail.href} className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[var(--line)] text-sm font-semibold text-slate-700 hover:bg-slate-50">
            {config.guardrail.linkLabel} <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </article>
      </section>
    </div>
  );
}
