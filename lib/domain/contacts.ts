import type {
  ConsentRecordId,
  ContactId,
  EncryptedValueRef,
  ExternalReference,
  HmacDigest,
  ISODateTime,
  SupportedLanguage,
  WorkspaceScopedEntity,
} from "./primitives";

export type ConsentChannel = "whatsapp";
export type MessageCategory = "service" | "utility" | "marketing" | "authentication";
export type ConsentPurpose =
  | "appointment_service"
  | "laboratory_service"
  | "care_pathway"
  | "feedback"
  | "health_campaigns"
  | "event_campaigns"
  | "transactional_updates";
export type ConsentStatus = "granted" | "withdrawn" | "denied" | "expired" | "unknown";
export type ConsentSource =
  | "whatsapp_flow"
  | "inbound_keyword"
  | "preference_centre"
  | "staff_recorded"
  | "documented_import"
  | "authoritative_system"
  | "synthetic_fixture";

export interface ContactSuppressionState {
  readonly suppressAll: boolean;
  readonly suppressMarketing: boolean;
  readonly invalidContact: boolean;
  readonly reasons: readonly (
    | "stop_keyword"
    | "manual_withdrawal"
    | "complaint"
    | "invalid_number"
    | "guardian_authority_missing"
    | "clinical_hold"
  )[];
  readonly updatedAt: ISODateTime;
}

/**
 * Contact identity deliberately stores references to protected values, not plaintext
 * phone numbers or names. Full clinical records remain in the authoritative system.
 */
export interface Contact extends WorkspaceScopedEntity<ContactId> {
  readonly phoneLookupHmac: HmacDigest;
  readonly encryptedPhoneRef: EncryptedValueRef;
  readonly maskedPhone: string;
  readonly encryptedDisplayNameRef: EncryptedValueRef | null;
  readonly displayLabel: string;
  readonly externalPatientRef: ExternalReference | null;
  readonly preferredLanguage: SupportedLanguage;
  readonly alternateLanguages: readonly SupportedLanguage[];
  readonly suppression: ContactSuppressionState;
  readonly tags: readonly string[];
  readonly synthetic: boolean;
}

/** Consent records are immutable events. Never update an existing record in place. */
export interface ConsentRecord extends WorkspaceScopedEntity<ConsentRecordId> {
  readonly contactId: ContactId;
  readonly purpose: ConsentPurpose;
  readonly channel: ConsentChannel;
  readonly category: MessageCategory;
  readonly status: ConsentStatus;
  readonly source: ConsentSource;
  readonly noticeVersion: string;
  readonly language: SupportedLanguage;
  readonly evidenceRef: string;
  readonly capturedAt: ISODateTime;
  readonly withdrawnAt: ISODateTime | null;
  readonly supersedesRecordId: ConsentRecordId | null;
}

export interface ConsentQuery {
  readonly purpose: ConsentPurpose;
  readonly category: MessageCategory;
  readonly channel?: ConsentChannel;
}

export interface EffectiveConsent {
  readonly status: ConsentStatus;
  readonly record: ConsentRecord | null;
}

export function effectiveConsent(
  records: readonly ConsentRecord[],
  query: ConsentQuery,
): EffectiveConsent {
  const matching = records
    .filter(
      (record) =>
        record.purpose === query.purpose &&
        record.category === query.category &&
        record.channel === (query.channel ?? "whatsapp"),
    )
    .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));

  const record = matching[0] ?? null;
  return { status: record?.status ?? "unknown", record };
}

export function canContactReceiveCategory(contact: Contact, category: MessageCategory): boolean {
  if (contact.suppression.suppressAll || contact.suppression.invalidContact) {
    return false;
  }

  if (category === "marketing" && contact.suppression.suppressMarketing) {
    return false;
  }

  return true;
}

