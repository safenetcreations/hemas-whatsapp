# Firebase Rules Red-Team Audit

Audit date: 2026-08-07  
Scope: `firestore.rules`, `storage.rules`, `firestore.indexes.json`  
Method: installed Firebase Security Rules Auditor workflow plus deterministic
Firestore Standard emulator tests  
Conclusion: strict **prototype**, not a production security certification

## Assessment JSON

```json
{
  "score": 4,
  "summary": "The prototype is default-deny, tenant-scoped and intentionally routes authoritative healthcare, consent, audit, membership, provider and governed campaign mutations through trusted backend services. Direct campaign, audience-snapshot, campaign-event, checkpoint and recipient writes are denied to every client; only four governance roles receive bounded aggregate reads, and recipient/patient state remains backend-only. Strict bounded read contracts cover the synthetic PRD contact, consent, conversation, message-metadata, appointment, laboratory, campaign, team and location graph. The Standard emulator hostile suite passes. Production edition, complete application query coverage, backend Admin SDK validation and a real-patient threat review remain unresolved, so this is not yet production-approved.",
  "findings": [
    {
      "check": "Business Logic vs. Rules",
      "severity": "moderate",
      "issue": "The initial repository integration exposed and corrected collection-list mismatches. Workspace access, bounded team/location and contact/conversation lists, exact-scope consent/message-metadata queries, transactional synthetic contact preferences, and scoped note lists are now covered, but future repository queries are not automatically proven compatible.",
      "recommendation": "Keep adding emulator integration tests for every concrete where, orderBy, limit, cursor and pagination pattern as repositories are implemented."
    },
    {
      "check": "Authority Source",
      "severity": "moderate",
      "issue": "Firebase Admin SDK services bypass Firestore and Storage Rules, so backend authorization and schema validation are outside this file's enforcement boundary.",
      "recommendation": "Centralize server authorization, validate all Admin SDK mutations, use service-specific identities and emit append-only audit events."
    },
    {
      "check": "PII document separation",
      "severity": "moderate",
      "issue": "Firestore cannot hide selected fields within an allowed document; tenant admins and correctly scoped patient-operation roles receive the whole permitted document.",
      "recommendation": "Keep protected bodies and full identifiers outside broad operational documents, use minimized projections, and complete a field-level data classification before real-patient UAT."
    },
    {
      "check": "Production target",
      "severity": "minor",
      "issue": "Production Firebase project, Firestore edition, database ID and location are intentionally unselected.",
      "recommendation": "Repeat syntax, emulator and integration validation against the Hemas-approved production architecture before deployment."
    }
  ]
}
```

## Phase 1: codebase and data-model analysis

The scan covered the full repository excluding dependencies, with emphasis on:

- `docs/HEMAS_WHATSAPP_PLATFORM_PRD.md`, especially roles, consent, campaign,
  Firestore model and security-rule strategy;
- domain types under `lib/domain`;
- Firebase client setup and `firebase.json`;
- every Firestore SDK query signature (`collection`, `doc`, `where`,
  `orderBy`, `limit`) present at the time of the scan.

The repository now includes a typed Firestore access layer for workspace
membership; bounded team/location references; full synthetic contact
preferences and suppression; bounded conversation metadata; immutable
per-contact consent history; content-free per-conversation message metadata;
optimistic transactional synthetic contact preference updates; read-only
appointment/event metadata; and bounded backend-authored note lists. Its first
end-to-end seed verification exposed a collection-list mismatch: strict
document-ID checks were valid for `get`, but could not be proven for a `list`.
The policy was split into strict `get` and bounded, scope-constrained `list`
rules, then covered by emulator regressions. Every new consent/message query
includes exact tenant-path, contact/conversation, team, location, order and
limit constraints with matching composite indexes. The index file remains an
explicit provisional query contract, not evidence that every future UI query
already works.

The laboratory repository now accepts only an exact staff-safe workflow/event
schema. Protected external report references, notification/idempotency
fingerprints and the simulator handoff reference are rejected by the parser and
do not exist in its DTOs. Those values are split into exact path-bound
`labReportSecrets/{labReportId}` and `labReportEventSecrets/{eventId}` records.
The deterministic seed writes each staff document and its secret record in one
Firestore batch, then verifies one-to-one pairing, tenant/path identity, exact
keys and absence of protected fields from raw staff documents.

