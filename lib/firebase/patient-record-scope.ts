import type { WorkspaceRole } from "./workspace-session-model";

const PATIENT_OPERATION_ROLES: readonly WorkspaceRole[] = [
  "tenant_admin",
  "supervisor",
  "agent",
  "clinical_approver",
];

export const MAX_PATIENT_RECORD_SCOPE_PAIRS = 100;

export interface PatientRecordAuthority {
  readonly workspaceId: string;
  readonly role: WorkspaceRole;
  readonly scopeMode: "assigned" | "workspace_wide";
  readonly teamIds: readonly string[];
  readonly locationIds: readonly string[];
}

export interface PatientRecordScopeTeam {
  readonly id: string;
  readonly workspaceId: string;
  readonly locationIds: readonly string[];
  readonly active: boolean;
}

export interface PatientRecordScopeLocation {
  readonly id: string;
  readonly workspaceId: string;
  readonly active: boolean;
}

export interface PatientRecordScopePair {
  readonly teamId: string;
  readonly locationId: string;
}

export type PatientRecordScopePlan =
  | { readonly kind: "workspace_wide"; readonly pairs: readonly [] }
  | { readonly kind: "scoped"; readonly pairs: readonly PatientRecordScopePair[] }
  | {
      readonly kind: "denied";
      readonly pairs: readonly [];
      readonly reason:
        | "role_not_permitted"
        | "scope_missing"
        | "scope_invalid"
        | "scope_too_large";
    };

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function byId<T extends { readonly id: string }>(records: readonly T[]): Map<string, T> {
  return new Map(records.map((record) => [record.id, record]));
}

/**
 * Converts an authoritative membership into the exact team-and-location pairs
 * required by Firestore Rules for patient-operational collection queries.
 */
export function buildPatientRecordScopePlan(
  authority: PatientRecordAuthority,
  teams: readonly PatientRecordScopeTeam[],
  locations: readonly PatientRecordScopeLocation[],
): PatientRecordScopePlan {
  if (authority.role === "tenant_admin" && authority.scopeMode === "workspace_wide") {
    return { kind: "workspace_wide", pairs: [] };
  }

  if (authority.scopeMode === "workspace_wide") {
    return { kind: "denied", pairs: [], reason: "scope_invalid" };
  }

  if (!PATIENT_OPERATION_ROLES.includes(authority.role)) {
    return { kind: "denied", pairs: [], reason: "role_not_permitted" };
  }

  const teamIds = unique(authority.teamIds);
  const locationIds = unique(authority.locationIds);
  if (teamIds.length === 0 || locationIds.length === 0) {
    return { kind: "denied", pairs: [], reason: "scope_missing" };
  }

  const activeTeams = teams.filter(
    (team) => team.active && team.workspaceId === authority.workspaceId,
  );
  const activeLocations = locations.filter(
    (location) => location.active && location.workspaceId === authority.workspaceId,
  );
  const teamMap = byId(activeTeams);
  const locationMap = byId(activeLocations);
  if (
    teamIds.some((teamId) => !teamMap.has(teamId)) ||
    locationIds.some((locationId) => !locationMap.has(locationId))
  ) {
    return { kind: "denied", pairs: [], reason: "scope_invalid" };
  }

  const permittedLocations = new Set(locationIds);
  const pairs: PatientRecordScopePair[] = [];
  for (const teamId of teamIds) {
    const team = teamMap.get(teamId);
    if (!team) {
      return { kind: "denied", pairs: [], reason: "scope_invalid" };
    }
    for (const locationId of unique(team.locationIds)) {
      if (permittedLocations.has(locationId)) {
        pairs.push({ teamId, locationId });
      }
    }
  }

  const dedupedPairs = [
    ...new Map(pairs.map((pair) => [`${pair.teamId}\u0000${pair.locationId}`, pair])).values(),
  ];
  if (dedupedPairs.length === 0) {
    return { kind: "denied", pairs: [], reason: "scope_missing" };
  }
  if (dedupedPairs.length > MAX_PATIENT_RECORD_SCOPE_PAIRS) {
    return { kind: "denied", pairs: [], reason: "scope_too_large" };
  }

  return { kind: "scoped", pairs: dedupedPairs };
}
