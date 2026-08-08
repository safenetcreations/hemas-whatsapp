import type { Firestore } from "firebase/firestore";

import {
  assertAutomationRunOperationalTransition,
  assertCareEnrollmentEventTrace,
  canApplyAutomationRunAction,
  canApplyCareEnrollmentAction,
  orderCareSuppressions,
  type AuthoritativeAutomationDefinition,
  type AuthoritativeCarePathway,
  type AutomationRunAction,
  type CareEnrollmentAction,
  type CareSuppressionReason,
  type ExecutableAutomationFamily,
  type StaffSafeAutomationActivation,
  type StaffSafeAutomationDefinitionEvent,
  type StaffSafeAutomationRun,
  type StaffSafeAutomationRunEvent,
  type StaffSafeAutomationWorkItem,
  type StaffSafeCareEnrollment,
  type StaffSafeCareEnrollmentEvent,
  type StaffSafeCareEscalation,
  type StaffSafeCareHandoff,
  type StaffSafeCarePathwayActivation,
  type StaffSafeCarePathwayEvent,
} from "@/lib/domain/automations";
import {
  assertAutomationActivationGovernanceJoin,
  assertCarePathwayActivationGovernanceJoin,
  assertPhase5EventAuditJoin,
  AutomationCareRepositoryError,
  getAutomationActivation,
  getAutomationDefinition,
  getAutomationDefinitionEvent,
  getAutomationRun,
  getAutomationRunEvent,
  getAutomationWorkItem,
  getCareEnrollment,
  getCareEnrollmentEvent,
  getCareEscalation,
  getCareHandoff,
  getCarePathway,
  getCarePathwayActivation,
  getCarePathwayEvent,
  getPhase5AuditEvent,
  listAutomationDefinitions,
  listCarePathways,
  type Phase5AuditRecordDTO,
} from "@/lib/firebase/repositories";
import {
  automationControlResultFingerprint,
  buildAutomationFunctionsRequest,
  buildCareFunctionsRequest,
  careControlResultFingerprint,
  type AutomationFunctionsRequest,
  type AutomationFunctionsResponse,
  type CareFunctionsRequest,
  type CareFunctionsResponse,
} from "@/lib/firebase/automation-care-functions-emulator";
import type {
  VerifiedWorkspaceSession,
  WorkspaceRole,
} from "@/lib/firebase/workspace-session-model";

export const SYNTHETIC_AUTOMATION_RUN_ID =
  "automation_run_synthetic_appointment_001";
export const SYNTHETIC_CARE_PATHWAY_ID =
  "care_pathway_synthetic_followup_v1";
export const SYNTHETIC_CARE_ENROLLMENT_ID =
  "care_enrollment_synthetic_001";

export const SYNTHETIC_AUTOMATION_SCOPE = Object.freeze({
  teamId: "team_demo_general",
  locationId: "location_demo_wattala",
});
export const SYNTHETIC_CARE_SCOPE = Object.freeze({
  teamId: "team_demo_clinical_escalation",
  locationId: "location_demo_wattala",
});

const AUTOMATION_FAMILIES = [
  "appointment_service",
  "laboratory_service",
] as const satisfies readonly ExecutableAutomationFamily[];
const CATALOGUE_PAGE_SIZE = 50;

export type AutomationWorkspaceCapabilities = {
  readonly canViewDefinitions: boolean;
  readonly canReadAutomationOperations: boolean;
  readonly canControlRuns: boolean;
  readonly canViewCarePaths: boolean;
  readonly canReadCareOperations: boolean;
  readonly canControlEnrollments: boolean;
  readonly canManageEscalations: boolean;
};

export function automationWorkspaceCapabilities(
  session: VerifiedWorkspaceSession,
): AutomationWorkspaceCapabilities {
  const role = session.role;
  return {
    canViewDefinitions: ["tenant_admin", "supervisor", "analyst"].includes(
      role,
    ),
    canReadAutomationOperations: ["tenant_admin", "supervisor"].includes(
      role,
    ),
    canControlRuns: ["tenant_admin", "supervisor"].includes(role),
    canViewCarePaths: [
      "tenant_admin",
      "analyst",
      "clinical_approver",
    ].includes(role),
    canReadCareOperations:
      role === "tenant_admin" || role === "clinical_approver",
    canControlEnrollments: role === "clinical_approver",
    canManageEscalations: role === "clinical_approver",
  };
}

export function automationWorkspaceAuthorityKey(
  session: VerifiedWorkspaceSession,
): string {
  return [
    session.workspaceId,
    session.uid,
    session.role,
    session.scopeMode,
    session.workspaceMode,
    session.dataClassification,
    session.teamIds.join("\u001f"),
    session.locationIds.join("\u001f"),
  ].join("\u001e");
}

export function sessionCanReadPatientScope(
  session: VerifiedWorkspaceSession,
  scope: { readonly teamId: string; readonly locationId: string },
): boolean {
  if (session.role === "tenant_admin" && session.scopeMode === "workspace_wide") {
    return true;
  }
  if (session.scopeMode !== "assigned") return false;
  return (
    session.teamIds.includes(scope.teamId) &&
    session.locationIds.includes(scope.locationId)
  );
}

export type AutomationCatalogueRecord = {
  readonly family: ExecutableAutomationFamily;
  readonly definitions: readonly AuthoritativeAutomationDefinition[];
  readonly activeDefinition: AuthoritativeAutomationDefinition;
  readonly activation: StaffSafeAutomationActivation;
  readonly activationEvent: StaffSafeAutomationDefinitionEvent;
  readonly activationAudit: Phase5AuditRecordDTO;
};

export type CareCatalogueRecord = {
  readonly pathways: readonly AuthoritativeCarePathway[];
  readonly activePathway: AuthoritativeCarePathway;
  readonly activation: StaffSafeCarePathwayActivation;
  readonly activationEvent: StaffSafeCarePathwayEvent;
  readonly activationAudit: Phase5AuditRecordDTO;
};

export type AutomationOperationRecord = {
  readonly definition: AuthoritativeAutomationDefinition;
  readonly run: StaffSafeAutomationRun;
  readonly latestEvent: StaffSafeAutomationRunEvent | null;
  readonly latestAudit: Phase5AuditRecordDTO | null;
  readonly workItem: StaffSafeAutomationWorkItem | null;
};

export type CareOperationRecord = {
  readonly pathway: AuthoritativeCarePathway;
  readonly enrollment: StaffSafeCareEnrollment;
  readonly latestEvent: StaffSafeCareEnrollmentEvent | null;
  readonly latestAudit: Phase5AuditRecordDTO | null;
  readonly eventEscalation: StaffSafeCareEscalation | null;
  readonly openEscalation: StaffSafeCareEscalation | null;
  readonly safetyHoldEscalation: StaffSafeCareEscalation | null;
  readonly handoff: StaffSafeCareHandoff | null;
};

export type OperationAccess<T> =
  | { readonly status: "not_authorized"; readonly record: null }
  | { readonly status: "out_of_scope"; readonly record: null }
  | { readonly status: "available"; readonly record: T };

export type AutomationWorkspaceResult = {
  readonly automationCatalogues: readonly AutomationCatalogueRecord[] | null;
  readonly careCatalogue: CareCatalogueRecord | null;
  readonly automationOperation: OperationAccess<AutomationOperationRecord>;
  readonly careOperation: OperationAccess<CareOperationRecord>;
};

export class AutomationWorkspaceDataError extends Error {
  constructor(
    message: string,
    readonly code: "access_denied" | "evidence_mismatch" | "load_failed",
    readonly sourceCode = "",
  ) {
    super(message);
    this.name = "AutomationWorkspaceDataError";
  }
}

function evidenceMismatch(message: string): never {
  throw new AutomationWorkspaceDataError(message, "evidence_mismatch");
}

function assertSyntheticSession(session: VerifiedWorkspaceSession): void {
  const capabilities = automationWorkspaceCapabilities(session);
  if (
    session.workspaceMode !== "demo" ||
    session.dataClassification !== "synthetic_only" ||
    (!capabilities.canViewDefinitions && !capabilities.canViewCarePaths)
  ) {
    throw new AutomationWorkspaceDataError(
      "This authority cannot read Phase 5 synthetic governance metadata.",
      "access_denied",
    );
  }
}

function assertUniqueIds(values: readonly { readonly id: string }[], label: string): void {
  if (new Set(values.map((value) => value.id)).size !== values.length) {
    evidenceMismatch(`${label} contained duplicate document identities.`);
  }
}

function assertZeroCounters(
  value: {
    readonly synthetic: true;
    readonly externalDispatchCount: 0;
    readonly networkCallCount: 0;
  },
  label: string,
): void {
  if (
    !value.synthetic ||
    value.externalDispatchCount !== 0 ||
    value.networkCallCount !== 0
  ) {
    evidenceMismatch(`${label} crossed the zero-dispatch safety boundary.`);
  }
}

export interface AutomationWorkspaceReads {
  readonly listDefinitions: typeof listAutomationDefinitions;
  readonly getDefinition: typeof getAutomationDefinition;
  readonly getAutomationActivation: typeof getAutomationActivation;
  readonly getAutomationDefinitionEvent: typeof getAutomationDefinitionEvent;
  readonly getAutomationRun: typeof getAutomationRun;
  readonly getAutomationRunEvent: typeof getAutomationRunEvent;
  readonly getAutomationWorkItem: typeof getAutomationWorkItem;
  readonly listCarePathways: typeof listCarePathways;
  readonly getCarePathway: typeof getCarePathway;
  readonly getCarePathwayActivation: typeof getCarePathwayActivation;
  readonly getCarePathwayEvent: typeof getCarePathwayEvent;
  readonly getCareEnrollment: typeof getCareEnrollment;
  readonly getCareEnrollmentEvent: typeof getCareEnrollmentEvent;
  readonly getCareEscalation: typeof getCareEscalation;
  readonly getCareHandoff: typeof getCareHandoff;
  readonly getAudit: typeof getPhase5AuditEvent;
}

