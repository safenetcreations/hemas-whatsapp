import assert from "node:assert/strict";
import test from "node:test";
import {
  FailClosedAuditSink,
  InMemoryAuditSink,
  createAuditSink,
  createTenantAuditEvent,
  tenantAuditPath,
  writeTenantAuditEvent,
} from "../src/audit.js";
import {
  FirestoreAuditSink,
  assertDemoAuditEmulatorBoundary,
  toFirestoreAuditRecord,
  type FirestoreAuditRecord,
} from "../src/audit-firestore.js";

const fixedInput = {
  tenantId: "safenet-demo",
  actor: { type: "user" as const, id: "synthetic-user-1" },
  action: "campaign.simulated",
  resource: { type: "campaign", id: "campaign-demo-1" },
  outcome: "simulated" as const,
  requestId: "request-demo-1",
  occurredAt: new Date("2026-08-07T00:00:00.000Z"),
  metadata: {
    recipientCount: 50_000,
    phoneNumber: "+94000000000",
    nested: { accessToken: "must-not-appear", safeCode: "demo" },
  },
};

test("audit events are deterministic, tenant-scoped and redacted", () => {
  const first = createTenantAuditEvent(fixedInput);
  const second = createTenantAuditEvent(fixedInput);
  assert.deepEqual(first, second);
  assert.match(tenantAuditPath(first), /^workspaces\/safenet-demo\/auditEvents\/audit-/);
  assert.equal(first.metadata.phoneNumber, "[REDACTED]");
  assert.deepEqual(first.metadata.nested, { accessToken: "[REDACTED]", safeCode: "demo" });
});

test("audit writes reject a tenant mismatch", async () => {
  const event = createTenantAuditEvent(fixedInput);
  await assert.rejects(
    writeTenantAuditEvent("hemas-prod", new InMemoryAuditSink(), event),
    { code: "tenant_mismatch" },
  );
});

test("demo memory audit stores only the tenant path and sanitized event", async () => {
  const event = createTenantAuditEvent(fixedInput);
  const sink = createAuditSink("memory", "demo");
  assert.ok(sink instanceof InMemoryAuditSink);
  await writeTenantAuditEvent("safenet-demo", sink, event);
  assert.equal(sink.records.length, 1);
});

test("non-demo audit fails closed without an explicit durable sink binding", async () => {
  const sink = createAuditSink("durable", "production");
  assert.ok(sink instanceof FailClosedAuditSink);
  await assert.rejects(
    sink.write("workspaces/hemas-prod/auditEvents/audit-1", createTenantAuditEvent({
      ...fixedInput,
      tenantId: "hemas-prod",
    })),
    { code: "durable_audit_not_configured" },
  );
});

test("audit identity fields reject blank and oversized values before persistence", () => {
  assert.throws(
    () => createTenantAuditEvent({ ...fixedInput, action: " ".repeat(4) }),
    { code: "invalid_audit_event" },
  );
  assert.throws(
    () => createTenantAuditEvent({
      ...fixedInput,
      actor: { type: "user", id: "a".repeat(129) },
    }),
    { code: "invalid_audit_event" },
  );
  assert.throws(
    () => createTenantAuditEvent({ ...fixedInput, requestId: "r".repeat(129) }),
    { code: "invalid_audit_event" },
  );
});

test("durable record is flattened, synthetic and contains only sanitized metadata", () => {
  const event = createTenantAuditEvent(fixedInput);
  const record = toFirestoreAuditRecord(event);
  assert.equal(record.workspaceId, "safenet-demo");
  assert.equal(record.actorUid, "synthetic-user-1");
  assert.equal(record.synthetic, true);
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.metadata.phoneNumber, "[REDACTED]");
  assert.equal(record.occurredAt.toISOString(), event.occurredAt);
});

test("durable sink uses create-only semantics and rejects path substitution", async () => {
  const created: Array<{ path: string; data: FirestoreAuditRecord }> = [];
  const sink = new FirestoreAuditSink({
    doc(path) {
      return {
        async create(data) {
          created.push({ path, data });
        },
      };
    },
  });
  const event = createTenantAuditEvent(fixedInput);
  await writeTenantAuditEvent("safenet-demo", sink, event);
  assert.equal(created.length, 1);
  assert.equal(created[0]?.path, tenantAuditPath(event));

  await assert.rejects(
    sink.write("workspaces/other/auditEvents/forged", event),
    { code: "invalid_audit_path" },
  );
});

test("durable sink injection is explicit and absent bindings still fail closed", async () => {
  const event = createTenantAuditEvent(fixedInput);
  const durable = new FirestoreAuditSink({
    doc() {
      return { async create() {} };
    },
  });
  assert.equal(createAuditSink("durable", "demo", durable), durable);
  await assert.rejects(
    createAuditSink("durable", "demo").write(tenantAuditPath(event), event),
    { code: "durable_audit_not_configured" },
  );
});

test("durable demo audit boundary rejects cloud and non-loopback targets", () => {
  assert.doesNotThrow(() => assertDemoAuditEmulatorBoundary({
    projectId: "demo-hemas-connect",
    firestoreEmulatorHost: "127.0.0.1:8080",
  }));
  assert.throws(() => assertDemoAuditEmulatorBoundary({
    projectId: "hemas-production",
    firestoreEmulatorHost: "127.0.0.1:8080",
  }), { code: "invalid_audit_project" });
  assert.throws(() => assertDemoAuditEmulatorBoundary({
    projectId: "demo-hemas-connect",
    firestoreEmulatorHost: "firestore.googleapis.com:443",
  }), { code: "invalid_audit_emulator" });
  assert.throws(() => assertDemoAuditEmulatorBoundary({
    projectId: "demo-hemas-connect",
    firestoreEmulatorHost: undefined,
  }), { code: "audit_emulator_required" });
});
