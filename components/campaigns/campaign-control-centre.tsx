"use client";

import {
  Ban,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Send,
  ShieldCheck,
  ShieldOff,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useWorkspaceSession } from "@/components/auth/workspace-session";
import { StatusPill } from "@/components/ui/status-pill";
import type { VerifiedWorkspaceSession } from "@/lib/firebase/workspace-session-model";
import type { CampaignAction } from "@/lib/firebase/repositories";
import { AudienceBreakdown } from "./audience-breakdown";
import { CampaignEvidencePanel } from "./audience-preview";
import {
  buildCampaignPreflightChecks,
  type CampaignControlData,
} from "./campaign-control-data";
import { ApprovalEvidence, PreflightPanel } from "./campaign-governance";
import { CampaignSimulationPanel } from "./campaign-simulation";
import type { CampaignActionViewState } from "./campaign-simulation";
import { formatDate, formatNumber, formatPercent } from "./formatters";
import { SIMULATION_BATCH_SIZE } from "./simulation-model";
import { useCampaignWorkspace } from "./use-campaign-workspace";
import {
  availableCampaignActions,
  campaignWorkspaceAuthorityKey,
  roleCanReadCampaignWorkspace,
} from "./campaign-workspace-data";
import { DATA_SOURCE, FUNCTIONS_SOURCE, READS_LABEL } from "@/lib/firebase/boundary-copy";

export type { CampaignControlData } from "./campaign-control-data";

function Heading() {
  return (
    <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700">
          <Send size={20} aria-hidden="true" />
        </span>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--brand)]">
              Authenticated campaign governance
            </p>
            <StatusPill tone="info" dot>Simulation only</StatusPill>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-[-0.035em] text-slate-950 sm:text-3xl">
            Campaign control centre
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            Inspect and control one deterministic 50,000-record campaign from
            tenant-scoped Firestore evidence without downloading recipients.
          </p>
        </div>
      </div>
    </section>
  );
}

