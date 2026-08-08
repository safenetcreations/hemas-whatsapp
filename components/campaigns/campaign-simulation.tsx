"use client";

import {
  Activity,
  Bug,
  FlaskConical,
  Layers3,
  PauseCircle,
  Play,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";
import type { CampaignAction } from "@/lib/firebase/repositories";
import type { CampaignWorkspaceRecord } from "./campaign-workspace-data";
import { formatNumber } from "./formatters";
import {
  CAMPAIGN_ACTION_PRESENTATION,
  CAMPAIGN_STATE_PRESENTATION,
  campaignProgressPercent,
} from "./simulation-model";

export type CampaignActionViewState =
  | { readonly status: "idle"; readonly action: null; readonly message: null }
  | {
      readonly status: "working" | "success" | "replay" | "conflict" | "error";
      readonly action: CampaignAction;
      readonly message: string;
    };

const actionIcon = {
  run_canary: FlaskConical,
  start: Play,
  advance_batch: Layers3,
  pause: PauseCircle,
  resume: Play,
  inject_fault: Bug,
  retry: RotateCcw,
  cancel: XCircle,
} satisfies Record<CampaignAction, typeof Play>;

function actionClass(action: CampaignAction): string {
  if (action === "cancel") {
    return "border border-red-200 bg-white text-red-700 hover:bg-red-50";
  }
  if (action === "inject_fault") {
    return "border border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100";
  }
  if (action === "pause") {
    return "bg-amber-500 text-white hover:bg-amber-600";
  }
  return "bg-[var(--brand)] text-white hover:bg-[var(--brand-strong)]";
}

export function CampaignSimulationPanel({
  record,
  availableActions,
  actionState,
  onAction,
}: {
  record: CampaignWorkspaceRecord;
  availableActions: readonly CampaignAction[];
  actionState: CampaignActionViewState;
  onAction: (action: CampaignAction) => void;
}) {
  const { audience, campaign } = record;
  const progress = campaignProgressPercent(
    campaign.processedEligible,
    audience.eligibleCount,
  );
  const remaining = Math.max(
    0,
    audience.eligibleCount - campaign.processedEligible,
  );
  const statePresentation = CAMPAIGN_STATE_PRESENTATION[campaign.state];
  const working = actionState.status === "working";

  return (
    <article className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_1px_2px_rgba(23,34,31,0.03)]">
      <div className="border-b border-[var(--line)] bg-[#073f3a] px-4 py-4 text-white sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.11em] text-emerald-200">
                Authoritative local queue state
              </p>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-emerald-100">
                externalCalls=0 · networkCalls=0
              </span>
            </div>
            <h2 className="mt-1 text-lg font-bold tracking-[-0.025em]">
              Persisted 50,000-record simulation
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-emerald-50/75">
              Progress comes from Firestore checkpoints written by the audited local
              callable. The browser never increments this counter itself.
            </p>
          </div>
          <StatusPill tone={statePresentation.tone} dot>
            {statePresentation.label}
          </StatusPill>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-slate-600">
              Persisted eligible progress
            </p>
            <p className="mt-1 text-2xl font-bold tracking-[-0.035em] text-slate-950">
              {formatNumber(campaign.processedEligible)}
              <span className="ml-1 text-sm font-semibold text-slate-400">
                / {formatNumber(audience.eligibleCount)}
              </span>
            </p>
          </div>
          <span className="text-sm font-bold tabular-nums text-[var(--brand)]">
            {progress.toFixed(1)}%
          </span>
        </div>
        <div
          className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-label="Persisted campaign simulation progress"
          aria-valuemin={0}
          aria-valuemax={audience.eligibleCount}
          aria-valuenow={campaign.processedEligible}
        >
          <span
            className="block h-full rounded-full bg-[var(--brand)] transition-[width] duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Remaining", formatNumber(remaining)],
            ["Batches written", formatNumber(campaign.nextBatchIndex)],
            ["Raw scan offset", formatNumber(campaign.scanOffset)],
            ["Revision", `r${formatNumber(campaign.revision)}`],
          ].map(([label, value]) => (
            <div className="rounded-xl bg-slate-50 p-3" key={label}>
              <dt className="text-[10px] font-semibold text-slate-500">{label}</dt>
              <dd className="mt-1 text-sm font-bold tabular-nums text-slate-900">
                {value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
          <StatusPill
            tone={campaign.canaryStatus === "passed_simulation" ? "success" : campaign.canaryStatus === "failed" ? "danger" : "neutral"}
          >
            Canary {campaign.canaryStatus.replaceAll("_", " ")}
          </StatusPill>
          <span>Batch size {formatNumber(campaign.batchSize)}</span>
          <span aria-hidden="true">·</span>
          <span>{formatNumber(record.checkpoints.length)} checkpoints loaded</span>
        </div>

        {actionState.status !== "idle" ? (
          <div
            className={`mt-4 rounded-xl border p-3 text-xs leading-5 ${
              actionState.status === "error" || actionState.status === "conflict"
                ? "border-red-200 bg-red-50 text-red-900"
                : actionState.status === "working"
                  ? "border-blue-200 bg-blue-50 text-blue-900"
                  : "border-emerald-200 bg-emerald-50 text-emerald-900"
            }`}
            role={actionState.status === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            {actionState.message}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2" aria-label="Governed simulation controls">
          {availableActions.map((action) => {
            const Icon = actionIcon[action];
            const presentation = CAMPAIGN_ACTION_PRESENTATION[action];
            return (
              <button
                key={action}
                type="button"
                disabled={working}
                onClick={() => onAction(action)}
                className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl px-3.5 text-sm font-semibold shadow-sm disabled:cursor-not-allowed disabled:opacity-50 ${actionClass(action)}`}
              >
                <Icon size={15} aria-hidden="true" />
                {working && actionState.action === action
                  ? presentation.workingLabel
                  : presentation.label}
              </button>
            );
          })}
        </div>

        {availableActions.length === 0 ? (
          <div className="mt-5 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] leading-5 text-slate-600">
            <Activity className="mt-0.5 shrink-0" size={14} aria-hidden="true" />
            <p>
              No lifecycle action is available for this persisted state and verified
              role. Read-only evidence remains visible.
            </p>
          </div>
        ) : null}
      </div>
    </article>
  );
}
