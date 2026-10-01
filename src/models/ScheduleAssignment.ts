import { model, models, Schema } from "mongoose";

const ScheduleAssignmentSchema = new Schema(
  {
    locationId: {
      type: Schema.Types.ObjectId,
      ref: "Location",
      required: true,
      index: true,
    },
    date: {
      type: String,
      required: true,
      index: true,
    },
    startTime: {
      type: String,
      required: true,
    },
    endTime: {
      type: String,
      required: true,
    },
    staffId: {
      type: Schema.Types.ObjectId,
      ref: "Staff",
      required: true,
    },
    clientId: {
      type: Schema.Types.ObjectId,
      ref: "Client",
      default: null,
    },
    assignmentType: {
      type: String,
      enum: [
        "CLIENT_1_TO_1",
        "BREAK",
        "BREAK_NAP",
        "BREAK_SPEECH",
        "NAP",
        "SPEECH",
        "UNAVAILABLE",
        "OPEN",
      ],
      required: true,
    },
    source: {
      type: String,
      enum: ["AUTO", "MANUAL", "TEMPLATE", "COPIED"],
      default: "AUTO",
    },
    locked: {
      type: Boolean,
      default: false,
    },
    manuallyOverridden: {
      type: Boolean,
      default: false,
    },
    note: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

ScheduleAssignmentSchema.index(
  {
    locationId: 1,
    date: 1,
    staffId: 1,
    startTime: 1,
  },
  {
    unique: true,
  }
);

export const ScheduleAssignment =
  models.ScheduleAssignment ??
  model("ScheduleAssignment", ScheduleAssignmentSchema);
