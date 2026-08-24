import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  ENTERPRISE_BULK_DEFAULT_DISPATCH_MPS,
  ENTERPRISE_BULK_DISPATCH_STALE_MS,
  ENTERPRISE_BULK_MAX_ITEMS,
  ENTERPRISE_TEMPLATE_CATALOGUE,
  ENTERPRISE_WORKSPACE_ID,
  EnterpriseBulkError,
  assertEnterpriseBulkJobRequest,
  assertEnterpriseClientBatchId,
  assertEnterpriseClientReference,
  assertEnterpriseIdempotencyKey,
  assertEnterpriseTemplateSelection,
  buildEnterpriseBulkItemRecord,
  buildEnterpriseBulkItemSecretRecord,
  buildEnterpriseBulkJobRecord,
  buildEnterpriseBulkReceiptRecord,
  buildEnterpriseTemplateSendBody,
  decideEnterpriseBulkItemDispatch,
  decideEnterpriseBulkJobFinalization,
  decideEnterpriseBulkJobOperation,
  enterpriseBulkItemId,
  enterpriseBulkJobId,
  enterpriseBulkReceiptIdForWamid,
  enterpriseBulkRequestSha256,
  enterpriseDispatchDelayMs,
  readEnterpriseBulkJobResult,
  syntheticBulkWamid,
} from "../src/enterprise/contracts.js";

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const bulkError = (code: string) => (error: unknown) =>
  error instanceof EnterpriseBulkError && error.code === code;

const validRequest = {
  clientBatchId: "batch_demo_20260824_001",
  template: { templateName: "hemas_canary_hello" },
  items: [
    { to: "+94 77 123 4567", clientReference: "crm-0001" },
    { to: "94770000001", clientReference: "crm-0002" },
  ],
};

/* ------------------------------------------------------------------ */
/* Template selection                                                  */
/* ------------------------------------------------------------------ */

test("template selection defaults and validates against the catalogue", () => {
  const selection = assertEnterpriseTemplateSelection({ templateName: "hemas_canary_hello" });
  assert.deepEqual(selection, {
    templateName: "hemas_canary_hello",
    languageCode: "en_US",
    bodyParams: [],
    headerMedia: null,
    ctaSuffix: null,
    resolvedCtaUrl: null,
  });
  assert.throws(
    () => assertEnterpriseTemplateSelection({ templateName: "unknown_template" }),
    bulkError("invalid_template"),
  );
  assert.throws(
    () =>
      assertEnterpriseTemplateSelection({
        templateName: "hemas_canary_hello",
        languageCode: "si_LK",
      }),
    bulkError("invalid_template"),
  );
  assert.throws(
    () =>
      assertEnterpriseTemplateSelection({
        templateName: "hemas_canary_hello",
        unexpected: true,
      }),
    bulkError("invalid_template"),
  );
});

test("body parameters must match the descriptor count exactly", () => {
  const selection = assertEnterpriseTemplateSelection({
    templateName: "hemas_wellness_reminder",
    bodyParams: [" Amara "],
  });
  assert.deepEqual(selection.bodyParams, ["Amara"]);
  assert.throws(
    () => assertEnterpriseTemplateSelection({ templateName: "hemas_wellness_reminder" }),
    bulkError("invalid_variables"),
  );
  assert.throws(
    () =>
      assertEnterpriseTemplateSelection({
        templateName: "hemas_wellness_reminder",
        bodyParams: ["a", "b"],
      }),
    bulkError("invalid_variables"),
  );
  assert.throws(
    () =>
      assertEnterpriseTemplateSelection({
        templateName: "hemas_wellness_reminder",
        bodyParams: ["bad\u0000param"],
      }),
    bulkError("invalid_variables"),
  );
  assert.throws(
    () =>
      assertEnterpriseTemplateSelection({
        templateName: "hemas_wellness_reminder",
        bodyParams: ["p".repeat(257)],
      }),
    bulkError("invalid_variables"),
  );
});

test("media headers are accepted exactly where the descriptor declares them", () => {
  const selection = assertEnterpriseTemplateSelection({
    templateName: "hemas_welcome_visual",
    headerMedia: {
      kind: "image",
      mimeType: "image/png",
      sizeBytes: 100_000,
      link: "https://cdn.hemas-connect.example/media/welcome.png",
    },
  });
  assert.equal(selection.headerMedia?.kind, "image");
  assert.throws(
    () => assertEnterpriseTemplateSelection({ templateName: "hemas_welcome_visual" }),
    bulkError("invalid_template"),
  );
  assert.throws(
    () =>
      assertEnterpriseTemplateSelection({
        templateName: "hemas_welcome_visual",
        headerMedia: {
          kind: "document",
          mimeType: "application/pdf",
          sizeBytes: 100_000,
          link: "https://cdn.hemas-connect.example/media/welcome.pdf",
        },
      }),
    bulkError("invalid_template"),
  );
  assert.throws(
    () =>
      assertEnterpriseTemplateSelection({
        templateName: "hemas_canary_hello",
        headerMedia: {
          kind: "image",
          mimeType: "image/png",
          sizeBytes: 100_000,
          link: "https://cdn.hemas-connect.example/media/welcome.png",
        },
      }),
    bulkError("invalid_template"),
  );
});

