import type {
  SchedulerAssignment,
  SchedulerClient,
  SchedulerStaff,
} from "./types";

export type BreakReservationRules = {
  breakWindowStart: string;
  breakWindowEnd: string;
  defaultBreakMinutes: number;
  breakEligibilityHours: number;
  slotLengthMinutes: number;
};

type BreakReservationInput = {
  staff: SchedulerStaff[];
  clients: SchedulerClient[];
  existingAssignments: SchedulerAssignment[];
  callOutStaffIds: string[];
  rules: BreakReservationRules;
};

function requirementAlreadyCovered(
  clientId: string,
  startTime: string,
  assignments: SchedulerAssignment[]
): boolean {
  return assignments.some(
    (assignment) =>
      assignment.clientId === clientId &&
      assignment.startTime === startTime &&
      assignment.assignmentType === "CLIENT_1_TO_1"
  );
}

function countUncoveredClientDemand(
  clients: SchedulerClient[],
  startTime: string,
  assignments: SchedulerAssignment[]
): number {
  return clients.filter(
    (client) =>
      client.requiredSlots.includes(startTime) &&
      !requirementAlreadyCovered(client.id, startTime, assignments)
  ).length;
}

function staffAlreadyOccupied(
  staffId: string,
  startTime: string,
  assignments: SchedulerAssignment[]
): boolean {
  return assignments.some(
    (assignment) =>
      assignment.staffId === staffId && assignment.startTime === startTime
  );
}

function countFreeStaff(
  staff: SchedulerStaff[],
  callOutStaffIds: Set<string>,
  startTime: string,
  assignments: SchedulerAssignment[]
): number {
  return staff.filter(
    (staffMember) =>
      !callOutStaffIds.has(staffMember.id) &&
      staffMember.availableSlots.includes(startTime) &&
      !staffAlreadyOccupied(staffMember.id, startTime, assignments)
  ).length;
}

function calculateBreakSlotScore(
  clients: SchedulerClient[],
  staff: SchedulerStaff[],
  callOutStaffIds: Set<string>,
  startTime: string,
  assignments: SchedulerAssignment[]
): number {
  const uncoveredDemand = countUncoveredClientDemand(
    clients,
    startTime,
    assignments
  );
  const freeStaff = countFreeStaff(
    staff,
    callOutStaffIds,
    startTime,
    assignments
  );
  const spareStaff = freeStaff - uncoveredDemand;

  // Lower is better. Large positive spare capacity is preferred, then lower demand.
  return uncoveredDemand * 10 - spareStaff * 25;
}

function slotCanSafelyAbsorbBreak(
  clients: SchedulerClient[],
  staff: SchedulerStaff[],
  callOutStaffIds: Set<string>,
  startTime: string,
  assignments: SchedulerAssignment[]
): boolean {
  const uncoveredDemand = countUncoveredClientDemand(
    clients,
    startTime,
    assignments
  );
  const freeStaff = countFreeStaff(
    staff,
    callOutStaffIds,
    startTime,
    assignments
  );

  // The staff member taking the break consumes one free staff slot. Require at
  // least one more free staff member than uncovered client demand before reserving.
  return freeStaff > uncoveredDemand;
}

/**
 * Reserves one automatic break for each eligible staff member before client
 * matching. A break is only placed when the remaining free staff can still cover
 * all client demand for that 30-minute slot. This allows multiple simultaneous
 * breaks when there is genuine spare capacity, but avoids creating an uncovered
 * client simply to force a break into the calendar.
 */
export function reserveStaffBreaks({
  staff,
  clients,
  existingAssignments,
  callOutStaffIds,
  rules,
}: BreakReservationInput): SchedulerAssignment[] {
  if (rules.defaultBreakMinutes <= 0) {
    return [];
  }

  if (rules.defaultBreakMinutes !== rules.slotLengthMinutes) {
    return [];
  }

  const callOutSet = new Set(callOutStaffIds);
  const reservedAssignments: SchedulerAssignment[] = [];

  const staffByLongestShiftFirst = [...staff].sort(
    (left, right) => right.availableSlots.length - left.availableSlots.length
  );

  for (const staffMember of staffByLongestShiftFirst) {
    if (callOutSet.has(staffMember.id)) {
      continue;
    }

    const availableHours =
      (staffMember.availableSlots.length * rules.slotLengthMinutes) / 60;

    if (availableHours < rules.breakEligibilityHours) {
      continue;
    }

    const currentAssignments = [
      ...existingAssignments,
      ...reservedAssignments,
    ];

    const candidateSlots = staffMember.availableSlots
      .filter(
        (startTime) =>
          startTime >= rules.breakWindowStart &&
          startTime < rules.breakWindowEnd
      )
      .filter(
        (startTime) =>
          !staffAlreadyOccupied(
            staffMember.id,
            startTime,
            currentAssignments
          )
      )
      .filter((startTime) =>
        slotCanSafelyAbsorbBreak(
          clients,
          staff,
          callOutSet,
          startTime,
          currentAssignments
        )
      )
      .map((startTime) => ({
        startTime,
        score: calculateBreakSlotScore(
          clients,
          staff,
          callOutSet,
          startTime,
          currentAssignments
        ),
      }))
      .sort((left, right) => {
        if (left.score !== right.score) {
          return left.score - right.score;
        }

        return left.startTime.localeCompare(right.startTime);
      });

    const bestSlot = candidateSlots[0];

    if (!bestSlot) {
      continue;
    }

    reservedAssignments.push({
      id: `break-${staffMember.id}-${bestSlot.startTime}`,
      staffId: staffMember.id,
      startTime: bestSlot.startTime,
      assignmentType: "BREAK",
      source: "AUTO",
      locked: true,
      note: "Automatically reserved capacity-safe staff break.",
    });
  }

  return reservedAssignments;
}
