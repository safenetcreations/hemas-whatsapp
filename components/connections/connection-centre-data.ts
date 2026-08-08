import {
  DEMO_CONNECTION_WORKSPACE_ID,
  DEMO_WHATSAPP_SIGNAL_KEYS,
  assertDemoConnectionCentreV1,
  type DemoConnectionCentreV1,
  type DemoWhatsAppSignalKey,
} from "@/lib/domain/connections";
import { hasPermission } from "@/lib/domain/access-control";
import type { VerifiedWorkspaceSession } from "@/lib/firebase/workspace-session-model";

export type ConnectionCentreAccess = "allowed" | "denied";

/**
 * Mirrors the registered portal policy and narrows it to the frozen local
 * catalogue. A verified session is still rechecked here so rendering this
 * component outside PortalPermissionGate cannot start a privileged read.
 */
export function connectionCentreAccess(
  session: VerifiedWorkspaceSession,
): ConnectionCentreAccess {
  return session.workspaceId === DEMO_CONNECTION_WORKSPACE_ID &&
    session.role === "tenant_admin" &&
    hasPermission(session.role, "workspace.view_connections") &&
    (session.workspaceMode === "demo" || session.workspaceMode === "local") &&
    session.dataClassification === "synthetic_only"
    ? "allowed"
    : "denied";
}

export function connectionCentreAuthorityKey(
  session: VerifiedWorkspaceSession,
): string {
  return [
    session.workspaceId,
    session.uid,
    session.role,
    session.scopeMode,
    session.workspaceMode,
    session.dataClassification,
    session.teamIds.join("\u001f"),
    session.locationIds.join("\u001f"),
  ].join("\u001e");
}

export class ConnectionCentreClientError extends Error {
  constructor(
    message: string,
    readonly code: "access_denied" | "invalid_response",
  ) {
    super(message);
    this.name = "ConnectionCentreClientError";
  }
}

export function validateConnectionCentreResult(
  value: unknown,
): DemoConnectionCentreV1 {
  try {
    assertDemoConnectionCentreV1(value);
  } catch {
    throw new ConnectionCentreClientError(
      "Connection-centre response failed the governed synthetic v1 contract.",
      "invalid_response",
    );
  }
  return value;
}

export type ConnectionCentreSummary = {
  readonly mockWhatsAppSimulators: number;
  readonly mockSystemSimulators: number;
  readonly externalProviderConnections: number;
  readonly externalSendingEnabled: boolean;
  readonly externalNetworkEnabled: boolean;
  readonly authoritativeWritesEnabled: boolean;
};

/** Derives every visible count and gate from the validated persisted DTOs. */
export function deriveConnectionCentreSummary(
  value: unknown,
): ConnectionCentreSummary {
  const inventory = validateConnectionCentreResult(value);
  const mockWhatsAppSimulators = inventory.whatsappConnections.filter(
    (connection) => connection.status === "mock",
  ).length;
  const mockSystemSimulators = inventory.integrations.filter(
    (integration) => integration.status === "mock",
  ).length;
  const externalSendingEnabled = inventory.whatsappConnections.some(
    (connection) => connection.externalMessagingEnabled,
  );
  const externalNetworkEnabled =
    inventory.whatsappConnections.some(
      (connection) => connection.networkCallsEnabled,
    ) ||
    inventory.integrations.some(
      (integration) => integration.externalNetworkEnabled,
    );
  const authoritativeWritesEnabled = inventory.integrations.some(
    (integration) => integration.authoritativeSystemWriteEnabled,
  );
  const externalProviderConnections =
    inventory.whatsappConnections.filter(
      (connection) =>
        connection.externalMessagingEnabled || connection.networkCallsEnabled,
    ).length +
    inventory.integrations.filter(
      (integration) =>
        integration.externalNetworkEnabled ||
        integration.authoritativeSystemWriteEnabled,
    ).length;

  return Object.freeze({
    mockWhatsAppSimulators,
    mockSystemSimulators,
    externalProviderConnections,
    externalSendingEnabled,
    externalNetworkEnabled,
    authoritativeWritesEnabled,
  });
}

function errorCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return "";
  }
  return String(error.code);
}

export type ConnectionCentreFailure = {
  readonly status: "denied" | "invalid_response" | "error";
  readonly message: string;
};

export function connectionCentreFailure(error: unknown): ConnectionCentreFailure {
  const code =
    error instanceof ConnectionCentreClientError ? error.code : errorCode(error);
  if (
    code === "access_denied" ||
    code.includes("permission-denied") ||
    code.includes("unauthenticated")
  ) {
    return {
      status: "denied",
      message:
        "The authoritative local inventory read was denied. No cached or fixture data is shown.",
    };
  }
  if (
    code === "invalid_response" ||
    code === "invalid_input" ||
    code === "invalid_persisted_data"
  ) {
    return {
      status: "invalid_response",
      message:
        "The persisted synthetic v1 inventory failed strict validation. No partial or fallback data is shown.",
    };
  }
  return {
    status: "error",
    message:
      "The authoritative local Firestore inventory is unavailable. No cached, fixture, cloud, or provider fallback was attempted.",
  };
}

export const connectionSignalLabels = Object.freeze({
  waba: "Business account",
  phoneRegistration: "Phone registration",
  webhook: "Inbound webhook",
  appMode: "Application mode",
  permissions: "Account permissions",
  templates: "Message templates",
  payment: "Payment configuration",
  sending: "External sending",
  quality: "Quality evidence",
  capacity: "Messaging capacity",
  realDeviceCanary: "Real-device canary",
} satisfies Readonly<Record<DemoWhatsAppSignalKey, string>>);

export const orderedConnectionSignalKeys: readonly DemoWhatsAppSignalKey[] =
  DEMO_WHATSAPP_SIGNAL_KEYS;

export const NEVER_VERIFIED_LABEL = "Never verified" as const;
