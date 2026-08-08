import type {
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Transaction,
} from "firebase-admin/firestore";
import type { RuntimeConfig } from "../config.js";
import { FailClosedError } from "../errors.js";
import {
  AI_AUDIT_METADATA_KEYS,
  AI_GOVERNANCE_ACTION,
  AI_GOVERNANCE_EVALUATED_AT,
  AI_GOVERNANCE_RESOURCE_TYPE,
  AI_GOVERNANCE_WORKSPACE_ID,
  AI_KNOWLEDGE_DOCUMENT_IDS,
  AI_KNOWLEDGE_DOCUMENT_MATRIX,
  AI_KNOWLEDGE_SELECTION_IDS,
  AI_PERSISTED_SCENARIO_MATRIX,
  AI_RUNTIME_PATH_COLLECTIONS,
  AI_STOP_SUPPRESSION_EVIDENCE,
  aiAuditMetadata,
  aiCallRequestFingerprint,
  aiReceiptDocumentId,
  assertAiGovernanceRuntimeBoundary,
  buildAiGovernanceSeedContract,
  buildAiRuntimeAggregate,
  exactRecord,
  parseAiRetrospectiveRequestInput,
  serializeAiDecisionFixtureIdentityV1,
  serializeAiSourceFixtureIdentityV1,
  timestampIso,
  type AiGovernanceActor,
  type AiGovernanceEmulatorBoundary,
  type AiPersistedScenarioId,
  type AiRecord,
  type AiRetrospectiveRequestInput,
  type AiRetrospectiveResponse,
  type AiRetrospectiveResult,
} from "./contracts.js";
import { sha256Hex } from "../deterministic.js";

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
const CONNECTION_KEYS = [
  "id", "workspaceId", "displayName", "provider", "environment", "status",
  "maskedNumber", "maskedWabaId", "maskedPhoneNumberId", "credentialState",
  "externalMessagingEnabled", "networkCallsEnabled", "signals", "sortKey",
  "synthetic", "schemaVersion", "createdAt", "updatedAt",
] as const;
const SIGNAL_KEYS = [
  "state", "source", "observedAt", "lastSuccessfulVerificationAt", "detailCode",
] as const;
const CONTACT_KEYS = [
  "id", "workspaceId", "teamId", "locationId", "maskedPhone", "displayLabel",
  "preferredLanguage", "alternateLanguages", "suppression", "tags",
  "preferenceRevision", "synthetic", "createdAt", "updatedAt",
] as const;
const SUPPRESSION_KEYS = [
  "suppressAll", "suppressMarketing", "invalidContact", "reasons", "updatedAt",
] as const;
const CONVERSATION_KEYS = [
  "id", "workspaceId", "contactId", "connectionId", "teamId", "locationId",
  "status", "mode", "assigneeId", "detectedLanguage", "languageConfidence",
  "purpose", "serviceWindowExpiresAt", "firstResponseDueAt", "lastMessageAt",
  "handoffSummary", "unreadCount", "synthetic", "createdAt", "updatedAt",
] as const;
const MESSAGE_KEYS = [
  "id", "workspaceId", "conversationId", "contactId", "teamId", "locationId",
  "direction", "type", "status", "externalDispatch", "actorId", "receivedAt",
  "sentAt", "deliveredAt", "metadataOnly", "synthetic", "schemaVersion",
  "createdAt", "updatedAt",
] as const;
const TEAM_KEYS = [
  "id", "workspaceId", "name", "queueType", "locationIds", "businessHoursLabel",
  "firstResponseSlaMinutes", "active", "createdAt", "updatedAt",
] as const;
const LOCATION_KEYS = [
  "id", "workspaceId", "name", "kind", "city", "supportedServiceRefs", "active",
  "createdAt", "updatedAt",
] as const;
const CONSENT_KEYS = [
  "id", "workspaceId", "contactId", "teamId", "locationId", "purpose", "channel",
  "category", "status", "source", "noticeVersion", "language", "evidenceRef",
  "capturedAt", "withdrawnAt", "supersedesRecordId", "synthetic", "schemaVersion",
  "createdAt", "updatedAt",
] as const;
const RECEIPT_KEYS = [
  "id", "workspaceId", "actorUid", "action", "scenarioId", "requestHash",
  "runId", "eventId", "auditEventId", "result", "createdAt", "synthetic",
  "schemaVersion",
] as const;
const RESULT_KEYS = [
  "scenarioId", "runId", "eventId", "auditEventId", "outcome", "recordedAt",
  "modelCallCount", "providerCallCount", "externalDispatchCount",
  "conversationMutationCount", "handoffMutationCount", "suppressionMutationCount",
] as const;
const AUDIT_KEYS = [
  "id", "workspaceId", "actorUid", "actorType", "action", "resourceType",
  "resourceId", "outcome", "requestId", "occurredAt", "createdAt", "metadata",
  "synthetic", "schemaVersion",
] as const;

