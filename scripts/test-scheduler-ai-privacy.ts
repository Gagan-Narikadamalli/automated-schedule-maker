import assert from "node:assert/strict";
import { generateText, stepCountIs } from "ai";
import { createSchedulerPrivacy } from "../src/features/ai/schedulerPrivacy";
import { adaptSchedulerToolsForPaid } from "../src/features/ai/schedulerPaidToolAdapter";
import { getSchedulerModel, schedulerModelOptions } from "../src/features/ai/schedulerModelProvider";

async function main() {
  const staffId = "000000000000000000000001", clientId = "000000000000000000000002";
  const privacy = createSchedulerPrivacy([
    {kind:"Staff",id:staffId,label:"SENTINEL Ada Example",aliases:["Ada"]},
    {kind:"Client",id:clientId,label:"SeCl",fullName:"SENTINEL Client Example"},
    {kind:"Team",id:"000000000000000000000003",label:"SENTINEL Team"},
    {kind:"Location",id:"000000000000000000000004",label:"SENTINEL Clinic"},
  ]);
  const encoded = privacy.encode({staffId,staffName:"SENTINEL Ada Example",clientId,clientCode:"SeCl",
    teamId:"000000000000000000000003",name:"SENTINEL Custom Template",notes:"SENTINEL private family note",
    reason:"SENTINEL private absence reason",learningProfile:{private:"SENTINEL diagnosis"},
    recordId:"000000000000000000000099",message:"Ada will cover SeCl at 11:00. Contact sentinel@example.com or 212-555-0198."});
  const serialized = JSON.stringify(encoded);
  assert.doesNotMatch(serialized,/SENTINEL|\b[\da-f]{24}\b|SeCl|Ada|212-555|@example/i);
  assert.equal(encoded.staffId,"Staff1");assert.equal(encoded.clientId,"Client1");assert.equal(encoded.teamId,"Team1");
  assert.match(encoded.message,/Staff1 will cover Client1 at 11:00/);
  assert.deepEqual(privacy.decode({staffId:"Staff1",staffName:"Staff1",clientCode:"Client1",clientIds:["Client1"]}),
    {staffId,staffName:"SENTINEL Ada Example",clientCode:"SeCl",clientIds:[clientId]});
  assert.equal(privacy.decodeText("Staff1 covers Client1."),"SENTINEL Ada Example covers SeCl.");
  assert.equal(privacy.decode({recordId:encoded.recordId}).recordId,"000000000000000000000099");

  const previousFetch = globalThis.fetch;
  const previousProvider = process.env.SCHEDULER_AI_PROVIDER, previousKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  process.env.SCHEDULER_AI_PROVIDER="gemini";process.env.GOOGLE_GENERATIVE_AI_API_KEY="dummy-key-not-real";
  let calls=0, ran=false;
  globalThis.fetch=async(_url,options)=>{
    const requestBody=String(options?.body);
    assert.doesNotMatch(requestBody,/SENTINEL|00000000000000000000000[12]|SeCl|Ada|@example/i);
    if (calls) assert.match(requestBody,/functionResponse/);
    const parts=calls++ ? [{text:"Staff1 covers Client1 at 11:00."}] : [{functionCall:{name:"lookup",args:{staffId:"Staff1",clientCode:"Client1"}},thoughtSignature:"dummy-signature"}];
    return new Response(JSON.stringify({candidates:[{content:{role:"model",parts},finishReason:"STOP",index:0}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:10,totalTokenCount:20}}),{headers:{"Content-Type":"application/json"}});
  };
  try {
    const tools=adaptSchedulerToolsForPaid({lookup:{description:"Read the selected clinic schedule",inputSchema:{type:"object",properties:{staffId:{type:"string"},clientCode:{type:"string"}},required:["staffId","clientCode"],additionalProperties:false},execute:async input=>{
      ran=true;assert.equal(input.staffId,staffId);assert.equal(input.clientCode,"SeCl");
      return {staffId,staffName:"SENTINEL Ada Example",clientId,clientCode:"SeCl",time:"11:00",notes:"SENTINEL private note"};
    }}},privacy);
    const result=await generateText({model:getSchedulerModel(),providerOptions:schedulerModelOptions(),prompt:privacy.encodeText("Check SENTINEL Ada Example with SeCl"),tools,stopWhen:stepCountIs(2)});
    assert.equal(ran,true);assert.equal(calls,2);
    assert.equal(privacy.decodeText(result.text),"SENTINEL Ada Example covers SeCl at 11:00.");
  } finally {
    globalThis.fetch=previousFetch;
    if(previousProvider===undefined)delete process.env.SCHEDULER_AI_PROVIDER;else process.env.SCHEDULER_AI_PROVIDER=previousProvider;
    if(previousKey===undefined)delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;else process.env.GOOGLE_GENERATIVE_AI_API_KEY=previousKey;
  }
  console.log("PASS anonymous Gemini prompt and tool-result payloads, ID/name round-trip, notes/contact removal, and website name restoration (mocked).");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
