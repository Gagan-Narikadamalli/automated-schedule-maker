import { generateText, Output, jsonSchema } from "ai";
import { getSchedulerModel, schedulerModelOptions } from "./schedulerModelProvider";
import { buildFixedScheduleChoices, decodeFixedScheduleChoices, type FixedScheduleChoices, type FixedScheduleSnapshot } from "./fixedScheduleChoices";
import type { OpenAISchedulePlan } from "./openaiSchedulePlan";
import { INDEPENDENT_AI_PLANNING_PRIORITIES } from "./independentAiPlanningPriorities";

type Stage = Pick<FixedScheduleChoices, "napTimes"|"breakTimes"|"explanation"|"decisions"|"tradeoffs">;
type Batch = {staffByTime: Record<string,string[]>};
const object=(properties:Record<string,unknown>)=>({
  type:"object",additionalProperties:false,properties,required:Object.keys(properties)
});
// Four 30-minute columns per request keep outputs bounded (up to ~80 cells with 20 clients).
const size=4;
const trim=(items:unknown,limit:number)=>Array.isArray(items)?items.slice(0,limit):[];
function compactSnapshot(snapshot:FixedScheduleSnapshot, times?:string[]) {
  const o=snapshot as Record<string,unknown>;
  const selected=new Set(times??[]);
  function relevant(row:unknown) {
    if (!row || typeof row!=="object") return false;
    const item=row as {startTime?:string;endTime?:string};
    return !times || times.some(t=>t>=(item.startTime??"00:00")&&t<(item.endTime??"23:59"));
  }
  return {
    date:o.date,rules:o.rules,
    staff:snapshot.staff.map(s=>({
      ...s,availableSlots:times?s.availableSlots.filter(t=>selected.has(t)):s.availableSlots
    })),
    clients:snapshot.clients.map(c=>({
      ...c,requiredSlots:times?c.requiredSlots.filter(t=>selected.has(t)):c.requiredSlots
    })),
    calledOutStaff:snapshot.calledOutStaff,
    learnedPairingPreferences:trim(o.learnedPairingPreferences,28),
    templates:trim(o.templates,2).map(value=>{
      const t=value as Record<string,unknown>;
      return {sourceType:t.sourceType,isApplied:t.isApplied,
        assignments:trim(t.assignments,90).filter(relevant).slice(0,40),
        napChoices:trim(t.napChoices,40)};
    }),
    referenceAssignments:trim(o.referenceAssignments,180).filter(relevant).slice(0,65),
    currentAssignments:trim(o.currentAssignments,100).filter(relevant).slice(0,30),
    importedWorkbookTraining:o.importedWorkbookTraining,
    planningPriorities:INDEPENDENT_AI_PLANNING_PRIORITIES,
    regenerationPolicy:o.regenerationPolicy
  };
}

