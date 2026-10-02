import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/db";
import { CallOut } from "@/models/CallOut";
import { ScheduleAssignment } from "@/models/ScheduleAssignment";

const LOCATION_ID = "6abec496c92bd09985aa9c58";
const DATE = "2026-10-01";
const BREAK_TYPES = ["BREAK", "BREAK_NAP", "BREAK_SPEECH"];

type CallOutRecord = {
  staffId: unknown;
  startTime: unknown;
  endTime: unknown;
};

export async function GET() {
  await connectToDatabase();

  const rawCallOuts = (await CallOut.find({
    locationId: LOCATION_ID,
    date: DATE,
  })
    .select("staffId startTime endTime")
    .lean()) as unknown as CallOutRecord[];

  const callOuts = rawCallOuts.map((callOut) => ({
    staffId: String(callOut.staffId),
    startTime: String(callOut.startTime),
    endTime: String(callOut.endTime),
  }));

  const removed: Array<{
    id: string;
    staffId: string;
    startTime: string;
    assignmentType: string;
  }> = [];

  for (const callOut of callOuts) {
    const staleBreaks = await ScheduleAssignment.find({
      locationId: LOCATION_ID,
      date: DATE,
      staffId: callOut.staffId,
      startTime: { $gte: callOut.startTime, $lt: callOut.endTime },
      assignmentType: { $in: BREAK_TYPES },
      source: "AUTO",
      manuallyOverridden: { $ne: true },
    })
      .select("_id staffId startTime assignmentType")
      .lean();

    if (staleBreaks.length === 0) {
      continue;
    }

    removed.push(
      ...staleBreaks.map((record) => ({
        id: String(record._id),
        staffId: String(record.staffId),
        startTime: String(record.startTime),
        assignmentType: String(record.assignmentType),
      }))
    );

    await ScheduleAssignment.deleteMany({
      _id: { $in: staleBreaks.map((record) => record._id) },
      locationId: LOCATION_ID,
      date: DATE,
      source: "AUTO",
      manuallyOverridden: { $ne: true },
    });
  }

  let remainingCount = 0;
  for (const callOut of callOuts) {
    remainingCount += await ScheduleAssignment.countDocuments({
      locationId: LOCATION_ID,
      date: DATE,
      staffId: callOut.staffId,
      startTime: { $gte: callOut.startTime, $lt: callOut.endTime },
      assignmentType: { $in: BREAK_TYPES },
      source: "AUTO",
      manuallyOverridden: { $ne: true },
    });
  }

  return NextResponse.json({
    success: true,
    locationId: LOCATION_ID,
    date: DATE,
    callOutCount: callOuts.length,
    removedCount: removed.length,
    removed,
    remainingCount,
  });
}
