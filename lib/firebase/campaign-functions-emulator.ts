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

export const LOCAL_CAMPAIGN_FUNCTIONS_ENDPOINT = Object.freeze({
  hostname: "127.0.0.1",
  port: 5001,
  region: "us-central1",
  callableName: "demoControlSyntheticCampaign",
});

type LocalPolicyReason = Exclude<
  LocalAuthPolicyResult,
  { readonly allowed: true }
>["reason"];

export type CampaignFunctionsPolicyInput = LocalAuthPolicyInput & {
  readonly functionsHostname: string;
  readonly functionsPort: number;
  readonly functionsRegion: string;
  readonly callableName: string;
};

export type CampaignFunctionsPolicyResult =
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

export function evaluateCampaignFunctionsPolicy(
  input: CampaignFunctionsPolicyInput,
): CampaignFunctionsPolicyResult {
  const localPolicy = evaluateLocalAuthPolicy(input);
  if (!localPolicy.allowed) return localPolicy;
  if (input.functionsHostname !== LOCAL_CAMPAIGN_FUNCTIONS_ENDPOINT.hostname) {
    return { allowed: false, reason: "unexpected_functions_host" };
  }
  if (input.functionsPort !== LOCAL_CAMPAIGN_FUNCTIONS_ENDPOINT.port) {
    return { allowed: false, reason: "unexpected_functions_port" };
  }
  if (input.functionsRegion !== LOCAL_CAMPAIGN_FUNCTIONS_ENDPOINT.region) {
    return { allowed: false, reason: "unexpected_functions_region" };
  }
  if (input.callableName !== LOCAL_CAMPAIGN_FUNCTIONS_ENDPOINT.callableName) {
    return { allowed: false, reason: "unexpected_callable" };
  }
  return { allowed: true };
}

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const idempotencyKey = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const action = z.enum([
  "run_canary",
  "start",
  "advance_batch",
  "pause",
  "resume",
  "inject_fault",
  "retry",
  "cancel",
]);
const revision = z.number().int().min(0).max(999_999_999);

const requestSchema = z
  .object({
    workspaceId: identifier,
    campaignId: identifier,
    action,
    expectedRevision: revision,
    idempotencyKey,
  })
  .strict();

const requestIdentitySchema = requestSchema
  .omit({ idempotencyKey: true })
  .extend({ actorUid: identifier })
  .strict();

const resultSchema = z
  .object({
    campaignId: identifier,
    eventId: identifier,
    checkpointId: identifier.nullable(),
    action,
    state: z.enum([
      "scheduled",
      "dispatching",
      "paused",
      "completed",
      "cancelled",
      "failed",
    ]),
    revision: z.number().int().min(1).max(1_000_000_000),
    canaryStatus: z.enum(["not_run", "passed_simulation", "failed"]),
    processedEligible: z.number().int().min(0).max(50_000),
    scanOffset: z.number().int().min(0).max(50_000),
    nextBatchIndex: z.number().int().min(0).max(39),
    batchEligibleCount: z.number().int().min(0).max(1_000),
    synthetic: z.literal(true),
    externalCalls: z.literal(0),
    networkCalls: z.literal(0),
  })
  .strict();

const responseSchema = z
  .object({
    result: resultSchema,
    auditEventId: identifier,
    replayed: z.boolean(),
  })
  .strict();

export type CampaignFunctionsAction = z.infer<typeof action>;
export type CampaignFunctionsRequest = z.infer<typeof requestSchema>;
export type CampaignFunctionsRequestIdentity = z.infer<
  typeof requestIdentitySchema
>;
export type CampaignFunctionsResponse = z.infer<typeof responseSchema>;

export type CampaignFunctionsClientErrorCode =
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

export class CampaignFunctionsClientError extends Error {
  constructor(
    message: string,
    readonly code: CampaignFunctionsClientErrorCode,
    readonly sourceCode = "",
  ) {
    super(message);
    this.name = "CampaignFunctionsClientError";
  }
}

function invalidRequest(): never {
  throw new CampaignFunctionsClientError(
    "The synthetic campaign request failed strict client validation.",
    "invalid_request",
  );
}

function parseRequest(value: unknown): CampaignFunctionsRequest {
  const result = requestSchema.safeParse(value);
  if (!result.success) invalidRequest();
  return result.data;
}

function parseIdentity(value: unknown): CampaignFunctionsRequestIdentity {
  const result = requestIdentitySchema.safeParse(value);
  if (!result.success) invalidRequest();
  return result.data;
}

