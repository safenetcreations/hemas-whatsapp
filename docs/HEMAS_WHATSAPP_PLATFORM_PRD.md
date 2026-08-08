# Hemas Connect

## Multi-Tenant WhatsApp Patient Engagement and Operations Platform

**Product Requirements Document**

| Field | Value |
|---|---|
| Version | 1.0 |
| Date | 7 August 2026 |
| Status | Final planning baseline; pending Hemas validation and approval |
| Proposed delivery partner | SafeNet Creations |
| Proposed client | Hemas Hospitals |
| Initial operating mode | SafeNet demonstration tenant with synthetic data |
| Production ownership | Hemas-owned Meta Business Portfolio, WABA and phone numbers |
| Classification | Confidential proposal and implementation specification |

---

## 1. Document purpose

This PRD defines the complete product, safety, technical and delivery requirements for a healthcare-focused WhatsApp platform proposed for Hemas Hospitals.

It is the implementation source of truth for:

- The SafeNet-owned demonstration environment.
- A controlled SafeNet WhatsApp canary.
- Hemas user-acceptance testing.
- A Hemas-owned production deployment.
- Future scale to large campaigns, including audience selections of approximately 50,000 contacts.

This document does not claim that:

- Hemas has approved the product.
- SafeNet currently qualifies as a Meta Tech Provider or Solution Partner.
- Hemas systems expose the APIs described here.
- A SafeNet or Hemas Meta portfolio can currently message 50,000 unique recipients.
- Any competitor outcome will be reproduced.
- Any clinical-AI function is approved for patient care.
- The platform is PDPA-certified.

All production assumptions must be validated with Hemas operations, information technology, information security, clinical governance, marketing, legal and data-protection owners.

---

## 2. Executive summary

Hemas already provides substantial digital healthcare capability through the Hemas Health App, web channeling, LiveTrack-style appointment visibility, digital laboratory reports, online consultations, pharmacy services and patient-support channels.

The opportunity is not to replace those systems. The opportunity is to make WhatsApp a trilingual digital front door and operational workflow layer that connects patients, hospital teams and existing Hemas systems.

The proposed platform will:

- Provide Sinhala, Tamil and English patient assistance.
- Offer structured WhatsApp Flows for appointments, laboratory and package enquiries.
- Automate confirmations, reminders, rescheduling and cancellation.
- Notify patients when reports are ready without exposing results in open chat.
- Give departments a shared inbox with assignment, internal notes and human takeover.
- Maintain purpose-specific consent and suppression records.
- Support approved utility and marketing campaigns.
- Process large campaign audiences through governed queues.
- Orchestrate clinician-approved follow-up pathways.
- Measure delivery, engagement, operational outcomes and platform quality.
- Preserve a clean migration from the SafeNet demo tenant to a Hemas-owned production tenant.

WhatsApp will remain a communication and orchestration channel. Hemas clinical, appointment, laboratory and patient systems remain the authoritative systems of record.

---

## 3. Product vision

### 3.1 Vision statement

Enable every Hemas patient to find the right service, complete routine healthcare administration and reach the correct human team through a safe, fast and familiar trilingual WhatsApp experience.

### 3.2 Product positioning

The product is:

- A patient-access and operations platform.
- A multi-tenant WhatsApp SaaS platform.
- A shared service and campaign workspace.
- An integration layer over existing Hemas systems.
- An auditable automation platform.

The product is not:

- An electronic health record.
- A replacement for the Hemas Health App.
- A continuously monitored emergency service.
- A medical diagnosis engine.
- An autonomous treatment or medication adviser.
- An unofficial WhatsApp Web bot.
- A contact-scraping or cold-spam tool.
- A promise of immediate 50,000-recipient sending capacity.

### 3.3 Product principles

1. **Hemas owns production.** Hemas owns its Business Portfolio, WABA, production numbers, templates, payment relationship and patient data.
2. **Synthetic first.** The SafeNet demo uses synthetic patient and campaign data only.
3. **Integration over duplication.** WhatsApp orchestrates the Hemas App, LiveTrack, LIMS, HIS, EHR and CRM rather than recreating them.
4. **Human care remains available.** Automation always has a visible and direct human-escalation path.
5. **Structured before generative.** Use deterministic Flows and system integrations for booking, consent and transactions; use AI only where language and conversation benefit.
6. **Minimum necessary data.** Do not place sensitive clinical content in templates, logs, analytics or unnecessary AI prompts.
7. **Consent is purpose-specific.** Care, utility and marketing communications have separate evidence and controls.
8. **Claims require evidence.** Demo, connected, approved, deployed, canary-tested and production-verified are distinct states.
9. **Safe failure.** Duplicate events, provider errors, unavailable integrations or uncertain AI output must not create duplicate bookings, messages or unsafe advice.
10. **Mobile and trilingual by default.** Patient and agent journeys must work across common phones and in Sinhala, Tamil and English.

---

## 4. Background and benchmark interpretation

Hospital and diagnostic-sector benchmarks support the following architecture pattern:

1. Official WhatsApp Business Platform.
2. A provider or direct Cloud API connection.
3. A custom middleware and orchestration layer.
4. Integration with appointment, laboratory, CRM and hospital systems.
5. Structured WhatsApp Flows.
6. AI-assisted service navigation.
7. A shared human-agent workspace.
8. Analytics, consent and operational governance.

### 4.1 Evidence that informs the product

- Infobip reports that Apollo 24|7 used backend-connected WhatsApp Flows for diagnostic-test booking and achieved a 49 percent increase in bookings and 72 percent higher average revenue per order compared with its prior chatbot booking approach. The source does not publish the baseline, sample size, measurement period or attribution method.
- Gallabox reports that Apollo JBP Hospitals used broadcasts, chatbots, Flows and a shared inbox. Its business-growth and satisfaction figures do not include sufficient public measurement details to be treated as guaranteed outcomes.
- Manipal Hospitals publicly offers a WhatsApp assistant for symptom information, report simplification, service navigation and specialist booking. Its own disclaimer states that the service is informational and does not provide diagnosis, prognosis, treatment or medical advice.
- Fortis and diagnostic-sector evidence supports international-patient coordination, feedback, report-status services and laboratory booking. Public evidence does not establish a universal hospital-wide automated post-discharge schedule.
- Cleveland Clinic is a useful messaging-scale reference, but the widely cited 1.8 million monthly figure concerns Twilio SMS and voice, not a WhatsApp deployment.

### 4.2 Product conclusion

Hemas should adopt the proven operational pattern while avoiding unverified competitor claims. The strongest benchmark to carry into the core scope is backend-connected WhatsApp Flows. Autonomous clinical interpretation remains a separately governed future capability.

---

## 5. Business problem

Patients currently interact with hospitals through multiple separate surfaces such as calls, websites, apps, laboratories, hospital desks and direct messages. This can create:

- Repeated routine calls about appointments and report status.
- Booking abandonment when a patient must change channel.
- Manual confirmation and reminder work.
- Inconsistent service across Sinhala, Tamil and English.
- Fragmented departmental inboxes.
- Weak visibility into patient handoffs.
- Campaign lists with insufficient consent and preference controls.
- Difficulty measuring conversion from message to appointment.
- Risk of exposing sensitive content through ad hoc messaging.
- Operational risk when large broadcasts are attempted without pacing or quality protection.

Hemas needs one governed WhatsApp layer that connects those journeys without creating a second clinical system.

---

## 6. Goals and non-goals

### 6.1 Product goals

G1. Give patients a clear trilingual entry point for appointments, laboratory services, packages and support.

G2. Reduce avoidable manual work for appointment confirmations, reminders, rescheduling and report-status enquiries.

G3. Provide one shared inbox with branch and department routing, human takeover and full operational context.

G4. Create a consent-aware campaign system capable of preparing and processing a 50,000-contact audience safely.

G5. Integrate with Hemas systems through versioned adapters without making WhatsApp the source of truth.

G6. Provide utility-first automation that protects Meta messaging quality.

G7. Create auditable privacy, approval, delivery and agent-action evidence.

G8. Make SafeNet demo-to-Hemas production onboarding a tenant-configuration process rather than a rewrite.

G9. Support clinician-governed care pathways without autonomous diagnosis or medication decisions.

G10. Provide measurable operational outcomes for Hemas leadership.

### 6.2 Non-goals for initial release

- Autonomous medical diagnosis or clinical triage.
- AI-generated prescriptions, dosage changes or treatment plans.
- Direct delivery of raw laboratory results in ordinary WhatsApp messages.
- Automatic report-photo interpretation for real patients.
- Native WhatsApp payment promises in Sri Lanka.
- Replacement of Hemas Health App, LiveTrack, HIS, EHR or LIMS.
- A general-purpose CRM unrelated to WhatsApp and Hemas patient operations.
- SMS, email, Viber or voice as equal first-class channels in the MVP.
- Buying, scraping or enriching third-party contact lists.
- Unapproved marketing to the existing patient or laboratory database.
- Actual 50,000-recipient sends from the demo tenant.
- Billing Hemas or collecting subscription payments within the MVP.

---

## 7. Release stages and truth boundaries

| Stage | Meta ownership | Data | External messaging | Permitted claim |
|---|---|---|---|---|
| Design prototype | None required | Static synthetic data | None | Design prototype |
| SafeNet functional demo | SafeNet demo tenant | Synthetic data | Simulator only by default | Functional demo |
| SafeNet controlled canary | SafeNet WABA | Consented internal testers | Allowlisted small-volume messages | Controlled SafeNet canary |
| Hemas UAT | Hemas tenant and WABA | Synthetic or formally approved UAT data | Approved test recipients | Hemas UAT |
| Hemas production pilot | Hemas tenant and WABA | Governed live data | Limited approved patient cohort | Production pilot |
| Hemas scaled production | Hemas tenant and WABA | Governed live data | Approved segments within verified limits | Production |

### 7.1 Mandatory environment labels

Every page must show the current environment and workspace.

Demo environments must display:

- SafeNet Demo.
- Synthetic data only.
- External sending disabled or allowlist only.
- Sample analytics.

Locked Hemas onboarding views must not imply that Hemas is connected.

Connection, template, integration, quality and messaging-capacity states must show their source and last successful verification time. Mock integrations must display Mock, never Connected. A number may display Messaging ready only after the actual WABA subscription, phone registration, payment/readiness checks and controlled message journey have been verified.

---

## 8. Users, personas and roles

### 8.1 Patient and public personas

**Local patient**

- Wants to find a doctor, package or laboratory service.
- May prefer Sinhala, Tamil or English.
- Expects a fast mobile journey and clear human support.

**Existing patient**

- Wants confirmation, reminder, rescheduling, report-ready status or follow-up.
- May already use the Hemas Health App.

**Laboratory customer**

- Wants home collection, centre information, preparation guidance and report-ready status.

**International patient**

- Needs a coordinator, secure document intake, appointment planning, cost and travel-service coordination.
- Requires human-led clinical and financial communication.

**Campaign recipient**

- Has chosen specific categories of communication.
- Expects relevant, infrequent messages and easy withdrawal.

### 8.2 Staff personas

**Front-desk agent**

- Handles appointment and general-service conversations.

**Laboratory agent**

- Handles collection, centre, preparation and report-status enquiries.

**Department agent**

- Handles maternity, international, outpatient, package or other departmental queues.

**Supervisor**

- Manages assignments, SLAs, handoffs, escalations and quality.

**Campaign operator**

- Builds audiences, prepares templates and schedules campaigns.

**Campaign approver**

- Reviews purpose, consent, template, audience, exclusions, cost and quality risk.