export const defaultAutomationWorkspaceReads: AutomationWorkspaceReads = {
  listDefinitions: listAutomationDefinitions,
  getDefinition: getAutomationDefinition,
  getAutomationActivation,
  getAutomationDefinitionEvent,
  getAutomationRun,
  getAutomationRunEvent,
  getAutomationWorkItem,
  listCarePathways,
  getCarePathway,
  getCarePathwayActivation,
  getCarePathwayEvent,
  getCareEnrollment,
  getCareEnrollmentEvent,
  getCareEscalation,
  getCareHandoff,
  getAudit: getPhase5AuditEvent,
};

async function loadAutomationCatalogue(
  db: Firestore,
  workspaceId: string,
  family: ExecutableAutomationFamily,
  reads: AutomationWorkspaceReads,
): Promise<AutomationCatalogueRecord | null> {
  const definitions = await reads.listDefinitions(db, {
    workspaceId,
    family,
    pageSize: CATALOGUE_PAGE_SIZE,
  });
  assertUniqueIds(definitions, `${family} automation catalogue`);
  if (definitions.length === 0) return null;

  const activation = await reads.getAutomationActivation(db, {
    workspaceId,
    family,
  });
  const activeDefinition = await reads.getDefinition(db, {
    workspaceId,
    id: String(activation.activeDefinitionId),
  });
  const [activationEvent, activationAudit] = await Promise.all([
    reads.getAutomationDefinitionEvent(db, {
      workspaceId,
      id: String(activation.activationEventId),
    }),
    reads.getAudit(db, {
      workspaceId,
      id: String(activation.activationAuditEventId),
    }),
  ]);
  if (
    !definitions.some(
      (definition) =>
        definition.id === activeDefinition.id &&
        definition.version === activeDefinition.version &&
        definition.contentHash === activeDefinition.contentHash,
    )
  ) {
    evidenceMismatch("The active automation definition is absent from its bounded catalogue.");
  }
  try {
    assertAutomationActivationGovernanceJoin(
      activation,
      activeDefinition,
      activationEvent,
      activationAudit,
    );
  } catch {
    evidenceMismatch("Automation activation evidence failed its exact governance join.");
  }
  assertZeroCounters(activation, "Automation activation");
  return {
    family,
    definitions,
    activeDefinition,
    activation,
    activationEvent,
    activationAudit,
  };
}

async function loadCareCatalogue(
  db: Firestore,
  workspaceId: string,
  reads: AutomationWorkspaceReads,
): Promise<CareCatalogueRecord | null> {
  const pathways = await reads.listCarePathways(db, {
    workspaceId,
    family: "post_discharge",
    pageSize: CATALOGUE_PAGE_SIZE,
  });
  assertUniqueIds(pathways, "Care pathway catalogue");
  if (pathways.length === 0) return null;
  const activation = await reads.getCarePathwayActivation(db, { workspaceId });
  const activePathway = await reads.getCarePathway(db, {
    workspaceId,
    id: String(activation.activePathwayId),
  });
  const [activationEvent, activationAudit] = await Promise.all([
    reads.getCarePathwayEvent(db, {
      workspaceId,
      id: String(activation.activationEventId),
    }),
    reads.getAudit(db, {
      workspaceId,
      id: String(activation.activationAuditEventId),
    }),
  ]);
  if (
    !pathways.some(
      (pathway) =>
        pathway.id === activePathway.id &&
        pathway.protocolVersion === activePathway.protocolVersion &&
        pathway.contentHash === activePathway.contentHash,
    )
  ) {
    evidenceMismatch("The active care pathway is absent from its bounded catalogue.");
  }
  try {
    assertCarePathwayActivationGovernanceJoin(
      activation,
      activePathway,
      activationEvent,
      activationAudit,
    );
  } catch {
    evidenceMismatch("Care activation evidence failed its exact governance join.");
  }
  assertZeroCounters(activation, "Care activation");
  return { pathways, activePathway, activation, activationEvent, activationAudit };
}

function assertAutomationLatestEvidence(
  run: StaffSafeAutomationRun,
  event: StaffSafeAutomationRunEvent,
  audit: Phase5AuditRecordDTO,
): void {
  try {
    assertPhase5EventAuditJoin(event, audit, "automation_run", String(run.id));
  } catch {
    evidenceMismatch("The latest automation event and audit failed their exact join.");
  }
  if (
    run.lastEventId !== event.id ||
    run.revision !== event.revision ||
    run.workspaceId !== event.workspaceId ||
    run.definitionId !== event.definitionId ||
    run.definitionVersion !== event.definitionVersion ||
    run.definitionContentHash !== event.definitionContentHash ||
    run.teamId !== event.teamId ||
    run.locationId !== event.locationId ||
    run.state !== event.toState ||
    run.outcomeCode !== event.outcomeCode ||
    run.nextEligibleAt !== event.nextEligibleAt ||
    run.updatedAt !== event.occurredAt
  ) {
    evidenceMismatch("The automation aggregate does not bind its latest immutable event.");
  }
}

async function loadAutomationOperation(
  db: Firestore,
  workspaceId: string,
  catalogue: AutomationCatalogueRecord,
  reads: AutomationWorkspaceReads,
): Promise<AutomationOperationRecord> {
  const run = await reads.getAutomationRun(db, {
    workspaceId,
    id: SYNTHETIC_AUTOMATION_RUN_ID,
  });
  const active = catalogue.activeDefinition;
  if (
    run.id !== SYNTHETIC_AUTOMATION_RUN_ID ||
    run.teamId !== SYNTHETIC_AUTOMATION_SCOPE.teamId ||
    run.locationId !== SYNTHETIC_AUTOMATION_SCOPE.locationId ||
    run.definitionId !== active.id ||
    run.definitionVersion !== active.version ||
    run.definitionContentHash !== active.contentHash ||
    Date.parse(run.createdAt) < Date.parse(catalogue.activation.activatedAt)
  ) {
    evidenceMismatch("The fixed automation run failed its active-definition or scope binding.");
  }
  assertZeroCounters(run, "Automation run");
  if (run.lastEventId === null) {
    return {
      definition: active,
      run,
      latestEvent: null,
      latestAudit: null,
      workItem: null,
    };
  }
  const latestEvent = await reads.getAutomationRunEvent(db, {
    workspaceId,
    id: String(run.lastEventId),
  });
  const latestAudit = await reads.getAudit(db, {
    workspaceId,
    id: String(latestEvent.auditEventId),
  });
  assertAutomationLatestEvidence(run, latestEvent, latestAudit);
  if (
    run.openWorkItemId !== null &&
    run.openWorkItemId !== latestEvent.workItemId
  ) {
    evidenceMismatch("Automation aggregate and latest event point to different work items.");
  }
  const workItemId = run.openWorkItemId ?? latestEvent.workItemId;
  const workItem =
    workItemId === null
      ? null
      : await reads.getAutomationWorkItem(db, {
          workspaceId,
          id: String(workItemId),
        });
  if (
    workItem !== null &&
    (workItem.workspaceId !== run.workspaceId ||
      workItem.runId !== run.id ||
      workItem.definitionId !== run.definitionId ||
      workItem.definitionVersion !== run.definitionVersion ||
      workItem.definitionContentHash !== run.definitionContentHash ||
      workItem.teamId !== run.teamId ||
      workItem.locationId !== run.locationId ||
      Date.parse(workItem.createdAt) < Date.parse(run.createdAt))
  ) {
    evidenceMismatch("Automation work-item evidence does not bind the exact run.");
  }
  if (run.openWorkItemId !== null && workItem?.id !== run.openWorkItemId) {
    evidenceMismatch("Automation run has an unresolved work-item pointer with no aggregate.");
  }
  if (workItem !== null) {
    assertZeroCounters(workItem, "Automation work item");
    if (
      (run.openWorkItemId === workItem.id && workItem.state === "resolved") ||
      (latestEvent.workItemId === workItem.id &&
        (workItem.lastEventId !== latestEvent.id ||
          workItem.updatedAt !== latestEvent.occurredAt))
    ) {
      evidenceMismatch(
        "Automation work-item lifecycle does not bind the latest run event.",
      );
    }
  }
  return { definition: active, run, latestEvent, latestAudit, workItem };
}

function assertCareLatestEvidence(
  enrollment: StaffSafeCareEnrollment,
  event: StaffSafeCareEnrollmentEvent,
  audit: Phase5AuditRecordDTO,
): void {
  try {
    assertPhase5EventAuditJoin(event, audit, "care_enrollment", String(enrollment.id));
  } catch {
    evidenceMismatch("The latest care event and audit failed their exact join.");
  }
  if (
    enrollment.lastEventId !== event.id ||
    enrollment.revision !== event.revision ||
    enrollment.workspaceId !== event.workspaceId ||
    enrollment.pathwayId !== event.pathwayId ||
    enrollment.pathwayProtocolVersion !== event.pathwayProtocolVersion ||
    enrollment.pathwayContentHash !== event.pathwayContentHash ||
    enrollment.teamId !== event.teamId ||
    enrollment.locationId !== event.locationId ||
    enrollment.state !== event.toState ||
    enrollment.outcomeCode !== event.outcomeCode ||
    enrollment.nextContactAt !== event.nextContactAt ||
    enrollment.updatedAt !== event.occurredAt ||
    enrollment.activeSuppressions.length !== event.activeSuppressionsAfter.length ||
    enrollment.activeSuppressions.some(
      (reason, index) => reason !== event.activeSuppressionsAfter[index],
    )
  ) {
    evidenceMismatch("The care enrollment does not bind its latest immutable event.");
  }
}

