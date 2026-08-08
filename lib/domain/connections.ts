/**
 * Authoritative, staff-safe connection-centre read model for the synthetic demo.
 *
 * The legacy `WhatsAppConnection` type in `workspaces.ts` remains available for
 * the page-local prototype. Persisted reads must use only the v1 contracts in
 * this module so raw provider identifiers, secret references and free-form
 * provider health details are not representable.
 */

export const DEMO_CONNECTION_WORKSPACE_ID = "workspace_safenet_demo" as const;
export const DEMO_WHATSAPP_CONNECTION_ID = "connection_demo_simulator" as const;

export const DEMO_INTEGRATION_IDS = [
  "integration_demo_his_simulator",
  "integration_demo_lims_simulator",
] as const;
export type DemoIntegrationId = (typeof DEMO_INTEGRATION_IDS)[number];

export const DEMO_EVIDENCE_SIGNAL_STATES = [
  "not_configured",
  "not_submitted",
  "unverified",
  "mock",
  "blocked",
  "not_available",
] as const;
export type DemoEvidenceSignalState = (typeof DEMO_EVIDENCE_SIGNAL_STATES)[number];

export const DEMO_EVIDENCE_SIGNAL_SOURCES = [
  "synthetic_fixture",
  "local_policy",
] as const;
export type DemoEvidenceSignalSource = (typeof DEMO_EVIDENCE_SIGNAL_SOURCES)[number];

export const DEMO_EVIDENCE_DETAIL_CODES = [
  "no_meta_waba",
  "no_provider_phone",
  "synthetic_ingress_only",
  "no_meta_app",
  "no_meta_permissions",
  "provider_approved_zero",
  "no_payment_configuration",
  "external_sending_disabled",
  "no_provider_quality",
  "no_provider_capacity",
  "no_real_device_canary",
  "deterministic_his_simulator_only",
  "deterministic_lims_simulator_only",
] as const;
export type DemoEvidenceDetailCode = (typeof DEMO_EVIDENCE_DETAIL_CODES)[number];

export interface DemoEvidenceSignalV1 {
  readonly state: DemoEvidenceSignalState;
  readonly source: DemoEvidenceSignalSource;
  readonly observedAt: string;
  readonly lastSuccessfulVerificationAt: null;
  readonly detailCode: DemoEvidenceDetailCode;
}

export const DEMO_WHATSAPP_SIGNAL_KEYS = [
  "waba",
  "phoneRegistration",
  "webhook",
  "appMode",
  "permissions",
  "templates",
  "payment",
  "sending",
  "quality",
  "capacity",
  "realDeviceCanary",
] as const;
export type DemoWhatsAppSignalKey = (typeof DEMO_WHATSAPP_SIGNAL_KEYS)[number];

type DemoEvidenceSignalBinding = Readonly<
  Pick<DemoEvidenceSignalV1, "state" | "source" | "detailCode">
>;

export const DEMO_WHATSAPP_SIGNAL_MATRIX = Object.freeze({
  waba: Object.freeze({
    state: "not_configured",
    source: "synthetic_fixture",
    detailCode: "no_meta_waba",
  }),
  phoneRegistration: Object.freeze({
    state: "not_configured",
    source: "synthetic_fixture",
    detailCode: "no_provider_phone",
  }),
  webhook: Object.freeze({
    state: "mock",
    source: "synthetic_fixture",
    detailCode: "synthetic_ingress_only",
  }),
  appMode: Object.freeze({
    state: "not_configured",
    source: "synthetic_fixture",
    detailCode: "no_meta_app",
  }),
  permissions: Object.freeze({
    state: "unverified",
    source: "synthetic_fixture",
    detailCode: "no_meta_permissions",
  }),
  templates: Object.freeze({
    state: "not_submitted",
    source: "synthetic_fixture",
    detailCode: "provider_approved_zero",
  }),
  payment: Object.freeze({
    state: "not_configured",
    source: "synthetic_fixture",
    detailCode: "no_payment_configuration",
  }),
  sending: Object.freeze({
    state: "blocked",
    source: "local_policy",
    detailCode: "external_sending_disabled",
  }),
  quality: Object.freeze({
    state: "not_available",
    source: "synthetic_fixture",
    detailCode: "no_provider_quality",
  }),
  capacity: Object.freeze({
    state: "not_available",
    source: "synthetic_fixture",
    detailCode: "no_provider_capacity",
  }),
  realDeviceCanary: Object.freeze({
    state: "blocked",
    source: "local_policy",
    detailCode: "no_real_device_canary",
  }),
} as const satisfies Readonly<Record<DemoWhatsAppSignalKey, DemoEvidenceSignalBinding>>);

