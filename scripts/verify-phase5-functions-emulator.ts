export {};

import { createHash, createHmac } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDocFromServer,
  getDocsFromServer,
  Timestamp,
  type Firestore,
} from "firebase/firestore";
import { getHemasFirestore } from "../lib/firebase/firestore-target";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";
import {
  PHASE5_SECRET_COLLECTIONS,
  assertAutomationRunEventSecretJoin,
  assertAutomationWorkItemSecretJoin,
  assertCareEnrollmentEventSecretJoin,
  assertCareEscalationSecretJoin,
  assertPhase5EventAuditJoin,
  parseAutomationRunDocument,
  parseAutomationRunEventDocument,
  parseAutomationRunEventSecretDocument,
  parseAutomationWorkItemDocument,
  parseAutomationWorkItemSecretDocument,
  parseCareEnrollmentDocument,
  parseCareEnrollmentEventDocument,
  parseCareEnrollmentEventSecretDocument,
  parseCareEscalationDocument,
  parseCareEscalationSecretDocument,
  parseCareHandoffDocument,
  parsePhase5AuditDocument,
} from "../lib/firebase/repositories";

const PROJECT_ID = "demo-hemas-connect";
const WORKSPACE_ID = "workspace_safenet_demo";
const AUTOMATION_RUN_ID = "automation_run_synthetic_appointment_001";
const CARE_ENROLLMENT_ID = "care_enrollment_synthetic_001";
const CARE_CONTACT_ID = "contact_synthetic_urgent";
const CARE_CONTROL_CONVERSATION_ID = "conversation_synthetic_phase5_care";
const URGENT_SAFETY_CONVERSATION_ID = "conversation_synthetic_urgent";
const SIMULATOR_CONNECTION_ID = "connection_demo_simulator";
const AUTOMATION_TEAM_ID = "team_demo_general";
const AUTOMATION_LOCATION_ID = "location_demo_wattala";
const CARE_TEAM_ID = "team_demo_clinical_escalation";
const CARE_LOCATION_ID = "location_demo_wattala";
const AUTH_EMAIL = "demo.admin@synthetic.invalid";
const AUTH_PASSWORD =
  process.env.DEMO_ADMIN_PASSWORD ?? "Synthetic-Demo-Only-2026!";

const EXPECTED_EMULATOR_HOSTS = Object.freeze({
  functions: "127.0.0.1:5001",
  auth: "127.0.0.1:9099",
  firestore: "127.0.0.1:8080",
});

const AUTOMATION_RESPONSE_KEYS = ["result", "auditEventId", "replayed"] as const;
const AUTOMATION_RESULT_KEYS = [
  "runId",
  "eventId",
  "action",
  "state",
  "revision",
  "currentStepIndex",
  "completedStepCount",
  "attemptCount",
  "nextEligibleAt",
  "openWorkItemId",
  "outcomeCode",
  "synthetic",
  "externalDispatchCount",
  "networkCallCount",
] as const;
const CARE_RESPONSE_KEYS = ["result", "auditEventId", "replayed"] as const;
const CARE_RESULT_KEYS = [
  "enrollmentId",
  "eventId",
  "action",
  "state",
  "revision",
  "nextContactIndex",
  "nextContactAt",
  "openEscalationId",
  "safetyHoldEscalationId",
  "openHandoffId",
  "outcomeCode",
  "synthetic",
  "externalDispatchCount",
  "networkCallCount",
] as const;
const RUNTIME_AUDIT_METADATA_KEYS = [
  "eventId",
  "fromState",
  "toState",
  "revision",
  "outcomeCode",
  "resultFingerprint",
  "synthetic",
  "externalDispatchCount",
  "networkCallCount",
] as const;
const IDEMPOTENCY_KEYS = [
  "id",
  "workspaceId",
  "actorUid",
  "action",
  "purpose",
  "requestHash",
  "aggregateId",
  "eventId",
  "result",
  "auditEventId",
  "createdAt",
  "synthetic",
  "schemaVersion",
] as const;
const MEMBERSHIP_KEYS = [
  "id",
  "uid",
  "workspaceId",
  "displayLabel",
  "role",
  "scopeMode",
  "teamIds",
  "locationIds",
  "status",
  "mfaSatisfied",
  "lastAuthenticatedAt",
  "synthetic",
  "createdAt",
  "updatedAt",
] as const;
const CONVERSATION_KEYS = [
  "id",
  "workspaceId",
  "contactId",
  "connectionId",
  "teamId",
  "locationId",
  "status",
  "mode",
  "assigneeId",
  "detectedLanguage",
  "languageConfidence",
  "purpose",
  "serviceWindowExpiresAt",
  "firstResponseDueAt",
  "lastMessageAt",
  "handoffSummary",
  "unreadCount",
  "synthetic",
  "createdAt",
  "updatedAt",
] as const;

type AutomationAction =
  | "start"
  | "advance_step"
  | "simulate_human_takeover"
  | "release_human_takeover"
  | "resume"
  | "end";
type AutomationRequest = {
  readonly workspaceId: string;
  readonly runId: string;
  readonly action: AutomationAction;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
};
type AutomationResult = {
  readonly runId: string;
  readonly eventId: string;
  readonly action: AutomationAction;
  readonly state: string;
  readonly revision: number;
  readonly currentStepIndex: number;
  readonly completedStepCount: number;
  readonly attemptCount: number;
  readonly nextEligibleAt: string | null;
  readonly openWorkItemId: string | null;
  readonly outcomeCode: string;
  readonly synthetic: true;
  readonly externalDispatchCount: 0;
  readonly networkCallCount: 0;
};
type AutomationResponse = {
  readonly result: AutomationResult;
  readonly auditEventId: string;
  readonly replayed: boolean;
};

type CareAction =
  | "start"
  | "advance_contact"
  | "human_takeover_started"
  | "release_human_takeover"
  | "resume"
  | "raise_red_flag"
  | "acknowledge_escalation"
  | "resolve_escalation"
  | "clear_safety_hold"
  | "simulate_suppression"
  | "clear_clinical_hold"
  | "end";
type CareRequest = {
  readonly workspaceId: string;
  readonly enrollmentId: string;
  readonly action: CareAction;
  readonly expectedRevision: number;
  readonly suppressionReason: "clinical_hold" | null;
  readonly idempotencyKey: string;
};
type CareResult = {
  readonly enrollmentId: string;
  readonly eventId: string;
  readonly action: CareAction;
  readonly state: string;
  readonly revision: number;
  readonly nextContactIndex: number;
  readonly nextContactAt: string | null;
  readonly openEscalationId: string | null;
  readonly safetyHoldEscalationId: string | null;
  readonly openHandoffId: string | null;
  readonly outcomeCode: string;
  readonly synthetic: true;
  readonly externalDispatchCount: 0;
  readonly networkCallCount: 0;
};
type CareResponse = {
  readonly result: CareResult;
  readonly auditEventId: string;
  readonly replayed: boolean;
};

type FirestoreRestValue = {
  readonly nullValue?: null;
  readonly booleanValue?: boolean;
  readonly integerValue?: string;
  readonly doubleValue?: number;
  readonly timestampValue?: string;
  readonly stringValue?: string;
  readonly arrayValue?: { readonly values?: readonly FirestoreRestValue[] };
  readonly mapValue?: {
    readonly fields?: Readonly<Record<string, FirestoreRestValue>>;
  };
};
type FirestoreRestDocument = {
  readonly name?: string;
  readonly fields?: Readonly<Record<string, FirestoreRestValue>>;
  readonly createTime?: string;
  readonly updateTime?: string;
};

function fail(message: string): never {
  throw new Error(message);
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail(`${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    return fail(`${label} does not contain its exact keyset.`);
  }
  return record;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    return fail(`${label} must be a non-empty string.`);
  }
  return value;
}

function integerValue(value: unknown, label: string): number {
  if (!Number.isInteger(value)) return fail(`${label} must be an integer.`);
  return value as number;
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : stringValue(value, label);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function syntheticHmac(value: string): string {
  return createHmac(
    "sha256",
    "PUBLIC-SYNTHETIC-TEST-KEY-NOT-A-SECRET",
  ).update(value, "utf8").digest("hex");
}

function deterministicId(prefix: string, value: string): string {
  return `${prefix}-${sha256(value).slice(0, 24)}`;
}

function assertDigest(value: unknown, label: string): string {
  const digest = stringValue(value, label);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    return fail(`${label} must be a lowercase 64-hex digest.`);
  }
  return digest;
}

function callableErrorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
}

function assertExactBoundary(): {
  readonly functionsHost: string;
  readonly authHost: string;
  readonly firestoreHost: string;
} {
  const projectId = process.env.GCLOUD_PROJECT;
  const functionsHost = process.env.FUNCTIONS_EMULATOR_HOST;
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (projectId !== PROJECT_ID) {
    return fail("Refusing Phase 5 verification outside the exact demo project.");
  }
  if (
    functionsHost !== EXPECTED_EMULATOR_HOSTS.functions ||
    authHost !== EXPECTED_EMULATOR_HOSTS.auth ||
    firestoreHost !== EXPECTED_EMULATOR_HOSTS.firestore
  ) {
    return fail(
      "Phase 5 verification requires exact 127.0.0.1 Functions/Auth/Firestore emulator ports.",
    );
  }
  return { functionsHost, authHost, firestoreHost };
}

function firestoreRestBase(firestoreHost: string): URL {
  return new URL(
    `/v1/projects/${PROJECT_ID}/databases/(default)/documents/`,
    `http://${firestoreHost}`,
  );
}

