import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { assertDemoAuditEmulatorBoundary } from "./audit-firestore.js";
import { deterministicId } from "./deterministic.js";
import { FailClosedError, assertSafeTenantId } from "./errors.js";
import {
  executeAuditedWorkspaceMutation,
  fingerprintServiceRequest,
  type AuditedMutationResponse,
  type MutationResult,
} from "./service-kernel.js";

const NOTE_KINDS = ["handoff_context", "appointment_context", "safety_context"] as const;
type NoteKind = (typeof NOTE_KINDS)[number];

export interface AppendSyntheticInternalNoteInput {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly teamId: string;
  readonly locationId: string;
  readonly noteKind: NoteKind;
  readonly idempotencyKey: string;
}

export interface AppendSyntheticInternalNoteResult extends MutationResult {
  readonly noteId: string;
  readonly conversationId: string;
  readonly noteKind: NoteKind;
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

function requireExactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FailClosedError("invalid_service_request", "A request object is required.");
  }
  const data = value as Record<string, unknown>;
  const actual = Object.keys(data).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new FailClosedError("invalid_service_request", "Request fields are invalid.");
  }
  return data;
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new FailClosedError("invalid_service_request", `${label} is invalid.`);
  }
  return value;
}

export function parseAppendSyntheticInternalNoteInput(
  value: unknown,
): AppendSyntheticInternalNoteInput {
  const data = requireExactObject(value, [
    "workspaceId",
    "conversationId",
    "teamId",
    "locationId",
    "noteKind",
    "idempotencyKey",
  ]);
  const workspaceId = requireId(data.workspaceId, "Workspace ID");
  assertSafeTenantId(workspaceId);
  const noteKind = data.noteKind;
  if (typeof noteKind !== "string" || !NOTE_KINDS.includes(noteKind as NoteKind)) {
    throw new FailClosedError("invalid_service_request", "Note kind is invalid.");
  }
  if (typeof data.idempotencyKey !== "string") {
    throw new FailClosedError("invalid_service_request", "Idempotency key is invalid.");
  }
  return {
    workspaceId,
    conversationId: requireId(data.conversationId, "Conversation ID"),
    teamId: requireId(data.teamId, "Team ID"),
    locationId: requireId(data.locationId, "Location ID"),
    noteKind: noteKind as NoteKind,
    idempotencyKey: data.idempotencyKey,
  };
}

export async function appendSyntheticInternalNote(input: {
  readonly db: Firestore;
  readonly actor: { readonly uid: string; readonly authTime: Date };
  readonly request: AppendSyntheticInternalNoteInput;
  readonly now?: Date;
}): Promise<AuditedMutationResponse<AppendSyntheticInternalNoteResult>> {
  const now = input.now ?? new Date();
  const requestHash = fingerprintServiceRequest({
    workspaceId: input.request.workspaceId,
    conversationId: input.request.conversationId,
    teamId: input.request.teamId,
    locationId: input.request.locationId,
    noteKind: input.request.noteKind,
  });
  const noteId = deterministicId(
    "note",
    [
      input.request.workspaceId,
      input.actor.uid,
      input.request.conversationId,
      input.request.idempotencyKey,
    ].join(":"),
  );

  return executeAuditedWorkspaceMutation({
    db: input.db,
    workspaceId: input.request.workspaceId,
    actor: input.actor,
    action: "internal-note.create",
    purpose: "patient_support",
    policy: {
      allowedRoles: ["tenant_admin", "supervisor", "agent"],
      patientScope: {
        teamId: input.request.teamId,
        locationId: input.request.locationId,
      },
      recentAuthMaxAgeSeconds: 3_600,
    },
    idempotencyKey: input.request.idempotencyKey,
    requestHash,
    now,
    async mutate(transaction, context) {
      const conversationRef = input.db.doc(
        `workspaces/${input.request.workspaceId}/conversations/${input.request.conversationId}`,
      );
      const conversation = await transaction.get(conversationRef);
      const data = conversation.data();
      if (
        !conversation.exists ||
        data?.id !== input.request.conversationId ||
        data?.workspaceId !== input.request.workspaceId ||
        data?.teamId !== input.request.teamId ||
        data?.locationId !== input.request.locationId ||
        data?.synthetic !== true
      ) {
        throw new FailClosedError(
          "conversation_denied",
          "A matching synthetic conversation in the authorized scope is required.",
        );
      }
      const noteRef = input.db.doc(
        `workspaces/${input.request.workspaceId}/internalNotes/${noteId}`,
      );
      transaction.create(noteRef, {
        id: noteId,
        workspaceId: input.request.workspaceId,
        conversationId: input.request.conversationId,
        authorUid: context.uid,
        teamId: input.request.teamId,
        locationId: input.request.locationId,
        bodyRef:
          `protected://workspaces/${input.request.workspaceId}/internal-notes/${noteId}`,
        noteKind: input.request.noteKind,
        createdAt: now,
        synthetic: true,
        schemaVersion: 1,
      });
      return {
        resource: { type: "internal-note", id: noteId },
        result: {
          noteId,
          conversationId: input.request.conversationId,
          noteKind: input.request.noteKind,
        },
        auditMetadata: {
          noteKind: input.request.noteKind,
          teamId: input.request.teamId,
          locationId: input.request.locationId,
          synthetic: true,
        },
      };
    },
  });
}

function getDemoFirestore(): Firestore {
  const projectId = process.env.GCLOUD_PROJECT ?? "";
  assertDemoAuditEmulatorBoundary({
    projectId,
    firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
  });
  const app = getApps().length > 0 ? getApp() : initializeApp({ projectId });
  return getFirestore(app);
}

function authenticatedActor(request: CallableRequest<unknown>): {
  readonly uid: string;
  readonly authTime: Date;
} {
  if (!request.auth) {
    throw new FailClosedError("authentication_required", "Authentication is required.");
  }
  const authTime = request.auth.token.auth_time;
  if (typeof authTime !== "number" || !Number.isFinite(authTime)) {
    throw new FailClosedError("authentication_required", "Authentication time is unavailable.");
  }
  return { uid: request.auth.uid, authTime: new Date(authTime * 1_000) };
}

function mapCallableError(error: unknown): HttpsError {
  if (!(error instanceof FailClosedError)) {
    return new HttpsError("internal", "The synthetic service failed closed.");
  }
  if (error.code === "authentication_required") {
    return new HttpsError("unauthenticated", error.message);
  }
  if (error.code === "invalid_service_request" || error.code.startsWith("invalid_")) {
    return new HttpsError("invalid-argument", error.message);
  }
  if (error.code === "recent_auth_required") {
    return new HttpsError("failed-precondition", error.message);
  }
  return new HttpsError("permission-denied", error.message);
}

export const demoAppendInternalNote = onCall(
  {
    memory: "128MiB",
    timeoutSeconds: 10,
    maxInstances: 3,
    concurrency: 10,
    enforceAppCheck: false,
  },
  async (request) => {
    try {
      const actor = authenticatedActor(request);
      const parsed = parseAppendSyntheticInternalNoteInput(request.data);
      return await appendSyntheticInternalNote({
        db: getDemoFirestore(),
        actor,
        request: parsed,
      });
    } catch (error) {
      throw mapCallableError(error);
    }
  },
);