**Analyst**

- Views aggregate performance without unnecessary patient content.

**Tenant administrator**

- Manages team, roles, locations, integrations and workspace policy.

**Hemas privacy or compliance reviewer**

- Reviews consent, retention, exports, audits and processing records.

**SafeNet platform administrator**

- Manages tenant provisioning and platform health without unrestricted patient-data browsing.

### 8.3 Proposed role matrix

| Capability | Platform owner | Tenant admin | Supervisor | Agent | Campaign operator | Campaign approver | Analyst |
|---|---:|---:|---:|---:|---:|---:|---:|
| Provision tenant | Yes | No | No | No | No | No | No |
| Manage Meta connection | Scoped | Yes | No | No | No | No | No |
| Manage members and roles | Scoped | Yes | Limited | No | No | No | No |
| View inbox | Support-gated | Yes | Yes | Assigned scope | No | No | Aggregate only |
| Reply or take over | No by default | Yes | Yes | Yes | No | No | No |
| Build campaign | No | Yes | Limited | No | Yes | No | No |
| Approve campaign | No | Yes | Optional | No | No | Yes | No |
| Start live campaign | No | Policy-dependent | No | No | After approval | After approval | No |
| View consent evidence | Support-gated | Yes | Yes | Limited | Eligibility only | Yes | Aggregate only |
| View audit trail | Scoped | Yes | Limited | Own actions | Own campaigns | Campaigns | Read-only aggregate |
| Change retention policy | No | Proposed only | No | No | No | No | No |

Production permissions must be finalized with Hemas.

---

## 9. Product success metrics

Targets that require a Hemas baseline are marked as baseline-dependent.

### 9.1 Safety and compliance metrics

- Zero cross-tenant data exposure.
- Zero production secrets exposed to browsers or logs.
- 100 percent enforcement of active marketing suppression before send.
- 100 percent of live campaigns linked to an approver and immutable audience snapshot.
- 100 percent of externally initiated messages use the correct approved template when outside the service window.
- 100 percent of urgent-language events either escalate or present the configured emergency path.
- Zero AI-generated medication changes.
- Zero raw laboratory values in proactive templates.

### 9.2 Reliability metrics

- At least 99.9 percent successful webhook acknowledgement, excluding provider outage.
- Duplicate Meta events create no duplicate message, booking or campaign-send records.
- At least 99 percent of eligible reminder events reach a final provider outcome state.
- Inbox message visibility target: p95 under five seconds after accepted webhook processing.
- Flow data endpoint target: p95 under two seconds and always within Meta's endpoint limit.
- Campaign dispatch jobs are retry-safe and resumable.

### 9.3 Operational metrics

- Appointment booking completion rate.
- Reschedule and cancellation self-service rate.
- Appointment no-show rate, baseline-dependent.
- Calls concerning appointment confirmation, baseline-dependent.
- Calls concerning report readiness, baseline-dependent.
- Median and p90 first human-response time.
- Median resolution time.
- Automation-containment rate.
- Handoff rate and handoff completion time.

### 9.4 Campaign metrics

- Eligible audience versus selected audience.
- Sent, delivered, read, clicked and converted.
- Failure rate by reason.
- Opt-out and block/report rate.
- Template quality and pacing state.
- Appointment or package conversion.
- Cost per completed action.
- Frequency-cap compliance.

### 9.5 Patient-experience metrics

- Flow completion rate.
- Abandonment by Flow screen.
- Language-detection correction rate.
- Post-interaction satisfaction.
- Repeat contact for the same unresolved issue.
- Accessibility and low-bandwidth completion rate.

Business targets will be set after a Hemas baseline and pilot cohort are agreed.

---

## 10. Information architecture

### 10.1 Primary navigation

1. Overview
2. Inbox
3. Contacts
4. Appointments
5. Campaigns
6. Templates and Flows
7. Automations
8. Analytics
9. AI and Knowledge
10. Connections
11. Team and Routing
12. Compliance and Audit
13. Usage
14. Settings
15. Demo Lab, visible only in non-production environments

### 10.2 Global shell requirements

- Workspace switcher.
- Environment badge.
- Current Meta connection and sending state.
- Search.
- Notifications and operational alerts.
- Current user's role and department scope.
- Help and escalation.
- Mobile navigation.
- No sensitive information in browser notification previews by default.

---

## 11. Functional requirements

Requirement priorities:

- P0: required for safe MVP or platform foundation.
- P1: required for Hemas production pilot.
- P2: controlled expansion.
- P3: future.

### 11.1 Workspace and tenant management

**FR-TEN-001, P0**

The system shall support multiple isolated workspaces.

**FR-TEN-002, P0**

Every operational record shall resolve through a workspace identifier.

**FR-TEN-003, P0**

A workspace may have multiple WhatsApp connections and phone numbers.

**FR-TEN-004, P0**

Incoming events shall resolve the workspace using the provider phone-number identifier.

**FR-TEN-005, P0**

The platform shall prevent a member of one workspace from reading or writing another workspace's data.

**FR-TEN-006, P0**

Demo, UAT and production workspaces shall use separate data, storage, secrets and outbound policies.

**FR-TEN-007, P0**

The Hemas production workspace shall not reuse SafeNet demo tokens, phone identifiers or templates.

**Acceptance**

- Automated security-rule tests prove cross-tenant denial.
- A phone route maps to exactly one active workspace connection.
- A disabled or suspended workspace cannot send externally.
- Every audit event contains workspace, actor and request identifiers.

### 11.2 Authentication, membership and access control

**FR-AUTH-001, P0**

Staff shall sign in using Firebase Authentication with approved identity providers.

**FR-AUTH-002, P1**

Privileged production roles shall use multi-factor authentication.

**FR-AUTH-003, P0**

Membership shall be workspace-scoped and role-scoped.

**FR-AUTH-004, P0**

Department and location restrictions shall apply in the backend, not only the menu.

**FR-AUTH-005, P1**

Sensitive exports, connection changes and live campaign launches shall require recent authentication.

**FR-AUTH-006, P1**

Role changes and membership revocation shall create append-only audit events.

**Acceptance**

- Hidden navigation does not substitute for backend authorization.
- Revoked users lose access promptly.
- Permission-denied states do not reveal whether a patient record exists.

### 11.3 Shared inbox and conversation operations

**FR-INB-001, P0**

The inbox shall show active, waiting, assigned, escalated, resolved and reopened conversations.

**FR-INB-002, P0**

Agents shall filter by location, department, assignment, language, SLA and status.

**FR-INB-003, P0**

The system shall support automatic routing to queues such as outpatient, laboratory, maternity, international patients and general support.

**FR-INB-004, P0**

Agents shall assign, reassign, take over, release and resolve conversations.

**FR-INB-005, P0**

Internal notes shall never be sent to WhatsApp.

**FR-INB-006, P0**

Human takeover shall stop automated free-form replies until explicitly released.

**FR-INB-007, P0**

The inbox shall show the 24-hour customer-service-window state.

**FR-INB-008, P0**

Outside the service window, the composer shall require an approved template.

**FR-INB-009, P0**

Agents shall see a concise handoff summary, detected language, purpose-specific consent, appointment context and relevant approved facts.

**FR-INB-010, P1**

Supervisors shall see SLA breaches, unassigned conversations and collision warnings.

**FR-INB-011, P1**

The composer shall support approved text, template, image, document and interactive message types subject to policy.

**FR-INB-012, P1**

Sensitive attachments shall require explicit handling controls and shall not appear in general analytics.

**Acceptance**

- Two agents cannot unknowingly send conflicting replies.
- Human takeover prevents AI sends.
- Internal notes are visibly distinct and never included in outbound payloads.
- All replies store provider status and actor information.

### 11.4 Language and accessibility

**FR-LNG-001, P0**

The platform shall support Sinhala, Tamil and English.

**FR-LNG-002, P0**

The system shall detect the likely language and allow patient or agent correction.

**FR-LNG-003, P0**

Approved templates and Flows shall use separate language versions.

**FR-LNG-004, P0**

The system shall not claim that Meta automatically translates approved templates.

**FR-LNG-005, P1**

Mixed-language and transliterated messages shall route to a human when confidence is insufficient.

**FR-LNG-006, P0**

The dashboard shall meet keyboard, focus, contrast and screen-reader expectations.

**Acceptance**

- A patient can switch language without restarting a journey.
- Template selection uses an approved matching language or a controlled fallback.
- Low-confidence language does not produce unsafe clinical assumptions.

### 11.5 AI-assisted patient service

**FR-AI-001, P0**

The assistant shall answer approved FAQs about services, branches, preparation guidance, packages and access paths.

**FR-AI-002, P0**

The assistant shall support appointment initiation and service routing.

**FR-AI-003, P0**

The assistant may collect symptom information for urgency detection and department routing.

**FR-AI-004, P0**

The assistant shall not diagnose, provide prognosis, prescribe, change medication or replace a clinician.

**FR-AI-005, P0**

Urgent language shall trigger a deterministic safety path, pause ordinary automation and offer configured human or emergency escalation.

**FR-AI-005A, P0**

After an urgent escalation, AI shall not reassure, downgrade or resume the patient journey; only an authorized human may close or downgrade the escalation.

**FR-AI-006, P0**

The assistant shall use only approved, versioned knowledge sources.

**FR-AI-007, P0**

Every AI draft shall pass a strict reviewer before automated dispatch.

**FR-AI-008, P0**

A failed review may cause one targeted retry; a second failure shall hand off or send an approved safe fallback.

**FR-AI-009, P0**

The platform shall not store model chain-of-thought.

**FR-AI-010, P1**

Model configuration shall support fallback, timeouts, cost limits and kill switches.

**FR-AI-011, P1**

The AI provider shall not train on Hemas patient content under the approved production terms.

**FR-AI-012, P2**

Plain-language report summarisation may be piloted only after separate clinical, privacy and security approval.

**Acceptance**

- Test prompts cannot obtain diagnoses or medication changes.
- Unsupported facts are refused or handed off.
- Urgent phrases create a visible escalation event.
- Every automated send links to its prompt version, knowledge version and review result without storing hidden reasoning.

### 11.6 Contact and consent management

**FR-CON-001, P0**

Contacts shall use normalized E.164 phone numbers.

**FR-CON-002, P0**

The platform shall use an opaque external-patient reference rather than duplicating the full clinical record.

**FR-CON-003, P0**

Consent shall be recorded separately by purpose, channel and message category.

**FR-CON-004, P0**

Consent evidence shall include source, notice version, language, timestamp and relevant evidence reference.

**FR-CON-005, P0**

STOP, UNSUBSCRIBE and equivalent configured phrases shall immediately suppress marketing messages.

**FR-CON-006, P0**

Withdrawal shall be honored even when received outside WhatsApp.

**FR-CON-007, P0**

Marketing withdrawal shall not silently alter an independently justified care or utility purpose; the distinction shall be visible and governed.

**FR-CON-008, P0**

Campaign eligibility shall use the current consent and suppression state at audience finalization and again before dispatch.

**FR-CON-009, P1**

The platform shall support a trilingual preference centre.

**FR-CON-010, P1**

Duplicate contacts shall be merged through a governed process that preserves consent history and external references.

**FR-CON-011, P1**

Contact imports shall require a documented source and consent-provenance mapping.

**FR-CON-012, P1**

Communication concerning a child or dependent shall follow the current Hemas guardian policy and a verified authority relationship approved by Hemas legal and clinical governance.

**FR-CON-013, P1**

A caregiver or family relationship alone shall not authorize disclosure of patient-specific information; the permitted disclosure scope shall be recorded and revocable.