function assertEscalationJoin(
  enrollment: StaffSafeCareEnrollment,
  escalation: StaffSafeCareEscalation,
): void {
  if (
    escalation.workspaceId !== enrollment.workspaceId ||
    escalation.enrollmentId !== enrollment.id ||
    escalation.pathwayId !== enrollment.pathwayId ||
    escalation.pathwayProtocolVersion !== enrollment.pathwayProtocolVersion ||
    escalation.pathwayContentHash !== enrollment.pathwayContentHash ||
    escalation.teamId !== enrollment.teamId ||
    escalation.locationId !== enrollment.locationId ||
    Date.parse(escalation.createdAt) < Date.parse(enrollment.createdAt)
  ) {
    evidenceMismatch("Care escalation aggregate does not bind the exact enrollment.");
  }
  assertZeroCounters(escalation, "Care escalation");
}

function assertHandoffJoin(
  enrollment: StaffSafeCareEnrollment,
  handoff: StaffSafeCareHandoff,
): void {
  if (
    handoff.workspaceId !== enrollment.workspaceId ||
    handoff.enrollmentId !== enrollment.id ||
    handoff.pathwayId !== enrollment.pathwayId ||
    handoff.pathwayProtocolVersion !== enrollment.pathwayProtocolVersion ||
    handoff.pathwayContentHash !== enrollment.pathwayContentHash ||
    handoff.teamId !== enrollment.teamId ||
    handoff.locationId !== enrollment.locationId ||
    Date.parse(handoff.createdAt) < Date.parse(enrollment.createdAt)
  ) {
    evidenceMismatch("Care handoff aggregate does not bind the exact enrollment.");
  }
  assertZeroCounters(handoff, "Care handoff");
}

async function loadCareOperation(
  db: Firestore,
  workspaceId: string,
  catalogue: CareCatalogueRecord,
  reads: AutomationWorkspaceReads,
): Promise<CareOperationRecord> {
  const enrollment = await reads.getCareEnrollment(db, {
    workspaceId,
    id: SYNTHETIC_CARE_ENROLLMENT_ID,
  });
  const active = catalogue.activePathway;
  if (
    enrollment.id !== SYNTHETIC_CARE_ENROLLMENT_ID ||
    enrollment.teamId !== SYNTHETIC_CARE_SCOPE.teamId ||
    enrollment.locationId !== SYNTHETIC_CARE_SCOPE.locationId ||
    enrollment.pathwayId !== active.id ||
    enrollment.pathwayProtocolVersion !== active.protocolVersion ||
    enrollment.pathwayContentHash !== active.contentHash ||
    Date.parse(enrollment.createdAt) < Date.parse(catalogue.activation.activatedAt)
  ) {
    evidenceMismatch("The fixed care enrollment failed its active-pathway or scope binding.");
  }
  assertZeroCounters(enrollment, "Care enrollment");
  const latestEvent =
    enrollment.lastEventId === null
      ? null
      : await reads.getCareEnrollmentEvent(db, {
          workspaceId,
          id: String(enrollment.lastEventId),
        });
  const latestAudit =
    latestEvent === null
      ? null
      : await reads.getAudit(db, {
          workspaceId,
          id: String(latestEvent.auditEventId),
        });
  if (latestEvent !== null && latestAudit !== null) {
    assertCareLatestEvidence(enrollment, latestEvent, latestAudit);
  }
  if (
    enrollment.openEscalationId !== null &&
    enrollment.openEscalationId !== latestEvent?.escalationId
  ) {
    evidenceMismatch(
      "Care aggregate and latest event point to different open escalations.",
    );
  }
  if (
    enrollment.openHandoffId !== null &&
    enrollment.openHandoffId !== latestEvent?.handoffId
  ) {
    evidenceMismatch(
      "Care aggregate and latest event point to different open handoffs.",
    );
  }

  const escalationIds = [...new Set(
    [
      latestEvent?.escalationId ?? null,
      enrollment.openEscalationId,
      enrollment.safetyHoldEscalationId,
    ].filter(
      (id): id is NonNullable<typeof id> => id !== null,
    ),
  )];
  const escalations = await Promise.all(
    escalationIds.map((id) =>
      reads.getCareEscalation(db, { workspaceId, id: String(id) }),
    ),
  );
  for (const escalation of escalations) assertEscalationJoin(enrollment, escalation);
  const eventEscalation =
    latestEvent?.escalationId == null
      ? null
      : escalations.find((item) => item.id === latestEvent.escalationId) ?? null;
  const openEscalation =
    enrollment.openEscalationId === null
      ? null
      : escalations.find((item) => item.id === enrollment.openEscalationId) ?? null;
  const safetyHoldEscalation =
    enrollment.safetyHoldEscalationId === null
      ? null
      : escalations.find((item) => item.id === enrollment.safetyHoldEscalationId) ?? null;
  if (
    (latestEvent?.escalationId != null && eventEscalation === null) ||
    (enrollment.openEscalationId !== null && openEscalation === null) ||
    (enrollment.safetyHoldEscalationId !== null && safetyHoldEscalation === null)
  ) {
    evidenceMismatch("Care escalation pointer has no exact aggregate evidence.");
  }
  if (
    (openEscalation !== null && openEscalation.state === "resolved") ||
    (safetyHoldEscalation !== null &&
      safetyHoldEscalation.state !== "resolved") ||
    (eventEscalation !== null &&
      latestEvent !== null &&
      (eventEscalation.state !== latestEvent.escalationStateAfter ||
        eventEscalation.lastEventId !== latestEvent.id ||
        eventEscalation.updatedAt !== latestEvent.occurredAt))
  ) {
    evidenceMismatch(
      "Care escalation lifecycle does not bind its current enrollment pointers.",
    );
  }
  if (
    enrollment.openHandoffId !== null &&
    latestEvent?.handoffId !== null &&
    latestEvent?.handoffId !== undefined &&
    enrollment.openHandoffId !== latestEvent.handoffId
  ) {
    evidenceMismatch("Care aggregate and latest event point to different handoffs.");
  }
  const handoffId = enrollment.openHandoffId ?? latestEvent?.handoffId ?? null;
  const handoff =
    handoffId === null
      ? null
      : await reads.getCareHandoff(db, {
          workspaceId,
          id: String(handoffId),
        });
  if (handoff !== null) assertHandoffJoin(enrollment, handoff);
  if (handoffId !== null && handoff?.id !== handoffId) {
    evidenceMismatch("Care handoff pointer has no exact aggregate evidence.");
  }
  if (
    handoff !== null &&
    ((enrollment.openHandoffId === handoff.id && handoff.state !== "open") ||
      (latestEvent?.handoffId === handoff.id &&
        (handoff.lastEventId !== latestEvent.id ||
          handoff.updatedAt !== latestEvent.occurredAt ||
          (enrollment.openHandoffId === null && handoff.state !== "released"))))
  ) {
    evidenceMismatch(
      "Care handoff lifecycle does not bind its current enrollment pointer.",
    );
  }
  return {
    pathway: active,
    enrollment,
    latestEvent,
    latestAudit,
    eventEscalation,
    openEscalation,
    safetyHoldEscalation,
    handoff,
  };
}

export async function loadAutomationWorkspace(
  db: Firestore,
  session: VerifiedWorkspaceSession,
  reads: AutomationWorkspaceReads = defaultAutomationWorkspaceReads,
): Promise<AutomationWorkspaceResult> {
  assertSyntheticSession(session);
  const capabilities = automationWorkspaceCapabilities(session);
  try {
    const automationCatalogues = capabilities.canViewDefinitions
      ? (
          await Promise.all(
            AUTOMATION_FAMILIES.map((family) =>
              loadAutomationCatalogue(db, session.workspaceId, family, reads),
            ),
          )
        ).filter((value): value is AutomationCatalogueRecord => value !== null)
      : null;
    const careCatalogue = capabilities.canViewCarePaths
      ? await loadCareCatalogue(db, session.workspaceId, reads)
      : null;

    const automationScopeAllowed = sessionCanReadPatientScope(
      session,
      SYNTHETIC_AUTOMATION_SCOPE,
    );
    const careScopeAllowed = sessionCanReadPatientScope(session, SYNTHETIC_CARE_SCOPE);
    const appointmentCatalogue = automationCatalogues?.find(
      (catalogue) => catalogue.family === "appointment_service",
    );
    const automationOperation: OperationAccess<AutomationOperationRecord> =
      !capabilities.canReadAutomationOperations
        ? { status: "not_authorized", record: null }
        : !automationScopeAllowed
          ? { status: "out_of_scope", record: null }
          : !appointmentCatalogue
            ? { status: "not_authorized", record: null }
            : {
                status: "available",
                record: await loadAutomationOperation(
                  db,
                  session.workspaceId,
                  appointmentCatalogue,
                  reads,
                ),
              };
    const careOperation: OperationAccess<CareOperationRecord> =
      !capabilities.canReadCareOperations
        ? { status: "not_authorized", record: null }
        : !careScopeAllowed
          ? { status: "out_of_scope", record: null }
          : !careCatalogue
            ? { status: "not_authorized", record: null }
            : {
                status: "available",
                record: await loadCareOperation(
                  db,
                  session.workspaceId,
                  careCatalogue,
                  reads,
                ),
              };
    return {
      automationCatalogues,
      careCatalogue,
      automationOperation,
      careOperation,
    };
  } catch (error) {
    if (error instanceof AutomationWorkspaceDataError) throw error;
    const sourceCode =
      error instanceof AutomationCareRepositoryError
        ? error.code
        : typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : "";
    if (
      error instanceof AutomationCareRepositoryError &&
      error.code === "invalid_persisted_data"
    ) {
      throw new AutomationWorkspaceDataError(
        "Persisted Phase 5 data failed strict schema or governance validation.",
        "evidence_mismatch",
        sourceCode,
      );
    }
    if (
      sourceCode.includes("permission-denied") ||
      sourceCode.includes("unauthenticated")
    ) {
      throw new AutomationWorkspaceDataError(
        "Firestore denied this Phase 5 tenant, role, or exact scope.",
        "access_denied",
        sourceCode,
      );
    }
    throw new AutomationWorkspaceDataError(
      "The authoritative Phase 5 workspace could not be loaded.",
      "load_failed",
      sourceCode,
    );
  }
}

