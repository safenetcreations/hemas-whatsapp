/**
 * Hemas Connect live canary BOT engine — pure and deterministic.
 *
 * A trilingual (English / Sinhala / Tamil), menu-driven clinic assistant for
 * the governed live canary line. Design rules:
 *
 * - Selections only: every branch is driven by interactive button/list IDs.
 *   Free text is never stored anywhere (the webhook already hashes bodies);
 *   the engine only inspects it in-memory for language/menu keywords.
 * - No medical advice, no diagnosis, no real bookings — every confirmation
 *   is explicitly labelled a demonstration.
 * - Pure function: (session, inbound) -> replies + next session (+ booking).
 *   All I/O (Firestore, Graph API) lives in the webhook layer.
 */

export type BotLanguage = "en" | "si" | "ta";

export type BotState =
  | "language"
  | "menu"
  | "book_department"
  | "book_day"
  | "book_slot"
  | "idle";

export interface BotSession {
  readonly language: BotLanguage | null;
  readonly state: BotState;
  readonly departmentId: string | null;
  readonly dayId: string | null;
  readonly updatedAtMs: number;
}

export const FRESH_BOT_SESSION: BotSession = {
  language: null,
  state: "language",
  departmentId: null,
  dayId: null,
  updatedAtMs: 0,
};

export const BOT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface BotInbound {
  readonly kind: "text" | "selection";
  readonly text: string;
  readonly selectionId: string;
  readonly nowMs: number;
}

export interface BotBooking {
  readonly departmentId: string;
  readonly departmentLabel: string;
  readonly dayId: string;
  readonly dayLabel: string;
  readonly slotId: string;
  readonly slotLabel: string;
  readonly language: BotLanguage;
  readonly reference: string;
}

export interface BotResult {
  readonly replies: readonly Record<string, unknown>[];
  readonly session: BotSession;
  readonly booking: BotBooking | null;
  /** Conversation purpose hint for the inbox bridge. */
  readonly purpose: "general_support" | "appointment" | "laboratory";
  readonly staffHandoff: boolean;
}

// ---------------------------------------------------------------------------
// Trilingual catalogue
// ---------------------------------------------------------------------------

