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
import { ClientAttendanceException } from "@/models/ClientAttendanceException";
import { AttendanceOverride } from "@/models/AttendanceOverride";
import { getEligibleClientNapStarts, type ClientNapAttendanceChange } from "@/features/fixed-events/napAttendanceEligibility";
import { NapSession } from "@/models/NapSession";

type NapPriorityCategory = "YOUNGER" | "OLDER";

type NapSessionRequest = {
  locationId?: string;
  clientId?: string;
  clientIds?: string[];
  date?: string;
  startTime?: string;
  endTime?: string;
  priorityCategory?: NapPriorityCategory;
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

const DAY_NAMES = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];

const NAP_WINDOW_START = "11:30";
const NAP_WINDOW_END = "14:00";

function serializeNapSession(session: PlainRecord) {
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
          color: String(client.color ?? "#D9F4EE"),
        }
      : null,
    date: String(session.date),
    startTime: String(session.startTime),
    endTime: String(session.endTime),
    priorityCategory:
      String(session.priorityCategory ?? "OLDER") === "YOUNGER"
        ? "YOUNGER"
        : "OLDER",
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

function sessionClientId(session: PlainRecord): string {
  const client=session.clientId;
  return String(client && typeof client==="object" ? client._id??client.id??"" : client??"");
}

function attendanceLookup(
  changes: PlainRecord[],
  overrides: PlainRecord[]
) {
  const changesByKey=new Map<string,ClientNapAttendanceChange[]>();
  const overridesByKey=new Map<string,{mode:"IN"|"OUT";startTime:string;endTime:string}>();
  for(const item of changes) {
    const key=`${String(item.clientId)}|${String(item.date)}`;
    changesByKey.set(key,[...(changesByKey.get(key)??[]),{
      changeType:item.changeType==="CALL_IN"?"CALL_IN":"CALL_OUT",
      startTime:String(item.startTime),endTime:String(item.endTime)
    }]);
  }
  for(const item of overrides) {
    const key=`${String(item.personId)}|${String(item.date)}`;
    overridesByKey.set(key,{
      mode:item.mode==="IN"?"IN":"OUT",
      startTime:String(item.startTime),endTime:String(item.endTime)
    });
  }
  return {changesByKey,overridesByKey};
}

