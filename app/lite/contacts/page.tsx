"use client";

import { useState } from "react";
import { useLiteAuth } from "@/components/lite/lite-auth";
import { resolveKnownVisitor } from "@/components/lite/lite-config";
import { useLiteContacts } from "@/components/lite/lite-data";

const LANGUAGE_NAME: Record<string, string> = {
  en: "English",
  si: "සිංහල",
  ta: "தமிழ்",
};

export default function LiteContactsPage() {
  const { status } = useLiteAuth();
  const [scope, setScope] = useState<"live" | "all">("live");
  const contacts = useLiteContacts(status === "ready", scope === "live");

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Contacts</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every visitor who has spoken with the line — message bodies are never stored.
          </p>
        </div>
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            onClick={() => setScope("live")}
            className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
              scope === "live"
                ? "bg-[#1863DC] text-white"
                : "border border-slate-200 text-slate-500"
            }`}
          >
            ● Live line
          </button>
          <button
            type="button"
            onClick={() => setScope("all")}
            className={`rounded-full px-3 py-1 text-[11px] font-medium ${
              scope === "all" ? "bg-slate-700 text-white" : "border border-slate-200 text-slate-400"
            }`}
          >
            + Simulated
          </button>
        </div>
      </section>

      {contacts.error ? (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-xs text-rose-700">{contacts.error}</p>
      ) : null}
      {contacts.loading ? <p className="text-xs text-slate-400">Loading contacts…</p> : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {contacts.rows.map((contact) => (
          <article
            key={contact.id}
            className="rounded-2xl border border-blue-900/5 bg-white p-4 shadow-sm"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">
                {contact.displayLabel.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">
                  {(contact.liveCanary ? resolveKnownVisitor(contact.displayLabel) : null) ??
                    contact.displayLabel}
                </p>
                <p className="truncate text-[11px] text-slate-400">
                  {contact.liveCanary ? "Real WhatsApp visitor" : contact.maskedPhone}
                </p>
              </div>
              {contact.liveCanary ? (
                <span className="ml-auto rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-blue-700">
                  Live
                </span>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                {LANGUAGE_NAME[contact.preferredLanguage] ?? contact.preferredLanguage}
              </span>
              {contact.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700"
                >
                  {tag}
                </span>
              ))}
            </div>
          </article>
        ))}
      </section>

      {!contacts.loading && contacts.rows.length === 0 && !contacts.error ? (
        <p className="text-xs text-slate-400">
          {scope === "live"
            ? "No live visitors yet — WhatsApp the line (+94 70 796 4455) and they appear here."
            : "No contacts yet."}
        </p>
      ) : null}
    </div>
  );
}
