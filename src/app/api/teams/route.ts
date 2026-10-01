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

type TeamRequest = {
  locationId?: string;
  name?: string;
  color?: string;
};

function serializeTeam(team: Record<string, unknown>) {
  return {
    ...team,
    id: String(team._id),
    _id: undefined,
    locationId: String(team.locationId),
  };
}

export async function GET(request: Request) {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  const url = new URL(request.url);
  const locationId = url.searchParams.get("locationId");

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

    const teams = await Team.find({
      locationId,
      active: true,
    })
      .sort({ name: 1 })
      .lean();

    return NextResponse.json({
      teams: teams.map((team) =>
        serializeTeam(team as unknown as Record<string, unknown>)
      ),
    });
  } catch (error) {
    console.error("Failed to load teams:", error);

    return NextResponse.json(
      { error: "Teams could not be loaded." },
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
    const body = (await request.json()) as TeamRequest;
    const locationId = body.locationId?.trim();
    const name = body.name?.trim();

    if (!locationId || !name) {
      return NextResponse.json(
        { error: "Location and team name are required." },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    await connectToDatabase();

    const existingTeam = await Team.findOne({
      locationId,
      name,
      active: true,
    });

    if (existingTeam) {
      return NextResponse.json(
        { error: "A team with this name already exists at this location." },
        { status: 409 }
      );
    }

    const team = await Team.create({
      locationId,
      name,
      color: body.color || "#DCE9F8",
      active: true,
    });

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: "CREATE",
      entityType: "TEAM",
      entityId: String(team._id),
      summary: `Created team ${name}.`,
      after: team.toObject(),
    });

    return NextResponse.json(
      {
        team: serializeTeam(
          team.toObject() as unknown as Record<string, unknown>
        ),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to create team:", error);

    return NextResponse.json(
      { error: "Team could not be created." },
      { status: 500 }
    );
  }
}
