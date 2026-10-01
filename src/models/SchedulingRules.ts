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
    breakWindowStart: {
      type: String,
      default: "11:00",
    },
    breakWindowEnd: {
      type: String,
      default: "14:00",
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
  },
  {
    timestamps: true,
  }
);

export const SchedulingRules =
  models.SchedulingRules ?? model("SchedulingRules", SchedulingRulesSchema);
