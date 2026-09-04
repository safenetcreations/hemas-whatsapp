import type { Firestore } from "firebase/firestore";
import {
  buildPatientRecordScopePlan,
  type PatientRecordAuthority,
  type PatientRecordScopePlan,
} from "@/lib/firebase/patient-record-scope";
import {
  listLabReportEvents,
  listScopedLabReports,
  listWorkspaceLocations,
  listWorkspaceTeams,
  type LabReportDTO,
  type LabReportEventDTO,
  type LocationDTO,
  type TeamDTO,
} from "@/lib/firebase/repositories";
import { DATA_SOURCE } from "@/lib/firebase/boundary-copy";

const MAX_WORKFLOW_RECORDS = 50;
const MAX_EVENTS_PER_WORKFLOW = 25;

type WorkspaceListInput = {
  readonly workspaceId: string;
  readonly pageSize: number;
};

type ScopedLabListInput = WorkspaceListInput & {
  readonly teamId?: string;
  readonly locationId?: string;
};

type LabEventListInput = WorkspaceListInput & {
  readonly subjectId: string;
  readonly teamId: string;
  readonly locationId: string;
};

export interface LaboratoryWorkspaceReads {
  readonly listTeams: (
    db: Firestore,
    input: WorkspaceListInput,
  ) => Promise<readonly TeamDTO[]>;
  readonly listLocations: (
    db: Firestore,
    input: WorkspaceListInput,
  ) => Promise<readonly LocationDTO[]>;
  readonly listReports: (
    db: Firestore,
    input: ScopedLabListInput,
  ) => Promise<readonly LabReportDTO[]>;
  readonly listEvents: (
    db: Firestore,
    input: LabEventListInput,
  ) => Promise<readonly LabReportEventDTO[]>;
}

const defaultReads: LaboratoryWorkspaceReads = {
  listTeams: listWorkspaceTeams,
  listLocations: listWorkspaceLocations,
  listReports: listScopedLabReports,
  listEvents: listLabReportEvents,
};

export type LaboratoryHandoffState = "available" | "expired" | "not_available";

export interface LaboratoryEventView {
  readonly key: string;
  readonly eventType: LabReportEventDTO["eventType"];
  readonly fromStatus: LabReportEventDTO["fromStatus"];
  readonly toStatus: LabReportEventDTO["toStatus"];
  readonly occurredAt: string;
}

/**
 * Intentionally minimized view model. Patient IDs, external report references,
 * fingerprints, handoff references, access tokens, and clinical content are not
 * representable after the repository boundary.
 */
export interface LaboratoryWorkflowView {
  readonly key: string;
  readonly workflowStatus: LabReportDTO["workflowStatus"];
  readonly collectedAt: string | null;
  readonly readyAt: string | null;
  readonly lastNotificationAt: string | null;
  readonly updatedAt: string;
  readonly teamName: string;
  readonly locationName: string;
  readonly handoff: {
    readonly state: LaboratoryHandoffState;
    readonly expiresAt: string | null;
  };
  readonly events: readonly LaboratoryEventView[];
}

export interface LaboratoryWorkspaceResult {
  readonly records: readonly LaboratoryWorkflowView[];
  readonly scopePlan: PatientRecordScopePlan;
}

export class LaboratoryWorkspaceDataError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_join" | "load_failed",
    readonly sourceCode = "",
  ) {
    super(message);
    this.name = "LaboratoryWorkspaceDataError";
  }
}

function dedupeById<T extends { readonly id: string }>(records: readonly T[]): readonly T[] {
  return [...new Map(records.map((record) => [record.id, record])).values()];
}

function pairIsAllowed(
  plan: Exclude<PatientRecordScopePlan, { readonly kind: "denied" }>,
  teamId: string,
  locationId: string,
): boolean {
  return (
    plan.kind === "workspace_wide" ||
    plan.pairs.some((pair) => pair.teamId === teamId && pair.locationId === locationId)
  );
}

function assertReportJoin(input: {
  readonly workspaceId: string;
  readonly report: LabReportDTO;
  readonly plan: Exclude<PatientRecordScopePlan, { readonly kind: "denied" }>;
  readonly team: TeamDTO | undefined;
  readonly location: LocationDTO | undefined;
}): void {
  const { workspaceId, report, plan, team, location } = input;
  if (
    report.workspaceId !== workspaceId ||
    !report.synthetic ||
    report.authoritativeSystem !== "simulator" ||
    !team ||
    !location ||
    team.workspaceId !== workspaceId ||
    location.workspaceId !== workspaceId ||
    !team.active ||
    !location.active ||
    !team.locationIds.includes(location.id) ||
    !pairIsAllowed(plan, report.teamId, report.locationId)
  ) {
    throw new LaboratoryWorkspaceDataError(
      "Laboratory metadata did not match the verified workspace and active team-location scope.",
      "invalid_join",
    );
  }
}

