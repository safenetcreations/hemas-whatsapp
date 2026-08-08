import type { Firestore, Transaction } from "firebase-admin/firestore";

import { deterministicId, sha256Hex } from "../deterministic.js";
import { FailClosedError } from "../errors.js";
import {
  assertAuthorizedSyntheticIngressRoute,
  type AuthorizedSyntheticIngressRoute,
  type SyntheticPhoneRoute,
} from "./boundary.js";
import {
  parseSyntheticWebhookEnvelope,
  type SyntheticInboundMessageEvent,
  type SyntheticInboundScenario,
  type SyntheticMessageStatus,
  type SyntheticWebhookEnvelope,
} from "./contracts.js";

export type SyntheticStoredMessageStatus = "received" | SyntheticMessageStatus;

export type SyntheticIngressAction =
  | "inbound_message_created"
  | "duplicate_message_observed"
  | "status_advanced"
  | "status_observed";

export interface SyntheticIngressResult {
  readonly receiptId: string;
  readonly eventKind: SyntheticWebhookEnvelope["event"]["kind"];
  readonly action: SyntheticIngressAction;
  readonly replayed: boolean;
  readonly duplicate: boolean;
  readonly stateChanged: boolean;
  readonly currentStatus: SyntheticStoredMessageStatus;
  readonly synthetic: true;
  readonly networkCalls: 0;
}

export interface SyntheticIngressSnapshot {
  readonly exists: boolean;
  data(): Readonly<Record<string, unknown>> | undefined;
}

export interface SyntheticIngressTransaction {
  get(path: string): Promise<SyntheticIngressSnapshot>;
  create(path: string, data: Readonly<Record<string, unknown>>): void;
  update(path: string, data: Readonly<Record<string, unknown>>): void;
}

export interface SyntheticIngressStore {
  runTransaction<T>(handler: (transaction: SyntheticIngressTransaction) => Promise<T>): Promise<T>;
}

interface SyntheticIngressDocumentIds {
  readonly webhookEventId: string;
  readonly contactId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly statusEventId: string;
  readonly consentRecordId: string;
}

const REQUEST_HASH = /^[a-f0-9]{64}$/;
const MAX_SYNTHETIC_EVENT_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_SYNTHETIC_EVENT_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const STORED_STATUSES: readonly SyntheticStoredMessageStatus[] = [
  "received",
  "sent",
  "failed",
  "delivered",
  "read",
];

const STATUS_RANK: Readonly<Record<SyntheticStoredMessageStatus, number>> = {
  received: 0,
  sent: 10,
  failed: 15,
  delivered: 20,
  read: 30,
};

const SCENARIO_DETAILS: Readonly<Record<SyntheticInboundScenario, {
  readonly purpose: "appointment" | "laboratory" | "general_support" | "urgent_escalation";
  readonly tag:
    | "appointment"
    | "laboratory"
    | "human-handoff"
    | "marketing-suppressed"
    | "urgent-simulation";
}>> = {
  appointment_request: { purpose: "appointment", tag: "appointment" },
  laboratory_collection_request: { purpose: "laboratory", tag: "laboratory" },
  report_ready_question: { purpose: "laboratory", tag: "human-handoff" },
  stop_request: { purpose: "general_support", tag: "marketing-suppressed" },
  urgent_help: { purpose: "urgent_escalation", tag: "urgent-simulation" },
};

const CONTACT_KEYS = [
  "alternateLanguages",
  "createdAt",
  "displayLabel",
  "id",
  "locationId",
  "maskedPhone",
  "preferenceRevision",
  "preferredLanguage",
  "suppression",
  "synthetic",
  "tags",
  "teamId",
  "updatedAt",
  "workspaceId",
] as const;
const CONTACT_SECRET_KEYS = [
  "contactId",
  "createdAt",
  "encryptedDisplayNameRef",
  "encryptedPhoneRef",
  "externalPatientRef",
  "id",
  "phoneLookupHmac",
  "schemaVersion",
  "synthetic",
  "updatedAt",
  "workspaceId",
] as const;
const CONVERSATION_KEYS = [
  "assigneeId",
  "connectionId",
  "contactId",
  "createdAt",
  "detectedLanguage",
  "firstResponseDueAt",
  "handoffSummary",
  "id",
  "languageConfidence",
  "lastMessageAt",
  "locationId",
  "mode",
  "purpose",
  "serviceWindowExpiresAt",
  "status",
  "synthetic",
  "teamId",
  "unreadCount",
  "updatedAt",
  "workspaceId",
] as const;
const MESSAGE_KEYS = [
  "actorId",
  "contactId",
  "conversationId",
  "createdAt",
  "deliveredAt",
  "direction",
  "externalDispatch",
  "id",
  "locationId",
  "metadataOnly",
  "receivedAt",
  "schemaVersion",
  "sentAt",
  "status",
  "synthetic",
  "teamId",
  "type",
  "updatedAt",
  "workspaceId",
] as const;
const PHONE_ROUTE_KEYS = [
  "active",
  "connectionId",
  "createdAt",
  "id",
  "locationId",
  "routeRef",
  "schemaVersion",
  "synthetic",
  "teamId",
  "updatedAt",
  "workspaceId",
] as const;
const PROVIDER_MESSAGE_CLAIM_KEYS = [
  "contactId",
  "conversationId",
  "createdAt",
  "id",
  "messageId",
  "schemaVersion",
  "semanticHash",
  "synthetic",
  "workspaceId",
] as const;
const CONSENT_RECORD_KEYS = [
  "capturedAt",
  "category",
  "channel",
  "contactId",
  "createdAt",
  "evidenceRef",
  "id",
  "language",
  "locationId",
  "noticeVersion",
  "purpose",
  "schemaVersion",
  "source",
  "status",
  "supersedesRecordId",
  "synthetic",
  "teamId",
  "updatedAt",
  "withdrawnAt",
  "workspaceId",
] as const;
const SUPPRESSION_KEYS = [
  "invalidContact",
  "reasons",
  "suppressAll",
  "suppressMarketing",
  "updatedAt",
] as const;
const SYNTHETIC_STOP_NOTICE_VERSION = "demo-marketing-notice-v1" as const;
const SAFE_CONTACT_TAGS = [
  "appointment",
  "laboratory",
  "package",
  "human-handoff",
  "urgent-simulation",
  "marketing-suppressed",
] as const;
const SAFE_SUPPRESSION_REASONS = [
  "stop_keyword",
  "manual_withdrawal",
  "complaint",
  "invalid_number",
  "guardian_authority_missing",
  "clinical_hold",
] as const;

function failState(message: string): never {
  throw new FailClosedError("synthetic_ingress_state_invalid", message);
}

function requireRecord(
  value: Readonly<Record<string, unknown>> | undefined,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return failState(`${label} is malformed.`);
  }
  return value;
}

function requireStoredStatus(value: unknown): SyntheticStoredMessageStatus {
  if (typeof value !== "string" || !STORED_STATUSES.includes(value as SyntheticStoredMessageStatus)) {
    return failState("Stored synthetic message status is invalid.");
  }
  return value as SyntheticStoredMessageStatus;
}

function assertExactStoredKeys(
  value: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    failState(`${label} does not match the strict persisted schema.`);
  }
}

