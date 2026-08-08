"use client";

import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  HelpCircle,
  LifeBuoy,
  LockKeyhole,
  MessageCircleOff,
  MonitorCog,
  RotateCcw,
  ShieldAlert,
  TriangleAlert,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  visiblePortalRoutePaths,
  type PortalRoutePath,
} from "@/components/auth/portal-route-access";
import { useWorkspaceSession } from "@/components/auth/workspace-session";
import { StatusPill } from "@/components/ui/status-pill";
import { isSafeDemo } from "@/lib/config/public-env";

import { ACCEPTANCE_ITEMS, HELP_PATHS } from "./help-data";

function OperationalHelpPaths({
  visibleRoutes,
}: {
  visibleRoutes: ReadonlySet<PortalRoutePath>;
}) {
  const icons = {
    scenario: MonitorCog,
    operations: LifeBuoy,
    connections: WifiOff,
    governance: LockKeyhole,
  } as const;

  return (
    <section aria-labelledby="operational-help-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--brand)]">
            Operational demo help
          </p>
          <h2 id="operational-help-title" className="mt-1 text-lg font-bold text-slate-950">
            Choose the local evidence surface
          </h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            These routes explain or exercise the prototype; none opens a support request.
          </p>
        </div>
        <HelpCircle size={21} className="shrink-0 text-[var(--brand)]" aria-hidden="true" />
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {HELP_PATHS.map((path) => {
          const Icon = icons[path.id as keyof typeof icons];
          return (
            <article
              className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5"
              key={path.id}
            >
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                  <Icon size={18} aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{path.title}</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-600">{path.description}</p>
                </div>
              </div>
              <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[10px] leading-4 text-amber-900">
                {path.boundary}
              </p>
              {visibleRoutes.has(path.href) ? (
                <Link
                  href={path.href}
                  className="mt-3 inline-flex h-9 items-center gap-2 text-xs font-bold text-[var(--brand)] hover:underline"
                >
                  {path.action} <ArrowRight size={14} aria-hidden="true" />
                </Link>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function EscalationGuidance({
  visibleRoutes,
}: {
  visibleRoutes: ReadonlySet<PortalRoutePath>;
}) {
  return (
    <section aria-labelledby="escalation-guidance-title">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-red-700">
          Escalation boundary
        </p>
        <h2 id="escalation-guidance-title" className="mt-1 text-lg font-bold text-slate-950">
          Separate prototype support from urgent patient guidance
        </h2>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <article className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4 sm:p-5">
          <div className="flex items-center gap-2 text-blue-950">
            <MonitorCog size={18} aria-hidden="true" />
            <h3 className="text-sm font-bold">Demo operation issue</h3>
          </div>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs leading-5 text-blue-900">
            <li>Stop the local scenario before retrying.</li>
            <li>Record the route, synthetic fixture, expected state, and observed state.</li>
            <li>Use the relevant internal page above to reproduce the issue.</li>
            <li>Share evidence through the team&apos;s separately agreed offline process.</li>
          </ol>
          <p className="mt-3 text-[10px] leading-4 text-blue-800">
            No ticket, email, message, or alert is created here.
          </p>
        </article>

        <article className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 sm:p-5">
          <div className="flex items-center gap-2 text-amber-950">
            <ShieldAlert size={18} aria-hidden="true" />
            <h3 className="text-sm font-bold">Synthetic safety signal</h3>
          </div>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs leading-5 text-amber-900">
            <li>Confirm ordinary automation and the composer are stopped.</li>
            <li>Keep the fixture in its safety-hold state.</li>
            <li>Demonstrate local human takeover without offering clinical advice.</li>
            <li>Do not downgrade or close the simulation automatically.</li>
          </ol>
          {visibleRoutes.has("/inbox") ? (
            <Link
              href="/inbox"
              className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-amber-950 hover:underline"
            >
              Review safety-hold fixture <ArrowRight size={14} aria-hidden="true" />
            </Link>
          ) : null}
        </article>

        <article
          className="rounded-2xl border-2 border-red-300 bg-red-50 p-4 sm:p-5"
          role="alert"
        >
          <div className="flex items-center gap-2 text-red-950">
            <TriangleAlert size={19} aria-hidden="true" />
            <h3 className="text-sm font-bold">Real urgent patient need</h3>
          </div>
          <p className="mt-3 text-xs font-semibold leading-5 text-red-950">
            Do not wait for, rely on, or send information to this prototype. It is not
            monitored and cannot contact a clinician, hospital, ambulance, emergency
            service, or support person.
          </p>
          <p className="mt-3 text-xs leading-5 text-red-900">
            Leave the prototype and follow the locally approved real-world urgent-care or
            emergency pathway available to you. This page deliberately provides no contact
            channel and no medical advice.
          </p>
        </article>
      </div>
    </section>
  );
}

function AcceptanceChecklist({
  visibleRoutes,
}: {
  visibleRoutes: ReadonlySet<PortalRoutePath>;
}) {
  const [checkedIds, setCheckedIds] = useState<readonly string[]>([]);
  const completed = checkedIds.length;
  const progress = (completed / ACCEPTANCE_ITEMS.length) * 100;

  function toggleItem(id: string, checked: boolean) {
    setCheckedIds((current) =>
      checked ? [...current, id] : current.filter((candidate) => candidate !== id),
    );
  }

  return (
    <section
      className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_1px_2px_rgba(23,34,31,0.03)]"
      aria-labelledby="acceptance-checklist-title"
    >
      <div className="flex flex-col gap-3 border-b border-[var(--line)] px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--brand)]">
            Demo acceptance
          </p>
          <h2 id="acceptance-checklist-title" className="mt-1 text-[15px] font-bold text-slate-950">
            Local evidence checklist
          </h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Checkmarks live in memory only and do not create approval or sign-off evidence.
          </p>
        </div>
        <StatusPill tone={completed === ACCEPTANCE_ITEMS.length ? "success" : "info"}>
          {completed}/{ACCEPTANCE_ITEMS.length} reviewed
        </StatusPill>
      </div>

      <div className="p-4 sm:p-5">
        <div
          className="h-2.5 overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-label="Local demo acceptance review progress"
          aria-valuemin={0}
          aria-valuemax={ACCEPTANCE_ITEMS.length}
          aria-valuenow={completed}
          aria-valuetext={`${completed} of ${ACCEPTANCE_ITEMS.length} locally reviewed`}
        >
          <span
            className="block h-full rounded-full bg-[var(--brand)] transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="mt-4 divide-y divide-[var(--line)]">
          {ACCEPTANCE_ITEMS.map((item) => {
            const checked = checkedIds.includes(item.id);
            return (
              <article className="grid gap-3 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center" key={item.id}>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => toggleItem(item.id, event.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-[var(--brand)]"
                  />
                  <span>
                    <span className="block text-xs font-bold text-slate-900">{item.title}</span>
                    <span className="mt-1 block text-[10px] leading-4 text-slate-500">
                      {item.evidence}
                    </span>
                  </span>
                </label>
                {visibleRoutes.has(item.href) ? (
                  <Link
                    href={item.href}
                    className="ml-7 inline-flex items-center gap-1.5 text-[11px] font-bold text-[var(--brand)] hover:underline lg:ml-0"
                  >
                    {item.linkLabel} <ArrowRight size={13} aria-hidden="true" />
                  </Link>
                ) : null}
              </article>
            );
          })}
        </div>

        <div className="mt-4 flex flex-col gap-3 rounded-xl bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] leading-5 text-slate-600" aria-live="polite">
            {completed === ACCEPTANCE_ITEMS.length
              ? "All local items reviewed. This is still not Hemas, security, privacy, clinical, or production approval."
              : `${ACCEPTANCE_ITEMS.length - completed} local evidence items remain.`}
          </p>
          <button
            type="button"
            disabled={completed === 0}
            onClick={() => setCheckedIds([])}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
          >
            <RotateCcw size={14} aria-hidden="true" /> Reset local checks
          </button>
        </div>
      </div>
    </section>
  );
}

export function HelpWorkspace() {
  const workspace = useWorkspaceSession();
  if (workspace.status !== "verified" || !workspace.session) return null;

  const visibleRoutes = visiblePortalRoutePaths({
    session: workspace.session,
    syntheticStage: isSafeDemo,
  });

  return (
    <div className="space-y-6 lg:space-y-8">
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700">
            <HelpCircle size={21} aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--brand)]">
                Prototype guidance
              </p>
              <StatusPill tone="warning" dot>
                No monitored support channel
              </StatusPill>
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-[-0.035em] text-slate-950 sm:text-3xl">
              Help &amp; escalation
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              Find the correct synthetic-demo surface, demonstrate safe escalation, and
              review acceptance evidence without implying a real support or emergency service.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill tone="success">Internal routes only</StatusPill>
          <StatusPill tone="danger">No patient monitoring</StatusPill>
        </div>
      </section>

      <section
        className="rounded-2xl border border-red-200 bg-gradient-to-r from-red-50 via-white to-amber-50 p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5"
        aria-labelledby="help-boundary-title"
      >
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-red-100 text-red-700">
            <MessageCircleOff size={20} aria-hidden="true" />
          </span>
          <div>
            <h2 id="help-boundary-title" className="text-sm font-bold text-red-950">
              This page does not contact, notify, page, email, message, or monitor anyone
            </h2>
            <p className="mt-1.5 max-w-4xl text-xs leading-5 text-red-900 sm:text-sm sm:leading-6">
              It contains internal navigation and local checklist state only. Operational
              escalation requires a separately agreed team process outside this prototype;
              urgent patient needs require an approved real-world pathway outside it.
            </p>
          </div>
        </div>
      </section>

      <OperationalHelpPaths visibleRoutes={visibleRoutes} />
      <EscalationGuidance visibleRoutes={visibleRoutes} />
      <AcceptanceChecklist visibleRoutes={visibleRoutes} />

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Help boundary summary">
        {[
          {
            icon: CheckCircle2,
            title: "Local guidance",
            detail: "Internal links and deterministic checklist state",
          },
          {
            icon: CircleAlert,
            title: "No support SLA",
            detail: "No response, monitoring, or follow-up is promised",
          },
          {
            icon: ClipboardCheck,
            title: "No approval created",
            detail: "Checklist completion is not formal acceptance",
          },
        ].map(({ icon: Icon, title, detail }) => (
          <article className="rounded-2xl border border-[var(--line)] bg-white p-4" key={title}>
            <Icon size={18} className="text-[var(--brand)]" aria-hidden="true" />
            <h2 className="mt-3 text-sm font-bold text-slate-900">{title}</h2>
            <p className="mt-1 text-[11px] leading-5 text-slate-500">{detail}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
