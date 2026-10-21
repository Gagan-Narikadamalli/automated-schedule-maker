import assert from "node:assert/strict";
import { assessAiCandidate, compareAiCandidates } from "../src/features/ai/compareScheduleCandidates";
import type { SchedulerInput, SchedulerAssignment, SchedulerStaff, SchedulerClient, SchedulerRules } from "../src/features/scheduler/engine/types";

const slots=["11:00","12:00","12:30"];
const people:SchedulerStaff[]=[
 {id:"A",name:"Therapist A",role:"BT",availableSlots:slots,serviceSetting:"IN_CENTER"},
 {id:"B",name:"Therapist B",role:"BT",availableSlots:slots,serviceSetting:"IN_CENTER"}
];
const kids:SchedulerClient[]=[
 {id:"C1",displayCode:"C1",requiredSlots:["11:00"],napSlots:[],speechSlots:[],
  staffRelationships:{A:"PREFERRED"},serviceSetting:"IN_CENTER"},
 {id:"C2",displayCode:"C2",requiredSlots:["11:00"],napSlots:[],speechSlots:[],
  staffRelationships:{B:"HARD_RESTRICTION"},serviceSetting:"IN_CENTER"}
];
const row=(staffId:string,clientId:string):SchedulerAssignment=>({
 id:staffId+"|"+clientId,staffId,clientId,startTime:"11:00",
 assignmentType:"CLIENT_1_TO_1",source:"AUTO",locked:false
});
const prior:SchedulerAssignment[]=[row("A","C1")];
const rules={slotLengthMinutes:30} as SchedulerRules;
const input:SchedulerInput={staff:people,clients:kids,
 existingAssignments:[],referenceAssignments:prior,callOutStaffIds:[],rules,
 historicalPatterns:{sampleCount:10000,scheduleDayCount:200,
  pairingScores:{"A|C1":10000},exactSlotScores:{},breakSlotScores:{}}};
const breaks=[
 {staffId:"A",startTime:"12:00",assignmentType:"BREAK" as const},
 {staffId:"B",startTime:"12:30",assignmentType:"BREAK" as const}
];
const templateFollowing=[{staffId:"A",clientId:"C1",startTime:"11:00",assignmentType:"CLIENT_1_TO_1" as const},...breaks];
const betterCoverage=[
 {staffId:"B",clientId:"C1",startTime:"11:00",assignmentType:"CLIENT_1_TO_1" as const},
 {staffId:"A",clientId:"C2",startTime:"11:00",assignmentType:"CLIENT_1_TO_1" as const},...breaks
];
const copied=assessAiCandidate(input,templateFollowing),judgment=assessAiCandidate(input,betterCoverage);
assert.equal(copied.valid,true);
assert.equal(judgment.valid,true);
assert.equal(copied.covered,1);
assert.equal(judgment.covered,2);
assert.ok(copied.templateMatches>judgment.templateMatches);
assert.equal(compareAiCandidates(copied,judgment),"next",
  "Current safe client coverage must outrank even enormous historical/template evidence.");
assert.equal(compareAiCandidates(judgment,copied),"previous");
console.log("PASS independent AI judgment: template-preferred therapist is rejected when current-day coverage improves; hard staff restrictions remain intact.");
