import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type Firestore,
  type QueryConstraint,
  type Timestamp,
} from "firebase/firestore";
import { z } from "zod";

export const CATALOGUE_LANGUAGES = ["en", "si", "ta"] as const;
export const LOCAL_ASSET_STATES = [
  "draft",
  "submitted",
  "approved",
  "paused",
  "disabled",
  "rejected",
] as const;

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Identifier contains unsupported characters");
const safeName = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9_]*$/, "Provider names must use lower snake case");
const language = z.enum(CATALOGUE_LANGUAGES);
const localState = z.enum(LOCAL_ASSET_STATES);
const sha256Digest = z.string().regex(/^[0-9a-f]{64}$/);
const timestampValue = z.custom<Timestamp>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof value.toDate === "function",
  "Expected a Firestore Timestamp",
);

const ownershipSchema = z
  .object({
    ownerKind: z.literal("safenet_demo"),
    ownerWorkspaceId: identifier,
    transferableToHemas: z.literal(false),
    productionUseAllowed: z.literal(false),
    notice: z.literal(
      "SafeNet demo asset. It is not a Hemas-owned or transferable production asset.",
    ),
  })
  .strict();

const providerStateSchema = z
  .object({
    submissionState: z.enum(["not_submitted", "submitted"]),
    approvalState: z.enum([
      "unverified",
      "pending",
      "approved",
      "paused",
      "disabled",
      "rejected",
    ]),
    authority: z.enum(["none", "meta"]),
    assetId: z.string().min(1).max(160).nullable(),
    qualityRating: z.enum(["unknown", "high", "medium", "low"]),
    checkedAt: timestampValue.nullable(),
  })
  .strict()
  .superRefine((state, context) => {
    if (state.submissionState === "not_submitted") {
      if (
        state.approvalState !== "unverified" ||
        state.authority !== "none" ||
        state.assetId !== null ||
        state.qualityRating !== "unknown" ||
        state.checkedAt !== null
      ) {
        context.addIssue({
          code: "custom",
          message: "An unsubmitted asset cannot carry inferred provider state.",
        });
      }
      return;
    }

    if (state.authority !== "meta" || state.assetId === null || state.checkedAt === null) {
      context.addIssue({
        code: "custom",
        message: "Submitted provider state requires Meta authority, an asset ID and evidence time.",
      });
    }
    if (state.approvalState === "unverified") {
      context.addIssue({
        code: "custom",
        message: "A submitted asset must carry an actual provider review state.",
      });
    }
  });

const variableRuleSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9_]*$/),
    description: z.string().min(1).max(240),
    required: z.boolean(),
    maxLength: z.number().int().min(1).max(500),
    exampleValue: z.string().min(1).max(500),
    allowedPattern: z.string().min(1).max(240).nullable(),
  })
  .strict();

const buttonSchema = z
  .object({
    type: z.enum(["quick_reply", "url", "flow"]),
    label: z.string().min(1).max(80),
    targetRef: z.string().min(1).max(240),
  })
  .strict();

const componentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("header"),
      format: z.literal("text"),
      text: z.string().min(1).max(240),
    })
    .strict(),
  z.object({ kind: z.literal("body"), text: z.string().min(1).max(2_048) }).strict(),
  z.object({ kind: z.literal("footer"), text: z.string().min(1).max(240) }).strict(),
  z
    .object({
      kind: z.literal("buttons"),
      buttons: z.array(buttonSchema).min(1).max(10),
    })
    .strict(),
]);

function templatePlaceholderKeys(
  components: readonly z.infer<typeof componentSchema>[],
): ReadonlySet<string> {
  const keys = new Set<string>();
  const collect = (text: string): void => {
    for (const match of text.matchAll(/\{\{([a-z][a-z0-9_]*)\}\}/g)) {
      keys.add(match[1]);
    }
  };
  for (const component of components) {
    if (component.kind === "buttons") {
      for (const button of component.buttons) {
        collect(button.label);
        collect(button.targetRef);
      }
    } else {
      collect(component.text);
    }
  }
  return keys;
}

