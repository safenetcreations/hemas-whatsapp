# Firestore and Storage Access Matrix

Status: strict prototype, 2026-08-07  
Source of product intent: `docs/HEMAS_WHATSAPP_PLATFORM_PRD.md`  
Rules targets: `firestore.rules`, `storage.rules`

## Edition and environment boundary

The local rules suite targets the Cloud Firestore **Standard edition emulator**
for deterministic development. No production Firebase project or Firestore
database exists in this repository, so the production database edition,
location and database ID are intentionally **unselected**. Those immutable or
high-impact choices require Hemas security, residency, latency and service
availability review before provisioning.

The emulator project ID is `demo-hemas-connect`; it is not a deployable
production identity. Rules must be revalidated against the selected production
edition before any UAT or real-patient use.

## Authorization sources

- Firebase Authentication supplies only the caller UID.
- `workspaces/{workspaceId}/members/{uid}` is the server-managed source of
  workspace role, membership status, team scope and location scope.
- Browsers cannot create, update or delete membership documents. This prevents
  self-enrolment, role escalation and scope expansion.
- The workspace document must have `id == workspaceId` and `status == active`.
- Every workspace-scoped operational document must contain a matching
  `workspaceId`.
- Patient-operational documents must also contain `teamId` and `locationId`.
- For non-admin patient-operational roles, empty `teamIds` or `locationIds`
  means **no patient-record access**. It never means unrestricted access.
- `platform_owner` has no direct patient-data permission in these client rules.
  Support access must use a separate, time-bound, approved and audited backend
  process.

## Role groups used by the rules

| Group | Roles | Scope behavior |
|---|---|---|
| Tenant administration | `tenant_admin` | Can read tenant data explicitly listed below; direct authoritative writes still use backend APIs except the synthetic-only, revision-checked contact-preference surface |
| Scoped patient operations | `supervisor`, `agent`, `clinical_approver` | Must match both `teamId` and `locationId`; individual collection restrictions still apply |
| Campaign governance | `campaign_operator`, `campaign_approver` | May read bounded governed campaign aggregates; all campaign mutations use trusted backend controllers and these roles cannot read recipient/patient records |
| Privacy | `privacy_reviewer` | Consent, audit and aggregate surfaces; not message content or raw contact documents |
| Analytics | `analyst` | Aggregate and non-recipient campaign metadata only |
| Platform operations | `platform_owner` | May read non-patient workspace/reference metadata available to any active member and their own membership; no patient-data browsing or tenant-admin configuration access |

## Firestore collection matrix

`R` means a direct client read may be allowed after all tenant, document-ID and
scope checks. `C`/`U` mean the narrowly defined client mutation is allowed.
`Server` means Firebase Admin SDK/backend only. A blank cell means denied.