const T = {
  chooseLanguage:
    "Welcome to Hemas Connect 🏥\nආයුබෝවන්! · வணக்கம்!\n\nPlease choose your language · භාෂාව තෝරන්න · மொழியைத் தேர்ந்தெடுக்கவும்",
  langButtons: [
    { id: "lang_en", title: "English" },
    { id: "lang_si", title: "සිංහල" },
    { id: "lang_ta", title: "தமிழ்" },
  ],
  menuHeader: "Hemas Connect",
  menuBody: {
    en: "How can we help you today?\n\nGoverned demo service — no real patient data. Choose an option:",
    si: "අද ඔබට උදව් කරන්නේ කෙසේද?\n\nමෙය පාලිත ආදර්ශන සේවාවකි — සැබෑ රෝගී දත්ත නොමැත. විකල්පයක් තෝරන්න:",
    ta: "இன்று உங்களுக்கு எப்படி உதவலாம்?\n\nஇது ஒரு கட்டுப்படுத்தப்பட்ட மாதிரி சேவை — உண்மையான நோயாளர் தரவு இல்லை. ஒரு விருப்பத்தைத் தேர்ந்தெடுக்கவும்:",
  },
  menuButton: { en: "Menu", si: "මෙනුව", ta: "பட்டியல்" },
  menuRows: {
    en: [
      { id: "menu_appointment", title: "Book appointment", description: "Choose department, day and time" },
      { id: "menu_lab", title: "Lab results info", description: "How results reach you safely" },
      { id: "menu_clinic", title: "Clinic info & hours", description: "Locations and opening times" },
      { id: "menu_staff", title: "Talk to our team", description: "Hand over to a care-team member" },
      { id: "menu_language", title: "Change language", description: "English · සිංහල · தமிழ்" },
    ],
    si: [
      { id: "menu_appointment", title: "හමුවීම වෙන්කරන්න", description: "අංශය, දිනය සහ වේලාව තෝරන්න" },
      { id: "menu_lab", title: "රසායනාගාර ප්‍රතිඵල", description: "ප්‍රතිඵල ලැබෙන ආරක්ෂිත ක්‍රමය" },
      { id: "menu_clinic", title: "සායන තොරතුරු", description: "ස්ථාන සහ විවෘත වේලාවන්" },
      { id: "menu_staff", title: "කණ්ඩායමට කතා කරන්න", description: "සත්කාර කණ්ඩායමට භාර දෙන්න" },
      { id: "menu_language", title: "භාෂාව වෙනස් කරන්න", description: "English · සිංහල · தமிழ்" },
    ],
    ta: [
      { id: "menu_appointment", title: "சந்திப்பு பதிவு", description: "பிரிவு, நாள், நேரம் தேர்வு" },
      { id: "menu_lab", title: "ஆய்வக முடிவுகள்", description: "முடிவுகள் பாதுகாப்பாக வரும் முறை" },
      { id: "menu_clinic", title: "கிளினிக் தகவல்", description: "இடங்கள் மற்றும் நேரங்கள்" },
      { id: "menu_staff", title: "எங்கள் குழுவுடன் பேச", description: "பராமரிப்புக் குழுவிடம் ஒப்படைப்பு" },
      { id: "menu_language", title: "மொழி மாற்றம்", description: "English · සිංහල · தமிழ்" },
    ],
  },
  deptHeader: { en: "Choose a department", si: "අංශයක් තෝරන්න", ta: "பிரிவைத் தேர்ந்தெடுக்கவும்" },
  deptRows: {
    en: [
      { id: "dept_general", title: "General Medicine", description: "Consultations and check-ups" },
      { id: "dept_dental", title: "Dental", description: "Dental care and cleaning" },
      { id: "dept_pediatrics", title: "Pediatrics", description: "Care for children" },
      { id: "dept_cardiology", title: "Cardiology", description: "Heart health" },
    ],
    si: [
      { id: "dept_general", title: "සාමාන්‍ය වෛද්‍ය", description: "පරීක්ෂණ සහ උපදෙස්" },
      { id: "dept_dental", title: "දන්ත", description: "දන්ත සත්කාර" },
      { id: "dept_pediatrics", title: "ළමා රෝග", description: "ළමුන් සඳහා සත්කාර" },
      { id: "dept_cardiology", title: "හෘද රෝග", description: "හෘද සෞඛ්‍යය" },
    ],
    ta: [
      { id: "dept_general", title: "பொது மருத்துவம்", description: "ஆலோசனை மற்றும் பரிசோதனை" },
      { id: "dept_dental", title: "பல் மருத்துவம்", description: "பல் பராமரிப்பு" },
      { id: "dept_pediatrics", title: "குழந்தை நலம்", description: "குழந்தைகளுக்கான பராமரிப்பு" },
      { id: "dept_cardiology", title: "இதயவியல்", description: "இதய ஆரோக்கியம்" },
    ],
  },
  dayHeader: { en: "Choose a day", si: "දිනයක් තෝරන්න", ta: "நாளைத் தேர்ந்தெடுக்கவும்" },
  dayRows: {
    en: [
      { id: "day_today", title: "Today" },
      { id: "day_tomorrow", title: "Tomorrow" },
      { id: "day_after", title: "Day after tomorrow" },
    ],
    si: [
      { id: "day_today", title: "අද" },
      { id: "day_tomorrow", title: "හෙට" },
      { id: "day_after", title: "අනිද්දා" },
    ],
    ta: [
      { id: "day_today", title: "இன்று" },
      { id: "day_tomorrow", title: "நாளை" },
      { id: "day_after", title: "நாளை மறுநாள்" },
    ],
  },
  slotBody: {
    en: "Choose a time slot:",
    si: "වේලාවක් තෝරන්න:",
    ta: "நேரத்தைத் தேர்ந்தெடுக்கவும்:",
  },
  slots: [
    { id: "slot_0900", title: "9.00 AM" },
    { id: "slot_1400", title: "2.00 PM" },
    { id: "slot_1730", title: "5.30 PM" },
  ],
  confirm: {
    en: (d: string, day: string, s: string, ref: string) =>
      `✅ Your demo appointment request is recorded.\n\n🏥 ${d}\n📅 ${day} · ⏰ ${s}\n🔖 Reference: ${ref}\n\nA care-team member will confirm through the governed inbox. This is a demonstration — no real booking was made.\n\nReply MENU for more options.`,
    si: (d: string, day: string, s: string, ref: string) =>
      `✅ ඔබගේ ආදර්ශන හමුවීම් ඉල්ලීම සටහන් විය.\n\n🏥 ${d}\n📅 ${day} · ⏰ ${s}\n🔖 යොමුව: ${ref}\n\nසත්කාර කණ්ඩායමේ සාමාජිකයෙක් පාලිත inbox හරහා තහවුරු කරනු ඇත. මෙය ආදර්ශනයකි — සැබෑ වෙන්කිරීමක් සිදු නොවීය.\n\nතවත් විකල්ප සඳහා MENU ලියන්න.`,
    ta: (d: string, day: string, s: string, ref: string) =>
      `✅ உங்கள் மாதிரி சந்திப்புக் கோரிக்கை பதிவு செய்யப்பட்டது.\n\n🏥 ${d}\n📅 ${day} · ⏰ ${s}\n🔖 குறிப்பு: ${ref}\n\nபராமரிப்புக் குழு உறுப்பினர் நிர்வகிக்கப்பட்ட inbox வழியாக உறுதிப்படுத்துவார். இது ஒரு மாதிரி — உண்மையான பதிவு எதுவும் செய்யப்படவில்லை.\n\nமேலும் விருப்பங்களுக்கு MENU என அனுப்பவும்.`,
  },
  lab: {
    en: "🔬 Lab results — how it works\n\nWhen your results are ready, you receive a governed notification here. Sensitive details are never sent in open chat — the full report is released through the clinic's secure channel only.\n\n(Demonstration service.)\n\nReply MENU for more options.",
    si: "🔬 රසායනාගාර ප්‍රතිඵල — ක්‍රියාත්මක වන ආකාරය\n\nප්‍රතිඵල සූදානම් වූ විට ඔබට මෙතැනින් පාලිත දැනුම්දීමක් ලැබේ. සංවේදී විස්තර විවෘත පණිවිඩ මගින් කිසිවිටෙක නොයැවේ — සම්පූර්ණ වාර්තාව සායනයේ ආරක්ෂිත මාර්ගයෙන් පමණක් නිකුත් වේ.\n\n(ආදර්ශන සේවාවකි.)\n\nතවත් විකල්ප සඳහා MENU ලියන්න.",
    ta: "🔬 ஆய்வக முடிவுகள் — செயல்படும் முறை\n\nஉங்கள் முடிவுகள் தயாரானதும் இங்கு ஒரு நிர்வகிக்கப்பட்ட அறிவிப்பு வரும். உணர்திறன் விவரங்கள் திறந்த செய்தியில் ஒருபோதும் அனுப்பப்படாது — முழு அறிக்கை கிளினிக்கின் பாதுகாப்பான வழியில் மட்டுமே வழங்கப்படும்.\n\n(மாதிரி சேவை.)\n\nமேலும் விருப்பங்களுக்கு MENU என அனுப்பவும்.",
  },
  clinic: {
    en: "🏥 Hemas Clinics (demonstration)\n\n📍 Wattala — Mon–Sat, 8.00 AM – 8.00 PM\n📍 Thalawathugoda — Mon–Sat, 8.00 AM – 8.00 PM\n\nThis WhatsApp line is the governed contact channel.\n\nReply MENU for more options.",
    si: "🏥 හෙමාස් සායන (ආදර්ශන)\n\n📍 වත්තල — සඳුදා–සෙනසුරාදා, පෙ.ව 8.00 – ප.ව 8.00\n📍 තලවතුගොඩ — සඳුදා–සෙනසුරාදා, පෙ.ව 8.00 – ප.ව 8.00\n\nමෙම WhatsApp මාර්ගය පාලිත සම්බන්ධතා මාධ්‍යයයි.\n\nතවත් විකල්ප සඳහා MENU ලියන්න.",
    ta: "🏥 ஹேமாஸ் கிளினிக்குகள் (மாதிரி)\n\n📍 வத்தளை — திங்கள்–சனி, காலை 8.00 – இரவு 8.00\n📍 தலவத்துகொட — திங்கள்–சனி, காலை 8.00 – இரவு 8.00\n\nஇந்த WhatsApp வழி நிர்வகிக்கப்பட்ட தொடர்பு சேனலாகும்.\n\nமேலும் விருப்பங்களுக்கு MENU என அனுப்பவும்.",
  },
  staff: {
    en: "🧑‍⚕️ Noted — your request is with our care team.\n\nYour conversation now appears in the clinic's governed inbox, where a team member responds within the service window. Nothing is answered by machine beyond this point, and no medical advice is given by the assistant.\n\n(Demonstration service.)\n\nReply MENU for more options.",
    si: "🧑‍⚕️ සටහන් විය — ඔබේ ඉල්ලීම සත්කාර කණ්ඩායම වෙත යොමු විය.\n\nඔබේ සංවාදය දැන් සායනයේ පාලිත inbox හි දිස්වේ; කණ්ඩායම් සාමාජිකයෙක් සේවා කාලය තුළ පිළිතුරු දෙයි. මෙතැනින් එහාට යන්ත්‍රයෙන් පිළිතුරු නොදෙන අතර සහායකයා වෛද්‍ය උපදෙස් ලබා නොදේ.\n\n(ආදර්ශන සේවාවකි.)\n\nතවත් විකල්ප සඳහා MENU ලියන්න.",
    ta: "🧑‍⚕️ பதிவானது — உங்கள் கோரிக்கை எங்கள் பராமரிப்புக் குழுவிடம் உள்ளது.\n\nஉங்கள் உரையாடல் இப்போது கிளினிக்கின் நிர்வகிக்கப்பட்ட inbox இல் தெரிகிறது; சேவை நேரத்தில் குழு உறுப்பினர் பதிலளிப்பார். இதற்கு மேல் இயந்திரம் பதிலளிக்காது; உதவியாளர் மருத்துவ ஆலோசனை வழங்குவதில்லை.\n\n(மாதிரி சேவை.)\n\nமேலும் விருப்பங்களுக்கு MENU என அனுப்பவும்.",
  },
  fallback: {
    en: "Please choose an option from the menu below 👇",
    si: "කරුණාකර පහත මෙනුවෙන් විකල්පයක් තෝරන්න 👇",
    ta: "கீழேயுள்ள பட்டியலில் இருந்து ஒரு விருப்பத்தைத் தேர்ந்தெடுக்கவும் 👇",
  },
} as const;

