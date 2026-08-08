"use client";

import { ArrowLeft, LifeBuoy, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, type ReactNode } from "react";
import { isSafeDemo } from "@/lib/config/public-env";
import type { VerifiedWorkspaceSession } from "@/lib/firebase/workspace-session-model";
import { portalRouteDecision } from "./portal-route-access";
import { useWorkspaceSession } from "./workspace-session";

function PortalAccessDenied({
  pageLabel,
  unsafeStage,
}: {
  pageLabel: string | null;
  unsafeStage: boolean;
}) {
  return (
    <section
      className="grid min-h-[58vh] place-items-center py-8"
      role="alert"
      aria-labelledby="portal-access-denied-title"
      data-portal-access="denied"
    >
      <div className="w-full max-w-xl rounded-3xl border border-amber-200 bg-white p-6 text-center shadow-[0_18px_60px_rgba(15,23,42,0.08)] sm:p-8">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-amber-100 text-amber-800">
          <ShieldAlert size={24} aria-hidden="true" />
        </span>
        <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-700">
          Access denied
        </p>
        <h1
          id="portal-access-denied-title"
          className="mt-1 text-2xl font-bold tracking-[-0.035em] text-slate-950"
          tabIndex={-1}
        >
          This page is not available for your session
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-600">
          {unsafeStage
            ? "Demo Lab stays locked outside the explicitly safe synthetic demo stage."
            : pageLabel
              ? `Your verified workspace role does not permit access to ${pageLabel}. No feature data was rendered or read.`
              : "This route has no approved portal access policy. No feature data was rendered or read."}
        </p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 text-sm font-semibold text-white hover:bg-[var(--brand-strong)]"
          >
            <ArrowLeft size={15} aria-hidden="true" />
            Return to overview
          </Link>
          <Link
            href="/help"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <LifeBuoy size={15} aria-hidden="true" />
            Help &amp; escalation
          </Link>
        </div>
      </div>
    </section>
  );
}

export function portalAuthorityRenderKey(
  pathname: string,
  session: VerifiedWorkspaceSession,
): string {
  return [
    pathname,
    session.workspaceId,
    session.uid,
    session.role,
    session.scopeMode,
    session.workspaceMode,
    session.dataClassification,
    session.teamIds.join("\u001f"),
    session.locationIds.join("\u001f"),
  ].join("\u001e");
}

export function PortalPermissionGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const workspace = useWorkspaceSession();

  // PortalSessionGate owns the checking/revoked/unavailable presentation. This
  // second fail-closed check ensures no prior feature subtree survives a session
  // transition even if this component is ever rendered independently.
  if (workspace.status !== "verified" || !workspace.session) {
    return null;
  }

  const decision = portalRouteDecision({
    pathname,
    session: workspace.session,
    syntheticStage: isSafeDemo,
  });

  if (!decision.allowed) {
    return (
      <PortalAccessDenied
        pageLabel={decision.policy?.label ?? null}
        unsafeStage={decision.reason === "unsafe_stage"}
      />
    );
  }

  const authorityRenderKey = portalAuthorityRenderKey(pathname, workspace.session);

  return <Fragment key={authorityRenderKey}>{children}</Fragment>;
}
