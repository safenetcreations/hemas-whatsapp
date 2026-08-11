"use client";

import { useLiteAuth } from "@/components/lite/lite-auth";
import { useLiteContacts } from "@/components/lite/lite-data";

const LANGUAGE_NAME: Record<string, string> = {
  en: "English",
  si: "සිංහල",
  ta: "தமிழ்",
};

export default function LiteContactsPage() {
  const { status } = useLiteAuth();
  const contacts = useLiteContacts(status === "ready");

  return (
    <div className="space-y-4">
      <section>
        <h1 className="text-xl font-semibold text-slate-900">Contacts</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every visitor who has spoken with the line — numbers stay masked, bodies are never stored.
        </p>
      </section>

      {contacts.error ? (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-xs text-rose-700">{contacts.error}</p>
      ) : null}
      {contacts.loading ? <p className="text-xs text-slate-400">Loading contacts…</p> : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {contacts.rows.map((contact) => (
          <article
            key={contact.id}
            className="rounded-2xl border border-emerald-900/5 bg-white p-4 shadow-sm"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
                {contact.displayLabel.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">
                  {contact.displayLabel}
                </p>
                <p className="truncate text-[11px] text-slate-400">{contact.maskedPhone}</p>
              </div>
              {contact.liveCanary ? (
                <span className="ml-auto rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-700">
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
                  className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700"
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
          No contacts yet — message the WhatsApp line and the visitor appears here.
        </p>
      ) : null}
    </div>
  );
}
