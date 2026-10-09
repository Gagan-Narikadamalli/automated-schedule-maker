import { jsonSchema, tool } from "./schedulerToolDefinition";
import { connectToDatabase } from "@/lib/db";
import { buildDaySchedulerInput } from "@/features/scheduler/server/buildDaySchedulerInput";
import { applyFixedNapSessions } from "@/features/scheduler/server/applyFixedNapSessions";
import { canAssignStaffToClient } from "@/features/scheduler/engine/constraints";
import type { SchedulerAssignment } from "@/features/scheduler/engine/types";
import { ScheduleTemplate } from "@/models/ScheduleTemplate";
import type { SchedulerAiContext } from "./types";

type ProposedBlock = {
  staffId: string;
  clientId: string;
  startTime: string;
  endTime: string;
};
type DraftInput = {
  name: string;
  blocks: ProposedBlock[];
  reasoning?: string;
};
const schema = jsonSchema<DraftInput>({
  type: "object",
  properties: {
    name: { type: "string", description: "A unique name for a proposed AI-learned weekday template." },
    reasoning: { type: "string", description: "Short explanation of the inferred workbook patterns, natural nap handoffs, and chosen caregiver blocks." },
    blocks: { type: "array", minItems: 1, maxItems: 120, items: {
      type: "object", properties: {
        staffId: { type: "string", description: "Exact staff ID from scheduler roster evidence." },
        clientId: { type: "string", description: "Exact client ID from scheduler roster evidence." },
        startTime: { type: "string", description: "HH:MM start (30 minute boundary)." },
        endTime: { type: "string", description: "HH:MM end (exclusive, on a 30 minute boundary)." },
      }, required: ["staffId","clientId","startTime","endTime"], additionalProperties: false,
    } },
  },
  required: ["name","blocks"],
  additionalProperties: false,
});
const DAY_NAMES = ["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"];
function toMinutes(v: string): number | null {
  if (!/^(?:0[0-9]|1[0-9]|2[0-3]):(?:00|30)$/.test(v)) return null;
  const [h,m]=v.split(":").map(Number);return h*60+m;
}
function fmt(t: number): string {return `${String(Math.floor(t/60)).padStart(2,"0")}:${String(t%60).padStart(2,"0")}`;}
export function createPaidTemplateTools(context: SchedulerAiContext) {
  return {
    create_inferred_weekday_template: tool({
      description: "PAID AI ONLY: Save a NEW inferred weekday template using YOUR independent analysis of previously imported Excel workbook patterns. First call analyze_workbook_patterns and inspect current staff/client scheduling context, naps, and call-ins/outs. Specify continuous staff-client blocks rather than 30-minute arbitrary switches. Saves a reusable TEMPLATE ONLY, never edits the live calendar. All proposed slots must pass same-day staff availability, client attendance, unique-coverage, and staff/client relationship validation. Refuse if no safe proposal is possible.",
      inputSchema: schema,
      execute: async ({name,blocks,reasoning}) => {
        const targetDate = context.date;
        const day=DAY_NAMES[new Date(`${targetDate}T12:00:00Z`).getUTCDay()];
        if (!name?.trim() || name.trim().length > 100) return {ok:false,error:"Provide a template name of at most 100 characters."};
        if (blocks.length > 120) return {ok:false,error:"Too many blocks. Divide the proposal into fewer continuous segments."};
        await connectToDatabase();
        const learned = await ScheduleTemplate.countDocuments({locationId:context.locationId,active:true,sourceType:"HISTORICAL_WORKBOOK",dayOfWeek:day});
        if (!learned) return {ok:false,error:`No imported ${day} workbook templates were found. Upload a mapped Excel workbook first; I will not invent training examples.`};
        const base = await buildDaySchedulerInput(context.locationId,targetDate);
        const nap = await applyFixedNapSessions(context.locationId,targetDate,base.input);
        const input=nap.input;
        const staff=new Map(input.staff.map(s=>[s.id,s]));
        const clients=new Map(input.clients.map(c=>[c.id,c]));
        const assignments: SchedulerAssignment[]=[];
        const occupiedStaff=new Set<string>(),occupiedClients=new Set<string>();
        const conflicts:string[]=[];
        for(const block of blocks) {
          const employee=staff.get(block.staffId),client=clients.get(block.clientId);
          if(!employee || !client){conflicts.push(`Unknown/inactive staff or client in ${block.staffId}/${block.clientId}.`);continue;}
          const start=toMinutes(block.startTime),end=toMinutes(block.endTime);
          if(start===null||end===null||end<=start||end-start>300){conflicts.push(`Invalid segment ${block.startTime}-${block.endTime}.`);continue;}
          for(let minute=start;minute<end;minute+=30) {
            const time=fmt(minute),sk=`${block.staffId}|${time}`,ck=`${block.clientId}|${time}`;
            if(occupiedStaff.has(sk)||occupiedClients.has(ck)){
              conflicts.push(`Double booking at ${time} for ${client.displayCode} or ${employee.name}.`);continue;
            }
            const valid=canAssignStaffToClient({
              staffMember:employee,client,startTime:time,
              assignments,rules:input.rules,callOutStaffIds:new Set(input.callOutStaffIds),
              allowSameDayPairRepeat:true,allowCoverageLimitException:true,
            });
            if(!valid.allowed){conflicts.push(`Unavailable, restricted, or outside-attendance pairing: ${employee.name} / ${client.displayCode} at ${time}.`);continue;}
            assignments.push({id:`ai-draft-${block.staffId}-${time}`,staffId:block.staffId,clientId:block.clientId,startTime:time,assignmentType:"CLIENT_1_TO_1",source:"TEMPLATE",locked:false});
            occupiedStaff.add(sk);occupiedClients.add(ck);
          }
        }
        if(conflicts.length)return {ok:false,error:"Proposed template failed validation. Nothing was saved.",conflicts:conflicts.slice(0,30),totalConflicts:conflicts.length};
        if(!assignments.length)return {ok:false,error:"No eligible client blocks; nothing saved."};
        const exists=await ScheduleTemplate.findOne({locationId:context.locationId,dayOfWeek:day,name:name.trim()}).select("_id").lean();
        if(exists)return {ok:false,error:"A template with this weekday and name already exists; choose a new name."};
        const saved=await ScheduleTemplate.create({
          locationId:context.locationId,name:name.trim(),dayOfWeek:day,sourceType:"MANUAL",
          sourceName:"Paid AI inference from imported Excel workbook patterns",sourceDate:targetDate,
          styleNotes:[`Paid AI workbook inference: ${String(reasoning??"").slice(0,600)}`,`Validated against ${targetDate} attendance, staff call-outs, client call-ins/outs, and coverage conflicts.`],
          active:true,learningOnly:false,
          assignments:assignments.map(a=>({
            staffId:a.staffId,clientId:a.clientId,startTime:a.startTime,endTime:fmt((toMinutes(a.startTime)??0)+30),
            assignmentType:a.assignmentType,locked:false,
          })),
        });
        return {ok:true,changed:true,templateId:String(saved._id),name:saved.name,dayOfWeek:day,
          sourceDate:targetDate,createdBlocks:assignments.length,liveScheduleChanged:false,
          message:"AI-inferred weekday template saved after roster and attendance validation. It may be used as an alternative by Auto Generate; the live schedule has not changed."};
      },
    }),
  };
}
