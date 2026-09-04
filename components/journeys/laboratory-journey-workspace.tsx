"use client";

import {
  AlertTriangle,
  Ban,
  BellRing,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  DatabaseZap,
  FileLock2,
  Home,
  KeyRound,
  MapPin,
  PackageCheck,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  Truck,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useWorkspaceSession } from "@/components/auth/workspace-session";
import { StatusPill } from "@/components/ui/status-pill";
import {
  JourneyTimeline,
  SafeEmptyState,
  type JourneyEvent,
} from "./journey-shared";
import type {
  LaboratoryEventView,
  LaboratoryHandoffState,
  LaboratoryWorkflowView,
} from "./laboratory-workspace-data";
import { useLaboratoryWorkspace } from "./use-laboratory-workspace";
import { DATA_SOURCE_SHORT, READS_LABEL } from "@/lib/firebase/boundary-copy";

type LabTab = "collection" | "report-ready";
type CollectionStatus = "requested" | "scheduled" | "collected" | "cancelled";

type HomeCollection = {
  readonly reference: string;
  readonly zone: string;
  readonly date: string;
  readonly window: string;
  readonly accessOption: string;
  readonly status: CollectionStatus;
};

type PillTone = "info" | "success" | "neutral" | "warning";

const COLLECTION_ZONES = [
  "Synthetic Colombo zone",
  "Synthetic Gampaha zone",
  "Synthetic nationwide lab zone",
] as const;

const COLLECTION_WINDOWS = ["08:00–10:00", "10:00–12:00", "14:00–16:00"] as const;

const collectionPresentation: Record<
  CollectionStatus,
  { readonly label: string; readonly tone: PillTone }
> = {
  requested: { label: "Request created locally", tone: "info" },
  scheduled: { label: "Scheduled locally", tone: "success" },
  collected: { label: "Collection event simulated", tone: "success" },
  cancelled: { label: "Cancelled locally", tone: "neutral" },
};

const workflowPresentation: Record<
  LaboratoryWorkflowView["workflowStatus"],
  { readonly label: string; readonly tone: PillTone }
> = {
  registered: { label: "Registered in simulator", tone: "neutral" },
  processing: { label: "Processing in simulator", tone: "info" },
  ready: { label: "Ready in simulator", tone: "success" },
  notification_queued: { label: "Notification queued in simulator", tone: "warning" },
  notification_simulated: { label: "Notification simulated", tone: "success" },
  notification_sent: { label: "Simulator delivery state recorded", tone: "success" },
  accessed: { label: "Simulator access recorded", tone: "success" },
  expired: { label: "Simulator handoff expired", tone: "neutral" },
  superseded: { label: "Superseded in simulator", tone: "neutral" },
};

const eventPresentation: Record<
  LaboratoryEventView["eventType"],
  { readonly title: string; readonly tone: PillTone }
> = {
  simulator_report_ready: { title: "Simulator marked workflow ready", tone: "success" },
  notification_queued: { title: "Notification queued by simulator", tone: "warning" },
  notification_simulated: { title: "Notification event simulated", tone: "success" },
  secure_accessed: { title: "Simulator access event recorded", tone: "success" },
  secure_access_expired: { title: "Simulator handoff expiry recorded", tone: "neutral" },
};

function eventTime(): string {
  return new Intl.DateTimeFormat("en-LK", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Colombo",
  }).format(new Date());
}

function displayDate(value: string | null): string {
  if (!value) return "Not recorded";
  const parsed = new Date(value.includes("T") ? value : `${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-LK", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: value.includes("T") ? "2-digit" : undefined,
    minute: value.includes("T") ? "2-digit" : undefined,
    timeZone: value.includes("T") ? "Asia/Colombo" : "UTC",
  }).format(parsed);
}

function workflowLabel(status: LaboratoryWorkflowView["workflowStatus"] | null): string {
  return status ? workflowPresentation[status].label : "Initial state";
}

function eventDetail(event: LaboratoryEventView): string {
  return `${workflowLabel(event.fromStatus)} → ${workflowLabel(event.toStatus)} · immutable backend event`;
}

function handoffPresentation(
  state: LaboratoryHandoffState,
  expiresAt: string | null,
): { readonly label: string; readonly detail: string; readonly tone: PillTone } {
  if (state === "available") {
    return {
      label: "Available in local simulator",
      detail: `Expires ${displayDate(expiresAt)}`,
      tone: "success",
    };
  }
  if (state === "expired") {
    return {
      label: "Expired simulator handoff",
      detail: `Expired ${displayDate(expiresAt)}`,
      tone: "neutral",
    };
  }
  return {
    label: "Not available",
    detail: "No handoff route or credential is exposed",
    tone: "neutral",
  };
}

function TabButton({
  active,
  id,
  controls,
  icon: Icon,
  children,
  onClick,
}: {
  active: boolean;
  id: string;
  controls: string;
  icon: typeof Home;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-controls={controls}
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-xs font-bold transition sm:flex-none sm:px-4 ${
        active
          ? "bg-[var(--brand)] text-white shadow-sm"
          : "text-slate-600 hover:bg-white hover:text-slate-950"
      }`}
    >
      <Icon size={16} aria-hidden="true" /> {children}
    </button>
  );
}

