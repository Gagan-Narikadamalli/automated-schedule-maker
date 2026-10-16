import { createOpenAI } from "@ai-sdk/openai";

export const DEFAULT_OPENAI_SCHEDULER_MODEL = "gpt-6.1-sol";
export const OPENAI_SETUP_MESSAGE = "OpenAI is not configured. Add OPENAI_API_KEY to the server environment, then redeploy. Your schedule has not been changed.";

export function getSchedulerOpenAIModel(vision = false) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error(OPENAI_SETUP_MESSAGE);
  const modelId = (vision ? process.env.OPENAI_SCHEDULER_VISION_MODEL : undefined)?.trim() || process.env.OPENAI_SCHEDULER_MODEL?.trim() || DEFAULT_OPENAI_SCHEDULER_MODEL;
  // Explicit provider object: never allow the AI SDK to route through Gateway.
  return createOpenAI({ apiKey, baseURL: "https://api.openai.com/v1" }).responses(modelId.replace(/^openai\//, ""));
}

export const schedulerOpenAIOptions = { openai: { store: false, strictJsonSchema: false } };
