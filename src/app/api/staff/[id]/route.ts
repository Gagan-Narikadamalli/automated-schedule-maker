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

type StaffUpdateRequest = {
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
  active?: boolean;
};

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  if (!sessionHasAnyRole(auth.session, PEOPLE_WRITE_ROLES)) {
    return forbiddenResponse();
  }

  try {
    const { id } = await context.params;
    const body = (await request.json()) as StaffUpdateRequest;

    await connectToDatabase();

    const staffMember = await Staff.findById(id);

    if (!staffMember) {
      return NextResponse.json(
        { error: "Staff member was not found." },
        { status: 404 }
      );
    }

    const locationId = String(staffMember.locationId);

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    const before = staffMember.toObject();

    if (body.fullName !== undefined) {
      staffMember.fullName = body.fullName.trim();
    }

    if (body.startDate !== undefined) {
      staffMember.startDate = new Date(body.startDate);
    }

    if (body.endDate !== undefined) {
      staffMember.endDate = body.endDate ? new Date(body.endDate) : null;
    }

    if (body.role !== undefined) {
      staffMember.role = body.role;
    }

    if (body.employeeType !== undefined) {
      staffMember.employeeType = body.employeeType;
    }

    if (body.teamId !== undefined) {
      staffMember.teamId = body.teamId || null;
    }

    if (body.color !== undefined) {
      staffMember.color = body.color;
    }

    if (body.serviceSetting !== undefined) {
      staffMember.serviceSetting = body.serviceSetting;
    }

    if (body.minimumWeeklyHours !== undefined) {
      staffMember.minimumWeeklyHours = Number(body.minimumWeeklyHours);
    }

    if (body.targetWeeklyHours !== undefined) {
      staffMember.targetWeeklyHours = Number(body.targetWeeklyHours);
    }

    if (body.maximumWeeklyHours !== undefined) {
      staffMember.maximumWeeklyHours = Number(body.maximumWeeklyHours);
    }

    if (body.shiftPatterns !== undefined) {
      staffMember.shiftPatterns = body.shiftPatterns;
    }

    if (body.active !== undefined) {
      staffMember.active = body.active;
    }

    if (
      staffMember.minimumWeeklyHours < 0 ||
      staffMember.targetWeeklyHours < staffMember.minimumWeeklyHours ||
      staffMember.maximumWeeklyHours < staffMember.targetWeeklyHours
    ) {
      return NextResponse.json(
        {
          error:
            "Weekly hour values are invalid. Minimum <= target <= maximum is required.",
        },
        { status: 400 }
      );
    }

    await staffMember.save();

    const after = staffMember.toObject();

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: body.active === false ? "ARCHIVE" : "UPDATE",
      entityType: "STAFF",
      entityId: String(staffMember._id),
      summary:
        body.active === false
          ? `Archived staff member ${staffMember.fullName}.`
          : `Updated staff member ${staffMember.fullName}.`,
      before,
      after,
    });

    return NextResponse.json({
      staffMember: {
        ...after,
        id: String(staffMember._id),
        _id: undefined,
        locationId,
        teamId: staffMember.teamId ? String(staffMember.teamId) : null,
      },
    });
  } catch (error) {
    console.error("Failed to update staff member:", error);

    return NextResponse.json(
      { error: "Staff member could not be updated." },
      { status: 500 }
    );
  }
}
