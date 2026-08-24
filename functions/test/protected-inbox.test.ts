import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  PROTECTED_INBOX_AUDIT_RETENTION_MS,
  PROTECTED_INBOX_QUOTA_RETENTION_MS,
  PROTECTED_INBOX_RATE_LIMIT,
  PROTECTED_INBOX_RATE_WINDOW_MS,
  ProtectedInboxError,
  assertProtectedInboxAuthority,
  buildCoalescedProtectedMessageAccessAudit,
  buildProtectedInboxQuotaTransition,
  buildProtectedMessageAccessAudit,
  parseProtectedInboxRequest,
  protectedInboxAccessWindow,
  protectedInboxAuditId,
  protectedInboxQuotaId,
} from "../src/lite/protected-inbox.js";

const WORKSPACE_ID = "workspace_safenet_demo";
const CONVERSATION_ID = "conversation_live_abc123";
const workspace = {
  id: WORKSPACE_ID,
  status: "active",
  mode: "demo",
  dataClassification: "synthetic_only",
};
const conversation = {
  id: CONVERSATION_ID,
  workspaceId: WORKSPACE_ID,
  teamId: "team_demo_general",
  locationId: "location_demo_wattala",
  assigneeId: null,
  liveCanary: true,
  synthetic: true,
};
const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

function membership(
  role: "agent" | "supervisor" | "tenant_admin" = "agent",
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "seat-a",
    uid: "seat-a",
    workspaceId: WORKSPACE_ID,
    role,
    status: "active",
    teamIds: role === "tenant_admin" ? [] : ["team_demo_general"],
    locationIds: role === "tenant_admin" ? [] : ["location_demo_wattala"],
    ...overrides,
  };
}

function authority(
  role: "agent" | "supervisor" | "tenant_admin" = "agent",
  overrides: Record<string, unknown> = {},
) {
  return assertProtectedInboxAuthority({
    workspaceId: WORKSPACE_ID,
    authUid: "seat-a",
    emailVerified: true,
    workspace,
    membership: membership(role),
    conversationId: CONVERSATION_ID,
    conversation: { ...conversation, ...overrides },
  });
}

test("protected inbox request is exact, bounded, unique and server-tenant fixed", () => {
  assert.deepEqual(
    parseProtectedInboxRequest({
      conversationId: CONVERSATION_ID,
      messageIds: ["message_live_abc123"],
    }),
    { conversationId: CONVERSATION_ID, messageIds: ["message_live_abc123"] },
  );
  for (const bad of [
    {},
    { conversationId: CONVERSATION_ID, messageIds: [] },
    { conversationId: CONVERSATION_ID, messageIds: ["message_live_abc123", "message_live_abc123"] },
    { conversationId: CONVERSATION_ID, messageIds: ["not-a-message"] },
    {
      conversationId: CONVERSATION_ID,
      messageIds: Array.from({ length: 61 }, (_, index) => `message_live_${index.toString().padStart(4, "0")}`),
    },
    { conversationId: CONVERSATION_ID, messageIds: ["message_live_abc123"], workspaceId: "other" },
  ]) {
    assert.throws(() => parseProtectedInboxRequest(bad), ProtectedInboxError);
  }
});

test("tenant admin and scoped supervisor can view any canary assignment", () => {
  assert.equal(authority("tenant_admin", { assigneeId: "another-agent" }).accessMode,
    "tenant_admin_workspace_wide");
  assert.equal(authority("supervisor", { assigneeId: "another-agent" }).accessMode,
    "supervisor_scoped");
});

test("agent access is limited to unassigned or self-assigned scoped conversations", () => {
  assert.equal(authority("agent").accessMode, "agent_unassigned");
  assert.equal(authority("agent", { assigneeId: "seat-a" }).accessMode, "agent_assigned_self");
  assert.throws(
    () => authority("agent", { assigneeId: "another-agent" }),
    (error: unknown) => error instanceof ProtectedInboxError && error.code === "permission_denied",
  );
});

test("protected authority fails closed for unverified, revoked, polluted, cross-scope and non-canary state", () => {
  const base = {
    workspaceId: WORKSPACE_ID,
    authUid: "seat-a",
    emailVerified: true,
    workspace,
    membership: membership(),
    conversationId: CONVERSATION_ID,
    conversation,
  };
  const cases = [
    { ...base, emailVerified: false },
    { ...base, workspace: { ...workspace, status: "locked" } },
    { ...base, workspace: { ...workspace, mode: "live" } },
    { ...base, workspace: { ...workspace, dataClassification: "patient_data" } },
    { ...base, membership: membership("agent", { status: "revoked" }) },
    { ...base, membership: membership("agent", { id: "other" }) },
    { ...base, membership: membership("agent", { teamIds: ["team_demo_general", "team_demo_general"] }) },
    { ...base, conversation: { ...conversation, teamId: "other-team" } },
    { ...base, conversation: { ...conversation, workspaceId: "other-workspace" } },
    { ...base, conversation: { ...conversation, liveCanary: false } },
    { ...base, conversation: { ...conversation, synthetic: false } },
  ];
  for (const candidate of cases) {
    assert.throws(() => assertProtectedInboxAuthority(candidate), ProtectedInboxError);
  }
});

