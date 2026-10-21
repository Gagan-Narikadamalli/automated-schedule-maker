import assert from "node:assert/strict";
import { designOpenAISchedule, expandOpenAIPlan } from "../src/features/ai/openaiSchedulePlan";
import { fixedCellCandidates, validateFixedEventChoices } from "../src/features/ai/openaiBatchedDayPlanner";
import { validateOpenAIPlan } from "../src/features/ai/validateOpenAIPlan";
import type { FixedScheduleSnapshot } from "../src/features/ai/fixedScheduleChoices";
import type { SchedulerInput } from "../src/features/scheduler/engine/types";

const times=Array.from({length:10},(_,index)=>{
  const minutes=600+index*30;
  return String(Math.floor(minutes/60)).padStart(2,"0")+":"+String(minutes%60).padStart(2,"0");
});
const snapshot:FixedScheduleSnapshot={
  useFixedCells:true,date:"2026-10-21",calledOutStaff:[],
  staff:["Staff1","Staff2","Staff3"].map(id=>({id,availableSlots:times,serviceSetting:"IN_CENTER"})),
  clients:[
    {id:"Client1",requiredSlots:times,napSlots:["12:00","12:30"],speechSlots:[],excludedStaff:[],serviceSetting:"IN_CENTER"},
    {id:"Client2",requiredSlots:times,napSlots:[],speechSlots:[],excludedStaff:[],serviceSetting:"IN_CENTER"}
  ],
  rules:{breakWindowStart:"11:00",breakWindowEnd:"14:00"}
};
const stage={
  napTimes:{Client1:"12:00"},
  breakTimes:{Staff1:"12:00",Staff2:"13:00",Staff3:"13:30"},
  explanation:"Keep continuity, link first nap with Staff1 break, relieve Client2 briefly.",
  decisions:["Staff1 stays with Client1 through nap.","Staff3 relieves Client2 while Staff2 breaks."],
  tradeoffs:[]
};
assert.deepEqual(validateFixedEventChoices(snapshot,stage),[]);
assert.deepEqual(fixedCellCandidates(snapshot,stage,"Client1","12:00"),["Staff1"]);
assert.deepEqual(fixedCellCandidates(snapshot,stage,"Client2","12:00"),["Staff2","Staff3"]);
assert.deepEqual(fixedCellCandidates(snapshot,stage,"Client2","13:00"),["Staff1","Staff3"]);
assert.ok(validateFixedEventChoices(snapshot,{...stage,breakTimes:{...stage.breakTimes,Staff1:"11:30"}})
  .some(x=>x.includes("No eligible therapist")));
const invalidSnapshot:FixedScheduleSnapshot={...snapshot,clients:[...snapshot.clients,{
  id:"Client3",requiredSlots:times,napSlots:["12:00"],speechSlots:[],
  excludedStaff:["Staff2","Staff3"],serviceSetting:"IN_CENTER"
}]};
assert.ok(validateFixedEventChoices(invalidSnapshot,stage).length>0,
  "Two simultaneous naps cannot use the same therapist's break.");

const makeRows=(list:string[],invalid=false)=>{
  const staffByTime:Record<string,string[]>={};
  for(const time of list)staffByTime[time]=[
    "Staff1",time==="13:00"?"Staff3":"Staff2"
  ];
  if(invalid&&list.length)staffByTime[list[0]][1]="Staff1";
  return {staffByTime};
};
async function mockPlan(invalid=false){
  const originalFetch=globalThis.fetch;
  const previousKey=process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY="mock-only-not-live";
  const allRequests:unknown[]=[];
  let requests=0;
  globalThis.fetch=async(url,options)=>{
    assert.equal(String(url),"https://api.openai.com/v1/responses");
    const body=JSON.parse(String(options?.body));
    allRequests.push(body);
    const index=requests++;
    let selection:object;
    if(index===0)selection=stage;
    else if(index===1)selection=makeRows(times.slice(0,6),invalid);
    else if(index===2&&invalid)selection=makeRows(times.slice(0,6),invalid);
    else selection=makeRows(times.slice(6));
    return new Response(JSON.stringify({
      id:"resp_"+index,object:"response",created_at:1,status:"completed",model:body.model,
      output:[{type:"message",id:"msg_"+index,role:"assistant",status:"completed",
        content:[{type:"output_text",text:JSON.stringify(selection),annotations:[]}]}],
      usage:{input_tokens:100,output_tokens:50,total_tokens:150}
    }),{headers:{"Content-Type":"application/json"}});
  };
  try {
    const plan=await designOpenAISchedule(snapshot);
    assert.equal(plan.batched,true);
    assert.equal(plan.planningBatches,3,"One global event decision + two compact time batches.");
    assert.equal(requests,invalid?4:3);
    assert.ok(allRequests.every(req=>JSON.stringify(req).length<95000),
      "Do not send huge 262-cell grids in every request.");
    const rows=expandOpenAIPlan(plan,
      new Map([["Staff1","s1"],["Staff2","s2"],["Staff3","s3"]]),
      new Map([["Client1","c1"],["Client2","c2"]]));
    const input:SchedulerInput={
      staff:["s1","s2","s3"].map(id=>({id,name:id,role:"BT",availableSlots:times,serviceSetting:"IN_CENTER"})),
      clients:[{id:"c1",displayCode:"c1",requiredSlots:times,napSlots:["12:00","12:30"],speechSlots:[],staffRelationships:{},serviceSetting:"IN_CENTER"},
        {id:"c2",displayCode:"c2",requiredSlots:times,napSlots:[],speechSlots:[],staffRelationships:{},serviceSetting:"IN_CENTER"}],
      callOutStaffIds:[],existingAssignments:[],referenceAssignments:[],
      rules:{slotLengthMinutes:30}
    } as SchedulerInput;
    const result=validateOpenAIPlan(input,rows);
    assert.deepEqual(result.problems,[],"No duplicate staff/client and mandatory nap/break violations.");
    assert.equal(result.required,20);
    assert.equal(result.covered,invalid?19:20);
    assert.equal(result.missing.length,invalid?1:0);
    assert.equal(rows.some(r=>r.clientId==="c1"&&r.startTime==="12:00"&&r.assignmentType==="BREAK_NAP"),true);
    assert.equal(rows.some(r=>r.staffId==="s2"&&r.startTime==="13:00"&&r.assignmentType==="BREAK"),true);
    assert.ok(rows.length>=22);
    return plan;
  }finally{
    globalThis.fetch=originalFetch;
    if(previousKey===undefined)delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY=previousKey;
  }
}
async function main(){
  await mockPlan();
  await mockPlan(true);
  console.log("PASS batched paid OpenAI schedule: 3 sequential bounded model calls, 20 required blocks, one nap and 3 breaks, continuity, safe partial unplaced tray, and valid batch retries.");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
