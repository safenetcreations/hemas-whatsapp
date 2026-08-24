export const PROTECTED_MESSAGE_ACCESS_AUDITS_COLLECTION =
  "protectedMessageAccessAudits" as const;
export const PROTECTED_MESSAGE_ACCESS_QUOTAS_COLLECTION =
  "protectedMessageAccessQuotas" as const;
export const PROTECTED_INBOX_MAX_MESSAGES = 60;
export const PROTECTED_INBOX_RATE_LIMIT = 6;
export const PROTECTED_INBOX_RATE_WINDOW_MS = 60_000;
export const PROTECTED_INBOX_QUOTA_RETENTION_MS = 5 * 60_000;
export const PROTECTED_INBOX_AUDIT_RETENTION_MS = 90 * 24 * 60 * 60_000;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_MESSAGE_ID = /^message_[a-z0-9_]{3,100}$/;
const PROTECTED_ROLES = ["agent", "supervisor", "tenant_admin"] as const;

export type ProtectedInboxRole = (typeof PROTECTED_ROLES)[number];
export type ProtectedInboxAccessMode =
  | "tenant_admin_workspace_wide"
  | "supervisor_scoped"
  | "agent_unassigned"
  | "agent_assigned_self";

export class ProtectedInboxError extends Error {
  constructor(
    readonly code:
      | "unauthenticated"
      | "invalid_argument"
      | "permission_denied"
      | "invalid_authority"
      | "invalid_conversation"
      | "resource_exhausted",
    message: string,
  ) {
    super(message);
    this.name = "ProtectedInboxError";
  }
}

type RecordValue = Readonly<Record<string, unknown>>;

