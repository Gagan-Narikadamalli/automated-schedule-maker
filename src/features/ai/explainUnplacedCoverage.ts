import type { SchedulerInput } from "@/features/scheduler/engine/types";

type Placed = { staffId: string; clientId?: string | null; startTime: string; assignmentType: string };
type Gap = { clientId: string; clientCode: string; startTime: string };

/** Explain uncovered client cells using validated roster availability, not invented LLM reasons. */
export function explainUnplacedCoverage(input: SchedulerInput, assignments: Placed[], gaps: Gap[]) {
  const callouts = new Set(input.callOutStaffIds);
  return gaps.map(gap => {
    const client = input.clients.find(c => c.id === gap.clientId);
    if (!client) return { ...gap, reason: "Client is not in the active roster; manager review required." };
    const available = input.staff.filter(s => !callouts.has(s.id) && s.availableSlots.includes(gap.startTime));
    const eligible = available.filter(s =>
      client.staffRelationships[s.id] !== "HARD_RESTRICTION" &&
      (!client.serviceSetting || !s.serviceSetting || s.serviceSetting === "BOTH" ||
        client.serviceSetting === "BOTH" || s.serviceSetting === client.serviceSetting));
    let reason: string;
    if (!available.length) reason = "No staff available during this slot after shifts and call-outs.";
    else if (!eligible.length) reason = "All available staff are restricted or have incompatible service settings.";
    else if (eligible.every(s => assignments.some(a => a.staffId === s.id && a.startTime === gap.startTime)))
      reason = "Every eligible staff member is already scheduled or on break at this time.";
    else reason = "OpenAI left this slot unresolved; review the remaining eligible staff's hours, continuity, and clinical limits.";
    return { ...gap, reason };
  });
}
