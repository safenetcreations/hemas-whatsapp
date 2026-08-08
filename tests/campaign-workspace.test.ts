import { describe, expect, it, vi } from "vitest";
import {
  assertCampaignActionEvidence,
  assembleCampaignWorkspaceRecord,
  availableCampaignActions,
  CampaignWorkspaceDataError,
  campaignWorkspaceAuthorityKey,
  loadCampaignWorkspace,
  roleCanReadCampaignWorkspace,
  type CampaignWorkspaceReads,
  type CampaignWorkspaceRecord,
  type CampaignActionAuditEvidence,
} from "@/components/campaigns/campaign-workspace-data";
import { planSyntheticAggregateBatch } from "@/components/campaigns/campaign-aggregate-validator";
import type { CampaignFunctionsResponse } from "@/lib/firebase/campaign-functions-emulator";
import type {
  AudienceSnapshotDTO,
  CampaignCheckpointDTO,
  CampaignDTO,
  CampaignEventDTO,
  TemplateCatalogueItemDTO,
} from "@/lib/firebase/repositories";
import type { VerifiedWorkspaceSession } from "@/lib/firebase/workspace-session-model";

const workspaceId = "workspace_safenet_demo";
const campaignId = "campaign_synthetic_50k";
const snapshotId = "audience_synthetic_50k_v1";
const createdAt = "2026-08-07T05:00:00.000Z";

function session(
  overrides: Partial<VerifiedWorkspaceSession> = {},
): VerifiedWorkspaceSession {
  const role = overrides.role ?? "campaign_operator";
  return {
    workspaceId,
    workspaceName: "SafeNet local demo",
    workspaceMode: "demo",
    dataClassification: "synthetic_only",
    uid: "user_demo_campaign_operator",
    displayLabel: "Synthetic campaign operator",
    role,
    scopeMode: overrides.scopeMode ?? (role === "tenant_admin" ? "workspace_wide" : "assigned"),
    teamIds: [],
    locationIds: [],
    ...overrides,
  };
}

