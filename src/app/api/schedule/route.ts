import { NextResponse } from "next/server";

import { getEndTimeForSlot } from "@/features/scheduler/engine/dateUtils";
import { applyFixedNapSessions } from "@/features/scheduler/server/applyFixedNapSessions";
import { buildDaySchedulerInput } from "@/features/scheduler/server/buildDaySchedulerInput";
import {
  forbiddenResponse,
  requireApiSession,
  SCHEDULE_WRITE_ROLES,
  sessionCanAccessLocation,
  sessionHasAnyRole,
} from "@/lib/api/auth";
import { writeAuditLog } from "@/lib/api/audit";
import { connectToDatabase } from "@/lib/db";
import { CallOut } from "@/models/CallOut";
import { Client } from "@/models/Client";
import { ScheduleAssignment } from "@/models/ScheduleAssignment";
import { Staff } from "@/models/Staff";

type ManualAssignmentRequest = {
  locationId?: string;
  date?: string;
  startTime?: string;
  staffId?: string;
  clientId?: string | null;
  assignmentType?:
    | "CLIENT_1_TO_1"
    | "BREAK"
    | "BREAK_NAP"
    | "NAP"
    | "SPEECH"
    | "UNAVAILABLE"
    | "OPEN";
  note?: string;
  force?: boolean;
};

type Conflict = {
  code: string;
  message: string;
};

type PlainDatabaseRecord = Record<string, any>;

function firstNameOnly(value: unknown): string {
  return String(value ?? "").trim().split(/\s+/)[0] ?? "";
}

function serializeAssignment(assignment: PlainDatabaseRecord) {
  const client =
    assignment.clientId && typeof assignment.clientId === "object"
      ? assignment.clientId
      : null;

  return {
    ...assignment,
    id: String(assignment._id),
    _id: undefined,
    locationId: String(assignment.locationId),
    staffId:
      assignment.staffId && typeof assignment.staffId === "object"
        ? assignment.staffId
        : String(assignment.staffId),
    clientId: client ?? (assignment.clientId ? String(assignment.clientId) : null),
  };
}

