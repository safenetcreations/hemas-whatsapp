import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall, onRequest, type CallableRequest } from "firebase-functions/v2/https";
import { sha256Hex } from "../deterministic.js";
import {
  canaryBoundaryOrNull,
  geminiApiKey,
  graphVersion,
  metaAccessToken,
  metaAppSecret,
  metaVerifyToken,
  sendGraphMessage,
} from "./graph.js";
import {
  META_CANARY_DEFAULT_LANGUAGE,
  META_CANARY_DEFAULT_TEMPLATE,
  META_CANARY_INBOUND_COLLECTION,
  META_CANARY_OUTBOUND_COLLECTION,
  META_CANARY_WORKSPACE_ID,
  MetaCanaryError,
  assertAllowlistedRecipient,
  buildCanaryTemplateSendBody,
  extractCanaryInboundRecords,
  parseRecipientAllowlist,
  verifyMetaSignature,
  verifyMetaWebhookChallenge,
} from "./contracts.js";
import { runBotEngine, type BotInbound } from "../meta-bot/engine.js";
import { aiReplyMessage, answerWithGuardrails } from "../meta-bot/ai.js";
import {
  BRIDGE_WORKSPACE_ID,
  bridgeToInbox,
  loadBotSession,
  saveBooking,
  saveBotSession,
} from "../meta-bot/bridge.js";
import { bumpDailyMetrics } from "../lite/metrics.js";
import {
  LITE_CAMPAIGN_SENDS_COLLECTION,
  extractDeliveryStatusEvents,
  sendDocIdForWamid,
  shouldAdvanceSendStatus,
} from "../lite/campaigns.js";

/**
 * Governed Meta WhatsApp CANARY lane.
 *
 * Purpose: prove end-to-end connectivity between Meta's WhatsApp Cloud API
 * (test number) and the governed cloud demo — nothing more.
 *
 * Hard boundaries:
 * - Only runs in the governed cloud demo project with BOTH
 *   HEMAS_CLOUD_DEMO_ENABLED=true and HEMAS_META_CANARY_ENABLED=true.
 * - Inbound records are content-free: message bodies are hashed, never stored.
 * - Outbound sends require the authenticated synthetic demo identity and an
 *   explicit E.164 allowlist (max 5 numbers) of test recipients.
 * - No patient data, no contact-graph joins, no automation triggers.
 */

const SYNTHETIC_DEMO_EMAIL = "demo.admin@synthetic.invalid";

function getCanaryFirestore(projectId: string): Firestore {
  const app =
    getApps().find((candidate) => candidate.name === "[DEFAULT]") ??
    initializeApp({ projectId });
  return getFirestore(app);
}

const AUTO_REPLY_TEXT =
  "✅ Hemas Connect received your message. This is a synthetic SafeNet demo — a care-team agent reviews and responds through the governed portal. No real patient data is processed here.";

type RawBotMessage = {
  readonly waId: string;
  readonly waMessageId: string;
  readonly messageType: string;
  readonly inbound: Omit<BotInbound, "nowMs">;
};

/** Extract bot-relevant inbound messages (text + interactive selections). */
function extractBotMessages(payload: unknown): RawBotMessage[] {
  const out: RawBotMessage[] = [];
  const root = payload as {
    entry?: Array<{ changes?: Array<{ field?: string; value?: { messages?: Array<Record<string, unknown>> } }> }>;
  };
  for (const entry of root.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      for (const message of change.value?.messages ?? []) {
        const waId = typeof message.from === "string" ? message.from.replace(/\D/g, "") : "";
        const waMessageId = typeof message.id === "string" ? message.id : "";
        if (!waId || !waMessageId) continue;
        const type = typeof message.type === "string" ? message.type : "unknown";
        let selectionId = "";
        let text = "";
        if (type === "interactive") {
          const interactive = message.interactive as
            | { button_reply?: { id?: string }; list_reply?: { id?: string } }
            | undefined;
          selectionId = interactive?.button_reply?.id ?? interactive?.list_reply?.id ?? "";
        } else if (type === "text") {
          const body = (message.text as { body?: string } | undefined)?.body;
          text = typeof body === "string" ? body.slice(0, 512) : "";
        }
        out.push({
          waId,
          waMessageId,
          messageType: type,
          inbound: selectionId
            ? { kind: "selection", selectionId, text: "" }
            : { kind: "text", selectionId: "", text },
        });
      }
    }
  }
  return out;
}

