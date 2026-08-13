import { getApps, initializeApp } from "firebase-admin/app";
import {
  FieldValue,
  Timestamp,
  type DocumentSnapshot,
  type Firestore,
} from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import {
  HttpsError,
  onCall,
  onRequest,
  type CallableRequest,
} from "firebase-functions/v2/https";
import { sha256Hex } from "../deterministic.js";
import { getHemasFirestore } from "../firestore-target.js";
import {
  BRIDGE_WORKSPACE_ID,
  buildLiveContactDocument,
  liveIds,
} from "../meta-bot/bridge.js";
import { aiReplyMessage, answerWithGuardrails } from "../meta-bot/ai.js";
import {
  detectScriptLanguage,
  runBotEngine,
  type BotLanguage,
  type BotSession,
} from "../meta-bot/engine.js";
import { bumpDailyMetrics } from "../lite/metrics.js";
import {
  META_CANARY_DEFAULT_LANGUAGE,
  META_CANARY_DEFAULT_TEMPLATE,
  META_CANARY_INBOUND_COLLECTION,
  META_CANARY_MAX_WEBHOOK_EVENTS,
  META_CANARY_OPT_OUT_COLLECTION,
  META_CANARY_OUTBOUND_COLLECTION,
  META_CANARY_WORKSPACE_ID,
  MetaCanaryError,
  assertAllowlistedRecipient,
  assertMetaCanaryTemplateAuthorization,
  assertMetaWebhookAssetBinding,
  buildCanaryMarketingOptOutEvidence,
  buildCanaryMarketingSuppression,
  buildCanaryTemplateSendBody,
  decideCanaryInboundBatch,
  dedupeCanaryInboundRecords,
  extractCanaryInboundBotMessages,
  extractCanaryInboundMarketingOptOuts,
  extractCanaryInboundBatch,
  parseRecipientAllowlist,
  type CanaryBotMessage,
  type CanaryInboundRecord,
  type CanaryMarketingOptOut,
  verifyMetaSignature,
  verifyMetaWebhookChallenge,
} from "./contracts.js";
import {
  processCanaryOutboxBatch,
  processCanaryOutboxEffect,
  reconcileFatalCanaryGraphEffect,
  reconcileDueCanaryOutbox,
  selectCanaryPublicTransientBotCandidates,
  selectCanaryTransientBotCandidates,
  type CanaryPublicInboundRouteConfig,
  type CanaryTransientBotOverride,
} from "./outbox-runner.js";
import {
  META_CANARY_OUTBOX_COLLECTION,
  META_CANARY_PUBLIC_JOURNAL_TTL_MS,
  assertCanaryFatalResolutionInput,
  assertMetaCanaryOperationId,
  assertMetaCanaryReconcilerAuthorization,
  buildCanaryOutboxRecord,
  buildContentFreeLegacyCanaryReceipt,
  buildInitialCanaryOutboxEffects,
  canaryOutboxEffectId,
  canaryTemplateOperationDocumentId,
  canaryTemplatePurpose,
  canaryTemplateRequestSha256,
  decideCanaryReceiptEffectPlan,
  decideCanaryTransientAiSequence,
  decideCanaryTemplateOperation,
  durableBotInput,
  isActiveMetaCanaryMembership,
  isCanaryReceiptEffectSequenceValid,
  parseCanaryOutboxRecord,
  resolveCanaryRuntimeMode,
  shouldPrepareCanaryTransientAi,
  type CanaryOutboxRecord,
  type CanaryTemplateOperationDecision,
} from "./outbox.js";
import {
  canaryBoundaryOrNull,
  geminiApiKey,
  metaAccessToken,
  metaAppSecret,
  metaPublicIdentityKey,
  metaReturnRouteKeyring,
  metaVerifyToken,
} from "./graph.js";
import {
  META_CANARY_RETURN_ROUTES_COLLECTION,
  encryptMetaCanaryReturnRoute,
  metaCanaryReturnRoutePhoneAssetSha256,
  metaCanaryReturnRouteSenderSha256,
  parseMetaCanaryReturnRouteKeyring,
  type MetaCanaryReturnRouteRecord,
} from "./return-route.js";
import {
  META_CANARY_PUBLIC_MAX_MESSAGE_AGE_MS,
  META_CANARY_PUBLIC_MAX_MESSAGE_FUTURE_MS,
  META_CANARY_PUBLIC_QUOTA_COLLECTION,
  allocateMetaCanaryPublicQuota,
  metaCanaryPublicQuotaCounterIds,
  type MetaCanaryPublicQuotaCandidate,
} from "./public-quota.js";

/**
 * Governed Meta WhatsApp canary lane. Signed provider receipts and every
 * downstream effect are durably journaled without message bodies or full
 * sender identifiers before the HTTP webhook acknowledges delivery.
 */

function getCanaryFirestore(projectId: string): Firestore {
  const app =
    getApps().find((candidate) => candidate.name === "[DEFAULT]") ??
    initializeApp({ projectId });
  return getHemasFirestore(app);
}

function workspace(db: Firestore) {
  return db.collection("workspaces").doc(META_CANARY_WORKSPACE_ID);
}

function outbox(db: Firestore) {
  return workspace(db).collection(META_CANARY_OUTBOX_COLLECTION);
}

const META_CANARY_PUBLIC_SUPPRESSIONS_COLLECTION =
  "canary_public_suppressions" as const;
const PUBLIC_SUPPRESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const PUBLIC_TEST_MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

export function metaCanaryPublicProviderOccurredAtMs(
  providerTimestamp: string | null,
  receivedAtMs: number,
): number | null {
  if (
    typeof providerTimestamp !== "string" ||
    !/^[1-9]\d{9,10}$/.test(providerTimestamp)
  ) {
    return null;
  }
  const occurredAtMs = Number(providerTimestamp) * 1_000;
  if (
    !Number.isSafeInteger(occurredAtMs) ||
    occurredAtMs < Math.max(
      0,
      receivedAtMs - META_CANARY_PUBLIC_MAX_MESSAGE_AGE_MS,
    ) ||
    occurredAtMs > receivedAtMs + META_CANARY_PUBLIC_MAX_MESSAGE_FUTURE_MS
  ) {
    return null;
  }
  return occurredAtMs;
}

function currentCanaryMode(): "bot" | "auto_reply" | "none" {
  return resolveCanaryRuntimeMode({
    botEnabled: process.env.HEMAS_META_BOT_ENABLED === "true",
    autoReplyEnabled: process.env.HEMAS_META_AUTO_REPLY_ENABLED === "true",
  });
}

export function isMetaCanaryPublicInboundWindowOpen(input: {
  readonly enabled: unknown;
  readonly expiresAtMs: unknown;
  readonly nowMs: number;
}): boolean {
  if (
    input.enabled !== "true" ||
    typeof input.expiresAtMs !== "string" ||
    !/^\d{13}$/.test(input.expiresAtMs) ||
    !Number.isSafeInteger(input.nowMs)
  ) {
    return false;
  }
  const expiresAtMs = Number(input.expiresAtMs);
  return Number.isSafeInteger(expiresAtMs) &&
    expiresAtMs > input.nowMs &&
    expiresAtMs <= input.nowMs + PUBLIC_TEST_MAX_WINDOW_MS;
}

function publicInboundEnabled(nowMs: number): boolean {
  return isMetaCanaryPublicInboundWindowOpen({
    enabled: process.env.HEMAS_META_PUBLIC_INBOUND_ENABLED,
    expiresAtMs: process.env.HEMAS_META_PUBLIC_INBOUND_EXPIRES_AT_MS,
    nowMs,
  });
}

