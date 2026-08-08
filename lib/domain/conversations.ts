import type {
  ConnectionId,
  ContactId,
  ConversationId,
  CorrelationId,
  ISODateTime,
  MemberId,
  MessageId,
  RequestId,
  SupportedLanguage,
  TeamId,
  TemplateVersionId,
  WorkspaceScopedEntity,
} from "./primitives";

export type ConversationStatus =
  | "active"
  | "waiting"
  | "assigned"
  | "escalated"
  | "resolved"
  | "reopened";
export type ConversationMode = "automation" | "human_takeover" | "safety_hold";

export interface Conversation extends WorkspaceScopedEntity<ConversationId> {
  readonly contactId: ContactId;
  readonly connectionId: ConnectionId;
  readonly status: ConversationStatus;
  readonly mode: ConversationMode;
  readonly teamId: TeamId;
  readonly assigneeId: MemberId | null;
  readonly detectedLanguage: SupportedLanguage;
  readonly languageConfidence: number;
  readonly purpose:
    | "appointment"
    | "laboratory"
    | "package"
    | "care_pathway"
    | "feedback"
    | "general_support"
    | "urgent_escalation";
  readonly serviceWindowExpiresAt: ISODateTime | null;
  readonly firstResponseDueAt: ISODateTime;
  readonly lastMessageAt: ISODateTime;
  readonly handoffSummary: string;
  readonly unreadCount: number;
  readonly synthetic: boolean;
}

export type MessageDirection = "inbound" | "outbound" | "internal";
export type MessageType = "text" | "template" | "image" | "document" | "interactive" | "system";
export type MessageStatus =
  | "received"
  | "queued"
  | "simulated"
  | "accepted"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "suppressed"
  | "send_uncertain";

export type ExternalDispatchState =
  | "not_applicable"
  | "disabled"
  | "simulation_only"
  | "eligible"
  | "blocked"
  | "dispatched";

export interface RedactedMessageContent {
  readonly safePreview: string;
  readonly protectedContentRef: string | null;
  readonly containsClinicalContent: boolean;
  readonly redactionApplied: boolean;
}

export interface Message extends WorkspaceScopedEntity<MessageId> {
  readonly conversationId: ConversationId;
  readonly contactId: ContactId;
  readonly direction: MessageDirection;
  readonly type: MessageType;
  readonly status: MessageStatus;
  readonly externalDispatch: ExternalDispatchState;
  readonly providerMessageId: string | null;
  readonly templateVersionId: TemplateVersionId | null;
  readonly actorId: MemberId | null;
  readonly content: RedactedMessageContent;
  readonly correlationId: CorrelationId;
  readonly requestId: RequestId;
  readonly receivedAt: ISODateTime | null;
  readonly sentAt: ISODateTime | null;
  readonly deliveredAt: ISODateTime | null;
  readonly failureCode: string | null;
  readonly synthetic: boolean;
}

export interface ComposerPolicyDecision {
  readonly allowed: boolean;
  readonly requiresTemplate: boolean;
  readonly reason:
    | "within_service_window"
    | "approved_template_required"
    | "human_takeover_required"
    | "safety_hold"
    | "external_messaging_disabled";
}

export function isServiceWindowOpen(conversation: Conversation, at: ISODateTime): boolean {
  return (
    conversation.serviceWindowExpiresAt !== null &&
    Date.parse(at) <= Date.parse(conversation.serviceWindowExpiresAt)
  );
}

export function evaluateComposerPolicy(input: {
  readonly conversation: Conversation;
  readonly at: ISODateTime;
  readonly externalMessagingEnabled: boolean;
  readonly hasApprovedTemplate: boolean;
}): ComposerPolicyDecision {
  if (input.conversation.mode === "safety_hold") {
    return { allowed: false, requiresTemplate: false, reason: "safety_hold" };
  }

  if (input.conversation.mode !== "human_takeover") {
    return { allowed: false, requiresTemplate: false, reason: "human_takeover_required" };
  }

  if (!input.externalMessagingEnabled) {
    return { allowed: false, requiresTemplate: false, reason: "external_messaging_disabled" };
  }

  if (isServiceWindowOpen(input.conversation, input.at)) {
    return { allowed: true, requiresTemplate: false, reason: "within_service_window" };
  }

  return {
    allowed: input.hasApprovedTemplate,
    requiresTemplate: true,
    reason: "approved_template_required",
  };
}

