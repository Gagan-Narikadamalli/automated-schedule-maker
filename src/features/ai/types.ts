export type SchedulerAiMode = "READ_ONLY" | "AUTONOMOUS";

export type SchedulerAiDateSource =
  | "TODAY"
  | "RELATIVE_DATE"
  | "EXPLICIT_DATE"
  | "WEEKDAY"
  | "SELECTED_DAY"
  | "SELECTED_WEEK"
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

export type SchedulerAiHistoryMessage = {
  role: "user" | "assistant";
  text: string;
};

export type SchedulerAiRequest = {
  message?: string;
  locationId?: string;
  locationName?: string;
  date?: string;
  dateSelectionExplicit?: boolean;
  history?: SchedulerAiHistoryMessage[];
};

export type SchedulerAiResponse = {
  reply: string;
  trainingExampleId: string | null;
  toolsUsed: string[];
  writeToolsUsed: string[];
  changed: boolean;
  mode: SchedulerAiMode;
  effectiveDate?: string;
};

export type SchedulerAiFeedbackRequest = {
  trainingExampleId?: string;
  accepted?: boolean;
  correction?: string;
};