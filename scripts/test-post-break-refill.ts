import assert from "node:assert/strict";
import { refillCoverageAfterBreakAlignment } from "../src/features/scheduler/engine/refillCoverageAfterBreakAlignment";
import type { SchedulerInput,SchedulerAssignment,SchedulerStaff,SchedulerClient,SchedulerRules } from "../src/features/scheduler/engine/types";

const slots=["11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30"];
const person:SchedulerStaff={id:"Danna",name:"Danna",role:"BT",availableSlots:slots,
  serviceSetting:"IN_CENTER"};
const client=(id:string,requiredSlots:string[],napSlots:string[]=[]):SchedulerClient=>({
  id,displayCode:id,serviceSetting:"IN_CENTER",
  requiredSlots,napSlots,speechSlots:[],staffRelationships:{}
});
const c1=client("ZiBo",["12:30"],["13:00"]);
const c2=client("AmAb",["13:30"]);
const before:SchedulerAssignment[]=[
 {id:"before",staffId:"Danna",clientId:"ZiBo",startTime:"12:30",
  assignmentType:"CLIENT_1_TO_1",source:"AUTO",locked:false},
 {id:"linked",staffId:"Danna",clientId:"ZiBo",startTime:"13:00",
  assignmentType:"BREAK_NAP",source:"AUTO",locked:false}
];
const rules={slotLengthMinutes:30,maximumClientsPerTechPerDay:5,
  maximumTechsPerClientPerDay:5,maximumClientStaffConsecutiveHours:4,
  preventSameStaffClientRepeatSameDay:false,allowSameStaffClientRepeatForCoverageException:true
} as SchedulerRules;
const input:SchedulerInput={
 staff:[person],clients:[c1,c2],existingAssignments:[],
 referenceAssignments:[],callOutStaffIds:[],rules
};
const result=refillCoverageAfterBreakAlignment(input,before);
assert.equal(result.addedCount,1,"Freed 13:30 slot should fill the other client's unmet 1:1 need.");
assert.ok(result.assignments.some(a=>a.staffId==="Danna"&&a.clientId==="AmAb"&&a.startTime==="13:30"));
assert.ok(result.assignments.some(a=>a.id==="linked"&&a.assignmentType==="BREAK_NAP"));
assert.ok(result.assignments.some(a=>a.id==="before"&&a.staffId==="Danna"));
assert.ok(result.assignments.every(a=>a.assignmentType!=="BREAK"||a.startTime!=="13:30"));
assert.equal(result.assignments.length,before.length+1);
assert.equal(before.length,2,"Reconsidering coverage must not mutate the original array");
const limited=refillCoverageAfterBreakAlignment({
 ...input,staff:[{...person,availableSlots:slots.filter(t=>t!=="13:30")}]
},before);
assert.equal(limited.addedCount,0,"Never invent coverage when staff cannot work that slot");
console.log("PASS after moving a staff break onto a 13:00 nap, Auto Generate fills freed 13:30 time with another eligible client without changing prior assignments.");
