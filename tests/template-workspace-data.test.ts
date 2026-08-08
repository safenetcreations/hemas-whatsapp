import type { Firestore } from "firebase/firestore";
import { describe, expect, it, vi } from "vitest";

import { safeFlowRenderers } from "@/components/templates/template-studio-data";
import {
  assembleTemplateWorkspace,
  loadTemplateWorkspace,
  roleCanReadTemplateCatalogue,
  selectVisibleTemplateAsset,
  type TemplateWorkspaceReads,
} from "@/components/templates/template-workspace-data";
import type {
  CatalogueLanguage,
  FlowCatalogueItemDTO,
  LocalAssetState,
  TemplateCatalogueItemDTO,
} from "@/lib/firebase/repositories";
import type {
  VerifiedWorkspaceSession,
  WorkspaceRole,
} from "@/lib/firebase/workspace-session-model";

const workspaceId = "workspace_safenet_demo";
const timestamp = "2026-08-07T13:00:00.000Z";
const firestore = {} as Firestore;

function session(
  overrides: Partial<VerifiedWorkspaceSession> = {},
): VerifiedWorkspaceSession {
  const role = overrides.role ?? "tenant_admin";
  return {
    workspaceId,
    workspaceName: "SafeNet local demo",
    workspaceMode: "demo",
    dataClassification: "synthetic_only",
    uid: "synthetic-admin-001",
    displayLabel: "Synthetic administrator",
    role,
    scopeMode: overrides.scopeMode ?? (role === "tenant_admin" ? "workspace_wide" : "assigned"),
    teamIds: [],
    locationIds: [],
    ...overrides,
  };
}

function ownership(ownerWorkspaceId = workspaceId) {
  return {
    ownerKind: "safenet_demo" as const,
    ownerWorkspaceId,
    transferableToHemas: false as const,
    productionUseAllowed: false as const,
    notice:
      "SafeNet demo asset. It is not a Hemas-owned or transferable production asset." as const,
  };
}

function providerState(
  overrides: Partial<TemplateCatalogueItemDTO["providerState"]> = {},
): TemplateCatalogueItemDTO["providerState"] {
  return {
    submissionState: "not_submitted",
    approvalState: "unverified",
    authority: "none",
    assetId: null,
    qualityRating: "unknown",
    checkedAt: null,
    ...overrides,
  };
}

