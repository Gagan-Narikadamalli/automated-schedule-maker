import assert from "node:assert/strict";
import { designOpenAISchedule,expandOpenAIPlan } from "../src/features/ai/openaiSchedulePlan";
import { validateOpenAIPlan } from "../src/features/ai/validateOpenAIPlan";
import type { FixedScheduleSnapshot } from "../src/features/ai/fixedScheduleChoices";
import type { SchedulerInput } from "../src/features/scheduler/engine/types";

const times=Array.from({length:16},(_,i)=>{
  const minute=480+i*30;return String(Math.floor(minute/60)).padStart(2,"0")+":"+String(minute%60).padStart(2,"0");
});
const staff=Array.from({length:26},(_,i)=>({id:"Staff"+(i+1),availableSlots:times,serviceSetting:"IN_CENTER"}));
const clients=Array.from({length:20},(_,i)=>({
  id:"Client"+(i+1),requiredSlots:times,
  napSlots:i<10?["12:00"]:[],speechSlots:[],excludedStaff:[],serviceSetting:"IN_CENTER"
}));
const breaks:Record<string,string>={};
for(let i=1;i<=26;i++)breaks["Staff"+i]=i<=10?"12:00":i<=15?"13:00":i<=20?"13:30":"11:00";
const naps=Object.fromEntries(clients.filter(c=>c.napSlots.length).map(c=>[c.id,"12:00"]));
const fixed:FixedScheduleSnapshot={
  useFixedCells:true,date:"2026-10-21",staff,clients,calledOutStaff:[],
  rules:{breakWindowStart:"11:00",breakWindowEnd:"14:00"}
};
const stage={
  napTimes:naps,breakTimes:breaks,
  explanation:"Use one nap-linked break for ten clients, then relieve ten frontline staff in two waves.",
  decisions:["Cover the 20 required clients with eligible BTs, using six free relief staff."],
  tradeoffs:[]
};
function cellStaff(clientIndex:number,time:string){
  if(time==="13:00"&&clientIndex>=10&&clientIndex<15)
    return "Staff"+(clientIndex+11);
  if(time==="13:30"&&clientIndex>=15)
    return "Staff"+(clientIndex+6);
  return "Staff"+(clientIndex+1);
}
const previousKey=process.env.OPENAI_API_KEY,previousFetch=globalThis.fetch;
process.env.OPENAI_API_KEY="mock-large-roster";
let requests=0;
globalThis.fetch=async(url,options)=>{
  assert.equal(String(url),"https://api.openai.com/v1/responses");
  const body=JSON.parse(String(options?.body));
  const n=requests++;
  const batchTimes=times.slice((n-1)*4,n*4);
  const response=n===0?stage:{staffByTime:Object.fromEntries(
    batchTimes.map(time=>[time,Array.from({length:20},(_,i)=>cellStaff(i,time))]))};
  assert.ok(JSON.stringify(body).length<105000,"Model request must stay bounded by current planning batch.");
  return new Response(JSON.stringify({
    id:"resp_"+n,object:"response",created_at:1,status:"completed",model:body.model,
    output:[{type:"message",id:"msg_"+n,role:"assistant",status:"completed",
      content:[{type:"output_text",text:JSON.stringify(response),annotations:[]}]}],
    usage:{input_tokens:200,output_tokens:100,total_tokens:300}
  }),{headers:{"Content-Type":"application/json"}});
};
async function main(){
  try{
    const plan=await designOpenAISchedule(fixed);
    assert.equal(plan.batched,true);
    assert.equal(plan.planningBatches,5);
    assert.equal(requests,5,"One global event stage plus four four-column staff assignment requests.");
    const staffIds=new Map(staff.map((s,i)=>[s.id,"s"+(i+1)]));
    const clientIds=new Map(clients.map((c,i)=>[c.id,"c"+(i+1)]));
    const rows=expandOpenAIPlan(plan,staffIds,clientIds);
    const input={
      staff:staff.map((s,i)=>({...s,id:"s"+(i+1),name:"BT "+(i+1),role:"BT"})),
      clients:clients.map((c,i)=>({...c,id:"c"+(i+1),displayCode:"C"+(i+1),staffRelationships:{}})),
      callOutStaffIds:[],existingAssignments:[],referenceAssignments:[],
      rules:{slotLengthMinutes:30}
    } as unknown as SchedulerInput;
    const audit=validateOpenAIPlan(input,rows);
    assert.deepEqual(audit.problems,[],"Twenty clients, ten naps and 26 staff breaks must all validate.");
    assert.equal(audit.required,320);
    assert.equal(audit.covered,320);
    assert.equal(audit.missing.length,0);
    assert.equal(rows.filter(r=>r.assignmentType==="BREAK_NAP").length,10);
    assert.equal(rows.filter(r=>r.assignmentType==="BREAK").length,16);
    assert.equal(rows.filter(r=>r.assignmentType==="CLIENT_1_TO_1").length,310);
    console.log("PASS model-planned 20 clients / 26 staff / 320 client slots: 10 linked naps, 26 staff breaks and 4 bounded time-column batches (mocked API).");
  }finally{
    globalThis.fetch=previousFetch;
    if(previousKey===undefined)delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY=previousKey;
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
