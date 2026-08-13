# Synthetic demo acceptance script

This script verifies the zero-network local fallback without touching the
existing Firebase cloud project, Meta account, Hemas system, real phone number
or patient data. For the current governed cloud/canary boundary and tomorrow's
walkthrough, use `docs/MANAGEMENT_DEMO_RUNBOOK_2026-08-12.md`.

## 1. Environment and identity proof

1. Start the local emulators with `npm run emulators`, then run
   `npm run emulators:seed` in another terminal.
2. Open `http://localhost:3000/login` and sign in with the privately issued
   synthetic fixture credential. The app must not display or prefill a password.
3. Confirm the portal labels the SafeNet synthetic workspace, external sending
   off, no Hemas/Meta connection and local emulator authority.
4. Confirm a direct portal URL redirects to Login when signed out.
5. Confirm stopping Auth/Firestore or revoking the seeded membership locks the
   portal rather than using cached/cloud data.
6. Browser network inspection must show only loopback application and emulator
   traffic.

## 2. Persisted patient-operation journeys

### Contacts and Inbox

1. Open Contacts and load six tenant-scoped staff-safe records.
2. Edit a language or safe tag, save its next revision, reload and confirm the
   persisted value.
3. In two tabs, create a stale revision and confirm conflict recovery reloads
   authoritative state.
4. Confirm source-backed STOP cannot be cleared and marketing remains
   suppressed without suppressing unrelated utility/care purposes.
5. Open Inbox, filter by language/queue, inspect content-free message metadata,
   take over a normal synthetic conversation and exercise the local reply/resume
   controls.
6. Open the urgent conversation and confirm there is no ordinary composer or
   unsafe AI-resume control.

### Appointments

1. Open Appointments and load the persisted simulator record plus immutable
   seed event.
2. Request reschedule or cancellation. The browser must make one authenticated
   call only to `demoRequestSyntheticAppointment` on the local Functions
   emulator.
3. Confirm revision 0 becomes revision 1, status becomes the corresponding
   pending state and exactly one immutable event appears after reload.
4. Confirm the UI states audited transaction, `externalCalls=0` and no
   Hemas/HIS confirmation.
5. Direct client create/update/delete of appointments and appointment events
   must remain denied for all roles.

### Laboratory

1. Open Labs and load one persisted read-only workflow plus immutable event.
2. Confirm no report value, diagnosis, report body, raw attachment, external
   report ID, fingerprint, handoff reference, contact ID or conversation ID
   appears in the DOM.
3. Confirm only safe handoff availability/expiry metadata is visible.
4. Confirm `labReportSecrets` and `labReportEventSecrets` cannot be read or
   listed by an authenticated browser.
5. Exercise home collection only as page-local state; verify it creates no
   Firestore/LIMS/provider write.

## 3. Persisted Template Studio

1. Load 30 catalogue records: twelve strict template versions and 18 Flow
   variants. The six original definitions span English, Sinhala and Tamil; the
   six additional immutable utility templates are the governed Phase 5 care
   check-ins.
2. Confirm every asset separates SafeNet internal state from provider evidence
   and shows provider `not_submitted` / `unverified`.
3. Select all six definition IDs and advance at least one local screen in each.
4. Confirm Sinhala/Tamil are described as language metadata over a shared inert
   renderer, not as localized Meta assets.
5. Change a template example to an invalid value, observe validation, then
   reset to the persisted example.
6. Simulate a page-local draft and confirm no Firestore write or provider
   submission occurs.
7. Produce a zero-result filter; unrelated detail must disappear and Clear
   filters must restore the catalogue.

## 4. Persisted Campaigns and Phase 5 Automations/Care

1. Open Campaigns and load the persisted aggregate campaign plus its exact
   immutable snapshot and English/Sinhala/Tamil template bindings. Verify
   50,000 evaluated, 38,443 eligible and 11,557 excluded with reasons.
2. Through `demoControlSyntheticCampaign` on the local Functions emulator, run
   canary, start, bounded 1,000-eligible batches, pause, resume, a recoverable
   fault and retry. Completion must reach revision 45, 45 immutable events and
   audits, 39 checkpoints, scan offset 50,000 and final batch 443.
3. From a separate fresh seed, cancel the scheduled campaign and confirm
   revision 1 with no progress or checkpoint. Confirm the browser performs no
   direct Firestore commit and no recipient record is created.
4. Confirm analyst is read-only, an unauthorized role immediately loses the
   prior campaign evidence, every provider asset remains `not_submitted` /
   `unverified`, and all external/network counters remain zero.
5. Open Automations and confirm the persisted catalogue contains six immutable
   automation versions, two activation pointers and one queued run, plus one
   approved post-discharge care pathway/activation and one queued enrollment.
   Do not accept fixture or cache fallback.
