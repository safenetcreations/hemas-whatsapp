import type { RuntimeConfig } from "../config.js";
import { FailClosedError, assertSameTenant } from "../errors.js";

export interface AdapterReadiness {
  readonly ready: boolean;
  readonly mode: "disabled" | "synthetic" | "live";
  readonly networkCallsEnabled: false;
  readonly reason: string;
}

export interface OperationApproval {
  readonly status: "approved";
  readonly tenantId: string;
  readonly requestedBy: string;
  readonly approvedBy: string;
  readonly operationHash: string;
  readonly approvedAt: string;
  readonly expiresAt: string;
}

export interface AdapterCallContext {
  readonly tenantId: string;
  readonly requestId: string;
  readonly actorId: string;
  readonly approval?: OperationApproval;
}

export function assertRequestTenant(
  context: AdapterCallContext,
  requestTenantId: string,
): void {
  assertSameTenant(context.tenantId, requestTenantId);
  if (!context.requestId.trim() || !context.actorId.trim()) {
    throw new FailClosedError("invalid_context", "Request and actor identity are required.");
  }
}

export function assertApprovedLiveOperation(
  config: RuntimeConfig,
  context: AdapterCallContext,
  operationHash: string,
  now: Date = new Date(),
): OperationApproval {
  if (config.runtimeMode === "demo") {
    throw new FailClosedError("demo_live_denied", "Live provider operations are prohibited in demo.");
  }
  if (config.providerMode !== "live" || !config.outboundEnabled) {
    throw new FailClosedError("outbound_disabled", "Live outbound configuration is not enabled.");
  }
  if (!config.approvalGateRequired) {
    throw new FailClosedError("approval_policy_missing", "Approval-gate policy is required.");
  }
  const approval = context.approval;
  if (!approval) {
    throw new FailClosedError("approval_missing", "An approved operation gate is required.");
  }
  assertSameTenant(context.tenantId, approval.tenantId);
  if (approval.requestedBy === approval.approvedBy) {
    throw new FailClosedError("approval_separation_failed", "Requester and approver must differ.");
  }
  if (approval.operationHash !== operationHash) {
    throw new FailClosedError("approval_scope_mismatch", "Approval does not cover this operation.");
  }
  if (!Number.isFinite(Date.parse(approval.approvedAt))) {
    throw new FailClosedError("approval_invalid", "Approval timestamp is invalid.");
  }
  const expiresAt = Date.parse(approval.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    throw new FailClosedError("approval_expired", "Approval has expired.");
  }
  return approval;
}
