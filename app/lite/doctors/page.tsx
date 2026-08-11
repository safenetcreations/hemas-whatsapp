"use client";

import { useState } from "react";
import { useLiteAuth } from "@/components/lite/lite-auth";
import { liteSaveDoctor, useLiteDoctors } from "@/components/lite/lite-data";

const DEPARTMENTS = [
  ["dept_general", "General Consultation"], ["dept_cardiology", "Cardiology"],
  ["dept_ortho", "Orthopaedics"], ["dept_gyn", "Gynae & Obstetrics"],
  ["dept_urology", "Urology & Kidney"], ["dept_gastro", "Gastroenterology"],
  ["dept_eye", "Eye Care"], ["dept_physio", "Physiotherapy"],
] as const;
const DEPT_NAME = Object.fromEntries(DEPARTMENTS);

export default function LiteDoctorsPage() {
  const { status, member } = useLiteAuth();
  const doctors = useLiteDoctors(status === "ready");
  const canEdit = member?.role === "supervisor" || member?.role === "tenant_admin";

  const [name, setName] = useState("");
  const [dept, setDept] = useState<string>(DEPARTMENTS[0][0]);
  const [hospital, setHospital] = useState("Wattala");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const save = async () => {
    setPending(true);
    setNotice(null);
    try {
      await liteSaveDoctor({ name: name.trim(), departmentId: dept, hospital });
      setNotice("Doctor saved ✓ — appears in the directory and the booking flow update.");
      setName("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setPending(false);
    }
  };

  const toggle = async (id: string, nameLabel: string, departmentId: string, hospitalName: string, active: boolean) => {
    try {
      await liteSaveDoctor({ doctorId: id, name: nameLabel, departmentId, hospital: hospitalName, active });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Update failed.");
    }
  };

  return (
    <div className="space-y-5">
      <section>
        <h1 className="text-xl font-semibold text-slate-900">Doctors</h1>
        <p className="mt-1 text-sm text-slate-500">
          The clinic&apos;s doctor directory (synthetic demo names). Supervisors add or disable
          doctors here — the real product syncs this from the hospital&apos;s roster.
        </p>
      </section>

      <section className="rounded-2xl border border-blue-900/5 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Add a doctor</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={70}
            placeholder="Dr. name — synthetic demo names only"
            className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
          />
          <select value={dept} onChange={(e) => setDept(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
            {DEPARTMENTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <select value={hospital} onChange={(e) => setHospital(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
            <option>Wattala</option>
            <option>Thalawathugoda</option>
          </select>
          <button
            type="button"
            disabled={pending || !canEdit || name.trim().length < 3}
            onClick={() => void save()}
            className="rounded-xl bg-[#1863DC] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0F56C4] disabled:opacity-40"
          >
            {pending ? "Saving…" : "Add doctor"}
          </button>
        </div>
        {!canEdit ? (
          <p className="mt-2 text-[11px] text-slate-400">Sign in as Supervisor to add or disable doctors.</p>
        ) : null}
        {notice ? <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">{notice}</p> : null}
      </section>

      {doctors.error ? <p className="rounded-xl bg-rose-50 px-4 py-3 text-xs text-rose-700">{doctors.error}</p> : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {doctors.rows.map((d) => (
          <article key={d.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${d.active ? "border-blue-900/5" : "border-slate-200 opacity-60"}`}>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">
                {d.name.replace(/^Dr\.?\s*/i, "").slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{d.name}</p>
                <p className="text-[11px] text-slate-400">{DEPT_NAME[d.departmentId] ?? d.departmentId} · {d.hospital}</p>
              </div>
            </div>
            {canEdit ? (
              <button
                type="button"
                onClick={() => void toggle(d.id, d.name, d.departmentId, d.hospital, !d.active)}
                className={`mt-3 rounded-full px-3 py-1 text-[11px] font-medium ${
                  d.active
                    ? "border border-slate-200 text-slate-500 hover:text-rose-600"
                    : "bg-[#1863DC] text-white"
                }`}
              >
                {d.active ? "Disable" : "Enable"}
              </button>
            ) : null}
          </article>
        ))}
      </section>
    </div>
  );
}
