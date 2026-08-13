export const HEMAS_OPERATOR_PROJECT_ID = "hemas-whatsapp" as const;
export const HEMAS_PRIMARY_DATABASE_ID = "(default)" as const;
export const HEMAS_PRIMARY_DATABASE_LABEL = "primary-standard" as const;
export const HEMAS_OPERATOR_WORKSPACE_ID = "workspace_safenet_demo" as const;
export const HEMAS_CANARY_RECEIPT_COLLECTION = "canary_inbound_events" as const;

export const HEMAS_CLAIMS_APPLY_CONFIRMATION = "HEMAS_CLAIMS_APPLY" as const;
export const HEMAS_RECEIPTS_APPLY_CONFIRMATION = "HEMAS_RECEIPTS_DELETE" as const;
export const HEMAS_MIN_RECEIPT_RETENTION_DAYS = 30 as const;

export const HEMAS_OPERATOR_CLAIMS = [
  "hemasPortalDemo",
  "hemasLiteCanary",
  "hemasLiteAdmin",
  "hemasMetaCanary",
  "hemasMetaCanaryAdmin",
] as const;

export type HemasOperatorClaim = (typeof HEMAS_OPERATOR_CLAIMS)[number];
export type OperatorMode = "dry-run" | "apply";

export class OperatorInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperatorInputError";
  }
}

export function assertClaimTargetEligibility(input: {
  readonly uid: unknown;
  readonly emailVerified: unknown;
}, action: "grant" | "revoke"): void {
  // Revocation must remain available even when an account is unverified or
  // compromised. Verification is required only before adding privilege.
  if (action === "revoke") return;
  if (
    typeof input.uid !== "string" ||
    input.uid.length < 1 ||
    input.uid.length > 128 ||
    input.emailVerified !== true
  ) {
    throw new OperatorInputError(
      "The selected operator must be an existing Firebase user with a verified email.",
    );
  }
}

export type OperatorTarget = {
  readonly projectId: typeof HEMAS_OPERATOR_PROJECT_ID;
  readonly databaseId: typeof HEMAS_PRIMARY_DATABASE_ID;
  readonly databaseLabel: typeof HEMAS_PRIMARY_DATABASE_LABEL;
};

export function assertOperatorTarget(
  projectId: string | undefined,
  databaseId: string | undefined,
): OperatorTarget {
  if (projectId !== HEMAS_OPERATOR_PROJECT_ID) {
    throw new OperatorInputError(
      `Refusing project target. The only allowed project is ${HEMAS_OPERATOR_PROJECT_ID}.`,
    );
  }
  if (databaseId !== HEMAS_PRIMARY_DATABASE_ID) {
    throw new OperatorInputError(
      "Refusing database target. Pass the primary Standard database selector exactly.",
    );
  }
  return {
    projectId: HEMAS_OPERATOR_PROJECT_ID,
    databaseId: HEMAS_PRIMARY_DATABASE_ID,
    databaseLabel: HEMAS_PRIMARY_DATABASE_LABEL,
  };
}

type OperatorEnvironment = Readonly<Record<string, string | undefined>>;

function firebaseConfigProjectId(raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const projectId = (parsed as Record<string, unknown>).projectId;
    return typeof projectId === "string" ? projectId : null;
  } catch {
    return null;
  }
}

export function assertSafeOperatorEnvironment(
  environment: OperatorEnvironment,
  target: OperatorTarget,
): void {
  for (const emulatorVariable of [
    "FIREBASE_AUTH_EMULATOR_HOST",
    "FIRESTORE_EMULATOR_HOST",
  ] as const) {
    if (environment[emulatorVariable]?.trim()) {
      throw new OperatorInputError(
        `Refusing to run while ${emulatorVariable} is set. Start a clean operator shell.`,
      );
    }
  }

  for (const projectVariable of ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT"] as const) {
    const ambientProject = environment[projectVariable]?.trim();
    if (ambientProject && ambientProject !== target.projectId) {
      throw new OperatorInputError(
        `Refusing because ${projectVariable} does not match the allowed project.`,
      );
    }
  }

  const firebaseConfig = environment.FIREBASE_CONFIG?.trim();
  if (firebaseConfig) {
    const configuredProject = firebaseConfigProjectId(firebaseConfig);
    if (!configuredProject || configuredProject !== target.projectId) {
      throw new OperatorInputError(
        "Refusing because FIREBASE_CONFIG is ambiguous or targets another project.",
      );
    }
  }
}

type ParsedOptions = ReadonlyMap<string, string | true>;

