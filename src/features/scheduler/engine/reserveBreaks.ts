import { canAssignStaffToClient } from "./constraints";
import type {
  SchedulerAssignment,
  SchedulerClient,
  SchedulerRules,
  SchedulerStaff,
  StaffRole,
} from "./types";

export type BreakReservationRules = {
  breakWindowStart: string;
  breakWindowEnd: string;
  defaultBreakMinutes: number;
  breakEligibilityHours: number;
  slotLengthMinutes: number;
  historicalBreakPriority?: number;
};

type BreakReservationInput = {
  staff: SchedulerStaff[];
  clients: SchedulerClient[];
  existingAssignments: SchedulerAssignment[];
  referenceAssignments?: SchedulerAssignment[];
  callOutStaffIds: string[];
  rules: BreakReservationRules;
  schedulerRules?: SchedulerRules;
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

function getUncoveredClientsAtSlot(
  clients: SchedulerClient[],
  startTime: string,
  assignments: SchedulerAssignment[]
): SchedulerClient[] {
  return clients.filter(
    (client) =>
      client.requiredSlots.includes(startTime) &&
      !requirementAlreadyCovered(client.id, startTime, assignments)
  );
}

function countUncoveredClientDemand(
  clients: SchedulerClient[],
  startTime: string,
  assignments: SchedulerAssignment[]
): number {
  return getUncoveredClientsAtSlot(
    clients,
    startTime,
    assignments
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

function isBreakAssignment(assignment: SchedulerAssignment): boolean {
  return (
    assignment.assignmentType === "BREAK" ||
    assignment.assignmentType === "BREAK_NAP" ||
    assignment.assignmentType === "BREAK_SPEECH"
  );
}

function staffAlreadyHasBreak(
  staffId: string,
  assignments: SchedulerAssignment[]
): boolean {
  return assignments.some(
    (assignment) =>
      assignment.staffId === staffId && isBreakAssignment(assignment)
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
      isBreakAssignment(assignment)
  ).length;
}

function calculateBreakSlotScore(
  staffId: string,
  clients: SchedulerClient[],
  staff: SchedulerStaff[],
  callOutStaffIds: Set<string>,
  startTime: string,
  assignments: SchedulerAssignment[],
  referenceAssignments: SchedulerAssignment[],
  historicalBreakPriority: number
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

  const historicalBreakBonus =
    -Math.min(historicalBreakCount, 4) *
    Math.max(historicalBreakPriority, 0);

  return (
    historicalBreakBonus +
    uncoveredDemand * 10 -
    spareStaff * 25
  );
}

function calculateMaximumEligibleCoverage(
  clients: SchedulerClient[],
  staff: SchedulerStaff[],
  callOutStaffIds: Set<string>,
  startTime: string,
  assignments: SchedulerAssignment[],
  schedulerRules: SchedulerRules
): number {
  const eligibleStaffByClient = new Map<string, string[]>();
  const clientById = new Map(
    clients.map((client) => [client.id, client])
  );

  for (const client of clients) {
    const eligibleStaffIds = staff
      .filter((staffMember) =>
        canAssignStaffToClient({
          staffMember,
          client,
          startTime,
          assignments,
          callOutStaffIds,
          rules: schedulerRules,
        }).allowed
      )
      .map((staffMember) => staffMember.id);

    eligibleStaffByClient.set(client.id, eligibleStaffIds);
  }

  const orderedClientIds = [...eligibleStaffByClient.entries()]
    .sort((left, right) => left[1].length - right[1].length)
    .map(([clientId]) => clientId);
  const matchedClientByStaff = new Map<string, string>();

  function tryAssignClient(
    clientId: string,
    visitedStaffIds: Set<string>
  ): boolean {
    const eligibleStaffIds = eligibleStaffByClient.get(clientId) ?? [];

    for (const staffId of eligibleStaffIds) {
      if (visitedStaffIds.has(staffId)) {
        continue;
      }

      visitedStaffIds.add(staffId);
      const previousClientId = matchedClientByStaff.get(staffId);

      if (
        !previousClientId ||
        (clientById.has(previousClientId) &&
          tryAssignClient(previousClientId, visitedStaffIds))
      ) {
        matchedClientByStaff.set(staffId, clientId);
        return true;
      }
    }

    return false;
  }

  let coveredClientCount = 0;

  for (const clientId of orderedClientIds) {
    if (tryAssignClient(clientId, new Set<string>())) {
      coveredClientCount += 1;
    }
  }

  return coveredClientCount;
}

function slotCanSafelyAbsorbBreak(
  clients: SchedulerClient[],
  staff: SchedulerStaff[],
  callOutStaffIds: Set<string>,
  breakStaffId: string,
  startTime: string,
  assignments: SchedulerAssignment[],
  schedulerRules?: SchedulerRules
): boolean {
  const uncoveredClients = getUncoveredClientsAtSlot(
    clients,
    startTime,
    assignments
  );

  if (uncoveredClients.length === 0) {
    return true;
  }

  const tentativeAssignments: SchedulerAssignment[] = [
    ...assignments,
    {
      id: `break-safety-check-${breakStaffId}-${startTime}`,
      staffId: breakStaffId,
      startTime,
      assignmentType: "BREAK",
      source: "AUTO",
      locked: true,
    },
  ];

  if (schedulerRules) {
    const maximumEligibleCoverage = calculateMaximumEligibleCoverage(
      uncoveredClients,
      staff,
      callOutStaffIds,
      startTime,
      tentativeAssignments,
      schedulerRules
    );

    return maximumEligibleCoverage >= uncoveredClients.length;
  }

  const freeStaff = countFreeStaff(
    staff,
    callOutStaffIds,
    startTime,
    tentativeAssignments
  );

  return freeStaff >= uncoveredClients.length;
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
  // A client may nap for several consecutive slots. The caregiver might work
  // with the child immediately BEFORE or AFTER the full nap period, rather
  // than immediately next to every break slot within it.
  for (const assignmentType of ["BREAK_NAP", "BREAK_SPEECH"] as const) {
    for (const client of clients) {
      const fixedSlots = new Set(
        assignmentType === "BREAK_NAP" ? client.napSlots : client.speechSlots
      );
      if (!fixedSlots.has(breakAssignment.startTime)) continue;

      let first = breakAssignment.startTime;
      let last = breakAssignment.startTime;
      while (true) {
        const previous = shiftTime(first, -slotLengthMinutes);
        if (!previous || !fixedSlots.has(previous)) break;
        first = previous;
      }
      while (true) {
        const next = shiftTime(last, slotLengthMinutes);
        if (!next || !fixedSlots.has(next)) break;
        last = next;
      }
      const adjacentTimes = new Set([
        shiftTime(first, -slotLengthMinutes),
        shiftTime(last, slotLengthMinutes),
      ]);
      const linked = assignments.some((assignment) =>
        assignment.staffId === breakAssignment.staffId &&
        assignment.assignmentType === "CLIENT_1_TO_1" &&
        assignment.clientId === client.id &&
        adjacentTimes.has(assignment.startTime)
      );
      if (linked) return { client, assignmentType };
    }
  }
  return null;
}

export function reserveStaffBreaks({
  staff,
  clients,
  existingAssignments,
  referenceAssignments = [],
  callOutStaffIds,
  rules,
  schedulerRules,
}: BreakReservationInput): SchedulerAssignment[] {
  if (rules.defaultBreakMinutes <= 0) {
    return [];
  }

  if (rules.defaultBreakMinutes !== rules.slotLengthMinutes) {
    return [];
  }

  const callOutSet = new Set(callOutStaffIds);
  const reservedAssignments: SchedulerAssignment[] = [];
  const historicalBreakPriority =
    rules.historicalBreakPriority ?? 80;

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

    if (staffAlreadyHasBreak(staffMember.id, currentAssignments)) {
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
            currentAssignments
          )
      )
      .filter((startTime) =>
        slotCanSafelyAbsorbBreak(
          clients,
          staff,
          callOutSet,
          staffMember.id,
          startTime,
          currentAssignments,
          schedulerRules
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
          referenceAssignments,
          historicalBreakPriority
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

export function enrichBreakAssignmentsWithFixedEvents(
  assignments: SchedulerAssignment[],
  clients: SchedulerClient[],
  slotLengthMinutes: number
): SchedulerAssignment[] {
  // A client nap suppresses required coverage; it is not another 1:1 block.
  // Link at most one staff break to a given client nap in each time slot.
  const linkedNapSlots = new Set<string>();
  for (const assignment of assignments) {
    if (assignment.assignmentType === "BREAK_NAP" && assignment.clientId) {
      linkedNapSlots.add(`${assignment.clientId}|${assignment.startTime}`);
    }
  }
  return assignments.map((assignment) => {
    if (assignment.assignmentType !== "BREAK") return assignment;
    const fixedEvent = findSupervisedFixedEventClient(
      assignment, assignments, clients, slotLengthMinutes
    );
    if (!fixedEvent) return assignment;
    const key = `${fixedEvent.client.id}|${assignment.startTime}`;
    if (fixedEvent.assignmentType === "BREAK_NAP") {
      if (linkedNapSlots.has(key)) return assignment;
      linkedNapSlots.add(key);
    }
    return {
      ...assignment,
      clientId: fixedEvent.client.id,
      assignmentType: fixedEvent.assignmentType,
      note: fixedEvent.assignmentType === "BREAK_NAP"
        ? `Break aligned with ${fixedEvent.client.displayCode}'s nap; no client coverage is required during the nap.`
        : `Break combined with ${fixedEvent.client.displayCode} speech supervision.`,
    };
  });
}
