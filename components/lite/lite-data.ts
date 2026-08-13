"use client";

/**
 * Hemas Lite — live data hooks and callable wrappers.
 *
 * Every query matches the deny-by-default Firestore rules for scoped
 * operational roles: fixed workspace path, explicit teamId + locationId
 * filters, bounded limits. Message documents are metadata-only by design —
 * the UI renders direction/type/time, never bodies (which do not exist).
 */

import {
  Timestamp,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
  type Functions,
} from "firebase/functions";
import { useEffect, useMemo, useState } from "react";
import { getFirebaseServices } from "@/lib/firebase/client";
import { currentCloudDemoRuntime } from "@/lib/firebase/runtime-mode";
import { LITE_LOCATION_ID, LITE_TEAM_ID, LITE_WORKSPACE_ID } from "./lite-config";

// ---------------------------------------------------------------------------
// Shapes (tolerant parses of the governed documents)
// ---------------------------------------------------------------------------

export interface LiteConversation {
  readonly id: string;
  readonly contactId: string;
  readonly status: string;
  readonly mode: string;
  readonly assigneeId: string | null;
  readonly purpose: string;
  readonly detectedLanguage: string;
  readonly unreadCount: number;
  readonly liveCanary: boolean;
  readonly lastMessageAtMs: number;
  readonly serviceWindowExpiresAtMs: number;
}

export interface LiteMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly direction: "inbound" | "outbound";
  readonly type: string;
  readonly status: string;
  readonly actorId: string | null;
  readonly agentReply: boolean;
  readonly createdAtMs: number;
}

export interface LiteContact {
  readonly id: string;
  readonly crmStage: string;
  readonly displayLabel: string;
  readonly maskedPhone: string;
  readonly preferredLanguage: string;
  readonly tags: readonly string[];
  readonly liveCanary: boolean;
}

function toMillis(value: unknown): number {
  return value instanceof Timestamp ? value.toMillis() : 0;
}

// ---------------------------------------------------------------------------
// Live listeners
// ---------------------------------------------------------------------------

type ListenerState<T> = {
  readonly rows: readonly T[];
  readonly loading: boolean;
  readonly error: string | null;
};

