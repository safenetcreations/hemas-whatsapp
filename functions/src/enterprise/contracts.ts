/**
 * Hemas Connect ENTERPRISE — bulk gateway pure contracts.
 *
 * Implements the "many-to-many Bulk API" shape proposed in the Enterprise
 * technical proof pack as a governed, testable contract:
 * - A bulk job accepts up to 1,000 recipient items in ONE validated intake,
 *   then fans out as individually ledgered provider sends. There is no
 *   recipient-array provider call; Meta documents one `to` per send.
 * - Every mutation carries a required idempotency key; identical replays
 *   return the original job result, divergent replays are conflicts.
 * - The stored ledger is content-free: hashed recipient + last4, template
 *   name, opaque client_reference, provider id, delivery status. Raw digits
 *   exist only in the paired server-only secret record that the dispatch
 *   runner consumes, mirroring the contact/laboratory secret-split pattern.
 * - Dispatch is synthetic-provider only in this codebase. A live bulk lane
 *   deliberately does not exist until the Enterprise Technical Addendum
 *   authorizes one; the engine must fail closed with
 *   `live_dispatch_unavailable` on any non-synthetic mode.
 *
 * Everything in this file is pure and deterministic so the governance rules
 * are testable without Firebase.
 */

import { normalizeE164 } from "../meta-canary/contracts.js";
import {
  EnterpriseMediaError,
  assertDynamicCtaSuffix,
  assertEnterpriseMediaDescriptor,
  isTemplateHeaderMediaKind,
  resolveDynamicCtaUrl,
  type EnterpriseMediaDescriptor,
  type EnterpriseTemplateHeaderMediaKind,
} from "./media.js";

export const ENTERPRISE_WORKSPACE_ID = "workspace_safenet_demo" as const;
export const ENTERPRISE_BULK_JOBS_COLLECTION = "enterprise_bulk_jobs" as const;
export const ENTERPRISE_BULK_JOB_ITEMS_COLLECTION = "enterprise_bulk_job_items" as const;
export const ENTERPRISE_BULK_ITEM_SECRETS_COLLECTION =
  "enterprise_bulk_item_secrets" as const;
export const ENTERPRISE_BULK_SEND_RECEIPTS_COLLECTION =
  "enterprise_bulk_send_receipts" as const;

export const ENTERPRISE_BULK_MIN_ITEMS = 1;
/** Proposed intake maximum from the proof pack; a gateway limit, not Meta's. */
export const ENTERPRISE_BULK_MAX_ITEMS = 1_000;
/** Items dispatched per runner pass; keeps every pass well under quota. */
export const ENTERPRISE_BULK_DISPATCH_BATCH_SIZE = 50;
/** A `sending` item older than this may be reconciled as stale. */
export const ENTERPRISE_BULK_DISPATCH_STALE_MS = 5 * 60 * 1_000;
/** Conservative provider pacing floor (coexistence-number capacity). */
export const ENTERPRISE_BULK_DEFAULT_DISPATCH_MPS = 20;

export type EnterpriseBulkErrorCode =
  | "invalid_request"
  | "invalid_idempotency_key"
  | "invalid_client_batch_id"
  | "invalid_template"
  | "invalid_items"
  | "batch_too_large"
  | "invalid_recipient"
  | "duplicate_recipient"
  | "invalid_client_reference"
  | "duplicate_client_reference"
  | "invalid_variables"
  | "operation_conflict"
  | "operation_in_progress"
  | "invalid_evidence"
  | "job_not_found"
  | "authentication_required"
  | "forbidden"
  | "live_dispatch_unavailable";

export class EnterpriseBulkError extends Error {
  constructor(
    readonly code: EnterpriseBulkErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EnterpriseBulkError";
  }
}

/* ------------------------------------------------------------------ */
/* Template catalogue                                                  */
/* ------------------------------------------------------------------ */

export interface EnterpriseTemplateUrlButton {
  readonly index: 0 | 1;
  readonly baseUrl: string;
  readonly dynamicSuffix: boolean;
}

export interface EnterpriseTemplateDescriptor {
  readonly name: string;
  readonly languageCode: "en_US";
  readonly bodyParamCount: number;
  readonly headerMedia: "none" | EnterpriseTemplateHeaderMediaKind;
  readonly urlButton: EnterpriseTemplateUrlButton | null;
}

