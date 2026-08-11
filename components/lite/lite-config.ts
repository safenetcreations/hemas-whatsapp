/**
 * Hemas Lite — client configuration (all synthetic demo values).
 *
 * The Lite app is the "simple product" face of the Hemas Connect engine:
 * same governed backend, own portal, own seats, a cheap-plan story. Every
 * identity below is synthetic (`*.synthetic.invalid`) and every quota is a
 * demonstration plan value (Phase 5 finalizes pricing).
 */

export const LITE_WORKSPACE_ID = "workspace_safenet_demo";
export const LITE_TEAM_ID = "team_demo_general";
export const LITE_LOCATION_ID = "location_demo_wattala";

export const LITE_BRAND = {
  name: "Hemas Lite",
  tagline: "Simple WhatsApp helpdesk for clinics",
  demoNote: "Governed demo · synthetic data only · runs on the Hemas Connect engine",
} as const;

export interface LiteSeatHint {
  readonly label: string;
  readonly email: string;
  readonly password: string;
  readonly role: "agent" | "supervisor" | "admin";
}

/** Demo seat hints shown on the Lite login screen (synthetic workspace). */
export const LITE_SEAT_HINTS: readonly LiteSeatHint[] = [
  { label: "Agent 1 · Nimali", email: "agent1@lite.synthetic.invalid", password: "LiteAgent1!Demo", role: "agent" },
  { label: "Agent 2 · Kavith", email: "agent2@lite.synthetic.invalid", password: "LiteAgent2!Demo", role: "agent" },
  { label: "Supervisor · Shalini", email: "supervisor@lite.synthetic.invalid", password: "LiteSuper1!Demo", role: "supervisor" },
] as const;

export const LITE_ADMIN_EMAIL = "demo.admin@synthetic.invalid";

export function isLiteEmail(email: string | null | undefined): boolean {
  const normalized = (email ?? "").trim().toLowerCase();
  return (
    normalized.endsWith("@lite.synthetic.invalid") || normalized === LITE_ADMIN_EMAIL
  );
}

/**
 * Known live TEST visitors (the governed canary allowlist — Nanthan's own
 * test phones, max 5). Lets the demo show the real number instead of the
 * masked label. Patient numbers are never stored or displayed — this map
 * only covers the explicit allowlisted test numbers.
 */
export const DEMO_KNOWN_VISITORS: Readonly<Record<string, string>> = {
  "7755": "+94 70 566 7755 · test phone 1",
  "1999": "+94 77 772 1999 · test phone 2",
  "6555": "+94 70 373 6555 · test phone 3",
  "7818": "+94 76 799 7818 · Hemas contact",
};

/** Booking visitorKey → display label (keys are sha10 of the allowlist). */
export const DEMO_VISITOR_KEYS: Readonly<Record<string, string>> = {
  "3ae11fbf9f": "+94 70 566 7755 · test phone 1",
  ff6bcaf4da: "+94 77 772 1999 · test phone 2",
  db8e69725f: "+94 70 373 6555 · test phone 3",
  "2c67bf487c": "+94 76 799 7818 · Hemas contact",
};

/** Swap a masked "···1234" label for the known test number, when allowlisted. */
export function resolveKnownVisitor(maskedLabel: string): string | null {
  const match = /···(\d{4})/.exec(maskedLabel);
  if (!match) return null;
  return DEMO_KNOWN_VISITORS[match[1] ?? ""] ?? null;
}

/** Indicative Lite plan card (demo values — Phase 5 packaging finalizes). */
export const LITE_PLAN = {
  name: "Lite",
  setup: "LKR 150,000 (demo figure)",
  monthly: "LKR 45,000 / month (demo figure)",
  rows: [
    ["WhatsApp numbers", "1"],
    ["Agent portals", "3 seats"],
    ["AI chatbot", "Included · 3 languages"],
    ["Appointment booking", "Included"],
    ["Contacts", "5,000"],
    ["Bulk campaigns", "8 / month (Phase 3)"],
    ["API requests", "10,000 / month (Phase 4 metering)"],
    ["Channels", "WhatsApp"],
    ["Support", "Local · EN / සිංහල / தமிழ்"],
  ],
} as const;
