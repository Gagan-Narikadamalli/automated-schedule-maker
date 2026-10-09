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
  let primaryCount = 0;
  let secondaryCount = 0;

  // The references are already provided in layer order by the database
  // builder: first exact-date workbook, then previous-week workbook.
  // Keep that order across the whole day, not merely within each time slot.
  const references = input.referenceAssignments.filter(item =>
    item.source === "TEMPLATE" &&
    (item.note?.startsWith("Priority 1 saved workbook template:") ||
     item.note?.startsWith("Priority 2 saved workbook template:"))
  );

  for (const reference of references) {
    const member = staff.get(reference.staffId);
    const client = reference.clientId ? clients.get(reference.clientId) : null;
    const staffKey = reference.staffId + "|" + reference.startTime;
    const clientKey = reference.clientId + "|" + reference.startTime;
    let reason = "";
    if (!member || !member.availableSlots.includes(reference.startTime) || calledOut.has(reference.staffId)) {
      reason = "Staff is unavailable for this workbook block";
    } else if (staffSlots.has(staffKey)) {
      reason = "A higher-priority workbook block already occupies this staff/time cell";
    } else if (reference.assignmentType === "CLIENT_1_TO_1") {
      if (!client || !client.requiredSlots.includes(reference.startTime)) {
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
    if (reference.assignmentType === "CLIENT_1_TO_1") clientSlots.add(clientKey);
    if (reference.note?.startsWith("Priority 1")) primaryCount++;
    else secondaryCount++;
  }

  return {pinned, rejected, primaryCount, secondaryCount};
}
