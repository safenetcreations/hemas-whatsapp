import type { RuntimeConfig } from "../config.js";
import { deterministicBucket, deterministicId } from "../deterministic.js";
import { FailClosedError } from "../errors.js";
import type { AdapterCallContext, AdapterReadiness } from "./contracts.js";
import { assertRequestTenant } from "./contracts.js";

export interface AppointmentSlotQuery {
  readonly tenantId: string;
  readonly locationRef: string;
  readonly specialtyRef: string;
  readonly date: string;
}

export interface AppointmentSlot {
  readonly slotRef: string;
  readonly startsAt: string;
  readonly simulated: true;
}

export interface AppointmentMutation {
  readonly tenantId: string;
  readonly syntheticContactRef: string;
  readonly slotRef: string;
  readonly idempotencyKey: string;
}

export interface AppointmentMutationResult {
  readonly externalAppointmentRef: string;
  readonly status: "confirmed";
  readonly simulated: true;
  readonly networkCalls: 0;
}

export interface LabReportStateQuery {
  readonly tenantId: string;
  readonly syntheticContactRef: string;
  readonly externalReportRef: string;
}

export interface LabReportNotificationState {
  readonly state: "not_ready" | "ready";
  readonly securePortalPath: string | null;
  readonly includesClinicalResult: false;
  readonly simulated: true;
  readonly networkCalls: 0;
}

export interface HemasHisAdapter {
  readiness(): AdapterReadiness;
  listAppointmentSlots(query: AppointmentSlotQuery, context: AdapterCallContext): Promise<readonly AppointmentSlot[]>;
  createAppointment(request: AppointmentMutation, context: AdapterCallContext): Promise<AppointmentMutationResult>;
}

export interface HemasLimsAdapter {
  readiness(): AdapterReadiness;
  getReportNotificationState(
    query: LabReportStateQuery,
    context: AdapterCallContext,
  ): Promise<LabReportNotificationState>;
}

class DisabledHemasAdapter implements HemasHisAdapter, HemasLimsAdapter {
  constructor(private readonly reason: string) {}

  readiness(): AdapterReadiness {
    return { ready: false, mode: "disabled", networkCallsEnabled: false, reason: this.reason };
  }

  async listAppointmentSlots(): Promise<never> {
    throw new FailClosedError("hemas_his_disabled", this.reason);
  }

  async createAppointment(): Promise<never> {
    throw new FailClosedError("hemas_his_disabled", this.reason);
  }

  async getReportNotificationState(): Promise<never> {
    throw new FailClosedError("hemas_lims_disabled", this.reason);
  }
}

class SyntheticHemasAdapter implements HemasHisAdapter, HemasLimsAdapter {
  constructor(private readonly config: RuntimeConfig) {
    if (config.runtimeMode !== "demo" || config.hemasIntegrationMode !== "synthetic") {
      throw new FailClosedError("synthetic_mode_denied", "Synthetic Hemas integrations are demo-only.");
    }
  }

  readiness(): AdapterReadiness {
    return {
      ready: true,
      mode: "synthetic",
      networkCallsEnabled: false,
      reason: "Deterministic HIS/LIMS simulators only; no Hemas system request is possible.",
    };
  }

  async listAppointmentSlots(
    query: AppointmentSlotQuery,
    context: AdapterCallContext,
  ): Promise<readonly AppointmentSlot[]> {
    assertRequestTenant(context, query.tenantId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(query.date)) {
      throw new FailClosedError("invalid_date", "Appointment date must use YYYY-MM-DD.");
    }
    const identity = `${this.config.syntheticSeed}:${query.locationRef}:${query.specialtyRef}:${query.date}`;
    return ["03:30:00.000Z", "05:30:00.000Z", "08:30:00.000Z"].map((time, index) => ({
      slotRef: deterministicId("synthetic-slot", `${identity}:${index}`),
      startsAt: `${query.date}T${time}`,
      simulated: true,
    }));
  }

  async createAppointment(
    request: AppointmentMutation,
    context: AdapterCallContext,
  ): Promise<AppointmentMutationResult> {
    assertRequestTenant(context, request.tenantId);
    if (!request.syntheticContactRef.startsWith("synthetic-contact-")) {
      throw new FailClosedError("non_synthetic_contact", "Simulator accepts synthetic contacts only.");
    }
    if (!request.slotRef.startsWith("synthetic-slot-") || !request.idempotencyKey.trim()) {
      throw new FailClosedError("invalid_appointment", "Synthetic slot and idempotency key are required.");
    }
    return {
      externalAppointmentRef: deterministicId(
        "synthetic-appointment",
        `${this.config.syntheticSeed}:${request.tenantId}:${request.idempotencyKey}:${request.slotRef}`,
      ),
      status: "confirmed",
      simulated: true,
      networkCalls: 0,
    };
  }

  async getReportNotificationState(
    query: LabReportStateQuery,
    context: AdapterCallContext,
  ): Promise<LabReportNotificationState> {
    assertRequestTenant(context, query.tenantId);
    if (!query.syntheticContactRef.startsWith("synthetic-contact-")) {
      throw new FailClosedError("non_synthetic_contact", "Simulator accepts synthetic contacts only.");
    }
    const identity = `${this.config.syntheticSeed}:${query.externalReportRef}`;
    const ready = deterministicBucket(identity, 2) === 1;
    return {
      state: ready ? "ready" : "not_ready",
      securePortalPath: ready ? `/synthetic/reports/${deterministicId("report", identity)}` : null,
      includesClinicalResult: false,
      simulated: true,
      networkCalls: 0,
    };
  }
}

export interface HemasSystemAdapters {
  readonly his: HemasHisAdapter;
  readonly lims: HemasLimsAdapter;
}

export function createHemasSystemAdapters(config: RuntimeConfig): HemasSystemAdapters {
  if (config.runtimeMode === "demo" && config.hemasIntegrationMode === "synthetic") {
    const synthetic = new SyntheticHemasAdapter(config);
    return { his: synthetic, lims: synthetic };
  }
  const disabled = new DisabledHemasAdapter(
    config.hemasIntegrationMode === "live"
      ? "Live Hemas configuration is present, but real HIS/LIMS adapters are intentionally not implemented."
      : "Hemas integrations are disabled.",
  );
  return { his: disabled, lims: disabled };
}
