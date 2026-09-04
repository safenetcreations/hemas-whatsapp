import { describe, expect, it } from "vitest";
import {
  assembleInboxRecords,
  assembleInboxRecordsWithExclusions,
  buildInboxScopePlan,
  describeInboxWorkspaceError,
  filterInboxRecords,
  InboxWorkspaceDataError,
  metadataMessagePreview,
} from "@/components/inbox/workspace-data";
import type {
  ConsentRecordDTO,
  ContactListItemDTO,
  ConversationListItemDTO,
  LocationDTO,
  MessageMetadataDTO,
  TeamDTO,
} from "@/lib/firebase/repositories";

const workspaceId = "workspace_safenet_demo";
const createdAt = "2026-08-07T10:00:00.000Z";

function team(id: string, locationIds: readonly string[]): TeamDTO {
  return {
    id,
    workspaceId,
    name: `Team ${id}`,
    queueType: "general",
    locationIds: [...locationIds],
    businessHoursLabel: "Synthetic hours",
    firstResponseSlaMinutes: 30,
    active: true,
    createdAt,
    updatedAt: createdAt,
  };
}

function location(id: string): LocationDTO {
  return {
    id,
    workspaceId,
    name: `Location ${id}`,
    kind: "hospital",
    city: "Synthetic city",
    supportedServiceRefs: [],
    active: true,
    createdAt,
    updatedAt: createdAt,
  };
}

const contact: ContactListItemDTO = {
  id: "contact_synthetic_appointment",
  workspaceId,
  teamId: "team_demo_general",
  locationId: "location_demo_wattala",
  displayLabel: "Synthetic appointment contact",
  maskedPhone: "Synthetic contact A · no phone stored",
  preferredLanguage: "en",
  alternateLanguages: ["ta"],
  tags: ["appointment"],
  preferenceRevision: 1,
  suppression: {
    suppressAll: false,
    suppressMarketing: false,
    invalidContact: false,
    reasons: [],
    updatedAt: createdAt,
  },
  synthetic: true,
  updatedAt: createdAt,
};

const conversation: ConversationListItemDTO = {
  id: "conversation_synthetic_appointment",
  workspaceId,
  contactId: contact.id,
  connectionId: "connection_demo_simulator",
  teamId: contact.teamId,
  locationId: contact.locationId,
  status: "active",
  mode: "automation",
  assigneeId: null,
  detectedLanguage: "en",
  languageConfidence: 0.99,
  purpose: "appointment",
  serviceWindowExpiresAt: null,
  firstResponseDueAt: createdAt,
  lastMessageAt: createdAt,
  handoffSummary: "Summary is intentionally not mapped to the message preview.",
  unreadCount: 1,
  synthetic: true,
  createdAt,
  updatedAt: createdAt,
};

const message: MessageMetadataDTO = {
  id: "message_synthetic_appointment_inbound",
  workspaceId,
  conversationId: conversation.id,
  contactId: contact.id,
  teamId: contact.teamId,
  locationId: contact.locationId,
  direction: "inbound",
  type: "text",
  status: "received",
  externalDispatch: "not_applicable",
  actorId: null,
  receivedAt: createdAt,
  sentAt: null,
  deliveredAt: null,
  metadataOnly: true,
  synthetic: true,
  schemaVersion: 1,
  createdAt,
  updatedAt: createdAt,
};

const consent: ConsentRecordDTO = {
  id: "consent_synthetic_appointment",
  workspaceId,
  contactId: contact.id,
  teamId: contact.teamId,
  locationId: contact.locationId,
  purpose: "appointment_service",
  channel: "whatsapp",
  category: "service",
  status: "granted",
  source: "synthetic_fixture",
  noticeVersion: "demo-v1",
  language: "en",
  evidenceRef: "protected://synthetic/consent/appointment",
  capturedAt: createdAt,
  withdrawnAt: null,
  supersedesRecordId: null,
  synthetic: true,
  schemaVersion: 1,
  createdAt,
  updatedAt: createdAt,
};