function publicInboundRouteConfig(): CanaryPublicInboundRouteConfig {
  let identitySecretBase64 = "";
  let encryptionKeysByVersion: ReadonlyMap<number, string> = new Map();
  try {
    identitySecretBase64 = metaPublicIdentityKey.value().trim();
    encryptionKeysByVersion = parseMetaCanaryReturnRouteKeyring(
      metaReturnRouteKeyring.value().trim(),
    );
  } catch {
    // Fail closed below when public inbound lacks either governed secret.
  }
  const keyVersionRaw = process.env.HEMAS_META_RETURN_ROUTE_KEY_VERSION?.trim() ?? "1";
  const parsedKeyVersion = /^\d{1,5}$/.test(keyVersionRaw)
    ? Number(keyVersionRaw)
    : 0;
  const keyVersion = parsedKeyVersion >= 1 && parsedKeyVersion <= 65_535
    ? parsedKeyVersion
    : 0;
  return {
    enabled:
      identitySecretBase64.length > 0 &&
      keyVersion > 0 &&
      encryptionKeysByVersion.has(keyVersion),
    identitySecretBase64,
    currentKeyVersion: keyVersion,
    encryptionKeysByVersion,
  };
}

export type PersistedWebhookBatch = {
  readonly freshRecords: readonly CanaryInboundRecord[];
  readonly effectIds: readonly string[];
  readonly botPlanReceiptIds: readonly string[];
  readonly aiBudgetReceiptIds: readonly string[];
  readonly publicQuotaSuppressed: number;
};

/**
 * Atomically create each provider receipt and its deterministic effect set.
 * A replay is bound to the receipt's original plan and never creates effects
 * from a later runtime mode. STOP evidence and suppression are committed in
 * the same transaction and no bot/provider effect is planned for that event.
 */
