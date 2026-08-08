import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
  type Functions,
} from "firebase/functions";
import { z } from "zod";
import { getLocalEmulatorAuth } from "./auth-emulator";
import {
  evaluateLocalAuthPolicy,
  isExpectedSyntheticIdentity,
  type LocalAuthPolicyInput,
  type LocalAuthPolicyResult,
} from "./auth-policy";

export const LOCAL_APPOINTMENT_FUNCTIONS_ENDPOINT = Object.freeze({
  hostname: "127.0.0.1",
  port: 5001,
  region: "us-central1",
  callableName: "demoRequestSyntheticAppointment",
});

type LocalPolicyReason = Exclude<LocalAuthPolicyResult, { readonly allowed: true }>["reason"];

export type AppointmentFunctionsPolicyInput = LocalAuthPolicyInput & {
  readonly functionsHostname: string;
  readonly functionsPort: number;
  readonly functionsRegion: string;
  readonly callableName: string;
};

export type AppointmentFunctionsPolicyResult =
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

export function evaluateAppointmentFunctionsPolicy(
  input: AppointmentFunctionsPolicyInput,
): AppointmentFunctionsPolicyResult {
  const localPolicy = evaluateLocalAuthPolicy(input);
  if (!localPolicy.allowed) return localPolicy;
  if (input.functionsHostname !== LOCAL_APPOINTMENT_FUNCTIONS_ENDPOINT.hostname) {
    return { allowed: false, reason: "unexpected_functions_host" };
  }
  if (input.functionsPort !== LOCAL_APPOINTMENT_FUNCTIONS_ENDPOINT.port) {
    return { allowed: false, reason: "unexpected_functions_port" };
  }
  if (input.functionsRegion !== LOCAL_APPOINTMENT_FUNCTIONS_ENDPOINT.region) {
    return { allowed: false, reason: "unexpected_functions_region" };
  }
  if (input.callableName !== LOCAL_APPOINTMENT_FUNCTIONS_ENDPOINT.callableName) {
    return { allowed: false, reason: "unexpected_callable" };
  }
  return { allowed: true };
}

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const appointmentActionSchema = z.enum([
  "request_reschedule",
  "request_cancellation",
]);
const revisionSchema = z.number().int().min(0).max(999_999_999);

const appointmentFunctionsRequestSchema = z
  .object({
    workspaceId: identifierSchema,
    appointmentId: identifierSchema,
    teamId: identifierSchema,
    locationId: identifierSchema,
    action: appointmentActionSchema,
    expectedRevision: revisionSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

const appointmentFunctionsRequestIdentitySchema = appointmentFunctionsRequestSchema
  .omit({ idempotencyKey: true })
  .extend({ actorUid: identifierSchema })
  .strict();

const appointmentFunctionsResultSchema = z
  .object({
    appointmentId: identifierSchema,
    eventId: identifierSchema,
    action: appointmentActionSchema,
    status: z.enum(["reschedule_pending", "cancel_pending"]),
    syncState: z.literal("pending"),
    authoritativeSystem: z.literal("simulator"),
    revision: z.number().int().min(1).max(1_000_000_000),
    synthetic: z.literal(true),
    externalCalls: z.literal(0),
  })
  .strict();

const appointmentFunctionsResponseSchema = z
  .object({
    result: appointmentFunctionsResultSchema,
    auditEventId: identifierSchema,
    replayed: z.boolean(),
  })
  .strict();

export type AppointmentFunctionsRequest = z.infer<typeof appointmentFunctionsRequestSchema>;
export type AppointmentFunctionsRequestIdentity = z.infer<
  typeof appointmentFunctionsRequestIdentitySchema
>;
export type AppointmentFunctionsResponse = z.infer<typeof appointmentFunctionsResponseSchema>;

export type AppointmentFunctionsClientErrorCode =
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

export class AppointmentFunctionsClientError extends Error {
  constructor(
    message: string,
    readonly code: AppointmentFunctionsClientErrorCode,
    readonly sourceCode = "",
  ) {
    super(message);
    this.name = "AppointmentFunctionsClientError";
  }
}

function invalidRequest(): never {
  throw new AppointmentFunctionsClientError(
    "The synthetic appointment request failed strict client validation.",
    "invalid_request",
  );
}

function parseRequest(value: unknown): AppointmentFunctionsRequest {
  const result = appointmentFunctionsRequestSchema.safeParse(value);
  if (!result.success) invalidRequest();
  return result.data;
}

function parseIdentity(value: unknown): AppointmentFunctionsRequestIdentity {
  const result = appointmentFunctionsRequestIdentitySchema.safeParse(value);
  if (!result.success) invalidRequest();
  return result.data;
}

async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new AppointmentFunctionsClientError(
      "The browser cannot create the deterministic local request identity.",
      "unsafe_endpoint",
    );
  }
  try {
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    throw new AppointmentFunctionsClientError(
      "The browser cannot create the deterministic local request identity.",
      "unsafe_endpoint",
    );
  }
}

