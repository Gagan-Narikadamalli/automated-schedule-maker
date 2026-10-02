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

  // Repeated break placement from templates, recent schedules, and workbook
  // observations is useful evidence, but it can only rank slots that have
  // already passed the capacity-safety check below.
  const historicalBreakBonus =
    -Math.min(historicalBreakCount, 4) *
    Math.max(historicalBreakPriority, 0);

  // Lower is better. Capacity remains the main guardrail; historical guidance
  // only helps choose between break slots that are already safe.
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
 *
 * When the complete scheduler rules are provided, a candidate break is accepted
 * only if the remaining eligible staff can still be matched one-to-one with all
 * uncovered clients in that half-hour block. This prevents a headcount-only
 * break decision from overlooking hard staff/client or service-setting limits.
 */
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