**Acceptance**

- An opted-out contact cannot receive a marketing send.
- Consent history remains immutable even after current status changes.
- Import cannot proceed without source and purpose metadata.
- Guardian or caregiver journeys disclose no patient-specific information until the required authority is verified.

### 11.7 WhatsApp Flows

**FR-FLW-001, P0**

The system shall support versioned WhatsApp Flow definitions and provider asset identifiers.

**FR-FLW-002, P0**

The system shall support both static Flows and endpoint-powered dynamic Flows.

**FR-FLW-003, P0**

Every Flow launch shall use a signed, expiring token that resolves workspace, patient session, purpose and correlation identifiers.

**FR-FLW-004, P0**

The Flow data endpoint shall decrypt and validate provider requests and encrypt valid responses according to current Meta requirements.

**FR-FLW-005, P0**

Flow submissions shall not be treated as confirmed transactions until the authoritative Hemas system accepts them.

**FR-FLW-006, P0**

Published Flows shall be treated as immutable versions; updates shall clone and publish a new version.

**FR-FLW-007, P0**

Unsupported clients shall receive a safe web or human fallback.

**FR-FLW-008, P1**

Media-upload Flows shall scan, validate and minimize uploaded content before further processing.

**FR-FLW-009, P1**

Flow performance, abandonment and validation failures shall be measured by version and screen.

**Acceptance**

- Replaying a Flow completion does not create a duplicate booking.
- Invalid, expired or cross-workspace tokens fail safely.
- The endpoint remains within Meta's timeout and has a controlled fallback.
- A patient sees final confirmation only after the Hemas adapter confirms success.

### 11.8 Appointment automation

**FR-APT-001, P0**

Patients shall search by hospital, specialty, doctor or service and date, depending on integration availability.

**FR-APT-002, P0**

Patients shall select an available slot through a WhatsApp Flow or controlled web fallback.

**FR-APT-003, P0**

The backend shall revalidate the selected slot before booking.

**FR-APT-004, P0**

Booking shall be idempotent and return an opaque external appointment reference.

**FR-APT-005, P0**

The platform shall send confirmation using the correct approved template or in-window message.

**FR-APT-006, P0**

The system shall schedule configurable reminders, initially proposed at 24 hours and two hours.

**FR-APT-007, P0**

Patients shall confirm, reschedule or cancel through approved buttons or Flows.

**FR-APT-008, P0**

Changes shall synchronize to the authoritative appointment system.

**FR-APT-009, P1**

The system shall support alternative slots and waitlist policy if exposed by Hemas.

**FR-APT-010, P1**

LiveTrack or equivalent status shall be exposed through a secure deep link or approved system response.

**FR-APT-011, P1**

Missed-appointment recovery shall require appropriate purpose and template governance.

**Acceptance**

- A simultaneous slot conflict returns alternatives rather than double booking.
- Reschedule and cancellation update the authoritative system.
- Reminders cancel automatically after cancellation or rescheduling.
- Patient-facing times use Asia/Colombo and clearly display date, time, hospital and doctor/service.

### 11.9 Laboratory and home-collection journeys

**FR-LAB-001, P0**

Patients shall browse or search available tests and packages through approved sources.

**FR-LAB-002, P0**

Patients shall request centre or home collection and choose a supported slot.

**FR-LAB-003, P0**

Preparation instructions shall come from approved Hemas content.

**FR-LAB-004, P0**

When LIMS marks a report ready, the platform shall send a utility notification without clinical values.

**FR-LAB-005, P0**

Report access shall use a short-lived authenticated Hemas App or portal link.

**FR-LAB-006, P0**

The system shall not attach raw reports in the initial production scope.

**FR-LAB-007, P1**

Agents shall see report workflow status without seeing report content unless their Hemas role permits it in the authoritative system.

**FR-LAB-008, P1**

Repeated report-ready messages shall be idempotent and auditable.

**Acceptance**

- No result value or diagnosis appears in a proactive template.
- Expired links require reauthentication or controlled reissue.
- A duplicate LIMS event does not send duplicate notifications.

### 11.10 Packages, services and payment handoff

**FR-PKG-001, P0**

Patients shall view approved package summaries and eligibility disclaimers.

**FR-PKG-002, P0**

Patients shall select location, preferred date and contact details through a Flow.

**FR-PKG-003, P1**

Coupons may be validated only through an authoritative Hemas service.

**FR-PKG-004, P1**

Where payment is required, the platform shall create a short reservation and issue a secure external payment link.

**FR-PKG-005, P1**

Payment success shall be confirmed only through a signed gateway callback.

**FR-PKG-006, P1**

Failed or expired payment shall release the reservation.

**Acceptance**

- The platform does not claim native WhatsApp payment support without current evidence.
- Card numbers and financial-account data never pass through WhatsApp or platform logs.

### 11.11 Template management

**FR-TPL-001, P0**

Templates shall store provider name, category, language, components, variables, version and actual approval state.

**FR-TPL-002, P0**

The system shall distinguish local draft, submitted, approved, paused, disabled and rejected.

**FR-TPL-003, P0**

The UI shall not label a local draft as Meta-approved.

**FR-TPL-004, P0**

Each language variant shall be tracked separately.

**FR-TPL-005, P0**

Template variables shall have validation rules and safe example values.

**FR-TPL-006, P0**

Campaigns shall reference an immutable template version.

**FR-TPL-007, P1**

The system shall synchronize provider approval and quality status.

**FR-TPL-008, P1**

Templates created under SafeNet shall not be represented as transferable to Hemas.

**Acceptance**

- A paused, rejected or unapproved template cannot be selected for live send.
- Template category and language are visible at every approval step.

### 11.12 Campaign management

**FR-CMP-001, P0**

Campaigns shall support draft, audience-building, compliance-review, approval-pending, scheduled, dispatching, paused, completed, cancelled and failed states.

**FR-CMP-002, P0**

Campaigns shall have a documented purpose, message category, owner and target action.

**FR-CMP-003, P0**

The system shall create an immutable audience snapshot before approval.

**FR-CMP-004, P0**

Audience preparation shall normalize, deduplicate, exclude suppression, verify consent, validate language and apply frequency caps.

**FR-CMP-005, P0**

Sensitive health-condition inference shall not be available as an ordinary marketing segment.

**FR-CMP-006, P0**

The operator shall preview eligible, excluded and unknown-consent counts with reasons.

**FR-CMP-007, P0**

Every live campaign shall require an allowlisted test.

**FR-CMP-008, P0**

Every live marketing campaign shall require a separate approver.

**FR-CMP-009, P0**

The campaign shall use an approved immutable template version.

**FR-CMP-010, P0**

Scheduling shall use Asia/Colombo and configurable quiet hours.

**FR-CMP-011, P0**

Dispatch shall use queues and idempotent recipient jobs.

**FR-CMP-012, P0**

The system shall pause automatically on configured quality, provider-error, opt-out or complaint thresholds.

**FR-CMP-013, P0**

Operators shall manually pause and safely resume without duplicate sends.

**FR-CMP-014, P1**

The system shall estimate Meta, cloud and AI usage before approval.

**FR-CMP-015, P1**

The system shall support A/B tests only after audience, consent and statistical rules are approved.

**FR-CMP-016, P2**

Click-to-WhatsApp attribution may be recorded when Meta supplies referral data.

**Acceptance**

- No recipient is stored as one giant campaign array.
- Approval invalidates if audience, template, schedule or purpose changes.
- STOP received after audience approval but before dispatch still suppresses the contact.
- Resume does not resend successful recipients.

### 11.13 50,000-contact campaign capability

**FR-SCL-001, P0**

The demo shall generate, segment and process at least 50,000 synthetic contacts without external sending.

**FR-SCL-002, P0**

Audience creation and dispatch shall be asynchronous.

**FR-SCL-003, P0**

The platform shall split recipient work into bounded queue jobs.

**FR-SCL-004, P0**

The system shall enforce portfolio messaging limit, phone throughput, pair-rate and template-pacing constraints.

**FR-SCL-005, P0**

Live dispatch shall be disabled when the requested unique-recipient volume exceeds verified available portfolio capacity.

**FR-SCL-006, P0**

Multiple phone numbers shall not be presented as multiplying the shared portfolio limit.

**FR-SCL-007, P1**

Rate control shall adapt to current provider responses and quality state.

**FR-SCL-008, P1**

The system shall support checkpoints, retry with backoff, dead-letter handling and reconciliation.

**FR-SCL-009, P1**

Quality and limit changes shall create operational alerts.

**FR-SCL-010, P0**

Interactive replies, utility notifications, marketing campaigns, Hemas integration work and reconciliation shall use separate queues so marketing load cannot block patient operations.

**FR-SCL-011, P0**

If a provider request may have succeeded but no provider message identifier is returned, the recipient shall enter a send-uncertain state for reconciliation rather than being blindly resent.

**Acceptance**

- A synthetic 50,000-recipient campaign can be finalized, queued, paused, resumed and reconciled.
- Browser memory and Firestore document limits are not exceeded.
- Live-send preflight displays the currently verified capacity and blocks unsupported volume.
- Provider errors do not cause uncontrolled retry storms.

### 11.14 Campaign library

The system shall support the following governed campaign types.

**Utility and service**

- Appointment confirmation.
- Appointment reminder.
- Reschedule or cancellation acknowledgement.
- Doctor or clinic status update.
- Laboratory report ready.
- Home-collection confirmation.
- Pharmacy order ready.
- Payment receipt or status, where supported.
- Service disruption or location update.

**Education and awareness**

- Diabetes and non-communicable-disease education.
- Dengue or seasonal health awareness.
- Maternity education.
- Blood-donation drives.
- Clinician-approved health articles and event invitations.

**Marketing**

- Health-check packages.
- Approved specialty-package promotions.
- New-service announcements.
- Clinic or webinar promotion.
- General re-engagement.

**Lifecycle**

- Welcome and preference setup.
- Post-visit feedback.
- Clinician-approved post-discharge enrollment.
- Service-specific follow-up.
- Dormant-contact re-engagement with appropriate consent.

Meta retains final template-category authority. Campaign labels in the product do not override Meta classification.

### 11.15 Automations

**FR-AUT-001, P0**

Automation definitions shall be versioned.

**FR-AUT-002, P0**

Triggers may include inbound intent, appointment event, LIMS report-ready event, discharge event, scheduled time, campaign response and agent action.

**FR-AUT-003, P0**

Every step shall define required consent purpose, service-window behavior, timeout, retry and fallback.

**FR-AUT-004, P0**

Automation shall pause during human takeover.

**FR-AUT-005, P0**

An automation run shall be idempotent and traceable.

**FR-AUT-006, P1**

Operators shall safely pause, resume, end and inspect runs.

**FR-AUT-007, P1**

High-risk automation changes shall require approval and version activation.

**Acceptance**

- The same trigger event does not start duplicate runs.
- An expired service window selects an approved template or no-send path.
- Failed integrations create a work item rather than silently dropping a patient.

### 11.16 Clinician-governed post-discharge pathways

**FR-CARE-001, P1**

Real-patient pathways shall require a Hemas clinical owner and approved protocol version.

**FR-CARE-002, P1**

Enrollment shall require a qualifying discharge event, appropriate purpose and patient communication preference.

**FR-CARE-003, P1**

Contact days shall be configurable by pathway and shall not be copied from a competitor as a universal schedule.

**FR-CARE-004, P1**

Questions and instructions shall be clinician-authored and versioned.

**FR-CARE-005, P1**

