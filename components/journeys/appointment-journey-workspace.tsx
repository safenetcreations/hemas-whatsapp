"use client";

import {
  AlertTriangle,
  Ban,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Database,
  FlaskConical,
  History,
  LoaderCircle,
  MapPin,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  Stethoscope,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useWorkspaceSession } from "@/components/auth/workspace-session";
import { StatusPill } from "@/components/ui/status-pill";
import type {
  AppointmentDTO,
  AppointmentEventDTO,
  SyntheticAppointmentAction,
} from "@/lib/firebase/repositories";
import type { VerifiedWorkspaceSession } from "@/lib/firebase/workspace-session-model";
import type { AppointmentWorkspaceRecord } from "./appointment-workspace-data";
import {
  type AppointmentActionState,
  useAppointmentWorkspace,
} from "./use-appointment-workspace";

type AppointmentStatus = AppointmentDTO["status"];

const statusPresentation: Record<
  AppointmentStatus,
  { readonly label: string; readonly tone: "success" | "warning" | "neutral" | "info" }
> = {
  requested: { label: "Requested in simulator", tone: "info" },
  pending_confirmation: { label: "Simulator confirmation pending", tone: "warning" },
  confirmed: { label: "Simulator confirmed snapshot", tone: "success" },
  reschedule_pending: { label: "Reschedule request pending", tone: "info" },
  cancel_pending: { label: "Cancellation request pending", tone: "warning" },
  cancelled: { label: "Cancelled in simulator", tone: "neutral" },
  completed: { label: "Completed in simulator", tone: "success" },
  no_show: { label: "No-show in simulator", tone: "neutral" },
};

const syncPresentation: Record<
  AppointmentDTO["syncState"],
  { readonly label: string; readonly tone: "success" | "warning" | "neutral" | "info" }
> = {
  mock: { label: "Simulator snapshot", tone: "neutral" },
  pending: { label: "Simulator follow-up pending", tone: "warning" },
  synced: { label: "Simulator sync marker", tone: "success" },
  conflict: { label: "Simulator conflict", tone: "warning" },
  failed: { label: "Simulator failure", tone: "warning" },
};

const eventLabels: Record<AppointmentEventDTO["action"], string> = {
  simulator_snapshot_seeded: "Simulator snapshot seeded",
  request_reschedule: "Reschedule requested",
  request_cancellation: "Cancellation requested",
};

function formatColomboDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid simulator timestamp";
  return new Intl.DateTimeFormat("en-LK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Colombo",
  }).format(date);
}

function formatStatus(value: AppointmentStatus): string {
  return statusPresentation[value].label;
}

function actionStateClass(state: AppointmentActionState["status"]): string {
  if (state === "success" || state === "replay") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }
  if (state === "conflict") return "border-amber-200 bg-amber-50 text-amber-950";
  if (state === "error") return "border-rose-200 bg-rose-50 text-rose-900";
  return "border-cyan-200 bg-cyan-50 text-cyan-950";
}

function AppointmentBoundary() {
  return (
    <section className="overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-emerald-50 shadow-[0_1px_2px_rgba(23,34,31,0.03)]">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-800">
            <Database size={20} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-slate-950 sm:text-[15px]">
                Authenticated emulator evidence
              </h2>
              <StatusPill tone="warning" dot>No HIS connection</StatusPill>
            </div>
            <p className="mt-1.5 max-w-4xl text-xs leading-5 text-slate-600 sm:text-sm sm:leading-6">
              Reads use authenticated Firestore emulator queries. The two request-only transitions use one audited local Functions transaction on 127.0.0.1, with externalCalls=0. All records are synthetic; no Meta, WhatsApp, SMS, email, Hemas, or appointment-system adapter is called.
            </p>
          </div>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 text-center text-[10px] font-bold uppercase tracking-[0.06em]">
          <span className="rounded-xl border border-cyan-200 bg-white px-3 py-2 text-cyan-800">
            Firestore + Functions
          </span>
          <span className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-amber-800">
            External writes · 0
          </span>
        </div>
      </div>
    </section>
  );
}

