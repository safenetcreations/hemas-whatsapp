import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceSessionSnapshot } from "@/components/auth/workspace-session";
import { ComplianceCentre } from "@/components/compliance/compliance-centre";
import type { ComplianceAuditEvent } from "@/lib/firebase/compliance-audit-functions-emulator";
import type {
  VerifiedWorkspaceSession,
  WorkspaceRole,
} from "@/lib/firebase/workspace-session-model";

const harness = vi.hoisted(() => ({
  workspace: { current: null as unknown },
  useTimeline: vi.fn<(...args: unknown[]) => unknown>(() => ({
      state: {
        status: "loading",
        events: [],
        nextCursor: null,
        message: "Loading the minimized synthetic audit timeline…",
      },
      refresh: vi.fn(),
      loadMore: vi.fn(),
    })),
}));

vi.mock("@/components/auth/workspace-session", () => ({
  useWorkspaceSession: () => harness.workspace.current,
}));

vi.mock("@/components/compliance/use-compliance-audit-timeline", () => ({
  useComplianceAuditTimeline: (...args: unknown[]) =>
    harness.useTimeline(...args),
}));

function session(
  role: WorkspaceRole,
  overrides: Partial<VerifiedWorkspaceSession> = {},
): VerifiedWorkspaceSession {
  return {
    workspaceId: "workspace_safenet_demo",
    workspaceName: "SafeNet synthetic demo",
    workspaceMode: "demo",
    dataClassification: "synthetic_only",
    uid: `user_demo_${role}`,
    displayLabel: `Synthetic ${role}`,
    role,
    scopeMode: role === "tenant_admin" ? "workspace_wide" : "assigned",
    teamIds: ["team_demo_general"],
    locationIds: ["location_demo_wattala"],
    ...overrides,
  };
}

function verified(
  role: WorkspaceRole,
  overrides: Partial<VerifiedWorkspaceSession> = {},
): WorkspaceSessionSnapshot {
  return {
    status: "verified",
    session: session(role, overrides),
    message: null,
  };
}

function event(): ComplianceAuditEvent {
  return {
    id: "audit_synthetic_001",
    workspaceId: "workspace_safenet_demo",
    occurredAt: "2026-08-08T07:00:00.000Z",
    actor: {
      type: "user",
      id: "event_actor:audit_synthetic_001",
    },
    action: "care_enrollment.resolve_escalation",
    resource: {
      type: "care_enrollment",
      id: "event_resource:audit_synthetic_001",
    },
    outcome: "allowed",
    safeSummaryCode: "care_escalation_resolved",
    synthetic: true,
    schemaVersion: 1,
  };
}

describe("Compliance role-bound rendering", () => {
  beforeEach(() => {
    harness.workspace.current = verified("tenant_admin");
    harness.useTimeline.mockClear();
    harness.useTimeline.mockReturnValue({
      state: {
        status: "loading",
        events: [],
        nextCursor: null,
        message: "Loading the minimized synthetic audit timeline…",
      },
      refresh: vi.fn(),
      loadMore: vi.fn(),
    });
  });

  it.each([
    ["tenant_admin", "workspace_wide"],
    ["privacy_reviewer", "assigned"],
  ] as const)(
    "mounts the callable-backed timeline for %s with %s scope",
    (role, scopeMode) => {
      harness.workspace.current = verified(role, { scopeMode });
      const markup = renderToStaticMarkup(createElement(ComplianceCentre));

      expect(markup).toContain('data-compliance-timeline="allowed"');
      expect(markup).toContain('data-compliance-load-state="loading"');
      expect(markup).toContain("All outcomes");
      expect(harness.useTimeline).toHaveBeenCalledOnce();
      expect(harness.useTimeline).toHaveBeenCalledWith(
        expect.objectContaining({ role, scopeMode }),
        null,
      );
    },
  );

  it.each([
    ["tenant_admin", "assigned"],
    ["supervisor", "assigned"],
    ["campaign_approver", "assigned"],
    ["clinical_approver", "assigned"],
  ] as const)(
    "renders the register but makes zero timeline reads for %s with %s scope",
    (role, scopeMode) => {
      harness.workspace.current = verified(role, { scopeMode });
      const markup = renderToStaticMarkup(createElement(ComplianceCentre));

      expect(markup).toContain("Control register");
      expect(markup).toContain('data-compliance-timeline="restricted"');
      expect(markup).toContain("Timeline restricted");
      expect(markup).toContain("No timeline request was sent");
      expect(markup).not.toContain("All outcomes");
      expect(harness.useTimeline).not.toHaveBeenCalled();
    },
  );

  it.each([
    "platform_owner",
    "agent",
    "campaign_operator",
    "analyst",
  ] as const)("renders no Compliance subtree for %s", (role) => {
    harness.workspace.current = verified(role);
    expect(renderToStaticMarkup(createElement(ComplianceCentre))).toBe("");
    expect(harness.useTimeline).not.toHaveBeenCalled();
  });

  it("renders nothing before verified workspace authority exists", () => {
    harness.workspace.current = {
      status: "checking",
      session: null,
      message: null,
    } satisfies WorkspaceSessionSnapshot;
    expect(renderToStaticMarkup(createElement(ComplianceCentre))).toBe("");
    expect(harness.useTimeline).not.toHaveBeenCalled();
  });

  it("synchronously removes an authorized timeline on an assigned-admin downgrade", () => {
    const allowed = renderToStaticMarkup(createElement(ComplianceCentre));
    expect(allowed).toContain('data-compliance-timeline="allowed"');
    expect(harness.useTimeline).toHaveBeenCalledOnce();

    harness.workspace.current = verified("tenant_admin", {
      scopeMode: "assigned",
    });
    const restricted = renderToStaticMarkup(createElement(ComplianceCentre));
    expect(restricted).toContain('data-compliance-timeline="restricted"');
    expect(restricted).not.toContain('data-compliance-load-state="loading"');
    expect(harness.useTimeline).toHaveBeenCalledOnce();
  });
});

