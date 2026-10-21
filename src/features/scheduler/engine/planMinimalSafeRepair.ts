import { auditFinalCoverage } from "./auditFinalCoverage";
import { auditLinkedNapBreakRules } from "./auditLinkedNapBreakRules";
import { repairCoverageMinimally } from "./generateSchedule";
import { placeStaffBreaksAfterCoverage, type PostCoverageBreakRules } from "./placeStaffBreaks";
import { enrichBreakAssignmentsWithFixedEvents } from "./reserveBreaks";
import type { SchedulerAssignment, SchedulerInput, SchedulerResult } from "./types";

export type Disruption = { staffId: string; startTime: string; endTime: string };

const isBreak = (a:SchedulerAssignment)=>
  a.assignmentType==="BREAK" || a.assignmentType==="BREAK_NAP" || a.assignmentType==="BREAK_SPEECH";
const clientKey=(a:SchedulerAssignment)=>a.clientId ? a.clientId+"|"+a.startTime : "";
const staffKey=(a:SchedulerAssignment)=>a.staffId+"|"+a.startTime;

function originalIsEligible(
  assignment: SchedulerAssignment,
  input:SchedulerInput,
  disruptions:Disruption[]
): boolean {
  const staff=input.staff.find(s=>s.id===assignment.staffId);
  if(!staff || !staff.availableSlots.includes(assignment.startTime) ||
     input.callOutStaffIds.includes(assignment.staffId) ||
     disruptions.some(d=>d.staffId===assignment.staffId &&
       assignment.startTime>=d.startTime && assignment.startTime<d.endTime)) return false;
  const type=assignment.assignmentType;
  if(type==="BREAK")return true;
  if(type==="UNAVAILABLE" || type==="OPEN")return true;
  const client=assignment.clientId ?
    input.clients.find(c=>c.id===assignment.clientId) : undefined;
  if(!client || client.staffRelationships[staff.id]==="HARD_RESTRICTION" ||
    (client.serviceSetting && staff.serviceSetting &&
     client.serviceSetting!=="BOTH" && staff.serviceSetting!=="BOTH" &&
     client.serviceSetting!==staff.serviceSetting)) return false;
  if(type==="CLIENT_1_TO_1") return client.requiredSlots.includes(assignment.startTime);
  if(type==="NAP" || type==="BREAK_NAP")return client.napSlots.includes(assignment.startTime);
  if(type==="SPEECH" || type==="BREAK_SPEECH")return client.speechSlots.includes(assignment.startTime);
  return false;
}

/** Compare persisted fields, not only IDs: conversion BREAK -> BREAK_NAP is a real update. */
export function repairAssignmentChanged(a:SchedulerAssignment,b:SchedulerAssignment):boolean {
  return a.staffId!==b.staffId || a.clientId!==b.clientId ||
    a.startTime!==b.startTime || a.assignmentType!==b.assignmentType ||
    a.locked!==b.locked || a.source!==b.source || (a.note??"")!==(b.note??"");
}
export type SafeRepairPlan = {
  result: SchedulerResult;
  removedOriginals: SchedulerAssignment[];
  addedOrUpdated: SchedulerAssignment[];
  validationErrors: string[];
  breakRecalculated: boolean;
  unplacedBreakStaffIds: string[];
  reliefSwapCount: number;
  breakCount: number;
  preservedOriginalCount: number;
};

/**
 * Repair and Minimal Fix share Auto Generate's placement rules, but never
 * reconstruct already valid client cells from template/history.
 * The returned plan is NOT persisted unless validationErrors is empty.
 */
