/**
 * Hemas Connect LITE — governed callables.
 *
 * Governed callables power the "simple product" demo. Every provider-send
 * path reserves durable idempotency evidence before it reaches Meta.
 *
 * - liteDemoSetup       — idempotently creates membership documents for
 *                         pre-created synthetic Auth users. Only the synthetic
 *                         demo admin with the private setup claim may run it.
 * - liteClaimConversation — claim/release a conversation for a seat (the
 *                         Multi-Agent story). Membership is verified against
 *                         the workspace member doc, never trusted from input.
 * - liteSendAgentReply  — a REAL agent reply to a live WhatsApp visitor,
 *                         inside the 24h service window, routed only to the
 *                         explicit canary allowlist (number recovered by key
 *                         hash — no reverse mapping stored). The ledger entry
 *                         keeps its operational ledger content-free. The
 *                         exact canary text is retained separately for a
 *                         short governed window in backend-only storage.
 * - liteReconcileAgentReply — private evidence-only recovery for uncertain
 *                         reply outcomes. It never retries a provider send.
 */

import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import {
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { sha256Hex } from "../deterministic.js";
import { getHemasFirestore } from "../firestore-target.js";
import { liveIds } from "../meta-bot/bridge.js";
import { parseRecipientAllowlist } from "../meta-canary/contracts.js";
import { canaryBoundaryOrNull, metaAccessToken, sendGraphMessage } from "../meta-canary/graph.js";
import {
  META_CANARY_PROVIDER_ROUTES_COLLECTION,
  buildCanaryProviderRouteEvidence,
  resolveCanaryProviderRoute,
} from "../meta-canary/outbox.js";
import {
  LITE_BOOKING_OPERATIONS_COLLECTION,
  LITE_BOOKING_RECONCILIATIONS_COLLECTION,
  LiteBookingOperationError,
  assertBookingOperationId,
  assertBookingReconciliationInput,
  assertBookingTransitionCanReserve,
  bookingOperationDocumentId,
  bookingReconciliationDocumentId,
  bookingRequestSha256,
  decideBookingOperation,
  decideBookingReconciliation,
  evaluateBookingNotificationPolicy,
} from "./booking-operations.js";
import {
  LITE_CAMPAIGNS_COLLECTION,
  LITE_CAMPAIGN_RECIPIENT_OPERATIONS_COLLECTION,
  LITE_CAMPAIGN_RECONCILIATIONS_COLLECTION,
  LITE_CAMPAIGN_SENDS_COLLECTION,
  LiteCampaignError,
  assertCampaignContactIds,
  assertCampaignOperationId,
  assertCampaignReconciliationInput,
  assertTemplateSelection,
  assertValidCampaignName,
  campaignId,
  campaignReconciliationDocumentId,
  campaignRecipientOperationId,
  campaignRequestSha256,
  decideCampaignOperation,
  decideCampaignReconciliation,
  isEligibleCanaryCampaignContact,
  resolveAllowlistedContactAudience,
  sendDocIdForWamid,
} from "./campaigns.js";
import {
  LITE_AGENT_REPLIES_COLLECTION,
  LITE_REPLY_LEASES_COLLECTION,
  LITE_REPLY_OPERATIONS_COLLECTION,
  LITE_REPLY_RECONCILIATIONS_COLLECTION,
  LITE_SEATS,
  LITE_LOCATION_ID,
  LITE_TEAM_ID,
  LITE_WORKSPACE_ID,
  LiteError,
  assertLiteReplyReconciliationInput,
  assertLiteReplyOperationId,
  assertLiteAction,
  assertNoActiveLiteReplyLease,
  assertLiteReplyOwnership,
  assertLiteRoutingActionAllowed,
  assertValidReplyText,
  buildAgentReplyBody,
  buildLiteMemberDocument,
  decideLiteReplyOperation,
  decideLiteReplyReconciliation,
  evaluateLiteServiceReplyContactPolicy,
  hasLiteAdminSetupClaim,
  hasLiteCanarySendClaim,
  isActiveLiteTenantAdminMembership,
  liveConversationKey,
  resolveAllowlistedWaId,
} from "./contracts.js";
import { METRICS_COLLECTION, buildDailyMetricIncrement } from "./metrics.js";
import {
  PROTECTED_MESSAGE_ACCESS_AUDITS_COLLECTION,
  PROTECTED_MESSAGE_ACCESS_QUOTAS_COLLECTION,
  ProtectedInboxError,
  assertProtectedInboxAuthority,
  buildCoalescedProtectedMessageAccessAudit,
  buildProtectedInboxQuotaTransition,
  parseProtectedInboxRequest,
  protectedInboxAccessWindow,
  protectedInboxAuditId,
  protectedInboxQuotaId,
} from "./protected-inbox.js";
import {
  LITE_PROTECTED_MESSAGE_CONTENTS_COLLECTION,
  buildProtectedMessageContentDocument,
  normalizeProtectedMessageText,
  parseProtectedMessageContentForProjection,
  protectedAgentOperationContentId,
} from "./protected-messages.js";

const LITE_ROLES = ["agent", "supervisor", "tenant_admin"] as const;

function liteAdminApp(projectId: string): App {
  // Never call getApp() blind: some runtime states report registered apps
  // without a default one. Find the default explicitly or create it.
  const existing = getApps().find((candidate) => candidate.name === "[DEFAULT]");
  return existing ?? initializeApp({ projectId });
}

function liteFirestore(projectId: string): Firestore {
  return getHemasFirestore(liteAdminApp(projectId));
}

function boundaryOrThrow(): { projectId: string } {
  const boundary = canaryBoundaryOrNull();
  if (!boundary) {
    throw new HttpsError("failed-precondition", "The Lite lane is disabled outside the governed cloud demo.");
  }
  return boundary;
}

async function requireVerifiedLiteAdmin(
  db: Firestore,
  request: CallableRequest<unknown>,
): Promise<string> {
  const uid = typeof request.auth?.uid === "string" ? request.auth.uid.trim() : "";
  if (
    !uid ||
    request.auth?.token.email_verified !== true ||
    !hasLiteAdminSetupClaim(request.auth?.token)
  ) {
    throw new HttpsError(
      "permission-denied",
      "This action requires a verified private Lite administrator.",
    );
  }
  const membership = await db
    .collection("workspaces").doc(LITE_WORKSPACE_ID)
    .collection("members").doc(uid)
    .get();
  if (!membership.exists || !isActiveLiteTenantAdminMembership(membership.data(), uid)) {
    throw new HttpsError(
      "permission-denied",
      "This action requires a current Lite tenant administrator membership.",
    );
  }
  return uid;
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
      error.code === "route_not_allowlisted" || error.code === "not_assignee" ? "permission-denied" :
      error.code === "window_expired" ||
      error.code === "not_live" ||
      error.code === "contact_blocked" ||
      error.code === "already_assigned" ||
      error.code === "invalid_routing_state" ||
      error.code === "operation_terminal" ||
      error.code === "reconciliation_conflict" ||
      error.code === "reply_in_progress"
        ? "failed-precondition" :
      "invalid-argument";
    throw new HttpsError(code, error.message);
  }
  if (error instanceof LiteCampaignError) {
    const failedPrecondition = new Set([
      "empty_audience",
      "operation_conflict",
      "operation_in_progress",
      "operation_uncertain",
      "invalid_evidence",
      "reconciliation_conflict",
    ]);
    throw new HttpsError(
      failedPrecondition.has(error.code) ? "failed-precondition" : "invalid-argument",
      error.message,
    );
  }
  if (error instanceof LiteBookingOperationError) {
    throw new HttpsError(
      error.code === "invalid_operation" ? "invalid-argument" : "failed-precondition",
      error.message,
    );
  }
  if (error instanceof HttpsError) throw error;
  throw new HttpsError("internal", "The Lite lane could not complete the request.");
}

function mapProtectedInboxError(error: unknown): never {
  if (error instanceof ProtectedInboxError) {
    const code = error.code === "unauthenticated"
      ? "unauthenticated"
      : error.code === "invalid_argument"
        ? "invalid-argument"
        : error.code === "resource_exhausted"
          ? "resource-exhausted"
          : "permission-denied";
    throw new HttpsError(code, error.message);
  }
  if (error instanceof HttpsError) throw error;
  throw new HttpsError("internal", "Protected message content is unavailable.");
}

function isExactProtectedAgentContent(input: {
  readonly raw: unknown;
  readonly contentId: string;
  readonly conversationId: string;
  readonly expectedBodySha256: string;
  readonly expectedBodyLength: number;
  readonly expectedTeamId: string;
  readonly expectedLocationId: string;
  readonly allowedStates: readonly ("reserved" | "materialized" | "not_sent")[];
  readonly expectedMessageId?: string | null;
  readonly mustBeUnexpiredAtMs?: number;
}): boolean {
  if (typeof input.raw !== "object" || input.raw === null || Array.isArray(input.raw)) {
    return false;
  }
  const data = input.raw as Record<string, unknown>;
  const createdAt = data.createdAt;
  const updatedAt = data.updatedAt;
  const expireAt = data.expireAt;
  const expiresAtMs = data.expiresAtMs;
  const state = data.state;
  if (
    !(createdAt instanceof Timestamp) ||
    !(updatedAt instanceof Timestamp) ||
    !(expireAt instanceof Timestamp) ||
    typeof expiresAtMs !== "number" ||
    !Number.isSafeInteger(expiresAtMs) ||
    (state !== "reserved" && state !== "materialized" && state !== "not_sent") ||
    !input.allowedStates.includes(state) ||
    typeof data.text !== "string" ||
    data.bodySha256 !== input.expectedBodySha256 ||
    data.bodyLength !== input.expectedBodyLength ||
    (input.expectedMessageId !== undefined &&
      data.messageId !== input.expectedMessageId) ||
    (input.mustBeUnexpiredAtMs !== undefined &&
      expiresAtMs <= input.mustBeUnexpiredAtMs)
  ) {
    return false;
  }
  const createdAtMs = createdAt.toMillis();
  const updatedAtMs = updatedAt.toMillis();
  const expireAtMs = expireAt.toMillis();
  const retentionMs = expiresAtMs - createdAtMs;
  const retentionDays = retentionMs / (24 * 60 * 60 * 1_000);
  if (
    !Number.isInteger(retentionDays) ||
    retentionDays < 1 ||
    retentionDays > 30 ||
    expireAtMs !== expiresAtMs
  ) {
    return false;
  }
  try {
    const expected = buildProtectedMessageContentDocument({
      id: input.contentId,
      workspaceId: LITE_WORKSPACE_ID,
      conversationId: input.conversationId,
      messageId: data.messageId as string | null,
      direction: "outbound",
      source: "agent_reply",
      contentKind: "text",
      text: data.text,
      teamId: input.expectedTeamId,
      locationId: input.expectedLocationId,
      state,
      nowMs: updatedAtMs,
      createdAtMs,
      retentionDays,
    });
    const actualKeys = Object.keys(data).sort();
    const expectedKeys = Object.keys(expected).sort();
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key, index) => key !== expectedKeys[index])
    ) {
      return false;
    }
    return expectedKeys.every((key) => {
      const actualValue = data[key];
      const expectedValue = expected[key as keyof typeof expected];
      return expectedValue instanceof Timestamp
        ? actualValue instanceof Timestamp &&
          actualValue.toMillis() === expectedValue.toMillis()
        : actualValue === expectedValue;
    });
  } catch {
    return false;
  }
}

