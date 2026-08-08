import type { Firestore } from "firebase/firestore";
import {
  buildPatientRecordScopePlan,
  type PatientRecordAuthority,
  type PatientRecordScopePlan,
} from "@/lib/firebase/patient-record-scope";
import {
  listAppointmentEvents,
  listScopedAppointments,
  listWorkspaceLocations,
  listWorkspaceTeams,
  type AppointmentDTO,
  type AppointmentEventDTO,
  type JourneyEventListInput,
  type LocationDTO,
  type ScopedJourneyListInput,
  type SyntheticAppointmentAction,
  type TeamDTO,
  type WorkspaceListInput,
} from "@/lib/firebase/repositories";
import {
  buildAppointmentFunctionsRequest,
  type AppointmentFunctionsRequest,
} from "@/lib/firebase/appointment-functions-emulator";
import type { VerifiedWorkspaceSession } from "@/lib/firebase/workspace-session-model";

const PAGE_SIZE = 100;
const APPOINTMENT_ROLES = ["tenant_admin", "supervisor", "agent"] as const;

export type AppointmentAuthority = PatientRecordAuthority;
export type AppointmentScopePlan = PatientRecordScopePlan;

export interface AppointmentWorkspaceRecord {
  readonly appointment: AppointmentDTO;
  readonly events: readonly AppointmentEventDTO[];
  readonly teamName: string;
  readonly locationName: string;
}

export interface AppointmentWorkspaceResult {
  readonly records: readonly AppointmentWorkspaceRecord[];
  readonly scopePlan: AppointmentScopePlan;
}

export interface AppointmentWorkspaceReads {
  readonly listTeams: (
    db: Firestore,
    input: WorkspaceListInput,
  ) => Promise<readonly TeamDTO[]>;
  readonly listLocations: (
    db: Firestore,
    input: WorkspaceListInput,
  ) => Promise<readonly LocationDTO[]>;
  readonly listAppointments: (
    db: Firestore,
    input: ScopedJourneyListInput,
  ) => Promise<readonly AppointmentDTO[]>;
  readonly listEvents: (
    db: Firestore,
    input: JourneyEventListInput,
  ) => Promise<readonly AppointmentEventDTO[]>;
}

const defaultReads: AppointmentWorkspaceReads = {
  listTeams: listWorkspaceTeams,
  listLocations: listWorkspaceLocations,
  listAppointments: listScopedAppointments,
  listEvents: listAppointmentEvents,
};

export class AppointmentWorkspaceDataError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_join" | "load_failed" | "action_denied",
    readonly sourceCode = "",
  ) {
    super(message);
    this.name = "AppointmentWorkspaceDataError";
  }
}

function dedupeById<T extends { readonly id: string }>(records: readonly T[]): readonly T[] {
  return [...new Map(records.map((record) => [record.id, record])).values()];
}

function roleCanOperateAppointments(role: AppointmentAuthority["role"]): boolean {
  return APPOINTMENT_ROLES.some((allowedRole) => allowedRole === role);
}

export function buildAppointmentScopePlan(
  authority: AppointmentAuthority,
  teams: readonly TeamDTO[],
  locations: readonly LocationDTO[],
): AppointmentScopePlan {
  if (!roleCanOperateAppointments(authority.role)) {
    return { kind: "denied", pairs: [], reason: "role_not_permitted" };
  }
  return buildPatientRecordScopePlan(authority, teams, locations);
}

function appointmentInputsForPlan(
  workspaceId: string,
  plan: Exclude<AppointmentScopePlan, { readonly kind: "denied" }>,
): readonly ScopedJourneyListInput[] {
  if (plan.kind === "workspace_wide") {
    return [{ workspaceId, pageSize: PAGE_SIZE }];
  }
  return plan.pairs.map((pair) => ({ workspaceId, ...pair, pageSize: PAGE_SIZE }));
}

