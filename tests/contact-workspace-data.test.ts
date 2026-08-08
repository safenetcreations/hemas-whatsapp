import type { Firestore } from "firebase/firestore";
import { describe, expect, it, vi } from "vitest";
import {
  ContactWorkspaceDataError,
  loadContactWorkspace,
  type ContactWorkspaceReads,
} from "@/components/contacts/contact-workspace-data";
import type {
  ConsentRecordDTO,
  ContactListItemDTO,
  LocationDTO,
  TeamDTO,
} from "@/lib/firebase/repositories";

const workspaceId = "workspace_safenet_demo";
const teamId = "team_demo_general";
const locationId = "location_demo_wattala";
const createdAt = "2026-08-07T10:00:00.000Z";
const db = {} as Firestore;

const team: TeamDTO = {
  id: teamId,
  workspaceId,
  name: "Synthetic general team",
  queueType: "general",
  locationIds: [locationId],
  businessHoursLabel: "Synthetic hours",
  firstResponseSlaMinutes: 30,
  active: true,
  createdAt,
  updatedAt: createdAt,
};

const location: LocationDTO = {
  id: locationId,
  workspaceId,
  name: "Synthetic Wattala",
  kind: "hospital",
  city: "Wattala",
  supportedServiceRefs: [],
  active: true,
  createdAt,
  updatedAt: createdAt,
};

const contact: ContactListItemDTO = {
  id: "contact_synthetic_appointment",
  workspaceId,
  teamId,
  locationId,
  displayLabel: "Synthetic appointment contact",
  maskedPhone: "Synthetic contact A - no phone stored",
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

const consent: ConsentRecordDTO = {
  id: "consent_synthetic_appointment",
  workspaceId,
  contactId: contact.id,
  teamId,
  locationId,
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

function readsFixture(input?: {
  readonly contacts?: readonly ContactListItemDTO[];
  readonly consentRecords?: readonly ConsentRecordDTO[];
}): ContactWorkspaceReads {
  return {
    listTeams: vi.fn(async () => [team]),
    listLocations: vi.fn(async () => [location]),
    listContacts: vi.fn(async () => input?.contacts ?? [contact]),
    listConsentRecords: vi.fn(async () => input?.consentRecords ?? [consent]),
  };
}

describe("tenant-scoped Contacts workspace reads", () => {
  it.each(["supervisor", "agent", "clinical_approver"] as const)(
    "issues one exact team-and-location query for a scoped %s and deduplicates records",
    async (role) => {
      const reads = readsFixture({
        contacts: [contact, contact],
        consentRecords: [consent, consent],
      });

      const records = await loadContactWorkspace(
        db,
        {
          workspaceId,
          role,
          scopeMode: "assigned",
          teamIds: [teamId, teamId],
          locationIds: [locationId, locationId],
        },
        reads,
      );

      expect(reads.listContacts).toHaveBeenCalledTimes(1);
      expect(reads.listContacts).toHaveBeenCalledWith(db, {
        workspaceId,
        teamId,
        locationId,
        pageSize: 100,
      });
      expect(reads.listConsentRecords).toHaveBeenCalledTimes(1);
      expect(reads.listConsentRecords).toHaveBeenCalledWith(db, {
        workspaceId,
        contactId: contact.id,
        teamId,
        locationId,
        pageSize: 100,
      });
      expect(records).toHaveLength(1);
      expect(records[0]?.consentRecords).toHaveLength(1);
    },
  );

  it("fails closed before querying contacts when an agent has no valid scope", async () => {
    const reads = readsFixture();

    await expect(
      loadContactWorkspace(
        db,
        {
          workspaceId,
          role: "agent",
          scopeMode: "assigned",
          teamIds: [],
          locationIds: [locationId],
        },
        reads,
      ),
    ).rejects.toMatchObject({
      code: "scope_denied",
      sourceCode: "contact_scope_missing",
    } satisfies Partial<ContactWorkspaceDataError>);
    expect(reads.listContacts).not.toHaveBeenCalled();
    expect(reads.listConsentRecords).not.toHaveBeenCalled();
  });

  it("retains one bounded workspace-wide query for a tenant administrator", async () => {
    const reads = readsFixture();

    await loadContactWorkspace(
      db,
      {
        workspaceId,
        role: "tenant_admin",
        scopeMode: "workspace_wide",
        teamIds: [],
        locationIds: [],
      },
      reads,
    );

    expect(reads.listContacts).toHaveBeenCalledTimes(1);
    expect(reads.listContacts).toHaveBeenCalledWith(db, {
      workspaceId,
      pageSize: 100,
    });
  });
});
