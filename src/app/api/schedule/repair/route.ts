import { Types } from "mongoose";
import { NextResponse } from "next/server";

import { auditFinalCoverage } from "@/features/scheduler/engine/auditFinalCoverage";
import { getEndTimeForSlot } from "@/features/scheduler/engine/dateUtils";
import { repairCoverageMinimally } from "@/features/scheduler/engine/generateSchedule";
import { placeStaffBreaksAfterCoverage } from "@/features/scheduler/engine/placeStaffBreaks";
import { enrichBreakAssignmentsWithFixedEvents } from "@/features/scheduler/engine/reserveBreaks";
import {
  repairSchedule,
  type RepairAffectedSlot,
} from "@/features/scheduler/engine/repairSchedule";
import type {
  SchedulerAssignment,
  SchedulerStaff,
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

function timeMinutes(time: string): number {
  const [hourText, minuteText] = time.split(":");
  return Number(hourText) * 60 + Number(minuteText);
}

function normalizeBreakAssignmentsForMinimalFix(
  assignments: SchedulerAssignment[],
  staff: SchedulerStaff[],
  rules: {
    breakWindowStart: string;
    breakWindowEnd: string;
    breakEligibilityHours: number;
    slotLengthMinutes: number;
  }
): SchedulerAssignment[] {
  const nonBreaks = assignments.filter(
    (assignment) => !isBreakAssignment(assignment)
  );
  const breaksByStaff = new Map<string, SchedulerAssignment[]>();

  for (const assignment of assignments.filter(isBreakAssignment)) {
    const current = breaksByStaff.get(assignment.staffId) ?? [];
    current.push(assignment);
    breaksByStaff.set(assignment.staffId, current);
  }

  const normalizedBreaks: SchedulerAssignment[] = [];

  for (const staffMember of staff) {
    const availableHours =
      (staffMember.availableSlots.length * rules.slotLengthMinutes) / 60;

    if (availableHours < rules.breakEligibilityHours) {
      continue;
    }

    const candidates = (breaksByStaff.get(staffMember.id) ?? [])
      .filter((assignment) => {
        const normalWindow =
          assignment.startTime >= rules.breakWindowStart &&
          assignment.startTime < rules.breakWindowEnd;
        const napExtension =
          assignment.assignmentType === "BREAK_NAP" &&
          assignment.startTime >= rules.breakWindowStart &&
          assignment.startTime < "14:00";

        return normalWindow || napExtension;
      })
      .sort((left, right) => {
        const leftManual =
          left.source === "MANUAL" || left.locked ? 0 : 1;
        const rightManual =
          right.source === "MANUAL" || right.locked ? 0 : 1;

        if (leftManual !== rightManual) {
          return leftManual - rightManual;
        }

        const leftEvent =
          left.assignmentType === "BREAK_NAP"
            ? 0
            : left.assignmentType === "BREAK_SPEECH"
              ? 1
              : 2;
        const rightEvent =
          right.assignmentType === "BREAK_NAP"
            ? 0
            : right.assignmentType === "BREAK_SPEECH"
              ? 1
              : 2;

        if (leftEvent !== rightEvent) {
          return leftEvent - rightEvent;
        }

        const leftDistance = Math.abs(timeMinutes(left.startTime) - 12 * 60);
        const rightDistance = Math.abs(timeMinutes(right.startTime) - 12 * 60);

        if (leftDistance !== rightDistance) {
          return leftDistance - rightDistance;
        }

        return left.startTime.localeCompare(right.startTime);
      });

    if (candidates[0]) {
      normalizedBreaks.push(candidates[0]);
    }
  }

  return [...nonBreaks, ...normalizedBreaks];
}

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
    const schedulerInput =
      repairMode === "COVERAGE"
        ? {
            ...originalSchedulerInput,
            existingAssignments:
              normalizeBreakAssignmentsForMinimalFix(
                originalSchedulerInput.existingAssignments,
                originalSchedulerInput.staff,
                dayData.extendedRules
              ),
          }
        : originalSchedulerInput;
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
            {
              allowAutomaticOverrides: true,
              allowProtectedRelocation:
                schedulerInput.rules.minimalFixAllowProtectedRelocation,
              allowBreakRelocation:
                schedulerInput.rules.minimalFixAllowBreakRelocation,
            }
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
            allowProtectedRelief:
              schedulerInput.rules.minimalFixAllowProtectedRelocation &&
              schedulerInput.rules.minimalFixAllowBreakRelocation,
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
      originalSchedulerInput.existingAssignments.map(
        (assignment) => assignment.id
      )
    );
    const resultAssignmentIds = new Set(
      result.assignments.map((assignment) => assignment.id)
    );

    const removedOriginalIds =
      originalSchedulerInput.existingAssignments
        .filter(
          (assignment) => !resultAssignmentIds.has(assignment.id)
        )
        .map((assignment) => assignment.id);

    const newAssignments = result.assignments.filter(
      (assignment) => !originalAssignmentIds.has(assignment.id)
    );

    const removalFilter = {
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
      source: "AUTO",
      locked: false,
      manuallyOverridden: false,
      note:
        assignment.note ||
        (repairMode === "COVERAGE"
          ? "Added by automatic minimal fix repair."
          : "Added by targeted call-out schedule repair."),
    }));

    if (removedOriginalIds.length > 0) {
      await ScheduleAssignment.deleteMany(removalFilter);
    }

    try {
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
      schedulerInput.clients,
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
      automaticOverrideMode: repairMode === "COVERAGE",
      reservedBreakCount: breakPlan?.reservedBreaks.length ?? 0,
      breakReliefSwapCount: breakPlan?.reliefSwapCount ?? 0,
      unplacedBreakStaffIds: breakPlan?.unplacedBreakStaffIds ?? [],
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
