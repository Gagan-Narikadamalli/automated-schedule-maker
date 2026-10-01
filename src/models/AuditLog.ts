import { model, models, Schema } from "mongoose";

const AuditLogSchema = new Schema(
  {
    locationId: {
      type: Schema.Types.ObjectId,
      ref: "Location",
      required: true,
      index: true,
    },
    userId: {
      // Store a descriptive actor identifier as text. While the scheduler runs
      // without individual user accounts, automated and manual changes use the
      // shared scheduler-system actor so the activity history remains useful.
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    action: {
      type: String,
      required: true,
      trim: true,
    },
    entityType: {
      type: String,
      required: true,
      trim: true,
    },
    entityId: {
      type: String,
      default: "",
    },
    summary: {
      type: String,
      required: true,
      trim: true,
    },
    before: {
      type: Schema.Types.Mixed,
      default: null,
    },
    after: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

AuditLogSchema.index({ locationId: 1, createdAt: -1 });

export const AuditLog = models.AuditLog ?? model("AuditLog", AuditLogSchema);
