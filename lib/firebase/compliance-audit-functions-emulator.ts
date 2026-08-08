import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
  type Functions,
} from "firebase/functions";
import { z } from "zod";

import {
  parseClientSafeAuditEventProjection,
  type ClientSafeAuditEventDTO,
  type FirestoreAuditOutcome,
} from "./repositories/audit-repository";
import { getLocalEmulatorAuth } from "./auth-emulator";
import {
  evaluateLocalAuthPolicy,
  isExpectedSyntheticIdentity,
  type LocalAuthPolicyInput,
  type LocalAuthPolicyResult,
} from "./auth-policy";

export const LOCAL_COMPLIANCE_AUDIT_FUNCTIONS_ENDPOINT = Object.freeze({
  hostname: "127.0.0.1",
  port: 5001,
  region: "us-central1",
  callableName: "listComplianceAuditEvents",
});

export const COMPLIANCE_AUDIT_PAGE_SIZE = 25;

type LocalPolicyReason = Exclude<
  LocalAuthPolicyResult,
  { readonly allowed: true }
>["reason"];

export type ComplianceAuditFunctionsPolicyInput = LocalAuthPolicyInput & {
  readonly functionsHostname: string;
  readonly functionsPort: number;
  readonly functionsRegion: string;
  readonly callableName: string;
};

export type ComplianceAuditFunctionsPolicyResult =
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

export function evaluateComplianceAuditFunctionsPolicy(
  input: ComplianceAuditFunctionsPolicyInput,
): ComplianceAuditFunctionsPolicyResult {
  const localPolicy = evaluateLocalAuthPolicy(input);
  if (!localPolicy.allowed) return localPolicy;
  if (
    input.functionsHostname !==
    LOCAL_COMPLIANCE_AUDIT_FUNCTIONS_ENDPOINT.hostname
  ) {
    return { allowed: false, reason: "unexpected_functions_host" };
  }
  if (input.functionsPort !== LOCAL_COMPLIANCE_AUDIT_FUNCTIONS_ENDPOINT.port) {
    return { allowed: false, reason: "unexpected_functions_port" };
  }
  if (
    input.functionsRegion !== LOCAL_COMPLIANCE_AUDIT_FUNCTIONS_ENDPOINT.region
  ) {
    return { allowed: false, reason: "unexpected_functions_region" };
  }
  if (
    input.callableName !== LOCAL_COMPLIANCE_AUDIT_FUNCTIONS_ENDPOINT.callableName
  ) {
    return { allowed: false, reason: "unexpected_callable" };
  }
  return { allowed: true };
}

const safeIdentifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const auditOutcome = z.enum(["allowed", "denied", "failed", "simulated"]);
const canonicalIsoDateTime = z.string().refine((value) => {
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
});
const cursorSchema = z
  .object({
    createdAt: canonicalIsoDateTime,
    id: safeIdentifier,
  })
  .strict();
const requestSchema = z
  .object({
    workspaceId: safeIdentifier,
    outcome: auditOutcome.nullable(),
    pageSize: z.number().int().min(1).max(50),
    cursor: cursorSchema.nullable(),
  })
  .strict();
const responseEnvelopeSchema = z
  .object({
    events: z.array(z.unknown()).max(50),
    nextCursor: cursorSchema.nullable(),
  })
  .strict();

export type ComplianceAuditCursor = z.infer<typeof cursorSchema>;
export type ComplianceAuditFunctionsRequest = z.infer<typeof requestSchema>;
export type ComplianceAuditOutcome = FirestoreAuditOutcome;
export type ComplianceAuditEvent = ClientSafeAuditEventDTO;
export type ComplianceAuditFunctionsResponse = {
  readonly events: readonly ClientSafeAuditEventDTO[];
  readonly nextCursor: ComplianceAuditCursor | null;
};

export type ComplianceAuditFunctionsClientErrorCode =
  | "invalid_request"
  | "invalid_response"
  | "unsafe_endpoint"
  | "identity_mismatch"
  | "authentication_required"
  | "permission_denied"
  | "service_unavailable"
  | "emulator_unavailable"
  | "invocation_failed";

