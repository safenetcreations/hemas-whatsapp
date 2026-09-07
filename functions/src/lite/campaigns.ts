/**
 * Hemas Lite — live bulk campaigns (pure contracts).
 *
 * Governance identical to the rest of the canary lane:
 * - Audience is ALWAYS the explicit ≤5-number canary allowlist — there is no
 *   way to address anyone else.
 * - Sends are approved TEMPLATES only (Meta's rule for business-initiated
 *   messages outside the 24h window).
 * - Stored records are content-free: campaign label, template name, hashed
 *   number + last4, provider id, delivery status. Never a message body.
 */

export const LITE_CAMPAIGNS_COLLECTION = "canary_campaigns";
export const LITE_CAMPAIGN_SENDS_COLLECTION = "canary_campaign_sends";
export const LITE_CAMPAIGN_RECIPIENT_OPERATIONS_COLLECTION =
  "canary_campaign_recipient_operations";
export const LITE_CAMPAIGN_RECONCILIATIONS_COLLECTION =
  "canary_campaign_reconciliations";
export const LITE_CAMPAIGN_SEND_STALE_MS = 5 * 60 * 1_000;

export class LiteCampaignError extends Error {
  constructor(
    readonly code:
      | "invalid_name"
      | "invalid_template"
      | "invalid_audience"
      | "empty_audience"
      | "invalid_operation"
      | "operation_conflict"
      | "operation_in_progress"
      | "operation_uncertain"
      | "invalid_evidence"
      | "reconciliation_conflict",
    message: string,
  ) {
    super(message);
    this.name = "LiteCampaignError";
  }
}

const LIVE_CONTACT_ID = /^contact_live_[0-9a-f]{10}$/;

export function assertCampaignContactIds(rawContactIds: unknown): readonly string[] {
  if (!Array.isArray(rawContactIds) || rawContactIds.length === 0) {
    throw new LiteCampaignError("empty_audience", "Select at least one captured canary contact.");
  }
  if (rawContactIds.length > 5) {
    throw new LiteCampaignError("invalid_audience", "A canary campaign is limited to five contacts.");
  }
  const requested = new Set<string>();
  for (const value of rawContactIds) {
    if (typeof value !== "string" || !LIVE_CONTACT_ID.test(value)) {
      throw new LiteCampaignError(
        "invalid_audience",
        "Campaign recipients must be opaque captured-contact references.",
      );
    }
    requested.add(value);
  }
  return [...requested];
}

/**
 * Resolve browser-safe contact ids against the server-owned recipient
 * allowlist. Raw phone values can never satisfy the opaque id contract.
 */
export function resolveAllowlistedContactAudience(
  rawContactIds: unknown,
  allowlist: readonly string[],
  contactIdForDigits: (digits: string) => string,
): readonly string[] {
  const requested = assertCampaignContactIds(rawContactIds);

  const allowlistedByContactId = new Map<string, string>();
  for (const entry of allowlist) {
    const digits = entry.replace(/\D/g, "");
    if (!digits) continue;
    allowlistedByContactId.set(contactIdForDigits(digits), digits);
  }

  const resolved: string[] = [];
  for (const contactId of requested) {
    const digits = allowlistedByContactId.get(contactId);
    if (!digits) {
      throw new LiteCampaignError(
        "invalid_audience",
        "A selected contact is not on the governed server allowlist.",
      );
    }
    resolved.push(digits);
  }
  return resolved;
}

/** Fail closed unless the captured contact carries a canonical unsuppressed state. */
export function isEligibleCanaryCampaignContact(
  raw: unknown,
  contactId: string,
  workspaceId: string,
): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const contact = raw as Record<string, unknown>;
  if (
    contact.id !== contactId ||
    contact.workspaceId !== workspaceId ||
    contact.synthetic !== true ||
    contact.liveCanary !== true
  ) {
    return false;
  }
  if (typeof contact.suppression !== "object" || contact.suppression === null) return false;
  const suppression = contact.suppression as Record<string, unknown>;
  const updatedAt = suppression.updatedAt as { toDate?: unknown } | undefined;
  if (
    !Array.isArray(suppression.reasons) ||
    typeof updatedAt !== "object" ||
    updatedAt === null ||
    typeof updatedAt.toDate !== "function" ||
    !Array.isArray(contact.tags) ||
    contact.tags.includes("marketing-suppressed")
  ) {
    return false;
  }
  return (
    suppression.suppressAll === false &&
    suppression.suppressMarketing === false &&
    suppression.invalidContact === false
  );
}

