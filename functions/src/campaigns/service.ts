import type {
  DocumentData,
  Firestore,
  Transaction,
} from "firebase-admin/firestore";
import { createTenantAuditEvent } from "../audit.js";
import {
  assertDemoAuditEmulatorBoundary,
  toFirestoreAuditRecord,
} from "../audit-firestore.js";
import type { RuntimeConfig } from "../config.js";
import { deterministicId } from "../deterministic.js";
import { FailClosedError } from "../errors.js";
import {
  assertWorkspaceAuthorization,
  fingerprintServiceRequest,
  idempotencyDocumentId,
  type AuthenticatedActor,
} from "../service-kernel.js";
import {
  MAX_SYNTHETIC_ELIGIBLE_BATCH,
  SYNTHETIC_AUDIENCE_COUNTS,
  countSyntheticEligibleBefore,
  planSyntheticEligibleBatch,
  type SyntheticEligibleBatch,
} from "./audience.js";
import {
  SYNTHETIC_AUDIENCE_SNAPSHOT_ID,
  SYNTHETIC_CAMPAIGN_APPROVER_UID,
  SYNTHETIC_CAMPAIGN_OWNER_UID,
  SYNTHETIC_CAMPAIGN_TEMPLATE_IDS,
  assertCampaignApprovalBinding,
  assertStoredSyntheticCampaignTemplate,
  assertSyntheticCampaignRuntimeBoundary,
  campaignCheckpointId,
  hasExactKeys,
  parseStoredCampaignControlResult,
  parseStoredSyntheticAudienceSnapshot,
  parseStoredSyntheticCampaign,
  parseSyntheticCampaignControlInput,
  timestampMillis,
  type ParsedSyntheticAudienceSnapshot,
  type ParsedSyntheticCampaign,
  type SyntheticCampaignCanaryStatus,
  type SyntheticCampaignControlAction,
  type SyntheticCampaignControlInput,
  type SyntheticCampaignControlResult,
  type SyntheticCampaignState,
} from "./contracts.js";

export interface SyntheticCampaignControlResponse {
  readonly result: SyntheticCampaignControlResult;
  readonly auditEventId: string;
  readonly replayed: boolean;
}

