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
import { UnplacedAssignment } from "@/models/UnplacedAssignment";

type ClearScheduleDayRequest = {
  locationId?: string;
  date?: string;
};

export async function DELETE(request: Request) {
  const auth = await requireApiSession();
  if (auth.error) return auth.error;
  if (!sessionHasAnyRole(auth.session, SCHEDULE_WRITE_ROLES)) {
    return forbiddenResponse();
  }

  try {
    const body = (await request.json()) as ClearScheduleDayRequest;
    const locationId = body.locationId?.trim();
    const date = body.date?.trim();

    if (!locationId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: "A location and valid YYYY-MM-DD date are required." },
        { status: 400 }
      );
    }
    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    await connectToDatabase();
    const [assignments, unplaced] = await Promise.all([
      ScheduleAssignment.deleteMany({ locationId, date }),
      UnplacedAssignment.deleteMany({ locationId, date }),
    ]);

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: "CLEAR_SCHEDULE_DAY",
      entityType: "SCHEDULE_DAY",
      entityId: date,
      summary: `Completely cleared the saved schedule and Unplaced records for ${date}.`,
      after: {
        deletedScheduleAssignments: assignments.deletedCount ?? 0,
        deletedUnplacedAssignments: unplaced.deletedCount ?? 0,
      },
    });

    return NextResponse.json({
      success: true,
      date,
      deletedAssignmentCount: assignments.deletedCount ?? 0,
      deletedUnplacedCount: unplaced.deletedCount ?? 0,
      message: `Removed all saved schedule assignments and Unplaced records for ${date}. Staff shifts, client attendance, call-outs, and saved nap/speech events were not deleted.`,
    });
  } catch (error) {
    console.error("Failed to clear the schedule day:", error);
    return NextResponse.json(
      { error: "The selected day's schedule could not be cleared." },
      { status: 500 }
    );
  }
}
