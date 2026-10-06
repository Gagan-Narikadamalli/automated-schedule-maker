import { model, models, Schema } from "mongoose";

const AITrainingExampleSchema = new Schema(
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
    userId: {
      type: String,
      default: "",
      trim: true,
    },
    request: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4000,
    },
    assistantResponse: {
      type: String,
      required: true,
      trim: true,
      maxlength: 12000,
    },
    model: {
      type: String,
      required: true,
      trim: true,
    },
    mode: {
      type: String,
      enum: ["READ_ONLY"],
      default: "READ_ONLY",
      index: true,
    },
    toolsSelected: {
      type: [String],
      default: [],
    },
    managerAccepted: {
      type: Boolean,
      default: null,
      index: true,
    },
    managerCorrection: {
      type: String,
      default: "",
      trim: true,
      maxlength: 4000,
    },
  },
  {
    timestamps: true,
  }
);

AITrainingExampleSchema.index({
  locationId: 1,
  date: 1,
  createdAt: -1,
});

export const AITrainingExample =
  models.AITrainingExample ??
  model("AITrainingExample", AITrainingExampleSchema);
