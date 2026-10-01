import { NextResponse } from "next/server";

import { getEndTimeForSlot } from "@/features/scheduler/engine/dateUtils";
import { generateSchedule } from "@/features/scheduler/engine/generateSchedule";
import {
  enrichBreakAssignmentsWithFixedEvents,
  reserveStaffBreaks,
} from "@/features/scheduler/engine/reserveBreaks";
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

type GenerateRangeRequest = {
  locationId?: string;
  startDate?: string;
  endDate?: string;
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

function enumerateDates(
  startDate: string,
  endDate: string
): string[] {
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  const dates: string[] = [];

  for (
    const cursor = new Date(start);
    cursor.getTime() <= end.getTime();
    cursor.setDate(cursor.getDate() + 1)
  ) {
    dates.push(cursor.toISOString().slice(0, 10));
  }

  return dates;
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
    const body = (await request.json()) as GenerateRangeRequest;
    const locationId = body.locationId?.trim();
    const startDate = body.startDate?.trim();
    const endDate = body.endDate?.trim();

    if (!locationId || !startDate || !endDate) {
      return NextResponse.json(
        {
          error: "Location, start date, and end date are required.",
        },
        {
          status: 400,
        }
      );
    }

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(endDate)
    ) {
      return NextResponse.json(
        {
          error: "Dates must use YYYY-MM-DD format.",
        },
        {
          status: 400,
        }
      );
    }

    const dates = enumerateDates(startDate, endDate);

    if (dates.length === 0 || dates.length > 14) {
      return NextResponse.json(
        {
          error: "Generate a range between 1 and 14 calendar days.",
        },
        {
          status: 400,
        }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse(
        "You do not have access to this location."
      );
    }

    await connectToDatabase();

    const results = [];

    for (const date of dates) {
      const weekday = new Date(`${date}T12:00:00`).getDay();

      if (weekday === 0 || weekday === 6) {
        results.push({
          date,
          skipped: true,
          reason: "Weekend skipped by work-week generation.",
        });
        continue;
      }

      const dayData = await buildDaySchedulerInput(
        locationId,
        date
      );
      const protectedAssignments =
        dayData.input.existingAssignments.filter(
          shouldKeepExistingAssignment
        );
      const reservedBreaks = reserveStaffBreaks({
        staff: dayData.staff,
        clients: dayData.clients,
        existingAssignments: protectedAssignments,
        referenceAssignments: dayData.input.referenceAssignments,
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
      const enrichedAssignments =
        enrichBreakAssignmentsWithFixedEvents(
          result.assignments,
          dayData.clients,
          dayData.extendedRules.slotLengthMinutes
        );

      await ScheduleAssignment.deleteMany({
        locationId,
        date,
        manuallyOverridden: {
          $ne: true,
        },
        source: {
          $in: ["AUTO", "TEMPLATE", "COPIED"],
        },
      });

      const autoAssignments = enrichedAssignments.filter(
        (assignment) => assignment.source === "AUTO"
      );

      if (autoAssignments.length > 0) {
        await ScheduleAssignment.insertMany(
          autoAssignments.map((assignment) => ({
            locationId,
            date,
            startTime: assignment.startTime,
            endTime: getEndTimeForSlot(
              assignment.startTime
            ),
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

      const completeCoverage =
        result.metrics.uncoveredClientSlots === 0;

      results.push({
        date,
        skipped: false,
        completeCoverage,
        partialBuild: !completeCoverage,
        metrics: result.metrics,
        warningCount: result.warnings.length,
        uncoveredCount:
          result.uncoveredRequirements.length,
        reservedBreakCount: reservedBreaks.length,
        autoTemplateName: dayData.autoTemplateName,
        previousReferenceDate:
          dayData.previousReferenceDate,
      });
    }

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: "GENERATE_RANGE",
      entityType: "SCHEDULE_RANGE",
      entityId: `${startDate}:${endDate}`,
      summary: `Generated schedule range ${startDate} through ${endDate}. Partial days were retained for manager completion instead of being discarded.`,
      after: {
        results,
      },
    });

    return NextResponse.json({
      success: true,
      startDate,
      endDate,
      results,
    });
  } catch (error) {
    console.error(
      "Schedule range generation failed:",
      error
    );

    return NextResponse.json(
      {
        error: "The schedule range could not be generated.",
      },
      {
        status: 500,
      }
    );
  }
}
