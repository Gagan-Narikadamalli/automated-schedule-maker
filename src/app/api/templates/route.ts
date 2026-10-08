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
import { HistoricalScheduleAssignment } from "@/models/HistoricalScheduleAssignment";
import { ScheduleAssignment } from "@/models/ScheduleAssignment";
import { ScheduleTemplate } from "@/models/ScheduleTemplate";

type TemplateRequest = {
  locationId?: string;
  name?: string;
  dayOfWeek?: string;
  sourceDate?: string;
  sourceType?: "SAVED_SCHEDULE" | "HISTORICAL_WORKBOOK" | "MANUAL";
  sourceName?: string;
  styleNotes?: string[];
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

const DAY_NAMES = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
] as const;

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
    assignmentCount: Array.isArray(template.assignments)
      ? template.assignments.length
      : 0,
    active: Boolean(template.active),
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

function getDayOfWeek(dateText: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    return null;
  }

  const [yearText, monthText, dayText] = dateText.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return DAY_NAMES[parsed.getUTCDay()];
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
    const sourceType =
      body.sourceType === "HISTORICAL_WORKBOOK"
        ? "HISTORICAL_WORKBOOK"
        : body.sourceType === "SAVED_SCHEDULE"
          ? "SAVED_SCHEDULE"
          : "MANUAL";
    const sourceName =
      body.sourceName?.trim() ||
      (sourceType === "HISTORICAL_WORKBOOK"
        ? "Imported workbook history"
        : sourceType === "SAVED_SCHEDULE"
          ? "Saved clinic schedule"
          : "");
    const styleNotes = Array.isArray(body.styleNotes)
      ? body.styleNotes
          .map((item) => String(item).trim())
          .filter(Boolean)
          .slice(0, 20)
      : [];

    if (!locationId || !name || !dayOfWeek || !DAYS.has(dayOfWeek)) {
      return NextResponse.json(
        { error: "Location, template name, and valid day of week are required." },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    const sourceDayOfWeek = sourceDate
      ? getDayOfWeek(sourceDate)
      : null;

    if (sourceDate && !sourceDayOfWeek) {
      return NextResponse.json(
        { error: "Source date must be a real YYYY-MM-DD calendar date." },
        { status: 400 }
      );
    }

    if (sourceDayOfWeek && sourceDayOfWeek !== dayOfWeek) {
      return NextResponse.json(
        {
          error: `The source schedule is ${sourceDayOfWeek}. Save it as a ${sourceDayOfWeek} template instead of ${dayOfWeek}.`,
        },
        { status: 400 }
      );
    }

    await connectToDatabase();

    let assignments: PlainRecord[] = [];
    let skippedHistoricalRows = 0;

    if (sourceType === "HISTORICAL_WORKBOOK") {
      if (!sourceDate) {
        return NextResponse.json(
          {
            error:
              "A historical workbook template requires the original sheet date.",
          },
          { status: 400 }
        );
      }

      const historicalRows = (await HistoricalScheduleAssignment.find({
        locationId,
        scheduleDate: sourceDate,
        dayOfWeek,
      })
        .sort({ startTime: 1, rawStaffName: 1 })
        .lean()) as unknown as PlainRecord[];

      if (historicalRows.length === 0) {
        return NextResponse.json(
          {
            error:
              "No imported workbook rows were found for that date/day. Import or map the sheet before saving it as a template.",
          },
          { status: 400 }
        );
      }

      assignments = historicalRows.reduce<PlainRecord[]>(
        (result, assignment) => {
          const assignmentType = String(assignment.assignmentType ?? "");
          const staffId = assignment.staffId ?? null;
          const clientId = assignment.clientId ?? null;

          if (!staffId) {
            skippedHistoricalRows += 1;
            return result;
          }

          if (assignmentType === "CLIENT_1_TO_1" && !clientId) {
            skippedHistoricalRows += 1;
            return result;
          }

          if (
            ![
              "CLIENT_1_TO_1",
              "BREAK",
              "BREAK_NAP",
              "BREAK_SPEECH",
              "NAP",
              "SPEECH",
            ].includes(assignmentType)
          ) {
            skippedHistoricalRows += 1;
            return result;
          }

          result.push({
            startTime: String(assignment.startTime),
            endTime: String(assignment.endTime),
            staffId,
            clientId,
            assignmentType,
            locked: false,
          });
          return result;
        },
        []
      );

      if (assignments.length === 0) {
        return NextResponse.json(
          {
            error:
              "Workbook rows exist for this day, but none are fully mapped to current Livingston staff/client records yet.",
            skippedHistoricalRows,
          },
          { status: 400 }
        );
      }
    } else if (sourceType === "SAVED_SCHEDULE") {
      const sourceAssignments = sourceDate
        ? await ScheduleAssignment.find({ locationId, date: sourceDate }).lean()
        : [];

      if (sourceDate && sourceAssignments.length === 0) {
        return NextResponse.json(
          {
            error:
              "The selected source date has no saved schedule assignments. Choose a populated schedule or create an empty manual template.",
          },
          { status: 400 }
        );
      }

      assignments = (sourceAssignments as unknown as PlainRecord[]).map(
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
    }

    const template = await ScheduleTemplate.findOneAndUpdate(
      { locationId, dayOfWeek, name },
      {
        $set: {
          locationId,
          name,
          dayOfWeek,
          sourceType,
          sourceName,
          sourceDate,
          styleNotes,
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
      summary:
        sourceType === "HISTORICAL_WORKBOOK"
          ? `Saved workbook template ${name} from ${sourceDate}.`
          : sourceDate
            ? `Saved template ${name} from ${sourceDate}.`
            : `Created manual template ${name}.`,
      after: {
        name,
        dayOfWeek,
        sourceType,
        sourceName,
        sourceDate,
        assignmentCount: assignments.length,
        skippedHistoricalRows,
        styleNotes,
      },
    });

    return NextResponse.json(
      {
        template: serializeTemplate(
          template.toObject() as unknown as PlainRecord
        ),
        skippedHistoricalRows,
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
