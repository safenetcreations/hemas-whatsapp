import {
  ArrowLeft,
  BadgeCheck,
  Ban,
  Building2,
  Check,
  Clock3,
  KeyRound,
  LockKeyhole,
  MapPin,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  UserRoundCog,
  UsersRound,
  X,
} from "lucide-react";
import type {
  MembershipStatus,
  Permission,
  WorkspaceMembership,
  WorkspaceRole,
} from "@/lib/domain";
import {
  MEMBERSHIP_STATUSES,
  PERMISSION_MATRIX_COLUMNS,
  ROLE_LABELS,
  STATUS_LABELS,
  WORKSPACE_ROLES,
  membershipWithPreview,
  roleHasPermission,
} from "./policy-model";
import type {
  LocalMembershipPreview,
  LocalPreviewActivity,
  MemberDirectoryRecord,
} from "./types";

interface MemberDetailProps {
  readonly record: MemberDirectoryRecord;
  readonly preview: LocalMembershipPreview | undefined;
  readonly activities: readonly LocalPreviewActivity[];
  readonly onRolePreview: (role: WorkspaceRole) => void;
  readonly onStatusPreview: (status: MembershipStatus) => void;
  readonly onResetPreview: () => void;
  readonly onBack: () => void;
}

const EXTRA_CAPABILITIES: readonly {
  permission: Permission;
  shortLabel: string;
  description: string;
}[] = [
  { permission: "contacts.manage", shortLabel: "Manage contact preferences", description: "Manage contact preferences inside the authorized scope." },
  { permission: "appointments.manage", shortLabel: "Manage appointments", description: "Manage appointment workflow inside the authorized scope." },
  { permission: "audit.view", shortLabel: "View audit evidence", description: "Read governed audit metadata." },
  { permission: "analytics.view_aggregate", shortLabel: "View aggregate analytics", description: "Read aggregate, non-patient analytics." },
];

function formatRole(role: WorkspaceRole): string {
  return ROLE_LABELS[role];
}

function scopeSummary(membership: WorkspaceMembership): string {
  if (membership.scopeMode === "workspace_wide") {
    return "Explicit workspace-wide wildcard · reserved for active tenant administrators";
  }
  if (membership.teamIds.length === 0 && membership.locationIds.length === 0) {
    return "Empty assigned scope · patient access denied";
  }
  return "Explicit team and location assignments";
}

