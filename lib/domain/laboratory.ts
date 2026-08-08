import type {
  ContactId,
  ExternalReference,
  ISODateTime,
  LabReportId,
  LocationId,
  WorkspaceScopedEntity,
} from "./primitives";

export type LabReportWorkflowStatus =
  | "registered"
  | "processing"
  | "ready"
  | "notification_queued"
  | "notification_simulated"
  | "notification_sent"
  | "accessed"
  | "expired"
  | "superseded";

/**
 * Operational report metadata only. Result values, diagnoses and report bodies are
 * intentionally not representable in this type.
 */
export interface LabReportMetadata extends WorkspaceScopedEntity<LabReportId> {
  readonly externalReportRef: ExternalReference;
  readonly contactId: ContactId;
  readonly locationId: LocationId;
  readonly workflowStatus: LabReportWorkflowStatus;
  readonly collectedAt: ISODateTime | null;
  readonly readyAt: ISODateTime | null;
  readonly notificationIdempotencyKey: string;
  readonly secureAccess:
    | {
        readonly mode: "simulator";
        readonly route: string;
        readonly expiresAt: ISODateTime;
      }
    | {
        readonly mode: "hemas_authenticated_deep_link";
        readonly opaqueLinkRef: string;
        readonly expiresAt: ISODateTime;
      }
    | {
        readonly mode: "not_available";
        readonly expiresAt: null;
      };
  readonly lastNotificationAt: ISODateTime | null;
  readonly authoritativeSystem: "simulator" | "lims";
  readonly synthetic: boolean;
}

export function canNotifyReportReady(report: LabReportMetadata, at: ISODateTime): boolean {
  if (report.workflowStatus !== "ready" && report.workflowStatus !== "notification_queued") {
    return false;
  }

  if (report.secureAccess.mode === "not_available") {
    return false;
  }

  return Date.parse(report.secureAccess.expiresAt) > Date.parse(at);
}

