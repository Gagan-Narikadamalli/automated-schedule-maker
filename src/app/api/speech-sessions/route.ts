import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { validateFixedEventEdit } from "@/features/fixed-events/validateFixedEventEdit";

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
  seriesStartDate?: string;
  seriesEndDate?: string;
  daysOfWeek?: string[];
  note?: string;
};

type DeleteRequest = {
  locationId?: string;
  sessionId?: string;
  recurringSeriesId?: string;
};

type PlainRecord = Record<string, any>;

function isThirtyMinuteBoundary(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return (
    hours >= 0 &&
    hours <= 23 &&
    (minutes === 0 || minutes === 30)
  );
}

function addThirtyMinutes(value: string): string | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const total = Number(match[1]) * 60 + Number(match[2]) + 30;
  if (total >= 24 * 60) return null;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
    total % 60
  ).padStart(2, "0")}`;
}

const DAY_NAMES = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];

function serializeSpeechSession(session: PlainRecord) {
  const client =
    session.clientId && typeof session.clientId === "object"
      ? session.clientId
      : null;

  return {
    id: String(session._id),
    locationId: String(session.locationId),
    clientId: client
      ? String(client._id ?? client.id ?? "")
      : String(session.clientId ?? ""),
    client: client
      ? {
          id: String(client._id ?? client.id ?? ""),
          displayCode: String(client.displayCode ?? ""),
          color: String(client.color ?? "#DCE9F8"),
        }
      : null,
    date: String(session.date),
    startTime: String(session.startTime),
    endTime: String(session.endTime),
    recurringSeriesId: String(session.recurringSeriesId ?? ""),
    note: String(session.note ?? ""),
  };
}

function enumerateSeriesDates(
  startDate: string,
  endDate: string,
  daysOfWeek: string[]
): string[] {
  const selectedDays = new Set(daysOfWeek.map((day) => day.toUpperCase()));
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  const dates: string[] = [];

  for (
    const cursor = new Date(start);
    cursor.getTime() <= end.getTime();
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const dayName = DAY_NAMES[cursor.getDay()];

    if (selectedDays.has(dayName)) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
  }

  return dates;
}

export async function GET(request: Request) {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  const url = new URL(request.url);
  const locationId = url.searchParams.get("locationId");
  const date = url.searchParams.get("date");
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");

  if (!locationId) {
    return NextResponse.json(
      { error: "locationId is required." },
      { status: 400 }
    );
  }

  if (!date && (!startDate || !endDate)) {
    return NextResponse.json(
      { error: "Provide either date or startDate/endDate." },
      { status: 400 }
    );
  }

  if (!sessionCanAccessLocation(auth.session, locationId)) {
    return forbiddenResponse("You do not have access to this location.");
  }

  try {
    await connectToDatabase();

    const dateQuery = date
      ? { date }
      : {
          date: {
            $gte: startDate,
            $lte: endDate,
          },
        };

    const sessions = await SpeechSession.find({
      locationId,
      ...dateQuery,
    })
      .populate("clientId", "displayCode color")
      .sort({ date: 1, startTime: 1 })
      .lean();

    return NextResponse.json({
      speechSessions: (sessions as unknown as PlainRecord[]).map(
        serializeSpeechSession
      ),
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
    const startTime = body.startTime?.trim();
    const endTime = body.endTime?.trim();

    if (!locationId || !clientId || !startTime || !endTime) {
      return NextResponse.json(
        { error: "Location, client, start time, and end time are required." },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    const expectedEndTime = addThirtyMinutes(startTime);

    if (
      !isThirtyMinuteBoundary(startTime) ||
      !expectedEndTime ||
      endTime !== expectedEndTime
    ) {
      return NextResponse.json(
        {
          error:
            "Speech is a fixed 30-minute event and must start on a 30-minute schedule boundary.",
        },
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

    const hasSeriesRequest = Boolean(
      body.seriesStartDate &&
        body.seriesEndDate &&
        body.daysOfWeek &&
        body.daysOfWeek.length > 0
    );

    let dates: string[] = [];
    let recurringSeriesId = body.recurringSeriesId?.trim() || "";

    if (hasSeriesRequest) {
      const seriesStartDate = body.seriesStartDate!.trim();
      const seriesEndDate = body.seriesEndDate!.trim();

      if (seriesEndDate < seriesStartDate) {
        return NextResponse.json(
          { error: "Series end date must be on or after the start date." },
          { status: 400 }
        );
      }

      dates = enumerateSeriesDates(
        seriesStartDate,
        seriesEndDate,
        body.daysOfWeek ?? []
      );
      recurringSeriesId ||= randomUUID();
    } else if (body.date?.trim()) {
      dates = [body.date.trim()];
    } else {
      return NextResponse.json(
        {
          error:
            "Choose a single speech date or provide a weekly series date range and weekday(s).",
        },
        { status: 400 }
      );
    }

    if (dates.length === 0) {
      return NextResponse.json(
        { error: "No speech dates matched the selected recurrence." },
        { status: 400 }
      );
    }

    if (dates.length > 100) {
      return NextResponse.json(
        { error: "A recurring series cannot create more than 100 sessions at once." },
        { status: 400 }
      );
    }

    const createdIds: string[] = [];

    for (const date of dates) {
      const session = await SpeechSession.findOneAndUpdate(
        {
          locationId,
          clientId,
          date,
          startTime,
          endTime,
        },
        {
          $set: {
            locationId,
            clientId,
            date,
            startTime,
            endTime,
            recurringSeriesId,
            note: body.note?.trim() || "",
          },
        },
        {
          new: true,
          upsert: true,
          runValidators: true,
        }
      );

      createdIds.push(String(session._id));
    }

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: hasSeriesRequest ? "CREATE_SPEECH_SERIES" : "CREATE_SPEECH_SESSION",
      entityType: "SPEECH_SESSION",
      entityId: recurringSeriesId || createdIds[0],
      summary: hasSeriesRequest
        ? `Added ${dates.length} recurring speech sessions for ${client.displayCode}.`
        : `Added speech for ${client.displayCode} on ${dates[0]} at ${startTime}.`,
      after: {
        clientId,
        dates,
        startTime,
        endTime,
        recurringSeriesId,
      },
    });

    return NextResponse.json(
      {
        success: true,
        createdCount: dates.length,
        recurringSeriesId,
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

type UpdateEventRequest = {
  locationId?: string;
  sessionId?: string;
  scope?: "OCCURRENCE" | "SERIES";
  clientId?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  note?: string;
  priorityCategory?: "YOUNGER" | "OLDER";
};

/**
 * Single-event edits become a detached exception to any weekly series.
 * Series edits change time/category/note for its existing members without
 * creating, deleting or silently moving recurrence dates/clients.
 */
export async function PATCH(request: Request) {
  const auth = await requireApiSession();
  if (auth.error) return auth.error;
  if (!sessionHasAnyRole(auth.session,SCHEDULE_WRITE_ROLES)) return forbiddenResponse();

  try {
    const body=(await request.json()) as UpdateEventRequest;
    const locationId=body.locationId?.trim()??"";
    const sessionId=body.sessionId?.trim()??"";
    if(!isValidObjectId(locationId)||!isValidObjectId(sessionId))
      return NextResponse.json({error:"A valid clinic and event are required."},{status:400});
    if(!sessionCanAccessLocation(auth.session,locationId))return forbiddenResponse("You do not have access to this clinic.");

    const scope=body.scope??"OCCURRENCE";
    const problem=validateFixedEventEdit("SPEECH",body);
    if(problem)return NextResponse.json({error:problem},{status:400});

    await connectToDatabase();
    const original=await SpeechSession.findOne({_id:sessionId,locationId}).lean() as PlainRecord|null;
    if(!original)return NextResponse.json({error:"The event no longer exists. Refresh the page."},{status:404});
    if(scope==="SERIES"&&!original.recurringSeriesId)
      return NextResponse.json({error:"This event is not part of a recurring series."},{status:400});

    const seriesFilter=scope==="SERIES"
      ? {locationId,recurringSeriesId:String(original.recurringSeriesId)}
      : {locationId,_id:sessionId};
    const affected=await SpeechSession.find(seriesFilter)
      .select("_id clientId date startTime endTime note recurringSeriesId").lean() as PlainRecord[];
    if(!affected.length)return NextResponse.json({error:"No matching events to edit."},{status:404});

    const date=scope==="OCCURRENCE" ? body.date!.trim() : String(original.date);
    const clientId=scope==="OCCURRENCE" ? body.clientId?.trim()??String(original.clientId) : String(original.clientId);
    if(scope==="OCCURRENCE"){
      if(!isValidObjectId(clientId))return NextResponse.json({error:"Choose a valid client."},{status:400});
      const exists=await Client.exists({_id:clientId,locationId,active:true});
      if(!exists)return NextResponse.json({error:"The selected active client was not found at this clinic."},{status:404});
    }

    const members=affected.map(item=>({
      id:String(item._id),
      clientId:scope==="SERIES"?String(item.clientId):clientId,
      date:scope==="SERIES"?String(item.date):date
    }));
    const memberIds=members.map(item=>item.id);
    const proposedClientIds=[...new Set(members.map(item=>item.clientId))];
    const proposedDates=[...new Set(members.map(item=>item.date))];
    const collisions=await SpeechSession.find({
      locationId,
      _id:{$nin:memberIds},
      clientId:{$in:proposedClientIds},
      date:{$in:proposedDates},
      startTime:body.startTime!.trim(),
    }).select("clientId date startTime").lean() as PlainRecord[];
    if(collisions.some(collision=>members.some(item=>item.clientId===String(collision.clientId)&&item.date===String(collision.date))))
      return NextResponse.json({error:"A speech event already exists for this client at the selected time."},{status:409});

    const next={
      startTime:body.startTime!.trim(),
      endTime:body.endTime!.trim(),
      note:typeof body.note==="string"?body.note.trim().slice(0,500):"",
      
      ...(scope==="OCCURRENCE"
        ? {date,clientId,recurringSeriesId:""}
        : {})
    };
    const result=scope==="SERIES"
      ? await SpeechSession.updateMany(seriesFilter,{$set:next},{runValidators:true})
      : await SpeechSession.updateOne(seriesFilter,{$set:next},{runValidators:true});
    const updatedCount=scope==="SERIES"?result.modifiedCount:result.matchedCount;
    await writeAuditLog({
      locationId,userId:auth.session.userId,
      action:scope==="SERIES"?"UPDATE_SPEECH_SERIES":"UPDATE_SPEECH_SESSION",
      entityType:"SPEECH_SESSION",
      entityId:scope==="SERIES"?String(original.recurringSeriesId):sessionId,
      summary:`Updated ${affected.length} speech appointment event(s) at ${next.startTime}-${next.endTime}.`,
      before:affected.map(item=>({id:String(item._id),date:item.date,startTime:item.startTime,
        endTime:item.endTime,clientId:item.clientId})),
      after:{...next,scope,modifiedCount:updatedCount}
    });
    return NextResponse.json({success:true,updatedCount:affected.length,scope,
      scheduleReviewRequired:true});
  }catch(error){
    console.error("Failed to update speech session:",error);
    return NextResponse.json({error:"Speech event could not be updated."},{status:500});
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  if (!sessionHasAnyRole(auth.session, SCHEDULE_WRITE_ROLES)) {
    return forbiddenResponse();
  }

  try {
    const body = (await request.json()) as DeleteRequest;
    const locationId = body.locationId?.trim();
    const sessionId = body.sessionId?.trim();
    const recurringSeriesId = body.recurringSeriesId?.trim();

    if (!locationId || (!sessionId && !recurringSeriesId)) {
      return NextResponse.json(
        { error: "Location and session or recurring series are required." },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    await connectToDatabase();

    const filter = recurringSeriesId
      ? { locationId, recurringSeriesId }
      : { locationId, _id: sessionId };
    const result = await SpeechSession.deleteMany(filter);

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: recurringSeriesId
        ? "DELETE_SPEECH_SERIES"
        : "DELETE_SPEECH_SESSION",
      entityType: "SPEECH_SESSION",
      entityId: recurringSeriesId || sessionId || "",
      summary: `Removed ${result.deletedCount} speech session(s).`,
      before: { sessionId, recurringSeriesId },
    });

    return NextResponse.json({
      success: true,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("Failed to delete speech session:", error);

    return NextResponse.json(
      { error: "Speech session could not be removed." },
      { status: 500 }
    );
  }
}
