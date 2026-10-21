import { repairCoverageMinimally } from "./generateSchedule";
import { canAssignStaffToClient } from "./constraints";
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
  const filled=[...current,...extras];
  // Coverage-first fallback for any single 30-minute client slot that the
  // preferred contiguous-block planner could not fit. This uses the SAME
  // hard eligibility validator, and never relocates a saved cell.
  const absent=new Set(input.callOutStaffIds);
  const roleTier=(role:string)=>
    role==="BT"||role==="RBT"?0:role==="INTERN"?1:
      role==="OFFICE_MANAGER"?2:role==="BCBA"?3:4;
  for(const client of input.clients)for(const startTime of [...client.requiredSlots].sort()){
    if(filled.some(a=>a.clientId===client.id&&a.startTime===startTime&&a.assignmentType==="CLIENT_1_TO_1"))
      continue;
    const candidates=input.staff.filter(staff=>
      canAssignStaffToClient({
        staffMember:staff,client,startTime,assignments:filled,
        callOutStaffIds:absent,rules:input.rules,
        allowSameDayPairRepeat:true,allowCoverageLimitException:true
      }).allowed);
    candidates.sort((a,b)=>{
      const score=(person:typeof a)=>{
        const priorMinutes=Number(startTime.slice(0,2))*60+Number(startTime.slice(3,5))-input.rules.slotLengthMinutes;
        const prior=String(Math.floor(priorMinutes/60)).padStart(2,"0")+":"+
          String(priorMinutes%60).padStart(2,"0");
        const previous=filled.some(row=>row.staffId===person.id&&row.clientId===client.id&&
          row.startTime===prior&&row.assignmentType==="CLIENT_1_TO_1");
        return (previous?-1000:0)+(client.staffRelationships[person.id]==="PREFERRED"?-200:0)+
          (client.teamId&&person.teamId===client.teamId?-50:0)+roleTier(person.role)*20;
      };
      return score(a)-score(b)||a.name.localeCompare(b.name);
    });
    const chosen=candidates[0];
    if(!chosen)continue;
    filled.push({
      id:`post-break-${client.id}-${startTime}-${chosen.id}`,
      clientId:client.id,staffId:chosen.id,startTime,
      assignmentType:"CLIENT_1_TO_1",source:"AUTO",locked:false,
      note:"Coverage-first 30-minute placement after nap/break alignment freed this staff slot."
    });
  }
  return {assignments:filled,addedCount:filled.length-current.length};
}
