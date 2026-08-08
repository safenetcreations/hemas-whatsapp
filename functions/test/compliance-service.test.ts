import assert from "node:assert/strict";
import test from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import type {
  ComplianceAuditDocument,
  ComplianceAuditQuery,
  ComplianceAuditSource,
} from "../src/compliance/service.js";
import { listSyntheticComplianceAuditEvents } from "../src/compliance/service.js";

const WORKSPACE_ID = "workspace_safenet_demo";
const ACTOR_UID = "synthetic-compliance-reviewer";

type RecordValue = Readonly<Record<string, unknown>>;

function auditRecord(input: {
  readonly id: string;
  readonly occurredAt: string;
  readonly outcome?: "allowed" | "denied" | "failed" | "simulated";
  readonly action?: string;
  readonly overrides?: RecordValue;
}): RecordValue {
  const action = input.action ?? "automation.start";
  const known = action === "automation.start";
  const timestamp = Timestamp.fromDate(new Date(input.occurredAt));
  return {
    id: input.id,
    workspaceId: WORKSPACE_ID,
    actorUid: "user_demo_admin",
    actorType: "user",
    action,
    resourceType: known ? "automation_run" : "privacy_export",
    resourceId: "automation_run_synthetic_001",
    outcome: input.outcome ?? "allowed",
    requestId: `request_${input.id}`,
    occurredAt: timestamp,
    createdAt: timestamp,
    metadata: known
      ? {
          eventId: "automation_run_event_synthetic_001",
          fromState: "queued",
          toState: "running",
          revision: 2,
          outcomeCode: "accepted",
          resultFingerprint: "a".repeat(64),
          synthetic: true,
          externalDispatchCount: 0,
          networkCallCount: 0,
        }
      : {
          benignLabel: "clinical value that must not leave the server",
          synthetic: true,
        },
    synthetic: true,
    schemaVersion: 1,
    ...input.overrides,
  };
}

function membership(
  role: string,
  scopeMode: "assigned" | "workspace_wide",
  overrides: RecordValue = {},
): RecordValue {
  return {
    id: ACTOR_UID,
    uid: ACTOR_UID,
    workspaceId: WORKSPACE_ID,
    displayLabel: "Synthetic Compliance reviewer",
    role,
    scopeMode,
    teamIds: [],
    locationIds: [],
    status: "active",
    mfaSatisfied: false,
    lastAuthenticatedAt: Timestamp.fromDate(new Date("2026-08-07T13:00:00.000Z")),
    synthetic: true,
    createdAt: Timestamp.fromDate(new Date("2026-08-07T10:00:00.000Z")),
    updatedAt: Timestamp.fromDate(new Date("2026-08-07T13:00:00.000Z")),
    ...overrides,
  };
}

class MemoryComplianceSource implements ComplianceAuditSource {
  workspace: unknown = {
    id: WORKSPACE_ID,
    status: "active",
    mode: "demo",
    dataClassification: "synthetic_only",
    isSyntheticDemo: true,
  };
  member: unknown = membership("tenant_admin", "workspace_wide");
  readonly audits = new Map<string, RecordValue>();
  queryCalls = 0;
  exactAuditReads = 0;
  queryOverride: readonly ComplianceAuditDocument[] | null = null;

  async getWorkspace(): Promise<unknown> {
    return this.workspace;
  }

  async getMembership(): Promise<unknown> {
    return this.member;
  }

  async getAuditEvent(
    _workspaceId: string,
    eventId: string,
  ): Promise<ComplianceAuditDocument | null> {
    this.exactAuditReads += 1;
    const data = this.audits.get(eventId);
    return data ? { id: eventId, data } : null;
  }

