/**
 * Hemas Connect LITE — governed callables.
 *
 * Three callables power the "simple product" demo:
 *
 * - liteDemoSetup       — idempotently provisions the fixed synthetic seats
 *                         (Auth users + workspace membership docs). Only the
 *                         synthetic demo admin may run it.
 * - liteClaimConversation — claim/release a conversation for a seat (the
 *                         Multi-Agent story). Membership is verified against
 *                         the workspace member doc, never trusted from input.
 * - liteSendAgentReply  — a REAL agent reply to a live WhatsApp visitor,
 *                         inside the 24h service window, routed only to the
 *                         explicit canary allowlist (number recovered by key
 *                         hash — no reverse mapping stored). The ledger entry
 *                         is content-free: hash + length, never the body.
 */

import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import {
  FieldValue,
  Timestamp,
  getFirestore,
  type Firestore,
} from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { sha256Hex } from "../deterministic.js";
import {
  META_CANARY_DEFAULT_LANGUAGE,
  META_CANARY_DEFAULT_TEMPLATE,
  parseRecipientAllowlist,
} from "../meta-canary/contracts.js";
import { canaryBoundaryOrNull, metaAccessToken, sendGraphMessage } from "../meta-canary/graph.js";
import {
  LITE_CAMPAIGNS_COLLECTION,
  LITE_CAMPAIGN_SENDS_COLLECTION,
  LiteCampaignError,
  assertTemplateSelection,
  assertValidCampaignName,
  campaignId,
  sendDocIdForFailure,
  sendDocIdForWamid,
} from "./campaigns.js";
import {
  LITE_AGENT_REPLIES_COLLECTION,
  LITE_SEATS,
  LITE_WORKSPACE_ID,
  LiteError,
  assertLiteAction,
  assertValidReplyText,
  buildAgentReplyBody,
  buildLiteMemberDocument,
  liveConversationKey,
  resolveAllowlistedWaId,
} from "./contracts.js";
import { bumpDailyMetrics } from "./metrics.js";

const SYNTHETIC_DEMO_EMAIL = "demo.admin@synthetic.invalid";
const LITE_ROLES = ["agent", "supervisor", "tenant_admin"] as const;

function liteAdminApp(projectId: string): App {
  // Never call getApp() blind: some runtime states report registered apps
  // without a default one. Find the default explicitly or create it.
  const existing = getApps().find((candidate) => candidate.name === "[DEFAULT]");
  return existing ?? initializeApp({ projectId });
}

function liteFirestore(projectId: string): Firestore {
  return getFirestore(liteAdminApp(projectId));
}

function boundaryOrThrow(): { projectId: string } {
  const boundary = canaryBoundaryOrNull();
  if (!boundary) {
    throw new HttpsError("failed-precondition", "The Lite lane is disabled outside the governed cloud demo.");
  }
  return boundary;
}

interface LiteMember {
  readonly uid: string;
  readonly role: string;
  readonly displayLabel: string;
}

async function requireLiteMember(
  db: Firestore,
  request: CallableRequest<unknown>,
): Promise<LiteMember> {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in with a Lite seat first.");
  }
  const snap = await db
    .collection("workspaces").doc(LITE_WORKSPACE_ID)
    .collection("members").doc(uid)
    .get();
  const data = snap.data();
  if (
    !snap.exists ||
    !data ||
    data.uid !== uid ||
    data.status !== "active" ||
    typeof data.role !== "string" ||
    !(LITE_ROLES as readonly string[]).includes(data.role)
  ) {
    throw new HttpsError("permission-denied", "This account has no active Lite seat.");
  }
  return {
    uid,
    role: data.role,
    displayLabel: typeof data.displayLabel === "string" ? data.displayLabel : uid,
  };
}

function mapLiteError(error: unknown): never {
  if (error instanceof LiteError) {
    const code =
      error.code === "route_not_allowlisted" ? "permission-denied" :
      error.code === "window_expired" || error.code === "not_live" ? "failed-precondition" :
      "invalid-argument";
    throw new HttpsError(code, error.message);
  }
  if (error instanceof LiteCampaignError) {
    throw new HttpsError(
      error.code === "empty_audience" ? "failed-precondition" : "invalid-argument",
      error.message,
    );
  }
  if (error instanceof HttpsError) throw error;
  throw new HttpsError("internal", "The Lite lane could not complete the request.");
}

