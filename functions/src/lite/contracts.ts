/**
 * Hemas Connect LITE — pure contracts.
 *
 * The Lite lane is the "simple product" face of the same governed engine:
 * a small multi-agent portal (seats, claiming, live replies) on top of the
 * live canary conversations. Everything here is deterministic and pure so
 * the governance rules are testable without Firebase:
 *
 * - Seats are fixed synthetic identities (\@lite.synthetic.invalid) that map
 *   onto the existing workspace membership model (role agent/supervisor,
 *   demo team + location scope) — the deny-by-default Firestore rules then
 *   grant them exactly the scoped reads the enterprise inbox already uses.
 * - Agent replies can only be routed to numbers on the explicit canary
 *   allowlist: the phone number is recovered by hashing each allowlisted
 *   number and comparing with the conversation key, so no reverse mapping
 *   of visitor numbers is ever stored anywhere.
 * - Reply text is validated in memory, sent to Meta, and recorded as a
 *   content-free ledger entry (hash + length only) — never the body.
 */

export const LITE_WORKSPACE_ID = "workspace_safenet_demo";
export const LITE_TEAM_ID = "team_demo_general";
export const LITE_LOCATION_ID = "location_demo_wattala";
export const LITE_AGENT_REPLIES_COLLECTION = "canary_agent_replies";
export const LITE_REPLY_LEASES_COLLECTION = "canary_reply_leases";
export const LITE_REPLY_OPERATIONS_COLLECTION = "canary_reply_operations";
export const LITE_REPLY_RECONCILIATIONS_COLLECTION = "canary_reply_reconciliations";
export const LITE_REPLY_SEND_STALE_MS = 5 * 60 * 1_000;

export const LITE_MAX_REPLY_LENGTH = 1024;

function customClaims(raw: unknown): Record<string, unknown> | null {
  return typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : null;
}

/** Exact booleans only; every privileged Lite token must also be verified. */
export function hasLiteCanarySendClaim(rawToken: unknown): boolean {
  const claims = customClaims(rawToken);
  return claims?.email_verified === true && claims.hemasLiteCanary === true;
}

export function hasLiteAdminSetupClaim(rawToken: unknown): boolean {
  const claims = customClaims(rawToken);
  return claims?.email_verified === true && claims.hemasLiteAdmin === true;
}

/** Token claims never replace the caller's current server-side admin membership. */
export function isActiveLiteTenantAdminMembership(
  raw: unknown,
  uid: string,
): boolean {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
  const member = raw as Record<string, unknown>;
  return (
    Boolean(uid) &&
    member.id === uid &&
    member.uid === uid &&
    member.workspaceId === LITE_WORKSPACE_ID &&
    member.status === "active" &&
    member.role === "tenant_admin"
  );
}

export type LiteSeatRole = "agent" | "supervisor";

export interface LiteSeat {
  readonly email: string;
  readonly displayLabel: string;
  readonly role: LiteSeatRole;
}

/** Three seats = the "Multi-Agent / Agent Portals" rows on the pricing sheet. */
export const LITE_SEATS: readonly LiteSeat[] = [
  {
    email: "agent1@lite.synthetic.invalid",
    displayLabel: "Nimali — Lite Agent 1 (synthetic)",
    role: "agent",
  },
  {
    email: "agent2@lite.synthetic.invalid",
    displayLabel: "Kavith — Lite Agent 2 (synthetic)",
    role: "agent",
  },
  {
    email: "supervisor@lite.synthetic.invalid",
    displayLabel: "Shalini — Lite Supervisor (synthetic)",
    role: "supervisor",
  },
] as const;

/**
 * Membership document matching the client parser (`membershipDocumentSchema`)
 * and the Firestore rules (`activeWorkspaceMember`) exactly.
 */
export function buildLiteMemberDocument(
  uid: string,
  seat: LiteSeat,
): Record<string, unknown> {
  return {
    id: uid,
    uid,
    workspaceId: LITE_WORKSPACE_ID,
    displayLabel: seat.displayLabel,
    role: seat.role,
    status: "active",
    scopeMode: "assigned",
    teamIds: [LITE_TEAM_ID],
    locationIds: [LITE_LOCATION_ID],
    synthetic: true,
  };
}

export type LiteErrorCode =
  | "invalid_text"
  | "invalid_conversation"
  | "contact_blocked"
  | "invalid_routing_state"
  | "already_assigned"
  | "not_assignee"
  | "invalid_operation"
  | "operation_terminal"
  | "reply_in_progress"
  | "invalid_evidence"
  | "reconciliation_conflict"
  | "not_live"
  | "window_expired"
  | "route_not_allowlisted";

export class LiteError extends Error {
  constructor(
    readonly code: LiteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LiteError";
  }
}