export class ComplianceAuditFunctionsClientError extends Error {
  constructor(
    message: string,
    readonly code: ComplianceAuditFunctionsClientErrorCode,
    readonly sourceCode = "",
  ) {
    super(message);
    this.name = "ComplianceAuditFunctionsClientError";
  }
}

function invalidRequest(): never {
  throw new ComplianceAuditFunctionsClientError(
    "The minimized audit request failed strict client validation.",
    "invalid_request",
  );
}

function invalidResponse(): never {
  throw new ComplianceAuditFunctionsClientError(
    "The local Compliance callable returned invalid minimized audit evidence.",
    "invalid_response",
  );
}

export function parseComplianceAuditFunctionsRequest(
  value: unknown,
): ComplianceAuditFunctionsRequest {
  const result = requestSchema.safeParse(value);
  if (!result.success) invalidRequest();
  return result.data;
}

type AuditPosition = {
  readonly id: string;
  readonly createdAt: string;
};

function compareDescendingAuditPosition(
  prior: AuditPosition,
  next: AuditPosition,
): number {
  const priorMillis = Date.parse(prior.createdAt);
  const nextMillis = Date.parse(next.createdAt);
  if (priorMillis !== nextMillis) return nextMillis - priorMillis;
  if (prior.id === next.id) return 0;
  return prior.id > next.id ? -1 : 1;
}

export function parseComplianceAuditFunctionsResponse(
  value: unknown,
  requestValue: ComplianceAuditFunctionsRequest,
): ComplianceAuditFunctionsResponse {
  const request = parseComplianceAuditFunctionsRequest(requestValue);
  const envelope = responseEnvelopeSchema.safeParse(value);
  if (!envelope.success || envelope.data.events.length > request.pageSize) {
    return invalidResponse();
  }

  let events: ClientSafeAuditEventDTO[];
  try {
    events = envelope.data.events.map((event) =>
      parseClientSafeAuditEventProjection(event),
    );
  } catch {
    return invalidResponse();
  }

  const seen = new Set<string>();
  let prior: AuditPosition | null = request.cursor;
  for (const event of events) {
    if (
      event.workspaceId !== request.workspaceId ||
      (request.outcome !== null && event.outcome !== request.outcome) ||
      seen.has(event.id)
    ) {
      return invalidResponse();
    }
    seen.add(event.id);
    const position = { id: event.id, createdAt: event.occurredAt };
    if (prior && compareDescendingAuditPosition(prior, position) >= 0) {
      return invalidResponse();
    }
    prior = position;
  }

  const nextCursor = envelope.data.nextCursor;
  const last = events.at(-1);
  if (
    (events.length === request.pageSize) !== (nextCursor !== null) ||
    (nextCursor !== null &&
      (!last ||
        nextCursor.id !== last.id ||
        nextCursor.createdAt !== last.occurredAt))
  ) {
    return invalidResponse();
  }

  return { events, nextCursor };
}

