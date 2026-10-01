import { NextResponse } from "next/server";

import {
  forbiddenResponse,
  requireApiSession,
  sessionCanAccessLocation,
} from "@/lib/api/auth";
import { connectToDatabase } from "@/lib/db";
import { AuditLog } from "@/models/AuditLog";

type PlainRecord = Record<string, any>;

export async function GET(request: Request) {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  const url = new URL(request.url);
  const locationId = url.searchParams.get("locationId");
  const requestedLimit = Number(url.searchParams.get("limit") ?? "100");
  const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 100, 250));

  if (!locationId) {
    return NextResponse.json(
      { error: "locationId is required." },
      { status: 400 }
    );
  }

  if (!sessionCanAccessLocation(auth.session, locationId)) {
    return forbiddenResponse("You do not have access to this location.");
  }

  try {
    await connectToDatabase();

    const activity = await AuditLog.find({ locationId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return NextResponse.json({
      activity: (activity as unknown as PlainRecord[]).map((entry) => ({
        id: String(entry._id),
        userId: String(entry.userId ?? "Unknown user"),
        action: String(entry.action ?? ""),
        entityType: String(entry.entityType ?? ""),
        entityId: String(entry.entityId ?? ""),
        summary: String(entry.summary ?? ""),
        createdAt: entry.createdAt,
      })),
    });
  } catch (error) {
    console.error("Failed to load activity:", error);

    return NextResponse.json(
      { error: "Activity history could not be loaded." },
      { status: 500 }
    );
  }
}
