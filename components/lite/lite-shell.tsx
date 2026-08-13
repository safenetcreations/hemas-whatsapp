"use client";

/**
 * Hemas Lite — shell: brand bar, tab navigation, login screen.
 * Deliberately lighter than the enterprise portal: this is the simple,
 * cheap-plan product face of the same governed engine.
 */

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { LITE_BRAND } from "./lite-config";
import { useLiteAuth } from "./lite-auth";
import { liteSignInErrorMessage } from "./lite-login-model";

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
      setMessage(liteSignInErrorMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-[#f0f5fc] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <Image
            src="/hemas-logo.png"
            alt="Hemas Hospitals"
            width={120}
            height={60}
            priority
            className="mx-auto mb-3 h-16 w-auto object-contain"
          />
          <h1 className="text-2xl font-semibold text-slate-900">{LITE_BRAND.name}</h1>
          <p className="mt-1 text-sm text-slate-500">{LITE_BRAND.tagline}</p>
        </div>

        <form
          onSubmit={submit}
          noValidate
          className="rounded-3xl border border-blue-100 bg-white p-6 shadow-xl shadow-blue-900/5"
        >
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Seat email
            <input
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setMessage(null);
              }}
              type="email"
              name="email"
              required
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={254}
              disabled={pending}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500"
              placeholder="Enter your issued seat email"
            />
          </label>
          <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Password
            <input
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setMessage(null);
              }}
              type="password"
              name="password"
              required
              autoComplete="current-password"
              disabled={pending}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500"
              placeholder="Enter your password"
            />
          </label>

          <button
            type="submit"
            disabled={pending || status === "checking" || !email.trim() || !password}
            className="mt-5 w-full rounded-xl bg-[#1863DC] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0F56C4] disabled:opacity-50"
          >
            {pending ? "Signing in…" : "Sign in to Lite"}
          </button>

          {(message ?? authMessage) ? (
            <p
              className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700"
              role="alert"
              aria-live="polite"
            >
              {message ?? authMessage}
            </p>
          ) : null}

          <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-3">
            <p className="text-xs font-semibold text-blue-900">Private demo access</p>
            <p className="mt-1 text-[11px] leading-5 text-blue-800">
              Access is restricted to provisioned demo seats. Enter the seat email and password
              supplied by the demo owner. Passwords are never displayed or reset by this app.
            </p>
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
      <main className="grid min-h-screen place-items-center bg-[#f0f5fc]">
        <p className="text-sm text-slate-500">Starting Hemas Lite…</p>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f0f5fc] px-6">
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
    <div className="min-h-screen bg-[#f0f5fc]">
      <header className="sticky top-0 z-20 border-b border-blue-900/5 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link href="/lite" className="flex items-center gap-2.5">
            <Image
              src="/hemas-logo.png"
              alt="Hemas Hospitals"
              width={72}
              height={36}
              className="h-9 w-auto object-contain"
            />
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
                      ? "bg-[#1863DC] text-white"
                      : "text-slate-600 hover:bg-blue-50 hover:text-blue-800"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <Link
              href="/"
              className="hidden rounded-full border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 md:inline-flex"
            >
              Enterprise
            </Link>
            <span className="hidden text-right sm:block">
              <span className="block text-xs font-semibold text-slate-800">
                {member?.displayLabel ?? user?.email ?? "Seat"}
              </span>
              <span className="block text-[10px] uppercase tracking-wide text-blue-700">
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
                  active ? "bg-[#1863DC] text-white" : "text-slate-600"
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
