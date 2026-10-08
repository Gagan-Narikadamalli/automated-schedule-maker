import { model, models, Schema } from "mongoose";

const ClientCallOutSchema = new Schema({
  locationId: { type: Schema.Types.ObjectId, ref: "Location", required: true, index: true },
  clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },
  date: { type: String, required: true },
  reason: { type: String, default: "Call out" },
}, { timestamps: true });
ClientCallOutSchema.index({ locationId: 1, date: 1, clientId: 1 }, { unique: true });

export const ClientCallOut = models.ClientCallOut ?? model("ClientCallOut", ClientCallOutSchema);
