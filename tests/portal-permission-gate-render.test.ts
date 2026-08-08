import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OverviewPage from "@/app/(portal)/page";
import {
  PortalPermissionGate,
  portalAuthorityRenderKey,
} from "@/components/auth/portal-permission-gate";
import type { WorkspaceSessionSnapshot } from "@/components/auth/workspace-session";
import { PortalShell } from "@/components/portal-shell";
import { HelpWorkspace } from "@/components/settings/help-workspace";
import type {
  VerifiedWorkspaceSession,
  WorkspaceRole,
} from "@/lib/firebase/workspace-session-model";

const harness = vi.hoisted(() => ({
  pathname: { current: "/" },
  workspace: { current: null as unknown },
  router: { replace: vi.fn(), refresh: vi.fn() },
  signOut: vi.fn(async () => undefined),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => harness.pathname.current,
  useRouter: () => harness.router,
}));

vi.mock("@/components/auth/auth-session", () => ({
  useAuthSession: () => ({ signOut: harness.signOut }),
}));

vi.mock("@/components/auth/workspace-session", () => ({
  useWorkspaceSession: () => harness.workspace.current,
}));

vi.mock("@/lib/config/public-env", () => ({
  isSafeDemo: true,
  publicStageLabel: "SAFENET SYNTHETIC DEMO",
}));

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

function verified(role: WorkspaceRole): WorkspaceSessionSnapshot {
  return { status: "verified", session: session(role), message: null };
}

describe("portal direct-route permission gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.pathname.current = "/";
    harness.workspace.current = verified("tenant_admin");
  });

  it("synchronously removes an allowed feature subtree after an authority downgrade", () => {
    const featureRead = vi.fn(() =>
      createElement("div", { "data-private-feature": true }, "Private connections feature"),
    );
    harness.pathname.current = "/connections";

    const allowedMarkup = renderToStaticMarkup(
      createElement(
        PortalPermissionGate,
        null,
        createElement(featureRead),
      ),
    );
    expect(allowedMarkup).toContain("Private connections feature");
    expect(featureRead).toHaveBeenCalledOnce();

    harness.workspace.current = verified("agent");
    const deniedMarkup = renderToStaticMarkup(
      createElement(
        PortalPermissionGate,
        null,
        createElement(featureRead),
      ),
    );
    expect(deniedMarkup).toContain("Access denied");
    expect(deniedMarkup).toContain("No feature data was rendered or read");
    expect(deniedMarkup).not.toContain("Private connections feature");
    expect(featureRead).toHaveBeenCalledOnce();
  });

  it("synchronously removes prior children when the path changes to a denied route", () => {
    const featureRead = vi.fn(() =>
      createElement("div", { "data-private-feature": true }, "Previously allowed overview"),
    );
    harness.workspace.current = verified("agent");

    const allowedMarkup = renderToStaticMarkup(
      createElement(
        PortalPermissionGate,
        null,
        createElement(featureRead),
      ),
    );
    expect(allowedMarkup).toContain("Previously allowed overview");
    expect(featureRead).toHaveBeenCalledOnce();

    harness.pathname.current = "/team";
    const deniedMarkup = renderToStaticMarkup(
      createElement(
        PortalPermissionGate,
        null,
        createElement(featureRead),
      ),
    );
    expect(deniedMarkup).toContain('role="alert"');
    expect(deniedMarkup).toContain("This page is not available for your session");
    expect(deniedMarkup).not.toContain("Previously allowed overview");
    expect(featureRead).toHaveBeenCalledOnce();
  });

  it("fails closed before a feature read for an unregistered direct URL", () => {
    const featureRead = vi.fn(() =>
      createElement("div", null, "Unregistered feature payload"),
    );
    harness.pathname.current = "/future-admin-page";

    const markup = renderToStaticMarkup(
      createElement(
        PortalPermissionGate,
        null,
        createElement(featureRead),
      ),
    );
    expect(markup).toContain("no approved portal access policy");
    expect(markup).not.toContain("Unregistered feature payload");
    expect(featureRead).not.toHaveBeenCalled();
  });

  it("renders no child while workspace authority is checking or revoked", () => {
    const featureRead = vi.fn(() => createElement("div", null, "Stale feature"));

    for (const snapshot of [
      { status: "checking", session: null, message: null },
      { status: "denied", session: null, message: "Membership revoked." },
    ] satisfies readonly WorkspaceSessionSnapshot[]) {
      harness.workspace.current = snapshot;
      expect(
        renderToStaticMarkup(
          createElement(
            PortalPermissionGate,
            null,
            createElement(featureRead),
          ),
        ),
      ).toBe("");
    }

    expect(featureRead).not.toHaveBeenCalled();
  });

  it("changes the authority remount key on a workspace-wide to assigned downgrade", () => {
    const workspaceWide = session("tenant_admin");
    const assigned = {
      ...workspaceWide,
      scopeMode: "assigned" as const,
      teamIds: ["team_synthetic_operations"],
      locationIds: ["location_synthetic_wattala"],
    };

    expect(portalAuthorityRenderKey("/inbox", workspaceWide)).not.toBe(
      portalAuthorityRenderKey("/inbox", assigned),
    );
  });
});

