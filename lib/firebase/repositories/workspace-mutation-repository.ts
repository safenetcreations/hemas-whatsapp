import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type Firestore,
  type Timestamp,
} from "firebase/firestore";
import { z } from "zod";

export const SAFE_CONTACT_TAGS = [
  "appointment",
  "laboratory",
  "package",
  "human-handoff",
  "urgent-simulation",
  "marketing-suppressed",
] as const;

const persistedIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Identifier contains unsupported characters");
const supportedLanguageSchema = z.enum(["en", "si", "ta"]);
const safeContactTagSchema = z.enum(SAFE_CONTACT_TAGS);
const timestampValueSchema = z.custom<Timestamp>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof value.toDate === "function",
  "Expected a Firestore Timestamp",
);

const suppressionSchema = z
  .object({
    suppressAll: z.boolean(),
    suppressMarketing: z.boolean(),
    invalidContact: z.boolean(),
    reasons: z
      .array(
        z.enum([
          "stop_keyword",
          "manual_withdrawal",
          "complaint",
          "invalid_number",
          "guardian_authority_missing",
          "clinical_hold",
        ]),
      )
      .max(6)
      .refine((values) => new Set(values).size === values.length, "Suppression reasons must be unique"),
    updatedAt: timestampValueSchema,
  })
  .strict();

const persistedContactSchema = z
  .object({
    id: persistedIdentifierSchema,
    workspaceId: persistedIdentifierSchema,
    teamId: persistedIdentifierSchema,
    locationId: persistedIdentifierSchema,
    maskedPhone: z.string().min(1).max(160),
    displayLabel: z.string().min(1).max(160),
    preferredLanguage: supportedLanguageSchema,
    alternateLanguages: z.array(supportedLanguageSchema).max(2),
    suppression: suppressionSchema,
    tags: z.array(safeContactTagSchema).max(SAFE_CONTACT_TAGS.length),
    synthetic: z.boolean(),
    preferenceRevision: z.number().int().min(0).max(1_000_000_000),
    createdAt: timestampValueSchema,
    updatedAt: timestampValueSchema,
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

const persistedSyntheticInternalNoteSchema = z
  .object({
    id: persistedIdentifierSchema,
    workspaceId: persistedIdentifierSchema,
    conversationId: persistedIdentifierSchema,
    authorUid: persistedIdentifierSchema,
    teamId: persistedIdentifierSchema,
    locationId: persistedIdentifierSchema,
    bodyRef: z.string().min(1).max(400),
    noteKind: z.enum(["handoff_context", "appointment_context", "safety_context"]),
    synthetic: z.literal(true),
    schemaVersion: z.literal(1),
    createdAt: timestampValueSchema,
  })
  .strict();

const contactPreferenceUpdateInputSchema = z
  .object({
    workspaceId: persistedIdentifierSchema,
    contactId: persistedIdentifierSchema,
    preferredLanguage: supportedLanguageSchema,
    alternateLanguages: z.array(supportedLanguageSchema).max(2),
    tags: z.array(safeContactTagSchema).max(SAFE_CONTACT_TAGS.length),
    expectedPreferenceRevision: z.number().int().min(0).max(1_000_000_000),
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

const listSyntheticInternalNotesInputSchema = z
  .object({
    workspaceId: persistedIdentifierSchema,
    conversationId: persistedIdentifierSchema,
    teamId: persistedIdentifierSchema,
    locationId: persistedIdentifierSchema,
    pageSize: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export type SafeContactTag = (typeof SAFE_CONTACT_TAGS)[number];
export type ContactPreferenceUpdateInput = z.infer<typeof contactPreferenceUpdateInputSchema>;
export type ListSyntheticInternalNotesInput = z.infer<
  typeof listSyntheticInternalNotesInputSchema
>;

export interface ContactPreferenceUpdateResult {
  readonly contactId: string;
  readonly preferredLanguage: "en" | "si" | "ta";
  readonly alternateLanguages: readonly ("en" | "si" | "ta")[];
  readonly tags: readonly SafeContactTag[];
  readonly preferenceRevision: number;
}

export interface SyntheticInternalNoteDTO {
  readonly id: string;
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly authorUid: string;
  readonly teamId: string;
  readonly locationId: string;
  readonly bodyRef: string;
  readonly noteKind: "handoff_context" | "appointment_context" | "safety_context";
  readonly synthetic: true;
  readonly schemaVersion: 1;
  readonly createdAt: string;
}

export class WorkspaceMutationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_input"
      | "invalid_persisted_data"
      | "contact_not_found"
      | "contact_not_synthetic"
      | "contact_preference_conflict",
  ) {
    super(message);
    this.name = "WorkspaceMutationError";
  }
}

function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new WorkspaceMutationError("Mutation input failed validation.", "invalid_input");
  }
  return result.data;
}

function parsePersisted<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new WorkspaceMutationError(
      `${label} failed persisted schema validation.`,
      "invalid_persisted_data",
    );
  }
  return result.data;
}

