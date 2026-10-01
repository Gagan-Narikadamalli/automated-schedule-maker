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