function isTimestamp(value: unknown): boolean {
  if (value instanceof Date) return Number.isFinite(value.getTime());
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { readonly toDate?: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate(): unknown }).toDate();
    return date instanceof Date && Number.isFinite(date.getTime());
  }
  return false;
}

function timestampMilliseconds(value: unknown): number | undefined {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() : undefined;
  }
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { readonly toDate?: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate(): unknown }).toDate();
    return date instanceof Date && Number.isFinite(date.getTime())
      ? date.getTime()
      : undefined;
  }
  return undefined;
}

function isUniqueAllowlistedArray(
  value: unknown,
  allowed: readonly string[],
  max: number,
): value is readonly string[] {
  return Array.isArray(value) &&
    value.length <= max &&
    new Set(value).size === value.length &&
    value.every((item) => typeof item === "string" && allowed.includes(item));
}

function syntheticContactLookupHmac(route: SyntheticPhoneRoute, contactRef: string): string {
  return sha256Hex(`synthetic-contact:${route.workspaceId}:${route.routeRef}:${contactRef}`);
}

function syntheticEncryptedPhoneRef(workspaceId: string, contactId: string): string {
  return `demo://protected-phone-ref/${workspaceId}/${contactId}`;
}

function syntheticEncryptedDisplayNameRef(workspaceId: string, contactId: string): string {
  return `demo://protected-display-name-ref/${workspaceId}/${contactId}`;
}

function syntheticStopConsentEvidenceRef(workspaceId: string, consentRecordId: string): string {
  return `demo://protected-synthetic-consent/${workspaceId}/${consentRecordId}`;
}

function addMilliseconds(value: Date, milliseconds: number): Date {
  return new Date(value.getTime() + milliseconds);
}

function scenarioConversationState(
  event: SyntheticInboundMessageEvent,
  receivedAt: Date,
): {
  readonly status: "active" | "escalated" | "resolved";
  readonly mode: "automation" | "safety_hold";
  readonly unreadCount: 0 | 1;
  readonly serviceWindowExpiresAt: Date | null;
  readonly firstResponseDueAt: Date;
  readonly handoffSummary: string;
} {
  switch (event.scenarioCode) {
    case "urgent_help":
      return {
        status: "escalated",
        mode: "safety_hold",
        unreadCount: 1,
        serviceWindowExpiresAt: addMilliseconds(receivedAt, 24 * 60 * 60 * 1_000),
        firstResponseDueAt: addMilliseconds(receivedAt, 5 * 60 * 1_000),
        handoffSummary:
          "Synthetic urgent-help code received; ordinary automation is held for human review.",
      };
    case "stop_request":
      return {
        status: "resolved",
        mode: "automation",
        unreadCount: 0,
        serviceWindowExpiresAt: null,
        firstResponseDueAt: receivedAt,
        handoffSummary: "Synthetic STOP code recorded; contact suppression is active.",
      };
    case "laboratory_collection_request":
      return {
        status: "active",
        mode: "automation",
        unreadCount: 1,
        serviceWindowExpiresAt: addMilliseconds(receivedAt, 24 * 60 * 60 * 1_000),
        firstResponseDueAt: addMilliseconds(receivedAt, 15 * 60 * 1_000),
        handoffSummary: "Synthetic laboratory collection request received through demo ingress.",
      };
    case "report_ready_question":
      return {
        status: "active",
        mode: "automation",
        unreadCount: 1,
        serviceWindowExpiresAt: addMilliseconds(receivedAt, 24 * 60 * 60 * 1_000),
        firstResponseDueAt: addMilliseconds(receivedAt, 15 * 60 * 1_000),
        handoffSummary:
          "Synthetic report-ready question received; no report content or interpretation is stored.",
      };
    case "appointment_request":
      return {
        status: "active",
        mode: "automation",
        unreadCount: 1,
        serviceWindowExpiresAt: addMilliseconds(receivedAt, 24 * 60 * 60 * 1_000),
        firstResponseDueAt: addMilliseconds(receivedAt, 15 * 60 * 1_000),
        handoffSummary: "Synthetic appointment request received through demo ingress.",
      };
  }
}

function assertValidDate(value: Date, label: string): void {
  if (!Number.isFinite(value.getTime())) {
    throw new FailClosedError("invalid_synthetic_ingress_time", `${label} is invalid.`);
  }
}

function assertSyntheticWorkspace(
  snapshot: SyntheticIngressSnapshot,
  workspaceId: string,
): void {
  const data = requireRecord(snapshot.data(), "Synthetic workspace");
  if (
    !snapshot.exists ||
    data.id !== workspaceId ||
    data.status !== "active" ||
    data.mode !== "demo" ||
    data.dataClassification !== "synthetic_only"
  ) {
    throw new FailClosedError(
      "synthetic_workspace_denied",
      "An active synthetic-only demo workspace is required.",
    );
  }
}

function assertAuthoritativeSyntheticRoute(
  snapshot: SyntheticIngressSnapshot,
  route: SyntheticPhoneRoute,
): void {
  if (!snapshot.exists) {
    throw new FailClosedError(
      "synthetic_route_denied",
      "The server-only synthetic route record is missing.",
    );
  }
  const data = requireRecord(snapshot.data(), "Synthetic phone route");
  assertExactStoredKeys(data, PHONE_ROUTE_KEYS, "Synthetic phone route");
  if (
    !snapshot.exists ||
    data.id !== route.routeRef ||
    data.routeRef !== route.routeRef ||
    data.workspaceId !== route.workspaceId ||
    data.connectionId !== route.connectionId ||
    data.teamId !== route.teamId ||
    data.locationId !== route.locationId ||
    data.active !== true ||
    data.synthetic !== true ||
    data.schemaVersion !== 1 ||
    !isTimestamp(data.createdAt) ||
    !isTimestamp(data.updatedAt)
  ) {
    throw new FailClosedError(
      "synthetic_route_denied",
      "The server-only route record does not match the synthetic allowlist.",
    );
  }
}

function assertScopedSyntheticRecord(input: {
  readonly snapshot: SyntheticIngressSnapshot;
  readonly id: string;
  readonly route: SyntheticPhoneRoute;
  readonly label: string;
}): Readonly<Record<string, unknown>> {
  const data = requireRecord(input.snapshot.data(), input.label);
  if (
    !input.snapshot.exists ||
    data.id !== input.id ||
    data.workspaceId !== input.route.workspaceId ||
    data.teamId !== input.route.teamId ||
    data.locationId !== input.route.locationId ||
    data.synthetic !== true
  ) {
    throw new FailClosedError(
      "synthetic_record_scope_denied",
      `${input.label} does not match the authorized synthetic route.`,
    );
  }
  return data;
}

function documentPaths(route: SyntheticPhoneRoute, ids: SyntheticIngressDocumentIds): {
  readonly workspace: string;
  readonly phoneRoute: string;
  readonly webhookEvent: string;
  readonly contact: string;
  readonly contactSecret: string;
  readonly conversation: string;
  readonly message: string;
  readonly providerMessageClaim: string;
  readonly statusEvent: string;
  readonly consentRecord: string;
} {
  const root = `workspaces/${route.workspaceId}`;
  return {
    workspace: root,
    phoneRoute: `phoneRoutes/${route.routeRef}`,
    webhookEvent: `${root}/webhookEvents/${ids.webhookEventId}`,
    contact: `${root}/contacts/${ids.contactId}`,
    contactSecret: `${root}/contactSecrets/${ids.contactId}`,
    conversation: `${root}/conversations/${ids.conversationId}`,
    message: `${root}/messages/${ids.messageId}`,
    providerMessageClaim: `${root}/providerMessageClaims/${ids.messageId}`,
    statusEvent: `${root}/messageStatusEvents/${ids.statusEventId}`,
    consentRecord: `${root}/consentRecords/${ids.consentRecordId}`,
  };
}

