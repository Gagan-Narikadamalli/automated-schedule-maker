import { model, models, Schema } from "mongoose";

const ShiftPatternSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    days: {
      type: [String],
      required: true,
      default: [],
    },
    startTime: {
      type: String,
      required: true,
    },
    endTime: {
      type: String,
      required: true,
    },
  },
  {
    _id: true,
  }
);

const StaffSchema = new Schema(
  {
    locationId: {
      type: Schema.Types.ObjectId,
      ref: "Location",
      required: true,
      index: true,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      default: null,
    },
    role: {
      type: String,
      enum: ["BT", "RBT", "INTERN", "BCBA", "OFFICE_MANAGER", "OTHER"],
      required: true,
    },
    employeeType: {
      type: String,
      enum: ["FULL_TIME", "PART_TIME"],
      required: true,
    },
    teamId: {
      type: Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },
    color: {
      type: String,
      default: "#DCE9F8",
    },
    serviceSetting: {
      type: String,
      enum: ["IN_CENTER", "IN_HOME", "BOTH"],
      default: "IN_CENTER",
    },
    minimumWeeklyHours: {
      type: Number,
      default: 0,
      min: 0,
    },
    targetWeeklyHours: {
      type: Number,
      default: 0,
      min: 0,
    },
    maximumWeeklyHours: {
      type: Number,
      default: 40,
      min: 0,
    },
    shiftPatterns: {
      type: [ShiftPatternSchema],
      default: [],
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

StaffSchema.index({ locationId: 1, active: 1, fullName: 1 });

export const Staff = models.Staff ?? model("Staff", StaffSchema);
