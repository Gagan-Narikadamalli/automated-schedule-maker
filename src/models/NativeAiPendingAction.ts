import { model, models, Schema } from "mongoose";

const NativeAiPendingActionSchema = new Schema(
  {
    locationId: {
      type: Schema.Types.ObjectId,
      ref: "Location",
      required: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    date: {
      type: String,
      required: true,
      index: true,
    },
    intent: {
      type: String,
      required: true,
      trim: true,
    },
    toolName: {
      type: String,
      required: true,
      trim: true,
    },
    input: {
      type: Schema.Types.Mixed,
      required: true,
      default: {},
    },
    stage: {
      type: String,
      enum: ["USER_CONFIRMATION", "OVERRIDE_CONFIRMATION"],
      default: "USER_CONFIRMATION",
      index: true,
    },
    preview: {
      type: String,
      default: "",
      maxlength: 4000,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  { timestamps: true }
);

NativeAiPendingActionSchema.index(
  { locationId: 1, userId: 1 },
  { unique: true }
);

export const NativeAiPendingAction =
  models.NativeAiPendingAction ??
  model("NativeAiPendingAction", NativeAiPendingActionSchema);
