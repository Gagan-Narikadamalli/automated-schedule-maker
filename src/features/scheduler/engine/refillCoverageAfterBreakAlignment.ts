import { repairCoverageMinimally } from "./generateSchedule";
import type { SchedulerAssignment,SchedulerInput } from "./types";

const staffCell=(a:SchedulerAssignment)=>a.staffId+"|"+a.startTime;
const clientCell=(a:SchedulerAssignment)=>a.clientId+"|"+a.startTime;

/**
 * A moved AUTO break can free a half-hour AFTER the coverage planner already
 * ran. Fill those remaining 1:1 gaps without changing any valid existing nap,
 * protected event, break, speech or client/staff assignment.
 *
 * Called only after mandatory-event scheduling; no new breaks are created.
 */
export function refillCoverageAfterBreakAlignment(
  input:SchedulerInput,
  current:SchedulerAssignment[]
):{assignments:SchedulerAssignment[];addedCount:number} {
  const existingStaff=new Set(current.map(staffCell));
  const existingClients=new Set(current.filter(a=>Boolean(a.clientId)).map(clientCell));
  const draft=repairCoverageMinimally({
    ...input,
    existingAssignments:current.map(a=>({...a,locked:true})),
    rules:{...input.rules,humanStyleBlockBalancingEnabled:false}
  },[],{
    allowAutomaticOverrides:false,allowProtectedRelocation:false,
    allowBreakRelocation:false
  });
  const extras:SchedulerAssignment[]=[];
  for(const row of draft.assignments){
    if(row.assignmentType!=="CLIENT_1_TO_1" || !row.clientId)continue;
    const sk=staffCell(row),ck=clientCell(row);
    if(existingStaff.has(sk)||existingClients.has(ck))continue;
    const staff=input.staff.find(s=>s.id===row.staffId);
    const client=input.clients.find(c=>c.id===row.clientId);
    if(!staff||!client||
       input.callOutStaffIds.includes(row.staffId)||
       !staff.availableSlots.includes(row.startTime)||
       !client.requiredSlots.includes(row.startTime)||
       client.staffRelationships[staff.id]==="HARD_RESTRICTION")continue;
    extras.push({...row,locked:false});
    existingStaff.add(sk);existingClients.add(ck);
  }
  return {assignments:[...current,...extras],addedCount:extras.length};
}
