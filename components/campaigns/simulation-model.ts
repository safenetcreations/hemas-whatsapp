import type { CampaignAction, CampaignState } from "@/lib/firebase/repositories";

export const SIMULATION_BATCH_SIZE = 1_000;
export const SIMULATION_CANARY_SIZE = 25;

export const CAMPAIGN_STATE_PRESENTATION: Record<
  CampaignState,
  {
    readonly label: string;
    readonly tone: "neutral" | "success" | "warning" | "danger" | "info";
  }
> = {
  draft: { label: "Draft", tone: "neutral" },
  audience_building: { label: "Building audience", tone: "info" },
  compliance_review: { label: "Compliance review", tone: "warning" },
  approval_pending: { label: "Approval pending", tone: "warning" },
  scheduled: { label: "Scheduled", tone: "info" },
  dispatching: { label: "Simulating", tone: "info" },
  paused: { label: "Paused", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  failed: { label: "Recoverable fault", tone: "danger" },
};

export const CAMPAIGN_ACTION_PRESENTATION: Record<
  CampaignAction,
  { readonly label: string; readonly workingLabel: string }
> = {
  run_canary: { label: "Run 25-record canary", workingLabel: "Running canary…" },
  start: { label: "Start simulation", workingLabel: "Starting simulation…" },
  advance_batch: {
    label: "Process next bounded batch",
    workingLabel: "Processing one batch…",
  },
  pause: { label: "Pause safely", workingLabel: "Pausing…" },
  resume: { label: "Resume checkpoint", workingLabel: "Resuming…" },
  inject_fault: {
    label: "Inject recoverable fault",
    workingLabel: "Injecting fault…",
  },
  retry: { label: "Retry checkpoint", workingLabel: "Retrying…" },
  cancel: { label: "Cancel simulation", workingLabel: "Cancelling…" },
};

export function campaignProgressPercent(
  processedEligible: number,
  eligibleCount: number,
): number {
  if (eligibleCount <= 0) return 0;
  return Math.min(100, Math.max(0, (processedEligible / eligibleCount) * 100));
}
