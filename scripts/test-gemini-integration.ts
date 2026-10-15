import assert from "node:assert/strict";
import { generateText, stepCountIs } from "ai";
import { getSchedulerModel, getSchedulerCloudProvider, schedulerModelOptions, GEMINI_SETUP_MESSAGE } from "../src/features/ai/schedulerModelProvider";
import { isWebsiteRequest } from "../src/features/ai/websiteScope";
import { designOpenAISchedule } from "../src/features/ai/openaiSchedulePlan";
import { adaptSchedulerToolsForPaid } from "../src/features/ai/schedulerPaidToolAdapter";
import { POST as generateRoute } from "../src/app/api/schedule/ai-generate/route";
import { POST as paidRoute } from "../src/app/api/ai/paid/route";

async function main(){
 const originalEnv={provider:process.env.SCHEDULER_AI_PROVIDER,google:process.env.GOOGLE_GENERATIVE_AI_API_KEY,gemini:process.env.GEMINI_API_KEY};
 process.env.SCHEDULER_AI_PROVIDER="gemini";delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;delete process.env.GEMINI_API_KEY;
 assert.equal(getSchedulerCloudProvider(),"gemini");
 assert.throws(()=>getSchedulerModel(),/GOOGLE_GENERATIVE_AI_API_KEY/);
 for(const handler of [generateRoute,paidRoute]){
  const response=await handler(new Request("http://localhost/api/ai",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({locationId:"000000000000000000000001",date:"2026-10-16",message:"Generate the clinic schedule",save:true})}));
  assert.equal(response.status,503);assert.equal((await response.json()).error,GEMINI_SETUP_MESSAGE);
 }
 process.env.GOOGLE_GENERATIVE_AI_API_KEY="test-only-placeholder";
 const originalFetch=globalThis.fetch,requests:Record<string,any>[]=[];
 const plan={segments:[{staff:"S0",client:"C0",startTime:"11:00",endTime:"12:00",type:"CLIENT_1_TO_1"}],explanation:"One continuous block.",decisions:["Keep the same staff."],tradeoffs:[]};
 const outputs:unknown[]=[{allowed:false},{allowed:true},plan];let calls=0;
 globalThis.fetch=async(url,options)=>{
  assert.equal(String(url),"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
  const body=JSON.parse(String(options?.body));requests.push(body);assert.ok(!("openai" in body));
  const item=outputs.shift();let parts:unknown[];
  if(item)parts=[{text:JSON.stringify(item)}];
  else if(!calls++)parts=[{functionCall:{name:"check_coverage",args:{date:"2026-10-16"}},thoughtSignature:"test-signature"}];
  else parts=[{text:"Coverage checked for October 16."}];
  return new Response(JSON.stringify({candidates:[{content:{role:"model",parts},finishReason:"STOP",index:0}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:10,totalTokenCount:20},modelVersion:"gemini-3.8-flash"}),{headers:{"Content-Type":"application/json"}});
 };
 try{
  assert.equal(await isWebsiteRequest("Write an unrelated movie review",[],false),false);
  assert.equal(await isWebsiteRequest("Review Friday's clinic schedule",[],false),true);
  assert.deepEqual(await designOpenAISchedule({staff:["S0"],clients:["C0"]}),plan);
  assert.match(JSON.stringify(requests[2].systemInstruction),/independently design/);
  let toolRan=false;
  const tools=adaptSchedulerToolsForPaid({check_coverage:{description:"Check this website's date coverage",inputSchema:{type:"object",properties:{date:{type:"string"}},required:["date"],additionalProperties:false},execute:async input=>{toolRan=true;assert.equal(input.date,"2026-10-16");return {covered:10,missing:0};}}});
  const result=await generateText({model:getSchedulerModel(),providerOptions:schedulerModelOptions(),prompt:"Check coverage on 2026-10-16",tools,stopWhen:stepCountIs(2)});
  assert.equal(toolRan,true);assert.equal(result.text,"Coverage checked for October 16.");
  assert.ok(requests[3].tools?.length);assert.match(JSON.stringify(requests[4].contents),/functionResponse/);
  console.log("PASS Gemini direct routing, missing-key protection, scope, structured independent plan, decision summary and website tool round-trip (mocked; no live API calls).");
 }finally{
  globalThis.fetch=originalFetch;
  for(const [name,value] of [["SCHEDULER_AI_PROVIDER",originalEnv.provider],["GOOGLE_GENERATIVE_AI_API_KEY",originalEnv.google],["GEMINI_API_KEY",originalEnv.gemini]]){if(value===undefined)delete process.env[name!];else process.env[name!]=value;}
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