function protectedNoteBodyRef(workspaceId: string, noteId: string): string {
  return `protected://workspaces/${workspaceId}/internal-notes/${noteId}`;
}

/**
 * Validates and normalizes a mutation before any Firestore call. Exported so
 * boundary behavior can be unit-tested independently from the emulator.
 */
export function prepareContactPreferenceUpdate(
  input: ContactPreferenceUpdateInput,
): ContactPreferenceUpdateInput {
  return parseInput(contactPreferenceUpdateInputSchema, input);
}

export async function updateSyntheticContactPreferences(
  db: Firestore,
  rawInput: ContactPreferenceUpdateInput,
): Promise<ContactPreferenceUpdateResult> {
  const input = prepareContactPreferenceUpdate(rawInput);
  const contactRef = doc(db, "workspaces", input.workspaceId, "contacts", input.contactId);

  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(contactRef);
    if (!snapshot.exists()) {
      throw new WorkspaceMutationError("Contact does not exist.", "contact_not_found");
    }

    const contact = parsePersisted(persistedContactSchema, snapshot.data(), "Contact");
    if (contact.workspaceId !== input.workspaceId || contact.id !== input.contactId) {
      throw new WorkspaceMutationError(
        "Contact identity does not match its tenant path.",
        "invalid_persisted_data",
      );
    }
    if (!contact.synthetic) {
      throw new WorkspaceMutationError(
        "Only synthetic contacts can be changed by this repository.",
        "contact_not_synthetic",
      );
    }
    if (contact.preferenceRevision !== input.expectedPreferenceRevision) {
      throw new WorkspaceMutationError(
        "Contact preferences changed since they were loaded.",
        "contact_preference_conflict",
      );
    }

    const preferenceRevision = contact.preferenceRevision + 1;
    transaction.update(contactRef, {
      preferredLanguage: input.preferredLanguage,
      alternateLanguages: [...input.alternateLanguages],
      tags: [...input.tags],
      preferenceRevision,
      updatedAt: serverTimestamp(),
    });

    return {
      contactId: contact.id,
      preferredLanguage: input.preferredLanguage,
      alternateLanguages: input.alternateLanguages,
      tags: input.tags,
      preferenceRevision,
    };
  });
}

export async function listSyntheticInternalNotes(
  db: Firestore,
  rawInput: ListSyntheticInternalNotesInput,
): Promise<readonly SyntheticInternalNoteDTO[]> {
  const input = parseInput(listSyntheticInternalNotesInputSchema, rawInput);
  const snapshot = await getDocs(
    query(
      collection(db, "workspaces", input.workspaceId, "internalNotes"),
      where("conversationId", "==", input.conversationId),
      where("teamId", "==", input.teamId),
      where("locationId", "==", input.locationId),
      where("synthetic", "==", true),
      orderBy("createdAt", "desc"),
      limit(input.pageSize ?? 50),
    ),
  );

  return snapshot.docs.map((record) => {
    const note = parsePersisted(
      persistedSyntheticInternalNoteSchema,
      record.data(),
      "Internal note",
    );
    if (
      note.id !== record.id ||
      note.workspaceId !== input.workspaceId ||
      note.conversationId !== input.conversationId ||
      note.teamId !== input.teamId ||
      note.locationId !== input.locationId ||
      note.bodyRef !== protectedNoteBodyRef(input.workspaceId, note.id)
    ) {
      throw new WorkspaceMutationError(
        "Internal note identity does not match its tenant path.",
        "invalid_persisted_data",
      );
    }
    return { ...note, createdAt: note.createdAt.toDate().toISOString() };
  });
}