export async function persistCanaryWebhookBatch(input: {
  readonly db: Firestore;
  readonly records: readonly CanaryInboundRecord[];
  /** Original signed-payload fingerprints, used only for strict replay checks. */
  readonly strictReplayRecords?: readonly CanaryInboundRecord[];
  readonly allowlistedMessages: readonly CanaryBotMessage[];
  readonly optOuts: readonly CanaryMarketingOptOut[];
  readonly inboundReturnRoutes: ReadonlyMap<string, MetaCanaryReturnRouteRecord>;
  readonly publicInboundMessageIds: ReadonlySet<string>;
  readonly publicSameEnvelopeSuppressedMessageIds: ReadonlySet<string>;
  readonly planMode: "bot" | "auto_reply" | "none";
  readonly occurredAtMs: number;
}): Promise<PersistedWebhookBatch> {
  const uniqueRecords = dedupeCanaryInboundRecords(input.records);
  const strictReplayRecordsById = new Map(
    dedupeCanaryInboundRecords(input.strictReplayRecords ?? [])
      .map((record) => [record.id, record] as const),
  );
  if (uniqueRecords.length === 0) {
    return {
      freshRecords: [],
      effectIds: [],
      botPlanReceiptIds: [],
      aiBudgetReceiptIds: [],
      publicQuotaSuppressed: 0,
    };
  }

  const planMode = input.planMode;
  const ws = workspace(input.db);
  const receipts = ws.collection(META_CANARY_INBOUND_COLLECTION);
  const optOutEvents = ws.collection(META_CANARY_OPT_OUT_COLLECTION);
  const contacts = ws.collection("contacts");
  const returnRoutes = ws.collection(META_CANARY_RETURN_ROUTES_COLLECTION);
  const publicQuota = ws.collection(META_CANARY_PUBLIC_QUOTA_COLLECTION);
  const publicSuppressions = ws.collection(
    META_CANARY_PUBLIC_SUPPRESSIONS_COLLECTION,
  );
  const recordMessageIds = new Set(
    uniqueRecords
      .filter((record) => record.kind === "message")
      .map((record) => record.waMessageId),
  );
  const publicAiEligibleMessageIds = new Set(
    input.allowlistedMessages.flatMap((message) => {
      if (!input.publicInboundMessageIds.has(message.waMessageId)) return [];
      const durableInput = durableBotInput(message);
      return durableInput.kind === "text_code" &&
          durableInput.textCode.startsWith("unknown_")
        ? [message.waMessageId]
        : [];
    }),
  );
  const uniqueOptOuts = [...new Map(
    input.optOuts
      .filter((optOut) =>
        recordMessageIds.has(optOut.waMessageId) &&
        !input.publicInboundMessageIds.has(optOut.waMessageId)
      )
      .map((optOut) => [optOut.waMessageId, optOut] as const),
  ).values()];
  const optOutTargets = uniqueOptOuts.map((optOut) => {
    const { contactId } = liveIds(optOut.waId);
    const evidence = buildCanaryMarketingOptOutEvidence({
      providerMessageId: optOut.waMessageId,
      contactId,
      keyword: optOut.keyword,
      sha256Hex,
    });
    return {
      optOut,
      contactId,
      contactRef: contacts.doc(contactId),
      evidence,
      evidenceRef: optOutEvents.doc(evidence.id),
    };
  });

  return input.db.runTransaction(async (transaction) => {
    const receiptRefs = uniqueRecords.map((record) => receipts.doc(record.id));
    const receiptSnapshots = await transaction.getAll(...receiptRefs);
    const receiptSnapshotsById = new Map(
      uniqueRecords.map((record, index) => [record.id, receiptSnapshots[index]] as const),
    );

    const publicSenderSha256s = [...new Set(
      uniqueRecords
        .filter((record) =>
          record.kind === "message" &&
          input.publicInboundMessageIds.has(record.waMessageId) &&
          typeof record.fromNumberSha256 === "string"
        )
        .map((record) => record.fromNumberSha256 as string),
    )];
    const suppressionRefs = publicSenderSha256s.map((senderSha256) =>
      publicSuppressions.doc(senderSha256)
    );
    const suppressionSnapshots = suppressionRefs.length > 0
      ? await transaction.getAll(...suppressionRefs)
      : [];
    const suppressionSnapshotsBySender = new Map(
      publicSenderSha256s.map((senderSha256, index) =>
        [senderSha256, suppressionSnapshots[index]] as const
      ),
    );
    const activePublicSuppressedSenders = new Set<string>();
    for (const senderSha256 of publicSenderSha256s) {
      const snapshot = suppressionSnapshotsBySender.get(senderSha256);
      if (!snapshot?.exists) continue;
      const data = snapshot.data();
      if (
        data?.active !== true ||
        data.subjectSha256 !== senderSha256 ||
        typeof data.lastOptOutReceiptSha256 !== "string" ||
        !/^[0-9a-f]{64}$/.test(data.lastOptOutReceiptSha256) ||
        data.containsMessageContent !== false ||
        data.containsPlaintextSender !== false ||
        data.schemaVersion !== 1 ||
        !(data.expireAt instanceof Timestamp) ||
        typeof data.expiresAtMs !== "number" ||
        data.expireAt.toMillis() !== data.expiresAtMs
      ) {
        throw new Error("meta_canary_public_suppression_invalid");
      }
      if (data.expiresAtMs > input.occurredAtMs) {
        activePublicSuppressedSenders.add(senderSha256);
      }
    }
    const publicOptOutMessageIds = new Set(
      input.optOuts
        .filter((optOut) => input.publicInboundMessageIds.has(optOut.waMessageId))
        .map((optOut) => optOut.waMessageId),
    );

    const publicQuotaCandidates: MetaCanaryPublicQuotaCandidate[] = [];
    for (const record of uniqueRecords) {
      const snapshot = receiptSnapshotsById.get(record.id);
      const providerOccurredAtMs = metaCanaryPublicProviderOccurredAtMs(
        record.providerTimestamp,
        input.occurredAtMs,
      );
      const isPublicOptOut = publicOptOutMessageIds.has(record.waMessageId);
      const isReplyEligible =
        planMode !== "none" &&
        input.inboundReturnRoutes.has(record.waMessageId) &&
        !input.publicSameEnvelopeSuppressedMessageIds.has(record.waMessageId);
      if (
        !snapshot ||
        snapshot.exists ||
        record.kind !== "message" ||
        !record.fromNumberSha256 ||
        !input.publicInboundMessageIds.has(record.waMessageId) ||
        activePublicSuppressedSenders.has(record.fromNumberSha256) ||
        providerOccurredAtMs === null ||
        isPublicOptOut ||
        !isReplyEligible
      ) {
        continue;
      }
      publicQuotaCandidates.push({
        receiptId: record.id,
        senderSha256: record.fromNumberSha256,
        occurredAtMs: providerOccurredAtMs,
        aiEligible:
          planMode === "bot" &&
          publicAiEligibleMessageIds.has(record.waMessageId),
      });
    }
    const quotaCounterIds = metaCanaryPublicQuotaCounterIds({
      candidates: publicQuotaCandidates,
      nowMs: input.occurredAtMs,
    });
    const currentQuotaCounters: Record<string, unknown> = {};
    const quotaRefs = quotaCounterIds.map((counterId) => publicQuota.doc(counterId));
    const quotaSnapshots = quotaRefs.length > 0
      ? await transaction.getAll(...quotaRefs)
      : [];
    for (const [index, counterId] of quotaCounterIds.entries()) {
      const snapshot = quotaSnapshots[index];
      if (!snapshot?.exists) continue;
      const data = snapshot.data();
      const expireAt = data?.expireAt;
      const expiresAtMs = data?.expiresAtMs;
      if (
        !(expireAt instanceof Timestamp) ||
        typeof expiresAtMs !== "number" ||
        expireAt.toMillis() !== expiresAtMs
      ) {
        throw new Error("meta_canary_public_quota_ttl_invalid");
      }
      const { expireAt: _expireAt, ...counterRecord } = data as Record<string, unknown>;
      currentQuotaCounters[counterId] = counterRecord;
    }
    const quotaDecision = allocateMetaCanaryPublicQuota({
      candidates: publicQuotaCandidates,
      nowMs: input.occurredAtMs,
      currentCounterRecords: currentQuotaCounters,
    });
    const allowedPublicReceipts = new Set(quotaDecision.allowedReceiptIds);
    const recordsForPlan = uniqueRecords.filter((record) => {
      if (
        record.kind !== "message" ||
        !input.publicInboundMessageIds.has(record.waMessageId)
      ) {
        return true;
      }
      if (receiptSnapshotsById.get(record.id)?.exists) return true;
      return planMode !== "none" &&
        allowedPublicReceipts.has(record.id) &&
        typeof record.fromNumberSha256 === "string" &&
        !activePublicSuppressedSenders.has(record.fromNumberSha256) &&
        !input.publicSameEnvelopeSuppressedMessageIds.has(record.waMessageId) &&
        !publicOptOutMessageIds.has(record.waMessageId);
    });
    const effects = buildInitialCanaryOutboxEffects({
      records: recordsForPlan,
      allowlistedMessages: input.allowlistedMessages,
      optOuts: input.optOuts.filter(
        (optOut) => !input.publicInboundMessageIds.has(optOut.waMessageId),
      ),
      inboundReturnRouteIds: new Map(
        [...input.inboundReturnRoutes].map(([messageId, route]) => [
          messageId,
          route.routeId,
        ]),
      ),
      mode: planMode,
      welcomeMediaId: process.env.HEMAS_META_WELCOME_MEDIA_ID?.trim() || null,
      nowMs: input.occurredAtMs,
      sha256Hex,
    });
    const effectIdsByReceipt = new Map<string, string[]>();
    const plannedEffectsById = new Map(
      effects.map((effect) => [effect.id, effect] as const),
    );
    for (const effect of effects) {
      const ids = effectIdsByReceipt.get(effect.receiptId) ?? [];
      ids.push(effect.id);
      effectIdsByReceipt.set(effect.receiptId, ids);
    }

    const receiptPlans = new Map<
      string,
      ReturnType<typeof decideCanaryReceiptEffectPlan>
    >();
    const processEffectIds = new Set<string>();
    for (const record of recordsForPlan) {
      const snapshot = receiptSnapshotsById.get(record.id);
      if (!snapshot) throw new Error("meta_canary_receipt_snapshot_missing");
      const decision = decideCanaryReceiptEffectPlan({
        existingReceipt: snapshot.exists ? snapshot.data() : undefined,
        record,
        ...(strictReplayRecordsById.get(record.id)
          ? { strictReplayRecord: strictReplayRecordsById.get(record.id)! }
          : {}),
        currentMode: planMode,
        currentPlannedEffectIds: effectIdsByReceipt.get(record.id) ?? [],
        sha256Hex,
      });
      receiptPlans.set(record.id, decision);
      for (const effectId of decision.effectIds) processEffectIds.add(effectId);
    }
    const processEffectIdList = [...processEffectIds];
    const effectRefs = processEffectIdList.map((effectId) =>
      outbox(input.db).doc(effectId)
    );
    const effectSnapshotList = effectRefs.length > 0
      ? await transaction.getAll(...effectRefs)
      : [];
    const effectSnapshots = new Map(
      processEffectIdList.map((effectId, index) =>
        [effectId, effectSnapshotList[index]] as const
      ),
    );
    const contactSnapshots = new Map<string, DocumentSnapshot>();
    for (const target of optOutTargets) {
      if (!contactSnapshots.has(target.contactId)) {
        contactSnapshots.set(
          target.contactId,
          await transaction.get(target.contactRef),
        );
      }
    }
    const evidenceSnapshots = new Map<string, DocumentSnapshot>();
    for (const target of optOutTargets) {
      evidenceSnapshots.set(
        target.evidence.id,
        await transaction.get(target.evidenceRef),
      );
    }

    for (const [counterId, counterRecord] of Object.entries(
      quotaDecision.updatedCounterRecords,
    )) {
      transaction.set(
        publicQuota.doc(counterId),
        {
          ...counterRecord,
          expireAt: Timestamp.fromMillis(counterRecord.expiresAtMs),
        },
        { merge: false },
      );
    }
    const writtenPublicSuppressions = new Set<string>();
    for (const record of uniqueRecords) {
      if (
        record.kind !== "message" ||
        !record.fromNumberSha256 ||
        !input.publicInboundMessageIds.has(record.waMessageId) ||
        !publicOptOutMessageIds.has(record.waMessageId) ||
        activePublicSuppressedSenders.has(record.fromNumberSha256) ||
        writtenPublicSuppressions.has(record.fromNumberSha256)
      ) {
        continue;
      }
      writtenPublicSuppressions.add(record.fromNumberSha256);
      const expiresAtMs = input.occurredAtMs + PUBLIC_SUPPRESSION_TTL_MS;
      transaction.set(
        publicSuppressions.doc(record.fromNumberSha256),
        {
          active: true,
          subjectSha256: record.fromNumberSha256,
          lastOptOutReceiptSha256: sha256Hex(
            `meta-canary-public-opt-out:v1:${record.id}`,
          ),
          createdAtMs: input.occurredAtMs,
          expiresAtMs,
          expireAt: Timestamp.fromMillis(expiresAtMs),
          containsMessageContent: false,
          containsPlaintextSender: false,
          schemaVersion: 1,
        },
        { merge: false },
      );
    }

    const freshRecords = recordsForPlan.filter(
      (record) => receiptPlans.get(record.id)?.kind === "create",
    );
    for (const record of recordsForPlan) {
      const snapshot = receiptSnapshotsById.get(record.id);
      if (!snapshot) throw new Error("meta_canary_receipt_snapshot_missing");
      const plan = receiptPlans.get(record.id);
      if (!plan) throw new Error("meta_canary_receipt_plan_missing");
      if (plan.kind === "create") {
        if (snapshot.exists) throw new Error("meta_canary_receipt_collision");
        const isPublicReceipt = record.kind === "message" &&
          input.publicInboundMessageIds.has(record.waMessageId);
        const publicExpiresAtMs =
          input.occurredAtMs + META_CANARY_PUBLIC_JOURNAL_TTL_MS;
        transaction.create(receipts.doc(record.id), {
          ...record,
          outboxEffectIds: plan.effectIds,
          outboxPlanMode: plan.planMode,
          outboxPlanVersion: 1,
          receivedAt: FieldValue.serverTimestamp(),
          ...(isPublicReceipt
            ? {
              publicInboundTest: true,
              expiresAtMs: publicExpiresAtMs,
              expireAt: Timestamp.fromMillis(publicExpiresAtMs),
            }
            : {}),
        });
        if (record.kind === "message") {
          const returnRoute = input.inboundReturnRoutes.get(record.waMessageId);
          const hasReplyEffect = plan.effectIds.some((effectId) => {
            const effectKind = plannedEffectsById.get(effectId)?.effectKind;
            return effectKind === "bot_plan" || effectKind === "graph_auto_reply";
          });
          if (returnRoute && hasReplyEffect) {
            transaction.create(returnRoutes.doc(returnRoute.routeId), {
              ...returnRoute,
              expireAt: Timestamp.fromMillis(returnRoute.expiresAtMs),
            });
          }
        }
      } else if (plan.kind === "legacy_replay" && plan.migrateReceipt) {
        const isPublicReceipt = record.kind === "message" &&
          input.publicInboundMessageIds.has(record.waMessageId);
        const publicExpiresAtMs =
          input.occurredAtMs + META_CANARY_PUBLIC_JOURNAL_TTL_MS;
        transaction.set(
          receipts.doc(record.id),
          {
            ...buildContentFreeLegacyCanaryReceipt({
              existingReceipt: snapshot.data(),
              record,
              receivedAtFallback: Timestamp.fromMillis(input.occurredAtMs),
              migratedAt: Timestamp.fromMillis(input.occurredAtMs),
            }),
            ...(isPublicReceipt
              ? {
                publicInboundTest: true,
                expiresAtMs: publicExpiresAtMs,
                expireAt: Timestamp.fromMillis(publicExpiresAtMs),
              }
              : {}),
          },
          { merge: false },
        );
      }
    }

    for (const record of recordsForPlan) {
      const plan = receiptPlans.get(record.id);
      if (!plan) throw new Error("meta_canary_receipt_plan_missing");
      if (plan.kind === "legacy_replay") continue;
      const effectKinds: CanaryOutboxRecord["effectKind"][] = [];
      for (const effectId of plan.effectIds) {
        const snapshot = effectSnapshots.get(effectId);
        if (!snapshot) throw new Error("meta_canary_effect_snapshot_missing");
        if (plan.kind === "create") {
          const effect = plannedEffectsById.get(effectId);
          if (
            snapshot.exists ||
            !effect ||
            effect.id !== effectId ||
            effect.receiptId !== record.id
          ) {
            throw new Error("meta_canary_effect_collision");
          }
          effectKinds.push(effect.effectKind);
        } else {
          const existing = parseCanaryOutboxRecord(snapshot.data());
          if (
            !snapshot.exists ||
            !existing ||
            existing.id !== effectId ||
            existing.receiptId !== record.id ||
            existing.workspaceId !== META_CANARY_WORKSPACE_ID
          ) {
            throw new Error("meta_canary_effect_missing_or_mismatched");
          }
          effectKinds.push(existing.effectKind);
        }
      }
      if (!isCanaryReceiptEffectSequenceValid({
        recordKind: record.kind,
        planMode: plan.planMode,
        effectKinds,
      })) {
        throw new Error("meta_canary_receipt_effect_sequence_invalid");
      }
      if (plan.kind === "create") {
        for (const effectId of plan.effectIds) {
          const effect = plannedEffectsById.get(effectId);
          if (!effect) throw new Error("meta_canary_effect_plan_missing");
          const isPublicEffect = record.kind === "message" &&
            input.publicInboundMessageIds.has(record.waMessageId);
          const publicExpiresAtMs =
            input.occurredAtMs + META_CANARY_PUBLIC_JOURNAL_TTL_MS;
          transaction.create(outbox(input.db).doc(effect.id), {
            ...effect,
            ...(isPublicEffect
              ? {
                publicInboundTest: true,
                expiresAtMs: publicExpiresAtMs,
                expireAt: Timestamp.fromMillis(publicExpiresAtMs),
              }
              : {}),
          });
        }
      }
    }

    const occurredAt = Timestamp.fromMillis(input.occurredAtMs);
    for (const target of optOutTargets) {
      const existingEvidence = evidenceSnapshots.get(target.evidence.id);
      if (!existingEvidence?.exists) {
        transaction.create(target.evidenceRef, {
          ...target.evidence,
          occurredAt,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        });
      } else {
        const data = existingEvidence.data();
        if (
          data?.id !== target.evidence.id ||
          data.workspaceId !== target.evidence.workspaceId ||
          data.contactId !== target.evidence.contactId ||
          data.providerEventSha256 !== target.evidence.providerEventSha256 ||
          data.keywordCode !== target.evidence.keywordCode ||
          data.containsMessageContent !== false
        ) {
          throw new Error("meta_canary_opt_out_collision");
        }
      }
    }
    const optOutByContact = new Map(
      optOutTargets.map((target) => [target.contactId, target] as const),
    );
    for (const target of optOutByContact.values()) {
      const snapshot = contactSnapshots.get(target.contactId);
      const existing = snapshot?.data();
      const base = buildLiveContactDocument({
        contactId: target.contactId,
        last4: target.optOut.waId.slice(-4),
        language: "en",
        nowMs: input.occurredAtMs,
        ...(snapshot?.exists && existing ? { existing } : {}),
        addTags: ["marketing-suppressed"],
      });
      const suppression = buildCanaryMarketingSuppression(base.suppression, occurredAt);
      const currentRevision =
        typeof base.preferenceRevision === "number" ? base.preferenceRevision : 0;
      transaction.set(
        target.contactRef,
        {
          ...base,
          suppression: suppression.suppression,
          preferenceRevision: Math.min(
            1_000_000_000,
            currentRevision + suppression.preferenceRevisionIncrement,
          ),
          updatedAt: occurredAt,
        },
        { merge: false },
      );
    }

    const botPlanReceiptIds = freshRecords
      .filter((record) =>
        (effectIdsByReceipt.get(record.id) ?? []).some((effectId) =>
          plannedEffectsById.get(effectId)?.effectKind === "bot_plan"
        )
      )
      .map((record) => record.id);
    const publicQuotaReceiptIds = new Set(
      publicQuotaCandidates.map((candidate) => candidate.receiptId),
    );
    const publicAiBudgetReceiptIds = new Set(
      quotaDecision.aiBudgetReceiptIds,
    );
    return {
      freshRecords,
      effectIds: [...processEffectIds],
      botPlanReceiptIds,
      aiBudgetReceiptIds: botPlanReceiptIds.filter((receiptId) =>
        publicAiBudgetReceiptIds.has(receiptId) ||
        !publicQuotaReceiptIds.has(receiptId)
      ),
      publicQuotaSuppressed: quotaDecision.suppressedReceiptIds.length,
    };
  });
}

