import { POST as generate } from "@/app/api/schedule/ai-generate/route";
import { jsonSchema, tool } from "./schedulerToolDefinition";
import type { SchedulerAiContext } from "./types";

export function createOpenAIGenerationTools(context:SchedulerAiContext) {
  return {
    generate_schedule: tool({
      description:"Independently design and validate a day schedule with the configured OpenAI model’s own reasoning using current website data and historical patterns. The same operation is used by AI Generate. Preferences guide the model; hard availability, restrictions, double-booking and events are validated before saving. Use scope DAY. save defaults true; set save=false for a requested preview. Never set allowProtectedReplacement=true without the manager's explicit permission to replace protected/locked/manual/template assignments on this date. A 409 PROTECTED_REGENERATION result requires that permission before retrying. For a work week, ask the manager to generate one selected day at a time.",
      inputSchema:jsonSchema<{scope:"DAY";save?:boolean;allowProtectedReplacement?:boolean}>({type:"object",properties:{scope:{type:"string",enum:["DAY"]},save:{type:"boolean"},allowProtectedReplacement:{type:"boolean"}},required:["scope"],additionalProperties:false}),
      execute:async(input)=>{
        const response=await generate(new Request("http://scheduler-ai.internal/api/schedule/ai-generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({locationId:context.locationId,date:context.date,save:input.save!==false,allowProtectedReplacement:input.allowProtectedReplacement===true})}));
        const data=await response.json();
        return {...data,changed:data.saved===true,ok:response.ok,status:response.status};
      },
    }),
  };
}