function firestoreRestUrl(firestoreHost: string, segments: readonly string[]): URL {
  const base = firestoreRestBase(firestoreHost);
  base.pathname += segments.map(encodeURIComponent).join("/");
  return base;
}

async function adminFetch(
  url: URL,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: "Bearer owner",
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(5_000),
  });
}

async function adminGetRawDocument(
  firestoreHost: string,
  segments: readonly string[],
): Promise<FirestoreRestDocument> {
  const response = await adminFetch(firestoreRestUrl(firestoreHost, segments));
  if (!response.ok) {
    return fail(
      `Local Admin document read ${segments.join("/")} failed with HTTP ${response.status}.`,
    );
  }
  return await response.json() as FirestoreRestDocument;
}

async function adminPatchRawDocument(
  firestoreHost: string,
  segments: readonly string[],
  fields: Readonly<Record<string, FirestoreRestValue>>,
): Promise<void> {
  const url = firestoreRestUrl(firestoreHost, segments);
  url.searchParams.set("currentDocument.exists", "true");
  const response = await adminFetch(url, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) {
    return fail(
      `Local Admin membership patch ${segments.join("/")} failed with HTTP ${response.status}.`,
    );
  }
}

async function adminListRawDocuments(
  firestoreHost: string,
  segments: readonly string[],
): Promise<readonly FirestoreRestDocument[]> {
  const documents: FirestoreRestDocument[] = [];
  let pageToken: string | undefined;
  do {
    const url = firestoreRestUrl(firestoreHost, segments);
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await adminFetch(url);
    if (!response.ok) {
      return fail(
        `Local Admin collection read ${segments.join("/")} failed with HTTP ${response.status}.`,
      );
    }
    const body = await response.json() as {
      readonly documents?: readonly FirestoreRestDocument[];
      readonly nextPageToken?: string;
    };
    documents.push(...(body.documents ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return documents;
}

function decodeRestValue(value: FirestoreRestValue): unknown {
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) {
    return Timestamp.fromDate(new Date(stringValue(value.timestampValue, "REST timestamp")));
  }
  if ("stringValue" in value) return value.stringValue;
  if ("arrayValue" in value) {
    return (value.arrayValue?.values ?? []).map(decodeRestValue);
  }
  if ("mapValue" in value) {
    return decodeRestFields(value.mapValue?.fields ?? {});
  }
  return fail("Unsupported Firestore REST value in the Phase 5 verifier.");
}

function decodeRestFields(
  fields: Readonly<Record<string, FirestoreRestValue>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeRestValue(value)]),
  );
}

function documentId(document: FirestoreRestDocument): string {
  const name = stringValue(document.name, "Firestore REST document name");
  const id = name.split("/").at(-1);
  return stringValue(id, "Firestore REST document ID");
}

async function adminGetDocument(
  firestoreHost: string,
  collectionName: string,
  id: string,
): Promise<Record<string, unknown>> {
  const document = await adminGetRawDocument(firestoreHost, [
    "workspaces",
    WORKSPACE_ID,
    collectionName,
    id,
  ]);
  if (documentId(document) !== id || !document.fields) {
    return fail(`${collectionName}/${id} failed its REST path identity.`);
  }
  return decodeRestFields(document.fields);
}

async function adminCollectionCount(
  firestoreHost: string,
  collectionName: string,
): Promise<number> {
  return (
    await adminListRawDocuments(firestoreHost, [
      "workspaces",
      WORKSPACE_ID,
      collectionName,
    ])
  ).length;
}

async function adminCounts(
  firestoreHost: string,
  expected: Readonly<Record<string, number>>,
): Promise<Readonly<Record<string, number>>> {
  const entries = await Promise.all(
    Object.keys(expected).map(async (collectionName) => [
      collectionName,
      await adminCollectionCount(firestoreHost, collectionName),
    ] as const),
  );
  return Object.fromEntries(entries);
}

function assertCounts(
  actual: Readonly<Record<string, number>>,
  expected: Readonly<Record<string, number>>,
  label: string,
): void {
  if (!isDeepStrictEqual(actual, expected)) {
    fail(`${label} collection counts changed: ${JSON.stringify(actual)}.`);
  }
}

function automationResultFingerprint(result: AutomationResult): string {
  return sha256(JSON.stringify([
    "hemas-connect:automation-control-result:v1",
    result.runId,
    result.eventId,
    result.action,
    result.state,
    result.revision,
    result.currentStepIndex,
    result.completedStepCount,
    result.attemptCount,
    result.nextEligibleAt,
    result.openWorkItemId,
    result.outcomeCode,
    true,
    0,
    0,
  ]));
}

function careResultFingerprint(result: CareResult): string {
  return sha256(JSON.stringify([
    "hemas-connect:care-control-result:v1",
    result.enrollmentId,
    result.eventId,
    result.action,
    result.state,
    result.revision,
    result.nextContactIndex,
    result.nextContactAt,
    result.openEscalationId,
    result.safetyHoldEscalationId,
    result.openHandoffId,
    result.outcomeCode,
    true,
    0,
    0,
  ]));
}

function parseAutomationResponse(value: unknown): AutomationResponse {
  const response = exactRecord(value, AUTOMATION_RESPONSE_KEYS, "Automation response");
  const result = exactRecord(
    response.result,
    AUTOMATION_RESULT_KEYS,
    "Automation response result",
  );
  const parsed: AutomationResult = {
    runId: stringValue(result.runId, "Automation result runId"),
    eventId: stringValue(result.eventId, "Automation result eventId"),
    action: stringValue(result.action, "Automation result action") as AutomationAction,
    state: stringValue(result.state, "Automation result state"),
    revision: integerValue(result.revision, "Automation result revision"),
    currentStepIndex: integerValue(
      result.currentStepIndex,
      "Automation result currentStepIndex",
    ),
    completedStepCount: integerValue(
      result.completedStepCount,
      "Automation result completedStepCount",
    ),
    attemptCount: integerValue(result.attemptCount, "Automation result attemptCount"),
    nextEligibleAt: nullableString(
      result.nextEligibleAt,
      "Automation result nextEligibleAt",
    ),
    openWorkItemId: nullableString(
      result.openWorkItemId,
      "Automation result openWorkItemId",
    ),
    outcomeCode: stringValue(result.outcomeCode, "Automation result outcomeCode"),
    synthetic: result.synthetic === true
      ? true
      : fail("Automation result must remain synthetic."),
    externalDispatchCount: result.externalDispatchCount === 0
      ? 0
      : fail("Automation result external dispatch count must remain zero."),
    networkCallCount: result.networkCallCount === 0
      ? 0
      : fail("Automation result network call count must remain zero."),
  };
  if (
    !(
      [
        "start",
        "advance_step",
        "simulate_human_takeover",
        "release_human_takeover",
        "resume",
        "end",
      ] as const
    ).includes(parsed.action)
  ) {
    return fail("Automation verifier received an unexpected action.");
  }
  return {
    result: parsed,
    auditEventId: stringValue(response.auditEventId, "Automation auditEventId"),
    replayed: typeof response.replayed === "boolean"
      ? response.replayed
      : fail("Automation replay marker must be boolean."),
  };
}