export function syntheticIngressDocumentIds(
  authorization: AuthorizedSyntheticIngressRoute,
  envelope: SyntheticWebhookEnvelope,
): SyntheticIngressDocumentIds {
  assertAuthorizedSyntheticIngressRoute(authorization);
  const { route } = authorization;
  return {
    webhookEventId: deterministicId(
      "webhook",
      `${route.workspaceId}:${envelope.eventId}`,
    ),
    contactId: deterministicId(
      "contact",
      `${route.workspaceId}:${envelope.event.contactRef}`,
    ),
    conversationId: deterministicId(
      "conversation",
      `${route.workspaceId}:${route.routeRef}:${envelope.event.contactRef}`,
    ),
    messageId: deterministicId(
      "message",
      `${route.workspaceId}:${envelope.event.providerMessageRef}`,
    ),
    statusEventId: deterministicId(
      "message-status",
      `${route.workspaceId}:${envelope.eventId}`,
    ),
    consentRecordId: deterministicId(
      "consent-withdrawal",
      `${route.workspaceId}:${envelope.eventId}:health-campaigns:withdrawn`,
    ),
  };
}

export function deriveMonotonicSyntheticStatus(input: {
  readonly current: SyntheticStoredMessageStatus;
  readonly observed: SyntheticMessageStatus;
}): {
  readonly currentStatus: SyntheticStoredMessageStatus;
  readonly stateChanged: boolean;
} {
  const currentRank = STATUS_RANK[input.current];
  const observedRank = STATUS_RANK[input.observed];
  if (currentRank === undefined || observedRank === undefined) {
    throw new FailClosedError(
      "invalid_synthetic_message_status",
      "Synthetic message status is invalid.",
    );
  }
  return observedRank > currentRank
    ? { currentStatus: input.observed, stateChanged: true }
    : { currentStatus: input.current, stateChanged: false };
}

function storedReceipt(input: {
  readonly snapshot: SyntheticIngressSnapshot;
  readonly requestHash: string;
  readonly eventKind: SyntheticWebhookEnvelope["event"]["kind"];
  readonly receiptId: string;
  readonly eventId: string;
  readonly route: SyntheticPhoneRoute;
}): SyntheticIngressResult | undefined {
  if (!input.snapshot.exists) return undefined;
  const data = requireRecord(input.snapshot.data(), "Synthetic webhook receipt");
  if (data.requestHash !== input.requestHash) {
    throw new FailClosedError(
      "synthetic_webhook_idempotency_conflict",
      "Synthetic webhook event ID is already bound to another request.",
    );
  }
  if (
    data.synthetic !== true ||
    data.schemaVersion !== 1 ||
    data.id !== input.receiptId ||
    data.receiptId !== input.receiptId ||
    data.workspaceId !== input.route.workspaceId ||
    data.eventRefHash !== sha256Hex(input.eventId) ||
    data.routeRefHash !== sha256Hex(input.route.routeRef) ||
    data.eventKind !== input.eventKind ||
    typeof data.action !== "string" ||
    ![
      "inbound_message_created",
      "duplicate_message_observed",
      "status_advanced",
      "status_observed",
    ].includes(data.action) ||
    typeof data.duplicate !== "boolean" ||
    typeof data.stateChanged !== "boolean"
  ) {
    return failState("Stored synthetic webhook receipt is invalid.");
  }
  return {
    receiptId: input.receiptId,
    eventKind: input.eventKind,
    action: data.action as SyntheticIngressAction,
    replayed: true,
    duplicate: data.duplicate,
    stateChanged: data.stateChanged,
    currentStatus: requireStoredStatus(data.currentStatus),
    synthetic: true,
    networkCalls: 0,
  };
}

function webhookRecord(input: {
  readonly result: SyntheticIngressResult;
  readonly envelope: SyntheticWebhookEnvelope;
  readonly route: SyntheticPhoneRoute;
  readonly requestHash: string;
  readonly receivedAt: Date;
}): Readonly<Record<string, unknown>> {
  return {
    id: input.result.receiptId,
    receiptId: input.result.receiptId,
    workspaceId: input.route.workspaceId,
    eventRefHash: sha256Hex(input.envelope.eventId),
    eventKind: input.result.eventKind,
    requestHash: input.requestHash,
    action: input.result.action,
    duplicate: input.result.duplicate,
    stateChanged: input.result.stateChanged,
    currentStatus: input.result.currentStatus,
    routeRefHash: sha256Hex(input.route.routeRef),
    occurredAt: new Date(input.envelope.occurredAt),
    receivedAt: input.receivedAt,
    synthetic: true,
    schemaVersion: 1,
  };
}

function createContactRecord(input: {
  readonly ids: SyntheticIngressDocumentIds;
  readonly route: SyntheticPhoneRoute;
  readonly event: SyntheticInboundMessageEvent;
  readonly receivedAt: Date;
}): Readonly<Record<string, unknown>> {
  const details = SCENARIO_DETAILS[input.event.scenarioCode];
  const stopped = input.event.scenarioCode === "stop_request";
  return {
    id: input.ids.contactId,
    workspaceId: input.route.workspaceId,
    teamId: input.route.teamId,
    locationId: input.route.locationId,
    maskedPhone: "Synthetic fixture contact · no phone stored",
    displayLabel: "Synthetic webhook contact",
    preferredLanguage: input.event.language,
    alternateLanguages: [],
    tags: [details.tag],
    suppression: {
      suppressAll: false,
      suppressMarketing: stopped,
      invalidContact: false,
      reasons: stopped ? ["stop_keyword"] : [],
      updatedAt: input.receivedAt,
    },
    preferenceRevision: 0,
    createdAt: input.receivedAt,
    updatedAt: input.receivedAt,
    synthetic: true,
  };
}

function createContactSecretRecord(input: {
  readonly ids: SyntheticIngressDocumentIds;
  readonly route: SyntheticPhoneRoute;
  readonly event: SyntheticInboundMessageEvent;
  readonly receivedAt: Date;
}): Readonly<Record<string, unknown>> {
  return {
    id: input.ids.contactId,
    workspaceId: input.route.workspaceId,
    contactId: input.ids.contactId,
    phoneLookupHmac: syntheticContactLookupHmac(input.route, input.event.contactRef),
    encryptedPhoneRef: syntheticEncryptedPhoneRef(
      input.route.workspaceId,
      input.ids.contactId,
    ),
    encryptedDisplayNameRef: syntheticEncryptedDisplayNameRef(
      input.route.workspaceId,
      input.ids.contactId,
    ),
    externalPatientRef: null,
    synthetic: true,
    schemaVersion: 1,
    createdAt: input.receivedAt,
    updatedAt: input.receivedAt,
  };
}

