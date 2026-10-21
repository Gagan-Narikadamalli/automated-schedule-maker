import { generateText, Output, jsonSchema } from "ai";
import { getSchedulerModel, schedulerModelOptions } from "./schedulerModelProvider";
import { buildFixedScheduleChoices, decodeFixedScheduleChoices, type FixedScheduleChoices, type FixedScheduleSnapshot } from "./fixedScheduleChoices";
import type { OpenAISchedulePlan } from "./openaiSchedulePlan";

type Stage = Pick<FixedScheduleChoices, "napTimes"|"breakTimes"|"explanation"|"decisions"|"tradeoffs">;
type Batch = {staffByTime: Record<string,string[]>};
const object=(properties:Record<string,unknown>)=>({
  type:"object",additionalProperties:false,properties,required:Object.keys(properties)
});
const size=6;
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
    regenerationPolicy:o.regenerationPolicy
  };
}

/** Reject an impossible event/break pairing before attempting coverage blocks. */
export function validateFixedEventChoices(snapshot:FixedScheduleSnapshot, events:Stage):string[] {
  const problems:string[]=[];
  const calledOut=new Set(snapshot.calledOutStaff??[]);
  const active=snapshot.staff.filter(s=>s.availableSlots.length&&!calledOut.has(s.id));
  for(const client of snapshot.clients){
    if(!client.napSlots.length)continue;
    const time=events.napTimes[client.id];
    if(!client.napSlots.includes(time)){
      problems.push("Nap start unavailable for "+client.id);
      continue;
    }
    const linked=active.filter(staff=>
      staff.availableSlots.includes(time)&&events.breakTimes[staff.id]===time&&
      !client.excludedStaff?.includes(staff.id)&&
      (!staff.serviceSetting||!client.serviceSetting||
        staff.serviceSetting==="BOTH"||client.serviceSetting==="BOTH"||
        staff.serviceSetting===client.serviceSetting));
    if(!linked.length)problems.push("No eligible therapist has their single break linked to the nap of "+client.id+" at "+time);
  }
  // Several clients may need naps simultaneously. Each needs a DISTINCT
  // eligible therapist whose single break is at the same time.
  const byNapTime=new Map<string,string[]>();
  for(const client of snapshot.clients) {
    if(!client.napSlots.length)continue;
    const time=events.napTimes[client.id];
    if(!time)continue;
    byNapTime.set(time,[...(byNapTime.get(time)??[]),client.id]);
  }
  for(const [time,clients] of byNapTime) {
    const matched=new Map<string,string>();
    const find=(clientId:string,seen:Set<string>):boolean=>{
      const c=snapshot.clients.find(x=>x.id===clientId)!;
      for(const staff of active) {
        if(!staff.availableSlots.includes(time) ||
          events.breakTimes[staff.id]!==time ||
          c.excludedStaff?.includes(staff.id) ||
          (staff.serviceSetting&&c.serviceSetting &&
            staff.serviceSetting!=="BOTH"&&c.serviceSetting!=="BOTH" &&
            staff.serviceSetting!==c.serviceSetting) ||
          seen.has(staff.id))continue;
        seen.add(staff.id);
        const prior=matched.get(staff.id);
        if(!prior||find(prior,seen)){matched.set(staff.id,clientId);return true;}
      }
      return false;
    };
    let total=0;
    for(const id of clients)if(find(id,new Set()))total++;
    if(total<clients.length)
      problems.push("Not enough distinct nap-linked therapists at "+time+" for "+clients.join(", "));
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
    (events.breakTimes[s.id]!==time||nap||speech)&&
    (!nap||events.breakTimes[s.id]===time)
  ).map(s=>s.id);
}

/**
 * One small model response for nap/break choices, then 6 consecutive half-hour
 * columns per response. The whole day is assembled in memory, hard-validated
 * and saved atomically by the existing API; there are NO partial DB writes.
 */
