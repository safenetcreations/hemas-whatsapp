import { describe, expect, it } from "vitest";
import {
  prepareContactPreferenceUpdate,
  SAFE_CONTACT_TAGS,
  WorkspaceMutationError,
  type ContactPreferenceUpdateInput,
} from "@/lib/firebase/repositories";

const validContactUpdate: ContactPreferenceUpdateInput = {
  workspaceId: "safenet-demo",
  contactId: "contact-synthetic-001",
  preferredLanguage: "ta",
  alternateLanguages: ["en"],
  tags: ["appointment", "human-handoff"],
  expectedPreferenceRevision: 3,
};

describe("Firestore mutation input boundaries", () => {
  it("accepts only the fixed operational contact-tag vocabulary", () => {
    expect(SAFE_CONTACT_TAGS).toEqual([
      "appointment",
      "laboratory",
      "package",
      "human-handoff",
      "urgent-simulation",
      "marketing-suppressed",
    ]);
    expect(prepareContactPreferenceUpdate(validContactUpdate)).toEqual(validContactUpdate);
  });

  it("rejects duplicate/preferred alternate languages and unknown tags before I/O", () => {
    for (const input of [
      { ...validContactUpdate, alternateLanguages: ["en", "en"] },
      { ...validContactUpdate, alternateLanguages: ["ta"] },
      { ...validContactUpdate, tags: ["diagnosis"] },
      { ...validContactUpdate, tags: ["appointment", "appointment"] },
    ]) {
      expect(() => prepareContactPreferenceUpdate(input as never)).toThrowError(
        expect.objectContaining<Partial<WorkspaceMutationError>>({ code: "invalid_input" }),
      );
    }
  });

  it("rejects schema pollution and invalid optimistic revisions before I/O", () => {
    expect(() =>
      prepareContactPreferenceUpdate({
        ...validContactUpdate,
        expectedPreferenceRevision: -1,
        extraData: "malicious",
      } as never),
    ).toThrowError(
      expect.objectContaining<Partial<WorkspaceMutationError>>({ code: "invalid_input" }),
    );
  });
});
