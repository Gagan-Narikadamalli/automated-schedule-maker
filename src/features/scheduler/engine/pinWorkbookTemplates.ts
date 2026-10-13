import type { SchedulerAssignment, SchedulerInput } from "./types";

export type TemplatePinRejection = {
  staffId: string;
  clientId?: string;
  startTime: string;
  reason: string;
};

export function pinWorkbookTemplates(input: SchedulerInput): {
  pinned: SchedulerAssignment[];
  rejected: TemplatePinRejection[];
  primaryCount: number;
  secondaryCount: number;
} {
  const staff = new Map(input.staff.map(item => [item.id, item]));
  const clients = new Map(input.clients.map(item => [item.id, item]));
  const calledOut = new Set(input.callOutStaffIds);
  const pinned: SchedulerAssignment[] = [];
  const rejected: TemplatePinRejection[] = [];
  const staffSlots = new Set<string>();
  const clientSlots = new Set<string>();
  const staffWithBreak = new Set<string>();
  let primaryCount = 0;
  let secondaryCount = 0;
  const primaryClientIds = new Set(input.referenceAssignments
    .filter(item => item.source === "TEMPLATE" &&
      item.note?.startsWith("Priority 1 saved workbook template:") &&
      item.assignmentType === "CLIENT_1_TO_1" && Boolean(item.clientId))
    .map(item => item.clientId));

  // The references are already provided in layer order by the database
  // builder: first exact-date workbook, then previous-week workbook.
  // Keep that order across the whole day, not merely within each time slot.
  const references = input.referenceAssignments.filter(item =>
    item.source === "TEMPLATE" &&
    (item.note?.startsWith("Priority 1 saved workbook template:") ||
     item.note?.startsWith("Priority 2 saved workbook template:"))
  );

  const shift=(time:string,delta:number)=>{
    const [h,m]=time.split(":").map(Number), n=h*60+m+delta;
    return n>=0&&n<1440?`${String(Math.floor(n/60)).padStart(2,"0")}:${String(n%60).padStart(2,"0")}`:"";
  };
  for (const original of references) {
    // Old templates sometimes store "Break/Nap" without a client ID.
    // Resolve it only from the immediately preceding or following client on
    // the SAME staff column, and only when that client's nap event is valid.
    let reference=original;
    if(original.assignmentType==="BREAK_NAP"&&!original.clientId){
      const neighbors=references.filter(a=>a.staffId===original.staffId &&
        a.assignmentType==="CLIENT_1_TO_1"&&a.clientId &&
        (a.startTime===shift(original.startTime,-30)||a.startTime===shift(original.startTime,30)));
      const eligible=[...new Set(neighbors.map(a=>a.clientId as string))]
        .filter(id=>clients.get(id)?.napSlots.includes(original.startTime));
      if(eligible.length===1)reference={...original,clientId:eligible[0]};
      else if(eligible.length===0) {
        reference={...original,assignmentType:"BREAK",clientId:undefined};
        rejected.push({staffId:original.staffId,startTime:original.startTime,
          reason:"Unlabeled Break/Nap has no adjacent client with a saved nap; kept as a plain staff break"});
      } else {
        // No reliable tie-breaker: do not attribute a client nap to the wrong child.
        reference={...original,assignmentType:"BREAK",clientId:undefined};
        rejected.push({staffId:original.staffId,startTime:original.startTime,
          reason:"Unlabeled Break/Nap matches two adjacent napping clients; kept as a plain staff break"});
      }
    }
    const member = staff.get(reference.staffId);
    const client = reference.clientId ? clients.get(reference.clientId) : null;
    const isBreak = ["BREAK", "BREAK_NAP", "BREAK_SPEECH"].includes(reference.assignmentType);
    const secondary = reference.note?.startsWith("Priority 2") ?? false;
    const staffKey = reference.staffId + "|" + reference.startTime;
    const clientKey = reference.clientId + "|" + reference.startTime;
    let reason = "";
    if (!member || !member.availableSlots.includes(reference.startTime) || calledOut.has(reference.staffId)) {
      reason = "Staff is unavailable for this workbook block";
    } else if (isBreak && staffWithBreak.has(reference.staffId)) {
      reason = "Staff already has a higher-priority workbook break";
    } else if (secondary && isBreak) {
      reason = "Secondary workbook breaks cannot displace or duplicate primary-week coverage";
    } else if (staffSlots.has(staffKey)) {
      reason = "A higher-priority workbook block already occupies this staff/time cell";
    } else if (reference.assignmentType === "CLIENT_1_TO_1") {
      if (reference.note?.startsWith("Priority 2") && primaryClientIds.has(reference.clientId)) {
        reason = "Client already appears in the primary week template";
      } else if (!client || !client.requiredSlots.includes(reference.startTime)) {
        reason = "Client is absent or outside required service time";
      } else if (clientSlots.has(clientKey)) {
        reason = "A higher-priority workbook block already covers this client/time cell";
      } else if (client.staffRelationships[reference.staffId] === "HARD_RESTRICTION") {
        reason = "Hard staff/client restriction";
      } else if (member.serviceSetting && client.serviceSetting &&
        member.serviceSetting !== "BOTH" && client.serviceSetting !== "BOTH" &&
        member.serviceSetting !== client.serviceSetting) {
        reason = "Incompatible service setting";
      }
    } else if (reference.assignmentType === "BREAK_NAP" || reference.assignmentType === "BREAK_SPEECH") {
      const eventSlots = reference.assignmentType === "BREAK_NAP" ? client?.napSlots : client?.speechSlots;
      if (!client || !eventSlots?.includes(reference.startTime)) {
        reason = "Linked template break does not match a saved client nap/speech event";
      } else if (clientSlots.has(clientKey)) {
        reason = "Another template assignment already supervises this client event";
      } else if (client.staffRelationships[reference.staffId] === "HARD_RESTRICTION") {
        reason = "Hard staff/client restriction for linked event";
      } else if (member.serviceSetting && client.serviceSetting &&
        member.serviceSetting !== "BOTH" && client.serviceSetting !== "BOTH" &&
        member.serviceSetting !== client.serviceSetting) {
        reason = "Incompatible service setting for linked event";
      }
    } else if (!["BREAK", "BREAK_NAP", "BREAK_SPEECH"].includes(reference.assignmentType)) {
      reason = "Unsupported workbook block type";
    }
    if (reason) {
      rejected.push({staffId:reference.staffId, clientId:reference.clientId,
        startTime:reference.startTime, reason});
      continue;
    }

    pinned.push({
      ...reference,
      id: "pinned-workbook-" + pinned.length,
      locked: true,
      note: reference.note,
      source: "TEMPLATE",
    });
    staffSlots.add(staffKey);
    if (isBreak) staffWithBreak.add(reference.staffId);
    if (reference.clientId) clientSlots.add(clientKey);
    if (reference.note?.startsWith("Priority 1")) primaryCount++;
    else secondaryCount++;
  }

  return {pinned, rejected, primaryCount, secondaryCount};
}
