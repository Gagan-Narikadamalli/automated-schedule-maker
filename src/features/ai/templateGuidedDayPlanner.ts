import {generateText,Output,jsonSchema} from "ai";
import {getSchedulerModel,schedulerModelOptions} from "./schedulerModelProvider";
import {buildFixedScheduleChoices,decodeFixedScheduleChoices,type FixedScheduleSnapshot,type FixedScheduleChoices} from "./fixedScheduleChoices";
import {fixedCellCandidates,validateFixedEventChoices} from "./openaiBatchedDayPlanner";
import type {OpenAISchedulePlan} from "./openaiSchedulePlan";

type Example={staff?:string;client?:string;startTime?:string;endTime?:string;time?:string;type?:string;isApplied?:boolean};
type Decision={
  napTimes:Record<string,string>;breakTimes:Record<string,string>;
  preferredStaffByClient:Record<string,string>;
  decisions:string[];tradeoffs:string[];
};
const object=(properties:Record<string,unknown>)=>({type:"object",additionalProperties:false,required:Object.keys(properties),properties});
const minute=(s:string)=>Number(s.slice(0,2))*60+Number(s.slice(3));
function examples(snapshot:FixedScheduleSnapshot):Example[]{
  const raw=snapshot as Record<string,unknown>;
  const templates=Array.isArray(raw.templates)?raw.templates:[];
  const out:Example[]=[];
  for(const t of templates.slice(0,2)) {
    const item=t as {isApplied?:boolean;assignments?:Example[]};
    for(const a of (item.assignments??[]).slice(0,140))
      out.push({...a,isApplied:!!item.isApplied});
  }
  const refs=Array.isArray(raw.referenceAssignments)?raw.referenceAssignments as Example[]:[];
  return [...out,...refs.slice(0,130)].filter(a=>Boolean(a.staff&&a.startTime&&a.client));
}
const isCoverage=(a:Example)=>a.type==="CLIENT_1_TO_1";
const isLong=(a:Example)=>isCoverage(a)&&minute(a.endTime??a.startTime??"00:00")-minute(a.startTime??"00:00")>=60;
/** The fast path is reserved for real, repeated-length template history. */
export function hasUsefulTemplateEvidence(snapshot:FixedScheduleSnapshot):boolean{
  const all=examples(snapshot);
  return all.filter(isLong).length>=2;
}
function contains(a:Example,time:string){
  return Boolean(a.startTime&&a.startTime<=time&&time<(a.endTime??"00:00"));
}
/** A deterministic, auditable safe draft; templates are hints rather than pinned cells. */
export function buildTemplateGuidedChoices(
  snapshot:FixedScheduleSnapshot,
  proposal?:Partial<Decision>
):FixedScheduleChoices {
  const fixed=buildFixedScheduleChoices(snapshot);
  const refs=examples(snapshot);
  const staff=snapshot.staff.filter(s=>s.availableSlots.length&&
    !(snapshot.calledOutStaff??[]).includes(s.id));
  const napTimes:Record<string,string>={},breakTimes:Record<string,string>={};
  const byId=new Map(snapshot.clients.map(c=>[c.id,c]));
  const allTimes=Object.keys(fixed.grid).sort();
  // A client nap is distinct from a staff break; choose a permitted start and
  // leave nap supervision to the same 1:1 matching logic as other events.
  for(const client of snapshot.clients){
    if(!client.napSlots.length)continue;
    const allowed=[...new Set(client.napSlots)].sort();
    const proposed=proposal?.napTimes?.[client.id];
    const historical=refs.find(a=>a.client===client.id&&
      ["NAP","BREAK_NAP"].includes(a.type??"")&&allowed.includes(a.startTime??""));
    const possible=allowed.filter(time=>staff.some(s=>
      s.availableSlots.includes(time)&&
      !client.excludedStaff?.includes(s.id)&&
      (!s.serviceSetting||!client.serviceSetting||s.serviceSetting==="BOTH"||
        client.serviceSetting==="BOTH"||s.serviceSetting===client.serviceSetting)));
    const preferred=possible.length?possible:allowed;
    napTimes[client.id]=(proposed&&preferred.includes(proposed)?proposed:
      historical&&preferred.includes(historical.startTime!)?historical.startTime!:
      preferred[Math.floor((preferred.length-1)/2)])??allowed[0];
  }
  const breakStart=snapshot.rules.breakWindowStart??"11:00";
  const breakEnd=snapshot.rules.breakWindowEnd??"14:00";
  for(const person of staff){
    const allowed=person.availableSlots.filter(t=>t>=breakStart&&t<=breakEnd);
    if(!allowed.length){breakTimes[person.id]="UNPLACED";continue;}
    const proposed=proposal?.breakTimes?.[person.id];
    // A staff member who covered the child directly before a nap is an
    // especially useful nap-linked-break candidate.
    const templateNap=Object.entries(napTimes).find(([client,time])=>
      allowed.includes(time)&&refs.some(a=>a.staff===person.id&&a.client===client&&
        isCoverage(a)&&contains(a,time)));
    const historical=refs.find(a=>a.staff===person.id&&
      ["BREAK","BREAK_NAP","BREAK_SPEECH"].includes(a.type??"")&&
      allowed.includes(a.startTime??""));
    breakTimes[person.id]=(proposed&&allowed.includes(proposed)?proposed:
      templateNap?templateNap[1]:
      historical?historical.startTime!:
      [...allowed].sort((a,b)=>Math.abs(minute(a)-750)-Math.abs(minute(b)-750))[0]);
  }
  let events={napTimes,breakTimes,explanation:"",decisions:[],tradeoffs:[]};
  if(validateFixedEventChoices(snapshot,events).length) {
    // Never allow model choices to create invalid event times. The independent
    // final validator will still reject impossible mandatory coverage.
    for(const member of staff)if(breakTimes[member.id]!=="UNPLACED"&&
      !member.availableSlots.includes(breakTimes[member.id]))breakTimes[member.id]="UNPLACED";
  }
  const staffByTime:Record<string,string[]>={};
  const last=new Map<string,string>();
  const assigned=new Map<string,number>();
  for(const time of allTimes){
    const clients=Object.keys(fixed.grid[time]);
    const occupied=new Set<string>();
    const choices=new Map<string,string>();
    const priority=(clientId:string)=>{
      const c=byId.get(clientId)!;
      const event=napTimes[clientId]===time||c.speechSlots.includes(time);
      return (event?-50:0)+fixedCellCandidates(snapshot,events,clientId,time).length;
    };
    for(const clientId of [...clients].sort((a,b)=>priority(a)-priority(b))){
      const client=byId.get(clientId)!;
      const candidates=fixedCellCandidates(snapshot,events,clientId,time)
        .filter(id=>!occupied.has(id));
      const score=(id:string)=>{
        const person=staff.find(s=>s.id===id)!;
        const covered=refs.filter(a=>a.staff===id&&a.client===clientId&&
          isCoverage(a)&&contains(a,time));
        const history=covered.some(isLong)?75:covered.length?8:0;
        const lastMatch=last.get(clientId)===id?145:0;
        const preferred=Array.isArray((client as {preferredStaff?:string[]}).preferredStaff)&&
          (client as {preferredStaff?:string[]}).preferredStaff?.includes(id)?35:0;
        const model=proposal?.preferredStaffByClient?.[clientId]===id?100:0;
        const role=(person as {role?:string}).role;
        const frontline=role==="BT"||role==="RBT"?14:role==="INTERN"?8:0;
        const adjacent=refs.some(a=>a.staff===id&&a.client===clientId&&isCoverage(a)&&
          a.endTime===time)?25:0;
        return history+lastMatch+preferred+model+frontline+adjacent-(assigned.get(id)??0)*0.015;
      };
      candidates.sort((a,b)=>score(b)-score(a)||a.localeCompare(b));
      const id=candidates[0]??"UNPLACED";
      choices.set(clientId,id);
      if(id!=="UNPLACED"){
        occupied.add(id);last.set(clientId,id);
        assigned.set(id,(assigned.get(id)??0)+1);
      }
    }
    staffByTime[time]=clients.map(c=>choices.get(c)??"UNPLACED");
  }
  const usedModel=Boolean(proposal);
  return {staffByTime,napTimes,breakTimes,
    explanation:usedModel
      ?"A compact OpenAI decision selected event times and preferred client/therapist pairings. The scheduler used those choices and available template patterns to fill and verify each 30-minute block."
      :"OpenAI planning was too slow. The scheduler prepared a template-informed coverage draft without changing clinical rules. Every assignment must still pass the independent safety validator.",
    decisions:proposal?.decisions?.slice(0,6)??["Prioritized existing multi-hour caregiver/client runs, with safe handoffs and nap-linked breaks where possible."],
    tradeoffs:proposal?.tradeoffs?.slice(0,6)??["Historical templates guided placement but were not copied into unavailable or conflicting cells."]
  };
}
/**
 * One compact OpenAI call for strategic choices, instead of up to 9 sequential
 * full-roster requests. If that call times out, keep an auditable draft; only
 * the existing clinic validator may approve/save that draft.
 */
