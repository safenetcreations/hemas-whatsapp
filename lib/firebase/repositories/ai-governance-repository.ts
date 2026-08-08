import {
  Timestamp,
  doc,
  getDocFromServer,
  type Firestore,
} from "firebase/firestore";

import {
  AI_GOVERNANCE_EVALUATED_AT,
  AI_GOVERNANCE_SELECTOR_VERSION_ID,
  AI_GOVERNANCE_WORKSPACE_ID,
  AI_KNOWLEDGE_DOCUMENT_IDS,
  AI_KNOWLEDGE_DOCUMENT_MATRIX,
  AI_KNOWLEDGE_SELECTION_IDS,
  AI_KNOWLEDGE_SELECTION_MATRIX,
  AI_PERSISTED_SCENARIO_IDS,
  AI_PERSISTED_SCENARIO_MATRIX,
  assertStaffSafeAiKnowledgeDocumentV1,
  assertStaffSafeAiKnowledgeSelectionV1,
  assertStaffSafeAiRetrospectiveEventV1,
  assertStaffSafeAiRetrospectiveRunV1,
  serializeAiKnowledgeApprovalV1,
  serializeAiKnowledgeContentV1,
  serializeAiKnowledgeSelectionV1,
  serializeAiRetrospectiveRunV1,
  type AiKnowledgeApprovalBindingV1,
  type AiKnowledgeContentBindingV1,
  type AiKnowledgeDocumentId,
  type AiKnowledgeSelectionBindingV1,
  type AiKnowledgeSelectionId,
  type AiPersistedScenarioId,
  type StaffSafeAiKnowledgeDocumentV1,
  type StaffSafeAiKnowledgeSelectionV1,
  type StaffSafeAiRetrospectiveEventV1,
  type StaffSafeAiRetrospectiveRunV1,
} from "../../domain/ai-governance";

export const AI_GOVERNANCE_COLLECTIONS = Object.freeze({
  knowledgeDocuments: "knowledgeDocuments",
  knowledgeSelections: "knowledgeSelections",
  knowledgeDocumentSecrets: "knowledgeDocumentSecrets",
  retrospectiveRuns: "aiRuns",
  retrospectiveEvents: "aiRunEvents",
  retrospectiveRunSecrets: "aiRunSecrets",
  retrospectiveEventSecrets: "aiRunEventSecrets",
  idempotencyReceipts: "idempotencyKeys",
  auditEvents: "auditEvents",
} as const);

/**
 * Public knowledge timestamps are historical lifecycle metadata. The secret and
 * selection timestamps are immutable server-persistence times and therefore
 * remain strictly later than the frozen retrospective evaluation instant.
 */
export const AI_GOVERNANCE_SEED_TIMESTAMPS = Object.freeze({
  knowledgeCreatedAt: "2026-06-01T00:00:00.000Z",
  knowledgeUpdatedAt: "2026-08-08T00:00:00.000Z",
  knowledgeSecretCreatedAt: "2026-08-08T00:00:00.000Z",
  knowledgeSelectionCreatedAt: "2026-08-08T00:10:00.000Z",
} as const);

export type AiGovernanceReadRole =
  | "tenant_admin"
  | "privacy_reviewer"
  | "supervisor"
  | "clinical_approver";

export interface AiGovernanceRoleReadPlan {
  readonly role: AiGovernanceReadRole;
  readonly knowledgeDocumentIds: readonly AiKnowledgeDocumentId[];
  readonly knowledgeSelectionIds: readonly AiKnowledgeSelectionId[];
  readonly scenarioIds: readonly AiPersistedScenarioId[];
}

function frozenPlan(
  role: AiGovernanceReadRole,
  knowledgeDocumentIds: readonly AiKnowledgeDocumentId[],
  knowledgeSelectionIds: readonly AiKnowledgeSelectionId[],
  scenarioIds: readonly AiPersistedScenarioId[],
): AiGovernanceRoleReadPlan {
  return Object.freeze({
    role,
    knowledgeDocumentIds: Object.freeze([...knowledgeDocumentIds]),
    knowledgeSelectionIds: Object.freeze([...knowledgeSelectionIds]),
    scenarioIds: Object.freeze([...scenarioIds]),
  });
}

/**
 * Authorization and assigned patient scope stay outside this repository. These
 * plans only bound which canonical exact reads an already-authorized caller may
 * request; the repository never broadens, queries, lists, or caches them.
 */
