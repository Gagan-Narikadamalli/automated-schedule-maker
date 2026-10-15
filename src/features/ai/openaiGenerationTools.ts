import { POST as generate } from "@/app/api/schedule/ai-generate/route";
import { jsonSchema, tool } from "./schedulerToolDefinition";
import type { SchedulerAiContext } from "./types";

export function createOpenAIGenerationTools(context:SchedulerAiContext) {
  return {
    generate_schedule: tool({
      description:"Independently design and validate a day schedule with OpenAI reasoning using current website data and historical patterns. The same operation is used by AI Generate. Preferences guide the model; hard availability, restrictions, double-booking, events and protected edits are validated before saving. Use scope DAY. For a work week, ask the manager to generate one selected day at a time.",
      inputSchema:jsonSchema<{scope:"DAY"}>({type:"object",properties:{scope:{type:"string",enum:["DAY"]}},required:["scope"],additionalProperties:false}),
      execute:async()=>{
        const response=await generate(new Request("http://scheduler-ai.internal/api/schedule/ai-generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({locationId:context.locationId,date:context.date,save:true})}));
        const data=await response.json();
        return {...data,ok:response.ok,status:response.status};
      },
    }),
  };
}