test("dynamic CTA suffixes are accepted exactly where declared and resolve", () => {
  const selection = assertEnterpriseTemplateSelection({
    templateName: "hemas_visit_summary_cta",
    bodyParams: ["Amara"],
    ctaSuffix: "visits/v-2026-08-0042",
  });
  assert.equal(selection.ctaSuffix, "visits/v-2026-08-0042");
  assert.equal(
    selection.resolvedCtaUrl,
    "https://demo.hemas-connect.example/visit/visits/v-2026-08-0042",
  );
  assert.throws(
    () =>
      assertEnterpriseTemplateSelection({
        templateName: "hemas_visit_summary_cta",
        bodyParams: ["Amara"],
      }),
    bulkError("invalid_template"),
  );
  assert.throws(
    () =>
      assertEnterpriseTemplateSelection({
        templateName: "hemas_canary_hello",
        ctaSuffix: "visits/v-2026-08-0042",
      }),
    bulkError("invalid_template"),
  );
});

test("the send body carries header, body and dynamic URL button components", () => {
  const selection = assertEnterpriseTemplateSelection({
    templateName: "hemas_lab_report_ready",
    bodyParams: ["LAB-2026-0812"],
    headerMedia: {
      kind: "document",
      mimeType: "application/pdf",
      sizeBytes: 250_000,
      link: "https://cdn.hemas-connect.example/media/report.pdf",
    },
    ctaSuffix: "reports/r-0042",
  });
  assert.deepEqual(buildEnterpriseTemplateSendBody(selection), {
    type: "template",
    template: {
      name: "hemas_lab_report_ready",
      language: { code: "en_US" },
      components: [
        {
          type: "header",
          parameters: [
            {
              type: "document",
              document: { link: "https://cdn.hemas-connect.example/media/report.pdf" },
            },
          ],
        },
        {
          type: "body",
          parameters: [{ type: "text", text: "LAB-2026-0812" }],
        },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: "reports/r-0042" }],
        },
      ],
    },
  });
  const bare = buildEnterpriseTemplateSendBody(
    assertEnterpriseTemplateSelection({ templateName: "hemas_canary_hello" }),
  );
  assert.deepEqual(bare, {
    type: "template",
    template: { name: "hemas_canary_hello", language: { code: "en_US" } },
  });
});

/* ------------------------------------------------------------------ */
/* Intake                                                              */
/* ------------------------------------------------------------------ */

test("identifier grammars are strict", () => {
  assert.equal(
    assertEnterpriseIdempotencyKey(" bulk-2026-08-24-0001 "),
    "bulk-2026-08-24-0001",
  );
  assert.throws(() => assertEnterpriseIdempotencyKey("short"), bulkError("invalid_idempotency_key"));
  assert.throws(
    () => assertEnterpriseIdempotencyKey("x".repeat(129)),
    bulkError("invalid_idempotency_key"),
  );
  assert.equal(assertEnterpriseClientBatchId("batch_001"), "batch_001");
  assert.throws(() => assertEnterpriseClientBatchId("short"), bulkError("invalid_client_batch_id"));
  assert.equal(assertEnterpriseClientReference("crm:0001"), "crm:0001");
  assert.throws(
    () => assertEnterpriseClientReference("bad reference"),
    bulkError("invalid_client_reference"),
  );
});

test("bulk intake normalizes recipients into a content-free item set", () => {
  const input = assertEnterpriseBulkJobRequest(validRequest, sha256Hex);
  assert.equal(input.clientBatchId, "batch_demo_20260824_001");
  assert.equal(input.items.length, 2);
  const [first] = input.items;
  assert.equal(first!.toDigits, "94771234567");
  assert.equal(first!.toNumberLast4, "4567");
  assert.equal(first!.toNumberSha256, sha256Hex("enterprise-recipient:94771234567"));
  assert.equal(first!.clientReference, "crm-0001");
});

