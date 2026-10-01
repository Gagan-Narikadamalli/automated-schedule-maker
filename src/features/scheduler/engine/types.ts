export type SchedulerStaff = {
  id: string;
  name: string;
  teamId?: string;
  availableSlots: string[];
  minimumDailyHours?: number;
  targetDailyHours?: number;
  maximumDailyHours?: number;
};

export type StaffRelationship =
  | "PREFERRED"
  | "ALLOWED"
  | "HARD_RESTRICTION";

export type SchedulerClient = {
  id: string;
  displayCode: string;
  teamId?: string;
  requiredSlots: string[];
  staffRelationships: Record<string, StaffRelationship>;
};

export type SchedulerAssignmentType =
  | "CLIENT_1_TO_1"
  | "BREAK"
  | "BREAK_NAP"
  | "BREAK_SPEECH"
  | "NAP"
  | "SPEECH"
  | "UNAVAILABLE"
  | "OPEN";

export type SchedulerAssignment = {
  id: string;
  staffId: string;
  clientId?: string;
  startTime: string;
  assignmentType: SchedulerAssignmentType;
  source: "AUTO" | "MANUAL" | "TEMPLATE" | "COPIED";
  locked: boolean;
  note?: string;
};

export type SchedulerRules = {
  maximumClientsPerTechPerDay: number;
  maximumTechsPerClientPerDay: number;
  preferSameTeam: boolean;
  preferStaffContinuity: boolean;
  slotLengthMinutes: number;
};

export type SchedulerInput = {
  staff: SchedulerStaff[];
  clients: SchedulerClient[];
  existingAssignments: SchedulerAssignment[];
  callOutStaffIds: string[];
  rules: SchedulerRules;
};

export type UncoveredRequirement = {
  clientId: string;
  clientCode: string;
  startTime: string;
  reason: string;
};

export type SchedulerWarning = {
  code:
    | "LOCKED_CONFLICT"
    | "NO_ELIGIBLE_STAFF"
    | "CLIENT_TECH_LIMIT"
    | "STAFF_HOUR_LIMIT";
  message: string;
};

export type SchedulerResult = {
  assignments: SchedulerAssignment[];
  uncoveredRequirements: UncoveredRequirement[];
  warnings: SchedulerWarning[];
  metrics: {
    requiredClientSlots: number;
    coveredClientSlots: number;
    uncoveredClientSlots: number;
    coveragePercent: number;
  };
};
