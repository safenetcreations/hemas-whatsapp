import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";
import {
  parseContactDocument,
  parseConversationDocument,
  parseMessageMetadataDocument,
  parseWorkspaceAccessDocuments,
  prepareConsentRecordListInput,
  prepareConversationListInput,
  prepareMessageMetadataListInput,
  prepareScopedListInput,
  prepareWorkspaceListInput,
  WorkspaceAccessError,
} from "@/lib/firebase/repositories";
import {
  buildLiveContactDocument,
  buildLiveConversationDocument,
  buildLiveMessageDocument,
  liveIds,
} from "../functions/src/meta-bot/bridge.js";

const messageTimestamp = Timestamp.fromDate(new Date("2026-08-07T12:30:00.000Z"));

function staffContact(overrides: Record<string, unknown> = {}) {
  return {
    id: "contact_synthetic_appointment",
    workspaceId: "workspace_safenet_demo",
    teamId: "team_demo_general",
    locationId: "location_demo_wattala",
    maskedPhone: "Synthetic contact A · no phone stored",
    displayLabel: "Synthetic Patient A",
    preferredLanguage: "en",
    alternateLanguages: [],
    suppression: {
      suppressAll: false,
      suppressMarketing: false,
      invalidContact: false,
      reasons: [],
      updatedAt: messageTimestamp,
    },
    tags: ["appointment"],
    preferenceRevision: 0,
    synthetic: true,
    createdAt: messageTimestamp,
    updatedAt: messageTimestamp,
    ...overrides,
  };
}

function messageMetadata(overrides: Record<string, unknown> = {}) {
  return {
    id: "message_synthetic_001",
    workspaceId: "workspace_safenet_demo",
    conversationId: "conversation_synthetic_appointment",
    contactId: "contact_synthetic_appointment",
    teamId: "team_demo_general",
    locationId: "location_demo_wattala",
    direction: "inbound",
    type: "text",
    status: "received",
    externalDispatch: "not_applicable",
    actorId: null,
    receivedAt: messageTimestamp,
    sentAt: null,
    deliveredAt: null,
    metadataOnly: true,
    synthetic: true,
    schemaVersion: 1,
    createdAt: messageTimestamp,
    updatedAt: messageTimestamp,
    ...overrides,
  };
}

