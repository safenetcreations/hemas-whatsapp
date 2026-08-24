"use client";

import {
  ArrowLeft,
  Bot,
  CalendarDays,
  CheckCheck,
  Clock3,
  ContactRound,
  FlaskConical,
  Inbox,
  MessageCircle,
  MessageSquareText,
  Search,
  Send,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiteAuth } from "@/components/lite/lite-auth";
import {
  buildLiteProtectedAuthorityFingerprint,
  liteClaim,
  liteReply,
  useLiteContactIndex,
  useLiteContacts,
  useLiteConversations,
  useLiteMessages,
  useLiteProtectedMessages,
  type LiteConversation,
  type LiteMessage,
} from "@/components/lite/lite-data";
import {
  LITE_BUTTON_PRIMARY,
  LITE_BUTTON_SECONDARY,
  LITE_FIELD,
  LITE_PANEL,
  LiteEmptyState,
  LitePageHeader,
  LiteStatus,
  liteCx,
} from "@/components/lite/lite-ui";

const LANGUAGE_LABEL: Record<string, string> = {
  en: "EN",
  si: "සිං",
  ta: "தமி",
};

const PURPOSE_LABEL: Record<string, string> = {
  appointment: "Appointment",
  laboratory: "Laboratory",
  general_support: "Support",
};

