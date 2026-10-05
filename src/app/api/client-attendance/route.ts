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
import { ClientAttendanceException } from "@/models/ClientAttendanceException";

type ChangeType = "CALL_OUT" | "CALL_IN";

type SaveRequest = {
  locationId?: string;
  clientId?: string;
  date?: string;
  changeType?: ChangeType;
  startTime?: string;
  endTime?: string;
  note?: string;
};

type DeleteRequest = {
  locationId?: string;
  exceptionId?: string;
};

type PlainRecord = Record<string, any>;

function serializeException(record: PlainRecord) {
  const client = record.clientId && typeof record.clientId === "object" ? record.clientId : null;

  return {
    id: String(record._id),
    locationId: String(record.locationId),
    clientId: client ? String(client._id ?? client.id ?? "") : String(record.clientId ?? ""),
    client: client
      ? {
          id: String(client._id ?? client.id ?? ""),
          displayCode: String(client.displayCode ?? ""),
          fullName: String(client.fullName ?? ""),
          color: String(client.color ?? "#D9F4EE"),
        }
      : null,
    date: String(record.date),
    changeType: record.changeType === "CALL_IN" ? "CALL_IN" : "CALL_OUT",
    startTime: String(record.startTime),
    endTime: String(record.endTime),
    note: String(record.note ?? ""),
  };
}

export async function GET(request: Request) {
  const auth = await requireApiSession();
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const locationId = url.searchParams.get("locationId");
  const date = url.searchParams.get("date");

  if (!locationId || !date) {
    return NextResponse.json({ error: "locationId and date are required." }, { status: 400 });
  }

  if (!sessionCanAccessLocation(auth.session, locationId)) {
    return forbiddenResponse("You do not have access to this location.");
  }

  try {
    await connectToDatabase();
    const records = await ClientAttendanceException.find({ locationId, date })
      .populate("clientId", "displayCode fullName color")
      .sort({ startTime: 1 })
      .lean();

    return NextResponse.json({
      attendanceChanges: (records as unknown as PlainRecord[]).map(serializeException),
    });
  } catch (error) {
    console.error("Failed to load client attendance changes:", error);
    return NextResponse.json({ error: "Client attendance changes could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireApiSession();
  if (auth.error) return auth.error;
  if (!sessionHasAnyRole(auth.session, SCHEDULE_WRITE_ROLES)) return forbiddenResponse();

  try {
    const body = (await request.json()) as SaveRequest;
    const locationId = body.locationId?.trim();
    const clientId = body.clientId?.trim();
    const date = body.date?.trim();
    const changeType: ChangeType = body.changeType === "CALL_IN" ? "CALL_IN" : "CALL_OUT";
    const startTime = body.startTime?.trim() || "08:00";
    const endTime = body.endTime?.trim() || "18:00";

    if (!locationId || !clientId || !date) {
      return NextResponse.json({ error: "Location, client, and date are required." }, { status: 400 });
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    if (endTime <= startTime) {
      return NextResponse.json({ error: "Attendance end time must be later than start time." }, { status: 400 });
    }

    await connectToDatabase();
    const client = await Client.findOne({ _id: clientId, locationId, active: true });
    if (!client) {
      return NextResponse.json({ error: "The selected active client was not found at this location." }, { status: 404 });
    }

    const before = await ClientAttendanceException.findOne({ locationId, clientId, date }).lean();
    const record = await ClientAttendanceException.findOneAndUpdate(
      { locationId, clientId, date },
      {
        $set: {
          locationId,
          clientId,
          date,
          changeType,
          startTime,
          endTime,
          note: body.note?.trim() || "",
          createdByUserId: auth.session.userId,
        },
      },
      { new: true, upsert: true, runValidators: true }
    );

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: before ? "UPDATE" : "CREATE",
      entityType: "CLIENT_ATTENDANCE_CHANGE",
      entityId: String(record._id),
      summary: `${client.displayCode} marked ${changeType === "CALL_IN" ? "call in" : "call out"} on ${date} from ${startTime} to ${endTime}.`,
      before,
      after: record.toObject(),
    });

    const populated = await ClientAttendanceException.findById(record._id)
      .populate("clientId", "displayCode fullName color")
      .lean();

    return NextResponse.json(
      { attendanceChange: serializeException(populated as unknown as PlainRecord) },
      { status: before ? 200 : 201 }
    );
  } catch (error) {
    console.error("Failed to save client attendance change:", error);
    return NextResponse.json({ error: "Client attendance change could not be saved." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiSession();
  if (auth.error) return auth.error;
  if (!sessionHasAnyRole(auth.session, SCHEDULE_WRITE_ROLES)) return forbiddenResponse();

  try {
    const body = (await request.json()) as DeleteRequest;
    const locationId = body.locationId?.trim();
    const exceptionId = body.exceptionId?.trim();

    if (!locationId || !exceptionId) {
      return NextResponse.json({ error: "Location and attendance change are required." }, { status: 400 });
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    await connectToDatabase();
    const before = await ClientAttendanceException.findOneAndDelete({ _id: exceptionId, locationId });
    if (!before) {
      return NextResponse.json({ error: "Attendance change was not found." }, { status: 404 });
    }

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: "DELETE",
      entityType: "CLIENT_ATTENDANCE_CHANGE",
      entityId: exceptionId,
      summary: "Removed a client attendance call-out/call-in change.",
      before: before.toObject(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete client attendance change:", error);
    return NextResponse.json({ error: "Client attendance change could not be removed." }, { status: 500 });
  }
}
