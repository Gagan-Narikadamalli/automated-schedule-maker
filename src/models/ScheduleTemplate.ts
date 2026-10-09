import { model, models, Schema } from "mongoose";

const TemplateAssignmentSchema = new Schema(
  {
    startTime: {
      type: String,
      required: true,
    },
    endTime: {
      type: String,
      required: true,
    },
    staffId: {
      type: Schema.Types.ObjectId,
      ref: "Staff",
      required: true,
    },
    clientId: {
      type: Schema.Types.ObjectId,
      ref: "Client",
      default: null,
    },
    assignmentType: {
      type: String,
      enum: [
        "CLIENT_1_TO_1",
        "BREAK",
        "BREAK_NAP",
        "BREAK_SPEECH",
        "NAP",
        "SPEECH",
        "UNAVAILABLE",
        "OPEN",
      ],
      required: true,
    },
    locked: {
      type: Boolean,
      default: false,
    },
  },
  {
    _id: true,
  }
);

const TemplateLearningProfileSchema = new Schema(
  {
    humanStyleBlockBalancingEnabled: {
      type: Boolean,
      default: true,
    },
    preferredClientsPerStaffPerDay: {
      type: Number,
      default: 2,
      min: 1,
      max: 6,
    },
    preferredStaffPerClientPerDay: {
      type: Number,
      default: 2,
      min: 1,
      max: 6,
    },
    continuityPriority: {
      type: Number,
      default: 200,
      min: 0,
      max: 500,
    },
    clientHandoffPenaltyPriority: {
      type: Number,
      default: 200,
      min: 0,
      max: 500,
    },
    workloadBalancePriority: {
      type: Number,
      default: 0,
      min: 0,
      max: 500,
    },
    staffScheduleCompactnessPriority: {
      type: Number,
      default: 8,
      min: 0,
      max: 500,
    },
  },
  {
    _id: false,
  }
);

const ScheduleTemplateSchema = new Schema(
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
    sourceType: {
      type: String,
      enum: ["SAVED_SCHEDULE", "HISTORICAL_WORKBOOK", "MANUAL"],
      default: "MANUAL",
    },
    sourceName: {
      type: String,
      default: "",
      trim: true,
    },
    sourceDate: {
      type: String,
      default: "",
      trim: true,
    },
    styleNotes: {
      type: [String],
      default: [],
    },
    learningOnly: {
      type: Boolean,
      default: false,
    },
    learningProfile: {
      type: TemplateLearningProfileSchema,
      default: null,
    },
    dayOfWeek: {
      type: String,
      enum: [
        "MONDAY",
        "TUESDAY",
        "WEDNESDAY",
        "THURSDAY",
        "FRIDAY",
        "SATURDAY",
        "SUNDAY",
      ],
      required: true,
    },
    clientNapSlots: {
      type: [{
        clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },
        startTime: { type: String, required: true },
      }],
      default: [],
    },
    assignments: {
      type: [TemplateAssignmentSchema],
      default: [],
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

ScheduleTemplateSchema.index(
  { locationId: 1, dayOfWeek: 1, name: 1 },
  { unique: true }
);

export const ScheduleTemplate =
  models.ScheduleTemplate ?? model("ScheduleTemplate", ScheduleTemplateSchema);