test("bulk intake rejects malformed envelopes and items", () => {
  assert.throws(() => assertEnterpriseBulkJobRequest(null, sha256Hex), bulkError("invalid_request"));
  assert.throws(
    () => assertEnterpriseBulkJobRequest({ ...validRequest, extra: 1 }, sha256Hex),
    bulkError("invalid_request"),
  );
  assert.throws(
    () => assertEnterpriseBulkJobRequest({ ...validRequest, items: [] }, sha256Hex),
    bulkError("invalid_items"),
  );
  assert.throws(
    () =>
      assertEnterpriseBulkJobRequest(
        {
          ...validRequest,
          items: [{ to: "+94771234567", clientReference: "crm-0001", note: "x" }],
        },
        sha256Hex,
      ),
    bulkError("invalid_items"),
  );
  assert.throws(
    () =>
      assertEnterpriseBulkJobRequest(
        { ...validRequest, items: [{ to: "not-a-number", clientReference: "crm-0001" }] },
        sha256Hex,
      ),
    bulkError("invalid_recipient"),
  );
});

test("oversized batches are rejected, never truncated", () => {
  const items = Array.from({ length: ENTERPRISE_BULK_MAX_ITEMS + 1 }, (_, index) => ({
    to: `9477${String(1_000_000 + index)}`,
    clientReference: `crm-${index}`,
  }));
  assert.throws(
    () => assertEnterpriseBulkJobRequest({ ...validRequest, items }, sha256Hex),
    bulkError("batch_too_large"),
  );
  const exactly = assertEnterpriseBulkJobRequest(
    { ...validRequest, items: items.slice(0, ENTERPRISE_BULK_MAX_ITEMS) },
    sha256Hex,
  );
  assert.equal(exactly.items.length, ENTERPRISE_BULK_MAX_ITEMS);
});

test("duplicate recipients and references are conflicts even across formats", () => {
  assert.throws(
    () =>
      assertEnterpriseBulkJobRequest(
        {
          ...validRequest,
          items: [
            { to: "+94 77 123 4567", clientReference: "crm-0001" },
            { to: "94771234567", clientReference: "crm-0002" },
          ],
        },
        sha256Hex,
      ),
    bulkError("duplicate_recipient"),
  );
  assert.throws(
    () =>
      assertEnterpriseBulkJobRequest(
        {
          ...validRequest,
          items: [
            { to: "+94771234567", clientReference: "crm-0001" },
            { to: "+94770000001", clientReference: "crm-0001" },
          ],
        },
        sha256Hex,
      ),
    bulkError("duplicate_client_reference"),
  );
});

/* ------------------------------------------------------------------ */
/* Identifiers and binding                                             */
/* ------------------------------------------------------------------ */

test("identifiers are deterministic, prefixed and content-free", () => {
  const jobId = enterpriseBulkJobId(ENTERPRISE_WORKSPACE_ID, "bulk-2026-08-24-0001", sha256Hex);
  assert.match(jobId, /^bulkjob_[0-9a-f]{24}$/);
  assert.equal(
    jobId,
    enterpriseBulkJobId(ENTERPRISE_WORKSPACE_ID, "bulk-2026-08-24-0001", sha256Hex),
  );
  const itemId = enterpriseBulkItemId(jobId, sha256Hex("enterprise-recipient:94771234567"), sha256Hex);
  assert.match(itemId, /^bulkitem_[0-9a-f]{28}$/);
  assert.match(
    enterpriseBulkReceiptIdForWamid("wamid.SYN-abc12345", sha256Hex),
    /^bulkreceipt_[0-9a-f]{32}$/,
  );
  assert.match(syntheticBulkWamid(jobId, itemId, sha256Hex), /^wamid\.SYN-[0-9a-f]{24}$/);
});

test("the request digest is order-independent for items and binds the CTA", () => {
  const base = assertEnterpriseBulkJobRequest(validRequest, sha256Hex);
  const reordered = assertEnterpriseBulkJobRequest(
    { ...validRequest, items: [...validRequest.items].reverse() },
    sha256Hex,
  );
  assert.equal(
    enterpriseBulkRequestSha256(base, sha256Hex),
    enterpriseBulkRequestSha256(reordered, sha256Hex),
  );
  const cta = assertEnterpriseBulkJobRequest(
    {
      ...validRequest,
      template: {
        templateName: "hemas_visit_summary_cta",
        bodyParams: ["Amara"],
        ctaSuffix: "visits/a",
      },
    },
    sha256Hex,
  );
  const ctaChanged = assertEnterpriseBulkJobRequest(
    {
      ...validRequest,
      template: {
        templateName: "hemas_visit_summary_cta",
        bodyParams: ["Amara"],
        ctaSuffix: "visits/b",
      },
    },
    sha256Hex,
  );
  assert.notEqual(
    enterpriseBulkRequestSha256(cta, sha256Hex),
    enterpriseBulkRequestSha256(ctaChanged, sha256Hex),
  );
});

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