export function availableAutomationActions(
  session: VerifiedWorkspaceSession,
  operation: AutomationOperationRecord,
): readonly AutomationRunAction[] {
  if (
    !automationWorkspaceCapabilities(session).canControlRuns ||
    !sessionCanReadPatientScope(session, {
      teamId: String(operation.run.teamId),
      locationId: String(operation.run.locationId),
    })
  ) {
    return [];
  }
  return (
    [
      "start",
      "advance_step",
      "pause",
      "resume",
      "simulate_human_takeover",
      "release_human_takeover",
      "exercise_fallback",
      "inject_failure",
      "retry",
      "end",
    ] as const
  ).filter((action) =>
    canApplyAutomationRunAction(operation.run.state, action, {
      pausedFromState: operation.run.pausedFromState,
    }),
  );
}

export function availableCareActions(
  session: VerifiedWorkspaceSession,
  operation: CareOperationRecord,
  now: Date = new Date(),
): readonly CareEnrollmentAction[] {
  const capabilities = automationWorkspaceCapabilities(session);
  if (
    !capabilities.canControlEnrollments ||
    !sessionCanReadPatientScope(session, {
      teamId: String(operation.enrollment.teamId),
      locationId: String(operation.enrollment.locationId),
    })
  ) {
    return [];
  }
  const escalationActions = new Set<CareEnrollmentAction>([
    "clear_clinical_hold",
    "acknowledge_escalation",
    "resolve_escalation",
    "clear_safety_hold",
  ]);
  const contextAllows = (action: CareEnrollmentAction): boolean => {
    const { enrollment, handoff, openEscalation, pathway, safetyHoldEscalation } =
      operation;
    const terminalSuppression = enrollment.activeSuppressions.some(
      (reason) => reason !== "clinical_hold",
    );
    if (action === "start") {
      return (
        enrollment.activeSuppressions.length === 0 &&
        enrollment.openEscalationId === null &&
        enrollment.safetyHoldEscalationId === null &&
        enrollment.openHandoffId === null
      );
    }
    if (action === "advance_contact") {
      const dueAt =
        enrollment.nextContactAt === null
          ? Number.NaN
          : Date.parse(enrollment.nextContactAt);
      return (
        Number.isFinite(dueAt) &&
        dueAt <= now.getTime() &&
        enrollment.nextContactIndex < pathway.contactPoints.length &&
        enrollment.activeSuppressions.length === 0 &&
        enrollment.openEscalationId === null &&
        enrollment.safetyHoldEscalationId === null &&
        enrollment.openHandoffId === null
      );
    }
    if (action === "resume") {
      return (
        enrollment.activeSuppressions.length === 0 &&
        enrollment.openEscalationId === null &&
        enrollment.safetyHoldEscalationId === null &&
        enrollment.openHandoffId === null
      );
    }
    if (action === "end") return enrollment.openEscalationId === null;
    if (action === "human_takeover_started") {
      return (
        enrollment.openEscalationId === null &&
        enrollment.openHandoffId === null &&
        enrollment.activeSuppressions.length === 0
      );
    }
    if (action === "release_human_takeover") {
      return (
        enrollment.openHandoffId !== null &&
        handoff?.id === enrollment.openHandoffId &&
        handoff.state === "open"
      );
    }
    if (action === "clear_clinical_hold") {
      return (
        enrollment.activeSuppressions.includes("clinical_hold") &&
        !terminalSuppression &&
        enrollment.openEscalationId === null
      );
    }
    if (action === "raise_red_flag") {
      return enrollment.openEscalationId === null && openEscalation === null;
    }
    if (action === "acknowledge_escalation") {
      return (
        enrollment.openEscalationId !== null &&
        openEscalation?.id === enrollment.openEscalationId &&
        openEscalation.state === "open"
      );
    }
    if (action === "resolve_escalation") {
      return (
        enrollment.openEscalationId !== null &&
        openEscalation?.id === enrollment.openEscalationId &&
        openEscalation.state === "acknowledged"
      );
    }
    if (action === "clear_safety_hold") {
      return (
        enrollment.openEscalationId === null &&
        enrollment.safetyHoldEscalationId !== null &&
        enrollment.activeSuppressions.length === 0 &&
        safetyHoldEscalation?.id === enrollment.safetyHoldEscalationId &&
        safetyHoldEscalation.state === "resolved"
      );
    }
    return true;
  };
  return (
    [
      "start",
      "advance_contact",
      "pause",
      "resume",
      "end",
      "simulate_suppression",
      "human_takeover_started",
      "release_human_takeover",
      "clear_clinical_hold",
      "raise_red_flag",
      "acknowledge_escalation",
      "resolve_escalation",
      "clear_safety_hold",
    ] as const
  ).filter(
    (action) =>
      canApplyCareEnrollmentAction(operation.enrollment.state, action) &&
      contextAllows(action) &&
      (!escalationActions.has(action) || capabilities.canManageEscalations),
  );
}

export async function buildAutomationActionRequest(input: {
  readonly session: VerifiedWorkspaceSession;
  readonly operation: AutomationOperationRecord;
  readonly action: AutomationRunAction;
}): Promise<AutomationFunctionsRequest> {
  if (!availableAutomationActions(input.session, input.operation).includes(input.action)) {
    throw new AutomationWorkspaceDataError(
      "This authority cannot request the automation transition.",
      "access_denied",
    );
  }
  return buildAutomationFunctionsRequest({
    workspaceId: input.session.workspaceId,
    runId: String(input.operation.run.id),
    actorUid: input.session.uid,
    action: input.action,
    expectedRevision: input.operation.run.revision,
  });
}

export async function buildCareActionRequest(input: {
  readonly session: VerifiedWorkspaceSession;
  readonly operation: CareOperationRecord;
  readonly action: CareEnrollmentAction;
  readonly suppressionReason: CareSuppressionReason | null;
}): Promise<CareFunctionsRequest> {
  if (!availableCareActions(input.session, input.operation).includes(input.action)) {
    throw new AutomationWorkspaceDataError(
      "This authority cannot request the care transition.",
      "access_denied",
    );
  }
  return buildCareFunctionsRequest({
    workspaceId: input.session.workspaceId,
    enrollmentId: String(input.operation.enrollment.id),
    actorUid: input.session.uid,
    action: input.action,
    expectedRevision: input.operation.enrollment.revision,
    suppressionReason: input.action === "simulate_suppression" ? input.suppressionReason : null,
  });
}

export type AutomationActionEvidence = {
  readonly event: StaffSafeAutomationRunEvent;
  readonly audit: Phase5AuditRecordDTO;
  readonly workItem: StaffSafeAutomationWorkItem | null;
};

export type CareActionEvidence = {
  readonly event: StaffSafeCareEnrollmentEvent;
  readonly audit: Phase5AuditRecordDTO;
  readonly escalations: readonly StaffSafeCareEscalation[];
  readonly handoff: StaffSafeCareHandoff | null;
};

export async function readAutomationActionEvidence(
  db: Firestore,
  workspaceId: string,
  response: AutomationFunctionsResponse,
  reads: AutomationWorkspaceReads = defaultAutomationWorkspaceReads,
): Promise<AutomationActionEvidence> {
  const event = await reads.getAutomationRunEvent(db, {
    workspaceId,
    id: response.result.eventId,
  });
  const audit = await reads.getAudit(db, {
    workspaceId,
    id: response.auditEventId,
  });
  const workItemId = event.workItemId ?? response.result.openWorkItemId;
  const workItem =
    workItemId === null
      ? null
      : await reads.getAutomationWorkItem(db, {
          workspaceId,
          id: String(workItemId),
        });
  return { event, audit, workItem };
}

export async function readCareActionEvidence(
  db: Firestore,
  workspaceId: string,
  response: CareFunctionsResponse,
  reads: AutomationWorkspaceReads = defaultAutomationWorkspaceReads,
): Promise<CareActionEvidence> {
  const event = await reads.getCareEnrollmentEvent(db, {
    workspaceId,
    id: response.result.eventId,
  });
  const audit = await reads.getAudit(db, {
    workspaceId,
    id: response.auditEventId,
  });
  const escalationIds = [...new Set(
    [
      event.escalationId,
      response.result.openEscalationId,
      response.result.safetyHoldEscalationId,
    ].filter((id): id is NonNullable<typeof id> => id !== null),
  )];
  const escalations = await Promise.all(
    escalationIds.map((id) =>
      reads.getCareEscalation(db, { workspaceId, id: String(id) }),
    ),
  );
  const handoffId = event.handoffId ?? response.result.openHandoffId;
  const handoff =
    handoffId === null
      ? null
      : await reads.getCareHandoff(db, { workspaceId, id: String(handoffId) });
  return { event, audit, escalations, handoff };
}