The campaign repository exposes only aggregate, recipient-free read models for
`campaigns`, immutable `audienceSnapshots`, immutable `campaignEvents` and
immutable `campaignCheckpoints`. Every parser rejects unknown keys and verifies
the tenant/path/campaign joins, aggregate reconciliation and simulation-only
state. Campaign progress uses raw half-open source offsets and 1,000-eligible
batches; the exact checkpoint suffix and cumulative progress are checked by the
client parser. Event pages use authoritative descending revision order rather
than timestamps, and a strict direct-get recovers the checkpoint-bound event
when it is no longer inside the newest 50 revisions. Each template stores a
canonical v1 content hash over its
identity, order-preserving components/buttons and complete variable governance.
Approval is bound with a canonical v2 SHA-256 serialization to the workspace,
campaign, immutable audience hash, each exact English/Sinhala/Tamil
template-version ID paired with its independently verified content hash,
purpose, category, target action and schedule.
Rules validate the strict direct-get projection and allow only bounded lists to
tenant admin, campaign operator, campaign approver and analyst roles. Every
client mutation and every access to `campaignRecipients` remains denied.
Analysts may exact-get only the three fixed campaign-bound v3 template records;
template catalogue lists, unrelated versions and every Flow remain denied.

Production database edition detection was not performed because no Firebase
project/database has been created. Per project direction, local validation uses
the Standard edition emulator; production edition and location remain
unselected.

The Functions codebase also has a create-only Firestore audit sink that maps a
strict, redacted event into a fixed server-authored schema. Its separate
emulator verifier refuses every project except `demo-hemas-connect`, requires a
loopback `FIRESTORE_EMULATOR_HOST`, persists without cloud credentials, and
proves a duplicate event cannot overwrite the first record. This validates the
serialization boundary only; Admin SDK authorization remains application code
and is not enforced by Rules.

The synthetic appointment request path now has the same explicit backend
boundary. The browser-facing repository exports only strict appointment/event
parsers and bounded list APIs; the former direct transaction and deterministic
client-event helpers were removed. The authenticated local callable validates
workspace, UID, role, exact team/location scope, simulator state, action,
revision and idempotency identity before one Admin SDK transaction persists the
appointment update, immutable event, replay evidence and redacted audit record.
Rules grant no appointment mutation permission to any client role.

## Phase 2: generated policy

The policy implements:

- default deny at unknown workspace paths and at the database root;
- workspace-active and active-membership checks;
- server-managed role/status/team/location authority;
- matching `workspaceId` on every operational read;
- both team and location enforcement for patient-operational reads;
- fail-closed empty scope arrays for non-admins;
- no direct platform-owner patient browsing;
- server-only membership, consent, provider, integration, audit, usage,
  recipient and global routing writes;
- server-only campaign, audience-snapshot, immutable-event and checkpoint
  writes, with bounded aggregate reads limited to tenant admin, campaign
  operator, campaign approver and analyst roles;
- complete client denial for campaign-recipient/patient worker state;
- revision-checked, tenant-admin-only contact preference/tag updates restricted
  to synthetic local/demo workspaces;
- direct-client denial for every internal-note mutation, with scoped reads of
  backend-authored protected-reference metadata;
- scoped and bounded appointment/event reads, with unconditional direct-client
  create, update and delete denial on both collections;
- bounded immutable-consent and content-free message-metadata reads, with exact
  team/location proof required for patient-operation roles;
- bounded team and location reference lists for active members;
- explicit direct-client denial for backend `idempotencyKeys` replay evidence;
- exact staff-safe laboratory report/event schemas on direct gets, strict
  fail-closed repository parsing for bounded lists, plus explicit denial of
  every client get, list and write on both laboratory secret collections;
- native timestamp and immutable identifier enforcement;
- strict allowed-field schemas and bounded strings/lists/maps on every allowed
  client mutation;
- complete direct-client denial for Cloud Storage.

## Phase 3: devil's advocate results

The deterministic suite is `tests/firestore.rules.test.ts`. Each test resets
the emulator and seeds data through `withSecurityRulesDisabled`, so assertions
do not depend on test order.

