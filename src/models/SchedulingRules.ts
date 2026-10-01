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
      default: "18:00",
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