function automationResponseRun(
  previous: AutomationOperationRecord,
  response: AutomationFunctionsResponse,
  event: StaffSafeAutomationRunEvent,
): StaffSafeAutomationRun {
  let pausedFromState: StaffSafeAutomationRun["pausedFromState"] = null;
  if (event.action === "pause") {
    pausedFromState = previous.run.state as NonNullable<
      StaffSafeAutomationRun["pausedFromState"]
    >;
  } else if (event.action === "simulate_human_takeover") {
    pausedFromState =
      previous.run.state === "paused_by_operator"
        ? previous.run.pausedFromState
        : (previous.run.state as NonNullable<
            StaffSafeAutomationRun["pausedFromState"]
          >);
  } else if (
    event.action === "exercise_fallback" &&
    (response.result.state === "paused_by_operator" ||
      response.result.state === "paused_for_human")
  ) {
    pausedFromState = previous.run.state as NonNullable<
      StaffSafeAutomationRun["pausedFromState"]
    >;
  } else if (event.action === "release_human_takeover") {
    pausedFromState = previous.run.pausedFromState;
  }
  return {
    ...previous.run,
    state: response.result.state,
    pausedFromState,
    nextEligibleAt: response.result.nextEligibleAt,
    openWorkItemId: response.result.openWorkItemId,
    currentStepIndex: response.result.currentStepIndex,
    completedStepCount: response.result.completedStepCount,
    attemptCount: response.result.attemptCount,
    revision: response.result.revision,
    outcomeCode: response.result.outcomeCode,
    lastEventId: response.result.eventId,
    updatedAt: event.occurredAt,
  } as StaffSafeAutomationRun;
}

function expectedAutomationWorkItem(
  previous: AutomationOperationRecord,
  response: AutomationFunctionsResponse,
  event: StaffSafeAutomationRunEvent,
  actual: StaffSafeAutomationWorkItem | null,
): StaffSafeAutomationWorkItem | null {
  if (event.workItemId === null) return null;
  const prior = previous.workItem;
  if (previous.run.openWorkItemId === null) {
    if (prior !== null || actual === null) {
      evidenceMismatch("The automation event cannot create a substituted work item.");
    }
    return {
      ...actual,
      state: "open",
      openedAt: event.occurredAt,
      assignedMemberUid: null,
      acknowledgedAt: null,
      acknowledgedByUid: null,
      resolvedAt: null,
      resolvedByUid: null,
      resolutionCode: null,
      revision: 1,
      lastEventId: event.id,
      createdAt: event.occurredAt,
      updatedAt: event.occurredAt,
    };
  }
  if (
    prior === null ||
    prior.id !== previous.run.openWorkItemId ||
    prior.id !== event.workItemId
  ) {
    evidenceMismatch("The automation event did not bind the exact prior work item.");
  }
  const expected = {
    ...prior,
    revision: prior.revision + 1,
    lastEventId: event.id,
    updatedAt: event.occurredAt,
  } as StaffSafeAutomationWorkItem;
  if (response.result.openWorkItemId === null) {
    return {
      ...expected,
      state: "resolved",
      acknowledgedAt:
        prior.state === "open" ? event.occurredAt : prior.acknowledgedAt,
      acknowledgedByUid:
        prior.state === "open" ? event.actorUid : prior.acknowledgedByUid,
      resolvedAt: event.occurredAt,
      resolvedByUid: event.actorUid,
      resolutionCode:
        event.action === "release_human_takeover"
          ? "routed_to_human"
          : event.action === "end" ||
              event.outcomeCode === "fallback_stopped_safely"
            ? "stopped_safely"
            : "retried",
    } as StaffSafeAutomationWorkItem;
  }
  if (
    event.action === "release_human_takeover" &&
    previous.run.pausedFromState === "failed" &&
    prior.state === "open"
  ) {
    return {
      ...expected,
      state: "acknowledged",
      acknowledgedAt: event.occurredAt,
      acknowledgedByUid: event.actorUid,
    } as StaffSafeAutomationWorkItem;
  }
  return expected;
}

function assertAutomationWorkItemAfterAction(input: {
  readonly previous: AutomationOperationRecord;
  readonly current: AutomationOperationRecord;
  readonly response: AutomationFunctionsResponse;
  readonly event: StaffSafeAutomationRunEvent;
  readonly actual: StaffSafeAutomationWorkItem | null;
}): void {
  const expected = expectedAutomationWorkItem(
    input.previous,
    input.response,
    input.event,
    input.actual,
  );
  const immediate = input.current.run.revision === input.response.result.revision;
  const nextForTransition = immediate ? input.actual : expected;
  try {
    assertAutomationRunOperationalTransition(
      input.previous.run,
      automationResponseRun(input.previous, input.response, input.event),
      input.event,
      input.previous.definition,
      input.event.workItemId === null
        ? null
        : {
            previous: input.previous.workItem,
            next: nextForTransition,
          },
    );
  } catch {
    evidenceMismatch(
      "The callable automation event failed its exact approved-step or work-item transition join.",
    );
  }
  if ((expected === null) !== (input.actual === null)) {
    evidenceMismatch("The callable automation work-item evidence is incomplete.");
  }
  if (expected === null || input.actual === null) return;
  const actual = input.actual;
  if (
    actual.id !== expected.id ||
    actual.workspaceId !== expected.workspaceId ||
    actual.runId !== expected.runId ||
    actual.definitionId !== expected.definitionId ||
    actual.definitionVersion !== expected.definitionVersion ||
    actual.definitionContentHash !== expected.definitionContentHash ||
    actual.teamId !== expected.teamId ||
    actual.locationId !== expected.locationId ||
    actual.reasonCode !== expected.reasonCode ||
    actual.openedAt !== expected.openedAt ||
    actual.slaMinutes !== expected.slaMinutes ||
    actual.dueAt !== expected.dueAt ||
    actual.assignedMemberUid !== expected.assignedMemberUid ||
    actual.createdAt !== expected.createdAt
  ) {
    evidenceMismatch("The callable automation work item changed immutable evidence.");
  }
  if (immediate) {
    if (
      actual.state !== expected.state ||
      actual.acknowledgedAt !== expected.acknowledgedAt ||
      actual.acknowledgedByUid !== expected.acknowledgedByUid ||
      actual.resolvedAt !== expected.resolvedAt ||
      actual.resolvedByUid !== expected.resolvedByUid ||
      actual.resolutionCode !== expected.resolutionCode ||
      actual.revision !== expected.revision ||
      actual.lastEventId !== expected.lastEventId ||
      actual.updatedAt !== expected.updatedAt
    ) {
      evidenceMismatch(
        "The callable automation work item does not show the exact post-action lifecycle.",
      );
    }
    return;
  }
  const rank = { open: 0, acknowledged: 1, resolved: 2 } as const;
  const rankDelta = rank[actual.state] - rank[expected.state];
  if (
    rankDelta < 0 ||
    actual.revision < expected.revision + rankDelta ||
    Date.parse(actual.updatedAt) < Date.parse(expected.updatedAt) ||
    (actual.revision === expected.revision &&
      actual.lastEventId !== expected.lastEventId) ||
    (expected.state !== "open" &&
      (actual.acknowledgedAt !== expected.acknowledgedAt ||
        actual.acknowledgedByUid !== expected.acknowledgedByUid)) ||
    (expected.state === "resolved" &&
      (actual.state !== "resolved" ||
        actual.resolvedAt !== expected.resolvedAt ||
        actual.resolvedByUid !== expected.resolvedByUid ||
        actual.resolutionCode !== expected.resolutionCode))
  ) {
    evidenceMismatch(
      "The historical automation work item is older than or incompatible with the action event.",
    );
  }
}

function sameCareSuppressions(
  left: readonly CareSuppressionReason[],
  right: readonly CareSuppressionReason[],
): boolean {
  return (
    left.length === right.length &&
    left.every((reason, index) => reason === right[index])
  );
}

function expectedCareEventEscalation(
  previous: CareOperationRecord,
  action: CareEnrollmentAction,
  result: CareFunctionsResponse["result"],
): StaffSafeCareEscalation | null {
  if (action === "raise_red_flag") return null;
  if (
    action === "acknowledge_escalation" ||
    action === "resolve_escalation" ||
    (action === "simulate_suppression" &&
      previous.enrollment.state === "escalated")
  ) {
    return previous.openEscalation;
  }
  if (action === "clear_safety_hold") return previous.safetyHoldEscalation;
  if (result.openEscalationId !== null) return previous.openEscalation;
  return null;
}