/** Campaign label: an operator-facing name, not message content. */
export function assertValidCampaignName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (name.length < 3 || name.length > 80 || !/^[\p{L}\p{N} .,'&()/-]+$/u.test(name)) {
    throw new LiteCampaignError(
      "invalid_name",
      "Campaign name must be 3–80 plain characters.",
    );
  }
  return name;
}

/** Meta template language codes: English "en", Sinhala "si_LK", Tamil "ta". */
export type LiteCampaignLanguageCode = "en_US" | "en" | "si_LK" | "ta";

export interface TemplateSelection {
  readonly templateName: string;
  readonly languageCode: LiteCampaignLanguageCode;
}

/**
 * Governed Lite campaign catalogue: exactly the (template, language) pairs the
 * portal may send. Each pair must exist as an APPROVED template on the canary
 * WABA under the same name and language code — the send path passes them to
 * Meta verbatim. The first language listed is the default when a caller omits
 * the language.
 */
export const LITE_CAMPAIGN_TEMPLATE_CATALOGUE = [
  { templateName: "hemas_canary_hello", languageCode: "en_US" },
  { templateName: "hemas_welcome_visual", languageCode: "en_US" },
  { templateName: "hemas_health_check_invite", languageCode: "en" },
  { templateName: "hemas_health_check_invite", languageCode: "si_LK" },
  { templateName: "hemas_health_check_invite", languageCode: "ta" },
  { templateName: "hemas_homecare_visit", languageCode: "en" },
  { templateName: "hemas_homecare_visit", languageCode: "si_LK" },
  { templateName: "hemas_homecare_visit", languageCode: "ta" },
] as const satisfies readonly TemplateSelection[];

/**
 * IMAGE-header templates need the header media supplied at send time. Each
 * entry names the environment variable that carries it: either a Meta media
 * ID (uploaded to the canary phone number) or an HTTPS link Meta fetches.
 * Templates absent from this map are text-only and need no header component.
 */
export const LITE_CAMPAIGN_IMAGE_HEADERS = Object.freeze({
  hemas_welcome_visual: { env: "HEMAS_META_WELCOME_MEDIA_ID", kind: "id" },
  hemas_homecare_visit: { env: "HEMAS_META_HOMECARE_IMAGE_URL", kind: "link" },
} as const satisfies Readonly<
  Record<string, { readonly env: string; readonly kind: "id" | "link" }>
>);

export type LiteCampaignHeaderComponent = {
  readonly type: "header";
  readonly parameters: readonly [
    { readonly type: "image"; readonly image: { readonly id: string } | { readonly link: string } },
  ];
};

const MEDIA_ID_PATTERN = /^\d{5,40}$/;
const HTTPS_IMAGE_LINK_PATTERN = /^https:\/\/[A-Za-z0-9.-]+(?::\d{2,5})?\/[^\s"'<>]{1,400}$/;

/**
 * Resolves the header component for a template, or null for text-only
 * templates. Throws LiteCampaignError("invalid_template") when an IMAGE-header
 * template has no usable media configured, so the operator sees one clear
 * pre-flight error instead of a campaign full of failed recipients.
 */
export function campaignHeaderComponent(
  templateName: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): LiteCampaignHeaderComponent | null {
  const header = (LITE_CAMPAIGN_IMAGE_HEADERS as Readonly<
    Record<string, { readonly env: string; readonly kind: "id" | "link" } | undefined>
  >)[templateName];
  if (!header) return null;
  const raw = env[header.env]?.trim() ?? "";
  if (header.kind === "id") {
    if (!MEDIA_ID_PATTERN.test(raw)) {
      throw new LiteCampaignError(
        "invalid_template",
        "This template needs its header image configured before it can be sent.",
      );
    }
    return { type: "header", parameters: [{ type: "image", image: { id: raw } }] };
  }
  if (!HTTPS_IMAGE_LINK_PATTERN.test(raw)) {
    throw new LiteCampaignError(
      "invalid_template",
      "This template needs its header image configured before it can be sent.",
    );
  }
  return { type: "header", parameters: [{ type: "image", image: { link: raw } }] };
}

export const LITE_CAMPAIGN_TEMPLATE_NAMES = [
  ...new Set(LITE_CAMPAIGN_TEMPLATE_CATALOGUE.map((entry) => entry.templateName)),
] as readonly string[];

export function assertTemplateSelection(
  templateName: unknown,
  languageCode: unknown,
): TemplateSelection {
  const name = typeof templateName === "string" ? templateName.trim() : "";
  const candidates = LITE_CAMPAIGN_TEMPLATE_CATALOGUE.filter(
    (entry) => entry.templateName === name,
  );
  const language =
    languageCode === undefined || languageCode === null
      ? candidates[0]?.languageCode
      : languageCode;
  const match = candidates.find((entry) => entry.languageCode === language);
  if (!match) {
    throw new LiteCampaignError(
      "invalid_template",
      "Template selection is not in the governed Lite campaign catalogue.",
    );
  }
  return { templateName: match.templateName, languageCode: match.languageCode };
}

export function assertCampaignOperationId(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!/^campaign_[A-Za-z0-9_-]{16,64}$/.test(value)) {
    throw new LiteCampaignError("invalid_operation", "Campaign operation id is invalid.");
  }
  return value;
}

