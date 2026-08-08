import type { Firestore } from "firebase-admin/firestore";
import {
  type AuditEvent,
  type AuditSink,
  tenantAuditPath,
} from "./audit.js";
import { FailClosedError } from "./errors.js";
import { assertGovernedDemoProjectBoundary } from "./governed-project.js";

const DEMO_PROJECT_ID = "demo-hemas-connect";

export interface FirestoreAuditRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly actorUid: string;
  readonly actorType: AuditEvent["actor"]["type"];
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly outcome: AuditEvent["outcome"];
  readonly requestId: string;
  readonly occurredAt: Date;
  readonly createdAt: Date;
  readonly metadata: AuditEvent["metadata"];
  readonly synthetic: true;
  readonly schemaVersion: 1;
}

type CreateOnlyDocument = {
  create(data: FirestoreAuditRecord): Promise<unknown>;
};

export interface CreateOnlyAuditStore {
  doc(path: string): CreateOnlyDocument;
}

function parseEmulatorHost(host: string): { hostname: string; port: number } {
  const normalized = host.includes("://") ? host : `http://${host}`;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new FailClosedError(
      "invalid_audit_emulator",
      "A valid Firestore emulator host is required.",
    );
  }
  const port = Number(url.port);
  if (
    (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "::1") ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new FailClosedError(
      "invalid_audit_emulator",
      "Durable demo audit writes require a loopback Firestore emulator host and port.",
    );
  }
  return { hostname: url.hostname, port };
}

export function assertDemoAuditEmulatorBoundary(
  input: {
    readonly projectId: string;
    readonly firestoreEmulatorHost: string | undefined;
  },
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (input.projectId === DEMO_PROJECT_ID) {
    if (!input.firestoreEmulatorHost) {
      throw new FailClosedError(
        "audit_emulator_required",
        "The Firestore emulator must be explicitly configured for durable demo audit writes.",
      );
    }
    parseEmulatorHost(input.firestoreEmulatorHost);
    return;
  }
  // The governed cloud demo project is the only non-emulator home; it is
  // inert unless explicitly enabled and refuses emulator-host leakage.
  assertGovernedDemoProjectBoundary(input, env);
}

export function toFirestoreAuditRecord(event: AuditEvent): FirestoreAuditRecord {
  const occurredAt = new Date(event.occurredAt);
  if (!Number.isFinite(occurredAt.getTime())) {
    throw new FailClosedError(
      "invalid_audit_event",
      "Audit occurrence time must be a valid timestamp.",
    );
  }
  return {
    id: event.id,
    workspaceId: event.tenantId,
    actorUid: event.actor.id,
    actorType: event.actor.type,
    action: event.action,
    resourceType: event.resource.type,
    resourceId: event.resource.id,
    outcome: event.outcome,
    requestId: event.requestId,
    occurredAt,
    createdAt: occurredAt,
    metadata: event.metadata,
    synthetic: true,
    schemaVersion: 1,
  };
}

export class FirestoreAuditSink implements AuditSink {
  constructor(private readonly store: CreateOnlyAuditStore) {}

  async write(path: string, event: AuditEvent): Promise<void> {
    if (path !== tenantAuditPath(event)) {
      throw new FailClosedError(
        "invalid_audit_path",
        "The durable audit document path does not match the event tenant and ID.",
      );
    }
    await this.store.doc(path).create(toFirestoreAuditRecord(event));
  }
}

export function createDemoFirestoreAuditSink(input: {
  readonly db: Firestore;
  readonly projectId: string;
  readonly firestoreEmulatorHost: string | undefined;
}): FirestoreAuditSink {
  assertDemoAuditEmulatorBoundary(input);
  return new FirestoreAuditSink(input.db);
}
