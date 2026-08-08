import type { Firestore } from "firebase/firestore";
import {
  buildPatientRecordScopePlan,
  type PatientRecordAuthority,
  type PatientRecordScopePair,
  type PatientRecordScopePlan,
} from "@/lib/firebase/patient-record-scope";
import {
  listConsentRecordsForContact,
  listConversationMessageMetadata,
  listScopedContacts,
  listScopedConversations,
  listWorkspaceLocations,
  listWorkspaceTeams,
  type ConsentRecordDTO,
  type ContactListItemDTO,
  type ConversationListItemDTO,
  type LocationDTO,
  type MessageMetadataDTO,
  type TeamDTO,
} from "@/lib/firebase/repositories";
import type {
  InboxConversationRecord,
  InboxLanguageFilter,
  InboxStatusFilter,
} from "./types";

const PAGE_SIZE = 100;

export type InboxAuthority = PatientRecordAuthority;
export type InboxScopePair = PatientRecordScopePair;
export type InboxScopePlan = PatientRecordScopePlan;

export interface InboxWorkspaceResult {
  readonly records: readonly InboxConversationRecord[];
  readonly scopePlan: InboxScopePlan;
}

export class InboxWorkspaceDataError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_join" | "invalid_scope" | "load_failed",
    readonly sourceCode = "",
  ) {
    super(message);
    this.name = "InboxWorkspaceDataError";
  }
}

function byId<T extends { readonly id: string }>(records: readonly T[]): Map<string, T> {
  return new Map(records.map((record) => [record.id, record]));
}

export function dedupeById<T extends { readonly id: string }>(records: readonly T[]): readonly T[] {
  return [...byId(records).values()];
}

export function buildInboxScopePlan(
  authority: InboxAuthority,
  teams: readonly TeamDTO[],
  locations: readonly LocationDTO[],
): InboxScopePlan {
  return buildPatientRecordScopePlan(authority, teams, locations);
}

function assertRecordJoin(
  conversation: ConversationListItemDTO,
  contact: ContactListItemDTO | undefined,
  team: TeamDTO | undefined,
  location: LocationDTO | undefined,
): {
  readonly contact: ContactListItemDTO;
  readonly team: TeamDTO;
  readonly location: LocationDTO;
} {
  if (
    !contact ||
    !team ||
    !location ||
    contact.workspaceId !== conversation.workspaceId ||
    contact.teamId !== conversation.teamId ||
    contact.locationId !== conversation.locationId ||
    team.workspaceId !== conversation.workspaceId ||
    location.workspaceId !== conversation.workspaceId
  ) {
    throw new InboxWorkspaceDataError(
      "A conversation could not be joined to an identically scoped contact and routing label.",
      "invalid_join",
    );
  }
  return { contact, team, location };
}

