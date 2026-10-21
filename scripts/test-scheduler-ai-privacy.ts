import assert from "node:assert/strict";
import { generateText, stepCountIs } from "ai";
import { createSchedulerPrivacy, encodeSafeSchedulerHistory } from "../src/features/ai/schedulerPrivacy";
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
  const history=encodeSafeSchedulerHistory([
    {role:"assistant" as const,text:"SENTINEL Ada Example has SeCl",effectiveDate:"2026-10-21",
      attachmentNames:"[omitted for privacy]",attachmentContext:"Confidential image"},
    {role:"user" as const,text:"What about Ada tomorrow?",attachmentNames:["private.png"]}
  ],privacy.encodeText);
  assert.deepEqual(history.map(row=>Object.keys(row)),[
    ["role","text","effectiveDate"],["role","text","effectiveDate"]
  ]);
  assert.equal(history[0].text,"Staff1 has Client1");
  assert.equal(history[1].text,"What about Staff1 tomorrow?");
  assert.doesNotMatch(JSON.stringify(history),/private.png|Confidential image|SENTINEL/i);
  const previousFetch=globalThis.fetch, previousKey=process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY="mock-openai-not-real";
  let calls=0, ran=false;
  globalThis.fetch=async(url,options)=>{
    assert.equal(String(url),"https://api.openai.com/v1/responses");
    const body=JSON.parse(String(options?.body));
    const content=JSON.stringify(body);
    assert.doesNotMatch(content,/SENTINEL|00000000000000000000000[12]|SeCl|Ada|@example/i);
    if(calls>0)assert.match(content,/function_call_output/);
    const output=calls++===0
      ? [{type:"function_call",id:"fc_mock",call_id:"call_privacy",name:"lookup",
          arguments:JSON.stringify({staffId:"Staff1",clientCode:"Client1"}),status:"completed"}]
      : [{type:"message",id:"msg_privacy",role:"assistant",status:"completed",
          content:[{type:"output_text",text:"Staff1 covers Client1 at 11:00.",annotations:[]}]}];
    return new Response(JSON.stringify({id:"resp_"+calls,object:"response",
      created_at:1,status:"completed",model:body.model,output,
      usage:{input_tokens:20,output_tokens:10,total_tokens:30}}),
      {headers:{"Content-Type":"application/json"}});
  };
  try {
    const tools=adaptSchedulerToolsForPaid({lookup:{
      description:"Read the selected clinic schedule",
      inputSchema:{type:"object",properties:{staffId:{type:"string"},clientCode:{type:"string"}},
        required:["staffId","clientCode"],additionalProperties:false},
      execute:async input=>{
        ran=true;assert.equal(input.staffId,staffId);assert.equal(input.clientCode,"SeCl");
        return {staffId,staffName:"SENTINEL Ada Example",clientId,clientCode:"SeCl",time:"11:00",
          notes:"SENTINEL private note"};
      }
    }},privacy);
    const result=await generateText({model:getSchedulerModel(),providerOptions:schedulerModelOptions(),
      prompt:privacy.encodeText("Check SENTINEL Ada Example with SeCl"),
      tools,stopWhen:stepCountIs(2)});
    assert.equal(ran,true);assert.equal(calls,2);
    assert.equal(privacy.decodeText(result.text),"SENTINEL Ada Example covers SeCl at 11:00.");
  } finally {
    globalThis.fetch=previousFetch;
    if(previousKey===undefined)delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY=previousKey;
  }
  console.log("PASS OpenAI prompt, tool calls, anonymous payloads, response decoding, and safe multi-turn history.");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
