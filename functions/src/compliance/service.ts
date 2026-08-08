import { FailClosedError } from "../errors.js";
import {
  parseFirestoreAuditRecordV1,
  parseListComplianceAuditEventsInput,
  parseListComplianceAuditEventsResult,
  projectClientSafeComplianceAuditEvent,
  type ComplianceAuditCursor,
  type ComplianceAuditOutcome,
  type FirestoreAuditRecordV1,
  type ListComplianceAuditEventsInput,
  type ListComplianceAuditEventsResult,
} from "./contracts.js";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface ComplianceAuditDocument {
  readonly id: string;
  readonly data: unknown;
}

export interface ComplianceAuditQuery {
  readonly workspaceId: string;
  readonly outcome: ComplianceAuditOutcome | null;
  readonly pageSize: number;
  readonly cursor: {
    readonly createdAt: Date;
    readonly id: string;
  } | null;
}

export interface ComplianceAuditSource {
  getWorkspace(workspaceId: string): Promise<unknown | undefined>;
  getMembership(
    workspaceId: string,
    uid: string,
  ): Promise<unknown | undefined>;
  getAuditEvent(
    workspaceId: string,
    eventId: string,
  ): Promise<ComplianceAuditDocument | null>;
  queryAuditEvents(
    query: ComplianceAuditQuery,
  ): Promise<readonly ComplianceAuditDocument[]>;
}

export interface ComplianceAuditActor {
  readonly uid: string;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function fail(code: string, message: string): never {
  throw new FailClosedError(code, message);
}

function asRecord(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail("compliance_access_denied", `${label} is invalid.`);
  }
  return value as UnknownRecord;
}

function safeId(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    return fail("compliance_access_denied", `${label} is invalid.`);
  }
  return value;
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 50) {
    return fail("compliance_access_denied", `${label} is invalid.`);
  }
  const values = value.map((item) => safeId(item, label));
  if (new Set(values).size !== values.length) {
    return fail("compliance_access_denied", `${label} is invalid.`);
  }
  return values;
}

function assertSyntheticWorkspace(value: unknown, workspaceId: string): void {
  const workspace = asRecord(value, "Workspace authority");
  if (
    workspace.id !== workspaceId ||
    workspace.status !== "active" ||
    workspace.mode !== "demo" ||
    workspace.dataClassification !== "synthetic_only" ||
    workspace.isSyntheticDemo !== true
  ) {
    fail(
      "compliance_access_denied",
      "An active synthetic demo workspace is required.",
    );
  }
}

function assertComplianceAuthority(input: {
  readonly value: unknown;
  readonly workspaceId: string;
  readonly actorUid: string;
}): void {
  const membership = asRecord(input.value, "Workspace membership");
  stringArray(membership.teamIds, "Membership team scope");
  stringArray(
    membership.locationIds,
    "Membership location scope",
  );
  if (
    membership.id !== input.actorUid ||
    membership.uid !== input.actorUid ||
    membership.workspaceId !== input.workspaceId ||
    membership.status !== "active" ||
    membership.synthetic !== true
  ) {
    fail(
      "compliance_access_denied",
      "An active tenant-bound membership is required.",
    );
  }
  const isWorkspaceWideAdmin =
    membership.role === "tenant_admin" &&
    membership.scopeMode === "workspace_wide";
  const isPrivacyReviewer =
    membership.role === "privacy_reviewer" &&
    membership.scopeMode === "assigned";
  if (!isWorkspaceWideAdmin && !isPrivacyReviewer) {
    fail(
      "compliance_access_denied",
      "The workspace role cannot list the minimized audit timeline.",
    );
  }
}

function compareAuditPosition(
  left: Pick<FirestoreAuditRecordV1, "id" | "createdAt">,
  right: Pick<FirestoreAuditRecordV1, "id" | "createdAt">,
): number {
  const leftMillis = left.createdAt.getTime();
  const rightMillis = right.createdAt.getTime();
  if (leftMillis !== rightMillis) return rightMillis - leftMillis;
  if (left.id === right.id) return 0;
  return left.id > right.id ? -1 : 1;
}