function handoffView(
  report: LabReportDTO,
  nowMs: number,
): LaboratoryWorkflowView["handoff"] {
  if (
    report.secureAccess.mode !== "simulator_handoff" ||
    !report.secureAccess.available ||
    report.secureAccess.expiresAt === null
  ) {
    return { state: "not_available", expiresAt: null };
  }

  const expiresAtMs = Date.parse(report.secureAccess.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    throw new LaboratoryWorkspaceDataError(
      "Simulator handoff expiry metadata was invalid.",
      "invalid_join",
    );
  }
  return {
    state: expiresAtMs > nowMs ? "available" : "expired",
    expiresAt: report.secureAccess.expiresAt,
  };
}

function assertEventJoin(report: LabReportDTO, event: LabReportEventDTO): void {
  if (
    event.workspaceId !== report.workspaceId ||
    event.labReportId !== report.id ||
    event.conversationId !== report.conversationId ||
    event.contactId !== report.contactId ||
    event.teamId !== report.teamId ||
    event.locationId !== report.locationId ||
    !event.synthetic
  ) {
    throw new LaboratoryWorkspaceDataError(
      "An immutable laboratory event did not match its workflow record and scope.",
      "invalid_join",
    );
  }
}

async function loadReportsForPlan(
  db: Firestore,
  workspaceId: string,
  plan: Exclude<PatientRecordScopePlan, { readonly kind: "denied" }>,
  reads: LaboratoryWorkspaceReads,
): Promise<readonly LabReportDTO[]> {
  if (plan.kind === "workspace_wide") {
    return reads.listReports(db, {
      workspaceId,
      pageSize: MAX_WORKFLOW_RECORDS,
    });
  }

  // Keep the total result budget bounded even when a membership has many exact
  // active team-location pairs.
  const pageSize = Math.max(1, Math.floor(MAX_WORKFLOW_RECORDS / plan.pairs.length));
  const batches = await Promise.all(
    plan.pairs.map((pair) =>
      reads.listReports(db, {
        workspaceId,
        teamId: pair.teamId,
        locationId: pair.locationId,
        pageSize,
      }),
    ),
  );
  return dedupeById(batches.flat());
}

export async function loadLaboratoryWorkspace(
  db: Firestore,
  authority: PatientRecordAuthority,
  reads: LaboratoryWorkspaceReads = defaultReads,
  nowMs = Date.now(),
): Promise<LaboratoryWorkspaceResult> {
  try {
    const [teams, locations] = await Promise.all([
      reads.listTeams(db, {
        workspaceId: authority.workspaceId,
        pageSize: 100,
      }),
      reads.listLocations(db, {
        workspaceId: authority.workspaceId,
        pageSize: 100,
      }),
    ]);
    const scopePlan = buildPatientRecordScopePlan(authority, teams, locations);
    if (scopePlan.kind === "denied") {
      return { records: [], scopePlan };
    }

    const reports = [...dedupeById(
      await loadReportsForPlan(db, authority.workspaceId, scopePlan, reads),
    )]
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, MAX_WORKFLOW_RECORDS);
    const teamMap = new Map(teams.map((team) => [team.id, team]));
    const locationMap = new Map(locations.map((location) => [location.id, location]));

    const records = await Promise.all(
      reports.map(async (report): Promise<LaboratoryWorkflowView> => {
        const team = teamMap.get(report.teamId);
        const location = locationMap.get(report.locationId);
        assertReportJoin({
          workspaceId: authority.workspaceId,
          report,
          plan: scopePlan,
          team,
          location,
        });

        const events = dedupeById(
          await reads.listEvents(db, {
            workspaceId: authority.workspaceId,
            subjectId: report.id,
            teamId: report.teamId,
            locationId: report.locationId,
            pageSize: MAX_EVENTS_PER_WORKFLOW,
          }),
        );
        events.forEach((event) => assertEventJoin(report, event));

        return {
          key: report.id,
          workflowStatus: report.workflowStatus,
          collectedAt: report.collectedAt,
          readyAt: report.readyAt,
          lastNotificationAt: report.lastNotificationAt,
          updatedAt: report.updatedAt,
          teamName: team?.name ?? "",
          locationName: location?.name ?? "",
          handoff: handoffView(report, nowMs),
          events: [...events]
            .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
            .map((event) => ({
              key: event.id,
              eventType: event.eventType,
              fromStatus: event.fromStatus,
              toStatus: event.toStatus,
              occurredAt: event.occurredAt,
            })),
        };
      }),
    );

    return { records, scopePlan };
  } catch (error) {
    if (error instanceof LaboratoryWorkspaceDataError) throw error;
    const sourceCode =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    throw new LaboratoryWorkspaceDataError(
      "The tenant-scoped laboratory workflow metadata could not be loaded.",
      "load_failed",
      sourceCode,
    );
  }
}

export function describeLaboratoryWorkspaceError(error: unknown): string {
  const code =
    error instanceof LaboratoryWorkspaceDataError
      ? error.sourceCode
      : typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
  if (code.includes("permission-denied") || code.includes("unauthenticated")) {
    return "Laboratory metadata access was denied by the verified workspace scope.";
  }
  if (error instanceof LaboratoryWorkspaceDataError && error.code === "invalid_join") {
    return "Laboratory metadata failed tenant or team-location validation. Nothing was displayed.";
  }
  return `${DATA_SOURCE.charAt(0).toUpperCase()}${DATA_SOURCE.slice(1)} could not load laboratory metadata. No fallback fixture was shown.`;
}
