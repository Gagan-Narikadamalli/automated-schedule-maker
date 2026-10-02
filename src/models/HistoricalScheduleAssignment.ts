import { model, models, Schema } from "mongoose";

const HistoricalScheduleAssignmentSchema = new Schema(
  {
    locationId: {
      type: Schema.Types.ObjectId,
      ref: "Location",
      required: true,
      index: true,
    },
    importBatchId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    sourceName: {
      type: String,
      required: true,
      trim: true,
    },
    sheetName: {
      type: String,
      required: true,
      trim: true,
    },
    scheduleDate: {
      type: String,
      required: true,
      index: true,
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
      index: true,
    },
    staffId: {
      type: Schema.Types.ObjectId,
      ref: "Staff",
      default: null,
      index: true,
    },
    clientId: {
      type: Schema.Types.ObjectId,
      ref: "Client",
      default: null,
      index: true,
    },
    rawStaffName: {
      type: String,
      required: true,
      trim: true,
    },
    rawClientCode: {
      type: String,
      default: "",
      trim: true,
    },
    startTime: {
      type: String,
      required: true,
      index: true,
    },
    endTime: {
      type: String,
      required: true,
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
      ],
      required: true,
      index: true,
    },
    rawText: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

HistoricalScheduleAssignmentSchema.index({
  locationId: 1,
  dayOfWeek: 1,
  assignmentType: 1,
  startTime: 1,
});

HistoricalScheduleAssignmentSchema.index({
  locationId: 1,
  staffId: 1,
  clientId: 1,
  dayOfWeek: 1,
  startTime: 1,
});

export const HistoricalScheduleAssignment =
  models.HistoricalScheduleAssignment ??
  model(
    "HistoricalScheduleAssignment",
    HistoricalScheduleAssignmentSchema
  );
