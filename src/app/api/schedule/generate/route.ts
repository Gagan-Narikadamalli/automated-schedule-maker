import { NextResponse } from "next/server";

import { getEndTimeForSlot } from "@/features/scheduler/engine/dateUtils";
import { generateSchedule } from "@/features/scheduler/engine/generateSchedule";
import { calculateSchedulerReadiness } from "@/features/scheduler/engine/preflight";
import {
  enrichBreakAssignmentsWithFixedEvents,
  reserveStaffBreaks,
} from "@/features/scheduler/engine/reserveBreaks";
import type {
  SchedulerAssignment,
  SchedulerStaff,
} from "@/features/scheduler/engine/types";
import { applyHistoricalTraining } from "@/features/scheduler/server/applyHistoricalTraining";
import { applyLivingstonWorkbookTrial } from "@/features/scheduler/server/applyLivingstonWorkbookTrial";
import { buildDaySchedulerInput } from "@/features/scheduler/server/buildDaySchedulerInput";
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

function buildCoverageByRole(
  assignments: SchedulerAssignment[],
  staff: SchedulerStaff[],
  slotLengthMinutes: number
) {
  const roleByStaffId = new Map(
    staff.map((staffMember) => [staffMember.id, staffMember.role])
  );
  const slotHours = slotLengthMinutes / 60;
  const coverageByRole: Record<string, number> = {};

  for (const assignment of assignments) {
    if (assignment.assignmentType !== "CLIENT_1_TO_1") {
      continue;
    }

    const role = roleByStaffId.get(assignment.staffId) ?? "OTHER";
    coverageByRole[role] =
      (coverageByRole[role] ?? 0) + slotHours;
  }

  return coverageByRole;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GenerateRequest;
    const locationId = body.locationId?.trim();
    const date = body.date?.trim();

    if (!locationId || !date) {
      return NextResponse.json(
        {
          error: "locationId and date are required.",
        },
        {
          status: 400,
        }
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        {
          error: "Date must use YYYY-MM-DD format.",
        },
        {
          status: 400,
        }
      );
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
    const readiness = calculateSchedulerReadiness(
      schedulerInput,
      dayData.extendedRules
    );

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
      rules: dayData.extendedRules,
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

    await connectToDatabase();

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
    const partialBuild = !completeCoverage;
    const coverageByRole = buildCoverageByRole(
      enrichedAssignments,
      schedulerInput.staff,
      dayData.extendedRules.slotLengthMinutes
    );

    await writeAuditLog({
      locationId,
      userId: "scheduler-system",
      action: "GENERATE",
      entityType: "SCHEDULE_DAY",
      entityId: date,
      summary: partialBuild
        ? `Built a partial schedule for ${date}: ${result.metrics.coveredClientSlots}/${result.metrics.requiredClientSlots} client blocks covered.`
        : `Generated a complete schedule for ${date}: ${result.metrics.coveredClientSlots}/${result.metrics.requiredClientSlots} client blocks covered.`,
      after: {
        readiness,
        metrics: result.metrics,
        uncoveredRequirements:
          result.uncoveredRequirements,
        warningCount: result.warnings.length,
        reservedBreakCount: reservedBreaks.length,
        completeCoverage,
        partialBuild,
        coverageByRole,
        autoTemplateName: dayData.autoTemplateName,
        previousReferenceDate:
          dayData.previousReferenceDate,
        workbookTrainingApplied: workbookTraining.applied,
        workbookTrainingReferences:
          workbookTraining.referenceCount,
        workbookTrainingSourceWeek: workbookTraining.applied
          ? {
              start: workbookTraining.sourceWeekStart,
              end: workbookTraining.sourceWeekEnd,
            }
          : null,
        importedTrainingScheduleDays:
          historicalTraining.matchedScheduleDayCount,
        importedTrainingRecords:
          historicalTraining.matchedRecordCount,
      },
    });

    return NextResponse.json({
      success: true,
      date,
      locationId,
      completeCoverage,
      partialBuild,
      message: partialBuild
        ? "The automatic scheduler built every assignment it could safely cover. Remaining client blocks are listed for manager completion."
        : "The automatic scheduler completed all required client coverage.",
      readiness,
      metrics: result.metrics,
      warnings: result.warnings,
      uncoveredRequirements:
        result.uncoveredRequirements,
      reservedBreakCount: reservedBreaks.length,
      coverageByRole,
      autoTemplateName: dayData.autoTemplateName,
      previousReferenceDate:
        dayData.previousReferenceDate,
      workbookTrainingApplied: workbookTraining.applied,
      workbookTrainingReferences:
        workbookTraining.referenceCount,
      workbookTrainingSourceWeek: workbookTraining.applied
        ? {
            start: workbookTraining.sourceWeekStart,
            end: workbookTraining.sourceWeekEnd,
          }
        : null,
      importedTrainingScheduleDays:
        historicalTraining.matchedScheduleDayCount,
      importedTrainingRecords:
        historicalTraining.matchedRecordCount,
    });
  } catch (error) {
    console.error(
      "Schedule generation failed:",
      error
    );

    return NextResponse.json(
      {
        error: "The schedule could not be generated.",
      },
      {
        status: 500,
      }
    );
  }
}