function accessTokenValue(): string {
  try {
    return metaAccessToken.value().trim();
  } catch {
    return "";
  }
}

function geminiApiKeyValue(): string {
  try {
    return geminiApiKey.value().trim();
  } catch {
    return "";
  }
}

/**
 * Build request-scoped AI replies only for newly committed receipts. This
 * service never persists or application-logs raw text or generated answers;
 * failures retain the deterministic menu fallback already planned by the
 * outbox.
 */
async function buildTransientCanaryAiOverrides(input: {
  readonly db: Firestore;
  readonly messages: readonly CanaryBotMessage[];
  readonly freshRecords: readonly CanaryInboundRecord[];
  readonly botPlanReceiptIds: ReadonlySet<string>;
  readonly aiBudgetReceiptIds: ReadonlySet<string>;
  readonly publicSubjectsByReceipt: ReadonlyMap<string, string>;
  readonly planMode: "bot" | "auto_reply" | "none";
  readonly occurredAtMs: number;
}): Promise<readonly CanaryTransientBotOverride[]> {
  if (!shouldPrepareCanaryTransientAi({
    mode: input.planMode,
    aiEnabled: process.env.HEMAS_META_AI_ENABLED === "true",
    hasFreshBotPlan: input.botPlanReceiptIds.size > 0,
  })) {
    return [];
  }
  const apiKey = geminiApiKeyValue();
  if (!apiKey) return [];

  const freshReceiptByProviderMessage = new Map(
    input.freshRecords
      .filter((record) =>
        record.kind === "message" &&
        input.botPlanReceiptIds.has(record.id)
      )
      .map((record) => [record.waMessageId, record.id] as const),
  );
  const freshMessages = input.messages.filter((message) =>
    freshReceiptByProviderMessage.has(message.waMessageId)
  );
  const recipientsByReceipt = new Map(
    freshMessages.flatMap((message) => {
      const receiptId = freshReceiptByProviderMessage.get(message.waMessageId);
      return receiptId ? [[receiptId, message.waId] as const] : [];
    }),
  );
  const publicReceiptIds = new Set(
    [...input.publicSubjectsByReceipt.keys()].filter((receiptId) =>
      recipientsByReceipt.has(receiptId)
    ),
  );
  const legacyReceiptIds = new Set(
    [...recipientsByReceipt.keys()].filter((receiptId) =>
      !publicReceiptIds.has(receiptId)
    ),
  );
  const [legacyEligible, publicEligible] = await Promise.all([
    selectCanaryTransientBotCandidates({
      db: input.db,
      receiptIds: legacyReceiptIds,
      recipientsByReceipt,
    }),
    selectCanaryPublicTransientBotCandidates({
      db: input.db,
      receiptIds: publicReceiptIds,
      subjectsByReceipt: input.publicSubjectsByReceipt,
      nowMs: input.occurredAtMs,
    }),
  ]);
  const eligibleReceiptIds = new Set([
    ...legacyEligible.keys(),
    ...publicEligible.keys(),
  ]);
  const conversationKeyByReceipt = new Map<string, string>();
  const sessionsByConversation = new Map<string, BotSession>();
  for (const [receiptId, candidate] of legacyEligible) {
    const conversationKey = `legacy:${candidate.recipient}`;
    conversationKeyByReceipt.set(receiptId, conversationKey);
    if (!sessionsByConversation.has(conversationKey)) {
      sessionsByConversation.set(conversationKey, candidate.session);
    }
  }
  for (const [receiptId, candidate] of publicEligible) {
    const conversationKey = `public:${candidate.subjectSha256}`;
    conversationKeyByReceipt.set(receiptId, conversationKey);
    if (!sessionsByConversation.has(conversationKey)) {
      sessionsByConversation.set(conversationKey, candidate.session);
    }
  }

  const candidates: Array<{
    readonly receiptId: string;
    readonly text: string;
    readonly language: BotLanguage;
  }> = [];
  const blockedConversations = new Set<string>();
  for (const message of freshMessages) {
    const receiptId = freshReceiptByProviderMessage.get(message.waMessageId);
    const conversationKey = receiptId
      ? conversationKeyByReceipt.get(receiptId)
      : undefined;
    const session = conversationKey
      ? sessionsByConversation.get(conversationKey)
      : undefined;
    if (
      !receiptId ||
      !conversationKey ||
      !session ||
      !eligibleReceiptIds.has(receiptId) ||
      blockedConversations.has(conversationKey)
    ) {
      continue;
    }
    try {
      const result = runBotEngine(
        session,
        { ...message.inbound, nowMs: input.occurredAtMs },
        { welcomeMediaId: process.env.HEMAS_META_WELCOME_MEDIA_ID?.trim() || null },
      );
      sessionsByConversation.set(conversationKey, result.session);
      const aiSequence = decideCanaryTransientAiSequence({
        recipientBlocked: false,
        staffHandoff: result.staffHandoff,
        aiQuery: result.aiQuery,
      });
      if (aiSequence === "block_recipient") {
        blockedConversations.add(conversationKey);
        continue;
      }
      if (
        aiSequence === "candidate" &&
        result.aiQuery &&
        input.aiBudgetReceiptIds.has(receiptId) &&
        candidates.length < 4
      ) {
        candidates.push({
          receiptId,
          text: result.aiQuery,
          language: result.session.language ?? "en",
        });
      }
    } catch {
      logger.warn("meta-bot: transient ai preparation failed");
    }
  }

  const finalCandidateIds = new Set(
    candidates.map((candidate) => candidate.receiptId),
  );
  const finalPublicIds = new Set(
    [...finalCandidateIds].filter((receiptId) => publicReceiptIds.has(receiptId)),
  );
  const finalLegacyIds = new Set(
    [...finalCandidateIds].filter((receiptId) => !publicReceiptIds.has(receiptId)),
  );
  const [finalLegacyEligibility, finalPublicEligibility] = await Promise.all([
    selectCanaryTransientBotCandidates({
      db: input.db,
      receiptIds: finalLegacyIds,
      recipientsByReceipt,
    }),
    selectCanaryPublicTransientBotCandidates({
      db: input.db,
      receiptIds: finalPublicIds,
      subjectsByReceipt: input.publicSubjectsByReceipt,
      nowMs: input.occurredAtMs,
    }),
  ]);
  const finalEligibleReceiptIds = new Set([
    ...finalLegacyEligibility.keys(),
    ...finalPublicEligibility.keys(),
  ]);
  const configuredModel = process.env.HEMAS_GEMINI_MODEL?.trim();
  const overrides = await Promise.all(candidates
    .filter((candidate) => finalEligibleReceiptIds.has(candidate.receiptId))
    .map(async (candidate) => {
      try {
        const outcome = await answerWithGuardrails(
          { text: candidate.text, language: candidate.language },
          { apiKey, ...(configuredModel ? { model: configuredModel } : {}) },
        );
        logger.info("meta-bot: ai answer", {
          answered: Boolean(outcome.answer),
          failureCode: outcome.failureCode,
          latencyMs: outcome.latencyMs,
        });
        void bumpDailyMetrics(input.db, BRIDGE_WORKSPACE_ID, input.occurredAtMs, {
          aiAnswers: outcome.answer ? 1 : 0,
          aiFailures: outcome.answer ? 0 : 1,
        }).catch(() => {
          logger.warn("meta-bot: ai metrics update failed");
        });
        if (!outcome.answer) return null;
        const suffixLanguage = detectScriptLanguage(outcome.answer) ??
          candidate.language;
        return {
          receiptId: candidate.receiptId,
          reply: aiReplyMessage(outcome.answer, suffixLanguage),
        } satisfies CanaryTransientBotOverride;
      } catch {
        logger.warn("meta-bot: transient ai preparation failed");
        return null;
      }
    }));
  return overrides.filter(
    (override): override is CanaryTransientBotOverride => override !== null,
  );
}

