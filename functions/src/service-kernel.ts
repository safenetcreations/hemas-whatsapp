import type {
  DocumentData,
  Firestore,
  Transaction,
} from "firebase-admin/firestore";
import {
  createTenantAuditEvent,
  sanitizeAuditMetadata,
} from "./audit.js";
import { toFirestoreAuditRecord } from "./audit-firestore.js";
import { deterministicId, sha256Hex } from "./deterministic.js";
import { FailClosedError, assertSafeTenantId } from "./errors.js";

export const WORKSPACE_ROLES = [
  "platform_owner",
  "tenant_admin",
  "supervisor",
  "agent",
  "campaign_operator",
  "campaign_approver",
  "analyst",
  "privacy_reviewer",
  "clinical_approver",
] as const;

export const SERVICE_PURPOSES = [
  "patient_support",
  "appointment_service",
  "laboratory_service",
  "campaign_governance",
  "privacy_governance",
  "workspace_administration",
] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
export type ServicePurpose = (typeof SERVICE_PURPOSES)[number];
export type MutationResult = Readonly<Record<string, string | number | boolean | null>>;

export interface AuthenticatedActor {
  readonly uid: string;
  readonly authTime: Date;
}

export interface WorkspaceAuthorizationPolicy {
  readonly allowedRoles: readonly WorkspaceRole[];
  readonly patientScope?: {
    readonly teamId: string;
    readonly locationId: string;
  };
  readonly recentAuthMaxAgeSeconds?: number;
}

export interface AuthorizedWorkspaceContext {
  readonly workspaceId: string;
  readonly uid: string;
  readonly role: WorkspaceRole;
  readonly teamIds: readonly string[];
  readonly locationIds: readonly string[];
}

export interface AuditedMutationPlan<T extends MutationResult> {
  readonly resource: { readonly type: string; readonly id: string };
  readonly result: T;
  readonly auditMetadata?: Readonly<Record<string, unknown>>;
}

export interface AuditedMutationResponse<T extends MutationResult> {
  readonly result: T;
  readonly auditEventId: string;
  readonly replayed: boolean;
}

type MembershipData = {
  readonly id: string;
  readonly uid: string;
  readonly workspaceId: string;
  readonly role: WorkspaceRole;
  readonly status: "active";
  readonly teamIds: readonly string[];
  readonly locationIds: readonly string[];
};

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const IDEMPOTENCY_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{15,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SERVICE_AUDIT_METADATA_KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "internal-note.create": Object.freeze([
    "locationId",
    "noteKind",
    "synthetic",
    "teamId",
  ]),
});

function requireSafeId(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new FailClosedError("invalid_service_request", `${label} is invalid.`);
  }
  return value;
}

function parseIdList(value: unknown, label: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length > 50 ||
    value.some((item) => typeof item !== "string" || !SAFE_ID.test(item)) ||
    new Set(value).size !== value.length
  ) {
    throw new FailClosedError("invalid_membership", `${label} is invalid.`);
  }
  return value;
}

function parseMembership(
  value: DocumentData | undefined,
  workspaceId: string,
  uid: string,
): MembershipData {
  if (!value || value.id !== uid || value.uid !== uid || value.workspaceId !== workspaceId) {
    throw new FailClosedError("membership_denied", "Active workspace membership is required.");
  }
  if (value.status !== "active" || !WORKSPACE_ROLES.includes(value.role as WorkspaceRole)) {
    throw new FailClosedError("membership_denied", "Active workspace membership is required.");
  }
  return {
    id: uid,
    uid,
    workspaceId,
    role: value.role as WorkspaceRole,
    status: "active",
    teamIds: parseIdList(value.teamIds, "Membership team scope"),
    locationIds: parseIdList(value.locationIds, "Membership location scope"),
  };
}

function assertRecentAuthentication(
  actor: AuthenticatedActor,
  maxAgeSeconds: number | undefined,
  now: Date,
): void {
  if (maxAgeSeconds === undefined) return;
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 60 || maxAgeSeconds > 86_400) {
    throw new FailClosedError("invalid_service_policy", "Recent-auth policy is invalid.");
  }
  const ageMs = now.getTime() - actor.authTime.getTime();
  if (!Number.isFinite(ageMs) || ageMs < -300_000 || ageMs > maxAgeSeconds * 1_000) {
    throw new FailClosedError(
      "recent_auth_required",
      "This action requires a recent authenticated session.",
    );
  }
}

