import { DATA_SOURCE } from "@/lib/firebase/boundary-copy";
import type { Firestore } from "firebase/firestore";
import {
  listFlowCatalogue,
  listTemplateCatalogue,
  type CatalogueLanguage,
  type CatalogueListInput,
  type FlowCatalogueItemDTO,
  type LocalAssetState,
  type ProviderStateDTO,
  type TemplateCatalogueItemDTO,
} from "@/lib/firebase/repositories";
import type {
  VerifiedWorkspaceSession,
  WorkspaceRole,
} from "@/lib/firebase/workspace-session-model";
import {
  getSafeFlowRenderer,
  getSafeTemplatePresentation,
  safeFlowRenderers,
  type FlowScreen,
} from "./template-studio-data";

const PAGE_SIZE = 100;
const CATALOGUE_ROLES: readonly WorkspaceRole[] = [
  "tenant_admin",
  "supervisor",
  "agent",
  "campaign_operator",
  "campaign_approver",
];
const CATALOGUE_LANGUAGES: readonly CatalogueLanguage[] = ["en", "si", "ta"];

export type TemplateAssetKind = "template" | "flow";
export type TemplateAssetCategory =
  | "Utility"
  | "Marketing"
  | "Authentication"
  | "Flow";

export type TemplateVariable = {
  readonly key: string;
  readonly description: string;
  readonly example: string;
  readonly required: boolean;
  readonly maxLength: number;
  readonly patternSource: string | null;
};

export type ProviderEvidenceView = {
  readonly submissionState: "not_submitted";
  readonly approvalState: "unverified";
  readonly authority: "none";
  readonly qualityRating: "unknown";
  readonly checkedAt: null;
};

type BaseTemplateStudioAsset = {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly language: CatalogueLanguage;
  readonly category: TemplateAssetCategory;
  readonly version: number;
  readonly localState: LocalAssetState;
  readonly providerEvidence: ProviderEvidenceView;
  readonly immutable: boolean;
  readonly ownershipNotice: string;
  readonly updatedAt: string;
  readonly fallback: string;
};

export type TemplateStudioTemplateAsset = BaseTemplateStudioAsset & {
  readonly kind: "template";
  readonly header: string | null;
  readonly body: string;
  readonly footer: string | null;
  readonly variables: readonly TemplateVariable[];
};

export type TemplateStudioFlowAsset = BaseTemplateStudioAsset & {
  readonly kind: "flow";
  readonly definitionId: string;
  readonly flowScreens: readonly FlowScreen[];
  readonly variables: readonly [];
};

export type TemplateStudioAsset =
  | TemplateStudioTemplateAsset
  | TemplateStudioFlowAsset;

export type TemplateWorkspaceResult = {
  readonly assets: readonly TemplateStudioAsset[];
  readonly templateCount: number;
  readonly flowVariantCount: number;
  readonly flowDefinitionCount: number;
  readonly languageCount: number;
  /** Catalogue records skipped in tolerant mode (another lane's records). */
  readonly excluded: number;
};

export function selectVisibleTemplateAsset(
  visibleAssets: readonly TemplateStudioAsset[],
  requestedId: string | null,
): TemplateStudioAsset | null {
  if (visibleAssets.length === 0) return null;
  return (
    (requestedId
      ? visibleAssets.find((asset) => asset.id === requestedId)
      : undefined) ??
    visibleAssets[0] ??
    null
  );
}

export interface TemplateWorkspaceReads {
  readonly listTemplates: (
    db: Firestore,
    input: CatalogueListInput,
    options?: { readonly tolerant?: boolean },
  ) => Promise<readonly TemplateCatalogueItemDTO[]>;
  readonly listFlows: (
    db: Firestore,
    input: CatalogueListInput,
    options?: { readonly tolerant?: boolean },
  ) => Promise<readonly FlowCatalogueItemDTO[]>;
}

export type TemplateWorkspaceLoadOptions = Readonly<{
  /**
   * Skip catalogue records from another lane (schema mismatch, hash drift or a
   * join that cannot be made) instead of failing the whole studio. Governed
   * cloud demo only; local runs keep the strict fail-closed behaviour.
   */
  readonly tolerant?: boolean;
}>;

const defaultReads: TemplateWorkspaceReads = {
  listTemplates: listTemplateCatalogue,
  listFlows: listFlowCatalogue,
};

export class TemplateWorkspaceDataError extends Error {
  constructor(
    message: string,
    readonly code: "access_denied" | "invalid_join" | "load_failed",
    readonly sourceCode = "",
  ) {
    super(message);
    this.name = "TemplateWorkspaceDataError";
  }
}

function invalidJoin(message: string): never {
  throw new TemplateWorkspaceDataError(message, "invalid_join");
}

function firebaseErrorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
}

export function roleCanReadTemplateCatalogue(role: WorkspaceRole): boolean {
  return CATALOGUE_ROLES.some((allowedRole) => allowedRole === role);
}

function assertSyntheticWorkspaceSession(session: VerifiedWorkspaceSession): void {
  if (
    !session.workspaceId ||
    !session.uid ||
    (session.workspaceMode !== "local" && session.workspaceMode !== "demo") ||
    session.dataClassification !== "synthetic_only"
  ) {
    throw new TemplateWorkspaceDataError(
      "The verified session is outside the synthetic catalogue boundary.",
      "access_denied",
    );
  }
  if (!roleCanReadTemplateCatalogue(session.role)) {
    throw new TemplateWorkspaceDataError(
      "The verified role is not permitted to read template or Flow metadata.",
      "access_denied",
    );
  }
}

function assertOwnership(
  record: TemplateCatalogueItemDTO | FlowCatalogueItemDTO,
  workspaceId: string,
): void {
  if (
    record.workspaceId !== workspaceId ||
    record.ownership.ownerWorkspaceId !== workspaceId ||
    record.ownership.ownerKind !== "safenet_demo" ||
    record.ownership.transferableToHemas !== false ||
    record.ownership.productionUseAllowed !== false ||
    record.synthetic !== true ||
    record.schemaVersion !== 1
  ) {
    invalidJoin(
      "Catalogue ownership did not match the verified SafeNet synthetic workspace.",
    );
  }
}

function assertUnverifiedProviderEvidence(state: ProviderStateDTO): void {
  if (
    state.submissionState !== "not_submitted" ||
    state.approvalState !== "unverified" ||
    state.authority !== "none" ||
    state.assetId !== null ||
    state.qualityRating !== "unknown" ||
    state.checkedAt !== null
  ) {
    invalidJoin(
      "The synthetic catalogue carried provider state without verified provider evidence.",
    );
  }
}

function providerEvidenceView(): ProviderEvidenceView {
  return {
    submissionState: "not_submitted",
    approvalState: "unverified",
    authority: "none",
    qualityRating: "unknown",
    checkedAt: null,
  };
}

function assertReleasedImmutability(record: {
  readonly localState: LocalAssetState;
  readonly immutable: boolean;
}): void {
  if (record.immutable !== (record.localState !== "draft")) {
    invalidJoin(
      "Local governance state and immutable version evidence did not agree.",
    );
  }
}

function expectedIdentity(
  kind: TemplateAssetKind,
  assetKey: string,
  language: CatalogueLanguage,
  version: number,
): { readonly id: string; readonly sortKey: string } {
  return {
    id: `${kind}_${assetKey}_${language}_v${version}`,
    sortKey: `${assetKey}:${language}:${String(version).padStart(4, "0")}`,
  };
}

function assertRecordIdentity(
  record: TemplateCatalogueItemDTO | FlowCatalogueItemDTO,
  kind: TemplateAssetKind,
): void {
  const expected = expectedIdentity(
    kind,
    record.assetKey,
    record.language,
    record.version,
  );
  if (record.id !== expected.id || record.sortKey !== expected.sortKey) {
    invalidJoin(
      "A catalogue document ID, language or version did not match its immutable identity.",
    );
  }
}

function extractTemplateCopy(record: TemplateCatalogueItemDTO): {
  readonly header: string | null;
  readonly body: string;
  readonly footer: string | null;
} {
  const headers = record.components.filter((component) => component.kind === "header");
  const bodies = record.components.filter((component) => component.kind === "body");
  const footers = record.components.filter((component) => component.kind === "footer");
  const buttons = record.components.filter((component) => component.kind === "buttons");
  if (
    headers.length > 1 ||
    bodies.length !== 1 ||
    footers.length > 1 ||
    buttons.length > 0
  ) {
    invalidJoin(
      "Template components were not safe for this read-only local preview.",
    );
  }
  return {
    header: headers[0]?.text ?? null,
    body: bodies[0]?.text ?? invalidJoin("Template body metadata was missing."),
    footer: footers[0]?.text ?? null,
  };
}

function variableTokens(copy: {
  readonly header: string | null;
  readonly body: string;
  readonly footer: string | null;
}): ReadonlySet<string> {
  const tokens = new Set<string>();
  for (const part of [copy.header, copy.body, copy.footer]) {
    if (!part) continue;
    for (const match of part.matchAll(/\{\{([a-z][a-z0-9_]*)\}\}/g)) {
      if (match[1]) tokens.add(match[1]);
    }
  }
  return tokens;
}