| Attack | Expected result | Evidence/result |
|---|---|---|
| Public document get | Denied | Passed |
| Public collection list | Denied | Passed |
| Cross-tenant workspace and contact read | Denied | Passed |
| Cross-tenant campaign write using a valid role in another tenant | Denied | Passed |
| Same-tenant record outside member team/location | Denied | Passed |
| Empty non-admin scope arrays treated as unrestricted | Denied; empty is no access | Passed |
| Revoked-member access | Denied | Passed |
| Client read/write of global provider routes | Denied | Passed |
| Client read of the server-seeded synthetic simulator phone route | Denied | Passed |
| Client read/create/update/delete of workspace idempotency evidence | Denied | Passed |
| Public, operational-role or tenant-admin get/list of laboratory secrets | Denied | Passed |
| Tenant-admin create/update/delete of laboratory secrets | Denied | Passed |
| Protected report reference/fingerprint/handoff pollution in staff laboratory documents | Denied | Passed |
| Cross-tenant or path-ID substituted laboratory staff document | Denied | Passed |
| Orphan or substituted laboratory secret record | Never client-readable | Passed |
| Self-promotion from agent to tenant admin | Denied | Passed |
| Tenant admin directly changes another role | Denied | Passed |
| Tenant admin creates an attacker membership | Denied | Passed |
| Client forges audit evidence | Denied | Passed |
| Client updates/deletes audit evidence | Denied | Passed |
| Client creates, updates or deletes campaign aggregate state | Denied for every role | Passed |
| Client creates, updates or deletes audience snapshots, immutable events or checkpoints | Denied for every role | Passed |
| Tenant admin reads campaign recipient/patient state | Denied | Passed |
| Tenant admin, operator, approver and analyst bounded campaign aggregate reads | Allowed | Passed |
| Supervisor, privacy reviewer or patient-operation campaign aggregate read | Denied | Passed |
| Public, unbounded, oversized, revoked or cross-tenant campaign aggregate read | Denied | Passed |
| Campaign/snapshot/event/checkpoint schema pollution | Direct get denied; strict list parser fails closed | Passed |
| Campaign/snapshot path ID, workspace or campaign substitution | Denied/rejected | Passed |
| Audience aggregate totals, exclusions, unknown consent or language counts corrupted | Denied/rejected | Passed |
| Checkpoint suffix, half-open offset, language count or cumulative progress corrupted | Denied/rejected | Passed |
| Campaign owner equals approver or exact language-template map is substituted | Denied/rejected | Passed |
| Tenant admin creates/updates/deletes an appointment or appointment event | Denied | Passed |
| Exact-scope supervisor or agent creates/updates/deletes an appointment or appointment event | Denied | Passed |
| Cross-tenant or revoked agent creates/updates/deletes an appointment or appointment event | Denied | Passed |
| Agent or campaign operator updates a contact preference | Denied | Passed |
| Tenant admin creates/deletes a contact directly | Denied | Passed |
| Contact identity, routing or suppression authority modification | Denied | Passed |
| Contact revision skips/replays or forged client timestamp | Denied | Passed |
| Contact schema pollution or type juggling on update | Denied | Passed |
| Contact duplicate/unknown/oversized tag and language lists | Denied | Passed |
| Non-synthetic contact or non-demo/UAT workspace preference update | Denied | Passed |
| Cross-tenant contact preference update | Denied | Passed |
| Valid contact preference transaction at expected revision | Allowed | Passed |
| Stale contact preference transaction | Denied with typed conflict | Passed |
| Internal-note author spoofing | Denied | Passed |
| Internal-note scope/path traversal | Denied | Passed |
| Oversized internal-note reference | Denied | Passed |
| Internal-note body/unknown field or unapproved clinical note kind | Denied | Passed |
| Non-synthetic conversation or non-demo/UAT workspace note | Denied | Passed |
| Role without inbox note authority or empty patient scope | Denied | Passed |
| Duplicate note ID overwrite | Denied | Passed |
| Internal-note update/delete | Denied | Passed |
| Valid active tenant/member reads | Allowed | Passed |
| Tenant-admin list with `limit <= 100` inside its tenant | Allowed | Passed |
| Non-admin list with exact permitted team and location filters | Allowed | Passed |
| Unbounded patient collection list | Denied | Passed |
| Non-admin unfiltered or out-of-scope patient list | Denied | Passed |
| Locked onboarding workspace, missing membership and patient list | Denied | Passed |
| Bounded team/location reference lists for an active member | Allowed | Passed |
| Unbounded, oversized or cross-tenant team/location list | Denied | Passed |
| Exact-scope bounded consent history query | Allowed | Passed |
| Unscoped, oversized, out-of-scope, ineligible-role or cross-tenant consent query | Denied | Passed |
| Client create/update/delete or oversized/schema-polluted consent evidence | Denied | Passed |
| Exact-scope bounded content-free message-metadata query | Allowed | Passed |
| Unscoped, oversized, out-of-scope, ineligible-role or cross-tenant message query | Denied | Passed |
| Client create/update/delete or oversized/schema-polluted message record | Denied | Passed |
| Valid governed campaign client mutation | Denied; trusted backend only | Passed |
| Valid scoped append-only note | Allowed | Passed |
| Bounded exact-scope internal-note query | Allowed | Passed |
| Unbounded/unscoped/out-of-scope internal-note query | Denied | Passed |
| Public upload at an unknown Storage path | Denied | Passed |
| Authenticated workspace-object upload | Denied | Passed |
| Public and authenticated read of a backend-seeded object | Denied | Passed |
| Authenticated deletion of a backend-seeded object | Denied | Passed |