function createConversationRecord(input: {
  readonly ids: SyntheticIngressDocumentIds;
  readonly route: SyntheticPhoneRoute;
  readonly event: SyntheticInboundMessageEvent;
  readonly eventOccurredAt: string;
  readonly receivedAt: Date;
}): Readonly<Record<string, unknown>> {
  const details = SCENARIO_DETAILS[input.event.scenarioCode];
  const occurredAt = new Date(input.eventOccurredAt);
  const state = scenarioConversationState(input.event, occurredAt);
  return {
    id: input.ids.conversationId,
    workspaceId: input.route.workspaceId,
    contactId: input.ids.contactId,
    connectionId: input.route.connectionId,
    teamId: input.route.teamId,
    locationId: input.route.locationId,
    status: state.status,
    mode: state.mode,
    assigneeId: null,
    detectedLanguage: input.event.language,
    languageConfidence: 1,
    purpose: details.purpose,
    serviceWindowExpiresAt: state.serviceWindowExpiresAt,
    firstResponseDueAt: state.firstResponseDueAt,
    lastMessageAt: occurredAt,
    handoffSummary: state.handoffSummary,
    unreadCount: state.unreadCount,
    createdAt: input.receivedAt,
    updatedAt: input.receivedAt,
    synthetic: true,
  };
}

function createMessageRecord(input: {
  readonly ids: SyntheticIngressDocumentIds;
  readonly route: SyntheticPhoneRoute;
  readonly envelope: SyntheticWebhookEnvelope & { readonly event: SyntheticInboundMessageEvent };
  readonly receivedAt: Date;
}): Readonly<Record<string, unknown>> {
  return {
    id: input.ids.messageId,
    workspaceId: input.route.workspaceId,
    conversationId: input.ids.conversationId,
    contactId: input.ids.contactId,
    teamId: input.route.teamId,
    locationId: input.route.locationId,
    direction: "inbound",
    type: "text",
    status: "received",
    externalDispatch: "not_applicable",
    actorId: null,
    receivedAt: new Date(input.envelope.occurredAt),
    sentAt: null,
    deliveredAt: null,
    metadataOnly: true,
    createdAt: input.receivedAt,
    updatedAt: input.receivedAt,
    synthetic: true,
    schemaVersion: 1,
  };
}

function inboundProviderSemanticHash(
  route: SyntheticPhoneRoute,
  event: SyntheticInboundMessageEvent,
): string {
  return sha256Hex([
    route.workspaceId,
    route.routeRef,
    event.providerMessageRef,
    event.contactRef,
    event.scenarioCode,
    event.textCode,
    event.language,
  ].join("\u0000"));
}

function createProviderMessageClaim(input: {
  readonly ids: SyntheticIngressDocumentIds;
  readonly route: SyntheticPhoneRoute;
  readonly event: SyntheticInboundMessageEvent;
  readonly receivedAt: Date;
}): Readonly<Record<string, unknown>> {
  return {
    id: input.ids.messageId,
    workspaceId: input.route.workspaceId,
    conversationId: input.ids.conversationId,
    contactId: input.ids.contactId,
    messageId: input.ids.messageId,
    semanticHash: inboundProviderSemanticHash(input.route, input.event),
    synthetic: true,
    schemaVersion: 1,
    createdAt: input.receivedAt,
  };
}

function assertMatchingProviderMessageClaim(input: {
  readonly snapshot: SyntheticIngressSnapshot;
  readonly ids: SyntheticIngressDocumentIds;
  readonly route: SyntheticPhoneRoute;
  readonly event: SyntheticInboundMessageEvent;
}): void {
  if (!input.snapshot.exists) {
    throw new FailClosedError(
      "synthetic_webhook_idempotency_conflict",
      "The provider message reference is missing its immutable semantic claim.",
    );
  }
  const data = requireRecord(input.snapshot.data(), "Synthetic provider-message claim");
  assertExactStoredKeys(
    data,
    PROVIDER_MESSAGE_CLAIM_KEYS,
    "Synthetic provider-message claim",
  );
  if (
    !input.snapshot.exists ||
    data.id !== input.ids.messageId ||
    data.messageId !== input.ids.messageId ||
    data.workspaceId !== input.route.workspaceId ||
    data.conversationId !== input.ids.conversationId ||
    data.contactId !== input.ids.contactId ||
    data.semanticHash !== inboundProviderSemanticHash(input.route, input.event) ||
    data.synthetic !== true ||
    data.schemaVersion !== 1 ||
    !isTimestamp(data.createdAt)
  ) {
    throw new FailClosedError(
      "synthetic_webhook_idempotency_conflict",
      "A provider message reference was reused with different synthetic semantics.",
    );
  }
}

function createStopConsentWithdrawalRecord(input: {
  readonly ids: SyntheticIngressDocumentIds;
  readonly route: SyntheticPhoneRoute;
  readonly envelope: SyntheticWebhookEnvelope & { readonly event: SyntheticInboundMessageEvent };
  readonly receivedAt: Date;
}): Readonly<Record<string, unknown>> {
  if (input.envelope.event.scenarioCode !== "stop_request") {
    return failState("Consent withdrawal evidence requires a synthetic STOP event.");
  }
  const occurredAt = new Date(input.envelope.occurredAt);
  return {
    id: input.ids.consentRecordId,
    workspaceId: input.route.workspaceId,
    contactId: input.ids.contactId,
    teamId: input.route.teamId,
    locationId: input.route.locationId,
    purpose: "health_campaigns",
    channel: "whatsapp",
    category: "marketing",
    status: "withdrawn",
    source: "inbound_keyword",
    noticeVersion: SYNTHETIC_STOP_NOTICE_VERSION,
    language: input.envelope.event.language,
    evidenceRef: syntheticStopConsentEvidenceRef(
      input.route.workspaceId,
      input.ids.consentRecordId,
    ),
    capturedAt: occurredAt,
    withdrawnAt: occurredAt,
    supersedesRecordId: null,
    synthetic: true,
    schemaVersion: 1,
    createdAt: input.receivedAt,
    updatedAt: input.receivedAt,
  };
}