Medication messages shall reproduce only approved discharge instructions and shall never change a dose.

**FR-CARE-006, P1**

Red-flag responses shall pause automation and alert the configured clinical queue.

**FR-CARE-007, P1**

Emergency language shall direct the patient to the approved emergency path immediately.

**FR-CARE-008, P1**

Each pathway shall define response SLA, escalation owner and after-hours behavior.

**FR-CARE-009, P1**

The platform shall record whether relevant exchanges must be written back to the official medical record.

**FR-CARE-010, P1**

Before each scheduled care message, the system shall recheck configured readmission, transfer, death, clinical-hold, withdrawal and invalid-contact suppressions.

**Acceptance**

- No pathway can activate without clinical approval metadata.
- A red flag produces a traceable escalation and stops routine automation.
- AI cannot generate new wound-care or medication instructions.
- Readmission, transfer, death, clinical hold or withdrawal stops future pathway sends under the approved protocol.

### 11.17 Click-to-WhatsApp Ads readiness

**FR-ADS-001, P2**

The platform may capture Meta referral identifiers and available creative context from inbound webhooks.

**FR-ADS-002, P2**

Attribution shall tolerate missing referral data.

**FR-ADS-003, P2**

Ad entry shall use a neutral welcome followed by an approved Flow or human path.

**FR-ADS-004, P2**

A click shall not be treated as permanent marketing consent.

**FR-ADS-005, P2**

Advertising measurement shall exclude diagnosis, test result, specialty and patient identifiers.

**FR-ADS-006, P2**

Campaign launch shall require verified Hemas Page, ad account, WABA, creative and consent wording.

### 11.18 Analytics and reporting

**FR-ANA-001, P0**

Analytics shall distinguish sample, UAT and production data.

**FR-ANA-002, P0**

The dashboard shall report message, conversation, agent, Flow, appointment, campaign and automation metrics.

**FR-ANA-003, P0**

Operational dashboards shall use aggregate data by default.

**FR-ANA-004, P0**

Metric definitions shall be documented and versioned.

**FR-ANA-005, P1**

Conversion shall link to an authoritative appointment, package or other approved outcome.

**FR-ANA-006, P1**

The system shall show template quality, provider limits and risk alerts.

**FR-ANA-007, P1**

Exports shall be role-controlled, audited and minimized.

**Acceptance**

- Sample analytics cannot be mistaken for real Hemas results.
- Vendor delivery states reconcile with internal states.
- Conversion is not inferred from a read receipt alone.

### 11.19 Usage and commercial visibility

**FR-USG-001, P1**

The system shall record usage by workspace, connection and feature.

**FR-USG-002, P1**

Usage shall include inbound and outbound messages, template sends, AI requests, model units, storage, Flow sessions and queue jobs.

**FR-USG-003, P1**

Budget thresholds shall generate alerts.

**FR-USG-004, P1**

Pricing configuration shall remain separate from provider credentials.

**FR-USG-005, P1**

The platform shall support a commercial report with setup, base platform, support, agent-seat and usage components without hard-coding unapproved prices.

### 11.20 Connection and onboarding centre

**FR-CONN-001, P0**

The connection centre shall show sanitized WABA, phone-number, webhook, app mode, permission, template, payment and sending states.

**FR-CONN-002, P0**

Connected shall not mean production-ready.

**FR-CONN-003, P0**

Secrets shall never be displayed after entry.

**FR-CONN-004, P0**

Connection changes shall be server-side and audited.

**FR-CONN-005, P1**

Embedded Signup v4 shall be implemented only if SafeNet meets Meta partner eligibility and permission requirements.

**FR-CONN-006, P1**

The authorization code shall be sent to the backend immediately, exchanged server-side and never stored for reuse.

**FR-CONN-007, P1**

Client-supplied WABA and phone identifiers shall be verified through Meta rather than trusted blindly.

**FR-CONN-008, P1**

The app shall subscribe to the customer WABA and register the verified phone through the official API.

**FR-CONN-009, P1**

Successful signup shall not be represented as successful phone registration.

**FR-CONN-010, P1**

If SafeNet is not eligible for Embedded Signup, Hemas shall onboard and own assets through an approved first-party or partner process.

---

## 12. Detailed WhatsApp Flow specifications

The production Flow endpoint shall implement Meta's current encrypted data-exchange protocol, including RSA-OAEP with SHA-256 for the symmetric key and AES-128-GCM for Flow data, using environment- and phone-specific private keys stored in Secret Manager. It shall validate protocol version, action, screen and a short-lived tenant-bound Flow token before calling any Hemas adapter. Official sample servers are reference implementations, not production security controls.

### 12.1 Flow A: Doctor appointment booking

**Purpose**

Allow a patient to search and request an appointment without navigating multiple chat messages.

**Proposed screens**

1. Language and patient context.
2. Hospital or location.
3. Specialty or service.
4. Doctor, optional depending on search mode.
5. Date.
6. Available slots from the appointment adapter.
7. Patient details and consent notice.
8. Review.
9. Submission and pending confirmation.

**Completion logic**

1. Validate signed Flow session.
2. Normalize input.
3. Recheck slot.
4. Create idempotent booking.
5. Store external reference.
6. Send confirmation.
7. Schedule reminders.

**Failure paths**

- Slot no longer available: return alternatives.
- Integration unavailable: preserve request and hand off.
- Unsupported client: secure web fallback.
- Identity mismatch: require controlled verification.

### 12.2 Flow B: Reschedule or cancel

**Proposed screens**

1. Secure appointment selection.
2. Choose reschedule or cancellation.
3. Reason, optional and minimized.
4. New date and slot for rescheduling.
5. Review and confirm.

**Rules**

- Verify the patient or appointment link.
- Apply Hemas cancellation rules.
- Update the authoritative appointment system first.
- Cancel obsolete reminders.
- Schedule new reminders after successful rescheduling.

### 12.3 Flow C: Laboratory or home collection

**Proposed screens**

1. Centre visit or home collection.
2. Search or choose test/package.
3. Location or address, minimized.
4. Date and available slot.
5. Preparation summary.
6. Contact and consent.
7. Review and request.

**Rules**

- Test data comes from approved Hemas sources.
- Address is collected only when required.
- Preparation content is versioned.
- Final confirmation depends on the LIMS or booking adapter.

### 12.4 Flow D: Package enquiry

**Proposed screens**

1. Package category.
2. Approved package summary.
3. Preferred hospital.
4. Preferred date.
5. Contact details.
6. Optional external payment handoff.

**Rules**

- No unsupported clinical suitability claim.
- Coupon and price validation must use an authoritative service.
- Payment remains an external secure step until native availability is independently verified.

### 12.5 Flow E: Feedback

**Proposed screens**

1. Service or appointment reference.
2. Satisfaction score.
3. Reason categories.
4. Optional free text.
5. Permission to contact.

**Rules**

- Low scores may create a service-recovery task.
- Feedback must not be exposed as a public testimonial without separate permission.
- Do not ask for unnecessary clinical content.

### 12.6 Flow F: Communication preferences

**Proposed screens**

1. Language.
2. Utility categories.
3. Education categories.
4. Marketing categories.
5. Frequency preferences.
6. Confirmation.

**Rules**

- Marketing choices are unselected by default unless Hemas legal approval says otherwise.
- Withdrawal is as easy as opt-in.
- The resulting consent record stores notice and Flow versions.

---

## 13. AI orchestration design

### 13.1 Agent sequence

1. Webhook router.
2. Tenant and contact resolver.
3. Consent and service-window guard.
4. Language detector.
5. Intent and safety classifier.
6. Context compressor.
7. Approved-knowledge retriever.
8. Content specialist.
9. Healthcare and WhatsApp reviewer.
10. Sender or human-handoff controller.

### 13.2 Minimum shared state

The orchestration state shall include:

- workspaceId
- connectionId
- conversationId
- contactId
- providerMessageId
- receivedAt
- lastUserMessageAt
- serviceWindowExpiresAt
- withinServiceWindow
- language and confidence
- intent and confidence
- urgency state
- purpose-specific consent state
- human-takeover state
- branch, department and appointment context
- approved facts and knowledge-version identifiers
- draft response
- reviewer result
- send mode
- routing and fallback notes

### 13.3 Reviewer output

The reviewer shall return a strict machine-readable decision containing:

- pass or fail
- reason codes
- unsupported-claim flag
- clinical-safety flag
- privacy flag
- template or service-window flag
- required correction
- handoff requirement

### 13.4 AI-specific non-goals

- No hidden medical diagnosis.
- No report-value interpretation in MVP.
- No decision based solely on inferred age, gender, disease or pregnancy.
- No autonomous discharge-instruction creation.
- No direct access to unrestricted EHR records.
- No use of patient content for model training.

---

## 14. Technical architecture

### 14.1 Current repository baseline and required re-baseline

The current workspace is only the generated site-creator Vinext starter. It uses a beta Vinext and Vite runtime, Cloudflare Worker configuration and an empty optional D1/Drizzle schema. It does not contain Firebase configuration, WhatsApp integration, tenant data or application features.

Before product implementation:

1. Record an architecture decision approving the Firebase and GCP target.
2. Re-baseline the placeholder to a current supported stable Next.js application.
3. Preserve useful reference assets only.
4. Remove unused Cloudflare Worker and D1 paths rather than silently mixing two operational stacks.
5. Establish separate SafeNet demo, Hemas UAT and Hemas production Firebase and GCP projects.

No product implementation is lost by this decision because the current repository contains only the starter.

### 14.2 Recommended stack

**Web application**

- Current supported stable Next.js release at implementation time.
- React and TypeScript.
- Tailwind CSS.
- Mobile-first accessible component system.

**Identity and data**

- Firebase Authentication.
- Identity Platform may provide Hemas enterprise SAML or OIDC if required.
- Firebase App Check for supported browser-to-backend abuse reduction; it does not replace authorization.
- Firestore as the operational system of record for the WhatsApp platform.
- Firebase Storage or Cloud Storage for approved documents and controlled media.

**Backend**

- Cloud Run for public webhook, Flow endpoint and API services.
- Second-generation Cloud Functions for selected event and scheduled handlers where appropriate.
- Cloud Tasks for campaign, message, retry and automation work.
- Cloud Scheduler for scheduled triggers and reconciliation.
- Pub/Sub for decoupled operational events where needed.
- Cloud Armor or an equivalent approved edge control for public endpoint rate limits and WAF protections.

**Security**

- Secret Manager for Meta, provider and integration credentials.
- Cloud KMS for encryption or envelope-encryption requirements.
- Workload Identity for service-to-service access.
- Firebase App Check where appropriate for application-origin requests.

**AI**

- Enterprise-approved model endpoint.
- Server-side calls only.
- Approved no-training and data-handling terms.
- Versioned prompts and knowledge sources.

**Analytics**

- Firestore aggregate documents for MVP.
- BigQuery event export when scale, retention and analysis requirements justify it.

### 14.3 Logical request flow

1. Meta sends a webhook event.
2. Webhook service validates raw-body signature.
3. Service stores an idempotency record.
4. Service returns success promptly.
5. Queue worker resolves workspace and processes the event.
6. Contact, conversation and message state are written transactionally.
7. Automation or AI orchestration creates a reviewed send decision.
8. Sender uses the workspace connection and Secret Manager credential.
9. Provider status callbacks update message and campaign state.
10. Aggregates and alerts update asynchronously.

### 14.4 Environment strategy

- Local development with Firebase emulators and provider fixtures.
- SafeNet demo with synthetic data and simulator.
- SafeNet canary with external allowlist.
- Hemas UAT with isolated project and approved test data.
- Hemas production with separate project, secrets, storage and monitoring.

