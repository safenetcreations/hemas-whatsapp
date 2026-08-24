"use client";

import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Building2,
  CalendarDays,
  ContactRound,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  MessageSquareText,
  Settings2,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  X,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { LITE_BRAND } from "./lite-config";
import { useLiteAuth } from "./lite-auth";
import { liteSignInErrorMessage } from "./lite-login-model";
import {
  LITE_BUTTON_PRIMARY,
  LITE_FIELD,
  LiteNotice,
  LiteStatus,
  liteCx,
} from "./lite-ui";

type NavItem = { readonly href: string; readonly label: string; readonly icon: LucideIcon };
type NavGroup = { readonly label: string; readonly items: readonly NavItem[] };

const NAVIGATION: readonly NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { href: "/lite", label: "Overview", icon: LayoutDashboard },
      { href: "/lite/inbox", label: "Inbox", icon: MessageSquareText },
      { href: "/lite/appointments", label: "Appointments", icon: CalendarDays },
    ],
  },
  {
    label: "Care operations",
    items: [
      { href: "/lite/doctors", label: "Doctor directory", icon: Stethoscope },
      { href: "/lite/campaigns", label: "Campaigns", icon: Sparkles },
      { href: "/lite/contacts", label: "Contacts & CRM", icon: ContactRound },
    ],
  },
  {
    label: "Management",
    items: [
      { href: "/lite/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/lite/settings", label: "Plan & seats", icon: Settings2 },
    ],
  },
] as const;

function routeIsActive(pathname: string, href: string): boolean {
  return href === "/lite" ? pathname === "/lite" : pathname.startsWith(href);
}

function initials(label: string): string {
  const parts = label
    .replace(/[^A-Za-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return `${parts[0]?.[0] ?? "H"}${parts[1]?.[0] ?? "C"}`.toUpperCase();
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/lite"
      className="flex min-w-0 items-center gap-3 rounded-xl"
      aria-label="Hemas Connect Lite overview"
    >
      <span
        className={liteCx(
          "lite-logo-glow grid shrink-0 place-items-center rounded-xl bg-white",
          compact ? "h-10 w-[92px] px-2 sm:h-11 sm:w-[102px]" : "h-[68px] w-[154px] px-3",
        )}
      >
        <Image
          src="/hemas-logo.png"
          alt="Hemas Hospitals"
          width={150}
          height={76}
          priority
          className="h-auto w-full object-contain"
        />
      </span>
      {compact ? (
        <span className="hidden min-w-0 min-[390px]:block">
          <span className="font-display block truncate text-sm font-bold text-[var(--lite-ink)]">
            Hemas Connect
          </span>
          <span className="block truncate text-[11px] text-[var(--lite-muted)]">Lite workspace</span>
        </span>
      ) : null}
    </Link>
  );
}

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
    <main className="lite-canvas grid min-h-screen lg:grid-cols-[minmax(0,0.92fr)_minmax(520px,1.08fr)]">
      <section className="lite-sidebar-surface relative hidden min-h-screen overflow-hidden px-10 py-12 text-white lg:flex lg:flex-col xl:px-16">
        <div className="relative z-10">
          <Brand />
          <p className="mt-8 text-xs font-bold uppercase tracking-[0.18em] text-cyan-100/80">
            Patient engagement workspace
          </p>
          <h1 className="font-display mt-4 max-w-xl text-4xl font-bold leading-[1.12] tracking-[-0.035em] xl:text-5xl">
            Connected care, with every conversation governed.
          </h1>
          <p className="mt-5 max-w-lg text-[15px] leading-7 text-cyan-50/75">
            A secure management workspace for WhatsApp conversations, appointment requests,
            campaigns, contacts, and delivery evidence.
          </p>
        </div>

        <div className="relative z-10 mt-auto grid gap-3 pt-12">
          {[
            [ShieldCheck, "Allowlisted management demo"],
            [LockKeyhole, "Synthetic records only"],
            [Activity, "Content-free delivery evidence"],
          ].map(([Icon, label]) => {
            const FeatureIcon = Icon as LucideIcon;
            return (
              <div
                key={label as string}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.055] px-4 py-3 text-sm text-cyan-50/90 backdrop-blur"
              >
                <FeatureIcon size={18} className="text-cyan-200" aria-hidden="true" />
                {label as string}
              </div>
            );
          })}
        </div>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8 lg:px-12">
        <div className="w-full max-w-[460px]">
          <div className="mb-7 lg:hidden">
            <Brand compact />
          </div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--lite-brand)]">
            Private access
          </p>
          <h2 className="font-display mt-2 text-3xl font-bold tracking-[-0.035em] text-[var(--lite-ink)]">
            Sign in to Hemas Connect
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--lite-muted)]">
            Use the seat details issued by the demo owner. Access and actions remain role-gated.
          </p>

          <form
            onSubmit={submit}
            noValidate
            className="mt-7 rounded-2xl border border-[var(--lite-line)] bg-white p-5 shadow-[0_24px_70px_rgba(18,56,67,0.1)] sm:p-7"
          >
            <label className="block text-sm font-semibold text-[var(--lite-ink-secondary)]">
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
                className={`${LITE_FIELD} mt-2`}
                placeholder="Enter your issued seat email"
              />
            </label>
            <label className="mt-5 block text-sm font-semibold text-[var(--lite-ink-secondary)]">
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
                className={`${LITE_FIELD} mt-2`}
                placeholder="Enter your password"
              />
            </label>

            <button
              type="submit"
              disabled={pending || status === "checking" || !email.trim() || !password}
              className={`${LITE_BUTTON_PRIMARY} mt-6 w-full`}
            >
              <LockKeyhole size={17} aria-hidden="true" />
              {pending ? "Signing in…" : "Sign in securely"}
            </button>

            {(message ?? authMessage) ? (
              <div className="mt-4" role="alert" aria-live="polite">
                <LiteNotice tone="danger">{message ?? authMessage}</LiteNotice>
              </div>
            ) : null}

            <div className="mt-5 flex items-start gap-3 border-t border-[var(--lite-line)] pt-5">
              <ShieldCheck
                size={18}
                className="mt-0.5 shrink-0 text-[var(--lite-brand)]"
                aria-hidden="true"
              />
              <p className="text-xs leading-5 text-[var(--lite-muted)]">
                Provisioned demo seats only. Passwords are never displayed or reset by this
                portal.
              </p>
            </div>
          </form>

          <p className="mt-5 text-center text-xs leading-5 text-slate-400">
            {LITE_BRAND.demoNote}
          </p>
        </div>
      </section>
    </main>
  );
}

function LiteSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user, member, signOut } = useLiteAuth();
  const displayLabel = member?.displayLabel ?? "Provisioned Lite seat";

  return (
    <div className="lite-sidebar-surface relative flex h-full flex-col overflow-hidden text-white">
      <div className="relative z-10 border-b border-white/10 px-5 py-5">
        <Brand />
        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="font-display text-base font-bold tracking-[-0.02em]">Hemas Connect Lite</span>
          <LiteStatus tone="brand">Governed</LiteStatus>
        </div>
        <p className="mt-1 text-xs text-cyan-100/65">Patient engagement workspace</p>
      </div>

      <nav
        className="scrollbar-subtle relative z-10 flex-1 overflow-y-auto px-3 py-5"
        aria-label="Lite workspace navigation"
      >
        {NAVIGATION.map((group) => (
          <div className="mb-6" key={group.label}>
            <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100/45">
              {group.label}
            </p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const active = routeIsActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={liteCx(
                      "group flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
                      active
                        ? "bg-white text-[var(--lite-brand-strong)] shadow-[0_8px_22px_rgba(0,26,34,0.18)]"
                        : "text-cyan-50/72 hover:bg-white/10 hover:text-white",
                    )}
                  >
                    <Icon size={18} strokeWidth={active ? 2.35 : 1.9} aria-hidden="true" />
                    <span className="flex-1">{item.label}</span>
                    {active ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--lite-accent)]" aria-hidden="true" />
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="relative z-10 border-t border-white/10 p-3">
        <Link
          href="/"
          className="mb-2 flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-cyan-50/72 transition hover:bg-white/10 hover:text-white"
        >
          <Building2 size={18} aria-hidden="true" />
          Enterprise workspace
          <ArrowUpRight size={15} className="ml-auto" aria-hidden="true" />
        </Link>
        <div className="rounded-2xl border border-white/10 bg-white/[0.07] p-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-xs font-bold text-[var(--lite-brand-strong)]">
              {initials(displayLabel)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-bold text-white">{displayLabel}</span>
              <span className="block truncate text-[11px] capitalize text-cyan-100/58">
                {member?.role?.replace("_", " ") ?? (user ? "Awaiting seat" : "Signed out")}
              </span>
            </span>
            <ShieldCheck size={16} className="text-emerald-300" aria-hidden="true" />
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 text-xs font-semibold text-cyan-50/72 transition hover:border-rose-200/30 hover:bg-rose-500/10 hover:text-white"
          >
            <LogOut size={15} aria-hidden="true" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

export function LiteShell({ children }: { children: ReactNode }) {
  const { status, message } = useLiteAuth();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const currentItem = NAVIGATION.flatMap((group) => group.items).find((item) =>
    routeIsActive(pathname, item.href),
  );

  useEffect(() => {
    if (!mobileOpen) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : menuButtonRef.current;
    const content = contentRef.current;
    content?.setAttribute("inert", "");
    document.body.style.overflow = "hidden";

    const focusableSelector =
      'a[href], button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusFirst = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = [...dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)];
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFirst);
      document.removeEventListener("keydown", handleKeyDown);
      content?.removeAttribute("inert");
      document.body.style.overflow = "";
      previouslyFocused?.focus();
    };
  }, [mobileOpen]);

  if (status === "checking") {
    return (
      <main className="lite-canvas grid min-h-screen place-items-center px-6" aria-busy="true">
        <div className="text-center">
          <Image
            src="/hemas-logo.png"
            alt="Hemas Hospitals"
            width={150}
            height={76}
            priority
            className="mx-auto h-auto w-36 object-contain"
          />
          <span className="mx-auto mt-6 block h-1.5 w-36 overflow-hidden rounded-full bg-[var(--lite-line)]">
            <span className="block h-full w-1/2 animate-pulse rounded-full bg-[var(--lite-brand)]" />
          </span>
          <p className="mt-3 text-sm font-medium text-[var(--lite-muted)]">Starting Hemas Connect…</p>
        </div>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="lite-canvas grid min-h-screen place-items-center px-6">
        <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-6 text-center shadow-xl">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-amber-50 text-amber-700">
            <ShieldCheck size={22} aria-hidden="true" />
          </span>
          <h1 className="font-display mt-4 text-xl font-bold text-[var(--lite-ink)]">
            Lite cannot start here
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--lite-muted)]">{message}</p>
        </div>
      </main>
    );
  }

  if (status === "signed_out" || status === "blocked") {
    return <LiteLogin />;
  }

  return (
    <div
      className="lite-canvas min-h-screen text-[var(--lite-ink)]"
      data-ui-revision={process.env.NEXT_PUBLIC_UI_REVISION ?? "local"}
    >
      <a
        href="#lite-main-content"
        className="fixed left-4 top-2 z-[70] -translate-y-20 rounded-lg bg-white px-4 py-2 text-sm font-bold text-[var(--lite-brand-strong)] shadow-lg transition focus:translate-y-0"
      >
        Skip to content
      </a>

      <div className="fixed inset-x-0 top-0 z-50 flex h-8 items-center justify-center gap-2 bg-[#fff2e8] px-3 text-center text-[10px] font-bold tracking-[0.02em] text-[#86501d] sm:text-[11px]">
        <ShieldCheck size={12} aria-hidden="true" />
        <span className="truncate sm:whitespace-normal">
          GOVERNED DEMO · ALLOWLISTED CANARY · SYNTHETIC RECORDS ONLY
        </span>
      </div>

      <aside className="fixed bottom-0 left-0 top-8 z-40 hidden w-[264px] lg:block">
        <LiteSidebar />
      </aside>

      {mobileOpen ? (
        <div
          ref={dialogRef}
          id="lite-navigation-dialog"
          className="fixed inset-0 top-8 z-[60] lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Lite navigation"
        >
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
            tabIndex={-1}
          />
          <aside className="absolute bottom-0 left-0 top-0 w-[min(88vw,330px)] shadow-2xl">
            <button
              ref={closeButtonRef}
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-3 z-20 grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-white/10 text-white hover:bg-white/15"
              aria-label="Close navigation"
            >
              <X size={19} aria-hidden="true" />
            </button>
            <LiteSidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div ref={contentRef} className="pt-8 lg:pl-[264px]">
        <header className="sticky top-8 z-30 flex h-16 items-center gap-3 border-b border-[var(--lite-line)] bg-white/90 px-4 backdrop-blur-xl sm:px-6 lg:h-[72px] lg:px-8">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMobileOpen(true)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[var(--lite-line)] bg-white text-[var(--lite-ink-secondary)] shadow-sm hover:bg-[var(--lite-brand-soft)] lg:hidden"
            aria-label="Open navigation"
            aria-controls="lite-navigation-dialog"
            aria-expanded={mobileOpen}
          >
            <Menu size={20} aria-hidden="true" />
          </button>

          <div className="min-w-0 flex-1 lg:hidden">
            <Brand compact />
          </div>

          <div className="hidden min-w-0 flex-1 lg:block">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--lite-brand)]">
              Hemas Connect Lite
            </p>
            <p className="font-display truncate text-base font-bold text-[var(--lite-ink)]">
              {currentItem?.label ?? "Workspace"}
            </p>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <span className="hidden sm:inline-flex">
              <LiteStatus tone="brand">Governed canary</LiteStatus>
            </span>
            <Link
              href="/"
              className="hidden min-h-11 items-center gap-2 rounded-xl border border-[var(--lite-line)] bg-white px-3 text-xs font-semibold text-[var(--lite-ink-secondary)] transition hover:border-[var(--lite-brand)]/35 hover:text-[var(--lite-brand-strong)] sm:inline-flex lg:hidden xl:inline-flex"
            >
              Enterprise
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </header>

        <main
          id="lite-main-content"
          className="lite-main-scroll mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8"
        >
          {children}
        </main>

        <footer className="mx-auto w-full max-w-[1600px] px-4 pb-7 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-1 border-t border-[var(--lite-line)] pt-5 text-xs text-[var(--lite-muted)] sm:flex-row sm:items-center sm:justify-between">
            <p>{LITE_BRAND.demoNote}</p>
            <p>Hemas Hospitals · By your side</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