function assertPageOrder(input: {
  readonly records: readonly FirestoreAuditRecordV1[];
  readonly cursorRecord: FirestoreAuditRecordV1 | null;
}): void {
  const seen = new Set<string>();
  for (const [index, record] of input.records.entries()) {
    if (seen.has(record.id)) {
      fail("invalid_compliance_audit", "Audit query returned duplicate events.");
    }
    seen.add(record.id);
    const prior = index === 0 ? input.cursorRecord : input.records[index - 1];
    if (prior && compareAuditPosition(prior, record) >= 0) {
      fail(
        "invalid_compliance_audit",
        "Audit query order or cursor progression is invalid.",
      );
    }
  }
}

function assertCursorBinding(input: {
  readonly cursor: ComplianceAuditCursor;
  readonly record: FirestoreAuditRecordV1;
  readonly outcome: ComplianceAuditOutcome | null;
}): void {
  if (
    input.record.id !== input.cursor.id ||
    input.record.createdAt.toISOString() !== input.cursor.createdAt ||
    (input.outcome !== null && input.record.outcome !== input.outcome)
  ) {
    fail(
      "invalid_compliance_cursor",
      "The audit cursor does not bind the requested tenant and filter.",
    );
  }
}

export async function listSyntheticComplianceAuditEvents(input: {
  readonly source: ComplianceAuditSource;
  readonly actor: ComplianceAuditActor;
  readonly request: ListComplianceAuditEventsInput;
}): Promise<ListComplianceAuditEventsResult> {
  const request = parseListComplianceAuditEventsInput(input.request);
  const actorUid = safeId(input.actor.uid, "Authenticated UID");
  const [workspace, membership] = await Promise.all([
    input.source.getWorkspace(request.workspaceId),
    input.source.getMembership(request.workspaceId, actorUid),
  ]);
  assertSyntheticWorkspace(workspace, request.workspaceId);
  assertComplianceAuthority({
    value: membership,
    workspaceId: request.workspaceId,
    actorUid,
  });

  let cursorRecord: FirestoreAuditRecordV1 | null = null;
  if (request.cursor !== null) {
    const cursorDocument = await input.source.getAuditEvent(
      request.workspaceId,
      request.cursor.id,
    );
    if (!cursorDocument || cursorDocument.id !== request.cursor.id) {
      fail("invalid_compliance_cursor", "The audit cursor event is unavailable.");
    }
    cursorRecord = parseFirestoreAuditRecordV1(
      cursorDocument.data,
      cursorDocument.id,
      request.workspaceId,
    );
    assertCursorBinding({
      cursor: request.cursor,
      record: cursorRecord,
      outcome: request.outcome,
    });
  }

  const documents = await input.source.queryAuditEvents({
    workspaceId: request.workspaceId,
    outcome: request.outcome,
    pageSize: request.pageSize,
    cursor:
      request.cursor === null
        ? null
        : {
            createdAt: new Date(request.cursor.createdAt),
            id: request.cursor.id,
          },
  });
  if (documents.length > request.pageSize) {
    fail("invalid_compliance_audit", "Audit query exceeded its page bound.");
  }
  const records = documents.map((document) => {
    if (document.id !== safeId(document.id, "Audit document ID")) {
      fail("invalid_compliance_audit", "Audit document ID is invalid.");
    }
    const record = parseFirestoreAuditRecordV1(
      document.data,
      document.id,
      request.workspaceId,
    );
    if (request.outcome !== null && record.outcome !== request.outcome) {
      fail("invalid_compliance_audit", "Audit query returned a substituted outcome.");
    }
    return record;
  });
  assertPageOrder({ records, cursorRecord });
  const events = records.map(projectClientSafeComplianceAuditEvent);
  const last = records.at(-1);
  const nextCursor =
    records.length === request.pageSize && last
      ? { createdAt: last.createdAt.toISOString(), id: last.id }
      : null;
  return parseListComplianceAuditEventsResult(
    { events, nextCursor },
    request.workspaceId,
    request.outcome,
  );
}
