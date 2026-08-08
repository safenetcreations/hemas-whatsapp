import { deterministicId } from "../deterministic.js";
import { assertSafeTenantId } from "../errors.js";

export type SupportedLanguage = "en" | "si" | "ta";
export type SyntheticMessageDirection = "inbound" | "outbound";

export interface SyntheticMessage {
  readonly id: string;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly syntheticContactId: string;
  readonly direction: SyntheticMessageDirection;
  readonly language: SupportedLanguage;
  readonly text: string;
  readonly createdAt: string;
  readonly simulated: true;
}

export interface SyntheticMessageOptions {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly count: number;
  readonly seed: string;
  readonly startAt?: Date;
}

const LANGUAGES: readonly SupportedLanguage[] = ["en", "si", "ta"];
const FIXTURES: Readonly<Record<SupportedLanguage, Readonly<Record<SyntheticMessageDirection, string>>>> = {
  en: {
    inbound: "Please help me book a doctor appointment.",
    outbound: "I can help with that. Please choose the hospital location to continue.",
  },
  si: {
    inbound: "වෛද්‍ය හමුවක් වෙන්කර ගැනීමට මට උදව් කරන්න.",
    outbound: "ඉදිරියට යාමට කරුණාකර රෝහල් ශාඛාව තෝරන්න.",
  },
  ta: {
    inbound: "மருத்துவர் சந்திப்பை முன்பதிவு செய்ய உதவுங்கள்.",
    outbound: "தொடர மருத்துவமனை கிளையைத் தேர்ந்தெடுக்கவும்.",
  },
};

export function generateSyntheticMessages(options: SyntheticMessageOptions): readonly SyntheticMessage[] {
  assertSafeTenantId(options.tenantId);
  if (!options.conversationId.trim()) throw new TypeError("conversationId is required");
  if (!Number.isSafeInteger(options.count) || options.count < 1 || options.count > 1_000) {
    throw new RangeError("count must be between 1 and 1000");
  }
  if (options.seed.length < 8) throw new TypeError("seed must contain at least 8 characters");

  const startAt = options.startAt ?? new Date("2026-01-01T00:00:00.000Z");
  return Array.from({ length: options.count }, (_, index) => {
    const language = LANGUAGES[index % LANGUAGES.length] ?? "en";
    const direction: SyntheticMessageDirection = index % 2 === 0 ? "inbound" : "outbound";
    const identity = `${options.seed}:${options.tenantId}:${options.conversationId}:${index}`;
    return {
      id: deterministicId("synthetic-message", identity),
      tenantId: options.tenantId,
      conversationId: options.conversationId,
      syntheticContactId: deterministicId("synthetic-contact", `${options.seed}:${index % 25}`),
      direction,
      language,
      text: FIXTURES[language][direction],
      createdAt: new Date(startAt.getTime() + index * 30_000).toISOString(),
      simulated: true,
    };
  });
}
