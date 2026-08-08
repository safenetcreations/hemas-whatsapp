# HEMAS-CLINIC (Hemas Connect) — Full Codebase Analysis

- **Analyzed:** Saturday 08 Aug 2026, by Claude (independent review + fresh build/test runs in a clean Linux environment, Node 22)
- **Source:** `/Users/nanthan/Desktop/HEMAS-CLINIC` (snapshot taken 08 Aug ~14:45 IST)
- **Built by:** OpenAI Codex, Fri 07 Aug ~17:30 → Sat 08 Aug ~07:18 (≈14 hours, then stopped)

---

## 1. Executive summary

**Hemas Connect** is a governed, multi-tenant WhatsApp patient-engagement platform for Hemas clinics (appointments, lab-report notifications, campaigns, care automations, consent and audit oversight), running entirely as a **synthetic, emulator-only SafeNet demo** — deliberately not connected to Meta, Hemas systems, a real AI provider, or real patient data.

**Overall verdict: this is a high-quality, unusually disciplined build that is ~85–90% complete for its "synthetic demo" milestone.** It stopped mid-stream on the final workstream (AI & Knowledge persistence) and left three concrete problems behind:

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | `tsc --noEmit` and `next build` **fail** — 8 type errors in the last test file Codex was writing (`tests/ai-governance-repository.test.ts`) | 🔴 Blocking | **Fix verified** (3 small edits — see §6.1) |
| 2 | `firestore.rules` has a real bug: 19 calls to `timestamp.value(seconds, nanos)` — a 2-argument form that doesn't exist in the Rules language. The AI-governance rules **error at evaluation** (fail closed: authorized staff reads are denied) | 🔴 Blocking for AI module | **Fix verified** (convert to epoch-millis — see §6.2) |
| 3 | **Zero git commits** — the entire ~14-hour build is an uncommitted working tree on `main` | 🔴 Operational risk | Recommend committing immediately |

Everything else verified clean on a fresh machine: **ESLint 0 issues · 567/567 unit tests pass · Functions build + 187/189 tests pass (2 intentionally skipped) · 84/86 Firestore/Storage rules tests pass before my rules fix, 86/86 after · `next build` produces all 19 routes after the test fix.**

---

## 2. What the product is

### 2.1 Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16.3 (App Router, static prerender), React 19.2, TypeScript 5.9 (strict), Tailwind CSS 4.2, lucide-react |
| Validation | Zod 4 (client), hand-rolled strict parsers (repositories & Functions) |
| Backend | Firebase Cloud Functions v2 (Node 22, callables + HTTPS), Firebase Admin SDK |
| Data | Cloud Firestore (deny-by-default rules, 3,139 lines / 71 match blocks), Firebase Storage (all direct access denied) |
| Auth | Firebase Auth (emulator; seeded synthetic identity), Firestore-backed workspace membership with live revocation |
| Hosting target | Firebase App Hosting (`apphosting.yaml`, backend `hemas-connect`) |
| Testing | Vitest 4 (unit + rules), node:test (Functions), Playwright (browser QA evidence in `output/playwright/`) |

### 2.2 Scale of the codebase

| Area | Lines of TypeScript |
|------|--------------------:|
| `app/` (19 routes, thin pages) | 743 |
| `components/` (module workspaces) | 23,977 |
| `lib/` (domain types, repositories, config) | 20,594 |
| `functions/src/` (backend services) | 17,054 |
| `tests/` (root: unit + rules) | 24,265 |
| `functions/test/` | 10,902 |
| `scripts/` (seed + emulator verifiers) | 9,289 |
| `firestore.rules` | 3,139 |
| **Total** | **≈110,000** |

Zero `TODO`/`FIXME`/`HACK` markers anywhere. Documentation is exceptional: a 101 KB PRD with 10 delivery phases, plus 11 audit/runbook docs in `docs/`.

### 2.3 Module map and completion status

