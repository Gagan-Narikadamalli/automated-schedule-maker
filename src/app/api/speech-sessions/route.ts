import { NextResponse } from "next/server";

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
import { SpeechSession } from "@/models/SpeechSession";

type SpeechSessionRequest = {
  locationId?: string;
  clientId?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  recurringSeriesId?: string;
  note?: string;
};

function serializeSpeechSession(session: Record<string, unknown>) {
  return {
    ...session,
    id: String(session._id),
    _id: undefined,
    locationId: String(session.locationId),
    clientId: String(session.clientId),
  };
}

export async function GET(request: Request) {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  const url = new URL(request.url);
  const locationId = url.searchParams.get("locationId");
  const date = url.searchParams.get("date");

  if (!locationId || !date) {
    return NextResponse.json(
      { error: "locationId and date are required." },
      { status: 400 }
    );
  }

  if (!sessionCanAccessLocation(auth.session, locationId)) {
    return forbiddenResponse("You do not have access to this location.");
  }

  try {
    await connectToDatabase();

    const sessions = await SpeechSession.find({ locationId, date })
      .populate("clientId", "displayCode color fullName")
      .sort({ startTime: 1 })
      .lean();

    return NextResponse.json({
      speechSessions: sessions.map((session) => ({
        ...serializeSpeechSession(
          session as unknown as Record<string, unknown>
        ),
        client:
          typeof session.clientId === "object" && session.clientId
            ? session.clientId
            : null,
      })),
    });
  } catch (error) {
    console.error("Failed to load speech sessions:", error);

    return NextResponse.json(
      { error: "Speech sessions could not be loaded." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  if (!sessionHasAnyRole(auth.session, SCHEDULE_WRITE_ROLES)) {
    return forbiddenResponse();
  }

  try {
    const body = (await request.json()) as SpeechSessionRequest;
    const locationId = body.locationId?.trim();
    const clientId = body.clientId?.trim();
    const date = body.date?.trim();
    const startTime = body.startTime?.trim();
    const endTime = body.endTime?.trim();

    if (!locationId || !clientId || !date || !startTime || !endTime) {
      return NextResponse.json(
        {
          error:
            "Location, client, date, start time, and end time are required.",
        },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    if (endTime <= startTime) {
      return NextResponse.json(
        { error: "Speech end time must be later than start time." },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const client = await Client.findOne({
      _id: clientId,
      locationId,
      active: true,
    });

    if (!client) {
      return NextResponse.json(
        { error: "The selected active client was not found at this location." },
        { status: 404 }
      );
    }

    const speechSession = await SpeechSession.create({
      locationId,
      clientId,
      date,
      startTime,
      endTime,
      recurringSeriesId: body.recurringSeriesId?.trim() || "",
      note: body.note?.trim() || "",
    });

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: "CREATE",
      entityType: "SPEECH_SESSION",
      entityId: String(speechSession._id),
      summary: `Added speech for ${client.displayCode} on ${date} at ${startTime}.`,
      after: speechSession.toObject(),
    });

    return NextResponse.json(
      {
        speechSession: serializeSpeechSession(
          speechSession.toObject() as unknown as Record<string, unknown>
        ),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to create speech session:", error);

    return NextResponse.json(
      { error: "Speech session could not be created." },
      { status: 500 }
    );
  }
}
