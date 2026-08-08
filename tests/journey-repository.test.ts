import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";
import * as journeyRepository from "@/lib/firebase/repositories/journey-repository";
import {
  JourneyRepositoryError,
  parseAppointmentDocument,
  parseLabReportDocument,
  parseLabReportEventDocument,
  prepareJourneyEventListInput,
  prepareScopedJourneyListInput,
} from "@/lib/firebase/repositories";

const workspaceId = "workspace_safenet_demo";
const appointmentId = "appointment_synthetic_001";
const labReportId = "lab_report_synthetic_001";
const startsAt = Timestamp.fromDate(new Date("2026-08-12T04:30:00.000Z"));
const endsAt = Timestamp.fromDate(new Date("2026-08-12T05:00:00.000Z"));

function appointmentDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: appointmentId,
    workspaceId,
    conversationId: "conversation_synthetic_appointment",
    contactId: "contact_synthetic_appointment",
    teamId: "team_demo_general",
    locationId: "location_demo_wattala",
    externalAppointmentRef: "DEMO-APT-0001",
    serviceRef: "demo-general-medicine",
    practitionerDisplayLabel: "Synthetic clinician schedule",
    slotStartsAt: startsAt,
    slotEndsAt: endsAt,
    slotTimeZone: "Asia/Colombo",
    status: "confirmed",
    syncState: "mock",
    reminderState: {
      confirmation: "simulated",
      twentyFourHour: "scheduled",
      twoHour: "scheduled",
    },
    authoritativeSystem: "simulator",
    lastSyncedAt: startsAt,
    revision: 0,
    lastActionId: null,
    synthetic: true,
    schemaVersion: 1,
    createdAt: startsAt,
    updatedAt: startsAt,
    ...overrides,
  };
}

function labReportDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: labReportId,
    workspaceId,
    conversationId: "conversation_synthetic_laboratory",
    contactId: "contact_synthetic_laboratory",
    teamId: "team_demo_laboratory",
    locationId: "location_demo_lab_network",
    workflowStatus: "ready",
    collectedAt: startsAt,
    readyAt: endsAt,
    secureAccess: {
      mode: "simulator_handoff",
      available: true,
      expiresAt: endsAt,
    },
    lastNotificationAt: null,
    authoritativeSystem: "simulator",
    revision: 0,
    synthetic: true,
    schemaVersion: 1,
    createdAt: startsAt,
    updatedAt: endsAt,
    ...overrides,
  };
}

function labReportEventDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: "lab_report_event_synthetic_001",
    workspaceId,
    labReportId,
    conversationId: "conversation_synthetic_laboratory",
    contactId: "contact_synthetic_laboratory",
    teamId: "team_demo_laboratory",
    locationId: "location_demo_lab_network",
    eventType: "simulator_report_ready",
    fromStatus: "processing",
    toStatus: "ready",
    source: "simulator_seed",
    synthetic: true,
    schemaVersion: 1,
    occurredAt: endsAt,
    createdAt: endsAt,
    ...overrides,
  };
}