function templateVersion(
  overrides: Partial<TemplateCatalogueItemDTO> = {},
): TemplateCatalogueItemDTO {
  return {
    id: "template_appointment_confirmation_en_v3",
    workspaceId,
    assetKey: "appointment_confirmation",
    sortKey: "appointment_confirmation:en:0003",
    providerName: "appointment_confirmation",
    category: "utility",
    language: "en",
    version: 3,
    localState: "approved",
    providerState: providerState(),
    immutable: true,
    contentHash: "1".repeat(64),
    components: [
      { kind: "header", format: "text", text: "Appointment request recorded" },
      {
        kind: "body",
        text: "Synthetic request {{appointment_ref}} is pending.",
      },
      { kind: "footer", text: "Synthetic demonstration only." },
    ],
    variableRules: [
      {
        key: "appointment_ref",
        description: "Opaque synthetic appointment reference",
        required: true,
        maxLength: 24,
        exampleValue: "SYN-A1842",
        allowedPattern: "^SYN-A[0-9]{4}$",
      },
    ],
    ownership: ownership(),
    synthetic: true,
    schemaVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

const flowStates: Readonly<Record<string, LocalAssetState>> = {
  doctor_booking_flow: "approved",
  home_collection_flow: "submitted",
  appointment_change_flow: "paused",
  package_enquiry_flow: "disabled",
  service_feedback_flow: "rejected",
  communication_preferences_flow: "draft",
};

function flowVersion(
  renderer: (typeof safeFlowRenderers)[number],
  language: CatalogueLanguage,
  overrides: Partial<FlowCatalogueItemDTO> = {},
): FlowCatalogueItemDTO {
  const localState = flowStates[renderer.assetKey] ?? "draft";
  return {
    id: `flow_${renderer.assetKey}_${language}_v${renderer.version}`,
    workspaceId,
    assetKey: renderer.assetKey,
    sortKey: `${renderer.assetKey}:${language}:000${renderer.version}`,
    definitionId: renderer.definitionId,
    displayName: renderer.displayName,
    language,
    version: renderer.version,
    localState,
    providerState: providerState(),
    endpointMode: "endpoint_powered",
    immutable: localState !== "draft",
    screenIds: renderer.flowScreens.map((screen) => screen.id),
    fallbackMode: "controlled_web_or_human",
    acceptsProviderPayloads: false,
    performsNetworkCalls: false,
    confirmsHemasTransaction: false,
    ownership: ownership(),
    synthetic: true,
    schemaVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function completeFlows(): readonly FlowCatalogueItemDTO[] {
  return safeFlowRenderers.flatMap((renderer) =>
    (["en", "si", "ta"] as const).map((language) =>
      flowVersion(renderer, language),
    ),
  );
}

function reads(input?: {
  readonly templates?: readonly TemplateCatalogueItemDTO[];
  readonly flows?: readonly FlowCatalogueItemDTO[];
}): TemplateWorkspaceReads {
  return {
    listTemplates: vi.fn(async () => input?.templates ?? [templateVersion()]),
    listFlows: vi.fn(async () => input?.flows ?? completeFlows()),
  };
}

describe("authenticated Template Studio read model", () => {
  it("matches the exact role read boundary used by Firestore Rules", async () => {
    const allowed: readonly WorkspaceRole[] = [
      "tenant_admin",
      "supervisor",
      "agent",
      "campaign_operator",
      "campaign_approver",
    ];
    const denied: readonly WorkspaceRole[] = [
      "platform_owner",
      "analyst",
      "privacy_reviewer",
      "clinical_approver",
    ];
    for (const role of allowed) expect(roleCanReadTemplateCatalogue(role)).toBe(true);
    for (const role of denied) expect(roleCanReadTemplateCatalogue(role)).toBe(false);

    const deniedReads = reads();
    await expect(
      loadTemplateWorkspace(firestore, session({ role: "analyst" }), deniedReads),
    ).rejects.toMatchObject({
      code: "access_denied",
    });
    expect(deniedReads.listTemplates).not.toHaveBeenCalled();
    expect(deniedReads.listFlows).not.toHaveBeenCalled();
  });

  it("loads 18 singular-language Flow variants through six exact safe render joins", async () => {
    const result = await loadTemplateWorkspace(firestore, session(), reads());
    expect(result).toMatchObject({
      templateCount: 1,
      flowVariantCount: 18,
      flowDefinitionCount: 6,
      languageCount: 3,
    });
    expect(result.assets).toHaveLength(19);
    const flows = result.assets.filter((asset) => asset.kind === "flow");
    expect(new Set(flows.map((flow) => flow.definitionId))).toEqual(
      new Set(safeFlowRenderers.map((renderer) => renderer.definitionId)),
    );
    for (const renderer of safeFlowRenderers) {
      const variants = flows.filter(
        (flow) => flow.definitionId === renderer.definitionId,
      );
      expect(variants.map((variant) => variant.language)).toEqual(["en", "si", "ta"]);
      for (const variant of variants) {
        expect(variant.flowScreens.map((screen) => screen.id)).toEqual(
          renderer.flowScreens.map((screen) => screen.id),
        );
      }
    }
  });

  it("minimizes provider evidence so identifiers cannot reach the UI model", async () => {
    const result = await loadTemplateWorkspace(firestore, session(), reads());
    for (const asset of result.assets) {
      expect(asset.providerEvidence).toEqual({
        submissionState: "not_submitted",
        approvalState: "unverified",
        authority: "none",
        qualityRating: "unknown",
        checkedAt: null,
      });
      expect(asset.providerEvidence).not.toHaveProperty("assetId");
      expect(asset).not.toHaveProperty("providerId");
      expect(asset.ownershipNotice).toContain("not a Hemas-owned or transferable");
    }
  });

  it("fails closed on cross-tenant, version, screen and duplicate identity joins", () => {
    const baseFlows = completeFlows();
    const first = baseFlows[0];
    expect(first).toBeDefined();
    if (!first) return;
    const invalidSets: readonly (readonly FlowCatalogueItemDTO[])[] = [
      [
        {
          ...first,
          workspaceId: "workspace_other",
          ownership: ownership("workspace_other"),
        },
        ...baseFlows.slice(1),
      ],
      [
        {
          ...first,
          id: `flow_${first.assetKey}_${first.language}_v2`,
          sortKey: `${first.assetKey}:${first.language}:0002`,
          version: 2,
        },
        ...baseFlows.slice(1),
      ],
      [{ ...first, screenIds: [...first.screenIds].reverse() }, ...baseFlows.slice(1)],
      [...baseFlows, first],
      baseFlows.slice(1),
    ];

    for (const flows of invalidSets) {
      expect(() =>
        assembleTemplateWorkspace({
          session: session(),
          templates: [templateVersion()],
          flows,
        }),
      ).toThrowError(expect.objectContaining({ code: "invalid_join" }));
    }
  });

  it("rejects inferred provider state and mismatched variable metadata", () => {
    expect(() =>
      assembleTemplateWorkspace({
        session: session(),
        templates: [
          templateVersion({
            providerState: providerState({
              submissionState: "submitted",
              approvalState: "approved",
              authority: "meta",
              assetId: "must-not-reach-view-model",
              qualityRating: "high",
              checkedAt: timestamp,
            }),
          }),
        ],
        flows: completeFlows(),
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_join" }));

    expect(() =>
      assembleTemplateWorkspace({
        session: session(),
        templates: [
          templateVersion({
            components: [{ kind: "body", text: "Unknown {{extra_value}}." }],
          }),
        ],
        flows: completeFlows(),
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_join" }));
  });

  it("returns a true empty result and never substitutes fixtures after read failure", async () => {
    const empty = await loadTemplateWorkspace(
      firestore,
      session(),
      reads({ templates: [], flows: [] }),
    );
    expect(empty).toEqual({
      assets: [],
      templateCount: 0,
      flowVariantCount: 0,
      flowDefinitionCount: 0,
      languageCount: 0,
    });

    const failedReads: TemplateWorkspaceReads = {
      listTemplates: vi.fn(async () => {
        throw Object.assign(new Error("offline"), { code: "unavailable" });
      }),
      listFlows: vi.fn(async () => completeFlows()),
    };
    await expect(
      loadTemplateWorkspace(firestore, session(), failedReads),
    ).rejects.toMatchObject({
      code: "load_failed",
      sourceCode: "unavailable",
    });
  });

  it("selects only within visible results and returns no unrelated detail for zero matches", async () => {
    const result = await loadTemplateWorkspace(firestore, session(), reads());
    const visible = result.assets.filter(
      (asset) => asset.kind === "flow" && asset.language === "ta",
    );
    expect(selectVisibleTemplateAsset(visible, result.assets[0]?.id ?? null)?.id).toBe(
      visible[0]?.id,
    );
    expect(selectVisibleTemplateAsset(visible, visible[1]?.id ?? null)?.id).toBe(
      visible[1]?.id,
    );
    expect(selectVisibleTemplateAsset([], result.assets[0]?.id ?? null)).toBeNull();
  });
});
