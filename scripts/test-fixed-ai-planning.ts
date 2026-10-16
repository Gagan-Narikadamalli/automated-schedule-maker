import assert from "node:assert/strict";
import { buildFixedScheduleChoices,decodeFixedScheduleChoices,type FixedScheduleChoices,type FixedScheduleSnapshot } from "../src/features/ai/fixedScheduleChoices";
import { designOpenAISchedule,expandOpenAIPlan } from "../src/features/ai/openaiSchedulePlan";
import { validateOpenAIPlan } from "../src/features/ai/validateOpenAIPlan";
import type { SchedulerInput } from "../src/features/scheduler/engine/types";
import { schedulerProviderStatus } from "../src/features/ai/schedulerProviderErrors";

async function main(){
  const times=["11:00","11:30","12:00","12:30"];
  const snapshot:FixedScheduleSnapshot={useFixedCells:true,staff:[1,2,3,4].map(n=>({id:`Staff${n}`,availableSlots:times,role:"BT"})),
    clients:[{id:"Client1",requiredSlots:times,napSlots:["12:00"],speechSlots:[],excludedStaff:[]},{id:"Client2",requiredSlots:times,napSlots:[],speechSlots:[],excludedStaff:["Staff1"]}],calledOutStaff:["Staff4"],rules:{breakWindowStart:"11:00",breakWindowEnd:"14:00"}};
  const choices:FixedScheduleChoices={napTimes:{Client1:"12:00"},breakTimes:{Staff1:"12:00",Staff2:"11:30",Staff3:"12:30"},
    staffByTime:{"11:00":["Staff1","Staff2"],"11:30":["Staff1","Staff3"],"12:00":["Staff1","Staff2"],"12:30":["Staff1","Staff2"]},
    explanation:"Continuous care and a nap-linked break.",decisions:["Keep Client1 with Staff1 through the nap."],tradeoffs:[]};
  const grid=buildFixedScheduleChoices(snapshot);
  assert.ok(!("Staff4" in (grid.schema.properties as any).breakTimes.properties));
  assert.ok(!grid.candidateSets[grid.grid["11:00"].Client2].includes("Staff1"));
  assert.ok(Object.values(grid.candidateSets).every(group=>!group.includes("Staff4")));
  const staffRefs=new Map([1,2,3,4].map(n=>[`Staff${n}`,`s${n}`]));
  const clientRefs=new Map([1,2].map(n=>[`Client${n}`,`c${n}`]));
  const input={staff:[1,2,3,4].map(n=>({id:`s${n}`,name:`s${n}`,role:"BT",availableSlots:times,maximumWeeklyHours:40})),
    clients:[{id:"c1",displayCode:"c1",requiredSlots:times,napSlots:["12:00"],speechSlots:[],staffRelationships:{}},{id:"c2",displayCode:"c2",requiredSlots:times,napSlots:[],speechSlots:[],staffRelationships:{s1:"HARD_RESTRICTION"}}],callOutStaffIds:["s4"],existingAssignments:[],referenceAssignments:[],rules:{slotLengthMinutes:30}} as unknown as SchedulerInput;
  const plan=decodeFixedScheduleChoices(snapshot,choices);
  const rows=expandOpenAIPlan(plan,staffRefs,clientRefs);
  assert.equal(rows.length,10);
  const audit=validateOpenAIPlan(input,rows);assert.deepEqual(audit.problems,[]);assert.equal(audit.covered,8);assert.equal(audit.missing.length,0);
  const clash=structuredClone(choices);clash.staffByTime["11:00"][1]="Staff1";
  assert.ok(validateOpenAIPlan(input,expandOpenAIPlan(decodeFixedScheduleChoices(snapshot,clash),staffRefs,clientRefs)).problems.some(item=>item.includes("Staff double-booked")));
  assert.throws(()=>decodeFixedScheduleChoices(snapshot,{...choices,staffByTime:{...choices.staffByTime,"14:00":["Staff1"]}}),/extra client\/time/);
  const partial=structuredClone(choices);partial.staffByTime["11:00"][1]="UNPLACED";
  assert.equal(validateOpenAIPlan(input,expandOpenAIPlan(decodeFixedScheduleChoices(snapshot,partial),staffRefs,clientRefs)).missing.length,1);
  const fetchBefore=globalThis.fetch,envBefore={provider:process.env.SCHEDULER_AI_PROVIDER,key:process.env.GOOGLE_GENERATIVE_AI_API_KEY,model:process.env.GEMINI_SCHEDULER_MODEL};
  process.env.SCHEDULER_AI_PROVIDER="gemini";process.env.GOOGLE_GENERATIVE_AI_API_KEY="dummy-not-real";process.env.GEMINI_SCHEDULER_MODEL="gemini-3.5-flash-lite";
  let attempts=0;
  globalThis.fetch=async(_url,options)=>{
    const body=JSON.parse(String(options?.body));assert.match(JSON.stringify(body.systemInstruction),/one TIME COLUMN at a time/);
    assert.equal(body.generationConfig.responseJsonSchema.properties.staffByTime.properties["11:00"].minItems,2);
    if(attempts++===0)return new Response(JSON.stringify({error:{code:503,message:"Temporary high demand",status:"UNAVAILABLE"}}),{status:503,headers:{"Content-Type":"application/json","retry-after-ms":"1"}});
    return new Response(JSON.stringify({candidates:[{content:{role:"model",parts:[{text:JSON.stringify(choices)}]},finishReason:"STOP",index:0}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:10,totalTokenCount:20}}),{headers:{"Content-Type":"application/json"}});
  };
  try{
    assert.deepEqual(await designOpenAISchedule(snapshot),plan);assert.equal(attempts,2);
    let failures=0;
    globalThis.fetch=async()=>{failures++;return new Response(JSON.stringify({error:{code:503,message:"Temporary high demand",status:"UNAVAILABLE"}}),{status:503,headers:{"Content-Type":"application/json","retry-after-ms":"1"}});};
    await assert.rejects(designOpenAISchedule(snapshot),error=>schedulerProviderStatus(error)===503);
    assert.equal(failures,2,"Stop after one retry; preserve the provider status when exhausted.");
  }finally{globalThis.fetch=fetchBefore;for(const [key,value] of [["SCHEDULER_AI_PROVIDER",envBefore.provider],["GOOGLE_GENERATIVE_AI_API_KEY",envBefore.key],["GEMINI_SCHEDULER_MODEL",envBefore.model]]){if(value===undefined)delete process.env[key!];else process.env[key!]=value;}}
  console.log("PASS fixed client/time cells, model-selected staff and event times, candidate eligibility, linked nap breaks, no fabricated attendance, conflict rejection and explicit uncovered cells (mocked).");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