async function requireActiveCanaryMembership(input: {
  readonly db: Firestore;
  readonly uid: string;
  readonly requireAdmin: boolean;
}): Promise<void> {
  const snapshot = await workspace(input.db).collection("members").doc(input.uid).get();
  if (
    !snapshot.exists ||
    !isActiveMetaCanaryMembership({
      membership: snapshot.data(),
      uid: input.uid,
      requireAdmin: input.requireAdmin,
    })
  ) {
    throw new HttpsError(
      "permission-denied",
      input.requireAdmin
        ? "Meta canary recovery requires a current tenant administrator membership."
        : "Meta canary sending requires a current active workspace membership.",
    );
  }
}

export const metaCanaryWebhook = onRequest(
  {
    cors: false,
    memory: "256MiB",
    timeoutSeconds: 30,
    maxInstances: 3,
    concurrency: 40,
    secrets: [
      metaAppSecret,
      metaVerifyToken,
      metaAccessToken,
      geminiApiKey,
      metaReturnRouteKeyring,
      metaPublicIdentityKey,
    ],
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
          mode: typeof request.query["hub.mode"] === "string"
            ? request.query["hub.mode"]
            : undefined,
          verifyToken: typeof request.query["hub.verify_token"] === "string"
            ? request.query["hub.verify_token"]
            : undefined,
          challenge: typeof request.query["hub.challenge"] === "string"
            ? request.query["hub.challenge"]
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
      logger.warn("meta-canary: invalid webhook signature");
      response.status(403).json({ error: "invalid_signature" });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse((request.rawBody ?? Buffer.alloc(0)).toString("utf8"));
    } catch {
      response.status(400).json({ error: "invalid_request" });
      return;
    }
    try {
      assertMetaWebhookAssetBinding(
        payload,
        process.env.HEMAS_META_WABA_ID,
        process.env.HEMAS_META_PHONE_NUMBER_ID,
      );
    } catch (error) {
      if (
        error instanceof MetaCanaryError &&
        error.code === "asset_binding_unconfigured"
      ) {
        logger.error("meta-canary: webhook asset binding is unconfigured");
        response.status(503).json({ error: "asset_binding_unconfigured" });
        return;
      }
      if (
        error instanceof MetaCanaryError &&
        error.code === "webhook_batch_overflow"
      ) {
        logger.error("meta-canary: signed webhook exceeds envelope limit");
        response.set("Retry-After", "60");
        response.status(503).json({ error: "webhook_batch_overflow" });
        return;
      }
      logger.warn("meta-canary: webhook asset mismatch");
      response.status(403).json({ error: "asset_mismatch" });
      return;
    }

    const inboundDecision = decideCanaryInboundBatch(
      extractCanaryInboundBatch(payload, sha256Hex),
    );
    if (inboundDecision.kind === "reject_overflow") {
      logger.error("meta-canary: signed webhook exceeds durable event limit", {
        eventLimit: META_CANARY_MAX_WEBHOOK_EVENTS,
      });
      response.set("Retry-After", "60");
      response.status(503).json({
        error: "webhook_batch_overflow",
        eventLimit: META_CANARY_MAX_WEBHOOK_EVENTS,
      });
      return;
    }
    const records = inboundDecision.records;
    if (records.length === 0) {
      response.status(200).json({ received: true, stored: 0 });
      return;
    }
    const allowlist = parseRecipientAllowlist(
      process.env.HEMAS_META_ALLOWLISTED_RECIPIENTS,
    );
    let planMode: "bot" | "auto_reply" | "none";
    try {
      planMode = currentCanaryMode();
    } catch {
      logger.error("meta-canary: bot mode configuration conflicts");
      response.status(503).json({ error: "canary_mode_unavailable" });
      return;
    }
    const nowMs = Date.now();
    const acceptPublicInbound = publicInboundEnabled(nowMs);
    const routeConfig = publicInboundRouteConfig();
    if (
      acceptPublicInbound &&
      !routeConfig.enabled
    ) {
      logger.error("meta-canary: public inbound return route is unconfigured");
      response.status(503).json({ error: "public_inbound_unavailable" });
      return;
    }
    const db = getCanaryFirestore(boundary.projectId);
    const inboundMessages = extractCanaryInboundBotMessages(
      payload,
      allowlist,
      acceptPublicInbound,
    );
    const optOuts = extractCanaryInboundMarketingOptOuts(
      payload,
      allowlist,
      acceptPublicInbound,
    );
    const optOutMessageIds = new Set(optOuts.map((optOut) => optOut.waMessageId));
    const optOutSenders = new Set(optOuts.map((optOut) => optOut.waId));
    // During the explicitly time-bounded test, every signed inbound sender uses
    // the isolated public lane. The allowlist continues to govern proactive
    // templates/campaigns only, so an older tester handoff cannot silence the
    // public acceptance journey.
    const publicInboundMessages = acceptPublicInbound ? inboundMessages : [];
    const publicReplyMessages = planMode !== "none"
      ? publicInboundMessages.filter(
        (message) =>
          !optOutMessageIds.has(message.waMessageId) &&
          !optOutSenders.has(message.waId),
      )
      : [];
    const publicSenderFingerprints = new Map<string, string>();
    let inboundReturnRoutes = new Map<string, MetaCanaryReturnRouteRecord>();
    if (publicInboundMessages.length > 0) {
      try {
        const phoneNumberId = process.env.HEMAS_META_PHONE_NUMBER_ID?.trim() ?? "";
        const phoneNumberAssetSha256 =
          metaCanaryReturnRoutePhoneAssetSha256(phoneNumberId);
        for (const message of publicInboundMessages) {
          publicSenderFingerprints.set(
            message.waMessageId,
            metaCanaryReturnRouteSenderSha256(
              message.waId,
              routeConfig.identitySecretBase64,
            ),
          );
        }
        inboundReturnRoutes = new Map(publicReplyMessages.map((message) => [
          message.waMessageId,
          encryptMetaCanaryReturnRoute({
            senderE164: message.waId,
            receiptId: message.waMessageId,
            workspaceId: META_CANARY_WORKSPACE_ID,
            phoneNumberAssetSha256,
            identitySecretBase64: routeConfig.identitySecretBase64,
            encryptionSecretBase64:
              routeConfig.encryptionKeysByVersion.get(
                routeConfig.currentKeyVersion,
              ) ?? "",
            keyVersion: routeConfig.currentKeyVersion,
            createdAtMs: nowMs,
            expiresAtMs: nowMs + 7 * 24 * 60 * 60 * 1_000,
          }),
        ]));
      } catch {
        logger.error("meta-canary: public inbound return route preparation failed");
        response.status(503).json({ error: "public_inbound_unavailable" });
        return;
      }
    }
    const minimizedRecords = records.map((record) => {
      if (record.kind !== "message") return record;
      const senderSha256 = publicSenderFingerprints.get(record.waMessageId);
      return senderSha256
        ? {
          ...record,
          fromNumberSha256: senderSha256,
          fromNumberLast4: null,
          bodySha256: null,
        }
        : record;
    });
    let persisted: PersistedWebhookBatch;
    try {
      persisted = await persistCanaryWebhookBatch({
        db,
        records: minimizedRecords,
        strictReplayRecords: records,
        allowlistedMessages: inboundMessages,
        optOuts,
        inboundReturnRoutes,
        publicInboundMessageIds: new Set(
          publicInboundMessages.map((message) => message.waMessageId),
        ),
        publicSameEnvelopeSuppressedMessageIds: new Set(
          publicInboundMessages
            .filter((message) => optOutSenders.has(message.waId))
            .map((message) => message.waMessageId),
        ),
        planMode,
        occurredAtMs: nowMs,
      });
    } catch {
      logger.error("meta-canary: durable receipt/outbox creation failed");
      response.status(503).json({ error: "storage_unavailable" });
      return;
    }

    let transientBotOverrides: readonly CanaryTransientBotOverride[] = [];
    try {
      transientBotOverrides = await buildTransientCanaryAiOverrides({
        db,
        messages: inboundMessages,
        freshRecords: persisted.freshRecords,
        botPlanReceiptIds: new Set(persisted.botPlanReceiptIds),
        aiBudgetReceiptIds: new Set(persisted.aiBudgetReceiptIds),
        publicSubjectsByReceipt: new Map(
          persisted.freshRecords.flatMap((record) => {
            if (
              record.kind !== "message" ||
              !record.fromNumberSha256 ||
              !publicSenderFingerprints.has(record.waMessageId)
            ) {
              return [];
            }
            return [[record.id, record.fromNumberSha256] as const];
          }),
        ),
        planMode,
        occurredAtMs: nowMs,
      });
    } catch {
      logger.warn("meta-bot: transient ai batch preparation failed");
    }

    let batch = {
      attempted: 0,
      terminal: 0,
      suppressed: 0,
      retryable: 0,
      fatal: 0,
      deferred: 0,
    };
    try {
      batch = await processCanaryOutboxBatch({
        db,
        effectIds: persisted.effectIds,
        leaseOwner: "http_webhook",
        phoneNumberId: process.env.HEMAS_META_PHONE_NUMBER_ID?.trim() ?? "",
        accessToken: accessTokenValue(),
        maxEffects: 20,
        transientBotOverrides,
        publicInboundRoute: routeConfig,
      });
    } catch {
      logger.warn("meta-canary: immediate outbox processing deferred");
    }

    logger.info("meta-canary: durable content-free webhook accepted", {
      createdReceipts: persisted.freshRecords.length,
      attemptedEffects: batch.attempted,
      terminalEffects: batch.terminal,
      suppressedEffects: batch.suppressed,
      retryableEffects: batch.retryable,
      fatalEffects: batch.fatal,
      publicQuotaSuppressed: persisted.publicQuotaSuppressed,
    });
    response.status(200).json({
      received: true,
      stored: persisted.freshRecords.length,
      duplicate: persisted.freshRecords.length === 0,
      outbox: batch,
    });
  },
);