function validateLocalImmutability(
  value: { readonly localState: z.infer<typeof localState>; readonly immutable: boolean },
  context: z.RefinementCtx,
): void {
  if (value.immutable !== (value.localState !== "draft")) {
    context.addIssue({
      code: "custom",
      path: ["immutable"],
      message: "Only local drafts are mutable; every submitted or released version is immutable.",
    });
  }
}

const templateDocumentSchema = z
  .object({
    id: identifier,
    workspaceId: identifier,
    assetKey: safeName,
    sortKey: z.string().min(1).max(260),
    providerName: safeName,
    category: z.enum(["utility", "marketing", "authentication"]),
    language,
    version: z.number().int().min(1).max(10_000),
    localState,
    providerState: providerStateSchema,
    immutable: z.boolean(),
    contentHash: sha256Digest,
    components: z.array(componentSchema).min(1).max(8),
    variableRules: z.array(variableRuleSchema).max(20),
    ownership: ownershipSchema,
    synthetic: z.literal(true),
    schemaVersion: z.literal(1),
    createdAt: timestampValue,
    updatedAt: timestampValue,
  })
  .strict()
  .superRefine((value, context) => {
    validateLocalImmutability(value, context);
    if (new Set(value.variableRules.map((rule) => rule.key)).size !== value.variableRules.length) {
      context.addIssue({
        code: "custom",
        path: ["variableRules"],
        message: "Template variable keys must be unique.",
      });
    }
    const placeholders = templatePlaceholderKeys(value.components);
    const governedKeys = new Set(value.variableRules.map((rule) => rule.key));
    if (
      placeholders.size !== governedKeys.size ||
      [...placeholders].some((key) => !governedKeys.has(key))
    ) {
      context.addIssue({
        code: "custom",
        path: ["variableRules"],
        message: "Template placeholders and variable governance keys must match exactly.",
      });
    }
  });

const flowDocumentSchema = z
  .object({
    id: identifier,
    workspaceId: identifier,
    assetKey: safeName,
    sortKey: z.string().min(1).max(260),
    definitionId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^synthetic-flow-[a-z0-9-]+$/),
    displayName: z.string().min(1).max(160),
    language,
    version: z.number().int().min(1).max(10_000),
    localState,
    providerState: providerStateSchema,
    endpointMode: z.enum(["static", "endpoint_powered"]),
    immutable: z.boolean(),
    screenIds: z.array(identifier).min(1).max(30),
    fallbackMode: z.enum(["controlled_web_or_human", "human_only"]),
    acceptsProviderPayloads: z.literal(false),
    performsNetworkCalls: z.literal(false),
    confirmsHemasTransaction: z.literal(false),
    ownership: ownershipSchema,
    synthetic: z.literal(true),
    schemaVersion: z.literal(1),
    createdAt: timestampValue,
    updatedAt: timestampValue,
  })
  .strict()
  .superRefine((value, context) => {
    validateLocalImmutability(value, context);
    if (new Set(value.screenIds).size !== value.screenIds.length) {
      context.addIssue({
        code: "custom",
        path: ["screenIds"],
        message: "Flow screen identifiers must be unique.",
      });
    }
  });

const catalogueListInputSchema = z
  .object({
    workspaceId: identifier,
    language: language.optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
  })
  .strict();

const catalogueGetInputSchema = z
  .object({ workspaceId: identifier, templateId: identifier })
  .strict();

type TemplateDocument = z.infer<typeof templateDocumentSchema>;
type FlowDocument = z.infer<typeof flowDocumentSchema>;
export type CatalogueLanguage = z.infer<typeof language>;
export type LocalAssetState = z.infer<typeof localState>;
export type CatalogueListInput = z.infer<typeof catalogueListInputSchema>;
export type CatalogueGetInput = z.infer<typeof catalogueGetInputSchema>;
export type TemplateContentComponent = z.infer<typeof componentSchema>;
export type TemplateVariableRule = z.infer<typeof variableRuleSchema>;

