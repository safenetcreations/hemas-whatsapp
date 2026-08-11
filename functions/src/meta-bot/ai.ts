/**
 * Hemas Connect live canary — governed AI answers (Gemini).
 *
 * Turns the bot's "unknown free text" fallback into a real AI answer while
 * keeping every governance rule of this lane:
 *
 * - The user's text is inspected IN MEMORY only. It is sent to the model to
 *   produce an answer and is never stored, logged, or echoed into errors —
 *   the webhook keeps writing content-free records (hashes) exactly as before.
 * - The model is fenced by a strict system prompt: it may only answer from
 *   the synthetic knowledge base below, must refuse medical advice, must
 *   redirect emergencies to 1990 (Suwa Seriya), and replies in the session
 *   language (English / Sinhala / Tamil).
 * - Every failure degrades gracefully: the webhook falls back to the plain
 *   menu nudge whenever this module returns `answer: null`.
 */

import type { BotLanguage } from "./engine.js";

export interface AiAnswerRequest {
  readonly text: string;
  readonly language: BotLanguage;
}

export interface AiAnswerConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface AiAnswerOutcome {
  /** Sanitised answer text, or null when the model could not answer safely. */
  readonly answer: string | null;
  /** Content-free failure category for diagnostics (never includes text). */
  readonly failureCode:
    | null
    | "timeout"
    | "safety"
    | "empty"
    | "parse"
    | `http_${number}`
    | "network";
  readonly latencyMs: number;
}

export const DEFAULT_AI_MODEL = "gemini-2.5-flash";
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_ANSWER_CHARS = 900;

const LANGUAGE_NAMES: Record<BotLanguage, string> = {
  en: "English",
  si: "Sinhala (සිංහල)",
  ta: "Tamil (தமிழ்)",
};

/**
 * Synthetic demonstration knowledge base. Every figure is a demo value —
 * clearly labelled so the model repeats the demo framing, never real claims.
 */
export const AI_KNOWLEDGE_BASE = `
ABOUT: Hemas Connect is a governed WhatsApp assistant pilot for Hemas Hospitals (demonstration service, synthetic data only). Clinics in this demo: Wattala and Thalawathugoda.
OPD HOURS: Monday to Saturday, 8.00 AM to 8.00 PM. Closed on Sundays and public holidays (demo schedule).
APPOINTMENTS: Booked through this WhatsApp menu (reply MENU, then "Book appointment") — choose department, date and time. Departments in this demo: General Medicine, Dental, Pediatrics, Cardiology.
LABORATORY: Sample collection Monday to Saturday, 7.00 AM to 6.00 PM. Reports are never sent in open chat — a governed notification arrives here and the full report is released through the clinic's secure channel. Routine blood test reports are usually ready the same evening (demo timing).
DEMO PRICES (LKR, demonstration values only): Doctor consultation 2,500–4,500. Full blood count (FBC) 950. Lipid profile 2,200. Fasting blood sugar 400. Dental scaling 6,500. Exact prices are confirmed by the front desk.
LOCATIONS (demo): Wattala clinic — Negombo Road, Wattala. Thalawathugoda clinic — near the Hokandara Road junction, Thalawathugoda. Parking available at both.
PHARMACY: Open 8.00 AM to 9.00 PM at both clinics (demo).
VISITING HOURS: 12.00–2.00 PM and 5.00–7.00 PM daily (demo).
INSURANCE: Major Sri Lankan insurance cards are accepted at the front desk; bring the card and NIC (demo guidance).
PAYMENTS: Cash and card at the clinic; no payments are taken over WhatsApp (demo rule).
CARE TEAM: Reply MENU and choose "Talk to our team" — the conversation moves to the clinic's governed inbox and a staff member responds during service hours.
EMERGENCIES: This chat is not monitored for emergencies. Call 1990 (Suwa Seriya ambulance) or go to the nearest hospital emergency unit immediately.
`.trim();