export function useLiteConversations(
  enabled: boolean,
  liveOnly = false,
): ListenerState<LiteConversation> {
  const [state, setState] = useState<ListenerState<LiteConversation>>({
    rows: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let db;
    try {
      db = getFirebaseServices().db;
    } catch (error) {
      queueMicrotask(() => {
        if (!active) return;
        setState({
          rows: [],
          loading: false,
          error: error instanceof Error ? error.message : "Firebase unavailable.",
        });
      });
      return () => {
        active = false;
      };
    }
    const q = query(
      collection(db, "workspaces", LITE_WORKSPACE_ID, "conversations"),
      where("teamId", "==", LITE_TEAM_ID),
      where("locationId", "==", LITE_LOCATION_ID),
      ...(liveOnly ? [where("liveCanary", "==", true)] : []),
      orderBy("lastMessageAt", "desc"),
      limit(50),
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!active) return;
        const rows = snapshot.docs.map((record) => {
          const data = record.data();
          return {
            id: record.id,
            contactId: typeof data.contactId === "string" ? data.contactId : "",
            status: typeof data.status === "string" ? data.status : "active",
            mode: typeof data.mode === "string" ? data.mode : "automation",
            assigneeId: typeof data.assigneeId === "string" ? data.assigneeId : null,
            purpose: typeof data.purpose === "string" ? data.purpose : "general_support",
            detectedLanguage:
              typeof data.detectedLanguage === "string" ? data.detectedLanguage : "en",
            unreadCount: typeof data.unreadCount === "number" ? data.unreadCount : 0,
            liveCanary: data.liveCanary === true,
            lastMessageAtMs: toMillis(data.lastMessageAt),
            serviceWindowExpiresAtMs: toMillis(data.serviceWindowExpiresAt),
          } satisfies LiteConversation;
        });
        setState({ rows, loading: false, error: null });
      },
      (error) => {
        if (active) setState({ rows: [], loading: false, error: error.message });
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [enabled, liveOnly]);

  return state;
}

export function useLiteMessages(conversationId: string | null): ListenerState<LiteMessage> {
  const [state, setState] = useState<ListenerState<LiteMessage>>({
    rows: [],
    loading: false,
    error: null,
  });

  useEffect(() => {
    let active = true;
    if (!conversationId) {
      queueMicrotask(() => {
        if (active) setState({ rows: [], loading: false, error: null });
      });
      return () => {
        active = false;
      };
    }
    let db;
    try {
      db = getFirebaseServices().db;
    } catch (error) {
      queueMicrotask(() => {
        if (!active) return;
        setState({
          rows: [],
          loading: false,
          error: error instanceof Error ? error.message : "Firebase unavailable.",
        });
      });
      return () => {
        active = false;
      };
    }
    queueMicrotask(() => {
      if (active) setState({ rows: [], loading: true, error: null });
    });
    const q = query(
      collection(db, "workspaces", LITE_WORKSPACE_ID, "messages"),
      where("conversationId", "==", conversationId),
      where("teamId", "==", LITE_TEAM_ID),
      where("locationId", "==", LITE_LOCATION_ID),
      orderBy("createdAt", "desc"),
      limit(60),
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!active) return;
        const rows = snapshot.docs
          .map((record) => {
            const data = record.data();
            return {
              id: record.id,
              conversationId:
                typeof data.conversationId === "string" ? data.conversationId : "",
              direction: data.direction === "outbound" ? "outbound" : "inbound",
              type: typeof data.type === "string" ? data.type : "text",
              status: typeof data.status === "string" ? data.status : "sent",
              actorId: typeof data.actorId === "string" ? data.actorId : null,
              agentReply: data.agentReply === true,
              createdAtMs: toMillis(data.createdAt),
            } satisfies LiteMessage;
          })
          .reverse();
        setState({ rows, loading: false, error: null });
      },
      (error) => {
        if (active) setState({ rows: [], loading: false, error: error.message });
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [conversationId]);

  return state;
}

export function useLiteContacts(
  enabled: boolean,
  liveOnly = false,
): ListenerState<LiteContact> {
  const [state, setState] = useState<ListenerState<LiteContact>>({
    rows: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let db;
    try {
      db = getFirebaseServices().db;
    } catch (error) {
      queueMicrotask(() => {
        if (!active) return;
        setState({
          rows: [],
          loading: false,
          error: error instanceof Error ? error.message : "Firebase unavailable.",
        });
      });
      return () => {
        active = false;
      };
    }
    const q = query(
      collection(db, "workspaces", LITE_WORKSPACE_ID, "contacts"),
      where("teamId", "==", LITE_TEAM_ID),
      where("locationId", "==", LITE_LOCATION_ID),
      ...(liveOnly ? [where("liveCanary", "==", true)] : []),
      limit(60),
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!active) return;
        const rows = snapshot.docs.map((record) => {
          const data = record.data();
          return {
            id: record.id,
            displayLabel:
              typeof data.displayLabel === "string" ? data.displayLabel : "Visitor",
            maskedPhone:
              typeof data.maskedPhone === "string" ? data.maskedPhone : "number withheld",
            preferredLanguage:
              typeof data.preferredLanguage === "string" ? data.preferredLanguage : "en",
            tags: Array.isArray(data.tags)
              ? data.tags.filter((tag): tag is string => typeof tag === "string")
              : [],
            liveCanary: data.liveCanary === true,
            crmStage: (() => {
              const tags: unknown[] = Array.isArray(data.tags) ? data.tags : [];
              if (tags.includes("appointment")) return "booked";
              if (tags.includes("human-handoff")) return "needs_human";
              return "engaged";
            })(),
          } satisfies LiteContact;
        });
        setState({ rows, loading: false, error: null });
      },
      (error) => {
        if (active) setState({ rows: [], loading: false, error: error.message });
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [enabled, liveOnly]);

  return state;
}

/** contactId → contact map for labelling conversation rows. */
export function useLiteContactIndex(
  contacts: readonly LiteContact[],
): ReadonlyMap<string, LiteContact> {
  return useMemo(() => {
    const map = new Map<string, LiteContact>();
    for (const contact of contacts) map.set(contact.id, contact);
    return map;
  }, [contacts]);
}

// ---------------------------------------------------------------------------
// Campaigns (content-free summaries + per-recipient delivery states)
// ---------------------------------------------------------------------------

export interface LiteCampaign {
  readonly id: string;
  readonly name: string;
  readonly templateName: string;
  readonly status: string;
  readonly audienceCount: number;
  readonly sentCount: number;
  readonly failedCount: number;
  readonly createdAtMs: number;
}

export function useLiteCampaigns(enabled: boolean): ListenerState<LiteCampaign> {
  const [state, setState] = useState<ListenerState<LiteCampaign>>({
    rows: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let db;
    try {
      db = getFirebaseServices().db;
    } catch (error) {
      queueMicrotask(() => {
        if (!active) return;
        setState({
          rows: [],
          loading: false,
          error: error instanceof Error ? error.message : "Firebase unavailable.",
        });
      });
      return () => {
        active = false;
      };
    }
    const q = query(
      collection(db, "workspaces", LITE_WORKSPACE_ID, "canary_campaigns"),
      orderBy("createdAt", "desc"),
      limit(20),
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!active) return;
        const rows = snapshot.docs.map((record) => {
          const data = record.data();
          return {
            id: record.id,
            name: typeof data.name === "string" ? data.name : record.id,
            templateName: typeof data.templateName === "string" ? data.templateName : "",
            status: typeof data.status === "string" ? data.status : "sending",
            audienceCount: typeof data.audienceCount === "number" ? data.audienceCount : 0,
            sentCount: typeof data.sentCount === "number" ? data.sentCount : 0,
            failedCount: typeof data.failedCount === "number" ? data.failedCount : 0,
            createdAtMs: toMillis(data.createdAt),
          } satisfies LiteCampaign;
        });
        setState({ rows, loading: false, error: null });
      },
      (error) => {
        if (active) setState({ rows: [], loading: false, error: error.message });
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [enabled]);

  return state;
}

export interface LiteCampaignSend {
  readonly id: string;
  readonly toNumberLast4: string;
  readonly status: string;
  readonly errorCode: string | null;
}

export function useLiteCampaignSends(campaignId: string | null): ListenerState<LiteCampaignSend> {
  const [state, setState] = useState<ListenerState<LiteCampaignSend>>({
    rows: [],
    loading: false,
    error: null,
  });

  useEffect(() => {
    let active = true;
    if (!campaignId) {
      queueMicrotask(() => {
        if (active) setState({ rows: [], loading: false, error: null });
      });
      return () => {
        active = false;
      };
    }
    let db;
    try {
      db = getFirebaseServices().db;
    } catch (error) {
      queueMicrotask(() => {
        if (!active) return;
        setState({
          rows: [],
          loading: false,
          error: error instanceof Error ? error.message : "Firebase unavailable.",
        });
      });
      return () => {
        active = false;
      };
    }
    queueMicrotask(() => {
      if (active) setState({ rows: [], loading: true, error: null });
    });
    const q = query(
      collection(db, "workspaces", LITE_WORKSPACE_ID, "canary_campaign_sends"),
      where("campaignId", "==", campaignId),
      limit(25),
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!active) return;
        const rows = snapshot.docs.map((record) => {
          const data = record.data();
          return {
            id: record.id,
            toNumberLast4: typeof data.toNumberLast4 === "string" ? data.toNumberLast4 : "····",
            status: typeof data.status === "string" ? data.status : "sent",
            errorCode: typeof data.errorCode === "string" ? data.errorCode : null,
          } satisfies LiteCampaignSend;
        });
        setState({ rows, loading: false, error: null });
      },
      (error) => {
        if (active) setState({ rows: [], loading: false, error: error.message });
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [campaignId]);

  return state;
}

// ---------------------------------------------------------------------------
// Daily metrics (content-free counters for Analytics + quotas)
// ---------------------------------------------------------------------------

export interface LiteDailyMetrics {
  readonly id: string;
  readonly day: string;
  readonly inboundMessages: number;
  readonly botReplies: number;
  readonly aiAnswers: number;
  readonly bookings: number;
  readonly staffHandoffs: number;
  readonly agentReplies: number;
  readonly campaignSends: number;
  readonly apiRequests: number;
}

function metricNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function useLiteMetrics(enabled: boolean): ListenerState<LiteDailyMetrics> {
  const [state, setState] = useState<ListenerState<LiteDailyMetrics>>({
    rows: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let db;
    try {
      db = getFirebaseServices().db;
    } catch (error) {
      queueMicrotask(() => {
        if (!active) return;
        setState({
          rows: [],
          loading: false,
          error: error instanceof Error ? error.message : "Firebase unavailable.",
        });
      });
      return () => {
        active = false;
      };
    }
    const q = query(
      collection(db, "workspaces", LITE_WORKSPACE_ID, "canary_metrics"),
      orderBy("day", "desc"),
      limit(31),
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!active) return;
        const rows = snapshot.docs.map((record) => {
          const data = record.data();
          return {
            id: record.id,
            day: typeof data.day === "string" ? data.day : "",
            inboundMessages: metricNumber(data.inboundMessages),
            botReplies: metricNumber(data.botReplies),
            aiAnswers: metricNumber(data.aiAnswers),
            bookings: metricNumber(data.bookings),
            staffHandoffs: metricNumber(data.staffHandoffs),
            agentReplies: metricNumber(data.agentReplies),
            campaignSends: metricNumber(data.campaignSends),
            apiRequests: metricNumber(data.apiRequests),
          } satisfies LiteDailyMetrics;
        });
        setState({ rows, loading: false, error: null });
      },
      (error) => {
        if (active) setState({ rows: [], loading: false, error: error.message });
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [enabled]);

  return state;
}

// ---------------------------------------------------------------------------
// Callables
// ---------------------------------------------------------------------------

declare global {
  var __hemasLiteFunctions: Functions | undefined;
  var __hemasLiteFunctionsEmulated: boolean | undefined;
}

function liteFunctions(): Functions {
  if (globalThis.__hemasLiteFunctions) return globalThis.__hemasLiteFunctions;
  const { app } = getFirebaseServices();
  const functions = getFunctions(app, "us-central1");
  const cloudRuntime = currentCloudDemoRuntime();
  if (!cloudRuntime.active && !globalThis.__hemasLiteFunctionsEmulated) {
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
    globalThis.__hemasLiteFunctionsEmulated = true;
  }
  globalThis.__hemasLiteFunctions = functions;
  return functions;
}

export async function liteClaim(
  conversationId: string,
  action: "claim" | "release",
): Promise<void> {
  const callable = httpsCallable(liteFunctions(), "liteClaimConversation", {
    timeout: 20_000,
  });
  await callable({ conversationId, action });
}

export async function liteReply(
  conversationId: string,
  text: string,
  operationId: string,
): Promise<void> {
  const callable = httpsCallable(liteFunctions(), "liteSendAgentReply", {
    timeout: 25_000,
  });
  await callable({ conversationId, operationId, text });
}

export async function liteSetupSeats(): Promise<unknown> {
  const callable = httpsCallable(liteFunctions(), "liteDemoSetup", { timeout: 45_000 });
  const result = await callable({});
  return result.data;
}

export interface LiteReplyReconciliationRequest {
  readonly conversationId: string;
  readonly operationId: string;
  readonly outcome: "sent" | "not_sent";
  readonly providerMessageId: string | null;
  readonly providerEvidenceSha256: string;
}

export async function liteReconcileReplyEvidence(
  input: LiteReplyReconciliationRequest,
): Promise<{ readonly idempotent: boolean }> {
  const callable = httpsCallable(liteFunctions(), "liteReconcileAgentReply", {
    timeout: 30_000,
  });
  const result = await callable(input);
  return result.data as { readonly idempotent: boolean };
}

export interface LiteBookingReconciliationRequest {
  readonly operationId: string;
  readonly requestSha256: string;
  readonly outcome: "sent" | "not_sent";
  readonly providerMessageId: string | null;
  readonly providerEvidenceSha256: string;
}

export async function liteReconcileBookingEvidence(
  input: LiteBookingReconciliationRequest,
): Promise<{ readonly idempotent: boolean }> {
  const callable = httpsCallable(liteFunctions(), "liteReconcileBookingNotification", {
    timeout: 30_000,
  });
  const result = await callable(input);
  return result.data as { readonly idempotent: boolean };
}

export interface LiteCampaignReconciliationRequest {
  readonly operationId: string;
  readonly requestSha256: string;
  readonly recipientOperationId: string | null;
  readonly outcome: "sent" | "not_sent" | "finalize_recorded" | "halt_reserved";
  readonly providerMessageId: string | null;
  readonly providerEvidenceSha256: string;
}

export async function liteReconcileCampaignEvidence(
  input: LiteCampaignReconciliationRequest,
): Promise<{ readonly idempotent: boolean; readonly sent: number; readonly failed: number }> {
  const callable = httpsCallable(liteFunctions(), "liteReconcileCampaign", {
    timeout: 30_000,
  });
  const result = await callable(input);
  return result.data as {
    readonly idempotent: boolean;
    readonly sent: number;
    readonly failed: number;
  };
}

export interface MetaOutboxReconciliationResult {
  readonly attempted: number;
  readonly terminal: number;
  readonly suppressed: number;
  readonly retryable: number;
  readonly fatal: number;
  readonly deferred: number;
}

export async function reconcileMetaCanaryOutbox(): Promise<MetaOutboxReconciliationResult> {
  const callable = httpsCallable(liteFunctions(), "reconcileMetaCanaryOutbox", {
    timeout: 60_000,
  });
  const result = await callable({});
  return result.data as MetaOutboxReconciliationResult;
}

export type MetaCanaryFatalEffectKind =
  | "graph_bot_reply"
  | "graph_auto_reply"
  | "graph_template_send";

export type MetaCanaryFatalOutcome =
  | "confirmed_sent"
  | "confirmed_not_sent";

export interface MetaCanaryFatalResolutionDraft {
  readonly effectId: string;
  readonly effectKind: MetaCanaryFatalEffectKind;
  readonly outcome: MetaCanaryFatalOutcome;
  readonly providerMessageId: string | null;
  readonly providerEvidenceSha256: string;
}

interface MetaCanaryFatalResolutionRequest extends MetaCanaryFatalResolutionDraft {
  readonly requestSha256: string;
}

function assertMetaCanaryFatalResolutionDraft(
  input: MetaCanaryFatalResolutionDraft,
): MetaCanaryFatalResolutionDraft {
  if (
    !/^fx_[0-9a-f]{8,64}$/.test(input.effectId) ||
    (input.effectKind !== "graph_bot_reply" &&
      input.effectKind !== "graph_auto_reply" &&
      input.effectKind !== "graph_template_send") ||
    (input.outcome !== "confirmed_sent" && input.outcome !== "confirmed_not_sent") ||
    !/^[0-9a-f]{64}$/.test(input.providerEvidenceSha256) ||
    (input.outcome === "confirmed_sent"
      ? typeof input.providerMessageId !== "string" ||
        input.providerMessageId.trim().length === 0 ||
        input.providerMessageId.length > 512
      : input.providerMessageId !== null)
  ) {
    throw new Error("Fatal-effect reconciliation evidence is invalid.");
  }
  return input;
}

async function browserSha256Hex(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Secure browser hashing is unavailable.");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

/** Build the exact evidence-only request contract expected by Functions. */
export async function buildMetaCanaryFatalResolutionRequest(
  raw: MetaCanaryFatalResolutionDraft,
): Promise<MetaCanaryFatalResolutionRequest> {
  const input = assertMetaCanaryFatalResolutionDraft(raw);
  const requestSha256 = await browserSha256Hex(JSON.stringify([
    "meta-canary-fatal-resolution:v1",
    input.effectId,
    input.effectKind,
    input.outcome,
    input.providerMessageId,
    input.providerEvidenceSha256,
  ]));
  return { ...input, requestSha256 };
}

export async function reconcileMetaCanaryFatalEffect(
  draft: MetaCanaryFatalResolutionDraft,
): Promise<{ readonly idempotent: boolean }> {
  const request = await buildMetaCanaryFatalResolutionRequest(draft);
  const callable = httpsCallable(liteFunctions(), "reconcileMetaCanaryFatalEffect", {
    timeout: 30_000,
  });
  const result = await callable(request);
  if (
    typeof result.data !== "object" ||
    result.data === null ||
    Array.isArray(result.data)
  ) {
    throw new Error("Fatal-effect reconciliation returned invalid evidence.");
  }
  const data = result.data as Record<string, unknown>;
  if (
    data.resolved !== true ||
    data.effectId !== request.effectId ||
    data.effectKind !== request.effectKind ||
    data.outcome !== request.outcome ||
    data.providerMessageId !== request.providerMessageId ||
    typeof data.idempotent !== "boolean" ||
    data.canary !== true ||
    data.containsMessageContent !== false
  ) {
    throw new Error("Fatal-effect reconciliation returned invalid evidence.");
  }
  return { idempotent: data.idempotent };
}

// ---------------------------------------------------------------------------
// Bookings + doctors
// ---------------------------------------------------------------------------

export interface LiteBooking {
  readonly id: string;
  readonly reference: string;
  readonly departmentId: string;
  readonly dayId: string;
  readonly slotId: string;
  readonly language: string;
  readonly visitorKey: string;
  readonly status: string;
  readonly createdAtMs: number;
}

export function useLiteBookings(enabled: boolean): ListenerState<LiteBooking> {
  const [state, setState] = useState<ListenerState<LiteBooking>>({ rows: [], loading: true, error: null });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let db;
    try { db = getFirebaseServices().db; } catch (error) {
      queueMicrotask(() => { if (active) setState({ rows: [], loading: false, error: error instanceof Error ? error.message : "Firebase unavailable." }); });
      return () => { active = false; };
    }
    const q = query(
      collection(db, "workspaces", LITE_WORKSPACE_ID, "canary_bookings"),
      orderBy("createdAt", "desc"),
      limit(60),
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!active) return;
      const rows = snapshot.docs.map((record) => {
        const data = record.data();
        return {
          id: record.id,
          reference: typeof data.reference === "string" ? data.reference : record.id,
          departmentId: typeof data.departmentId === "string" ? data.departmentId : "",
          dayId: typeof data.dayId === "string" ? data.dayId : "",
          slotId: typeof data.slotId === "string" ? data.slotId : "",
          language: typeof data.language === "string" ? data.language : "en",
          visitorKey: typeof data.visitorKey === "string" ? data.visitorKey : "",
          status: typeof data.status === "string" ? data.status : "requested",
          createdAtMs: toMillis(data.createdAt),
        } satisfies LiteBooking;
      });
      setState({ rows, loading: false, error: null });
    }, (error) => { if (active) setState({ rows: [], loading: false, error: error.message }); });
    return () => { active = false; unsubscribe(); };
  }, [enabled]);
  return state;
}

export interface LiteDoctor {
  readonly id: string;
  readonly name: string;
  readonly departmentId: string;
  readonly hospital: string;
  readonly active: boolean;
}

export function useLiteDoctors(enabled: boolean): ListenerState<LiteDoctor> {
  const [state, setState] = useState<ListenerState<LiteDoctor>>({ rows: [], loading: true, error: null });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let db;
    try { db = getFirebaseServices().db; } catch (error) {
      queueMicrotask(() => { if (active) setState({ rows: [], loading: false, error: error instanceof Error ? error.message : "Firebase unavailable." }); });
      return () => { active = false; };
    }
    const q = query(
      collection(db, "workspaces", LITE_WORKSPACE_ID, "lite_doctors"),
      orderBy("name", "asc"),
      limit(60),
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!active) return;
      const rows = snapshot.docs.map((record) => {
        const data = record.data();
        return {
          id: record.id,
          name: typeof data.name === "string" ? data.name : record.id,
          departmentId: typeof data.departmentId === "string" ? data.departmentId : "",
          hospital: typeof data.hospital === "string" ? data.hospital : "Wattala",
          active: data.active !== false,
        } satisfies LiteDoctor;
      });
      setState({ rows, loading: false, error: null });
    }, (error) => { if (active) setState({ rows: [], loading: false, error: error.message }); });
    return () => { active = false; unsubscribe(); };
  }, [enabled]);
  return state;
}

