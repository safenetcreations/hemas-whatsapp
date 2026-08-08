import { describe, expect, it } from "vitest";

import {
  complianceAuditAuthorityKey,
  complianceAuditTimelineAccess,
} from "@/components/compliance/compliance-audit-access";
import {
  appendComplianceAuditPage,
  complianceAuditFailureState,
  ComplianceAuditTimelineError,
  createComplianceAuditRequestGate,
} from "@/components/compliance/use-compliance-audit-timeline";
import {
  ComplianceAuditFunctionsClientError,
  type ComplianceAuditEvent,
} from "@/lib/firebase/compliance-audit-functions-emulator";
import type {
  VerifiedWorkspaceSession,
  WorkspaceRole,
} from "@/lib/firebase/workspace-session-model";

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

function projectedEvent(input: {
  readonly id: string;
  readonly occurredAt: string;
}): ComplianceAuditEvent {
  return {
    id: input.id,
    workspaceId: "workspace_safenet_demo",
    occurredAt: input.occurredAt,
    actor: { type: "user", id: `event_actor:${input.id}` },
    action: "campaign.pause",
    resource: { type: "campaign", id: `event_resource:${input.id}` },
    outcome: "allowed",
    safeSummaryCode: "campaign_paused",
    synthetic: true,
    schemaVersion: 1,
  };
}

describe("Compliance timeline authority", () => {
  it.each([
    ["tenant_admin", "workspace_wide", "allowed"],
    ["tenant_admin", "assigned", "restricted"],
    ["privacy_reviewer", "assigned", "allowed"],
    ["privacy_reviewer", "workspace_wide", "restricted"],
    ["supervisor", "assigned", "restricted"],
    ["campaign_approver", "assigned", "restricted"],
    ["clinical_approver", "assigned", "restricted"],
    ["platform_owner", "assigned", "denied"],
    ["agent", "assigned", "denied"],
    ["campaign_operator", "assigned", "denied"],
    ["analyst", "assigned", "denied"],
  ] as const)(
    "%s with %s scope receives %s timeline access",
    (role, scopeMode, expected) => {
      expect(
        complianceAuditTimelineAccess(session(role, { scopeMode })),
      ).toBe(expected);
    },
  );

  it("changes the remount key for every authority-bearing dimension", () => {
    const baseline = session("tenant_admin");
    const variants: VerifiedWorkspaceSession[] = [
      { ...baseline, workspaceId: "workspace_other" },
      { ...baseline, uid: "user_other" },
      { ...baseline, role: "supervisor", scopeMode: "assigned" },
      { ...baseline, scopeMode: "assigned" },
      { ...baseline, workspaceMode: "local" },
      { ...baseline, dataClassification: "approved_uat" as never },
      { ...baseline, teamIds: ["team_other"] },
      { ...baseline, locationIds: ["location_other"] },
    ];
    for (const variant of variants) {
      expect(complianceAuditAuthorityKey(variant)).not.toBe(
        complianceAuditAuthorityKey(baseline),
      );
    }
    expect(complianceAuditAuthorityKey(baseline)).toBe(
      complianceAuditAuthorityKey({
        ...baseline,
        workspaceName: "Display-only rename",
        displayLabel: "Display-only actor rename",
      }),
    );
  });
});

describe("Compliance pagination and request races", () => {
  it("invalidates every earlier request generation", () => {
    const gate = createComplianceAuditRequestGate();
    const first = gate.begin();
    const second = gate.begin();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
    gate.invalidate();
    expect(gate.isCurrent(second)).toBe(false);
  });

  it("appends a strictly older page", () => {
    const first = projectedEvent({
      id: "audit_003",
      occurredAt: "2026-08-08T07:03:00.000Z",
    });
    const second = projectedEvent({
      id: "audit_002",
      occurredAt: "2026-08-08T07:02:00.000Z",
    });
    expect(
      appendComplianceAuditPage(
        [first],
        { events: [second], nextCursor: null },
      ),
    ).toEqual([first, second]);
  });

  it.each([
    [
      projectedEvent({
        id: "audit_003",
        occurredAt: "2026-08-08T07:03:00.000Z",
      }),
      projectedEvent({
        id: "audit_003",
        occurredAt: "2026-08-08T07:01:00.000Z",
      }),
    ],
    [
      projectedEvent({
        id: "audit_002",
        occurredAt: "2026-08-08T07:02:00.000Z",
      }),
      projectedEvent({
        id: "audit_003",
        occurredAt: "2026-08-08T07:03:00.000Z",
      }),
    ],
  ])("rejects a duplicate or non-progressing next page", (prior, next) => {
    expect(() =>
      appendComplianceAuditPage(
        [prior],
        { events: [next], nextCursor: null },
      ),
    ).toThrowError(ComplianceAuditTimelineError);
  });
});

describe("Compliance timeline failure states", () => {
  it.each([
    ["authentication_required", "denied"],
    ["identity_mismatch", "denied"],
    ["permission_denied", "denied"],
    ["invalid_request", "invalid_response"],
    ["invalid_response", "invalid_response"],
    ["unsafe_endpoint", "error"],
    ["service_unavailable", "error"],
    ["emulator_unavailable", "error"],
    ["invocation_failed", "error"],
  ] as const)("maps %s to a fail-closed %s state", (code, status) => {
    const state = complianceAuditFailureState(
      new ComplianceAuditFunctionsClientError("private raw message", code),
    );
    expect(state.status).toBe(status);
    expect(state.events).toEqual([]);
    expect(state.nextCursor).toBeNull();
    expect(state.message).not.toContain("private raw message");
  });
});
