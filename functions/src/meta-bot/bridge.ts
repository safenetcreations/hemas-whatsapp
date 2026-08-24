import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { sha256Hex } from "../deterministic.js";
import type { BotBooking, BotLanguage, BotSession } from "./engine.js";
import { FRESH_BOT_SESSION } from "./engine.js";

/**
 * Live canary INBOX BRIDGE.
 *
 * Mirrors real governed canary conversations into the same
 * Firestore shapes the portal inbox already renders for the synthetic seed:
 * contacts, conversations and metadata-only messages. Exact eligible canary
 * text is isolated in a separate backend-only, short-retention collection;
 * these bridge documents contain direction/type/language/timestamps only.
 */

export const BRIDGE_WORKSPACE_ID = "workspace_safenet_demo";
const TEAM_GENERAL = "team_demo_general";
const LOCATION_WATTALA = "location_demo_wattala";
const CONNECTION_SIMULATOR = "connection_demo_simulator";

const SESSIONS = "canary_bot_sessions";
const BOOKINGS = "canary_bookings";

const CANONICAL_CONTACT_TAGS = [
  "appointment",
  "laboratory",
  "package",
  "human-handoff",
  "urgent-simulation",
  "marketing-suppressed",
] as const;
type CanonicalContactTag = (typeof CANONICAL_CONTACT_TAGS)[number];

const SUPPRESSION_REASONS = [
  "stop_keyword",
  "manual_withdrawal",
  "complaint",
  "invalid_number",
  "guardian_authority_missing",
  "clinical_hold",
] as const;

function isTimestamp(value: unknown): value is Timestamp {
  return value instanceof Timestamp;
}

function canonicalTags(
  raw: unknown,
  additions: readonly CanonicalContactTag[],
): CanonicalContactTag[] {
  const allowed = new Set<string>(CANONICAL_CONTACT_TAGS);
  const selected = new Set<CanonicalContactTag>();
  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (typeof value === "string" && allowed.has(value)) {
        selected.add(value as CanonicalContactTag);
      }
    }
  }
  for (const value of additions) selected.add(value);
  return CANONICAL_CONTACT_TAGS.filter((value) => selected.has(value));
}

function canonicalSuppression(raw: unknown, now: Timestamp): Record<string, unknown> {
  if (typeof raw === "object" && raw !== null) {
    const value = raw as Record<string, unknown>;
    const reasons = Array.isArray(value.reasons) ? value.reasons : [];
    const allowedReasons = new Set<string>(SUPPRESSION_REASONS);
    if (
      typeof value.suppressAll === "boolean" &&
      typeof value.suppressMarketing === "boolean" &&
      typeof value.invalidContact === "boolean" &&
      reasons.length <= SUPPRESSION_REASONS.length &&
      reasons.every((reason) => typeof reason === "string" && allowedReasons.has(reason)) &&
      new Set(reasons).size === reasons.length &&
      isTimestamp(value.updatedAt)
    ) {
      return {
        suppressAll: value.suppressAll,
        suppressMarketing: value.suppressMarketing,
        invalidContact: value.invalidContact,
        reasons,
        updatedAt: value.updatedAt,
      };
    }
  }
  return {
    suppressAll: false,
    suppressMarketing: false,
    invalidContact: false,
    reasons: [],
    updatedAt: now,
  };
}

export interface LiveContactDocumentInput {
  readonly contactId: string;
  readonly last4: string;
  readonly language: BotLanguage;
  readonly nowMs: number;
  readonly existing?: Record<string, unknown>;
  readonly addTags?: readonly CanonicalContactTag[];
}

/** Complete Full/Lite-compatible contact document; never a partial merge. */
export function buildLiveContactDocument(input: LiveContactDocumentInput): Record<string, unknown> {
  const now = Timestamp.fromMillis(input.nowMs);
  const existing = input.existing ?? {};
  const existingLanguage = existing.preferredLanguage;
  const preferredLanguage =
    existingLanguage === "en" || existingLanguage === "si" || existingLanguage === "ta"
      ? existingLanguage
      : input.language;
  const alternateLanguages = Array.isArray(existing.alternateLanguages)
    ? existing.alternateLanguages.filter(
        (value): value is BotLanguage =>
          (value === "en" || value === "si" || value === "ta") && value !== preferredLanguage,
      ).slice(0, 2)
    : [];
  const preferenceRevision =
    typeof existing.preferenceRevision === "number" &&
    Number.isInteger(existing.preferenceRevision) &&
    existing.preferenceRevision >= 0 &&
    existing.preferenceRevision <= 1_000_000_000
      ? existing.preferenceRevision
      : 0;
  return {
    id: input.contactId,
    workspaceId: BRIDGE_WORKSPACE_ID,
    teamId: TEAM_GENERAL,
    locationId: LOCATION_WATTALA,
    maskedPhone: `Live canary visitor ···${input.last4} · number withheld`,
    displayLabel: `Live WhatsApp visitor ···${input.last4}`,
    preferredLanguage,
    alternateLanguages: [...new Set(alternateLanguages)],
    suppression: canonicalSuppression(existing.suppression, now),
    tags: canonicalTags(existing.tags, input.addTags ?? []),
    preferenceRevision,
    synthetic: true,
    liveCanary: true,
    createdAt: isTimestamp(existing.createdAt) ? existing.createdAt : now,
    updatedAt: now,
  };
}

