import { model, models, Schema } from "mongoose";

const LocationSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    timezone: {
      type: String,
      default: "America/New_York",
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

export const Location =
  models.Location ?? model("Location", LocationSchema);
