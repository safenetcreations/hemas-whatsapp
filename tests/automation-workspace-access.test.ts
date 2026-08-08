import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSessionSnapshot } from "@/components/auth/workspace-session";
import {
  AutomationWorkspace,
  automationWorkspaceAuthorityKey,
  automationWorkspaceCapabilities,
} from "@/components/automations/automation-workspace";
import {
  sessionCanReadPatientScope,
  SYNTHETIC_AUTOMATION_SCOPE,
  SYNTHETIC_CARE_SCOPE,
} from "@/components/automations/automation-workspace-data";
import {
  automationControlsLocked,
  type AutomationWorkspaceActionState,
} from "@/components/automations/use-automation-workspace";
import type {
  VerifiedWorkspaceSession,
  WorkspaceRole,
} from "@/lib/firebase/workspace-session-model";

const harness = vi.hoisted(() => ({
  workspace: { current: null as unknown },
}));

vi.mock("@/components/auth/workspace-session", () => ({
  useWorkspaceSession: () => harness.workspace.current,
}));

function session(
  role: WorkspaceRole,
  overrides: Partial<VerifiedWorkspaceSession> = {},
): VerifiedWorkspaceSession {
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
    ...overrides,
  };
}

function verified(role: WorkspaceRole): WorkspaceSessionSnapshot {
  return { status: "verified", session: session(role), message: null };
}

describe("automation workspace family and action authority", () => {
  beforeEach(() => {
    harness.workspace.current = verified("supervisor");
  });

  it.each([
    ["supervisor", true, true, true, false, false, false, false],
    ["analyst", true, false, false, true, false, false, false],
    ["clinical_approver", false, false, false, true, true, true, true],
    ["tenant_admin", true, true, true, true, true, false, false],
  ] as const)(
    "derives the exact catalogue, operation, and control grants for %s",
    (
      role,
      canViewDefinitions,
      canReadAutomationOperations,
      canControlRuns,
      canViewCarePaths,
      canReadCareOperations,
      canControlEnrollments,
      canManageEscalations,
    ) => {
      expect(automationWorkspaceCapabilities(session(role))).toEqual({
        canViewDefinitions,
        canReadAutomationOperations,
        canControlRuns,
        canViewCarePaths,
        canReadCareOperations,
        canControlEnrollments,
        canManageEscalations,
      });
    },
  );

  it("renders only the supervisor's automation family while authoritative reads are pending", () => {
    const markup = renderToStaticMarkup(createElement(AutomationWorkspace));

    expect(markup).toContain('data-automation-pane="definitions"');
    expect(markup).toContain('data-automation-load-state="loading"');
    expect(markup).toContain("Loading authoritative evidence");
    expect(markup).not.toContain("Start governed run");
    expect(markup).not.toContain('id="care-path-tab"');
    expect(markup).not.toContain('data-automation-pane="care_path"');
    expect(markup).not.toContain("patientName");
  });

  it("synchronously removes a previously allowed clinical pane after an authority change", () => {
    harness.workspace.current = verified("clinical_approver");
    const clinicalMarkup = renderToStaticMarkup(createElement(AutomationWorkspace));
    expect(clinicalMarkup).toContain('data-automation-pane="care_path"');
    expect(clinicalMarkup).toContain("Loading authoritative evidence");
    expect(clinicalMarkup).not.toContain('id="definitions-tab"');

    harness.workspace.current = verified("supervisor");
    const downgradedMarkup = renderToStaticMarkup(createElement(AutomationWorkspace));
    expect(downgradedMarkup).toContain('data-automation-pane="definitions"');
    expect(downgradedMarkup).not.toContain('data-automation-pane="care_path"');
    expect(downgradedMarkup).not.toContain("Start approved pathway");
    expect(downgradedMarkup).not.toContain('id="care-path-tab"');
  });

  it("shows both analyst catalogues but no controls before or during authoritative loading", () => {
    harness.workspace.current = verified("analyst");
    const markup = renderToStaticMarkup(createElement(AutomationWorkspace));

    expect(markup).toContain('data-automation-pane="definitions"');
    expect(markup).not.toContain("Start governed run");
    expect(markup).not.toContain("Start approved pathway");
    expect(markup).toContain('id="care-path-tab"');
  });

  it("requires an exact team and exact location unless a tenant admin is workspace-wide", () => {
    expect(
      sessionCanReadPatientScope(
        session("supervisor", {
          teamIds: [SYNTHETIC_AUTOMATION_SCOPE.teamId],
          locationIds: [SYNTHETIC_AUTOMATION_SCOPE.locationId],
        }),
        SYNTHETIC_AUTOMATION_SCOPE,
      ),
    ).toBe(true);
    expect(
      sessionCanReadPatientScope(
        session("supervisor", {
          teamIds: [SYNTHETIC_AUTOMATION_SCOPE.teamId],
          locationIds: ["location_other"],
        }),
        SYNTHETIC_AUTOMATION_SCOPE,
      ),
    ).toBe(false);
    expect(
      sessionCanReadPatientScope(
        session("clinical_approver", {
          teamIds: [SYNTHETIC_CARE_SCOPE.teamId],
          locationIds: [SYNTHETIC_CARE_SCOPE.locationId],
        }),
        SYNTHETIC_CARE_SCOPE,
      ),
    ).toBe(true);
    expect(
      sessionCanReadPatientScope(
        session("tenant_admin", { scopeMode: "workspace_wide", teamIds: [], locationIds: [] }),
        SYNTHETIC_CARE_SCOPE,
      ),
    ).toBe(true);
  });

  it("changes the remount key for every scope or role authority change", () => {
    const workspaceWide = session("tenant_admin");
    const assigned = session("tenant_admin", { scopeMode: "assigned" });
    const differentRole = session("supervisor");

    expect(automationWorkspaceAuthorityKey(workspaceWide)).not.toBe(
      automationWorkspaceAuthorityKey(assigned),
    );
    expect(automationWorkspaceAuthorityKey(workspaceWide)).not.toBe(
      automationWorkspaceAuthorityKey(differentRole),
    );
  });

  it.each([
    ["working", true],
    ["conflict", true],
    ["evidence_mismatch", true],
    ["error", true],
    ["success", false],
    ["replay", false],
  ] as const)("locks controls for unresolved %s action state", (status, locked) => {
    const state = {
      status,
      family: "automation",
      action: "start",
      message: "Synthetic action state",
    } satisfies AutomationWorkspaceActionState;
    expect(automationControlsLocked(state)).toBe(locked);
  });

  it("renders no family pane without a verified session", () => {
    harness.workspace.current = {
      status: "checking",
      session: null,
      message: null,
    } satisfies WorkspaceSessionSnapshot;

    expect(renderToStaticMarkup(createElement(AutomationWorkspace))).toBe("");
  });

  it("renders no family pane for an agent even with a verified workspace session", () => {
    harness.workspace.current = verified("agent");
    expect(renderToStaticMarkup(createElement(AutomationWorkspace))).toBe("");
  });
});
