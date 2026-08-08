import {
  Timestamp,
  doc,
  getDocFromServer,
  type Firestore,
} from "firebase/firestore";
import { z } from "zod";

import {
  DEMO_CONNECTION_WORKSPACE_ID,
  DEMO_EVIDENCE_DETAIL_CODES,
  DEMO_EVIDENCE_SIGNAL_SOURCES,
  DEMO_EVIDENCE_SIGNAL_STATES,
  DEMO_INTEGRATION_IDS,
  DEMO_WHATSAPP_CONNECTION_ID,
  assertDemoConnectionCentreV1,
  assertStaffSafeIntegrationV1,
  assertStaffSafeWhatsAppConnectionV1,
  type DemoConnectionCentreV1,
  type DemoEvidenceSignalV1,
  type StaffSafeIntegrationV1,
  type StaffSafeWhatsAppConnectionV1,
} from "../../domain/connections";

const nativeTimestamp = z.custom<Timestamp>(
  (value) =>
    value instanceof Timestamp &&
    Number.isInteger(value.seconds) &&
    Number.isInteger(value.nanoseconds) &&
    value.nanoseconds % 1_000_000 === 0,
  "Expected a millisecond-aligned native Firestore Timestamp",
);

const evidenceSignalSchema = z
  .object({
    state: z.enum(DEMO_EVIDENCE_SIGNAL_STATES),
    source: z.enum(DEMO_EVIDENCE_SIGNAL_SOURCES),
    observedAt: nativeTimestamp,
    lastSuccessfulVerificationAt: z.null(),
    detailCode: z.enum(DEMO_EVIDENCE_DETAIL_CODES),
  })
  .strict();

const whatsappConnectionDocumentSchema = z
  .object({
    id: z.literal(DEMO_WHATSAPP_CONNECTION_ID),
    workspaceId: z.literal(DEMO_CONNECTION_WORKSPACE_ID),
    displayName: z.literal("Local WhatsApp journey simulator"),
    provider: z.literal("simulator"),
    environment: z.literal("demo"),
    status: z.literal("mock"),
    maskedNumber: z.literal("No external number"),
    maskedWabaId: z.null(),
    maskedPhoneNumberId: z.null(),
    credentialState: z.literal("not_configured"),
    externalMessagingEnabled: z.literal(false),
    networkCallsEnabled: z.literal(false),
    signals: z
      .object({
        waba: evidenceSignalSchema,
        phoneRegistration: evidenceSignalSchema,
        webhook: evidenceSignalSchema,
        appMode: evidenceSignalSchema,
        permissions: evidenceSignalSchema,
        templates: evidenceSignalSchema,
        payment: evidenceSignalSchema,
        sending: evidenceSignalSchema,
        quality: evidenceSignalSchema,
        capacity: evidenceSignalSchema,
        realDeviceCanary: evidenceSignalSchema,
      })
      .strict(),
    sortKey: z.literal("01_whatsapp_simulator"),
    synthetic: z.literal(true),
    schemaVersion: z.literal(1),
    createdAt: nativeTimestamp,
    updatedAt: nativeTimestamp,
  })
  .strict();

const integrationDocumentSchema = z
  .object({
    id: z.enum(DEMO_INTEGRATION_IDS),
    workspaceId: z.literal(DEMO_CONNECTION_WORKSPACE_ID),
    kind: z.enum(["appointment_his", "laboratory_lims"]),
    displayName: z.enum([
      "Local appointment HIS simulator",
      "Local laboratory LIMS simulator",
    ]),
    environment: z.literal("demo"),
    adapterMode: z.literal("synthetic"),
    status: z.literal("mock"),
    credentialState: z.literal("not_configured"),
    externalNetworkEnabled: z.literal(false),
    authoritativeSystemWriteEnabled: z.literal(false),
    lastSyncAt: z.null(),
    evidence: evidenceSignalSchema,
    sortKey: z.enum(["01_his_simulator", "02_lims_simulator"]),
    synthetic: z.literal(true),
    schemaVersion: z.literal(1),
    createdAt: nativeTimestamp,
    updatedAt: nativeTimestamp,
  })
  .strict();

const loadInputSchema = z
  .object({ workspaceId: z.literal(DEMO_CONNECTION_WORKSPACE_ID) })
  .strict();

export interface LoadDemoConnectionCentreInput {
  readonly workspaceId: typeof DEMO_CONNECTION_WORKSPACE_ID;
}

export class ConnectionRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_input" | "invalid_persisted_data",
  ) {
    super(message);
    this.name = "ConnectionRepositoryError";
  }
}

function parseInput(value: unknown): LoadDemoConnectionCentreInput {
  const parsed = loadInputSchema.safeParse(value);
  if (!parsed.success) {
    throw new ConnectionRepositoryError(
      "Connection-centre input failed strict demo validation.",
      "invalid_input",
    );
  }
  return parsed.data;
}

function timestampToIso(value: Timestamp): string {
  return value.toDate().toISOString();
}

function freezeEvidence(
  value: z.infer<typeof evidenceSignalSchema>,
): DemoEvidenceSignalV1 {
  return Object.freeze({
    ...value,
    observedAt: timestampToIso(value.observedAt),
  });
}

