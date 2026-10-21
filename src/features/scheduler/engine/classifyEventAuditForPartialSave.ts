import type { SchedulerAssignment,SchedulerClient,SchedulerStaff } from "./types";

export type UnplacedEvent={
  eventKind:"NAP"|"BREAK"|"SPEECH";
  clientId?:string;
  originalStaffId?:string;
  originalStartTime:string;
  eventWindowStart?:string;
  eventWindowEnd?:string;
  displayText:string;
  reason:string;
};
type Classification={conflicts:string[];unresolvedWarnings:string[];unplacedEvents:UnplacedEvent[]};

/**
 * Missing obligations may remain unplaced, while unsafe assignments must NOT
 * be saved. A child's nap and an employee's break are independent obligations.
 */
export function classifyEventAuditForPartialSave(args:{
  issues:string[];clients:SchedulerClient[];staff:SchedulerStaff[];
  assignments:SchedulerAssignment[];breakWindowStart:string;breakWindowEnd:string;
}):Classification {
  const {issues,clients,staff,assignments,breakWindowStart,breakWindowEnd}=args;
  const byClient=new Map(clients.map(c=>[c.id,c]));
  const byStaff=new Map(staff.map(s=>[s.id,s]));
  const conflicts:string[]=[],unresolvedWarnings:string[]=[],unplacedEvents:UnplacedEvent[]=[];
  for(const issue of issues){
    const nap=/^Client (.+) missing (?:required 30-minute nap|scheduled Break\/Nap) at (\d{2}:\d{2})$/.exec(issue);
    if(nap){
      const client=byClient.get(nap[1]);
      if(!client || !client.napSlots.includes(nap[2])){conflicts.push(issue);continue;}
      unplacedEvents.push({
        eventKind:"NAP",clientId:client.id,originalStartTime:nap[2],
        displayText:client.displayCode+" — Client Nap",
        reason:client.displayCode+" has not received the required supervised nap at "+
          nap[2]+". Client nap is separate from staff break. Assign an eligible caregiver; optionally link their break."
      });
      unresolvedWarnings.push(issue);continue;
    }
    const br=/^Staff (.+) missing required 30-minute break$/.exec(issue);
    if(br){
      const member=byStaff.get(br[1]);
      if(!member){conflicts.push(issue);continue;}
      unplacedEvents.push({
        eventKind:"BREAK",originalStaffId:member.id,
        originalStartTime:breakWindowStart,
        eventWindowStart:breakWindowStart,eventWindowEnd:breakWindowEnd,
        displayText:member.name+" — Staff Break",
        reason:member.name+" is missing a 30-minute staff break. It may start "+
          breakWindowStart+"–"+breakWindowEnd+" inclusive, if eligible. A client nap only counts as a staff break when explicitly linked."
      });
      unresolvedWarnings.push(issue);continue;
    }
    conflicts.push(issue);
  }
  // Fixed speech is an independent mandatory client appointment.
  for(const client of clients)for(const time of client.speechSlots){
    if(assignments.some(a=>a.clientId===client.id&&a.startTime===time&&
      ["SPEECH","BREAK_SPEECH"].includes(a.assignmentType)))continue;
    unplacedEvents.push({
      eventKind:"SPEECH",clientId:client.id,originalStartTime:time,
      displayText:client.displayCode+" — Speech",
      reason:client.displayCode+" has a 30-minute speech event at "+time+
        " but no valid staff assignment was saved."
    });
    unresolvedWarnings.push("Client "+client.id+" missing required speech at "+time);
  }
  return {conflicts,unresolvedWarnings,unplacedEvents};
}

/** Never treat double-booking, a call-out, or a restricted pairing as a safe partial schedule. */
export function auditPartialAssignmentSafety(args:{
  assignments:SchedulerAssignment[];clients:SchedulerClient[];staff:SchedulerStaff[];
  calledOutStaffIds:string[];
}):string[]{
  const {assignments,clients,staff,calledOutStaffIds}=args;
  const people=new Map(staff.map(s=>[s.id,s]));
  const kids=new Map(clients.map(c=>[c.id,c]));
  const out=new Set(calledOutStaffIds),staffCells=new Set<string>(),clientCells=new Set<string>();
  const problems:string[]=[];
  for(const row of assignments){
    if(["OPEN","UNAVAILABLE"].includes(row.assignmentType))continue;
    const sk=row.staffId+"|"+row.startTime;
    if(staffCells.has(sk))problems.push("Staff double-booked: "+sk);
    staffCells.add(sk);
    if(row.clientId){
      const ck=row.clientId+"|"+row.startTime;
      if(clientCells.has(ck))problems.push("Client double-booked: "+ck);
      clientCells.add(ck);
    }
    const person=people.get(row.staffId);
    if(!person||out.has(row.staffId)||!person.availableSlots.includes(row.startTime)){
      problems.push("Staff is unavailable or called out: "+sk);
      continue;
    }
    if(row.assignmentType==="BREAK"){
      if(row.clientId)problems.push("Plain staff break assigned to client: "+sk);
      continue;
    }
    const client=row.clientId ? kids.get(row.clientId) : undefined;
    if(!client){problems.push("Assignment without eligible client: "+sk);continue;}
    const slots=row.assignmentType==="CLIENT_1_TO_1" ? client.requiredSlots :
      ["NAP","BREAK_NAP"].includes(row.assignmentType) ? client.napSlots : client.speechSlots;
    if(!slots.includes(row.startTime))
      problems.push("Assignment outside required client event/attendance: "+row.clientId+" "+row.startTime);
    if(client.staffRelationships[person.id]==="HARD_RESTRICTION")
      problems.push("Restricted therapist-client pairing: "+person.id+" "+client.id);
    if(client.serviceSetting&&person.serviceSetting&&
      client.serviceSetting!=="BOTH"&&person.serviceSetting!=="BOTH"&&
      client.serviceSetting!==person.serviceSetting)
      problems.push("Service setting mismatch: "+person.id+" "+client.id);
  }
  return [...new Set(problems)];
}
