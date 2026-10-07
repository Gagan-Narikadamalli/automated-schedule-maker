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
  maxConsecutiveBlocksWithSameStaff?: number | null;
  desiredDifferentStaffPerDay?: number | null;
  insurancePlan?: string;
  assignedBcbaId?: string | null;
  assignedInternIds?: string[];
  attendancePatterns?: TimePatternRequest[];
  napPatterns?: TimePatternRequest[];
  staffRelationships?: StaffRelationshipRequest[];
};

function calendarCodePart(value: string): string {
  const letters = value.trim().replace(/[^A-Za-z]/g, "");
  if (!letters) return "";
  return letters.charAt(0).toUpperCase() + letters.charAt(1).toLowerCase();
}

function displayCodeFromFullName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? "";
  const lastName = parts.slice(1).join(" ");
  return `${calendarCodePart(firstName)}${calendarCodePart(lastName)}`;
}

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
    const displayCode = fullName ? displayCodeFromFullName(fullName) : "";

    if (!locationId || !fullName || !body.startDate) {
      return NextResponse.json(
        {
          error:
            "Location, client first name, client last name, and start date are required.",
        },
        { status: 400 }
      );
    }

    const nameParts = fullName.split(/\s+/).filter(Boolean);
    if (nameParts.length < 2) {
      return NextResponse.json(
        {
          error:
            "Enter both the client's first name and last name.",
        },
        { status: 400 }
      );
    }

    if (displayCode.length < 4) {
      return NextResponse.json(
        {
          error:
            "Client first and last names must each contain at least two letters so the calendar code can be generated.",
        },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    const maxConsecutiveBlocksWithSameStaff = readOptionalPositiveInteger(
      body.maxConsecutiveBlocksWithSameStaff,
      20
    );
    const desiredDifferentStaffPerDay = readOptionalPositiveInteger(
      body.desiredDifferentStaffPerDay,
      20
    );

    if (
      maxConsecutiveBlocksWithSameStaff === "INVALID" ||
      desiredDifferentStaffPerDay === "INVALID"
    ) {
      return NextResponse.json(
        {
          error:
            "Rotation settings must be whole numbers between 1 and 20, or left blank to use the automatic support-level defaults.",
        },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const serviceSetting = body.serviceSetting || "IN_CENTER";
    const duplicate = await Client.findOne({
      locationId,
      displayCode,
      serviceSetting,
      active: true,
    });

    if (duplicate) {
      return NextResponse.json(
        {
          error:
            "An active client with this calendar display code already exists for the same client type at this location.",
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
      serviceSetting,
      supportLevel: body.supportLevel || "ONE_TO_ONE",
      maxConsecutiveBlocksWithSameStaff,
      desiredDifferentStaffPerDay,
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