function timeAgo(ms: number, nowMs: number): string {
  if (!ms) return "";
  const diff = nowMs - ms;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function clock(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

const DELIVERY_LABEL: Record<LiteMessage["status"], string> = {
  received: "Received",
  pending: "Pending",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  failed: "Failed",
};

function messageSourceLabel(message: LiteMessage): string {
  if (message.direction === "inbound") return "Canary tester · inbound";
  if (message.automationSource === "agent") return "Agent reply · live";
  if (message.automationSource === "governed_ai") return "Governed AI reply";
  if (message.automationSource === "menu_bot") return "Menu bot reply";
  return "Automation reply · legacy record";
}

function deliveryEvidenceAtMs(message: LiteMessage): number {
  if (message.status === "read") {
    return message.readAtMs || message.deliveryUpdatedAtMs || message.deliveredAtMs;
  }
  if (message.status === "delivered") {
    return message.deliveredAtMs || message.deliveryUpdatedAtMs;
  }
  if (message.status === "failed") {
    return message.failedAtMs || message.deliveryUpdatedAtMs;
  }
  if (message.status === "sent") {
    return message.sentAtMs || message.deliveryUpdatedAtMs;
  }
  return 0;
}

function deliveryTone(message: LiteMessage): string {
  if (message.status === "failed") return "bg-rose-100 text-rose-700";
  if (message.status === "read") return "bg-emerald-100 text-emerald-800";
  if (message.status === "delivered") return "bg-cyan-100 text-cyan-800";
  if (message.status === "sent") return "bg-blue-100 text-blue-800";
  return "bg-slate-100 text-slate-600";
}

type Filter = "all" | "mine" | "unassigned";

export default function LiteInboxPage() {
  const { status, user, member } = useLiteAuth();
  const [scope, setScope] = useState<"live" | "all">("live");
  const conversations = useLiteConversations(status === "ready", scope === "live");
  const contacts = useLiteContacts(status === "ready");
  const contactIndex = useLiteContactIndex(contacts.rows);

  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const replyOperation = useRef<{ readonly key: string; readonly id: string } | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const filtered = useMemo(() => {
    const scoped =
      filter === "mine"
        ? conversations.rows.filter((row) => row.assigneeId === user?.uid)
        : filter === "unassigned"
          ? conversations.rows.filter((row) => !row.assigneeId)
          : conversations.rows;
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return scoped;
    return scoped.filter((row) => {
      const contactLabel = row.liveCanary
        ? "Live WhatsApp tester"
        : contactIndex.get(row.contactId)?.displayLabel ?? "Visitor";
      return `${contactLabel} ${row.purpose} ${row.detectedLanguage} ${row.mode}`
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [contactIndex, conversations.rows, filter, query, user?.uid]);

  const selected: LiteConversation | null =
    conversations.rows.find((row) => row.id === selectedId) ?? null;
  const messages = useLiteMessages(selected?.id ?? null);
  const visibleMessages = useMemo(
    () =>
      selected
        ? messages.rows.filter((message) => message.conversationId === selected.id)
        : [],
    [messages.rows, selected],
  );
  const protectedMessageIds = useMemo(
    () => visibleMessages.map((message) => message.id),
    [visibleMessages],
  );
  const protectedAuthorityFingerprint = useMemo(
    () =>
      status === "ready"
        ? buildLiteProtectedAuthorityFingerprint({
            userId: user?.uid ?? null,
            emailVerified: user?.emailVerified === true,
            memberRole: member?.role ?? null,
            conversationId: selected?.id ?? null,
            assigneeId: selected?.assigneeId ?? null,
            liveCanary: selected?.liveCanary === true,
            synthetic: selected?.synthetic === true,
          })
        : null,
    [
      member?.role,
      selected?.assigneeId,
      selected?.id,
      selected?.liveCanary,
      selected?.synthetic,
      status,
      user?.emailVerified,
      user?.uid,
    ],
  );
  const protectedMessages = useLiteProtectedMessages(
    selected?.id ?? null,
    protectedMessageIds,
    protectedAuthorityFingerprint,
  );

  const windowOpen = Boolean(
    selected && selected.serviceWindowExpiresAtMs > nowMs,
  );
  const isMine = Boolean(selected && user && selected.assigneeId === user.uid);
  const assignedToOther = Boolean(selected?.assigneeId) && !isMine;
  const canReply = Boolean(selected?.liveCanary) && windowOpen && isMine;

  const act = async (kind: "claim" | "release" | "reply") => {
    if (!selected) return;
    setBusy(kind);
    setNotice(null);
    try {
      if (kind === "reply") {
        const text = draft.trim();
        if (!text) return;
        const key = `${selected.id}:${text}`;
        if (replyOperation.current?.key !== key) {
          replyOperation.current = { key, id: `reply_${crypto.randomUUID()}` };
        }
        await liteReply(selected.id, text, replyOperation.current.id);
        replyOperation.current = null;
        setDraft("");
        setNotice("Reply accepted by WhatsApp API ✓ — delivery confirmation pending.");
      } else {
        await liteClaim(selected.id, kind);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The action failed.");
    } finally {
      setBusy(null);
    }
  };

  const label = (conversation: LiteConversation): string => {
    if (conversation.liveCanary) return "Live WhatsApp tester";
    return contactIndex.get(conversation.contactId)?.displayLabel ?? "Visitor";
  };

  return (
    <div className="space-y-5">
      <LitePageHeader
        eyebrow="Care team workspace"
        title="WhatsApp inbox"
        description="Coordinate live conversations, ownership, and delivery evidence from the governed canary line."
        actions={
          <div
            className="inline-flex rounded-xl border border-[var(--lite-line)] bg-white p-1 shadow-sm"
            aria-label="Conversation source"
          >
            <button
              type="button"
              aria-pressed={scope === "live"}
              onClick={() => setScope("live")}
              className={liteCx(
                "min-h-11 rounded-lg px-3 text-xs font-bold transition",
                scope === "live"
                  ? "bg-[var(--lite-brand)] text-white"
                  : "text-[var(--lite-muted)] hover:bg-[var(--lite-brand-soft)]",
              )}
            >
              Live line
            </button>
            <button
              type="button"
              aria-pressed={scope === "all"}
              onClick={() => setScope("all")}
              className={liteCx(
                "min-h-11 rounded-lg px-3 text-xs font-bold transition",
                scope === "all"
                  ? "bg-[var(--lite-ink)] text-white"
                  : "text-[var(--lite-muted)] hover:bg-slate-50",
              )}
            >
              Include simulated
            </button>
          </div>
        }
      />

      <div className="grid h-[calc(100dvh-20rem)] min-h-0 gap-4 lg:h-[calc(100dvh-13rem)] lg:min-h-[640px] lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[370px_minmax(0,1fr)]">
        <section
          className={liteCx(
            LITE_PANEL,
            "min-h-0 flex-col overflow-hidden",
            selected ? "hidden lg:flex" : "flex",
          )}
          aria-label="Conversation list"
        >
          <div className="border-b border-[var(--lite-line)] p-4">
            <label className="relative block">
              <span className="sr-only">Search conversations</span>
              <Search
                size={17}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className={`${LITE_FIELD} pl-10`}
                placeholder="Search conversations"
                type="search"
              />
            </label>
            <div className="mt-3 flex items-center gap-1" aria-label="Conversation ownership filter">
              {(
                [
                  ["all", "All"],
                  ["mine", "Mine"],
                  ["unassigned", "Unassigned"],
                ] as const
              ).map(([value, text]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                  className={liteCx(
                    "min-h-11 rounded-lg px-3 text-xs font-bold transition",
                    filter === value
                      ? "bg-[var(--lite-brand-soft)] text-[var(--lite-brand-strong)]"
                      : "text-[var(--lite-muted)] hover:bg-slate-50",
                  )}
                >
                  {text}
                </button>
              ))}
              <span className="ml-auto text-xs font-semibold text-[var(--lite-muted)]">
                {filtered.length} chats
              </span>
            </div>
          </div>

          <div className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto">
            {conversations.loading ? (
              <div className="space-y-3 p-4" aria-busy="true">
                {[0, 1, 2, 3].map((row) => (
                  <div key={row} className="h-20 animate-pulse rounded-xl bg-slate-100" />
                ))}
              </div>
            ) : null}
            {conversations.error ? (
              <p className="m-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                Conversations are temporarily unavailable.
              </p>
            ) : null}
            {!conversations.loading && filtered.length === 0 && !conversations.error ? (
              <LiteEmptyState
                icon={Inbox}
                title={query ? "No matching conversations" : "No conversations yet"}
                description={
                  query
                    ? "Try another name, language, purpose, or ownership filter."
                    : scope === "live"
                      ? "Send a test message from an allowlisted phone to start the live canary journey."
                      : "No live or simulated conversations are available."
                }
              />
            ) : null}

            <ul>
              {filtered.map((conversation) => {
                const PurposeIcon =
                  conversation.purpose === "appointment"
                    ? CalendarDays
                    : conversation.purpose === "laboratory"
                      ? FlaskConical
                      : MessageCircle;
                const active = selectedId === conversation.id;
                return (
                  <li key={conversation.id} className="border-b border-[var(--lite-line)] last:border-b-0">
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSelectedId(conversation.id)}
                      className={liteCx(
                        "group w-full px-4 py-3.5 text-left transition hover:bg-[var(--lite-brand-soft)]/60",
                        active && "bg-[var(--lite-brand-soft)]",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={liteCx(
                            "mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl border",
                            active
                              ? "border-[var(--lite-brand)] bg-[var(--lite-brand)] text-white"
                              : "border-[var(--lite-line)] bg-white text-[var(--lite-brand)]",
                          )}
                        >
                          <PurposeIcon size={18} aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-bold text-[var(--lite-ink)]">
                              {label(conversation)}
                            </span>
                            {conversation.liveCanary ? (
                              <LiteStatus tone="success" dot>
                                Live
                              </LiteStatus>
                            ) : null}
                            <span className="ml-auto shrink-0 text-xs font-medium text-[var(--lite-muted)]">
                              {timeAgo(conversation.lastMessageAtMs, nowMs)}
                            </span>
                          </span>
                          <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--lite-muted)]">
                            <span>{PURPOSE_LABEL[conversation.purpose] ?? conversation.purpose}</span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {LANGUAGE_LABEL[conversation.detectedLanguage] ?? conversation.detectedLanguage}
                            </span>
                            <LiteStatus
                              tone={conversation.mode === "human_takeover" ? "warning" : "neutral"}
                            >
                              {conversation.mode === "human_takeover" ? "Human" : "Bot"}
                            </LiteStatus>
                            {conversation.unreadCount > 0 ? (
                              <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--lite-brand)] px-1.5 text-[10px] font-bold text-white">
                                {conversation.unreadCount}
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section
          className={liteCx(
            LITE_PANEL,
            "min-h-0 flex-col overflow-hidden",
            selected ? "flex" : "hidden lg:flex",
          )}
          aria-label="Conversation activity"
        >
          {!selected ? (
            <LiteEmptyState
              icon={MessageSquareText}
              title="Select a conversation"
              description="Choose a live WhatsApp chat to review activity, ownership, and delivery evidence."
            />
          ) : (
            <>
              <header className="border-b border-[var(--lite-line)] bg-white px-4 py-3.5 sm:px-5">
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[var(--lite-line)] text-[var(--lite-muted)] hover:bg-slate-50 lg:hidden"
                    aria-label="Back to conversations"
                  >
                    <ArrowLeft size={19} aria-hidden="true" />
                  </button>
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--lite-brand-soft)] text-[var(--lite-brand)]">
                    <MessageCircle size={20} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-base font-bold text-[var(--lite-ink)]">
                      {label(selected)}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-[var(--lite-muted)]">
                      {selected.liveCanary
                        ? "Allowlisted WhatsApp tester · governed canary line"
                        : "Synthetic demo visitor · no phone stored"}
                    </p>
                  </div>
                  <div className="hidden items-center gap-2 sm:flex">
                    {selected.liveCanary ? (
                      <LiteStatus tone={windowOpen ? "success" : "neutral"} dot={windowOpen}>
                        {windowOpen ? "24h window open" : "Window closed"}
                      </LiteStatus>
                    ) : (
                      <LiteStatus>Simulated chat</LiteStatus>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--lite-line)] pt-3">
                  <Link
                    href={`/lite/contacts#${encodeURIComponent(selected.contactId)}`}
                    className={`${LITE_BUTTON_SECONDARY} min-h-10 px-3 text-xs`}
                  >
                    <ContactRound size={16} aria-hidden="true" />
                    Open lead in CRM
                  </Link>
                  <div className="sm:hidden">
                    {selected.liveCanary ? (
                      <LiteStatus tone={windowOpen ? "success" : "neutral"} dot={windowOpen}>
                        {windowOpen ? "24h window open" : "Window closed"}
                      </LiteStatus>
                    ) : (
                      <LiteStatus>Simulated chat</LiteStatus>
                    )}
                  </div>
                  <div className="ml-auto">
                    {isMine ? (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void act("release")}
                        className={`${LITE_BUTTON_SECONDARY} min-h-10 px-3 text-xs hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700`}
                      >
                        {busy === "release" ? "Releasing…" : "Release chat"}
                      </button>
                    ) : assignedToOther ? (
                      <LiteStatus tone="warning">Assigned to another agent</LiteStatus>
                    ) : (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void act("claim")}
                        className={`${LITE_BUTTON_PRIMARY} min-h-10 px-3 text-xs`}
                      >
                        <UserRoundCheck size={16} aria-hidden="true" />
                        {busy === "claim" ? "Claiming…" : "Claim chat"}
                      </button>
                    )}
                  </div>
                </div>
              </header>

              <div className="scrollbar-subtle min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#f8fbfb] px-4 py-5 sm:px-5">
                <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--lite-muted)]">
                  <Clock3 size={15} aria-hidden="true" />
                  Protected conversation timeline
                </div>
                {messages.loading ? (
                  <div className="space-y-3" aria-busy="true">
                    {[0, 1, 2].map((row) => (
                      <div key={row} className="h-20 animate-pulse rounded-xl bg-white" />
                    ))}
                  </div>
                ) : null}
                {messages.error ? (
                  <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                    Conversation activity is temporarily unavailable.
                  </p>
                ) : null}
                {!messages.loading &&
                visibleMessages.length > 0 &&
                protectedMessages.protectedLoading ? (
                  <p
                    className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-sm text-cyan-900"
                    role="status"
                    aria-live="polite"
                  >
                    Retrieving protected message text… Delivery evidence remains available below.
                  </p>
                ) : null}
                {protectedMessages.protectedError && visibleMessages.length > 0 ? (
                  <p
                    className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-900"
                    role="alert"
                  >
                    Message text could not be retrieved. Your account may not have permission, or
                    protected content may be temporarily unavailable. Delivery evidence is still
                    shown.
                  </p>
                ) : null}
                {!messages.loading && visibleMessages.length === 0 && !messages.error ? (
                  <LiteEmptyState
                    icon={MessageCircle}
                    title="No messages yet"
                    description="New inbound and outbound WhatsApp messages will appear here with their delivery evidence."
                  />
                ) : null}
                {visibleMessages.map((message) => {
                  const evidenceAtMs = deliveryEvidenceAtMs(message);
                  const agentReply = message.automationSource === "agent";
                  const outbound = message.direction === "outbound";
                  const protectedText = protectedMessages.textByMessageId.get(message.id);
                  const SourceIcon = outbound
                    ? agentReply
                      ? UserRoundCheck
                      : Bot
                    : MessageCircle;
                  return (
                    <div
                      key={message.id}
                      className={liteCx("flex", outbound ? "justify-end" : "justify-start")}
                    >
                      <article
                        className={liteCx(
                          "w-full max-w-[86%] rounded-2xl border px-4 py-3 shadow-[0_1px_2px_rgba(19,52,63,0.04)] sm:max-w-[72%]",
                          outbound
                            ? agentReply
                              ? "border-[var(--lite-brand)] bg-[var(--lite-brand)] text-white"
                              : "border-[#cde4e9] bg-white text-[var(--lite-ink)]"
                            : "border-[var(--lite-line)] bg-white text-[var(--lite-ink)]",
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={liteCx(
                              "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                              outbound && agentReply
                                ? "bg-white/15 text-white"
                                : "bg-[var(--lite-brand-soft)] text-[var(--lite-brand)]",
                            )}
                          >
                            <SourceIcon size={16} aria-hidden="true" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold">{messageSourceLabel(message)}</p>
                            <p
                              className={liteCx(
                                "mt-1 text-xs leading-5",
                                outbound && agentReply ? "text-cyan-50/75" : "text-[var(--lite-muted)]",
                              )}
                            >
                              {message.type} · recorded {clock(message.createdAtMs) || "time unavailable"}
                            </p>
                            {protectedText !== undefined ? (
                              <p
                                className={liteCx(
                                  "mt-2 whitespace-pre-wrap break-words text-[15px] leading-6",
                                  outbound && agentReply ? "text-white" : "text-[var(--lite-ink)]",
                                )}
                              >
                                {protectedText}
                              </p>
                            ) : protectedMessages.protectedLoading ? (
                              <p
                                className={liteCx(
                                  "mt-2 text-xs italic leading-5",
                                  outbound && agentReply
                                    ? "text-cyan-50/75"
                                    : "text-[var(--lite-muted)]",
                                )}
                              >
                                Retrieving protected content…
                              </p>
                            ) : protectedMessages.protectedError ? (
                              <p
                                className={liteCx(
                                  "mt-2 text-xs italic leading-5",
                                  outbound && agentReply
                                    ? "text-cyan-50/75"
                                    : "text-[var(--lite-muted)]",
                                )}
                              >
                                Message text is unavailable for this account.
                              </p>
                            ) : (
                              <p
                                className={liteCx(
                                  "mt-2 text-xs italic leading-5",
                                  outbound && agentReply
                                    ? "text-cyan-50/75"
                                    : "text-[var(--lite-muted)]",
                                )}
                              >
                                Content was not retained for this earlier message or its retention
                                period has expired.
                              </p>
                            )}
                            {outbound ? (
                              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                                <span
                                  aria-label={`WhatsApp delivery status: ${DELIVERY_LABEL[message.status]}`}
                                  className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${deliveryTone(message)}`}
                                >
                                  {message.status === "read" ? (
                                    <CheckCheck size={12} className="mr-1 inline" aria-hidden="true" />
                                  ) : null}
                                  {DELIVERY_LABEL[message.status]}
                                </span>
                                <span
                                  className={liteCx(
                                    "text-[11px]",
                                    agentReply ? "text-cyan-50/70" : "text-[var(--lite-muted)]",
                                  )}
                                >
                                  {evidenceAtMs > 0
                                    ? `Status observed ${clock(evidenceAtMs)}`
                                    : "Awaiting callback timestamp"}
                                </span>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </article>
                    </div>
                  );
                })}
              </div>

              <footer className="border-t border-[var(--lite-line)] bg-white p-4 sm:p-5">
                {notice ? (
                  <p
                    className="mb-3 rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-sm text-sky-900"
                    role="status"
                    aria-live="polite"
                  >
                    {notice}
                  </p>
                ) : null}
                {canReply ? (
                  <div className="flex items-end gap-2">
                    <label className="min-w-0 flex-1">
                      <span className="sr-only">Live WhatsApp reply</span>
                      <textarea
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        rows={2}
                        maxLength={1024}
                        placeholder="Type a live WhatsApp reply… (EN / සිංහල / தமிழ்)"
                        className={`${LITE_FIELD} resize-none`}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={busy !== null || draft.trim().length === 0}
                      onClick={() => void act("reply")}
                      className={`${LITE_BUTTON_PRIMARY} shrink-0`}
                      aria-label={busy === "reply" ? "Sending WhatsApp reply" : "Send WhatsApp reply"}
                    >
                      <Send size={17} aria-hidden="true" />
                      <span className="hidden sm:inline">{busy === "reply" ? "Sending…" : "Send"}</span>
                    </button>
                  </div>
                ) : (
                  <p className="rounded-xl border border-[var(--lite-line)] bg-slate-50 px-3.5 py-3 text-sm leading-5 text-[var(--lite-muted)]">
                    {assignedToOther
                      ? "This chat is assigned to another agent. It must be released before you can claim and reply."
                      : !selected.liveCanary
                        ? "This is a simulated demo conversation. Live replies are available only on governed WhatsApp canary chats."
                        : !windowOpen
                          ? "The 24-hour service window is closed. Use an approved template until the visitor messages again."
                          : "Claim this chat to send a live WhatsApp reply."}
                  </p>
                )}
                <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-[var(--lite-muted)]">
                  <ShieldCheck
                    size={15}
                    className="mt-0.5 shrink-0 text-[var(--lite-brand)]"
                    aria-hidden="true"
                  />
                  Governance: retained text is available only to authorised team members, access
                  is audited, and content expires under the configured retention policy.
                </p>
              </footer>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