export interface CampaignEmulatorBoundary {
  readonly projectId: string;
  readonly firestoreEmulatorHost: string | undefined;
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const EVENT_KEYS = Object.freeze([
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
]);
const CHECKPOINT_KEYS = Object.freeze([
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
]);
const IDEMPOTENCY_KEYS = Object.freeze([
  "action",
  "actorUid",
  "auditEventId",
  "checkpointId",
  "createdAt",
  "eventId",
  "id",
  "purpose",
  "requestHash",
  "result",
  "schemaVersion",
  "synthetic",
  "workspaceId",
]);
const AUDIT_KEYS = Object.freeze([
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
]);
const AUDIT_METADATA_KEYS = Object.freeze([
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
]);

function actionName(action: SyntheticCampaignControlAction): string {
  return `campaign.${action}`;
}

function assertSyntheticWorkspace(value: DocumentData | undefined, workspaceId: string): void {
  if (
    !value ||
    value.id !== workspaceId ||
    value.status !== "active" ||
    value.mode !== "demo" ||
    value.dataClassification !== "synthetic_only"
  ) {
    throw new FailClosedError(
      "workspace_denied",
      "An active synthetic demo workspace is required.",
    );
  }
}

function assertSyntheticApprover(value: DocumentData | undefined, workspaceId: string): void {
  if (
    !value ||
    value.id !== SYNTHETIC_CAMPAIGN_APPROVER_UID ||
    value.uid !== SYNTHETIC_CAMPAIGN_APPROVER_UID ||
    value.workspaceId !== workspaceId ||
    value.role !== "campaign_approver" ||
    value.status !== "active" ||
    value.synthetic !== true ||
    value.scopeMode !== "assigned" ||
    !Array.isArray(value.teamIds) ||
    value.teamIds.length !== 0 ||
    !Array.isArray(value.locationIds) ||
    value.locationIds.length !== 0
  ) {
    throw new FailClosedError(
      "campaign_approval_denied",
      "A distinct active synthetic campaign approver is required.",
    );
  }
}

function assertSyntheticOwner(value: DocumentData | undefined, workspaceId: string): void {
  if (
    !value ||
    value.id !== value.uid ||
    value.id !== SYNTHETIC_CAMPAIGN_OWNER_UID ||
    value.workspaceId !== workspaceId ||
    value.role !== "campaign_operator" ||
    value.status !== "active" ||
    value.synthetic !== true ||
    value.scopeMode !== "assigned" ||
    !Array.isArray(value.teamIds) ||
    value.teamIds.length !== 0 ||
    !Array.isArray(value.locationIds) ||
    value.locationIds.length !== 0
  ) {
    throw new FailClosedError(
      "campaign_owner_denied",
      "An exact active synthetic campaign owner membership is required.",
    );
  }
}

function assertOwnerPolicy(input: {
  readonly actorUid: string;
  readonly role: string;
  readonly campaign: ParsedSyntheticCampaign;
}): void {
  if (
    input.role !== "tenant_admin" &&
    (input.role !== "campaign_operator" || input.actorUid !== input.campaign.ownerId)
  ) {
    throw new FailClosedError(
      "campaign_owner_denied",
      "Campaign operators may control only their own synthetic campaign.",
    );
  }
}

function validTransition(
  action: SyntheticCampaignControlAction,
  fromState: SyntheticCampaignState,
  toState: SyntheticCampaignState,
): boolean {
  switch (action) {
    case "run_canary": return fromState === "scheduled" && toState === "scheduled";
    case "start": return fromState === "scheduled" && toState === "dispatching";
    case "advance_batch":
      return fromState === "dispatching" &&
        (toState === "dispatching" || toState === "completed");
    case "pause": return fromState === "dispatching" && toState === "paused";
    case "resume": return fromState === "paused" && toState === "dispatching";
    case "inject_fault": return fromState === "dispatching" && toState === "failed";
    case "retry": return fromState === "failed" && toState === "dispatching";
    case "cancel":
      return ["scheduled", "dispatching", "paused", "failed"].includes(fromState) &&
        toState === "cancelled";
  }
}

type TransitionPlan = {
  readonly fromState: SyntheticCampaignState;
  readonly toState: SyntheticCampaignState;
  readonly canaryStatus: SyntheticCampaignCanaryStatus;
  readonly processedEligible: number;
  readonly scanOffset: number;
  readonly nextBatchIndex: number;
  readonly checkpointId: string | null;
  readonly batch: SyntheticEligibleBatch | null;
  readonly batchEligibleCount: number;
};

function planTransition(input: {
  readonly campaign: ParsedSyntheticCampaign;
  readonly snapshot: ParsedSyntheticAudienceSnapshot;
  readonly action: SyntheticCampaignControlAction;
}): TransitionPlan {
  const { campaign, action } = input;
  const rejected = (message: string): never => {
    throw new FailClosedError("campaign_transition_denied", message);
  };
  const unchanged = {
    fromState: campaign.state,
    canaryStatus: campaign.canaryStatus,
    processedEligible: campaign.processedEligible,
    scanOffset: campaign.scanOffset,
    nextBatchIndex: campaign.nextBatchIndex,
    checkpointId: null,
    batch: null,
    batchEligibleCount: 0,
  } as const;

  switch (action) {
    case "run_canary":
      if (
        campaign.state !== "scheduled" ||
        campaign.canaryStatus !== "not_run" ||
        campaign.processedEligible !== 0
      ) {
        return rejected("The fixed simulator canary may run once before dispatch starts.");
      }
      return {
        ...unchanged,
        toState: "scheduled",
        canaryStatus: "passed_simulation",
        batchEligibleCount: 25,
      };
    case "start":
      if (campaign.state !== "scheduled" || campaign.canaryStatus !== "passed_simulation") {
        return rejected("Campaign dispatch requires the fixed simulator canary first.");
      }
      return { ...unchanged, toState: "dispatching" };
    case "advance_batch": {
      if (
        campaign.state !== "dispatching" ||
        campaign.canaryStatus !== "passed_simulation" ||
        campaign.processedEligible >= SYNTHETIC_AUDIENCE_COUNTS.eligibleCount
      ) {
        return rejected("Only an active governed simulator dispatch may advance.");
      }
      const batchIndex = campaign.nextBatchIndex;
      const checkpointId = campaignCheckpointId(campaign.id, batchIndex);
      const batch = planSyntheticEligibleBatch({
        sourceOffset: campaign.scanOffset,
        batchSize: campaign.batchSize,
        digestScope: checkpointDigestScope({
          campaign,
          snapshot: input.snapshot,
          batchIndex,
        }),
      });
      if (batch.eligibleCount < 1) {
        return rejected("The synthetic audience has no remaining eligible batch.");
      }
      const processedEligible = campaign.processedEligible + batch.eligibleCount;
      if (
        processedEligible > SYNTHETIC_AUDIENCE_COUNTS.eligibleCount ||
        (batch.scanComplete && processedEligible !== SYNTHETIC_AUDIENCE_COUNTS.eligibleCount) ||
        (!batch.scanComplete && batch.eligibleCount !== MAX_SYNTHETIC_ELIGIBLE_BATCH)
      ) {
        throw new FailClosedError(
          "invalid_campaign_algorithm",
          "Synthetic campaign batch reconciliation failed closed.",
        );
      }
      return {
        fromState: campaign.state,
        toState: batch.scanComplete ? "completed" : "dispatching",
        canaryStatus: campaign.canaryStatus,
        processedEligible,
        scanOffset: batch.sourceOffsetEnd,
        nextBatchIndex: batchIndex + 1,
        checkpointId,
        batch,
        batchEligibleCount: batch.eligibleCount,
      };
    }
    case "pause":
      if (campaign.state !== "dispatching") {
        return rejected("Only a dispatching simulator campaign may pause.");
      }
      return { ...unchanged, toState: "paused" };
    case "resume":
      if (campaign.state !== "paused") {
        return rejected("Only a paused simulator campaign may resume.");
      }
      return { ...unchanged, toState: "dispatching" };
    case "inject_fault":
      if (campaign.state !== "dispatching") {
        return rejected("A recoverable simulator fault requires active dispatch.");
      }
      return { ...unchanged, toState: "failed", canaryStatus: "failed" };
    case "retry":
      if (campaign.state !== "failed" || campaign.canaryStatus !== "failed") {
        return rejected("Only a failed simulator campaign may retry.");
      }
      return {
        ...unchanged,
        toState: "dispatching",
        canaryStatus: "passed_simulation",
      };
    case "cancel":
      if (!["scheduled", "dispatching", "paused", "failed"].includes(campaign.state)) {
        return rejected("The simulator campaign is already terminal.");
      }
      return { ...unchanged, toState: "cancelled" };
  }
}

function checkpointDigestScope(input: {
  readonly campaign: ParsedSyntheticCampaign;
  readonly snapshot: ParsedSyntheticAudienceSnapshot;
  readonly batchIndex: number;
}): string {
  return [
    input.campaign.workspaceId,
    input.campaign.id,
    input.snapshot.contentHash,
    input.campaign.approval.approvedContentHash,
    input.batchIndex,
  ].join(":");
}

function canonicalSyntheticBatchForIndex(input: {
  readonly campaign: ParsedSyntheticCampaign;
  readonly snapshot: ParsedSyntheticAudienceSnapshot;
  readonly batchIndex: number;
}): SyntheticEligibleBatch {
  let sourceOffset = 0;
  for (let index = 0; index <= input.batchIndex; index += 1) {
    const batch = planSyntheticEligibleBatch({
      sourceOffset,
      batchSize: input.campaign.batchSize,
      digestScope: checkpointDigestScope({
        campaign: input.campaign,
        snapshot: input.snapshot,
        batchIndex: index,
      }),
    });
    if (index === input.batchIndex) return batch;
    if (batch.scanComplete) {
      throw new FailClosedError(
        "campaign_checkpoint_denied",
        "Campaign checkpoint evidence is invalid.",
      );
    }
    sourceOffset = batch.sourceOffsetEnd;
  }
  throw new FailClosedError(
    "campaign_checkpoint_denied",
    "Campaign checkpoint evidence is invalid.",
  );
}

function assertStoredCheckpoint(input: {
  readonly value: DocumentData | undefined;
  readonly campaign: ParsedSyntheticCampaign;
  readonly snapshot: ParsedSyntheticAudienceSnapshot;
  readonly checkpointId: string;
  readonly eventId?: string;
  readonly occurredAtMillis?: number;
  readonly bindCurrentProgress?: boolean;
  readonly replayResult?: SyntheticCampaignControlResult;
}): void {
  const value = input.value;
  const batchIndex = Number(value?.batchIndex);
  if (
    !value ||
    !hasExactKeys(value, CHECKPOINT_KEYS) ||
    !Number.isInteger(batchIndex) ||
    batchIndex < 0 ||
    batchIndex > 38
  ) {
    throw new FailClosedError(
      "campaign_checkpoint_denied",
      "Campaign checkpoint evidence is invalid.",
    );
  }
  const expectedId = campaignCheckpointId(input.campaign.id, batchIndex);
  const expectedBatch = canonicalSyntheticBatchForIndex({
    campaign: input.campaign,
    snapshot: input.snapshot,
    batchIndex,
  });
  const languageCounts = value.languageCounts;
  if (
    expectedId !== input.checkpointId ||
    value.id !== expectedId ||
    value.workspaceId !== input.campaign.workspaceId ||
    value.campaignId !== input.campaign.id ||
    typeof value.eventId !== "string" ||
    !SAFE_ID.test(value.eventId) ||
    (input.eventId !== undefined && value.eventId !== input.eventId) ||
    value.sourceOffsetStart !== expectedBatch.sourceOffsetStart ||
    value.sourceOffsetEnd !== expectedBatch.sourceOffsetEnd ||
    value.eligibleCount !== expectedBatch.eligibleCount ||
    !languageCounts ||
    typeof languageCounts !== "object" ||
    Array.isArray(languageCounts) ||
    !hasExactKeys(languageCounts as DocumentData, ["en", "si", "ta"]) ||
    languageCounts.en !== expectedBatch.languageCounts.en ||
    languageCounts.si !== expectedBatch.languageCounts.si ||
    languageCounts.ta !== expectedBatch.languageCounts.ta ||
    value.processedEligible !== countSyntheticEligibleBefore(expectedBatch.sourceOffsetEnd) ||
    (input.replayResult !== undefined &&
      (input.replayResult.action !== "advance_batch" ||
        input.replayResult.checkpointId !== input.checkpointId ||
        batchIndex !== input.replayResult.nextBatchIndex - 1 ||
        value.eligibleCount !== input.replayResult.batchEligibleCount ||
        value.processedEligible !== input.replayResult.processedEligible ||
        value.sourceOffsetEnd !== input.replayResult.scanOffset ||
        value.sourceOffsetStart !== expectedBatch.sourceOffsetStart)) ||
    (input.bindCurrentProgress === true &&
      (batchIndex !== input.campaign.nextBatchIndex - 1 ||
        value.processedEligible !== input.campaign.processedEligible ||
        value.sourceOffsetEnd !== input.campaign.scanOffset)) ||
    value.scanComplete !== expectedBatch.scanComplete ||
    value.digest !== expectedBatch.digest ||
    typeof value.digest !== "string" ||
    !SHA256.test(value.digest) ||
    value.externalCalls !== 0 ||
    value.networkCalls !== 0 ||
    value.synthetic !== true ||
    value.schemaVersion !== 1 ||
    timestampMillis(value.createdAt) === null ||
    (input.occurredAtMillis !== undefined &&
      timestampMillis(value.createdAt) !== input.occurredAtMillis)
  ) {
    throw new FailClosedError(
      "campaign_checkpoint_denied",
      "Campaign checkpoint evidence is invalid.",
    );
  }
}

function assertStoredEvent(input: {
  readonly value: DocumentData | undefined;
  readonly request: SyntheticCampaignControlInput;
  readonly actorUid: string;
  readonly eventId: string;
  readonly result: SyntheticCampaignControlResult;
  readonly occurredAtMillis: number;
}): void {
  const value = input.value;
  if (
    !value ||
    !hasExactKeys(value, EVENT_KEYS) ||
    value.id !== input.eventId ||
    value.workspaceId !== input.request.workspaceId ||
    value.campaignId !== input.request.campaignId ||
    value.actorUid !== input.actorUid ||
    value.action !== input.request.action ||
    typeof value.fromState !== "string" ||
    !validTransition(
      input.request.action,
      value.fromState as SyntheticCampaignState,
      input.result.state,
    ) ||
    value.toState !== input.result.state ||
    value.revision !== input.result.revision ||
    value.checkpointId !== input.result.checkpointId ||
    value.externalCalls !== 0 ||
    value.networkCalls !== 0 ||
    value.synthetic !== true ||
    value.schemaVersion !== 1 ||
    timestampMillis(value.createdAt) !== input.occurredAtMillis
  ) {
    throw new FailClosedError(
      "idempotency_conflict",
      "Stored campaign event evidence does not match this replay.",
    );
  }
}

function assertCurrentCampaignCompatibleWithResult(input: {
  readonly campaign: ParsedSyntheticCampaign;
  readonly raw: DocumentData | undefined;
  readonly result: SyntheticCampaignControlResult;
  readonly occurredAtMillis: number;
}): void {
  const laterStateIsReachable =
    !["cancelled", "completed"].includes(input.result.state) &&
    input.campaign.state !== "scheduled";
  const exactRevision = input.campaign.revision === input.result.revision;
  const exactMatch =
    exactRevision &&
    input.campaign.state === input.result.state &&
    input.campaign.canaryStatus === input.result.canaryStatus &&
    input.campaign.processedEligible === input.result.processedEligible &&
    input.campaign.scanOffset === input.result.scanOffset &&
    input.campaign.nextBatchIndex === input.result.nextBatchIndex &&
    timestampMillis(input.raw?.updatedAt) === input.occurredAtMillis &&
    (input.result.action !== "advance_batch" ||
      input.campaign.lastCheckpointId === input.result.checkpointId);
  const monotonicLaterState =
    input.campaign.revision > input.result.revision &&
    laterStateIsReachable &&
    input.campaign.processedEligible >= input.result.processedEligible &&
    input.campaign.scanOffset >= input.result.scanOffset &&
    input.campaign.nextBatchIndex >= input.result.nextBatchIndex &&
    (timestampMillis(input.raw?.updatedAt) ?? -1) >= input.occurredAtMillis &&
    (input.result.canaryStatus === "not_run" ||
      input.campaign.canaryStatus !== "not_run");
  if (
    (!exactMatch && !monotonicLaterState) ||
    (input.result.action !== "advance_batch" && input.result.checkpointId !== null)
  ) {
    throw new FailClosedError(
      "idempotency_conflict",
      "Stored campaign state does not match this replay.",
    );
  }
}

function assertStoredAudit(input: {
  readonly value: DocumentData | undefined;
  readonly request: SyntheticCampaignControlInput;
  readonly actorUid: string;
  readonly action: string;
  readonly idempotencyId: string;
  readonly auditEventId: string;
  readonly result: SyntheticCampaignControlResult;
  readonly event: DocumentData;
  readonly occurredAtMillis: number;
}): void {
  const value = input.value;
  const metadata = value?.metadata;
  if (
    !value ||
    !hasExactKeys(value, AUDIT_KEYS) ||
    value.id !== input.auditEventId ||
    value.workspaceId !== input.request.workspaceId ||
    value.actorUid !== input.actorUid ||
    value.actorType !== "user" ||
    value.action !== input.action ||
    value.resourceType !== "campaign" ||
    value.resourceId !== input.request.campaignId ||
    value.outcome !== "allowed" ||
    value.requestId !== input.idempotencyId ||
    value.synthetic !== true ||
    value.schemaVersion !== 1 ||
    timestampMillis(value.occurredAt) !== input.occurredAtMillis ||
    timestampMillis(value.createdAt) !== input.occurredAtMillis ||
    !metadata ||
    typeof metadata !== "object" ||
    Array.isArray(metadata) ||
    !hasExactKeys(metadata as DocumentData, AUDIT_METADATA_KEYS) ||
    metadata.purpose !== "campaign_governance" ||
    metadata.campaignAction !== input.request.action ||
    metadata.fromState !== input.event.fromState ||
    metadata.toState !== input.result.state ||
    metadata.revision !== input.result.revision ||
    metadata.checkpointId !== input.result.checkpointId ||
    metadata.batchEligibleCount !== input.result.batchEligibleCount ||
    metadata.processedEligible !== input.result.processedEligible ||
    metadata.scanOffset !== input.result.scanOffset ||
    metadata.dispatchMode !== "simulation" ||
    metadata.synthetic !== true ||
    metadata.externalCalls !== 0 ||
    metadata.networkCalls !== 0
  ) {
    throw new FailClosedError(
      "idempotency_conflict",
      "Durable campaign audit evidence does not match this replay.",
    );
  }
}

async function replayExistingControl(input: {
  readonly db: Firestore;
  readonly transaction: Transaction;
  readonly idempotency: DocumentData;
  readonly campaign: ParsedSyntheticCampaign;
  readonly rawCampaign: DocumentData | undefined;
  readonly snapshot: ParsedSyntheticAudienceSnapshot;
  readonly event: DocumentData | undefined;
  readonly request: SyntheticCampaignControlInput;
  readonly actorUid: string;
  readonly action: string;
  readonly requestHash: string;
  readonly idempotencyId: string;
  readonly eventId: string;
}): Promise<SyntheticCampaignControlResponse> {
  const stored = input.idempotency;
  const occurredAtMillis = timestampMillis(stored.createdAt);
  if (
    !hasExactKeys(stored, IDEMPOTENCY_KEYS) ||
    stored.id !== input.idempotencyId ||
    stored.workspaceId !== input.request.workspaceId ||
    stored.actorUid !== input.actorUid ||
    stored.action !== input.action ||
    stored.purpose !== "campaign_governance" ||
    stored.requestHash !== input.requestHash ||
    stored.eventId !== input.eventId ||
    (stored.checkpointId !== null &&
      (typeof stored.checkpointId !== "string" || !SAFE_ID.test(stored.checkpointId))) ||
    stored.synthetic !== true ||
    stored.schemaVersion !== 1 ||
    occurredAtMillis === null ||
    typeof stored.auditEventId !== "string" ||
    !SAFE_ID.test(stored.auditEventId)
  ) {
    throw new FailClosedError(
      "idempotency_conflict",
      "The idempotency key is already bound to another campaign request.",
    );
  }
  const result = parseStoredCampaignControlResult(stored.result, {
    campaignId: input.request.campaignId,
    action: input.request.action,
  });
  if (
    result.eventId !== input.eventId ||
    result.checkpointId !== stored.checkpointId ||
    result.revision !== input.request.expectedRevision + 1
  ) {
    throw new FailClosedError(
      "idempotency_conflict",
      "Stored campaign result does not match this replay.",
    );
  }
  assertCurrentCampaignCompatibleWithResult({
    campaign: input.campaign,
    raw: input.rawCampaign,
    result,
    occurredAtMillis,
  });
  assertStoredEvent({
    value: input.event,
    request: input.request,
    actorUid: input.actorUid,
    eventId: input.eventId,
    result,
    occurredAtMillis,
  });
  if (result.checkpointId !== null) {
    const checkpoint = await input.transaction.get(
      input.db.doc(
        `workspaces/${input.request.workspaceId}/campaignCheckpoints/${result.checkpointId}`,
      ),
    );
    assertStoredCheckpoint({
      value: checkpoint.data(),
      campaign: input.campaign,
      snapshot: input.snapshot,
      checkpointId: result.checkpointId,
      eventId: result.eventId,
      occurredAtMillis,
      replayResult: result,
    });
  }
  const audit = await input.transaction.get(
    input.db.doc(
      `workspaces/${input.request.workspaceId}/auditEvents/${stored.auditEventId}`,
    ),
  );
  assertStoredAudit({
    value: audit.data(),
    request: input.request,
    actorUid: input.actorUid,
    action: input.action,
    idempotencyId: input.idempotencyId,
    auditEventId: stored.auditEventId,
    result,
    event: input.event ?? {},
    occurredAtMillis,
  });
  return { result, auditEventId: stored.auditEventId, replayed: true };
}

export async function controlSyntheticCampaign(rawInput: {
  readonly db: Firestore;
  readonly config: RuntimeConfig;
  readonly emulator: CampaignEmulatorBoundary;
  readonly actor: AuthenticatedActor;
  readonly request: SyntheticCampaignControlInput;
  readonly now?: Date;
}): Promise<SyntheticCampaignControlResponse> {
  const request = parseSyntheticCampaignControlInput(rawInput.request);
  assertSyntheticCampaignRuntimeBoundary(rawInput.config, request.workspaceId);
  assertDemoAuditEmulatorBoundary(rawInput.emulator);
  const now = rawInput.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new FailClosedError("invalid_service_request", "Campaign request time is invalid.");
  }
  const action = actionName(request.action);
  const requestHash = fingerprintServiceRequest({
    workspaceId: request.workspaceId,
    campaignId: request.campaignId,
    action: request.action,
    expectedRevision: request.expectedRevision,
  });
  const idempotencyId = idempotencyDocumentId({
    workspaceId: request.workspaceId,
    uid: rawInput.actor.uid,
    action,
    key: request.idempotencyKey,
  });
  const eventId = deterministicId("campaign-event", idempotencyId);

