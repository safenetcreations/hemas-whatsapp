/** Shared primitives for the Hemas Connect domain model. */

export type Brand<Value, Name extends string> = Value & {
  readonly __brand: Name;
};

export type EntityId<Name extends string> = Brand<string, `${Name}Id`>;

export type WorkspaceId = EntityId<"Workspace">;
export type MemberId = EntityId<"Member">;
export type UserId = EntityId<"User">;
export type TeamId = EntityId<"Team">;
export type LocationId = EntityId<"Location">;
export type ConnectionId = EntityId<"Connection">;
export type ContactId = EntityId<"Contact">;
export type ConsentRecordId = EntityId<"ConsentRecord">;
export type ConversationId = EntityId<"Conversation">;
export type MessageId = EntityId<"Message">;
export type AppointmentId = EntityId<"Appointment">;
export type LabReportId = EntityId<"LabReport">;
export type TemplateId = EntityId<"Template">;
export type TemplateVersionId = EntityId<"TemplateVersion">;
export type CampaignId = EntityId<"Campaign">;
export type AudienceSnapshotId = EntityId<"AudienceSnapshot">;
export type CampaignRecipientId = EntityId<"CampaignRecipient">;
export type AutomationDefinitionId = EntityId<"AutomationDefinition">;
export type AutomationRunId = EntityId<"AutomationRun">;
export type CarePathwayId = EntityId<"CarePathway">;
export type CareEnrollmentId = EntityId<"CareEnrollment">;
export type AuditEventId = EntityId<"AuditEvent">;
export type UsageLedgerId = EntityId<"UsageLedger">;
export type DailyMetricId = EntityId<"DailyMetric">;

export type ISODateTime = Brand<string, "ISODateTime">;
export type ISODate = Brand<string, "ISODate">;
export type TimeZone = Brand<string, "IanaTimeZone">;
export type RequestId = Brand<string, "RequestId">;
export type CorrelationId = Brand<string, "CorrelationId">;
export type Sha256Digest = Brand<string, "Sha256Digest">;
export type HmacDigest = Brand<string, "HmacDigest">;
export type EncryptedValueRef = Brand<string, "EncryptedValueRef">;
export type ExternalReference = Brand<string, "ExternalReference">;

export type SupportedLanguage = "en" | "si" | "ta";

export interface WorkspaceScopedEntity<Id extends string> {
  readonly id: Id;
  readonly workspaceId: WorkspaceId;
  readonly createdAt: ISODateTime;
  readonly updatedAt: ISODateTime;
}

export interface VerificationStamp {
  readonly source: "simulator" | "firebase" | "meta" | "hemas_system" | "manual";
  readonly status: "unverified" | "verified" | "stale" | "failed";
  readonly checkedAt: ISODateTime | null;
  readonly detail?: string;
}

/**
 * Converts a known-safe identifier into a strongly typed entity identifier.
 * This function does not validate persistence existence.
 */
export function entityId<Name extends string>(value: string): EntityId<Name> {
  if (!value.trim()) {
    throw new Error("Entity identifiers must not be empty.");
  }

  return value as EntityId<Name>;
}

export function isoDateTime(value: string): ISODateTime {
  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp) || !value.includes("T")) {
    throw new Error(`Invalid ISO date-time: ${value}`);
  }

  return new Date(timestamp).toISOString() as ISODateTime;
}

export function isoDate(value: string): ISODate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid ISO date: ${value}`);
  }

  return value as ISODate;
}

export function timeZone(value: string): TimeZone {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
  } catch {
    throw new Error(`Invalid IANA time zone: ${value}`);
  }

  return value as TimeZone;
}

export function requestId(value: string): RequestId {
  if (!value.trim()) {
    throw new Error("Request identifiers must not be empty.");
  }

  return value as RequestId;
}

export function correlationId(value: string): CorrelationId {
  if (!value.trim()) {
    throw new Error("Correlation identifiers must not be empty.");
  }

  return value as CorrelationId;
}

export function sha256Digest(value: string): Sha256Digest {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error("SHA-256 digests must contain 64 hexadecimal characters.");
  }

  return value.toLowerCase() as Sha256Digest;
}

export function hmacDigest(value: string): HmacDigest {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error("HMAC digests must contain 64 hexadecimal characters.");
  }

  return value.toLowerCase() as HmacDigest;
}

export function encryptedValueRef(value: string): EncryptedValueRef {
  if (!value.startsWith("encrypted://") && !value.startsWith("demo://")) {
    throw new Error("Encrypted values must be represented by an approved reference.");
  }

  return value as EncryptedValueRef;
}

export function externalReference(value: string): ExternalReference {
  if (!value.trim()) {
    throw new Error("External references must not be empty.");
  }

  return value as ExternalReference;
}