Production and demo must not share patient collections or dynamic credentials.

Although the application is multi-tenant, Hemas production also receives infrastructure-level separation from the SafeNet demo, including projects, databases, buckets, service accounts, queues, secrets, logs and AI data boundaries. Firestore location is immutable and shall be chosen only after Hemas security, latency, residency and service-availability review.

---

## 15. Firestore domain model

### 15.1 Workspace-scoped collections

All paths below sit under workspaces/{workspaceId} unless stated otherwise.

| Collection | Purpose | Important fields |
|---|---|---|
| workspace | Tenant configuration | name, mode, status, timezone, languages, retentionPolicyVersion |
| members | Workspace access | uid, role, teamIds, locationIds, status |
| teams | Department routing | name, queueType, businessHours, SLA |
| locations | Hospitals and service points | name, type, addressRef, supportedServices |
| whatsappConnections | Meta connections | wabaId, phoneNumberId, maskedNumber, status, qualitySnapshot, limitSnapshot, credentialSecretRef |
| contacts | WhatsApp contacts | phoneLookupHmac, encryptedPhone, maskedPhone, encryptedDisplayName, externalPatientRef, preferredLanguage, suppressionState |
| consentRecords | Immutable consent history | contactId, purpose, category, status, source, noticeVersion, language, capturedAt, withdrawnAt |
| conversations | Conversation state | contactId, connectionId, status, mode, teamId, assigneeId, serviceWindowExpiresAt |
| messages | Inbound and outbound messages | providerMessageId, direction, type, status, templateVersionId, redactedContentRef, timestamps |
| handoffSessions | Human takeover | conversationId, reason, summary, owner, startedAt, endedAt |
| internalNotes | Staff-only notes | conversationId, authorId, bodyRef, createdAt |
| aiRuns | Auditable AI decisions | conversationId, intent, language, urgency, knowledgeVersions, reviewResult, sendDecision |
| knowledgeDocuments | Approved knowledge | title, language, source, approvalState, version, storageRef |
| templates | Template metadata | providerName, category, language, version, approvalState, components |
| flows | Flow metadata | providerFlowId, category, language, version, status, endpointMode |
| flowSessions | Flow correlation | flowId, signedTokenHash, contactId, expiresAt, completionState |
| appointments | Workflow view | externalAppointmentRef, contactId, locationId, serviceRef, slot, status, syncState |
| campaigns | Campaign definition | purpose, templateVersionId, audienceSnapshotId, state, schedule, approval |
| audienceSnapshots | Immutable segment summary | criteria, counts, exclusions, hash, finalizedAt |
| campaignRecipients | Per-recipient state | deterministicHmacId, campaignId, contactId, eligibility, suppressionReason, taskName, providerMessageId, status |
| automationDefinitions | Versioned workflow | trigger, steps, consentPurpose, version, approvalState |
| automationRuns | Workflow execution | definitionVersion, subjectRef, state, currentStep, retryState |
| integrations | External adapter configuration | type, status, secretRef, lastSyncAt, health |
| auditEvents | Append-only audit | actor, action, target, requestId, metadata, createdAt |
| usageLedger | Metering | type, quantity, unit, provider, reference, createdAt |
| dailyMetrics | Aggregates | date, metricVersion, counts, dimensions |

### 15.2 Server-only global collections

| Collection | Purpose |
|---|---|
| phoneRoutes | Resolve provider phone-number identifier to workspace and connection |
| wabaRoutes | Resolve WABA events where required |
| webhookEvents | Provider-event idempotency and processing state |
| jobLocks | Distributed idempotency and scheduled-work locks |
| platformAudit | Platform-level privileged actions |

### 15.3 Data-model rules

- Access tokens never appear in Firestore documents.
- Full clinical records are not copied into the platform.
- Full phone numbers are displayed only to authorized roles.
- Phone numbers never appear in document IDs; lookup uses a keyed HMAC and required plaintext uses approved encryption.
- Message bodies follow an approved retention policy.
- Analytics use aggregate or pseudonymized identifiers.
- Consent records are append-only.
- Campaign audience snapshots are immutable after approval.
- Provider message identifiers enforce idempotency.
- TTL may clean expired webhook receipts, Flow sessions and temporary exports, but authorization must always check expiry because TTL deletion is not immediate.

---

## 16. Security-rule strategy

1. Deny by default.
2. Validate active workspace membership.
3. Enforce role and team/location scope.
4. Deny direct client writes to provider status, usage ledger and audit collections.
5. Deny client access to global routing and webhook-event collections.
6. Restrict exports to approved roles and server functions.
7. Prevent changing immutable workspace identifiers.
8. Prevent a client from marking a template approved.
9. Prevent a client from directly marking a campaign recipient sent.
10. Test every rule against cross-tenant, revoked-member and role-escalation scenarios.

---

## 17. Backend services and endpoints

Names are logical and may be adapted to the selected framework.

Authenticated APIs shall use a versioned contract, schema validation, request identifiers, UTC timestamps, structured errors and explicit idempotency keys for mutations. Private workers shall require Google-signed service identity or an equivalent approved service-to-service control.

### 17.1 Public Meta endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| /webhooks/whatsapp | GET | Verify callback token |
| /webhooks/whatsapp | POST | Verify signature and accept events |
| /whatsapp/flows/data | POST | Encrypted Flow data exchange |
| /health | GET | Sanitized service health |

The webhook handler shall validate the raw-body signature before JSON parsing, decompose batched entries, durably enqueue accepted events and acknowledge promptly. AI and Hemas integration calls shall never run inside the webhook request. Status callbacks may arrive more than once or out of order, so all events are preserved and the current state is derived through a controlled state machine.

### 17.2 Authenticated application services

| Service | Purpose |
|---|---|
| createWorkspace | Provision workspace and initial owner |
| updateMembership | Manage role and scope |
| connectWhatsApp | Create sanitized connection and secret reference |
| exchangeEmbeddedSignupCode | Exchange short-lived authorization code |
| subscribeWaba | Subscribe the app to the WABA |
| registerPhoneNumber | Register verified number with two-step PIN |
| createContactImport | Validate import and consent mapping |
| finalizeAudience | Create immutable eligible audience snapshot |
| approveCampaign | Record independent approval |
| scheduleCampaign | Enqueue scheduled dispatch |
| pauseCampaign | Stop new recipient jobs |
| resumeCampaign | Resume only pending retry-safe work |
| sendTestCampaign | Send to configured allowlist |
| takeOverConversation | Enter human mode |
| releaseConversation | Return to automation policy |
| sendAgentReply | Enforce service-window and template policy |
| createFlowVersion | Create local Flow definition |
| publishFlowVersion | Publish after validation |
| requestAppointment | Call appointment adapter idempotently |
| rescheduleAppointment | Update authoritative appointment |
| cancelAppointment | Update authoritative appointment |
| issueSecureReportLink | Request short-lived authoritative link |
| exportComplianceRecord | Create minimized audited export |

### 17.3 Asynchronous workers

- processInboundWhatsApp
- processStatusCallback
- processFlowCompletion
- orchestrateAssistantReply
- reviewAssistantReply
- sendWhatsAppMessage
- buildAudienceBatches
- dispatchCampaignRecipient
- reconcileCampaign
- processAppointmentReminder
- processLabReadyEvent
- processAutomationStep
- processPostDischargeCheckIn
- aggregateDailyMetrics
- scanUploadedMedia
- expireSecureData
- runRetentionDeletion
- alertConnectionQuality

---

## 18. Integration architecture

### 18.1 Adapter principle

Every external Hemas integration shall implement a versioned adapter contract. The demo uses synthetic adapters with the same interface.

### 18.2 Proposed adapters

**AppointmentProvider**

- Search hospitals, specialties and doctors.
- Fetch live slots.
- Create booking.
- Reschedule.
- Cancel.
- Fetch status.

**LiveTrackProvider**

- Fetch doctor or appointment progress.
- Return approved deep link or status.

**LaboratoryProvider**

- Search tests and packages.
- Fetch collection availability.
- Create home-collection request.
- Receive report-ready event.
- Issue secure report link.

**PatientIdentityProvider**

- Resolve or verify opaque patient reference.
- Prevent exposure of unnecessary identity data.

**CRMProvider**

- Synchronize approved contact preferences and service context.
- Avoid duplicating clinical records.

**PaymentProvider**

- Create short-lived checkout.
- Verify signed callback.
- Query payment status.
- Refund or cancel only through approved Hemas process.

**AnalyticsProvider**

- Receive minimized generic conversion events.
- Exclude clinical or patient-identifying dimensions.

### 18.3 Integration failure behavior

- Timeouts do not create duplicate actions.
- Circuit breakers protect failing systems.
- Patient requests may enter a visible pending or human-review queue.
- The UI distinguishes provider unavailable from patient not found.
- Reconciliation jobs resolve uncertain transactions.

---

## 19. Meta WhatsApp requirements

### 19.1 Official platform only

Production shall use the official WhatsApp Cloud API or an approved partner route. Unofficial WhatsApp Web sessions, QR-bot libraries, scraping, group automation or policy bypasses are prohibited.

### 19.2 Service window

- A customer message or eligible WhatsApp call opens or resets the 24-hour service window.
- Free-form service replies are allowed only while the current window and policy permit.
- Outside the window, outbound communication requires an approved template.
- Opt-in and opt-out obligations apply independently.

### 19.3 Templates

- Templates are WABA assets.
- SafeNet demo templates do not transfer to Hemas.
- Each language is separately submitted.
- Meta retains the right to approve, reject, pause or reclassify.
- Media examples and variable examples follow current requirements.

### 19.4 Messaging limits and 50,000 campaigns

As verified on 7 August 2026:

- Limits apply across the Meta Business Portfolio.
- The levels are 250, 2,000, 10,000, 100,000 and Unlimited unique recipients in the relevant moving window.
- A real 50,000-recipient proactive campaign requires at least the 100,000 level.
- Multiple numbers share the portfolio capacity.
- Scaling depends on current Meta eligibility, quality and usage rules.

The implementation must recheck current documentation and live portfolio state before every production scale decision.

### 19.5 Throughput

As verified on 7 August 2026:

- A registered Cloud API number supports up to 80 messages per second by default.
- Higher throughput has additional eligibility requirements.
- Actual campaign rates remain subject to pair-rate limits, template pacing, recipient restrictions, quality and provider responses.

The platform shall use a configurable rate below the verified provider ceiling and adapt to observed errors.

### 19.6 Embedded Signup v4

The proposed path applies only if SafeNet satisfies Meta's partner prerequisites.

1. Create the correct Facebook Login for Business configuration.
2. Configure HTTPS domains and redirects.
3. Launch Embedded Signup through the official SDK.
4. Capture WABA, phone and business identifiers from the signup event.
5. Capture the short-lived authorization code separately.
6. Send the code to the backend immediately.
7. Exchange it for the customer business token.
8. Validate granted assets.
9. Subscribe the app to the WABA.
10. Register the verified phone number.
11. Run a controlled test.
12. Confirm customer payment configuration.

Successful signup is not proof of phone verification, registration, payment or production messaging.

---

## 20. Healthcare safety requirements

### 20.1 Safe terminology

Use:

- Symptom intake.
- Urgency detection.
- Department or specialty routing.
- Plain-language information.
- Clinician-governed follow-up.

Do not use as autonomous product claims:

- Diagnosis.
- Clinical triage.
- Treatment recommendation.
- Report diagnosis.
- Medication management.

