import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/api/auth";
import { connectToDatabase } from "@/lib/db";
import { ensureDefaultLocations } from "@/lib/locations";
import { Location } from "@/models/Location";

export async function GET() {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  try {
    await connectToDatabase();
    await ensureDefaultLocations();

    const query =
      auth.session.role === "ADMIN"
        ? { active: true }
        : {
            _id: { $in: auth.session.locationIds },
            active: true,
          };

    const locations = await Location.find(query)
      .sort({ name: 1 })
      .lean();

    return NextResponse.json({
      locations: locations.map((location) => ({
        id: String(location._id),
        name: location.name,
        code: location.code,
        timezone: location.timezone,
      })),
    });
  } catch (error) {
    console.error("Failed to load locations:", error);

    return NextResponse.json(
      { error: "Locations could not be loaded." },
      { status: 500 }
    );
  }
}
