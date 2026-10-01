import { model, models, Schema } from "mongoose";

const SupervisionRecordSchema = new Schema(
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
    supervisorStaffId: {
      type: Schema.Types.ObjectId,
      ref: "Staff",
      default: null,
    },
    month: {
      type: String,
      required: true,
      index: true,
    },
    serviceHours: {
      type: Number,
      default: 0,
      min: 0,
    },
    supervisionHours: {
      type: Number,
      default: 0,
      min: 0,
    },
    planningTargetPercent: {
      type: Number,
      default: 5,
      min: 0,
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

SupervisionRecordSchema.index(
  { locationId: 1, staffId: 1, month: 1 },
  { unique: true }
);

export const SupervisionRecord =
  models.SupervisionRecord ?? model("SupervisionRecord", SupervisionRecordSchema);
