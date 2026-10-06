import { isValidObjectId } from "mongoose";
import { NextResponse } from "next/server";

import type { SchedulerAiFeedbackRequest } from "@/features/ai/types";
import {
  forbiddenResponse,
  requireApiSession,
  sessionCanAccessLocation,
} from "@/lib/api/auth";
import { connectToDatabase } from "@/lib/db";
import { AITrainingExample } from "@/models/AITrainingExample";

export async function POST(request: Request) {
  const auth = await requireApiSession();
  if (auth.error) return auth.error;

  try {
    const body = (await request.json()) as SchedulerAiFeedbackRequest;
    const trainingExampleId = body.trainingExampleId?.trim() ?? "";
    const correction = body.correction?.trim().slice(0, 4000) ?? "";

    if (!trainingExampleId || typeof body.accepted !== "boolean") {
      return NextResponse.json(
        { error: "trainingExampleId and accepted are required." },
        { status: 400 }
      );
    }

    if (!isValidObjectId(trainingExampleId)) {
      return NextResponse.json(
        { error: "The scheduler AI training example ID is invalid." },
        { status: 400 }
      );
    }

    await connectToDatabase();
    const example = await AITrainingExample.findById(trainingExampleId);

    if (!example) {
      return NextResponse.json(
        { error: "The scheduler AI training example was not found." },
        { status: 404 }
      );
    }

    const locationId = String(example.locationId);
    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this scheduler location.");
    }

    example.managerAccepted = body.accepted;
    example.managerCorrection = body.accepted ? "" : correction;
    example.userId = auth.session.userId;
    await example.save();

    return NextResponse.json({
      success: true,
      trainingExampleId,
      accepted: body.accepted,
      correctionSaved: !body.accepted && Boolean(correction),
    });
  } catch (error) {
    console.error("Scheduler AI feedback could not be saved:", error);
    return NextResponse.json(
      { error: "Scheduler AI feedback could not be saved." },
      { status: 500 }
    );
  }
}
