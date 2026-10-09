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
  assignment: SchedulerAssignment,
  preserveManualOverrides: boolean
): boolean {
  if (assignment.locked || assignment.source === "MANUAL") {
    return preserveManualOverrides;
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
  callOutStaffIds: Set<string>,
  allowSameDayPairRepeat = false
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
      allowSameDayPairRepeat,
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

function buildPreferredContinuousPairingPlan(
  requirement: ClientRequirement,
  staffMember: SchedulerStaff,
  input: SchedulerInput,
  assignments: SchedulerAssignment[],
  callOutStaffIds: Set<string>
): SchedulerAssignment[] | null {
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

  const planned = [...minimumPlan];
  const simulated = [
    ...assignments.map((assignment) => ({ ...assignment })),
    ...minimumPlan.map((assignment) => ({ ...assignment })),
  ];
  const startMinutes = timeToMinutes(requirement.startTime);

  if (startMinutes === null) {
    return planned;
  }

  const priorBlocks = priorContiguousPairBlocks(
    staffMember.id,
    requirement.client.id,
    requirement.startTime,
    assignments,
    input.rules.slotLengthMinutes
  );
  const globalMaximumBlocks = Math.max(
    Math.floor(
      (input.rules.maximumClientStaffConsecutiveHours * 60) /
        input.rules.slotLengthMinutes
    ),
    1
  );
  const clientMaximumBlocks =
    requirement.client.maxConsecutiveBlocksWithSameStaff !== undefined &&
    requirement.client.maxConsecutiveBlocksWithSameStaff > 0
      ? requirement.client.maxConsecutiveBlocksWithSameStaff
      : Number.POSITIVE_INFINITY;
  const maximumBlocks = Math.min(
    globalMaximumBlocks,
    clientMaximumBlocks
  );

  // Once a new staff/client session starts, fill as much of that client's
  // uninterrupted attendance segment as safely possible (up to the clinic's
  // four-hour maximum). Nap, Speech, staff availability, protected cells, or
  // another hard constraint naturally stop the run. This makes the schedule
  // visually readable as long blocks instead of re-solving the pairing every
  // 30 minutes.
  for (
    let offset = planned.length;
    priorBlocks + planned.length < maximumBlocks;
    offset += 1
  ) {
    const slot = minutesToTime(
      startMinutes + offset * input.rules.slotLengthMinutes
    );

    if (!requirement.client.requiredSlots.includes(slot)) {
      break;
    }

    if (
      exactReferenceConflictsWithPair(
        staffMember.id,
        requirement.client.id,
        slot,
        input.referenceAssignments
      )
    ) {
      break;
    }

    if (
      requirementIsAlreadyCovered(
        { client: requirement.client, startTime: slot },
        simulated
      )
    ) {
      break;
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
      break;
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

function explainUncoveredRequirement(
  requirement: ClientRequirement,
  input: SchedulerInput,
  assignments: SchedulerAssignment[],
  callOutStaffIds: Set<string>
): string {
  const scheduledStaff = input.staff.filter(
    (staffMember) =>
      !callOutStaffIds.has(staffMember.id) &&
      staffMember.availableSlots.includes(requirement.startTime)
  );

  if (scheduledStaff.length === 0) {
    return `No staff member is scheduled or available at ${requirement.startTime}. Client coverage extends beyond the current staff shifts.`;
  }

  const freeStaff = scheduledStaff.filter(
    (staffMember) =>
      !assignments.some(
        (assignment) =>
          assignment.staffId === staffMember.id &&
          assignment.startTime === requirement.startTime
      )
  );

  if (freeStaff.length === 0) {
    return `All ${scheduledStaff.length} staff member(s) available at ${requirement.startTime} already have an assignment in that block.`;
  }

  const eligibleFreeStaff = freeStaff.filter((staffMember) =>
    canAssignStaffToClient({
      staffMember,
      client: requirement.client,
      startTime: requirement.startTime,
      assignments,
      callOutStaffIds,
      rules: input.rules,
      allowSameDayPairRepeat: true,
    }).allowed
  );

  if (eligibleFreeStaff.length === 0) {
    return `${freeStaff.length} staff member(s) are free at ${requirement.startTime}, but client/staff eligibility, service-location, hour-limit, rotation, or relationship rules prevent a valid assignment.`;
  }

  return `Staff capacity exists at ${requirement.startTime}, but no safe final placement remained after coverage and repair passes. Repair Schedule should retry this block before manager placement.`;
}

function priorClientCoverageSlot(
  requirement: ClientRequirement,
  slotLengthMinutes: number
): string | null {
  const targetMinutes = timeToMinutes(requirement.startTime);

  if (targetMinutes === null) {
    return null;
  }

  let priorMinutes = targetMinutes - slotLengthMinutes;

  while (priorMinutes >= 0) {
    const slot = minutesToTime(priorMinutes);
    const isPlannedClientEvent =
      requirement.client.napSlots.includes(slot) ||
      requirement.client.speechSlots.includes(slot);

    if (!isPlannedClientEvent) {
      return requirement.client.requiredSlots.includes(slot)
        ? slot
        : null;
    }

    priorMinutes -= slotLengthMinutes;
  }

  return null;
}

function previousClientAssignment(
  requirement: ClientRequirement,
  assignments: SchedulerAssignment[],
  slotLengthMinutes: number
): SchedulerAssignment | null {
  const previousCoverageSlot = priorClientCoverageSlot(
    requirement,
    slotLengthMinutes
  );

  if (!previousCoverageSlot) {
    return null;
  }

  return (
    assignments.find(
      (assignment) =>
        assignment.clientId === requirement.client.id &&
        assignment.startTime === previousCoverageSlot &&
        assignment.assignmentType === "CLIENT_1_TO_1"
    ) ?? null
  );
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

function exactReferenceMatchStrength(
  staffId: string,
  clientId: string,
  startTime: string,
  referenceAssignments: SchedulerAssignment[],
  source?: "TEMPLATE" | "COPIED"
): number {
  return referenceAssignments.reduce((score, assignment) => {
    if (
      assignment.assignmentType !== "CLIENT_1_TO_1" ||
      assignment.staffId !== staffId ||
      assignment.clientId !== clientId ||
      assignment.startTime !== startTime ||
      (source && assignment.source !== source)
    ) {
      return score;
    }

    // The immediately previous same-weekday schedule is the strongest reusable
    // instruction. The current weekday template is the fallback. Current-day
    // AUTO output is deliberately ignored so a bad generation cannot train itself.
    if (assignment.source === "COPIED") return score + 100;
    if (assignment.source === "TEMPLATE") return score + 10;
    return score;
  }, 0);
}

function exactReferenceConflictsWithPair(
  staffId: string,
  clientId: string,
  startTime: string,
  referenceAssignments: SchedulerAssignment[]
): boolean {
  const relevant = referenceAssignments.filter(
    (assignment) =>
      assignment.assignmentType === "CLIENT_1_TO_1" &&
      assignment.startTime === startTime &&
      (assignment.source === "TEMPLATE" ||
        assignment.source === "COPIED") &&
      (assignment.staffId === staffId ||
        assignment.clientId === clientId)
  );

  if (relevant.length === 0) return false;

  const proposedStrength = exactReferenceMatchStrength(
    staffId,
    clientId,
    startTime,
    referenceAssignments
  );

  const strongestConflict = relevant.reduce((strength, assignment) => {
    if (
      assignment.staffId === staffId &&
      assignment.clientId === clientId
    ) {
      return strength;
    }

    const weight = assignment.source === "COPIED" ? 100 : 10;
    return Math.max(strength, weight);
  }, 0);

  return strongestConflict > proposedStrength;
}

function staffReservedForAnotherExactReferenceClient(
  staffId: string,
  proposedClientId: string,
  startTime: string,
  input: SchedulerInput,
  assignments: SchedulerAssignment[],
  source: "COPIED" | "TEMPLATE"
): boolean {
  const reservedReferences = input.referenceAssignments.filter(
    (assignment) =>
      assignment.source === source &&
      assignment.assignmentType === "CLIENT_1_TO_1" &&
      assignment.staffId === staffId &&
      assignment.clientId &&
      assignment.clientId !== proposedClientId &&
      assignment.startTime === startTime
  );

  for (const reference of reservedReferences) {
    const referencedClient = input.clients.find(
      (client) => client.id === reference.clientId
    );

    if (
      !referencedClient ||
      !referencedClient.requiredSlots.includes(startTime)
    ) {
      continue;
    }

    const alreadyCovered = assignments.some(
      (assignment) =>
        assignment.assignmentType === "CLIENT_1_TO_1" &&
        assignment.clientId === referencedClient.id &&
        assignment.startTime === startTime
    );

    if (!alreadyCovered) {
      return true;
    }
  }

  return false;
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

    // Reproduce the immediately previous same-weekday schedule first. If that
    // exact pairing is not feasible, give the current weekday template the next
    // claim. Only after both reusable references fail do normal scheduler rules
    // decide the assignment.
    const exactReferenceMatchAvailable = (
      requirement: ClientRequirement,
      source: "COPIED" | "TEMPLATE"
    ): boolean =>
      input.referenceAssignments.some((reference) => {
        if (
          reference.source !== source ||
          reference.assignmentType !== "CLIENT_1_TO_1" ||
          reference.clientId !== requirement.client.id ||
          reference.startTime !== requirement.startTime
        ) {
          return false;
        }
        const member = input.staff.find(
          (person) => person.id === reference.staffId
        );
        if (!member) return false;
        return canAssignStaffToClient({
          staffMember: member,
          client: requirement.client,
          startTime: requirement.startTime,
          assignments,
          callOutStaffIds,
          rules: input.rules,
          allowSameDayPairRepeat: true,
        }).allowed;
      });

    const leftPreviousWeek = exactReferenceMatchAvailable(left, "COPIED");
    const rightPreviousWeek = exactReferenceMatchAvailable(right, "COPIED");
    if (leftPreviousWeek !== rightPreviousWeek) {
      return leftPreviousWeek ? -1 : 1;
    }

    const leftTemplate = exactReferenceMatchAvailable(left, "TEMPLATE");
    const rightTemplate = exactReferenceMatchAvailable(right, "TEMPLATE");
    if (leftTemplate !== rightTemplate) {
      return leftTemplate ? -1 : 1;
    }

    // First preserve clients that already have a real staff pairing from the
    // immediately previous coverage segment (including across a protected Nap
    // or Speech gap). This is evaluated with assignments already built for
    // earlier times, so established relationships get first claim on their
    // technician before newly arriving clients are considered.
    const leftPreviousAssignment = previousClientAssignment(
      left,
      assignments,
      input.rules.slotLengthMinutes
    );
    const rightPreviousAssignment = previousClientAssignment(
      right,
      assignments,
      input.rules.slotLengthMinutes
    );

    if (Boolean(leftPreviousAssignment) !== Boolean(rightPreviousAssignment)) {
      return leftPreviousAssignment ? -1 : 1;
    }

    const leftHasPreviousPair = Boolean(
      priorClientCoverageSlot(
        left,
        input.rules.slotLengthMinutes
      )
    );
    const rightHasPreviousPair = Boolean(
      priorClientCoverageSlot(
        right,
        input.rules.slotLengthMinutes
      )
    );

    if (leftHasPreviousPair !== rightHasPreviousPair) {
      return leftHasPreviousPair ? -1 : 1;
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

function findCoverageFirstSingleSlotStaff(
  requirement: ClientRequirement,
  input: SchedulerInput,
  assignments: SchedulerAssignment[],
  callOutStaffIds: Set<string>
): SchedulerStaff | null {
  const candidates = input.staff
    .map((staffMember) => {
      const check = canAssignStaffToClient({
        staffMember,
        client: requirement.client,
        startTime: requirement.startTime,
        assignments,
        callOutStaffIds,
        rules: input.rules,
        allowSameDayPairRepeat: true,
        allowCoverageLimitException: true,
      });

      if (!check.allowed) {
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

function findBestStaffMember(
  requirement: ClientRequirement,
  input: SchedulerInput,
  assignments: SchedulerAssignment[],
  callOutStaffIds: Set<string>,
  allowSameDayPairRepeat = false
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
        allowSameDayPairRepeat,
      });

      if (!constraintCheck.allowed) {
        return null;
      }

      const minimumPlan = buildMinimumPairingPlan(
        requirement,
        staffMember,
        input,
        assignments,
        callOutStaffIds,
        allowSameDayPairRepeat
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
    .sort((left, right) => {
      // Coverage-role eligibility is a clinic safety boundary before reusable
      // schedule preferences. Last-week/template matching only competes inside
      // the same coverage tier (BT/RBT first, then auxiliary roles).
      const roleDifference =
        coverageRoleTier(left.staffMember) -
        coverageRoleTier(right.staffMember);
      if (roleDifference !== 0) {
        return roleDifference;
      }

      const leftPreviousWeekStrength = exactReferenceMatchStrength(
        left.staffMember.id,
        requirement.client.id,
        requirement.startTime,
        input.referenceAssignments,
        "COPIED"
      );
      const rightPreviousWeekStrength = exactReferenceMatchStrength(
        right.staffMember.id,
        requirement.client.id,
        requirement.startTime,
        input.referenceAssignments,
        "COPIED"
      );

      // Priority 1 inside the valid coverage tier: reproduce the immediately
      // previous same-weekday pairing whenever it still passes hard constraints.
      if (leftPreviousWeekStrength !== rightPreviousWeekStrength) {
        return rightPreviousWeekStrength - leftPreviousWeekStrength;
      }

      const leftReservedForOtherPreviousWeek =
        staffReservedForAnotherExactReferenceClient(
          left.staffMember.id,
          requirement.client.id,
          requirement.startTime,
          input,
          assignments,
          "COPIED"
        );
      const rightReservedForOtherPreviousWeek =
        staffReservedForAnotherExactReferenceClient(
          right.staffMember.id,
          requirement.client.id,
          requirement.startTime,
          input,
          assignments,
          "COPIED"
        );

      if (
        leftReservedForOtherPreviousWeek !==
        rightReservedForOtherPreviousWeek
      ) {
        return leftReservedForOtherPreviousWeek ? 1 : -1;
      }

      const leftTemplateStrength = exactReferenceMatchStrength(
        left.staffMember.id,
        requirement.client.id,
        requirement.startTime,
        input.referenceAssignments,
        "TEMPLATE"
      );
      const rightTemplateStrength = exactReferenceMatchStrength(
        right.staffMember.id,
        requirement.client.id,
        requirement.startTime,
        input.referenceAssignments,
        "TEMPLATE"
      );

      // Priority 2 inside the same coverage tier: use the current weekday
      // template when last week's exact assignment is unavailable.
      if (leftTemplateStrength !== rightTemplateStrength) {
        return rightTemplateStrength - leftTemplateStrength;
      }

      const leftReservedForOtherTemplate =
        staffReservedForAnotherExactReferenceClient(
          left.staffMember.id,
          requirement.client.id,
          requirement.startTime,
          input,
          assignments,
          "TEMPLATE"
        );
      const rightReservedForOtherTemplate =
        staffReservedForAnotherExactReferenceClient(
          right.staffMember.id,
          requirement.client.id,
          requirement.startTime,
          input,
          assignments,
          "TEMPLATE"
        );

      if (
        leftReservedForOtherTemplate !== rightReservedForOtherTemplate
      ) {
        return leftReservedForOtherTemplate ? 1 : -1;
      }

      const previousAssignment = previousClientAssignment(
        requirement,
        assignments,
        input.rules.slotLengthMinutes
      );
      const isRotationClient =
        requirement.client.supportLevel === "ROTATION" ||
        requirement.client.supportLevel === "HIGH_SUPPORT";

      if (previousAssignment && !isRotationClient) {
        const leftContinues =
          left.staffMember.id === previousAssignment.staffId;
        const rightContinues =
          right.staffMember.id === previousAssignment.staffId;

        if (leftContinues !== rightContinues) {
          return leftContinues ? -1 : 1;
        }
      }

      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.staffMember.name.localeCompare(right.staffMember.name);
    });

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
  allowProtectedAssignments = false,
  allowSameDayPairRepeat = false
): SwapCandidate | null {
  const candidates: SwapCandidate[] = [];

  assignments.forEach((currentAssignment, assignmentIndex) => {
    if (
      currentAssignment.startTime !== requirement.startTime ||
      currentAssignment.assignmentType !== "CLIENT_1_TO_1" ||
      (!allowProtectedAssignments &&
        (currentAssignment.locked || currentAssignment.source !== "AUTO")) ||
      // A pinned previous-week or weekday-template match is never a movable
      // repair candidate. Otherwise the coverage repair pass can silently
      // undo the exact reference blocks placed at the start of generation.
      (currentAssignment.source === "AUTO" &&
        input.referenceAssignments.some((reference) =>
          reference.assignmentType === "CLIENT_1_TO_1" &&
          reference.staffId === currentAssignment.staffId &&
          reference.clientId === currentAssignment.clientId &&
          reference.startTime === currentAssignment.startTime &&
          (reference.source === "COPIED" || reference.source === "TEMPLATE")
        )) ||
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
      allowSameDayPairRepeat,
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
          allowSameDayPairRepeat,
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
  allowProtectedAssignments = false,
  allowSameDayPairRepeat = false
): boolean {
  const swap = findBestSwap(
    requirement,
    input,
    assignments,
    callOutStaffIds,
    allowProtectedAssignments,
    allowSameDayPairRepeat
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
  callOutStaffIds: Set<string>,
  allowSameDayPairRepeat = false
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
      allowSameDayPairRepeat,
    });

    if (!check.allowed) {
      continue;
    }

    const minimumPlan = buildMinimumPairingPlan(
      requirement,
      staffMember,
      input,
      assignmentsWithoutBreak,
      callOutStaffIds,
      allowSameDayPairRepeat
    );

    if (!minimumPlan) {
      continue;
    }

    assignments.splice(assignmentIndex, 1);
    assignments.push(...minimumPlan);
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
  options: {
    allowAutomaticOverrides?: boolean;
    allowProtectedRelocation?: boolean;
    allowBreakRelocation?: boolean;
  } = {}
): SchedulerResult {
  const callOutStaffIds = new Set(input.callOutStaffIds);
  const allowAutomaticOverrides = options.allowAutomaticOverrides === true;
  const allowProtectedRelocation =
    options.allowProtectedRelocation ?? allowAutomaticOverrides;
  const allowBreakRelocation =
    options.allowBreakRelocation ?? allowAutomaticOverrides;
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
  const repeatFallbackRequirements: ClientRequirement[] = [];
  const uncoveredRequirements: UncoveredRequirement[] = [];

  // Stage 1: exhaust normal non-repeat coverage options across the day first.
  // A same-day staff/client repeat is deliberately NOT considered in this pass.
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
        message: `${requirement.client.displayCode} at ${requirement.startTime} was covered by one minimal non-repeat staff swap.`,
      });
      continue;
    }

    if (allowProtectedRelocation) {
      const repairedByProtectedSwap = attemptSingleSwapRepair(
        requirement,
        input,
        assignments,
        callOutStaffIds,
        true,
        false
      );

      if (repairedByProtectedSwap) {
        warnings.push({
          code: "REPAIRED_BY_SWAP",
          message:
            requirement.client.displayCode +
            " at " +
            requirement.startTime +
            " was covered by automatically relocating a protected/manual client block without using a same-day pair repeat.",
        });
        continue;
      }

      const repairedByBreakRelease = allowBreakRelocation
        ? attemptBreakReleaseRepair(
        requirement,
        input,
        assignments,
        callOutStaffIds,
        false
      )
        : false;

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

    repeatFallbackRequirements.push(requirement);
  }

  // Stage 2: only after the whole normal pass is complete may a prior
  // staff/client pair be reused. This is a coverage exception, not a preference.
  for (const requirement of repeatFallbackRequirements) {
    if (requirementIsAlreadyCovered(requirement, assignments)) {
      continue;
    }

    let coveredByRepeatException = false;

    if (input.rules.allowSameStaffClientRepeatForCoverageException) {
      const exceptionStaff = findBestStaffMember(
        requirement,
        input,
        assignments,
        callOutStaffIds,
        true
      );

      if (exceptionStaff) {
        const exceptionPlan = buildMinimumPairingPlan(
          requirement,
          exceptionStaff,
          input,
          assignments,
          callOutStaffIds,
          true
        );

        if (exceptionPlan) {
          assignments.push(...exceptionPlan);
          warnings.push({
            code: "PAIR_REUSE_EXCEPTION",
            message:
              `${requirement.client.displayCode} at ${requirement.startTime} reused a staff/client pair only after all normal non-repeat coverage options were exhausted.`,
          });
          coveredByRepeatException = true;
        }
      }

      if (!coveredByRepeatException) {
        const repairedByRepeatSwap = attemptSingleSwapRepair(
          requirement,
          input,
          assignments,
          callOutStaffIds,
          false,
          true
        );

        if (repairedByRepeatSwap) {
          warnings.push({
            code: "PAIR_REUSE_EXCEPTION",
            message:
              `${requirement.client.displayCode} at ${requirement.startTime} used a last-resort swap with a same-day pair reuse after non-repeat options were exhausted.`,
          });
          coveredByRepeatException = true;
        }
      }

      if (!coveredByRepeatException && allowProtectedRelocation) {
        const repairedByProtectedRepeatSwap = attemptSingleSwapRepair(
          requirement,
          input,
          assignments,
          callOutStaffIds,
          true,
          true
        );

        if (repairedByProtectedRepeatSwap) {
          warnings.push({
            code: "PAIR_REUSE_EXCEPTION",
            message:
              `${requirement.client.displayCode} at ${requirement.startTime} required a protected-block relocation plus a same-day pair reuse as the final coverage option.`,
          });
          coveredByRepeatException = true;
        }
      }

      if (!coveredByRepeatException && allowBreakRelocation) {
        const repairedByRepeatBreakRelease = attemptBreakReleaseRepair(
          requirement,
          input,
          assignments,
          callOutStaffIds,
          true
        );

        if (repairedByRepeatBreakRelease) {
          warnings.push({
            code: "PAIR_REUSE_EXCEPTION",
            message:
              `${requirement.client.displayCode} at ${requirement.startTime} required a same-day pair reuse after a break was temporarily released as the final coverage option.`,
          });
          coveredByRepeatException = true;
        }
      }
    }

    if (coveredByRepeatException) {
      continue;
    }

    // Coverage is the final priority. If the normal contiguous-pairing rules
    // cannot build the preferred minimum block, use one valid 30-minute client
    // block rather than leaving a client uncovered while an eligible staff
    // member is idle. This may scatter staff assignments, but it never
    // double-books staff/clients and still respects availability, service
    // setting, hard restrictions, and configured hour limits.
    const singleSlotStaff = findCoverageFirstSingleSlotStaff(
      requirement,
      input,
      assignments,
      callOutStaffIds
    );

    if (singleSlotStaff) {
      assignments.push(
        createAutoAssignment(singleSlotStaff, requirement)
      );
      warnings.push({
        code: "COVERAGE_FIRST_SINGLE_SLOT",
        message:
          `${requirement.client.displayCode} at ${requirement.startTime} was covered with a single-slot fallback after normal continuity/grouping options were exhausted.`,
      });
      continue;
    }

    uncoveredRequirements.push({
      clientId: requirement.client.id,
      clientCode: requirement.client.displayCode,
      startTime: requirement.startTime,
      reason: explainUncoveredRequirement(
        requirement,
        input,
        assignments,
        callOutStaffIds
      ),
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
    (assignment) =>
      shouldPreserveExistingAssignment(
        assignment,
        input.rules.preserveManualOverrides
      )
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

  const startTimes = [
    ...new Set(
      requirementsToFill.map(
        (requirement) => requirement.startTime
      )
    ),
  ].sort();

  // Reserve feasible exact reusable coverage BEFORE long continuity runs can
  // claim those staff/time cells. The order is deliberate:
  //   1. immediately previous same-weekday schedule (COPIED)
  //   2. current weekday template (TEMPLATE)
  // If the first reference cannot be used because of attendance, availability,
  // eligibility, or an already occupied cell, the second reference may fill it.
  // Only BT/RBT coverage is pinned here; auxiliary-role references remain soft
  // preferences so the normal clinic coverage-role boundary is preserved.
  for (const source of ["COPIED", "TEMPLATE"] as const) {
    for (const reference of input.referenceAssignments
      .filter(
        (assignment) =>
          assignment.source === source &&
          assignment.assignmentType === "CLIENT_1_TO_1" &&
          Boolean(assignment.clientId)
      )
      .sort((left, right) =>
        left.startTime.localeCompare(right.startTime)
      )) {
      const requirement = requirementsToFill.find(
        (item) =>
          item.client.id === reference.clientId &&
          item.startTime === reference.startTime
      );
      const employee = input.staff.find(
        (person) => person.id === reference.staffId
      );

      if (
        !requirement ||
        !employee ||
        coverageRoleTier(employee) !== 0 ||
        requirementIsAlreadyCovered(requirement, assignments) ||
        assignments.some(
          (assignment) =>
            assignment.staffId === employee.id &&
            assignment.startTime === reference.startTime
        )
      ) {
        continue;
      }

      const eligible = canAssignStaffToClient({
        staffMember: employee,
        client: requirement.client,
        startTime: reference.startTime,
        assignments,
        callOutStaffIds,
        rules: input.rules,
        allowSameDayPairRepeat: true,
      });

      if (!eligible.allowed) {
        continue;
      }

      assignments.push(createAutoAssignment(employee, requirement));
    }
  }

  // Build the day chronologically. Re-sort each half-hour only after all
  // earlier blocks are known, so the scheduler can genuinely preserve the
  // client/staff relationship it created in the previous block instead of
  // making all ordering decisions from an empty morning schedule.
  for (const startTime of startTimes) {
    const requirementsAtTime = sortRequirementsForClinicFlow(
      requirementsToFill.filter(
        (requirement) => requirement.startTime === startTime
      ),
      input,
      assignments,
      callOutStaffIds
    );

    for (const requirement of requirementsAtTime) {
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

      const preferredPlan = buildPreferredContinuousPairingPlan(
        requirement,
        bestStaffMember,
        input,
        assignments,
        callOutStaffIds
      );

      if (!preferredPlan) {
        initiallyUncovered.push(requirement);
        continue;
      }

      assignments.push(...preferredPlan);
    }
  }

  const repeatFallbackRequirements: ClientRequirement[] = [];
  const uncoveredRequirements: UncoveredRequirement[] = [];

  // Stage 1 repair: finish every possible non-repeat placement/swap first.
  for (const requirement of initiallyUncovered) {
    if (requirementIsAlreadyCovered(requirement, assignments)) {
      continue;
    }

    const retryStaff = findBestStaffMember(
      requirement,
      input,
      assignments,
      callOutStaffIds
    );

    if (retryStaff) {
      const retryPlan = buildMinimumPairingPlan(
        requirement,
        retryStaff,
        input,
        assignments,
        callOutStaffIds
      );

      if (retryPlan) {
        assignments.push(...retryPlan);
        continue;
      }
    }

    const repaired = attemptSingleSwapRepair(
      requirement,
      input,
      assignments,
      callOutStaffIds
    );

    if (repaired) {
      warnings.push({
        code: "REPAIRED_BY_SWAP",
        message: `${requirement.client.displayCode} at ${requirement.startTime} was covered by a one-step non-repeat staff swap.`,
      });
      continue;
    }

    repeatFallbackRequirements.push(requirement);
  }

  // Stage 2 fallback: only the requirements still uncovered after the complete
  // non-repeat pass may consider reusing a staff/client pair from earlier today.
  for (const requirement of repeatFallbackRequirements) {
    if (requirementIsAlreadyCovered(requirement, assignments)) {
      continue;
    }

    let coveredByRepeatException = false;

    if (input.rules.allowSameStaffClientRepeatForCoverageException) {
      const exceptionStaff = findBestStaffMember(
        requirement,
        input,
        assignments,
        callOutStaffIds,
        true
      );

      if (exceptionStaff) {
        const exceptionPlan = buildMinimumPairingPlan(
          requirement,
          exceptionStaff,
          input,
          assignments,
          callOutStaffIds,
          true
        );

        if (exceptionPlan) {
          assignments.push(...exceptionPlan);
          warnings.push({
            code: "PAIR_REUSE_EXCEPTION",
            message:
              `${requirement.client.displayCode} at ${requirement.startTime} reused a staff/client pair only after the entire normal non-repeat scheduling pass was exhausted.`,
          });
          coveredByRepeatException = true;
        }
      }

      if (!coveredByRepeatException) {
        const repairedByRepeatSwap = attemptSingleSwapRepair(
          requirement,
          input,
          assignments,
          callOutStaffIds,
          false,
          true
        );

        if (repairedByRepeatSwap) {
          warnings.push({
            code: "PAIR_REUSE_EXCEPTION",
            message:
              `${requirement.client.displayCode} at ${requirement.startTime} used a same-day pair reuse during last-resort swap repair after all non-repeat options were exhausted.`,
          });
          coveredByRepeatException = true;
        }
      }
    }

    if (coveredByRepeatException) {
      continue;
    }

    // Coverage is the final priority. If the normal contiguous-pairing rules
    // cannot build the preferred minimum block, use one valid 30-minute client
    // block rather than leaving a client uncovered while an eligible staff
    // member is idle. This may scatter staff assignments, but it never
    // double-books staff/clients and still respects availability, service
    // setting, hard restrictions, and configured hour limits.
    const singleSlotStaff = findCoverageFirstSingleSlotStaff(
      requirement,
      input,
      assignments,
      callOutStaffIds
    );

    if (singleSlotStaff) {
      assignments.push(
        createAutoAssignment(singleSlotStaff, requirement)
      );
      warnings.push({
        code: "COVERAGE_FIRST_SINGLE_SLOT",
        message:
          `${requirement.client.displayCode} at ${requirement.startTime} was covered with a single-slot fallback after normal continuity/grouping options were exhausted.`,
      });
      continue;
    }

    uncoveredRequirements.push({
      clientId: requirement.client.id,
      clientCode: requirement.client.displayCode,
      startTime: requirement.startTime,
      reason: explainUncoveredRequirement(
        requirement,
        input,
        assignments,
        callOutStaffIds
      ),
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
