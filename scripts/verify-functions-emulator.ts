export {};

import { createHash } from "node:crypto";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { getHemasFirestore } from "../lib/firebase/firestore-target";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const CAMPAIGN_EVENT_FIELDS = [
  "action",
  "actorUid",
  "campaignId",
  "checkpointId",
  "createdAt",
  "externalCalls",
  "fromState",
  "id",
  "networkCalls",
  "revision",
  "schemaVersion",
  "synthetic",
  "toState",
  "workspaceId",
] as const;
const CAMPAIGN_CHECKPOINT_FIELDS = [
  "batchIndex",
  "campaignId",
  "createdAt",
  "digest",
  "eligibleCount",
  "eventId",
  "externalCalls",
  "id",
  "languageCounts",
  "networkCalls",
  "processedEligible",
  "scanComplete",
  "schemaVersion",
  "sourceOffsetEnd",
  "sourceOffsetStart",
  "synthetic",
  "workspaceId",
] as const;
const CAMPAIGN_AUDIT_FIELDS = [
  "action",
  "actorType",
  "actorUid",
  "createdAt",
  "id",
  "metadata",
  "occurredAt",
  "outcome",
  "requestId",
  "resourceId",
  "resourceType",
  "schemaVersion",
  "synthetic",
  "workspaceId",
] as const;
const CAMPAIGN_AUDIT_METADATA_FIELDS = [
  "batchEligibleCount",
  "campaignAction",
  "checkpointId",
  "dispatchMode",
  "externalCalls",
  "fromState",
  "networkCalls",
  "processedEligible",
  "purpose",
  "revision",
  "scanOffset",
  "synthetic",
  "toState",
] as const;
const CAMPAIGN_RESULT_FIELDS = [
  "action",
  "batchEligibleCount",
  "campaignId",
  "canaryStatus",
  "checkpointId",
  "eventId",
  "externalCalls",
  "networkCalls",
  "nextBatchIndex",
  "processedEligible",
  "revision",
  "scanOffset",
  "state",
  "synthetic",
] as const;

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index]);
}

