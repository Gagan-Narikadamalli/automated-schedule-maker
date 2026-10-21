import { NextResponse } from "next/server";
import {
  forbiddenResponse,
  requireApiSession,
  sessionCanAccessLocation,
  sessionHasAnyRole,
  SCHEDULE_WRITE_ROLES,
} from "@/lib/api/auth";


import { auditFinalCoverage } from "@/features/scheduler/engine/auditFinalCoverage";
import { auditLinkedNapBreakRules } from "@/features/scheduler/engine/auditLinkedNapBreakRules";
import { explainUnmetEventRules } from "@/features/scheduler/engine/explainUnmetEventRules";
import { classifyEventAuditForPartialSave, auditPartialAssignmentSafety } from "@/features/scheduler/engine/classifyEventAuditForPartialSave";
import { refillCoverageAfterBreakAlignment } from "@/features/scheduler/engine/refillCoverageAfterBreakAlignment";
import { getEndTimeForSlot } from "@/features/scheduler/engine/dateUtils";
import { generateSchedule } from "@/features/scheduler/engine/generateSchedule";
import { placeStaffBreaksAfterCoverage } from "@/features/scheduler/engine/placeStaffBreaks";
import { enrichBreakAssignmentsWithFixedEvents } from "@/features/scheduler/engine/reserveBreaks";
import { calculateSchedulerReadiness } from "@/features/scheduler/engine/preflight";
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
import { pinWorkbookTemplates } from "@/features/scheduler/engine/pinWorkbookTemplates";

