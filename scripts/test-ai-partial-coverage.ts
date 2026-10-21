import assert from "node:assert/strict";
import { explainUnplacedCoverage } from "../src/features/ai/explainUnplacedCoverage";
import { validateOpenAIPlan } from "../src/features/ai/validateOpenAIPlan";
import type { SchedulerInput } from "../src/features/scheduler/engine/types";

const times=["11:00","11:30","12:00"];
const input={
  staff:[{id:"s1",name:"BT 1",role:"BT",availableSlots:times},
    {id:"s2",name:"BT 2",role:"BT",availableSlots:times}],
  clients:[{id:"c1",displayCode:"CaGr",requiredSlots:times,napSlots:[],speechSlots:[],staffRelationships:{}},
    {id:"c2",displayCode:"ZiBo",requiredSlots:times,napSlots:[],speechSlots:[],
      staffRelationships:{s1:"HARD_RESTRICTION",s2:"HARD_RESTRICTION"}}],
  callOutStaffIds:[],existingAssignments:[],referenceAssignments:[],
  rules:{slotLengthMinutes:30}
} as unknown as SchedulerInput;
const rows=[
  {staffId:"s1",clientId:"c1",startTime:"11:00",assignmentType:"CLIENT_1_TO_1" as const},
  {staffId:"s1",startTime:"11:30",assignmentType:"BREAK" as const},
  {staffId:"s1",clientId:"c1",startTime:"12:00",assignmentType:"CLIENT_1_TO_1" as const},
  {staffId:"s2",startTime:"11:00",assignmentType:"BREAK" as const},
];
const audit=validateOpenAIPlan(input,rows);
assert.deepEqual(audit.problems,[], "Uncovered 1:1 cells do not invalidate otherwise safe assignments");
assert.equal(audit.missing.length,4);
const explained=explainUnplacedCoverage(input,rows,audit.missing);
assert.equal(explained.filter(p=>p.clientId==="c2").length,3);
assert.ok(explained.find(p=>p.clientId==="c2")?.reason.includes("restricted"));
assert.ok(explained.find(p=>p.clientId==="c1"&&p.startTime==="11:30")?.reason.includes("OpenAI left"));
const unsafe=validateOpenAIPlan(input,[...rows,
  {staffId:"s1",clientId:"c2",startTime:"11:00",assignmentType:"CLIENT_1_TO_1" as const}
]);
assert.ok(unsafe.problems.some(p=>p.includes("double-booked")));
assert.ok(unsafe.problems.some(p=>p.includes("Hard relationship restriction")));
console.log("PASS AI partial coverage and evidence-based unplaced reasons; hard conflicts still block saving.");
