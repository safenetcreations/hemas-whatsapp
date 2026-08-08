import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type Firestore,
  type QueryConstraint,
  type Timestamp,
} from "firebase/firestore";
import { z } from "zod";

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Identifier contains unsupported characters");

const timestampSchema = z.custom<Timestamp>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof value.toDate === "function",
  "Expected a Firestore Timestamp",
);

const appointmentStatusSchema = z.enum([
  "requested",
  "pending_confirmation",
  "confirmed",
  "reschedule_pending",
  "cancel_pending",
  "cancelled",
  "completed",
  "no_show",
]);

const appointmentSyncStateSchema = z.enum([
  "mock",
  "pending",
  "synced",
  "conflict",
  "failed",
]);

const reminderStateSchema = z.enum([
  "not_scheduled",
  "scheduled",
  "simulated",
  "cancelled",
  "failed",
]);

const appointmentDocumentSchema = z
  .object({
    id: identifierSchema,
    workspaceId: identifierSchema,
    conversationId: identifierSchema,
    contactId: identifierSchema,
    teamId: identifierSchema,
    locationId: identifierSchema,
    externalAppointmentRef: z.string().min(1).max(128),
    serviceRef: z.string().min(1).max(128),
    practitionerDisplayLabel: z.string().min(1).max(160).nullable(),
    slotStartsAt: timestampSchema,
    slotEndsAt: timestampSchema,
    slotTimeZone: z.literal("Asia/Colombo"),
    status: appointmentStatusSchema,
    syncState: appointmentSyncStateSchema,
    reminderState: z
      .object({
        confirmation: reminderStateSchema,
        twentyFourHour: reminderStateSchema,
        twoHour: reminderStateSchema,
      })
      .strict(),
    authoritativeSystem: z.literal("simulator"),
    lastSyncedAt: timestampSchema.nullable(),
    revision: z.number().int().min(0).max(1_000_000_000),
    lastActionId: identifierSchema.nullable(),
    synthetic: z.literal(true),
    schemaVersion: z.literal(1),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((data, context) => {
    if (data.slotEndsAt.toMillis() <= data.slotStartsAt.toMillis()) {
      context.addIssue({
        code: "custom",
        path: ["slotEndsAt"],
        message: "Appointment slot end must be after its start",
      });
    }
  });

export const SYNTHETIC_APPOINTMENT_ACTIONS = [
  "request_reschedule",
  "request_cancellation",
] as const;

const appointmentEventDocumentSchema = z
  .object({
    id: identifierSchema,
    workspaceId: identifierSchema,
    appointmentId: identifierSchema,
    conversationId: identifierSchema,
    contactId: identifierSchema,
    teamId: identifierSchema,
    locationId: identifierSchema,
    actionId: identifierSchema,
    actorUid: identifierSchema,
    action: z.enum([
      "simulator_snapshot_seeded",
      "request_reschedule",
      "request_cancellation",
    ]),
    fromStatus: appointmentStatusSchema.nullable(),
    toStatus: appointmentStatusSchema,
    revision: z.number().int().min(0).max(1_000_000_000),
    source: z.enum(["simulator_seed", "authenticated_client"]),
    synthetic: z.literal(true),
    schemaVersion: z.literal(1),
    createdAt: timestampSchema,
  })
  .strict();

const labWorkflowStatusSchema = z.enum([
  "registered",
  "processing",
  "ready",
  "notification_queued",
  "notification_simulated",
  "notification_sent",
  "accessed",
  "expired",
  "superseded",
]);

const labSecureAccessSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("simulator_handoff"),
      available: z.literal(true),
      expiresAt: timestampSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal("not_available"),
      available: z.literal(false),
      expiresAt: z.null(),
    })
    .strict(),
]);

