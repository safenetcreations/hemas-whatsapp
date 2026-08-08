import assert from "node:assert/strict";
import test from "node:test";
import type {
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Query,
  QuerySnapshot,
  SetOptions,
  Transaction,
} from "firebase-admin/firestore";
import type { RuntimeConfig } from "../src/config.js";
import {
  canonicalTemplateContentSerialization,
  type TemplateContentBindingInput,
} from "../src/campaigns/contracts.js";
import {
  AUTOMATION_COLLECTIONS,
  AUTOMATION_GOLDEN_VECTORS,
  SYNTHETIC_PHASE5_PROJECT_ID,
  SYNTHETIC_PHASE5_WORKSPACE_ID,
  parseSyntheticAutomationControlInput,
  serializeAutomationDefinitionApproval,
  serializeAutomationDefinitionContent,
  serializeAutomationTriggerReceiptKey,
  sha256Hex,
  syntheticHmacSha256,
  type AuthoritativeAutomationStep,
  type AutomationRunAction,
  type SyntheticAutomationControlInput,
  type SyntheticAutomationControlResult,
} from "../src/automations/contracts.js";
import { controlSyntheticAutomationRun } from "../src/automations/service.js";
import { resolveSyntheticProtectedRef } from "../src/automations/runtime.js";
import {
  CARE_COLLECTIONS,
  CARE_GOLDEN_VECTORS,
  parseSyntheticCareControlInput,
  serializeCarePathwayApproval,
  serializeCarePathwayContent,
  serializeCareEnrollmentReceiptKey,
  type CareEnrollmentAction,
  type SyntheticCareControlInput,
  type SyntheticCareControlResult,
} from "../src/care/contracts.js";
import { controlSyntheticCareEnrollment } from "../src/care/service.js";

type MemoryRecord = Readonly<Record<string, unknown>>;

type CanonicalTemplateFixture = TemplateContentBindingInput & {
  readonly contentHash: string;
};

function canonicalTemplateFixture(
  input: TemplateContentBindingInput,
): CanonicalTemplateFixture {
  return {
    ...input,
    contentHash: sha256Hex(canonicalTemplateContentSerialization(input)),
  };
}

