# Hemas Connect management demo runbook — 12 August 2026

## Approved demo posture

- **Enterprise:** governed synthetic workspace. Production outbound, real patient data,
  diagnosis, HIS and LIMS remain locked.
- **Lite:** allowlisted Meta canary only. It is not a patient workflow or production launch.
- Do not enter patient, clinical, receipt, report or real operational data.
- Keep the management walkthrough zero-send. Campaign and booking operations are
  server-idempotent, but provider acceptance belongs only in the approved canary test.
- Never show or paste passwords, tokens, raw phone numbers, UIDs or provider asset IDs.

## Mandatory preflight

1. Use the exact `hemas-whatsapp` Firebase project, `hemas-connect` App Hosting backend,
   `hemas-connect--hemas-whatsapp.us-central1.hosted.app` host and Standard Firestore
   database `(default)`. Do not target the separately present Enterprise database named
   `default`.
2. Rotate/revoke every credential that was ever embedded in a browser build. The UAT
   management identity must be different from the public local-emulator fixture identity.
3. Create Lite Auth users privately. `liteDemoSetup` now creates memberships only; it
   never creates users or sets passwords. Separately pre-provision the verified management
   identity's active `tenant_admin` membership; every setup/recovery callable re-checks it
   server-side so a disabled post-demo membership immediately blocks stale ID tokens.
4. Through approved Firebase Admin tooling, merge these exact boolean custom claims onto
   the intended demo identities, preserving unrelated existing claims:
   - Verified Full management identity: `hemasPortalDemo: true`
   - Lite reply/campaign operators: `hemasLiteCanary: true`
   - Lite membership administrator: `hemasLiteAdmin: true`
   - Direct Meta canary-template operator: `hemasMetaCanary: true`
   - Private Meta outbox recovery operator only: both `hemasMetaCanary: true`
     and `hemasMetaCanaryAdmin: true`
5. Force sign-out/token refresh after changing claims. After the approved live-test
   window, use the dry-run-first command in `docs/OPERATOR_TOOLING.md` to revoke all five
   claims, disable the workspace membership and revoke refresh tokens together.
6. Verify WABA ID, phone-number ID, webhook signature secret and the tester allowlist in
   the approved runtime without printing their values.
7. Deploy and record the exact Git revision, App Hosting rollout and Functions revision.
   A local build or a prior hosted release is not deployment evidence.
8. Run `npm run validate` and retain the pass/fail log. Stop if any gate fails.

## Local zero-network fallback

Use this if the cloud/provider preflight is incomplete. It starts only local Auth and
Firestore, so no Functions or Meta send path is available.

1. Terminal A: `npx firebase emulators:start --only auth,firestore --project demo-hemas-connect`
2. Terminal B: `npm run emulators:seed`
3. Terminal B: `npm run dev`
4. Sign in with the synthetic administrator credential from the private presenter note.
   Never display or paste it into the meeting chat or recording.
5. The seed provides 14 clearly labelled aggregate-only analytics fixture days and fixes
   campaign sends at zero. Stop the demo if any screen describes them as provider results.

## Management walkthrough (zero provider side effects)

1. Open Enterprise and show the governed-demo banner and Hemas branding.
2. Open **Analytics**. Explain that the first section reads authenticated, content-free
   daily WhatsApp counters; the lower section is explicitly a deterministic scenario model.
3. Open **Inbox**, select a conversation, and use **Open lead in CRM**. Confirm the exact
   contact opens without creating a duplicate.
4. Show consent/suppression evidence, human handoff and the clinical-advice hard stop.
5. Open Lite from the Enterprise header. Show dashboard, inbox ownership, CRM, appointment,
   campaign review and aggregate analytics. Do not press a live-send confirmation.
6. Show loading, empty and recovery states on a narrow mobile viewport.

## One-number canary acceptance (requires explicit release approval)

Use one designated allowlisted tester only. Record timestamps and content-free evidence;
never record the full number or message body in the report.

1. Inbound tester message reaches the exact configured WABA and phone-number asset.
2. Signed webhook creates one receipt; a replay creates no second reply or metric increment.
   Confirm every planned effect reaches terminal state; use the private outbox reconciler
   only for a due pre-dispatch failure. If an effect is already fatal after provider dispatch,
   use the separate evidence-only fatal-effect control only after independently verifying the
   exact provider outcome; that control records evidence and never sends or retries.
3. Bot response is delivered to the same tester and appears in Lite Inbox.
4. The contact is captured once and **Open lead in CRM** resolves the same lead.
5. One agent claims the chat; a second agent cannot claim, release or reply.
6. The owning agent sends one approved, non-clinical reply inside the service window.
   Keep the same `reply_...` operation ID for an unchanged retry.
7. Aggregate counters update without names, full numbers or message bodies.
8. Tester sends exact `STOP`; suppression evidence is written once and bot/AI/campaign
   responses stop. Confirm the contact is excluded from campaign eligibility.
9. Inspect the content-free outbox and resolve only safe due pre-dispatch work. Then,
   through the approved runtime configuration process, disable bot/auto-reply and set the
   Meta canary gate off. Verify the webhook refuses further canary processing without
   printing secrets.
10. Revoke all five claims, disable the selected workspace memberships, revoke refresh
    tokens and close all demo sessions using the dry-run-first operator command.

## External release evidence and stop conditions

- Campaign, booking, reply and direct-template operations now reserve durable IDs before
  provider dispatch. Reuse the same operation ID only for an unchanged request; never mint
  a replacement to bypass a `sending`, `processing`, `send_uncertain` or `uncertain` state.
- The webhook now persists deterministic effect records before acknowledging and can recover
  due pre-dispatch failures through the private reconciler. A post-dispatch ambiguous outcome
  intentionally becomes fatal/uncertain and requires provider evidence; it is never resent.
  The private fatal-effect control accepts an exact effect/request binding, effect kind,
  confirmed outcome and evidence digest, and atomically closes the effect without a provider
  call. Never use it without independently verified evidence.
- Do not reopen a reply lease manually. Use `liteReconcileAgentReply` only after an authorized
  operator verifies provider evidence; the callable records evidence and never calls Meta.
- Booking and campaign ambiguity use the matching private evidence-only controls in Lite
  Settings. `halt_reserved` closes a stale reserved campaign without sending, while every
  campaign reconciliation terminates unsent recipients and never resumes the send loop.
- Historical version-1 canary receipt documents may contain tester identifiers and require
  a separately approved retention/cleanup decision.
- A real provider send, deployment, custom-claim change, credential rotation or data cleanup
  is an external change and needs an authorized operator and recorded approval.
- Claim revocation alone does not stop the signed webhook. Closing a live-test window also
  requires an approved runtime update that disables bot/auto-reply and the canary gate after
  pending effects are inspected.
- Local tests are not live acceptance. Record the deployed revision, exact Functions revision,
  one-number inbound/delivery/STOP evidence and post-demo claim revocation before making a
  production-ready claim to management.