async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new CampaignFunctionsClientError(
      "The browser cannot create the deterministic campaign request identity.",
      "unsafe_endpoint",
    );
  }
  try {
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    throw new CampaignFunctionsClientError(
      "The browser cannot create the deterministic campaign request identity.",
      "unsafe_endpoint",
    );
  }
}

async function keyForIdentity(
  identity: CampaignFunctionsRequestIdentity,
): Promise<string> {
  const canonical = JSON.stringify([
    identity.workspaceId,
    identity.campaignId,
    identity.actorUid,
    identity.action,
    identity.expectedRevision,
  ]);
  return `campaign-ui-${(await sha256Hex(canonical)).slice(0, 48)}`;
}

export async function buildCampaignFunctionsRequest(
  value: unknown,
): Promise<CampaignFunctionsRequest> {
  const identity = parseIdentity(value);
  return parseRequest({
    workspaceId: identity.workspaceId,
    campaignId: identity.campaignId,
    action: identity.action,
    expectedRevision: identity.expectedRevision,
    idempotencyKey: await keyForIdentity(identity),
  });
}

function responseMatchesAction(
  result: CampaignFunctionsResponse["result"],
): boolean {
  switch (result.action) {
    case "run_canary":
      return (
        result.state === "scheduled" &&
        result.canaryStatus === "passed_simulation" &&
        result.checkpointId === null &&
        result.batchEligibleCount === 25
      );
    case "start":
      return (
        result.state === "dispatching" &&
        result.canaryStatus === "passed_simulation" &&
        result.checkpointId === null &&
        result.batchEligibleCount === 0
      );
    case "advance_batch":
      return (
        (result.state === "dispatching" || result.state === "completed") &&
        result.canaryStatus === "passed_simulation" &&
        result.checkpointId !== null &&
        result.batchEligibleCount >= 1
      );
    case "pause":
      return (
        result.state === "paused" &&
        result.canaryStatus === "passed_simulation" &&
        result.checkpointId === null &&
        result.batchEligibleCount === 0
      );
    case "resume":
      return (
        result.state === "dispatching" &&
        result.canaryStatus === "passed_simulation" &&
        result.checkpointId === null &&
        result.batchEligibleCount === 0
      );
    case "inject_fault":
      return result.state === "failed" && result.canaryStatus === "failed" && result.checkpointId === null && result.batchEligibleCount === 0;
    case "retry":
      return (
        result.state === "dispatching" &&
        result.canaryStatus === "passed_simulation" &&
        result.checkpointId === null &&
        result.batchEligibleCount === 0
      );
    case "cancel":
      return (
        result.state === "cancelled" &&
        result.checkpointId === null &&
        result.batchEligibleCount === 0
      );
  }
}

export function parseCampaignFunctionsResponse(
  value: unknown,
  requestValue: CampaignFunctionsRequest,
): CampaignFunctionsResponse {
  const request = parseRequest(requestValue);
  const parsed = responseSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.result.campaignId !== request.campaignId ||
    parsed.data.result.action !== request.action ||
    parsed.data.result.revision !== request.expectedRevision + 1 ||
    !responseMatchesAction(parsed.data.result)
  ) {
    throw new CampaignFunctionsClientError(
      "The local Functions callable returned invalid campaign evidence.",
      "invalid_response",
    );
  }
  return parsed.data;
}

