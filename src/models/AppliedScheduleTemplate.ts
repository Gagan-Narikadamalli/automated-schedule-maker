import { model, models, Schema } from "mongoose";

/** A manager's explicit template choice for a particular clinic date. */
const AppliedScheduleTemplateSchema = new Schema({
  locationId: { type: Schema.Types.ObjectId, ref: "Location", required: true, index: true },
  date: { type: String, required: true },
  templateId: { type: Schema.Types.ObjectId, ref: "ScheduleTemplate", required: true },
}, { timestamps: true });

AppliedScheduleTemplateSchema.index({ locationId: 1, date: 1 }, { unique: true });

export const AppliedScheduleTemplate = models.AppliedScheduleTemplate ??
  model("AppliedScheduleTemplate", AppliedScheduleTemplateSchema);
