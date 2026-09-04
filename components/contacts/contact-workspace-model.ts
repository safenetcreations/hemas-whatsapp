import { DATA_SOURCE } from "@/lib/firebase/boundary-copy";
import type { ConsentStatus, SupportedLanguage } from "@/lib/domain";
import type { SafeContactTag } from "@/lib/firebase/repositories";
import type {
  ConsentEvidenceViewRecord,
  ContactPreferenceDraft,
  ContactViewRecord,
  MarketingConsentFilter,
} from "./types";

export function normalizedContactSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function normalizedMarketingStatus(
  records: readonly ConsentEvidenceViewRecord[],
): Exclude<MarketingConsentFilter, "all"> {
  const latest = records
    .filter(
      (record) =>
        record.purpose === "health_campaigns" &&
        record.category === "marketing" &&
        record.channel === "whatsapp",
    )
    .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt))[0];

  return consentStatusToMarketingStatus(latest?.status ?? "unknown");
}

function consentStatusToMarketingStatus(
  status: ConsentStatus,
): Exclude<MarketingConsentFilter, "all"> {
  if (status === "granted") return "granted";
  if (status === "withdrawn" || status === "denied" || status === "expired") {
    return "withdrawn";
  }
  return "unknown";
}

export function preferenceDraftFromContact(contact: ContactViewRecord): ContactPreferenceDraft {
  return {
    preferredLanguage: contact.preferredLanguage,
    alternateLanguages: [...contact.alternateLanguages],
    tags: [...contact.tags],
  };
}

export function withPreferredLanguage(
  draft: ContactPreferenceDraft,
  preferredLanguage: SupportedLanguage,
): ContactPreferenceDraft {
  return {
    ...draft,
    preferredLanguage,
    alternateLanguages: draft.alternateLanguages.filter(
      (language) => language !== preferredLanguage,
    ),
  };
}

export function withOperationalTags(
  draft: ContactPreferenceDraft,
  tags: readonly SafeContactTag[],
): ContactPreferenceDraft {
  return { ...draft, tags: [...tags] };
}

export function preferenceDraftChanged(
  contact: ContactViewRecord,
  draft: ContactPreferenceDraft | undefined,
): boolean {
  if (!draft) return false;
  return (
    contact.preferredLanguage !== draft.preferredLanguage ||
    !sameValues(contact.alternateLanguages, draft.alternateLanguages) ||
    !sameValues(contact.tags, draft.tags)
  );
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function safeContactLoadMessage(error: unknown): string {
  const code = `${errorCode(error)} ${errorSourceCode(error)}`;
  if (code.includes("scope_denied") || code.includes("contact_scope_")) {
    return "This membership has no valid active team-and-location scope for patient contacts, so the directory stayed closed.";
  }
  if (code.includes("invalid_join")) {
    return "Persisted contacts failed tenant-scope validation, so the directory stayed closed.";
  }
  if (code.includes("permission-denied") || code.includes("unauthenticated")) {
    return "Firestore denied this directory request. Re-authenticate the synthetic workspace and try again.";
  }
  if (code.includes("failed-precondition")) {
    return "The contact query needs its approved Firestore index before it can run.";
  }
  if (code.includes("unavailable") || code.includes("network")) {
    return `${DATA_SOURCE.charAt(0).toUpperCase()}${DATA_SOURCE.slice(1)} is unavailable. Check the connection and retry.`;
  }
  return `The synthetic contact directory could not be loaded from ${DATA_SOURCE}.`;
}

export function safeContactSaveMessage(error: unknown): string {
  const code = errorCode(error);
  if (code.includes("permission-denied") || code.includes("unauthenticated")) {
    return "Firestore denied this preference change. No contact data was changed.";
  }
  if (code.includes("unavailable") || code.includes("network")) {
    return `${DATA_SOURCE.charAt(0).toUpperCase()}${DATA_SOURCE.slice(1)} is unavailable. Your unsaved changes remain in this browser.`;
  }
  return "The preference change could not be saved. Your unsaved changes remain in this browser.";
}

export function isContactPreferenceConflict(error: unknown): boolean {
  return errorCode(error) === "contact_preference_conflict";
}

export function errorCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) return "";
  return String(error.code).toLocaleLowerCase();
}

function errorSourceCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("sourceCode" in error)) return "";
  return String(error.sourceCode).toLocaleLowerCase();
}
