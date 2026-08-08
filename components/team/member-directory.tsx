import {
  KeyRound,
  MapPin,
  Search,
  ShieldAlert,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import type { MemberId, WorkspaceMembership } from "@/lib/domain";
import {
  MEMBERSHIP_STATUSES,
  ROLE_LABELS,
  STATUS_LABELS,
  WORKSPACE_ROLES,
  membershipWithPreview,
} from "./policy-model";
import type {
  LocalMembershipPreviews,
  MemberDirectoryRecord,
  MemberRoleFilter,
  MemberScopeFilter,
  MemberStatusFilter,
} from "./types";

interface MemberDirectoryProps {
  readonly records: readonly MemberDirectoryRecord[];
  readonly selectedId: MemberId | null;
  readonly previews: LocalMembershipPreviews;
  readonly search: string;
  readonly roleFilter: MemberRoleFilter;
  readonly statusFilter: MemberStatusFilter;
  readonly scopeFilter: MemberScopeFilter;
  readonly onSearchChange: (value: string) => void;
  readonly onRoleFilterChange: (value: MemberRoleFilter) => void;
  readonly onStatusFilterChange: (value: MemberStatusFilter) => void;
  readonly onScopeFilterChange: (value: MemberScopeFilter) => void;
  readonly onSelect: (record: MemberDirectoryRecord) => void;
  readonly onResetFilters: () => void;
}

const STATUS_STYLES = {
  active: "bg-emerald-50 text-emerald-700",
  invited: "bg-cyan-50 text-cyan-700",
  suspended: "bg-amber-50 text-amber-800",
  revoked: "bg-red-50 text-red-700",
} as const;

function scopeLabel(membership: WorkspaceMembership): string {
  if (membership.scopeMode === "workspace_wide") return "Explicit admin wildcard";
  if (membership.teamIds.length === 0 && membership.locationIds.length === 0) {
    return "Empty assigned scope · no patient access";
  }
  return `${membership.teamIds.length} team${membership.teamIds.length === 1 ? "" : "s"} · ${membership.locationIds.length} location${membership.locationIds.length === 1 ? "" : "s"}`;
}

export function MemberDirectory({
  records,
  selectedId,
  previews,
  search,
  roleFilter,
  statusFilter,
  scopeFilter,
  onSearchChange,
  onRoleFilterChange,
  onStatusFilterChange,
  onScopeFilterChange,
  onSelect,
  onResetFilters,
}: MemberDirectoryProps) {
  return (
    <section className="flex h-full min-h-[620px] flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-white md:min-h-0">
      <div className="border-b border-[var(--line)] p-3.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-950">Synthetic members</h2>
            <p className="mt-0.5 text-[10px] text-slate-500">{records.length} matching fixture{records.length === 1 ? "" : "s"}</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.06em] text-slate-600">
            Demo identities
          </span>
        </div>

        <label className="relative mt-3 block">
          <span className="sr-only">Search synthetic team members</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search member, role, team…"
            className="h-10 w-full rounded-xl border border-[var(--line)] bg-slate-50 pl-9 pr-3 text-xs text-slate-900 outline-none placeholder:text-slate-400 focus:border-[var(--brand)] focus:bg-white"
          />
        </label>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <label>
            <span className="sr-only">Filter members by role</span>
            <select
              value={roleFilter}
              onChange={(event) => onRoleFilterChange(event.target.value as MemberRoleFilter)}
              className="h-9 w-full rounded-lg border border-[var(--line)] bg-white px-2 text-[11px] font-medium text-slate-700 outline-none focus:border-[var(--brand)]"
            >
              <option value="all">All roles</option>
              {WORKSPACE_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Filter members by status</span>
            <select
              value={statusFilter}
              onChange={(event) => onStatusFilterChange(event.target.value as MemberStatusFilter)}
              className="h-9 w-full rounded-lg border border-[var(--line)] bg-white px-2 text-[11px] font-medium text-slate-700 outline-none focus:border-[var(--brand)]"
            >
              <option value="all">All statuses</option>
              {MEMBERSHIP_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
            </select>
          </label>
        </div>

        <label className="mt-2 block">
          <span className="sr-only">Filter members by access scope</span>
          <select
            value={scopeFilter}
            onChange={(event) => onScopeFilterChange(event.target.value as MemberScopeFilter)}
            className="h-9 w-full rounded-lg border border-[var(--line)] bg-white px-2 text-[11px] font-medium text-slate-700 outline-none focus:border-[var(--brand)]"
          >
            <option value="all">All access scopes</option>
            <option value="workspace_wide">Explicit admin wildcard</option>
            <option value="assigned">Assigned teams / locations</option>
            <option value="empty_assigned">Empty assigned · deny</option>
          </select>
        </label>
      </div>

      <div className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto" aria-live="polite">
        {records.length === 0 ? (
          <div className="grid min-h-80 place-items-center p-6 text-center">
            <div>
              <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-500">
                <Search size={19} aria-hidden="true" />
              </span>
              <h3 className="mt-3 text-sm font-bold text-slate-900">No synthetic members</h3>
              <p className="mt-1 max-w-[230px] text-xs leading-5 text-slate-500">
                No seeded membership matches these filters. Reset them to restore the directory.
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
              const effectiveMembership = membershipWithPreview(
                record.membership,
                previews[record.membership.id],
              );
              const selected = selectedId === record.membership.id;
              const hasPreview = Boolean(previews[record.membership.id]);
              const emptyAssigned =
                effectiveMembership.scopeMode === "assigned" &&
                effectiveMembership.teamIds.length === 0 &&
                effectiveMembership.locationIds.length === 0;

              return (
                <li key={record.membership.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(record)}
                    aria-pressed={selected}
                    className={`relative w-full px-3.5 py-3 text-left transition ${selected ? "bg-[var(--brand-soft)]" : "hover:bg-slate-50"}`}
                  >
                    {emptyAssigned ? <span className="absolute inset-y-0 left-0 w-1 bg-red-500" aria-hidden="true" /> : null}
                    <span className="flex items-start gap-3">
                      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-bold ${emptyAssigned ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700"}`} aria-hidden="true">
                        {record.membership.displayLabel.split(" ").slice(-1)[0]?.slice(0, 2).toUpperCase() ?? "DM"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className="truncate text-[13px] font-bold text-slate-900">{record.membership.displayLabel}</span>
                          {hasPreview ? (
                            <span className="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.04em] text-violet-700">Local preview</span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-slate-500">{record.identity?.maskedEmail ?? "No demo identity"}</span>
                        <span className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold text-slate-600">
                            <KeyRound size={9} aria-hidden="true" /> {ROLE_LABELS[effectiveMembership.role]}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${STATUS_STYLES[effectiveMembership.status]}`}>
                            {STATUS_LABELS[effectiveMembership.status]}
                          </span>
                        </span>
                        <span className={`mt-2 flex items-center gap-1 text-[9px] font-semibold ${emptyAssigned ? "text-red-700" : "text-slate-400"}`}>
                          {emptyAssigned ? <ShieldAlert size={10} aria-hidden="true" /> : effectiveMembership.scopeMode === "workspace_wide" ? <ShieldCheck size={10} aria-hidden="true" /> : <MapPin size={10} aria-hidden="true" />}
                          <span className="truncate">{scopeLabel(effectiveMembership)}</span>
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

      <div className="border-t border-[var(--line)] bg-slate-50 px-3.5 py-2.5 text-[10px] leading-4 text-slate-500">
        <span className="inline-flex items-center gap-1 font-bold text-slate-700"><UsersRound size={11} aria-hidden="true" /> No directory sync</span>
        <span> · Identity and membership data are deterministic fixtures.</span>
      </div>
    </section>
  );
}
