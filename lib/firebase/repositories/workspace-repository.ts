import {
  collection,
  doc,
  getDoc,
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
import { SAFE_CONTACT_TAGS } from "./workspace-mutation-repository";

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Identifier contains unsupported characters");
const supportedLanguage = z.enum(["en", "si", "ta"]);
const timestampValue = z.custom<Timestamp>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof value.toDate === "function",
  "Expected a Firestore Timestamp",
);

const workspaceSchema = z.object({
  id: identifier,
  name: z.string().min(1).max(160),
  status: z.enum(["provisioning", "active", "locked", "suspended", "archived"]),
  mode: z.enum(["local", "demo", "uat", "production"]).optional(),
  dataClassification: z
    .enum(["synthetic_only", "approved_uat", "regulated_patient_data"])
    .optional(),
});

const membershipSchema = z.object({
  id: identifier,
  uid: identifier,
  workspaceId: identifier,
  displayLabel: z.string().min(1).max(160).optional(),
  role: z.enum([
    "platform_owner",
    "tenant_admin",
    "supervisor",
    "agent",
    "campaign_operator",
    "campaign_approver",
    "analyst",
    "privacy_reviewer",
    "clinical_approver",
  ]),
  status: z.enum(["invited", "active", "revoked", "suspended"]),
  teamIds: z.array(identifier).max(50),
  locationIds: z.array(identifier).max(50),
});

const teamDocumentSchema = z
  .object({
    id: identifier,
    workspaceId: identifier,
    name: z.string().min(1).max(160),
    queueType: z.enum([
      "general",
      "outpatient",
      "laboratory",
      "maternity",
      "international",
      "clinical_escalation",
    ]),
    locationIds: z.array(identifier).max(50),
    businessHoursLabel: z.string().min(1).max(240),
    firstResponseSlaMinutes: z.number().int().min(1).max(1_440),
    active: z.boolean(),
    createdAt: timestampValue,
    updatedAt: timestampValue,
  })
  .strict();

const locationDocumentSchema = z
  .object({
    id: identifier,
    workspaceId: identifier,
    name: z.string().min(1).max(160),
    kind: z.enum(["hospital", "laboratory", "collection_point", "virtual_service"]),
    city: z.string().min(1).max(160),
    supportedServiceRefs: z.array(z.string().min(1).max(128)).max(100),
    active: z.boolean(),
    createdAt: timestampValue,
    updatedAt: timestampValue,
  })
  .strict();

const suppressionReason = z.enum([
  "stop_keyword",
  "manual_withdrawal",
  "complaint",
  "invalid_number",
  "guardian_authority_missing",
  "clinical_hold",
]);

const suppressionSchema = z
  .object({
    suppressAll: z.boolean(),
    suppressMarketing: z.boolean(),
    invalidContact: z.boolean(),
    reasons: z
      .array(suppressionReason)
      .max(6)
      .refine((values) => new Set(values).size === values.length),
    updatedAt: timestampValue,
  })
  .strict();

const contactDocumentSchema = z
  .object({
    id: identifier,
    workspaceId: identifier,
    teamId: identifier,
    locationId: identifier,
    maskedPhone: z.string().min(1).max(160),
    displayLabel: z.string().min(1).max(160),
    preferredLanguage: supportedLanguage,
    alternateLanguages: z.array(supportedLanguage).max(2),
    suppression: suppressionSchema,
    tags: z.array(z.enum(SAFE_CONTACT_TAGS)).max(SAFE_CONTACT_TAGS.length),
    preferenceRevision: z.number().int().min(0).max(1_000_000_000),
    synthetic: z.literal(true),
    liveCanary: z.literal(true).optional(),
    createdAt: timestampValue,
    updatedAt: timestampValue,
  })
  .strict()
  .superRefine((data, context) => {
    if (new Set(data.alternateLanguages).size !== data.alternateLanguages.length) {
      context.addIssue({
        code: "custom",
        path: ["alternateLanguages"],
        message: "Alternate languages must be unique",
      });
    }
    if (data.alternateLanguages.includes(data.preferredLanguage)) {
      context.addIssue({
        code: "custom",
        path: ["alternateLanguages"],
        message: "Preferred language cannot also be an alternate language",
      });
    }
    if (new Set(data.tags).size !== data.tags.length) {
      context.addIssue({
        code: "custom",
        path: ["tags"],
        message: "Contact tags must be unique",
      });
    }
  });