/**
 * Governed catalogue. Base URLs use the reserved `.example` TLD so no send
 * can reference a live property until the Addendum swaps the catalogue.
 */
export const ENTERPRISE_TEMPLATE_CATALOGUE: readonly EnterpriseTemplateDescriptor[] = [
  {
    name: "hemas_canary_hello",
    languageCode: "en_US",
    bodyParamCount: 0,
    headerMedia: "none",
    urlButton: null,
  },
  {
    name: "hemas_welcome_visual",
    languageCode: "en_US",
    bodyParamCount: 0,
    headerMedia: "image",
    urlButton: null,
  },
  {
    name: "hemas_wellness_reminder",
    languageCode: "en_US",
    bodyParamCount: 1,
    headerMedia: "none",
    urlButton: null,
  },
  {
    name: "hemas_visit_summary_cta",
    languageCode: "en_US",
    bodyParamCount: 1,
    headerMedia: "none",
    urlButton: {
      index: 0,
      baseUrl: "https://demo.hemas-connect.example/visit/",
      dynamicSuffix: true,
    },
  },
  {
    name: "hemas_lab_report_ready",
    languageCode: "en_US",
    bodyParamCount: 1,
    headerMedia: "document",
    urlButton: {
      index: 0,
      baseUrl: "https://demo.hemas-connect.example/report/",
      dynamicSuffix: true,
    },
  },
] as const;

export function enterpriseTemplateDescriptor(name: string): EnterpriseTemplateDescriptor | null {
  return ENTERPRISE_TEMPLATE_CATALOGUE.find((template) => template.name === name) ?? null;
}

export interface EnterpriseTemplateSelection {
  readonly templateName: string;
  readonly languageCode: "en_US";
  readonly bodyParams: readonly string[];
  readonly headerMedia: EnterpriseMediaDescriptor | null;
  readonly ctaSuffix: string | null;
  /** Resolved full CTA URL, for evidence surfaces only — never stored per item. */
  readonly resolvedCtaUrl: string | null;
}

const BODY_PARAM_PATTERN = /^[^\u0000-\u001F\u007F]{1,256}$/;

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function optionalKeysOnly(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

/**
 * Validate a template selection against the governed catalogue: media header
 * and dynamic CTA suffix are each accepted exactly when the descriptor
 * declares them, never as free-form extras.
 */
export function assertEnterpriseTemplateSelection(raw: unknown): EnterpriseTemplateSelection {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new EnterpriseBulkError("invalid_template", "Template selection is required.");
  }
  const value = raw as Record<string, unknown>;
  if (
    !optionalKeysOnly(value, ["templateName"], [
      "languageCode",
      "bodyParams",
      "headerMedia",
      "ctaSuffix",
    ])
  ) {
    throw new EnterpriseBulkError(
      "invalid_template",
      "Template selection contains unsupported fields.",
    );
  }
  const name = typeof value.templateName === "string" ? value.templateName.trim() : "";
  const descriptor = enterpriseTemplateDescriptor(name);
  if (!descriptor) {
    throw new EnterpriseBulkError(
      "invalid_template",
      "Template is not in the governed Enterprise catalogue.",
    );
  }
  const language =
    value.languageCode === undefined || value.languageCode === null
      ? "en_US"
      : value.languageCode;
  if (language !== descriptor.languageCode) {
    throw new EnterpriseBulkError("invalid_template", "Template language is not supported.");
  }

  const rawParams = value.bodyParams === undefined ? [] : value.bodyParams;
  if (!Array.isArray(rawParams)) {
    throw new EnterpriseBulkError("invalid_variables", "Template bodyParams must be an array.");
  }
  if (rawParams.length !== descriptor.bodyParamCount) {
    throw new EnterpriseBulkError(
      "invalid_variables",
      `Template ${descriptor.name} requires exactly ${descriptor.bodyParamCount} body parameter(s).`,
    );
  }
  const bodyParams = rawParams.map((param) => {
    const text = typeof param === "string" ? param.trim() : "";
    if (!BODY_PARAM_PATTERN.test(text)) {
      throw new EnterpriseBulkError(
        "invalid_variables",
        "Body parameters must be 1-256 control-character-free characters.",
      );
    }
    return text;
  });

  let headerMedia: EnterpriseMediaDescriptor | null = null;
  if (descriptor.headerMedia === "none") {
    if (value.headerMedia !== undefined && value.headerMedia !== null) {
      throw new EnterpriseBulkError(
        "invalid_template",
        `Template ${descriptor.name} does not accept a media header.`,
      );
    }
  } else {
    try {
      headerMedia = assertEnterpriseMediaDescriptor(value.headerMedia);
    } catch (error) {
      if (error instanceof EnterpriseMediaError) {
        throw new EnterpriseBulkError("invalid_template", error.message);
      }
      throw error;
    }
    if (
      !isTemplateHeaderMediaKind(headerMedia.kind) ||
      headerMedia.kind !== descriptor.headerMedia
    ) {
      throw new EnterpriseBulkError(
        "invalid_template",
        `Template ${descriptor.name} requires a ${descriptor.headerMedia} header.`,
      );
    }
  }

  let ctaSuffix: string | null = null;
  let resolvedCtaUrl: string | null = null;
  if (!descriptor.urlButton || !descriptor.urlButton.dynamicSuffix) {
    if (value.ctaSuffix !== undefined && value.ctaSuffix !== null) {
      throw new EnterpriseBulkError(
        "invalid_template",
        `Template ${descriptor.name} does not accept a dynamic CTA suffix.`,
      );
    }
  } else {
    try {
      ctaSuffix = assertDynamicCtaSuffix(value.ctaSuffix);
      resolvedCtaUrl = resolveDynamicCtaUrl(descriptor.urlButton.baseUrl, ctaSuffix);
    } catch (error) {
      if (error instanceof EnterpriseMediaError) {
        throw new EnterpriseBulkError("invalid_template", error.message);
      }
      throw error;
    }
  }

  return {
    templateName: descriptor.name,
    languageCode: descriptor.languageCode,
    bodyParams,
    headerMedia,
    ctaSuffix,
    resolvedCtaUrl,
  };
}