export interface TemplateContentBindingInput {
  readonly workspaceId: string;
  readonly id: string;
  readonly assetKey: string;
  readonly providerName: string;
  readonly category: "utility" | "marketing" | "authentication";
  readonly language: CatalogueLanguage;
  readonly version: number;
  readonly components: readonly TemplateContentComponent[];
  readonly variableRules: readonly TemplateVariableRule[];
}

type ProviderStateDocument = z.infer<typeof providerStateSchema>;

export type ProviderStateDTO = Omit<ProviderStateDocument, "checkedAt"> & {
  readonly checkedAt: string | null;
};

export type TemplateCatalogueItemDTO = Omit<
  TemplateDocument,
  "providerState" | "createdAt" | "updatedAt"
> & {
  readonly providerState: ProviderStateDTO;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type FlowCatalogueItemDTO = Omit<
  FlowDocument,
  "providerState" | "createdAt" | "updatedAt"
> & {
  readonly providerState: ProviderStateDTO;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export class TemplateRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_input" | "invalid_data" | "not_found",
  ) {
    super(message);
    this.name = "TemplateRepositoryError";
  }
}

function parseListInput(value: unknown): CatalogueListInput {
  const result = catalogueListInputSchema.safeParse(value);
  if (!result.success) {
    throw new TemplateRepositoryError("Catalogue input failed validation.", "invalid_input");
  }
  return result.data;
}

function parseGetInput(value: unknown): CatalogueGetInput {
  const result = catalogueGetInputSchema.safeParse(value);
  if (!result.success) {
    throw new TemplateRepositoryError("Catalogue get input failed validation.", "invalid_input");
  }
  return result.data;
}

function providerStateToDto(value: ProviderStateDocument): ProviderStateDTO {
  return {
    ...value,
    checkedAt: value.checkedAt === null ? null : value.checkedAt.toDate().toISOString(),
  };
}

export function prepareCatalogueListInput(value: CatalogueListInput): CatalogueListInput {
  return parseListInput(value);
}

export function prepareCatalogueGetInput(value: CatalogueGetInput): CatalogueGetInput {
  return parseGetInput(value);
}

function templateComponentTuple(component: TemplateContentComponent): readonly unknown[] {
  if (component.kind === "header") {
    return ["header", "text", component.text, []];
  }
  if (component.kind === "body") {
    return ["body", null, component.text, []];
  }
  if (component.kind === "footer") {
    return ["footer", null, component.text, []];
  }
  return [
    "buttons",
    null,
    null,
    component.buttons.map((button) => [button.type, button.label, button.targetRef]),
  ];
}

/**
 * Canonical, order-preserving binding for approved template message content.
 * Lifecycle, ownership, provider evidence and timestamps are independently
 * validated but deliberately excluded from this content digest.
 */
export function serializeTemplateContentBinding(input: TemplateContentBindingInput): string {
  return JSON.stringify([
    "hemas-connect:template-content:v1",
    input.workspaceId,
    input.id,
    input.assetKey,
    input.providerName,
    input.category,
    input.language,
    input.version,
    input.components.map(templateComponentTuple),
    input.variableRules.map((rule) => [
      rule.key,
      rule.description,
      rule.required,
      rule.maxLength,
      rule.exampleValue,
      rule.allowedPattern,
    ]),
  ]);
}

async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new TemplateRepositoryError(
      "Template content hash verification is unavailable.",
      "invalid_data",
    );
  }
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyTemplateContentHash(
  template: TemplateCatalogueItemDTO,
): Promise<TemplateCatalogueItemDTO> {
  const recomputed = await sha256Hex(serializeTemplateContentBinding(template));
  if (recomputed !== template.contentHash) {
    throw new TemplateRepositoryError(
      "Template version content hash does not match its governed content.",
      "invalid_data",
    );
  }
  return template;
}