export type DemoWhatsAppEvidenceMatrixV1 = Readonly<{
  [Key in DemoWhatsAppSignalKey]: DemoEvidenceSignalV1 &
    Readonly<{
      state: (typeof DEMO_WHATSAPP_SIGNAL_MATRIX)[Key]["state"];
      source: (typeof DEMO_WHATSAPP_SIGNAL_MATRIX)[Key]["source"];
      detailCode: (typeof DEMO_WHATSAPP_SIGNAL_MATRIX)[Key]["detailCode"];
    }>;
}>;

export interface StaffSafeWhatsAppConnectionV1 {
  readonly id: typeof DEMO_WHATSAPP_CONNECTION_ID;
  readonly workspaceId: typeof DEMO_CONNECTION_WORKSPACE_ID;
  readonly displayName: "Local WhatsApp journey simulator";
  readonly provider: "simulator";
  readonly environment: "demo";
  readonly status: "mock";
  readonly maskedNumber: "No external number";
  readonly maskedWabaId: null;
  readonly maskedPhoneNumberId: null;
  readonly credentialState: "not_configured";
  readonly externalMessagingEnabled: false;
  readonly networkCallsEnabled: false;
  readonly signals: DemoWhatsAppEvidenceMatrixV1;
  readonly sortKey: "01_whatsapp_simulator";
  readonly synthetic: true;
  readonly schemaVersion: 1;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const DEMO_INTEGRATION_BINDINGS = Object.freeze({
  integration_demo_his_simulator: Object.freeze({
    kind: "appointment_his",
    displayName: "Local appointment HIS simulator",
    sortKey: "01_his_simulator",
    detailCode: "deterministic_his_simulator_only",
  }),
  integration_demo_lims_simulator: Object.freeze({
    kind: "laboratory_lims",
    displayName: "Local laboratory LIMS simulator",
    sortKey: "02_lims_simulator",
    detailCode: "deterministic_lims_simulator_only",
  }),
} as const);

export type DemoIntegrationKind =
  (typeof DEMO_INTEGRATION_BINDINGS)[DemoIntegrationId]["kind"];

type StaffSafeIntegrationFor<Id extends DemoIntegrationId> = {
  readonly id: Id;
  readonly workspaceId: typeof DEMO_CONNECTION_WORKSPACE_ID;
  readonly kind: (typeof DEMO_INTEGRATION_BINDINGS)[Id]["kind"];
  readonly displayName: (typeof DEMO_INTEGRATION_BINDINGS)[Id]["displayName"];
  readonly environment: "demo";
  readonly adapterMode: "synthetic";
  readonly status: "mock";
  readonly credentialState: "not_configured";
  readonly externalNetworkEnabled: false;
  readonly authoritativeSystemWriteEnabled: false;
  readonly lastSyncAt: null;
  readonly evidence: DemoEvidenceSignalV1 &
    Readonly<{
      state: "mock";
      source: "synthetic_fixture";
      detailCode: (typeof DEMO_INTEGRATION_BINDINGS)[Id]["detailCode"];
    }>;
  readonly sortKey: (typeof DEMO_INTEGRATION_BINDINGS)[Id]["sortKey"];
  readonly synthetic: true;
  readonly schemaVersion: 1;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type StaffSafeIntegrationV1 = {
  [Id in DemoIntegrationId]: StaffSafeIntegrationFor<Id>;
}[DemoIntegrationId];

export interface DemoConnectionCentreV1 {
  readonly whatsappConnections: readonly StaffSafeWhatsAppConnectionV1[];
  readonly integrations: readonly StaffSafeIntegrationV1[];
}

const SIGNAL_KEYS = [
  "state",
  "source",
  "observedAt",
  "lastSuccessfulVerificationAt",
  "detailCode",
] as const;
const WHATSAPP_CONNECTION_KEYS = [
  "id",
  "workspaceId",
  "displayName",
  "provider",
  "environment",
  "status",
  "maskedNumber",
  "maskedWabaId",
  "maskedPhoneNumberId",
  "credentialState",
  "externalMessagingEnabled",
  "networkCallsEnabled",
  "signals",
  "sortKey",
  "synthetic",
  "schemaVersion",
  "createdAt",
  "updatedAt",
] as const;
const INTEGRATION_KEYS = [
  "id",
  "workspaceId",
  "kind",
  "displayName",
  "environment",
  "adapterMode",
  "status",
  "credentialState",
  "externalNetworkEnabled",
  "authoritativeSystemWriteEnabled",
  "lastSyncAt",
  "evidence",
  "sortKey",
  "synthetic",
  "schemaVersion",
  "createdAt",
  "updatedAt",
] as const;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: unknown,
  expected: readonly string[],
  label: string,
): asserts value is Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  const keys = Object.keys(value);
  const expectedSet = new Set(expected);
  if (keys.length !== expected.length || keys.some((key) => !expectedSet.has(key))) {
    throw new Error(`${label} must use its exact staff-safe v1 keys.`);
  }
}

