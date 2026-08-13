/**
 * Hemas Connect live canary — governed AI answers (Gemini).
 *
 * Turns the bot's "unknown free text" fallback into a real AI answer while
 * keeping every governance rule of this lane:
 *
 * - The user's text is inspected IN MEMORY only and sent transiently to the
 *   model with request logging disabled. This service never persists it,
 *   application-logs it, or echoes it into errors; the webhook writes only
 *   content-free evidence.
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

export const DEFAULT_AI_MODEL = "gemini-3.6-flash";
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_ANSWER_CHARS = 900;

/**
 * Thinking configuration differs per model family: Gemini 2.5 takes
 * `thinkingBudget: 0`, Gemini 3.x takes `thinkingLevel: "minimal"`.
 * Unknown families get none (and a 400 triggers one retry without it).
 */
export function thinkingConfigFor(model: string): Record<string, unknown> | null {
  if (/^gemini-2\./.test(model)) return { thinkingBudget: 0 };
  if (/^gemini-3/.test(model) || /^gemini-(flash|pro)/.test(model)) {
    return { thinkingLevel: "minimal" };
  }
  return null;
}

const LANGUAGE_NAMES: Record<BotLanguage, string> = {
  en: "English",
  si: "Sinhala (සිංහල)",
  ta: "Tamil (தமிழ்)",
};

/**
 * Knowledge base built from Hemas Hospitals' PUBLIC website
 * (hemashospitals.com, retrieved 2026-08-11) — real locations, hotline and
 * service lists. Where the site publishes no fact (hours, prices), the
 * assistant redirects to the hotline instead of inventing anything.
 * The pilot itself remains a governed demonstration.
 */
export const AI_KNOWLEDGE_BASE = `
ABOUT: Hemas Hospitals is the first internationally accredited hospital chain in Sri Lanka (ACHSI accredited). Two hospitals — Wattala and Thalawathugoda — plus an island-wide laboratory network. This WhatsApp assistant is a governed pilot.
HOTLINE: 0117 888 888 — one number for both hospitals, including emergencies and ambulance. Email: info@hemashospitals.com.
LOCATIONS: Hemas Hospital Wattala — 389, Negombo Road, Wattala. Hemas Hospital Thalawathugoda — 647/2a, Pannipitiya Road, Thalawathugoda (60-bed hospital complex).
APPOINTMENTS / CHANNELLING: In this pilot, book through this WhatsApp menu (reply MENU, then "Book appointment"). Also online via the Hemas Health app / hemashealth.com, or by calling 0117 888 888.
SERVICES AT WATTALA: Emergency Treatment Unit, Pharmacy, Laboratory, Radiology, Cardiology, Specialist consultation (channelling), Physiotherapy & Rehabilitation, General & Laparoscopic Surgery, Cosmetic Centre, Fertility & IVF Centre, Health Checks, Corporate Medical Screenings, Ambulance Service, Homecare, Obstetrics & Gynaecology (baby delivery), Eye Care, Gastroenterology, Orthopaedics, Neuro Diagnostic Centre, Urology & Kidney Care.
SERVICES AT THALAWATHUGODA: Emergency Treatment Unit, Cardiology, General & Orthopaedic Surgery, Endoscopy & Colonoscopy, Baby Delivery, Kidney Care, Physiotherapy & Rehabilitation, Laboratory + Mobile Laboratory (home sample collection), Radiology, Pharmacy, Ambulance Service, Homecare, Suwatha Piyasa Wellness Centre, Women's Wellness Clinic, Corporate Medical Screenings, Adora Cosmetic Centre.
LABORATORY: ISO 15189 accredited lab network — clinical biochemistry, haematology, microbiology, immunology, histopathology, molecular testing. Online laboratory report portal available. In this pilot, reports are never sent in open chat — a governed notification arrives here and the report is released through the secure channel.
DIGITAL SERVICES: Hemas Health app and hemashealth.com for online booking; telemedicine, online pharmacy, online lab portal, tele-physiotherapy.
PRICES & PACKAGES: Hemas pioneered fixed-price packages in Sri Lanka. This assistant does not quote prices — the front desk or 0117 888 888 confirms current prices and packages.
HOURS: Opening and visiting hours are not in this pilot's knowledge base — call 0117 888 888 to confirm timings.
CARE TEAM: Reply MENU and choose "Talk to our team" — the conversation moves to the hospital's governed inbox and a staff member responds during service hours.
EMERGENCIES: Not handled in chat. Call 0117 888 888 (Hemas emergency & ambulance) or 1990 (Suwa Seriya national ambulance) immediately.
`.trim();

export function buildAiSystemPrompt(language: BotLanguage): string {
  return [
    "You are the Hemas Connect demo assistant answering on WhatsApp for a governed Hemas Hospitals pilot in Sri Lanka. This is a demonstration service running on synthetic data.",
    "",
    "STRICT RULES:",
    "1. Answer ONLY from the knowledge base below. If the answer is not there, say you do not have that information and offer the hotline 0117 888 888 or the care team (reply MENU, then 'Talk to our team').",
    "2. NEVER give medical advice, diagnosis, medication guidance, or dosages. For any symptom or medical question, kindly say a doctor should look at it and suggest booking an appointment (reply MENU, then 'Book appointment').",
    "3. If the message suggests an emergency (chest pain, trouble breathing, heavy bleeding, unconsciousness, poisoning), tell them to call 0117 888 888 (Hemas emergency) or 1990 (Suwa Seriya ambulance) immediately.",
    `4. Reply in the SAME language the user wrote in — English, Sinhala, or Tamil (romanized Sinhala/Tamil counts as that language). Only when the language is unclear, reply in ${LANGUAGE_NAMES[language]}. Never refuse to switch languages.`,
    "5. Maximum 3 short sentences, in a warm, respectful tone. Plain WhatsApp text only — no lists, no headings, no code.",
    "6. Never ask for personal, medical, or payment details. Never invent services, prices, hours, or facts that are not in the knowledge base — for prices and hours, point to 0117 888 888.",
    "7. The facts below come from the public Hemas Hospitals website; the pilot itself is a demonstration service.",
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

  const attempt = (thinking: Record<string, unknown> | null) =>
    doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": config.apiKey,
      },
      body: JSON.stringify({
        store: false,
        systemInstruction: { parts: [{ text: buildAiSystemPrompt(request.language) }] },
        contents: [{ role: "user", parts: [{ text: request.text }] }],
        generationConfig: {
          maxOutputTokens: 512,
          ...(thinking ? { thinkingConfig: thinking } : {}),
        },
      }),
    });

  try {
    const thinking = thinkingConfigFor(model);
    let response = await attempt(thinking);
    if (response.status === 400 && thinking) {
      // Model rejected the thinking config (family drift) — retry bare.
      response = await attempt(null);
    }

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
    if (candidate && candidate.finishReason !== "STOP") {
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