type LiteReplyNoSendReason =
  | "contact_invalid"
  | "suppress_all"
  | "invalid_contact"
  | "routing_changed"
  | "service_window_closed";

function replyNoSendPolicyError(reason: LiteReplyNoSendReason): LiteError {
  if (reason === "routing_changed") {
    return new LiteError(
      "invalid_routing_state",
      "The conversation assignment changed before send; no reply was sent.",
    );
  }
  if (reason === "service_window_closed") {
    return new LiteError(
      "window_expired",
      "The 24h service window closed before the reply could be sent.",
    );
  }
  return new LiteError(
    "contact_blocked",
    reason === "contact_invalid"
      ? "The contact's current delivery policy is invalid; no reply was sent."
      : "This contact has an all-channel delivery hold; no reply was sent.",
  );
}

function isExactProviderRoute(
  raw: unknown,
  providerMessageId: string,
  targetKind: "lite_agent_reply" | "lite_booking_notification",
  targetId: string,
): boolean {
  try {
    const resolved = resolveCanaryProviderRoute({
      route: raw,
      providerMessageId,
      sha256Hex,
    });
    return resolved?.targetKind === targetKind && resolved.targetId === targetId;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Seat provisioning
// ---------------------------------------------------------------------------

export const liteDemoSetup = onCall(
  { memory: "256MiB", timeoutSeconds: 60, maxInstances: 2 },
  async (request: CallableRequest<unknown>) => {
    const boundary = boundaryOrThrow();
    const db = liteFirestore(boundary.projectId);
    await requireVerifiedLiteAdmin(db, request);
    const auth = getAuth(liteAdminApp(boundary.projectId));
    const seats = await Promise.all(
      LITE_SEATS.map(async (seat) => {
        try {
          const existing = await auth.getUserByEmail(seat.email);
          return { seat, uid: existing.uid };
        } catch {
          throw new HttpsError(
            "failed-precondition",
            "A pre-created Lite Auth seat is missing. Provision identity outside this callable.",
          );
        }
      }),
    );
    const membershipBatch = db.batch();
    for (const { seat, uid } of seats) {
      membershipBatch.set(
        db
          .collection("workspaces").doc(LITE_WORKSPACE_ID)
          .collection("members").doc(uid),
        buildLiteMemberDocument(uid, seat),
        { merge: false },
      );
    }
    await membershipBatch.commit();

    logger.info("lite: seats provisioned", { count: seats.length });
    return {
      provisioned: seats.length,
      seats: seats.map(({ seat, uid }) => ({
        email: seat.email,
        displayLabel: seat.displayLabel,
        role: seat.role,
        uid,
      })),
    };
  },
);

// ---------------------------------------------------------------------------
// Protected canary message text (backend-only read with same-transaction audit)
// ---------------------------------------------------------------------------

type LiteProtectedMessagesInput = {
  readonly conversationId?: string;
  readonly messageIds?: readonly string[];
};

export const liteListProtectedMessages = onCall(
  { memory: "256MiB", timeoutSeconds: 30, maxInstances: 10 },
  async (request: CallableRequest<LiteProtectedMessagesInput>) => {
    const boundary = boundaryOrThrow();
    const db = liteFirestore(boundary.projectId);

    try {
      const selection = parseProtectedInboxRequest(request.data);
      const uid = request.auth?.uid;
      const actorUid = typeof uid === "string" && uid.length > 0
        ? uid
        : "anonymous";
      const nowMs = Date.now();
      const now = Timestamp.fromMillis(nowMs);
      const accessWindow = protectedInboxAccessWindow(nowMs);
      const windowStartedAt = Timestamp.fromMillis(
        accessWindow.windowStartMs,
      );
      const quotaExpireAt = Timestamp.fromMillis(
        accessWindow.quotaExpiresAtMs,
      );
      const auditExpireAt = Timestamp.fromMillis(
        accessWindow.auditExpiresAtMs,
      );
      const ws = db.collection("workspaces").doc(LITE_WORKSPACE_ID);
      const conversationRef = ws
        .collection("conversations")
        .doc(selection.conversationId);
      const protectedContents = conversationRef.collection(
        LITE_PROTECTED_MESSAGE_CONTENTS_COLLECTION,
      );
      const quotaId = protectedInboxQuotaId({
        workspaceId: LITE_WORKSPACE_ID,
        actorUid,
        windowStartMs: accessWindow.windowStartMs,
        sha256Hex,
      });
      const auditId = protectedInboxAuditId({
        workspaceId: LITE_WORKSPACE_ID,
        actorUid,
        conversationId: selection.conversationId,
        windowStartMs: accessWindow.windowStartMs,
        sha256Hex,
      });
      const quotaRef = ws
        .collection(PROTECTED_MESSAGE_ACCESS_QUOTAS_COLLECTION)
        .doc(quotaId);
      const auditRef = ws
        .collection(PROTECTED_MESSAGE_ACCESS_AUDITS_COLLECTION)
        .doc(auditId);
      const messageIdChunks: string[][] = [];
      for (let index = 0; index < selection.messageIds.length; index += 30) {
        messageIdChunks.push(selection.messageIds.slice(index, index + 30));
      }

      const messages = await db.runTransaction(async (transaction) => {
        const [
          workspaceSnapshot,
          memberSnapshot,
          conversationSnapshot,
          quotaSnapshot,
          auditSnapshot,
        ] =
          await Promise.all([
            transaction.get(ws),
            transaction.get(ws.collection("members").doc(actorUid)),
            transaction.get(conversationRef),
            transaction.get(quotaRef),
            transaction.get(auditRef),
          ]);
        const authority = assertProtectedInboxAuthority({
          workspaceId: LITE_WORKSPACE_ID,
          authUid: uid,
          emailVerified: request.auth?.token.email_verified,
          workspace: workspaceSnapshot.data(),
          membership: memberSnapshot.data(),
          conversationId: selection.conversationId,
          conversation: conversationSnapshot.data(),
        });
        const quotaTransition = buildProtectedInboxQuotaTransition({
          existing: quotaSnapshot.data(),
          id: quotaId,
          workspaceId: LITE_WORKSPACE_ID,
          actorUid: authority.uid,
          window: accessWindow,
          windowStartedAt,
          occurredAt: now,
          expireAt: quotaExpireAt,
        });

        const byMessageId = new Map<string, string>();
        for (const chunk of messageIdChunks) {
          const snapshot = await transaction.get(
            protectedContents.where("messageId", "in", chunk),
          );
          for (const document of snapshot.docs) {
            const projection = parseProtectedMessageContentForProjection(
              document.data(),
              {
                workspaceId: LITE_WORKSPACE_ID,
                conversationId: selection.conversationId,
                teamId: authority.teamId,
                locationId: authority.locationId,
                nowMs,
              },
            );
            if (!projection || projection.id !== document.id) continue;
            if (byMessageId.has(projection.messageId)) {
              throw new Error("protected_message_duplicate");
            }
            byMessageId.set(projection.messageId, projection.text);
          }
        }
        const selectedMessages = selection.messageIds.flatMap((messageId) => {
          const text = byMessageId.get(messageId);
          return text === undefined ? [] : [{ messageId, text }];
        });
        const accessAudit = buildCoalescedProtectedMessageAccessAudit({
          existing: auditSnapshot.data(),
          id: auditId,
          workspaceId: LITE_WORKSPACE_ID,
          authority,
          conversationId: selection.conversationId,
          recordCount: selectedMessages.length,
          window: accessWindow,
          windowStartedAt,
          occurredAt: now,
          expireAt: auditExpireAt,
        });
        transaction.set(quotaRef, quotaTransition, { merge: false });
        transaction.set(auditRef, accessAudit, { merge: false });
        return selectedMessages;
      });

      return { messages };
    } catch (error) {
      logger.warn("lite: protected inbox request rejected", {
        code: error instanceof ProtectedInboxError
          ? error.code
          : error instanceof HttpsError
            ? error.code
            : "internal",
        reason: error instanceof ProtectedInboxError ? error.message : undefined,
      });
      mapProtectedInboxError(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Doctor directory management (synthetic demo data only)
// ---------------------------------------------------------------------------

type LiteDoctorInput = {
  readonly doctorId?: string;
  readonly name?: string;
  readonly departmentId?: string;
  readonly hospital?: string;
  readonly active?: boolean;
};

export const liteUpsertDoctor = onCall(
  { memory: "256MiB", timeoutSeconds: 30, maxInstances: 3 },
  async (request: CallableRequest<LiteDoctorInput>) => {
    const boundary = boundaryOrThrow();
    const db = liteFirestore(boundary.projectId);
    const member = await requireLiteMember(db, request);
    if (member.role !== "supervisor" && member.role !== "tenant_admin") {
      throw new HttpsError("permission-denied", "Doctor management needs a supervisor or admin seat.");
    }
    const name = typeof request.data?.name === "string" ? request.data.name.trim().slice(0, 80) : "";
    const departmentId = typeof request.data?.departmentId === "string" ? request.data.departmentId.trim() : "";
    const hospital = request.data?.hospital === "Thalawathugoda" ? "Thalawathugoda" : "Wattala";
    if (name.length < 3 || !/^dept_[a-z]{2,20}$/.test(departmentId)) {
      throw new HttpsError("invalid-argument", "Doctor needs a name (3+ chars) and a valid department.");
    }
    const id =
      typeof request.data?.doctorId === "string" && /^doc_[a-z0-9_]{2,40}$/.test(request.data.doctorId)
        ? request.data.doctorId
        : `doc_${sha256Hex(`${name}:${Date.now()}`).slice(0, 8)}`;
    const label = name.toLowerCase().includes("demo") ? name : `${name} (demo)`;
    await db
      .collection("workspaces").doc(LITE_WORKSPACE_ID)
      .collection("lite_doctors").doc(id)
      .set(
        {
          id, workspaceId: LITE_WORKSPACE_ID, name: label, departmentId, hospital,
          active: request.data?.active !== false, synthetic: true,
          updatedAt: Timestamp.now(), schemaVersion: 1,
        },
        { merge: true },
      );
    return { ok: true, doctorId: id };
  },
);

// ---------------------------------------------------------------------------
// Booking status (confirm / cancel) with real WhatsApp notification
// ---------------------------------------------------------------------------

const BOOKING_NOTIFY: Record<string, Record<string, (ref: string) => string>> = {
  confirmed: {
    en: (r) => `✅ Your appointment request ${r} is CONFIRMED by our care team. See you at the hospital! (Demo service)`,
    si: (r) => `✅ ඔබගේ හමුවීම් ඉල්ලීම ${r} සත්කාර කණ්ඩායම විසින් තහවුරු කරන ලදී. (ආදර්ශන සේවාව)`,
    ta: (r) => `✅ உங்கள் சந்திப்புக் கோரிக்கை ${r} எங்கள் குழுவால் உறுதிப்படுத்தப்பட்டது. (மாதிரி சேவை)`,
  },
  cancelled: {
    en: (r) => `ℹ️ Your appointment request ${r} was cancelled by the care team. Reply MENU to book again. (Demo service)`,
    si: (r) => `ℹ️ ඔබගේ හමුවීම් ඉල්ලීම ${r} අවලංගු කරන ලදී. නැවත වෙන්කිරීමට MENU ලියන්න. (ආදර්ශන සේවාව)`,
    ta: (r) => `ℹ️ உங்கள் சந்திப்புக் கோரிக்கை ${r} ரத்து செய்யப்பட்டது. மீண்டும் பதிவு செய்ய MENU அனுப்பவும். (மாதிரி சேவை)`,
  },
};

type LiteBookingStatusInput = {
  readonly bookingId?: string;
  readonly operationId?: string;
  readonly status?: string;
};

export const liteSetBookingStatus = onCall(
  { memory: "256MiB", timeoutSeconds: 30, maxInstances: 3, secrets: [metaAccessToken] },
  async (request: CallableRequest<LiteBookingStatusInput>) => {
    const boundary = boundaryOrThrow();
    const db = liteFirestore(boundary.projectId);
    const member = await requireLiteMember(db, request);
    try {
    if (!hasLiteCanarySendClaim(request.auth?.token)) {
      throw new HttpsError(
        "permission-denied",
        "This Lite seat is not enabled for governed canary provider sends.",
      );
    }
    const operationId = assertBookingOperationId(request.data?.operationId);
    const requestedStatus = request.data?.status;
    if (requestedStatus !== "confirmed" && requestedStatus !== "cancelled") {
      throw new HttpsError("invalid-argument", "Booking status must be confirmed or cancelled.");
    }
    const status = requestedStatus;
    const bookingId =
      typeof request.data?.bookingId === "string" ? request.data.bookingId.trim() : "";
    if (!/^HC-\d{5}-[0-9a-f]{10}$/.test(bookingId)) {
      throw new HttpsError("invalid-argument", "Unknown booking id.");
    }
    const allowlist = parseRecipientAllowlist(process.env.HEMAS_META_ALLOWLISTED_RECIPIENTS);
    const phoneNumberId = process.env.HEMAS_META_PHONE_NUMBER_ID?.trim() ?? "";
    const requestSha256 = bookingRequestSha256(
      { operationId, bookingId, status },
      sha256Hex,
    );
    const operationDocumentId = bookingOperationDocumentId(operationId, sha256Hex);
    const ws = db.collection("workspaces").doc(LITE_WORKSPACE_ID);
    const bookingRef = ws.collection("canary_bookings").doc(bookingId);
    const operationRef = ws
      .collection(LITE_BOOKING_OPERATIONS_COLLECTION)
      .doc(operationDocumentId);

    const reservation = await db.runTransaction(async (transaction) => {
      const operationSnapshot = await transaction.get(operationRef);
      const decision = decideBookingOperation(operationSnapshot.data(), {
        documentId: operationDocumentId,
        operationId,
        actorUid: member.uid,
        bookingId,
        status,
        requestSha256,
      });
      if (decision.kind === "replay") {
        if (decision.result.notified) {
          const operation = operationSnapshot.data();
          const providerMessageId =
            typeof operation?.providerMessageId === "string"
              ? operation.providerMessageId
              : "";
          const routeEvidence = buildCanaryProviderRouteEvidence({
            providerMessageId,
            targetKind: "lite_booking_notification",
            targetId: operationDocumentId,
            sha256Hex,
          });
          const routeSnapshot = await transaction.get(
            ws
              .collection(META_CANARY_PROVIDER_ROUTES_COLLECTION)
              .doc(routeEvidence.id),
          );
          if (
            !routeSnapshot.exists ||
            !isExactProviderRoute(
              routeSnapshot.data(),
              providerMessageId,
              "lite_booking_notification",
              operationDocumentId,
            )
          ) {
            throw new LiteBookingOperationError(
              "invalid_evidence",
              "Completed booking provider-route evidence is missing or malformed.",
            );
          }
        }
        return decision;
      }

      const bookingSnapshot = await transaction.get(bookingRef);
      const booking = bookingSnapshot.data();
      if (!bookingSnapshot.exists || !booking) {
        throw new HttpsError("not-found", "Unknown booking id.");
      }
      const visitorKey = typeof booking.visitorKey === "string" ? booking.visitorKey : "";
      const conversationId =
        typeof booking.conversationId === "string" ? booking.conversationId : "";
      if (
        !/^[0-9a-f]{10}$/.test(visitorKey) ||
        conversationId !== `conversation_live_${visitorKey}`
      ) {
        throw new LiteBookingOperationError(
          "invalid_evidence",
          "Booking routing evidence is malformed.",
        );
      }
      const contactId = `contact_live_${visitorKey}`;
      const conversationRef = ws.collection("conversations").doc(conversationId);
      const contactRef = ws.collection("contacts").doc(contactId);
      const [conversationSnapshot, contactSnapshot] = await Promise.all([
        transaction.get(conversationRef),
        transaction.get(contactRef),
      ]);
      const waId = resolveAllowlistedWaId(visitorKey, allowlist, sha256Hex);
      const language =
        booking.language === "si" || booking.language === "ta" ? booking.language : "en";
      const reference =
        typeof booking.reference === "string" ? booking.reference : bookingId.slice(0, 8);
      const now = Timestamp.now();
      const policy = evaluateBookingNotificationPolicy(
        conversationSnapshot.data(),
        contactSnapshot.data(),
        {
          workspaceId: LITE_WORKSPACE_ID,
          conversationId,
          contactId,
          nowMs: now.toMillis(),
        },
      );
      const policyReason = "reason" in policy ? policy.reason : null;
      const routeReady = Boolean(waId) && /^\d{5,32}$/.test(phoneNumberId);
      const sendable = policy.eligible && routeReady;
      if (decision.kind === "reserve") {
        if (
          typeof booking.activeStatusOperationId === "string" &&
          booking.activeStatusOperationId.trim()
        ) {
          throw new LiteBookingOperationError(
            "operation_in_progress",
            "Another booking notification transition is still active.",
          );
        }
        assertBookingTransitionCanReserve(booking.status, status);
        transaction.create(operationRef, {
          id: operationDocumentId,
          workspaceId: LITE_WORKSPACE_ID,
          operationId,
          requestSha256,
          actorUid: member.uid,
          bookingId,
          targetStatus: status,
          conversationId,
          contactId,
          status: sendable ? "reserved" : "completed",
          notified: false,
          providerMessageId: null,
          policyReason: sendable
            ? null
            : policyReason ?? "route_unavailable",
          toNumberSha256: waId ? sha256Hex(waId) : null,
          toNumberLast4: waId ? waId.slice(-4) : null,
          containsMessageContent: false,
          createdAt: now,
          updatedAt: now,
          ...(sendable ? {} : { completedAt: now }),
          schemaVersion: 1,
        });
        transaction.set(
          bookingRef,
          {
            status,
            statusActorUid: member.uid,
            statusUpdatedAt: now,
            activeStatusOperationId: sendable ? operationId : null,
          },
          { merge: true },
        );
      } else if (booking.activeStatusOperationId !== operationId) {
        throw new LiteBookingOperationError(
          "invalid_evidence",
          "Booking and notification reservation are no longer joined.",
        );
      } else if (!sendable) {
        transaction.set(
          operationRef,
          {
            status: "completed",
            notified: false,
            policyReason: policyReason ?? "route_unavailable",
            completedAt: now,
            updatedAt: now,
          },
          { merge: true },
        );
        transaction.set(
          bookingRef,
          { activeStatusOperationId: null, statusUpdatedAt: now },
          { merge: true },
        );
      }
      return sendable
        ? {
            kind: "reserved" as const,
            waId: waId!,
            language,
            reference,
            conversationId,
            contactId,
          }
        : { kind: "skip" as const };
    });

    if (reservation.kind === "replay") return reservation.result;
    if (reservation.kind === "skip") {
      logger.info("lite: booking status set", { status, notified: false });
      return { ok: true, bookingId, status, notified: false, idempotent: false };
    }

    const preSend = await db.runTransaction(async (transaction) => {
      const [operationSnapshot, bookingSnapshot, conversationSnapshot, contactSnapshot] = await Promise.all([
        transaction.get(operationRef),
        transaction.get(bookingRef),
        transaction.get(ws.collection("conversations").doc(reservation.conversationId)),
        transaction.get(ws.collection("contacts").doc(reservation.contactId)),
      ]);
      const operation = operationSnapshot.data();
      const booking = bookingSnapshot.data();
      if (
        !operationSnapshot.exists ||
        !operation ||
        operation.operationId !== operationId ||
        operation.requestSha256 !== requestSha256 ||
        operation.status !== "reserved" ||
        operation.conversationId !== reservation.conversationId ||
        operation.contactId !== reservation.contactId ||
        !bookingSnapshot.exists ||
        !booking ||
        booking.id !== bookingId ||
        booking.workspaceId !== LITE_WORKSPACE_ID ||
        booking.status !== status ||
        booking.activeStatusOperationId !== operationId
      ) {
        throw new LiteBookingOperationError(
          "operation_in_progress",
          "Booking notification reservation is no longer sendable.",
        );
      }
      const now = Timestamp.now();
      const policy = evaluateBookingNotificationPolicy(
        conversationSnapshot.data(),
        contactSnapshot.data(),
        {
          workspaceId: LITE_WORKSPACE_ID,
          conversationId: reservation.conversationId,
          contactId: reservation.contactId,
          nowMs: now.toMillis(),
        },
      );
      if ("reason" in policy) {
        transaction.set(
          operationRef,
          {
            status: "completed",
            notified: false,
            policyReason: policy.reason,
            completedAt: now,
            updatedAt: now,
          },
          { merge: true },
        );
        transaction.set(
          bookingRef,
          { activeStatusOperationId: null, statusUpdatedAt: now },
          { merge: true },
        );
        return { send: false as const, reason: policy.reason };
      }
      transaction.set(
        operationRef,
        { status: "sending", attemptStartedAt: now, updatedAt: now },
        { merge: true },
      );
      return { send: true as const };
    });
    if (!preSend.send) {
      logger.info("lite: booking notification skipped by current policy", {
        reason: preSend.reason,
      });
      return { ok: true, bookingId, status, notified: false, idempotent: false };
    }

    let providerMessageId: string;
    try {
      const result = await sendGraphMessage(
        phoneNumberId,
        metaAccessToken.value(),
        reservation.waId,
        {
          type: "text",
          text: {
            preview_url: false,
            body: BOOKING_NOTIFY[status]![reservation.language]!(reservation.reference),
          },
        },
      );
      if (!result.providerMessageId) {
        throw new Error("Provider result did not include a message id.");
      }
      providerMessageId = result.providerMessageId;
    } catch (error) {
      await operationRef
        .set(
          {
            status: "send_uncertain",
            failureCode: "provider_result_unavailable",
            updatedAt: Timestamp.now(),
          },
          { merge: true },
        )
        .catch(() => undefined);
      logger.warn("lite: booking notify outcome uncertain", {
        reason: error instanceof Error ? error.message : "unknown",
      });
      throw new HttpsError(
        "unavailable",
        "Booking status was saved, but the WhatsApp notification outcome is uncertain.",
      );
    }

    const completedAtMs = Date.now();
    const completedAt = Timestamp.fromMillis(completedAtMs);
    const bookingProviderRoute = buildCanaryProviderRouteEvidence({
      providerMessageId,
      targetKind: "lite_booking_notification",
      targetId: operationDocumentId,
      sha256Hex,
    });
    const completedBatch = db.batch();
    completedBatch.set(
      operationRef,
      {
        status: "completed",
        notified: true,
        providerMessageId,
        completedAt,
        updatedAt: completedAt,
      },
      { merge: true },
    );
    completedBatch.create(
      ws
        .collection(META_CANARY_PROVIDER_ROUTES_COLLECTION)
        .doc(bookingProviderRoute.id),
      {
        ...bookingProviderRoute,
        createdAt: completedAt,
        updatedAt: completedAt,
      },
    );
    completedBatch.set(
      bookingRef,
      { activeStatusOperationId: null, statusUpdatedAt: completedAt },
      { merge: true },
    );
    const bookingMetric = buildDailyMetricIncrement(
      LITE_WORKSPACE_ID,
      completedAtMs,
      { apiRequests: 1 },
    );
    if (bookingMetric) {
      completedBatch.set(
        ws.collection(METRICS_COLLECTION).doc(bookingMetric.id),
        bookingMetric.data,
        { merge: true },
      );
    }
    await completedBatch.commit();
    logger.info("lite: booking status set", { status, notified: true });
    return { ok: true, bookingId, status, notified: true, idempotent: false };
    } catch (error) {
      mapLiteError(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Private booking-notification reconciliation (evidence only; never sends)
// ---------------------------------------------------------------------------

export const liteReconcileBookingNotification = onCall(
  { memory: "256MiB", timeoutSeconds: 30, maxInstances: 1 },
  async (request: CallableRequest<unknown>) => {
    const boundary = boundaryOrThrow();
    const db = liteFirestore(boundary.projectId);
    const adminUid = await requireVerifiedLiteAdmin(db, request);

    try {
      const input = assertBookingReconciliationInput(request.data);
      const ws = db.collection("workspaces").doc(LITE_WORKSPACE_ID);
      const operationDocumentId = bookingOperationDocumentId(input.operationId, sha256Hex);
      const operationRef = ws
        .collection(LITE_BOOKING_OPERATIONS_COLLECTION)
        .doc(operationDocumentId);
      const reconciliationId = bookingReconciliationDocumentId(
        input.operationId,
        input.outcome,
        input.providerEvidenceSha256,
        sha256Hex,
      );
      const reconciliationRef = ws
        .collection(LITE_BOOKING_RECONCILIATIONS_COLLECTION)
        .doc(reconciliationId);
      const providerRoute =
        input.outcome === "sent" && input.providerMessageId
          ? buildCanaryProviderRouteEvidence({
              providerMessageId: input.providerMessageId,
              targetKind: "lite_booking_notification",
              targetId: operationDocumentId,
              sha256Hex,
            })
          : null;
      const providerRouteRef = providerRoute
        ? ws
            .collection(META_CANARY_PROVIDER_ROUTES_COLLECTION)
            .doc(providerRoute.id)
        : null;

      const result = await db.runTransaction(async (transaction) => {
        const [operationSnapshot, auditSnapshot, providerRouteSnapshot] = await Promise.all([
          transaction.get(operationRef),
          transaction.get(reconciliationRef),
          providerRouteRef ? transaction.get(providerRouteRef) : Promise.resolve(null),
        ]);
        const decision = decideBookingReconciliation(
          operationSnapshot.data(),
          input,
          {
            documentId: operationDocumentId,
            workspaceId: LITE_WORKSPACE_ID,
            nowMs: Date.now(),
          },
        );
        if (decision.kind === "already_reconciled") {
          const audit = auditSnapshot.data();
          if (
            !auditSnapshot.exists ||
            !audit ||
            audit.id !== reconciliationId ||
            audit.workspaceId !== LITE_WORKSPACE_ID ||
            audit.operationId !== input.operationId ||
            audit.requestSha256 !== input.requestSha256 ||
            audit.outcome !== input.outcome ||
            audit.providerMessageId !== input.providerMessageId ||
            audit.providerEvidenceSha256 !== input.providerEvidenceSha256 ||
            audit.bookingId !== decision.bookingId ||
            audit.targetStatus !== decision.status ||
            audit.notified !== decision.notified
          ) {
            throw new LiteBookingOperationError(
              "invalid_evidence",
              "Booking reconciliation audit evidence is missing or malformed.",
            );
          }
          if (
            decision.notified &&
            (!providerRouteSnapshot?.exists ||
              !input.providerMessageId ||
              !isExactProviderRoute(
                providerRouteSnapshot.data(),
                input.providerMessageId,
                "lite_booking_notification",
                operationDocumentId,
              ))
          ) {
            throw new LiteBookingOperationError(
              "invalid_evidence",
              "Booking provider-route evidence is missing or malformed.",
            );
          }
          return decision;
        }
        if (auditSnapshot.exists || providerRouteSnapshot?.exists) {
          throw new LiteBookingOperationError(
            "reconciliation_conflict",
            "Booking reconciliation evidence id already exists.",
          );
        }
        const operation = operationSnapshot.data();
        const bookingId =
          typeof operation?.bookingId === "string" ? operation.bookingId : "";
        const bookingRef = ws.collection("canary_bookings").doc(bookingId);
        const bookingSnapshot = await transaction.get(bookingRef);
        const booking = bookingSnapshot.data();
        if (
          !bookingSnapshot.exists ||
          !booking ||
          booking.id !== decision.bookingId ||
          booking.workspaceId !== LITE_WORKSPACE_ID ||
          booking.status !== decision.status ||
          booking.activeStatusOperationId !== input.operationId
        ) {
          throw new LiteBookingOperationError(
            "invalid_evidence",
            "Booking status and notification operation are no longer joined.",
          );
        }
        const now = Timestamp.now();
        transaction.set(
          operationRef,
          {
            status: "completed",
            notified: decision.notified,
            providerMessageId: input.providerMessageId,
            failureCode: null,
            reconciliationId,
            reconciliationOutcome: input.outcome,
            reconciliationRequestSha256: input.requestSha256,
            reconciliationEvidenceSha256: input.providerEvidenceSha256,
            reconciledByUid: adminUid,
            reconciledAt: now,
            completedAt: now,
            updatedAt: now,
          },
          { merge: true },
        );
        transaction.set(
          bookingRef,
          { activeStatusOperationId: null, statusUpdatedAt: now },
          { merge: true },
        );
        transaction.create(reconciliationRef, {
          id: reconciliationId,
          workspaceId: LITE_WORKSPACE_ID,
          operationId: input.operationId,
          requestSha256: input.requestSha256,
          bookingId: decision.bookingId,
          targetStatus: decision.status,
          outcome: input.outcome,
          notified: decision.notified,
          providerMessageId: input.providerMessageId,
          providerEvidenceSha256: input.providerEvidenceSha256,
          actorUid: adminUid,
          containsMessageContent: false,
          createdAt: now,
          schemaVersion: 1,
        });
        if (providerRouteRef && providerRoute) {
          transaction.create(providerRouteRef, {
            ...providerRoute,
            createdAt: now,
            updatedAt: now,
          });
        }
        if (decision.notified) {
          const metric = buildDailyMetricIncrement(
            LITE_WORKSPACE_ID,
            now.toMillis(),
            { apiRequests: 1 },
          );
          if (metric) {
            transaction.set(
              ws.collection(METRICS_COLLECTION).doc(metric.id),
              metric.data,
              { merge: true },
            );
          }
        }
        return decision;
      });

      logger.info("lite: booking provider evidence reconciled", {
        outcome: input.outcome,
        idempotent: result.kind === "already_reconciled",
      });
      return {
        ok: true,
        operationId: input.operationId,
        bookingId: result.bookingId,
        status: result.status,
        notified: result.notified,
        outcome: input.outcome,
        idempotent: result.kind === "already_reconciled",
      };
    } catch (error) {
      mapLiteError(error);
    }
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
      const leaseRef = db
        .collection("workspaces").doc(LITE_WORKSPACE_ID)
        .collection(LITE_REPLY_LEASES_COLLECTION).doc(conversationId);
      const assigneeId = await db.runTransaction(async (transaction) => {
        const [snap, lease] = await Promise.all([
          transaction.get(ref),
          transaction.get(leaseRef),
        ]);
        const data = snap.data();
        if (
          !snap.exists ||
          !data ||
          data.workspaceId !== LITE_WORKSPACE_ID ||
          data.synthetic !== true
        ) {
          throw new LiteError("invalid_conversation", "Unknown conversation id.");
        }
        assertNoActiveLiteReplyLease(lease.data());
        assertLiteRoutingActionAllowed(action, data.assigneeId, member.uid);
        const now = Timestamp.now();
        if (action === "claim") {
          transaction.set(
            ref,
            {
              assigneeId: member.uid,
              status: "assigned",
              mode: "human_takeover",
              unreadCount: 0,
              updatedAt: now,
            },
            { merge: true },
          );
          return member.uid;
        }
        transaction.set(
          ref,
          { assigneeId: null, status: "active", mode: "automation", updatedAt: now },
          { merge: true },
        );
        return null;
      });

      logger.info("lite: conversation routing updated", { action, role: member.role });
      return { ok: true, action, conversationId, assigneeId };
    } catch (error) {
      mapLiteError(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Live agent reply (real WhatsApp send, governed)
// ---------------------------------------------------------------------------

type LiteReplyInput = {
  readonly conversationId?: string;
  readonly operationId?: string;
  readonly text?: string;
};

export const liteSendAgentReply = onCall(
  { memory: "256MiB", timeoutSeconds: 30, maxInstances: 5, secrets: [metaAccessToken] },
  async (request: CallableRequest<LiteReplyInput>) => {
    const boundary = boundaryOrThrow();
    const db = liteFirestore(boundary.projectId);
    const member = await requireLiteMember(db, request);

    try {
      if (!hasLiteCanarySendClaim(request.auth?.token)) {
        throw new HttpsError(
          "permission-denied",
          "This Lite seat is not enabled for governed canary provider sends.",
        );
      }
      const text = normalizeProtectedMessageText(
        assertValidReplyText(request.data?.text),
      );
      if (!text) {
        throw new LiteError("invalid_text", "Reply text is required.");
      }
      const operationId = assertLiteReplyOperationId(request.data?.operationId);
      const bodySha256 = sha256Hex(text);
      const conversationId =
        typeof request.data?.conversationId === "string" ? request.data.conversationId.trim() : "";
      const key = liveConversationKey(conversationId);

      const ws = db.collection("workspaces").doc(LITE_WORKSPACE_ID);
      const contactId = `contact_live_${key}`;
      const conversationRef = db
        .collection("workspaces").doc(LITE_WORKSPACE_ID)
        .collection("conversations").doc(conversationId);
      const contactRef = ws.collection("contacts").doc(contactId);
      const leaseRef = ws.collection(LITE_REPLY_LEASES_COLLECTION).doc(conversationId);
      const operationRef = ws
        .collection(LITE_REPLY_OPERATIONS_COLLECTION)
        .doc(operationId);
      const messageId = `message_live_${sha256Hex(`${operationId}:agent`).slice(0, 16)}`;
      const protectedContentId = protectedAgentOperationContentId(operationId);
      const protectedContentRef = conversationRef
        .collection(LITE_PROTECTED_MESSAGE_CONTENTS_COLLECTION)
        .doc(protectedContentId);

      const preflight = decideLiteReplyOperation(
        (await operationRef.get()).data(),
        operationId,
        conversationId,
        member.uid,
        bodySha256,
      );
      if (preflight.kind === "already_sent") {
        const routeEvidence = buildCanaryProviderRouteEvidence({
          providerMessageId: preflight.providerMessageId,
          targetKind: "lite_agent_reply",
          targetId: operationId,
          sha256Hex,
        });
        const routeSnapshot = await ws
          .collection(META_CANARY_PROVIDER_ROUTES_COLLECTION)
          .doc(routeEvidence.id)
          .get();
        if (
          !routeSnapshot.exists ||
          !isExactProviderRoute(
            routeSnapshot.data(),
            preflight.providerMessageId,
            "lite_agent_reply",
            operationId,
          )
        ) {
          throw new LiteError(
            "invalid_evidence",
            "Completed reply provider-route evidence is missing or malformed.",
          );
        }
        return {
          sent: true,
          idempotent: true,
          conversationId,
          providerMessageId: preflight.providerMessageId,
        };
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

      const reservation = await db.runTransaction(async (transaction) => {
        const [snap, contact, lease, operation, protectedContent] = await Promise.all([
          transaction.get(conversationRef),
          transaction.get(contactRef),
          transaction.get(leaseRef),
          transaction.get(operationRef),
          transaction.get(protectedContentRef),
        ]);
        const decision = decideLiteReplyOperation(
          operation.data(),
          operationId,
          conversationId,
          member.uid,
          bodySha256,
        );
        if (decision.kind === "already_sent") {
          const routeEvidence = buildCanaryProviderRouteEvidence({
            providerMessageId: decision.providerMessageId,
            targetKind: "lite_agent_reply",
            targetId: operationId,
            sha256Hex,
          });
          const routeSnapshot = await transaction.get(
            ws
              .collection(META_CANARY_PROVIDER_ROUTES_COLLECTION)
              .doc(routeEvidence.id),
          );
          if (
            !routeSnapshot.exists ||
            !isExactProviderRoute(
              routeSnapshot.data(),
              decision.providerMessageId,
              "lite_agent_reply",
              operationId,
            )
          ) {
            throw new LiteError(
              "invalid_evidence",
              "Completed reply provider-route evidence is missing or malformed.",
            );
          }
          return decision;
        }

        const conversation = snap.data();
        if (
          !snap.exists ||
          !conversation ||
          conversation.id !== conversationId ||
          conversation.workspaceId !== LITE_WORKSPACE_ID ||
          conversation.contactId !== contactId
        ) {
          throw new LiteError("invalid_conversation", "Unknown conversation id.");
        }
        if (conversation.liveCanary !== true) {
          throw new LiteError(
            "not_live",
            "Only live canary conversations can receive WhatsApp replies.",
          );
        }
        assertNoActiveLiteReplyLease(lease.data());
        assertLiteReplyOwnership(conversation, member.uid);
        const windowExpiresAt = conversation.serviceWindowExpiresAt;
        if (!(windowExpiresAt instanceof Timestamp) || windowExpiresAt.toMillis() <= Date.now()) {
          throw new LiteError(
            "window_expired",
            "The 24h service window is closed — ask the visitor to message again, or use an approved template.",
          );
        }
        const teamId =
          typeof conversation.teamId === "string" ? conversation.teamId : LITE_TEAM_ID;
        const locationId =
          typeof conversation.locationId === "string"
            ? conversation.locationId
            : LITE_LOCATION_ID;
        const now = Timestamp.now();
        const contactPolicy = evaluateLiteServiceReplyContactPolicy(
          contact.data(),
          contactId,
        );
        const blockedReason = "reason" in contactPolicy ? contactPolicy.reason : null;
        transaction.create(operationRef, {
          id: operationId,
          workspaceId: LITE_WORKSPACE_ID,
          operationId,
          conversationId,
          contactId,
          actorUid: member.uid,
          bodySha256,
          bodyLength: text.length,
          teamId,
          locationId,
          toNumberSha256: sha256Hex(waId),
          toNumberLast4: waId.slice(-4),
          status: blockedReason ? "not_sent" : "sending",
          providerMessageId: null,
          policyReason: blockedReason,
          containsMessageContent: false,
          createdAt: now,
          updatedAt: now,
          ...(blockedReason ? { completedAt: now } : {}),
          schemaVersion: 1,
        });
        if (blockedReason) {
          return { kind: "blocked" as const, reason: blockedReason };
        }
        if (protectedContent.exists) {
          throw new LiteError(
            "invalid_evidence",
            "Protected reply reservation evidence already exists.",
          );
        }
        transaction.create(
          protectedContentRef,
          buildProtectedMessageContentDocument({
            id: protectedContentId,
            workspaceId: LITE_WORKSPACE_ID,
            conversationId,
            messageId: null,
            direction: "outbound",
            source: "agent_reply",
            contentKind: "text",
            text,
            teamId,
            locationId,
            state: "reserved",
            nowMs: now.toMillis(),
            retentionDays: process.env.HEMAS_PROTECTED_MESSAGE_RETENTION_DAYS,
          }),
        );
        transaction.set(
          leaseRef,
          {
            id: conversationId,
            workspaceId: LITE_WORKSPACE_ID,
            conversationId,
            activeOperationId: operationId,
            actorUid: member.uid,
            status: "sending",
            containsMessageContent: false,
            createdAt: now,
            updatedAt: now,
            schemaVersion: 1,
          },
          { merge: false },
        );
        return { kind: "reserve" as const, teamId, locationId };
      });

      if (reservation.kind === "already_sent") {
        return {
          sent: true,
          idempotent: true,
          conversationId,
          providerMessageId: reservation.providerMessageId,
        };
      }
      if (reservation.kind === "blocked") {
        throw replyNoSendPolicyError(reservation.reason);
      }

      const preSend = await db.runTransaction(async (transaction) => {
        const [operation, lease, conversation, contact, protectedContent] = await Promise.all([
          transaction.get(operationRef),
          transaction.get(leaseRef),
          transaction.get(conversationRef),
          transaction.get(contactRef),
          transaction.get(protectedContentRef),
        ]);
        const operationData = operation.data();
        const leaseData = lease.data();
        const conversationData = conversation.data();
        if (
          !operation.exists ||
          !operationData ||
          operationData.id !== operationId ||
          operationData.workspaceId !== LITE_WORKSPACE_ID ||
          operationData.operationId !== operationId ||
          operationData.conversationId !== conversationId ||
          operationData.contactId !== contactId ||
          operationData.actorUid !== member.uid ||
          operationData.bodySha256 !== bodySha256 ||
          operationData.status !== "sending" ||
          operationData.providerMessageId !== null ||
          !lease.exists ||
          !leaseData ||
          leaseData.id !== conversationId ||
          leaseData.workspaceId !== LITE_WORKSPACE_ID ||
          leaseData.conversationId !== conversationId ||
          leaseData.activeOperationId !== operationId ||
          leaseData.actorUid !== member.uid ||
          leaseData.status !== "sending" ||
          !conversation.exists ||
          !conversationData ||
          conversationData.id !== conversationId ||
          conversationData.workspaceId !== LITE_WORKSPACE_ID ||
          conversationData.contactId !== contactId ||
          conversationData.liveCanary !== true ||
          !protectedContent.exists ||
          !isExactProtectedAgentContent({
            raw: protectedContent.data(),
            contentId: protectedContentId,
            conversationId,
            expectedBodySha256: bodySha256,
            expectedBodyLength: text.length,
            expectedTeamId: reservation.teamId,
            expectedLocationId: reservation.locationId,
            allowedStates: ["reserved"],
            expectedMessageId: null,
            mustBeUnexpiredAtMs: Date.now(),
          })
        ) {
          throw new LiteError(
            "invalid_evidence",
            "Reply send-boundary evidence is missing or malformed.",
          );
        }
        let routingReason: "routing_changed" | null = null;
        try {
          assertLiteReplyOwnership(conversationData, member.uid);
        } catch (error) {
          if (
            error instanceof LiteError &&
            (error.code === "not_assignee" || error.code === "invalid_routing_state")
          ) {
            routingReason = "routing_changed";
          } else {
            throw error;
          }
        }
        const windowExpiresAt = conversationData.serviceWindowExpiresAt;
        const windowClosed =
          !(windowExpiresAt instanceof Timestamp) ||
          windowExpiresAt.toMillis() <= Date.now();

        const now = Timestamp.now();
        const contactPolicy = evaluateLiteServiceReplyContactPolicy(
          contact.data(),
          contactId,
        );
        const blockedReason: LiteReplyNoSendReason | null =
          routingReason ??
          (windowClosed ? "service_window_closed" : null) ??
          ("reason" in contactPolicy ? contactPolicy.reason : null);
        if (blockedReason) {
          transaction.set(
            operationRef,
            {
              status: "not_sent",
              providerMessageId: null,
              policyReason: blockedReason,
              completedAt: now,
              updatedAt: now,
            },
            { merge: true },
          );
          transaction.set(
            leaseRef,
            {
              status: "idle",
              activeOperationId: null,
              lastOperationId: operationId,
              lastResolution: "policy_blocked",
              updatedAt: now,
            },
            { merge: true },
          );
          transaction.update(protectedContentRef, {
            state: "not_sent",
            messageId: null,
            updatedAt: now,
          });
          return { send: false as const, reason: blockedReason };
        }
        transaction.set(
          operationRef,
          { policyReason: null, preSendPolicyCheckedAt: now, updatedAt: now },
          { merge: true },
        );
        transaction.set(leaseRef, { updatedAt: now }, { merge: true });
        return { send: true as const };
      });
      if (!preSend.send) {
        throw replyNoSendPolicyError(preSend.reason);
      }

      let providerMessageId: string;
      try {
        const sent = await sendGraphMessage(
          phoneNumberId,
          metaAccessToken.value(),
          waId,
          buildAgentReplyBody(text),
        );
        if (!sent.providerMessageId) {
          throw new Error("Provider result did not include a message id.");
        }
        providerMessageId = sent.providerMessageId;
      } catch (error) {
        const uncertainAt = Timestamp.now();
        const uncertainBatch = db.batch();
        uncertainBatch.set(
          operationRef,
          {
            status: "send_uncertain",
            failureCode: "provider_result_unavailable",
            updatedAt: uncertainAt,
          },
          { merge: true },
        );
        uncertainBatch.set(
          leaseRef,
          {
            status: "send_uncertain",
            updatedAt: uncertainAt,
          },
          { merge: true },
        );
        await uncertainBatch
          .commit()
          .catch(() => undefined);
        logger.warn("lite: agent reply provider outcome uncertain", {
          reason: error instanceof Error ? error.message : "unknown",
        });
        throw new HttpsError(
          "unavailable",
          "Reply provider outcome is uncertain; it will not be retried automatically.",
        );
      }

      const now = Timestamp.now();
      const ledgerId = sha256Hex(`${operationId}:${key}`).slice(0, 40);
      const replyProviderRoute = buildCanaryProviderRouteEvidence({
        providerMessageId,
        targetKind: "lite_agent_reply",
        targetId: operationId,
        sha256Hex,
      });

      const batch = db.batch();
      batch.set(ws.collection("messages").doc(messageId), {
        id: messageId,
        workspaceId: LITE_WORKSPACE_ID,
        conversationId,
        contactId: `contact_live_${key}`,
        teamId: reservation.teamId,
        locationId: reservation.locationId,
        direction: "outbound",
        type: "text",
        status: "sent",
        externalDispatch: "dispatched",
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
        operationId,
        bodySha256,
        bodyLength: text.length,
        toNumberLast4: waId.slice(-4),
        providerMessageId,
        canary: true,
        containsMessageContent: false,
        createdAt: now,
        schemaVersion: 1,
      });
      batch.set(
        operationRef,
        {
          status: "sent",
          providerMessageId,
          completedAt: now,
          updatedAt: now,
        },
        { merge: true },
      );
      batch.set(
        leaseRef,
        {
          status: "idle",
          activeOperationId: null,
          lastOperationId: operationId,
          updatedAt: now,
        },
        { merge: true },
      );
      batch.update(protectedContentRef, {
        messageId,
        state: "materialized",
        updatedAt: now,
      });
      batch.create(
        ws
          .collection(META_CANARY_PROVIDER_ROUTES_COLLECTION)
          .doc(replyProviderRoute.id),
        {
          ...replyProviderRoute,
          createdAt: now,
          updatedAt: now,
        },
      );
      const replyMetric = buildDailyMetricIncrement(
        LITE_WORKSPACE_ID,
        now.toMillis(),
        { agentReplies: 1 },
      );
      if (replyMetric) {
        batch.set(
          ws.collection(METRICS_COLLECTION).doc(replyMetric.id),
          replyMetric.data,
          { merge: true },
        );
      }
      await batch.commit();

      logger.info("lite: agent reply sent", {
        role: member.role,
        length: text.length,
        hasProviderId: Boolean(providerMessageId),
      });
      return { sent: true, idempotent: false, conversationId, providerMessageId };
    } catch (error) {
      mapLiteError(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Private reply reconciliation (evidence only; never retries Meta)
// ---------------------------------------------------------------------------

export const liteReconcileAgentReply = onCall(
  { memory: "256MiB", timeoutSeconds: 30, maxInstances: 1 },
  async (request: CallableRequest<unknown>) => {
    const boundary = boundaryOrThrow();
    const db = liteFirestore(boundary.projectId);
    const adminUid = await requireVerifiedLiteAdmin(db, request);

    try {
      const input = assertLiteReplyReconciliationInput(request.data);
      const key = liveConversationKey(input.conversationId);
      const ws = db.collection("workspaces").doc(LITE_WORKSPACE_ID);
      const operationRef = ws
        .collection(LITE_REPLY_OPERATIONS_COLLECTION)
        .doc(input.operationId);
      const leaseRef = ws
        .collection(LITE_REPLY_LEASES_COLLECTION)
        .doc(input.conversationId);
      const conversationRef = ws.collection("conversations").doc(input.conversationId);
      const protectedContentId = protectedAgentOperationContentId(input.operationId);
      const protectedContentRef = conversationRef
        .collection(LITE_PROTECTED_MESSAGE_CONTENTS_COLLECTION)
        .doc(protectedContentId);
      const reconciliationId = `reply_reconcile_${sha256Hex(
        `${input.operationId}:${input.outcome}:${input.providerEvidenceSha256}`,
      ).slice(0, 32)}`;
      const reconciliationRef = ws
        .collection(LITE_REPLY_RECONCILIATIONS_COLLECTION)
        .doc(reconciliationId);
      const providerRoute =
        input.outcome === "sent" && input.providerMessageId
          ? buildCanaryProviderRouteEvidence({
              providerMessageId: input.providerMessageId,
              targetKind: "lite_agent_reply",
              targetId: input.operationId,
              sha256Hex,
            })
          : null;
      const providerRouteRef = providerRoute
        ? ws
            .collection(META_CANARY_PROVIDER_ROUTES_COLLECTION)
            .doc(providerRoute.id)
        : null;

      const result = await db.runTransaction(async (transaction) => {
        const [
          operationSnapshot,
          leaseSnapshot,
          conversationSnapshot,
          auditSnapshot,
          providerRouteSnapshot,
          protectedContentSnapshot,
        ] =
          await Promise.all([
            transaction.get(operationRef),
            transaction.get(leaseRef),
            transaction.get(conversationRef),
            transaction.get(reconciliationRef),
            providerRouteRef ? transaction.get(providerRouteRef) : Promise.resolve(null),
            transaction.get(protectedContentRef),
          ]);
        const decision = decideLiteReplyReconciliation(
          operationSnapshot.data(),
          leaseSnapshot.data(),
          input,
          Date.now(),
        );
        if (decision.kind === "already_reconciled") {
          const audit = auditSnapshot.data();
          if (
            !auditSnapshot.exists ||
            !audit ||
            audit.id !== reconciliationId ||
            audit.operationId !== input.operationId ||
            audit.conversationId !== input.conversationId ||
            audit.outcome !== input.outcome ||
            audit.providerEvidenceSha256 !== input.providerEvidenceSha256 ||
            audit.providerMessageId !== input.providerMessageId
          ) {
            throw new LiteError(
              "invalid_evidence",
              "Reconciliation audit evidence is missing or malformed.",
            );
          }
          if (
            input.outcome === "sent" &&
            (!providerRouteSnapshot?.exists ||
              !input.providerMessageId ||
              !isExactProviderRoute(
                providerRouteSnapshot.data(),
                input.providerMessageId,
                "lite_agent_reply",
                input.operationId,
              ))
          ) {
            throw new LiteError(
              "invalid_evidence",
              "Reply provider-route evidence is missing or malformed.",
            );
          }
          return { kind: "already_reconciled" as const };
        }
        if (auditSnapshot.exists || providerRouteSnapshot?.exists) {
          throw new LiteError(
            "reconciliation_conflict",
            "Reconciliation evidence id already exists.",
          );
        }

        const operation = operationSnapshot.data();
        const conversation = conversationSnapshot.data();
        if (
          !operationSnapshot.exists ||
          !operation ||
          operation.workspaceId !== LITE_WORKSPACE_ID ||
          operation.id !== input.operationId ||
          operation.contactId !== `contact_live_${key}` ||
          typeof operation.actorUid !== "string" ||
          !operation.actorUid ||
          typeof operation.bodySha256 !== "string" ||
          !/^[0-9a-f]{64}$/.test(operation.bodySha256) ||
          !Number.isInteger(operation.bodyLength) ||
          operation.bodyLength < 1 ||
          operation.bodyLength > 1024 ||
          typeof operation.teamId !== "string" ||
          typeof operation.locationId !== "string" ||
          typeof operation.toNumberLast4 !== "string" ||
          !/^\d{4}$/.test(operation.toNumberLast4) ||
          !conversationSnapshot.exists ||
          !conversation ||
          conversation.workspaceId !== LITE_WORKSPACE_ID ||
          conversation.liveCanary !== true
        ) {
          throw new LiteError(
            "invalid_evidence",
            "Reply reconciliation source evidence is malformed.",
          );
        }

        const reconciledMessageId = input.outcome === "sent"
          ? `message_live_${sha256Hex(`${input.operationId}:agent`).slice(0, 16)}`
          : null;
        if (
          protectedContentSnapshot.exists &&
          !isExactProtectedAgentContent({
            raw: protectedContentSnapshot.data(),
            contentId: protectedContentId,
            conversationId: input.conversationId,
            expectedBodySha256: operation.bodySha256,
            expectedBodyLength: operation.bodyLength,
            expectedTeamId: operation.teamId,
            expectedLocationId: operation.locationId,
            allowedStates: ["reserved"],
            expectedMessageId: null,
          })
        ) {
          throw new LiteError(
            "invalid_evidence",
            "Protected reply reconciliation evidence is malformed.",
          );
        }

        const now = Timestamp.now();
        if (input.outcome === "sent") {
          const messageId = reconciledMessageId!;
          const ledgerId = sha256Hex(`${input.operationId}:${key}`).slice(0, 40);
          transaction.create(ws.collection("messages").doc(messageId), {
            id: messageId,
            workspaceId: LITE_WORKSPACE_ID,
            conversationId: input.conversationId,
            contactId: operation.contactId,
            teamId: operation.teamId,
            locationId: operation.locationId,
            direction: "outbound",
            type: "text",
            status: "sent",
            externalDispatch: "dispatched",
            actorId: operation.actorUid,
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
          transaction.set(
            conversationRef,
            { lastMessageAt: now, unreadCount: 0, updatedAt: now },
            { merge: true },
          );
          transaction.create(ws.collection(LITE_AGENT_REPLIES_COLLECTION).doc(ledgerId), {
            id: ledgerId,
            workspaceId: LITE_WORKSPACE_ID,
            conversationId: input.conversationId,
            actorUid: operation.actorUid,
            operationId: input.operationId,
            bodySha256: operation.bodySha256,
            bodyLength: operation.bodyLength,
            toNumberLast4: operation.toNumberLast4,
            providerMessageId: input.providerMessageId,
            canary: true,
            reconciled: true,
            containsMessageContent: false,
            createdAt: now,
            schemaVersion: 1,
          });
          if (!providerRouteRef || !providerRoute) {
            throw new LiteError(
              "invalid_evidence",
              "Reply provider-route evidence could not be built.",
            );
          }
          transaction.create(providerRouteRef, {
            ...providerRoute,
            createdAt: now,
            updatedAt: now,
          });
        }
        if (protectedContentSnapshot.exists) {
          transaction.update(protectedContentRef, {
            state: input.outcome === "sent" ? "materialized" : "not_sent",
            messageId: reconciledMessageId,
            updatedAt: now,
          });
        }

        transaction.set(
          operationRef,
          {
            status: input.outcome === "sent" ? "sent" : "not_sent",
            providerMessageId: input.providerMessageId,
            reconciliationId,
            reconciliationEvidenceSha256: input.providerEvidenceSha256,
            reconciledByUid: adminUid,
            reconciledAt: now,
            completedAt: now,
            updatedAt: now,
          },
          { merge: true },
        );
        transaction.set(
          leaseRef,
          {
            status: "idle",
            activeOperationId: null,
            lastOperationId: input.operationId,
            lastResolution: input.outcome,
            updatedAt: now,
          },
          { merge: true },
        );
        transaction.create(reconciliationRef, {
          id: reconciliationId,
          workspaceId: LITE_WORKSPACE_ID,
          conversationId: input.conversationId,
          operationId: input.operationId,
          outcome: input.outcome,
          providerMessageId: input.providerMessageId,
          providerEvidenceSha256: input.providerEvidenceSha256,
          actorUid: adminUid,
          containsMessageContent: false,
          createdAt: now,
          schemaVersion: 1,
        });
        if (input.outcome === "sent") {
          const metric = buildDailyMetricIncrement(
            LITE_WORKSPACE_ID,
            now.toMillis(),
            { agentReplies: 1 },
          );
          if (metric) {
            transaction.set(
              ws.collection(METRICS_COLLECTION).doc(metric.id),
              metric.data,
              { merge: true },
            );
          }
        }
        return { kind: "applied" as const };
      });

      logger.info("lite: reply reconciliation recorded", {
        outcome: input.outcome,
        idempotent: result.kind === "already_reconciled",
      });
      return {
        ok: true,
        conversationId: input.conversationId,
        operationId: input.operationId,
        outcome: input.outcome,
        idempotent: result.kind === "already_reconciled",
      };
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
  readonly operationId?: string;
  readonly templateName?: string;
  readonly languageCode?: string;
  readonly recipients?: readonly string[];
};

export const liteSendCampaign = onCall(
  { memory: "256MiB", timeoutSeconds: 120, maxInstances: 2, secrets: [metaAccessToken] },
  async (request: CallableRequest<LiteCampaignInput>) => {
    const boundary = boundaryOrThrow();
    const db = liteFirestore(boundary.projectId);
    const member = await requireLiteMember(db, request);

    try {
      if (!hasLiteCanarySendClaim(request.auth?.token)) {
        throw new HttpsError(
          "permission-denied",
          "This Lite seat is not enabled for governed canary provider sends.",
        );
      }
      if (member.role !== "supervisor" && member.role !== "tenant_admin") {
        throw new HttpsError(
          "permission-denied",
          "Campaigns need a supervisor or admin seat — agents handle chats, not broadcasts.",
        );
      }
      const operationId = assertCampaignOperationId(request.data?.operationId);
      const name = assertValidCampaignName(request.data?.name);
      const template = assertTemplateSelection(
        request.data?.templateName,
        request.data?.languageCode,
      );
      const requestedContactIds = assertCampaignContactIds(request.data?.recipients);
      const ws = db.collection("workspaces").doc(LITE_WORKSPACE_ID);
      const requestSha256 = campaignRequestSha256(
        {
          operationId,
          name,
          templateName: template.templateName,
          languageCode: template.languageCode,
          contactIds: requestedContactIds,
        },
        sha256Hex,
      );
      const id = campaignId(operationId, sha256Hex);
      const campaignRef = ws.collection(LITE_CAMPAIGNS_COLLECTION).doc(id);

      const preflight = decideCampaignOperation((await campaignRef.get()).data(), {
        campaignId: id,
        operationId,
        actorUid: member.uid,
        requestSha256,
      });
      if (preflight.kind === "replay") return preflight.result;

      const allowlist = parseRecipientAllowlist(process.env.HEMAS_META_ALLOWLISTED_RECIPIENTS);
      const requestedAudience = resolveAllowlistedContactAudience(
        requestedContactIds,
        allowlist,
        (digits) => liveIds(digits).contactId,
      );
      const requestedTargets = requestedAudience
        .map((digits) => ({ digits, contactId: liveIds(digits).contactId }))
        .sort((left, right) => left.contactId.localeCompare(right.contactId));
      const phoneNumberId = process.env.HEMAS_META_PHONE_NUMBER_ID?.trim() ?? "";
      if (!/^\d{5,32}$/.test(phoneNumberId)) {
        throw new HttpsError("failed-precondition", "The canary phone number is not configured.");
      }

      const reservation = await db.runTransaction(async (transaction) => {
        const operationSnapshot = await transaction.get(campaignRef);
        const decision = decideCampaignOperation(operationSnapshot.data(), {
          campaignId: id,
          operationId,
          actorUid: member.uid,
          requestSha256,
        });
        if (decision.kind === "replay") return decision;

        const eligibleTargets: Array<{ digits: string; contactId: string }> = [];
        for (const target of requestedTargets) {
          const contact = await transaction.get(
            ws.collection("contacts").doc(target.contactId),
          );
          if (
            isEligibleCanaryCampaignContact(
              contact.data(),
              target.contactId,
              LITE_WORKSPACE_ID,
            )
          ) {
            eligibleTargets.push(target);
          }
        }
        const excluded = requestedTargets.length - eligibleTargets.length;
        if (eligibleTargets.length === 0) {
          throw new LiteCampaignError(
            "empty_audience",
            "No selected contacts are eligible for marketing messages.",
          );
        }
        const now = Timestamp.now();
        transaction.create(campaignRef, {
          id,
          workspaceId: LITE_WORKSPACE_ID,
          operationId,
          requestSha256,
          name,
          templateName: template.templateName,
          languageCode: template.languageCode,
          status: "sending",
          audienceCount: eligibleTargets.length,
          excludedCount: excluded,
          sentCount: 0,
          failedCount: 0,
          actorUid: member.uid,
          allowlistOnly: true,
          canary: true,
          liveCanary: true,
          synthetic: true,
          containsMessageContent: false,
          createdAt: now,
          updatedAt: now,
          schemaVersion: 2,
        });
        for (const target of eligibleTargets) {
          const recipientOperationId = campaignRecipientOperationId(
            id,
            target.contactId,
            sha256Hex,
          );
          transaction.create(
            ws
              .collection(LITE_CAMPAIGN_RECIPIENT_OPERATIONS_COLLECTION)
              .doc(recipientOperationId),
            {
              id: recipientOperationId,
              workspaceId: LITE_WORKSPACE_ID,
              campaignId: id,
              campaignOperationId: operationId,
              requestSha256,
              contactId: target.contactId,
              toNumberSha256: sha256Hex(target.digits),
              toNumberLast4: target.digits.slice(-4),
              status: "reserved",
              providerMessageId: null,
              containsMessageContent: false,
              createdAt: now,
              updatedAt: now,
              schemaVersion: 1,
            },
          );
        }
        return {
          kind: "reserve" as const,
          audience: eligibleTargets,
          excluded,
        };
      });

      if (reservation.kind === "replay") return reservation.result;

      const token = metaAccessToken.value();
      let sent = 0;
      let failed = 0;
      const welcomeMediaId = process.env.HEMAS_META_WELCOME_MEDIA_ID?.trim() ?? "";
      for (const [index, recipient] of reservation.audience.entries()) {
        const recipientOperationId = campaignRecipientOperationId(
          id,
          recipient.contactId,
          sha256Hex,
        );
        const recipientOperationRef = ws
          .collection(LITE_CAMPAIGN_RECIPIENT_OPERATIONS_COLLECTION)
          .doc(recipientOperationId);
        const preSend = await db.runTransaction(async (transaction) => {
          const [campaignSnapshot, recipientSnapshot, contactSnapshot] = await Promise.all([
            transaction.get(campaignRef),
            transaction.get(recipientOperationRef),
            transaction.get(ws.collection("contacts").doc(recipient.contactId)),
          ]);
          const campaign = campaignSnapshot.data();
          const evidence = recipientSnapshot.data();
          if (
            !campaignSnapshot.exists ||
            !campaign ||
            campaign.operationId !== operationId ||
            campaign.requestSha256 !== requestSha256 ||
            campaign.status !== "sending" ||
            campaign.sentCount !== sent ||
            campaign.failedCount !== failed ||
            !recipientSnapshot.exists ||
            !evidence ||
            evidence.campaignId !== id ||
            evidence.requestSha256 !== requestSha256 ||
            evidence.contactId !== recipient.contactId ||
            evidence.status !== "reserved"
          ) {
            throw new LiteCampaignError(
              "invalid_evidence",
              "Campaign recipient reservation is not sendable.",
            );
          }
          const now = Timestamp.now();
          if (
            !isEligibleCanaryCampaignContact(
              contactSnapshot.data(),
              recipient.contactId,
              LITE_WORKSPACE_ID,
            )
          ) {
            transaction.set(
              recipientOperationRef,
              {
                status: "not_sent",
                providerMessageId: null,
                policyReason: "contact_no_longer_eligible",
                completedAt: now,
                updatedAt: now,
              },
              { merge: true },
            );
            transaction.set(
              campaignRef,
              { failedCount: failed + 1, updatedAt: now },
              { merge: true },
            );
            return { send: false as const };
          }
          transaction.set(
            recipientOperationRef,
            { status: "sending", attemptStartedAt: now, updatedAt: now },
            { merge: true },
          );
          return { send: true as const };
        });
        if (!preSend.send) {
          failed += 1;
          continue;
        }

        let providerMessageId: string;
        try {
          const result = await sendGraphMessage(phoneNumberId, token, recipient.digits, {
            type: "template",
            template: {
              name: template.templateName,
              language: { code: template.languageCode },
              // IMAGE-header templates need the media parameter at send time.
              ...(template.templateName === "hemas_welcome_visual" && welcomeMediaId
                ? {
                    components: [
                      {
                        type: "header",
                        parameters: [{ type: "image", image: { id: welcomeMediaId } }],
                      },
                    ],
                  }
                : {}),
            },
          });
          if (!result.providerMessageId) {
            throw new Error("Provider result did not include a message id.");
          }
          providerMessageId = result.providerMessageId;
        } catch (error) {
          const uncertainAt = Timestamp.now();
          const uncertainBatch = db.batch();
          uncertainBatch.set(
            recipientOperationRef,
            {
              status: "send_uncertain",
              failureCode: "provider_result_unavailable",
              updatedAt: uncertainAt,
            },
            { merge: true },
          );
          uncertainBatch.set(
            campaignRef,
            {
              status: "send_uncertain",
              uncertainRecipientOperationId: recipientOperationId,
              updatedAt: uncertainAt,
            },
            { merge: true },
          );
          await uncertainBatch.commit().catch(() => undefined);
          logger.warn("lite: campaign provider outcome uncertain", {
            recipientIndex: index,
            reason: error instanceof Error ? error.message : "unknown",
          });
          throw new HttpsError(
            "unavailable",
            "Campaign provider outcome is uncertain; it will not be retried automatically.",
          );
        }

        const sendId = sendDocIdForWamid(providerMessageId, sha256Hex);
        const completedAt = Timestamp.now();
        const sendBatch = db.batch();
        sendBatch.create(ws.collection(LITE_CAMPAIGN_SENDS_COLLECTION).doc(sendId), {
          id: sendId,
          workspaceId: LITE_WORKSPACE_ID,
          campaignId: id,
          recipientOperationId,
          toNumberSha256: sha256Hex(recipient.digits),
          toNumberLast4: recipient.digits.slice(-4),
          status: "sent",
          errorCode: null,
          providerMessageId,
          canary: true,
          liveCanary: true,
          synthetic: true,
          containsMessageContent: false,
          createdAt: completedAt,
          updatedAt: completedAt,
          schemaVersion: 1,
        });
        sendBatch.set(
          recipientOperationRef,
          {
            status: "sent",
            providerMessageId,
            completedAt,
            updatedAt: completedAt,
          },
          { merge: true },
        );
        sendBatch.set(
          campaignRef,
          { sentCount: sent + 1, failedCount: failed, updatedAt: completedAt },
          { merge: true },
        );
        await sendBatch.commit();
        sent += 1;
      }

      const campaignCompletedAtMs = Date.now();
      const campaignCompletedAt = Timestamp.fromMillis(campaignCompletedAtMs);
      const campaignCompletionBatch = db.batch();
      campaignCompletionBatch.set(
        campaignRef,
        {
          status: failed === 0 ? "sent" : "completed_partial",
          sentCount: sent,
          failedCount: failed,
          completedAt: campaignCompletedAt,
          updatedAt: campaignCompletedAt,
        },
        { merge: true },
      );
      const campaignMetric = buildDailyMetricIncrement(
        LITE_WORKSPACE_ID,
        campaignCompletedAtMs,
        { campaignSends: sent },
      );
      if (campaignMetric) {
        campaignCompletionBatch.set(
          ws.collection(METRICS_COLLECTION).doc(campaignMetric.id),
          campaignMetric.data,
          { merge: true },
        );
      }
      await campaignCompletionBatch.commit();

      logger.info("lite: campaign dispatched", {
        audience: reservation.audience.length,
        excluded: reservation.excluded,
        sent,
        failed,
        template: template.templateName,
      });
      return {
        campaignId: id,
        audience: reservation.audience.length,
        excluded: reservation.excluded,
        sent,
        failed,
        idempotent: false,
      };
    } catch (error) {
      mapLiteError(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Private campaign reconciliation (evidence only; never resumes sending)
// ---------------------------------------------------------------------------

export const liteReconcileCampaign = onCall(
  { memory: "256MiB", timeoutSeconds: 30, maxInstances: 1 },
  async (request: CallableRequest<unknown>) => {
    const boundary = boundaryOrThrow();
    const db = liteFirestore(boundary.projectId);
    const adminUid = await requireVerifiedLiteAdmin(db, request);

    try {
      const input = assertCampaignReconciliationInput(request.data);
      const ws = db.collection("workspaces").doc(LITE_WORKSPACE_ID);
      const id = campaignId(input.operationId, sha256Hex);
      const campaignRef = ws.collection(LITE_CAMPAIGNS_COLLECTION).doc(id);
      const recipientQuery = ws
        .collection(LITE_CAMPAIGN_RECIPIENT_OPERATIONS_COLLECTION)
        .where("campaignId", "==", id);
      const reconciliationId = campaignReconciliationDocumentId(
        input.operationId,
        input.outcome,
        input.recipientOperationId,
        input.providerEvidenceSha256,
        sha256Hex,
      );
      const reconciliationRef = ws
        .collection(LITE_CAMPAIGN_RECONCILIATIONS_COLLECTION)
        .doc(reconciliationId);
      const sendId =
        input.outcome === "sent" && input.providerMessageId
          ? sendDocIdForWamid(input.providerMessageId, sha256Hex)
          : null;
      const sendRef = sendId
        ? ws.collection(LITE_CAMPAIGN_SENDS_COLLECTION).doc(sendId)
        : null;

      const decision = await db.runTransaction(async (transaction) => {
        const campaignSnapshot = await transaction.get(campaignRef);
        const recipientSnapshots = await transaction.get(recipientQuery);
        const auditSnapshot = await transaction.get(reconciliationRef);
        const sendSnapshot = sendRef ? await transaction.get(sendRef) : null;
        const result = decideCampaignReconciliation(
          campaignSnapshot.data(),
          recipientSnapshots.docs.map((snapshot) => snapshot.data()),
          input,
          {
            campaignId: id,
            workspaceId: LITE_WORKSPACE_ID,
            nowMs: Date.now(),
            sha256Hex,
          },
        );
        if (result.kind === "already_reconciled") {
          const audit = auditSnapshot.data();
          if (
            !auditSnapshot.exists ||
            !audit ||
            audit.id !== reconciliationId ||
            audit.workspaceId !== LITE_WORKSPACE_ID ||
            audit.campaignId !== id ||
            audit.operationId !== input.operationId ||
            audit.requestSha256 !== input.requestSha256 ||
            audit.recipientOperationId !== input.recipientOperationId ||
            audit.outcome !== input.outcome ||
            audit.providerMessageId !== input.providerMessageId ||
            audit.providerEvidenceSha256 !== input.providerEvidenceSha256 ||
            audit.audienceCount !== result.result.audience ||
            audit.excludedCount !== result.result.excluded ||
            audit.sentCount !== result.result.sent ||
            audit.failedCount !== result.result.failed
          ) {
            throw new LiteCampaignError(
              "invalid_evidence",
              "Campaign reconciliation audit evidence is missing or malformed.",
            );
          }
          if (input.outcome === "sent") {
            const send = sendSnapshot?.data();
            if (
              !sendSnapshot?.exists ||
              !send ||
              send.id !== sendId ||
              send.workspaceId !== LITE_WORKSPACE_ID ||
              send.campaignId !== id ||
              send.recipientOperationId !== input.recipientOperationId ||
              send.providerMessageId !== input.providerMessageId ||
              send.status !== "sent" ||
              send.reconciliationId !== reconciliationId
            ) {
              throw new LiteCampaignError(
                "invalid_evidence",
                "Reconciled campaign send evidence is missing or malformed.",
              );
            }
          }
          return result;
        }
        if (auditSnapshot.exists || sendSnapshot?.exists) {
          throw new LiteCampaignError(
            "reconciliation_conflict",
            "Campaign reconciliation evidence id already exists.",
          );
        }

        const now = Timestamp.now();
        const targetSnapshot = result.targetOperationId
          ? recipientSnapshots.docs.find(
              (snapshot) => snapshot.id === result.targetOperationId,
            )
          : null;
        const target = targetSnapshot?.data();
        if (result.targetOperationId && (!targetSnapshot || !target)) {
          throw new LiteCampaignError(
            "invalid_evidence",
            "Campaign reconciliation target evidence is missing.",
          );
        }
        if (result.targetOperationId && targetSnapshot && target) {
          transaction.set(
            targetSnapshot.ref,
            {
              status: result.targetStatus,
              providerMessageId: input.providerMessageId,
              reconciliationId,
              reconciliationOutcome: input.outcome,
              reconciliationEvidenceSha256: input.providerEvidenceSha256,
              reconciledByUid: adminUid,
              completedAt: now,
              updatedAt: now,
            },
            { merge: true },
          );
          if (input.outcome === "sent" && sendRef && sendId) {
            transaction.create(sendRef, {
              id: sendId,
              workspaceId: LITE_WORKSPACE_ID,
              campaignId: id,
              recipientOperationId: result.targetOperationId,
              toNumberSha256: target.toNumberSha256,
              toNumberLast4: target.toNumberLast4,
              status: "sent",
              errorCode: null,
              providerMessageId: input.providerMessageId,
              reconciliationId,
              reconciled: true,
              canary: true,
              liveCanary: true,
              synthetic: true,
              containsMessageContent: false,
              createdAt: now,
              updatedAt: now,
              schemaVersion: 1,
            });
          }
        }
        for (const operationId of result.haltOperationIds) {
          const snapshot = recipientSnapshots.docs.find(
            (candidate) => candidate.id === operationId,
          );
          if (!snapshot) {
            throw new LiteCampaignError(
              "invalid_evidence",
              "A reserved campaign recipient disappeared during reconciliation.",
            );
          }
          transaction.set(
            snapshot.ref,
            {
              status: "not_sent",
              providerMessageId: null,
              haltedByReconciliationId: reconciliationId,
              completedAt: now,
              updatedAt: now,
            },
            { merge: true },
          );
        }
        transaction.set(
          campaignRef,
          {
            status: result.status,
            sentCount: result.result.sent,
            failedCount: result.result.failed,
            uncertainRecipientOperationId: null,
            reconciliationId,
            reconciliationOutcome: input.outcome,
            reconciliationRequestSha256: input.requestSha256,
            reconciliationRecipientOperationId: input.recipientOperationId,
            reconciliationProviderMessageId: input.providerMessageId,
            reconciliationEvidenceSha256: input.providerEvidenceSha256,
            reconciledByUid: adminUid,
            reconciledAt: now,
            completedAt: now,
            updatedAt: now,
          },
          { merge: true },
        );
        transaction.create(reconciliationRef, {
          id: reconciliationId,
          workspaceId: LITE_WORKSPACE_ID,
          campaignId: id,
          operationId: input.operationId,
          requestSha256: input.requestSha256,
          recipientOperationId: input.recipientOperationId,
          outcome: input.outcome,
          providerMessageId: input.providerMessageId,
          providerEvidenceSha256: input.providerEvidenceSha256,
          terminalStatus: result.status,
          audienceCount: result.result.audience,
          excludedCount: result.result.excluded,
          sentCount: result.result.sent,
          failedCount: result.result.failed,
          haltedRecipientCount: result.haltOperationIds.length,
          actorUid: adminUid,
          containsMessageContent: false,
          createdAt: now,
          schemaVersion: 1,
        });
        if (result.result.sent > 0) {
          const metric = buildDailyMetricIncrement(
            LITE_WORKSPACE_ID,
            now.toMillis(),
            { campaignSends: result.result.sent },
          );
          if (metric) {
            transaction.set(
              ws.collection(METRICS_COLLECTION).doc(metric.id),
              metric.data,
              { merge: true },
            );
          }
        }
        return result;
      });

      logger.info("lite: campaign provider evidence reconciled", {
        outcome: input.outcome,
        sent: decision.result.sent,
        failed: decision.result.failed,
        idempotent: decision.kind === "already_reconciled",
      });
      return {
        ok: true,
        operationId: input.operationId,
        outcome: input.outcome,
        ...decision.result,
        idempotent: decision.kind === "already_reconciled",
      };
    } catch (error) {
      mapLiteError(error);
    }
  },
);
