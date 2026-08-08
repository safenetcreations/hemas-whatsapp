# Phase 5 Firestore persistence and Rules audit

Status: implementation working document for the SafeNet synthetic demo. This is
not evidence of a production Firebase deployment or a Hemas-owned integration.

## Target and edition boundary

- Configured Firebase project: `demo-hemas-connect`.
- The project is an emulator-only identifier in this workspace. A read-only
  Firestore database metadata request returned HTTP 403, so no production
  database or production edition is claimed.
- The acceptance target requested for this phase is the Standard Firestore
  emulator. Firestore timestamps are stored as native `timestamp` values and
  converted to canonical ISO strings only at repository boundaries.

## Authoritative Phase 5 paths

All documents are below `workspaces/{workspaceId}` and repeat `workspaceId`.

Staff-safe and governance collections (13):

1. `automationDefinitions/{definitionId}`
2. `automationActivations/{family}`
3. `automationDefinitionEvents/{eventId}`
4. `automationRuns/{runId}`
5. `automationRunEvents/{eventId}`
6. `automationWorkItems/{workItemId}`
7. `carePathways/{pathwayId}`
8. `carePathwayActivations/{family}`
9. `carePathwayEvents/{eventId}`
10. `careEnrollments/{enrollmentId}`
11. `careEnrollmentEvents/{eventId}`
12. `careEscalations/{escalationId}`
13. `careHandoffs/{handoffId}`

Client-denied secret and receipt collections (10):

1. `automationDefinitionSecrets/{definitionId}`
2. `automationTriggerReceipts/{receiptId}`
3. `automationRunSecrets/{runId}`
4. `automationRunEventSecrets/{eventId}`
5. `automationWorkItemSecrets/{workItemId}`
6. `carePathwaySecrets/{pathwayId}`
7. `careEnrollmentReceipts/{receiptId}`
8. `careEnrollmentSecrets/{enrollmentId}`
9. `careEnrollmentEventSecrets/{eventId}`
10. `careEscalationSecrets/{escalationId}`

Existing `auditEvents` and `consentRecords` are exact governance/evidence joins,
not new Phase 5 collections.

## Identity and confidential-data assumptions

- Public document `id` must equal its document path ID.
- Activation document IDs are exactly `appointment_service`,
  `laboratory_service`, and `post_discharge` and equal their `family` field.
- Each non-receipt secret document is keyed by its matching public definition,
  run, event, work-item, pathway, enrollment, or escalation ID.
- Receipt IDs equal their canonical managed-key HMAC fingerprints. Raw provider
  event IDs, discharge IDs, patient identifiers, recipient lists, clinical
  text, medication data, message bodies, provider responses, and raw errors are
  forbidden from staff-safe documents.
- Every automation run event has a same-ID secret projection and its public
  `evidenceFingerprint` must equal the secret `contextFingerprint` HMAC.
- Care enrollment secrets carry the exact receipt ID, receipt HMAC, source
  discharge SHA, and qualifying discharge timestamp required for a no-query
  receipt join.
- Automation and care receipts must bind the exact activation event, may not
  predate that activation, and must have the same `createdAt` as the run or
  enrollment created atomically with them. Care discharge evidence must also
  be no later than receipt creation; contact schedules remain derived from the
  immutable discharge timestamp rather than receipt time.
- Immutable versions never carry an `active` boolean. The activation pointer is
  the sole active-version record.

## Client read and query surface

- Every Phase 5 client create, update, and delete is denied.
- Every client get and list of the ten secret/receipt collections is denied.
- Automation catalogue get/list: tenant administrator, supervisor, analyst.
- Automation execution exact get: tenant administrator with workspace-wide
  scope, tenant administrator with assigned scope containing both the document
  team and location, or a supervisor containing that exact team/location pair.
- Care catalogue get/list: tenant administrator, analyst, clinical approver.
- Care execution exact get: tenant administrator with workspace-wide scope,
  tenant administrator with assigned scope containing both the document team
  and location, or a clinical approver containing that exact team/location
  pair.
- Agents have no Phase 5 access. Clinical approvers have no automation access;
  supervisors have no care access. Analysts receive catalogue access only.
- Catalogue queries are bounded to 100 documents. Execution list queries are
  intentionally deferred; current repositories expose exact gets only.

Repository query shapes:

- Automation definitions: `family ==`, `version DESC`, `limit <= 100`.
- Automation definition events: `definitionId ==`, `revision DESC`,
  `limit <= 100`.
- Care pathways: `family == post_discharge`, `updatedAt DESC`,
  `limit <= 100`.
- Care pathway events: `pathwayId ==`, `revision DESC`, `limit <= 100`.
- Activation, execution, handoff, and audit records: exact document gets.
- Trusted backend consent decision: equality on `contactId`, `teamId`,
  `locationId`, `purpose`, `channel`, and `category`; `capturedAt DESC`;
  `limit(2)` so tied-latest evidence fails closed.

The persisted Phase 5 audit wire reuses the existing immutable Firestore audit
shape: `id`, `workspaceId`, `actorUid`, `actorType`, `action`, `resourceType`,
`resourceId`, `outcome`, `requestId`, `occurredAt`, `createdAt`, `metadata`,
`synthetic`, and `schemaVersion`. Catalogue lifecycle metadata is exactly
`eventId`, `revision`, `synthetic`, `externalDispatchCount`, and
`networkCallCount`. Runtime automation/care action audit metadata additionally
requires a lowercase 64-hex `resultFingerprint`; lifecycle audits must not
carry that runtime-only field.

