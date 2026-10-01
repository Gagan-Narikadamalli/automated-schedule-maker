import type {
  SchedulerAssignment,
  SchedulerClient,
  SchedulerRules,
  SchedulerStaff,
} from "./types";

export type CandidateScoreContext = {
  staffMember: SchedulerStaff;
  client: SchedulerClient;
  startTime: string;
  assignments: SchedulerAssignment[];
  referenceAssignments: SchedulerAssignment[];
  rules: SchedulerRules;
};

function getPreviousSlot(
  startTime: string,
  slotLengthMinutes: number
): string | null {
  const [hoursText, minutesText] = startTime.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }

  const totalMinutes = hours * 60 + minutes - slotLengthMinutes;

  if (totalMinutes < 0) {
    return null;
  }

  const previousHours = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, "0");
  const previousMinutes = (totalMinutes % 60).toString().padStart(2, "0");

  return `${previousHours}:${previousMinutes}`;
}

function countClientAssignments(
  staffId: string,
  clientId: string,
  assignments: SchedulerAssignment[]
): number {
  return assignments.filter(
    (assignment) =>
      assignment.staffId === staffId &&
      assignment.clientId === clientId &&
      assignment.assignmentType === "CLIENT_1_TO_1"
  ).length;
}

function countStaffClientSlots(
  staffId: string,
  assignments: SchedulerAssignment[]
): number {
  return assignments.filter(
    (assignment) =>
      assignment.staffId === staffId &&
      assignment.assignmentType === "CLIENT_1_TO_1"
  ).length;
}

function getClientStaffIds(
  clientId: string,
  assignments: SchedulerAssignment[]
): Set<string> {
  return new Set(
    assignments
      .filter(
        (assignment) =>
          assignment.clientId === clientId &&
          assignment.assignmentType === "CLIENT_1_TO_1"
      )
      .map((assignment) => assignment.staffId)
  );
}

function findReferenceAssignment(
  staffId: string,
  clientId: string,
  startTime: string,
  referenceAssignments: SchedulerAssignment[]
): SchedulerAssignment | undefined {
  return referenceAssignments.find(
    (assignment) =>
      assignment.staffId === staffId &&
      assignment.clientId === clientId &&
      assignment.startTime === startTime &&
      assignment.assignmentType === "CLIENT_1_TO_1"
  );
}

function getRoleCoveragePriority(
  staffMember: SchedulerStaff,
  rules: SchedulerRules
): number {
  switch (staffMember.role) {
    case "BT":
    case "RBT":
      return rules.btCoveragePriority;
    case "INTERN":
      return rules.internCoveragePriority;
    case "OFFICE_MANAGER":
      return rules.managerCoveragePriority;
    case "BCBA":
      return rules.bcbaCoveragePriority;
    default:
      return rules.otherCoveragePriority;
  }
}

function getWeeklyHoursScore(
  staffMember: SchedulerStaff,
  assignments: SchedulerAssignment[],
  slotLengthMinutes: number,
  weeklyHoursPriority: number
): number {
  if (weeklyHoursPriority <= 0 || staffMember.targetWeeklyHours === undefined) {
    return 0;
  }

  const assignedTodayHours =
    (countStaffClientSlots(staffMember.id, assignments) * slotLengthMinutes) / 60;
  const previouslyScheduledHours =
    staffMember.scheduledWeeklyClientHoursBeforeDate ?? 0;
  const projectedHours = previouslyScheduledHours + assignedTodayHours;
  const hoursToTarget = staffMember.targetWeeklyHours - projectedHours;

  if (hoursToTarget > 0) {
    return Math.min(hoursToTarget, 8) * weeklyHoursPriority;
  }

  return Math.max(hoursToTarget, -8) * weeklyHoursPriority;
}

export function scoreCandidate({
  staffMember,
  client,
  startTime,
  assignments,
  referenceAssignments,
  rules,
}: CandidateScoreContext): number {
  let score = 0;

  // Coverage role hierarchy requested by the clinic:
  // BT/RBT first, then interns, then office managers as relief coverage,
  // and BCBAs only when the lower tiers cannot cover the client.
  score += getRoleCoveragePriority(staffMember, rules);

  const relationship = client.staffRelationships[staffMember.id] ?? "ALLOWED";

  if (relationship === "PREFERRED") {
    score += rules.preferredStaffPriority;
  }

  if (
    rules.preferSameTeam &&
    staffMember.teamId &&
    client.teamId &&
    staffMember.teamId === client.teamId
  ) {
    score += rules.sameTeamPriority;
  }

  const referenceAssignment = findReferenceAssignment(
    staffMember.id,
    client.id,
    startTime,
    referenceAssignments
  );

  if (referenceAssignment) {
    if (referenceAssignment.source === "TEMPLATE") {
      score += rules.weekdayTemplatePriority;
    } else {
      score += rules.scheduleStabilityPriority;
    }
  }

  const previousStartTime = getPreviousSlot(
    startTime,
    rules.slotLengthMinutes
  );
  const isRotationClient =
    client.supportLevel === "ROTATION" ||
    client.supportLevel === "HIGH_SUPPORT";

  if (rules.preferStaffContinuity && previousStartTime && !isRotationClient) {
    const previousAssignment = assignments.find(
      (assignment) =>
        assignment.staffId === staffMember.id &&
        assignment.clientId === client.id &&
        assignment.startTime === previousStartTime &&
        assignment.assignmentType === "CLIENT_1_TO_1"
    );

    if (previousAssignment) {
      score += rules.continuityPriority;
    }
  }

  const priorClientAssignments = countClientAssignments(
    staffMember.id,
    client.id,
    assignments
  );

  if (!isRotationClient && priorClientAssignments > 0) {
    score += Math.min(
      priorClientAssignments * Math.max(rules.continuityPriority / 8, 1),
      rules.continuityPriority
    );
  }

  if (isRotationClient) {
    const clientStaffIds = getClientStaffIds(client.id, assignments);
    const desiredDifferentStaff = Math.max(
      client.desiredDifferentStaffPerDay ??
        (client.supportLevel === "HIGH_SUPPORT" ? 3 : 2),
      1
    );

    if (
      clientStaffIds.size < desiredDifferentStaff &&
      !clientStaffIds.has(staffMember.id)
    ) {
      const highSupportMultiplier =
        client.supportLevel === "HIGH_SUPPORT" ? 1.25 : 1;
      score += rules.rotationPriority * highSupportMultiplier;
    }

    if (clientStaffIds.has(staffMember.id)) {
      score -= Math.min(
        priorClientAssignments * Math.max(rules.rotationPriority / 8, 1),
        rules.rotationPriority
      );
    }
  }

  score += getWeeklyHoursScore(
    staffMember,
    assignments,
    rules.slotLengthMinutes,
    rules.weeklyHoursPriority
  );

  const staffAssignedSlots = countStaffClientSlots(staffMember.id, assignments);
  score -=
    staffAssignedSlots * Math.max(rules.workloadBalancePriority / 10, 0);

  return score;
}