type GenerateRequest = {
  locationId?: string;
  date?: string;
};

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
  const auth = await requireApiSession();
  if (auth.error) return auth.error;
  if (!sessionHasAnyRole(auth.session, SCHEDULE_WRITE_ROLES)) return forbiddenResponse();
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

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    const dayData = await buildDaySchedulerInput(locationId, date);
    // Day and week generation must honor the same saved nap and speech events.
    const fixedNapApplication = await applyFixedNapSessions(
      locationId, date, dayData.input
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

    // Fresh generation starts from workbook pins, not previously generated/manual cells.
    // Repair mode is a separate action and retains the saved schedule.
    const templatePinning = pinWorkbookTemplates(schedulerInput);
    const protectedAssignments = templatePinning.pinned;


    // Coverage is built first. Fixed nap and speech windows have already been
    // removed from required client coverage, so those events cannot be pushed
    // aside merely to create a staff break.
    // A fresh Auto Generate must not treat its own previously saved AUTO
    // assignments as historical preferences. Otherwise running it twice
    // reinforces the old arrangement instead of rebuilding from the selected
    // weekday template and the current attendance/availability.
    // Auto Generate must NEVER learn from the schedule already saved for the
    // target date. Workbook references are independent of existing day cells.
    const existingDayIds = new Set(schedulerInput.existingAssignments.map(item => item.id));
    const freshReferences = schedulerInput.referenceAssignments.filter(reference =>
      !existingDayIds.has(reference.id) && reference.source !== "AUTO"
    );
    const coverageResult = generateSchedule({
      ...schedulerInput,
      referenceAssignments: freshReferences,
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
      referenceAssignments: freshReferences,
      callOutStaffIds: schedulerInput.callOutStaffIds,
      rules: {
        ...dayData.extendedRules,
        historicalBreakPriority:
          schedulerInput.rules.historicalBreakPriority,
      },
      schedulerRules: schedulerInput.rules,
    });

    const enrichedAssignments = breakPlan.assignments.map(assignment => {
      // Workbook BREAK, BREAK_NAP and BREAK_SPEECH must remain exactly as saved.
      const pinned = templatePinning.pinned.find(item =>
        item.staffId === assignment.staffId && item.startTime === assignment.startTime
      );
      // Workbook break/nap cells are historical preferences, not authority
      // to override a date-specific saved event or a new valid assignment.
      // A stale pinned BREAK_NAP previously removed real client coverage and
      // caused the "missing Break/Nap" warnings reported by managers.
      if(!pinned)return assignment;
      if(pinned.assignmentType==="BREAK_NAP" &&
        !schedulerInput.clients.some(client=>
          client.id===pinned.clientId&&client.napSlots.includes(assignment.startTime)))
        return assignment;
      if(pinned.assignmentType==="BREAK_SPEECH" &&
        !schedulerInput.clients.some(client=>
          client.id===pinned.clientId&&client.speechSlots.includes(assignment.startTime)))
        return assignment;
      if(pinned.assignmentType.startsWith("BREAK") &&
         !assignment.assignmentType.startsWith("BREAK"))
        return assignment;
      return {...assignment,assignmentType:pinned.assignmentType,clientId:pinned.clientId};
    });
    const eventEnrichedAssignments = enrichBreakAssignmentsWithFixedEvents(
      enrichedAssignments,
      schedulerInput.clients,
      dayData.extendedRules.slotLengthMinutes
    );
    // A moved staff break (e.g. 13:30 -> linked 13:00 client nap)
    // makes its former time available. Give newly free time to uncovered
    // 1:1 clients without moving or replacing ANY existing valid assignment.
    const finalPass=refillCoverageAfterBreakAlignment(
      {...schedulerInput,referenceAssignments:freshReferences},
      eventEnrichedAssignments
    );
    const finalAssignments=finalPass.assignments;
    const linkedEventProblems = auditLinkedNapBreakRules(finalAssignments,schedulerInput.clients,
      schedulerInput.staff.filter(s=>!schedulerInput.callOutStaffIds.includes(s.id)),
      dayData.extendedRules.breakWindowStart,dayData.extendedRules.breakWindowEnd);
    // Unplaced client naps / staff breaks are NOT the same as an unsafe
    // assignment. Save valid coverage; put the unmet separate obligations in
    // Unplaced. Do not save actual double-booking or availability violations.
    const eventStatus=classifyEventAuditForPartialSave({
      issues:linkedEventProblems,clients:schedulerInput.clients,
      staff:schedulerInput.staff,assignments:finalAssignments,
      breakWindowStart:dayData.extendedRules.breakWindowStart,
      breakWindowEnd:dayData.extendedRules.breakWindowEnd
    });
    const dangerous=[...eventStatus.conflicts,
      ...auditPartialAssignmentSafety({
        assignments:finalAssignments,clients:schedulerInput.clients,
        staff:schedulerInput.staff,calledOutStaffIds:schedulerInput.callOutStaffIds
      })];
    if(dangerous.length) {
      return NextResponse.json({
        error:"Generated assignments contain conflicts, not just missing requirements. Existing saved assignments were preserved.",
        violations:[...new Set(dangerous)],date
      },{status:422});
    }
    const unresolvedEventDiagnostics=explainUnmetEventRules({
      problems:eventStatus.unresolvedWarnings,
      clients:schedulerInput.clients,staff:schedulerInput.staff,
      assignments:finalAssignments,
      calledOutStaffIds:schedulerInput.callOutStaffIds
    }).map(problem=>{
      let label=problem;
      for(const client of schedulerInput.clients)label=label.replaceAll(client.id,client.displayCode);
      for(const member of schedulerInput.staff)label=label.replaceAll(member.id,member.name);
      return label;
    });
    const finalCoverage = auditFinalCoverage(
      schedulerInput.clients,
      finalAssignments,
      coverageResult.metrics,
      dayData.extendedRules.slotLengthMinutes,
      coverageResult.uncoveredRequirements
    );
    const metrics = applyFinalBreakMetrics(
      finalCoverage.metrics,
      breakPlan.reservedBreaks.length,
      dayData.extendedRules.slotLengthMinutes
    );
    const finalOnlyWarnings = finalCoverage.uncoveredRequirements.map(requirement=>({
      code:"NO_ELIGIBLE_STAFF" as const,
      message:`${requirement.clientCode} remains uncovered at ${requirement.startTime} after final break alignment and available-slot refill.`
    }));
    const warnings = [
      ...coverageResult.warnings.filter(warning=>warning.code!=="NO_ELIGIBLE_STAFF"),
      ...finalOnlyWarnings,
      ...unresolvedEventDiagnostics.map(message=>({
        code:"NO_ELIGIBLE_STAFF" as const,message
      }))
    ];

    await connectToDatabase();

    const autoAssignments = finalAssignments;
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
      replaceableFilter: {},
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
      finalCoverage.uncoveredRequirements,
      finalAssignments,
      eventStatus.unplacedEvents
    );

    const unresolvedEventCount=eventStatus.unplacedEvents.length;
    const completeCoverage = metrics.uncoveredClientSlots === 0 && unresolvedEventCount===0;
    const partialBuild = !completeCoverage;
    const coverageByRole = buildCoverageByRole(
      finalAssignments,
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
        ? `Built a partial schedule for ${date}: ${metrics.coveredClientSlots}/${metrics.requiredClientSlots} client blocks covered.`
        : `Generated a complete schedule for ${date}: ${metrics.coveredClientSlots}/${metrics.requiredClientSlots} client blocks covered.`,
      after: {
        readiness,
        metrics,
        uncoveredRequirements: finalCoverage.uncoveredRequirements,
        managerGapCount,
        unresolvedEventCount,
        recoveredCoverageAfterBreakMove:finalPass.addedCount,
        unresolvedEventDiagnostics,
        warningCount: warnings.length,
        reservedBreakCount: breakPlan.reservedBreaks.length,
        reliefSwapCount: breakPlan.reliefSwapCount,
        humanStyleBlockSwapCount: breakPlan.humanStyleBlockSwapCount,
        humanStylePenaltyBefore: breakPlan.humanStylePenaltyBefore,
        humanStylePenaltyAfter: breakPlan.humanStylePenaltyAfter,
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
      regenerationSummary: {
        changed: persistence.changedCount,
        unchanged: persistence.unchangedCount,
        added: persistence.addedCount,
        removed: persistence.removedStaleCount,
        protected: protectedAssignments.length,
      },
      date,
      locationId,
      completeCoverage,
      partialBuild,
      message: partialBuild
        ? "Saved the best safe partial schedule. Uncovered client blocks and unscheduled client naps, speech sessions, or staff breaks appear separately in Unplaced Assignments with reasons. They are NOT marked completed."
        : "Auto Generate saved complete client coverage, supervised naps, fixed speech and staff breaks.",
      readiness,
      metrics,
      warnings,
      uncoveredRequirements: finalCoverage.uncoveredRequirements,
      managerGapCount,
      unresolvedEventCount,
      recoveredCoverageAfterBreakMove:finalPass.addedCount,
      unresolvedEventDiagnostics,
      unplacedEvents:eventStatus.unplacedEvents,
      templateMatchedBlocks: templatePinning.pinned.length,
      primaryTemplateBlocks: templatePinning.primaryCount,
      secondaryTemplateBlocks: templatePinning.secondaryCount,
      templateRejectedBlocks: templatePinning.rejected,
      reservedBreakCount: breakPlan.reservedBreaks.length,
      reliefSwapCount: breakPlan.reliefSwapCount,
      humanStyleBlockSwapCount: breakPlan.humanStyleBlockSwapCount,
      humanStylePenaltyBefore: breakPlan.humanStylePenaltyBefore,
      humanStylePenaltyAfter: breakPlan.humanStylePenaltyAfter,
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
