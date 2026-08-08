"use client";

import {
  AlertCircle,
  DatabaseZap,
  Eye,
  EyeOff,
  HeartPulse,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  syntheticDemoEmail,
  syntheticDemoPassword,
} from "@/lib/firebase/auth-policy";
import { describeLocalAuthError } from "@/lib/firebase/auth-emulator";
import { useAuthSession } from "./auth-session";

export function LoginCard() {
  const router = useRouter();
  const { status, message: sessionMessage, signIn } = useAuthSession();
  const [email, setEmail] = useState(syntheticDemoEmail);
  const [password, setPassword] = useState(syntheticDemoPassword);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/");
      router.refresh();
    }
  }, [router, status]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email, password);
      router.replace("/");
      router.refresh();
    } catch (caught) {
      setError(describeLocalAuthError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  const checkingExistingSession = status === "checking" && !submitting;
  const unavailable = status === "unavailable";

  return (
    <section className="w-full max-w-md rounded-3xl border border-[var(--line)] bg-white p-6 shadow-[0_20px_70px_rgba(7,94,84,0.12)] sm:p-8">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--brand)] text-white">
          <HeartPulse size={22} aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-bold text-slate-950">Hemas Connect</p>
          <p className="text-[11px] text-slate-500">SafeNet synthetic environment</p>
        </div>
      </div>

      <div className="mt-7">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.06em] text-amber-800">
          <DatabaseZap size={12} aria-hidden="true" /> Emulator only
        </span>
        <h1 className="mt-3 text-2xl font-bold tracking-[-0.035em] text-slate-950">
          Sign in to the local demo
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Firebase Auth first verifies the seeded identity; Firestore then verifies its active synthetic workspace, membership, role, and scope. These public fixture credentials cannot access a cloud project.
        </p>
      </div>

      {checkingExistingSession ? (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-900" role="status">
          <LoaderCircle size={16} className="shrink-0 animate-spin" aria-hidden="true" />
          Checking for a verified local browser session…
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-700">Synthetic email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="username"
              disabled={submitting}
              className="h-11 w-full rounded-xl border border-[var(--line)] bg-slate-50 px-3 text-sm outline-none focus:border-[var(--brand)] focus:bg-white disabled:opacity-70"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-700">Synthetic password</span>
            <span className="relative block">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                autoComplete="current-password"
                disabled={submitting}
                className="h-11 w-full rounded-xl border border-[var(--line)] bg-slate-50 px-3 pr-11 text-sm outline-none focus:border-[var(--brand)] focus:bg-white disabled:opacity-70"
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                disabled={submitting}
                className="absolute right-1 top-1 grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff size={16} aria-hidden="true" />
                ) : (
                  <Eye size={16} aria-hidden="true" />
                )}
              </button>
            </span>
          </label>

          {error || sessionMessage ? (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800" role="alert">
              <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              {error ?? sessionMessage}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={submitting || unavailable}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] text-sm font-semibold text-white hover:bg-[var(--brand-strong)] disabled:cursor-wait disabled:opacity-70"
          >
            {submitting ? (
              <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <LockKeyhole size={16} aria-hidden="true" />
            )}
            {submitting ? "Verifying with local emulator…" : "Sign in to emulator"}
          </button>
        </form>
      )}

      <div className="mt-6 border-t border-[var(--line)] pt-5">
        <div className="flex items-start gap-2 text-[11px] leading-5 text-slate-500">
          <ShieldCheck size={15} className="mt-0.5 shrink-0 text-[var(--brand)]" aria-hidden="true" />
          <p>
            This local flow validates only the seeded identity and synthetic membership. Hemas SSO, MFA, cloud sessions, production roles, and external providers remain unconfigured.
          </p>
        </div>
      </div>
    </section>
  );
}
