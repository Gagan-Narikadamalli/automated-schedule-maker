import { model, models, Schema } from "mongoose";

const TrialDatasetSchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    locationId: {
      type: Schema.Types.ObjectId,
      ref: "Location",
      required: true,
      index: true,
    },
    startDate: {
      type: String,
      required: true,
    },
    endDate: {
      type: String,
      required: true,
    },
    staffIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "Staff" }],
      default: [],
    },
    clientIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "Client" }],
      default: [],
    },
    teamIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "Team" }],
      default: [],
    },
    speechSessionIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "SpeechSession" }],
      default: [],
    },
    templateIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "ScheduleTemplate" }],
      default: [],
    },
    callOutIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "CallOut" }],
      default: [],
    },
    generatedDates: {
      type: [String],
      default: [],
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

export const TrialDataset =
  models.TrialDataset ?? model("TrialDataset", TrialDatasetSchema);
