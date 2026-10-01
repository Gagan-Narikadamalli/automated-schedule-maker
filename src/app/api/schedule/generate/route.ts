import { NextResponse } from "next/server";

import { getEndTimeForSlot } from "@/features/scheduler/engine/dateUtils";
import { generateSchedule } from "@/features/scheduler/engine/generateSchedule";
import { reserveStaffBreaks } from "@/features/scheduler/engine/reserveBreaks";
import type { SchedulerAssignment } from "@/features/scheduler/engine/types";
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
import { ScheduleAssignment } from "@/models/ScheduleAssignment";

type GenerateRequest = {
  locationId?: string;
  date?: string;
};

function shouldKeepExistingAssignment(
  assignment: SchedulerAssignment
): boolean {
  return (
    assignment.locked ||
    assignment.source === "MANUAL" ||
    assignment.assignmentType === "SPEECH" ||
    assignment.assignmentType === "UNAVAILABLE"
  );
}

export async function POST(request: Request) {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  if (!sessionHasAnyRole(auth.session, SCHEDULE_WRITE_ROLES)) {
    return forbiddenResponse();
  }

  try {
    const body = (await request.json()) as GenerateRequest;
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

    const dayData = await buildDaySchedulerInput(locationId, date);

    const protectedAssignments = dayData.input.existingAssignments.filter(
      shouldKeepExistingAssignment
    );

    const reservedBreaks = reserveStaffBreaks({
      staff: dayData.staff,
      clients: dayData.clients,
      existingAssignments: protectedAssignments,
      callOutStaffIds: dayData.input.callOutStaffIds,
      rules: dayData.extendedRules,
    });

    const result = generateSchedule({
      ...dayData.input,
      existingAssignments: [
        ...protectedAssignments,
        ...reservedBreaks,
      ],
    });

    await connectToDatabase();

    await ScheduleAssignment.deleteMany({
      locationId,
      date,
      manuallyOverridden: { $ne: true },
      source: { $in: ["AUTO", "TEMPLATE", "COPIED"] },
    });

    const autoAssignments = result.assignments.filter(
      (assignment) => assignment.source === "AUTO"
    );

    if (autoAssignments.length > 0) {
      await ScheduleAssignment.insertMany(
        autoAssignments.map((assignment) => ({
          locationId,
          date,
          startTime: assignment.startTime,
          endTime: getEndTimeForSlot(assignment.startTime),
          staffId: assignment.staffId,
          clientId: assignment.clientId || null,
          assignmentType: assignment.assignmentType,
          source: "AUTO",
          locked: assignment.locked,
          manuallyOverridden: false,
          note: assignment.note || "",
        }))
      );
    }

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: "GENERATE",
      entityType: "SCHEDULE_DAY",
      entityId: date,
      summary: `Generated schedule for ${date}: ${result.metrics.coveredClientSlots}/${result.metrics.requiredClientSlots} client blocks covered.`,
      after: {
        metrics: result.metrics,
        uncoveredRequirements: result.uncoveredRequirements,
        warningCount: result.warnings.length,
      },
    });

    return NextResponse.json({
      success: true,
      date,
      locationId,
      metrics: result.metrics,
      warnings: result.warnings,
      uncoveredRequirements: result.uncoveredRequirements,
      reservedBreakCount: reservedBreaks.length,
    });
  } catch (error) {
    console.error("Schedule generation failed:", error);

    return NextResponse.json(
      { error: "The schedule could not be generated." },
      { status: 500 }
    );
  }
}
