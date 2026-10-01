import type {
  SchedulerAssignment,
  SchedulerClient,
  SchedulerRules,
  SchedulerStaff,
  ServiceSetting,
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
  return new Set(
    assignments
      .filter(
        (assignment) =>
          assignment.staffId === staffId &&
          assignment.assignmentType === "CLIENT_1_TO_1" &&
          Boolean(assignment.clientId)
      )
      .map((assignment) => assignment.clientId as string)
  );
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

function serviceSettingsCompatible(
  staffSetting: ServiceSetting | undefined,
  clientSetting: ServiceSetting | undefined
): boolean {
  if (!staffSetting || !clientSetting) {
    return true;
  }

  if (staffSetting === "BOTH" || clientSetting === "BOTH") {
    return true;
  }

  return staffSetting === clientSetting;
}

function timeToMinutes(time: string): number | null {
  const [hoursText, minutesText] = time.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);

  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return hours * 60 + minutes;
}

function countConsecutiveClientBlocksWithStaff(
  staffId: string,
  clientId: string,
  startTime: string,
  assignments: SchedulerAssignment[],
  slotLengthMinutes: number
): number {
  const targetMinutes = timeToMinutes(startTime);

  if (targetMinutes === null) {
    return 1;
  }

  const occupiedMinutes = new Set(
    assignments
      .filter(
        (assignment) =>
          assignment.staffId === staffId &&
          assignment.clientId === clientId &&
          assignment.assignmentType === "CLIENT_1_TO_1"
      )
      .map((assignment) => timeToMinutes(assignment.startTime))
      .filter((value): value is number => value !== null)
  );

  let consecutive = 1;

  for (
    let minute = targetMinutes - slotLengthMinutes;
    occupiedMinutes.has(minute);
    minute -= slotLengthMinutes
  ) {
    consecutive += 1;
  }

  for (
    let minute = targetMinutes + slotLengthMinutes;
    occupiedMinutes.has(minute);
    minute += slotLengthMinutes
  ) {
    consecutive += 1;
  }

  return consecutive;
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

  if (
    !serviceSettingsCompatible(
      staffMember.serviceSetting,
      client.serviceSetting
    )
  ) {
    return {
      allowed: false,
      reason:
        "Staff and client service settings are not compatible for this appointment.",
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

  const clientDoubleBooking = assignments.find(
    (assignment) =>
      assignment.clientId === client.id &&
      assignment.startTime === startTime &&
      assignment.assignmentType === "CLIENT_1_TO_1"
  );

  if (clientDoubleBooking) {
    return {
      allowed: false,
      reason: "Client already has a technician assigned during this time slot.",
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

  if (
    client.maxConsecutiveBlocksWithSameStaff !== undefined &&
    client.maxConsecutiveBlocksWithSameStaff > 0
  ) {
    const consecutiveBlocks = countConsecutiveClientBlocksWithStaff(
      staffMember.id,
      client.id,
      startTime,
      assignments,
      rules.slotLengthMinutes
    );

    if (consecutiveBlocks > client.maxConsecutiveBlocksWithSameStaff) {
      return {
        allowed: false,
        reason:
          "The client rotation rule prevents another consecutive block with this staff member.",
      };
    }
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