export function campaignId(
  operationId: string,
  sha256Hex: (value: string) => string,
): string {
  return `camp_${sha256Hex(`lite-campaign:${operationId}`).slice(0, 20)}`;
}

export function campaignRecipientOperationId(
  campaign: string,
  contactId: string,
  sha256Hex: (value: string) => string,
): string {
  return `camp_recipient_${sha256Hex(`lite-campaign-recipient:${campaign}:${contactId}`).slice(0, 24)}`;
}

export function campaignReconciliationDocumentId(
  operationId: string,
  outcome: LiteCampaignReconciliationInput["outcome"],
  recipientOperationId: string | null,
  providerEvidenceSha256: string,
  sha256Hex: (value: string) => string,
): string {
  return `campaign_reconcile_${sha256Hex(
    [
      "lite-campaign-reconciliation",
      operationId,
      outcome,
      recipientOperationId ?? "none",
      providerEvidenceSha256,
    ].join(":"),
  ).slice(0, 32)}`;
}

export function campaignRequestSha256(
  input: {
    readonly operationId: string;
    readonly name: string;
    readonly templateName: string;
    readonly languageCode: string;
    readonly contactIds: readonly string[];
  },
  sha256Hex: (value: string) => string,
): string {
  const contactIds = [...new Set(input.contactIds)].sort();
  return sha256Hex(
    JSON.stringify([
      "hemas-lite-campaign-request:v1",
      input.operationId,
      input.name,
      input.templateName,
      input.languageCode,
      contactIds,
    ]),
  );
}

export interface LiteCampaignResult {
  readonly campaignId: string;
  readonly audience: number;
  readonly excluded: number;
  readonly sent: number;
  readonly failed: number;
  readonly idempotent: boolean;
}

export type LiteCampaignOperationDecision =
  | { readonly kind: "reserve" }
  | { readonly kind: "replay"; readonly result: LiteCampaignResult };

function operationRecord(raw: unknown): Record<string, unknown> | null {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;
}

