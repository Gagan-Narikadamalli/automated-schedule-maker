import { canAssignStaffToClient } from "./constraints";
import { scoreCandidate } from "./scoring";
import type {
  SchedulerAssignment,
  SchedulerClient,
  SchedulerInput,
  SchedulerResult,
  SchedulerStaff,
  UncoveredRequirement,
} from "./types";

type ClientRequirement = {
  client: SchedulerClient;
  startTime: string;
};

type SwapCandidate = {
  assignmentIndex: number;
  displacedAssignment: SchedulerAssignment;
  replacementStaff: SchedulerStaff;
  uncoveredStaff: SchedulerStaff;
  score: number;
};

function shouldPreserveExistingAssignment(
  assignment: SchedulerAssignment
): boolean {
  if (assignment.locked || assignment.source === "MANUAL") {
    return true;
  }

  return (
    assignment.assignmentType === "SPEECH" ||
    assignment.assignmentType === "UNAVAILABLE" ||
    assignment.assignmentType === "BREAK" ||
    assignment.assignmentType === "BREAK_NAP" ||
    assignment.assignmentType === "BREAK_SPEECH"
  );
}

function requirementIsAlreadyCovered(
  requirement: ClientRequirement,
  assignments: SchedulerAssignment[]
): boolean {
  return assignments.some(
    (assignment) =>
      assignment.clientId === requirement.client.id &&
      assignment.startTime === requirement.startTime &&
      assignment.assignmentType === "CLIENT_1_TO_1"
  );
}

function buildRequirements(clients: SchedulerClient[]): ClientRequirement[] {
  return clients.flatMap((client) =>
    client.requiredSlots.map((startTime) => ({
      client,
      startTime,
    }))
  );
}

function timeToMinutes(time: string): number | null {
  const [hoursText, minutesText] = time.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);

  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return hours * 60 + minutes;
}

