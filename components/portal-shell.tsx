"use client";

import {
  BarChart3,
  Bot,
  Boxes,
  BriefcaseMedical,
  CircleDollarSign,
  ContactRound,
  FileCheck2,
  FlaskConical,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  Menu,
  MessageSquareText,
  Network,
  Settings,
  ShieldCheck,
  UsersRound,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  visiblePortalRoutePaths,
  type PortalRoutePath,
} from "@/components/auth/portal-route-access";
import { SignOutControl } from "@/components/auth/portal-session-gate";
import { useWorkspaceSession } from "@/components/auth/workspace-session";
import { isSafeDemo, publicStageLabel } from "@/lib/config/public-env";
import {
  initialsForDisplayLabel,
  membershipScopeLabel,
  workspaceInitials,
  workspaceRoleLabel,
} from "@/lib/firebase/workspace-session-model";

type NavItem = { label: string; href: PortalRoutePath; icon: LucideIcon; badge?: string };
type NavGroup = { label: string; items: NavItem[] };

const navigation: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { label: "Overview", href: "/", icon: LayoutDashboard },
      { label: "Inbox", href: "/inbox", icon: Inbox },
      { label: "Contacts", href: "/contacts", icon: ContactRound },
      { label: "Appointments", href: "/appointments", icon: BriefcaseMedical },
      { label: "Lab journeys", href: "/labs", icon: FlaskConical },
    ],
  },
  {
    label: "Engagement",
    items: [
      { label: "Campaigns", href: "/campaigns", icon: MessageSquareText },
      { label: "Templates & Flows", href: "/templates", icon: FileCheck2 },
      { label: "Automations", href: "/automations", icon: Workflow },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { label: "Analytics", href: "/analytics", icon: BarChart3 },
      { label: "AI & Knowledge", href: "/ai-knowledge", icon: Bot },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Connections", href: "/connections", icon: Network },
      { label: "Team & Routing", href: "/team", icon: UsersRound },
      { label: "Compliance", href: "/compliance", icon: ShieldCheck },
      { label: "Usage", href: "/usage", icon: CircleDollarSign },
      { label: "Settings", href: "/settings", icon: Settings },
      { label: "Demo Lab", href: "/demo-lab", icon: Boxes },
    ],
  },
];

