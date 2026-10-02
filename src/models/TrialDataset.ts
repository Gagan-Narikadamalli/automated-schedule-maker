import {
  model,
  models,
  Schema,
  type Model,
  type Types,
} from "mongoose";

export type TrialDatasetDocument = {
  key: string;
  locationId: Types.ObjectId;
  startDate: string;
  endDate: string;
  staffIds: Types.ObjectId[];
  clientIds: Types.ObjectId[];
  teamIds: Types.ObjectId[];
  speechSessionIds: Types.ObjectId[];
  templateIds: Types.ObjectId[];
  callOutIds: Types.ObjectId[];
  generatedDates: string[];
  notes: string;
};

const TrialDatasetSchema = new Schema<TrialDatasetDocument>(
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

export const TrialDataset: Model<TrialDatasetDocument> =
  (models.TrialDataset as Model<TrialDatasetDocument> | undefined) ??
  model<TrialDatasetDocument>("TrialDataset", TrialDatasetSchema);
