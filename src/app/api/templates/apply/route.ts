import { NextResponse } from "next/server";

import { buildDaySchedulerInput } from "@/features/scheduler/server/buildDaySchedulerInput";
import { applyFixedNapSessions } from "@/features/scheduler/server/applyFixedNapSessions";
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
import { ScheduleTemplate } from "@/models/ScheduleTemplate";
import { AppliedScheduleTemplate } from "@/models/AppliedScheduleTemplate";

type ApplyTemplateRequest = {
  locationId?: string;
  templateId?: string;
  targetDate?: string;
};

type PlainRecord = Record<string, any>;

export async function POST(request: Request) {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  if (!sessionHasAnyRole(auth.session, SCHEDULE_WRITE_ROLES)) {
    return forbiddenResponse();
  }

  try {
    const body = (await request.json()) as ApplyTemplateRequest;
    const locationId = body.locationId?.trim();
    const templateId = body.templateId?.trim();
    const targetDate = body.targetDate?.trim();

    if (!locationId || !templateId || !targetDate) {
      return NextResponse.json(
        { error: "Location, template, and target date are required." },
        { status: 400 }
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return NextResponse.json(
        { error: "Target date must use YYYY-MM-DD format." },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    await connectToDatabase();

    const [templateResult, baseDayData, protectedTargetResult] =
      await Promise.all([
        ScheduleTemplate.findOne({
          _id: templateId,
          locationId,
          active: true,
        }).lean(),
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

    const napApplication = await applyFixedNapSessions(
      locationId,
      targetDate,
      baseDayData.input
    );
    const effectiveInput = napApplication.input;

    if (!templateResult) {
      return NextResponse.json(
        { error: "Template was not found." },
        { status: 404 }
      );
    }

    const template = templateResult as unknown as PlainRecord;

    if (template.learningOnly === true) {
      return NextResponse.json(
        {
          error:
            "This workbook template is a learning/reference profile rather than a direct cell template. Auto Generate and Native Scheduler AI use it as same-weekday guidance; it cannot be applied cell-for-cell.",
        },
        { status: 400 }
      );
    }

    const protectedTarget = protectedTargetResult as unknown as PlainRecord[];
    const protectedCells = new Set(
      protectedTarget.map(
        (assignment) =>
          `${String(assignment.staffId)}-${String(assignment.startTime)}`
      )
    );
    const protectedClientSlots = new Set(
      protectedTarget
        .filter(
          (assignment) =>
            assignment.assignmentType === "CLIENT_1_TO_1" &&
            assignment.clientId
        )
        .map(
          (assignment) =>
            `${String(assignment.clientId)}-${String(assignment.startTime)}`
        )
    );
    const staffAvailability = new Map(
      effectiveInput.staff.map((staffMember) => [
        staffMember.id,
        new Set(staffMember.availableSlots),
      ])
    );
    const clientsById = new Map(
      effectiveInput.clients.map((client) => [client.id, client])
    );
    const occupiedClientSlots = new Set(protectedClientSlots);
    const linkedNapSlots = new Set(
      protectedTarget.filter((item) => item.assignmentType === "BREAK_NAP" && item.clientId)
        .map((item) => `${String(item.clientId)}-${String(item.startTime)}`)
    );
    const occupiedStaffSlots = new Set(protectedCells);
    const warnings: string[] = [];
    const validAssignments: PlainRecord[] = [];

    for (const templateAssignment of template.assignments ?? []) {
      const staffId = String(templateAssignment.staffId);
      const clientId = templateAssignment.clientId
        ? String(templateAssignment.clientId)
        : null;
      const startTime = String(templateAssignment.startTime);
      const cellKey = `${staffId}-${startTime}`;
      const assignmentType = String(templateAssignment.assignmentType);

      if (occupiedStaffSlots.has(cellKey)) {
        warnings.push(
          `Skipped ${startTime} for staff ${staffId}; the target cell has a protected manual assignment.`
        );
        continue;
      }

      if (
        assignmentType !== "UNAVAILABLE" &&
        !staffAvailability.get(staffId)?.has(startTime)
      ) {
        warnings.push(
          `Skipped ${startTime} for staff ${staffId}; that staff member is unavailable on the target date.`
        );
        continue;
      }

      if (assignmentType === "BREAK_NAP") {
        if (!clientId || !clientsById.get(clientId)?.napSlots.includes(startTime)) {
          warnings.push(`Skipped unlinked/invalid Break + Nap for staff ${staffId} at ${startTime}: only a recorded Nap event on the target date can authorize a client nap.`);
          continue;
        }
        const napKey = `${clientId}-${startTime}`;
        if (linkedNapSlots.has(napKey)) {
          warnings.push(`Skipped duplicate Break + Nap for ${clientId} at ${startTime}; the client is already linked to a staff break.`);
          continue;
        }
        linkedNapSlots.add(napKey);
      }

      if (clientId && !clientsById.has(clientId)) {
        warnings.push(
          `Skipped ${startTime} for client ${clientId}; that client is not active for the target date.`
        );
        continue;
      }

      if (assignmentType === "CLIENT_1_TO_1" && clientId) {
        const targetClient = clientsById.get(clientId);

        if (!targetClient?.requiredSlots.includes(startTime)) {
          warnings.push(
            `Skipped ${startTime} for client ${clientId}; the client is not scheduled for 1:1 coverage at that time after attendance, Speech, and Nap rules were applied.`
          );
          continue;
        }

        const clientSlotKey = `${clientId}-${startTime}`;
        if (occupiedClientSlots.has(clientSlotKey)) {
          warnings.push(
            `Skipped ${startTime} for client ${clientId}; the client already has protected or template 1:1 coverage at that time.`
          );
          continue;
        }

        occupiedClientSlots.add(clientSlotKey);
      }

      occupiedStaffSlots.add(cellKey);
      validAssignments.push({
        locationId,
        date: targetDate,
        startTime,
        endTime: String(templateAssignment.endTime),
        staffId,
        clientId,
        assignmentType,
        source: "TEMPLATE",
        locked: Boolean(templateAssignment.locked),
        manuallyOverridden: false,
        note: `Applied from template ${String(template.name)}.`,
      });
    }

    await ScheduleAssignment.deleteMany({
      locationId,
      date: targetDate,
      source: { $in: ["AUTO", "TEMPLATE", "COPIED"] },
      manuallyOverridden: { $ne: true },
      locked: { $ne: true },
    });

    if (validAssignments.length > 0) {
      await ScheduleAssignment.bulkWrite(
        validAssignments.map((assignment) => ({
          updateOne: {
            filter: {
              locationId,
              date: targetDate,
              staffId: assignment.staffId,
              startTime: assignment.startTime,
            },
            update: { $set: assignment },
            upsert: true,
          },
        })),
        { ordered: false }
      );
    }

    // Remember which template the manager selected even after Generate Day
    // replaces the visible template cells with fresh AUTO assignments.
    await AppliedScheduleTemplate.updateOne(
      { locationId, date: targetDate },
      { $set: { templateId } },
      { upsert: true }
    );

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: "APPLY_TEMPLATE",
      entityType: "SCHEDULE_DAY",
      entityId: targetDate,
      summary: `Applied template ${String(template.name)} to ${targetDate}.`,
      after: {
        templateId,
        targetDate,
        appliedCount: validAssignments.length,
        warningCount: warnings.length,
      },
    });

    return NextResponse.json({
      success: true,
      appliedCount: validAssignments.length,
      warnings,
    });
  } catch (error) {
    console.error("Apply template failed:", error);

    return NextResponse.json(
      { error: "Template could not be applied." },
      { status: 500 }
    );
  }
}
