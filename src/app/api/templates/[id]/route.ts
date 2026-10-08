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
import { Client } from "@/models/Client";
import { ScheduleTemplate } from "@/models/ScheduleTemplate";
import { Staff } from "@/models/Staff";

type PlainRecord = Record<string, any>;

type TemplateAssignmentInput = {
  startTime?: string;
  endTime?: string;
  staffId?: string;
  clientId?: string | null;
  assignmentType?: string;
  locked?: boolean;
};

type UpdateTemplateRequest = {
  locationId?: string;
  name?: string;
  dayOfWeek?: string;
  assignments?: TemplateAssignmentInput[];
};

const DAYS = new Set([
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
]);

const ASSIGNMENT_TYPES = new Set([
  "CLIENT_1_TO_1",
  "BREAK",
  "BREAK_NAP",
  "BREAK_SPEECH",
  "NAP",
  "SPEECH",
]);

function serializeAssignment(assignment: PlainRecord) {
  return {
    id: assignment._id ? String(assignment._id) : undefined,
    startTime: String(assignment.startTime ?? ""),
    endTime: String(assignment.endTime ?? ""),
    staffId: String(assignment.staffId ?? ""),
    clientId: assignment.clientId ? String(assignment.clientId) : null,
    assignmentType: String(assignment.assignmentType ?? ""),
    locked: Boolean(assignment.locked),
  };
}

function serializeTemplate(template: PlainRecord) {
  return {
    id: String(template._id),
    locationId: String(template.locationId),
    name: String(template.name ?? ""),
    dayOfWeek: String(template.dayOfWeek ?? "MONDAY"),
    sourceType: String(template.sourceType ?? "MANUAL"),
    sourceName: String(template.sourceName ?? ""),
    sourceDate: String(template.sourceDate ?? ""),
    styleNotes: Array.isArray(template.styleNotes)
      ? template.styleNotes.map((item: unknown) => String(item))
      : [],
    learningOnly: Boolean(template.learningOnly),
    assignments: Array.isArray(template.assignments)
      ? template.assignments.map((assignment: PlainRecord) =>
          serializeAssignment(assignment)
        )
      : [],
    assignmentCount: Array.isArray(template.assignments)
      ? template.assignments.length
      : 0,
    active: Boolean(template.active),
  };
}

function serializeStaff(member: PlainRecord) {
  return {
    id: String(member._id),
    name: String(member.fullName ?? ""),
    role: String(member.role ?? ""),
    color: String(member.color ?? "#DCE9F8"),
  };
}