export function assertWorkspaceAuthorization(input: {
  readonly workspaceId: string;
  readonly actor: AuthenticatedActor;
  readonly workspace: DocumentData | undefined;
  readonly membership: DocumentData | undefined;
  readonly policy: WorkspaceAuthorizationPolicy;
  readonly now: Date;
}): AuthorizedWorkspaceContext {
  assertSafeTenantId(input.workspaceId);
  const uid = requireSafeId(input.actor.uid, "Authenticated UID");
  if (
    !input.workspace ||
    input.workspace.id !== input.workspaceId ||
    input.workspace.status !== "active"
  ) {
    throw new FailClosedError("workspace_denied", "An active workspace is required.");
  }
  const membership = parseMembership(input.membership, input.workspaceId, uid);
  if (
    input.policy.allowedRoles.length === 0 ||
    !input.policy.allowedRoles.includes(membership.role)
  ) {
    throw new FailClosedError("role_denied", "The workspace role cannot perform this action.");
  }
  assertRecentAuthentication(input.actor, input.policy.recentAuthMaxAgeSeconds, input.now);

  if (input.policy.patientScope) {
    const teamId = requireSafeId(input.policy.patientScope.teamId, "Patient team scope");
    const locationId = requireSafeId(
      input.policy.patientScope.locationId,
      "Patient location scope",
    );
    if (
      membership.role !== "tenant_admin" &&
      (
        !["supervisor", "agent", "clinical_approver"].includes(membership.role) ||
        membership.teamIds.length === 0 ||
        membership.locationIds.length === 0 ||
        !membership.teamIds.includes(teamId) ||
        !membership.locationIds.includes(locationId)
      )
    ) {
      throw new FailClosedError(
        "scope_denied",
        "The requested patient-operation scope is not assigned to this member.",
      );
    }
  }

  return {
    workspaceId: input.workspaceId,
    uid,
    role: membership.role,
    teamIds: membership.teamIds,
    locationIds: membership.locationIds,
  };
}

export function assertIdempotencyInput(key: string, requestHash: string): void {
  if (!IDEMPOTENCY_KEY.test(key)) {
    throw new FailClosedError(
      "invalid_idempotency_key",
      "Idempotency key must contain 16 to 128 safe characters.",
    );
  }
  if (!SHA256.test(requestHash)) {
    throw new FailClosedError(
      "invalid_request_hash",
      "A SHA-256 request fingerprint is required.",
    );
  }
}

export function idempotencyDocumentId(input: {
  readonly workspaceId: string;
  readonly uid: string;
  readonly action: string;
  readonly key: string;
}): string {
  assertSafeTenantId(input.workspaceId);
  requireSafeId(input.uid, "Authenticated UID");
  requireSafeId(input.action, "Service action");
  if (!IDEMPOTENCY_KEY.test(input.key)) {
    throw new FailClosedError("invalid_idempotency_key", "Idempotency key is invalid.");
  }
  return deterministicId(
    "idempotency",
    [input.workspaceId, input.uid, input.action, input.key].join(":"),
  );
}

export function fingerprintServiceRequest(value: unknown): string {
  return sha256Hex(JSON.stringify(value));
}

function parseStoredResult(value: unknown): MutationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FailClosedError("invalid_idempotency_record", "Stored mutation result is invalid.");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (
    entries.length > 20 ||
    entries.some(([key, item]) =>
      !SAFE_ID.test(key) ||
      !(
        item === null ||
        typeof item === "boolean" ||
        (typeof item === "number" && Number.isFinite(item)) ||
        (typeof item === "string" && item.length <= 240)
      )
    )
  ) {
    throw new FailClosedError("invalid_idempotency_record", "Stored mutation result is invalid.");
  }
  return Object.fromEntries(entries) as MutationResult;
}

