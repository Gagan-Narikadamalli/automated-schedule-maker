import { NextResponse } from "next/server";

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

type TemplateRequest = {
  locationId?: string;
  name?: string;
  dayOfWeek?: string;
  sourceDate?: string;
};

type DeleteTemplateRequest = {
  locationId?: string;
  templateId?: string;
};

type PlainRecord = Record<string, any>;

const DAYS = new Set([
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
]);

function serializeTemplate(template: PlainRecord) {
  return {
    id: String(template._id),
    locationId: String(template.locationId),
    name: String(template.name ?? ""),
    dayOfWeek: String(template.dayOfWeek ?? "MONDAY"),
    assignmentCount: Array.isArray(template.assignments)
      ? template.assignments.length
      : 0,
    active: Boolean(template.active),
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

export async function GET(request: Request) {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  const url = new URL(request.url);
  const locationId = url.searchParams.get("locationId");

  if (!locationId) {
    return NextResponse.json(
      { error: "locationId is required." },
      { status: 400 }
    );
  }

  if (!sessionCanAccessLocation(auth.session, locationId)) {
    return forbiddenResponse("You do not have access to this location.");
  }

  try {
    await connectToDatabase();

    const templates = await ScheduleTemplate.find({
      locationId,
      active: true,
    })
      .sort({ dayOfWeek: 1, name: 1 })
      .lean();

    return NextResponse.json({
      templates: (templates as unknown as PlainRecord[]).map(serializeTemplate),
    });
  } catch (error) {
    console.error("Failed to load templates:", error);

    return NextResponse.json(
      { error: "Templates could not be loaded." },
      { status: 500 }
    );
  }
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
    const body = (await request.json()) as TemplateRequest;
    const locationId = body.locationId?.trim();
    const name = body.name?.trim();
    const dayOfWeek = body.dayOfWeek?.trim().toUpperCase();
    const sourceDate = body.sourceDate?.trim() || "";

    if (!locationId || !name || !dayOfWeek || !DAYS.has(dayOfWeek)) {
      return NextResponse.json(
        { error: "Location, template name, and valid day of week are required." },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    if (sourceDate && !/^\d{4}-\d{2}-\d{2}$/.test(sourceDate)) {
      return NextResponse.json(
        { error: "Source date must use YYYY-MM-DD format." },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const sourceAssignments = sourceDate
      ? await ScheduleAssignment.find({ locationId, date: sourceDate }).lean()
      : [];

    const assignments = (sourceAssignments as unknown as PlainRecord[]).map(
      (assignment) => ({
        startTime: String(assignment.startTime),
        endTime: String(assignment.endTime),
        staffId: assignment.staffId,
        clientId: assignment.clientId ?? null,
        assignmentType: String(assignment.assignmentType),
        locked:
          Boolean(assignment.locked) ||
          Boolean(assignment.manuallyOverridden),
      })
    );

    const template = await ScheduleTemplate.findOneAndUpdate(
      { locationId, dayOfWeek, name },
      {
        $set: {
          locationId,
          name,
          dayOfWeek,
          assignments,
          active: true,
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      }
    );

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: "SAVE_TEMPLATE",
      entityType: "SCHEDULE_TEMPLATE",
      entityId: String(template._id),
      summary: sourceDate
        ? `Saved template ${name} from ${sourceDate}.`
        : `Created empty template ${name}.`,
      after: {
        name,
        dayOfWeek,
        sourceDate,
        assignmentCount: assignments.length,
      },
    });

    return NextResponse.json(
      {
        template: serializeTemplate(
          template.toObject() as unknown as PlainRecord
        ),
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Failed to save template:", error);

    if (error?.code === 11000) {
      return NextResponse.json(
        { error: "A template with this name already exists for that day." },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Template could not be saved." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  if (!sessionHasAnyRole(auth.session, SCHEDULE_WRITE_ROLES)) {
    return forbiddenResponse();
  }

  try {
    const body = (await request.json()) as DeleteTemplateRequest;
    const locationId = body.locationId?.trim();
    const templateId = body.templateId?.trim();

    if (!locationId || !templateId) {
      return NextResponse.json(
        { error: "Location and template are required." },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    await connectToDatabase();

    const template = await ScheduleTemplate.findOneAndUpdate(
      { _id: templateId, locationId },
      { $set: { active: false } },
      { new: true }
    );

    if (!template) {
      return NextResponse.json(
        { error: "Template was not found." },
        { status: 404 }
      );
    }

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: "ARCHIVE_TEMPLATE",
      entityType: "SCHEDULE_TEMPLATE",
      entityId: templateId,
      summary: `Archived template ${template.name}.`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to archive template:", error);

    return NextResponse.json(
      { error: "Template could not be archived." },
      { status: 500 }
    );
  }
}
