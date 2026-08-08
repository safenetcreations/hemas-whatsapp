import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
  type Functions,
} from "firebase/functions";
import { z } from "zod";

import {
  AUTOMATION_EXECUTION_STATES,
  AUTOMATION_RUN_ACTIONS,
  CARE_ENROLLMENT_ACTIONS,
  CARE_ENROLLMENT_STATES,
  CARE_PATHWAY_SUPPRESSIONS,
} from "@/lib/domain/automations";
import { getLocalEmulatorAuth } from "./auth-emulator";
import { currentCloudDemoRuntime } from "./runtime-mode";
import {
  evaluateLocalAuthPolicy,
  isExpectedSyntheticIdentity,
  type LocalAuthPolicyInput,
  type LocalAuthPolicyResult,
} from "./auth-policy";

const LOCAL_PHASE5_FUNCTIONS_ENDPOINT = Object.freeze({
  hostname: "127.0.0.1",
  port: 5001,
  region: "us-central1",
});

export const LOCAL_AUTOMATION_FUNCTIONS_ENDPOINT = Object.freeze({
  ...LOCAL_PHASE5_FUNCTIONS_ENDPOINT,
  callableName: "demoControlSyntheticAutomationRun",
});

export const LOCAL_CARE_FUNCTIONS_ENDPOINT = Object.freeze({
  ...LOCAL_PHASE5_FUNCTIONS_ENDPOINT,
  callableName: "demoControlSyntheticCareEnrollment",
});

type LocalPolicyReason = Exclude<
  LocalAuthPolicyResult,
  { readonly allowed: true }
>["reason"];

export type Phase5FunctionsPolicyInput = LocalAuthPolicyInput & {
  readonly functionsHostname: string;
  readonly functionsPort: number;
  readonly functionsRegion: string;
  readonly callableName: string;
};

export type Phase5FunctionsPolicyResult =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason:
        | LocalPolicyReason
        | "unexpected_functions_host"
        | "unexpected_functions_port"
        | "unexpected_functions_region"
        | "unexpected_callable";
    };

const allowedCallables = new Set<string>([
  LOCAL_AUTOMATION_FUNCTIONS_ENDPOINT.callableName,
  LOCAL_CARE_FUNCTIONS_ENDPOINT.callableName,
]);

export function evaluatePhase5FunctionsPolicy(
  input: Phase5FunctionsPolicyInput,
): Phase5FunctionsPolicyResult {
  const localPolicy = evaluateLocalAuthPolicy(input);
  if (!localPolicy.allowed) return localPolicy;
  if (input.functionsHostname !== LOCAL_PHASE5_FUNCTIONS_ENDPOINT.hostname) {
    return { allowed: false, reason: "unexpected_functions_host" };
  }
  if (input.functionsPort !== LOCAL_PHASE5_FUNCTIONS_ENDPOINT.port) {
    return { allowed: false, reason: "unexpected_functions_port" };
  }
  if (input.functionsRegion !== LOCAL_PHASE5_FUNCTIONS_ENDPOINT.region) {
    return { allowed: false, reason: "unexpected_functions_region" };
  }
  if (!allowedCallables.has(input.callableName)) {
    return { allowed: false, reason: "unexpected_callable" };
  }
  return { allowed: true };
}

const identifier = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const idempotencyKey = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const revision = z.number().int().min(1).max(999_999);
const canonicalIsoDateTime = z.string().refine((value) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
});
const nullableCanonicalIsoDateTime = canonicalIsoDateTime.nullable();
const nullableIdentifier = identifier.nullable();
const automationAction = z.enum(AUTOMATION_RUN_ACTIONS);
const careAction = z.enum(CARE_ENROLLMENT_ACTIONS);
const careSuppression = z.enum(CARE_PATHWAY_SUPPRESSIONS);

const automationRequestSchema = z
  .object({
    workspaceId: identifier,
    runId: identifier,
    action: automationAction,
    expectedRevision: revision,
    idempotencyKey,
  })
  .strict();
const automationRequestIdentitySchema = automationRequestSchema
  .omit({ idempotencyKey: true })
  .extend({ actorUid: identifier })
  .strict();
