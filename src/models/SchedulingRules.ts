import { model, models, Schema } from "mongoose";

const SchedulingRulesSchema = new Schema(
  {
    locationId: {
      type: Schema.Types.ObjectId,
      ref: "Location",
      required: true,
      unique: true,
    },
    fullTimeMinimumWeeklyHours: {
      type: Number,
      default: 30,
      min: 0,
    },
    fullTimeMaximumWeeklyHours: {
      type: Number,
      default: 40,
      min: 0,
    },
    partTimeMinimumWeeklyHours: {
      type: Number,
      default: 0,
      min: 0,
    },
    partTimeMaximumWeeklyHours: {
      type: Number,
      default: 29,
      min: 0,
    },
    maximumClientsPerTechPerDay: {
      type: Number,
      default: 6,
      min: 1,
    },
    maximumTechsPerClientPerDay: {
      type: Number,
      default: 4,
      min: 1,
    },
    minimumClientStaffAssignmentMinutes: {
      type: Number,
      default: 30,
      min: 30,
      max: 240,
    },
    maximumClientStaffConsecutiveHours: {
      type: Number,
      default: 4,
      min: 3,
      max: 4,
    },
    preventSameStaffClientRepeatSameDay: {
      type: Boolean,
      default: true,
    },
    allowSameStaffClientRepeatForCoverageException: {
      type: Boolean,
      default: true,
    },
    defaultBreakMinutes: {
      type: Number,
      default: 30,
      min: 0,
    },
    breakEligibilityHours: {
      type: Number,
      default: 6,
      min: 0,
      max: 24,
    },
    breakWindowStart: {
      type: String,
      default: "11:00",
    },
    breakWindowEnd: {
      type: String,
      default: "13:30",
    },
    scheduleStartTime: {
      type: String,
      default: "08:00",
    },
    scheduleEndTime: {
      type: String,
      default: "20:00",
    },
    slotLengthMinutes: {
      type: Number,
      default: 30,
    },
    preferSameTeam: {
      type: Boolean,
      default: true,
    },
    preferStaffContinuity: {
      type: Boolean,
      default: true,
    },
    preserveManualOverrides: {
      type: Boolean,
      default: true,
    },
    preferredStaffPriority: {
      type: Number,
      default: 100,
      min: 0,
      max: 200,
    },
    sameTeamPriority: {
      type: Number,
      default: 40,
      min: 0,
      max: 200,
    },
    continuityPriority: {
      type: Number,
      default: 35,
      min: 0,
      max: 200,
    },
    rotationPriority: {
      type: Number,
      default: 60,
      min: 0,
      max: 200,
    },
    workloadBalancePriority: {
      type: Number,
      default: 10,
      min: 0,
      max: 200,
    },
    clientHandoffPenaltyPriority: {
      type: Number,
      default: 25,
      min: 0,
      max: 200,
    },
    staffScheduleCompactnessPriority: {
      type: Number,
      default: 8,
      min: 0,
      max: 200,
    },
    minimalFixAllowProtectedRelocation: {
      type: Boolean,
      default: true,
    },
    minimalFixAllowBreakRelocation: {
      type: Boolean,
      default: true,
    },
    scheduleStabilityPriority: {
      type: Number,
      default: 140,
      min: 0,
      max: 200,
    },
    weekdayTemplatePriority: {
      type: Number,
      default: 75,
      min: 0,
      max: 200,
    },
    weeklyHoursPriority: {
      type: Number,
      default: 12,
      min: 0,
      max: 200,
    },
    historicalPairingPriority: {
      type: Number,
      default: 70,
      min: 0,
      max: 200,
    },
    historicalSlotPriority: {
      type: Number,
      default: 90,
      min: 0,
      max: 200,
    },
    historicalBreakPriority: {
      type: Number,
      default: 80,
      min: 0,
      max: 200,
    },
    btCoveragePriority: {
      type: Number,
      default: 500,
      min: 0,
      max: 1000,
    },
    internCoveragePriority: {
      type: Number,
      default: 300,
      min: 0,
      max: 1000,
    },
    managerCoveragePriority: {
      type: Number,
      default: 125,
      min: 0,
      max: 1000,
    },
    bcbaCoveragePriority: {
      type: Number,
      default: 25,
      min: 0,
      max: 1000,
    },
    otherCoveragePriority: {
      type: Number,
      default: 75,
      min: 0,
      max: 1000,
    },
    autoUseWeekdayTemplate: {
      type: Boolean,
      default: true,
    },
    autoUsePreviousWeekdaySchedule: {
      type: Boolean,
      default: true,
    },
    autoUseHistoricalPatterns: {
      type: Boolean,
      default: true,
    },
    napDurationRulesEnabled: {
      type: Boolean,
      default: true,
    },
    napMinimumMinutes: {
      type: Number,
      default: 30,
      min: 30,
      max: 240,
    },
    napPreferredMinutes: {
      type: Number,
      default: 30,
      min: 30,
      max: 240,
    },
    napMaximumMinutes: {
      type: Number,
      default: 60,
      min: 30,
      max: 240,
    },
    speechDurationRulesEnabled: {
      type: Boolean,
      default: false,
    },
    speechMinimumMinutes: {
      type: Number,
      default: 30,
      min: 30,
      max: 240,
    },
    speechPreferredMinutes: {
      type: Number,
      default: 30,
      min: 30,
      max: 240,
    },
    speechMaximumMinutes: {
      type: Number,
      default: 60,
      min: 30,
      max: 240,
    },
    supervisionPlanningTargetPercent: {
      type: Number,
      default: 5,
      min: 0,
      max: 100,
    },
  },
  {
    timestamps: true,
  }
);

export const SchedulingRules =
  models.SchedulingRules ?? model("SchedulingRules", SchedulingRulesSchema);
