import { NextResponse } from "next/server";

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

type PreviewRequest = {
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
): Record<string, number> {
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
    const body = (await request.json()) as PreviewRequest;
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

    const proposedAssignments =
      enrichBreakAssignmentsWithFixedEvents(
        result.assignments,
        schedulerInput.clients,
        dayData.extendedRules.slotLengthMinutes
      );

    const completeCoverage =
      result.metrics.uncoveredClientSlots === 0;
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
      metrics: result.metrics,
      warnings: result.warnings,
      uncoveredRequirements: result.uncoveredRequirements,
      reservedBreakCount: reservedBreaks.length,
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
    console.error("Schedule preview failed:", error);

    return NextResponse.json(
      {
        error: "The automatic schedule preview could not be calculated.",
      },
      {
        status: 500,
      }
    );
  }
}
