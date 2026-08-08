import { describe, expect, it } from "vitest";
import {
  assertSafeAuditMetadata,
  authorizeWorkspaceAction,
  evaluateCampaignLaunch,
  evaluateComposerPolicy,
  hasPermission,
  isoDateTime,
} from "@/lib/domain";
import {
  DEMO_IDS,
  demoAudienceSnapshot,
  demoCampaign,
  demoConnections,
  demoConversations,
  demoLabReports,
  demoMemberships,
  demoTemplateVersions,
  demoWorkspaces,
  generateSyntheticAudienceChunk,
  summarizeSyntheticAudience,
  syntheticAudienceMember,
} from "@/lib/demo";

describe("deterministic 50K synthetic audience", () => {
  it("always produces the approved bounded summary", () => {
    const summary = summarizeSyntheticAudience();

    expect(summary).toMatchObject({
      totalEvaluated: 50_000,
      eligibleCount: 38_443,
      excludedCount: 11_557,
      unknownConsentCount: 3_588,
    });
    expect(
      Object.values(summary.languageCounts).reduce((sum, count) => sum + count, 0),
    ).toBe(50_000);
    expect(
      Object.values(summary.exclusionsByReason).reduce(
        (sum, count) => sum + (count ?? 0),
        0,
      ),
    ).toBe(summary.excludedCount);
  });

  it("is stable and chunked without generating identity data", () => {
    expect(syntheticAudienceMember(0)).toEqual(syntheticAudienceMember(0));
    const chunk = generateSyntheticAudienceChunk({ offset: 49_990, limit: 100 });

    expect(chunk).toHaveLength(10);
    expect(chunk.every((record) => record.contactId.startsWith("contact_synthetic_"))).toBe(true);
    expect(JSON.stringify(chunk)).not.toMatch(/(?:\+94|@|patientName|phoneNumber)/i);
  });
});

