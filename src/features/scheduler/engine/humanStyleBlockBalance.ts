import { canAssignStaffToClient } from "./constraints";
import type {
  SchedulerAssignment,
  SchedulerClient,
  SchedulerRules,
  SchedulerStaff,
} from "./types";

export type HumanStyleBlockBalanceResult = {
  assignments: SchedulerAssignment[];
  blockSwapCount: number;
  penaltyBefore: number;
  penaltyAfter: number;
};

type SwapPair = {
  left: SchedulerAssignment;
  right: SchedulerAssignment;
};

type SwapCandidate = {
  pairs: SwapPair[];
  leftStaffId: string;
  rightStaffId: string;
  startTime: string;
};

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

function matchesExactTemplateReference(
  assignment: SchedulerAssignment,
  referenceAssignments: SchedulerAssignment[]
): boolean {
  return referenceAssignments.some(
    (reference) =>
      reference.source === "TEMPLATE" &&
      reference.assignmentType === "CLIENT_1_TO_1" &&
      reference.staffId === assignment.staffId &&
      reference.clientId === assignment.clientId &&
      reference.startTime === assignment.startTime
  );
}

function isMutableClientAssignment(
  assignment: SchedulerAssignment | undefined
): assignment is SchedulerAssignment & { clientId: string } {
  return Boolean(
    assignment &&
      assignment.assignmentType === "CLIENT_1_TO_1" &&
      assignment.clientId &&
      assignment.source === "AUTO" &&
      assignment.locked === false
  );
}

function clientRuns(
  clientId: string,
  assignments: SchedulerAssignment[]
): SchedulerAssignment[][] {
  const ordered = assignments
    .filter(
      (assignment) =>
        assignment.assignmentType === "CLIENT_1_TO_1" &&
        assignment.clientId === clientId
    )
    .sort((left, right) => left.startTime.localeCompare(right.startTime));

  const runs: SchedulerAssignment[][] = [];

  for (const assignment of ordered) {
    const current = runs[runs.length - 1];
    const previous = current?.[current.length - 1];

    if (previous && previous.staffId === assignment.staffId &&
      shiftTime(previous.startTime, 30) === assignment.startTime) {
      current.push(assignment);
    } else {
      runs.push([assignment]);
    }
  }

  return runs;
}

