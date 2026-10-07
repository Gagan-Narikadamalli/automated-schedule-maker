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
  minimumClientStaffAssignmentMinutes?: number;
  maximumClientStaffConsecutiveHours?: number;
  preventSameStaffClientRepeatSameDay?: boolean;
  allowSameStaffClientRepeatForCoverageException?: boolean;
  breakSchedulingEnabled?: boolean;
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
  clientHandoffPenaltyPriority?: number;
  staffScheduleCompactnessPriority?: number;
  minimalFixAllowProtectedRelocation?: boolean;
  minimalFixAllowBreakRelocation?: boolean;
  scheduleStabilityPriority?: number;
  weekdayTemplatePriority?: number;
  weeklyHoursPriority?: number;
  historicalPairingPriority?: number;
  historicalSlotPriority?: number;
  historicalBreakPriority?: number;
  btCoveragePriority?: number;
  internCoveragePriority?: number;
  managerCoveragePriority?: number;
  bcbaCoveragePriority?: number;
  otherCoveragePriority?: number;
  autoUseWeekdayTemplate?: boolean;
  autoUsePreviousWeekdaySchedule?: boolean;
  autoUseHistoricalPatterns?: boolean;
  napDurationRulesEnabled?: boolean;
  napMinimumMinutes?: number;
  napPreferredMinutes?: number;
  napMaximumMinutes?: number;
  speechDurationRulesEnabled?: boolean;
  speechMinimumMinutes?: number;
  speechPreferredMinutes?: number;
  speechMaximumMinutes?: number;
  supervisionPlanningTargetPercent?: number;
};

type RuleValues = ReturnType<typeof defaultRules>;

function defaultRules(locationId: string) {
  return {
    locationId,
    fullTimeMinimumWeeklyHours: 30,
    fullTimeMaximumWeeklyHours: 40,
    partTimeMinimumWeeklyHours: 0,
    partTimeMaximumWeeklyHours: 29,
    maximumClientsPerTechPerDay: 6,
    maximumTechsPerClientPerDay: 4,
    minimumClientStaffAssignmentMinutes: 30,
    maximumClientStaffConsecutiveHours: 4,
    preventSameStaffClientRepeatSameDay: true,
    allowSameStaffClientRepeatForCoverageException: true,
    breakSchedulingEnabled: true,
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
    clientHandoffPenaltyPriority: 25,
    staffScheduleCompactnessPriority: 8,
    minimalFixAllowProtectedRelocation: true,
    minimalFixAllowBreakRelocation: true,
    scheduleStabilityPriority: 140,
    weekdayTemplatePriority: 75,
    weeklyHoursPriority: 12,
    historicalPairingPriority: 70,
    historicalSlotPriority: 90,
    historicalBreakPriority: 80,
    btCoveragePriority: 500,
    internCoveragePriority: 300,
    managerCoveragePriority: 125,
    bcbaCoveragePriority: 25,
    otherCoveragePriority: 75,
    autoUseWeekdayTemplate: true,
    autoUsePreviousWeekdaySchedule: true,
    autoUseHistoricalPatterns: true,
    napDurationRulesEnabled: true,
    napMinimumMinutes: 30,
    napPreferredMinutes: 30,
    napMaximumMinutes: 60,
    speechDurationRulesEnabled: true,
    speechMinimumMinutes: 30,
    speechPreferredMinutes: 30,
    speechMaximumMinutes: 60,
    supervisionPlanningTargetPercent: 5,
  };
}

function mergeRuleValues(
  locationId: string,
  existing: Record<string, unknown> | null,
  body: RulesRequest
): RuleValues {
  const defaults = defaultRules(locationId);
  const merged: Record<string, unknown> = {
    ...defaults,
  };

  if (existing) {
    for (const key of Object.keys(defaults)) {
      if (existing[key] !== undefined) {
        merged[key] = existing[key];
      }
    }
  }

  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined && key in defaults) {
      merged[key] = value;
    }
  }

  merged.locationId = locationId;

  return merged as RuleValues;
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

function validateEventDurationValue(value: number | undefined): boolean {
  return (
    value === undefined ||
    (value >= 30 && value <= 240 && value % 30 === 0)
  );
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

    const completeRules = mergeRuleValues(
      locationId,
      rules as unknown as Record<string, unknown>,
      {}
    );

    return NextResponse.json({
      rules: serializeRules(
        completeRules as unknown as Record<string, unknown>
      ),
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
      body.minimumClientStaffAssignmentMinutes !== undefined &&
      (body.minimumClientStaffAssignmentMinutes < 30 ||
        body.minimumClientStaffAssignmentMinutes > 240 ||
        body.minimumClientStaffAssignmentMinutes % 30 !== 0)
    ) {
      return NextResponse.json(
        {
          error:
            "Minimum client/staff assignment must be a 30-minute multiple between 30 and 240 minutes.",
        },
        { status: 400 }
      );
    }

    if (
      body.maximumClientStaffConsecutiveHours !== undefined &&
      ![3, 3.5, 4].includes(body.maximumClientStaffConsecutiveHours)
    ) {
      return NextResponse.json(
        {
          error:
            "Maximum continuous client/staff assignment must be 3, 3.5, or 4 hours.",
        },
        { status: 400 }
      );
    }

    if (
      body.defaultBreakMinutes !== undefined &&
      body.defaultBreakMinutes !== 0 &&
      !validateEventDurationValue(body.defaultBreakMinutes)
    ) {
      return NextResponse.json(
        {
          error:
            "Break duration must use 30-minute increments between 30 and 240 minutes.",
        },
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

    const durationValuesAreValid = [
      body.napPreferredMinutes,
      body.speechPreferredMinutes,
    ].every(validateEventDurationValue);

    if (!durationValuesAreValid) {
      return NextResponse.json(
        {
          error:
            "Nap and Speech durations must use 30-minute increments between 30 and 240 minutes.",
        },
        { status: 400 }
      );
    }

    const prioritiesAreValid = [
      body.preferredStaffPriority,
      body.sameTeamPriority,
      body.continuityPriority,
      body.rotationPriority,
      body.workloadBalancePriority,
      body.clientHandoffPenaltyPriority,
      body.staffScheduleCompactnessPriority,
      body.scheduleStabilityPriority,
      body.weekdayTemplatePriority,
      body.weeklyHoursPriority,
      body.historicalPairingPriority,
      body.historicalSlotPriority,
      body.historicalBreakPriority,
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
    const existingRecord = existing
      ? (existing as unknown as Record<string, unknown>)
      : null;
    const changes = mergeRuleValues(
      locationId,
      existingRecord,
      body
    );

    // Legacy min/max fields are kept in MongoDB for compatibility with
    // previously saved rules. The current scheduler uses one exact event
    // duration inside each configured placement window.
    changes.napMinimumMinutes = changes.napPreferredMinutes;
    changes.napMaximumMinutes = changes.napPreferredMinutes;
    changes.speechMinimumMinutes = changes.speechPreferredMinutes;
    changes.speechMaximumMinutes = changes.speechPreferredMinutes;

    if (
      changes.minimumClientStaffAssignmentMinutes >
      changes.maximumClientStaffConsecutiveHours * 60
    ) {
      return NextResponse.json(
        {
          error:
            "Minimum client/staff assignment cannot exceed the maximum continuous pairing duration.",
        },
        { status: 400 }
      );
    }

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
