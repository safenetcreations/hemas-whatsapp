import type { Firestore } from "firebase/firestore";
import { describe, expect, it, vi } from "vitest";
import {
  describeLaboratoryWorkspaceError,
  LaboratoryWorkspaceDataError,
  loadLaboratoryWorkspace,
  type LaboratoryWorkspaceReads,
} from "@/components/journeys/laboratory-workspace-data";
import type {
  LabReportDTO,
  LabReportEventDTO,
  LocationDTO,
  TeamDTO,
} from "@/lib/firebase/repositories";

const db = {} as Firestore;
const workspaceId = "workspace_safenet_demo";
const teamId = "team_demo_laboratory";
const locationId = "location_demo_lab_network";
const now = "2026-08-07T05:00:00.000Z";
const expiry = "2026-08-08T12:30:00.000Z";

function team(overrides: Partial<TeamDTO> = {}): TeamDTO {
  return {
    id: teamId,
    workspaceId,
    name: "Synthetic Laboratory Team",
    queueType: "laboratory",
    locationIds: [locationId],
    businessHoursLabel: "Synthetic hours",
    firstResponseSlaMinutes: 15,
    active: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function location(overrides: Partial<LocationDTO> = {}): LocationDTO {
  return {
    id: locationId,
    workspaceId,
    name: "Synthetic Nationwide Lab Network",
    kind: "laboratory",
    city: "Synthetic Sri Lanka",
    supportedServiceRefs: ["demo-laboratory"],
    active: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function report(overrides: Partial<LabReportDTO> = {}): LabReportDTO {
  return {
    id: "lab_report_internal_001",
    workspaceId,
    conversationId: "conversation_internal_001",
    contactId: "patient_identifier_must_not_escape",
    teamId,
    locationId,
    workflowStatus: "ready",
    collectedAt: "2026-08-06T03:30:00.000Z",
    readyAt: "2026-08-07T03:30:00.000Z",
    secureAccess: {
      mode: "simulator_handoff",
      available: true,
      expiresAt: expiry,
    },
    lastNotificationAt: null,
    authoritativeSystem: "simulator",
    revision: 0,
    synthetic: true,
    schemaVersion: 1,
    createdAt: "2026-08-06T03:30:00.000Z",
    updatedAt: "2026-08-07T03:30:00.000Z",
    ...overrides,
  };
}

function immutableEvent(overrides: Partial<LabReportEventDTO> = {}): LabReportEventDTO {
  return {
    id: "lab_event_internal_001",
    workspaceId,
    labReportId: "lab_report_internal_001",
    conversationId: "conversation_internal_001",
    contactId: "patient_identifier_must_not_escape",
    teamId,
    locationId,
    eventType: "simulator_report_ready",
    fromStatus: "processing",
    toStatus: "ready",
    source: "simulator_seed",
    synthetic: true,
    schemaVersion: 1,
    occurredAt: "2026-08-07T03:30:00.000Z",
    createdAt: "2026-08-07T03:30:00.000Z",
    ...overrides,
  };
}

function reads(input: {
  readonly teams?: readonly TeamDTO[];
  readonly locations?: readonly LocationDTO[];
  readonly reports?: readonly LabReportDTO[];
  readonly events?: readonly LabReportEventDTO[];
} = {}): LaboratoryWorkspaceReads {
  return {
    listTeams: vi.fn().mockResolvedValue(input.teams ?? [team()]),
    listLocations: vi.fn().mockResolvedValue(input.locations ?? [location()]),
    listReports: vi.fn().mockResolvedValue(input.reports ?? [report()]),
    listEvents: vi.fn().mockResolvedValue(input.events ?? [immutableEvent()]),
  };
}

describe("laboratory workspace data boundary", () => {
  it("loads a bounded tenant-admin view and strips identifiers, fingerprints and protected access details", async () => {
    const repositoryReads = reads();
    const result = await loadLaboratoryWorkspace(
      db,
      {
        workspaceId,
        role: "tenant_admin",
        scopeMode: "workspace_wide",
        teamIds: [],
        locationIds: [],
      },
      repositoryReads,
      Date.parse(now),
    );

    expect(repositoryReads.listReports).toHaveBeenCalledWith(db, {
      workspaceId,
      pageSize: 50,
    });
    expect(repositoryReads.listEvents).toHaveBeenCalledWith(db, {
      workspaceId,
      subjectId: "lab_report_internal_001",
      teamId,
      locationId,
      pageSize: 25,
    });
    expect(result.scopePlan).toEqual({ kind: "workspace_wide", pairs: [] });
    expect(result.records).toEqual([
      expect.objectContaining({
        workflowStatus: "ready",
        teamName: "Synthetic Laboratory Team",
        locationName: "Synthetic Nationwide Lab Network",
        handoff: { state: "available", expiresAt: expiry },
        events: [
          expect.objectContaining({
            eventType: "simulator_report_ready",
            fromStatus: "processing",
            toStatus: "ready",
          }),
        ],
      }),
    ]);

    const serialized = JSON.stringify(result.records);
    for (const forbidden of [
      "patient_identifier_must_not_escape",
      "EXTERNAL-REPORT-IDENTIFIER-MUST-NOT-ESCAPE",
      "notificationIdempotencyFingerprint",
      "idempotencyFingerprint",
      "handoffRef",
      "accessToken",
      "reportBody",
      "resultValues",
      "diagnosis",
      "interpretation",
      "attachment",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("queries only an operational member's exact active team-location pairs", async () => {
    const secondTeamId = "team_demo_general";
    const secondLocationId = "location_demo_wattala";
    const repositoryReads = reads({
      teams: [
        team(),
        team({
          id: secondTeamId,
          name: "Synthetic General Team",
          queueType: "general",
          locationIds: [secondLocationId],
        }),
      ],
      locations: [
        location(),
        location({
          id: secondLocationId,
          name: "Synthetic Wattala",
          kind: "hospital",
        }),
      ],
      reports: [],
      events: [],
    });

    const result = await loadLaboratoryWorkspace(
      db,
      {
        workspaceId,
        role: "agent",
        scopeMode: "assigned",
        teamIds: [teamId, secondTeamId],
        locationIds: [locationId, secondLocationId],
      },
      repositoryReads,
      Date.parse(now),
    );

    expect(result.scopePlan).toEqual({
      kind: "scoped",
      pairs: [
        { teamId, locationId },
        { teamId: secondTeamId, locationId: secondLocationId },
      ],
    });
    expect(repositoryReads.listReports).toHaveBeenCalledTimes(2);
    expect(repositoryReads.listReports).toHaveBeenNthCalledWith(1, db, {
      workspaceId,
      teamId,
      locationId,
      pageSize: 25,
    });
    expect(repositoryReads.listReports).toHaveBeenNthCalledWith(2, db, {
      workspaceId,
      teamId: secondTeamId,
      locationId: secondLocationId,
      pageSize: 25,
    });
    expect(repositoryReads.listEvents).not.toHaveBeenCalled();
  });

  it("replans a live tenant-admin downgrade from workspace-wide to exact assigned reads", async () => {
    const broadReads = reads({ reports: [], events: [] });
    const broad = await loadLaboratoryWorkspace(
      db,
      {
        workspaceId,
        role: "tenant_admin",
        scopeMode: "workspace_wide",
        teamIds: [],
        locationIds: [],
      },
      broadReads,
      Date.parse(now),
    );
    expect(broad.scopePlan).toEqual({ kind: "workspace_wide", pairs: [] });
    expect(broadReads.listReports).toHaveBeenCalledWith(db, {
      workspaceId,
      pageSize: 50,
    });

    const assignedReads = reads({ reports: [], events: [] });
    const assigned = await loadLaboratoryWorkspace(
      db,
      {
        workspaceId,
        role: "tenant_admin",
        scopeMode: "assigned",
        teamIds: [teamId],
        locationIds: [locationId],
      },
      assignedReads,
      Date.parse(now),
    );
    expect(assigned.scopePlan).toEqual({
      kind: "scoped",
      pairs: [{ teamId, locationId }],
    });
    expect(assignedReads.listReports).toHaveBeenCalledWith(db, {
      workspaceId,
      teamId,
      locationId,
      pageSize: 50,
    });
    expect(assignedReads.listReports).not.toHaveBeenCalledWith(db, {
      workspaceId,
      pageSize: 50,
    });
  });

  it("fails closed for roles without patient-operational scope before report queries", async () => {
    const repositoryReads = reads();
    const result = await loadLaboratoryWorkspace(
      db,
      {
        workspaceId,
        role: "campaign_operator",
        scopeMode: "assigned",
        teamIds: [teamId],
        locationIds: [locationId],
      },
      repositoryReads,
      Date.parse(now),
    );

    expect(result).toEqual({
      records: [],
      scopePlan: { kind: "denied", pairs: [], reason: "role_not_permitted" },
    });
    expect(repositoryReads.listReports).not.toHaveBeenCalled();
    expect(repositoryReads.listEvents).not.toHaveBeenCalled();
  });

  it("rejects inactive or inconsistent routing joins and mismatched immutable events", async () => {
    await expect(
      loadLaboratoryWorkspace(
        db,
        {
          workspaceId,
          role: "tenant_admin",
          scopeMode: "workspace_wide",
          teamIds: [],
          locationIds: [],
        },
        reads({ teams: [team({ locationIds: [] })] }),
        Date.parse(now),
      ),
    ).rejects.toMatchObject({ code: "invalid_join" });

    await expect(
      loadLaboratoryWorkspace(
        db,
        {
          workspaceId,
          role: "tenant_admin",
          scopeMode: "workspace_wide",
          teamIds: [],
          locationIds: [],
        },
        reads({ events: [immutableEvent({ contactId: "different_patient_identifier" })] }),
        Date.parse(now),
      ),
    ).rejects.toMatchObject({ code: "invalid_join" });
  });

  it("shows only a safe expired/not-available handoff indicator", async () => {
    const expired = await loadLaboratoryWorkspace(
      db,
      {
        workspaceId,
        role: "tenant_admin",
        scopeMode: "workspace_wide",
        teamIds: [],
        locationIds: [],
      },
      reads(),
      Date.parse("2026-08-09T00:00:00.000Z"),
    );
    expect(expired.records[0]?.handoff).toEqual({ state: "expired", expiresAt: expiry });

    const unavailable = await loadLaboratoryWorkspace(
      db,
      {
        workspaceId,
        role: "tenant_admin",
        scopeMode: "workspace_wide",
        teamIds: [],
        locationIds: [],
      },
      reads({
        reports: [
          report({
            secureAccess: {
              mode: "not_available",
              available: false,
              expiresAt: null,
            },
          }),
        ],
      }),
      Date.parse(now),
    );
    expect(unavailable.records[0]?.handoff).toEqual({
      state: "not_available",
      expiresAt: null,
    });
  });

  it("returns bounded safe error copy without reflecting repository details", () => {
    const invalid = new LaboratoryWorkspaceDataError(
      "internal subject patient-123 and secret token",
      "invalid_join",
    );
    const message = describeLaboratoryWorkspaceError(invalid);
    expect(message).toContain("failed tenant or team-location validation");
    expect(message).not.toContain("patient-123");
    expect(message).not.toContain("token");

    expect(
      describeLaboratoryWorkspaceError({ code: "permission-denied", detail: "secret" }),
    ).toContain("denied");
  });
});
