"use client";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleOff,
  Clock3,
  FileCheck2,
  GitBranch,
  History,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Network,
  RefreshCcw,
  Route,
  ShieldCheck,
  Stethoscope,
  UserRoundCheck,
  Workflow,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useWorkspaceSession } from "@/components/auth/workspace-session";
import { MetricCard } from "@/components/ui/metric-card";
import { StatusPill } from "@/components/ui/status-pill";
import {
  CARE_PATHWAY_SUPPRESSIONS,
  type AutomationRunAction,
  type CareEnrollmentAction,
  type CareSuppressionReason,
} from "@/lib/domain/automations";
import type { VerifiedWorkspaceSession } from "@/lib/firebase/workspace-session-model";
import {
  automationWorkspaceAuthorityKey,
  automationWorkspaceCapabilities,
  availableAutomationActions,
  availableCareActions,
  type AutomationCatalogueRecord,
  type AutomationOperationRecord,
  type AutomationWorkspaceCapabilities,
  type CareCatalogueRecord,
  type CareOperationRecord,
  type OperationAccess,
} from "./automation-workspace-data";
import {
  automationControlsLocked,
  useAutomationWorkspace,
} from "./use-automation-workspace";
import { DATA_SOURCE_SHORT, DATA_SOURCE, FUNCTIONS_SOURCE } from "@/lib/firebase/boundary-copy";

export {
  automationWorkspaceAuthorityKey,
  automationWorkspaceCapabilities,
};
export type { AutomationWorkspaceCapabilities };

type WorkspaceView = "definitions" | "care_path";

const automationActionLabels: Record<AutomationRunAction, string> = {
  start: "Start governed run",
  advance_step: "Advance one step",
  pause: "Pause run",
  resume: "Resume run",
  simulate_human_takeover: "Simulate human takeover",
  release_human_takeover: "Release human takeover",
  exercise_fallback: "Exercise approved fallback",
  inject_failure: "Inject synthetic failure",
  retry: "Retry under policy",
  end: "End run safely",
};

const careActionLabels: Record<CareEnrollmentAction, string> = {
  start: "Start approved pathway",
  advance_contact: "Advance one contact point",
  pause: "Pause enrollment",
  resume: "Resume enrollment",
  end: "End enrollment safely",
  simulate_suppression: "Apply selected suppression",
  human_takeover_started: "Start human takeover",
  release_human_takeover: "Release human takeover",
  clear_clinical_hold: "Clear clinical hold",
  raise_red_flag: "Raise synthetic red flag",
  acknowledge_escalation: "Acknowledge escalation",
  resolve_escalation: "Resolve escalation",
  clear_safety_hold: "Clear resolved safety hold",
};

const suppressionLabels: Record<CareSuppressionReason, string> = {
  readmission: "Readmission",
  transfer: "Transfer",
  death: "Death notification",
  clinical_hold: "Clinical hold",
  withdrawal: "Consent withdrawal",
  invalid_contact: "Invalid contact",
};

function titleCase(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function shortHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function displayDate(value: string | null): string {
  if (value === null) return "Not scheduled";
  return new Intl.DateTimeFormat("en-LK", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Colombo",
  }).format(new Date(value));
}

function SafetyBoundary() {
  return (
    <section
      className="overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-cyan-50"
      aria-labelledby="phase5-boundary-title"
    >
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-800">
            <ShieldCheck size={20} aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="phase5-boundary-title" className="text-sm font-bold text-slate-950">
                Persisted synthetic governance boundary
              </h2>
              <StatusPill tone="success" dot>
                Firestore authoritative
              </StatusPill>
            </div>
            <p className="mt-1.5 max-w-3xl text-xs leading-5 text-slate-600 sm:text-sm sm:leading-6">
              Catalogue and operation state come only from no-cache {DATA_SOURCE_SHORT} reads.
              Controls call {FUNCTIONS_SOURCE}, then require exact aggregate, immutable
              event, redacted audit, lifecycle pointer, revision, and result-fingerprint evidence.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <StatusPill tone="neutral">Provider dispatch 0</StatusPill>
          <StatusPill tone="neutral">Network calls 0</StatusPill>
        </div>
      </div>
    </section>
  );
}

