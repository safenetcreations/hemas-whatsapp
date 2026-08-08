import assert from "node:assert/strict";
import test from "node:test";
import { parseAppendSyntheticInternalNoteInput } from "../src/demo-services.js";
import {
  allowlistedServiceAuditMetadata,
  assertIdempotencyInput,
  assertWorkspaceAuthorization,
  fingerprintServiceRequest,
  idempotencyDocumentId,
  SERVICE_PURPOSES,
} from "../src/service-kernel.js";

const now = new Date("2026-08-07T12:00:00.000Z");
const workspace = { id: "safenet-demo", status: "active" };
const agentMembership = {
  id: "synthetic-agent-1",
  uid: "synthetic-agent-1",
  workspaceId: "safenet-demo",
  role: "agent",
  status: "active",
  teamIds: ["team-wattala"],
  locationIds: ["location-wattala"],
};

test("authorization accepts an active scoped agent and preserves fail-closed scope", () => {
  const context = assertWorkspaceAuthorization({
    workspaceId: "safenet-demo",
    actor: { uid: "synthetic-agent-1", authTime: new Date(now.getTime() - 60_000) },
    workspace,
    membership: agentMembership,
    policy: {
      allowedRoles: ["agent"],
      patientScope: { teamId: "team-wattala", locationId: "location-wattala" },
      recentAuthMaxAgeSeconds: 3_600,
    },
    now,
  });
  assert.equal(context.role, "agent");

  assert.throws(() => assertWorkspaceAuthorization({
    workspaceId: "safenet-demo",
    actor: { uid: "synthetic-agent-1", authTime: new Date(now.getTime() - 60_000) },
    workspace,
    membership: { ...agentMembership, teamIds: [], locationIds: [] },
    policy: {
      allowedRoles: ["agent"],
      patientScope: { teamId: "team-wattala", locationId: "location-wattala" },
    },
    now,
  }), { code: "scope_denied" });
});

test("authorization denies wrong role, revoked membership and stale authentication", () => {
  const base = {
    workspaceId: "safenet-demo",
    actor: { uid: "synthetic-agent-1", authTime: new Date(now.getTime() - 60_000) },
    workspace,
    membership: agentMembership,
    now,
  } as const;
  assert.throws(() => assertWorkspaceAuthorization({
    ...base,
    policy: { allowedRoles: ["campaign_approver"] },
  }), { code: "role_denied" });
  assert.throws(() => assertWorkspaceAuthorization({
    ...base,
    membership: { ...agentMembership, status: "revoked" },
    policy: { allowedRoles: ["agent"] },
  }), { code: "membership_denied" });
  assert.throws(() => assertWorkspaceAuthorization({
    ...base,
    actor: { uid: "synthetic-agent-1", authTime: new Date(now.getTime() - 7_200_000) },
    policy: { allowedRoles: ["agent"], recentAuthMaxAgeSeconds: 3_600 },
  }), { code: "recent_auth_required" });
});

test("tenant admin has explicit patient-scope wildcard but platform owner does not", () => {
  const tenantAdmin = {
    ...agentMembership,
    role: "tenant_admin",
    teamIds: [],
    locationIds: [],
  };
  assert.doesNotThrow(() => assertWorkspaceAuthorization({
    workspaceId: "safenet-demo",
    actor: { uid: "synthetic-agent-1", authTime: now },
    workspace,
    membership: tenantAdmin,
    policy: {
      allowedRoles: ["tenant_admin"],
      patientScope: { teamId: "team-other", locationId: "location-other" },
    },
    now,
  }));
  assert.throws(() => assertWorkspaceAuthorization({
    workspaceId: "safenet-demo",
    actor: { uid: "synthetic-agent-1", authTime: now },
    workspace,
    membership: { ...tenantAdmin, role: "platform_owner" },
    policy: {
      allowedRoles: ["platform_owner"],
      patientScope: { teamId: "team-other", locationId: "location-other" },
    },
    now,
  }), { code: "scope_denied" });
});

test("idempotency identifiers are deterministic and request fingerprints bind content", () => {
  const key = "note-create-00000001";
  const hashA = fingerprintServiceRequest({ conversationId: "conversation-1" });
  const hashB = fingerprintServiceRequest({ conversationId: "conversation-2" });
  assertIdempotencyInput(key, hashA);
  assert.notEqual(hashA, hashB);
  assert.equal(
    idempotencyDocumentId({
      workspaceId: "safenet-demo",
      uid: "synthetic-agent-1",
      action: "internal-note.create",
      key,
    }),
    idempotencyDocumentId({
      workspaceId: "safenet-demo",
      uid: "synthetic-agent-1",
      action: "internal-note.create",
      key,
    }),
  );
  assert.throws(() => assertIdempotencyInput("short", hashA), {
    code: "invalid_idempotency_key",
  });
});

test("service purposes are a closed healthcare operations allowlist", () => {
  assert.deepEqual(SERVICE_PURPOSES, [
    "patient_support",
    "appointment_service",
    "laboratory_service",
    "campaign_governance",
    "privacy_governance",
    "workspace_administration",
  ]);
  assert.equal(SERVICE_PURPOSES.includes("patient_support"), true);
  assert.equal(
    SERVICE_PURPOSES.includes("advertising_profile" as never),
    false,
  );
});

test("service audit metadata is allowlisted per action instead of trusting safe-looking keys", () => {
  assert.deepEqual(
    allowlistedServiceAuditMetadata("internal-note.create", {
      noteKind: "handoff_context",
      teamId: "team-wattala",
      locationId: "location-wattala",
      synthetic: true,
    }),
    {
      locationId: "location-wattala",
      noteKind: "handoff_context",
      synthetic: true,
      teamId: "team-wattala",
    },
  );
  assert.throws(
    () => allowlistedServiceAuditMetadata("internal-note.create", {
      details: "sensitive content hidden under an innocuous key",
    }),
    { code: "invalid_service_request" },
  );
  assert.throws(
    () => allowlistedServiceAuditMetadata("unregistered-action", {}),
    { code: "invalid_service_policy" },
  );
});

test("internal-note request parser enforces an exact synthetic metadata schema", () => {
  const valid = {
    workspaceId: "safenet-demo",
    conversationId: "conversation-demo-1",
    teamId: "team-wattala",
    locationId: "location-wattala",
    noteKind: "handoff_context",
    idempotencyKey: "note-create-00000001",
  };
  assert.deepEqual(parseAppendSyntheticInternalNoteInput(valid), valid);
  assert.throws(() => parseAppendSyntheticInternalNoteInput({
    ...valid,
    messageBody: "must not be accepted",
  }), { code: "invalid_service_request" });
  assert.throws(() => parseAppendSyntheticInternalNoteInput({
    ...valid,
    noteKind: "clinical_advice",
  }), { code: "invalid_service_request" });
});