function WorkspaceStateCard({
  kind,
  message,
  onRetry,
}: {
  kind: "loading" | "error" | "denied" | "empty";
  message: string;
  onRetry?: () => void;
}) {
  const loading = kind === "loading";
  const denied = kind === "denied";
  return (
    <section
      className={`rounded-2xl border bg-white p-6 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-8 ${denied ? "border-amber-200" : "border-[var(--line)]"}`}
      aria-busy={loading}
      role={kind === "error" || denied ? "alert" : "status"}
    >
      <div className="flex items-start gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${kind === "error" ? "bg-red-50 text-red-700" : denied ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
          {loading ? <LoaderCircle className="animate-spin" size={18} aria-hidden="true" /> : kind === "error" ? <CircleAlert size={18} aria-hidden="true" /> : <ShieldOff size={18} aria-hidden="true" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-slate-950">
            {loading ? "Loading persisted campaign" : kind === "empty" ? "Campaign workspace is empty" : denied ? "Campaign access denied" : "Campaign evidence unavailable"}
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">{message}</p>
          {onRetry ? (
            <button type="button" onClick={onRetry} className="mt-4 inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">
              <RefreshCw size={13} aria-hidden="true" /> Retry local read
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ExternalSendingLock() {
  return (
    <section className="overflow-hidden rounded-2xl border border-red-200 bg-gradient-to-r from-red-50 via-white to-amber-50 shadow-[0_1px_2px_rgba(23,34,31,0.03)]" aria-labelledby="external-lock-title">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-red-100 text-red-700">
            <LockKeyhole size={20} aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="external-lock-title" className="text-sm font-bold text-slate-950 sm:text-[15px]">External sending is hard-locked</h2>
              <StatusPill tone="danger" dot>Meta and Hemas disconnected</StatusPill>
            </div>
            <p className="mt-1.5 max-w-3xl text-xs leading-5 text-slate-600 sm:text-sm sm:leading-6">
              This page uses only {READS_LABEL} from {DATA_SOURCE} and
              one audited callable on {FUNCTIONS_SOURCE} for simulation controls. There is no Meta, Hemas,
              provider, patient, message, or other external network path.
            </p>
          </div>
        </div>
        <button type="button" disabled className="inline-flex h-10 shrink-0 cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-slate-200 px-4 text-sm font-semibold text-slate-500">
          <Ban size={16} aria-hidden="true" /> External send unavailable
        </button>
      </div>
    </section>
  );
}

function CampaignMetric({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone: "emerald" | "blue" | "amber" | "violet";
}) {
  const tones = {
    emerald: "bg-emerald-50 text-emerald-700",
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    violet: "bg-violet-50 text-violet-700",
  };
  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-[var(--muted)]">{label}</p>
          <p className="mt-2 text-2xl font-bold tracking-[-0.035em] text-slate-950 sm:text-[1.7rem]">{value}</p>
        </div>
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tones[tone]}`}><Icon size={18} aria-hidden="true" /></span>
      </div>
      <p className="mt-3 text-[11px] leading-5 text-slate-500">{detail}</p>
    </article>
  );
}

function SchedulePolicy({ data }: { data: CampaignControlData }) {
  const { schedule } = data.campaign;
  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5">
      <div className="flex items-center gap-2">
        <Clock3 size={16} className="text-[var(--brand)]" aria-hidden="true" />
        <h2 className="text-[15px] font-bold text-slate-950">Schedule policy</h2>
      </div>
      <dl className="mt-4 space-y-3 text-xs">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] pb-3"><dt className="text-slate-500">Persisted start</dt><dd className="text-right font-semibold text-slate-800">{formatDate(schedule.startsAt)}</dd></div>
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] pb-3"><dt className="text-slate-500">Timezone</dt><dd className="font-semibold text-slate-800">{schedule.timeZone}</dd></div>
        <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">Quiet hours</dt><dd className="font-semibold text-slate-800">{schedule.quietHours.startsAtLocal}–{schedule.quietHours.endsAtLocal}</dd></div>
      </dl>
      <p className="mt-4 rounded-xl bg-blue-50 px-3 py-2.5 text-[11px] leading-5 text-blue-800">
        Schedule evidence is approval-bound. The simulator does not create a provider job.
      </p>
    </article>
  );
}

function PersistedCampaignControl({
  session,
  data,
  actionState,
  onAction,
}: {
  session: VerifiedWorkspaceSession;
  data: CampaignControlData;
  actionState: CampaignActionViewState;
  onAction: (action: CampaignAction) => void;
}) {
  const checks = buildCampaignPreflightChecks(data);
  const { audience, campaign } = data;
  const actions = availableCampaignActions(session, data);
  return (
    <>
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-white px-4 py-3">
        <div>
          <p className="text-xs font-bold text-slate-900">{campaign.name}</p>
          <p className="mt-1 text-[11px] text-slate-500">{campaign.targetAction}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill tone="info">{session.role.replaceAll("_", " ")}</StatusPill>
          <StatusPill tone="success">approval hash verified</StatusPill>
          <StatusPill tone="warning">provider unverified</StatusPill>
        </div>
      </section>

      <ExternalSendingLock />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Campaign aggregate metrics">
        <CampaignMetric label="Audience evaluated" value={formatNumber(audience.totalEvaluated)} detail="Aggregate synthetic records; no identities downloaded" icon={UsersRound} tone="blue" />
        <CampaignMetric label="Eligible for simulation" value={formatNumber(audience.eligibleCount)} detail={`${formatPercent(audience.eligibleCount, audience.totalEvaluated)} after governed exclusions`} icon={CheckCircle2} tone="emerald" />
        <CampaignMetric label="Excluded before queue" value={formatNumber(audience.excludedCount)} detail="Consent, suppression, validation, duplicate, language, and frequency rules" icon={ShieldCheck} tone="amber" />
        <CampaignMetric label="Maximum queue batches" value={formatNumber(Math.ceil(audience.eligibleCount / SIMULATION_BATCH_SIZE))} detail={`${formatNumber(SIMULATION_BATCH_SIZE)} eligible records per persisted checkpoint`} icon={Layers3} tone="violet" />
      </section>

      <section className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(330px,0.7fr)]">
        <AudienceBreakdown snapshot={audience} />
        <PreflightPanel checks={checks} />
      </section>

      <section className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(330px,0.7fr)]">
        <CampaignSimulationPanel
          record={data}
          availableActions={actions}
          actionState={actionState}
          onAction={onAction}
        />
        <div className="space-y-6">
          <ApprovalEvidence record={data} />
          <SchedulePolicy data={data} />
        </div>
      </section>

      <CampaignEvidencePanel record={data} />
    </>
  );
}

function VerifiedCampaignWorkspace({ session }: { session: VerifiedWorkspaceSession }) {
  const workspace = useCampaignWorkspace(session);
  return (
    <div className="space-y-6 lg:space-y-8">
      <Heading />
      {workspace.status === "loading" ? (
        <WorkspaceStateCard kind="loading" message={`Verifying the campaign role and loading bounded campaign, snapshot, template, event, and checkpoint reads from ${DATA_SOURCE}. No fixture fallback is used.`} />
      ) : workspace.status === "denied" ? (
        <WorkspaceStateCard kind="denied" message={workspace.message} onRetry={workspace.retry} />
      ) : workspace.status === "error" ? (
        <WorkspaceStateCard kind="error" message={workspace.message} onRetry={workspace.retry} />
      ) : workspace.result.selected === null ? (
        <WorkspaceStateCard kind="empty" message="The authenticated tenant query succeeded, but no synthetic campaign exists. No fixture was substituted." onRetry={workspace.retry} />
      ) : (
        <PersistedCampaignControl
          session={session}
          data={workspace.result.selected}
          actionState={workspace.actionState}
          onAction={(action) => {
            if (workspace.result.selected) {
              void workspace.requestAction(workspace.result.selected, action);
            }
          }}
        />
      )}
    </div>
  );
}

export function CampaignControlCentre() {
  const workspace = useWorkspaceSession();
  if (workspace.status === "verified" && workspace.session) {
    const session = workspace.session;
    if (!roleCanReadCampaignWorkspace(session.role)) {
      return (
        <div className="space-y-6 lg:space-y-8">
          <Heading />
          <WorkspaceStateCard
            kind="denied"
            message="This verified role cannot read campaign governance metadata. No campaign query was attempted."
          />
        </div>
      );
    }
    return (
      <VerifiedCampaignWorkspace
        key={campaignWorkspaceAuthorityKey(session)}
        session={session}
      />
    );
  }
  return (
    <div className="space-y-6 lg:space-y-8">
      <Heading />
      <WorkspaceStateCard
        kind={workspace.status === "checking" ? "loading" : "denied"}
        message={workspace.status === "checking" ? "Waiting for Firebase Auth and authoritative synthetic workspace membership verification." : workspace.message ?? "A verified campaign-governance workspace session is required."}
      />
    </div>
  );
}
