import type { SchedulerAssignment, SchedulerClient } from "./types";

/** Post-generation safety check shared by Auto Day and Auto Week.
 * Every BREAK_NAP represents one staff break and one client nap.
 * A client cannot nap multiple times or be assigned two supervisors at once.
 */
export function auditLinkedNapBreakRules(
  assignments: SchedulerAssignment[],
  clients: SchedulerClient[]
): string[] {
  const problems: string[] = [];
  const breaks=new Map<string,number>();
  const naps=new Map<string,number>();
  const eventSlots=new Set(clients.flatMap(c=>c.napSlots.map(time=>`${c.id}|${time}`)));
  const occupied=new Set<string>();
  for(const a of assignments) {
    if(a.assignmentType==="NAP" && a.source==="AUTO")
      problems.push(`Standalone automatic NAP: ${a.clientId??"unknown"} at ${a.startTime}; use a single BREAK_NAP instead`);
    if(!["BREAK","BREAK_NAP","BREAK_SPEECH"].includes(a.assignmentType))continue;
    const count=(breaks.get(a.staffId)??0)+1;
    breaks.set(a.staffId,count);
    if(count>1)problems.push(`Staff ${a.staffId} was assigned multiple breaks`);
    if(a.assignmentType!=="BREAK_NAP")continue;
    if(!a.clientId) {
      problems.push(`BREAK_NAP missing client for staff ${a.staffId}`);
      continue;
    }
    const slot=`${a.clientId}|${a.startTime}`;
    if(!eventSlots.has(slot))problems.push(`BREAK_NAP outside selected nap session: ${slot}`);
    if(occupied.has(slot))problems.push(`Duplicate client nap supervision: ${slot}`);
    occupied.add(slot);
    const n=(naps.get(a.clientId)??0)+1;
    naps.set(a.clientId,n);
    if(n>1)problems.push(`Client ${a.clientId} has multiple naps`);
  }
  return problems;
}
