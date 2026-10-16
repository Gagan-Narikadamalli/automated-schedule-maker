import assert from "node:assert/strict";
import mongoose from "mongoose";
import { POST } from "../src/app/api/ai/paid/route";
import { Staff } from "../src/models/Staff";
import { Client } from "../src/models/Client";
import { Team } from "../src/models/Team";
import { Location } from "../src/models/Location";
import { ScheduleTemplate } from "../src/models/ScheduleTemplate";
import { AITrainingExample } from "../src/models/AITrainingExample";
import { AuditLog } from "../src/models/AuditLog";
import { hasSchedulerActionIntent } from "../src/features/ai/schedulerActionIntent";
import { schedulerLookupTimeWindow } from "../src/features/ai/naturalTime";

async function main(){
  assert.deepEqual(schedulerLookupTimeWindow("Who is covering Client1 at 10 am?"),{startTime:"10:00",endTime:"10:01"});
  assert.deepEqual(schedulerLookupTimeWindow("Who is Staff1 with from 1 to 2 pm?"),{startTime:"13:00",endTime:"14:00"});
  const previousFetch=globalThis.fetch,previousConnection=global.mongooseCache!.connection;
  const env={...process.env};
  const mocks:Array<{model:any;method:string;original:any}>=[];
  const mock=(model:any,method:string,replacement:any)=>{mocks.push({model,method,original:model[method]});model[method]=replacement;};
  const query=(value:unknown)=>({select(){return this;},sort(){return this;},lean:async()=>value});
  for(const model of [Staff,Client,Team,ScheduleTemplate])mock(model,"find",()=>query([]));
  mock(Location,"findById",()=>query({_id:"000000000000000000000004",name:"Private Clinic"}));
  let saved=0,training=0,rejectCreate=false;
  mock(Team,"findOne",async()=>rejectCreate?{name:"Test Team"}:null);
  mock(Team,"create",async(value:any)=>{saved++;const record={...value,_id:"000000000000000000000005"};return {...record,toObject:()=>record};});
  mock(AuditLog,"create",async()=>({}));
  mock(AITrainingExample,"create",async()=>{training++;return {_id:"example"};});
  global.mongooseCache!.connection=mongoose;
  process.env.SCHEDULER_AI_PROVIDER="gemini";process.env.GOOGLE_GENERATIVE_AI_API_KEY="dummy-not-real";process.env.SCHEDULER_AI_AUTONOMOUS_WRITES="true";
  const ask=async(message:string)=>{
    const response=await POST(new Request("http://localhost/api/ai/paid",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message,locationId:"000000000000000000000004",date:"2026-10-16"})}));
    assert.equal(response.status,200);return response.json();
  };
  const modelReply=(parts:unknown[])=>new Response(JSON.stringify({candidates:[{content:{role:"model",parts},finishReason:"STOP",index:0}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:10,totalTokenCount:20}}),{headers:{"Content-Type":"application/json"}});
  const quota=()=>new Response(JSON.stringify({error:{code:429,status:"RESOURCE_EXHAUSTED",message:"Quota exceeded"}}),{status:429,headers:{"Content-Type":"application/json","retry-after-ms":"1"}});
  try{
    let calls=0;
    globalThis.fetch=async()=>{calls++;return quota();};
    const greeting=await ask("Hello!");assert.equal(calls,0);assert.equal(greeting.changed,false);assert.equal(greeting.responseSource,"website");
    const unavailable=await ask("Can you explain this scheduling website?");
    assert.equal(calls,2);assert.equal(unavailable.changed,false);assert.equal(unavailable.interrupted,true);assert.equal(training,0);
    calls=0;
    globalThis.fetch=async(_url,options)=>{
      const body=JSON.parse(String(options?.body));
      if(calls++===0)return modelReply([{text:JSON.stringify({allowed:true})}]);
      const names=body.tools.flatMap((group:any)=>group.functionDeclarations??[]).map((item:any)=>item.name);
      assert.ok(!names.includes("manage_team")&&!names.includes("generate_schedule"),"Ordinary questions must not expose edits, even without readOnly:true.");
      assert.equal(body.generationConfig.thinkingConfig.thinkingLevel,"low");
      assert.ok(JSON.stringify(body.systemInstruction).length<5000,"Read-only chat must not send the full mutation playbook.");
      return modelReply([{text:"I can explain the schedule and answer questions without changing it."}]);
    };
    const chat=await ask("What is this scheduler used for?");assert.equal(chat.mode,"READ_ONLY");assert.equal(chat.changed,false);assert.equal(training,0);
    for(const rejected of [false,true]){
      calls=0;rejectCreate=rejected;
      globalThis.fetch=async()=>{
        calls++;
        if(calls===1)return modelReply([{text:JSON.stringify({allowed:true})}]);
        if(calls===2)return modelReply([{functionCall:{name:"manage_team",args:{action:"CREATE",name:"Test Team"}}}]);
        return quota();
      };
      const result=await ask("Create a team named Test Team.");
      assert.equal(calls,4,"One bounded retry; no additional synthesis or replay after the quota error.");
      assert.equal(result.interrupted,true);assert.equal(result.changed,!rejected);assert.deepEqual(result.writeToolsUsed,["manage_team"]);
      assert.match(result.reply,rejected?/No successful edit was confirmed/:/remain saved/);
      assert.equal(saved,1,"A confirmed mutation must not be replayed after the model fails.");assert.equal(training,0);
    }
    assert.equal(hasSchedulerActionIntent("yes",[{role:"user",text:"Generate the schedule"},{role:"assistant",text:"May I replace protected assignments?"}]),true);
    assert.equal(hasSchedulerActionIntent("yes",[{role:"user",text:"How does the schedule work?"},{role:"assistant",text:"Would you like more information?"}]),false);
    console.log("PASS chat without writes, zero-call greetings, low-effort questions, quota-safe replies, confirmed write reporting, rejected-action reporting and no mutation replay (mocked).");
  }finally{
    globalThis.fetch=previousFetch;global.mongooseCache!.connection=previousConnection;
    for(const {model,method,original} of mocks)model[method]=original;
    for(const key of ["SCHEDULER_AI_PROVIDER","GOOGLE_GENERATIVE_AI_API_KEY","SCHEDULER_AI_AUTONOMOUS_WRITES"]){if(env[key]===undefined)delete process.env[key];else process.env[key]=env[key];}
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