| Path below `workspaces/{workspaceId}` | Data class | Client read | Client create | Client update | Client delete | Important conditions |
|---|---|---|---|---|---|---|
| workspace document | Tenant configuration | Active member | Server | Server | Server | Document `id` equals path ID; workspace active |
| `members/{uid}` | Access authority | Self; tenant admin | Server | Server | Server | UID, document ID and workspace must agree; browser can never change role/status/scope |
| `teams/{teamId}` | Routing reference | Active member | Server | Server | Server | Matching workspace and ID; collection lists are bounded to 100 |
| `locations/{locationId}` | Service-point reference | Active member | Server | Server | Server | Matching workspace and ID; collection lists are bounded to 100 |
| `whatsappConnections/{id}` | Provider configuration metadata | Tenant admin | Server | Server | Server | No access token is stored; secret references still remain admin-only |
| `contacts/{id}` | PII/pseudonymous identity | Tenant admin; scoped patient operations | Server | Tenant admin, synthetic preferences only | Server | Client update is limited to language preferences, approved tags, revision and server timestamp in a local/demo `synthetic_only` workspace; every identity, suppression, consent and routing field is immutable |
| `consentRecords/{id}` | Privacy evidence | Tenant admin, privacy reviewer, campaign approver; scoped patient operations | Server | Server | Server | Immutable trusted-backend events; contact history queries are bounded and exact-scope for patient operations |
| `conversations/{id}` | Patient interaction | Tenant admin; scoped patient operations | Server | Server | Server | Both team and location must match |
| `messages/{id}` | Minimized message metadata; protected content remains separate | Tenant admin; scoped patient operations | Server | Server | Server | Current repository accepts only strict content-free metadata; no client-authored provider status or dispatch |
| `handoffSessions/{id}` | Patient-operation state | Tenant admin; scoped patient operations | Server | Server | Server | Human takeover transitions are audited backend actions |
| `internalNotes/{id}` | Staff-only protected content reference | Tenant admin; scoped patient operations | Server | Server | Server | Browser reads only backend-authored protected references; the audited callable owns creation and no note body is stored |
| `aiRuns/{id}` | AI decision evidence | Tenant admin; scoped patient operations | Server | Server | Server | No hidden reasoning; content/reference minimization belongs in backend schema |
| `knowledgeDocuments/{id}` | Approved internal knowledge metadata | Tenant admin, supervisor, agent, clinical approver | Server | Server | Server | Object content is not directly readable from Storage |
| `templates/{id}` | Singular-language synthetic template version metadata | Tenant admin, supervisor, agent, campaign operator, campaign approver; analyst exact-get for the three fixed campaign v3 versions only | Server | Server | Server | Catalogue lists are bounded to 100 and remain denied to analysts. Each strict record carries a recomputable content hash over message components, buttons and variable governance. `localState` is internal SafeNet-demo governance only and never means Meta approval; provider state remains separately evidenced. The campaign binds exact internal-approved `wellness_awareness` v3 IDs and verified hashes for en/si/ta while all three remain provider `not_submitted`/`unverified`, non-transferable and non-production; the separate Sinhala v4 draft remains distinct |
| `flows/{id}` | Singular-language synthetic WhatsApp Flow version metadata | Tenant admin, supervisor, agent, campaign operator, campaign approver | Server | Server | Server | Lists are bounded to 100. Flow/provider state and endpoint changes are server-only; every seeded provider state is `not_submitted`/`unverified`, and no signed-token material is stored here |
| `flowSessions/{id}` | Patient/session correlation | Tenant admin; scoped patient operations | Server | Server | Server | Requires denormalized team and location scope; expiry is also checked in backend |
| `appointments/{id}` | Patient workflow view | Tenant admin; scoped patient operations | Server | Server | Server | Every direct client mutation is denied. The audited appointment callable alone may request the two simulator pending states through an Admin SDK transaction; no client may assert confirmation, cancellation or HIS sync |
| `appointmentEvents/{id}` | Immutable appointment transition evidence | Tenant admin; scoped patient operations | Server | Server | Server | Every direct client mutation is denied. The audited callable creates path/action/actor/revision/scope-bound immutable evidence and handles deterministic replay server-side |
| `labReports/{id}` | Strict staff-safe laboratory workflow metadata | Tenant admin; scoped patient operations | Server | Server | Server | Exact read schema permits only workflow/collection/ready/notification metadata plus safe handoff mode/availability/expiry. External report references, notification fingerprints and protected handoff references are absent from the document and rejected by Rules and the client parser |
| `labReportSecrets/{labReportId}` | Protected laboratory report references |  | Server | Server | Server | Exact path-bound server record stores `externalReportRef`, notification fingerprint and protected `secureAccess.handoffRef`; every client get/list/write is explicitly denied |
| `labReportEvents/{id}` | Strict staff-safe immutable laboratory workflow evidence | Tenant admin; scoped patient operations | Server | Server | Server | Exact read schema rejects idempotency fingerprints and all unknown fields; backend-owned simulator/workflow metadata only |
| `labReportEventSecrets/{eventId}` | Protected immutable-event fingerprint |  | Server | Server | Server | Exact path-bound server record stores the event idempotency fingerprint; every client get/list/write is explicitly denied |
| `campaigns/{id}` | Governed aggregate campaign state | Tenant admin, campaign operator, campaign approver, analyst | Server | Server | Server | Strict direct-get schema and strict list parser; simulation-only approval, exact template map, revision/progress/canary/checkpoint state, zero external/network calls, and no recipient or patient fields |
| `audienceSnapshots/{id}` | Immutable aggregate audience summary | Tenant admin, campaign operator, campaign approver, analyst | Server | Server | Server | Reconciles 50,000 total, eligible/excluded/unknown-consent, exact exclusion/language maps and audience-only content hash; no recipient array |
| `campaignEvents/{id}` | Immutable campaign state-transition evidence | Tenant admin, campaign operator, campaign approver, analyst | Server | Server | Server | Exact action/from/to/revision contract; only `advance_batch` binds a checkpoint; zero external/network calls |
| `campaignCheckpoints/{id}` | Immutable aggregate batch progress | Tenant admin, campaign operator, campaign approver, analyst | Server | Server | Server | Raw half-open source offsets, batch-only eligible/language counts, cumulative progress, deterministic digest and checkpoint identity; no recipient data |
| `campaignRecipients/{id}` | Per-recipient/patient worker state |  | Server | Server | Server | Entire collection is backend-only and deliberately unseeded; governed client DTOs contain no recipient array or patient fields |
| `automationDefinitions/{id}` | Versioned care/workflow definition | Tenant admin, supervisor, clinical approver, analyst | Server | Server | Server | Clinical approval and versioning use backend APIs |
| `automationRuns/{id}` | Patient workflow execution | Tenant admin; scoped patient operations | Server | Server | Server | Trigger/retry/provider state remains server-only |
| `integrations/{id}` | Adapter configuration | Tenant admin | Server | Server | Server | Secret material belongs in Secret Manager, never Firestore |
| `auditEvents/{id}` | Append-only evidence | Tenant admin, privacy reviewer; other active members only for their own `actorUid` | Server | Server | Server | Server-only was chosen over client-authored audit evidence |
| `usageLedger/{id}` | Cost/metering detail | Tenant admin | Server | Server | Server | Analysts use minimized aggregates |
| `dailyMetrics/{id}` | Aggregate analytics | Admin, supervisor, campaign roles, analyst, privacy reviewer | Server | Server | Server | Must not contain patient-identifying dimensions |
| `idempotencyKeys/{id}` | Backend replay evidence |  | Server | Server | Server | Explicit client deny for reads and writes; Admin SDK kernel must enforce tenant, actor, action, request-hash and replay binding |
| Unknown workspace subcollection | Unknown |  |  |  |  | Explicit default deny |