describe("campaign launch gates", () => {
  const template = demoTemplateVersions.find(
    (version) => version.id === DEMO_IDS.templateVersions.campaign,
  );

  it("allows the internally approved simulation", () => {
    expect(template).toBeDefined();
    const decision = evaluateCampaignLaunch({
      campaign: demoCampaign,
      audience: demoAudienceSnapshot,
      templateVersion: template!,
      workspace: demoWorkspaces[0]!,
    });

    expect(decision).toEqual({ allowed: true, blockers: [] });
  });

  it("fails closed when the same campaign is switched to external mode", () => {
    expect(template).toBeDefined();
    const decision = evaluateCampaignLaunch({
      campaign: {
        ...demoCampaign,
        dispatchMode: "external",
        allowlistTestStatus: "passed_external",
      },
      audience: demoAudienceSnapshot,
      templateVersion: template!,
      workspace: demoWorkspaces[0]!,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.blockers).toEqual(
      expect.arrayContaining([
        "template_not_eligible",
        "external_messaging_disabled",
        "capacity_unverified",
      ]),
    );
    expect(demoConnections[0]!.externalMessagingEnabled).toBe(false);
  });
});

describe("tenant and patient-scope authorization", () => {
  it("grants the frozen AI governance permissions only to approved roles", () => {
    for (const role of [
      "tenant_admin",
      "supervisor",
      "privacy_reviewer",
      "clinical_approver",
    ] as const) {
      expect(hasPermission(role, "ai_governance.view")).toBe(true);
    }

    for (const role of ["tenant_admin", "supervisor", "clinical_approver"] as const) {
      expect(hasPermission(role, "ai_governance.record_retrospective")).toBe(true);
    }

    for (const role of [
      "platform_owner",
      "agent",
      "campaign_operator",
      "campaign_approver",
      "analyst",
    ] as const) {
      expect(hasPermission(role, "ai_governance.view")).toBe(false);
      expect(hasPermission(role, "ai_governance.record_retrospective")).toBe(false);
    }
    expect(hasPermission("privacy_reviewer", "ai_governance.record_retrospective")).toBe(false);
  });

  it("requires MFA and an unweakenable fifteen-minute step-up for retrospective recording", () => {
    const admin = demoMemberships.find((membership) => membership.role === "tenant_admin")!;
    const resource = {
      workspaceId: admin.workspaceId,
      sensitivity: "workspace" as const,
    };

    expect(
      authorizeWorkspaceAction({
        membership: { ...admin, mfaSatisfied: false },
        permission: "ai_governance.record_retrospective",
        resource,
        now: isoDateTime("2026-08-07T12:30:00.000Z"),
        requireMfa: false,
      }),
    ).toEqual({ allowed: false, reason: "mfa_required" });

    expect(
      authorizeWorkspaceAction({
        membership: {
          ...admin,
          mfaSatisfied: true,
          lastAuthenticatedAt: isoDateTime("2026-08-07T12:14:59.999Z"),
        },
        permission: "ai_governance.record_retrospective",
        resource,
        now: isoDateTime("2026-08-07T12:30:00.000Z"),
        recentAuthenticationWindowMinutes: 16,
      }),
    ).toEqual({ allowed: false, reason: "recent_auth_required" });

    expect(
      authorizeWorkspaceAction({
        membership: {
          ...admin,
          mfaSatisfied: true,
          lastAuthenticatedAt: isoDateTime("2026-08-07T12:15:00.000Z"),
        },
        permission: "ai_governance.record_retrospective",
        resource,
        now: isoDateTime("2026-08-07T12:30:00.000Z"),
      }),
    ).toEqual({ allowed: true });
  });

  it("allows only the tenant admin explicit workspace-wide patient access", () => {
    const admin = demoMemberships.find((membership) => membership.role === "tenant_admin")!;
    const decision = authorizeWorkspaceAction({
      membership: admin,
      permission: "contacts.view",
      resource: {
        workspaceId: admin.workspaceId,
        sensitivity: "patient",
        teamId: DEMO_IDS.teams.laboratory,
        locationId: DEMO_IDS.locations.labNetwork,
      },
      now: isoDateTime("2026-08-07T12:30:00.000Z"),
    });

    expect(decision).toEqual({ allowed: true });
  });

  it("denies an assigned agent outside their team and location", () => {
    const agent = demoMemberships.find((membership) => membership.role === "agent")!;
    const decision = authorizeWorkspaceAction({
      membership: agent,
      permission: "contacts.view",
      resource: {
        workspaceId: agent.workspaceId,
        sensitivity: "patient",
        teamId: DEMO_IDS.teams.laboratory,
        locationId: DEMO_IDS.locations.labNetwork,
      },
      now: isoDateTime("2026-08-07T12:30:00.000Z"),
    });

    expect(decision).toEqual({ allowed: false, reason: "team_out_of_scope" });
  });

  it("denies missing patient scope instead of treating it as unrestricted", () => {
    const agent = demoMemberships.find((membership) => membership.role === "agent")!;
    const decision = authorizeWorkspaceAction({
      membership: agent,
      permission: "contacts.view",
      resource: {
        workspaceId: agent.workspaceId,
        sensitivity: "patient",
      } as never,
      now: isoDateTime("2026-08-07T12:30:00.000Z"),
    });

    expect(decision).toEqual({
      allowed: false,
      reason: "invalid_scope_configuration",
    });
  });
});

describe("healthcare and logging boundaries", () => {
  it("keeps the Phase 5 care-control route separate from urgent safety hold", () => {
    const careControl = demoConversations.find(
      (conversation) => conversation.id === DEMO_IDS.conversations.phase5Care,
    );
    const urgentSafety = demoConversations.find(
      (conversation) => conversation.id === DEMO_IDS.conversations.urgent,
    );

    expect(careControl).toMatchObject({
      contactId: DEMO_IDS.contacts.urgent,
      teamId: DEMO_IDS.teams.clinicalEscalation,
      status: "active",
      mode: "automation",
      purpose: "care_pathway",
      synthetic: true,
    });
    expect(urgentSafety).toMatchObject({
      contactId: DEMO_IDS.contacts.urgent,
      teamId: DEMO_IDS.teams.clinicalEscalation,
      status: "escalated",
      mode: "safety_hold",
      purpose: "urgent_escalation",
      synthetic: true,
    });
  });

  it("blocks a conversation reply while external messaging is disabled", () => {
    const humanConversation = demoConversations.find(
      (conversation) => conversation.mode === "human_takeover",
    )!;
    const decision = evaluateComposerPolicy({
      conversation: humanConversation,
      at: isoDateTime("2026-08-07T12:30:00.000Z"),
      externalMessagingEnabled: false,
      hasApprovedTemplate: true,
    });

    expect(decision).toEqual({
      allowed: false,
      requiresTemplate: false,
      reason: "external_messaging_disabled",
    });
  });

  it("keeps lab fixtures to workflow metadata without report content", () => {
    const serialized = JSON.stringify(demoLabReports);

    expect(serialized).not.toMatch(/reportBody|resultValue|diagnosis|prescription/i);
    expect(demoLabReports.every((report) => report.synthetic)).toBe(true);
  });

  it("rejects sensitive values from audit metadata", () => {
    expect(() => assertSafeAuditMetadata({ messageBody: "do not log" })).toThrow(
      /must not contain sensitive key/i,
    );
    expect(() => assertSafeAuditMetadata({ queue: "appointments", count: 4 })).not.toThrow();
  });
});