## Deterministic emulator graph

- Exactly 51 Phase 5 documents are seeded: 41 automation documents and 10 care
  documents, across the frozen 13 staff/governance and 10 secret/receipt
  collection contract. Collections without an initial lifecycle artifact are
  verified empty rather than populated with fake execution history.
- Exactly 28 immutable lifecycle events each have one exact `auditEvents` join:
  24 across six automation versions and four for the approved care pathway.
- Automation history contains three appointment and three laboratory versions,
  two active-family pointers, and one pristine queued appointment run. Care
  contains one approved pathway/activation and one pristine queued enrollment.
- Six purpose-safe, immutable, locally approved care utility template fixtures
  are added without any provider-approval claim. Together with the existing
  appointment utility template, all seven canonical content hashes are
  recomputed. Global template count is 12; the governed campaign remains bound
  to exactly its three marketing templates, and Flow count remains 18.
- The original appointment `service` consent remains intact. A distinct exact
  `utility` consent fixture is added for Phase 5, bringing the total immutable
  consent evidence count to seven.
- The care enrollment resolves a dedicated seventh synthetic conversation in
  `automation` mode for its fixed clinical team/location. The original urgent
  conversation remains a separate `safety_hold` fixture, so executable care
  verification does not weaken or overwrite the urgent-language safety demo.
- Seed-run-current native timestamps provide MFA/recent-auth evidence for the
  authenticated emulator administrator and fixed governance/controller
  memberships. Fixed supervisor and clinical UIDs are governance fixtures, not
  claims that those UIDs can sign in through the Auth emulator.
- The privileged verifier parses every seeded Phase 5 document, recomputes
  definition/pathway approval and secret bindings, resolves activation/event/
  audit proofs, validates receipt-to-aggregate joins and allowlisted protected
  references, requires zero external/network counters, rejects stale `active`
  flags and protected staff keys, and checks all ten secret/receipt collections
  remain unavailable to the authenticated client.

## Rules expression-budget design

- Reuse the existing authenticated membership and active workspace reads: at
  most two unique document paths per Phase 5 read.
- Do not perform activation, definition, receipt, audit, event, or secret joins
  in Rules. Trusted transactions and strict repository/seed verification own
  those joins.
- Exact-get Rules validate path identity, workspace, strict top-level keys,
  primitive types, bounded strings/lists, native timestamps, schema version,
  synthetic marker, and zero external/network counters.
- Bounded catalogue lists rely on trusted server writers plus strict
  whole-result repository parsing. Firestore Rules cannot safely iterate and
  validate up to 32 nested steps/contact points within the expression budget.

## Required indexes

- Catalogue history indexes matching the four query shapes above.
- Consent decision composite index over the six equality fields followed by
  `capturedAt DESC`.
- Future scoped execution indexes may be declared now, but no browser execution
  list API is approved in this milestone.
- Large nested step/contact-point content and every protected reference or
  fingerprint that is never queried should be exempted from indexing.

## Red-team acceptance matrix

The Rules emulator suite must reject:

- unauthenticated, cross-tenant, revoked-member, empty-scope, and role-confused
  reads;
- agent Phase 5 reads, clinical automation reads, supervisor care reads, and
  analyst execution reads;
- unbounded catalogue queries and execution collection queries;
- path/document ID or workspace substitution;
- direct create, update, and delete for all 23 collections;
- get/list/write attempts against all ten secret/receipt collections;
- schema pollution, protected-field injection, wrong timestamp types, non-zero
  external/network counters, and stale legacy `active` fields;
- receipt replay/substitution, missing or mismatched automation event secrets,
  pre-activation receipts, receipt/aggregate timestamp substitution,
  activation/event/audit substitution, and handoff pointer substitution in
  strict repository and seed verification.

The suite must also demonstrate the intended tenant-admin catalogue/exact-get,
scoped supervisor automation, and scoped clinical care reads without exceeding
the Rules expression budget.

## Verified local acceptance evidence

Verified on 2026-08-08 against the `demo-hemas-connect` local emulators only:

- Firestore started explicitly in Standard edition; the bounded Firestore and
  Storage Rules run passed 66/66 tests across two files.
- The authenticated Auth + Firestore seed run passed the privileged strict
  graph verifier and the tenant-admin client verifier, including exact 51/28
  Phase 5 counts and denial of get/list for all ten secret/receipt collections.
- Root pure tests passed 342/342 across 29 files, repository-focused tests
  passed 10/10, root TypeScript passed, scoped TypeScript ESLint passed, and the
  index file parsed as valid JSON with 32 composite indexes and 50 field
  overrides.
- The separate fresh-seed Phase 5 Functions verifier completed all six
  automation and thirteen care actions. It proved historical replay, changed-
  request same-key conflict survival and post-conflict replay; reconciled one
  resolved automation takeover work item, one released care handoff, one
  resolved safety escalation, nineteen exact event/HMAC-secret/audit/
  idempotency joins and forty-seven total audits; restored tenant-admin
  authority; denied every direct client secret/idempotency read; and retained
  zero external dispatches and zero network calls.
- Emulator processes shut down after each bounded run and all claimed ports
  were released. No browser acceptance, production deploy, Meta connection, or
  Hemas system integration is implied by this evidence.