export function buildAiSystemPrompt(language: BotLanguage): string {
  return [
    "You are the Hemas Connect demo assistant answering on WhatsApp for a governed Hemas Hospitals pilot in Sri Lanka. This is a demonstration service running on synthetic data.",
    "",
    "STRICT RULES:",
    "1. Answer ONLY from the knowledge base below. If the answer is not there, say you do not have that information and offer to connect the care team (reply MENU, then 'Talk to our team').",
    "2. NEVER give medical advice, diagnosis, medication guidance, or dosages. For any symptom or medical question, kindly say a doctor should look at it and suggest booking an appointment (reply MENU, then 'Book appointment').",
    "3. If the message suggests an emergency (chest pain, trouble breathing, heavy bleeding, unconsciousness, poisoning), tell them to call 1990 (Suwa Seriya ambulance) immediately.",
    `4. Reply in ${LANGUAGE_NAMES[language]}. If the user clearly wrote in romanized Sinhala or Tamil, you may reply in that language instead.`,
    "5. Maximum 3 short sentences, in a warm, respectful tone. Plain WhatsApp text only — no lists, no headings, no links, no code.",
    "6. Never ask for personal, medical, or payment details. Never invent services, prices, or times that are not in the knowledge base.",
    "7. When quoting a price or time, keep the demo framing natural (the knowledge base values are demonstration values).",
    "",
    "KNOWLEDGE BASE:",
    AI_KNOWLEDGE_BASE,
  ].join("\n");
}

/** Light sanitiser: WhatsApp-friendly plain text, bounded length. */
export function sanitizeAiAnswer(raw: string): string | null {
  let text = raw
    .replace(/\r/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/^[ \t]*[-•]\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return null;
  if (text.length > MAX_ANSWER_CHARS) {
    const cut = text.slice(0, MAX_ANSWER_CHARS);
    const lastBreak = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". "), cut.lastIndexOf(" "));
    text = `${cut.slice(0, lastBreak > 200 ? lastBreak : MAX_ANSWER_CHARS).trimEnd()}…`;
  }
  return text;
}

interface GeminiResponseShape {
  readonly candidates?: Array<{
    readonly content?: { readonly parts?: Array<{ readonly text?: string }> };
    readonly finishReason?: string;
  }>;
  readonly promptFeedback?: { readonly blockReason?: string };
}

/**
 * Ask Gemini for a governed answer. Resolves with `answer: null` (plus a
 * content-free failure code) on every error — this function never throws.
 */
export async function answerWithGuardrails(
  request: AiAnswerRequest,
  config: AiAnswerConfig,
): Promise<AiAnswerOutcome> {
  const startedAt = Date.now();
  const model = config.model?.trim() || DEFAULT_AI_MODEL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = config.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await doFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": config.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: buildAiSystemPrompt(request.language) }] },
          contents: [{ role: "user", parts: [{ text: request.text }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 512,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      },
    );

    if (!response.ok) {
      return {
        answer: null,
        failureCode: `http_${response.status}` as const,
        latencyMs: Date.now() - startedAt,
      };
    }

    let parsed: GeminiResponseShape;
    try {
      parsed = (await response.json()) as GeminiResponseShape;
    } catch {
      return { answer: null, failureCode: "parse", latencyMs: Date.now() - startedAt };
    }

    if (parsed.promptFeedback?.blockReason) {
      return { answer: null, failureCode: "safety", latencyMs: Date.now() - startedAt };
    }
    const candidate = parsed.candidates?.[0];
    if (candidate?.finishReason === "SAFETY") {
      return { answer: null, failureCode: "safety", latencyMs: Date.now() - startedAt };
    }
    const rawText = (candidate?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    const answer = rawText ? sanitizeAiAnswer(rawText) : null;
    return {
      answer,
      failureCode: answer ? null : "empty",
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    const aborted =
      (error instanceof Error && error.name === "AbortError") ||
      (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError");
    return {
      answer: null,
      failureCode: aborted ? "timeout" : "network",
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

const AI_SUFFIX: Record<BotLanguage, string> = {
  en: "_Demo assistant — reply MENU for options._",
  si: "_ආදර්ශන සහායක — විකල්ප සඳහා MENU ලියන්න._",
  ta: "_மாதிரி உதவியாளர் — விருப்பங்களுக்கு MENU அனுப்பவும்._",
};

/** WhatsApp text payload for an AI answer, with the localized demo footer. */
export function aiReplyMessage(answer: string, language: BotLanguage): Record<string, unknown> {
  return {
    type: "text",
    text: { preview_url: false, body: `${answer}\n\n${AI_SUFFIX[language]}` },
  };
}
