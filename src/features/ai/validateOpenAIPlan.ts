import type { SchedulerInput } from "@/features/scheduler/engine/types";
import { getEndTimeForSlot } from "@/features/scheduler/engine/dateUtils";
type Candidate = {
  staffId: string;
  clientId?: string | null;
  startTime: string;
  assignmentType: "CLIENT_1_TO_1" | "NAP" | "SPEECH" | "BREAK" | "BREAK_NAP" | "BREAK_SPEECH";
};


export function validateOpenAIPlan(input: SchedulerInput, values: Candidate[]) {
  const staff = new Map(input.staff.map(s => [s.id, s]));
  const clients = new Map(input.clients.map(c => [c.id, c]));
  const staffSlots = new Set<string>();
  const clientSlots = new Set<string>();
  const breakCount = new Map<string, number>();
  const allTimes = new Set([...input.staff.flatMap(s => s.availableSlots), ...input.clients.flatMap(c => c.requiredSlots)]);
  const calledOut = new Set(input.callOutStaffIds);
  const problems: string[] = [];
  const allowedTypes = new Set(["CLIENT_1_TO_1", "NAP", "SPEECH", "BREAK", "BREAK_NAP", "BREAK_SPEECH"]);
  for (const [index, row] of values.entries()) {
    if (!row || typeof row !== "object" || !allowedTypes.has(row.assignmentType) ||
        typeof row.staffId !== "string" || typeof row.startTime !== "string" ||
        !/^\d{2}:\d{2}$/.test(row.startTime) || !allTimes.has(row.startTime)) {
      problems.push(`Invalid assignment at index ${index}`);
      continue;
    }
    const member = staff.get(row.staffId);
    if (!member || calledOut.has(row.staffId) || !member.availableSlots.includes(row.startTime)) {
      problems.push(`Staff unavailable at ${row.startTime}: ${row.staffId}`);
      continue;
    }
    const sk = `${row.staffId}|${row.startTime}`;
    if (staffSlots.has(sk)) problems.push(`Staff double-booked: ${sk}`);
    staffSlots.add(sk);
    if (["BREAK", "BREAK_NAP", "BREAK_SPEECH"].includes(row.assignmentType)) {
      if (row.assignmentType === "BREAK" && row.clientId) problems.push(`Break must not have a client: ${sk}`);
      if (row.assignmentType !== "BREAK" && !row.clientId) problems.push(`Linked break missing client: ${sk}`);
      breakCount.set(row.staffId, (breakCount.get(row.staffId) ?? 0) + 1);
      if ((breakCount.get(row.staffId) ?? 0) > 1) problems.push(`Duplicate break: ${row.staffId}`);
      if (row.assignmentType === "BREAK") continue;
    }
    const client = row.clientId ? clients.get(row.clientId) : null;
    const event = ["NAP", "SPEECH", "BREAK_NAP", "BREAK_SPEECH"].includes(row.assignmentType);
    const eventSlots = row.assignmentType.endsWith("NAP") || row.assignmentType === "NAP" ? client?.napSlots : client?.speechSlots;
    if (!client || (event ? !(eventSlots ?? []).includes(row.startTime) : !client.requiredSlots.includes(row.startTime))) {
      problems.push(`Client unavailable/unknown at ${row.startTime}: ${row.clientId ?? "none"}`);
      continue;
    }
    const ck = `${row.clientId}|${row.startTime}`;
    if (clientSlots.has(ck)) problems.push(`Client double-booked: ${ck}`);
    clientSlots.add(ck);
    if (client.staffRelationships[row.staffId] === "HARD_RESTRICTION") {
      problems.push(`Hard relationship restriction: ${row.staffId} / ${row.clientId}`);
    }
    const ss = member.serviceSetting, cs = client.serviceSetting;
    if (ss && cs && ss !== "BOTH" && cs !== "BOTH" && ss !== cs) {
      problems.push(`Service-setting mismatch: ${row.staffId} / ${row.clientId}`);
    }
  }
  for (const member of input.staff) {
    const clientRows=values.filter(a=>a.staffId===member.id&&a.assignmentType==="CLIENT_1_TO_1");
    const hours=clientRows.length*input.rules.slotLengthMinutes/60;
    if(member.maximumDailyHours!==undefined&&hours>member.maximumDailyHours)problems.push(`Daily hour limit: ${member.id}`);
    if(member.maximumWeeklyHours!==undefined&&hours+(member.scheduledWeeklyClientHoursBeforeDate??0)>member.maximumWeeklyHours)problems.push(`Weekly hour limit: ${member.id}`);
  }
  for (const client of input.clients) {
    const naps=values.filter(a=>a.clientId===client.id&&a.assignmentType==="BREAK_NAP");
    if(client.napSlots.length&&naps.length!==1)problems.push(`Exactly one nap required: ${client.id}`);
    for(const time of client.speechSlots)if(!values.some(a=>a.clientId===client.id&&a.startTime===time&&(a.assignmentType==="SPEECH"||a.assignmentType==="BREAK_SPEECH")))problems.push(`Fixed speech missing: ${client.id} ${time}`);
    if(client.maxConsecutiveBlocksWithSameStaff)for(const member of input.staff){
      let previous="",run=0;
      const rows=values.filter(a=>a.clientId===client.id&&a.staffId===member.id&&a.assignmentType==="CLIENT_1_TO_1").sort((a,b)=>a.startTime.localeCompare(b.startTime));
      for(const row of rows){run=previous===row.startTime?run+1:1;previous=getEndTimeForSlot(row.startTime);if(run>client.maxConsecutiveBlocksWithSameStaff)problems.push(`Clinical rotation limit: ${member.id} / ${client.id}`);}
    }
  }
  // AI nap supervision is a single linked staff break, never a second NAP cell.
  for(const row of values) {
    if(row.assignmentType==="NAP")problems.push(`Standalone nap is not a linked staff break: ${row.clientId} at ${row.startTime}`);
  }
  for (const person of input.staff) {
    if (calledOut.has(person.id) || !person.availableSlots.some(time=>time >= "11:00" && time < "14:00")) continue;
    const count = breakCount.get(person.id) ?? 0;
    if (count !== 1) problems.push(`Staff requires exactly one 30-minute break: ${person.id} (${count})`);
  }
  for (const row of values) {
    if (row?.assignmentType?.startsWith("BREAK")) {
      const [h,m] = row.startTime.split(":").map(Number);
      const minute = h * 60 + m;
      if (minute < 660 || minute >= 840) problems.push(`Break outside 11:00-14:00: ${row.staffId}`);
    }
  }
  const missing = input.clients.flatMap(c => c.requiredSlots
    .filter(slot => !clientSlots.has(`${c.id}|${slot}`))
    .map(slot => ({ clientId: c.id, clientCode: c.displayCode, startTime: slot })));
  return { problems, missing, covered: clientSlots.size,
    required: input.clients.reduce((sum,c) => sum + c.requiredSlots.length, 0) };
}