  async queryAuditEvents(
    query: ComplianceAuditQuery,
  ): Promise<readonly ComplianceAuditDocument[]> {
    this.queryCalls += 1;
    if (this.queryOverride) return this.queryOverride;
    const rows = [...this.audits.entries()]
      .map(([id, data]) => ({ id, data }))
      .filter(({ data }) =>
        query.outcome === null ? true : data.outcome === query.outcome,
      )
      .sort((left, right) => {
        const leftTime = (left.data.createdAt as Timestamp).toMillis();
        const rightTime = (right.data.createdAt as Timestamp).toMillis();
        if (leftTime !== rightTime) return rightTime - leftTime;
        return right.id.localeCompare(left.id);
      });
    const start = query.cursor === null
      ? 0
      : rows.findIndex(({ id }) => id === query.cursor?.id) + 1;
    return rows.slice(start, start + query.pageSize);
  }
}

function seedThree(source: MemoryComplianceSource): void {
  source.audits.set(
    "audit_synthetic_003",
    auditRecord({
      id: "audit_synthetic_003",
      occurredAt: "2026-08-07T13:03:00.000Z",
    }),
  );
  source.audits.set(
    "audit_synthetic_002",
    auditRecord({
      id: "audit_synthetic_002",
      occurredAt: "2026-08-07T13:02:00.000Z",
    }),
  );
  source.audits.set(
    "audit_synthetic_001",
    auditRecord({
      id: "audit_synthetic_001",
      occurredAt: "2026-08-07T13:01:00.000Z",
      outcome: "failed",
    }),
  );
}

function request(overrides: RecordValue = {}) {
  return {
    workspaceId: WORKSPACE_ID,
    outcome: null,
    pageSize: 2,
    cursor: null,
    ...overrides,
  } as const;
}

function hasCode(expected: string): (error: unknown) => boolean {
  return (error: unknown) =>
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { readonly code: unknown }).code === expected;
}

test("workspace-wide admin receives ordered minimized pages with a tenant-bound cursor", async () => {
  const source = new MemoryComplianceSource();
  seedThree(source);
  const first = await listSyntheticComplianceAuditEvents({
    source,
    actor: { uid: ACTOR_UID },
    request: request(),
  });
  assert.deepEqual(
    first.events.map((event) => event.id),
    ["audit_synthetic_003", "audit_synthetic_002"],
  );
  assert.deepEqual(first.nextCursor, {
    createdAt: "2026-08-07T13:02:00.000Z",
    id: "audit_synthetic_002",
  });
  assert.equal(source.exactAuditReads, 0);
  const second = await listSyntheticComplianceAuditEvents({
    source,
    actor: { uid: ACTOR_UID },
    request: request({ cursor: first.nextCursor }),
  });
  assert.deepEqual(second.events.map((event) => event.id), ["audit_synthetic_001"]);
  assert.equal(second.nextCursor, null);
  assert.equal(source.exactAuditReads, 1);
  const serialized = JSON.stringify([...first.events, ...second.events]);
  for (const protectedValue of [
    "user_demo_admin",
    "automation_run_synthetic_001",
    "resultFingerprint",
    "request_audit",
    "metadata",
  ]) {
    assert.equal(serialized.includes(protectedValue), false);
  }
});

test("same-millisecond events paginate by document ID descending without skips", async () => {
  const source = new MemoryComplianceSource();
  for (const id of ["audit_same_001", "audit_same_002", "audit_same_003"]) {
    source.audits.set(
      id,
      auditRecord({ id, occurredAt: "2026-08-07T13:03:00.000Z" }),
    );
  }
  const first = await listSyntheticComplianceAuditEvents({
    source,
    actor: { uid: ACTOR_UID },
    request: request({ pageSize: 1 }),
  });
  const second = await listSyntheticComplianceAuditEvents({
    source,
    actor: { uid: ACTOR_UID },
    request: request({ pageSize: 1, cursor: first.nextCursor }),
  });
  const third = await listSyntheticComplianceAuditEvents({
    source,
    actor: { uid: ACTOR_UID },
    request: request({ pageSize: 1, cursor: second.nextCursor }),
  });
  assert.deepEqual(
    [first.events[0]?.id, second.events[0]?.id, third.events[0]?.id],
    ["audit_same_003", "audit_same_002", "audit_same_001"],
  );
});

