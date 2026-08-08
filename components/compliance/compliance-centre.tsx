"use client";

import {
  Ban,
  Check,
  ChevronRight,
  CircleAlert,
  FileWarning,
  Filter,
  Gavel,
  LockKeyhole,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useWorkspaceSession } from "@/components/auth/workspace-session";
import { StatusPill } from "@/components/ui/status-pill";
import type { VerifiedWorkspaceSession } from "@/lib/firebase/workspace-session-model";
import {
  complianceAuditAuthorityKey,
  complianceAuditTimelineAccess,
} from "./compliance-audit-access";
import { ComplianceAuditTimeline } from "./compliance-audit-timeline";
import {
  complianceControls,
  type ComplianceControl,
  type ControlStatus,
} from "./compliance-data";

const statusLabel: Record<ControlStatus, string> = {
  implemented_demo: "Demo implemented",
  partial: "Partial",
  owner_pending: "Owner decision",
  blocked: "Not implemented",
};

const statusTone: Record<
  ControlStatus,
  "success" | "warning" | "info" | "danger"
> = {
  implemented_demo: "success",
  partial: "info",
  owner_pending: "warning",
  blocked: "danger",
};

function ControlList({
  controls,
  selectedId,
  onSelect,
}: {
  readonly controls: readonly ComplianceControl[];
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
}) {
  if (!controls.length) {
    return (
      <div className="grid min-h-48 place-items-center p-8 text-center">
        <div>
          <Filter
            className="mx-auto text-slate-300"
            size={26}
            aria-hidden="true"
          />
          <p className="mt-2 text-sm font-bold text-slate-800">
            No matching controls
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Change the category or status filter.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div
      className="divide-y divide-[var(--line)]"
      role="list"
      aria-label="Compliance control register"
    >
      {controls.map((control) => (
        <button
          key={control.id}
          type="button"
          onClick={() => onSelect(control.id)}
          className={`flex w-full items-start gap-3 px-4 py-3.5 text-left transition ${
            selectedId === control.id
              ? "bg-[var(--brand-soft)]"
              : "hover:bg-slate-50"
          }`}
          aria-current={selectedId === control.id ? "true" : undefined}
        >
          <span
            className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
              control.status === "implemented_demo"
                ? "bg-emerald-500"
                : control.status === "partial"
                  ? "bg-cyan-500"
                  : control.status === "owner_pending"
                    ? "bg-amber-500"
                    : "bg-red-500"
            }`}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-bold leading-5 text-slate-900">
              {control.name}
            </span>
            <span className="mt-1 block truncate text-[10px] text-slate-500">
              {control.category} · {control.owner}
            </span>
          </span>
          <ChevronRight
            size={14}
            className="mt-1 shrink-0 text-slate-400"
            aria-hidden="true"
          />
        </button>
      ))}
    </div>
  );
}

function ComplianceCentreContent({
  session,
}: {
  readonly session: VerifiedWorkspaceSession;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState<"all" | ControlStatus>("all");
  const [selectedId, setSelectedId] = useState(complianceControls[0].id);

  const filteredControls = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return complianceControls.filter(
      (control) =>
        (!normalized ||
          `${control.name} ${control.category} ${control.owner}`
            .toLowerCase()
            .includes(normalized)) &&
        (category === "all" || control.category === category) &&
        (status === "all" || control.status === status),
    );
  }, [category, query, status]);
  const selected =
    complianceControls.find((control) => control.id === selectedId) ??
    complianceControls[0];
  const summary = {
    demo: complianceControls.filter(
      (control) => control.status === "implemented_demo",
    ).length,
    partial: complianceControls.filter((control) => control.status === "partial")
      .length,
    owner: complianceControls.filter(
      (control) => control.status === "owner_pending",
    ).length,
    blocked: complianceControls.filter((control) => control.status === "blocked")
      .length,
  };

  return (
    <div className="space-y-6 lg:space-y-8" data-compliance-centre="ready">
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
            <ShieldCheck size={21} aria-hidden="true" />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--brand)]">
              Governance evidence
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-[-0.035em] text-slate-950 sm:text-3xl">
              Compliance &amp; Audit
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              Review synthetic-stage controls, unresolved ownership, restricted
              server-projected evidence, and production gates. This is product
              planning—not legal advice or certification.
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled
          title="Production activation requires formal Hemas approvals and recent authentication"
          className="inline-flex h-10 cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-slate-300 px-4 text-sm font-semibold text-white"
        >
          <LockKeyhole size={15} aria-hidden="true" />
          Production release locked
        </button>
      </section>

      <section
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Compliance control summary"
      >
        {[
          ["Demo implemented", summary.demo, "Synthetic-stage evidence", "text-emerald-700"],
          ["Partial controls", summary.partial, "Needs connected verification", "text-cyan-700"],
          ["Owner decisions", summary.owner, "Hemas approval required", "text-amber-700"],
          ["Not implemented", summary.blocked, "Release-blocking workflow", "text-red-700"],
        ].map(([label, value, detail, tone]) => (
          <article
            key={String(label)}
            className="rounded-2xl border border-[var(--line)] bg-white p-4 sm:p-5"
          >
            <p className="text-xs font-semibold text-[var(--muted)]">{label}</p>
            <p className={`mt-2 text-2xl font-bold ${tone}`}>{value}</p>
            <p className="mt-2 text-[11px] leading-5 text-slate-500">
              {detail}
            </p>
          </article>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <Gavel
              className="mt-0.5 shrink-0 text-amber-700"
              size={17}
              aria-hidden="true"
            />
            <div>
              <h2 className="text-xs font-bold text-amber-950">
                Sri Lanka PDPA planning boundary
              </h2>
              <p className="mt-1 text-[11px] leading-5 text-amber-900">
                The dated PRD snapshot is not a current legal opinion. Recheck
                legislation, final rules, and health guidance before launch.
              </p>
            </div>
          </div>
        </article>
        <article className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <div className="flex items-start gap-3">
            <FileWarning
              className="mt-0.5 shrink-0 text-red-700"
              size={17}
              aria-hidden="true"
            />
            <div>
              <h2 className="text-xs font-bold text-red-950">
                Prototype Rules notice
              </h2>
              <p className="mt-1 text-[11px] leading-5 text-red-900">
                Local hostile coverage exists, but Admin SDK bypass, production
                IAM, connected queries, Storage workflows, and threat review
                remain separate release gates.
              </p>
            </div>
          </div>
        </article>
        <article className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
          <div className="flex items-start gap-3">
            <Ban
              className="mt-0.5 shrink-0 text-cyan-700"
              size={17}
              aria-hidden="true"
            />
            <div>
              <h2 className="text-xs font-bold text-cyan-950">
                No certification claim
              </h2>
              <p className="mt-1 text-[11px] leading-5 text-cyan-900">
                The dashboard does not label SafeNet, Hemas, Firebase, Meta,
                AI, or this product as PDPA-certified or production-approved.
              </p>
            </div>
          </div>
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(320px,0.78fr)_minmax(0,1.22fr)]">
        <article className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
          <div className="space-y-3 border-b border-[var(--line)] p-4">
            <div>
              <h2 className="text-[15px] font-bold text-slate-950">
                Control register
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Evidence state by owner and release gate
              </p>
            </div>
            <label className="relative block">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                size={14}
                aria-hidden="true"
              />
              <span className="sr-only">Search controls</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search control or owner"
                className="h-10 w-full rounded-xl border border-[var(--line)] bg-slate-50 pl-9 pr-3 text-xs outline-none focus:border-[var(--brand)]"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className="sr-only">Filter control category</span>
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className="h-9 w-full rounded-lg border border-[var(--line)] bg-white px-2 text-[11px] font-semibold text-slate-700"
                >
                  <option value="all">All categories</option>
                  {["Privacy", "Security", "Clinical", "Consent", "Operations"].map(
                    (item) => (
                      <option key={item}>{item}</option>
                    ),
                  )}
                </select>
              </label>
              <label>
                <span className="sr-only">Filter control status</span>
                <select
                  value={status}
                  onChange={(event) =>
                    setStatus(event.target.value as "all" | ControlStatus)
                  }
                  className="h-9 w-full rounded-lg border border-[var(--line)] bg-white px-2 text-[11px] font-semibold text-slate-700"
                >
                  <option value="all">All statuses</option>
                  <option value="implemented_demo">Demo implemented</option>
                  <option value="partial">Partial</option>
                  <option value="owner_pending">Owner decision</option>
                  <option value="blocked">Not implemented</option>
                </select>
              </label>
            </div>
          </div>
          <ControlList
            controls={filteredControls}
            selectedId={selected.id}
            onSelect={setSelectedId}
          />
        </article>

        <article className="rounded-2xl border border-[var(--line)] bg-white p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--brand)]">
                Selected control
              </p>
              <h2 className="mt-1 text-xl font-bold tracking-[-0.02em] text-slate-950">
                {selected.name}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {selected.category} · {selected.owner}
              </p>
            </div>
            <StatusPill tone={statusTone[selected.status]}>
              {statusLabel[selected.status]}
            </StatusPill>
          </div>
          <p className="mt-5 text-sm leading-6 text-slate-700">
            {selected.summary}
          </p>
          <div className="mt-5 rounded-xl bg-slate-50 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-slate-500">
              Observed evidence
            </p>
            <ul className="mt-2 space-y-2">
              {selected.evidence.map((item) => (
                <li
                  key={item}
                  className="flex gap-2 text-xs leading-5 text-slate-600"
                >
                  <Check
                    size={14}
                    className="mt-0.5 shrink-0 text-emerald-600"
                    aria-hidden="true"
                  />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-950">
              <CircleAlert size={14} aria-hidden="true" /> Release gate
            </div>
            <p className="mt-2 text-xs font-semibold leading-5 text-amber-900">
              {selected.releaseGate}
            </p>
          </div>
        </article>
      </section>

      <ComplianceAuditTimeline session={session} />
    </div>
  );
}

export function ComplianceCentre() {
  const workspace = useWorkspaceSession();
  if (workspace.status !== "verified" || !workspace.session) return null;
  if (complianceAuditTimelineAccess(workspace.session) === "denied") return null;

  return (
    <ComplianceCentreContent
      key={complianceAuditAuthorityKey(workspace.session)}
      session={workspace.session}
    />
  );
}
