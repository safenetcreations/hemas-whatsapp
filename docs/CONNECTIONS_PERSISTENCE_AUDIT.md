# Connections persistence and Rules audit

Status: source contract implemented; Rules-emulator execution requires separate
loopback-port authorization  
Scope: local `demo-hemas-connect` synthetic workspace only  
External messaging, provider networking and authoritative Hemas writes: disabled

## Truth boundary

The persisted Connections slice is a read-only staff-safe catalogue. It proves
only that the local demo has one deterministic WhatsApp simulator projection
and two deterministic HIS/LIMS simulator projections. It does not prove a
Firebase cloud deployment, Meta connection, WABA or phone registration,
provider webhook, template approval, payment readiness, messaging capacity,
Hemas integration, real-device delivery or production acceptance.

The browser must never translate Functions `ready: true` in synthetic mode into
`Connected` or `Production ready`. Synthetic readiness means only that the
local zero-network simulator is available for its configured demo mode.

## Exact persisted inventory

All records live below `workspaces/workspace_safenet_demo`.

| Collection | Exact records | Client authority |
|---|---:|---|
| `whatsappConnections` | `connection_demo_simulator` | Active tenant administrator, fixed strict get only |
| `integrations` | `integration_demo_his_simulator`, `integration_demo_lims_simulator` | Active tenant administrator, fixed strict gets only |
| `whatsappConnectionSecrets` | Zero demo records | No direct client access |
| `integrationSecrets` | Zero demo records | No direct client access |

The WhatsApp projection has exactly 18 top-level fields and an exact 11-signal
map. Every signal has exactly `state`, `source`, `observedAt`,
`lastSuccessfulVerificationAt` and `detailCode`. Its last successful
verification is literally null. All state/source/detail tuples are frozen to
the domain matrix, native timestamps must remain inside the document
chronology, and external messaging plus network-call gates must be false.

Each integration has exactly 17 top-level fields. Its identity fixes the kind,
display name, sort key and evidence code. Adapter mode is synthetic, status is
mock, credentials are not configured, last sync is null, and both external
network and authoritative-system writes are false.

Raw WABA, phone, app or business identifiers; phone numbers; endpoints; token,
key or certificate material; Secret Manager references; and free-form health
or error details are not valid staff-safe fields. Future raw identifiers and
Secret Manager resource references require separate server-only documents.
Actual credential values never belong in Firestore.

## Fixed-document read contract

The browser repository uses exactly three `getDocFromServer` calls: one fixed
WhatsApp document path and the two fixed integration document paths. It has no
collection/list read, filter, ordering or pagination API. When all three fixed
documents are absent, the active tenant administrator receives successful
non-existing snapshots and the repository returns an honest empty state. A
partial inventory or an existing document that fails strict parsing is closed
as invalid persisted data.

Rules require an active `tenant_admin`, the exact synthetic workspace and one
of the three permitted document IDs. A missing permitted document is readable
only as non-existing; an existing permitted document must pass the complete
fixed-literal and exact-key validator. Every collection read is denied. All
direct create, update and delete operations are denied.
`whatsappConnectionSecrets`, `integrationSecrets`, `phoneRoutes` and
`wabaRoutes` remain explicit total-deny client paths.

## Red-team coverage

The Rules suite includes attacks for:

- unauthenticated, revoked, cross-tenant and every active non-admin role;
- complete and honestly missing fixed-document gets;
- unknown document IDs plus unbounded, limited, filtered and ordered collection
  reads for every role, including the active tenant administrator;
- raw provider/secret fields, arbitrary extra fields and missing fields;
- state/source/detail, identity, workspace, kind and sort-key substitution;
- enabled network, external-send or authoritative-write gates;
- non-null successful-verification evidence and invalid chronology;
- every direct catalogue mutation;
- get, list, create, update and delete attempts against both secret collections;
- retained global phone-route and WABA-route denial.

The static contract test independently checks that obsolete catalogue
configuration is absent, the repository uses exactly three fixed server reads
with no collection-read symbols, Rules keep both catalogues closed to
collection reads, and secret/global-route denies remain explicit, without
opening an emulator port.

## Security Auditor assessment

```json
{
  "score": 4,
  "summary": "The local prototype uses exact minimized projections, active tenant-admin fixed-document reads, total list and direct-write denial, and explicit secret/global-route separation. Emulator execution and later production architecture review remain required, so this is not a production security certification.",
  "findings": [
    {
      "check": "Business Logic vs. Rules",
      "severity": "minor",
      "issue": "The v1 schema deliberately cannot represent a real provider connection.",
      "recommendation": "Keep it demo-only and design a separately reviewed connected schema after Firebase and Meta ownership decisions."
    },
    {
      "check": "Authority Source",
      "severity": "moderate",
      "issue": "Admin SDK code bypasses Rules even though this milestone adds no server mutation path.",
      "recommendation": "Require tenant, role, recent-auth, MFA, schema, idempotency and durable audit validation before adding any connection mutation."
    },
    {
      "check": "Production target",
      "severity": "minor",
      "issue": "No cloud project, Firestore edition, database ID or immutable location is selected.",
      "recommendation": "Repeat Rules and tenant-isolation validation against the approved architecture before any connected UAT."
    }
  ]
}
```

## Remaining acceptance gate

Before this source change can be called Rules-verified, run the scoped Rules
suite in clean local Standard emulators and then the complete sequential
validation gate. No deploy, provider call, credential entry or cloud database
lookup is authorized by this document.
