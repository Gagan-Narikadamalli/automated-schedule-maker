import { NextResponse } from "next/server";

import { getEndTimeForSlot } from "@/features/scheduler/engine/dateUtils";
import { generateSchedule } from "@/features/scheduler/engine/generateSchedule";
import { placeStaffBreaksAfterCoverage } from "@/features/scheduler/engine/placeStaffBreaks";
import { enrichBreakAssignmentsWithFixedEvents } from "@/features/scheduler/engine/reserveBreaks";
import type {
  SchedulerAssignment,
  SchedulerResult,
} from "@/features/scheduler/engine/types";
import { applyFixedNapSessions } from "@/features/scheduler/server/applyFixedNapSessions";
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

function isAutomaticBreak(assignment: SchedulerAssignment): boolean {
  return (
    assignment.source === "AUTO" &&
    (assignment.assignmentType === "BREAK" ||
      assignment.assignmentType === "BREAK_NAP" ||
      assignment.assignmentType === "BREAK_SPEECH")
  );
}

function shouldKeepExistingAssignment(
  assignment: SchedulerAssignment
): boolean {
  if (isAutomaticBreak(assignment)) {
    return false;
  }

  return (
    assignment.locked ||
    assignment.source === "MANUAL" ||
    assignment.assignmentType === "SPEECH" ||
    assignment.assignmentType === "UNAVAILABLE"
  );
}

function applyFinalBreakMetrics(
  metrics: SchedulerResult["metrics"],
  reservedBreakCount: number,
  slotLengthMinutes: number
): SchedulerResult["metrics"] {
  const breakHoursReserved =
    reservedBreakCount * (slotLengthMinutes / 60);
  const netStaffCoverageHours = Math.max(
    metrics.staffAvailableHours - breakHoursReserved,
    0
  );
  const additionalLaborHoursNeeded = Math.max(
    metrics.requiredClientHours - netStaffCoverageHours,
    0
  );

  return {
    ...metrics,
    breakHoursReserved,
    netStaffCoverageHours,
    additionalLaborHoursNeeded,
  };
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

function enumerateDates(startDate: string, endDate: string): string[] {
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
        { error: "Location, start date, and end date are required." },
        { status: 400 }
      );
    }

    if (!dateIsValid(startDate) || !dateIsValid(endDate)) {
      return NextResponse.json(
        { error: "Dates must use a real YYYY-MM-DD calendar date." },
        { status: 400 }
      );
    }

    const dates = enumerateDates(startDate, endDate);

    if (dates.length === 0 || dates.length > 14) {
      return NextResponse.json(
        { error: "Generate a range between 1 and 14 calendar days." },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
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

      const dayData = await buildDaySchedulerInput(locationId, date);
      const fixedNapApplication = await applyFixedNapSessions(
        locationId,
        date,
        dayData.input
      );

      const workbookTraining = await applyLivingstonWorkbookTrial(
        locationId,
        fixedNapApplication.input
      );

      const historicalTraining = await applyHistoricalTraining(
        locationId,
        date,
        workbookTraining.input
      );

      const schedulerInput = historicalTraining.input;
      const protectedAssignments = schedulerInput.existingAssignments.filter(
        shouldKeepExistingAssignment
      );

      const coverageResult = generateSchedule({
        ...schedulerInput,
        existingAssignments: protectedAssignments,
      });

      const breakPlan = placeStaffBreaksAfterCoverage({
        staff: schedulerInput.staff,
        clients: schedulerInput.clients,
        assignments: coverageResult.assignments,
        referenceAssignments: schedulerInput.referenceAssignments,
        callOutStaffIds: schedulerInput.callOutStaffIds,
        rules: {
          ...dayData.extendedRules,
          historicalBreakPriority:
            schedulerInput.rules.historicalBreakPriority,
        },
        schedulerRules: schedulerInput.rules,
      });

      const enrichedAssignments = enrichBreakAssignmentsWithFixedEvents(
        breakPlan.assignments,
        schedulerInput.clients,
        dayData.extendedRules.slotLengthMinutes
      );
      const metrics = applyFinalBreakMetrics(
        coverageResult.metrics,
        breakPlan.reservedBreaks.length,
        dayData.extendedRules.slotLengthMinutes
      );

      await ScheduleAssignment.deleteMany({
        locationId,
        date,
        manuallyOverridden: { $ne: true },
        source: { $in: ["AUTO", "TEMPLATE", "COPIED"] },
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

      const managerGapCount = await syncAutoUnplacedGaps(
        locationId,
        date,
        coverageResult.uncoveredRequirements,
        enrichedAssignments
      );

      const completeCoverage = coverageResult.metrics.uncoveredClientSlots === 0;

      results.push({
        date,
        skipped: false,
        completeCoverage,
        partialBuild: !completeCoverage,
        metrics,
        warningCount: coverageResult.warnings.length,
        uncoveredCount: coverageResult.uncoveredRequirements.length,
        managerGapCount,
        reservedBreakCount: breakPlan.reservedBreaks.length,
        reliefSwapCount: breakPlan.reliefSwapCount,
        unplacedBreakStaffIds: breakPlan.unplacedBreakStaffIds,
        fixedNapSessionsApplied: fixedNapApplication.sessionCount,
        fixedNapClientsApplied: fixedNapApplication.clientCount,
        autoTemplateName: dayData.autoTemplateName,
        previousReferenceDate: dayData.previousReferenceDate,
        workbookTrainingApplied: workbookTraining.applied,
        workbookTrainingReferences: workbookTraining.referenceCount,
        importedTrainingScheduleDays:
          historicalTraining.matchedScheduleDayCount,
        importedTrainingRecords: historicalTraining.matchedRecordCount,
      });
    }

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: "GENERATE_RANGE",
      entityType: "SCHEDULE_RANGE",
      entityId: `${startDate}:${endDate}`,
      summary: `Generated schedule range ${startDate} through ${endDate}. Fixed nap and speech events were protected before staff breaks, and partial days kept uncovered blocks in the manager tray.`,
      after: { results },
    });

    return NextResponse.json({
      success: true,
      startDate,
      endDate,
      results,
    });
  } catch (error) {
    console.error("Schedule range generation failed:", error);

    return NextResponse.json(
      { error: "The schedule range could not be generated." },
      { status: 500 }
    );
  }
}