### 20.2 Healthcare messaging classification

| Classification | WhatsApp treatment | Examples |
|---|---|---|
| Public service information | Approved knowledge may appear in ordinary chat | Branch hours, directions, specialties and public package summaries |
| Minimized operational information | Send only under the appropriate service-window, template and permission rules | Appointment time, hospital, booking reference and collection window |
| Sensitive notification | Notification only; content remains behind an authenticated Hemas surface | Laboratory report ready with an expiring secure link |
| Highly sensitive clinical content | Secure Hemas portal or verified authorized-human workflow only | Test values, diagnosis, clinical images and detailed treatment plans |
| Restricted identifiers and financial data | Do not request or send through ordinary chat | Full identity-document, card or financial-account numbers |
| Prohibited automated clinical output | Never generate or dispatch | Diagnosis, prognosis, medication changes, dosage advice or reassurance that care can wait |

Proactive messages shall reveal the minimum information required because a phone may be shared or visible on a lock screen. Staff and bots shall never ask a patient to send a portal OTP back through chat.

### 20.3 Emergency and urgent handling

- Hemas supplies the verified emergency language and destinations.
- Urgent classification is deterministic and conservative.
- Ordinary automation stops.
- The patient receives the approved immediate action.
- A clinical or support escalation is created where appropriate.
- The system does not claim that a message has been clinically reviewed until it has.
- AI cannot reassure or downgrade the event after escalation; an authorized human owns closure.

### 20.4 Report and media handling

MVP:

- Report-ready notification only.
- Secure portal or app access.
- No report content in proactive text.

Future controlled pilot:

- Verified identity.
- Explicit purpose and consent.
- Malware scanning.
- Minimal temporary storage.
- No model training.
- Plain-language summary only.
- Source-value preservation.
- Clear uncertainty.
- Human review for significant or unclear content.

### 20.5 Clinical protocol governance

- Each care pathway has a named Hemas clinical owner.
- Protocols are versioned and approved.
- Changes are reviewed before activation.
- AI cannot invent a clinical instruction.
- The official record receives required outcomes through an approved adapter.

---

## 21. Privacy, PDPA and data governance

This section is product and compliance planning, not legal advice.

### 21.1 Roles

- Hemas is expected to be the controller for patient-care and hospital-service processing.
- SafeNet acts as processor where it follows Hemas's documented instructions.
- Any independent SafeNet reuse for training, benchmarking, marketing or product analytics requires a separate role and legal-basis assessment.
- Meta, cloud, AI, support, email and analytics providers require purpose-by-purpose subprocessor and cross-border review.

### 21.2 Demo data

- Synthetic records only.
- No real Hemas contact list.
- No real patient messages, reports, symptoms or identifiers.
- No production analytics identifiers.
- Imports disabled or restricted to synthetic fixtures.

### 21.3 Consent

Where consent is used, it must be:

- Freely given.
- Specific.
- Informed.
- Unambiguous.
- Demonstrable.
- Separated from unrelated terms.
- Withdrawable.

Marketing consent is not inferred from previous treatment or laboratory use.

### 21.4 Transparency

Before collecting sensitive WhatsApp content, present a short trilingual layered notice linking to the full notice. It should identify:

- Controller and contact.
- Data-protection contact.
- Purpose and legal basis.
- Data categories.
- Recipients and providers.
- Overseas processing.
- Retention.
- Rights and complaint path.
- Mandatory versus optional information.
- Relevant automated decision logic.

### 21.5 Retention

Hemas shall approve separate retention for:

- Message bodies and media.
- Appointment workflow data.
- Laboratory-notification evidence.
- Consent and suppression records.
- Campaign records.
- Audit and security logs.
- AI-run evidence.
- Backups.
- Clinical records.

The product shall not impose one universal retention period.

### 21.6 Rights-ready design

Support:

- Access and export.
- Correction.
- Consent withdrawal.
- Marketing objection.
- Erasure where applicable.
- Identity verification.
- Guardian or authorized requests.
- Human review of qualifying automated decisions.
- Deletion propagation to platform stores and approved vendors.

The workflow shall track the amended one-month response target and any permitted extension notice, while Hemas legal confirms which rights and deadlines are operative at launch.

### 21.7 DPIA and production gate

A data-protection impact assessment is mandatory before any real-patient pilot. It must be refreshed for:

- New AI models.
- Report or media upload.
- New providers or countries.
- New clinical pathways.
- Sensitive segmentation.
- New data routes.

### 21.8 Cross-border processing

Inventory every region and country used by:

- Meta and WhatsApp.
- Google Cloud or other cloud services.
- AI providers.
- Support and observability.
- Analytics.
- Backups.

Complete the required transfer assessment and binding instrument before production.

### 21.9 Current Sri Lankan PDPA status

As verified on 7 August 2026:

- Gazette No. 2498/16 appoints 1 January 2027 for Sections 2 and 3, Part I and Part III.
- Other provisions require confirmation of commencement.
- Several DPA implementation instruments remain drafts.

Build to the expected standard now and recheck legislation, final rules and health-sector guidance before live processing. Do not market the platform as certified.

---

## 22. Security requirements

**SEC-001** All network traffic uses current TLS.

**SEC-002** Meta webhook signatures are verified against the raw request body.

**SEC-003** Webhook verification tokens, app secrets, access tokens and phone-registration PINs are stored in Secret Manager.

**SEC-004** Per-client customer tokens are isolated; no global client token is used across tenants.

**SEC-005** Workload Identity replaces static service-account files where possible.

**SEC-006** Privileged actions require least privilege and recent authentication.

**SEC-007** Logs redact tokens, full phone numbers, payment data and sensitive message content.

**SEC-008** Media is scanned before processing.

**SEC-009** Stored identifiers and sensitive fields use approved encryption.

**SEC-010** Audit events are append-only and protected from ordinary client writes.

**SEC-011** Rate limiting protects public endpoints and authenticated actions.

**SEC-012** CSRF, replay and signed-token controls protect onboarding and Flow endpoints.

**SEC-013** Dependency, secret, static-analysis and infrastructure scans run in CI.

**SEC-014** Backups, restore procedures, retention and deletion are tested.

**SEC-015** Security incident runbooks define Hemas and SafeNet escalation.

**SEC-016** Production support access is time-bound, approved and audited.

---

## 23. Non-functional requirements

Proposed targets require Hemas approval.

### 23.1 Availability

- Production API and inbox target: 99.9 percent monthly availability excluding documented provider outages.
- Webhook acknowledgement remains available independently from AI.
- Provider or AI failure shall not make the human inbox unavailable.

### 23.2 Performance

- Mobile dashboard p75 largest-contentful-paint target under 2.5 seconds on representative networks.
- New accepted inbound message visible to agents p95 under five seconds.
- Flow data endpoint p95 under two seconds.
- Search and list interactions use pagination or cursor loading.

### 23.3 Scalability

- At least 50,000 synthetic contacts in a campaign audience.
- No unbounded Firestore documents or client arrays.
- Horizontal worker scaling.
- Configurable queue dispatch rates.
- Backpressure when downstream systems degrade.

### 23.4 Resilience

- At-least-once event delivery with application idempotency.
- Exponential backoff with jitter.
- Dead-letter handling.
- Transaction reconciliation.
- Circuit breakers around Hemas integrations.
- Manual operational recovery tools.

### 23.5 Observability

- Structured redacted logs.
- Request and trace identifiers.
- Queue depth and oldest-job age.
- Webhook error and signature-failure alerts.
- Provider error distribution.
- WABA quality and limit alerts.
- Integration health.
- AI failure and handoff rates.
- Cost and quota alerts.

### 23.6 Accessibility and responsive design

- WCAG 2.2 AA target.
- Keyboard navigation.
- Visible focus.
- Semantic labels.
- Adequate contrast.
- No horizontal overflow at phone widths.
- Touch targets suitable for mobile.
- Sinhala and Tamil rendering tested on common devices.

---

## 24. Demo requirements

The SafeNet demo must prove product behavior without real Hemas data.

### 24.1 Seeded synthetic scenarios

- English appointment enquiry.
- Sinhala laboratory enquiry.
- Tamil package enquiry.
- Mixed-language low-confidence handoff.
- Urgent-language escalation.
- Human takeover.
- STOP and marketing suppression.
- Appointment booking, reminder, reschedule and cancellation.
- Laboratory report-ready secure-link simulation.
- Post-discharge synthetic red flag.
- 50,000-contact synthetic campaign.
- Connection failure and template rejection.
- Empty, loading, permission-denied and provider-unavailable states.

### 24.2 Demo protections

- Persistent SafeNet Demo banner.
- No Hemas logo or affiliation claim without permission.
- Synthetic names and external references.
- No unrestricted CSV import.
- External sends disabled by default.
- Allowlist required for any SafeNet canary.
- Sample analytics label.
- Locked Hemas onboarding state.

### 24.3 Demo script

1. Switch between SafeNet Demo and locked Hemas tenant.
2. Receive a synthetic Tamil appointment message.
3. Show language detection and appointment Flow.
4. Complete mock slot booking.
5. Show confirmation and reminders.
6. Open an urgent synthetic conversation.
7. Demonstrate safe escalation and agent takeover.
8. Show consent history and STOP.
9. Build a 50,000-contact synthetic campaign.
10. Review exclusions, approve, simulate dispatch and pause.
11. Show sample analytics and audit trail.
12. Show connection centre and Hemas production gates.

---

## 25. Quality assurance and acceptance strategy

### 25.1 Automated testing

- Type checking.
- Linting.
- Unit tests.
- API contract tests.
- Firebase Security Rules emulator tests.
- Webhook signature and fixture tests.
- Idempotency tests.
- Queue retry and dead-letter tests.
- Flow encryption and token tests.
- Accessibility checks.
- Render and route tests.
- Dependency and secret scanning.

### 25.2 Required journey tests

1. Workspace creation writes real isolated data.
2. Tenant A cannot access Tenant B.
3. Revoked user cannot continue reading data.
4. Public webhook GET verification succeeds.
5. Invalid POST signature fails.
6. Valid inbound message creates contact, conversation and message.
7. Duplicate inbound message creates no duplicate state.
8. AI reply passes reviewer.
9. Reviewer failure retries once then hands off.
10. Human takeover stops AI.
11. Outside-window composer requires template.
12. STOP suppresses marketing.
13. Flow booking creates one appointment.
14. Slot conflict returns alternatives.
15. Reschedule changes reminders.
16. Cancellation removes reminders.
17. Lab-ready event sends only secure notification.
18. Duplicate lab event does not resend.
19. Campaign audience excludes ineligible contacts.
20. Campaign change invalidates approval.
21. Pause and resume create no duplicate sends.
22. 50,000 synthetic recipients reconcile correctly.
23. Status callbacks update delivery state.
24. Mobile and desktop layouts pass.
25. Sensitive values are absent from logs and browser bundles.

### 25.3 Real acceptance surfaces

The product is not production-complete until verified through:

- Actual Firestore writes and rules.
- Public Meta webhook verification.
- Signed Meta webhook POST.
- Fresh inbound WhatsApp message.
- Outbound free-form reply inside the service window.
- Approved template send outside the service window.
- Delivery and read status callback.
- STOP.
- Human takeover.
- Agent reply.
- Real appointment UAT integration.
- Real lab-ready UAT event.
- Hemas security, privacy and clinical approval.

---

## 26. Rollout and migration plan

### Phase 0: Discovery and governance

**Deliverables**

- Stakeholder map.
- Hemas system inventory.
- SafeNet Meta re-audit.
- Consent and data-flow discovery.
- Baseline KPI plan.
- Architecture decisions.
- Initial DPIA inputs.

