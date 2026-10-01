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
  rules: SchedulerRules;
};

function getPreviousHalfHour(startTime: string): string | null {
  const [hoursText, minutesText] = startTime.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }

  const totalMinutes = hours * 60 + minutes - 30;

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

export function scoreCandidate({
  staffMember,
  client,
  startTime,
  assignments,
  rules,
}: CandidateScoreContext): number {
  let score = 0;

  const relationship = client.staffRelationships[staffMember.id] ?? "ALLOWED";

  if (relationship === "PREFERRED") {
    score += 100;
  }

  if (
    rules.preferSameTeam &&
    staffMember.teamId &&
    client.teamId &&
    staffMember.teamId === client.teamId
  ) {
    score += 40;
  }

  const previousStartTime = getPreviousHalfHour(startTime);

  if (rules.preferStaffContinuity && previousStartTime) {
    const previousAssignment = assignments.find(
      (assignment) =>
        assignment.staffId === staffMember.id &&
        assignment.clientId === client.id &&
        assignment.startTime === previousStartTime &&
        assignment.assignmentType === "CLIENT_1_TO_1"
    );

    if (previousAssignment) {
      score += 35;
    }
  }

  const priorClientAssignments = countClientAssignments(
    staffMember.id,
    client.id,
    assignments
  );

  if (priorClientAssignments > 0) {
    score += Math.min(priorClientAssignments * 4, 20);
  }

  const staffAssignedSlots = countStaffClientSlots(staffMember.id, assignments);

  // Small fairness preference: when candidates are otherwise similar,
  // assign the person with fewer client blocks first.
  score -= staffAssignedSlots;

  return score;
}