| Portal module | Route | Data source | Status |
|---------------|-------|-------------|--------|
| Overview | `/` | module configs | ✅ Shell complete |
| Inbox | `/inbox` | **Firestore (persisted)** | ✅ Complete for demo — 7 conversations, content-free message metadata |
| Contacts | `/contacts` | **Firestore (persisted)** | ✅ Complete — 6 staff-safe contacts, consent evidence, revisioned preferences, secrets split |
| Appointments | `/appointments` | **Firestore + audited callable** | ✅ Complete — request-only transitions, immutable events, idempotency |
| Lab journeys | `/labs` | **Firestore (persisted)** | ✅ Complete — read-only workflow, secrets split into `labReportSecrets` |
| Campaigns | `/campaigns` | **Firestore + audited callable** | ✅ Complete — governed 50,000-record aggregate campaign, full lifecycle (45 actions verified) |
| Templates & Flows | `/templates` | **Firestore (persisted)** | ✅ Complete — 12 template versions + 18 Flow variants (EN/SI/TA) |
| Automations + Care | `/automations` | **Firestore + audited callables** | ✅ Complete (Phase 5) — 23 collections, all client-write-denied |
| Compliance | `/compliance` | **Server projection via callable** | ✅ Complete — minimized audit timeline, paginated |
| Connections | `/connections` | **Firestore (3 fixed gets)** | ✅ Complete — governed read-only inventory `1/2/0/0/2/0` |
| **AI & Knowledge** | `/ai-knowledge` | **Hardcoded fixtures** ⚠️ | 🟡 **In progress — where Codex stopped** (see §5) |
| Analytics | `/analytics` | Hardcoded sample data | 🟡 Demo-quality UI, not persisted |
| Usage | `/usage` | Hardcoded sample data | 🟡 Not persisted |
| Team & Routing | `/team` | Deterministic fixtures | 🟡 Not persisted (teams/locations ARE seeded in Firestore, but the UI reads fixtures) |
| Settings | `/settings` | Hardcoded data | 🟡 Not persisted |
| Help | `/help` | Hardcoded data | 🟡 Not persisted |
| Demo Lab | `/demo-lab` | Local scenario runner | 🟡 Not persisted (by design, partially) |
| Login | `/login` | Firebase Auth emulator | ✅ Complete |

---

## 3. Architecture assessment

### 3.1 Layering (consistent across all persisted modules)

```
app/(portal)/<module>/page.tsx          ← thin page
  └─ components/<module>/*             ← workspace UI + use-<module> hook
       └─ lib/firebase/repositories/*  ← strict v1 parsers, fixed-document reads, fail-closed
       └─ lib/firebase/<x>-functions-emulator.ts ← loopback-only callable clients
            └─ functions/src/<module>/ ← contracts → service → callable
                 └─ service-kernel.ts  ← shared authz + audited transaction executor
                      └─ Firestore     ← deny-by-default rules + composite indexes
```

### 3.2 Notable engineering strengths

