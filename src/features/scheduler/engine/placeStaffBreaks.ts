import { canAssignStaffToClient } from "./constraints";
import { balanceScheduleLikeHuman } from "./humanStyleBlockBalance";
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
  humanStyleBlockSwapCount: number;
  humanStylePenaltyBefore: number;
  humanStylePenaltyAfter: number;
  unplacedBreakStaffIds: string[];
};

type FixedEventCandidate = {
  client: SchedulerClient;
  assignmentType: "BREAK_NAP" | "BREAK_SPEECH";
  priority: number;
  eventStartTime: string;
  eventEndTime: string;
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

function reliefRolePriority(role: StaffRole): number {
  switch (role) {
    case "OFFICE_MANAGER":
      return 0;
    case "BCBA":
      return 1;
    case "INTERN":
      return 2;
    case "OTHER":
      return 3;
    case "BT":
    case "RBT":
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
  const candidates: FixedEventCandidate[] = [];

  for (const client of clients) {
    const eventTypes = [
      {
        slots: client.speechSlots,
        assignmentType: "BREAK_SPEECH" as const,
        priority: 0,
      },
      {
        slots: client.napSlots,
        assignmentType: "BREAK_NAP" as const,
        priority: client.napPriorityCategory === "YOUNGER" ? 10 : 20,
      },
    ];

    for (const event of eventTypes) {
      const fixedSlots = new Set(event.slots);
      if (!fixedSlots.has(startTime)) continue;

      // Treat a multi-slot nap as one continuous event. A caregiver assigned
      // immediately before or after the complete nap may take their break in
      // any slot inside it; checking only the neighboring half-hour misses
      // the middle of longer naps.
      let firstEventSlot = startTime;
      let lastEventSlot = startTime;

      while (true) {
        const previousSlot = shiftTime(firstEventSlot, -slotLengthMinutes);
        if (!previousSlot || !fixedSlots.has(previousSlot)) break;
        firstEventSlot = previousSlot;
      }

      while (true) {
        const nextSlot = shiftTime(lastEventSlot, slotLengthMinutes);
        if (!nextSlot || !fixedSlots.has(nextSlot)) break;
        lastEventSlot = nextSlot;
      }

      const eventBoundarySlots = new Set([
        shiftTime(firstEventSlot, -slotLengthMinutes),
        shiftTime(lastEventSlot, slotLengthMinutes),
      ]);

      const caregiverIsAssignedAtEventBoundary = assignments.some(
        (assignment) =>
          assignment.staffId === staffId &&
          assignment.clientId === client.id &&
          assignment.assignmentType === "CLIENT_1_TO_1" &&
          eventBoundarySlots.has(assignment.startTime)
      );

      if (caregiverIsAssignedAtEventBoundary) {
        candidates.push({
          client,
          assignmentType: event.assignmentType,
          priority: event.priority,
          eventStartTime: firstEventSlot,
          eventEndTime:
            shiftTime(lastEventSlot, slotLengthMinutes) ?? lastEventSlot,
        });
      }
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

function findAdjacentNapForClientSlot(
  client: SchedulerClient,
  startTime: string,
  slotLengthMinutes: number
): FixedEventCandidate | null {
  const adjacentNapSlot = [
    shiftTime(startTime, -slotLengthMinutes),
    shiftTime(startTime, slotLengthMinutes),
  ].find(
    (slot): slot is string => slot !== null && client.napSlots.includes(slot)
  );

  if (!adjacentNapSlot) return null;

  return {
    client,
    assignmentType: "BREAK_NAP",
    priority: client.napPriorityCategory === "YOUNGER" ? 10 : 20,
    eventStartTime: adjacentNapSlot,
    eventEndTime:
      shiftTime(adjacentNapSlot, slotLengthMinutes) ?? adjacentNapSlot,
  };
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
  // Keep automatic breaks as plain staff BREAK records. The note retains
  // which fixed client event made this time suitable without turning the
  // client's nap/speech appointment into a staff assignment.
  const eventNote = fixedEvent
    ? ` Aligned with ${fixedEvent.assignmentType === "BREAK_NAP" ? "nap" : "speech"} for ${fixedEvent.client.displayCode} (${fixedEvent.eventStartTime}-${fixedEvent.eventEndTime}). [fixed-event:${fixedEvent.assignmentType}:${fixedEvent.client.id}:${fixedEvent.eventStartTime}-${fixedEvent.eventEndTime}]`
    : "";

  return {
    id: `break-${staffMember.id}-${startTime}`,
    staffId: staffMember.id,
    clientId: fixedEvent?.client.id,
    startTime,
    assignmentType: fixedEvent?.assignmentType ?? "BREAK",
    source: "AUTO",
    // Automatic breaks are regenerated after coverage and must be replaceable
    // on the next Auto Generate or Repair run.
    locked: false,
    note: `Automatically reserved staff break.${eventNote}`,
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
        // A single client's nap can be linked to at most one staff break
        // per slot. Other employees may still take an ordinary break.
        const napLinkKey = fixedEvent?.assignmentType === "BREAK_NAP"
          ? `[fixed-event:BREAK_NAP:${fixedEvent.client.id}:${fixedEvent.eventStartTime}-${fixedEvent.eventEndTime}]`
          : null;
        const alreadyLinked = Boolean(
          napLinkKey &&
          assignments.some(
            (assignment) =>
              assignment.assignmentType === "BREAK" &&
              assignment.note?.includes(napLinkKey)
          )
        );
        const availableEvent = alreadyLinked ? null : fixedEvent;
        const isBtStaff =
          staffMember.role === "BT" || staffMember.role === "RBT";
        const reliefWindowStart = shiftTime(rules.breakWindowStart, -60) ??
          rules.breakWindowStart;
        const reliefWindowEnd = shiftTime(rules.breakWindowEnd, 60) ??
          rules.breakWindowEnd;
        const allowedWindowStart = isBtStaff
          ? rules.breakWindowStart
          : reliefWindowStart;
        const allowedWindowEnd = isBtStaff
          ? rules.breakWindowEnd
          : reliefWindowEnd;
        // The BT lunch window's end is the latest permitted break START.
        // A 2:00 PM BT break therefore occupies 2:00-2:30 PM.
        const insideRoleWindow =
          slotTime >= allowedWindowStart &&
          slotTime <= allowedWindowEnd;
        const insideNapExtension =
          availableEvent?.assignmentType === "BREAK_NAP" &&
          slotTime >= rules.breakWindowStart &&
          slotTime <= NAP_BREAK_WINDOW_END;

        if (!insideRoleWindow && !insideNapExtension) {
          return null;
        }

        return {
          slotTime,
          fixedEvent: availableEvent,
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
      const isBtStaff =
        staffMember.role === "BT" || staffMember.role === "RBT";
      const startMinutes = Number(startTime.slice(0, 2)) * 60 +
        Number(startTime.slice(3, 5));
      const preferredReliefDistance = Math.min(
        Math.abs(startMinutes - (10 * 60 + 30)),
        Math.abs(startMinutes - (14 * 60 + 30))
      );
      const overlapsBtLunchWindow = details.some(
        (detail) =>
          detail.slotTime >= rules.breakWindowStart &&
          detail.slotTime <= rules.breakWindowEnd
      );
      // Managers, BCBAs, interns, and other non-BT staff are relief capacity
      // during BT lunch. Prefer their breaks just before or after that window,
      // while still allowing an in-window fallback when no alternative exists.
      const reliefWindowPenalty =
        !isBtStaff && overlapsBtLunchWindow ? 10_000 : 0;
      const score =
        eventPriority * 10 +
        (isBtStaff ? timeDistanceFromNoon(startTime) : preferredReliefDistance) +
        reliefWindowPenalty -
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
        assignment.startTime <= rules.breakWindowEnd
    )
    .sort((left, right) => {
      const leftClient = clients.find(
        (client) => client.id === left.assignment.clientId
      );
      const rightClient = clients.find(
        (client) => client.id === right.assignment.clientId
      );
      const leftAdjacentNap = leftClient
        ? findAdjacentNapForClientSlot(
            leftClient,
            left.assignment.startTime,
            rules.slotLengthMinutes
          )
        : null;
      const rightAdjacentNap = rightClient
        ? findAdjacentNapForClientSlot(
            rightClient,
            right.assignment.startTime,
            rules.slotLengthMinutes
          )
        : null;

      // First choose a client block immediately before/after that client's
      // 30-minute nap. Moving this one block to relief lets the BT's break
      // sit directly beside the nap and creates one continuous hour away.
      if (Boolean(leftAdjacentNap) !== Boolean(rightAdjacentNap)) {
        return leftAdjacentNap ? -1 : 1;
      }
      if (
        leftAdjacentNap &&
        rightAdjacentNap &&
        leftAdjacentNap.priority !== rightAdjacentNap.priority
      ) {
        return leftAdjacentNap.priority - rightAdjacentNap.priority;
      }

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
          // Client coverage and the owed staff break both outrank soft
          // same-day pairing-count preferences during the final relief pass.
          allowSameDayPairRepeat: true,
          allowCoverageLimitException: true,
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
          reliefRolePriority(left.staffMember.role) -
          reliefRolePriority(right.staffMember.role);

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
        findAdjacentNapForClientSlot(
          client,
          assignment.startTime,
          rules.slotLengthMinutes
        )
      ),
    };
  }

  return null;
}

function countClientStaffRuns(
  clientId: string,
  assignments: SchedulerAssignment[]
): number {
  const ordered = assignments
    .filter(
      (assignment) =>
        assignment.clientId === clientId &&
        assignment.assignmentType === "CLIENT_1_TO_1"
    )
    .sort((left, right) =>
      left.startTime.localeCompare(right.startTime)
    );

  let runs = 0;
  let previousStaffId: string | null = null;

  for (const assignment of ordered) {
    if (assignment.staffId !== previousStaffId) {
      runs += 1;
      previousStaffId = assignment.staffId;
    }
  }

  return runs;
}

function smoothShortClientRuns(
  staff: SchedulerStaff[],
  clients: SchedulerClient[],
  assignments: SchedulerAssignment[],
  referenceAssignments: SchedulerAssignment[],
  callOutStaffIds: Set<string>,
  schedulerRules: SchedulerRules
): void {
  const staffById = new Map(
    staff.map((staffMember) => [staffMember.id, staffMember])
  );

  const maxPasses = Math.max(clients.length * 4, 12);

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false;

    for (const client of clients) {
      const clientAssignments = assignments
        .filter(
          (assignment) =>
            assignment.clientId === client.id &&
            assignment.assignmentType === "CLIENT_1_TO_1"
        )
        .sort((left, right) =>
          left.startTime.localeCompare(right.startTime)
        );

      if (clientAssignments.length < 2) {
        continue;
      }

      const runs: SchedulerAssignment[][] = [];

      for (const assignment of clientAssignments) {
        const currentRun = runs[runs.length - 1];
        const previousAssignment =
          currentRun?.[currentRun.length - 1] ?? null;
        const continuesCurrentRun =
          previousAssignment &&
          previousAssignment.staffId === assignment.staffId &&
          shiftTime(
            previousAssignment.startTime,
            schedulerRules.slotLengthMinutes
          ) === assignment.startTime;

        if (continuesCurrentRun) {
          currentRun.push(assignment);
        } else {
          runs.push([assignment]);
        }
      }

      const staffSwitches = (items: SchedulerAssignment[], staffId: string) => {
        const blocks = items.filter(a => a.staffId === staffId && a.assignmentType === "CLIENT_1_TO_1")
          .sort((a,b) => a.startTime.localeCompare(b.startTime));
        let switches = 0;
        for (let index = 1; index < blocks.length; index++) {
          if (blocks[index].clientId !== blocks[index-1].clientId &&
            shiftTime(blocks[index-1].startTime, schedulerRules.slotLengthMinutes) === blocks[index].startTime) switches++;
        }
        return switches;
      };

      const beforeRunCount = countClientStaffRuns(
        client.id,
        assignments
      );

      for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
        const run = runs[runIndex];

        // Only collapse short AUTO islands. Long blocks are intentional and
        // manual/locked manager decisions are never moved.
        if (
          run.length > 2 ||
          run.some(
            (assignment) =>
              assignment.source !== "AUTO" ||
              assignment.locked ||
              referenceAssignments.some(
                (reference) =>
                  reference.source === "TEMPLATE" &&
                  reference.assignmentType === "CLIENT_1_TO_1" &&
                  reference.staffId === assignment.staffId &&
                  reference.clientId === assignment.clientId &&
                  reference.startTime === assignment.startTime
              )
          )
        ) {
          continue;
        }

        const previousRun = runs[runIndex - 1];
        const nextRun = runs[runIndex + 1];
        const candidateStaffIds = [
          ...(previousRun
            ? [
                {
                  staffId: previousRun[0].staffId,
                  neighborLength: previousRun.length,
                },
              ]
            : []),
          ...(nextRun
            ? [
                {
                  staffId: nextRun[0].staffId,
                  neighborLength: nextRun.length,
                },
              ]
            : []),
        ]
          .filter(
            (candidate, index, all) =>
              candidate.staffId !== run[0].staffId &&
              all.findIndex(
                (other) => other.staffId === candidate.staffId
              ) === index
          )
          .sort(
            (left, right) =>
              right.neighborLength - left.neighborLength
          );

        for (const candidate of candidateStaffIds) {
          const targetStaff = staffById.get(candidate.staffId);

          if (!targetStaff) {
            continue;
          }

          const runIds = new Set(
            run.map((assignment) => assignment.id)
          );
          const simulated = assignments
            .filter((assignment) => !runIds.has(assignment.id))
            .map((assignment) => ({ ...assignment }));
          const replacements: SchedulerAssignment[] = [];
          let valid = true;

          for (const assignment of run) {
            const check = canAssignStaffToClient({
              staffMember: targetStaff,
              client,
              startTime: assignment.startTime,
              assignments: simulated,
              callOutStaffIds,
              rules: schedulerRules,
              allowSameDayPairRepeat: true,
            });

            if (!check.allowed) {
              valid = false;
              break;
            }

            const replacement: SchedulerAssignment = {
              ...assignment,
              id: `smooth-${client.id}-${assignment.startTime}-${targetStaff.id}`,
              staffId: targetStaff.id,
              source: "AUTO",
              locked: false,
              note:
                "Automatically smoothed to keep the client with the same staff for a longer continuous block.",
            };
            replacements.push(replacement);
            simulated.push(replacement);
          }

          if (!valid) {
            continue;
          }

          const afterRunCount = countClientStaffRuns(
            client.id,
            simulated
          );

          // Apply only changes that genuinely reduce the number of staff
          // segments for this client. This makes smoothing converge instead of
          // bouncing a short island back and forth between neighboring staff.
          if (afterRunCount >= beforeRunCount) {
            continue;
          }
          const affectedStaff = [run[0].staffId, targetStaff.id];
          const beforeSwitches = affectedStaff.reduce((sum, id) => sum + staffSwitches(assignments, id), 0);
          const afterSwitches = affectedStaff.reduce((sum, id) => sum + staffSwitches(simulated, id), 0);
          if (afterSwitches > beforeSwitches) continue;

          assignments.splice(
            0,
            assignments.length,
            ...simulated
          );
          changed = true;
          break;
        }

        if (changed) {
          break;
        }
      }

      if (changed) {
        break;
      }
    }

    if (!changed) {
      break;
    }
  }
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
      humanStyleBlockSwapCount: 0,
      humanStylePenaltyBefore: 0,
      humanStylePenaltyAfter: 0,
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

    const isBtStaff =
      staffMember.role === "BT" || staffMember.role === "RBT";
    const earliestBreakStart = isBtStaff
      ? rules.breakWindowStart
      : shiftTime(rules.breakWindowStart, -60) ?? rules.breakWindowStart;
    const latestBreakStart = isBtStaff
      ? rules.breakWindowEnd
      : shiftTime(rules.breakWindowEnd, 60) ?? rules.breakWindowEnd;
    const availableHours =
      (staffMember.availableSlots.length * rules.slotLengthMinutes) / 60;
    const hasBreakWindowAvailability = staffMember.availableSlots.some(
      (slot) =>
        slot >= earliestBreakStart &&
        slot <= latestBreakStart
    );

    if (
      !hasBreakWindowAvailability ||
      availableHours < rules.breakEligibilityHours
    ) {
      continue;
    }

    // BT/RBT lunch is protected for 11:00 AM through a latest 2:00 PM
    // break start. Non-BT staff receive a wider 10:00 AM-3:00 PM window and
    // are preferentially kept available throughout BT lunch for relief.

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

    // Multi-block breaks must be placed as one contiguous free window.
    // Only BT/RBT lunch may use a relief swap: non-BT staff are deliberately
    // retained as coverage during the BT lunch window.
    if (
      rules.defaultBreakMinutes !== rules.slotLengthMinutes ||
      !isBtStaff
    ) {
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

  // Break placement can occasionally create a one- or two-block island in a
  // client's day. After every required break is secured, collapse those small
  // AUTO islands into the neighboring staff/client block when the move remains
  // fully legal. Coverage and breaks stay unchanged; the calendar simply
  // becomes easier to read.
  smoothShortClientRuns(
    staff,
    clients,
    assignments,
    referenceAssignments,
    callOutSet,
    schedulerRules
  );

  // Final human-style pass: with coverage and all owed breaks already secured,
  // exchange whole overlapping client blocks between staff when doing so
  // creates a cleaner 2-client/2-staff style day. This is deliberately a soft
  // optimizer, not a hard rule: it never removes coverage or a break, and every
  // proposed exchange is revalidated against availability, restrictions,
  // service setting, daily limits, and the four-hour continuous maximum.
  const humanBalance = balanceScheduleLikeHuman({
    staff,
    clients,
    assignments,
    referenceAssignments,
    callOutStaffIds,
    rules: schedulerRules,
  });

  return {
    assignments: humanBalance.assignments,
    reservedBreaks,
    reliefSwapCount,
    humanStyleBlockSwapCount: humanBalance.blockSwapCount,
    humanStylePenaltyBefore: humanBalance.penaltyBefore,
    humanStylePenaltyAfter: humanBalance.penaltyAfter,
    unplacedBreakStaffIds,
  };
}
