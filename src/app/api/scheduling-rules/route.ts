import { NextResponse } from "next/server";

import {
  forbiddenResponse,
  requireApiSession,
  SETTINGS_WRITE_ROLES,
  sessionCanAccessLocation,
  sessionHasAnyRole,
} from "@/lib/api/auth";
import { writeAuditLog } from "@/lib/api/audit";
import { connectToDatabase } from "@/lib/db";
import { SchedulingRules } from "@/models/SchedulingRules";

type RulesRequest = {
  locationId?: string;
  fullTimeMinimumWeeklyHours?: number;
  fullTimeMaximumWeeklyHours?: number;
  partTimeMinimumWeeklyHours?: number;
  partTimeMaximumWeeklyHours?: number;
  maximumClientsPerTechPerDay?: number;
  maximumTechsPerClientPerDay?: number;
  defaultBreakMinutes?: number;
  breakWindowStart?: string;
  breakWindowEnd?: string;
  scheduleStartTime?: string;
  scheduleEndTime?: string;
  slotLengthMinutes?: number;
  preferSameTeam?: boolean;
  preferStaffContinuity?: boolean;
  preserveManualOverrides?: boolean;
  supervisionPlanningTargetPercent?: number;
};

function defaultRules(locationId: string) {
  return {
    locationId,
    fullTimeMinimumWeeklyHours: 30,
    fullTimeMaximumWeeklyHours: 40,
    partTimeMinimumWeeklyHours: 0,
    partTimeMaximumWeeklyHours: 29,
    maximumClientsPerTechPerDay: 6,
    maximumTechsPerClientPerDay: 4,
    defaultBreakMinutes: 30,
    breakWindowStart: "11:00",
    breakWindowEnd: "14:00",
    scheduleStartTime: "08:00",
    scheduleEndTime: "18:00",
    slotLengthMinutes: 30,
    preferSameTeam: true,
    preferStaffContinuity: true,
    preserveManualOverrides: true,
    supervisionPlanningTargetPercent: 5,
  };
}

function serializeRules(rules: Record<string, unknown>) {
  return {
    ...rules,
    id: String(rules._id),
    _id: undefined,
    locationId: String(rules.locationId),
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

    let rules = await SchedulingRules.findOne({ locationId }).lean();

    if (!rules) {
      rules = await SchedulingRules.create(defaultRules(locationId)).then(
        (document) => document.toObject()
      );
    }

    return NextResponse.json({
      rules: serializeRules(rules as unknown as Record<string, unknown>),
    });
  } catch (error) {
    console.error("Failed to load scheduling rules:", error);

    return NextResponse.json(
      { error: "Scheduling rules could not be loaded." },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  if (!sessionHasAnyRole(auth.session, SETTINGS_WRITE_ROLES)) {
    return forbiddenResponse();
  }

  try {
    const body = (await request.json()) as RulesRequest;
    const locationId = body.locationId?.trim();

    if (!locationId) {
      return NextResponse.json(
        { error: "locationId is required." },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    if (
      body.scheduleStartTime &&
      body.scheduleEndTime &&
      body.scheduleEndTime <= body.scheduleStartTime
    ) {
      return NextResponse.json(
        { error: "Schedule end time must be later than start time." },
        { status: 400 }
      );
    }

    if (body.slotLengthMinutes !== undefined && body.slotLengthMinutes !== 30) {
      return NextResponse.json(
        {
          error:
            "The current SOS Excel-compatible calendar requires 30-minute blocks.",
        },
        { status: 400 }
      );
    }

    if (
      body.supervisionPlanningTargetPercent !== undefined &&
      (body.supervisionPlanningTargetPercent < 0 ||
        body.supervisionPlanningTargetPercent > 100)
    ) {
      return NextResponse.json(
        { error: "Supervision planning target must be between 0 and 100 percent." },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const existing = await SchedulingRules.findOne({ locationId }).lean();
    const changes = {
      ...defaultRules(locationId),
      ...body,
      locationId,
    };

    const savedRules = await SchedulingRules.findOneAndUpdate(
      { locationId },
      { $set: changes },
      {
        new: true,
        upsert: true,
        runValidators: true,
      }
    );

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: existing ? "UPDATE" : "CREATE",
      entityType: "SCHEDULING_RULES",
      entityId: String(savedRules._id),
      summary: "Updated clinic scheduling rules.",
      before: existing,
      after: savedRules.toObject(),
    });

    return NextResponse.json({
      rules: serializeRules(
        savedRules.toObject() as unknown as Record<string, unknown>
      ),
    });
  } catch (error) {
    console.error("Failed to save scheduling rules:", error);

    return NextResponse.json(
      { error: "Scheduling rules could not be saved." },
      { status: 500 }
    );
  }
}