/** Reject an impossible event/break pairing before attempting coverage blocks. */
export function validateFixedEventChoices(snapshot:FixedScheduleSnapshot, events:Stage):string[] {
  const problems:string[]=[];
  const calledOut=new Set(snapshot.calledOutStaff??[]);
  const active=snapshot.staff.filter(s=>s.availableSlots.length&&!calledOut.has(s.id));
  // A client's NAP and a therapist's BREAK are separate obligations.
  // Prefer linking them where it improves continuity, but an eligible
  // caregiver may supervise NAP while using a different valid BREAK.
  const byNapTime=new Map<string,string[]>();
  for(const client of snapshot.clients){
    if(!client.napSlots.length)continue;
    const time=events.napTimes[client.id];
    if(!client.napSlots.includes(time)){
      problems.push("Nap start unavailable for "+client.id);
      continue;
    }
    byNapTime.set(time,[...(byNapTime.get(time)??[]),client.id]);
  }
  // Distinct caregivers are still mandatory for simultaneous clients.
  // Do not require those caregivers to take their staff breaks at that time.
  for(const [time,clients] of byNapTime){
    const matched=new Map<string,string>();
    const find=(clientId:string,seen:Set<string>):boolean=>{
      const client=snapshot.clients.find(c=>c.id===clientId)!;
      for(const therapist of active){
        if(!therapist.availableSlots.includes(time)||
          client.excludedStaff?.includes(therapist.id)||
          (therapist.serviceSetting&&client.serviceSetting&&
            therapist.serviceSetting!=="BOTH"&&client.serviceSetting!=="BOTH"&&
            therapist.serviceSetting!==client.serviceSetting)||
          seen.has(therapist.id))continue;
        seen.add(therapist.id);
        const previous=matched.get(therapist.id);
        if(!previous||find(previous,seen)){
          matched.set(therapist.id,clientId);return true;
        }
      }
      return false;
    };
    let count=0;
    for(const clientId of clients)if(find(clientId,new Set()))count++;
    if(count<clients.length)
      problems.push("Not enough distinct eligible nap caregivers at "+time+" for "+clients.join(", "));
  }
  for(const member of active){
    const inWindow=member.availableSlots.filter(t=>
      t>=(snapshot.rules.breakWindowStart??"11:00")&&t<=(snapshot.rules.breakWindowEnd??"14:00"));
    const value=events.breakTimes[member.id];
    if(inWindow.length&&(!value||!inWindow.includes(value)))
      problems.push("Staff break start unavailable for "+member.id);
  }
  return problems;
}

/**
 * Eligible staff for one 30-minute 1:1 or fixed event. Every cell remains an
 * OpenAI CHOICE. We only remove impossible options, never create assignments.
 */
export function fixedCellCandidates(snapshot:FixedScheduleSnapshot,events:Stage,clientId:string,time:string):string[] {
  const c=snapshot.clients.find(x=>x.id===clientId);
  if(!c)return [];
  const nap=c.napSlots.length>0&&events.napTimes[c.id]===time;
  const speech=c.speechSlots.includes(time);
  const out=new Set(snapshot.calledOutStaff??[]);
  return snapshot.staff.filter(s=>
    !out.has(s.id)&&s.availableSlots.includes(time)&&!c.excludedStaff?.includes(s.id)&&
    (!s.serviceSetting||!c.serviceSetting||s.serviceSetting==="BOTH"||
      c.serviceSetting==="BOTH"||s.serviceSetting===c.serviceSetting)&&
    (events.breakTimes[s.id]!==time||nap||speech)
  ).map(s=>s.id);
}

/**
 * One small model response for nap/break choices, then 4 consecutive half-hour
 * columns per response. The whole day is assembled in memory, hard-validated
 * and saved atomically by the existing API; there are NO partial DB writes.
 */
