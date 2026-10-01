import { NextResponse } from "next/server";

import {
  forbiddenResponse,
  requireApiSession,
  SCHEDULE_WRITE_ROLES,
  sessionCanAccessLocation,
  sessionHasAnyRole,
} from "@/lib/api/auth";
import { writeAuditLog } from "@/lib/api/audit";
import { connectToDatabase } from "@/lib/db";
import { ScheduleAssignment } from "@/models/ScheduleAssignment";

type ClearScheduleCellRequest = {
  locationId?: string;
  date?: string;
  staffId?: string;
  startTime?: string;
};

export async function POST(request: Request) {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  if (!sessionHasAnyRole(auth.session, SCHEDULE_WRITE_ROLES)) {
    return forbiddenResponse();
  }

  try {
    const body = (await request.json()) as ClearScheduleCellRequest;
    const locationId = body.locationId?.trim();
    const date = body.date?.trim();
    const staffId = body.staffId?.trim();
    const startTime = body.startTime?.trim();

    if (!locationId || !date || !staffId || !startTime) {
      return NextResponse.json(
        {
          error:
            "Location, date, staff member, and start time are required.",
        },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    await connectToDatabase();

    const existingAssignment = await ScheduleAssignment.findOne({
      locationId,
      date,
      staffId,
      startTime,
    });

    if (!existingAssignment) {
      return NextResponse.json({
        success: true,
        cleared: false,
      });
    }

    const before = existingAssignment.toObject();
    const assignmentId = String(existingAssignment._id);

    await existingAssignment.deleteOne();

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: "MANUAL_CLEAR",
      entityType: "SCHEDULE_ASSIGNMENT",
      entityId: assignmentId,
      summary: `Cleared the schedule cell at ${startTime} on ${date}.`,
      before,
      after: null,
    });

    return NextResponse.json({
      success: true,
      cleared: true,
    });
  } catch (error) {
    console.error("Manual schedule clear failed:", error);

    return NextResponse.json(
      { error: "The schedule cell could not be cleared." },
      { status: 500 }
    );
  }
}
