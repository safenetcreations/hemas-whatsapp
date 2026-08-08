import type { DocumentData } from "firebase-admin/firestore";
import {
  canonicalTemplateContentSerialization,
  type SyntheticTemplateComponent,
  type SyntheticTemplateVariableRule,
} from "../campaigns/contracts.js";
import { deterministicId } from "../deterministic.js";
import { FailClosedError } from "../errors.js";
import {
  exactRecord,
  fail,
  requireBoundedString,
  requireId,
  requireInteger,
  requireProtectedRef,
  requireSha256,
  sha256Hex,
  timestampToDate,
  type ConsentPurpose,
} from "./contracts.js";

export type Phase5Role =
  | "platform_owner"
  | "tenant_admin"
  | "supervisor"
  | "agent"
  | "campaign_operator"
  | "campaign_approver"
  | "analyst"
  | "privacy_reviewer"
  | "clinical_approver";

export interface Phase5Actor {
  readonly uid: string;
  readonly authTime: Date;
}

export interface Phase5Authorization {
  readonly uid: string;
  readonly role: Phase5Role;
  readonly scopeMode: "assigned" | "workspace_wide";
  readonly teamIds: readonly string[];
  readonly locationIds: readonly string[];
}

export type Phase5Permission =
  | "automations.control_runs"
  | "clinical.control_enrollments"
  | "clinical.manage_escalations";

const ROLE_PERMISSIONS: Readonly<Record<Phase5Role, readonly Phase5Permission[]>> = Object.freeze({
  platform_owner: [],
  tenant_admin: ["automations.control_runs"],
  supervisor: ["automations.control_runs"],
  agent: [],
  campaign_operator: [],
  campaign_approver: [],
  analyst: [],
  privacy_reviewer: [],
  clinical_approver: ["clinical.control_enrollments", "clinical.manage_escalations"],
});

const WORKSPACE_KEYS = [
  "id", "name", "mode", "status", "timeZone", "supportedLanguages",
  "defaultLanguage", "retentionPolicyVersion", "dataClassification",
  "externalMessaging", "isSyntheticDemo", "createdAt", "updatedAt",
] as const;
const MEMBERSHIP_KEYS = [
  "id", "uid", "workspaceId", "displayLabel", "role", "scopeMode", "teamIds",
  "locationIds", "status", "mfaSatisfied", "lastAuthenticatedAt", "synthetic",
  "createdAt", "updatedAt",
] as const;
const ROLES = new Set<Phase5Role>(Object.keys(ROLE_PERMISSIONS) as Phase5Role[]);

function idList(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 50) return fail("phase5_authorization_denied", `${label} is invalid.`);
  const parsed = value.map((item) => requireId(item, label, "phase5_authorization_denied"));
  if (new Set(parsed).size !== parsed.length) return fail("phase5_authorization_denied", `${label} is invalid.`);
  return parsed;
}

function exactWorkspace(value: DocumentData | undefined, workspaceId: string): void {
  const data = exactRecord(value, WORKSPACE_KEYS, "workspace authority", "phase5_authorization_denied");
  if (
    data.id !== workspaceId ||
    data.status !== "active" ||
    data.mode !== "demo" ||
    data.dataClassification !== "synthetic_only" ||
    data.isSyntheticDemo !== true ||
    typeof data.name !== "string" ||
    data.name.trim().length < 1 ||
    data.defaultLanguage === undefined ||
    !Array.isArray(data.supportedLanguages)
  ) {
    return fail("phase5_authorization_denied", "An active synthetic demo workspace is required.");
  }
  timestampToDate(data.createdAt, "workspace createdAt", "phase5_authorization_denied");
  timestampToDate(data.updatedAt, "workspace updatedAt", "phase5_authorization_denied");
  const messaging = exactRecord(data.externalMessaging, [
    "enabled", "mode", "allowlistedRecipientHashes", "verifiedCapacity",
    "capacityVerifiedAt", "disabledReason",
  ], "workspace external-messaging policy", "phase5_authorization_denied");
  if (
    messaging.enabled !== false ||
    messaging.mode !== "simulator_only" ||
    !Array.isArray(messaging.allowlistedRecipientHashes) ||
    messaging.allowlistedRecipientHashes.length !== 0 ||
    messaging.verifiedCapacity !== null ||
    messaging.capacityVerifiedAt !== null ||
    typeof messaging.disabledReason !== "string"
  ) {
    return fail("phase5_authorization_denied", "External messaging must remain disabled.");
  }
}

