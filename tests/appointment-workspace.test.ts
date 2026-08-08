import { describe, expect, it, vi } from "vitest";
import {
  AppointmentWorkspaceDataError,
  assembleAppointmentWorkspaceRecords,
  buildAppointmentActionRequest,
  buildAppointmentScopePlan,
  loadAppointmentWorkspace,
  type AppointmentWorkspaceReads,
} from "@/components/journeys/appointment-workspace-data";
import type {
  AppointmentDTO,
  AppointmentEventDTO,
  LocationDTO,
  TeamDTO,
} from "@/lib/firebase/repositories";
import type { VerifiedWorkspaceSession } from "@/lib/firebase/workspace-session-model";

const workspaceId = "workspace_safenet_demo";

const team: TeamDTO = {
  id: "team_demo_general",
  workspaceId,
  name: "Demo patient services",
  queueType: "general",
  locationIds: ["location_demo_wattala"],
  businessHoursLabel: "Synthetic hours",
  firstResponseSlaMinutes: 15,
  active: true,
  createdAt: "2026-08-07T04:00:00.000Z",
  updatedAt: "2026-08-07T04:00:00.000Z",
};

const location: LocationDTO = {
  id: "location_demo_wattala",
  workspaceId,
  name: "Demo Hospital — Wattala",
  kind: "hospital",
  city: "Wattala",
  supportedServiceRefs: ["demo-general-medicine"],
  active: true,
  createdAt: "2026-08-07T04:00:00.000Z",
  updatedAt: "2026-08-07T04:00:00.000Z",
};

const appointment: AppointmentDTO = {
  id: "appointment_synthetic_001",
  workspaceId,
  conversationId: "conversation_synthetic_appointment",
  contactId: "contact_synthetic_appointment",
  teamId: team.id,
  locationId: location.id,
  externalAppointmentRef: "DEMO-APT-0001",
  serviceRef: "demo-general-medicine",
  practitionerDisplayLabel: "Synthetic clinician schedule",
  slotStartsAt: "2026-08-12T04:30:00.000Z",
  slotEndsAt: "2026-08-12T05:00:00.000Z",
  slotTimeZone: "Asia/Colombo",
  status: "confirmed",
  syncState: "mock",
  reminderState: {
    confirmation: "simulated",
    twentyFourHour: "scheduled",
    twoHour: "scheduled",
  },
  authoritativeSystem: "simulator",
  lastSyncedAt: "2026-08-07T04:00:00.000Z",
  revision: 0,
  lastActionId: null,
  synthetic: true,
  schemaVersion: 1,
  createdAt: "2026-08-07T04:00:00.000Z",
  updatedAt: "2026-08-07T04:00:00.000Z",
};

const seededEvent: AppointmentEventDTO = {
  id: "appointment_synthetic_seeded",
  workspaceId,
  appointmentId: appointment.id,
  conversationId: appointment.conversationId,
  contactId: appointment.contactId,
  teamId: appointment.teamId,
  locationId: appointment.locationId,
  actionId: "appointment_synthetic_seeded",
  actorUid: "simulator_seed",
  action: "simulator_snapshot_seeded",
  fromStatus: null,
  toStatus: "confirmed",
  revision: 0,
  source: "simulator_seed",
  synthetic: true,
  schemaVersion: 1,
  createdAt: "2026-08-07T04:00:00.000Z",
};

function session(
  overrides: Partial<VerifiedWorkspaceSession> = {},
): VerifiedWorkspaceSession {
  const role = overrides.role ?? "agent";
  return {
    workspaceId,
    workspaceName: "SafeNet local demo",
    workspaceMode: "demo",
    dataClassification: "synthetic_only",
    uid: "synthetic-agent-001",
    displayLabel: "Synthetic agent",
    role,
    scopeMode: overrides.scopeMode ?? (role === "tenant_admin" ? "workspace_wide" : "assigned"),
    teamIds: [team.id],
    locationIds: [location.id],
    ...overrides,
  };
}

