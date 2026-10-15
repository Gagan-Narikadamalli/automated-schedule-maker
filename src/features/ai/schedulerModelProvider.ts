import { createGoogle } from "@ai-sdk/google";
import type { generateText } from "ai";
import { getSchedulerOpenAIModel, schedulerOpenAIOptions } from "./openaiProvider";

export const DEFAULT_GEMINI_SCHEDULER_MODEL = "gemini-3.8-flash";
export const GEMINI_SETUP_MESSAGE = "Gemini is not configured. Add GOOGLE_GENERATIVE_AI_API_KEY to the server environment, then redeploy. Your schedule has not been changed.";

export function getSchedulerCloudProvider(): "gemini" | "openai" {
  return process.env.SCHEDULER_AI_PROVIDER?.trim().toLowerCase() === "openai" ? "openai" : "gemini";
}

export function getSchedulerModel(vision = false) {
  if (getSchedulerCloudProvider() === "openai") return getSchedulerOpenAIModel(vision);
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error(GEMINI_SETUP_MESSAGE);
  const modelId = (vision ? process.env.GEMINI_SCHEDULER_VISION_MODEL : undefined)?.trim() || process.env.GEMINI_SCHEDULER_MODEL?.trim() || DEFAULT_GEMINI_SCHEDULER_MODEL;
  return createGoogle({apiKey,baseURL:"https://generativelanguage.googleapis.com/v1beta"})(modelId.replace(/^(?:google|models)\//,""));
}

export function schedulerModelOptions(structured = false, thinkingLevel: "low" | "high" = "high"): NonNullable<Parameters<typeof generateText>[0]["providerOptions"]> {
  return getSchedulerCloudProvider() === "openai"
    ? {...schedulerOpenAIOptions,openai:{...schedulerOpenAIOptions.openai,strictJsonSchema:structured}}
    : {google:{structuredOutputs:true,thinkingConfig:{thinkingLevel,includeThoughts:false}}};
}