function expectedCareEscalationAfterAction(input: {
  readonly previous: CareOperationRecord;
  readonly response: CareFunctionsResponse;
  readonly event: StaffSafeCareEnrollmentEvent;
  readonly actual: StaffSafeCareEscalation;
}): StaffSafeCareEscalation {
  if (input.event.actorKind !== "staff" || input.event.actorUid === null) {
    evidenceMismatch("Care escalation evidence requires the verified staff actor.");
  }
  const eventActor = {
    actorKind: "staff" as const,
    actorUid: input.event.actorUid,
  };
  const prior = expectedCareEventEscalation(
    input.previous,
    input.event.action,
    input.response.result,
  );
  if (input.event.action === "raise_red_flag") {
    return {
      ...input.actual,
      reasonCode: "red_flag_response",
      state: "open",
      openedAt: input.event.occurredAt,
      responseSlaMinutes: input.previous.pathway.responseSlaMinutes,
      responseDueAt: new Date(
        Date.parse(input.event.occurredAt) +
          input.previous.pathway.responseSlaMinutes * 60_000,
      ).toISOString() as StaffSafeCareEscalation["responseDueAt"],
      openedBy: eventActor,
      acknowledgedAt: null,
      acknowledgedByUid: null,
      resolvedAt: null,
      resolvedByUid: null,
      resolutionCode: null,
      writeBackRequired: input.previous.pathway.writeBackRequired,
      writeBackState: input.previous.pathway.writeBackRequired
        ? "pending"
        : "not_required",
      revision: 1,
      lastEventId: input.event.id,
      createdAt: input.event.occurredAt,
      updatedAt: input.event.occurredAt,
    };
  }
  if (
    prior === null ||
    prior.id !== input.event.escalationId ||
    input.actual.id !== prior.id
  ) {
    evidenceMismatch("The care event did not bind its exact prior escalation.");
  }
  const expected = {
    ...prior,
    revision: prior.revision + 1,
    lastEventId: input.event.id,
    updatedAt: input.event.occurredAt,
  } as StaffSafeCareEscalation;
  if (input.event.action === "acknowledge_escalation") {
    return {
      ...expected,
      state: "acknowledged",
      acknowledgedAt: input.event.occurredAt,
      acknowledgedByUid: input.event.actorUid,
    } as StaffSafeCareEscalation;
  }
  if (input.event.action === "resolve_escalation") {
    return {
      ...expected,
      state: "resolved",
      resolvedAt: input.event.occurredAt,
      resolvedByUid: input.event.actorUid,
      resolutionCode:
        input.response.result.state === "ended"
          ? "terminal_suppression_applied"
          : "safety_hold_applied",
      writeBackState: prior.writeBackRequired
        ? "unavailable_in_demo"
        : "not_required",
    } as StaffSafeCareEscalation;
  }
  return expected;
}

function assertCareEscalationAfterAction(input: {
  readonly previous: CareOperationRecord;
  readonly current: CareOperationRecord;
  readonly response: CareFunctionsResponse;
  readonly event: StaffSafeCareEnrollmentEvent;
  readonly actual: StaffSafeCareEscalation;
}): void {
  const expected = expectedCareEscalationAfterAction(input);
  const actual = input.actual;
  if (
    actual.id !== expected.id ||
    actual.workspaceId !== expected.workspaceId ||
    actual.enrollmentId !== expected.enrollmentId ||
    actual.pathwayId !== expected.pathwayId ||
    actual.pathwayProtocolVersion !== expected.pathwayProtocolVersion ||
    actual.pathwayContentHash !== expected.pathwayContentHash ||
    actual.teamId !== expected.teamId ||
    actual.locationId !== expected.locationId ||
    actual.reasonCode !== expected.reasonCode ||
    actual.openedAt !== expected.openedAt ||
    actual.responseSlaMinutes !== expected.responseSlaMinutes ||
    actual.responseDueAt !== expected.responseDueAt ||
    actual.openedBy.actorKind !== expected.openedBy.actorKind ||
    actual.openedBy.actorUid !== expected.openedBy.actorUid ||
    actual.writeBackRequired !== expected.writeBackRequired ||
    actual.createdAt !== expected.createdAt
  ) {
    evidenceMismatch("The callable care escalation changed immutable evidence.");
  }
  const immediate =
    input.current.enrollment.revision === input.response.result.revision;
  if (immediate) {
    if (
      actual.state !== expected.state ||
      actual.acknowledgedAt !== expected.acknowledgedAt ||
      actual.acknowledgedByUid !== expected.acknowledgedByUid ||
      actual.resolvedAt !== expected.resolvedAt ||
      actual.resolvedByUid !== expected.resolvedByUid ||
      actual.resolutionCode !== expected.resolutionCode ||
      actual.writeBackState !== expected.writeBackState ||
      actual.revision !== expected.revision ||
      actual.lastEventId !== expected.lastEventId ||
      actual.updatedAt !== expected.updatedAt
    ) {
      evidenceMismatch(
        "The callable care escalation does not show the exact post-action lifecycle.",
      );
    }
    return;
  }
  const rank = { open: 0, acknowledged: 1, resolved: 2 } as const;
  const rankDelta = rank[actual.state] - rank[expected.state];
  if (
    rankDelta < 0 ||
    actual.revision < expected.revision + rankDelta ||
    Date.parse(actual.updatedAt) < Date.parse(expected.updatedAt) ||
    (actual.revision === expected.revision &&
      actual.lastEventId !== expected.lastEventId) ||
    (expected.state !== "open" &&
      (actual.acknowledgedAt !== expected.acknowledgedAt ||
        actual.acknowledgedByUid !== expected.acknowledgedByUid)) ||
    (expected.state === "resolved" &&
      (actual.state !== "resolved" ||
        actual.resolvedAt !== expected.resolvedAt ||
        actual.resolvedByUid !== expected.resolvedByUid ||
        actual.resolutionCode !== expected.resolutionCode ||
        actual.writeBackState !== expected.writeBackState))
  ) {
    evidenceMismatch(
      "The historical care escalation is older than or incompatible with the action event.",
    );
  }
}

function assertCareEscalationPointerContinuity(input: {
  readonly prior: StaffSafeCareEscalation;
  readonly actual: StaffSafeCareEscalation;
  readonly immediate: boolean;
}): void {
  const { actual, immediate, prior } = input;
  if (
    actual.id !== prior.id ||
    actual.workspaceId !== prior.workspaceId ||
    actual.enrollmentId !== prior.enrollmentId ||
    actual.pathwayId !== prior.pathwayId ||
    actual.pathwayProtocolVersion !== prior.pathwayProtocolVersion ||
    actual.pathwayContentHash !== prior.pathwayContentHash ||
    actual.teamId !== prior.teamId ||
    actual.locationId !== prior.locationId ||
    actual.reasonCode !== prior.reasonCode ||
    actual.openedAt !== prior.openedAt ||
    actual.responseSlaMinutes !== prior.responseSlaMinutes ||
    actual.responseDueAt !== prior.responseDueAt ||
    actual.openedBy.actorKind !== prior.openedBy.actorKind ||
    actual.openedBy.actorUid !== prior.openedBy.actorUid ||
    actual.writeBackRequired !== prior.writeBackRequired ||
    actual.createdAt !== prior.createdAt
  ) {
    evidenceMismatch("A retained care escalation pointer changed immutable evidence.");
  }
  if (immediate) {
    if (
      actual.state !== prior.state ||
      actual.acknowledgedAt !== prior.acknowledgedAt ||
      actual.acknowledgedByUid !== prior.acknowledgedByUid ||
      actual.resolvedAt !== prior.resolvedAt ||
      actual.resolvedByUid !== prior.resolvedByUid ||
      actual.resolutionCode !== prior.resolutionCode ||
      actual.writeBackState !== prior.writeBackState ||
      actual.revision !== prior.revision ||
      actual.lastEventId !== prior.lastEventId ||
      actual.updatedAt !== prior.updatedAt
    ) {
      evidenceMismatch(
        "A care action mutated an escalation aggregate that its event did not bind.",
      );
    }
    return;
  }
  const rank = { open: 0, acknowledged: 1, resolved: 2 } as const;
  const rankDelta = rank[actual.state] - rank[prior.state];
  if (
    rankDelta < 0 ||
    actual.revision < prior.revision + rankDelta ||
    Date.parse(actual.updatedAt) < Date.parse(prior.updatedAt) ||
    (prior.state !== "open" &&
      (actual.acknowledgedAt !== prior.acknowledgedAt ||
        actual.acknowledgedByUid !== prior.acknowledgedByUid)) ||
    (prior.state === "resolved" &&
      (actual.state !== "resolved" ||
        actual.resolvedAt !== prior.resolvedAt ||
        actual.resolvedByUid !== prior.resolvedByUid ||
        actual.resolutionCode !== prior.resolutionCode ||
        actual.writeBackState !== prior.writeBackState))
  ) {
    evidenceMismatch(
      "A retained historical care escalation pointer regressed or was substituted.",
    );
  }
}

function expectedCareHandoffAfterAction(input: {
  readonly previous: CareOperationRecord;
  readonly event: StaffSafeCareEnrollmentEvent;
  readonly actual: StaffSafeCareHandoff;
}): StaffSafeCareHandoff {
  if (input.event.actorKind !== "staff" || input.event.actorUid === null) {
    evidenceMismatch("Care handoff evidence requires the verified staff actor.");
  }
  const eventActor = {
    actorKind: "staff" as const,
    actorUid: input.event.actorUid,
  };
  const prior = input.previous.handoff;
  if (input.event.action === "human_takeover_started") {
    return {
      ...input.actual,
      state: "open",
      openedEventId: input.event.id,
      openedBy: eventActor,
      openedAt: input.event.occurredAt,
      releasedEventId: null,
      releasedBy: null,
      releasedAt: null,
      revision: 1,
      lastEventId: input.event.id,
      createdAt: input.event.occurredAt,
      updatedAt: input.event.occurredAt,
    };
  }
  if (
    prior === null ||
    prior.id !== input.event.handoffId ||
    input.actual.id !== prior.id
  ) {
    evidenceMismatch("The care event did not bind its exact prior handoff.");
  }
  return {
    ...prior,
    state: "released",
    releasedEventId: input.event.id,
    releasedBy: eventActor,
    releasedAt: input.event.occurredAt,
    revision: prior.revision + 1,
    lastEventId: input.event.id,
    updatedAt: input.event.occurredAt,
  } as StaffSafeCareHandoff;
}

