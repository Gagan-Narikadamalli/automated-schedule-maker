import { NextResponse } from "next/server";

import { buildDaySchedulerInput } from "@/features/scheduler/server/buildDaySchedulerInput";
import {
  forbiddenResponse,
  requireApiSession,
  sessionCanAccessLocation,
} from "@/lib/api/auth";
import { connectToDatabase } from "@/lib/db";
import { ScheduleAssignment } from "@/models/ScheduleAssignment";
import { Staff } from "@/models/Staff";

type PlainRecord = Record<string, any>;

function addDays(dateText: string, numberOfDays: number): string {
  const date = new Date(`${dateText}T12:00:00`);
  date.setDate(date.getDate() + numberOfDays);
  return date.toISOString().slice(0, 10);
}

function formatDayName(dateText: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(
    new Date(`${dateText}T12:00:00`)
  );
}

export async function GET(request: Request) {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  const url = new URL(request.url);
  const locationId = url.searchParams.get("locationId");
  const weekStart = url.searchParams.get("weekStart");

  if (!locationId || !weekStart) {
    return NextResponse.json(
      { error: "locationId and weekStart are required." },
      { status: 400 }
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return NextResponse.json(
      { error: "weekStart must use YYYY-MM-DD format." },
      { status: 400 }
    );
  }

  if (!sessionCanAccessLocation(auth.session, locationId)) {
    return forbiddenResponse("You do not have access to this location.");
  }

  try {
    await connectToDatabase();

    const dates = Array.from({ length: 5 }, (_, index) => addDays(weekStart, index));
    const dayInputs = await Promise.all(
      dates.map((date) => buildDaySchedulerInput(locationId, date))
    );
    const assignmentsByDate = await Promise.all(
      dates.map((date) =>
        ScheduleAssignment.find({ locationId, date }).lean()
      )
    );
    const staffDocuments = await Staff.find({ locationId, active: true })
      .select(
        "fullName employeeType minimumWeeklyHours targetWeeklyHours maximumWeeklyHours"
      )
      .sort({ fullName: 1 })
      .lean();

    const dailyMetrics = dates.map((date, index) => {
      const dayData = dayInputs[index];
      const assignments = assignmentsByDate[index] as unknown as PlainRecord[];
      const requiredClientSlots = dayData.clients.reduce(
        (total, client) => total + client.requiredSlots.length,
        0
      );
      const coveredClientSlots = assignments.filter(
        (assignment) => assignment.assignmentType === "CLIENT_1_TO_1"
      ).length;
      const staffAvailableSlots = dayData.staff.reduce(
        (total, staffMember) => total + staffMember.availableSlots.length,
        0
      );
      const uncoveredSlots = Math.max(requiredClientSlots - coveredClientSlots, 0);

      return {
        date,
        day: formatDayName(date),
        clientHoursNeeded: requiredClientSlots * 0.5,
        clientHoursCovered: Math.min(coveredClientSlots, requiredClientSlots) * 0.5,
        staffHoursScheduled: staffAvailableSlots * 0.5,
        additionalLaborHours: uncoveredSlots * 0.5,
        staffPresent: dayData.staff.filter(
          (staffMember) => staffMember.availableSlots.length > 0
        ).length,
        staffAbsent: dayData.input.callOutStaffIds.length,
        uncoveredHours: uncoveredSlots * 0.5,
      };
    });

    const scheduledHoursByStaff = new Map<string, number>();

    dayInputs.forEach((dayData) => {
      dayData.staff.forEach((staffMember) => {
        scheduledHoursByStaff.set(
          staffMember.id,
          (scheduledHoursByStaff.get(staffMember.id) ?? 0) +
            staffMember.availableSlots.length * 0.5
        );
      });
    });

    const staffHourStatus = (staffDocuments as unknown as PlainRecord[]).map(
      (staffMember) => {
        const id = String(staffMember._id);
        const scheduledHours = scheduledHoursByStaff.get(id) ?? 0;
        const minimumHours = Number(staffMember.minimumWeeklyHours ?? 0);
        const targetHours = Number(staffMember.targetWeeklyHours ?? minimumHours);
        const maximumHours = Number(staffMember.maximumWeeklyHours ?? 40);

        return {
          id,
          name: String(staffMember.fullName ?? ""),
          employeeType: String(staffMember.employeeType ?? ""),
          scheduledHours,
          minimumHours,
          targetHours,
          maximumHours,
          hoursShortOfTarget: Math.max(targetHours - scheduledHours, 0),
          hoursAboveMaximum: Math.max(scheduledHours - maximumHours, 0),
        };
      }
    );

    const totals = dailyMetrics.reduce(
      (current, day) => ({
        clientHoursNeeded: current.clientHoursNeeded + day.clientHoursNeeded,
        clientHoursCovered: current.clientHoursCovered + day.clientHoursCovered,
        staffHoursScheduled: current.staffHoursScheduled + day.staffHoursScheduled,
        additionalLaborHours:
          current.additionalLaborHours + day.additionalLaborHours,
        uncoveredHours: current.uncoveredHours + day.uncoveredHours,
      }),
      {
        clientHoursNeeded: 0,
        clientHoursCovered: 0,
        staffHoursScheduled: 0,
        additionalLaborHours: 0,
        uncoveredHours: 0,
      }
    );

    const coveragePercent =
      totals.clientHoursNeeded === 0
        ? 100
        : (totals.clientHoursCovered / totals.clientHoursNeeded) * 100;

    return NextResponse.json({
      weekStart,
      dailyMetrics,
      totals: {
        ...totals,
        coveragePercent,
      },
      staffHourStatus,
    });
  } catch (error) {
    console.error("Failed to build weekly overview:", error);

    return NextResponse.json(
      { error: "Weekly overview could not be calculated." },
      { status: 500 }
    );
  }
}