const labReportDocumentSchema = z
  .object({
    id: identifierSchema,
    workspaceId: identifierSchema,
    conversationId: identifierSchema,
    contactId: identifierSchema,
    teamId: identifierSchema,
    locationId: identifierSchema,
    workflowStatus: labWorkflowStatusSchema,
    collectedAt: timestampSchema.nullable(),
    readyAt: timestampSchema.nullable(),
    secureAccess: labSecureAccessSchema,
    lastNotificationAt: timestampSchema.nullable(),
    authoritativeSystem: z.literal("simulator"),
    revision: z.number().int().min(0).max(1_000_000_000),
    synthetic: z.literal(true),
    schemaVersion: z.literal(1),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

const labReportEventDocumentSchema = z
  .object({
    id: identifierSchema,
    workspaceId: identifierSchema,
    labReportId: identifierSchema,
    conversationId: identifierSchema,
    contactId: identifierSchema,
    teamId: identifierSchema,
    locationId: identifierSchema,
    eventType: z.enum([
      "simulator_report_ready",
      "notification_queued",
      "notification_simulated",
      "secure_accessed",
      "secure_access_expired",
    ]),
    fromStatus: labWorkflowStatusSchema.nullable(),
    toStatus: labWorkflowStatusSchema,
    source: z.enum(["simulator_seed", "trusted_backend"]),
    synthetic: z.literal(true),
    schemaVersion: z.literal(1),
    occurredAt: timestampSchema,
    createdAt: timestampSchema,
  })
  .strict();

const pageSizeSchema = z.number().int().min(1).max(100).optional();

const scopedJourneyListInputSchema = z
  .object({
    workspaceId: identifierSchema,
    teamId: identifierSchema.optional(),
    locationId: identifierSchema.optional(),
    pageSize: pageSizeSchema,
  })
  .strict()
  .superRefine((data, context) => {
    if ((data.teamId && !data.locationId) || (!data.teamId && data.locationId)) {
      context.addIssue({
        code: "custom",
        path: ["teamId"],
        message: "Team and location scopes must be queried together",
      });
    }
  });

const journeyEventListInputSchema = z
  .object({
    workspaceId: identifierSchema,
    subjectId: identifierSchema,
    teamId: identifierSchema,
    locationId: identifierSchema,
    pageSize: pageSizeSchema,
  })
  .strict();

type AppointmentDocument = z.infer<typeof appointmentDocumentSchema>;
type AppointmentEventDocument = z.infer<typeof appointmentEventDocumentSchema>;
type LabReportDocument = z.infer<typeof labReportDocumentSchema>;
type LabReportEventDocument = z.infer<typeof labReportEventDocumentSchema>;

export type ScopedJourneyListInput = z.infer<typeof scopedJourneyListInputSchema>;
export type JourneyEventListInput = z.infer<typeof journeyEventListInputSchema>;
export type SyntheticAppointmentAction = (typeof SYNTHETIC_APPOINTMENT_ACTIONS)[number];

export type AppointmentDTO = Omit<
  AppointmentDocument,
  "slotStartsAt" | "slotEndsAt" | "lastSyncedAt" | "createdAt" | "updatedAt"
> & {
  readonly slotStartsAt: string;
  readonly slotEndsAt: string;
  readonly lastSyncedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type AppointmentEventDTO = Omit<AppointmentEventDocument, "createdAt"> & {
  readonly createdAt: string;
};

export type LabReportDTO = Omit<
  LabReportDocument,
  | "collectedAt"
  | "readyAt"
  | "secureAccess"
  | "lastNotificationAt"
  | "createdAt"
  | "updatedAt"
> & {
  readonly collectedAt: string | null;
  readonly readyAt: string | null;
  readonly secureAccess: {
    readonly mode: "simulator_handoff" | "not_available";
    readonly available: boolean;
    readonly expiresAt: string | null;
  };
  readonly lastNotificationAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type LabReportEventDTO = Omit<
  LabReportEventDocument,
  "occurredAt" | "createdAt"
> & {
  readonly occurredAt: string;
  readonly createdAt: string;
};

export class JourneyRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_input" | "invalid_persisted_data",
  ) {
    super(message);
    this.name = "JourneyRepositoryError";
  }
}

function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new JourneyRepositoryError("Journey input failed validation.", "invalid_input");
  }
  return result.data;
}

function parsePersisted<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new JourneyRepositoryError(
      `${label} failed persisted schema validation.`,
      "invalid_persisted_data",
    );
  }
  return result.data;
}

function timestampToIso(value: Timestamp | null): string | null {
  return value === null ? null : value.toDate().toISOString();
}

function assertIdentity(
  actual: { readonly id: string; readonly workspaceId: string },
  documentId: string,
  workspaceId: string,
  label: string,
): void {
  if (actual.id !== documentId || actual.workspaceId !== workspaceId) {
    throw new JourneyRepositoryError(
      `${label} identity does not match its tenant path.`,
      "invalid_persisted_data",
    );
  }
}

export function prepareScopedJourneyListInput(
  input: ScopedJourneyListInput,
): ScopedJourneyListInput {
  return parseInput(scopedJourneyListInputSchema, input);
}

export function prepareJourneyEventListInput(
  input: JourneyEventListInput,
): JourneyEventListInput {
  return parseInput(journeyEventListInputSchema, input);
}

export function parseAppointmentDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): AppointmentDTO {
  const parsed = parsePersisted(appointmentDocumentSchema, value, "Appointment");
  assertIdentity(parsed, documentId, workspaceId, "Appointment");
  return {
    ...parsed,
    slotStartsAt: parsed.slotStartsAt.toDate().toISOString(),
    slotEndsAt: parsed.slotEndsAt.toDate().toISOString(),
    lastSyncedAt: timestampToIso(parsed.lastSyncedAt),
    createdAt: parsed.createdAt.toDate().toISOString(),
    updatedAt: parsed.updatedAt.toDate().toISOString(),
  };
}

export function parseAppointmentEventDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): AppointmentEventDTO {
  const parsed = parsePersisted(appointmentEventDocumentSchema, value, "Appointment event");
  assertIdentity(parsed, documentId, workspaceId, "Appointment event");
  if (parsed.actionId !== parsed.id) {
    throw new JourneyRepositoryError(
      "Appointment event action does not match its immutable document ID.",
      "invalid_persisted_data",
    );
  }
  return { ...parsed, createdAt: parsed.createdAt.toDate().toISOString() };
}