const conversationDocumentSchema = z
  .object({
    id: identifier,
    workspaceId: identifier,
    contactId: identifier,
    connectionId: identifier,
    teamId: identifier,
    locationId: identifier,
    status: z.enum(["active", "waiting", "assigned", "escalated", "resolved", "reopened"]),
    mode: z.enum(["automation", "human_takeover", "safety_hold"]),
    assigneeId: identifier.nullable(),
    detectedLanguage: supportedLanguage,
    languageConfidence: z.number().min(0).max(1),
    purpose: z.enum([
      "appointment",
      "laboratory",
      "package",
      "care_pathway",
      "feedback",
      "general_support",
      "urgent_escalation",
    ]),
    serviceWindowExpiresAt: timestampValue.nullable(),
    firstResponseDueAt: timestampValue,
    lastMessageAt: timestampValue,
    handoffSummary: z.string().max(500),
    unreadCount: z.number().int().min(0).max(100_000),
    synthetic: z.literal(true),
    liveCanary: z.literal(true).optional(),
    createdAt: timestampValue,
    updatedAt: timestampValue,
  })
  .strict();

const consentRecordDocumentSchema = z
  .object({
    id: identifier,
    workspaceId: identifier,
    contactId: identifier,
    teamId: identifier,
    locationId: identifier,
    purpose: z.enum([
      "appointment_service",
      "laboratory_service",
      "care_pathway",
      "feedback",
      "health_campaigns",
      "event_campaigns",
      "transactional_updates",
    ]),
    channel: z.literal("whatsapp"),
    category: z.enum(["service", "utility", "marketing", "authentication"]),
    status: z.enum(["granted", "withdrawn", "denied", "expired", "unknown"]),
    source: z.enum([
      "whatsapp_flow",
      "inbound_keyword",
      "preference_centre",
      "staff_recorded",
      "documented_import",
      "authoritative_system",
      "synthetic_fixture",
    ]),
    noticeVersion: z.string().min(1).max(120),
    language: supportedLanguage,
    evidenceRef: z.string().min(1).max(240),
    capturedAt: timestampValue,
    withdrawnAt: timestampValue.nullable(),
    supersedesRecordId: identifier.nullable(),
    synthetic: z.literal(true),
    schemaVersion: z.literal(1),
    createdAt: timestampValue,
    updatedAt: timestampValue,
  })
  .strict();

const messageMetadataDocumentSchema = z
  .object({
    id: identifier,
    workspaceId: identifier,
    conversationId: identifier,
    contactId: identifier,
    teamId: identifier,
    locationId: identifier,
    direction: z.enum(["inbound", "outbound", "internal"]),
    type: z.enum(["text", "template", "image", "document", "interactive", "system"]),
    status: z.enum([
      "received",
      "queued",
      "simulated",
      "accepted",
      "sent",
      "delivered",
      "read",
      "failed",
      "suppressed",
      "send_uncertain",
    ]),
    externalDispatch: z.enum([
      "not_applicable",
      "disabled",
      "simulation_only",
      "eligible",
      "blocked",
      "dispatched",
    ]),
    actorId: identifier.nullable(),
    receivedAt: timestampValue.nullable(),
    sentAt: timestampValue.nullable(),
    deliveredAt: timestampValue.nullable(),
    metadataOnly: z.literal(true),
    synthetic: z.literal(true),
    liveCanary: z.literal(true).optional(),
    agentReply: z.literal(true).optional(),
    schemaVersion: z.literal(1),
    createdAt: timestampValue,
    updatedAt: timestampValue,
  })
  .strict()
  .superRefine((data, context) => {
    if (
      data.direction === "inbound" &&
      (data.status !== "received" ||
        data.externalDispatch !== "not_applicable" ||
        data.actorId !== null ||
        data.receivedAt === null ||
        data.sentAt !== null ||
        data.deliveredAt !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["direction"],
        message: "Inbound metadata must represent a received, undispatched inbound event",
      });
    }

    if (
      data.direction === "outbound" &&
      (data.status === "received" || data.receivedAt !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["direction"],
        message: "Outbound metadata cannot carry inbound receipt state",
      });
    }

    if (
      data.liveCanary === true &&
      data.direction === "outbound" &&
      data.externalDispatch !== "dispatched"
    ) {
      context.addIssue({
        code: "custom",
        path: ["externalDispatch"],
        message: "Live outbound metadata must represent a provider dispatch",
      });
    }

    if (
      data.agentReply === true &&
      (data.liveCanary !== true ||
        data.direction !== "outbound" ||
        data.externalDispatch !== "dispatched" ||
        data.actorId === null ||
        data.sentAt === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["agentReply"],
        message: "Agent replies require an attributed live outbound provider dispatch",
      });
    }
  });