**Exit gate**

- Demo scope approved internally.
- Production unknowns documented.
- No production credentials or data required.

### Phase 1: Multi-tenant foundation

**Deliverables**

- Standard project foundation.
- Auth and roles.
- Workspace isolation.
- Audit and consent ledgers.
- Synthetic SafeNet tenant.
- Demo environment controls.

**Exit gate**

- Tenant-isolation tests pass.
- Synthetic-only safeguards pass.

### Phase 2: Inbox and AI simulator

**Deliverables**

- Trilingual inbox.
- Routing and assignment.
- Human takeover.
- Knowledge management.
- Orchestrator and reviewer.
- Urgent-language path.

**Exit gate**

- Core conversations pass in all three languages.
- Unsafe advice tests pass.

### Phase 3: WhatsApp Flows and healthcare workflows

**Deliverables**

- Appointment Flow.
- Reschedule and cancellation Flow.
- Laboratory and home-collection Flow.
- Package and feedback Flows.
- Mock appointment, LiveTrack and LIMS adapters.
- Secure report-link simulation.

**Exit gate**

- End-to-end synthetic journeys pass.
- Replay and conflict tests pass.

### Phase 4: Campaign engine

**Deliverables**

- Contact segmentation.
- Template library.
- Audience snapshots.
- Approval workflow.
- 50,000-recipient synthetic processing.
- Queue, pacing, pause, resume and reconciliation.

**Exit gate**

- Load and compliance preflight pass.
- No external bulk sending.

### Phase 5: Automation, care pathways and analytics

**Deliverables**

- Workflow engine.
- Clinician-governed pathway framework.
- Sample post-discharge scenario.
- Dashboards and usage ledger.
- Connection quality monitoring.

**Exit gate**

- Synthetic red-flag escalation passes.
- Sample metrics are correctly labelled.

### Phase 6: Full demo QA

**Deliverables**

- Desktop and phone QA.
- Accessibility.
- Failure-state tests.
- Security review.
- Demo script.
- SafeNet training.

**Exit gate**

- Demo acceptance checklist signed internally.

### Phase 7: SafeNet controlled canary

**Prerequisites**

- Current Meta assets reverified.
- App mode and webhook ready.
- Correct number and WABA selected.
- Production token stored.
- Templates approved.
- Payment and cost controls approved.
- Test allowlist.

**Exit gate**

- Fresh inbound, outbound, status, STOP, handoff and admin reply verified.
- No public or bulk rollout.

### Phase 8: Hemas production onboarding

**Deliverables**

- Hemas-owned tenant.
- Hemas-owned WABA and number.
- Fresh Hemas templates.
- UAT integrations.
- Data-processing agreement.
- DPIA, retention, incident and transfer approvals.
- Staff roles and training.

**Exit gate**

- Hemas UAT and governance approvals.

### Phase 9: Utility-first production pilot

**Initial use cases**

- Appointment confirmations and reminders.
- Rescheduling and cancellation.
- Laboratory report-ready notifications.
- Shared inbox and human support.

**Exit gate**

- Stable delivery and quality.
- Measured patient and operational results.
- Controlled support process.

### Phase 10: Marketing and capacity ramp

**Prerequisites**

- Verified consent provenance.
- Approved marketing templates.
- Healthy quality.
- Verified portfolio limit.
- Frequency and complaint thresholds.
- Executive campaign approval.

**Exit gate**

- Scale increases only through measured, healthy cohorts.
- A 50,000 campaign is authorized only when the portfolio has at least the required current capacity.

---

## 27. Indicative delivery schedule

Durations are planning ranges, not contractual commitments.

| Phase | Indicative effort |
|---|---:|
| Discovery and governance | 3 to 5 working days |
| Multi-tenant foundation | 1 to 2 weeks |
| Inbox and AI simulator | 1 to 2 weeks |
| Flows and healthcare workflows | 1 to 2 weeks |
| Campaign engine | 2 weeks |
| Automations and analytics | 1 to 2 weeks |
| Full demo QA | 1 week |
| SafeNet controlled canary | 3 to 5 working days after prerequisites |
| Hemas UAT integrations | 3 to 6 weeks depending on APIs and approvals |
| Production ramp | Variable and quality-dependent |

A presentation prototype can be delivered earlier. A production-shaped functional demo is expected to require approximately six to eight weeks.

---

## 28. Dependencies required from Hemas

These do not block synthetic demo work but block production.

- Product owner.
- Operations owners for appointment, laboratory and patient support.
- Information-technology integration owner.
- Security owner.
- Data-protection officer or privacy owner.
- Legal counsel.
- Clinical-governance owners.
- Marketing and campaign approver.
- Meta Business Portfolio and payment owner.
- API documentation and UAT access for appointment, LiveTrack, LIMS, HIS, EHR and CRM.
- Patient identity and matching rules.
- Approved service, doctor, package and preparation data.
- Approved Sinhala, Tamil and English copy.
- Consent provenance and suppression policy.
- Retention schedule.
- Incident-response contacts.
- Clinical protocols for any post-discharge pathway.
- Approved UAT recipients.
- Support SLA and after-hours policy.

---

## 29. Proposed ownership and RACI

| Workstream | Hemas accountable | SafeNet responsible | Joint approval |
|---|---|---|---|
| Product priorities | Hemas product and operations | Product delivery | Yes |
| Meta production assets | Hemas asset owner | Technical integration | Yes |
| Patient data and lawful purpose | Hemas DPO and legal | Processor controls | Yes |
| Clinical pathways | Hemas clinical governance | Workflow implementation | Yes |
| Platform architecture | Hemas IT/security review | Architecture and engineering | Yes |
| Templates and translations | Hemas communications/operations | Drafting and implementation | Yes |
| Campaign approval | Hemas marketing/compliance | Platform workflow | Hemas final |
| Security operations | Hemas security | SafeNet security and engineering | Yes |
| UAT | Hemas owners | Test support and fixes | Yes |
| Production support | Hemas service owner | SafeNet support | SLA approval |

---

## 30. Risk register

| Risk | Impact | Mitigation | Release gate |
|---|---|---|---|
| SafeNet is not eligible for Embedded Signup | Client onboarding path changes | Use Hemas-owned direct or approved partner onboarding | Confirm before implementation |
| SafeNet Meta state is assumed current | Failed canary or incorrect claims | Re-audit WABA, number, callback, app mode, token, templates and payment | Before canary |
| Hemas APIs are unavailable | Demo works but production cannot sync | Use adapters and secure deep links; define human fallback | Before Hemas UAT |
| Marketing consent provenance is weak | Legal and quality risk | Do not import or send until evidence is mapped | Before marketing pilot |
| Real 50,000 capacity is unavailable | Campaign blocked or quality damaged | Utility-first ramp; live limit preflight; phased cohorts | Before large campaign |
| Template category or approval changes | Send failures | Synchronize current provider state; fallback and resubmission | Before each campaign |
| AI gives plausible unsafe advice | Patient harm | Narrow scope, approved RAG, strict reviewer, human escalation | Before AI send |
| Sensitive report content enters chat or logs | Privacy breach | Secure links, redaction, no raw reports in MVP | Before lab pilot |
| Post-discharge automation misses red flag | Patient harm | Clinician protocols, deterministic escalation, SLA monitoring | Before pathway activation |
| Cross-tenant authorization flaw | Severe data breach | Deny-by-default rules, emulator tests, security review | Before any external user |
| Duplicate webhook or retry | Duplicate booking or message | Provider-ID idempotency and transaction locks | Before canary |
| Provider or Hemas outage | Unresolved patient requests | Queues, circuit breakers, pending state and human work item | Before pilot |
| Sinhala or Tamil quality is poor | Misdirection and poor trust | Approved translations, human correction and language QA | Before pilot |
| Ad targeting reveals health inference | Policy and privacy violation | Neutral creative and minimized attribution | Before CTWA |
| Payment is assumed complete from redirect | Incorrect booking | Signed gateway callback and reconciliation | Before payment |
| Draft rules or legal dates change | Compliance gap | Recheck official guidance and counsel approval | Before production |

---

## 31. Definition of done

### 31.1 SafeNet functional demo

Done means:

- Product UI replaces the starter.
- Synthetic tenant and data are persistent.
- Core pages and states work.
- Three-language journeys work.
- Human takeover works.
- Appointment and laboratory mock journeys work.
- 50,000 synthetic campaign processing works.
- Compliance and audit views work.
- No real patient data or external bulk send exists.
- Mobile, accessibility, tests and build pass.

### 31.2 SafeNet controlled canary

Done means:

- Actual SafeNet Meta assets are reverified.
- Webhook GET and signed POST work.
- Fresh inbound message is stored.
- Free-form reply works inside the window.
- Approved template works outside the window.
- Delivery status is recorded.
- STOP works.
- Human takeover and agent reply work.
- All sends are to the allowlist.

### 31.3 Hemas production pilot

Done means:

- Hemas owns the tenant, WABA and number.
- Fresh Hemas templates are approved.
- Appointment and laboratory UAT integrations pass.
- Tenant isolation and privileged access pass.
- DPIA, processor terms, retention, incident and transfer decisions are approved.
- Hemas staff are trained.
- Utility-first live patient journeys pass.
- Monitoring and support are active.

### 31.4 Scaled campaigns

Done means:

- Consent provenance is verified.
- Suppression and preference centre are active.
- Marketing templates are approved.
- Quality is healthy.
- Current portfolio limit supports the cohort.
- Campaign preflight and approver evidence exist.
- Test send passes.
- Automatic pause and reconciliation are verified.

---

## 32. Open decisions

1. Does SafeNet currently qualify as a Meta Tech Provider, Tech Partner or Solution Partner?
2. Which Meta app and WABA will be used for the SafeNet canary?
3. Will Hemas use one number or operationally separate service and campaign numbers?
4. Which Hemas system owns appointments and exposes live slots?
5. What LiveTrack interface is available?
6. Which LIMS event can trigger report-ready notifications?
7. What secure portal-link or token service is available?
8. How will patient identity be verified in WhatsApp journeys?
9. What consent evidence exists for the current patient and laboratory base?
10. Which campaign categories will Hemas permit?
11. Which payment gateway and callback contract are approved?
12. Which post-discharge pathways will be first, and who clinically owns them?
13. What message and media retention does Hemas approve?
14. Which cloud regions and AI providers pass Hemas review?
15. What support SLA and after-hours escalation apply?
16. Which KPIs have reliable current baselines?

No unresolved decision above blocks the synthetic SafeNet demo unless it changes the intended presentation scope.

---

## 33. Implementation work packages

### Work package 1: Architecture and foundation

Build:

- Stable Next.js and TypeScript application foundation.
- Firebase projects and emulator configuration.
- Workspace model.
- Authentication and role enforcement.
- Audit and consent ledgers.
- Synthetic fixtures.

Verify:

- Cross-tenant denial.
- Role enforcement.
- Environment labels.
- No secrets in browser or repository.

### Work package 2: WhatsApp and conversation backend

Build:

- Webhook verification.
- Raw-body signature validation.
- Event parser.
- Idempotency.
- Contact, conversation and message persistence.
- Service-window tracking.
- Sender and status handling.

Verify:

- Signed fixtures.
- Duplicate events.
- Invalid signature.
- Status reconciliation.

### Work package 3: AI and routing

Build:

- Typed shared state.
- Language and intent detection.
- Urgent safety rules.
- Knowledge retrieval.
- Content specialist.
- Strict reviewer.
- Human-handoff controller.

