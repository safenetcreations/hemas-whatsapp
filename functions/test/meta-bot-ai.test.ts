import assert from "node:assert/strict";
import test from "node:test";
import {
  aiReplyMessage,
  answerWithGuardrails,
  buildAiSystemPrompt,
  sanitizeAiAnswer,
} from "../src/meta-bot/ai.js";
import { runBotEngine, type BotSession } from "../src/meta-bot/engine.js";

const NOW = 1_786_400_000_000;
const english: BotSession = {
  language: "en",
  state: "menu",
  departmentId: null,
  dayId: null,
  updatedAtMs: NOW - 1000,
};
const text = (t: string) => ({ kind: "text" as const, text: t, selectionId: "", nowMs: NOW });
const pick = (id: string) => ({ kind: "selection" as const, text: "", selectionId: id, nowMs: NOW });

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("engine exposes unrouted free text as aiQuery", () => {
  const r = runBotEngine(english, text("what time is the OPD open?"));
  assert.equal(r.aiQuery, "what time is the OPD open?");
  assert.equal(r.replies.length, 2, "fallback replies unchanged for non-AI path");
});

test("engine keeps aiQuery null for keywords, selections and empty text", () => {
  assert.equal(runBotEngine(english, text("hi")).aiQuery, null);
  assert.equal(runBotEngine(english, text("book a dental visit")).aiQuery, null);
  assert.equal(runBotEngine(english, pick("menu_clinic")).aiQuery, null);
  assert.equal(runBotEngine(english, text("")).aiQuery, null);
});

test("native-script unknown text carries aiQuery and switches language", () => {
  const r = runBotEngine(english, text("වත්තල සායනය කොහෙද තියෙන්නේ?"));
  assert.equal(r.aiQuery, "වත්තල සායනය කොහෙද තියෙන්නේ?");
  assert.equal(r.session.language, "si");
});

test("system prompt carries language, guardrails and knowledge base", () => {
  const si = buildAiSystemPrompt("si");
  assert.ok(si.includes("Sinhala"));
  assert.ok(si.includes("NEVER give medical advice"));
  assert.ok(si.includes("1990"));
  assert.ok(si.includes("KNOWLEDGE BASE"));
  assert.ok(buildAiSystemPrompt("ta").includes("Tamil"));
});

test("answerWithGuardrails returns a sanitised answer on success", async () => {
  const outcome = await answerWithGuardrails(
    { text: "opd hours?", language: "en" },
    {
      apiKey: "k",
      fetchImpl: (async () =>
        jsonResponse({
          candidates: [
            {
              content: { parts: [{ text: "**OPD** is open Monday to Saturday, 8.00 AM to 8.00 PM." }] },
              finishReason: "STOP",
            },
          ],
        })) as unknown as typeof fetch,
    },
  );
  assert.equal(outcome.failureCode, null);
  assert.ok(outcome.answer?.includes("*OPD*"), outcome.answer ?? "");
  assert.ok(!outcome.answer?.includes("**"));
});

test("answerWithGuardrails maps failures to content-free codes", async () => {
  const http = await answerWithGuardrails(
    { text: "x", language: "en" },
    { apiKey: "k", fetchImpl: (async () => jsonResponse({}, 500)) as unknown as typeof fetch },
  );
  assert.equal(http.answer, null);
  assert.equal(http.failureCode, "http_500");

  const blocked = await answerWithGuardrails(
    { text: "x", language: "en" },
    {
      apiKey: "k",
      fetchImpl: (async () => jsonResponse({ promptFeedback: { blockReason: "SAFETY" } })) as unknown as typeof fetch,
    },
  );
  assert.equal(blocked.failureCode, "safety");

  const empty = await answerWithGuardrails(
    { text: "x", language: "en" },
    { apiKey: "k", fetchImpl: (async () => jsonResponse({ candidates: [] })) as unknown as typeof fetch },
  );
  assert.equal(empty.failureCode, "empty");
});

test("answerWithGuardrails times out without throwing", async () => {
  const hangingFetch = ((_url: unknown, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
      );
    })) as unknown as typeof fetch;
  const outcome = await answerWithGuardrails(
    { text: "x", language: "en" },
    { apiKey: "k", timeoutMs: 10, fetchImpl: hangingFetch },
  );
  assert.equal(outcome.answer, null);
  assert.equal(outcome.failureCode, "timeout");
});

test("sanitizeAiAnswer strips markdown noise and caps length", () => {
  assert.equal(sanitizeAiAnswer("## Hello\n\n- one\n• two\n\n\n\n**bold**"), "Hello\n\none\ntwo\n\n*bold*");
  assert.equal(sanitizeAiAnswer("   "), null);
  const long = sanitizeAiAnswer(`${"word ".repeat(400)}end`);
  assert.ok(long !== null && long.length <= 901);
  assert.ok(long?.endsWith("…"));
});

test("aiReplyMessage wraps the answer with the localized demo footer", () => {
  for (const [lang, marker] of [
    ["en", "Demo assistant"],
    ["si", "ආදර්ශන"],
    ["ta", "மாதிரி"],
  ] as const) {
    const message = aiReplyMessage("Answer.", lang) as {
      type: string;
      text: { preview_url: boolean; body: string };
    };
    assert.equal(message.type, "text");
    assert.equal(message.text.preview_url, false);
    assert.ok(message.text.body.startsWith("Answer."));
    assert.ok(message.text.body.includes(marker), message.text.body);
  }
});
