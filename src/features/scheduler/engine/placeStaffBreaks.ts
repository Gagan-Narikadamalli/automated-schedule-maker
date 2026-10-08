import { canAssignStaffToClient } from "./constraints";
import { scoreCandidate } from "./scoring";
import type {
  SchedulerAssignment,
  SchedulerClient,
  SchedulerRules,
  SchedulerStaff,
  StaffRole,
} from "./types";

export type PostCoverageBreakRules = {
  breakWindowStart: string;
  breakWindowEnd: string;
  breakSchedulingEnabled?: boolean;
  defaultBreakMinutes: number;
  breakEligibilityHours: number;
  slotLengthMinutes: number;
  historicalBreakPriority?: number;
};

type PlaceStaffBreaksInput = {
  staff: SchedulerStaff[];
  clients: SchedulerClient[];
  assignments: SchedulerAssignment[];
  referenceAssignments?: SchedulerAssignment[];
  callOutStaffIds: string[];
  rules: PostCoverageBreakRules;
  schedulerRules: SchedulerRules;
  allowProtectedRelief?: boolean;
};

export type PlaceStaffBreaksResult = {
  assignments: SchedulerAssignment[];
  reservedBreaks: SchedulerAssignment[];
  reliefSwapCount: number;
  unplacedBreakStaffIds: string[];
};

type FixedEventCandidate = {
  client: SchedulerClient;
  assignmentType: "BREAK_NAP" | "BREAK_SPEECH";
  priority: number;
};

const NAP_BREAK_WINDOW_END = "14:00";

function shiftTime(startTime: string, minuteOffset: number): string | null {
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

function timeDistanceFromNoon(startTime: string): number {
  const [hoursText, minutesText] = startTime.split(":");
  const minutes = Number(hoursText) * 60 + Number(minutesText);

  if (Number.isNaN(minutes)) {
    return 10_000;
  }

  return Math.abs(minutes - 12 * 60);
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

function coverageRoleTier(role: StaffRole): number {
  switch (role) {
    case "BT":
    case "RBT":
      return 0;
    case "INTERN":
      return 1;
    case "OFFICE_MANAGER":
      return 2;
    case "OTHER":
      return 3;
    case "BCBA":
      return 4;
    default:
      return 5;
  }
}

function findFixedEventForStaffSlot(
  staffId: string,
  startTime: string,
  assignments: SchedulerAssignment[],
  clients: SchedulerClient[],
  slotLengthMinutes: number
): FixedEventCandidate | null {
  const previousTime = shiftTime(startTime, -slotLengthMinutes);
  const nextTime = shiftTime(startTime, slotLengthMinutes);
  const adjacentClientIds = assignments
    .filter(
      (assignment) =>
        assignment.staffId === staffId &&
        assignment.assignmentType === "CLIENT_1_TO_1" &&
        Boolean(assignment.clientId) &&
        (assignment.startTime === previousTime || assignment.startTime === nextTime)
    )
    .map((assignment) => assignment.clientId as string);

  const candidates: FixedEventCandidate[] = [];

  for (const clientId of new Set(adjacentClientIds)) {
    const client = clients.find((candidate) => candidate.id === clientId);

    if (!client) {
      continue;
    }

    if (client.speechSlots.includes(startTime)) {
      candidates.push({
        client,
        assignmentType: "BREAK_SPEECH",
        priority: 0,
      });
      continue;
    }

    if (client.napSlots.includes(startTime)) {
      candidates.push({
        client,
        assignmentType: "BREAK_NAP",
        priority: client.napPriorityCategory === "YOUNGER" ? 10 : 20,
      });
    }
  }

  candidates.sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }

    return left.client.displayCode.localeCompare(right.client.displayCode);
  });

  return candidates[0] ?? null;
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

function createBreakAssignment(
  staffMember: SchedulerStaff,
  startTime: string,
  fixedEvent: FixedEventCandidate | null
): SchedulerAssignment {
  if (fixedEvent) {
    return {
      id: `break-${staffMember.id}-${startTime}`,
      staffId: staffMember.id,
      clientId: fixedEvent.client.id,
      startTime,
      assignmentType: fixedEvent.assignmentType,
      source: "AUTO",
      locked: true,
      note:
        fixedEvent.assignmentType === "BREAK_NAP"
          ? `Break combined with ${fixedEvent.client.displayCode} nap supervision.`
          : `Break combined with ${fixedEvent.client.displayCode} speech supervision.`,
    };
  }

  return {
    id: `break-${staffMember.id}-${startTime}`,
    staffId: staffMember.id,
    startTime,
    assignmentType: "BREAK",
    source: "AUTO",
    locked: true,
    note: "Automatically reserved staff break after client and nap coverage was placed.",
  };
}

