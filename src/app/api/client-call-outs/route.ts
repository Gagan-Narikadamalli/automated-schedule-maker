import { NextResponse } from "next/server";
import { requireApiSession, sessionCanAccessLocation, sessionHasAnyRole, SCHEDULE_WRITE_ROLES, forbiddenResponse } from "@/lib/api/auth";
import { writeAuditLog } from "@/lib/api/audit";
import { connectToDatabase } from "@/lib/db";
import { Client } from "@/models/Client";
import { ClientCallOut } from "@/models/ClientCallOut";

export async function GET(request: Request) {
  const auth = await requireApiSession();
  if (auth.error) return auth.error;
  const url = new URL(request.url);
  const locationId = url.searchParams.get("locationId");
  const date = url.searchParams.get("date");
  if (!locationId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Valid location and date required." }, { status: 400 });
  if (!sessionCanAccessLocation(auth.session, locationId)) return forbiddenResponse("You do not have access to this location.");
  try {
    await connectToDatabase();
    const rows = await ClientCallOut.find({ locationId, date }).select("clientId").lean();
    return NextResponse.json({ selectedClientIds: rows.map((row) => String(row.clientId)) });
  } catch (error) {
    console.error("Failed to load client call-outs:", error);
    return NextResponse.json({ error: "Client call-outs could not be loaded." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await requireApiSession();
  if (auth.error) return auth.error;
  if (!sessionHasAnyRole(auth.session, SCHEDULE_WRITE_ROLES)) return forbiddenResponse();
  try {
    const body = await request.json() as { locationId?: string; date?: string; clientIds?: string[] };
    const locationId = body.locationId?.trim();
    const date = body.date?.trim();
    if (!locationId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Valid location and date required." }, { status: 400 });
    if (!sessionCanAccessLocation(auth.session, locationId)) return forbiddenResponse("You do not have access to this location.");
    const clientIds = [...new Set((body.clientIds ?? []).map((id) => String(id).trim()).filter(Boolean))];
    await connectToDatabase();
    const validClients = await Client.find({ locationId, active: true, _id: { $in: clientIds } }).select("_id").lean();
    if (validClients.length !== clientIds.length) return NextResponse.json({ error: "A selected client is invalid or inactive." }, { status: 400 });
    const previous = await ClientCallOut.find({ locationId, date }).lean();
    const beforeIds = new Set(previous.map((row) => String(row.clientId)));
    await ClientCallOut.deleteMany({ locationId, date, clientId: { $nin: clientIds } });
    if (clientIds.length) await ClientCallOut.bulkWrite(clientIds.map((clientId) => ({ updateOne: { filter: { locationId, date, clientId }, update: { $setOnInsert: { locationId, date, clientId, reason: "Call out" } }, upsert: true } })));
    const nextIds = new Set(clientIds);
    await writeAuditLog({ locationId, userId: auth.session.userId, action: "SYNC", entityType: "CLIENT_CALL_OUT_DAY", entityId: date, summary: `Updated client call-outs for ${date}: ${clientIds.length} clients out.`, before: previous, after: clientIds });
    return NextResponse.json({ success: true, selectedClientIds: clientIds, addedCount: clientIds.filter((id) => !beforeIds.has(id)).length, removedCount: [...beforeIds].filter((id) => !nextIds.has(id)).length });
  } catch (error) {
    console.error("Failed to save client call-outs:", error);
    return NextResponse.json({ error: "Client call-outs could not be saved." }, { status: 500 });
  }
}
