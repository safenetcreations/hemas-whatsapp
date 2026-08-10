import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { sha256Hex } from "../deterministic.js";
import type { BotBooking, BotLanguage, BotSession } from "./engine.js";
import { FRESH_BOT_SESSION } from "./engine.js";

/**
 * Live canary INBOX BRIDGE.
 *
 * Mirrors real (governed, content-free) canary conversations into the same
 * Firestore shapes the portal inbox already renders for the synthetic seed:
 * contacts, conversations and metadata-only messages. Message bodies are
 * NEVER written — direction, type, language and timestamps only, exactly
 * like the seeded metadata-only records.
 */

export const BRIDGE_WORKSPACE_ID = "workspace_safenet_demo";
const TEAM_GENERAL = "team_demo_general";
const LOCATION_WATTALA = "location_demo_wattala";
const CONNECTION_SIMULATOR = "connection_demo_simulator";

const SESSIONS = "canary_bot_sessions";
const BOOKINGS = "canary_bookings";

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
  const { key, conversationId } = liveIds(waId);
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
}

/** Ensure contact + conversation exist and append a metadata-only message. */
export async function bridgeToInbox(
  db: Firestore,
  waId: string,
  input: BridgeMessageInput,
): Promise<void> {
  const { key, contactId, conversationId } = liveIds(waId);
  const ws = db.collection("workspaces").doc(BRIDGE_WORKSPACE_ID);
  const now = Timestamp.now();
  const language = input.language ?? "en";

  const contactRef = ws.collection("contacts").doc(contactId);
  const conversationRef = ws.collection("conversations").doc(conversationId);
  const messageRef = ws
    .collection("messages")
    .doc(`message_live_${sha256Hex(`${input.waMessageId}:${input.direction}`).slice(0, 16)}`);

  const batch = db.batch();

  batch.set(
    contactRef,
    {
      id: contactId,
      workspaceId: BRIDGE_WORKSPACE_ID,
      teamId: TEAM_GENERAL,
      locationId: LOCATION_WATTALA,
      maskedPhone: `Live canary visitor ···${input.last4} · number withheld`,
      displayLabel: `Live WhatsApp visitor ···${input.last4}`,
      preferredLanguage: language,
      alternateLanguages: [],
      suppression: { status: "none", reasons: [], updatedAt: now },
      tags: ["live_canary", "menu_bot"],
      preferenceRevision: 0,
      synthetic: true,
      liveCanary: true,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true },
  );

  batch.set(
    conversationRef,
    {
      id: conversationId,
      workspaceId: BRIDGE_WORKSPACE_ID,
      contactId,
      connectionId: CONNECTION_SIMULATOR,
      teamId: TEAM_GENERAL,
      locationId: LOCATION_WATTALA,
      status: input.staffHandoff ? "assigned" : "active",
      mode: input.staffHandoff ? "human_takeover" : "automation",
      assigneeId: null,
      detectedLanguage: language,
      languageConfidence: 0.9,
      purpose: input.purpose,
      serviceWindowExpiresAt: Timestamp.fromMillis(now.toMillis() + 24 * 60 * 60 * 1000),
      firstResponseDueAt: Timestamp.fromMillis(now.toMillis() + 15 * 60 * 1000),
      lastMessageAt: now,
      handoffSummary:
        "Live WhatsApp canary conversation via the trilingual menu bot. Metadata only — message bodies are never stored.",
      unreadCount: input.direction === "inbound" ? FieldValue.increment(1) : FieldValue.increment(0),
      synthetic: true,
      liveCanary: true,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true },
  );

  batch.set(messageRef, {
    id: messageRef.id,
    workspaceId: BRIDGE_WORKSPACE_ID,
    conversationId,
    contactId,
    teamId: TEAM_GENERAL,
    locationId: LOCATION_WATTALA,
    direction: input.direction,
    type: input.messageType === "interactive" ? "interactive" : "text",
    status: input.direction === "inbound" ? "received" : "sent",
    externalDispatch: null,
    actorId: null,
    receivedAt: input.direction === "inbound" ? now : null,
    sentAt: input.direction === "outbound" ? now : null,
    deliveredAt: null,
    metadataOnly: true,
    synthetic: true,
    liveCanary: true,
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
  });

  await batch.commit();
}
