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

    if (previous && previous.staffId === assignment.staffId) {
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
    const desiredStaff = isRotationClient
      ? Math.max(client.desiredDifferentStaffPerDay ?? preferredStaffPerClient, 1)
      : preferredStaffPerClient;

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

    if (distinctClients < preferredClientsPerStaff) {
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

export function balanceScheduleLikeHuman({
  staff,
  clients,
  assignments: initialAssignments,
  callOutStaffIds,
  rules,
}: {
  staff: SchedulerStaff[];
  clients: SchedulerClient[];
  assignments: SchedulerAssignment[];
  callOutStaffIds: string[];
  rules: SchedulerRules;
}): HumanStyleBlockBalanceResult {
  const assignments = initialAssignments.map((assignment) => ({
    ...assignment,
  }));
  const penaltyBefore = schedulePenalty(
    assignments,
    staff,
    clients,
    rules
  );

  if (rules.humanStyleBlockBalancingEnabled === false) {
    return {
      assignments,
      blockSwapCount: 0,
      penaltyBefore,
      penaltyAfter: penaltyBefore,
    };
  }

  const staffById = new Map(
    staff.map((member) => [member.id, member])
  );
  const clientById = new Map(
    clients.map((client) => [client.id, client])
  );
  const callOutSet = new Set(callOutStaffIds);
  let working = assignments;
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

    for (const candidate of candidates) {
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
