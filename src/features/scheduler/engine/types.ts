export type ServiceSetting = "IN_CENTER" | "IN_HOME" | "BOTH";

export type SupportLevel =
  | "STANDARD"
  | "ONE_TO_ONE"
  | "ROTATION"
  | "HIGH_SUPPORT";

export type NapPriorityCategory = "YOUNGER" | "OLDER";

export type StaffRole =
  | "BT"
  | "RBT"
  | "INTERN"
  | "OFFICE_MANAGER"
  | "BCBA"
  | "OTHER";

export type SchedulerStaff = {
  id: string;
  name: string;
  role: StaffRole;
  teamId?: string;
  serviceSetting?: ServiceSetting;
  availableSlots: string[];
  minimumDailyHours?: number;
  targetDailyHours?: number;
  maximumDailyHours?: number;
  minimumWeeklyHours?: number;
  targetWeeklyHours?: number;
  maximumWeeklyHours?: number;
  scheduledWeeklyClientHoursBeforeDate?: number;
};

export type StaffRelationship =
  | "PREFERRED"
  | "ALLOWED"
  | "HARD_RESTRICTION";

export type SchedulerClient = {
  id: string;
  displayCode: string;
  teamId?: string;
  serviceSetting?: ServiceSetting;
  supportLevel?: SupportLevel;
  requiredSlots: string[];
  napSlots: string[];
  napPriorityCategory?: NapPriorityCategory;
  speechSlots: string[];
  staffRelationships: Record<string, StaffRelationship>;
  maxConsecutiveBlocksWithSameStaff?: number;
  desiredDifferentStaffPerDay?: number;
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

export type HistoricalPatternScores = {
  sampleCount: number;
  scheduleDayCount: number;
  pairingScores: Record<string, number>;
  exactSlotScores: Record<string, number>;
  breakSlotScores: Record<string, number>;
};

export type SchedulerRules = {
  maximumClientsPerTechPerDay: number;
  maximumTechsPerClientPerDay: number;
  minimumClientStaffAssignmentMinutes: number;
  maximumClientStaffConsecutiveHours: number;
  preventSameStaffClientRepeatSameDay: boolean;
  allowSameStaffClientRepeatForCoverageException: boolean;
  preferSameTeam: boolean;
  preferStaffContinuity: boolean;
  slotLengthMinutes: number;
  preferredStaffPriority: number;
  sameTeamPriority: number;
  continuityPriority: number;
  rotationPriority: number;
  workloadBalancePriority: number;
  clientHandoffPenaltyPriority: number;
  staffScheduleCompactnessPriority: number;
  minimalFixAllowProtectedRelocation: boolean;
  minimalFixAllowBreakRelocation: boolean;
  preserveManualOverrides: boolean;
  scheduleStabilityPriority: number;
  weekdayTemplatePriority: number;
  weeklyHoursPriority: number;
  btCoveragePriority: number;
  internCoveragePriority: number;
  managerCoveragePriority: number;
  bcbaCoveragePriority: number;
  otherCoveragePriority: number;
  autoUseWeekdayTemplate: boolean;
  autoUsePreviousWeekdaySchedule: boolean;
  historicalPairingPriority?: number;
  historicalSlotPriority?: number;
  historicalBreakPriority?: number;
  autoUseHistoricalPatterns?: boolean;
};

export type SchedulerInput = {
  staff: SchedulerStaff[];
  clients: SchedulerClient[];
  existingAssignments: SchedulerAssignment[];
  referenceAssignments: SchedulerAssignment[];
  historicalPatterns?: HistoricalPatternScores;
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
    | "STAFF_HOUR_LIMIT"
    | "CAPACITY_SHORTAGE"
    | "REPAIRED_BY_SWAP"
    | "PAIR_REUSE_EXCEPTION";
  message: string;
};

export type SchedulerResult = {
  assignments: SchedulerAssignment[];
  uncoveredRequirements: UncoveredRequirement[];
  warnings: SchedulerWarning[];
  metrics: {
    staffCount: number;
    clientCount: number;
    requiredClientSlots: number;
    coveredClientSlots: number;
    uncoveredClientSlots: number;
    coveragePercent: number;
    requiredClientHours: number;
    coveredClientHours: number;
    uncoveredClientHours: number;
    staffAvailableHours: number;
    breakHoursReserved: number;
    netStaffCoverageHours: number;
    additionalLaborHoursNeeded: number;
  };
};