function validateExistingContact(input: {
  readonly snapshot: SyntheticIngressSnapshot;
  readonly ids: SyntheticIngressDocumentIds;
  readonly route: SyntheticPhoneRoute;
}): Readonly<Record<string, unknown>> {
  const data = assertScopedSyntheticRecord({
    snapshot: input.snapshot,
    id: input.ids.contactId,
    route: input.route,
    label: "Synthetic contact",
  });
  assertExactStoredKeys(data, CONTACT_KEYS, "Synthetic contact");
  if (
    typeof data.maskedPhone !== "string" ||
    data.maskedPhone.length < 1 ||
    data.maskedPhone.length > 160 ||
    typeof data.displayLabel !== "string" ||
    data.displayLabel.length < 1 ||
    data.displayLabel.length > 160 ||
    (data.preferredLanguage !== "en" &&
      data.preferredLanguage !== "si" &&
      data.preferredLanguage !== "ta") ||
    !Array.isArray(data.alternateLanguages) ||
    data.alternateLanguages.length > 2 ||
    !isUniqueAllowlistedArray(data.tags, SAFE_CONTACT_TAGS, SAFE_CONTACT_TAGS.length) ||
    !Number.isSafeInteger(data.preferenceRevision) ||
    (data.preferenceRevision as number) < 0 ||
    (data.preferenceRevision as number) > 1_000_000_000 ||
    !isTimestamp(data.createdAt) ||
    !isTimestamp(data.updatedAt)
  ) {
    throw new FailClosedError(
      "synthetic_record_scope_denied",
      "Synthetic contact identity does not match the authorized route.",
    );
  }
  if (
    new Set(data.alternateLanguages).size !== data.alternateLanguages.length ||
    data.alternateLanguages.some((language) =>
      language !== "en" && language !== "si" && language !== "ta") ||
    data.alternateLanguages.includes(data.preferredLanguage)
  ) {
    return failState("Synthetic contact language preferences are invalid.");
  }
  const suppression = requireRecord(
    data.suppression as Readonly<Record<string, unknown>> | undefined,
    "Synthetic contact suppression",
  );
  assertExactStoredKeys(suppression, SUPPRESSION_KEYS, "Synthetic contact suppression");
  if (
    typeof suppression.suppressAll !== "boolean" ||
    typeof suppression.suppressMarketing !== "boolean" ||
    typeof suppression.invalidContact !== "boolean" ||
    !isUniqueAllowlistedArray(suppression.reasons, SAFE_SUPPRESSION_REASONS, 6) ||
    !isTimestamp(suppression.updatedAt)
  ) {
    return failState("Synthetic contact suppression is invalid.");
  }
  return data;
}

function validateExistingContactSecret(input: {
  readonly snapshot: SyntheticIngressSnapshot;
  readonly ids: SyntheticIngressDocumentIds;
  readonly route: SyntheticPhoneRoute;
  readonly contactRef: string;
}): Readonly<Record<string, unknown>> {
  if (!input.snapshot.exists) {
    return failState("Synthetic contact is missing its server-only contact secret.");
  }
  const data = requireRecord(input.snapshot.data(), "Synthetic contact secret");
  assertExactStoredKeys(data, CONTACT_SECRET_KEYS, "Synthetic contact secret");
  if (
    data.id !== input.ids.contactId ||
    data.workspaceId !== input.route.workspaceId ||
    data.contactId !== input.ids.contactId ||
    data.phoneLookupHmac !== syntheticContactLookupHmac(input.route, input.contactRef) ||
    data.encryptedPhoneRef !== syntheticEncryptedPhoneRef(
      input.route.workspaceId,
      input.ids.contactId,
    ) ||
    data.encryptedDisplayNameRef !== syntheticEncryptedDisplayNameRef(
      input.route.workspaceId,
      input.ids.contactId,
    ) ||
    data.externalPatientRef !== null ||
    data.synthetic !== true ||
    data.schemaVersion !== 1 ||
    !isTimestamp(data.createdAt) ||
    !isTimestamp(data.updatedAt) ||
    timestampMilliseconds(data.createdAt) !== timestampMilliseconds(data.updatedAt)
  ) {
    throw new FailClosedError(
      "synthetic_record_scope_denied",
      "Synthetic contact secret does not match the authorized contact reference.",
    );
  }
  return data;
}

function assertCompleteContactSecretPair(input: {
  readonly contact: SyntheticIngressSnapshot;
  readonly contactSecret: SyntheticIngressSnapshot;
}): void {
  if (input.contact.exists !== input.contactSecret.exists) {
    return failState(
      "Synthetic contact and server-only contact secret must exist as a complete pair.",
    );
  }
}

function validateExistingConversation(input: {
  readonly snapshot: SyntheticIngressSnapshot;
  readonly ids: SyntheticIngressDocumentIds;
  readonly route: SyntheticPhoneRoute;
}): Readonly<Record<string, unknown>> {
  const data = assertScopedSyntheticRecord({
    snapshot: input.snapshot,
    id: input.ids.conversationId,
    route: input.route,
    label: "Synthetic conversation",
  });
  assertExactStoredKeys(data, CONVERSATION_KEYS, "Synthetic conversation");
  if (
    data.contactId !== input.ids.contactId ||
    data.connectionId !== input.route.connectionId ||
    !["active", "waiting", "assigned", "escalated", "resolved", "reopened"].includes(
      data.status as string,
    ) ||
    !["automation", "human_takeover", "safety_hold"].includes(data.mode as string) ||
    (data.assigneeId !== null && typeof data.assigneeId !== "string") ||
    (data.detectedLanguage !== "en" &&
      data.detectedLanguage !== "si" &&
      data.detectedLanguage !== "ta") ||
    typeof data.languageConfidence !== "number" ||
    !Number.isFinite(data.languageConfidence) ||
    data.languageConfidence < 0 ||
    data.languageConfidence > 1 ||
    ![
      "appointment",
      "laboratory",
      "package",
      "care_pathway",
      "feedback",
      "general_support",
      "urgent_escalation",
    ].includes(data.purpose as string) ||
    (data.serviceWindowExpiresAt !== null && !isTimestamp(data.serviceWindowExpiresAt)) ||
    !isTimestamp(data.firstResponseDueAt) ||
    !isTimestamp(data.lastMessageAt) ||
    typeof data.handoffSummary !== "string" ||
    data.handoffSummary.length > 500 ||
    !Number.isSafeInteger(data.unreadCount) ||
    (data.unreadCount as number) < 0 ||
    (data.unreadCount as number) > 100_000 ||
    !isTimestamp(data.createdAt) ||
    !isTimestamp(data.updatedAt)
  ) {
    throw new FailClosedError(
      "synthetic_record_scope_denied",
      "Synthetic conversation identity does not match the authorized route.",
    );
  }
  return data;
}

function validateExistingMessage(input: {
  readonly snapshot: SyntheticIngressSnapshot;
  readonly ids: SyntheticIngressDocumentIds;
  readonly route: SyntheticPhoneRoute;
  readonly expectedDirection: "inbound" | "outbound";
}): Readonly<Record<string, unknown>> {
  const data = assertScopedSyntheticRecord({
    snapshot: input.snapshot,
    id: input.ids.messageId,
    route: input.route,
    label: "Synthetic message",
  });
  assertExactStoredKeys(data, MESSAGE_KEYS, "Synthetic message");
  if (
    data.contactId !== input.ids.contactId ||
    data.conversationId !== input.ids.conversationId ||
    data.direction !== input.expectedDirection ||
    data.metadataOnly !== true ||
    data.schemaVersion !== 1 ||
    (data.receivedAt !== null && !isTimestamp(data.receivedAt)) ||
    (data.sentAt !== null && !isTimestamp(data.sentAt)) ||
    (data.deliveredAt !== null && !isTimestamp(data.deliveredAt)) ||
    !isTimestamp(data.createdAt) ||
    !isTimestamp(data.updatedAt)
  ) {
    throw new FailClosedError(
      "synthetic_record_scope_denied",
      "Synthetic message identity does not match the authorized route.",
    );
  }
  const status = requireStoredStatus(data.status);
  if (input.expectedDirection === "inbound") {
    if (
      data.type !== "text" ||
      data.externalDispatch !== "not_applicable" ||
      data.actorId !== null ||
      !isTimestamp(data.receivedAt) ||
      data.sentAt !== null ||
      data.deliveredAt !== null ||
      status !== "received"
    ) {
      return failState("Synthetic inbound message state is invalid.");
    }
  } else if (
    !["text", "template", "interactive"].includes(data.type as string) ||
    data.externalDispatch !== "simulation_only" ||
    (data.actorId !== null && typeof data.actorId !== "string") ||
    data.receivedAt !== null ||
    status === "received"
  ) {
    return failState("Synthetic outbound message state is invalid.");
  }
  return data;
}

