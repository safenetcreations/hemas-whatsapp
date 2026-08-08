import type {
  AuthorizationDecision,
  Location,
  MembershipStatus,
  Permission,
  StaffIdentity,
  SupportedLanguage,
  Team,
  WorkspaceMembership,
  WorkspaceRole,
} from "@/lib/domain";

export type MemberRoleFilter = "all" | WorkspaceRole;
export type MemberStatusFilter = "all" | MembershipStatus;
export type MemberScopeFilter = "all" | "workspace_wide" | "assigned" | "empty_assigned";

export interface LocalMembershipPreview {
  readonly role?: WorkspaceRole;
  readonly status?: MembershipStatus;
}

export type LocalMembershipPreviews = Readonly<
  Partial<Record<string, LocalMembershipPreview>>
>;

export interface MemberDirectoryRecord {
  readonly membership: WorkspaceMembership;
  readonly identity: StaffIdentity | null;
  readonly teams: readonly Team[];
  readonly locations: readonly Location[];
}

export type RoutingIntent =
  | "appointment"
  | "general_question"
  | "laboratory"
  | "urgent_clinical"
  | "international_patient";

export interface RoutingInput {
  readonly language: SupportedLanguage;
  readonly locationId: Location["id"];
  readonly intent: RoutingIntent;
}

export interface RoutedQueueResult {
  readonly outcome: "routed";
  readonly input: RoutingInput;
  readonly team: Team;
  readonly owner: WorkspaceMembership;
  readonly languageLane: string;
  readonly reason: string;
  readonly simulatedAt: string;
  readonly slaDueAt: string;
}

export interface HeldRoutingResult {
  readonly outcome: "held";
  readonly input: RoutingInput;
  readonly languageLane: string;
  readonly reason: string;
  readonly simulatedAt: string;
}

export type RoutingResult = RoutedQueueResult | HeldRoutingResult;

export interface AccessTestInput {
  readonly permission: Permission;
  readonly patientSensitive: boolean;
  readonly teamId: Team["id"] | null;
  readonly locationId: Location["id"] | null;
  readonly forceEmptyAssignedScope: boolean;
}

export interface AccessTestResult {
  readonly decision: AuthorizationDecision;
  readonly evaluatedMembership: WorkspaceMembership;
  readonly explanation: string;
}

export interface LocalPreviewActivity {
  readonly id: string;
  readonly memberId: WorkspaceMembership["id"];
  readonly label: string;
}