export function assembleInboxRecords(input: {
  readonly workspaceId: string;
  readonly conversations: readonly ConversationListItemDTO[];
  readonly contacts: readonly ContactListItemDTO[];
  readonly teams: readonly TeamDTO[];
  readonly locations: readonly LocationDTO[];
  readonly consentByContactId: ReadonlyMap<string, readonly ConsentRecordDTO[]>;
  readonly messagesByConversationId: ReadonlyMap<string, readonly MessageMetadataDTO[]>;
}): readonly InboxConversationRecord[] {
  const conversations = dedupeById(input.conversations);
  const contactMap = byId(dedupeById(input.contacts));
  const teamMap = byId(input.teams);
  const locationMap = byId(input.locations);

  return conversations
    .map((conversation): InboxConversationRecord => {
      if (conversation.workspaceId !== input.workspaceId) {
        throw new InboxWorkspaceDataError(
          "A conversation was returned outside the verified workspace.",
          "invalid_join",
        );
      }
      const joined = assertRecordJoin(
        conversation,
        contactMap.get(conversation.contactId),
        teamMap.get(conversation.teamId),
        locationMap.get(conversation.locationId),
      );
      const { contact, team, location } = joined;

      const consentRecords = dedupeById(input.consentByContactId.get(contact.id) ?? []);
      const messages = dedupeById(input.messagesByConversationId.get(conversation.id) ?? []);
      if (
        consentRecords.some(
          (consent) =>
            consent.workspaceId !== input.workspaceId ||
            consent.contactId !== contact.id ||
            consent.teamId !== conversation.teamId ||
            consent.locationId !== conversation.locationId,
        ) ||
        messages.some(
          (message) =>
            message.workspaceId !== input.workspaceId ||
            message.conversationId !== conversation.id ||
            message.contactId !== contact.id ||
            message.teamId !== conversation.teamId ||
            message.locationId !== conversation.locationId ||
            !message.metadataOnly ||
            !message.synthetic,
        )
      ) {
        throw new InboxWorkspaceDataError(
          "Consent or message metadata did not match the verified conversation scope.",
          "invalid_join",
        );
      }

      return {
        conversation,
        contact,
        teamName: team.name,
        locationName: location.name,
        consentRecords: [...consentRecords].sort(
          (left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt),
        ),
        messages: [...messages].sort(
          (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
        ),
      };
    })
    .sort((left, right) => {
      const leftUrgent = left.conversation.purpose === "urgent_escalation" ? 1 : 0;
      const rightUrgent = right.conversation.purpose === "urgent_escalation" ? 1 : 0;
      if (leftUrgent !== rightUrgent) return rightUrgent - leftUrgent;
      if (left.conversation.unreadCount !== right.conversation.unreadCount) {
        return right.conversation.unreadCount - left.conversation.unreadCount;
      }
      return Date.parse(right.conversation.lastMessageAt) - Date.parse(left.conversation.lastMessageAt);
    });
}

function normalizedSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function metadataMessagePreview(message: MessageMetadataDTO): string {
  const direction = `${message.direction.charAt(0).toUpperCase()}${message.direction.slice(1)}`;
  return `${direction} synthetic ${message.type} message metadata — body not stored`;
}

export function filterInboxRecords(
  records: readonly InboxConversationRecord[],
  input: {
    readonly search: string;
    readonly status: InboxStatusFilter;
    readonly language: InboxLanguageFilter;
    readonly safetyOnly: boolean;
  },
): readonly InboxConversationRecord[] {
  const search = normalizedSearch(input.search);
  return records.filter((record) => {
    const searchable = [
      record.contact.displayLabel,
      record.contact.maskedPhone,
      record.conversation.purpose,
      record.teamName,
      record.locationName,
      ...record.messages.map(metadataMessagePreview),
    ]
      .join(" ")
      .toLocaleLowerCase();
    const urgent =
      record.conversation.purpose === "urgent_escalation" ||
      record.conversation.mode === "safety_hold";
    return (
      (!search || searchable.includes(search)) &&
      (input.status === "all" || record.conversation.status === input.status) &&
      (input.language === "all" || record.conversation.detectedLanguage === input.language) &&
      (!input.safetyOnly || urgent)
    );
  });
}

async function loadScopedCollections(
  db: Firestore,
  workspaceId: string,
  plan: Exclude<InboxScopePlan, { readonly kind: "denied" }>,
): Promise<{
  readonly contacts: readonly ContactListItemDTO[];
  readonly conversations: readonly ConversationListItemDTO[];
}> {
  if (plan.kind === "workspace_wide") {
    const [contacts, conversations] = await Promise.all([
      listScopedContacts(db, { workspaceId, pageSize: PAGE_SIZE }),
      listScopedConversations(db, { workspaceId, pageSize: PAGE_SIZE }),
    ]);
    return { contacts, conversations };
  }

  const results = await Promise.all(
    plan.pairs.map(async (pair) => {
      const [contacts, conversations] = await Promise.all([
        listScopedContacts(db, { workspaceId, ...pair, pageSize: PAGE_SIZE }),
        listScopedConversations(db, { workspaceId, ...pair, pageSize: PAGE_SIZE }),
      ]);
      return { contacts, conversations };
    }),
  );
  return {
    contacts: dedupeById(results.flatMap((result) => result.contacts)),
    conversations: dedupeById(results.flatMap((result) => result.conversations)),
  };
}

export async function loadInboxWorkspace(
  db: Firestore,
  authority: InboxAuthority,
): Promise<InboxWorkspaceResult> {
  try {
    const [teams, locations] = await Promise.all([
      listWorkspaceTeams(db, { workspaceId: authority.workspaceId, pageSize: PAGE_SIZE }),
      listWorkspaceLocations(db, { workspaceId: authority.workspaceId, pageSize: PAGE_SIZE }),
    ]);
    const scopePlan = buildInboxScopePlan(authority, teams, locations);
    if (scopePlan.kind === "denied") {
      return { records: [], scopePlan };
    }

    const { contacts, conversations } = await loadScopedCollections(
      db,
      authority.workspaceId,
      scopePlan,
    );
    const contactMap = byId(contacts);
    const consentEntries = new Map<string, Promise<readonly ConsentRecordDTO[]>>();
    for (const conversation of conversations) {
      const joined = assertRecordJoin(
        conversation,
        contactMap.get(conversation.contactId),
        teams.find((team) => team.id === conversation.teamId),
        locations.find((location) => location.id === conversation.locationId),
      );
      const { contact } = joined;
      if (!consentEntries.has(contact.id)) {
        consentEntries.set(
          contact.id,
          listConsentRecordsForContact(db, {
            workspaceId: authority.workspaceId,
            contactId: contact.id,
            teamId: conversation.teamId,
            locationId: conversation.locationId,
            pageSize: PAGE_SIZE,
          }),
        );
      }
    }

    const [consentPairs, messagePairs] = await Promise.all([
      Promise.all(
        [...consentEntries].map(async ([contactId, promise]) => [contactId, await promise] as const),
      ),
      Promise.all(
        conversations.map(async (conversation) => [
          conversation.id,
          await listConversationMessageMetadata(db, {
            workspaceId: authority.workspaceId,
            conversationId: conversation.id,
            teamId: conversation.teamId,
            locationId: conversation.locationId,
            pageSize: PAGE_SIZE,
          }),
        ] as const),
      ),
    ]);

    return {
      scopePlan,
      records: assembleInboxRecords({
        workspaceId: authority.workspaceId,
        conversations,
        contacts,
        teams,
        locations,
        consentByContactId: new Map(consentPairs),
        messagesByConversationId: new Map(messagePairs),
      }),
    };
  } catch (error) {
    if (error instanceof InboxWorkspaceDataError) throw error;
    const sourceCode =
      typeof error === "object" && error && "code" in error ? String(error.code) : "";
    throw new InboxWorkspaceDataError(
      "The tenant-scoped Firestore inbox could not be loaded.",
      "load_failed",
      sourceCode,
    );
  }
}

export function describeInboxWorkspaceError(error: unknown): string {
  const code =
    error instanceof InboxWorkspaceDataError
      ? error.sourceCode
      : typeof error === "object" && error && "code" in error
        ? String(error.code)
        : "";
  if (code.includes("permission-denied")) {
    return "Inbox access was denied by the workspace or team-and-location scope rules.";
  }
  if (code.includes("failed-precondition")) {
    return "The local Firestore indexes are not ready for this scoped inbox query.";
  }
  if (error instanceof InboxWorkspaceDataError && error.code === "invalid_join") {
    return "Persisted inbox records failed tenant-scope validation, so the inbox stayed closed.";
  }
  return "The local Firestore emulator could not load the persisted inbox. No cloud fallback was attempted.";
}
