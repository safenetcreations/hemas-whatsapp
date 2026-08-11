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

export class LiteCampaignError extends Error {
  constructor(
    readonly code: "invalid_name" | "invalid_template" | "empty_audience",
    message: string,
  ) {
    super(message);
    this.name = "LiteCampaignError";
  }
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

export interface TemplateSelection {
  readonly templateName: string;
  readonly languageCode: string;
}

export function assertTemplateSelection(
  templateName: unknown,
  languageCode: unknown,
  fallbackTemplate: string,
  fallbackLanguage: string,
): TemplateSelection {
  const name =
    typeof templateName === "string" && templateName.trim()
      ? templateName.trim()
      : fallbackTemplate;
  const language =
    typeof languageCode === "string" && languageCode.trim()
      ? languageCode.trim()
      : fallbackLanguage;
  if (!/^[a-z0-9_]{1,120}$/.test(name) || !/^[A-Za-z_]{2,10}$/.test(language)) {
    throw new LiteCampaignError(
      "invalid_template",
      "Template selection failed strict validation.",
    );
  }
  return { templateName: name, languageCode: language };
}

export function campaignId(name: string, nowMs: number, sha256Hex: (v: string) => string): string {
  return `camp_${sha256Hex(`${name}:${nowMs}`).slice(0, 12)}`;
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