// ---------------------------------------------------------------------------
// Seat provisioning
// ---------------------------------------------------------------------------

export const liteDemoSetup = onCall(
  { memory: "256MiB", timeoutSeconds: 60, maxInstances: 2 },
  async (request: CallableRequest<unknown>) => {
    const boundary = boundaryOrThrow();
    if (!request.auth || request.auth.token.email !== SYNTHETIC_DEMO_EMAIL) {
      throw new HttpsError("permission-denied", "Only the synthetic demo admin can provision Lite seats.");
    }

    const db = liteFirestore(boundary.projectId);
    const auth = getAuth(liteAdminApp(boundary.projectId));
    const seats: Array<{ email: string; displayLabel: string; role: string; uid: string }> = [];

    for (const seat of LITE_SEATS) {
      let uid: string;
      try {
        const existing = await auth.getUserByEmail(seat.email);
        uid = existing.uid;
        await auth.updateUser(uid, { password: seat.password, displayName: seat.displayLabel });
      } catch {
        const created = await auth.createUser({
          email: seat.email,
          password: seat.password,
          displayName: seat.displayLabel,
          emailVerified: true,
        });
        uid = created.uid;
      }
      await db
        .collection("workspaces").doc(LITE_WORKSPACE_ID)
        .collection("members").doc(uid)
        .set(buildLiteMemberDocument(uid, seat), { merge: false });
      seats.push({ email: seat.email, displayLabel: seat.displayLabel, role: seat.role, uid });
    }

    logger.info("lite: seats provisioned", { count: seats.length });
    return { provisioned: seats.length, seats };
  },
);

// ---------------------------------------------------------------------------
// Claim / release (Multi-Agent)
// ---------------------------------------------------------------------------

type LiteClaimInput = { readonly conversationId?: string; readonly action?: string };