export const AI_GOVERNANCE_ROLE_READ_PLANS = Object.freeze({
  tenant_admin: frozenPlan(
    "tenant_admin",
    AI_KNOWLEDGE_DOCUMENT_IDS,
    AI_KNOWLEDGE_SELECTION_IDS,
    AI_PERSISTED_SCENARIO_IDS,
  ),
  privacy_reviewer: frozenPlan(
    "privacy_reviewer",
    AI_KNOWLEDGE_DOCUMENT_IDS,
    AI_KNOWLEDGE_SELECTION_IDS,
    [],
  ),
  supervisor: frozenPlan(
    "supervisor",
    ["kn-appointments-v3", "kn-package-draft", "kn-old-hours"],
    ["knowledge_selection_appointments_v3"],
    ["appointment", "mixed", "stop"],
  ),
  clinical_approver: frozenPlan(
    "clinical_approver",
    ["kn-labs-v2", "kn-urgent-v5"],
    ["knowledge_selection_labs_v2", "knowledge_selection_urgent_v5"],
    ["urgent"],
  ),
} as const satisfies Readonly<Record<AiGovernanceReadRole, AiGovernanceRoleReadPlan>>);

export interface LoadAiGovernanceEvidenceInput {
  readonly workspaceId: typeof AI_GOVERNANCE_WORKSPACE_ID;
  readonly plan: AiGovernanceRoleReadPlan;
}

export interface AiGovernanceReadyProjection {
  readonly status: "ready";
  readonly documents: readonly StaffSafeAiKnowledgeDocumentV1[];
  readonly selections: readonly StaffSafeAiKnowledgeSelectionV1[];
}

export interface AiGovernanceNotSeededProjection {
  readonly status: "not_seeded";
  readonly documents: readonly [];
  readonly selections: readonly [];
}

export type AiGovernanceProjection =
  | AiGovernanceReadyProjection
  | AiGovernanceNotSeededProjection;

export interface AiGovernanceRecordedScenarioProjection {
  readonly scenarioId: AiPersistedScenarioId;
  readonly status: "recorded";
  readonly run: StaffSafeAiRetrospectiveRunV1;
  readonly event: StaffSafeAiRetrospectiveEventV1;
}

export interface AiGovernanceNotRecordedScenarioProjection {
  readonly scenarioId: AiPersistedScenarioId;
  readonly status: "not_recorded";
  readonly run: null;
  readonly event: null;
}

export type AiGovernanceScenarioProjection =
  | AiGovernanceRecordedScenarioProjection
  | AiGovernanceNotRecordedScenarioProjection;

export interface AiGovernanceEvidenceDTO {
  readonly role: AiGovernanceReadRole;
  readonly governance: AiGovernanceProjection;
  readonly scenarios: readonly AiGovernanceScenarioProjection[];
}

export class AiGovernanceRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_input" | "invalid_persisted_data" | "integrity_error",
  ) {
    super(message);
    this.name = "AiGovernanceRepositoryError";
  }
}

const KNOWLEDGE_DOCUMENT_KEYS = [
  "id",
  "workspaceId",
  "title",
  "version",
  "language",
  "contentKind",
  "ownerUid",
  "approverUid",
  "approvalState",
  "approvalScope",
  "approvedAt",
  "evaluatedAt",
  "effectiveFrom",
  "effectiveUntil",
  "contentFingerprint",
  "approvalFingerprint",
  "synthetic",
  "schemaVersion",
  "createdAt",
  "updatedAt",
] as const;

const KNOWLEDGE_SELECTION_KEYS = [
  "selectionId",
  "workspaceId",
  "documentId",
  "contentFingerprint",
  "approvalFingerprint",
  "selectorVersionId",
  "selectedAt",
  "evaluatedAt",
  "selectionScope",
  "effectiveFrom",
  "effectiveUntil",
  "synthetic",
  "selectionFingerprint",
  "schemaVersion",
  "createdAt",
] as const;

