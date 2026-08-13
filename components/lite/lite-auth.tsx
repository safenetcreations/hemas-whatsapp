"use client";

/**
 * Hemas Lite — standalone auth (separate from the enterprise portal gates).
 *
 * Accepts only the synthetic Lite seats (or the demo admin) and resolves the
 * caller's workspace membership document so the UI knows the seat role.
 * Works in both lanes through getFirebaseServices(): local emulators on
 * localhost, the governed cloud demo on the approved hosted domain.
 */

import {
  browserSessionPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { getFirebaseServices } from "@/lib/firebase/client";
import { currentCloudDemoRuntime } from "@/lib/firebase/runtime-mode";
import { LITE_WORKSPACE_ID, isLiteEmail } from "./lite-config";
import { prepareLiteCredentials } from "./lite-login-model";

export type LiteMemberInfo = {
  readonly role: string;
  readonly displayLabel: string;
};

type LiteAuthState = {
  readonly status: "checking" | "signed_out" | "ready" | "blocked" | "error";
  readonly user: User | null;
  readonly member: LiteMemberInfo | null;
  readonly message: string | null;
};

type LiteAuthValue = LiteAuthState & {
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
};

const LiteAuthContext = createContext<LiteAuthValue | null>(null);

async function loadMember(uid: string): Promise<LiteMemberInfo | null> {
  const { db } = getFirebaseServices();
  const snap = await getDoc(
    doc(db, "workspaces", LITE_WORKSPACE_ID, "members", uid),
  );
  const data = snap.data();
  if (!snap.exists() || !data || data.status !== "active") return null;
  return {
    role: typeof data.role === "string" ? data.role : "agent",
    displayLabel:
      typeof data.displayLabel === "string" ? data.displayLabel : "Lite seat",
  };
}

export function LiteAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LiteAuthState>({
    status: "checking",
    user: null,
    member: null,
    message: null,
  });

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    try {
      const { auth } = getFirebaseServices();
      unsubscribe = onAuthStateChanged(auth, (user) => {
        if (!active) return;
        if (!user) {
          setState({ status: "signed_out", user: null, member: null, message: null });
          return;
        }
        const cloudRuntime = currentCloudDemoRuntime();
        if (!cloudRuntime.active && !isLiteEmail(user.email)) {
          setState({
            status: "blocked",
            user,
            member: null,
            message: "This account is not a Lite seat. Sign in with a Lite demo seat.",
          });
          return;
        }
        if (cloudRuntime.active && !user.emailVerified) {
          setState({
            status: "blocked",
            user,
            member: null,
            message: "Cloud demo access requires a verified Firebase identity.",
          });
          return;
        }
        void loadMember(user.uid)
          .then((member) => {
            if (!active) return;
            if (!member) {
              setState({
                status: "blocked",
                user,
                member: null,
                message: "This Lite seat has no active workspace membership.",
              });
              return;
            }
            setState({ status: "ready", user, member, message: null });
          })
          .catch(() => {
            if (!active) return;
            setState({
              status: "error",
              user,
              member: null,
              message: "Lite membership could not be verified. Check your connection and try again.",
            });
          });
      });
    } catch {
      queueMicrotask(() => {
        if (!active) return;
        setState({
          status: "error",
          user: null,
          member: null,
          message: "Lite could not start Firebase services in this environment.",
        });
      });
    }
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const credentials = prepareLiteCredentials(email, password);
    if (!currentCloudDemoRuntime().active && !isLiteEmail(credentials.email)) {
      throw new Error("Use one of the Lite demo seats to sign in.");
    }
    const { auth } = getFirebaseServices();
    await setPersistence(auth, browserSessionPersistence);
    await signInWithEmailAndPassword(auth, credentials.email, credentials.password);
  }, []);

  const signOut = useCallback(async () => {
    const { auth } = getFirebaseServices();
    await firebaseSignOut(auth);
  }, []);

  return (
    <LiteAuthContext.Provider value={{ ...state, signIn, signOut }}>
      {children}
    </LiteAuthContext.Provider>
  );
}

export function useLiteAuth(): LiteAuthValue {
  const value = useContext(LiteAuthContext);
  if (!value) throw new Error("useLiteAuth must be used inside LiteAuthProvider.");
  return value;
}