function validateExistingStopConsentWithdrawal(input: {
  readonly snapshot: SyntheticIngressSnapshot;
  readonly ids: SyntheticIngressDocumentIds;
  readonly route: SyntheticPhoneRoute;
  readonly envelope: SyntheticWebhookEnvelope & { readonly event: SyntheticInboundMessageEvent };
}): Readonly<Record<string, unknown>> {
  if (input.envelope.event.scenarioCode !== "stop_request") {
    return failState("Consent withdrawal validation requires a synthetic STOP event.");
  }
  if (!input.snapshot.exists) {
    return failState("Synthetic STOP receipt is missing its consent withdrawal evidence.");
  }
  const data = requireRecord(input.snapshot.data(), "Synthetic consent withdrawal");
  assertExactStoredKeys(data, CONSENT_RECORD_KEYS, "Synthetic consent withdrawal");
  const occurredAt = new Date(input.envelope.occurredAt).getTime();
  if (
    data.id !== input.ids.consentRecordId ||
    data.workspaceId !== input.route.workspaceId ||
    data.contactId !== input.ids.contactId ||
    data.teamId !== input.route.teamId ||
    data.locationId !== input.route.locationId ||
    data.purpose !== "health_campaigns" ||
    data.channel !== "whatsapp" ||
    data.category !== "marketing" ||
    data.status !== "withdrawn" ||
    data.source !== "inbound_keyword" ||
    data.noticeVersion !== SYNTHETIC_STOP_NOTICE_VERSION ||
    data.language !== input.envelope.event.language ||
    data.evidenceRef !== syntheticStopConsentEvidenceRef(
      input.route.workspaceId,
      input.ids.consentRecordId,
    ) ||
    timestampMilliseconds(data.capturedAt) !== occurredAt ||
    timestampMilliseconds(data.withdrawnAt) !== occurredAt ||
    data.supersedesRecordId !== null ||
    data.synthetic !== true ||
    data.schemaVersion !== 1 ||
    !isTimestamp(data.createdAt) ||
    !isTimestamp(data.updatedAt) ||
    timestampMilliseconds(data.createdAt) !== timestampMilliseconds(data.updatedAt)
  ) {
    return failState("Synthetic consent withdrawal does not match the strict event-bound schema.");
  }
  return data;
}

function assertConversationUnreadCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= 100_000) {
    return failState("Synthetic conversation unread count is invalid.");
  }
  return value as number;
}

function inboundContactUpdate(input: {
  readonly contact: Readonly<Record<string, unknown>>;
  readonly event: SyntheticInboundMessageEvent;
  readonly receivedAt: Date;
}): Readonly<Record<string, unknown>> {
  const details = SCENARIO_DETAILS[input.event.scenarioCode];
  const currentTags = input.contact.tags as readonly string[];
  const tags = currentTags.includes(details.tag) || currentTags.length >= SAFE_CONTACT_TAGS.length
    ? currentTags
    : [...currentTags, details.tag];
  const tagsChanged = tags !== currentTags;
  const update: Record<string, unknown> = {
    tags,
    updatedAt: input.receivedAt,
  };
  if (tagsChanged) {
    update.preferenceRevision = (input.contact.preferenceRevision as number) + 1;
  }
  if (input.event.scenarioCode === "stop_request") {
    const suppression = requireRecord(
      input.contact.suppression as Readonly<Record<string, unknown>> | undefined,
      "Synthetic contact suppression",
    );
    const currentReasons = suppression.reasons as readonly string[];
    if (!currentReasons.includes("stop_keyword") && currentReasons.length >= 6) {
      return failState("Synthetic contact suppression reason capacity is exhausted.");
    }
    update.suppression = {
      suppressAll: suppression.suppressAll,
      suppressMarketing: true,
      invalidContact: suppression.invalidContact,
      reasons: currentReasons.includes("stop_keyword")
        ? currentReasons
        : [...currentReasons, "stop_keyword"],
      updatedAt: input.receivedAt,
    };
  }
  return update;
}

function inboundConversationUpdate(input: {
  readonly conversation: Readonly<Record<string, unknown>>;
  readonly event: SyntheticInboundMessageEvent;
  readonly occurredAt: Date;
  readonly receivedAt: Date;
}): Readonly<Record<string, unknown>> | null {
  const previousMessageAt = timestampMilliseconds(input.conversation.lastMessageAt);
  if (previousMessageAt === undefined) {
    return failState("Synthetic conversation last-message time is invalid.");
  }
  if (input.occurredAt.getTime() <= previousMessageAt) {
    return null;
  }

  const state = scenarioConversationState(input.event, input.occurredAt);
  const currentMode = input.conversation.mode;
  const preserveHumanControl =
    (currentMode === "safety_hold" || currentMode === "human_takeover") &&
    state.mode !== "safety_hold";
  if (preserveHumanControl) {
    return {
      lastMessageAt: input.occurredAt,
      unreadCount: state.unreadCount === 0
        ? assertConversationUnreadCount(input.conversation.unreadCount)
        : assertConversationUnreadCount(input.conversation.unreadCount) + 1,
      updatedAt: input.receivedAt,
    };
  }

  return {
    status: state.status,
    mode: state.mode,
    detectedLanguage: input.event.language,
    languageConfidence: 1,
    purpose: SCENARIO_DETAILS[input.event.scenarioCode].purpose,
    serviceWindowExpiresAt: state.serviceWindowExpiresAt,
    firstResponseDueAt: state.firstResponseDueAt,
    lastMessageAt: input.occurredAt,
    handoffSummary: state.handoffSummary,
    unreadCount: state.unreadCount === 0
      ? 0
      : assertConversationUnreadCount(input.conversation.unreadCount) + 1,
    updatedAt: input.receivedAt,
  };
}