/** Durable request binding used inside the Firestore reservation transaction. */
export function decideCampaignOperation(
  raw: unknown,
  expected: {
    readonly campaignId: string;
    readonly operationId: string;
    readonly actorUid: string;
    readonly requestSha256: string;
  },
): LiteCampaignOperationDecision {
  const operation = operationRecord(raw);
  if (!operation) return { kind: "reserve" };
  if (
    operation.id !== expected.campaignId ||
    operation.operationId !== expected.operationId ||
    operation.actorUid !== expected.actorUid ||
    operation.requestSha256 !== expected.requestSha256
  ) {
    throw new LiteCampaignError(
      "operation_conflict",
      "Campaign operation id is already bound to a different request.",
    );
  }
  if (operation.status === "sending") {
    throw new LiteCampaignError(
      "operation_in_progress",
      "Campaign operation is already sending and cannot be retried yet.",
    );
  }
  if (operation.status === "send_uncertain") {
    throw new LiteCampaignError(
      "operation_uncertain",
      "Campaign provider outcome is uncertain and requires reconciliation.",
    );
  }
  if (
    operation.status !== "sent" &&
    operation.status !== "completed_partial" &&
    operation.status !== "reconciled_halted"
  ) {
    throw new LiteCampaignError("invalid_evidence", "Campaign operation evidence is malformed.");
  }
  const audience = operation.audienceCount;
  const excluded = operation.excludedCount;
  const sent = operation.sentCount;
  const failed = operation.failedCount;
  if (
    !Number.isInteger(audience) ||
    !Number.isInteger(excluded) ||
    !Number.isInteger(sent) ||
    !Number.isInteger(failed) ||
    (audience as number) < 1 ||
    (excluded as number) < 0 ||
    (sent as number) < 0 ||
    (failed as number) < 0 ||
    (operation.status === "sent" && (sent !== audience || failed !== 0)) ||
    ((operation.status === "completed_partial" || operation.status === "reconciled_halted") &&
      ((failed as number) < 1 || (sent as number) + (failed as number) !== audience))
  ) {
    throw new LiteCampaignError(
      "invalid_evidence",
      "Completed campaign result evidence is malformed.",
    );
  }
  return {
    kind: "replay",
    result: {
      campaignId: expected.campaignId,
      audience: audience as number,
      excluded: excluded as number,
      sent: sent as number,
      failed: failed as number,
      idempotent: true,
    },
  };
}

export interface LiteCampaignReconciliationInput {
  readonly operationId: string;
  readonly requestSha256: string;
  readonly recipientOperationId: string | null;
  readonly outcome: "sent" | "not_sent" | "finalize_recorded" | "halt_reserved";
  readonly providerMessageId: string | null;
  readonly providerEvidenceSha256: string;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function providerMessageIdOrNull(raw: unknown): string | null {
  return typeof raw === "string" ? raw.trim() : null;
}

/** Exact evidence for either one ambiguous recipient or a stuck final summary. */
export function assertCampaignReconciliationInput(
  raw: unknown,
): LiteCampaignReconciliationInput {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new LiteCampaignError("invalid_evidence", "Campaign reconciliation evidence is required.");
  }
  const value = raw as Record<string, unknown>;
  const keys = [
    "operationId",
    "requestSha256",
    "recipientOperationId",
    "outcome",
    "providerMessageId",
    "providerEvidenceSha256",
  ] as const;
  if (!exactKeys(value, keys)) {
    throw new LiteCampaignError(
      "invalid_evidence",
      "Campaign reconciliation must contain the exact evidence fields.",
    );
  }
  const operationId = assertCampaignOperationId(value.operationId);
  const requestSha256 = typeof value.requestSha256 === "string" ? value.requestSha256.trim() : "";
  const providerEvidenceSha256 =
    typeof value.providerEvidenceSha256 === "string"
      ? value.providerEvidenceSha256.trim()
      : "";
  if (!/^[0-9a-f]{64}$/.test(requestSha256) || !/^[0-9a-f]{64}$/.test(providerEvidenceSha256)) {
    throw new LiteCampaignError(
      "invalid_evidence",
      "Campaign request and provider evidence must be SHA-256 digests.",
    );
  }
  if (
    value.outcome !== "sent" &&
    value.outcome !== "not_sent" &&
    value.outcome !== "finalize_recorded" &&
    value.outcome !== "halt_reserved"
  ) {
    throw new LiteCampaignError(
      "invalid_evidence",
      "Campaign provider outcome is invalid.",
    );
  }
  const recipientOperationId =
    typeof value.recipientOperationId === "string"
      ? value.recipientOperationId.trim()
      : null;
  const providerMessageId = providerMessageIdOrNull(value.providerMessageId);
  if (value.outcome === "finalize_recorded" || value.outcome === "halt_reserved") {
    if (recipientOperationId !== null || providerMessageId !== null) {
      throw new LiteCampaignError(
        "invalid_evidence",
        "Finalization evidence cannot name a recipient or provider message.",
      );
    }
  } else {
    if (!recipientOperationId || !/^camp_recipient_[0-9a-f]{24}$/.test(recipientOperationId)) {
      throw new LiteCampaignError(
        "invalid_evidence",
        "Campaign reconciliation needs one deterministic recipient operation.",
      );
    }
    if (
      (value.outcome === "sent" &&
        (providerMessageId === null ||
          providerMessageId.length < 8 ||
          providerMessageId.length > 512 ||
          !/^[A-Za-z0-9._:-]+$/.test(providerMessageId))) ||
      (value.outcome === "not_sent" && providerMessageId !== null)
    ) {
      throw new LiteCampaignError(
        "invalid_evidence",
        "Campaign provider message evidence does not match the outcome.",
      );
    }
  }
  return {
    operationId,
    requestSha256,
    recipientOperationId,
    outcome: value.outcome,
    providerMessageId,
    providerEvidenceSha256,
  };
}