function timestampMillis(value: unknown, label: string): number {
  if (typeof value !== "string") throw new Error(`${label} must be an ISO timestamp.`);
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== value) {
    throw new Error(`${label} must be a canonical millisecond ISO timestamp.`);
  }
  return millis;
}

function assertLiteral(value: unknown, expected: unknown, label: string): void {
  if (value !== expected) throw new Error(`${label} does not match the synthetic demo contract.`);
}

export function assertDemoEvidenceSignalV1(
  value: unknown,
  expected: DemoEvidenceSignalBinding,
  label = "Connection evidence signal",
): asserts value is DemoEvidenceSignalV1 {
  assertExactKeys(value, SIGNAL_KEYS, label);
  assertLiteral(value.state, expected.state, `${label} state`);
  assertLiteral(value.source, expected.source, `${label} source`);
  assertLiteral(value.detailCode, expected.detailCode, `${label} detail code`);
  assertLiteral(
    value.lastSuccessfulVerificationAt,
    null,
    `${label} successful-verification time`,
  );
  timestampMillis(value.observedAt, `${label} observedAt`);
}

export function assertStaffSafeWhatsAppConnectionV1(
  value: unknown,
): asserts value is StaffSafeWhatsAppConnectionV1 {
  assertExactKeys(value, WHATSAPP_CONNECTION_KEYS, "WhatsApp connection");
  assertLiteral(value.id, DEMO_WHATSAPP_CONNECTION_ID, "WhatsApp connection ID");
  assertLiteral(value.workspaceId, DEMO_CONNECTION_WORKSPACE_ID, "WhatsApp workspace ID");
  assertLiteral(value.displayName, "Local WhatsApp journey simulator", "WhatsApp display name");
  assertLiteral(value.provider, "simulator", "WhatsApp provider");
  assertLiteral(value.environment, "demo", "WhatsApp environment");
  assertLiteral(value.status, "mock", "WhatsApp status");
  assertLiteral(value.maskedNumber, "No external number", "WhatsApp masked number");
  assertLiteral(value.maskedWabaId, null, "WhatsApp masked WABA ID");
  assertLiteral(value.maskedPhoneNumberId, null, "WhatsApp masked phone-number ID");
  assertLiteral(value.credentialState, "not_configured", "WhatsApp credential state");
  assertLiteral(value.externalMessagingEnabled, false, "WhatsApp external messaging gate");
  assertLiteral(value.networkCallsEnabled, false, "WhatsApp network-call gate");
  assertLiteral(value.sortKey, "01_whatsapp_simulator", "WhatsApp sort key");
  assertLiteral(value.synthetic, true, "WhatsApp synthetic marker");
  assertLiteral(value.schemaVersion, 1, "WhatsApp schema version");

  assertExactKeys(value.signals, DEMO_WHATSAPP_SIGNAL_KEYS, "WhatsApp evidence matrix");
  const createdAt = timestampMillis(value.createdAt, "WhatsApp createdAt");
  const updatedAt = timestampMillis(value.updatedAt, "WhatsApp updatedAt");
  if (createdAt > updatedAt) throw new Error("WhatsApp connection timestamps are not monotonic.");

  for (const key of DEMO_WHATSAPP_SIGNAL_KEYS) {
    const signal = value.signals[key];
    assertDemoEvidenceSignalV1(signal, DEMO_WHATSAPP_SIGNAL_MATRIX[key], `WhatsApp ${key}`);
    const observedAt = timestampMillis(signal.observedAt, `WhatsApp ${key} observedAt`);
    if (observedAt < createdAt || observedAt > updatedAt) {
      throw new Error(`WhatsApp ${key} evidence is outside the entity chronology.`);
    }
  }
}