async function processInbound(input: {
  readonly transaction: SyntheticIngressTransaction;
  readonly authorization: AuthorizedSyntheticIngressRoute;
  readonly envelope: SyntheticWebhookEnvelope & { readonly event: SyntheticInboundMessageEvent };
  readonly ids: SyntheticIngressDocumentIds;
  readonly paths: ReturnType<typeof documentPaths>;
  readonly requestHash: string;
  readonly receivedAt: Date;
}): Promise<SyntheticIngressResult> {
  const { route } = input.authorization;
  const [
    workspace,
    phoneRoute,
    webhook,
    contact,
    contactSecret,
    conversation,
    message,
    providerMessageClaim,
    consentRecord,
  ] = await Promise.all([
    input.transaction.get(input.paths.workspace),
    input.transaction.get(input.paths.phoneRoute),
    input.transaction.get(input.paths.webhookEvent),
    input.transaction.get(input.paths.contact),
    input.transaction.get(input.paths.contactSecret),
    input.transaction.get(input.paths.conversation),
    input.transaction.get(input.paths.message),
    input.transaction.get(input.paths.providerMessageClaim),
    input.transaction.get(input.paths.consentRecord),
  ]);
  assertSyntheticWorkspace(workspace, route.workspaceId);
  assertAuthoritativeSyntheticRoute(phoneRoute, route);
  assertCompleteContactSecretPair({ contact, contactSecret });
  const isStopRequest = input.envelope.event.scenarioCode === "stop_request";
  const occurredAt = new Date(input.envelope.occurredAt);
  const replay = storedReceipt({
    snapshot: webhook,
    requestHash: input.requestHash,
    eventKind: "message_inbound",
    receiptId: input.ids.webhookEventId,
    eventId: input.envelope.eventId,
    route,
  });
  if (replay) {
    if (!contact.exists) {
      return failState("Synthetic webhook receipt is missing its contact dependencies.");
    }
    validateExistingContact({ snapshot: contact, ids: input.ids, route });
    validateExistingContactSecret({
      snapshot: contactSecret,
      ids: input.ids,
      route,
      contactRef: input.envelope.event.contactRef,
    });
    if (isStopRequest) {
      validateExistingStopConsentWithdrawal({
        snapshot: consentRecord,
        ids: input.ids,
        route,
        envelope: input.envelope,
      });
    }
    return replay;
  }
  if (isStopRequest && consentRecord.exists) {
    return failState(
      "Synthetic consent withdrawal exists without its event-bound webhook receipt.",
    );
  }

  if (message.exists) {
    if (!contact.exists || !contactSecret.exists || !conversation.exists) {
      return failState("Synthetic duplicate message dependencies are missing.");
    }
    const contactData = validateExistingContact({
      snapshot: contact,
      ids: input.ids,
      route,
    });
    validateExistingContactSecret({
      snapshot: contactSecret,
      ids: input.ids,
      route,
      contactRef: input.envelope.event.contactRef,
    });
    const conversationData = validateExistingConversation({
      snapshot: conversation,
      ids: input.ids,
      route,
    });
    const messageData = validateExistingMessage({
      snapshot: message,
      ids: input.ids,
      route,
      expectedDirection: "inbound",
    });
    assertMatchingProviderMessageClaim({
      snapshot: providerMessageClaim,
      ids: input.ids,
      route,
      event: input.envelope.event,
    });
    if (isStopRequest) {
      input.transaction.update(input.paths.contact, inboundContactUpdate({
        contact: contactData,
        event: input.envelope.event,
        receivedAt: input.receivedAt,
      }));
      const conversationUpdate = inboundConversationUpdate({
        conversation: conversationData,
        event: input.envelope.event,
        occurredAt,
        receivedAt: input.receivedAt,
      });
      if (conversationUpdate) {
        input.transaction.update(input.paths.conversation, conversationUpdate);
      }
      input.transaction.create(input.paths.consentRecord, createStopConsentWithdrawalRecord({
        ids: input.ids,
        route,
        envelope: input.envelope,
        receivedAt: input.receivedAt,
      }));
    }
    const result: SyntheticIngressResult = {
      receiptId: input.ids.webhookEventId,
      eventKind: "message_inbound",
      action: "duplicate_message_observed",
      replayed: false,
      duplicate: true,
      stateChanged: isStopRequest,
      currentStatus: requireStoredStatus(messageData.status),
      synthetic: true,
      networkCalls: 0,
    };
    input.transaction.create(input.paths.webhookEvent, webhookRecord({
      result,
      envelope: input.envelope,
      route,
      requestHash: input.requestHash,
      receivedAt: input.receivedAt,
    }));
    return result;
  }

  if (providerMessageClaim.exists) {
    return failState("A provider-message claim exists without its synthetic message.");
  }

  if (contact.exists) {
    const contactData = validateExistingContact({
      snapshot: contact,
      ids: input.ids,
      route,
    });
    validateExistingContactSecret({
      snapshot: contactSecret,
      ids: input.ids,
      route,
      contactRef: input.envelope.event.contactRef,
    });
    input.transaction.update(input.paths.contact, inboundContactUpdate({
      contact: contactData,
      event: input.envelope.event,
      receivedAt: input.receivedAt,
    }));
  } else {
    input.transaction.create(input.paths.contact, createContactRecord({
      ids: input.ids,
      route,
      event: input.envelope.event,
      receivedAt: input.receivedAt,
    }));
    input.transaction.create(input.paths.contactSecret, createContactSecretRecord({
      ids: input.ids,
      route,
      event: input.envelope.event,
      receivedAt: input.receivedAt,
    }));
  }

  if (conversation.exists) {
    const conversationData = validateExistingConversation({
      snapshot: conversation,
      ids: input.ids,
      route,
    });
    const conversationUpdate = inboundConversationUpdate({
      conversation: conversationData,
      event: input.envelope.event,
      occurredAt,
      receivedAt: input.receivedAt,
    });
    if (conversationUpdate) {
      input.transaction.update(input.paths.conversation, conversationUpdate);
    }
  } else {
    input.transaction.create(input.paths.conversation, createConversationRecord({
      ids: input.ids,
      route,
      event: input.envelope.event,
      eventOccurredAt: input.envelope.occurredAt,
      receivedAt: input.receivedAt,
    }));
  }

  input.transaction.create(input.paths.message, createMessageRecord({
    ids: input.ids,
    route,
    envelope: input.envelope,
    receivedAt: input.receivedAt,
  }));
  input.transaction.create(input.paths.providerMessageClaim, createProviderMessageClaim({
    ids: input.ids,
    route,
    event: input.envelope.event,
    receivedAt: input.receivedAt,
  }));
  if (isStopRequest) {
    input.transaction.create(input.paths.consentRecord, createStopConsentWithdrawalRecord({
      ids: input.ids,
      route,
      envelope: input.envelope,
      receivedAt: input.receivedAt,
    }));
  }
  const result: SyntheticIngressResult = {
    receiptId: input.ids.webhookEventId,
    eventKind: "message_inbound",
    action: "inbound_message_created",
    replayed: false,
    duplicate: false,
    stateChanged: true,
    currentStatus: "received",
    synthetic: true,
    networkCalls: 0,
  };
  input.transaction.create(input.paths.webhookEvent, webhookRecord({
    result,
    envelope: input.envelope,
    route,
    requestHash: input.requestHash,
    receivedAt: input.receivedAt,
  }));
  return result;
}

