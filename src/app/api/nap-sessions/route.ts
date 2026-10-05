import { randomUUID } from "node:crypto";

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
import { NapSession } from "@/models/NapSession";

type NapPriorityCategory = "YOUNGER" | "OLDER";

type NapSessionRequest = {
  locationId?: string;
  clientId?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  priorityCategory?: NapPriorityCategory;
  recurringSeriesId?: string;
  seriesStartDate?: string;
  seriesEndDate?: string;
  daysOfWeek?: string[];
  note?: string;
};

type DeleteRequest = {
  locationId?: string;
  sessionId?: string;
  recurringSeriesId?: string;
};

type PlainRecord = Record<string, any>;

const DAY_NAMES = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];

const NAP_WINDOW_START = "11:00";
const NAP_WINDOW_END = "14:00";

function serializeNapSession(session: PlainRecord) {
  const client =
    session.clientId && typeof session.clientId === "object"
      ? session.clientId
      : null;

  return {
    id: String(session._id),
    locationId: String(session.locationId),
    clientId: client
      ? String(client._id ?? client.id ?? "")
      : String(session.clientId ?? ""),
    client: client
      ? {
          id: String(client._id ?? client.id ?? ""),
          displayCode: String(client.displayCode ?? ""),
          fullName: String(client.fullName ?? ""),
          color: String(client.color ?? "#D9F4EE"),
        }
      : null,
    date: String(session.date),
    startTime: String(session.startTime),
    endTime: String(session.endTime),
    priorityCategory:
      String(session.priorityCategory ?? "OLDER") === "YOUNGER"
        ? "YOUNGER"
        : "OLDER",
    recurringSeriesId: String(session.recurringSeriesId ?? ""),
    note: String(session.note ?? ""),
  };
}

function enumerateSeriesDates(
  startDate: string,
  endDate: string,
  daysOfWeek: string[]
): string[] {
  const selectedDays = new Set(daysOfWeek.map((day) => day.toUpperCase()));
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  const dates: string[] = [];

  for (
    const cursor = new Date(start);
    cursor.getTime() <= end.getTime();
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const dayName = DAY_NAMES[cursor.getDay()];

    if (selectedDays.has(dayName)) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
  }

  return dates;
}

function isThirtyMinuteBoundary(time: string): boolean {
  return /^([01]\d|2[0-3]):(00|30)$/.test(time);
}

