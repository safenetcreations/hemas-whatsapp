import { ArrowLeft, SearchX } from "lucide-react";
import Link from "next/link";

export default function PortalNotFound() {
  return (
    <section className="mx-auto max-w-xl rounded-2xl border border-[var(--line)] bg-white p-6 text-center shadow-sm">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-blue-700">
        <SearchX size={23} aria-hidden="true" />
      </span>
      <h1 className="mt-4 text-xl font-bold text-slate-950">Workspace view not found</h1>
      <p className="mt-2 text-sm text-slate-600">Return to the governed Enterprise overview.</p>
      <Link href="/" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--brand)] px-4 text-sm font-bold text-white">
        <ArrowLeft size={16} aria-hidden="true" /> Back to overview
      </Link>
    </section>
  );
}
