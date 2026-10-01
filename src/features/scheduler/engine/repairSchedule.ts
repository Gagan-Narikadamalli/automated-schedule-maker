import { generateSchedule } from "./generateSchedule";
import type { SchedulerAssignment, SchedulerInput, SchedulerResult } from "./types";

function shouldKeepAssignmentDuringRepair(
  assignment: SchedulerAssignment,
  affectedStaffIds: Set<string>
): boolean {
  if (assignment.locked || assignment.source === "MANUAL") {
    return true;
  }

  if (
    assignment.assignmentType === "SPEECH" ||
    assignment.assignmentType === "UNAVAILABLE"
  ) {
    return true;
  }

  return !affectedStaffIds.has(assignment.staffId);
}

/**
 * Repairs only the part of a schedule affected by a call-out or another staff-level
 * disruption. Existing assignments for unaffected staff are converted to protected
 * assignments so the generator does not reshuffle a schedule that was already good.
 */
export function repairSchedule(
  input: SchedulerInput,
  affectedStaffIds: string[]
): SchedulerResult {
  const affectedStaffIdSet = new Set(affectedStaffIds);

  const assignmentsToPreserve = input.existingAssignments
    .filter((assignment) =>
      shouldKeepAssignmentDuringRepair(assignment, affectedStaffIdSet)
    )
    .map((assignment) => ({
      ...assignment,
      locked: true,
    }));

  return generateSchedule({
    ...input,
    existingAssignments: assignmentsToPreserve,
  });
}
