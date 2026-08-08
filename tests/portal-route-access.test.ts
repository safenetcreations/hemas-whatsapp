import { describe, expect, it } from "vitest";
import {
  DEMO_LAB_ALLOWED_ROLES,
  PORTAL_ROUTE_PATHS,
  PORTAL_ROUTE_POLICIES,
  normalizePortalPath,
  portalRouteDecision,
  visiblePortalRoutePaths,
  type PortalRoutePath,
} from "@/components/auth/portal-route-access";
import type {
  VerifiedWorkspaceSession,
  WorkspaceRole,
} from "@/lib/firebase/workspace-session-model";

function session(role: WorkspaceRole): VerifiedWorkspaceSession {
  return {
    workspaceId: "workspace_safenet_demo",
    workspaceName: "SafeNet demo",
    workspaceMode: "demo",
    dataClassification: "synthetic_only",
    uid: `user_synthetic_${role}`,
    displayLabel: `Synthetic ${role}`,
    role,
    scopeMode: role === "tenant_admin" ? "workspace_wide" : "assigned",
    teamIds: ["team_synthetic_operations"],
    locationIds: ["location_synthetic_wattala"],
  };
}

const expectedPathsByRole: Record<WorkspaceRole, readonly PortalRoutePath[]> = {
  platform_owner: ["/", "/help"],
  tenant_admin: [...PORTAL_ROUTE_PATHS],
  supervisor: [
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
    "/compliance",
    "/demo-lab",
    "/help",
  ],
  agent: [
    "/",
    "/inbox",
    "/contacts",
    "/appointments",
    "/labs",
    "/templates",
    "/help",
  ],
  campaign_operator: [
    "/",
    "/contacts",
    "/campaigns",
    "/templates",
    "/analytics",
    "/usage",
    "/demo-lab",
    "/help",
  ],
  campaign_approver: [
    "/",
    "/campaigns",
    "/templates",
    "/analytics",
    "/compliance",
    "/usage",
    "/demo-lab",
    "/help",
  ],
  analyst: [
    "/",
    "/campaigns",
    "/automations",
    "/analytics",
    "/usage",
    "/help",
  ],
  privacy_reviewer: [
    "/",
    "/contacts",
    "/campaigns",
    "/analytics",
    "/ai-knowledge",
    "/compliance",
    "/usage",
    "/help",
  ],
  clinical_approver: [
    "/",
    "/inbox",
    "/appointments",
    "/labs",
    "/automations",
    "/ai-knowledge",
    "/compliance",
    "/demo-lab",
    "/help",
  ],
};

describe("explicit portal route policies", () => {
  it("covers every current portal page exactly once", () => {
    expect(PORTAL_ROUTE_PATHS).toEqual([
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
    ]);
    expect(Object.keys(PORTAL_ROUTE_POLICIES).sort()).toEqual(
      [...PORTAL_ROUTE_PATHS].sort(),
    );
    for (const path of PORTAL_ROUTE_PATHS) {
      expect(PORTAL_ROUTE_POLICIES[path].path).toBe(path);
    }
  });

  it("maps operational and administrative routes to least-privilege capabilities", () => {
    expect(PORTAL_ROUTE_POLICIES["/inbox"].requirement).toEqual({
      kind: "permission",
      permission: "inbox.view",
    });
    expect(PORTAL_ROUTE_POLICIES["/contacts"].requirement).toEqual({
      kind: "permission",
      permission: "contacts.view",
    });
    expect(PORTAL_ROUTE_POLICIES["/appointments"].requirement).toEqual({
      kind: "permission",
      permission: "appointments.view",
    });
    expect(PORTAL_ROUTE_POLICIES["/labs"].requirement).toEqual({
      kind: "permission",
      permission: "labs.view_workflow",
    });
    expect(PORTAL_ROUTE_POLICIES["/connections"].requirement).toEqual({
      kind: "permission",
      permission: "workspace.view_connections",
    });
    expect(PORTAL_ROUTE_POLICIES["/team"].requirement).toEqual({
      kind: "permission",
      permission: "workspace.view_members",
    });
    expect(PORTAL_ROUTE_POLICIES["/settings"].requirement).toEqual({
      kind: "permission",
      permission: "workspace.manage_settings",
    });
    expect(PORTAL_ROUTE_POLICIES["/automations"].requirement).toEqual({
      kind: "any_permission",
      permissions: ["automations.view_definitions", "clinical.view_pathways"],
    });
  });

  it("binds AI Knowledge to its capability and keeps Demo Lab on an explicit allowlist", () => {
    expect(PORTAL_ROUTE_POLICIES["/ai-knowledge"].requirement).toEqual({
      kind: "permission",
      permission: "ai_governance.view",
    });
    expect(DEMO_LAB_ALLOWED_ROLES).toEqual([
      "tenant_admin",
      "supervisor",
      "campaign_operator",
      "campaign_approver",
      "clinical_approver",
    ]);
  });
});

describe("portal route role matrix", () => {
  it.each(Object.entries(expectedPathsByRole) as [WorkspaceRole, readonly PortalRoutePath[]][])(
    "exposes only approved routes to %s",
    (role, expectedPaths) => {
      const verifiedSession = session(role);
      expect(
        [...visiblePortalRoutePaths({ session: verifiedSession, syntheticStage: true })],
      ).toEqual(expectedPaths);

      for (const path of PORTAL_ROUTE_PATHS) {
        expect(
          portalRouteDecision({
            pathname: path,
            session: verifiedSession,
            syntheticStage: true,
          }).allowed,
        ).toBe(expectedPaths.includes(path));
      }
    },
  );

  it("allows Overview and Help to every verified role", () => {
    for (const role of Object.keys(expectedPathsByRole) as WorkspaceRole[]) {
      expect(
        portalRouteDecision({
          pathname: "/",
          session: session(role),
          syntheticStage: true,
        }).allowed,
      ).toBe(true);
      expect(
        portalRouteDecision({
          pathname: "/help",
          session: session(role),
          syntheticStage: true,
        }).allowed,
      ).toBe(true);
    }
  });

  it("blocks Demo Lab outside the safe synthetic stage even for an allowed role", () => {
    expect(
      portalRouteDecision({
        pathname: "/demo-lab",
        session: session("tenant_admin"),
        syntheticStage: false,
      }),
    ).toMatchObject({ allowed: false, reason: "unsafe_stage" });
  });

  it("normalizes harmless URL suffixes but denies every unregistered route", () => {
    expect(normalizePortalPath("/inbox/?view=queue#top")).toBe("/inbox");
    expect(
      portalRouteDecision({
        pathname: "/inbox/",
        session: session("agent"),
        syntheticStage: true,
      }).allowed,
    ).toBe(true);
    expect(
      portalRouteDecision({
        pathname: "/connections/security",
        session: session("tenant_admin"),
        syntheticStage: true,
      }),
    ).toMatchObject({ allowed: false, reason: "unknown_route", policy: null });
  });
});
