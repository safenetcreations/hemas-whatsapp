import type { Firestore } from "firebase/firestore";
import {
  buildPatientRecordScopePlan,
  type PatientRecordAuthority,
  type PatientRecordScopePlan,
} from "@/lib/firebase/patient-record-scope";
import {
  listConsentRecordsForContact,
  listScopedContacts,
  listWorkspaceLocations,
  listWorkspaceTeams,
  type ConsentRecordDTO,
  type ContactListItemDTO,
  type LocationDTO,
  type TeamDTO,
} from "@/lib/firebase/repositories";
import type {
  ConsentEvidenceViewRecord,
  ContactDirectoryRecord,
  ContactViewRecord,
} from "./types";

const PAGE_SIZE = 100;

type WorkspaceListInput = {
  readonly workspaceId: string;
  readonly pageSize: number;
};

type ScopedContactListInput = WorkspaceListInput & {
  readonly teamId?: string;
  readonly locationId?: string;
};

type ConsentListInput = WorkspaceListInput & {
  readonly contactId: string;
  readonly teamId: string;
  readonly locationId: string;
};

export interface ContactWorkspaceReads {
  readonly listTeams: (
    db: Firestore,
    input: WorkspaceListInput,
  ) => Promise<readonly TeamDTO[]>;
  readonly listLocations: (
    db: Firestore,
    input: WorkspaceListInput,
  ) => Promise<readonly LocationDTO[]>;
  readonly listContacts: (
    db: Firestore,
    input: ScopedContactListInput,
  ) => Promise<readonly ContactListItemDTO[]>;
  readonly listConsentRecords: (
    db: Firestore,
    input: ConsentListInput,
  ) => Promise<readonly ConsentRecordDTO[]>;
}

const defaultReads: ContactWorkspaceReads = {
  listTeams: listWorkspaceTeams,
  listLocations: listWorkspaceLocations,
  listContacts: listScopedContacts,
  listConsentRecords: listConsentRecordsForContact,
};

export class ContactWorkspaceDataError extends Error {
  constructor(
    message: string,
    readonly code: "scope_denied" | "invalid_join" | "load_failed",
    readonly sourceCode = "",
  ) {
    super(message);
    this.name = "ContactWorkspaceDataError";
  }
}

function dedupeById<T extends { readonly id: string }>(records: readonly T[]): readonly T[] {
  return [...new Map(records.map((record) => [record.id, record])).values()];
}

function contactViewRecord(contact: ContactListItemDTO): ContactViewRecord {
  return {
    id: contact.id,
    workspaceId: contact.workspaceId,
    teamId: contact.teamId,
    locationId: contact.locationId,
    displayLabel: contact.displayLabel,
    maskedPhone: contact.maskedPhone,
    preferredLanguage: contact.preferredLanguage,
    alternateLanguages: contact.alternateLanguages,
    tags: contact.tags,
    suppression: contact.suppression,
    synthetic: contact.synthetic,
    preferenceRevision: contact.preferenceRevision,
    updatedAt: contact.updatedAt,
  };
}

function consentEvidenceViewRecord(consent: ConsentRecordDTO): ConsentEvidenceViewRecord {
  return {
    id: consent.id,
    contactId: consent.contactId,
    purpose: consent.purpose,
    category: consent.category,
    channel: consent.channel,
    status: consent.status,
    source: consent.source,
    noticeVersion: consent.noticeVersion,
    language: consent.language,
    capturedAt: consent.capturedAt,
    withdrawnAt: consent.withdrawnAt,
  };
}

function scopeSourceCode(plan: Extract<PatientRecordScopePlan, { readonly kind: "denied" }>) {
  return `contact_${plan.reason}`;
}