async function idempotencyKeyForIdentity(
  identity: AppointmentFunctionsRequestIdentity,
): Promise<string> {
  const canonicalIdentity = JSON.stringify([
    identity.workspaceId,
    identity.appointmentId,
    identity.teamId,
    identity.locationId,
    identity.actorUid,
    identity.action,
    identity.expectedRevision,
  ]);
  const digest = await sha256Hex(canonicalIdentity);
  return `appointment-ui-${digest.slice(0, 48)}`;
}

export async function buildAppointmentFunctionsRequest(
  value: unknown,
): Promise<AppointmentFunctionsRequest> {
  const identity = parseIdentity(value);
  return parseRequest({
    workspaceId: identity.workspaceId,
    appointmentId: identity.appointmentId,
    teamId: identity.teamId,
    locationId: identity.locationId,
    action: identity.action,
    expectedRevision: identity.expectedRevision,
    idempotencyKey: await idempotencyKeyForIdentity(identity),
  });
}

function expectedPendingStatus(
  action: AppointmentFunctionsRequest["action"],
): AppointmentFunctionsResponse["result"]["status"] {
  return action === "request_reschedule" ? "reschedule_pending" : "cancel_pending";
}

export function parseAppointmentFunctionsResponse(
  value: unknown,
  request: AppointmentFunctionsRequest,
): AppointmentFunctionsResponse {
  const validatedRequest = parseRequest(request);
  const result = appointmentFunctionsResponseSchema.safeParse(value);
  if (
    !result.success ||
    result.data.result.appointmentId !== validatedRequest.appointmentId ||
    result.data.result.action !== validatedRequest.action ||
    result.data.result.status !== expectedPendingStatus(validatedRequest.action) ||
    result.data.result.revision !== validatedRequest.expectedRevision + 1
  ) {
    throw new AppointmentFunctionsClientError(
      "The local Functions callable returned invalid appointment evidence.",
      "invalid_response",
    );
  }
  return result.data;
}

