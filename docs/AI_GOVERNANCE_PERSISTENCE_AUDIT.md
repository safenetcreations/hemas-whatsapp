# AI and Knowledge Governance Persistence Audit

Audit date: 2026-08-08  
Target: local Cloud Firestore Standard emulator contract  
Status: strict prototype; independent Rules review and emulator execution pending  
Provider/network status: no model, Meta, Hemas, cloud, dispatch, or production call was made

## Binary milestone contract

**GO** only for a local, synthetic, retrospective evidence milestone in
`workspace_safenet_demo`. **NO-GO** for inference, RAG, live provider access,
message dispatch, conversation/contact/consent mutation, queue/handoff mutation,
real patient data, UAT, production, or any claim that an AI action occurred.

The independently approved immutable source is:

- `lib/domain/ai-governance.ts` SHA-256
  `c15836b067a288879303570fd9aa5465ee72792decf9ff0ae2555587c5549e3f`;
- five knowledge documents, three effective selections and five protected
  knowledge records form the 13-document governance seed;
- each of four first one-shot server materializations may later add exactly six
  records: run, event, run secret, event secret, idempotency receipt and audit;
- valid structural totals are 13, 19, 25, 31 and 37; a replay adds zero;
- this Rules/RBAC lane does not seed or materialize any of those records.

## Staff-safe and protected paths

All paths below are children of
`workspaces/workspace_safenet_demo`.

| Path | Fixed inventory | Client operation |
|---|---:|---|
| `knowledgeDocuments/{id}` | 5 | Exact `get` only after MFA, role, scope, fixed-ID and full v1 validation |
| `knowledgeSelections/{id}` | 3 | Exact `get` only after MFA, role, scope, fixed-ID and full v1 validation |
| `aiRuns/{id}` | 4 maximum | Exact `get` only after MFA, role, scope, fixed-ID and full v1 validation |
| `aiRunEvents/{id}` | 4 maximum | Exact `get` only after MFA, role, scope, fixed-ID and full v1 validation |
| `knowledgeDocumentSecrets/{path=**}` | 5 | Total client deny |
| `aiRunSecrets/{path=**}` | 4 maximum | Total client deny |
| `aiRunEventSecrets/{path=**}` | 4 maximum | Total client deny |
| `idempotencyKeys/{id}` | 4 maximum AI receipts | Existing total client deny |
| `handoffSessions/{id}` | 0 for this milestone | Total client deny |

Every staff-safe collection has `allow list: if false` and denies every direct
create, update and delete. An authorized fixed-path get uses the deliberate
`!exists(path) || strictValidator(resource.data)` form. This permits an honest
non-existing snapshot before seed/materialization, but denies an existing
partial, polluted or substituted document.

### Fixed IDs

Knowledge documents:

- `kn-appointments-v3`
- `kn-labs-v2`
- `kn-urgent-v5`
- `kn-package-draft`
- `kn-old-hours`

Effective selections:

- `knowledge_selection_appointments_v3`
- `knowledge_selection_labs_v2`
- `knowledge_selection_urgent_v5`

Runtime pairs:

| Scenario | Run | Event |
|---|---|---|
| appointment | `ai_run_demo_appointment_v1` | `ai_run_event_demo_appointment_v1` |
| urgent | `ai_run_demo_urgent_v1` | `ai_run_event_demo_urgent_v1` |
| mixed | `ai_run_demo_mixed_v1` | `ai_run_event_demo_mixed_v1` |
| stop | `ai_run_demo_stop_v1` | `ai_run_event_demo_stop_v1` |

Medicine, report and price remain local-only cases and have no persisted path.

## Exact public schemas

`knowledgeDocuments` uses exactly 20 keys:

`id`, `workspaceId`, `title`, `version`, `language`, `contentKind`, `ownerUid`,
`approverUid`, `approvalState`, `approvalScope`, `approvedAt`, `evaluatedAt`,
`effectiveFrom`, `effectiveUntil`, `contentFingerprint`, `approvalFingerprint`,
`synthetic`, `schemaVersion`, `createdAt`, `updatedAt`.

`knowledgeSelections` uses exactly 15 keys:

`selectionId`, `workspaceId`, `documentId`, `contentFingerprint`,
`approvalFingerprint`, `selectorVersionId`, `selectedAt`, `evaluatedAt`,
`selectionScope`, `effectiveFrom`, `effectiveUntil`, `synthetic`,
`selectionFingerprint`, `schemaVersion`, `createdAt`.

`aiRuns` uses exactly 44 keys and `aiRunEvents` exactly 47 keys, matching the
frozen contract. Rules pin the path/scenario/parent/audit matrix, selection null
matrix, `modelProvider == none`, null model and prompt IDs, fixed policy and
reviewer IDs, fixed retrospective/event literals, exact one-item reason list,
outcome and observed-state matrix, `synthetic == true`, `schemaVersion == 1`,
`eventCount == 1`, all retry/provider/model/dispatch/conversation/handoff/
suppression mutation counters at zero, and `chainOfThoughtStored == false`.