function parseCareResponse(value: unknown): CareResponse {
  const response = exactRecord(value, CARE_RESPONSE_KEYS, "Care response");
  const result = exactRecord(response.result, CARE_RESULT_KEYS, "Care response result");
  const parsed: CareResult = {
    enrollmentId: stringValue(result.enrollmentId, "Care result enrollmentId"),
    eventId: stringValue(result.eventId, "Care result eventId"),
    action: stringValue(result.action, "Care result action") as CareAction,
    state: stringValue(result.state, "Care result state"),
    revision: integerValue(result.revision, "Care result revision"),
    nextContactIndex: integerValue(
      result.nextContactIndex,
      "Care result nextContactIndex",
    ),
    nextContactAt: nullableString(result.nextContactAt, "Care result nextContactAt"),
    openEscalationId: nullableString(
      result.openEscalationId,
      "Care result openEscalationId",
    ),
    safetyHoldEscalationId: nullableString(
      result.safetyHoldEscalationId,
      "Care result safetyHoldEscalationId",
    ),
    openHandoffId: nullableString(result.openHandoffId, "Care result openHandoffId"),
    outcomeCode: stringValue(result.outcomeCode, "Care result outcomeCode"),
    synthetic: result.synthetic === true
      ? true
      : fail("Care result must remain synthetic."),
    externalDispatchCount: result.externalDispatchCount === 0
      ? 0
      : fail("Care result external dispatch count must remain zero."),
    networkCallCount: result.networkCallCount === 0
      ? 0
      : fail("Care result network call count must remain zero."),
  };
  if (
    !(
      [
        "start",
        "advance_contact",
        "human_takeover_started",
        "release_human_takeover",
        "resume",
        "raise_red_flag",
        "acknowledge_escalation",
        "resolve_escalation",
        "clear_safety_hold",
        "simulate_suppression",
        "clear_clinical_hold",
        "end",
      ] as const
    ).includes(parsed.action)
  ) {
    return fail("Care verifier received an unexpected action.");
  }
  return {
    result: parsed,
    auditEventId: stringValue(response.auditEventId, "Care auditEventId"),
    replayed: typeof response.replayed === "boolean"
      ? response.replayed
      : fail("Care replay marker must be boolean."),
  };
}

function assertAutomationActionResult(
  response: AutomationResponse,
  request: AutomationRequest,
  expected: {
    readonly state: string;
    readonly outcomeCode: string;
    readonly currentStepIndex: number;
    readonly completedStepCount: number;
    readonly openWorkItemId: string | null;
  },
): void {
  const expectedEventId = deterministicId(
    "automation-event",
    `${WORKSPACE_ID}:${AUTOMATION_RUN_ID}:${request.expectedRevision + 1}:${request.action}:${request.idempotencyKey}`,
  );
  if (
    response.replayed ||
    response.result.runId !== AUTOMATION_RUN_ID ||
    response.result.eventId !== expectedEventId ||
    response.result.action !== request.action ||
    response.result.revision !== request.expectedRevision + 1 ||
    response.result.state !== expected.state ||
    response.result.outcomeCode !== expected.outcomeCode ||
    response.result.openWorkItemId !== expected.openWorkItemId ||
    response.result.currentStepIndex !== expected.currentStepIndex ||
    response.result.completedStepCount !== expected.completedStepCount ||
    response.result.attemptCount !== 0 ||
    response.result.nextEligibleAt !== null
  ) {
    fail(`Automation ${request.action} returned a substituted result.`);
  }
}

function assertCareActionResult(
  response: CareResponse,
  request: CareRequest,
  expected: {
    readonly state: string;
    readonly outcomeCode: string;
    readonly nextContactIndex: number;
    readonly nextContactAt: string | null;
    readonly openHandoffId: string | null;
    readonly openEscalationId: string | null;
    readonly safetyHoldEscalationId: string | null;
  },
): void {
  const expectedEventId = deterministicId(
    "care-event",
    `${WORKSPACE_ID}:${CARE_ENROLLMENT_ID}:${request.expectedRevision + 1}:${request.action}:${request.idempotencyKey}`,
  );
  if (
    response.replayed ||
    response.result.enrollmentId !== CARE_ENROLLMENT_ID ||
    response.result.eventId !== expectedEventId ||
    response.result.action !== request.action ||
    response.result.revision !== request.expectedRevision + 1 ||
    response.result.state !== expected.state ||
    response.result.outcomeCode !== expected.outcomeCode ||
    response.result.openHandoffId !== expected.openHandoffId ||
    response.result.openEscalationId !== expected.openEscalationId ||
    response.result.safetyHoldEscalationId !== expected.safetyHoldEscalationId ||
    response.result.nextContactIndex !== expected.nextContactIndex ||
    response.result.nextContactAt !== expected.nextContactAt
  ) {
    fail(`Care ${request.action} returned a substituted result.`);
  }
}

function sameResponse(
  actual: AutomationResponse | CareResponse,
  first: AutomationResponse | CareResponse,
): boolean {
  return isDeepStrictEqual(actual, { ...first, replayed: true });
}

async function expectIdempotencyConflict(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (callableErrorCode(error).includes("already-exists")) return;
    throw error;
  }
  fail("Changed request reuse of a Phase 5 idempotency key was not denied.");
}

async function assertClientDenied(
  operation: () => Promise<unknown>,
  label: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (callableErrorCode(error).includes("permission-denied")) return;
    throw error;
  }
  fail(`${label} was unexpectedly available to the authenticated client.`);
}

async function getClientDocument(
  db: Firestore,
  collectionName: string,
  id: string,
): Promise<Record<string, unknown>> {
  const snapshot = await getDocFromServer(
    doc(db, "workspaces", WORKSPACE_ID, collectionName, id),
  );
  if (!snapshot.exists() || snapshot.id !== id) {
    return fail(`${collectionName}/${id} is unavailable to its approved exact-get role.`);
  }
  return snapshot.data();
}

async function assertCareConversationFixtures(db: Firestore): Promise<void> {
  const careControl = exactRecord(
    await getClientDocument(db, "conversations", CARE_CONTROL_CONVERSATION_ID),
    CONVERSATION_KEYS,
    "Phase 5 care-control conversation",
  );
  const urgentSafety = exactRecord(
    await getClientDocument(db, "conversations", URGENT_SAFETY_CONVERSATION_ID),
    CONVERSATION_KEYS,
    "Urgent safety-hold conversation",
  );
  if (
    careControl.id !== CARE_CONTROL_CONVERSATION_ID ||
    careControl.workspaceId !== WORKSPACE_ID ||
    careControl.contactId !== CARE_CONTACT_ID ||
    careControl.connectionId !== SIMULATOR_CONNECTION_ID ||
    careControl.teamId !== CARE_TEAM_ID ||
    careControl.locationId !== CARE_LOCATION_ID ||
    careControl.status !== "active" ||
    careControl.mode !== "automation" ||
    careControl.purpose !== "care_pathway" ||
    careControl.assigneeId !== null ||
    careControl.synthetic !== true ||
    urgentSafety.id !== URGENT_SAFETY_CONVERSATION_ID ||
    urgentSafety.workspaceId !== WORKSPACE_ID ||
    urgentSafety.contactId !== CARE_CONTACT_ID ||
    urgentSafety.connectionId !== SIMULATOR_CONNECTION_ID ||
    urgentSafety.teamId !== CARE_TEAM_ID ||
    urgentSafety.locationId !== CARE_LOCATION_ID ||
    urgentSafety.status !== "escalated" ||
    urgentSafety.mode !== "safety_hold" ||
    urgentSafety.purpose !== "urgent_escalation" ||
    urgentSafety.assigneeId !== null ||
    urgentSafety.synthetic !== true
  ) {
    fail("Phase 5 care-control isolation from the urgent safety fixture drifted.");
  }
}

function isoFromStored(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  return fail(`${label} must be a native Firestore timestamp or null.`);
}

function assertStoredIdempotency(input: {
  readonly value: Record<string, unknown>;
  readonly id: string;
  readonly actorUid: string;
  readonly action: string;
  readonly purpose: "automation" | "care_pathway";
  readonly requestHash: string;
  readonly aggregateId: string;
  readonly response: AutomationResponse | CareResponse;
}): void {
  const stored = exactRecord(input.value, IDEMPOTENCY_KEYS, "Phase 5 idempotency");
  const storedResult = exactRecord(
    stored.result,
    input.purpose === "automation" ? AUTOMATION_RESULT_KEYS : CARE_RESULT_KEYS,
    "Phase 5 stored idempotency result",
  );
  const normalizedResult = {
    ...storedResult,
    ...(input.purpose === "automation"
      ? { nextEligibleAt: isoFromStored(storedResult.nextEligibleAt, "stored nextEligibleAt") }
      : { nextContactAt: isoFromStored(storedResult.nextContactAt, "stored nextContactAt") }),
  };
  if (
    stored.id !== input.id ||
    stored.workspaceId !== WORKSPACE_ID ||
    stored.actorUid !== input.actorUid ||
    stored.action !== input.action ||
    stored.purpose !== input.purpose ||
    stored.requestHash !== input.requestHash ||
    stored.aggregateId !== input.aggregateId ||
    stored.eventId !== input.response.result.eventId ||
    stored.auditEventId !== input.response.auditEventId ||
    stored.synthetic !== true ||
    stored.schemaVersion !== 1 ||
    !(stored.createdAt instanceof Timestamp) ||
    !isDeepStrictEqual(normalizedResult, input.response.result)
  ) {
    fail(`Phase 5 idempotency ${input.id} failed its exact durable join.`);
  }
}

