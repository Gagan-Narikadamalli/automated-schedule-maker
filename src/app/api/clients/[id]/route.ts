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

type ClientUpdateRequest = {
  fullName?: string;
  displayCode?: string;
  startDate?: string;
  endDate?: string | null;
  teamId?: string | null;
  color?: string;
  serviceSetting?: "IN_CENTER" | "IN_HOME" | "BOTH";
  supportLevel?: "STANDARD" | "ONE_TO_ONE" | "ROTATION" | "HIGH_SUPPORT";
  insurancePlan?: string;
  assignedBcbaId?: string | null;
  assignedInternIds?: string[];
  attendancePatterns?: Array<{
    name: string;
    days: string[];
    startTime: string;
    endTime: string;
  }>;
  staffRelationships?: Array<{
    staffId: string;
    relationship: "PREFERRED" | "ALLOWED" | "HARD_RESTRICTION";
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