Persisted date fields are native Firestore timestamps. The frozen historical
`evaluatedAt` is `2026-08-07T12:30:00.000Z`; selection creation and runtime
record/event creation must be strictly later. Knowledge approval/effective
timestamps and nullable draft fields are fixed per document, while knowledge
document creation/update timestamps must be monotonic.

Firestore Rules can validate lowercase 64-character fingerprint shape but
cannot compute SHA-256 or prove cross-document cryptographic equality. Trusted
writers and strict repository parsers must therefore enforce content,
approval, selection, request, run and event fingerprint joins.

## Authorization matrix

The authority source is the server-managed
`workspaces/{workspaceId}/members/{uid}` record. All allowed reads require an
active SafeNet demo workspace, active membership, `mfaSatisfied == true`, a
native `lastAuthenticatedAt`, and the exact role/scope below.

| Role and scope | Knowledge documents | Selections | Runs/events |
|---|---|---|---|
| `tenant_admin`, `workspace_wide` | all 5 | all 3 | all 4 pairs |
| `privacy_reviewer`, `assigned` | all 5 | all 3 | none |
| `supervisor`, `assigned`, includes `team_demo_general` and `location_demo_wattala` | appointment, package draft, old hours | appointment | appointment, mixed, stop |
| `clinical_approver`, `assigned`, includes `team_demo_clinical_escalation` and `location_demo_wattala` | labs, urgent | labs, urgent | urgent |

Every other role, public caller, missing/revoked member, false-MFA member,
invalid scope, missing required team/location, and cross-tenant caller is
denied.

Application RBAC grants `ai_governance.view` to those four roles.
`ai_governance.record_retrospective` is limited to `tenant_admin`, `supervisor`
and `clinical_approver`; it is in both the mandatory-MFA and mandatory-step-up
sets. The authorization helper rejects non-positive, non-finite or greater-than
15-minute windows, so a caller cannot loosen the maximum fifteen-minute window
or override MFA with `false`. A future callable must additionally validate the
Firebase token `auth_time` and use the stricter of token and membership times.

## Index contract

There is no knowledge, selection, AI-run, AI-event or AI-secret composite
index. Client and repository contracts must use fixed document reads only.
Protected references, fingerprints and the STOP evidence map in the three
secret collection groups have empty single-field index overrides because the
milestone has no field query for them. Direct document-ID reads remain possible
to trusted Admin SDK code.

## Red-team assessment

```json
{
  "score": 4,
  "summary": "The prototype is default-deny, fixed-path, MFA-backed, role/scope constrained, schema strict, query closed and secret split. It has not yet passed the independently authorized emulator run and Admin SDK services remain a separate enforcement boundary.",
  "findings": [
    {
      "check": "Authority Source",
      "severity": "moderate",
      "issue": "Admin SDK code bypasses Firestore Rules.",
      "recommendation": "Require the future callable to repeat tenant, role, scope, MFA, dual recent-auth, source-fixture, idempotency, schema and audit checks inside one transaction."
    },
    {
      "check": "Cross-document integrity",
      "severity": "moderate",
      "issue": "Rules cannot compute SHA-256 or prove all public-to-secret fingerprint joins.",
      "recommendation": "Use frozen serializers in trusted writers and strict readers, with golden-vector parity tests."
    },
    {
      "check": "Syntactic and behavioral verification",
      "severity": "minor",
      "issue": "The hostile Rules suite is written but intentionally not executed before independent review and explicit emulator-port authorization.",
      "recommendation": "After source freeze, run the scoped Firestore emulator suite on approved ports and preserve its result as evidence."
    }
  ]
}
```

### Hostile cases encoded in the Rules suite

| Attack | Expected result | Current evidence |
|---|---|---|
| Public, revoked, excluded role, false MFA, invalid scope, cross-tenant fixed get | Denied | Test written; emulator pending |
| Correct role but wrong document/scenario partition | Denied | Test written; emulator pending |
| Authorized get of genuinely missing fixed path | Successful non-existing snapshot | Test written; emulator pending |
| Any list, filtered query, ordered query or bounded query | Denied | Test written; emulator pending |
| Missing/extra key or protected raw-content field | Denied | Test written; emulator pending |
| Approval, selection, outcome, parent, provider, retry or identity substitution | Denied | Test written; emulator pending |
| Nonzero effect/provider/model/retry counter | Denied | Test written; emulator pending |
| Frozen/actual timestamp substitution or non-monotonic time | Denied | Test written; emulator pending |
| Any staff-safe create/update/delete | Denied | Test written; emulator pending |
| Any secret, receipt or handoff get/list/write | Denied | Test written; emulator pending |
| Maximum valid 16-document exact-get inventory | Allowed to tenant admin | Test written; emulator pending |

Pure TypeScript typecheck, focused ESLint and static contract tests are required
before independent review. Passing those checks is not evidence that Rules
compile or behave correctly in the emulator. No production deployment or broad
sharing is authorized by this document.

I've set up prototype Security Rules to keep the data in Firestore safe. They
are designed to be secure for the fixed synthetic inventory through explicit
MFA-backed RBAC, exact-path reads, strict schemas, zero-effect matrices, total
write/list denial and protected collection separation. However, you should
review and verify them before broadly sharing your app. If you'd like, I can
help you harden these rules.