const WHATSAPP_SIGNAL_MATRIX = Object.freeze({
  waba: ["not_configured", "synthetic_fixture", "no_meta_waba"],
  phoneRegistration: ["not_configured", "synthetic_fixture", "no_provider_phone"],
  webhook: ["mock", "synthetic_fixture", "synthetic_ingress_only"],
  appMode: ["not_configured", "synthetic_fixture", "no_meta_app"],
  permissions: ["unverified", "synthetic_fixture", "no_meta_permissions"],
  templates: ["not_submitted", "synthetic_fixture", "provider_approved_zero"],
  payment: ["not_configured", "synthetic_fixture", "no_payment_configuration"],
  sending: ["blocked", "local_policy", "external_sending_disabled"],
  quality: ["not_available", "synthetic_fixture", "no_provider_quality"],
  capacity: ["not_available", "synthetic_fixture", "no_provider_capacity"],
  realDeviceCanary: ["blocked", "local_policy", "no_real_device_canary"],
} as const);

type ScenarioExpected = (typeof AI_PERSISTED_SCENARIO_MATRIX)[AiPersistedScenarioId];

function fail(code: string, message: string): never {
  throw new FailClosedError(code, message);
}

function data(snapshot: DocumentSnapshot): DocumentData | undefined {
  return snapshot.exists ? snapshot.data() : undefined;
}

function idList(value: unknown, label: string): readonly string[] {
  if (
    !Array.isArray(value) || value.length > 50 ||
    value.some((item) => typeof item !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(item)) ||
    new Set(value).size !== value.length
  ) {
    return fail("ai_authorization_denied", `${label} is invalid.`);
  }
  return value as string[];
}

function assertArray(value: unknown, expected: readonly unknown[], label: string): void {
  if (!Array.isArray(value) || JSON.stringify(value) !== JSON.stringify(expected)) {
    return fail("invalid_ai_source_fixture", `${label} is substituted.`);
  }
}

function assertLiteral(value: unknown, expected: unknown, label: string): void {
  if (value !== expected) return fail("invalid_ai_source_fixture", `${label} is substituted.`);
}

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (
    value && typeof value === "object" && "toDate" in value &&
    typeof (value as { readonly toDate?: unknown }).toDate === "function"
  ) {
    return (value as { toDate(): Date }).toDate().toISOString();
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)]),
    );
  }
  return value;
}

function assertExactValue(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(normalize(actual)) !== JSON.stringify(normalize(expected))) {
    return fail("invalid_ai_governance_evidence", `${label} does not match the frozen v1 contract.`);
  }
}

function assertWorkspaceAndMembership(input: {
  readonly workspace: DocumentData | undefined;
  readonly membership: DocumentData | undefined;
  readonly actor: AiGovernanceActor;
  readonly scenarioId: AiPersistedScenarioId;
  readonly now: Date;
}): void {
  const workspace = exactRecord(
    input.workspace, WORKSPACE_KEYS, "AI workspace authority", "ai_authorization_denied",
  );
  if (
    workspace.id !== AI_GOVERNANCE_WORKSPACE_ID || workspace.status !== "active" ||
    workspace.mode !== "demo" || workspace.dataClassification !== "synthetic_only" ||
    workspace.isSyntheticDemo !== true
  ) {
    return fail("ai_authorization_denied", "An active synthetic demo workspace is required.");
  }
  const messaging = exactRecord(
    workspace.externalMessaging,
    ["enabled", "mode", "allowlistedRecipientHashes", "verifiedCapacity", "capacityVerifiedAt", "disabledReason"],
    "AI workspace messaging boundary", "ai_authorization_denied",
  );
  if (
    messaging.enabled !== false || messaging.mode !== "simulator_only" ||
    !Array.isArray(messaging.allowlistedRecipientHashes) || messaging.allowlistedRecipientHashes.length !== 0 ||
    messaging.verifiedCapacity !== null || messaging.capacityVerifiedAt !== null ||
    typeof messaging.disabledReason !== "string" || messaging.disabledReason.length < 1
  ) {
    return fail("ai_authorization_denied", "External messaging must remain disabled.");
  }
  timestampIso(workspace.createdAt, "Workspace createdAt");
  timestampIso(workspace.updatedAt, "Workspace updatedAt");

  const member = exactRecord(
    input.membership, MEMBERSHIP_KEYS, "AI workspace membership", "ai_authorization_denied",
  );
  if (
    typeof input.actor.uid !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.actor.uid) ||
    member.id !== input.actor.uid || member.uid !== input.actor.uid ||
    member.workspaceId !== AI_GOVERNANCE_WORKSPACE_ID || member.status !== "active" ||
    member.synthetic !== true || member.mfaSatisfied !== true
  ) {
    return fail("ai_authorization_denied", "Active MFA-verified membership is required.");
  }
  const teamIds = idList(member.teamIds, "Membership team scope");
  const locationIds = idList(member.locationIds, "Membership location scope");
  const expected = AI_PERSISTED_SCENARIO_MATRIX[input.scenarioId];
  if (member.role === "tenant_admin") {
    if (member.scopeMode !== "workspace_wide" || teamIds.length !== 0 || locationIds.length !== 0) {
      return fail("ai_scope_denied", "Tenant administrator scope is invalid.");
    }
  } else if (member.role === "supervisor") {
    if (
      member.scopeMode !== "assigned" || input.scenarioId === "urgent" ||
      !teamIds.includes(expected.sourceTeamId) || !locationIds.includes(expected.sourceLocationId)
    ) {
      return fail("ai_scope_denied", "Supervisor is outside the fixed scenario scope.");
    }
  } else if (member.role === "clinical_approver") {
    if (
      member.scopeMode !== "assigned" || input.scenarioId !== "urgent" ||
      !teamIds.includes("team_demo_clinical_escalation") ||
      !locationIds.includes("location_demo_wattala")
    ) {
      return fail("ai_scope_denied", "Clinical approver is outside the urgent scenario scope.");
    }
  } else {
    return fail("ai_authorization_denied", "The workspace role cannot record AI evidence.");
  }
  const nowMs = input.now.getTime();
  const tokenMs = input.actor.authTime.getTime();
  const membershipMs = Date.parse(timestampIso(member.lastAuthenticatedAt, "Membership lastAuthenticatedAt"));
  if (
    !Number.isFinite(nowMs) || !Number.isFinite(tokenMs) || !Number.isFinite(membershipMs) ||
    tokenMs > nowMs || membershipMs > nowMs ||
    nowMs - tokenMs > 15 * 60_000 || nowMs - membershipMs > 15 * 60_000
  ) {
    return fail("recent_auth_required", "AI retrospective evidence requires authentication within 15 minutes.");
  }
  timestampIso(member.createdAt, "Membership createdAt");
  timestampIso(member.updatedAt, "Membership updatedAt");
}

