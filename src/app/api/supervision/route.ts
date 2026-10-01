import { NextResponse } from "next/server";

import {
  forbiddenResponse,
  requireApiSession,
  sessionCanAccessLocation,
} from "@/lib/api/auth";
import { connectToDatabase } from "@/lib/db";
import { ScheduleAssignment } from "@/models/ScheduleAssignment";
import { SchedulingRules } from "@/models/SchedulingRules";
import { Staff } from "@/models/Staff";
import { SupervisionRecord } from "@/models/SupervisionRecord";

type PlainRecord = Record<string, any>;

export async function GET(request: Request) {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  const url = new URL(request.url);
  const locationId = url.searchParams.get("locationId");
  const month = url.searchParams.get("month");

  if (!locationId || !month) {
    return NextResponse.json(
      { error: "locationId and month are required." },
      { status: 400 }
    );
  }

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json(
      { error: "month must use YYYY-MM format." },
      { status: 400 }
    );
  }

  if (!sessionCanAccessLocation(auth.session, locationId)) {
    return forbiddenResponse("You do not have access to this location.");
  }

  try {
    await connectToDatabase();

    const [staffResult, assignmentResult, recordResult, rulesResult] =
      await Promise.all([
        Staff.find({ locationId, active: true })
          .select("fullName role")
          .sort({ fullName: 1 })
          .lean(),
        ScheduleAssignment.find({
          locationId,
          date: { $regex: `^${month}-` },
          assignmentType: "CLIENT_1_TO_1",
        })
          .select("staffId startTime")
          .lean(),
        SupervisionRecord.find({ locationId, month }).lean(),
        SchedulingRules.findOne({ locationId }).lean(),
      ]);

    const staff = staffResult as unknown as PlainRecord[];
    const assignments = assignmentResult as unknown as PlainRecord[];
    const records = recordResult as unknown as PlainRecord[];
    const rules = rulesResult as unknown as PlainRecord | null;

    const planningTargetPercent = Number(
      rules?.supervisionPlanningTargetPercent ?? 5
    );
    const supervisionByStaff = new Map(
      records.map((record) => [String(record.staffId), record])
    );
    const serviceBlocksByStaff = new Map<string, number>();

    for (const assignment of assignments) {
      const staffId = String(assignment.staffId);
      serviceBlocksByStaff.set(
        staffId,
        (serviceBlocksByStaff.get(staffId) ?? 0) + 1
      );
    }

    const bcbaCount = staff.filter((staffMember) => staffMember.role === "BCBA").length;
    const rows = staff
      .filter((staffMember) =>
        ["BT", "RBT"].includes(String(staffMember.role))
      )
      .map((staffMember) => {
        const staffId = String(staffMember._id);
        const calculatedServiceHours =
          (serviceBlocksByStaff.get(staffId) ?? 0) * 0.5;
        const savedRecord = supervisionByStaff.get(staffId);
        const serviceHours = savedRecord
          ? Number(savedRecord.serviceHours ?? calculatedServiceHours)
          : calculatedServiceHours;
        const supervisionHours = Number(savedRecord?.supervisionHours ?? 0);
        const targetHours =
          serviceHours * (planningTargetPercent / 100);
        const remainingHours = Math.max(targetHours - supervisionHours, 0);

        return {
          staffId,
          staffName: String(staffMember.fullName ?? ""),
          role: String(staffMember.role ?? ""),
          serviceHours,
          supervisionHours,
          planningTargetPercent,
          targetHours,
          remainingHours,
          status: remainingHours > 0 ? "NEEDS_SUPERVISION" : "ON_TARGET",
        };
      });

    return NextResponse.json({
      month,
      planningTargetPercent,
      bcbaCount,
      hasSupervisionGap: bcbaCount === 0 && rows.some((row) => row.remainingHours > 0),
      rows,
    });
  } catch (error) {
    console.error("Failed to load supervision planning data:", error);

    return NextResponse.json(
      { error: "Supervision planning data could not be loaded." },
      { status: 500 }
    );
  }
}
