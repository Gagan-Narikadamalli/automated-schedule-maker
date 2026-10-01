import type {
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
  difference: number;
};

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

export function calculateSchedulerReadiness(
  input: SchedulerInput,
  readinessRules: SchedulerReadinessRules
): SchedulerReadiness {
  const slotHours = input.rules.slotLengthMinutes / 60;
  const callOutStaffIds = new Set(input.callOutStaffIds);
  const workingStaff = activeWorkingStaff(input.staff, callOutStaffIds);
  const attendingClients = activeClients(input.clients);
  const timeSlots = collectTimeSlots(workingStaff, attendingClients);

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
    const clientDemand = attendingClients.filter((client) =>
      client.requiredSlots.includes(startTime)
    ).length;
    const staffAvailable = workingStaff.filter((staffMember) =>
      staffMember.availableSlots.includes(startTime)
    ).length;

    return {
      startTime,
      clientDemand,
      staffAvailable,
      difference: staffAvailable - clientDemand,
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
      `${shortageSlots.length} time slot(s) have more clients requiring 1:1 coverage than available staff.`
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
    shortageSlots,
    slotCapacity,
    breakWindowStart: readinessRules.breakWindowStart,
    breakWindowEnd: readinessRules.breakWindowEnd,
    warnings,
  };
}