function parseWhatsAppConnection(
  value: unknown,
  documentId: string,
  workspaceId: string,
): StaffSafeWhatsAppConnectionV1 {
  const parsed = whatsappConnectionDocumentSchema.safeParse(value);
  if (!parsed.success) {
    throw new ConnectionRepositoryError(
      "WhatsApp connection failed strict staff-safe v1 validation.",
      "invalid_persisted_data",
    );
  }
  if (parsed.data.id !== documentId || parsed.data.workspaceId !== workspaceId) {
    throw new ConnectionRepositoryError(
      "WhatsApp connection identity does not match its workspace document path.",
      "invalid_persisted_data",
    );
  }

  const signals = Object.freeze(
    Object.fromEntries(
      Object.entries(parsed.data.signals).map(([key, signal]) => [
        key,
        freezeEvidence(signal),
      ]),
    ),
  ) as StaffSafeWhatsAppConnectionV1["signals"];
  const dto: StaffSafeWhatsAppConnectionV1 = Object.freeze({
    ...parsed.data,
    signals,
    createdAt: timestampToIso(parsed.data.createdAt),
    updatedAt: timestampToIso(parsed.data.updatedAt),
  });

  try {
    assertStaffSafeWhatsAppConnectionV1(dto);
  } catch {
    throw new ConnectionRepositoryError(
      "WhatsApp connection failed governed demo invariants.",
      "invalid_persisted_data",
    );
  }
  return dto;
}

function parseIntegration(
  value: unknown,
  documentId: string,
  workspaceId: string,
): StaffSafeIntegrationV1 {
  const parsed = integrationDocumentSchema.safeParse(value);
  if (!parsed.success) {
    throw new ConnectionRepositoryError(
      "Integration failed strict staff-safe v1 validation.",
      "invalid_persisted_data",
    );
  }
  if (parsed.data.id !== documentId || parsed.data.workspaceId !== workspaceId) {
    throw new ConnectionRepositoryError(
      "Integration identity does not match its workspace document path.",
      "invalid_persisted_data",
    );
  }

  const dto = Object.freeze({
    ...parsed.data,
    evidence: freezeEvidence(parsed.data.evidence),
    createdAt: timestampToIso(parsed.data.createdAt),
    updatedAt: timestampToIso(parsed.data.updatedAt),
  });
  try {
    assertStaffSafeIntegrationV1(dto);
  } catch {
    throw new ConnectionRepositoryError(
      "Integration failed governed demo invariants.",
      "invalid_persisted_data",
    );
  }
  return dto;
}

/**
 * Loads only the three frozen local-demo records through authoritative no-cache
 * Web SDK exact gets issued concurrently. The repository performs no list,
 * write, index-dependent or provider operation.
 */
export async function loadDemoConnectionCentre(
  db: Firestore,
  rawInput: LoadDemoConnectionCentreInput,
): Promise<DemoConnectionCentreV1> {
  const input = parseInput(rawInput);
  const [whatsappSnapshot, hisSnapshot, limsSnapshot] = await Promise.all([
    getDocFromServer(
      doc(
        db,
        "workspaces",
        input.workspaceId,
        "whatsappConnections",
        DEMO_WHATSAPP_CONNECTION_ID,
      ),
    ),
    getDocFromServer(
      doc(
        db,
        "workspaces",
        input.workspaceId,
        "integrations",
        DEMO_INTEGRATION_IDS[0],
      ),
    ),
    getDocFromServer(
      doc(
        db,
        "workspaces",
        input.workspaceId,
        "integrations",
        DEMO_INTEGRATION_IDS[1],
      ),
    ),
  ]);

  const whatsappConnection = whatsappSnapshot.exists()
    ? parseWhatsAppConnection(
        whatsappSnapshot.data(),
        whatsappSnapshot.id,
        input.workspaceId,
      )
    : null;
  const hisIntegration = hisSnapshot.exists()
    ? parseIntegration(hisSnapshot.data(), hisSnapshot.id, input.workspaceId)
    : null;
  const limsIntegration = limsSnapshot.exists()
    ? parseIntegration(limsSnapshot.data(), limsSnapshot.id, input.workspaceId)
    : null;

  const foundCount = [
    whatsappConnection,
    hisIntegration,
    limsIntegration,
  ].filter((value) => value !== null).length;
  if (foundCount !== 0 && foundCount !== 3) {
    throw new ConnectionRepositoryError(
      "Connection centre contains a partial synthetic inventory.",
      "invalid_persisted_data",
    );
  }

  const whatsappConnections = Object.freeze(
    whatsappConnection === null ? [] : [whatsappConnection],
  );
  const integrations = Object.freeze(
    hisIntegration === null || limsIntegration === null
      ? []
      : [hisIntegration, limsIntegration],
  );

  const result: DemoConnectionCentreV1 = Object.freeze({
    whatsappConnections,
    integrations,
  });
  try {
    assertDemoConnectionCentreV1(result);
  } catch {
    throw new ConnectionRepositoryError(
      "Connection centre failed its exact synthetic inventory contract.",
      "invalid_persisted_data",
    );
  }
  return result;
}