function AppointmentLoading() {
  return (
    <section
      className="grid gap-5 xl:grid-cols-[minmax(260px,0.72fr)_minmax(0,1.28fr)]"
      aria-label="Loading persisted appointments from the local Firestore emulator"
      aria-busy="true"
    >
      <div className="rounded-2xl border border-[var(--line)] bg-white p-4">
        <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
        <div className="mt-4 space-y-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-24 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <div className="h-5 w-56 max-w-full animate-pulse rounded bg-slate-200" />
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-24 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
        <p className="mt-6 flex items-center justify-center gap-2 text-xs font-semibold text-slate-500">
          <LoaderCircle className="animate-spin" size={15} aria-hidden="true" />
          Validating bounded appointment records and immutable events…
        </p>
      </div>
    </section>
  );
}

function AppointmentFailure({ message, retry }: { message: string; retry: () => void }) {
  return (
    <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-950 sm:p-6" role="alert">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-rose-700">
          <XCircle size={19} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-bold">Persisted appointment workspace stayed closed</h2>
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-rose-800">{message}</p>
          <button
            type="button"
            onClick={retry}
            className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-rose-700 px-4 text-sm font-semibold text-white hover:bg-rose-800"
          >
            <RefreshCcw size={15} aria-hidden="true" /> Retry local emulator load
          </button>
        </div>
      </div>
    </section>
  );
}

function AppointmentScopeDenied({ reason }: { reason: string }) {
  const detail =
    reason === "role_not_permitted"
      ? "This role is not permitted to read or request appointment transitions. Only tenant administrators, supervisors, and patient services agents are enabled here."
      : "The verified membership has no valid active team-and-location pair for appointment records.";
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
      <ShieldCheck className="mx-auto text-amber-700" size={25} aria-hidden="true" />
      <h2 className="mt-3 text-base font-bold text-amber-950">Appointment scope is closed</h2>
      <p className="mx-auto mt-1.5 max-w-2xl text-sm leading-6 text-amber-800">{detail}</p>
      <p className="mt-3 text-xs font-semibold text-amber-700">No fixture or cloud fallback was used.</p>
    </section>
  );
}

function LocalSlotPlanner({ records }: { records: readonly AppointmentWorkspaceRecord[] }) {
  const locationOptions = useMemo(() => {
    const persisted = [...new Set(records.map((record) => record.locationName))];
    return persisted.length > 0 ? persisted : ["Synthetic local location"];
  }, [records]);
  const [location, setLocation] = useState(locationOptions[0] ?? "Synthetic local location");
  const [date, setDate] = useState("2026-08-12");
  const [slot, setSlot] = useState("10:30");
  const [preview, setPreview] = useState<string | null>(null);
  const effectiveLocation = locationOptions.includes(location)
    ? location
    : locationOptions[0] ?? "Synthetic local location";

  function generatePreview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!date || !slot || !effectiveLocation) return;
    setPreview(`LOCAL-ONLY-${date.replaceAll("-", "")}-${slot.replace(":", "")}`);
  }

  return (
    <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 sm:p-5" aria-labelledby="local-slot-planner-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="local-slot-planner-title" className="text-[15px] font-bold text-slate-950">
              Local-only slot planning preview
            </h2>
            <StatusPill tone="neutral">Not persisted</StatusPill>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            This browser-memory helper does not create an appointment or check availability. Only records above are Firestore authority.
          </p>
        </div>
        {preview ? (
          <button
            type="button"
            onClick={() => setPreview(null)}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            <RotateCcw size={14} aria-hidden="true" /> Clear preview
          </button>
        ) : null}
      </div>
      <form onSubmit={generatePreview} className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_0.8fr_0.65fr_auto] xl:items-end">
        <label className="text-xs font-semibold text-slate-700">
          Synthetic location label
          <select
            value={effectiveLocation}
            onChange={(event) => setLocation(event.target.value)}
            className="mt-1.5 h-10 w-full rounded-xl border border-[var(--line)] bg-white px-3 text-sm text-slate-800"
          >
            {locationOptions.map((option) => <option key={option}>{option}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Planning date
          <input
            type="date"
            required
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="mt-1.5 h-10 w-full rounded-xl border border-[var(--line)] bg-white px-3 text-sm text-slate-800"
          />
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Mock slot
          <select
            value={slot}
            onChange={(event) => setSlot(event.target.value)}
            className="mt-1.5 h-10 w-full rounded-xl border border-[var(--line)] bg-white px-3 text-sm text-slate-800"
          >
            {["09:00", "10:30", "12:15", "14:30", "16:00"].map((option) => <option key={option}>{option}</option>)}
          </select>
        </label>
        <button type="submit" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800">
          <CalendarClock size={15} aria-hidden="true" /> Preview locally
        </button>
      </form>
      {preview ? (
        <div className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-xs leading-5 text-cyan-950" role="status">
          <strong>{preview}</strong> is a browser-only planning reference for {effectiveLocation}. It is absent from Firestore and is not a Hemas/HIS booking.
        </div>
      ) : null}
    </section>
  );
}

