import { NextResponse } from "next/server";

import { calculateSchedulerReadiness } from "@/features/scheduler/engine/preflight";
import { buildDaySchedulerInput } from "@/features/scheduler/server/buildDaySchedulerInput";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const locationId = url.searchParams.get("locationId")?.trim();
    const date = url.searchParams.get("date")?.trim();

    if (!locationId || !date) {
      return NextResponse.json(
        { error: "locationId and date are required." },
        { status: 400 }
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: "Date must use YYYY-MM-DD format." },
        { status: 400 }
      );
    }

    const dayData = await buildDaySchedulerInput(locationId, date);
    const readiness = calculateSchedulerReadiness(
      dayData.input,
      dayData.extendedRules
    );

    return NextResponse.json({
      success: true,
      locationId,
      date,
      readiness,
    });
  } catch (error) {
    console.error("Scheduler preflight failed:", error);

    return NextResponse.json(
      { error: "Daily scheduler readiness could not be calculated." },
      { status: 500 }
    );
  }
}
