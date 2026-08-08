import { deterministicBucket, deterministicId } from "../deterministic.js";
import { assertSafeTenantId } from "../errors.js";
import type { SupportedLanguage } from "./messages.js";

export const MAX_SYNTHETIC_CAMPAIGN_RECIPIENTS = 50_000;

export type SyntheticCampaignOutcome = "suppressed" | "failed" | "sent" | "delivered" | "read";

export interface SyntheticCampaignSpec {
  readonly tenantId: string;
  readonly campaignId: string;
  readonly recipientCount: number;
  readonly seed: string;
}

export interface SyntheticCampaignRecipient {
  readonly recipientId: string;
  readonly syntheticContactId: string;
  readonly language: SupportedLanguage;
  readonly outcome: SyntheticCampaignOutcome;
  readonly providerMessageId: string | null;
  readonly simulated: true;
}

export interface SyntheticCampaignSummary {
  readonly tenantId: string;
  readonly campaignId: string;
  readonly total: number;
  readonly eligible: number;
  readonly suppressed: number;
  readonly accepted: number;
  readonly sent: number;
  readonly delivered: number;
  readonly read: number;
  readonly failed: number;
  readonly networkCalls: 0;
  readonly simulated: true;
}

const LANGUAGES: readonly SupportedLanguage[] = ["en", "si", "ta"];

function validateSpec(spec: SyntheticCampaignSpec): void {
  assertSafeTenantId(spec.tenantId);
  if (!spec.campaignId.trim()) throw new TypeError("campaignId is required");
  if (
    !Number.isSafeInteger(spec.recipientCount) ||
    spec.recipientCount < 1 ||
    spec.recipientCount > MAX_SYNTHETIC_CAMPAIGN_RECIPIENTS
  ) {
    throw new RangeError(`recipientCount must be between 1 and ${MAX_SYNTHETIC_CAMPAIGN_RECIPIENTS}`);
  }
  if (spec.seed.length < 8) throw new TypeError("seed must contain at least 8 characters");
}

export function syntheticCampaignRecipientAt(
  spec: SyntheticCampaignSpec,
  index: number,
): SyntheticCampaignRecipient {
  validateSpec(spec);
  if (!Number.isSafeInteger(index) || index < 0 || index >= spec.recipientCount) {
    throw new RangeError("recipient index is outside the campaign");
  }

  const identity = `${spec.seed}:${spec.tenantId}:${spec.campaignId}:${index}`;
  const bucket = deterministicBucket(identity, 1_000);
  const outcome: SyntheticCampaignOutcome =
    bucket < 20 ? "suppressed" :
      bucket < 50 ? "failed" :
        bucket < 150 ? "sent" :
          bucket < 600 ? "delivered" : "read";
  const language = LANGUAGES[deterministicBucket(`${identity}:language`, LANGUAGES.length)] ?? "en";

  return {
    recipientId: deterministicId("synthetic-recipient", identity),
    syntheticContactId: deterministicId("synthetic-contact", `${spec.seed}:${index}`),
    language,
    outcome,
    providerMessageId: outcome === "suppressed"
      ? null
      : deterministicId("synthetic-wamid", `${identity}:provider`),
    simulated: true,
  };
}

export function* generateSyntheticCampaignRecipients(
  spec: SyntheticCampaignSpec,
): Generator<SyntheticCampaignRecipient> {
  validateSpec(spec);
  for (let index = 0; index < spec.recipientCount; index += 1) {
    yield syntheticCampaignRecipientAt(spec, index);
  }
}

export function summarizeSyntheticCampaign(spec: SyntheticCampaignSpec): SyntheticCampaignSummary {
  validateSpec(spec);
  let suppressed = 0;
  let failed = 0;
  let sentOnly = 0;
  let deliveredOnly = 0;
  let read = 0;

  for (const recipient of generateSyntheticCampaignRecipients(spec)) {
    switch (recipient.outcome) {
      case "suppressed": suppressed += 1; break;
      case "failed": failed += 1; break;
      case "sent": sentOnly += 1; break;
      case "delivered": deliveredOnly += 1; break;
      case "read": read += 1; break;
    }
  }

  const accepted = sentOnly + deliveredOnly + read;
  return {
    tenantId: spec.tenantId,
    campaignId: spec.campaignId,
    total: spec.recipientCount,
    eligible: spec.recipientCount - suppressed,
    suppressed,
    accepted,
    sent: accepted,
    delivered: deliveredOnly + read,
    read,
    failed,
    networkCalls: 0,
    simulated: true,
  };
}
