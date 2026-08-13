# Hemas Connect

Hemas Connect is a governed, multi-tenant patient-engagement workspace for
WhatsApp operations, appointments, secure lab-report notifications, campaigns,
care automations, consent, and audit oversight.

The Enterprise workspace remains a **synthetic SafeNet demonstration** with
external messaging and real-patient-data modes disabled. A separate Hemas
Connect Lite lane contains a governed Meta canary. Proactive templates,
campaigns, and operator sends remain tightly allowlisted. A separate exact
public-inbound test switch may let any valid sender initiate a bot conversation;
those return routes are encrypted, short-lived, rate-limited, and cannot be used
for proactive messaging. Unknown public free text can be forwarded in memory
to the governed AI answerer only after bounded sender/global AI quota; neither
the question nor generated answer is persisted, and deterministic fallback
remains available when AI is unavailable or the quota is exhausted. The bot
includes a no-medical-data/no-emergency-use notice in every reply. Public mode
also requires a time-bounded kill switch of no more than seven days; operational
tests should use a shorter window. This is not equivalent to production
acceptance.
Neither lane is connected to a hospital information system or laboratory
information system.

The exact implemented-versus-pending boundary is maintained in
[`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md).
The controlled management-demo and one-number acceptance sequence is in
[`docs/MANAGEMENT_DEMO_RUNBOOK_2026-08-12.md`](docs/MANAGEMENT_DEMO_RUNBOOK_2026-08-12.md).

## Local setup

Requirements: Node.js 22 for the full web-and-Functions workspace and Java for
the Firebase emulators.

```bash
npm ci
npm --prefix functions ci
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. For Firebase Auth, Firestore, and Storage:

```bash
npm run emulators
```

In a second terminal, seed the deterministic local Auth identity and synthetic
PRD graph: staff-safe contacts plus server-only secrets, consent,
content-free conversation/message metadata, appointment and laboratory
workflows, template/Flow catalogue, a governed aggregate 50,000-record campaign
with zero recipients, teams, locations, simulator routing and the locked
onboarding tenant:

```bash
npm run emulators:seed
```

Then open `http://localhost:3000/login`. The synthetic emulator credentials are
kept in the private presenter/operator note; no password is embedded or shown
by the app, and the local fixture cannot authorize the governed cloud runtime.

The emulator-only Firebase project ID is `demo-hemas-connect`. The `demo-`
prefix prevents accidental access to live Firebase resources.

`npm run emulators` supplies explicit demo/synthetic/durable-audit settings to
the local Functions process while retaining outbound, diagnosis and real-data
hard stops. The audited appointment and governed-campaign callables are
therefore available only on the loopback emulator; there is no cloud fallback.

## Verification

```bash
npm run lint
npm run typecheck
npm run test
npm run test:rules
npm run test:functions
npm run emulators:verify-seed
npm run emulators:verify-audit
npm run emulators:verify-functions
npm run emulators:verify-ingress
npm run build
```

Run the same gates as one sequential clean-room check with `npm run validate`.
The current exact evidence and persisted-versus-local boundary are recorded in
[`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md).

## Production boundary

Do not enable real messaging or patient data from environment flags alone.
Production activation additionally requires a Hemas-owned Firebase/GCP project,
Hemas-owned Meta assets, approved templates, current consent evidence, clinical
and DPO approval, Security Rules/IAM review, signed webhook verification, and
real-device acceptance tests. See
[`docs/HEMAS_WHATSAPP_PLATFORM_PRD.md`](docs/HEMAS_WHATSAPP_PLATFORM_PRD.md).

When the first Firebase project has been created, follow
[`docs/FIREBASE_ONBOARDING_RUNBOOK.md`](docs/FIREBASE_ONBOARDING_RUNBOOK.md).
The current local product journey is listed in
[`docs/SYNTHETIC_DEMO_ACCEPTANCE.md`](docs/SYNTHETIC_DEMO_ACCEPTANCE.md).
The current transitive Functions audit gate is recorded in
[`docs/DEPENDENCY_RISK_REGISTER.md`](docs/DEPENDENCY_RISK_REGISTER.md).
