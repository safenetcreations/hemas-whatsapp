# Hemas Connect Firebase Functions

This is a Firebase Cloud Functions v2 TypeScript safety skeleton.

Current capabilities:

- Sanitized `hemasConnectReadiness` HTTP function.
- Strict runtime configuration validation.
- Tenant-scoped, redacting audit-event utilities.
- Create-only Firestore audit adapter with an emulator-only project/loopback
  guard and deterministic durable verification.
- Deterministic synthetic message and 50,000-recipient campaign helpers.
- Deterministic healthcare reviewer for approved information, urgency, STOP,
  clinical-advice blocks, language uncertainty, and human takeover.
- Simulator-only WhatsApp, HIS and LIMS adapters.
- Seven immutable synthetic Flow definitions: one static information Flow plus
  the six PRD journeys for appointment booking, appointment change,
  laboratory collection, package enquiry, feedback, and communication
  preferences. Signed sessions use in-memory replay/idempotency protection and
  every endpoint-powered journey stops at pending confirmation.
- Centralized authenticated workspace authorization with role, team/location,
  recent-auth, service-purpose, durable audit, and transaction-bound
  idempotency checks for the first protected-reference note mutation.
- Emulator-only signed synthetic webhook ingress with an exact GET challenge,
  raw-body HMAC verification, idempotent Firestore transactions and monotonic
  status derivation. POST fixtures use `application/octet-stream` JSON bytes so
  Firebase cannot parse the body before the signature check.
- Explicit approval-gate contracts for future live operations.

Safety boundary:

- No real Meta, Hemas, payment, AI or other network adapter is implemented.
- Every non-demo adapter fails closed.
- Setting `HEMAS_PROVIDER_MODE=live` does not enable network access.
- The demo accepts synthetic contact references only.
- The LIMS contract returns report-ready state and a synthetic secure path, never clinical results.
- Medical diagnosis is unsupported and `HEMAS_DIAGNOSIS_ENABLED=true` is rejected.
- Flow helpers accept only the internal demo schema and a caller-provided 32-byte-or-longer synthetic test key; they read no secrets and perform no persistence or network calls.
- Synthetic ingress accepts only allowlisted route/contact/message references
  and text codes. It rejects tenant IDs, phone numbers and free-form message
  bodies, and cannot initialize Admin Firestore outside the demo project plus
  loopback emulator boundary.
- Live/Meta Flow endpoints and encrypted data exchange are not implemented and always fail closed.
- The durable audit adapter is verified only against the Standard Firestore
  emulator. It still requires an explicitly authorized runtime binding,
  production identity/IAM design, retention policy and review before UAT or
  production can be ready.

Commands:

```sh
npm install
npm run typecheck
npm test
```

Node.js 22 is the deployment target. Production deployment, Firebase project selection, Firestore edition/location selection, secrets, IAM and real provider activation are deliberately outside this skeleton.