function parseOptions(args: readonly string[], allowedNames: ReadonlySet<string>): ParsedOptions {
  const options = new Map<string, string | true>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument?.startsWith("--")) {
      throw new OperatorInputError("Every operator argument must use a named --option.");
    }
    const equalsIndex = argument.indexOf("=");
    const name = argument.slice(2, equalsIndex === -1 ? undefined : equalsIndex);
    if (!allowedNames.has(name)) {
      throw new OperatorInputError(`Unknown operator option --${name}.`);
    }
    if (options.has(name)) {
      throw new OperatorInputError(`Operator option --${name} may be supplied only once.`);
    }

    if (equalsIndex !== -1) {
      const value = argument.slice(equalsIndex + 1);
      if (!value) {
        throw new OperatorInputError(`Operator option --${name} requires a value.`);
      }
      options.set(name, value);
      continue;
    }

    const following = args[index + 1];
    if (following && !following.startsWith("--")) {
      options.set(name, following);
      index += 1;
    } else {
      options.set(name, true);
    }
  }
  return options;
}

function stringOption(options: ParsedOptions, name: string): string | undefined {
  const value = options.get(name);
  if (value === true) {
    throw new OperatorInputError(`Operator option --${name} requires a value.`);
  }
  return value;
}

function flagOption(options: ParsedOptions, name: string): boolean {
  const value = options.get(name);
  if (typeof value === "string") {
    throw new OperatorInputError(`Operator flag --${name} does not accept a value.`);
  }
  return value === true;
}

function parseMode(
  options: ParsedOptions,
  confirmation: string,
): OperatorMode {
  const apply = flagOption(options, "apply");
  const suppliedConfirmation = stringOption(options, "confirm");
  if (apply && suppliedConfirmation !== confirmation) {
    throw new OperatorInputError(
      "Apply mode requires the exact operation-specific confirmation phrase.",
    );
  }
  if (!apply && suppliedConfirmation) {
    throw new OperatorInputError("--confirm is valid only together with --apply.");
  }
  return apply ? "apply" : "dry-run";
}

function parseClaims(raw: string | undefined): readonly HemasOperatorClaim[] {
  if (!raw) {
    throw new OperatorInputError("At least one exact Hemas operator claim is required.");
  }
  const allowed = new Set<string>(HEMAS_OPERATOR_CLAIMS);
  const values = raw.split(",").map((value) => value.trim());
  if (values.some((value) => !allowed.has(value))) {
    throw new OperatorInputError("One or more requested claims are not operator-allowlisted.");
  }
  return [...new Set(values)] as readonly HemasOperatorClaim[];
}

export type ClaimsCommand = {
  readonly target: OperatorTarget;
  readonly mode: OperatorMode;
  readonly action: "grant" | "revoke";
  readonly claims: readonly HemasOperatorClaim[];
  readonly identity:
    | { readonly kind: "email"; readonly value: string }
    | { readonly kind: "uid"; readonly value: string };
  readonly revokeTokens: boolean;
  readonly disableMembership: boolean;
};

const CLAIM_OPTION_NAMES = new Set([
  "project",
  "database",
  "action",
  "claims",
  "email",
  "uid",
  "revoke-tokens",
  "disable-membership",
  "apply",
  "confirm",
]);

