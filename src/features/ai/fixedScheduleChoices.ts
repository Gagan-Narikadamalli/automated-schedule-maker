import { getEndTimeForSlot } from "@/features/scheduler/engine/dateUtils";
import type { OpenAISchedulePlan, OpenAIPlanSegment } from "./openaiSchedulePlan";

type Staff = {id:string;availableSlots:string[];serviceSetting?:string};
type Client = {id:string;requiredSlots:string[];napSlots:string[];speechSlots:string[];excludedStaff?:string[];serviceSetting?:string};
export type FixedScheduleSnapshot = {staff:Staff[];clients:Client[];calledOutStaff?:string[];
  rules:{breakWindowStart?:string;breakWindowEnd?:string};[key:string]:unknown};
export type FixedScheduleChoices = {napTimes:Record<string,string>;breakTimes:Record<string,string>;
  staffByTime:Record<string,string[]>;explanation:string;decisions:string[];tradeoffs:string[]};

/** Define the decision space, without choosing any staff, break or nap. */
export function buildFixedScheduleChoices(snapshot:FixedScheduleSnapshot) {
  const calledOut=new Set(snapshot.calledOutStaff??[]);
  const staff=snapshot.staff.filter(s=>s.availableSlots.length&&!calledOut.has(s.id));
  const clients=new Map(snapshot.clients.map(c=>[c.id,c]));
  const timeClients=new Map<string,string[]>();
  for(const client of snapshot.clients)for(const time of new Set(client.requiredSlots)) {
    timeClients.set(time,[...(timeClients.get(time)??[]),client.id]);
  }
  const object=(properties:Record<string,unknown>)=>({type:"object",additionalProperties:false,properties,required:Object.keys(properties)});
  const candidateSets:Record<string,string[]>={};
  const candidateKeys=new Map<string,string>();
  const grid:Record<string,Record<string,string>>={};
  const timeProperties:Record<string,unknown>={};
  for(const [time,ids] of [...timeClients].sort(([a],[b])=>a.localeCompare(b))) {
    grid[time]={};
    for(const id of ids) {
      const client=clients.get(id)!;
      const eligible=staff.filter(s=>s.availableSlots.includes(time)&&!client.excludedStaff?.includes(s.id)&&
        (!s.serviceSetting||!client.serviceSetting||s.serviceSetting==="BOTH"||client.serviceSetting==="BOTH"||s.serviceSetting===client.serviceSetting)).map(s=>s.id);
      const signature=eligible.join("|");
      let group=candidateKeys.get(signature);
      if(!group){group=`G${candidateKeys.size+1}`;candidateKeys.set(signature,group);candidateSets[group]=eligible;}
      grid[time][id]=group;
    }
    timeProperties[time]={type:"array",items:{type:"string"},minItems:ids.length,maxItems:ids.length};
  }
  const napProperties=Object.fromEntries(snapshot.clients.filter(c=>c.napSlots.length).map(c=>[c.id,{type:"string",enum:[...new Set(c.napSlots)]}]));
  const breakProperties=Object.fromEntries(staff.map(s=>[s.id,{type:"string",enum:[...s.availableSlots.filter(t=>t>=(snapshot.rules.breakWindowStart??"11:00")&&t<=(snapshot.rules.breakWindowEnd??"14:00")),"UNPLACED"]}]));
  const schema=object({napTimes:object(napProperties),breakTimes:object(breakProperties),staffByTime:object(timeProperties),
    explanation:{type:"string"},decisions:{type:"array",items:{type:"string"}},tradeoffs:{type:"array",items:{type:"string"}}});
  return {schema,grid,candidateSets};
}

/** Convert model-selected fixed cells to website rows. No placements are filled. */
export function decodeFixedScheduleChoices(snapshot:FixedScheduleSnapshot,choices:FixedScheduleChoices):OpenAISchedulePlan {
  const segments:OpenAIPlanSegment[]=[];
  const staffIds=new Set(snapshot.staff.map(s=>s.id));
  const required=new Map<string,Set<string>>();
  for(const client of snapshot.clients)for(const time of client.requiredSlots){
    const ids=required.get(time)??new Set<string>();ids.add(client.id);required.set(time,ids);
  }
  for(const [time,assignments] of Object.entries(choices.staffByTime)) {
    if(!required.has(time))throw new Error("AI returned an extra client/time cell.");
    if(!Array.isArray(assignments)||assignments.length!==required.get(time)!.size)throw new Error("AI returned the wrong number of client cells in a time column.");
  }
  const staffByCell=new Map<string,string>();
  for(const [time,ids] of required) {
    const choicesForTime=choices.staffByTime[time];
    if(!Array.isArray(choicesForTime)||choicesForTime.length!==ids.size)throw new Error("AI omitted a required client/time column.");
    [...ids].forEach((id,index)=>staffByCell.set(`${id}|${time}`,choicesForTime[index]));
  }
  const linkedBreaks=new Set<string>();
  for(const client of snapshot.clients) {
    const nap=choices.napTimes[client.id];
    if(client.napSlots.length&&!client.napSlots.includes(nap))throw new Error("AI returned a nap outside the allowed window.");
    for(const time of new Set(client.requiredSlots)) {
      const staff=staffByCell.get(`${client.id}|${time}`);
      if(!staff||staff==="UNPLACED")continue;
      if(!staffIds.has(staff))throw new Error("AI returned an unknown staff alias.");
      const speech=client.speechSlots.includes(time);
      const type=nap===time?"BREAK_NAP":speech?(choices.breakTimes[staff]===time?"BREAK_SPEECH":"SPEECH"):"CLIENT_1_TO_1";
      segments.push({staff,client:client.id,startTime:time,endTime:getEndTimeForSlot(time),type});
      if(type.startsWith("BREAK"))linkedBreaks.add(`${staff}|${time}`);
    }
  }
  for(const [staff,time] of Object.entries(choices.breakTimes)) {
    if(!staffIds.has(staff))throw new Error("AI returned an unknown break staff alias.");
    if(time!=="UNPLACED"&&!linkedBreaks.has(`${staff}|${time}`))segments.push({staff,client:null,startTime:time,endTime:getEndTimeForSlot(time),type:"BREAK"});
  }
  return {segments,explanation:choices.explanation,decisions:choices.decisions,tradeoffs:choices.tradeoffs,fixedChoices:choices};
}
