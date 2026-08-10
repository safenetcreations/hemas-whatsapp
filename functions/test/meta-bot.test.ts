import assert from "node:assert/strict";
import test from "node:test";
import {
  BOT_SESSION_TTL_MS,
  FRESH_BOT_SESSION,
  detectScriptLanguage,
  makeBookingReference,
  runBotEngine,
  type BotSession,
} from "../src/meta-bot/engine.js";

const NOW = 1_786_400_000_000;
const text = (t: string) => ({ kind: "text" as const, text: t, selectionId: "", nowMs: NOW });
const pick = (id: string) => ({ kind: "selection" as const, text: "", selectionId: id, nowMs: NOW });

const english: BotSession = { language: "en", state: "menu", departmentId: null, dayId: null, updatedAtMs: NOW - 1000 };

test("first contact asks for language with three buttons", () => {
  const r = runBotEngine(FRESH_BOT_SESSION, text("hello"));
  assert.equal(r.replies.length, 1);
  const interactive = (r.replies[0] as any).interactive;
  assert.equal(interactive.type, "button");
  assert.deepEqual(
    interactive.action.buttons.map((b: any) => b.reply.id),
    ["lang_en", "lang_si", "lang_ta"],
  );
  assert.equal(r.session.state, "language");
});

test("native script skips the language menu", () => {
  assert.equal(detectScriptLanguage("ආයුබෝවන්"), "si");
  assert.equal(detectScriptLanguage("வணக்கம்"), "ta");
  assert.equal(detectScriptLanguage("hello"), null);

  const r = runBotEngine(FRESH_BOT_SESSION, text("ආයුබෝවන්"));
  assert.equal(r.session.language, "si");
  assert.equal((r.replies[0] as any).interactive.type, "list");
});

test("language button leads to the trilingual main menu", () => {
  for (const [id, lang] of [["lang_en", "en"], ["lang_si", "si"], ["lang_ta", "ta"]] as const) {
    const r = runBotEngine(FRESH_BOT_SESSION, pick(id));
    assert.equal(r.session.language, lang);
    assert.equal(r.session.state, "menu");
    const rows = (r.replies[0] as any).interactive.action.sections[0].rows;
    assert.equal(rows.length, 5);
    assert.equal(rows[0].id, "menu_appointment");
    for (const row of rows) {
      assert.ok(row.title.length <= 24, `row title too long: ${row.title}`);
    }
  }
});

test("full booking path produces a selections-only booking", () => {
  let session = english;
  let r = runBotEngine(session, pick("menu_appointment"));
  assert.equal(r.session.state, "book_department");

  r = runBotEngine(r.session, pick("dept_dental"));
  assert.equal(r.session.state, "book_day");
  assert.equal(r.session.departmentId, "dept_dental");

  r = runBotEngine(r.session, pick("day_tomorrow"));
  assert.equal(r.session.state, "book_slot");

  r = runBotEngine(r.session, pick("slot_1400"));
  assert.ok(r.booking, "booking expected");
  assert.equal(r.booking?.departmentId, "dept_dental");
  assert.equal(r.booking?.dayId, "day_tomorrow");
  assert.equal(r.booking?.slotId, "slot_1400");
  assert.match(r.booking?.reference ?? "", /^HC-\d{5}$/);
  assert.equal(r.purpose, "appointment");
  const confirmation = (r.replies[0] as any).text.body as string;
  assert.ok(confirmation.includes(r.booking!.reference));
  assert.ok(confirmation.toLowerCase().includes("demo"));
});

test("sinhala and tamil booking confirmations render in-language", () => {
  for (const [langBtn, marker] of [["lang_si", "යොමුව"], ["lang_ta", "குறிப்பு"]] as const) {
    let r = runBotEngine(FRESH_BOT_SESSION, pick(langBtn));
    r = runBotEngine(r.session, pick("menu_appointment"));
    r = runBotEngine(r.session, pick("dept_general"));
    r = runBotEngine(r.session, pick("day_today"));
    r = runBotEngine(r.session, pick("slot_0900"));
    const body = (r.replies[0] as any).text.body as string;
    assert.ok(body.includes(marker), `expected ${marker} in ${body.slice(0, 60)}`);
  }
});

test("staff handoff flags the conversation for humans", () => {
  const r = runBotEngine(english, pick("menu_staff"));
  assert.equal(r.staffHandoff, true);
  assert.equal(r.replies.length, 1);
});

test("free-text booking keywords work in all three languages", () => {
  for (const phrase of ["I want to book an appointment", "හමුවීමක් ඕන", "சந்திப்பு வேணும்"]) {
    const r = runBotEngine(english, text(phrase));
    assert.equal(r.session.state, "book_department", phrase);
  }
});

test("unknown text falls back to the menu without storing anything", () => {
  const r = runBotEngine(english, text("random gibberish xyz"));
  assert.equal(r.replies.length, 2);
  assert.equal(r.session.state, "menu");
  assert.equal(r.booking, null);
});

test("stale sessions restart at language selection", () => {
  const stale: BotSession = { ...english, updatedAtMs: NOW - BOT_SESSION_TTL_MS - 1 };
  const r = runBotEngine(stale, text("hi"));
  assert.equal(r.session.state, "language");
});

test("booking references are stable per seed", () => {
  assert.equal(makeBookingReference("a:b:c:1"), makeBookingReference("a:b:c:1"));
  assert.notEqual(makeBookingReference("a:b:c:1"), makeBookingReference("a:b:c:2"));
});