export function parseLabReportDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): LabReportDTO {
  const parsed = parsePersisted(labReportDocumentSchema, value, "Laboratory report metadata");
  assertIdentity(parsed, documentId, workspaceId, "Laboratory report metadata");
  return {
    ...parsed,
    collectedAt: timestampToIso(parsed.collectedAt),
    readyAt: timestampToIso(parsed.readyAt),
    secureAccess: {
      mode: parsed.secureAccess.mode,
      available: parsed.secureAccess.available,
      expiresAt: timestampToIso(parsed.secureAccess.expiresAt),
    },
    lastNotificationAt: timestampToIso(parsed.lastNotificationAt),
    createdAt: parsed.createdAt.toDate().toISOString(),
    updatedAt: parsed.updatedAt.toDate().toISOString(),
  };
}

export function parseLabReportEventDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): LabReportEventDTO {
  const parsed = parsePersisted(
    labReportEventDocumentSchema,
    value,
    "Laboratory report event",
  );
  assertIdentity(parsed, documentId, workspaceId, "Laboratory report event");
  return {
    ...parsed,
    occurredAt: parsed.occurredAt.toDate().toISOString(),
    createdAt: parsed.createdAt.toDate().toISOString(),
  };
}

function scopedConstraints(input: ScopedJourneyListInput): QueryConstraint[] {
  if (!input.teamId || !input.locationId) return [];
  return [where("teamId", "==", input.teamId), where("locationId", "==", input.locationId)];
}

export async function listScopedAppointments(
  db: Firestore,
  rawInput: ScopedJourneyListInput,
): Promise<readonly AppointmentDTO[]> {
  const input = prepareScopedJourneyListInput(rawInput);
  const snapshot = await getDocs(
    query(
      collection(db, "workspaces", input.workspaceId, "appointments"),
      ...scopedConstraints(input),
      orderBy("slotStartsAt", "asc"),
      limit(input.pageSize ?? 50),
    ),
  );
  return snapshot.docs.map((record) =>
    parseAppointmentDocument(record.data(), record.id, input.workspaceId),
  );
}

export async function listAppointmentEvents(
  db: Firestore,
  rawInput: JourneyEventListInput,
): Promise<readonly AppointmentEventDTO[]> {
  const input = prepareJourneyEventListInput(rawInput);
  const snapshot = await getDocs(
    query(
      collection(db, "workspaces", input.workspaceId, "appointmentEvents"),
      where("appointmentId", "==", input.subjectId),
      where("teamId", "==", input.teamId),
      where("locationId", "==", input.locationId),
      orderBy("createdAt", "desc"),
      limit(input.pageSize ?? 50),
    ),
  );
  return snapshot.docs.map((record) => {
    const event = parseAppointmentEventDocument(
      record.data(),
      record.id,
      input.workspaceId,
    );
    if (
      event.appointmentId !== input.subjectId ||
      event.teamId !== input.teamId ||
      event.locationId !== input.locationId
    ) {
      throw new JourneyRepositoryError(
        "Appointment event identity does not match its bounded query.",
        "invalid_persisted_data",
      );
    }
    return event;
  });
}

export async function listScopedLabReports(
  db: Firestore,
  rawInput: ScopedJourneyListInput,
): Promise<readonly LabReportDTO[]> {
  const input = prepareScopedJourneyListInput(rawInput);
  const snapshot = await getDocs(
    query(
      collection(db, "workspaces", input.workspaceId, "labReports"),
      ...scopedConstraints(input),
      orderBy("updatedAt", "desc"),
      limit(input.pageSize ?? 50),
    ),
  );
  return snapshot.docs.map((record) =>
    parseLabReportDocument(record.data(), record.id, input.workspaceId),
  );
}

export async function listLabReportEvents(
  db: Firestore,
  rawInput: JourneyEventListInput,
): Promise<readonly LabReportEventDTO[]> {
  const input = prepareJourneyEventListInput(rawInput);
  const snapshot = await getDocs(
    query(
      collection(db, "workspaces", input.workspaceId, "labReportEvents"),
      where("labReportId", "==", input.subjectId),
      where("teamId", "==", input.teamId),
      where("locationId", "==", input.locationId),
      orderBy("occurredAt", "desc"),
      limit(input.pageSize ?? 50),
    ),
  );
  return snapshot.docs.map((record) => {
    const event = parseLabReportEventDocument(record.data(), record.id, input.workspaceId);
    if (
      event.labReportId !== input.subjectId ||
      event.teamId !== input.teamId ||
      event.locationId !== input.locationId
    ) {
      throw new JourneyRepositoryError(
        "Laboratory event identity does not match its bounded query.",
        "invalid_persisted_data",
      );
    }
    return event;
  });
}
