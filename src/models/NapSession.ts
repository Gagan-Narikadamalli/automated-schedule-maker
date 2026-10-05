import { model, models, Schema } from "mongoose";

const NapSessionSchema = new Schema(
  {
    locationId: {
      type: Schema.Types.ObjectId,
      ref: "Location",
      required: true,
      index: true,
    },
    clientId: {
      type: Schema.Types.ObjectId,
      ref: "Client",
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
    priorityCategory: {
      type: String,
      enum: ["YOUNGER", "OLDER"],
      default: "OLDER",
      required: true,
    },
    recurringSeriesId: {
      type: String,
      default: "",
    },
    note: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

NapSessionSchema.index({ locationId: 1, date: 1, clientId: 1 });
NapSessionSchema.index({ locationId: 1, recurringSeriesId: 1 });

export const NapSession =
  models.NapSession ?? model("NapSession", NapSessionSchema);
