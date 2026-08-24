"use client";

import { Download, Languages, Search, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLiteAuth } from "@/components/lite/lite-auth";
import { useLiteContacts } from "@/components/lite/lite-data";
import {
  LITE_BUTTON_SECONDARY,
  LITE_FIELD,
  LITE_PANEL,
  LiteEmptyState,
  LiteNotice,
  LitePageHeader,
  LiteStatus,
  liteCx,
} from "@/components/lite/lite-ui";

const LANGUAGE_NAME: Record<string, string> = {
  en: "English",
  si: "සිංහල",
  ta: "தமிழ்",
};

export default function LiteContactsPage() {
  const { status, member } = useLiteAuth();
  const [scope, setScope] = useState<"live" | "all">("live");
  const [query, setQuery] = useState("");
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const contacts = useLiteContacts(status === "ready", scope === "live");
  const canExport = member?.role === "supervisor" || member?.role === "tenant_admin";
  const visibleContacts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return contacts.rows;
    return contacts.rows.filter((contact) =>
      `${contact.displayLabel} ${contact.crmStage} ${contact.preferredLanguage} ${contact.tags.join(" ")}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [contacts.rows, query]);

  useEffect(() => {
    if (contacts.loading || typeof window === "undefined" || !window.location.hash) return;
    const contactId = decodeURIComponent(window.location.hash.slice(1));
    document.getElementById(contactId)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [contacts.loading, contacts.rows]);

  return (
    <div className="space-y-6">
      <LitePageHeader
        eyebrow="Privacy-safe CRM"
        title="Contacts"
        description="Every allowlisted visitor is captured automatically as a privacy-safe lead. Contact records never expose full phone numbers or message text; retained inbox text is separate and access-audited."
        actions={
          <button
            type="button"
            disabled={!canExport || contacts.rows.length === 0}
            onClick={() => {
              const rows = contacts.rows.map((c) => [
                c.displayLabel,
                c.crmStage,
                c.preferredLanguage,
                c.liveCanary ? "live" : "simulated",
                c.tags.join("|"),
              ]);
              const csv = ["name,stage,language,source,tags", ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
              const a = document.createElement("a");
              a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
              a.download = "hemas-lite-crm-export.csv";
              a.click();
              URL.revokeObjectURL(a.href);
              setExportNotice(`Privacy-safe CSV prepared for ${rows.length} contact${rows.length === 1 ? "" : "s"}.`);
            }}
            className={LITE_BUTTON_SECONDARY}
          >
            <Download size={17} aria-hidden="true" />
            Export CSV
          </button>
        }
      />

      {exportNotice ? <LiteNotice tone="success">{exportNotice}</LiteNotice> : null}
      {contacts.error ? <LiteNotice tone="danger">Contacts are temporarily unavailable.</LiteNotice> : null}

      <section className={liteCx(LITE_PANEL, "flex flex-col gap-4 p-4 sm:flex-row sm:items-center")}>
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search contacts</span>
          <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by contact, stage, language, or tag"
            className={`${LITE_FIELD} pl-10`}
          />
        </label>
        <div className="inline-flex self-start rounded-xl border border-[var(--lite-line)] bg-slate-50 p-1 sm:self-auto" aria-label="Contact source">
          <button
            type="button"
            aria-pressed={scope === "live"}
            onClick={() => setScope("live")}
            className={liteCx("min-h-11 rounded-lg px-3 text-xs font-bold transition", scope === "live" ? "bg-[var(--lite-brand)] text-white" : "text-[var(--lite-muted)] hover:bg-white")}
          >
            Live line
          </button>
          <button
            type="button"
            aria-pressed={scope === "all"}
            onClick={() => setScope("all")}
            className={liteCx("min-h-11 rounded-lg px-3 text-xs font-bold transition", scope === "all" ? "bg-[var(--lite-ink)] text-white" : "text-[var(--lite-muted)] hover:bg-white")}
          >
            Include simulated
          </button>
        </div>
        <LiteStatus tone={contacts.error ? "danger" : contacts.loading ? "neutral" : "brand"}>
          {contacts.error
            ? "Unavailable"
            : contacts.loading
              ? "Loading"
              : `${visibleContacts.length} contacts`}
        </LiteStatus>
      </section>

      {contacts.loading ? (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((row) => <div key={row} className="h-40 animate-pulse rounded-2xl bg-white" />)}
        </section>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visibleContacts.map((contact) => (
          <article
            key={contact.id}
            id={contact.id}
            className={liteCx(LITE_PANEL, "scroll-mt-32 p-5 target:border-[var(--lite-brand)] target:ring-4 target:ring-[var(--lite-brand)]/10")}
          >
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--lite-brand-soft)] text-[var(--lite-brand)]">
                <UserRound size={20} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[15px] font-bold text-[var(--lite-ink)]">
                  {contact.displayLabel}
                </p>
                <p className="mt-1 truncate text-xs text-[var(--lite-muted)]">
                  {contact.liveCanary ? "Allowlisted WhatsApp canary lead" : contact.maskedPhone}
                </p>
              </div>
              <span className="ml-auto flex flex-col items-end gap-1">
                {contact.liveCanary ? (
                  <LiteStatus tone="success" dot>Live</LiteStatus>
                ) : null}
                <LiteStatus tone={contact.crmStage === "booked" ? "brand" : contact.crmStage === "needs_human" ? "warning" : "neutral"}>
                  {contact.crmStage.replace("_", " ")}
                </LiteStatus>
              </span>
            </div>
            <div className="mt-4 flex items-center gap-2 border-t border-[var(--lite-line)] pt-4 text-xs text-[var(--lite-muted)]">
              <Languages size={15} className="text-[var(--lite-brand)]" aria-hidden="true" />
              <span className="font-semibold">
                {LANGUAGE_NAME[contact.preferredLanguage] ?? contact.preferredLanguage}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {contact.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-[var(--lite-line)] bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-[var(--lite-ink-secondary)]"
                >
                  {tag}
                </span>
              ))}
            </div>
          </article>
        ))}
      </section>

      {!contacts.loading && visibleContacts.length === 0 && !contacts.error ? (
        <div className={LITE_PANEL}>
          <LiteEmptyState
            icon={query ? Search : UsersRound}
            title={query ? "No matching contacts" : "No contacts yet"}
            description={query ? "Try another name, stage, language, or tag." : scope === "live" ? "Send a test message from an allowlisted phone to capture the first privacy-safe lead." : "No live or simulated contacts are available."}
          />
        </div>
      ) : null}

      <div className="flex items-start gap-3 rounded-xl border border-[var(--lite-line)] bg-white px-4 py-3 text-xs leading-5 text-[var(--lite-muted)]">
        <ShieldCheck size={17} className="mt-0.5 shrink-0 text-[var(--lite-brand)]" aria-hidden="true" />
        CRM records remain privacy-safe: message text, provider identifiers, and full phone numbers are not exposed in contact records.
      </div>
    </div>
  );
}