export function assertPhase5Authorization(input: {
  readonly workspaceId: string;
  readonly workspace: DocumentData | undefined;
  readonly membership: DocumentData | undefined;
  readonly actor: Phase5Actor;
  readonly permission: Phase5Permission;
  readonly patientScope: { readonly teamId: string; readonly locationId: string };
  readonly now: Date;
}): Phase5Authorization {
  exactWorkspace(input.workspace, input.workspaceId);
  const data = exactRecord(input.membership, MEMBERSHIP_KEYS, "workspace membership", "phase5_authorization_denied");
  const uid = requireId(input.actor.uid, "Authenticated UID", "phase5_authorization_denied");
  if (
    data.id !== uid ||
    data.uid !== uid ||
    data.workspaceId !== input.workspaceId ||
    data.status !== "active" ||
    data.synthetic !== true ||
    typeof data.role !== "string" ||
    !ROLES.has(data.role as Phase5Role) ||
    (data.scopeMode !== "assigned" && data.scopeMode !== "workspace_wide") ||
    data.mfaSatisfied !== true
  ) {
    return fail("phase5_authorization_denied", "Active MFA-verified workspace membership is required.");
  }
  timestampToDate(data.createdAt, "membership createdAt", "phase5_authorization_denied");
  timestampToDate(data.updatedAt, "membership updatedAt", "phase5_authorization_denied");
  const lastAuthenticatedAt = timestampToDate(data.lastAuthenticatedAt, "membership lastAuthenticatedAt", "recent_auth_required");
  const role = data.role as Phase5Role;
  if (!ROLE_PERMISSIONS[role].includes(input.permission)) {
    return fail("phase5_authorization_denied", "The workspace role cannot perform this action.");
  }
  if (data.scopeMode === "workspace_wide" && role !== "tenant_admin") {
    return fail("phase5_authorization_denied", "Only tenant administrators may hold workspace-wide scope.");
  }
  const nowMs = input.now.getTime();
  const tokenAuthMs = input.actor.authTime.getTime();
  const membershipAuthMs = lastAuthenticatedAt.getTime();
  const maximumAge = 15 * 60_000;
  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(tokenAuthMs) ||
    tokenAuthMs > nowMs ||
    membershipAuthMs > nowMs ||
    nowMs - tokenAuthMs > maximumAge ||
    nowMs - membershipAuthMs > maximumAge
  ) {
    return fail("recent_auth_required", "Phase 5 control requires authentication within 15 minutes.");
  }
  const teamIds = idList(data.teamIds, "Membership team scope");
  const locationIds = idList(data.locationIds, "Membership location scope");
  const workspaceWide = role === "tenant_admin" && data.scopeMode === "workspace_wide";
  if (
    !workspaceWide &&
    (teamIds.length === 0 ||
      locationIds.length === 0 ||
      !teamIds.includes(input.patientScope.teamId) ||
      !locationIds.includes(input.patientScope.locationId))
  ) {
    return fail("phase5_scope_denied", "Both patient team and location must be assigned.");
  }
  return {
    uid,
    role,
    scopeMode: data.scopeMode,
    teamIds,
    locationIds,
  };
}

