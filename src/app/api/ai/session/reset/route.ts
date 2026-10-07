import { NextResponse } from "next/server";

import {
  forbiddenResponse,
  requireApiSession,
  sessionCanAccessLocation,
} from "@/lib/api/auth";
import { connectToDatabase } from "@/lib/db";
import { NativeAiPendingAction } from "@/models/NativeAiPendingAction";

type ResetRequest = {
  locationId?: string;
};

export async function POST(request: Request) {
  const auth = await requireApiSession();
  if (auth.error) return auth.error;

  try {
    const body = (await request.json()) as ResetRequest;
    const locationId = body.locationId?.trim() ?? "";

    if (!locationId) {
      return NextResponse.json(
        { error: "locationId is required." },
        { status: 400 }
      );
    }

    if (
      locationId.startsWith("demo-") ||
      !sessionCanAccessLocation(auth.session, locationId)
    ) {
      return forbiddenResponse(
        "You do not have access to this scheduler location."
      );
    }

    await connectToDatabase();
    const result = await NativeAiPendingAction.deleteMany({
      locationId,
      userId: auth.session.userId,
    });

    return NextResponse.json({
      ok: true,
      pendingActionsCleared: result.deletedCount ?? 0,
    });
  } catch (error) {
    console.error("Scheduler AI session reset failed:", error);
    return NextResponse.json(
      {
        error:
          "The visible chat can still be cleared, but the server could not clear Native Scheduler AI pending state right now.",
      },
      { status: 500 }
    );
  }
}
