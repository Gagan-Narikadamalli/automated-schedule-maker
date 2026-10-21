import { Types } from "mongoose";
import { NextResponse } from "next/server";

import { auditFinalCoverage } from "@/features/scheduler/engine/auditFinalCoverage";
import { getEndTimeForSlot } from "@/features/scheduler/engine/dateUtils";
import { planMinimalSafeRepair } from "@/features/scheduler/engine/planMinimalSafeRepair";
import type { SchedulerAssignment } from "@/features/scheduler/engine/types";
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
import { CallOut } from "@/models/CallOut";
import { AttendanceOverride } from "@/models/AttendanceOverride";
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

function isBreakAssignment(
  assignment: SchedulerAssignment
): boolean {
  return (
    assignment.assignmentType === "BREAK" ||
    assignment.assignmentType === "BREAK_NAP" ||
    assignment.assignmentType === "BREAK_SPEECH"
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
    let repairMode: "COVERAGE" | "CALL_OUT" = body.mode === "COVERAGE" ? "COVERAGE" : "CALL_OUT";

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

    // A call-in or client absence may require coverage adjustment without any
    // staff call-out record. Use minimum-change coverage repair in that case.
    const hasClientAttendanceChanges = await AttendanceOverride.exists({
      locationId, date, personType: "client",
    });
    if (repairMode === "CALL_OUT" &&
        (affectedStaffIds.length === 0 || Boolean(hasClientAttendanceChanges))) {
      repairMode = "COVERAGE";
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

    const originalSchedulerInput = historicalTraining.input;
    // The same hard rules and fixed-event/break allocator as Auto Generate
    // are used here, but valid persisted assignments stay in their own cells.
    // A call-out invalidates ALL overlapping cells, including MANUAL/locked
    // breaks; neither calendar may show a called-out therapist covering a child.
    const priorityUnplaced = (await UnplacedAssignment.find({
      locationId, date, status: "UNPLACED", clientId: { $ne: null },
    }).select("_id clientId originalStartTime createdAt").sort({ createdAt: 1 }).lean()) as unknown as
      Array<{ clientId?: unknown; originalStartTime?: unknown; _id?: unknown }>;
    const priorityRequirements = priorityUnplaced
      .map(record => ({
        clientId: record.clientId ? String(record.clientId) : "",
        startTime: String(record.originalStartTime ?? ""),
      }))
      .filter(record => Boolean(record.clientId) && /^\\d{2}:\\d{2}$/.test(record.startTime));

    const safePlan=planMinimalSafeRepair({
      input:originalSchedulerInput,
      rules:{
        ...dayData.extendedRules,
        historicalBreakPriority:originalSchedulerInput.rules.historicalBreakPriority
      },
      disruptions:callOuts,
      priorityRequirements
    });
    if(safePlan.validationErrors.length){
      return NextResponse.json({
        error:"Repair could not satisfy mandatory staff breaks, naps, speech, or hard coverage restrictions. The saved schedule was not changed.",
        violations:safePlan.validationErrors.slice(0,40),
        uncoveredRequirements:safePlan.result.uncoveredRequirements,
        unplacedBreakStaffIds:safePlan.unplacedBreakStaffIds,
        date
      },{status:422});
    }
    const result=safePlan.result;
    const affectedSlots=safePlan.removedOriginals.map(item=>({
      staffId:item.staffId,startTime:item.startTime
    }));
    const removedOriginalIds=safePlan.removedOriginals.map(item=>item.id);
    const newAssignments=safePlan.addedOrUpdated;
    const removalFilter = {
      _id: { $in: removedOriginalIds },
      locationId,
      date,
    };

    const removedSnapshots =
      removedOriginalIds.length > 0
        ? await ScheduleAssignment.find(removalFilter).lean()
        : [];

    const preparedNewAssignments = newAssignments.map((assignment) => ({
      _id: new Types.ObjectId(),
      locationId,
      date,
      startTime: assignment.startTime,
      endTime: getEndTimeForSlot(assignment.startTime),
      staffId: assignment.staffId,
      clientId: assignment.clientId || null,
      assignmentType: assignment.assignmentType,
      source: assignment.source,
      locked: assignment.locked,
      manuallyOverridden: assignment.source === "MANUAL",
      note:
        assignment.note ||
        (repairMode === "COVERAGE"
          ? "Added by automatic minimal fix repair."
          : "Added by targeted call-out schedule repair."),
    }));

    try {
      if (removedOriginalIds.length > 0) {
        await ScheduleAssignment.deleteMany(removalFilter);
      }
      if (preparedNewAssignments.length > 0) {
        await ScheduleAssignment.insertMany(preparedNewAssignments);
      }
    } catch (writeError) {
      // Repair should never leave a selected day with holes simply because a
      // replacement insert failed. Remove any partially inserted repair rows
      // and restore the exact records that were removed.
      try {
        if (preparedNewAssignments.length > 0) {
          await ScheduleAssignment.deleteMany({
            _id: {
              $in: preparedNewAssignments.map(
                (assignment) => assignment._id
              ),
            },
            locationId,
            date,
          });
        }
        if (removedSnapshots.length > 0) {
          await ScheduleAssignment.insertMany(removedSnapshots, {
            ordered: false,
          });
        }
      } catch (rollbackError) {
        console.error(
          "CRITICAL: schedule repair rollback failed:",
          rollbackError
        );
      }
      throw writeError;
    }

    const finalCoverage = auditFinalCoverage(
      originalSchedulerInput.clients,
      result.assignments,
      result.metrics,
      dayData.extendedRules.slotLengthMinutes,
      result.uncoveredRequirements
    );

    const managerGapCount = await syncAutoUnplacedGaps(
      locationId,
      date,
      finalCoverage.uncoveredRequirements,
      result.assignments
    );

    const totalBreakCount = result.assignments.filter(
      isBreakAssignment
    ).length;
    const slotHours =
      dayData.extendedRules.slotLengthMinutes / 60;
    const breakHoursReserved = totalBreakCount * slotHours;
    const finalMetrics = {
      ...finalCoverage.metrics,
      breakHoursReserved,
      netStaffCoverageHours: Math.max(
        finalCoverage.metrics.staffAvailableHours - breakHoursReserved,
        0
      ),
      additionalLaborHoursNeeded: Math.max(
        finalCoverage.metrics.requiredClientHours -
          Math.max(
            finalCoverage.metrics.staffAvailableHours - breakHoursReserved,
            0
          ),
        0
      ),
    };

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
          ? `Applied Minimal Fix on ${date}: retained valid schedule cells, filled safe gaps, and validated all mandatory Break/Nap/Speech events before saving.`
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
        automaticOverrideMode: false,
        reservedBreakCount:safePlan.breakCount,
        breakReliefSwapCount:safePlan.reliefSwapCount,
        unplacedBreakStaffIds:safePlan.unplacedBreakStaffIds,
        breakRecalculated:safePlan.breakRecalculated,
        preservedOriginalCount:safePlan.preservedOriginalCount,
        totalBreakCount,
        metrics: finalMetrics,
        uncoveredRequirements: finalCoverage.uncoveredRequirements,
        warningCount: result.warnings.length,
        fixedNapSessionsApplied: fixedNapApplication.sessionCount,
        fixedNapClientsApplied: fixedNapApplication.clientCount,
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
      automaticOverrideMode:false,
      reservedBreakCount:safePlan.breakCount,
      breakReliefSwapCount:safePlan.reliefSwapCount,
      unplacedBreakStaffIds:safePlan.unplacedBreakStaffIds,
      breakRecalculated:safePlan.breakRecalculated,
      preservedOriginalCount:safePlan.preservedOriginalCount,
      totalBreakCount,
      fixedNapSessionsApplied: fixedNapApplication.sessionCount,
      fixedNapClientsApplied: fixedNapApplication.clientCount,
      metrics: finalMetrics,
      warnings: result.warnings,
      uncoveredRequirements: finalCoverage.uncoveredRequirements,
    });
  } catch (error) {
    console.error("Schedule repair failed:", error);

    return NextResponse.json(
      { error: "The schedule could not be repaired." },
      { status: 500 }
    );
  }
}
