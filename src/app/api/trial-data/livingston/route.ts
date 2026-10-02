import { NextResponse } from "next/server";

import {
  getLivingstonTrialStatus,
  resetLivingstonTrialData,
  seedAndRunLivingstonTrial,
} from "@/features/trial-data/livingstonTrialServer";

type TrialActionRequest = {
  action?: "seed-and-run" | "reset";
};

const INTERNAL_RUN_CONFIRMATION = "RUN_LIVINGSTON_TRIAL_2026";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const run = url.searchParams.get("run");
  const confirmation = url.searchParams.get("confirm");

  try {
    if (
      run === "seed-and-run" &&
      confirmation === INTERNAL_RUN_CONFIRMATION
    ) {
      const result = await seedAndRunLivingstonTrial();

      return NextResponse.json({
        success: true,
        mode: "seed-and-run",
        result,
      });
    }

    const status = await getLivingstonTrialStatus();

    return NextResponse.json({
      success: true,
      status,
    });
  } catch (error) {
    console.error("Livingston trial data request failed:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The Livingston trial data request failed.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as TrialActionRequest;

    if (body.action === "seed-and-run") {
      const result = await seedAndRunLivingstonTrial();

      return NextResponse.json({
        success: true,
        result,
      });
    }

    if (body.action === "reset") {
      const result = await resetLivingstonTrialData();

      return NextResponse.json({
        success: true,
        result,
      });
    }

    return NextResponse.json(
      {
        error: "Use action seed-and-run or reset.",
      },
      { status: 400 }
    );
  } catch (error) {
    console.error("Livingston trial data action failed:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The Livingston trial data action failed.",
      },
      { status: 500 }
    );
  }
}