export function assertStaffSafeIntegrationV1(
  value: unknown,
): asserts value is StaffSafeIntegrationV1 {
  assertExactKeys(value, INTEGRATION_KEYS, "Integration");
  if (
    typeof value.id !== "string" ||
    !DEMO_INTEGRATION_IDS.includes(value.id as DemoIntegrationId)
  ) {
    throw new Error("Integration ID is outside the frozen synthetic catalogue.");
  }
  const id = value.id as DemoIntegrationId;
  const binding = DEMO_INTEGRATION_BINDINGS[id];

  assertLiteral(value.workspaceId, DEMO_CONNECTION_WORKSPACE_ID, "Integration workspace ID");
  assertLiteral(value.kind, binding.kind, "Integration kind");
  assertLiteral(value.displayName, binding.displayName, "Integration display name");
  assertLiteral(value.environment, "demo", "Integration environment");
  assertLiteral(value.adapterMode, "synthetic", "Integration adapter mode");
  assertLiteral(value.status, "mock", "Integration status");
  assertLiteral(value.credentialState, "not_configured", "Integration credential state");
  assertLiteral(value.externalNetworkEnabled, false, "Integration network gate");
  assertLiteral(
    value.authoritativeSystemWriteEnabled,
    false,
    "Integration authoritative-write gate",
  );
  assertLiteral(value.lastSyncAt, null, "Integration last sync time");
  assertLiteral(value.sortKey, binding.sortKey, "Integration sort key");
  assertLiteral(value.synthetic, true, "Integration synthetic marker");
  assertLiteral(value.schemaVersion, 1, "Integration schema version");
  assertDemoEvidenceSignalV1(
    value.evidence,
    {
      state: "mock",
      source: "synthetic_fixture",
      detailCode: binding.detailCode,
    },
    "Integration evidence",
  );

  const createdAt = timestampMillis(value.createdAt, "Integration createdAt");
  const observedAt = timestampMillis(value.evidence.observedAt, "Integration evidence observedAt");
  const updatedAt = timestampMillis(value.updatedAt, "Integration updatedAt");
  if (createdAt > observedAt || observedAt > updatedAt) {
    throw new Error("Integration evidence is outside the entity chronology.");
  }
}

export function assertDemoConnectionCentreV1(
  value: unknown,
): asserts value is DemoConnectionCentreV1 {
  assertExactKeys(value, ["whatsappConnections", "integrations"], "Connection centre");
  if (!Array.isArray(value.whatsappConnections) || !Array.isArray(value.integrations)) {
    throw new Error("Connection centre inventories must be arrays.");
  }
  const isHonestlyEmpty =
    value.whatsappConnections.length === 0 && value.integrations.length === 0;
  if (isHonestlyEmpty) return;
  if (value.whatsappConnections.length !== 1 || value.integrations.length !== 2) {
    throw new Error(
      "Connection centre requires either an empty inventory or the complete frozen demo inventory.",
    );
  }

  for (const connection of value.whatsappConnections) {
    assertStaffSafeWhatsAppConnectionV1(connection);
  }
  for (const integration of value.integrations) assertStaffSafeIntegrationV1(integration);

  const integrationIds = value.integrations.map((integration) => integration.id);
  const integrationSortKeys = value.integrations.map((integration) => integration.sortKey);
  if (
    new Set(integrationIds).size !== integrationIds.length ||
    new Set(integrationSortKeys).size !== integrationSortKeys.length ||
    integrationIds.some((id, index) => id !== DEMO_INTEGRATION_IDS[index]) ||
    integrationSortKeys.some(
      (sortKey, index) => index > 0 && integrationSortKeys[index - 1]! >= sortKey,
    )
  ) {
    throw new Error("Connection-centre integration identity or sort order is invalid.");
  }
}
