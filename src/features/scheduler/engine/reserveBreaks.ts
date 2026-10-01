import type {
  SchedulerAssignment,
  SchedulerClient,
  SchedulerStaff,
  StaffRole,
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
  referenceAssignments?: SchedulerAssignment[];
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
      assignment.staffId === staffId &&
      assignment.startTime === startTime
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

function roleBreakOrder(role: StaffRole): number {
  switch (role) {
    case "BT":
    case "RBT":
      return 0;
    case "INTERN":
      return 1;
    case "OTHER":
      return 2;
    case "OFFICE_MANAGER":
      return 3;
    case "BCBA":
      return 4;
    default:
      return 5;
  }
}

function countReferenceBreaks(
  staffId: string,
  startTime: string,
  referenceAssignments: SchedulerAssignment[]
): number {
  return referenceAssignments.filter(
    (assignment) =>
      assignment.staffId === staffId &&
      assignment.startTime === startTime &&
      (assignment.assignmentType === "BREAK" ||
        assignment.assignmentType === "BREAK_NAP" ||
        assignment.assignmentType === "BREAK_SPEECH")
  ).length;
}

function calculateBreakSlotScore(
  staffId: string,
  clients: SchedulerClient[],
  staff: SchedulerStaff[],
  callOutStaffIds: Set<string>,
  startTime: string,
  assignments: SchedulerAssignment[],
  referenceAssignments: SchedulerAssignment[]
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
  const historicalBreakCount = countReferenceBreaks(
    staffId,
    startTime,
    referenceAssignments
  );

  // Repeated prior break placement is stronger evidence than a one-off match.
  // Cap the effect so capacity safety still determines whether a break is valid.
  const historicalBreakBonus =
    -250 * Math.min(historicalBreakCount, 4);

  // Lower is better. Historical/template break placement is preferred first,
  // then slots with the most spare coverage and the least client demand.
  return (
    historicalBreakBonus +
    uncoveredDemand * 10 -
    spareStaff * 25
  );
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

  return freeStaff > uncoveredDemand;
}

function shiftTime(
  startTime: string,
  minuteOffset: number
): string | null {
  const [hoursText, minutesText] = startTime.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }

  const totalMinutes = hours * 60 + minutes + minuteOffset;

  if (totalMinutes < 0 || totalMinutes >= 24 * 60) {
    return null;
  }

  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(
    totalMinutes % 60
  ).padStart(2, "0")}`;
}

function findSupervisedFixedEventClient(
  breakAssignment: SchedulerAssignment,
  assignments: SchedulerAssignment[],
  clients: SchedulerClient[],
  slotLengthMinutes: number
): {
  client: SchedulerClient;
  assignmentType: "BREAK_NAP" | "BREAK_SPEECH";
} | null {
  const previousTime = shiftTime(
    breakAssignment.startTime,
    -slotLengthMinutes
  );
  const nextTime = shiftTime(
    breakAssignment.startTime,
    slotLengthMinutes
  );
  const adjacentAssignments = assignments.filter(
    (assignment) =>
      assignment.staffId === breakAssignment.staffId &&
      assignment.assignmentType === "CLIENT_1_TO_1" &&
      (assignment.startTime === previousTime ||
        assignment.startTime === nextTime) &&
      Boolean(assignment.clientId)
  );

  const adjacentClientIds = adjacentAssignments.map(
    (assignment) => assignment.clientId as string
  );
  const orderedClientIds = [...new Set(adjacentClientIds)];

  for (const clientId of orderedClientIds) {
    const client = clients.find(
      (candidate) => candidate.id === clientId
    );

    if (!client) {
      continue;
    }

    if (client.napSlots.includes(breakAssignment.startTime)) {
      return {
        client,
        assignmentType: "BREAK_NAP",
      };
    }

    if (client.speechSlots.includes(breakAssignment.startTime)) {
      return {
        client,
        assignmentType: "BREAK_SPEECH",
      };
    }
  }

  return null;
}

/**
 * Reserves one automatic break for each eligible staff member before client
 * matching. Frontline staff are processed before managers and BCBAs so relief
 * roles remain available to cover the client while a technician takes a break.
 */
export function reserveStaffBreaks({
  staff,
  clients,
  existingAssignments,
  referenceAssignments = [],
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

  const staffByBreakPriority = [...staff].sort((left, right) => {
    const roleDifference =
      roleBreakOrder(left.role) -
      roleBreakOrder(right.role);

    if (roleDifference !== 0) {
      return roleDifference;
    }

    if (right.availableSlots.length !== left.availableSlots.length) {
      return right.availableSlots.length - left.availableSlots.length;
    }

    return left.name.localeCompare(right.name);
  });

  for (const staffMember of staffByBreakPriority) {
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
          staffMember.id,
          clients,
          staff,
          callOutSet,
          startTime,
          currentAssignments,
          referenceAssignments
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

/**
 * Converts a normal break into Break/Nap or Break/Speech when the same technician
 * is supervising a client immediately around that fixed event. This mirrors the
 * clinic spreadsheet convention while keeping the client out of 1:1 demand for
 * the fixed-event block.
 */
export function enrichBreakAssignmentsWithFixedEvents(
  assignments: SchedulerAssignment[],
  clients: SchedulerClient[],
  slotLengthMinutes: number
): SchedulerAssignment[] {
  return assignments.map((assignment) => {
    if (assignment.assignmentType !== "BREAK") {
      return assignment;
    }

    const fixedEvent = findSupervisedFixedEventClient(
      assignment,
      assignments,
      clients,
      slotLengthMinutes
    );

    if (!fixedEvent) {
      return assignment;
    }

    return {
      ...assignment,
      clientId: fixedEvent.client.id,
      assignmentType: fixedEvent.assignmentType,
      note:
        fixedEvent.assignmentType === "BREAK_NAP"
          ? `Break combined with ${fixedEvent.client.displayCode} nap supervision.`
          : `Break combined with ${fixedEvent.client.displayCode} speech supervision.`,
    };
  });
}