## Server-only global collections

The following paths deny every client read and write: `phoneRoutes`,
`wabaRoutes`, `webhookEvents`, `jobLocks` and `platformAudit`. They are used by
trusted provider ingress and worker services only.

## Client-write validation contract

### Synthetic contact preferences and tags

- Only a `tenant_admin` may update this surface, and only when the workspace is
  active, in `local` or `demo` mode, and classified `synthetic_only`.
- The contact must already be synthetic and match the tenant path. Creation and
  deletion remain server-only.
- The only mutable fields are `preferredLanguage`, `alternateLanguages`,
  `tags`, `preferenceRevision`, and `updatedAt`; `diff().affectedKeys()` makes
  identity, routing, suppression, consent-related and timestamp authority
  fields immutable to the client.
- Languages are limited to `en`, `si`, and `ta`; alternate languages are
  unique, contain at most two values, and cannot repeat the preferred language.
- Tags contain only the six approved non-clinical operational labels, with no
  duplicates. Arbitrary or inferred health-condition tags are rejected.
- `preferenceRevision` must increase by exactly one and `updatedAt` must equal
  `request.time`. The repository uses a Firestore transaction plus the caller's
  expected revision, so a stale concurrent edit fails closed.

### Governed campaign aggregates

- Every campaign, audience snapshot, immutable event and checkpoint write is
  denied to clients. A trusted backend owns state transitions, optimistic
  revision checks, idempotency, approval invalidation and audit evidence.
- Only `tenant_admin`, `campaign_operator`, `campaign_approver` and `analyst`
  may read bounded workspace aggregates. Supervisor, privacy-reviewer,
  patient-operation, revoked, unauthenticated and cross-tenant access is denied.
- The seed owner and approver are distinct active `assigned` members with empty
  patient scopes. Campaign governance access does not grant patient-record
  access.
- Every strict template version stores the lowercase SHA-256 of its canonical
  v1 content tuple: identity/language/version, order-preserving message
  components and buttons, and all variable-rule governance. Parser, seed and
  backend validation reject a stored-hash mismatch, message drift, button drift,
  missing rules and unknown placeholders.
- Approval scope is `simulation_only`. `approvedContentHash` is the lowercase
  SHA-256 of a canonical v2 binding over workspace/campaign IDs, audience
  snapshot ID and audience content hash, each exact en/si/ta template ID paired
  with its independently verified content hash, purpose, message category,
  target action and Asia/Colombo schedule/quiet hours. This invalidates approval
  when either a template reference or its governed content changes.
