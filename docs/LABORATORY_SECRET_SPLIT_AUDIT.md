# Laboratory protected-reference split audit

Status: pre-UAT synthetic prototype, 2026-08-07  
Validation target: Cloud Firestore Standard edition emulator  
Production deploy: not performed

## Security outcome

Client-readable laboratory documents are strict staff-safe projections. They
contain only workflow status, collection/ready/notification timestamps,
operational scope, immutable event metadata, and a non-secret simulator
handoff availability/expiry indicator. They contain no result value, report
body, diagnosis, interpretation, raw attachment, access token, external report
identifier, notification/idempotency fingerprint, or protected handoff
reference.

Protected values are stored in separate backend-only records:

- `labReportSecrets/{labReportId}` contains the external report reference,
  notification idempotency fingerprint, and protected handoff reference.
- `labReportEventSecrets/{eventId}` contains the immutable event idempotency
  fingerprint.

Both collections explicitly deny every direct client get, list, create,
update, and delete, including tenant administrators. Admin SDK callers bypass
Rules and must independently enforce tenant, purpose, schema, audit, retention,
and least-privilege service identity.

## Atomic synthetic seed contract

The emulator seed uses one Firestore batch for exactly four related writes: the
staff-safe report, report secret, staff-safe event, and event secret. Its
privileged verifier fails if any record is missing or orphaned, any document ID
or workspace differs from its path, the event points at a different report,
the protected handoff path crosses tenants/reports, an exact key set changes,
or a raw staff document contains a protected field.

This is seed proof, not a production backend implementation. Every future
trusted writer must preserve the same atomic and path-bound invariant.

## Read and query contract

- Tenant administrators may make bounded workspace-wide staff-safe reads.
- `supervisor`, `agent`, and `clinical_approver` reads require an exact active
  team and location pair; empty or mismatched scope fails closed.
- Rules validate the exact staff-safe report/event schema for direct `get`.
  Firestore cannot prove an arbitrary whole-document key allowlist from query
  constraints, so trusted writers enforce the stored list schema and the
  repository strictly parses every listed document, rejecting the complete
  result on any protected/unknown field or tenant/path identity mismatch.
- Report lists order by `updatedAt`; event lists constrain report, team, and
  location and order by `occurredAt`. Existing composite indexes cover those
  operations.
- Protected secret fields are excluded from indexing and no secret collection
  query/index path is exposed to clients.

## Red-team cases

The focused repository and Rules tests cover:

- parser pollution with legacy protected fields and clinical/result content;
- report/event document-ID and workspace substitution;
- unauthorized secret get/list by public, scoped operational, and tenant-admin
  clients;
- secret create/update/delete attempts by a tenant admin;
- cross-tenant secret access;
- orphan/substituted secret records remaining unreadable;
- polluted staff documents failing closed on direct reads and bounded lists;
- raw seeded staff documents lacking protected keys and the privileged seed
  graph containing one-to-one secret records.

## Release gates

Before real-patient UAT, Hemas security/privacy owners must approve the field
classification, retention and deletion policy, backend access purpose model,
service identities, audit events, encryption/key management, incident response,
and production Firestore edition/location. Emulator success is not production
authorization or a security certification.
