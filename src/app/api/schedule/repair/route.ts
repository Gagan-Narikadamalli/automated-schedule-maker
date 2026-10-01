import { NextResponse } from "next/server";

import { getEndTimeForSlot } from "@/features/scheduler/engine/dateUtils";
import { repairSchedule } from "@/features/scheduler/engine/repairSchedule";
import { buildDaySchedulerInput } from "@/features/scheduler/server/buildDaySchedulerInput";
import {
  forbiddenResponse,
  requireApiSession,
  SCHEDULE_WRITE_ROLES,
  sessionCanAccessLocation,
  sessionHasAnyRole,
} from "@/lib/api/auth";
import { writeAuditLog } from "@/lib/api/audit";
import { connectToDatabase } from "@/lib/db";
import { CallOut } from "@/models/CallOut";
import { ScheduleAssignment } from "@/models/ScheduleAssignment";

type RepairRequest = {
  locationId?: string;
  date?: string;
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
    const body = (await request.json()) as RepairRequest;
    const locationId = body.locationId?.trim();
    const date = body.date?.trim();

    if (!locationId || !date) {
      return NextResponse.json(
        { error: "locationId and date are required." },
        { status: 400 }
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: "Date must use YYYY-MM-DD format." },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    await connectToDatabase();

    const callOuts = await CallOut.find({ locationId, date })
      .select("staffId")
      .lean();

    const affectedStaffIds = Array.from(
      new Set(callOuts.map((callOut) => String(callOut.staffId)))
    );

    if (affectedStaffIds.length === 0) {
      return NextResponse.json(
        {
          error:
            "There are no recorded call-outs for this date. Add the call-out first, then run Repair Schedule.",
        },
        { status: 400 }
      );
    }

    const dayData = await buildDaySchedulerInput(locationId, date);
    const result = repairSchedule(dayData.input, affectedStaffIds);

    await ScheduleAssignment.deleteMany({
      locationId,
      date,
      manuallyOverridden: { $ne: true },
      source: { $in: ["AUTO", "TEMPLATE", "COPIED"] },
    });

    const assignmentsToPersist = result.assignments.filter(
      (assignment) => assignment.source !== "MANUAL"
    );

    if (assignmentsToPersist.length > 0) {
      await ScheduleAssignment.insertMany(
        assignmentsToPersist.map((assignment) => ({
          locationId,
          date,
          startTime: assignment.startTime,
          endTime: getEndTimeForSlot(assignment.startTime),
          staffId: assignment.staffId,
          clientId: assignment.clientId || null,
          assignmentType: assignment.assignmentType,
          source: assignment.source,
          locked: assignment.locked,
          manuallyOverridden: false,
          note: assignment.note || "",
        }))
      );
    }

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: "REPAIR",
      entityType: "SCHEDULE_DAY",
      entityId: date,
      summary: `Repaired the schedule for ${date} after ${affectedStaffIds.length} staff call-out(s).`,
      after: {
        affectedStaffIds,
        metrics: result.metrics,
        uncoveredRequirements: result.uncoveredRequirements,
        warningCount: result.warnings.length,
      },
    });

    return NextResponse.json({
      success: true,
      date,
      locationId,
      affectedStaffIds,
      metrics: result.metrics,
      warnings: result.warnings,
      uncoveredRequirements: result.uncoveredRequirements,
    });
  } catch (error) {
    console.error("Schedule repair failed:", error);

    return NextResponse.json(
      { error: "The schedule could not be repaired." },
      { status: 500 }
    );
  }
}