- The client repository validates exact document schemas, tenant/path joins,
  aggregate reconciliation, deterministic checkpoint suffixes and progress.
  It exact-gets campaign-bound templates and independently verifies their
  content hashes; analysts never receive a general catalogue-list permission.
  Authoritative campaign approval-hash recomputation remains in the trusted
  backend and seed verification; the browser only accepts a strict 64-hex
  campaign digest.

### Appointment requests

- Firestore Rules deny every browser create, update and delete on both
  `appointments` and `appointmentEvents`, including tenant admins and users
  with an exact team/location scope. Scoped, bounded metadata reads remain.
- The browser can only invoke the local `demoRequestSyntheticAppointment`
  callable with the verified Firebase Auth session and exact workspace,
  appointment, team, location, action, expected revision and deterministic
  idempotency identity. There is no direct repository transaction fallback.
- The callable is the sole mutation boundary. It revalidates the active
  workspace, UID, role and exact patient scope, then uses one Admin SDK
  transaction to update the simulator appointment and create immutable event,
  idempotency and redacted audit evidence.
- Only `request_reschedule` and `request_cancellation` are accepted, producing
  simulator-only pending states. The service fails closed outside
  demo/synthetic/outbound-off configuration and performs zero provider, HIS,
  network or outbound calls.
- Admin SDK bypass is deliberately not represented as a Rules allow. Its
  authorization, optimistic revision, replay/collision and audit contracts are
  verified at the Functions service boundary and by local emulator E2E.

### Internal notes

- Every direct client create, update and delete is denied. The former direct
  client writer was removed so callers cannot bypass the purpose-bound audited
  callable.
- Scoped reads remain available only for synthetic local/demo metadata records.
  The repository accepts a protected reference and fixed note kind, never a
  note body or free-form clinical text.

## Query contract

Firestore Rules are not filters. Patient collection queries must include both
the caller's permitted `teamId` and `locationId`; unscoped queries over mixed
patient data will be denied for non-admin roles. Every client collection query
must use a limit of at most 100 documents. Tenant admins may run bounded lists
within their tenant path; supervisors, agents and clinical approvers must use
exact permitted `teamId` and `locationId` filters. Backend list endpoints must
enforce the same scope and bounded pagination.

`firestore.indexes.json` contains provisional indexes for the PRD access
patterns. The typed repository now covers workspace access; bounded
team/location references; full synthetic contact preference/suppression and
conversation lists; per-contact immutable consent history; per-conversation
content-free message metadata; revision-checked contact preferences;
scoped appointment metadata and immutable appointment/laboratory event
histories; scoped laboratory workflow metadata; and bounded
backend-authored protected-reference internal-note lists. It also covers
bounded governed campaign lists ordered by `updatedAt`, per-campaign audience
snapshots ordered by `finalizedAt`, events ordered by authoritative `revision`, and
checkpoints ordered by descending `batchIndex`. Consent and message queries
constrain the contact/conversation plus team and location, order by their
authoritative timestamp, and use matching composite indexes. The note query
also constrains `synthetic == true`. Emulator integration tests prove the
tenant-admin and exact non-admin scope contracts, limits, role denials, and
cross-tenant failure. Each additional real `where`, `orderBy`, `limit` and
cursor combination must still be reconciled with this matrix and tested before
release. Large encrypted or nested content fields are exempted from indexing
where they are not query keys. The protected laboratory secret fields are also
explicitly exempted from indexing and have no client or composite-query path.
The campaign repository also exposes strict direct gets for a checkpoint-bound
event and each campaign-bound template, avoiding broader list permissions or an
assumption that the newest referenced record is still inside a 50-record page.

## Cloud Storage matrix

| Object class | Direct client read | Direct client write | Intended path |
|---|---:|---:|---|
| Patient/message content | No | No | Authenticated backend or short-lived purpose-bound link after authorization |
| Consent evidence | No | No | Backend only |
| Imports and exports | No | No | Backend job with malware scanning, minimization, expiry and audit |
| Internal-note bodies | No | No | Protected backend content service referenced by Firestore note |
| Approved knowledge files | No | No | Backend retrieval after role and approval checks |
| Provider payloads and temporary files | No | No | Backend workers only |
| Unknown/public objects | No | No | No public bucket surface in this prototype |

Storage is deliberately server-only because Rules cannot provide field-level
redaction, purpose limitation, clinical authorization, virus scanning or
complete audit on their own. Any future client upload/download flow requires a
separate object schema, metadata validator, size/content-type rules and hostile
emulator tests before it is enabled.
