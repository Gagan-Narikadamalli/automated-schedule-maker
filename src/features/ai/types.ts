export type SchedulerAiMode = "READ_ONLY" | "AUTONOMOUS";
export type SchedulerAiProviderMode = "native" | "gateway";
export type SchedulerAiThinkingLevel = "low" | "high";

export type SchedulerAiDateSource =
  | "TODAY"
  | "RELATIVE_DATE"
  | "EXPLICIT_DATE"
  | "WEEKDAY"
  | "SELECTED_DAY"
  | "SELECTED_WEEK"
  | "CONVERSATION"
  | "PASSIVE_SELECTION";

export type SchedulerAiContext = {
  locationId: string;
  locationName?: string;
  date: string;
  selectedDate: string;
  todayDate: string;
  dateSource: SchedulerAiDateSource;
  dateSelectionExplicit: boolean;
  userId: string;
};

export type SchedulerAiAttachmentMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/webp";

export type SchedulerAiAttachment = {
  name: string;
  mimeType: SchedulerAiAttachmentMimeType;
  dataUrl: string;
};

export type SchedulerAiHistoryMessage = {
  role: "user" | "assistant";
  text: string;
  effectiveDate?: string;
  attachmentContext?: string;
  attachmentNames?: string[];
};

export type SchedulerAiRequest = {
  message?: string;
  locationId?: string;
  locationName?: string;
  date?: string;
  dateSelectionExplicit?: boolean;
  history?: SchedulerAiHistoryMessage[];
  attachments?: SchedulerAiAttachment[];
};

export type SchedulerAiResponse = {
  reply: string;
  trainingExampleId: string | null;
  toolsUsed: string[];
  writeToolsUsed: string[];
  changed: boolean;
  mode: SchedulerAiMode;
  provider: SchedulerAiProviderMode;
  thinkingLevel: SchedulerAiThinkingLevel;
  effectiveDate?: string;
  attachmentAnalysis?: string;
  attachmentNames?: string[];
  attachmentPreviewOnly?: boolean;
};

export type SchedulerAiFeedbackRequest = {
  trainingExampleId?: string;
  accepted?: boolean;
  correction?: string;
};