function PersistedWorkflowCard({
  record,
  position,
}: {
  record: LaboratoryWorkflowView;
  position: number;
}) {
  const status = workflowPresentation[record.workflowStatus];
  const handoff = handoffPresentation(record.handoff.state, record.handoff.expiresAt);
  const facts = [
    {
      label: "Simulator workflow",
      value: status.label,
      detail: "Backend-owned read-only state",
      icon: FlaskStatusIcon,
    },
    {
      label: "Collection metadata",
      value: displayDate(record.collectedAt),
      detail: "Timestamp only",
      icon: PackageCheck,
    },
    {
      label: "Ready metadata",
      value: displayDate(record.readyAt),
      detail: "Simulator timestamp only",
      icon: CheckCircle2,
    },
    {
      label: "Notification metadata",
      value: displayDate(record.lastNotificationAt),
      detail: "No message body or delivery claim",
      icon: BellRing,
    },
    {
      label: "Simulator handoff",
      value: handoff.label,
      detail: handoff.detail,
      icon: KeyRound,
    },
    {
      label: "Last metadata update",
      value: displayDate(record.updatedAt),
      detail: `${DATA_SOURCE_SHORT} evidence`,
      icon: Clock3,
    },
  ] as const;

  return (
    <article className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_1px_2px_rgba(23,34,31,0.03)]">
      <div className="flex flex-col gap-4 border-b border-[var(--line)] p-4 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
            <FileLock2 size={20} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-slate-950">
                Laboratory workflow {position}
              </h2>
              <StatusPill tone={status.tone}>{status.label}</StatusPill>
            </div>
            <p className="mt-1.5 text-xs leading-5 text-slate-500">
              {record.teamName} · {record.locationName} · synthetic routing labels only
            </p>
          </div>
        </div>
        <StatusPill tone="neutral">Read-only · backend-owned</StatusPill>
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-3">
        {facts.map(({ label, value, detail, icon: Icon }) => (
          <div key={label} className="rounded-xl bg-slate-50 p-3">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-slate-500">
              <Icon size={13} aria-hidden="true" /> {label}
            </span>
            <p className="mt-2 text-sm font-bold leading-5 text-slate-900">{value}</p>
            <p className="mt-1 text-[10px] leading-4 text-slate-500">{detail}</p>
          </div>
        ))}
      </div>

      <section className="border-t border-[var(--line)] p-4 sm:p-6" aria-label={`Immutable event history for laboratory workflow ${position}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-950">Immutable workflow events</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Newest first · metadata only · event fingerprints and subject identifiers hidden
            </p>
          </div>
          <StatusPill tone="neutral">{record.events.length} persisted</StatusPill>
        </div>
        {record.events.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-xs leading-5 text-slate-600">
            No immutable events were returned within this workflow scope.
          </p>
        ) : (
          <ol className="mt-4 space-y-2.5">
            {record.events.map((event) => {
              const presentation = eventPresentation[event.eventType];
              return (
                <li key={event.key} className="flex gap-3 rounded-xl bg-slate-50 p-3">
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                    <CheckCircle2 size={15} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                      <p className="text-xs font-bold text-slate-900">{presentation.title}</p>
                      <time className="shrink-0 text-[10px] font-semibold text-slate-500">
                        {displayDate(event.occurredAt)}
                      </time>
                    </div>
                    <p className="mt-1 text-[11px] leading-5 text-slate-600">
                      {eventDetail(event)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </article>
  );
}

function FlaskStatusIcon({ size, ...props }: React.ComponentProps<typeof FileLock2>) {
  return <DatabaseZap size={size} {...props} />;
}

export function LaboratoryJourneyWorkspace() {
  const workspace = useWorkspaceSession();
  const verifiedSession = workspace.status === "verified" ? workspace.session : null;
  const laboratory = useLaboratoryWorkspace(verifiedSession);
  const [activeTab, setActiveTab] = useState<LabTab>("collection");
  const [collectionDate, setCollectionDate] = useState("2026-08-10");
  const [collectionWindow, setCollectionWindow] = useState<string>(COLLECTION_WINDOWS[0]);
  const [collectionZone, setCollectionZone] = useState<string>(COLLECTION_ZONES[0]);
  const [accessOption, setAccessOption] = useState("Synthetic reception handoff");
  const [collection, setCollection] = useState<HomeCollection | null>(null);
  const [adapterUnavailable, setAdapterUnavailable] = useState(false);
  const [feedback, setFeedback] = useState(
    "Ready for a page-local home-collection simulation.",
  );
  const [events, setEvents] = useState<JourneyEvent[]>([]);
  const [nextEventId, setNextEventId] = useState(1);

  const collectionStatus = collection ? collectionPresentation[collection.status] : null;
  const readyLaboratory = laboratory.status === "ready" ? laboratory : null;
  const reportMetric =
    laboratory.status === "loading" || laboratory.status === "idle"
      ? "Loading"
      : laboratory.status === "error"
        ? "Unavailable"
        : readyLaboratory?.scopePlan.kind === "denied"
          ? "No permitted scope"
          : `${readyLaboratory?.records.length ?? 0} persisted`;

  function addEvent(title: string, detail: string, tone: JourneyEvent["tone"] = "info") {
    setEvents((current) => [
      { id: nextEventId, title, detail, time: eventTime(), tone },
      ...current,
    ]);
    setNextEventId((value) => value + 1);
  }

  function blockForAdapter(action: string): boolean {
    if (!adapterUnavailable) return false;
    setFeedback(
      `${action} blocked because the page-local simulator is unavailable. No external state was assumed.`,
    );
    return true;
  }

  function createCollectionRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blockForAdapter("Collection request")) return;
    if (!collectionDate || !collectionWindow || !collectionZone) {
      setFeedback("Choose a synthetic date, time window, and zone before continuing.");
      return;
    }
    const reference = `SYN-HC-${collectionDate.replaceAll("-", "")}-${collectionWindow.slice(0, 2)}`;
    setCollection({
      reference,
      zone: collectionZone,
      date: collectionDate,
      window: collectionWindow,
      accessOption,
      status: "requested",
    });
    setFeedback(
      "Home-collection request created only in this page's memory. It is not scheduled in LIMS or dispatch.",
    );
    addEvent("Home collection requested", `${reference} · no LIMS or dispatch write`, "info");
  }

  function scheduleCollection() {
    if (!collection || blockForAdapter("Collection scheduling")) return;
    setCollection({ ...collection, status: "scheduled" });
    setFeedback(
      "Collection scheduled only in page memory. No phlebotomist, route, or notification was assigned.",
    );
    addEvent(
      "Collection scheduled locally",
      `${collection.date} · ${collection.window} · zero dispatch calls`,
      "success",
    );
  }

  function markCollected() {
    if (
      !collection ||
      collection.status !== "scheduled" ||
      blockForAdapter("Collection event")
    ) {
      return;
    }
    setCollection({ ...collection, status: "collected" });
    setFeedback(
      "Collection event simulated in page memory. No specimen, test order, or clinical record was created.",
    );
    addEvent(
      "Collection event simulated",
      "Operational page state only · no specimen or clinical data",
      "success",
    );
  }

  function cancelCollection() {
    if (!collection) return;
    setCollection({ ...collection, status: "cancelled" });
    setFeedback("Home-collection request cancelled in page memory. No external cleanup was required.");
    addEvent("Collection cancelled locally", "External systems remained unchanged", "neutral");
  }

  function clearCollection() {
    setCollection(null);
    setFeedback("Home-collection journey cleared from page memory.");
  }

  function clearLocalSimulation() {
    setCollection(null);
    setEvents([]);
    setAdapterUnavailable(false);
    setFeedback(
      "Page-local collection state cleared. Persisted read-only laboratory metadata was untouched.",
    );
  }

  return (
    <div className="space-y-6 lg:space-y-8">
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <StatusPill tone="success" dot>
              {READS_LABEL.charAt(0).toUpperCase() + READS_LABEL.slice(1)}
            </StatusPill>
            <StatusPill tone="warning" dot>
              No LIMS or messaging connection
            </StatusPill>
          </div>
          <h1 className="text-2xl font-bold tracking-[-0.035em] text-slate-950 sm:text-3xl">
            Laboratory journey workspace
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            Review tenant-scoped simulator workflow metadata and immutable events, or run a
            separate page-local home-collection demonstration.
          </p>
        </div>
        <button
          type="button"
          onClick={clearLocalSimulation}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <RotateCcw size={16} aria-hidden="true" /> Clear local simulation
        </button>
      </section>

      <section
        className="overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-emerald-50 shadow-[0_1px_2px_rgba(23,34,31,0.03)]"
        aria-labelledby="laboratory-data-boundary-title"
      >
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-800">
              <DatabaseZap size={20} aria-hidden="true" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id="laboratory-data-boundary-title"
                  className="text-sm font-bold text-slate-950 sm:text-[15px]"
                >
                  Clinical data boundary enforced
                </h2>
                <StatusPill tone="warning" dot>
                  Minimized metadata only
                </StatusPill>
              </div>
              <p className="mt-1.5 max-w-4xl text-xs leading-5 text-slate-600 sm:text-sm sm:leading-6">
                The page reads only minimized simulator workflow output. It never displays test
                values, report bodies, diagnosis, interpretation, attachments, credentials,
                protected handoff references, external report identifiers, or patient identifiers.
              </p>
            </div>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-2 text-center text-[10px] font-bold uppercase tracking-[0.06em] sm:flex">
            <span className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-emerald-800">
              Provider calls · 0
            </span>
            <span className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-amber-800">
              Page writes · 0
            </span>
          </div>
        </div>
      </section>

      <section
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Laboratory journey status"
      >
        {[
          {
            label: "Home collection",
            value: collectionStatus?.label ?? "Not started",
            detail: "Page-local logistics state",
            icon: Truck,
          },
          {
            label: "Report workflows",
            value: reportMetric,
            detail: "Backend-owned Firestore metadata",
            icon: FileLock2,
          },
          {
            label: "Clinical payloads",
            value: "0 rendered",
            detail: "Values, files, diagnosis, interpretation",
            icon: ShieldCheck,
          },
          {
            label: "External provider calls",
            value: "0",
            detail: "No LIMS, Meta, SMS, email, or report portal",
            icon: Ban,
          },
        ].map(({ label, value, detail, icon: Icon }) => (
          <article
            key={label}
            className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[var(--muted)]">{label}</p>
                <p
                  className="mt-2 truncate text-lg font-bold tracking-[-0.025em] text-slate-950"
                  title={value}
                >
                  {value}
                </p>
              </div>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                <Icon size={17} aria-hidden="true" />
              </span>
            </div>
            <p className="mt-3 text-[11px] leading-5 text-slate-500">{detail}</p>
          </article>
        ))}
      </section>

      <div
        className="flex rounded-2xl border border-[var(--line)] bg-slate-100 p-1.5"
        role="tablist"
        aria-label="Laboratory journey type"
      >
        <TabButton
          active={activeTab === "collection"}
          id="collection-tab"
          controls="collection-panel"
          icon={Home}
          onClick={() => setActiveTab("collection")}
        >
          Home collection
        </TabButton>
        <TabButton
          active={activeTab === "report-ready"}
          id="report-ready-tab"
          controls="report-ready-panel"
          icon={FileLock2}
          onClick={() => setActiveTab("report-ready")}
        >
          Report workflow metadata
        </TabButton>
      </div>

      <p className="sr-only" aria-live="polite">
        {feedback}
      </p>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(330px,0.75fr)]">
        <div className="space-y-6">
          {activeTab === "collection" ? (
            <div
              id="collection-panel"
              role="tabpanel"
              aria-labelledby="collection-tab"
              className="space-y-6"
            >
              {!collection ? (
                <article className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-6">
                  <div className="flex items-start gap-3 border-b border-[var(--line)] pb-5">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                      <Truck size={20} aria-hidden="true" />
                    </span>
                    <div>
                      <h2 className="text-lg font-bold tracking-[-0.02em] text-slate-950">
                        Request a page-local synthetic collection
                      </h2>
                      <p className="mt-1.5 text-sm leading-6 text-[var(--muted)]">
                        Browser memory only. No test order, specimen, patient address, payment,
                        LIMS record, or dispatch request is created.
                      </p>
                    </div>
                  </div>

                  <form onSubmit={createCollectionRequest} className="mt-5 space-y-5">
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="block text-xs font-bold text-slate-700">
                        Synthetic service zone
                        <span className="relative mt-2 block">
                          <MapPin
                            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                            size={15}
                            aria-hidden="true"
                          />
                          <select
                            value={collectionZone}
                            onChange={(event) => setCollectionZone(event.target.value)}
                            className="h-11 w-full appearance-none rounded-xl border border-[var(--line)] bg-white pl-9 pr-8 text-sm font-medium text-slate-800 outline-none focus:border-[var(--brand)]"
                          >
                            {COLLECTION_ZONES.map((zone) => (
                              <option key={zone}>{zone}</option>
                            ))}
                          </select>
                        </span>
                      </label>
                      <label className="block text-xs font-bold text-slate-700">
                        Mock collection date
                        <input
                          type="date"
                          required
                          value={collectionDate}
                          onChange={(event) => setCollectionDate(event.target.value)}
                          className="mt-2 h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3 text-sm font-medium text-slate-800 outline-none focus:border-[var(--brand)]"
                        />
                      </label>
                      <label className="block text-xs font-bold text-slate-700">
                        Generated time window
                        <span className="relative mt-2 block">
                          <Clock3
                            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                            size={15}
                            aria-hidden="true"
                          />
                          <select
                            value={collectionWindow}
                            onChange={(event) => setCollectionWindow(event.target.value)}
                            className="h-11 w-full appearance-none rounded-xl border border-[var(--line)] bg-white pl-9 pr-8 text-sm font-medium text-slate-800 outline-none focus:border-[var(--brand)]"
                          >
                            {COLLECTION_WINDOWS.map((window) => (
                              <option key={window}>{window} · Asia/Colombo</option>
                            ))}
                          </select>
                        </span>
                      </label>
                      <label className="block text-xs font-bold text-slate-700">
                        Access note preset
                        <select
                          value={accessOption}
                          onChange={(event) => setAccessOption(event.target.value)}
                          className="mt-2 h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3 text-sm font-medium text-slate-800 outline-none focus:border-[var(--brand)]"
                        >
                          <option>Synthetic reception handoff</option>
                          <option>Synthetic call-on-arrival</option>
                          <option>No access note</option>
                        </select>
                      </label>
                    </div>

                    {adapterUnavailable ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4" role="alert">
                        <div className="flex items-start gap-3">
                          <AlertTriangle
                            className="mt-0.5 shrink-0 text-amber-700"
                            size={18}
                            aria-hidden="true"
                          />
                          <div>
                            <p className="text-sm font-bold text-amber-950">
                              Page-local simulator unavailable
                            </p>
                            <p className="mt-1 text-xs leading-5 text-amber-800">
                              Local request creation is blocked. No availability, assignment, or
                              external state is assumed.
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div className="flex flex-col gap-3 rounded-xl bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs leading-5 text-slate-600" aria-live="polite">
                        {feedback}
                      </p>
                      <button
                        type="submit"
                        disabled={adapterUnavailable}
                        className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 text-sm font-semibold text-white hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        <Home size={16} aria-hidden="true" /> Create local request
                      </button>
                    </div>
                  </form>
                </article>
              ) : (
                <article className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_1px_2px_rgba(23,34,31,0.03)]">
                  <div className="flex flex-col gap-4 border-b border-[var(--line)] p-4 sm:flex-row sm:items-start sm:justify-between sm:p-6">
                    <div className="flex items-start gap-3">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                        <Home size={20} aria-hidden="true" />
                      </span>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-lg font-bold text-slate-950">
                            {collection.reference}
                          </h2>
                          <StatusPill tone={collectionPresentation[collection.status].tone}>
                            {collectionPresentation[collection.status].label}
                          </StatusPill>
                        </div>
                        <p className="mt-1.5 text-xs text-slate-500">
                          Page-local simulation · no patient identity attached
                        </p>
                      </div>
                    </div>
                    <StatusPill tone="warning">LIMS / dispatch writes · 0</StatusPill>
                  </div>

                  <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-4">
                    {[
                      ["Zone", collection.zone, MapPin],
                      ["Date", displayDate(collection.date), CalendarDays],
                      ["Window", collection.window, Clock3],
                      ["Access preset", collection.accessOption, ClipboardCheck],
                    ].map(([label, value, Icon]) => (
                      <div key={String(label)} className="rounded-xl bg-slate-50 p-3">
                        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-slate-500">
                          <Icon size={13} aria-hidden="true" /> {label as string}
                        </span>
                        <p className="mt-2 text-sm font-bold leading-5 text-slate-900">
                          {value as string}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-[var(--line)] p-4 sm:p-6">
                    <div
                      className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600"
                      aria-live="polite"
                    >
                      {feedback}
                    </div>
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      {collection.status === "requested" ? (
                        <button
                          type="button"
                          onClick={scheduleCollection}
                          disabled={adapterUnavailable}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                          <CalendarDays size={16} aria-hidden="true" /> Confirm locally
                        </button>
                      ) : null}
                      {collection.status === "scheduled" ? (
                        <button
                          type="button"
                          onClick={markCollected}
                          disabled={adapterUnavailable}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                          <PackageCheck size={16} aria-hidden="true" /> Simulate local event
                        </button>
                      ) : null}
                      {collection.status !== "cancelled" && collection.status !== "collected" ? (
                        <button
                          type="button"
                          onClick={cancelCollection}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-800 hover:bg-red-100"
                        >
                          <XCircle size={15} aria-hidden="true" /> Cancel locally
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={clearCollection}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <RotateCcw size={15} aria-hidden="true" /> Start again
                      </button>
                    </div>
                  </div>
                </article>
              )}
            </div>
          ) : (
            <div
              id="report-ready-panel"
              role="tabpanel"
              aria-labelledby="report-ready-tab"
              className="space-y-6"
            >
              {workspace.status !== "verified" || laboratory.status === "idle" || laboratory.status === "loading" ? (
                <article
                  className="rounded-2xl border border-[var(--line)] bg-white p-6"
                  role="status"
                  aria-live="polite"
                >
                  <div className="flex items-center gap-3">
                    <RefreshCcw className="animate-spin text-[var(--brand)]" size={20} aria-hidden="true" />
                    <div>
                      <h2 className="text-sm font-bold text-slate-950">
                        Loading scoped laboratory metadata
                      </h2>
                      <p className="mt-1 text-xs leading-5 text-slate-600">
                        Verifying the authenticated workspace and exact team-location access.
                      </p>
                    </div>
                  </div>
                </article>
              ) : laboratory.status === "error" ? (
                <article className="rounded-2xl border border-red-200 bg-red-50 p-5" role="alert">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 shrink-0 text-red-700" size={19} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <h2 className="text-sm font-bold text-red-950">
                        Laboratory metadata unavailable
                      </h2>
                      <p className="mt-1.5 text-xs leading-5 text-red-800">
                        {laboratory.message}
                      </p>
                      <button
                        type="button"
                        onClick={laboratory.retry}
                        className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-red-800 px-3 text-xs font-bold text-white hover:bg-red-900"
                      >
                        <RefreshCcw size={14} aria-hidden="true" /> Retry read
                      </button>
                    </div>
                  </div>
                </article>
              ) : readyLaboratory?.scopePlan.kind === "denied" ? (
                <SafeEmptyState
                  icon="blocked"
                  title="No permitted laboratory record scope"
                  description="This verified role has no valid active team-location pair for patient-operational metadata. The page failed closed without querying report workflows."
                />
              ) : readyLaboratory && readyLaboratory.records.length === 0 ? (
                <SafeEmptyState
                  icon="shield"
                  title="No persisted laboratory metadata in scope"
                  description={`The authenticated ${DATA_SOURCE_SHORT} returned no backend-owned workflow records for this workspace scope. No fixture fallback or readiness claim was shown.`}
                  action={
                    <button
                      type="button"
                      onClick={laboratory.retry}
                      className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--line)] bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-100"
                    >
                      <RefreshCcw size={14} aria-hidden="true" /> Refresh metadata
                    </button>
                  }
                />
              ) : readyLaboratory ? (
                <div className="space-y-5" aria-live="polite">
                  {readyLaboratory.records.map((record, index) => (
                    <PersistedWorkflowCard
                      key={record.key}
                      record={record}
                      position={index + 1}
                    />
                  ))}
                </div>
              ) : null}

              <article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <BellRing
                    className="mt-0.5 shrink-0 text-emerald-700"
                    size={18}
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-emerald-800">
                      Page-local notification example · not queued or sent
                    </p>
                    <p className="mt-2 text-sm font-semibold leading-6 text-emerald-950">
                      Simulation: Your laboratory report workflow is marked ready. Use the approved
                      authenticated portal to check availability.
                    </p>
                    <p className="mt-2 text-[11px] leading-5 text-emerald-800">
                      This static example contains no value, attachment, diagnosis, interpretation,
                      patient identifier, link, credential, or delivery claim.
                    </p>
                  </div>
                </div>
              </article>

              <article className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5">
                <h2 className="text-sm font-bold text-slate-950">Representable data boundary</h2>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {[
                    [
                      "Allowed",
                      "Workflow status, collection/ready/notification timestamps, scoped routing labels, and safe handoff availability/expiry",
                      true,
                    ],
                    [
                      "Excluded",
                      "Values, ranges, report body, attachments, diagnosis, interpretation, advice, credentials, external report and patient identifiers",
                      false,
                    ],
                  ].map(([label, detail, allowed]) => (
                    <div
                      key={String(label)}
                      className={`rounded-xl border p-3 ${
                        allowed
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-red-200 bg-red-50"
                      }`}
                    >
                      <p
                        className={`flex items-center gap-2 text-xs font-bold ${
                          allowed ? "text-emerald-900" : "text-red-900"
                        }`}
                      >
                        {allowed ? <Check size={14} /> : <Ban size={14} />}
                        {label as string}
                      </p>
                      <p
                        className={`mt-1.5 text-[11px] leading-5 ${
                          allowed ? "text-emerald-800" : "text-red-800"
                        }`}
                      >
                        {detail as string}
                      </p>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          )}

          {activeTab === "collection" ? (
            <article className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700">
                    <AlertTriangle size={17} aria-hidden="true" />
                  </span>
                  <div>
                    <h2 className="text-sm font-bold text-slate-950">
                      Page-local failure simulation
                    </h2>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      Demonstrates a stopped local collection flow without touching LIMS,
                      logistics, Firestore, or a patient record.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAdapterUnavailable((value) => !value)}
                  aria-pressed={adapterUnavailable}
                  className={`inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-bold ${
                    adapterUnavailable
                      ? "border-amber-300 bg-amber-100 text-amber-900"
                      : "border-[var(--line)] text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {adapterUnavailable ? (
                    <RefreshCcw size={14} aria-hidden="true" />
                  ) : (
                    <AlertTriangle size={14} aria-hidden="true" />
                  )}
                  {adapterUnavailable ? "Restore local simulator" : "Simulate unavailable"}
                </button>
              </div>
            </article>
          ) : null}
        </div>

        <aside className="h-fit rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5 xl:sticky xl:top-28">
          <JourneyTimeline
            events={events}
            emptyText="Create or advance the separate page-local home-collection simulation to begin. Persisted report events stay in their read-only workflow cards."
          />
          <div className="mt-6 border-t border-[var(--line)] pt-5">
            <h2 className="text-[15px] font-bold text-slate-950">Clinical safety checks</h2>
            <div className="mt-3 space-y-2.5">
              {[
                ["Verified workspace scope", workspace.status === "verified" ? "Pass" : "Checking"],
                ["Report values rendered", "Never"],
                ["Report files accessible", "Never"],
                ["Patient identifiers rendered", "Never"],
                ["Protected handoff reference", "Hidden"],
                ["Page workflow writes", "0"],
                ["LIMS / outbound writes", "0"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5"
                >
                  <span className="flex items-center gap-2 text-xs font-medium text-slate-700">
                    <ShieldCheck
                      size={14}
                      className="text-emerald-600"
                      aria-hidden="true"
                    />
                    {label}
                  </span>
                  <span className="text-right text-[10px] font-bold uppercase tracking-[0.05em] text-slate-500">
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}