export async function GET(request: Request) {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  const url = new URL(request.url);
  const locationId = url.searchParams.get("locationId");
  const date = url.searchParams.get("date");
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");

  if (!locationId) {
    return NextResponse.json(
      { error: "locationId is required." },
      { status: 400 }
    );
  }

  if (!date && (!startDate || !endDate)) {
    return NextResponse.json(
      { error: "Provide either date or startDate/endDate." },
      { status: 400 }
    );
  }

  if (!sessionCanAccessLocation(auth.session, locationId)) {
    return forbiddenResponse("You do not have access to this location.");
  }

  try {
    await connectToDatabase();

    const dateQuery = date
      ? { date }
      : {
          date: {
            $gte: startDate,
            $lte: endDate,
          },
        };

    const sessions = await NapSession.find({
      locationId,
      ...dateQuery,
    })
      .populate("clientId", "displayCode color fullName")
      .sort({ date: 1, priorityCategory: 1, startTime: 1 })
      .lean();

    return NextResponse.json({
      napSessions: (sessions as unknown as PlainRecord[]).map(
        serializeNapSession
      ),
    });
  } catch (error) {
    console.error("Failed to load nap sessions:", error);

    return NextResponse.json(
      { error: "Nap sessions could not be loaded." },
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
    const body = (await request.json()) as NapSessionRequest;
    const locationId = body.locationId?.trim();
    const clientId = body.clientId?.trim();
    const startTime = body.startTime?.trim();
    const endTime = body.endTime?.trim();
    const priorityCategory: NapPriorityCategory =
      body.priorityCategory === "YOUNGER" ? "YOUNGER" : "OLDER";

    if (!locationId || !clientId || !startTime || !endTime) {
      return NextResponse.json(
        { error: "Location, client, nap start time, and nap end time are required." },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    if (!isThirtyMinuteBoundary(startTime) || !isThirtyMinuteBoundary(endTime)) {
      return NextResponse.json(
        { error: "Nap times must use 30-minute schedule boundaries." },
        { status: 400 }
      );
    }

    if (
      startTime < NAP_WINDOW_START ||
      endTime > NAP_WINDOW_END ||
      endTime <= startTime
    ) {
      return NextResponse.json(
        {
          error:
            "Nap time must start and finish inside the 11:00 AM to 2:00 PM nap window.",
        },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const client = await Client.findOne({
      _id: clientId,
      locationId,
      active: true,
    });

    if (!client) {
      return NextResponse.json(
        { error: "The selected active client was not found at this location." },
        { status: 404 }
      );
    }

    const hasSeriesRequest = Boolean(
      body.seriesStartDate &&
        body.seriesEndDate &&
        body.daysOfWeek &&
        body.daysOfWeek.length > 0
    );

    let dates: string[] = [];
    let recurringSeriesId = body.recurringSeriesId?.trim() || "";

    if (hasSeriesRequest) {
      const seriesStartDate = body.seriesStartDate!.trim();
      const seriesEndDate = body.seriesEndDate!.trim();

      if (seriesEndDate < seriesStartDate) {
        return NextResponse.json(
          { error: "Series end date must be on or after the start date." },
          { status: 400 }
        );
      }

      dates = enumerateSeriesDates(
        seriesStartDate,
        seriesEndDate,
        body.daysOfWeek ?? []
      );
      recurringSeriesId ||= randomUUID();
    } else if (body.date?.trim()) {
      dates = [body.date.trim()];
    } else {
      return NextResponse.json(
        {
          error:
            "Choose a single nap date or provide a weekly series date range and weekday(s).",
        },
        { status: 400 }
      );
    }

    if (dates.length === 0) {
      return NextResponse.json(
        { error: "No nap dates matched the selected recurrence." },
        { status: 400 }
      );
    }

    if (dates.length > 100) {
      return NextResponse.json(
        { error: "A recurring series cannot create more than 100 nap sessions at once." },
        { status: 400 }
      );
    }

    const createdIds: string[] = [];

    for (const sessionDate of dates) {
      const session = await NapSession.findOneAndUpdate(
        {
          locationId,
          clientId,
          date: sessionDate,
          startTime,
          endTime,
        },
        {
          $set: {
            locationId,
            clientId,
            date: sessionDate,
            startTime,
            endTime,
            priorityCategory,
            recurringSeriesId,
            note: body.note?.trim() || "",
          },
        },
        {
          new: true,
          upsert: true,
          runValidators: true,
        }
      );

      createdIds.push(String(session._id));
    }

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: hasSeriesRequest ? "CREATE_NAP_SERIES" : "CREATE_NAP_SESSION",
      entityType: "NAP_SESSION",
      entityId: recurringSeriesId || createdIds[0],
      summary: hasSeriesRequest
        ? `Added ${dates.length} recurring nap sessions for ${client.displayCode}.`
        : `Added nap for ${client.displayCode} on ${dates[0]} at ${startTime}.`,
      after: {
        clientId,
        dates,
        startTime,
        endTime,
        priorityCategory,
        recurringSeriesId,
      },
    });

    return NextResponse.json(
      {
        success: true,
        createdCount: dates.length,
        recurringSeriesId,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to create nap session:", error);

    return NextResponse.json(
      { error: "Nap session could not be created." },
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
    const body = (await request.json()) as DeleteRequest;
    const locationId = body.locationId?.trim();
    const sessionId = body.sessionId?.trim();
    const recurringSeriesId = body.recurringSeriesId?.trim();

    if (!locationId || (!sessionId && !recurringSeriesId)) {
      return NextResponse.json(
        { error: "Location and nap session or recurring series are required." },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    await connectToDatabase();

    const filter = recurringSeriesId
      ? { locationId, recurringSeriesId }
      : { locationId, _id: sessionId };
    const result = await NapSession.deleteMany(filter);

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: recurringSeriesId
        ? "DELETE_NAP_SERIES"
        : "DELETE_NAP_SESSION",
      entityType: "NAP_SESSION",
      entityId: recurringSeriesId || sessionId || "",
      summary: `Removed ${result.deletedCount} nap session(s).`,
      before: { sessionId, recurringSeriesId },
    });

    return NextResponse.json({
      success: true,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("Failed to delete nap session:", error);

    return NextResponse.json(
      { error: "Nap session could not be removed." },
      { status: 500 }
    );
  }
}
