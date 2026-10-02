import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/db";
import { ScheduleAssignment } from "@/models/ScheduleAssignment";

type BreakRecord = {
  _id: unknown;
  date: string;
  staffId: unknown;
  startTime: string;
  assignmentType: string;
};

const BREAK_TYPES = ["BREAK", "BREAK_NAP", "BREAK_SPEECH"];
const ALLOWED_LOCATION_ID = "6abec496c92bd09985aa9c58";
const ALLOWED_START_DATE = "2026-09-28";
const ALLOWED_END_DATE = "2026-10-02";
const MAINTENANCE_KEY = "oct-2026-break-cleanup";

function priority(record: BreakRecord): number {
  if (record.assignmentType === "BREAK_NAP" || record.assignmentType === "BREAK_SPEECH") {
    return 0;
  }

  return 1;
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  if (url.searchParams.get("key") !== MAINTENANCE_KEY) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    await connectToDatabase();

    const records = (await ScheduleAssignment.find({
      locationId: ALLOWED_LOCATION_ID,
      date: {
        $gte: ALLOWED_START_DATE,
        $lte: ALLOWED_END_DATE,
      },
      source: "AUTO",
      assignmentType: {
        $in: BREAK_TYPES,
      },
      manuallyOverridden: {
        $ne: true,
      },
    })
      .select("_id date staffId startTime assignmentType")
      .sort({ date: 1, staffId: 1, startTime: 1, createdAt: 1 })
      .lean()) as unknown as BreakRecord[];

    const grouped = new Map<string, BreakRecord[]>();

    for (const record of records) {
      const key = `${record.date}|${String(record.staffId)}`;
      const group = grouped.get(key) ?? [];
      group.push(record);
      grouped.set(key, group);
    }

    const deleteIds: unknown[] = [];
    const cleanedGroups: Array<{
      date: string;
      staffId: string;
      keptStartTime: string;
      keptType: string;
      removed: number;
    }> = [];

    for (const group of grouped.values()) {
      if (group.length <= 1) {
        continue;
      }

      const ordered = [...group].sort((left, right) => {
        const priorityDifference = priority(left) - priority(right);

        if (priorityDifference !== 0) {
          return priorityDifference;
        }

        return left.startTime.localeCompare(right.startTime);
      });
      const kept = ordered[0];
      const extras = ordered.slice(1);

      deleteIds.push(...extras.map((record) => record._id));
      cleanedGroups.push({
        date: kept.date,
        staffId: String(kept.staffId),
        keptStartTime: kept.startTime,
        keptType: kept.assignmentType,
        removed: extras.length,
      });
    }

    if (deleteIds.length > 0) {
      await ScheduleAssignment.deleteMany({
        _id: {
          $in: deleteIds,
        },
      });
    }

    const remaining = (await ScheduleAssignment.find({
      locationId: ALLOWED_LOCATION_ID,
      date: {
        $gte: ALLOWED_START_DATE,
        $lte: ALLOWED_END_DATE,
      },
      source: "AUTO",
      assignmentType: {
        $in: BREAK_TYPES,
      },
      manuallyOverridden: {
        $ne: true,
      },
    })
      .select("date staffId")
      .lean()) as unknown as Array<{ date: string; staffId: unknown }>;

    const remainingCounts = new Map<string, number>();
    for (const record of remaining) {
      const key = `${record.date}|${String(record.staffId)}`;
      remainingCounts.set(key, (remainingCounts.get(key) ?? 0) + 1);
    }

    const duplicateGroupsRemaining = [...remainingCounts.values()].filter(
      (count) => count > 1
    ).length;

    return NextResponse.json({
      success: true,
      locationId: ALLOWED_LOCATION_ID,
      startDate: ALLOWED_START_DATE,
      endDate: ALLOWED_END_DATE,
      breakRecordsBefore: records.length,
      duplicateGroupsCleaned: cleanedGroups.length,
      breakRecordsRemoved: deleteIds.length,
      duplicateGroupsRemaining,
      cleanedGroups,
    });
  } catch (error) {
    console.error("Duplicate break cleanup failed:", error);
    return NextResponse.json(
      { error: "Duplicate break cleanup failed." },
      { status: 500 }
    );
  }
}