function buildBreakSlotTimes(
  startTime: string,
  durationMinutes: number,
  slotLengthMinutes: number
): string[] {
  const blockCount = Math.max(
    Math.ceil(durationMinutes / slotLengthMinutes),
    1
  );
  const slots: string[] = [];

  for (let index = 0; index < blockCount; index += 1) {
    const slot = shiftTime(startTime, index * slotLengthMinutes);

    if (!slot) {
      return [];
    }

    slots.push(slot);
  }

  return slots;
}

function findBestFreeBreaks(
  staffMember: SchedulerStaff,
  assignments: SchedulerAssignment[],
  clients: SchedulerClient[],
  referenceAssignments: SchedulerAssignment[],
  rules: PostCoverageBreakRules
): SchedulerAssignment[] {
  const historicalPriority = Math.max(rules.historicalBreakPriority ?? 80, 0);
  const candidates = staffMember.availableSlots
    .map((startTime) => {
      const slotTimes = buildBreakSlotTimes(
        startTime,
        rules.defaultBreakMinutes,
        rules.slotLengthMinutes
      );

      if (slotTimes.length === 0) {
        return null;
      }

      const slotDetails = slotTimes.map((slotTime) => {
        if (!staffMember.availableSlots.includes(slotTime)) {
          return null;
        }

        const occupied = assignments.some(
          (assignment) =>
            assignment.staffId === staffMember.id &&
            assignment.startTime === slotTime
        );

        if (occupied) {
          return null;
        }

        const fixedEvent = findFixedEventForStaffSlot(
          staffMember.id,
          slotTime,
          assignments,
          clients,
          rules.slotLengthMinutes
        );
        const insideNormalWindow =
          slotTime >= rules.breakWindowStart &&
          slotTime < rules.breakWindowEnd;
        const insideNapExtension =
          fixedEvent?.assignmentType === "BREAK_NAP" &&
          slotTime >= rules.breakWindowStart &&
          slotTime < NAP_BREAK_WINDOW_END;

        if (!insideNormalWindow && !insideNapExtension) {
          return null;
        }

        return {
          slotTime,
          fixedEvent,
        };
      });

      if (slotDetails.some((detail) => detail === null)) {
        return null;
      }

      const details = slotDetails as Array<{
        slotTime: string;
        fixedEvent: FixedEventCandidate | null;
      }>;
      const historicalCount = details.reduce(
        (total, detail) =>
          total +
          countReferenceBreaks(
            staffMember.id,
            detail.slotTime,
            referenceAssignments
          ),
        0
      );
      const eventPriority = Math.min(
        ...details.map((detail) =>
          detail.fixedEvent ? detail.fixedEvent.priority : 100
        )
      );
      const score =
        eventPriority * 10 +
        timeDistanceFromNoon(startTime) -
        Math.min(historicalCount, 4) * historicalPriority;

      return {
        startTime,
        details,
        score,
      };
    })
    .filter(
      (
        candidate
      ): candidate is {
        startTime: string;
        details: Array<{
          slotTime: string;
          fixedEvent: FixedEventCandidate | null;
        }>;
        score: number;
      } => candidate !== null
    )
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }

      return left.startTime.localeCompare(right.startTime);
    });

  const best = candidates[0];

  if (!best) {
    return [];
  }

  return best.details.map((detail) =>
    createBreakAssignment(
      staffMember,
      detail.slotTime,
      detail.fixedEvent
    )
  );
}

