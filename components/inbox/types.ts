import type {
  ConsentRecordDTO,
  ContactListItemDTO,
  ConversationListItemDTO,
  MessageMetadataDTO,
} from "@/lib/firebase/repositories";

export interface InboxConversationRecord {
  readonly conversation: ConversationListItemDTO;
  readonly contact: ContactListItemDTO;
  readonly messages: readonly MessageMetadataDTO[];
  readonly consentRecords: readonly ConsentRecordDTO[];
  readonly teamName: string;
  readonly locationName: string;
}

export type InboxStatusFilter = "all" | ConversationListItemDTO["status"];
export type InboxLanguageFilter = "all" | "en" | "si" | "ta";

export interface LocalTimelineEvent {
  readonly id: string;
  readonly conversationId: ConversationListItemDTO["id"];
  readonly kind: "simulated_reply" | "system";
  readonly preview: string;
  readonly occurredAt: string;
}

export type ConversationModeOverrides = Readonly<
  Partial<Record<string, ConversationListItemDTO["mode"]>>
>;
