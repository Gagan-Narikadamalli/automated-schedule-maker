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
import { Team } from "@/models/Team";

type TeamUpdateRequest = {
  name?: string;
  color?: string;
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
    const body = (await request.json()) as TeamUpdateRequest;

    await connectToDatabase();

    const team = await Team.findById(id);

    if (!team) {
      return NextResponse.json(
        { error: "Team was not found." },
        { status: 404 }
      );
    }

    const locationId = String(team.locationId);

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    const before = team.toObject();

    if (body.name !== undefined) {
      const name = body.name.trim();

      const duplicate = await Team.findOne({
        _id: { $ne: team._id },
        locationId,
        name,
        active: true,
      });

      if (duplicate) {
        return NextResponse.json(
          { error: "Another active team already uses this name." },
          { status: 409 }
        );
      }

      team.name = name;
    }

    if (body.color !== undefined) {
      team.color = body.color;
    }

    if (body.active !== undefined) {
      team.active = body.active;
    }

    await team.save();

    const after = team.toObject();

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: body.active === false ? "ARCHIVE" : "UPDATE",
      entityType: "TEAM",
      entityId: String(team._id),
      summary:
        body.active === false
          ? `Archived team ${team.name}.`
          : `Updated team ${team.name}.`,
      before,
      after,
    });

    return NextResponse.json({
      team: {
        ...after,
        id: String(team._id),
        _id: undefined,
        locationId,
      },
    });
  } catch (error) {
    console.error("Failed to update team:", error);

    return NextResponse.json(
      { error: "Team could not be updated." },
      { status: 500 }
    );
  }
}
