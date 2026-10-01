import { model, models, Schema } from "mongoose";

const AttendancePatternSchema = new Schema(
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

const StaffRelationshipSchema = new Schema(
  {
    staffId: {
      type: Schema.Types.ObjectId,
      ref: "Staff",
      required: true,
    },
    relationship: {
      type: String,
      enum: ["PREFERRED", "ALLOWED", "HARD_RESTRICTION"],
      default: "ALLOWED",
    },
  },
  {
    _id: false,
  }
);

const ClientSchema = new Schema(
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
    displayCode: {
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
    teamId: {
      type: Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },
    color: {
      type: String,
      default: "#D9F4EE",
    },
    serviceSetting: {
      type: String,
      enum: ["IN_CENTER", "IN_HOME", "BOTH"],
      default: "IN_CENTER",
    },
    supportLevel: {
      type: String,
      enum: ["STANDARD", "ONE_TO_ONE", "ROTATION", "HIGH_SUPPORT"],
      default: "ONE_TO_ONE",
    },
    insurancePlan: {
      type: String,
      default: "",
      trim: true,
    },
    assignedBcbaId: {
      type: Schema.Types.ObjectId,
      ref: "Staff",
      default: null,
    },
    assignedInternIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "Staff" }],
      default: [],
    },
    attendancePatterns: {
      type: [AttendancePatternSchema],
      default: [],
    },
    staffRelationships: {
      type: [StaffRelationshipSchema],
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

ClientSchema.index({ locationId: 1, active: 1, displayCode: 1 });

export const Client = models.Client ?? model("Client", ClientSchema);