export async function GET(request: Request) {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  const url = new URL(request.url);
  const locationId = url.searchParams.get("locationId");
  const date = url.searchParams.get("date");

  if (!locationId || !date) {
    return NextResponse.json(
      { error: "locationId and date are required." },
      { status: 400 }
    );
  }

  if (!sessionCanAccessLocation(auth.session, locationId)) {
    return forbiddenResponse("You do not have access to this location.");
  }

  try {
    await connectToDatabase();

    const [
      dayData,
      staffDocuments,
      clientDocuments,
      assignments,
      savedDates,
    ] = await Promise.all([
      buildDaySchedulerInput(locationId, date),
      Staff.find({ locationId, active: true })
        .select("fullName role color teamId")
        .sort({ fullName: 1 })
        .lean(),
      Client.find({ locationId, active: true })
        .select("displayCode color")
        .lean(),
      ScheduleAssignment.find({ locationId, date })
        .populate("clientId", "displayCode color supportLevel teamId")
        .sort({ startTime: 1 })
        .lean(),
      ScheduleAssignment.distinct("date", { locationId }),
    ]);

    const fixedNapApplication = await applyFixedNapSessions(
      locationId,
      date,
      dayData.input
    );
    const effectiveClients = fixedNapApplication.input.clients;

    const availableSlotMap = new Map(
      dayData.staff.map((staffMember) => [
        staffMember.id,
        staffMember.availableSlots,
      ])
    );

    const plainStaffDocuments =
      staffDocuments as unknown as PlainDatabaseRecord[];
    const plainClientDocuments =
      clientDocuments as unknown as PlainDatabaseRecord[];
    const plainAssignments =
      assignments as unknown as PlainDatabaseRecord[];
    const clientPresentation = new Map(
      plainClientDocuments.map((client) => [
        String(client._id),
        {
          displayCode: String(client.displayCode ?? "Client"),
          color: String(client.color ?? "#D9F4EE"),
        },
      ])
    );

    const recentSavedScheduleDates = (savedDates as string[])
      .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
      .sort((left, right) => right.localeCompare(left))
      .slice(0, 8);

    const absentClientIds = new Set(dayData.input.clients.map((client) => client.id));
    const clientRows = plainClientDocuments.map((client) => ({ id: String(client._id), code: String(client.displayCode ?? ""), name: firstNameOnly(client.fullName ?? client.displayCode) }));

    return NextResponse.json({
      clients: clientRows,
      date,
      locationId,
      recentSavedScheduleDates,
      staff: plainStaffDocuments
        .filter(
          (staffMember) =>
            (availableSlotMap.get(String(staffMember._id))?.length ?? 0) > 0
        )
        .map((staffMember) => ({
          id: String(staffMember._id),
          name: firstNameOnly(staffMember.fullName),
          role: String(staffMember.role ?? ""),
          color: String(staffMember.color ?? "#DCE9F8"),
          teamId: staffMember.teamId ? String(staffMember.teamId) : null,
          availableSlots: availableSlotMap.get(String(staffMember._id)) ?? [],
        })),
      assignments: plainAssignments.filter((assignment) => !assignment.clientId || assignment.assignmentType !== "CLIENT_1_TO_1" || absentClientIds.has(String(typeof assignment.clientId === "object" ? assignment.clientId._id : assignment.clientId))).map((assignment) => serializeAssignment(assignment)),
      clientEvents: effectiveClients.flatMap((client) => {
        const presentation = clientPresentation.get(client.id);
        return [
          ...client.napSlots.map((startTime) => ({
            clientId: client.id,
            clientCode:
              presentation?.displayCode ?? client.displayCode,
            clientColor: presentation?.color ?? "#D9F4EE",
            startTime,
            eventType: "NAP" as const,
          })),
          ...client.speechSlots.map((startTime) => ({
            clientId: client.id,
            clientCode:
              presentation?.displayCode ?? client.displayCode,
            clientColor: presentation?.color ?? "#D9F4EE",
            startTime,
            eventType: "SPEECH" as const,
          })),
        ];
      }),
      requiredClientSlots: effectiveClients.reduce(
        (total, client) => total + client.requiredSlots.length,
        0
      ),
      configuredNapSessions: fixedNapApplication.sessionCount,
    });
  } catch (error) {
    console.error("Failed to load schedule:", error);

    return NextResponse.json(
      { error: "Schedule could not be loaded." },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  if (!sessionHasAnyRole(auth.session, SCHEDULE_WRITE_ROLES)) {
    return forbiddenResponse();
  }

  try {
    const body = (await request.json()) as ManualAssignmentRequest;
    const locationId = body.locationId?.trim();
    const date = body.date?.trim();
    const startTime = body.startTime?.trim();
    const staffId = body.staffId?.trim();
    const assignmentType = body.assignmentType;
    const clientId = body.clientId?.trim() || null;
    const force = body.force === true;

    if (!locationId || !date || !startTime || !staffId || !assignmentType) {
      return NextResponse.json(
        {
          error:
            "Location, date, start time, staff member, and assignment type are required.",
        },
        { status: 400 }
      );
    }

    if (assignmentType === "CLIENT_1_TO_1" && !clientId) {
      return NextResponse.json(
        { error: "A client is required for a 1:1 assignment." },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    await connectToDatabase();

    const [staffMember, client, existingCellResult, dayData] =
      await Promise.all([
        Staff.findOne({ _id: staffId, locationId, active: true }),
        clientId
          ? Client.findOne({ _id: clientId, locationId, active: true })
          : Promise.resolve(null),
        ScheduleAssignment.findOne({
          locationId,
          date,
          staffId,
          startTime,
        }).lean(),
        buildDaySchedulerInput(locationId, date),
      ]);

    if (!staffMember) {
      return NextResponse.json(
        { error: "The selected staff member was not found." },
        { status: 404 }
      );
    }

    if (clientId && !client) {
      return NextResponse.json(
        { error: "The selected client was not found." },
        { status: 404 }
      );
    }

    const fixedNapApplication = await applyFixedNapSessions(
      locationId,
      date,
      dayData.input
    );

    const existingCell = existingCellResult
      ? (existingCellResult as unknown as PlainDatabaseRecord)
      : null;

    const conflicts: Conflict[] = [];

    if (existingCell) {
      const existingClientId = existingCell.clientId
        ? String(existingCell.clientId)
        : null;
      const sameContent =
        existingCell.assignmentType === assignmentType &&
        existingClientId === clientId;

      if (!sameContent) {
        conflicts.push({
          code: "OCCUPIED_CELL",
          message:
            "This staff/time cell already contains an assignment that will be displaced.",
        });
      }
    }

    const schedulerStaff = dayData.staff.find(
      (candidate) => candidate.id === staffId
    );

    if (
      assignmentType !== "UNAVAILABLE" &&
      !schedulerStaff?.availableSlots.includes(startTime)
    ) {
      conflicts.push({
        code: "STAFF_UNAVAILABLE",
        message:
          "The staff member is outside their recurring shift or is unavailable during this time.",
      });
    }

    const callOut = await CallOut.findOne({
      locationId,
      date,
      staffId,
      startTime: { $lte: startTime },
      endTime: { $gt: startTime },
    }).lean();

    if (callOut) {
      conflicts.push({
        code: "STAFF_CALL_OUT",
        message: "The staff member is marked as a call-out during this time.",
      });
    }

    if (client && clientId) {
      const relationship = client.staffRelationships?.find(
        (item: any) => String(item.staffId) === staffId
      );

      if (relationship?.relationship === "HARD_RESTRICTION") {
        conflicts.push({
          code: "HARD_RELATIONSHIP",
          message:
            "This staff/client pair is marked as a hard restriction.",
        });
      }

      const clientDoubleBooking = await ScheduleAssignment.findOne({
        locationId,
        date,
        startTime,
        clientId,
        staffId: { $ne: staffId },
        assignmentType: "CLIENT_1_TO_1",
      }).lean();

      if (clientDoubleBooking) {
        conflicts.push({
          code: "CLIENT_DOUBLE_BOOKED",
          message:
            "The client is already assigned to another staff member during this block.",
        });
      }

      const schedulerClient = fixedNapApplication.input.clients.find(
        (candidate) => candidate.id === clientId
      );

      if (!schedulerClient?.requiredSlots.includes(startTime)) {
        conflicts.push({
          code: "OUTSIDE_CLIENT_ATTENDANCE",
          message:
            "This block is outside the client’s normal service requirement, or overlaps nap/speech time.",
        });
      }
    }

    if (conflicts.length > 0 && !force) {
      return NextResponse.json(
        {
          requiresConfirmation: true,
          conflicts,
          displacedAssignment: existingCell,
        },
        { status: 409 }
      );
    }

    const before = existingCell;
    const endTime = getEndTimeForSlot(startTime);

    const assignment = await ScheduleAssignment.findOneAndUpdate(
      {
        locationId,
        date,
        staffId,
        startTime,
      },
      {
        $set: {
          locationId,
          date,
          startTime,
          endTime,
          staffId,
          clientId,
          assignmentType,
          source: "MANUAL",
          locked: true,
          manuallyOverridden: true,
          note: body.note?.trim() || "",
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      }
    );

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: force ? "FORCE_MANUAL_ASSIGNMENT" : "MANUAL_ASSIGNMENT",
      entityType: "SCHEDULE_ASSIGNMENT",
      entityId: String(assignment._id),
      summary: `Changed ${staffMember.fullName} at ${startTime} on ${date}.`,
      before,
      after: {
        ...assignment.toObject(),
        acknowledgedConflicts: force ? conflicts : [],
      },
    });

    return NextResponse.json({
      success: true,
      forced: force,
      conflicts,
      displacedAssignment: before,
      assignment: {
        ...assignment.toObject(),
        id: String(assignment._id),
        _id: undefined,
        locationId,
        staffId,
        clientId,
      },
    });
  } catch (error) {
    console.error("Manual schedule update failed:", error);

    return NextResponse.json(
      { error: "The schedule cell could not be updated." },
      { status: 500 }
    );
  }
}
