import { NextResponse } from "next/server";

import { getEndTimeForSlot } from "@/features/scheduler/engine/dateUtils";
import { generateSchedule } from "@/features/scheduler/engine/generateSchedule";
import {
  enrichBreakAssignmentsWithFixedEvents,
  reserveStaffBreaks,
} from "@/features/scheduler/engine/reserveBreaks";
import type { SchedulerAssignment } from "@/features/scheduler/engine/types";
import { applyHistoricalTraining } from "@/features/scheduler/server/applyHistoricalTraining";
import { applyLivingstonWorkbookTrial } from "@/features/scheduler/server/applyLivingstonWorkbookTrial";
import { buildDaySchedulerInput } from "@/features/scheduler/server/buildDaySchedulerInput";
import { syncAutoUnplacedGaps } from "@/features/scheduler/server/syncAutoUnplacedGaps";
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

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

function dateIsValid(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }

  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function enumerateDates(
  startDate: string,
  endDate: string
): string[] {
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  const dates: string[] = [];

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start.getTime() > end.getTime()
  ) {
    return dates;
  }

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

    if (!dateIsValid(startDate) || !dateIsValid(endDate)) {
      return NextResponse.json(
        {
          error: "Dates must use a real YYYY-MM-DD calendar date.",
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

      const workbookTraining = await applyLivingstonWorkbookTrial(
        locationId,
        dayData.input
      );

      const historicalTraining = await applyHistoricalTraining(
        locationId,
        date,
        workbookTraining.input
      );

      const schedulerInput = historicalTraining.input;
      const protectedAssignments =
        schedulerInput.existingAssignments.filter(
          shouldKeepExistingAssignment
        );

      const reservedBreaks = reserveStaffBreaks({
        staff: schedulerInput.staff,
        clients: schedulerInput.clients,
        existingAssignments: protectedAssignments,
        referenceAssignments: schedulerInput.referenceAssignments,
        callOutStaffIds: schedulerInput.callOutStaffIds,
        rules: {
          ...dayData.extendedRules,
          historicalBreakPriority:
            schedulerInput.rules.historicalBreakPriority,
        },
      });

      const result = generateSchedule({
        ...schedulerInput,
        existingAssignments: [
          ...protectedAssignments,
          ...reservedBreaks,
        ],
      });

      const enrichedAssignments =
        enrichBreakAssignmentsWithFixedEvents(
          result.assignments,
          schedulerInput.clients,
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

      const managerGapCount = await syncAutoUnplacedGaps(
        locationId,
        date,
        result.uncoveredRequirements
      );

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
        managerGapCount,
        reservedBreakCount: reservedBreaks.length,
        autoTemplateName: dayData.autoTemplateName,
        previousReferenceDate:
          dayData.previousReferenceDate,
        workbookTrainingApplied: workbookTraining.applied,
        workbookTrainingReferences:
          workbookTraining.referenceCount,
        importedTrainingScheduleDays:
          historicalTraining.matchedScheduleDayCount,
        importedTrainingRecords:
          historicalTraining.matchedRecordCount,
      });
    }

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: "GENERATE_RANGE",
      entityType: "SCHEDULE_RANGE",
      entityId: `${startDate}:${endDate}`,
      summary: `Generated schedule range ${startDate} through ${endDate}. Partial days were retained and uncovered blocks were added to the manager tray.`,
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