function assertConnection(value: DocumentData | undefined): void {
  const connection = exactRecord(value, CONNECTION_KEYS, "AI source connection", "invalid_ai_source_fixture");
  for (const [key, expected] of Object.entries({
    id: "connection_demo_simulator", workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    displayName: "Local WhatsApp journey simulator", provider: "simulator",
    environment: "demo", status: "mock", maskedNumber: "No external number",
    maskedWabaId: null, maskedPhoneNumberId: null, credentialState: "not_configured",
    externalMessagingEnabled: false, networkCallsEnabled: false,
    sortKey: "01_whatsapp_simulator", synthetic: true, schemaVersion: 1,
  })) assertLiteral(connection[key], expected, `AI source connection ${key}`);
  const signals = exactRecord(
    connection.signals, Object.keys(WHATSAPP_SIGNAL_MATRIX), "AI source connection signals",
    "invalid_ai_source_fixture",
  );
  for (const [key, [state, source, detailCode]] of Object.entries(WHATSAPP_SIGNAL_MATRIX)) {
    const signal = exactRecord(signals[key], SIGNAL_KEYS, `AI source signal ${key}`, "invalid_ai_source_fixture");
    assertLiteral(signal.state, state, `AI source signal ${key} state`);
    assertLiteral(signal.source, source, `AI source signal ${key} source`);
    assertLiteral(signal.detailCode, detailCode, `AI source signal ${key} detail`);
    assertLiteral(timestampIso(signal.observedAt, `AI source signal ${key} observedAt`), "2026-08-07T12:20:00.000Z", `AI source signal ${key} observedAt`);
    assertLiteral(signal.lastSuccessfulVerificationAt, null, `AI source signal ${key} verification`);
  }
  assertLiteral(timestampIso(connection.createdAt, "AI source connection createdAt"), "2026-08-01T03:30:00.000Z", "AI source connection createdAt");
  assertLiteral(timestampIso(connection.updatedAt, "AI source connection updatedAt"), "2026-08-07T12:20:00.000Z", "AI source connection updatedAt");
}

