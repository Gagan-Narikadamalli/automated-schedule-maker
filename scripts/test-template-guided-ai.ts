import assert from "node:assert/strict";
import {designOpenAISchedule,expandOpenAIPlan} from "../src/features/ai/openaiSchedulePlan";
import {hasUsefulTemplateEvidence,buildTemplateGuidedChoices} from "../src/features/ai/templateGuidedDayPlanner";
import {validateFixedEventChoices} from "../src/features/ai/openaiBatchedDayPlanner";
import {validateOpenAIPlan} from "../src/features/ai/validateOpenAIPlan";
import type {FixedScheduleSnapshot} from "../src/features/ai/fixedScheduleChoices";
import type {SchedulerInput} from "../src/features/scheduler/engine/types";
const slots=Array.from({length:10},(_,i)=>{
  const t=600+i*30;
  return String(Math.floor(t/60)).padStart(2,"0")+":"+String(t%60).padStart(2,"0");
});
const snapshot:FixedScheduleSnapshot={
  useFixedCells:true,date:"2026-10-22",
  rules:{breakWindowStart:"11:00",breakWindowEnd:"14:00"},
  calledOutStaff:[],
  staff:["Staff1","Staff2","Staff3"].map(id=>({id,role:"BT",availableSlots:slots,serviceSetting:"IN_CENTER"})),
  clients:[
    {id:"Client1",requiredSlots:slots,napSlots:["12:00"],speechSlots:[],excludedStaff:[],serviceSetting:"IN_CENTER"},
    {id:"Client2",requiredSlots:slots,napSlots:["12:30"],speechSlots:[],excludedStaff:[],serviceSetting:"IN_CENTER"}
  ],
  templates:[{
    isApplied:true,sourceType:"WORKBOOK",
    assignments:[
      {staff:"Staff1",client:"Client1",startTime:"10:00",endTime:"14:30",type:"CLIENT_1_TO_1"},
      {staff:"Staff2",client:"Client2",startTime:"10:00",endTime:"14:30",type:"CLIENT_1_TO_1"},
      // An isolated historical cell is *not* a better plan than continuity.
      {staff:"Staff3",client:"Client1",startTime:"11:00",endTime:"11:30",type:"CLIENT_1_TO_1"}
    ]
  }],
  referenceAssignments:[],
  regenerationPolicy:"Use historical templates only as references to cover current clients safely."
};
assert.equal(hasUsefulTemplateEvidence(snapshot),true);
const raw=buildTemplateGuidedChoices(snapshot);
assert.deepEqual(validateFixedEventChoices(snapshot,raw),[]);
const prior=globalThis.fetch,oldKey=process.env.OPENAI_API_KEY;
process.env.OPENAI_API_KEY="mock-api";
let calls=0;
const toRows=(plan:Awaited<ReturnType<typeof designOpenAISchedule>>)=>{
  const rows=expandOpenAIPlan(plan,
    new Map([["Staff1","s1"],["Staff2","s2"],["Staff3","s3"]]),
    new Map([["Client1","c1"],["Client2","c2"]]));
  const input={staff:["s1","s2","s3"].map(id=>({id,name:id,role:"BT",availableSlots:slots,serviceSetting:"IN_CENTER"})),
    clients:[{id:"c1",displayCode:"c1",requiredSlots:slots,napSlots:["12:00"],speechSlots:[],staffRelationships:{},serviceSetting:"IN_CENTER"},
      {id:"c2",displayCode:"c2",requiredSlots:slots,napSlots:["12:30"],speechSlots:[],staffRelationships:{},serviceSetting:"IN_CENTER"}],
    callOutStaffIds:[],existingAssignments:[],referenceAssignments:[],rules:{slotLengthMinutes:30}
  } as unknown as SchedulerInput;
  const audit=validateOpenAIPlan(input,rows);
  assert.deepEqual(audit.problems,[]);
  assert.equal(audit.missing.length,0);
  assert.equal(audit.covered,20);
  assert.equal(rows.filter(r=>r.assignmentType==="BREAK_NAP").length,2);
  assert.equal(rows.filter(r=>r.assignmentType==="BREAK").length,1);
  assert.ok(rows.some(r=>r.clientId==="c1"&&r.startTime==="11:00"&&r.staffId==="s1"),
    "An isolated old one-slot pairing must NOT break a long current-day caregiver run.");
};
async function run(){
  try{
    // First: one compact OpenAI response, with the model choosing priorities.
    globalThis.fetch=async(url,options)=>{
      calls++;
      assert.equal(String(url),"https://api.openai.com/v1/responses");
      const body=JSON.parse(String(options?.body));
      assert.ok(JSON.stringify(body).includes("historicalContinuousBlocks"));
      const proposal={napTimes:{Client1:"12:00",Client2:"12:30"},
        breakTimes:{Staff1:"12:00",Staff2:"12:30",Staff3:"13:00"},
        preferredStaffByClient:{Client1:"Staff1",Client2:"Staff2"},
        decisions:["Preserve Staff1 with Client1 and Staff2 with Client2."],
        tradeoffs:["Ignore historical single-slot handoffs."]};
      return new Response(JSON.stringify({
        id:"resp_compact",object:"response",created_at:1,status:"completed",model:body.model,
        output:[{type:"message",id:"msg",role:"assistant",status:"completed",
          content:[{type:"output_text",text:JSON.stringify(proposal),annotations:[]}]}],
        usage:{input_tokens:90,output_tokens:55,total_tokens:145}
      }),{headers:{"Content-Type":"application/json"}});
    };
    let plan=await designOpenAISchedule(snapshot);
    assert.equal(calls,1,"A template-backed schedule should need only ONE bounded OpenAI decision request.");
    assert.equal(plan.templateGuided,true);
    assert.equal(plan.modelUsed,true);
    toRows(plan);
    // Second: OpenAI fails. The fallback must still make a safe plan with the
    // identical validation (not claim that an API generation succeeded).
    calls=0;
    globalThis.fetch=async()=>{calls++;throw new Error("Request timed out after 28000ms");};
    plan=await designOpenAISchedule(snapshot);
    assert.equal(calls,1);
    assert.equal(plan.templateGuided,true);
    assert.equal(plan.modelUsed,false);
    assert.match(plan.explanation,/too slow/i);
    toRows(plan);
    // Even on days with weak/no workbook history, the deployed website opts
    // into the same bounded path rather than nine sequential model calls.
    const noHistory:FixedScheduleSnapshot={...snapshot,
      templates:[],referenceAssignments:[],preferFastTemplateGuidedPlanning:true};
    assert.equal(hasUsefulTemplateEvidence(noHistory),false);
    calls=0;
    const noHistoryPlan=await designOpenAISchedule(noHistory);
    assert.equal(calls,1);
    assert.equal(noHistoryPlan.templateGuided,true);
    assert.equal(noHistoryPlan.modelUsed,false);
    const noHistoryRows=expandOpenAIPlan(noHistoryPlan,
      new Map([["Staff1","s1"],["Staff2","s2"],["Staff3","s3"]]),
      new Map([["Client1","c1"],["Client2","c2"]]));
    const noHistoryInput={
      staff:["s1","s2","s3"].map(id=>({id,name:id,role:"BT",availableSlots:slots,serviceSetting:"IN_CENTER"})),
      clients:[{id:"c1",displayCode:"c1",requiredSlots:slots,napSlots:["12:00"],speechSlots:[],staffRelationships:{},serviceSetting:"IN_CENTER"},
        {id:"c2",displayCode:"c2",requiredSlots:slots,napSlots:["12:30"],speechSlots:[],staffRelationships:{},serviceSetting:"IN_CENTER"}],
      callOutStaffIds:[],existingAssignments:[],referenceAssignments:[],rules:{slotLengthMinutes:30}
    } as unknown as SchedulerInput;
    const noHistoryAudit=validateOpenAIPlan(noHistoryInput,noHistoryRows);
    assert.deepEqual(noHistoryAudit.problems,[],"No-history fallback must still schedule distinct staff breaks and actual client naps.");
    assert.equal(noHistoryAudit.missing.length,0);
    console.log("PASS template-guided OpenAI scheduling: one compact model call, independent validated client coverage, two linked naps, three staff breaks, and safe fallback after API timeout, including days without usable templates.");
  }finally{
    globalThis.fetch=prior;
    if(oldKey===undefined)delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY=oldKey;
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