export async function designTemplateGuidedDay(
  snapshot:FixedScheduleSnapshot,signal?:AbortSignal
):Promise<OpenAISchedulePlan>{
  const fixed=buildFixedScheduleChoices(snapshot);
  const properties=fixed.schema.properties as Record<string,unknown>;
  const staff=snapshot.staff.filter(s=>s.availableSlots.length&&!(snapshot.calledOutStaff??[]).includes(s.id));
  const preferredProperties=Object.fromEntries(snapshot.clients.map(c=>[
    c.id,{type:"string",enum:[...new Set([
      ...staff.filter(s=>c.requiredSlots.some(time=>s.availableSlots.includes(time))&&
        !c.excludedStaff?.includes(s.id)).map(s=>s.id),"UNPLACED"
    ])]}
  ]));
  const schema=object({
    napTimes:properties.napTimes,breakTimes:properties.breakTimes,
    preferredStaffByClient:object(preferredProperties),
    decisions:{type:"array",items:{type:"string"}},
    tradeoffs:{type:"array",items:{type:"string"}}
  });
  const all=examples(snapshot);
  // Keep ONLY meaningful template groups and a compact current-day roster.
  const source={
    date:(snapshot as Record<string,unknown>).date,
    rules:snapshot.rules,
    staff:snapshot.staff.map(s=>({id:s.id,role:(s as {role?:string}).role,
      availableSlots:s.availableSlots,serviceSetting:s.serviceSetting})),
    clients:snapshot.clients.map(c=>({id:c.id,requiredSlots:c.requiredSlots,
      napSlots:c.napSlots,speechSlots:c.speechSlots,
      excludedStaff:c.excludedStaff,serviceSetting:c.serviceSetting,
      preferredStaff:(c as {preferredStaff?:string[]}).preferredStaff})),
    calledOutStaff:snapshot.calledOutStaff,
    historicalContinuousBlocks:all.filter(isLong).slice(0,52),
    historicalBreakHints:all.filter(a=>["BREAK","BREAK_NAP"].includes(a.type??"")).slice(0,26)
  };
  let proposal:Decision|undefined;
  let timedOut=false;
  try {
    const response=await generateText({
      model:getSchedulerModel(),providerOptions:schedulerModelOptions(true,"low"),
      abortSignal:signal,reasoning:"low",maxRetries:0,maxOutputTokens:3200,
      timeout:{totalMs:28000},
      instructions:"Make independent, concise CLINIC scheduling choices using only the provided numbered aliases: one permitted nap start for each client, one permitted staff break start per eligible person, and the preferred primary caregiver for each client. Use historical multi-hour client/staff runs as references when appropriate, not inflexible assignments. An isolated old slot should never break today's continuity. A client nap and staff break are distinct but may be linked when advantageous. Honor availability, call-outs, service-setting restrictions, eligibility, and single-staff occupancy; soft grouping and team preferences may bend to cover more clients. Keep decision summaries short, no private reasoning, and return only schema-compliant JSON.",
      prompt:JSON.stringify(source),
      output:Output.object({schema:jsonSchema<Decision>(schema)})
    });
    proposal=response.output;
  }catch(error){
    if(signal?.aborted)throw error;
    const problem=error instanceof Error?error.name+" "+error.message:String(error);
    // The AI SDK may wrap the underlying timeout/network/JSON error in an
    // unrelated top-level exception name (e.g. NoObjectGeneratedError).
    // Regardless of how it is wrapped, NEVER discard a validated template
    // draft solely because this OPTIONAL strategic suggestion failed.
    timedOut=true;
    console.warn("OpenAI strategic planning unavailable; evaluating template-guided fallback safely:",problem.slice(0,220));
  }
  const choices=buildTemplateGuidedChoices(snapshot,proposal);
  const plan=decodeFixedScheduleChoices(snapshot,choices);
  return {...plan,templateGuided:true,modelUsed:!timedOut,
    planningBatches:proposal?1:0};
}
