import assert from "node:assert/strict";
import mongoose from "mongoose";
import { POST } from "../src/app/api/ai/paid/route";
import { Staff } from "../src/models/Staff";
import { Client } from "../src/models/Client";
import { Team } from "../src/models/Team";
import { Location } from "../src/models/Location";
import { ScheduleTemplate } from "../src/models/ScheduleTemplate";
import { AITrainingExample } from "../src/models/AITrainingExample";

async function main() {
  const previousFetch=globalThis.fetch;
  const previousEnvironment={provider:process.env.SCHEDULER_AI_PROVIDER,key:process.env.GOOGLE_GENERATIVE_AI_API_KEY,writes:process.env.SCHEDULER_AI_AUTONOMOUS_WRITES};
  const previousConnection=global.mongooseCache!.connection;
  const mocks:Array<{model:any;method:string;original:any}>=[];
  function mock(model:any,method:string,replacement:any){mocks.push({model,method,original:model[method]});model[method]=replacement;}
  const query=(value:unknown)=>({select(){return this;},sort(){return this;},lean:async()=>value});
  for(const model of [Staff,Client,Team,ScheduleTemplate])mock(model,"find",()=>query([]));
  mock(Location,"findById",()=>query({_id:"000000000000000000000004",name:"SENTINEL Clinic"}));
  let trainingWrites=0;
  mock(AITrainingExample,"create",()=>{trainingWrites++;throw new Error("Read-only requests must not write training records");});
  global.mongooseCache!.connection=mongoose;
  process.env.SCHEDULER_AI_PROVIDER="gemini";process.env.GOOGLE_GENERATIVE_AI_API_KEY="dummy-not-real";process.env.SCHEDULER_AI_AUTONOMOUS_WRITES="true";
  let calls=0;
  const allowedTools=new Set(["lookup_schedule","get_day_schedule","get_staff","get_clients","get_unplaced_assignments","check_schedule","analyze_client_replacement","suggest_schedule_improvements","get_scheduler_configuration","analyze_workbook_patterns"]);
  globalThis.fetch=async(url,options)=>{
    assert.match(String(url),/^https:\/\/generativelanguage.googleapis.com\//);
    const body=JSON.parse(String(options?.body));
    assert.doesNotMatch(String(options?.body),/SENTINEL|000000000000000000000004/);
    if(calls){
      const names=body.tools.flatMap((group:any)=>group.functionDeclarations??[]).map((item:any)=>item.name);
      assert.ok(names.length>0);
      for(const name of names)assert.ok(allowedTools.has(name),`Unexpected action tool in read-only mode: ${name}`);
      assert.ok(!names.includes("generate_schedule"));
    }
    const text=calls++ ? "I can help you review this website's scheduling information." : JSON.stringify({allowed:true});
    return new Response(JSON.stringify({candidates:[{content:{role:"model",parts:[{text}]},finishReason:"STOP",index:0}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:10,totalTokenCount:20}}),{headers:{"Content-Type":"application/json"}});
  };
  try {
    const response=await POST(new Request("http://localhost/api/ai/paid",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({readOnly:true,message:"Which features do you support in this scheduling website?",locationId:"000000000000000000000004",date:"2026-10-16"})}));
    const result=await response.json();
    assert.equal(response.status,200);assert.equal(result.mode,"READ_ONLY");assert.equal(result.changed,false);assert.equal(result.trainingExampleId,null);assert.equal(trainingWrites,0);assert.deepEqual(result.writeToolsUsed,[]);assert.equal(calls,2);
    console.log("PASS paid route enforces readOnly=true with autonomous writes enabled: no action tools, no training writes, and no changed calendar claim (mocked).");
  } finally {
    globalThis.fetch=previousFetch;global.mongooseCache!.connection=previousConnection;
    for(const {model,method,original} of mocks)model[method]=original;
    for(const [key,value] of [["SCHEDULER_AI_PROVIDER",previousEnvironment.provider],["GOOGLE_GENERATIVE_AI_API_KEY",previousEnvironment.key],["SCHEDULER_AI_AUTONOMOUS_WRITES",previousEnvironment.writes]]){if(value===undefined)delete process.env[key!];else process.env[key!]=value;}
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