test("ledger records are content-free; only the secret pair holds digits", () => {
  const input = assertEnterpriseBulkJobRequest(validRequest, sha256Hex);
  const jobId = enterpriseBulkJobId(ENTERPRISE_WORKSPACE_ID, "bulk-2026-08-24-0001", sha256Hex);
  const job = buildEnterpriseBulkJobRecord({
    jobId,
    workspaceId: ENTERPRISE_WORKSPACE_ID,
    actorUid: "uid_admin",
    idempotencyKey: "bulk-2026-08-24-0001",
    requestSha256: enterpriseBulkRequestSha256(input, sha256Hex),
    clientBatchId: input.clientBatchId,
    template: input.template,
    itemCount: input.items.length,
  });
  assert.equal(job.status, "accepted");
  assert.equal(job.queuedCount, 2);
  assert.equal(JSON.stringify(job).includes("94771234567"), false);

  const item = input.items[0]!;
  const itemId = enterpriseBulkItemId(jobId, item.toNumberSha256, sha256Hex);
  const itemRecord = buildEnterpriseBulkItemRecord({
    itemId,
    workspaceId: ENTERPRISE_WORKSPACE_ID,
    jobId,
    clientBatchId: input.clientBatchId,
    item,
  });
  assert.equal(itemRecord.status, "queued");
  assert.equal("toDigits" in itemRecord, false);
  assert.equal(JSON.stringify(itemRecord).includes("94771234567"), false);
  assert.equal(itemRecord.toNumberLast4, "4567");

  const secret = buildEnterpriseBulkItemSecretRecord({
    itemId,
    workspaceId: ENTERPRISE_WORKSPACE_ID,
    jobId,
    toDigits: item.toDigits,
  });
  assert.equal(secret.toDigits, "94771234567");
  assert.equal(secret.id, itemId);

  const receipt = buildEnterpriseBulkReceiptRecord({
    receiptId: enterpriseBulkReceiptIdForWamid("wamid.SYN-abc12345", sha256Hex),
    workspaceId: ENTERPRISE_WORKSPACE_ID,
    jobId,
    itemId,
    clientBatchId: input.clientBatchId,
    clientReference: item.clientReference,
    toNumberLast4: item.toNumberLast4,
  });
  assert.equal(receipt.deliveryStatus, "sent");
  assert.equal(JSON.stringify(receipt).includes("94771234567"), false);
});

/* ------------------------------------------------------------------ */
/* Idempotency decision                                                */
/* ------------------------------------------------------------------ */

const expectedOperation = {
  jobId: "bulkjob_" + "a".repeat(24),
  actorUid: "uid_admin",
  idempotencyKey: "bulk-2026-08-24-0001",
  requestSha256: "b".repeat(64),
};

function jobRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: expectedOperation.jobId,
    actorUid: expectedOperation.actorUid,
    idempotencyKey: expectedOperation.idempotencyKey,
    requestSha256: expectedOperation.requestSha256,
    clientBatchId: "batch_demo_20260824_001",
    status: "completed",
    itemCount: 2,
    queuedCount: 0,
    sentCount: 2,
    notSentCount: 0,
    suppressedCount: 0,
    ...overrides,
  };
}

test("missing jobs reserve; identical replays return the recorded result", () => {
  assert.deepEqual(decideEnterpriseBulkJobOperation(undefined, expectedOperation), {
    kind: "reserve",
  });
  const replay = decideEnterpriseBulkJobOperation(jobRecord(), expectedOperation);
  assert.equal(replay.kind, "replay");
  if (replay.kind === "replay") {
    assert.equal(replay.result.status, "completed");
    assert.equal(replay.result.sentCount, 2);
    assert.equal(replay.result.idempotent, true);
  }
  const active = decideEnterpriseBulkJobOperation(
    jobRecord({ status: "dispatching", queuedCount: 1, sentCount: 1 }),
    expectedOperation,
  );
  assert.equal(active.kind, "replay");
});

test("divergent replays conflict and malformed evidence fails closed", () => {
  assert.throws(
    () =>
      decideEnterpriseBulkJobOperation(
        jobRecord({ requestSha256: "c".repeat(64) }),
        expectedOperation,
      ),
    bulkError("operation_conflict"),
  );
  assert.throws(
    () => decideEnterpriseBulkJobOperation(jobRecord({ status: "weird" }), expectedOperation),
    bulkError("invalid_evidence"),
  );
  assert.throws(
    () => readEnterpriseBulkJobResult(jobRecord({ sentCount: 5 }), false),
    bulkError("invalid_evidence"),
  );
});