/**
 * WhatsApp template send body with header media, body parameters and the
 * dynamic-URL button parameter, exactly as Meta's message API expects.
 */
export function buildEnterpriseTemplateSendBody(
  selection: EnterpriseTemplateSelection,
): Record<string, unknown> {
  const descriptor = enterpriseTemplateDescriptor(selection.templateName);
  if (!descriptor) {
    throw new EnterpriseBulkError("invalid_template", "Template is not in the catalogue.");
  }
  const components: Record<string, unknown>[] = [];
  if (selection.headerMedia) {
    components.push({
      type: "header",
      parameters: [
        {
          type: selection.headerMedia.kind,
          [selection.headerMedia.kind]: { link: selection.headerMedia.link },
        },
      ],
    });
  }
  if (selection.bodyParams.length > 0) {
    components.push({
      type: "body",
      parameters: selection.bodyParams.map((text) => ({ type: "text", text })),
    });
  }
  if (descriptor.urlButton && descriptor.urlButton.dynamicSuffix && selection.ctaSuffix) {
    components.push({
      type: "button",
      sub_type: "url",
      index: String(descriptor.urlButton.index),
      parameters: [{ type: "text", text: selection.ctaSuffix }],
    });
  }
  const template: Record<string, unknown> = {
    name: selection.templateName,
    language: { code: selection.languageCode },
  };
  if (components.length > 0) {
    template.components = components;
  }
  return { type: "template", template };
}

/* ------------------------------------------------------------------ */
/* Intake validation                                                   */
/* ------------------------------------------------------------------ */

export function assertEnterpriseIdempotencyKey(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(value)) {
    throw new EnterpriseBulkError(
      "invalid_idempotency_key",
      "Idempotency-Key must be 16-128 characters of [A-Za-z0-9._:-].",
    );
  }
  return value;
}

export function assertEnterpriseClientBatchId(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!/^[A-Za-z0-9._-]{8,64}$/.test(value)) {
    throw new EnterpriseBulkError(
      "invalid_client_batch_id",
      "client_batch_id must be 8-64 characters of [A-Za-z0-9._-].",
    );
  }
  return value;
}

