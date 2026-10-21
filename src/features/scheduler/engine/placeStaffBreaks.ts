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
  // A linked break occupies one cell: the staff break and supervised client
  // event are represented together, not as competing or duplicate cells.
  return {
    id: `break-${staffMember.id}-${startTime}`,
    staffId: staffMember.id,
    clientId: fixedEvent?.client.id,
    startTime,
    assignmentType: fixedEvent?.assignmentType ?? "BREAK",
    source: "AUTO",
    locked: true,
    note: fixedEvent
      ? "Staff break linked to the client's fixed nap/speech event."
      : "Automatically reserved staff break.",
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
        const alreadyLinked = fixedEvent?.assignmentType === "BREAK_NAP" &&
          assignments.some((assignment) =>
            assignment.clientId === fixedEvent.client.id &&
            assignment.startTime === slotTime);
        const availableEvent = alreadyLinked ? null : fixedEvent;
        const insideNormalWindow =
          slotTime >= rules.breakWindowStart &&
          slotTime <= rules.breakWindowEnd;
        const insideNapExtension =
          availableEvent?.assignmentType === "BREAK_NAP" &&
          slotTime >= rules.breakWindowStart &&
          slotTime <= NAP_BREAK_WINDOW_END;

        if (!insideNormalWindow && !insideNapExtension) {
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
      // Avoid choosing an ordinary break inside an otherwise continuous
      // client/staff run. A break linked to the client's nap/speech is the
      // intentional exception and is scored by its fixed event priority.
      const priorTime = shiftTime(startTime, -rules.slotLengthMinutes);
      const nextTime = shiftTime(
        startTime, rules.defaultBreakMinutes
      );
      const prior = assignments.find(a => a.staffId === staffMember.id &&
        a.startTime === priorTime && a.assignmentType === "CLIENT_1_TO_1");
      const next = assignments.find(a => a.staffId === staffMember.id &&
        a.startTime === nextTime && a.assignmentType === "CLIENT_1_TO_1");
      const splitsClientRun = Boolean(prior?.clientId &&
        next?.clientId && prior.clientId === next.clientId);
      const splitsStaffRun = Boolean(prior && next);
      const plainBreak = details.every(detail => !detail.fixedEvent);
      const interruptionPenalty = plainBreak
        ? (splitsClientRun ? 500 : splitsStaffRun ? 200 : 0)
        : 0;
      const score =
        eventPriority * 10 +
        timeDistanceFromNoon(startTime) -
        Math.min(historicalCount, 4) * historicalPriority +
        interruptionPenalty;

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

/**
 * When the client has a confirmed nap, prefer using that 30-minute window
 * for the linked staff break instead of leaving a blank calendar cell and
 * retaining an unrelated automatic plain BREAK elsewhere.
 * Only movable AUTO breaks are considered; protected/template breaks stay put.
 */
function alignPlainBreaksWithAdjacentNaps(
  assignments: SchedulerAssignment[],
  staff: SchedulerStaff[],
  clients: SchedulerClient[],
  rules: PostCoverageBreakRules
): SchedulerAssignment[] {
  if (rules.defaultBreakMinutes !== rules.slotLengthMinutes) return assignments;
  const result=assignments.map(a=>({...a}));
  for(const person of staff) {
    const ownedBreaks=result.filter(a=>a.staffId===person.id&&
      ["BREAK","BREAK_NAP","BREAK_SPEECH"].includes(a.assignmentType));
    if(ownedBreaks.length!==1||ownedBreaks[0].assignmentType!=="BREAK"||
      ownedBreaks[0].source!=="AUTO")continue;
    const old=ownedBreaks[0];
    // A plain break can already be sitting on the client's selected nap.
    // Convert that SAME cell to BREAK_NAP before trying to move it elsewhere.
    const fixedHere=findFixedEventForStaffSlot(person.id,old.startTime,result,clients,rules.slotLengthMinutes);
    if(fixedHere?.assignmentType==="BREAK_NAP" &&
      !result.some(a=>a.clientId===fixedHere.client.id&&a.startTime===old.startTime)) {
      const at=result.findIndex(a=>a.id===old.id&&a.staffId===person.id);
      if(at>=0) {
        result[at]=createBreakAssignment(person,old.startTime,fixedHere);
        continue;
      }
    }
    const choices=person.availableSlots.filter(time=>
      time>=rules.breakWindowStart&&time<=rules.breakWindowEnd &&
      time!==old.startTime &&
      !result.some(a=>a.staffId===person.id&&a.startTime===time)
    ).map(time=>({time,event:findFixedEventForStaffSlot(
      person.id,time,result,clients,rules.slotLengthMinutes
    )})).filter(item=>item.event?.assignmentType==="BREAK_NAP" &&
      !result.some(a=>a.clientId===item.event?.client.id&&a.startTime===item.time));
    if(choices.length===0)continue;
    choices.sort((a,b)=>Math.abs(timeDistanceFromNoon(a.time))-Math.abs(timeDistanceFromNoon(b.time)));
    const chosen=choices[0],at=result.findIndex(a=>a.id===old.id&&a.staffId===person.id);
    if(at<0||!chosen.event)continue;
    result[at]=createBreakAssignment(person,chosen.time,chosen.event);
  }
  return result;
}


/**
 * An explicit client nap has priority over ordinary staff lunches.
 * Each nap receives exactly one eligible, free caregiver and a single BREAK_NAP.
 * Impossible naps remain absent and are rejected by the final event audit.
 */
/**
 * Nap belongs to the CLIENT, break belongs to STAFF. Both have independent
 * completion states. A supervised NAP is valid even when the caregiver took
 * their staff break elsewhere. Only BREAK_NAP satisfies both.
 *
 * Prefer a caregiver who had this child in the preceding 30-minute slot.
 * When that caregiver already has a movable AUTO BREAK later, move that same
 * break to the nap and FREE the later slot. Do not require the caregiver to
 * continue with the same child after the nap; a handoff is entirely valid.
 */
function reserveRequiredNapBreaks(
  assignments:SchedulerAssignment[],
  staff:SchedulerStaff[],
  clients:SchedulerClient[],
  callOutStaffIds:Set<string>,
  rules:PostCoverageBreakRules
):void {
  const staffById=new Map(staff.map(person=>[person.id,person]));
  const clientsOrdered=[...clients].sort((a,b)=>
    Number(a.napPriorityCategory!=="YOUNGER")-Number(b.napPriorityCategory!=="YOUNGER")||
    a.displayCode.localeCompare(b.displayCode));

  function canSupervise(person:SchedulerStaff,client:SchedulerClient,time:string):boolean {
    return !callOutStaffIds.has(person.id) && person.availableSlots.includes(time) &&
      client.staffRelationships[person.id]!=="HARD_RESTRICTION" &&
      (!person.serviceSetting||!client.serviceSetting||
        person.serviceSetting==="BOTH"||client.serviceSetting==="BOTH"||
        person.serviceSetting===client.serviceSetting);
  }

  function linkDecision(person:SchedulerStaff,time:string) {
    const ownBreaks=assignments.filter(a=>a.staffId===person.id&&isBreakAssignment(a));
    const movable=ownBreaks.filter(a=>a.assignmentType==="BREAK"&&a.source==="AUTO");
    const protectedBreak=ownBreaks.some(a=>a.assignmentType!=="BREAK"||a.source!=="AUTO");
    return {
      shouldLink:rules.defaultBreakMinutes===rules.slotLengthMinutes &&
        time>=rules.breakWindowStart && time<=rules.breakWindowEnd &&
        !protectedBreak,
      movable
    };
  }

  function relocateMovableBreaks(movable:SchedulerAssignment[]) {
    // A future automatic plain break cannot block a nap-linked break.
    // Saved MANUAL, COPIED and TEMPLATE breaks are never removed here.
    const obsolete=new Set(movable.map(a=>a.id));
    for(let i=assignments.length-1;i>=0;i--)
      if(obsolete.has(assignments[i].id))assignments.splice(i,1);
  }

  for(const client of clientsOrdered){
    for(const time of [...new Set(client.napSlots)].sort()){
      const current=assignments.find(a=>a.clientId===client.id&&a.startTime===time);
      if(current) {
        // A protected NAP or an existing NAP may already be assigned to an
        // eligible caregiver. Respect that real supervision; don't duplicate.
        if(current.assignmentType==="NAP"){
          const caregiver=staffById.get(current.staffId);
          if(!caregiver||!canSupervise(caregiver,client,time))continue;
          const decision=linkDecision(caregiver,time);
          if(decision.shouldLink){
            relocateMovableBreaks(decision.movable);
            const index=assignments.findIndex(a=>a.id===current.id);
            if(index>=0)assignments[index]={
              ...assignments[index],assignmentType:"BREAK_NAP",
              note:(current.note?current.note+" | ":"")+
                "Client nap and caregiver break linked in one 30-minute slot."
            };
          }
        }
        continue;
      }

      const before=shiftTime(time,-rules.slotLengthMinutes);
      const after=shiftTime(time,rules.slotLengthMinutes);
      const eligible=staff.filter(person=>canSupervise(person,client,time)&&
        !assignments.some(a=>a.staffId===person.id&&a.startTime===time));

      // Explicit priority tiers, not just a weak scoring bonus:
      // (1) therapist who already covers the child BEFORE this nap,
      // (2) therapist who covers the child AFTER the nap,
      // (3) other eligible caregivers.
      // This prevents a free relief worker from "stealing" a supervised
      // nap and forcing an avoidable client-staff handoff.
      const adjacentCoverage=(person:SchedulerStaff,at:string|null)=>
        Boolean(at&&assignments.some(row=>
          row.staffId===person.id&&row.clientId===client.id&&
          row.startTime===at&&row.assignmentType==="CLIENT_1_TO_1"));
      const rank=(person:SchedulerStaff)=>{
        const beforeRank=adjacentCoverage(person,before)?0:
          adjacentCoverage(person,after)?1:2;
        const decision=linkDecision(person,time);
        return beforeRank*100+(decision.shouldLink?0:15)+
          (decision.movable.length?0:1)+coverageRoleTier(person.role)*3;
      };
      eligible.sort((a,b)=>rank(a)-rank(b)||a.name.localeCompare(b.name));
      const caregiver=eligible[0];
      if(!caregiver)continue;
      const decision=linkDecision(caregiver,time);
      if(decision.shouldLink)relocateMovableBreaks(decision.movable);
      const linked=decision.shouldLink;
      assignments.push({
        id:`nap-${client.id}-${time}-${caregiver.id}`,
        staffId:caregiver.id,clientId:client.id,startTime:time,
        assignmentType:linked?"BREAK_NAP":"NAP",
        source:"AUTO",locked:false,
        note:linked
          ? "30-minute client nap supervised by existing caregiver; caregiver break combined here."
          : "30-minute client nap supervised; caregiver's separate staff break remains unchanged."
      });
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

  // Required Nap sessions are always allocated before ordinary staff breaks.
  reserveRequiredNapBreaks(assignments,staff,clients,callOutSet,rules);

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

    const hasBreakWindowAvailability = staffMember.availableSlots.some(
      (slot) =>
        slot >= rules.breakWindowStart &&
        slot <= rules.breakWindowEnd
    );

    if (!hasBreakWindowAvailability) {
      continue;
    }

    // Every scheduled staff member who is present during the clinic break
    // window is owed one break. The old
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

  const napAlignedAssignments=alignPlainBreaksWithAdjacentNaps(
    humanBalance.assignments,staff,clients,rules
  );
  return {
    assignments: napAlignedAssignments,
    reservedBreaks: napAlignedAssignments.filter(isBreakAssignment),
    reliefSwapCount,
    humanStyleBlockSwapCount: humanBalance.blockSwapCount,
    humanStylePenaltyBefore: humanBalance.penaltyBefore,
    humanStylePenaltyAfter: humanBalance.penaltyAfter,
    unplacedBreakStaffIds:unplacedBreakStaffIds.filter(id=>
      !napAlignedAssignments.some(a=>a.staffId===id&&isBreakAssignment(a))
    ),
  };
}