function timestampMillis(value: unknown): number | null {
  if (
    value &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof value.toMillis === "function"
  ) {
    const millis = value.toMillis();
    return typeof millis === "number" && Number.isFinite(millis) ? millis : null;
  }
  return null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function deterministicId(prefix: string, value: string): string {
  return `${prefix}-${sha256(value).slice(0, 24)}`;
}

function callableErrorCode(error: unknown): string {
  return typeof error === "object" && error && "code" in error
    ? String(error.code)
    : "";
}

type SyntheticLanguage = "en" | "si" | "ta";

function syntheticLanguageAt(ordinal: number): SyntheticLanguage {
  let value = (20_260_807 ^ Math.imul(ordinal + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  value ^= value >>> 16;
  const bucket = (value >>> 0) % 100;
  if (bucket < 54) return "en";
  if (bucket < 78) return "si";
  return "ta";
}

function syntheticOrdinalIsEligible(ordinal: number): boolean {
  const sourceOrdinal = ordinal + 1;
  return sourceOrdinal % 113 !== 0 &&
    sourceOrdinal % 17 !== 0 &&
    sourceOrdinal % 13 !== 0 &&
    sourceOrdinal % 97 !== 0 &&
    sourceOrdinal % 11 !== 0 &&
    sourceOrdinal % 131 !== 0;
}

function canonicalCampaignBatch(input: {
  sourceOffsetStart: number;
  batchIndex: number;
  workspaceId: string;
  campaignId: string;
  snapshotContentHash: string;
  approvalHash: string;
}): {
  sourceOffsetStart: number;
  sourceOffsetEnd: number;
  eligibleCount: number;
  languageCounts: Record<SyntheticLanguage, number>;
  scanComplete: boolean;
  digest: string;
} {
  const digestScope = [
    input.workspaceId,
    input.campaignId,
    input.snapshotContentHash,
    input.approvalHash,
    input.batchIndex,
  ].join(":");
  const hash = createHash("sha256");
  hash.update(`campaign-eligible-batch-v1\n${digestScope}\n`);
  const languageCounts: Record<SyntheticLanguage, number> = { en: 0, si: 0, ta: 0 };
  let sourceOffsetEnd = input.sourceOffsetStart;
  let eligibleCount = 0;
  while (sourceOffsetEnd < 50_000 && eligibleCount < 1_000) {
    const ordinal = sourceOffsetEnd;
    sourceOffsetEnd += 1;
    if (!syntheticOrdinalIsEligible(ordinal)) continue;
    const language = syntheticLanguageAt(ordinal);
    eligibleCount += 1;
    languageCounts[language] += 1;
    hash.update(`${ordinal}:${language}\n`);
  }
  const scanComplete = sourceOffsetEnd === 50_000;
  hash.update(
    `source:${input.sourceOffsetStart}:${sourceOffsetEnd};eligible:${eligibleCount};complete:${scanComplete}`,
  );
  return {
    sourceOffsetStart: input.sourceOffsetStart,
    sourceOffsetEnd,
    eligibleCount,
    languageCounts,
    scanComplete,
    digest: hash.digest("hex"),
  };
}

const projectId = process.env.GCLOUD_PROJECT ?? "demo-hemas-connect";
const emulatorHost = process.env.FUNCTIONS_EMULATOR_HOST ?? "127.0.0.1:5001";
const endpoint = new URL(
  `http://${emulatorHost}/${projectId}/us-central1/hemasConnectReadiness`,
);

if (projectId !== "demo-hemas-connect") {
  throw new Error("Refusing readiness verification outside the emulator-safe demo project.");
}
if (endpoint.hostname !== "127.0.0.1" && endpoint.hostname !== "localhost") {
  throw new Error("Refusing to call a non-loopback Functions endpoint.");
}
const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (!authEmulatorHost || !firestoreEmulatorHost) {
  throw new Error("Auth and Firestore emulators are required for service verification.");
}
for (const host of [authEmulatorHost, firestoreEmulatorHost]) {
  const target = new URL(`http://${host}`);
  if (target.hostname !== "127.0.0.1" && target.hostname !== "localhost") {
    throw new Error("Refusing service verification against a non-loopback emulator.");
  }
}

const getResponse = await fetch(endpoint, {
  headers: { Accept: "application/json" },
  signal: AbortSignal.timeout(5_000),
});
const readiness = await getResponse.json() as {
  status?: string;
  safeMode?: boolean;
  runtimeMode?: string;
  checks?: {
    outboundNetwork?: string;
    medicalDiagnosis?: string;
    whatsapp?: string;
    hemasSystems?: string;
  };
};

if (
  getResponse.status !== 200 ||
  readiness.status !== "ready" ||
  readiness.safeMode !== true ||
  readiness.runtimeMode !== "demo" ||
  readiness.checks?.outboundNetwork !== "blocked" ||
  readiness.checks?.medicalDiagnosis !== "disabled" ||
  readiness.checks?.whatsapp !== "synthetic" ||
  readiness.checks?.hemasSystems !== "synthetic"
) {
  throw new Error("Functions emulator readiness response failed the safe-demo contract.");
}

const postResponse = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
  signal: AbortSignal.timeout(5_000),
});
const postBody = await postResponse.json() as { status?: string; safeMode?: boolean };
if (
  postResponse.status !== 405 ||
  postBody.status !== "method_not_allowed" ||
  postBody.safeMode !== true
) {
  throw new Error("Functions emulator did not reject a non-GET readiness request.");
}

const verifierApp = initializeApp(
  {
    apiKey: "demo-api-key",
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
    appId: "demo-functions-verifier",
  },
  "synthetic-functions-verifier",
);

try {
  const authEndpoint = new URL(`http://${authEmulatorHost}`);
  const auth = getAuth(verifierApp);
  connectAuthEmulator(auth, authEndpoint.origin, { disableWarnings: true });
  const credential = await signInWithEmailAndPassword(
    auth,
    "demo.admin@synthetic.invalid",
    process.env.DEMO_ADMIN_PASSWORD ?? "Synthetic-Demo-Only-2026!",
  );

  const functions = getFunctions(verifierApp, "us-central1");
  connectFunctionsEmulator(functions, endpoint.hostname, Number(endpoint.port));
  const appendNote = httpsCallable<
    {
      workspaceId: string;
      conversationId: string;
      teamId: string;
      locationId: string;
      noteKind: "handoff_context" | "appointment_context" | "safety_context";
      idempotencyKey: string;
    },
    {
      result: { noteId: string; conversationId: string; noteKind: string };
      auditEventId: string;
      replayed: boolean;
    }
  >(functions, "demoAppendInternalNote");
  const request = {
    workspaceId: "workspace_safenet_demo",
    conversationId: "conversation_synthetic_appointment",
    teamId: "team_demo_general",
    locationId: "location_demo_wattala",
    noteKind: "handoff_context" as const,
    idempotencyKey: "functions-verifier-note-0001",
  };
  const first = await appendNote(request);
  const replay = await appendNote(request);
  if (
    first.data.replayed !== false ||
    replay.data.replayed !== true ||
    first.data.result.noteId !== replay.data.result.noteId ||
    first.data.auditEventId !== replay.data.auditEventId
  ) {
    throw new Error("Authenticated mutation idempotency contract failed.");
  }

  let conflictDenied = false;
  try {
    await appendNote({
      ...request,
      noteKind: "safety_context",
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";
    conflictDenied = code.includes("permission-denied");
  }
  if (!conflictDenied) {
    throw new Error("Changed request reuse of an idempotency key was not denied.");
  }

  const requestAppointment = httpsCallable<
    {
      workspaceId: string;
      appointmentId: string;
      teamId: string;
      locationId: string;
      action: "request_reschedule" | "request_cancellation";
      expectedRevision: number;
      idempotencyKey: string;
    },
    {
      result: {
        appointmentId: string;
        eventId: string;
        action: string;
        status: string;
        syncState: string;
        authoritativeSystem: string;
        revision: number;
        synthetic: boolean;
        externalCalls: number;
      };
      auditEventId: string;
      replayed: boolean;
    }
  >(functions, "demoRequestSyntheticAppointment");
  const appointmentRequest = {
    workspaceId: "workspace_safenet_demo",
    appointmentId: "appointment_synthetic_001",
    teamId: "team_demo_general",
    locationId: "location_demo_wattala",
    action: "request_reschedule" as const,
    expectedRevision: 0,
    idempotencyKey: "functions-verifier-appointment-0001",
  };
  const appointmentFirst = await requestAppointment(appointmentRequest);
  const appointmentReplay = await requestAppointment(appointmentRequest);
  if (
    appointmentFirst.data.replayed !== false ||
    appointmentReplay.data.replayed !== true ||
    appointmentFirst.data.result.appointmentId !== appointmentRequest.appointmentId ||
    appointmentFirst.data.result.action !== appointmentRequest.action ||
    appointmentFirst.data.result.status !== "reschedule_pending" ||
    appointmentFirst.data.result.syncState !== "pending" ||
    appointmentFirst.data.result.authoritativeSystem !== "simulator" ||
    appointmentFirst.data.result.revision !== 1 ||
    appointmentFirst.data.result.synthetic !== true ||
    appointmentFirst.data.result.externalCalls !== 0 ||
    appointmentFirst.data.result.eventId !== appointmentReplay.data.result.eventId ||
    appointmentFirst.data.auditEventId !== appointmentReplay.data.auditEventId
  ) {
    throw new Error("Audited appointment callable or replay evidence failed its contract.");
  }

  type CampaignAction =
    | "run_canary"
    | "start"
    | "advance_batch"
    | "pause"
    | "resume"
    | "inject_fault"
    | "retry"
    | "cancel";
  type CampaignState =
    | "scheduled"
    | "dispatching"
    | "paused"
    | "completed"
    | "cancelled"
    | "failed";
  type CampaignCallableResponse = {
    result: {
      campaignId: string;
      eventId: string;
      checkpointId: string | null;
      action: CampaignAction;
      state: CampaignState;
      revision: number;
      canaryStatus: "not_run" | "passed_simulation" | "failed";
      processedEligible: number;
      scanOffset: number;
      nextBatchIndex: number;
      batchEligibleCount: number;
      synthetic: boolean;
      externalCalls: number;
      networkCalls: number;
    };
    auditEventId: string;
    replayed: boolean;
  };
  type CampaignCallableRequest = {
    workspaceId: string;
    campaignId: string;
    action: CampaignAction;
    expectedRevision: number;
    idempotencyKey: string;
  };
  const controlCampaign = httpsCallable<
    CampaignCallableRequest,
    CampaignCallableResponse
  >(functions, "demoControlSyntheticCampaign", { timeout: 30_000 });
  const workspaceId = "workspace_safenet_demo";
  const campaignId = "campaign_synthetic_50k";
  const campaignRequests: CampaignCallableRequest[] = [];
  const campaignResponses: CampaignCallableResponse[] = [];
  function campaignRequest(
    action: CampaignAction,
    expectedRevision: number,
  ): CampaignCallableRequest {
    return {
      workspaceId,
      campaignId,
      action,
      expectedRevision,
      idempotencyKey: `functions-verifier-campaign-${String(expectedRevision).padStart(3, "0")}-${action}`,
    };
  }
  async function runCampaignRequest(
    request: CampaignCallableRequest,
  ): Promise<CampaignCallableResponse> {
    const response = await controlCampaign(request);
    if (
      response.data.replayed !== false ||
      response.data.result.campaignId !== campaignId ||
      response.data.result.action !== request.action ||
      response.data.result.revision !== request.expectedRevision + 1 ||
      response.data.result.synthetic !== true ||
      response.data.result.externalCalls !== 0 ||
      response.data.result.networkCalls !== 0
    ) {
      throw new Error(
        `Campaign ${request.action} response failed its strict zero-call contract.`,
      );
    }
    campaignRequests.push(request);
    campaignResponses.push(response.data);
    return response.data;
  }
  async function runCampaignAction(
    action: CampaignAction,
    expectedRevision: number,
  ): Promise<CampaignCallableResponse> {
    return runCampaignRequest(campaignRequest(action, expectedRevision));
  }

  const campaignCanaryRequest = campaignRequest("run_canary", 0);
  const campaignCanary = await runCampaignRequest(campaignCanaryRequest);
  if (
    campaignCanary.result.state !== "scheduled" ||
    campaignCanary.result.canaryStatus !== "passed_simulation" ||
    campaignCanary.result.batchEligibleCount !== 25 ||
    campaignCanary.result.checkpointId !== null
  ) {
    throw new Error("Campaign canary evidence failed its contract.");
  }

  let campaignRevision = 1;
  const started = await runCampaignAction("start", campaignRevision);
  campaignRevision = started.result.revision;
  const firstBatchRequest = campaignRequest("advance_batch", campaignRevision);
  const firstBatch = await runCampaignRequest(firstBatchRequest);
  campaignRevision = firstBatch.result.revision;
  const paused = await runCampaignAction("pause", campaignRevision);
  campaignRevision = paused.result.revision;
  const resumed = await runCampaignAction("resume", campaignRevision);
  campaignRevision = resumed.result.revision;
  const secondBatch = await runCampaignAction("advance_batch", campaignRevision);
  campaignRevision = secondBatch.result.revision;
  const faulted = await runCampaignAction("inject_fault", campaignRevision);
  campaignRevision = faulted.result.revision;
  const retried = await runCampaignAction("retry", campaignRevision);
  campaignRevision = retried.result.revision;
  for (let batchIndex = 2; batchIndex < 39; batchIndex += 1) {
    const batch = await runCampaignAction("advance_batch", campaignRevision);
    campaignRevision = batch.result.revision;
  }
  const completedCampaign = campaignResponses.at(-1);
  if (
    !completedCampaign ||
    firstBatch.result.batchEligibleCount !== 1_000 ||
    secondBatch.result.batchEligibleCount !== 1_000 ||
    paused.result.state !== "paused" ||
    resumed.result.state !== "dispatching" ||
    faulted.result.state !== "failed" ||
    faulted.result.canaryStatus !== "failed" ||
    retried.result.state !== "dispatching" ||
    retried.result.canaryStatus !== "passed_simulation" ||
    completedCampaign.result.state !== "completed" ||
    completedCampaign.result.revision !== 45 ||
    completedCampaign.result.processedEligible !== 38_443 ||
    completedCampaign.result.scanOffset !== 50_000 ||
    completedCampaign.result.nextBatchIndex !== 39 ||
    completedCampaign.result.batchEligibleCount !== 443 ||
    completedCampaign.result.checkpointId !==
      "campaign_synthetic_50k:checkpoint:000038"
  ) {
    throw new Error("Campaign lifecycle did not reconcile the exact 50K synthetic audience.");
  }

  const firestoreEndpoint = new URL(`http://${firestoreEmulatorHost}`);
  const db = getHemasFirestore(verifierApp);
  connectFirestoreEmulator(
    db,
    firestoreEndpoint.hostname,
    Number(firestoreEndpoint.port),
  );

  type CampaignPersistenceCounts = {
    campaigns: number;
    events: number;
    checkpoints: number;
    actorAudits: number;
  };
  async function countActorAuditsAsLocalEmulatorAdmin(): Promise<number> {
    let pageToken: string | undefined;
    let actorAudits = 0;
    do {
      const endpoint = new URL(
        `/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/workspaces/${encodeURIComponent(workspaceId)}/auditEvents`,
        firestoreEndpoint.origin,
      );
      endpoint.searchParams.set("pageSize", "100");
      if (pageToken) endpoint.searchParams.set("pageToken", pageToken);
      const response = await fetch(endpoint, {
        headers: { Authorization: "Bearer owner" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        throw new Error(
          `Local emulator Admin audit count failed with HTTP ${response.status}.`,
        );
      }
      const body = await response.json() as {
        documents?: Array<{
          fields?: { actorUid?: { stringValue?: string } };
        }>;
        nextPageToken?: string;
      };
      for (const document of body.documents ?? []) {
        if (document.fields?.actorUid?.stringValue === credential.user.uid) {
          actorAudits += 1;
        }
      }
      pageToken = body.nextPageToken;
    } while (pageToken);
    return actorAudits;
  }
  async function campaignPersistenceCounts(): Promise<CampaignPersistenceCounts> {
    const [campaigns, events, checkpoints, actorAudits] = await Promise.all([
      getDocs(query(
        collection(db, "workspaces", workspaceId, "campaigns"),
        limit(100),
      )),
      getDocs(query(
        collection(db, "workspaces", workspaceId, "campaignEvents"),
        where("campaignId", "==", campaignId),
        limit(100),
      )),
      getDocs(query(
        collection(db, "workspaces", workspaceId, "campaignCheckpoints"),
        where("campaignId", "==", campaignId),
        limit(100),
      )),
      countActorAuditsAsLocalEmulatorAdmin(),
    ]);
    return {
      campaigns: campaigns.size,
      events: events.size,
      checkpoints: checkpoints.size,
      actorAudits,
    };
  }
  function assertPersistenceCountsUnchanged(
    expected: CampaignPersistenceCounts,
    actual: CampaignPersistenceCounts,
    label: string,
  ): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${label} changed durable campaign collection counts.`);
    }
  }
  function assertExactCampaignReplay(
    original: CampaignCallableResponse,
    replayed: CampaignCallableResponse,
    label: string,
  ): void {
    const originalResult = original.result as unknown as Record<string, unknown>;
    const replayedResult = replayed.result as unknown as Record<string, unknown>;
    if (
      replayed.replayed !== true ||
      !hasExactKeys(originalResult, CAMPAIGN_RESULT_FIELDS) ||
      !hasExactKeys(replayedResult, CAMPAIGN_RESULT_FIELDS) ||
      replayed.result.campaignId !== original.result.campaignId ||
      replayed.result.eventId !== original.result.eventId ||
      replayed.result.checkpointId !== original.result.checkpointId ||
      replayed.result.action !== original.result.action ||
      replayed.result.state !== original.result.state ||
      replayed.result.revision !== original.result.revision ||
      replayed.result.canaryStatus !== original.result.canaryStatus ||
      replayed.result.processedEligible !== original.result.processedEligible ||
      replayed.result.scanOffset !== original.result.scanOffset ||
      replayed.result.nextBatchIndex !== original.result.nextBatchIndex ||
      replayed.result.batchEligibleCount !== original.result.batchEligibleCount ||
      replayed.result.synthetic !== original.result.synthetic ||
      replayed.result.externalCalls !== original.result.externalCalls ||
      replayed.result.networkCalls !== original.result.networkCalls ||
      replayed.auditEventId !== original.auditEventId
    ) {
      throw new Error(`${label} did not return its exact original durable result.`);
    }
  }

  const countsAtRevision45 = await campaignPersistenceCounts();
  if (
    countsAtRevision45.campaigns !== 1 ||
    countsAtRevision45.events !== 45 ||
    countsAtRevision45.checkpoints !== 39 ||
    countsAtRevision45.actorAudits !== 47
  ) {
    throw new Error("Revision-45 campaign evidence counts are incomplete before replay.");
  }
  const campaignCanaryReplay = await controlCampaign(campaignCanaryRequest);
  assertExactCampaignReplay(
    campaignCanary,
    campaignCanaryReplay.data,
    "Post-completion canary replay",
  );
  assertPersistenceCountsUnchanged(
    countsAtRevision45,
    await campaignPersistenceCounts(),
    "Post-completion canary replay",
  );

  const firstBatchReplay = await controlCampaign(firstBatchRequest);
  assertExactCampaignReplay(
    firstBatch,
    firstBatchReplay.data,
    "Post-completion first-batch replay",
  );
  assertPersistenceCountsUnchanged(
    countsAtRevision45,
    await campaignPersistenceCounts(),
    "Post-completion first-batch replay",
  );

  let changedCampaignRequestDenied = false;
  try {
    await controlCampaign({
      ...campaignCanaryRequest,
      expectedRevision: campaignCanaryRequest.expectedRevision + 1,
    });
  } catch (error) {
    changedCampaignRequestDenied = callableErrorCode(error).includes("already-exists");
  }
  if (!changedCampaignRequestDenied) {
    throw new Error("Changed campaign request reuse of an idempotency key was not denied.");
  }
  assertPersistenceCountsUnchanged(
    countsAtRevision45,
    await campaignPersistenceCounts(),
    "Changed-request idempotency conflict",
  );
  const canaryReplayAfterConflict = await controlCampaign(campaignCanaryRequest);
  assertExactCampaignReplay(
    campaignCanary,
    canaryReplayAfterConflict.data,
    "Original canary replay after changed-request conflict",
  );
  assertPersistenceCountsUnchanged(
    countsAtRevision45,
    await campaignPersistenceCounts(),
    "Original canary replay after changed-request conflict",
  );

  const [
    note,
    audit,
    appointment,
    appointmentEvent,
    appointmentAudit,
    campaign,
    audienceSnapshot,
    campaignEvents,
    campaignCheckpoints,
  ] = await Promise.all([
    getDoc(doc(
      db,
      "workspaces",
      "workspace_safenet_demo",
      "internalNotes",
      first.data.result.noteId,
    )),
    getDoc(doc(
      db,
      "workspaces",
      "workspace_safenet_demo",
      "auditEvents",
      first.data.auditEventId,
    )),
    getDoc(doc(
      db,
      "workspaces",
      "workspace_safenet_demo",
      "appointments",
      appointmentFirst.data.result.appointmentId,
    )),
    getDoc(doc(
      db,
      "workspaces",
      "workspace_safenet_demo",
      "appointmentEvents",
      appointmentFirst.data.result.eventId,
    )),
    getDoc(doc(
      db,
      "workspaces",
      "workspace_safenet_demo",
      "auditEvents",
      appointmentFirst.data.auditEventId,
    )),
    getDoc(doc(
      db,
      "workspaces",
      "workspace_safenet_demo",
      "campaigns",
      campaignId,
    )),
    getDoc(doc(
      db,
      "workspaces",
      workspaceId,
      "audienceSnapshots",
      "audience_synthetic_50k_v1",
    )),
    getDocs(query(
      collection(
        db,
        "workspaces",
        "workspace_safenet_demo",
        "campaignEvents",
      ),
      where("campaignId", "==", campaignId),
      limit(50),
    )),
    getDocs(query(
      collection(
        db,
        "workspaces",
        "workspace_safenet_demo",
        "campaignCheckpoints",
      ),
      where("campaignId", "==", campaignId),
      limit(50),
    )),
  ]);
  if (
    !note.exists() ||
    note.data().authorUid !== credential.user.uid ||
    note.data().bodyRef !==
      `protected://workspaces/workspace_safenet_demo/internal-notes/${first.data.result.noteId}` ||
    !audit.exists() ||
    audit.data().actorUid !== credential.user.uid ||
    audit.data().action !== "internal-note.create" ||
    audit.data().metadata?.purpose !== "patient_support"
  ) {
    throw new Error(
      "Authenticated mutation did not persist its purpose-bound note and audit atomically.",
    );
  }
  if (
    !appointment.exists() ||
    appointment.data().status !== "reschedule_pending" ||
    appointment.data().syncState !== "pending" ||
    appointment.data().revision !== 1 ||
    appointment.data().lastActionId !== appointmentFirst.data.result.eventId ||
    appointment.data().authoritativeSystem !== "simulator" ||
    appointment.data().synthetic !== true ||
    !appointmentEvent.exists() ||
    appointmentEvent.data().actorUid !== credential.user.uid ||
    appointmentEvent.data().action !== "request_reschedule" ||
    appointmentEvent.data().toStatus !== "reschedule_pending" ||
    appointmentEvent.data().revision !== 1 ||
    !appointmentAudit.exists() ||
    appointmentAudit.data().actorUid !== credential.user.uid ||
    appointmentAudit.data().action !== "appointment.request_reschedule" ||
    appointmentAudit.data().metadata?.purpose !== "appointment_service" ||
    appointmentAudit.data().metadata?.authoritativeSystem !== "simulator"
  ) {
    throw new Error(
      "Audited appointment callable did not persist its pending state, immutable event and redacted audit atomically.",
    );
  }

  if (campaignRequests.length !== 45 || campaignResponses.length !== 45) {
    throw new Error("The verifier did not retain all 45 original campaign requests and responses.");
  }
  const [campaignEventSnapshots, campaignAuditSnapshots] = await Promise.all([
    Promise.all(campaignResponses.map((response) =>
      getDoc(doc(
        db,
        "workspaces",
        workspaceId,
        "campaignEvents",
        response.result.eventId,
      ))
    )),
    Promise.all(campaignResponses.map((response) =>
      getDoc(doc(
        db,
        "workspaces",
        workspaceId,
        "auditEvents",
        response.auditEventId,
      ))
    )),
  ]);
  const eventTimestampById = new Map<string, number>();
  let expectedFromState: CampaignState = "scheduled";
  for (let index = 0; index < campaignResponses.length; index += 1) {
    const request = campaignRequests[index];
    const response = campaignResponses[index];
    const eventSnapshot = campaignEventSnapshots[index];
    const auditSnapshot = campaignAuditSnapshots[index];
    if (!request || !response || !eventSnapshot || !auditSnapshot) {
      throw new Error(`Campaign evidence ${index} is missing from the retained execution chain.`);
    }
    if (!eventSnapshot.exists() || !auditSnapshot.exists()) {
      throw new Error(`Campaign evidence ${index} is missing its exact event or audit document.`);
    }
    const event = eventSnapshot.data() as Record<string, unknown>;
    const auditRecord = auditSnapshot.data() as Record<string, unknown>;
    const metadata = auditRecord.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      throw new Error(`Campaign audit ${auditSnapshot.id} has invalid metadata.`);
    }
    const auditMetadata = metadata as Record<string, unknown>;
    const actionName = `campaign.${request.action}`;
    const expectedIdempotencyId = deterministicId(
      "idempotency",
      [workspaceId, credential.user.uid, actionName, request.idempotencyKey].join(":"),
    );
    const expectedEventId = deterministicId("campaign-event", expectedIdempotencyId);
    const expectedCheckpointId = request.action === "advance_batch"
      ? `${campaignId}:checkpoint:${String(response.result.nextBatchIndex - 1).padStart(6, "0")}`
      : null;
    const eventCreatedAt = timestampMillis(event.createdAt);
    const auditOccurredAt = timestampMillis(auditRecord.occurredAt);
    const auditCreatedAt = timestampMillis(auditRecord.createdAt);
    if (
      !hasExactKeys(event, CAMPAIGN_EVENT_FIELDS) ||
      !hasExactKeys(auditRecord, CAMPAIGN_AUDIT_FIELDS) ||
      !hasExactKeys(auditMetadata, CAMPAIGN_AUDIT_METADATA_FIELDS) ||
      request.workspaceId !== workspaceId ||
      request.campaignId !== campaignId ||
      request.expectedRevision !== index ||
      response.replayed !== false ||
      response.result.revision !== index + 1 ||
      response.result.eventId !== expectedEventId ||
      response.result.checkpointId !== expectedCheckpointId ||
      eventSnapshot.id !== expectedEventId ||
      event.id !== expectedEventId ||
      event.workspaceId !== workspaceId ||
      event.campaignId !== campaignId ||
      event.actorUid !== credential.user.uid ||
      event.action !== request.action ||
      event.fromState !== expectedFromState ||
      event.toState !== response.result.state ||
      event.revision !== response.result.revision ||
      event.checkpointId !== expectedCheckpointId ||
      event.externalCalls !== 0 ||
      event.networkCalls !== 0 ||
      event.synthetic !== true ||
      event.schemaVersion !== 1 ||
      eventCreatedAt === null ||
      auditSnapshot.id !== response.auditEventId ||
      auditRecord.id !== response.auditEventId ||
      auditRecord.workspaceId !== workspaceId ||
      auditRecord.actorUid !== credential.user.uid ||
      auditRecord.actorType !== "user" ||
      auditRecord.action !== actionName ||
      auditRecord.resourceType !== "campaign" ||
      auditRecord.resourceId !== campaignId ||
      auditRecord.outcome !== "allowed" ||
      auditRecord.requestId !== expectedIdempotencyId ||
      auditRecord.synthetic !== true ||
      auditRecord.schemaVersion !== 1 ||
      auditOccurredAt !== eventCreatedAt ||
      auditCreatedAt !== eventCreatedAt ||
      auditMetadata.purpose !== "campaign_governance" ||
      auditMetadata.campaignAction !== request.action ||
      auditMetadata.fromState !== expectedFromState ||
      auditMetadata.toState !== response.result.state ||
      auditMetadata.revision !== response.result.revision ||
      auditMetadata.checkpointId !== expectedCheckpointId ||
      auditMetadata.batchEligibleCount !== response.result.batchEligibleCount ||
      auditMetadata.processedEligible !== response.result.processedEligible ||
      auditMetadata.scanOffset !== response.result.scanOffset ||
      auditMetadata.dispatchMode !== "simulation" ||
      auditMetadata.synthetic !== true ||
      auditMetadata.externalCalls !== 0 ||
      auditMetadata.networkCalls !== 0 ||
      response.result.externalCalls !== 0 ||
      response.result.networkCalls !== 0
    ) {
      throw new Error(
        `Campaign event/audit evidence at revision ${response.result.revision} failed its exact join.`,
      );
    }
    eventTimestampById.set(expectedEventId, eventCreatedAt);
    expectedFromState = response.result.state;
  }

  if (!campaign.exists() || !audienceSnapshot.exists()) {
    throw new Error("The completed campaign or immutable audience snapshot is missing.");
  }
  const campaignRecord = campaign.data() as Record<string, unknown>;
  const audienceRecord = audienceSnapshot.data() as Record<string, unknown>;
  const approval = campaignRecord.approval;
  if (!approval || typeof approval !== "object" || Array.isArray(approval)) {
    throw new Error("The campaign approval binding is missing.");
  }
  const approvalHash = (approval as Record<string, unknown>).approvedContentHash;
  const snapshotContentHash = audienceRecord.contentHash;
  if (
    approvalHash !== "6bdce27c7e31e5e064febd7b4dcbd05df208a4ddf33085003848bbfd81c1b1cd" ||
    snapshotContentHash !== "7a4d8ce2bc1bafc224e5e2b91a2fc3f8b20b5f062ff1563ca4cf25847ad0d550"
  ) {
    throw new Error("The canonical campaign or audience digest drifted from the seed contract.");
  }
  const advanceExecutions = campaignResponses.flatMap((response, index) => {
    const request = campaignRequests[index];
    const event = campaignEventSnapshots[index];
    return request?.action === "advance_batch" && event
      ? [{ request, response, event }]
      : [];
  });
  if (advanceExecutions.length !== 39) {
    throw new Error("The completed campaign does not contain exactly 39 batch executions.");
  }
  const checkpointSnapshots = await Promise.all(advanceExecutions.map(({ response }) => {
    if (response.result.checkpointId === null) {
      throw new Error("An advance response is missing its deterministic checkpoint ID.");
    }
    return getDoc(doc(
      db,
      "workspaces",
      workspaceId,
      "campaignCheckpoints",
      response.result.checkpointId,
    ));
  }));
  let canonicalSourceOffset = 0;
  let canonicalProcessedEligible = 0;
  for (let batchIndex = 0; batchIndex < advanceExecutions.length; batchIndex += 1) {
    const execution = advanceExecutions[batchIndex];
    const checkpointSnapshot = checkpointSnapshots[batchIndex];
    if (!execution || !checkpointSnapshot?.exists()) {
      throw new Error(`Canonical checkpoint ${batchIndex} is missing.`);
    }
    const expected = canonicalCampaignBatch({
      sourceOffsetStart: canonicalSourceOffset,
      batchIndex,
      workspaceId,
      campaignId,
      snapshotContentHash,
      approvalHash,
    });
    canonicalSourceOffset = expected.sourceOffsetEnd;
    canonicalProcessedEligible += expected.eligibleCount;
    const expectedCheckpointId =
      `${campaignId}:checkpoint:${String(batchIndex).padStart(6, "0")}`;
    const checkpoint = checkpointSnapshot.data() as Record<string, unknown>;
    const languageCounts = checkpoint.languageCounts;
    const eventCreatedAt = eventTimestampById.get(execution.response.result.eventId);
    if (
      !languageCounts ||
      typeof languageCounts !== "object" ||
      Array.isArray(languageCounts) ||
      !hasExactKeys(languageCounts as Record<string, unknown>, ["en", "si", "ta"]) ||
      !hasExactKeys(checkpoint, CAMPAIGN_CHECKPOINT_FIELDS) ||
      checkpointSnapshot.id !== expectedCheckpointId ||
      checkpoint.id !== expectedCheckpointId ||
      checkpoint.workspaceId !== workspaceId ||
      checkpoint.campaignId !== campaignId ||
      checkpoint.eventId !== execution.response.result.eventId ||
      checkpoint.batchIndex !== batchIndex ||
      checkpoint.sourceOffsetStart !== expected.sourceOffsetStart ||
      checkpoint.sourceOffsetEnd !== expected.sourceOffsetEnd ||
      checkpoint.eligibleCount !== expected.eligibleCount ||
      (languageCounts as Record<string, unknown>).en !== expected.languageCounts.en ||
      (languageCounts as Record<string, unknown>).si !== expected.languageCounts.si ||
      (languageCounts as Record<string, unknown>).ta !== expected.languageCounts.ta ||
      checkpoint.processedEligible !== canonicalProcessedEligible ||
      checkpoint.scanComplete !== expected.scanComplete ||
      checkpoint.digest !== expected.digest ||
      typeof checkpoint.digest !== "string" ||
      !/^[0-9a-f]{64}$/.test(checkpoint.digest) ||
      checkpoint.externalCalls !== 0 ||
      checkpoint.networkCalls !== 0 ||
      checkpoint.synthetic !== true ||
      checkpoint.schemaVersion !== 1 ||
      eventCreatedAt === undefined ||
      timestampMillis(checkpoint.createdAt) !== eventCreatedAt ||
      execution.response.result.checkpointId !== expectedCheckpointId ||
      execution.response.result.nextBatchIndex !== batchIndex + 1 ||
      execution.response.result.batchEligibleCount !== expected.eligibleCount ||
      execution.response.result.processedEligible !== canonicalProcessedEligible ||
      execution.response.result.scanOffset !== expected.sourceOffsetEnd ||
      execution.event.data()?.checkpointId !== expectedCheckpointId
    ) {
      throw new Error(`Checkpoint ${batchIndex} failed its canonical event/range digest join.`);
    }
  }
  if (canonicalSourceOffset !== 50_000 || canonicalProcessedEligible !== 38_443) {
    throw new Error("Canonical checkpoint replay did not reconcile the fixed 50K audience.");
  }

  const finalCampaignAudit = await getDoc(doc(
    db,
    "workspaces",
    "workspace_safenet_demo",
    "auditEvents",
    completedCampaign.auditEventId,
  ));
  const finalCheckpoint = await getDoc(doc(
    db,
    "workspaces",
    "workspace_safenet_demo",
    "campaignCheckpoints",
    completedCampaign.result.checkpointId!,
  ));
  if (
    !campaign.exists() ||
    campaign.data().state !== "completed" ||
    campaign.data().revision !== 45 ||
    campaign.data().canaryStatus !== "passed_simulation" ||
    campaign.data().processedEligible !== 38_443 ||
    campaign.data().scanOffset !== 50_000 ||
    campaign.data().nextBatchIndex !== 39 ||
    campaign.data().lastCheckpointId !== completedCampaign.result.checkpointId ||
    campaign.data().externalCalls !== 0 ||
    campaign.data().networkCalls !== 0 ||
    campaignEvents.size !== 45 ||
    campaignCheckpoints.size !== 39 ||
    !finalCheckpoint.exists() ||
    finalCheckpoint.data().batchIndex !== 38 ||
    finalCheckpoint.data().sourceOffsetStart !== 49_424 ||
    finalCheckpoint.data().sourceOffsetEnd !== 50_000 ||
    finalCheckpoint.data().eligibleCount !== 443 ||
    finalCheckpoint.data().processedEligible !== 38_443 ||
    finalCheckpoint.data().scanComplete !== true ||
    finalCheckpoint.data().externalCalls !== 0 ||
    finalCheckpoint.data().networkCalls !== 0 ||
    !finalCampaignAudit.exists() ||
    finalCampaignAudit.data().actorUid !== credential.user.uid ||
    finalCampaignAudit.data().action !== "campaign.advance_batch" ||
    finalCampaignAudit.data().metadata?.purpose !== "campaign_governance" ||
    finalCampaignAudit.data().metadata?.processedEligible !== 38_443 ||
    finalCampaignAudit.data().metadata?.externalCalls !== 0 ||
    finalCampaignAudit.data().metadata?.networkCalls !== 0
  ) {
    throw new Error(
      "Audited campaign callable did not persist its exact 39-checkpoint zero-call reconciliation.",
    );
  }

  let idempotencyPrivate = false;
  try {
    await getDocs(query(
      collection(
        db,
        "workspaces",
        "workspace_safenet_demo",
        "idempotencyKeys",
      ),
      limit(1),
    ));
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";
    idempotencyPrivate = code.includes("permission-denied");
  }
  if (!idempotencyPrivate) {
    throw new Error("Client unexpectedly accessed backend idempotency evidence.");
  }
} finally {
  await deleteApp(verifierApp);
}

process.stdout.write(
  "Verified local Functions readiness plus authenticated note, appointment and complete 50K campaign persistence; outbound remains disabled.\n",
);