function Brand() {
  return (
    <Link href="/" className="flex min-w-0 items-center gap-3 rounded-lg" aria-label="Hemas Connect overview">
      <Image
        src="/hemas-logo.png"
        alt="Hemas Hospitals"
        width={62}
        height={32}
        priority
        className="h-9 w-auto shrink-0 object-contain"
      />
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-bold tracking-[-0.02em] text-slate-950">
          Hemas Connect
        </span>
        <span className="block truncate text-[11px] font-medium text-slate-500">Enterprise · governed demo</span>
      </span>
    </Link>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { session } = useWorkspaceSession();

  if (!session) {
    return null;
  }

  const roleLabel = workspaceRoleLabel(session.role);
  const scopeLabel = membershipScopeLabel(session);
  const visibleRoutes = visiblePortalRoutePaths({
    session,
    syntheticStage: isSafeDemo,
  });
  const visibleNavigation = navigation
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => visibleRoutes.has(item.href)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-[72px] items-center border-b border-[var(--line)] px-4 lg:px-5">
        <Brand />
      </div>

      <div className="border-b border-[var(--line)] p-3">
        <div
          className="flex w-full items-center gap-3 rounded-xl border border-[var(--line)] bg-slate-50 px-3 py-2.5 text-left transition hover:bg-slate-100"
          aria-label={`Verified workspace: ${session.workspaceName}`}
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-100 text-xs font-bold text-blue-800">
            {workspaceInitials(session.workspaceName)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-slate-900">{session.workspaceName}</span>
            <span className="block truncate text-[11px] text-slate-500">Verified synthetic workspace</span>
          </span>
          <ShieldCheck size={15} className="text-emerald-700" aria-hidden="true" />
        </div>
      </div>

      <nav className="scrollbar-subtle flex-1 overflow-y-auto px-3 py-4" aria-label="Primary navigation">
        {visibleNavigation.map((group) => (
          <div className="mb-5" key={group.label}>
            <p className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    href={item.href}
                    key={item.href}
                    onClick={onNavigate}
                    className={`flex min-h-10 items-center gap-3 rounded-xl px-2.5 py-2 text-[13px] font-medium transition ${
                      active
                        ? "bg-[var(--brand-soft)] text-[var(--brand-strong)]"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                    }`}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon size={17} strokeWidth={active ? 2.35 : 1.9} aria-hidden="true" />
                    <span className="flex-1">{item.label}</span>
                    {item.badge ? (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${active ? "bg-white text-[var(--brand)]" : "bg-slate-100 text-slate-600"}`}>
                        {item.badge}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-[var(--line)] p-3">
        {visibleRoutes.has("/help") ? (
          <Link href="/help" className="flex items-center gap-3 rounded-xl px-2.5 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-950">
            <LifeBuoy size={17} aria-hidden="true" />
            Help & escalation
          </Link>
        ) : null}
        <div className="mt-2 flex items-center gap-3 rounded-xl bg-slate-50 px-2.5 py-2.5" aria-label={`Signed in as ${session.displayLabel}, ${roleLabel}. ${scopeLabel}`}>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-800 text-[11px] font-bold text-white">{initialsForDisplayLabel(session.displayLabel)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-slate-900">{session.displayLabel}</span>
            <span className="block truncate text-[10px] text-slate-500" title={`${roleLabel} · ${scopeLabel}`}>{roleLabel} · {scopeLabel}</span>
          </span>
          <ShieldCheck size={14} className="text-emerald-700" aria-hidden="true" />
        </div>
        <SignOutControl />
      </div>
    </div>
  );
}

export function PortalShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const currentLabel =
    navigation.flatMap((group) => group.items).find((item) =>
      item.href === "/" ? pathname === "/" : pathname.startsWith(item.href),
    )?.label ?? "Enterprise workspace";

  useEffect(() => {
    if (!mobileOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : menuButtonRef.current;
    const content = contentRef.current;
    content?.setAttribute("inert", "");
    document.body.style.overflow = "hidden";

    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusFirst = window.requestAnimationFrame(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>(focusableSelector);
      first?.focus();
    });
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

  return (
    <div className="min-h-screen bg-[var(--canvas)]">
      <div className="fixed inset-x-0 top-0 z-50 flex h-8 items-center justify-center gap-2 bg-[#fff3d9] px-3 text-center text-[10px] font-semibold text-[#75521a] sm:text-[11px]">
        <FlaskConical size={12} aria-hidden="true" />
        <span>{publicStageLabel} · GOVERNED MANAGEMENT DEMO · ALLOWLISTED CANARY ONLY · REAL PATIENT DATA OFF · CLINICAL ADVICE OFF</span>
      </div>

      <aside className="fixed bottom-0 left-0 top-8 z-40 hidden w-[252px] border-r border-[var(--line)] lg:block">
        <Sidebar />
      </aside>

      {mobileOpen ? (
        <div
          ref={dialogRef}
          id="portal-navigation-dialog"
          className="fixed inset-0 top-8 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <button className="absolute inset-0 bg-slate-950/35 backdrop-blur-[1px]" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />
          <aside className="absolute bottom-0 left-0 top-0 w-[min(88vw,320px)] border-r border-[var(--line)] shadow-2xl">
            <button type="button" onClick={() => setMobileOpen(false)} className="absolute right-3 top-3 z-10 grid h-11 w-11 place-items-center rounded-xl text-slate-600 hover:bg-slate-100" aria-label="Close navigation">
              <X size={19} aria-hidden="true" />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div ref={contentRef} className="pt-8 lg:pl-[252px]">
        <header className="sticky top-8 z-30 flex h-16 items-center gap-3 border-b border-[var(--line)] bg-white/95 px-4 backdrop-blur sm:px-6 lg:h-[72px] lg:px-8">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMobileOpen(true)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[var(--line)] text-slate-700 hover:bg-slate-50 lg:hidden"
            aria-label="Open navigation"
            aria-controls="portal-navigation-dialog"
            aria-expanded={mobileOpen}
          >
            <Menu size={20} aria-hidden="true" />
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold uppercase tracking-[0.08em] text-blue-700">
              Hemas Connect Enterprise
            </p>
            <p className="truncate text-sm font-semibold text-slate-800">{currentLabel}</p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-[11px] font-bold text-blue-800 sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
              Governed demo
            </span>
            <Link
              href="/lite"
              className="inline-flex h-10 items-center rounded-xl border border-blue-200 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-50"
            >
              Open Lite
            </Link>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
