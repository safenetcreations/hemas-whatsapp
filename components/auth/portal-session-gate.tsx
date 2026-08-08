"use client";

import { AlertTriangle, LoaderCircle, LogOut, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAuthSession } from "./auth-session";
import { combinedPortalDecision } from "./session-model";
import { useWorkspaceSession } from "./workspace-session";

function SafeSessionScreen({
  unavailable,
  checkingWorkspace,
}: {
  unavailable: boolean;
  checkingWorkspace: boolean;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#eff6f3] px-4 py-12">
      <section
        className="w-full max-w-md rounded-3xl border border-[var(--line)] bg-white p-7 text-center shadow-[0_20px_70px_rgba(7,94,84,0.12)]"
        aria-live="polite"
        aria-busy={!unavailable}
      >
        <span
          className={`mx-auto grid h-12 w-12 place-items-center rounded-2xl ${
            unavailable ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700"
          }`}
        >
          {unavailable ? (
            <AlertTriangle size={24} aria-hidden="true" />
          ) : (
            <LoaderCircle size={24} className="animate-spin" aria-hidden="true" />
          )}
        </span>
        <h1 className="mt-4 text-xl font-bold tracking-[-0.03em] text-slate-950">
          {unavailable
            ? "Local session unavailable"
            : checkingWorkspace
              ? "Checking workspace access"
              : "Checking synthetic session"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {unavailable
            ? "Portal content remains locked. Returning to local demo access without contacting a cloud project."
            : checkingWorkspace
              ? "Portal content stays hidden until Firestore verifies the active synthetic workspace, membership, role, and scope."
              : "Portal content stays hidden until the Firebase Auth emulator verifies this browser session."}
        </p>
      </section>
    </main>
  );
}

export function SignOutControl() {
  const router = useRouter();
  const { signOut } = useAuthSession();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(false);

  async function handleSignOut() {
    setWorking(true);
    setError(false);
    try {
      await signOut();
      router.replace("/login?signedOut=1");
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
          Local sign-out could not finish. Portal access has been locked.
        </p>
      ) : null}
      <button
        type="button"
        onClick={handleSignOut}
        disabled={working}
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-70"
      >
        {working ? (
          <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
        ) : (
          <LogOut size={15} aria-hidden="true" />
        )}
        {working ? "Signing out…" : "Sign out of demo"}
      </button>
    </div>
  );
}

export function PortalSessionGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const authSession = useAuthSession();
  const workspaceSession = useWorkspaceSession();
  const decision = combinedPortalDecision(authSession.status, workspaceSession.status);

  useEffect(() => {
    if (decision.action === "redirect") {
      router.replace(`/login?reason=${decision.reason}`);
    }
  }, [decision, router]);

  if (decision.action !== "allow") {
    return (
      <SafeSessionScreen
        unavailable={
          authSession.status === "unavailable" ||
          workspaceSession.status === "unavailable" ||
          workspaceSession.status === "denied"
        }
        checkingWorkspace={
          authSession.status === "authenticated" && workspaceSession.status === "checking"
        }
      />
    );
  }

  return (
    <>
      <div className="sr-only" role="status">
        <ShieldCheck aria-hidden="true" /> Synthetic identity and workspace access verified.
      </div>
      {children}
    </>
  );
}
