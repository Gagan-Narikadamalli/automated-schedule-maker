import type { generateText } from "ai";
import { getSchedulerOpenAIModel, schedulerOpenAIOptions } from "./openaiProvider";
/** Paid Scheduler AI uses direct OpenAI API credentials, not Gemini or Gateway. */
export function getSchedulerCloudProvider(): "openai" { return "openai"; }
export function getSchedulerModel(vision = false) { return getSchedulerOpenAIModel(vision); }
export function schedulerModelOptions(
  structured = false, _thinkingLevel: "low" | "medium" | "high" = "high"
): NonNullable<Parameters<typeof generateText>[0]["providerOptions"]> {
  return { ...schedulerOpenAIOptions, openai: { ...schedulerOpenAIOptions.openai, strictJsonSchema: structured } };
}
