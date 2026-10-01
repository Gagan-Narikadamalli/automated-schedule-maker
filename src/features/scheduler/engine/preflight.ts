import { canAssignStaffToClient } from "./constraints";
import type {
  SchedulerAssignment,
  SchedulerClient,
  SchedulerInput,
  SchedulerStaff,
} from "./types";

export type SchedulerReadinessRules = {
  breakEligibilityHours: number;
  defaultBreakMinutes: number;
  breakWindowStart: string;
  breakWindowEnd: string;
};

export type SlotCapacity = {
  startTime: string;
  clientDemand: number;
  staffAvailable: number;
  assignableClientCount: number;
  difference: number;
};

export type SchedulerBuildForecast =
  | "COMPLETE_EXPECTED"
  | "PARTIAL_EXPECTED"
  | "NO_CLIENTS";

export type SchedulerReadiness = {
  staffCount: number;
  clientCount: number;
  staffAvailableHours: number;
  requiredClientHours: number;
  breakEligibleStaffCount: number;
  plannedBreakHours: number;
  netStaffCoverageHours: number;
  additionalLaborHoursNeeded: number;
  surplusCoverageHours: number;
  peakConcurrentClients: number;
  peakAvailableStaff: number;
  maximumConcurrentStaffShortage: number;
  estimatedAdditionalStaffNeeded: number;
  buildForecast: SchedulerBuildForecast;
  shortageSlots: SlotCapacity[];
  slotCapacity: SlotCapacity[];
  breakWindowStart: string;
  breakWindowEnd: string;
  warnings: string[];
};

function activeWorkingStaff(
  staff: SchedulerStaff[],
  callOutStaffIds: Set<string>
): SchedulerStaff[] {
  return staff.filter(
    (staffMember) =>
      !callOutStaffIds.has(staffMember.id) &&
      staffMember.availableSlots.length > 0
  );
}

function activeClients(clients: SchedulerClient[]): SchedulerClient[] {
  return clients.filter((client) => client.requiredSlots.length > 0);
}

function collectTimeSlots(
  staff: SchedulerStaff[],
  clients: SchedulerClient[]
): string[] {
  const slots = new Set<string>();

  for (const staffMember of staff) {
    for (const startTime of staffMember.availableSlots) {
      slots.add(startTime);
    }
  }

  for (const client of clients) {
    for (const startTime of client.requiredSlots) {
      slots.add(startTime);
    }
  }

  return [...slots].sort();
}

function shouldProtectAssignment(
  assignment: SchedulerAssignment
): boolean {
  return (
    assignment.locked ||
    assignment.source === "MANUAL" ||
    assignment.assignmentType === "SPEECH" ||
    assignment.assignmentType === "UNAVAILABLE"
  );
}

function clientAlreadyCovered(
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

function calculateMaximumEligibleCoverage(
  clients: SchedulerClient[],
  staff: SchedulerStaff[],
  startTime: string,
  protectedAssignments: SchedulerAssignment[],
  callOutStaffIds: Set<string>,
  input: SchedulerInput
): number {
  const unmatchedClients = clients.filter(
    (client) =>
      !clientAlreadyCovered(
        client.id,
        startTime,
        protectedAssignments
      )
  );
  const protectedCoverageCount =
    clients.length - unmatchedClients.length;

  if (unmatchedClients.length === 0) {
    return protectedCoverageCount;
  }

  const eligibleStaffByClient = new Map<string, string[]>();

  for (const client of unmatchedClients) {
    const eligibleStaffIds = staff
      .filter((staffMember) =>
        canAssignStaffToClient({
          staffMember,
          client,
          startTime,
          assignments: protectedAssignments,
          callOutStaffIds,
          rules: input.rules,
        }).allowed
      )
      .map((staffMember) => staffMember.id);

    eligibleStaffByClient.set(client.id, eligibleStaffIds);
  }

  const orderedClientIds = [...eligibleStaffByClient.entries()]
    .sort((left, right) => left[1].length - right[1].length)
    .map(([clientId]) => clientId);
  const matchedClientByStaff = new Map<string, string>();

  function tryMatch(
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
        tryMatch(previousClientId, visitedStaffIds)
      ) {
        matchedClientByStaff.set(staffId, clientId);
        return true;
      }
    }

    return false;
  }

  let matchedCount = 0;

  for (const clientId of orderedClientIds) {
    if (tryMatch(clientId, new Set<string>())) {
      matchedCount += 1;
    }
  }

  return protectedCoverageCount + matchedCount;
}

function calculateBuildForecast(
  clientCount: number,
  shortageSlots: SlotCapacity[],
  additionalLaborHoursNeeded: number
): SchedulerBuildForecast {
  if (clientCount === 0) {
    return "NO_CLIENTS";
  }

  if (
    shortageSlots.length > 0 ||
    additionalLaborHoursNeeded > 0
  ) {
    return "PARTIAL_EXPECTED";
  }

  return "COMPLETE_EXPECTED";
}

