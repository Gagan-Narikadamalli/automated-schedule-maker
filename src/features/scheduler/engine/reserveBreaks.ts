import type {
  SchedulerAssignment,
  SchedulerClient,
  SchedulerStaff,
} from "./types";

export type BreakReservationRules = {
  breakWindowStart: string;
  breakWindowEnd: string;
  defaultBreakMinutes: number;
  slotLengthMinutes: number;
};

type BreakReservationInput = {
  staff: SchedulerStaff[];
  clients: SchedulerClient[];
  existingAssignments: SchedulerAssignment[];
  callOutStaffIds: string[];
  rules: BreakReservationRules;
};

function countClientDemand(
  clients: SchedulerClient[],
  startTime: string
): number {
  return clients.filter((client) => client.requiredSlots.includes(startTime)).length;
}

function countAvailableStaff(
  staff: SchedulerStaff[],
  callOutStaffIds: Set<string>,
  startTime: string
): number {
  return staff.filter(
    (staffMember) =>
      !callOutStaffIds.has(staffMember.id) &&
      staffMember.availableSlots.includes(startTime)
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

function calculateBreakSlotScore(
  clients: SchedulerClient[],
  staff: SchedulerStaff[],
  callOutStaffIds: Set<string>,
  startTime: string
): number {
  const clientDemand = countClientDemand(clients, startTime);
  const availableStaff = countAvailableStaff(staff, callOutStaffIds, startTime);

  // Lower values are better. A slot with low client demand and more available
  // staff is the least disruptive place to reserve a break.
  return clientDemand * 10 - availableStaff;
}

/**
 * Creates protected break assignments before client matching runs.
 *
 * The existing SOS spreadsheet normally gives staff one 30-minute break between
 * 11:00 AM and 2:00 PM. Reserving the break as a hard block prevents the generator
 * from filling every staff member continuously and then discovering too late that
 * nobody has a legal break window left.
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
    // The current Excel-compatible grid uses one 30-minute break block. Multi-slot
    // breaks can be added later without changing the rest of the scheduling engine.
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

    // Short shifts do not automatically receive a break. Six hours is a practical
    // default and can become a clinic setting later if management wants it changed.
    const availableHours =
      (staffMember.availableSlots.length * rules.slotLengthMinutes) / 60;

    if (availableHours < 6) {
      continue;
    }

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
            [...existingAssignments, ...reservedAssignments]
          )
      )
      .map((startTime) => ({
        startTime,
        score: calculateBreakSlotScore(
          clients,
          staff,
          callOutSet,
          startTime
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
      note: "Automatically reserved staff break.",
    });
  }

  return reservedAssignments;
}
