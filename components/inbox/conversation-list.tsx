import {
  AlertTriangle,
  Bot,
  FilterX,
  Search,
  UserRoundCheck,
} from "lucide-react";
import type {
  InboxConversationRecord,
  InboxLanguageFilter,
  InboxStatusFilter,
} from "./types";
import { metadataMessagePreview } from "./workspace-data";

const LANGUAGE_LABELS = {
  en: "English",
  si: "සිංහල",
  ta: "தமிழ்",
} as const;

const STATUS_STYLES = {
  active: "bg-emerald-50 text-emerald-700",
  waiting: "bg-amber-50 text-amber-700",
  assigned: "bg-cyan-50 text-cyan-700",
  escalated: "bg-red-50 text-red-700",
  resolved: "bg-slate-100 text-slate-600",
  reopened: "bg-violet-50 text-violet-700",
} as const;

function formatConversationTime(value: string): string {
  return new Intl.DateTimeFormat("en-LK", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Colombo",
  }).format(new Date(value));
}

function purposeLabel(value: InboxConversationRecord["conversation"]["purpose"]): string {
  return value.replaceAll("_", " ");
}

export function ConversationList({
  records,
  selectedId,
  search,
  status,
  language,
  safetyOnly,
  modeFor,
  onSearchChange,
  onStatusChange,
  onLanguageChange,
  onSafetyOnlyChange,
  onResetFilters,
  onSelect,
}: {
  records: readonly InboxConversationRecord[];
  selectedId: string | null;
  search: string;
  status: InboxStatusFilter;
  language: InboxLanguageFilter;
  safetyOnly: boolean;
  modeFor: (record: InboxConversationRecord) => InboxConversationRecord["conversation"]["mode"];
  onSearchChange: (value: string) => void;
  onStatusChange: (value: InboxStatusFilter) => void;
  onLanguageChange: (value: InboxLanguageFilter) => void;
  onSafetyOnlyChange: (value: boolean) => void;
  onResetFilters: () => void;
  onSelect: (record: InboxConversationRecord) => void;
}) {
  const filtersActive = Boolean(search) || status !== "all" || language !== "all" || safetyOnly;

  return (
    <section
      aria-label="Synthetic conversation list"
      className="flex min-h-[68dvh] min-w-0 flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_1px_2px_rgba(23,34,31,0.04)] md:h-full md:min-h-0"
    >
      <div className="border-b border-[var(--line)] p-3.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-bold text-slate-950">Conversations</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {records.length} synthetic {records.length === 1 ? "thread" : "threads"}
            </p>
          </div>
          {filtersActive ? (
            <button
              type="button"
              onClick={onResetFilters}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
            >
              <FilterX size={14} aria-hidden="true" /> Reset
            </button>
          ) : null}
        </div>

        <label className="relative mt-3 block">
          <span className="sr-only">Search persisted synthetic conversations</span>
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            type="search"
            placeholder="Search label, purpose or metadata"
            className="h-10 w-full rounded-xl border border-[var(--line)] bg-slate-50 pl-9 pr-3 text-xs text-slate-900 outline-none placeholder:text-slate-400 focus:border-[var(--brand)] focus:bg-white"
          />
        </label>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <label>
            <span className="sr-only">Filter by conversation status</span>
            <select
              value={status}
              onChange={(event) => onStatusChange(event.target.value as InboxStatusFilter)}
              className="h-9 w-full rounded-lg border border-[var(--line)] bg-white px-2 text-[11px] font-medium text-slate-700 outline-none focus:border-[var(--brand)]"
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="assigned">Assigned</option>
              <option value="escalated">Escalated</option>
              <option value="waiting">Waiting</option>
              <option value="resolved">Resolved</option>
              <option value="reopened">Reopened</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Filter by language</span>
            <select
              value={language}
              onChange={(event) => onLanguageChange(event.target.value as InboxLanguageFilter)}
              className="h-9 w-full rounded-lg border border-[var(--line)] bg-white px-2 text-[11px] font-medium text-slate-700 outline-none focus:border-[var(--brand)]"
            >
              <option value="all">All languages</option>
              <option value="en">English</option>
              <option value="si">සිංහල</option>
              <option value="ta">தமிழ்</option>
            </select>
          </label>
        </div>

        <label className="mt-2 flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
          <input
            type="checkbox"
            checked={safetyOnly}
            onChange={(event) => onSafetyOnlyChange(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 accent-red-600"
          />
          <AlertTriangle size={14} className="text-red-600" aria-hidden="true" />
          Safety escalations only
        </label>
      </div>

      <div className="scrollbar-subtle flex-1 overflow-y-auto" aria-live="polite">
        {records.length === 0 ? (
          <div className="grid min-h-72 place-items-center p-6 text-center">
            <div>
              <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-500">
                <Search size={19} aria-hidden="true" />
              </span>
              <h3 className="mt-3 text-sm font-bold text-slate-900">No matching conversations</h3>
              <p className="mt-1 max-w-[230px] text-xs leading-5 text-slate-500">
                No persisted synthetic record matches these filters. Reset them to return to the scoped inbox.
              </p>
              <button
                type="button"
                onClick={onResetFilters}
                className="mt-4 h-9 rounded-lg border border-[var(--line)] px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Reset filters
              </button>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {records.map((record) => {
              const { conversation, contact, messages } = record;
              const selected = selectedId === conversation.id;
              const urgent = conversation.purpose === "urgent_escalation" || conversation.mode === "safety_hold";
              const mode = modeFor(record);
              const preview = messages.at(-1)
                ? metadataMessagePreview(messages.at(-1)!)
                : "No message metadata stored for this conversation";

              return (
                <li key={conversation.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(record)}
                    aria-pressed={selected}
                    className={`relative w-full px-3.5 py-3 text-left transition ${
                      selected ? "bg-[var(--brand-soft)]" : "hover:bg-slate-50"
                    }`}
                  >
                    {urgent ? <span className="absolute inset-y-0 left-0 w-1 bg-red-500" aria-hidden="true" /> : null}
                    <span className="flex items-start gap-3">
                      <span
                        className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-bold ${
                          urgent ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700"
                        }`}
                        aria-hidden="true"
                      >
                        {contact.displayLabel.slice(-1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className="truncate text-[13px] font-bold text-slate-900">{contact.displayLabel}</span>
                          <span className="shrink-0 text-[10px] font-medium text-slate-400">
                            {formatConversationTime(conversation.lastMessageAt)}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-slate-500">{preview}</span>
                        <span className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold capitalize ${STATUS_STYLES[conversation.status]}`}>
                            {conversation.status}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold text-slate-600">
                            {LANGUAGE_LABELS[conversation.detectedLanguage]}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[9px] font-semibold capitalize text-slate-500">
                            {mode === "human_takeover" ? (
                              <UserRoundCheck size={11} aria-hidden="true" />
                            ) : (
                              <Bot size={11} aria-hidden="true" />
                            )}
                            {purposeLabel(conversation.purpose)}
                          </span>
                          {conversation.unreadCount > 0 ? (
                            <span className="ml-auto grid min-h-5 min-w-5 place-items-center rounded-full bg-[var(--brand)] px-1 text-[9px] font-bold text-white">
                              {conversation.unreadCount}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
