import type {
  SchedulerAssignment,
  SchedulerClient,
  SchedulerRules,
  SchedulerStaff,
} from "./types";

export type CandidateCheckContext = {
  staffMember: SchedulerStaff;
  client: SchedulerClient;
  startTime: string;
  assignments: SchedulerAssignment[];
  callOutStaffIds: Set<string>;
  rules: SchedulerRules;
};

function getStaffClientIds(
  staffId: string,
  assignments: SchedulerAssignment[]
): Set<string> {
  const clientIds = assignments
    .filter(
      (assignment) =>
        assignment.staffId === staffId &&
        assignment.assignmentType === "CLIENT_1_TO_1" &&
        Boolean(assignment.clientId)
    )
    .map((assignment) => assignment.clientId as string);

  return new Set(clientIds);
}

function getClientStaffIds(
  clientId: string,
  assignments: SchedulerAssignment[]
): Set<string> {
  const staffIds = assignments
    .filter(
      (assignment) =>
        assignment.clientId === clientId &&
        assignment.assignmentType === "CLIENT_1_TO_1"
    )
    .map((assignment) => assignment.staffId);

  return new Set(staffIds);
}

function getStaffAssignedSlotCount(
  staffId: string,
  assignments: SchedulerAssignment[]
): number {
  return assignments.filter(
    (assignment) =>
      assignment.staffId === staffId &&
      assignment.assignmentType === "CLIENT_1_TO_1"
  ).length;
}

export function canAssignStaffToClient({
  staffMember,
  client,
  startTime,
  assignments,
  callOutStaffIds,
  rules,
}: CandidateCheckContext): { allowed: boolean; reason?: string } {
  if (callOutStaffIds.has(staffMember.id)) {
    return {
      allowed: false,
      reason: "Staff member is marked as a call-out for this date.",
    };
  }

  if (!staffMember.availableSlots.includes(startTime)) {
    return {
      allowed: false,
      reason: "Staff member is not available during this time slot.",
    };
  }

  const occupiedAssignment = assignments.find(
    (assignment) =>
      assignment.staffId === staffMember.id &&
      assignment.startTime === startTime
  );

  if (occupiedAssignment) {
    return {
      allowed: false,
      reason: "Staff member already has an assignment in this time slot.",
    };
  }

  const relationship = client.staffRelationships[staffMember.id] ?? "ALLOWED";

  if (relationship === "HARD_RESTRICTION") {
    return {
      allowed: false,
      reason: "This staff/client pair has a hard restriction.",
    };
  }

  const staffClientIds = getStaffClientIds(staffMember.id, assignments);

  if (
    !staffClientIds.has(client.id) &&
    staffClientIds.size >= rules.maximumClientsPerTechPerDay
  ) {
    return {
      allowed: false,
      reason: "Staff member has reached the maximum client count for the day.",
    };
  }

  const clientStaffIds = getClientStaffIds(client.id, assignments);

  if (
    !clientStaffIds.has(staffMember.id) &&
    clientStaffIds.size >= rules.maximumTechsPerClientPerDay
  ) {
    return {
      allowed: false,
      reason: "Client has reached the maximum technician count for the day.",
    };
  }

  if (staffMember.maximumDailyHours !== undefined) {
    const assignedSlotCount = getStaffAssignedSlotCount(
      staffMember.id,
      assignments
    );
    const assignedHours =
      (assignedSlotCount * rules.slotLengthMinutes) / 60;

    if (assignedHours >= staffMember.maximumDailyHours) {
      return {
        allowed: false,
        reason: "Staff member has reached the maximum daily hour limit.",
      };
    }
  }

  return {
    allowed: true,
  };
}
