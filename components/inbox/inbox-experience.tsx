"use client";

import { CLOUD_DEMO_STAGE, DATA_SOURCE, DATA_SOURCE_SHORT } from "@/lib/firebase/boundary-copy";
import {
  AlertTriangle,
  Bot,
  Database,
  FlaskConical,
  Inbox,
  LoaderCircle,
  MessageSquareOff,
  RefreshCw,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useWorkspaceSession } from "@/components/auth/workspace-session";
import type { VerifiedWorkspaceSession } from "@/lib/firebase/workspace-session-model";
import { ContextPanel } from "./context-panel";
import { ConversationList } from "./conversation-list";
import { ThreadPanel } from "./thread-panel";
import type {
  ConversationModeOverrides,
  InboxConversationRecord,
  InboxLanguageFilter,
  InboxStatusFilter,
  LocalTimelineEvent,
} from "./types";
import { useInboxWorkspace } from "./use-inbox-workspace";
import { filterInboxRecords } from "./workspace-data";

function WorkspaceLoadCard({
  kind,
  message,
  onRetry,
}: {
  kind: "loading" | "error" | "empty" | "scope";
  message: string;
  onRetry: () => void;
}) {
  const loading = kind === "loading";
  return (
    <section
      className="grid min-h-[58dvh] place-items-center rounded-2xl border border-[var(--line)] bg-white p-6 text-center shadow-[0_1px_2px_rgba(23,34,31,0.04)]"
      aria-live="polite"
      aria-busy={loading}
    >
      <div className="max-w-md">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">
          {loading ? (
            <LoaderCircle size={22} className="animate-spin" aria-hidden="true" />
          ) : kind === "error" ? (
            <AlertTriangle size={22} aria-hidden="true" />
          ) : (
            <Database size={22} aria-hidden="true" />
          )}
        </span>
        <h2 className="mt-4 text-base font-bold text-slate-950">
          {loading
            ? "Loading persisted synthetic inbox"
            : kind === "error"
              ? "Inbox remained closed"
              : kind === "scope"
                ? "No patient-record scope"
                : "No persisted conversations"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{message}</p>
        {!loading ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--line)] px-4 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw size={14} aria-hidden="true" /> Retry local Firestore
          </button>
        ) : null}
      </div>
    </section>
  );
}

