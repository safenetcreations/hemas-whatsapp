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

export const LITE_MAX_REPLY_LENGTH = 1024;

export type LiteSeatRole = "agent" | "supervisor";

export interface LiteSeat {
  readonly email: string;
  readonly displayLabel: string;
  /** Fixed demo password — synthetic-only workspace, shown on the Lite login screen. */
  readonly password: string;
  readonly role: LiteSeatRole;
}

/** Three seats = the "Multi-Agent / Agent Portals" rows on the pricing sheet. */
export const LITE_SEATS: readonly LiteSeat[] = [
  {
    email: "agent1@lite.synthetic.invalid",
    displayLabel: "Nimali — Lite Agent 1 (synthetic)",
    password: "LiteAgent1!Demo",
    role: "agent",
  },
  {
    email: "agent2@lite.synthetic.invalid",
    displayLabel: "Kavith — Lite Agent 2 (synthetic)",
    password: "LiteAgent2!Demo",
    role: "agent",
  },
  {
    email: "supervisor@lite.synthetic.invalid",
    displayLabel: "Shalini — Lite Supervisor (synthetic)",
    password: "LiteSuper1!Demo",
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

export type LiteConversationAction = "claim" | "release";

export function assertLiteAction(raw: unknown): LiteConversationAction {
  if (raw === "claim" || raw === "release") return raw;
  throw new LiteError("invalid_conversation", "Action must be 'claim' or 'release'.");
}