function isThirtyMinuteBoundary(time: string): boolean {
  return /^([01]\d|2[0-3]):(00|30)$/.test(time);
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

    const sessions = await NapSession.find({
      locationId,
      ...dateQuery,
    })
      .populate("clientId", "displayCode color")
      .sort({ date: 1, priorityCategory: 1, startTime: 1 })
      .lean();

    // Older bulk-created series may contain dates on which an individual
    // child never attends. Do not display these as scheduled naps. Re-evaluate
    // against current attendance to reflect later call-ins/outs safely.
    const rawSessions=sessions as unknown as PlainRecord[];
    const ids=[...new Set(rawSessions.map(sessionClientId))].filter(Boolean);
    if(!ids.length)return NextResponse.json({napSessions:[],attendanceFilteredCount:0});
    const dateFilter=date?{date}:{date:{$gte:startDate,$lte:endDate}};
    const [clientDocuments,changes,overrides]=await Promise.all([
      Client.find({_id:{$in:ids},locationId,active:true})
        .select("_id attendancePatterns startDate endDate").lean(),
      ClientAttendanceException.find({locationId,clientId:{$in:ids},...dateFilter}).lean(),
      AttendanceOverride.find({locationId,personType:"client",personId:{$in:ids},...dateFilter}).lean(),
    ]);
    const clientsById=new Map((clientDocuments as unknown as PlainRecord[])
      .map(client=>[String(client._id),client]));
    const {changesByKey,overridesByKey}=attendanceLookup(
      changes as unknown as PlainRecord[],overrides as unknown as PlainRecord[]
    );
    const visibleSessions=rawSessions.filter(session=>{
      const clientId=sessionClientId(session);
      const client=clientsById.get(clientId);
      if(!client)return false;
      const key=`${clientId}|${String(session.date)}`;
      return getEligibleClientNapStarts(client,String(session.date),
        String(session.startTime),String(session.endTime),
        changesByKey.get(key)??[],overridesByKey.get(key)).length>0;
    });
    return NextResponse.json({
      napSessions:visibleSessions.map(serializeNapSession),
      attendanceFilteredCount:rawSessions.length-visibleSessions.length,
    });
  } catch (error) {
    console.error("Failed to load nap sessions:", error);

    return NextResponse.json(
      { error: "Nap sessions could not be loaded." },
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
    const body = (await request.json()) as NapSessionRequest;
    const locationId = body.locationId?.trim();
    const selectedClientIds = [
      ...new Set(
        [
          ...(Array.isArray(body.clientIds) ? body.clientIds : []),
          body.clientId,
        ]
          .map((value) => value?.trim() ?? "")
          .filter(Boolean)
      ),
    ];
    const startTime = body.startTime?.trim();
    const endTime = body.endTime?.trim();
    const priorityCategory: NapPriorityCategory =
      body.priorityCategory === "YOUNGER" ? "YOUNGER" : "OLDER";

    if (
      !locationId ||
      selectedClientIds.length === 0 ||
      !startTime ||
      !endTime
    ) {
      return NextResponse.json(
        {
          error:
            "Location, at least one client, nap window start, and nap window end are required.",
        },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    if (
      !isThirtyMinuteBoundary(startTime) ||
      !isThirtyMinuteBoundary(endTime)
    ) {
      return NextResponse.json(
        { error: "Nap windows must use 30-minute schedule boundaries." },
        { status: 400 }
      );
    }

    if (
      startTime < NAP_WINDOW_START ||
      endTime > NAP_WINDOW_END ||
      endTime <= startTime
    ) {
      return NextResponse.json(
        {
          error:
            "Nap window must start and finish inside 11:30 AM-2:00 PM.",
        },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const clients = await Client.find({
      _id: { $in: selectedClientIds },
      locationId,
      active: true,
    })
      .select("_id displayCode attendancePatterns startDate endDate")
      .lean();

    if (clients.length !== selectedClientIds.length) {
      return NextResponse.json(
        {
          error:
            "One or more selected active clients were not found at this location.",
        },
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
            "Choose a single nap date or provide a weekly series date range and weekday(s).",
        },
        { status: 400 }
      );
    }

    if (dates.length === 0) {
      return NextResponse.json(
        { error: "No nap dates matched the selected recurrence." },
        { status: 400 }
      );
    }

    if (dates.length * selectedClientIds.length > 500) {
      return NextResponse.json(
        {
          error:
            "One save can create at most 500 client nap occurrences. Reduce the date range or number of selected clients.",
        },
        { status: 400 }
      );
    }

    // Shared recurrence weekdays are a maximum set of eligible days, never
    // a requirement that every child attends on those days.
    const [attendanceChanges,attendanceOverrides]=await Promise.all([
      ClientAttendanceException.find({
        locationId,clientId:{$in:selectedClientIds},date:{$in:dates}
      }).lean(),
      AttendanceOverride.find({
        locationId,personType:"client",personId:{$in:selectedClientIds},
        date:{$in:dates}
      }).lean()
    ]);
    const {changesByKey,overridesByKey}=attendanceLookup(
      attendanceChanges as unknown as PlainRecord[],
      attendanceOverrides as unknown as PlainRecord[]
    );
    const clientRecords=new Map((clients as unknown as PlainRecord[])
      .map(client=>[String(client._id),client]));
    const eligiblePairs: Array<{clientId:string;sessionDate:string}>=[];
    const createdPerClient:Record<string,number>={};
    let skippedCount=0;
    for(const clientId of selectedClientIds) {
      const client=clientRecords.get(clientId);
      if(!client)continue;
      for(const sessionDate of dates) {
        const key=`${clientId}|${sessionDate}`;
        if(getEligibleClientNapStarts(client,sessionDate,startTime,endTime,
          changesByKey.get(key)??[],overridesByKey.get(key)).length===0) {
          skippedCount++;
          continue;
        }
        eligiblePairs.push({clientId,sessionDate});
        createdPerClient[clientId]=(createdPerClient[clientId]??0)+1;
      }
    }
    if(!eligiblePairs.length) {
      return NextResponse.json({error:
        "None of the selected children attend for a complete 30-minute slot within this nap window on the chosen date(s). Check individual client attendance, call-ins/outs, and the nap window."
      },{status:422});
    }
    const createdIds:string[]=[];

    for (const {clientId,sessionDate} of eligiblePairs) {
        // One nap definition per child/day. Saving another shared Nap event for
        // the same child/day updates the window instead of creating duplicate
        // naps for that child.
        const session = await NapSession.findOneAndUpdate(
          {
            locationId,
            clientId,
            date: sessionDate,
          },
          {
            $set: {
              locationId,
              clientId,
              date: sessionDate,
              startTime,
              endTime,
              priorityCategory,
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
    }

    const displayCodes = clients
      .map((client) => String((client as PlainRecord).displayCode ?? ""))
      .filter(Boolean)
      .sort();

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: hasSeriesRequest ? "CREATE_NAP_SERIES" : "CREATE_NAP_SESSION",
      entityType: "NAP_SESSION",
      entityId: recurringSeriesId || createdIds[0],
      summary:
        selectedClientIds.length > 1
          ? `Applied ${startTime}-${endTime} nap window to ${Object.keys(createdPerClient).length} attending clients; skipped ${skippedCount} child/date(s) without eligible attendance.`
          : hasSeriesRequest
            ? `Added ${createdIds.length} recurring nap windows for ${displayCodes[0] ?? "client"} (skipped ${skippedCount} ineligible date(s)).`
            : `Added nap window for ${displayCodes[0] ?? "client"} on ${dates[0]} at ${startTime}.`,
      after: {
        clientIds: selectedClientIds,
        createdPerClient,
        skippedCount,
        dates:eligiblePairs.map(pair=>pair.sessionDate),
        startTime,
        endTime,
        priorityCategory,
        recurringSeriesId,
      },
    });

    return NextResponse.json(
      {
        success: true,
        createdCount: createdIds.length,
        clientCount:Object.keys(createdPerClient).length,
        selectedClientCount:selectedClientIds.length,
        skippedCount,
        createdPerClient,
        dateCount:new Set(eligiblePairs.map(item=>item.sessionDate)).size,
        recurringSeriesId,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to create nap session:", error);

    return NextResponse.json(
      { error: "Nap session could not be created." },
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
    const problem=validateFixedEventEdit("NAP",body);
    if(problem)return NextResponse.json({error:problem},{status:400});

    await connectToDatabase();
    const original=await NapSession.findOne({_id:sessionId,locationId}).lean() as PlainRecord|null;
    if(!original)return NextResponse.json({error:"The event no longer exists. Refresh the page."},{status:404});
    if(scope==="SERIES"&&!original.recurringSeriesId)
      return NextResponse.json({error:"This event is not part of a recurring series."},{status:400});

    const seriesFilter=scope==="SERIES"
      ? {locationId,recurringSeriesId:String(original.recurringSeriesId)}
      : {locationId,_id:sessionId};
    const affected=await NapSession.find(seriesFilter)
      .select("_id clientId date startTime endTime note priorityCategory recurringSeriesId").lean() as PlainRecord[];
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
    const collisions=await NapSession.find({
      locationId,
      _id:{$nin:memberIds},
      clientId:{$in:proposedClientIds},
      date:{$in:proposedDates},
      
    }).select("clientId date startTime").lean() as PlainRecord[];
    if(collisions.some(collision=>members.some(item=>item.clientId===String(collision.clientId)&&item.date===String(collision.date))))
      return NextResponse.json({error:"Another nap event already exists for this client and date."},{status:409});

    const next={
      startTime:body.startTime!.trim(),
      endTime:body.endTime!.trim(),
      note:typeof body.note==="string"?body.note.trim().slice(0,500):"",
      priorityCategory:body.priorityCategory,
      ...(scope==="OCCURRENCE"
        ? {date,clientId,recurringSeriesId:""}
        : {})
    };
    const result=scope==="SERIES"
      ? await NapSession.updateMany(seriesFilter,{$set:next},{runValidators:true})
      : await NapSession.updateOne(seriesFilter,{$set:next},{runValidators:true});
    const updatedCount=scope==="SERIES"?result.modifiedCount:result.matchedCount;
    await writeAuditLog({
      locationId,userId:auth.session.userId,
      action:scope==="SERIES"?"UPDATE_NAP_SERIES":"UPDATE_NAP_SESSION",
      entityType:"NAP_SESSION",
      entityId:scope==="SERIES"?String(original.recurringSeriesId):sessionId,
      summary:`Updated ${affected.length} nap window event(s) at ${next.startTime}-${next.endTime}.`,
      before:affected.map(item=>({id:String(item._id),date:item.date,startTime:item.startTime,
        endTime:item.endTime,clientId:item.clientId})),
      after:{...next,scope,modifiedCount:updatedCount}
    });
    return NextResponse.json({success:true,updatedCount:affected.length,scope,
      scheduleReviewRequired:true});
  }catch(error){
    console.error("Failed to update nap session:",error);
    return NextResponse.json({error:"Nap event could not be updated."},{status:500});
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
        { error: "Location and nap session or recurring series are required." },
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
    const result = await NapSession.deleteMany(filter);

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: recurringSeriesId
        ? "DELETE_NAP_SERIES"
        : "DELETE_NAP_SESSION",
      entityType: "NAP_SESSION",
      entityId: recurringSeriesId || sessionId || "",
      summary: `Removed ${result.deletedCount} nap session(s).`,
      before: { sessionId, recurringSeriesId },
    });

    return NextResponse.json({
      success: true,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("Failed to delete nap session:", error);

    return NextResponse.json(
      { error: "Nap session could not be removed." },
      { status: 500 }
    );
  }
}