export const SYNTHETIC_PROTECTED_REF_ALLOWLIST = Object.freeze({
  "demo://automation/contact/synthetic-v1": Object.freeze({ kind: "contact", id: "contact_synthetic_appointment" }),
  "demo://automation/conversation/synthetic-v1": Object.freeze({ kind: "conversation", id: "conversation_synthetic_appointment" }),
  "demo://automation/appointment/synthetic-v1": Object.freeze({ kind: "appointment", id: "appointment_synthetic_001" }),
  "demo://automation/contact/synthetic-001": Object.freeze({ kind: "contact", id: "contact_synthetic_appointment" }),
  "demo://automation/conversation/synthetic-001": Object.freeze({ kind: "conversation", id: "conversation_synthetic_appointment" }),
  "demo://automation/appointment/synthetic-001": Object.freeze({ kind: "appointment", id: "appointment_synthetic_001" }),
  "demo://automation/contact/synthetic-laboratory-v1": Object.freeze({ kind: "contact", id: "contact_synthetic_laboratory" }),
  "demo://automation/conversation/synthetic-laboratory-v1": Object.freeze({ kind: "conversation", id: "conversation_synthetic_laboratory" }),
  "demo://care/contact/synthetic-001": Object.freeze({ kind: "contact", id: "contact_synthetic_urgent" }),
  "demo://care/conversation/synthetic-001": Object.freeze({ kind: "conversation", id: "conversation_synthetic_phase5_care" }),
  "demo://care/discharge/synthetic-001": Object.freeze({ kind: "discharge", id: "discharge_synthetic_001" }),
});

type ProtectedKind = "contact" | "conversation" | "appointment" | "discharge";

export function resolveSyntheticProtectedRef(value: unknown, expectedKind: ProtectedKind): string {
  const ref = requireProtectedRef(value, `${expectedKind} protected reference`, "protected_reference_denied");
  const resolved = SYNTHETIC_PROTECTED_REF_ALLOWLIST[ref as keyof typeof SYNTHETIC_PROTECTED_REF_ALLOWLIST];
  if (!resolved || resolved.kind !== expectedKind) {
    return fail("protected_reference_denied", "Protected reference is outside the fixed synthetic allowlist.");
  }
  return resolved.id;
}

export function phase5EventProtectedRef(kind: "automation" | "care", eventId: string): string {
  requireId(eventId, "Event ID");
  return `demo://${kind}/event-context/${eventId}`;
}

export function phase5WorkItemProtectedRef(workItemId: string): string {
  requireId(workItemId, "Work-item ID");
  return `demo://automation/work-item-context/${workItemId}`;
}

export function phase5EscalationProtectedRef(escalationId: string): string {
  requireId(escalationId, "Escalation ID");
  return `demo://care/escalation-context/${escalationId}`;
}

export const SYNTHETIC_CONSENT_IDS: Readonly<Record<string, string>> = Object.freeze({
  "contact_synthetic_appointment:appointment_service": "consent_synthetic_appointment",
  "contact_synthetic_laboratory:laboratory_service": "consent_synthetic_laboratory",
  "contact_synthetic_urgent:care_pathway": "consent_synthetic_care_pathway",
});

export function syntheticConsentId(contactId: string, purpose: ConsentPurpose): string {
  const id = SYNTHETIC_CONSENT_IDS[`${contactId}:${purpose}`];
  if (!id) return fail("consent_denied", "No fixed synthetic consent binding exists for this subject and purpose.");
  return id;
}

export interface ParsedSyntheticContact {
  readonly id: string;
  readonly workspaceId: string;
  readonly teamId: string;
  readonly locationId: string;
  readonly preferredLanguage: "en" | "si" | "ta";
  readonly suppressAll: boolean;
  readonly suppressMarketing: boolean;
  readonly invalidContact: boolean;
}

export function parseSyntheticContact(value: unknown, expected: {
  readonly workspaceId: string;
  readonly contactId: string;
  readonly teamId: string;
  readonly locationId: string;
}): ParsedSyntheticContact {
  const data = exactRecord(value, [
    "id", "workspaceId", "teamId", "locationId", "maskedPhone", "displayLabel",
    "preferredLanguage", "alternateLanguages", "suppression", "tags",
    "preferenceRevision", "synthetic", "createdAt", "updatedAt",
  ], "synthetic contact", "contact_gate_denied");
  const suppression = exactRecord(data.suppression, [
    "suppressAll", "suppressMarketing", "invalidContact", "reasons", "updatedAt",
  ], "contact suppression", "contact_gate_denied");
  if (
    data.id !== expected.contactId ||
    data.workspaceId !== expected.workspaceId ||
    data.teamId !== expected.teamId ||
    data.locationId !== expected.locationId ||
    data.synthetic !== true ||
    !["en", "si", "ta"].includes(data.preferredLanguage as string) ||
    typeof suppression.suppressAll !== "boolean" ||
    typeof suppression.suppressMarketing !== "boolean" ||
    typeof suppression.invalidContact !== "boolean" ||
    !Array.isArray(suppression.reasons)
  ) {
    return fail("contact_gate_denied", "Synthetic contact does not match the patient scope.");
  }
  requireInteger(data.preferenceRevision, "Contact preference revision", 0, 999_999, "contact_gate_denied");
  timestampToDate(data.createdAt, "contact createdAt", "contact_gate_denied");
  timestampToDate(data.updatedAt, "contact updatedAt", "contact_gate_denied");
  timestampToDate(suppression.updatedAt, "suppression updatedAt", "contact_gate_denied");
  return {
    id: expected.contactId,
    workspaceId: expected.workspaceId,
    teamId: expected.teamId,
    locationId: expected.locationId,
    preferredLanguage: data.preferredLanguage as "en" | "si" | "ta",
    suppressAll: suppression.suppressAll,
    suppressMarketing: suppression.suppressMarketing,
    invalidContact: suppression.invalidContact,
  };
}