export function allowlistedServiceAuditMetadata(
  action: string,
  value: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> {
  const allowedKeys = SERVICE_AUDIT_METADATA_KEYS[action];
  if (!allowedKeys) {
    throw new FailClosedError(
      "invalid_service_policy",
      "The service action has no audit metadata policy.",
    );
  }
  const metadata = value ?? {};
  const keys = Object.keys(metadata);
  if (keys.some((key) => !allowedKeys.includes(key))) {
    throw new FailClosedError(
      "invalid_service_request",
      "Audit metadata contains a field outside the action allowlist.",
    );
  }
  return Object.fromEntries(
    allowedKeys
      .filter((key) => Object.hasOwn(metadata, key))
      .map((key) => [key, metadata[key]]),
  );
}

export async function executeAuditedWorkspaceMutation<T extends MutationResult>(input: {
  readonly db: Firestore;
  readonly workspaceId: string;
  readonly actor: AuthenticatedActor;
  readonly action: string;
  readonly purpose: ServicePurpose;
  readonly policy: WorkspaceAuthorizationPolicy;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly now?: Date;
  readonly mutate: (
    transaction: Transaction,
    context: AuthorizedWorkspaceContext,
  ) => Promise<AuditedMutationPlan<T>>;
}): Promise<AuditedMutationResponse<T>> {
  assertSafeTenantId(input.workspaceId);
  const action = requireSafeId(input.action, "Service action");
  if (!SERVICE_PURPOSES.includes(input.purpose)) {
    throw new FailClosedError(
      "invalid_service_request",
      "Service purpose is invalid.",
    );
  }
  assertIdempotencyInput(input.idempotencyKey, input.requestHash);
  const now = input.now ?? new Date();
  const idempotencyId = idempotencyDocumentId({
    workspaceId: input.workspaceId,
    uid: input.actor.uid,
    action,
    key: input.idempotencyKey,
  });
  const workspaceRef = input.db.doc(`workspaces/${input.workspaceId}`);
  const membershipRef = input.db.doc(
    `workspaces/${input.workspaceId}/members/${input.actor.uid}`,
  );
  const idempotencyRef = input.db.doc(
    `workspaces/${input.workspaceId}/idempotencyKeys/${idempotencyId}`,
  );

  return input.db.runTransaction(async (transaction) => {
    const [workspaceSnapshot, membershipSnapshot, idempotencySnapshot] =
      await Promise.all([
        transaction.get(workspaceRef),
        transaction.get(membershipRef),
        transaction.get(idempotencyRef),
      ]);
    const context = assertWorkspaceAuthorization({
      workspaceId: input.workspaceId,
      actor: input.actor,
      workspace: workspaceSnapshot.data(),
      membership: membershipSnapshot.data(),
      policy: input.policy,
      now,
    });

    if (idempotencySnapshot.exists) {
      const stored = idempotencySnapshot.data();
      if (
        stored?.workspaceId !== input.workspaceId ||
        stored?.actorUid !== context.uid ||
        stored?.action !== action ||
        stored?.purpose !== input.purpose ||
        stored?.requestHash !== input.requestHash ||
        typeof stored?.auditEventId !== "string" ||
        !SAFE_ID.test(stored.auditEventId)
      ) {
        throw new FailClosedError(
          "idempotency_conflict",
          "The idempotency key is already bound to another request.",
        );
      }
      return {
        result: parseStoredResult(stored.result) as T,
        auditEventId: stored.auditEventId,
        replayed: true,
      };
    }

    const plan = await input.mutate(transaction, context);
    const result = parseStoredResult(plan.result) as T;
    const resourceType = requireSafeId(plan.resource.type, "Audit resource type");
    const resourceId = requireSafeId(plan.resource.id, "Audit resource ID");
    const auditMetadata = allowlistedServiceAuditMetadata(action, plan.auditMetadata);
    const auditEvent = createTenantAuditEvent({
      tenantId: input.workspaceId,
      actor: { type: "user", id: context.uid },
      action,
      resource: { type: resourceType, id: resourceId },
      outcome: "allowed",
      requestId: idempotencyId,
      occurredAt: now,
      metadata: {
        ...auditMetadata,
        purpose: input.purpose,
      },
    });
    const auditRef = input.db.doc(
      `workspaces/${input.workspaceId}/auditEvents/${auditEvent.id}`,
    );
    transaction.create(auditRef, toFirestoreAuditRecord(auditEvent));
    transaction.create(idempotencyRef, {
      id: idempotencyId,
      workspaceId: input.workspaceId,
      actorUid: context.uid,
      action,
      purpose: input.purpose,
      requestHash: input.requestHash,
      result,
      auditEventId: auditEvent.id,
      createdAt: now,
      synthetic: true,
      schemaVersion: 1,
    });
    return { result, auditEventId: auditEvent.id, replayed: false };
  });
}

export function minimizedAuditMetadata(
  metadata: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return sanitizeAuditMetadata(metadata);
}