function templateVariables(
  record: TemplateCatalogueItemDTO,
  copy: ReturnType<typeof extractTemplateCopy>,
): readonly TemplateVariable[] {
  const tokens = variableTokens(copy);
  const ruleKeys = new Set(record.variableRules.map((rule) => rule.key));
  if (
    tokens.size !== ruleKeys.size ||
    [...tokens].some((token) => !ruleKeys.has(token))
  ) {
    invalidJoin(
      "Template variables did not match their immutable validation metadata.",
    );
  }

  return record.variableRules.map((rule) => {
    if (rule.allowedPattern !== null) {
      try {
        new RegExp(rule.allowedPattern);
      } catch {
        invalidJoin("Template variable validation metadata was invalid.");
      }
    }
    return {
      key: rule.key,
      description: rule.description,
      example: rule.exampleValue,
      required: rule.required,
      maxLength: rule.maxLength,
      patternSource: rule.allowedPattern,
    };
  });
}

function templateAsset(
  record: TemplateCatalogueItemDTO,
  workspaceId: string,
): TemplateStudioTemplateAsset {
  assertOwnership(record, workspaceId);
  assertUnverifiedProviderEvidence(record.providerState);
  assertReleasedImmutability(record);
  assertRecordIdentity(record, "template");
  const presentation = getSafeTemplatePresentation(record.assetKey);
  if (!presentation || record.providerName !== record.assetKey) {
    invalidJoin("Template metadata did not match an approved local presentation contract.");
  }
  const copy = extractTemplateCopy(record);
  return {
    id: record.id,
    kind: "template",
    name: record.assetKey,
    displayName: presentation.displayName,
    language: record.language,
    category: `${record.category[0]?.toUpperCase()}${record.category.slice(1)}` as
      | "Utility"
      | "Marketing"
      | "Authentication",
    version: record.version,
    localState: record.localState,
    providerEvidence: providerEvidenceView(),
    immutable: record.immutable,
    ownershipNotice: record.ownership.notice,
    updatedAt: record.updatedAt,
    fallback: presentation.fallback,
    header: copy.header,
    body: copy.body,
    footer: copy.footer,
    variables: templateVariables(record, copy),
  };
}

function sameOrderedValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function flowAsset(
  record: FlowCatalogueItemDTO,
  workspaceId: string,
): TemplateStudioFlowAsset {
  assertOwnership(record, workspaceId);
  assertUnverifiedProviderEvidence(record.providerState);
  assertReleasedImmutability(record);
  assertRecordIdentity(record, "flow");
  const renderer = getSafeFlowRenderer(record.definitionId);
  if (
    !renderer ||
    renderer.assetKey !== record.assetKey ||
    renderer.displayName !== record.displayName ||
    renderer.version !== record.version ||
    record.endpointMode !== "endpoint_powered" ||
    record.fallbackMode !== "controlled_web_or_human" ||
    record.acceptsProviderPayloads !== false ||
    record.performsNetworkCalls !== false ||
    record.confirmsHemasTransaction !== false ||
    !sameOrderedValues(
      record.screenIds,
      renderer.flowScreens.map((screen) => screen.id),
    )
  ) {
    invalidJoin(
      "A persisted Flow did not match its inert versioned local renderer contract.",
    );
  }
  return {
    id: record.id,
    kind: "flow",
    name: record.assetKey,
    displayName: record.displayName,
    definitionId: record.definitionId,
    language: record.language,
    category: "Flow",
    version: record.version,
    localState: record.localState,
    providerEvidence: providerEvidenceView(),
    immutable: record.immutable,
    ownershipNotice: record.ownership.notice,
    updatedAt: record.updatedAt,
    fallback: renderer.fallback,
    flowScreens: renderer.flowScreens,
    variables: [],
  };
}

function assertUniqueAssetIdentities(assets: readonly TemplateStudioAsset[]): void {
  const identities = new Set<string>();
  for (const asset of assets) {
    const identity = `${asset.kind}:${asset.name}:${asset.language}:${asset.version}`;
    if (identities.has(identity)) {
      invalidJoin("Duplicate workspace, language and version identity was returned.");
    }
    identities.add(identity);
  }
}

function assertCompleteFlowVariants(
  flows: readonly TemplateStudioFlowAsset[],
): void {
  if (flows.length === 0) return;
  for (const renderer of safeFlowRenderers) {
    const variants = flows.filter(
      (flow) => flow.definitionId === renderer.definitionId,
    );
    if (
      variants.length !== CATALOGUE_LANGUAGES.length ||
      CATALOGUE_LANGUAGES.some(
        (language) => !variants.some((variant) => variant.language === language),
      )
    ) {
      invalidJoin(
        "The persisted Flow catalogue was missing a required singular-language variant.",
      );
    }
  }
  if (
    new Set(flows.map((flow) => flow.definitionId)).size !== safeFlowRenderers.length
  ) {
    invalidJoin("The persisted Flow catalogue included an unknown definition identity.");
  }
}

