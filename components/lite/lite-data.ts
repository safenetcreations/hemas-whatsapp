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

export function useLiteConversations(enabled: boolean): ListenerState<LiteConversation> {
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
  }, [enabled]);

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

export function useLiteContacts(enabled: boolean): ListenerState<LiteContact> {
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
  }, [enabled]);

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

export async function liteReply(conversationId: string, text: string): Promise<void> {
  const callable = httpsCallable(liteFunctions(), "liteSendAgentReply", {
    timeout: 25_000,
  });
  await callable({ conversationId, text });
}

export async function liteSetupSeats(): Promise<unknown> {
  const callable = httpsCallable(liteFunctions(), "liteDemoSetup", { timeout: 45_000 });
  const result = await callable({});
  return result.data;
}