  const workspaceRef = rawInput.db.doc(`workspaces/${request.workspaceId}`);
  const membershipRef = rawInput.db.doc(
    `workspaces/${request.workspaceId}/members/${rawInput.actor.uid}`,
  );
  const campaignRef = rawInput.db.doc(
    `workspaces/${request.workspaceId}/campaigns/${request.campaignId}`,
  );
  const snapshotRef = rawInput.db.doc(
    `workspaces/${request.workspaceId}/audienceSnapshots/${SYNTHETIC_AUDIENCE_SNAPSHOT_ID}`,
  );
  const enTemplateRef = rawInput.db.doc(
    `workspaces/${request.workspaceId}/templates/${SYNTHETIC_CAMPAIGN_TEMPLATE_IDS.en}`,
  );
  const siTemplateRef = rawInput.db.doc(
    `workspaces/${request.workspaceId}/templates/${SYNTHETIC_CAMPAIGN_TEMPLATE_IDS.si}`,
  );
  const taTemplateRef = rawInput.db.doc(
    `workspaces/${request.workspaceId}/templates/${SYNTHETIC_CAMPAIGN_TEMPLATE_IDS.ta}`,
  );
  const eventRef = rawInput.db.doc(
    `workspaces/${request.workspaceId}/campaignEvents/${eventId}`,
  );
  const idempotencyRef = rawInput.db.doc(
    `workspaces/${request.workspaceId}/idempotencyKeys/${idempotencyId}`,
  );