function normalizedCallableCode(error: unknown): string {
  const sourceCode =
    typeof error === "object" && error && "code" in error ? String(error.code) : "";
  return sourceCode.trim().toLowerCase().replace(/^functions\//, "");
}

export function mapAppointmentFunctionsCallableError(
  error: unknown,
): AppointmentFunctionsClientError {
  if (error instanceof AppointmentFunctionsClientError) return error;
  const sourceCode = normalizedCallableCode(error);
  if (sourceCode === "aborted") {
    return new AppointmentFunctionsClientError(
      "The simulator appointment changed before the audited transaction committed.",
      "revision_conflict",
      sourceCode,
    );
  }
  if (sourceCode === "already-exists") {
    return new AppointmentFunctionsClientError(
      "The deterministic request identity is bound to different durable evidence.",
      "idempotency_conflict",
      sourceCode,
    );
  }
  if (sourceCode === "unauthenticated") {
    return new AppointmentFunctionsClientError(
      "A verified local Firebase Auth session is required.",
      "authentication_required",
      sourceCode,
    );
  }
  if (sourceCode === "permission-denied") {
    return new AppointmentFunctionsClientError(
      "The verified workspace member cannot request this appointment transition.",
      "permission_denied",
      sourceCode,
    );
  }
  if (sourceCode === "failed-precondition") {
    return new AppointmentFunctionsClientError(
      "The audited synthetic appointment service refused this request.",
      "service_denied",
      sourceCode,
    );
  }
  if (sourceCode === "invalid-argument") {
    return new AppointmentFunctionsClientError(
      "The audited synthetic appointment service rejected the request schema.",
      "invalid_request",
      sourceCode,
    );
  }
  if (sourceCode === "unavailable" || sourceCode === "deadline-exceeded") {
    return new AppointmentFunctionsClientError(
      "The local Functions emulator is unavailable.",
      "emulator_unavailable",
      sourceCode,
    );
  }
  return new AppointmentFunctionsClientError(
    "The audited local Functions invocation failed safely.",
    "invocation_failed",
    sourceCode,
  );
}

function browserPolicy(): AppointmentFunctionsPolicyResult {
  if (typeof window === "undefined") {
    return { allowed: false, reason: "non_loopback_host" };
  }
  return evaluateAppointmentFunctionsPolicy({
    hostname: window.location.hostname,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appStage: process.env.NEXT_PUBLIC_APP_STAGE,
    useFirebaseEmulators: process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS,
    externalMessagingEnabled: process.env.NEXT_PUBLIC_EXTERNAL_MESSAGING_ENABLED,
    realPatientDataEnabled: process.env.NEXT_PUBLIC_REAL_PATIENT_DATA_ENABLED,
    functionsHostname: LOCAL_APPOINTMENT_FUNCTIONS_ENDPOINT.hostname,
    functionsPort: LOCAL_APPOINTMENT_FUNCTIONS_ENDPOINT.port,
    functionsRegion: LOCAL_APPOINTMENT_FUNCTIONS_ENDPOINT.region,
    callableName: LOCAL_APPOINTMENT_FUNCTIONS_ENDPOINT.callableName,
  });
}

declare global {
  var __hemasLocalAppointmentFunctions: Functions | undefined;
}

function getLocalAppointmentFunctions(actorUid: string): Functions {
  const policy = browserPolicy();
  if (!policy.allowed) {
    throw new AppointmentFunctionsClientError(
      `The local Functions endpoint refused unsafe configuration: ${policy.reason}.`,
      "unsafe_endpoint",
    );
  }

  const auth = getLocalEmulatorAuth();
  const user = auth.currentUser;
  if (
    !user ||
    user.uid !== actorUid ||
    !isExpectedSyntheticIdentity(user.email)
  ) {
    throw new AppointmentFunctionsClientError(
      "The active Firebase Auth identity does not match the verified workspace session.",
      "identity_mismatch",
    );
  }
  if (globalThis.__hemasLocalAppointmentFunctions) {
    return globalThis.__hemasLocalAppointmentFunctions;
  }

  const functions = getFunctions(auth.app, LOCAL_APPOINTMENT_FUNCTIONS_ENDPOINT.region);
  // This is deliberately unconditional after both local policy and identity
  // verification. This dedicated app has no callable path to cloud Functions.
  connectFunctionsEmulator(
    functions,
    LOCAL_APPOINTMENT_FUNCTIONS_ENDPOINT.hostname,
    LOCAL_APPOINTMENT_FUNCTIONS_ENDPOINT.port,
  );
  globalThis.__hemasLocalAppointmentFunctions = functions;
  return functions;
}

export type AppointmentFunctionsInvoker = (input: {
  readonly actorUid: string;
  readonly request: AppointmentFunctionsRequest;
}) => Promise<unknown>;

const invokeLocalAppointmentCallable: AppointmentFunctionsInvoker = async (input) => {
  const functions = getLocalAppointmentFunctions(input.actorUid);
  const callable = httpsCallable<AppointmentFunctionsRequest, unknown>(
    functions,
    LOCAL_APPOINTMENT_FUNCTIONS_ENDPOINT.callableName,
    { timeout: 10_000 },
  );
  return (await callable(input.request)).data;
};

export async function requestSyntheticAppointmentThroughLocalFunctions(
  input: {
    readonly actorUid: string;
    readonly request: unknown;
  },
  invoke: AppointmentFunctionsInvoker = invokeLocalAppointmentCallable,
): Promise<AppointmentFunctionsResponse> {
  const request = parseRequest(input.request);
  const identity = parseIdentity({
    workspaceId: request.workspaceId,
    appointmentId: request.appointmentId,
    teamId: request.teamId,
    locationId: request.locationId,
    actorUid: input.actorUid,
    action: request.action,
    expectedRevision: request.expectedRevision,
  });
  if (request.idempotencyKey !== (await idempotencyKeyForIdentity(identity))) {
    invalidRequest();
  }

  let rawResponse: unknown;
  try {
    rawResponse = await invoke({ actorUid: identity.actorUid, request });
  } catch (error) {
    throw mapAppointmentFunctionsCallableError(error);
  }
  return parseAppointmentFunctionsResponse(rawResponse, request);
}