function normalizedCallableCode(error: unknown): string {
  const sourceCode =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  return sourceCode.trim().toLowerCase().replace(/^functions\//, "");
}

export function mapComplianceAuditCallableError(
  error: unknown,
): ComplianceAuditFunctionsClientError {
  if (error instanceof ComplianceAuditFunctionsClientError) return error;
  const sourceCode = normalizedCallableCode(error);
  if (sourceCode === "unauthenticated") {
    return new ComplianceAuditFunctionsClientError(
      "A verified local Firebase Auth session is required.",
      "authentication_required",
      sourceCode,
    );
  }
  if (sourceCode === "permission-denied") {
    return new ComplianceAuditFunctionsClientError(
      "The verified workspace authority cannot list the minimized audit timeline.",
      "permission_denied",
      sourceCode,
    );
  }
  if (sourceCode === "invalid-argument") {
    return new ComplianceAuditFunctionsClientError(
      "The minimized audit request or cursor was rejected.",
      "invalid_request",
      sourceCode,
    );
  }
  if (sourceCode === "failed-precondition") {
    return new ComplianceAuditFunctionsClientError(
      "The minimized synthetic audit projection is unavailable.",
      "service_unavailable",
      sourceCode,
    );
  }
  if (sourceCode === "unavailable" || sourceCode === "deadline-exceeded") {
    return new ComplianceAuditFunctionsClientError(
      "The local Functions emulator is unavailable.",
      "emulator_unavailable",
      sourceCode,
    );
  }
  return new ComplianceAuditFunctionsClientError(
    "The local Compliance timeline invocation failed safely.",
    "invocation_failed",
    sourceCode,
  );
}

function browserPolicy(): ComplianceAuditFunctionsPolicyResult {
  if (typeof window === "undefined") {
    return { allowed: false, reason: "non_loopback_host" };
  }
  return evaluateComplianceAuditFunctionsPolicy({
    hostname: window.location.hostname,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appStage: process.env.NEXT_PUBLIC_APP_STAGE,
    useFirebaseEmulators: process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS,
    externalMessagingEnabled:
      process.env.NEXT_PUBLIC_EXTERNAL_MESSAGING_ENABLED,
    realPatientDataEnabled: process.env.NEXT_PUBLIC_REAL_PATIENT_DATA_ENABLED,
    functionsHostname: LOCAL_COMPLIANCE_AUDIT_FUNCTIONS_ENDPOINT.hostname,
    functionsPort: LOCAL_COMPLIANCE_AUDIT_FUNCTIONS_ENDPOINT.port,
    functionsRegion: LOCAL_COMPLIANCE_AUDIT_FUNCTIONS_ENDPOINT.region,
    callableName: LOCAL_COMPLIANCE_AUDIT_FUNCTIONS_ENDPOINT.callableName,
  });
}

declare global {
  var __hemasLocalComplianceAuditFunctions: Functions | undefined;
}

function getLocalComplianceAuditFunctions(actorUid: string): Functions {
  const policy = browserPolicy();
  if (!policy.allowed) {
    throw new ComplianceAuditFunctionsClientError(
      `The local Compliance endpoint refused unsafe configuration: ${policy.reason}.`,
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
    throw new ComplianceAuditFunctionsClientError(
      "The active Firebase Auth identity does not match workspace authority.",
      "identity_mismatch",
    );
  }
  if (globalThis.__hemasLocalComplianceAuditFunctions) {
    return globalThis.__hemasLocalComplianceAuditFunctions;
  }
  const functions = getFunctions(
    auth.app,
    LOCAL_COMPLIANCE_AUDIT_FUNCTIONS_ENDPOINT.region,
  );
  connectFunctionsEmulator(
    functions,
    LOCAL_COMPLIANCE_AUDIT_FUNCTIONS_ENDPOINT.hostname,
    LOCAL_COMPLIANCE_AUDIT_FUNCTIONS_ENDPOINT.port,
  );
  globalThis.__hemasLocalComplianceAuditFunctions = functions;
  return functions;
}

export type ComplianceAuditFunctionsInvoker = (input: {
  readonly actorUid: string;
  readonly request: ComplianceAuditFunctionsRequest;
}) => Promise<unknown>;

const invokeLocalComplianceAuditCallable: ComplianceAuditFunctionsInvoker =
  async (input) => {
    const functions = getLocalComplianceAuditFunctions(input.actorUid);
    const callable = httpsCallable<ComplianceAuditFunctionsRequest, unknown>(
      functions,
      LOCAL_COMPLIANCE_AUDIT_FUNCTIONS_ENDPOINT.callableName,
      { timeout: 15_000 },
    );
    return (await callable(input.request)).data;
  };

export async function listComplianceAuditEventsThroughLocalFunctions(
  input: {
    readonly actorUid: string;
    readonly request: unknown;
  },
  invoke: ComplianceAuditFunctionsInvoker = invokeLocalComplianceAuditCallable,
): Promise<ComplianceAuditFunctionsResponse> {
  const actorUid = safeIdentifier.safeParse(input.actorUid);
  const request = parseComplianceAuditFunctionsRequest(input.request);
  if (!actorUid.success) invalidRequest();

  let response: unknown;
  try {
    response = await invoke({ actorUid: actorUid.data, request });
  } catch (error) {
    throw mapComplianceAuditCallableError(error);
  }
  return parseComplianceAuditFunctionsResponse(response, request);
}
