import { NextResponse } from "next/server";

import { getEndTimeForSlot } from "@/features/scheduler/engine/dateUtils";
import { repairCoverageMinimally } from "@/features/scheduler/engine/generateSchedule";
import { placeStaffBreaksAfterCoverage } from "@/features/scheduler/engine/placeStaffBreaks";
import { enrichBreakAssignmentsWithFixedEvents } from "@/features/scheduler/engine/reserveBreaks";
import {
  repairSchedule,
  type RepairAffectedSlot,
} from "@/features/scheduler/engine/repairSchedule";
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
import { CallOut } from "@/models/CallOut";
import { ScheduleAssignment } from "@/models/ScheduleAssignment";
import { UnplacedAssignment } from "@/models/UnplacedAssignment";

type RepairRequest = {
  locationId?: string;
  date?: string;
  mode?: "CALL_OUT" | "COVERAGE";
};

type CallOutRecord = {
  staffId: string;
  startTime: string;
  endTime: string;
};

function assignmentOverlapsCallOut(
  assignment: SchedulerAssignment,
  callOuts: CallOutRecord[]
): boolean {
  return callOuts.some(
    (callOut) =>
      callOut.staffId === assignment.staffId &&
      assignment.startTime >= callOut.startTime &&
      assignment.startTime < callOut.endTime
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
    const body = (await request.json()) as RepairRequest;
    const locationId = body.locationId?.trim();
    const date = body.date?.trim();
    const repairMode = body.mode === "COVERAGE" ? "COVERAGE" : "CALL_OUT";

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

    const rawCallOuts = await CallOut.find({ locationId, date })
      .select("staffId startTime endTime")
      .lean();

    const callOuts: CallOutRecord[] = rawCallOuts.map((callOut) => ({
      staffId: String(callOut.staffId),
      startTime: String(callOut.startTime),
      endTime: String(callOut.endTime),
    }));

    const affectedStaffIds = Array.from(
      new Set(callOuts.map((callOut) => callOut.staffId))
    );

    if (repairMode === "CALL_OUT" && affectedStaffIds.length === 0) {
      return NextResponse.json(
        {
          error:
            "There are no recorded call-outs for this date. Add the call-out first, then run Repair Schedule.",
        },
        { status: 400 }
      );
    }

    const dayData = await buildDaySchedulerInput(locationId, date);

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
    const affectedSlots: RepairAffectedSlot[] =
      repairMode === "CALL_OUT"
        ? schedulerInput.existingAssignments
            .filter((assignment) =>
              assignmentOverlapsCallOut(assignment, callOuts)
            )
            .map((assignment) => ({
              staffId: assignment.staffId,
              startTime: assignment.startTime,
            }))
        : [];

    const priorityUnplaced =
      repairMode === "COVERAGE"
        ? ((await UnplacedAssignment.find({
            locationId,
            date,
            status: "UNPLACED",
            clientId: { $ne: null },
          })
            .select("_id clientId originalStartTime createdAt")
            .sort({ createdAt: 1 })
            .lean()) as unknown as Array<{
            clientId?: unknown;
            originalStartTime?: unknown;
            _id?: unknown;
          }>)
        : [];

    const priorityRequirements = priorityUnplaced
      .map((record) => ({
        clientId: record.clientId ? String(record.clientId) : "",
        startTime: String(record.originalStartTime ?? ""),
      }))
      .filter(
        (record) =>
          Boolean(record.clientId) &&
          /^\d{2}:\d{2}$/.test(record.startTime)
      );

    const coverageResult =
      repairMode === "COVERAGE"
        ? repairCoverageMinimally(
            schedulerInput,
            priorityRequirements,
            { allowAutomaticOverrides: true }
          )
        : repairSchedule(
            schedulerInput,
            affectedStaffIds,
            affectedSlots
          );

    const breakPlan =
      repairMode === "COVERAGE"
        ? placeStaffBreaksAfterCoverage({
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
            allowProtectedRelief: true,
          })
        : null;

    const result =
      repairMode === "COVERAGE" && breakPlan
        ? {
            ...coverageResult,
            assignments: enrichBreakAssignmentsWithFixedEvents(
              breakPlan.assignments,
              schedulerInput.clients,
              dayData.extendedRules.slotLengthMinutes
            ),
          }
        : coverageResult;

    const originalAssignmentIds = new Set(
      schedulerInput.existingAssignments.map(
        (assignment) => assignment.id
      )
    );
    const resultAssignmentIds = new Set(
      result.assignments.map((assignment) => assignment.id)
    );

    const removedOriginalIds =
      schedulerInput.existingAssignments
        .filter(
          (assignment) => !resultAssignmentIds.has(assignment.id)
        )
        .map((assignment) => assignment.id);

    const newAssignments = result.assignments.filter(
      (assignment) => !originalAssignmentIds.has(assignment.id)
    );

    if (removedOriginalIds.length > 0) {
      await ScheduleAssignment.deleteMany({
        _id: {
          $in: removedOriginalIds,
        },
        locationId,
        date,
        ...(repairMode === "CALL_OUT"
          ? {
              manuallyOverridden: {
                $ne: true,
              },
            }
          : {}),
      });
    }

    if (newAssignments.length > 0) {
      await ScheduleAssignment.insertMany(
        newAssignments.map((assignment) => ({
          locationId,
          date,
          startTime: assignment.startTime,
          endTime: getEndTimeForSlot(assignment.startTime),
          staffId: assignment.staffId,
          clientId: assignment.clientId || null,
          assignmentType: assignment.assignmentType,
          source: "AUTO",
          locked: false,
          manuallyOverridden: false,
          note:
            assignment.note ||
            (repairMode === "COVERAGE"
              ? "Added by automatic minimal fix repair."
              : "Added by targeted call-out schedule repair."),
        }))
      );
    }

    const managerGapCount = await syncAutoUnplacedGaps(
      locationId,
      date,
      result.uncoveredRequirements,
      result.assignments
    );

    const priorityUnplacedIds = priorityUnplaced
      .map((record) => record._id)
      .filter(Boolean);
    const unresolvedPriorityCount =
      repairMode === "COVERAGE" && priorityUnplacedIds.length > 0
        ? await UnplacedAssignment.countDocuments({
            _id: { $in: priorityUnplacedIds },
            locationId,
            date,
            status: "UNPLACED",
          })
        : 0;
    const unplacedRemainingCount =
      repairMode === "COVERAGE"
        ? await UnplacedAssignment.countDocuments({
            locationId,
            date,
            status: "UNPLACED",
          })
        : 0;
    const resolvedUnplacedCount =
      repairMode === "COVERAGE"
        ? Math.max(priorityUnplacedIds.length - unresolvedPriorityCount, 0)
        : 0;

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: "REPAIR",
      entityType: "SCHEDULE_DAY",
      entityId: date,
      summary:
        repairMode === "COVERAGE"
          ? `Applied automatic Minimal Fix on ${date}: Unplaced/client coverage first, minimum necessary schedule overrides, then break repair.`
          : `Repaired only the schedule cells affected by ${affectedStaffIds.length} staff call-out(s) on ${date}.`,
      after: {
        repairMode,
        priorityUnplacedCount: priorityRequirements.length,
        resolvedUnplacedCount,
        unplacedRemainingCount,
        affectedStaffIds,
        affectedSlots,
        removedAssignmentCount: removedOriginalIds.length,
        addedAssignmentCount: newAssignments.length,
        managerGapCount,
        automaticOverrideMode: repairMode === "COVERAGE",
        reservedBreakCount: breakPlan?.reservedBreaks.length ?? 0,
        breakReliefSwapCount: breakPlan?.reliefSwapCount ?? 0,
        unplacedBreakStaffIds: breakPlan?.unplacedBreakStaffIds ?? [],
        metrics: result.metrics,
        uncoveredRequirements: result.uncoveredRequirements,
        warningCount: result.warnings.length,
        workbookTrainingApplied: workbookTraining.applied,
        importedTrainingScheduleDays:
          historicalTraining.matchedScheduleDayCount,
      },
    });

    return NextResponse.json({
      success: true,
      date,
      locationId,
      repairMode,
      priorityUnplacedCount: priorityRequirements.length,
      resolvedUnplacedCount,
      unplacedRemainingCount,
      affectedStaffIds,
      affectedSlots,
      removedAssignmentCount: removedOriginalIds.length,
      addedAssignmentCount: newAssignments.length,
      managerGapCount,
      automaticOverrideMode: repairMode === "COVERAGE",
      reservedBreakCount: breakPlan?.reservedBreaks.length ?? 0,
      breakReliefSwapCount: breakPlan?.reliefSwapCount ?? 0,
      unplacedBreakStaffIds: breakPlan?.unplacedBreakStaffIds ?? [],
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