export function assertEnterpriseClientReference(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    throw new EnterpriseBulkError(
      "invalid_client_reference",
      "client_reference must be 1-128 characters of [A-Za-z0-9._:-].",
    );
  }
  return value;
}

export interface EnterpriseBulkItemInput {
  /** Normalized E.164 digits — transient request memory, never stored. */
  readonly toDigits: string;
  readonly toNumberSha256: string;
  readonly toNumberLast4: string;
  readonly clientReference: string;
}

export interface EnterpriseBulkJobInput {
  readonly clientBatchId: string;
  readonly template: EnterpriseTemplateSelection;
  readonly items: readonly EnterpriseBulkItemInput[];
}

/**
 * Exact intake contract for POST /v1/whatsapp/bulk-jobs. Oversized batches
 * and duplicates are rejected, never truncated or silently deduplicated.
 */
export function assertEnterpriseBulkJobRequest(
  raw: unknown,
  sha256Hex: (value: string) => string,
): EnterpriseBulkJobInput {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new EnterpriseBulkError("invalid_request", "A bulk job request body is required.");
  }
  const value = raw as Record<string, unknown>;
  if (!exactKeys(value, ["clientBatchId", "template", "items"])) {
    throw new EnterpriseBulkError(
      "invalid_request",
      "Bulk job requests must contain exactly clientBatchId, template and items.",
    );
  }
  const clientBatchId = assertEnterpriseClientBatchId(value.clientBatchId);
  const template = assertEnterpriseTemplateSelection(value.template);

  if (!Array.isArray(value.items) || value.items.length < ENTERPRISE_BULK_MIN_ITEMS) {
    throw new EnterpriseBulkError("invalid_items", "Bulk jobs require at least one item.");
  }
  if (value.items.length > ENTERPRISE_BULK_MAX_ITEMS) {
    throw new EnterpriseBulkError(
      "batch_too_large",
      `Bulk jobs accept at most ${ENTERPRISE_BULK_MAX_ITEMS} items.`,
    );
  }

  const seenRecipients = new Set<string>();
  const seenReferences = new Set<string>();
  const items: EnterpriseBulkItemInput[] = [];
  for (const rawItem of value.items) {
    if (typeof rawItem !== "object" || rawItem === null || Array.isArray(rawItem)) {
      throw new EnterpriseBulkError("invalid_items", "Every bulk item must be an object.");
    }
    const item = rawItem as Record<string, unknown>;
    if (!exactKeys(item, ["to", "clientReference"])) {
      throw new EnterpriseBulkError(
        "invalid_items",
        "Bulk items must contain exactly to and clientReference.",
      );
    }
    const toDigits = normalizeE164(typeof item.to === "string" ? item.to : undefined);
    if (!toDigits) {
      throw new EnterpriseBulkError(
        "invalid_recipient",
        "Every bulk item requires a valid E.164 recipient.",
      );
    }
    if (seenRecipients.has(toDigits)) {
      throw new EnterpriseBulkError(
        "duplicate_recipient",
        "Bulk jobs cannot address the same recipient twice.",
      );
    }
    seenRecipients.add(toDigits);
    const clientReference = assertEnterpriseClientReference(item.clientReference);
    if (seenReferences.has(clientReference)) {
      throw new EnterpriseBulkError(
        "duplicate_client_reference",
        "Bulk jobs cannot reuse a client_reference.",
      );
    }
    seenReferences.add(clientReference);
    items.push({
      toDigits,
      toNumberSha256: sha256Hex(`enterprise-recipient:${toDigits}`),
      toNumberLast4: toDigits.slice(-4),
      clientReference,
    });
  }

  return { clientBatchId, template, items };
}

/* ------------------------------------------------------------------ */
/* Deterministic identifiers and request binding                       */
/* ------------------------------------------------------------------ */

export function enterpriseBulkJobId(
  workspaceId: string,
  idempotencyKey: string,
  sha256Hex: (value: string) => string,
): string {
  return `bulkjob_${sha256Hex(`enterprise-bulk-job:${workspaceId}:${idempotencyKey}`).slice(0, 24)}`;
}

export function enterpriseBulkItemId(
  jobId: string,
  toNumberSha256: string,
  sha256Hex: (value: string) => string,
): string {
  return `bulkitem_${sha256Hex(`enterprise-bulk-item:${jobId}:${toNumberSha256}`).slice(0, 28)}`;
}

