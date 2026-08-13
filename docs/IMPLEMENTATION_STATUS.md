# Hemas Connect implementation status

Snapshot: **2026-08-12**
Current product state: **local management-demo candidate with governed Enterprise
synthetic data and a private, allowlisted Lite WhatsApp canary; not yet deployed or
verified as live production**

This section is the authoritative current summary. The detailed 8 August snapshot
below is retained only as historical implementation evidence and must not be used
as the release status.

## Current 12 August release summary

- Full and Lite use one Hemas-branded platform with explicit Enterprise-synthetic
  and Lite-canary truth boundaries. Public credential prefills and client-visible
  tester numbers/passwords have been removed.
- Full Analytics now reads authenticated aggregate-only WhatsApp metrics in real
  time, provides eight KPIs, an accessible 14-day chart/table and aggregate CSV,
  while keeping the deterministic scenario model separately labelled.
- Inbox-to-CRM opens the exact existing lead/contact without duplicating it. Lite
  contacts remain an internal governed CRM projection; a third-party CRM connector
  is intentionally not claimed until Hemas selects a vendor and field contract.
- The Lite WhatsApp lane has transactional ownership, service-window checks,
  current suppression checks, durable operation IDs, provider-route evidence,
  STOP-aware campaign boundaries and evidence-only recovery for reply, booking,
  campaign and fatal Meta outcomes. Recovery controls never resend an ambiguous
  provider operation.
- Signed webhooks bind the exact WABA and phone-number asset, reject oversized
  batches without truncation, minimize sender evidence, persist a mode-bound
  idempotent outbox plan and stop automation during human takeover.
- Firestore is pinned to Standard database `(default)`. Browser access to provider
  receipts, effect journals, reservations, routes and reconciliation evidence is
  explicitly denied; private Functions enforce verified claims and current active
  membership.
- Operator tooling is dry-run-first for claim grant/revoke, membership disable,
  token revocation and historical receipt retention. The tracked-sensitive scan is
  part of `npm run validate`.
- One production architecture gate remains intentionally unprovisioned: deferred
  Meta outbox work has a private bounded recovery control but no scheduled wake-up.
  Adding Cloud Scheduler/Tasks (or an equivalent paid queue) requires explicit
  architecture and cost approval; the management demo must follow the manual
  recovery step in the runbook.
- Desktop/mobile zero-network smoke evidence and the presenter procedure are in
  `output/playwright/SMOKE_TEST_2026-08-11.md` and
  `docs/MANAGEMENT_DEMO_RUNBOOK_2026-08-12.md`.

<!-- FINAL_VALIDATION_SUMMARY -->
Final integrated validation passed on Node 22.23.2 on 12 August 2026:

- tracked-sensitive scan, ESLint and TypeScript: passed;
- root unit/model/UI tests: 611/611 passed;
- Firestore and Storage Rules: 89/89 passed in Standard emulators;
- Functions: 293 passed, two emulator-dependent tests intentionally skipped,
  zero failed;
- fresh seed, durable audit, authenticated Functions, Phase 5, Compliance and
  signed-ingress emulator verification: passed with outbound/network paths locked;
- Next.js production build: passed with 28 static routes.

## Archived implementation snapshot — 8 August 2026

The remainder of this document describes the earlier emulator-only milestone and
its then-current limitations.

## What is implemented

### Product and architecture

- Full product requirements and phased delivery plan in
  `docs/HEMAS_WHATSAPP_PLATFORM_PRD.md`.
- Standard Next.js 16, React 19, TypeScript, Tailwind, Firebase client,
  Firebase App Hosting configuration and Cloud Functions v2 workspace.
- Cloudflare/Vinext/D1 starter paths were removed rather than mixed into the
  Firebase architecture.
- Responsive no-index portal shell with 20 statically prerendered routes.
- Every local portal route is guarded by a verified Firebase Auth session plus
  an active Firestore workspace membership. Live membership revocation signs
  the browser out and hides the portal.
- Public configuration and client service factories reject non-loopback hosts,
  non-demo projects, cloud fallback, external messaging and real-patient mode.

### Authenticated persisted workspaces

- **Contacts:** six strict staff-safe contact records, immutable consent
  evidence, bounded role/team/location reads, preference and tag revisions,
  conflict recovery and source-backed STOP protection. Protected lookup and
  external-patient references are paired in client-denied `contactSecrets`.
