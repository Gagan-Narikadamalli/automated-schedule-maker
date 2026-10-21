import { getSchedulerModel, getSchedulerCloudProvider } from "@/features/ai/schedulerModelProvider";
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
import { explainUnplacedCoverage } from "@/features/ai/explainUnplacedCoverage";
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
    const body = await request.json() as { locationId?: string; date?: string; save?: boolean; allowProtectedReplacement?: boolean };
    const locationId = body.locationId?.trim();
    const date = body.date?.trim();
    if (!locationId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return invalid("A locationId and date (YYYY-MM-DD) are required.", 400);
    }
    if (!sessionCanAccessLocation(auth.session, locationId)) return forbiddenResponse();
    getSchedulerModel(); // Fail clearly before reading data if no server key.
    const dayData = await buildDaySchedulerInput(locationId, date);
    const availabilitySnapshot=JSON.stringify({staff:dayData.input.staff,clients:dayData.input.clients,callOuts:dayData.input.callOutStaffIds,rules:dayData.extendedRules});
    const scheduleFingerprint=(items:typeof dayData.input.existingAssignments)=>JSON.stringify([...items].sort((a,b)=>a.id.localeCompare(b.id)));
    const scheduleSnapshot=scheduleFingerprint(dayData.input.existingAssignments);
    const protectedCount=dayData.input.existingAssignments.filter(a=>a.locked||a.source==="MANUAL"||a.source==="TEMPLATE").length;
    if(body.save===true&&protectedCount>0&&body.allowProtectedReplacement!==true){
      return NextResponse.json({success:false,saved:false,requiresConfirmation:true,
        confirmationType:"PROTECTED_REGENERATION",protectedCount,
        error:`This date contains ${protectedCount} protected/manual/template assignments. Rebuilding the whole day will replace them. Ask the manager for explicit permission, then retry with allowProtectedReplacement=true. No assignments were changed.`},{status:409});
    }
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
      const napSlots=[...(windows.get(c.id)??new Set<string>())].filter(t=>c.requiredSlots.includes(t)).sort();
      return {...c,napSlots,
        requiredSlots:[...new Set([...c.requiredSlots,...c.speechSlots,...napSlots])].sort()};
    });
    // A specialized OpenAI scheduling prompt operates only on pseudonymous IDs.
    // Database credentials and staff/client names never leave the application.
    // Learn from date-safe imported workbook records already stored in MongoDB.
    // Never use future schedules or the target date as historical examples.
    const historicalTraining=await applyHistoricalTraining(locationId,date,dayData.input);
    const roster=historicalTraining.input;
    const staffRefs = new Map(roster.staff.map((p,i)=>["Staff"+(i+1),p.id]));
    const clientRefs = new Map(roster.clients.map((p,i)=>["Client"+(i+1),p.id]));
    const staffAlias = new Map([...staffRefs].map(([alias,id])=>[id,alias]));
    const clientAlias = new Map([...clientRefs].map(([alias,id])=>[id,alias]));
    const teamAlias = new Map([...new Set([...roster.staff,...roster.clients].map(p=>p.teamId?String(p.teamId):"").filter(Boolean))].map((id,i)=>[id,"Team"+(i+1)]));
    const weekday=["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"][new Date(date+"T12:00:00Z").getUTCDay()];
    const [savedTemplates,appliedTemplate]=await Promise.all([
      ScheduleTemplate.find({locationId,dayOfWeek:weekday,active:true})
        .select("_id sourceType learningOnly assignments clientNapSlots").lean(),
      AppliedScheduleTemplate.findOne({locationId,date}).select("templateId").lean(),
    ]);
    type TemplateRow={_id:unknown;sourceType?:string;learningOnly?:boolean;
      assignments?:Array<{staffId:unknown;clientId?:unknown;startTime:string;assignmentType:string}>;
      clientNapSlots?:Array<{clientId:unknown;startTime:string}>};
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
      useFixedCells:true,
      date,
      regenerationPolicy:"The manager requested a new independently designed day; current assignments are reference evidence and may be reallocated. Hard eligibility and event constraints still apply.",
      staff:roster.staff.map(p=>({id:staffAlias.get(p.id),role:p.role,teamId:p.teamId?teamAlias.get(String(p.teamId)):undefined,availableSlots:p.availableSlots,
        serviceSetting:p.serviceSetting,maximumDailyHours:p.maximumDailyHours,remainingWeeklyHours:p.maximumWeeklyHours===undefined?undefined:Math.max(0,p.maximumWeeklyHours-(p.scheduledWeeklyClientHoursBeforeDate??0))})),
      clients:roster.clients.map(p=>({id:clientAlias.get(p.id),requiredSlots:p.requiredSlots,
        napSlots:p.napSlots,speechSlots:p.speechSlots,serviceSetting:p.serviceSetting,
        maxConsecutiveBlocksWithSameStaff:p.maxConsecutiveBlocksWithSameStaff,supportLevel:p.supportLevel,teamId:p.teamId?teamAlias.get(String(p.teamId)):undefined,
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
        .slice(0,2).map(t=>({...t,assignments:compactHistory(t.assignments).slice(0,140)})),
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
      plan=await designOpenAISchedule({...sanitized,previousProposal:plan.fixedChoices??plan},feedback.slice(0,120));
      values=expandOpenAIPlan(plan,staffRefs,clientRefs);
      audit=validatePreview(roster,values);
    }
    const describe=(text:string)=>text.replace(/\b(?:Staff|Client)\d+\b/g,alias=>{
      const staffId=staffRefs.get(alias),clientId=clientRefs.get(alias);
      return staffId?roster.staff.find(s=>s.id===staffId)?.name??alias:clientId?roster.clients.find(c=>c.id===clientId)?.displayCode??alias:alias;
    });
    plan={...plan,explanation:describe(plan.explanation),decisions:plan.decisions.map(describe),tradeoffs:plan.tradeoffs.map(describe)};
    const data={assignments:values,explanation:plan.explanation};
    const complete=audit.missing.length===0;
    const valid=audit.problems.length===0;
    const placementIssues=explainUnplacedCoverage(roster,values,audit.missing);
    const breakIssues=audit.problems.filter(problem=>/break|nap|speech/i.test(problem));
    const statusLabel=valid ? (complete ? "COMPLETE" : "PARTIAL") : "BLOCKED";
    let saved = false;
    let unplacedCount = 0;
    let regenerationSummary: Record<string, number> | undefined;
    if (body.save === true) {
      if (!valid) {
        return NextResponse.json({
          success:false,saved:false,
          error:"AI generated hard-rule conflicts or missed a required staff break, nap, or speech session. Existing schedule preserved.",
          violations:audit.problems,uncoveredRequirements:placementIssues,
          managerSummary:{status:"BLOCKED",saved:false,requiredClientSlots:audit.required,coveredClientSlots:audit.covered,
            unplacedClientSlots:placementIssues.length,unplaced:placementIssues.slice(0,30),issues:audit.problems.slice(0,30)},
        },{status:422});
      }
      if (process.env.SCHEDULER_AI_AUTONOMOUS_WRITES !== "true") {
        return invalid("AI schedule saving is disabled by server configuration; no schedule was changed.",503);
      }
      const latestDay=await buildDaySchedulerInput(locationId,date);
      const latestAvailability=JSON.stringify({staff:latestDay.input.staff,clients:latestDay.input.clients,callOuts:latestDay.input.callOutStaffIds,rules:latestDay.extendedRules});
      const latestNaps=await NapSession.find({locationId,date}).select("clientId startTime endTime").lean();
      if(latestAvailability!==availabilitySnapshot||JSON.stringify(latestNaps)!==JSON.stringify(napDocuments))return invalid("Availability, rules or nap events changed while AI was planning. Please generate again; the saved day was preserved.",409);
      if(scheduleFingerprint(latestDay.input.existingAssignments)!==scheduleSnapshot)return invalid("The saved schedule changed while AI was planning. Generate again to avoid overwriting another edit.",409);
      await connectToDatabase();
      // Recheck protected rows immediately before the save. The ordinary
      // button cannot replace them without a manager-authorized retry.
      const latestProtectedCount = await ScheduleAssignment.countDocuments({
        locationId, date,
        $or: [
          { locked: true },
          { manuallyOverridden: true },
          { source: "MANUAL" },
          { source: "TEMPLATE" }
        ]
      });
      if (latestProtectedCount > 0 && body.allowProtectedReplacement !== true) {
        return NextResponse.json({
          success: false, saved: false,
          error: `AI Generate requires explicit permission to replace ${latestProtectedCount} protected assignments. They remain unchanged.`
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
      managerSummary:{
        status:statusLabel,saved,requiredClientSlots:audit.required,coveredClientSlots:audit.covered,
        unplacedClientSlots:placementIssues.length,unplacedCreated:unplacedCount,
        unplaced:placementIssues.slice(0,40),unresolvedMandatoryEvents:breakIssues,
        summary:complete?"All required client and event blocks placed and independently validated.":
          `${placementIssues.length} client/event block(s) need manager review; the remaining assignments passed independent safety validation.`,
      },
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
      error: !valid ? "The AI proposal still has scheduling conflicts after correction. It was not saved; manager review or another proposal is needed." : undefined,
      message: saved ? (complete ? "Complete AI schedule validated and saved." : `Partial AI schedule saved. ${placementIssues.length} uncovered client blocks added to Unplaced Assignments for human placement.`) : "Validated AI schedule preview; no schedule was overwritten.",
    }, { status: valid ? 200 : 422 });
  } catch (error) {
    if (error instanceof Error && [OPENAI_SETUP_MESSAGE].includes(error.message)) return invalid(error.message,503);
    console.error("AI Schedule preview error:", error);
    const status=error&&typeof error==="object"&&"statusCode" in error?Number(error.statusCode):undefined;
    if(status===401||status===403)return invalid("OpenAI rejected the API key or model permission. Check OpenAI project access; saved schedule unchanged.",503);
    if(status===404)return invalid("OpenAI could not find the configured model. Check OPENAI_SCHEDULER_MODEL; saved schedule unchanged.",503);
    if(status===429)return invalid("OpenAI quota or rate limit reached. Check usage and retry later; saved schedule unchanged.",503);
    if(status!==undefined&&status>=500)return invalid("OpenAI service is temporarily unavailable. Saved schedule unchanged.",503);
    if(error instanceof Error&&/timeout|abort/i.test(error.name))return invalid("AI planning took too long. Please try again; the saved schedule was not changed.",504);
    const issue=error instanceof Error?error.message:"";
    return invalid(/schema|json|output.*parse|no output|too many segments|unknown staff\/client alias/i.test(issue)
      ?"OpenAI did not produce a valid structured schedule. No schedule was changed; retry generation."
      :"OpenAI schedule generation could not complete. No schedule was changed. Run Test OpenAI connection in Schedule Assistant.",500);
  }
}