type ReconcileInput = Record<string, never>;

/**
 * Private, bounded manual recovery entry point. This slice intentionally does
 * not provision Cloud Scheduler; an authorized operator invokes the callable.
 * Root barrel export is added separately.
 */
export const reconcileMetaCanaryOutbox = onCall(
  {
    memory: "256MiB",
    timeoutSeconds: 60,
    maxInstances: 1,
    concurrency: 1,
    secrets: [metaAccessToken, metaReturnRouteKeyring, metaPublicIdentityKey],
  },
  async (request: CallableRequest<ReconcileInput>) => {
    const boundary = canaryBoundaryOrNull();
    if (!boundary) {
      throw new HttpsError("failed-precondition", "The Meta canary lane is disabled.");
    }
    let actorUid: string;
    try {
      actorUid = assertMetaCanaryReconcilerAuthorization({
        uid: request.auth?.uid,
        emailVerified: request.auth?.token.email_verified,
        hemasMetaCanary: request.auth?.token.hemasMetaCanary,
        hemasMetaCanaryAdmin: request.auth?.token.hemasMetaCanaryAdmin,
      });
    } catch {
      throw new HttpsError(
        "permission-denied",
        "Meta canary outbox reconciliation requires the private admin claim.",
      );
    }
    const db = getCanaryFirestore(boundary.projectId);
    await requireActiveCanaryMembership({ db, uid: actorUid, requireAdmin: true });
    const result = await reconcileDueCanaryOutbox({
      db,
      phoneNumberId: process.env.HEMAS_META_PHONE_NUMBER_ID?.trim() ?? "",
      accessToken: accessTokenValue(),
      publicInboundRoute: publicInboundRouteConfig(),
    });
    return { reconciled: true, ...result, containsMessageContent: false };
  },
);