function asRecord(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function hasExactKeys(record: RecordValue, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function validSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function validNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function timestampMillis(value: unknown): number | null {
  if (value instanceof Date) {
    const millis = value.getTime();
    return validNonNegativeSafeInteger(millis) ? millis : null;
  }
  if (typeof value !== "object" || value === null) return null;
  const toMillis = (value as { readonly toMillis?: unknown }).toMillis;
  if (typeof toMillis !== "function") return null;
  try {
    const millis = toMillis.call(value);
    return validNonNegativeSafeInteger(millis) ? millis : null;
  } catch {
    return null;
  }
}

function assertTimestampAt(
  value: unknown,
  expectedMs: number,
  message: string,
): void {
  if (timestampMillis(value) !== expectedMs) {
    throw new ProtectedInboxError("invalid_argument", message);
  }
}

export type ProtectedInboxAccessWindow = {
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly quotaExpiresAtMs: number;
  readonly auditExpiresAtMs: number;
};

/**
 * Returns the canonical UTC fixed window used by every instance. Keeping the
 * boundary numeric makes it deterministic across retries and Cloud Functions
 * instances; Firestore transactions provide the concurrency control.
 */
export function protectedInboxAccessWindow(
  nowMs: number,
): ProtectedInboxAccessWindow {
  if (!validNonNegativeSafeInteger(nowMs)) {
    throw new ProtectedInboxError(
      "invalid_argument",
      "Protected Inbox access time is invalid.",
    );
  }
  const windowStartMs = Math.floor(nowMs / PROTECTED_INBOX_RATE_WINDOW_MS) *
    PROTECTED_INBOX_RATE_WINDOW_MS;
  const windowEndMs = windowStartMs + PROTECTED_INBOX_RATE_WINDOW_MS;
  const quotaExpiresAtMs = windowStartMs + PROTECTED_INBOX_QUOTA_RETENTION_MS;
  const auditExpiresAtMs = windowStartMs + PROTECTED_INBOX_AUDIT_RETENTION_MS;
  if (
    !Number.isSafeInteger(windowEndMs) ||
    !Number.isSafeInteger(quotaExpiresAtMs) ||
    !Number.isSafeInteger(auditExpiresAtMs)
  ) {
    throw new ProtectedInboxError(
      "invalid_argument",
      "Protected Inbox access time is outside the supported range.",
    );
  }
  return { windowStartMs, windowEndMs, quotaExpiresAtMs, auditExpiresAtMs };
}

function assertCanonicalAccessWindow(window: ProtectedInboxAccessWindow): void {
  const canonical = protectedInboxAccessWindow(window.windowStartMs);
  if (
    canonical.windowStartMs !== window.windowStartMs ||
    canonical.windowEndMs !== window.windowEndMs ||
    canonical.quotaExpiresAtMs !== window.quotaExpiresAtMs ||
    canonical.auditExpiresAtMs !== window.auditExpiresAtMs
  ) {
    throw new ProtectedInboxError(
      "invalid_argument",
      "Protected Inbox access window is invalid.",
    );
  }
}

type Sha256Hex = (value: string) => string;

function deterministicProtectedInboxId(input: {
  readonly prefix: "protected_quota" | "protected_access";
  readonly components: readonly (string | number)[];
  readonly sha256Hex: Sha256Hex;
}): string {
  const digest = input.sha256Hex(JSON.stringify(input.components));
  if (!validSha256(digest)) {
    throw new ProtectedInboxError(
      "invalid_argument",
      "Protected Inbox identifier digest is invalid.",
    );
  }
  return `${input.prefix}_${digest.slice(0, 32)}`;
}

export function protectedInboxQuotaId(input: {
  readonly workspaceId: string;
  readonly actorUid: string;
  readonly windowStartMs: number;
  readonly sha256Hex: Sha256Hex;
}): string {
  if (
    !validId(input.workspaceId) ||
    !validId(input.actorUid) ||
    !validNonNegativeSafeInteger(input.windowStartMs) ||
    input.windowStartMs % PROTECTED_INBOX_RATE_WINDOW_MS !== 0
  ) {
    throw new ProtectedInboxError(
      "invalid_argument",
      "Protected Inbox quota identity is invalid.",
    );
  }
  return deterministicProtectedInboxId({
    prefix: "protected_quota",
    components: [input.workspaceId, input.actorUid, input.windowStartMs],
    sha256Hex: input.sha256Hex,
  });
}

export function protectedInboxAuditId(input: {
  readonly workspaceId: string;
  readonly actorUid: string;
  readonly conversationId: string;
  readonly windowStartMs: number;
  readonly sha256Hex: Sha256Hex;
}): string {
  if (
    !validId(input.workspaceId) ||
    !validId(input.actorUid) ||
    !/^conversation_[a-z0-9_]{3,100}$/.test(input.conversationId) ||
    !validNonNegativeSafeInteger(input.windowStartMs) ||
    input.windowStartMs % PROTECTED_INBOX_RATE_WINDOW_MS !== 0
  ) {
    throw new ProtectedInboxError(
      "invalid_argument",
      "Protected Inbox audit identity is invalid.",
    );
  }
  return deterministicProtectedInboxId({
    prefix: "protected_access",
    components: [
      input.workspaceId,
      input.actorUid,
      input.conversationId,
      input.windowStartMs,
    ],
    sha256Hex: input.sha256Hex,
  });
}

function parseScopeIds(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const ids = value.filter((item): item is string => validId(item));
  if (ids.length !== value.length || new Set(ids).size !== ids.length) return null;
  return ids;
}

export type ProtectedInboxRequest = {
  readonly conversationId: string;
  readonly messageIds: readonly string[];
};

export function parseProtectedInboxRequest(value: unknown): ProtectedInboxRequest {
  const record = asRecord(value);
  if (!record || !hasExactKeys(record, ["conversationId", "messageIds"])) {
    throw new ProtectedInboxError(
      "invalid_argument",
      "Protected Inbox request fields are invalid.",
    );
  }
  const conversationId = record.conversationId;
  const messageIds = record.messageIds;
  if (
    typeof conversationId !== "string" ||
    !/^conversation_[a-z0-9_]{3,100}$/.test(conversationId) ||
    !Array.isArray(messageIds) ||
    messageIds.length < 1 ||
    messageIds.length > PROTECTED_INBOX_MAX_MESSAGES ||
    messageIds.some((messageId) =>
      typeof messageId !== "string" || !SAFE_MESSAGE_ID.test(messageId)
    ) ||
    new Set(messageIds).size !== messageIds.length
  ) {
    throw new ProtectedInboxError(
      "invalid_argument",
      "Protected Inbox conversation or message selection is invalid.",
    );
  }
  return { conversationId, messageIds };
}

export type ProtectedInboxAuthority = {
  readonly uid: string;
  readonly role: ProtectedInboxRole;
  readonly teamId: string;
  readonly locationId: string;
  readonly accessMode: ProtectedInboxAccessMode;
};

export function assertProtectedInboxAuthority(input: {
  readonly workspaceId: string;
  readonly authUid: unknown;
  readonly emailVerified: unknown;
  readonly workspace: unknown;
  readonly membership: unknown;
  readonly conversationId: string;
  readonly conversation: unknown;
}): ProtectedInboxAuthority {
  if (!validId(input.authUid) || input.emailVerified !== true) {
    throw new ProtectedInboxError(
      input.authUid ? "permission_denied" : "unauthenticated",
      "A verified Lite identity is required.",
    );
  }
  const uid = input.authUid;
  const workspace = asRecord(input.workspace);
  if (
    !workspace ||
    workspace.id !== input.workspaceId ||
    workspace.status !== "active" ||
    workspace.mode !== "demo" ||
    workspace.dataClassification !== "synthetic_only"
  ) {
    throw new ProtectedInboxError(
      "permission_denied",
      "The governed Lite workspace is unavailable.",
    );
  }

  const membership = asRecord(input.membership);
  const teamIds = parseScopeIds(membership?.teamIds);
  const locationIds = parseScopeIds(membership?.locationIds);
  const role = membership?.role;
  if (
    !membership ||
    membership.id !== uid ||
    membership.uid !== uid ||
    membership.workspaceId !== input.workspaceId ||
    membership.status !== "active" ||
    typeof role !== "string" ||
    !(PROTECTED_ROLES as readonly string[]).includes(role) ||
    !teamIds ||
    !locationIds
  ) {
    throw new ProtectedInboxError(
      "invalid_authority",
      "The current Lite membership is not authorized for protected content.",
    );
  }
  const protectedRole = role as ProtectedInboxRole;

  const conversation = asRecord(input.conversation);
  const teamId = conversation?.teamId;
  const locationId = conversation?.locationId;
  if (
    !conversation ||
    conversation.id !== input.conversationId ||
    conversation.workspaceId !== input.workspaceId ||
    !validId(teamId) ||
    !validId(locationId) ||
    conversation.liveCanary !== true ||
    conversation.synthetic !== true
  ) {
    throw new ProtectedInboxError(
      "invalid_conversation",
      "The selected conversation is not an eligible live canary conversation.",
    );
  }

  if (protectedRole === "tenant_admin") {
    return {
      uid,
      role: protectedRole,
      teamId,
      locationId,
      accessMode: "tenant_admin_workspace_wide",
    };
  }
  if (!teamIds.includes(teamId) || !locationIds.includes(locationId)) {
    throw new ProtectedInboxError(
      "permission_denied",
      "The selected conversation is outside the current seat scope.",
    );
  }
  if (protectedRole === "supervisor") {
    return {
      uid,
      role: protectedRole,
      teamId,
      locationId,
      accessMode: "supervisor_scoped",
    };
  }

  const assigneeId = conversation.assigneeId;
  if (assigneeId === null || assigneeId === undefined) {
    return {
      uid,
      role: protectedRole,
      teamId,
      locationId,
      accessMode: "agent_unassigned",
    };
  }
  if (assigneeId === uid) {
    return {
      uid,
      role: protectedRole,
      teamId,
      locationId,
      accessMode: "agent_assigned_self",
    };
  }
  throw new ProtectedInboxError(
    "permission_denied",
    "Protected content is available only to the owning agent or a supervisor.",
  );
}

export type ProtectedInboxQuotaDocument = {
  readonly id: string;
  readonly workspaceId: string;
  readonly actorUid: string;
  readonly requestCount: number;
  readonly limit: typeof PROTECTED_INBOX_RATE_LIMIT;
  readonly windowStartMs: number;
  readonly windowStartedAt: unknown;
  readonly lastRequestAt: unknown;
  readonly expiresAtMs: number;
  readonly expireAt: unknown;
  readonly containsMessageContent: false;
  readonly schemaVersion: 1;
};

const PROTECTED_INBOX_QUOTA_KEYS = [
  "id",
  "workspaceId",
  "actorUid",
  "requestCount",
  "limit",
  "windowStartMs",
  "windowStartedAt",
  "lastRequestAt",
  "expiresAtMs",
  "expireAt",
  "containsMessageContent",
  "schemaVersion",
] as const;

function validExistingProtectedInboxQuota(input: {
  readonly value: unknown;
  readonly id: string;
  readonly workspaceId: string;
  readonly actorUid: string;
  readonly window: ProtectedInboxAccessWindow;
}): boolean {
  const record = asRecord(input.value);
  return Boolean(
    record &&
    hasExactKeys(record, PROTECTED_INBOX_QUOTA_KEYS) &&
    record.id === input.id &&
    record.workspaceId === input.workspaceId &&
    record.actorUid === input.actorUid &&
    typeof record.requestCount === "number" &&
    Number.isInteger(record.requestCount) &&
    record.requestCount >= 1 &&
    record.requestCount <= PROTECTED_INBOX_RATE_LIMIT &&
    record.limit === PROTECTED_INBOX_RATE_LIMIT &&
    record.windowStartMs === input.window.windowStartMs &&
    timestampMillis(record.windowStartedAt) === input.window.windowStartMs &&
    timestampMillis(record.lastRequestAt) !== null &&
    (timestampMillis(record.lastRequestAt) as number) >= input.window.windowStartMs &&
    (timestampMillis(record.lastRequestAt) as number) < input.window.windowEndMs &&
    record.expiresAtMs === input.window.quotaExpiresAtMs &&
    timestampMillis(record.expireAt) === input.window.quotaExpiresAtMs &&
    record.containsMessageContent === false &&
    record.schemaVersion === 1,
  );
}

/**
 * Strict fixed-window transition. Call this after reading the deterministic
 * quota document inside the same Firestore transaction that returns content.
 * A concurrent call will retry against the incremented document.
 */
export function buildProtectedInboxQuotaTransition(input: {
  readonly existing: unknown;
  readonly id: string;
  readonly workspaceId: string;
  readonly actorUid: string;
  readonly window: ProtectedInboxAccessWindow;
  readonly windowStartedAt: unknown;
  readonly occurredAt: unknown;
  readonly expireAt: unknown;
}): ProtectedInboxQuotaDocument {
  assertCanonicalAccessWindow(input.window);
  if (
    !/^protected_quota_[0-9a-f]{32}$/.test(input.id) ||
    !validId(input.workspaceId) ||
    !validId(input.actorUid)
  ) {
    throw new ProtectedInboxError(
      "invalid_argument",
      "Protected Inbox quota evidence is invalid.",
    );
  }
  assertTimestampAt(
    input.windowStartedAt,
    input.window.windowStartMs,
    "Protected Inbox quota window timestamp is invalid.",
  );
  const occurredAtMs = timestampMillis(input.occurredAt);
  if (
    occurredAtMs === null ||
    occurredAtMs < input.window.windowStartMs ||
    occurredAtMs >= input.window.windowEndMs
  ) {
    throw new ProtectedInboxError(
      "invalid_argument",
      "Protected Inbox quota request timestamp is invalid.",
    );
  }
  assertTimestampAt(
    input.expireAt,
    input.window.quotaExpiresAtMs,
    "Protected Inbox quota expiry is invalid.",
  );

  let requestCount = 1;
  let persistedWindowStartedAt = input.windowStartedAt;
  let persistedExpireAt = input.expireAt;
  if (input.existing !== undefined) {
    if (!validExistingProtectedInboxQuota({
      value: input.existing,
      id: input.id,
      workspaceId: input.workspaceId,
      actorUid: input.actorUid,
      window: input.window,
    })) {
      throw new ProtectedInboxError(
        "invalid_authority",
        "Protected Inbox quota evidence is malformed.",
      );
    }
    const existing = input.existing as ProtectedInboxQuotaDocument;
    if (existing.requestCount >= PROTECTED_INBOX_RATE_LIMIT) {
      throw new ProtectedInboxError(
        "resource_exhausted",
        "Protected Inbox access limit reached. Try again in the next minute.",
      );
    }
    requestCount = existing.requestCount + 1;
    persistedWindowStartedAt = existing.windowStartedAt;
    persistedExpireAt = existing.expireAt;
  }

  return {
    id: input.id,
    workspaceId: input.workspaceId,
    actorUid: input.actorUid,
    requestCount,
    limit: PROTECTED_INBOX_RATE_LIMIT,
    windowStartMs: input.window.windowStartMs,
    windowStartedAt: persistedWindowStartedAt,
    lastRequestAt: input.occurredAt,
    expiresAtMs: input.window.quotaExpiresAtMs,
    expireAt: persistedExpireAt,
    containsMessageContent: false,
    schemaVersion: 1,
  };
}

export type CoalescedProtectedMessageAccessAudit = {
  readonly id: string;
  readonly workspaceId: string;
  readonly actorUid: string;
  readonly actorRole: ProtectedInboxRole;
  readonly conversationId: string;
  readonly teamId: string;
  readonly locationId: string;
  readonly action: "conversation.protected_text_viewed";
  readonly accessMode: ProtectedInboxAccessMode;
  readonly outcome: "allowed";
  readonly requestCount: number;
  readonly recordCount: number;
  readonly purpose: "canary_support";
  readonly containsMessageContent: false;
  readonly windowStartMs: number;
  readonly windowStartedAt: unknown;
  readonly firstOccurredAt: unknown;
  readonly lastOccurredAt: unknown;
  readonly expiresAtMs: number;
  readonly expireAt: unknown;
  readonly schemaVersion: 2;
};

const PROTECTED_INBOX_AUDIT_KEYS = [
  "id",
  "workspaceId",
  "actorUid",
  "actorRole",
  "conversationId",
  "teamId",
  "locationId",
  "action",
  "accessMode",
  "outcome",
  "requestCount",
  "recordCount",
  "purpose",
  "containsMessageContent",
  "windowStartMs",
  "windowStartedAt",
  "firstOccurredAt",
  "lastOccurredAt",
  "expiresAtMs",
  "expireAt",
  "schemaVersion",
] as const;

function validExistingProtectedInboxAudit(input: {
  readonly value: unknown;
  readonly id: string;
  readonly workspaceId: string;
  readonly authority: ProtectedInboxAuthority;
  readonly conversationId: string;
  readonly window: ProtectedInboxAccessWindow;
}): boolean {
  const record = asRecord(input.value);
  const firstOccurredAtMs = timestampMillis(record?.firstOccurredAt);
  const lastOccurredAtMs = timestampMillis(record?.lastOccurredAt);
  return Boolean(
    record &&
    hasExactKeys(record, PROTECTED_INBOX_AUDIT_KEYS) &&
    record.id === input.id &&
    record.workspaceId === input.workspaceId &&
    record.actorUid === input.authority.uid &&
    record.actorRole === input.authority.role &&
    record.conversationId === input.conversationId &&
    record.teamId === input.authority.teamId &&
    record.locationId === input.authority.locationId &&
    record.action === "conversation.protected_text_viewed" &&
    record.accessMode === input.authority.accessMode &&
    record.outcome === "allowed" &&
    typeof record.requestCount === "number" &&
    Number.isInteger(record.requestCount) &&
    record.requestCount >= 1 &&
    record.requestCount <= PROTECTED_INBOX_RATE_LIMIT &&
    typeof record.recordCount === "number" &&
    Number.isInteger(record.recordCount) &&
    record.recordCount >= 0 &&
    record.recordCount <= PROTECTED_INBOX_MAX_MESSAGES * PROTECTED_INBOX_RATE_LIMIT &&
    record.purpose === "canary_support" &&
    record.containsMessageContent === false &&
    record.windowStartMs === input.window.windowStartMs &&
    timestampMillis(record.windowStartedAt) === input.window.windowStartMs &&
    firstOccurredAtMs !== null &&
    firstOccurredAtMs >= input.window.windowStartMs &&
    firstOccurredAtMs < input.window.windowEndMs &&
    lastOccurredAtMs !== null &&
    lastOccurredAtMs >= firstOccurredAtMs &&
    lastOccurredAtMs < input.window.windowEndMs &&
    record.expiresAtMs === input.window.auditExpiresAtMs &&
    timestampMillis(record.expireAt) === input.window.auditExpiresAtMs &&
    record.schemaVersion === 2,
  );
}

/** Coalesces one actor/conversation/minute into a content-free audit record. */
export function buildCoalescedProtectedMessageAccessAudit(input: {
  readonly existing: unknown;
  readonly id: string;
  readonly workspaceId: string;
  readonly authority: ProtectedInboxAuthority;
  readonly conversationId: string;
  readonly recordCount: number;
  readonly window: ProtectedInboxAccessWindow;
  readonly windowStartedAt: unknown;
  readonly occurredAt: unknown;
  readonly expireAt: unknown;
}): CoalescedProtectedMessageAccessAudit {
  assertCanonicalAccessWindow(input.window);
  if (
    !/^protected_access_[0-9a-f]{32}$/.test(input.id) ||
    !validId(input.workspaceId) ||
    !/^conversation_[a-z0-9_]{3,100}$/.test(input.conversationId) ||
    !Number.isInteger(input.recordCount) ||
    input.recordCount < 0 ||
    input.recordCount > PROTECTED_INBOX_MAX_MESSAGES
  ) {
    throw new ProtectedInboxError(
      "invalid_argument",
      "Protected Inbox audit evidence is invalid.",
    );
  }
  assertTimestampAt(
    input.windowStartedAt,
    input.window.windowStartMs,
    "Protected Inbox audit window timestamp is invalid.",
  );
  const occurredAtMs = timestampMillis(input.occurredAt);
  if (
    occurredAtMs === null ||
    occurredAtMs < input.window.windowStartMs ||
    occurredAtMs >= input.window.windowEndMs
  ) {
    throw new ProtectedInboxError(
      "invalid_argument",
      "Protected Inbox audit occurrence timestamp is invalid.",
    );
  }
  assertTimestampAt(
    input.expireAt,
    input.window.auditExpiresAtMs,
    "Protected Inbox audit expiry is invalid.",
  );

  let requestCount = 1;
  let aggregateRecordCount = input.recordCount;
  let windowStartedAt = input.windowStartedAt;
  let firstOccurredAt = input.occurredAt;
  let expireAt = input.expireAt;
  if (input.existing !== undefined) {
    if (!validExistingProtectedInboxAudit({
      value: input.existing,
      id: input.id,
      workspaceId: input.workspaceId,
      authority: input.authority,
      conversationId: input.conversationId,
      window: input.window,
    })) {
      throw new ProtectedInboxError(
        "invalid_authority",
        "Protected Inbox audit evidence is malformed.",
      );
    }
    const existing = input.existing as CoalescedProtectedMessageAccessAudit;
    if (existing.requestCount >= PROTECTED_INBOX_RATE_LIMIT) {
      throw new ProtectedInboxError(
        "resource_exhausted",
        "Protected Inbox access audit limit reached.",
      );
    }
    requestCount = existing.requestCount + 1;
    aggregateRecordCount = existing.recordCount + input.recordCount;
    windowStartedAt = existing.windowStartedAt;
    firstOccurredAt = existing.firstOccurredAt;
    expireAt = existing.expireAt;
  }

  return {
    id: input.id,
    workspaceId: input.workspaceId,
    actorUid: input.authority.uid,
    actorRole: input.authority.role,
    conversationId: input.conversationId,
    teamId: input.authority.teamId,
    locationId: input.authority.locationId,
    action: "conversation.protected_text_viewed",
    accessMode: input.authority.accessMode,
    outcome: "allowed",
    requestCount,
    recordCount: aggregateRecordCount,
    purpose: "canary_support",
    containsMessageContent: false,
    windowStartMs: input.window.windowStartMs,
    windowStartedAt,
    firstOccurredAt,
    lastOccurredAt: input.occurredAt,
    expiresAtMs: input.window.auditExpiresAtMs,
    expireAt,
    schemaVersion: 2,
  };
}

export type ProtectedMessageAccessAudit = {
  readonly id: string;
  readonly workspaceId: string;
  readonly actorUid: string;
  readonly actorRole: ProtectedInboxRole;
  readonly conversationId: string;
  readonly teamId: string;
  readonly locationId: string;
  readonly action: "conversation.protected_text_viewed";
  readonly accessMode: ProtectedInboxAccessMode;
  readonly outcome: "allowed";
  readonly recordCount: number;
  readonly purpose: "canary_support";
  readonly containsMessageContent: false;
  readonly occurredAt: unknown;
  readonly schemaVersion: 1;
};

export function buildProtectedMessageAccessAudit(input: {
  readonly id: string;
  readonly workspaceId: string;
  readonly authority: ProtectedInboxAuthority;
  readonly conversationId: string;
  readonly recordCount: number;
  readonly occurredAt: unknown;
}): ProtectedMessageAccessAudit {
  if (
    !/^protected_access_[0-9a-f]{32}$/.test(input.id) ||
    !validId(input.workspaceId) ||
    !/^conversation_[a-z0-9_]{3,100}$/.test(input.conversationId) ||
    !Number.isInteger(input.recordCount) ||
    input.recordCount < 0 ||
    input.recordCount > PROTECTED_INBOX_MAX_MESSAGES
  ) {
    throw new ProtectedInboxError(
      "invalid_argument",
      "Protected Inbox audit evidence is invalid.",
    );
  }
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    actorUid: input.authority.uid,
    actorRole: input.authority.role,
    conversationId: input.conversationId,
    teamId: input.authority.teamId,
    locationId: input.authority.locationId,
    action: "conversation.protected_text_viewed",
    accessMode: input.authority.accessMode,
    outcome: "allowed",
    recordCount: input.recordCount,
    purpose: "canary_support",
    containsMessageContent: false,
    occurredAt: input.occurredAt,
    schemaVersion: 1,
  };
}
