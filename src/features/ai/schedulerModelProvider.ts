import { createGoogle } from "@ai-sdk/google";
import type { generateText } from "ai";
import { getSchedulerOpenAIModel, schedulerOpenAIOptions } from "./openaiProvider";

export const DEFAULT_GEMINI_SCHEDULER_MODEL = "gemini-3.6-flash";
export const GEMINI_SETUP_MESSAGE = "Gemini is not configured. Add GOOGLE_GENERATIVE_AI_API_KEY to the server environment, then redeploy. Your schedule has not been changed.";

export function getSchedulerCloudProvider(): "gemini" | "openai" {
  return process.env.SCHEDULER_AI_PROVIDER?.trim().toLowerCase() === "openai" ? "openai" : "gemini";
}

export function getSchedulerModel(vision = false) {
  if (getSchedulerCloudProvider() === "openai") return getSchedulerOpenAIModel(vision);
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error(GEMINI_SETUP_MESSAGE);
  const modelId = (vision ? process.env.GEMINI_SCHEDULER_VISION_MODEL : undefined)?.trim() || process.env.GEMINI_SCHEDULER_MODEL?.trim() || DEFAULT_GEMINI_SCHEDULER_MODEL;
  return createGoogle({apiKey,baseURL:"https://generativelanguage.googleapis.com/v1beta",fetch:async(url,options)=>{
    const started=Date.now();
    const response=await globalThis.fetch(url,options);
    // Operational metadata only: never log prompts, aliases or credentials.
    console.info("Scheduler Gemini response",{model:modelId,status:response.status,elapsedMs:Date.now()-started});
    if(!response.ok){
      const body=await response.clone().json().catch(()=>null) as {error?:{message?:string}}|null;
      const detail=body?.error?.message?.replaceAll(apiKey,"[redacted]").slice(0,800);
      console.warn("Scheduler Gemini rejection",{status:response.status,detail});
    }
    return response;
  }})(modelId.replace(/^(?:google|models)\//,""));
}

export function schedulerModelOptions(structured = false, thinkingLevel: "low" | "medium" | "high" = "high"): NonNullable<Parameters<typeof generateText>[0]["providerOptions"]> {
  return getSchedulerCloudProvider() === "openai"
    ? {...schedulerOpenAIOptions,openai:{...schedulerOpenAIOptions.openai,strictJsonSchema:structured}}
    : {google:{structuredOutputs:true,thinkingConfig:{thinkingLevel,includeThoughts:false}}};
}
