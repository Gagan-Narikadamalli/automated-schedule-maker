import { NextResponse } from "next/server";
import { requireApiSession, sessionCanAccessLocation, sessionHasAnyRole, SCHEDULE_WRITE_ROLES, forbiddenResponse } from "@/lib/api/auth";
import { writeAuditLog } from "@/lib/api/audit";
import { connectToDatabase } from "@/lib/db";
import { AttendanceOverride } from "@/models/AttendanceOverride";
import { CallOut } from "@/models/CallOut";
import { ClientCallOut } from "@/models/ClientCallOut";
import { ClientAttendanceException } from "@/models/ClientAttendanceException";
import { Staff } from "@/models/Staff";
import { Client } from "@/models/Client";

type AttendanceSelection = { personId: string; personType: "staff" | "client"; mode: "IN" | "OUT"; startTime: string; endTime: string };
const TIME = /^(?:[01]\d|2[0-3]):(?:00|30)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_START = "08:00";
const DAY_END = "17:00";

function normalizedLegacyTime(value: string, fallback: string) {
  const time = value || fallback;
  return time < DAY_START ? DAY_START : time > DAY_END ? DAY_END : time;
}

export async function GET(request: Request) {
  const auth = await requireApiSession();
  if (auth.error) return auth.error;
  const search = new URL(request.url).searchParams;
  const locationId = search.get("locationId");
  const date = search.get("date");
  if (!locationId || !date || !DATE.test(date)) return NextResponse.json({ error: "Valid location and date are required." }, { status: 400 });
  if (!sessionCanAccessLocation(auth.session, locationId)) return forbiddenResponse();
  try {
    await connectToDatabase();
    const [saved, legacyStaff, legacyClients, legacyClientChanges] = await Promise.all([
      AttendanceOverride.find({ locationId, date }).lean(),
      CallOut.find({ locationId, date }).lean(),
      ClientCallOut.find({ locationId, date }).lean(),
      ClientAttendanceException.find({ locationId, date }).lean(),
    ]);
    const entries = new Map<string, AttendanceSelection>();
    for (const row of legacyStaff) {
      const personId = String(row.staffId);
      entries.set(`staff:${personId}`, { personType: "staff", personId, mode: "OUT",
        startTime: normalizedLegacyTime(String(row.startTime ?? ""), DAY_START),
        endTime: normalizedLegacyTime(String(row.endTime ?? ""), DAY_END) });
    }
    for (const row of legacyClients) {
      const personId = String(row.clientId);
      entries.set(`client:${personId}`, { personType: "client", personId, mode: "OUT", startTime: DAY_START, endTime: DAY_END });
    }
    for (const row of legacyClientChanges) {
      const personId = String(row.clientId);
      entries.set(`client:${personId}`, { personType: "client", personId,
        mode: row.changeType === "CALL_IN" ? "IN" : "OUT",
        startTime: normalizedLegacyTime(String(row.startTime ?? ""), DAY_START),
        endTime: normalizedLegacyTime(String(row.endTime ?? ""), DAY_END),
      });
    }
    for (const row of saved) {
      const item: AttendanceSelection = {
        personType: row.personType, personId: String(row.personId), mode: row.mode,
        startTime: row.startTime, endTime: row.endTime,
      };
      entries.set(`${item.personType}:${item.personId}`, item);
    }
    return NextResponse.json({ overrides: [...entries.values()] });
  } catch (error) {
    console.error("Failed to load attendance windows:", error);
    return NextResponse.json({ error: "Attendance windows could not be loaded." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await requireApiSession();
  if (auth.error) return auth.error;
  if (!sessionHasAnyRole(auth.session, SCHEDULE_WRITE_ROLES)) return forbiddenResponse();
  try {
    const body = await request.json() as { locationId?: string; date?: string; personType?: "staff" | "client"; overrides?: AttendanceSelection[] };
    const { locationId, date, personType } = body;
    if (!locationId || !date || !DATE.test(date) || !["staff", "client"].includes(personType ?? "") || !Array.isArray(body.overrides)) {
      return NextResponse.json({ error: "A valid date, location, group and list are required." }, { status: 400 });
    }
    if (!sessionCanAccessLocation(auth.session, locationId)) return forbiddenResponse();
    const entries = body.overrides;
    if (entries.some((item) =>
      !item.personId || item.personType !== personType ||
      !["IN", "OUT"].includes(item.mode) ||
      !TIME.test(item.startTime) || !TIME.test(item.endTime) ||
      item.startTime < DAY_START || item.endTime > DAY_END || item.endTime <= item.startTime
    ) || new Set(entries.map((item) => item.personId)).size !== entries.length) {
      return NextResponse.json({ error: "Use one call-in or call-out per person, with 30-minute time boundaries between 8:00 AM and 5:00 PM." }, { status: 400 });
    }
    await connectToDatabase();
    const Model = personType === "staff" ? Staff : Client;
    const valid = await Model.find({ locationId, active: true, _id: { $in: entries.map((item) => item.personId) } }).select("_id").lean();
    if (valid.length !== entries.length) return NextResponse.json({ error: "One or more people are invalid or inactive at this location." }, { status: 400 });

    const before = await AttendanceOverride.find({ locationId, date, personType }).lean();
    await AttendanceOverride.deleteMany({ locationId, date, personType });
    if (entries.length) await AttendanceOverride.insertMany(entries.map((item) => ({
      locationId, date, personType, personId: item.personId,
      mode: item.mode, startTime: item.startTime, endTime: item.endTime,
    })));

    // Keep legacy staff call-out readers and the call-out repair path in sync.
    // Call-ins explicitly remove any existing legacy absence for this date.
    if (personType === "staff") {
      await CallOut.deleteMany({ locationId, date });
      const absences = entries.filter((item) => item.mode === "OUT");
      if (absences.length) await CallOut.insertMany(absences.map((item) => ({
        locationId, date, staffId: item.personId, startTime: item.startTime, endTime: item.endTime,
        reason: "Call out", createdByUserId: auth.session.userId,
      })));
    } else {
      // Client attendance is now slot-specific; full-day legacy absences are migrated.
      await ClientCallOut.deleteMany({ locationId, date });
      await ClientAttendanceException.deleteMany({ locationId, date });
    }
    await writeAuditLog({
      locationId, userId: auth.session.userId, action: "SYNC",
      entityType: "ATTENDANCE_OVERRIDES", entityId: `${personType}:${date}`,
      summary: `Updated ${entries.length} ${personType} attendance override(s) for ${date}.`,
      before, after: entries,
    });
    return NextResponse.json({ success: true, overrides: entries });
  } catch (error) {
    console.error("Failed to save attendance windows:", error);
    return NextResponse.json({ error: "Attendance windows could not be saved." }, { status: 500 });
  }
}
