import type { ISODateTime, LocationId, TeamId, WorkspaceId } from "./primitives";
import type {
  AutomationExecutionState,
  AutomationRunAction,
  CareEnrollmentAction,
} from "./automations";
import type { WorkspaceMembership, WorkspaceRole } from "./workspaces";

export const PERMISSIONS = [
  "platform.provision_workspace",
  "platform.view_health",
  "workspace.manage_settings",
  "workspace.view_connections",
  "workspace.manage_connections",
  "workspace.view_members",
  "workspace.manage_members",
  "workspace.propose_retention",
  "inbox.view",
  "inbox.assign",
  "inbox.reply",
  "inbox.supervise",
  "contacts.view",
  "contacts.manage",
  "consent.view_evidence",
  "consent.manage",
  "appointments.view",
  "appointments.manage",
  "labs.view_workflow",
  "templates.view",
  "templates.manage",
  "campaigns.view",
  "campaigns.create",
  "campaigns.approve",
  "campaigns.launch",
  "automations.view",
  "automations.manage",
  "automations.view_definitions",
  "automations.control_runs",
  "automations.manage_versions",
  "automations.approve_versions",
  "automations.activate_versions",
  "ai_governance.view",
  "ai_governance.record_retrospective",
  "clinical.view_pathways",
  "clinical.approve_pathways",
  "clinical.control_enrollments",
  "clinical.manage_escalations",
  "analytics.view_aggregate",
  "usage.view",
  "audit.view",
  "exports.create",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS = {
  platform_owner: ["platform.provision_workspace", "platform.view_health"],
  tenant_admin: [
    "workspace.manage_settings",
    "workspace.view_connections",
    "workspace.manage_connections",
    "workspace.view_members",
    "workspace.manage_members",
    "workspace.propose_retention",
    "inbox.view",
    "inbox.assign",
    "inbox.reply",
    "inbox.supervise",
    "contacts.view",
    "contacts.manage",
    "consent.view_evidence",
    "consent.manage",
    "appointments.view",
    "appointments.manage",
    "labs.view_workflow",
    "templates.view",
    "templates.manage",
    "campaigns.view",
    "campaigns.create",
    "campaigns.approve",
    "campaigns.launch",
    "automations.view",
    "automations.manage",
    "automations.view_definitions",
    "automations.control_runs",
    "automations.manage_versions",
    "automations.approve_versions",
    "automations.activate_versions",
    "ai_governance.view",
    "ai_governance.record_retrospective",
    "clinical.view_pathways",
    "analytics.view_aggregate",
    "usage.view",
    "audit.view",
    "exports.create",
  ],
  supervisor: [
    "inbox.view",
    "inbox.assign",
    "inbox.reply",
    "inbox.supervise",
    "contacts.view",
    "consent.view_evidence",
    "appointments.view",
    "appointments.manage",
    "labs.view_workflow",
    "templates.view",
    "campaigns.view",
    "automations.view",
    "automations.view_definitions",
    "automations.control_runs",
    "ai_governance.view",
    "ai_governance.record_retrospective",
    "analytics.view_aggregate",
    "audit.view",
  ],
  agent: [
    "inbox.view",
    "inbox.reply",
    "contacts.view",
    "consent.view_evidence",
    "appointments.view",
    "appointments.manage",
    "labs.view_workflow",
    "templates.view",
  ],
  campaign_operator: [
    "contacts.view",
    "templates.view",
    "templates.manage",
    "campaigns.view",
    "campaigns.create",
    "campaigns.launch",
    "analytics.view_aggregate",
    "usage.view",
  ],
  campaign_approver: [
    "consent.view_evidence",
    "templates.view",
    "campaigns.view",
    "campaigns.approve",
    "campaigns.launch",
    "analytics.view_aggregate",
    "usage.view",
    "audit.view",
  ],
  analyst: [
    "campaigns.view",
    "automations.view",
    "automations.view_definitions",
    "clinical.view_pathways",
    "analytics.view_aggregate",
    "usage.view",
  ],
  privacy_reviewer: [
    "workspace.propose_retention",
    "contacts.view",
    "consent.view_evidence",
    "consent.manage",
    "campaigns.view",
    "ai_governance.view",
    "analytics.view_aggregate",
    "usage.view",
    "audit.view",
    "exports.create",
  ],
  clinical_approver: [
    "inbox.view",
    "appointments.view",
    "labs.view_workflow",
    "ai_governance.view",
    "ai_governance.record_retrospective",
    "clinical.view_pathways",
    "clinical.approve_pathways",
    "clinical.control_enrollments",
    "clinical.manage_escalations",
    "audit.view",
  ],
} as const satisfies Record<WorkspaceRole, readonly Permission[]>;

export interface WorkspaceResourceScope {
  readonly workspaceId: WorkspaceId;
  readonly sensitivity: "workspace";
  readonly teamId?: never;
  readonly locationId?: never;
}

export interface PatientResourceScope {
  readonly workspaceId: WorkspaceId;
  readonly sensitivity: "patient";
  readonly teamId: TeamId;
  readonly locationId: LocationId;
}

/** Typed callers cannot omit sensitivity or either half of a patient scope. */
export type ResourceScope = WorkspaceResourceScope | PatientResourceScope;

export type AuthorizationDenialReason =
  | "membership_inactive"
  | "cross_workspace"
  | "permission_missing"
  | "invalid_scope_configuration"
  | "team_out_of_scope"
  | "location_out_of_scope"
  | "recent_auth_required"
  | "mfa_required";

export type AuthorizationDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: AuthorizationDenialReason };

