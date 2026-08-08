import type { RuntimeConfig } from "./config.js";

export const SERVICE_NAME = "hemas-connect-functions";
export const SERVICE_VERSION = "0.1.0";

export interface ReadinessReport {
  readonly service: typeof SERVICE_NAME;
  readonly version: typeof SERVICE_VERSION;
  readonly status: "ready" | "not_ready";
  readonly runtimeMode: RuntimeConfig["runtimeMode"];
  readonly safeMode: true;
  readonly generatedAt: string;
  readonly checks: {
    readonly configuration: "pass";
    readonly whatsapp: "synthetic" | "disabled" | "live_adapter_not_implemented";
    readonly hemasSystems: "synthetic" | "disabled" | "live_adapters_not_implemented";
    readonly audit:
      | "ephemeral_demo"
      | "disabled"
      | "durable_adapter_requires_runtime_binding";
    readonly outboundNetwork: "blocked";
    readonly medicalDiagnosis: "disabled";
    readonly approvalGates: "required" | "invalid";
  };
}

export interface InvalidReadinessReport {
  readonly service: typeof SERVICE_NAME;
  readonly version: typeof SERVICE_VERSION;
  readonly status: "not_ready";
  readonly safeMode: true;
  readonly generatedAt: string;
  readonly checks: {
    readonly configuration: "fail";
    readonly outboundNetwork: "blocked";
    readonly medicalDiagnosis: "disabled";
  };
  readonly issues: readonly string[];
}

export function buildReadinessReport(
  config: RuntimeConfig,
  now: Date = new Date(),
): ReadinessReport {
  const whatsapp = config.providerMode === "synthetic"
    ? "synthetic"
    : config.providerMode === "live" ? "live_adapter_not_implemented" : "disabled";
  const hemasSystems = config.hemasIntegrationMode === "synthetic"
    ? "synthetic"
    : config.hemasIntegrationMode === "live" ? "live_adapters_not_implemented" : "disabled";
  const audit = config.runtimeMode === "demo" && config.auditSinkMode === "memory"
    ? "ephemeral_demo"
    : config.auditSinkMode === "durable"
      ? "durable_adapter_requires_runtime_binding"
      : "disabled";
  const ready = config.runtimeMode === "demo" && !config.outboundEnabled &&
    config.providerMode !== "live" && config.hemasIntegrationMode !== "live";

  return {
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    status: ready ? "ready" : "not_ready",
    runtimeMode: config.runtimeMode,
    safeMode: true,
    generatedAt: now.toISOString(),
    checks: {
      configuration: "pass",
      whatsapp,
      hemasSystems,
      audit,
      outboundNetwork: "blocked",
      medicalDiagnosis: "disabled",
      approvalGates: config.approvalGateRequired ? "required" : "invalid",
    },
  };
}

export function buildInvalidReadinessReport(
  issues: readonly string[],
  now: Date = new Date(),
): InvalidReadinessReport {
  return {
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    status: "not_ready",
    safeMode: true,
    generatedAt: now.toISOString(),
    checks: {
      configuration: "fail",
      outboundNetwork: "blocked",
      medicalDiagnosis: "disabled",
    },
    issues: issues.slice(0, 20),
  };
}