type RuntimeAuditJoinInput = {
  readonly db: Firestore;
  readonly aggregateId: string;
  readonly actorUid: string;
  readonly expectedFromState: string;
  readonly firestoreHost: string;
} & (
  | {
      readonly resourceType: "automation_run";
      readonly response: AutomationResponse;
      readonly request: AutomationRequest;
    }
  | {
      readonly resourceType: "care_enrollment";
      readonly response: CareResponse;
      readonly request: CareRequest;
    }
);

async function assertRuntimeAuditJoin(input: RuntimeAuditJoinInput): Promise<void> {
  const eventCollection = input.resourceType === "automation_run"
    ? "automationRunEvents"
    : "careEnrollmentEvents";
  const secretCollection = input.resourceType === "automation_run"
    ? "automationRunEventSecrets"
    : "careEnrollmentEventSecrets";
  const rawEvent = await getClientDocument(
    input.db,
    eventCollection,
    input.response.result.eventId,
  );
  const rawAudit = await getClientDocument(
    input.db,
    "auditEvents",
    input.response.auditEventId,
  );
  const rawSecret = await adminGetDocument(
    input.firestoreHost,
    secretCollection,
    input.response.result.eventId,
  );
  const audit = parsePhase5AuditDocument(
    rawAudit,
    input.response.auditEventId,
    WORKSPACE_ID,
  );
  const metadata = exactRecord(
    audit.metadata,
    RUNTIME_AUDIT_METADATA_KEYS,
    "Runtime Phase 5 audit metadata",
  );
  const requestId = deterministicId(
    "idempotency",
    `${WORKSPACE_ID}:${input.actorUid}:${
      input.resourceType === "automation_run"
        ? `automation.${input.request.action}`
        : `care_enrollment.${input.request.action}`
    }:${input.request.idempotencyKey}`,
  );
  const requestHash = sha256(JSON.stringify(input.request));
  const storedIdempotency = await adminGetDocument(
    input.firestoreHost,
    "idempotencyKeys",
    requestId,
  );

  if (input.resourceType === "automation_run") {
    const event = parseAutomationRunEventDocument(
      rawEvent,
      input.response.result.eventId,
      WORKSPACE_ID,
    );
    const secret = parseAutomationRunEventSecretDocument(
      rawSecret,
      input.response.result.eventId,
      WORKSPACE_ID,
    );
    assertAutomationRunEventSecretJoin(event, secret);
    assertPhase5EventAuditJoin(event, audit, "automation_run", input.aggregateId);
    const expectedContextFingerprint = syntheticHmac(JSON.stringify([
      "hemas-connect:automation-run-event-evidence:v1",
      event.workspaceId,
      event.runId,
      event.id,
      event.definitionId,
      event.definitionVersion,
      event.definitionContentHash,
      event.teamId,
      event.locationId,
      event.revision,
      event.auditEventId,
      event.action,
      event.fromState,
      event.toState,
      event.stepIndex,
      event.stepId,
      event.attemptNumber,
      event.workItemId,
      event.nextEligibleAt,
      event.reasonCode,
      event.outcomeCode,
      event.occurredAt,
      "staff",
      input.actorUid,
      1,
      true,
      0,
      0,
    ]));
    if (
      secret.protectedContextRef !==
        `demo://automation/event-context/${input.response.result.eventId}` ||
      event.id !== input.response.result.eventId ||
      event.runId !== input.aggregateId ||
      event.auditEventId !== input.response.auditEventId ||
      event.action !== input.request.action ||
      event.revision !== input.response.result.revision ||
      event.fromState !== input.expectedFromState ||
      event.toState !== input.response.result.state ||
      event.outcomeCode !== input.response.result.outcomeCode ||
      event.nextEligibleAt !== input.response.result.nextEligibleAt ||
      event.actorKind !== "staff" ||
      event.actorUid !== input.actorUid ||
      event.evidenceFingerprint !== secret.contextFingerprint ||
      secret.contextFingerprint !== expectedContextFingerprint
    ) {
      fail("Automation event secret did not preserve the mandatory HMAC binding.");
    }
    assertStoredIdempotency({
      value: storedIdempotency,
      id: requestId,
      actorUid: input.actorUid,
      action: `automation.${input.request.action}`,
      purpose: "automation",
      requestHash,
      aggregateId: input.aggregateId,
      response: input.response,
    });
  } else {
    const event = parseCareEnrollmentEventDocument(
      rawEvent,
      input.response.result.eventId,
      WORKSPACE_ID,
    );
    const secret = parseCareEnrollmentEventSecretDocument(
      rawSecret,
      input.response.result.eventId,
      WORKSPACE_ID,
    );
    assertCareEnrollmentEventSecretJoin(event, secret);
    assertPhase5EventAuditJoin(event, audit, "care_enrollment", input.aggregateId);
    const expectedContextFingerprint = syntheticHmac(JSON.stringify([
      "hemas-connect:care-enrollment-event-evidence:v1",
      event.workspaceId,
      event.enrollmentId,
      event.id,
      event.pathwayId,
      event.pathwayProtocolVersion,
      event.pathwayContentHash,
      event.teamId,
      event.locationId,
      event.revision,
      event.auditEventId,
      event.action,
      event.fromState,
      event.toState,
      event.contactPointIndex,
      event.suppressionReason,
      event.escalationId,
      event.escalationStateBefore,
      event.escalationStateAfter,
      event.handoffId,
      [...event.activeSuppressionsAfter],
      event.nextContactAt,
      event.outcomeCode,
      event.occurredAt,
      "staff",
      input.actorUid,
      1,
      true,
      0,
      0,
    ]));
    if (
      secret.protectedContextRef !==
        `demo://care/event-context/${input.response.result.eventId}` ||
      event.id !== input.response.result.eventId ||
      event.enrollmentId !== input.aggregateId ||
      event.auditEventId !== input.response.auditEventId ||
      event.action !== input.request.action ||
      event.revision !== input.response.result.revision ||
      event.fromState !== input.expectedFromState ||
      event.toState !== input.response.result.state ||
      event.outcomeCode !== input.response.result.outcomeCode ||
      event.nextContactAt !== input.response.result.nextContactAt ||
      event.suppressionReason !== input.request.suppressionReason ||
      event.actorKind !== "staff" ||
      event.actorUid !== input.actorUid ||
      secret.contextFingerprint !== expectedContextFingerprint
    ) {
      fail("Care event secret did not preserve its exact protected context HMAC binding.");
    }
    assertDigest(secret.contextFingerprint, "Care event secret contextFingerprint");
    assertStoredIdempotency({
      value: storedIdempotency,
      id: requestId,
      actorUid: input.actorUid,
      action: `care_enrollment.${input.request.action}`,
      purpose: "care_pathway",
      requestHash,
      aggregateId: input.aggregateId,
      response: input.response,
    });
  }
  const expectedFingerprint = input.resourceType === "automation_run"
    ? automationResultFingerprint(input.response.result as AutomationResult)
    : careResultFingerprint(input.response.result as CareResult);
  if (
    audit.actorUid !== input.actorUid ||
    audit.requestId !== requestId ||
    audit.resourceType !== input.resourceType ||
    audit.resourceId !== input.aggregateId ||
    metadata.eventId !== input.response.result.eventId ||
    metadata.fromState !== input.expectedFromState ||
    metadata.toState !== input.response.result.state ||
    metadata.revision !== input.response.result.revision ||
    metadata.outcomeCode !== input.response.result.outcomeCode ||
    metadata.resultFingerprint !== expectedFingerprint ||
    metadata.synthetic !== true ||
    metadata.externalDispatchCount !== 0 ||
    metadata.networkCallCount !== 0
  ) {
    fail(`Runtime ${input.resourceType} audit failed its exact result binding.`);
  }
}