/** O(1) DLR routing: receipts are keyed by hashed provider message id. */
export function enterpriseBulkReceiptIdForWamid(
  wamid: string,
  sha256Hex: (value: string) => string,
): string {
  return `bulkreceipt_${sha256Hex(`enterprise-wamid:${wamid}`).slice(0, 32)}`;
}

/** Deterministic synthetic provider message id for the demo dispatch lane. */
export function syntheticBulkWamid(
  jobId: string,
  itemId: string,
  sha256Hex: (value: string) => string,
): string {
  return `wamid.SYN-${sha256Hex(`enterprise-synthetic:${jobId}:${itemId}`).slice(0, 24)}`;
}

/**
 * Canonical request digest binding an idempotency key to one exact payload.
 * Recipient digits enter only as their stored hashes.
 */
export function enterpriseBulkRequestSha256(
  input: EnterpriseBulkJobInput,
  sha256Hex: (value: string) => string,
): string {
  const items = [...input.items]
    .map((item) => [item.toNumberSha256, item.clientReference])
    .sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
  return sha256Hex(
    JSON.stringify([
      "hemas-enterprise-bulk-job:v1",
      input.clientBatchId,
      input.template.templateName,
      input.template.languageCode,
      input.template.bodyParams,
      input.template.headerMedia
        ? [
            input.template.headerMedia.kind,
            input.template.headerMedia.mimeType,
            input.template.headerMedia.sizeBytes,
            input.template.headerMedia.link,
          ]
        : null,
      input.template.ctaSuffix,
      items,
    ]),
  );
}

/* ------------------------------------------------------------------ */
/* Job and item records                                                */
/* ------------------------------------------------------------------ */

export type EnterpriseBulkJobStatus =
  | "accepted"
  | "dispatching"
  | "completed"
  | "completed_partial";

export type EnterpriseBulkItemStatus =
  | "queued"
  | "sending"
  | "sent"
  | "not_sent"
  | "suppressed";

export interface EnterpriseBulkJobResult {
  readonly jobId: string;
  readonly clientBatchId: string;
  readonly status: EnterpriseBulkJobStatus;
  readonly itemCount: number;
  readonly queuedCount: number;
  readonly sentCount: number;
  readonly notSentCount: number;
  readonly suppressedCount: number;
  readonly idempotent: boolean;
}

export function buildEnterpriseBulkJobRecord(input: {
  readonly jobId: string;
  readonly workspaceId: string;
  readonly actorUid: string;
  readonly idempotencyKey: string;
  readonly requestSha256: string;
  readonly clientBatchId: string;
  readonly template: EnterpriseTemplateSelection;
  readonly itemCount: number;
}): Record<string, unknown> {
  return {
    id: input.jobId,
    workspaceId: input.workspaceId,
    actorUid: input.actorUid,
    idempotencyKey: input.idempotencyKey,
    requestSha256: input.requestSha256,
    clientBatchId: input.clientBatchId,
    templateName: input.template.templateName,
    languageCode: input.template.languageCode,
    headerMediaKind: input.template.headerMedia?.kind ?? null,
    ctaSuffix: input.template.ctaSuffix,
    status: "accepted" satisfies EnterpriseBulkJobStatus,
    itemCount: input.itemCount,
    // queuedCount counts every non-terminal item (queued + sending) so the
    // externally published counts always sum to itemCount; sendingCount is
    // the internal in-flight tracker used for finalization.
    queuedCount: input.itemCount,
    sendingCount: 0,
    sentCount: 0,
    notSentCount: 0,
    suppressedCount: 0,
    itemsMaterialized: false,
    containsMessageContent: false,
    synthetic: true,
  };
}

export function buildEnterpriseBulkItemRecord(input: {
  readonly itemId: string;
  readonly workspaceId: string;
  readonly jobId: string;
  readonly clientBatchId: string;
  readonly item: EnterpriseBulkItemInput;
}): Record<string, unknown> {
  return {
    id: input.itemId,
    workspaceId: input.workspaceId,
    jobId: input.jobId,
    clientBatchId: input.clientBatchId,
    toNumberSha256: input.item.toNumberSha256,
    toNumberLast4: input.item.toNumberLast4,
    clientReference: input.item.clientReference,
    status: "queued" satisfies EnterpriseBulkItemStatus,
    attemptCount: 0,
    providerMessageId: null,
    deliveryStatus: null,
    failureCode: null,
    containsMessageContent: false,
    synthetic: true,
  };
}