test("privacy reviewer is allowed but every other role or assigned admin has zero timeline query", async () => {
  const allowed = new MemoryComplianceSource();
  allowed.member = membership("privacy_reviewer", "assigned");
  seedThree(allowed);
  const result = await listSyntheticComplianceAuditEvents({
    source: allowed,
    actor: { uid: ACTOR_UID },
    request: request({ pageSize: 1 }),
  });
  assert.equal(result.events.length, 1);

  const deniedAuthorities = [
    ["tenant_admin", "assigned"],
    ["privacy_reviewer", "workspace_wide"],
    ["supervisor", "assigned"],
    ["agent", "assigned"],
    ["campaign_operator", "assigned"],
    ["campaign_approver", "assigned"],
    ["analyst", "assigned"],
    ["clinical_approver", "assigned"],
    ["platform_owner", "assigned"],
  ] as const;
  for (const [role, scopeMode] of deniedAuthorities) {
    const source = new MemoryComplianceSource();
    source.member = membership(role, scopeMode);
    seedThree(source);
    await assert.rejects(
      listSyntheticComplianceAuditEvents({
        source,
        actor: { uid: ACTOR_UID },
        request: request(),
      }),
      hasCode("compliance_access_denied"),
    );
    assert.equal(source.queryCalls, 0, `${role}/${scopeMode} issued a query`);
    assert.equal(source.exactAuditReads, 0, `${role}/${scopeMode} read a cursor`);
  }
});

test("revoked, cross-tenant, malformed and unsafe workspace authority fail before audit reads", async () => {
  const substitutions: readonly ((source: MemoryComplianceSource) => void)[] = [
    (source) => {
      source.member = membership("privacy_reviewer", "assigned", { status: "revoked" });
    },
    (source) => {
      source.member = membership("privacy_reviewer", "assigned", { workspaceId: "workspace_other" });
    },
    (source) => {
      source.member = membership("privacy_reviewer", "assigned", { teamIds: ["unsafe/path"] });
    },
    (source) => {
      source.workspace = { ...(source.workspace as object), mode: "production" };
    },
    (source) => {
      source.workspace = { ...(source.workspace as object), isSyntheticDemo: false };
    },
  ];
  for (const substitute of substitutions) {
    const source = new MemoryComplianceSource();
    seedThree(source);
    substitute(source);
    await assert.rejects(
      listSyntheticComplianceAuditEvents({
        source,
        actor: { uid: ACTOR_UID },
        request: request(),
      }),
      hasCode("compliance_access_denied"),
    );
    assert.equal(source.queryCalls, 0);
    assert.equal(source.exactAuditReads, 0);
  }
});

test("outcome filtering is server-bound and cursor outcome substitution is denied", async () => {
  const source = new MemoryComplianceSource();
  seedThree(source);
  const failed = await listSyntheticComplianceAuditEvents({
    source,
    actor: { uid: ACTOR_UID },
    request: request({ outcome: "failed", pageSize: 10 }),
  });
  assert.deepEqual(failed.events.map((event) => event.id), ["audit_synthetic_001"]);
  assert.equal(failed.events[0]?.outcome, "failed");
  await assert.rejects(
    listSyntheticComplianceAuditEvents({
      source,
      actor: { uid: ACTOR_UID },
      request: request({
        outcome: "failed",
        cursor: {
          createdAt: "2026-08-07T13:02:00.000Z",
          id: "audit_synthetic_002",
        },
      }),
    }),
    hasCode("invalid_compliance_cursor"),
  );
});

test("cursor identity, tenant and timestamp are exact-get validated before a query", async () => {
  const source = new MemoryComplianceSource();
  seedThree(source);
  for (const cursor of [
    { createdAt: "2026-08-07T13:02:00.001Z", id: "audit_synthetic_002" },
    { createdAt: "2026-08-07T13:02:00.000Z", id: "audit_missing" },
  ]) {
    const beforeQueries = source.queryCalls;
    await assert.rejects(
      listSyntheticComplianceAuditEvents({
        source,
        actor: { uid: ACTOR_UID },
        request: request({ cursor }),
      }),
      hasCode("invalid_compliance_cursor"),
    );
    assert.equal(source.queryCalls, beforeQueries);
  }
  source.audits.set("audit_cross_tenant", auditRecord({
    id: "audit_cross_tenant",
    occurredAt: "2026-08-07T13:00:00.000Z",
    overrides: { workspaceId: "workspace_other" },
  }));
  await assert.rejects(
    listSyntheticComplianceAuditEvents({
      source,
      actor: { uid: ACTOR_UID },
      request: request({
        cursor: {
          createdAt: "2026-08-07T13:00:00.000Z",
          id: "audit_cross_tenant",
        },
      }),
    }),
    hasCode("invalid_compliance_audit"),
  );
});