6. Through the fixed localhost Functions controls, exercise the complete six-
   action automation sequence and thirteen-action care sequence. Confirm the
   governed work item is resolved, the care handoff is released, the safety
   escalation is acknowledged/resolved, and the urgent safety-hold conversation
   remains isolated from the executable care route.
7. Confirm the resulting 19 runtime events each retain exact secret, redacted
   audit and idempotency joins; historical replay succeeds only with intact
   evidence; changed-request key reuse fails without corrupting the first
   result; and the final audit count is 47.
8. Confirm direct client writes to all 23 Phase 5 collections and client reads
   of all ten secret/receipt collections remain denied. Every runtime result
   must retain zero external dispatches and zero network calls.

## 5. Persisted Compliance and Connections

### Compliance audit timeline

1. Open Compliance as a workspace-wide tenant administrator and load the
   minimized server projection through `listComplianceAuditEvents`; the browser
   must not list or write raw `auditEvents` directly.
2. Page through the exact 28 fresh-seed lifecycle audit events. Confirm strict
   descending `(createdAt, id)` order, no duplicates or skips, allowlisted
   metadata only, bounded cursors and honest loading/empty/error/retry states.
3. Exercise allowed and empty outcome filters. A malformed cursor, oversized or
   polluted request, cross-workspace request and unknown protected field must
   fail closed.
4. Confirm a workspace-wide tenant administrator and an assigned privacy
   reviewer can read; an assigned tenant administrator, wrong role, revoked
   member and cross-tenant member cannot. An authority downgrade must remove the
   timeline before another audit read, and exact membership must be restored
   before re-login.
5. Confirm the 28 raw audit documents and all other datastore inventories are
   byte-unchanged after the read-only browser journey.

### Connections

1. Open Connections as the active tenant administrator and require three fixed
   server reads only: one WhatsApp simulator and the HIS and LIMS simulators.
   There must be no collection/list query, cache or fixture fallback.
2. Confirm the summary is derived from persisted DTOs and reads exactly
   `1/2/0/Off`; physical inventories are exactly `1/2/0/0/2/0` for WhatsApp,
   integrations, both secret collections, phone routes and WABA routes.
3. Read every state, source, timestamp, `Never verified`/`Never` value and all
   six false send/network/write gates literally. Confirm no raw IDs, endpoints,
   credential/secret/provider detail, mutation control, `Connected`, UAT or
   production-ready claim appears.
4. Capture Firestore request bodies and confirm only the three fixed document
   targets, zero RunQuery/list/Commit/Write and loopback hosts. Same-UID wrong
   role or revoked authority must synchronously remove the subtree and issue no
   further Connections reads; restore the original administrator membership and
   re-login.
5. At 390 pixels, the closed page must expose no floating sign-out overlay.
   Keyboard-open the navigation drawer, reach the single visible `Sign out of
   demo` control in its footer, and keyboard-close the drawer. At 1440 pixels,
   confirm the single sidebar sign-out control does not overlap page content.

## 6. Security and quality gates

Run the full sequential gate:

```text
npm run validate
```

Its component commands are:

```text
npm run lint
npm run typecheck
npm run test
npm run test:rules
npm run test:functions
npm run emulators:verify-seed
npm run emulators:verify-audit
npm run emulators:verify-functions
npm run emulators:verify-phase5-functions
npm run emulators:verify-compliance-functions
npm run emulators:verify-ingress
npm run build
```

Do not reuse historical counts as release evidence. Run the current
`npm run validate` from a clean Node 22 shell and retain its full log. The
Phase 5 verifier must complete all 6 automation plus 13 care actions, and the
Compliance verifier must project all 28 fresh audit events without changing
the datastore.

For every browser milestone:

- check desktop and a 390-pixel viewport for horizontal overflow;
- exercise loading, empty, denied, conflict and failure states where practical;
- confirm zero console errors/warnings;
- confirm no unexpected non-loopback request;
- remove or move generated Playwright artifacts out of the repository;
- re-read the Rules audit caveats before making any connected-UAT claim.

## 7. Explicit boundaries

- AI & Knowledge is not accepted as a persisted module. Its corrected
  persistence contract is in progress; the current deterministic/hardcoded
  surface must not be described as complete or as evidence of a connected AI
  model, retrieval system or clinical capability.
- Automatic Analytics now reads aggregate-only authenticated Firestore data and
  is included in local acceptance. Its fixture values are not Hemas performance
  or provider-delivery evidence.
- Usage, Demo Lab and Help retain deterministic/local demonstration surfaces.
  Private Settings recovery controls require governed cloud claims and are not
  exercised by this zero-network fallback.
- Home-collection planning and patient-view Flow navigation remain page-local
  demonstrations.

Passing this script proves only the local synthetic implementation. It does not
prove Firebase cloud deployment, Meta onboarding, approved templates, provider
delivery, Hemas integration, real-patient handling or production readiness.
