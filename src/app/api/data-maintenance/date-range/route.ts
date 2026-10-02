import { NextResponse } from "next/server";

import {
  requireApiSession,
  SETTINGS_WRITE_ROLES,
  sessionCanAccessLocation,
  sessionHasAnyRole,
} from "@/lib/api/auth";
import { writeAuditLog } from "@/lib/api/audit";
import { connectToDatabase } from "@/lib/db";
import { CallOut } from "@/models/CallOut";
import { HistoricalScheduleAssignment } from "@/models/HistoricalScheduleAssignment";
import { Location } from "@/models/Location";
import { ScheduleAssignment } from "@/models/ScheduleAssignment";
import { SpeechSession } from "@/models/SpeechSession";
import { UnplacedAssignment } from "@/models/UnplacedAssignment";

type DateRangeRequest = {
  locationId?: string;
  startDate?: string;
  endDate?: string;
  confirmationText?: string;
};

type DateRangeCounts = {
  scheduleAssignments: number;
  callOuts: number;
  speechAndFixedEvents: number;
  unplacedAssignments: number;
  historicalTrainingRows: number;
  totalRecords: number;
};

type LocationLeanRecord = {
  name?: string;
  code?: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DELETE_CONFIRMATION = "DELETE";

function dateIsValid(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }

  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return false;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function validateRequest(body: DateRangeRequest): {
  locationId: string;
  startDate: string;
  endDate: string;
} | null {
  const locationId = body.locationId?.trim() ?? "";
  const startDate = body.startDate?.trim() ?? "";
  const endDate = body.endDate?.trim() ?? "";

  if (!locationId || !dateIsValid(startDate) || !dateIsValid(endDate)) {
    return null;
  }

  if (startDate > endDate) {
    return null;
  }

  return {
    locationId,
    startDate,
    endDate,
  };
}

async function loadLocation(
  locationId: string
): Promise<LocationLeanRecord | null> {
  const record = await Location.findById(locationId)
    .select("name code")
    .lean();

  if (!record || Array.isArray(record)) {
    return null;
  }

  return record as unknown as LocationLeanRecord;
}

async function countDateRangeRecords(
  locationId: string,
  startDate: string,
  endDate: string
): Promise<DateRangeCounts> {
  const dateFilter = {
    $gte: startDate,
    $lte: endDate,
  };

  const [
    scheduleAssignments,
    callOuts,
    speechAndFixedEvents,
    unplacedAssignments,
    historicalTrainingRows,
  ] = await Promise.all([
    ScheduleAssignment.countDocuments({
      locationId,
      date: dateFilter,
    }),
    CallOut.countDocuments({
      locationId,
      date: dateFilter,
    }),
    SpeechSession.countDocuments({
      locationId,
      date: dateFilter,
    }),
    UnplacedAssignment.countDocuments({
      locationId,
      date: dateFilter,
    }),
    HistoricalScheduleAssignment.countDocuments({
      locationId,
      scheduleDate: dateFilter,
    }),
  ]);

  return {
    scheduleAssignments,
    callOuts,
    speechAndFixedEvents,
    unplacedAssignments,
    historicalTrainingRows,
    totalRecords:
      scheduleAssignments +
      callOuts +
      speechAndFixedEvents +
      unplacedAssignments +
      historicalTrainingRows,
  };
}

export async function POST(request: Request) {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  if (!sessionHasAnyRole(auth.session, SETTINGS_WRITE_ROLES)) {
    return NextResponse.json(
      { error: "Clinic settings access is required." },
      { status: 403 }
    );
  }

  try {
    const body = (await request.json()) as DateRangeRequest;
    const validated = validateRequest(body);

    if (!validated) {
      return NextResponse.json(
        {
          error:
            "Choose a valid clinic location and a valid start/end date range.",
        },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, validated.locationId)) {
      return NextResponse.json(
        { error: "You do not have access to this clinic location." },
        { status: 403 }
      );
    }

    await connectToDatabase();

    const location = await loadLocation(validated.locationId);

    if (!location) {
      return NextResponse.json(
        { error: "The selected clinic location was not found." },
        { status: 404 }
      );
    }

    const counts = await countDateRangeRecords(
      validated.locationId,
      validated.startDate,
      validated.endDate
    );

    return NextResponse.json({
      success: true,
      location: {
        id: validated.locationId,
        name: String(location.name ?? "Clinic"),
        code: String(location.code ?? ""),
      },
      startDate: validated.startDate,
      endDate: validated.endDate,
      counts,
      permanentRecordsPreserved: [
        "Staff",
        "Clients",
        "Teams",
        "Clinic locations",
        "Scheduling rules",
        "Reusable schedule templates",
        "Supervision monthly summaries",
        "Audit history",
      ],
      confirmationTextRequired: DELETE_CONFIRMATION,
    });
  } catch (error) {
    console.error("Date-range cleanup preview failed:", error);

    return NextResponse.json(
      { error: "The date-range cleanup preview could not be calculated." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  if (!sessionHasAnyRole(auth.session, SETTINGS_WRITE_ROLES)) {
    return NextResponse.json(
      { error: "Clinic settings access is required." },
      { status: 403 }
    );
  }

  try {
    const body = (await request.json()) as DateRangeRequest;
    const validated = validateRequest(body);

    if (!validated) {
      return NextResponse.json(
        {
          error:
            "Choose a valid clinic location and a valid start/end date range.",
        },
        { status: 400 }
      );
    }

    if (body.confirmationText?.trim() !== DELETE_CONFIRMATION) {
      return NextResponse.json(
        {
          error: `Type ${DELETE_CONFIRMATION} exactly to confirm permanent deletion.`,
        },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, validated.locationId)) {
      return NextResponse.json(
        { error: "You do not have access to this clinic location." },
        { status: 403 }
      );
    }

    const database = await connectToDatabase();
    const location = await loadLocation(validated.locationId);

    if (!location) {
      return NextResponse.json(
        { error: "The selected clinic location was not found." },
        { status: 404 }
      );
    }

    const beforeCounts = await countDateRangeRecords(
      validated.locationId,
      validated.startDate,
      validated.endDate
    );

    const dateFilter = {
      $gte: validated.startDate,
      $lte: validated.endDate,
    };

    const session = await database.startSession();

    const deleted: DateRangeCounts = {
      scheduleAssignments: 0,
      callOuts: 0,
      speechAndFixedEvents: 0,
      unplacedAssignments: 0,
      historicalTrainingRows: 0,
      totalRecords: 0,
    };

    try {
      await session.withTransaction(async () => {
        const [
          scheduleResult,
          callOutResult,
          speechResult,
          unplacedResult,
          historicalResult,
        ] = await Promise.all([
          ScheduleAssignment.deleteMany(
            {
              locationId: validated.locationId,
              date: dateFilter,
            },
            { session }
          ),
          CallOut.deleteMany(
            {
              locationId: validated.locationId,
              date: dateFilter,
            },
            { session }
          ),
          SpeechSession.deleteMany(
            {
              locationId: validated.locationId,
              date: dateFilter,
            },
            { session }
          ),
          UnplacedAssignment.deleteMany(
            {
              locationId: validated.locationId,
              date: dateFilter,
            },
            { session }
          ),
          HistoricalScheduleAssignment.deleteMany(
            {
              locationId: validated.locationId,
              scheduleDate: dateFilter,
            },
            { session }
          ),
        ]);

        deleted.scheduleAssignments = scheduleResult.deletedCount ?? 0;
        deleted.callOuts = callOutResult.deletedCount ?? 0;
        deleted.speechAndFixedEvents = speechResult.deletedCount ?? 0;
        deleted.unplacedAssignments = unplacedResult.deletedCount ?? 0;
        deleted.historicalTrainingRows = historicalResult.deletedCount ?? 0;
        deleted.totalRecords =
          deleted.scheduleAssignments +
          deleted.callOuts +
          deleted.speechAndFixedEvents +
          deleted.unplacedAssignments +
          deleted.historicalTrainingRows;
      });
    } finally {
      await session.endSession();
    }

    await writeAuditLog({
      locationId: validated.locationId,
      userId: auth.session.userId,
      action: "DATE_RANGE_DATA_PURGED",
      entityType: "ClinicData",
      entityId: `${validated.startDate}:${validated.endDate}`,
      summary: `Deleted ${deleted.totalRecords} date-scoped clinic records from ${validated.startDate} through ${validated.endDate}.`,
      before: {
        startDate: validated.startDate,
        endDate: validated.endDate,
        counts: beforeCounts,
      },
      after: {
        startDate: validated.startDate,
        endDate: validated.endDate,
        deleted,
      },
    });

    return NextResponse.json({
      success: true,
      location: {
        id: validated.locationId,
        name: String(location.name ?? "Clinic"),
      },
      startDate: validated.startDate,
      endDate: validated.endDate,
      deleted,
      permanentRecordsPreserved: true,
      auditRecordRetained: true,
    });
  } catch (error) {
    console.error("Date-range cleanup failed:", error);

    return NextResponse.json(
      {
        error:
          "No cleanup result could be confirmed. Review the server log before trying the deletion again.",
      },
      { status: 500 }
    );
  }
}