function assertCareHandoffAfterAction(input: {
  readonly previous: CareOperationRecord;
  readonly current: CareOperationRecord;
  readonly response: CareFunctionsResponse;
  readonly event: StaffSafeCareEnrollmentEvent;
  readonly actual: StaffSafeCareHandoff;
}): void {
  const expected = expectedCareHandoffAfterAction(input);
  const actual = input.actual;
  if (
    actual.id !== expected.id ||
    actual.workspaceId !== expected.workspaceId ||
    actual.enrollmentId !== expected.enrollmentId ||
    actual.pathwayId !== expected.pathwayId ||
    actual.pathwayProtocolVersion !== expected.pathwayProtocolVersion ||
    actual.pathwayContentHash !== expected.pathwayContentHash ||
    actual.teamId !== expected.teamId ||
    actual.locationId !== expected.locationId ||
    actual.openedEventId !== expected.openedEventId ||
    actual.openedBy.actorKind !== expected.openedBy.actorKind ||
    actual.openedBy.actorUid !== expected.openedBy.actorUid ||
    actual.openedAt !== expected.openedAt ||
    actual.createdAt !== expected.createdAt
  ) {
    evidenceMismatch("The callable care handoff changed immutable evidence.");
  }
  const immediate =
    input.current.enrollment.revision === input.response.result.revision;
  if (immediate) {
    if (
      actual.state !== expected.state ||
      actual.releasedEventId !== expected.releasedEventId ||
      actual.releasedBy?.actorKind !== expected.releasedBy?.actorKind ||
      actual.releasedBy?.actorUid !== expected.releasedBy?.actorUid ||
      actual.releasedAt !== expected.releasedAt ||
      actual.revision !== expected.revision ||
      actual.lastEventId !== expected.lastEventId ||
      actual.updatedAt !== expected.updatedAt
    ) {
      evidenceMismatch(
        "The callable care handoff does not show the exact post-action lifecycle.",
      );
    }
    return;
  }
  const rank = { open: 0, released: 1 } as const;
  const rankDelta = rank[actual.state] - rank[expected.state];
  if (
    rankDelta < 0 ||
    actual.revision < expected.revision + rankDelta ||
    Date.parse(actual.updatedAt) < Date.parse(expected.updatedAt) ||
    (actual.revision === expected.revision &&
      actual.lastEventId !== expected.lastEventId) ||
    (expected.state === "released" &&
      (actual.state !== "released" ||
        actual.releasedEventId !== expected.releasedEventId ||
        actual.releasedBy?.actorKind !== expected.releasedBy?.actorKind ||
        actual.releasedBy?.actorUid !== expected.releasedBy?.actorUid ||
        actual.releasedAt !== expected.releasedAt))
  ) {
    evidenceMismatch(
      "The historical care handoff is older than or incompatible with the action event.",
    );
  }
}

export async function assertAutomationActionEvidence(input: {
  readonly session: VerifiedWorkspaceSession;
  readonly previous: AutomationOperationRecord;
  readonly current: AutomationOperationRecord;
  readonly request: AutomationFunctionsRequest;
  readonly response: AutomationFunctionsResponse;
  readonly evidence: AutomationActionEvidence;
}): Promise<void> {
  const { current, evidence, previous, request, response, session } = input;
  const result = response.result;
  const run = current.run;
  if (
    request.workspaceId !== session.workspaceId ||
    request.runId !== previous.run.id ||
    request.action !== result.action ||
    previous.run.id !== result.runId ||
    previous.run.revision !== request.expectedRevision ||
    result.revision !== previous.run.revision + 1 ||
    run.id !== result.runId ||
    run.workspaceId !== session.workspaceId ||
    run.revision < result.revision ||
    (run.revision === result.revision &&
      (run.lastEventId !== result.eventId ||
        run.state !== result.state ||
        run.currentStepIndex !== result.currentStepIndex ||
        run.completedStepCount !== result.completedStepCount ||
        run.attemptCount !== result.attemptCount ||
        run.nextEligibleAt !== result.nextEligibleAt ||
        run.openWorkItemId !== result.openWorkItemId ||
        run.outcomeCode !== result.outcomeCode))
  ) {
    evidenceMismatch("The callable automation result does not match authoritative state.");
  }
  const event = evidence.event;
  if (
    event.id !== result.eventId ||
    event.runId !== result.runId ||
    event.workspaceId !== session.workspaceId ||
    event.definitionId !== previous.run.definitionId ||
    event.definitionVersion !== previous.run.definitionVersion ||
    event.definitionContentHash !== previous.run.definitionContentHash ||
    event.teamId !== previous.run.teamId ||
    event.locationId !== previous.run.locationId ||
    event.actorKind !== "staff" ||
    event.actorUid !== session.uid ||
    event.action !== result.action ||
    event.fromState !== previous.run.state ||
    event.toState !== result.state ||
    event.revision !== result.revision ||
    event.outcomeCode !== result.outcomeCode ||
    event.nextEligibleAt !== result.nextEligibleAt ||
    event.auditEventId !== response.auditEventId
  ) {
    evidenceMismatch("The callable automation event failed its exact action join.");
  }
  try {
    assertPhase5EventAuditJoin(
      event,
      evidence.audit,
      "automation_run",
      result.runId,
    );
  } catch {
    evidenceMismatch("The callable automation audit failed its exact event join.");
  }
  if (
    evidence.audit.id !== response.auditEventId ||
    evidence.audit.actorUid !== session.uid ||
    evidence.audit.metadata.resultFingerprint !==
      (await automationControlResultFingerprint(result))
  ) {
    evidenceMismatch("The callable automation result fingerprint does not match its audit.");
  }
  assertAutomationWorkItemAfterAction({
    previous,
    current,
    response,
    event,
    actual: evidence.workItem,
  });
}

