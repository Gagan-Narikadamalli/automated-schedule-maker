import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db";
import { WeekdayTemplatePreference } from "@/models/WeekdayTemplatePreference";
import { ScheduleTemplate } from "@/models/ScheduleTemplate";
import { forbiddenResponse, requireApiSession, SCHEDULE_WRITE_ROLES, sessionCanAccessLocation, sessionHasAnyRole } from "@/lib/api/auth";

const DAYS = new Set(["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"]);
export async function GET(request: Request) {
  const auth = await requireApiSession();
  if (auth.error) return auth.error;
  const locationId = new URL(request.url).searchParams.get("locationId") ?? "";
  if (!Types.ObjectId.isValid(locationId)) return NextResponse.json({error:"Valid locationId required."},{status:400});
  if (!sessionCanAccessLocation(auth.session,locationId)) return forbiddenResponse();
  await connectToDatabase();
  const rows = await WeekdayTemplatePreference.find({locationId}).lean();
  return NextResponse.json({ preferences: rows.map((row: any) => ({
    dayOfWeek:row.dayOfWeek, firstTemplateId:String(row.firstTemplateId??""),
    secondTemplateId:String(row.secondTemplateId??""), previousWeekFirst:row.previousWeekFirst !== false
  })) });
}
export async function PUT(request: Request) {
  const auth = await requireApiSession();
  if (auth.error) return auth.error;
  if (!sessionHasAnyRole(auth.session,SCHEDULE_WRITE_ROLES)) return forbiddenResponse();
  const body = await request.json() as {locationId?:string;dayOfWeek?:string;firstTemplateId?:string;secondTemplateId?:string;previousWeekFirst?:boolean};
  const locationId = body.locationId ?? "", dayOfWeek = body.dayOfWeek ?? "";
  if (!Types.ObjectId.isValid(locationId)||!DAYS.has(dayOfWeek)) return NextResponse.json({error:"Valid location and weekday required."},{status:400});
  if (!sessionCanAccessLocation(auth.session,locationId)) return forbiddenResponse();
  if (body.firstTemplateId && body.firstTemplateId===body.secondTemplateId) return NextResponse.json({error:"Choose different templates for first and second priority."},{status:400});
  await connectToDatabase();
  const ids = [body.firstTemplateId,body.secondTemplateId].filter((id): id is string=>Boolean(id));
  if (ids.some(id=>!Types.ObjectId.isValid(id))) return NextResponse.json({error:"Invalid template ID."},{status:400});
  const validCount = await ScheduleTemplate.countDocuments({_id:{$in:ids},locationId,dayOfWeek,active:true,learningOnly:{$ne:true}});
  if(validCount!==ids.length)return NextResponse.json({error:"Selected templates must be active templates for the same clinic and weekday."},{status:400});
  await WeekdayTemplatePreference.findOneAndUpdate({locationId,dayOfWeek},{$set:{
    firstTemplateId:body.firstTemplateId || null,secondTemplateId:body.secondTemplateId || null,
    previousWeekFirst:body.previousWeekFirst!==false
  }},{upsert:true,new:true,runValidators:true});
  return NextResponse.json({success:true});
}
