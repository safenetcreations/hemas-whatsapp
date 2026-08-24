"use client";

import { CalendarDays, Check, Clock3, X } from "lucide-react";
import { useRef, useState } from "react";
import { createLiteBookingOperationId } from "@/components/lite/booking-operation";
import { useLiteAuth } from "@/components/lite/lite-auth";
import { liteSetBooking, useLiteBookings } from "@/components/lite/lite-data";
import {
  LITE_BUTTON_PRIMARY,
  LITE_BUTTON_SECONDARY,
  LITE_PANEL,
  LiteEmptyState,
  LiteNotice,
  LitePageHeader,
  LiteStatus,
  liteCx,
} from "@/components/lite/lite-ui";

const DEPT: Record<string, string> = {
  dept_general: "General Consultation", dept_cardiology: "Cardiology", dept_ortho: "Orthopaedics",
  dept_gyn: "Gynae & Obstetrics", dept_urology: "Urology & Kidney", dept_gastro: "Gastroenterology",
  dept_eye: "Eye Care", dept_physio: "Physiotherapy", dept_dental: "Dental", dept_pediatrics: "Pediatrics",
};
const SLOT: Record<string, string> = {
  slot_0900: "9.00 AM", slot_1030: "10.30 AM", slot_1200: "12.00 PM", slot_1400: "2.00 PM",
  slot_1530: "3.30 PM", slot_1700: "5.00 PM", slot_1830: "6.30 PM",
};
const LANG: Record<string, string> = { en: "EN", si: "සිං", ta: "தமி" };
const STATUS_STYLE: Record<string, string> = {
  requested: "border-amber-200 bg-amber-50 text-amber-800",
  confirmed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  cancelled: "border-slate-200 bg-slate-50 text-slate-500",
};

export default function LiteAppointmentsPage() {
  const { status } = useLiteAuth();
  const bookings = useLiteBookings(status === "ready");
  const [busy, setBusy] = useState<string | null>(null);
  const retryOperation = useRef<{
    readonly key: string;
    readonly operationId: string;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<"success" | "danger">("success");

  const act = async (id: string, next: "confirmed" | "cancelled") => {
    const key = `${id}:${next}`;
    const operationId =
      retryOperation.current?.key === key
        ? retryOperation.current.operationId
        : createLiteBookingOperationId();
    retryOperation.current = { key, operationId };
    setBusy(key);
    setNotice(null);
    setNoticeTone("success");
    try {
      const r = await liteSetBooking(id, next, operationId);
      setNotice(
        r.idempotent
          ? `Completed ${next} result restored safely. No duplicate WhatsApp notification was sent.`
          : next === "confirmed"
            ? `Confirmed ✓${r.notified ? " — WhatsApp confirmation sent to the allowlisted tester" : ""}`
            : `Cancelled${r.notified ? " — allowlisted tester notified on WhatsApp" : ""}`,
      );
      retryOperation.current = null;
    } catch (error) {
      setNoticeTone("danger");
      setNotice(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  };

  const byDay = new Map<string, typeof bookings.rows>();
  for (const b of bookings.rows) {
    const day = b.dayId.replace(/^day_/, "") || "unknown";
    byDay.set(day, [...(byDay.get(day) ?? []), b]);
  }
  const days = [...byDay.keys()].sort();

  return (
    <div className="space-y-6">
      <LitePageHeader
        eyebrow="Care coordination"
        title="Appointments"
        description="Review booking requests received from WhatsApp and manage their confirmation status without exposing names, phone numbers, or clinical content."
        actions={
          <LiteStatus tone={bookings.error ? "danger" : bookings.loading ? "neutral" : "brand"}>
            {bookings.error
              ? "Unavailable"
              : bookings.loading
                ? "Loading"
                : `${bookings.rows.length} requests`}
          </LiteStatus>
        }
      />

      {notice ? <LiteNotice tone={noticeTone}>{notice}</LiteNotice> : null}
      {bookings.error ? (
        <LiteNotice tone="danger">Appointment requests are temporarily unavailable.</LiteNotice>
      ) : null}
      {bookings.loading ? (
        <div className="grid gap-4 lg:grid-cols-2" aria-busy="true">
          {[0, 1].map((row) => (
            <div key={row} className="h-56 animate-pulse rounded-2xl bg-white" />
          ))}
        </div>
      ) : null}
      {!bookings.loading && bookings.rows.length === 0 && !bookings.error ? (
        <div className={LITE_PANEL}>
          <LiteEmptyState
            icon={CalendarDays}
            title="No appointment requests yet"
            description="On WhatsApp, send MENU, choose Book appointment, and select a department, date, and time. The governed request will appear here."
          />
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        {days.map((day) => (
          <section key={day} className={liteCx(LITE_PANEL, "overflow-hidden")}>
            <header className="flex items-center gap-3 border-b border-[var(--lite-line)] bg-[#fbfdfd] px-5 py-4">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--lite-brand-soft)] text-[var(--lite-brand)]">
                <CalendarDays size={19} aria-hidden="true" />
              </span>
              <span className="font-display text-base font-bold text-[var(--lite-ink)]">
                {new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
                  weekday: "long", day: "2-digit", month: "short",
                })}
              </span>
              <span className="ml-auto text-xs font-semibold text-[var(--lite-muted)]">
                {byDay.get(day)?.length} booking{(byDay.get(day)?.length ?? 0) === 1 ? "" : "s"}
              </span>
            </header>
            <ul className="divide-y divide-[var(--lite-line)]">
              {(byDay.get(day) ?? []).map((b) => (
                <li key={b.id} className="px-5 py-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[var(--lite-line)] bg-white text-[var(--lite-brand)]">
                        <Clock3 size={18} aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-display text-[15px] font-bold text-[var(--lite-ink)]">
                            {SLOT[b.slotId] ?? b.slotId}
                          </span>
                          <span className="rounded-full border border-[var(--lite-line)] bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-[var(--lite-muted)]">
                            {LANG[b.language] ?? b.language}
                          </span>
                          <span
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-bold capitalize ${STATUS_STYLE[b.status] ?? STATUS_STYLE.requested}`}
                          >
                            {b.status}
                          </span>
                        </div>
                        <p className="mt-1 text-sm font-medium text-[var(--lite-ink-secondary)]">
                          {DEPT[b.departmentId] ?? b.departmentId}
                        </p>
                        <p className="mt-1.5 text-xs text-[var(--lite-muted)]">
                          <span className="font-mono">{b.reference}</span>
                          <span aria-hidden="true"> · </span>
                          Canary visitor · opaque ref {b.visitorKey.slice(0, 6)}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 sm:justify-end">
                      {b.status !== "confirmed" ? (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void act(b.id, "confirmed")}
                          className={`${LITE_BUTTON_PRIMARY} min-h-10 flex-1 px-3 text-xs sm:flex-none`}
                          aria-label={`Confirm appointment ${b.reference}`}
                        >
                          <Check size={15} aria-hidden="true" />
                          {busy === `${b.id}:confirmed` ? "Confirming…" : "Confirm"}
                        </button>
                      ) : null}
                      {b.status !== "cancelled" ? (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void act(b.id, "cancelled")}
                          className={`${LITE_BUTTON_SECONDARY} min-h-10 flex-1 px-3 text-xs hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 sm:flex-none`}
                          aria-label={`Cancel appointment ${b.reference}`}
                        >
                          <X size={15} aria-hidden="true" />
                          {busy === `${b.id}:cancelled` ? "Cancelling…" : "Cancel"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
