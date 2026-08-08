import type {
  AppointmentId,
  ContactId,
  ExternalReference,
  ISODateTime,
  LocationId,
  TimeZone,
  WorkspaceScopedEntity,
} from "./primitives";

export type AppointmentStatus =
  | "requested"
  | "pending_confirmation"
  | "confirmed"
  | "reschedule_pending"
  | "cancel_pending"
  | "cancelled"
  | "completed"
  | "no_show";

export type AppointmentSyncState = "mock" | "pending" | "synced" | "conflict" | "failed";

export interface AppointmentSlot {
  readonly startsAt: ISODateTime;
  readonly endsAt: ISODateTime;
  readonly timeZone: TimeZone;
}

export interface AppointmentReminder {
  readonly kind: "confirmation" | "twenty_four_hour" | "two_hour" | "custom";
  readonly scheduledFor: ISODateTime;
  readonly status: "scheduled" | "simulated" | "sent" | "cancelled" | "failed";
}

export interface Appointment extends WorkspaceScopedEntity<AppointmentId> {
  readonly externalAppointmentRef: ExternalReference;
  readonly contactId: ContactId;
  readonly locationId: LocationId;
  readonly serviceRef: string;
  readonly practitionerDisplayLabel: string | null;
  readonly slot: AppointmentSlot;
  readonly status: AppointmentStatus;
  readonly syncState: AppointmentSyncState;
  readonly idempotencyKey: string;
  readonly reminders: readonly AppointmentReminder[];
  readonly authoritativeSystem: "simulator" | "hemas_appointment_system";
  readonly lastSyncedAt: ISODateTime | null;
  readonly synthetic: boolean;
}

export function appointmentAllowsReminder(appointment: Appointment): boolean {
  return appointment.status === "confirmed" && appointment.syncState !== "conflict";
}

export function isAppointmentTerminal(status: AppointmentStatus): boolean {
  return status === "cancelled" || status === "completed" || status === "no_show";
}