describe("appointment and laboratory repository boundaries", () => {
  it("accepts only bounded workspace-wide or exact paired-scope reads", () => {
    expect(prepareScopedJourneyListInput({ workspaceId, pageSize: 100 })).toEqual({
      workspaceId,
      pageSize: 100,
    });
    expect(
      prepareScopedJourneyListInput({
        workspaceId,
        teamId: "team_demo_general",
        locationId: "location_demo_wattala",
        pageSize: 50,
      }),
    ).toMatchObject({ teamId: "team_demo_general", locationId: "location_demo_wattala" });

    for (const input of [
      { workspaceId, teamId: "team_demo_general" },
      { workspaceId, pageSize: 101 },
      { workspaceId, pageSize: 0 },
      { workspaceId, extra: "pollution" },
    ]) {
      expect(() => prepareScopedJourneyListInput(input as never)).toThrowError(
        expect.objectContaining<Partial<JourneyRepositoryError>>({ code: "invalid_input" }),
      );
    }
  });

  it("requires subject plus team/location for immutable event history queries", () => {
    const input = {
      workspaceId,
      subjectId: appointmentId,
      teamId: "team_demo_general",
      locationId: "location_demo_wattala",
      pageSize: 25,
    };
    expect(prepareJourneyEventListInput(input)).toEqual(input);
    expect(() =>
      prepareJourneyEventListInput({ ...input, locationId: undefined } as never),
    ).toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });

  it("parses strict appointment metadata and rejects invalid slots or schema pollution", () => {
    const parsed = parseAppointmentDocument(
      appointmentDocument(),
      appointmentId,
      workspaceId,
    );
    expect(parsed.status).toBe("confirmed");
    expect(parsed.slotTimeZone).toBe("Asia/Colombo");
    expect(parsed.slotStartsAt).toBe("2026-08-12T04:30:00.000Z");

    for (const value of [
      appointmentDocument({ slotEndsAt: startsAt }),
      appointmentDocument({ reportBody: "not allowed" }),
      appointmentDocument({ workspaceId: "workspace_other" }),
    ]) {
      expect(() => parseAppointmentDocument(value, appointmentId, workspaceId)).toThrowError(
        expect.objectContaining({ code: "invalid_persisted_data" }),
      );
    }
  });

  it("returns only staff-safe laboratory workflow metadata", () => {
    const parsed = parseLabReportDocument(labReportDocument(), labReportId, workspaceId);
    expect(parsed.workflowStatus).toBe("ready");
    expect(parsed.secureAccess).toEqual({
      mode: "simulator_handoff",
      available: true,
      expiresAt: "2026-08-12T05:00:00.000Z",
    });
    expect(parsed).not.toHaveProperty("externalReportRef");
    expect(parsed).not.toHaveProperty("notificationIdempotencyFingerprint");
    expect(parsed.secureAccess).not.toHaveProperty("handoffRef");
    expect(parsed).not.toHaveProperty("reportBody");
    expect(parsed).not.toHaveProperty("resultValues");
  });

  it("rejects protected laboratory fields, content, path substitution and parser pollution", () => {
    for (const value of [
      labReportDocument({ externalReportRef: "DEMO-LAB-0001" }),
      labReportDocument({ notificationIdempotencyFingerprint: "7".repeat(64) }),
      labReportDocument({ resultValues: [{ value: "not allowed" }] }),
      labReportDocument({ diagnosis: "not allowed" }),
      labReportDocument({ accessToken: "not allowed" }),
      labReportDocument({
        secureAccess: {
          mode: "simulator_handoff",
          available: true,
          handoffRef: "protected://must-not-reach-the-browser",
          expiresAt: endsAt,
        },
      }),
      labReportDocument({ workspaceId: "workspace_other" }),
      labReportDocument({ id: "lab_report_substituted" }),
    ]) {
      expect(() => parseLabReportDocument(value, labReportId, workspaceId)).toThrowError(
        expect.objectContaining({ code: "invalid_persisted_data" }),
      );
    }

    expect(() =>
      parseLabReportDocument(labReportDocument(), "lab_report_substituted", workspaceId),
    ).toThrowError(expect.objectContaining({ code: "invalid_persisted_data" }));
  });

  it("accepts staff-safe immutable lab events and rejects protected fingerprints", () => {
    const eventId = "lab_report_event_synthetic_001";
    const parsed = parseLabReportEventDocument(
      labReportEventDocument(),
      eventId,
      workspaceId,
    );
    expect(parsed.eventType).toBe("simulator_report_ready");
    expect(parsed).not.toHaveProperty("idempotencyFingerprint");

    for (const value of [
      labReportEventDocument({ idempotencyFingerprint: "7".repeat(64) }),
      labReportEventDocument({ reportBody: "not allowed" }),
      labReportEventDocument({ workspaceId: "workspace_other" }),
      labReportEventDocument({ id: "lab_event_substituted" }),
    ]) {
      expect(() => parseLabReportEventDocument(value, eventId, workspaceId)).toThrowError(
        expect.objectContaining({ code: "invalid_persisted_data" }),
      );
    }
  });

  it("exports appointment read contracts without a legacy browser mutation surface", () => {
    expect(journeyRepository).toHaveProperty("listScopedAppointments");
    expect(journeyRepository).toHaveProperty("listAppointmentEvents");
    expect(journeyRepository).toHaveProperty("parseAppointmentDocument");
    expect(journeyRepository).toHaveProperty("parseAppointmentEventDocument");
    expect(journeyRepository).not.toHaveProperty("requestSyntheticAppointmentAction");
    expect(journeyRepository).not.toHaveProperty("prepareSyntheticAppointmentAction");
    expect(journeyRepository).not.toHaveProperty("buildSyntheticAppointmentActionId");
  });
});
