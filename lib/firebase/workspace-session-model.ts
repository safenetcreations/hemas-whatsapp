import { z } from "zod";

export const syntheticWorkspaceId = "workspace_safenet_demo";

const boundedIdentifier = z.string().min(1).max(128);
const workspaceRoleSchema = z.enum([
  "platform_owner",
  "tenant_admin",
  "supervisor",
  "agent",
  "campaign_operator",
  "campaign_approver",
  "analyst",
  "privacy_reviewer",
  "clinical_approver",
]);

const workspaceDocumentSchema = z.object({
  id: boundedIdentifier,
  name: z.string().trim().min(1).max(160),
  status: z.enum(["provisioning", "active", "locked", "suspended", "archived"]),
  mode: z.enum(["local", "demo", "uat", "production"]),
  dataClassification: z.enum([
    "synthetic_only",
    "approved_uat",
    "regulated_patient_data",
  ]),
});

const membershipDocumentSchema = z.object({
  id: boundedIdentifier,
  uid: boundedIdentifier,
  workspaceId: boundedIdentifier,
  displayLabel: z.string().trim().min(1).max(160),
  role: workspaceRoleSchema,
  status: z.enum(["invited", "active", "revoked", "suspended"]),
  scopeMode: z.enum(["assigned", "workspace_wide"]),
  teamIds: z.array(boundedIdentifier).max(50),
  locationIds: z.array(boundedIdentifier).max(50),
  synthetic: z.literal(true),
});

export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

export type VerifiedWorkspaceSession = {
  workspaceId: string;
  workspaceName: string;
  workspaceMode: "local" | "demo";
  dataClassification: "synthetic_only";
  uid: string;
  displayLabel: string;
  role: WorkspaceRole;
  scopeMode: "assigned" | "workspace_wide";
  teamIds: readonly string[];
  locationIds: readonly string[];
};

export class WorkspaceSessionError extends Error {
  constructor(
    message: string,
    readonly code:
      | "workspace_missing"
      | "membership_missing"
      | "invalid_schema"
      | "workspace_inactive"
      | "membership_inactive"
      | "binding_mismatch"
      | "invalid_scope"
      | "unsafe_workspace",
  ) {
    super(message);
    this.name = "WorkspaceSessionError";
  }
}

export function parseVerifiedWorkspaceSession(input: {
  workspaceData: unknown | null;
  membershipData: unknown | null;
  expectedWorkspaceId: string;
  expectedUid: string;
}): VerifiedWorkspaceSession {
  if (input.workspaceData === null) {
    throw new WorkspaceSessionError("Workspace document is missing.", "workspace_missing");
  }
  if (input.membershipData === null) {
    throw new WorkspaceSessionError("Membership document is missing.", "membership_missing");
  }

  const workspaceResult = workspaceDocumentSchema.safeParse(input.workspaceData);
  const membershipResult = membershipDocumentSchema.safeParse(input.membershipData);
  if (!workspaceResult.success || !membershipResult.success) {
    throw new WorkspaceSessionError(
      "Workspace authority documents failed schema validation.",
      "invalid_schema",
    );
  }

  const workspace = workspaceResult.data;
  const membership = membershipResult.data;
  if (workspace.id !== input.expectedWorkspaceId) {
    throw new WorkspaceSessionError("Workspace path binding is invalid.", "binding_mismatch");
  }
  if (
    membership.id !== input.expectedUid ||
    membership.uid !== input.expectedUid ||
    membership.workspaceId !== input.expectedWorkspaceId
  ) {
    throw new WorkspaceSessionError("Membership path binding is invalid.", "binding_mismatch");
  }
  if (workspace.status !== "active") {
    throw new WorkspaceSessionError("Workspace is not active.", "workspace_inactive");
  }
  if (membership.status !== "active") {
    throw new WorkspaceSessionError("Membership is not active.", "membership_inactive");
  }
  if (membership.scopeMode === "workspace_wide" && membership.role !== "tenant_admin") {
    throw new WorkspaceSessionError(
      "Only a tenant administrator may hold workspace-wide scope.",
      "invalid_scope",
    );
  }
  if (
    (workspace.mode !== "local" && workspace.mode !== "demo") ||
    workspace.dataClassification !== "synthetic_only"
  ) {
    throw new WorkspaceSessionError(
      "Workspace is outside the synthetic local boundary.",
      "unsafe_workspace",
    );
  }

  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    workspaceMode: workspace.mode,
    dataClassification: workspace.dataClassification,
    uid: membership.uid,
    displayLabel: membership.displayLabel,
    role: membership.role,
    scopeMode: membership.scopeMode,
    teamIds: [...membership.teamIds],
    locationIds: [...membership.locationIds],
  };
}

const roleLabels: Record<WorkspaceRole, string> = {
  platform_owner: "Platform owner",
  tenant_admin: "Tenant administrator",
  supervisor: "Supervisor",
  agent: "Patient services agent",
  campaign_operator: "Campaign operator",
  campaign_approver: "Campaign approver",
  analyst: "Analyst",
  privacy_reviewer: "Privacy reviewer",
  clinical_approver: "Clinical approver",
};

export function workspaceRoleLabel(role: WorkspaceRole): string {
  return roleLabels[role];
}

export function initialsForDisplayLabel(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
  return initials || "?";
}

export function workspaceInitials(name: string): string {
  return initialsForDisplayLabel(name);
}

export function membershipScopeLabel(session: VerifiedWorkspaceSession): string {
  if (session.role === "tenant_admin" && session.scopeMode === "workspace_wide") {
    return "Workspace-wide patient-record scope";
  }
  if (session.teamIds.length === 0 || session.locationIds.length === 0) {
    return "Assigned scope · no patient-record routes";
  }
  return `Assigned scope · ${session.teamIds.length} team · ${session.locationIds.length} location`;
}
