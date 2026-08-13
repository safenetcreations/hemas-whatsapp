"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiteAuth } from "@/components/lite/lite-auth";
import {
  liteClaim,
  liteReply,
  useLiteContactIndex,
  useLiteContacts,
  useLiteConversations,
  useLiteMessages,
  type LiteConversation,
} from "@/components/lite/lite-data";

const LANGUAGE_LABEL: Record<string, string> = {
  en: "EN",
  si: "සිං",
  ta: "தமி",
};

const PURPOSE_LABEL: Record<string, string> = {
  appointment: "🗓 Appointment",
  laboratory: "🔬 Lab",
  general_support: "💬 Support",
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

type Filter = "all" | "mine" | "unassigned";

export default function LiteInboxPage() {
  const { status, user } = useLiteAuth();
  const [scope, setScope] = useState<"live" | "all">("live");
  const conversations = useLiteConversations(status === "ready", scope === "live");
  const contacts = useLiteContacts(status === "ready");
  const contactIndex = useLiteContactIndex(contacts.rows);

  const [filter, setFilter] = useState<Filter>("all");
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
    if (filter === "mine") {
      return conversations.rows.filter((row) => row.assigneeId === user?.uid);
    }
    if (filter === "unassigned") {
      return conversations.rows.filter((row) => !row.assigneeId);
    }
    return conversations.rows;
  }, [conversations.rows, filter, user?.uid]);

  const selected: LiteConversation | null =
    conversations.rows.find((row) => row.id === selectedId) ?? null;
  const messages = useLiteMessages(selected?.id ?? null);

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
    return contactIndex.get(conversation.contactId)?.displayLabel ?? "Visitor";
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      {/* ------------------------------------------------ conversation list */}
      <section className="rounded-2xl border border-blue-900/5 bg-white shadow-sm">
        <div className="flex items-center gap-1 border-b border-slate-100 px-3 pt-3">
          <button
            type="button"
            onClick={() => setScope("live")}
            className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
              scope === "live"
                ? "bg-[#1863DC] text-white"
                : "border border-slate-200 text-slate-500 hover:bg-blue-50"
            }`}
          >
            ● Live WhatsApp line
          </button>
          <button
            type="button"
            onClick={() => setScope("all")}
            className={`rounded-full px-3 py-1 text-[11px] font-medium transition ${
              scope === "all"
                ? "bg-slate-700 text-white"
                : "border border-slate-200 text-slate-400 hover:bg-slate-50"
            }`}
          >
            + Simulated
          </button>
        </div>
        <div className="flex items-center gap-1 border-b border-slate-100 p-3">
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
              onClick={() => setFilter(value)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                filter === value
                  ? "bg-[#1863DC] text-white"
                  : "text-slate-500 hover:bg-blue-50"
              }`}
            >
              {text}
            </button>
          ))}
          <span className="ml-auto pr-1 text-[10px] uppercase tracking-wide text-slate-400">
            {filtered.length} chats
          </span>
        </div>

        <div className="max-h-[70vh] overflow-y-auto">
          {conversations.loading ? (
            <p className="p-4 text-xs text-slate-400">Loading conversations…</p>
          ) : null}
          {conversations.error ? (
            <p className="p-4 text-xs text-rose-600">{conversations.error}</p>
          ) : null}
          {!conversations.loading && filtered.length === 0 ? (
            <p className="p-4 text-xs text-slate-400">
              {scope === "live"
                ? "No canary chats yet. Send a test message from an allowlisted phone to the configured line."
                : "No conversations here yet."}
            </p>
          ) : null}

          <ul>
            {filtered.map((conversation) => (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(conversation.id)}
                  className={`w-full border-b border-slate-50 px-4 py-3 text-left transition hover:bg-blue-50/50 ${
                    selectedId === conversation.id ? "bg-blue-50" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-800">
                      {label(conversation)}
                    </span>
                    {conversation.liveCanary ? (
                      <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-blue-700">
                        Live
                      </span>
                    ) : null}
                    <span className="ml-auto text-[10px] text-slate-400">
                      {timeAgo(conversation.lastMessageAtMs, nowMs)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                    <span>{PURPOSE_LABEL[conversation.purpose] ?? conversation.purpose}</span>
                    <span className="rounded bg-slate-100 px-1 text-[9px] font-semibold">
                      {LANGUAGE_LABEL[conversation.detectedLanguage] ?? conversation.detectedLanguage}
                    </span>
                    <span
                      className={`rounded px-1 text-[9px] font-semibold uppercase ${
                        conversation.mode === "human_takeover"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {conversation.mode === "human_takeover" ? "Human" : "Bot"}
                    </span>
                    {conversation.unreadCount > 0 ? (
                      <span className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#1863DC] px-1 text-[9px] font-bold text-white">
                        {conversation.unreadCount}
                      </span>
                    ) : null}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ------------------------------------------------ detail pane */}
      <section className="flex min-h-[70vh] flex-col rounded-2xl border border-blue-900/5 bg-white shadow-sm">
        {!selected ? (
          <div className="grid flex-1 place-items-center p-8 text-center">
            <div>
              <p className="text-sm font-medium text-slate-600">Pick a conversation</p>
              <p className="mt-1 text-xs text-slate-400">
                Live WhatsApp chats appear here in real time — claim one and reply.
              </p>
            </div>
          </div>
        ) : (
          <>
            <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{label(selected)}</p>
                <p className="text-[11px] text-slate-400">
                  {selected.liveCanary
                    ? "Allowlisted WhatsApp visitor · governed canary line"
                    : (contactIndex.get(selected.contactId)?.maskedPhone ?? "number withheld")}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Link
                  href={`/lite/contacts#${encodeURIComponent(selected.contactId)}`}
                  className="rounded-full border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                >
                  Open lead in CRM
                </Link>
                {selected.liveCanary ? (
                  <span
                    className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                      windowOpen
                        ? "bg-blue-100 text-blue-800"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {windowOpen ? "24h window open" : "Window closed"}
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">
                    Simulated chat
                  </span>
                )}
                {isMine ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void act("release")}
                    className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-rose-200 hover:text-rose-600 disabled:opacity-50"
                  >
                    {busy === "release" ? "Releasing…" : "Release"}
                  </button>
                ) : assignedToOther ? (
                  <span className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800">
                    Assigned to another agent
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void act("claim")}
                    className="rounded-full bg-[#1863DC] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0F56C4] disabled:opacity-50"
                  >
                    {busy === "claim" ? "Claiming…" : "Claim chat"}
                  </button>
                )}
              </div>
            </header>

            <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
              {messages.loading ? (
                <p className="text-xs text-slate-400">Loading timeline…</p>
              ) : null}
              {messages.error ? <p className="text-xs text-rose-600">{messages.error}</p> : null}
              {messages.rows.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[75%] rounded-2xl px-3 py-2 text-xs shadow-sm ${
                      message.direction === "outbound"
                        ? message.agentReply
                          ? "bg-[#1863DC] text-white"
                          : "bg-blue-50 text-blue-900"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    <p className="font-medium">
                      {message.direction === "inbound"
                        ? "Canary tester message"
                        : message.agentReply
                          ? "Agent reply (live)"
                          : "Bot reply"}
                    </p>
                    <p
                      className={`mt-0.5 text-[10px] ${
                        message.direction === "outbound" && message.agentReply
                          ? "text-blue-100"
                          : "text-slate-400"
                      }`}
                    >
                      {message.type} · {clock(message.createdAtMs)} · body never stored
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <footer className="border-t border-slate-100 p-3">
              {notice ? (
                <p className="mb-2 rounded-lg bg-blue-50 px-3 py-1.5 text-[11px] text-blue-800">
                  {notice}
                </p>
              ) : null}
              {canReply ? (
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    rows={2}
                    maxLength={1024}
                    placeholder="Type a live WhatsApp reply… (EN / සිංහල / தமிழ்)"
                    className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    disabled={busy !== null || draft.trim().length === 0}
                    onClick={() => void act("reply")}
                    className="rounded-xl bg-[#1863DC] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0F56C4] disabled:opacity-50"
                  >
                    {busy === "reply" ? "Sending…" : "Send"}
                  </button>
                </div>
              ) : (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                  {assignedToOther
                    ? "This chat is assigned to another agent. It must be released before you can claim and reply."
                    : !selected.liveCanary
                      ? "This is a simulated demo conversation — live replies work on governed WhatsApp canary chats."
                      : !windowOpen
                        ? "The 24h service window is closed — replies need an approved template until the visitor messages again."
                        : "Claim this chat to send a live WhatsApp reply."}
                </p>
              )}
              <p className="mt-2 text-[10px] text-slate-400">
                Governance: replies go only to allowlisted test numbers · message bodies are never
                stored (hash-only ledger).
              </p>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