function minutesToTime(totalMinutes: number): string {
  const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function samePairAtSlot(
  staffId: string,
  clientId: string,
  startTime: string,
  assignments: SchedulerAssignment[]
): boolean {
  return assignments.some(
    (assignment) =>
      assignment.staffId === staffId &&
      assignment.clientId === clientId &&
      assignment.startTime === startTime &&
      assignment.assignmentType === "CLIENT_1_TO_1"
  );
}

function priorContiguousPairBlocks(
  staffId: string,
  clientId: string,
  startTime: string,
  assignments: SchedulerAssignment[],
  slotLengthMinutes: number
): number {
  const targetMinutes = timeToMinutes(startTime);
  if (targetMinutes === null) return 0;

  let count = 0;
  for (
    let minute = targetMinutes - slotLengthMinutes;
    minute >= 0 &&
    samePairAtSlot(
      staffId,
      clientId,
      minutesToTime(minute),
      assignments
    );
    minute -= slotLengthMinutes
  ) {
    count += 1;
  }

  return count;
}

function buildMinimumPairingPlan(
  requirement: ClientRequirement,
  staffMember: SchedulerStaff,
  input: SchedulerInput,
  assignments: SchedulerAssignment[],
  callOutStaffIds: Set<string>
): SchedulerAssignment[] | null {
  const minimumBlocks = Math.max(
    Math.ceil(
      input.rules.minimumClientStaffAssignmentMinutes /
        input.rules.slotLengthMinutes
    ),
    1
  );

  const priorBlocks = priorContiguousPairBlocks(
    staffMember.id,
    requirement.client.id,
    requirement.startTime,
    assignments,
    input.rules.slotLengthMinutes
  );
  const blocksNeededFromCurrent = Math.max(
    minimumBlocks - priorBlocks,
    1
  );
  const startMinutes = timeToMinutes(requirement.startTime);

  if (startMinutes === null) {
    return null;
  }

  const simulated = assignments.map((assignment) => ({ ...assignment }));
  const planned: SchedulerAssignment[] = [];

  for (let index = 0; index < blocksNeededFromCurrent; index += 1) {
    const slot = minutesToTime(
      startMinutes + index * input.rules.slotLengthMinutes
    );

    if (!requirement.client.requiredSlots.includes(slot)) {
      return null;
    }

    if (
      samePairAtSlot(
        staffMember.id,
        requirement.client.id,
        slot,
        simulated
      )
    ) {
      continue;
    }

    if (
      requirementIsAlreadyCovered(
        { client: requirement.client, startTime: slot },
        simulated
      )
    ) {
      return null;
    }

    const check = canAssignStaffToClient({
      staffMember,
      client: requirement.client,
      startTime: slot,
      assignments: simulated,
      callOutStaffIds,
      rules: input.rules,
    });

    if (!check.allowed) {
      return null;
    }

    const assignment = createAutoClientAssignment(
      staffMember,
      requirement.client,
      slot
    );
    planned.push(assignment);
    simulated.push(assignment);
  }

  return planned;
}

function pairingWouldMeetMinimumWithoutReservation(
  staffMember: SchedulerStaff,
  client: SchedulerClient,
  startTime: string,
  input: SchedulerInput,
  assignments: SchedulerAssignment[]
): boolean {
  const minimumBlocks = Math.max(
    Math.ceil(
      input.rules.minimumClientStaffAssignmentMinutes /
        input.rules.slotLengthMinutes
    ),
    1
  );

  if (minimumBlocks <= 1) return true;

  const targetMinutes = timeToMinutes(startTime);
  if (targetMinutes === null) return false;

  const occupied = new Set(
    assignments
      .filter(
        (assignment) =>
          assignment.staffId === staffMember.id &&
          assignment.clientId === client.id &&
          assignment.assignmentType === "CLIENT_1_TO_1"
      )
      .map((assignment) => timeToMinutes(assignment.startTime))
      .filter((value): value is number => value !== null)
  );
  occupied.add(targetMinutes);

  let consecutive = 1;

  for (
    let minute = targetMinutes - input.rules.slotLengthMinutes;
    occupied.has(minute);
    minute -= input.rules.slotLengthMinutes
  ) {
    consecutive += 1;
  }

  for (
    let minute = targetMinutes + input.rules.slotLengthMinutes;
    occupied.has(minute);
    minute += input.rules.slotLengthMinutes
  ) {
    consecutive += 1;
  }

  return consecutive >= minimumBlocks;
}

function countEligibleStaff(
  requirement: ClientRequirement,
  staff: SchedulerStaff[],
  assignments: SchedulerAssignment[],
  callOutStaffIds: Set<string>,
  input: SchedulerInput
): number {
  return staff.filter((staffMember) =>
    canAssignStaffToClient({
      staffMember,
      client: requirement.client,
      startTime: requirement.startTime,
      assignments,
      callOutStaffIds,
      rules: input.rules,
    }).allowed
  ).length;
}

function supportPriority(client: SchedulerClient): number {
  if (client.supportLevel === "HIGH_SUPPORT") {
    return 3;
  }

  if (client.supportLevel === "ROTATION") {
    return 2;
  }

  return 1;
}

function coverageRoleTier(staffMember: SchedulerStaff): number {
  switch (staffMember.role) {
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

function compareStaffCandidates(
  left: { staffMember: SchedulerStaff; score: number },
  right: { staffMember: SchedulerStaff; score: number }
): number {
  const roleDifference =
    coverageRoleTier(left.staffMember) -
    coverageRoleTier(right.staffMember);

  if (roleDifference !== 0) {
    return roleDifference;
  }

  if (right.score !== left.score) {
    return right.score - left.score;
  }

  return left.staffMember.name.localeCompare(right.staffMember.name);
}

/**
 * The clinic spreadsheets generally keep a client with the same technician
 * across neighboring blocks. Processing the day in time order lets continuity
 * scoring see the immediately preceding block instead of assigning unrelated
 * afternoon cells first.
 *
 * Within each time slot, the clients with the fewest eligible technicians are
 * assigned first so flexible clients do not consume scarce staff.
 */
function sortRequirementsForClinicFlow(
  requirements: ClientRequirement[],
  input: SchedulerInput,
  assignments: SchedulerAssignment[],
  callOutStaffIds: Set<string>
): ClientRequirement[] {
  return [...requirements].sort((left, right) => {
    const timeComparison = left.startTime.localeCompare(right.startTime);

    if (timeComparison !== 0) {
      return timeComparison;
    }

    const leftEligibleCount = countEligibleStaff(
      left,
      input.staff,
      assignments,
      callOutStaffIds,
      input
    );
    const rightEligibleCount = countEligibleStaff(
      right,
      input.staff,
      assignments,
      callOutStaffIds,
      input
    );

    if (leftEligibleCount !== rightEligibleCount) {
      return leftEligibleCount - rightEligibleCount;
    }

    const supportDifference =
      supportPriority(right.client) - supportPriority(left.client);

    if (supportDifference !== 0) {
      return supportDifference;
    }

    return left.client.displayCode.localeCompare(right.client.displayCode);
  });
}

function findBestStaffMember(
  requirement: ClientRequirement,
  input: SchedulerInput,
  assignments: SchedulerAssignment[],
  callOutStaffIds: Set<string>
): SchedulerStaff | null {
  const candidates = input.staff
    .map((staffMember) => {
      const constraintCheck = canAssignStaffToClient({
        staffMember,
        client: requirement.client,
        startTime: requirement.startTime,
        assignments,
        callOutStaffIds,
        rules: input.rules,
      });

      if (!constraintCheck.allowed) {
        return null;
      }

      const minimumPlan = buildMinimumPairingPlan(
        requirement,
        staffMember,
        input,
        assignments,
        callOutStaffIds
      );

      if (!minimumPlan) {
        return null;
      }

      return {
        staffMember,
        score: scoreCandidate({
          staffMember,
          client: requirement.client,
          startTime: requirement.startTime,
          assignments,
          referenceAssignments: input.referenceAssignments,
          historicalPatterns: input.historicalPatterns,
          rules: input.rules,
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
    .sort(compareStaffCandidates);

  return candidates[0]?.staffMember ?? null;
}

function createAutoAssignment(
  staffMember: SchedulerStaff,
  requirement: ClientRequirement
): SchedulerAssignment {
  return {
    id: `auto-${requirement.client.id}-${requirement.startTime}-${staffMember.id}`,
    staffId: staffMember.id,
    clientId: requirement.client.id,
    startTime: requirement.startTime,
    assignmentType: "CLIENT_1_TO_1",
    source: "AUTO",
    locked: false,
  };
}

function createAutoClientAssignment(
  staffMember: SchedulerStaff,
  client: SchedulerClient,
  startTime: string
): SchedulerAssignment {
  return createAutoAssignment(staffMember, {
    client,
    startTime,
  });
}

function findProtectedConflicts(
  assignments: SchedulerAssignment[]
): string[] {
  const seenStaffSlots = new Map<string, SchedulerAssignment>();
  const messages: string[] = [];

  for (const assignment of assignments) {
    const key = `${assignment.staffId}-${assignment.startTime}`;
    const existingAssignment = seenStaffSlots.get(key);

    if (existingAssignment) {
      messages.push(
        `Protected assignments conflict for staff ${assignment.staffId} at ${assignment.startTime}.`
      );
      continue;
    }

    seenStaffSlots.set(key, assignment);
  }

  return messages;
}

function countReservedBreakSlots(assignments: SchedulerAssignment[]): number {
  return assignments.filter(
    (assignment) =>
      assignment.assignmentType === "BREAK" ||
      assignment.assignmentType === "BREAK_NAP" ||
      assignment.assignmentType === "BREAK_SPEECH"
  ).length;
}

function calculateCapacityMetrics(
  input: SchedulerInput,
  assignments: SchedulerAssignment[],
  requiredClientSlots: number,
  coveredClientSlots: number,
  uncoveredClientSlots: number
): SchedulerResult["metrics"] {
  const slotHours = input.rules.slotLengthMinutes / 60;
  const callOutStaffIds = new Set(input.callOutStaffIds);
  const workingStaff = input.staff.filter(
    (staffMember) =>
      !callOutStaffIds.has(staffMember.id) &&
      staffMember.availableSlots.length > 0
  );
  const activeClients = input.clients.filter(
    (client) => client.requiredSlots.length > 0
  );
  const staffAvailableSlots = workingStaff.reduce(
    (total, staffMember) => total + staffMember.availableSlots.length,
    0
  );
  const breakSlots = countReservedBreakSlots(assignments);

  const requiredClientHours = requiredClientSlots * slotHours;
  const coveredClientHours = coveredClientSlots * slotHours;
  const uncoveredClientHours = uncoveredClientSlots * slotHours;
  const staffAvailableHours = staffAvailableSlots * slotHours;
  const breakHoursReserved = breakSlots * slotHours;
  const netStaffCoverageHours = Math.max(
    staffAvailableHours - breakHoursReserved,
    0
  );
  const additionalLaborHoursNeeded = Math.max(
    requiredClientHours - netStaffCoverageHours,
    0
  );
  const coveragePercent =
    requiredClientSlots === 0
      ? 100
      : (coveredClientSlots / requiredClientSlots) * 100;

  return {
    staffCount: workingStaff.length,
    clientCount: activeClients.length,
    requiredClientSlots,
    coveredClientSlots,
    uncoveredClientSlots,
    coveragePercent,
    requiredClientHours,
    coveredClientHours,
    uncoveredClientHours,
    staffAvailableHours,
    breakHoursReserved,
    netStaffCoverageHours,
    additionalLaborHoursNeeded,
  };
}

function findBestSwap(
  requirement: ClientRequirement,
  input: SchedulerInput,
  assignments: SchedulerAssignment[],
  callOutStaffIds: Set<string>,
  allowProtectedAssignments = false
): SwapCandidate | null {
  const candidates: SwapCandidate[] = [];

  assignments.forEach((currentAssignment, assignmentIndex) => {
    if (
      currentAssignment.startTime !== requirement.startTime ||
      currentAssignment.assignmentType !== "CLIENT_1_TO_1" ||
      (!allowProtectedAssignments &&
        (currentAssignment.locked || currentAssignment.source !== "AUTO")) ||
      !currentAssignment.clientId
    ) {
      return;
    }

    const occupiedStaff = input.staff.find(
      (staffMember) => staffMember.id === currentAssignment.staffId
    );
    const displacedClient = input.clients.find(
      (client) => client.id === currentAssignment.clientId
    );

    if (!occupiedStaff || !displacedClient) {
      return;
    }

    const assignmentsWithoutCurrent = assignments.filter(
      (_, index) => index !== assignmentIndex
    );

    const uncoveredCheck = canAssignStaffToClient({
      staffMember: occupiedStaff,
      client: requirement.client,
      startTime: requirement.startTime,
      assignments: assignmentsWithoutCurrent,
      callOutStaffIds,
      rules: input.rules,
    });

    if (!uncoveredCheck.allowed) {
      return;
    }

    const replacementCandidates = input.staff
      .filter((staffMember) => staffMember.id !== occupiedStaff.id)
      .map((staffMember) => {
        const check = canAssignStaffToClient({
          staffMember,
          client: displacedClient,
          startTime: requirement.startTime,
          assignments: assignmentsWithoutCurrent,
          callOutStaffIds,
          rules: input.rules,
        });

        if (!check.allowed) {
          return null;
        }

        return {
          staffMember,
          score: scoreCandidate({
            staffMember,
            client: displacedClient,
            startTime: requirement.startTime,
            assignments: assignmentsWithoutCurrent,
            referenceAssignments: input.referenceAssignments,
            historicalPatterns: input.historicalPatterns,
            rules: input.rules,
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
      .sort(compareStaffCandidates);

    const bestReplacement = replacementCandidates[0];

    if (!bestReplacement) {
      return;
    }

    if (
      !pairingWouldMeetMinimumWithoutReservation(
        bestReplacement.staffMember,
        displacedClient,
        requirement.startTime,
        input,
        assignmentsWithoutCurrent
      ) ||
      !pairingWouldMeetMinimumWithoutReservation(
        occupiedStaff,
        requirement.client,
        requirement.startTime,
        input,
        assignmentsWithoutCurrent
      )
    ) {
      return;
    }

    const uncoveredScore = scoreCandidate({
      staffMember: occupiedStaff,
      client: requirement.client,
      startTime: requirement.startTime,
      assignments: assignmentsWithoutCurrent,
      referenceAssignments: input.referenceAssignments,
      historicalPatterns: input.historicalPatterns,
      rules: input.rules,
    });

    candidates.push({
      assignmentIndex,
      displacedAssignment: currentAssignment,
      replacementStaff: bestReplacement.staffMember,
      uncoveredStaff: occupiedStaff,
      score: bestReplacement.score + uncoveredScore,
    });
  });

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0] ?? null;
}

function attemptSingleSwapRepair(
  requirement: ClientRequirement,
  input: SchedulerInput,
  assignments: SchedulerAssignment[],
  callOutStaffIds: Set<string>,
  allowProtectedAssignments = false
): boolean {
  const swap = findBestSwap(
    requirement,
    input,
    assignments,
    callOutStaffIds,
    allowProtectedAssignments
  );

  if (!swap || !swap.displacedAssignment.clientId) {
    return false;
  }

  const displacedClient = input.clients.find(
    (client) => client.id === swap.displacedAssignment.clientId
  );

  if (!displacedClient) {
    return false;
  }

  assignments[swap.assignmentIndex] = createAutoClientAssignment(
    swap.replacementStaff,
    displacedClient,
    requirement.startTime
  );
  assignments.push(
    createAutoAssignment(
      swap.uncoveredStaff,
      requirement
    )
  );

  return true;
}

function attemptBreakReleaseRepair(
  requirement: ClientRequirement,
  input: SchedulerInput,
  assignments: SchedulerAssignment[],
  callOutStaffIds: Set<string>
): boolean {
  const breakTypes = new Set(["BREAK", "BREAK_NAP", "BREAK_SPEECH"]);

  for (
    let assignmentIndex = 0;
    assignmentIndex < assignments.length;
    assignmentIndex += 1
  ) {
    const assignment = assignments[assignmentIndex];

    if (
      assignment.startTime !== requirement.startTime ||
      !breakTypes.has(assignment.assignmentType)
    ) {
      continue;
    }

    const staffMember = input.staff.find(
      (candidate) => candidate.id === assignment.staffId
    );

    if (!staffMember) {
      continue;
    }

    const assignmentsWithoutBreak = assignments.filter(
      (_, index) => index !== assignmentIndex
    );
    const check = canAssignStaffToClient({
      staffMember,
      client: requirement.client,
      startTime: requirement.startTime,
      assignments: assignmentsWithoutBreak,
      callOutStaffIds,
      rules: input.rules,
    });

    if (!check.allowed) {
      continue;
    }

    assignments.splice(assignmentIndex, 1);
    assignments.push(createAutoAssignment(staffMember, requirement));
    return true;
  }

  return false;
}

/**
 * Fill uncovered client requirements while disturbing as little of the saved
 * schedule as possible.
 *
 * Strategy:
 * 1. Keep every existing assignment exactly where it is.
 * 2. Fill uncovered requirements into genuinely free eligible staff slots.
 * 3. Only when direct placement is impossible, allow one AUTO 1:1 assignment
 *    to move to another eligible staff member so the newly uncovered client can
 *    use that staff member.
 * 4. In aggressive mode, if coverage is still blocked, the repair may relocate
 *    a protected/manual client assignment or temporarily release a break. The
 *    caller must run break placement again so eligible staff end with a break.
 *
 * This is intentionally different from full generation: it is for manager/AI
 * requests such as "fix the uncovered blocks" where preserving the current day
 * is more important than globally re-optimizing it.
 */
export function repairCoverageMinimally(
  input: SchedulerInput,
  priorityRequirements: Array<{ clientId: string; startTime: string }> = [],
  options: { allowAutomaticOverrides?: boolean } = {}
): SchedulerResult {
  const callOutStaffIds = new Set(input.callOutStaffIds);
  const allowAutomaticOverrides = options.allowAutomaticOverrides === true;
  const assignments: SchedulerAssignment[] = input.existingAssignments.map(
    (assignment) => ({ ...assignment })
  );

  const warnings: SchedulerResult["warnings"] = findProtectedConflicts(
    assignments.filter(
      (assignment) => assignment.locked || assignment.source === "MANUAL"
    )
  ).map((message) => ({
    code: "LOCKED_CONFLICT",
    message,
  }));

  const allRequirements = buildRequirements(input.clients);
  const requirementsToFill = allRequirements.filter(
    (requirement) => !requirementIsAlreadyCovered(requirement, assignments)
  );
  const priorityKeys = new Set(
    priorityRequirements.map(
      (requirement) => `${requirement.clientId}|${requirement.startTime}`
    )
  );
  const sortedRequirements = sortRequirementsForClinicFlow(
    requirementsToFill,
    input,
    assignments,
    callOutStaffIds
  ).sort((left, right) => {
    const leftPriority = priorityKeys.has(
      `${left.client.id}|${left.startTime}`
    );
    const rightPriority = priorityKeys.has(
      `${right.client.id}|${right.startTime}`
    );
    if (leftPriority === rightPriority) return 0;
    return leftPriority ? -1 : 1;
  });
  const uncoveredRequirements: UncoveredRequirement[] = [];

  for (const requirement of sortedRequirements) {
    if (requirementIsAlreadyCovered(requirement, assignments)) {
      continue;
    }

    const bestStaffMember = findBestStaffMember(
      requirement,
      input,
      assignments,
      callOutStaffIds
    );

    if (bestStaffMember) {
      const minimumPlan = buildMinimumPairingPlan(
        requirement,
        bestStaffMember,
        input,
        assignments,
        callOutStaffIds
      );

      if (minimumPlan) {
        assignments.push(...minimumPlan);
        continue;
      }
    }

    const repairedBySwap = attemptSingleSwapRepair(
      requirement,
      input,
      assignments,
      callOutStaffIds
    );

    if (repairedBySwap) {
      warnings.push({
        code: "REPAIRED_BY_SWAP",
        message: `${requirement.client.displayCode} at ${requirement.startTime} was covered by one minimal staff swap.`,
      });
      continue;
    }

    if (allowAutomaticOverrides) {
      const repairedByProtectedSwap = attemptSingleSwapRepair(
        requirement,
        input,
        assignments,
        callOutStaffIds,
        true
      );

      if (repairedByProtectedSwap) {
        warnings.push({
          code: "REPAIRED_BY_SWAP",
          message:
            requirement.client.displayCode +
            " at " +
            requirement.startTime +
            " was covered by automatically relocating a protected/manual client block.",
        });
        continue;
      }

      const repairedByBreakRelease = attemptBreakReleaseRepair(
        requirement,
        input,
        assignments,
        callOutStaffIds
      );

      if (repairedByBreakRelease) {
        warnings.push({
          code: "REPAIRED_BY_SWAP",
          message:
            requirement.client.displayCode +
            " at " +
            requirement.startTime +
            " was covered by temporarily releasing a staff break so break placement can be recalculated.",
        });
        continue;
      }
    }

    uncoveredRequirements.push({
      clientId: requirement.client.id,
      clientCode: requirement.client.displayCode,
      startTime: requirement.startTime,
      reason: allowAutomaticOverrides
        ? "No eligible free staff member, one-step reassignment, protected-client relocation, or movable break can cover this requirement."
        : "No eligible free staff member or one-step AUTO assignment swap can cover this requirement without changing protected/manual schedule cells.",
    });
    warnings.push({
      code: "NO_ELIGIBLE_STAFF",
      message: `${requirement.client.displayCode} is still uncovered at ${requirement.startTime}.`,
    });
  }

  const requiredClientSlots = allRequirements.length;
  const uncoveredClientSlots = uncoveredRequirements.length;
  const coveredClientSlots = requiredClientSlots - uncoveredClientSlots;
  const metrics = calculateCapacityMetrics(
    input,
    assignments,
    requiredClientSlots,
    coveredClientSlots,
    uncoveredClientSlots
  );

  return {
    assignments,
    uncoveredRequirements,
    warnings,
    metrics,
  };
}

export function generateSchedule(input: SchedulerInput): SchedulerResult {
  const callOutStaffIds = new Set(input.callOutStaffIds);

  const protectedAssignments = input.existingAssignments.filter(
    shouldPreserveExistingAssignment
  );

  const assignments: SchedulerAssignment[] = protectedAssignments.map(
    (assignment) => ({ ...assignment })
  );

  const warnings: SchedulerResult["warnings"] = findProtectedConflicts(
    protectedAssignments
  ).map((message) => ({
    code: "LOCKED_CONFLICT",
    message,
  }));

  const allRequirements = buildRequirements(input.clients);
  const initiallyUncovered: ClientRequirement[] = [];

  const requirementsToFill = allRequirements.filter(
    (requirement) =>
      !requirementIsAlreadyCovered(
        requirement,
        assignments
      )
  );

  const sortedRequirements = sortRequirementsForClinicFlow(
    requirementsToFill,
    input,
    assignments,
    callOutStaffIds
  );

  for (const requirement of sortedRequirements) {
    if (requirementIsAlreadyCovered(requirement, assignments)) {
      continue;
    }

    const bestStaffMember = findBestStaffMember(
      requirement,
      input,
      assignments,
      callOutStaffIds
    );

    if (!bestStaffMember) {
      initiallyUncovered.push(requirement);
      continue;
    }

    const minimumPlan = buildMinimumPairingPlan(
      requirement,
      bestStaffMember,
      input,
      assignments,
      callOutStaffIds
    );

    if (!minimumPlan) {
      initiallyUncovered.push(requirement);
      continue;
    }

    assignments.push(...minimumPlan);
  }

  const uncoveredRequirements: UncoveredRequirement[] = [];

  for (const requirement of initiallyUncovered) {
    const repaired = attemptSingleSwapRepair(
      requirement,
      input,
      assignments,
      callOutStaffIds
    );

    if (repaired) {
      warnings.push({
        code: "REPAIRED_BY_SWAP",
        message: `${requirement.client.displayCode} at ${requirement.startTime} was covered by a one-step staff swap.`,
      });
      continue;
    }

    uncoveredRequirements.push({
      clientId: requirement.client.id,
      clientCode: requirement.client.displayCode,
      startTime: requirement.startTime,
      reason:
        "No eligible staff member satisfies availability, call-out, hard relationship, minimum/maximum pairing duration, same-day repeat, client rotation, and hour constraints, including a one-step swap repair.",
    });

    warnings.push({
      code: "NO_ELIGIBLE_STAFF",
      message: `${requirement.client.displayCode} is uncovered at ${requirement.startTime}.`,
    });
  }

  const requiredClientSlots = allRequirements.length;
  const uncoveredClientSlots = uncoveredRequirements.length;
  const coveredClientSlots = requiredClientSlots - uncoveredClientSlots;
  const metrics = calculateCapacityMetrics(
    input,
    assignments,
    requiredClientSlots,
    coveredClientSlots,
    uncoveredClientSlots
  );

  if (metrics.additionalLaborHoursNeeded > 0) {
    warnings.push({
      code: "CAPACITY_SHORTAGE",
      message: `Daily client demand exceeds net staff capacity by ${metrics.additionalLaborHoursNeeded.toFixed(
        1
      )} hours after reserved breaks.`,
    });
  }

  return {
    assignments,
    uncoveredRequirements,
    warnings,
    metrics,
  };
}
