import type { RuntimeConfig } from "../config.js";
import { deterministicId } from "../deterministic.js";
import { FailClosedError } from "../errors.js";
import type { AdapterCallContext, AdapterReadiness } from "./contracts.js";
import { assertRequestTenant } from "./contracts.js";

export interface WhatsAppTemplateRequest {
  readonly tenantId: string;
  readonly recipientRef: string;
  readonly templateName: string;
  readonly language: "en" | "si" | "ta";
  readonly parameterRefs: readonly string[];
}

export interface WhatsAppSendResult {
  readonly providerMessageId: string;
  readonly accepted: true;
  readonly simulated: true;
  readonly networkCalls: 0;
}

export interface WhatsAppMetaAdapter {
  readiness(): AdapterReadiness;
  sendApprovedTemplate(
    request: WhatsAppTemplateRequest,
    context: AdapterCallContext,
  ): Promise<WhatsAppSendResult>;
}

export class DisabledWhatsAppMetaAdapter implements WhatsAppMetaAdapter {
  constructor(private readonly reason = "No real WhatsApp provider adapter is implemented.") {}

  readiness(): AdapterReadiness {
    return { ready: false, mode: "disabled", networkCallsEnabled: false, reason: this.reason };
  }

  async sendApprovedTemplate(): Promise<never> {
    throw new FailClosedError("whatsapp_provider_disabled", this.reason);
  }
}

export class SyntheticWhatsAppMetaAdapter implements WhatsAppMetaAdapter {
  constructor(private readonly config: RuntimeConfig) {
    if (config.runtimeMode !== "demo" || config.providerMode !== "synthetic") {
      throw new FailClosedError("synthetic_mode_denied", "Synthetic WhatsApp is demo-only.");
    }
  }

  readiness(): AdapterReadiness {
    return {
      ready: true,
      mode: "synthetic",
      networkCallsEnabled: false,
      reason: "Deterministic simulator only; no provider request is possible.",
    };
  }

  async sendApprovedTemplate(
    request: WhatsAppTemplateRequest,
    context: AdapterCallContext,
  ): Promise<WhatsAppSendResult> {
    assertRequestTenant(context, request.tenantId);
    if (!request.recipientRef.startsWith("synthetic-contact-")) {
      throw new FailClosedError("non_synthetic_recipient", "Simulator accepts synthetic contacts only.");
    }
    if (!/^[a-z][a-z0-9_]{2,127}$/.test(request.templateName)) {
      throw new FailClosedError("invalid_template", "A safe template name is required.");
    }
    const identity = [
      this.config.syntheticSeed,
      request.tenantId,
      request.recipientRef,
      request.templateName,
      request.language,
      context.requestId,
    ].join(":");
    return {
      providerMessageId: deterministicId("synthetic-wamid", identity),
      accepted: true,
      simulated: true,
      networkCalls: 0,
    };
  }
}

export function createWhatsAppMetaAdapter(config: RuntimeConfig): WhatsAppMetaAdapter {
  if (config.runtimeMode === "demo" && config.providerMode === "synthetic") {
    return new SyntheticWhatsAppMetaAdapter(config);
  }
  return new DisabledWhatsAppMetaAdapter(
    config.providerMode === "live"
      ? "Live WhatsApp configuration is present, but the real adapter is intentionally not implemented."
      : "WhatsApp provider mode is disabled.",
  );
}