/** Trimmed, bounded, control-character-free reply text (in-memory only). */
export function assertValidReplyText(raw: unknown): string {
  const text = typeof raw === "string" ? raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim() : "";
  if (!text) {
    throw new LiteError("invalid_text", "Reply text is required.");
  }
  if (text.length > LITE_MAX_REPLY_LENGTH) {
    throw new LiteError(
      "invalid_text",
      `Reply text exceeds ${LITE_MAX_REPLY_LENGTH} characters.`,
    );
  }
  return text;
}

const LIVE_CONVERSATION_PREFIX = "conversation_live_";

/** Extract the 10-char visitor key from a live conversation id. */
export function liveConversationKey(conversationId: unknown): string {
  const id = typeof conversationId === "string" ? conversationId.trim() : "";
  if (!id.startsWith(LIVE_CONVERSATION_PREFIX)) {
    throw new LiteError("invalid_conversation", "Only live conversations can be routed.");
  }
  const key = id.slice(LIVE_CONVERSATION_PREFIX.length);
  if (!/^[0-9a-f]{10}$/.test(key)) {
    throw new LiteError("invalid_conversation", "Malformed live conversation id.");
  }
  return key;
}

/**
 * Recover the destination number for a live conversation WITHOUT any stored
 * reverse mapping: hash every allowlisted number the same way the bridge
 * derives conversation keys and pick the match. Replies are therefore
 * provably limited to the explicit ≤5-number canary allowlist.
 */
export function resolveAllowlistedWaId(
  conversationKey: string,
  allowlist: readonly string[],
  sha256Hex: (value: string) => string,
): string | null {
  for (const entry of allowlist) {
    const digits = entry.replace(/\D/g, "");
    if (!digits) continue;
    if (sha256Hex(`live:${digits}`).slice(0, 10) === conversationKey) {
      return digits;
    }
  }
  return null;
}

/** WhatsApp free-form text payload for an agent reply (service window only). */
export function buildAgentReplyBody(text: string): Record<string, unknown> {
  return { type: "text", text: { preview_url: false, body: text } };
}

const LITE_SUPPRESSION_REASONS = new Set([
  "stop_keyword",
  "manual_withdrawal",
  "complaint",
  "invalid_number",
  "guardian_authority_missing",
  "clinical_hold",
]);

export type LiteServiceReplyContactPolicy =
  | { readonly eligible: true }
  | {
      readonly eligible: false;
      readonly reason: "contact_invalid" | "suppress_all" | "invalid_contact";
    };

/**
 * Service replies ignore marketing-only withdrawal, but fail closed on an
 * invalid canonical contact or either all-channel delivery hold.
 */
export function evaluateLiteServiceReplyContactPolicy(
  raw: unknown,
  expectedContactId: string,
): LiteServiceReplyContactPolicy {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { eligible: false, reason: "contact_invalid" };
  }
  const contact = raw as Record<string, unknown>;
  if (
    contact.id !== expectedContactId ||
    contact.workspaceId !== LITE_WORKSPACE_ID ||
    contact.synthetic !== true ||
    contact.liveCanary !== true ||
    !Array.isArray(contact.tags) ||
    typeof contact.suppression !== "object" ||
    contact.suppression === null ||
    Array.isArray(contact.suppression)
  ) {
    return { eligible: false, reason: "contact_invalid" };
  }
  const suppression = contact.suppression as Record<string, unknown>;
  const suppressionKeys = Object.keys(suppression);
  const reasons = suppression.reasons;
  const updatedAt = suppression.updatedAt as { toDate?: unknown } | undefined;
  if (
    suppressionKeys.length !== 5 ||
    !suppressionKeys.every((key) =>
      ["suppressAll", "suppressMarketing", "invalidContact", "reasons", "updatedAt"].includes(key)
    ) ||
    typeof suppression.suppressAll !== "boolean" ||
    typeof suppression.suppressMarketing !== "boolean" ||
    typeof suppression.invalidContact !== "boolean" ||
    !Array.isArray(reasons) ||
    reasons.length > LITE_SUPPRESSION_REASONS.size ||
    !reasons.every(
      (reason) => typeof reason === "string" && LITE_SUPPRESSION_REASONS.has(reason),
    ) ||
    new Set(reasons).size !== reasons.length ||
    typeof updatedAt !== "object" ||
    updatedAt === null ||
    typeof updatedAt.toDate !== "function"
  ) {
    return { eligible: false, reason: "contact_invalid" };
  }
  if (suppression.suppressAll) {
    return { eligible: false, reason: "suppress_all" };
  }
  if (suppression.invalidContact) {
    return { eligible: false, reason: "invalid_contact" };
  }
  return { eligible: true };
}

