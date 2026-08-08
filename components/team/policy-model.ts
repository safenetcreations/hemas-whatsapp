import {
  authorizeWorkspaceAction,
  hasPermission,
  type AuthorizationDenialReason,
  type Location,
  type MembershipStatus,
  type Permission,
  type ResourceScope,
  type SupportedLanguage,
  type Team,
  type WorkspaceMembership,
  type WorkspaceRole,
} from "@/lib/domain";
import {
  DEMO_CLOCK,
  DEMO_IDS,
  demoLocations,
  demoMemberships,
  demoStaffIdentities,
  demoTeams,
} from "@/lib/demo";
import type {
  AccessTestInput,
  AccessTestResult,
  LocalMembershipPreview,
  MemberDirectoryRecord,
  RoutingInput,
  RoutingResult,
} from "./types";

export const WORKSPACE_ROLES: readonly WorkspaceRole[] = [
  "platform_owner",
  "tenant_admin",
  "supervisor",
  "agent",
  "campaign_operator",
  "campaign_approver",
  "analyst",
  "privacy_reviewer",
  "clinical_approver",
];

export const MEMBERSHIP_STATUSES: readonly MembershipStatus[] = [
  "active",
  "invited",
  "suspended",
  "revoked",
];

export const ROLE_LABELS: Readonly<Record<WorkspaceRole, string>> = {
  platform_owner: "Platform owner",
  tenant_admin: "Tenant administrator",
  supervisor: "Supervisor",
  agent: "Patient services agent",
  campaign_operator: "Campaign operator",
  campaign_approver: "Campaign approver",
  analyst: "Aggregate analyst",
  privacy_reviewer: "Privacy reviewer",
  clinical_approver: "Clinical approver",
};

export const STATUS_LABELS: Readonly<Record<MembershipStatus, string>> = {
  active: "Active",
  invited: "Invited",
  suspended: "Suspended",
  revoked: "Revoked",
};

export const LANGUAGE_LABELS: Readonly<Record<SupportedLanguage, string>> = {
  en: "English",
  si: "සිංහල",
  ta: "தமிழ்",
};

export const ROUTING_INTENT_LABELS = {
  appointment: "Appointment or reschedule",
  general_question: "General patient question",
  laboratory: "Laboratory or report journey",
  urgent_clinical: "Urgent clinical language",
  international_patient: "International patient enquiry",
} as const;

export const PERMISSION_MATRIX_COLUMNS: readonly {
  readonly permission: Permission;
  readonly shortLabel: string;
  readonly description: string;
}[] = [
  {
    permission: "inbox.view",
    shortLabel: "View inbox",
    description: "Read conversations only inside an authorized patient scope.",
  },
  {
    permission: "inbox.reply",
    shortLabel: "Reply",
    description: "Draft or send a reply after all server-side safety gates pass.",
  },
  {
    permission: "workspace.manage_members",
    shortLabel: "Members",
    description: "Manage memberships with MFA and recent authentication.",
  },
  {
    permission: "campaigns.create",
    shortLabel: "Create campaign",
    description: "Build a campaign but not approve it.",
  },
  {
    permission: "campaigns.approve",
    shortLabel: "Approve campaign",
    description: "Approve a separately prepared campaign.",
  },
  {
    permission: "clinical.approve_pathways",
    shortLabel: "Clinical approval",
    description: "Approve governed clinical pathway content.",
  },
  {
    permission: "exports.create",
    shortLabel: "Export",
    description: "Request a governed export with MFA and step-up authentication.",
  },
];

export const ACCESS_TEST_PERMISSIONS: readonly Permission[] = [
  "inbox.view",
  "inbox.reply",
  "contacts.view",
  "appointments.manage",
  "workspace.manage_members",
  "campaigns.create",
  "campaigns.approve",
  "campaigns.launch",
  "clinical.approve_pathways",
  "exports.create",
];

const DENIAL_EXPLANATIONS: Readonly<Record<AuthorizationDenialReason, string>> = {
  membership_inactive: "The membership is not active, so authorization stops before role or scope checks.",
  cross_workspace: "The resource belongs to another workspace. Tenant boundaries fail closed.",
  permission_missing: "The role does not include this capability.",
  invalid_scope_configuration:
    "The patient resource or membership lacks a valid explicit scope. Empty scope is never treated as unrestricted.",
  team_out_of_scope: "The requested queue is not assigned to this membership.",
  location_out_of_scope: "The requested location is not assigned to this membership.",
  recent_auth_required: "This sensitive action requires a fresh step-up authentication.",
  mfa_required: "This sensitive action requires an MFA-verified session.",
};

export function buildMemberDirectory(): readonly MemberDirectoryRecord[] {
  return demoMemberships.map((membership) => ({
    membership,
    identity: demoStaffIdentities.find((identity) => identity.uid === membership.uid) ?? null,
    teams: demoTeams.filter((team) => membership.teamIds.includes(team.id)),
    locations: demoLocations.filter((location) => membership.locationIds.includes(location.id)),
  }));
}

export function membershipWithPreview(
  membership: WorkspaceMembership,
  preview: LocalMembershipPreview | undefined,
): WorkspaceMembership {
  return {
    ...membership,
    role: preview?.role ?? membership.role,
    status: preview?.status ?? membership.status,
  };
}