function pairAllowed(
  plan: Exclude<AppointmentScopePlan, { readonly kind: "denied" }>,
  appointment: AppointmentDTO,
): boolean {
  return (
    plan.kind === "workspace_wide" ||
    plan.pairs.some(
      (pair) =>
        pair.teamId === appointment.teamId && pair.locationId === appointment.locationId,
    )
  );
}

function assertAppointmentJoin(input: {
  readonly workspaceId: string;
  readonly appointment: AppointmentDTO;
  readonly events: readonly AppointmentEventDTO[];
  readonly plan: Exclude<AppointmentScopePlan, { readonly kind: "denied" }>;
  readonly team: TeamDTO | undefined;
  readonly location: LocationDTO | undefined;
}): void {
  const { appointment, events, location, plan, team, workspaceId } = input;
  if (
    appointment.workspaceId !== workspaceId ||
    !appointment.synthetic ||
    appointment.authoritativeSystem !== "simulator" ||
    !team ||
    !location ||
    team.workspaceId !== workspaceId ||
    location.workspaceId !== workspaceId ||
    !team.active ||
    !location.active ||
    !team.locationIds.includes(location.id) ||
    !pairAllowed(plan, appointment)
  ) {
    throw new AppointmentWorkspaceDataError(
      "An appointment did not match its verified workspace, active route, and team-location scope.",
      "invalid_join",
    );
  }

  const eventIds = new Set<string>();
  for (const event of events) {
    if (
      eventIds.has(event.id) ||
      event.workspaceId !== workspaceId ||
      event.appointmentId !== appointment.id ||
      event.conversationId !== appointment.conversationId ||
      event.contactId !== appointment.contactId ||
      event.teamId !== appointment.teamId ||
      event.locationId !== appointment.locationId ||
      event.revision > appointment.revision
    ) {
      throw new AppointmentWorkspaceDataError(
        "Immutable appointment events did not match the selected appointment and tenant route.",
        "invalid_join",
      );
    }
    eventIds.add(event.id);
  }

  if (appointment.lastActionId !== null) {
    const currentEvent = events.find((event) => event.id === appointment.lastActionId);
    if (
      !currentEvent ||
      currentEvent.revision !== appointment.revision ||
      currentEvent.toStatus !== appointment.status
    ) {
      throw new AppointmentWorkspaceDataError(
        "The current appointment revision is missing its immutable action evidence.",
        "invalid_join",
      );
    }
  }
}

