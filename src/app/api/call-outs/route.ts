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

type SaveCallOutSelectionRequest = {
  locationId?: string;
  date?: string;
  staffIds?: string[];
};

function referenceId(value: unknown): string {
  if (value && typeof value === "object" && "_id" in value) {
    return String((value as { _id?: unknown })._id ?? "");
  }

  return value ? String(value) : "";
}

function serializeCallOut(callOut: Record<string, unknown>) {
  return {
    ...callOut,
    id: String(callOut._id),
    _id: undefined,
    locationId: referenceId(callOut.locationId),
    staffId: referenceId(callOut.staffId),
    createdByUserId: String(callOut.createdByUserId ?? ""),
  };
}

function normalizeCallOutEndTime(
  requestedEndTime: string,
  reason: string
): string {
  const normalizedReason = reason.trim().toLowerCase();

  if (
    requestedEndTime === "18:00" &&
    (normalizedReason === "call out" ||
      normalizedReason === "call-out" ||
      normalizedReason === "callout")
  ) {
    return "20:00";
  }

  return requestedEndTime;
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

    const selectedStaffIds = Array.from(
      new Set(
        callOuts
          .map((callOut) => referenceId(callOut.staffId))
          .filter(Boolean)
      )
    );

    return NextResponse.json({
      selectedStaffIds,
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

export async function PUT(request: Request) {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  if (!sessionHasAnyRole(auth.session, SCHEDULE_WRITE_ROLES)) {
    return forbiddenResponse();
  }

  try {
    const body = (await request.json()) as SaveCallOutSelectionRequest;
    const locationId = body.locationId?.trim();
    const date = body.date?.trim();
    const selectedStaffIds = Array.from(
      new Set(
        (body.staffIds ?? [])
          .map((staffId) => staffId.trim())
          .filter(Boolean)
      )
    );

    if (!locationId || !date) {
      return NextResponse.json(
        { error: "Location and date are required." },
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

    await connectToDatabase();

    if (selectedStaffIds.length > 0) {
      const validStaff = await Staff.find({
        _id: { $in: selectedStaffIds },
        locationId,
        active: true,
      })
        .select("_id")
        .lean();

      if (validStaff.length !== selectedStaffIds.length) {
        return NextResponse.json(
          {
            error:
              "One or more selected staff members are no longer active at this location. Refresh the schedule and try again.",
          },
          { status: 400 }
        );
      }
    }

    const beforeCallOuts = await CallOut.find({ locationId, date }).lean();
    const beforeStaffIds = new Set(
      beforeCallOuts.map((callOut) => String(callOut.staffId))
    );

    if (selectedStaffIds.length === 0) {
      await CallOut.deleteMany({ locationId, date });
    } else {
      await CallOut.deleteMany({
        locationId,
        date,
        staffId: { $nin: selectedStaffIds },
      });
    }

    for (const staffId of selectedStaffIds) {
      const existingCallOut = await CallOut.findOne({
        locationId,
        date,
        staffId,
      }).sort({ createdAt: 1 });

      if (existingCallOut) {
        existingCallOut.startTime = "08:00";
        existingCallOut.endTime = "20:00";
        existingCallOut.reason = "Call out";
        await existingCallOut.save();

        await CallOut.deleteMany({
          locationId,
          date,
          staffId,
          _id: { $ne: existingCallOut._id },
        });
      } else {
        await CallOut.create({
          locationId,
          staffId,
          date,
          startTime: "08:00",
          endTime: "20:00",
          reason: "Call out",
          note: "",
          createdByUserId: auth.session.userId,
        });
      }
    }

    const afterCallOuts = await CallOut.find({ locationId, date })
      .sort({ startTime: 1 })
      .lean();
    const afterStaffIds = Array.from(
      new Set(afterCallOuts.map((callOut) => String(callOut.staffId)))
    );
    const afterStaffSet = new Set(afterStaffIds);
    const addedCount = afterStaffIds.filter(
      (staffId) => !beforeStaffIds.has(staffId)
    ).length;
    const removedCount = Array.from(beforeStaffIds).filter(
      (staffId) => !afterStaffSet.has(staffId)
    ).length;

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: "SYNC",
      entityType: "CALL_OUT_DAY",
      entityId: date,
      summary: `Updated saved call-outs for ${date}: ${afterStaffIds.length} staff member(s) marked out.`,
      before: beforeCallOuts,
      after: afterCallOuts,
    });

    return NextResponse.json({
      success: true,
      selectedStaffIds: afterStaffIds,
      addedCount,
      removedCount,
      callOuts: afterCallOuts.map((callOut) =>
        serializeCallOut(callOut as unknown as Record<string, unknown>)
      ),
    });
  } catch (error) {
    console.error("Failed to save call-out selections:", error);

    return NextResponse.json(
      { error: "Call-out selections could not be saved." },
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
    const reason = body.reason?.trim() || "";
    const startTime = body.startTime?.trim() || "08:00";
    const requestedEndTime = body.endTime?.trim() || "20:00";
    const endTime = normalizeCallOutEndTime(
      requestedEndTime,
      reason
    );

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

    const existingCallOut = await CallOut.findOne({
      locationId,
      staffId,
      date,
    });

    const callOut = existingCallOut
      ? await CallOut.findByIdAndUpdate(
          existingCallOut._id,
          {
            $set: {
              startTime,
              endTime,
              reason,
              note: body.note?.trim() || existingCallOut.note || "",
            },
          },
          { new: true, runValidators: true }
        )
      : await CallOut.create({
          locationId,
          staffId,
          date,
          startTime,
          endTime,
          reason,
          note: body.note?.trim() || "",
          createdByUserId: auth.session.userId,
        });

    if (!callOut) {
      return NextResponse.json(
        { error: "Call-out could not be saved." },
        { status: 500 }
      );
    }

    await CallOut.deleteMany({
      locationId,
      staffId,
      date,
      _id: { $ne: callOut._id },
    });

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: existingCallOut ? "UPDATE" : "CREATE",
      entityType: "CALL_OUT",
      entityId: String(callOut._id),
      summary: `Recorded a call-out for ${staffMember.fullName} on ${date}.`,
      before: existingCallOut?.toObject() ?? null,
      after: callOut.toObject(),
    });

    return NextResponse.json(
      {
        callOut: serializeCallOut(
          callOut.toObject() as unknown as Record<string, unknown>
        ),
      },
      { status: existingCallOut ? 200 : 201 }
    );
  } catch (error) {
    console.error("Failed to create call-out:", error);

    return NextResponse.json(
      { error: "Call-out could not be created." },
      { status: 500 }
    );
  }
}