function assertContact(value: DocumentData | undefined, expected: ScenarioExpected): void {
  const contact = exactRecord(value, CONTACT_KEYS, "AI source contact", "invalid_ai_source_fixture");
  for (const [key, item] of Object.entries({
    id: expected.sourceContactId, workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    teamId: expected.sourceTeamId, locationId: expected.sourceLocationId, synthetic: true,
  })) assertLiteral(contact[key], item, `AI source contact ${key}`);
  if (
    typeof contact.maskedPhone !== "string" || !contact.maskedPhone.includes("no phone stored") ||
    typeof contact.displayLabel !== "string" || !contact.displayLabel.startsWith("Synthetic Patient ") ||
    !["en", "si", "ta"].includes(contact.preferredLanguage as string) ||
    !Array.isArray(contact.alternateLanguages) || !Array.isArray(contact.tags) ||
    !Number.isInteger(contact.preferenceRevision) || (contact.preferenceRevision as number) < 0
  ) {
    return fail("invalid_ai_source_fixture", "AI source contact is not the bounded synthetic fixture.");
  }
  const suppression = exactRecord(contact.suppression, SUPPRESSION_KEYS, "AI source suppression", "invalid_ai_source_fixture");
  const isStop = expected.sourceContactId === "contact_synthetic_stopped";
  assertLiteral(suppression.suppressAll, false, "AI source suppress-all state");
  assertLiteral(suppression.suppressMarketing, isStop, "AI source marketing suppression state");
  assertLiteral(suppression.invalidContact, false, "AI source invalid-contact state");
  assertArray(suppression.reasons, isStop ? ["stop_keyword"] : [], "AI source suppression reasons");
  if (isStop) {
    assertLiteral(timestampIso(suppression.updatedAt, "AI STOP suppression updatedAt"), "2026-08-07T12:20:00.000Z", "AI STOP suppression updatedAt");
  } else timestampIso(suppression.updatedAt, "AI source suppression updatedAt");
  timestampIso(contact.createdAt, "AI source contact createdAt");
  timestampIso(contact.updatedAt, "AI source contact updatedAt");
}

function assertConversation(value: DocumentData | undefined, expected: ScenarioExpected): void {
  const conversation = exactRecord(value, CONVERSATION_KEYS, "AI source conversation", "invalid_ai_source_fixture");
  for (const [key, item] of Object.entries({
    id: expected.syntheticConversationRef, workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    contactId: expected.sourceContactId, connectionId: expected.sourceConnectionId,
    teamId: expected.sourceTeamId, locationId: expected.sourceLocationId,
    status: expected.observedConversationStatus, mode: expected.observedConversationMode,
    languageConfidence: expected.languageConfidence, purpose: expected.sourcePurpose, synthetic: true,
  })) assertLiteral(conversation[key], item, `AI source conversation ${key}`);
  assertLiteral(
    conversation.detectedLanguage,
    expected.language === "mixed" ? "en" : expected.language,
    "AI source detected language",
  );
  if (
    expected.observedConversationMode === "human_takeover"
      ? typeof conversation.assigneeId !== "string" || conversation.assigneeId.length < 1
      : conversation.assigneeId !== null
  ) {
    return fail("invalid_ai_source_fixture", "AI source assignee state is substituted.");
  }
  timestampIso(conversation.firstResponseDueAt, "AI source conversation firstResponseDueAt");
  for (const key of ["lastMessageAt", "createdAt", "updatedAt"] as const) {
    const iso = timestampIso(conversation[key], `AI source conversation ${key}`);
    if (Date.parse(iso) > Date.parse(AI_GOVERNANCE_EVALUATED_AT)) {
      return fail("invalid_ai_source_fixture", `AI source conversation ${key} post-dates evaluatedAt.`);
    }
  }
  if (conversation.serviceWindowExpiresAt !== null) timestampIso(conversation.serviceWindowExpiresAt, "AI service-window expiry");
  if (typeof conversation.handoffSummary !== "string" || conversation.handoffSummary.length < 1 || !Number.isInteger(conversation.unreadCount)) {
    return fail("invalid_ai_source_fixture", "AI source conversation summary is invalid.");
  }
}

function assertMessage(value: DocumentData | undefined, expected: ScenarioExpected): void {
  const message = exactRecord(value, MESSAGE_KEYS, "AI source message", "invalid_ai_source_fixture");
  for (const [key, item] of Object.entries({
    id: expected.sourceMessageId, workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    conversationId: expected.syntheticConversationRef, contactId: expected.sourceContactId,
    teamId: expected.sourceTeamId, locationId: expected.sourceLocationId,
    direction: "inbound", type: "text", status: "received",
    externalDispatch: "not_applicable", actorId: null, sentAt: null, deliveredAt: null,
    metadataOnly: true, synthetic: true, schemaVersion: 1,
  })) assertLiteral(message[key], item, `AI source message ${key}`);
  const receivedAt = timestampIso(message.receivedAt, "AI source message receivedAt");
  if (Date.parse(receivedAt) > Date.parse(AI_GOVERNANCE_EVALUATED_AT)) {
    return fail("invalid_ai_source_fixture", "AI source message post-dates evaluatedAt.");
  }
  assertLiteral(timestampIso(message.createdAt, "AI source message createdAt"), receivedAt, "AI source message createdAt");
  assertLiteral(timestampIso(message.updatedAt, "AI source message updatedAt"), receivedAt, "AI source message updatedAt");
}