async function processStatus(input: {
  readonly transaction: SyntheticIngressTransaction;
  readonly authorization: AuthorizedSyntheticIngressRoute;
  readonly envelope: SyntheticWebhookEnvelope & {
    readonly event: Extract<SyntheticWebhookEnvelope["event"], { readonly kind: "message_status" }>;
  };
  readonly ids: SyntheticIngressDocumentIds;
  readonly paths: ReturnType<typeof documentPaths>;
  readonly requestHash: string;
  readonly receivedAt: Date;
}): Promise<SyntheticIngressResult> {
  const { route } = input.authorization;
  const [
    workspace,
    phoneRoute,
    webhook,
    contact,
    contactSecret,
    conversation,
    message,
    statusEvent,
  ] = await Promise.all([
    input.transaction.get(input.paths.workspace),
    input.transaction.get(input.paths.phoneRoute),
    input.transaction.get(input.paths.webhookEvent),
    input.transaction.get(input.paths.contact),
    input.transaction.get(input.paths.contactSecret),
    input.transaction.get(input.paths.conversation),
    input.transaction.get(input.paths.message),
    input.transaction.get(input.paths.statusEvent),
  ]);
  assertSyntheticWorkspace(workspace, route.workspaceId);
  assertAuthoritativeSyntheticRoute(phoneRoute, route);
  assertCompleteContactSecretPair({ contact, contactSecret });
  const replay = storedReceipt({
    snapshot: webhook,
    requestHash: input.requestHash,
    eventKind: "message_status",
    receiptId: input.ids.webhookEventId,
    eventId: input.envelope.eventId,
    route,
  });
  if (replay) {
    if (!contact.exists) {
      return failState("Synthetic status receipt is missing its contact dependencies.");
    }
    validateExistingContact({ snapshot: contact, ids: input.ids, route });
    validateExistingContactSecret({
      snapshot: contactSecret,
      ids: input.ids,
      route,
      contactRef: input.envelope.event.contactRef,
    });
    return replay;
  }
  if (statusEvent.exists) {
    return failState("A status event exists without its webhook receipt.");
  }
  if (!contact.exists || !contactSecret.exists || !conversation.exists || !message.exists) {
    throw new FailClosedError(
      "synthetic_message_not_found",
      "Status callbacks require an existing synthetic outbound message.",
    );
  }
  validateExistingContact({
    snapshot: contact,
    ids: input.ids,
    route,
  });
  validateExistingContactSecret({
    snapshot: contactSecret,
    ids: input.ids,
    route,
    contactRef: input.envelope.event.contactRef,
  });
  validateExistingConversation({ snapshot: conversation, ids: input.ids, route });
  const messageData = validateExistingMessage({
    snapshot: message,
    ids: input.ids,
    route,
    expectedDirection: "outbound",
  });
  const current = requireStoredStatus(messageData.status);
  const derived = deriveMonotonicSyntheticStatus({
    current,
    observed: input.envelope.event.status,
  });
  const timestampUpdate: Record<string, unknown> = {};
  if (input.envelope.event.status === "sent" && messageData.sentAt === null) {
    timestampUpdate.sentAt = new Date(input.envelope.occurredAt);
  }
  if (input.envelope.event.status === "delivered" && messageData.deliveredAt === null) {
    timestampUpdate.deliveredAt = new Date(input.envelope.occurredAt);
  }
  const metadataChanged = Object.keys(timestampUpdate).length > 0;
  const action: SyntheticIngressAction = derived.stateChanged
    ? "status_advanced"
    : "status_observed";
  const result: SyntheticIngressResult = {
    receiptId: input.ids.webhookEventId,
    eventKind: "message_status",
    action,
    replayed: false,
    duplicate: false,
    stateChanged: derived.stateChanged || metadataChanged,
    currentStatus: derived.currentStatus,
    synthetic: true,
    networkCalls: 0,
  };
  input.transaction.create(input.paths.statusEvent, {
    id: input.ids.statusEventId,
    workspaceId: route.workspaceId,
    conversationId: input.ids.conversationId,
    contactId: input.ids.contactId,
    messageId: input.ids.messageId,
    teamId: route.teamId,
    locationId: route.locationId,
    observedStatus: input.envelope.event.status,
    observedRank: STATUS_RANK[input.envelope.event.status],
    statusCode: input.envelope.event.statusCode,
    stateChanged: derived.stateChanged || metadataChanged,
    currentStatusAfter: derived.currentStatus,
    occurredAt: new Date(input.envelope.occurredAt),
    receivedAt: input.receivedAt,
    synthetic: true,
    schemaVersion: 1,
  });
  if (derived.stateChanged || metadataChanged) {
    const update: Record<string, unknown> = {
      ...timestampUpdate,
      updatedAt: input.receivedAt,
    };
    if (derived.stateChanged) {
      update.status = derived.currentStatus;
    }
    input.transaction.update(input.paths.message, update);
  }
  input.transaction.create(input.paths.webhookEvent, webhookRecord({
    result,
    envelope: input.envelope,
    route,
    requestHash: input.requestHash,
    receivedAt: input.receivedAt,
  }));
  return result;
}

export async function processSyntheticWebhookEvent(input: {
  readonly store: SyntheticIngressStore;
  readonly authorization: AuthorizedSyntheticIngressRoute;
  readonly envelope: SyntheticWebhookEnvelope;
  readonly requestHash: string;
  readonly receivedAt?: Date;
}): Promise<SyntheticIngressResult> {
  assertAuthorizedSyntheticIngressRoute(input.authorization);
  if (!REQUEST_HASH.test(input.requestHash)) {
    throw new FailClosedError(
      "invalid_synthetic_request_hash",
      "A SHA-256 raw webhook fingerprint is required.",
    );
  }
  const receivedAt = input.receivedAt ?? new Date();
  assertValidDate(receivedAt, "Synthetic ingress receipt time");
  const envelope = parseSyntheticWebhookEnvelope(
    Buffer.from(JSON.stringify(input.envelope), "utf8"),
  );
  const occurredAt = new Date(envelope.occurredAt);
  assertValidDate(occurredAt, "Synthetic webhook occurrence time");
  const eventAge = receivedAt.getTime() - occurredAt.getTime();
  if (
    eventAge > MAX_SYNTHETIC_EVENT_AGE_MS ||
    eventAge < -MAX_SYNTHETIC_EVENT_FUTURE_SKEW_MS
  ) {
    throw new FailClosedError(
      "invalid_synthetic_ingress_time",
      "Synthetic webhook occurrence time is outside the bounded receipt window.",
    );
  }
  if (envelope.routeRef !== input.authorization.route.routeRef) {
    throw new FailClosedError(
      "synthetic_route_denied",
      "Webhook route does not match the server-side authorization.",
    );
  }
  const ids = syntheticIngressDocumentIds(input.authorization, envelope);
  const paths = documentPaths(input.authorization.route, ids);
  return input.store.runTransaction(async (transaction) => {
    if (envelope.event.kind === "message_inbound") {
      return processInbound({
        transaction,
        authorization: input.authorization,
        envelope: { ...envelope, event: envelope.event },
        ids,
        paths,
        requestHash: input.requestHash,
        receivedAt,
      });
    }
    return processStatus({
      transaction,
      authorization: input.authorization,
      envelope: { ...envelope, event: envelope.event },
      ids,
      paths,
      requestHash: input.requestHash,
      receivedAt,
    });
  });
}

class AdminFirestoreIngressStore implements SyntheticIngressStore {
  constructor(private readonly db: Firestore) {}

  async runTransaction<T>(
    handler: (transaction: SyntheticIngressTransaction) => Promise<T>,
  ): Promise<T> {
    return this.db.runTransaction(async (transaction: Transaction) => handler({
      get: async (path) => {
        const snapshot = await transaction.get(this.db.doc(path));
        return {
          exists: snapshot.exists,
          data: () => snapshot.data(),
        };
      },
      create: (path, data) => {
        transaction.create(this.db.doc(path), data);
      },
      update: (path, data) => {
        transaction.update(this.db.doc(path), data);
      },
    }));
  }
}

export function createAdminFirestoreIngressStore(input: {
  readonly db: Firestore;
  readonly authorization: AuthorizedSyntheticIngressRoute;
}): SyntheticIngressStore {
  assertAuthorizedSyntheticIngressRoute(input.authorization);
  return new AdminFirestoreIngressStore(input.db);
}
