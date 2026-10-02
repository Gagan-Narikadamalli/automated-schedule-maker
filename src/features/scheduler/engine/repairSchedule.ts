import { generateSchedule } from "./generateSchedule";
import type {
  SchedulerAssignment,
  SchedulerInput,
  SchedulerResult,
} from "./types";

export type RepairAffectedSlot = {
  staffId: string;
  startTime: string;
};

function slotKey(staffId: string, startTime: string): string {
  return `${staffId}|${startTime}`;
}

function shouldKeepAssignmentDuringRepair(
  assignment: SchedulerAssignment,
  affectedStaffIds: Set<string>,
  affectedSlotKeys: Set<string> | null
): boolean {
  const assignmentKey = slotKey(assignment.staffId, assignment.startTime);
  const isAffectedSlot = affectedSlotKeys
    ? affectedSlotKeys.has(assignmentKey)
    : affectedStaffIds.has(assignment.staffId);

  // A recorded call-out is a hard automatic-scheduling boundary. Automatic
  // assignments inside the affected staff/time window must be released even if
  // they were stored as locked capacity blocks (for example AUTO BREAK or
  // BREAK_NAP records). Otherwise Repair Schedule can leave a break sitting in
  // the middle of a gray call-out column.
  //
  // Explicit MANUAL manager overrides are still preserved. If a manager truly
  // wants something inside the call-out window, Manual Mode owns that decision.
  if (isAffectedSlot && assignment.source !== "MANUAL") {
    return false;
  }

  if (assignment.locked || assignment.source === "MANUAL") {
    return true;
  }

  if (
    assignment.assignmentType === "SPEECH" ||
    assignment.assignmentType === "UNAVAILABLE"
  ) {
    return true;
  }

  if (affectedSlotKeys) {
    return !affectedSlotKeys.has(assignmentKey);
  }

  return !affectedStaffIds.has(assignment.staffId);
}

/**
 * Repairs only the part of a schedule affected by a staff disruption.
 *
 * When affectedSlots is supplied, even as an empty array, the repair is
 * slot-scoped: only assignments inside those staff/time cells may be replaced.
 * Every unaffected assignment is temporarily protected while the generator fills
 * the resulting client gaps. This prevents a call-out repair from reshuffling a
 * schedule that was already working.
 *
 * The affectedStaffIds-only behavior is retained for older callers that need a
 * whole-staff repair.
 */
export function repairSchedule(
  input: SchedulerInput,
  affectedStaffIds: string[],
  affectedSlots?: RepairAffectedSlot[]
): SchedulerResult {
  const affectedStaffIdSet = new Set(affectedStaffIds);
  const affectedSlotKeys = affectedSlots
    ? new Set(
        affectedSlots.map((slot) =>
          slotKey(slot.staffId, slot.startTime)
        )
      )
    : null;

  const assignmentsToPreserve = input.existingAssignments
    .filter((assignment) =>
      shouldKeepAssignmentDuringRepair(
        assignment,
        affectedStaffIdSet,
        affectedSlotKeys
      )
    )
    .map((assignment) => ({
      ...assignment,
      // This lock exists only inside this repair calculation. The route keeps
      // the original database records untouched, so unaffected AUTO cells do not
      // become permanently locked after a repair.
      locked: true,
    }));

  return generateSchedule({
    ...input,
    existingAssignments: assignmentsToPreserve,
  });
}
