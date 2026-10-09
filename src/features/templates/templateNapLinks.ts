export type TemplateSlot = { staffId: string; clientId: string | null; startTime: string; endTime: string; assignmentType: string; locked: boolean };
export type ClientNapSlot = { clientId: string; startTime: string };

export function shiftSlot(time: string, offset: number): string {
  const [h, m] = time.split(":").map(Number);
  const mins = h * 60 + m + offset;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

export function pairedStaff(assignments: TemplateSlot[], clientId: string, time: string, naps: ClientNapSlot[] = []): string | null {
  const ownNaps = new Set(naps.filter(n => n.clientId === clientId).map(n => n.startTime));
  let first = time;
  let last = time;
  while (ownNaps.has(shiftSlot(first, -30))) first = shiftSlot(first, -30);
  while (ownNaps.has(shiftSlot(last, 30))) last = shiftSlot(last, 30);
  const near = [shiftSlot(first, -30), shiftSlot(last, 30)];
  for (const nearTime of near) {
    const pairing = assignments.find(item => item.assignmentType === "CLIENT_1_TO_1" && item.clientId === clientId && item.startTime === nearTime);
    if (pairing) return pairing.staffId;
  }
  return null;
}

export function synchronizeTemplateNaps(assignments: TemplateSlot[], naps: ClientNapSlot[]) {
  const unique = [...new Map(naps.map(n => [`${n.clientId}|${n.startTime}`, n])).values()];
  const napKeys = new Set(unique.map(n => `${n.clientId}|${n.startTime}`));
  const linked = assignments.filter(a => a.assignmentType === "BREAK_NAP" && a.clientId);
  for (const a of linked) {
    if (!napKeys.has(`${a.clientId}|${a.startTime}`)) {
      unique.push({ clientId: a.clientId as string, startTime: a.startTime });
      napKeys.add(`${a.clientId}|${a.startTime}`);
    }
  }
  const normalized = assignments.filter(a =>
    !(a.assignmentType === "BREAK_NAP" && a.clientId && !napKeys.has(`${a.clientId}|${a.startTime}`))
  );
  const warnings: string[] = [];
  for (const nap of unique) {
    const staffId = linked.find(a => a.clientId === nap.clientId && a.startTime === nap.startTime)?.staffId ??
      pairedStaff(assignments, nap.clientId, nap.startTime, unique);
    if (!staffId) {
      warnings.push(`No adjacent staff/client pairing for client ${nap.clientId} at ${nap.startTime}; the nap is saved but no staff break can be inferred.`);
      continue;
    }
    const occupant = normalized.find(a => a.staffId === staffId && a.startTime === nap.startTime);
    if (occupant) {
      if (occupant.assignmentType !== "BREAK_NAP" || occupant.clientId !== nap.clientId) {
        warnings.push(`Staff ${staffId} at ${nap.startTime} is occupied by ${occupant.assignmentType}; their break was not overwritten for client ${nap.clientId}.`);
      }
      continue;
    }
    normalized.push({ staffId, clientId: nap.clientId, startTime: nap.startTime, endTime: shiftSlot(nap.startTime, 30), assignmentType: "BREAK_NAP", locked: false });
  }
  for (const a of normalized.filter(a => a.assignmentType === "CLIENT_1_TO_1" && a.clientId)) {
    if (napKeys.has(`${a.clientId}|${a.startTime}`)) warnings.push(`Client ${a.clientId} has both 1:1 coverage and nap at ${a.startTime}.`);
  }
  return { assignments: normalized, naps: unique, warnings };
}
