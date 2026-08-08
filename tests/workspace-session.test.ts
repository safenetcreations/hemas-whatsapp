import { describe, expect, it } from "vitest";
import { combinedPortalDecision } from "@/components/auth/session-model";
import {
  initialsForDisplayLabel,
  membershipScopeLabel,
  parseVerifiedWorkspaceSession,
  syntheticWorkspaceId,
  WorkspaceSessionError,
  workspaceInitials,
  workspaceRoleLabel,
} from "@/lib/firebase/workspace-session-model";

const uid = "synthetic-user-001";
const workspace = {
  id: syntheticWorkspaceId,
  name: "SafeNet Healthcare Platform Demo",
  status: "active",
  mode: "demo",
  dataClassification: "synthetic_only",
};
const membership = {
  id: uid,
  uid,
  workspaceId: syntheticWorkspaceId,
  displayLabel: "Demo tenant administrator",
  role: "tenant_admin",
  status: "active",
  scopeMode: "workspace_wide",
  teamIds: [],
  locationIds: [],
  synthetic: true,
};

function parse(overrides?: { workspace?: object; membership?: object }) {
  return parseVerifiedWorkspaceSession({
    workspaceData: { ...workspace, ...overrides?.workspace },
    membershipData: { ...membership, ...overrides?.membership },
    expectedWorkspaceId: syntheticWorkspaceId,
    expectedUid: uid,
  });
}

describe("verified workspace session documents", () => {
  it("returns bound, active, synthetic role and scope data", () => {
    expect(parse()).toEqual({
      workspaceId: syntheticWorkspaceId,
      workspaceName: workspace.name,
      workspaceMode: "demo",
      dataClassification: "synthetic_only",
      uid,
      displayLabel: membership.displayLabel,
      role: "tenant_admin",
      scopeMode: "workspace_wide",
      teamIds: [],
      locationIds: [],
    });
  });

  it.each([
    [{ workspace: { status: "locked" } }, "workspace_inactive"],
    [{ membership: { status: "revoked" } }, "membership_inactive"],
    [{ membership: { uid: "different-user" } }, "binding_mismatch"],
    [{ workspace: { mode: "uat", dataClassification: "approved_uat" } }, "unsafe_workspace"],
    [{ membership: { role: "unknown_role" } }, "invalid_schema"],
    [{ membership: { scopeMode: undefined } }, "invalid_schema"],
    [{ membership: { role: "agent", scopeMode: "workspace_wide" } }, "invalid_scope"],
  ] as const)("rejects invalid authority state %#", (overrides, expectedCode) => {
    expect(() => parse(overrides)).toThrowError(
      expect.objectContaining<Partial<WorkspaceSessionError>>({ code: expectedCode }),
    );
  });

  it("rejects either missing authority document", () => {
    expect(() =>
      parseVerifiedWorkspaceSession({
        workspaceData: null,
        membershipData: membership,
        expectedWorkspaceId: syntheticWorkspaceId,
        expectedUid: uid,
      }),
    ).toThrowError(expect.objectContaining({ code: "workspace_missing" }));
    expect(() =>
      parseVerifiedWorkspaceSession({
        workspaceData: workspace,
        membershipData: null,
        expectedWorkspaceId: syntheticWorkspaceId,
        expectedUid: uid,
      }),
    ).toThrowError(expect.objectContaining({ code: "membership_missing" }));
  });
});

describe("workspace presentation helpers", () => {
  it("derives labels from verified session data", () => {
    const session = parse();
    expect(workspaceRoleLabel(session.role)).toBe("Tenant administrator");
    expect(membershipScopeLabel(session)).toBe("Workspace-wide patient-record scope");
    expect(workspaceInitials(session.workspaceName)).toBe("SH");
    expect(initialsForDisplayLabel(session.displayLabel)).toBe("DT");
  });

  it("fails closed when an operational role has an empty scope", () => {
    const session = parse({
      membership: { role: "agent", scopeMode: "assigned", teamIds: [], locationIds: [] },
    });
    expect(membershipScopeLabel(session)).toBe("Assigned scope · no patient-record routes");
  });

  it("labels assigned scope explicitly even for a tenant administrator", () => {
    const session = parse({
      membership: {
        scopeMode: "assigned",
        teamIds: ["team-a"],
        locationIds: ["location-a"],
      },
    });
    expect(membershipScopeLabel(session)).toBe("Assigned scope · 1 team · 1 location");
  });
});

describe("combined portal gate", () => {
  it("allows content only when identity and workspace are both verified", () => {
    expect(combinedPortalDecision("authenticated", "verified")).toEqual({ action: "allow" });
    expect(combinedPortalDecision("authenticated", "checking")).toEqual({ action: "wait" });
    expect(combinedPortalDecision("checking", "verified")).toEqual({ action: "wait" });
  });

  it("redirects every identity or workspace denial", () => {
    expect(combinedPortalDecision("unauthenticated", "checking")).toEqual({
      action: "redirect",
      reason: "session-required",
    });
    expect(combinedPortalDecision("authenticated", "denied")).toEqual({
      action: "redirect",
      reason: "workspace-access-denied",
    });
    expect(combinedPortalDecision("authenticated", "unavailable")).toEqual({
      action: "redirect",
      reason: "workspace-unavailable",
    });
  });
});
