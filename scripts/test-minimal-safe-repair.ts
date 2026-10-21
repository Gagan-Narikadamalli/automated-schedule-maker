import assert from "node:assert/strict";
import { planMinimalSafeRepair } from "../src/features/scheduler/engine/planMinimalSafeRepair";
import { isExplicitDayRepairCommand, isExplicitDayGenerationCommand } from "../src/features/ai/schedulerActionIntent";
import type { SchedulerStaff,SchedulerClient,SchedulerAssignment,SchedulerInput,SchedulerRules } from "../src/features/scheduler/engine/types";

const slots=["11:00","11:30","12:00","12:30","13:00"];
const rules={
 maximumClientsPerTechPerDay:6,maximumTechsPerClientPerDay:4,minimumClientStaffAssignmentMinutes:30,
 maximumClientStaffConsecutiveHours:4,preventSameStaffClientRepeatSameDay:false,
 allowSameStaffClientRepeatForCoverageException:true,preferSameTeam:true,preferStaffContinuity:true,
 humanStyleBlockBalancingEnabled:false,slotLengthMinutes:30,preferredStaffPriority:100,
 sameTeamPriority:40,continuityPriority:35,rotationPriority:60,workloadBalancePriority:10,
 clientHandoffPenaltyPriority:25,staffScheduleCompactnessPriority:8,minimalFixAllowProtectedRelocation:false,
 minimalFixAllowBreakRelocation:false,preserveManualOverrides:true,scheduleStabilityPriority:140,
 weekdayTemplatePriority:75,weeklyHoursPriority:12,btCoveragePriority:500,internCoveragePriority:300,
 managerCoveragePriority:125,bcbaCoveragePriority:25,otherCoveragePriority:75,
 autoUseWeekdayTemplate:true,autoUsePreviousWeekdaySchedule:true
} as SchedulerRules;
const breakRules={breakWindowStart:"11:00",breakWindowEnd:"14:00",defaultBreakMinutes:30,
  breakEligibilityHours:0,slotLengthMinutes:30,breakSchedulingEnabled:true};
const staff=(id:string,availableSlots=slots):SchedulerStaff=>({
  id,name:id,role:"BT",serviceSetting:"IN_CENTER",availableSlots,
  maximumWeeklyHours:40,scheduledWeeklyClientHoursBeforeDate:0
});
const client=(id:string,requiredSlots:string[],napSlots:string[]=[]):SchedulerClient=>({
  id,displayCode:id,serviceSetting:"IN_CENTER",requiredSlots,napSlots,
  speechSlots:[],staffRelationships:{}
});
const row=(id:string,staffId:string,clientId:string,startTime:string,
  source:"AUTO"|"MANUAL"="AUTO",locked=false):SchedulerAssignment=>({
  id,staffId,clientId,startTime,assignmentType:"CLIENT_1_TO_1",source,locked
});
const staffBreak=(id:string,staffId:string,time:string,source:"AUTO"|"MANUAL"="AUTO"):SchedulerAssignment=>({
  id,staffId,startTime:time,assignmentType:"BREAK",source,locked:source==="MANUAL"
});
const input=(people:SchedulerStaff[],clients:SchedulerClient[],existingAssignments:SchedulerAssignment[]):SchedulerInput=>({
  staff:people,clients,existingAssignments,referenceAssignments:[],
  callOutStaffIds:[],rules
});
const run=(data:SchedulerInput,disruptions:Array<{staffId:string;startTime:string;endTime:string}>=[])=>
  planMinimalSafeRepair({input:data,rules:breakRules,disruptions});

