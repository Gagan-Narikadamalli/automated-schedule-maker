import assert from "node:assert/strict";
import {buildTemplateGuidedChoices} from "../src/features/ai/templateGuidedDayPlanner";
import {decodeFixedScheduleChoices,type FixedScheduleSnapshot} from "../src/features/ai/fixedScheduleChoices";
import {expandOpenAIPlan} from "../src/features/ai/openaiSchedulePlan";
import {validateOpenAIPlan} from "../src/features/ai/validateOpenAIPlan";
import type {SchedulerInput} from "../src/features/scheduler/engine/types";
const times=Array.from({length:16},(_,i)=>{
  const m=480+i*30;return String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0");
});
const staff=Array.from({length:26},(_,i)=>({id:"Staff"+(i+1),role:"BT",availableSlots:times,serviceSetting:"IN_CENTER"}));
const clients=Array.from({length:20},(_,i)=>({
  id:"Client"+(i+1),requiredSlots:times,napSlots:i<10?["12:00"]:[],
  speechSlots:[],excludedStaff:[],serviceSetting:"IN_CENTER"
}));
const snapshot:FixedScheduleSnapshot={
 useFixedCells:true,date:"2026-10-22",preferFastTemplateGuidedPlanning:true,
 rules:{breakWindowStart:"11:00",breakWindowEnd:"14:00"},
 staff,clients,calledOutStaff:[],templates:[],referenceAssignments:[]
};
const choices=buildTemplateGuidedChoices(snapshot);
assert.equal(Object.keys(choices.staffByTime).length,16);
const plan=decodeFixedScheduleChoices(snapshot,choices);
const rows=expandOpenAIPlan(plan,
  new Map(staff.map((s,i)=>[s.id,"s"+(i+1)])),
  new Map(clients.map((c,i)=>[c.id,"c"+(i+1)]))
);
const input={
 staff:staff.map((s,i)=>({...s,id:"s"+(i+1),name:s.id,role:"BT"})),
 clients:clients.map((c,i)=>({...c,id:"c"+(i+1),displayCode:c.id,staffRelationships:{}})),
 callOutStaffIds:[],existingAssignments:[],referenceAssignments:[],rules:{slotLengthMinutes:30}
} as unknown as SchedulerInput;
const audit=validateOpenAIPlan(input,rows);
assert.deepEqual(audit.problems,[],"All required staff breaks and 10 client naps must be independently valid.");
assert.equal(audit.required,320);
assert.equal(audit.covered,320);
assert.equal(audit.missing.length,0);
assert.equal(rows.filter(r=>["BREAK","BREAK_NAP","BREAK_SPEECH"].includes(r.assignmentType)).length,26);
assert.equal(rows.filter(r=>["NAP","BREAK_NAP"].includes(r.assignmentType)).length,10);
console.log("PASS large real-route fallback without templates: 20 clients, 26 staff, 320 of 320 client blocks, 10 supervised naps, 26 staggered staff breaks and zero hard violations.");