function findReliefSwap(
  staffMember: SchedulerStaff,
  staff: SchedulerStaff[],
  clients: SchedulerClient[],
  assignments: SchedulerAssignment[],
  callOutStaffIds: Set<string>,
  referenceAssignments: SchedulerAssignment[],
  rules: PostCoverageBreakRules,
  schedulerRules: SchedulerRules,
  allowProtectedAssignments = false
): {
  assignmentIndex: number;
  replacement: SchedulerAssignment;
  breakAssignment: SchedulerAssignment;
} | null {
  const occupiedCandidates = assignments
    .map((assignment, assignmentIndex) => ({ assignment, assignmentIndex }))
    .filter(
      ({ assignment }) =>
        assignment.staffId === staffMember.id &&
        assignment.assignmentType === "CLIENT_1_TO_1" &&
        (allowProtectedAssignments ||
          (assignment.source === "AUTO" && !assignment.locked)) &&
        Boolean(assignment.clientId) &&
        assignment.startTime >= rules.breakWindowStart &&
        assignment.startTime < rules.breakWindowEnd
    )
    .sort((left, right) => {
      const leftHistory = countReferenceBreaks(
        staffMember.id,
        left.assignment.startTime,
        referenceAssignments
      );
      const rightHistory = countReferenceBreaks(
        staffMember.id,
        right.assignment.startTime,
        referenceAssignments
      );

      if (rightHistory !== leftHistory) {
        return rightHistory - leftHistory;
      }

      return (
        timeDistanceFromNoon(left.assignment.startTime) -
        timeDistanceFromNoon(right.assignment.startTime)
      );
    });

  for (const { assignment, assignmentIndex } of occupiedCandidates) {
    const client = clients.find(
      (candidate) => candidate.id === assignment.clientId
    );

    if (!client) {
      continue;
    }

    const assignmentsWithoutCurrent = assignments.filter(
      (_, index) => index !== assignmentIndex
    );
    const reliefCandidates = staff
      .filter(
        (candidate) =>
          candidate.id !== staffMember.id &&
          !callOutStaffIds.has(candidate.id)
      )
      .map((candidate) => {
        const check = canAssignStaffToClient({
          staffMember: candidate,
          client,
          startTime: assignment.startTime,
          assignments: assignmentsWithoutCurrent,
          callOutStaffIds,
          rules: schedulerRules,
        });

        if (!check.allowed) {
          return null;
        }

        return {
          staffMember: candidate,
          score: scoreCandidate({
            staffMember: candidate,
            client,
            startTime: assignment.startTime,
            assignments: assignmentsWithoutCurrent,
            referenceAssignments,
            rules: schedulerRules,
          }),
        };
      })
      .filter(
        (
          candidate
        ): candidate is {
          staffMember: SchedulerStaff;
          score: number;
        } => candidate !== null
      )
      .sort((left, right) => {
        const roleDifference =
          coverageRoleTier(left.staffMember.role) -
          coverageRoleTier(right.staffMember.role);

        if (roleDifference !== 0) {
          return roleDifference;
        }

        if (right.score !== left.score) {
          return right.score - left.score;
        }

        return left.staffMember.name.localeCompare(right.staffMember.name);
      });

    const relief = reliefCandidates[0]?.staffMember;

    if (!relief) {
      continue;
    }

    return {
      assignmentIndex,
      replacement: {
        ...assignment,
        id: `relief-${client.id}-${assignment.startTime}-${relief.id}`,
        staffId: relief.id,
        source: "AUTO",
        locked: false,
        note: `Automatically reassigned from ${staffMember.name} to preserve coverage while the original staff member takes a break.`,
      },
      breakAssignment: createBreakAssignment(
        staffMember,
        assignment.startTime,
        null
      ),
    };
  }

  return null;
}

export function placeStaffBreaksAfterCoverage({
  staff,
  clients,
  assignments: initialAssignments,
  referenceAssignments = [],
  callOutStaffIds,
  rules,
  schedulerRules,
  allowProtectedRelief = false,
}: PlaceStaffBreaksInput): PlaceStaffBreaksResult {
  if (
    rules.breakSchedulingEnabled === false ||
    rules.defaultBreakMinutes <= 0 ||
    rules.defaultBreakMinutes % rules.slotLengthMinutes !== 0
  ) {
    return {
      assignments: initialAssignments.map((assignment) => ({ ...assignment })),
      reservedBreaks: [],
      reliefSwapCount: 0,
      unplacedBreakStaffIds: [],
    };
  }

  const callOutSet = new Set(callOutStaffIds);
  const assignments = initialAssignments.map((assignment) => ({ ...assignment }));
  const reservedBreaks: SchedulerAssignment[] = [];
  const unplacedBreakStaffIds: string[] = [];
  let reliefSwapCount = 0;

  const orderedStaff = [...staff].sort((left, right) => {
    const roleDifference = roleBreakOrder(left.role) - roleBreakOrder(right.role);

    if (roleDifference !== 0) {
      return roleDifference;
    }

    return left.name.localeCompare(right.name);
  });

  for (const staffMember of orderedStaff) {
    if (callOutSet.has(staffMember.id)) {
      continue;
    }

    // Every scheduled staff member is owed one break. The old
    // shift-length threshold is intentionally not used here; if the person has
    // a legal 11:00 AM-2:00 PM break opportunity, Auto Generate must try to
    // place it.

    if (staffAlreadyHasBreak(staffMember.id, assignments)) {
      continue;
    }

    const freeBreaks = findBestFreeBreaks(
      staffMember,
      assignments,
      clients,
      referenceAssignments,
      rules
    );

    if (freeBreaks.length > 0) {
      assignments.push(...freeBreaks);
      reservedBreaks.push(...freeBreaks);
      continue;
    }

    // Multi-block breaks must be placed as one contiguous free window. The
    // single-block relief swap remains available for the normal 30-minute
    // clinic break.
    if (rules.defaultBreakMinutes !== rules.slotLengthMinutes) {
      unplacedBreakStaffIds.push(staffMember.id);
      continue;
    }

    const reliefSwap = findReliefSwap(
      staffMember,
      staff,
      clients,
      assignments,
      callOutSet,
      referenceAssignments,
      rules,
      schedulerRules,
      allowProtectedRelief
    );

    if (reliefSwap) {
      assignments[reliefSwap.assignmentIndex] = reliefSwap.replacement;
      assignments.push(reliefSwap.breakAssignment);
      reservedBreaks.push(reliefSwap.breakAssignment);
      reliefSwapCount += 1;
      continue;
    }

    unplacedBreakStaffIds.push(staffMember.id);
  }

  return {
    assignments,
    reservedBreaks,
    reliefSwapCount,
    unplacedBreakStaffIds,
  };
}