const automationResultSchema = z
  .object({
    runId: identifier,
    eventId: identifier,
    action: automationAction,
    state: z.enum(AUTOMATION_EXECUTION_STATES),
    revision: z.number().int().min(2).max(999_999),
    currentStepIndex: z.number().int().min(0).max(32),
    completedStepCount: z.number().int().min(0).max(32),
    attemptCount: z.number().int().min(0).max(11),
    nextEligibleAt: nullableCanonicalIsoDateTime,
    openWorkItemId: nullableIdentifier,
    outcomeCode: z.enum([
      "accepted",
      "step_completed",
      "wait_scheduled",
      "human_takeover_required",
      "fallback_work_item_created",
      "fallback_stopped_safely",
      "retry_scheduled",
      "completed",
      "ended_by_operator",
      "synthetic_failure",
    ]),
    synthetic: z.literal(true),
    externalDispatchCount: z.literal(0),
    networkCallCount: z.literal(0),
  })
  .strict();
const automationResponseSchema = z
  .object({
    result: automationResultSchema,
    auditEventId: identifier,
    replayed: z.boolean(),
  })
  .strict();

const careRequestSchema = z
  .object({
    workspaceId: identifier,
    enrollmentId: identifier,
    action: careAction,
    expectedRevision: revision,
    suppressionReason: careSuppression.nullable(),
    idempotencyKey,
  })
  .strict()
  .superRefine((value, context) => {
    const requiresSuppression = value.action === "simulate_suppression";
    if (requiresSuppression !== (value.suppressionReason !== null)) {
      context.addIssue({
        code: "custom",
        path: ["suppressionReason"],
        message: "Suppression evidence must be present only for simulate_suppression.",
      });
    }
  });
const careRequestIdentitySchema = z
  .object({
    workspaceId: identifier,
    enrollmentId: identifier,
    action: careAction,
    expectedRevision: revision,
    suppressionReason: careSuppression.nullable(),
    actorUid: identifier,
  })
  .strict()
  .superRefine((value, context) => {
    const requiresSuppression = value.action === "simulate_suppression";
    if (requiresSuppression !== (value.suppressionReason !== null)) {
      context.addIssue({
        code: "custom",
        path: ["suppressionReason"],
        message: "Suppression evidence must be present only for simulate_suppression.",
      });
    }
  });
const careResultSchema = z
  .object({
    enrollmentId: identifier,
    eventId: identifier,
    action: careAction,
    state: z.enum(CARE_ENROLLMENT_STATES),
    revision: z.number().int().min(2).max(999_999),
    nextContactIndex: z.number().int().min(0).max(32),
    nextContactAt: nullableCanonicalIsoDateTime,
    openEscalationId: nullableIdentifier,
    safetyHoldEscalationId: nullableIdentifier,
    openHandoffId: nullableIdentifier,
    outcomeCode: z.enum([
      "accepted",
      "contact_advanced",
      "suppressed_terminal",
      "clinical_hold_applied",
      "human_takeover_required",
      "red_flag_escalated",
      "escalation_acknowledged",
      "escalation_resolved_safety_hold",
      "escalation_resolved_terminal_suppression",
      "safety_hold_cleared",
      "completed",
      "ended_by_operator",
    ]),
    synthetic: z.literal(true),
    externalDispatchCount: z.literal(0),
    networkCallCount: z.literal(0),
  })
  .strict();
const careResponseSchema = z
  .object({
    result: careResultSchema,
    auditEventId: identifier,
    replayed: z.boolean(),
  })
  .strict();

export type AutomationFunctionsRequest = z.infer<typeof automationRequestSchema>;
export type AutomationFunctionsRequestIdentity = z.infer<
  typeof automationRequestIdentitySchema
>;
export type AutomationFunctionsResponse = z.infer<typeof automationResponseSchema>;
export type CareFunctionsRequest = z.infer<typeof careRequestSchema>;
export type CareFunctionsRequestIdentity = z.infer<typeof careRequestIdentitySchema>;
export type CareFunctionsResponse = z.infer<typeof careResponseSchema>;

export type Phase5FunctionsClientErrorCode =
  | "invalid_request"
  | "invalid_response"
  | "unsafe_endpoint"
  | "identity_mismatch"
  | "revision_conflict"
  | "idempotency_conflict"
  | "authentication_required"
  | "permission_denied"
  | "service_denied"
  | "emulator_unavailable"
  | "invocation_failed";