export async function assertCareActionEvidence(input: {
  readonly session: VerifiedWorkspaceSession;
  readonly previous: CareOperationRecord;
  readonly current: CareOperationRecord;
  readonly request: CareFunctionsRequest;
  readonly response: CareFunctionsResponse;
  readonly evidence: CareActionEvidence;
}): Promise<void> {
  const { current, evidence, previous, request, response, session } = input;
  const result = response.result;
  const enrollment = current.enrollment;
  if (
    request.action === "simulate_suppression" &&
    request.suppressionReason === null
  ) {
    evidenceMismatch("The callable care suppression request lost its reason.");
  }
  const expectedSuppressions =
    request.action === "simulate_suppression" &&
    request.suppressionReason !== null
      ? orderCareSuppressions([
          ...previous.enrollment.activeSuppressions,
          request.suppressionReason,
        ])
      : request.action === "clear_clinical_hold"
        ? orderCareSuppressions(
            previous.enrollment.activeSuppressions.filter(
              (reason) => reason !== "clinical_hold",
            ),
          )
        : orderCareSuppressions(previous.enrollment.activeSuppressions);
  const expectedNextContactIndex =
    request.action === "advance_contact"
      ? previous.enrollment.nextContactIndex + 1
      : previous.enrollment.nextContactIndex;
  if (
    request.workspaceId !== session.workspaceId ||
    request.enrollmentId !== previous.enrollment.id ||
    request.action !== result.action ||
    previous.enrollment.id !== result.enrollmentId ||
    previous.enrollment.revision !== request.expectedRevision ||
    result.revision !== previous.enrollment.revision + 1 ||
    result.nextContactIndex !== expectedNextContactIndex ||
    enrollment.id !== result.enrollmentId ||
    enrollment.workspaceId !== session.workspaceId ||
    enrollment.revision < result.revision ||
    (enrollment.revision === result.revision &&
      (enrollment.lastEventId !== result.eventId ||
        enrollment.state !== result.state ||
        enrollment.nextContactIndex !== result.nextContactIndex ||
        enrollment.nextContactAt !== result.nextContactAt ||
        enrollment.openEscalationId !== result.openEscalationId ||
        enrollment.safetyHoldEscalationId !== result.safetyHoldEscalationId ||
        enrollment.openHandoffId !== result.openHandoffId ||
        !sameCareSuppressions(
          enrollment.activeSuppressions,
          expectedSuppressions,
        ) ||
        enrollment.outcomeCode !== result.outcomeCode))
  ) {
    evidenceMismatch("The callable care result does not match authoritative state.");
  }
  const event = evidence.event;
  const expectedEventEscalation = expectedCareEventEscalation(
    previous,
    request.action,
    result,
  );
  const expectedEventEscalationId =
    request.action === "raise_red_flag"
      ? result.openEscalationId
      : expectedEventEscalation?.id ?? null;
  const expectedEscalationStateBefore =
    request.action === "raise_red_flag"
      ? null
      : expectedEventEscalation?.state ?? null;
  const expectedEscalationStateAfter =
    request.action === "raise_red_flag"
      ? "open"
      : request.action === "acknowledge_escalation"
        ? "acknowledged"
        : request.action === "resolve_escalation"
          ? "resolved"
          : expectedEscalationStateBefore;
  const expectedEventHandoffId =
    request.action === "human_takeover_started"
      ? result.openHandoffId
      : previous.enrollment.openHandoffId;
  let expectedOpenEscalationId: string | null =
    previous.enrollment.openEscalationId;
  if (request.action === "raise_red_flag") {
    expectedOpenEscalationId = expectedEventEscalationId;
  } else if (request.action === "resolve_escalation") {
    expectedOpenEscalationId = null;
  }
  let expectedSafetyHoldEscalationId: string | null =
    previous.enrollment.safetyHoldEscalationId;
  if (request.action === "resolve_escalation") {
    expectedSafetyHoldEscalationId =
      result.outcomeCode === "escalation_resolved_safety_hold"
        ? expectedEventEscalationId
        : null;
  } else if (
    request.action === "clear_safety_hold" ||
    result.state === "completed" ||
    result.state === "ended"
  ) {
    expectedSafetyHoldEscalationId = null;
  }
  let expectedOpenHandoffId: string | null =
    previous.enrollment.openHandoffId;
  if (request.action === "human_takeover_started") {
    expectedOpenHandoffId = expectedEventHandoffId;
  } else if (
    previous.enrollment.state === "paused_for_human" ||
    request.action === "end" ||
    request.action === "simulate_suppression" ||
    request.action === "raise_red_flag"
  ) {
    expectedOpenHandoffId = null;
  }
  if (
    event.id !== result.eventId ||
    event.enrollmentId !== result.enrollmentId ||
    event.workspaceId !== session.workspaceId ||
    event.pathwayId !== previous.enrollment.pathwayId ||
    event.pathwayProtocolVersion !==
      previous.enrollment.pathwayProtocolVersion ||
    event.pathwayContentHash !== previous.enrollment.pathwayContentHash ||
    event.teamId !== previous.enrollment.teamId ||
    event.locationId !== previous.enrollment.locationId ||
    event.actorKind !== "staff" ||
    event.actorUid !== session.uid ||
    event.action !== result.action ||
    event.fromState !== previous.enrollment.state ||
    event.toState !== result.state ||
    event.revision !== result.revision ||
    event.outcomeCode !== result.outcomeCode ||
    event.nextContactAt !== result.nextContactAt ||
    event.contactPointIndex !==
      (request.action === "advance_contact"
        ? previous.enrollment.nextContactIndex
        : null) ||
    event.suppressionReason !== request.suppressionReason ||
    !sameCareSuppressions(
      event.activeSuppressionsAfter,
      expectedSuppressions,
    ) ||
    event.escalationId !== expectedEventEscalationId ||
    event.escalationStateBefore !== expectedEscalationStateBefore ||
    event.escalationStateAfter !== expectedEscalationStateAfter ||
    event.handoffId !== expectedEventHandoffId ||
    result.openEscalationId !== expectedOpenEscalationId ||
    result.safetyHoldEscalationId !== expectedSafetyHoldEscalationId ||
    result.openHandoffId !== expectedOpenHandoffId ||
    event.auditEventId !== response.auditEventId
  ) {
    evidenceMismatch("The callable care event failed its exact action join.");
  }
  try {
    assertCareEnrollmentEventTrace(event);
  } catch {
    evidenceMismatch("The callable care event failed its governed action trace.");
  }
  try {
    assertPhase5EventAuditJoin(
      event,
      evidence.audit,
      "care_enrollment",
      result.enrollmentId,
    );
  } catch {
    evidenceMismatch("The callable care audit failed its exact event join.");
  }
  if (
    evidence.audit.id !== response.auditEventId ||
    evidence.audit.actorUid !== session.uid ||
    evidence.audit.metadata.resultFingerprint !==
      (await careControlResultFingerprint(result))
  ) {
    evidenceMismatch("The callable care result fingerprint does not match its audit.");
  }
  const expectedEscalationIds = new Set(
    [
      event.escalationId,
      result.openEscalationId,
      result.safetyHoldEscalationId,
    ].filter((id): id is NonNullable<typeof id> => id !== null),
  );
  if (
    evidence.escalations.length !== expectedEscalationIds.size ||
    evidence.escalations.some((escalation) => {
      assertEscalationJoin(enrollment, escalation);
      return !expectedEscalationIds.has(escalation.id);
    })
  ) {
    evidenceMismatch("The callable care escalation pointers failed exact aggregate joins.");
  }
  const eventEscalation =
    event.escalationId === null
      ? null
      : evidence.escalations.find(
          (escalation) => escalation.id === event.escalationId,
        ) ?? null;
  if (event.escalationId !== null) {
    if (eventEscalation === null) {
      evidenceMismatch("The callable care event escalation aggregate is missing.");
    }
    assertCareEscalationAfterAction({
      previous,
      current,
      response,
      event,
      actual: eventEscalation,
    });
  }
  for (const escalation of evidence.escalations) {
    if (escalation.id === event.escalationId) continue;
    const prior = [
      previous.openEscalation,
      previous.safetyHoldEscalation,
    ].find((candidate) => candidate?.id === escalation.id);
    if (prior === undefined || prior === null) {
      evidenceMismatch(
        "The callable care response introduced an escalation pointer outside its event.",
      );
    }
    assertCareEscalationPointerContinuity({
      prior,
      actual: escalation,
      immediate: enrollment.revision === result.revision,
    });
  }
  const openEscalation =
    result.openEscalationId === null
      ? null
      : evidence.escalations.find(
          (escalation) => escalation.id === result.openEscalationId,
        ) ?? null;
  const safetyEscalation =
    result.safetyHoldEscalationId === null
      ? null
      : evidence.escalations.find(
          (escalation) => escalation.id === result.safetyHoldEscalationId,
        ) ?? null;
  if (
    (result.openEscalationId !== null &&
      (openEscalation === null || openEscalation.state === "resolved")) ||
    (result.safetyHoldEscalationId !== null &&
      safetyEscalation?.state !== "resolved")
  ) {
    evidenceMismatch(
      "The callable care result pointers do not bind actionable escalation states.",
    );
  }
  if (enrollment.revision === result.revision) {
    if (
      (result.openEscalationId !== null &&
        (current.openEscalation === null ||
          openEscalation === null ||
          current.openEscalation.id !== openEscalation.id ||
          current.openEscalation.state !== openEscalation.state ||
          current.openEscalation.revision !== openEscalation.revision ||
          current.openEscalation.lastEventId !== openEscalation.lastEventId ||
          current.openEscalation.updatedAt !== openEscalation.updatedAt)) ||
      (result.safetyHoldEscalationId !== null &&
        (current.safetyHoldEscalation === null ||
          safetyEscalation === null ||
          current.safetyHoldEscalation.id !== safetyEscalation.id ||
          current.safetyHoldEscalation.state !== safetyEscalation.state ||
          current.safetyHoldEscalation.revision !== safetyEscalation.revision ||
          current.safetyHoldEscalation.lastEventId !==
            safetyEscalation.lastEventId ||
          current.safetyHoldEscalation.updatedAt !== safetyEscalation.updatedAt))
    ) {
      evidenceMismatch(
        "The callable care escalation pointers differ from the installed authoritative state.",
      );
    }
  }
  const expectedHandoffId = event.handoffId ?? result.openHandoffId;
  if (
    (expectedHandoffId === null) !== (evidence.handoff === null) ||
    (evidence.handoff !== null && evidence.handoff.id !== expectedHandoffId)
  ) {
    evidenceMismatch("The callable care handoff pointer failed its exact aggregate join.");
  }
  if (evidence.handoff !== null) {
    assertHandoffJoin(enrollment, evidence.handoff);
    if (event.handoffId !== null) {
      assertCareHandoffAfterAction({
        previous,
        current,
        response,
        event,
        actual: evidence.handoff,
      });
    }
    if (
      result.openHandoffId !== null &&
      evidence.handoff.state !== "open"
    ) {
      evidenceMismatch("The callable care open-handoff pointer is not open.");
    }
    if (
      enrollment.revision === result.revision &&
      result.openHandoffId !== null &&
      (current.handoff === null ||
        current.handoff.id !== evidence.handoff.id ||
        current.handoff.state !== evidence.handoff.state ||
        current.handoff.revision !== evidence.handoff.revision ||
        current.handoff.lastEventId !== evidence.handoff.lastEventId ||
        current.handoff.updatedAt !== evidence.handoff.updatedAt)
    ) {
      evidenceMismatch(
        "The callable care handoff differs from the installed authoritative state.",
      );
    }
  }
}

export function describeAutomationWorkspaceError(error: unknown): string {
  const sourceCode =
    error instanceof AutomationWorkspaceDataError
      ? error.sourceCode
      : typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
  if (
    error instanceof AutomationWorkspaceDataError &&
    error.code === "access_denied"
  ) {
    return "This verified role cannot read either Phase 5 governance family.";
  }
  if (sourceCode.includes("permission-denied")) {
    return "Firestore denied this role, tenant, or exact team-and-location scope.";
  }
  if (sourceCode.includes("failed-precondition")) {
    return "The local Firestore indexes are not ready for the bounded catalogues.";
  }
  if (
    error instanceof AutomationWorkspaceDataError &&
    error.code === "evidence_mismatch"
  ) {
    return "Persisted Phase 5 evidence failed an exact schema, activation, event, audit, pointer, or result-fingerprint join. The view stayed closed.";
  }
  return "The local Firestore emulator could not load authoritative Phase 5 evidence. No cache, fixture, secret collection, or cloud fallback was used.";
}

export function roleCanReadAnyAutomationFamily(role: WorkspaceRole): boolean {
  return ["tenant_admin", "supervisor", "analyst", "clinical_approver"].includes(
    role,
  );
}