describe("Compliance timeline states and minimized rendering", () => {
  beforeEach(() => {
    harness.workspace.current = verified("privacy_reviewer");
    harness.useTimeline.mockClear();
  });

  it("renders only projected aliases and controlled evidence", () => {
    harness.useTimeline.mockReturnValue({
      state: {
        status: "ready",
        events: [event()],
        nextCursor: null,
        message: null,
      },
      refresh: vi.fn(),
      loadMore: vi.fn(),
    });
    const markup = renderToStaticMarkup(createElement(ComplianceCentre));

    expect(markup).toContain("event_actor:audit_synthetic_001");
    expect(markup).toContain("event_resource:audit_synthetic_001");
    expect(markup).toContain("care_enrollment.resolve_escalation");
    expect(markup).toContain("Care escalation resolved");
    for (const forbidden of [
      "actorUid",
      "resourceId",
      "requestId",
      "resultFingerprint",
      "checkpointId",
      "teamId",
      "locationId",
      "patientName",
      "clinicalInstruction",
    ]) {
      expect(markup).not.toContain(forbidden);
    }
  });

  it.each([
    ["empty", "No projected events"],
    ["denied", "Minimized timeline unavailable"],
    ["invalid_response", "Minimized timeline unavailable"],
    ["error", "Minimized timeline unavailable"],
  ] as const)("renders the %s state without fixture fallback", (status, text) => {
    harness.useTimeline.mockReturnValue({
      state: {
        status,
        events: [],
        nextCursor: null,
        message: "Sanitized state message.",
      },
      refresh: vi.fn(),
      loadMore: vi.fn(),
    });
    const markup = renderToStaticMarkup(createElement(ComplianceCentre));
    expect(markup).toContain(text);
    expect(markup).toContain("Sanitized state message");
    expect(markup).not.toContain("AUD-0008");
  });

  it.each([
    ["loading_more", "Loading the next minimized audit page…"],
    ["pagination_error", "Retry next page"],
  ] as const)("retains only verified rows in the %s state", (status, text) => {
    harness.useTimeline.mockReturnValue({
      state: {
        status,
        events: [event()],
        nextCursor: {
          createdAt: "2026-08-08T07:00:00.000Z",
          id: "audit_synthetic_001",
        },
        message:
          status === "loading_more"
            ? "Loading the next minimized audit page…"
            : "The next page is unconfirmed.",
      },
      refresh: vi.fn(),
      loadMore: vi.fn(),
    });
    const markup = renderToStaticMarkup(createElement(ComplianceCentre));
    expect(markup).toContain("event_actor:audit_synthetic_001");
    expect(markup).toContain(text);
  });

  it("offers bounded pagination only when the verified response has a cursor", () => {
    harness.useTimeline.mockReturnValue({
      state: {
        status: "ready",
        events: [event()],
        nextCursor: {
          createdAt: "2026-08-08T07:00:00.000Z",
          id: "audit_synthetic_001",
        },
        message: null,
      },
      refresh: vi.fn(),
      loadMore: vi.fn(),
    });
    expect(renderToStaticMarkup(createElement(ComplianceCentre))).toContain(
      "Load more",
    );
  });
});

describe("Compliance source boundary", () => {
  it("contains no raw Firestore query, static audit fixture, or fabricated metric", () => {
    const sources = [
      "components/compliance/compliance-centre.tsx",
      "components/compliance/compliance-data.ts",
      "components/compliance/compliance-audit-timeline.tsx",
      "components/compliance/use-compliance-audit-timeline.ts",
      "lib/firebase/compliance-audit-functions-emulator.ts",
      "app/(portal)/_data/module-configs.ts",
    ].map((path) => readFileSync(path, "utf8"));
    const complianceSources = sources.slice(0, 5).join("\n");
    const allSources = sources.join("\n");

    expect(complianceSources).not.toContain('from "firebase/firestore"');
    expect(complianceSources).not.toMatch(/collection\s*\([^)]*auditEvents/u);
    expect(complianceSources).not.toContain("AUD-0008");
    expect(complianceSources).not.toContain("safety_hold");
    expect(allSources).not.toContain("1,842");
    expect(allSources).not.toContain("Append-only sample audit view");
    expect(allSources).not.toContain("immutable audit trails");
    expect(complianceSources).toContain("listComplianceAuditEvents");
  });
});