const DECISION_KEYS = [
  "decision",
  "reasonCodes",
  "unsupportedClaim",
  "clinicalSafety",
  "privacy",
  "serviceWindow",
  "requiredCorrectionCode",
  "marketingSuppressionRequired",
  "sendMode",
  "outcome",
  "observedConversationStatus",
  "observedConversationMode",
  "handoffRequired",
  "urgentSafetyHoldObserved",
  "contactMarketingSuppressionObserved",
  "ordinaryAutomationPaused",
  "retryCount",
  "eventCount",
  "modelCallCount",
  "providerCallCount",
  "externalDispatchCount",
  "conversationMutationCount",
  "handoffMutationCount",
  "suppressionMutationCount",
  "chainOfThoughtStored",
] as const;

const RUN_KEYS = [
  "id",
  "workspaceId",
  "scenarioId",
  "evaluationScope",
  "durableScenarioScope",
  "requestFingerprint",
  "knowledgeSelectionId",
  "knowledgeSelectionFingerprint",
  "modelProvider",
  "modelId",
  "promptVersionId",
  "policyVersionId",
  "reviewerVersionId",
  "eventId",
  "auditEventId",
  "evaluatedAt",
  "recordedAt",
  ...DECISION_KEYS,
  "synthetic",
  "schemaVersion",
] as const;

const EVENT_KEYS = [
  "id",
  "workspaceId",
  "runId",
  "scenarioId",
  "eventType",
  "sequence",
  "previousEventId",
  "retryOfEventId",
  "requestFingerprint",
  "runFingerprint",
  "knowledgeSelectionId",
  "knowledgeSelectionFingerprint",
  "modelProvider",
  "modelId",
  "promptVersionId",
  "policyVersionId",
  "reviewerVersionId",
  "auditEventId",
  "evaluatedAt",
  "createdAt",
  ...DECISION_KEYS,
  "synthetic",
  "schemaVersion",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: unknown,
  keys: readonly string[],
  label: string,
  code: AiGovernanceRepositoryError["code"],
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new AiGovernanceRepositoryError(`${label} must be an exact record.`, code);
  }
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (
    expected.length !== actual.length ||
    expected.some((key, index) => key !== actual[index])
  ) {
    throw new AiGovernanceRepositoryError(`${label} has an invalid exact key set.`, code);
  }
}

function isNativeMillisecondTimestamp(value: unknown): value is Timestamp {
  return (
    value instanceof Timestamp &&
    Number.isInteger(value.seconds) &&
    Number.isInteger(value.nanoseconds) &&
    value.nanoseconds % 1_000_000 === 0
  );
}

function timestampToIso(value: unknown, label: string): string {
  if (!isNativeMillisecondTimestamp(value)) {
    throw new AiGovernanceRepositoryError(
      `${label} must be a millisecond-aligned native Firestore Timestamp.`,
      "invalid_persisted_data",
    );
  }
  try {
    return value.toDate().toISOString();
  } catch {
    throw new AiGovernanceRepositoryError(
      `${label} is outside the canonical Firestore timestamp range.`,
      "invalid_persisted_data",
    );
  }
}

interface TimestampField {
  readonly key: string;
  readonly nullable?: boolean;
}

function convertPersistedRecord(
  value: unknown,
  keys: readonly string[],
  timestampFields: readonly TimestampField[],
  label: string,
): Record<string, unknown> {
  assertExactKeys(value, keys, label, "invalid_persisted_data");
  const converted = { ...value };
  for (const field of timestampFields) {
    const persisted = value[field.key];
    if (field.nullable === true && persisted === null) {
      converted[field.key] = null;
    } else {
      converted[field.key] = timestampToIso(persisted, `${label}.${field.key}`);
    }
  }
  return converted;
}

function governedValidation(label: string, validate: () => void): void {
  try {
    validate();
  } catch (error) {
    if (error instanceof AiGovernanceRepositoryError) throw error;
    throw new AiGovernanceRepositoryError(
      `${label} failed frozen AI governance validation.`,
      "invalid_persisted_data",
    );
  }
}

async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new AiGovernanceRepositoryError(
      "AI governance fingerprint verification is unavailable.",
      "invalid_persisted_data",
    );
  }
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