// A single 30-minute call-out cannot move a still-valid manager-assigned cell.
{
  const earlier=row("original-1","A","C1","11:00","MANUAL",true);
  const interrupted=row("original-2","A","C1","11:30");
  const other=row("original-3","B","C2","11:00","MANUAL",true);
  const plan=run(input([staff("A"),staff("B")],
    [client("C1",["11:00","11:30"]),client("C2",["11:00"])],
    [earlier,interrupted,other]),[{staffId:"A",startTime:"11:30",endTime:"12:00"}]);
  assert.deepEqual(plan.validationErrors,[],"Full repair must pass all hard validations");
  assert.equal(plan.result.metrics.coveredClientSlots,3);
  assert.equal(plan.result.assignments.some(a=>a.id==="original-1"&&a.staffId==="A"&&a.locked),true);
  assert.equal(plan.result.assignments.some(a=>a.id==="original-3"&&a.staffId==="B"),true);
  assert.equal(plan.result.assignments.some(a=>a.staffId==="A"&&a.startTime==="11:30"),false);
  assert.equal(plan.result.assignments.some(a=>a.staffId==="B"&&a.clientId==="C1"&&a.startTime==="11:30"),true);
  assert.ok(plan.preservedOriginalCount>=2);
  assert.ok(plan.removedOriginals.some(a=>a.id==="original-2"));
}
// Staff shortage must leave client 1:1 in the Unplaced tray, not invent relief.
{
  const older=row("unavailable","A","C1","11:30");
  const plan=run(input([staff("A"),staff("B",["11:00","13:00"])],
    [client("C1",["11:30"]),client("C2",["11:00"])],
    [older,row("other","B","C2","11:00")]),
    [{staffId:"A",startTime:"11:30",endTime:"12:00"}]);
  assert.deepEqual(plan.validationErrors,[]);
  assert.equal(plan.result.uncoveredRequirements.some(g=>g.clientId==="C1"&&g.startTime==="11:30"),true);
  assert.equal(plan.result.assignments.some(a=>a.staffId==="A"&&a.startTime==="11:30"),false);
}
// A movable AUTO lunch must be replanned only when that gains valid coverage.
{
  const plan=run(input([staff("A"),staff("B")],[client("C1",["11:00","11:30"]),
    client("C2",["11:30"])],[
    row("base","A","C1","11:00","MANUAL",true),
    staffBreak("movable","A","11:30"),
    row("busy","B","C2","11:30","MANUAL",true)
  ]));
  assert.deepEqual(plan.validationErrors,[]);
  assert.equal(plan.result.metrics.coveredClientSlots,3);
  assert.equal(plan.breakRecalculated,true,"Only an AUTO break can be rescheduled to fill the gap");
  assert.equal(plan.result.assignments.some(a=>a.staffId==="A"&&a.clientId==="C1"&&a.startTime==="11:30"),true);
  assert.equal(plan.result.assignments.some(a=>a.staffId==="A"&&a.assignmentType==="BREAK"&&a.startTime!=="11:30"),true);
  assert.equal(plan.result.assignments.find(a=>a.id==="base")?.locked,true);
}
// Protected MANUAL lunch must remain and a competing client block stays unplaced.
{
  const plan=run(input([staff("A"),staff("B")],[client("C1",["11:30"]),client("C2",["11:30"])],[
    staffBreak("manual","A","11:30","MANUAL"),
    row("busy","B","C2","11:30","MANUAL",true)
  ]));
  assert.deepEqual(plan.validationErrors,[]);
  assert.equal(plan.result.assignments.some(a=>a.id==="manual"),true);
  assert.equal(plan.result.uncoveredRequirements.some(g=>g.clientId==="C1"&&g.startTime==="11:30"),true);
}
// Explicit nap event uses one caregiver and a linked 30-minute break.
{
  const plan=run(input([staff("A"),staff("B")],
    [client("C1",["11:00"],["12:00"])],[row("existing","A","C1","11:00","MANUAL",true)]));
  assert.deepEqual(plan.validationErrors,[]);
  assert.equal(plan.result.assignments.filter(a=>a.assignmentType==="BREAK_NAP"&&a.clientId==="C1"&&a.startTime==="12:00").length,1);
}
// A repair chat command is not a model-design prompt. Date handling happens in server date resolution.
for(const message of ["repair the schedule for today","repair today's schedule",
  "minimal fix today's schedule","fix the schedule for tomorrow","please repair schedule for today"]) {
  assert.equal(isExplicitDayRepairCommand(message),true,message);
  assert.equal(isExplicitDayGenerationCommand(message),false);
}
for(const message of ["why repair today?","how do I repair the schedule?","generate a complete new schedule",
  "repair the week","is it possible to repair today's schedule?"]) {
  assert.equal(isExplicitDayRepairCommand(message),false,message);
}
console.log("PASS minimal repair: partial staff call-outs, protected continuity, safe unplaced gaps, movable AUTO breaks, linked nap, and zero-model repair intent.");
