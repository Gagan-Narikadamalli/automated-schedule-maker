import { NextResponse } from "next/server";

import { getEndTimeForSlot } from "@/features/scheduler/engine/dateUtils";
import { generateSchedule } from "@/features/scheduler/engine/generateSchedule";
import { placeStaffBreaksAfterCoverage } from "@/features/scheduler/engine/placeStaffBreaks";
import { calculateSchedulerReadiness } from "@/features/scheduler/engine/preflight";
import { enrichBreakAssignmentsWithFixedEvents } from "@/features/scheduler/engine/reserveBreaks";
import type {
  SchedulerAssignment,
  SchedulerResult,
  SchedulerStaff,
} from "@/features/scheduler/engine/types";
import { applyFixedNapSessions } from "@/features/scheduler/server/applyFixedNapSessions";
import { applyHistoricalTraining } from "@/features/scheduler/server/applyHistoricalTraining";
import { applyLivingstonWorkbookTrial } from "@/features/scheduler/server/applyLivingstonWorkbookTrial";
import { buildDaySchedulerInput } from "@/features/scheduler/server/buildDaySchedulerInput";
import { persistScheduleReplacementSafely } from "@/features/scheduler/server/persistScheduleReplacementSafely";
import { syncAutoUnplacedGaps } from "@/features/scheduler/server/syncAutoUnplacedGaps";
import { writeAuditLog } from "@/lib/api/audit";
import { connectToDatabase } from "@/lib/db";

type GenerateRequest = {
  locationId?: string;
  date?: string;
};

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
    coverageByRole[role] = (coverageByRole[role] ?? 0) + slotHours;
  }

  return coverageByRole;
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

export async function POST(request: Request) {
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
    const readiness = calculateSchedulerReadiness(
      schedulerInput,
      dayData.extendedRules
    );

    const protectedAssignments = schedulerInput.existingAssignments.filter(
      shouldKeepExistingAssignment
    );

    // Coverage is built first. Fixed nap and speech windows have already been
    // removed from required client coverage, so those events cannot be pushed
    // aside merely to create a staff break.
    const coverageResult = generateSchedule({
      ...schedulerInput,
      existingAssignments: protectedAssignments,
    });

    // Breaks are placed second. The planner first uses free nap/speech windows.
    // If a break still cannot fit, it can move an AUTO client block to the best
    // eligible relief technician and preserve 1:1 coverage while creating the
    // original staff member's break.
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

    await connectToDatabase();

    const autoAssignments = enrichedAssignments.filter(
      (assignment) => assignment.source === "AUTO"
    );
    const generatedRecords = autoAssignments.map((assignment) => ({
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
    }));

    const persistence = await persistScheduleReplacementSafely({
      locationId,
      date,
      replacements: generatedRecords,
      replaceableFilter: {
        manuallyOverridden: { $ne: true },
        source: { $in: ["AUTO", "TEMPLATE", "COPIED"] },
      },
    });

    if (persistence.blockedEmptyReplacement) {
      return NextResponse.json(
        {
          error:
            "Automatic generation produced no replacement blocks, so the existing saved automatic schedule was preserved instead of being cleared.",
          preservedAssignmentCount: persistence.preservedCount,
        },
        { status: 409 }
      );
    }

    const managerGapCount = await syncAutoUnplacedGaps(
      locationId,
      date,
      coverageResult.uncoveredRequirements,
      enrichedAssignments
    );

    const completeCoverage = coverageResult.metrics.uncoveredClientSlots === 0;
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
        ? `Built a partial schedule for ${date}: ${coverageResult.metrics.coveredClientSlots}/${coverageResult.metrics.requiredClientSlots} client blocks covered.`
        : `Generated a complete schedule for ${date}: ${coverageResult.metrics.coveredClientSlots}/${coverageResult.metrics.requiredClientSlots} client blocks covered.`,
      after: {
        readiness,
        metrics,
        uncoveredRequirements: coverageResult.uncoveredRequirements,
        managerGapCount,
        warningCount: coverageResult.warnings.length,
        reservedBreakCount: breakPlan.reservedBreaks.length,
        reliefSwapCount: breakPlan.reliefSwapCount,
        unplacedBreakStaffIds: breakPlan.unplacedBreakStaffIds,
        completeCoverage,
        partialBuild,
        coverageByRole,
        fixedNapSessionsApplied: fixedNapApplication.sessionCount,
        fixedNapClientsApplied: fixedNapApplication.clientCount,
        autoTemplateName: dayData.autoTemplateName,
        previousReferenceDate: dayData.previousReferenceDate,
        workbookTrainingApplied: workbookTraining.applied,
        workbookTrainingReferences: workbookTraining.referenceCount,
        workbookTrainingSourceWeek: workbookTraining.applied
          ? {
              start: workbookTraining.sourceWeekStart,
              end: workbookTraining.sourceWeekEnd,
            }
          : null,
        importedTrainingScheduleDays:
          historicalTraining.matchedScheduleDayCount,
        importedTrainingRecords: historicalTraining.matchedRecordCount,
      },
    });

    return NextResponse.json({
      success: true,
      date,
      locationId,
      completeCoverage,
      partialBuild,
      message: partialBuild
        ? "The automatic scheduler built every assignment it could safely cover. Nap and speech events were protected first, then staff breaks were placed. Remaining client blocks were added to the manager Unplaced Assignments tray."
        : "The automatic scheduler completed all required client coverage, protected nap and speech events first, and then placed staff breaks.",
      readiness,
      metrics,
      warnings: coverageResult.warnings,
      uncoveredRequirements: coverageResult.uncoveredRequirements,
      managerGapCount,
      reservedBreakCount: breakPlan.reservedBreaks.length,
      reliefSwapCount: breakPlan.reliefSwapCount,
      unplacedBreakStaffIds: breakPlan.unplacedBreakStaffIds,
      fixedNapSessionsApplied: fixedNapApplication.sessionCount,
      fixedNapClientsApplied: fixedNapApplication.clientCount,
      coverageByRole,
      autoTemplateName: dayData.autoTemplateName,
      previousReferenceDate: dayData.previousReferenceDate,
      workbookTrainingApplied: workbookTraining.applied,
      workbookTrainingReferences: workbookTraining.referenceCount,
      workbookTrainingSourceWeek: workbookTraining.applied
        ? {
            start: workbookTraining.sourceWeekStart,
            end: workbookTraining.sourceWeekEnd,
          }
        : null,
      importedTrainingScheduleDays:
        historicalTraining.matchedScheduleDayCount,
      importedTrainingRecords: historicalTraining.matchedRecordCount,
    });
  } catch (error) {
    console.error("Schedule generation failed:", error);

    return NextResponse.json(
      { error: "The schedule could not be generated." },
      { status: 500 }
    );
  }
}