export async function designFixedDayInBatches(snapshot:FixedScheduleSnapshot,corrections:string[]=[]):Promise<OpenAISchedulePlan>{
  const fixed=buildFixedScheduleChoices(snapshot);
  const props=fixed.schema.properties as Record<string,unknown>;
  const stageSchema=object({
    napTimes:props.napTimes,breakTimes:props.breakTimes,
    explanation:{type:"string"},decisions:{type:"array",items:{type:"string"}},
    tradeoffs:{type:"array",items:{type:"string"}}
  });
  const stagePrompt=JSON.stringify({
    task:"Choose every fixed client nap start and every eligible staff break start. A nap MUST be linked to one eligible staff whose break starts at exactly the same time. Give each working staff only one break. Break/nap window END is an inclusive START, e.g. 14:00–14:30 is valid if attendance permits. Attend full slot; never fabricate availability. Think globally about how to maximize 1:1 coverage and preserve multi-hour runs. Return choices, not assignments.",
    snapshot:compactSnapshot(snapshot),
    corrections:corrections.slice(0,12)
  });
  async function chooseEvents(prompt:string) {
    const response=await generateText({
      model:getSchedulerModel(),providerOptions:schedulerModelOptions(true,"medium"),
      reasoning:"medium",maxOutputTokens:4500,maxRetries:0,timeout:{totalMs:55000},
      instructions:"You independently plan a therapy-clinic day using only numbered website aliases. Choose one permitted 30-minute nap start for each client with a nap and exactly one valid 30-minute break for each eligible staff. Ensure each nap has an eligible therapist who can have their ONE break at the same slot. NEVER add clients, staff, hours, or appointments. Reflect meaningful decisions only. The backend will hard-validate before saving.",
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
    if(eventProblems.length)throw new Error("OpenAI could not find valid linked naps/breaks: "+eventProblems.slice(0,5).join("; "));
  }
  const grid=fixed.grid;
  const allTimes=Object.keys(grid).sort();
  const choices:FixedScheduleChoices={...events,staffByTime:{}};
  const previousClientStaff:Record<string,string>={};
  const allocatedSlots:Record<string,number>={};
  let batchCount=0;
  for(let offset=0;offset<allTimes.length;offset+=size){
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
      task:"Independently assign EXACTLY one therapist alias or UNPLACED for each client/30-minute cell, time column by time column. Use the exact ordered client lists, and only therapists in allowedStaffForCell. No staff can serve two clients or take a break and provide 1:1 in the same half-hour. An event NAP must be assigned to a therapist whose chosen break is at that time. A speech event may satisfy the therapist's chosen break. Preserve staff/client continuity from priorBatchClientStaff and minimize handoffs and short alternating blocks. Prefer preferred staff, same team, and BTs, but maximize safe 1:1 coverage above soft preferences. Never assign a staff outside the eligible list.",
      date:(snapshot as Record<string,unknown>).date,
      times,orderedClientsByTime:columns,allowedStaffForCell:candidateGroups,
      events:{napTimes:events.napTimes,breakTimes:events.breakTimes,
        speech:Object.fromEntries(snapshot.clients.filter(c=>c.speechSlots.length).map(c=>[c.id,c.speechSlots]))},
      priorBatchClientStaff:previousClientStaff,
      assignedSlotsByStaff:allocatedSlots,
      snapshot:compactSnapshot(snapshot,times),
      corrections:corrections.slice(0,10)
    });
    async function planBatch(request:string){
      const response=await generateText({
        model:getSchedulerModel(),providerOptions:schedulerModelOptions(true,"low"),
        reasoning:"low",maxOutputTokens:5000,maxRetries:0,timeout:{totalMs:48000},
        instructions:"Make concrete slot-by-slot therapist assignments for a pediatric therapy center. Model must choose ALL placements from verified candidates. Choose UNPLACED only when no safe therapist is possible. Never repeat a therapist in the same time column. Give one staff a client continuously rather than arbitrary 30-minute alternation. Do not return narrative; exact JSON schema only. Backend validates all blocks before saving.",
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
      // Only retry the offending six columns. Never repeat the complete day.
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