export function assembleAppointmentWorkspaceRecords(input: {
  readonly workspaceId: string;
  readonly appointments: readonly AppointmentDTO[];
  readonly eventsByAppointmentId: ReadonlyMap<string, readonly AppointmentEventDTO[]>;
  readonly teams: readonly TeamDTO[];
  readonly locations: readonly LocationDTO[];
  readonly scopePlan: Exclude<AppointmentScopePlan, { readonly kind: "denied" }>;
}): readonly AppointmentWorkspaceRecord[] {
  const teams = new Map(input.teams.map((team) => [team.id, team]));
  const locations = new Map(input.locations.map((location) => [location.id, location]));

  return dedupeById(input.appointments)
    .map((appointment): AppointmentWorkspaceRecord => {
      const events = [...dedupeById(input.eventsByAppointmentId.get(appointment.id) ?? [])].sort(
        (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
      );
      const team = teams.get(appointment.teamId);
      const location = locations.get(appointment.locationId);
      assertAppointmentJoin({
        workspaceId: input.workspaceId,
        appointment,
        events,
        plan: input.scopePlan,
        team,
        location,
      });
      return {
        appointment,
        events,
        teamName: team?.name ?? "",
        locationName: location?.name ?? "",
      };
    })
    .sort(
      (left, right) =>
        Date.parse(left.appointment.slotStartsAt) -
        Date.parse(right.appointment.slotStartsAt),
    );
}

export async function loadAppointmentWorkspace(
  db: Firestore,
  authority: AppointmentAuthority,
  reads: AppointmentWorkspaceReads = defaultReads,
): Promise<AppointmentWorkspaceResult> {
  try {
    const [teams, locations] = await Promise.all([
      reads.listTeams(db, { workspaceId: authority.workspaceId, pageSize: PAGE_SIZE }),
      reads.listLocations(db, {
        workspaceId: authority.workspaceId,
        pageSize: PAGE_SIZE,
      }),
    ]);
    const scopePlan = buildAppointmentScopePlan(authority, teams, locations);
    if (scopePlan.kind === "denied") return { records: [], scopePlan };

    const appointmentBatches = await Promise.all(
      appointmentInputsForPlan(authority.workspaceId, scopePlan).map((queryInput) =>
        reads.listAppointments(db, queryInput),
      ),
    );
    const appointments = dedupeById(appointmentBatches.flat());
    const eventPairs = await Promise.all(
      appointments.map(async (appointment) => [
        appointment.id,
        await reads.listEvents(db, {
          workspaceId: authority.workspaceId,
          subjectId: appointment.id,
          teamId: appointment.teamId,
          locationId: appointment.locationId,
          pageSize: PAGE_SIZE,
        }),
      ] as const),
    );

    return {
      scopePlan,
      records: assembleAppointmentWorkspaceRecords({
        workspaceId: authority.workspaceId,
        appointments,
        eventsByAppointmentId: new Map(eventPairs),
        teams,
        locations,
        scopePlan,
      }),
    };
  } catch (error) {
    if (error instanceof AppointmentWorkspaceDataError) throw error;
    const sourceCode =
      typeof error === "object" && error && "code" in error ? String(error.code) : "";
    throw new AppointmentWorkspaceDataError(
      "The tenant-scoped appointment workspace could not be loaded.",
      "load_failed",
      sourceCode,
    );
  }
}

export async function buildAppointmentActionRequest(input: {
  readonly session: VerifiedWorkspaceSession;
  readonly appointment: AppointmentDTO;
  readonly action: SyntheticAppointmentAction;
}): Promise<AppointmentFunctionsRequest> {
  const { action, appointment, session } = input;
  if (
    !roleCanOperateAppointments(session.role) ||
    appointment.workspaceId !== session.workspaceId ||
    appointment.status !== "confirmed" ||
    appointment.authoritativeSystem !== "simulator" ||
    !appointment.synthetic ||
    (session.role !== "tenant_admin" &&
      (!session.teamIds.includes(appointment.teamId) ||
        !session.locationIds.includes(appointment.locationId)))
  ) {
    throw new AppointmentWorkspaceDataError(
      "The verified member cannot request this simulator appointment transition.",
      "action_denied",
    );
  }

  return buildAppointmentFunctionsRequest({
    workspaceId: session.workspaceId,
    appointmentId: appointment.id,
    actorUid: session.uid,
    teamId: appointment.teamId,
    locationId: appointment.locationId,
    action,
    expectedRevision: appointment.revision,
  });
}

export function describeAppointmentWorkspaceError(error: unknown): string {
  const sourceCode =
    error instanceof AppointmentWorkspaceDataError
      ? error.sourceCode
      : typeof error === "object" && error && "code" in error
        ? String(error.code)
        : "";
  if (sourceCode.includes("permission-denied")) {
    return "Appointment access was denied by the verified workspace or team-and-location scope.";
  }
  if (sourceCode.includes("failed-precondition")) {
    return "The local Firestore indexes are not ready for this bounded appointment query.";
  }
  if (error instanceof AppointmentWorkspaceDataError && error.code === "invalid_join") {
    return "Persisted appointment evidence failed tenant-route validation, so this workspace stayed closed.";
  }
  return "The local Firestore emulator could not load persisted appointments. No cloud or fixture fallback was attempted.";
}
