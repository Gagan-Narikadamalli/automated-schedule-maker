import { NextResponse } from "next/server";
import { requireApiSession, forbiddenResponse, sessionHasAnyRole, sessionCanAccessLocation, SCHEDULE_WRITE_ROLES } from "@/lib/api/auth";
import { writeAuditLog } from "@/lib/api/audit";
import { connectToDatabase } from "@/lib/db";
import { ScheduleAssignment } from "@/models/ScheduleAssignment";
import { UnplacedAssignment } from "@/models/UnplacedAssignment";

type RequestBody={locationId?:string;date?:string;confirmation?:string};
const VALID_DATE=/^\d{4}-\d{2}-\d{2}$/;

export async function POST(request:Request){
  const auth=await requireApiSession();
  if(auth.error)return auth.error;
  if(!sessionHasAnyRole(auth.session,SCHEDULE_WRITE_ROLES))return forbiddenResponse();
  try{
    const body=await request.json() as RequestBody;
    const locationId=body.locationId?.trim();
    const date=body.date?.trim();
    if(!locationId||!date||!VALID_DATE.test(date)||!Number.isFinite(Date.parse(date+"T12:00:00Z")))
      return NextResponse.json({error:"A valid location and selected date are required."},{status:400});
    if(body.confirmation!==`DELETE_SCHEDULE:${date}`)
      return NextResponse.json({error:"Date-specific deletion confirmation is required."},{status:400});
    if(!sessionCanAccessLocation(auth.session,locationId))return forbiddenResponse("You do not have access to this location.");
    await connectToDatabase();
    // Only date-scoped scheduled cells and its generated unplaced tray records.
    // Staff, clients, call-outs, saved templates and other dates are untouched.
    const deleted=await ScheduleAssignment.deleteMany({locationId,date});
    const deletedUnplaced=await UnplacedAssignment.deleteMany({locationId,date});
    await writeAuditLog({
      locationId,userId:auth.session.userId,action:"DELETE_DAY_SCHEDULE",
      entityType:"SCHEDULE_DAY",entityId:date,
      summary:`Deleted ${deleted.deletedCount} schedule cells and ${deletedUnplaced.deletedCount} unplaced tray records for ${date}.`,
      after:{date,deletedAssignmentCount:deleted.deletedCount,deletedUnplacedCount:deletedUnplaced.deletedCount},
    });
    return NextResponse.json({success:true,date,deletedAssignmentCount:deleted.deletedCount,
      deletedUnplacedCount:deletedUnplaced.deletedCount});
  }catch(error){
    console.error("Delete selected day schedule failed",error);
    return NextResponse.json({error:"Unable to delete selected date schedule. No other dates were targeted."},{status:500});
  }
}
