"use client";

import { useState } from "react";
import { useLiteAuth } from "@/components/lite/lite-auth";
import { DEMO_VISITOR_KEYS } from "@/components/lite/lite-config";
import { liteSetBooking, useLiteBookings } from "@/components/lite/lite-data";

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
  requested: "bg-amber-100 text-amber-800",
  confirmed: "bg-emerald-600 text-white",
  cancelled: "bg-slate-200 text-slate-500",
};

export default function LiteAppointmentsPage() {
  const { status } = useLiteAuth();
  const bookings = useLiteBookings(status === "ready");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const act = async (id: string, next: "confirmed" | "cancelled") => {
    setBusy(id + next);
    setNotice(null);
    try {
      const r = await liteSetBooking(id, next);
      setNotice(
        next === "confirmed"
          ? `Confirmed ✓${r.notified ? " — WhatsApp confirmation sent to the patient's phone" : ""}`
          : `Cancelled${r.notified ? " — patient notified on WhatsApp" : ""}`,
      );
    } catch (error) {
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
    <div className="space-y-5">
      <section>
        <h1 className="text-xl font-semibold text-slate-900">Appointments</h1>
        <p className="mt-1 text-sm text-slate-500">
          Real appointment requests from the WhatsApp line — confirm one and the patient gets a
          WhatsApp confirmation instantly. Selections only, no patient data stored.
        </p>
      </section>

      {notice ? (
        <p className="rounded-xl bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">{notice}</p>
      ) : null}
      {bookings.error ? (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-xs text-rose-700">{bookings.error}</p>
      ) : null}
      {bookings.loading ? <p className="text-xs text-slate-400">Loading bookings…</p> : null}
      {!bookings.loading && bookings.rows.length === 0 && !bookings.error ? (
        <p className="rounded-xl bg-white px-4 py-6 text-center text-xs text-slate-400">
          No bookings yet — on WhatsApp send <b>menu → Book appointment</b>, pick a department,
          date and time, and it lands here with a reference number.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {days.map((day) => (
          <section key={day} className="rounded-2xl border border-emerald-900/5 bg-white shadow-sm">
            <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
              <span className="text-sm font-semibold text-slate-800">
                {new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
                  weekday: "short", day: "2-digit", month: "short",
                })}
              </span>
              <span className="ml-auto text-[10px] uppercase tracking-wide text-slate-400">
                {byDay.get(day)?.length} booking{(byDay.get(day)?.length ?? 0) === 1 ? "" : "s"}
              </span>
            </header>
            <ul>
              {(byDay.get(day) ?? []).map((b) => (
                <li key={b.id} className="border-b border-slate-50 px-4 py-3 last:border-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-emerald-700">{SLOT[b.slotId] ?? b.slotId}</span>
                    <span className="text-sm text-slate-700">{DEPT[b.departmentId] ?? b.departmentId}</span>
                    <span className="rounded bg-slate-100 px-1 text-[9px] font-semibold">{LANG[b.language] ?? b.language}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${STATUS_STYLE[b.status] ?? STATUS_STYLE.requested}`}>
                      {b.status}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-slate-500">{b.reference}</span>
                    <span className="text-[11px] text-slate-400">
                      {DEMO_VISITOR_KEYS[b.visitorKey] ?? "live visitor (masked)"}
                    </span>
                    <span className="ml-auto flex gap-1.5">
                      {b.status !== "confirmed" ? (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void act(b.id, "confirmed")}
                          className="rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                        >
                          {busy === b.id + "confirmed" ? "…" : "Confirm"}
                        </button>
                      ) : null}
                      {b.status !== "cancelled" ? (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void act(b.id, "cancelled")}
                          className="rounded-full border border-slate-200 px-3 py-1 text-[11px] font-medium text-slate-500 hover:text-rose-600 disabled:opacity-40"
                        >
                          {busy === b.id + "cancelled" ? "…" : "Cancel"}
                        </button>
                      ) : null}
                    </span>
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