const STEP_UP_PERMISSIONS = new Set<Permission>([
  "workspace.manage_connections",
  "workspace.manage_members",
  "campaigns.launch",
  "automations.manage_versions",
  "automations.approve_versions",
  "automations.activate_versions",
  "ai_governance.record_retrospective",
  "clinical.approve_pathways",
  "clinical.control_enrollments",
  "clinical.manage_escalations",
  "exports.create",
]);

const MFA_PERMISSIONS = new Set<Permission>([
  "workspace.manage_connections",
  "workspace.manage_members",
  "campaigns.approve",
  "campaigns.launch",
  "automations.manage_versions",
  "automations.approve_versions",
  "automations.activate_versions",
  "ai_governance.record_retrospective",
  "clinical.approve_pathways",
  "clinical.control_enrollments",
  "clinical.manage_escalations",
  "exports.create",
]);

export function permissionsForRole(role: WorkspaceRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function hasPermission(role: WorkspaceRole, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] as readonly Permission[]).includes(permission);
}

export function authorizeWorkspaceAction(input: {
  readonly membership: WorkspaceMembership;
  readonly permission: Permission;
  readonly resource: ResourceScope;
  readonly now: ISODateTime;
  readonly recentAuthenticationWindowMinutes?: number;
  readonly requireMfa?: boolean;
}): AuthorizationDecision {
  const { membership, permission, resource } = input;

  if (membership.status !== "active") {
    return { allowed: false, reason: "membership_inactive" };
  }

  if (membership.workspaceId !== resource.workspaceId) {
    return { allowed: false, reason: "cross_workspace" };
  }

  if (!hasPermission(membership.role, permission)) {
    return { allowed: false, reason: "permission_missing" };
  }

  const hasWorkspaceWideScope =
    membership.scopeMode === "workspace_wide" && membership.role === "tenant_admin";

  if (membership.scopeMode === "workspace_wide" && !hasWorkspaceWideScope) {
    return { allowed: false, reason: "invalid_scope_configuration" };
  }

  if (
    resource.sensitivity === "patient" &&
    !hasWorkspaceWideScope &&
    (!resource.teamId || !resource.locationId)
  ) {
    return { allowed: false, reason: "invalid_scope_configuration" };
  }

  if (resource.teamId && !hasWorkspaceWideScope && !membership.teamIds.includes(resource.teamId)) {
    return { allowed: false, reason: "team_out_of_scope" };
  }

  if (
    resource.locationId &&
    !hasWorkspaceWideScope &&
    !membership.locationIds.includes(resource.locationId)
  ) {
    return { allowed: false, reason: "location_out_of_scope" };
  }

  const requireMfa = MFA_PERMISSIONS.has(permission) || input.requireMfa === true;
  if (requireMfa && !membership.mfaSatisfied) {
    return { allowed: false, reason: "mfa_required" };
  }

  if (STEP_UP_PERMISSIONS.has(permission)) {
    const windowMinutes = input.recentAuthenticationWindowMinutes ?? 15;
    const nowMs = Date.parse(input.now);
    const authenticatedMs = Date.parse(membership.lastAuthenticatedAt);
    const validWindow =
      Number.isFinite(windowMinutes) && windowMinutes > 0 && windowMinutes <= 15;
    const validNow =
      Number.isFinite(nowMs) && new Date(nowMs).toISOString() === input.now;
    const validAuthentication =
      Number.isFinite(authenticatedMs) &&
      new Date(authenticatedMs).toISOString() === membership.lastAuthenticatedAt;
    const elapsedMs = nowMs - authenticatedMs;
    if (
      !validWindow ||
      !validNow ||
      !validAuthentication ||
      elapsedMs < 0 ||
      elapsedMs > windowMinutes * 60_000
    ) {
      return { allowed: false, reason: "recent_auth_required" };
    }
  }

  return { allowed: true };
}