describe("permission-filtered portal navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.pathname.current = "/";
    harness.workspace.current = verified("agent");
  });

  it("omits links the verified agent cannot open", () => {
    const markup = renderToStaticMarkup(
      createElement(PortalShell, null, createElement("div", null, "Allowed page")),
    );

    for (const allowedPath of [
      "/inbox",
      "/contacts",
      "/appointments",
      "/labs",
      "/templates",
      "/help",
    ]) {
      expect(markup).toContain(`href="${allowedPath}"`);
    }
    for (const deniedPath of [
      "/campaigns",
      "/ai-knowledge",
      "/connections",
      "/team",
      "/demo-lab",
    ]) {
      expect(markup).not.toContain(`href="${deniedPath}"`);
    }
    expect(markup).not.toContain("Intelligence");
    expect(markup).not.toContain("Administration");
  });

  it("shows every explicitly approved link to the tenant administrator", () => {
    harness.workspace.current = verified("tenant_admin");
    const markup = renderToStaticMarkup(
      createElement(PortalShell, null, createElement("div", null, "Allowed page")),
    );

    for (const path of [
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
    ]) {
      expect(markup).toContain(`href="${path}"`);
    }
  });
});

describe("permission-filtered overview and help calls to action", () => {
  beforeEach(() => {
    harness.pathname.current = "/";
    harness.workspace.current = verified("platform_owner");
  });

  it("does not offer a platform owner guaranteed-denial overview destinations", () => {
    const markup = renderToStaticMarkup(createElement(OverviewPage));

    for (const deniedPath of [
      "/demo-lab",
      "/inbox",
      "/team",
      "/connections",
      "/ai-knowledge",
      "/campaigns",
    ]) {
      expect(markup).not.toContain(`href="${deniedPath}"`);
    }
  });

  it("shows an agent only overview destinations allowed by the shared route policy", () => {
    harness.workspace.current = verified("agent");
    const markup = renderToStaticMarkup(createElement(OverviewPage));

    expect(markup).toContain('href="/inbox"');
    for (const deniedPath of [
      "/demo-lab",
      "/team",
      "/connections",
      "/ai-knowledge",
      "/campaigns",
    ]) {
      expect(markup).not.toContain(`href="${deniedPath}"`);
    }
  });

  it("filters every Help CTA through visiblePortalRoutePaths", () => {
    const ownerMarkup = renderToStaticMarkup(createElement(HelpWorkspace));
    expect(ownerMarkup).toContain('href="/"');
    for (const deniedPath of [
      "/demo-lab",
      "/inbox",
      "/connections",
      "/compliance",
      "/appointments",
      "/contacts",
      "/campaigns",
      "/analytics",
    ]) {
      expect(ownerMarkup).not.toContain(`href="${deniedPath}"`);
    }

    harness.workspace.current = verified("agent");
    const agentMarkup = renderToStaticMarkup(createElement(HelpWorkspace));
    for (const allowedPath of ["/", "/inbox", "/appointments", "/contacts"]) {
      expect(agentMarkup).toContain(`href="${allowedPath}"`);
    }
    for (const deniedPath of ["/demo-lab", "/connections", "/campaigns", "/analytics"]) {
      expect(agentMarkup).not.toContain(`href="${deniedPath}"`);
    }
  });
});