function collectAssets<Input, Output>(
  records: readonly Input[],
  build: (record: Input) => Output,
  tolerant: boolean,
): { readonly assets: Output[]; readonly excluded: number } {
  const assets: Output[] = [];
  let excluded = 0;
  for (const record of records) {
    try {
      assets.push(build(record));
    } catch (error) {
      if (
        tolerant &&
        error instanceof TemplateWorkspaceDataError &&
        error.code === "invalid_join"
      ) {
        excluded += 1;
        continue;
      }
      throw error;
    }
  }
  return { assets, excluded };
}

export function assembleTemplateWorkspace(
  input: {
    readonly session: VerifiedWorkspaceSession;
    readonly templates: readonly TemplateCatalogueItemDTO[];
    readonly flows: readonly FlowCatalogueItemDTO[];
  },
  options?: TemplateWorkspaceLoadOptions,
): TemplateWorkspaceResult {
  assertSyntheticWorkspaceSession(input.session);
  const tolerant = options?.tolerant === true;
  const templateResult = collectAssets(
    input.templates,
    (record) => templateAsset(record, input.session.workspaceId),
    tolerant,
  );
  const flowResult = collectAssets(
    input.flows,
    (record) => flowAsset(record, input.session.workspaceId),
    tolerant,
  );
  const templates = templateResult.assets;
  let flows = flowResult.assets;
  let excluded = templateResult.excluded + flowResult.excluded;
  if (tolerant) {
    // Keep only complete singular-language Flow definitions the safe renderer
    // knows; anything else belongs to another lane and is counted, not shown.
    const known = new Set(safeFlowRenderers.map((renderer) => renderer.definitionId));
    const complete = flows.filter((flow) => {
      if (!known.has(flow.definitionId)) return false;
      const variants = flows.filter((candidate) => candidate.definitionId === flow.definitionId);
      return (
        variants.length === CATALOGUE_LANGUAGES.length &&
        CATALOGUE_LANGUAGES.every((language) =>
          variants.some((variant) => variant.language === language),
        )
      );
    });
    excluded += flows.length - complete.length;
    flows = complete;
  }
  const assets: readonly TemplateStudioAsset[] = [...templates, ...flows];
  assertUniqueAssetIdentities(assets);
  if (!tolerant) {
    assertCompleteFlowVariants(flows);
    if (assets.length > 0 && flows.length === 0) {
      invalidJoin("The persisted catalogue omitted every governed Flow definition.");
    }
  }
  return {
    assets,
    templateCount: templates.length,
    flowVariantCount: flows.length,
    flowDefinitionCount: new Set(flows.map((flow) => flow.definitionId)).size,
    languageCount: new Set(assets.map((asset) => asset.language)).size,
    excluded,
  };
}

export async function loadTemplateWorkspace(
  db: Firestore,
  session: VerifiedWorkspaceSession,
  reads: TemplateWorkspaceReads = defaultReads,
  options?: TemplateWorkspaceLoadOptions,
): Promise<TemplateWorkspaceResult> {
  assertSyntheticWorkspaceSession(session);
  const readOptions = options?.tolerant ? ({ tolerant: true } as const) : undefined;
  try {
    const input = { workspaceId: session.workspaceId, pageSize: PAGE_SIZE } as const;
    const [templates, flows] = await Promise.all([
      readOptions ? reads.listTemplates(db, input, readOptions) : reads.listTemplates(db, input),
      readOptions ? reads.listFlows(db, input, readOptions) : reads.listFlows(db, input),
    ]);
    return assembleTemplateWorkspace({ session, templates, flows }, options);
  } catch (error) {
    if (error instanceof TemplateWorkspaceDataError) throw error;
    throw new TemplateWorkspaceDataError(
      "The authenticated local catalogue query did not complete.",
      "load_failed",
      firebaseErrorCode(error),
    );
  }
}

export function describeTemplateWorkspaceError(error: unknown): string {
  if (error instanceof TemplateWorkspaceDataError) {
    if (error.code === "access_denied") {
      return "This verified role cannot read Template Studio metadata. No catalogue query was attempted.";
    }
    if (error.code === "invalid_join") {
      return "Persisted catalogue identity or safe renderer evidence did not match. No fixture fallback was shown.";
    }
    if (error.sourceCode.includes("permission-denied")) {
      return "Firestore Rules denied this catalogue read for the verified membership.";
    }
  }
  return `The catalogue could not be loaded from ${DATA_SOURCE}. No fixture fallback was shown.`;
}
