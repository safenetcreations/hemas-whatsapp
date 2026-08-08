import { sha256Hex } from "../deterministic.js";
import { FailClosedError, assertSafeTenantId, assertSameTenant } from "../errors.js";
import {
  getSyntheticFlowDefinition,
  type SyntheticFlowAction,
} from "./definitions.js";
import { InMemoryFlowReplayGuard } from "./replay.js";
import {
  verifyDemoFlowSessionToken,
  type SyntheticFlowPurpose,
  type SyntheticSigningKey,
} from "./token.js";

export const SYNTHETIC_FLOW_ACTION_SCHEMA = "hemas.synthetic.flow-action" as const;
export const SYNTHETIC_FLOW_ACTION_VERSION = 1 as const;
export const SYNTHETIC_FLOW_RESPONSE_SCHEMA = "hemas.synthetic.flow-response" as const;
export const SYNTHETIC_FLOW_RESPONSE_VERSION = 1 as const;

export interface SyntheticFlowActionRequest {
  readonly schema: typeof SYNTHETIC_FLOW_ACTION_SCHEMA;
  readonly version: typeof SYNTHETIC_FLOW_ACTION_VERSION;
  readonly mode: "demo";
  readonly source: "internal_synthetic_test";
  readonly tenantId: string;
  readonly purpose: SyntheticFlowPurpose;
  readonly definitionId: string;
  readonly sessionId: string;
  readonly correlationId: string;
  readonly screen: string;
  readonly action: SyntheticFlowAction;
  readonly idempotencyKey: string;
  readonly token: string;
}

export interface SyntheticFlowExecutionContext {
  readonly runtimeMode: "demo" | "live";
  readonly transport: "internal_synthetic" | "meta";
  readonly expectedTenantId: string;
  readonly syntheticSigningKey: SyntheticSigningKey;
  readonly replayGuard: InMemoryFlowReplayGuard;
  readonly now?: Date;
}

export interface PendingConfirmationResponse {
  readonly schema: typeof SYNTHETIC_FLOW_RESPONSE_SCHEMA;
  readonly version: typeof SYNTHETIC_FLOW_RESPONSE_VERSION;
  readonly mode: "demo";
  readonly status: "pending_confirmation";
  readonly nextScreen: "PENDING_CONFIRMATION";
  readonly responseId: string;
  readonly tenantId: string;
  readonly purpose: SyntheticFlowPurpose;
  readonly definitionId: string;
  readonly sessionId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly tokenExpiresAt: string;
  readonly transactionConfirmed: false;
  readonly hemasWritePerformed: false;
  readonly providerWritePerformed: false;
  readonly persisted: false;
  readonly networkCalls: 0;
  readonly replayed: boolean;
  readonly synthetic: true;
}

const ACTION_KEYS = [
  "action",
  "correlationId",
  "definitionId",
  "idempotencyKey",
  "mode",
  "purpose",
  "schema",
  "screen",
  "sessionId",
  "source",
  "tenantId",
  "token",
  "version",
] as const;

const PROVIDER_PAYLOAD_KEYS = [
  "encrypted_flow_data",
  "encrypted_aes_key",
  "initial_vector",
  "flow_token",
] as const;

const PURPOSES: readonly SyntheticFlowPurpose[] = [
  "appointment_request",
  "appointment_change_request",
  "laboratory_collection_request",
  "package_enquiry",
  "feedback",
  "communication_preferences",
  "service_information",
];
const ACTIONS: readonly SyntheticFlowAction[] = ["continue", "submit_pending"];
const SAFE_DEFINITION_ID = /^synthetic-flow-[a-z0-9-]{3,80}$/;
const SAFE_SESSION_ID = /^synthetic-session-[a-z0-9-]{6,80}$/;
const SAFE_CORRELATION_ID = /^synthetic-correlation-[a-z0-9-]{6,80}$/;
const SAFE_SCREEN_ID = /^[A-Z][A-Z0-9_]{1,63}$/;
const SAFE_IDEMPOTENCY_KEY = /^synthetic-idempotency-[a-z0-9-]{6,80}$/;

