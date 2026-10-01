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
import { CallOut } from "@/models/CallOut";
import { Staff } from "@/models/Staff";

type CallOutRequest = {
  locationId?: string;
  staffId?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  reason?: string;
  note?: string;
};

function serializeCallOut(callOut: Record<string, unknown>) {
  return {
    ...callOut,
    id: String(callOut._id),
    _id: undefined,
    locationId: String(callOut.locationId),
    staffId: String(callOut.staffId),
    createdByUserId: String(callOut.createdByUserId),
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

    const callOuts = await CallOut.find({ locationId, date })
      .populate("staffId", "fullName role color")
      .sort({ startTime: 1 })
      .lean();

    return NextResponse.json({
      callOuts: callOuts.map((callOut) => ({
        ...serializeCallOut(callOut as unknown as Record<string, unknown>),
        staff:
          typeof callOut.staffId === "object" && callOut.staffId
            ? callOut.staffId
            : null,
      })),
    });
  } catch (error) {
    console.error("Failed to load call-outs:", error);

    return NextResponse.json(
      { error: "Call-outs could not be loaded." },
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
    const body = (await request.json()) as CallOutRequest;
    const locationId = body.locationId?.trim();
    const staffId = body.staffId?.trim();
    const date = body.date?.trim();
    const startTime = body.startTime?.trim() || "08:00";
    const endTime = body.endTime?.trim() || "18:00";

    if (!locationId || !staffId || !date) {
      return NextResponse.json(
        { error: "Location, staff member, and date are required." },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    if (endTime <= startTime) {
      return NextResponse.json(
        { error: "Call-out end time must be later than the start time." },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const staffMember = await Staff.findOne({
      _id: staffId,
      locationId,
      active: true,
    });

    if (!staffMember) {
      return NextResponse.json(
        { error: "The selected active staff member was not found at this location." },
        { status: 404 }
      );
    }

    const callOut = await CallOut.create({
      locationId,
      staffId,
      date,
      startTime,
      endTime,
      reason: body.reason?.trim() || "",
      note: body.note?.trim() || "",
      createdByUserId: auth.session.userId,
    });

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: "CREATE",
      entityType: "CALL_OUT",
      entityId: String(callOut._id),
      summary: `Recorded a call-out for ${staffMember.fullName} on ${date}.`,
      after: callOut.toObject(),
    });

    return NextResponse.json(
      {
        callOut: serializeCallOut(
          callOut.toObject() as unknown as Record<string, unknown>
        ),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to create call-out:", error);

    return NextResponse.json(
      { error: "Call-out could not be created." },
      { status: 500 }
    );
  }
}
