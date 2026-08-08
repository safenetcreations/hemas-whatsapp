import { describe, expect, it } from "vitest";
import {
  normalizedContactSearch,
  normalizedMarketingStatus,
  isContactPreferenceConflict,
  preferenceDraftChanged,
  preferenceDraftFromContact,
  safeContactLoadMessage,
  safeContactSaveMessage,
  withOperationalTags,
  withPreferredLanguage,
} from "@/components/contacts/contact-workspace-model";
import type {
  ConsentEvidenceViewRecord,
  ContactViewRecord,
} from "@/components/contacts/types";

const contact: ContactViewRecord = {
  id: "contact_synthetic_appointment",
  workspaceId: "workspace_safenet_demo",
  teamId: "team_demo_general",
  locationId: "location_demo_wattala",
  displayLabel: "Synthetic appointment contact",
  maskedPhone: "+94 ** *** 0101",
  preferredLanguage: "en",
  alternateLanguages: ["ta"],
  tags: ["appointment"],
  suppression: {
    suppressAll: false,
    suppressMarketing: false,
    invalidContact: false,
    reasons: [],
    updatedAt: "2026-08-07T10:00:00.000Z",
  },
  synthetic: true,
  preferenceRevision: 2,
  updatedAt: "2026-08-07T10:00:00.000Z",
};

function consent(
  status: ConsentEvidenceViewRecord["status"],
  capturedAt: string,
): ConsentEvidenceViewRecord {
  return {
    id: `consent-${status}-${capturedAt}`,
    contactId: contact.id,
    purpose: "health_campaigns",
    category: "marketing",
    channel: "whatsapp",
    status,
    source: "synthetic_fixture",
    noticeVersion: "demo-v1",
    language: "en",
    capturedAt,
    withdrawnAt: status === "withdrawn" ? capturedAt : null,
  };
}

describe("Contacts workspace view model", () => {
  it("normalizes search and uses the newest immutable marketing evidence", () => {
    expect(normalizedContactSearch("  APPoinTment  ")).toBe("appointment");
    expect(
      normalizedMarketingStatus([
        consent("granted", "2026-08-01T10:00:00.000Z"),
        consent("withdrawn", "2026-08-07T10:00:00.000Z"),
      ]),
    ).toBe("withdrawn");
    expect(normalizedMarketingStatus([])).toBe("unknown");
  });

  it("builds a bounded draft and removes a newly preferred language from alternates", () => {
    const initial = preferenceDraftFromContact(contact);
    expect(preferenceDraftChanged(contact, initial)).toBe(false);

    const languageChanged = withPreferredLanguage(initial, "ta");
    expect(languageChanged).toEqual({
      preferredLanguage: "ta",
      alternateLanguages: [],
      tags: ["appointment"],
    });
    expect(preferenceDraftChanged(contact, languageChanged)).toBe(true);

    const tagsChanged = withOperationalTags(initial, ["appointment", "human-handoff"]);
    expect(tagsChanged.tags).toEqual(["appointment", "human-handoff"]);
    expect(preferenceDraftChanged(contact, tagsChanged)).toBe(true);
  });

  it("returns actionable, non-sensitive emulator errors", () => {
    expect(safeContactLoadMessage({ code: "permission-denied" })).toContain("denied");
    expect(safeContactLoadMessage({ code: "unavailable" })).toContain("emulator");
    expect(safeContactSaveMessage({ code: "network-request-failed" })).toContain(
      "unsaved changes",
    );
    expect(safeContactSaveMessage(new Error("patient-private-value"))).not.toContain(
      "patient-private-value",
    );
    expect(isContactPreferenceConflict({ code: "contact_preference_conflict" })).toBe(true);
    expect(isContactPreferenceConflict({ code: "permission-denied" })).toBe(false);
  });
});
