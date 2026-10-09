/** Rank exact weekday templates against the staff and clients present on the target date.
 * Only genuinely schedulable 1:1 cells count toward a match; break preferences
 * are evaluated second. Stable _id ordering prevents arbitrary selection ties.
 */
export type CandidateTemplate = {
  _id?: unknown;
  name?: unknown;
  learningOnly?: boolean;
  assignments?: Array<{ staffId?: unknown; clientId?: unknown; startTime?: unknown; assignmentType?: unknown }>;
  clientNapSlots?: Array<{ clientId?: unknown; startTime?: unknown }>;
};
export type AvailableStaff = { id: string; availableSlots: string[] };
export type AvailableClient = { id: string; requiredSlots: string[] };
export type TemplateMatch = {
  matchingBlocks: number;
  matchingStaff: number;
  matchingClients: number;
  matchingBreaks: number;
  ineligibleBlocks: number;
  totalClientBlocks: number;
};
export function scoreWeekdayTemplate(template: CandidateTemplate, staff: AvailableStaff[], clients: AvailableClient[]): TemplateMatch {
  const staffById = new Map(staff.map(x => [x.id, new Set(x.availableSlots)]));
  const clientById = new Map(clients.map(x => [x.id, new Set(x.requiredSlots)]));
  const usedStaff = new Set<string>();
  const usedClients = new Set<string>();
  let matchingBlocks = 0, matchingBreaks = 0, ineligibleBlocks = 0, totalClientBlocks = 0;
  for (const assignment of template.assignments ?? []) {
    const staffId = String(assignment.staffId ?? "");
    const clientId = String(assignment.clientId ?? "");
    const time = String(assignment.startTime ?? "");
    const staffAvailable = staffById.get(staffId)?.has(time) ?? false;
    if (assignment.assignmentType === "CLIENT_1_TO_1") {
      totalClientBlocks++;
      if (staffAvailable && clientById.get(clientId)?.has(time)) {
        matchingBlocks++;
        usedStaff.add(staffId);
        usedClients.add(clientId);
      } else ineligibleBlocks++;
    } else if (["BREAK", "BREAK_NAP", "BREAK_SPEECH"].includes(String(assignment.assignmentType))) {
      if (staffAvailable) matchingBreaks++;
    }
  }
  return { matchingBlocks, matchingStaff: usedStaff.size, matchingClients: usedClients.size,
    matchingBreaks, ineligibleBlocks, totalClientBlocks };
}
export function selectBestWeekdayTemplate<T extends CandidateTemplate>(templates: T[], staff: AvailableStaff[], clients: AvailableClient[]): T | null {
  const candidates = templates.filter(t => !t.learningOnly && Array.isArray(t.assignments) && t.assignments.length);
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => {
    const x = scoreWeekdayTemplate(a, staff, clients);
    const y = scoreWeekdayTemplate(b, staff, clients);
    return y.matchingBlocks - x.matchingBlocks ||
      y.matchingClients - x.matchingClients ||
      y.matchingStaff - x.matchingStaff ||
      x.ineligibleBlocks - y.ineligibleBlocks ||
      y.matchingBreaks - x.matchingBreaks ||
      String(a._id ?? a.name ?? "").localeCompare(String(b._id ?? b.name ?? ""));
  })[0];
}