export async function designFixedDayInBatches(snapshot:FixedScheduleSnapshot,corrections:string[]=[],signal?:AbortSignal):Promise<OpenAISchedulePlan>{
  const fixed=buildFixedScheduleChoices(snapshot);
  const props=fixed.schema.properties as Record<string,unknown>;
  const stageSchema=object({
    napTimes:props.napTimes,breakTimes:props.breakTimes,
    explanation:{type:"string"},decisions:{type:"array",items:{type:"string"}},
    tradeoffs:{type:"array",items:{type:"string"}}
  });
  const stagePrompt=JSON.stringify({
    task:"Independently choose feasible 30-minute client nap start times and each eligible staff member's single break start, considering availability and future coverage. A CLIENT NAP and a STAFF BREAK are distinct requirements. Prefer moving a movable staff break onto a supervised client nap (BREAK_NAP) when this improves continuity or frees a slot, but do not require every nap to also be a staff break. Break/nap start windows include their END points. Never invent availability, clients or extra time. Templates show past workable patterns, NOT required assignments or mandatory break times; deviate for better safe coverage and natural handoffs.",
    snapshot:compactSnapshot(snapshot),
    corrections:corrections.slice(0,12)
  });
  async function chooseEvents(prompt:string) {
    const response=await generateText({
      model:getSchedulerModel(),providerOptions:schedulerModelOptions(true,"medium"),abortSignal:signal,
      reasoning:"medium",maxOutputTokens:3000,maxRetries:0,timeout:{totalMs:45000},
      instructions:"Independently plan today's staff breaks and client naps using only provided numbered website aliases. The template is historical evidence and may be rejected entirely. Choose each nap start and each staff break independently, linking a caregiver break to a child's nap when it improves coverage, but not as a prerequisite to supervision. Exactly one valid break per eligible staff and one supervised nap per scheduled child; hard attendance and restrictions always apply. You may bend team, continuity, 4-hour grouping, typical clients/day, and template preferences to achieve better safe coverage. Never invent shifts or double book a person. Explain observable decisions and tradeoffs, not private chain of thought.",
      prompt,output:Output.object({schema:jsonSchema<Stage>(stageSchema)})
    });
    return response.output;
  }
  let events=await chooseEvents(stagePrompt);
  let eventProblems=validateFixedEventChoices(snapshot,events);
  if(eventProblems.length){
    // Limited retry of ONLY the small event plan, not another full-day plan.
    events=await chooseEvents(stagePrompt+"\nRepair these invalid event selections: "+eventProblems.slice(0,12).join("; "));
    eventProblems=validateFixedEventChoices(snapshot,events);
    if(eventProblems.length)throw new Error("OpenAI could not find valid client nap times and staff break starts: "+eventProblems.slice(0,5).join("; "));
  }
  const grid=fixed.grid;
  const allTimes=Object.keys(grid).sort();
  const choices:FixedScheduleChoices={...events,staffByTime:{}};
  const previousClientStaff:Record<string,string>={};
  const allocatedSlots:Record<string,number>={};
  let batchCount=0;
  for(let offset=0;offset<allTimes.length;offset+=size){
    if(signal?.aborted)throw new Error("AI generation cancelled by manager");
    const times=allTimes.slice(offset,offset+size);
    const columns=Object.fromEntries(times.map(time=>[time,Object.keys(grid[time])]));
    const candidateGroups=Object.fromEntries(times.map(time=>[time,
      Object.fromEntries(columns[time].map(client=>[client,fixedCellCandidates(snapshot,events,client,time)]))
    ]));
    const schema=object({staffByTime:object(Object.fromEntries(times.map(time=>[
      time,{type:"array",items:{type:"string"},minItems:columns[time].length,
        maxItems:columns[time].length}
    ])))});
    const prompt=JSON.stringify({
      task:"Make YOUR OWN BEST JUDGMENT for the current date: choose EXACTLY one therapist or UNPLACED per required client half-hour, from allowedStaffForCell. No staff may serve two clients at one time, or serve 1:1 during a plain staff break. A client nap requires a caregiver but need not coincide with that caregiver's break; matching nap/break times produces a linked Break/Nap and frees a later work slot. A caregiver may hand off to ANOTHER client right after the nap. Templates and historical assignments are nonbinding REFERENCE EXAMPLES; do not copy them cell-for-cell unless they really are the best current plan. Prefer safe coverage, contiguous 2–4-hour blocks, few handoffs, preferred staff and frontline BTs, in that order when feasible. Feel free to bend SOFT team, history, typical clients/day, block-length and rotation preferences to fill more valid client cells; NEVER bend shifts, call-outs, hard restrictions, service setting, actual fixed events or 1:1 non-overlap. Preserve continuity across batches when useful, and favor relief assignments that cover more unmet client blocks.",
      date:(snapshot as Record<string,unknown>).date,
      times,orderedClientsByTime:columns,allowedStaffForCell:candidateGroups,
      events:{napTimes:events.napTimes,breakTimes:events.breakTimes,
        speech:Object.fromEntries(snapshot.clients.filter(c=>c.speechSlots.length).map(c=>[c.id,c.speechSlots]))},
      priorBatchClientStaff:previousClientStaff,
      assignedSlotsByStaff:allocatedSlots,
      snapshot:compactSnapshot(snapshot,times),
      corrections:corrections.slice(0,10),
      planningPriorities:INDEPENDENT_AI_PLANNING_PRIORITIES
    });
    async function planBatch(request:string){
      const response=await generateText({
        model:getSchedulerModel(),providerOptions:schedulerModelOptions(true,"low"),abortSignal:signal,
        reasoning:"low",maxOutputTokens:3600,maxRetries:0,timeout:{totalMs:42000},
        instructions:"Independently select the BEST eligible 30-minute therapist assignment for every child. Do not reproduce the workbook template or historical schedule by default: templates are fallible examples and should be overridden when current attendance, uninterrupted coverage, break/naps or better continuity justify it. You may relax soft preferences (team, typical pair counts, rotation patterns, target block lengths) if safe coverage increases, but never break eligibility, hard restrictions, service location, actual attendance, mandatory events or the one-staff-per-slot rule. A nap can be supervised without being that staff member's break. Avoid gratuitous 30-minute changes; make an intentional handoff after nap when it serves another child. Use UNPLACED only if no safe coverage can be assigned. Return exact structured JSON, not narrative. Server validates before save.",
        prompt:request,output:Output.object({schema:jsonSchema<Batch>(schema)})
      });
      return response.output?.staffByTime;
    }
    let batch=await planBatch(prompt);
    function problems(rows:Record<string,string[]>|undefined) {
      const errors:string[]=[];
      for(const time of times) {
        const assignments=rows?.[time],clients=columns[time];
        if(!Array.isArray(assignments)||assignments.length!==clients.length){
          errors.push("Missing assignments for "+time);continue;
        }
        const used=new Set<string>();
        clients.forEach((client,index)=>{
          const staff=assignments[index];
          if(typeof staff!=="string" || (staff!=="UNPLACED"&&!candidateGroups[time][client].includes(staff)) ||
            (staff!=="UNPLACED"&&used.has(staff)))
            errors.push("Invalid or double-booked choice for "+client+" at "+time);
          else if(staff!=="UNPLACED") used.add(staff);
        });
      }
      return errors;
    }
    let errors=problems(batch);
    if(errors.length){
      // Only retry the offending four columns. Never repeat the complete day.
      try {
        batch=await planBatch(prompt+"\nCorrect the following invalid cells without changing other time columns: "+
          errors.slice(0,12).join("; "));
        errors=problems(batch);
      }catch{
        // Remaining non-event coverage can safely stay UNPLACED. Hard events
        // will still be rejected by the independent post-plan validator.
      }
    }
    if(!batch)throw new Error("OpenAI returned no assignments for time columns "+times.join(", "));
    for(const time of times){
      const clients=columns[time];
      const assignments=Array.isArray(batch[time])?batch[time]:[];
      const normalized:string[]=[];
      const used=new Set<string>();
      clients.forEach((client,index)=>{
        const staff=assignments[index];
        const eligible=candidateGroups[time][client];
        // Never use an invalid model choice to invent staff/coverage.
        const valid=typeof staff==="string"&&
          (staff==="UNPLACED"||(eligible.includes(staff)&&!used.has(staff)));
        const value=valid?staff:"UNPLACED";
        normalized.push(value);
        if(value!=="UNPLACED"){
          used.add(value);
          previousClientStaff[client]=value;
          allocatedSlots[value]=(allocatedSlots[value]??0)+1;
        }
      });
      choices.staffByTime[time]=normalized;
    }
    if(errors.length) choices.tradeoffs.push(
      errors.length+" unsafe or conflicting batch choice(s) remained unplaced for manager review."
    );
    batchCount++;
  }
  const result=decodeFixedScheduleChoices(snapshot,choices);
  return {...result,batched:true,planningBatches:batchCount+1};
}
