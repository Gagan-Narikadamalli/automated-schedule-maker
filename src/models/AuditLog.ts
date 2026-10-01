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
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
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
