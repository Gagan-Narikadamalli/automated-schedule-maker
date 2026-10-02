import { model, models, Schema } from "mongoose";

const UnplacedAssignmentSchema = new Schema(
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
    clientId: {
      type: Schema.Types.ObjectId,
      ref: "Client",
      default: null,
      index: true,
    },
    displayText: {
      type: String,
      required: true,
      trim: true,
    },
    originalStaffId: {
      type: Schema.Types.ObjectId,
      ref: "Staff",
      default: null,
    },
    originalStartTime: {
      type: String,
      required: true,
    },
    reason: {
      type: String,
      default: "Displaced by a manager schedule change.",
      trim: true,
    },
    origin: {
      type: String,
      enum: ["MANUAL_DISPLACEMENT", "AUTO_UNCOVERED"],
      default: "MANUAL_DISPLACEMENT",
      index: true,
    },
    status: {
      type: String,
      enum: ["UNPLACED", "RESOLVED"],
      default: "UNPLACED",
      index: true,
    },
    createdBy: {
      type: String,
      default: "",
      trim: true,
    },
    resolvedBy: {
      type: String,
      default: "",
      trim: true,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

UnplacedAssignmentSchema.index({
  locationId: 1,
  date: 1,
  status: 1,
  origin: 1,
  createdAt: 1,
});

export const UnplacedAssignment =
  models.UnplacedAssignment ??
  model("UnplacedAssignment", UnplacedAssignmentSchema);