export interface ParsedSyntheticConversation {
  readonly id: string;
  readonly contactId: string;
  readonly teamId: string;
  readonly locationId: string;
  readonly mode: "automation" | "human_takeover" | "safety_hold";
  readonly serviceWindowExpiresAt: Date | null;
}

export function parseSyntheticConversation(value: unknown, expected: {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly contactId: string;
  readonly teamId: string;
  readonly locationId: string;
}): ParsedSyntheticConversation {
  const data = exactRecord(value, [
    "id", "workspaceId", "contactId", "connectionId", "teamId", "locationId",
    "status", "mode", "assigneeId", "detectedLanguage", "languageConfidence",
    "purpose", "serviceWindowExpiresAt", "firstResponseDueAt", "lastMessageAt",
    "handoffSummary", "unreadCount", "synthetic", "createdAt", "updatedAt",
  ], "synthetic conversation", "conversation_gate_denied");
  if (
    data.id !== expected.conversationId ||
    data.workspaceId !== expected.workspaceId ||
    data.contactId !== expected.contactId ||
    data.teamId !== expected.teamId ||
    data.locationId !== expected.locationId ||
    data.synthetic !== true ||
    !["automation", "human_takeover", "safety_hold"].includes(data.mode as string)
  ) {
    return fail("conversation_gate_denied", "Synthetic conversation does not match the aggregate scope.");
  }
  timestampToDate(data.firstResponseDueAt, "conversation firstResponseDueAt", "conversation_gate_denied");
  timestampToDate(data.lastMessageAt, "conversation lastMessageAt", "conversation_gate_denied");
  timestampToDate(data.createdAt, "conversation createdAt", "conversation_gate_denied");
  timestampToDate(data.updatedAt, "conversation updatedAt", "conversation_gate_denied");
  return {
    id: expected.conversationId,
    contactId: expected.contactId,
    teamId: expected.teamId,
    locationId: expected.locationId,
    mode: data.mode as ParsedSyntheticConversation["mode"],
    serviceWindowExpiresAt: data.serviceWindowExpiresAt === null
      ? null
      : timestampToDate(data.serviceWindowExpiresAt, "conversation serviceWindowExpiresAt", "conversation_gate_denied"),
  };
}

