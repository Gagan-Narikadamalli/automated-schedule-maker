import { NextResponse } from "next/server";

import { getEndTimeForSlot } from "@/features/scheduler/engine/dateUtils";
import { buildDaySchedulerInput } from "@/features/scheduler/server/buildDaySchedulerInput";
import { persistScheduleReplacementSafely } from "@/features/scheduler/server/persistScheduleReplacementSafely";
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

type CopyDayRequest = {
  locationId?: string;
  sourceDate?: string;
  targetDate?: string;
};

type PlainAssignment = Record<string, any>;

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
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
    const body = (await request.json()) as CopyDayRequest;
    const locationId = body.locationId?.trim();
    const sourceDate = body.sourceDate?.trim();
    const targetDate = body.targetDate?.trim();

    if (!locationId || !sourceDate || !targetDate) {
      return NextResponse.json(
        { error: "Location, source date, and target date are required." },
        { status: 400 }
      );
    }

    if (!isValidDate(sourceDate) || !isValidDate(targetDate)) {
      return NextResponse.json(
        { error: "Dates must use YYYY-MM-DD format." },
        { status: 400 }
      );
    }

    if (sourceDate === targetDate) {
      return NextResponse.json(
        { error: "Source date and target date must be different." },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    await connectToDatabase();

    const [sourceAssignmentsResult, targetData, targetManualResult] =
      await Promise.all([
        ScheduleAssignment.find({ locationId, date: sourceDate }).lean(),
        buildDaySchedulerInput(locationId, targetDate),
        ScheduleAssignment.find({
          locationId,
          date: targetDate,
          $or: [
            { source: "MANUAL" },
            { manuallyOverridden: true },
            { locked: true },
          ],
        }).lean(),
      ]);

    const sourceAssignments = sourceAssignmentsResult as unknown as PlainAssignment[];
    const targetManualAssignments = targetManualResult as unknown as PlainAssignment[];

    if (sourceAssignments.length === 0) {
      return NextResponse.json(
        { error: "The source date does not contain any saved assignments." },
        { status: 404 }
      );
    }

    const availableSlotsByStaff = new Map(
      targetData.staff.map((staffMember) => [
        staffMember.id,
        new Set(staffMember.availableSlots),
      ])
    );
    const targetClientIds = new Set(targetData.clients.map((client) => client.id));
    const protectedTargetCells = new Set(
      targetManualAssignments.map(
        (assignment) => `${String(assignment.staffId)}-${String(assignment.startTime)}`
      )
    );

    const warnings: string[] = [];
    const assignmentsToCopy: PlainAssignment[] = [];

    for (const sourceAssignment of sourceAssignments) {
      const staffId = String(sourceAssignment.staffId);
      const clientId = sourceAssignment.clientId
        ? String(sourceAssignment.clientId)
        : null;
      const startTime = String(sourceAssignment.startTime);
      const assignmentType = String(sourceAssignment.assignmentType);
      const cellKey = `${staffId}-${startTime}`;

      if (protectedTargetCells.has(cellKey)) {
        warnings.push(
          `Skipped ${startTime} for staff ${staffId} because the target cell is manually protected.`
        );
        continue;
      }

      if (
        assignmentType !== "UNAVAILABLE" &&
        !availableSlotsByStaff.get(staffId)?.has(startTime)
      ) {
        warnings.push(
          `Skipped ${startTime} for staff ${staffId} because that staff member is unavailable on the target date.`
        );
        continue;
      }

      if (clientId && !targetClientIds.has(clientId)) {
        warnings.push(
          `Skipped ${startTime} for client ${clientId} because that client is not active/attending on the target date.`
        );
        continue;
      }

      assignmentsToCopy.push({
        locationId,
        date: targetDate,
        startTime,
        endTime: getEndTimeForSlot(startTime),
        staffId,
        clientId,
        assignmentType,
        source: "COPIED",
        locked: Boolean(sourceAssignment.locked),
        manuallyOverridden: Boolean(sourceAssignment.manuallyOverridden),
        note: sourceAssignment.note
          ? `Copied from ${sourceDate}: ${String(sourceAssignment.note)}`
          : `Copied from ${sourceDate}.`,
      });
    }

    if (assignmentsToCopy.length === 0) {
      return NextResponse.json(
        {
          error:
            "No source assignments are valid for the target date. The existing target schedule was preserved.",
          warnings,
        },
        { status: 409 }
      );
    }

    const persistence = await persistScheduleReplacementSafely({
      locationId,
      date: targetDate,
      replacements: assignmentsToCopy,
      replaceableFilter: {
        source: { $in: ["AUTO", "TEMPLATE", "COPIED"] },
        manuallyOverridden: { $ne: true },
        locked: { $ne: true },
      },
    });

    if (persistence.blockedEmptyReplacement) {
      return NextResponse.json(
        {
          error:
            "The copy operation produced no replacement blocks, so the existing target schedule was preserved.",
          warnings,
          preservedAssignmentCount: persistence.preservedCount,
        },
        { status: 409 }
      );
    }

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: "COPY_DAY",
      entityType: "SCHEDULE_DAY",
      entityId: targetDate,
      summary: `Copied ${assignmentsToCopy.length} schedule blocks from ${sourceDate} to ${targetDate}.`,
      after: {
        sourceDate,
        targetDate,
        copiedCount: assignmentsToCopy.length,
        warningCount: warnings.length,
      },
    });

    return NextResponse.json({
      success: true,
      sourceDate,
      targetDate,
      copiedCount: assignmentsToCopy.length,
      warnings,
    });
  } catch (error) {
    console.error("Copy day failed:", error);

    return NextResponse.json(
      { error: "The schedule day could not be copied." },
      { status: 500 }
    );
  }
}
