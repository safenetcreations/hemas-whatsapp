"use client";

import {
  AlertOctagon,
  Check,
  CheckCircle2,
  KeyRound,
  LockKeyhole,
  ShieldAlert,
  ShieldCheck,
  Split,
  UserRoundX,
  X,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { LocationId, MemberId, Permission, TeamId } from "@/lib/domain";
import { demoLocations, demoTeams } from "@/lib/demo";
import {
  ACCESS_TEST_PERMISSIONS,
  EMPTY_SCOPE_PATIENT_PROOFS,
  PERMISSION_MATRIX_COLUMNS,
  ROLE_LABELS,
  WORKSPACE_ROLES,
  explainAccessTest,
  membershipWithPreview,
  roleHasPermission,
} from "./policy-model";
import type { LocalMembershipPreviews, MemberDirectoryRecord } from "./types";

interface PermissionExplainerProps {
  readonly records: readonly MemberDirectoryRecord[];
  readonly previews: LocalMembershipPreviews;
  readonly onAnnounce: (message: string) => void;
}

function permissionLabel(permission: Permission): string {
  return permission
    .split(".")
    .map((part) => part.replaceAll("_", " "))
    .join(" · ");
}

export function PermissionExplainer({ records, previews, onAnnounce }: PermissionExplainerProps) {
  const [memberId, setMemberId] = useState<MemberId | null>(records[2]?.membership.id ?? records[0]?.membership.id ?? null);
  const [permission, setPermission] = useState<Permission>("contacts.view");
  const [patientSensitive, setPatientSensitive] = useState(true);
  const [teamId, setTeamId] = useState<TeamId | null>(demoTeams[0]?.id ?? null);
  const [locationId, setLocationId] = useState<LocationId | null>(demoLocations[0]?.id ?? null);
  const [forceEmptyAssignedScope, setForceEmptyAssignedScope] = useState(false);

  const selectedRecord = records.find((record) => record.membership.id === memberId) ?? records[0] ?? null;
  const effectiveMembership = selectedRecord
    ? membershipWithPreview(selectedRecord.membership, previews[selectedRecord.membership.id])
    : null;
  const result = useMemo(
    () => effectiveMembership
      ? explainAccessTest(effectiveMembership, {
          permission,
          patientSensitive,
          teamId,
          locationId,
          forceEmptyAssignedScope,
        })
      : null,
    [effectiveMembership, forceEmptyAssignedScope, locationId, patientSensitive, permission, teamId],
  );

  function announceChange(message: string) {
    onAnnounce(`${message} Authorization was recalculated locally.`);
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-red-200 bg-red-50 p-4 sm:p-5" aria-labelledby="empty-scope-proof-title">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-100 text-red-700"><ShieldAlert size={19} aria-hidden="true" /></span>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-red-600">Required fail-closed proof</p>
              <h2 id="empty-scope-proof-title" className="mt-1 text-base font-bold text-red-950">Empty non-admin scope means zero patient access</h2>
              <p className="mt-1 max-w-3xl text-[11px] leading-5 text-red-800">These decisions come from the shared domain authorization helper using an active agent with <code className="rounded bg-white px-1 py-0.5 font-mono text-[9px]">scopeMode=assigned</code>, <code className="rounded bg-white px-1 py-0.5 font-mono text-[9px]">teamIds=[]</code>, and <code className="rounded bg-white px-1 py-0.5 font-mono text-[9px]">locationIds=[]</code>.</p>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-red-200 bg-white px-3 py-1.5 text-[9px] font-bold text-red-700"><LockKeyhole size={11} aria-hidden="true" /> No implicit wildcard</span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {EMPTY_SCOPE_PATIENT_PROOFS.map((proof) => (
            <article key={proof.label} className="rounded-xl border border-red-100 bg-white p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold text-slate-900">{proof.label}</p>
                  <p className="mt-1 font-mono text-[9px] text-slate-500">contacts.view · patient</p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-[9px] font-bold uppercase text-red-700"><XCircle size={10} aria-hidden="true" /> Denied</span>
              </div>
              <p className="mt-3 rounded-lg bg-red-50 px-2.5 py-2 font-mono text-[9px] font-semibold text-red-800">{proof.decision.allowed ? "unexpected_allow" : proof.decision.reason}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)]">
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4 sm:p-5" aria-labelledby="access-explainer-title">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700"><KeyRound size={18} aria-hidden="true" /></span>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-violet-700">Interactive policy explainer</p>
              <h2 id="access-explainer-title" className="mt-1 text-base font-bold text-slate-950">Evaluate one authorization decision</h2>
              <p className="mt-1 text-[11px] leading-5 text-slate-500">Uses the seeded membership plus any local role/status preview. This UI cannot grant access.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1.5 block text-[10px] font-bold text-slate-700">Synthetic member</span>
              <select
                value={memberId ?? ""}
                onChange={(event) => {
                  setMemberId(event.target.value as MemberId);
                  announceChange("Member changed.");
                }}
                className="h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3 text-xs font-semibold text-slate-800 outline-none focus:border-[var(--brand)]"
              >
                {records.map((record) => <option key={record.membership.id} value={record.membership.id}>{record.membership.displayLabel}</option>)}
              </select>
            </label>
            <label>
              <span className="mb-1.5 block text-[10px] font-bold text-slate-700">Permission</span>
              <select
                value={permission}
                onChange={(event) => {
                  setPermission(event.target.value as Permission);
                  announceChange("Permission changed.");
                }}
                className="h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3 text-xs font-semibold text-slate-800 outline-none focus:border-[var(--brand)]"
              >
                {ACCESS_TEST_PERMISSIONS.map((candidate) => <option key={candidate} value={candidate}>{permissionLabel(candidate)}</option>)}
              </select>
            </label>
            <label>
              <span className="mb-1.5 block text-[10px] font-bold text-slate-700">Resource team</span>
              <select
                value={teamId ?? "none"}
                onChange={(event) => {
                  setTeamId(event.target.value === "none" ? null : event.target.value as TeamId);
                  announceChange("Resource team changed.");
                }}
                className="h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3 text-xs font-semibold text-slate-800 outline-none focus:border-[var(--brand)]"
              >
                <option value="none">No team on resource</option>
                {demoTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </label>
            <label>
              <span className="mb-1.5 block text-[10px] font-bold text-slate-700">Resource location</span>
              <select
                value={locationId ?? "none"}
                onChange={(event) => {
                  setLocationId(event.target.value === "none" ? null : event.target.value as LocationId);
                  announceChange("Resource location changed.");
                }}
                className="h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3 text-xs font-semibold text-slate-800 outline-none focus:border-[var(--brand)]"
              >
                <option value="none">No location on resource</option>
                {demoLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </label>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-[var(--line)] px-3 text-[10px] font-semibold text-slate-700 hover:bg-slate-50">
              <input
                type="checkbox"
                checked={patientSensitive}
                onChange={(event) => {
                  setPatientSensitive(event.target.checked);
                  announceChange("Resource sensitivity changed.");
                }}
                className="h-4 w-4 rounded border-slate-300 accent-emerald-700"
              />
              Treat as patient-sensitive resource
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 text-[10px] font-semibold text-red-800 hover:bg-red-100">
              <input
                type="checkbox"
                checked={forceEmptyAssignedScope}
                onChange={(event) => {
                  setForceEmptyAssignedScope(event.target.checked);
                  announceChange("Empty assigned scope proof changed.");
                }}
                className="h-4 w-4 rounded border-red-300 accent-red-700"
              />
              Force empty non-admin scope proof
            </label>
          </div>

          {result ? (
            <div className={`mt-4 rounded-2xl border p-4 ${result.decision.allowed ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`} aria-live="polite">
              <div className="flex items-start gap-3">
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${result.decision.allowed ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                  {result.decision.allowed ? <CheckCircle2 size={17} aria-hidden="true" /> : <XCircle size={17} aria-hidden="true" />}
                </span>
                <div>
                  <p className={`text-xs font-bold ${result.decision.allowed ? "text-emerald-950" : "text-red-950"}`}>{result.decision.allowed ? "Allowed by modeled policy" : `Denied · ${result.decision.reason}`}</p>
                  <p className={`mt-1 text-[10px] leading-5 ${result.decision.allowed ? "text-emerald-800" : "text-red-800"}`}>{result.explanation}</p>
                </div>
              </div>
              <dl className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl bg-white px-3 py-2"><dt className="text-[8px] font-bold uppercase tracking-[0.05em] text-slate-400">Role</dt><dd className="mt-1 text-[10px] font-bold text-slate-900">{ROLE_LABELS[result.evaluatedMembership.role]}</dd></div>
                <div className="rounded-xl bg-white px-3 py-2"><dt className="text-[8px] font-bold uppercase tracking-[0.05em] text-slate-400">Scope mode</dt><dd className="mt-1 text-[10px] font-bold text-slate-900">{result.evaluatedMembership.scopeMode.replaceAll("_", " ")}</dd></div>
                <div className="rounded-xl bg-white px-3 py-2"><dt className="text-[8px] font-bold uppercase tracking-[0.05em] text-slate-400">Assignments</dt><dd className="mt-1 text-[10px] font-bold text-slate-900">{result.evaluatedMembership.teamIds.length} teams · {result.evaluatedMembership.locationIds.length} locations</dd></div>
              </dl>
            </div>
          ) : null}
        </article>

        <aside className="rounded-2xl border border-[var(--line)] bg-white p-4 sm:p-5" aria-labelledby="sod-title">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-800"><Split size={18} aria-hidden="true" /></span>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-amber-700">Segregation of duties</p>
              <h2 id="sod-title" className="mt-1 text-sm font-bold text-slate-950">Independent operational roles</h2>
            </div>
          </div>
          <div className="mt-4 space-y-2.5">
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
              <p className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-950"><CheckCircle2 size={12} aria-hidden="true" /> Campaign maker ≠ approver</p>
              <p className="mt-1 text-[9px] leading-4 text-emerald-800">Operator can create; approver can approve. Their normal role permissions do not overlap those duties.</p>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
              <p className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-950"><CheckCircle2 size={12} aria-hidden="true" /> Clinical approval isolated</p>
              <p className="mt-1 text-[9px] leading-4 text-emerald-800">Clinical approver can approve a pathway but cannot manage automation definitions.</p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
              <p className="flex items-center gap-1.5 text-[10px] font-bold text-amber-950"><AlertOctagon size={12} aria-hidden="true" /> Admin override is exceptional</p>
              <p className="mt-1 text-[9px] leading-4 text-amber-800">Tenant administrator has broad permissions; production use still requires MFA, fresh authentication, audit and governance.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="flex items-center gap-1.5 text-[10px] font-bold text-slate-900"><UserRoundX size={12} aria-hidden="true" /> Self-assignment unavailable</p>
              <p className="mt-1 text-[9px] leading-4 text-slate-600">This browser does not write roles, membership status, scopes, claims, or invitations.</p>
            </div>
          </div>
        </aside>
      </section>

      <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white" aria-labelledby="permission-matrix-title">
        <div className="flex flex-col justify-between gap-2 border-b border-[var(--line)] p-4 sm:flex-row sm:items-end sm:p-5">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--brand)]">Role permission matrix</p>
            <h2 id="permission-matrix-title" className="mt-1 text-base font-bold text-slate-950">Modeled role capabilities</h2>
            <p className="mt-1 text-[11px] text-slate-500">A check is only the role layer; all tenant, membership, scope, MFA and step-up gates still apply.</p>
          </div>
          <span className="inline-flex self-start items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[9px] font-bold text-slate-600"><ShieldCheck size={11} aria-hidden="true" /> Domain constants</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[900px] w-full border-collapse text-left">
            <caption className="sr-only">Permissions granted to each modeled workspace role</caption>
            <thead>
              <tr className="bg-slate-50">
                <th scope="col" className="sticky left-0 z-[1] min-w-48 border-r border-[var(--line)] bg-slate-50 px-4 py-3 text-[9px] font-bold uppercase tracking-[0.06em] text-slate-500">Role</th>
                {PERMISSION_MATRIX_COLUMNS.map((column) => (
                  <th key={column.permission} scope="col" title={column.description} className="min-w-28 px-3 py-3 text-center text-[9px] font-bold leading-4 text-slate-500">{column.shortLabel}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {WORKSPACE_ROLES.map((role) => (
                <tr key={role} className="hover:bg-slate-50/70">
                  <th scope="row" className="sticky left-0 z-[1] border-r border-[var(--line)] bg-white px-4 py-3 text-[10px] font-bold text-slate-900">{ROLE_LABELS[role]}</th>
                  {PERMISSION_MATRIX_COLUMNS.map((column) => {
                    const granted = roleHasPermission(role, column.permission);
                    return (
                      <td key={column.permission} className="px-3 py-3 text-center">
                        <span className={`mx-auto grid h-6 w-6 place-items-center rounded-full ${granted ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`} aria-label={`${column.shortLabel}: ${granted ? "granted" : "not granted"}`}>
                          {granted ? <Check size={12} aria-hidden="true" /> : <X size={12} aria-hidden="true" />}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-3 border-t border-[var(--line)] bg-slate-50 px-4 py-3 text-[9px] font-semibold text-slate-500">
          <span className="inline-flex items-center gap-1"><span className="grid h-4 w-4 place-items-center rounded-full bg-emerald-100 text-emerald-700"><Check size={9} aria-hidden="true" /></span> Role grants capability</span>
          <span className="inline-flex items-center gap-1"><span className="grid h-4 w-4 place-items-center rounded-full bg-slate-100 text-slate-400"><X size={9} aria-hidden="true" /></span> Role does not grant capability</span>
          <span className="inline-flex items-center gap-1"><LockKeyhole size={10} aria-hidden="true" /> Server authorization remains authoritative</span>
        </div>
      </section>
    </div>
  );
}
