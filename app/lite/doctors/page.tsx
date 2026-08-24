"use client";

import { Building2, Plus, ShieldCheck, Stethoscope, UserRound } from "lucide-react";
import { useState } from "react";
import { useLiteAuth } from "@/components/lite/lite-auth";
import { liteSaveDoctor, useLiteDoctors } from "@/components/lite/lite-data";
import {
  LITE_BUTTON_PRIMARY,
  LITE_BUTTON_SECONDARY,
  LITE_FIELD,
  LITE_PANEL,
  LiteEmptyState,
  LiteNotice,
  LitePageHeader,
  LiteSectionHeader,
  LiteStatus,
  liteCx,
} from "@/components/lite/lite-ui";

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
  const [busyDoctorId, setBusyDoctorId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<"success" | "danger">("success");

  const save = async () => {
    setPending(true);
    setNotice(null);
    setNoticeTone("success");
    try {
      await liteSaveDoctor({ name: name.trim(), departmentId: dept, hospital });
      setNotice("Doctor saved ✓ — appears in the directory and the booking flow update.");
      setName("");
    } catch (error) {
      setNoticeTone("danger");
      setNotice(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setPending(false);
    }
  };

  const toggle = async (id: string, nameLabel: string, departmentId: string, hospitalName: string, active: boolean) => {
    setBusyDoctorId(id);
    setNotice(null);
    try {
      await liteSaveDoctor({ doctorId: id, name: nameLabel, departmentId, hospital: hospitalName, active });
    } catch (error) {
      setNoticeTone("danger");
      setNotice(error instanceof Error ? error.message : "Update failed.");
    } finally {
      setBusyDoctorId(null);
    }
  };

  return (
    <div className="space-y-6">
      <LitePageHeader
        eyebrow="Clinical directory"
        title="Doctor directory"
        description="Manage the synthetic availability directory used by the booking journey. Production would synchronize this data from the hospital roster."
        actions={
          <LiteStatus tone={doctors.error ? "danger" : doctors.loading ? "neutral" : "brand"}>
            {doctors.error
              ? "Unavailable"
              : doctors.loading
                ? "Loading"
                : `${doctors.rows.filter((doctor) => doctor.active).length} active`}
          </LiteStatus>
        }
      />

      <section className={liteCx(LITE_PANEL, "p-5 sm:p-6")}>
        <LiteSectionHeader
          title="Add a doctor"
          description="Synthetic names only in this governed demo workspace."
          icon={Stethoscope}
        />
        {canEdit ? (
          <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(240px,1fr)_minmax(190px,0.72fr)_minmax(170px,0.58fr)_auto]">
            <label className="text-sm font-semibold text-[var(--lite-ink-secondary)]">
              Doctor name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={70}
                placeholder="Dr. name — synthetic demo names only"
                className={`${LITE_FIELD} mt-2`}
              />
            </label>
            <label className="text-sm font-semibold text-[var(--lite-ink-secondary)]">
              Department
              <select
                value={dept}
                onChange={(e) => setDept(e.target.value)}
                className={`${LITE_FIELD} mt-2`}
              >
                {DEPARTMENTS.map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </label>
            <label className="text-sm font-semibold text-[var(--lite-ink-secondary)]">
              Hospital
              <select
                value={hospital}
                onChange={(e) => setHospital(e.target.value)}
                className={`${LITE_FIELD} mt-2`}
              >
                <option>Wattala</option>
                <option>Thalawathugoda</option>
              </select>
            </label>
            <button
              type="button"
              disabled={pending || name.trim().length < 3}
              onClick={() => void save()}
              className={`${LITE_BUTTON_PRIMARY} self-end xl:mb-0`}
            >
              <Plus size={17} aria-hidden="true" />
              {pending ? "Saving…" : "Add doctor"}
            </button>
          </div>
        ) : (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-[var(--lite-line)] bg-slate-50 p-4">
            <ShieldCheck size={19} className="mt-0.5 text-[var(--lite-brand)]" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-[var(--lite-ink)]">Directory is read-only for this seat</p>
              <p className="mt-1 text-xs leading-5 text-[var(--lite-muted)]">A Supervisor or tenant administrator can add, enable, or disable doctors.</p>
            </div>
          </div>
        )}
        {notice ? <div className="mt-4"><LiteNotice tone={noticeTone}>{notice}</LiteNotice></div> : null}
      </section>

      {doctors.error ? <LiteNotice tone="danger">The doctor directory is temporarily unavailable.</LiteNotice> : null}
      {doctors.loading ? (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((row) => <div key={row} className="h-36 animate-pulse rounded-2xl bg-white" />)}
        </section>
      ) : null}
      {!doctors.loading && doctors.rows.length === 0 && !doctors.error ? (
        <div className={LITE_PANEL}>
          <LiteEmptyState icon={Stethoscope} title="No doctors in the directory" description="Add a synthetic doctor to make the booking directory available." />
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {doctors.rows.map((d) => (
          <article key={d.id} className={liteCx(LITE_PANEL, "p-5", !d.active && "bg-slate-50/80")}>
            <div className="flex items-start gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[var(--lite-brand-soft)] text-[var(--lite-brand)]">
                <UserRound size={21} aria-hidden="true" />
                <span className="sr-only">
                {d.name.replace(/^Dr\.?\s*/i, "").slice(0, 1).toUpperCase()}
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 truncate font-display text-[15px] font-bold text-[var(--lite-ink)]">{d.name}</p>
                  <LiteStatus tone={d.active ? "success" : "neutral"} dot={d.active}>{d.active ? "Active" : "Inactive"}</LiteStatus>
                </div>
                <p className="mt-1 text-sm text-[var(--lite-muted)]">{DEPT_NAME[d.departmentId] ?? d.departmentId}</p>
                <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-[var(--lite-muted)]">
                  <Building2 size={14} aria-hidden="true" />
                  {d.hospital}
                </p>
              </div>
            </div>
            {canEdit ? (
              <button
                type="button"
                disabled={busyDoctorId !== null}
                onClick={() => void toggle(d.id, d.name, d.departmentId, d.hospital, !d.active)}
                className={`${d.active ? LITE_BUTTON_SECONDARY : LITE_BUTTON_PRIMARY} mt-4 min-h-10 w-full px-3 text-xs ${d.active ? "hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700" : ""}`}
              >
                {busyDoctorId === d.id ? "Updating…" : d.active ? "Disable doctor" : "Enable doctor"}
              </button>
            ) : null}
          </article>
        ))}
      </section>
    </div>
  );
}