const pageSizeSchema = z.number().int().min(1).max(100).optional();
const workspaceListInputSchema = z
  .object({
    workspaceId: identifier,
    pageSize: pageSizeSchema,
  })
  .strict();
const workspaceAccessInputSchema = z
  .object({
    workspaceId: identifier,
    uid: identifier,
  })
  .strict();
const scopedListInputSchema = z
  .object({
    workspaceId: identifier,
    teamId: identifier.optional(),
    locationId: identifier.optional(),
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

const conversationListInputSchema = scopedListInputSchema.extend({
  statuses: z
    .array(conversationDocumentSchema.shape.status)
    .min(1)
    .max(10)
    .refine((values) => new Set(values).size === values.length)
    .optional(),
});

const consentRecordListInputSchema = z
  .object({
    workspaceId: identifier,
    contactId: identifier,
    teamId: identifier,
    locationId: identifier,
    pageSize: pageSizeSchema,
  })
  .strict();

const messageMetadataListInputSchema = z
  .object({
    workspaceId: identifier,
    conversationId: identifier,
    teamId: identifier,
    locationId: identifier,
    pageSize: pageSizeSchema,
  })
  .strict();

export type WorkspaceDTO = z.infer<typeof workspaceSchema>;
export type MembershipDTO = z.infer<typeof membershipSchema>;
export type WorkspaceListInput = z.infer<typeof workspaceListInputSchema>;
export type ScopedListInput = z.infer<typeof scopedListInputSchema>;
export type ConversationListInput = z.infer<typeof conversationListInputSchema>;
export type ConsentRecordListInput = z.infer<typeof consentRecordListInputSchema>;
export type MessageMetadataListInput = z.infer<typeof messageMetadataListInputSchema>;

type ConversationDocument = z.infer<typeof conversationDocumentSchema>;
type ConsentRecordDocument = z.infer<typeof consentRecordDocumentSchema>;
type MessageMetadataDocument = z.infer<typeof messageMetadataDocumentSchema>;

export type TeamDTO = Omit<z.infer<typeof teamDocumentSchema>, "createdAt" | "updatedAt"> & {
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type LocationDTO = Omit<
  z.infer<typeof locationDocumentSchema>,
  "createdAt" | "updatedAt"
> & {
  readonly createdAt: string;
  readonly updatedAt: string;
};

export interface ContactListItemDTO {
  readonly id: string;
  readonly workspaceId: string;
  readonly teamId: string;
  readonly locationId: string;
  readonly displayLabel: string;
  readonly maskedPhone: string;
  readonly preferredLanguage: "en" | "si" | "ta";
  readonly alternateLanguages: readonly ("en" | "si" | "ta")[];
  readonly tags: readonly (typeof SAFE_CONTACT_TAGS)[number][];
  readonly preferenceRevision: number;
  readonly suppression: {
    readonly suppressAll: boolean;
    readonly suppressMarketing: boolean;
    readonly invalidContact: boolean;
    readonly reasons: readonly z.infer<typeof suppressionReason>[];
    readonly updatedAt: string;
  };
  readonly synthetic: true;
  readonly liveCanary?: true;
  readonly updatedAt: string;
}

export type ConversationListItemDTO = Omit<
  ConversationDocument,
  "serviceWindowExpiresAt" | "firstResponseDueAt" | "lastMessageAt" | "createdAt" | "updatedAt"
> & {
  readonly serviceWindowExpiresAt: string | null;
  readonly firstResponseDueAt: string;
  readonly lastMessageAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ConsentRecordDTO = Omit<
  ConsentRecordDocument,
  "capturedAt" | "withdrawnAt" | "createdAt" | "updatedAt"
> & {
  readonly capturedAt: string;
  readonly withdrawnAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type MessageMetadataDTO = Omit<
  MessageMetadataDocument,
  "receivedAt" | "sentAt" | "deliveredAt" | "createdAt" | "updatedAt"
> & {
  readonly receivedAt: string | null;
  readonly sentAt: string | null;
  readonly deliveredAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export interface WorkspaceAccessDTO {
  workspace: WorkspaceDTO;
  membership: MembershipDTO;
}

export class WorkspaceAccessError extends Error {
  constructor(
    message: string,
    readonly code:
      | "workspace_not_found"
      | "membership_not_found"
      | "membership_inactive"
      | "invalid_data",
  ) {
    super(message);
    this.name = "WorkspaceAccessError";
  }
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new WorkspaceAccessError(`${label} failed schema validation.`, "invalid_data");
  }
  return result.data;
}

function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  return parseOrThrow(schema, value, "Repository input");
}

function timestampToIso(value: Timestamp | null): string | null {
  return value === null ? null : value.toDate().toISOString();
}

export function prepareScopedListInput(input: ScopedListInput): ScopedListInput {
  return parseInput(scopedListInputSchema, input);
}

export function prepareWorkspaceListInput(input: WorkspaceListInput): WorkspaceListInput {
  return parseInput(workspaceListInputSchema, input);
}

export function prepareConversationListInput(
  input: ConversationListInput,
): ConversationListInput {
  return parseInput(conversationListInputSchema, input);
}

export function prepareConsentRecordListInput(
  input: ConsentRecordListInput,
): ConsentRecordListInput {
  return parseInput(consentRecordListInputSchema, input);
}

export function prepareMessageMetadataListInput(
  input: MessageMetadataListInput,
): MessageMetadataListInput {
  return parseInput(messageMetadataListInputSchema, input);
}

export function parseMessageMetadataDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): MessageMetadataDTO {
  const parsed = parseOrThrow(messageMetadataDocumentSchema, value, "Message metadata");
  if (parsed.id !== documentId || parsed.workspaceId !== workspaceId) {
    throw new WorkspaceAccessError(
      "Message metadata identity does not match its tenant path.",
      "invalid_data",
    );
  }
  return {
    ...parsed,
    receivedAt: timestampToIso(parsed.receivedAt),
    sentAt: timestampToIso(parsed.sentAt),
    deliveredAt: timestampToIso(parsed.deliveredAt),
    createdAt: parsed.createdAt.toDate().toISOString(),
    updatedAt: parsed.updatedAt.toDate().toISOString(),
  };
}

export function parseContactDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): ContactListItemDTO {
  const parsed = parseOrThrow(contactDocumentSchema, value, "Contact");
  if (parsed.id !== documentId || parsed.workspaceId !== workspaceId) {
    throw new WorkspaceAccessError(
      "Contact identity does not match its tenant path.",
      "invalid_data",
    );
  }
  return {
    id: parsed.id,
    workspaceId: parsed.workspaceId,
    teamId: parsed.teamId,
    locationId: parsed.locationId,
    displayLabel: parsed.displayLabel,
    maskedPhone: parsed.maskedPhone,
    preferredLanguage: parsed.preferredLanguage,
    alternateLanguages: parsed.alternateLanguages,
    tags: parsed.tags,
    preferenceRevision: parsed.preferenceRevision,
    suppression: {
      ...parsed.suppression,
      updatedAt: parsed.suppression.updatedAt.toDate().toISOString(),
    },
    synthetic: parsed.synthetic,
    ...(parsed.liveCanary === true ? { liveCanary: true as const } : {}),
    updatedAt: parsed.updatedAt.toDate().toISOString(),
  };
}

export function parseConversationDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): ConversationListItemDTO {
  const parsed = parseOrThrow(conversationDocumentSchema, value, "Conversation");
  if (parsed.id !== documentId || parsed.workspaceId !== workspaceId) {
    throw new WorkspaceAccessError(
      "Conversation identity does not match its tenant path.",
      "invalid_data",
    );
  }
  return {
    ...parsed,
    serviceWindowExpiresAt: timestampToIso(parsed.serviceWindowExpiresAt),
    firstResponseDueAt: parsed.firstResponseDueAt.toDate().toISOString(),
    lastMessageAt: parsed.lastMessageAt.toDate().toISOString(),
    createdAt: parsed.createdAt.toDate().toISOString(),
    updatedAt: parsed.updatedAt.toDate().toISOString(),
  };
}

export async function getWorkspaceAccess(
  db: Firestore,
  rawInput: { workspaceId: string; uid: string },
): Promise<WorkspaceAccessDTO> {
  const input = parseInput(workspaceAccessInputSchema, rawInput);
  const [workspaceSnapshot, membershipSnapshot] = await Promise.all([
    getDoc(doc(db, "workspaces", input.workspaceId)),
    getDoc(doc(db, "workspaces", input.workspaceId, "members", input.uid)),
  ]);

  if (!workspaceSnapshot.exists()) {
    throw new WorkspaceAccessError("Workspace is unavailable.", "workspace_not_found");
  }
  if (!membershipSnapshot.exists()) {
    throw new WorkspaceAccessError("Workspace membership is unavailable.", "membership_not_found");
  }

  return parseWorkspaceAccessDocuments({
    workspaceId: input.workspaceId,
    uid: input.uid,
    workspaceDocumentId: workspaceSnapshot.id,
    membershipDocumentId: membershipSnapshot.id,
    workspaceValue: workspaceSnapshot.data(),
    membershipValue: membershipSnapshot.data(),
  });
}

export function parseWorkspaceAccessDocuments(input: {
  readonly workspaceId: string;
  readonly uid: string;
  readonly workspaceDocumentId: string;
  readonly membershipDocumentId: string;
  readonly workspaceValue: unknown;
  readonly membershipValue: unknown;
}): WorkspaceAccessDTO {
  const request = parseInput(workspaceAccessInputSchema, {
    workspaceId: input.workspaceId,
    uid: input.uid,
  });
  const workspace = parseOrThrow(workspaceSchema, input.workspaceValue, "Workspace");
  const membership = parseOrThrow(membershipSchema, input.membershipValue, "Membership");
  if (
    input.workspaceDocumentId !== request.workspaceId ||
    workspace.id !== request.workspaceId ||
    input.membershipDocumentId !== request.uid ||
    membership.id !== request.uid ||
    membership.uid !== request.uid ||
    membership.workspaceId !== request.workspaceId
  ) {
    throw new WorkspaceAccessError(
      "Workspace access documents do not match their requested tenant paths.",
      "invalid_data",
    );
  }
  if (membership.status !== "active") {
    throw new WorkspaceAccessError("Workspace membership is not active.", "membership_inactive");
  }
  return { workspace, membership };
}

export async function listWorkspaceTeams(
  db: Firestore,
  rawInput: WorkspaceListInput,
): Promise<readonly TeamDTO[]> {
  const input = prepareWorkspaceListInput(rawInput);
  const snapshot = await getDocs(
    query(
      collection(db, "workspaces", input.workspaceId, "teams"),
      orderBy("name", "asc"),
      limit(input.pageSize ?? 100),
    ),
  );
  return snapshot.docs.map((record) => {
    const parsed = parseOrThrow(teamDocumentSchema, record.data(), "Team");
    if (parsed.id !== record.id || parsed.workspaceId !== input.workspaceId) {
      throw new WorkspaceAccessError("Team identity does not match its tenant path.", "invalid_data");
    }
    return {
      ...parsed,
      createdAt: parsed.createdAt.toDate().toISOString(),
      updatedAt: parsed.updatedAt.toDate().toISOString(),
    };
  });
}

export async function listWorkspaceLocations(
  db: Firestore,
  rawInput: WorkspaceListInput,
): Promise<readonly LocationDTO[]> {
  const input = prepareWorkspaceListInput(rawInput);
  const snapshot = await getDocs(
    query(
      collection(db, "workspaces", input.workspaceId, "locations"),
      orderBy("name", "asc"),
      limit(input.pageSize ?? 100),
    ),
  );
  return snapshot.docs.map((record) => {
    const parsed = parseOrThrow(locationDocumentSchema, record.data(), "Location");
    if (parsed.id !== record.id || parsed.workspaceId !== input.workspaceId) {
      throw new WorkspaceAccessError(
        "Location identity does not match its tenant path.",
        "invalid_data",
      );
    }
    return {
      ...parsed,
      createdAt: parsed.createdAt.toDate().toISOString(),
      updatedAt: parsed.updatedAt.toDate().toISOString(),
    };
  });
}

function scopedConstraints(input: ScopedListInput): QueryConstraint[] {
  const constraints: QueryConstraint[] = [];
  if (input.teamId && input.locationId) {
    constraints.push(where("teamId", "==", input.teamId));
    constraints.push(where("locationId", "==", input.locationId));
  }
  return constraints;
}

export async function listScopedConversations(
  db: Firestore,
  rawInput: ConversationListInput,
): Promise<readonly ConversationListItemDTO[]> {
  const input = prepareConversationListInput(rawInput);
  const constraints = scopedConstraints(input);
  if (input.statuses) {
    constraints.push(where("status", "in", input.statuses));
  }
  constraints.push(orderBy("lastMessageAt", "desc"));
  constraints.push(limit(input.pageSize ?? 50));

  const snapshot = await getDocs(
    query(collection(db, "workspaces", input.workspaceId, "conversations"), ...constraints),
  );
  return snapshot.docs.map((record) =>
    parseConversationDocument(record.data(), record.id, input.workspaceId),
  );
}

export async function listScopedContacts(
  db: Firestore,
  rawInput: ScopedListInput,
): Promise<readonly ContactListItemDTO[]> {
  const input = prepareScopedListInput(rawInput);
  const constraints = scopedConstraints(input);
  constraints.push(orderBy("updatedAt", "desc"));
  constraints.push(limit(input.pageSize ?? 50));

  const snapshot = await getDocs(
    query(collection(db, "workspaces", input.workspaceId, "contacts"), ...constraints),
  );
  return snapshot.docs.map((record) =>
    parseContactDocument(record.data(), record.id, input.workspaceId),
  );
}

export async function listConsentRecordsForContact(
  db: Firestore,
  rawInput: ConsentRecordListInput,
): Promise<readonly ConsentRecordDTO[]> {
  const input = prepareConsentRecordListInput(rawInput);
  const snapshot = await getDocs(
    query(
      collection(db, "workspaces", input.workspaceId, "consentRecords"),
      where("contactId", "==", input.contactId),
      where("teamId", "==", input.teamId),
      where("locationId", "==", input.locationId),
      orderBy("capturedAt", "desc"),
      limit(input.pageSize ?? 50),
    ),
  );

  return snapshot.docs.map((record) => {
    const parsed = parseOrThrow(consentRecordDocumentSchema, record.data(), "Consent record");
    if (
      parsed.id !== record.id ||
      parsed.workspaceId !== input.workspaceId ||
      parsed.contactId !== input.contactId ||
      parsed.teamId !== input.teamId ||
      parsed.locationId !== input.locationId
    ) {
      throw new WorkspaceAccessError(
        "Consent record identity does not match its tenant path and query.",
        "invalid_data",
      );
    }
    return {
      ...parsed,
      capturedAt: parsed.capturedAt.toDate().toISOString(),
      withdrawnAt: timestampToIso(parsed.withdrawnAt),
      createdAt: parsed.createdAt.toDate().toISOString(),
      updatedAt: parsed.updatedAt.toDate().toISOString(),
    };
  });
}

export async function listConversationMessageMetadata(
  db: Firestore,
  rawInput: MessageMetadataListInput,
): Promise<readonly MessageMetadataDTO[]> {
  const input = prepareMessageMetadataListInput(rawInput);
  const snapshot = await getDocs(
    query(
      collection(db, "workspaces", input.workspaceId, "messages"),
      where("conversationId", "==", input.conversationId),
      where("teamId", "==", input.teamId),
      where("locationId", "==", input.locationId),
      orderBy("createdAt", "desc"),
      limit(input.pageSize ?? 50),
    ),
  );

  return snapshot.docs.map((record) => {
    const parsed = parseMessageMetadataDocument(
      record.data(),
      record.id,
      input.workspaceId,
    );
    if (
      parsed.conversationId !== input.conversationId ||
      parsed.teamId !== input.teamId ||
      parsed.locationId !== input.locationId
    ) {
      throw new WorkspaceAccessError(
        "Message metadata identity does not match its tenant path and query.",
        "invalid_data",
      );
    }
    return parsed;
  });
}
