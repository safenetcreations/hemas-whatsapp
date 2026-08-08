export {};

import { isDeepStrictEqual } from "node:util";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDocsFromServer,
  getFirestore,
  Timestamp,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
  type HttpsCallable,
} from "firebase/functions";
import {
  parseClientSafeAuditEventProjection,
  parseFirestoreAuditRecordV1,
  projectClientSafeAuditEvent,
  type ClientSafeAuditEventDTO,
  type FirestoreAuditRecordV1DTO,
} from "../lib/firebase/repositories";

const PROJECT_ID = "demo-hemas-connect";
const WORKSPACE_ID = "workspace_safenet_demo";
const LOCKED_WORKSPACE_ID = "workspace_hemas_locked";
const AUTH_EMAIL = "demo.admin@synthetic.invalid";
const AUTH_PASSWORD =
  process.env.DEMO_ADMIN_PASSWORD ?? "Synthetic-Demo-Only-2026!";
const EXPECTED_SEED_AUDIT_COUNT = 28;
const PAGE_SIZE = 10;

const EXPECTED_EMULATOR_HOSTS = Object.freeze({
  functions: "127.0.0.1:5001",
  auth: "127.0.0.1:9099",
  firestore: "127.0.0.1:8080",
});

const MEMBERSHIP_KEYS = Object.freeze([
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
] as const);

const WRONG_ROLES = Object.freeze([
  "platform_owner",
  "supervisor",
  "agent",
  "campaign_operator",
  "campaign_approver",
  "analyst",
  "clinical_approver",
] as const);

const PROTECTED_PROJECTION_KEYS = new Set([
  "actorUid",
  "resourceId",
  "requestId",
  "metadata",
  "createdAt",
]);

type AuditOutcome = "allowed" | "denied" | "failed" | "simulated";
type AuditCursor = {
  readonly createdAt: string;
  readonly id: string;
};
type ListAuditRequest = {
  readonly workspaceId: string;
  readonly outcome: AuditOutcome | null;
  readonly pageSize: number;
  readonly cursor: AuditCursor | null;
};
type ParsedAuditPage = {
  readonly events: readonly ClientSafeAuditEventDTO[];
  readonly nextCursor: AuditCursor | null;
};
type EmulatorBoundary = {
  readonly functionsHost: string;
  readonly authHost: string;
  readonly firestoreHost: string;
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
type MembershipVariant = {
  readonly role: string;
  readonly scopeMode: "assigned" | "workspace_wide";
  readonly status?: "active" | "revoked";
  readonly workspaceId?: string;
  readonly teamIds?: readonly string[];
  readonly locationIds?: readonly string[];
};
type RawAuditSnapshot = {
  readonly records: ReadonlyMap<string, FirestoreAuditRecordV1DTO>;
  readonly fields: ReadonlyMap<
    string,
    Readonly<Record<string, FirestoreRestValue>>
  >;
};

function fail(message: string): never {
  throw new Error(message);
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
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

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return fail(`${label} must be a string array.`);
  }
  return value as readonly string[];
}

function canonicalIso(value: unknown, label: string): string {
  const iso = stringValue(value, label);
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== iso) {
    return fail(`${label} must be a canonical ISO timestamp.`);
  }
  return iso;
}

function assertExactBoundary(): EmulatorBoundary {
  const projectId = process.env.GCLOUD_PROJECT;
  const googleCloudProject = process.env.GOOGLE_CLOUD_PROJECT;
  const functionsHost = process.env.FUNCTIONS_EMULATOR_HOST;
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (
    projectId !== PROJECT_ID ||
    (googleCloudProject !== undefined && googleCloudProject !== PROJECT_ID)
  ) {
    return fail(
      "Refusing Compliance verification outside the exact synthetic demo project.",
    );
  }
  if (
    functionsHost !== EXPECTED_EMULATOR_HOSTS.functions ||
    authHost !== EXPECTED_EMULATOR_HOSTS.auth ||
    firestoreHost !== EXPECTED_EMULATOR_HOSTS.firestore
  ) {
    return fail(
      "Compliance verification requires exact 127.0.0.1 Functions/Auth/Firestore emulator ports.",
    );
  }
  return { functionsHost, authHost, firestoreHost };
}

function callableErrorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
}

async function expectCallableError(
  callable: HttpsCallable<unknown, unknown>,
  request: unknown,
  expectedCode: "invalid-argument" | "permission-denied" | "unauthenticated",
  label: string,
): Promise<void> {
  try {
    await callable(request);
  } catch (error) {
    if (callableErrorCode(error).includes(expectedCode)) return;
    throw error;
  }
  fail(`${label} was unexpectedly accepted by the Compliance callable.`);
}

async function expectClientPermissionDenied(
  operation: () => Promise<unknown>,
  label: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (callableErrorCode(error).includes("permission-denied")) return;
    throw error;
  }
  fail(`${label} was unexpectedly available to the authenticated Web SDK.`);
}

function firestoreRestRoot(firestoreHost: string): URL {
  return new URL(
    `/v1/projects/${PROJECT_ID}/databases/(default)/documents/`,
    `http://${firestoreHost}`,
  );
}

function firestoreRestUrl(
  firestoreHost: string,
  segments: readonly string[],
): URL {
  const url = firestoreRestRoot(firestoreHost);
  url.pathname += segments.map(encodeURIComponent).join("/");
  return url;
}

async function adminFetch(url: URL, init: RequestInit = {}): Promise<Response> {
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
      `Loopback Admin read ${segments.join("/")} failed with HTTP ${response.status}.`,
    );
  }
  return (await response.json()) as FirestoreRestDocument;
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
      `Loopback Admin patch ${segments.join("/")} failed with HTTP ${response.status}.`,
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
        `Loopback Admin list ${segments.join("/")} failed with HTTP ${response.status}.`,
      );
    }
    const body = (await response.json()) as {
      readonly documents?: readonly FirestoreRestDocument[];
      readonly nextPageToken?: string;
    };
    documents.push(...(body.documents ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return documents;
}

async function adminListCollectionIds(
  firestoreHost: string,
  parentSegments: readonly string[],
): Promise<readonly string[]> {
  const collectionIds: string[] = [];
  let pageToken: string | undefined;
  do {
    const url = firestoreRestUrl(firestoreHost, parentSegments);
    url.pathname = `${url.pathname.replace(/\/$/, "")}:listCollectionIds`;
    const response = await adminFetch(url, {
      method: "POST",
      body: JSON.stringify({ pageSize: 100, ...(pageToken ? { pageToken } : {}) }),
    });
    if (!response.ok) {
      return fail(
        `Loopback Admin collection discovery failed with HTTP ${response.status}.`,
      );
    }
    const body = (await response.json()) as {
      readonly collectionIds?: readonly string[];
      readonly nextPageToken?: string;
    };
    collectionIds.push(...(body.collectionIds ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  if (new Set(collectionIds).size !== collectionIds.length) {
    return fail("Loopback Admin collection discovery returned duplicates.");
  }
  return collectionIds.sort();
}

function decodeRestValue(value: FirestoreRestValue): unknown {
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) {
    const timestamp = stringValue(value.timestampValue, "REST timestamp");
    return Timestamp.fromDate(new Date(timestamp));
  }
  if ("stringValue" in value) return value.stringValue;
  if ("arrayValue" in value) {
    return (value.arrayValue?.values ?? []).map(decodeRestValue);
  }
  if ("mapValue" in value) {
    return decodeRestFields(value.mapValue?.fields ?? {});
  }
  return fail("Unsupported Firestore REST value in the Compliance verifier.");
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
  return stringValue(name.split("/").at(-1), "Firestore REST document ID");
}

async function captureDatastoreCounts(
  firestoreHost: string,
): Promise<Readonly<Record<string, number>>> {
  const rootCollections = await adminListCollectionIds(firestoreHost, []);
  const workspaceCollections = await adminListCollectionIds(firestoreHost, [
    "workspaces",
    WORKSPACE_ID,
  ]);
  const rootEntries = await Promise.all(
    rootCollections.map(async (collectionId) => [
      `root:${collectionId}`,
      (await adminListRawDocuments(firestoreHost, [collectionId])).length,
    ] as const),
  );
  const workspaceEntries = await Promise.all(
    workspaceCollections.map(async (collectionId) => [
      `workspace:${collectionId}`,
      (
        await adminListRawDocuments(firestoreHost, [
          "workspaces",
          WORKSPACE_ID,
          collectionId,
        ])
      ).length,
    ] as const),
  );
  return Object.fromEntries([...rootEntries, ...workspaceEntries]);
}

function assertSameCounts(
  actual: Readonly<Record<string, number>>,
  expected: Readonly<Record<string, number>>,
): void {
  if (!isDeepStrictEqual(actual, expected)) {
    fail("Compliance verification changed the emulator datastore counts.");
  }
}

async function captureRawSeedAudits(
  firestoreHost: string,
): Promise<RawAuditSnapshot> {
  const documents = await adminListRawDocuments(firestoreHost, [
    "workspaces",
    WORKSPACE_ID,
    "auditEvents",
  ]);
  if (documents.length !== EXPECTED_SEED_AUDIT_COUNT) {
    return fail(
      `Fresh Compliance seed requires exactly ${EXPECTED_SEED_AUDIT_COUNT} audits.`,
    );
  }
  const records = new Map<string, FirestoreAuditRecordV1DTO>();
  const fields = new Map<
    string,
    Readonly<Record<string, FirestoreRestValue>>
  >();
  for (const document of documents) {
    const id = documentId(document);
    if (!document.fields) return fail(`Seed audit ${id} has no fields.`);
    const record = parseFirestoreAuditRecordV1(
      decodeRestFields(document.fields),
      id,
      WORKSPACE_ID,
    );
    if (record.outcome !== "allowed") {
      return fail("Fresh Compliance seed must contain only allowed lifecycle audits.");
    }
    if (records.has(id)) return fail("Fresh Compliance seed contains duplicate audit IDs.");
    records.set(id, record);
    fields.set(id, structuredClone(document.fields));
  }
  return { records, fields };
}

async function assertRawSeedAuditsUnchanged(
  firestoreHost: string,
  baseline: RawAuditSnapshot,
): Promise<void> {
  const documents = await adminListRawDocuments(firestoreHost, [
    "workspaces",
    WORKSPACE_ID,
    "auditEvents",
  ]);
  if (documents.length !== baseline.fields.size) {
    return fail("Compliance verification changed the raw audit document count.");
  }
  const seen = new Set<string>();
  for (const document of documents) {
    const id = documentId(document);
    if (seen.has(id) || !document.fields) {
      return fail("Compliance verification returned an invalid raw audit snapshot.");
    }
    seen.add(id);
    const expectedFields = baseline.fields.get(id);
    const expectedRecord = baseline.records.get(id);
    if (
      !expectedFields ||
      !expectedRecord ||
      !isDeepStrictEqual(document.fields, expectedFields)
    ) {
      return fail("Compliance verification changed a raw audit document in place.");
    }
    const currentRecord = parseFirestoreAuditRecordV1(
      decodeRestFields(document.fields),
      id,
      WORKSPACE_ID,
    );
    if (!isDeepStrictEqual(currentRecord, expectedRecord)) {
      return fail("Compliance verification substituted parsed raw audit evidence.");
    }
  }
  if (seen.size !== baseline.fields.size) {
    return fail("Compliance verification substituted the raw audit identity set.");
  }
}

function compareProjectedEvents(
  left: ClientSafeAuditEventDTO,
  right: ClientSafeAuditEventDTO,
): number {
  const leftTime = Date.parse(left.occurredAt);
  const rightTime = Date.parse(right.occurredAt);
  if (leftTime !== rightTime) return rightTime - leftTime;
  if (left.id === right.id) return 0;
  return left.id > right.id ? -1 : 1;
}

function parseAuditPage(
  value: unknown,
  request: ListAuditRequest,
): ParsedAuditPage {
  const response = exactRecord(
    value,
    ["events", "nextCursor"],
    "Compliance callable response",
  );
  if (!Array.isArray(response.events) || response.events.length > request.pageSize) {
    return fail("Compliance callable response exceeded its requested page bound.");
  }
  const events = response.events.map((event) => {
    const parsed = parseClientSafeAuditEventProjection(event);
    if (
      parsed.workspaceId !== request.workspaceId ||
      (request.outcome !== null && parsed.outcome !== request.outcome)
    ) {
      return fail("Compliance projection escaped its tenant or outcome filter.");
    }
    return parsed;
  });
  if (new Set(events.map((event) => event.id)).size !== events.length) {
    return fail("Compliance callable returned duplicate events within a page.");
  }
  for (let index = 1; index < events.length; index += 1) {
    if (compareProjectedEvents(events[index - 1]!, events[index]!) >= 0) {
      return fail("Compliance callable page order is not strictly descending.");
    }
  }
  let nextCursor: AuditCursor | null = null;
  if (response.nextCursor !== null) {
    const cursor = exactRecord(
      response.nextCursor,
      ["createdAt", "id"],
      "Compliance callable cursor",
    );
    nextCursor = {
      createdAt: canonicalIso(cursor.createdAt, "Compliance cursor timestamp"),
      id: stringValue(cursor.id, "Compliance cursor ID"),
    };
    const last = events.at(-1);
    if (
      !last ||
      last.id !== nextCursor.id ||
      last.occurredAt !== nextCursor.createdAt
    ) {
      return fail("Compliance cursor is not bound to the last projected event.");
    }
  }
  if (
    (events.length === request.pageSize && nextCursor === null) ||
    (events.length < request.pageSize && nextCursor !== null)
  ) {
    return fail("Compliance cursor presence does not match page fullness.");
  }
  return { events, nextCursor };
}

async function callAuditPage(
  callable: HttpsCallable<unknown, unknown>,
  request: ListAuditRequest,
): Promise<ParsedAuditPage> {
  const response = await callable(request);
  return parseAuditPage(response.data, request);
}

async function loadAllAuditEvents(input: {
  readonly callable: HttpsCallable<unknown, unknown>;
  readonly outcome: AuditOutcome | null;
  readonly expectedPageSizes: readonly number[];
}): Promise<readonly ClientSafeAuditEventDTO[]> {
  const events: ClientSafeAuditEventDTO[] = [];
  const cursors = new Set<string>();
  const actualPageSizes: number[] = [];
  let cursor: AuditCursor | null = null;
  do {
    const request: ListAuditRequest = {
      workspaceId: WORKSPACE_ID,
      outcome: input.outcome,
      pageSize: PAGE_SIZE,
      cursor,
    };
    const page = await callAuditPage(input.callable, request);
    actualPageSizes.push(page.events.length);
    for (const event of page.events) {
      if (events.some((prior) => prior.id === event.id)) {
        return fail("Compliance pagination returned a duplicate audit event.");
      }
      const prior = events.at(-1);
      if (prior && compareProjectedEvents(prior, event) >= 0) {
        return fail("Compliance pagination order regressed across a cursor.");
      }
      events.push(event);
    }
    cursor = page.nextCursor;
    if (cursor) {
      const key = `${cursor.createdAt}|${cursor.id}`;
      if (cursors.has(key)) return fail("Compliance pagination repeated a cursor.");
      cursors.add(key);
    }
    if (actualPageSizes.length > 10) {
      return fail("Compliance pagination exceeded its bounded verifier loop.");
    }
  } while (cursor !== null);
  if (!isDeepStrictEqual(actualPageSizes, input.expectedPageSizes)) {
    return fail("Compliance pagination did not return the expected fresh-seed pages.");
  }
  return events;
}

function collectProjectionEvidence(
  value: unknown,
  keys: Set<string>,
): void {
  if (typeof value === "string") return;
  if (Array.isArray(value)) {
    for (const item of value) collectProjectionEvidence(item, keys);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    keys.add(key);
    collectProjectionEvidence(nested, keys);
  }
}

function assertMinimizedProjection(
  events: readonly ClientSafeAuditEventDTO[],
  rawAudits: ReadonlyMap<string, FirestoreAuditRecordV1DTO>,
): void {
  if (events.length !== rawAudits.size) {
    fail("Compliance projection does not cover the exact fresh audit seed.");
  }
  const expectedIds = [...rawAudits.keys()].sort();
  const actualIds = events.map((event) => event.id).sort();
  if (!isDeepStrictEqual(actualIds, expectedIds)) {
    fail("Compliance projection substituted the fresh audit event identities.");
  }
  for (const event of events) {
    const parsed = parseClientSafeAuditEventProjection(event);
    const raw = rawAudits.get(parsed.id) ?? fail("Projected audit has no raw seed join.");
    const expected = projectClientSafeAuditEvent(raw);
    if (!isDeepStrictEqual(parsed, expected)) {
      fail("Compliance callable substituted deterministic projected audit evidence.");
    }
    const keys = new Set<string>();
    collectProjectionEvidence(parsed, keys);
    if ([...PROTECTED_PROJECTION_KEYS].some((key) => keys.has(key))) {
      fail("Compliance projection exposed a protected raw field.");
    }
  }
}

async function captureOriginalMembership(
  firestoreHost: string,
  actorUid: string,
): Promise<Readonly<Record<string, FirestoreRestValue>>> {
  const document = await adminGetRawDocument(firestoreHost, [
    "workspaces",
    WORKSPACE_ID,
    "members",
    actorUid,
  ]);
  if (!document.fields) return fail("Dynamic synthetic membership has no fields.");
  const membership = exactRecord(
    decodeRestFields(document.fields),
    MEMBERSHIP_KEYS,
    "Dynamic synthetic membership",
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
    stringArray(membership.teamIds, "Admin team scope").length !== 0 ||
    stringArray(membership.locationIds, "Admin location scope").length !== 0 ||
    !(membership.lastAuthenticatedAt instanceof Timestamp)
  ) {
    return fail("Fresh seed did not provide the exact workspace-wide admin authority.");
  }
  return structuredClone(document.fields);
}

function restStringArray(values: readonly string[]): FirestoreRestValue {
  return {
    arrayValue: {
      values: values.map((value) => ({ stringValue: value })),
    },
  };
}

function variantMembershipFields(
  originalFields: Readonly<Record<string, FirestoreRestValue>>,
  variant: MembershipVariant,
): Readonly<Record<string, FirestoreRestValue>> {
  const now = new Date().toISOString();
  const fields: Readonly<Record<string, FirestoreRestValue>> = {
    ...structuredClone(originalFields),
    workspaceId: { stringValue: variant.workspaceId ?? WORKSPACE_ID },
    role: { stringValue: variant.role },
    scopeMode: { stringValue: variant.scopeMode },
    teamIds: restStringArray(variant.teamIds ?? []),
    locationIds: restStringArray(variant.locationIds ?? []),
    status: { stringValue: variant.status ?? "active" },
    lastAuthenticatedAt: { timestampValue: now },
    updatedAt: { timestampValue: now },
  };
  if (
    !isDeepStrictEqual(Object.keys(fields).sort(), [...MEMBERSHIP_KEYS].sort())
  ) {
    return fail("Compliance membership switch would change the schema keyset.");
  }
  return fields;
}

async function switchMembership(
  firestoreHost: string,
  actorUid: string,
  originalFields: Readonly<Record<string, FirestoreRestValue>>,
  variant: MembershipVariant,
): Promise<void> {
  const fields = variantMembershipFields(originalFields, variant);
  const segments = ["workspaces", WORKSPACE_ID, "members", actorUid] as const;
  await adminPatchRawDocument(firestoreHost, segments, fields);
  const switchedDocument = await adminGetRawDocument(firestoreHost, segments);
  if (!switchedDocument.fields) return fail("Switched membership has no fields.");
  const switched = exactRecord(
    decodeRestFields(switchedDocument.fields),
    MEMBERSHIP_KEYS,
    "Switched Compliance membership",
  );
  if (
    switched.id !== actorUid ||
    switched.uid !== actorUid ||
    switched.workspaceId !== (variant.workspaceId ?? WORKSPACE_ID) ||
    switched.role !== variant.role ||
    switched.scopeMode !== variant.scopeMode ||
    switched.status !== (variant.status ?? "active") ||
    !isDeepStrictEqual(
      stringArray(switched.teamIds, "Switched team scope"),
      variant.teamIds ?? [],
    ) ||
    !isDeepStrictEqual(
      stringArray(switched.locationIds, "Switched location scope"),
      variant.locationIds ?? [],
    ) ||
    switched.synthetic !== true
  ) {
    return fail("Loopback Admin membership switch did not round-trip exactly.");
  }
}

async function signInFresh(auth: Auth): Promise<string> {
  const credential = await signInWithEmailAndPassword(
    auth,
    AUTH_EMAIL,
    AUTH_PASSWORD,
  );
  const token = await credential.user.getIdTokenResult(true);
  const age = Date.now() - Date.parse(token.authTime);
  if (!Number.isFinite(age) || age < 0 || age > 15 * 60_000) {
    return fail("Dynamic synthetic Admin authentication is not fresh.");
  }
  return credential.user.uid;
}

async function restoreMembershipAndRelogin(input: {
  readonly firestoreHost: string;
  readonly actorUid: string;
  readonly originalFields: Readonly<Record<string, FirestoreRestValue>>;
  readonly auth: Auth;
}): Promise<void> {
  const segments = [
    "workspaces",
    WORKSPACE_ID,
    "members",
    input.actorUid,
  ] as const;
  await adminPatchRawDocument(
    input.firestoreHost,
    segments,
    input.originalFields,
  );
  const restored = await adminGetRawDocument(input.firestoreHost, segments);
  if (!restored.fields || !isDeepStrictEqual(restored.fields, input.originalFields)) {
    return fail("Original dynamic Admin membership was not restored byte-for-byte.");
  }
  await signOut(input.auth);
  const restoredUid = await signInFresh(input.auth);
  if (restoredUid !== input.actorUid) {
    return fail("Final Compliance re-login changed the authenticated synthetic UID.");
  }
  await captureOriginalMembership(input.firestoreHost, input.actorUid);
}

async function assertRoleAndScopeMatrix(input: {
  readonly callable: HttpsCallable<unknown, unknown>;
  readonly firestoreHost: string;
  readonly actorUid: string;
  readonly originalFields: Readonly<Record<string, FirestoreRestValue>>;
}): Promise<void> {
  await switchMembership(
    input.firestoreHost,
    input.actorUid,
    input.originalFields,
    { role: "privacy_reviewer", scopeMode: "assigned" },
  );
  const privacyEvents = await loadAllAuditEvents({
    callable: input.callable,
    outcome: "allowed",
    expectedPageSizes: [10, 10, 8],
  });
  if (privacyEvents.length !== EXPECTED_SEED_AUDIT_COUNT) {
    return fail("Assigned privacy reviewer did not receive the exact minimized seed.");
  }

  await switchMembership(
    input.firestoreHost,
    input.actorUid,
    input.originalFields,
    { role: "tenant_admin", scopeMode: "assigned" },
  );
  await expectCallableError(
    input.callable,
    { workspaceId: WORKSPACE_ID, outcome: null, pageSize: 1, cursor: null },
    "permission-denied",
    "Assigned tenant admin",
  );

  await switchMembership(
    input.firestoreHost,
    input.actorUid,
    input.originalFields,
    { role: "privacy_reviewer", scopeMode: "workspace_wide" },
  );
  await expectCallableError(
    input.callable,
    { workspaceId: WORKSPACE_ID, outcome: null, pageSize: 1, cursor: null },
    "permission-denied",
    "Workspace-wide privacy reviewer",
  );

  for (const role of WRONG_ROLES) {
    await switchMembership(
      input.firestoreHost,
      input.actorUid,
      input.originalFields,
      {
        role,
        scopeMode: role === "platform_owner" ? "workspace_wide" : "assigned",
      },
    );
    await expectCallableError(
      input.callable,
      { workspaceId: WORKSPACE_ID, outcome: null, pageSize: 1, cursor: null },
      "permission-denied",
      `Wrong Compliance role ${role}`,
    );
  }

  await switchMembership(
    input.firestoreHost,
    input.actorUid,
    input.originalFields,
    {
      role: "privacy_reviewer",
      scopeMode: "assigned",
      status: "revoked",
    },
  );
  await expectCallableError(
    input.callable,
    { workspaceId: WORKSPACE_ID, outcome: null, pageSize: 1, cursor: null },
    "permission-denied",
    "Revoked privacy reviewer",
  );

  await switchMembership(
    input.firestoreHost,
    input.actorUid,
    input.originalFields,
    {
      role: "tenant_admin",
      scopeMode: "workspace_wide",
      workspaceId: LOCKED_WORKSPACE_ID,
    },
  );
  await expectCallableError(
    input.callable,
    { workspaceId: WORKSPACE_ID, outcome: null, pageSize: 1, cursor: null },
    "permission-denied",
    "Cross-tenant membership binding",
  );
}

async function assertHostileRequests(
  callable: HttpsCallable<unknown, unknown>,
  firstCursor: AuditCursor,
): Promise<void> {
  const valid = {
    workspaceId: WORKSPACE_ID,
    outcome: null,
    pageSize: PAGE_SIZE,
    cursor: null,
  } as const;
  await expectCallableError(
    callable,
    { ...valid, extra: true },
    "invalid-argument",
    "Extra request field",
  );
  await expectCallableError(
    callable,
    { ...valid, outcome: "safety_hold" },
    "invalid-argument",
    "Unsupported outcome",
  );
  for (const pageSize of [0, 51, 1.5]) {
    await expectCallableError(
      callable,
      { ...valid, pageSize },
      "invalid-argument",
      `Invalid page bound ${pageSize}`,
    );
  }
  await expectCallableError(
    callable,
    {
      ...valid,
      cursor: { ...firstCursor, unexpected: "field" },
    },
    "invalid-argument",
    "Cursor with an extra field",
  );
  await expectCallableError(
    callable,
    {
      ...valid,
      cursor: {
        ...firstCursor,
        createdAt: new Date(Date.parse(firstCursor.createdAt) + 1).toISOString(),
      },
    },
    "invalid-argument",
    "Cursor timestamp tampering",
  );
  await expectCallableError(
    callable,
    {
      ...valid,
      cursor: { ...firstCursor, id: "audit_nonexistent_cursor" },
    },
    "invalid-argument",
    "Cursor ID tampering",
  );
  await expectCallableError(
    callable,
    {
      ...valid,
      outcome: "failed",
      cursor: firstCursor,
    },
    "invalid-argument",
    "Cross-filter cursor reuse",
  );
}

const boundary = assertExactBoundary();
const verifierApp = initializeApp(
  {
    apiKey: "demo-api-key",
    authDomain: `${PROJECT_ID}.firebaseapp.com`,
    projectId: PROJECT_ID,
    appId: "compliance-functions-emulator-verifier",
  },
  "compliance-functions-emulator-verifier",
);
const auth = getAuth(verifierApp);
let actorUid: string | undefined;
let originalMembershipFields:
  | Readonly<Record<string, FirestoreRestValue>>
  | undefined;
let restoredAndRelogged = false;

try {
  connectAuthEmulator(auth, `http://${boundary.authHost}`, {
    disableWarnings: true,
  });
  actorUid = await signInFresh(auth);

  const db: Firestore = getFirestore(verifierApp);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const functions = getFunctions(verifierApp, "us-central1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  const listComplianceAuditEvents = httpsCallable<unknown, unknown>(
    functions,
    "listComplianceAuditEvents",
    { timeout: 30_000 },
  );

  const baselineCounts = await captureDatastoreCounts(boundary.firestoreHost);
  if (baselineCounts["workspace:auditEvents"] !== EXPECTED_SEED_AUDIT_COUNT) {
    fail("Fresh datastore baseline does not contain exactly 28 audit events.");
  }
  const rawAudits = await captureRawSeedAudits(boundary.firestoreHost);
  originalMembershipFields = await captureOriginalMembership(
    boundary.firestoreHost,
    actorUid,
  );

  const unfilteredEvents = await loadAllAuditEvents({
    callable: listComplianceAuditEvents,
    outcome: null,
    expectedPageSizes: [10, 10, 8],
  });
  const allowedEvents = await loadAllAuditEvents({
    callable: listComplianceAuditEvents,
    outcome: "allowed",
    expectedPageSizes: [10, 10, 8],
  });
  const failedEvents = await loadAllAuditEvents({
    callable: listComplianceAuditEvents,
    outcome: "failed",
    expectedPageSizes: [0],
  });
  if (
    unfilteredEvents.length !== EXPECTED_SEED_AUDIT_COUNT ||
    allowedEvents.length !== EXPECTED_SEED_AUDIT_COUNT ||
    failedEvents.length !== 0 ||
    !isDeepStrictEqual(
      unfilteredEvents.map((event) => event.id),
      allowedEvents.map((event) => event.id),
    )
  ) {
    fail("Compliance outcome filters drifted from the exact all-allowed seed.");
  }
  assertMinimizedProjection(unfilteredEvents, rawAudits.records);
  assertMinimizedProjection(allowedEvents, rawAudits.records);

  const firstPage = await callAuditPage(listComplianceAuditEvents, {
    workspaceId: WORKSPACE_ID,
    outcome: null,
    pageSize: PAGE_SIZE,
    cursor: null,
  });
  const firstCursor =
    firstPage.nextCursor ?? fail("First Compliance page did not provide a cursor.");
  await assertHostileRequests(listComplianceAuditEvents, firstCursor);
  await expectCallableError(
    listComplianceAuditEvents,
    {
      workspaceId: LOCKED_WORKSPACE_ID,
      outcome: null,
      pageSize: 1,
      cursor: null,
    },
    "permission-denied",
    "Cross-workspace Compliance request",
  );

  await signOut(auth);
  await expectCallableError(
    listComplianceAuditEvents,
    {
      workspaceId: WORKSPACE_ID,
      outcome: null,
      pageSize: 1,
      cursor: null,
    },
    "unauthenticated",
    "Public Compliance request",
  );
  const publicDenialReloginUid = await signInFresh(auth);
  if (publicDenialReloginUid !== actorUid) {
    fail("Public-denial re-login changed the authenticated synthetic UID.");
  }

  await expectClientPermissionDenied(
    () =>
      getDocsFromServer(
        collection(db, "workspaces", WORKSPACE_ID, "auditEvents"),
      ),
    "Raw audit collection list",
  );
  const updateProbeId = unfilteredEvents[0]?.id ?? fail("No audit write probe exists.");
  await expectClientPermissionDenied(
    () =>
      updateDoc(
        doc(db, "workspaces", WORKSPACE_ID, "auditEvents", updateProbeId),
        { schemaVersion: 1 },
      ),
    "Direct audit document write",
  );

  await assertRoleAndScopeMatrix({
    callable: listComplianceAuditEvents,
    firestoreHost: boundary.firestoreHost,
    actorUid,
    originalFields: originalMembershipFields,
  });

  await restoreMembershipAndRelogin({
    firestoreHost: boundary.firestoreHost,
    actorUid,
    originalFields: originalMembershipFields,
    auth,
  });
  restoredAndRelogged = true;
  const finalPage = await callAuditPage(listComplianceAuditEvents, {
    workspaceId: WORKSPACE_ID,
    outcome: "allowed",
    pageSize: 1,
    cursor: null,
  });
  if (finalPage.events.length !== 1) {
    fail("Restored and re-authenticated Admin could not read Compliance evidence.");
  }
  await assertRawSeedAuditsUnchanged(boundary.firestoreHost, rawAudits);
  assertSameCounts(
    await captureDatastoreCounts(boundary.firestoreHost),
    baselineCounts,
  );

  process.stdout.write(
    "Verified Compliance Functions: exact 28-event minimized pagination, allowed/empty filters, strict cursors and request bounds, workspace-wide Admin plus assigned privacy authority, all wrong-role/scope/revocation/cross-tenant denials, raw Web SDK list/write denial, exact membership restore with fresh re-login, and unchanged datastore counts.\n",
  );
} finally {
  try {
    if (
      !restoredAndRelogged &&
      actorUid !== undefined &&
      originalMembershipFields !== undefined
    ) {
      await restoreMembershipAndRelogin({
        firestoreHost: boundary.firestoreHost,
        actorUid,
        originalFields: originalMembershipFields,
        auth,
      });
    }
  } finally {
    await deleteApp(verifierApp);
  }
}
