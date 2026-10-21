import assert from "node:assert/strict";
import { getSchedulerOpenAIModel, OPENAI_SETUP_MESSAGE } from "../src/features/ai/openaiProvider";
import { isWebsiteRequest } from "../src/features/ai/websiteScope";
import { designOpenAISchedule, expandOpenAIPlan, type OpenAISchedulePlan } from "../src/features/ai/openaiSchedulePlan";
import { validateOpenAIPlan } from "../src/features/ai/validateOpenAIPlan";
import { isExplicitDayGenerationCommand, isProtectedDayGenerationApproval } from "../src/features/ai/schedulerActionIntent";
import type { SchedulerInput } from "../src/features/scheduler/engine/types";
import { POST as generateRoute } from "../src/app/api/schedule/ai-generate/route";
import { POST as paidRoute } from "../src/app/api/ai/paid/route";

async function main() {
 assert.equal(isExplicitDayGenerationCommand("generate a new schedule for today"),true);
 assert.equal(isExplicitDayGenerationCommand("regenerate the schedule for 2026-10-21"),true);
 assert.equal(isExplicitDayGenerationCommand("how can I generate a new schedule?"),false);
 assert.equal(isExplicitDayGenerationCommand("generate next week's schedule"),false);
 const confirmation=[{role:"user",text:"generate a new schedule for today"},
   {role:"assistant",text:"The saved schedule for 2026-10-21 contains 23 protected assignments. Rebuilding the day will replace them. Do you allow me to override these protected assignments and proceed?"}];
 assert.equal(isProtectedDayGenerationApproval("yes",confirmation,"2026-10-21"),true);
 assert.equal(isProtectedDayGenerationApproval("yes",confirmation,"2026-10-22"),false);
 assert.equal(isProtectedDayGenerationApproval("yes",[], "2026-10-21"),false);
 assert.equal(isProtectedDayGenerationApproval("no",confirmation,"2026-10-21"),false);
 const previousProvider=process.env.SCHEDULER_AI_PROVIDER;process.env.SCHEDULER_AI_PROVIDER="openai";
 const key=process.env.OPENAI_API_KEY;delete process.env.OPENAI_API_KEY;
 assert.throws(()=>getSchedulerOpenAIModel(),new RegExp(OPENAI_SETUP_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
 for(const handler of [generateRoute,paidRoute]){
  const response=await handler(new Request("http://localhost/api/ai",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({locationId:"000000000000000000000001",date:"2026-10-16",message:"Generate the clinic schedule",save:true})}));
  assert.equal(response.status,503);assert.equal((await response.json()).error,OPENAI_SETUP_MESSAGE);
 }
 process.env.OPENAI_API_KEY="test-only-placeholder";
 const fetchOriginal=globalThis.fetch;const requests:Record<string,any>[]=[];
 const plan:OpenAISchedulePlan={segments:[
  {staff:"S0",client:"C0",startTime:"11:00",endTime:"12:00",type:"CLIENT_1_TO_1"},
  {staff:"S0",client:null,startTime:"12:00",endTime:"12:30",type:"BREAK"},
  {staff:"S1",client:"C0",startTime:"12:00",endTime:"13:00",type:"CLIENT_1_TO_1"},
  {staff:"S1",client:null,startTime:"11:30",endTime:"12:00",type:"BREAK"},
 ],explanation:"Two continuous blocks with lunch relief.",decisions:["S1 covers while S0 rests."],tradeoffs:["The preferred pairing changes for break coverage."]};
 const outputs=[{allowed:false},{allowed:true},plan];
 globalThis.fetch=async(url,options)=>{
  assert.equal(String(url),"https://api.openai.com/v1/responses");
  const body=JSON.parse(String(options?.body));requests.push(body);assert.equal(body.store,false);
  return new Response(JSON.stringify({id:"resp_test",object:"response",created_at:1,status:"completed",model:body.model,output:[{type:"message",id:"msg_test",role:"assistant",status:"completed",content:[{type:"output_text",text:JSON.stringify(outputs.shift()),annotations:[]}]}],usage:{input_tokens:10,output_tokens:10,total_tokens:20}}),{headers:{"Content-Type":"application/json"}});
 };
 try {
  assert.equal(await isWebsiteRequest("Who won a football game?",[],false),false);
  assert.equal(await isWebsiteRequest("Generate Friday's clinic schedule",[],false),true);
  const generated=await designOpenAISchedule({staff:["S0","S1"],clients:["C0"]});
  assert.deepEqual(generated,plan);assert.match(JSON.stringify(requests[2].input),/independently design/);assert.ok(!requests[2].tools?.length);
  const rows=expandOpenAIPlan(generated,new Map([["S0","s0"],["S1","s1"]]),new Map([["C0","c0"]]));
  assert.equal(rows.length,6);
  const input={staff:["s0","s1"].map(id=>({id,name:id,role:"BT",availableSlots:["11:00","11:30","12:00","12:30"],maximumWeeklyHours:40})),clients:[{id:"c0",displayCode:"C0",requiredSlots:["11:00","11:30","12:00","12:30"],napSlots:[],speechSlots:[],staffRelationships:{}}],existingAssignments:[],referenceAssignments:[],callOutStaffIds:[],rules:{slotLengthMinutes:30,maximumClientsPerTechPerDay:1,maximumTechsPerClientPerDay:1}} as unknown as SchedulerInput;
  assert.deepEqual(validateOpenAIPlan(input,rows).problems,[]);assert.deepEqual(validateOpenAIPlan(input,rows).missing,[]);
  // Soft one-staff target does not reject this model's safe lunch handoff.
  assert.ok(validateOpenAIPlan(input,[...rows,rows[0]]).problems.some(x=>x.includes("double-booked")));
  assert.ok(validateOpenAIPlan({...input,callOutStaffIds:["s0"]},rows).problems.some(x=>x.includes("unavailable")));
  const restricted=structuredClone(input);restricted.clients[0].staffRelationships.s0="HARD_RESTRICTION";
  assert.ok(validateOpenAIPlan(restricted,rows).problems.some(x=>x.includes("Hard relationship")));
  const capped=structuredClone(input);capped.staff[0].maximumWeeklyHours=.5;
  assert.ok(validateOpenAIPlan(capped,rows).problems.some(x=>x.includes("Weekly hour")));
  const nap=structuredClone(input);nap.clients[0].napSlots=["11:30"];
  assert.ok(validateOpenAIPlan(nap,rows).problems.some(x=>x.includes("one nap")));
  const speech=structuredClone(input);speech.clients[0].speechSlots=["11:30"];
  assert.ok(validateOpenAIPlan(speech,rows).problems.some(x=>x.includes("Fixed speech")));
  assert.throws(()=>expandOpenAIPlan({...plan,segments:[{...plan.segments[0],staff:"UNKNOWN"}]},new Map(),new Map()),/unknown/);
  assert.throws(()=>expandOpenAIPlan({...plan,segments:[{...plan.segments[0],startTime:"11:15"}]},new Map([["S0","s0"]]),new Map([["C0","c0"]])),/non-grid/);
  console.log("PASS OpenAI Responses routing, website scope, independent plan, decision summary, segment expansion, hard validation and soft-guideline flexibility (mocked provider; no real API calls).");
 }finally{globalThis.fetch=fetchOriginal;if(previousProvider)process.env.SCHEDULER_AI_PROVIDER=previousProvider;else delete process.env.SCHEDULER_AI_PROVIDER;if(key)process.env.OPENAI_API_KEY=key;else delete process.env.OPENAI_API_KEY;}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