export type LiteConversationAction = "claim" | "release";

export function assertLiteAction(raw: unknown): LiteConversationAction {
  if (raw === "claim" || raw === "release") return raw;
  throw new LiteError("invalid_conversation", "Action must be 'claim' or 'release'.");
}

function normalizedAssignee(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  throw new LiteError("invalid_routing_state", "The conversation assignment is invalid.");
}

/**
 * Pure ownership gate used inside the Firestore routing transaction.
 * Transaction retries make two simultaneous claims re-evaluate this policy
 * against the committed owner, so only one different agent can win.
 */
export function assertLiteRoutingActionAllowed(
  action: LiteConversationAction,
  currentAssigneeId: unknown,
  memberUid: string,
): void {
  const currentAssignee = normalizedAssignee(currentAssigneeId);
  if (action === "claim") {
    if (currentAssignee !== null && currentAssignee !== memberUid) {
      throw new LiteError("already_assigned", "This conversation is assigned to another agent.");
    }
    return;
  }
  if (currentAssignee !== memberUid) {
    throw new LiteError("not_assignee", "Only the assigned agent can release this conversation.");
  }
}

export interface LiteReplyRoutingState {
  readonly assigneeId?: unknown;
  readonly status?: unknown;
  readonly mode?: unknown;
}

/** Require an explicit, active human assignment before any provider send. */
export function assertLiteReplyOwnership(
  conversation: LiteReplyRoutingState,
  memberUid: string,
): void {
  if (normalizedAssignee(conversation.assigneeId) !== memberUid) {
    throw new LiteError("not_assignee", "Claim this conversation before replying.");
  }
  if (conversation.status !== "assigned" || conversation.mode !== "human_takeover") {
    throw new LiteError(
      "invalid_routing_state",
      "The conversation is not in an assigned human-takeover state.",
    );
  }
}

export function assertLiteReplyOperationId(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!/^reply_[A-Za-z0-9_-]{16,80}$/.test(value)) {
    throw new LiteError("invalid_operation", "The reply operation id is invalid.");
  }
  return value;
}

export type LiteReplyOperationDecision =
  | { readonly kind: "reserve" }
  | { readonly kind: "already_sent"; readonly providerMessageId: string };

function replyLeaseRecord(raw: unknown): Record<string, unknown> | null {
  return typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : null;
}

/** Routing stays frozen while a provider result is pending or uncertain. */
export function assertNoActiveLiteReplyLease(raw: unknown): void {
  const lease = replyLeaseRecord(raw);
  if (!lease) return;
  if (
    (lease.status === "idle" &&
      (lease.activeOperationId === null || lease.activeOperationId === undefined)) ||
    lease.status === "sent" ||
    lease.status === "failed"
  ) return;
  throw new LiteError(
    "reply_in_progress",
    "A live reply is still sending or needs reconciliation before routing can change.",
  );
}

/**
 * Decide from the durable per-operation record, not the mutable conversation
 * lock. Historical successful operations therefore remain idempotent after
 * later replies have used the same conversation.
 */
export function decideLiteReplyOperation(
  raw: unknown,
  operationId: string,
  conversationId: string,
  actorUid: string,
  bodySha256: string,
): LiteReplyOperationDecision {
  const operation = replyLeaseRecord(raw);
  if (!operation) return { kind: "reserve" };
  if (
    operation.operationId !== operationId ||
    operation.conversationId !== conversationId ||
    operation.actorUid !== actorUid ||
    operation.bodySha256 !== bodySha256
  ) {
    throw new LiteError("invalid_operation", "The reply operation does not match its durable reservation.");
  }
  if (
    operation.status === "sent" &&
    typeof operation.providerMessageId === "string" &&
    operation.providerMessageId.length > 0
  ) {
    return { kind: "already_sent", providerMessageId: operation.providerMessageId };
  }
  if (operation.status === "not_sent") {
    throw new LiteError(
      "operation_terminal",
      "This reply operation was reconciled as not sent and cannot be retried.",
    );
  }
  if (operation.status !== "sending" && operation.status !== "send_uncertain") {
    throw new LiteError("invalid_evidence", "The reply operation evidence is malformed.");
  }
  throw new LiteError(
    "reply_in_progress",
    "A live reply is still sending or needs reconciliation before another send.",
  );
}

export interface LiteReplyReconciliationInput {
  readonly conversationId: string;
  readonly operationId: string;
  readonly outcome: "sent" | "not_sent";
  readonly providerMessageId: string | null;
  readonly providerEvidenceSha256: string;
}