export interface ActionAuthorizationPolicy {
  /** Trusted Functions may perform the action without impersonating a member. */
  readonly systemAllowed: boolean;
  /** Null means staff callers can never request this action directly. */
  readonly staffPermission: Permission | null;
}

const AUTOMATION_ACTION_AUTHORIZATION = {
  start: { systemAllowed: true, staffPermission: "automations.control_runs" },
  advance_step: { systemAllowed: true, staffPermission: "automations.control_runs" },
  pause: { systemAllowed: false, staffPermission: "automations.control_runs" },
  resume: { systemAllowed: false, staffPermission: "automations.control_runs" },
  simulate_human_takeover: { systemAllowed: true, staffPermission: "automations.control_runs" },
  release_human_takeover: { systemAllowed: false, staffPermission: "automations.control_runs" },
  exercise_fallback: { systemAllowed: false, staffPermission: "automations.control_runs" },
  inject_failure: { systemAllowed: true, staffPermission: "automations.control_runs" },
  retry: { systemAllowed: false, staffPermission: "automations.control_runs" },
  end: { systemAllowed: false, staffPermission: "automations.control_runs" },
} as const satisfies Record<AutomationRunAction, ActionAuthorizationPolicy>;

const CARE_ACTION_AUTHORIZATION = {
  start: { systemAllowed: true, staffPermission: "clinical.control_enrollments" },
  advance_contact: { systemAllowed: true, staffPermission: "clinical.control_enrollments" },
  pause: { systemAllowed: false, staffPermission: "clinical.control_enrollments" },
  resume: { systemAllowed: false, staffPermission: "clinical.control_enrollments" },
  end: { systemAllowed: false, staffPermission: "clinical.control_enrollments" },
  simulate_suppression: { systemAllowed: true, staffPermission: "clinical.control_enrollments" },
  human_takeover_started: { systemAllowed: true, staffPermission: "clinical.control_enrollments" },
  release_human_takeover: { systemAllowed: false, staffPermission: "clinical.control_enrollments" },
  clear_clinical_hold: { systemAllowed: false, staffPermission: "clinical.manage_escalations" },
  raise_red_flag: { systemAllowed: true, staffPermission: "clinical.control_enrollments" },
  acknowledge_escalation: { systemAllowed: false, staffPermission: "clinical.manage_escalations" },
  resolve_escalation: { systemAllowed: false, staffPermission: "clinical.manage_escalations" },
  clear_safety_hold: { systemAllowed: false, staffPermission: "clinical.manage_escalations" },
} as const satisfies Record<CareEnrollmentAction, ActionAuthorizationPolicy>;

export function authorizationPolicyForAutomationAction(
  action: AutomationRunAction,
  context?: { readonly fromState: AutomationExecutionState },
): ActionAuthorizationPolicy {
  if (action === "exercise_fallback") {
    return {
      systemAllowed:
        context?.fromState === "running" || context?.fromState === "waiting",
      staffPermission: "automations.control_runs",
    };
  }
  return AUTOMATION_ACTION_AUTHORIZATION[action];
}

export function authorizationPolicyForCareAction(
  action: CareEnrollmentAction,
): ActionAuthorizationPolicy {
  return CARE_ACTION_AUTHORIZATION[action];
}