No counter is client-writable, so counter replay is inapplicable. No client
path accepts arbitrary external object paths. Orphaned note creation is denied
because the referenced conversation must exist and match workspace/team/
location. Consent and audit creation are server-only, which avoids fabricated
client evidence.

The first emulator pass exposed a rules-expression-budget denial in the valid
internal-note path. The conversation lookup was reduced to one cached document
read and direct workspace/scope comparisons. Repository seed verification then
exposed the document-get versus collection-list mismatch described above. The
expanded mutation pass again exposed the 1,000-expression ceiling because
active membership/scope checks were repeated and the contact validator
revalidated immutable backend fields. The final policy evaluates active role
authority once, uses a dedicated scoped-write helper, validates every mutable
contact preference field, and relies on a strict `diff()` allowlist to make all
backend-authored fields immutable. The policy and hostile suite were rerun from
clean emulators and passed.

## Phase 4: syntax and emulator validation

Command:

```text
npm run test:rules
```

Observed final result:

```text
Firestore Emulator was started in standard edition.
Test Files  2 passed (2)
Tests       59 passed (59)
Script exited successfully (code 0)
```

The suite loads both `firestore.rules` and `storage.rules` into clean emulators,
so a syntax/compile failure fails the run before authorization assertions can
pass. Its appointment matrix denies create, update and delete on appointments
and appointment events for tenant admin, exact-scope supervisor, exact-scope
agent, cross-tenant agent and revoked agent contexts. The Storage tests seed an
object with Rules disabled, then prove that
public and authenticated clients cannot read or delete it; they also prove
that public and authenticated uploads are denied. This validates local
emulators only. It does not test Admin SDK authorization, signed URLs, malware
scanning, production IAM, or a production deploy dry-run.

The authenticated repository boundary was separately exercised with:

```text
npm run emulators:verify-seed
```

The clean Auth/Firestore emulator run signed in the synthetic tenant admin and
read the deterministic PRD graph: six staff-safe synthetic contacts with six
server-only contact secrets, seven immutable consent events, seven conversations
(including a dedicated Phase 5 care-control route while the urgent-language
conversation remains on safety hold), seven content-free message metadata
records, twelve strict template versions,
eighteen singular-language Flow versions, three teams and three locations. It
committed a contact preference transaction from revision 0 to 1, listed one
backend-seeded protected-reference note, and proved that the locked Hemas
membership, both global synthetic simulator phone routes, contact secrets and
laboratory secrets remain unreadable to the direct client. No real patient
identifier, phone number or message text is in this seed; every reference is
explicitly synthetic.

The same verifier reads one simulation-only scheduled campaign and its one
immutable 50,000-record audience snapshot. It verifies the exact aggregate
counts, three internal-approved `wellness_awareness` v3 language versions,
distinct active owner/approver identities with assigned but empty patient
scopes, and the literal canonical approval serialization plus lowercase SHA-256
golden vector. It also independently recomputes literal canonical template
serializations and hashes before recomputing the campaign v2 approval binding.
The seed contains no campaign recipients, events or checkpoints;
the authenticated client is denied every recipient get/list and every aggregate
write.