export class Phase5FunctionsClientError extends Error {
  constructor(
    message: string,
    readonly code: Phase5FunctionsClientErrorCode,
    readonly sourceCode = "",
  ) {
    super(message);
    this.name = "Phase5FunctionsClientError";
  }
}

function invalidRequest(label: string): never {
  throw new Phase5FunctionsClientError(
    `The synthetic ${label} request failed strict client validation.`,
    "invalid_request",
  );
}

async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Phase5FunctionsClientError(
      "The browser cannot create deterministic Phase 5 evidence.",
      "unsafe_endpoint",
    );
  }
  try {
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    throw new Phase5FunctionsClientError(
      "The browser cannot create deterministic Phase 5 evidence.",
      "unsafe_endpoint",
    );
  }
}

async function deterministicKey(
  prefix: "automation" | "care",
  identity: readonly unknown[],
): Promise<string> {
  return `phase5-${prefix}-ui-${(await sha256Hex(JSON.stringify(identity))).slice(0, 44)}`;
}

export async function buildAutomationFunctionsRequest(
  value: unknown,
): Promise<AutomationFunctionsRequest> {
  const identity = automationRequestIdentitySchema.safeParse(value);
  if (!identity.success) invalidRequest("automation");
  const parsed = identity.data;
  return automationRequestSchema.parse({
    workspaceId: parsed.workspaceId,
    runId: parsed.runId,
    action: parsed.action,
    expectedRevision: parsed.expectedRevision,
    idempotencyKey: await deterministicKey("automation", [
      parsed.workspaceId,
      parsed.runId,
      parsed.actorUid,
      parsed.action,
      parsed.expectedRevision,
    ]),
  });
}

export async function buildCareFunctionsRequest(
  value: unknown,
): Promise<CareFunctionsRequest> {
  const identity = careRequestIdentitySchema.safeParse(value);
  if (!identity.success) invalidRequest("care enrollment");
  const parsed = identity.data;
  return careRequestSchema.parse({
    workspaceId: parsed.workspaceId,
    enrollmentId: parsed.enrollmentId,
    action: parsed.action,
    expectedRevision: parsed.expectedRevision,
    suppressionReason: parsed.suppressionReason,
    idempotencyKey: await deterministicKey("care", [
      parsed.workspaceId,
      parsed.enrollmentId,
      parsed.actorUid,
      parsed.action,
      parsed.expectedRevision,
      parsed.suppressionReason,
    ]),
  });
}

export function parseAutomationFunctionsResponse(
  value: unknown,
  requestValue: AutomationFunctionsRequest,
): AutomationFunctionsResponse {
  const request = automationRequestSchema.safeParse(requestValue);
  const response = automationResponseSchema.safeParse(value);
  if (
    !request.success ||
    !response.success ||
    response.data.result.runId !== request.data.runId ||
    response.data.result.action !== request.data.action ||
    response.data.result.revision !== request.data.expectedRevision + 1
  ) {
    throw new Phase5FunctionsClientError(
      "The localhost callable returned invalid automation evidence.",
      "invalid_response",
    );
  }
  return response.data;
}

export function parseCareFunctionsResponse(
  value: unknown,
  requestValue: CareFunctionsRequest,
): CareFunctionsResponse {
  const request = careRequestSchema.safeParse(requestValue);
  const response = careResponseSchema.safeParse(value);
  if (
    !request.success ||
    !response.success ||
    response.data.result.enrollmentId !== request.data.enrollmentId ||
    response.data.result.action !== request.data.action ||
    response.data.result.revision !== request.data.expectedRevision + 1
  ) {
    throw new Phase5FunctionsClientError(
      "The localhost callable returned invalid care evidence.",
      "invalid_response",
    );
  }
  return response.data;
}

export function serializeAutomationControlResult(
  value: AutomationFunctionsResponse["result"],
): string {
  const result = automationResultSchema.parse(value);
  return JSON.stringify([
    "hemas-connect:automation-control-result:v1",
    result.runId,
    result.eventId,
    result.action,
    result.state,
    result.revision,
    result.currentStepIndex,
    result.completedStepCount,
    result.attemptCount,
    result.nextEligibleAt,
    result.openWorkItemId,
    result.outcomeCode,
    true,
    0,
    0,
  ]);
}