  return rawInput.db.runTransaction(async (transaction) => {
    const [
      workspaceSnapshot,
      membershipSnapshot,
      campaignSnapshot,
      audienceSnapshot,
      enTemplate,
      siTemplate,
      taTemplate,
      eventSnapshot,
      idempotencySnapshot,
    ] = await Promise.all([
      transaction.get(workspaceRef),
      transaction.get(membershipRef),
      transaction.get(campaignRef),
      transaction.get(snapshotRef),
      transaction.get(enTemplateRef),
      transaction.get(siTemplateRef),
      transaction.get(taTemplateRef),
      transaction.get(eventRef),
      transaction.get(idempotencyRef),
    ]);

    const workspace = workspaceSnapshot.data();
    assertSyntheticWorkspace(workspace, request.workspaceId);
    const context = assertWorkspaceAuthorization({
      workspaceId: request.workspaceId,
      actor: rawInput.actor,
      workspace,
      membership: membershipSnapshot.data(),
      policy: {
        allowedRoles: ["tenant_admin", "campaign_operator"],
        recentAuthMaxAgeSeconds: 900,
      },
      now,
    });
    const rawCampaign = campaignSnapshot.data();
    const campaign = parseStoredSyntheticCampaign(rawCampaign, {
      workspaceId: request.workspaceId,
      campaignId: request.campaignId,
    });
    assertOwnerPolicy({ actorUid: context.uid, role: context.role, campaign });
    const snapshot = parseStoredSyntheticAudienceSnapshot(audienceSnapshot.data(), {
      workspaceId: request.workspaceId,
      snapshotId: campaign.audienceSnapshotId,
    });
    const governedTemplates = {
      en: assertStoredSyntheticCampaignTemplate(enTemplate.data(), {
      workspaceId: request.workspaceId,
      templateId: campaign.templateVersionIds.en,
      language: "en",
      }),
      si: assertStoredSyntheticCampaignTemplate(siTemplate.data(), {
      workspaceId: request.workspaceId,
      templateId: campaign.templateVersionIds.si,
      language: "si",
      }),
      ta: assertStoredSyntheticCampaignTemplate(taTemplate.data(), {
      workspaceId: request.workspaceId,
      templateId: campaign.templateVersionIds.ta,
      language: "ta",
      }),
    } as const;
    assertCampaignApprovalBinding({ campaign, snapshot, templates: governedTemplates });
    const [owner, approver] = await Promise.all([
      transaction.get(
        rawInput.db.doc(
          `workspaces/${request.workspaceId}/members/${campaign.ownerId}`,
        ),
      ),
      transaction.get(
        rawInput.db.doc(
          `workspaces/${request.workspaceId}/members/${campaign.approval.approverId}`,
        ),
      ),
    ]);
    assertSyntheticOwner(owner.data(), request.workspaceId);
    assertSyntheticApprover(approver.data(), request.workspaceId);

    if (campaign.lastCheckpointId !== null) {
      const previousCheckpoint = await transaction.get(
        rawInput.db.doc(
          `workspaces/${request.workspaceId}/campaignCheckpoints/${campaign.lastCheckpointId}`,
        ),
      );
      assertStoredCheckpoint({
        value: previousCheckpoint.data(),
        campaign,
        snapshot,
        checkpointId: campaign.lastCheckpointId,
        bindCurrentProgress: true,
      });
    }

    if (idempotencySnapshot.exists) {
      return replayExistingControl({
        db: rawInput.db,
        transaction,
        idempotency: idempotencySnapshot.data() ?? {},
        campaign,
        rawCampaign,
        snapshot,
        event: eventSnapshot.data(),
        request,
        actorUid: context.uid,
        action,
        requestHash,
        idempotencyId,
        eventId,
      });
    }
    if (eventSnapshot.exists) {
      throw new FailClosedError(
        "campaign_event_collision",
        "The deterministic campaign event ID is already in use.",
      );
    }
    if (campaign.revision !== request.expectedRevision) {
      throw new FailClosedError(
        "campaign_revision_conflict",
        "The campaign changed since this request was prepared.",
      );
    }

    const transition = planTransition({ campaign, snapshot, action: request.action });
    const checkpointRef = transition.checkpointId === null
      ? null
      : rawInput.db.doc(
        `workspaces/${request.workspaceId}/campaignCheckpoints/${transition.checkpointId}`,
      );
    if (checkpointRef) {
      const checkpointCollision = await transaction.get(checkpointRef);
      if (checkpointCollision.exists) {
        throw new FailClosedError(
          "campaign_checkpoint_collision",
          "The deterministic campaign checkpoint ID is already in use.",
        );
      }
    }

    const revision = campaign.revision + 1;
    const result: SyntheticCampaignControlResult = {
      campaignId: campaign.id,
      eventId,
      checkpointId: transition.checkpointId,
      action: request.action,
      state: transition.toState,
      revision,
      canaryStatus: transition.canaryStatus,
      processedEligible: transition.processedEligible,
      scanOffset: transition.scanOffset,
      nextBatchIndex: transition.nextBatchIndex,
      batchEligibleCount: transition.batchEligibleCount,
      synthetic: true,
      externalCalls: 0,
      networkCalls: 0,
    };
    const auditEvent = createTenantAuditEvent({
      tenantId: request.workspaceId,
      actor: { type: "user", id: context.uid },
      action,
      resource: { type: "campaign", id: campaign.id },
      outcome: "allowed",
      requestId: idempotencyId,
      occurredAt: now,
      metadata: {
        purpose: "campaign_governance",
        campaignAction: request.action,
        fromState: transition.fromState,
        toState: transition.toState,
        revision,
        checkpointId: transition.checkpointId,
        batchEligibleCount: transition.batchEligibleCount,
        processedEligible: transition.processedEligible,
        scanOffset: transition.scanOffset,
        dispatchMode: "simulation",
        synthetic: true,
        externalCalls: 0,
        networkCalls: 0,
      },
    });
    const auditRef = rawInput.db.doc(
      `workspaces/${request.workspaceId}/auditEvents/${auditEvent.id}`,
    );

    transaction.update(campaignRef, {
      state: transition.toState,
      revision,
      canaryStatus: transition.canaryStatus,
      processedEligible: transition.processedEligible,
      scanOffset: transition.scanOffset,
      nextBatchIndex: transition.nextBatchIndex,
      lastCheckpointId:
        transition.checkpointId === null
          ? campaign.lastCheckpointId
          : transition.checkpointId,
      externalCalls: 0,
      networkCalls: 0,
      updatedAt: now,
    });
    transaction.create(eventRef, {
      id: eventId,
      workspaceId: request.workspaceId,
      campaignId: campaign.id,
      actorUid: context.uid,
      action: request.action,
      fromState: transition.fromState,
      toState: transition.toState,
      revision,
      checkpointId: transition.checkpointId,
      externalCalls: 0,
      networkCalls: 0,
      synthetic: true,
      schemaVersion: 1,
      createdAt: now,
    });
    // This boundary persists aggregate simulator evidence only: no recipients,
    // provider identifiers, outbound adapter calls or network work are permitted.
    if (checkpointRef && transition.batch && transition.checkpointId) {
      transaction.create(checkpointRef, {
        id: transition.checkpointId,
        workspaceId: request.workspaceId,
        campaignId: campaign.id,
        eventId,
        batchIndex: campaign.nextBatchIndex,
        sourceOffsetStart: transition.batch.sourceOffsetStart,
        sourceOffsetEnd: transition.batch.sourceOffsetEnd,
        eligibleCount: transition.batch.eligibleCount,
        languageCounts: transition.batch.languageCounts,
        processedEligible: transition.processedEligible,
        scanComplete: transition.batch.scanComplete,
        digest: transition.batch.digest,
        externalCalls: 0,
        networkCalls: 0,
        synthetic: true,
        schemaVersion: 1,
        createdAt: now,
      });
    }
    transaction.create(auditRef, toFirestoreAuditRecord(auditEvent));
    transaction.create(idempotencyRef, {
      id: idempotencyId,
      workspaceId: request.workspaceId,
      actorUid: context.uid,
      action,
      purpose: "campaign_governance",
      requestHash,
      eventId,
      checkpointId: transition.checkpointId,
      result,
      auditEventId: auditEvent.id,
      createdAt: now,
      synthetic: true,
      schemaVersion: 1,
    });
    return { result, auditEventId: auditEvent.id, replayed: false };
  });
}
