import { NextResponse } from "next/server";

import {
  forbiddenResponse,
  requireApiSession,
  sessionCanAccessLocation,
  sessionHasAnyRole,
  SETTINGS_WRITE_ROLES,
} from "@/lib/api/auth";
import { writeAuditLog } from "@/lib/api/audit";
import { connectToDatabase } from "@/lib/db";
import { ScheduleAssignment } from "@/models/ScheduleAssignment";
import { SchedulingRules } from "@/models/SchedulingRules";
import { Staff } from "@/models/Staff";
import { SupervisionRecord } from "@/models/SupervisionRecord";

type PlainRecord = Record<string, any>;

type SupervisionRequest = {
  locationId?: string;
  staffId?: string;
  supervisorStaffId?: string | null;
  month?: string;
  serviceHours?: number;
  supervisionHours?: number;
  note?: string;
};

function isValidMonth(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value);
}

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

  if (!isValidMonth(month)) {
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
          .select("fullName role color")
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

    const bcbaStaff = staff.filter((staffMember) => staffMember.role === "BCBA");
    const bcbaCount = bcbaStaff.length;
    const supervisorNameById = new Map(
      bcbaStaff.map((staffMember) => [String(staffMember._id), String(staffMember.fullName)])
    );

    const rows = staff
      .filter((staffMember) => ["BT", "RBT"].includes(String(staffMember.role)))
      .map((staffMember) => {
        const staffId = String(staffMember._id);
        const calculatedServiceHours =
          (serviceBlocksByStaff.get(staffId) ?? 0) * 0.5;
        const savedRecord = supervisionByStaff.get(staffId);
        const serviceHours = savedRecord
          ? Number(savedRecord.serviceHours ?? calculatedServiceHours)
          : calculatedServiceHours;
        const supervisionHours = Number(savedRecord?.supervisionHours ?? 0);
        const targetHours = serviceHours * (planningTargetPercent / 100);
        const remainingHours = Math.max(targetHours - supervisionHours, 0);
        const supervisorStaffId = savedRecord?.supervisorStaffId
          ? String(savedRecord.supervisorStaffId)
          : null;

        return {
          staffId,
          staffName: String(staffMember.fullName ?? ""),
          role: String(staffMember.role ?? ""),
          color: String(staffMember.color ?? "#7DB2E8"),
          serviceHours,
          calculatedServiceHours,
          supervisionHours,
          planningTargetPercent,
          targetHours,
          remainingHours,
          supervisorStaffId,
          supervisorName: supervisorStaffId
            ? supervisorNameById.get(supervisorStaffId) ?? "Unknown BCBA"
            : null,
          note: String(savedRecord?.note ?? ""),
          hasSavedRecord: Boolean(savedRecord),
          status: remainingHours > 0 ? "NEEDS_SUPERVISION" : "ON_TARGET",
        };
      });

    return NextResponse.json({
      month,
      planningTargetPercent,
      bcbaCount,
      supervisors: bcbaStaff.map((staffMember) => ({
        id: String(staffMember._id),
        fullName: String(staffMember.fullName),
      })),
      hasSupervisionGap:
        bcbaCount === 0 && rows.some((row) => row.remainingHours > 0),
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

export async function POST(request: Request) {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  if (!sessionHasAnyRole(auth.session, SETTINGS_WRITE_ROLES)) {
    return forbiddenResponse();
  }

  try {
    const body = (await request.json()) as SupervisionRequest;
    const locationId = body.locationId?.trim();
    const staffId = body.staffId?.trim();
    const month = body.month?.trim();

    if (!locationId || !staffId || !month) {
      return NextResponse.json(
        { error: "Location, staff member, and month are required." },
        { status: 400 }
      );
    }

    if (!isValidMonth(month)) {
      return NextResponse.json(
        { error: "month must use YYYY-MM format." },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    const serviceHours = Number(body.serviceHours ?? 0);
    const supervisionHours = Number(body.supervisionHours ?? 0);

    if (
      !Number.isFinite(serviceHours) ||
      !Number.isFinite(supervisionHours) ||
      serviceHours < 0 ||
      supervisionHours < 0
    ) {
      return NextResponse.json(
        { error: "Service and supervision hours must be zero or greater." },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const staffMember = await Staff.findOne({
      _id: staffId,
      locationId,
      active: true,
      role: { $in: ["BT", "RBT"] },
    });

    if (!staffMember) {
      return NextResponse.json(
        { error: "The selected active BT/RBT was not found." },
        { status: 404 }
      );
    }

    let supervisorStaffId: string | null = null;

    if (body.supervisorStaffId) {
      const supervisor = await Staff.findOne({
        _id: body.supervisorStaffId,
        locationId,
        active: true,
        role: "BCBA",
      });

      if (!supervisor) {
        return NextResponse.json(
          { error: "The selected active BCBA supervisor was not found." },
          { status: 404 }
        );
      }

      supervisorStaffId = String(supervisor._id);
    }

    const rules = await SchedulingRules.findOne({ locationId }).lean();
    const planningTargetPercent = Number(
      (rules as PlainRecord | null)?.supervisionPlanningTargetPercent ?? 5
    );

    const record = await SupervisionRecord.findOneAndUpdate(
      { locationId, staffId, month },
      {
        $set: {
          supervisorStaffId,
          serviceHours,
          supervisionHours,
          planningTargetPercent,
          note: body.note?.trim() || "",
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: "UPDATE",
      entityType: "SUPERVISION_RECORD",
      entityId: String(record._id),
      summary: `Saved ${month} supervision planning record for ${staffMember.fullName}.`,
      after: record.toObject(),
    });

    return NextResponse.json({
      success: true,
      record: {
        id: String(record._id),
        staffId: String(record.staffId),
        supervisorStaffId: record.supervisorStaffId
          ? String(record.supervisorStaffId)
          : null,
        month: record.month,
        serviceHours: record.serviceHours,
        supervisionHours: record.supervisionHours,
        planningTargetPercent: record.planningTargetPercent,
        note: record.note,
      },
    });
  } catch (error) {
    console.error("Failed to save supervision record:", error);

    return NextResponse.json(
      { error: "The supervision record could not be saved." },
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
    return forbiddenResponse();
  }

  try {
    const body = (await request.json()) as SupervisionRequest;
    const locationId = body.locationId?.trim();
    const staffId = body.staffId?.trim();
    const month = body.month?.trim();

    if (!locationId || !staffId || !month) {
      return NextResponse.json(
        { error: "Location, staff member, and month are required." },
        { status: 400 }
      );
    }

    if (!isValidMonth(month)) {
      return NextResponse.json(
        { error: "month must use YYYY-MM format." },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    await connectToDatabase();

    const record = await SupervisionRecord.findOne({
      locationId,
      staffId,
      month,
    });

    if (!record) {
      return NextResponse.json(
        { error: "The saved supervision record was not found." },
        { status: 404 }
      );
    }

    const before = record.toObject();

    await SupervisionRecord.deleteOne({ _id: record._id });

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: "DELETE",
      entityType: "SUPERVISION_RECORD",
      entityId: String(record._id),
      summary: `Deleted ${month} supervision record for staff ${staffId}.`,
      before,
      after: null,
    });

    return NextResponse.json({
      success: true,
      deletedId: String(record._id),
    });
  } catch (error) {
    console.error("Failed to delete supervision record:", error);

    return NextResponse.json(
      { error: "The supervision record could not be deleted." },
      { status: 500 }
    );
  }
}
