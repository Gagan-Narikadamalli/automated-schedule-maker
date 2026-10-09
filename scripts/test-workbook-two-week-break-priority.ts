import assert from "node:assert/strict";
import { pinWorkbookTemplates } from "../src/features/scheduler/engine/pinWorkbookTemplates";
import type { SchedulerInput, SchedulerAssignment } from "../src/features/scheduler/engine/types";

const staff = [
  {id:"areyana",name:"Areyana",role:"BT" as const,availableSlots:["11:30","12:00","12:30","13:00"]},
  {id:"anias",name:"Anias",role:"BT" as const,availableSlots:["11:30","12:00","12:30","13:00"]},
  {id:"other",name:"Other",role:"BT" as const,availableSlots:["11:30","12:00","12:30","13:00"]},
];
const clients = ["cacr","came","new"].map(id=>({id,displayCode:id,requiredSlots:["11:30","12:00","12:30","13:00"],napSlots:[],speechSlots:[],staffRelationships:{}}));
const ref=(priority:1|2,staffId:string,startTime:string,assignmentType:SchedulerAssignment["assignmentType"],clientId?:string):SchedulerAssignment=>({
  id:`${priority}-${staffId}-${startTime}`,staffId,startTime,assignmentType,clientId,
  source:"TEMPLATE",locked:false,note:`Priority ${priority} saved workbook template: Friday.`,
});
const input={
  staff,clients,existingAssignments:[],callOutStaffIds:[],referenceAssignments:[
    ref(1,"areyana","11:30","BREAK"),
    ref(1,"anias","11:30","CLIENT_1_TO_1","cacr"),
    ref(1,"anias","12:00","BREAK"),
    ref(1,"anias","12:30","CLIENT_1_TO_1","cacr"),
    ref(2,"areyana","12:00","BREAK"),
    ref(2,"anias","11:30","CLIENT_1_TO_1","came"),
    ref(2,"other","12:30","CLIENT_1_TO_1","new"),
    ref(2,"other","13:00","BREAK"),
  ],
} as SchedulerInput;
const outcome=pinWorkbookTemplates(input);
assert.equal(outcome.primaryCount,4);
assert.equal(outcome.secondaryCount,1);
assert.equal(outcome.pinned.filter(x=>x.staffId==="areyana"&&x.assignmentType.startsWith("BREAK")).length,1);
assert(outcome.pinned.some(x=>x.staffId==="anias"&&x.startTime==="11:30"&&x.clientId==="cacr"));
assert(!outcome.pinned.some(x=>x.staffId==="anias"&&x.startTime==="11:30"&&x.clientId==="came"));
assert(!outcome.pinned.some(x=>x.staffId==="other"&&x.assignmentType.startsWith("BREAK")));
assert(outcome.pinned.some(x=>x.staffId==="other"&&x.clientId==="new"));
console.log("Two-week workbook break priority and primary cell preservation passed.");
