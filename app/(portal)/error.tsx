"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";

export default function PortalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm" role="alert">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-red-50 text-red-700">
        <AlertTriangle size={23} aria-hidden="true" />
      </span>
      <h1 className="mt-4 text-xl font-bold text-slate-950">This workspace view could not load</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        No external message was sent. Retry the governed view; if it fails again, keep the live demo on the last verified screen.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 text-sm font-bold text-white hover:bg-[var(--brand-strong)]"
      >
        <RefreshCw size={16} aria-hidden="true" /> Retry view
      </button>
    </section>
  );
}
