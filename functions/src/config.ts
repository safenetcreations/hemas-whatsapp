export const RUNTIME_MODES = ["demo", "uat", "production"] as const;
export const PROVIDER_MODES = ["disabled", "synthetic", "live"] as const;
export const AUDIT_SINK_MODES = ["memory", "durable"] as const;

export type RuntimeMode = (typeof RUNTIME_MODES)[number];
export type ProviderMode = (typeof PROVIDER_MODES)[number];
export type AuditSinkMode = (typeof AUDIT_SINK_MODES)[number];

export interface RuntimeConfig {
  readonly runtimeMode: RuntimeMode;
  readonly defaultTenantId: string;
  readonly providerMode: ProviderMode;
  readonly hemasIntegrationMode: ProviderMode;
  readonly auditSinkMode: AuditSinkMode;
  readonly outboundEnabled: boolean;
  readonly approvalGateRequired: boolean;
  readonly diagnosisEnabled: false;
  readonly syntheticSeed: string;
  readonly liveActivation: {
    readonly id: string | undefined;
    readonly approvedBy: string | undefined;
    readonly expiresAt: string | undefined;
  };
}

export class ConfigValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super("Hemas Connect runtime configuration is invalid.");
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}

function parseEnum<T extends readonly string[]>(
  value: string | undefined,
  fallback: T[number],
  allowed: T,
  field: string,
  issues: string[],
): T[number] {
  const candidate = value?.trim() || fallback;
  if (!allowed.includes(candidate)) {
    issues.push(`${field} is not an allowed value`);
    return fallback;
  }
  return candidate as T[number];
}

function parseBoolean(
  value: string | undefined,
  fallback: boolean,
  field: string,
  issues: string[],
): boolean {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  if (value === "true") return true;
  if (value === "false") return false;
  issues.push(`${field} must be true or false`);
  return fallback;
}

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isTenantId(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{2,62}$/.test(value);
}

export function loadRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): RuntimeConfig {
  const issues: string[] = [];
  const runtimeMode = parseEnum(
    env.HEMAS_RUNTIME_MODE,
    "demo",
    RUNTIME_MODES,
    "HEMAS_RUNTIME_MODE",
    issues,
  );
  const providerMode = parseEnum(
    env.HEMAS_PROVIDER_MODE,
    "synthetic",
    PROVIDER_MODES,
    "HEMAS_PROVIDER_MODE",
    issues,
  );
  const hemasIntegrationMode = parseEnum(
    env.HEMAS_INTEGRATION_MODE,
    "synthetic",
    PROVIDER_MODES,
    "HEMAS_INTEGRATION_MODE",
    issues,
  );
  const auditSinkMode = parseEnum(
    env.HEMAS_AUDIT_SINK_MODE,
    "memory",
    AUDIT_SINK_MODES,
    "HEMAS_AUDIT_SINK_MODE",
    issues,
  );
  const outboundEnabled = parseBoolean(
    env.HEMAS_OUTBOUND_ENABLED,
    false,
    "HEMAS_OUTBOUND_ENABLED",
    issues,
  );
  const approvalGateRequired = parseBoolean(
    env.HEMAS_APPROVAL_GATE_REQUIRED,
    true,
    "HEMAS_APPROVAL_GATE_REQUIRED",
    issues,
  );
  const diagnosisEnabled = parseBoolean(
    env.HEMAS_DIAGNOSIS_ENABLED,
    false,
    "HEMAS_DIAGNOSIS_ENABLED",
    issues,
  );
  const defaultTenantId =
    env.HEMAS_DEFAULT_TENANT_ID?.trim() || "workspace_safenet_demo";
  const syntheticSeed = env.HEMAS_SYNTHETIC_SEED?.trim() || "hemas-connect-demo-v1";
  const liveActivation = {
    id: optionalTrimmed(env.HEMAS_LIVE_ACTIVATION_ID),
    approvedBy: optionalTrimmed(env.HEMAS_LIVE_ACTIVATION_APPROVED_BY),
    expiresAt: optionalTrimmed(env.HEMAS_LIVE_ACTIVATION_EXPIRES_AT),
  };

  if (!isTenantId(defaultTenantId)) {
    issues.push("HEMAS_DEFAULT_TENANT_ID must be a safe tenant slug");
  }
  if (syntheticSeed.length < 8 || syntheticSeed.length > 128) {
    issues.push("HEMAS_SYNTHETIC_SEED must contain 8 to 128 characters");
  }
  if (diagnosisEnabled) {
    issues.push("HEMAS_DIAGNOSIS_ENABLED must remain false");
  }
  if (runtimeMode === "demo" && providerMode === "live") {
    issues.push("live WhatsApp provider mode is prohibited in demo");
  }
  if (runtimeMode === "demo" && hemasIntegrationMode === "live") {
    issues.push("live Hemas integration mode is prohibited in demo");
  }
  if (runtimeMode !== "demo" && providerMode === "synthetic") {
    issues.push("synthetic WhatsApp provider mode is limited to demo");
  }
  if (runtimeMode !== "demo" && hemasIntegrationMode === "synthetic") {
    issues.push("synthetic Hemas integration mode is limited to demo");
  }
  if (runtimeMode !== "demo" && auditSinkMode !== "durable") {
    issues.push("non-demo runtime requires a durable audit sink");
  }

  if (outboundEnabled) {
    if (runtimeMode === "demo") {
      issues.push("real outbound is prohibited in demo");
    }
    if (providerMode !== "live") {
      issues.push("outbound requires explicit live provider mode");
    }
    if (!approvalGateRequired) {
      issues.push("outbound requires approval gates");
    }
    if (auditSinkMode !== "durable") {
      issues.push("outbound requires a durable audit sink");
    }
    if (!liveActivation.id || !liveActivation.approvedBy || !liveActivation.expiresAt) {
      issues.push("outbound requires complete live activation approval metadata");
    } else {
      const expiry = Date.parse(liveActivation.expiresAt);
      if (!Number.isFinite(expiry) || expiry <= now.getTime()) {
        issues.push("live activation approval must have a future expiry");
      }
    }
  }

  if (issues.length > 0) {
    throw new ConfigValidationError(issues);
  }

  return {
    runtimeMode,
    defaultTenantId,
    providerMode,
    hemasIntegrationMode,
    auditSinkMode,
    outboundEnabled,
    approvalGateRequired,
    diagnosisEnabled: false,
    syntheticSeed,
    liveActivation,
  };
}