/** Paired server-only secret consumed by the dispatch runner; never client-readable. */
export function buildEnterpriseBulkItemSecretRecord(input: {
  readonly itemId: string;
  readonly workspaceId: string;
  readonly jobId: string;
  readonly toDigits: string;
}): Record<string, unknown> {
  return {
    id: input.itemId,
    workspaceId: input.workspaceId,
    jobId: input.jobId,
    toDigits: input.toDigits,
    synthetic: true,
  };
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;
}

export type EnterpriseBulkJobOperationDecision =
  | { readonly kind: "reserve" }
  | { readonly kind: "replay"; readonly result: EnterpriseBulkJobResult };

/**
 * Durable idempotency decision made inside the reservation transaction:
 * identical replays return the recorded result, divergent replays conflict,
 * active jobs refuse a concurrent retry.
 */
export function decideEnterpriseBulkJobOperation(
  raw: unknown,
  expected: {
    readonly jobId: string;
    readonly actorUid: string;
    readonly idempotencyKey: string;
    readonly requestSha256: string;
  },
): EnterpriseBulkJobOperationDecision {
  const job = asRecord(raw);
  if (!job) return { kind: "reserve" };
  if (
    job.id !== expected.jobId ||
    job.actorUid !== expected.actorUid ||
    job.idempotencyKey !== expected.idempotencyKey ||
    job.requestSha256 !== expected.requestSha256
  ) {
    throw new EnterpriseBulkError(
      "operation_conflict",
      "Idempotency-Key is already bound to a different bulk request.",
    );
  }
  if (job.status === "accepted" || job.status === "dispatching") {
    return {
      kind: "replay",
      result: readEnterpriseBulkJobResult(job, true),
    };
  }
  if (job.status !== "completed" && job.status !== "completed_partial") {
    throw new EnterpriseBulkError("invalid_evidence", "Bulk job evidence is malformed.");
  }
  return { kind: "replay", result: readEnterpriseBulkJobResult(job, true) };
}

/** Strict projection of a job document into the API result shape. */
export function readEnterpriseBulkJobResult(
  raw: unknown,
  idempotent: boolean,
): EnterpriseBulkJobResult {
  const job = asRecord(raw);
  if (
    !job ||
    typeof job.id !== "string" ||
    typeof job.clientBatchId !== "string" ||
    (job.status !== "accepted" &&
      job.status !== "dispatching" &&
      job.status !== "completed" &&
      job.status !== "completed_partial") ||
    !Number.isInteger(job.itemCount) ||
    !Number.isInteger(job.queuedCount) ||
    !Number.isInteger(job.sentCount) ||
    !Number.isInteger(job.notSentCount) ||
    !Number.isInteger(job.suppressedCount) ||
    (job.itemCount as number) < 1 ||
    (job.queuedCount as number) < 0 ||
    (job.sentCount as number) < 0 ||
    (job.notSentCount as number) < 0 ||
    (job.suppressedCount as number) < 0 ||
    (job.queuedCount as number) +
        (job.sentCount as number) +
        (job.notSentCount as number) +
        (job.suppressedCount as number) !==
      (job.itemCount as number)
  ) {
    throw new EnterpriseBulkError("invalid_evidence", "Bulk job evidence is malformed.");
  }
  return {
    jobId: job.id,
    clientBatchId: job.clientBatchId,
    status: job.status as EnterpriseBulkJobStatus,
    itemCount: job.itemCount as number,
    queuedCount: job.queuedCount as number,
    sentCount: job.sentCount as number,
    notSentCount: job.notSentCount as number,
    suppressedCount: job.suppressedCount as number,
    idempotent,
  };
}

/* ------------------------------------------------------------------ */
/* Dispatch state machine                                              */
/* ------------------------------------------------------------------ */

export type EnterpriseBulkItemDispatchDecision =
  | { readonly kind: "dispatch" }
  | { readonly kind: "skip_terminal" }
  | { readonly kind: "skip_active" }
  | { readonly kind: "recover_stale" };

