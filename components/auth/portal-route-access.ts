import {
  hasPermission,
  type Permission,
} from "@/lib/domain/access-control";
import type {
  VerifiedWorkspaceSession,
  WorkspaceRole,
} from "@/lib/firebase/workspace-session-model";

export const PORTAL_ROUTE_PATHS = [
  "/",
  "/inbox",
  "/contacts",
  "/appointments",
  "/labs",
  "/campaigns",
  "/templates",
  "/automations",
  "/analytics",
  "/ai-knowledge",
  "/connections",
  "/team",
  "/compliance",
  "/usage",
  "/settings",
  "/demo-lab",
  "/help",
] as const;

export type PortalRoutePath = (typeof PORTAL_ROUTE_PATHS)[number];

type VerifiedMemberRequirement = {
  readonly kind: "verified_member";
};

type PermissionRequirement = {
  readonly kind: "permission";
  readonly permission: Permission;
};

type AnyPermissionRequirement = {
  readonly kind: "any_permission";
  readonly permissions: readonly Permission[];
};

type RoleAllowlistRequirement = {
  readonly kind: "role_allowlist";
  readonly roles: readonly WorkspaceRole[];
};

type SyntheticRoleAllowlistRequirement = {
  readonly kind: "synthetic_role_allowlist";
  readonly roles: readonly WorkspaceRole[];
};

export type PortalRouteRequirement =
  | VerifiedMemberRequirement
  | PermissionRequirement
  | AnyPermissionRequirement
  | RoleAllowlistRequirement
  | SyntheticRoleAllowlistRequirement;

export type PortalRoutePolicy = {
  readonly path: PortalRoutePath;
  readonly label: string;
  readonly requirement: PortalRouteRequirement;
};

// Demo Lab can exercise cross-functional synthetic workflows. It is limited to
// named governance/operator roles and is still blocked outside the safe demo stage.
export const DEMO_LAB_ALLOWED_ROLES = [
  "tenant_admin",
  "supervisor",
  "campaign_operator",
  "campaign_approver",
  "clinical_approver",
] as const satisfies readonly WorkspaceRole[];

export const PORTAL_ROUTE_POLICIES = {
  "/": {
    path: "/",
    label: "Overview",
    requirement: { kind: "verified_member" },
  },
  "/inbox": {
    path: "/inbox",
    label: "Inbox",
    requirement: { kind: "permission", permission: "inbox.view" },
  },
  "/contacts": {
    path: "/contacts",
    label: "Contacts",
    requirement: { kind: "permission", permission: "contacts.view" },
  },
  "/appointments": {
    path: "/appointments",
    label: "Appointments",
    requirement: { kind: "permission", permission: "appointments.view" },
  },
  "/labs": {
    path: "/labs",
    label: "Lab journeys",
    requirement: { kind: "permission", permission: "labs.view_workflow" },
  },
  "/campaigns": {
    path: "/campaigns",
    label: "Campaigns",
    requirement: { kind: "permission", permission: "campaigns.view" },
  },
  "/templates": {
    path: "/templates",
    label: "Templates & Flows",
    requirement: { kind: "permission", permission: "templates.view" },
  },
  "/automations": {
    path: "/automations",
    label: "Automations",
    requirement: {
      kind: "any_permission",
      permissions: ["automations.view_definitions", "clinical.view_pathways"],
    },
  },
  "/analytics": {
    path: "/analytics",
    label: "Analytics",
    requirement: { kind: "permission", permission: "analytics.view_aggregate" },
  },
  "/ai-knowledge": {
    path: "/ai-knowledge",
    label: "AI & Knowledge",
    requirement: { kind: "permission", permission: "ai_governance.view" },
  },
  "/connections": {
    path: "/connections",
    label: "Connections",
    requirement: { kind: "permission", permission: "workspace.view_connections" },
  },
  "/team": {
    path: "/team",
    label: "Team & Routing",
    requirement: { kind: "permission", permission: "workspace.view_members" },
  },
  "/compliance": {
    path: "/compliance",
    label: "Compliance",
    requirement: { kind: "permission", permission: "audit.view" },
  },
  "/usage": {
    path: "/usage",
    label: "Usage",
    requirement: { kind: "permission", permission: "usage.view" },
  },
  "/settings": {
    path: "/settings",
    label: "Settings",
    requirement: { kind: "permission", permission: "workspace.manage_settings" },
  },
  "/demo-lab": {
    path: "/demo-lab",
    label: "Demo Lab",
    requirement: {
      kind: "synthetic_role_allowlist",
      roles: DEMO_LAB_ALLOWED_ROLES,
    },
  },
  "/help": {
    path: "/help",
    label: "Help & escalation",
    requirement: { kind: "verified_member" },
  },
} as const satisfies Record<PortalRoutePath, PortalRoutePolicy>;

