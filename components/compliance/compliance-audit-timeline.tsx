"use client";

import {
  CircleAlert,
  ClipboardCheck,
  ListFilter,
  LockKeyhole,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";

import { StatusPill } from "@/components/ui/status-pill";
import type {
  ComplianceAuditEvent,
  ComplianceAuditOutcome,
} from "@/lib/firebase/compliance-audit-functions-emulator";
import type { VerifiedWorkspaceSession } from "@/lib/firebase/workspace-session-model";
import { complianceAuditTimelineAccess } from "./compliance-audit-access";
import {
  useComplianceAuditTimeline,
  type ComplianceAuditTimelineState,
} from "./use-compliance-audit-timeline";

const OUTCOME_OPTIONS = [
  ["all", "All outcomes"],
  ["allowed", "Allowed"],
  ["denied", "Denied"],
  ["failed", "Failed"],
  ["simulated", "Simulated"],
] as const;

function sentenceCase(code: string): string {
  const value = code.replaceAll("_", " ");
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function outcomeTone(
  outcome: ComplianceAuditOutcome,
): "success" | "danger" | "warning" | "info" {
  if (outcome === "allowed") return "success";
  if (outcome === "denied") return "danger";
  if (outcome === "failed") return "warning";
  return "info";
}

function TimelineHeader({
  filter,
  onFilterChange,
  restricted = false,
}: {
  readonly filter?: ComplianceAuditOutcome | null;
  readonly onFilterChange?: (value: ComplianceAuditOutcome | null) => void;
  readonly restricted?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-[var(--line)] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div>
        <div className="flex items-center gap-2">
          <ClipboardCheck
            size={16}
            className="text-[var(--brand)]"
            aria-hidden="true"
          />
          <h2 className="text-[15px] font-bold text-slate-950">
            Minimized synthetic audit timeline
          </h2>
        </div>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
          Server-projected evidence only. This view omits raw metadata and does
          not claim a complete audit trail.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {!restricted && filter !== undefined && onFilterChange ? (
          <label className="relative">
            <span className="sr-only">Filter projected audit outcome</span>
            <ListFilter
              size={13}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <select
              value={filter ?? "all"}
              onChange={(event) => {
                const value = event.target.value;
                onFilterChange(
                  value === "all" ? null : (value as ComplianceAuditOutcome),
                );
              }}
              className="h-9 rounded-lg border border-[var(--line)] bg-white pl-8 pr-3 text-xs font-semibold text-slate-700"
            >
              {OUTCOME_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          type="button"
          disabled
          title="Exports require an approved production purpose, minimization review, and recent authorization"
          className="h-9 cursor-not-allowed rounded-lg bg-slate-100 px-3 text-xs font-bold text-slate-400"
        >
          Export locked
        </button>
      </div>
    </div>
  );
}

function RestrictedTimeline() {
  return (
    <section
      className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white"
      data-compliance-timeline="restricted"
    >
      <TimelineHeader restricted />
      <div
        className="flex min-h-44 items-start gap-3 p-5 sm:p-6"
        role="status"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500">
          <LockKeyhole size={17} aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            Timeline restricted
          </h3>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-600">
            Your verified role may review the governance control register, but
            only a privacy reviewer or a workspace-wide tenant administrator
            may request the minimized event timeline. No timeline request was
            sent.
          </p>
        </div>
      </div>
    </section>
  );
}

function EventCard({ event }: { readonly event: ComplianceAuditEvent }) {
  return (
    <li
      className="grid gap-4 px-4 py-4 sm:px-5 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_auto] md:items-start"
      data-compliance-event={event.id}
    >
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-slate-500">
          Projected event
        </p>
        <time
          dateTime={event.occurredAt}
          className="mt-1 block break-all font-mono text-[11px] font-semibold text-slate-700"
        >
          {event.occurredAt}
        </time>
        <p className="mt-2 break-all font-mono text-[10px] leading-5 text-slate-500">
          {event.actor.type} · {event.actor.id}
        </p>
      </div>
      <div className="min-w-0">
        <p className="text-xs font-bold text-slate-900">
          {sentenceCase(event.safeSummaryCode)}
        </p>
        <p className="mt-2 break-all font-mono text-[10px] leading-5 text-slate-600">
          {event.action}
        </p>
        <p className="mt-1 break-all font-mono text-[10px] leading-5 text-slate-500">
          {event.resource.type} · {event.resource.id}
        </p>
      </div>
      <div className="md:text-right">
        <StatusPill tone={outcomeTone(event.outcome)}>
          {sentenceCase(event.outcome)}
        </StatusPill>
      </div>
    </li>
  );
}

function ProjectedEvents({
  state,
}: {
  readonly state: Extract<
    ComplianceAuditTimelineState,
    {
      readonly status:
        | "ready"
        | "loading_more"
        | "pagination_error";
    }
  >;
}) {
  return (
    <ol
      className="divide-y divide-[var(--line)]"
      aria-label="Minimized synthetic audit events"
    >
      {state.events.map((event) => (
        <EventCard key={event.id} event={event} />
      ))}
    </ol>
  );
}

function AuthorizedTimelineResults({
  session,
  outcome,
}: {
  readonly session: VerifiedWorkspaceSession;
  readonly outcome: ComplianceAuditOutcome | null;
}) {
  const { state, refresh, loadMore } = useComplianceAuditTimeline(
    session,
    outcome,
  );
  const hasEvents =
    state.status === "ready" ||
    state.status === "loading_more" ||
    state.status === "pagination_error";

  return (
    <div data-compliance-load-state={state.status}>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {state.status === "ready"
          ? `${state.events.length} minimized audit events loaded.`
          : state.message}
      </div>

      {state.status === "loading" ? (
        <div className="grid min-h-44 place-items-center p-6 text-center">
          <div>
            <RefreshCw
              size={20}
              className="mx-auto animate-spin text-[var(--brand)]"
              aria-hidden="true"
            />
            <p className="mt-3 text-xs font-semibold text-slate-600">
              {state.message}
            </p>
          </div>
        </div>
      ) : null}

      {state.status === "empty" ? (
        <div className="grid min-h-44 place-items-center p-6 text-center">
          <div>
            <ClipboardCheck
              size={22}
              className="mx-auto text-slate-300"
              aria-hidden="true"
            />
            <p className="mt-3 text-sm font-bold text-slate-800">
              No projected events
            </p>
            <p className="mt-1 text-xs text-slate-500">{state.message}</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="mt-4 h-9 rounded-lg border border-[var(--line)] px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>
        </div>
      ) : null}

      {hasEvents ? <ProjectedEvents state={state} /> : null}

      {state.status === "denied" ||
      state.status === "invalid_response" ||
      state.status === "error" ? (
        <div className="flex min-h-44 items-start gap-3 p-5 sm:p-6" role="alert">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-red-50 text-red-700">
            <CircleAlert size={17} aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Minimized timeline unavailable
            </h3>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-600">
              {state.message}
            </p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="mt-4 h-9 rounded-lg border border-[var(--line)] px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              Retry
            </button>
          </div>
        </div>
      ) : null}

      {state.status === "pagination_error" ? (
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-4 sm:px-5" role="alert">
          <p className="text-xs font-semibold leading-5 text-amber-900">
            {state.message}
          </p>
          <button
            type="button"
            onClick={() => void loadMore()}
            className="mt-3 h-9 rounded-lg border border-amber-300 bg-white px-3 text-xs font-bold text-amber-900 hover:bg-amber-100"
          >
            Retry next page
          </button>
        </div>
      ) : null}

      {state.status === "ready" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] px-4 py-3 sm:px-5">
          <p className="text-[10px] leading-5 text-slate-500">
            {state.events.length} strictly projected event
            {state.events.length === 1 ? "" : "s"} in this mounted view.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              className="h-9 rounded-lg border border-[var(--line)] px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              Refresh
            </button>
            {state.nextCursor ? (
              <button
                type="button"
                onClick={() => void loadMore()}
                className="h-9 rounded-lg bg-[var(--brand)] px-3 text-xs font-bold text-white hover:opacity-90"
              >
                Load more
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {state.status === "loading_more" ? (
        <div className="flex items-center gap-2 border-t border-[var(--line)] px-4 py-3 text-xs font-semibold text-slate-500 sm:px-5" role="status">
          <RefreshCw size={13} className="animate-spin" aria-hidden="true" />
          {state.message}
        </div>
      ) : null}
    </div>
  );
}

export function ComplianceAuditTimeline({
  session,
}: {
  readonly session: VerifiedWorkspaceSession;
}) {
  const access = complianceAuditTimelineAccess(session);
  const [outcome, setOutcome] = useState<ComplianceAuditOutcome | null>(null);

  if (access === "denied") return null;
  if (access === "restricted") return <RestrictedTimeline />;

  return (
    <section
      className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white"
      data-compliance-timeline="allowed"
    >
      <TimelineHeader filter={outcome} onFilterChange={setOutcome} />
      <AuthorizedTimelineResults
        key={outcome ?? "all"}
        session={session}
        outcome={outcome}
      />
    </section>
  );
}
