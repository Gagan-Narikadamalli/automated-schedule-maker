import { model, models, Schema } from "mongoose";

const WeekdayTemplatePreferenceSchema = new Schema({
  locationId: { type: Schema.Types.ObjectId, ref: "Location", required: true, index: true },
  dayOfWeek: { type: String, enum: ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"], required: true },
  firstTemplateId: { type: Schema.Types.ObjectId, ref: "ScheduleTemplate", default: null },
  secondTemplateId: { type: Schema.Types.ObjectId, ref: "ScheduleTemplate", default: null },
  previousWeekFirst: { type: Boolean, default: true },
}, { timestamps: true });

WeekdayTemplatePreferenceSchema.index({ locationId: 1, dayOfWeek: 1 }, { unique: true });
export const WeekdayTemplatePreference = models.WeekdayTemplatePreference ??
  model("WeekdayTemplatePreference", WeekdayTemplatePreferenceSchema);
