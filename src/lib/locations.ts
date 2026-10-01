import { connectToDatabase } from "@/lib/db";
import { Location } from "@/models/Location";

const DEFAULT_LOCATIONS = [
  {
    name: "Livingston",
    code: "LIVINGSTON",
    timezone: "America/New_York",
  },
  {
    name: "Parsippany",
    code: "PARSIPPANY",
    timezone: "America/New_York",
  },
];

export async function ensureDefaultLocations() {
  await connectToDatabase();

  for (const location of DEFAULT_LOCATIONS) {
    await Location.updateOne(
      { code: location.code },
      {
        $setOnInsert: {
          ...location,
          active: true,
        },
      },
      { upsert: true }
    );
  }

  return Location.find({ active: true }).sort({ name: 1 }).lean();
}