export interface LiveConversationDocumentInput {
  readonly contactId: string;
  readonly conversationId: string;
  readonly message: BridgeMessageInput;
  readonly nowMs: number;
  readonly existing?: Record<string, unknown>;
}

/** Complete Full/Lite-compatible conversation document preserving ownership. */
export function buildLiveConversationDocument(
  input: LiveConversationDocumentInput,
): Record<string, unknown> {
  const now = Timestamp.fromMillis(input.nowMs);
  const existing = input.existing ?? {};
  const language = input.message.language ?? "en";
  const assigneeId =
    typeof existing.assigneeId === "string" && existing.assigneeId.trim()
      ? existing.assigneeId.trim()
      : null;
  const existingUnassignedHandoff =
    existing.mode === "human_takeover" &&
    existing.status === "assigned" &&
    existing.assigneeId === null;
  const humanTakeover =
    assigneeId !== null || existingUnassignedHandoff || input.message.staffHandoff;
  const serviceWindowExpiresAt =
    input.message.direction === "outbound" &&
      isTimestamp(existing.serviceWindowExpiresAt)
      ? existing.serviceWindowExpiresAt
      : Timestamp.fromMillis(input.nowMs + 24 * 60 * 60 * 1000);
  const existingUnread =
    typeof existing.unreadCount === "number" &&
    Number.isInteger(existing.unreadCount) &&
    existing.unreadCount >= 0
      ? existing.unreadCount
      : 0;
  return {
    id: input.conversationId,
    workspaceId: BRIDGE_WORKSPACE_ID,
    contactId: input.contactId,
    connectionId: CONNECTION_SIMULATOR,
    teamId: TEAM_GENERAL,
    locationId: LOCATION_WATTALA,
    status: humanTakeover ? "assigned" : "active",
    mode: humanTakeover ? "human_takeover" : "automation",
    assigneeId,
    detectedLanguage: language,
    languageConfidence: 0.9,
    purpose: input.message.purpose,
    serviceWindowExpiresAt,
    firstResponseDueAt: isTimestamp(existing.firstResponseDueAt)
      ? existing.firstResponseDueAt
      : Timestamp.fromMillis(input.nowMs + 15 * 60 * 1000),
    lastMessageAt: now,
    handoffSummary:
      "Live WhatsApp canary conversation via the trilingual menu bot. Operational records are metadata-only; authorized short-lived text is retained separately.",
    unreadCount:
      input.message.direction === "inbound"
        ? Math.min(100_000, existingUnread + 1)
        : Math.min(100_000, existingUnread),
    synthetic: true,
    liveCanary: true,
    createdAt: isTimestamp(existing.createdAt) ? existing.createdAt : now,
    updatedAt: now,
  };
}

export interface LiveMessageDocumentInput {
  readonly messageId: string;
  readonly contactId: string;
  readonly conversationId: string;
  readonly message: BridgeMessageInput;
  readonly nowMs: number;
}