export function planMinimalSafeRepair(args:{
  input:SchedulerInput;
  rules:PostCoverageBreakRules;
  disruptions?:Disruption[];
  priorityRequirements?:Array<{clientId:string;startTime:string}>;
}):SafeRepairPlan {
  const {input,rules}=args;
  const disruptions=args.disruptions??[];
  const effectiveInput:SchedulerInput={
    ...input,
    staff:input.staff.map(person=>({
      ...person,
      availableSlots:person.availableSlots.filter(time=>!disruptions.some(d=>
        d.staffId===person.id && time>=d.startTime && time<d.endTime))
    }))
  };
  const previous=input.existingAssignments;
  // Prioritize manager decisions when two older persisted rows conflict.
  const ordered=[...previous].sort((a,b)=>
    Number(b.source==="MANUAL")-Number(a.source==="MANUAL") ||
    Number(b.locked)-Number(a.locked) ||
    a.startTime.localeCompare(b.startTime));
  const kept:SchedulerAssignment[]=[];
  const occupiedStaff=new Set<string>();
  const occupiedClient=new Set<string>();
  for(const row of ordered) {
    if(!originalIsEligible(row,effectiveInput,disruptions))continue;
    const sk=staffKey(row),ck=clientKey(row);
    if(occupiedStaff.has(sk) || (ck && occupiedClient.has(ck))) continue;
    kept.push({...row});
    occupiedStaff.add(sk);
    if(ck)occupiedClient.add(ck);
  }
  const allowedIds=new Set(kept.map(x=>x.id));
  // The "keep breaks" candidate preserves existing valid breaks. The second
  // candidate may move only unprotected AUTO breaks if that lets coverage
  // improve while still finding another legal 30-minute break.
  function buildCandidate(recalculateAutoBreaks:boolean) {
    const preserved=recalculateAutoBreaks
      ? kept.filter(a=>!(isBreak(a)&&a.source==="AUTO"&&!a.locked))
      : kept;
    const preparedInput:SchedulerInput={
      ...effectiveInput,
      existingAssignments:preserved.map(a=>({...a,locked:true}))
    };
    const coverage=repairCoverageMinimally(
      preparedInput,args.priorityRequirements??[],
      {allowAutomaticOverrides:false,allowProtectedRelocation:false,allowBreakRelocation:false}
    );
    const breaks=placeStaffBreaksAfterCoverage({
      staff:effectiveInput.staff,clients:effectiveInput.clients,
      assignments:coverage.assignments,
      referenceAssignments:input.referenceAssignments,
      callOutStaffIds:effectiveInput.callOutStaffIds,
      rules,schedulerRules:{
        ...effectiveInput.rules,humanStyleBlockBalancingEnabled:false
      },
      allowProtectedRelief:false
    });
    const assignments=enrichBreakAssignmentsWithFixedEvents(
      breaks.assignments,effectiveInput.clients,rules.slotLengthMinutes
    );
    const issues=auditLinkedNapBreakRules(
      assignments,effectiveInput.clients,
      effectiveInput.staff.filter(person=>
        !effectiveInput.callOutStaffIds.includes(person.id)),
      rules.breakWindowStart,rules.breakWindowEnd
    );
    const expectedSpeech=new Set(effectiveInput.clients.flatMap(client=>
      client.speechSlots.map(slot=>client.id+"|"+slot)));
    const observedSpeech=new Set(assignments.filter(a=>
      Boolean(a.clientId)&&["SPEECH","BREAK_SPEECH"].includes(a.assignmentType))
      .map(a=>a.clientId+"|"+a.startTime));
    for(const key of expectedSpeech)
      if(!observedSpeech.has(key))issues.push("Missing mandatory speech: "+key);
    for(const a of assignments) {
      if(!originalIsEligible(a,effectiveInput,disruptions))
        issues.push(`Invalid ${a.assignmentType} for staff ${a.staffId} at ${a.startTime}`);
      if(isBreak(a)&&
         (a.startTime<rules.breakWindowStart || a.startTime>rules.breakWindowEnd))
        issues.push(`Staff break outside allowed start window: ${a.staffId} at ${a.startTime}`);
    }
    const finalCoverage=auditFinalCoverage(
      effectiveInput.clients,assignments,coverage.metrics,
      rules.slotLengthMinutes,coverage.uncoveredRequirements
    );
    const previousById=new Map(previous.map(a=>[a.id,a]));
    const preserves=assignments.reduce((total,a)=>{
      const prev=previousById.get(a.id);
      if(!prev)return total;
      const normalized={...a,locked:prev.locked};
      return total+Number(!repairAssignmentChanged(prev,normalized));
    },0);
    return {assignments,coverage,issues:[...new Set(issues)],
      breakPlan:breaks,finalCoverage,preserves,recalculateAutoBreaks};
  }
  let candidate=buildCandidate(false);
  // Try the alternate *only* when a valid first pass leaves coverage missing,
  // or when a mandatory event/break could not be safely placed.
  if (candidate.issues.length || candidate.finalCoverage.metrics.uncoveredClientSlots>0) {
    const alternate=buildCandidate(true);
    const safe1=candidate.issues.length===0,safe2=alternate.issues.length===0;
    const better=safe2&&!safe1 ||
      (safe1===safe2&&
        (alternate.issues.length<candidate.issues.length ||
         (alternate.issues.length===candidate.issues.length&&
           (alternate.finalCoverage.metrics.coveredClientSlots>
              candidate.finalCoverage.metrics.coveredClientSlots ||
             (alternate.finalCoverage.metrics.coveredClientSlots===
                candidate.finalCoverage.metrics.coveredClientSlots &&
                alternate.preserves>candidate.preserves)))));
    if(better) candidate=alternate;
  }
  const breakRecalculated=candidate.recalculateAutoBreaks;
  const originalById=new Map(previous.map(a=>[a.id,a]));
  const keptIds=new Set<string>();
  const addedOrUpdated:SchedulerAssignment[]=[];
  for(const a of candidate.assignments){
    const prior=originalById.get(a.id);
    // Temporary internal locks must not turn retained AUTO cells into
    // permanently protected/manual assignments.
    const normalized=prior && allowedIds.has(a.id) && a.locked && prior.locked!==a.locked
      ? {...a,locked:prior.locked} : a;
    if(prior && !repairAssignmentChanged(prior,normalized)) {
      keptIds.add(a.id);
    }else{
      addedOrUpdated.push(normalized);
    }
  }
  const removedOriginals=previous.filter(a=>!keptIds.has(a.id));
  const normalizedAssignments=candidate.assignments.map(a=>{
    const prior=originalById.get(a.id);
    return prior&&a.locked!==prior.locked ? {...a,locked:prior.locked} : a;
  });
  const result:SchedulerResult={
    ...candidate.coverage,assignments:normalizedAssignments,
    metrics:candidate.finalCoverage.metrics,
    uncoveredRequirements:candidate.finalCoverage.uncoveredRequirements
  };
  return {
    result,removedOriginals,addedOrUpdated,
    validationErrors:candidate.issues,
    breakRecalculated,
    unplacedBreakStaffIds:candidate.breakPlan.unplacedBreakStaffIds,
    reliefSwapCount:candidate.breakPlan.reliefSwapCount,
    breakCount:normalizedAssignments.filter(isBreak).length,
    preservedOriginalCount:keptIds.size
  };
}