function assertExactActionKeys(value: Readonly<Record<string, unknown>>): void {
  const keys = Object.keys(value);
  if (PROVIDER_PAYLOAD_KEYS.some((key) => keys.includes(key))) {
    throw new FailClosedError(
      "provider_flow_payload_denied",
      "Provider Flow payloads and encrypted data exchange are not accepted or implemented.",
    );
  }
  const actual = keys.sort();
  if (
    actual.length !== ACTION_KEYS.length ||
    actual.some((key, index) => key !== ACTION_KEYS[index])
  ) {
    throw new FailClosedError(
      "malformed_flow_action",
      "Synthetic flow action contains missing or unexpected fields.",
    );
  }
}

function assertBoundedString(
  value: unknown,
  field: string,
  maximumLength: number,
): asserts value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximumLength) {
    throw new FailClosedError("malformed_flow_action", `${field} is malformed.`);
  }
}

/**
 * Strictly parses the internal test schema. It deliberately has no arbitrary data field.
 */
export function parseSyntheticFlowAction(input: unknown): SyntheticFlowActionRequest {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new FailClosedError("malformed_flow_action", "Synthetic flow action must be an object.");
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new FailClosedError("malformed_flow_action", "Synthetic flow action must be a plain object.");
  }
  const value = input as Readonly<Record<string, unknown>>;
  assertExactActionKeys(value);

  if (value.schema !== SYNTHETIC_FLOW_ACTION_SCHEMA || value.version !== SYNTHETIC_FLOW_ACTION_VERSION) {
    throw new FailClosedError(
      "unsupported_flow_action_version",
      "Synthetic flow action schema or version is unsupported.",
    );
  }
  if (value.mode !== "demo" || value.source !== "internal_synthetic_test") {
    throw new FailClosedError("non_demo_flow_denied", "Only internal synthetic demo actions are accepted.");
  }

  assertBoundedString(value.tenantId, "tenantId", 63);
  assertSafeTenantId(value.tenantId);
  if (typeof value.purpose !== "string" || !PURPOSES.includes(value.purpose as SyntheticFlowPurpose)) {
    throw new FailClosedError("invalid_flow_purpose", "Synthetic flow purpose is unsupported.");
  }
  assertBoundedString(value.definitionId, "definitionId", 96);
  assertBoundedString(value.sessionId, "sessionId", 100);
  assertBoundedString(value.correlationId, "correlationId", 104);
  assertBoundedString(value.screen, "screen", 64);
  assertBoundedString(value.action, "action", 32);
  assertBoundedString(value.idempotencyKey, "idempotencyKey", 104);
  assertBoundedString(value.token, "token", 4_096);

  if (!SAFE_DEFINITION_ID.test(value.definitionId)) {
    throw new FailClosedError("invalid_flow_definition", "Synthetic flow definition ID is invalid.");
  }
  if (!SAFE_SESSION_ID.test(value.sessionId)) {
    throw new FailClosedError("invalid_flow_session", "Synthetic flow session ID is invalid.");
  }
  if (!SAFE_CORRELATION_ID.test(value.correlationId)) {
    throw new FailClosedError("invalid_flow_correlation", "Synthetic correlation ID is invalid.");
  }
  if (!SAFE_SCREEN_ID.test(value.screen)) {
    throw new FailClosedError("invalid_flow_screen", "Synthetic flow screen is invalid.");
  }
  if (!ACTIONS.includes(value.action as SyntheticFlowAction)) {
    throw new FailClosedError("invalid_flow_action", "Synthetic flow action is unsupported.");
  }
  if (!SAFE_IDEMPOTENCY_KEY.test(value.idempotencyKey)) {
    throw new FailClosedError("invalid_flow_idempotency", "Synthetic idempotency key is invalid.");
  }

  return {
    schema: SYNTHETIC_FLOW_ACTION_SCHEMA,
    version: SYNTHETIC_FLOW_ACTION_VERSION,
    mode: "demo",
    source: "internal_synthetic_test",
    tenantId: value.tenantId,
    purpose: value.purpose as SyntheticFlowPurpose,
    definitionId: value.definitionId,
    sessionId: value.sessionId,
    correlationId: value.correlationId,
    screen: value.screen,
    action: value.action as SyntheticFlowAction,
    idempotencyKey: value.idempotencyKey,
    token: value.token,
  };
}