async function captureAndValidateTenantAdminMembership(
  firestoreHost: string,
  actorUid: string,
): Promise<Readonly<Record<string, FirestoreRestValue>>> {
  const document = await adminGetRawDocument(firestoreHost, [
    "workspaces",
    WORKSPACE_ID,
    "members",
    actorUid,
  ]);
  if (!document.fields) return fail("Authenticated membership has no Firestore fields.");
  const membership = exactRecord(
    decodeRestFields(document.fields),
    MEMBERSHIP_KEYS,
    "Authenticated tenant-admin membership",
  );
  if (
    membership.id !== actorUid ||
    membership.uid !== actorUid ||
    membership.workspaceId !== WORKSPACE_ID ||
    membership.role !== "tenant_admin" ||
    membership.scopeMode !== "workspace_wide" ||
    membership.status !== "active" ||
    membership.mfaSatisfied !== true ||
    membership.synthetic !== true ||
    JSON.stringify(membership.teamIds) !== "[]" ||
    JSON.stringify(membership.locationIds) !== "[]" ||
    !(membership.lastAuthenticatedAt instanceof Timestamp)
  ) {
    return fail("Seeded dynamic membership is not the exact automation authority.");
  }
  return structuredClone(document.fields);
}

async function switchMembershipToClinical(
  firestoreHost: string,
  actorUid: string,
  originalFields: Readonly<Record<string, FirestoreRestValue>>,
): Promise<void> {
  const now = new Date().toISOString();
  const clinicalFields: Readonly<Record<string, FirestoreRestValue>> = {
    ...structuredClone(originalFields),
    role: { stringValue: "clinical_approver" },
    scopeMode: { stringValue: "assigned" },
    teamIds: {
      arrayValue: { values: [{ stringValue: CARE_TEAM_ID }] },
    },
    locationIds: {
      arrayValue: { values: [{ stringValue: CARE_LOCATION_ID }] },
    },
    mfaSatisfied: { booleanValue: true },
    lastAuthenticatedAt: { timestampValue: now },
    updatedAt: { timestampValue: now },
  };
  if (JSON.stringify(Object.keys(clinicalFields).sort()) !== JSON.stringify([...MEMBERSHIP_KEYS].sort())) {
    return fail("Clinical role switch would change the exact membership keyset.");
  }
  await adminPatchRawDocument(
    firestoreHost,
    ["workspaces", WORKSPACE_ID, "members", actorUid],
    clinicalFields,
  );
  const switched = exactRecord(
    decodeRestFields(
      (await adminGetRawDocument(firestoreHost, [
        "workspaces",
        WORKSPACE_ID,
        "members",
        actorUid,
      ])).fields ?? {},
    ),
    MEMBERSHIP_KEYS,
    "Switched clinical membership",
  );
  if (
    switched.id !== actorUid ||
    switched.uid !== actorUid ||
    switched.role !== "clinical_approver" ||
    switched.scopeMode !== "assigned" ||
    JSON.stringify(switched.teamIds) !== JSON.stringify([CARE_TEAM_ID]) ||
    JSON.stringify(switched.locationIds) !== JSON.stringify([CARE_LOCATION_ID]) ||
    switched.mfaSatisfied !== true ||
    !(switched.lastAuthenticatedAt instanceof Timestamp)
  ) {
    return fail("Local Admin clinical role switch did not round-trip exactly.");
  }
}

async function restoreMembership(
  firestoreHost: string,
  actorUid: string,
  originalFields: Readonly<Record<string, FirestoreRestValue>>,
): Promise<void> {
  await adminPatchRawDocument(
    firestoreHost,
    ["workspaces", WORKSPACE_ID, "members", actorUid],
    originalFields,
  );
  const restored = exactRecord(
    decodeRestFields(
      (await adminGetRawDocument(firestoreHost, [
        "workspaces",
        WORKSPACE_ID,
        "members",
        actorUid,
      ])).fields ?? {},
    ),
    MEMBERSHIP_KEYS,
    "Restored tenant-admin membership",
  );
  if (
    restored.id !== actorUid ||
    restored.uid !== actorUid ||
    restored.role !== "tenant_admin" ||
    restored.scopeMode !== "workspace_wide" ||
    JSON.stringify(restored.teamIds) !== "[]" ||
    JSON.stringify(restored.locationIds) !== "[]"
  ) {
    return fail("Local Admin membership restoration failed closed.");
  }
}

async function assertPhase5ClientSecretsDenied(
  db: Firestore,
  probeIds: Readonly<Record<(typeof PHASE5_SECRET_COLLECTIONS)[number], string>>,
  idempotencyId: string,
): Promise<void> {
  for (const collectionName of PHASE5_SECRET_COLLECTIONS) {
    await assertClientDenied(
      () => getDocFromServer(doc(db, "workspaces", WORKSPACE_ID, collectionName, probeIds[collectionName])),
      `${collectionName} exact get`,
    );
    await assertClientDenied(
      () => getDocsFromServer(collection(db, "workspaces", WORKSPACE_ID, collectionName)),
      `${collectionName} list`,
    );
  }
  await assertClientDenied(
    () => getDocFromServer(doc(db, "workspaces", WORKSPACE_ID, "idempotencyKeys", idempotencyId)),
    "Phase 5 idempotency exact get",
  );
  await assertClientDenied(
    () => getDocsFromServer(collection(db, "workspaces", WORKSPACE_ID, "idempotencyKeys")),
    "Phase 5 idempotency list",
  );
}

const BASELINE_COUNTS = Object.freeze({
  automationRuns: 1,
  automationRunEvents: 0,
  automationRunEventSecrets: 0,
  automationWorkItems: 0,
  automationWorkItemSecrets: 0,
  careEnrollments: 1,
  careEnrollmentEvents: 0,
  careEnrollmentEventSecrets: 0,
  careHandoffs: 0,
  careEscalations: 0,
  careEscalationSecrets: 0,
  auditEvents: 28,
  idempotencyKeys: 0,
});

const AUTOMATION_COUNTS = Object.freeze({
  automationRuns: 1,
  automationRunEvents: 6,
  automationRunEventSecrets: 6,
  automationWorkItems: 1,
  automationWorkItemSecrets: 1,
  careEnrollments: 1,
  careEnrollmentEvents: 0,
  careEnrollmentEventSecrets: 0,
  careHandoffs: 0,
  careEscalations: 0,
  careEscalationSecrets: 0,
  auditEvents: 34,
  idempotencyKeys: 6,
});

const FINAL_COUNTS = Object.freeze({
  automationRuns: 1,
  automationRunEvents: 6,
  automationRunEventSecrets: 6,
  automationWorkItems: 1,
  automationWorkItemSecrets: 1,
  careEnrollments: 1,
  careEnrollmentEvents: 13,
  careEnrollmentEventSecrets: 13,
  careHandoffs: 1,
  careEscalations: 1,
  careEscalationSecrets: 1,
  auditEvents: 47,
  idempotencyKeys: 19,
});

const boundary = assertExactBoundary();
const verifierApp = initializeApp(
  {
    apiKey: "demo-api-key",
    authDomain: `${PROJECT_ID}.firebaseapp.com`,
    projectId: PROJECT_ID,
    appId: "phase5-functions-emulator-verifier",
  },
  "phase5-functions-emulator-verifier",
);

let originalMembershipFields:
  | Readonly<Record<string, FirestoreRestValue>>
  | undefined;