async function sendAutoReply(
  toNumber: string,
  phoneNumberId: string,
  token: string,
): Promise<void> {
  await sendGraphMessage(phoneNumberId, token, toNumber, {
    type: "text",
    text: { preview_url: false, body: AUTO_REPLY_TEXT },
  });
}

export const metaCanaryWebhook = onRequest(
  {
    cors: false,
    memory: "256MiB",
    timeoutSeconds: 30,
    maxInstances: 3,
    concurrency: 40,
    secrets: [metaAppSecret, metaVerifyToken, metaAccessToken, geminiApiKey],
  },
  async (request, response) => {
    const boundary = canaryBoundaryOrNull();
    if (!boundary) {
      response.status(403).json({ error: "canary_disabled" });
      return;
    }

    if (request.method === "GET") {
      try {
        const challenge = verifyMetaWebhookChallenge({
          mode: typeof request.query["hub.mode"] === "string" ? (request.query["hub.mode"] as string) : undefined,
          verifyToken:
            typeof request.query["hub.verify_token"] === "string"
              ? (request.query["hub.verify_token"] as string)
              : undefined,
          challenge:
            typeof request.query["hub.challenge"] === "string"
              ? (request.query["hub.challenge"] as string)
              : undefined,
          expectedVerifyToken: metaVerifyToken.value(),
        });
        response.status(200).send(challenge);
      } catch {
        response.status(403).json({ error: "verification_failed" });
      }
      return;
    }

    if (request.method !== "POST") {
      response.status(405).json({ error: "method_not_allowed" });
      return;
    }

    try {
      verifyMetaSignature({
        rawBody: request.rawBody ?? Buffer.alloc(0),
        signatureHeader: request.header("x-hub-signature-256"),
        appSecret: metaAppSecret.value(),
      });
    } catch {
      logger.warn("meta-canary: rejected webhook with invalid signature");
      response.status(403).json({ error: "invalid_signature" });
      return;
    }

    let payload: unknown = null;
    try {
      payload = JSON.parse((request.rawBody ?? Buffer.alloc(0)).toString("utf8"));
    } catch {
      response.status(200).json({ received: true, stored: 0 });
      return;
    }

    // Content-free diagnostic: surface Meta delivery-failure codes (no PII).
    try {
      const root = payload as { entry?: Array<{ changes?: Array<{ value?: { statuses?: Array<{ status?: string; errors?: Array<{ code?: number; title?: string; error_data?: { details?: string } }> }> } }> }> };
      for (const entry of root.entry ?? []) {
        for (const change of entry.changes ?? []) {
          for (const st of change.value?.statuses ?? []) {
            if (st.status === "failed") {
              logger.warn("meta-canary: outbound delivery FAILED", {
                errors: (st.errors ?? []).map((e) => ({ code: e.code, title: e.title, details: e.error_data?.details })),
              });
            }
          }
        }
      }
    } catch {
      /* diagnostic only */
    }

    const records = extractCanaryInboundRecords(payload, sha256Hex);

    // Campaign delivery tracking: advance content-free send records when
    // Meta reports sent → delivered → read (or failed). Only existing
    // records are touched — no orphan docs for bot/agent sends.
    const statusEvents = extractDeliveryStatusEvents(payload);
    if (statusEvents.length > 0) {
      const db = getCanaryFirestore(boundary.projectId);
      for (const event of statusEvents) {
        try {
          const ref = db
            .collection("workspaces").doc(META_CANARY_WORKSPACE_ID)
            .collection(LITE_CAMPAIGN_SENDS_COLLECTION)
            .doc(sendDocIdForWamid(event.wamid, sha256Hex));
          const snap = await ref.get();
          if (snap.exists && shouldAdvanceSendStatus(snap.data()?.status, event.status)) {
            await ref.set(
              { status: event.status, updatedAt: FieldValue.serverTimestamp() },
              { merge: true },
            );
          }
        } catch {
          /* delivery tracking never breaks the webhook */
        }
      }
    }

    if (records.length > 0) {
      const db = getCanaryFirestore(boundary.projectId);
      const batch = db.batch();
      for (const record of records) {
        batch.set(
          db
            .collection("workspaces")
            .doc(META_CANARY_WORKSPACE_ID)
            .collection(META_CANARY_INBOUND_COLLECTION)
            .doc(record.id),
          { ...record, receivedAt: FieldValue.serverTimestamp() },
          { merge: false },
        );
      }
      await batch.commit();

      // Governed trilingual menu BOT: selections-only conversation flows with
      // live inbox mirroring. Takes precedence over the flat auto-reply.
      if (process.env.HEMAS_META_BOT_ENABLED === "true") {
        const phoneNumberId = process.env.HEMAS_META_PHONE_NUMBER_ID?.trim() ?? "";
        const token = metaAccessToken.value();
        if (/^\d{5,32}$/.test(phoneNumberId) && token) {
          for (const raw of extractBotMessages(payload)) {
            try {
              const session = await loadBotSession(db, raw.waId);
              const result = runBotEngine(session, { ...raw.inbound, nowMs: Date.now() }, {
                welcomeMediaId: process.env.HEMAS_META_WELCOME_MEDIA_ID?.trim() || null,
              });

              // Governed AI answers: when the menu engine could not route the
              // text, ask Gemini (guard-railed, knowledge-base-only). The
              // answer replaces the fallback nudge; any AI failure keeps the
              // original menu replies. Text stays in memory only.
              let replies: readonly Record<string, unknown>[] = result.replies;
              let aiAnswered: boolean | null = null;
              if (result.aiQuery && process.env.HEMAS_META_AI_ENABLED === "true") {
                let aiKey = "";
                try {
                  aiKey = geminiApiKey.value().trim();
                } catch {
                  aiKey = "";
                }
                if (aiKey) {
                  const aiModel = process.env.HEMAS_GEMINI_MODEL?.trim();
                  const ai = await answerWithGuardrails(
                    { text: result.aiQuery, language: result.session.language ?? "en" },
                    { apiKey: aiKey, ...(aiModel ? { model: aiModel } : {}) },
                  );
                  aiAnswered = Boolean(ai.answer);
                  if (ai.answer) {
                    replies = [aiReplyMessage(ai.answer, result.session.language ?? "en")];
                  }
                  logger.info("meta-bot: ai answer", {
                    answered: Boolean(ai.answer),
                    failureCode: ai.failureCode,
                    latencyMs: ai.latencyMs,
                  });
                }
              }

              for (const reply of replies) {
                await sendGraphMessage(phoneNumberId, token, raw.waId, reply);
              }
              await saveBotSession(db, raw.waId, result.session);
              if (result.booking) {
                await saveBooking(db, raw.waId, result.booking).catch(() => undefined);
              }
              const bridgeBase = {
                language: result.session.language,
                purpose: result.purpose,
                staffHandoff: result.staffHandoff,
                last4: raw.waId.slice(-4),
              } as const;
              await bridgeToInbox(db, raw.waId, {
                ...bridgeBase,
                direction: "inbound",
                waMessageId: raw.waMessageId,
                messageType: raw.messageType,
              });
              await bridgeToInbox(db, raw.waId, {
                ...bridgeBase,
                direction: "outbound",
                waMessageId: `${raw.waMessageId}:reply`,
                messageType: typeof replies[0]?.type === "string" ? String(replies[0].type) : "text",
              });
              logger.info("meta-bot: handled inbound", {
                kind: raw.inbound.kind,
                state: result.session.state,
                language: result.session.language,
                replies: replies.length,
                booked: Boolean(result.booking),
              });
              void bumpDailyMetrics(db, BRIDGE_WORKSPACE_ID, Date.now(), {
                botReplies: replies.length,
                bookings: result.booking ? 1 : 0,
                staffHandoffs: result.staffHandoff ? 1 : 0,
                aiAnswers: aiAnswered === true ? 1 : 0,
                aiFailures: aiAnswered === false ? 1 : 0,
              });
            } catch (error) {
              logger.warn("meta-bot: handling failed", {
                reason: error instanceof Error ? error.message : "unknown",
              });
            }
          }
        }
      } else if (process.env.HEMAS_META_AUTO_REPLY_ENABLED === "true") {
        const phoneNumberId = process.env.HEMAS_META_PHONE_NUMBER_ID?.trim() ?? "";
        const token = metaAccessToken.value();
        if (/^\d{5,32}$/.test(phoneNumberId) && token) {
          const repliedTo = new Set<string>();
          for (const record of records) {
            if (record.kind !== "message" || !record.fromNumber) continue;
            if (repliedTo.has(record.fromNumber)) continue;
            repliedTo.add(record.fromNumber);
            try {
              await sendAutoReply(record.fromNumber, phoneNumberId, token);
            } catch (error) {
              logger.warn("meta-canary: auto-reply failed", {
                reason: error instanceof Error ? error.message : "unknown",
              });
            }
          }
        }
      }

      logger.info("meta-canary: stored content-free inbound records", {
        count: records.length,
        kinds: records.map((record) => record.kind),
      });
      void bumpDailyMetrics(db, BRIDGE_WORKSPACE_ID, Date.now(), {
        inboundMessages: records.filter((record) => record.kind === "message").length,
      });
    }
    response.status(200).json({ received: true, stored: records.length });
  },
);