/** Always fails closed: no live or Meta Flow data endpoint exists in this skeleton. */
export function rejectLiveMetaFlowEndpoint(_input?: unknown): never {
  throw new FailClosedError(
    "meta_flow_endpoint_not_implemented",
    "Live/Meta Flow endpoints and encrypted data exchange are intentionally not implemented.",
  );
}

/**
 * Processes one narrow internal demo action and returns pending confirmation metadata only.
 */
export function processSyntheticFlowAction(
  input: unknown,
  context: SyntheticFlowExecutionContext,
): PendingConfirmationResponse {
  if (context.transport === "meta") rejectLiveMetaFlowEndpoint(input);
  if (context.runtimeMode !== "demo") {
    throw new FailClosedError("non_demo_flow_denied", "Synthetic Flow actions cannot execute live.");
  }
  if (!(context.replayGuard instanceof InMemoryFlowReplayGuard)) {
    throw new FailClosedError(
      "invalid_replay_context",
      "An explicit in-memory demo replay guard is required.",
    );
  }

  const request = parseSyntheticFlowAction(input);
  assertSameTenant(context.expectedTenantId, request.tenantId);
  const now = context.now ?? new Date();
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new FailClosedError("invalid_flow_clock", "Synthetic execution clock is invalid.");
  }
  const claims = verifyDemoFlowSessionToken({
    token: request.token,
    syntheticSigningKey: context.syntheticSigningKey,
    expectedTenantId: request.tenantId,
    expectedPurpose: request.purpose,
    expectedDefinitionId: request.definitionId,
    expectedSessionId: request.sessionId,
    expectedCorrelationId: request.correlationId,
    now,
  });

  const definition = getSyntheticFlowDefinition(request.definitionId);
  if (definition.purpose !== request.purpose) {
    throw new FailClosedError(
      "flow_purpose_mismatch",
      "Flow definition purpose does not match the action.",
    );
  }
  if (definition.dataMode !== "endpoint_powered") {
    throw new FailClosedError(
      "static_flow_has_no_endpoint",
      "Static synthetic definitions do not have a data endpoint.",
    );
  }

  const screen = definition.screens.find((candidate) => candidate.id === request.screen);
  if (!screen) {
    throw new FailClosedError("invalid_flow_screen", "Screen is not part of this definition version.");
  }
  if (!screen.allowedActions.includes(request.action)) {
    throw new FailClosedError(
      "flow_action_screen_mismatch",
      "Action is not allowed from this definition screen.",
    );
  }
  if (request.screen !== "REVIEW" || request.action !== "submit_pending") {
    throw new FailClosedError(
      "flow_action_not_implemented",
      "Only the pending-confirmation demo transition is implemented.",
    );
  }

  const requestFingerprint = sha256Hex([
    request.schema,
    request.version,
    request.tenantId,
    request.purpose,
    request.definitionId,
    request.sessionId,
    request.correlationId,
    request.screen,
    request.action,
    request.idempotencyKey,
    request.token,
  ].join("|"));

  return context.replayGuard.execute(
    {
      tenantId: request.tenantId,
      sessionId: request.sessionId,
      action: request.action,
      idempotencyKey: request.idempotencyKey,
      requestFingerprint,
      expiresAt: claims.expiresAt,
      nowSeconds: Math.floor(nowMs / 1_000),
    },
    () => ({
      schema: SYNTHETIC_FLOW_RESPONSE_SCHEMA,
      version: SYNTHETIC_FLOW_RESPONSE_VERSION,
      mode: "demo",
      status: "pending_confirmation",
      nextScreen: "PENDING_CONFIRMATION",
      responseId: `synthetic-flow-response-${requestFingerprint.slice(0, 24)}`,
      tenantId: request.tenantId,
      purpose: request.purpose,
      definitionId: request.definitionId,
      sessionId: request.sessionId,
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
      tokenExpiresAt: new Date(claims.expiresAt * 1_000).toISOString(),
      transactionConfirmed: false,
      hemasWritePerformed: false,
      providerWritePerformed: false,
      persisted: false,
      networkCalls: 0,
      replayed: false,
      synthetic: true,
    }),
  );
}