function normalizedCallableCode(error: unknown): string {
  const sourceCode =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  return sourceCode.trim().toLowerCase().replace(/^functions\//, "");
}

export function mapCampaignFunctionsCallableError(
  error: unknown,
): CampaignFunctionsClientError {
  if (error instanceof CampaignFunctionsClientError) return error;
  const sourceCode = normalizedCallableCode(error);
  if (sourceCode === "aborted") {
    return new CampaignFunctionsClientError(
      "The synthetic campaign changed before the audited transaction committed.",
      "revision_conflict",
      sourceCode,
    );
  }
  if (sourceCode === "already-exists") {
    return new CampaignFunctionsClientError(
      "The deterministic campaign request identity is bound to different evidence.",
      "idempotency_conflict",
      sourceCode,
    );
  }
  if (sourceCode === "unauthenticated") {
    return new CampaignFunctionsClientError(
      "A verified local Firebase Auth session is required.",
      "authentication_required",
      sourceCode,
    );
  }
  if (sourceCode === "permission-denied") {
    return new CampaignFunctionsClientError(
      "The verified workspace member cannot control this synthetic campaign.",
      "permission_denied",
      sourceCode,
    );
  }
  if (sourceCode === "failed-precondition") {
    return new CampaignFunctionsClientError(
      "The audited synthetic campaign service refused this transition.",
      "service_denied",
      sourceCode,
    );
  }
  if (sourceCode === "invalid-argument") {
    return new CampaignFunctionsClientError(
      "The audited synthetic campaign service rejected the request schema.",
      "invalid_request",
      sourceCode,
    );
  }
  if (sourceCode === "unavailable" || sourceCode === "deadline-exceeded") {
    return new CampaignFunctionsClientError(
      "The local Functions emulator is unavailable.",
      "emulator_unavailable",
      sourceCode,
    );
  }
  return new CampaignFunctionsClientError(
    "The audited local campaign invocation failed safely.",
    "invocation_failed",
    sourceCode,
  );
}

function browserPolicy(): CampaignFunctionsPolicyResult {
  if (typeof window === "undefined") {
    return { allowed: false, reason: "non_loopback_host" };
  }
  return evaluateCampaignFunctionsPolicy({
    hostname: window.location.hostname,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appStage: process.env.NEXT_PUBLIC_APP_STAGE,
    useFirebaseEmulators: process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS,
    externalMessagingEnabled: process.env.NEXT_PUBLIC_EXTERNAL_MESSAGING_ENABLED,
    realPatientDataEnabled: process.env.NEXT_PUBLIC_REAL_PATIENT_DATA_ENABLED,
    functionsHostname: LOCAL_CAMPAIGN_FUNCTIONS_ENDPOINT.hostname,
    functionsPort: LOCAL_CAMPAIGN_FUNCTIONS_ENDPOINT.port,
    functionsRegion: LOCAL_CAMPAIGN_FUNCTIONS_ENDPOINT.region,
    callableName: LOCAL_CAMPAIGN_FUNCTIONS_ENDPOINT.callableName,
  });
}

declare global {
  var __hemasLocalCampaignFunctions: Functions | undefined;
}

function getLocalCampaignFunctions(actorUid: string): Functions {
  const policy = browserPolicy();
  if (!policy.allowed) {
    throw new CampaignFunctionsClientError(
      `The local Functions endpoint refused unsafe configuration: ${policy.reason}.`,
      "unsafe_endpoint",
    );
  }
  const auth = getLocalEmulatorAuth();
  const user = auth.currentUser;
  if (!user || user.uid !== actorUid || !isExpectedSyntheticIdentity(user.email)) {
    throw new CampaignFunctionsClientError(
      "The active Firebase Auth identity does not match the verified workspace session.",
      "identity_mismatch",
    );
  }
  if (globalThis.__hemasLocalCampaignFunctions) {
    return globalThis.__hemasLocalCampaignFunctions;
  }
  const functions = getFunctions(
    auth.app,
    LOCAL_CAMPAIGN_FUNCTIONS_ENDPOINT.region,
  );
  connectFunctionsEmulator(
    functions,
    LOCAL_CAMPAIGN_FUNCTIONS_ENDPOINT.hostname,
    LOCAL_CAMPAIGN_FUNCTIONS_ENDPOINT.port,
  );
  globalThis.__hemasLocalCampaignFunctions = functions;
  return functions;
}

export type CampaignFunctionsInvoker = (input: {
  readonly actorUid: string;
  readonly request: CampaignFunctionsRequest;
}) => Promise<unknown>;

const invokeLocalCampaignCallable: CampaignFunctionsInvoker = async (input) => {
  const functions = getLocalCampaignFunctions(input.actorUid);
  const callable = httpsCallable<CampaignFunctionsRequest, unknown>(
    functions,
    LOCAL_CAMPAIGN_FUNCTIONS_ENDPOINT.callableName,
    { timeout: 30_000 },
  );
  return (await callable(input.request)).data;
};

export async function controlSyntheticCampaignThroughLocalFunctions(
  input: { readonly actorUid: string; readonly request: unknown },
  invoke: CampaignFunctionsInvoker = invokeLocalCampaignCallable,
): Promise<CampaignFunctionsResponse> {
  const request = parseRequest(input.request);
  const identity = parseIdentity({
    workspaceId: request.workspaceId,
    campaignId: request.campaignId,
    actorUid: input.actorUid,
    action: request.action,
    expectedRevision: request.expectedRevision,
  });
  if (request.idempotencyKey !== (await keyForIdentity(identity))) invalidRequest();

  let response: unknown;
  try {
    response = await invoke({ actorUid: identity.actorUid, request });
  } catch (error) {
    throw mapCampaignFunctionsCallableError(error);
  }
  return parseCampaignFunctionsResponse(response, request);
}