function assertTeam(value: DocumentData | undefined, expected: ScenarioExpected): void {
  const team = exactRecord(value, TEAM_KEYS, "AI source team", "invalid_ai_source_fixture");
  const clinical = expected.sourceTeamId === "team_demo_clinical_escalation";
  for (const [key, item] of Object.entries({
    id: expected.sourceTeamId, workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    name: clinical ? "Clinical safety escalation — simulator" : "General patient services",
    queueType: clinical ? "clinical_escalation" : "general",
    businessHoursLabel: clinical ? "Synthetic on-call path" : "Synthetic schedule: 08:00–20:00 Asia/Colombo",
    firstResponseSlaMinutes: clinical ? 2 : 5, active: true,
  })) assertLiteral(team[key], item, `AI source team ${key}`);
  assertArray(
    team.locationIds,
    ["location_demo_wattala", "location_demo_thalawathugoda"],
    "AI source team locations",
  );
  timestampIso(team.createdAt, "AI source team createdAt");
  timestampIso(team.updatedAt, "AI source team updatedAt");
}

function assertLocation(value: DocumentData | undefined): void {
  const location = exactRecord(value, LOCATION_KEYS, "AI source location", "invalid_ai_source_fixture");
  for (const [key, item] of Object.entries({
    id: "location_demo_wattala", workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    name: "Demo Hospital — Wattala", kind: "hospital", city: "Wattala", active: true,
  })) assertLiteral(location[key], item, `AI source location ${key}`);
  assertArray(
    location.supportedServiceRefs,
    ["demo-general-medicine", "demo-channeling", "demo-laboratory"],
    "AI source location services",
  );
  timestampIso(location.createdAt, "AI source location createdAt");
  timestampIso(location.updatedAt, "AI source location updatedAt");
}

function assertStopConsent(value: DocumentData | undefined, status: "granted" | "withdrawn"): void {
  const consent = exactRecord(value, CONSENT_KEYS, `AI STOP ${status} consent`, "invalid_ai_source_fixture");
  const granted = status === "granted";
  const expected = {
    id: granted ? AI_STOP_SUPPRESSION_EVIDENCE.grantedConsentRecordId : AI_STOP_SUPPRESSION_EVIDENCE.withdrawnConsentRecordId,
    workspaceId: AI_GOVERNANCE_WORKSPACE_ID, contactId: "contact_synthetic_stopped",
    teamId: "team_demo_general", locationId: "location_demo_wattala",
    purpose: "health_campaigns", channel: "whatsapp", category: "marketing", status,
    source: granted ? "synthetic_fixture" : "inbound_keyword",
    noticeVersion: "demo-marketing-notice-v1", language: "en",
    evidenceRef: granted ? AI_STOP_SUPPRESSION_EVIDENCE.grantedConsentEvidenceRef : AI_STOP_SUPPRESSION_EVIDENCE.withdrawnConsentEvidenceRef,
    supersedesRecordId: granted ? null : AI_STOP_SUPPRESSION_EVIDENCE.withdrawnSupersedesRecordId,
    synthetic: true, schemaVersion: 1,
  } as const;
  for (const [key, item] of Object.entries(expected)) assertLiteral(consent[key], item, `AI STOP ${status} consent ${key}`);
  const captured = timestampIso(consent.capturedAt, `AI STOP ${status} capturedAt`);
  assertLiteral(
    captured,
    granted ? AI_STOP_SUPPRESSION_EVIDENCE.grantedConsentCapturedAt : AI_STOP_SUPPRESSION_EVIDENCE.withdrawnConsentCapturedAt,
    `AI STOP ${status} capturedAt`,
  );
  if (granted) assertLiteral(consent.withdrawnAt, null, "AI STOP granted withdrawnAt");
  else assertLiteral(timestampIso(consent.withdrawnAt, "AI STOP withdrawnAt"), AI_STOP_SUPPRESSION_EVIDENCE.withdrawnAt, "AI STOP withdrawnAt");
  assertLiteral(timestampIso(consent.createdAt, `AI STOP ${status} createdAt`), captured, `AI STOP ${status} createdAt`);
  assertLiteral(timestampIso(consent.updatedAt, `AI STOP ${status} updatedAt`), captured, `AI STOP ${status} updatedAt`);
}

function assertGovernanceGraph(input: {
  readonly documents: readonly (DocumentData | undefined)[];
  readonly secrets: readonly (DocumentData | undefined)[];
  readonly selections: readonly (DocumentData | undefined)[];
}): Readonly<Record<string, AiRecord>> {
  const expected = buildAiGovernanceSeedContract();
  AI_KNOWLEDGE_DOCUMENT_IDS.forEach((id, index) =>
    assertExactValue(input.documents[index], expected.documents[id], `Knowledge document ${id}`),
  );
  AI_KNOWLEDGE_DOCUMENT_IDS.forEach((id, index) => {
    const secretId = AI_KNOWLEDGE_DOCUMENT_MATRIX[id].secretId;
    assertExactValue(input.secrets[index], expected.secrets[secretId], `Knowledge secret ${secretId}`);
  });
  AI_KNOWLEDGE_SELECTION_IDS.forEach((id, index) =>
    assertExactValue(input.selections[index], expected.selections[id], `Knowledge selection ${id}`),
  );
  return expected.selections;
}