function sameOrderedValues(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function parseLoadInput(rawInput: LoadAiGovernanceEvidenceInput): LoadAiGovernanceEvidenceInput {
  assertExactKeys(rawInput, ["workspaceId", "plan"], "AI governance loader input", "invalid_input");
  if (rawInput.workspaceId !== AI_GOVERNANCE_WORKSPACE_ID) {
    throw new AiGovernanceRepositoryError(
      "AI governance loader workspace is not the frozen synthetic tenant.",
      "invalid_input",
    );
  }
  const rawPlan = rawInput.plan;
  assertExactKeys(
    rawPlan,
    ["role", "knowledgeDocumentIds", "knowledgeSelectionIds", "scenarioIds"],
    "AI governance role read plan",
    "invalid_input",
  );
  if (
    typeof rawPlan.role !== "string" ||
    !(rawPlan.role in AI_GOVERNANCE_ROLE_READ_PLANS)
  ) {
    throw new AiGovernanceRepositoryError("AI governance role read plan is not allowlisted.", "invalid_input");
  }
  const canonical = AI_GOVERNANCE_ROLE_READ_PLANS[rawPlan.role as AiGovernanceReadRole];
  if (
    !Array.isArray(rawPlan.knowledgeDocumentIds) ||
    !Array.isArray(rawPlan.knowledgeSelectionIds) ||
    !Array.isArray(rawPlan.scenarioIds) ||
    !sameOrderedValues(rawPlan.knowledgeDocumentIds, canonical.knowledgeDocumentIds) ||
    !sameOrderedValues(rawPlan.knowledgeSelectionIds, canonical.knowledgeSelectionIds) ||
    !sameOrderedValues(rawPlan.scenarioIds, canonical.scenarioIds)
  ) {
    throw new AiGovernanceRepositoryError(
      "AI governance role read plan must retain its canonical ordered unique subsets.",
      "invalid_input",
    );
  }
  return Object.freeze({ workspaceId: AI_GOVERNANCE_WORKSPACE_ID, plan: canonical });
}

async function parseKnowledgeDocument(
  value: unknown,
  documentId: AiKnowledgeDocumentId,
): Promise<StaffSafeAiKnowledgeDocumentV1> {
  const converted: unknown = convertPersistedRecord(
    value,
    KNOWLEDGE_DOCUMENT_KEYS,
    [
      { key: "approvedAt", nullable: true },
      { key: "evaluatedAt" },
      { key: "effectiveFrom", nullable: true },
      { key: "effectiveUntil", nullable: true },
      { key: "createdAt" },
      { key: "updatedAt" },
    ],
    `AI knowledge document ${documentId}`,
  );
  governedValidation(`AI knowledge document ${documentId}`, () =>
    assertStaffSafeAiKnowledgeDocumentV1(converted),
  );
  const document = converted as StaffSafeAiKnowledgeDocumentV1;
  if (
    document.id !== documentId ||
    document.workspaceId !== AI_GOVERNANCE_WORKSPACE_ID ||
    document.createdAt !== AI_GOVERNANCE_SEED_TIMESTAMPS.knowledgeCreatedAt ||
    document.updatedAt !== AI_GOVERNANCE_SEED_TIMESTAMPS.knowledgeUpdatedAt
  ) {
    throw new AiGovernanceRepositoryError(
      `AI knowledge document ${documentId} does not match its exact path and lifecycle.`,
      "invalid_persisted_data",
    );
  }

  const expected = AI_KNOWLEDGE_DOCUMENT_MATRIX[documentId];
  const content: AiKnowledgeContentBindingV1 = {
    workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    documentId,
    title: expected.title,
    version: expected.version,
    language: expected.language,
    contentKind: expected.contentKind,
    ownerUid: expected.ownerUid,
    protectedContentFingerprint: expected.protectedContentFingerprint,
    synthetic: true,
  };
  const contentFingerprint = await sha256Hex(serializeAiKnowledgeContentV1(content));
  const approval: AiKnowledgeApprovalBindingV1 = {
    workspaceId: AI_GOVERNANCE_WORKSPACE_ID,
    documentId,
    contentFingerprint,
    ownerUid: expected.ownerUid,
    approverUid: expected.approverUid,
    approvalState: expected.approvalState,
    approvalScope: expected.approvalScope,
    approvedAt: expected.approvedAt,
    evaluatedAt: AI_GOVERNANCE_EVALUATED_AT,
    effectiveFrom: expected.effectiveFrom,
    effectiveUntil: expected.effectiveUntil,
    synthetic: true,
  };
  const approvalFingerprint = await sha256Hex(serializeAiKnowledgeApprovalV1(approval));
  if (
    document.contentFingerprint !== contentFingerprint ||
    document.approvalFingerprint !== approvalFingerprint
  ) {
    throw new AiGovernanceRepositoryError(
      `AI knowledge document ${documentId} does not match its canonical content and approval bindings.`,
      "integrity_error",
    );
  }
  return deepFreeze(document);
}

async function parseKnowledgeSelection(
  value: unknown,
  selectionId: AiKnowledgeSelectionId,
  document: StaffSafeAiKnowledgeDocumentV1,
): Promise<StaffSafeAiKnowledgeSelectionV1> {
  const converted: unknown = convertPersistedRecord(
    value,
    KNOWLEDGE_SELECTION_KEYS,
    [
      { key: "selectedAt" },
      { key: "evaluatedAt" },
      { key: "effectiveFrom" },
      { key: "effectiveUntil" },
      { key: "createdAt" },
    ],
    `AI knowledge selection ${selectionId}`,
  );
  governedValidation(`AI knowledge selection ${selectionId}`, () =>
    assertStaffSafeAiKnowledgeSelectionV1(converted),
  );
  const selection = converted as StaffSafeAiKnowledgeSelectionV1;
  if (
    selection.selectionId !== selectionId ||
    selection.workspaceId !== AI_GOVERNANCE_WORKSPACE_ID ||
    selection.createdAt !== AI_GOVERNANCE_SEED_TIMESTAMPS.knowledgeSelectionCreatedAt
  ) {
    throw new AiGovernanceRepositoryError(
      `AI knowledge selection ${selectionId} does not match its exact path and persistence time.`,
      "invalid_persisted_data",
    );
  }
  const binding: AiKnowledgeSelectionBindingV1 = {
    selectionId: selection.selectionId,
    workspaceId: selection.workspaceId,
    documentId: selection.documentId,
    contentFingerprint: selection.contentFingerprint,
    approvalFingerprint: selection.approvalFingerprint,
    selectorVersionId: AI_GOVERNANCE_SELECTOR_VERSION_ID,
    selectedAt: selection.selectedAt,
    evaluatedAt: selection.evaluatedAt,
    selectionScope: selection.selectionScope,
    effectiveFrom: selection.effectiveFrom,
    effectiveUntil: selection.effectiveUntil,
    synthetic: true,
  };
  const selectionFingerprint = await sha256Hex(serializeAiKnowledgeSelectionV1(binding));
  if (
    selection.selectionFingerprint !== selectionFingerprint ||
    selection.documentId !== document.id ||
    selection.contentFingerprint !== document.contentFingerprint ||
    selection.approvalFingerprint !== document.approvalFingerprint ||
    selection.evaluatedAt !== document.evaluatedAt ||
    selection.effectiveFrom !== document.effectiveFrom ||
    selection.effectiveUntil !== document.effectiveUntil ||
    document.approvalState !== "approved" ||
    document.approvalScope !== "synthetic_information_only"
  ) {
    throw new AiGovernanceRepositoryError(
      `AI knowledge selection ${selectionId} is not cross-bound to its exact approved document.`,
      "integrity_error",
    );
  }
  return deepFreeze(selection);
}

function parseRun(
  value: unknown,
  scenarioId: AiPersistedScenarioId,
): StaffSafeAiRetrospectiveRunV1 {
  const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
  const converted: unknown = convertPersistedRecord(
    value,
    RUN_KEYS,
    [{ key: "evaluatedAt" }, { key: "recordedAt" }],
    `AI retrospective run ${expected.runId}`,
  );
  governedValidation(`AI retrospective run ${expected.runId}`, () =>
    assertStaffSafeAiRetrospectiveRunV1(converted),
  );
  const run = converted as StaffSafeAiRetrospectiveRunV1;
  if (
    run.id !== expected.runId ||
    run.workspaceId !== AI_GOVERNANCE_WORKSPACE_ID ||
    run.scenarioId !== scenarioId
  ) {
    throw new AiGovernanceRepositoryError(
      `AI retrospective run ${expected.runId} does not match its exact tenant path.`,
      "invalid_persisted_data",
    );
  }
  return deepFreeze(run);
}

function parseEvent(
  value: unknown,
  scenarioId: AiPersistedScenarioId,
): StaffSafeAiRetrospectiveEventV1 {
  const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
  const converted: unknown = convertPersistedRecord(
    value,
    EVENT_KEYS,
    [{ key: "evaluatedAt" }, { key: "createdAt" }],
    `AI retrospective event ${expected.eventId}`,
  );
  governedValidation(`AI retrospective event ${expected.eventId}`, () =>
    assertStaffSafeAiRetrospectiveEventV1(converted),
  );
  const event = converted as StaffSafeAiRetrospectiveEventV1;
  if (
    event.id !== expected.eventId ||
    event.workspaceId !== AI_GOVERNANCE_WORKSPACE_ID ||
    event.scenarioId !== scenarioId
  ) {
    throw new AiGovernanceRepositoryError(
      `AI retrospective event ${expected.eventId} does not match its exact tenant path.`,
      "invalid_persisted_data",
    );
  }
  return deepFreeze(event);
}

async function assertRunEventJoin(
  run: StaffSafeAiRetrospectiveRunV1,
  event: StaffSafeAiRetrospectiveEventV1,
  selectionById: ReadonlyMap<AiKnowledgeSelectionId, StaffSafeAiKnowledgeSelectionV1>,
): Promise<void> {
  for (const key of DECISION_KEYS) {
    if (JSON.stringify(run[key]) !== JSON.stringify(event[key])) {
      throw new AiGovernanceRepositoryError(
        `AI retrospective event changed parent decision field ${key}.`,
        "integrity_error",
      );
    }
  }
  const runFingerprint = await sha256Hex(serializeAiRetrospectiveRunV1(run));
  if (
    event.workspaceId !== run.workspaceId ||
    event.runId !== run.id ||
    event.id !== run.eventId ||
    event.scenarioId !== run.scenarioId ||
    event.requestFingerprint !== run.requestFingerprint ||
    event.runFingerprint !== runFingerprint ||
    event.knowledgeSelectionId !== run.knowledgeSelectionId ||
    event.knowledgeSelectionFingerprint !== run.knowledgeSelectionFingerprint ||
    event.modelProvider !== run.modelProvider ||
    event.modelId !== run.modelId ||
    event.promptVersionId !== run.promptVersionId ||
    event.policyVersionId !== run.policyVersionId ||
    event.reviewerVersionId !== run.reviewerVersionId ||
    event.auditEventId !== run.auditEventId ||
    event.evaluatedAt !== run.evaluatedAt ||
    event.createdAt !== run.recordedAt
  ) {
    throw new AiGovernanceRepositoryError(
      "AI retrospective run and one-shot event are not exactly cross-bound.",
      "integrity_error",
    );
  }
  const expectedSelectionId = AI_PERSISTED_SCENARIO_MATRIX[run.scenarioId].knowledgeSelectionId;
  if (expectedSelectionId === null) {
    if (run.knowledgeSelectionId !== null || run.knowledgeSelectionFingerprint !== null) {
      throw new AiGovernanceRepositoryError(
        "Mixed and STOP retrospective records must retain null knowledge bindings.",
        "integrity_error",
      );
    }
    return;
  }
  const selection = selectionById.get(expectedSelectionId);
  if (
    selection === undefined ||
    run.knowledgeSelectionId !== selection.selectionId ||
    run.knowledgeSelectionFingerprint !== selection.selectionFingerprint
  ) {
    throw new AiGovernanceRepositoryError(
      "AI retrospective run is not bound to its permitted knowledge selection.",
      "integrity_error",
    );
  }
}

/**
 * Loads a bounded staff-safe evidence projection with authoritative fixed
 * server gets only. Missing governance is a clean `not_seeded` state; a partial
 * governance inventory or a partial/polluted run-event pair fails closed.
 */
export async function loadAiGovernanceEvidence(
  db: Firestore,
  rawInput: LoadAiGovernanceEvidenceInput,
): Promise<AiGovernanceEvidenceDTO> {
  const input = parseLoadInput(rawInput);
  const root = ["workspaces", input.workspaceId] as const;
  const documentReads = input.plan.knowledgeDocumentIds.map((documentId) =>
    getDocFromServer(doc(db, ...root, AI_GOVERNANCE_COLLECTIONS.knowledgeDocuments, documentId)),
  );
  const selectionReads = input.plan.knowledgeSelectionIds.map((selectionId) =>
    getDocFromServer(doc(db, ...root, AI_GOVERNANCE_COLLECTIONS.knowledgeSelections, selectionId)),
  );
  const scenarioReads = input.plan.scenarioIds.flatMap((scenarioId) => {
    const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
    return [
      getDocFromServer(doc(db, ...root, AI_GOVERNANCE_COLLECTIONS.retrospectiveRuns, expected.runId)),
      getDocFromServer(doc(db, ...root, AI_GOVERNANCE_COLLECTIONS.retrospectiveEvents, expected.eventId)),
    ];
  });
  const snapshots = await Promise.all([...documentReads, ...selectionReads, ...scenarioReads]);
  const governanceReadCount = documentReads.length + selectionReads.length;
  const governanceSnapshots = snapshots.slice(0, governanceReadCount);
  const governanceFoundCount = governanceSnapshots.filter((snapshot) => snapshot.exists()).length;
  if (governanceFoundCount !== 0 && governanceFoundCount !== governanceReadCount) {
    throw new AiGovernanceRepositoryError(
      "AI governance contains a partial seeded inventory for the requested role plan.",
      "integrity_error",
    );
  }

  let governance: AiGovernanceProjection;
  let selectionById = new Map<AiKnowledgeSelectionId, StaffSafeAiKnowledgeSelectionV1>();
  if (governanceFoundCount === 0) {
    governance = deepFreeze({ status: "not_seeded", documents: [], selections: [] } as const);
  } else {
    const rawDocumentSnapshots = snapshots.slice(0, documentReads.length);
    const documents = await Promise.all(
      input.plan.knowledgeDocumentIds.map((documentId, index) => {
        const snapshot = rawDocumentSnapshots[index];
        if (!snapshot?.exists() || snapshot.id !== documentId) {
          throw new AiGovernanceRepositoryError(
            `AI knowledge document ${documentId} is missing from its exact read.`,
            "integrity_error",
          );
        }
        return parseKnowledgeDocument(snapshot.data(), documentId);
      }),
    );
    const documentById = new Map(documents.map((document) => [document.id, document]));
    const rawSelectionSnapshots = snapshots.slice(documentReads.length, governanceReadCount);
    const selections = await Promise.all(
      input.plan.knowledgeSelectionIds.map((selectionId, index) => {
        const snapshot = rawSelectionSnapshots[index];
        const documentId = AI_KNOWLEDGE_SELECTION_MATRIX[selectionId].documentId;
        const selectedDocument = documentById.get(documentId);
        if (!snapshot?.exists() || snapshot.id !== selectionId || selectedDocument === undefined) {
          throw new AiGovernanceRepositoryError(
            `AI knowledge selection ${selectionId} has no exact requested document join.`,
            "integrity_error",
          );
        }
        return parseKnowledgeSelection(snapshot.data(), selectionId, selectedDocument);
      }),
    );
    selectionById = new Map(selections.map((selection) => [selection.selectionId, selection]));
    governance = deepFreeze({ status: "ready", documents, selections } as const);
  }

  const runtimeSnapshots = snapshots.slice(governanceReadCount);
  const scenarios: AiGovernanceScenarioProjection[] = [];
  for (const [index, scenarioId] of input.plan.scenarioIds.entries()) {
    const runSnapshot = runtimeSnapshots[index * 2];
    const eventSnapshot = runtimeSnapshots[index * 2 + 1];
    const runExists = runSnapshot?.exists() === true;
    const eventExists = eventSnapshot?.exists() === true;
    if (!runExists && !eventExists) {
      scenarios.push(deepFreeze({ scenarioId, status: "not_recorded", run: null, event: null }));
      continue;
    }
    if (!runExists || !eventExists || governance.status !== "ready") {
      throw new AiGovernanceRepositoryError(
        `AI scenario ${scenarioId} has a partial run/event/governance inventory.`,
        "integrity_error",
      );
    }
    const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
    if (runSnapshot.id !== expected.runId || eventSnapshot.id !== expected.eventId) {
      throw new AiGovernanceRepositoryError(
        `AI scenario ${scenarioId} exact read returned a substituted path identity.`,
        "integrity_error",
      );
    }
    const run = parseRun(runSnapshot.data(), scenarioId);
    const event = parseEvent(eventSnapshot.data(), scenarioId);
    await assertRunEventJoin(run, event, selectionById);
    scenarios.push(deepFreeze({ scenarioId, status: "recorded", run, event }));
  }

  return deepFreeze({
    role: input.plan.role,
    governance,
    scenarios,
  });
}