- **Inbox:** seven scoped conversations and seven content-free message metadata
  records with authenticated filtering and safe local interaction controls.
  No message body, phone number or provider credential is stored or sent.
- **Appointments:** one scoped simulator appointment plus immutable events.
  Reschedule and cancellation are request-only transitions through an
  authenticated, audited local Functions callable. The transaction atomically
  writes pending state, immutable event, server-only idempotency evidence and a
  redacted audit record. Direct client writes are denied for every role.
- **Laboratory:** one read-only staff-safe workflow plus immutable event.
  External report references, handoff references and fingerprints are removed
  from client-readable documents and paired atomically in client-denied
  `labReportSecrets` and `labReportEventSecrets` collections.
- **Templates and Flows:** twelve strict synthetic template versions and 18
  Flow variants. The original six journeys cover English, Sinhala and Tamil;
  six additional immutable utility templates support the governed Phase 5 care
  check-ins.
  SafeNet internal governance is distinct from provider evidence. Every seed is
  `not_submitted` and `unverified`; direct catalogue writes are denied.
- **Campaigns:** one governed 50,000-record aggregate audience snapshot and
  simulation campaign. An authenticated local Functions callable owns canary,
  start, bounded batch, pause, resume, recoverable-fault, retry, completion and
  cancellation transitions. The browser has aggregate read authority only;
  every mutation writes immutable event, checkpoint when applicable, redacted
  audit and private idempotency evidence atomically. No recipient document is
  seeded or created.
- **Automations and governed care (Phase 5):** six immutable automation
  versions across appointment and laboratory families, two activation
  pointers, one queued run, one approved post-discharge pathway and activation,
  and one queued care enrollment. The authenticated UI reads the bounded
  Firestore catalogue and exact execution records and invokes only the fixed
  localhost Functions controls. Functions own every transition, immutable
  event, HMAC-bound secret, redacted audit and idempotency record; all 23 Phase
  5 collections deny direct client writes and all ten secret/receipt
  collections deny client reads.
- **Compliance audit timeline:** a server-owned `listComplianceAuditEvents`
  projection returns only minimized, allowlisted audit evidence through the
  local Functions emulator with bounded pages, strict descending cursors and
  outcome filters. The UI implements loading, empty, failure/retry and bounded
  pagination states. Access is limited to a workspace-wide tenant administrator
  or an assigned privacy reviewer; the browser has no raw audit list or write
  authority.
- **Connections:** one staff-safe WhatsApp simulator and two staff-safe
  HIS/LIMS simulators are read with exactly three fixed server gets and no
  collection query, cache or fixture fallback. Physical inventories remain
  exactly `1/2/0/0/2/0` for WhatsApp connections, integrations, WhatsApp
  secrets, integration secrets, phone routes and WABA routes. Every provider,
  network, authoritative-write and external-send gate remains false, and the
  UI exposes no identifiers, endpoints, credentials or mutation controls.

### Remaining local-only product demonstrations

The following workspaces are not yet complete authoritative persisted modules:

- AI & Knowledge, whose corrected persistence contract is in progress while
  the current surface remains deterministic/hardcoded and must not be described
  as a completed persisted workflow or connected AI capability;
- analytics, usage and settings;
- Demo Lab and Help;
- home-collection planning and patient-view Flow navigation.

These surfaces retain explicit simulator labels and have no Meta, Firebase
cloud, Hemas, AI-provider, payment, email or other external mutation path.

### Backend and security foundation

- Strict domain types and deterministic synthetic fixtures, including a lazy
  50,000-recipient campaign generator.
- Deny-by-default Firestore Rules, direct-client-deny Storage Rules and bounded
  query/index coverage for every persisted UI surface.
- Server-only phone routing, contact/laboratory secrets, webhook idempotency,
  provider-semantic claims, audit and service idempotency records.
- Signed raw-body synthetic ingress with HMAC-before-JSON verification,
  authoritative route lookup, monotonic status handling, STOP consent evidence,
  late-event safety protection and no free-form patient content.
- Durable redacted audit utilities and audited appointment, internal-note and
  governed-campaign services bound to the demo project and loopback Firebase
  emulators.