function serializeClient(client: PlainRecord) {
  return {
    id: String(client._id),
    code: String(client.displayCode ?? ""),
    color: String(client.color ?? "#D9F4EE"),
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiSession();
  if (auth.error) return auth.error;

  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const locationId = url.searchParams.get("locationId")?.trim();

    if (!locationId || !id) {
      return NextResponse.json(
        { error: "Location and template are required." },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    await connectToDatabase();

    const [template, staff, clients] = await Promise.all([
      ScheduleTemplate.findOne({
        _id: id,
        locationId,
        active: true,
      }).lean(),
      Staff.find({ locationId, active: true })
        .select("_id fullName role color")
        .sort({ fullName: 1 })
        .lean(),
      Client.find({ locationId, active: true })
        .select("_id displayCode color")
        .sort({ displayCode: 1 })
        .lean(),
    ]);

    if (!template) {
      return NextResponse.json(
        { error: "Template was not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      template: serializeTemplate(template as unknown as PlainRecord),
      staff: (staff as unknown as PlainRecord[]).map(serializeStaff),
      clients: (clients as unknown as PlainRecord[]).map(serializeClient),
    });
  } catch (error) {
    console.error("Failed to load template editor data:", error);
    return NextResponse.json(
      { error: "Template editor data could not be loaded." },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiSession();
  if (auth.error) return auth.error;

  if (!sessionHasAnyRole(auth.session, SCHEDULE_WRITE_ROLES)) {
    return forbiddenResponse();
  }

  try {
    const { id } = await context.params;
    const body = (await request.json()) as UpdateTemplateRequest;
    const locationId = body.locationId?.trim();
    const name = body.name?.trim();
    const dayOfWeek = body.dayOfWeek?.trim().toUpperCase();

    if (
      !locationId ||
      !id ||
      !name ||
      !dayOfWeek ||
      !DAYS.has(dayOfWeek)
    ) {
      return NextResponse.json(
        {
          error:
            "Location, template name, and valid weekday are required.",
        },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    const assignments = Array.isArray(body.assignments)
      ? body.assignments
          .map((assignment) => ({
            startTime: String(assignment.startTime ?? "").trim(),
            endTime: String(assignment.endTime ?? "").trim(),
            staffId: String(assignment.staffId ?? "").trim(),
            clientId:
              assignment.clientId === null ||
              assignment.clientId === undefined ||
              String(assignment.clientId).trim() === ""
                ? null
                : String(assignment.clientId).trim(),
            assignmentType: String(
              assignment.assignmentType ?? ""
            ).trim(),
            locked: Boolean(assignment.locked),
          }))
          .filter(
            (assignment) =>
              assignment.startTime &&
              assignment.endTime &&
              assignment.staffId &&
              ASSIGNMENT_TYPES.has(assignment.assignmentType) &&
              (assignment.assignmentType !== "CLIENT_1_TO_1" ||
                Boolean(assignment.clientId))
          )
      : [];

    await connectToDatabase();

    const before = await ScheduleTemplate.findOne({
      _id: id,
      locationId,
      active: true,
    }).lean();

    if (!before) {
      return NextResponse.json(
        { error: "Template was not found." },
        { status: 404 }
      );
    }

    if ((before as unknown as PlainRecord).learningOnly === true) {
      return NextResponse.json(
        {
          error:
            "Learning-only profiles do not contain editable schedule cells. Upload an exact workbook sheet or save an exact day to create an editable template.",
        },
        { status: 400 }
      );
    }

    const staffIds = [...new Set(assignments.map((item) => item.staffId))];
    const clientIds = [
      ...new Set(
        assignments
          .map((item) => item.clientId)
          .filter((value): value is string => Boolean(value))
      ),
    ];

    const [staffCount, clientCount] = await Promise.all([
      staffIds.length
        ? Staff.countDocuments({
            _id: { $in: staffIds },
            locationId,
            active: true,
          })
        : Promise.resolve(0),
      clientIds.length
        ? Client.countDocuments({
            _id: { $in: clientIds },
            locationId,
            active: true,
          })
        : Promise.resolve(0),
    ]);

    if (staffCount !== staffIds.length) {
      return NextResponse.json(
        {
          error:
            "One or more template staff members are no longer active at this clinic. Refresh the editor and try again.",
        },
        { status: 400 }
      );
    }

    if (clientCount !== clientIds.length) {
      return NextResponse.json(
        {
          error:
            "One or more template clients are no longer active at this clinic. Refresh the editor and try again.",
        },
        { status: 400 }
      );
    }

    const updated = await ScheduleTemplate.findOneAndUpdate(
      { _id: id, locationId, active: true },
      {
        $set: {
          name,
          dayOfWeek,
          assignments,
          learningOnly: false,
        },
      },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return NextResponse.json(
        { error: "Template was not found." },
        { status: 404 }
      );
    }

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: "UPDATE",
      entityType: "SCHEDULE_TEMPLATE",
      entityId: id,
      summary: `Edited exact schedule template ${name}.`,
      before,
      after: {
        name,
        dayOfWeek,
        assignmentCount: assignments.length,
      },
    });

    return NextResponse.json({
      template: serializeTemplate(
        updated.toObject() as unknown as PlainRecord
      ),
    });
  } catch (error: any) {
    console.error("Failed to update schedule template:", error);

    if (error?.code === 11000) {
      return NextResponse.json(
        {
          error:
            "Another template with this name already exists for that weekday.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Template changes could not be saved." },
      { status: 500 }
    );
  }
}