test("protected inbox access windows and document ids are deterministic", () => {
  const nowMs = Date.parse("2026-08-22T09:15:42.123Z");
  const window = protectedInboxAccessWindow(nowMs);
  assert.equal(window.windowStartMs, Date.parse("2026-08-22T09:15:00.000Z"));
  assert.equal(window.windowEndMs - window.windowStartMs, PROTECTED_INBOX_RATE_WINDOW_MS);
  assert.equal(
    window.quotaExpiresAtMs - window.windowStartMs,
    PROTECTED_INBOX_QUOTA_RETENTION_MS,
  );
  assert.equal(
    window.auditExpiresAtMs - window.windowStartMs,
    PROTECTED_INBOX_AUDIT_RETENTION_MS,
  );

  const quotaId = protectedInboxQuotaId({
    workspaceId: WORKSPACE_ID,
    actorUid: "seat-a",
    windowStartMs: window.windowStartMs,
    sha256Hex,
  });
  const auditId = protectedInboxAuditId({
    workspaceId: WORKSPACE_ID,
    actorUid: "seat-a",
    conversationId: CONVERSATION_ID,
    windowStartMs: window.windowStartMs,
    sha256Hex,
  });
  assert.match(quotaId, /^protected_quota_[0-9a-f]{32}$/);
  assert.match(auditId, /^protected_access_[0-9a-f]{32}$/);
  assert.equal(
    quotaId,
    protectedInboxQuotaId({
      workspaceId: WORKSPACE_ID,
      actorUid: "seat-a",
      windowStartMs: window.windowStartMs,
      sha256Hex,
    }),
  );
  assert.notEqual(
    quotaId,
    protectedInboxQuotaId({
      workspaceId: WORKSPACE_ID,
      actorUid: "seat-a",
      windowStartMs: window.windowEndMs,
      sha256Hex,
    }),
  );
  assert.notEqual(
    auditId,
    protectedInboxAuditId({
      workspaceId: WORKSPACE_ID,
      actorUid: "seat-a",
      conversationId: "conversation_live_other",
      windowStartMs: window.windowStartMs,
      sha256Hex,
    }),
  );
  assert.throws(() => protectedInboxAccessWindow(-1), ProtectedInboxError);
});

test("per-seat fixed-window quota allows six calls and rejects the seventh", () => {
  const nowMs = Date.parse("2026-08-22T09:15:01.000Z");
  const window = protectedInboxAccessWindow(nowMs);
  const id = protectedInboxQuotaId({
    workspaceId: WORKSPACE_ID,
    actorUid: "seat-a",
    windowStartMs: window.windowStartMs,
    sha256Hex,
  });
  let quota: unknown;
  for (let requestCount = 1; requestCount <= PROTECTED_INBOX_RATE_LIMIT; requestCount += 1) {
    quota = buildProtectedInboxQuotaTransition({
      existing: quota,
      id,
      workspaceId: WORKSPACE_ID,
      actorUid: "seat-a",
      window,
      windowStartedAt: new Date(window.windowStartMs),
      occurredAt: new Date(window.windowStartMs + requestCount * 1_000),
      expireAt: new Date(window.quotaExpiresAtMs),
    });
    assert.equal((quota as { requestCount: number }).requestCount, requestCount);
  }
  assert.throws(
    () => buildProtectedInboxQuotaTransition({
      existing: quota,
      id,
      workspaceId: WORKSPACE_ID,
      actorUid: "seat-a",
      window,
      windowStartedAt: new Date(window.windowStartMs),
      occurredAt: new Date(window.windowStartMs + 50_000),
      expireAt: new Date(window.quotaExpiresAtMs),
    }),
    (error: unknown) =>
      error instanceof ProtectedInboxError && error.code === "resource_exhausted",
  );
  assert.doesNotMatch(
    JSON.stringify(quota),
    /"(?:messageIds|text|bodySha256|phone|provider|conversationId)"\s*:/i,
  );
});

test("quota transition rejects malformed state and resets only with a new minute id", () => {
  const window = protectedInboxAccessWindow(Date.parse("2026-08-22T09:15:01.000Z"));
  const id = protectedInboxQuotaId({
    workspaceId: WORKSPACE_ID,
    actorUid: "seat-a",
    windowStartMs: window.windowStartMs,
    sha256Hex,
  });
  const first = buildProtectedInboxQuotaTransition({
    existing: undefined,
    id,
    workspaceId: WORKSPACE_ID,
    actorUid: "seat-a",
    window,
    windowStartedAt: new Date(window.windowStartMs),
    occurredAt: new Date(window.windowStartMs + 1_000),
    expireAt: new Date(window.quotaExpiresAtMs),
  });
  assert.throws(
    () => buildProtectedInboxQuotaTransition({
      existing: { ...first, text: "must not be accepted" },
      id,
      workspaceId: WORKSPACE_ID,
      actorUid: "seat-a",
      window,
      windowStartedAt: new Date(window.windowStartMs),
      occurredAt: new Date(window.windowStartMs + 2_000),
      expireAt: new Date(window.quotaExpiresAtMs),
    }),
    (error: unknown) =>
      error instanceof ProtectedInboxError && error.code === "invalid_authority",
  );

  const nextWindow = protectedInboxAccessWindow(window.windowEndMs);
  const nextId = protectedInboxQuotaId({
    workspaceId: WORKSPACE_ID,
    actorUid: "seat-a",
    windowStartMs: nextWindow.windowStartMs,
    sha256Hex,
  });
  const reset = buildProtectedInboxQuotaTransition({
    existing: undefined,
    id: nextId,
    workspaceId: WORKSPACE_ID,
    actorUid: "seat-a",
    window: nextWindow,
    windowStartedAt: new Date(nextWindow.windowStartMs),
    occurredAt: new Date(nextWindow.windowStartMs),
    expireAt: new Date(nextWindow.quotaExpiresAtMs),
  });
  assert.notEqual(nextId, id);
  assert.equal(reset.requestCount, 1);
});

