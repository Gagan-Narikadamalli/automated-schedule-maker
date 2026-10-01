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

type ClientRequest = {
  locationId?: string;
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
  attendancePatterns?: TimePatternRequest[];
  napPatterns?: TimePatternRequest[];
  staffRelationships?: StaffRelationshipRequest[];
};

function serializeClient(client: Record<string, unknown>) {
  return {
    ...client,
    id: String(client._id),
    _id: undefined,
    locationId: String(client.locationId),
    teamId: client.teamId ? String(client.teamId) : null,
    assignedBcbaId: client.assignedBcbaId
      ? String(client.assignedBcbaId)
      : null,
    assignedInternIds: Array.isArray(client.assignedInternIds)
      ? client.assignedInternIds.map((internId) => String(internId))
      : [],
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

    const clients = await Client.find({
      locationId,
      ...(includeArchived ? {} : { active: true }),
    })
      .sort({ active: -1, displayCode: 1 })
      .lean();

    return NextResponse.json({
      clients: clients.map((client) =>
        serializeClient(client as unknown as Record<string, unknown>)
      ),
    });
  } catch (error) {
    console.error("Failed to load clients:", error);

    return NextResponse.json(
      { error: "Clients could not be loaded." },
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
    const body = (await request.json()) as ClientRequest;
    const locationId = body.locationId?.trim();
    const fullName = body.fullName?.trim();
    const displayCode = body.displayCode?.trim();

    if (!locationId || !fullName || !displayCode || !body.startDate) {
      return NextResponse.json(
        {
          error:
            "Location, client name, calendar display code, and start date are required.",
        },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    await connectToDatabase();

    const duplicate = await Client.findOne({
      locationId,
      displayCode,
      active: true,
    });

    if (duplicate) {
      return NextResponse.json(
        {
          error:
            "An active client with this calendar display code already exists at the selected location.",
        },
        { status: 409 }
      );
    }

    const client = await Client.create({
      locationId,
      fullName,
      displayCode,
      startDate: new Date(body.startDate),
      endDate: body.endDate ? new Date(body.endDate) : null,
      teamId: body.teamId || null,
      color: body.color || "#D9F4EE",
      serviceSetting: body.serviceSetting || "IN_CENTER",
      supportLevel: body.supportLevel || "ONE_TO_ONE",
      insurancePlan: body.insurancePlan?.trim() || "",
      assignedBcbaId: body.assignedBcbaId || null,
      assignedInternIds: body.assignedInternIds ?? [],
      attendancePatterns: body.attendancePatterns ?? [],
      napPatterns: body.napPatterns ?? [],
      staffRelationships: body.staffRelationships ?? [],
      active: true,
    });

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: "CREATE",
      entityType: "CLIENT",
      entityId: String(client._id),
      summary: `Added client ${displayCode}.`,
      after: client.toObject(),
    });

    return NextResponse.json(
      {
        client: serializeClient(
          client.toObject() as unknown as Record<string, unknown>
        ),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to create client:", error);

    return NextResponse.json(
      { error: "Client could not be created." },
      { status: 500 }
    );
  }
}
