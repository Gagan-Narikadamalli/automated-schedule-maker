export type SchedulerAiMode = "READ_ONLY" | "AUTONOMOUS";

export type SchedulerAiContext = {
  locationId: string;
  locationName?: string;
  date: string;
  userId: string;
};

export type SchedulerAiRequest = {
  message?: string;
  locationId?: string;
  locationName?: string;
  date?: string;
};

export type SchedulerAiResponse = {
  reply: string;
  trainingExampleId: string | null;
  toolsUsed: string[];
  writeToolsUsed: string[];
  changed: boolean;
  mode: SchedulerAiMode;
};

export type SchedulerAiFeedbackRequest = {
  trainingExampleId?: string;
  accepted?: boolean;
  correction?: string;
};
