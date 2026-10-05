import { model, models, Schema } from "mongoose";

const ClientAttendanceExceptionSchema = new Schema(
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
    changeType: {
      type: String,
      enum: ["CALL_OUT", "CALL_IN"],
      required: true,
    },
    startTime: {
      type: String,
      default: "08:00",
      required: true,
    },
    endTime: {
      type: String,
      default: "18:00",
      required: true,
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
  { timestamps: true }
);

ClientAttendanceExceptionSchema.index(
  { locationId: 1, date: 1, clientId: 1 },
  { unique: true }
);

export const ClientAttendanceException =
  models.ClientAttendanceException ??
  model("ClientAttendanceException", ClientAttendanceExceptionSchema);
