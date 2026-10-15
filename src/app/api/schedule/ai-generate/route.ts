import { getSchedulerModel, getSchedulerCloudProvider, GEMINI_SETUP_MESSAGE } from "@/features/ai/schedulerModelProvider";
import { NextResponse } from "next/server";
import {
  forbiddenResponse,
  requireApiSession,
  sessionCanAccessLocation,
  sessionHasAnyRole,
  SCHEDULE_WRITE_ROLES,
} from "@/lib/api/auth";
import { buildDaySchedulerInput } from "@/features/scheduler/server/buildDaySchedulerInput";
import { applyHistoricalTraining } from "@/features/scheduler/server/applyHistoricalTraining";
import { persistScheduleReplacementSafely } from "@/features/scheduler/server/persistScheduleReplacementSafely";
import { getEndTimeForSlot } from "@/features/scheduler/engine/dateUtils";
import { connectToDatabase } from "@/lib/db";
import { syncAutoUnplacedGaps } from "@/features/scheduler/server/syncAutoUnplacedGaps";
import { NapSession } from "@/models/NapSession";
import { ScheduleAssignment } from "@/models/ScheduleAssignment";
import { ScheduleTemplate } from "@/models/ScheduleTemplate";
import { AppliedScheduleTemplate } from "@/models/AppliedScheduleTemplate";
import { getSlotsInsideTimeRange } from "@/features/scheduler/engine/dateUtils";
import { designOpenAISchedule, expandOpenAIPlan } from "@/features/ai/openaiSchedulePlan";
import { OPENAI_SETUP_MESSAGE } from "@/features/ai/openaiProvider";