function firestoreRuntimeRecord(record: AiRecord, timeKey: string): AiRecord {
  return { ...record, [timeKey]: new Date(record[timeKey] as string) };
}

function buildReceipt(input: {
  readonly receiptId: string;
  readonly actorUid: string;
  readonly requestHash: string;
  readonly result: AiRetrospectiveResult;
}): AiRecord {
  return {
    id: input.receiptId, workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    actorUid: input.actorUid, action: AI_GOVERNANCE_ACTION,
    scenarioId: input.result.scenarioId, requestHash: input.requestHash,
    runId: input.result.runId, eventId: input.result.eventId,
    auditEventId: input.result.auditEventId,
    result: { ...input.result, recordedAt: new Date(input.result.recordedAt) },
    createdAt: new Date(input.result.recordedAt), synthetic: true, schemaVersion: 1,
  };
}

function buildAudit(input: {
  readonly receiptId: string;
  readonly actorUid: string;
  readonly result: AiRetrospectiveResult;
}): AiRecord {
  return {
    id: input.result.auditEventId, workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    actorUid: input.actorUid, actorType: "user", action: AI_GOVERNANCE_ACTION,
    resourceType: AI_GOVERNANCE_RESOURCE_TYPE, resourceId: input.result.runId,
    outcome: "simulated", requestId: input.receiptId,
    occurredAt: new Date(input.result.recordedAt), createdAt: new Date(input.result.recordedAt),
    metadata: aiAuditMetadata(input.result), synthetic: true, schemaVersion: 1,
  };
}

function parseStoredReceipt(input: {
  readonly value: DocumentData | undefined;
  readonly receiptId: string;
  readonly actorUid: string;
  readonly requestHash: string;
  readonly scenarioId: AiPersistedScenarioId;
}): AiRetrospectiveResult {
  const receipt = exactRecord(input.value, RECEIPT_KEYS, "AI idempotency receipt", "idempotency_conflict");
  const expected = AI_PERSISTED_SCENARIO_MATRIX[input.scenarioId];
  if (
    receipt.id !== input.receiptId || receipt.workspaceId !== AI_GOVERNANCE_WORKSPACE_ID ||
    receipt.actorUid !== input.actorUid || receipt.action !== AI_GOVERNANCE_ACTION ||
    receipt.scenarioId !== input.scenarioId || receipt.requestHash !== input.requestHash ||
    receipt.runId !== expected.runId || receipt.eventId !== expected.eventId ||
    receipt.auditEventId !== expected.auditEventId || receipt.synthetic !== true ||
    receipt.schemaVersion !== 1
  ) {
    return fail("idempotency_conflict", "AI retrospective receipt does not match this request.");
  }
  const result = exactRecord(receipt.result, RESULT_KEYS, "AI stored result", "idempotency_conflict");
  const recordedAt = timestampIso(result.recordedAt, "AI stored result recordedAt");
  const expectedResult = buildAiRuntimeAggregate(
    input.scenarioId,
    recordedAt,
    expected.knowledgeSelectionId === null
      ? null
      : buildAiGovernanceSeedContract().selections[expected.knowledgeSelectionId],
  ).result;
  assertExactValue(result, expectedResult, "AI stored result");
  if (timestampIso(receipt.createdAt, "AI receipt createdAt") !== recordedAt) {
    return fail("idempotency_conflict", "AI receipt timestamp does not match the stored result.");
  }
  return expectedResult;
}

function assertStoredGraph(input: {
  readonly runtime: readonly (DocumentData | undefined)[];
  readonly receiptId: string;
  readonly actorUid: string;
  readonly requestHash: string;
  readonly scenarioId: AiPersistedScenarioId;
}): AiRetrospectiveResult {
  const [run, event, runSecret, eventSecret, receipt, audit] = input.runtime;
  const result = parseStoredReceipt({
    value: receipt, receiptId: input.receiptId, actorUid: input.actorUid,
    requestHash: input.requestHash, scenarioId: input.scenarioId,
  });
  const expectedScenario = AI_PERSISTED_SCENARIO_MATRIX[input.scenarioId];
  const selection = expectedScenario.knowledgeSelectionId === null
    ? null
    : buildAiGovernanceSeedContract().selections[expectedScenario.knowledgeSelectionId];
  const aggregate = buildAiRuntimeAggregate(input.scenarioId, result.recordedAt, selection);
  assertExactValue(run, aggregate.run, "Stored AI run");
  assertExactValue(event, aggregate.event, "Stored AI event");
  assertExactValue(runSecret, aggregate.runSecret, "Stored AI run secret");
  assertExactValue(eventSecret, aggregate.eventSecret, "Stored AI event secret");
  assertExactValue(audit, buildAudit({ receiptId: input.receiptId, actorUid: input.actorUid, result }), "Stored AI audit");
  return result;
}