describe("persisted inbox workspace model", () => {
  it("uses a bounded workspace-wide plan only for tenant administrators", () => {
    expect(
      buildInboxScopePlan(
        { workspaceId, role: "tenant_admin", scopeMode: "workspace_wide", teamIds: [], locationIds: [] },
        [],
        [],
      ),
    ).toEqual({ kind: "workspace_wide", pairs: [] });
    expect(
      buildInboxScopePlan(
        { workspaceId, role: "analyst", scopeMode: "assigned", teamIds: ["team-a"], locationIds: ["location-a"] },
        [team("team-a", ["location-a"])],
        [location("location-a")],
      ),
    ).toEqual({ kind: "denied", pairs: [], reason: "role_not_permitted" });
    expect(
      buildInboxScopePlan(
        {
          workspaceId,
          role: "agent",
          scopeMode: "workspace_wide",
          teamIds: ["team-a"],
          locationIds: ["location-a"],
        },
        [team("team-a", ["location-a"])],
        [location("location-a")],
      ),
    ).toEqual({ kind: "denied", pairs: [], reason: "scope_invalid" });
  });

  it("replans an assigned tenant administrator to exact pairs instead of a wildcard", () => {
    expect(
      buildInboxScopePlan(
        {
          workspaceId,
          role: "tenant_admin",
          scopeMode: "assigned",
          teamIds: ["team-a"],
          locationIds: ["location-a"],
        },
        [team("team-a", ["location-a"])],
        [location("location-a")],
      ),
    ).toEqual({
      kind: "scoped",
      pairs: [{ teamId: "team-a", locationId: "location-a" }],
    });
  });

  it("builds exact active team-and-location pairs and fails closed without scope", () => {
    const plan = buildInboxScopePlan(
      {
        workspaceId,
        role: "agent",
        scopeMode: "assigned",
        teamIds: ["team-a", "team-a"],
        locationIds: ["location-b", "location-b"],
      },
      [team("team-a", ["location-a", "location-b"]), team("team-b", ["location-b"])],
      [location("location-a"), location("location-b")],
    );
    expect(plan).toEqual({
      kind: "scoped",
      pairs: [{ teamId: "team-a", locationId: "location-b" }],
    });
    expect(
      buildInboxScopePlan(
        { workspaceId, role: "supervisor", scopeMode: "assigned", teamIds: [], locationIds: ["location-b"] },
        [],
        [location("location-b")],
      ),
    ).toEqual({ kind: "denied", pairs: [], reason: "scope_missing" });
  });

  it("deduplicates joined records and exposes only a generic body-free message preview", () => {
    const records = assembleInboxRecords({
      workspaceId,
      conversations: [conversation, conversation],
      contacts: [contact, contact],
      teams: [team(contact.teamId, [contact.locationId])],
      locations: [location(contact.locationId)],
      consentByContactId: new Map([[contact.id, [consent, consent]]]),
      messagesByConversationId: new Map([[conversation.id, [message, message]]]),
    });

    expect(records).toHaveLength(1);
    expect(records[0]?.messages).toHaveLength(1);
    expect(records[0]?.consentRecords).toHaveLength(1);
    expect(metadataMessagePreview(message)).toBe(
      "Inbound synthetic text message metadata — body not stored",
    );
    expect(filterInboxRecords(records, {
      search: "body not stored",
      status: "all",
      language: "all",
      safetyOnly: false,
    })).toHaveLength(1);
    expect(filterInboxRecords(records, {
      search: "private message body",
      status: "all",
      language: "all",
      safetyOnly: false,
    })).toHaveLength(0);
  });

  it("rejects a cross-scope message and never reflects raw load errors", () => {
    const wrongScopeMessage = { ...message, locationId: "location_demo_other" };
    expect(() =>
      assembleInboxRecords({
        workspaceId,
        conversations: [conversation],
        contacts: [contact],
        teams: [team(contact.teamId, [contact.locationId])],
        locations: [location(contact.locationId)],
        consentByContactId: new Map([[contact.id, [consent]]]),
        messagesByConversationId: new Map([[conversation.id, [wrongScopeMessage]]]),
      }),
    ).toThrow(InboxWorkspaceDataError);
    expect(describeInboxWorkspaceError(new Error("private-patient-value"))).not.toContain(
      "private-patient-value",
    );
    expect(
      describeInboxWorkspaceError(
        new InboxWorkspaceDataError("safe", "load_failed", "firestore/permission-denied"),
      ),
    ).toContain("denied");
  });
  it("in tolerant mode skips another lane's unjoinable conversation and counts it, while strict mode still fails closed", () => {
    const otherLane = { ...conversation, id: "conv_live_canary", contactId: "contact_live_af0611f559" };
    const input = {
      workspaceId,
      conversations: [conversation, otherLane],
      contacts: [contact],
      teams: [team(contact.teamId, [contact.locationId])],
      locations: [location(contact.locationId)],
      consentByContactId: new Map([[contact.id, [consent]]]),
      messagesByConversationId: new Map([[conversation.id, [message]]]),
    };

    expect(() => assembleInboxRecords(input)).toThrow(InboxWorkspaceDataError);

    const tolerant = assembleInboxRecordsWithExclusions(input, { tolerant: true });
    expect(tolerant.records).toHaveLength(1);
    expect(tolerant.records[0]?.conversation.id).toBe(conversation.id);
    expect(tolerant.excluded).toBe(1);
  });
});
