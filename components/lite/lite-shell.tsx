"use client";

/**
 * Hemas Lite — shell: brand bar, tab navigation, login screen.
 * Deliberately lighter than the enterprise portal: this is the simple,
 * cheap-plan product face of the same governed engine.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { LITE_BRAND, LITE_SEAT_HINTS } from "./lite-config";
import { useLiteAuth } from "./lite-auth";

const NAV = [
  { href: "/lite", label: "Dashboard" },
  { href: "/lite/inbox", label: "Inbox" },
  { href: "/lite/appointments", label: "Appointments" },
  { href: "/lite/doctors", label: "Doctors" },
  { href: "/lite/campaigns", label: "Campaigns" },
  { href: "/lite/analytics", label: "Analytics" },
  { href: "/lite/contacts", label: "Contacts" },
  { href: "/lite/settings", label: "Plan & seats" },
] as const;

function LiteLogin() {
  const { signIn, message: authMessage, status } = useLiteAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      await signIn(email, password);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Sign-in failed. Check the seat details.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-[#f2f8f4] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-xl font-bold text-white shadow-lg shadow-emerald-600/25">
            HL
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">{LITE_BRAND.name}</h1>
          <p className="mt-1 text-sm text-slate-500">{LITE_BRAND.tagline}</p>
        </div>

        <form
          onSubmit={submit}
          className="rounded-3xl border border-emerald-100 bg-white p-6 shadow-xl shadow-emerald-900/5"
        >
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Seat email
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              autoComplete="username"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-500"
              placeholder="agent1@lite.synthetic.invalid"
            />
          </label>
          <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Password
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-500"
              placeholder="••••••••••••"
            />
          </label>

          <button
            type="submit"
            disabled={pending || status === "checking"}
            className="mt-5 w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending ? "Signing in…" : "Sign in to Lite"}
          </button>

          {(message ?? authMessage) ? (
            <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {message ?? authMessage}
            </p>
          ) : null}

          <div className="mt-5 border-t border-slate-100 pt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Demo seats — tap to fill
            </p>
            <div className="flex flex-wrap gap-2">
              {LITE_SEAT_HINTS.map((seat) => (
                <button
                  key={seat.email}
                  type="button"
                  onClick={() => {
                    setEmail(seat.email);
                    setPassword(seat.password);
                  }}
                  className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 transition hover:bg-emerald-100"
                >
                  {seat.label}
                </button>
              ))}
            </div>
          </div>
        </form>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-400">
          {LITE_BRAND.demoNote}
        </p>
      </div>
    </main>
  );
}

export function LiteShell({ children }: { children: ReactNode }) {
  const { status, user, member, message, signOut } = useLiteAuth();
  const pathname = usePathname();

  if (status === "checking") {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f2f8f4]">
        <p className="text-sm text-slate-500">Starting Hemas Lite…</p>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f2f8f4] px-6">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <p className="font-semibold">Lite cannot start here</p>
          <p className="mt-1 text-xs leading-relaxed">{message}</p>
        </div>
      </main>
    );
  }

  if (status === "signed_out" || status === "blocked") {
    return <LiteLogin />;
  }

  return (
    <div className="min-h-screen bg-[#f2f8f4]">
      <header className="sticky top-0 z-20 border-b border-emerald-900/5 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link href="/lite" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-sm font-bold text-white">
              HL
            </span>
            <span>
              <span className="block text-sm font-semibold leading-tight text-slate-900">
                {LITE_BRAND.name}
              </span>
              <span className="block text-[10px] leading-tight text-slate-400">
                synthetic demo
              </span>
            </span>
          </Link>

          <nav className="ml-4 hidden items-center gap-1 sm:flex">
            {NAV.map((item) => {
              const active =
                item.href === "/lite" ? pathname === "/lite" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                    active
                      ? "bg-emerald-600 text-white"
                      : "text-slate-600 hover:bg-emerald-50 hover:text-emerald-800"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-right sm:block">
              <span className="block text-xs font-semibold text-slate-800">
                {member?.displayLabel ?? user?.email ?? "Seat"}
              </span>
              <span className="block text-[10px] uppercase tracking-wide text-emerald-700">
                {member?.role ?? "no seat yet"}
              </span>
            </span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-rose-200 hover:text-rose-600"
            >
              Sign out
            </button>
          </div>
        </div>
        <nav className="flex items-center gap-1 overflow-x-auto px-4 pb-2 sm:hidden">
          {NAV.map((item) => {
            const active =
              item.href === "/lite" ? pathname === "/lite" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ${
                  active ? "bg-emerald-600 text-white" : "text-slate-600"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>

      <footer className="mx-auto max-w-6xl px-4 pb-8 pt-2">
        <p className="text-center text-[11px] text-slate-400">{LITE_BRAND.demoNote}</p>
      </footer>
    </div>
  );
}