type CanarySendInput = {
  readonly to?: string;
  readonly templateName?: string;
  readonly languageCode?: string;
};

export const demoSendMetaCanaryTemplate = onCall(
  {
    memory: "256MiB",
    timeoutSeconds: 30,
    maxInstances: 3,
    secrets: [metaAccessToken],
  },
  async (request: CallableRequest<CanarySendInput>) => {
    const boundary = canaryBoundaryOrNull();
    if (!boundary) {
      throw new HttpsError("failed-precondition", "The Meta canary lane is disabled.");
    }
    const email = request.auth?.token.email;
    if (!request.auth || email !== SYNTHETIC_DEMO_EMAIL) {
      throw new HttpsError(
        "permission-denied",
        "Canary sends require the authenticated synthetic demo identity.",
      );
    }

    const allowlist = parseRecipientAllowlist(
      process.env.HEMAS_META_ALLOWLISTED_RECIPIENTS,
    );
    const phoneNumberId = process.env.HEMAS_META_PHONE_NUMBER_ID?.trim() ?? "";
    if (!/^\d{5,32}$/.test(phoneNumberId)) {
      throw new HttpsError("failed-precondition", "The canary phone number is not configured.");
    }

    let to: string;
    let body: Record<string, unknown>;
    try {
      to = assertAllowlistedRecipient(request.data?.to, allowlist);
      body = buildCanaryTemplateSendBody({
        to,
        templateName: request.data?.templateName?.trim() || META_CANARY_DEFAULT_TEMPLATE,
        languageCode: request.data?.languageCode?.trim() || META_CANARY_DEFAULT_LANGUAGE,
      });
    } catch (error) {
      if (error instanceof MetaCanaryError) {
        throw new HttpsError(
          error.code === "recipient_not_allowlisted" ? "permission-denied" : "invalid-argument",
          error.message,
        );
      }
      throw error;
    }

    const url = `https://graph.facebook.com/${graphVersion()}/${phoneNumberId}/messages`;
    let providerMessageId: string | null = null;
    let providerStatus = 0;
    try {
      const providerResponse = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${metaAccessToken.value()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      providerStatus = providerResponse.status;
      const providerJson = (await providerResponse.json().catch(() => null)) as
        | { messages?: Array<{ id?: string }>; error?: { message?: string; code?: number } }
        | null;
      if (!providerResponse.ok) {
        logger.error("meta-canary: provider send failed", {
          status: providerStatus,
          code: providerJson?.error?.code ?? null,
        });
        throw new HttpsError(
          "unavailable",
          `Meta declined the canary send (HTTP ${providerStatus}${
            providerJson?.error?.code ? `, code ${providerJson.error.code}` : ""
          }).`,
        );
      }
      providerMessageId = providerJson?.messages?.[0]?.id ?? null;
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("unavailable", "The canary send could not reach the Meta Graph API.");
    }

    const db = getCanaryFirestore(boundary.projectId);
    const outboundId = sha256Hex(
      `${providerMessageId ?? "unknown"}:${to}:${Date.now()}`,
    ).slice(0, 40);
    await db
      .collection("workspaces")
      .doc(META_CANARY_WORKSPACE_ID)
      .collection(META_CANARY_OUTBOUND_COLLECTION)
      .doc(outboundId)
      .create({
        id: outboundId,
        workspaceId: META_CANARY_WORKSPACE_ID,
        actorUid: request.auth.uid,
        toNumberSha256: sha256Hex(to),
        toNumberLast4: to.slice(-4),
        templateName: body.template && typeof body.template === "object"
          ? (body.template as { name?: string }).name ?? null
          : null,
        providerMessageId,
        providerStatus,
        canary: true,
        containsMessageContent: false,
        createdAt: FieldValue.serverTimestamp(),
        schemaVersion: 1,
      });

    return {
      sent: true,
      providerMessageId,
      toLast4: to.slice(-4),
      canary: true,
    };
  },
);