export function parseClaimsCommand(args: readonly string[]): ClaimsCommand {
  const options = parseOptions(args, CLAIM_OPTION_NAMES);
  const target = assertOperatorTarget(
    stringOption(options, "project"),
    stringOption(options, "database"),
  );
  const action = stringOption(options, "action");
  if (action !== "grant" && action !== "revoke") {
    throw new OperatorInputError("--action must be exactly grant or revoke.");
  }

  const email = stringOption(options, "email")?.trim();
  const uid = stringOption(options, "uid")?.trim();
  if (Boolean(email) === Boolean(uid)) {
    throw new OperatorInputError("Select exactly one operator identity type: email or UID.");
  }
  if (email && (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new OperatorInputError("The supplied email selector is malformed.");
  }
  if (uid && (uid.length > 128 || !/^[A-Za-z0-9:._~-]+$/.test(uid))) {
    throw new OperatorInputError("The supplied UID selector is malformed.");
  }

  const revokeTokens = flagOption(options, "revoke-tokens");
  const disableMembership = flagOption(options, "disable-membership");
  if (action !== "revoke" && (revokeTokens || disableMembership)) {
    throw new OperatorInputError(
      "Token revocation and membership disablement are valid only for revoke operations.",
    );
  }
  if (revokeTokens && !disableMembership) {
    throw new OperatorInputError(
      "Closing refresh-token sessions also requires --disable-membership.",
    );
  }

  return {
    target,
    mode: parseMode(options, HEMAS_CLAIMS_APPLY_CONFIRMATION),
    action,
    claims: parseClaims(stringOption(options, "claims")),
    identity: email
      ? { kind: "email", value: email }
      : { kind: "uid", value: uid as string },
    revokeTokens,
    disableMembership,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ClaimsMergePlan = {
  readonly nextClaims: Readonly<Record<string, unknown>>;
  readonly changedClaims: readonly HemasOperatorClaim[];
};

export function buildClaimsMergePlan(
  existingClaims: unknown,
  action: ClaimsCommand["action"],
  requestedClaims: readonly HemasOperatorClaim[],
): ClaimsMergePlan {
  const nextClaims: Record<string, unknown> = isRecord(existingClaims)
    ? { ...existingClaims }
    : {};
  const changedClaims: HemasOperatorClaim[] = [];

  for (const claim of requestedClaims) {
    if (action === "grant") {
      if (nextClaims[claim] !== true) {
        nextClaims[claim] = true;
        changedClaims.push(claim);
      }
      continue;
    }
    if (Object.hasOwn(nextClaims, claim)) {
      delete nextClaims[claim];
      changedClaims.push(claim);
    }
  }

  return { nextClaims, changedClaims };
}

export type ClaimsPublicSummary = {
  readonly mode: OperatorMode;
  readonly project: typeof HEMAS_OPERATOR_PROJECT_ID;
  readonly database: typeof HEMAS_PRIMARY_DATABASE_LABEL;
  readonly identitySelector: ClaimsCommand["identity"]["kind"];
  readonly action: ClaimsCommand["action"];
  readonly requestedClaims: readonly HemasOperatorClaim[];
  readonly changedClaims: readonly HemasOperatorClaim[];
  readonly revokeTokens: boolean;
  readonly disableMembership: boolean;
};

export function buildClaimsPublicSummary(
  command: ClaimsCommand,
  plan: ClaimsMergePlan,
): ClaimsPublicSummary {
  return {
    mode: command.mode,
    project: command.target.projectId,
    database: command.target.databaseLabel,
    identitySelector: command.identity.kind,
    action: command.action,
    requestedClaims: command.claims,
    changedClaims: plan.changedClaims,
    revokeTokens: command.revokeTokens,
    disableMembership: command.disableMembership,
  };
}

export type ReceiptCommand = {
  readonly target: OperatorTarget;
  readonly mode: OperatorMode;
  readonly cutoffMs: number;
  readonly cutoffIso: string;
  readonly maxDocuments: number;
};

const RECEIPT_OPTION_NAMES = new Set([
  "project",
  "database",
  "cutoff",
  "max-docs",
  "apply",
  "confirm",
]);

export function parseReceiptCommand(
  args: readonly string[],
  nowMs = Date.now(),
): ReceiptCommand {
  const options = parseOptions(args, RECEIPT_OPTION_NAMES);
  const target = assertOperatorTarget(
    stringOption(options, "project"),
    stringOption(options, "database"),
  );
  const cutoff = stringOption(options, "cutoff");
  if (!cutoff || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(cutoff)) {
    throw new OperatorInputError("--cutoff must be an unambiguous UTC ISO-8601 timestamp.");
  }
  const cutoffMs = Date.parse(cutoff);
  const minimumRetentionMs = HEMAS_MIN_RECEIPT_RETENTION_DAYS * 24 * 60 * 60 * 1_000;
  if (!Number.isFinite(cutoffMs) || cutoffMs > nowMs - minimumRetentionMs) {
    throw new OperatorInputError(
      `--cutoff must retain at least ${HEMAS_MIN_RECEIPT_RETENTION_DAYS} full days.`,
    );
  }

  const rawMaxDocuments = stringOption(options, "max-docs") ?? "5000";
  const maxDocuments = Number(rawMaxDocuments);
  if (!Number.isInteger(maxDocuments) || maxDocuments < 1 || maxDocuments > 20_000) {
    throw new OperatorInputError("--max-docs must be an integer from 1 through 20000.");
  }

  return {
    target,
    mode: parseMode(options, HEMAS_RECEIPTS_APPLY_CONFIRMATION),
    cutoffMs,
    cutoffIso: new Date(cutoffMs).toISOString(),
    maxDocuments,
  };
}

export type ReceiptAgeBucket =
  | "future"
  | "under_7_days"
  | "7_to_29_days"
  | "30_to_89_days"
  | "90_days_or_more"
  | "missing_or_invalid";

export type ReceiptSchemaBucket = "v1" | "v2" | "other_or_missing";

export type ReceiptClassification = {
  readonly schema: ReceiptSchemaBucket;
  readonly age: ReceiptAgeBucket;
  readonly legacyV1: boolean;
  readonly hasRawSenderField: boolean;
  readonly eligibleForDeletion: boolean;
  readonly timestampValid: boolean;
};

function timestampMillis(value: unknown): number | null {
  if (value instanceof Date) {
    const milliseconds = value.getTime();
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as { toMillis?: unknown; toDate?: unknown };
  if (typeof candidate.toMillis === "function") {
    const milliseconds: unknown = candidate.toMillis.call(value);
    return typeof milliseconds === "number" && Number.isFinite(milliseconds)
      ? milliseconds
      : null;
  }
  if (typeof candidate.toDate === "function") {
    const date: unknown = candidate.toDate.call(value);
    return date instanceof Date && Number.isFinite(date.getTime()) ? date.getTime() : null;
  }
  return null;
}

function ageBucket(receivedAtMs: number | null, nowMs: number): ReceiptAgeBucket {
  if (receivedAtMs === null) return "missing_or_invalid";
  const ageMs = nowMs - receivedAtMs;
  if (ageMs < 0) return "future";
  const ageDays = ageMs / (24 * 60 * 60 * 1_000);
  if (ageDays < 7) return "under_7_days";
  if (ageDays < 30) return "7_to_29_days";
  if (ageDays < 90) return "30_to_89_days";
  return "90_days_or_more";
}

export function classifyCanaryReceipt(
  raw: unknown,
  nowMs: number,
  cutoffMs: number,
): ReceiptClassification {
  const record = isRecord(raw) ? raw : {};
  const schema = record.schemaVersion === 1
    ? "v1"
    : record.schemaVersion === 2
      ? "v2"
      : "other_or_missing";
  const receivedAtMs = timestampMillis(record.receivedAt);
  const timestampValid = receivedAtMs !== null;
  const legacyV1 = schema === "v1";
  return {
    schema,
    age: ageBucket(receivedAtMs, nowMs),
    legacyV1,
    hasRawSenderField:
      legacyV1 && Object.hasOwn(record, "fromNumber") && typeof record.fromNumber === "string",
    eligibleForDeletion:
      legacyV1 &&
      receivedAtMs !== null &&
      receivedAtMs < cutoffMs &&
      receivedAtMs <= nowMs,
    timestampValid,
  };
}

export type ReceiptAggregate = {
  readonly scanned: number;
  readonly schema: Readonly<Record<ReceiptSchemaBucket, number>>;
  readonly age: Readonly<Record<ReceiptAgeBucket, number>>;
  readonly legacyV1: {
    readonly total: number;
    readonly withRawSenderField: number;
    readonly missingOrInvalidTimestamp: number;
    readonly eligibleForDeletion: number;
  };
};

export function aggregateCanaryReceipts(
  records: readonly unknown[],
  nowMs: number,
  cutoffMs: number,
): ReceiptAggregate {
  const schema: Record<ReceiptSchemaBucket, number> = {
    v1: 0,
    v2: 0,
    other_or_missing: 0,
  };
  const age: Record<ReceiptAgeBucket, number> = {
    future: 0,
    under_7_days: 0,
    "7_to_29_days": 0,
    "30_to_89_days": 0,
    "90_days_or_more": 0,
    missing_or_invalid: 0,
  };
  let legacyTotal = 0;
  let legacyWithRawSenderField = 0;
  let legacyMissingOrInvalidTimestamp = 0;
  let eligibleForDeletion = 0;

  for (const record of records) {
    const classification = classifyCanaryReceipt(record, nowMs, cutoffMs);
    schema[classification.schema] += 1;
    age[classification.age] += 1;
    if (classification.legacyV1) {
      legacyTotal += 1;
      if (classification.hasRawSenderField) legacyWithRawSenderField += 1;
      if (!classification.timestampValid) legacyMissingOrInvalidTimestamp += 1;
      if (classification.eligibleForDeletion) eligibleForDeletion += 1;
    }
  }

  return {
    scanned: records.length,
    schema,
    age,
    legacyV1: {
      total: legacyTotal,
      withRawSenderField: legacyWithRawSenderField,
      missingOrInvalidTimestamp: legacyMissingOrInvalidTimestamp,
      eligibleForDeletion,
    },
  };
}
