export type ControlStatus = "implemented_demo" | "partial" | "owner_pending" | "blocked";

export type ComplianceControl = {
  id: string;
  category: "Privacy" | "Security" | "Clinical" | "Consent" | "Operations";
  name: string;
  owner: string;
  status: ControlStatus;
  summary: string;
  evidence: string[];
  releaseGate: string;
};

export const complianceControls: ComplianceControl[] = [
  {
    id: "synthetic-data",
    category: "Privacy",
    name: "Synthetic-only demo data",
    owner: "SafeNet engineering",
    status: "implemented_demo",
    summary: "The local demo uses seeded synthetic records and opaque identifiers. Real-patient-data mode is false and imports are unavailable.",
    evidence: ["Visible environment banner", "Fresh synthetic emulator seed", "Disabled import/export actions", "Fail-closed public environment flags"],
    releaseGate: "Run a repository, logs, screenshots, and emulator-state scan before every demo handoff.",
  },
  {
    id: "tenant-isolation",
    category: "Security",
    name: "Tenant and patient-scope isolation",
    owner: "SafeNet engineering / Hemas security",
    status: "partial",
    summary: "Prototype Rules enforce tenant membership and fail-closed team/location scope with bounded list queries. Admin SDK services remain outside this enforcement boundary.",
    evidence: ["Rules emulator hostile coverage", "Typed scoped repositories", "Default-deny Firestore paths", "Direct client Storage deny"],
    releaseGate: "Centralize backend authorization and repeat hostile tests against the connected UAT project.",
  },
  {
    id: "consent-ledger",
    category: "Consent",
    name: "Purpose-specific consent and suppression",
    owner: "Hemas privacy / communications",
    status: "partial",
    summary: "The domain model separates purpose, category, language, source, notice version, consent state, and suppression. Source-backed synthetic STOP handling is demonstrated in the Contacts workspace.",
    evidence: ["Consent domain model", "Deterministic 50K preflight", "Source-backed STOP demonstration", "Server-only authoritative ledger Rules"],
    releaseGate: "Hemas must approve notices, legal bases, historic-consent migration, and withdrawal handling across every source.",
  },
  {
    id: "data-minimization",
    category: "Privacy",
    name: "Clinical-content minimization",
    owner: "Hemas DPO / clinical governance",
    status: "implemented_demo",
    summary: "Lab journeys expose readiness metadata only. Ordinary chat does not accept report values, diagnosis, raw reports, card data, OTPs, or unrestricted EHR records.",
    evidence: ["Report-ready metadata contract", "Secure-link simulation", "AI report-interpretation safety test", "No raw media workflow"],
    releaseGate: "Complete field-level classification and authorized portal integration before real data.",
  },
  {
    id: "ai-safety",
    category: "Clinical",
    name: "AI and urgent-language boundaries",
    owner: "Hemas clinical governance / SafeNet engineering",
    status: "partial",
    summary: "Deterministic tests fail closed for urgency, medication changes, report interpretation, unsupported claims, STOP, and low language confidence. No model provider is connected.",
    evidence: ["Typed local reviewer output", "Urgent safety hold", "Human handoff requirement", "Diagnosis capability permanently false"],
    releaseGate: "Approve emergency language, prompt/source versions, eval suite, model terms, and human escalation operations.",
  },
  {
    id: "care-path",
    category: "Clinical",
    name: "Clinician-governed care pathways",
    owner: "Named Hemas clinical owner",
    status: "owner_pending",
    summary: "The framework requires an approved protocol version and suppresses routine steps on red flags or lifecycle changes. No real protocol has been approved.",
    evidence: ["Versioned domain types", "AI instruction generation fixed false", "Synthetic red-flag simulation"],
    releaseGate: "Name the clinical owner, approve exact content and schedule, and define SLA/after-hours/write-back behavior.",
  },
  {
    id: "retention",
    category: "Privacy",
    name: "Retention and deletion schedule",
    owner: "Hemas DPO / records management",
    status: "owner_pending",
    summary: "The PRD requires separate schedules for messages, media, workflows, consent, campaigns, audit, AI evidence, backups, and clinical records. No universal duration is assumed.",
    evidence: ["Data-class inventory in PRD", "Server-only protected content approach"],
    releaseGate: "Approve purpose-specific schedules and prove deletion propagation and backup handling.",
  },
  {
    id: "cross-border",
    category: "Privacy",
    name: "Subprocessor and cross-border assessment",
    owner: "Hemas legal / DPO / procurement",
    status: "owner_pending",
    summary: "Meta, Google Cloud, AI, support, observability, analytics, and backup locations must be assessed purpose by purpose. No production provider is approved by this demo.",
    evidence: ["Provider inventory requirement", "No connected external processor in demo"],
    releaseGate: "Complete contracts, transfer assessment, region inventory, and approved provider terms before processing.",
  },
  {
    id: "durable-audit",
    category: "Security",
    name: "Restricted synthetic audit evidence",
    owner: "SafeNet engineering / Hemas security",
    status: "partial",
    summary: "Synthetic audit records persist only in the local emulator. Raw browser listing is denied; an authorized callable returns a strictly minimized projection. No production sink, retention, completeness, or tamper-evidence claim is made.",
    evidence: ["Raw browser list denied", "Role-restricted projected timeline", "Strict response minimization", "Client audit writes denied"],
    releaseGate: "Implement durable storage, restricted readers, failure alerting, retention, and tamper-evidence before UAT readiness.",
  },
  {
    id: "rights",
    category: "Operations",
    name: "Data-subject and authorized-representative workflow",
    owner: "Hemas privacy operations",
    status: "blocked",
    summary: "No live request-management workflow exists for access, correction, withdrawal, objection, erasure, identity verification, guardian authority, or vendor propagation.",
    evidence: ["Rights-ready requirements documented in PRD"],
    releaseGate: "Implement the verified operational workflow and rehearse it before real-patient UAT.",
  },
  {
    id: "incident",
    category: "Operations",
    name: "Incident, rollback, and support access",
    owner: "Hemas security / SafeNet operations",
    status: "owner_pending",
    summary: "Production support access must be approved, time-bound, least-privilege, and audited. Joint incident ownership and rollback timings are unassigned.",
    evidence: ["Fail-closed live adapters", "Campaign pause/cancel simulation", "Release-gate inventory"],
    releaseGate: "Approve contacts, severity model, evidence handling, rollback owner, and post-incident process.",
  },
];
