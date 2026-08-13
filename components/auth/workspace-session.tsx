"use client";

import {
  doc,
  getDocFromServer,
  onSnapshot,
  type DocumentData,
  type DocumentReference,
  type Unsubscribe,
} from "firebase/firestore";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { getLocalEmulatorFirestore } from "@/lib/firebase/auth-emulator";
import {
  parseVerifiedWorkspaceSession,
  syntheticWorkspaceId,
  WorkspaceSessionError,
  type VerifiedWorkspaceSession,
} from "@/lib/firebase/workspace-session-model";
import { useAuthSession } from "./auth-session";

export type WorkspaceSessionStatus =
  | "checking"
  | "verified"
  | "denied"
  | "unavailable";

export type WorkspaceSessionSnapshot = {
  status: WorkspaceSessionStatus;
  session: VerifiedWorkspaceSession | null;
  message: string | null;
};

const WorkspaceSessionContext = createContext<WorkspaceSessionSnapshot | null>(null);
const checkingSnapshot: WorkspaceSessionSnapshot = {
  status: "checking",
  session: null,
  message: null,
};

class WorkspaceSessionTimeoutError extends Error {
  constructor() {
    super("Firestore did not verify workspace access in time.");
    this.name = "WorkspaceSessionTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new WorkspaceSessionTimeoutError()), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function failureSnapshot(error: unknown): WorkspaceSessionSnapshot {
  const firebaseCode =
    typeof error === "object" && error && "code" in error ? String(error.code) : "";
  const denied =
    error instanceof WorkspaceSessionError ||
    firebaseCode.includes("permission-denied") ||
    firebaseCode.includes("unauthenticated");

  return {
    status: denied ? "denied" : "unavailable",
    session: null,
    message: denied
      ? "The synthetic workspace or membership is missing, inactive, revoked, or invalid."
      : "Firestore could not verify governed workspace access.",
  };
}

function dataOrNull(
  snapshot: Awaited<ReturnType<typeof getDocFromServer>>,
): unknown | null {
  return snapshot.exists() ? snapshot.data() : null;
}

export function WorkspaceSessionProvider({ children }: { children: ReactNode }) {
  const { status: authStatus, user: authUser, signOut } = useAuthSession();
  const [snapshot, setSnapshot] = useState<WorkspaceSessionSnapshot>(checkingSnapshot);

  useEffect(() => {
    let active = true;
    let failed = false;
    let heartbeat: number | undefined;
    let cacheFallbackTimeout: number | undefined;
    const subscriptions: Unsubscribe[] = [];

    if (authStatus !== "authenticated" || !authUser) {
      queueMicrotask(() => {
        if (active) setSnapshot(checkingSnapshot);
      });
      return () => {
        active = false;
      };
    }

    const user = authUser;
    const failClosed = (error: unknown) => {
      if (!active || failed) return;
      failed = true;
      setSnapshot(failureSnapshot(error));
      for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
      if (heartbeat !== undefined) window.clearInterval(heartbeat);
      if (cacheFallbackTimeout !== undefined) window.clearTimeout(cacheFallbackTimeout);
      void signOut().catch(() => {
        // Workspace state is already locked even if local Auth cleanup fails.
      });
    };

    const verifyDocuments = (workspaceData: unknown | null, membershipData: unknown | null) =>
      parseVerifiedWorkspaceSession({
        workspaceData,
        membershipData,
        expectedWorkspaceId: syntheticWorkspaceId,
        expectedUid: user.uid,
      });

    queueMicrotask(() => {
      if (active) setSnapshot(checkingSnapshot);
    });

    void (async () => {
      try {
        const db = getLocalEmulatorFirestore();
        const workspaceRef = doc(db, "workspaces", syntheticWorkspaceId);
        const membershipRef = doc(
          db,
          "workspaces",
          syntheticWorkspaceId,
          "members",
          user.uid,
        );
        const [workspaceDocument, membershipDocument] = await withTimeout(
          Promise.all([
            getDocFromServer(workspaceRef),
            getDocFromServer(membershipRef),
          ]),
          7_500,
        );
        if (!active || failed) return;

        let workspaceData: unknown | null = dataOrNull(workspaceDocument);
        let membershipData: unknown | null = dataOrNull(membershipDocument);
        const applyVerifiedSession = () => {
          if (!active || failed) return;
          try {
            setSnapshot({
              status: "verified",
              session: verifyDocuments(workspaceData, membershipData),
              message: null,
            });
          } catch (error) {
            failClosed(error);
          }
        };

        const acceptServerEvidence = () => {
          if (cacheFallbackTimeout !== undefined) {
            window.clearTimeout(cacheFallbackTimeout);
            cacheFallbackTimeout = undefined;
          }
        };

        const noteCacheFallback = () => {
          if (cacheFallbackTimeout !== undefined || failed) return;
          cacheFallbackTimeout = window.setTimeout(
            () => failClosed(new WorkspaceSessionTimeoutError()),
            3_000,
          );
        };

        const subscribe = (
          reference: DocumentReference<DocumentData>,
          accept: (value: unknown | null) => void,
        ) => {
          const unsubscribe = onSnapshot(
            reference,
            { includeMetadataChanges: true },
            (nextDocument) => {
              if (nextDocument.metadata.fromCache) {
                noteCacheFallback();
                return;
              }
              acceptServerEvidence();
              accept(nextDocument.exists() ? nextDocument.data() : null);
              applyVerifiedSession();
            },
            failClosed,
          );
          subscriptions.push(unsubscribe);
        };

        subscribe(workspaceRef, (value) => {
          workspaceData = value;
        });
        subscribe(membershipRef, (value) => {
          membershipData = value;
        });
        applyVerifiedSession();

        heartbeat = window.setInterval(() => {
          void withTimeout(
            Promise.all([
              getDocFromServer(workspaceRef),
              getDocFromServer(membershipRef),
            ]),
            5_000,
          )
            .then(([nextWorkspace, nextMembership]) => {
              if (!active || failed) return;
              workspaceData = dataOrNull(nextWorkspace);
              membershipData = dataOrNull(nextMembership);
              acceptServerEvidence();
              applyVerifiedSession();
            })
            .catch(failClosed);
        }, 10_000);
      } catch (error) {
        failClosed(error);
      }
    })();

    return () => {
      active = false;
      for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
      if (heartbeat !== undefined) window.clearInterval(heartbeat);
      if (cacheFallbackTimeout !== undefined) window.clearTimeout(cacheFallbackTimeout);
    };
  }, [authStatus, authUser, signOut]);

  return (
    <WorkspaceSessionContext.Provider value={snapshot}>
      {children}
    </WorkspaceSessionContext.Provider>
  );
}

export function useWorkspaceSession(): WorkspaceSessionSnapshot {
  const context = useContext(WorkspaceSessionContext);
  if (!context) {
    throw new Error("useWorkspaceSession must be used inside WorkspaceSessionProvider.");
  }
  return context;
}
