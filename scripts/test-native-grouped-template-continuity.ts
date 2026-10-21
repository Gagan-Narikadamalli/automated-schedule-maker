import assert from "node:assert/strict";
import { prepareGroupAwareTemplateEvidence } from "../src/features/scheduler/engine/prepareGroupAwareTemplateEvidence";
import { pinWorkbookTemplates } from "../src/features/scheduler/engine/pinWorkbookTemplates";
import { generateSchedule } from "../src/features/scheduler/engine/generateSchedule";
import { placeStaffBreaksAfterCoverage } from "../src/features/scheduler/engine/placeStaffBreaks";
import { auditLinkedNapBreakRules } from "../src/features/scheduler/engine/auditLinkedNapBreakRules";
import type { SchedulerAssignment,SchedulerClient,SchedulerInput,SchedulerRules,SchedulerStaff } from "../src/features/scheduler/engine/types";

const times=["11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00"];
const shift=(t:string)=>t;
const rules={
 maximumClientsPerTechPerDay:4,maximumTechsPerClientPerDay:4,
 minimumClientStaffAssignmentMinutes:30,maximumClientStaffConsecutiveHours:4,
 preventSameStaffClientRepeatSameDay:false,allowSameStaffClientRepeatForCoverageException:true,
 preferSameTeam:true,preferStaffContinuity:true,
 humanStyleBlockBalancingEnabled:false,
 preferredClientsPerStaffPerDay:2,preferredStaffPerClientPerDay:1,slotLengthMinutes:30,
 preferredStaffPriority:100,sameTeamPriority:40,continuityPriority:120,
 rotationPriority:20,workloadBalancePriority:0,clientHandoffPenaltyPriority:200,
 staffScheduleCompactnessPriority:10,minimalFixAllowProtectedRelocation:false,
 minimalFixAllowBreakRelocation:false,preserveManualOverrides:true,
 breakSchedulingEnabled:true,scheduleStabilityPriority:100,weekdayTemplatePriority:75,
 weeklyHoursPriority:12,btCoveragePriority:500,internCoveragePriority:300,
 managerCoveragePriority:125,bcbaCoveragePriority:25,otherCoveragePriority:75,
 autoUseWeekdayTemplate:true,autoUsePreviousWeekdaySchedule:true,
 historicalBreakPriority:80
} as SchedulerRules;
const breakRules={
 breakSchedulingEnabled:true,defaultBreakMinutes:30,slotLengthMinutes:30,
 breakWindowStart:"11:00",breakWindowEnd:"14:00",breakEligibilityHours:0,
 historicalBreakPriority:80
};
const person=(id:string):SchedulerStaff=>({
 id,name:id,role:"BT",serviceSetting:"IN_CENTER",availableSlots:times,
 teamId:"TEAM",scheduledWeeklyClientHoursBeforeDate:0
});
const kid=(id:string,service:string[],nap:string):SchedulerClient=>({
 id,displayCode:id,requiredSlots:service,napSlots:[nap],speechSlots:[],
 serviceSetting:"IN_CENTER",teamId:"TEAM",staffRelationships:{}
});
function ref(staffId:string,clientId:string|undefined,startTime:string,
 assignmentType:"CLIENT_1_TO_1"|"BREAK"|"BREAK_NAP",
 layer:1|2=1):SchedulerAssignment{
 return {
  id:[staffId,clientId??"none",startTime,assignmentType,layer].join("|"),
  staffId,clientId,startTime,assignmentType,source:"TEMPLATE",locked:false,
  note:"Priority "+layer+" saved workbook template: historical example"
 };
}
function run(name:string,primary:string,child:string,service:string[],nap:string,
 singletonStaff:string,first:string[],second:string[],oldBreak:string) {
 const roster=[person(primary),person(singletonStaff)];
 const client=kid(child,service,nap);
 const references=[
   ...first.map(time=>ref(primary,child,time,"CLIENT_1_TO_1")),
   ...second.map(time=>ref(primary,child,time,"CLIENT_1_TO_1")),
   ref(singletonStaff,child,oldBreak,"CLIENT_1_TO_1",2),
   // Historical "Break/Nap" reflects a STAFF break hint, NOT today's
   // client's nap at this historical time.
   ref(primary,child,oldBreak,"BREAK_NAP")
 ];
 const data:SchedulerInput={
   staff:roster,clients:[client],referenceAssignments:references,
   existingAssignments:[],callOutStaffIds:[],rules
 };
 const evidence=prepareGroupAwareTemplateEvidence(data);
 assert.equal(evidence.retainedGroupedCoverageCells,first.length+second.length,name);
 assert.equal(evidence.ignoredIsolatedCoverageCells,1,name);
 assert.equal(evidence.historicalBreakHints.length,1,name);
 assert.ok(evidence.historicalBreakHints.every(a=>a.assignmentType==="BREAK"&&!a.clientId));
 assert.ok(!evidence.references.some(a=>a.staffId===singletonStaff&&
   a.clientId===child&&a.assignmentType==="CLIENT_1_TO_1"));
 const pins=pinWorkbookTemplates({...data,referenceAssignments:evidence.groupedCoverageReferences});
 assert.equal(pins.pinned.length,first.length+second.length,name+" pin only grouped coverage");
 assert.ok(pins.pinned.every(a=>a.assignmentType==="CLIENT_1_TO_1"),name+" no historical Break/Nap pins");
 const generated=generateSchedule({...data,referenceAssignments:evidence.references,
   existingAssignments:pins.pinned});
 const placed=placeStaffBreaksAfterCoverage({
   staff:roster,clients:[client],assignments:generated.assignments,
   callOutStaffIds:[],referenceAssignments:evidence.references,
   rules:breakRules,schedulerRules:rules
 });
 console.log("DEBUG GROUP "+name+" generated="+JSON.stringify(generated.assignments.map(a=>[a.staffId,a.clientId,a.startTime,a.assignmentType]))+
   " placed="+JSON.stringify(placed.assignments.map(a=>[a.staffId,a.clientId,a.startTime,a.assignmentType])));
 const serviceRows=placed.assignments.filter(a=>a.assignmentType==="CLIENT_1_TO_1"&&a.clientId===child);
 assert.ok(serviceRows.length===service.length,
   name+" client service must be covered, expected "+service.length+" got "+serviceRows.length);
 assert.ok(serviceRows.every(a=>a.staffId===primary),
   name+" keep grouped template caregiver throughout the bridge, actual "+JSON.stringify(serviceRows));
 const assignedNap=placed.assignments.filter(a=>a.clientId===child&&a.startTime===nap);
 assert.equal(assignedNap.length,1,name+" one supervised client nap");
 assert.equal(assignedNap[0].assignmentType,"BREAK_NAP",name+" connect caregiver's break to real dated nap");
 assert.equal(assignedNap[0].staffId,primary,name+" nap stays with caregiver");
 assert.equal(placed.assignments.filter(a=>a.staffId===primary &&
   ["BREAK","BREAK_NAP","BREAK_SPEECH"].includes(a.assignmentType)).length,1,
   name+" exactly one employee break");
 assert.ok(!placed.assignments.some(a=>a.staffId===primary&&a.startTime===oldBreak&&
   a.assignmentType==="BREAK"),name+" historical plain break must not split current client coverage");
 assert.ok(!auditLinkedNapBreakRules(placed.assignments,[client],roster)
   .some(x=>/missing|multiple|Duplicate|double-booked/i.test(x)),
   name+" no nap/break duplication or missing event");
 console.log("PASS "+name+" grouped template continuity; no isolated reference pins; historical Break/Nap reinterpreted as break hint; actual nap linked to caregiver.");
}
run("IsMo/Olivia example","Olivia","IsMo",
 ["12:00","12:30","13:00","14:00","14:30"],"13:30",
 "OtherTherapist",["12:00","12:30"],["14:00","14:30"],"13:00");
run("JeMa/Danna example","Danna","JeMa",
 ["11:30","12:00","12:30","13:00","13:30","14:30"],"14:00",
 "OtherTherapist",["11:30","12:00"],["13:00","13:30"],"12:30");
