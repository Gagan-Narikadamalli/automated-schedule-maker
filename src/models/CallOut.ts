import { model, models, Schema } from "mongoose";

const CallOutSchema = new Schema(
  {
    locationId: {
      type: Schema.Types.ObjectId,
      ref: "Location",
      required: true,
      index: true,
    },
    staffId: {
      type: Schema.Types.ObjectId,
      ref: "Staff",
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
      default: "08:00",
    },
    endTime: {
      type: String,
      default: "20:00",
    },
    reason: {
      type: String,
      default: "",
      trim: true,
    },
    note: {
      type: String,
      default: "",
      trim: true,
    },
    createdByUserId: {
      type: String,
      default: "scheduler-system",
      trim: true,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

CallOutSchema.index({ locationId: 1, date: 1, staffId: 1 });

export const CallOut = models.CallOut ?? model("CallOut", CallOutSchema);
