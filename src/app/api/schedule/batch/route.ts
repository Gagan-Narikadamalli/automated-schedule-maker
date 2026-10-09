import { NextResponse } from "next/server";

import { getEndTimeForSlot } from "@/features/scheduler/engine/dateUtils";
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
import { Client } from "@/models/Client";
import { ScheduleAssignment } from "@/models/ScheduleAssignment";
import { Staff } from "@/models/Staff";
import { UnplacedAssignment } from "@/models/UnplacedAssignment";

type AssignmentType =
  | "CLIENT_1_TO_1"
  | "BREAK"
  | "BREAK_NAP"
  | "BREAK_SPEECH"
  | "NAP"
  | "SPEECH"
  | "UNAVAILABLE"
  | "OPEN"
  | "EMPTY";

type CellChange = {
  staffId?: string;
  startTime?: string;
  assignmentType?: AssignmentType;
  text?: string;
  clientId?: string | null;
};

type BatchRequest = {
  locationId?: string;
  date?: string;
  changes?: CellChange[];
  force?: boolean;
};

type Conflict = {
  staffId: string;
  startTime: string;
  code: string;
  message: string;
};

type PlainRecord = Record<string, any>;

function extractDisplayCode(text: string): string {
  return text
    .trim()
    .replace(/\s+1:1$/i, "")
    .split(/\s+/)[0]
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isNonClientActivity(type: AssignmentType): boolean {
  return [
    "BREAK",
    "BREAK_NAP",
    "BREAK_SPEECH",
    "NAP",
    "SPEECH",
    "UNAVAILABLE",
    "OPEN",
  ].includes(type);
}

function cellKey(staffId: string, startTime: string): string {
  return `${staffId}-${startTime}`;
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
    const body = (await request.json()) as BatchRequest;
    const locationId = body.locationId?.trim();
    const date = body.date?.trim();
    const changes = body.changes ?? [];
    const force = body.force === true;

    if (!locationId || !date || changes.length === 0) {
      return NextResponse.json(
        { error: "Location, date, and at least one cell change are required." },
        { status: 400 }
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: "Date must use YYYY-MM-DD format." },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    const normalizedChanges = changes.map((change) => ({
      staffId: change.staffId?.trim() ?? "",
      startTime: change.startTime?.trim() ?? "",
      assignmentType: change.assignmentType ?? "EMPTY",
      text: change.text?.trim() ?? "",
      clientId: change.clientId?.trim() || null,
    }));

    if (
      normalizedChanges.some(
        (change) => !change.staffId || !/^\d{2}:\d{2}$/.test(change.startTime)
      )
    ) {
      return NextResponse.json(
        { error: "Every change requires a valid staff member and start time." },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const dayData = await buildDaySchedulerInput(locationId, date);
    const staffAvailability = new Map(
      dayData.staff.map((staffMember) => [
        staffMember.id,
        new Set(staffMember.availableSlots),
      ])
    );
    const dayClients = new Map(
      dayData.clients.map((client) => [client.id, client])
    );
    const staffIds = [...new Set(normalizedChanges.map((change) => change.staffId))];
    const validStaffCount = await Staff.countDocuments({
      _id: { $in: staffIds },
      locationId,
      active: true,
    });

    if (validStaffCount !== staffIds.length) {
      return NextResponse.json(
        { error: "One or more selected staff members are not active at this location." },
        { status: 400 }
      );
    }

    const resolvedClientByChange = new Map<number, string | null>();
    const conflicts: Conflict[] = [];
    const cellsChangedByBatch = new Set(
      normalizedChanges.map((change) =>
        cellKey(change.staffId, change.startTime)
      )
    );

    for (let index = 0; index < normalizedChanges.length; index += 1) {
      const change = normalizedChanges[index];

      if (change.assignmentType === "EMPTY") {
        resolvedClientByChange.set(index, null);
        continue;
      }

      if (
        change.assignmentType !== "UNAVAILABLE" &&
        !staffAvailability.get(change.staffId)?.has(change.startTime)
      ) {
        conflicts.push({
          staffId: change.staffId,
          startTime: change.startTime,
          code: "STAFF_UNAVAILABLE",
          message: "The selected staff member is unavailable during this block.",
        });
      }

      let clientId = change.clientId;

      if (change.assignmentType === "BREAK_NAP" && !clientId) {
        conflicts.push({
          staffId: change.staffId,
          startTime: change.startTime,
          code: "NAP_CLIENT_REQUIRED",
          message: "Break + Nap must identify the client who is napping.",
        });
      }

      if (change.assignmentType === "CLIENT_1_TO_1" && !clientId) {
        const displayCode = extractDisplayCode(change.text);

        if (displayCode) {
          const clientResult = await Client.findOne({
            locationId,
            active: true,
            displayCode: {
              $regex: `^${escapeRegex(displayCode)}$`,
              $options: "i",
            },
          })
            .select("_id")
            .lean();
          const client = clientResult
            ? (clientResult as unknown as PlainRecord)
            : null;

          clientId = client ? String(client._id) : null;
        }
      }

      if (change.assignmentType === "CLIENT_1_TO_1" && !clientId) {
        conflicts.push({
          staffId: change.staffId,
          startTime: change.startTime,
          code: "CLIENT_NOT_FOUND",
          message:
            "The client code in this cell does not match an active client at this location.",
        });
      }

      if (clientId) {
        const client = dayClients.get(clientId);

        if (!client && (change.assignmentType === "CLIENT_1_TO_1" || change.assignmentType === "BREAK_NAP")) {
          conflicts.push({
            staffId: change.staffId,
            startTime: change.startTime,
            code: "CLIENT_NOT_ACTIVE",
            message:
              "The linked client is not active for this target date.",
          });
        }

        if (
          client &&
          change.assignmentType === "CLIENT_1_TO_1" &&
          !client.requiredSlots.includes(change.startTime)
        ) {
          conflicts.push({
            staffId: change.staffId,
            startTime: change.startTime,
            code: "OUTSIDE_CLIENT_ATTENDANCE",
            message:
              "The client is outside attendance or is in a fixed nap/speech block at this time.",
          });
        }

        if (
          client?.staffRelationships[change.staffId] === "HARD_RESTRICTION"
        ) {
          conflicts.push({
            staffId: change.staffId,
            startTime: change.startTime,
            code: "HARD_RELATIONSHIP",
            message: "This staff/client pairing is a hard restriction.",
          });
        }

        if (change.assignmentType === "BREAK_NAP") {
          const conflictingClientCoverage = await ScheduleAssignment.findOne({
            locationId,
            date,
            startTime: change.startTime,
            clientId,
            assignmentType: "CLIENT_1_TO_1",
          }).select("staffId").lean();
          const activeClientCoverage = conflictingClientCoverage
            ? (conflictingClientCoverage as unknown as PlainRecord)
            : null;
          if (activeClientCoverage && !cellsChangedByBatch.has(
            cellKey(String(activeClientCoverage.staffId), change.startTime)
          )) {
            conflicts.push({
              staffId: change.staffId,
              startTime: change.startTime,
              code: "NAP_CLIENT_DOUBLE_BOOKED",
              message: "This client already has a 1:1 assignment during the proposed nap. Move or clear that assignment first.",
            });
          }
        }

        if (change.assignmentType === "CLIENT_1_TO_1") {
          const otherAssignmentResult = await ScheduleAssignment.findOne({
            locationId,
            date,
            startTime: change.startTime,
            clientId,
            staffId: { $ne: change.staffId },
            assignmentType: "CLIENT_1_TO_1",
          })
            .select("staffId startTime")
            .lean();
          const otherAssignment = otherAssignmentResult
            ? (otherAssignmentResult as unknown as PlainRecord)
            : null;

          if (
            otherAssignment &&
            !cellsChangedByBatch.has(
              cellKey(String(otherAssignment.staffId), change.startTime)
            )
          ) {
            conflicts.push({
              staffId: change.staffId,
              startTime: change.startTime,
              code: "CLIENT_DOUBLE_BOOKED",
              message:
                "The client is already assigned to another staff member during this block.",
            });
          }
        }
      }

      if (!clientId && !isNonClientActivity(change.assignmentType)) {
        conflicts.push({
          staffId: change.staffId,
          startTime: change.startTime,
          code: "INVALID_ASSIGNMENT",
          message: "This schedule cell does not contain a valid assignment.",
        });
      }

      resolvedClientByChange.set(index, clientId);
    }

    const nonOverridableConflicts = conflicts.filter((conflict) =>
      ["CLIENT_NOT_FOUND", "CLIENT_NOT_ACTIVE", "INVALID_ASSIGNMENT", "NAP_CLIENT_REQUIRED", "NAP_CLIENT_DOUBLE_BOOKED"].includes(
        conflict.code
      )
    );

    if (nonOverridableConflicts.length > 0) {
      return NextResponse.json(
        {
          error: nonOverridableConflicts[0].message,
          conflicts: nonOverridableConflicts,
        },
        { status: 400 }
      );
    }

    if (conflicts.length > 0 && !force) {
      return NextResponse.json(
        {
          requiresConfirmation: true,
          conflicts,
        },
        { status: 409 }
      );
    }

    const beforeRecords = await ScheduleAssignment.find({
      locationId,
      date,
      $or: normalizedChanges.map((change) => ({
        staffId: change.staffId,
        startTime: change.startTime,
      })),
    }).lean();

    const deleteChanges = normalizedChanges.filter(
      (change) => change.assignmentType === "EMPTY"
    );

    const writeOperations = normalizedChanges
      .map((change, index) => ({ change, index }))
      .filter(({ change }) => change.assignmentType !== "EMPTY")
      .map(({ change, index }) => ({
        updateOne: {
          filter: {
            locationId,
            date,
            staffId: change.staffId,
            startTime: change.startTime,
          },
          update: {
            $set: {
              locationId,
              date,
              startTime: change.startTime,
              endTime: getEndTimeForSlot(change.startTime),
              staffId: change.staffId,
              clientId: resolvedClientByChange.get(index) ?? null,
              assignmentType: change.assignmentType,
              source: "MANUAL",
              locked: true,
              manuallyOverridden: true,
              note: change.text,
            },
          },
          upsert: true,
        },
      }));

    if (writeOperations.length > 0) {
      // Save replacements first. If this fails, existing cells are still
      // present because EMPTY/source cells have not been deleted yet.
      await ScheduleAssignment.bulkWrite(writeOperations, { ordered: true });
    }

    if (deleteChanges.length > 0) {
      await ScheduleAssignment.deleteMany({
        locationId,
        date,
        $or: deleteChanges.map((change) => ({
          staffId: change.staffId,
          startTime: change.startTime,
        })),
      });
    }

    const clientPlacements = normalizedChanges
      .map((change, index) => ({
        change,
        clientId: resolvedClientByChange.get(index),
      }))
      .filter(
        ({ change, clientId }) =>
          change.assignmentType === "CLIENT_1_TO_1" && Boolean(clientId)
      );

    for (const placement of clientPlacements) {
      await UnplacedAssignment.findOneAndUpdate(
        {
          locationId,
          date,
          status: "UNPLACED",
          clientId: placement.clientId,
          originalStaffId: placement.change.staffId,
          originalStartTime: placement.change.startTime,
        },
        {
          $set: {
            status: "RESOLVED",
            resolvedBy: auth.session.userId,
            resolvedAt: new Date(),
          },
        },
        { sort: { createdAt: 1 } }
      );
    }

    const afterRecords = await ScheduleAssignment.find({
      locationId,
      date,
      $or: normalizedChanges.map((change) => ({
        staffId: change.staffId,
        startTime: change.startTime,
      })),
    }).lean();

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: force ? "FORCE_MANUAL_BATCH" : "MANUAL_BATCH",
      entityType: "SCHEDULE_DAY",
      entityId: date,
      summary: `Updated ${normalizedChanges.length} schedule cell(s) on ${date}.`,
      before: beforeRecords as unknown as PlainRecord[],
      after: {
        records: afterRecords as unknown as PlainRecord[],
        acknowledgedConflicts: force ? conflicts : [],
      },
    });

    return NextResponse.json({
      success: true,
      forced: force,
      updatedCount: normalizedChanges.length,
      conflicts,
    });
  } catch (error) {
    console.error("Schedule batch update failed:", error);

    return NextResponse.json(
      { error: "The selected schedule changes could not be saved." },
      { status: 500 }
    );
  }
}
