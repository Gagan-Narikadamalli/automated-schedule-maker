import assert from "node:assert/strict";
import { getEventStartSlotsInsideTimeRange, getSlotsInsideTimeRange } from "../src/features/scheduler/engine/dateUtils";
import { placeStaffBreaksAfterCoverage } from "../src/features/scheduler/engine/placeStaffBreaks";
import { reserveStaffBreaks } from "../src/features/scheduler/engine/reserveBreaks";
import { auditLinkedNapBreakRules } from "../src/features/scheduler/engine/auditLinkedNapBreakRules";
import { restoreAiNapWindowChoices } from "../src/features/ai/aiNapWindowChoices";
import { buildFixedScheduleChoices } from "../src/features/ai/fixedScheduleChoices";
import { validateOpenAIPlan } from "../src/features/ai/validateOpenAIPlan";
import type { SchedulerInput, SchedulerRules, SchedulerClient, SchedulerStaff } from "../src/features/scheduler/engine/types";

const atTwo="14:00";
const times=["13:00","13:30","14:00"];
const staff:SchedulerStaff={id:"staff",name:"Eligible BT",role:"BT",
 availableSlots:["14:00"],serviceSetting:"IN_CENTER"};
const client:SchedulerClient={id:"client",displayCode:"CaGr",requiredSlots:[],
 napSlots:["14:00"],speechSlots:[],staffRelationships:{},serviceSetting:"IN_CENTER"};
const rules={breakWindowStart:"11:00",breakWindowEnd:"14:00",
 defaultBreakMinutes:30,breakEligibilityHours:0,slotLengthMinutes:30};
const skeleton={slotLengthMinutes:30} as SchedulerRules;
assert.deepEqual(getEventStartSlotsInsideTimeRange("13:00","14:00"),times);
assert.deepEqual(getSlotsInsideTimeRange("13:00","14:00"),["13:00","13:30"]);
const native=placeStaffBreaksAfterCoverage({
 staff:[staff],clients:[client],assignments:[],referenceAssignments:[],
 callOutStaffIds:[],rules,schedulerRules:skeleton
});
assert.equal(native.assignments.filter(a=>a.assignmentType==="BREAK_NAP"&&a.clientId==="client"&&a.startTime===atTwo).length,1,
 "Native generator must link a saved 14:00 nap to a 14:00 staff break ending 14:30");
assert.deepEqual(auditLinkedNapBreakRules(native.assignments,[client],[staff],"11:00","14:00"),[]);
const noClients=reserveStaffBreaks({staff:[staff],clients:[],existingAssignments:[],
 referenceAssignments:[],callOutStaffIds:[],rules,schedulerRules:skeleton});
assert.equal(noClients.length,1,"Reservation engine may reserve the 14:00 staff break");
assert.equal(noClients[0].startTime,atTwo);
const roster:SchedulerInput={staff:[staff],clients:[{...client,requiredSlots:[atTwo]}],
 existingAssignments:[],referenceAssignments:[],callOutStaffIds:[],rules:skeleton};
const cloud=restoreAiNapWindowChoices(roster,[{clientId:"client",startTime:"13:00",endTime:"14:00"}]);
assert.deepEqual(cloud.clients[0].napSlots,[atTwo],
 "The cloud planner must allow the 14:00 boundary when client attendance only allows this slot");
const snapshot={staff:[{id:"staff",availableSlots:[atTwo]}],clients:[
 {id:"client",requiredSlots:[atTwo],napSlots:[atTwo],speechSlots:[]}],
 calledOutStaff:[],rules:{breakWindowStart:"11:00",breakWindowEnd:"14:00"}};
const fixed=buildFixedScheduleChoices(snapshot);
const properties=fixed.schema.properties as Record<string,any>;
const breakEnum=properties.breakTimes.properties.staff.enum as string[];
assert.ok(breakEnum.includes("14:00"),"OpenAI structured choices must offer 14:00 as break start");
assert.deepEqual(validateOpenAIPlan(roster,[{
 staffId:"staff",clientId:"client",startTime:atTwo,assignmentType:"BREAK_NAP"
}]).problems,[],"OpenAI validator must accept 14:00–14:30 linked nap and break");
const standalone=validateOpenAIPlan({...roster,clients:[]},[{
 staffId:"staff",startTime:atTwo,assignmentType:"BREAK"
}]);
assert.deepEqual(standalone.problems,[],"A standalone staff break starting 14:00 must be legal");
const outside=validateOpenAIPlan({...roster,clients:[],staff:[{...staff,availableSlots:["14:30"]}]},[
 {staffId:"staff",startTime:"14:30",assignmentType:"BREAK"}
]);
assert.ok(outside.problems.some(v=>v.includes("outside")),"14:30 starts remain outside the 14:00 break window");
console.log("PASS inclusive 14:00 start across nap events, native generator, break reservation, OpenAI choices and validation.");