export function explainAccessTest(
  membership: WorkspaceMembership,
  input: AccessTestInput,
): AccessTestResult {
  const evaluatedMembership: WorkspaceMembership = input.forceEmptyAssignedScope
    ? {
        ...membership,
        role: membership.role === "tenant_admin" ? "agent" : membership.role,
        scopeMode: "assigned",
        teamIds: [],
        locationIds: [],
      }
    : membership;

  const resource: ResourceScope = input.patientSensitive
    ? input.teamId !== null && input.locationId !== null
      ? {
          workspaceId: membership.workspaceId,
          sensitivity: "patient",
          teamId: input.teamId,
          locationId: input.locationId,
        }
      : ({
          workspaceId: membership.workspaceId,
          sensitivity: "patient",
        } as unknown as ResourceScope)
    : {
        workspaceId: membership.workspaceId,
        sensitivity: "workspace",
      };

  const decision = authorizeWorkspaceAction({
    membership: evaluatedMembership,
    permission: input.permission,
    resource,
    now: DEMO_CLOCK.now,
  });

  return {
    decision,
    evaluatedMembership,
    explanation: decision.allowed
      ? "The active membership, role permission, tenant, explicit scope and session gates all agree."
      : DENIAL_EXPLANATIONS[decision.reason],
  };
}

export function roleHasPermission(role: WorkspaceRole, permission: Permission): boolean {
  return hasPermission(role, permission);
}

function findTeam(id: Team["id"]): Team {
  const team = demoTeams.find((candidate) => candidate.id === id);
  if (!team) throw new Error(`Missing deterministic demo team: ${id}`);
  return team;
}

function findOwner(id: WorkspaceMembership["id"]): WorkspaceMembership {
  const owner = demoMemberships.find((candidate) => candidate.id === id);
  if (!owner) throw new Error(`Missing deterministic SLA owner: ${id}`);
  return owner;
}

export function queueOwner(team: Team): WorkspaceMembership {
  if (team.id === DEMO_IDS.teams.clinicalEscalation) {
    return findOwner(DEMO_IDS.members.clinicalApprover);
  }
  return findOwner(DEMO_IDS.members.supervisor);
}

function addMinutes(value: string, minutes: number): string {
  return new Date(Date.parse(value) + minutes * 60_000).toISOString();
}

function languageLane(language: SupportedLanguage): string {
  return `${LANGUAGE_LABELS[language]} service lane`;
}

function held(input: RoutingInput, reason: string): RoutingResult {
  return {
    outcome: "held",
    input,
    languageLane: languageLane(input.language),
    reason,
    simulatedAt: DEMO_CLOCK.now,
  };
}

function routed(input: RoutingInput, team: Team, reason: string): RoutingResult {
  return {
    outcome: "routed",
    input,
    team,
    owner: queueOwner(team),
    languageLane: languageLane(input.language),
    reason,
    simulatedAt: DEMO_CLOCK.now,
    slaDueAt: addMinutes(DEMO_CLOCK.now, team.firstResponseSlaMinutes),
  };
}

export function simulateRouting(input: RoutingInput): RoutingResult {
  const atHospital =
    input.locationId === DEMO_IDS.locations.wattala ||
    input.locationId === DEMO_IDS.locations.thalawathugoda;
  const atLabNetwork = input.locationId === DEMO_IDS.locations.labNetwork;

  if (input.intent === "urgent_clinical") {
    if (!atHospital) {
      return held(
        input,
        "Urgent language at this location has no authorized clinical queue. Hold for supervised manual triage; do not generate clinical advice.",
      );
    }
    return routed(
      input,
      findTeam(DEMO_IDS.teams.clinicalEscalation),
      "Urgent-language safeguard overrides ordinary intent routing.",
    );
  }

  if (input.intent === "laboratory") {
    if (atLabNetwork) {
      return routed(
        input,
        findTeam(DEMO_IDS.teams.laboratory),
        "Laboratory intent and network location match the laboratory queue scope.",
      );
    }
    if (atHospital) {
      return routed(
        input,
        findTeam(DEMO_IDS.teams.general),
        "The hospital patient-services queue owns the local laboratory handoff.",
      );
    }
  }

  if (input.intent === "appointment" || input.intent === "general_question") {
    if (atHospital) {
      return routed(
        input,
        findTeam(DEMO_IDS.teams.general),
        "Hospital location and patient-service intent match the general queue.",
      );
    }
    return held(
      input,
      "The laboratory network has no appointment/general queue. Hold for supervised reassignment.",
    );
  }

  return held(
    input,
    "No dedicated international-patient queue exists in the current fixture. Missing routes fail closed to a supervised holding queue.",
  );
}

export function locationForId(id: Location["id"]): Location {
  const location = demoLocations.find((candidate) => candidate.id === id);
  if (!location) throw new Error(`Missing deterministic demo location: ${id}`);
  return location;
}

export const EMPTY_SCOPE_PATIENT_PROOFS = (() => {
  const source = demoMemberships.find((membership) => membership.id === DEMO_IDS.members.agent);
  if (!source) throw new Error("Missing deterministic demo agent.");
  const emptyAgent: WorkspaceMembership = {
    ...source,
    scopeMode: "assigned",
    teamIds: [],
    locationIds: [],
  };

  return [
    {
      label: "Scoped patient record",
      decision: authorizeWorkspaceAction({
        membership: emptyAgent,
        permission: "contacts.view",
        resource: {
          workspaceId: emptyAgent.workspaceId,
          sensitivity: "patient",
          teamId: DEMO_IDS.teams.general,
          locationId: DEMO_IDS.locations.wattala,
        },
        now: DEMO_CLOCK.now,
      }),
    },
    {
      label: "Patient record missing resource scope",
      decision: authorizeWorkspaceAction({
        membership: emptyAgent,
        permission: "contacts.view",
        resource: {
          workspaceId: emptyAgent.workspaceId,
          sensitivity: "patient",
        } as unknown as ResourceScope,
        now: DEMO_CLOCK.now,
      }),
    },
  ] as const;
})();