function contactInputsForPlan(
  workspaceId: string,
  plan: Exclude<PatientRecordScopePlan, { readonly kind: "denied" }>,
): readonly ScopedContactListInput[] {
  if (plan.kind === "workspace_wide") {
    return [{ workspaceId, pageSize: PAGE_SIZE }];
  }
  return plan.pairs.map((pair) => ({
    workspaceId,
    teamId: pair.teamId,
    locationId: pair.locationId,
    pageSize: PAGE_SIZE,
  }));
}

function assertContactScope(input: {
  readonly workspaceId: string;
  readonly contact: ContactListItemDTO;
  readonly plan: Exclude<PatientRecordScopePlan, { readonly kind: "denied" }>;
  readonly teamMap: ReadonlyMap<string, TeamDTO>;
  readonly locationMap: ReadonlyMap<string, LocationDTO>;
}): void {
  const { contact, plan, teamMap, locationMap, workspaceId } = input;
  const team = teamMap.get(contact.teamId);
  const location = locationMap.get(contact.locationId);
  const pairAllowed =
    plan.kind === "workspace_wide" ||
    plan.pairs.some(
      (pair) => pair.teamId === contact.teamId && pair.locationId === contact.locationId,
    );
  if (
    contact.workspaceId !== workspaceId ||
    !team ||
    !location ||
    team.workspaceId !== workspaceId ||
    location.workspaceId !== workspaceId ||
    !pairAllowed
  ) {
    throw new ContactWorkspaceDataError(
      "A contact did not match the verified workspace and team-location scope.",
      "invalid_join",
    );
  }
}

export async function loadContactWorkspace(
  db: Firestore,
  authority: PatientRecordAuthority,
  reads: ContactWorkspaceReads = defaultReads,
): Promise<readonly ContactDirectoryRecord[]> {
  try {
    const [teams, locations] = await Promise.all([
      reads.listTeams(db, { workspaceId: authority.workspaceId, pageSize: PAGE_SIZE }),
      reads.listLocations(db, { workspaceId: authority.workspaceId, pageSize: PAGE_SIZE }),
    ]);
    const plan = buildPatientRecordScopePlan(authority, teams, locations);
    if (plan.kind === "denied") {
      throw new ContactWorkspaceDataError(
        "The membership has no valid patient-record scope for the contact directory.",
        "scope_denied",
        scopeSourceCode(plan),
      );
    }

    const contactBatches = await Promise.all(
      contactInputsForPlan(authority.workspaceId, plan).map((input) =>
        reads.listContacts(db, input),
      ),
    );
    const contacts = [...dedupeById(contactBatches.flat())].sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    );
    const teamMap = new Map(teams.map((team) => [team.id, team]));
    const locationMap = new Map(locations.map((location) => [location.id, location]));
    contacts.forEach((contact) =>
      assertContactScope({
        workspaceId: authority.workspaceId,
        contact,
        plan,
        teamMap,
        locationMap,
      }),
    );

    return Promise.all(
      contacts.map(async (contact): Promise<ContactDirectoryRecord> => {
        const consentRecords = dedupeById(
          await reads.listConsentRecords(db, {
            workspaceId: authority.workspaceId,
            contactId: contact.id,
            teamId: contact.teamId,
            locationId: contact.locationId,
            pageSize: PAGE_SIZE,
          }),
        );
        if (
          consentRecords.some(
            (consent) =>
              consent.workspaceId !== authority.workspaceId ||
              consent.contactId !== contact.id ||
              consent.teamId !== contact.teamId ||
              consent.locationId !== contact.locationId,
          )
        ) {
          throw new ContactWorkspaceDataError(
            "Consent evidence did not match its contact and team-location scope.",
            "invalid_join",
          );
        }
        return {
          contact: contactViewRecord(contact),
          consentRecords: consentRecords.map(consentEvidenceViewRecord),
        };
      }),
    );
  } catch (error) {
    if (error instanceof ContactWorkspaceDataError) throw error;
    const sourceCode =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    throw new ContactWorkspaceDataError(
      "The tenant-scoped contact directory could not be loaded.",
      "load_failed",
      sourceCode,
    );
  }
}