/**
 * Private evidence-only resolution for a fatal post-dispatch Graph ambiguity.
 * This callable has no Meta secret and cannot send or retry a provider request.
 */
export const reconcileMetaCanaryFatalEffect = onCall(
  {
    memory: "256MiB",
    timeoutSeconds: 30,
    maxInstances: 1,
    concurrency: 1,
    secrets: [metaReturnRouteKeyring, metaPublicIdentityKey],
  },
  async (request: CallableRequest<unknown>) => {
    const boundary = canaryBoundaryOrNull();
    if (!boundary) {
      throw new HttpsError("failed-precondition", "The Meta canary lane is disabled.");
    }
    let actorUid: string;
    try {
      actorUid = assertMetaCanaryReconcilerAuthorization({
        uid: request.auth?.uid,
        emailVerified: request.auth?.token.email_verified,
        hemasMetaCanary: request.auth?.token.hemasMetaCanary,
        hemasMetaCanaryAdmin: request.auth?.token.hemasMetaCanaryAdmin,
      });
    } catch {
      throw new HttpsError(
        "permission-denied",
        "Fatal Meta effect resolution requires the private admin claim.",
      );
    }
    const db = getCanaryFirestore(boundary.projectId);
    await requireActiveCanaryMembership({ db, uid: actorUid, requireAdmin: true });

    let resolution;
    try {
      resolution = assertCanaryFatalResolutionInput(request.data, sha256Hex);
    } catch {
      throw new HttpsError(
        "invalid-argument",
        "The fatal-effect resolution evidence contract is invalid.",
      );
    }
    try {
      return await reconcileFatalCanaryGraphEffect({
        db,
        resolution,
        actorUid,
        returnRouteAssetSha256: metaCanaryReturnRoutePhoneAssetSha256(
          process.env.HEMAS_META_PHONE_NUMBER_ID?.trim() ?? "",
        ),
        publicInboundRoute: publicInboundRouteConfig(),
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "unknown";
      if (
        code.startsWith("meta_canary_") ||
        code.startsWith("fatal_") ||
        code === "invalid_outbound_id" ||
        code === "invalid_outbound_conversation_state" ||
        code === "invalid_provider_route_target"
      ) {
        throw new HttpsError(
          "failed-precondition",
          "The effect is not an unresolved fatal post-dispatch ambiguity, or the evidence conflicts.",
        );
      }
      logger.error("meta-canary: fatal evidence reconciliation failed");
      throw new HttpsError(
        "unavailable",
        "Fatal effect evidence could not be committed.",
      );
    }
  },
);

type CanarySendInput = {
  readonly operationId?: string;
  readonly to?: string;
  readonly templateName?: string;
  readonly languageCode?: string;
};

type CanarySendResult = {
  readonly sent: true;
  readonly providerMessageId: string;
  readonly toLast4: string;
  readonly canary: true;
  readonly idempotent: boolean;
};

export const demoSendMetaCanaryTemplate = onCall(
  {
    memory: "256MiB",
    timeoutSeconds: 30,
    maxInstances: 3,
    secrets: [metaAccessToken],
  },
  async (request: CallableRequest<CanarySendInput>): Promise<CanarySendResult> => {
    const boundary = canaryBoundaryOrNull();
    if (!boundary) {
      throw new HttpsError("failed-precondition", "The Meta canary lane is disabled.");
    }
    let actorUid: string;
    try {
      actorUid = assertMetaCanaryTemplateAuthorization({
        uid: request.auth?.uid,
        emailVerified: request.auth?.token.email_verified,
        hemasMetaCanary: request.auth?.token.hemasMetaCanary,
      });
    } catch (error) {
      if (error instanceof MetaCanaryError) {
        throw new HttpsError("permission-denied", error.message);
      }
      throw error;
    }
    const db = getCanaryFirestore(boundary.projectId);
    await requireActiveCanaryMembership({ db, uid: actorUid, requireAdmin: false });

    let operationId: string;
    let to: string;
    let templateName: string;
    let languageCode: string;
    try {
      operationId = assertMetaCanaryOperationId(request.data?.operationId);
      to = assertAllowlistedRecipient(
        request.data?.to,
        parseRecipientAllowlist(process.env.HEMAS_META_ALLOWLISTED_RECIPIENTS),
      );
      templateName = request.data?.templateName?.trim() || META_CANARY_DEFAULT_TEMPLATE;
      languageCode = request.data?.languageCode?.trim() || META_CANARY_DEFAULT_LANGUAGE;
      buildCanaryTemplateSendBody({ to, templateName, languageCode });
    } catch (error) {
      if (error instanceof MetaCanaryError) {
        throw new HttpsError(
          error.code === "recipient_not_allowlisted" ? "permission-denied" : "invalid-argument",
          error.message,
        );
      }
      throw new HttpsError("invalid-argument", "A strict canary operation id is required.");
    }

    const phoneNumberId = process.env.HEMAS_META_PHONE_NUMBER_ID?.trim() ?? "";
    if (!/^\d{5,32}$/.test(phoneNumberId)) {
      throw new HttpsError(
        "failed-precondition",
        "The canary phone number is not configured.",
      );
    }
    const outboundId = canaryTemplateOperationDocumentId(operationId, sha256Hex);
    const requestSha256 = canaryTemplateRequestSha256(
      { operationId, actorUid, recipient: to, templateName, languageCode },
      sha256Hex,
    );
    const effectId = canaryOutboxEffectId(
      outboundId,
      "graph_template_send",
      "provider",
      sha256Hex,
    );
    const nowMs = Date.now();
    const templateEffect = buildCanaryOutboxRecord({
      id: effectId,
      receiptId: outboundId,
      effectKind: "graph_template_send",
      payload: {
        outboundId,
        recipientSha256: sha256Hex(`canary-sender:${to}`),
        recipientLast4: to.slice(-4),
        templateName,
        languageCode,
        templatePurpose: canaryTemplatePurpose(templateName),
        requestSha256,
      },
      nowMs,
    });
    let operationDecision: CanaryTemplateOperationDecision;
    try {
      operationDecision = await db.runTransaction(async (transaction) => {
        const outboundRef = workspace(db)
          .collection(META_CANARY_OUTBOUND_COLLECTION)
          .doc(outboundId);
        const effectRef = outbox(db).doc(effectId);
        const [outboundSnapshot, effectSnapshot] = await Promise.all([
          transaction.get(outboundRef),
          transaction.get(effectRef),
        ]);
        const decision = decideCanaryTemplateOperation(outboundSnapshot.data(), {
          id: outboundId,
          operationId,
          actorUid,
          requestSha256,
          toLast4: to.slice(-4),
        });
        if (decision.kind === "reserve") {
          if (effectSnapshot.exists) throw new Error("template_effect_collision");
          transaction.create(outboundRef, {
            id: outboundId,
            workspaceId: META_CANARY_WORKSPACE_ID,
            operationId,
            actorUid,
            requestSha256,
            outboxEffectId: effectId,
            toNumberSha256: sha256Hex(`canary-recipient:${to}`),
            toNumberLast4: to.slice(-4),
            templateName,
            languageCode,
            templatePurpose: canaryTemplatePurpose(templateName),
            status: "reserved",
            providerMessageId: null,
            providerStatus: null,
            canary: true,
            containsMessageContent: false,
            containsFullRecipient: false,
            schemaVersion: 2,
            createdAt: Timestamp.fromMillis(nowMs),
            updatedAt: Timestamp.fromMillis(nowMs),
          });
          transaction.create(effectRef, templateEffect);
        } else if (decision.kind === "process") {
          if (effectSnapshot.exists) {
            const existingEffect = parseCanaryOutboxRecord(effectSnapshot.data());
            if (
              !existingEffect ||
              existingEffect.id !== templateEffect.id ||
              existingEffect.receiptId !== templateEffect.receiptId ||
              existingEffect.effectKind !== "graph_template_send" ||
              existingEffect.payload.requestSha256 !== requestSha256
            ) {
              throw new Error("template_effect_collision");
            }
          } else {
            transaction.create(effectRef, templateEffect);
          }
        }
        return decision;
      });
    } catch {
      throw new HttpsError(
        "failed-precondition",
        "This canary operation is bound to another request or has an ambiguous provider outcome.",
      );
    }

    if (operationDecision.kind === "suppressed") {
      throw new HttpsError(
        "failed-precondition",
        "The current contact suppression policy blocked this canary send.",
      );
    }
    if (operationDecision.kind === "not_sent") {
      throw new HttpsError(
        "failed-precondition",
        "This canary operation ended before any provider dispatch and will not be retried.",
      );
    }
    if (operationDecision.kind === "replay") {
      return operationDecision.result;
    }
    const processed = await processCanaryOutboxEffect({
      db,
      effectId,
      leaseOwner: "http_webhook",
      phoneNumberId,
      accessToken: accessTokenValue(),
    });
    if (processed.disposition === "suppressed") {
      throw new HttpsError(
        "failed-precondition",
        "The current contact suppression policy blocked this canary send.",
      );
    }
    if (processed.disposition !== "terminal") {
      throw new HttpsError(
        "unavailable",
        "The canary send is pending recovery or has an ambiguous provider outcome; it was not resent.",
      );
    }
    const completed = await workspace(db)
      .collection(META_CANARY_OUTBOUND_COLLECTION)
      .doc(outboundId)
      .get();
    const replay = decideCanaryTemplateOperation(completed.data(), {
      id: outboundId,
      operationId,
      actorUid,
      requestSha256,
      toLast4: to.slice(-4),
    });
    if (replay.kind === "not_sent") {
      throw new HttpsError(
        "failed-precondition",
        "This canary operation ended before any provider dispatch and will not be retried.",
      );
    }
    if (replay.kind !== "replay") {
      throw new HttpsError("unavailable", "The canary send result is not durable yet.");
    }
    return {
      ...replay.result,
      idempotent: operationDecision.kind !== "reserve",
    };
  },
);