function staffClientIds(
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

function clientStaffIds(
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

function schedulePenalty(
  assignments: SchedulerAssignment[],
  staff: SchedulerStaff[],
  clients: SchedulerClient[],
  rules: SchedulerRules
): number {
  let penalty = 0;
  const preferredClientsPerStaff = Math.max(
    rules.preferredClientsPerStaffPerDay ?? 2,
    1
  );
  const preferredStaffPerClient = Math.max(
    rules.preferredStaffPerClientPerDay ?? 2,
    1
  );

  for (const client of clients) {
    const ownAssignments = assignments.filter(
      (assignment) =>
        assignment.assignmentType === "CLIENT_1_TO_1" &&
        assignment.clientId === client.id
    );

    if (ownAssignments.length === 0) {
      continue;
    }

    const runs = clientRuns(client.id, assignments);
    const distinctStaff = clientStaffIds(client.id, assignments).size;
    const isRotationClient =
      client.supportLevel === "ROTATION" ||
      client.supportLevel === "HIGH_SUPPORT";
    // Only explicitly rotational/high-support clients require different
    // staff. Ordinary clients should not be split purely to reach a
    // generic "two staff per client" balancing target.
    const desiredStaff = isRotationClient
      ? Math.max(client.desiredDifferentStaffPerDay ?? preferredStaffPerClient, 1)
      : Math.max(client.desiredDifferentStaffPerDay ?? 1, 1);

    // Human-readable schedules avoid one-block islands and repeated handoffs.
    penalty += Math.max(runs.length - 1, 0) * 65;
    for (const run of runs) {
      if (run.length === 1) penalty += 80;
      else if (run.length === 2) penalty += 20;
    }

    // For clients present for at least four hours, two stable staff blocks are
    // usually easier to operate than one person owning the entire day or many
    // short technician fragments. This remains a soft target only.
    if (ownAssignments.length >= 8) {
      if (distinctStaff < desiredStaff) {
        penalty += (desiredStaff - distinctStaff) * 70;
      }
      if (distinctStaff > desiredStaff) {
        penalty += (distinctStaff - desiredStaff) * 95;
      }
    }
  }

  for (const member of staff) {
    if (!["BT", "RBT", "INTERN"].includes(member.role)) {
      continue;
    }

    const clientAssignments = assignments.filter(
      (assignment) =>
        assignment.staffId === member.id &&
        assignment.assignmentType === "CLIENT_1_TO_1"
    );

    if (clientAssignments.length < 8) {
      continue;
    }

    const distinctClients = staffClientIds(member.id, assignments).size;

    // One continuous compatible client run is better than unnecessary
    // switching solely to meet a default diversity count. Explicit rotation
    // is handled at the client level above.
    if (distinctClients < preferredClientsPerStaff &&
      rules.preventSameStaffClientRepeatSameDay) {
      penalty +=
        (preferredClientsPerStaff - distinctClients) * 110;
    }

    if (distinctClients > rules.maximumClientsPerTechPerDay) {
      penalty +=
        (distinctClients - rules.maximumClientsPerTechPerDay) * 250;
    }
  }

  return penalty;
}

function naturalBoundaryBonus(
  candidate: SwapCandidate,
  assignments: SchedulerAssignment[],
  rules: SchedulerRules
): number {
  const previousTime = shiftTime(
    candidate.startTime,
    -rules.slotLengthMinutes
  );
  let bonus = 0;

  if (candidate.startTime >= "11:00" && candidate.startTime < "14:30") {
    bonus += 20;
  }

  if (previousTime) {
    for (const staffId of [
      candidate.leftStaffId,
      candidate.rightStaffId,
    ]) {
      const previous = assignments.find(
        (assignment) =>
          assignment.staffId === staffId &&
          assignment.startTime === previousTime
      );

      if (
        previous &&
        ["BREAK", "BREAK_NAP", "BREAK_SPEECH"].includes(
          previous.assignmentType
        )
      ) {
        bonus += 45;
      }
    }
  }

  return bonus;
}

function buildSwapCandidates(
  staff: SchedulerStaff[],
  assignments: SchedulerAssignment[],
  slotLengthMinutes: number
): SwapCandidate[] {
  const byCell = new Map(
    assignments.map((assignment) => [
      `${assignment.staffId}|${assignment.startTime}`,
      assignment,
    ])
  );
  const allTimes = [
    ...new Set(assignments.map((assignment) => assignment.startTime)),
  ].sort();
  const candidates: SwapCandidate[] = [];

  for (let leftIndex = 0; leftIndex < staff.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < staff.length;
      rightIndex += 1
    ) {
      const leftStaff = staff[leftIndex];
      const rightStaff = staff[rightIndex];
      let current: SwapPair[] = [];
      let currentClientKey = "";
      let previousTime: string | null = null;

      const flush = () => {
        if (current.length >= 2) {
          candidates.push({
            pairs: current,
            leftStaffId: leftStaff.id,
            rightStaffId: rightStaff.id,
            startTime: current[0].left.startTime,
          });
        }
        current = [];
        currentClientKey = "";
        previousTime = null;
      };

      for (const startTime of allTimes) {
        const left = byCell.get(`${leftStaff.id}|${startTime}`);
        const right = byCell.get(`${rightStaff.id}|${startTime}`);

        if (
          !isMutableClientAssignment(left) ||
          !isMutableClientAssignment(right) ||
          left.clientId === right.clientId
        ) {
          flush();
          continue;
        }

        const clientKey = `${left.clientId}|${right.clientId}`;
        const contiguous =
          previousTime !== null &&
          shiftTime(previousTime, slotLengthMinutes) === startTime;

        if (
          current.length > 0 &&
          (!contiguous || clientKey !== currentClientKey)
        ) {
          flush();
        }

        current.push({ left, right });
        currentClientKey = clientKey;
        previousTime = startTime;
      }

      flush();
    }
  }

  return candidates;
}

function trySwapCandidate(
  candidate: SwapCandidate,
  staffById: Map<string, SchedulerStaff>,
  clientById: Map<string, SchedulerClient>,
  assignments: SchedulerAssignment[],
  callOutStaffIds: Set<string>,
  rules: SchedulerRules
): SchedulerAssignment[] | null {
  const leftStaff = staffById.get(candidate.leftStaffId);
  const rightStaff = staffById.get(candidate.rightStaffId);

  if (!leftStaff || !rightStaff) {
    return null;
  }

  const removedIds = new Set(
    candidate.pairs.flatMap(({ left, right }) => [left.id, right.id])
  );
  const simulated = assignments
    .filter((assignment) => !removedIds.has(assignment.id))
    .map((assignment) => ({ ...assignment }));

  for (const { left, right } of candidate.pairs) {
    if (!left.clientId || !right.clientId) {
      return null;
    }

    const leftClient = clientById.get(left.clientId);
    const rightClient = clientById.get(right.clientId);

    if (!leftClient || !rightClient) {
      return null;
    }

    const leftCheck = canAssignStaffToClient({
      staffMember: leftStaff,
      client: rightClient,
      startTime: left.startTime,
      assignments: simulated,
      callOutStaffIds,
      rules,
      allowSameDayPairRepeat: true,
    });

    if (!leftCheck.allowed) {
      return null;
    }

    const leftReplacement: SchedulerAssignment = {
      ...left,
      id: `human-swap-${leftStaff.id}-${rightClient.id}-${left.startTime}`,
      clientId: rightClient.id,
      note:
        "Human-style block balance: exchanged a continuous client block to reduce fragmented pairings and balance staff/client variety.",
    };
    simulated.push(leftReplacement);

    const rightCheck = canAssignStaffToClient({
      staffMember: rightStaff,
      client: leftClient,
      startTime: right.startTime,
      assignments: simulated,
      callOutStaffIds,
      rules,
      allowSameDayPairRepeat: true,
    });

    if (!rightCheck.allowed) {
      return null;
    }

    simulated.push({
      ...right,
      id: `human-swap-${rightStaff.id}-${leftClient.id}-${right.startTime}`,
      clientId: leftClient.id,
      note:
        "Human-style block balance: exchanged a continuous client block to reduce fragmented pairings and balance staff/client variety.",
    });
  }

  return simulated;
}

/**
 * Repair the common linked-nap handoff pattern:
 *   A: BREAK_NAP(client) -> client coverage
 *   B: empty             -> BREAK
 * when B covered that same client immediately before the nap.
 * Exchange breaks and hand the post-nap client block back to B.
 * Both original breaks still exist, only their staff/time locations change.
 */
/**
 * Reassign a linked nap break to another compatible, idle staff member who
 * already has a movable ordinary break. Keep ALL client coverage unchanged.
 * The original linked-break owner receives a break in a genuinely free slot;
 * the receiving staff member's prior ordinary break is removed.
 */
export function repairLinkedNapReliefHandoffs(
  initial: SchedulerAssignment[],
  staff: SchedulerStaff[],
  clients: SchedulerClient[],
  callOutStaffIds: string[],
  _rules: SchedulerRules
): SchedulerAssignment[] {
  const result = initial.map(a => ({ ...a }));
  const byClient = new Map(clients.map(c => [c.id, c]));
  const absent = new Set(callOutStaffIds);
  const breakTypes = new Set(["BREAK", "BREAK_NAP", "BREAK_SPEECH"]);
  const breakStart = "11:00", breakEnd = "14:00";
  for (const linked of [...result]) {
    if (linked.assignmentType !== "BREAK_NAP" || !linked.clientId ||
      linked.source !== "AUTO" || absent.has(linked.staffId)) continue;
    const client = byClient.get(linked.clientId);
    if (!client || !client.napSlots.includes(linked.startTime)) continue;
    const owner = staff.find(p => p.id === linked.staffId);
    if (!owner) continue;
    // A correct linked nap must NEVER be handed away from the staff member
    // already covering this child immediately before or after the nap.
    // The older relief optimizer transferred the nap to an idle therapist
    // merely to relocate a break, creating the exact IsMo/JeMa fragmentation.
    const before = shiftTime(linked.startTime,-_rules.slotLengthMinutes);
    const after = shiftTime(linked.startTime,_rules.slotLengthMinutes);
    const isExistingCaregiver = [before,after].some(time =>
      result.some(a => a.staffId===owner.id && a.clientId===client.id &&
        a.startTime===time && a.assignmentType==="CLIENT_1_TO_1"));
    if (isExistingCaregiver) continue;
    // Never transfer the break if the original employee has another break.
    if (result.filter(a => a.staffId === owner.id && breakTypes.has(a.assignmentType)).length !== 1) continue;
    // A linked nap only moves to a staff member genuinely free at the nap time.
    for (const candidate of staff) {
      if (candidate.id === owner.id || absent.has(candidate.id) ||
        !candidate.availableSlots.includes(linked.startTime) ||
        result.some(a => a.staffId === candidate.id && a.startTime === linked.startTime) ||
        client.staffRelationships[candidate.id] === "HARD_RESTRICTION") continue;
      if (candidate.serviceSetting && client.serviceSetting &&
        candidate.serviceSetting !== "BOTH" && client.serviceSetting !== "BOTH" &&
        candidate.serviceSetting !== client.serviceSetting) continue;
      const candidateBreaks = result.filter(a => a.staffId === candidate.id && breakTypes.has(a.assignmentType));
      if (candidateBreaks.length !== 1) continue;
      const ordinaryBreak = candidateBreaks[0];
      if (ordinaryBreak.assignmentType !== "BREAK" || ordinaryBreak.source !== "AUTO" ||
        !ordinaryBreak.startTime || ordinaryBreak.startTime === linked.startTime) continue;
      // Find another truly empty legal break cell for the previous nap-break owner,
      // excluding the nap itself; never displace or erase client coverage.
      const alternative = owner.availableSlots
        .filter(time => time >= breakStart && time < breakEnd &&
          time !== linked.startTime &&
          !result.some(a => a.staffId === owner.id && a.startTime === time))
        .sort((a,b) => {
          const near = (t:string) => {
            const [h,m] = t.split(":").map(Number);
            return Math.abs(h*60+m-750);
          };
          return near(a)-near(b) || a.localeCompare(b);
        })[0];
      if (!alternative) continue;
      const replacementLinked:SchedulerAssignment = {
        ...linked, id:`nap-relief-linked-${client.id}-${linked.startTime}-${candidate.id}`,
        staffId:candidate.id,
        note:"Linked nap break placed with eligible staff available at the nap time."
      };
      const replacementBreak:SchedulerAssignment = {
        ...ordinaryBreak, id:`nap-relief-break-${owner.id}-${alternative}`,
        staffId:owner.id, startTime:alternative,
        note:"Relocated break without interrupting any client coverage."
      };
      const dropped = new Set([linked.id, ordinaryBreak.id]);
      const simulated = result.filter(a => !dropped.has(a.id));
      // Guard against staff double-booking and duplicate nap supervision.
      if (simulated.some(a => (a.staffId === candidate.id && a.startTime === linked.startTime) ||
        (a.staffId === owner.id && a.startTime === alternative) ||
        (a.clientId === client.id && a.startTime === linked.startTime))) continue;
      result.splice(0, result.length, ...simulated, replacementLinked, replacementBreak);
      break;
    }
  }
  return result;
}

export function balanceScheduleLikeHuman({
  staff,
  clients,
  assignments: initialAssignments,
  referenceAssignments = [],
  callOutStaffIds,
  rules,
}: {
  staff: SchedulerStaff[];
  clients: SchedulerClient[];
  assignments: SchedulerAssignment[];
  referenceAssignments?: SchedulerAssignment[];
  callOutStaffIds: string[];
  rules: SchedulerRules;
}): HumanStyleBlockBalanceResult {
  const assignments = initialAssignments.map((assignment) => ({
    ...assignment,
  }));
  const penaltyBefore = schedulePenalty(assignments, staff, clients, rules);
  // Mandatory safe continuity repair is independent of optional stylistic
  // balancing. A disabled stylistic optimizer must not disable nap relief.
  const repaired = repairLinkedNapReliefHandoffs(
    assignments, staff, clients, callOutStaffIds, rules
  );
  const repairedPenalty = schedulePenalty(repaired, staff, clients, rules);

  if (rules.humanStyleBlockBalancingEnabled === false) {
    return {
      assignments: repaired,
      blockSwapCount: 0,
      penaltyBefore,
      penaltyAfter: repairedPenalty,
    };
  }

  const staffById = new Map(
    staff.map((member) => [member.id, member])
  );
  const clientById = new Map(
    clients.map((client) => [client.id, client])
  );
  const callOutSet = new Set(callOutStaffIds);
  let working = repaired;
  let blockSwapCount = 0;
  const maxPasses = Math.max(staff.length * 2, 12);

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const currentPenalty = schedulePenalty(
      working,
      staff,
      clients,
      rules
    );
    let bestAssignments: SchedulerAssignment[] | null = null;
    let bestAdjustedPenalty = currentPenalty;
    let bestRawPenalty = currentPenalty;

    const candidates = buildSwapCandidates(
      staff,
      working,
      rules.slotLengthMinutes
    );

    const originalHandoffs = clients.reduce((total, client) =>
      total + Math.max(0, clientRuns(client.id, working).length - 1), 0);

    for (const candidate of candidates) {
      const containsExactTemplateMatch = candidate.pairs.some(
        ({ left, right }) =>
          matchesExactTemplateReference(left, referenceAssignments) ||
          matchesExactTemplateReference(right, referenceAssignments)
      );

      if (containsExactTemplateMatch) {
        continue;
      }

      const swapped = trySwapCandidate(
        candidate,
        staffById,
        clientById,
        working,
        callOutSet,
        rules
      );

      if (!swapped) {
        continue;
      }
      const swappedHandoffs = clients.reduce((total, client) =>
        total + Math.max(0, clientRuns(client.id, swapped).length - 1), 0);
      if (swappedHandoffs > originalHandoffs) {
        // Stylistic balancing cannot fragment an otherwise healthy pairing.
        continue;
      }

      const rawPenalty = schedulePenalty(
        swapped,
        staff,
        clients,
        rules
      );
      const adjustedPenalty =
        rawPenalty -
        naturalBoundaryBonus(candidate, working, rules);

      if (
        adjustedPenalty < bestAdjustedPenalty - 5 ||
        (adjustedPenalty === bestAdjustedPenalty &&
          rawPenalty < bestRawPenalty)
      ) {
        bestAssignments = swapped;
        bestAdjustedPenalty = adjustedPenalty;
        bestRawPenalty = rawPenalty;
      }
    }

    if (!bestAssignments || bestRawPenalty >= currentPenalty) {
      break;
    }

    working = bestAssignments;
    blockSwapCount += 1;
  }

  return {
    assignments: working,
    blockSwapCount,
    penaltyBefore,
    penaltyAfter: schedulePenalty(
      working,
      staff,
      clients,
      rules
    ),
  };
}
