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
import { Client } from "@/models/Client";

type TimePatternRequest = {
  name: string;
  days: string[];
  startTime: string;
  endTime: string;
};

type StaffRelationshipRequest = {
  staffId: string;
  relationship: "PREFERRED" | "ALLOWED" | "HARD_RESTRICTION";
};

type ClientUpdateRequest = {
  fullName?: string;
  displayCode?: string;
  startDate?: string;
  endDate?: string | null;
  teamId?: string | null;
  color?: string;
  serviceSetting?: "IN_CENTER" | "IN_HOME" | "BOTH";
  supportLevel?: "STANDARD" | "ONE_TO_ONE" | "ROTATION" | "HIGH_SUPPORT";
  maxConsecutiveBlocksWithSameStaff?: number | null;
  desiredDifferentStaffPerDay?: number | null;
  insurancePlan?: string;
  assignedBcbaId?: string | null;
  assignedInternIds?: string[];
  attendancePatterns?: TimePatternRequest[];
  napPatterns?: TimePatternRequest[];
  staffRelationships?: StaffRelationshipRequest[];
  active?: boolean;
};

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function readOptionalPositiveInteger(
  value: number | null | undefined,
  maximum: number
): number | null | "INVALID" {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    return "INVALID";
  }

  return value;
}

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
    const body = (await request.json()) as ClientUpdateRequest;

    await connectToDatabase();

    const client = await Client.findById(id);

    if (!client) {
      return NextResponse.json(
        { error: "Client was not found." },
        { status: 404 }
      );
    }

    const locationId = String(client.locationId);

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    const before = client.toObject();

    if (body.fullName !== undefined) {
      client.fullName = body.fullName.trim();
    }

    if (body.displayCode !== undefined) {
      const displayCode = body.displayCode.trim();

      const duplicate = await Client.findOne({
        _id: { $ne: client._id },
        locationId,
        displayCode,
        active: true,
      });

      if (duplicate) {
        return NextResponse.json(
          {
            error:
              "Another active client already uses this calendar display code at this location.",
          },
          { status: 409 }
        );
      }

      client.displayCode = displayCode;
    }

    if (body.startDate !== undefined) {
      client.startDate = new Date(body.startDate);
    }

    if (body.endDate !== undefined) {
      client.endDate = body.endDate ? new Date(body.endDate) : null;
    }

    if (body.teamId !== undefined) {
      client.teamId = body.teamId || null;
    }

    if (body.color !== undefined) {
      client.color = body.color;
    }

    if (body.serviceSetting !== undefined) {
      client.serviceSetting = body.serviceSetting;
    }

    if (body.supportLevel !== undefined) {
      client.supportLevel = body.supportLevel;
    }

    if (body.maxConsecutiveBlocksWithSameStaff !== undefined) {
      const value = readOptionalPositiveInteger(
        body.maxConsecutiveBlocksWithSameStaff,
        20
      );

      if (value === "INVALID") {
        return NextResponse.json(
          {
            error:
              "Maximum consecutive blocks must be a whole number between 1 and 20, or blank for the automatic default.",
          },
          { status: 400 }
        );
      }

      client.maxConsecutiveBlocksWithSameStaff = value;
    }

    if (body.desiredDifferentStaffPerDay !== undefined) {
      const value = readOptionalPositiveInteger(
        body.desiredDifferentStaffPerDay,
        20
      );

      if (value === "INVALID") {
        return NextResponse.json(
          {
            error:
              "Desired staff per day must be a whole number between 1 and 20, or blank for the automatic default.",
          },
          { status: 400 }
        );
      }

      client.desiredDifferentStaffPerDay = value;
    }

    if (body.insurancePlan !== undefined) {
      client.insurancePlan = body.insurancePlan.trim();
    }

    if (body.assignedBcbaId !== undefined) {
      client.assignedBcbaId = body.assignedBcbaId || null;
    }

    if (body.assignedInternIds !== undefined) {
      client.assignedInternIds = body.assignedInternIds;
    }

    if (body.attendancePatterns !== undefined) {
      client.attendancePatterns = body.attendancePatterns;
    }

    if (body.napPatterns !== undefined) {
      client.napPatterns = body.napPatterns;
    }

    if (body.staffRelationships !== undefined) {
      client.staffRelationships = body.staffRelationships;
    }

    if (body.active !== undefined) {
      client.active = body.active;
    }

    await client.save();

    const after = client.toObject();

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: body.active === false ? "ARCHIVE" : "UPDATE",
      entityType: "CLIENT",
      entityId: String(client._id),
      summary:
        body.active === false
          ? `Archived client ${client.displayCode}.`
          : `Updated client ${client.displayCode}.`,
      before,
      after,
    });

    return NextResponse.json({
      client: {
        ...after,
        id: String(client._id),
        _id: undefined,
        locationId,
        teamId: client.teamId ? String(client.teamId) : null,
        assignedBcbaId: client.assignedBcbaId
          ? String(client.assignedBcbaId)
          : null,
        assignedInternIds: client.assignedInternIds.map(
          (internId: unknown) => String(internId)
        ),
      },
    });
  } catch (error) {
    console.error("Failed to update client:", error);

    return NextResponse.json(
      { error: "Client could not be updated." },
      { status: 500 }
    );
  }
}
