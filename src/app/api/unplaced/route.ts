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
import { UnplacedAssignment } from "@/models/UnplacedAssignment";

type CreateRequest = {
  locationId?: string;
  date?: string;
  clientId?: string | null;
  displayText?: string;
  originalStaffId?: string | null;
  originalStartTime?: string;
  reason?: string;
};

type ResolveRequest = {
  locationId?: string;
  unplacedId?: string;
};

type PlainRecord = Record<string, any>;

function serializeRecord(record: PlainRecord) {
  const client =
    record.clientId && typeof record.clientId === "object"
      ? record.clientId
      : null;

  return {
    id: String(record._id),
    locationId: String(record.locationId),
    date: String(record.date),
    clientId: client
      ? String(client._id ?? client.id ?? "")
      : record.clientId
        ? String(record.clientId)
        : null,
    clientCode: client?.displayCode ? String(client.displayCode) : null,
    clientColor: client?.color ? String(client.color) : null,
    displayText: String(record.displayText ?? ""),
    originalStaffId: record.originalStaffId
      ? String(record.originalStaffId)
      : null,
    originalStartTime: String(record.originalStartTime ?? ""),
    reason: String(record.reason ?? ""),
    status: String(record.status ?? "UNPLACED"),
    createdAt: record.createdAt,
  };
}

export async function GET(request: Request) {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  const url = new URL(request.url);
  const locationId = url.searchParams.get("locationId");
  const date = url.searchParams.get("date");

  if (!locationId || !date) {
    return NextResponse.json(
      { error: "locationId and date are required." },
      { status: 400 }
    );
  }

  if (!sessionCanAccessLocation(auth.session, locationId)) {
    return forbiddenResponse("You do not have access to this location.");
  }

  try {
    await connectToDatabase();

    const records = await UnplacedAssignment.find({
      locationId,
      date,
      status: "UNPLACED",
    })
      .populate("clientId", "displayCode fullName color")
      .sort({ createdAt: 1 })
      .lean();

    return NextResponse.json({
      unplacedAssignments: (records as unknown as PlainRecord[]).map(
        serializeRecord
      ),
    });
  } catch (error) {
    console.error("Failed to load unplaced assignments:", error);

    return NextResponse.json(
      { error: "Unplaced assignments could not be loaded." },
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
    const body = (await request.json()) as CreateRequest;
    const locationId = body.locationId?.trim();
    const date = body.date?.trim();
    const displayText = body.displayText?.trim();
    const originalStartTime = body.originalStartTime?.trim();

    if (!locationId || !date || !displayText || !originalStartTime) {
      return NextResponse.json(
        {
          error:
            "Location, date, assignment text, and original start time are required.",
        },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    await connectToDatabase();

    const record = await UnplacedAssignment.create({
      locationId,
      date,
      clientId: body.clientId || null,
      displayText,
      originalStaffId: body.originalStaffId || null,
      originalStartTime,
      reason:
        body.reason?.trim() || "Displaced by a manager schedule change.",
      status: "UNPLACED",
      createdBy: auth.session.userId,
    });

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: "CREATE_UNPLACED",
      entityType: "UNPLACED_ASSIGNMENT",
      entityId: String(record._id),
      summary: `${displayText} moved to the Unplaced Assignments tray.`,
      after: record.toObject(),
    });

    return NextResponse.json(
      {
        unplacedAssignment: serializeRecord(
          record.toObject() as unknown as PlainRecord
        ),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to create unplaced assignment:", error);

    return NextResponse.json(
      { error: "The displaced assignment could not be saved to the tray." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  if (!sessionHasAnyRole(auth.session, SCHEDULE_WRITE_ROLES)) {
    return forbiddenResponse();
  }

  try {
    const body = (await request.json()) as ResolveRequest;
    const locationId = body.locationId?.trim();
    const unplacedId = body.unplacedId?.trim();

    if (!locationId || !unplacedId) {
      return NextResponse.json(
        { error: "Location and unplaced assignment are required." },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    await connectToDatabase();

    const record = await UnplacedAssignment.findOneAndUpdate(
      {
        _id: unplacedId,
        locationId,
        status: "UNPLACED",
      },
      {
        $set: {
          status: "RESOLVED",
          resolvedBy: auth.session.userId,
          resolvedAt: new Date(),
        },
      },
      { new: true }
    );

    if (!record) {
      return NextResponse.json(
        { error: "The unplaced assignment was not found." },
        { status: 404 }
      );
    }

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: "RESOLVE_UNPLACED",
      entityType: "UNPLACED_ASSIGNMENT",
      entityId: unplacedId,
      summary: `Resolved unplaced assignment ${record.displayText}.`,
      after: record.toObject(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to resolve unplaced assignment:", error);

    return NextResponse.json(
      { error: "The unplaced assignment could not be resolved." },
      { status: 500 }
    );
  }
}