/** Exact, content-free evidence supplied only after a private provider lookup. */
export function assertLiteReplyReconciliationInput(
  raw: unknown,
): LiteReplyReconciliationInput {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new LiteError("invalid_evidence", "Reply reconciliation evidence is required.");
  }
  const value = raw as Record<string, unknown>;
  const allowed = new Set([
    "conversationId",
    "operationId",
    "outcome",
    "providerMessageId",
    "providerEvidenceSha256",
  ]);
  if (
    Object.keys(value).length !== allowed.size ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    throw new LiteError("invalid_evidence", "Reply reconciliation contains unsupported fields.");
  }
  const conversationId = typeof value.conversationId === "string" ? value.conversationId.trim() : "";
  liveConversationKey(conversationId);
  const operationId = assertLiteReplyOperationId(value.operationId);
  const outcome = value.outcome;
  if (outcome !== "sent" && outcome !== "not_sent") {
    throw new LiteError("invalid_evidence", "Provider outcome must be sent or not_sent.");
  }
  const providerEvidenceSha256 =
    typeof value.providerEvidenceSha256 === "string"
      ? value.providerEvidenceSha256.trim()
      : "";
  if (!/^[0-9a-f]{64}$/.test(providerEvidenceSha256)) {
    throw new LiteError("invalid_evidence", "Provider evidence must be a SHA-256 digest.");
  }
  const providerMessageId =
    typeof value.providerMessageId === "string" ? value.providerMessageId.trim() : null;
  if (
    (outcome === "sent" &&
      (providerMessageId === null ||
        providerMessageId.length < 8 ||
        providerMessageId.length > 512 ||
        !/^[A-Za-z0-9._:-]+$/.test(providerMessageId))) ||
    (outcome === "not_sent" && providerMessageId !== null)
  ) {
    throw new LiteError(
      "invalid_evidence",
      "Provider message evidence does not match the declared outcome.",
    );
  }
  return {
    conversationId,
    operationId,
    outcome,
    providerMessageId,
    providerEvidenceSha256,
  };
}

export type LiteReplyReconciliationDecision =
  | { readonly kind: "apply" }
  | { readonly kind: "already_reconciled" };

/**
 * Reconciliation never authorizes a provider retry. It only turns an active,
 * exact operation/lock pair into terminal evidence after an operator supplies
 * a separately obtained provider-outcome digest.
 */
export function decideLiteReplyReconciliation(
  rawOperation: unknown,
  rawLease: unknown,
  input: LiteReplyReconciliationInput,
  nowMs: number,
): LiteReplyReconciliationDecision {
  const operation = replyLeaseRecord(rawOperation);
  const lease = replyLeaseRecord(rawLease);
  if (!operation || !lease) {
    throw new LiteError("invalid_evidence", "Reply operation or routing lock is missing.");
  }
  if (
    operation.operationId !== input.operationId ||
    operation.conversationId !== input.conversationId
  ) {
    throw new LiteError("reconciliation_conflict", "Reply operation identity does not match.");
  }

  const expectedStatus = input.outcome === "sent" ? "sent" : "not_sent";
  if (operation.status === "sent" || operation.status === "not_sent") {
    if (
      operation.status === expectedStatus &&
      operation.reconciliationEvidenceSha256 === input.providerEvidenceSha256 &&
      (input.outcome === "not_sent" || operation.providerMessageId === input.providerMessageId)
    ) {
      return { kind: "already_reconciled" };
    }
    throw new LiteError(
      "reconciliation_conflict",
      "Reply operation already has different terminal evidence.",
    );
  }
  if (operation.status !== "sending" && operation.status !== "send_uncertain") {
    throw new LiteError("invalid_evidence", "Reply operation is not reconcilable.");
  }
  if (
    lease.activeOperationId !== input.operationId ||
    (lease.status !== "sending" && lease.status !== "send_uncertain")
  ) {
    throw new LiteError(
      "reconciliation_conflict",
      "Routing lock does not match the reply operation.",
    );
  }
  if (operation.status === "sending" || lease.status === "sending") {
    const operationUpdatedAt = timestampMillis(operation.updatedAt);
    const leaseUpdatedAt = timestampMillis(lease.updatedAt);
    if (
      operationUpdatedAt === null ||
      leaseUpdatedAt === null ||
      operationUpdatedAt > nowMs - LITE_REPLY_SEND_STALE_MS ||
      leaseUpdatedAt > nowMs - LITE_REPLY_SEND_STALE_MS
    ) {
      throw new LiteError(
        "reply_in_progress",
        "The reply may still be sending; wait for the stale-send boundary.",
      );
    }
  }
  return { kind: "apply" };
}

function timestampMillis(raw: unknown): number | null {
  if (typeof raw !== "object" || raw === null) return null;
  const toMillis = (raw as { toMillis?: unknown }).toMillis;
  if (typeof toMillis !== "function") return null;
  const value = (toMillis as () => unknown).call(raw);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
