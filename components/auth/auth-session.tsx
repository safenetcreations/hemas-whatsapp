"use client";

import {
  browserSessionPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  describeLocalAuthError,
  getLocalEmulatorAuth,
  LocalAuthBoundaryError,
  verifySyntheticEmulatorUser,
} from "@/lib/firebase/auth-emulator";
import type { AuthSessionStatus } from "./session-model";

type AuthSessionSnapshot = {
  status: AuthSessionStatus;
  user: User | null;
  message: string | null;
};

type AuthSessionContextValue = AuthSessionSnapshot & {
  signIn(email: string, password: string): Promise<User>;
  signOut(): Promise<void>;
};

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

const initialSnapshot: AuthSessionSnapshot = {
  status: "checking",
  user: null,
  message: null,
};

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<AuthSessionSnapshot>(initialSnapshot);

  useEffect(() => {
    let active = true;
    let revision = 0;
    let unsubscribe: (() => void) | undefined;

    try {
      const auth = getLocalEmulatorAuth();
      unsubscribe = onAuthStateChanged(
        auth,
        (user) => {
          const currentRevision = ++revision;
          if (!user) {
            setSnapshot({ status: "unauthenticated", user: null, message: null });
            return;
          }

          setSnapshot({ status: "checking", user: null, message: null });
          void verifySyntheticEmulatorUser(user)
            .then(() => {
              if (active && currentRevision === revision) {
                setSnapshot({ status: "authenticated", user, message: null });
              }
            })
            .catch(async (error: unknown) => {
              try {
                await firebaseSignOut(auth);
              } catch {
                // The state below remains fail closed even if local cleanup fails.
              }
              if (active && currentRevision === revision) {
                const unavailable =
                  error instanceof LocalAuthBoundaryError &&
                  error.reason === "emulator_unavailable";
                setSnapshot({
                  status: unavailable ? "unavailable" : "unauthenticated",
                  user: null,
                  message: describeLocalAuthError(error),
                });
              }
            });
        },
        (error) => {
          if (active) {
            setSnapshot({
              status: "unavailable",
              user: null,
              message: describeLocalAuthError(error),
            });
          }
        },
      );
    } catch (error) {
      queueMicrotask(() => {
        if (active) {
          setSnapshot({
            status: "unavailable",
            user: null,
            message: describeLocalAuthError(error),
          });
        }
      });
    }

    return () => {
      active = false;
      revision += 1;
      unsubscribe?.();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setSnapshot({ status: "checking", user: null, message: null });
    try {
      const auth = getLocalEmulatorAuth();
      await setPersistence(auth, browserSessionPersistence);
      const credential = await signInWithEmailAndPassword(auth, email, password);
      await verifySyntheticEmulatorUser(credential.user);
      setSnapshot({
        status: "authenticated",
        user: credential.user,
        message: null,
      });
      return credential.user;
    } catch (error) {
      try {
        await firebaseSignOut(getLocalEmulatorAuth());
      } catch {
        // The rejected state remains fail closed if local cleanup is unavailable.
      }
      const unavailable =
        error instanceof LocalAuthBoundaryError &&
        error.reason !== "identity";
      setSnapshot({
        status: unavailable ? "unavailable" : "unauthenticated",
        user: null,
        message: describeLocalAuthError(error),
      });
      throw error;
    }
  }, []);

  const signOut = useCallback(async () => {
    setSnapshot({ status: "checking", user: null, message: null });
    try {
      await firebaseSignOut(getLocalEmulatorAuth());
      setSnapshot({ status: "unauthenticated", user: null, message: null });
    } catch (error) {
      setSnapshot({
        status: "unavailable",
        user: null,
        message: describeLocalAuthError(error),
      });
      throw error;
    }
  }, []);

  const value = useMemo<AuthSessionContextValue>(
    () => ({ ...snapshot, signIn, signOut }),
    [signIn, signOut, snapshot],
  );

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

export function useAuthSession(): AuthSessionContextValue {
  const context = useContext(AuthSessionContext);
  if (!context) {
    throw new Error("useAuthSession must be used inside AuthSessionProvider.");
  }
  return context;
}