export type LiteCampaignReconciliationDecision =
  | {
      readonly kind: "apply";
      readonly targetOperationId: string | null;
      readonly targetStatus: "sent" | "not_sent" | null;
      readonly haltOperationIds: readonly string[];
      readonly status: "sent" | "completed_partial" | "reconciled_halted";
      readonly result: LiteCampaignResult;
    }
  | { readonly kind: "already_reconciled"; readonly result: LiteCampaignResult };

function millis(raw: unknown): number | null {
  if (typeof raw !== "object" || raw === null) return null;
  const toMillis = (raw as { toMillis?: unknown }).toMillis;
  if (typeof toMillis !== "function") return null;
  const value = (toMillis as () => unknown).call(raw);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Plan a terminal, evidence-only campaign resolution. Remaining reserved
 * recipients are explicitly marked not_sent; reconciliation never resumes the
 * send loop or grants another provider attempt.
 */
export function decideCampaignReconciliation(
  rawCampaign: unknown,
  rawRecipients: readonly unknown[],
  input: LiteCampaignReconciliationInput,
  expected: {
    readonly campaignId: string;
    readonly workspaceId: string;
    readonly nowMs: number;
    readonly sha256Hex: (value: string) => string;
  },
): LiteCampaignReconciliationDecision {
  const campaign = operationRecord(rawCampaign);
  if (
    !campaign ||
    campaign.id !== expected.campaignId ||
    campaign.workspaceId !== expected.workspaceId ||
    campaign.operationId !== input.operationId ||
    campaign.requestSha256 !== input.requestSha256 ||
    typeof campaign.actorUid !== "string" ||
    !campaign.actorUid ||
    !Number.isInteger(campaign.audienceCount) ||
    (campaign.audienceCount as number) < 1 ||
    (campaign.audienceCount as number) > 5 ||
    !Number.isInteger(campaign.excludedCount) ||
    (campaign.excludedCount as number) < 0 ||
    !Number.isInteger(campaign.sentCount) ||
    (campaign.sentCount as number) < 0 ||
    !Number.isInteger(campaign.failedCount) ||
    (campaign.failedCount as number) < 0
  ) {
    throw new LiteCampaignError(
      "invalid_evidence",
      "Campaign operation evidence is missing or malformed.",
    );
  }

  const recipients = rawRecipients.map(operationRecord);
  if (recipients.some((recipient) => recipient === null)) {
    throw new LiteCampaignError("invalid_evidence", "Campaign recipient evidence is malformed.");
  }
  const records = recipients as Record<string, unknown>[];
  if (records.length !== campaign.audienceCount) {
    throw new LiteCampaignError("invalid_evidence", "Campaign recipient evidence is incomplete.");
  }
  const ids = new Set<string>();
  for (const recipient of records) {
    if (
      typeof recipient.id !== "string" ||
      ids.has(recipient.id) ||
      recipient.workspaceId !== expected.workspaceId ||
      recipient.campaignId !== expected.campaignId ||
      recipient.campaignOperationId !== input.operationId ||
      recipient.requestSha256 !== input.requestSha256 ||
      typeof recipient.contactId !== "string" ||
      !/^contact_live_[0-9a-f]{10}$/.test(recipient.contactId) ||
      recipient.id !==
        campaignRecipientOperationId(
          expected.campaignId,
          recipient.contactId,
          expected.sha256Hex,
        ) ||
      typeof recipient.toNumberSha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(recipient.toNumberSha256) ||
      typeof recipient.toNumberLast4 !== "string" ||
      !/^\d{4}$/.test(recipient.toNumberLast4) ||
      (recipient.status !== "reserved" &&
        recipient.status !== "sending" &&
        recipient.status !== "send_uncertain" &&
        recipient.status !== "sent" &&
        recipient.status !== "not_sent")
    ) {
      throw new LiteCampaignError(
        "invalid_evidence",
        "Campaign recipient evidence does not match its reservation.",
      );
    }
    ids.add(recipient.id);
  }

  const terminal =
    campaign.status === "sent" ||
    campaign.status === "completed_partial" ||
    campaign.status === "reconciled_halted";
  if (terminal) {
    const sent = campaign.sentCount as number;
    const failed = campaign.failedCount;
    const terminalEvidenceMatches =
      Number.isInteger(failed) &&
      campaign.reconciliationOutcome === input.outcome &&
      campaign.reconciliationRequestSha256 === input.requestSha256 &&
      campaign.reconciliationRecipientOperationId === input.recipientOperationId &&
      campaign.reconciliationEvidenceSha256 === input.providerEvidenceSha256 &&
      campaign.reconciliationProviderMessageId === input.providerMessageId &&
      ((campaign.status === "sent" && sent === campaign.audienceCount && failed === 0) ||
        ((campaign.status === "completed_partial" || campaign.status === "reconciled_halted") &&
          (failed as number) > 0 &&
          sent + (failed as number) === campaign.audienceCount));
    if (!terminalEvidenceMatches) {
      throw new LiteCampaignError(
        "reconciliation_conflict",
        "Campaign already has different terminal evidence.",
      );
    }
    return {
      kind: "already_reconciled",
      result: {
        campaignId: expected.campaignId,
        audience: campaign.audienceCount as number,
        excluded: campaign.excludedCount as number,
        sent,
        failed: failed as number,
        idempotent: true,
      },
    };
  }
  if (campaign.status !== "sending" && campaign.status !== "send_uncertain") {
    throw new LiteCampaignError("invalid_evidence", "Campaign operation is not reconcilable.");
  }

  const sentRecords = records.filter((recipient) => recipient.status === "sent");
  const failedRecords = records.filter((recipient) => recipient.status === "not_sent");
  if (
    sentRecords.length !== campaign.sentCount ||
    failedRecords.length !== campaign.failedCount
  ) {
    throw new LiteCampaignError(
      "invalid_evidence",
      "Campaign summary and recipient evidence counts do not match.",
    );
  }

  if (input.outcome === "finalize_recorded") {
    if (sentRecords.length + failedRecords.length !== records.length) {
      throw new LiteCampaignError(
        "invalid_evidence",
        "Campaign finalization requires every recipient outcome to be recorded.",
      );
    }
    if (campaign.status === "sending") {
      const updatedAtMs = millis(campaign.updatedAt);
      if (updatedAtMs === null || updatedAtMs > expected.nowMs - LITE_CAMPAIGN_SEND_STALE_MS) {
        throw new LiteCampaignError(
          "operation_in_progress",
          "Campaign may still be finalizing; wait for the stale-send boundary.",
        );
      }
    }
    return {
      kind: "apply",
      targetOperationId: null,
      targetStatus: null,
      haltOperationIds: [],
      status: failedRecords.length === 0 ? "sent" : "completed_partial",
      result: {
        campaignId: expected.campaignId,
        audience: records.length,
        excluded: campaign.excludedCount as number,
        sent: sentRecords.length,
        failed: failedRecords.length,
        idempotent: false,
      },
    };
  }

  if (input.outcome === "halt_reserved") {
    const activeRecords = records.filter(
      (recipient) => recipient.status === "sending" || recipient.status === "send_uncertain",
    );
    const reservedRecords = records.filter((recipient) => recipient.status === "reserved");
    const updatedAtMs = millis(campaign.updatedAt);
    if (
      campaign.status !== "sending" ||
      activeRecords.length !== 0 ||
      reservedRecords.length === 0 ||
      sentRecords.length + failedRecords.length + reservedRecords.length !== records.length ||
      updatedAtMs === null ||
      updatedAtMs > expected.nowMs - LITE_CAMPAIGN_SEND_STALE_MS
    ) {
      throw new LiteCampaignError(
        "operation_in_progress",
        "Campaign reservations are not yet a stale, safely haltable set.",
      );
    }
    return {
      kind: "apply",
      targetOperationId: null,
      targetStatus: null,
      haltOperationIds: reservedRecords
        .map((recipient) => recipient.id as string)
        .sort(),
      status: "reconciled_halted",
      result: {
        campaignId: expected.campaignId,
        audience: records.length,
        excluded: campaign.excludedCount as number,
        sent: sentRecords.length,
        failed: records.length - sentRecords.length,
        idempotent: false,
      },
    };
  }

  const target = records.find((recipient) => recipient.id === input.recipientOperationId);
  if (!target || (target.status !== "sending" && target.status !== "send_uncertain")) {
    throw new LiteCampaignError(
      "invalid_evidence",
      "The selected campaign recipient is not awaiting provider reconciliation.",
    );
  }
  const active = records.filter(
    (recipient) => recipient.status === "sending" || recipient.status === "send_uncertain",
  );
  if (
    active.length !== 1 ||
    active[0]?.id !== target.id ||
    records.some(
      (recipient) =>
        recipient.id !== target.id &&
        recipient.status !== "sent" &&
        recipient.status !== "reserved" &&
        recipient.status !== "not_sent",
    ) ||
    (campaign.status === "send_uncertain" &&
      campaign.uncertainRecipientOperationId !== target.id)
  ) {
    throw new LiteCampaignError(
      "invalid_evidence",
      "Campaign recipient states are not a single reconcilable send boundary.",
    );
  }
  if (target.status === "sending") {
    const updatedAtMs = millis(target.updatedAt);
    if (updatedAtMs === null || updatedAtMs > expected.nowMs - LITE_CAMPAIGN_SEND_STALE_MS) {
      throw new LiteCampaignError(
        "operation_in_progress",
        "Campaign recipient may still be sending; wait for the stale-send boundary.",
      );
    }
  }
  const haltOperationIds = records
    .filter((recipient) => recipient.status === "reserved")
    .map((recipient) => recipient.id as string)
    .sort();
  const sent = sentRecords.length + (input.outcome === "sent" ? 1 : 0);
  const failed = records.length - sent;
  return {
    kind: "apply",
    targetOperationId: target.id as string,
    targetStatus: input.outcome,
    haltOperationIds,
    status: failed === 0 ? "sent" : "reconciled_halted",
    result: {
      campaignId: expected.campaignId,
      audience: records.length,
      excluded: campaign.excludedCount as number,
      sent,
      failed,
      idempotent: false,
    },
  };
}

/** Send-record id derived from the provider message id so webhook `statuses`
 *  events can address the record directly (sha, never the raw wamid). */
export function sendDocIdForWamid(wamid: string, sha256Hex: (v: string) => string): string {
  return `send_${sha256Hex(`wamid:${wamid}`).slice(0, 32)}`;
}

export function sendDocIdForFailure(
  campaign: string,
  toDigits: string,
  sha256Hex: (v: string) => string,
): string {
  return `send_${sha256Hex(`fail:${campaign}:${toDigits}`).slice(0, 32)}`;
}

const STATUS_RANK: Record<string, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

/** Delivery events arrive out of order — only advance, never downgrade. */
export function shouldAdvanceSendStatus(previous: unknown, next: string): boolean {
  const nextRank = STATUS_RANK[next];
  if (nextRank === undefined) return false;
  const previousRank =
    typeof previous === "string" && previous in STATUS_RANK ? STATUS_RANK[previous]! : -1;
  return nextRank > previousRank;
}

/** Extract (wamid, status) pairs from a webhook payload's `statuses` events. */
export function extractDeliveryStatusEvents(
  payload: unknown,
): Array<{ wamid: string; status: string }> {
  const out: Array<{ wamid: string; status: string }> = [];
  const root = payload as {
    entry?: Array<{
      changes?: Array<{ value?: { statuses?: Array<{ id?: string; status?: string }> } }>;
    }>;
  };
  for (const entry of root.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const event of change.value?.statuses ?? []) {
        if (
          typeof event.id === "string" &&
          event.id.length > 0 &&
          typeof event.status === "string" &&
          event.status in STATUS_RANK
        ) {
          out.push({ wamid: event.id, status: event.status });
        }
      }
    }
  }
  return out.slice(0, 50);
}
