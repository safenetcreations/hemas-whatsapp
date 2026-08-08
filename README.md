# Hemas Connect

Hemas Connect is a governed, multi-tenant patient-engagement workspace for
WhatsApp operations, appointments, secure lab-report notifications, campaigns,
care automations, consent, and audit oversight.

This repository currently runs only as a **synthetic SafeNet demonstration**.
External messaging and real-patient-data modes are disabled by default. It is
not connected to Hemas, Meta, a hospital information system, or a laboratory
information system.

The exact implemented-versus-pending boundary is maintained in
[`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md).

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

Then open `http://localhost:3000/login`. The visible credentials are synthetic
emulator fixtures and cannot authenticate against a cloud Firebase project.

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