Verify:

- No diagnosis or medication changes.
- Unsupported-fact handling.
- Retry and escalation.

### Work package 4: Dashboard and inbox

Build:

- Workspace-aware application shell.
- Overview.
- Inbox and composer.
- Assignment and notes.
- Contacts and consent.
- Team routing.
- Connection centre.
- Loading, empty, error and success states.

Verify:

- Mobile and desktop.
- Keyboard and screen reader.
- Role-based actions.

### Work package 5: Flows and Hemas adapters

Build:

- Flow versioning.
- Secure Flow data endpoint.
- Appointment, reschedule, lab, package, feedback and preference Flows.
- Mock Hemas adapters.
- Secure-link simulation.

Verify:

- Token replay protection.
- Slot conflict.
- Idempotent completion.
- Unsupported-client fallback.

### Work package 6: Campaigns, automations and analytics

Build:

- Segmentation.
- Consent preflight.
- Template library.
- Audience snapshots.
- Approval.
- 50,000-recipient queuing.
- Pause, resume and reconciliation.
- Workflow engine.
- Metrics and usage ledger.

Verify:

- Suppression.
- Approval invalidation.
- Load test.
- Failure recovery.
- Sample-data labels.

### Work package 7: DevOps and release QA

Build:

- CI quality gates.
- Environment validation.
- Secret and dependency scanning.
- Health checks.
- Monitoring and alerts.
- Backup and recovery procedures.
- Release runbooks.

Verify:

- Complete acceptance suite.
- SafeNet canary prerequisites.
- No deployment or live-send claim without evidence.

---

## 34. Configuration and secret contract

### 34.1 Non-secret configuration

| Name | Purpose |
|---|---|
| APP_ENV | local, demo, canary, uat or production |
| APP_BASE_URL | Approved application origin |
| GOOGLE_CLOUD_PROJECT | Active environment project |
| FIRESTORE_DATABASE | Explicit database name |
| DEFAULT_TIMEZONE | Asia/Colombo |
| SUPPORTED_LANGUAGES | si, ta and en |
| WHATSAPP_GRAPH_API_VERSION | Explicit currently approved Graph API version |
| META_APP_ID | Meta application identifier |
| META_EMBEDDED_SIGNUP_CONFIG_ID | Approved Business Login configuration |
| WHATSAPP_WEBHOOK_PATH | Public callback path |
| VERTEX_AI_MODEL_ID | Approved model resource |
| ACTIVE_PROMPT_VERSION | Approved orchestrator prompt version |
| INTERACTIVE_QUEUE | Patient reply queue |
| UTILITY_QUEUE | Appointment and laboratory notification queue |
| MARKETING_QUEUE | Approved campaign queue |
| RECONCILIATION_QUEUE | Uncertain and delayed provider state |
| HEMAS_INTEGRATION_QUEUE | HIS, LiveTrack and LIMS work |
| FEATURE_FLAGS | Environment-controlled capability gates |

Firebase browser configuration identifiers are not treated as secrets, but they remain environment-specific and must use authorized origins, App Check and server-enforced authorization.

### 34.2 Secret Manager inventory

| Secret | Scope |
|---|---|
| META_APP_SECRET | Per Meta production application |
| WHATSAPP_WEBHOOK_VERIFY_TOKEN | Per environment or approved connection policy |
| WHATSAPP_ACCESS_TOKEN_{connectionId} | Per customer connection |
| WHATSAPP_FLOW_PRIVATE_KEY_{phoneNumberId} | Per environment and production phone |
| WHATSAPP_FLOW_KEY_PASSPHRASE_{phoneNumberId} | Per protected Flow key |
| CONTACT_LOOKUP_HMAC_KEY | Per environment |
| PII_ENCRYPTION_KEY_REFERENCE | Approved KMS or wrapped-key resource |
| HEMAS_APPOINTMENT_CLIENT_SECRET | Hemas UAT or production adapter |
| HEMAS_LIVETRACK_CLIENT_SECRET | Hemas UAT or production adapter |
| HEMAS_LIMS_CLIENT_SECRET | Hemas UAT or production adapter |
| PAYMENT_WEBHOOK_SECRET | Approved payment provider |
| INTEGRATION_SIGNING_KEY | Named inbound or outbound integration |

The phone-registration two-step PIN shall be supplied through a secure just-in-time path and not retained unless Hemas approves a managed recovery process.

### 34.3 Secret rules

- Never commit a production secret or service-account file.
- Never store customer access tokens in Firestore.
- Never put secrets in browser storage, URLs, analytics, support tickets or ordinary logs.
- Use Workload Identity for Google Cloud and Vertex AI rather than API-key files.
- Grant secret access per service and environment.
- Record access and rotation.
- Validate an old-to-new overlap and rollback process before rotation.
- Keep demo, UAT and production credentials completely separate.

## 35. Sequential implementation prompts

These work packets may be used sequentially with a coding agent after the PRD architecture decision is approved. Each prompt assumes the preceding acceptance gates passed.

### Prompt 1: Re-baseline and architecture

Act as a senior software architect. Re-baseline the current placeholder into a supported standard Next.js, React, TypeScript and Tailwind application using Firebase Authentication, Firestore, Cloud Storage and GCP backend services. Remove unused Vinext, Cloudflare Worker and D1 paths only after confirming they contain no user product work. Establish local, SafeNet demo, Hemas UAT and Hemas production environment contracts. Create architecture decisions, configuration validation and an initial test harness. Do not connect production Meta or Hemas assets. Verify type checking, linting, tests and build.

### Prompt 2: Firebase multi-tenancy and governance

Act as a senior Firebase and security engineer. Implement the workspace, membership, team, location, contact, consent, conversation, message, template, Flow, campaign, automation, integration, audit and usage models defined in this PRD. Add deny-by-default Firestore and Storage Rules, server-only write paths and emulator tests covering every cross-tenant and role-escalation case. Add synthetic SafeNet demo fixtures only. Do not store tokens or real patient data.

### Prompt 3: Official WhatsApp Cloud API

Act as a Meta WhatsApp Cloud API specialist. Implement public GET verification, raw-body X-Hub-Signature-256 validation, batched event parsing, durable enqueue, provider-ID idempotency, out-of-order status handling, service-window state and server-side sending. Store per-connection tokens only through Secret Manager references. Add fixtures for inbound, statuses, STOP and provider failures. Do not enable external sending except through an explicit test allowlist.

### Prompt 4: Trilingual inbox and governed AI

Act as a healthcare conversational-AI and frontend engineer. Implement the SI, TA and EN inbox, queues, assignment, internal notes, human takeover, service-window-aware composer, approved knowledge centre and typed orchestrator state. Add deterministic urgent-language and STOP checks, retrieval, content drafting, strict reviewer output, one controlled correction attempt and human fallback. Prohibit diagnosis, prognosis, medication changes and autonomous report interpretation. Verify language, safety and takeover test suites.

### Prompt 5: WhatsApp Flows and Hemas adapters

Act as a WhatsApp Flows and integration engineer. Implement versioned appointment, reschedule, cancellation, laboratory, package, feedback and preference Flows. Build the current encrypted Flow data endpoint with tenant-bound signed sessions, replay protection and strict schemas. Implement mock AppointmentProvider, LiveTrackProvider, LaboratoryProvider, PatientIdentityProvider and PaymentProvider contracts. Confirm bookings only after authoritative adapter success and provide safe human fallbacks. Use synthetic data only.

### Prompt 6: Campaigns, automation and 50K processing

Act as a high-volume messaging-platform engineer. Implement consent-aware segmentation, immutable audience snapshots, template-language validation, independent approval, allowlisted tests, scheduling and separate interactive, utility, marketing and reconciliation queues. Process 50,000 synthetic recipients with deterministic recipient identities, final suppression checks, bounded Cloud Tasks, rate controls, pause, resume, cancellation, send-uncertain reconciliation and automatic safety pauses. Make external bulk sending impossible in demo.

### Prompt 7: Analytics, DevOps and final QA

Act as a DevOps, privacy and QA engineer. Implement aggregate analytics, usage ledger, redacted observability, integration health, quality alerts, retention jobs, data-subject workflows, backups and runbooks. Add CI typecheck, lint, unit, emulator, contract, accessibility, load, resilience, secret and dependency gates. Verify every Definition of Done item on the real applicable surface. Report demo, canary, UAT and production states separately, and do not deploy or message externally without the relevant approval.

## 36. Reference sources

### Hemas

- Hemas Health App and services: https://hemashospitals.com/ayubolife/
- Hemas App download and feature information: https://labs.hemashospitals.com/app-download/
- Hemas International Patients: https://hemashospitals.com/international-patients/
- Hemas privacy, data-protection and service terms: https://hemashospitals.com/disclaimer/
- Hemas Patient Data Protection Notice: https://hemashospitals.com/wp-content/uploads/2025/01/Data-Protection-Notice.pdf
- Hemas Laboratory Services: https://labs.hemashospitals.com/

### Meta and WhatsApp

- WhatsApp Business Messaging Policy: https://business.whatsapp.com/policy
- WhatsApp Flows: https://developers.facebook.com/docs/whatsapp/flows
- WhatsApp Flows product overview: https://whatsappbusiness.com/products/whatsapp-flows/
- Service messages: https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages/
- Message templates: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview/
- Messaging limits: https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits/
- Throughput: https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput/
- Embedded Signup versions: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/versions/
- Embedded Signup v4: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4/
- Tech Provider onboarding: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider/
- Phone registration: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/registration/
- Ads that click to WhatsApp: https://whatsappbusiness.com/products/ads-that-click-to-whatsapp/

### Sri Lankan data protection

- Personal Data Protection Act No. 9 of 2022: https://dpa.gov.lk/acts/Data%20Protection%20Act%20SL%20-%20English%20%282%29.pdf
- Personal Data Protection Amendment Act No. 22 of 2025: https://documents.gov.lk/view/act/2025/10/22-2025_E.pdf
- Gazette No. 2498/16: https://documents.gov.lk/view/egz/2026/7/2498-16_E.pdf
- Data Protection Authority guidance and drafts: https://www.dpa.gov.lk/guidelines.php

### Benchmarks and clinical-AI guidance

- Apollo 24|7 and Infobip: https://www.infobip.com/customer/apollo-247
- Apollo WhatsApp Flows engineering story: https://www.infobip.com/engineering/how-to-build-whatsapp-flows-in-minutes-not-days
- Apollo JBP and Gallabox: https://gallabox.com/customer-stories/apollo-jbp-hospitals
- Manipal MAI: https://www.manipalhospitals.com/mai/
- Manipal MAI disclaimer: https://www.manipalhospitals.com/mai/disclaimer/
- Cleveland Clinic and Twilio: https://customers.twilio.com/en-us/cleveland-clinic
- WHO guidance for large multimodal health models: https://www.who.int/publications/i/item/9789240084759

---

## 37. Approval record

| Approval | Name | Decision | Date |
|---|---|---|---|
| SafeNet product | Pending | Pending | Pending |
| SafeNet engineering | Pending | Pending | Pending |
| SafeNet security/privacy | Pending | Pending | Pending |
| Hemas product/operations | Pending | Pending | Pending |
| Hemas IT/security | Pending | Pending | Pending |
| Hemas DPO/legal | Pending | Pending | Pending |
| Hemas clinical governance | Pending | Pending | Pending |
| Hemas marketing/campaign owner | Pending | Pending | Pending |

This PRD becomes approved for Hemas production implementation only when the relevant Hemas owners complete the approval record or provide an equivalent documented approval.
