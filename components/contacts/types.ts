import type {
  ConsentStatus,
  ConsentPurpose,
  MessageCategory,
  SupportedLanguage,
} from "@/lib/domain";
import type { SafeContactTag } from "@/lib/firebase/repositories";

export type ContactSuppressionReason =
  | "stop_keyword"
  | "manual_withdrawal"
  | "complaint"
  | "invalid_number"
  | "guardian_authority_missing"
  | "clinical_hold";

/**
 * Minimum-necessary view model for the Contacts surface. Protected identity
 * references and lookup digests never enter the rendered component tree.
 */
export interface ContactViewRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly teamId: string;
  readonly locationId: string;
  readonly displayLabel: string;
  readonly maskedPhone: string;
  readonly preferredLanguage: SupportedLanguage;
  readonly alternateLanguages: readonly SupportedLanguage[];
  readonly tags: readonly SafeContactTag[];
  readonly suppression: {
    readonly suppressAll: boolean;
    readonly suppressMarketing: boolean;
    readonly invalidContact: boolean;
    readonly reasons: readonly ContactSuppressionReason[];
    readonly updatedAt: string;
  };
  readonly synthetic: true;
  readonly preferenceRevision: number;
  readonly updatedAt: string;
}

export interface ConsentEvidenceViewRecord {
  readonly id: string;
  readonly contactId: string;
  readonly purpose: ConsentPurpose;
  readonly category: MessageCategory;
  readonly channel: "whatsapp";
  readonly status: ConsentStatus;
  readonly source:
    | "whatsapp_flow"
    | "inbound_keyword"
    | "preference_centre"
    | "staff_recorded"
    | "documented_import"
    | "authoritative_system"
    | "synthetic_fixture";
  readonly noticeVersion: string;
  readonly language: SupportedLanguage;
  readonly capturedAt: string;
  readonly withdrawnAt: string | null;
}

export interface ContactDirectoryRecord {
  readonly contact: ContactViewRecord;
  readonly consentRecords: readonly ConsentEvidenceViewRecord[];
}

export type ContactLanguageFilter = "all" | SupportedLanguage;
export type MarketingConsentFilter = "all" | "granted" | "withdrawn" | "unknown";

export interface ContactPreferenceDraft {
  readonly preferredLanguage: SupportedLanguage;
  readonly alternateLanguages: readonly SupportedLanguage[];
  readonly tags: readonly SafeContactTag[];
}

export type ContactPreferenceDrafts = Readonly<
  Partial<Record<string, ContactPreferenceDraft>>
>;

export type LocalSuppressionPreviews = Readonly<Partial<Record<string, boolean>>>;

export interface LocalContactActivity {
  readonly id: string;
  readonly contactId: string;
  readonly label: string;
  readonly occurredAt: string;
}

export type PreferenceSaveStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "working"; readonly message: string }
  | { readonly kind: "success"; readonly message: string; readonly revision: number }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

export type PreferenceSaveStatuses = Readonly<
  Partial<Record<string, PreferenceSaveStatus>>
>;