export const liteClaimConversation = onCall(
  { memory: "256MiB", timeoutSeconds: 30, maxInstances: 5 },
  async (request: CallableRequest<LiteClaimInput>) => {
    const boundary = boundaryOrThrow();
    const db = liteFirestore(boundary.projectId);
    const member = await requireLiteMember(db, request);

    try {
      const action = assertLiteAction(request.data?.action);
      const conversationId =
        typeof request.data?.conversationId === "string" ? request.data.conversationId.trim() : "";
      if (!/^conversation_[a-z0-9_]{3,80}$/.test(conversationId)) {
        throw new LiteError("invalid_conversation", "Unknown conversation id.");
      }

      const ref = db
        .collection("workspaces").doc(LITE_WORKSPACE_ID)
        .collection("conversations").doc(conversationId);
      const snap = await ref.get();
      const data = snap.data();
      if (!snap.exists || !data || data.workspaceId !== LITE_WORKSPACE_ID || data.synthetic !== true) {
        throw new LiteError("invalid_conversation", "Unknown conversation id.");
      }

      const now = Timestamp.now();
      if (action === "claim") {
        await ref.set(
          {
            assigneeId: member.uid,
            status: "assigned",
            mode: "human_takeover",
            unreadCount: 0,
            updatedAt: now,
          },
          { merge: true },
        );
      } else {
        await ref.set(
          { assigneeId: null, status: "active", mode: "automation", updatedAt: now },
          { merge: true },
        );
      }

      logger.info("lite: conversation routing updated", { action, role: member.role });
      return { ok: true, action, conversationId, assigneeId: action === "claim" ? member.uid : null };
    } catch (error) {
      mapLiteError(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Live agent reply (real WhatsApp send, governed)
// ---------------------------------------------------------------------------

type LiteReplyInput = { readonly conversationId?: string; readonly text?: string };

export const liteSendAgentReply = onCall(
  { memory: "256MiB", timeoutSeconds: 30, maxInstances: 5, secrets: [metaAccessToken] },
  async (request: CallableRequest<LiteReplyInput>) => {
    const boundary = boundaryOrThrow();
    const db = liteFirestore(boundary.projectId);
    const member = await requireLiteMember(db, request);

    try {
      const text = assertValidReplyText(request.data?.text);
      const conversationId =
        typeof request.data?.conversationId === "string" ? request.data.conversationId.trim() : "";
      const key = liveConversationKey(conversationId);

      const conversationRef = db
        .collection("workspaces").doc(LITE_WORKSPACE_ID)
        .collection("conversations").doc(conversationId);
      const snap = await conversationRef.get();
      const conversation = snap.data();
      if (!snap.exists || !conversation || conversation.workspaceId !== LITE_WORKSPACE_ID) {
        throw new LiteError("invalid_conversation", "Unknown conversation id.");
      }
      if (conversation.liveCanary !== true) {
        throw new LiteError("not_live", "Only live canary conversations can receive WhatsApp replies.");
      }
      const windowExpiresAt = conversation.serviceWindowExpiresAt;
      const windowOpen =
        windowExpiresAt instanceof Timestamp && windowExpiresAt.toMillis() > Date.now();
      if (!windowOpen) {
        throw new LiteError(
          "window_expired",
          "The 24h service window is closed — ask the visitor to message again, or use an approved template.",
        );
      }

      const allowlist = parseRecipientAllowlist(process.env.HEMAS_META_ALLOWLISTED_RECIPIENTS);
      const waId = resolveAllowlistedWaId(key, allowlist, sha256Hex);
      if (!waId) {
        throw new LiteError(
          "route_not_allowlisted",
          "Governance: agent replies are limited to the explicit canary test allowlist.",
        );
      }

      const phoneNumberId = process.env.HEMAS_META_PHONE_NUMBER_ID?.trim() ?? "";
      if (!/^\d{5,32}$/.test(phoneNumberId)) {
        throw new HttpsError("failed-precondition", "The canary phone number is not configured.");
      }

      let providerMessageId: string | null = null;
      try {
        const sent = await sendGraphMessage(
          phoneNumberId,
          metaAccessToken.value(),
          waId,
          buildAgentReplyBody(text),
        );
        providerMessageId = sent.providerMessageId;
      } catch (error) {
        logger.warn("lite: agent reply send failed", {
          reason: error instanceof Error ? error.message : "unknown",
        });
        throw new HttpsError("unavailable", "Meta declined the reply send.");
      }

      const now = Timestamp.now();
      const ws = db.collection("workspaces").doc(LITE_WORKSPACE_ID);
      const messageId = `message_live_${sha256Hex(`${providerMessageId ?? conversationId}:${now.toMillis()}:agent`).slice(0, 16)}`;
      const ledgerId = sha256Hex(`${providerMessageId ?? "unknown"}:${key}:${now.toMillis()}`).slice(0, 40);

      const batch = db.batch();
      batch.set(ws.collection("messages").doc(messageId), {
        id: messageId,
        workspaceId: LITE_WORKSPACE_ID,
        conversationId,
        contactId: `contact_live_${key}`,
        teamId: conversation.teamId ?? "team_demo_general",
        locationId: conversation.locationId ?? "location_demo_wattala",
        direction: "outbound",
        type: "text",
        status: "sent",
        externalDispatch: null,
        actorId: member.uid,
        receivedAt: null,
        sentAt: now,
        deliveredAt: null,
        metadataOnly: true,
        synthetic: true,
        liveCanary: true,
        agentReply: true,
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      batch.set(
        conversationRef,
        {
          assigneeId: member.uid,
          status: "assigned",
          mode: "human_takeover",
          lastMessageAt: now,
          unreadCount: 0,
          updatedAt: now,
        },
        { merge: true },
      );
      batch.set(ws.collection(LITE_AGENT_REPLIES_COLLECTION).doc(ledgerId), {
        id: ledgerId,
        workspaceId: LITE_WORKSPACE_ID,
        conversationId,
        actorUid: member.uid,
        bodySha256: sha256Hex(text),
        bodyLength: text.length,
        toNumberLast4: waId.slice(-4),
        providerMessageId,
        canary: true,
        containsMessageContent: false,
        createdAt: now,
        schemaVersion: 1,
      });
      await batch.commit();

      logger.info("lite: agent reply sent", {
        role: member.role,
        length: text.length,
        hasProviderId: Boolean(providerMessageId),
      });
      void bumpDailyMetrics(db, LITE_WORKSPACE_ID, Date.now(), { agentReplies: 1 });
      return { sent: true, conversationId, providerMessageId };
    } catch (error) {
      mapLiteError(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Live bulk campaigns (template blast to the governed allowlist)
// ---------------------------------------------------------------------------

type LiteCampaignInput = {
  readonly name?: string;
  readonly templateName?: string;
  readonly languageCode?: string;
};

export const liteSendCampaign = onCall(
  { memory: "256MiB", timeoutSeconds: 120, maxInstances: 2, secrets: [metaAccessToken] },
  async (request: CallableRequest<LiteCampaignInput>) => {
    const boundary = boundaryOrThrow();
    const db = liteFirestore(boundary.projectId);
    const member = await requireLiteMember(db, request);
    if (member.role !== "supervisor" && member.role !== "tenant_admin") {
      throw new HttpsError(
        "permission-denied",
        "Campaigns need a supervisor or admin seat — agents handle chats, not broadcasts.",
      );
    }

    try {
      const name = assertValidCampaignName(request.data?.name);
      const template = assertTemplateSelection(
        request.data?.templateName,
        request.data?.languageCode,
        META_CANARY_DEFAULT_TEMPLATE,
        META_CANARY_DEFAULT_LANGUAGE,
      );
      const audience = parseRecipientAllowlist(process.env.HEMAS_META_ALLOWLISTED_RECIPIENTS);
      if (audience.length === 0) {
        throw new LiteCampaignError("empty_audience", "The canary allowlist is empty.");
      }
      const phoneNumberId = process.env.HEMAS_META_PHONE_NUMBER_ID?.trim() ?? "";
      if (!/^\d{5,32}$/.test(phoneNumberId)) {
        throw new HttpsError("failed-precondition", "The canary phone number is not configured.");
      }

      const nowMs = Date.now();
      const id = campaignId(name, nowMs, sha256Hex);
      const ws = db.collection("workspaces").doc(LITE_WORKSPACE_ID);
      const campaignRef = ws.collection(LITE_CAMPAIGNS_COLLECTION).doc(id);

      await campaignRef.create({
        id,
        workspaceId: LITE_WORKSPACE_ID,
        name,
        templateName: template.templateName,
        languageCode: template.languageCode,
        status: "sending",
        audienceCount: audience.length,
        sentCount: 0,
        failedCount: 0,
        actorUid: member.uid,
        allowlistOnly: true,
        canary: true,
        liveCanary: true,
        synthetic: true,
        containsMessageContent: false,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        schemaVersion: 1,
      });

      const token = metaAccessToken.value();
      let sent = 0;
      let failed = 0;
      for (const recipient of audience) {
        const digits = recipient.replace(/\D/g, "");
        let providerMessageId: string | null = null;
        let errorCode: string | null = null;
        try {
          const result = await sendGraphMessage(phoneNumberId, token, digits, {
            type: "template",
            template: {
              name: template.templateName,
              language: { code: template.languageCode },
            },
          });
          providerMessageId = result.providerMessageId;
          sent += 1;
        } catch (error) {
          failed += 1;
          errorCode = error instanceof Error ? error.message.slice(0, 60) : "unknown";
        }
        const sendId = providerMessageId
          ? sendDocIdForWamid(providerMessageId, sha256Hex)
          : sendDocIdForFailure(id, digits, sha256Hex);
        await ws.collection(LITE_CAMPAIGN_SENDS_COLLECTION).doc(sendId).set({
          id: sendId,
          workspaceId: LITE_WORKSPACE_ID,
          campaignId: id,
          toNumberSha256: sha256Hex(digits),
          toNumberLast4: digits.slice(-4),
          status: providerMessageId ? "sent" : "failed",
          errorCode,
          providerMessageId,
          canary: true,
          liveCanary: true,
          synthetic: true,
          containsMessageContent: false,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          schemaVersion: 1,
        });
      }

      await campaignRef.set(
        {
          status: failed === 0 ? "sent" : sent > 0 ? "partial" : "failed",
          sentCount: sent,
          failedCount: failed,
          completedAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      );
      void bumpDailyMetrics(db, LITE_WORKSPACE_ID, nowMs, { campaignSends: sent });

      logger.info("lite: campaign dispatched", {
        audience: audience.length,
        sent,
        failed,
        template: template.templateName,
      });
      return { campaignId: id, audience: audience.length, sent, failed };
    } catch (error) {
      mapLiteError(error);
    }
  },
);
