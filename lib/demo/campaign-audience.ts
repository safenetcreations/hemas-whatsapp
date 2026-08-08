import {
  entityId,
  hmacDigest,
  type CampaignRecipientId,
  type ContactId,
  type HmacDigest,
  type SupportedLanguage,
} from "../domain/primitives";
import type { CampaignExclusionReason } from "../domain/campaigns";

export const SYNTHETIC_CAMPAIGN_SIZE = 50_000;
export const SYNTHETIC_CAMPAIGN_SEED = 20_260_807;

export interface SyntheticAudienceMember {
  readonly ordinal: number;
  readonly recipientId: CampaignRecipientId;
  readonly contactId: ContactId;
  readonly deterministicHmacId: HmacDigest;
  readonly preferredLanguage: SupportedLanguage;
  readonly eligible: boolean;
  readonly exclusionReason: CampaignExclusionReason | null;
}

export interface SyntheticAudienceSummary {
  readonly totalEvaluated: number;
  readonly eligibleCount: number;
  readonly excludedCount: number;
  readonly unknownConsentCount: number;
  readonly exclusionsByReason: Readonly<Partial<Record<CampaignExclusionReason, number>>>;
  readonly languageCounts: Readonly<Record<SupportedLanguage, number>>;
}

function mixSeed(seed: number, ordinal: number): number {
  let value = (seed ^ Math.imul(ordinal + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  value ^= value >>> 16;
  return value >>> 0;
}

/** Synthetic only. This is a stable 64-character fixture digest, not a security primitive. */
function fixtureDigest(seed: number, ordinal: number): HmacDigest {
  const blocks: string[] = [];
  for (let block = 0; block < 8; block += 1) {
    blocks.push(mixSeed(seed + block * 7919, ordinal).toString(16).padStart(8, "0"));
  }
  return hmacDigest(blocks.join(""));
}

function languageFor(value: number): SupportedLanguage {
  const bucket = value % 100;
  if (bucket < 54) return "en";
  if (bucket < 78) return "si";
  return "ta";
}

function exclusionFor(ordinal: number): CampaignExclusionReason | null {
  // Ordered precedence mirrors eligibility processing: contact validity, suppression,
  // consent, deduplication, frequency cap, then language availability.
  if (ordinal % 113 === 0) return "invalid_contact";
  if (ordinal % 17 === 0) return "suppressed";
  if (ordinal % 13 === 0) return "consent_missing";
  if (ordinal % 97 === 0) return "duplicate";
  if (ordinal % 11 === 0) return "frequency_cap";
  if (ordinal % 131 === 0) return "language_unavailable";
  return null;
}

export function syntheticAudienceMember(
  ordinal: number,
  seed = SYNTHETIC_CAMPAIGN_SEED,
): SyntheticAudienceMember {
  if (!Number.isInteger(ordinal) || ordinal < 0) {
    throw new Error("Synthetic audience ordinal must be a non-negative integer.");
  }

  const suffix = String(ordinal + 1).padStart(6, "0");
  const exclusionReason = exclusionFor(ordinal + 1);

  return {
    ordinal,
    recipientId: entityId<"CampaignRecipient">(`campaign_recipient_synthetic_${suffix}`),
    contactId: entityId<"Contact">(`contact_synthetic_campaign_${suffix}`),
    deterministicHmacId: fixtureDigest(seed, ordinal),
    preferredLanguage: languageFor(mixSeed(seed, ordinal)),
    eligible: exclusionReason === null,
    exclusionReason,
  };
}

/**
 * Produces a bounded page for queue simulation. No phone number, person name or
 * clinical data is generated.
 */
export function generateSyntheticAudienceChunk(input: {
  readonly offset: number;
  readonly limit: number;
  readonly total?: number;
  readonly seed?: number;
}): readonly SyntheticAudienceMember[] {
  const total = input.total ?? SYNTHETIC_CAMPAIGN_SIZE;
  const seed = input.seed ?? SYNTHETIC_CAMPAIGN_SEED;

  if (!Number.isInteger(input.offset) || input.offset < 0) {
    throw new Error("Chunk offset must be a non-negative integer.");
  }
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 1_000) {
    throw new Error("Chunk limit must be between 1 and 1,000.");
  }
  if (!Number.isInteger(total) || total < 0) {
    throw new Error("Synthetic audience total must be a non-negative integer.");
  }

  const end = Math.min(input.offset + input.limit, total);
  const members: SyntheticAudienceMember[] = [];
  for (let ordinal = input.offset; ordinal < end; ordinal += 1) {
    members.push(syntheticAudienceMember(ordinal, seed));
  }
  return members;
}

export function summarizeSyntheticAudience(
  total = SYNTHETIC_CAMPAIGN_SIZE,
  seed = SYNTHETIC_CAMPAIGN_SEED,
): SyntheticAudienceSummary {
  if (!Number.isInteger(total) || total < 0) {
    throw new Error("Synthetic audience total must be a non-negative integer.");
  }

  const exclusions: Partial<Record<CampaignExclusionReason, number>> = {};
  const languages: Record<SupportedLanguage, number> = { en: 0, si: 0, ta: 0 };
  let eligibleCount = 0;
  let unknownConsentCount = 0;

  for (let ordinal = 0; ordinal < total; ordinal += 1) {
    const member = syntheticAudienceMember(ordinal, seed);
    languages[member.preferredLanguage] += 1;
    if (member.eligible) {
      eligibleCount += 1;
      continue;
    }
    const reason = member.exclusionReason;
    if (reason) {
      exclusions[reason] = (exclusions[reason] ?? 0) + 1;
      if (reason === "consent_missing") unknownConsentCount += 1;
    }
  }

  return {
    totalEvaluated: total,
    eligibleCount,
    excludedCount: total - eligibleCount,
    unknownConsentCount,
    exclusionsByReason: exclusions,
    languageCounts: languages,
  };
}

