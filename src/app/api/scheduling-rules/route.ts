import { NextResponse } from "next/server";

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
  breakEligibilityHours?: number;
  breakWindowStart?: string;
  breakWindowEnd?: string;
  scheduleStartTime?: string;
  scheduleEndTime?: string;
  slotLengthMinutes?: number;
  preferSameTeam?: boolean;
  preferStaffContinuity?: boolean;
  preserveManualOverrides?: boolean;
  preferredStaffPriority?: number;
  sameTeamPriority?: number;
  continuityPriority?: number;
  rotationPriority?: number;
  workloadBalancePriority?: number;
  scheduleStabilityPriority?: number;
  weekdayTemplatePriority?: number;
  weeklyHoursPriority?: number;
  btCoveragePriority?: number;
  internCoveragePriority?: number;
  managerCoveragePriority?: number;
  bcbaCoveragePriority?: number;
  otherCoveragePriority?: number;
  autoUseWeekdayTemplate?: boolean;
  autoUsePreviousWeekdaySchedule?: boolean;
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
    breakEligibilityHours: 6,
    breakWindowStart: "11:00",
    breakWindowEnd: "13:30",
    scheduleStartTime: "08:00",
    scheduleEndTime: "20:00",
    slotLengthMinutes: 30,
    preferSameTeam: true,
    preferStaffContinuity: true,
    preserveManualOverrides: true,
    preferredStaffPriority: 100,
    sameTeamPriority: 40,
    continuityPriority: 35,
    rotationPriority: 60,
    workloadBalancePriority: 10,
    scheduleStabilityPriority: 140,
    weekdayTemplatePriority: 75,
    weeklyHoursPriority: 12,
    btCoveragePriority: 500,
    internCoveragePriority: 300,
    managerCoveragePriority: 125,
    bcbaCoveragePriority: 25,
    otherCoveragePriority: 75,
    autoUseWeekdayTemplate: true,
    autoUsePreviousWeekdaySchedule: true,
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

function validatePriority(value: number | undefined): boolean {
  return value === undefined || (value >= 0 && value <= 200);
}

function validateRolePriority(value: number | undefined): boolean {
  return value === undefined || (value >= 0 && value <= 1000);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const locationId = url.searchParams.get("locationId")?.trim();

  if (!locationId) {
    return NextResponse.json(
      { error: "locationId is required." },
      { status: 400 }
    );
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
  try {
    const body = (await request.json()) as RulesRequest;
    const locationId = body.locationId?.trim();

    if (!locationId) {
      return NextResponse.json(
        { error: "locationId is required." },
        { status: 400 }
      );
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

    if (
      body.breakWindowStart &&
      body.breakWindowEnd &&
      body.breakWindowEnd <= body.breakWindowStart
    ) {
      return NextResponse.json(
        { error: "Break window end must be later than break window start." },
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
      body.defaultBreakMinutes !== undefined &&
      body.defaultBreakMinutes !== 0 &&
      body.defaultBreakMinutes !== 30
    ) {
      return NextResponse.json(
        { error: "Automatic breaks currently support 0 or 30 minutes." },
        { status: 400 }
      );
    }

    if (
      body.breakEligibilityHours !== undefined &&
      (body.breakEligibilityHours < 0 || body.breakEligibilityHours > 24)
    ) {
      return NextResponse.json(
        { error: "Break eligibility hours must be between 0 and 24." },
        { status: 400 }
      );
    }

    const prioritiesAreValid = [
      body.preferredStaffPriority,
      body.sameTeamPriority,
      body.continuityPriority,
      body.rotationPriority,
      body.workloadBalancePriority,
      body.scheduleStabilityPriority,
      body.weekdayTemplatePriority,
      body.weeklyHoursPriority,
    ].every(validatePriority);

    if (!prioritiesAreValid) {
      return NextResponse.json(
        { error: "Scheduler priority values must be between 0 and 200." },
        { status: 400 }
      );
    }

    const rolePrioritiesAreValid = [
      body.btCoveragePriority,
      body.internCoveragePriority,
      body.managerCoveragePriority,
      body.bcbaCoveragePriority,
      body.otherCoveragePriority,
    ].every(validateRolePriority);

    if (!rolePrioritiesAreValid) {
      return NextResponse.json(
        { error: "Role coverage priority values must be between 0 and 1000." },
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
      userId: "scheduler-system",
      action: existing ? "UPDATE" : "CREATE",
      entityType: "SCHEDULING_RULES",
      entityId: String(savedRules._id),
      summary: "Updated clinic scheduling rules and automatic scheduler priorities.",
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
