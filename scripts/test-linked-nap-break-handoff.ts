import assert from "node:assert/strict";
import { placeStaffBreaksAfterCoverage } from "../src/features/scheduler/engine/placeStaffBreaks";
import { auditLinkedNapBreakRules } from "../src/features/scheduler/engine/auditLinkedNapBreakRules";
import { classifyEventAuditForPartialSave,auditPartialAssignmentSafety } from "../src/features/scheduler/engine/classifyEventAuditForPartialSave";
import type { SchedulerAssignment,SchedulerClient,SchedulerStaff,SchedulerRules } from "../src/features/scheduler/engine/types";

const hours=["11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30"];
const rules={breakSchedulingEnabled:true,defaultBreakMinutes:30,breakEligibilityHours:0,
  breakWindowStart:"11:00",breakWindowEnd:"14:00",slotLengthMinutes:30};
const schedulerRules={slotLengthMinutes:30,humanStyleBlockBalancingEnabled:false,
  maximumClientsPerTechPerDay:5,maximumTechsPerClientPerDay:5,
  maximumClientStaffConsecutiveHours:4,preventSameStaffClientRepeatSameDay:false,
  allowSameStaffClientRepeatForCoverageException:true,
  preferredStaffPriority:100,sameTeamPriority:40,continuityPriority:20,rotationPriority:10
} as unknown as SchedulerRules;
const staff=(id:string):SchedulerStaff=>({
  id,name:id,role:"BT",serviceSetting:"IN_CENTER",availableSlots:hours,teamId:"team"
});
const client=(id:string,naps:string[]=[]):SchedulerClient=>({
  id,displayCode:id,serviceSetting:"IN_CENTER",teamId:"team",
  requiredSlots:["12:30","13:30"],napSlots:naps,speechSlots:[],staffRelationships:{}
});
function coverage(id:string,staffId:string,clientId:string,time:string):SchedulerAssignment{
  return {id,staffId,clientId,startTime:time,assignmentType:"CLIENT_1_TO_1",source:"AUTO",locked:false};
}
function autoBreak(staffId:string,time:string):SchedulerAssignment {
  return {id:"auto-break-"+staffId+"-"+time,staffId,startTime:time,
    assignmentType:"BREAK",source:"AUTO",locked:true};
}
function manualBreak(staffId:string,time:string):SchedulerAssignment{
  return {...autoBreak(staffId,time),id:"manual-break-"+staffId,source:"MANUAL",locked:true};
}
function plan(assignments:SchedulerAssignment[],roster=[staff("Danna")],kids=[client("ZiBo",["13:00"])]){
  return placeStaffBreaksAfterCoverage({
    staff:roster,clients:kids,assignments,
    callOutStaffIds:[],rules,schedulerRules
  });
}
// The exact user scenario: staff had this child BEFORE the 13:00 nap,
// and an AUTO break at 13:30. Relocate that break to the nap.
{
  const result=plan([coverage("before","Danna","ZiBo","12:30"),autoBreak("Danna","13:30")]);
  assert.equal(result.assignments.filter(a=>a.staffId==="Danna"&&a.assignmentType==="BREAK_NAP"&&a.clientId==="ZiBo"&&a.startTime==="13:00").length,1);
  assert.equal(result.assignments.filter(a=>a.staffId==="Danna"&&a.assignmentType==="BREAK").length,0,
    "Former 13:30 staff break is removed, not duplicated.");
  assert.ok(result.assignments.every(a=>!(a.staffId==="Danna"&&a.startTime==="13:30")),
    "13:30 must be free so Danna may cover a different child afterward.");
  assert.ok(result.assignments.some(a=>a.id==="before"&&a.startTime==="12:30"));
  assert.deepEqual(auditLinkedNapBreakRules(result.assignments,[client("ZiBo",["13:00"])],[staff("Danna")]),[]);
}
// A handoff is allowed: after supervising one child's nap the same therapist
// may already have another client's 1:1 coverage.
{
  const result=plan([
    coverage("before","Danna","ZiBo","12:30"),
    coverage("next-client","Danna","AmAb","13:30"),
    autoBreak("Danna","14:00")
  ],[staff("Danna")],[client("ZiBo",["13:00"]),client("AmAb")]);
  assert.ok(result.assignments.some(a=>a.id==="next-client"&&a.clientId==="AmAb"&&a.startTime==="13:30"));
  assert.ok(!result.assignments.some(a=>a.staffId==="Danna"&&a.startTime==="14:00"&&a.assignmentType==="BREAK"));
  assert.ok(result.assignments.some(a=>a.staffId==="Danna"&&a.clientId==="ZiBo"&&a.assignmentType==="BREAK_NAP"&&a.startTime==="13:00"));
}
// Client NAP still counts as completed even when the employee already has a
// protected MANUAL staff break on another slot (the break must not move).
{
  const result=plan([
    coverage("before","Danna","ZiBo","12:30"),
    manualBreak("Danna","13:30")
  ]);
  assert.ok(result.assignments.some(a=>a.assignmentType==="NAP"&&a.clientId==="ZiBo"&&a.startTime==="13:00"));
  assert.ok(result.assignments.some(a=>a.assignmentType==="BREAK"&&a.source==="MANUAL"&&a.startTime==="13:30"));
  assert.equal(result.assignments.some(a=>a.assignmentType==="BREAK_NAP"),false);
  assert.deepEqual(auditLinkedNapBreakRules(result.assignments,[client("ZiBo",["13:00"])],[staff("Danna")]),[]);
}
// Existing explicitly assigned NAP is converted to a combined break when
// caregiver has a movable later AUTO break. It is not duplicated.
{
  const result=plan([
    coverage("before","Danna","ZiBo","12:30"),
    {id:"saved-nap",staffId:"Danna",clientId:"ZiBo",startTime:"13:00",
      assignmentType:"NAP",source:"AUTO",locked:false},
    autoBreak("Danna","13:30")
  ]);
  assert.equal(result.assignments.filter(a=>a.id==="saved-nap"&&a.assignmentType==="BREAK_NAP").length,1);
  assert.equal(result.assignments.filter(a=>a.clientId==="ZiBo"&&a.startTime==="13:00").length,1);
  assert.equal(result.assignments.filter(a=>a.staffId==="Danna"&&["BREAK","BREAK_NAP"].includes(a.assignmentType)).length,1);
}
// Impossible supervision remains a CLIENT nap obligation in Unplaced, not a
// fake completed Break/Nap. Staff break remains separately tracked.
{
  const unavailable={...staff("Danna"),availableSlots:["12:30","13:30"]};
  const kid=client("ZiBo",["13:00"]);
  const result=plan([coverage("before","Danna","ZiBo","12:30")],[unavailable],[kid]);
  const warnings=auditLinkedNapBreakRules(result.assignments,[kid],[unavailable]);
  assert.ok(warnings.some(w=>w.includes("missing required 30-minute nap")));
  const status=classifyEventAuditForPartialSave({
    issues:warnings,staff:[unavailable],clients:[kid],assignments:result.assignments,
    breakWindowStart:"11:00",breakWindowEnd:"14:00"
  });
  assert.equal(status.conflicts.length,0);
  assert.ok(status.unplacedEvents.some(e=>e.eventKind==="NAP"&&e.clientId==="ZiBo"));
  assert.deepEqual(auditPartialAssignmentSafety({
    assignments:result.assignments,clients:[kid],staff:[unavailable],calledOutStaffIds:[]
  }),[]);
}
console.log("PASS Nap vs Break separation, move AUTO 13:30 break onto 13:00 client nap, preserve 13:30 different client coverage, protect MANUAL break, avoid duplicate nap, and unplace impossible nap.");