type MemoryQuery = {
  readonly __memoryQuery: true;
  readonly path: string;
  readonly filters: readonly {
    readonly field: string;
    readonly operator: "==";
    readonly value: unknown;
  }[];
  readonly ordering: readonly {
    readonly field: string;
    readonly direction: "asc" | "desc";
  }[];
  readonly maximum: number | null;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function assertDocumentPath(path: string): void {
  const segments = path.split("/");
  if (
    segments.length < 2 ||
    segments.length % 2 !== 0 ||
    segments.some((segment) => segment.length === 0)
  ) {
    throw new Error(`invalid document path: ${path}`);
  }
}

function assertCollectionPath(path: string): void {
  const segments = path.split("/");
  if (
    segments.length < 1 ||
    segments.length % 2 !== 1 ||
    segments.some((segment) => segment.length === 0)
  ) {
    throw new Error(`invalid collection path: ${path}`);
  }
}

function comparable(value: unknown): string | number {
  if (value instanceof Date) return value.getTime();
  if (
    value !== null &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof value.toDate === "function"
  ) {
    const date = value.toDate();
    if (date instanceof Date) return date.getTime();
  }
  if (typeof value === "number" || typeof value === "string") return value;
  return JSON.stringify(value);
}

function equalQueryValue(left: unknown, right: unknown): boolean {
  return comparable(left) === comparable(right);
}

function memoryQuery(
  path: string,
  filters: MemoryQuery["filters"] = [],
  ordering: MemoryQuery["ordering"] = [],
  maximum: number | null = null,
): Query {
  assertCollectionPath(path);
  const descriptor: MemoryQuery = {
    __memoryQuery: true,
    path,
    filters,
    ordering,
    maximum,
  };
  return {
    ...descriptor,
    where: (field: string, operator: string, value: unknown) => {
      if (operator !== "==" || !field) {
        throw new Error(`unsupported memory query filter: ${field} ${operator}`);
      }
      return memoryQuery(
        path,
        [...filters, { field, operator: "==", value }],
        ordering,
        maximum,
      );
    },
    orderBy: (field: string, direction: "asc" | "desc" = "asc") => {
      if (!field || (direction !== "asc" && direction !== "desc")) {
        throw new Error(`unsupported memory query ordering: ${field} ${direction}`);
      }
      return memoryQuery(
        path,
        filters,
        [...ordering, { field, direction }],
        maximum,
      );
    },
    limit: (value: number) => {
      if (!Number.isInteger(value) || value < 1 || value > 100) {
        throw new Error(`unsupported memory query limit: ${value}`);
      }
      return memoryQuery(path, filters, ordering, value);
    },
  } as unknown as Query;
}

function isMemoryQuery(value: unknown): value is Query & MemoryQuery {
  return value !== null &&
    typeof value === "object" &&
    "__memoryQuery" in value &&
    value.__memoryQuery === true;
}

/**
 * Minimal Admin SDK transaction double with atomic commit, create-only
 * semantics and rollback on every thrown error. Its only collection surface
 * is the explicit Map-backed query builder above; it exposes no provider
 * adapter, HTTP client or network surface.
 */
class MemoryAdminTransactionStore {
  readonly records = new Map<string, MemoryRecord>();
  readonly executedQueries: MemoryQuery[] = [];
  readonly committedWrites: Array<{
    readonly operation: "create" | "update" | "set" | "delete";
    readonly path: string;
  }> = [];
  readonly db: Firestore;
  transactionCount = 0;

  constructor() {
    this.db = {
      doc: (path: string) => {
        assertDocumentPath(path);
        return {
          path,
          id: path.split("/").at(-1) ?? "",
        } as DocumentReference;
      },
      collection: (path: string) => memoryQuery(path),
      runTransaction: async <T>(handler: (transaction: Transaction) => Promise<T>) => {
        this.transactionCount += 1;
        const staged = new Map<string, MemoryRecord>(
          [...this.records].map(([path, value]) => [path, clone(value)]),
        );
        const writes: Array<{
          readonly operation: "create" | "update" | "set" | "delete";
          readonly path: string;
        }> = [];
        let writePhaseStarted = false;
        const transaction = {
          get: async (reference: DocumentReference | Query) => {
            if (writePhaseStarted) {
              throw new Error("memory transaction cannot read after its first write");
            }
            if (isMemoryQuery(reference)) {
              this.executedQueries.push({
                __memoryQuery: true,
                path: reference.path,
                filters: clone(reference.filters),
                ordering: clone(reference.ordering),
                maximum: reference.maximum,
              });
              const prefix = `${reference.path}/`;
              let matches = [...staged]
                .filter(([path]) => {
                  if (!path.startsWith(prefix)) return false;
                  return !path.slice(prefix.length).includes("/");
                })
                .filter(([, value]) =>
                  reference.filters.every((filter) =>
                    equalQueryValue(value[filter.field], filter.value),
                  ),
                );
              for (const order of [...reference.ordering].reverse()) {
                matches = matches.sort(([, left], [, right]) => {
                  const a = comparable(left[order.field]);
                  const b = comparable(right[order.field]);
                  const comparison = a < b ? -1 : a > b ? 1 : 0;
                  return order.direction === "asc" ? comparison : -comparison;
                });
              }
              if (reference.maximum !== null) {
                matches = matches.slice(0, reference.maximum);
              }
              const docs = matches.map(([path, value]) => ({
                exists: true,
                data: () => clone(value),
                get: (field: string) => value[field],
                ref: { path, id: path.split("/").at(-1) ?? "" },
                id: path.split("/").at(-1) ?? "",
              } as unknown as DocumentSnapshot));
              return {
                docs,
                empty: docs.length === 0,
                size: docs.length,
                forEach: (callback: (snapshot: DocumentSnapshot) => void) => {
                  for (const snapshot of docs) callback(snapshot);
                },
              } as unknown as QuerySnapshot;
            }
            const documentReference = reference as DocumentReference;
            assertDocumentPath(documentReference.path);
            const value = staged.get(documentReference.path);
            return {
              exists: value !== undefined,
              data: () => value === undefined ? undefined : clone(value),
              get: (field: string) => value?.[field],
              ref: documentReference,
              id: documentReference.path.split("/").at(-1) ?? "",
            } as unknown as DocumentSnapshot;
          },
          create: (reference: DocumentReference, data: DocumentData) => {
            writePhaseStarted = true;
            assertDocumentPath(reference.path);
            if (staged.has(reference.path)) {
              throw new Error(`create conflict: ${reference.path}`);
            }
            staged.set(reference.path, clone(data));
            writes.push({ operation: "create", path: reference.path });
            return transaction;
          },
          update: (reference: DocumentReference, data: DocumentData) => {
            writePhaseStarted = true;
            assertDocumentPath(reference.path);
            const current = staged.get(reference.path);
            if (current === undefined) {
              throw new Error(`missing update target: ${reference.path}`);
            }
            staged.set(reference.path, { ...current, ...clone(data) });
            writes.push({ operation: "update", path: reference.path });
            return transaction;
          },
          set: (
            reference: DocumentReference,
            data: DocumentData,
            options?: SetOptions,
          ) => {
            writePhaseStarted = true;
            assertDocumentPath(reference.path);
            const current = staged.get(reference.path);
            const merge = options !== undefined && "merge" in options && options.merge === true;
            staged.set(
              reference.path,
              merge && current !== undefined ? { ...current, ...clone(data) } : clone(data),
            );
            writes.push({ operation: "set", path: reference.path });
            return transaction;
          },
          delete: (reference: DocumentReference) => {
            writePhaseStarted = true;
            assertDocumentPath(reference.path);
            staged.delete(reference.path);
            writes.push({ operation: "delete", path: reference.path });
            return transaction;
          },
        } as unknown as Transaction;

        const result = await handler(transaction);
        this.records.clear();
        for (const [path, value] of staged) this.records.set(path, clone(value));
        this.committedWrites.push(...writes);
        return result;
      },
    } as unknown as Firestore;
  }

  seed(path: string, value: MemoryRecord): this {
    assertDocumentPath(path);
    if (this.records.has(path)) throw new Error(`duplicate seed: ${path}`);
    this.records.set(path, clone(value));
    return this;
  }
}

const WORKSPACE_ID = SYNTHETIC_PHASE5_WORKSPACE_ID;
const PROJECT_ID = SYNTHETIC_PHASE5_PROJECT_ID;
const NOW = new Date("2026-08-07T12:00:00.000Z");
const CREATED_AT = new Date("2026-08-07T08:00:00.000Z");
const AUTOMATION_DEFINITION_ID = "automation_synthetic_appointment_v1";
const AUTOMATION_RUN_ID = "automation_run_synthetic_appointment_001";
const AUTOMATION_ACTIVATION_EVENT_ID =
  "automation_definition_event_synthetic_activate_001";
const AUTOMATION_ACTIVATION_AUDIT_ID =
  "audit_automation_definition_synthetic_activate_001";
const AUTOMATION_TEAM_ID = "team_demo_general";
const AUTOMATION_LOCATION_ID = "location_demo_wattala";
const AUTOMATION_ACTOR_UID = "user_demo_supervisor";
const AUTOMATION_CONTACT_ID = "contact_synthetic_appointment";
const AUTOMATION_CONVERSATION_ID = "conversation_synthetic_appointment";
const AUTOMATION_CONSENT_ID = "consent_synthetic_appointment";
const AUTOMATION_TEMPLATE_ID = "template_appointment_confirmation_en_v3";
const AUTOMATION_TEMPLATE = canonicalTemplateFixture({
  workspaceId: WORKSPACE_ID,
  id: AUTOMATION_TEMPLATE_ID,
  assetKey: "appointment_confirmation",
  providerName: "appointment_confirmation",
  category: "utility",
  language: "en",
  version: 3,
  components: [
    {
      kind: "header",
      format: "text",
      text: "Appointment request recorded",
    },
    {
      kind: "body",
      text: "Hello {{patient_ref}}. Synthetic appointment request {{appointment_ref}} for {{service}} at {{location}} is pending for {{date_time}}.",
    },
    {
      kind: "footer",
      text: "Synthetic demonstration — no Hemas appointment has been created.",
    },
  ],
  variableRules: [
    {
      key: "patient_ref",
      description: "Masked synthetic patient reference",
      required: true,
      maxLength: 24,
      exampleValue: "SYN-P000184",
      allowedPattern: "^SYN-P[0-9]{6}$",
    },
    {
      key: "appointment_ref",
      description: "Opaque synthetic appointment reference",
      required: true,
      maxLength: 24,
      exampleValue: "SYN-A1842",
      allowedPattern: "^SYN-A[0-9]{4}$",
    },
    {
      key: "service",
      description: "Approved neutral service label",
      required: true,
      maxLength: 60,
      exampleValue: "General medicine",
      allowedPattern: null,
    },
    {
      key: "location",
      description: "Approved facility label",
      required: true,
      maxLength: 40,
      exampleValue: "Wattala",
      allowedPattern: null,
    },
    {
      key: "date_time",
      description: "Asia/Colombo display time",
      required: true,
      maxLength: 48,
      exampleValue: "10 Aug 2026, 10:30",
      allowedPattern: null,
    },
  ],
});
const AUTOMATION_TEMPLATE_HASH = AUTOMATION_TEMPLATE.contentHash;
const AUTOMATION_SOURCE_FINGERPRINT = "9".repeat(64);
const AUTOMATION_IDEMPOTENCY_FINGERPRINT = syntheticHmacSha256(
  `hemas-connect:automation-seed-idempotency:${WORKSPACE_ID}:${AUTOMATION_RUN_ID}`,
);

const CARE_PATHWAY_ID = "care_pathway_synthetic_followup_v1";
const CARE_ENROLLMENT_ID = "care_enrollment_synthetic_001";
const CARE_ACTIVATION_EVENT_ID = "care_pathway_event_synthetic_activate_001";
const CARE_ACTIVATION_AUDIT_ID = "audit_care_pathway_synthetic_activate_001";
const CARE_TEAM_ID = "team_demo_clinical_escalation";
const CARE_LOCATION_ID = "location_demo_wattala";
const CARE_ACTOR_UID = "user_demo_clinical_approver";
const CARE_CONTACT_ID = "contact_synthetic_urgent";
const CARE_CONVERSATION_ID = "conversation_synthetic_phase5_care";
const URGENT_SAFETY_CONVERSATION_ID = "conversation_synthetic_urgent";
const CARE_CONSENT_ID = "consent_synthetic_care_pathway";
const CARE_DISCHARGE_FINGERPRINT = "a".repeat(64);
const CARE_DISCHARGE_AT = new Date("2026-08-06T09:00:00.000Z");
const CARE_DAY_ONE_AT = new Date("2026-08-07T09:00:00.000Z");
const CARE_DAY_THREE_AT = new Date("2026-08-09T09:00:00.000Z");

const CARE_DAY_ONE_EN_TEMPLATE = canonicalTemplateFixture({
  workspaceId: WORKSPACE_ID,
  id: "template_synthetic_care_day1_en_v1",
  assetKey: "synthetic_care_day1",
  providerName: "synthetic_care_day1",
  category: "utility",
  language: "en",
  version: 1,
  components: [
    {
      kind: "header",
      format: "text",
      text: "Synthetic follow-up · Day 1",
    },
    {
      kind: "body",
      text: "Your scheduled synthetic post-discharge check-in is ready. Use the approved demo response options; no clinical advice is generated here.",
    },
    {
      kind: "footer",
      text: "Synthetic demo only. For urgent help, use the approved emergency care route.",
    },
  ],
  variableRules: [],
});
const CARE_DAY_ONE_SI_TEMPLATE = canonicalTemplateFixture({
  workspaceId: WORKSPACE_ID,
  id: "template_synthetic_care_day1_si_v1",
  assetKey: "synthetic_care_day1",
  providerName: "synthetic_care_day1",
  category: "utility",
  language: "si",
  version: 1,
  components: [
    {
      kind: "header",
      format: "text",
      text: "කෘත්‍රිම පසු විමසුම · දින 1",
    },
    {
      kind: "body",
      text: "ඔබගේ නියමිත කෘත්‍රිම රෝහල් පිටවීමෙන් පසු පසු විමසීම සූදානම්. අනුමත ආදර්ශ ප්‍රතිචාර විකල්ප භාවිත කරන්න; මෙහි සායනික උපදෙස් ජනනය නොකෙරේ.",
    },
    {
      kind: "footer",
      text: "කෘත්‍රිම ආදර්ශයක් පමණි. හදිසි උදව් සඳහා අනුමත හදිසි සත්කාර මාර්ගය භාවිත කරන්න.",
    },
  ],
  variableRules: [],
});
const CARE_DAY_ONE_TA_TEMPLATE = canonicalTemplateFixture({
  workspaceId: WORKSPACE_ID,
  id: "template_synthetic_care_day1_ta_v1",
  assetKey: "synthetic_care_day1",
  providerName: "synthetic_care_day1",
  category: "utility",
  language: "ta",
  version: 1,
  components: [
    {
      kind: "header",
      format: "text",
      text: "செயற்கை பின்தொடர்பு · நாள் 1",
    },
    {
      kind: "body",
      text: "உங்கள் திட்டமிடப்பட்ட செயற்கை மருத்துவமனை வெளியேற்றத்திற்குப் பிந்தைய தொடர்பு தயாராக உள்ளது. அங்கீகரிக்கப்பட்ட மாதிரி பதில் விருப்பங்களைப் பயன்படுத்துங்கள்; இங்கு மருத்துவ ஆலோசனை உருவாக்கப்படாது.",
    },
    {
      kind: "footer",
      text: "செயற்கை மாதிரி மட்டும். அவசர உதவிக்கு அங்கீகரிக்கப்பட்ட அவசர சிகிச்சை வழியைப் பயன்படுத்துங்கள்.",
    },
  ],
  variableRules: [],
});
const CARE_DAY_THREE_EN_TEMPLATE = canonicalTemplateFixture({
  workspaceId: WORKSPACE_ID,
  id: "template_synthetic_care_day3_en_v1",
  assetKey: "synthetic_care_day3",
  providerName: "synthetic_care_day3",
  category: "utility",
  language: "en",
  version: 1,
  components: [
    {
      kind: "header",
      format: "text",
      text: "Synthetic follow-up · Day 3",
    },
    {
      kind: "body",
      text: "Your scheduled day-three synthetic post-discharge check-in is ready. Use the approved demo response options; no clinical advice is generated here.",
    },
    {
      kind: "footer",
      text: "Synthetic demo only. For urgent help, use the approved emergency care route.",
    },
  ],
  variableRules: [],
});
const CARE_DAY_THREE_SI_TEMPLATE = canonicalTemplateFixture({
  workspaceId: WORKSPACE_ID,
  id: "template_synthetic_care_day3_si_v1",
  assetKey: "synthetic_care_day3",
  providerName: "synthetic_care_day3",
  category: "utility",
  language: "si",
  version: 1,
  components: [
    {
      kind: "header",
      format: "text",
      text: "කෘත්‍රිම පසු විමසුම · දින 3",
    },
    {
      kind: "body",
      text: "ඔබගේ තුන්වන දින නියමිත කෘත්‍රිම රෝහල් පිටවීමෙන් පසු පසු විමසීම සූදානම්. අනුමත ආදර්ශ ප්‍රතිචාර විකල්ප භාවිත කරන්න; මෙහි සායනික උපදෙස් ජනනය නොකෙරේ.",
    },
    {
      kind: "footer",
      text: "කෘත්‍රිම ආදර්ශයක් පමණි. හදිසි උදව් සඳහා අනුමත හදිසි සත්කාර මාර්ගය භාවිත කරන්න.",
    },
  ],
  variableRules: [],
});
const CARE_DAY_THREE_TA_TEMPLATE = canonicalTemplateFixture({
  workspaceId: WORKSPACE_ID,
  id: "template_synthetic_care_day3_ta_v1",
  assetKey: "synthetic_care_day3",
  providerName: "synthetic_care_day3",
  category: "utility",
  language: "ta",
  version: 1,
  components: [
    {
      kind: "header",
      format: "text",
      text: "செயற்கை பின்தொடர்பு · நாள் 3",
    },
    {
      kind: "body",
      text: "உங்கள் திட்டமிடப்பட்ட மூன்றாம் நாள் செயற்கை மருத்துவமனை வெளியேற்றத்திற்குப் பிந்தைய தொடர்பு தயாராக உள்ளது. அங்கீகரிக்கப்பட்ட மாதிரி பதில் விருப்பங்களைப் பயன்படுத்துங்கள்; இங்கு மருத்துவ ஆலோசனை உருவாக்கப்படாது.",
    },
    {
      kind: "footer",
      text: "செயற்கை மாதிரி மட்டும். அவசர உதவிக்கு அங்கீகரிக்கப்பட்ட அவசர சிகிச்சை வழியைப் பயன்படுத்துங்கள்.",
    },
  ],
  variableRules: [],
});

const TEMPLATE_FIXTURES: Readonly<Record<string, CanonicalTemplateFixture>> = {
  [AUTOMATION_TEMPLATE.id]: AUTOMATION_TEMPLATE,
  [CARE_DAY_ONE_EN_TEMPLATE.id]: CARE_DAY_ONE_EN_TEMPLATE,
  [CARE_DAY_ONE_SI_TEMPLATE.id]: CARE_DAY_ONE_SI_TEMPLATE,
  [CARE_DAY_ONE_TA_TEMPLATE.id]: CARE_DAY_ONE_TA_TEMPLATE,
  [CARE_DAY_THREE_EN_TEMPLATE.id]: CARE_DAY_THREE_EN_TEMPLATE,
  [CARE_DAY_THREE_SI_TEMPLATE.id]: CARE_DAY_THREE_SI_TEMPLATE,
  [CARE_DAY_THREE_TA_TEMPLATE.id]: CARE_DAY_THREE_TA_TEMPLATE,
};

const runtimeConfig: RuntimeConfig = {
  runtimeMode: "demo",
  defaultTenantId: WORKSPACE_ID,
  providerMode: "synthetic",
  hemasIntegrationMode: "synthetic",
  auditSinkMode: "durable",
  outboundEnabled: false,
  approvalGateRequired: true,
  diagnosisEnabled: false,
  syntheticSeed: "hemas-connect-demo-v1",
  liveActivation: {
    id: undefined,
    approvedBy: undefined,
    expiresAt: undefined,
  },
};

const emulator = {
  projectId: PROJECT_ID,
  firestoreEmulatorHost: "127.0.0.1:8080",
} as const;

const automationSteps = [
  {
    id: "step_send_appointment",
    kind: "send_template",
    templateVersionId: AUTOMATION_TEMPLATE_ID,
    templateContentHash: AUTOMATION_TEMPLATE_HASH,
    waitSeconds: null,
    appointmentAction: null,
    routeTeamId: null,
    stopReasonCode: null,
    requiredConsentPurpose: "appointment_service",
    serviceWindowBehavior: "use_approved_template",
    timeoutSeconds: 30,
    retryMaxAttempts: 3,
    retryInitialBackoffSeconds: 30,
    retryMaximumBackoffSeconds: 300,
    fallback: "create_work_item",
  },
  {
    id: "step_wait_reminder",
    kind: "wait",
    templateVersionId: null,
    templateContentHash: null,
    waitSeconds: 3_600,
    appointmentAction: null,
    routeTeamId: null,
    stopReasonCode: null,
    requiredConsentPurpose: "appointment_service",
    serviceWindowBehavior: "send_in_window",
    timeoutSeconds: 5,
    retryMaxAttempts: 0,
    retryInitialBackoffSeconds: 0,
    retryMaximumBackoffSeconds: 0,
    fallback: "stop_run",
  },
] as const;

const careContactPoints = [
  {
    dayOffset: 1,
    en: {
      templateVersionId: CARE_DAY_ONE_EN_TEMPLATE.id,
      contentHash: CARE_DAY_ONE_EN_TEMPLATE.contentHash,
    },
    si: {
      templateVersionId: CARE_DAY_ONE_SI_TEMPLATE.id,
      contentHash: CARE_DAY_ONE_SI_TEMPLATE.contentHash,
    },
    ta: {
      templateVersionId: CARE_DAY_ONE_TA_TEMPLATE.id,
      contentHash: CARE_DAY_ONE_TA_TEMPLATE.contentHash,
    },
  },
  {
    dayOffset: 3,
    en: {
      templateVersionId: CARE_DAY_THREE_EN_TEMPLATE.id,
      contentHash: CARE_DAY_THREE_EN_TEMPLATE.contentHash,
    },
    si: {
      templateVersionId: CARE_DAY_THREE_SI_TEMPLATE.id,
      contentHash: CARE_DAY_THREE_SI_TEMPLATE.contentHash,
    },
    ta: {
      templateVersionId: CARE_DAY_THREE_TA_TEMPLATE.id,
      contentHash: CARE_DAY_THREE_TA_TEMPLATE.contentHash,
    },
  },
] as const;

const AUTOMATION_CONTENT_HASH = sha256Hex(
  serializeAutomationDefinitionContent({
    workspaceId: WORKSPACE_ID,
    definitionId: AUTOMATION_DEFINITION_ID,
    family: "appointment_service",
    version: 3,
    name: "Synthetic appointment reminder",
    trigger: "appointment_event",
    consentPurpose: "appointment_service",
    riskLevel: "medium",
    steps: automationSteps,
    secretBindingHash: AUTOMATION_GOLDEN_VECTORS.secret.hash,
    synthetic: true,
  }),
);
const AUTOMATION_APPROVAL_HASH = sha256Hex(
  serializeAutomationDefinitionApproval({
    workspaceId: WORKSPACE_ID,
    definitionId: AUTOMATION_DEFINITION_ID,
    contentHash: AUTOMATION_CONTENT_HASH,
    ownerUid: "user_demo_admin",
    approverUid: AUTOMATION_ACTOR_UID,
    scope: "simulation_only",
    approvedAt: "2026-08-07T09:00:00.000Z",
  }),
);

const CARE_CONTENT_HASH = sha256Hex(
  serializeCarePathwayContent({
    workspaceId: WORKSPACE_ID,
    pathwayId: CARE_PATHWAY_ID,
    family: "post_discharge",
    protocolVersion: "v1.0",
    name: "Synthetic post-discharge follow-up",
    clinicalOwnerUid: "user_demo_admin",
    contactPoints: careContactPoints,
    responseSlaMinutes: 15,
    escalationTeamId: CARE_TEAM_ID,
    eligibleLocationIds: [
      "location_demo_thalawathugoda",
      CARE_LOCATION_ID,
    ],
    afterHoursBehavior: "on_call_queue",
    writeBackRequired: true,
    instructionsSource: "clinician_authored",
    aiMayGenerateInstructions: false,
    suppressions: [
      "readmission",
      "transfer",
      "death",
      "clinical_hold",
      "withdrawal",
      "invalid_contact",
    ],
    protectedContentHash: "e".repeat(64),
    secretBindingHash: CARE_GOLDEN_VECTORS.secret.hash,
    synthetic: true,
  }),
);
const CARE_APPROVAL_HASH = sha256Hex(
  serializeCarePathwayApproval({
    workspaceId: WORKSPACE_ID,
    pathwayId: CARE_PATHWAY_ID,
    contentHash: CARE_CONTENT_HASH,
    clinicalOwnerUid: "user_demo_admin",
    clinicalApproverUid: CARE_ACTOR_UID,
    scope: "clinical_simulation_only",
    approvedAt: "2026-08-07T09:30:00.000Z",
  }),
);

function workspace(overrides: MemoryRecord = {}): MemoryRecord {
  return {
    id: WORKSPACE_ID,
    name: "SafeNet synthetic demo",
    mode: "demo",
    status: "active",
    timeZone: "Asia/Colombo",
    supportedLanguages: ["en", "si", "ta"],
    defaultLanguage: "en",
    retentionPolicyVersion: "synthetic-v1",
    dataClassification: "synthetic_only",
    externalMessaging: {
      enabled: false,
      mode: "simulator_only",
      allowlistedRecipientHashes: [],
      verifiedCapacity: null,
      capacityVerifiedAt: null,
      disabledReason: "Synthetic Phase 5 transaction tests have no outbound authority.",
    },
    isSyntheticDemo: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function membership(input: {
  readonly uid: string;
  readonly role: "tenant_admin" | "supervisor" | "clinical_approver" | "analyst";
  readonly teamId: string;
  readonly locationId: string;
  readonly scopeMode?: "assigned" | "workspace_wide";
  readonly overrides?: MemoryRecord;
}): MemoryRecord {
  const scopeMode = input.scopeMode ?? "assigned";
  return {
    id: input.uid,
    uid: input.uid,
    workspaceId: WORKSPACE_ID,
    displayLabel: "Synthetic Phase 5 controller",
    role: input.role,
    scopeMode,
    teamIds: scopeMode === "workspace_wide" ? [] : [input.teamId],
    locationIds: scopeMode === "workspace_wide" ? [] : [input.locationId],
    status: "active",
    mfaSatisfied: true,
    lastAuthenticatedAt: new Date(NOW.getTime() - 60_000),
    synthetic: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...input.overrides,
  };
}

function team(teamId: string, locationId: string): MemoryRecord {
  return {
    id: teamId,
    workspaceId: WORKSPACE_ID,
    name: "Synthetic governed patient-service team",
    queueType: teamId === CARE_TEAM_ID ? "clinical_escalation" : "outpatient",
    locationIds: [locationId],
    businessHoursLabel: "Synthetic only",
    firstResponseSlaMinutes: 15,
    active: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function location(locationId: string): MemoryRecord {
  return {
    id: locationId,
    workspaceId: WORKSPACE_ID,
    name: "Synthetic Hospital — Wattala",
    kind: "hospital",
    city: "Wattala",
    supportedServiceRefs: ["synthetic-phase5"],
    active: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function contact(input: {
  readonly id: string;
  readonly teamId: string;
  readonly locationId: string;
  readonly overrides?: MemoryRecord;
}): MemoryRecord {
  return {
    id: input.id,
    workspaceId: WORKSPACE_ID,
    teamId: input.teamId,
    locationId: input.locationId,
    maskedPhone: "•••• 0001",
    displayLabel: "Synthetic patient reference",
    preferredLanguage: "en",
    alternateLanguages: ["si", "ta"],
    suppression: {
      suppressAll: false,
      suppressMarketing: false,
      invalidContact: false,
      reasons: [],
      updatedAt: CREATED_AT,
    },
    tags: ["synthetic"],
    preferenceRevision: 1,
    synthetic: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...input.overrides,
  };
}

function conversation(input: {
  readonly id: string;
  readonly contactId: string;
  readonly teamId: string;
  readonly locationId: string;
  readonly purpose: "appointment_service" | "care_pathway" | "urgent_escalation";
  readonly overrides?: MemoryRecord;
}): MemoryRecord {
  return {
    id: input.id,
    workspaceId: WORKSPACE_ID,
    contactId: input.contactId,
    connectionId: "connection_synthetic_whatsapp",
    teamId: input.teamId,
    locationId: input.locationId,
    status: "open",
    mode: "automation",
    assigneeId: null,
    detectedLanguage: "en",
    languageConfidence: 1,
    purpose: input.purpose,
    serviceWindowExpiresAt: new Date("2026-08-08T12:00:00.000Z"),
    firstResponseDueAt: new Date("2026-08-07T12:15:00.000Z"),
    lastMessageAt: CREATED_AT,
    handoffSummary: null,
    unreadCount: 0,
    synthetic: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...input.overrides,
  };
}

function consent(input: {
  readonly id: string;
  readonly contactId: string;
  readonly teamId: string;
  readonly locationId: string;
  readonly purpose: "appointment_service" | "care_pathway";
  readonly overrides?: MemoryRecord;
}): MemoryRecord {
  return {
    id: input.id,
    workspaceId: WORKSPACE_ID,
    contactId: input.contactId,
    teamId: input.teamId,
    locationId: input.locationId,
    purpose: input.purpose,
    channel: "whatsapp",
    category: "utility",
    status: "granted",
    source: "synthetic_seed",
    noticeVersion: "synthetic-v1",
    language: "en",
    evidenceRef: "demo://consent/evidence/synthetic-v1",
    capturedAt: CREATED_AT,
    withdrawnAt: null,
    supersedesRecordId: null,
    synthetic: true,
    schemaVersion: 1,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...input.overrides,
  };
}

function template(input: {
  readonly id: string;
  readonly hash: string;
  readonly language: "en" | "si" | "ta";
}): MemoryRecord {
  const fixture = TEMPLATE_FIXTURES[input.id];
  assert.ok(fixture, `missing canonical template fixture: ${input.id}`);
  assert.equal(input.hash, fixture.contentHash);
  assert.equal(input.language, fixture.language);
  return {
    id: fixture.id,
    workspaceId: WORKSPACE_ID,
    assetKey: fixture.assetKey,
    sortKey: `${fixture.assetKey}:${fixture.language}:${String(fixture.version).padStart(4, "0")}`,
    providerName: fixture.providerName,
    category: fixture.category,
    language: fixture.language,
    version: fixture.version,
    localState: "approved",
    providerState: {
      submissionState: "not_submitted",
      approvalState: "unverified",
      authority: "none",
      assetId: null,
      qualityRating: "unknown",
      checkedAt: null,
    },
    immutable: true,
    contentHash: fixture.contentHash,
    components: clone(fixture.components),
    variableRules: clone(fixture.variableRules),
    ownership: {
      ownerKind: "safenet_demo",
      ownerWorkspaceId: WORKSPACE_ID,
      transferableToHemas: false,
      productionUseAllowed: false,
      notice: "Synthetic fixture only.",
    },
    synthetic: true,
    schemaVersion: 1,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function activationAudit(input: {
  readonly id: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly actorUid: string;
  readonly eventId: string;
  readonly revision: number;
  readonly occurredAt: Date;
}): MemoryRecord {
  return {
    id: input.id,
    workspaceId: WORKSPACE_ID,
    actorUid: input.actorUid,
    actorType: "user",
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    outcome: "allowed",
    requestId: `${input.id}:request`,
    occurredAt: input.occurredAt,
    createdAt: input.occurredAt,
    metadata: {
      eventId: input.eventId,
      revision: input.revision,
      synthetic: true,
      externalDispatchCount: 0,
      networkCallCount: 0,
    },
    synthetic: true,
    schemaVersion: 1,
  };
}

function actor(uid: string, now = NOW, ageSeconds = 60) {
  return { uid, authTime: new Date(now.getTime() - ageSeconds * 1_000) };
}

function hasCode(...expected: readonly string[]): (error: unknown) => boolean {
  return (error: unknown) =>
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    expected.includes(String((error as { readonly code: unknown }).code));
}

function collectionPaths(
  store: MemoryAdminTransactionStore,
  collection: string,
): readonly string[] {
  const marker = `/${collection}/`;
  return [...store.records.keys()].filter((path) => path.includes(marker));
}

function singleRecord(
  store: MemoryAdminTransactionStore,
  collection: string,
): MemoryRecord {
  const matches = collectionPaths(store, collection);
  assert.equal(matches.length, 1, `expected one ${collection} document`);
  const value = store.records.get(matches[0]!);
  assert.ok(value);
  return value;
}

function automationReceiptId(): string {
  return syntheticHmacSha256(serializeAutomationTriggerReceiptKey({
    workspaceId: WORKSPACE_ID,
    family: "appointment_service",
    sourceEventFingerprint: AUTOMATION_SOURCE_FINGERPRINT,
  }));
}

function careReceiptId(): string {
  return syntheticHmacSha256(serializeCareEnrollmentReceiptKey({
    workspaceId: WORKSPACE_ID,
    family: "post_discharge",
    dischargeFingerprint: CARE_DISCHARGE_FINGERPRINT,
  }));
}

function expectedAutomationResultFingerprint(
  result: SyntheticAutomationControlResult,
): string {
  return sha256Hex(JSON.stringify([
    "hemas-connect:automation-control-result:v1",
    result.runId,
    result.eventId,
    result.action,
    result.state,
    result.revision,
    result.currentStepIndex,
    result.completedStepCount,
    result.attemptCount,
    result.nextEligibleAt,
    result.openWorkItemId,
    result.outcomeCode,
    true,
    0,
    0,
  ]));
}

function expectedCareResultFingerprint(
  result: SyntheticCareControlResult,
): string {
  return sha256Hex(JSON.stringify([
    "hemas-connect:care-control-result:v1",
    result.enrollmentId,
    result.eventId,
    result.action,
    result.state,
    result.revision,
    result.nextContactIndex,
    result.nextContactAt,
    result.openEscalationId,
    result.safetyHoldEscalationId,
    result.openHandoffId,
    result.outcomeCode,
    true,
    0,
    0,
  ]));
}

function workspacePath(collection: string, id: string): string {
  return `workspaces/${WORKSPACE_ID}/${collection}/${id}`;
}

function automationDefinition(overrides: MemoryRecord = {}): MemoryRecord {
  return {
    id: AUTOMATION_DEFINITION_ID,
    workspaceId: WORKSPACE_ID,
    family: "appointment_service",
    version: 3,
    name: "Synthetic appointment reminder",
    trigger: "appointment_event",
    consentPurpose: "appointment_service",
    riskLevel: "medium",
    steps: automationSteps,
    contentHash: AUTOMATION_CONTENT_HASH,
    secretBindingHash: AUTOMATION_GOLDEN_VECTORS.secret.hash,
    ownerUid: "user_demo_admin",
    approverUid: AUTOMATION_ACTOR_UID,
    approvalHash: AUTOMATION_APPROVAL_HASH,
    approvalScope: "simulation_only",
    approvedAt: new Date("2026-08-07T09:00:00.000Z"),
    lifecycleState: "approved",
    schemaVersion: 1,
    synthetic: true,
    createdAt: new Date("2026-08-07T08:30:00.000Z"),
    updatedAt: new Date("2026-08-07T09:00:00.000Z"),
    ...overrides,
  };
}

function automationActivation(overrides: MemoryRecord = {}): MemoryRecord {
  const activatedAt = new Date("2026-08-07T09:15:00.000Z");
  return {
    id: "appointment_service",
    workspaceId: WORKSPACE_ID,
    family: "appointment_service",
    activeDefinitionId: AUTOMATION_DEFINITION_ID,
    activeDefinitionVersion: 3,
    activeDefinitionContentHash: AUTOMATION_CONTENT_HASH,
    activeDefinitionApprovalHash: AUTOMATION_APPROVAL_HASH,
    activeDefinitionApprovalScope: "simulation_only",
    activeDefinitionSecretBindingHash: AUTOMATION_GOLDEN_VECTORS.secret.hash,
    activatedByUid: AUTOMATION_ACTOR_UID,
    activatedAt,
    activationEventId: AUTOMATION_ACTIVATION_EVENT_ID,
    activationAuditEventId: AUTOMATION_ACTIVATION_AUDIT_ID,
    revision: 1,
    createdAt: activatedAt,
    updatedAt: activatedAt,
    schemaVersion: 1,
    synthetic: true,
    externalDispatchCount: 0,
    networkCallCount: 0,
    ...overrides,
  };
}

function automationActivationEvent(overrides: MemoryRecord = {}): MemoryRecord {
  const occurredAt = new Date("2026-08-07T09:15:00.000Z");
  return {
    id: AUTOMATION_ACTIVATION_EVENT_ID,
    workspaceId: WORKSPACE_ID,
    family: "appointment_service",
    eventType: "activated",
    definitionId: AUTOMATION_DEFINITION_ID,
    definitionVersion: 3,
    definitionContentHash: AUTOMATION_CONTENT_HASH,
    definitionApprovalHash: AUTOMATION_APPROVAL_HASH,
    definitionApprovalScope: "simulation_only",
    definitionSecretBindingHash: AUTOMATION_GOLDEN_VECTORS.secret.hash,
    fromLifecycleState: "approved",
    toLifecycleState: "approved",
    revision: 4,
    auditEventId: AUTOMATION_ACTIVATION_AUDIT_ID,
    actorKind: "staff",
    actorUid: AUTOMATION_ACTOR_UID,
    occurredAt,
    schemaVersion: 1,
    synthetic: true,
    externalDispatchCount: 0,
    networkCallCount: 0,
    ...overrides,
  };
}

function automationReceipt(overrides: MemoryRecord = {}): MemoryRecord {
  const receiptId = automationReceiptId();
  return {
    id: receiptId,
    workspaceId: WORKSPACE_ID,
    family: "appointment_service",
    definitionId: AUTOMATION_DEFINITION_ID,
    definitionVersion: 3,
    definitionContentHash: AUTOMATION_CONTENT_HASH,
    definitionApprovalHash: AUTOMATION_APPROVAL_HASH,
    activationEventId: AUTOMATION_ACTIVATION_EVENT_ID,
    sourceEventFingerprint: AUTOMATION_SOURCE_FINGERPRINT,
    triggerFingerprint: receiptId,
    runId: AUTOMATION_RUN_ID,
    createdAt: new Date("2026-08-07T09:45:00.000Z"),
    schemaVersion: 1,
    synthetic: true,
    ...overrides,
  };
}

function automationRun(overrides: MemoryRecord = {}): MemoryRecord {
  const createdAt = new Date("2026-08-07T09:45:00.000Z");
  return {
    id: AUTOMATION_RUN_ID,
    workspaceId: WORKSPACE_ID,
    definitionId: AUTOMATION_DEFINITION_ID,
    definitionVersion: 3,
    definitionContentHash: AUTOMATION_CONTENT_HASH,
    teamId: AUTOMATION_TEAM_ID,
    locationId: AUTOMATION_LOCATION_ID,
    state: "queued",
    pausedFromState: null,
    nextEligibleAt: null,
    openWorkItemId: null,
    currentStepIndex: 0,
    completedStepCount: 0,
    attemptCount: 0,
    revision: 1,
    outcomeCode: "accepted",
    lastEventId: null,
    schemaVersion: 1,
    synthetic: true,
    externalDispatchCount: 0,
    networkCallCount: 0,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function automationRunSecret(overrides: MemoryRecord = {}): MemoryRecord {
  const receiptId = automationReceiptId();
  return {
    workspaceId: WORKSPACE_ID,
    runId: AUTOMATION_RUN_ID,
    protectedContactRef: "demo://automation/contact/synthetic-v1",
    protectedConversationRef: "demo://automation/conversation/synthetic-v1",
    protectedAppointmentRef: "demo://automation/appointment/synthetic-v1",
    triggerFingerprint: receiptId,
    idempotencyFingerprint: AUTOMATION_IDEMPOTENCY_FINGERPRINT,
    schemaVersion: 1,
    synthetic: true,
    ...overrides,
  };
}

function seedAutomationStore(input: {
  readonly membership?: MemoryRecord;
  readonly definition?: MemoryRecord;
  readonly activation?: MemoryRecord;
  readonly activationEvent?: MemoryRecord;
  readonly receipt?: MemoryRecord;
  readonly run?: MemoryRecord;
  readonly runSecret?: MemoryRecord;
  readonly contact?: MemoryRecord;
  readonly conversation?: MemoryRecord;
  readonly consent?: MemoryRecord;
} = {}): MemoryAdminTransactionStore {
  const store = new MemoryAdminTransactionStore();
  store.seed(`workspaces/${WORKSPACE_ID}`, workspace());
  store.seed(
    workspacePath("members", AUTOMATION_ACTOR_UID),
    input.membership ?? membership({
      uid: AUTOMATION_ACTOR_UID,
      role: "supervisor",
      teamId: AUTOMATION_TEAM_ID,
      locationId: AUTOMATION_LOCATION_ID,
    }),
  );
  store.seed(
    workspacePath("teams", AUTOMATION_TEAM_ID),
    team(AUTOMATION_TEAM_ID, AUTOMATION_LOCATION_ID),
  );
  store.seed(
    workspacePath("locations", AUTOMATION_LOCATION_ID),
    location(AUTOMATION_LOCATION_ID),
  );
  store.seed(
    workspacePath(AUTOMATION_COLLECTIONS.definitions, AUTOMATION_DEFINITION_ID),
    input.definition ?? automationDefinition(),
  );
  store.seed(
    workspacePath(AUTOMATION_COLLECTIONS.definitionSecrets, AUTOMATION_DEFINITION_ID),
    {
      workspaceId: WORKSPACE_ID,
      definitionId: AUTOMATION_DEFINITION_ID,
      protectedConfigurationRef: "demo://automation/configuration/synthetic-v1",
      configurationFingerprint: "1".repeat(64),
      schemaVersion: 1,
      synthetic: true,
    },
  );
  store.seed(
    workspacePath(AUTOMATION_COLLECTIONS.activations, "appointment_service"),
    input.activation ?? automationActivation(),
  );
  store.seed(
    workspacePath(
      AUTOMATION_COLLECTIONS.definitionEvents,
      AUTOMATION_ACTIVATION_EVENT_ID,
    ),
    input.activationEvent ?? automationActivationEvent(),
  );
  store.seed(
    workspacePath("auditEvents", AUTOMATION_ACTIVATION_AUDIT_ID),
    activationAudit({
      id: AUTOMATION_ACTIVATION_AUDIT_ID,
      action: "automation_definition.activate",
      resourceType: "automation_definition",
      resourceId: AUTOMATION_DEFINITION_ID,
      actorUid: AUTOMATION_ACTOR_UID,
      eventId: AUTOMATION_ACTIVATION_EVENT_ID,
      revision: 4,
      occurredAt: new Date("2026-08-07T09:15:00.000Z"),
    }),
  );
  store.seed(
    workspacePath(AUTOMATION_COLLECTIONS.triggerReceipts, automationReceiptId()),
    input.receipt ?? automationReceipt(),
  );
  store.seed(
    workspacePath(AUTOMATION_COLLECTIONS.runs, AUTOMATION_RUN_ID),
    input.run ?? automationRun(),
  );
  store.seed(
    workspacePath(AUTOMATION_COLLECTIONS.runSecrets, AUTOMATION_RUN_ID),
    input.runSecret ?? automationRunSecret(),
  );
  store.seed(
    workspacePath("contacts", AUTOMATION_CONTACT_ID),
    input.contact ?? contact({
      id: AUTOMATION_CONTACT_ID,
      teamId: AUTOMATION_TEAM_ID,
      locationId: AUTOMATION_LOCATION_ID,
    }),
  );
  store.seed(
    workspacePath("conversations", AUTOMATION_CONVERSATION_ID),
    input.conversation ?? conversation({
      id: AUTOMATION_CONVERSATION_ID,
      contactId: AUTOMATION_CONTACT_ID,
      teamId: AUTOMATION_TEAM_ID,
      locationId: AUTOMATION_LOCATION_ID,
      purpose: "appointment_service",
    }),
  );
  store.seed(
    workspacePath("consentRecords", AUTOMATION_CONSENT_ID),
    input.consent ?? consent({
      id: AUTOMATION_CONSENT_ID,
      contactId: AUTOMATION_CONTACT_ID,
      teamId: AUTOMATION_TEAM_ID,
      locationId: AUTOMATION_LOCATION_ID,
      purpose: "appointment_service",
    }),
  );
  store.seed(
    workspacePath("templates", AUTOMATION_TEMPLATE_ID),
    template({
      id: AUTOMATION_TEMPLATE_ID,
      hash: AUTOMATION_TEMPLATE_HASH,
      language: "en",
    }),
  );
  return store;
}

function seedAutomationFallbackStore(
  fallback: AuthoritativeAutomationStep["fallback"],
): MemoryAdminTransactionStore {
  const steps: readonly AuthoritativeAutomationStep[] = [
    { ...automationSteps[0], fallback },
  ];
  const contentHash = sha256Hex(
    serializeAutomationDefinitionContent({
      workspaceId: WORKSPACE_ID,
      definitionId: AUTOMATION_DEFINITION_ID,
      family: "appointment_service",
      version: 3,
      name: "Synthetic appointment reminder",
      trigger: "appointment_event",
      consentPurpose: "appointment_service",
      riskLevel: "medium",
      steps,
      secretBindingHash: AUTOMATION_GOLDEN_VECTORS.secret.hash,
      synthetic: true,
    }),
  );
  const approvalHash = sha256Hex(
    serializeAutomationDefinitionApproval({
      workspaceId: WORKSPACE_ID,
      definitionId: AUTOMATION_DEFINITION_ID,
      contentHash,
      ownerUid: "user_demo_admin",
      approverUid: AUTOMATION_ACTOR_UID,
      scope: "simulation_only",
      approvedAt: "2026-08-07T09:00:00.000Z",
    }),
  );
  return seedAutomationStore({
    definition: automationDefinition({ steps, contentHash, approvalHash }),
    activation: automationActivation({
      activeDefinitionContentHash: contentHash,
      activeDefinitionApprovalHash: approvalHash,
    }),
    activationEvent: automationActivationEvent({
      definitionContentHash: contentHash,
      definitionApprovalHash: approvalHash,
    }),
    receipt: automationReceipt({
      definitionContentHash: contentHash,
      definitionApprovalHash: approvalHash,
    }),
    run: automationRun({ definitionContentHash: contentHash }),
  });
}

function carePathway(overrides: MemoryRecord = {}): MemoryRecord {
  return {
    id: CARE_PATHWAY_ID,
    workspaceId: WORKSPACE_ID,
    family: "post_discharge",
    protocolVersion: "v1.0",
    name: "Synthetic post-discharge follow-up",
    clinicalOwnerUid: "user_demo_admin",
    clinicalApproverUid: CARE_ACTOR_UID,
    contactPoints: careContactPoints,
    responseSlaMinutes: 15,
    escalationTeamId: CARE_TEAM_ID,
    eligibleLocationIds: [
      "location_demo_thalawathugoda",
      CARE_LOCATION_ID,
    ],
    afterHoursBehavior: "on_call_queue",
    writeBackRequired: true,
    instructionsSource: "clinician_authored",
    aiMayGenerateInstructions: false,
    suppressions: [
      "readmission",
      "transfer",
      "death",
      "clinical_hold",
      "withdrawal",
      "invalid_contact",
    ],
    protectedContentHash: "e".repeat(64),
    secretBindingHash: CARE_GOLDEN_VECTORS.secret.hash,
    contentHash: CARE_CONTENT_HASH,
    approvalHash: CARE_APPROVAL_HASH,
    approvalScope: "clinical_simulation_only",
    approvedAt: new Date("2026-08-07T09:30:00.000Z"),
    lifecycleState: "approved",
    schemaVersion: 1,
    synthetic: true,
    createdAt: new Date("2026-08-07T09:00:00.000Z"),
    updatedAt: new Date("2026-08-07T09:30:00.000Z"),
    ...overrides,
  };
}

function careActivation(overrides: MemoryRecord = {}): MemoryRecord {
  const activatedAt = new Date("2026-08-07T09:40:00.000Z");
  return {
    id: "post_discharge",
    workspaceId: WORKSPACE_ID,
    family: "post_discharge",
    activePathwayId: CARE_PATHWAY_ID,
    activeProtocolVersion: "v1.0",
    activePathwayContentHash: CARE_CONTENT_HASH,
    activePathwayApprovalHash: CARE_APPROVAL_HASH,
    activePathwayApprovalScope: "clinical_simulation_only",
    activePathwaySecretBindingHash: CARE_GOLDEN_VECTORS.secret.hash,
    activatedByUid: CARE_ACTOR_UID,
    activatedAt,
    activationEventId: CARE_ACTIVATION_EVENT_ID,
    activationAuditEventId: CARE_ACTIVATION_AUDIT_ID,
    revision: 1,
    createdAt: activatedAt,
    updatedAt: activatedAt,
    schemaVersion: 1,
    synthetic: true,
    externalDispatchCount: 0,
    networkCallCount: 0,
    ...overrides,
  };
}

function careActivationEvent(overrides: MemoryRecord = {}): MemoryRecord {
  const occurredAt = new Date("2026-08-07T09:40:00.000Z");
  return {
    id: CARE_ACTIVATION_EVENT_ID,
    workspaceId: WORKSPACE_ID,
    family: "post_discharge",
    eventType: "activated",
    pathwayId: CARE_PATHWAY_ID,
    pathwayProtocolVersion: "v1.0",
    pathwayContentHash: CARE_CONTENT_HASH,
    pathwayApprovalHash: CARE_APPROVAL_HASH,
    pathwayApprovalScope: "clinical_simulation_only",
    pathwaySecretBindingHash: CARE_GOLDEN_VECTORS.secret.hash,
    fromLifecycleState: "approved",
    toLifecycleState: "approved",
    revision: 4,
    auditEventId: CARE_ACTIVATION_AUDIT_ID,
    actorKind: "staff",
    actorUid: CARE_ACTOR_UID,
    occurredAt,
    schemaVersion: 1,
    synthetic: true,
    externalDispatchCount: 0,
    networkCallCount: 0,
    ...overrides,
  };
}

function careReceipt(overrides: MemoryRecord = {}): MemoryRecord {
  const receiptId = careReceiptId();
  return {
    id: receiptId,
    workspaceId: WORKSPACE_ID,
    family: "post_discharge",
    pathwayId: CARE_PATHWAY_ID,
    pathwayProtocolVersion: "v1.0",
    pathwayContentHash: CARE_CONTENT_HASH,
    pathwayApprovalHash: CARE_APPROVAL_HASH,
    activationEventId: CARE_ACTIVATION_EVENT_ID,
    dischargeFingerprint: CARE_DISCHARGE_FINGERPRINT,
    qualifyingDischargeAt: CARE_DISCHARGE_AT,
    receiptFingerprint: receiptId,
    enrollmentId: CARE_ENROLLMENT_ID,
    createdAt: new Date("2026-08-07T09:50:00.000Z"),
    schemaVersion: 1,
    synthetic: true,
    ...overrides,
  };
}

function careEnrollment(overrides: MemoryRecord = {}): MemoryRecord {
  const createdAt = new Date("2026-08-07T09:50:00.000Z");
  return {
    id: CARE_ENROLLMENT_ID,
    workspaceId: WORKSPACE_ID,
    pathwayId: CARE_PATHWAY_ID,
    pathwayProtocolVersion: "v1.0",
    pathwayContentHash: CARE_CONTENT_HASH,
    teamId: CARE_TEAM_ID,
    locationId: CARE_LOCATION_ID,
    state: "queued",
    nextContactIndex: 0,
    nextContactAt: CARE_DAY_ONE_AT,
    activeSuppressions: [],
    openEscalationId: null,
    safetyHoldEscalationId: null,
    openHandoffId: null,
    revision: 1,
    outcomeCode: "accepted",
    lastEventId: null,
    schemaVersion: 1,
    synthetic: true,
    externalDispatchCount: 0,
    networkCallCount: 0,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function careEnrollmentSecret(overrides: MemoryRecord = {}): MemoryRecord {
  const receiptId = careReceiptId();
  return {
    workspaceId: WORKSPACE_ID,
    enrollmentId: CARE_ENROLLMENT_ID,
    protectedContactRef: "demo://care/contact/synthetic-001",
    protectedConversationRef: "demo://care/conversation/synthetic-001",
    protectedQualifyingDischargeRef: "demo://care/discharge/synthetic-001",
    qualifyingDischargeAt: CARE_DISCHARGE_AT,
    subjectFingerprint: "c".repeat(64),
    sourceDischargeFingerprint: CARE_DISCHARGE_FINGERPRINT,
    receiptId,
    receiptFingerprint: receiptId,
    schemaVersion: 1,
    synthetic: true,
    ...overrides,
  };
}

function seedCareStore(input: {
  readonly membership?: MemoryRecord;
  readonly pathway?: MemoryRecord;
  readonly activation?: MemoryRecord;
  readonly activationEvent?: MemoryRecord;
  readonly receipt?: MemoryRecord;
  readonly enrollment?: MemoryRecord;
  readonly enrollmentSecret?: MemoryRecord;
  readonly contact?: MemoryRecord;
  readonly conversation?: MemoryRecord;
  readonly consent?: MemoryRecord;
} = {}): MemoryAdminTransactionStore {
  const store = new MemoryAdminTransactionStore();
  store.seed(`workspaces/${WORKSPACE_ID}`, workspace());
  store.seed(
    workspacePath("members", CARE_ACTOR_UID),
    input.membership ?? membership({
      uid: CARE_ACTOR_UID,
      role: "clinical_approver",
      teamId: CARE_TEAM_ID,
      locationId: CARE_LOCATION_ID,
    }),
  );
  store.seed(
    workspacePath("teams", CARE_TEAM_ID),
    team(CARE_TEAM_ID, CARE_LOCATION_ID),
  );
  store.seed(
    workspacePath("locations", CARE_LOCATION_ID),
    location(CARE_LOCATION_ID),
  );
  store.seed(
    workspacePath(CARE_COLLECTIONS.pathways, CARE_PATHWAY_ID),
    input.pathway ?? carePathway(),
  );
  store.seed(
    workspacePath(CARE_COLLECTIONS.pathwaySecrets, CARE_PATHWAY_ID),
    {
      workspaceId: WORKSPACE_ID,
      pathwayId: CARE_PATHWAY_ID,
      protectedInstructionsRef: "demo://care/instructions/synthetic-v1",
      protectedContentFingerprint: "e".repeat(64),
      schemaVersion: 1,
      synthetic: true,
    },
  );
  store.seed(
    workspacePath(CARE_COLLECTIONS.activations, "post_discharge"),
    input.activation ?? careActivation(),
  );
  store.seed(
    workspacePath(CARE_COLLECTIONS.pathwayEvents, CARE_ACTIVATION_EVENT_ID),
    input.activationEvent ?? careActivationEvent(),
  );
  store.seed(
    workspacePath("auditEvents", CARE_ACTIVATION_AUDIT_ID),
    activationAudit({
      id: CARE_ACTIVATION_AUDIT_ID,
      action: "care_pathway.activate",
      resourceType: "care_pathway",
      resourceId: CARE_PATHWAY_ID,
      actorUid: CARE_ACTOR_UID,
      eventId: CARE_ACTIVATION_EVENT_ID,
      revision: 4,
      occurredAt: new Date("2026-08-07T09:40:00.000Z"),
    }),
  );
  store.seed(
    workspacePath(CARE_COLLECTIONS.enrollmentReceipts, careReceiptId()),
    input.receipt ?? careReceipt(),
  );
  store.seed(
    workspacePath(CARE_COLLECTIONS.enrollments, CARE_ENROLLMENT_ID),
    input.enrollment ?? careEnrollment(),
  );
  store.seed(
    workspacePath(CARE_COLLECTIONS.enrollmentSecrets, CARE_ENROLLMENT_ID),
    input.enrollmentSecret ?? careEnrollmentSecret(),
  );
  store.seed(
    workspacePath("contacts", CARE_CONTACT_ID),
    input.contact ?? contact({
      id: CARE_CONTACT_ID,
      teamId: CARE_TEAM_ID,
      locationId: CARE_LOCATION_ID,
    }),
  );
  store.seed(
    workspacePath("conversations", CARE_CONVERSATION_ID),
    input.conversation ?? conversation({
      id: CARE_CONVERSATION_ID,
      contactId: CARE_CONTACT_ID,
      teamId: CARE_TEAM_ID,
      locationId: CARE_LOCATION_ID,
      purpose: "care_pathway",
      overrides: {
        status: "active",
        mode: "automation",
        handoffSummary:
          "Synthetic Phase 5 care-control route; no patient or clinical content.",
      },
    }),
  );
  store.seed(
    workspacePath("conversations", URGENT_SAFETY_CONVERSATION_ID),
    conversation({
      id: URGENT_SAFETY_CONVERSATION_ID,
      contactId: CARE_CONTACT_ID,
      teamId: CARE_TEAM_ID,
      locationId: CARE_LOCATION_ID,
      purpose: "urgent_escalation",
      overrides: {
        status: "escalated",
        mode: "safety_hold",
        handoffSummary:
          "Synthetic urgent-language trigger; routine automation is paused.",
      },
    }),
  );
  store.seed(
    workspacePath("consentRecords", CARE_CONSENT_ID),
    input.consent ?? consent({
      id: CARE_CONSENT_ID,
      contactId: CARE_CONTACT_ID,
      teamId: CARE_TEAM_ID,
      locationId: CARE_LOCATION_ID,
      purpose: "care_pathway",
    }),
  );
  for (const point of careContactPoints) {
    for (const language of ["en", "si", "ta"] as const) {
      store.seed(
        workspacePath("templates", point[language].templateVersionId),
        template({
          id: point[language].templateVersionId,
          hash: point[language].contentHash,
          language,
        }),
      );
    }
  }
  return store;
}

function automationRequest(
  action: AutomationRunAction,
  expectedRevision: number,
  idempotencyKey: string,
): SyntheticAutomationControlInput {
  return {
    workspaceId: WORKSPACE_ID,
    runId: AUTOMATION_RUN_ID,
    action,
    expectedRevision,
    idempotencyKey,
  };
}

function careRequest(
  action: CareEnrollmentAction,
  expectedRevision: number,
  idempotencyKey: string,
  suppressionReason: SyntheticCareControlInput["suppressionReason"] = null,
): SyntheticCareControlInput {
  return {
    workspaceId: WORKSPACE_ID,
    enrollmentId: CARE_ENROLLMENT_ID,
    action,
    expectedRevision,
    suppressionReason,
    idempotencyKey,
  };
}

async function invokeAutomation(input: {
  readonly store: MemoryAdminTransactionStore;
  readonly request: SyntheticAutomationControlInput;
  readonly now?: Date;
  readonly actorUid?: string;
  readonly authAgeSeconds?: number;
  readonly config?: RuntimeConfig;
  readonly boundary?: {
    readonly projectId: string;
    readonly firestoreEmulatorHost: string | undefined;
  };
}) {
  const now = input.now ?? NOW;
  return controlSyntheticAutomationRun({
    db: input.store.db,
    config: input.config ?? runtimeConfig,
    emulator: input.boundary ?? emulator,
    actor: actor(
      input.actorUid ?? AUTOMATION_ACTOR_UID,
      now,
      input.authAgeSeconds ?? 60,
    ),
    request: input.request,
    now,
  });
}

async function invokeCare(input: {
  readonly store: MemoryAdminTransactionStore;
  readonly request: SyntheticCareControlInput;
  readonly now?: Date;
  readonly actorUid?: string;
  readonly authAgeSeconds?: number;
  readonly config?: RuntimeConfig;
  readonly boundary?: {
    readonly projectId: string;
    readonly firestoreEmulatorHost: string | undefined;
  };
}) {
  const now = input.now ?? NOW;
  return controlSyntheticCareEnrollment({
    db: input.store.db,
    config: input.config ?? runtimeConfig,
    emulator: input.boundary ?? emulator,
    actor: actor(
      input.actorUid ?? CARE_ACTOR_UID,
      now,
      input.authAgeSeconds ?? 60,
    ),
    request: input.request,
    now,
  });
}

function automationRunRecord(store: MemoryAdminTransactionStore): MemoryRecord {
  const value = store.records.get(
    workspacePath(AUTOMATION_COLLECTIONS.runs, AUTOMATION_RUN_ID),
  );
  assert.ok(value);
  return value;
}

function careEnrollmentRecord(store: MemoryAdminTransactionStore): MemoryRecord {
  const value = store.records.get(
    workspacePath(CARE_COLLECTIONS.enrollments, CARE_ENROLLMENT_ID),
  );
  assert.ok(value);
  return value;
}

function nextAutomationRequest(
  store: MemoryAdminTransactionStore,
  action: AutomationRunAction,
  key: string,
): SyntheticAutomationControlInput {
  return automationRequest(action, Number(automationRunRecord(store).revision), key);
}

function nextCareRequest(
  store: MemoryAdminTransactionStore,
  action: CareEnrollmentAction,
  key: string,
  suppressionReason: SyntheticCareControlInput["suppressionReason"] = null,
): SyntheticCareControlInput {
  return careRequest(
    action,
    Number(careEnrollmentRecord(store).revision),
    key,
    suppressionReason,
  );
}

function refreshMembershipAuthentication(
  store: MemoryAdminTransactionStore,
  uid: string,
  now: Date,
): void {
  const path = workspacePath("members", uid);
  const current = store.records.get(path);
  assert.ok(current);
  store.records.set(path, {
    ...current,
    lastAuthenticatedAt: new Date(now.getTime() - 60_000),
    updatedAt: new Date(now.getTime() - 60_000),
  });
}

function newPaths(
  store: MemoryAdminTransactionStore,
  collection: string,
  baseline: ReadonlySet<string>,
): readonly string[] {
  return collectionPaths(store, collection).filter((path) => !baseline.has(path));
}

function assertLatestConsentQuery(
  store: MemoryAdminTransactionStore,
  expected: {
    readonly contactId: string;
    readonly teamId: string;
    readonly locationId: string;
    readonly purpose: "appointment_service" | "care_pathway";
  },
): void {
  assert.equal(store.executedQueries.length, 1);
  assert.deepEqual(store.executedQueries[0], {
    __memoryQuery: true,
    path: `workspaces/${WORKSPACE_ID}/consentRecords`,
    filters: [
      { field: "contactId", operator: "==", value: expected.contactId },
      { field: "teamId", operator: "==", value: expected.teamId },
      { field: "locationId", operator: "==", value: expected.locationId },
      { field: "purpose", operator: "==", value: expected.purpose },
      { field: "channel", operator: "==", value: "whatsapp" },
      { field: "category", operator: "==", value: "utility" },
    ],
    ordering: [{ field: "capturedAt", direction: "desc" }],
    maximum: 2,
  });
}

test("Phase 5 callable inputs are reparsed as exact metadata-only records", async () => {
  const automation = automationRequest(
    "start",
    1,
    "automation-start-reparse-0001",
  );
  const care = careRequest("start", 1, "care-start-reparse-00000001");
  assert.deepEqual(parseSyntheticAutomationControlInput(automation), automation);
  assert.deepEqual(parseSyntheticCareControlInput(care), care);

  for (const unsafe of [
    { ...automation, unexpected: "pollution" },
    { ...automation, action: "dispatch" },
    { ...automation, patientName: "forbidden" },
  ]) {
    const store = seedAutomationStore();
    await assert.rejects(
      controlSyntheticAutomationRun({
        db: store.db,
        config: runtimeConfig,
        emulator,
        actor: actor(AUTOMATION_ACTOR_UID),
        request: unsafe as unknown as SyntheticAutomationControlInput,
        now: NOW,
      }),
      hasCode("invalid_service_request"),
    );
    assert.equal(collectionPaths(store, AUTOMATION_COLLECTIONS.runEvents).length, 0);
  }

  for (const unsafe of [
    { ...care, unexpected: "pollution" },
    { ...care, action: "send_instructions" },
    { ...care, clinicalText: "forbidden" },
    { ...care, suppressionReason: "death" },
  ]) {
    const store = seedCareStore();
    await assert.rejects(
      controlSyntheticCareEnrollment({
        db: store.db,
        config: runtimeConfig,
        emulator,
        actor: actor(CARE_ACTOR_UID),
        request: unsafe as unknown as SyntheticCareControlInput,
        now: NOW,
      }),
      hasCode("invalid_service_request"),
    );
    assert.equal(collectionPaths(store, CARE_COLLECTIONS.enrollmentEvents).length, 0);
  }
});

test("Phase 5 operational template fixtures match the persisted canonical hashes", () => {
  assert.deepEqual(
    {
      appointment: AUTOMATION_TEMPLATE_HASH,
      careDay1En: CARE_DAY_ONE_EN_TEMPLATE.contentHash,
      careDay1Si: CARE_DAY_ONE_SI_TEMPLATE.contentHash,
      careDay1Ta: CARE_DAY_ONE_TA_TEMPLATE.contentHash,
      careDay3En: CARE_DAY_THREE_EN_TEMPLATE.contentHash,
      careDay3Si: CARE_DAY_THREE_SI_TEMPLATE.contentHash,
      careDay3Ta: CARE_DAY_THREE_TA_TEMPLATE.contentHash,
    },
    {
      appointment: "548cc18fe0d5ccd7bbc3ae637c381acd784cbea28a8538fe528474aec86e7e06",
      careDay1En: "2df838fbe5170c16fa382cc6db70ad1a78fa613a165f95632f55be90fbfb85e8",
      careDay1Si: "ef5715a5bf03c46387bc26d00db9c53dcac6244f68bc3c0db0a16926100b5a18",
      careDay1Ta: "21d3822c917b2623608e3b3b197fb39467ee0ccbe8041f72d967cfe2e7d7a287",
      careDay3En: "1f1c2c92af3e4c69b201ea6e140bfec87caf2cfc4886ac1a0a7ee1d3d71a4d67",
      careDay3Si: "286204f289a1f2a599f16ff183176d5be680c88f3b0279ae72ee5b4908915d1a",
      careDay3Ta: "117bea5281c07cea6bbcd210c69744296da492adcd0dad8116383578f9a88bca",
    },
  );
});

test("Phase 5 services require the exact synthetic loopback runtime boundary", async () => {
  const invalidConfigs: readonly RuntimeConfig[] = [
    { ...runtimeConfig, runtimeMode: "uat" },
    { ...runtimeConfig, providerMode: "live" },
    { ...runtimeConfig, hemasIntegrationMode: "disabled" },
    { ...runtimeConfig, auditSinkMode: "memory" },
    { ...runtimeConfig, outboundEnabled: true },
    { ...runtimeConfig, approvalGateRequired: false },
    { ...runtimeConfig, diagnosisEnabled: true } as unknown as RuntimeConfig,
    { ...runtimeConfig, defaultTenantId: "workspace_other_demo" },
  ];
  for (const config of invalidConfigs) {
    await assert.rejects(
      invokeAutomation({
        store: seedAutomationStore(),
        request: automationRequest("start", 1, "automation-runtime-denial-01"),
        config,
      }),
      hasCode("phase5_service_disabled"),
    );
    await assert.rejects(
      invokeCare({
        store: seedCareStore(),
        request: careRequest("start", 1, "care-runtime-denial-00001"),
        config,
      }),
      hasCode("phase5_service_disabled"),
    );
  }

  const invalidBoundaries = [
    { ...emulator, projectId: "production-project" },
    { ...emulator, firestoreEmulatorHost: undefined },
    { ...emulator, firestoreEmulatorHost: "firestore.googleapis.com:443" },
    { ...emulator, firestoreEmulatorHost: "127.0.0.1:8080/path" },
  ];
  for (const boundary of invalidBoundaries) {
    await assert.rejects(
      invokeAutomation({
        store: seedAutomationStore(),
        request: automationRequest("start", 1, "automation-boundary-denial-1"),
        boundary,
      }),
      hasCode("phase5_service_disabled"),
    );
    await assert.rejects(
      invokeCare({
        store: seedCareStore(),
        request: careRequest("start", 1, "care-boundary-denial-0001"),
        boundary,
      }),
      hasCode("phase5_service_disabled"),
    );
  }
});

test("automation run secret separates its receipt locator from its idempotency fingerprint", async () => {
  const store = seedAutomationStore();
  const secretPath = workspacePath(
    AUTOMATION_COLLECTIONS.runSecrets,
    AUTOMATION_RUN_ID,
  );
  const secret = store.records.get(secretPath);
  assert.ok(secret);
  assert.equal(secret.triggerFingerprint, automationReceiptId());
  assert.equal(secret.idempotencyFingerprint, AUTOMATION_IDEMPOTENCY_FINGERPRINT);
  assert.notEqual(secret.triggerFingerprint, secret.idempotencyFingerprint);

  const response = await invokeAutomation({
    store,
    request: automationRequest("start", 1, "automation-distinct-secret-0001"),
  });
  assert.equal(response.result.state, "running");

  const substitutedReceiptStore = seedAutomationStore();
  substitutedReceiptStore.records.set(secretPath, {
    ...substitutedReceiptStore.records.get(secretPath)!,
    triggerFingerprint: "0".repeat(64),
  });
  const beforeReceiptSubstitution = clone([...substitutedReceiptStore.records]);
  await assert.rejects(
    invokeAutomation({
      store: substitutedReceiptStore,
      request: automationRequest("start", 1, "automation-trigger-substitute-01"),
    }),
    hasCode("automation_receipt_denied"),
  );
  assert.deepEqual([...substitutedReceiptStore.records], beforeReceiptSubstitution);

  const malformedIdempotencyStore = seedAutomationStore();
  malformedIdempotencyStore.records.set(secretPath, {
    ...malformedIdempotencyStore.records.get(secretPath)!,
    idempotencyFingerprint: "f".repeat(63),
  });
  const beforeMalformedIdempotency = clone([...malformedIdempotencyStore.records]);
  await assert.rejects(
    invokeAutomation({
      store: malformedIdempotencyStore,
      request: automationRequest("start", 1, "automation-idempotency-malformed"),
    }),
    hasCode("automation_run_denied"),
  );
  assert.deepEqual([...malformedIdempotencyStore.records], beforeMalformedIdempotency);
});

test("automation receipt chronology binds activation and run creation", async () => {
  const preActivationAt = new Date("2026-08-07T09:10:00.000Z");
  const preActivationStore = seedAutomationStore({
    receipt: automationReceipt({ createdAt: preActivationAt }),
    run: automationRun({ createdAt: preActivationAt, updatedAt: preActivationAt }),
  });
  const beforePreActivation = clone([...preActivationStore.records]);
  await assert.rejects(
    invokeAutomation({
      store: preActivationStore,
      request: automationRequest("start", 1, "automation-preactivation-receipt"),
    }),
    hasCode("automation_receipt_denied"),
  );
  assert.deepEqual([...preActivationStore.records], beforePreActivation);

  const substitutedReceiptStore = seedAutomationStore({
    receipt: automationReceipt({
      createdAt: new Date("2026-08-07T09:46:00.000Z"),
    }),
  });
  const beforeTimestampSubstitution = clone([...substitutedReceiptStore.records]);
  await assert.rejects(
    invokeAutomation({
      store: substitutedReceiptStore,
      request: automationRequest("start", 1, "automation-receipt-time-substitute"),
    }),
    hasCode("automation_receipt_denied"),
  );
  assert.deepEqual([...substitutedReceiptStore.records], beforeTimestampSubstitution);
});

test("automation authorization requires role, exact assigned scope, MFA and recent auth", async () => {
  const deniedMemberships = [
    membership({
      uid: AUTOMATION_ACTOR_UID,
      role: "analyst",
      teamId: AUTOMATION_TEAM_ID,
      locationId: AUTOMATION_LOCATION_ID,
    }),
    membership({
      uid: AUTOMATION_ACTOR_UID,
      role: "supervisor",
      teamId: "team_other",
      locationId: AUTOMATION_LOCATION_ID,
    }),
    membership({
      uid: AUTOMATION_ACTOR_UID,
      role: "supervisor",
      teamId: AUTOMATION_TEAM_ID,
      locationId: AUTOMATION_LOCATION_ID,
      overrides: { mfaSatisfied: false },
    }),
    membership({
      uid: AUTOMATION_ACTOR_UID,
      role: "supervisor",
      teamId: AUTOMATION_TEAM_ID,
      locationId: AUTOMATION_LOCATION_ID,
      scopeMode: "workspace_wide",
    }),
  ];
  for (const denied of deniedMemberships) {
    const store = seedAutomationStore({ membership: denied });
    await assert.rejects(
      invokeAutomation({
        store,
        request: automationRequest("start", 1, "automation-auth-denial-0001"),
      }),
      hasCode("phase5_authorization_denied", "phase5_scope_denied"),
    );
    assert.equal(collectionPaths(store, AUTOMATION_COLLECTIONS.runEvents).length, 0);
  }

  const staleStore = seedAutomationStore({
    membership: membership({
      uid: AUTOMATION_ACTOR_UID,
      role: "supervisor",
      teamId: AUTOMATION_TEAM_ID,
      locationId: AUTOMATION_LOCATION_ID,
      overrides: {
        lastAuthenticatedAt: new Date(NOW.getTime() - 16 * 60_000),
      },
    }),
  });
  await assert.rejects(
    invokeAutomation({
      store: staleStore,
      request: automationRequest("start", 1, "automation-stale-auth-0001"),
      authAgeSeconds: 16 * 60,
    }),
    hasCode("recent_auth_required"),
  );

  const adminStore = seedAutomationStore({
    membership: membership({
      uid: AUTOMATION_ACTOR_UID,
      role: "tenant_admin",
      teamId: AUTOMATION_TEAM_ID,
      locationId: AUTOMATION_LOCATION_ID,
      scopeMode: "workspace_wide",
    }),
  });
  const result = await invokeAutomation({
    store: adminStore,
    request: automationRequest("start", 1, "automation-admin-start-0001"),
  });
  assert.equal(result.result.state, "running");
});

test("care authorization is clinical-only and requires exact assigned scope, MFA and recent auth", async () => {
  const deniedMemberships = [
    membership({
      uid: CARE_ACTOR_UID,
      role: "tenant_admin",
      teamId: CARE_TEAM_ID,
      locationId: CARE_LOCATION_ID,
      scopeMode: "workspace_wide",
    }),
    membership({
      uid: CARE_ACTOR_UID,
      role: "clinical_approver",
      teamId: "team_other",
      locationId: CARE_LOCATION_ID,
    }),
    membership({
      uid: CARE_ACTOR_UID,
      role: "clinical_approver",
      teamId: CARE_TEAM_ID,
      locationId: CARE_LOCATION_ID,
      overrides: { mfaSatisfied: false },
    }),
    membership({
      uid: CARE_ACTOR_UID,
      role: "clinical_approver",
      teamId: CARE_TEAM_ID,
      locationId: CARE_LOCATION_ID,
      scopeMode: "workspace_wide",
    }),
  ];
  for (const denied of deniedMemberships) {
    const store = seedCareStore({ membership: denied });
    await assert.rejects(
      invokeCare({
        store,
        request: careRequest("start", 1, "care-auth-denial-0000001"),
      }),
      hasCode("phase5_authorization_denied", "phase5_scope_denied"),
    );
    assert.equal(collectionPaths(store, CARE_COLLECTIONS.enrollmentEvents).length, 0);
  }

  const staleStore = seedCareStore({
    membership: membership({
      uid: CARE_ACTOR_UID,
      role: "clinical_approver",
      teamId: CARE_TEAM_ID,
      locationId: CARE_LOCATION_ID,
      overrides: {
        lastAuthenticatedAt: new Date(NOW.getTime() - 16 * 60_000),
      },
    }),
  });
  await assert.rejects(
    invokeCare({
      store: staleStore,
      request: careRequest("start", 1, "care-stale-auth-0000001"),
      authAgeSeconds: 16 * 60,
    }),
    hasCode("recent_auth_required"),
  );
});

test("care execution stays isolated from the urgent safety-hold conversation", async (t) => {
  assert.equal(
    resolveSyntheticProtectedRef(
      "demo://care/conversation/synthetic-001",
      "conversation",
    ),
    CARE_CONVERSATION_ID,
  );

  await t.test("the canonical active care route executes without mutating the urgent fixture", async () => {
    const store = seedCareStore();
    const canonicalPath = workspacePath("conversations", CARE_CONVERSATION_ID);
    const urgentPath = workspacePath(
      "conversations",
      URGENT_SAFETY_CONVERSATION_ID,
    );
    const canonical = store.records.get(canonicalPath);
    const urgent = store.records.get(urgentPath);
    assert.ok(canonical);
    assert.ok(urgent);
    assert.deepEqual(
      {
        id: canonical.id,
        status: canonical.status,
        mode: canonical.mode,
        purpose: canonical.purpose,
      },
      {
        id: CARE_CONVERSATION_ID,
        status: "active",
        mode: "automation",
        purpose: "care_pathway",
      },
    );
    assert.deepEqual(
      {
        id: urgent.id,
        status: urgent.status,
        mode: urgent.mode,
        purpose: urgent.purpose,
      },
      {
        id: URGENT_SAFETY_CONVERSATION_ID,
        status: "escalated",
        mode: "safety_hold",
        purpose: "urgent_escalation",
      },
    );
    const urgentBefore = clone(urgent);

    const response = await invokeCare({
      store,
      request: careRequest("start", 1, "care-route-isolation-start-01"),
    });

    assert.equal(response.result.state, "active");
    assert.deepEqual(store.records.get(urgentPath), urgentBefore);
  });

  await t.test("the urgent safety-hold state is denied at the mapped care execution gate", async () => {
    const store = seedCareStore();
    const canonicalPath = workspacePath("conversations", CARE_CONVERSATION_ID);
    const urgentPath = workspacePath(
      "conversations",
      URGENT_SAFETY_CONVERSATION_ID,
    );
    const urgent = store.records.get(urgentPath);
    assert.ok(urgent);
    store.records.set(canonicalPath, {
      ...clone(urgent),
      id: CARE_CONVERSATION_ID,
    });
    const before = clone([...store.records]);

    await assert.rejects(
      invokeCare({
        store,
        request: careRequest("start", 1, "care-urgent-hold-denial-01"),
      }),
      hasCode("care_contact_denied"),
    );

    assert.deepEqual([...store.records], before);
    assert.equal(store.committedWrites.length, 0);
  });
});

test("care receipt chronology binds activation, discharge and enrollment creation", async () => {
  const preActivationAt = new Date("2026-08-07T09:35:00.000Z");
  const preActivationStore = seedCareStore({
    receipt: careReceipt({ createdAt: preActivationAt }),
    enrollment: careEnrollment({ createdAt: preActivationAt, updatedAt: preActivationAt }),
  });
  const beforePreActivation = clone([...preActivationStore.records]);
  await assert.rejects(
    invokeCare({
      store: preActivationStore,
      request: careRequest("start", 1, "care-preactivation-receipt-001"),
    }),
    hasCode("care_receipt_denied"),
  );
  assert.deepEqual([...preActivationStore.records], beforePreActivation);

  const substitutedReceiptStore = seedCareStore({
    receipt: careReceipt({
      createdAt: new Date("2026-08-07T09:51:00.000Z"),
    }),
  });
  const beforeTimestampSubstitution = clone([...substitutedReceiptStore.records]);
  await assert.rejects(
    invokeCare({
      store: substitutedReceiptStore,
      request: careRequest("start", 1, "care-receipt-time-substitute-01"),
    }),
    hasCode("care_receipt_denied"),
  );
  assert.deepEqual([...substitutedReceiptStore.records], beforeTimestampSubstitution);

  const lateDischargeAt = new Date("2026-08-07T09:51:00.000Z");
  const lateDischargeStore = seedCareStore({
    receipt: careReceipt({ qualifyingDischargeAt: lateDischargeAt }),
    enrollment: careEnrollment({
      nextContactAt: new Date("2026-08-08T09:51:00.000Z"),
    }),
    enrollmentSecret: careEnrollmentSecret({
      qualifyingDischargeAt: lateDischargeAt,
    }),
  });
  const beforeLateDischarge = clone([...lateDischargeStore.records]);
  await assert.rejects(
    invokeCare({
      store: lateDischargeStore,
      request: careRequest("start", 1, "care-discharge-after-receipt-01"),
    }),
    hasCode("care_receipt_denied"),
  );
  assert.deepEqual([...lateDischargeStore.records], beforeLateDischarge);
});

test("automation requires one uniquely latest granted scoped consent decision", async (t) => {
  await t.test("a later withdrawal overrides the seeded grant", async () => {
    const store = seedAutomationStore();
    const withdrawnAt = new Date("2026-08-07T10:00:00.000Z");
    store.seed(
      workspacePath(
        "consentRecords",
        "consent_synthetic_appointment_withdrawn_later",
      ),
      consent({
        id: "consent_synthetic_appointment_withdrawn_later",
        contactId: AUTOMATION_CONTACT_ID,
        teamId: AUTOMATION_TEAM_ID,
        locationId: AUTOMATION_LOCATION_ID,
        purpose: "appointment_service",
        overrides: {
          status: "withdrawn",
          capturedAt: withdrawnAt,
          withdrawnAt,
          supersedesRecordId: AUTOMATION_CONSENT_ID,
          createdAt: withdrawnAt,
          updatedAt: withdrawnAt,
        },
      }),
    );
    const before = clone([...store.records]);
    await assert.rejects(
      invokeAutomation({
        store,
        request: automationRequest(
          "start",
          1,
          "automation-consent-withdrawn-01",
        ),
      }),
      hasCode("consent_denied"),
    );
    assert.deepEqual([...store.records], before);
    assert.equal(store.committedWrites.length, 0);
    assertLatestConsentQuery(store, {
      contactId: AUTOMATION_CONTACT_ID,
      teamId: AUTOMATION_TEAM_ID,
      locationId: AUTOMATION_LOCATION_ID,
      purpose: "appointment_service",
    });
  });

  await t.test("two decisions tied for latest are fail-closed", async () => {
    const store = seedAutomationStore();
    store.seed(
      workspacePath(
        "consentRecords",
        "consent_synthetic_appointment_tied_latest",
      ),
      consent({
        id: "consent_synthetic_appointment_tied_latest",
        contactId: AUTOMATION_CONTACT_ID,
        teamId: AUTOMATION_TEAM_ID,
        locationId: AUTOMATION_LOCATION_ID,
        purpose: "appointment_service",
        overrides: {
          capturedAt: CREATED_AT,
          supersedesRecordId: AUTOMATION_CONSENT_ID,
        },
      }),
    );
    const before = clone([...store.records]);
    await assert.rejects(
      invokeAutomation({
        store,
        request: automationRequest(
          "start",
          1,
          "automation-consent-tied-latest-01",
        ),
      }),
      hasCode("consent_denied"),
    );
    assert.deepEqual([...store.records], before);
    assert.equal(store.committedWrites.length, 0);
    assertLatestConsentQuery(store, {
      contactId: AUTOMATION_CONTACT_ID,
      teamId: AUTOMATION_TEAM_ID,
      locationId: AUTOMATION_LOCATION_ID,
      purpose: "appointment_service",
    });
  });
});

test("care requires one uniquely latest granted scoped consent decision", async (t) => {
  await t.test("a later withdrawal overrides the seeded grant", async () => {
    const store = seedCareStore();
    const withdrawnAt = new Date("2026-08-07T10:00:00.000Z");
    store.seed(
      workspacePath(
        "consentRecords",
        "consent_synthetic_care_withdrawn_later",
      ),
      consent({
        id: "consent_synthetic_care_withdrawn_later",
        contactId: CARE_CONTACT_ID,
        teamId: CARE_TEAM_ID,
        locationId: CARE_LOCATION_ID,
        purpose: "care_pathway",
        overrides: {
          status: "withdrawn",
          capturedAt: withdrawnAt,
          withdrawnAt,
          supersedesRecordId: CARE_CONSENT_ID,
          createdAt: withdrawnAt,
          updatedAt: withdrawnAt,
        },
      }),
    );
    const before = clone([...store.records]);
    await assert.rejects(
      invokeCare({
        store,
        request: careRequest(
          "start",
          1,
          "care-consent-withdrawn-later-01",
        ),
      }),
      hasCode("consent_denied"),
    );
    assert.deepEqual([...store.records], before);
    assert.equal(store.committedWrites.length, 0);
    assertLatestConsentQuery(store, {
      contactId: CARE_CONTACT_ID,
      teamId: CARE_TEAM_ID,
      locationId: CARE_LOCATION_ID,
      purpose: "care_pathway",
    });
  });

  await t.test("two decisions tied for latest are fail-closed", async () => {
    const store = seedCareStore();
    store.seed(
      workspacePath(
        "consentRecords",
        "consent_synthetic_care_tied_latest",
      ),
      consent({
        id: "consent_synthetic_care_tied_latest",
        contactId: CARE_CONTACT_ID,
        teamId: CARE_TEAM_ID,
        locationId: CARE_LOCATION_ID,
        purpose: "care_pathway",
        overrides: {
          capturedAt: CREATED_AT,
          supersedesRecordId: CARE_CONSENT_ID,
        },
      }),
    );
    const before = clone([...store.records]);
    await assert.rejects(
      invokeCare({
        store,
        request: careRequest(
          "start",
          1,
          "care-consent-tied-latest-0001",
        ),
      }),
      hasCode("consent_denied"),
    );
    assert.deepEqual([...store.records], before);
    assert.equal(store.committedWrites.length, 0);
    assertLatestConsentQuery(store, {
      contactId: CARE_CONTACT_ID,
      teamId: CARE_TEAM_ID,
      locationId: CARE_LOCATION_ID,
      purpose: "care_pathway",
    });
  });
});

test("immutable template gates reject body or variable substitution under a stale hash", async (t) => {
  await t.test("automation template body substitution", async () => {
    const store = seedAutomationStore();
    await invokeAutomation({
      store,
      request: automationRequest(
        "start",
        1,
        "automation-template-mutation-start",
      ),
    });
    const path = workspacePath("templates", AUTOMATION_TEMPLATE_ID);
    const current = store.records.get(path);
    assert.ok(current);
    const components = clone(current.components) as MemoryRecord[];
    components[1] = {
      ...components[1],
      text: "Substituted body under the approved stale hash.",
    };
    store.records.set(path, { ...current, components });
    const before = clone([...store.records]);
    await assert.rejects(
      invokeAutomation({
        store,
        request: nextAutomationRequest(
          store,
          "advance_step",
          "automation-template-mutation-run-01",
        ),
        now: new Date(NOW.getTime() + 1_000),
      }),
      hasCode("template_binding_denied"),
    );
    assert.deepEqual([...store.records], before);
  });

  await t.test("care template variable substitution", async () => {
    const store = seedCareStore();
    await invokeCare({
      store,
      request: careRequest("start", 1, "care-template-mutation-start-01"),
    });
    const path = workspacePath("templates", CARE_DAY_ONE_EN_TEMPLATE.id);
    const current = store.records.get(path);
    assert.ok(current);
    store.records.set(path, {
      ...current,
      variableRules: [
        {
          key: "synthetic_ref",
          description: "Synthetic substitution reference",
          required: true,
          maxLength: 24,
          exampleValue: "SYN-C0001",
          allowedPattern: "^SYN-C[0-9]{4}$",
        },
      ],
    });
    const before = clone([...store.records]);
    await assert.rejects(
      invokeCare({
        store,
        request: nextCareRequest(
          store,
          "advance_contact",
          "care-template-mutation-run-001",
        ),
        now: new Date(NOW.getTime() + 1_000),
      }),
      hasCode("template_binding_denied"),
    );
    assert.deepEqual([...store.records], before);
  });
});

test("automation start atomically writes its event, HMAC secret, audit and replay evidence", async () => {
  const store = seedAutomationStore();
  const baselineAudits = new Set(collectionPaths(store, "auditEvents"));
  const request = automationRequest("start", 1, "automation-start-atomic-0001");
  const response = await invokeAutomation({ store, request });

  assert.deepEqual(response.result, {
    runId: AUTOMATION_RUN_ID,
    eventId: response.result.eventId,
    action: "start",
    state: "running",
    revision: 2,
    currentStepIndex: 0,
    completedStepCount: 0,
    attemptCount: 0,
    nextEligibleAt: null,
    openWorkItemId: null,
    outcomeCode: "accepted",
    synthetic: true,
    externalDispatchCount: 0,
    networkCallCount: 0,
  });
  assert.equal(response.replayed, false);
  assert.equal(collectionPaths(store, AUTOMATION_COLLECTIONS.runEvents).length, 1);
  assert.equal(collectionPaths(store, AUTOMATION_COLLECTIONS.runEventSecrets).length, 1);
  assert.equal(collectionPaths(store, "idempotencyKeys").length, 1);
  assert.equal(newPaths(store, "auditEvents", baselineAudits).length, 1);

  const run = automationRunRecord(store);
  assert.deepEqual(
    {
      state: run.state,
      revision: run.revision,
      lastEventId: run.lastEventId,
      externalDispatchCount: run.externalDispatchCount,
      networkCallCount: run.networkCallCount,
    },
    {
      state: "running",
      revision: 2,
      lastEventId: response.result.eventId,
      externalDispatchCount: 0,
      networkCallCount: 0,
    },
  );

  const eventPath = workspacePath(
    AUTOMATION_COLLECTIONS.runEvents,
    response.result.eventId,
  );
  const secretPath = workspacePath(
    AUTOMATION_COLLECTIONS.runEventSecrets,
    response.result.eventId,
  );
  const event = store.records.get(eventPath);
  const secret = store.records.get(secretPath);
  assert.ok(event);
  assert.ok(secret);
  assert.equal(event.auditEventId, response.auditEventId);
  assert.match(String(event.evidenceFingerprint), /^[a-f0-9]{64}$/);
  assert.equal(secret.eventId, response.result.eventId);
  assert.equal(secret.runId, AUTOMATION_RUN_ID);
  assert.equal(secret.contextFingerprint, event.evidenceFingerprint);
  assert.equal(
    secret.protectedContextRef,
    `demo://automation/event-context/${response.result.eventId}`,
  );
  const audit = store.records.get(workspacePath("auditEvents", response.auditEventId));
  assert.ok(audit);
  const idempotency = singleRecord(store, "idempotencyKeys");
  assert.deepEqual(
    {
      actorUid: audit.actorUid,
      action: audit.action,
      resourceType: audit.resourceType,
      resourceId: audit.resourceId,
      outcome: audit.outcome,
      requestId: audit.requestId,
      metadata: audit.metadata,
    },
    {
      actorUid: AUTOMATION_ACTOR_UID,
      action: "automation.start",
      resourceType: "automation_run",
      resourceId: AUTOMATION_RUN_ID,
      outcome: "allowed",
      requestId: idempotency.id,
      metadata: {
        eventId: response.result.eventId,
        fromState: "queued",
        toState: "running",
        revision: 2,
        outcomeCode: "accepted",
        resultFingerprint: expectedAutomationResultFingerprint(response.result),
        synthetic: true,
        externalDispatchCount: 0,
        networkCallCount: 0,
      },
    },
  );
  assert.equal(JSON.stringify([...store.records]).includes("providerMessageId"), false);

  const committedCount = store.records.size;
  const committedWrites = store.committedWrites.length;
  const replay = await invokeAutomation({
    store,
    request,
    now: new Date(NOW.getTime() + 30_000),
  });
  assert.deepEqual(replay, { ...response, replayed: true });
  assert.equal(store.records.size, committedCount);
  assert.equal(store.committedWrites.length, committedWrites);
});

test("automation replay rejects request, event, secret and audit substitution", async () => {
  const mutations: readonly ((
    store: MemoryAdminTransactionStore,
    response: Awaited<ReturnType<typeof invokeAutomation>>,
  ) => void)[] = [
    (store) => {
      const path = collectionPaths(store, "idempotencyKeys")[0]!;
      store.records.set(path, { ...store.records.get(path)!, unexpected: "pollution" });
    },
    (store, response) => {
      const path = workspacePath(
        AUTOMATION_COLLECTIONS.runEvents,
        response.result.eventId,
      );
      store.records.set(path, { ...store.records.get(path)!, toState: "ended" });
    },
    (store, response) => {
      const path = workspacePath(
        AUTOMATION_COLLECTIONS.runEventSecrets,
        response.result.eventId,
      );
      store.records.set(path, {
        ...store.records.get(path)!,
        contextFingerprint: "0".repeat(64),
      });
    },
    (store, response) => {
      const path = workspacePath(
        AUTOMATION_COLLECTIONS.runEventSecrets,
        response.result.eventId,
      );
      store.records.set(path, {
        ...store.records.get(path)!,
        protectedContextRef: "demo://automation/event-context/substituted_event",
      });
    },
    (store, response) => {
      const path = workspacePath(
        AUTOMATION_COLLECTIONS.runEvents,
        response.result.eventId,
      );
      store.records.set(path, {
        ...store.records.get(path)!,
        actorUid: "user_demo_other_supervisor",
      });
    },
    (store, response) => {
      const path = workspacePath(
        AUTOMATION_COLLECTIONS.runEvents,
        response.result.eventId,
      );
      store.records.set(path, {
        ...store.records.get(path)!,
        reasonCode: "operator_requested",
      });
    },
    (store, response) => {
      const path = workspacePath(
        AUTOMATION_COLLECTIONS.runEvents,
        response.result.eventId,
      );
      store.records.set(path, {
        ...store.records.get(path)!,
        stepIndex: 0,
        stepId: "step_send_appointment",
      });
    },
    (store, response) => {
      const path = workspacePath(
        AUTOMATION_COLLECTIONS.runEvents,
        response.result.eventId,
      );
      store.records.set(path, {
        ...store.records.get(path)!,
        occurredAt: new Date(NOW.getTime() + 1),
      });
    },
    (store, response) => {
      const path = workspacePath("auditEvents", response.auditEventId);
      const audit = store.records.get(path)!;
      store.records.set(path, {
        ...audit,
        metadata: { ...(audit.metadata as MemoryRecord), purpose: "different" },
      });
    },
  ];

  for (const [index, mutate] of mutations.entries()) {
    const store = seedAutomationStore();
    const request = automationRequest(
      "start",
      1,
      `automation-replay-evidence-${String(index).padStart(4, "0")}`,
    );
    const response = await invokeAutomation({ store, request });
    mutate(store, response);
    const before = store.records.size;
    await assert.rejects(
      invokeAutomation({
        store,
        request,
        now: new Date(NOW.getTime() + 30_000),
      }),
      hasCode(
        "idempotency_conflict",
        "automation_event_denied",
        "automation_event_secret_denied",
        "automation_audit_denied",
      ),
    );
    assert.equal(store.records.size, before);
  }

  const store = seedAutomationStore();
  const request = automationRequest("start", 1, "automation-request-bind-0001");
  await invokeAutomation({ store, request });
  const before = store.records.size;
  await assert.rejects(
    invokeAutomation({
      store,
      request: { ...request, expectedRevision: 2 },
      now: new Date(NOW.getTime() + 30_000),
    }),
    hasCode("idempotency_conflict"),
  );
  assert.equal(store.records.size, before);
});

test("automation historical replay requires intact current evidence and its original result fingerprint", async (t) => {
  await t.test("an older key replays only while the later current event chain is intact", async () => {
    const store = seedAutomationStore();
    const oldRequest = automationRequest(
      "start",
      1,
      "automation-old-key-current-chain-01",
    );
    const historical = await invokeAutomation({ store, request: oldRequest });
    const later = await invokeAutomation({
      store,
      request: nextAutomationRequest(
        store,
        "pause",
        "automation-old-key-current-pause-1",
      ),
      now: new Date(NOW.getTime() + 1_000),
    });
    const run = automationRunRecord(store);
    assert.equal(run.lastEventId, later.result.eventId);
    const currentEventPath = workspacePath(
      AUTOMATION_COLLECTIONS.runEvents,
      later.result.eventId,
    );
    const currentSecretPath = workspacePath(
      AUTOMATION_COLLECTIONS.runEventSecrets,
      later.result.eventId,
    );
    const currentEvent = store.records.get(currentEventPath);
    assert.ok(currentEvent);
    assert.ok(store.records.has(currentSecretPath));
    assert.ok(
      store.records.has(
        workspacePath("auditEvents", String(currentEvent.auditEventId)),
      ),
    );

    const replay = await invokeAutomation({
      store,
      request: oldRequest,
      now: new Date(NOW.getTime() + 2_000),
    });
    assert.deepEqual(replay, { ...historical, replayed: true });

    store.records.set(currentEventPath, {
      ...currentEvent,
      reasonCode: "substituted_current_evidence",
    });
    const before = clone([...store.records]);
    await assert.rejects(
      invokeAutomation({
        store,
        request: oldRequest,
        now: new Date(NOW.getTime() + 3_000),
      }),
      hasCode(
        "automation_run_denied",
        "idempotency_conflict",
        "automation_audit_denied",
      ),
    );
    assert.deepEqual([...store.records], before);
  });

  await t.test("a substituted historical result fails its durable result fingerprint", async () => {
    const store = seedAutomationStore();
    const oldRequest = automationRequest(
      "start",
      1,
      "automation-old-key-result-bind-0001",
    );
    await invokeAutomation({ store, request: oldRequest });
    const oldIdempotencyPath = collectionPaths(store, "idempotencyKeys")[0]!;
    await invokeAutomation({
      store,
      request: nextAutomationRequest(
        store,
        "pause",
        "automation-old-key-result-pause-01",
      ),
      now: new Date(NOW.getTime() + 1_000),
    });
    const idempotency = store.records.get(oldIdempotencyPath);
    assert.ok(idempotency);
    const historicalResult = idempotency.result as MemoryRecord;
    store.records.set(oldIdempotencyPath, {
      ...idempotency,
      result: { ...historicalResult, completedStepCount: 1 },
    });
    const before = clone([...store.records]);
    await assert.rejects(
      invokeAutomation({
        store,
        request: oldRequest,
        now: new Date(NOW.getTime() + 2_000),
      }),
      hasCode("idempotency_conflict", "automation_audit_denied"),
    );
    assert.deepEqual([...store.records], before);
  });
});

test("deterministic automation event collisions roll back every staged write", async () => {
  const request = automationRequest("start", 1, "automation-event-collision-01");
  const probe = seedAutomationStore();
  const eventId = (await invokeAutomation({ store: probe, request })).result.eventId;

  const store = seedAutomationStore();
  store.seed(
    workspacePath(AUTOMATION_COLLECTIONS.runEvents, eventId),
    { id: eventId, collision: true },
  );
  const before = clone([...store.records]);
  await assert.rejects(
    invokeAutomation({ store, request }),
    hasCode("automation_event_collision"),
  );
  assert.deepEqual([...store.records], before);
  assert.equal(collectionPaths(store, "idempotencyKeys").length, 0);
  assert.equal(collectionPaths(store, AUTOMATION_COLLECTIONS.runEventSecrets).length, 0);
});

test("automation approved-step, wait scheduling and finality matrix is enforced", async () => {
  const store = seedAutomationStore();
  await invokeAutomation({
    store,
    request: automationRequest("start", 1, "automation-matrix-start-0001"),
    now: NOW,
  });
  const first = await invokeAutomation({
    store,
    request: nextAutomationRequest(
      store,
      "advance_step",
      "automation-matrix-send-00001",
    ),
    now: new Date(NOW.getTime() + 1_000),
  });
  assert.deepEqual(
    {
      state: first.result.state,
      currentStepIndex: first.result.currentStepIndex,
      completedStepCount: first.result.completedStepCount,
      attemptCount: first.result.attemptCount,
      outcomeCode: first.result.outcomeCode,
    },
    {
      state: "running",
      currentStepIndex: 1,
      completedStepCount: 1,
      attemptCount: 0,
      outcomeCode: "step_completed",
    },
  );
  const scheduled = await invokeAutomation({
    store,
    request: nextAutomationRequest(
      store,
      "advance_step",
      "automation-matrix-wait-00001",
    ),
    now: new Date(NOW.getTime() + 2_000),
  });
  assert.equal(scheduled.result.state, "waiting");
  assert.equal(scheduled.result.nextEligibleAt, "2026-08-07T13:00:02.000Z");

  const earlyAttemptAt = new Date("2026-08-07T12:59:59.999Z");
  refreshMembershipAuthentication(store, AUTOMATION_ACTOR_UID, earlyAttemptAt);
  const beforeEarlyAttempt = clone([...store.records]);
  await assert.rejects(
    invokeAutomation({
      store,
      request: nextAutomationRequest(
        store,
        "advance_step",
        "automation-matrix-early-0001",
      ),
      now: earlyAttemptAt,
    }),
    hasCode("automation_schedule_denied", "automation_transition_denied"),
  );
  assert.deepEqual([...store.records], beforeEarlyAttempt);

  const due = new Date("2026-08-07T13:00:02.000Z");
  refreshMembershipAuthentication(store, AUTOMATION_ACTOR_UID, due);
  const completed = await invokeAutomation({
    store,
    request: nextAutomationRequest(
      store,
      "advance_step",
      "automation-matrix-complete-01",
    ),
    now: due,
  });
  assert.deepEqual(
    {
      state: completed.result.state,
      currentStepIndex: completed.result.currentStepIndex,
      completedStepCount: completed.result.completedStepCount,
      nextEligibleAt: completed.result.nextEligibleAt,
      outcomeCode: completed.result.outcomeCode,
    },
    {
      state: "completed",
      currentStepIndex: 2,
      completedStepCount: 2,
      nextEligibleAt: null,
      outcomeCode: "completed",
    },
  );
  await assert.rejects(
    invokeAutomation({
      store,
      request: nextAutomationRequest(
        store,
        "end",
        "automation-matrix-terminal-01",
      ),
      now: new Date(due.getTime() + 1_000),
    }),
    hasCode("automation_transition_denied"),
  );
});

test("automation can pause a governed wait, resume it as accepted and finish when due", async () => {
  const store = seedAutomationStore();
  await invokeAutomation({
    store,
    request: automationRequest("start", 1, "automation-wait-pause-start-01"),
    now: NOW,
  });
  await invokeAutomation({
    store,
    request: nextAutomationRequest(
      store,
      "advance_step",
      "automation-wait-pause-send-0001",
    ),
    now: new Date(NOW.getTime() + 1_000),
  });
  const scheduled = await invokeAutomation({
    store,
    request: nextAutomationRequest(
      store,
      "advance_step",
      "automation-wait-pause-schedule-1",
    ),
    now: new Date(NOW.getTime() + 2_000),
  });
  assert.equal(scheduled.result.state, "waiting");
  assert.equal(scheduled.result.nextEligibleAt, "2026-08-07T13:00:02.000Z");

  const paused = await invokeAutomation({
    store,
    request: nextAutomationRequest(
      store,
      "pause",
      "automation-wait-pause-operator-1",
    ),
    now: new Date(NOW.getTime() + 3_000),
  });
  assert.equal(paused.result.state, "paused_by_operator");
  assert.equal(paused.result.nextEligibleAt, scheduled.result.nextEligibleAt);
  assert.equal(paused.result.outcomeCode, "accepted");

  const resumed = await invokeAutomation({
    store,
    request: nextAutomationRequest(
      store,
      "resume",
      "automation-wait-pause-resume-01",
    ),
    now: new Date(NOW.getTime() + 4_000),
  });
  assert.equal(resumed.result.state, "waiting");
  assert.equal(resumed.result.nextEligibleAt, scheduled.result.nextEligibleAt);
  assert.equal(resumed.result.outcomeCode, "accepted");
  assert.deepEqual(
    {
      state: automationRunRecord(store).state,
      pausedFromState: automationRunRecord(store).pausedFromState,
      outcomeCode: automationRunRecord(store).outcomeCode,
    },
    {
      state: "waiting",
      pausedFromState: null,
      outcomeCode: "accepted",
    },
  );

  const due = new Date("2026-08-07T13:00:02.000Z");
  refreshMembershipAuthentication(store, AUTOMATION_ACTOR_UID, due);
  const completed = await invokeAutomation({
    store,
    request: nextAutomationRequest(
      store,
      "advance_step",
      "automation-wait-pause-complete-1",
    ),
    now: due,
  });
  assert.equal(completed.result.state, "completed");
  assert.equal(completed.result.outcomeCode, "completed");
});

test("automation fallback creates and resolves exactly one governed work item", async () => {
  const store = seedAutomationStore();
  await invokeAutomation({
    store,
    request: automationRequest("start", 1, "automation-fallback-start-01"),
  });
  const fallback = await invokeAutomation({
    store,
    request: nextAutomationRequest(
      store,
      "exercise_fallback",
      "automation-fallback-create-1",
    ),
    now: new Date(NOW.getTime() + 1_000),
  });
  assert.equal(fallback.result.state, "paused_by_operator");
  assert.equal(fallback.result.outcomeCode, "fallback_work_item_created");
  assert.ok(fallback.result.openWorkItemId);
  assert.equal(collectionPaths(store, AUTOMATION_COLLECTIONS.workItems).length, 1);
  assert.equal(collectionPaths(store, AUTOMATION_COLLECTIONS.workItemSecrets).length, 1);
  const openItem = singleRecord(store, AUTOMATION_COLLECTIONS.workItems);
  assert.deepEqual(
    {
      id: openItem.id,
      state: openItem.state,
      reasonCode: openItem.reasonCode,
      runId: openItem.runId,
      revision: openItem.revision,
      lastEventId: openItem.lastEventId,
    },
    {
      id: fallback.result.openWorkItemId,
      state: "open",
      reasonCode: "fallback_route",
      runId: AUTOMATION_RUN_ID,
      revision: 1,
      lastEventId: fallback.result.eventId,
    },
  );

  const resumed = await invokeAutomation({
    store,
    request: nextAutomationRequest(store, "resume", "automation-fallback-resume-1"),
    now: new Date(NOW.getTime() + 2_000),
  });
  assert.equal(resumed.result.state, "running");
  assert.equal(resumed.result.openWorkItemId, null);
  const resolvedItem = singleRecord(store, AUTOMATION_COLLECTIONS.workItems);
  assert.equal(resolvedItem.state, "resolved");
  assert.equal(resolvedItem.resolutionCode, "retried");
  assert.equal(resolvedItem.resolvedByUid, AUTOMATION_ACTOR_UID);
});

test("automation executes each exact approved fallback without caller-selected outcomes", async () => {
  const cases = [
    {
      fallback: "create_work_item" as const,
      state: "paused_by_operator",
      outcome: "fallback_work_item_created",
      workItem: true,
    },
    {
      fallback: "route_to_human" as const,
      state: "paused_for_human",
      outcome: "human_takeover_required",
      workItem: true,
    },
    {
      fallback: "stop_run" as const,
      state: "ended",
      outcome: "fallback_stopped_safely",
      workItem: false,
    },
  ];
  for (const [index, item] of cases.entries()) {
    const store = seedAutomationFallbackStore(item.fallback);
    await invokeAutomation({
      store,
      request: automationRequest(
        "start",
        1,
        `automation-fallback-matrix-start-${index}`,
      ),
    });
    const result = await invokeAutomation({
      store,
      request: nextAutomationRequest(
        store,
        "exercise_fallback",
        `automation-fallback-matrix-run-${index}`,
      ),
      now: new Date(NOW.getTime() + 1_000),
    });
    assert.equal(result.result.state, item.state);
    assert.equal(result.result.outcomeCode, item.outcome);
    assert.equal(result.result.openWorkItemId !== null, item.workItem);
    assert.equal(
      collectionPaths(store, AUTOMATION_COLLECTIONS.workItems).length,
      item.workItem ? 1 : 0,
    );
  }
});

test("automation failure/retry and human takeover preserve exact work-item pointers", async () => {
  const failureStore = seedAutomationStore();
  await invokeAutomation({
    store: failureStore,
    request: automationRequest("start", 1, "automation-failure-start-01"),
  });
  const failed = await invokeAutomation({
    store: failureStore,
    request: nextAutomationRequest(
      failureStore,
      "inject_failure",
      "automation-inject-failure-01",
    ),
    now: new Date(NOW.getTime() + 1_000),
  });
  assert.equal(failed.result.state, "failed");
  assert.ok(failed.result.openWorkItemId);
  const retried = await invokeAutomation({
    store: failureStore,
    request: nextAutomationRequest(
      failureStore,
      "retry",
      "automation-retry-failure-001",
    ),
    now: new Date(NOW.getTime() + 2_000),
  });
  assert.equal(retried.result.state, "waiting");
  assert.equal(retried.result.nextEligibleAt, "2026-08-07T12:00:32.000Z");
  assert.equal(retried.result.openWorkItemId, null);
  assert.equal(singleRecord(failureStore, AUTOMATION_COLLECTIONS.workItems).state, "resolved");

  const takeoverStore = seedAutomationStore();
  await invokeAutomation({
    store: takeoverStore,
    request: automationRequest("start", 1, "automation-takeover-start-1"),
  });
  const takeover = await invokeAutomation({
    store: takeoverStore,
    request: nextAutomationRequest(
      takeoverStore,
      "simulate_human_takeover",
      "automation-takeover-open-01",
    ),
    now: new Date(NOW.getTime() + 1_000),
  });
  assert.equal(takeover.result.state, "paused_for_human");
  assert.ok(takeover.result.openWorkItemId);
  const release = await invokeAutomation({
    store: takeoverStore,
    request: nextAutomationRequest(
      takeoverStore,
      "release_human_takeover",
      "automation-takeover-release-1",
    ),
    now: new Date(NOW.getTime() + 2_000),
  });
  assert.equal(release.result.state, "paused_by_operator");
  assert.equal(release.result.openWorkItemId, null);
  assert.equal(
    singleRecord(takeoverStore, AUTOMATION_COLLECTIONS.workItems).resolutionCode,
    "routed_to_human",
  );
});

test("failed-origin takeover release can resume to an accepted failed run with its item bound", async () => {
  const store = seedAutomationFallbackStore("route_to_human");
  await invokeAutomation({
    store,
    request: automationRequest("start", 1, "automation-failed-takeover-start"),
    now: NOW,
  });
  const failed = await invokeAutomation({
    store,
    request: nextAutomationRequest(
      store,
      "inject_failure",
      "automation-failed-takeover-inject",
    ),
    now: new Date(NOW.getTime() + 1_000),
  });
  assert.equal(failed.result.state, "failed");
  assert.ok(failed.result.openWorkItemId);

  const takeover = await invokeAutomation({
    store,
    request: nextAutomationRequest(
      store,
      "exercise_fallback",
      "automation-failed-takeover-route-1",
    ),
    now: new Date(NOW.getTime() + 2_000),
  });
  assert.equal(takeover.result.state, "paused_for_human");
  assert.equal(takeover.result.openWorkItemId, failed.result.openWorkItemId);

  const released = await invokeAutomation({
    store,
    request: nextAutomationRequest(
      store,
      "release_human_takeover",
      "automation-failed-takeover-release",
    ),
    now: new Date(NOW.getTime() + 3_000),
  });
  assert.equal(released.result.state, "paused_by_operator");
  assert.equal(released.result.outcomeCode, "accepted");
  assert.equal(released.result.openWorkItemId, failed.result.openWorkItemId);
  assert.equal(singleRecord(store, AUTOMATION_COLLECTIONS.workItems).state, "acknowledged");

  const resumeRequest = nextAutomationRequest(
    store,
    "resume",
    "automation-failed-takeover-resume-1",
  );
  const resumed = await invokeAutomation({
    store,
    request: resumeRequest,
    now: new Date(NOW.getTime() + 4_000),
  });
  assert.equal(resumed.result.state, "failed");
  assert.equal(resumed.result.outcomeCode, "accepted");
  assert.equal(resumed.result.openWorkItemId, failed.result.openWorkItemId);
  const run = automationRunRecord(store);
  assert.equal(run.pausedFromState, null);
  assert.equal(run.openWorkItemId, failed.result.openWorkItemId);
  assert.equal(singleRecord(store, AUTOMATION_COLLECTIONS.workItems).state, "acknowledged");

  const replay = await invokeAutomation({
    store,
    request: resumeRequest,
    now: new Date(NOW.getTime() + 5_000),
  });
  assert.deepEqual(replay, { ...resumed, replayed: true });
});

test("care start atomically writes its event, secret, audit and replay evidence", async () => {
  const store = seedCareStore();
  const baselineAudits = new Set(collectionPaths(store, "auditEvents"));
  const request = careRequest("start", 1, "care-start-atomic-00000001");
  const response = await invokeCare({ store, request });

  assert.deepEqual(response.result, {
    enrollmentId: CARE_ENROLLMENT_ID,
    eventId: response.result.eventId,
    action: "start",
    state: "active",
    revision: 2,
    nextContactIndex: 0,
    nextContactAt: CARE_DAY_ONE_AT.toISOString(),
    openEscalationId: null,
    safetyHoldEscalationId: null,
    openHandoffId: null,
    outcomeCode: "accepted",
    synthetic: true,
    externalDispatchCount: 0,
    networkCallCount: 0,
  });
  assert.equal(response.replayed, false);
  assert.equal(collectionPaths(store, CARE_COLLECTIONS.enrollmentEvents).length, 1);
  assert.equal(
    collectionPaths(store, CARE_COLLECTIONS.enrollmentEventSecrets).length,
    1,
  );
  assert.equal(collectionPaths(store, "idempotencyKeys").length, 1);
  assert.equal(newPaths(store, "auditEvents", baselineAudits).length, 1);

  const eventPath = workspacePath(
    CARE_COLLECTIONS.enrollmentEvents,
    response.result.eventId,
  );
  const secretPath = workspacePath(
    CARE_COLLECTIONS.enrollmentEventSecrets,
    response.result.eventId,
  );
  const event = store.records.get(eventPath);
  const secret = store.records.get(secretPath);
  assert.ok(event);
  assert.ok(secret);
  assert.equal(event.auditEventId, response.auditEventId);
  assert.equal(secret.eventId, response.result.eventId);
  assert.equal(secret.enrollmentId, CARE_ENROLLMENT_ID);
  assert.match(String(secret.contextFingerprint), /^[a-f0-9]{64}$/);
  assert.equal(
    secret.protectedContextRef,
    `demo://care/event-context/${response.result.eventId}`,
  );
  const audit = store.records.get(workspacePath("auditEvents", response.auditEventId));
  assert.ok(audit);
  const idempotency = singleRecord(store, "idempotencyKeys");
  assert.deepEqual(
    {
      actorUid: audit.actorUid,
      action: audit.action,
      resourceType: audit.resourceType,
      resourceId: audit.resourceId,
      outcome: audit.outcome,
      requestId: audit.requestId,
      metadata: audit.metadata,
    },
    {
      actorUid: CARE_ACTOR_UID,
      action: "care_enrollment.start",
      resourceType: "care_enrollment",
      resourceId: CARE_ENROLLMENT_ID,
      outcome: "allowed",
      requestId: idempotency.id,
      metadata: {
        eventId: response.result.eventId,
        fromState: "queued",
        toState: "active",
        revision: 2,
        outcomeCode: "accepted",
        resultFingerprint: expectedCareResultFingerprint(response.result),
        synthetic: true,
        externalDispatchCount: 0,
        networkCallCount: 0,
      },
    },
  );

  const count = store.records.size;
  const writes = store.committedWrites.length;
  const replay = await invokeCare({
    store,
    request,
    now: new Date(NOW.getTime() + 30_000),
  });
  assert.deepEqual(replay, { ...response, replayed: true });
  assert.equal(store.records.size, count);
  assert.equal(store.committedWrites.length, writes);
});

test("care replay rejects request, event, secret and audit substitution", async () => {
  const mutations: readonly ((
    store: MemoryAdminTransactionStore,
    response: Awaited<ReturnType<typeof invokeCare>>,
  ) => void)[] = [
    (store) => {
      const path = collectionPaths(store, "idempotencyKeys")[0]!;
      store.records.set(path, { ...store.records.get(path)!, unexpected: "pollution" });
    },
    (store, response) => {
      const path = workspacePath(
        CARE_COLLECTIONS.enrollmentEvents,
        response.result.eventId,
      );
      store.records.set(path, { ...store.records.get(path)!, toState: "ended" });
    },
    (store, response) => {
      const path = workspacePath(
        CARE_COLLECTIONS.enrollmentEventSecrets,
        response.result.eventId,
      );
      store.records.set(path, {
        ...store.records.get(path)!,
        contextFingerprint: "0".repeat(64),
      });
    },
    (store, response) => {
      const path = workspacePath(
        CARE_COLLECTIONS.enrollmentEventSecrets,
        response.result.eventId,
      );
      store.records.set(path, {
        ...store.records.get(path)!,
        protectedContextRef: "demo://care/event-context/substituted_event",
      });
    },
    (store, response) => {
      const path = workspacePath(
        CARE_COLLECTIONS.enrollmentEvents,
        response.result.eventId,
      );
      store.records.set(path, {
        ...store.records.get(path)!,
        actorUid: "user_demo_other_clinical_approver",
      });
    },
    (store, response) => {
      const path = workspacePath(
        CARE_COLLECTIONS.enrollmentEvents,
        response.result.eventId,
      );
      store.records.set(path, {
        ...store.records.get(path)!,
        activeSuppressionsAfter: ["clinical_hold"],
      });
    },
    (store, response) => {
      const path = workspacePath(
        CARE_COLLECTIONS.enrollmentEvents,
        response.result.eventId,
      );
      store.records.set(path, {
        ...store.records.get(path)!,
        escalationStateBefore: "open",
      });
    },
    (store, response) => {
      const path = workspacePath(
        CARE_COLLECTIONS.enrollmentEvents,
        response.result.eventId,
      );
      store.records.set(path, {
        ...store.records.get(path)!,
        actorKind: "system",
      });
    },
    (store, response) => {
      const path = workspacePath(
        CARE_COLLECTIONS.enrollmentEvents,
        response.result.eventId,
      );
      store.records.set(path, {
        ...store.records.get(path)!,
        pathwayId: "care_pathway_substituted_v9",
        pathwayProtocolVersion: "v9.9",
        pathwayContentHash: "0".repeat(64),
      });
    },
    (store, response) => {
      const path = workspacePath(
        CARE_COLLECTIONS.enrollmentEvents,
        response.result.eventId,
      );
      store.records.set(path, {
        ...store.records.get(path)!,
        nextContactAt: null,
      });
    },
    (store, response) => {
      const path = workspacePath("auditEvents", response.auditEventId);
      const audit = store.records.get(path)!;
      store.records.set(path, { ...audit, outcome: "denied" });
    },
  ];

  for (const [index, mutate] of mutations.entries()) {
    const store = seedCareStore();
    const request = careRequest(
      "start",
      1,
      `care-replay-evidence-${String(index).padStart(8, "0")}`,
    );
    const response = await invokeCare({ store, request });
    mutate(store, response);
    const before = store.records.size;
    await assert.rejects(
      invokeCare({
        store,
        request,
        now: new Date(NOW.getTime() + 30_000),
      }),
      hasCode(
        "idempotency_conflict",
        "care_enrollment_denied",
        "care_event_denied",
        "care_event_secret_denied",
        "care_audit_denied",
      ),
    );
    assert.equal(store.records.size, before);
  }

  const store = seedCareStore();
  const request = careRequest("start", 1, "care-request-bind-00000001");
  await invokeCare({ store, request });
  const before = store.records.size;
  await assert.rejects(
    invokeCare({
      store,
      request: { ...request, expectedRevision: 2 },
      now: new Date(NOW.getTime() + 30_000),
    }),
    hasCode("idempotency_conflict"),
  );
  assert.equal(store.records.size, before);
});

test("care historical replay requires intact current evidence and its original result fingerprint", async (t) => {
  await t.test("an older key replays only while the later current event chain is intact", async () => {
    const store = seedCareStore();
    const oldRequest = careRequest(
      "start",
      1,
      "care-old-key-current-chain-00001",
    );
    const historical = await invokeCare({ store, request: oldRequest });
    const later = await invokeCare({
      store,
      request: nextCareRequest(
        store,
        "pause",
        "care-old-key-current-pause-0001",
      ),
      now: new Date(NOW.getTime() + 1_000),
    });
    const enrollment = careEnrollmentRecord(store);
    assert.equal(enrollment.lastEventId, later.result.eventId);
    const currentEventPath = workspacePath(
      CARE_COLLECTIONS.enrollmentEvents,
      later.result.eventId,
    );
    const currentSecretPath = workspacePath(
      CARE_COLLECTIONS.enrollmentEventSecrets,
      later.result.eventId,
    );
    const currentEvent = store.records.get(currentEventPath);
    assert.ok(currentEvent);
    assert.ok(store.records.has(currentSecretPath));
    assert.ok(
      store.records.has(
        workspacePath("auditEvents", String(currentEvent.auditEventId)),
      ),
    );

    const replay = await invokeCare({
      store,
      request: oldRequest,
      now: new Date(NOW.getTime() + 2_000),
    });
    assert.deepEqual(replay, { ...historical, replayed: true });

    const enrollmentPath = workspacePath(
      CARE_COLLECTIONS.enrollments,
      CARE_ENROLLMENT_ID,
    );
    store.records.set(enrollmentPath, {
      ...careEnrollmentRecord(store),
      lastEventId: historical.result.eventId,
    });
    const before = clone([...store.records]);
    await assert.rejects(
      invokeCare({
        store,
        request: oldRequest,
        now: new Date(NOW.getTime() + 3_000),
      }),
      hasCode(
        "care_enrollment_denied",
        "idempotency_conflict",
        "care_audit_denied",
      ),
    );
    assert.deepEqual([...store.records], before);
  });

  await t.test("a substituted historical result fails its durable result fingerprint", async () => {
    const store = seedCareStore();
    const oldRequest = careRequest(
      "start",
      1,
      "care-old-key-result-bind-000001",
    );
    await invokeCare({ store, request: oldRequest });
    const oldIdempotencyPath = collectionPaths(store, "idempotencyKeys")[0]!;
    await invokeCare({
      store,
      request: nextCareRequest(
        store,
        "pause",
        "care-old-key-result-pause-001",
      ),
      now: new Date(NOW.getTime() + 1_000),
    });
    const idempotency = store.records.get(oldIdempotencyPath);
    assert.ok(idempotency);
    const historicalResult = idempotency.result as MemoryRecord;
    store.records.set(oldIdempotencyPath, {
      ...idempotency,
      result: { ...historicalResult, nextContactIndex: 1 },
    });
    const before = clone([...store.records]);
    await assert.rejects(
      invokeCare({
        store,
        request: oldRequest,
        now: new Date(NOW.getTime() + 2_000),
      }),
      hasCode("idempotency_conflict", "care_audit_denied"),
    );
    assert.deepEqual([...store.records], before);
  });
});

test("deterministic care event collisions roll back every staged write", async () => {
  const request = careRequest("start", 1, "care-event-collision-00001");
  const probe = seedCareStore();
  const eventId = (await invokeCare({ store: probe, request })).result.eventId;

  const store = seedCareStore();
  store.seed(
    workspacePath(CARE_COLLECTIONS.enrollmentEvents, eventId),
    { id: eventId, collision: true },
  );
  const before = clone([...store.records]);
  await assert.rejects(
    invokeCare({ store, request }),
    hasCode("care_event_collision"),
  );
  assert.deepEqual([...store.records], before);
  assert.equal(collectionPaths(store, "idempotencyKeys").length, 0);
  assert.equal(collectionPaths(store, CARE_COLLECTIONS.enrollmentEventSecrets).length, 0);
});

test("care contacts are receipt-anchored, due-time gated and final at the approved last point", async () => {
  const store = seedCareStore();
  await invokeCare({
    store,
    request: careRequest("start", 1, "care-schedule-start-00001"),
    now: NOW,
  });
  const first = await invokeCare({
    store,
    request: nextCareRequest(
      store,
      "advance_contact",
      "care-schedule-day-one-0001",
    ),
    now: new Date(NOW.getTime() + 1_000),
  });
  assert.deepEqual(
    {
      state: first.result.state,
      nextContactIndex: first.result.nextContactIndex,
      nextContactAt: first.result.nextContactAt,
      outcomeCode: first.result.outcomeCode,
    },
    {
      state: "active",
      nextContactIndex: 1,
      nextContactAt: CARE_DAY_THREE_AT.toISOString(),
      outcomeCode: "contact_advanced",
    },
  );

  const earlyAttemptAt = new Date("2026-08-08T09:00:00.000Z");
  refreshMembershipAuthentication(store, CARE_ACTOR_UID, earlyAttemptAt);
  const beforeEarlyAttempt = clone([...store.records]);
  await assert.rejects(
    invokeCare({
      store,
      request: nextCareRequest(
        store,
        "advance_contact",
        "care-schedule-too-early-01",
      ),
      now: earlyAttemptAt,
    }),
    hasCode("care_schedule_denied", "care_transition_denied"),
  );
  assert.deepEqual([...store.records], beforeEarlyAttempt);

  refreshMembershipAuthentication(store, CARE_ACTOR_UID, CARE_DAY_THREE_AT);
  const completed = await invokeCare({
    store,
    request: nextCareRequest(
      store,
      "advance_contact",
      "care-schedule-final-000001",
    ),
    now: CARE_DAY_THREE_AT,
  });
  assert.deepEqual(
    {
      state: completed.result.state,
      nextContactIndex: completed.result.nextContactIndex,
      nextContactAt: completed.result.nextContactAt,
      outcomeCode: completed.result.outcomeCode,
    },
    {
      state: "completed",
      nextContactIndex: 2,
      nextContactAt: null,
      outcomeCode: "completed",
    },
  );
  await assert.rejects(
    invokeCare({
      store,
      request: nextCareRequest(store, "end", "care-schedule-terminal-0001"),
      now: new Date(CARE_DAY_THREE_AT.getTime() + 1_000),
    }),
    hasCode("care_transition_denied"),
  );
});

test("care schedule rejects discharge-anchor, receipt and pathway-finality substitution", async () => {
  const variants = [
    seedCareStore({
      enrollmentSecret: careEnrollmentSecret({
        qualifyingDischargeAt: new Date(CARE_DISCHARGE_AT.getTime() + 1_000),
      }),
    }),
    seedCareStore({
      receipt: careReceipt({
        qualifyingDischargeAt: new Date(CARE_DISCHARGE_AT.getTime() + 1_000),
      }),
    }),
    seedCareStore({
      pathway: carePathway({
        contactPoints: [careContactPoints[0]],
      }),
    }),
    seedCareStore({
      receipt: careReceipt({
        pathwayApprovalHash: "0".repeat(64),
      }),
    }),
  ];
  for (const [index, store] of variants.entries()) {
    const before = clone([...store.records]);
    await assert.rejects(
      invokeCare({
        store,
        request: careRequest(
          "start",
          1,
          `care-anchor-substitution-${String(index).padStart(4, "0")}`,
        ),
      }),
      hasCode(
        "care_receipt_denied",
        "care_enrollment_denied",
        "care_pathway_denied",
        "care_schedule_denied",
      ),
    );
    assert.deepEqual([...store.records], before);
  }
});

test("care suppression matrix retains clinical holds and terminal reasons exactly", async () => {
  const holdStore = seedCareStore();
  await invokeCare({
    store: holdStore,
    request: careRequest("start", 1, "care-hold-start-0000001"),
  });
  const held = await invokeCare({
    store: holdStore,
    request: nextCareRequest(
      holdStore,
      "simulate_suppression",
      "care-hold-apply-0000001",
      "clinical_hold",
    ),
    now: new Date(NOW.getTime() + 1_000),
  });
  assert.equal(held.result.state, "paused_for_safety");
  assert.equal(held.result.outcomeCode, "clinical_hold_applied");
  assert.deepEqual(careEnrollmentRecord(holdStore).activeSuppressions, [
    "clinical_hold",
  ]);
  const cleared = await invokeCare({
    store: holdStore,
    request: nextCareRequest(
      holdStore,
      "clear_clinical_hold",
      "care-hold-clear-0000001",
    ),
    now: new Date(NOW.getTime() + 2_000),
  });
  assert.equal(cleared.result.state, "paused_by_operator");
  assert.deepEqual(careEnrollmentRecord(holdStore).activeSuppressions, []);

  const terminalStore = seedCareStore();
  const terminal = await invokeCare({
    store: terminalStore,
    request: careRequest(
      "simulate_suppression",
      1,
      "care-terminal-death-000001",
      "death",
    ),
  });
  assert.equal(terminal.result.state, "ended");
  assert.equal(terminal.result.nextContactAt, null);
  assert.equal(terminal.result.outcomeCode, "suppressed_terminal");
  assert.deepEqual(careEnrollmentRecord(terminalStore).activeSuppressions, ["death"]);
});

test("care human takeover creates one handoff and releases it before operator resume", async () => {
  const store = seedCareStore();
  await invokeCare({
    store,
    request: careRequest("start", 1, "care-handoff-start-00001"),
  });
  const takeover = await invokeCare({
    store,
    request: nextCareRequest(
      store,
      "human_takeover_started",
      "care-handoff-open-0000001",
    ),
    now: new Date(NOW.getTime() + 1_000),
  });
  assert.equal(takeover.result.state, "paused_for_human");
  assert.ok(takeover.result.openHandoffId);
  assert.equal(collectionPaths(store, CARE_COLLECTIONS.handoffs).length, 1);
  const open = singleRecord(store, CARE_COLLECTIONS.handoffs);
  assert.deepEqual(
    {
      id: open.id,
      state: open.state,
      enrollmentId: open.enrollmentId,
      revision: open.revision,
      openedEventId: open.openedEventId,
      lastEventId: open.lastEventId,
    },
    {
      id: takeover.result.openHandoffId,
      state: "open",
      enrollmentId: CARE_ENROLLMENT_ID,
      revision: 1,
      openedEventId: takeover.result.eventId,
      lastEventId: takeover.result.eventId,
    },
  );

  const release = await invokeCare({
    store,
    request: nextCareRequest(
      store,
      "release_human_takeover",
      "care-handoff-release-0001",
    ),
    now: new Date(NOW.getTime() + 2_000),
  });
  assert.equal(release.result.state, "paused_by_operator");
  assert.equal(release.result.openHandoffId, null);
  const released = singleRecord(store, CARE_COLLECTIONS.handoffs);
  assert.equal(released.state, "released");
  assert.equal(released.releasedEventId, release.result.eventId);
  assert.equal(released.releasedByUid ?? (released.releasedBy as MemoryRecord)?.actorUid, CARE_ACTOR_UID);

  const resumed = await invokeCare({
    store,
    request: nextCareRequest(store, "resume", "care-handoff-resume-00001"),
    now: new Date(NOW.getTime() + 3_000),
  });
  assert.equal(resumed.result.state, "active");
});

test("care escalation requires acknowledgement, retains a safety pointer and clears it explicitly", async () => {
  const store = seedCareStore();
  await invokeCare({
    store,
    request: careRequest("start", 1, "care-escalation-start-001"),
  });
  const raised = await invokeCare({
    store,
    request: nextCareRequest(
      store,
      "raise_red_flag",
      "care-escalation-raise-0001",
    ),
    now: new Date(NOW.getTime() + 1_000),
  });
  assert.equal(raised.result.state, "escalated");
  assert.ok(raised.result.openEscalationId);
  assert.equal(collectionPaths(store, CARE_COLLECTIONS.escalations).length, 1);
  assert.equal(collectionPaths(store, CARE_COLLECTIONS.escalationSecrets).length, 1);
  assert.equal(singleRecord(store, CARE_COLLECTIONS.escalations).state, "open");

  const beforePrematureResolve = clone([...store.records]);
  await assert.rejects(
    invokeCare({
      store,
      request: nextCareRequest(
        store,
        "resolve_escalation",
        "care-escalation-early-resolve",
      ),
      now: new Date(NOW.getTime() + 2_000),
    }),
    hasCode("care_transition_denied", "care_escalation_denied"),
  );
  assert.deepEqual([...store.records], beforePrematureResolve);

  const acknowledged = await invokeCare({
    store,
    request: nextCareRequest(
      store,
      "acknowledge_escalation",
      "care-escalation-ack-00001",
    ),
    now: new Date(NOW.getTime() + 3_000),
  });
  assert.equal(acknowledged.result.state, "escalated");
  assert.equal(singleRecord(store, CARE_COLLECTIONS.escalations).state, "acknowledged");

  const resolved = await invokeCare({
    store,
    request: nextCareRequest(
      store,
      "resolve_escalation",
      "care-escalation-resolve-01",
    ),
    now: new Date(NOW.getTime() + 4_000),
  });
  assert.equal(resolved.result.state, "paused_for_safety");
  assert.equal(resolved.result.openEscalationId, null);
  assert.equal(resolved.result.safetyHoldEscalationId, raised.result.openEscalationId);
  const escalation = singleRecord(store, CARE_COLLECTIONS.escalations);
  assert.equal(escalation.state, "resolved");
  assert.equal(escalation.resolutionCode, "safety_hold_applied");
  assert.equal(escalation.writeBackState, "unavailable_in_demo");

  const cleared = await invokeCare({
    store,
    request: nextCareRequest(
      store,
      "clear_safety_hold",
      "care-escalation-clear-0001",
    ),
    now: new Date(NOW.getTime() + 5_000),
  });
  assert.equal(cleared.result.state, "paused_by_operator");
  assert.equal(cleared.result.safetyHoldEscalationId, null);
  assert.equal(collectionPaths(store, CARE_COLLECTIONS.escalations).length, 1);
});

test("care clears a clinical hold without discarding its resolved escalation safety hold", async () => {
  const store = seedCareStore();
  await invokeCare({
    store,
    request: careRequest("start", 1, "care-combined-hold-start-00001"),
    now: NOW,
  });
  await invokeCare({
    store,
    request: nextCareRequest(
      store,
      "simulate_suppression",
      "care-combined-hold-apply-00001",
      "clinical_hold",
    ),
    now: new Date(NOW.getTime() + 1_000),
  });
  const raised = await invokeCare({
    store,
    request: nextCareRequest(
      store,
      "raise_red_flag",
      "care-combined-hold-raise-00001",
    ),
    now: new Date(NOW.getTime() + 2_000),
  });
  await invokeCare({
    store,
    request: nextCareRequest(
      store,
      "acknowledge_escalation",
      "care-combined-hold-ack-0000001",
    ),
    now: new Date(NOW.getTime() + 3_000),
  });
  const resolved = await invokeCare({
    store,
    request: nextCareRequest(
      store,
      "resolve_escalation",
      "care-combined-hold-resolve-001",
    ),
    now: new Date(NOW.getTime() + 4_000),
  });
  assert.equal(resolved.result.state, "paused_for_safety");
  assert.equal(resolved.result.safetyHoldEscalationId, raised.result.openEscalationId);
  assert.deepEqual(careEnrollmentRecord(store).activeSuppressions, ["clinical_hold"]);

  const holdCleared = await invokeCare({
    store,
    request: nextCareRequest(
      store,
      "clear_clinical_hold",
      "care-combined-hold-clear-00001",
    ),
    now: new Date(NOW.getTime() + 5_000),
  });
  assert.equal(holdCleared.result.state, "paused_for_safety");
  assert.equal(holdCleared.result.outcomeCode, "safety_hold_cleared");
  assert.equal(holdCleared.result.safetyHoldEscalationId, raised.result.openEscalationId);
  assert.deepEqual(careEnrollmentRecord(store).activeSuppressions, []);

  const safetyCleared = await invokeCare({
    store,
    request: nextCareRequest(
      store,
      "clear_safety_hold",
      "care-combined-safety-clear-0001",
    ),
    now: new Date(NOW.getTime() + 6_000),
  });
  assert.equal(safetyCleared.result.state, "paused_by_operator");
  assert.equal(safetyCleared.result.outcomeCode, "safety_hold_cleared");
  assert.equal(safetyCleared.result.safetyHoldEscalationId, null);
  assert.equal(singleRecord(store, CARE_COLLECTIONS.escalations).state, "resolved");
});

test("all Phase 5 control evidence remains synthetic, bounded and zero-network", async () => {
  const automationStore = seedAutomationStore();
  const automationResponse = await invokeAutomation({
    store: automationStore,
    request: automationRequest("start", 1, "automation-zero-network-0001"),
  });
  const careStore = seedCareStore();
  const careResponse = await invokeCare({
    store: careStore,
    request: careRequest("start", 1, "care-zero-network-0000001"),
  });
  assert.equal(automationResponse.result.externalDispatchCount, 0);
  assert.equal(automationResponse.result.networkCallCount, 0);
  assert.equal(careResponse.result.externalDispatchCount, 0);
  assert.equal(careResponse.result.networkCallCount, 0);

  for (const store of [automationStore, careStore]) {
    const serialized = JSON.stringify([...store.records]);
    assert.doesNotMatch(
      serialized,
      /providerMessageId|wamid|patientName|diagnosis|prescription|medication/i,
    );
    for (const [, record] of store.records) {
      if ("externalDispatchCount" in record) {
        assert.equal(record.externalDispatchCount, 0);
      }
      if ("networkCallCount" in record) {
        assert.equal(record.networkCallCount, 0);
      }
    }
  }
});
