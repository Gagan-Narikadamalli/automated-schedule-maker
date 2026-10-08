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
  allowSameDayPairRepeat?: boolean;
  allowCoverageLimitException?: boolean;
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

function getPairAssignmentMinutes(
  staffId: string,
  clientId: string,
  assignments: SchedulerAssignment[]
): number[] {
  return assignments
    .filter(
      (assignment) =>
        assignment.staffId === staffId &&
        assignment.clientId === clientId &&
        assignment.assignmentType === "CLIENT_1_TO_1"
    )
    .map((assignment) => timeToMinutes(assignment.startTime))
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
}

function isSameDayPairContinuation(
  staffId: string,
  client: SchedulerClient,
  startTime: string,
  assignments: SchedulerAssignment[],
  slotLengthMinutes: number
): boolean {
  const targetMinutes = timeToMinutes(startTime);

  if (targetMinutes === null) {
    return true;
  }

  const pairMinutes = getPairAssignmentMinutes(
    staffId,
    client.id,
    assignments
  );

  if (pairMinutes.length === 0) {
    return true;
  }

  if (
    pairMinutes.some(
      (minute) =>
        Math.abs(minute - targetMinutes) === slotLengthMinutes
    )
  ) {
    return true;
  }

  // A planned client event is not treated as an arbitrary pairing restart.
  // If the technician was with the client immediately before the client's Nap
  // or Speech event, allow that same technician to resume afterward. This
  // preserves one readable client block around the protected event instead of
  // forcing another unnecessary handoff.
  const earlierPairMinutes = pairMinutes.filter(
    (minute) => minute < targetMinutes
  );

  if (earlierPairMinutes.length === 0) {
    return false;
  }

  const latestPairMinute = Math.max(...earlierPairMinutes);

  for (
    let minute = latestPairMinute + slotLengthMinutes;
    minute < targetMinutes;
    minute += slotLengthMinutes
  ) {
    const slot = `${String(Math.floor(minute / 60)).padStart(
      2,
      "0"
    )}:${String(minute % 60).padStart(2, "0")}`;

    if (
      !client.napSlots.includes(slot) &&
      !client.speechSlots.includes(slot)
    ) {
      return false;
    }
  }

  return latestPairMinute + slotLengthMinutes < targetMinutes;
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
  allowSameDayPairRepeat = false,
  allowCoverageLimitException = false,
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
    !allowCoverageLimitException &&
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
    !allowCoverageLimitException &&
    !clientStaffIds.has(staffMember.id) &&
    clientStaffIds.size >= rules.maximumTechsPerClientPerDay
  ) {
    return {
      allowed: false,
      reason: "Client has reached the maximum technician count for the day.",
    };
  }

  if (
    rules.preventSameStaffClientRepeatSameDay &&
    !allowSameDayPairRepeat &&
    !isSameDayPairContinuation(
      staffMember.id,
      client,
      startTime,
      assignments,
      rules.slotLengthMinutes
    )
  ) {
    return {
      allowed: false,
      reason:
        "This staff/client pair already worked together earlier today and cannot restart after a gap.",
    };
  }

  const globalMaxConsecutiveBlocks = Math.max(
    Math.floor(
      (rules.maximumClientStaffConsecutiveHours * 60) /
        rules.slotLengthMinutes
    ),
    1
  );
  const clientSpecificMax =
    client.maxConsecutiveBlocksWithSameStaff !== undefined &&
    client.maxConsecutiveBlocksWithSameStaff > 0
      ? client.maxConsecutiveBlocksWithSameStaff
      : Number.POSITIVE_INFINITY;
  const effectiveMaxConsecutiveBlocks = Math.min(
    globalMaxConsecutiveBlocks,
    clientSpecificMax
  );
  const consecutiveBlocks = countConsecutiveClientBlocksWithStaff(
    staffMember.id,
    client.id,
    startTime,
    assignments,
    rules.slotLengthMinutes
  );

  if (consecutiveBlocks > effectiveMaxConsecutiveBlocks) {
    return {
      allowed: false,
      reason:
        "The client/staff maximum continuous assignment rule requires a staff rotation.",
    };
  }

  const assignedSlotCount = getStaffAssignedSlotCount(
    staffMember.id,
    assignments
  );
  const assignedHours =
    (assignedSlotCount * rules.slotLengthMinutes) / 60;

  if (
    staffMember.maximumDailyHours !== undefined &&
    assignedHours >= staffMember.maximumDailyHours
  ) {
    return {
      allowed: false,
      reason: "Staff member has reached the maximum daily hour limit.",
    };
  }

  if (staffMember.maximumWeeklyHours !== undefined) {
    const previousWeekHours =
      staffMember.scheduledWeeklyClientHoursBeforeDate ?? 0;
    const projectedHoursAfterAssignment =
      previousWeekHours +
      assignedHours +
      rules.slotLengthMinutes / 60;

    if (projectedHoursAfterAssignment > staffMember.maximumWeeklyHours) {
      return {
        allowed: false,
        reason: "Staff member would exceed the configured weekly hour limit.",
      };
    }
  }

  return {
    allowed: true,
  };
}
