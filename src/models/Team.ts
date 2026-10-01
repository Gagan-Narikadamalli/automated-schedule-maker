import { model, models, Schema } from "mongoose";

const TeamSchema = new Schema(
  {
    locationId: {
      type: Schema.Types.ObjectId,
      ref: "Location",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    color: {
      type: String,
      required: true,
      default: "#DCE9F8",
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

TeamSchema.index({ locationId: 1, name: 1 }, { unique: true });

export const Team = models.Team ?? model("Team", TeamSchema);
