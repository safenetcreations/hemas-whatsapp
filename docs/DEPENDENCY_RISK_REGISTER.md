# Dependency risk register

Observed: 2026-08-11
Scope: local dependency locks only; re-run before every release

## Root web application

Command: `npm audit --audit-level=moderate`  
Observed result: **0 vulnerabilities**

## Firebase Functions workspace

Command: `npm --prefix functions audit --audit-level=moderate`  
Observed result: **0 vulnerabilities**

The earlier lockfile exposed advisory `GHSA-w5hq-g745-h8pq` through a
transitive `uuid < 11.1.1` path in the Firebase/Google Cloud dependency tree.
The Functions package now pins the compatible transitive package with
`overrides.uuid = 11.1.1`; the resolved lockfile audit is clean.

No breaking Firebase Functions downgrade was applied. The repository includes
a dependency regression test that verifies the effective override and resolved
lockfile version so the vulnerable range cannot silently return.

The remaining release controls are:

- re-run both audits against the exact release lockfiles and Node 22;
- keep the dependency regression test and full Functions/emulator suite green;
- review or remove the override when the upstream tree resolves only patched
  versions; and
- treat any newly reported moderate-or-higher advisory as a fresh release gate.

Dependency-audit status: **closed for the current lockfiles**. This is not by
itself deployment, provider acceptance or production-security approval.