try {
  const auth = getAuth(verifierApp);
  connectAuthEmulator(auth, `http://${boundary.authHost}`, { disableWarnings: true });
  const credential = await signInWithEmailAndPassword(
    auth,
    AUTH_EMAIL,
    AUTH_PASSWORD,
  );
  const actorUid = credential.user.uid;
  const token = await credential.user.getIdTokenResult(true);
  const authAge = Date.now() - Date.parse(token.authTime);
  if (!Number.isFinite(authAge) || authAge < 0 || authAge > 15 * 60_000) {
    fail("The seeded dynamic Auth token is not fresh enough for Phase 5 controls.");
  }

  const db = getHemasFirestore(verifierApp);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const functions = getFunctions(verifierApp, "us-central1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  const controlAutomation = httpsCallable<AutomationRequest, unknown>(
    functions,
    "demoControlSyntheticAutomationRun",
    { timeout: 30_000 },
  );
  const controlCare = httpsCallable<CareRequest, unknown>(
    functions,
    "demoControlSyntheticCareEnrollment",
    { timeout: 30_000 },
  );

  assertCounts(
    await adminCounts(boundary.firestoreHost, BASELINE_COUNTS),
    BASELINE_COUNTS,
    "Seed baseline",
  );
  originalMembershipFields = await captureAndValidateTenantAdminMembership(
    boundary.firestoreHost,
    actorUid,
  );
  await assertCareConversationFixtures(db);

  const automationRequests: readonly AutomationRequest[] = [
    {
      workspaceId: WORKSPACE_ID,
      runId: AUTOMATION_RUN_ID,
      action: "start",
      expectedRevision: 1,
      idempotencyKey: "phase5-verifier-automation-start-0001",
    },
    {
      workspaceId: WORKSPACE_ID,
      runId: AUTOMATION_RUN_ID,
      action: "advance_step",
      expectedRevision: 2,
      idempotencyKey: "phase5-verifier-automation-advance-0002",
    },
    {
      workspaceId: WORKSPACE_ID,
      runId: AUTOMATION_RUN_ID,
      action: "simulate_human_takeover",
      expectedRevision: 3,
      idempotencyKey: "phase5-verifier-automation-takeover-0003",
    },
    {
      workspaceId: WORKSPACE_ID,
      runId: AUTOMATION_RUN_ID,
      action: "release_human_takeover",
      expectedRevision: 4,
      idempotencyKey: "phase5-verifier-automation-release-0004",
    },
    {
      workspaceId: WORKSPACE_ID,
      runId: AUTOMATION_RUN_ID,
      action: "resume",
      expectedRevision: 5,
      idempotencyKey: "phase5-verifier-automation-resume-0005",
    },
    {
      workspaceId: WORKSPACE_ID,
      runId: AUTOMATION_RUN_ID,
      action: "end",
      expectedRevision: 6,
      idempotencyKey: "phase5-verifier-automation-end-0006",
    },
  ];
  const automationResponses: AutomationResponse[] = [];
  const automationStarted = parseAutomationResponse(
    (await controlAutomation(automationRequests[0]!)).data,
  );
  automationResponses.push(automationStarted);
  assertAutomationActionResult(automationStarted, automationRequests[0]!, {
    state: "running",
    outcomeCode: "accepted",
    currentStepIndex: 0,
    completedStepCount: 0,
    openWorkItemId: null,
  });
  const immediateAutomationReplay = parseAutomationResponse(
    (await controlAutomation(automationRequests[0]!)).data,
  );
  if (!sameResponse(immediateAutomationReplay, automationStarted)) {
    fail("Automation first-action immediate replay changed its durable result.");
  }
  for (const request of automationRequests.slice(1)) {
    automationResponses.push(parseAutomationResponse((await controlAutomation(request)).data));
  }
  const [
    ,
    automationAdvanced,
    automationTakeover,
    automationReleased,
    automationResumed,
    automationEnded,
  ] = automationResponses;
  if (
    !automationAdvanced ||
    !automationTakeover ||
    !automationReleased ||
    !automationResumed ||
    !automationEnded
  ) {
    fail("Automation response sequence is incomplete.");
  }
  assertAutomationActionResult(automationAdvanced, automationRequests[1]!, {
    state: "running",
    outcomeCode: "step_completed",
    currentStepIndex: 1,
    completedStepCount: 1,
    openWorkItemId: null,
  });
  const automationWorkItemId = stringValue(
    automationTakeover.result.openWorkItemId,
    "Automation takeover work-item ID",
  );
  const expectedWorkItemId = deterministicId(
    "automation-work-item",
    `${WORKSPACE_ID}:${AUTOMATION_RUN_ID}:${automationTakeover.result.eventId}`,
  );
  if (automationWorkItemId !== expectedWorkItemId) {
    fail("Automation takeover work-item ID is not deterministic.");
  }
  assertAutomationActionResult(automationTakeover, automationRequests[2]!, {
    state: "paused_for_human",
    outcomeCode: "human_takeover_required",
    currentStepIndex: 1,
    completedStepCount: 1,
    openWorkItemId: automationWorkItemId,
  });
  assertAutomationActionResult(automationReleased, automationRequests[3]!, {
    state: "paused_by_operator",
    outcomeCode: "accepted",
    currentStepIndex: 1,
    completedStepCount: 1,
    openWorkItemId: null,
  });
  assertAutomationActionResult(automationResumed, automationRequests[4]!, {
    state: "running",
    outcomeCode: "accepted",
    currentStepIndex: 1,
    completedStepCount: 1,
    openWorkItemId: null,
  });
  assertAutomationActionResult(automationEnded, automationRequests[5]!, {
    state: "ended",
    outcomeCode: "ended_by_operator",
    currentStepIndex: 1,
    completedStepCount: 1,
    openWorkItemId: null,
  });
  const terminalAutomationStartReplay = parseAutomationResponse(
    (await controlAutomation(automationRequests[0]!)).data,
  );
  const terminalAutomationTakeoverReplay = parseAutomationResponse(
    (await controlAutomation(automationRequests[2]!)).data,
  );
  if (
    !sameResponse(terminalAutomationStartReplay, automationStarted) ||
    !sameResponse(terminalAutomationTakeoverReplay, automationTakeover)
  ) {
    fail("Automation historical replay changed its immutable result.");
  }
  await expectIdempotencyConflict(() =>
    controlAutomation({ ...automationRequests[2]!, expectedRevision: 4 }),
  );
  const automationReplayAfterConflict = parseAutomationResponse(
    (await controlAutomation(automationRequests[2]!)).data,
  );
  if (!sameResponse(automationReplayAfterConflict, automationTakeover)) {
    fail("Automation conflict path overwrote its prior idempotent result.");
  }
  assertCounts(
    await adminCounts(boundary.firestoreHost, AUTOMATION_COUNTS),
    AUTOMATION_COUNTS,
    "Automation replay/conflict",
  );

  await switchMembershipToClinical(
    boundary.firestoreHost,
    actorUid,
    originalMembershipFields,
  );
  const careResponses: CareResponse[] = [];
  const careRequests: readonly CareRequest[] = [
    {
      workspaceId: WORKSPACE_ID,
      enrollmentId: CARE_ENROLLMENT_ID,
      action: "start",
      expectedRevision: 1,
      suppressionReason: null,
      idempotencyKey: "phase5-verifier-care-start-0001",
    },
    {
      workspaceId: WORKSPACE_ID,
      enrollmentId: CARE_ENROLLMENT_ID,
      action: "advance_contact",
      expectedRevision: 2,
      suppressionReason: null,
      idempotencyKey: "phase5-verifier-care-advance-0002",
    },
    {
      workspaceId: WORKSPACE_ID,
      enrollmentId: CARE_ENROLLMENT_ID,
      action: "human_takeover_started",
      expectedRevision: 3,
      suppressionReason: null,
      idempotencyKey: "phase5-verifier-care-handoff-open-0003",
    },
    {
      workspaceId: WORKSPACE_ID,
      enrollmentId: CARE_ENROLLMENT_ID,
      action: "release_human_takeover",
      expectedRevision: 4,
      suppressionReason: null,
      idempotencyKey: "phase5-verifier-care-handoff-release-0004",
    },
    {
      workspaceId: WORKSPACE_ID,
      enrollmentId: CARE_ENROLLMENT_ID,
      action: "resume",
      expectedRevision: 5,
      suppressionReason: null,
      idempotencyKey: "phase5-verifier-care-resume-0005",
    },
    {
      workspaceId: WORKSPACE_ID,
      enrollmentId: CARE_ENROLLMENT_ID,
      action: "raise_red_flag",
      expectedRevision: 6,
      suppressionReason: null,
      idempotencyKey: "phase5-verifier-care-red-flag-0006",
    },
    {
      workspaceId: WORKSPACE_ID,
      enrollmentId: CARE_ENROLLMENT_ID,
      action: "acknowledge_escalation",
      expectedRevision: 7,
      suppressionReason: null,
      idempotencyKey: "phase5-verifier-care-escalation-ack-0007",
    },
    {
      workspaceId: WORKSPACE_ID,
      enrollmentId: CARE_ENROLLMENT_ID,
      action: "resolve_escalation",
      expectedRevision: 8,
      suppressionReason: null,
      idempotencyKey: "phase5-verifier-care-escalation-resolve-0008",
    },
    {
      workspaceId: WORKSPACE_ID,
      enrollmentId: CARE_ENROLLMENT_ID,
      action: "clear_safety_hold",
      expectedRevision: 9,
      suppressionReason: null,
      idempotencyKey: "phase5-verifier-care-safety-clear-0009",
    },
    {
      workspaceId: WORKSPACE_ID,
      enrollmentId: CARE_ENROLLMENT_ID,
      action: "resume",
      expectedRevision: 10,
      suppressionReason: null,
      idempotencyKey: "phase5-verifier-care-resume-0010",
    },
    {
      workspaceId: WORKSPACE_ID,
      enrollmentId: CARE_ENROLLMENT_ID,
      action: "simulate_suppression",
      expectedRevision: 11,
      suppressionReason: "clinical_hold",
      idempotencyKey: "phase5-verifier-care-clinical-hold-0011",
    },
    {
      workspaceId: WORKSPACE_ID,
      enrollmentId: CARE_ENROLLMENT_ID,
      action: "clear_clinical_hold",
      expectedRevision: 12,
      suppressionReason: null,
      idempotencyKey: "phase5-verifier-care-clinical-clear-0012",
    },
    {
      workspaceId: WORKSPACE_ID,
      enrollmentId: CARE_ENROLLMENT_ID,
      action: "end",
      expectedRevision: 13,
      suppressionReason: null,
      idempotencyKey: "phase5-verifier-care-end-0013",
    },
  ];
  try {
    const careStarted = parseCareResponse((await controlCare(careRequests[0]!)).data);
    careResponses.push(careStarted);
    const immediateCareReplay = parseCareResponse(
      (await controlCare(careRequests[0]!)).data,
    );
    if (!sameResponse(immediateCareReplay, careStarted)) {
      fail("Care first-action immediate replay changed its durable result.");
    }
    for (const request of careRequests.slice(1)) {
      careResponses.push(parseCareResponse((await controlCare(request)).data));
    }
    const [
      ,
      careAdvanced,
      careTakeover,
      careReleased,
      careResumed,
      careRedFlag,
      careAcknowledged,
      careResolved,
      careSafetyCleared,
      careResumedAfterSafety,
      careClinicalHold,
      careClinicalCleared,
      careEnded,
    ] = careResponses;
    if (
      !careAdvanced ||
      !careTakeover ||
      !careReleased ||
      !careResumed ||
      !careRedFlag ||
      !careAcknowledged ||
      !careResolved ||
      !careSafetyCleared ||
      !careResumedAfterSafety ||
      !careClinicalHold ||
      !careClinicalCleared ||
      !careEnded
    ) {
      fail("Care response sequence is incomplete.");
    }
    const handoffId = stringValue(careTakeover.result.openHandoffId, "Care handoff ID");
    const escalationId = stringValue(
      careRedFlag.result.openEscalationId,
      "Care escalation ID",
    );
    assertCareActionResult(careStarted, careRequests[0]!, {
      state: "active",
      outcomeCode: "accepted",
      nextContactIndex: 0,
      nextContactAt: "2026-08-07T00:00:00.000Z",
      openHandoffId: null,
      openEscalationId: null,
      safetyHoldEscalationId: null,
    });
    assertCareActionResult(careAdvanced, careRequests[1]!, {
      state: "active",
      outcomeCode: "contact_advanced",
      nextContactIndex: 1,
      nextContactAt: "2026-08-09T00:00:00.000Z",
      openHandoffId: null,
      openEscalationId: null,
      safetyHoldEscalationId: null,
    });
    assertCareActionResult(careTakeover, careRequests[2]!, {
      state: "paused_for_human",
      outcomeCode: "human_takeover_required",
      nextContactIndex: 1,
      nextContactAt: "2026-08-09T00:00:00.000Z",
      openHandoffId: handoffId,
      openEscalationId: null,
      safetyHoldEscalationId: null,
    });
    assertCareActionResult(careReleased, careRequests[3]!, {
      state: "paused_by_operator",
      outcomeCode: "accepted",
      nextContactIndex: 1,
      nextContactAt: "2026-08-09T00:00:00.000Z",
      openHandoffId: null,
      openEscalationId: null,
      safetyHoldEscalationId: null,
    });
    assertCareActionResult(careResumed, careRequests[4]!, {
      state: "active",
      outcomeCode: "accepted",
      nextContactIndex: 1,
      nextContactAt: "2026-08-09T00:00:00.000Z",
      openHandoffId: null,
      openEscalationId: null,
      safetyHoldEscalationId: null,
    });
    assertCareActionResult(careRedFlag, careRequests[5]!, {
      state: "escalated", outcomeCode: "red_flag_escalated",
      nextContactIndex: 1, nextContactAt: "2026-08-09T00:00:00.000Z",
      openHandoffId: null, openEscalationId: escalationId,
      safetyHoldEscalationId: null,
    });
    assertCareActionResult(careAcknowledged, careRequests[6]!, {
      state: "escalated", outcomeCode: "escalation_acknowledged",
      nextContactIndex: 1, nextContactAt: "2026-08-09T00:00:00.000Z",
      openHandoffId: null, openEscalationId: escalationId,
      safetyHoldEscalationId: null,
    });
    assertCareActionResult(careResolved, careRequests[7]!, {
      state: "paused_for_safety", outcomeCode: "escalation_resolved_safety_hold",
      nextContactIndex: 1, nextContactAt: "2026-08-09T00:00:00.000Z",
      openHandoffId: null, openEscalationId: null,
      safetyHoldEscalationId: escalationId,
    });
    assertCareActionResult(careSafetyCleared, careRequests[8]!, {
      state: "paused_by_operator", outcomeCode: "safety_hold_cleared",
      nextContactIndex: 1, nextContactAt: "2026-08-09T00:00:00.000Z",
      openHandoffId: null, openEscalationId: null,
      safetyHoldEscalationId: null,
    });
    assertCareActionResult(careResumedAfterSafety, careRequests[9]!, {
      state: "active", outcomeCode: "accepted",
      nextContactIndex: 1, nextContactAt: "2026-08-09T00:00:00.000Z",
      openHandoffId: null, openEscalationId: null,
      safetyHoldEscalationId: null,
    });
    assertCareActionResult(careClinicalHold, careRequests[10]!, {
      state: "paused_for_safety", outcomeCode: "clinical_hold_applied",
      nextContactIndex: 1, nextContactAt: "2026-08-09T00:00:00.000Z",
      openHandoffId: null, openEscalationId: null,
      safetyHoldEscalationId: null,
    });
    assertCareActionResult(careClinicalCleared, careRequests[11]!, {
      state: "paused_by_operator", outcomeCode: "safety_hold_cleared",
      nextContactIndex: 1, nextContactAt: "2026-08-09T00:00:00.000Z",
      openHandoffId: null, openEscalationId: null,
      safetyHoldEscalationId: null,
    });
    assertCareActionResult(careEnded, careRequests[12]!, {
      state: "ended", outcomeCode: "ended_by_operator",
      nextContactIndex: 1, nextContactAt: null,
      openHandoffId: null, openEscalationId: null,
      safetyHoldEscalationId: null,
    });
    const terminalCareStartReplay = parseCareResponse(
      (await controlCare(careRequests[0]!)).data,
    );
    const terminalCareEscalationReplay = parseCareResponse(
      (await controlCare(careRequests[5]!)).data,
    );
    if (
      !sameResponse(terminalCareStartReplay, careStarted) ||
      !sameResponse(terminalCareEscalationReplay, careRedFlag)
    ) {
      fail("Care historical replay changed its immutable result.");
    }
    await expectIdempotencyConflict(() =>
      controlCare({ ...careRequests[5]!, expectedRevision: 7 }),
    );
    const careReplayAfterConflict = parseCareResponse(
      (await controlCare(careRequests[5]!)).data,
    );
    if (!sameResponse(careReplayAfterConflict, careRedFlag)) {
      fail("Care conflict path overwrote its prior idempotent result.");
    }
    assertCounts(
      await adminCounts(boundary.firestoreHost, FINAL_COUNTS),
      FINAL_COUNTS,
      "Care replay/conflict",
    );
  } finally {
    await restoreMembership(
      boundary.firestoreHost,
      actorUid,
      originalMembershipFields,
    );
    originalMembershipFields = undefined;
  }

  const [
    careStarted,
    ,
    careTakeover,
    careReleased,
    ,
    careRedFlag,
    ,
    ,
    careSafetyCleared,
    ,
    ,
    ,
    careEnded,
  ] = careResponses;
  if (
    !careStarted ||
    !careTakeover ||
    !careReleased ||
    !careRedFlag ||
    !careSafetyCleared ||
    !careEnded
  ) {
    fail("Care response evidence is unavailable after membership restoration.");
  }

  for (const [index, response] of automationResponses.entries()) {
    await assertRuntimeAuditJoin({
      db,
      response,
      resourceType: "automation_run",
      aggregateId: AUTOMATION_RUN_ID,
      actorUid,
      expectedFromState: [
        "queued",
        "running",
        "running",
        "paused_for_human",
        "paused_by_operator",
        "running",
      ][index]!,
      request: automationRequests[index]!,
      firestoreHost: boundary.firestoreHost,
    });
  }
  for (const [index, response] of careResponses.entries()) {
    await assertRuntimeAuditJoin({
      db,
      response,
      resourceType: "care_enrollment",
      aggregateId: CARE_ENROLLMENT_ID,
      actorUid,
      expectedFromState: [
        "queued",
        "active",
        "active",
        "paused_for_human",
        "paused_by_operator",
        "active",
        "escalated",
        "escalated",
        "paused_for_safety",
        "paused_by_operator",
        "active",
        "paused_for_safety",
        "paused_by_operator",
      ][index]!,
      request: careRequests[index]!,
      firestoreHost: boundary.firestoreHost,
    });
  }

  const run = parseAutomationRunDocument(
    await getClientDocument(db, "automationRuns", AUTOMATION_RUN_ID),
    AUTOMATION_RUN_ID,
    WORKSPACE_ID,
  );
  const enrollment = parseCareEnrollmentDocument(
    await getClientDocument(db, "careEnrollments", CARE_ENROLLMENT_ID),
    CARE_ENROLLMENT_ID,
    WORKSPACE_ID,
  );
  if (
    run.state !== "ended" ||
    run.revision !== 7 ||
    run.lastEventId !== automationEnded.result.eventId ||
    run.teamId !== AUTOMATION_TEAM_ID ||
    run.locationId !== AUTOMATION_LOCATION_ID ||
    run.currentStepIndex !== 1 ||
    run.completedStepCount !== 1 ||
    run.attemptCount !== 0 ||
    run.openWorkItemId !== null ||
    run.externalDispatchCount !== 0 ||
    run.networkCallCount !== 0 ||
    enrollment.state !== "ended" ||
    enrollment.revision !== 14 ||
    enrollment.lastEventId !== careEnded.result.eventId ||
    enrollment.teamId !== CARE_TEAM_ID ||
    enrollment.locationId !== CARE_LOCATION_ID ||
    enrollment.nextContactIndex !== 1 ||
    enrollment.nextContactAt !== null ||
    enrollment.activeSuppressions.length !== 0 ||
    enrollment.openHandoffId !== null ||
    enrollment.openEscalationId !== null ||
    enrollment.safetyHoldEscalationId !== null ||
    enrollment.externalDispatchCount !== 0 ||
    enrollment.networkCallCount !== 0
  ) {
    fail("Final Phase 5 aggregates do not bind their latest immutable events.");
  }

  const workItem = parseAutomationWorkItemDocument(
    await getClientDocument(db, "automationWorkItems", automationWorkItemId),
    automationWorkItemId,
    WORKSPACE_ID,
  );
  const workItemSecret = parseAutomationWorkItemSecretDocument(
    await adminGetDocument(
      boundary.firestoreHost,
      "automationWorkItemSecrets",
      automationWorkItemId,
    ),
    automationWorkItemId,
    WORKSPACE_ID,
  );
  assertAutomationWorkItemSecretJoin(workItem, workItemSecret);
  if (
    workItem.state !== "resolved" ||
    workItem.revision !== 2 ||
    workItem.lastEventId !== automationReleased.result.eventId ||
    workItem.reasonCode !== "human_takeover" ||
    workItem.resolutionCode !== "routed_to_human" ||
    workItem.resolvedByUid !== actorUid ||
    workItemSecret.protectedContextRef !==
      `demo://automation/work-item-context/${automationWorkItemId}` ||
    workItemSecret.contextFingerprint !==
      sha256(JSON.stringify([
        WORKSPACE_ID,
        AUTOMATION_RUN_ID,
        automationWorkItemId,
        "human_takeover",
      ])) ||
    workItem.externalDispatchCount !== 0 ||
    workItem.networkCallCount !== 0
  ) {
    fail("Automation work-item lifecycle or secret evidence failed its exact join.");
  }

  const handoffId = stringValue(careTakeover.result.openHandoffId, "Care handoff ID");
  const expectedHandoffId = deterministicId(
    "care-handoff",
    `${WORKSPACE_ID}:${CARE_ENROLLMENT_ID}:${careTakeover.result.eventId}`,
  );
  const handoff = parseCareHandoffDocument(
    await getClientDocument(db, "careHandoffs", handoffId),
    handoffId,
    WORKSPACE_ID,
  );
  if (
    handoffId !== expectedHandoffId ||
    handoff.state !== "released" ||
    handoff.revision !== 2 ||
    handoff.openedEventId !== careTakeover.result.eventId ||
    handoff.releasedEventId !== careReleased.result.eventId ||
    handoff.lastEventId !== careReleased.result.eventId ||
    handoff.openedBy.actorUid !== actorUid ||
    handoff.releasedBy?.actorUid !== actorUid ||
    handoff.externalDispatchCount !== 0 ||
    handoff.networkCallCount !== 0
  ) {
    fail("Care handoff lifecycle evidence failed its exact aggregate/event join.");
  }

  const escalationId = stringValue(
    careRedFlag.result.openEscalationId,
    "Care escalation ID",
  );
  const expectedEscalationId = deterministicId(
    "care-escalation",
    `${WORKSPACE_ID}:${CARE_ENROLLMENT_ID}:${careRedFlag.result.eventId}`,
  );
  const escalation = parseCareEscalationDocument(
    await getClientDocument(db, "careEscalations", escalationId),
    escalationId,
    WORKSPACE_ID,
  );
  const escalationSecret = parseCareEscalationSecretDocument(
    await adminGetDocument(
      boundary.firestoreHost,
      "careEscalationSecrets",
      escalationId,
    ),
    escalationId,
    WORKSPACE_ID,
  );
  assertCareEscalationSecretJoin(escalation, escalationSecret);
  if (
    escalationId !== expectedEscalationId ||
    escalation.state !== "resolved" ||
    escalation.reasonCode !== "red_flag_response" ||
    escalation.revision !== 4 ||
    escalation.lastEventId !== careSafetyCleared.result.eventId ||
    escalation.openedBy.actorUid !== actorUid ||
    escalation.acknowledgedByUid !== actorUid ||
    escalation.resolvedByUid !== actorUid ||
    escalation.resolutionCode !== "safety_hold_applied" ||
    escalation.writeBackRequired !== true ||
    escalation.writeBackState !== "unavailable_in_demo" ||
    escalationSecret.protectedContextRef !==
      `demo://care/escalation-context/${escalationId}` ||
    escalationSecret.contextFingerprint !==
      sha256(JSON.stringify([
        WORKSPACE_ID,
        CARE_ENROLLMENT_ID,
        escalationId,
        "red_flag_response",
      ])) ||
    escalation.externalDispatchCount !== 0 ||
    escalation.networkCallCount !== 0
  ) {
    fail("Care escalation lifecycle or secret evidence failed its exact join.");
  }

  const firstAutomationIdempotencyId = deterministicId(
    "idempotency",
    `${WORKSPACE_ID}:${actorUid}:automation.start:${automationRequests[0]!.idempotencyKey}`,
  );
  const automationReceiptId =
    "abd1a1879f8b46e1e59d37fce4bb5e54f57e01988b8c3d08b3b3dd1ad0a1c967";
  const careReceiptId =
    "3081845ad6d37d7240d1ab250a531576deaf67d7aee3bb44832680df52169311";
  await assertPhase5ClientSecretsDenied(
    db,
    {
      automationDefinitionSecrets: "automation_synthetic_appointment_v3",
      automationTriggerReceipts: automationReceiptId,
      automationRunSecrets: AUTOMATION_RUN_ID,
      automationRunEventSecrets: automationStarted.result.eventId,
      automationWorkItemSecrets: automationWorkItemId,
      carePathwaySecrets: "care_pathway_synthetic_followup_v1",
      careEnrollmentReceipts: careReceiptId,
      careEnrollmentSecrets: CARE_ENROLLMENT_ID,
      careEnrollmentEventSecrets: careStarted.result.eventId,
      careEscalationSecrets: escalationId,
    },
    firstAutomationIdempotencyId,
  );

  assertCounts(
    await adminCounts(boundary.firestoreHost, FINAL_COUNTS),
    FINAL_COUNTS,
    "Final Phase 5 durable",
  );

  process.stdout.write(
    `Verified Phase 5 Functions for ${actorUid}: 6 automation and 13 care actions with historical replay/conflict protection, one resolved takeover work item, one released handoff, one resolved safety escalation, restored tenant-admin authority, 19 exact event+secret+audit+idempotency joins, 47 total audits, zero external/network calls, and every client secret/idempotency read denied.\n`,
  );
} finally {
  if (originalMembershipFields !== undefined) {
    await restoreMembership(
      boundary.firestoreHost,
      (await getAuth(verifierApp).currentUser)?.uid ?? fail("Cannot restore membership without the dynamic UID."),
      originalMembershipFields,
    );
  }
  await deleteApp(verifierApp);
}
