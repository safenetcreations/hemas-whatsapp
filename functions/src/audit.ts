import { deterministicId } from "./deterministic.js";
import { FailClosedError, assertSafeTenantId, assertSameTenant } from "./errors.js";
import type { AuditSinkMode, RuntimeMode } from "./config.js";

export type AuditOutcome = "allowed" | "denied" | "failed" | "simulated";
export type AuditActorType = "user" | "service" | "system";
export type SafeAuditValue = string | number | boolean | null | SafeAuditValue[] | {
  readonly [key: string]: SafeAuditValue;
};

export interface AuditEventInput {
  readonly tenantId: string;
  readonly actor: {
    readonly type: AuditActorType;
    readonly id: string;
  };
  readonly action: string;
  readonly resource: {
    readonly type: string;
    readonly id: string;
  };
  readonly outcome: AuditOutcome;
  readonly requestId: string;
  readonly occurredAt?: Date;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AuditEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly actor: AuditEventInput["actor"];
  readonly action: string;
  readonly resource: AuditEventInput["resource"];
  readonly outcome: AuditOutcome;
  readonly requestId: string;
  readonly occurredAt: string;
  readonly metadata: Readonly<Record<string, SafeAuditValue>>;
}

const SENSITIVE_KEY = /(?:authorization|secret|token|password|cookie|phone|patient|message|body|content|report|diagnos|prescription|payment)/i;
const MAX_DEPTH = 4;
const MAX_ENTRIES = 30;
const MAX_STRING_LENGTH = 180;
const MAX_ACTOR_ID_LENGTH = 128;
const MAX_ACTION_LENGTH = 160;
const MAX_RESOURCE_TYPE_LENGTH = 80;
const MAX_RESOURCE_ID_LENGTH = 128;
const MAX_REQUEST_ID_LENGTH = 128;

function requireBoundedAuditString(
  value: string,
  field: string,
  maxLength: number,
): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new FailClosedError(
      "invalid_audit_event",
      `${field} must contain between 1 and ${maxLength} characters.`,
    );
  }
  return normalized;
}

function sanitizeValue(value: unknown, depth: number): SafeAuditValue {
  if (depth > MAX_DEPTH) return "[TRUNCATED]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : "[NON_FINITE]";
  if (typeof value === "string") return value.slice(0, MAX_STRING_LENGTH);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ENTRIES).map((item) => sanitizeValue(item, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, MAX_ENTRIES)
        .map(([key, item]) => [
          key.slice(0, 80),
          SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeValue(item, depth + 1),
        ]),
    );
  }
  return "[UNSUPPORTED]";
}

export function sanitizeAuditMetadata(
  metadata: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, SafeAuditValue>> {
  return sanitizeValue(metadata, 0) as Readonly<Record<string, SafeAuditValue>>;
}

export function createTenantAuditEvent(input: AuditEventInput): AuditEvent {
  assertSafeTenantId(input.tenantId);
  const actorId = requireBoundedAuditString(
    input.actor.id,
    "Audit actor ID",
    MAX_ACTOR_ID_LENGTH,
  );
  const action = requireBoundedAuditString(
    input.action,
    "Audit action",
    MAX_ACTION_LENGTH,
  );
  const resourceType = requireBoundedAuditString(
    input.resource.type,
    "Audit resource type",
    MAX_RESOURCE_TYPE_LENGTH,
  );
  const resourceId = requireBoundedAuditString(
    input.resource.id,
    "Audit resource ID",
    MAX_RESOURCE_ID_LENGTH,
  );
  const requestId = requireBoundedAuditString(
    input.requestId,
    "Audit request ID",
    MAX_REQUEST_ID_LENGTH,
  );
  const occurredAt = (input.occurredAt ?? new Date()).toISOString();
  const identity = [
    input.tenantId,
    requestId,
    action,
    resourceType,
    resourceId,
    input.outcome,
    occurredAt,
  ].join(":");

  return {
    id: deterministicId("audit", identity),
    tenantId: input.tenantId,
    actor: { type: input.actor.type, id: actorId },
    action,
    resource: { type: resourceType, id: resourceId },
    outcome: input.outcome,
    requestId,
    occurredAt,
    metadata: sanitizeAuditMetadata(input.metadata),
  };
}

export function tenantAuditPath(event: AuditEvent): string {
  assertSafeTenantId(event.tenantId);
  return `workspaces/${event.tenantId}/auditEvents/${event.id}`;
}

export interface AuditSink {
  write(path: string, event: AuditEvent): Promise<void>;
}

export async function writeTenantAuditEvent(
  tenantId: string,
  sink: AuditSink,
  event: AuditEvent,
): Promise<void> {
  assertSameTenant(tenantId, event.tenantId);
  await sink.write(tenantAuditPath(event), event);
}

export class InMemoryAuditSink implements AuditSink {
  readonly records: Array<{ readonly path: string; readonly event: AuditEvent }> = [];

  async write(path: string, event: AuditEvent): Promise<void> {
    this.records.push({ path, event });
  }
}

export class FailClosedAuditSink implements AuditSink {
  async write(_path: string, _event: AuditEvent): Promise<never> {
    throw new FailClosedError(
      "durable_audit_not_configured",
      "A durable tenant audit sink is required before this operation can run.",
    );
  }
}

export function createAuditSink(
  mode: AuditSinkMode,
  runtimeMode: RuntimeMode,
  durableSink?: AuditSink,
): AuditSink {
  if (runtimeMode === "demo" && mode === "memory") {
    return new InMemoryAuditSink();
  }
  if (mode === "durable" && durableSink) {
    return durableSink;
  }
  return new FailClosedAuditSink();
}