function referencesForScenario(db: Firestore, request: AiRetrospectiveRequestInput, actorUid: string) {
  const expected = AI_PERSISTED_SCENARIO_MATRIX[request.scenarioId];
  const prefix = `workspaces/${request.workspaceId}`;
  const receiptId = aiReceiptDocumentId({
    actorUid, action: AI_GOVERNANCE_ACTION, idempotencyKey: request.idempotencyKey,
  });
  return {
    receiptId,
    workspace: db.doc(`workspaces/${request.workspaceId}`),
    membership: db.doc(`${prefix}/members/${actorUid}`),
    run: db.doc(`${prefix}/${AI_RUNTIME_PATH_COLLECTIONS.run}/${expected.runId}`),
    event: db.doc(`${prefix}/${AI_RUNTIME_PATH_COLLECTIONS.event}/${expected.eventId}`),
    runSecret: db.doc(`${prefix}/${AI_RUNTIME_PATH_COLLECTIONS.runSecret}/${expected.runSecretId}`),
    eventSecret: db.doc(`${prefix}/${AI_RUNTIME_PATH_COLLECTIONS.eventSecret}/${expected.eventSecretId}`),
    receipt: db.doc(`${prefix}/${AI_RUNTIME_PATH_COLLECTIONS.receipt}/${receiptId}`),
    audit: db.doc(`${prefix}/${AI_RUNTIME_PATH_COLLECTIONS.audit}/${expected.auditEventId}`),
    connection: db.doc(`${prefix}/whatsappConnections/${expected.sourceConnectionId}`),
    contact: db.doc(`${prefix}/contacts/${expected.sourceContactId}`),
    conversation: db.doc(`${prefix}/conversations/${expected.syntheticConversationRef}`),
    message: db.doc(`${prefix}/messages/${expected.sourceMessageId}`),
    team: db.doc(`${prefix}/teams/${expected.sourceTeamId}`),
    location: db.doc(`${prefix}/locations/${expected.sourceLocationId}`),
    grantedConsent: db.doc(`${prefix}/consentRecords/consent_synthetic_stop_granted`),
    withdrawnConsent: db.doc(`${prefix}/consentRecords/consent_synthetic_stop_withdrawn`),
    knowledgeDocuments: AI_KNOWLEDGE_DOCUMENT_IDS.map((id) =>
      db.doc(`${prefix}/${AI_RUNTIME_PATH_COLLECTIONS.knowledgeDocument}/${id}`)),
    knowledgeSecrets: AI_KNOWLEDGE_DOCUMENT_IDS.map((id) =>
      db.doc(`${prefix}/${AI_RUNTIME_PATH_COLLECTIONS.knowledgeSecret}/${AI_KNOWLEDGE_DOCUMENT_MATRIX[id].secretId}`)),
    knowledgeSelections: AI_KNOWLEDGE_SELECTION_IDS.map((id) =>
      db.doc(`${prefix}/${AI_RUNTIME_PATH_COLLECTIONS.knowledgeSelection}/${id}`)),
  };
}

async function transactionData(
  transaction: Transaction,
  references: readonly DocumentReference[],
): Promise<readonly (DocumentData | undefined)[]> {
  return Promise.all(references.map(async (reference) => data(await transaction.get(reference))));
}

