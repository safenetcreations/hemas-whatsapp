import type {
  ConnectionId,
  ISODateTime,
  LocationId,
  MemberId,
  SupportedLanguage,
  TeamId,
  TimeZone,
  UserId,
  VerificationStamp,
  WorkspaceId,
  WorkspaceScopedEntity,
} from "./primitives";

export type WorkspaceMode = "local" | "demo" | "uat" | "production";
export type WorkspaceStatus = "provisioning" | "active" | "locked" | "suspended" | "archived";

export type WorkspaceRole =
  | "platform_owner"
  | "tenant_admin"
  | "supervisor"
  | "agent"
  | "campaign_operator"
  | "campaign_approver"
  | "analyst"
  | "privacy_reviewer"
  | "clinical_approver";

export type MembershipStatus = "invited" | "active" | "revoked" | "suspended";

/** Global authentication identity; workspace privileges live only on memberships. */
export interface StaffIdentity {
  readonly uid: UserId;
  readonly displayLabel: string;
  readonly maskedEmail: string;
  readonly identityProvider: "firebase_password" | "google_workspace" | "microsoft_entra" | "demo";
  readonly status: "active" | "disabled";
  readonly synthetic: boolean;
  readonly createdAt: ISODateTime;
  readonly updatedAt: ISODateTime;
}

export interface ExternalMessagingPolicy {
  /** A server-side gate. UI state must never override it. */
  readonly enabled: boolean;
  readonly mode: "simulator_only" | "allowlist_canary" | "live";
  readonly allowlistedRecipientHashes: readonly string[];
  readonly verifiedCapacity: number | null;
  readonly capacityVerifiedAt: ISODateTime | null;
  readonly disabledReason: string | null;
}

export const EXTERNAL_MESSAGING_DISABLED: ExternalMessagingPolicy = Object.freeze({
  enabled: false,
  mode: "simulator_only",
  allowlistedRecipientHashes: Object.freeze([]),
  verifiedCapacity: null,
  capacityVerifiedAt: null,
  disabledReason: "External messaging is disabled until an owned Meta connection passes production gates.",
});

export interface Workspace {
  readonly id: WorkspaceId;
  readonly name: string;
  readonly mode: WorkspaceMode;
  readonly status: WorkspaceStatus;
  readonly timeZone: TimeZone;
  readonly supportedLanguages: readonly SupportedLanguage[];
  readonly defaultLanguage: SupportedLanguage;
  readonly retentionPolicyVersion: string;
  readonly dataClassification: "synthetic_only" | "approved_uat" | "regulated_patient_data";
  readonly externalMessaging: ExternalMessagingPolicy;
  readonly isSyntheticDemo: boolean;
  readonly createdAt: ISODateTime;
  readonly updatedAt: ISODateTime;
}

export interface WorkspaceMembership extends WorkspaceScopedEntity<MemberId> {
  readonly uid: UserId;
  readonly displayLabel: string;
  readonly role: WorkspaceRole;
  /** Workspace-wide access is an explicit wildcard reserved for tenant admins. */
  readonly scopeMode: "assigned" | "workspace_wide";
  readonly teamIds: readonly TeamId[];
  readonly locationIds: readonly LocationId[];
  readonly status: MembershipStatus;
  readonly mfaSatisfied: boolean;
  readonly lastAuthenticatedAt: ISODateTime;
}

export interface Team extends WorkspaceScopedEntity<TeamId> {
  readonly name: string;
  readonly queueType:
    | "general"
    | "outpatient"
    | "laboratory"
    | "maternity"
    | "international"
    | "clinical_escalation";
  readonly locationIds: readonly LocationId[];
  readonly businessHoursLabel: string;
  readonly firstResponseSlaMinutes: number;
  readonly active: boolean;
}

export interface Location extends WorkspaceScopedEntity<LocationId> {
  readonly name: string;
  readonly kind: "hospital" | "laboratory" | "collection_point" | "virtual_service";
  readonly city: string;
  readonly supportedServiceRefs: readonly string[];
  readonly active: boolean;
}

export type ConnectionStatus =
  | "not_configured"
  | "mock"
  | "verifying"
  | "ready"
  | "degraded"
  | "disabled";

export interface WhatsAppConnection extends WorkspaceScopedEntity<ConnectionId> {
  readonly displayName: string;
  readonly provider: "meta_cloud_api" | "simulator";
  readonly status: ConnectionStatus;
  readonly maskedNumber: string;
  readonly providerPhoneNumberId: string | null;
  readonly wabaId: string | null;
  readonly credentialSecretRef: string | null;
  readonly qualityRating: "unknown" | "green" | "yellow" | "red";
  readonly messagingLimit: number | null;
  readonly verification: VerificationStamp;
  readonly externalMessagingEnabled: boolean;
}

export function canWorkspaceSendExternally(workspace: Workspace, connection: WhatsAppConnection): boolean {
  if (workspace.status !== "active" || !workspace.externalMessaging.enabled) {
    return false;
  }

  return (
    workspace.externalMessaging.mode !== "simulator_only" &&
    workspace.externalMessaging.verifiedCapacity !== null &&
    workspace.externalMessaging.verifiedCapacity > 0 &&
    connection.workspaceId === workspace.id &&
    connection.provider === "meta_cloud_api" &&
    connection.status === "ready" &&
    connection.externalMessagingEnabled &&
    connection.messagingLimit !== null &&
    connection.messagingLimit > 0 &&
    connection.verification.status === "verified"
  );
}