function timestampMillis(raw: unknown): number | null {
  if (typeof raw !== "object" || raw === null) return null;
  const toMillis = (raw as { toMillis?: unknown }).toMillis;
  if (typeof toMillis !== "function") return null;
  const value = (toMillis as () => unknown).call(raw);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Per-item claim decision made inside the dispatch transaction. A stale
 * `sending` item is only ever recovered as `not_sent`; the runner never
 * grants a second provider attempt for the same item.
 */
export function decideEnterpriseBulkItemDispatch(
  raw: unknown,
  expected: { readonly itemId: string; readonly jobId: string; readonly nowMs: number },
): EnterpriseBulkItemDispatchDecision {
  const item = asRecord(raw);
  if (
    !item ||
    item.id !== expected.itemId ||
    item.jobId !== expected.jobId ||
    typeof item.clientReference !== "string" ||
    typeof item.toNumberSha256 !== "string"
  ) {
    throw new EnterpriseBulkError("invalid_evidence", "Bulk item evidence is malformed.");
  }
  if (item.status === "sent" || item.status === "not_sent" || item.status === "suppressed") {
    return { kind: "skip_terminal" };
  }
  if (item.status === "queued") {
    return { kind: "dispatch" };
  }
  if (item.status !== "sending") {
    throw new EnterpriseBulkError("invalid_evidence", "Bulk item status is malformed.");
  }
  const updatedAtMs = timestampMillis(item.updatedAt);
  if (updatedAtMs !== null && updatedAtMs <= expected.nowMs - ENTERPRISE_BULK_DISPATCH_STALE_MS) {
    return { kind: "recover_stale" };
  }
  return { kind: "skip_active" };
}

/**
 * Millisecond offset before dispatching the item at `index`, pacing a runner
 * pass under the configured messages-per-second capacity.
 */
export function enterpriseDispatchDelayMs(index: number, mps: number): number {
  if (!Number.isInteger(index) || index < 0) {
    throw new EnterpriseBulkError("invalid_evidence", "Dispatch index must be a non-negative integer.");
  }
  const capacity = Number.isInteger(mps) && mps >= 1 ? mps : ENTERPRISE_BULK_DEFAULT_DISPATCH_MPS;
  return Math.floor((index / capacity) * 1_000);
}

/**
 * Terminal job summary after a runner pass: completed only when every item
 * reached a terminal state and none failed or was suppressed.
 */
export function decideEnterpriseBulkJobFinalization(counts: {
  readonly itemCount: number;
  readonly queuedCount: number;
  readonly sendingCount: number;
  readonly sentCount: number;
  readonly notSentCount: number;
  readonly suppressedCount: number;
}): EnterpriseBulkJobStatus {
  const {
    itemCount,
    queuedCount,
    sendingCount,
    sentCount,
    notSentCount,
    suppressedCount,
  } = counts;
  if (
    [itemCount, queuedCount, sendingCount, sentCount, notSentCount, suppressedCount].some(
      (value) => !Number.isInteger(value) || value < 0,
    ) ||
    itemCount < 1 ||
    queuedCount + sendingCount + sentCount + notSentCount + suppressedCount !== itemCount
  ) {
    throw new EnterpriseBulkError("invalid_evidence", "Bulk job counts are malformed.");
  }
  if (queuedCount > 0 || sendingCount > 0) {
    return "dispatching";
  }
  return notSentCount + suppressedCount === 0 ? "completed" : "completed_partial";
}

/** Content-free receipt mapping a provider message id back to its ledger row. */
export function buildEnterpriseBulkReceiptRecord(input: {
  readonly receiptId: string;
  readonly workspaceId: string;
  readonly jobId: string;
  readonly itemId: string;
  readonly clientBatchId: string;
  readonly clientReference: string;
  readonly toNumberLast4: string;
}): Record<string, unknown> {
  return {
    id: input.receiptId,
    workspaceId: input.workspaceId,
    jobId: input.jobId,
    itemId: input.itemId,
    clientBatchId: input.clientBatchId,
    clientReference: input.clientReference,
    toNumberLast4: input.toNumberLast4,
    deliveryStatus: "sent",
    synthetic: true,
  };
}
