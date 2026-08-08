import type {
  AuditEventId,
  ISODateTime,
  MemberId,
  RequestId,
  UserId,
  WorkspaceScopedEntity,
} from "./primitives";

export type AuditActor =
  | { readonly type: "member"; readonly memberId: MemberId; readonly uid: UserId }
  | { readonly type: "system"; readonly service: string }
  | { readonly type: "provider"; readonly provider: "meta" | "hemas_system" | "simulator" };

export interface AuditTarget {
  readonly collection: string;
  readonly id: string;
}

/** Audit events are append-only and must contain redacted, non-secret metadata. */
export interface AuditEvent extends WorkspaceScopedEntity<AuditEventId> {
  readonly actor: AuditActor;
  readonly action: string;
  readonly target: AuditTarget;
  readonly requestId: RequestId;
  readonly outcome: "success" | "denied" | "failed";
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
  readonly occurredAt: ISODateTime;
  readonly immutable: true;
}

const FORBIDDEN_AUDIT_METADATA_KEYS = new Set([
  "accessToken",
  "apiKey",
  "password",
  "fullPhoneNumber",
  "messageBody",
  "reportContent",
  "otp",
]);

export function assertSafeAuditMetadata(
  metadata: Readonly<Record<string, string | number | boolean | null>>,
): void {
  for (const key of Object.keys(metadata)) {
    if (FORBIDDEN_AUDIT_METADATA_KEYS.has(key)) {
      throw new Error(`Audit metadata must not contain sensitive key: ${key}`);
    }
  }
}

