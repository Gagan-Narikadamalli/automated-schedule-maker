import type { SchedulerAssignment } from "@/features/scheduler/engine/types";

/**
 * Preserve human-controlled and fixed-event cells during fresh generation.
 * Automatic breaks are recalculated after client coverage is established.
 */
export function shouldKeepExistingAssignment(
  assignment: SchedulerAssignment
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

  return false;
}

/**
 * Only replace unlocked, non-manual generated/template/copied rows.
 * Locked and manually overridden rows are deliberately excluded from the
 * replacement query so stale cleanup cannot delete them.
 */
export const AUTO_REPLACEABLE_ASSIGNMENT_FILTER = {
  locked: { $ne: true },
  manuallyOverridden: { $ne: true },
  source: { $in: ["AUTO", "TEMPLATE", "COPIED"] },
} as const;
