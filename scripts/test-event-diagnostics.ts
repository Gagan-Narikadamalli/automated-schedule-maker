import assert from "node:assert/strict";
import { explainUnmetEventRules } from "../src/features/scheduler/engine/explainUnmetEventRules";
import type { SchedulerStaff,SchedulerClient,SchedulerAssignment } from "../src/features/scheduler/engine/types";

const staff=[
  {id:"s1",name:"Therapist 1",role:"BT",availableSlots:["13:00"],serviceSetting:"IN_CENTER"},
  {id:"s2",name:"Therapist 2",role:"BT",availableSlots:["11:00"],serviceSetting:"IN_CENTER"}
] as SchedulerStaff[];
const clients=[
  {id:"c1",displayCode:"CaGr",requiredSlots:[],napSlots:["13:00"],speechSlots:[],
    staffRelationships:{},serviceSetting:"IN_CENTER"},
  {id:"c2",displayCode:"ZiBo",requiredSlots:[],napSlots:["13:30"],speechSlots:[],
    staffRelationships:{},serviceSetting:"IN_CENTER"}
] as SchedulerClient[];
const assignments=[{id:"busy",staffId:"s1",clientId:"c2",startTime:"13:00",assignmentType:"CLIENT_1_TO_1",
  source:"AUTO",locked:false}] as SchedulerAssignment[];
const diagnostics=explainUnmetEventRules({
  problems:["Client c1 missing scheduled Break/Nap at 13:00",
    "Client c2 missing scheduled Break/Nap at 13:30",
    "Staff s1 missing required 30-minute break"],
  staff,clients,assignments,calledOutStaffIds:[]
});
assert.match(diagnostics[0],/all eligible therapists have another assignment/i);
assert.match(diagnostics[1],/no eligible therapist is available/i);
assert.match(diagnostics[2],/every permitted break start is occupied/i);
const callout=explainUnmetEventRules({
  problems:["Client c1 missing scheduled Break/Nap at 13:00"],
  staff,clients,assignments,calledOutStaffIds:["s1"]
});
assert.match(callout[0],/no eligible therapist is available/i);
console.log("PASS user-facing reasons for missing nap, fully occupied break window, and staff call-outs.");
