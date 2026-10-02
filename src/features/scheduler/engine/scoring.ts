import {
  getHistoricalExactSlotScore,
  getHistoricalPairingScore,
} from "./historicalPatterns";
import type {
  HistoricalPatternScores,
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
  historicalPatterns?: HistoricalPatternScores;
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
  const previousMinutes = (totalMinutes % 60)
    .toString()
    .padStart(2, "0");

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

function getReferenceHistoryScore(
  staffId: string,
  clientId: string,
  startTime: string,
  referenceAssignments: SchedulerAssignment[],
  rules: SchedulerRules,
  isRotationClient: boolean
): number {
  const clientHistory = referenceAssignments.filter(
    (assignment) =>
      assignment.staffId === staffId &&
      assignment.clientId === clientId &&
      assignment.assignmentType === "CLIENT_1_TO_1"
  );

  if (clientHistory.length === 0) {
    return 0;
  }

  const exactSlotMatches = clientHistory.filter(
    (assignment) => assignment.startTime === startTime
  );
  const templateMatches = exactSlotMatches.filter(
    (assignment) => assignment.source === "TEMPLATE"
  ).length;
  const historicalMatches = exactSlotMatches.filter(
    (assignment) => assignment.source !== "TEMPLATE"
  ).length;

  let score = 0;

  if (templateMatches > 0) {
    score += rules.weekdayTemplatePriority;
  }

  if (historicalMatches > 0) {
    const matchMultiplier = Math.min(historicalMatches, 4);
    const rotationMultiplier = isRotationClient ? 0.35 : 1;

    score +=
      matchMultiplier *
      rules.scheduleStabilityPriority *
      rotationMultiplier;
  }

  const generalPairingMatches = Math.min(clientHistory.length, 12);
  const generalPairingWeight = isRotationClient
    ? rules.continuityPriority / 20
    : rules.continuityPriority / 8;

  score += generalPairingMatches * Math.max(generalPairingWeight, 0);

  return score;
}

function getImportedHistoricalPatternScore(
  staffId: string,
  clientId: string,
  startTime: string,
  historicalPatterns: HistoricalPatternScores | undefined,
  rules: SchedulerRules,
  isRotationClient: boolean
): number {
  if (
    rules.autoUseHistoricalPatterns === false ||
    !historicalPatterns ||
    historicalPatterns.scheduleDayCount <= 0
  ) {
    return 0;
  }

  const pairingPriority = rules.historicalPairingPriority ?? 0;
  const exactSlotPriority = rules.historicalSlotPriority ?? 0;
  const pairingFrequency = getHistoricalPairingScore(
    historicalPatterns,
    staffId,
    clientId
  );
  const exactSlotFrequency = getHistoricalExactSlotScore(
    historicalPatterns,
    staffId,
    clientId,
    startTime
  );
  const rotationMultiplier = isRotationClient ? 0.25 : 1;

  return (
    (pairingFrequency * pairingPriority +
      exactSlotFrequency * exactSlotPriority) *
    rotationMultiplier
  );
}

export function getRoleCoveragePriority(
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
  if (
    weeklyHoursPriority <= 0 ||
    staffMember.targetWeeklyHours === undefined
  ) {
    return 0;
  }

  const assignedTodayHours =
    (countStaffClientSlots(staffMember.id, assignments) *
      slotLengthMinutes) /
    60;
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
  historicalPatterns,
  rules,
}: CandidateScoreContext): number {
  let score = 0;

  // Role points remain visible in diagnostics and tie-breaking. The generator
  // separately enforces the clinic role tier before comparing soft preferences.
  score += getRoleCoveragePriority(staffMember, rules);

  const relationship =
    client.staffRelationships[staffMember.id] ?? "ALLOWED";

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

  const previousStartTime = getPreviousSlot(
    startTime,
    rules.slotLengthMinutes
  );
  const isRotationClient =
    client.supportLevel === "ROTATION" ||
    client.supportLevel === "HIGH_SUPPORT";

  score += getReferenceHistoryScore(
    staffMember.id,
    client.id,
    startTime,
    referenceAssignments,
    rules,
    isRotationClient
  );

  score += getImportedHistoricalPatternScore(
    staffMember.id,
    client.id,
    startTime,
    historicalPatterns,
    rules,
    isRotationClient
  );

  if (
    rules.preferStaffContinuity &&
    previousStartTime &&
    !isRotationClient
  ) {
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
      priorClientAssignments *
        Math.max(rules.continuityPriority / 8, 1),
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
        priorClientAssignments *
          Math.max(rules.rotationPriority / 8, 1),
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

  const staffAssignedSlots = countStaffClientSlots(
    staffMember.id,
    assignments
  );

  score -=
    staffAssignedSlots *
    Math.max(rules.workloadBalancePriority / 10, 0);

  return score;
}
