import type { SchedulerAssignment, SchedulerClient, SchedulerStaff } from "./types";

/** Post-generation safety check shared by Auto Day and Auto Week.
 * Client NAP completes only the client's nap. Staff BREAK completes only the staff break.
 * BREAK_NAP satisfies BOTH when a qualified caregiver supervises the nap.
 * A client cannot nap multiple times or be assigned two supervisors at once.
 */
export function auditLinkedNapBreakRules(
  assignments: SchedulerAssignment[],
  clients: SchedulerClient[],
  activeStaff: SchedulerStaff[] = [],
  breakWindowStart = "11:00",
  breakWindowEnd = "14:00"
): string[] {
  const problems: string[] = [];
  const breaks=new Map<string,number>();
  const naps=new Map<string,number>();
  const eventSlots=new Set(clients.flatMap(c=>c.napSlots.map(time=>`${c.id}|${time}`)));
  const speechSlots=new Set(clients.flatMap(c=>c.speechSlots.map(time=>`${c.id}|${time}`)));
  const occupied=new Set<string>();
  const clientAssignments=new Map<string,number>();
  const staffAssignments=new Map<string,number>();
  for(const a of assignments) {
    const staffKey=`${a.staffId}|${a.startTime}`;
    staffAssignments.set(staffKey,(staffAssignments.get(staffKey)??0)+1);
    if(a.clientId) {
      const clientKey=`${a.clientId}|${a.startTime}`;
      clientAssignments.set(clientKey,(clientAssignments.get(clientKey)??0)+1);
    }
    // Staff breaks and client naps are independently audited.
    if(["BREAK","BREAK_NAP","BREAK_SPEECH"].includes(a.assignmentType)) {
      const count=(breaks.get(a.staffId)??0)+1;
      breaks.set(a.staffId,count);
      if(count>1)problems.push(`Staff ${a.staffId} was assigned multiple breaks`);
      if(a.startTime<breakWindowStart||a.startTime>breakWindowEnd)
        problems.push(`Staff ${a.staffId} break starts outside the permitted window at ${a.startTime}`);
    }
    if(a.assignmentType==="BREAK_SPEECH") {
      if(!a.clientId)problems.push(`BREAK_SPEECH missing client for staff ${a.staffId}`);
      else if(!speechSlots.has(`${a.clientId}|${a.startTime}`))
        problems.push(`BREAK_SPEECH outside selected speech session: ${a.clientId}|${a.startTime}`);
    }
    if(!["NAP","BREAK_NAP"].includes(a.assignmentType))continue;
    if(!a.clientId){
      problems.push(`${a.assignmentType} missing client for staff ${a.staffId}`);
      continue;
    }
    const slot=`${a.clientId}|${a.startTime}`;
    if(!eventSlots.has(slot))problems.push(`${a.assignmentType} outside selected nap session: ${slot}`);
    if(occupied.has(slot))problems.push(`Duplicate client nap supervision: ${slot}`);
    occupied.add(slot);
    const count=(naps.get(a.clientId)??0)+1;
    naps.set(a.clientId,count);
    if(count>1)problems.push(`Client ${a.clientId} has multiple naps`);
  }
  for(const client of clients)
    for(const time of new Set(client.napSlots))
      if(!occupied.has(`${client.id}|${time}`))
        problems.push(`Client ${client.id} missing required 30-minute nap at ${time}`);
  for(const person of activeStaff) {
    if(!person.availableSlots.some(t=>t>=breakWindowStart&&t<=breakWindowEnd))continue;
    if(!breaks.has(person.id))
      problems.push(`Staff ${person.id} missing required 30-minute break`);
  }
  for(const [key,count] of staffAssignments)if(count>1)problems.push(`Staff double-booked: ${key}`);
  for(const [key,count] of clientAssignments)if(count>1)problems.push(`Client double-booked: ${key}`);
  return problems;
}