export function parseTemplateCatalogueDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): TemplateCatalogueItemDTO {
  const result = templateDocumentSchema.safeParse(value);
  if (!result.success) {
    throw new TemplateRepositoryError("Template version failed schema validation.", "invalid_data");
  }
  const parsed = result.data;
  if (
    parsed.id !== documentId ||
    parsed.workspaceId !== workspaceId ||
    parsed.ownership.ownerWorkspaceId !== workspaceId
  ) {
    throw new TemplateRepositoryError(
      "Template version identity does not match its tenant path.",
      "invalid_data",
    );
  }
  return {
    ...parsed,
    providerState: providerStateToDto(parsed.providerState),
    createdAt: parsed.createdAt.toDate().toISOString(),
    updatedAt: parsed.updatedAt.toDate().toISOString(),
  };
}

export function parseFlowCatalogueDocument(
  value: unknown,
  documentId: string,
  workspaceId: string,
): FlowCatalogueItemDTO {
  const result = flowDocumentSchema.safeParse(value);
  if (!result.success) {
    throw new TemplateRepositoryError("Flow version failed schema validation.", "invalid_data");
  }
  const parsed = result.data;
  if (
    parsed.id !== documentId ||
    parsed.workspaceId !== workspaceId ||
    parsed.ownership.ownerWorkspaceId !== workspaceId
  ) {
    throw new TemplateRepositoryError(
      "Flow version identity does not match its tenant path.",
      "invalid_data",
    );
  }
  return {
    ...parsed,
    providerState: providerStateToDto(parsed.providerState),
    createdAt: parsed.createdAt.toDate().toISOString(),
    updatedAt: parsed.updatedAt.toDate().toISOString(),
  };
}

export function hasVerifiedProviderApproval(
  asset: TemplateCatalogueItemDTO | FlowCatalogueItemDTO,
): boolean {
  const state = asset.providerState;
  return (
    state.submissionState === "submitted" &&
    state.approvalState === "approved" &&
    state.authority === "meta" &&
    state.assetId !== null &&
    state.checkedAt !== null
  );
}

function catalogueConstraints(input: CatalogueListInput): QueryConstraint[] {
  const constraints: QueryConstraint[] = [];
  if (input.language) constraints.push(where("language", "==", input.language));
  constraints.push(orderBy("sortKey", "asc"));
  constraints.push(limit(input.pageSize ?? 100));
  return constraints;
}

export async function listTemplateCatalogue(
  db: Firestore,
  rawInput: CatalogueListInput,
): Promise<readonly TemplateCatalogueItemDTO[]> {
  const input = parseListInput(rawInput);
  const snapshot = await getDocs(
    query(
      collection(db, "workspaces", input.workspaceId, "templates"),
      ...catalogueConstraints(input),
    ),
  );
  const templates = snapshot.docs.map((record) =>
    parseTemplateCatalogueDocument(record.data(), record.id, input.workspaceId),
  );
  return Promise.all(templates.map(verifyTemplateContentHash));
}

export async function getTemplateCatalogueItem(
  db: Firestore,
  rawInput: CatalogueGetInput,
): Promise<TemplateCatalogueItemDTO> {
  const input = parseGetInput(rawInput);
  const snapshot = await getDoc(
    doc(db, "workspaces", input.workspaceId, "templates", input.templateId),
  );
  if (!snapshot.exists()) {
    throw new TemplateRepositoryError("Template version was not found.", "not_found");
  }
  return verifyTemplateContentHash(
    parseTemplateCatalogueDocument(snapshot.data(), snapshot.id, input.workspaceId),
  );
}

export async function listFlowCatalogue(
  db: Firestore,
  rawInput: CatalogueListInput,
): Promise<readonly FlowCatalogueItemDTO[]> {
  const input = parseListInput(rawInput);
  const snapshot = await getDocs(
    query(
      collection(db, "workspaces", input.workspaceId, "flows"),
      ...catalogueConstraints(input),
    ),
  );
  return snapshot.docs.map((record) =>
    parseFlowCatalogueDocument(record.data(), record.id, input.workspaceId),
  );
}