The same verifier also checks one staff-safe laboratory workflow/event pair and
its two atomically written server-only secret records. It reads the raw staff
documents to prove protected fields are absent, validates exact one-to-one
secret paths under the synthetic tenant, and proves an authenticated tenant
admin cannot get or list either secret collection.

The audited appointment boundary was separately revalidated with a fresh seed:

```text
npm run emulators:verify-functions
```

The local Auth/Firestore/Functions run authenticated the synthetic admin,
called `demoRequestSyntheticAppointment` twice with the same exact request and
proved first-write then replay behavior. Both responses shared one event and
audit identity; the persisted appointment was `reschedule_pending`, `pending`,
revision 1, simulator-authoritative and synthetic. The immutable event was
actor/action/status/revision bound, and the redacted audit carried
`purpose == appointment_service`. The callable returned `externalCalls == 0`,
outbound remained disabled, and the authenticated client could not list the
backend idempotency collection.

## Mandatory checklist review

| Auditor check | Outcome |
|---|---|
| Update bypass | Campaign, audience, event, checkpoint and recipient updates are denied to every client; contact preference updates invoke a complete mutable-state validator, require revision +1/server time, and use a strict field-diff allowlist |
| Authority source | Role/status/scope comes only from server-managed membership documents, never request payload |
| Business logic | Bounded governed campaign aggregate reads, revision-checked synthetic preferences, immutable consent history, content-free message metadata, and scoped appointment/note reads work; campaign and appointment transitions route through audited backends; future query compatibility remains a tracked caveat |
| Storage abuse | Direct client Storage access denied; every allowed Firestore string/list/map is capped |
| Type safety | All fields on client-writable documents have explicit type/enum/timestamp checks; governed campaign direct gets and strict parsers validate complete aggregate schemas |
| Identity-level security | Every allowed client write requires active workspace membership and role checks; all campaign/appointment/event/checkpoint writes are denied to client identities |
| Field-level security | Create schemas enumerate allowed fields; contact update uses a five-field diff allowlist and validates each mutable value; Firestore's whole-document read limitation is explicitly accounted for |
| Membership escalation | All direct membership writes denied, including tenant-admin writes |
| PII exposure | No public access; contact/message/laboratory reads require tenant plus patient scope; governed campaign DTOs contain aggregates only; campaign recipients are entirely backend-only; laboratory staff documents reject protected references/fingerprints and both laboratory secret collections deny every client read/write |
| Append-only evidence | Consent, audit, idempotency, appointment-event and internal-note evidence are server-only; Rules expose no browser write path |
| Global provider state | All direct client access denied |
| Unknown paths | Explicit default deny |

## Residual risks and release gates

1. **Admin SDK bypass:** every backend endpoint and worker must repeat tenant,
   role, scope, purpose and schema checks. Rules do not protect Admin SDK calls.
2. **Model alignment:** persisted Firestore timestamps must be native timestamp
   values. TypeScript ISO strings require a serialization boundary rather than
   direct storage.
3. **Denormalized scope integrity:** only trusted backend services may assign or
   change `teamId` and `locationId` on patient records.
4. **Query alignment:** every implemented Firebase query requires a matching
   rules test and, where necessary, a composite index.
5. **PII separation:** laboratory protected references are now split from the
   staff projection. Apply the same classification review to every new field;
   server-only secret records still require purpose-bound Admin SDK access,
   strict writer validation, audit and retention controls.
6. **Storage workflows:** all direct access is currently blocked. Any signed
   URL or future client upload path needs its own threat model and tests.
7. **Production configuration:** select project, edition and immutable location
   only after Hemas review, then repeat testing and a deploy dry-run.
8. **Healthcare review:** security engineering, Hemas privacy/DPO, clinical
   governance and legal review are required before real-patient UAT.

## Prototype notice

I've set up prototype Security Rules to keep the data in Firestore safe. They
are designed to be secure for tenant isolation, server-managed authority,
least-privilege patient access, immutable evidence, bounded writes and strict
default denial. However, you should review and verify them before broadly
sharing your app. If you'd like, I can help you harden these rules.