describe("Firestore read-repository input boundaries", () => {
  it("binds workspace and membership payload identities to their requested document paths", () => {
    const input = {
      workspaceId: "workspace_safenet_demo",
      uid: "user_synthetic_admin",
      workspaceDocumentId: "workspace_safenet_demo",
      membershipDocumentId: "user_synthetic_admin",
      workspaceValue: {
        id: "workspace_safenet_demo",
        name: "SafeNet synthetic workspace",
        status: "active",
        mode: "demo",
        dataClassification: "synthetic_only",
      },
      membershipValue: {
        id: "user_synthetic_admin",
        uid: "user_synthetic_admin",
        workspaceId: "workspace_safenet_demo",
        role: "tenant_admin",
        status: "active",
        teamIds: [],
        locationIds: [],
      },
    } as const;
    expect(parseWorkspaceAccessDocuments(input).membership.role).toBe("tenant_admin");

    for (const mismatch of [
      { workspaceDocumentId: "workspace_other" },
      { membershipDocumentId: "user_other" },
      { workspaceValue: { ...input.workspaceValue, id: "workspace_other" } },
      { membershipValue: { ...input.membershipValue, uid: "user_other" } },
      { membershipValue: { ...input.membershipValue, workspaceId: "workspace_other" } },
    ]) {
      expect(() => parseWorkspaceAccessDocuments({ ...input, ...mismatch })).toThrowError(
        expect.objectContaining({ code: "invalid_data" }),
      );
    }
  });

  it("accepts only the minimum staff contact model and rejects protected identifiers", () => {
    const contact = parseContactDocument(
      staffContact(),
      "contact_synthetic_appointment",
      "workspace_safenet_demo",
    );
    expect(contact).toMatchObject({
      id: "contact_synthetic_appointment",
      displayLabel: "Synthetic Patient A",
      updatedAt: "2026-08-07T12:30:00.000Z",
    });
    for (const protectedField of [
      "phoneLookupHmac",
      "encryptedPhoneRef",
      "encryptedDisplayNameRef",
      "externalPatientRef",
    ]) {
      expect(contact).not.toHaveProperty(protectedField);
      expect(() =>
        parseContactDocument(
          staffContact({ [protectedField]: "protected-value" }),
          "contact_synthetic_appointment",
          "workspace_safenet_demo",
        ),
      ).toThrowError(expect.objectContaining({ code: "invalid_data" }));
    }
  });

  it("parses the exact canonical contact, conversation and message shapes emitted by the live bridge", () => {
    const nowMs = Date.parse("2026-08-11T10:00:00.000Z");
    const ids = liveIds("94700000000");
    const inbound = {
      direction: "inbound" as const,
      waMessageId: "wamid.synthetic",
      messageType: "text",
      language: "en" as const,
      purpose: "general_support" as const,
      staffHandoff: true,
      last4: "0000",
    };

    const contact = buildLiveContactDocument({
      contactId: ids.contactId,
      last4: inbound.last4,
      language: "en",
      nowMs,
      addTags: ["human-handoff"],
    });
    expect(parseContactDocument(contact, ids.contactId, "workspace_safenet_demo")).toMatchObject({
      id: ids.contactId,
      tags: ["human-handoff"],
      liveCanary: true,
      suppression: {
        suppressAll: false,
        suppressMarketing: false,
        invalidContact: false,
      },
    });

    const conversation = buildLiveConversationDocument({
      contactId: ids.contactId,
      conversationId: ids.conversationId,
      message: inbound,
      nowMs,
    });
    expect(
      parseConversationDocument(
        conversation,
        ids.conversationId,
        "workspace_safenet_demo",
      ),
    ).toMatchObject({
      id: ids.conversationId,
      mode: "human_takeover",
      liveCanary: true,
    });

    const inboundMessage = buildLiveMessageDocument({
      messageId: "message_live_0000000000000000",
      contactId: ids.contactId,
      conversationId: ids.conversationId,
      message: inbound,
      nowMs,
    });
    expect(
      parseMessageMetadataDocument(
        inboundMessage,
        "message_live_0000000000000000",
        "workspace_safenet_demo",
      ),
    ).toMatchObject({ externalDispatch: "not_applicable", liveCanary: true });

    const outboundMessage = buildLiveMessageDocument({
      messageId: "message_live_1111111111111111",
      contactId: ids.contactId,
      conversationId: ids.conversationId,
      message: { ...inbound, direction: "outbound" },
      nowMs,
    });
    expect(
      parseMessageMetadataDocument(
        {
          ...outboundMessage,
          actorId: "agent-a",
          agentReply: true,
        },
        "message_live_1111111111111111",
        "workspace_safenet_demo",
      ),
    ).toMatchObject({
      externalDispatch: "dispatched",
      liveCanary: true,
      agentReply: true,
    });

    expect(() =>
      parseContactDocument(
        { ...contact, liveCanary: false },
        ids.contactId,
        "workspace_safenet_demo",
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid_data" }));
    expect(() =>
      parseMessageMetadataDocument(
        { ...outboundMessage, agentReply: false },
        "message_live_1111111111111111",
        "workspace_safenet_demo",
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid_data" }));
  });

  it("accepts bounded tenant-admin and exact-scope list inputs", () => {
    expect(
      prepareScopedListInput({ workspaceId: "workspace_safenet_demo", pageSize: 100 }),
    ).toEqual({ workspaceId: "workspace_safenet_demo", pageSize: 100 });
    expect(
      prepareConversationListInput({
        workspaceId: "workspace_safenet_demo",
        teamId: "team_demo_general",
        locationId: "location_demo_wattala",
        statuses: ["active", "assigned"],
        pageSize: 50,
      }),
    ).toMatchObject({ statuses: ["active", "assigned"] });
    expect(
      prepareWorkspaceListInput({ workspaceId: "workspace_safenet_demo" }),
    ).toEqual({ workspaceId: "workspace_safenet_demo" });
  });

  it("enforces direction-specific message metadata invariants", () => {
    const inbound = parseMessageMetadataDocument(
      messageMetadata(),
      "message_synthetic_001",
      "workspace_safenet_demo",
    );
    expect(inbound.status).toBe("received");

    const outbound = parseMessageMetadataDocument(
      messageMetadata({
        direction: "outbound",
        status: "simulated",
        externalDispatch: "simulation_only",
        receivedAt: null,
        sentAt: messageTimestamp,
        deliveredAt: messageTimestamp,
      }),
      "message_synthetic_001",
      "workspace_safenet_demo",
    );
    expect(outbound.externalDispatch).toBe("simulation_only");

    for (const invalid of [
      messageMetadata({ status: "simulated" }),
      messageMetadata({ externalDispatch: "simulation_only" }),
      messageMetadata({ actorId: "agent-a" }),
      messageMetadata({ receivedAt: null }),
      messageMetadata({ sentAt: messageTimestamp }),
      messageMetadata({ deliveredAt: messageTimestamp }),
      messageMetadata({ direction: "outbound", receivedAt: null }),
      messageMetadata({ direction: "outbound", status: "received", receivedAt: null }),
    ]) {
      expect(() =>
        parseMessageMetadataDocument(
          invalid,
          "message_synthetic_001",
          "workspace_safenet_demo",
        ),
      ).toThrowError(expect.objectContaining({ code: "invalid_data" }));
    }
  });

  it("rejects unpaired scopes, oversized limits, duplicate filters and schema pollution", () => {
    for (const input of [
      { workspaceId: "workspace_safenet_demo", teamId: "team_demo_general" },
      { workspaceId: "workspace_safenet_demo", pageSize: 101 },
      { workspaceId: "workspace_safenet_demo", pageSize: 0 },
      { workspaceId: "workspace_safenet_demo", extra: "pollution" },
    ]) {
      expect(() => prepareScopedListInput(input as never)).toThrowError(
        expect.objectContaining<Partial<WorkspaceAccessError>>({ code: "invalid_data" }),
      );
    }

    expect(() =>
      prepareConversationListInput({
        workspaceId: "workspace_safenet_demo",
        statuses: ["active", "active"],
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_data" }));
  });

  it("requires contact/conversation and both patient-scope dimensions", () => {
    const consent = {
      workspaceId: "workspace_safenet_demo",
      contactId: "contact_synthetic_appointment",
      teamId: "team_demo_general",
      locationId: "location_demo_wattala",
      pageSize: 25,
    };
    const messages = {
      workspaceId: "workspace_safenet_demo",
      conversationId: "conversation_synthetic_appointment",
      teamId: "team_demo_general",
      locationId: "location_demo_wattala",
      pageSize: 25,
    };

    expect(prepareConsentRecordListInput(consent)).toEqual(consent);
    expect(prepareMessageMetadataListInput(messages)).toEqual(messages);
    expect(() =>
      prepareConsentRecordListInput({ ...consent, locationId: undefined } as never),
    ).toThrowError(expect.objectContaining({ code: "invalid_data" }));
    expect(() =>
      prepareMessageMetadataListInput({ ...messages, pageSize: 500_000 } as never),
    ).toThrowError(expect.objectContaining({ code: "invalid_data" }));
  });
});