export function calculateSchedulerReadiness(
  input: SchedulerInput,
  readinessRules: SchedulerReadinessRules
): SchedulerReadiness {
  const slotHours = input.rules.slotLengthMinutes / 60;
  const callOutStaffIds = new Set(input.callOutStaffIds);
  const workingStaff = activeWorkingStaff(input.staff, callOutStaffIds);
  const attendingClients = activeClients(input.clients);
  const timeSlots = collectTimeSlots(workingStaff, attendingClients);
  const protectedAssignments = input.existingAssignments.filter(
    shouldProtectAssignment
  );

  const staffAvailableSlots = workingStaff.reduce(
    (total, staffMember) => total + staffMember.availableSlots.length,
    0
  );
  const requiredClientSlots = attendingClients.reduce(
    (total, client) => total + client.requiredSlots.length,
    0
  );

  const breakEligibleStaff = workingStaff.filter((staffMember) => {
    const availableHours = staffMember.availableSlots.length * slotHours;
    return availableHours >= readinessRules.breakEligibilityHours;
  });

  const staffAvailableHours = staffAvailableSlots * slotHours;
  const requiredClientHours = requiredClientSlots * slotHours;
  const plannedBreakHours =
    breakEligibleStaff.length * (readinessRules.defaultBreakMinutes / 60);
  const netStaffCoverageHours = Math.max(
    staffAvailableHours - plannedBreakHours,
    0
  );
  const additionalLaborHoursNeeded = Math.max(
    requiredClientHours - netStaffCoverageHours,
    0
  );
  const surplusCoverageHours = Math.max(
    netStaffCoverageHours - requiredClientHours,
    0
  );

  const slotCapacity = timeSlots.map((startTime) => {
    const clientsAtSlot = attendingClients.filter((client) =>
      client.requiredSlots.includes(startTime)
    );
    const staffAvailable = workingStaff.filter(
      (staffMember) =>
        staffMember.availableSlots.includes(startTime) &&
        !staffAlreadyOccupied(
          staffMember.id,
          startTime,
          protectedAssignments
        )
    ).length;
    const protectedStaffAtSlot = new Set(
      protectedAssignments
        .filter(
          (assignment) => assignment.startTime === startTime
        )
        .map((assignment) => assignment.staffId)
    ).size;
    const assignableClientCount = calculateMaximumEligibleCoverage(
      clientsAtSlot,
      workingStaff,
      startTime,
      protectedAssignments,
      callOutStaffIds,
      input
    );

    return {
      startTime,
      clientDemand: clientsAtSlot.length,
      staffAvailable: staffAvailable + protectedStaffAtSlot,
      assignableClientCount,
      difference: assignableClientCount - clientsAtSlot.length,
    };
  });

  const shortageSlots = slotCapacity.filter((slot) => slot.difference < 0);
  const peakConcurrentClients = slotCapacity.reduce(
    (peak, slot) => Math.max(peak, slot.clientDemand),
    0
  );
  const peakAvailableStaff = slotCapacity.reduce(
    (peak, slot) => Math.max(peak, slot.staffAvailable),
    0
  );
  const maximumConcurrentStaffShortage = shortageSlots.reduce(
    (largestShortage, slot) =>
      Math.max(largestShortage, Math.abs(slot.difference)),
    0
  );
  const estimatedAdditionalStaffNeeded = Math.max(
    maximumConcurrentStaffShortage,
    additionalLaborHoursNeeded > 0 ? 1 : 0
  );
  const buildForecast = calculateBuildForecast(
    attendingClients.length,
    shortageSlots,
    additionalLaborHoursNeeded
  );

  const warnings: string[] = [];

  if (additionalLaborHoursNeeded > 0) {
    warnings.push(
      `Client demand exceeds net daily staff capacity by ${additionalLaborHoursNeeded.toFixed(
        1
      )} hours after planned breaks.`
    );
  }

  if (shortageSlots.length > 0) {
    warnings.push(
      `${shortageSlots.length} time slot(s) cannot cover every required client after staff availability, existing protected assignments, hard staff/client restrictions, service setting, rotation limits, and hour limits are applied.`
    );
  }

  if (maximumConcurrentStaffShortage > 0) {
    warnings.push(
      `The largest simultaneous eligible-coverage gap is ${maximumConcurrentStaffShortage} staff member${
        maximumConcurrentStaffShortage === 1 ? "" : "s"
      }.`
    );
  }

  if (workingStaff.length === 0 && attendingClients.length > 0) {
    warnings.push("Clients are scheduled today but no staff have working availability.");
  }

  if (attendingClients.length === 0) {
    warnings.push("No client attendance is configured for this date.");
  }

  return {
    staffCount: workingStaff.length,
    clientCount: attendingClients.length,
    staffAvailableHours,
    requiredClientHours,
    breakEligibleStaffCount: breakEligibleStaff.length,
    plannedBreakHours,
    netStaffCoverageHours,
    additionalLaborHoursNeeded,
    surplusCoverageHours,
    peakConcurrentClients,
    peakAvailableStaff,
    maximumConcurrentStaffShortage,
    estimatedAdditionalStaffNeeded,
    buildForecast,
    shortageSlots,
    slotCapacity,
    breakWindowStart: readinessRules.breakWindowStart,
    breakWindowEnd: readinessRules.breakWindowEnd,
    warnings,
  };
}
