import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";
import {
  CATALOGUE_LANGUAGES,
  hasVerifiedProviderApproval,
  LOCAL_ASSET_STATES,
  parseFlowCatalogueDocument,
  parseTemplateCatalogueDocument,
  prepareCatalogueListInput,
  serializeTemplateContentBinding,
  TemplateRepositoryError,
  verifyTemplateContentHash,
  type LocalAssetState,
} from "@/lib/firebase/repositories";

const timestamp = Timestamp.fromDate(new Date("2026-08-07T13:00:00.000Z"));
const workspaceId = "workspace_safenet_demo";

function ownership() {
  return {
    ownerKind: "safenet_demo",
    ownerWorkspaceId: workspaceId,
    transferableToHemas: false,
    productionUseAllowed: false,
    notice: "SafeNet demo asset. It is not a Hemas-owned or transferable production asset.",
  };
}

function providerState(overrides: Record<string, unknown> = {}) {
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

function templateVersion(overrides: Record<string, unknown> = {}) {
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
      { kind: "body", text: "Synthetic request {{appointment_ref}} is pending." },
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

function flowVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: "flow_doctor_booking_en_v1",
    workspaceId,
    assetKey: "doctor_booking_flow",
    sortKey: "doctor_booking_flow:en:0001",
    definitionId: "synthetic-flow-appointment-request",
    displayName: "Appointment booking Flow",
    language: "en",
    version: 1,
    localState: "approved",
    providerState: providerState(),
    endpointMode: "endpoint_powered",
    immutable: true,
    screenIds: ["REQUEST_DETAILS", "LOCATION", "SPECIALTY", "REVIEW", "PENDING_CONFIRMATION"],
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

describe("persisted template and Flow catalogue boundaries", () => {
  it("locks the canonical template-content serialization and SHA-256 golden vector", async () => {
    const content = {
      workspaceId,
      id: "template_appointment_confirmation_en_v3",
      assetKey: "appointment_confirmation",
      providerName: "appointment_confirmation",
      category: "utility" as const,
      language: "en" as const,
      version: 3,
      components: [
        { kind: "header" as const, format: "text" as const, text: "Appointment request recorded" },
        { kind: "body" as const, text: "Synthetic request {{appointment_ref}} is pending." },
        { kind: "footer" as const, text: "Synthetic demonstration only." },
        {
          kind: "buttons" as const,
          buttons: [
            {
              type: "quick_reply" as const,
              label: "Confirm {{appointment_ref}}",
              targetRef: "confirm:{{appointment_ref}}",
            },
            {
              type: "url" as const,
              label: "Open portal",
              targetRef: "https://demo.invalid/{{appointment_ref}}",
            },
          ],
        },
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
    };
    const serialized = serializeTemplateContentBinding(content);
    expect(serialized).toBe(
      '["hemas-connect:template-content:v1","workspace_safenet_demo","template_appointment_confirmation_en_v3","appointment_confirmation","appointment_confirmation","utility","en",3,[["header","text","Appointment request recorded",[]],["body",null,"Synthetic request {{appointment_ref}} is pending.",[]],["footer",null,"Synthetic demonstration only.",[]],["buttons",null,null,[["quick_reply","Confirm {{appointment_ref}}","confirm:{{appointment_ref}}"],["url","Open portal","https://demo.invalid/{{appointment_ref}}"]]]],[["appointment_ref","Opaque synthetic appointment reference",true,24,"SYN-A1842","^SYN-A[0-9]{4}$"]]]',
    );
    const parsed = parseTemplateCatalogueDocument(
      templateVersion({
        ...content,
        contentHash: "8abc4790d6a341bced3b0cc49194c410f7c86528638bba36c4f2454a83f870d0",
      }),
      content.id,
      workspaceId,
    );
    await expect(verifyTemplateContentHash(parsed)).resolves.toMatchObject({
      contentHash: "8abc4790d6a341bced3b0cc49194c410f7c86528638bba36c4f2454a83f870d0",
    });
  });

  it("tracks every local lifecycle state without inferring provider approval", () => {
    expect(LOCAL_ASSET_STATES).toEqual([
      "draft",
      "submitted",
      "approved",
      "paused",
      "disabled",
      "rejected",
    ]);

    for (const state of LOCAL_ASSET_STATES) {
      const parsed = parseTemplateCatalogueDocument(
        templateVersion({
          id: `template_state_${state}_en_v1`,
          sortKey: `state:${state}:en:0001`,
          localState: state,
          immutable: state !== "draft",
        }),
        `template_state_${state}_en_v1`,
        workspaceId,
      );
      expect(parsed.localState).toBe(state);
      expect(parsed.providerState).toMatchObject({
        submissionState: "not_submitted",
        approvalState: "unverified",
        authority: "none",
        assetId: null,
      });
      expect(hasVerifiedProviderApproval(parsed)).toBe(false);
    }
  });

  it("tracks English, Sinhala and Tamil as separate singular-language records", () => {
    expect(CATALOGUE_LANGUAGES).toEqual(["en", "si", "ta"]);
    const variants = CATALOGUE_LANGUAGES.map((language) =>
      parseTemplateCatalogueDocument(
        templateVersion({
          id: `template_appointment_confirmation_${language}_v3`,
          language,
          sortKey: `appointment_confirmation:${language}:0003`,
        }),
        `template_appointment_confirmation_${language}_v3`,
        workspaceId,
      ),
    );
    expect(variants.map((variant) => variant.language)).toEqual(["en", "si", "ta"]);
    expect(new Set(variants.map((variant) => variant.id)).size).toBe(3);
  });

  it("requires immutable submitted or released versions and mutable drafts", () => {
    for (const [state, immutable] of [
      ["draft", true],
      ["submitted", false],
      ["approved", false],
      ["paused", false],
      ["disabled", false],
      ["rejected", false],
    ] as const satisfies readonly (readonly [LocalAssetState, boolean])[]) {
      expect(() =>
        parseTemplateCatalogueDocument(
          templateVersion({ localState: state, immutable }),
          "template_appointment_confirmation_en_v3",
          workspaceId,
        ),
      ).toThrowError(expect.objectContaining({ code: "invalid_data" }));
    }
  });

  it("accepts provider approval only with explicit Meta evidence", () => {
    expect(() =>
      parseTemplateCatalogueDocument(
        templateVersion({
          providerState: providerState({ approvalState: "approved" }),
        }),
        "template_appointment_confirmation_en_v3",
        workspaceId,
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid_data" }));

    const verified = parseTemplateCatalogueDocument(
      templateVersion({
        providerState: providerState({
          submissionState: "submitted",
          approvalState: "approved",
          authority: "meta",
          assetId: "provider-template-fixture-001",
          qualityRating: "high",
          checkedAt: timestamp,
        }),
      }),
      "template_appointment_confirmation_en_v3",
      workspaceId,
    );
    expect(hasVerifiedProviderApproval(verified)).toBe(true);
  });

  it("strictly rejects protected data, schema pollution and transferable ownership", () => {
    for (const polluted of [
      templateVersion({ accessToken: "forbidden" }),
      templateVersion({ patientData: "forbidden" }),
      templateVersion({ ownership: { ...ownership(), transferableToHemas: true } }),
      templateVersion({ variableRules: [{ key: "duplicate", description: "A", required: true, maxLength: 20, exampleValue: "SYN-1", allowedPattern: null }, { key: "duplicate", description: "B", required: true, maxLength: 20, exampleValue: "SYN-2", allowedPattern: null }] }),
      templateVersion({
        components: [{ kind: "body", text: "Unknown {{un governed}} placeholder." }],
      }),
      templateVersion({
        components: [{ kind: "body", text: "Unknown {{other_ref}} placeholder." }],
      }),
      templateVersion({ components: [{ kind: "body", text: "No governed placeholder." }] }),
    ]) {
      expect(() =>
        parseTemplateCatalogueDocument(
          polluted,
          "template_appointment_confirmation_en_v3",
          workspaceId,
        ),
      ).toThrowError(expect.objectContaining({ code: "invalid_data" }));
    }
  });

  it("fails closed when stored hashes or governed body, button, or variable content drift", async () => {
    const goldenHash = "8abc4790d6a341bced3b0cc49194c410f7c86528638bba36c4f2454a83f870d0";
    const components = [
      { kind: "header" as const, format: "text" as const, text: "Appointment request recorded" },
      { kind: "body" as const, text: "Synthetic request {{appointment_ref}} is pending." },
      { kind: "footer" as const, text: "Synthetic demonstration only." },
      {
        kind: "buttons" as const,
        buttons: [
          { type: "quick_reply" as const, label: "Confirm {{appointment_ref}}", targetRef: "confirm:{{appointment_ref}}" },
          { type: "url" as const, label: "Open portal", targetRef: "https://demo.invalid/{{appointment_ref}}" },
        ],
      },
    ];
    const variableRules = [
      {
        key: "appointment_ref",
        description: "Opaque synthetic appointment reference",
        required: true,
        maxLength: 24,
        exampleValue: "SYN-A1842",
        allowedPattern: "^SYN-A[0-9]{4}$",
      },
    ];
    const variants = [
      templateVersion({ components, variableRules, contentHash: "0".repeat(64) }),
      templateVersion({
        components: components.map((component) =>
          component.kind === "body" ? { ...component, text: "Drifted {{appointment_ref}} body." } : component,
        ),
        variableRules,
        contentHash: goldenHash,
      }),
      templateVersion({
        components: components.map((component) =>
          component.kind === "buttons"
            ? { ...component, buttons: component.buttons.map((button, index) => index === 0 ? { ...button, label: "Changed {{appointment_ref}}" } : button) }
            : component,
        ),
        variableRules,
        contentHash: goldenHash,
      }),
      templateVersion({
        components,
        variableRules: [{ ...variableRules[0], maxLength: 25 }],
        contentHash: goldenHash,
      }),
    ];
    for (const variant of variants) {
      const parsed = parseTemplateCatalogueDocument(
        variant,
        "template_appointment_confirmation_en_v3",
        workspaceId,
      );
      await expect(verifyTemplateContentHash(parsed)).rejects.toMatchObject({
        code: "invalid_data",
      });
    }
  });

  it("parses only inert synthetic Flow metadata", () => {
    const flow = parseFlowCatalogueDocument(
      flowVersion(),
      "flow_doctor_booking_en_v1",
      workspaceId,
    );
    expect(flow).toMatchObject({
      definitionId: "synthetic-flow-appointment-request",
      endpointMode: "endpoint_powered",
      acceptsProviderPayloads: false,
      performsNetworkCalls: false,
      confirmsHemasTransaction: false,
    });
    expect(hasVerifiedProviderApproval(flow)).toBe(false);

    for (const invalid of [
      flowVersion({ acceptsProviderPayloads: true }),
      flowVersion({ performsNetworkCalls: true }),
      flowVersion({ confirmsHemasTransaction: true }),
      flowVersion({ screenIds: ["REVIEW", "REVIEW"] }),
      flowVersion({ providerSecret: "forbidden" }),
    ]) {
      expect(() =>
        parseFlowCatalogueDocument(invalid, "flow_doctor_booking_en_v1", workspaceId),
      ).toThrowError(expect.objectContaining({ code: "invalid_data" }));
    }
  });

  it("requires bounded, singular-language catalogue queries", () => {
    expect(
      prepareCatalogueListInput({ workspaceId, language: "ta", pageSize: 100 }),
    ).toEqual({ workspaceId, language: "ta", pageSize: 100 });
    for (const input of [
      { workspaceId, language: "trilingual" },
      { workspaceId, pageSize: 101 },
      { workspaceId, pageSize: 0 },
      { workspaceId, secret: "forbidden" },
    ]) {
      expect(() => prepareCatalogueListInput(input as never)).toThrowError(
        expect.objectContaining<Partial<TemplateRepositoryError>>({ code: "invalid_input" }),
      );
    }
  });
});
