import type {
  ISODateTime,
  SupportedLanguage,
  TemplateId,
  TemplateVersionId,
  WorkspaceScopedEntity,
} from "./primitives";
import type { MessageCategory } from "./contacts";

export type TemplateLifecycleState =
  | "draft"
  | "submitted"
  | "approved"
  | "paused"
  | "disabled"
  | "rejected";

export type TemplateApprovalAuthority = "none" | "simulator" | "meta";

export interface TemplateVariableRule {
  readonly key: string;
  readonly description: string;
  readonly required: boolean;
  readonly maxLength: number;
  readonly exampleValue: string;
  readonly allowedPattern?: string;
}

export type TemplateComponent =
  | { readonly kind: "header"; readonly format: "text"; readonly text: string }
  | { readonly kind: "body"; readonly text: string }
  | { readonly kind: "footer"; readonly text: string }
  | {
      readonly kind: "buttons";
      readonly buttons: readonly {
        readonly type: "quick_reply" | "url" | "flow";
        readonly label: string;
        readonly targetRef: string;
      }[];
    };

export interface MessageTemplate extends WorkspaceScopedEntity<TemplateId> {
  readonly providerName: string;
  readonly category: MessageCategory;
  readonly language: SupportedLanguage;
  readonly activeVersionId: TemplateVersionId;
  readonly safeNetOwned: boolean;
}

/** Template versions are immutable once referenced by an approved campaign. */
export interface MessageTemplateVersion extends WorkspaceScopedEntity<TemplateVersionId> {
  readonly templateId: TemplateId;
  readonly version: number;
  readonly lifecycleState: TemplateLifecycleState;
  readonly approvalAuthority: TemplateApprovalAuthority;
  readonly providerTemplateId: string | null;
  readonly components: readonly TemplateComponent[];
  readonly variableRules: readonly TemplateVariableRule[];
  readonly qualityRating: "unknown" | "high" | "medium" | "low";
  readonly qualityCheckedAt: ISODateTime | null;
  readonly immutable: boolean;
  readonly rejectionReason: string | null;
}

export function isTemplateEligible(input: {
  readonly version: MessageTemplateVersion;
  readonly dispatchMode: "simulation" | "external";
}): boolean {
  if (input.version.lifecycleState !== "approved" || !input.version.immutable) {
    return false;
  }

  if (input.dispatchMode === "external") {
    return input.version.approvalAuthority === "meta" && input.version.providerTemplateId !== null;
  }

  return input.version.approvalAuthority === "simulator" || input.version.approvalAuthority === "meta";
}