import { validateOpenAIPlan as validatePreview } from "@/features/ai/validateOpenAIPlan";
function invalid(message: string, status = 422) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Independent AI Generate preview. Does not import or call the existing
 * generateSchedule function. Writes only after complete independent validation
 * OpenAI independently chooses placements; the website validates hard constraints.
 * Language-model output is untrusted and is independently checked here.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  const auth = await requireApiSession();
  if (auth.error) return auth.error;
  if (!sessionHasAnyRole(auth.session, SCHEDULE_WRITE_ROLES)) return forbiddenResponse();
  try {
    const body = await request.json() as { locationId?: string; date?: string; save?: boolean };
    const locationId = body.locationId?.trim();
    const date = body.date?.trim();
    if (!locationId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return invalid("A locationId and date (YYYY-MM-DD) are required.", 400);
    }
    if (!sessionCanAccessLocation(auth.session, locationId)) return forbiddenResponse();
    getSchedulerModel(); // Fail clearly before reading data if no server key.
    const dayData = await buildDaySchedulerInput(locationId, date);
    const availabilitySnapshot=JSON.stringify({staff:dayData.input.staff,clients:dayData.input.clients,callOuts:dayData.input.callOutStaffIds,rules:dayData.extendedRules});
    // The normal scheduler excludes fixed speech cells from requiredSlots and
    // leaves napSlots empty until its separate event processing runs.
    // AI Generate needs a complete, independent snapshot before planning.
    await connectToDatabase();
    const napDocuments = await NapSession.find({ locationId, date })
      .select("clientId startTime endTime").lean() as unknown as Array<{
        clientId: unknown;startTime:string;endTime:string
      }>;
    const windows = new Map<string,Set<string>>();
    for(const nap of napDocuments) {
      const id=String(nap.clientId);
      const allowed=getSlotsInsideTimeRange(nap.startTime,nap.endTime);
      const set=windows.get(id)??new Set<string>();
      for(const t of allowed)set.add(t);
      windows.set(id,set);
    }
    dayData.input.clients=dayData.input.clients.map(c=>{
      const napSlots=[...(windows.get(c.id)??new Set<string>())].sort();
      return {...c,napSlots,
        requiredSlots:[...new Set([...c.requiredSlots,...c.speechSlots,...napSlots])].sort()};
    });
    // A specialized OpenAI scheduling prompt operates only on pseudonymous IDs.
    // Database credentials and staff/client names never leave the application.
    // Learn from date-safe imported workbook records already stored in MongoDB.
    // Never use future schedules or the target date as historical examples.
    const historicalTraining=await applyHistoricalTraining(locationId,date,dayData.input);
    const roster=historicalTraining.input;
    const staffRefs = new Map(roster.staff.map((p,i)=>["S"+i,p.id]));
    const clientRefs = new Map(roster.clients.map((p,i)=>["C"+i,p.id]));
    const staffAlias = new Map([...staffRefs].map(([alias,id])=>[id,alias]));
    const clientAlias = new Map([...clientRefs].map(([alias,id])=>[id,alias]));
    const weekday=["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"][new Date(date+"T12:00:00Z").getUTCDay()];
    const [savedTemplates,appliedTemplate]=await Promise.all([
      ScheduleTemplate.find({locationId,dayOfWeek:weekday,active:true})
        .select("_id sourceType learningOnly assignments clientNapSlots learningProfile styleNotes").lean(),
      AppliedScheduleTemplate.findOne({locationId,date}).select("templateId").lean(),
    ]);
    type TemplateRow={_id:unknown;sourceType?:string;learningOnly?:boolean;
      assignments?:Array<{staffId:unknown;clientId?:unknown;startTime:string;assignmentType:string}>;
      clientNapSlots?:Array<{clientId:unknown;startTime:string}>;
      learningProfile?:unknown;styleNotes?:string[]};
    const templates=(savedTemplates as unknown as TemplateRow[]).map(t=>({
      isApplied:String(t._id)===String((appliedTemplate as {templateId?:unknown}|null)?.templateId??""),
      sourceType:t.sourceType,learningOnly:t.learningOnly,
      assignments:(t.assignments??[]).map(a=>({
        staff:staffAlias.get(String(a.staffId)),
        client:a.clientId?clientAlias.get(String(a.clientId)):undefined,
        time:a.startTime,type:a.assignmentType,
      })).filter(a=>a.staff),
      napChoices:(t.clientNapSlots??[]).map(n=>({
        client:clientAlias.get(String(n.clientId)),time:n.startTime,
      })).filter(n=>n.client),
      learningProfile:t.learningProfile,
      styleNotes:(t.styleNotes??[]).slice(0,6).map(note=>note.slice(0,160)),
    }));
    const deidentifiedAssignments=(items:typeof roster.existingAssignments)=>items.map(a=>({
      staff:staffAlias.get(a.staffId),client:a.clientId?clientAlias.get(a.clientId):undefined,
      time:a.startTime,type:a.assignmentType,locked:a.locked,source:a.source,
    })).filter(a=>a.staff);
    const compactHistory=(items:Array<{staff?:string;client?:string;time:string;type:string;locked?:boolean;source?:string}>)=>{
      const segments:Array<{staff:string;client?:string;startTime:string;endTime:string;type:string;locked?:boolean;source?:string}>=[];
      for(const item of [...items].sort((a,b)=>(a.staff??"").localeCompare(b.staff??"")||a.time.localeCompare(b.time))){
        if(!item.staff)continue;
        const last=segments[segments.length-1];
        if(last&&last.staff===item.staff&&last.client===item.client&&last.type===item.type&&last.endTime===item.time&&last.locked===item.locked){last.endTime=getEndTimeForSlot(item.time);}
        else segments.push({staff:item.staff,client:item.client,startTime:item.time,endTime:getEndTimeForSlot(item.time),type:item.type,locked:item.locked,source:item.source});
      }
      return segments;
    };
    const sanitized = {
      date,
      staff:roster.staff.map(p=>({id:staffAlias.get(p.id),role:p.role,teamId:p.teamId?String(p.teamId):undefined,availableSlots:p.availableSlots,
        serviceSetting:p.serviceSetting,maximumDailyHours:p.maximumDailyHours,remainingWeeklyHours:p.maximumWeeklyHours===undefined?undefined:Math.max(0,p.maximumWeeklyHours-(p.scheduledWeeklyClientHoursBeforeDate??0))})),
      clients:roster.clients.map(p=>({id:clientAlias.get(p.id),requiredSlots:p.requiredSlots,
        napSlots:p.napSlots,speechSlots:p.speechSlots,serviceSetting:p.serviceSetting,
        maxConsecutiveBlocksWithSameStaff:p.maxConsecutiveBlocksWithSameStaff,supportLevel:p.supportLevel,teamId:p.teamId?String(p.teamId):undefined,
        excludedStaff:Object.entries(p.staffRelationships).filter(([,kind])=>kind==="HARD_RESTRICTION")
          .map(([id])=>staffAlias.get(id)).filter(Boolean),
        preferredStaff:Object.entries(p.staffRelationships).filter(([,kind])=>kind==="PREFERRED")
          .map(([id])=>staffAlias.get(id)).filter(Boolean)})),
      rules:{
        breakWindowStart:dayData.extendedRules.breakWindowStart,
        breakWindowEnd:dayData.extendedRules.breakWindowEnd,
        defaultBreakMinutes:dayData.extendedRules.defaultBreakMinutes,
        napPreferredMinutes:dayData.extendedRules.napPreferredMinutes,
        speechPreferredMinutes:dayData.extendedRules.speechPreferredMinutes,
        continuityPriority:roster.rules.continuityPriority,
        weekdayTemplatePriority:roster.rules.weekdayTemplatePriority,
        preferStaffContinuity:roster.rules.preferStaffContinuity,
        preferSameTeam:roster.rules.preferSameTeam,
        sameTeamPriority:roster.rules.sameTeamPriority,
        preferredStaffPriority:roster.rules.preferredStaffPriority,
        maximumClientStaffConsecutiveHours:roster.rules.maximumClientStaffConsecutiveHours,
        maximumClientsPerTechPerDay:roster.rules.maximumClientsPerTechPerDay,
        maximumTechsPerClientPerDay:roster.rules.maximumTechsPerClientPerDay,
        preferredClientsPerStaffPerDay:roster.rules.preferredClientsPerStaffPerDay,
        preferredStaffPerClientPerDay:roster.rules.preferredStaffPerClientPerDay,
      },
      // Large literal workbook grids can overwhelm a cloud-model request.
      // Include the applied template first and representative assignment cells.
      templates:[...templates].sort((a,b)=>Number(b.isApplied)-Number(a.isApplied))
        .slice(0,4).map(t=>({...t,assignments:compactHistory(t.assignments).slice(0,180)})),
      currentAssignments:compactHistory(deidentifiedAssignments(roster.existingAssignments)).slice(0,240),
      referenceAssignments:compactHistory(deidentifiedAssignments(roster.referenceAssignments)).slice(0,180),
      learnedPairingPreferences:roster.clients.map(client=>({client:clientAlias.get(client.id),staff:roster.staff.map(staff=>({staff:staffAlias.get(staff.id),score:roster.historicalPatterns?.pairingScores[staff.id+"|"+client.id]??0})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score).slice(0,3)})),
      calledOutStaff:roster.callOutStaffIds.map(id=>staffAlias.get(id)).filter(Boolean),
      importedWorkbookTraining:{matchedScheduleDays:historicalTraining.matchedScheduleDayCount,
        matchedAssignments:historicalTraining.matchedRecordCount},
    };
    let plan = await designOpenAISchedule(sanitized);
    let values = expandOpenAIPlan(plan, staffRefs, clientRefs);
    let audit = validatePreview(roster, values);
    if (audit.problems.length || audit.missing.length) {
      // Feedback stays anonymized. One bounded repair attempt; never silently
      // substitute a deterministic or third-party plan.
      const feedback=[...audit.problems,...audit.missing.map(g=>`Missing ${clientAlias.get(g.clientId)} at ${g.startTime}`)].map(text=>{
        for(const [id,alias] of staffAlias) text=text.replaceAll(id,alias);
        for(const [id,alias] of clientAlias) text=text.replaceAll(id,alias);
        return text;
      });
      plan=await designOpenAISchedule({...sanitized,previousProposal:plan},feedback.slice(0,120));
      values=expandOpenAIPlan(plan,staffRefs,clientRefs);
      audit=validatePreview(roster,values);
    }
    const describe=(text:string)=>text.replace(/\b[SC]\d+\b/g,alias=>{
      const staffId=staffRefs.get(alias),clientId=clientRefs.get(alias);
      return staffId?roster.staff.find(s=>s.id===staffId)?.name??alias:clientId?roster.clients.find(c=>c.id===clientId)?.displayCode??alias:alias;
    });
    plan={...plan,explanation:describe(plan.explanation),decisions:plan.decisions.map(describe),tradeoffs:plan.tradeoffs.map(describe)};
    const data={assignments:values,explanation:plan.explanation};
    const complete=audit.missing.length===0;
    const valid=audit.problems.length===0;
    const placementIssues=audit.missing.map(gap=>({...gap,reason:"AI could not place this required client block safely; manager review needed."}));
    const breakIssues:string[]=[];
    let saved = false;
    let unplacedCount = 0;
    let regenerationSummary: Record<string, number> | undefined;
    if (body.save === true) {
      if (!valid) {
        return NextResponse.json({
          success:false,saved:false,
          error:"AI schedule failed independent validation or a required staff break. Existing schedule preserved.",
          violations:[...audit.problems,...breakIssues],uncoveredRequirements:placementIssues,
        },{status:422});
      }
      if (process.env.SCHEDULER_AI_AUTONOMOUS_WRITES !== "true") {
        return invalid("AI schedule saving is disabled by server configuration; no schedule was changed.",503);
      }
      const latestDay=await buildDaySchedulerInput(locationId,date);
      const latestAvailability=JSON.stringify({staff:latestDay.input.staff,clients:latestDay.input.clients,callOuts:latestDay.input.callOutStaffIds,rules:latestDay.extendedRules});
      const latestNaps=await NapSession.find({locationId,date}).select("clientId startTime endTime").lean();
      if(latestAvailability!==availabilitySnapshot||JSON.stringify(latestNaps)!==JSON.stringify(napDocuments))return invalid("Availability, rules or nap events changed while AI was planning. Please generate again; the saved day was preserved.",409);
      await connectToDatabase();
      // AI Generate currently rebuilds the whole day rather than pinning
      // protected rows inside its optimizer. Until pinning is supported,
      // refuse to overwrite any manual, template-locked or overridden cell.
      const protectedCount = await ScheduleAssignment.countDocuments({
        locationId, date,
        $or: [
          { locked: true },
          { manuallyOverridden: true },
          { source: "MANUAL" },
          { source: "TEMPLATE" }
        ]
      });
      if (protectedCount > 0) {
        return NextResponse.json({
          success: false, saved: false,
          error: `AI Generate cannot replace this date because ${protectedCount} manual/template/protected assignments exist. They remain unchanged. Use Auto Generate's protected-assignment workflow or remove the protected assignments explicitly.`
        }, { status: 409 });
      }
      const replacements = data.assignments.map((assignment) => ({
        locationId,date,
        staffId:assignment.staffId,
        clientId:assignment.clientId || null,
        startTime:assignment.startTime,
        endTime:getEndTimeForSlot(assignment.startTime),
        assignmentType:assignment.assignmentType,
        source:"AUTO",locked:false,manuallyOverridden:false,
        note:"AI Generate",
      }));
      const outcome = await persistScheduleReplacementSafely({
        locationId,date,replacements,replaceableFilter:{}
      });
      if (outcome.blockedEmptyReplacement) {
        return invalid("AI Generate refused an empty replacement; existing schedule preserved.",409);
      }
      unplacedCount = await syncAutoUnplacedGaps(locationId,date,placementIssues.map(p=>({...p,reason:p.reason})),data.assignments.map((a,i)=>({
        id:`ai-${i}`,staffId:a.staffId,clientId:a.clientId??undefined,startTime:a.startTime,
        assignmentType:a.assignmentType,source:"AUTO" as const,locked:false
      })));
      saved = true;
      regenerationSummary = {
        added:outcome.addedCount ?? 0,
        changed:outcome.changedCount ?? 0,
        unchanged:outcome.unchangedCount ?? 0,
        removed:outcome.removedStaleCount ?? 0,
      };
    }
    return NextResponse.json({
      success: valid,
      completeCoverage:complete,
      partialBuild:!complete,
      unplacedCount,
      placementIssues,
      breakIssues,
      previewOnly: !saved,
      saved,
      regenerationSummary,
      provider:getSchedulerCloudProvider(),
      modelUsed:true,
      decisionSummary:plan.decisions,
      tradeoffs:plan.tradeoffs,
      historicalTraining:{matchedScheduleDays:historicalTraining.matchedScheduleDayCount,matchedAssignments:historicalTraining.matchedRecordCount},
      aiPlan: {explanation:plan.explanation,decisions:plan.decisions,tradeoffs:plan.tradeoffs},
      date, locationId,
      assignments: audit.problems.length === 0 ? data.assignments : [],
      metrics: { requiredClientSlots: audit.required, coveredClientSlots: audit.covered,
        uncoveredClientSlots: audit.missing.length,
        coveragePercent: audit.required ? 100 * audit.covered / audit.required : 100 },
      violations: audit.problems,
      uncoveredRequirements: placementIssues,
      explanation: typeof data.explanation === "string" ? data.explanation.slice(0, 4000) : "",
      error: !valid ? "Unable to generate today's complete schedule: more client coverage is required than available eligible staff can provide. Human scheduling decision needed." : undefined,
      message: saved ? (complete ? "Complete AI schedule validated and saved." : `Partial AI schedule saved. ${placementIssues.length} uncovered client blocks added to Unplaced Assignments for human placement.`) : "Validated AI schedule preview; no schedule was overwritten.",
    }, { status: valid ? 200 : 422 });
  } catch (error) {
    if (error instanceof Error && [OPENAI_SETUP_MESSAGE,GEMINI_SETUP_MESSAGE].includes(error.message)) return invalid(error.message,503);
    console.error("AI Schedule preview error:", error);
    return invalid("AI Generate preview failed. The existing schedule was not changed.", 500);
  }
}