export function parseSyntheticConsent(value: unknown, expected: {
  readonly workspaceId: string;
  readonly contactId: string;
  readonly teamId: string;
  readonly locationId: string;
  readonly purpose: ConsentPurpose;
}): { readonly id: string; readonly status: "granted" | "withdrawn"; readonly capturedAt: Date } {
  const data = exactRecord(value, [
    "id", "workspaceId", "contactId", "teamId", "locationId", "purpose",
    "channel", "category", "status", "source", "noticeVersion", "language",
    "evidenceRef", "capturedAt", "withdrawnAt", "supersedesRecordId", "synthetic",
    "schemaVersion", "createdAt", "updatedAt",
  ], "synthetic consent", "consent_denied");
  if (
    data.workspaceId !== expected.workspaceId ||
    data.contactId !== expected.contactId ||
    data.teamId !== expected.teamId ||
    data.locationId !== expected.locationId ||
    data.purpose !== expected.purpose ||
    data.channel !== "whatsapp" ||
    data.category !== "utility" ||
    (data.status !== "granted" && data.status !== "withdrawn") ||
    data.synthetic !== true ||
    data.schemaVersion !== 1
  ) {
    return fail("consent_denied", "Current granted WhatsApp consent is required.");
  }
  const id = requireId(data.id, "consent ID", "consent_denied");
  const capturedAt = timestampToDate(data.capturedAt, "consent capturedAt", "consent_denied");
  if (
    (data.status === "granted" && data.withdrawnAt !== null) ||
    (data.status === "withdrawn" && data.withdrawnAt === null)
  ) return fail("consent_denied", "Consent status and withdrawal evidence disagree.");
  if (data.withdrawnAt !== null) {
    timestampToDate(data.withdrawnAt, "consent withdrawnAt", "consent_denied");
  }
  timestampToDate(data.createdAt, "consent createdAt", "consent_denied");
  timestampToDate(data.updatedAt, "consent updatedAt", "consent_denied");
  return { id, status: data.status as "granted" | "withdrawn", capturedAt };
}

export function assertLatestSyntheticConsent(values: readonly unknown[], expected: {
  readonly workspaceId: string;
  readonly contactId: string;
  readonly teamId: string;
  readonly locationId: string;
  readonly purpose: ConsentPurpose;
}): void {
  if (values.length < 1 || values.length > 2) {
    return fail("consent_denied", "A unique latest consent decision is required.");
  }
  const records = values.map((value) => parseSyntheticConsent(value, expected));
  if (
    records.length === 2 &&
    records[0]!.capturedAt.getTime() === records[1]!.capturedAt.getTime()
  ) {
    return fail("consent_denied", "Tied latest consent decisions are ambiguous.");
  }
  if (records[0]!.status !== "granted") {
    return fail("consent_denied", "The latest WhatsApp consent decision is not granted.");
  }
}

function parseTemplateComponent(value: unknown, index: number): SyntheticTemplateComponent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail("template_binding_denied", `template component ${index} is invalid.`);
  }
  const kindValue = (value as Record<string, unknown>).kind;
  if (kindValue === "buttons") {
    const buttons = exactRecord(value, ["kind", "buttons"], `template component ${index}`, "template_binding_denied");
    if (buttons.kind !== "buttons" || !Array.isArray(buttons.buttons) || buttons.buttons.length < 1 || buttons.buttons.length > 10) {
      return fail("template_binding_denied", "Template buttons are invalid.");
    }
    return {
      kind: "buttons",
      buttons: buttons.buttons.map((button, buttonIndex) => {
        const parsed = exactRecord(button, ["type", "label", "targetRef"], `template button ${buttonIndex}`, "template_binding_denied");
        if (!["quick_reply", "url", "flow"].includes(parsed.type as string)) return fail("template_binding_denied", "Template button kind is invalid.");
        return {
          type: parsed.type as "quick_reply" | "url" | "flow",
          label: requireBoundedString(parsed.label, "template button label", 80, "template_binding_denied"),
          targetRef: requireBoundedString(parsed.targetRef, "template button target", 500, "template_binding_denied"),
        };
      }),
    };
  }
  if (kindValue === "header") {
    const header = exactRecord(value, ["kind", "format", "text"], `template component ${index}`, "template_binding_denied");
    if (header.format !== "text") return fail("template_binding_denied", "Template header format is invalid.");
    return { kind: "header", format: "text", text: requireBoundedString(header.text, "template header text", 240, "template_binding_denied") };
  }
  if (kindValue === "body" || kindValue === "footer") {
    const body = exactRecord(value, ["kind", "text"], `template component ${index}`, "template_binding_denied");
    return {
      kind: kindValue,
      text: requireBoundedString(body.text, "template component text", kindValue === "body" ? 2_048 : 240, "template_binding_denied"),
    };
  }
  return fail("template_binding_denied", "Template component kind is invalid.");
}

