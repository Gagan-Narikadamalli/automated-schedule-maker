import { model, models, Schema } from "mongoose";
const AttendanceOverrideSchema = new Schema({
  locationId: { type: Schema.Types.ObjectId, ref: "Location", required: true, index: true },
  personId: { type: Schema.Types.ObjectId, required: true },
  personType: { type: String, enum: ["staff", "client"], required: true },
  date: { type: String, required: true },
  mode: { type: String, enum: ["IN", "OUT"], required: true },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
}, { timestamps: true });
AttendanceOverrideSchema.index({ locationId: 1, date: 1, personType: 1, personId: 1 }, { unique: true });
export const AttendanceOverride = models.AttendanceOverride ?? model("AttendanceOverride", AttendanceOverrideSchema);