function campaign(overrides: Partial<CampaignDTO> = {}): CampaignDTO {
  return {
    id: campaignId,
    workspaceId,
    name: "Synthetic 50,000-contact wellness awareness simulation",
    purpose: "health_campaigns",
    messageCategory: "marketing",
    targetAction: "Open the synthetic wellness information journey",
    ownerId: "user_demo_campaign_operator",
    templateVersionIds: {
      en: "template_wellness_awareness_en_v3",
      si: "template_wellness_awareness_si_v3",
      ta: "template_wellness_awareness_ta_v3",
    },
    audienceSnapshotId: snapshotId,
    state: "scheduled",
    dispatchMode: "simulation",
    schedule: {
      startsAt: "2026-08-10T03:30:00.000Z",
      timeZone: "Asia/Colombo",
      quietHours: { startsAtLocal: "20:00", endsAtLocal: "08:00" },
    },
    approval: {
      required: true,
      status: "approved",
      scope: "simulation_only",
      approverId: "user_demo_campaign_approver",
      reviewedAt: createdAt,
      approvedContentHash:
        "6bdce27c7e31e5e064febd7b4dcbd05df208a4ddf33085003848bbfd81c1b1cd",
    },
    revision: 0,
    canaryStatus: "not_run",
    processedEligible: 0,
    scanOffset: 0,
    nextBatchIndex: 0,
    batchSize: 1_000,
    lastCheckpointId: null,
    externalCalls: 0,
    networkCalls: 0,
    synthetic: true,
    schemaVersion: 1,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function audience(
  overrides: Partial<AudienceSnapshotDTO> = {},
): AudienceSnapshotDTO {
  return {
    id: snapshotId,
    workspaceId,
    campaignId,
    criteriaSummary:
      "Synthetic consented wellness audience; deterministic aggregate exclusions only.",
    totalEvaluated: 50_000,
    eligibleCount: 38_443,
    excludedCount: 11_557,
    unknownConsentCount: 3_588,
    exclusionsByReason: {
      frequency_cap: 3_873,
      consent_missing: 3_588,
      suppressed: 2_915,
      duplicate: 444,
      invalid_contact: 442,
      language_unavailable: 295,
    },
    languageCounts: { en: 26_989, si: 12_038, ta: 10_973 },
    contentHash:
      "7a4d8ce2bc1bafc224e5e2b91a2fc3f8b20b5f062ff1563ca4cf25847ad0d550",
    immutable: true,
    synthetic: true,
    schemaVersion: 1,
    finalizedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function template(language: "en" | "si" | "ta"): TemplateCatalogueItemDTO {
  const copy = {
    en: {
      body: "{{patient_ref}}, this approved internal synthetic template shares wellness awareness information about {{campaign_topic}}.",
      footer: "Reply STOP to stop marketing messages.",
      contentHash:
        "0cbf38327d7d48ee61558927c6afb8e4e75c1781561906ebbab4def379e6c04f",
    },
    si: {
      body: "{{patient_ref}}, {{campaign_topic}} පිළිබඳ සුවතා දැනුවත් කිරීම සඳහා අභ්‍යන්තරව අනුමත කළ කෘත්‍රිම ආදර්ශය මෙයයි.",
      footer: "අලෙවිකරණ පණිවිඩ නැවැත්වීමට STOP යවන්න.",
      contentHash:
        "cefbdf676d18b06dfcc4263e659c0585db48de7e7843b57b32566d2215536582",
    },
    ta: {
      body: "{{patient_ref}}, {{campaign_topic}} குறித்த நலவாழ்வு விழிப்புணர்வுக்காக உள்நிலையில் அங்கீகரிக்கப்பட்ட செயற்கை வார்ப்புரு இது.",
      footer: "சந்தைப்படுத்தல் செய்திகளை நிறுத்த STOP எனப் பதிலளிக்கவும்.",
      contentHash:
        "c477a31ee0344bef6c66a25a0a70848f6a0a75262f0df328dd8b04e6479a2b12",
    },
  } as const;
  return {
    id: `template_wellness_awareness_${language}_v3`,
    workspaceId,
    assetKey: "wellness_awareness",
    sortKey: `wellness_awareness:${language}:0003`,
    providerName: "wellness_awareness",
    category: "marketing",
    language,
    version: 3,
    localState: "approved",
    providerState: {
      submissionState: "not_submitted",
      approvalState: "unverified",
      authority: "none",
      assetId: null,
      qualityRating: "unknown",
      checkedAt: null,
    },
    immutable: true,
    contentHash: copy[language].contentHash,
    components: [
      { kind: "body", text: copy[language].body },
      { kind: "footer", text: copy[language].footer },
    ],
    variableRules: [
      {
        key: "patient_ref",
        description: "Masked synthetic patient reference",
        required: true,
        maxLength: 24,
        exampleValue: "SYN-P000862",
        allowedPattern: "^SYN-P[0-9]{6}$",
      },
      {
        key: "campaign_topic",
        description: "Approved neutral campaign topic",
        required: true,
        maxLength: 70,
        exampleValue: "Dengue prevention",
        allowedPattern: null,
      },
    ],
    ownership: {
      ownerKind: "safenet_demo",
      ownerWorkspaceId: workspaceId,
      transferableToHemas: false,
      productionUseAllowed: false,
      notice:
        "SafeNet demo asset. It is not a Hemas-owned or transferable production asset.",
    },
    synthetic: true,
    schemaVersion: 1,
    createdAt,
    updatedAt: createdAt,
  };
}

const templates = [template("en"), template("si"), template("ta")] as const;

async function firstCheckpoint(
  eventId: string,
  timestamp: string,
): Promise<CampaignCheckpointDTO> {
  const plan = await planSyntheticAggregateBatch({
    workspaceId,
    campaignId,
    snapshotContentHash: audience().contentHash,
    approvalContentHash: campaign().approval.approvedContentHash,
    batchIndex: 0,
    sourceOffset: 0,
  });
  return {
    id: `${campaignId}:checkpoint:000000`,
    workspaceId,
    campaignId,
    eventId,
    batchIndex: 0,
    ...plan,
    processedEligible: plan.eligibleCount,
    externalCalls: 0,
    networkCalls: 0,
    synthetic: true,
    schemaVersion: 1,
    createdAt: timestamp,
  };
}

function lifecycleEvent(
  overrides: Partial<CampaignEventDTO> & Pick<CampaignEventDTO, "id" | "action" | "revision">,
): CampaignEventDTO {
  return {
    workspaceId,
    campaignId,
    actorUid: "user_demo_campaign_operator",
    fromState: "scheduled",
    toState: "scheduled",
    checkpointId: null,
    externalCalls: 0,
    networkCalls: 0,
    synthetic: true,
    schemaVersion: 1,
    createdAt,
    ...overrides,
  };
}

function actionAudit(
  response: CampaignFunctionsResponse,
  previousState: CampaignDTO["state"],
): CampaignActionAuditEvidence {
  return {
    id: response.auditEventId,
    workspaceId,
    actorType: "user",
    actorUid: "user_demo_campaign_operator",
    action: `campaign.${response.result.action}`,
    resourceType: "campaign",
    resourceId: campaignId,
    outcome: "allowed",
    requestId: "idempotency-0123456789abcdef",
    occurredAt: createdAt,
    createdAt,
    metadata: {
      purpose: "campaign_governance",
      campaignAction: response.result.action,
      fromState: previousState as
        | "scheduled"
        | "dispatching"
        | "paused"
        | "completed"
        | "cancelled"
        | "failed",
      toState: response.result.state,
      revision: response.result.revision,
      checkpointId: response.result.checkpointId,
      batchEligibleCount: response.result.batchEligibleCount,
      processedEligible: response.result.processedEligible,
      scanOffset: response.result.scanOffset,
      dispatchMode: "simulation",
      synthetic: true,
      externalCalls: 0,
      networkCalls: 0,
    },
    synthetic: true,
    schemaVersion: 1,
  };
}

async function record(input: {
  campaign?: CampaignDTO;
  audience?: AudienceSnapshotDTO;
  templates?: readonly TemplateCatalogueItemDTO[];
  events?: readonly CampaignEventDTO[];
  checkpoints?: readonly CampaignCheckpointDTO[];
  latestCheckpointEvent?: CampaignEventDTO | null;
  session?: VerifiedWorkspaceSession;
} = {}): Promise<CampaignWorkspaceRecord> {
  return assembleCampaignWorkspaceRecord({
    session: input.session ?? session(),
    bundle: {
      campaign: input.campaign ?? campaign(),
      audienceSnapshot: input.audience ?? audience(),
    },
    templates: input.templates ?? templates,
    events: input.events ?? [],
    checkpoints: input.checkpoints ?? [],
    latestCheckpointEvent: input.latestCheckpointEvent ?? null,
  });
}

describe("authenticated persisted campaign workspace", () => {
  it("matches the exact four-role Firestore read surface", () => {
    for (const role of [
      "tenant_admin",
      "campaign_operator",
      "campaign_approver",
      "analyst",
    ] as const) {
      expect(roleCanReadCampaignWorkspace(role)).toBe(true);
    }
    for (const role of [
      "supervisor",
      "privacy_reviewer",
      "agent",
      "clinical_approver",
      "platform_owner",
    ] as const) {
      expect(roleCanReadCampaignWorkspace(role)).toBe(false);
    }
    expect(campaignWorkspaceAuthorityKey(session())).not.toBe(
      campaignWorkspaceAuthorityKey(session({ role: "agent" })),
    );
  });

  it.each([
    "supervisor",
    "privacy_reviewer",
    "agent",
    "clinical_approver",
  ] as const)("denies %s before any repository read", async (role) => {
    const reads: CampaignWorkspaceReads = {
      listCampaigns: vi.fn(),
      getBundle: vi.fn(),
      getTemplate: vi.fn(),
      listEvents: vi.fn(),
      listCheckpoints: vi.fn(),
      getEvent: vi.fn(),
    };
    await expect(
      loadCampaignWorkspace({} as never, session({ role }), reads),
    ).rejects.toMatchObject({ code: "access_denied" });
    for (const read of Object.values(reads)) expect(read).not.toHaveBeenCalled();
  });

  it("assembles only the exact tenant, audience, approval, and trilingual template joins", async () => {
    const assembled = await record();
    expect(assembled.campaign.id).toBe(campaignId);
    expect(assembled.audience.totalEvaluated).toBe(50_000);
    expect(assembled.templates.map((item) => item.language)).toEqual(["en", "si", "ta"]);
    expect(JSON.stringify(assembled)).not.toMatch(/recipient|phone|hmac/i);

    for (const invalid of [
      () => record({ audience: audience({ workspaceId: "workspace_other" }) }),
      () => record({ audience: audience({ campaignId: "campaign_other" }) }),
      () => record({ templates: templates.slice(0, 2) }),
      () =>
        record({
          templates: [
            { ...templates[0], workspaceId: "workspace_other" },
            templates[1],
            templates[2],
          ],
        }),
      () =>
        record({
          campaign: campaign({
            approval: {
              ...campaign().approval,
              approvedContentHash: "0".repeat(64),
            },
          }),
        }),
    ]) {
      await expect(invalid()).rejects.toMatchObject({ code: "invalid_join" });
    }
  });

  it("fails closed on any fixed 50,000-demo campaign or aggregate drift", async () => {
    const campaignDrifts: CampaignDTO[] = [
      campaign({ name: "Another campaign" }),
      campaign({ ownerId: "operator_other" }),
      campaign({ purpose: "event_campaigns" }),
      campaign({ targetAction: "Different target" }),
      campaign({ audienceSnapshotId: "audience_other" }),
      campaign({
        templateVersionIds: {
          ...campaign().templateVersionIds,
          en: "template_other_en_v3",
        },
      }),
      campaign({
        schedule: { ...campaign().schedule, startsAt: "2026-08-11T03:30:00.000Z" },
      }),
      campaign({
        schedule: {
          ...campaign().schedule,
          quietHours: { startsAtLocal: "21:00", endsAtLocal: "08:00" },
        },
      }),
      { ...campaign(), batchSize: 500 } as unknown as CampaignDTO,
      { ...campaign(), nextBatchIndex: 40 } as CampaignDTO,
    ];
    for (const value of campaignDrifts) {
      await expect(record({ campaign: value })).rejects.toMatchObject({
        code: "invalid_join",
      });
    }

    const countFields = [
      "totalEvaluated",
      "eligibleCount",
      "excludedCount",
      "unknownConsentCount",
    ] as const;
    for (const field of countFields) {
      await expect(
        record({ audience: audience({ [field]: audience()[field] - 1 }) }),
      ).rejects.toMatchObject({ code: "invalid_join" });
    }
    for (const reason of Object.keys(audience().exclusionsByReason) as Array<
      keyof AudienceSnapshotDTO["exclusionsByReason"]
    >) {
      await expect(
        record({
          audience: audience({
            exclusionsByReason: {
              ...audience().exclusionsByReason,
              [reason]: audience().exclusionsByReason[reason] + 1,
            },
          }),
        }),
      ).rejects.toMatchObject({ code: "invalid_join" });
    }
    for (const language of ["en", "si", "ta"] as const) {
      await expect(
        record({
          audience: audience({
            languageCounts: {
              ...audience().languageCounts,
              [language]: audience().languageCounts[language] + 1,
            },
          }),
        }),
      ).rejects.toMatchObject({ code: "invalid_join" });
    }
    await expect(
      record({ audience: audience({ id: "audience_other" }) }),
    ).rejects.toMatchObject({ code: "invalid_join" });
    await expect(
      record({ audience: audience({ contentHash: "f".repeat(64) }) }),
    ).rejects.toMatchObject({ code: "invalid_join" });
  });

  it.each(["en", "si", "ta"] as const)(
    "rejects %s template body drift and stored-hash drift independently",
    async (language) => {
      const index = { en: 0, si: 1, ta: 2 }[language];
      const selected = templates[index];
      const bodyDrift = {
        ...selected,
        components: selected.components.map((component, componentIndex) =>
          componentIndex === 0 && component.kind === "body"
            ? { ...component, text: `${component.text} drift` }
            : component,
        ),
      };
      const hashDrift = { ...selected, contentHash: "f".repeat(64) };
      for (const changed of [bodyDrift, hashDrift]) {
        const changedTemplates = [...templates];
        changedTemplates[index] = changed as TemplateCatalogueItemDTO;
        await expect(record({ templates: changedTemplates })).rejects.toMatchObject({
          code: "invalid_join",
        });
      }
    },
  );

  it("rejects malformed state/canary/progress relations", async () => {
    const invalidCampaigns = [
      campaign({ canaryStatus: "failed" }),
      campaign({ state: "dispatching", canaryStatus: "not_run" }),
      campaign({ state: "paused", canaryStatus: "failed" }),
      campaign({ state: "failed", canaryStatus: "passed_simulation" }),
      campaign({ state: "draft" }),
    ];
    for (const value of invalidCampaigns) {
      await expect(record({ campaign: value })).rejects.toMatchObject({
        code: "invalid_join",
      });
    }
  });

  it("rejects impossible adjacent state chains and backwards event time", async () => {
    const canaryEvent = lifecycleEvent({
      id: "campaign-event-chain-canary",
      action: "run_canary",
      revision: 1,
    });
    const startEvent = lifecycleEvent({
      id: "campaign-event-chain-start",
      action: "start",
      revision: 2,
      toState: "dispatching",
    });
    const current = campaign({
      state: "dispatching",
      canaryStatus: "passed_simulation",
      revision: 2,
    });
    await expect(
      record({
        campaign: current,
        events: [{ ...startEvent, fromState: "paused" }, canaryEvent],
      }),
    ).rejects.toMatchObject({ code: "invalid_join" });
    await expect(
      record({
        campaign: current,
        events: [
          { ...startEvent, createdAt: "2026-08-07T04:59:59.000Z" },
          canaryEvent,
        ],
      }),
    ).rejects.toMatchObject({ code: "invalid_join" });
  });

  it("binds current campaign time to the latest event and rejects reversed campaign time", async () => {
    const latestEvent = lifecycleEvent({
      id: "campaign-event-current-time",
      action: "run_canary",
      revision: 1,
      createdAt: "2026-08-07T05:00:01.000Z",
    });
    await expect(
      record({
        campaign: campaign({
          revision: 1,
          canaryStatus: "passed_simulation",
        }),
        events: [latestEvent],
      }),
    ).rejects.toMatchObject({ code: "invalid_join" });
    await expect(
      record({
        campaign: campaign({
          createdAt: "2026-08-07T05:00:01.000Z",
          updatedAt: "2026-08-07T05:00:00.000Z",
        }),
      }),
    ).rejects.toMatchObject({ code: "invalid_join" });
  });

  it("requires the exact latest revision window row count", async () => {
    const events: CampaignEventDTO[] = [
      lifecycleEvent({
        id: "campaign-event-window-1",
        action: "run_canary",
        revision: 1,
      }),
      lifecycleEvent({
        id: "campaign-event-window-2",
        action: "start",
        revision: 2,
        toState: "dispatching",
      }),
    ];
    let state: "dispatching" | "paused" = "dispatching";
    for (let revision = 3; revision <= 10; revision += 1) {
      const fromState = state;
      const action = state === "dispatching" ? "pause" : "resume";
      state = state === "dispatching" ? "paused" : "dispatching";
      events.push(
        lifecycleEvent({
          id: `campaign-event-window-${revision}`,
          action,
          revision,
          fromState,
          toState: state,
          createdAt: new Date(Date.parse(createdAt) + revision).toISOString(),
        }),
      );
    }
    const revisionTen = campaign({
      state,
      canaryStatus: "passed_simulation",
      revision: 10,
      updatedAt: events.at(-1)!.createdAt,
    });
    await expect(record({ campaign: revisionTen, events })).resolves.toMatchObject({
      campaign: { revision: 10 },
    });
    await expect(
      record({ campaign: revisionTen, events: events.slice(1) }),
    ).rejects.toMatchObject({ code: "invalid_join" });

    const shortRevisionSixty: CampaignEventDTO[] = [];
    state = "dispatching";
    for (let revision = 51; revision <= 60; revision += 1) {
      const fromState = state;
      const action = state === "dispatching" ? "pause" : "resume";
      state = state === "dispatching" ? "paused" : "dispatching";
      shortRevisionSixty.push(
        lifecycleEvent({
          id: `campaign-event-short-${revision}`,
          action,
          revision,
          fromState,
          toState: state,
          createdAt: new Date(Date.parse(createdAt) + revision).toISOString(),
        }),
      );
    }
    await expect(
      record({
        campaign: campaign({
          state,
          canaryStatus: "passed_simulation",
          revision: 60,
        }),
        events: shortRevisionSixty,
      }),
    ).rejects.toMatchObject({ code: "invalid_join" });
  });

  it("exposes only service-valid actions for the controlling role and exact canary state", async () => {
    const scheduled = await record();
    expect(availableCampaignActions(session(), scheduled)).toEqual([
      "run_canary",
      "cancel",
    ]);
    const passed = await record({
      campaign: campaign({ canaryStatus: "passed_simulation" }),
    });
    expect(availableCampaignActions(session(), passed)).toEqual(["start", "cancel"]);
    expect(
      availableCampaignActions(session({ role: "campaign_approver" }), passed),
    ).toEqual([]);
    expect(
      availableCampaignActions(
        session({ uid: "operator_other" }),
        passed,
      ),
    ).toEqual([]);

    const malformed = {
      ...passed,
      campaign: { ...passed.campaign, canaryStatus: "failed" as const },
    };
    expect(availableCampaignActions(session(), malformed)).toEqual([]);
  });

  it("returns a genuine empty result without reading fixtures or related collections", async () => {
    const reads: CampaignWorkspaceReads = {
      listCampaigns: vi.fn(async () => []),
      getBundle: vi.fn(),
      getTemplate: vi.fn(),
      listEvents: vi.fn(),
      listCheckpoints: vi.fn(),
      getEvent: vi.fn(),
    };
    await expect(
      loadCampaignWorkspace({} as never, session(), reads),
    ).resolves.toEqual({ campaigns: [], selected: null });
    expect(reads.listCampaigns).toHaveBeenCalledOnce();
    for (const read of [
      reads.getBundle,
      reads.getTemplate,
      reads.listEvents,
      reads.listCheckpoints,
      reads.getEvent,
    ]) {
      expect(read).not.toHaveBeenCalled();
    }
  });

  it("fails a polluted list record before any snapshot, template, event, or checkpoint read", async () => {
    const polluted = campaign({
      templateVersionIds: {
        ...campaign().templateVersionIds,
        en: "template_unrelated_en_v3",
      },
    });
    const reads: CampaignWorkspaceReads = {
      listCampaigns: vi.fn(async () => [polluted]),
      getBundle: vi.fn(),
      getTemplate: vi.fn(),
      listEvents: vi.fn(),
      listCheckpoints: vi.fn(),
      getEvent: vi.fn(),
    };
    await expect(
      loadCampaignWorkspace({} as never, session(), reads),
    ).rejects.toMatchObject({ code: "invalid_join" });
    expect(reads.listCampaigns).toHaveBeenCalledOnce();
    for (const read of [
      reads.getBundle,
      reads.getTemplate,
      reads.listEvents,
      reads.listCheckpoints,
      reads.getEvent,
    ]) {
      expect(read).not.toHaveBeenCalled();
    }
  });

  it("requires callable event, checkpoint, audit, revision, and progress to match the authoritative reload", async () => {
    const canaryEvent = lifecycleEvent({
      id: "campaign-event-canary",
      action: "run_canary",
      revision: 1,
    });
    const startEvent = lifecycleEvent({
      id: "campaign-event-start",
      action: "start",
      revision: 2,
      toState: "dispatching",
    });
    const advanceEvent = lifecycleEvent({
      id: "campaign-event-advance",
      action: "advance_batch",
      revision: 3,
      fromState: "dispatching",
      toState: "dispatching",
      checkpointId: `${campaignId}:checkpoint:000000`,
    });
    const checkpoint = await firstCheckpoint(advanceEvent.id, createdAt);
    const previous = await record({
      campaign: campaign({
        state: "dispatching",
        canaryStatus: "passed_simulation",
        revision: 2,
      }),
      events: [startEvent, canaryEvent],
    });
    const current = await record({
      campaign: campaign({
        state: "dispatching",
        canaryStatus: "passed_simulation",
        revision: 3,
        processedEligible: 1_000,
        scanOffset: checkpoint.sourceOffsetEnd,
        nextBatchIndex: 1,
        lastCheckpointId: checkpoint.id,
      }),
      events: [advanceEvent, startEvent, canaryEvent],
      checkpoints: [checkpoint],
    });
    const response: CampaignFunctionsResponse = {
      result: {
        campaignId,
        eventId: advanceEvent.id,
        checkpointId: checkpoint.id,
        action: "advance_batch",
        state: "dispatching",
        revision: 3,
        canaryStatus: "passed_simulation",
        processedEligible: 1_000,
        scanOffset: checkpoint.sourceOffsetEnd,
        nextBatchIndex: 1,
        batchEligibleCount: 1_000,
        synthetic: true,
        externalCalls: 0,
        networkCalls: 0,
      },
      auditEventId: "audit-campaign-advance-001",
      replayed: false,
    };
    const audit = actionAudit(response, "dispatching");
    expect(() =>
      assertCampaignActionEvidence({
        session: session(),
        previous,
        current,
        response,
        audit,
        immutable: { event: advanceEvent, checkpoint },
      }),
    ).not.toThrow();

    for (const invalid of [
      { response: { ...response, auditEventId: "audit-other" }, audit },
      {
        response: {
          ...response,
          result: { ...response.result, eventId: "campaign-event-other" },
        },
        audit,
      },
      {
        response: {
          ...response,
          result: { ...response.result, checkpointId: "checkpoint-other" },
        },
        audit,
      },
      {
        response,
        audit: {
          ...audit,
          metadata: { ...audit.metadata, processedEligible: 999 },
        },
      },
      {
        response,
        audit: { ...audit, occurredAt: "2026-08-07T05:00:01.000Z" },
      },
    ]) {
      expect(() =>
        assertCampaignActionEvidence({
          session: session(),
          previous,
          current,
          response: invalid.response as CampaignFunctionsResponse,
          audit: invalid.audit as CampaignActionAuditEvidence,
          immutable: { event: advanceEvent, checkpoint },
        }),
      ).toThrowError(expect.objectContaining({ code: "invalid_join" }));
    }
  });

  it("accepts an older deterministic replay only when immutable evidence matches a monotonic newer campaign", async () => {
    const previous = await record();
    const canaryEvent = lifecycleEvent({
      id: "campaign-event-cross-tab-canary",
      action: "run_canary",
      revision: 1,
    });
    const startEvent = lifecycleEvent({
      id: "campaign-event-cross-tab-start",
      action: "start",
      revision: 2,
      toState: "dispatching",
    });
    const current = await record({
      campaign: campaign({
        state: "dispatching",
        canaryStatus: "passed_simulation",
        revision: 2,
      }),
      events: [startEvent, canaryEvent],
    });
    const response: CampaignFunctionsResponse = {
      result: {
        campaignId,
        eventId: canaryEvent.id,
        checkpointId: null,
        action: "run_canary",
        state: "scheduled",
        revision: 1,
        canaryStatus: "passed_simulation",
        processedEligible: 0,
        scanOffset: 0,
        nextBatchIndex: 0,
        batchEligibleCount: 25,
        synthetic: true,
        externalCalls: 0,
        networkCalls: 0,
      },
      auditEventId: "audit-cross-tab-canary",
      replayed: true,
    };
    const audit = actionAudit(response, "scheduled");
    expect(() =>
      assertCampaignActionEvidence({
        session: session(),
        previous,
        current,
        response,
        audit,
        immutable: { event: canaryEvent, checkpoint: null },
      }),
    ).not.toThrow();

    expect(() =>
      assertCampaignActionEvidence({
        session: session(),
        previous,
        current: previous,
        response,
        audit,
        immutable: { event: canaryEvent, checkpoint: null },
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_join" }));
    expect(() =>
      assertCampaignActionEvidence({
        session: session(),
        previous,
        current,
        response,
        audit,
        immutable: {
          event: { ...canaryEvent, actorUid: "operator_other" },
          checkpoint: null,
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_join" }));
  });

  it("loads bounded persisted records and rejects a list/detail race", async () => {
    const baseCampaign = campaign();
    const reads: CampaignWorkspaceReads = {
      listCampaigns: vi.fn(async () => [baseCampaign]),
      getBundle: vi.fn(async () => ({
        campaign: baseCampaign,
        audienceSnapshot: audience(),
      })),
      getTemplate: vi.fn(async (_db, input) => {
        const found = templates.find((item) => item.id === input.templateId);
        if (!found) throw new Error("missing template fixture");
        return found;
      }),
      listEvents: vi.fn(async () => []),
      listCheckpoints: vi.fn(async () => []),
      getEvent: vi.fn(),
    };
    const loaded = await loadCampaignWorkspace({} as never, session(), reads);
    expect(loaded.selected?.campaign.id).toBe(campaignId);
    expect(reads.listCampaigns).toHaveBeenCalledWith(expect.anything(), {
      workspaceId,
      pageSize: 50,
    });

    const racingReads: CampaignWorkspaceReads = {
      ...reads,
      getBundle: vi.fn(async () => ({
        campaign: { ...baseCampaign, revision: 1 },
        audienceSnapshot: audience(),
      })),
    };
    await expect(
      loadCampaignWorkspace({} as never, session(), racingReads),
    ).rejects.toBeInstanceOf(CampaignWorkspaceDataError);
  });

  it("exact-gets an aged latest-checkpoint event without merging it into the contiguous latest-50 window", async () => {
    const eventTime = (revision: number) =>
      new Date(Date.parse(createdAt) + revision * 1_000).toISOString();
    const checkpointEvent = lifecycleEvent({
      id: "campaign-event-aged-checkpoint",
      action: "advance_batch",
      revision: 3,
      fromState: "dispatching",
      toState: "dispatching",
      checkpointId: `${campaignId}:checkpoint:000000`,
      createdAt: eventTime(3),
    });
    const checkpoint = await firstCheckpoint(checkpointEvent.id, eventTime(3));
    const recentEvents: CampaignEventDTO[] = [];
    let state: "dispatching" | "paused" = "dispatching";
    for (let revision = 4; revision <= 53; revision += 1) {
      const fromState = state;
      const action = state === "dispatching" ? "pause" : "resume";
      state = state === "dispatching" ? "paused" : "dispatching";
      recentEvents.push(
        lifecycleEvent({
          id: `campaign-event-cycle-${revision}`,
          action,
          revision,
          fromState,
          toState: state,
          createdAt: eventTime(revision),
        }),
      );
    }
    const currentCampaign = campaign({
      state,
      canaryStatus: "passed_simulation",
      revision: 53,
      processedEligible: 1_000,
      scanOffset: checkpoint.sourceOffsetEnd,
      nextBatchIndex: 1,
      lastCheckpointId: checkpoint.id,
      updatedAt: eventTime(53),
    });
    const reads: CampaignWorkspaceReads = {
      listCampaigns: vi.fn(async () => [currentCampaign]),
      getBundle: vi.fn(async () => ({
        campaign: currentCampaign,
        audienceSnapshot: audience(),
      })),
      getTemplate: vi.fn(async (_db, input) => {
        const found = templates.find((item) => item.id === input.templateId);
        if (!found) throw new Error("missing template fixture");
        return found;
      }),
      listEvents: vi.fn(async () => recentEvents),
      listCheckpoints: vi.fn(async () => [checkpoint]),
      getEvent: vi.fn(async () => checkpointEvent),
    };
    const loaded = await loadCampaignWorkspace({} as never, session(), reads);
    expect(loaded.selected?.campaign.revision).toBe(53);
    expect(loaded.selected?.events).toHaveLength(50);
    expect(loaded.selected?.events.some((event) => event.id === checkpointEvent.id)).toBe(false);
    expect(loaded.selected?.checkpoints[0]?.eventId).toBe(checkpointEvent.id);
    expect(reads.getEvent).toHaveBeenCalledOnce();
    expect(reads.getEvent).toHaveBeenCalledWith(expect.anything(), {
      workspaceId,
      campaignId,
      eventId: checkpointEvent.id,
    });

    const pollutedExactEvents = [
      { ...checkpointEvent, revision: 54 },
      { ...checkpointEvent, externalCalls: 1 },
      { ...checkpointEvent, networkCalls: 1 },
      { ...checkpointEvent, synthetic: false },
      { ...checkpointEvent, schemaVersion: 2 },
      { ...checkpointEvent, createdAt: "not-a-timestamp" },
    ] as unknown as readonly CampaignEventDTO[];
    for (const pollutedEvent of pollutedExactEvents) {
      await expect(
        loadCampaignWorkspace({} as never, session(), {
          ...reads,
          getEvent: vi.fn(async () => pollutedEvent),
        }),
      ).rejects.toMatchObject({ code: "invalid_join" });
    }

    await expect(
      loadCampaignWorkspace({} as never, session(), {
        ...reads,
        listEvents: vi.fn(async () => recentEvents.slice(1)),
      }),
    ).rejects.toMatchObject({ code: "invalid_join" });
    await expect(
      loadCampaignWorkspace({} as never, session(), {
        ...reads,
        getEvent: vi.fn(async () => ({
          ...checkpointEvent,
          revision: 4,
          createdAt: eventTime(4),
        })),
      }),
    ).rejects.toMatchObject({ code: "invalid_join" });
    await expect(
      loadCampaignWorkspace({} as never, session(), {
        ...reads,
        getEvent: vi.fn(async () => ({
          ...checkpointEvent,
          createdAt: eventTime(5),
        })),
      }),
    ).rejects.toMatchObject({ code: "invalid_join" });
  });
});
