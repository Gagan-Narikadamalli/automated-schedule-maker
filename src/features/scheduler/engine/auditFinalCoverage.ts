import type {
  SchedulerAssignment,
  SchedulerClient,
  SchedulerResult,
  UncoveredRequirement,
} from "./types";

function requirementKey(clientId: string, startTime: string): string {
  return `${clientId}|${startTime}`;
}

export type CoverageAudit = {
  metrics: SchedulerResult["metrics"];
  uncoveredRequirements: UncoveredRequirement[];
};

/**
 * Re-checks coverage from the assignments that will actually be shown/saved.
 * This prevents pre-break generation metrics from claiming a client block is
 * covered when a later scheduling stage leaves that exact client/time empty.
 */
export function auditFinalCoverage(
  clients: SchedulerClient[],
  assignments: SchedulerAssignment[],
  baseMetrics: SchedulerResult["metrics"],
  slotLengthMinutes: number
): CoverageAudit {
  const coveredKeys = new Set(
    assignments
      .filter(
        (assignment) =>
          assignment.assignmentType === "CLIENT_1_TO_1" &&
          Boolean(assignment.clientId)
      )
      .map((assignment) =>
        requirementKey(
          assignment.clientId as string,
          assignment.startTime
        )
      )
  );

  const uncoveredRequirements: UncoveredRequirement[] = [];
  let requiredClientSlots = 0;
  let coveredClientSlots = 0;

  for (const client of clients) {
    for (const startTime of client.requiredSlots) {
      requiredClientSlots += 1;

      if (coveredKeys.has(requirementKey(client.id, startTime))) {
        coveredClientSlots += 1;
        continue;
      }

      uncoveredRequirements.push({
        clientId: client.id,
        clientCode: client.displayCode,
        startTime,
        reason:
          "This required client block is empty in the final saved schedule after nap, speech, and break placement.",
      });
    }
  }

  const uncoveredClientSlots =
    requiredClientSlots - coveredClientSlots;
  const slotHours = slotLengthMinutes / 60;
  const requiredClientHours = requiredClientSlots * slotHours;
  const coveredClientHours = coveredClientSlots * slotHours;
  const uncoveredClientHours = uncoveredClientSlots * slotHours;

  return {
    uncoveredRequirements,
    metrics: {
      ...baseMetrics,
      requiredClientSlots,
      coveredClientSlots,
      uncoveredClientSlots,
      coveragePercent:
        requiredClientSlots === 0
          ? 100
          : (coveredClientSlots / requiredClientSlots) * 100,
      requiredClientHours,
      coveredClientHours,
      uncoveredClientHours,
    },
  };
}
