# Dependency risk register

Observed: 2026-08-07  
Scope: local dependency locks only; re-run before every release

## Root web application

Command: `npm audit --audit-level=moderate`  
Observed result: **0 vulnerabilities**

## Firebase Functions workspace

Command: `npm --prefix functions audit --audit-level=moderate`  
Observed result: **7 moderate transitive findings**

The reported advisory is `GHSA-w5hq-g745-h8pq` for `uuid < 11.1.1`. The
dependency path is through the current Firebase Functions/Admin/Google Cloud
Storage dependency tree, including `gaxios`, `teeny-request`, and
`retry-request`.

The audit tool's forced remediation would install `firebase-functions@4.9.0`,
which is a breaking downgrade from the current `7.3.2`. That forced change was
not applied. A downgrade is not assumed to be safer merely because npm can
construct it.

Current exposure is constrained because:

- no production Function has been deployed;
- no live provider, patient, Storage, or outbound adapter is enabled;
- the current endpoints accept no file buffer for UUID generation;
- the demo uses synthetic data and local tests.

This does not close the finding. Before any connected UAT or deployment:

1. Re-run both audits against the exact lockfiles and Node 22.
2. Check the current upstream Firebase Functions/Admin dependency versions and
   the advisory's affected execution path.
3. Prefer an upstream patched dependency chain or a reviewed compatible
   override; do not force a breaking downgrade without regression and support
   analysis.
4. Run Functions tests, emulator acceptance, dependency/secret/static scans,
   and a deployment dry-run after any change.
5. Record Hemas security acceptance or a time-bound remediation decision if the
   transitive chain is still unresolved.

Release status: **open gate; not approved for production**.
