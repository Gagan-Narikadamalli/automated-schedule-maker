import assert from "node:assert/strict";
import { restoreAiNapWindowChoices } from "../src/features/ai/aiNapWindowChoices";
import { assessAiCandidate,compareAiCandidates,type AiCandidateRow } from "../src/features/ai/compareScheduleCandidates";
import type { SchedulerInput } from "../src/features/scheduler/engine/types";

const input={
  staff:[
    {id:"s1",name:"Therapist 1",role:"BT",teamId:"t1",availableSlots:["11:00","11:30","12:00","12:30"]},
    {id:"s2",name:"Therapist 2",role:"RBT",teamId:"t2",availableSlots:["11:00","11:30","12:00","12:30"]},
    {id:"s3",name:"Therapist 3",role:"INTERN",teamId:"t1",availableSlots:["11:00","11:30","12:00","12:30"]},
  ],
  clients:[
    {id:"c1",displayCode:"CaGr",teamId:"t1",requiredSlots:["11:00","11:30","12:00"],napSlots:[],speechSlots:[],staffRelationships:{s1:"PREFERRED"}},
    {id:"c2",displayCode:"ZiBo",teamId:"t2",requiredSlots:["11:00","11:30","12:00"],napSlots:[],speechSlots:[],staffRelationships:{}},
  ],
  existingAssignments:[],referenceAssignments:[],
  historicalPatterns:{sampleCount:0,scheduleDayCount:0,pairingScores:{},exactSlotScores:{},breakSlotScores:{}},
  callOutStaffIds:[],rules:{slotLengthMinutes:30}
} as unknown as SchedulerInput;
const breaks:AiCandidateRow[]=input.staff.map(s=>({
  staffId:s.id,startTime:"12:30",assignmentType:"BREAK" as const
}));
const safe:AiCandidateRow[]=[
  ...["11:00","11:30","12:00"].map(startTime=>({
    staffId:"s1",clientId:"c1",startTime,assignmentType:"CLIENT_1_TO_1" as const
  })),
  ...["11:00","11:30","12:00"].map(startTime=>({
    staffId:"s2",clientId:"c2",startTime,assignmentType:"CLIENT_1_TO_1" as const
  })),...breaks,
];
const lowerCoverage=safe.filter(row=>!(row.clientId==="c2"&&row.startTime==="11:30"));
const fragmented=safe.map(row=>row.clientId==="c1"&&row.startTime==="11:30"
  ? {...row,staffId:"s3"}:row);
const conflict=[...safe,{...safe[0]}];
const a=assessAiCandidate(input,safe);
const b=assessAiCandidate(input,fragmented);
const c=assessAiCandidate(input,lowerCoverage);
const d=assessAiCandidate(input,conflict);
assert.equal(a.valid,true);
assert.equal(b.valid,true);
assert.equal(c.valid,true);
assert.equal(d.valid,false);
assert.equal(a.covered,6);
assert.equal(c.covered,5);
assert.ok(a.handoffs<b.handoffs);
assert.equal(compareAiCandidates(a,b),"previous","Fewer needless client handoffs win at equal coverage.");
assert.equal(compareAiCandidates(b,a),"next");
assert.equal(compareAiCandidates(a,c),"previous","Full coverage outranks soft preferences.");
assert.equal(compareAiCandidates(c,a),"next");
assert.equal(compareAiCandidates(a,d),"previous","Unsafe duplicates never outrank a safe schedule.");
const napInput:SchedulerInput={
  ...input,
  clients:[{
    ...input.clients[0],requiredSlots:["11:30","12:00","12:30"],
    napSlots:["11:00"],speechSlots:[],
  },input.clients[1]],
};
const windows=restoreAiNapWindowChoices(napInput,[{
  clientId:"c1",startTime:"11:00",endTime:"13:00"
}]);
assert.deepEqual(windows.clients[0].napSlots,["11:00","11:30","12:00","12:30"],
  "OpenAI chooses within the saved nap window, rather than inheriting a native preselection.");
assert.deepEqual(windows.clients[0].requiredSlots,["11:00","11:30","12:00","12:30"]);
const fixed=restoreAiNapWindowChoices(napInput,[{
  clientId:"c1",startTime:"11:00",endTime:"11:30"
}]);
assert.deepEqual(fixed.clients[0].napSlots,["11:00","11:30"],"Both start and end of a flexible nap window are eligible when attendance permits.");
const noNap=restoreAiNapWindowChoices({...input,clients:[input.clients[0]]},[{
  clientId:"c1",startTime:"11:00",endTime:"13:00"
}]);
assert.deepEqual(noNap.clients[0].napSlots,[],"No saved enabled nap => do not invent one.");
console.log("PASS OpenAI nap choices, strict event boundaries, coverage-first candidate comparison, continuity quality, and hard-rule safety.");
