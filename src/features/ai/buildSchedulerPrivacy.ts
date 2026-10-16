import { connectToDatabase } from "@/lib/db";
import { Staff } from "@/models/Staff";
import { Client } from "@/models/Client";
import { Team } from "@/models/Team";
import { Location } from "@/models/Location";
import { ScheduleTemplate } from "@/models/ScheduleTemplate";
import { createSchedulerPrivacy, type SchedulerPrivateEntity } from "./schedulerPrivacy";

export async function buildSchedulerPrivacy(locationId: string, locationName?: string) {
  await connectToDatabase();
  const [staff, clients, teams, location, templates] = await Promise.all([
    Staff.find({locationId}).select("_id fullName").sort({_id:1}).lean(),
    Client.find({locationId}).select("_id fullName displayCode").sort({_id:1}).lean(),
    Team.find({locationId}).select("_id name").sort({_id:1}).lean(),
    Location.findById(locationId).select("_id name code").lean(),
    ScheduleTemplate.find({locationId}).select("_id name").sort({_id:1}).lean(),
  ]);
  const rows = (value: unknown) => value as Array<Record<string,unknown>>;
  // First names are also scrubbed when they identify exactly one roster member.
  const firstNames = rows(staff).map(row => String(row.fullName).split(/\s+/)[0]);
  const entities: SchedulerPrivateEntity[] = [
    ...rows(staff).map((row,index) => ({kind:"Staff" as const,id:String(row._id),label:String(row.fullName),
      aliases:firstNames[index].length >= 3 && firstNames.filter(name=>name.toLowerCase()===firstNames[index].toLowerCase()).length===1 ? [firstNames[index]] : []})),
    ...rows(clients).map(row => ({kind:"Client" as const,id:String(row._id),label:String(row.displayCode),fullName:String(row.fullName)})),
    ...rows(teams).map(row => ({kind:"Team" as const,id:String(row._id),label:String(row.name)})),
    ...rows(templates).map(row => ({kind:"Template" as const,id:String(row._id),label:String(row.name)})),
    {kind:"Location",id:locationId,label:String((location as Record<string,unknown>|null)?.name ?? locationName ?? "Clinic"),
      aliases:[locationName ?? "", String((location as Record<string,unknown>|null)?.code ?? "")]},
  ];
  return createSchedulerPrivacy(entities);
}
