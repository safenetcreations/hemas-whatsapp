# Hemas private operator tooling

These scripts are local Admin SDK tools for the governed Hemas demo lane. They
use Application Default Credentials, allow only the `hemas-whatsapp` project,
and require the exact `(default)` database selector. Runtime output calls that
database `primary-standard`; it never prints user selectors, document IDs,
phone numbers, provider IDs, unrelated custom claims, or credential details.

Run them only from a private operator shell after authenticating an approved
Firebase/Google Cloud admin identity. Both tools are dry-run by default. Never
place a service-account JSON file, Meta credential, recipient, email address,
or UID in the repository, a screenshot, or management-demo material.
Privilege grants refuse any selected Firebase user whose email is not already
verified; emergency revocation remains available for an unverified account.
The tool never creates users or changes verification state.

## Custom claims

Grant the exact Full and Lite demo claims to a pre-created Firebase Auth user:

```sh
npm --prefix functions run ops:claims -- \
  --project hemas-whatsapp \
  --database '(default)' \
  --email '<private-email>' \
  --action grant \
  --claims hemasPortalDemo,hemasLiteCanary,hemasLiteAdmin
```

Review the aggregate plan, then repeat the same command with the explicit
mutation confirmation:

```sh
npm --prefix functions run ops:claims -- \
  --project hemas-whatsapp \
  --database '(default)' \
  --email '<private-email>' \
  --action grant \
  --claims hemasPortalDemo,hemasLiteCanary,hemasLiteAdmin \
  --apply \
  --confirm HEMAS_CLAIMS_APPLY
```

The operator merges these claim keys into the existing claim map and preserves
all unrelated claims. `hemasPortalDemo` enables the verified Full cloud-demo
session; the Lite claims enable the exact setup and send surfaces. Firestore
membership and role checks remain the data-authorization boundary. The user
must sign out and sign back in, or otherwise force an ID-token refresh, before
a newly granted claim is usable.

The Meta outbox recovery callable has a separate two-claim gate. Grant both
claims only to the private recovery operator, never to a presenter or ordinary
Lite seat:

```sh
npm --prefix functions run ops:claims -- \
  --project hemas-whatsapp \
  --database '(default)' \
  --email '<private-email>' \
  --action grant \
  --claims hemasMetaCanary,hemasMetaCanaryAdmin
```

Review the plan, then repeat it with
`--apply --confirm HEMAS_CLAIMS_APPLY`.

After the demo window, revoke all five governed access/send/setup claims and
revoke the user's existing refresh tokens:

```sh
npm --prefix functions run ops:claims -- \
  --project hemas-whatsapp \
  --database '(default)' \
  --email '<private-email>' \
  --action revoke \
  --claims hemasPortalDemo,hemasLiteCanary,hemasLiteAdmin,hemasMetaCanary,hemasMetaCanaryAdmin \
  --disable-membership \
  --revoke-tokens
```

Review first, then repeat with `--apply --confirm HEMAS_CLAIMS_APPLY`. Revoking
refresh tokens is also only executed in confirmed apply mode. Already minted
ID tokens can remain valid until expiry unless a server verifies revocation;
the same command therefore disables the selected workspace membership before
removing claims/tokens. Re-enabling a role is a separate approved provisioning
action; this operator never creates a membership or changes its role/scope.

## Private recovery surface

The governed cloud Lite **Settings** page exposes recovery controls only after
the browser refreshes a verified ID token with the exact admin claim(s). Every
callable also re-checks the caller's current active tenant-admin membership, so
a stale token cannot bypass post-demo membership disablement.

- Meta outbox recovery requires `hemasMetaCanary` and
  `hemasMetaCanaryAdmin`; it may process due pre-dispatch effects and therefore
  requires an explicit confirmation checkbox.
- Fatal Meta effect resolution requires the same two claims, a current active
  tenant-admin membership, an exact effect/request binding and independently
  verified provider evidence. It is evidence-only: it cannot call or retry Meta.
- Reply, booking and campaign reconciliation require `hemasLiteAdmin`, exact
  operation/request bindings and a separately obtained provider-evidence
  SHA-256. These actions never call Meta. Campaign recovery terminates every
  unsent remainder rather than resuming a broadcast.
- Never use recovery to guess an outcome, replace an operation ID or bypass an
  ambiguous/fatal state. Verify provider evidence privately first; message IDs
  and evidence digests are password-masked and never stored in browser state
  beyond the current tab.

## Historical canary receipts

Inspect schema and age aggregates and plan deletion of exact schema-v1 receipts
older than a UTC retention cutoff:

```sh
npm --prefix functions run ops:receipts -- \
  --project hemas-whatsapp \
  --database '(default)' \
  --cutoff '2026-07-01T00:00:00.000Z'
```

The default bounded scan is 5,000 receipts. Increase it with `--max-docs` if the
dry run reports truncation. Apply mode fails closed when the scan is truncated,
and the cutoff must retain at least 30 full days of provider-event deduplication
receipts.
After reviewing the aggregate count, repeat the command with:

```sh
--apply --confirm HEMAS_RECEIPTS_DELETE
```

The apply deletes only records where `schemaVersion` is exactly `1`, the
receipt timestamp is valid, and that timestamp is older than the supplied
cutoff. Missing timestamps, current schema-v2 receipts, and unknown schemas are
never selected. Deletion is idempotent but batched; if an apply reports failure,
run the dry-run plan again before retrying so any partial progress is visible as
aggregate counts.

## Repository hygiene

Run the high-confidence tracked-file scan before release:

```sh
npm run security:scan-tracked
```

A now-deleted local environment file exists in earlier Git history and included
provider asset/recipient configuration. This repository does not rewrite Git
history automatically. Keep repository access restricted, treat historical
recipient metadata as sensitive, and rotate any credential-like value if one
was ever committed. Current local values belong only in ignored environment
files or approved secret storage.
