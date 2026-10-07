import { NextResponse } from "next/server";

import {
  forbiddenResponse,
  PEOPLE_WRITE_ROLES,
  requireApiSession,
  sessionCanAccessLocation,
  sessionHasAnyRole,
} from "@/lib/api/auth";
import { writeAuditLog } from "@/lib/api/audit";
import { connectToDatabase } from "@/lib/db";
import { Staff } from "@/models/Staff";

type StaffRequest = {
  locationId?: string;
  fullName?: string;
  startDate?: string;
  endDate?: string | null;
  role?: "BT" | "RBT" | "INTERN" | "BCBA" | "OFFICE_MANAGER" | "OTHER";
  employeeType?: "FULL_TIME" | "PART_TIME";
  teamId?: string | null;
  color?: string;
  serviceSetting?: "IN_CENTER" | "IN_HOME" | "BOTH";
  minimumWeeklyHours?: number;
  targetWeeklyHours?: number;
  maximumWeeklyHours?: number;
  shiftPatterns?: Array<{
    name: string;
    days: string[];
    startTime: string;
    endTime: string;
  }>;
};

function serializeStaff(staffMember: Record<string, unknown>) {
  return {
    ...staffMember,
    id: String(staffMember._id),
    _id: undefined,
    locationId: String(staffMember.locationId),
    teamId: staffMember.teamId ? String(staffMember.teamId) : null,
  };
}

export async function GET(request: Request) {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  const url = new URL(request.url);
  const locationId = url.searchParams.get("locationId");
  const includeArchived = url.searchParams.get("includeArchived") === "true";

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

    const staff = await Staff.find({
      locationId,
      ...(includeArchived ? {} : { active: true }),
    })
      .sort({ active: -1, fullName: 1 })
      .lean();

    return NextResponse.json({
      staff: staff.map((staffMember) =>
        serializeStaff(staffMember as unknown as Record<string, unknown>)
      ),
    });
  } catch (error) {
    console.error("Failed to load staff:", error);

    return NextResponse.json(
      { error: "Staff could not be loaded." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  if (!sessionHasAnyRole(auth.session, PEOPLE_WRITE_ROLES)) {
    return forbiddenResponse();
  }

  try {
    const body = (await request.json()) as StaffRequest;
    const locationId = body.locationId?.trim();
    const fullName = body.fullName?.trim();

    if (!locationId || !fullName || !body.startDate || !body.role || !body.employeeType) {
      return NextResponse.json(
        {
          error:
            "Location, full name, start date, role, and employee type are required.",
        },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    if (!Array.isArray(body.shiftPatterns) || body.shiftPatterns.length === 0) {
      return NextResponse.json(
        {
          error:
            "At least one working-hours pattern is required before creating a staff member.",
        },
        { status: 400 }
      );
    }

    const minimumWeeklyHours = Number(body.minimumWeeklyHours ?? 0);
    const targetWeeklyHours = Number(body.targetWeeklyHours ?? minimumWeeklyHours);
    const maximumWeeklyHours = Number(body.maximumWeeklyHours ?? 40);

    if (
      minimumWeeklyHours < 0 ||
      targetWeeklyHours < 0 ||
      maximumWeeklyHours < minimumWeeklyHours ||
      targetWeeklyHours > maximumWeeklyHours
    ) {
      return NextResponse.json(
        {
          error:
            "Weekly hour values are invalid. Target must be between minimum and maximum.",
        },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const staffMember = await Staff.create({
      locationId,
      fullName,
      startDate: new Date(body.startDate),
      endDate: body.endDate ? new Date(body.endDate) : null,
      role: body.role,
      employeeType: body.employeeType,
      teamId: body.teamId || null,
      color: body.color || "#DCE9F8",
      serviceSetting: body.serviceSetting || "IN_CENTER",
      minimumWeeklyHours,
      targetWeeklyHours,
      maximumWeeklyHours,
      shiftPatterns: body.shiftPatterns ?? [],
      active: true,
    });

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: "CREATE",
      entityType: "STAFF",
      entityId: String(staffMember._id),
      summary: `Added staff member ${fullName}.`,
      after: staffMember.toObject(),
    });

    return NextResponse.json(
      {
        staffMember: serializeStaff(
          staffMember.toObject() as unknown as Record<string, unknown>
        ),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to create staff member:", error);

    return NextResponse.json(
      { error: "Staff member could not be created." },
      { status: 500 }
    );
  }
}