function StateMessage({
  status,
  message,
  retry,
}: {
  status: "denied" | "evidence_mismatch" | "error";
  message: string;
  retry: () => void;
}) {
  const evidenceMismatch = status === "evidence_mismatch";
  return (
    <section
      className={`rounded-2xl border p-5 ${
        evidenceMismatch
          ? "border-red-200 bg-red-50"
          : status === "denied"
            ? "border-amber-200 bg-amber-50"
            : "border-slate-200 bg-white"
      }`}
      role="alert"
      data-automation-load-state={status}
    >
      <div className="flex items-start gap-3">
        {evidenceMismatch ? (
          <AlertTriangle className="mt-0.5 shrink-0 text-red-700" size={20} aria-hidden="true" />
        ) : (
          <LockKeyhole className="mt-0.5 shrink-0 text-amber-700" size={20} aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-slate-950">
            {evidenceMismatch
              ? "Authoritative evidence mismatch"
              : status === "denied"
                ? "Access denied"
                : "Local evidence unavailable"}
          </h2>
          <p className="mt-1 text-xs leading-5 text-slate-700">{message}</p>
          <button
            type="button"
            onClick={retry}
            className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800 hover:bg-slate-50"
          >
            <RefreshCcw size={15} aria-hidden="true" /> Retry authoritative reads
          </button>
        </div>
      </div>
    </section>
  );
}

function LoadingPane() {
  return (
    <section
      className="rounded-2xl border border-[var(--line)] bg-white p-8 text-center"
      role="status"
      data-automation-load-state="loading"
    >
      <LoaderCircle
        className="mx-auto animate-spin text-[var(--brand)]"
        size={24}
        aria-hidden="true"
      />
      <p className="mt-3 text-sm font-bold text-slate-900">Loading authoritative evidence</p>
      <p className="mt-1 text-xs text-slate-500">
        Reading bounded catalogues and exact aggregate pointers from {DATA_SOURCE}.
      </p>
    </section>
  );
}

function ActionNotice({
  state,
  retry,
}: {
  state: ReturnType<typeof useAutomationWorkspace>["actionState"];
  retry: () => void;
}) {
  if (state.status === "idle") return null;
  const tone =
    state.status === "success" || state.status === "replay"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : state.status === "working"
        ? "border-cyan-200 bg-cyan-50 text-cyan-950"
        : state.status === "evidence_mismatch"
          ? "border-red-200 bg-red-50 text-red-950"
          : "border-amber-200 bg-amber-50 text-amber-950";
  return (
    <div
      className={`rounded-2xl border p-4 ${tone}`}
      role={state.status === "error" || state.status === "evidence_mismatch" ? "alert" : "status"}
      data-automation-action-state={state.status}
    >
      <div className="flex items-start gap-3">
        {state.status === "working" ? (
          <LoaderCircle className="mt-0.5 shrink-0 animate-spin" size={18} aria-hidden="true" />
        ) : state.status === "success" || state.status === "replay" ? (
          <CheckCircle2 className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
        ) : (
          <AlertTriangle className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
        )}
        <div>
          <p className="text-sm font-bold">
            {state.status === "replay"
              ? "Idempotent replay verified"
              : state.status === "success"
                ? "Durable transition verified"
                : state.status === "working"
                  ? "Governed transaction in progress"
                  : state.status === "evidence_mismatch"
                    ? "Evidence mismatch — success withheld"
                    : state.status === "conflict"
                      ? "Authoritative conflict reloaded"
                      : "Transition failed safely"}
          </p>
          <p className="mt-1 text-xs leading-5">{state.message}</p>
          {automationControlsLocked(state) && state.status !== "working" ? (
            <button
              type="button"
              onClick={retry}
              className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-lg border border-current bg-white/80 px-3 text-xs font-bold hover:bg-white"
            >
              <RefreshCcw size={13} aria-hidden="true" /> Retry clean authoritative read
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function OperationAccessNotice({
  access,
  family,
}: {
  access: OperationAccess<unknown>;
  family: "automation" | "care";
}) {
  if (access.status === "available") return null;
  return (
    <section
      className="rounded-2xl border border-blue-200 bg-blue-50 p-4"
      data-operation-access={access.status}
    >
      <div className="flex items-start gap-3">
        <LockKeyhole className="mt-0.5 shrink-0 text-blue-700" size={18} aria-hidden="true" />
        <div>
          <h3 className="text-sm font-bold text-blue-950">
            {access.status === "out_of_scope" ? "Exact route is out of scope" : "Catalogue-only authority"}
          </h3>
          <p className="mt-1 text-xs leading-5 text-blue-900">
            {access.status === "out_of_scope"
              ? `The fixed synthetic ${family} aggregate requires both its assigned team and location. No exact operation read was attempted.`
              : `This role may inspect governed ${family} metadata, but exact operational aggregates and controls remain hidden.`}
          </p>
        </div>
      </div>
    </section>
  );
}

function DefinitionCatalogue({
  catalogues,
}: {
  catalogues: readonly AutomationCatalogueRecord[];
}) {
  const definitions = useMemo(
    () => catalogues.flatMap((catalogue) => catalogue.definitions),
    [catalogues],
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    catalogues[0]?.activeDefinition.id ?? definitions[0]?.id ?? null,
  );
  const selected =
    definitions.find((definition) => definition.id === selectedId) ?? definitions[0] ?? null;

  if (definitions.length === 0 || selected === null) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center" data-automation-empty="definitions">
        <CircleOff className="mx-auto text-slate-400" size={24} aria-hidden="true" />
        <h3 className="mt-3 text-sm font-bold text-slate-900">No governed definitions</h3>
        <p className="mt-1 text-xs text-slate-500">The bounded persisted catalogue is empty.</p>
      </section>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(250px,0.75fr)_minmax(0,1.6fr)]">
      <aside className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white" aria-label="Persisted automation versions">
        <div className="border-b border-[var(--line)] px-4 py-4">
          <div className="flex items-center gap-2">
            <GitBranch size={16} className="text-[var(--brand)]" aria-hidden="true" />
            <h3 className="text-sm font-bold text-slate-950">Versioned definitions</h3>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">Bounded server reads · immutable content hashes</p>
        </div>
        <div className="divide-y divide-[var(--line)]">
          {definitions.map((definition) => {
            const active = catalogues.some(
              (catalogue) => catalogue.activeDefinition.id === definition.id,
            );
            return (
              <button
                key={definition.id}
                type="button"
                onClick={() => setSelectedId(definition.id)}
                aria-current={selected.id === definition.id ? "true" : undefined}
                className={`w-full px-4 py-4 text-left transition ${
                  selected.id === definition.id ? "bg-[var(--brand-soft)]" : "hover:bg-slate-50"
                }`}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-slate-900">{definition.name}</span>
                    <span className="mt-1 block text-[11px] text-slate-500">
                      {titleCase(definition.family)} · v{definition.version}
                    </span>
                  </span>
                  {active ? <StatusPill tone="success">Active</StatusPill> : null}
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="rounded-2xl border border-[var(--line)] bg-white p-4 sm:p-5" aria-labelledby="selected-definition-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--brand)]">Persisted definition</p>
            <h3 id="selected-definition-title" className="mt-1 text-lg font-bold text-slate-950">{selected.name}</h3>
            <p className="mt-1 text-xs text-slate-500">{titleCase(selected.trigger)} · {titleCase(selected.consentPurpose)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill tone={selected.lifecycleState === "approved" ? "success" : "warning"}>{titleCase(selected.lifecycleState)}</StatusPill>
            <StatusPill>{titleCase(selected.riskLevel)} risk</StatusPill>
          </div>
        </div>
        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          <EvidenceField label="Content hash" value={shortHash(selected.contentHash)} mono />
          <EvidenceField label="Approval scope" value={selected.approvalScope ?? "Not approved"} />
          <EvidenceField label="Approved at" value={displayDate(selected.approvedAt)} />
          <EvidenceField label="Schema" value={`v${selected.schemaVersion} · synthetic`} />
        </dl>
        <div className="mt-5">
          <h4 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Immutable policy steps</h4>
          <ol className="mt-3 space-y-2">
            {selected.steps.map((step, index) => (
              <li key={step.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-start gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white text-xs font-bold text-[var(--brand)]">{index + 1}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900">{titleCase(step.kind)}</p>
                    <p className="mt-1 text-[11px] leading-5 text-slate-500">
                      {titleCase(step.serviceWindowBehavior)} · timeout {step.timeoutSeconds}s · retry max {step.retryMaxAttempts} · {titleCase(step.fallback)}
                    </p>
                    {step.templateVersionId ? (
                      <p className="mt-1 break-all font-mono text-[10px] text-slate-500">Template {step.templateVersionId} · {shortHash(String(step.templateContentHash))}</p>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}

function EvidenceField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
      <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</dt>
      <dd className={`mt-1 break-words text-xs font-semibold text-slate-800 ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

function AutomationOperation({
  session,
  access,
  working,
  onAction,
}: {
  session: VerifiedWorkspaceSession;
  access: OperationAccess<AutomationOperationRecord>;
  working: boolean;
  onAction: (record: AutomationOperationRecord, action: AutomationRunAction) => void;
}) {
  if (access.status !== "available") {
    return <OperationAccessNotice access={access} family="automation" />;
  }
  const record = access.record;
  const actions = availableAutomationActions(session, record);
  const { run } = record;
  return (
    <section className="rounded-2xl border border-[var(--line)] bg-white p-4 sm:p-5" aria-labelledby="automation-operation-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Activity size={17} className="text-[var(--brand)]" aria-hidden="true" />
            <h3 id="automation-operation-title" className="text-sm font-bold text-slate-950">Fixed synthetic run</h3>
          </div>
          <p className="mt-1 break-all font-mono text-[10px] text-slate-500">{run.id}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill tone={run.state === "failed" ? "danger" : run.state.startsWith("paused") ? "warning" : "info"}>{titleCase(run.state)}</StatusPill>
          <StatusPill>Revision {run.revision}</StatusPill>
        </div>
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <EvidenceField label="Current step" value={`${run.currentStepIndex} / ${run.completedStepCount} completed`} />
        <EvidenceField label="Outcome" value={titleCase(run.outcomeCode)} />
        <EvidenceField label="Next eligible" value={displayDate(run.nextEligibleAt)} />
        <EvidenceField label="Last event" value={run.lastEventId ? String(run.lastEventId) : "Initial aggregate"} mono />
      </dl>
      {record.workItem ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold text-amber-950">Governed work item · {titleCase(record.workItem.state)}</p>
            <StatusPill tone="warning">SLA {record.workItem.slaMinutes} min</StatusPill>
          </div>
          <p className="mt-1 text-[11px] text-amber-900">{titleCase(record.workItem.reasonCode)} · due {displayDate(record.workItem.dueAt)}</p>
        </div>
      ) : null}
      {actions.length > 0 ? (
        <div className="mt-5 flex flex-wrap gap-2" aria-label="Governed automation actions">
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              disabled={working}
              onClick={() => onAction(record, action)}
              className={`inline-flex min-h-10 items-center justify-center rounded-xl px-3.5 text-xs font-bold transition disabled:cursor-wait disabled:opacity-50 ${
                action === "inject_failure" || action === "end"
                  ? "border border-red-200 bg-red-50 text-red-800 hover:bg-red-100"
                  : "bg-[var(--brand)] text-white hover:bg-[var(--brand-strong)]"
              }`}
            >
              {automationActionLabels[action]}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-xs text-slate-500">No transition is available from this persisted state under the current authority.</p>
      )}
    </section>
  );
}

function DefinitionsPane({
  session,
  catalogues,
  operation,
  working,
  onAction,
}: {
  session: VerifiedWorkspaceSession;
  catalogues: readonly AutomationCatalogueRecord[];
  operation: OperationAccess<AutomationOperationRecord>;
  working: boolean;
  onAction: (record: AutomationOperationRecord, action: AutomationRunAction) => void;
}) {
  const versions = catalogues.reduce((sum, catalogue) => sum + catalogue.definitions.length, 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Persisted versions" value={String(versions)} detail="Two bounded executable-family catalogues" icon={GitBranch} />
        <MetricCard label="Active families" value={String(catalogues.length)} detail="Activation + immutable event + redacted audit joined" icon={Workflow} tone="blue" />
        <MetricCard label="Dispatches" value="0" detail="External provider writes are contractually zero" icon={Network} tone="amber" />
        <MetricCard label="Execution lists" value="Denied" detail="Only the fixed authorized run is read by exact ID" icon={KeyRound} tone="violet" />
      </div>
      <DefinitionCatalogue catalogues={catalogues} />
      <AutomationOperation session={session} access={operation} working={working} onAction={onAction} />
    </div>
  );
}

function CareCatalogue({ catalogue }: { catalogue: CareCatalogueRecord | null }) {
  if (!catalogue) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center" data-automation-empty="care-pathways">
        <CircleOff className="mx-auto text-slate-400" size={24} aria-hidden="true" />
        <h3 className="mt-3 text-sm font-bold text-slate-900">No governed care pathway</h3>
        <p className="mt-1 text-xs text-slate-500">The bounded persisted catalogue is empty.</p>
      </section>
    );
  }
  const pathway = catalogue.activePathway;
  return (
    <section className="rounded-2xl border border-[var(--line)] bg-white p-4 sm:p-5" aria-labelledby="care-catalogue-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--brand)]">Clinician-authored metadata only</p>
          <h3 id="care-catalogue-title" className="mt-1 text-lg font-bold text-slate-950">{pathway.name}</h3>
          <p className="mt-1 text-xs text-slate-500">Protocol {pathway.protocolVersion} · response SLA {pathway.responseSlaMinutes} minutes</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill tone="success">Approved + active</StatusPill>
          <StatusPill>{pathway.approvalScope}</StatusPill>
        </div>
      </div>
      <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <EvidenceField label="Content hash" value={shortHash(pathway.contentHash)} mono />
        <EvidenceField label="Instruction source" value="Clinician authored" />
        <EvidenceField label="AI instructions" value="Prohibited" />
        <EvidenceField label="Write-back" value={pathway.writeBackRequired ? "Required · simulator only" : "Not required"} />
      </dl>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {pathway.contactPoints.map((point) => (
          <article key={point.dayOffset} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-2">
              <Clock3 size={15} className="text-[var(--brand)]" aria-hidden="true" />
              <h4 className="text-sm font-bold text-slate-900">Day {point.dayOffset} contact point</h4>
            </div>
            <ul className="mt-2 space-y-1 font-mono text-[10px] text-slate-500">
              {(["en", "si", "ta"] as const).map((language) => (
                <li key={language} className="break-all">{language.toUpperCase()} · {point[language].templateVersionId} · {shortHash(point[language].contentHash)}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

function CareOperation({
  session,
  access,
  working,
  onAction,
}: {
  session: VerifiedWorkspaceSession;
  access: OperationAccess<CareOperationRecord>;
  working: boolean;
  onAction: (
    record: CareOperationRecord,
    action: CareEnrollmentAction,
    suppression: CareSuppressionReason | null,
  ) => void;
}) {
  const [suppression, setSuppression] = useState<CareSuppressionReason>("clinical_hold");
  if (access.status !== "available") {
    return <OperationAccessNotice access={access} family="care" />;
  }
  const record = access.record;
  const { enrollment } = record;
  const actions = availableCareActions(session, record);
  return (
    <section className="rounded-2xl border border-[var(--line)] bg-white p-4 sm:p-5" aria-labelledby="care-operation-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Stethoscope size={17} className="text-[var(--brand)]" aria-hidden="true" />
            <h3 id="care-operation-title" className="text-sm font-bold text-slate-950">Fixed synthetic enrollment</h3>
          </div>
          <p className="mt-1 break-all font-mono text-[10px] text-slate-500">{enrollment.id}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill tone={enrollment.state === "escalated" || enrollment.state === "paused_for_safety" ? "danger" : enrollment.state.startsWith("paused") ? "warning" : "info"}>{titleCase(enrollment.state)}</StatusPill>
          <StatusPill>Revision {enrollment.revision}</StatusPill>
        </div>
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <EvidenceField label="Next contact index" value={String(enrollment.nextContactIndex)} />
        <EvidenceField label="Next contact" value={displayDate(enrollment.nextContactAt)} />
        <EvidenceField label="Outcome" value={titleCase(enrollment.outcomeCode)} />
        <EvidenceField label="Suppressions" value={enrollment.activeSuppressions.length ? enrollment.activeSuppressions.map(titleCase).join(", ") : "None"} />
      </dl>

      {(record.eventEscalation || record.openEscalation || record.safetyHoldEscalation || record.handoff) ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {record.openEscalation ? (
            <article className="rounded-xl border border-red-200 bg-red-50 p-3">
              <div className="flex items-center gap-2 text-red-900"><AlertTriangle size={15} aria-hidden="true" /><h4 className="text-xs font-bold">Escalation aggregate · {titleCase(record.openEscalation.state)}</h4></div>
              <p className="mt-1 text-[11px] text-red-800">{titleCase(record.openEscalation.reasonCode)} · due {displayDate(record.openEscalation.responseDueAt)} · write-back {titleCase(record.openEscalation.writeBackState)}</p>
            </article>
          ) : null}
          {record.safetyHoldEscalation && record.safetyHoldEscalation.id !== record.openEscalation?.id ? (
            <article className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <h4 className="text-xs font-bold text-amber-950">Safety-hold evidence · {titleCase(record.safetyHoldEscalation.state)}</h4>
              <p className="mt-1 text-[11px] text-amber-900">Resolution {titleCase(record.safetyHoldEscalation.resolutionCode ?? "pending")}</p>
            </article>
          ) : null}
          {record.eventEscalation &&
          record.eventEscalation.id !== record.openEscalation?.id &&
          record.eventEscalation.id !== record.safetyHoldEscalation?.id ? (
            <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <h4 className="text-xs font-bold text-slate-900">Latest-event escalation · {titleCase(record.eventEscalation.state)}</h4>
              <p className="mt-1 text-[11px] text-slate-600">Aggregate-only lifecycle evidence · revision {record.eventEscalation.revision}</p>
            </article>
          ) : null}
          {record.handoff ? (
            <article className="rounded-xl border border-blue-200 bg-blue-50 p-3">
              <div className="flex items-center gap-2 text-blue-900"><UserRoundCheck size={15} aria-hidden="true" /><h4 className="text-xs font-bold">Human handoff · {titleCase(record.handoff.state)}</h4></div>
              <p className="mt-1 text-[11px] text-blue-800">Opened {displayDate(record.handoff.openedAt)} · revision {record.handoff.revision}</p>
            </article>
          ) : null}
        </div>
      ) : null}

      {actions.includes("simulate_suppression") ? (
        <div className="mt-5 max-w-sm">
          <label htmlFor="care-suppression" className="text-xs font-bold text-slate-700">Synthetic suppression reason</label>
          <select
            id="care-suppression"
            value={suppression}
            onChange={(event) => setSuppression(event.target.value as CareSuppressionReason)}
            disabled={working}
            className="mt-1.5 min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 disabled:opacity-60"
          >
            {CARE_PATHWAY_SUPPRESSIONS.map((reason) => <option key={reason} value={reason}>{suppressionLabels[reason]}</option>)}
          </select>
        </div>
      ) : null}
      {actions.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Governed care actions">
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              disabled={working}
              onClick={() => onAction(record, action, action === "simulate_suppression" ? suppression : null)}
              className={`inline-flex min-h-10 items-center justify-center rounded-xl px-3.5 text-xs font-bold transition disabled:cursor-wait disabled:opacity-50 ${
                action === "raise_red_flag" || action === "end" || action === "simulate_suppression"
                  ? "border border-red-200 bg-red-50 text-red-800 hover:bg-red-100"
                  : "bg-[var(--brand)] text-white hover:bg-[var(--brand-strong)]"
              }`}
            >
              {careActionLabels[action]}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-xs text-slate-500">No transition is available from this persisted state under the current clinical authority.</p>
      )}
    </section>
  );
}

function CarePane({
  session,
  catalogue,
  operation,
  working,
  onAction,
}: {
  session: VerifiedWorkspaceSession;
  catalogue: CareCatalogueRecord | null;
  operation: OperationAccess<CareOperationRecord>;
  working: boolean;
  onAction: (
    record: CareOperationRecord,
    action: CareEnrollmentAction,
    suppression: CareSuppressionReason | null,
  ) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Active pathways" value={catalogue ? "1" : "0"} detail="Approved activation + event + audit proof" icon={Route} />
        <MetricCard label="Clinical text" value="Never loaded" detail="Only aggregate protocol and lifecycle evidence is visible" icon={LockKeyhole} tone="blue" />
        <MetricCard label="Provider writes" value="0" detail="No WhatsApp, HIS, LIMS, SMS, or email dispatch" icon={Network} tone="amber" />
        <MetricCard label="Enrollment lists" value="Denied" detail="One fixed in-scope aggregate is read by exact ID" icon={KeyRound} tone="violet" />
      </div>
      <CareCatalogue catalogue={catalogue} />
      <CareOperation session={session} access={operation} working={working} onAction={onAction} />
    </div>
  );
}

function VerifiedAutomationWorkspace({ session }: { session: VerifiedWorkspaceSession }) {
  const capabilities = automationWorkspaceCapabilities(session);
  const [view, setView] = useState<WorkspaceView>(
    capabilities.canViewDefinitions ? "definitions" : "care_path",
  );
  const workspace = useAutomationWorkspace(session);
  const effectiveView =
    view === "definitions" && !capabilities.canViewDefinitions
      ? "care_path"
      : view === "care_path" && !capabilities.canViewCarePaths
        ? "definitions"
        : view;
  const controlsLocked = automationControlsLocked(workspace.actionState);

  return (
    <div className="space-y-4">
      <SafetyBoundary />
      <div className="overflow-x-auto border-b border-[var(--line)]">
        <div className="flex min-w-max gap-2" role="tablist" aria-label="Automation governance families">
          {capabilities.canViewDefinitions ? (
            <button
              type="button"
              role="tab"
              id="definitions-tab"
              aria-selected={effectiveView === "definitions"}
              aria-controls="definitions-panel"
              onClick={() => setView("definitions")}
              className={`inline-flex min-h-11 items-center gap-2 border-b-2 px-4 text-sm font-bold ${effectiveView === "definitions" ? "border-[var(--brand)] text-[var(--brand-strong)]" : "border-transparent text-slate-500"}`}
            >
              <Workflow size={16} aria-hidden="true" /> Automation definitions
            </button>
          ) : null}
          {capabilities.canViewCarePaths ? (
            <button
              type="button"
              role="tab"
              id="care-path-tab"
              aria-selected={effectiveView === "care_path"}
              aria-controls="care-path-panel"
              onClick={() => setView("care_path")}
              className={`inline-flex min-h-11 items-center gap-2 border-b-2 px-4 text-sm font-bold ${effectiveView === "care_path" ? "border-[var(--brand)] text-[var(--brand-strong)]" : "border-transparent text-slate-500"}`}
            >
              <Stethoscope size={16} aria-hidden="true" /> Post-discharge care
            </button>
          ) : null}
        </div>
      </div>

      <ActionNotice state={workspace.actionState} retry={workspace.retry} />
      <div
        role="tabpanel"
        id={effectiveView === "definitions" ? "definitions-panel" : "care-path-panel"}
        aria-labelledby={effectiveView === "definitions" ? "definitions-tab" : "care-path-tab"}
        data-automation-pane={effectiveView}
      >
        {workspace.status === "loading" ? <LoadingPane /> : null}
        {workspace.status === "denied" || workspace.status === "evidence_mismatch" || workspace.status === "error" ? (
          <StateMessage status={workspace.status} message={workspace.message} retry={workspace.retry} />
        ) : null}
        {workspace.status === "ready" && effectiveView === "definitions" ? (
          <DefinitionsPane
            session={session}
            catalogues={workspace.result.automationCatalogues ?? []}
            operation={workspace.result.automationOperation}
            working={controlsLocked}
            onAction={(record, action) => void workspace.requestAutomationAction(record, action)}
          />
        ) : null}
        {workspace.status === "ready" && effectiveView === "care_path" ? (
          <CarePane
            session={session}
            catalogue={workspace.result.careCatalogue}
            operation={workspace.result.careOperation}
            working={controlsLocked}
            onAction={(record, action, suppression) => void workspace.requestCareAction(record, action, suppression)}
          />
        ) : null}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5"><FileCheck2 size={14} aria-hidden="true" /> Exact activation, event, audit, pointer, and result-fingerprint joins</span>
        <span className="inline-flex items-center gap-1.5"><History size={14} aria-hidden="true" /> No fixture, cache, secret-read, execution-list, or patient-identity fallback</span>
      </footer>
    </div>
  );
}

export function AutomationWorkspace() {
  const workspace = useWorkspaceSession();
  if (workspace.status !== "verified" || !workspace.session) return null;
  const capabilities = automationWorkspaceCapabilities(workspace.session);
  if (!capabilities.canViewDefinitions && !capabilities.canViewCarePaths) return null;
  return (
    <VerifiedAutomationWorkspace
      key={automationWorkspaceAuthorityKey(workspace.session)}
      session={workspace.session}
    />
  );
}