- Server-owned Phase 5 automation/care services with exact metadata-only
  request schemas, MFA/recent-auth gates, immutable governance hashes,
  consent/route joins, replay/conflict protection and zero-network execution.
- A minimized Compliance audit projection that reparses raw v1 audit evidence,
  binds tenant/role/scope/cursor authority and never returns protected raw
  metadata.
- A strict governed Connections v1 parser plus fixed-document, no-cache
  repository contract; partial, malformed or stale-authority results fail
  closed.
- Six signed, expiring synthetic Flow definitions with strict token, schema,
  action, screen, tenant and replay checks. They stop at pending confirmation.
- Live Meta/provider Flow payloads, live adapters, diagnosis and outbound
  messaging fail closed.

## Current verified evidence

The component gates have current passing evidence from bounded pure,
emulator and browser runs on 2026-08-08. This snapshot does not claim that one
fresh monolithic `npm run validate` invocation produced every result below:

- ESLint: passed with zero warnings or errors.
- TypeScript: passed.
- Root unit/model/UI tests: 506/506 passed across 39 files.
- Firestore and Storage Rules: 77/77 passed in clean Standard emulators.
- Functions: 187 passed, 2 emulator-only tests intentionally skipped in the
  189-test pure run, 0 failed.
- Auth + Firestore seed verification: six staff-safe contacts plus six contact
  secrets; one governed WhatsApp simulator, two deterministic zero-network
  integrations and exact physical connection counts `1/2/0/0/2/0`; twelve
  templates and 18 Flow variants; one governed 50,000-record
  campaign plus immutable aggregate snapshot and zero recipients/events/
  checkpoints at seed; seven immutable consent events; seven conversations,
  including a distinct Phase 5 care-control route while the urgent conversation
  remains on safety hold; seven metadata-only messages; one appointment plus
  event; one staff-safe lab workflow/event plus atomic secret pairs; three teams
  and three locations; 51 Phase 5 documents across exactly 13 staff/governance
  and ten server-only collections, joined to 28 immutable lifecycle audits;
  six automation versions, two activations, one queued run, one approved care
  pathway/activation and one queued enrollment. Locked Hemas membership,
  phone/WABA routes, campaign recipients, connection secrets and all other
  secret/receipt collections were denied to the client.
- Durable audit emulator verification: tenant path, sensitive-value redaction
  and replay denial passed.
- Authenticated Functions verification: internal-note and appointment
  first/replay evidence passed. The campaign verifier then executed all 45
  lifecycle actions, independently reconciled all 45 event/audit joins and 39
  canonical checkpoints, replayed old canary/first-batch keys after completion,
  proved same-key conflict survival and retained client-denied idempotency.
  Every verified path had `externalCalls=0` and `networkCalls=0` where defined.
- Phase 5 Functions verification on a separate fresh seed completed six
  automation and thirteen care actions; proved historical replay and changed-
  request conflict survival; reconciled 19 exact event/secret/audit/
  idempotency joins and 47 total audits; resolved the governed work item,
  handoff and safety escalation; restored tenant-admin authority; and retained
  zero external/network calls.
- Compliance Functions verification projected the exact 28-event fresh audit
  set with minimized pagination, allowed/empty outcome filters, strict cursor
  and request bounds, correct workspace-wide-admin and assigned-privacy-reviewer
  authority, hostile-role/scope/revocation/cross-tenant denial, exact membership
  restoration and unchanged datastore counts.
- Connections Rules and static-contract coverage proved active-admin fixed
  gets, governed missing-document behavior, total collection/list/write denial,
  hostile role/authority/schema/source/gate rejection and explicit denial of
  both secret collections plus phone/WABA routes. The fresh seed and browser
  runs independently retained the exact `1/2/0/0/2/0` physical inventory.
- Signed ingress verification: Admin transaction adapter plus HTTP challenge,
  signature-before-JSON rejection, valid persistence and replay passed 2/2.
- Next.js production build: passed; 20 routes prerendered.