export async function recordSyntheticAiRetrospective(input: {
  readonly db: Firestore;
  readonly config: RuntimeConfig;
  readonly emulator: AiGovernanceEmulatorBoundary;
  readonly actor: AiGovernanceActor;
  readonly request: AiRetrospectiveRequestInput;
  readonly now?: Date;
}): Promise<AiRetrospectiveResponse> {
  const request = parseAiRetrospectiveRequestInput(input.request);
  assertAiGovernanceRuntimeBoundary(input.config, input.emulator, request.workspaceId);
  const now = input.now ?? new Date();
  const recordedAt = now.toISOString();
  if (Date.parse(recordedAt) <= Date.parse(AI_GOVERNANCE_EVALUATED_AT)) {
    return fail("invalid_ai_governance_time", "Server time must be later than evaluatedAt.");
  }
  const requestHash = aiCallRequestFingerprint({
    actorUid: input.actor.uid, workspaceId: request.workspaceId, scenarioId: request.scenarioId,
  });
  const refs = referencesForScenario(input.db, request, input.actor.uid);
  const runtimeRefs = [refs.run, refs.event, refs.runSecret, refs.eventSecret, refs.receipt, refs.audit] as const;

  return input.db.runTransaction(async (transaction) => {
    const [workspace, membership, ...runtime] = await transactionData(
      transaction,
      [refs.workspace, refs.membership, ...runtimeRefs],
    );
    assertWorkspaceAndMembership({
      workspace, membership, actor: input.actor, scenarioId: request.scenarioId, now,
    });

    const receiptExists = runtime[4] !== undefined;
    if (receiptExists) {
      const result = assertStoredGraph({
        runtime, receiptId: refs.receiptId, actorUid: input.actor.uid,
        requestHash, scenarioId: request.scenarioId,
      });
      return { result, auditEventId: result.auditEventId, replayed: true };
    }
    if (runtime.some((item) => item !== undefined)) {
      return fail(
        "idempotency_conflict",
        "AI retrospective fixed scenario evidence already exists under another request.",
      );
    }

    const sourceRefs: DocumentReference[] = [
      refs.connection, refs.contact, refs.conversation, refs.message, refs.team, refs.location,
      ...refs.knowledgeDocuments, ...refs.knowledgeSecrets, ...refs.knowledgeSelections,
    ];
    if (request.scenarioId === "stop") sourceRefs.push(refs.grantedConsent, refs.withdrawnConsent);
    const source = await transactionData(transaction, sourceRefs);
    const expected = AI_PERSISTED_SCENARIO_MATRIX[request.scenarioId];
    assertConnection(source[0]);
    assertContact(source[1], expected);
    assertConversation(source[2], expected);
    assertMessage(source[3], expected);
    assertTeam(source[4], expected);
    assertLocation(source[5]);
    const documents = source.slice(6, 11);
    const secrets = source.slice(11, 16);
    const selections = source.slice(16, 19);
    const selectionById = assertGovernanceGraph({ documents, secrets, selections });
    if (request.scenarioId === "stop") {
      assertStopConsent(source[19], "granted");
      assertStopConsent(source[20], "withdrawn");
    }
    if (
      sha256Hex(serializeAiSourceFixtureIdentityV1(request.scenarioId)) !== expected.sourceFixtureFingerprint ||
      sha256Hex(serializeAiDecisionFixtureIdentityV1(request.scenarioId)) !== expected.decisionFixtureFingerprint
    ) {
      return fail("invalid_ai_governance_evidence", "AI fixture identity fingerprints drifted.");
    }
    let selection: AiRecord | null = null;
    if (expected.knowledgeSelectionId !== null) {
      const candidate = selectionById[expected.knowledgeSelectionId];
      if (candidate === undefined) {
        return fail("invalid_ai_governance_evidence", "Required knowledge selection is missing.");
      }
      selection = candidate;
    }
    const aggregate = buildAiRuntimeAggregate(request.scenarioId, recordedAt, selection);
    const receipt = buildReceipt({
      receiptId: refs.receiptId, actorUid: input.actor.uid, requestHash, result: aggregate.result,
    });
    const audit = buildAudit({
      receiptId: refs.receiptId, actorUid: input.actor.uid, result: aggregate.result,
    });

    transaction.create(refs.run, firestoreRuntimeRecord(aggregate.run, "recordedAt"));
    transaction.create(refs.event, firestoreRuntimeRecord(aggregate.event, "createdAt"));
    transaction.create(refs.runSecret, firestoreRuntimeRecord(aggregate.runSecret, "createdAt"));
    transaction.create(refs.eventSecret, firestoreRuntimeRecord(aggregate.eventSecret, "createdAt"));
    transaction.create(refs.receipt, receipt);
    transaction.create(refs.audit, audit);
    return {
      result: aggregate.result,
      auditEventId: aggregate.result.auditEventId,
      replayed: false,
    };
  });
}

export function assertAiAuditRecordForCompliance(value: unknown): void {
  const audit = exactRecord(value, AUDIT_KEYS, "AI retrospective audit", "invalid_compliance_audit");
  const metadata = exactRecord(
    audit.metadata, AI_AUDIT_METADATA_KEYS, "AI retrospective audit metadata", "invalid_compliance_audit",
  );
  if (
    audit.action !== AI_GOVERNANCE_ACTION || audit.resourceType !== AI_GOVERNANCE_RESOURCE_TYPE ||
    audit.outcome !== "simulated" || audit.actorType !== "user" ||
    audit.synthetic !== true || audit.schemaVersion !== 1 ||
    metadata.synthetic !== true || metadata.evaluationScope !== "retrospective_synthetic_fixture"
  ) {
    return fail("invalid_compliance_audit", "AI retrospective audit contract is invalid.");
  }
  for (const key of [
    "modelCallCount", "providerCallCount", "externalDispatchCount",
    "conversationMutationCount", "handoffMutationCount", "suppressionMutationCount",
  ]) {
    if (metadata[key] !== 0) return fail("invalid_compliance_audit", "AI audit counters must remain zero.");
  }
}