// ---------------------------------------------------------------------------
// WhatsApp payload builders (bodies only — the sender adds `to`)
// ---------------------------------------------------------------------------

function textMessage(body: string): Record<string, unknown> {
  return { type: "text", text: { preview_url: false, body } };
}

function buttonMessage(
  body: string,
  buttons: readonly { id: string; title: string }[],
): Record<string, unknown> {
  return {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })),
      },
    },
  };
}

function listMessage(
  header: string,
  body: string,
  buttonLabel: string,
  rows: readonly { id: string; title: string; description?: string }[],
): Record<string, unknown> {
  return {
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: header },
      body: { text: body },
      footer: { text: "Hemas Connect · SafeNet demo" },
      action: {
        button: buttonLabel,
        sections: [
          {
            title: header.slice(0, 24),
            rows: rows.slice(0, 10).map((r) => ({
              id: r.id,
              title: r.title.slice(0, 24),
              ...(r.description ? { description: r.description.slice(0, 72) } : {}),
            })),
          },
        ],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Language & keyword helpers (in-memory inspection only)
// ---------------------------------------------------------------------------

export function detectScriptLanguage(text: string): BotLanguage | null {
  if (/[඀-෿]/.test(text)) return "si";
  if (/[஀-௿]/.test(text)) return "ta";
  return null;
}

const MENU_KEYWORDS = /^(menu|start|hi|hello|hey|ayubowan|vanakkam|මෙනුව|ආයුබෝවන්|வணக்கம்|பட்டியல்)\b/i;
const BOOK_KEYWORDS = /(book|appoint|channel|වෙන්|හමුවීම|சந்திப்பு|பதிவு)/i;
const LAB_KEYWORDS = /(lab|result|report|රසායනාගාර|ප්‍රතිඵල|ஆய்வக|முடிவு)/i;

function languageMenu(): Record<string, unknown>[] {
  return [buttonMessage(T.chooseLanguage, T.langButtons)];
}

function mainMenu(lang: BotLanguage): Record<string, unknown>[] {
  return [listMessage(T.menuHeader, T.menuBody[lang], T.menuButton[lang], T.menuRows[lang])];
}

function label(rows: readonly { id: string; title: string }[], id: string): string {
  return rows.find((r) => r.id === id)?.title ?? id;
}

export function makeBookingReference(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `HC-${(h % 100000).toString().padStart(5, "0")}`;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export function runBotEngine(previous: BotSession, inbound: BotInbound): BotResult {
  const stale = inbound.nowMs - previous.updatedAtMs > BOT_SESSION_TTL_MS;
  const session: BotSession = stale ? FRESH_BOT_SESSION : previous;
  const sel = inbound.kind === "selection" ? inbound.selectionId : "";
  const text = inbound.kind === "text" ? inbound.text.trim() : "";

  const done = (
    replies: Record<string, unknown>[],
    next: Partial<BotSession>,
    extra?: Partial<Pick<BotResult, "booking" | "purpose" | "staffHandoff">>,
  ): BotResult => ({
    replies,
    session: { ...session, ...next, updatedAtMs: inbound.nowMs },
    booking: extra?.booking ?? null,
    purpose: extra?.purpose ?? "general_support",
    staffHandoff: extra?.staffHandoff ?? false,
  });

  // --- language selection (or first contact) -------------------------------
  if (sel.startsWith("lang_")) {
    const lang = sel.slice(5) as BotLanguage;
    if (lang === "en" || lang === "si" || lang === "ta") {
      return done(mainMenu(lang), { language: lang, state: "menu" });
    }
  }

  if (!session.language) {
    const detected = text ? detectScriptLanguage(text) : null;
    if (detected) {
      return done(mainMenu(detected), { language: detected, state: "menu" });
    }
    return done(languageMenu(), { state: "language" });
  }

  const lang = session.language;

  // --- explicit menu requests ----------------------------------------------
  if (sel === "menu_language") {
    return done(languageMenu(), { language: null, state: "language", departmentId: null, dayId: null });
  }
  if (sel === "menu_appointment") {
    return done(
      [listMessage(T.deptHeader[lang], T.menuBody[lang].split("\n")[0] ?? T.deptHeader[lang], T.menuButton[lang], T.deptRows[lang])],
      { state: "book_department", departmentId: null, dayId: null },
      { purpose: "appointment" },
    );
  }
  if (sel === "menu_lab") {
    return done([textMessage(T.lab[lang])], { state: "idle" }, { purpose: "laboratory" });
  }
  if (sel === "menu_clinic") {
    return done([textMessage(T.clinic[lang])], { state: "idle" });
  }
  if (sel === "menu_staff") {
    return done([textMessage(T.staff[lang])], { state: "idle" }, { staffHandoff: true });
  }

  // --- booking flow ----------------------------------------------------------
  if (sel.startsWith("dept_")) {
    return done(
      [listMessage(T.dayHeader[lang], T.dayHeader[lang], T.menuButton[lang], T.dayRows[lang])],
      { state: "book_day", departmentId: sel },
      { purpose: "appointment" },
    );
  }
  if (sel.startsWith("day_") && session.departmentId) {
    return done(
      [buttonMessage(T.slotBody[lang], T.slots)],
      { state: "book_slot", dayId: sel },
      { purpose: "appointment" },
    );
  }
  if (sel.startsWith("slot_") && session.departmentId && session.dayId) {
    const booking: BotBooking = {
      departmentId: session.departmentId,
      departmentLabel: label(T.deptRows[lang], session.departmentId),
      dayId: session.dayId,
      dayLabel: label(T.dayRows[lang], session.dayId),
      slotId: sel,
      slotLabel: label(T.slots, sel),
      language: lang,
      reference: makeBookingReference(`${session.departmentId}:${session.dayId}:${sel}:${inbound.nowMs}`),
    };
    return done(
      [textMessage(T.confirm[lang](booking.departmentLabel, booking.dayLabel, booking.slotLabel, booking.reference))],
      { state: "menu", departmentId: null, dayId: null },
      { booking, purpose: "appointment" },
    );
  }

  // --- free-text intents ------------------------------------------------------
  if (text) {
    const switched = detectScriptLanguage(text);
    const effective = switched ?? lang;
    if (MENU_KEYWORDS.test(text)) {
      return done(mainMenu(effective), { language: effective, state: "menu" });
    }
    if (BOOK_KEYWORDS.test(text)) {
      return done(
        [listMessage(T.deptHeader[effective], T.deptHeader[effective], T.menuButton[effective], T.deptRows[effective])],
        { language: effective, state: "book_department", departmentId: null, dayId: null },
        { purpose: "appointment" },
      );
    }
    if (LAB_KEYWORDS.test(text)) {
      return done([textMessage(T.lab[effective])], { language: effective, state: "idle" }, { purpose: "laboratory" });
    }
  }

  // --- fallback: nudge back to the menu ---------------------------------------
  return done([textMessage(T.fallback[lang]), ...mainMenu(lang)], { state: "menu" });
}