function VerifiedInboxExperience({ session }: { session: VerifiedWorkspaceSession }) {
  const workspace = useInboxWorkspace({
    workspaceId: session.workspaceId,
    role: session.role,
    scopeMode: session.scopeMode,
    teamIds: session.teamIds,
    locationIds: session.locationIds,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<InboxStatusFilter>("all");
  const [language, setLanguage] = useState<InboxLanguageFilter>("all");
  const [safetyOnly, setSafetyOnly] = useState(false);
  const [modeOverrides, setModeOverrides] = useState<ConversationModeOverrides>({});
  const [localEvents, setLocalEvents] = useState<readonly LocalTimelineEvent[]>([]);
  const [activityAnnouncement, setActivityAnnouncement] = useState("");
  const records = workspace.records;

  const selectedRecord =
    records.find((record) => record.conversation.id === selectedId) ?? records[0] ?? null;

  function modeFor(record: InboxConversationRecord): InboxConversationRecord["conversation"]["mode"] {
    return modeOverrides[record.conversation.id] ?? record.conversation.mode;
  }

  const filteredRecords = useMemo(
    () => filterInboxRecords(records, { search, status, language, safetyOnly }),
    [language, records, safetyOnly, search, status],
  );
  const selectedMode = selectedRecord ? modeFor(selectedRecord) : "automation";
  const selectedEvents = selectedRecord
    ? localEvents.filter((event) => event.conversationId === selectedRecord.conversation.id)
    : [];
  const urgentCount = records.filter(
    (record) =>
      record.conversation.purpose === "urgent_escalation" ||
      record.conversation.mode === "safety_hold",
  ).length;
  const humanCount = records.filter((record) => modeFor(record) === "human_takeover").length;

  function selectRecord(record: InboxConversationRecord) {
    setSelectedId(record.conversation.id);
    setMobileThreadOpen(true);
    setActivityAnnouncement(`Opened synthetic conversation for ${record.contact.displayLabel}.`);
  }

  function appendSystemEvent(preview: string) {
    if (!selectedRecord) return;
    const nextIndex = localEvents.length + 1;
    setLocalEvents((current) => [
      ...current,
      {
        id: `local-system-${selectedRecord.conversation.id}-${nextIndex}`,
        conversationId: selectedRecord.conversation.id,
        kind: "system",
        preview,
        occurredAt: new Date().toISOString(),
      },
    ]);
  }

  function takeOver() {
    if (!selectedRecord) return;
    setModeOverrides((current) => ({
      ...current,
      [selectedRecord.conversation.id]: "human_takeover",
    }));
    appendSystemEvent("Local human-takeover simulation started. Automation is paused in this page only");
    setActivityAnnouncement("Local human-takeover simulation started. No external request was made.");
  }

  function resumeAutomation() {
    if (!selectedRecord) return;
    setModeOverrides((current) => ({
      ...current,
      [selectedRecord.conversation.id]: "automation",
    }));
    appendSystemEvent("Local automation simulation resumed. No external workflow was started");
    setActivityAnnouncement("Local automation simulation resumed. No external request was made.");
  }

  function addSimulatedReply(preview: string) {
    if (!selectedRecord) return;
    const nextIndex = localEvents.length + 1;
    setLocalEvents((current) => [
      ...current,
      {
        id: `local-reply-${selectedRecord.conversation.id}-${nextIndex}`,
        conversationId: selectedRecord.conversation.id,
        kind: "simulated_reply",
        preview,
        occurredAt: new Date().toISOString(),
      },
    ]);
    setActivityAnnouncement("Simulated reply added locally. Nothing was sent or saved to Firebase.");
  }

  function resetFilters() {
    setSearch("");
    setStatus("all");
    setLanguage("all");
    setSafetyOnly(false);
  }

  return (
    <div className="space-y-4 lg:space-y-5">
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
            <Inbox size={21} aria-hidden="true" />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--brand)]">Patient operations</p>
            <h1 className="mt-1 text-2xl font-bold tracking-[-0.035em] text-slate-950 sm:text-3xl">Shared inbox</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              Read tenant-scoped synthetic conversations, consent evidence and body-free message metadata from {DATA_SOURCE}.
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-2 xl:min-w-[390px]">
          <div className="rounded-xl border border-[var(--line)] bg-white px-3 py-2.5">
            <dt className="text-[9px] font-bold uppercase tracking-[0.06em] text-slate-400">Threads</dt>
            <dd className="mt-1 text-lg font-bold text-slate-900">{workspace.status === "ready" ? records.length : "—"}</dd>
          </div>
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
            <dt className="text-[9px] font-bold uppercase tracking-[0.06em] text-red-500">Safety</dt>
            <dd className="mt-1 text-lg font-bold text-red-800">{workspace.status === "ready" ? urgentCount : "—"}</dd>
          </div>
          <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2.5">
            <dt className="text-[9px] font-bold uppercase tracking-[0.06em] text-cyan-600">Human</dt>
            <dd className="mt-1 text-lg font-bold text-cyan-900">{workspace.status === "ready" ? humanCount : "—"}</dd>
          </div>
        </dl>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center" role="status">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-800">
          <FlaskConical size={17} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-amber-950">{CLOUD_DEMO_STAGE ? "Governed cloud read model — controls remain temporary" : "Local persisted read model — controls remain temporary"}</p>
          <p className="mt-0.5 text-[11px] leading-5 text-amber-800">
            Reads come only from the authenticated {DATA_SOURCE_SHORT}. Takeover, resume and reply controls make no Firebase write, Meta call or Hemas-system request.
            {CLOUD_DEMO_STAGE ? " Live WhatsApp conversations are handled in the Lite workspace." : ""}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-amber-300 bg-white px-3 py-1.5 text-[10px] font-bold text-amber-800 sm:self-auto">
          <MessageSquareOff size={12} aria-hidden="true" /> External sending unavailable
        </span>
      </section>

      <div className="sr-only" aria-live="polite" aria-atomic="true">{activityAnnouncement}</div>

      {workspace.status === "ready" && workspace.excluded > 0 ? (
        <p className="rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 text-[11px] leading-5 text-[var(--muted)]" role="note">
          {workspace.excluded} record{workspace.excluded === 1 ? "" : "s"} from another lane (live WhatsApp canary) {workspace.excluded === 1 ? "was" : "were"} not shown here.
          {CLOUD_DEMO_STAGE ? " Open the Lite workspace inbox to work those conversations." : ""}
        </p>
      ) : null}

      {workspace.status === "loading" ? (
        <WorkspaceLoadCard
          kind="loading"
          message={`Verifying the tenant and loading bounded queries from ${DATA_SOURCE}. No fixture fallback is used.`}
          onRetry={workspace.retry}
        />
      ) : workspace.status === "error" ? (
        <WorkspaceLoadCard kind="error" message={workspace.message} onRetry={workspace.retry} />
      ) : workspace.scopePlan.kind === "denied" ? (
        <WorkspaceLoadCard
          kind="scope"
          message="This verified role has no valid active team-and-location pair for patient records. No broad query was attempted."
          onRetry={workspace.retry}
        />
      ) : records.length === 0 ? (
        <WorkspaceLoadCard
          kind="empty"
          message={`The authenticated, tenant-scoped query completed successfully but returned no synthetic conversations.${workspace.status === "ready" && workspace.excluded > 0 ? ` ${workspace.excluded} live-canary record${workspace.excluded === 1 ? "" : "s"} belong to the Lite workspace.` : ""}`}
          onRetry={workspace.retry}
        />
      ) : (
        <>
          <div className="grid gap-3 md:h-[calc(100dvh-18.5rem)] md:min-h-[650px] md:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[320px_minmax(0,1fr)_292px]">
            <div className={`min-h-0 min-w-0 md:h-full ${mobileThreadOpen ? "hidden md:block" : "block"}`}>
              <ConversationList
                records={filteredRecords}
                selectedId={selectedRecord?.conversation.id ?? null}
                search={search}
                status={status}
                language={language}
                safetyOnly={safetyOnly}
                modeFor={modeFor}
                onSearchChange={setSearch}
                onStatusChange={setStatus}
                onLanguageChange={setLanguage}
                onSafetyOnlyChange={setSafetyOnly}
                onResetFilters={resetFilters}
                onSelect={selectRecord}
              />
            </div>

            <div className={!mobileThreadOpen ? "hidden min-h-0 min-w-0 md:block md:h-full" : "min-h-0 min-w-0 md:h-full"}>
              {selectedRecord ? (
                <ThreadPanel
                  key={selectedRecord.conversation.id}
                  record={selectedRecord}
                  mode={selectedMode}
                  localEvents={selectedEvents}
                  compactContext={<ContextPanel record={selectedRecord} compact />}
                  onBack={() => setMobileThreadOpen(false)}
                  onTakeOver={takeOver}
                  onResumeAutomation={resumeAutomation}
                  onAddSimulatedReply={addSimulatedReply}
                />
              ) : (
                <section className="grid h-full min-h-[60dvh] place-items-center rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
                  <div>
                    <Inbox size={26} className="mx-auto text-slate-400" aria-hidden="true" />
                    <h2 className="mt-3 text-sm font-bold text-slate-900">Select a synthetic conversation</h2>
                    <p className="mt-1 text-xs text-slate-500">Choose a persisted record from the list to inspect its metadata timeline.</p>
                  </div>
                </section>
              )}
            </div>

            <div className="hidden min-h-0 min-w-0 2xl:block 2xl:h-full">
              {selectedRecord ? <ContextPanel record={selectedRecord} /> : null}
            </div>
          </div>

          <section className="grid gap-2 text-[10px] text-slate-600 sm:grid-cols-3" aria-label="Inbox demo guardrails">
            <span className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5">
              <ShieldCheck size={14} className="text-emerald-700" aria-hidden="true" /> Persisted consent evidence visible
            </span>
            <span className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5">
              <AlertTriangle size={14} className="text-red-600" aria-hidden="true" /> Urgent language stops automation
            </span>
            <span className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5">
              {humanCount > 0 ? <UserRoundCheck size={14} className="text-cyan-700" aria-hidden="true" /> : <Bot size={14} className="text-cyan-700" aria-hidden="true" />}
              Human takeover is local and reversible
            </span>
          </section>
        </>
      )}
    </div>
  );
}

export function InboxExperience() {
  const workspace = useWorkspaceSession();
  if (workspace.status !== "verified" || !workspace.session) {
    return (
      <WorkspaceLoadCard
        kind="loading"
        message="Waiting for the authenticated workspace session before any inbox query is allowed."
        onRetry={() => undefined}
      />
    );
  }
  return <VerifiedInboxExperience session={workspace.session} />;
}