/** Complete Full/Lite-compatible metadata-only message document. */
export function buildLiveMessageDocument(input: LiveMessageDocumentInput): Record<string, unknown> {
  const now = Timestamp.fromMillis(input.nowMs);
  const inbound = input.message.direction === "inbound";
  return {
    id: input.messageId,
    workspaceId: BRIDGE_WORKSPACE_ID,
    conversationId: input.conversationId,
    contactId: input.contactId,
    teamId: TEAM_GENERAL,
    locationId: LOCATION_WATTALA,
    direction: input.message.direction,
    type: input.message.messageType === "interactive" ? "interactive" : "text",
    status: inbound ? "received" : "sent",
    externalDispatch: inbound ? "not_applicable" : "dispatched",
    actorId: null,
    receivedAt: inbound ? now : null,
    sentAt: inbound ? null : now,
    deliveredAt: null,
    metadataOnly: true,
    synthetic: true,
    liveCanary: true,
    ...(input.message.automationSource
      ? { automationSource: input.message.automationSource }
      : {}),
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function liveIds(waId: string): {
  key: string;
  contactId: string;
  conversationId: string;
} {
  const key = sha256Hex(`live:${waId}`).slice(0, 10);
  return {
    key,
    contactId: `contact_live_${key}`,
    conversationId: `conversation_live_${key}`,
  };
}

export async function loadBotSession(db: Firestore, waId: string): Promise<BotSession> {
  const { key } = liveIds(waId);
  const snap = await db
    .collection("workspaces").doc(BRIDGE_WORKSPACE_ID)
    .collection(SESSIONS).doc(key)
    .get();
  if (!snap.exists) return FRESH_BOT_SESSION;
  const data = snap.data() ?? {};
  return {
    language: (data.language as BotSession["language"]) ?? null,
    state: (data.state as BotSession["state"]) ?? "language",
    departmentId: (data.departmentId as string | null) ?? null,
    dayId: (data.dayId as string | null) ?? null,
    updatedAtMs: typeof data.updatedAtMs === "number" ? data.updatedAtMs : 0,
  };
}

export async function saveBotSession(db: Firestore, waId: string, session: BotSession): Promise<void> {
  const { key } = liveIds(waId);
  await db
    .collection("workspaces").doc(BRIDGE_WORKSPACE_ID)
    .collection(SESSIONS).doc(key)
    .set({ ...session, canary: true, containsMessageContent: false }, { merge: false });
}

export async function saveBooking(
  db: Firestore,
  waId: string,
  booking: BotBooking,
): Promise<void> {
  const { key, contactId, conversationId } = liveIds(waId);
  const contactRef = db
    .collection("workspaces").doc(BRIDGE_WORKSPACE_ID)
    .collection("contacts").doc(contactId);
  await db.runTransaction(async (transaction) => {
    const contact = await transaction.get(contactRef);
    const existingContact = contact.data();
    transaction.set(
      contactRef,
      buildLiveContactDocument({
        contactId,
        last4: waId.slice(-4),
        language: booking.language,
        nowMs: Date.now(),
        ...(contact.exists && existingContact ? { existing: existingContact } : {}),
        addTags: ["appointment"],
      }),
      { merge: false },
    );
  });
  await db
    .collection("workspaces").doc(BRIDGE_WORKSPACE_ID)
    .collection(BOOKINGS).doc(`${booking.reference}-${key}`)
    .create({
      id: `${booking.reference}-${key}`,
      workspaceId: BRIDGE_WORKSPACE_ID,
      conversationId,
      visitorKey: key,
      visitorNumberSha256: sha256Hex(waId),
      departmentId: booking.departmentId,
      dayId: booking.dayId,
      slotId: booking.slotId,
      language: booking.language,
      reference: booking.reference,
      selectionsOnly: true,
      containsMessageContent: false,
      canary: true,
      demo: true,
      createdAt: FieldValue.serverTimestamp(),
      schemaVersion: 1,
    });
}

export interface BridgeMessageInput {
  readonly direction: "inbound" | "outbound";
  readonly waMessageId: string;
  readonly messageType: string;
  readonly language: BotLanguage | null;
  readonly purpose: "general_support" | "appointment" | "laboratory";
  readonly staffHandoff: boolean;
  readonly last4: string;
  /** Content-free provenance for automated outbound demo replies. */
  readonly automationSource?: "menu_bot" | "governed_ai";
}

/** Ensure contact + conversation exist and append a metadata-only message. */
export async function bridgeToInbox(
  db: Firestore,
  waId: string,
  input: BridgeMessageInput,
): Promise<void> {
  const { key, contactId, conversationId } = liveIds(waId);
  const ws = db.collection("workspaces").doc(BRIDGE_WORKSPACE_ID);
  const nowMs = Date.now();

  const contactRef = ws.collection("contacts").doc(contactId);
  const conversationRef = ws.collection("conversations").doc(conversationId);
  const messageRef = ws
    .collection("messages")
    .doc(`message_live_${sha256Hex(`${input.waMessageId}:${input.direction}`).slice(0, 16)}`);

  await db.runTransaction(async (transaction) => {
    const [contact, conversation] = await Promise.all([
      transaction.get(contactRef),
      transaction.get(conversationRef),
    ]);
    const existingContact = contact.data();
    const existingConversation = conversation.data();
    transaction.set(
      contactRef,
      buildLiveContactDocument({
        contactId,
        last4: input.last4,
        language: input.language ?? "en",
        nowMs,
        ...(contact.exists && existingContact ? { existing: existingContact } : {}),
        ...(input.staffHandoff ? { addTags: ["human-handoff"] } : {}),
      }),
      { merge: false },
    );
    transaction.set(
      conversationRef,
      buildLiveConversationDocument({
        contactId,
        conversationId,
        message: input,
        nowMs,
        ...(conversation.exists && existingConversation
          ? { existing: existingConversation }
          : {}),
      }),
      { merge: false },
    );
    transaction.set(
      messageRef,
      buildLiveMessageDocument({
        messageId: messageRef.id,
        contactId,
        conversationId,
        message: input,
        nowMs,
      }),
      { merge: false },
    );
  });
}
