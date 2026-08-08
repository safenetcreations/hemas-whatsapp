"use client";

import {
  BadgeCheck,
  FlaskConical,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  Route,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MemberId,
  MembershipStatus,
  WorkspaceRole,
} from "@/lib/domain";
import { demoTeams } from "@/lib/demo";
import { MemberDetail } from "./member-detail";
import { MemberDirectory } from "./member-directory";
import { PermissionExplainer } from "./permission-explainer";
import {
  ROLE_LABELS,
  STATUS_LABELS,
  buildMemberDirectory,
  membershipWithPreview,
} from "./policy-model";
import { RoutingSimulator } from "./routing-simulator";
import type {
  LocalMembershipPreviews,
  LocalPreviewActivity,
  MemberDirectoryRecord,
  MemberRoleFilter,
  MemberScopeFilter,
  MemberStatusFilter,
} from "./types";

type WorkspaceTab = "members" | "routing" | "permissions";

const DIRECTORY_RECORDS = buildMemberDirectory();

const TABS: readonly {
  readonly id: WorkspaceTab;
  readonly label: string;
  readonly description: string;
  readonly icon: typeof UsersRound;
}[] = [
  { id: "members", label: "Members", description: "Roles and scopes", icon: UsersRound },
  { id: "routing", label: "Routing lab", description: "Queues and SLAs", icon: Route },
  { id: "permissions", label: "Access policy", description: "Matrix and proofs", icon: ShieldCheck },
];

function normalizedSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function TeamLoadingSkeleton() {
  return (
    <section aria-label="Loading synthetic team fixtures" aria-busy="true" className="grid min-h-[620px] gap-3 md:grid-cols-[320px_minmax(0,1fr)]">
      <div className="rounded-2xl border border-[var(--line)] bg-white p-4">
        <div className="h-5 w-28 animate-pulse rounded bg-slate-200" />
        <div className="mt-4 h-10 animate-pulse rounded-xl bg-slate-100" />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="h-9 animate-pulse rounded-lg bg-slate-100" />
          <div className="h-9 animate-pulse rounded-lg bg-slate-100" />
        </div>
        <div className="mt-5 space-y-3">
          {[0, 1, 2, 3, 4].map((item) => (
            <div key={item} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3">
              <div className="h-10 w-10 animate-pulse rounded-full bg-slate-200" />
              <div className="flex-1"><div className="h-3 w-2/3 animate-pulse rounded bg-slate-200" /><div className="mt-2 h-2.5 w-1/2 animate-pulse rounded bg-slate-100" /></div>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <div className="flex items-center gap-3"><div className="h-12 w-12 animate-pulse rounded-2xl bg-slate-200" /><div className="flex-1"><div className="h-4 w-52 animate-pulse rounded bg-slate-200" /><div className="mt-2 h-3 w-40 animate-pulse rounded bg-slate-100" /></div></div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2"><div className="h-44 animate-pulse rounded-2xl bg-slate-100" /><div className="h-44 animate-pulse rounded-2xl bg-slate-100" /></div>
        <div className="mt-4 h-52 animate-pulse rounded-2xl bg-slate-100" />
        <p className="mt-5 text-center text-xs font-semibold text-slate-500">Loading deterministic role and scope fixtures locally…</p>
      </div>
    </section>
  );
}

export function TeamWorkspace() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("members");
  const [selectedId, setSelectedId] = useState<MemberId | null>(DIRECTORY_RECORDS[0]?.membership.id ?? null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<MemberRoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<MemberStatusFilter>("all");
  const [scopeFilter, setScopeFilter] = useState<MemberScopeFilter>("all");
  const [previews, setPreviews] = useState<LocalMembershipPreviews>({});
  const [activities, setActivities] = useState<readonly LocalPreviewActivity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const activitySequence = useRef(0);
  const loadingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (loadingTimer.current) clearTimeout(loadingTimer.current);
  }, []);

  const selectedRecord =
    DIRECTORY_RECORDS.find((record) => record.membership.id === selectedId) ?? DIRECTORY_RECORDS[0] ?? null;

  const filteredRecords = useMemo(() => {
    const query = normalizedSearch(search);
    return DIRECTORY_RECORDS.filter((record) => {
      const membership = membershipWithPreview(record.membership, previews[record.membership.id]);
      const isEmptyAssigned =
        membership.scopeMode === "assigned" &&
        membership.teamIds.length === 0 &&
        membership.locationIds.length === 0;
      const searchable = [
        membership.displayLabel,
        record.identity?.maskedEmail ?? "",
        membership.role,
        ROLE_LABELS[membership.role],
        STATUS_LABELS[membership.status],
        ...record.teams.map((team) => team.name),
        ...record.locations.map((location) => location.name),
      ].join(" ").toLocaleLowerCase();

      const scopeMatches =
        scopeFilter === "all" ||
        (scopeFilter === "workspace_wide" && membership.scopeMode === "workspace_wide") ||
        (scopeFilter === "assigned" && membership.scopeMode === "assigned" && !isEmptyAssigned) ||
        (scopeFilter === "empty_assigned" && isEmptyAssigned);

      return (
        (!query || searchable.includes(query)) &&
        (roleFilter === "all" || membership.role === roleFilter) &&
        (statusFilter === "all" || membership.status === statusFilter) &&
        scopeMatches
      );
    });
  }, [previews, roleFilter, scopeFilter, search, statusFilter]);

  const activeMemberships = DIRECTORY_RECORDS.filter((record) =>
    membershipWithPreview(record.membership, previews[record.membership.id]).status === "active",
  ).length;
  const mfaSatisfied = DIRECTORY_RECORDS.filter((record) => record.membership.mfaSatisfied).length;
  const previewCount = Object.keys(previews).length;

  function recordActivity(memberId: MemberId, label: string) {
    activitySequence.current += 1;
    setActivities((current) => [
      {
        id: `local-team-preview-${activitySequence.current}`,
        memberId,
        label,
      },
      ...current,
    ]);
  }

  function updatePreview(patch: { readonly role?: WorkspaceRole; readonly status?: MembershipStatus }, label: string) {
    if (!selectedRecord) return;
    const memberId = selectedRecord.membership.id;
    setPreviews((current) => {
      const nextForMember = { ...current[memberId], ...patch };
      if (nextForMember.role === selectedRecord.membership.role) delete nextForMember.role;
      if (nextForMember.status === selectedRecord.membership.status) delete nextForMember.status;
      const next = { ...current };
      if (Object.keys(nextForMember).length === 0) delete next[memberId];
      else next[memberId] = nextForMember;
      return next;
    });
    recordActivity(memberId, label);
    setAnnouncement(`${label} This is a local browser preview only.`);
  }

  function resetSelectedPreview() {
    if (!selectedRecord) return;
    const memberId = selectedRecord.membership.id;
    setPreviews((current) => {
      const next = { ...current };
      delete next[memberId];
      return next;
    });
    recordActivity(memberId, "Role and membership state reset to the seeded fixture");
    setAnnouncement("Local membership preview reset. No identity or membership was changed.");
  }

  function selectRecord(record: MemberDirectoryRecord) {
    setSelectedId(record.membership.id);
    setMobileDetailOpen(true);
    setAnnouncement(`Opened ${record.membership.displayLabel}, a synthetic member fixture.`);
  }

  function resetFilters() {
    setSearch("");
    setRoleFilter("all");
    setStatusFilter("all");
    setScopeFilter("all");
    setAnnouncement("Member filters reset.");
  }

  function replayLoadingState() {
    if (loadingTimer.current) clearTimeout(loadingTimer.current);
    setIsLoading(true);
    setAnnouncement("Replaying the local team loading state. No network request is made.");
    loadingTimer.current = setTimeout(() => {
      setIsLoading(false);
      setAnnouncement("Synthetic team fixtures loaded locally.");
      loadingTimer.current = null;
    }, 650);
  }

  function selectTab(tab: WorkspaceTab) {
    setActiveTab(tab);
    setMobileDetailOpen(false);
    setAnnouncement(`${TABS.find((candidate) => candidate.id === tab)?.label ?? "Team"} view opened.`);
  }

  return (
    <div className="space-y-4 lg:space-y-5">
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]"><UsersRound size={21} aria-hidden="true" /></span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--brand)]">Least-privilege operations</p>
            <h1 className="mt-1 text-2xl font-bold tracking-[-0.035em] text-slate-950 sm:text-3xl">Team &amp; Routing</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">Explore synthetic memberships, fail-closed patient scopes, deterministic queue routing, SLA ownership, and segregation of duties.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={replayLoadingState}
            disabled={isLoading}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:text-slate-400"
          >
            <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} aria-hidden="true" /> Replay loading state
          </button>
          <button
            type="button"
            disabled
            title="Invitations require production identity governance and are unavailable in the synthetic demo"
            className="inline-flex h-10 cursor-not-allowed items-center gap-2 rounded-xl bg-slate-200 px-3 text-xs font-bold text-slate-400"
          >
            <UserPlus size={14} aria-hidden="true" /> Invite unavailable
          </button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Synthetic team metrics">
        <article className="rounded-xl border border-[var(--line)] bg-white px-3 py-2.5"><p className="text-[9px] font-bold uppercase tracking-[0.06em] text-slate-400">Demo members</p><p className="mt-1 text-lg font-bold text-slate-900">{DIRECTORY_RECORDS.length}</p><p className="text-[9px] text-slate-500">{activeMemberships} active preview</p></article>
        <article className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2.5"><p className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.06em] text-cyan-600"><Route size={10} aria-hidden="true" /> Queues</p><p className="mt-1 text-lg font-bold text-cyan-900">{demoTeams.length}</p><p className="text-[9px] text-cyan-700">Read-only SLA fixtures</p></article>
        <article className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5"><p className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.06em] text-emerald-600"><BadgeCheck size={10} aria-hidden="true" /> MFA fixture</p><p className="mt-1 text-lg font-bold text-emerald-900">{mfaSatisfied}/{DIRECTORY_RECORDS.length}</p><p className="text-[9px] text-emerald-700">Production MFA pending</p></article>
        <article className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5"><p className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.06em] text-violet-600"><FlaskConical size={10} aria-hidden="true" /> Local previews</p><p className="mt-1 text-lg font-bold text-violet-900">{previewCount}</p><p className="text-[9px] text-violet-700">No persisted changes</p></article>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center" role="status">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-800"><LockKeyhole size={17} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-amber-950">Production identity controls are pending</p>
          <p className="mt-0.5 text-[11px] leading-5 text-amber-800">SSO, MFA enrollment, role claims, directory sync and governed invitations are not connected. Previews stay in this browser and never call Auth, Firestore, or a network API.</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-amber-300 bg-white px-3 py-1.5 text-[10px] font-bold text-amber-800 sm:self-auto"><ShieldAlert size={12} aria-hidden="true" /> Fail closed</span>
      </section>

      <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>

      <div className="rounded-2xl border border-[var(--line)] bg-white p-1.5" role="tablist" aria-label="Team and routing views">
        <div className="grid grid-cols-3 gap-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`team-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`team-panel-${tab.id}`}
                onClick={() => selectTab(tab.id)}
                className={`flex min-h-12 items-center justify-center gap-1 rounded-xl px-1 text-center transition sm:gap-2 sm:px-3 sm:text-left ${selected ? "bg-[var(--brand-soft)] text-[var(--brand-strong)]" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"}`}
              >
                <Icon className="hidden shrink-0 sm:block" size={16} aria-hidden="true" />
                <span><span className="block text-[10px] font-bold sm:text-[11px]">{tab.label}</span><span className="hidden text-[9px] opacity-75 sm:block">{tab.description}</span></span>
              </button>
            );
          })}
        </div>
      </div>

      {isLoading ? <TeamLoadingSkeleton /> : (
        <>
          <div id="team-panel-members" role="tabpanel" aria-labelledby="team-tab-members" hidden={activeTab !== "members"}>
            {activeTab === "members" ? (
              <div className="grid gap-3 md:h-[calc(100dvh-25rem)] md:min-h-[680px] md:grid-cols-[320px_minmax(0,1fr)]">
                <div className={`min-h-0 min-w-0 md:h-full ${mobileDetailOpen ? "hidden md:block" : "block"}`}>
                  <MemberDirectory
                    records={filteredRecords}
                    selectedId={selectedRecord?.membership.id ?? null}
                    previews={previews}
                    search={search}
                    roleFilter={roleFilter}
                    statusFilter={statusFilter}
                    scopeFilter={scopeFilter}
                    onSearchChange={setSearch}
                    onRoleFilterChange={setRoleFilter}
                    onStatusFilterChange={setStatusFilter}
                    onScopeFilterChange={setScopeFilter}
                    onSelect={selectRecord}
                    onResetFilters={resetFilters}
                  />
                </div>
                <div className={`min-h-0 min-w-0 md:h-full ${mobileDetailOpen ? "block" : "hidden md:block"}`}>
                  {selectedRecord ? (
                    <MemberDetail
                      record={selectedRecord}
                      preview={previews[selectedRecord.membership.id]}
                      activities={activities.filter((activity) => activity.memberId === selectedRecord.membership.id)}
                      onRolePreview={(role) => updatePreview({ role }, `Role preview changed to ${ROLE_LABELS[role]}`)}
                      onStatusPreview={(status) => updatePreview({ status }, `Membership state preview changed to ${STATUS_LABELS[status]}`)}
                      onResetPreview={resetSelectedPreview}
                      onBack={() => setMobileDetailOpen(false)}
                    />
                  ) : (
                    <div className="grid min-h-[620px] place-items-center rounded-2xl border border-[var(--line)] bg-white p-6 text-center"><div><UsersRound className="mx-auto text-slate-400" size={22} aria-hidden="true" /><p className="mt-2 text-sm font-bold text-slate-900">No member selected</p></div></div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
          <div id="team-panel-routing" role="tabpanel" aria-labelledby="team-tab-routing" hidden={activeTab !== "routing"}>
            {activeTab === "routing" ? <RoutingSimulator onAnnounce={setAnnouncement} /> : null}
          </div>
          <div id="team-panel-permissions" role="tabpanel" aria-labelledby="team-tab-permissions" hidden={activeTab !== "permissions"}>
            {activeTab === "permissions" ? <PermissionExplainer records={DIRECTORY_RECORDS} previews={previews} onAnnounce={setAnnouncement} /> : null}
          </div>
        </>
      )}

      <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-950 px-4 py-3 text-white sm:flex-row sm:items-center">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10"><KeyRound size={16} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1"><p className="text-xs font-bold">Authorization remains server-owned</p><p className="mt-0.5 text-[10px] leading-5 text-slate-300">The matrix explains modeled policy only. Production access must agree across SSO/MFA, custom claims, Security Rules, server APIs, audit and Hemas governance.</p></div>
        <span className="inline-flex self-start rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[9px] font-bold text-slate-200 sm:self-auto">No Auth or Firestore mutation</span>
      </section>
    </div>
  );
}