function parseTemplateVariable(value: unknown, index: number): SyntheticTemplateVariableRule {
  const data = exactRecord(value, ["key", "description", "required", "maxLength", "exampleValue", "allowedPattern"], `template variable ${index}`, "template_binding_denied");
  const key = requireBoundedString(data.key, "template variable key", 64, "template_binding_denied");
  if (!/^[a-z][a-z0-9_]*$/.test(key) || data.required !== true) return fail("template_binding_denied", "Template variable governance is invalid.");
  return {
    key,
    description: requireBoundedString(data.description, "template variable description", 256, "template_binding_denied"),
    required: true,
    maxLength: requireInteger(data.maxLength, "template variable maxLength", 1, 500, "template_binding_denied"),
    exampleValue: requireBoundedString(data.exampleValue, "template variable example", 500, "template_binding_denied"),
    allowedPattern: data.allowedPattern === null
      ? null
      : requireBoundedString(data.allowedPattern, "template variable pattern", 240, "template_binding_denied"),
  };
}

export function assertSyntheticTemplate(value: unknown, expected: {
  readonly workspaceId: string;
  readonly templateId: string;
  readonly contentHash: string;
  readonly category: "utility";
  readonly language?: "en" | "si" | "ta";
}): void {
  const data = exactRecord(value, [
    "id", "workspaceId", "assetKey", "sortKey", "providerName", "category",
    "language", "version", "localState", "providerState", "immutable", "contentHash",
    "components", "variableRules", "ownership", "synthetic", "schemaVersion",
    "createdAt", "updatedAt",
  ], "synthetic template", "template_binding_denied");
  const provider = exactRecord(data.providerState, [
    "submissionState", "approvalState", "authority", "assetId", "qualityRating", "checkedAt",
  ], "template provider state", "template_binding_denied");
  const ownership = exactRecord(data.ownership, [
    "ownerKind", "ownerWorkspaceId", "transferableToHemas", "productionUseAllowed", "notice",
  ], "template ownership", "template_binding_denied");
  const id = requireId(data.id, "template ID", "template_binding_denied");
  const assetKey = requireId(data.assetKey, "template asset key", "template_binding_denied");
  const providerName = requireId(data.providerName, "template provider name", "template_binding_denied");
  const version = requireInteger(data.version, "template version", 1, 999_999, "template_binding_denied");
  if (
    id !== expected.templateId ||
    data.workspaceId !== expected.workspaceId ||
    data.contentHash !== expected.contentHash ||
    data.category !== expected.category ||
    data.localState !== "approved" ||
    data.immutable !== true ||
    data.synthetic !== true ||
    data.schemaVersion !== 1 ||
    !["en", "si", "ta"].includes(data.language as string) ||
    (expected.language !== undefined && data.language !== expected.language) ||
    provider.submissionState !== "not_submitted" ||
    provider.approvalState !== "unverified" ||
    provider.authority !== "none" ||
    provider.assetId !== null ||
    ownership.ownerKind !== "safenet_demo" ||
    ownership.ownerWorkspaceId !== expected.workspaceId ||
    ownership.transferableToHemas !== false ||
    ownership.productionUseAllowed !== false ||
    data.sortKey !== `${assetKey}:${String(data.language)}:${String(version).padStart(4, "0")}` ||
    !Array.isArray(data.components) || data.components.length < 1 || data.components.length > 8 ||
    !Array.isArray(data.variableRules) || data.variableRules.length > 20
  ) {
    return fail("template_binding_denied", "Template does not match the approved immutable synthetic binding.");
  }
  const components = data.components.map(parseTemplateComponent);
  const variableRules = data.variableRules.map(parseTemplateVariable);
  if (new Set(variableRules.map((rule) => rule.key)).size !== variableRules.length) {
    return fail("template_binding_denied", "Template variable keys must be unique.");
  }
  const contentHash = requireSha256(data.contentHash, "template content hash", "template_binding_denied");
  const recomputed = sha256Hex(canonicalTemplateContentSerialization({
    workspaceId: expected.workspaceId,
    id,
    assetKey,
    providerName,
    category: expected.category,
    language: data.language as "en" | "si" | "ta",
    version,
    components,
    variableRules,
  }));
  if (recomputed !== contentHash || contentHash !== expected.contentHash) {
    return fail("template_binding_denied", "Template content does not match its canonical immutable hash.");
  }
  timestampToDate(data.createdAt, "template createdAt", "template_binding_denied");
  timestampToDate(data.updatedAt, "template updatedAt", "template_binding_denied");
}