export function MemberDetail({
  record,
  preview,
  activities,
  onRolePreview,
  onStatusPreview,
  onResetPreview,
  onBack,
}: MemberDetailProps) {
  const membership = membershipWithPreview(record.membership, preview);
  const previewActive = Boolean(preview);
  const invalidWildcard =
    membership.scopeMode === "workspace_wide" && membership.role !== "tenant_admin";
  const emptyAssigned =
    membership.scopeMode === "assigned" &&
    membership.teamIds.length === 0 &&
    membership.locationIds.length === 0;
  const displayedCapabilities = [...PERMISSION_MATRIX_COLUMNS, ...EXTRA_CAPABILITIES];

  return (
    <section className="scrollbar-subtle h-full min-h-[620px] overflow-y-auto rounded-2xl border border-[var(--line)] bg-white md:min-h-0">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-[var(--line)] bg-white/95 px-4 py-3 backdrop-blur md:hidden">
        <button
          type="button"
          onClick={onBack}
          className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--line)] text-slate-700 hover:bg-slate-50"
          aria-label="Back to member directory"
        >
          <ArrowLeft size={17} aria-hidden="true" />
        </button>
        <p className="text-xs font-bold text-slate-900">Member detail</p>
      </div>

      <div className="border-b border-[var(--line)] p-4 sm:p-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-slate-900 text-sm font-bold text-white" aria-hidden="true">
              {record.membership.displayLabel.split(" ").slice(-1)[0]?.slice(0, 2).toUpperCase() ?? "DM"}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-lg font-bold tracking-[-0.025em] text-slate-950">{record.membership.displayLabel}</h2>
                <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.05em] text-violet-700">Synthetic</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">{record.identity?.maskedEmail ?? "No demo identity"}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[9px] font-bold text-slate-700"><KeyRound size={10} aria-hidden="true" /> {formatRole(membership.role)}</span>
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[9px] font-bold ${membership.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                  {membership.status === "active" ? <Check size={10} aria-hidden="true" /> : <Ban size={10} aria-hidden="true" />}
                  {STATUS_LABELS[membership.status]}
                </span>
                {previewActive ? <span className="rounded-full bg-violet-100 px-2.5 py-1 text-[9px] font-bold text-violet-800">Browser preview only</span> : null}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onResetPreview}
            disabled={!previewActive}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[var(--line)] px-3 text-[10px] font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
          >
            <RotateCcw size={12} aria-hidden="true" /> Reset preview
          </button>
        </div>
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        <section className="rounded-2xl border border-violet-200 bg-violet-50 p-4" aria-labelledby="membership-preview-title">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700"><UserRoundCog size={17} aria-hidden="true" /></span>
            <div>
              <h3 id="membership-preview-title" className="text-xs font-bold text-violet-950">Local membership preview</h3>
              <p className="mt-1 text-[11px] leading-5 text-violet-800">Explore policy outcomes without changing Auth, Firestore, claims, invitations, or server authorization.</p>
            </div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1 block text-[10px] font-bold text-violet-900">Preview role</span>
              <select
                value={membership.role}
                onChange={(event) => onRolePreview(event.target.value as WorkspaceRole)}
                className="h-10 w-full rounded-xl border border-violet-200 bg-white px-3 text-xs font-semibold text-slate-800 outline-none focus:border-violet-500"
              >
                {WORKSPACE_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-[10px] font-bold text-violet-900">Preview membership state</span>
              <select
                value={membership.status}
                onChange={(event) => onStatusPreview(event.target.value as MembershipStatus)}
                className="h-10 w-full rounded-xl border border-violet-200 bg-white px-3 text-xs font-semibold text-slate-800 outline-none focus:border-violet-500"
              >
                {MEMBERSHIP_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
              </select>
            </label>
          </div>
          <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-4 text-violet-800">
            <LockKeyhole size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
            Role preview never grants a wildcard. The source fixture’s scope mode stays fixed and server checks still decide access.
          </p>
        </section>

        <section className={`rounded-2xl border p-4 ${emptyAssigned || invalidWildcard ? "border-red-200 bg-red-50" : membership.scopeMode === "workspace_wide" ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`} aria-labelledby="member-scope-title">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-slate-500">Patient-data boundary</p>
              <h3 id="member-scope-title" className="mt-1 text-sm font-bold text-slate-950">{scopeSummary(membership)}</h3>
            </div>
            {emptyAssigned || invalidWildcard ? <ShieldAlert className="shrink-0 text-red-600" size={20} aria-hidden="true" /> : <ShieldCheck className="shrink-0 text-emerald-700" size={20} aria-hidden="true" />}
          </div>
          {invalidWildcard ? (
            <p className="mt-2 rounded-xl bg-white px-3 py-2 text-[10px] font-semibold leading-4 text-red-700">Invalid preview: workspace-wide scope is reserved for the tenant administrator role, so access fails closed.</p>
          ) : null}
          {emptyAssigned ? (
            <p className="mt-2 rounded-xl bg-white px-3 py-2 text-[10px] font-semibold leading-4 text-red-700">An empty non-admin team/location scope grants zero patient or conversation access.</p>
          ) : null}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-white/80 bg-white p-3">
              <p className="flex items-center gap-1.5 text-[10px] font-bold text-slate-800"><UsersRound size={12} aria-hidden="true" /> Assigned teams</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {record.teams.length > 0 ? record.teams.map((team) => (
                  <span key={team.id} className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-semibold text-slate-700">{team.name}</span>
                )) : <span className="text-[10px] font-semibold text-red-700">None assigned</span>}
              </div>
            </div>
            <div className="rounded-xl border border-white/80 bg-white p-3">
              <p className="flex items-center gap-1.5 text-[10px] font-bold text-slate-800"><MapPin size={12} aria-hidden="true" /> Assigned locations</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {record.locations.length > 0 ? record.locations.map((location) => (
                  <span key={location.id} className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-semibold text-slate-700">{location.name}</span>
                )) : <span className={membership.scopeMode === "workspace_wide" ? "text-[10px] font-semibold text-emerald-700" : "text-[10px] font-semibold text-red-700"}>{membership.scopeMode === "workspace_wide" ? "Covered by explicit admin wildcard" : "None assigned"}</span>}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-3" aria-label="Identity assurance fixture">
          <article className="rounded-xl border border-[var(--line)] p-3">
            <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.06em] text-slate-400"><Building2 size={11} aria-hidden="true" /> Identity provider</p>
            <p className="mt-2 text-xs font-bold capitalize text-slate-900">{record.identity?.identityProvider.replaceAll("_", " ") ?? "Unavailable"}</p>
            <p className="mt-1 text-[9px] leading-4 text-slate-500">Demo claim only</p>
          </article>
          <article className="rounded-xl border border-[var(--line)] p-3">
            <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.06em] text-slate-400"><BadgeCheck size={11} aria-hidden="true" /> MFA fixture</p>
            <p className={`mt-2 text-xs font-bold ${membership.mfaSatisfied ? "text-emerald-700" : "text-amber-700"}`}>{membership.mfaSatisfied ? "Satisfied in fixture" : "Not satisfied"}</p>
            <p className="mt-1 text-[9px] leading-4 text-slate-500">Production MFA pending</p>
          </article>
          <article className="rounded-xl border border-[var(--line)] p-3">
            <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.06em] text-slate-400"><Clock3 size={11} aria-hidden="true" /> Last auth</p>
            <p className="mt-2 text-xs font-bold text-slate-900">Deterministic demo clock</p>
            <p className="mt-1 truncate text-[9px] leading-4 text-slate-500">{membership.lastAuthenticatedAt}</p>
          </article>
        </section>

        <section className="rounded-2xl border border-[var(--line)] p-4" aria-labelledby="capability-title">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 id="capability-title" className="text-xs font-bold text-slate-950">Role capability preview</h3>
              <p className="mt-1 text-[10px] text-slate-500">Role permission is necessary but never bypasses membership, scope, MFA, or step-up gates.</p>
            </div>
            <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[9px] font-bold text-slate-600">{formatRole(membership.role)}</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {displayedCapabilities.map(({ permission, shortLabel }) => {
              const allowedByRole = roleHasPermission(membership.role, permission);
              return (
                <div key={permission} className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${allowedByRole ? "border-emerald-100 bg-emerald-50" : "border-slate-100 bg-slate-50"}`}>
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${allowedByRole ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-500"}`}>
                    {allowedByRole ? <Check size={11} aria-hidden="true" /> : <X size={11} aria-hidden="true" />}
                  </span>
                  <span className={`text-[10px] font-semibold ${allowedByRole ? "text-emerald-900" : "text-slate-500"}`}>{shortLabel}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--line)] bg-slate-50 p-4" aria-labelledby="preview-activity-title">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 id="preview-activity-title" className="text-xs font-bold text-slate-950">Local preview activity</h3>
              <p className="mt-1 text-[10px] text-slate-500">Browser-only interactions; these are not audit events.</p>
            </div>
            <span className="text-[10px] font-bold text-slate-500">{activities.length}</span>
          </div>
          {activities.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-slate-200 bg-white px-3 py-4 text-center text-[10px] text-slate-500">No local preview changes for this member.</p>
          ) : (
            <ol className="mt-3 space-y-2">
              {activities.slice(0, 5).map((activity) => (
                <li key={activity.id} className="flex items-start gap-2 rounded-xl bg-white px-3 py-2 text-[10px] leading-4 text-slate-600">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" aria-hidden="true" />
                  {activity.label}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </section>
  );
}