export type PortalRouteDenialReason =
  | "unknown_route"
  | "permission_missing"
  | "role_not_allowed"
  | "unsafe_stage";

export type PortalRouteDecision =
  | {
      readonly allowed: true;
      readonly path: PortalRoutePath;
      readonly policy: PortalRoutePolicy;
    }
  | {
      readonly allowed: false;
      readonly path: string;
      readonly policy: PortalRoutePolicy | null;
      readonly reason: PortalRouteDenialReason;
    };

export function normalizePortalPath(pathname: string): string {
  const pathOnly = pathname.split(/[?#]/u, 1)[0] ?? "";
  if (pathOnly === "" || pathOnly === "/") return "/";
  return pathOnly.endsWith("/") ? pathOnly.slice(0, -1) : pathOnly;
}

export function portalRoutePolicyForPath(pathname: string): PortalRoutePolicy | null {
  const normalized = normalizePortalPath(pathname);
  if (!Object.prototype.hasOwnProperty.call(PORTAL_ROUTE_POLICIES, normalized)) {
    return null;
  }

  return PORTAL_ROUTE_POLICIES[normalized as PortalRoutePath];
}

export function portalRouteDecision(input: {
  readonly pathname: string;
  readonly session: VerifiedWorkspaceSession;
  readonly syntheticStage: boolean;
}): PortalRouteDecision {
  const normalized = normalizePortalPath(input.pathname);
  const policy = portalRoutePolicyForPath(normalized);
  if (!policy) {
    return {
      allowed: false,
      path: normalized,
      policy: null,
      reason: "unknown_route",
    };
  }

  const requirement = policy.requirement;
  if (requirement.kind === "verified_member") {
    return { allowed: true, path: policy.path, policy };
  }

  if (requirement.kind === "permission") {
    return hasPermission(input.session.role, requirement.permission)
      ? { allowed: true, path: policy.path, policy }
      : {
          allowed: false,
          path: policy.path,
          policy,
          reason: "permission_missing",
        };
  }

  if (requirement.kind === "any_permission") {
    return requirement.permissions.some((permission) =>
      hasPermission(input.session.role, permission),
    )
      ? { allowed: true, path: policy.path, policy }
      : {
          allowed: false,
          path: policy.path,
          policy,
          reason: "permission_missing",
        };
  }

  if (requirement.kind === "role_allowlist") {
    return (requirement.roles as readonly WorkspaceRole[]).includes(input.session.role)
      ? { allowed: true, path: policy.path, policy }
      : {
          allowed: false,
          path: policy.path,
          policy,
          reason: "role_not_allowed",
        };
  }

  const safeSyntheticSession =
    input.syntheticStage &&
    (input.session.workspaceMode === "demo" || input.session.workspaceMode === "local") &&
    input.session.dataClassification === "synthetic_only";
  if (!safeSyntheticSession) {
    return {
      allowed: false,
      path: policy.path,
      policy,
      reason: "unsafe_stage",
    };
  }

  return (requirement.roles as readonly WorkspaceRole[]).includes(input.session.role)
    ? { allowed: true, path: policy.path, policy }
    : {
        allowed: false,
        path: policy.path,
        policy,
        reason: "role_not_allowed",
      };
}

export function visiblePortalRoutePaths(input: {
  readonly session: VerifiedWorkspaceSession;
  readonly syntheticStage: boolean;
}): ReadonlySet<PortalRoutePath> {
  return new Set(
    PORTAL_ROUTE_PATHS.filter(
      (pathname) =>
        portalRouteDecision({
          pathname,
          session: input.session,
          syntheticStage: input.syntheticStage,
        }).allowed,
    ),
  );
}
