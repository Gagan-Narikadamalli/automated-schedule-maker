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
  // The explicit staff cell is authoritative. Merely recording a client's nap
  // must never force an employee to stop an existing 1:1 appointment.
  const unique = [...new Map(naps.map(n => [`${n.clientId}|${n.startTime}`, n])).values()];
  const keys = new Set(unique.map(n => `${n.clientId}|${n.startTime}`));
  const warnings: string[] = [];
  const seenStaff = new Set<string>();
  const seenCoverage = new Set<string>();
  for (const item of assignments) {
    const staffKey = `${item.staffId}|${item.startTime}`;
    if (seenStaff.has(staffKey)) warnings.push(`More than one block assigned to staff ${item.staffId} at ${item.startTime}.`);
    seenStaff.add(staffKey);
    if (item.assignmentType === "CLIENT_1_TO_1" && item.clientId) {
      const clientKey = `${item.clientId}|${item.startTime}`;
      if (seenCoverage.has(clientKey)) warnings.push(`Client ${item.clientId} has duplicate 1:1 coverage at ${item.startTime}.`);
      seenCoverage.add(clientKey);
    }
    if (item.assignmentType === "BREAK_NAP" && item.clientId) {
      const key = `${item.clientId}|${item.startTime}`;
      if (!keys.has(key)) {
        unique.push({ clientId: item.clientId, startTime: item.startTime });
        keys.add(key);
      }
    }
  }
  for (const nap of unique) {
    if (seenCoverage.has(`${nap.clientId}|${nap.startTime}`)) {
      warnings.push(`Client ${nap.clientId} has 1:1 coverage and a nap at ${nap.startTime}. Adjust the client's nap time or coverage first.`);
    }
  }
  return { assignments: assignments.map(a => ({...a})), naps: unique, warnings };
}
