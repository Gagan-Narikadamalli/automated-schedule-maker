import { canAssignStaffToClient } from "./constraints";
import { scoreCandidate } from "./scoring";
import type {
  SchedulerAssignment,
  SchedulerClient,
  SchedulerInput,
  SchedulerResult,
  SchedulerStaff,
  UncoveredRequirement,
} from "./types";

type ClientRequirement = {
  client: SchedulerClient;
  startTime: string;
};

function shouldPreserveExistingAssignment(
  assignment: SchedulerAssignment
): boolean {
  if (assignment.locked || assignment.source === "MANUAL") {
    return true;
  }

  return (
    assignment.assignmentType === "SPEECH" ||
    assignment.assignmentType === "UNAVAILABLE"
  );
}

function requirementIsAlreadyCovered(
  requirement: ClientRequirement,
  assignments: SchedulerAssignment[]
): boolean {
  return assignments.some(
    (assignment) =>
      assignment.clientId === requirement.client.id &&
      assignment.startTime === requirement.startTime &&
      assignment.assignmentType === "CLIENT_1_TO_1"
  );
}

function buildRequirements(clients: SchedulerClient[]): ClientRequirement[] {
  return clients.flatMap((client) =>
    client.requiredSlots.map((startTime) => ({
      client,
      startTime,
    }))
  );
}

function countEligibleStaff(
  requirement: ClientRequirement,
  staff: SchedulerStaff[],
  assignments: SchedulerAssignment[],
  callOutStaffIds: Set<string>,
  input: SchedulerInput
): number {
  return staff.filter((staffMember) =>
    canAssignStaffToClient({
      staffMember,
      client: requirement.client,
      startTime: requirement.startTime,
      assignments,
      callOutStaffIds,
      rules: input.rules,
    }).allowed
  ).length;
}

function sortMostConstrainedRequirementsFirst(
  requirements: ClientRequirement[],
  input: SchedulerInput,
  assignments: SchedulerAssignment[],
  callOutStaffIds: Set<string>
): ClientRequirement[] {
  return [...requirements].sort((left, right) => {
    const leftEligibleCount = countEligibleStaff(
      left,
      input.staff,
      assignments,
      callOutStaffIds,
      input
    );
    const rightEligibleCount = countEligibleStaff(
      right,
      input.staff,
      assignments,
      callOutStaffIds,
      input
    );

    if (leftEligibleCount !== rightEligibleCount) {
      return leftEligibleCount - rightEligibleCount;
    }

    return left.startTime.localeCompare(right.startTime);
  });
}

function findBestStaffMember(
  requirement: ClientRequirement,
  input: SchedulerInput,
  assignments: SchedulerAssignment[],
  callOutStaffIds: Set<string>
): SchedulerStaff | null {
  const candidates = input.staff
    .map((staffMember) => {
      const constraintCheck = canAssignStaffToClient({
        staffMember,
        client: requirement.client,
        startTime: requirement.startTime,
        assignments,
        callOutStaffIds,
        rules: input.rules,
      });

      if (!constraintCheck.allowed) {
        return null;
      }

      return {
        staffMember,
        score: scoreCandidate({
          staffMember,
          client: requirement.client,
          startTime: requirement.startTime,
          assignments,
          rules: input.rules,
        }),
      };
    })
    .filter(
      (
        candidate
      ): candidate is {
        staffMember: SchedulerStaff;
        score: number;
      } => candidate !== null
    )
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.staffMember.name.localeCompare(right.staffMember.name);
    });

  return candidates[0]?.staffMember ?? null;
}

function createAutoAssignment(
  staffMember: SchedulerStaff,
  requirement: ClientRequirement
): SchedulerAssignment {
  return {
    id: `auto-${requirement.client.id}-${requirement.startTime}-${staffMember.id}`,
    staffId: staffMember.id,
    clientId: requirement.client.id,
    startTime: requirement.startTime,
    assignmentType: "CLIENT_1_TO_1",
    source: "AUTO",
    locked: false,
  };
}

function findProtectedConflicts(
  assignments: SchedulerAssignment[]
): string[] {
  const seenStaffSlots = new Map<string, SchedulerAssignment>();
  const messages: string[] = [];

  for (const assignment of assignments) {
    const key = `${assignment.staffId}-${assignment.startTime}`;
    const existingAssignment = seenStaffSlots.get(key);

    if (existingAssignment) {
      messages.push(
        `Protected assignments conflict for staff ${assignment.staffId} at ${assignment.startTime}.`
      );
      continue;
    }

    seenStaffSlots.set(key, assignment);
  }

  return messages;
}