describe("authenticated appointment workspace boundary", () => {
  it("permits only bounded tenant-admin or exact supervisor/agent scope plans", () => {
    expect(
      buildAppointmentScopePlan(
        { workspaceId, role: "tenant_admin", scopeMode: "workspace_wide", teamIds: [], locationIds: [] },
        [team],
        [location],
      ),
    ).toEqual({ kind: "workspace_wide", pairs: [] });

    for (const role of ["supervisor", "agent"] as const) {
      expect(
        buildAppointmentScopePlan(
          { workspaceId, role, scopeMode: "assigned", teamIds: [team.id], locationIds: [location.id] },
          [team],
          [location],
        ),
      ).toEqual({
        kind: "scoped",
        pairs: [{ teamId: team.id, locationId: location.id }],
      });
    }

    expect(
      buildAppointmentScopePlan(
        {
          workspaceId,
          role: "clinical_approver",
          scopeMode: "assigned",
          teamIds: [team.id],
          locationIds: [location.id],
        },
        [team],
        [location],
      ),
    ).toEqual({ kind: "denied", pairs: [], reason: "role_not_permitted" });
    expect(
      buildAppointmentScopePlan(
        {
          workspaceId,
          role: "agent",
          scopeMode: "assigned",
          teamIds: [team.id],
          locationIds: [location.id],
        },
        [{ ...team, active: false }],
        [location],
      ),
    ).toEqual({ kind: "denied", pairs: [], reason: "scope_invalid" });
  });

  it("assembles only appointments and immutable events with matching tenant routes", () => {
    const records = assembleAppointmentWorkspaceRecords({
      workspaceId,
      appointments: [appointment, appointment],
      eventsByAppointmentId: new Map([[appointment.id, [seededEvent]]]),
      teams: [team],
      locations: [location],
      scopePlan: {
        kind: "scoped",
        pairs: [{ teamId: team.id, locationId: location.id }],
      },
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      teamName: team.name,
      locationName: location.name,
      appointment: { id: appointment.id },
      events: [{ id: seededEvent.id }],
    });

    expect(() =>
      assembleAppointmentWorkspaceRecords({
        workspaceId,
        appointments: [appointment],
        eventsByAppointmentId: new Map([
          [appointment.id, [{ ...seededEvent, contactId: "contact_cross_scope" }]],
        ]),
        teams: [team],
        locations: [location],
        scopePlan: { kind: "workspace_wide", pairs: [] },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AppointmentWorkspaceDataError>>({
        code: "invalid_join",
      }),
    );
  });

  it("requires the current immutable action evidence for pending revisions", () => {
    const actionId = `${appointment.id}:request_reschedule:portal_r0`;
    const actionEvent: AppointmentEventDTO = {
      ...seededEvent,
      id: actionId,
      actionId,
      actorUid: "synthetic-agent-001",
      action: "request_reschedule",
      fromStatus: "confirmed",
      toStatus: "reschedule_pending",
      revision: 1,
      source: "authenticated_client",
      createdAt: "2026-08-07T05:00:00.000Z",
    };
    const pending = {
      ...appointment,
      status: "reschedule_pending" as const,
      syncState: "pending" as const,
      revision: 1,
      lastActionId: actionId,
    };
    const valid = assembleAppointmentWorkspaceRecords({
      workspaceId,
      appointments: [pending],
      eventsByAppointmentId: new Map([[appointment.id, [seededEvent, actionEvent]]]),
      teams: [team],
      locations: [location],
      scopePlan: { kind: "workspace_wide", pairs: [] },
    });
    expect(valid[0]?.events[0]?.id).toBe(actionId);

    expect(() =>
      assembleAppointmentWorkspaceRecords({
        workspaceId,
        appointments: [pending],
        eventsByAppointmentId: new Map([[appointment.id, [seededEvent]]]),
        teams: [team],
        locations: [location],
        scopePlan: { kind: "workspace_wide", pairs: [] },
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_join" }));
  });

  it("builds a deterministic callable request from verified scope and expected revision", async () => {
    const first = await buildAppointmentActionRequest({
      session: session(),
      appointment,
      action: "request_reschedule",
    });
    expect(first).toEqual({
      workspaceId,
      appointmentId: appointment.id,
      teamId: appointment.teamId,
      locationId: appointment.locationId,
      action: "request_reschedule",
      expectedRevision: 0,
      idempotencyKey: expect.stringMatching(/^appointment-ui-[a-f0-9]{48}$/),
    });
    expect(
      await buildAppointmentActionRequest({
        session: session(),
        appointment,
        action: "request_reschedule",
      }),
    ).toEqual(first);
    expect(
      (
        await buildAppointmentActionRequest({
          session: session(),
          appointment,
          action: "request_cancellation",
        })
      ).idempotencyKey,
    ).not.toBe(first.idempotencyKey);

    for (const invalid of [
      { session: session({ role: "clinical_approver" }), appointment },
      { session: session(), appointment: { ...appointment, status: "cancel_pending" as const } },
      { session: session({ locationIds: ["location_other"] }), appointment },
    ]) {
      await expect(
        buildAppointmentActionRequest({ ...invalid, action: "request_cancellation" }),
      ).rejects.toMatchObject({ code: "action_denied" });
    }
  });

  it("issues exact paired reads before joining persisted appointment evidence", async () => {
    const listAppointments = vi.fn(async () => [appointment]);
    const listEvents = vi.fn(async () => [seededEvent]);
    const reads: AppointmentWorkspaceReads = {
      listTeams: vi.fn(async () => [team]),
      listLocations: vi.fn(async () => [location]),
      listAppointments,
      listEvents,
    };

    const result = await loadAppointmentWorkspace(
      {} as never,
      {
        workspaceId,
        role: "supervisor",
        scopeMode: "assigned",
        teamIds: [team.id],
        locationIds: [location.id],
      },
      reads,
    );
    expect(result.records).toHaveLength(1);
    expect(listAppointments).toHaveBeenCalledWith(
      expect.anything(),
      { workspaceId, teamId: team.id, locationId: location.id, pageSize: 100 },
    );
    expect(listEvents).toHaveBeenCalledWith(
      expect.anything(),
      {
        workspaceId,
        subjectId: appointment.id,
        teamId: team.id,
        locationId: location.id,
        pageSize: 100,
      },
    );
  });
});