/* ------------------------------------------------------------------ */
/* Dispatch decisions                                                  */
/* ------------------------------------------------------------------ */

const dispatchExpected = {
  itemId: "bulkitem_" + "d".repeat(28),
  jobId: "bulkjob_" + "a".repeat(24),
  nowMs: 1_750_000_000_000,
};

function itemRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: dispatchExpected.itemId,
    jobId: dispatchExpected.jobId,
    clientReference: "crm-0001",
    toNumberSha256: "e".repeat(64),
    status: "queued",
    ...overrides,
  };
}

const timestampOf = (ms: number) => ({ toMillis: () => ms });

test("dispatch decisions honour terminal, active and stale boundaries", () => {
  assert.deepEqual(decideEnterpriseBulkItemDispatch(itemRecord(), dispatchExpected), {
    kind: "dispatch",
  });
  for (const status of ["sent", "not_sent", "suppressed"]) {
    assert.deepEqual(
      decideEnterpriseBulkItemDispatch(itemRecord({ status }), dispatchExpected),
      { kind: "skip_terminal" },
    );
  }
  assert.deepEqual(
    decideEnterpriseBulkItemDispatch(
      itemRecord({ status: "sending", updatedAt: timestampOf(dispatchExpected.nowMs - 1_000) }),
      dispatchExpected,
    ),
    { kind: "skip_active" },
  );
  assert.deepEqual(
    decideEnterpriseBulkItemDispatch(
      itemRecord({
        status: "sending",
        updatedAt: timestampOf(dispatchExpected.nowMs - ENTERPRISE_BULK_DISPATCH_STALE_MS),
      }),
      dispatchExpected,
    ),
    { kind: "recover_stale" },
  );
  assert.throws(
    () => decideEnterpriseBulkItemDispatch(itemRecord({ id: "other" }), dispatchExpected),
    bulkError("invalid_evidence"),
  );
  assert.throws(
    () => decideEnterpriseBulkItemDispatch(itemRecord({ status: "weird" }), dispatchExpected),
    bulkError("invalid_evidence"),
  );
});

test("dispatch pacing spreads a pass under the configured capacity", () => {
  assert.equal(enterpriseDispatchDelayMs(0, 20), 0);
  assert.equal(enterpriseDispatchDelayMs(20, 20), 1_000);
  assert.equal(enterpriseDispatchDelayMs(5, 0), Math.floor((5 / ENTERPRISE_BULK_DEFAULT_DISPATCH_MPS) * 1_000));
  assert.throws(() => enterpriseDispatchDelayMs(-1, 20), bulkError("invalid_evidence"));
});

test("job finalization is exact about remaining and failed work", () => {
  const base = {
    itemCount: 4,
    queuedCount: 0,
    sendingCount: 0,
    sentCount: 4,
    notSentCount: 0,
    suppressedCount: 0,
  };
  assert.equal(decideEnterpriseBulkJobFinalization(base), "completed");
  assert.equal(
    decideEnterpriseBulkJobFinalization({ ...base, sentCount: 3, notSentCount: 1 }),
    "completed_partial",
  );
  assert.equal(
    decideEnterpriseBulkJobFinalization({ ...base, sentCount: 3, suppressedCount: 1 }),
    "completed_partial",
  );
  assert.equal(
    decideEnterpriseBulkJobFinalization({ ...base, sentCount: 3, queuedCount: 1 }),
    "dispatching",
  );
  assert.equal(
    decideEnterpriseBulkJobFinalization({ ...base, sentCount: 3, sendingCount: 1 }),
    "dispatching",
  );
  assert.throws(
    () => decideEnterpriseBulkJobFinalization({ ...base, sentCount: 5 }),
    bulkError("invalid_evidence"),
  );
});

test("the governed catalogue stays within Meta button and header rules", () => {
  for (const descriptor of ENTERPRISE_TEMPLATE_CATALOGUE) {
    assert.equal(descriptor.languageCode, "en_US");
    assert.ok(descriptor.bodyParamCount >= 0 && descriptor.bodyParamCount <= 3);
    if (descriptor.urlButton) {
      assert.ok(descriptor.urlButton.index === 0 || descriptor.urlButton.index === 1);
      assert.ok(descriptor.urlButton.baseUrl.startsWith("https://"));
      assert.ok(descriptor.urlButton.baseUrl.endsWith("/"));
      assert.ok(descriptor.urlButton.baseUrl.includes(".example/"));
    }
  }
});
