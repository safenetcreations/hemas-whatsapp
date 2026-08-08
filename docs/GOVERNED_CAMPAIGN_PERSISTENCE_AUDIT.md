# Governed Campaign Persistence Audit

Audit date: 2026-08-07  
Scope: synthetic Standard-emulator campaign read model only  
Status: prototype foundation; no provider, outbound, cloud or real-patient use

## Trust boundary

The browser has no campaign write authority. `campaigns`,
`audienceSnapshots`, `campaignEvents` and `campaignCheckpoints` are written only
by trusted backend code. Firestore Rules permit bounded aggregate reads only to
active `tenant_admin`, `campaign_operator`, `campaign_approver` and `analyst`
members in the document's workspace. Every client get/list/write on
`campaignRecipients` is denied.

An analyst receives no template catalogue or Flow access. Rules permit only
three exact template gets for the campaign-bound English, Sinhala and Tamil v3
records, and the repository validates the complete schema plus canonical
content hash before returning them.

The two seeded campaign-governance members use `scopeMode: "assigned"` with
empty team and location arrays. This deliberately grants aggregate governance
visibility while granting no patient-record scope. Only a tenant admin may use
the separate explicit workspace-wide patient scope model.

## Persisted contracts

All four client-readable aggregate documents are exact-key, synthetic,
schema-version-1 records with native Firestore timestamps. Direct gets validate
the exact tenant/path identity in Rules; bounded lists are parsed fail closed by
the strict Zod repository because Rules cannot prove an arbitrary whole-document
key allowlist for a query result.

- `workspaces/{workspaceId}/campaigns/{campaignId}` contains purpose,
  category, target action, exact language-template references, schedule,
  simulation-only approval, state and aggregate progress. It contains no
  recipient array, patient field or delivery payload.
- `workspaces/{workspaceId}/audienceSnapshots/{snapshotId}` contains only
  immutable totals, exclusion counts, language counts and an audience content
  hash. The parser and Rules reconcile every count.
- `workspaces/{workspaceId}/campaignEvents/{eventId}` is immutable state-change
  evidence with actor, action, from/to state, revision and an optional checkpoint
  binding. Only `advance_batch` may bind a checkpoint. Bounded pages order by
  authoritative descending revision; a strict direct get recovers a referenced
  event that has aged out of the newest 50 revisions.
- `workspaces/{workspaceId}/campaignCheckpoints/{checkpointId}` contains a raw
  half-open source interval, batch eligible/language counts, cumulative eligible
  progress, final-scan flag and deterministic digest. It contains no recipient
  identities.

The campaign parser requires a non-null checkpoint to equal
`{campaignId}:checkpoint:{nextBatchIndex - 1 padded to six digits}` and requires
`nextBatchIndex == ceil(processedEligible / 1000)`. Each non-final checkpoint
represents 1,000 eligible aggregate records. The deterministic final checkpoint
is batch index 38, contains 443 eligible records and ends at raw source offset
50,000.

## Deterministic synthetic seed

The seed writes one scheduled campaign, `campaign_synthetic_50k`, and one
immutable audience snapshot, `audience_synthetic_50k_v1`, atomically. Campaign
state is `scheduled`, dispatch mode is `simulation`, revision and progress are
zero, canary status is `not_run`, batch size is 1,000, the last checkpoint is
null, and external/network calls are both zero. Quiet hours are 20:00-08:00 in
`Asia/Colombo`.

Audience reconciliation:

| Aggregate | Count |
|---|---:|
| Total evaluated | 50,000 |
| Eligible | 38,443 |
| Excluded | 11,557 |
| Unknown consent | 3,588 |
| Frequency cap | 3,873 |
| Consent missing | 3,588 |
| Suppressed | 2,915 |
| Duplicate | 444 |
| Invalid contact | 442 |
| Language unavailable | 295 |
| English | 26,989 |
| Sinhala | 12,038 |
| Tamil | 10,973 |

The campaign references exactly these immutable, internal-approved template
versions: `template_wellness_awareness_en_v3`,
`template_wellness_awareness_si_v3` and
`template_wellness_awareness_ta_v3`. Their provider state is deliberately
`not_submitted`, unverified and non-transferable. The existing Sinhala v4 draft
is preserved and is not referenced by the campaign.

Each template stores a lowercase SHA-256 over the canonical
`hemas-connect:template-content:v1` tuple. That order-preserving tuple binds the
template workspace/identity/language/version, every message component and
button, and every variable-rule field. Placeholder keys across component text,
button labels and button targets must exactly equal the variable-rule keys.

No campaign recipient, event or checkpoint is seeded. There is no recipient
array and no patient identifier in any aggregate document.

## Content and approval binding golden vectors

The three verified template content hashes are:

```text
en  0cbf38327d7d48ee61558927c6afb8e4e75c1781561906ebbab4def379e6c04f
si  cefbdf676d18b06dfcc4263e659c0585db48de7e7843b57b32566d2215536582
ta  c477a31ee0344bef6c66a25a0a70848f6a0a75262f0df328dd8b04e6479a2b12
```

The canonical binding is the UTF-8 SHA-256 of `JSON.stringify` over this exact
ordered tuple:

```text
["hemas-connect:campaign-approval:v2", workspaceId, campaignId, audienceSnapshotId, snapshotContentHash, templateVersionIds.en, templateContentHashes.en, templateVersionIds.si, templateContentHashes.si, templateVersionIds.ta, templateContentHashes.ta, purpose, messageCategory, targetAction, schedule.startsAt.toDate().toISOString(), schedule.timeZone, schedule.quietHours.startsAtLocal, schedule.quietHours.endsAtLocal]
```

Seeded serialization:

```text
["hemas-connect:campaign-approval:v2","workspace_safenet_demo","campaign_synthetic_50k","audience_synthetic_50k_v1","7a4d8ce2bc1bafc224e5e2b91a2fc3f8b20b5f062ff1563ca4cf25847ad0d550","template_wellness_awareness_en_v3","0cbf38327d7d48ee61558927c6afb8e4e75c1781561906ebbab4def379e6c04f","template_wellness_awareness_si_v3","cefbdf676d18b06dfcc4263e659c0585db48de7e7843b57b32566d2215536582","template_wellness_awareness_ta_v3","c477a31ee0344bef6c66a25a0a70848f6a0a75262f0df328dd8b04e6479a2b12","health_campaigns","marketing","Open the synthetic wellness information journey","2026-08-10T03:30:00.000Z","Asia/Colombo","20:00","08:00"]
```

Lowercase SHA-256:

```text
6bdce27c7e31e5e064febd7b4dcbd05df208a4ddf33085003848bbfd81c1b1cd
```

The browser repository exports only the pure canonical serialization helper;
it does not import Node cryptography and does not claim authoritative approval
verification. Trusted seed and Functions code independently recompute the
digest. Any change to the audience hash, exact template IDs, purpose, category,
target action or schedule invalidates the approval binding. Each template hash
is recomputed first, so body, button or variable-governance drift under the same
document ID also invalidates approval. The prior v1 campaign prefix is rejected.

## Red-team coverage

Focused unit and Rules tests cover:

- strict input bounds and unknown-key parser pollution;
- cross-tenant, path-ID, campaign-ID, audience and template substitution;
- revoked, public, unauthorized-role, unbounded and oversized reads;
- complete client write denial on all campaign collections;
- complete recipient get/list/write denial, including tenant admin;
- owner/approver separation and exact language-template map validation;
- audience total, exclusion, consent and language reconciliation;
- event transition and optional-checkpoint rules;
- revision-authoritative event paging plus strict exact-event recovery;
- template stored-hash mismatch, body/button/variable drift, unknown or missing
  variable rules, old-v1 approval rejection and least-privilege analyst gets;
- checkpoint suffix/index/progress substitution, half-open offset integrity,
  language reconciliation and the final 443-record batch;
- the literal serialization and SHA-256 golden vector.

The seed verifier additionally inspects privileged raw documents, independently
recomputes all three template bindings and the v2 approval binding, proves that owner and approver are distinct
active members with zero patient scope, and confirms that recipient/event/
checkpoint collections are empty before exercising authenticated reads.

Observed local evidence:

```text
npm run test:rules
Test Files  2 passed (2)
Tests       59 passed (59)

npm run emulators:verify-seed
1 governed 50,000-record simulation campaign
1 immutable aggregate snapshot
0 seeded recipients/events/checkpoints
12 strict template versions; 18 singular-language Flow versions
Script exited successfully (code 0)

npm run emulators:verify-functions
45 campaign actions; 45 exact event/audit joins
39 independently canonical checkpoints; final batch 443
post-completion canary and first-batch replay passed
same-key conflict survival passed; client idempotency access denied
Script exited successfully (code 0)
```

Both commands used the Firebase Standard emulator with project ID
`demo-hemas-connect`. No production target, cloud data or provider was accessed.

## Residual controls

Firestore Rules do not constrain Admin SDK calls. Every trusted campaign
controller and worker must repeat tenant, role, ownership, approval-hash,
revision, transition, idempotency, template and aggregate validation before a
transaction. Backend audit and retention controls remain required. This
foundation authorizes no Meta submission, WhatsApp dispatch, provider call,
network call or real-patient UAT.

I've set up prototype Security Rules to keep the data in Firestore safe. They
are designed to be secure for tenant isolation, server-only mutation,
recipient-free aggregate reads, bounded role access and strict fail-closed
parsing. However, you should review and verify them before broadly sharing your
app. If you'd like, I can help you harden these rules.
