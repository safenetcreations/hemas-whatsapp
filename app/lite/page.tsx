"use client";

import Link from "next/link";
import { useLiteAuth } from "@/components/lite/lite-auth";
import { useLiteConversations } from "@/components/lite/lite-data";
import { LITE_SEAT_HINTS } from "@/components/lite/lite-config";

const CAPABILITIES = [
  { label: "AI chatbot · EN / සිංහල / தமிழ்", state: "live" },
  { label: "Appointment booking (real dates & slots)", state: "live" },
  { label: "Live inbox with agent seats", state: "live" },
  { label: "Bulk campaigns", state: "Phase 3" },
  { label: "Live analytics & quotas", state: "Phase 4" },
] as const;

export default function LiteDashboardPage() {
  const { status, user, member } = useLiteAuth();
  const conversations = useLiteConversations(status === "ready");

  const open = conversations.rows.filter((row) => row.status !== "closed");
  const mine = conversations.rows.filter((row) => row.assigneeId === user?.uid);
  const unassigned = conversations.rows.filter(
    (row) => !row.assigneeId && row.mode !== "automation",
  );
  const live = conversations.rows.filter((row) => row.liveCanary);

  const cards = [
    { label: "Open conversations", value: open.length, href: "/lite/inbox" },
    { label: "Assigned to me", value: mine.length, href: "/lite/inbox" },
    { label: "Waiting for a human", value: unassigned.length, href: "/lite/inbox" },
    { label: "Live WhatsApp visitors", value: live.length, href: "/lite/inbox" },
  ] as const;

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold text-slate-900">
          Hello{member ? `, ${member.displayLabel.split(" — ")[0]}` : ""} 👋
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          One WhatsApp number, one simple helpdesk — powered by the governed Hemas Connect engine.
        </p>
      </section>

      {conversations.error ? (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-xs text-rose-700">
          {conversations.error}
        </p>
      ) : null}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="rounded-2xl border border-emerald-900/5 bg-white p-4 shadow-sm transition hover:shadow-md"
          >
            <p className="text-3xl font-semibold text-emerald-700">
              {conversations.loading ? "–" : card.value}
            </p>
            <p className="mt-1 text-xs font-medium text-slate-500">{card.label}</p>
          </Link>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-emerald-900/5 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">What&apos;s live in this demo</h2>
          <ul className="mt-3 space-y-2">
            {CAPABILITIES.map((capability) => (
              <li key={capability.label} className="flex items-center gap-2 text-sm">
                <span
                  className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold uppercase tracking-wide ${
                    capability.state === "live"
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {capability.state === "live" ? "Live" : capability.state}
                </span>
                <span className="text-slate-700">{capability.label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-emerald-900/5 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Agent seats</h2>
          <ul className="mt-3 space-y-2">
            {LITE_SEAT_HINTS.map((seat) => (
              <li
                key={seat.email}
                className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2"
              >
                <span className="text-sm text-slate-700">{seat.label}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                  {seat.role}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-400">
            Each seat signs in on its own device — claim a chat in the inbox and reply live.
          </p>
        </div>
      </section>
    </div>
  );
}
