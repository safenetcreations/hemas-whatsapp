import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSessionSnapshot } from "@/components/auth/workspace-session";
import { CampaignControlCentre } from "@/components/campaigns/campaign-control-centre";
import type { VerifiedWorkspaceSession } from "@/lib/firebase/workspace-session-model";

const harness = vi.hoisted(() => ({
  workspace: { current: null as unknown },
  useCampaignWorkspace: vi.fn(() => ({
    status: "loading",
    result: null,
    message: null,
    actionState: { status: "idle", action: null, message: null },
    requestAction: vi.fn(),
    retry: vi.fn(),
    reload: vi.fn(),
  })),
}));

vi.mock("@/components/auth/workspace-session", () => ({
  useWorkspaceSession: () => harness.workspace.current,
}));

vi.mock("@/components/campaigns/use-campaign-workspace", () => ({
  useCampaignWorkspace: harness.useCampaignWorkspace,
}));

function session(
  role: VerifiedWorkspaceSession["role"] = "campaign_operator",
): VerifiedWorkspaceSession {
  return {
    workspaceId: "workspace_safenet_demo",
    workspaceName: "SafeNet demo",
    workspaceMode: "demo",
    dataClassification: "synthetic_only",
    uid: "user_demo_campaign_operator",
    displayLabel: "Demo campaign operator",
    role,
    scopeMode: role === "tenant_admin" ? "workspace_wide" : "assigned",
    teamIds: ["team_preventive"],
    locationIds: ["location_wattala"],
  };
}

function verified(
  role: VerifiedWorkspaceSession["role"],
): WorkspaceSessionSnapshot {
  return { status: "verified", session: session(role), message: null };
}

describe("campaign authority-bound rendering", () => {
  beforeEach(() => {
    harness.useCampaignWorkspace.mockClear();
    harness.workspace.current = verified("campaign_operator");
  });

  it.each(["agent", "supervisor"] as const)(
    "synchronously removes the allowed workspace tree on downgrade to %s without another campaign read",
    (role) => {
      const allowedMarkup = renderToStaticMarkup(
        createElement(CampaignControlCentre),
      );
      expect(allowedMarkup).toContain("Loading persisted campaign");
      expect(harness.useCampaignWorkspace).toHaveBeenCalledOnce();

      harness.workspace.current = verified(role);
      const deniedMarkup = renderToStaticMarkup(
        createElement(CampaignControlCentre),
      );
      expect(deniedMarkup).toContain("Campaign access denied");
      expect(deniedMarkup).toContain("No campaign query was attempted");
      expect(deniedMarkup).not.toContain("Loading persisted campaign");
      expect(harness.useCampaignWorkspace).toHaveBeenCalledOnce();
    },
  );
});