test("malformed records, query pollution, duplicates and ordering drift fail the whole page", async () => {
  const invalidRows: readonly (readonly ComplianceAuditDocument[])[] = [
    [
      {
        id: "audit_bad",
        data: auditRecord({
          id: "audit_bad",
          occurredAt: "2026-08-07T13:03:00.000Z",
          overrides: { metadata: { nested: { clinical: "hidden" } } },
        }),
      },
    ],
    [
      {
        id: "audit_synthetic_001",
        data: auditRecord({ id: "audit_synthetic_001", occurredAt: "2026-08-07T13:01:00.000Z" }),
      },
      {
        id: "audit_synthetic_002",
        data: auditRecord({ id: "audit_synthetic_002", occurredAt: "2026-08-07T13:02:00.000Z" }),
      },
    ],
    [
      {
        id: "audit_synthetic_002",
        data: auditRecord({ id: "audit_synthetic_002", occurredAt: "2026-08-07T13:02:00.000Z" }),
      },
      {
        id: "audit_synthetic_002",
        data: auditRecord({ id: "audit_synthetic_002", occurredAt: "2026-08-07T13:02:00.000Z" }),
      },
    ],
    [
      {
        id: "audit_synthetic_003",
        data: auditRecord({ id: "audit_synthetic_003", occurredAt: "2026-08-07T13:03:00.000Z" }),
      },
      {
        id: "audit_synthetic_002",
        data: auditRecord({ id: "audit_synthetic_002", occurredAt: "2026-08-07T13:02:00.000Z" }),
      },
      {
        id: "audit_synthetic_001",
        data: auditRecord({ id: "audit_synthetic_001", occurredAt: "2026-08-07T13:01:00.000Z" }),
      },
    ],
  ];
  for (const rows of invalidRows) {
    const source = new MemoryComplianceSource();
    source.queryOverride = rows;
    await assert.rejects(
      listSyntheticComplianceAuditEvents({
        source,
        actor: { uid: ACTOR_UID },
        request: request(),
      }),
      hasCode("invalid_compliance_audit"),
    );
  }
});

test("unknown actions remain visible only as unsupported projections", async () => {
  const source = new MemoryComplianceSource();
  source.audits.set(
    "audit_unknown",
    auditRecord({
      id: "audit_unknown",
      occurredAt: "2026-08-07T13:03:00.000Z",
      action: "privacy.export_requested",
    }),
  );
  const result = await listSyntheticComplianceAuditEvents({
    source,
    actor: { uid: ACTOR_UID },
    request: request(),
  });
  assert.deepEqual(result.events[0], {
    id: "audit_unknown",
    workspaceId: WORKSPACE_ID,
    occurredAt: "2026-08-07T13:03:00.000Z",
    actor: { type: "user", id: "event_actor:audit_unknown" },
    action: "unsupported_event",
    resource: { type: "unsupported_event", id: "event_resource:audit_unknown" },
    outcome: "allowed",
    safeSummaryCode: "unsupported_event",
    synthetic: true,
    schemaVersion: 1,
  });
});

test("exported service reparses polluted requests before any audit query", async () => {
  const source = new MemoryComplianceSource();
  seedThree(source);
  await assert.rejects(
    listSyntheticComplianceAuditEvents({
      source,
      actor: { uid: ACTOR_UID },
      request: { ...request(), rawMetadata: true } as never,
    }),
    hasCode("invalid_compliance_request"),
  );
  assert.equal(source.queryCalls, 0);
  assert.equal(source.exactAuditReads, 0);
});