Focused authenticated browser QA also passed for Contacts, Inbox,
Appointments, Labs, Template Studio, Campaigns, persisted Phase 5
Automations/Care, Compliance and Connections on desktop and 390-pixel mobile.
Campaign completion reached revision 45 with 45 events/audits/private
idempotency records, 39 checkpoints, 38,443 processed eligible records, raw
scan offset 50,000 and a final batch of 443. A separate fresh seed proved the
cancel branch at revision 1. Role downgrade, zero-recipient, zero browser
Firestore-commit, provider-unverified and zero-call assertions passed. These
runs observed zero horizontal overflow, zero console errors/warnings and only
loopback application/emulator requests. Phase 5 browser E2E exercised all six
automation and thirteen care actions. Compliance rendered and paginated all 28
minimized audit events while preserving raw-audit denial. Connections rendered
the exact persisted `1/2/0/Off` summary from three fixed document gets, issued
no RunQuery/Commit/Write, proved authority revocation and restoration, and left
all six physical inventory hashes/counts unchanged. A follow-up production
browser recheck confirmed the sign-out control lives in the sidebar footer:
one keyboard-reachable control in the 390-pixel drawer and one non-overlapping
desktop sidebar control. These runs do not constitute cloud, provider or
whole-product UAT acceptance.

The detailed Rules caveats are in `docs/FIRESTORE_RULES_AUDIT.md`. These are
prototype controls and evidence, not a production security certification.

## Deliberately not implemented or not proven

- No Firebase/GCP cloud project is selected, bound or deployed.
- No production SSO, MFA, App Check enforcement, staff provisioning or
  server-rendered portal session exists. Current identity is a seeded local Auth
  fixture.
- AI & Knowledge, analytics, usage, settings, Demo Lab and Help are not yet
  complete authoritative persisted modules. The corrected AI persistence
  contract is in progress; the current hardcoded/deterministic surface is not
  claimed complete.
- No Meta Business Portfolio, WABA, phone number, app, permission, webhook,
  template approval, quality, capacity, billing or device delivery has been
  observed.
- Persisted language variants do not imply provider-localized assets. The
  current Flow screen renderer is shared and inert.
- No Hemas appointment/LiveTrack, LIMS, patient identity, portal, payment or
  clinical-record integration exists.
- No real AI model or retrieval provider is connected. Patient-content training
  terms have not been approved.
- No real-patient data, phone number, report body/value, clinical image, payment
  value or production analytics identifier has been processed.
- No DPIA, legal approval, clinical protocol approval, penetration test, formal
  accessibility audit, disaster-recovery test, UAT or production acceptance is
  claimed.

## Open engineering and release risks

1. Firebase Admin SDK bypasses Security Rules; every backend path must continue
   to repeat tenant, role, scope, purpose, schema and audit authorization.
2. The Functions dependency tree has seven moderate transitive audit findings;
   see `docs/DEPENDENCY_RISK_REGISTER.md`. The unsafe forced downgrade was not
   applied.
3. Cloud Functions targets Node 22. The available local emulator used host Node
   20 and warned about the mismatch. Repeat all Functions evidence under Node 22
   before any deployment.
4. The Functions emulator detected host Application Default Credentials. Every
   verified code path was loopback/demo-bound and made no non-emulated call, but
   connected work requires an isolated development identity and explicit
   project controls.
5. App Check is deliberately not enforced in the local callable emulator. It is
   a connected-UAT release gate, not an emulator claim.
6. Every future Firestore query needs a matching Rules/index emulator test.
7. Storage remains direct-client-deny. Signed links, uploads, malware scanning,
   expiry, retention and authorization require a separate threat model.
8. Local build and browser success do not prove provider delivery, inbound Meta
   receipt, reply, handoff, STOP propagation or official-system write-back.

## Next safe sequence

1. Finish the corrected AI & Knowledge persistence contract without connecting
   a model or accepting patient content; external dispatch remains impossible.
2. Persist analytics, usage, settings, Demo Lab and Help with the same scoped
   Rules, audited service and browser-evidence pattern.
3. Re-run the complete clean-room gate plus a current whole-portal desktop and
   mobile sweep after those migrations.
4. When Nanthan creates the first approved Firebase project, confirm the active
   Google account, exact project ID, ownership, billing owner, Firestore
   edition/location and regions before changing any target.
5. Follow `docs/FIREBASE_ONBOARDING_RUNBOOK.md`; keep connected UAT external
   messaging and real-patient data disabled.
6. Treat Meta onboarding as a later, separately authorized phase using
   Hemas-owned assets, fresh approvals and a real-device canary.

No commit, pull request, cloud project creation, billing change, deploy or
external message was performed.