function countReservedBreakSlots(assignments: SchedulerAssignment[]): number {
  return assignments.filter(
    (assignment) =>
      assignment.assignmentType === "BREAK" ||
      assignment.assignmentType === "BREAK_NAP" ||
      assignment.assignmentType === "BREAK_SPEECH"
  ).length;
}

function calculateCapacityMetrics(
  input: SchedulerInput,
  assignments: SchedulerAssignment[],
  requiredClientSlots: number,
  coveredClientSlots: number,
  uncoveredClientSlots: number
): SchedulerResult["metrics"] {
  const slotHours = input.rules.slotLengthMinutes / 60;
  const callOutStaffIds = new Set(input.callOutStaffIds);
  const workingStaff = input.staff.filter(
    (staffMember) =>
      !callOutStaffIds.has(staffMember.id) && staffMember.availableSlots.length > 0
  );
  const activeClients = input.clients.filter(
    (client) => client.requiredSlots.length > 0
  );
  const staffAvailableSlots = workingStaff.reduce(
    (total, staffMember) => total + staffMember.availableSlots.length,
    0
  );
  const breakSlots = countReservedBreakSlots(assignments);

  const requiredClientHours = requiredClientSlots * slotHours;
  const coveredClientHours = coveredClientSlots * slotHours;
  const uncoveredClientHours = uncoveredClientSlots * slotHours;
  const staffAvailableHours = staffAvailableSlots * slotHours;
  const breakHoursReserved = breakSlots * slotHours;
  const netStaffCoverageHours = Math.max(
    staffAvailableHours - breakHoursReserved,
    0
  );
  const additionalLaborHoursNeeded = Math.max(
    requiredClientHours - netStaffCoverageHours,
    0
  );
  const coveragePercent =
    requiredClientSlots === 0
      ? 100
      : (coveredClientSlots / requiredClientSlots) * 100;

  return {
    staffCount: workingStaff.length,
    clientCount: activeClients.length,
    requiredClientSlots,
    coveredClientSlots,
    uncoveredClientSlots,
    coveragePercent,
    requiredClientHours,
    coveredClientHours,
    uncoveredClientHours,
    staffAvailableHours,
    breakHoursReserved,
    netStaffCoverageHours,
    additionalLaborHoursNeeded,
  };
}

export function generateSchedule(input: SchedulerInput): SchedulerResult {
  const callOutStaffIds = new Set(input.callOutStaffIds);

  const protectedAssignments = input.existingAssignments.filter(
    shouldPreserveExistingAssignment
  );

  const assignments: SchedulerAssignment[] = protectedAssignments.map(
    (assignment) => ({ ...assignment })
  );

  const warnings: SchedulerResult["warnings"] = findProtectedConflicts(
    protectedAssignments
  ).map((message) => ({
    code: "LOCKED_CONFLICT",
    message,
  }));

  const allRequirements = buildRequirements(input.clients);
  const uncoveredRequirements: UncoveredRequirement[] = [];

  const requirementsToFill = allRequirements.filter(
    (requirement) => !requirementIsAlreadyCovered(requirement, assignments)
  );

  const sortedRequirements = sortMostConstrainedRequirementsFirst(
    requirementsToFill,
    input,
    assignments,
    callOutStaffIds
  );

  for (const requirement of sortedRequirements) {
    const bestStaffMember = findBestStaffMember(
      requirement,
      input,
      assignments,
      callOutStaffIds
    );

    if (!bestStaffMember) {
      uncoveredRequirements.push({
        clientId: requirement.client.id,
        clientCode: requirement.client.displayCode,
        startTime: requirement.startTime,
        reason:
          "No eligible staff member satisfies availability, call-out, hard relationship, client rotation, and hour constraints.",
      });

      warnings.push({
        code: "NO_ELIGIBLE_STAFF",
        message: `${requirement.client.displayCode} is uncovered at ${requirement.startTime}.`,
      });
      continue;
    }

    assignments.push(createAutoAssignment(bestStaffMember, requirement));
  }

  const requiredClientSlots = allRequirements.length;
  const uncoveredClientSlots = uncoveredRequirements.length;
  const coveredClientSlots = requiredClientSlots - uncoveredClientSlots;
  const metrics = calculateCapacityMetrics(
    input,
    assignments,
    requiredClientSlots,
    coveredClientSlots,
    uncoveredClientSlots
  );

  if (metrics.additionalLaborHoursNeeded > 0) {
    warnings.push({
      code: "CAPACITY_SHORTAGE",
      message: `Daily client demand exceeds net staff capacity by ${metrics.additionalLaborHoursNeeded.toFixed(
        1
      )} hours after reserved breaks.`,
    });
  }

  return {
    assignments,
    uncoveredRequirements,
    warnings,
    metrics,
  };
}