test("access audits coalesce deterministically per actor conversation and minute", () => {
  const window = protectedInboxAccessWindow(Date.parse("2026-08-22T09:15:01.000Z"));
  const id = protectedInboxAuditId({
    workspaceId: WORKSPACE_ID,
    actorUid: "seat-a",
    conversationId: CONVERSATION_ID,
    windowStartMs: window.windowStartMs,
    sha256Hex,
  });
  const firstOccurredAt = new Date(window.windowStartMs + 1_000);
  const first = buildCoalescedProtectedMessageAccessAudit({
    existing: undefined,
    id,
    workspaceId: WORKSPACE_ID,
    authority: authority("agent", { assigneeId: "seat-a" }),
    conversationId: CONVERSATION_ID,
    recordCount: 2,
    window,
    windowStartedAt: new Date(window.windowStartMs),
    occurredAt: firstOccurredAt,
    expireAt: new Date(window.auditExpiresAtMs),
  });
  const lastOccurredAt = new Date(window.windowStartMs + 2_000);
  const second = buildCoalescedProtectedMessageAccessAudit({
    existing: first,
    id,
    workspaceId: WORKSPACE_ID,
    authority: authority("agent", { assigneeId: "seat-a" }),
    conversationId: CONVERSATION_ID,
    recordCount: 3,
    window,
    windowStartedAt: new Date(window.windowStartMs),
    occurredAt: lastOccurredAt,
    expireAt: new Date(window.auditExpiresAtMs),
  });
  assert.equal(second.requestCount, 2);
  assert.equal(second.recordCount, 5);
  assert.equal(second.firstOccurredAt, firstOccurredAt);
  assert.equal(second.lastOccurredAt, lastOccurredAt);
  assert.equal(second.expiresAtMs, window.auditExpiresAtMs);
  assert.equal(second.schemaVersion, 2);
  assert.doesNotMatch(
    JSON.stringify(second),
    /"(?:messageIds|text|bodySha256|phone|provider)"\s*:/i,
  );
  assert.throws(
    () => buildCoalescedProtectedMessageAccessAudit({
      existing: { ...first, messageIds: ["message_live_abc123"] },
      id,
      workspaceId: WORKSPACE_ID,
      authority: authority("agent", { assigneeId: "seat-a" }),
      conversationId: CONVERSATION_ID,
      recordCount: 1,
      window,
      windowStartedAt: new Date(window.windowStartMs),
      occurredAt: lastOccurredAt,
      expireAt: new Date(window.auditExpiresAtMs),
    }),
    (error: unknown) =>
      error instanceof ProtectedInboxError && error.code === "invalid_authority",
  );
});

test("access audit is content-free and rejects oversized counts or polluted ids", () => {
  const record = buildProtectedMessageAccessAudit({
    id: `protected_access_${"a".repeat(32)}`,
    workspaceId: WORKSPACE_ID,
    authority: authority("agent", { assigneeId: "seat-a" }),
    conversationId: CONVERSATION_ID,
    recordCount: 2,
    occurredAt: new Date("2026-08-22T00:00:00.000Z"),
  });
  assert.deepEqual(record, {
    id: `protected_access_${"a".repeat(32)}`,
    workspaceId: WORKSPACE_ID,
    actorUid: "seat-a",
    actorRole: "agent",
    conversationId: CONVERSATION_ID,
    teamId: "team_demo_general",
    locationId: "location_demo_wattala",
    action: "conversation.protected_text_viewed",
    accessMode: "agent_assigned_self",
    outcome: "allowed",
    recordCount: 2,
    purpose: "canary_support",
    containsMessageContent: false,
    occurredAt: new Date("2026-08-22T00:00:00.000Z"),
    schemaVersion: 1,
  });
  assert.doesNotMatch(
    JSON.stringify(record),
    /"(?:messageIds|text|bodySha256|phone|provider)"\s*:/i,
  );
  assert.throws(
    () => buildProtectedMessageAccessAudit({
      id: "forged",
      workspaceId: WORKSPACE_ID,
      authority: authority(),
      conversationId: CONVERSATION_ID,
      recordCount: 61,
      occurredAt: new Date(),
    }),
    ProtectedInboxError,
  );
});