export function serializeCareControlResult(
  value: CareFunctionsResponse["result"],
): string {
  const result = careResultSchema.parse(value);
  return JSON.stringify([
    "hemas-connect:care-control-result:v1",
    result.enrollmentId,
    result.eventId,
    result.action,
    result.state,
    result.revision,
    result.nextContactIndex,
    result.nextContactAt,
    result.openEscalationId,
    result.safetyHoldEscalationId,
    result.openHandoffId,
    result.outcomeCode,
    true,
    0,
    0,
  ]);
}

export async function automationControlResultFingerprint(
  value: AutomationFunctionsResponse["result"],
): Promise<string> {
  return sha256Hex(serializeAutomationControlResult(value));
}

export async function careControlResultFingerprint(
  value: CareFunctionsResponse["result"],
): Promise<string> {
  return sha256Hex(serializeCareControlResult(value));
}

function normalizedCallableCode(error: unknown): string {
  const sourceCode =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  return sourceCode.trim().toLowerCase().replace(/^functions\//, "");
}

export function mapPhase5CallableError(error: unknown): Phase5FunctionsClientError {
  if (error instanceof Phase5FunctionsClientError) return error;
  const sourceCode = normalizedCallableCode(error);
  if (sourceCode === "aborted") {
    return new Phase5FunctionsClientError(
      "Authoritative Phase 5 state changed before the transaction committed.",
      "revision_conflict",
      sourceCode,
    );
  }
  if (sourceCode === "already-exists") {
    return new Phase5FunctionsClientError(
      "The deterministic request identity is bound to different durable evidence.",
      "idempotency_conflict",
      sourceCode,
    );
  }
  if (sourceCode === "unauthenticated") {
    return new Phase5FunctionsClientError(
      "A verified local Firebase Auth session is required.",
      "authentication_required",
      sourceCode,
    );
  }
  if (sourceCode === "permission-denied") {
    return new Phase5FunctionsClientError(
      "The verified member cannot perform this governed action.",
      "permission_denied",
      sourceCode,
    );
  }
  if (sourceCode === "failed-precondition") {
    return new Phase5FunctionsClientError(
      "The governed service refused this transition in the current state.",
      "service_denied",
      sourceCode,
    );
  }
  if (sourceCode === "invalid-argument") {
    return new Phase5FunctionsClientError(
      "The governed service rejected the strict request contract.",
      "invalid_request",
      sourceCode,
    );
  }
  if (sourceCode === "unavailable" || sourceCode === "deadline-exceeded") {
    return new Phase5FunctionsClientError(
      "The local Functions emulator is unavailable.",
      "emulator_unavailable",
      sourceCode,
    );
  }
  return new Phase5FunctionsClientError(
    "The audited localhost invocation failed closed.",
    "invocation_failed",
    sourceCode,
  );
}

function browserPolicy(callableName: string): Phase5FunctionsPolicyResult {
  if (typeof window === "undefined") {
    return { allowed: false, reason: "non_loopback_host" };
  }
  return evaluatePhase5FunctionsPolicy({
    hostname: window.location.hostname,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appStage: process.env.NEXT_PUBLIC_APP_STAGE,
    useFirebaseEmulators: process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS,
    externalMessagingEnabled: process.env.NEXT_PUBLIC_EXTERNAL_MESSAGING_ENABLED,
    realPatientDataEnabled: process.env.NEXT_PUBLIC_REAL_PATIENT_DATA_ENABLED,
    functionsHostname: LOCAL_PHASE5_FUNCTIONS_ENDPOINT.hostname,
    functionsPort: LOCAL_PHASE5_FUNCTIONS_ENDPOINT.port,
    functionsRegion: LOCAL_PHASE5_FUNCTIONS_ENDPOINT.region,
    callableName,
  });
}

declare global {
  var __hemasLocalPhase5Functions: Functions | undefined;
}

function getLocalPhase5Functions(actorUid: string, callableName: string): Functions {
  const cloudRuntime = currentCloudDemoRuntime();
  if (cloudRuntime.refused) {
    throw new Phase5FunctionsClientError(
      `The Functions endpoint refused unsafe cloud configuration: ${cloudRuntime.reason}.`,
      "unsafe_endpoint",
    );
  }
  if (!cloudRuntime.active) {
    const policy = browserPolicy(callableName);
    if (!policy.allowed) {
      throw new Phase5FunctionsClientError(
        `The localhost Functions endpoint refused unsafe configuration: ${policy.reason}.`,
        "unsafe_endpoint",
      );
    }
  }
  const auth = getLocalEmulatorAuth();
  const user = auth.currentUser;
  if (!user || user.uid !== actorUid || !isExpectedSyntheticIdentity(user.email)) {
    throw new Phase5FunctionsClientError(
      "The active Firebase Auth identity does not match workspace authority.",
      "identity_mismatch",
    );
  }
  if (globalThis.__hemasLocalPhase5Functions) {
    return globalThis.__hemasLocalPhase5Functions;
  }
  const functions = getFunctions(auth.app, LOCAL_PHASE5_FUNCTIONS_ENDPOINT.region);
  if (!cloudRuntime.active) {
    connectFunctionsEmulator(
      functions,
      LOCAL_PHASE5_FUNCTIONS_ENDPOINT.hostname,
      LOCAL_PHASE5_FUNCTIONS_ENDPOINT.port,
    );
  }
  globalThis.__hemasLocalPhase5Functions = functions;
  return functions;
}

export type AutomationFunctionsInvoker = (input: {
  readonly actorUid: string;
  readonly request: AutomationFunctionsRequest;
}) => Promise<unknown>;
export type CareFunctionsInvoker = (input: {
  readonly actorUid: string;
  readonly request: CareFunctionsRequest;
}) => Promise<unknown>;

const invokeAutomation: AutomationFunctionsInvoker = async (input) => {
  const functions = getLocalPhase5Functions(
    input.actorUid,
    LOCAL_AUTOMATION_FUNCTIONS_ENDPOINT.callableName,
  );
  const callable = httpsCallable<AutomationFunctionsRequest, unknown>(
    functions,
    LOCAL_AUTOMATION_FUNCTIONS_ENDPOINT.callableName,
    { timeout: 15_000 },
  );
  return (await callable(input.request)).data;
};

const invokeCare: CareFunctionsInvoker = async (input) => {
  const functions = getLocalPhase5Functions(
    input.actorUid,
    LOCAL_CARE_FUNCTIONS_ENDPOINT.callableName,
  );
  const callable = httpsCallable<CareFunctionsRequest, unknown>(
    functions,
    LOCAL_CARE_FUNCTIONS_ENDPOINT.callableName,
    { timeout: 15_000 },
  );
  return (await callable(input.request)).data;
};

export async function controlSyntheticAutomationThroughLocalFunctions(
  input: { readonly actorUid: string; readonly request: unknown },
  invoke: AutomationFunctionsInvoker = invokeAutomation,
): Promise<AutomationFunctionsResponse> {
  const request = automationRequestSchema.safeParse(input.request);
  if (!request.success) invalidRequest("automation");
  const expected = await buildAutomationFunctionsRequest({
    workspaceId: request.data.workspaceId,
    runId: request.data.runId,
    actorUid: input.actorUid,
    action: request.data.action,
    expectedRevision: request.data.expectedRevision,
  });
  if (request.data.idempotencyKey !== expected.idempotencyKey) {
    invalidRequest("automation");
  }
  try {
    return parseAutomationFunctionsResponse(
      await invoke({ actorUid: input.actorUid, request: request.data }),
      request.data,
    );
  } catch (error) {
    throw mapPhase5CallableError(error);
  }
}

export async function controlSyntheticCareThroughLocalFunctions(
  input: { readonly actorUid: string; readonly request: unknown },
  invoke: CareFunctionsInvoker = invokeCare,
): Promise<CareFunctionsResponse> {
  const request = careRequestSchema.safeParse(input.request);
  if (!request.success) invalidRequest("care enrollment");
  const expected = await buildCareFunctionsRequest({
    workspaceId: request.data.workspaceId,
    enrollmentId: request.data.enrollmentId,
    actorUid: input.actorUid,
    action: request.data.action,
    expectedRevision: request.data.expectedRevision,
    suppressionReason: request.data.suppressionReason,
  });
  if (request.data.idempotencyKey !== expected.idempotencyKey) {
    invalidRequest("care enrollment");
  }
  try {
    return parseCareFunctionsResponse(
      await invoke({ actorUid: input.actorUid, request: request.data }),
      request.data,
    );
  } catch (error) {
    throw mapPhase5CallableError(error);
  }
}