export function assertSyntheticTeam(value: unknown, expected: {
  readonly workspaceId: string;
  readonly teamId: string;
  readonly locationId: string;
}): number {
  const data = exactRecord(value, [
    "id", "workspaceId", "name", "queueType", "locationIds",
    "businessHoursLabel", "firstResponseSlaMinutes", "active", "createdAt", "updatedAt",
  ], "synthetic team", "phase5_scope_denied");
  if (
    data.id !== expected.teamId ||
    data.workspaceId !== expected.workspaceId ||
    data.active !== true ||
    !Array.isArray(data.locationIds) ||
    !data.locationIds.includes(expected.locationId)
  ) {
    return fail("phase5_scope_denied", "Active team/location binding is required.");
  }
  timestampToDate(data.createdAt, "team createdAt", "phase5_scope_denied");
  timestampToDate(data.updatedAt, "team updatedAt", "phase5_scope_denied");
  return requireInteger(data.firstResponseSlaMinutes, "Team response SLA", 1, 1_440, "phase5_scope_denied");
}

export function assertSyntheticLocation(value: unknown, expected: {
  readonly workspaceId: string;
  readonly locationId: string;
}): void {
  const data = exactRecord(value, [
    "id", "workspaceId", "name", "kind", "city", "supportedServiceRefs",
    "active", "createdAt", "updatedAt",
  ], "synthetic location", "phase5_scope_denied");
  if (data.id !== expected.locationId || data.workspaceId !== expected.workspaceId || data.active !== true) {
    return fail("phase5_scope_denied", "Active location binding is required.");
  }
  timestampToDate(data.createdAt, "location createdAt", "phase5_scope_denied");
  timestampToDate(data.updatedAt, "location updatedAt", "phase5_scope_denied");
}

export interface ParsedPhase5Idempotency<T> {
  readonly result: T;
  readonly auditEventId: string;
  readonly eventId: string;
}

export function parsePhase5Idempotency<T>(value: unknown, expected: {
  readonly id: string;
  readonly workspaceId: string;
  readonly actorUid: string;
  readonly action: string;
  readonly purpose: "automation" | "care_pathway";
  readonly requestHash: string;
  readonly aggregateId: string;
  readonly resultParser: (value: unknown) => T;
}): ParsedPhase5Idempotency<T> {
  const data = exactRecord(value, [
    "id", "workspaceId", "actorUid", "action", "purpose", "requestHash",
    "aggregateId", "eventId", "result", "auditEventId", "createdAt",
    "synthetic", "schemaVersion",
  ], "Phase 5 idempotency evidence", "idempotency_conflict");
  if (
    data.id !== expected.id ||
    data.workspaceId !== expected.workspaceId ||
    data.actorUid !== expected.actorUid ||
    data.action !== expected.action ||
    data.purpose !== expected.purpose ||
    data.requestHash !== expected.requestHash ||
    data.aggregateId !== expected.aggregateId ||
    data.synthetic !== true ||
    data.schemaVersion !== 1
  ) {
    return fail("idempotency_conflict", "Idempotency key is bound to another request.");
  }
  timestampToDate(data.createdAt, "idempotency createdAt", "idempotency_conflict");
  return {
    result: expected.resultParser(data.result),
    auditEventId: requireId(data.auditEventId, "auditEventId", "idempotency_conflict"),
    eventId: requireId(data.eventId, "eventId", "idempotency_conflict"),
  };
}

export function phase5IdempotencyId(input: {
  readonly workspaceId: string;
  readonly actorUid: string;
  readonly action: string;
  readonly key: string;
}): string {
  return deterministicId("idempotency", `${input.workspaceId}:${input.actorUid}:${input.action}:${input.key}`);
}

export function ensureNoUnexpectedClinicalText(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (/diagnos|medication|prescription|instructionText|clinicalText|patientName|phone/i.test(serialized)) {
    throw new FailClosedError("invalid_service_request", "Clinical or patient content is not accepted by this control.");
  }
}