export async function liteSetBooking(
  bookingId: string,
  status: "confirmed" | "cancelled",
  operationId: string,
): Promise<{
  ok: true;
  bookingId: string;
  status: "confirmed" | "cancelled";
  notified: boolean;
  idempotent: boolean;
}> {
  const callable = httpsCallable(liteFunctions(), "liteSetBookingStatus", { timeout: 25_000 });
  return (await callable({ bookingId, status, operationId })).data as {
    ok: true;
    bookingId: string;
    status: "confirmed" | "cancelled";
    notified: boolean;
    idempotent: boolean;
  };
}

export async function liteSaveDoctor(input: {
  doctorId?: string; name: string; departmentId: string; hospital: string; active?: boolean;
}): Promise<void> {
  const callable = httpsCallable(liteFunctions(), "liteUpsertDoctor", { timeout: 25_000 });
  await callable(input);
}

export interface LiteCampaignLaunchResult {
  readonly campaignId: string;
  readonly audience: number;
  readonly excluded: number;
  readonly sent: number;
  readonly failed: number;
  readonly idempotent: boolean;
}

export async function liteLaunchCampaign(
  operationId: string,
  name: string,
  templateName?: string,
  recipients?: readonly string[],
): Promise<LiteCampaignLaunchResult> {
  const callable = httpsCallable(liteFunctions(), "liteSendCampaign", { timeout: 110_000 });
  const result = await callable({
    operationId,
    name,
    ...(templateName ? { templateName } : {}),
    ...(recipients && recipients.length > 0 ? { recipients } : {}),
  });
  return result.data as LiteCampaignLaunchResult;
}