- **Fail-closed everywhere.** `lib/config/public-env.ts` types the kill-switches as `z.literal("false")` — setting `NEXT_PUBLIC_EXTERNAL_MESSAGING_ENABLED=true` doesn't enable messaging, it *crashes the app at parse time*. Client factories reject non-loopback hosts and non-`demo-` project IDs.
- **Secrets split pattern.** Protected values (phone lookup HMACs, external patient refs, lab report refs, run secrets) live in parallel `*Secrets` collections with total client deny; staff-safe projections carry only masked/bounded fields.
- **Audit + idempotency discipline.** Every mutation goes through an audited callable that atomically writes: state change + immutable event + redacted audit record + private idempotency receipt. Replay and conflict behavior is explicitly tested (45-action campaign lifecycle, Phase 5's 19 join reconciliations).
- **Multi-tenant scoping.** All operational documents live under `workspaces/{workspaceId}` with denormalized `teamId`/`locationId` enforced by rules; membership is server-managed with live revocation sign-out.
- **Honest labeling.** Every synthetic surface says so in the UI; the README and `docs/IMPLEMENTATION_STATUS.md` maintain an explicit implemented-vs-pending boundary. The docs' claims matched what I found in code in every case I cross-checked (with one staleness exception, §6.3).
- **Security headers** in `next.config.ts` (nosniff, DENY framing, referrer & permissions policies), `poweredByHeader` off, no-index portal.

### 3.3 Weaknesses / debt

- **Leftover empty scaffolding:** `db/`, `drizzle/`, `worker/`, `examples/d1/`, `.openai/` are empty remnants of a removed Cloudflare/D1 starter path — should be deleted.
- `output/` (Playwright QA evidence) is **not** gitignored (only `/outputs/` is) — decide whether evidence PNGs belong in the repo.
- `firestore-debug.log` sits in the repo root (it *is* gitignored).
- Root `package.json` `engines` says `>=20.9.0` while `.nvmrc` and Functions demand Node 22 — harmless but inconsistent.
- The huge `firestore.rules` (3,139 lines) embeds fixed document IDs and exact timestamps for the synthetic seed. Fine for a governed demo; will need a different strategy for production data.

---

## 4. Verified build & test status (fresh clean-room run, 08 Aug 2026)

Run on Node 22.21.1 / npm 11, `npm ci` for root and `functions/`:

| Gate | As found | After my two fixes (§6.1, §6.2) |
|------|----------|-------------------------------|
| `npm run lint` (ESLint 9 flat) | ✅ Pass, 0 warnings | ✅ Pass |
| `npm run typecheck` (`tsc --noEmit`) | ❌ **FAIL — 8 errors** in `tests/ai-governance-repository.test.ts` | ✅ **Pass** |
| `npm run test` (Vitest) | ✅ **567/567 pass** (44 files, incl. the AI tests at runtime) | ✅ 567/567 |
| `npm run test:functions` (node:test) | ✅ 187 pass / 2 skipped / 0 fail | ✅ same |
| Functions `tsc` build | ✅ Pass | ✅ Pass |
| `npm run test:rules` (Firestore+Storage emulators) | ❌ **84/86 — 2 AI-governance tests fail** with a Rules evaluation error | ✅ **86/86 pass** |
| `npm run build` (Next.js production) | ❌ FAIL (blocked by the same type errors) | ✅ Pass — 19 routes + not-found prerendered |

> Note: the unit-test count (567 across 44 files) is already higher than the last recorded evidence in `docs/IMPLEMENTATION_STATUS.md` (506 across 39 files) — the AI-governance test files were added after that snapshot and never got a green full-gate run.

---

## 5. Where exactly Codex stopped

### 5.1 Reconstructed timeline (Asia/Colombo)

| Time | Activity |
|------|----------|
| Fri 07 Aug ~17:30 | Project scaffolded (Next.js + Tailwind + Firebase workspace) |
| Fri 07 Aug evening | PRD (101 KB), foundation, auth/membership, contacts/inbox |
| Fri 07 Aug night → Sat early | Appointments, labs, templates, campaigns, Phase 5 automations/care, compliance, connections + emulator verifications and Playwright QA (evidence in `output/playwright/*-20260808/`) |
| Sat 08 Aug 05:12 | Last Firestore emulator session shut down cleanly |
| Sat 08 Aug 05:55–05:58 | `firestore.indexes.json` + `firestore.rules` finalized — the **AI & Knowledge governance rules lane** (this is the code containing the `timestamp.value` bug; its emulator run was explicitly deferred, and my run shows it would have failed) |
| Sat 08 Aug 07:16–07:18 | **Last actions:** staged the real Firebase project identity — `.firebaserc` gains `"hemas-cloud-uat": "hemas-whatsapp"`, `.env.local`/`.env.example` gain `NEXT_PUBLIC_HEMAS_CLOUD_FIREBASE_*` descriptor vars, `lib/firebase/cloud-project-config.ts` (identity-only, runtime & Analytics hard-blocked) |
| — | **Stopped.** No git commit was ever made |

### 5.2 The unfinished workstream: AI & Knowledge persistence

Codex was mid-way through converting the AI & Knowledge module from a hardcoded demo into a persisted, governed module (the "corrected AI persistence contract" per `docs/AI_GOVERNANCE_PERSISTENCE_AUDIT.md`, the newest doc). Status of each piece:

| Piece | State |
|-------|-------|
| Domain contract (`lib/domain/ai-governance.ts` — 20/15/44/47-key schemas, fingerprints, role matrix) | ✅ Done (SHA-256-frozen in the audit doc) |
| Firestore seed (5 knowledge docs, 3 selections, 5 secret records = 13-doc governance seed) | ✅ In `scripts/seed-emulators.ts` |
| Security Rules for `knowledgeDocuments`, `knowledgeSelections`, `aiRuns`, `aiRunEvents` + 3 secret collections | 🟡 Written, **but contain the `timestamp.value(s, ns)` bug — never executed until my run** |
| Rules emulator tests (hostile suite, 11 attack classes) | 🟡 Written; 2/86 failed on the bug; **86/86 after fix** |
| Client repository (`ai-governance-repository.ts`, fail-closed parsers) | ✅ Done; runtime tests pass |
| Repository unit tests | 🟡 Written, **left with 8 type errors → broke typecheck & build** |
| Functions callable `demoRecordSyntheticAiRetrospective` (exported in `functions/src/index.ts`) | ✅ Built + its Functions tests pass |
| Emulator materialization of the 4 retrospective runs (13 → 37 docs) | ❌ Not run |
| **UI wiring** — `components/ai-knowledge/ai-governance-workspace.tsx` still imports hardcoded `ai-governance-data.ts`, not the repository | ❌ **Not started — the visible gap** |
| Browser QA for the persisted AI surface | ❌ Not done |

### 5.3 Remaining unfinished surfaces (after AI & Knowledge)

Per the roadmap in `docs/IMPLEMENTATION_STATUS.md` ("Next safe sequence"), still to be persisted with the same Rules + audited-service + browser-evidence pattern: **Analytics, Usage, Settings, Team & Routing (UI), Demo Lab, Help**, plus home-collection planning and patient-view Flow navigation. Then a full clean-room `npm run validate` and a whole-portal desktop + 390 px mobile sweep.

---

## 6. Issues found (with fixes)

### 6.1 🔴 Broken typecheck & production build — `tests/ai-governance-repository.test.ts`

8 errors, all in the newest test file; runtime behavior is unaffected (Vitest passes). Minimal verified fix (3 edits):

- **Line ~123–124** (in `knowledgeDocument()`): `synthetic: true,` → `synthetic: true as const,` and `schemaVersion: 1,` → `schemaVersion: 1 as const,`
- **Line ~171** (in `knowledgeSelection()`): `schemaVersion: 1,` → `schemaVersion: 1 as const,`
- **Line ~525**: `const attacks: Readonly<Record<string, unknown>>[] = [` → `const attacks: Record<string, unknown>[] = [` (the test mutates these objects on purpose)

After this: typecheck ✅, all 567 unit tests ✅, `next build` ✅ (verified).

### 6.2 🔴 `firestore.rules` bug — invalid 2-argument `timestamp.value(seconds, nanos)`

The Rules language only accepts `timestamp.value(epochMillis)` (or a string). 19 occurrences (8 distinct values) in the AI-governance section make every authorized AI read **error → deny** (hostile denials still pass, which is why only the 2 "allow" tests fail). Verified fix — replace each pair with epoch-milliseconds:

| Written (invalid) | Correct |
|-------------------|---------|
| `timestamp.value(1780272000, 0)` | `timestamp.value(1780272000000)` |
| `timestamp.value(1782864000, 0)` | `timestamp.value(1782864000000)` |
| `timestamp.value(1785542399, 999000000)` | `timestamp.value(1785542399999)` |
| `timestamp.value(1785542400, 0)` | `timestamp.value(1785542400000)` |
| `timestamp.value(1786105800, 0)` | `timestamp.value(1786105800000)` |
| `timestamp.value(1788220799, 999000000)` | `timestamp.value(1788220799999)` |
| `timestamp.value(1790812799, 999000000)` | `timestamp.value(1790812799999)` |
| `timestamp.value(1793491199, 999000000)` | `timestamp.value(1793491199999)` |

After this: **86/86 rules tests pass** (verified in clean emulators), and the static AI security-contract tests still pass.

### 6.3 🔴 No version control safety net

- `git init` was done but there are **zero commits**; ~14 hours of work exists only as files on disk.
- A stale `.git/index.lock` is present (harmless once removed; note macOS folder permissions currently block deleting it through the session's mounted view — remove it locally with `rm .git/index.lock` if `git add` complains).
- Recommendation: commit immediately, before any further agent runs touch the tree.

### 6.4 🟡 Stale status-doc claims

`docs/IMPLEMENTATION_STATUS.md` records "TypeScript: passed" and "Rules 77/77" — both were true *before* the final AI-governance lane landed (which added the failing types, new rules and 9 more rules tests). The doc itself warns it's a component-level snapshot; after applying §6.1/§6.2 and re-running, refresh the evidence section.

### 6.5 🟡 Known-open items Codex documented (still open, confirmed)

- **Functions dependency audit:** 7 moderate transitive findings (`uuid < 11.1.1` via the Firebase Admin/Functions chain, GHSA-w5hq-g745-h8pq). The forced fix is a breaking downgrade to `firebase-functions@4` — correctly *not* applied. Root workspace: 0 vulnerabilities. Open release gate.
- **Node mismatch:** Functions target Node 22; Codex's local emulator ran host Node 20 with warnings. (My verification ran everything on Node 22 — no warnings, all green, so this risk is now partially retired; re-confirm on your Mac with `nvm use 22`.)
- **Host ADC exposure:** the Functions emulator detected Application Default Credentials on the Mac. All verified paths were loopback/demo-bound, but connected work should use an isolated dev identity.
- **App Check** deliberately not enforced in emulator callables — a connected-UAT gate.

### 6.6 🧹 Housekeeping

- Delete empty leftover dirs: `db/`, `drizzle/`, `worker/`, `examples/`, `.openai/` (removed D1/Cloudflare starter remnants).
- Decide on `output/playwright/` (QA evidence PNGs/JSON) — keep, move, or gitignore (`/output/` currently would be committed).
- `work/reference/hemas-feature-checklist.jpeg` is the original feature checklist photo — worth keeping.
- `_analysis_snapshot.tgz` (created during this analysis) has been moved to `_to_delete/` in your project folder — safe to trash.

---

## 7. Security posture

### 7.1 Strong points (verified)

- Deny-by-default Firestore rules: every collection ends `allow create, update, delete: if false;` for clients unless explicitly enumerated; `allow list: if false` on all fixed-get collections; 10 secret/receipt collections deny client **reads** too.
- Membership authority is server-managed (`workspaces/{id}/members/{uid}`), with MFA flags, recent-auth windows (≤15 min, non-overridable), role+scope matrices per collection, and live revocation.
- Storage: total direct-client deny.
- Ingress webhook: HMAC-verified **before** JSON parse, raw-body signing, replay protection, monotonic status, STOP consent evidence.
- The demo cannot silently escalate: `demo-` project prefix, loopback-only hosts, literal-`"false"` env gates, provider adapters fail closed, cloud descriptor module validates but never initializes Firebase.

### 7.2 Residual risks (from `docs/FIRESTORE_RULES_AUDIT.md`, all still accurate)

- Admin SDK bypasses Rules — every backend path must keep repeating authz (they currently do, via `service-kernel.ts`).
- Rules can't compute SHA-256 — fingerprint joins rely on trusted writers + strict readers (golden-vector tests exist).
- These are prototype controls: no pen test, DPIA, accessibility audit, or production security certification is claimed.

---

## 8. Deliberately not implemented (correctly out of scope)

- No cloud deploy; no Firebase project bound for runtime (the `hemas-whatsapp` project is staged **identity-only**, runtime and Analytics hard-blocked).
- No Meta Business Portfolio / WABA / phone number / webhook / template approvals.
- No real AI model or retrieval provider; no Hemas HIS/LiveTrack/LIMS integration; no payments.
- No real patient data anywhere; no production SSO/MFA/App Check/staff provisioning.
- No DPIA, legal, clinical, pen-test, DR or UAT acceptance claimed.

---

## 9. Recommended next steps (ordered)

1. **Commit everything to git now** (after removing `.git/index.lock`): `git add -A && git commit` — protect the 14 hours of work before anything else touches it.
2. **Apply the two verified fixes** (§6.1 test types, §6.2 rules timestamps) — I can write them to your project on request; both are included in this analysis. Then `npm run typecheck && npm run test:rules && npm run build` should all be green (they were in my clean-room run).
3. **Finish the AI & Knowledge lane** (the exact point Codex stopped): wire `ai-governance-workspace.tsx` to `ai-governance-repository.ts` behind the existing session/permission gates, run `emulators:seed`, materialize the 4 retrospective runs via `demoRecordSyntheticAiRetrospective`, and do the browser QA pass.
4. **Persist the remaining surfaces** — Analytics, Usage, Settings, Team, Demo Lab, Help — using the same repository + rules + audited-callable pattern.
5. **Re-run the full gate**: `npm run validate` (one clean-room sequential run) + whole-portal desktop/390 px sweep; refresh `docs/IMPLEMENTATION_STATUS.md` evidence.
6. **Housekeeping**: delete `db/ drizzle/ worker/ examples/ .openai/`, decide `output/` policy, align `engines` to Node 22.
7. **Dependency gate**: track the 7 moderate Functions transitive findings; re-audit before any deploy.
8. **When ready for cloud UAT**: follow `docs/FIREBASE_ONBOARDING_RUNBOOK.md` against the already-staged `hemas-whatsapp` project — keeping external messaging and real-patient flags off, exactly as designed.
9. **Meta/WhatsApp onboarding** remains a separate, later phase (Hemas-owned assets, approvals, real-device canary) per the PRD.

---

## 10. Appendix

### 10.1 Firestore data model (top collections under `workspaces/{workspaceId}`)

Contacts + `contactSecrets` · `consentRecords` · `conversations` · `messages` · `internalNotes` · `appointments` + `appointmentEvents` · `labReports` + `labReportEvents` + 2 secret collections · `templates` · `flows` · campaigns (+ snapshot/events/checkpoints/recipients-none) · 23 Phase-5 automation/care collections (13 staff-readable + 10 server-only) · `knowledgeDocuments` · `knowledgeSelections` · `aiRuns` + `aiRunEvents` + 3 AI secret collections · `auditEvents` · `idempotencyKeys` · phone/WABA routes (server-only) · `members`, `teams`, `locations` · connections + connection secrets.

### 10.2 Cloud Functions surface (all demo-bound, loopback-only)

| Function | Kind | Purpose |
|----------|------|---------|
| `demoRequestSyntheticAppointment` | Callable | Audited reschedule/cancel requests |
| `demoControlSyntheticCampaign` | Callable | Campaign lifecycle (canary→completion, 45 actions) |
| `demoControlSyntheticAutomationRun` | Callable | Phase 5 automation controls |
| `demoControlSyntheticCareEnrollment` | Callable | Phase 5 care pathway controls |
| `listComplianceAuditEvents` | Callable | Minimized, paginated audit projection |
| `demoRecordSyntheticAiRetrospective` | Callable | AI governance retrospective materialization (built, not yet exercised end-to-end) |
| `demoAppendInternalNote` | Callable | Audited internal notes |
| `syntheticInboundWebhook` | HTTPS | HMAC-signed synthetic ingress |
| `hemasConnectReadiness` | HTTPS | Readiness/config report |

### 10.3 Verification commands (as wired in `package.json`)

`lint` · `typecheck` · `test` · `test:rules` · `test:functions` · `emulators` / `emulators:seed` · `emulators:verify-seed` · `emulators:verify-audit` · `emulators:verify-functions` · `emulators:verify-phase5-functions` · `emulators:verify-compliance-functions` · `emulators:verify-ingress` · `build` · `validate` (all of the above, sequentially)

### 10.4 Documentation index (`docs/`)

| Doc | Content |
|-----|---------|
| `HEMAS_WHATSAPP_PLATFORM_PRD.md` | Full PRD — vision, personas, 20 functional areas, 6 Flow specs, AI orchestration, phases 0–10 |
| `IMPLEMENTATION_STATUS.md` | Implemented-vs-pending boundary + evidence (refresh after fixes) |
| `FIRESTORE_RULES_AUDIT.md` / `FIRESTORE_ACCESS_MATRIX.md` | Rules review + role/scope matrix |
| `AI_GOVERNANCE_PERSISTENCE_AUDIT.md` | The in-progress AI persistence contract (the stopping point) |
| `PHASE5_FIRESTORE_PERSISTENCE_AUDIT.md`, `GOVERNED_CAMPAIGN_PERSISTENCE_AUDIT.md`, `CONNECTIONS_PERSISTENCE_AUDIT.md`, `LABORATORY_SECRET_SPLIT_AUDIT.md` | Per-module persistence audits |
| `FIREBASE_ONBOARDING_RUNBOOK.md` | Steps for the first real Firebase project (now staged: `hemas-whatsapp`) |
| `SYNTHETIC_DEMO_ACCEPTANCE.md` | The current end-to-end demo script |
| `DEPENDENCY_RISK_REGISTER.md` | The 7 moderate Functions transitive findings |
