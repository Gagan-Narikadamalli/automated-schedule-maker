import { NextResponse } from "next/server";

import { auditFinalCoverage } from "@/features/scheduler/engine/auditFinalCoverage";
import { generateSchedule } from "@/features/scheduler/engine/generateSchedule";
import { placeStaffBreaksAfterCoverage } from "@/features/scheduler/engine/placeStaffBreaks";
import { calculateSchedulerReadiness } from "@/features/scheduler/engine/preflight";
import { enrichBreakAssignmentsWithFixedEvents } from "@/features/scheduler/engine/reserveBreaks";
import type {
  SchedulerAssignment,
  SchedulerStaff,
} from "@/features/scheduler/engine/types";
import { applyFixedNapSessions } from "@/features/scheduler/server/applyFixedNapSessions";
import { applyHistoricalTraining } from "@/features/scheduler/server/applyHistoricalTraining";
import { applyLivingstonWorkbookTrial } from "@/features/scheduler/server/applyLivingstonWorkbookTrial";
import { buildDaySchedulerInput } from "@/features/scheduler/server/buildDaySchedulerInput";

type PreviewRequest = {
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

function shouldKeepExistingAssignment(assignment: SchedulerAssignment): boolean {
  if (isAutomaticBreak(assignment)) return false;
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
): Record<string, number> {
  const roleByStaffId = new Map(staff.map((staffMember) => [staffMember.id, staffMember.role]));
  const slotHours = slotLengthMinutes / 60;
  const coverageByRole: Record<string, number> = {};

  for (const assignment of assignments) {
    if (assignment.assignmentType !== "CLIENT_1_TO_1") continue;
    const role = roleByStaffId.get(assignment.staffId) ?? "OTHER";
    coverageByRole[role] = (coverageByRole[role] ?? 0) + slotHours;
  }

  return coverageByRole;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PreviewRequest;
    const locationId = body.locationId?.trim();
    const date = body.date?.trim();

    if (!locationId || !date) {
      return NextResponse.json({ error: "locationId and date are required." }, { status: 400 });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Date must use YYYY-MM-DD format." }, { status: 400 });
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
        historicalBreakPriority: schedulerInput.rules.historicalBreakPriority,
      },
      schedulerRules: schedulerInput.rules,
    });

    const proposedAssignments = enrichBreakAssignmentsWithFixedEvents(
      breakPlan.assignments,
      schedulerInput.clients,
      dayData.extendedRules.slotLengthMinutes
    );
    const finalCoverage = auditFinalCoverage(
      schedulerInput.clients,
      proposedAssignments,
      coverageResult.metrics,
      dayData.extendedRules.slotLengthMinutes,
      coverageResult.uncoveredRequirements
    );
    const completeCoverage =
      finalCoverage.metrics.uncoveredClientSlots === 0;
    const coverageByRole = buildCoverageByRole(
      proposedAssignments,
      schedulerInput.staff,
      dayData.extendedRules.slotLengthMinutes
    );

    return NextResponse.json({
      success: true,
      previewOnly: true,
      date,
      locationId,
      completeCoverage,
      partialBuild: !completeCoverage,
      readiness,
      metrics: finalCoverage.metrics,
      warnings: coverageResult.warnings,
      uncoveredRequirements: finalCoverage.uncoveredRequirements,
      reservedBreakCount: breakPlan.reservedBreaks.length,
      reliefSwapCount: breakPlan.reliefSwapCount,
      unplacedBreakStaffIds: breakPlan.unplacedBreakStaffIds,
      fixedNapSessionsApplied: fixedNapApplication.sessionCount,
      clientAttendanceChangesApplied: fixedNapApplication.attendanceChangeCount,
      coverageByRole,
      proposedAssignments: proposedAssignments.map((assignment) => ({
        staffId: assignment.staffId,
        clientId: assignment.clientId ?? null,
        startTime: assignment.startTime,
        assignmentType: assignment.assignmentType,
        source: assignment.source,
        locked: assignment.locked,
        note: assignment.note ?? "",
      })),
      autoTemplateName: dayData.autoTemplateName,
      previousReferenceDate: dayData.previousReferenceDate,
      historicalReferenceDates: dayData.historicalReferenceDates,
      workbookTrainingApplied: workbookTraining.applied,
      workbookTrainingReferences: workbookTraining.referenceCount,
      workbookTrainingSourceWeek: workbookTraining.applied
        ? { start: workbookTraining.sourceWeekStart, end: workbookTraining.sourceWeekEnd }
        : null,
      importedTrainingScheduleDays: historicalTraining.matchedScheduleDayCount,
      importedTrainingRecords: historicalTraining.matchedRecordCount,
    });
  } catch (error) {
    console.error("Schedule preview failed:", error);
    return NextResponse.json(
      { error: "The automatic schedule preview could not be calculated." },
      { status: 500 }
    );
  }
}