function AppointmentList({
  records,
  selectedId,
  onSelect,
}: {
  records: readonly AppointmentWorkspaceRecord[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-[var(--line)] bg-white p-3 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-4" aria-labelledby="persisted-appointments-title">
      <div className="px-1 pb-3">
        <h2 id="persisted-appointments-title" className="text-[15px] font-bold text-slate-950">Persisted appointments</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">Bounded emulator query · {records.length} synthetic record{records.length === 1 ? "" : "s"}</p>
      </div>
      <div className="space-y-2">
        {records.map((record) => {
          const appointment = record.appointment;
          const selected = appointment.id === selectedId;
          const presentation = statusPresentation[appointment.status];
          return (
            <button
              key={appointment.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(appointment.id)}
              className={`w-full min-w-0 rounded-xl border p-3 text-left transition ${
                selected
                  ? "border-emerald-300 bg-emerald-50 shadow-sm"
                  : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <div className="flex min-w-0 items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-slate-950">{appointment.externalAppointmentRef}</span>
                  <span className="mt-1 block truncate text-[11px] font-medium text-slate-500">{record.locationName}</span>
                </span>
                <StatusPill tone={presentation.tone}>{appointment.status.replaceAll("_", " ")}</StatusPill>
              </div>
              <span className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                <Clock3 size={13} aria-hidden="true" /> {formatColomboDateTime(appointment.slotStartsAt)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ActionNotice({ state }: { state: AppointmentActionState }) {
  if (state.status === "idle") return null;
  return (
    <div className={`mt-5 flex items-start gap-2 rounded-xl border px-3 py-3 text-xs leading-5 ${actionStateClass(state.status)}`} role="status" aria-live="polite">
      {state.status === "working" ? (
        <LoaderCircle className="mt-0.5 shrink-0 animate-spin" size={15} aria-hidden="true" />
      ) : state.status === "error" ? (
        <AlertTriangle className="mt-0.5 shrink-0" size={15} aria-hidden="true" />
      ) : (
        <CheckCircle2 className="mt-0.5 shrink-0" size={15} aria-hidden="true" />
      )}
      <span>{state.message}</span>
    </div>
  );
}

function AppointmentDetail({
  record,
  session,
  actionState,
  onRequest,
}: {
  record: AppointmentWorkspaceRecord;
  session: VerifiedWorkspaceSession;
  actionState: AppointmentActionState;
  onRequest: (record: AppointmentWorkspaceRecord, action: SyntheticAppointmentAction) => void;
}) {
  const appointment = record.appointment;
  const status = statusPresentation[appointment.status];
  const sync = syncPresentation[appointment.syncState];
  const actionForThisAppointment =
    actionState.status !== "idle" && actionState.appointmentId === appointment.id
      ? actionState
      : ({ status: "idle", appointmentId: null, message: null } as const);
  const working = actionForThisAppointment.status === "working";
  const canRequest =
    ["tenant_admin", "supervisor", "agent"].includes(session.role) &&
    appointment.status === "confirmed" &&
    appointment.authoritativeSystem === "simulator" &&
    appointment.synthetic;

  return (
    <section className="min-w-0 rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-6" aria-labelledby="appointment-detail-title">
      <div className="flex min-w-0 flex-col gap-4 border-b border-[var(--line)] pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <StatusPill tone={status.tone} dot>{status.label}</StatusPill>
            <StatusPill tone={sync.tone}>{sync.label}</StatusPill>
          </div>
          <h2 id="appointment-detail-title" className="mt-3 break-words text-xl font-bold tracking-[-0.025em] text-slate-950">{appointment.externalAppointmentRef}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">Persisted synthetic metadata · revision {appointment.revision} · simulator is authoritative only for this demo</p>
        </div>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
          <Stethoscope size={19} aria-hidden="true" />
        </span>
      </div>

      <dl className="mt-5 grid gap-3 sm:grid-cols-2">
        {[
          { label: "Slot (Asia/Colombo)", value: formatColomboDateTime(appointment.slotStartsAt), icon: CalendarClock },
          { label: "Location", value: record.locationName, icon: MapPin },
          { label: "Routing team", value: record.teamName, icon: ShieldCheck },
          { label: "Service reference", value: appointment.serviceRef, icon: Stethoscope },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <dt className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-slate-500"><Icon size={12} aria-hidden="true" /> {label}</dt>
            <dd className="mt-2 break-words text-sm font-semibold text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 rounded-xl border border-cyan-200 bg-cyan-50 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-sm font-bold text-cyan-950">Audited local Functions controls</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-cyan-800">
              Each control calls the server-owned audited local Functions transaction, which atomically records one deterministic request, immutable event, and redacted audit before leaving the simulator status pending. It cannot choose a new slot, complete a cancellation, or claim Hemas/HIS confirmation; externalCalls=0.
            </p>
          </div>
          <StatusPill tone="info">Expected revision {appointment.revision}</StatusPill>
        </div>
        {canRequest ? (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={working}
              onClick={() => onRequest(record, "request_reschedule")}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-cyan-800 px-4 text-sm font-semibold text-white hover:bg-cyan-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {working ? <LoaderCircle className="animate-spin" size={15} aria-hidden="true" /> : <CalendarClock size={15} aria-hidden="true" />}
              Request reschedule
            </button>
            <button
              type="button"
              disabled={working}
              onClick={() => onRequest(record, "request_cancellation")}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-rose-300 bg-white px-4 text-sm font-semibold text-rose-800 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Ban size={15} aria-hidden="true" /> Request cancellation
            </button>
          </div>
        ) : (
          <p className="mt-4 rounded-lg bg-white/80 px-3 py-2.5 text-xs font-semibold leading-5 text-cyan-900">
            {appointment.status === "reschedule_pending" || appointment.status === "cancel_pending"
              ? `${formatStatus(appointment.status)}. A trusted simulator follow-up would be required; no HIS action occurred.`
              : "This persisted state does not accept either client request transition."}
          </p>
        )}
        <ActionNotice state={actionForThisAppointment} />
      </div>

      <section className="mt-6" aria-labelledby="appointment-events-title">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 id="appointment-events-title" className="text-[15px] font-bold text-slate-950">Immutable event evidence</h3>
            <p className="mt-1 text-xs text-[var(--muted)]">Persisted event metadata, newest first · message bodies are not involved</p>
          </div>
          <StatusPill tone="neutral">{record.events.length} event{record.events.length === 1 ? "" : "s"}</StatusPill>
        </div>
        {record.events.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-7 text-center">
            <CircleDashed className="mx-auto text-slate-400" size={20} aria-hidden="true" />
            <p className="mt-2 text-sm font-semibold text-slate-700">No immutable event metadata is present</p>
          </div>
        ) : (
          <ol className="mt-4 space-y-3">
            {record.events.map((event) => (
              <li key={event.id} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900">{eventLabels[event.action]}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">{event.fromStatus ? `${formatStatus(event.fromStatus)} → ` : ""}{formatStatus(event.toStatus)} · revision {event.revision}</p>
                  </div>
                  <time className="shrink-0 text-[10px] font-semibold text-slate-500">{formatColomboDateTime(event.createdAt)}</time>
                </div>
                <p className="mt-2 break-all font-mono text-[10px] leading-4 text-slate-500">Action ID: {event.actionId}</p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-500">Source: {event.source.replaceAll("_", " ")}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}

function VerifiedAppointmentWorkspace({ session }: { session: VerifiedWorkspaceSession }) {
  const workspace = useAppointmentWorkspace(session);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedRecord =
    workspace.status === "ready"
      ? workspace.records.find((record) => record.appointment.id === selectedId) ?? workspace.records[0] ?? null
      : null;

  return (
    <div className="space-y-6 lg:space-y-8">
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <StatusPill tone="success" dot>Authenticated workspace</StatusPill>
            <StatusPill tone="info" dot>Firestore emulator</StatusPill>
            <StatusPill tone="info" dot>Functions emulator</StatusPill>
          </div>
          <h1 className="text-2xl font-bold tracking-[-0.035em] text-slate-950 sm:text-3xl">Appointment journey workspace</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            Review tenant-scoped synthetic appointment metadata, immutable event evidence, and request-only reschedule or cancellation transitions.
          </p>
        </div>
        <button
          type="button"
          onClick={workspace.retry}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <RefreshCcw size={16} aria-hidden="true" /> Reload emulator evidence
        </button>
      </section>

      <AppointmentBoundary />

      {workspace.status === "loading" ? <AppointmentLoading /> : null}
      {workspace.status === "error" ? <AppointmentFailure message={workspace.message} retry={workspace.retry} /> : null}
      {workspace.status === "ready" && workspace.scopePlan.kind === "denied" ? (
        <AppointmentScopeDenied reason={workspace.scopePlan.reason} />
      ) : null}
      {workspace.status === "ready" && workspace.scopePlan.kind !== "denied" && workspace.records.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
          <History className="mx-auto text-slate-400" size={25} aria-hidden="true" />
          <h2 className="mt-3 text-base font-bold text-slate-800">No persisted appointments in this verified scope</h2>
          <p className="mx-auto mt-1.5 max-w-2xl text-sm leading-6 text-slate-600">The bounded emulator query succeeded and returned no records. A domain fixture was not substituted.</p>
        </section>
      ) : null}

      {workspace.status === "ready" && workspace.scopePlan.kind !== "denied" && selectedRecord ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Persisted appointment summary">
            {[
              { label: "Persisted records", value: String(workspace.records.length), detail: "Bounded by verified membership", icon: Database },
              { label: "Selected status", value: selectedRecord.appointment.status.replaceAll("_", " "), detail: "Simulator state only", icon: CalendarClock },
              { label: "Immutable events", value: String(selectedRecord.events.length), detail: "Validated appointment joins", icon: History },
              { label: "External dispatch", value: "0", detail: "Callable contract: externalCalls=0", icon: Ban },
            ].map(({ detail, icon: Icon, label, value }) => (
              <article key={label} className="min-w-0 rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[var(--muted)]">{label}</p>
                    <p className="mt-2 break-words text-xl font-bold tracking-[-0.03em] text-slate-950">{value}</p>
                  </div>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]"><Icon size={17} aria-hidden="true" /></span>
                </div>
                <p className="mt-3 text-[11px] leading-5 text-slate-500">{detail}</p>
              </article>
            ))}
          </section>
          <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(260px,0.72fr)_minmax(0,1.28fr)]">
            <AppointmentList records={workspace.records} selectedId={selectedRecord.appointment.id} onSelect={setSelectedId} />
            <AppointmentDetail
              record={selectedRecord}
              session={session}
              actionState={workspace.actionState}
              onRequest={(record, action) => void workspace.requestAction(record, action)}
            />
          </section>
        </>
      ) : null}

      {workspace.status === "ready" && workspace.scopePlan.kind !== "denied" ? (
        <LocalSlotPlanner records={workspace.records} />
      ) : null}

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          { icon: FlaskConical, title: "Synthetic only", text: "No real patient, clinician, or contact data is accepted." },
          { icon: ShieldCheck, title: "Scope first", text: "Workspace, active route, and event joins must all validate." },
          { icon: Ban, title: "Outbound disabled", text: "The page cannot send messages or update a Hemas system." },
        ].map(({ icon: Icon, text, title }) => (
          <article key={title} className="rounded-2xl border border-[var(--line)] bg-white p-4">
            <Icon className="text-[var(--brand)]" size={18} aria-hidden="true" />
            <h2 className="mt-3 text-sm font-bold text-slate-900">{title}</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">{text}</p>
          </article>
        ))}
      </section>
    </div>
  );
}

export function AppointmentJourneyWorkspace() {
  const workspace = useWorkspaceSession();
  if (workspace.status === "verified" && workspace.session) {
    return <VerifiedAppointmentWorkspace session={workspace.session} />;
  }

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-white p-6" aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
          {workspace.status === "checking" ? <LoaderCircle className="animate-spin" size={19} aria-hidden="true" /> : <ShieldCheck size={19} aria-hidden="true" />}
        </span>
        <div>
          <h1 className="text-lg font-bold text-slate-950">Appointment workspace locked</h1>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            {workspace.status === "checking"
              ? "Waiting for Firebase Auth and authoritative workspace membership verification."
              : workspace.message ?? "A verified synthetic workspace session is required."}
          </p>
        </div>
      </div>
    </section>
  );
}
