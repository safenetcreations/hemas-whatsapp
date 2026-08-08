"use client";

import {
  AlertOctagon,
  ArrowLeft,
  Bot,
  CheckCheck,
  Clock3,
  FileText,
  FlaskConical,
  LockKeyhole,
  MessageSquareOff,
  Send,
  ShieldAlert,
  UserRoundCheck,
} from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { InboxConversationRecord, LocalTimelineEvent } from "./types";
import { metadataMessagePreview } from "./workspace-data";

const LANGUAGE_LABELS = {
  en: "English",
  si: "සිංහල",
  ta: "தமிழ்",
} as const;

interface TimelineItem {
  readonly id: string;
  readonly kind: "message" | "system";
  readonly direction: "inbound" | "outbound" | "internal";
  readonly preview: string;
  readonly occurredAt: string;
  readonly type: string;
  readonly status: string;
  readonly simulated: boolean;
}

function formatTimelineTime(value: string): string {
  return new Intl.DateTimeFormat("en-LK", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Colombo",
  }).format(new Date(value));
}

function messageTime(message: InboxConversationRecord["messages"][number]): string {
  return message.receivedAt ?? message.sentAt ?? message.createdAt;
}

export function ThreadPanel({
  record,
  mode,
  localEvents,
  compactContext,
  onBack,
  onTakeOver,
  onResumeAutomation,
  onAddSimulatedReply,
}: {
  record: InboxConversationRecord;
  mode: InboxConversationRecord["conversation"]["mode"];
  localEvents: readonly LocalTimelineEvent[];
  compactContext: ReactNode;
  onBack: () => void;
  onTakeOver: () => void;
  onResumeAutomation: () => void;
  onAddSimulatedReply: (message: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [renderedAt] = useState(() => Date.now());
  const timelineEndRef = useRef<HTMLDivElement>(null);
  const { conversation, contact, messages } = record;
  const urgent = conversation.purpose === "urgent_escalation" || conversation.mode === "safety_hold";
  const resolved = conversation.status === "resolved";
  const serviceWindowOpen =
    conversation.serviceWindowExpiresAt !== null &&
    renderedAt <= Date.parse(conversation.serviceWindowExpiresAt);

  const timeline = useMemo<readonly TimelineItem[]>(() => {
    const persistedItems: TimelineItem[] = messages.map((message) => ({
      id: message.id,
      kind: message.direction === "internal" ? "system" : "message",
      direction: message.direction,
      preview: metadataMessagePreview(message),
      occurredAt: messageTime(message),
      type: message.type,
      status: message.status,
      simulated: message.synthetic,
    }));
    const localItems: TimelineItem[] = localEvents.map((event) => ({
      id: event.id,
      kind: event.kind === "system" ? "system" : "message",
      direction: event.kind === "system" ? "internal" : "outbound",
      preview: event.preview,
      occurredAt: event.occurredAt,
      type: event.kind === "system" ? "system" : "text",
      status: "local only",
      simulated: true,
    }));
    return [...persistedItems, ...localItems].sort(
      (left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt),
    );
  }, [localEvents, messages]);

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [timeline.length]);

  const canSimulateReply = mode === "human_takeover" && !urgent && !resolved;

  function submitSimulatedReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || !canSimulateReply) return;
    onAddSimulatedReply(message);
    setDraft("");
  }

  return (
    <section
      aria-label={`Synthetic conversation with ${contact.displayLabel}`}
      className="flex min-h-[72dvh] min-w-0 flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_1px_2px_rgba(23,34,31,0.04)] md:h-full md:min-h-0"
    >
      <header className="border-b border-[var(--line)] bg-white px-3.5 py-3 sm:px-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[var(--line)] text-slate-600 hover:bg-slate-50 md:hidden"
            aria-label="Back to conversation list"
          >
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
          <span
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-bold ${
              urgent ? "bg-red-100 text-red-700" : "bg-[var(--brand-soft)] text-[var(--brand)]"
            }`}
            aria-hidden="true"
          >
            {contact.displayLabel.slice(-1)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-sm font-bold text-slate-950 sm:text-[15px]">{contact.displayLabel}</h2>
              <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] text-violet-700">
                Synthetic
              </span>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-slate-500">
              {contact.maskedPhone} · {record.teamName}
            </p>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600">
              {LANGUAGE_LABELS[conversation.detectedLanguage]} {Math.round(conversation.languageConfidence * 100)}%
            </span>
            {urgent ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-bold text-red-700">
                <ShieldAlert size={12} aria-hidden="true" /> Safety hold
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${
              mode === "human_takeover"
                ? "bg-cyan-50 text-cyan-800"
                : mode === "safety_hold"
                  ? "bg-red-50 text-red-700"
                  : "bg-emerald-50 text-emerald-800"
            }`}
          >
            {mode === "human_takeover" ? (
              <UserRoundCheck size={12} aria-hidden="true" />
            ) : mode === "safety_hold" ? (
              <AlertOctagon size={12} aria-hidden="true" />
            ) : (
              <Bot size={12} aria-hidden="true" />
            )}
            {mode === "human_takeover" ? "Human simulation" : mode === "safety_hold" ? "Safety hold" : "Automation simulation"}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">
            <Clock3 size={12} aria-hidden="true" />
            Service window {serviceWindowOpen ? "open now" : "closed now"} from stored expiry
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-800">
            <MessageSquareOff size={12} aria-hidden="true" /> External send blocked
          </span>
          <div className="ml-auto">
            {urgent ? (
              <button
                type="button"
                disabled
                title="Safety hold cannot be bypassed in the demo inbox"
                className="h-8 cursor-not-allowed rounded-lg bg-red-50 px-3 text-[11px] font-bold text-red-700"
              >
                Safety hold active
              </button>
            ) : mode === "human_takeover" ? (
              <button
                type="button"
                onClick={onResumeAutomation}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
              >
                <Bot size={13} aria-hidden="true" /> Resume simulation
              </button>
            ) : (
              <button
                type="button"
                onClick={onTakeOver}
                disabled={resolved}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--brand)] px-3 text-[11px] font-bold text-white hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <UserRoundCheck size={13} aria-hidden="true" /> Take over locally
              </button>
            )}
          </div>
        </div>
      </header>

      {urgent ? (
        <div className="border-b border-red-200 bg-red-50 px-4 py-3" role="alert">
          <div className="flex gap-2.5">
            <AlertOctagon className="mt-0.5 shrink-0 text-red-700" size={17} aria-hidden="true" />
            <div>
              <p className="text-xs font-bold text-red-900">Synthetic urgent-language safeguard triggered</p>
              <p className="mt-1 text-[11px] leading-5 text-red-800">
                Routine automation and the composer are stopped. In production this must follow the approved emergency and clinical escalation protocol; this demo does not provide medical advice or contact anyone.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="border-b border-[var(--line)] p-3 2xl:hidden">{compactContext}</div>

      <div className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto bg-[#f6f8f7] px-3 py-4 sm:px-5" aria-live="polite">
        <div className="mx-auto max-w-3xl space-y-3">
          <div className="flex justify-center">
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[9px] font-bold uppercase tracking-[0.06em] text-slate-500 shadow-sm">
              Persisted metadata timeline
            </span>
          </div>

          {timeline.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
              <p className="text-sm font-bold text-slate-800">No synthetic messages</p>
              <p className="mt-1 text-xs text-slate-500">This persisted conversation currently has no message metadata.</p>
            </div>
          ) : (
            timeline.map((item) => {
              if (item.kind === "system") {
                return (
                  <div key={item.id} className="flex justify-center py-1">
                    <div className="max-w-[90%] rounded-full border border-slate-200 bg-white px-3 py-1.5 text-center text-[10px] font-semibold text-slate-500 shadow-sm">
                      {item.preview} · {formatTimelineTime(item.occurredAt)}
                    </div>
                  </div>
                );
              }

              const outbound = item.direction === "outbound";
              return (
                <article key={item.id} className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 shadow-[0_1px_1px_rgba(23,34,31,0.06)] sm:max-w-[75%] ${
                      outbound
                        ? "rounded-br-md bg-[#dff3eb] text-slate-900"
                        : "rounded-bl-md border border-slate-200 bg-white text-slate-900"
                    }`}
                  >
                    <p className="whitespace-pre-wrap text-[12px] leading-5 sm:text-[13px]">{item.preview}</p>
                    <footer className="mt-1.5 flex items-center justify-end gap-1.5 text-[9px] text-slate-500">
                      {item.type === "document" ? <FileText size={10} aria-hidden="true" /> : null}
                      {item.simulated ? <FlaskConical size={10} aria-hidden="true" /> : null}
                      <span className="capitalize">{item.status.replaceAll("_", " ")}</span>
                      <span>{formatTimelineTime(item.occurredAt)}</span>
                      {outbound ? <CheckCheck size={11} aria-label="Outbound metadata" /> : null}
                    </footer>
                  </div>
                </article>
              );
            })
          )}
          <div ref={timelineEndRef} />
        </div>
      </div>

      <footer className="border-t border-[var(--line)] bg-white p-3 sm:p-4">
        <div className="mb-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] leading-4 text-amber-900">
          <LockKeyhole size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            <strong>No real send:</strong> replies appear only in local page state. No WhatsApp, Meta, Firebase write or patient-system request is made. External policy result: external messaging disabled.
          </span>
        </div>

        {urgent ? (
          <div className="flex min-h-12 items-center justify-center rounded-xl border border-red-200 bg-red-50 px-4 text-center text-xs font-bold text-red-800">
            Composer locked by the synthetic safety hold
          </div>
        ) : resolved ? (
          <div className="flex min-h-12 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-4 text-center text-xs font-semibold text-slate-600">
            This synthetic conversation is resolved. Reopening is outside this demo action.
          </div>
        ) : mode !== "human_takeover" ? (
          <div className="flex flex-col items-center justify-between gap-2 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2.5 sm:flex-row">
            <p className="text-center text-[11px] font-semibold text-cyan-900 sm:text-left">
              Take over locally to test a human reply without sending anything.
            </p>
            <button
              type="button"
              onClick={onTakeOver}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--brand)] px-3 text-[11px] font-bold text-white hover:bg-[var(--brand-strong)]"
            >
              <UserRoundCheck size={14} aria-hidden="true" /> Take over locally
            </button>
          </div>
        ) : (
          <form onSubmit={submitSimulatedReply} className="flex items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Write a local simulated reply</span>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={1000}
                rows={2}
                placeholder="Write a local simulated reply…"
                className="scrollbar-subtle min-h-[48px] w-full resize-none rounded-xl border border-[var(--line)] bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-900 outline-none placeholder:text-slate-400 focus:border-[var(--brand)] focus:bg-white"
              />
            </label>
            <button
              type="submit"
              disabled={!draft.trim()}
              className="inline-flex h-12 shrink-0 items-center gap-2 rounded-xl bg-[var(--brand)] px-4 text-xs font-bold text-white shadow-sm hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Send size={15} aria-hidden="true" />
              <span className="hidden sm:inline">Add locally</span>
              <span className="sm:hidden">Add</span>
            </button>
          </form>
        )}
      </footer>
    </section>
  );
}
