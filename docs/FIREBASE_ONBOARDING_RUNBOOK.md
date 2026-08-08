# Firebase onboarding runbook

Status: prepared, not executed  
Current target: local project `demo-hemas-connect` only  
Outbound WhatsApp and real-patient-data modes: disabled

This runbook starts after Nanthan creates the first Firebase/GCP project. It
does not authorize a production deploy, billing change, real patient upload,
Meta connection, or external message.

## 1. Project ownership and environment decision

Before any CLI target is changed, record:

- the exact Firebase project ID;
- whether it is SafeNet demo, Hemas UAT, or Hemas production;
- the Hemas-approved project owners and least-privilege operator groups;
- the billing owner and approved budget alerts;
- the selected Firestore edition, database ID, and immutable location;
- the App Hosting and Functions regions;
- whether any real-patient data is permitted. The default is **no**.

Do not reuse a SafeNet-owned demo project as Hemas production. Hemas UAT and
production must be separately owned, approved, and isolated.

## 2. Console preparation

The project owner completes these provider-side actions:

1. Register a Firebase Web app for the Hemas Connect dashboard.
2. Enable only the approved authentication providers. The local email/password
   fixture is not a production identity design.
3. Create Firestore only after the edition and immutable location are approved.
4. Create Storage only after its location and the server-only object strategy
   are approved.
5. Decide whether App Hosting and Cloud Functions are enabled. Any billing-plan
   change requires explicit owner approval.
6. Configure budget alerts, Cloud Audit Logs, IAM groups, and support contacts.

Do not paste service-account JSON, private keys, Meta access tokens, Flow
private keys, webhook secrets, or patient information into chat, source files,
browser forms, or `.env.local`.

## 3. Local target binding

Keep `.firebaserc` pointed at `demo-hemas-connect` until the exact new project
has been confirmed in the active Google account. Then add an explicit alias
instead of replacing the safe demo target blindly:

```text
firebase login:list
firebase projects:list
firebase use --add
firebase use
```

Recommended aliases:

- `demo` for SafeNet synthetic cloud demo, if one is approved;
- `uat` for Hemas UAT;
- `production` for Hemas production.

Before every provider mutation or deploy, capture the current account, alias,
project ID, Git state, and intended resources. Never depend on an ambient
Firebase target.

## 4. Public web configuration

Copy the registered Web app values into an untracked environment file or App
Hosting environment configuration:

```text
NEXT_PUBLIC_FIREBASE_PROJECT_ID=<exact-project-id>
NEXT_PUBLIC_FIREBASE_API_KEY=<web-app-api-key>
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<approved-auth-domain>
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=<approved-bucket>
NEXT_PUBLIC_FIREBASE_APP_ID=<web-app-id>
```

For the first connected UAT build, retain these hard stops:

```text
NEXT_PUBLIC_APP_STAGE=uat
NEXT_PUBLIC_USE_FIREBASE_EMULATORS=false
NEXT_PUBLIC_EXTERNAL_MESSAGING_ENABLED=false
NEXT_PUBLIC_REAL_PATIENT_DATA_ENABLED=false
```

Firebase Web app configuration identifies a public client; it is not a server
credential. It still belongs in environment configuration so targets cannot be
mixed accidentally. Server credentials and provider secrets must use Secret
Manager and workload identity, never `NEXT_PUBLIC_*` values.

## 5. Backend safe-mode configuration

The existing Functions package fails closed. The first connected UAT runtime
must remain:

```text
HEMAS_RUNTIME_MODE=uat
HEMAS_PROVIDER_MODE=disabled
HEMAS_INTEGRATION_MODE=disabled
HEMAS_AUDIT_SINK_MODE=durable
HEMAS_OUTBOUND_ENABLED=false
HEMAS_APPROVAL_GATE_REQUIRED=true
HEMAS_DIAGNOSIS_ENABLED=false
HEMAS_DEFAULT_TENANT_ID=<approved-uat-tenant-slug>
```

The current repository contains a durable audit implementation only for the
explicit `demo-hemas-connect` loopback Firestore emulator. It contains no
connected-UAT/production audit binding and no live Meta, HIS, LIMS or payment
adapter. Changing a mode to `live` cannot create a working connection and must
not be used to bypass implementation and review. The web configuration parser
also rejects `production`, external messaging and real patient data in this
implementation; enabling them requires a reviewed code change, not an
environment-only switch.

## 6. Pre-deploy verification

Run locally with synthetic data:

```text
npm ci
npm --prefix functions ci
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

Review the generated change set and the exact deployment plan. In particular:

- every new Firestore query has an emulator Rules test and required index;
- backend Admin SDK paths repeat tenant, role, purpose, and schema checks;
- no real identifiers or patient content entered fixtures, logs, or screenshots;
- Storage remains direct-client-deny unless a separately reviewed flow exists;
- production flags and outbound messaging remain false;
- the Functions dependency-audit finding in
  `docs/DEPENDENCY_RISK_REGISTER.md` has been reassessed;
- Security, privacy/DPO, clinical governance, and legal gates are recorded.

## 7. Deployment order after separate approval

Deployment is intentionally not performed by this runbook. Once authorized,
use a staged sequence so each acceptance surface can be verified independently:

1. IAM, budgets, logging, Secret Manager, and service identities.
2. Firestore indexes and Rules to an empty UAT database.
3. Storage Rules with no public/client object workflow.
4. Backend safe-mode functions with outbound networking blocked by application
   adapters.
5. App Hosting UAT build with synthetic data only.
6. UAT Auth and role assignments through a server-managed process.
7. Browser, emulator, log, and negative-access acceptance evidence.

Do not proceed to Meta, Hemas system adapters, or real-patient UAT merely
because the web app deployed successfully.

## 8. Connected-UAT acceptance gate

The connected UAT phase passes only when all are true:

- the observed Firebase account and project match the intended UAT target;
- sign-in, revocation, tenant isolation, team/location scoping, and audit paths
  work against UAT—not only emulators;
- the dashboard displays `UAT`, `external messaging off`, and `real patient
  data off` from its deployed configuration;
- no production Meta number, WABA, HIS, LIMS, or payment system is connected;
- a clean synthetic user journey works on desktop and phone;
- failures are visible without exposing whether an unauthorized record exists;
- monitoring and rollback ownership are documented.

## 9. Later Meta phase

Meta onboarding is a separate provider workflow. It requires Hemas-owned or
explicitly approved WABA and phone assets, business verification, permissions,
signed webhook verification, current templates, consent migration, portfolio
capacity, and a real-device canary. A connected Firebase project does not
authorize or prove any of those gates.
