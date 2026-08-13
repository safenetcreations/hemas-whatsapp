"use client";

import {
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Languages,
  LockKeyhole,
  MapPin,
  MessageSquareOff,
  ShieldCheck,
  Tag,
  UsersRound,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useWorkspaceSession } from "@/components/auth/workspace-session";
import { hasPermission } from "@/lib/domain/access-control";
import type { ConsentRecordDTO } from "@/lib/firebase/repositories";
import type { InboxConversationRecord } from "./types";

const LANGUAGE_LABELS = {
  en: "English",
  si: "සිංහල",
  ta: "தமிழ்",
} as const;

function consentTone(status: ConsentRecordDTO["status"]): string {
  if (status === "granted") return "text-emerald-700";
  if (status === "withdrawn" || status === "denied") return "text-red-700";
  return "text-amber-700";
}

function formatEvidenceTime(value: string): string {
  return new Intl.DateTimeFormat("en-LK", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Colombo",
  }).format(new Date(value));
}

function ContextContent({ record, canViewContacts }: { record: InboxConversationRecord; canViewContacts: boolean }) {
  const { contact, conversation, consentRecords } = record;

  return (
    <div className="space-y-4">
      <section aria-labelledby={`identity-${conversation.id}`}>
        <h3 id={`identity-${conversation.id}`} className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
          <UserRound size={13} aria-hidden="true" /> Synthetic contact
        </h3>
        <dl className="mt-2 space-y-2 rounded-xl bg-slate-50 p-3 text-[11px]">
          <div className="flex items-start justify-between gap-3">
            <dt className="text-slate-500">Label</dt>
            <dd className="text-right font-semibold text-slate-800">{contact.displayLabel}</dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="text-slate-500">Masked contact</dt>
            <dd className="max-w-[62%] text-right font-semibold text-slate-800">{contact.maskedPhone}</dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="text-slate-500">External patient ref</dt>
            <dd className="max-w-[58%] text-right font-semibold text-slate-700">Not exposed in inbox</dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="inline-flex items-center gap-1 text-slate-500"><Languages size={11} aria-hidden="true" /> Language</dt>
            <dd className="text-right font-semibold text-slate-800">{LANGUAGE_LABELS[contact.preferredLanguage]}</dd>
          </div>
        </dl>
        {canViewContacts ? (
          <>
            <Link
              href={`/contacts#${encodeURIComponent(contact.id)}`}
              className="mt-2 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-800 transition hover:border-blue-300 hover:bg-blue-100"
            >
              <UserRound size={14} aria-hidden="true" /> Open lead in CRM
            </Link>
            <p className="mt-1.5 text-[10px] leading-4 text-slate-500">
              This WhatsApp contact is already captured; no duplicate record is created.
            </p>
          </>
        ) : (
          <p className="mt-2 flex min-h-10 items-center justify-center gap-2 rounded-xl bg-slate-100 px-3 text-center text-[11px] font-semibold text-slate-600">
            <LockKeyhole size={13} aria-hidden="true" /> CRM access is not included in this role
          </p>
        )}
      </section>

      <section aria-labelledby={`consent-${conversation.id}`}>
        <h3 id={`consent-${conversation.id}`} className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
          <ShieldCheck size={13} aria-hidden="true" /> Immutable consent evidence
        </h3>
        <div className="mt-2 space-y-2 rounded-xl border border-[var(--line)] p-3 text-[11px]">
          {consentRecords.length === 0 ? (
            <div className="flex items-start gap-2 text-[10px] leading-4 text-slate-600">
              <CircleHelp size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
              No persisted consent event is available for this synthetic contact.
            </div>
          ) : (
            consentRecords.map((consent) => (
              <article key={consent.id} className="rounded-lg bg-slate-50 px-2.5 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold capitalize text-slate-700">{consent.purpose.replaceAll("_", " ")}</span>
                  <span className={`font-bold capitalize ${consentTone(consent.status)}`}>{consent.status}</span>
                </div>
                <p className="mt-1 text-[9px] leading-4 text-slate-500">
                  {consent.category} · {consent.source.replaceAll("_", " ")} · {formatEvidenceTime(consent.capturedAt)}
                </p>
              </article>
            ))
          )}
          {contact.suppression.suppressAll || contact.suppression.suppressMarketing ? (
            <div className="rounded-lg bg-red-50 px-2.5 py-2 font-semibold text-red-800">
              Suppression active: {contact.suppression.reasons.join(", ").replaceAll("_", " ") || "policy state"}
            </div>
          ) : null}
        </div>
      </section>

      <section aria-labelledby={`context-${conversation.id}`}>
        <h3 id={`context-${conversation.id}`} className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
          <Tag size={13} aria-hidden="true" /> Persisted routing context
        </h3>
        <dl className="mt-2 space-y-2 rounded-xl border border-[var(--line)] p-3 text-[11px]">
          <div className="flex items-start justify-between gap-3">
            <dt className="inline-flex items-center gap-1 text-slate-500"><UsersRound size={11} aria-hidden="true" /> Team</dt>
            <dd className="text-right font-semibold text-slate-800">{record.teamName}</dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="inline-flex items-center gap-1 text-slate-500"><MapPin size={11} aria-hidden="true" /> Location</dt>
            <dd className="text-right font-semibold text-slate-800">{record.locationName}</dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="text-slate-500">Purpose</dt>
            <dd className="text-right font-semibold capitalize text-slate-800">{conversation.purpose.replaceAll("_", " ")}</dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="text-slate-500">Message records</dt>
            <dd className="text-right font-semibold text-slate-800">{record.messages.length} metadata only</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-3" aria-label="Messaging boundary">
        <p className="flex items-center gap-2 text-[11px] font-bold text-amber-900">
          <MessageSquareOff size={14} aria-hidden="true" /> External messaging off
        </p>
        <p className="mt-1.5 text-[10px] leading-4 text-amber-800">
          Firestore supplies synthetic routing and metadata records only. Page controls remain temporary and make no provider request.
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.05em] text-amber-800">
          <LockKeyhole size={11} aria-hidden="true" /> Bodies and protected identity fields not loaded
        </p>
      </section>
    </div>
  );
}

export function ContextPanel({ record, compact = false }: { record: InboxConversationRecord; compact?: boolean }) {
  const workspace = useWorkspaceSession();
  const canViewContacts = Boolean(
    workspace.status === "verified" &&
    workspace.session &&
    hasPermission(workspace.session.role, "contacts.view"),
  );
  if (compact) {
    return (
      <details className="group rounded-xl border border-[var(--line)] bg-white">
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 text-[11px] font-bold text-slate-700 [&::-webkit-details-marker]:hidden">
          <UserRound size={14} aria-hidden="true" /> Contact, consent and routing context
          <ChevronDown size={14} className="ml-auto transition group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="border-t border-[var(--line)] p-3">
          <ContextContent record={record} canViewContacts={canViewContacts} />
        </div>
      </details>
    );
  }

  return (
    <aside
      aria-label="Synthetic contact context"
      className="scrollbar-subtle h-full overflow-y-auto rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.04)]"
    >
      <div className="mb-4 flex items-center gap-2 border-b border-[var(--line)] pb-3">
        <CheckCircle2 size={16} className="text-[var(--brand)]" aria-hidden="true" />
        <div>
          <h2 className="text-sm font-bold text-slate-950">Context</h2>
          <p className="mt-0.5 text-[10px] text-slate-500">Minimum necessary persisted data</p>
        </div>
      </div>
      <ContextContent record={record} canViewContacts={canViewContacts} />
    </aside>
  );
}
