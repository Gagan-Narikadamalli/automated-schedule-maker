import type { SchedulerInput } from "@/features/scheduler/engine/types";
export type AiChoices = { ranking?: Record<string,string[]>; naps?: Record<string,string>; explanation?:string };
export type AiCell = {staffId:string;clientId?:string;startTime:string;assignmentType:"CLIENT_1_TO_1"|"BREAK"|"BREAK_NAP"|"BREAK_SPEECH"|"NAP"|"SPEECH"};
const clock=(t:string)=>{const [h,m]=t.split(":").map(Number);return 60*h+m};
export function constructAiSchedule(input:SchedulerInput,choices:AiChoices={}) {
  const people=input.staff.filter(s=>s.availableSlots.length&&!input.callOutStaffIds.includes(s.id));
  const clients=input.clients, availability=new Map(people.map(s=>[s.id,new Set(s.availableSlots)]));
  const eligible=(sid:string,cid:string)=>{
    const s=people.find(x=>x.id===sid),c=clients.find(x=>x.id===cid);
    if(!s||!c||c.staffRelationships[sid]==="HARD_RESTRICTION")return false;
    return !(s.serviceSetting&&c.serviceSetting&&s.serviceSetting!=="BOTH"&&c.serviceSetting!=="BOTH"&&s.serviceSetting!==c.serviceSetting);
  };
  const slots=[...new Set([...clients.flatMap(c=>c.requiredSlots),...people.flatMap(p=>p.availableSlots)])].sort((a,b)=>clock(a)-clock(b));
  const event=new Map<string,"NAP"|"SPEECH">();
  for(const c of clients){
    const nap=c.napSlots.filter(t=>c.requiredSlots.includes(t));
    if(nap.length) {
      const proposed=choices.naps?.[c.id];
      event.set(c.id+"|"+(proposed&&nap.includes(proposed)?proposed:nap[Math.floor(nap.length/2)]),"NAP");
    }
    for(const t of c.speechSlots)if(c.requiredSlots.includes(t))event.set(c.id+"|"+t,"SPEECH");
  }
  const requiredBySlot=(t:string)=>clients.filter(c=>c.requiredSlots.includes(t));
  const lunch=slots.filter(t=>clock(t)>=660&&clock(t)<840);
  const reservations=new Map<string,string>(),reservedCount=new Map(lunch.map(t=>[t,0]));
  const slack=(t:string)=>people.filter(s=>availability.get(s.id)?.has(t)).length-requiredBySlot(t).length-(reservedCount.get(t)??0);
  const noBreak:string[]=[];
  for(const s of [...people].sort((a,b)=>lunch.filter(t=>availability.get(a.id)?.has(t)).length-lunch.filter(t=>availability.get(b.id)?.has(t)).length)){
    const options=lunch.filter(t=>availability.get(s.id)?.has(t)).sort((a,b)=>slack(b)-slack(a)||clock(a)-clock(b));
    if(!options.length){noBreak.push(s.id);continue}
    const selected=options.find(t=>slack(t)>0)??options[0];
    reservations.set(s.id,selected);reservedCount.set(selected,(reservedCount.get(selected)??0)+1);
  }
  // Each selected client nap must be the staff member's one linked break.
  // Reserve a distinct eligible staff break for as many nap events as possible.
  const napEvents=[...event.entries()].filter(([,kind])=>kind==="NAP");
  const linkedNaps=new Map<string,string>();
  const usedNapStaff=new Set<string>();
  for(const [key] of napEvents.sort((a,b)=>{
    const [ca,ta]=a[0].split("|"),[cb,tb]=b[0].split("|");
    const count=(cid:string,t:string)=>people.filter(p=>availability.get(p.id)?.has(t)&&eligible(p.id,cid)).length;
    return count(ca,ta)-count(cb,tb);
  })){
    const [cid,t]=key.split("|");
    const candidates=people.filter(p=>!usedNapStaff.has(p.id)&&availability.get(p.id)?.has(t)&&eligible(p.id,cid))
      .sort((a,b)=>Number(reservations.get(a.id)!==t)-Number(reservations.get(b.id)!==t)||
        (a.availableSlots.length-b.availableSlots.length)||a.id.localeCompare(b.id));
    const selected=candidates[0];
    if(!selected)continue;
    linkedNaps.set(key,selected.id);
    usedNapStaff.add(selected.id);
    const previous=reservations.get(selected.id);
    if(previous)reservedCount.set(previous,Math.max(0,(reservedCount.get(previous)??0)-1));
    reservations.set(selected.id,t);
    reservedCount.set(t,(reservedCount.get(t)??0)+1);
  }
  const assigned:AiCell[]=[],last=new Map<string,string>(),load=new Map(people.map(s=>[s.id,0]));
  const uncovered:{clientId:string;clientCode:string;startTime:string}[]=[];
  for(const t of slots) {
    const occupied=new Map<string,string>(), matched=new Map<string,string>();
    const can=(sid:string,cid:string)=>{
      const s=people.find(p=>p.id===sid);
      return !!s&&availability.get(sid)?.has(t)&&eligible(sid,cid)&&
        (s.maximumDailyHours===undefined||(load.get(sid)??0)<Math.floor(s.maximumDailyHours*2))&&
        (event.get(cid+"|"+t)==="NAP"
          ? linkedNaps.get(cid+"|"+t)===sid && reservations.get(sid)===t
          : reservations.get(sid)!==t || event.get(cid+"|"+t)==="SPEECH");
    };
    const rank=(cid:string,sid:string)=>{
      const index=(choices.ranking?.[cid]??[]).indexOf(sid);return index<0?999:index;
    };
    // Preserve full client/staff runs whenever legal. First reserve the
    // incumbents from the previous half-hour, then match remaining clients.
    // Only displace an incumbent when it is necessary to cover an otherwise
    // unstaffed client (never merely to improve a preference score).
    const clientsAt=requiredBySlot(t).sort((a,b)=>
      people.filter(s=>can(s.id,a.id)).length-people.filter(s=>can(s.id,b.id)).length||
      a.id.localeCompare(b.id));
    for(const c of clientsAt) {
      const sid=last.get(c.id);
      if(sid&&can(sid,c.id)&&!occupied.has(sid)) {
        occupied.set(sid,c.id);
        matched.set(c.id,sid);
      }
    }
    const rank=(cid:string,sid:string)=>{
      const index=(choices.ranking?.[cid]??[]).indexOf(sid);
      return index<0?999:index;
    };
    const templateAffinity=(cid:string,sid:string)=>
      input.referenceAssignments.some(a=>a.clientId===cid&&a.staffId===sid&&
        a.startTime===t&&a.assignmentType==="CLIENT_1_TO_1")?0:1;
    function match(cid:string,seen:Set<string>,allowReassignment:boolean):boolean {
      const candidates=people.filter(s=>can(s.id,cid)).sort((a,b)=>
        Number(occupied.has(a.id))-Number(occupied.has(b.id))||
        templateAffinity(cid,a.id)-templateAffinity(cid,b.id)||
        Number(last.get(cid)!==a.id)-Number(last.get(cid)!==b.id)||
        rank(cid,a.id)-rank(cid,b.id)||
        (load.get(a.id)??0)-(load.get(b.id)??0)||a.id.localeCompare(b.id));
      for(const s of candidates) {
        if(seen.has(s.id))continue;
        seen.add(s.id);
        const previous=occupied.get(s.id);
        if(!previous) {
          occupied.set(s.id,cid);matched.set(cid,s.id);return true;
        }
        if(allowReassignment&&previous!==cid&&match(previous,seen,true)) {
          occupied.set(s.id,cid);matched.set(cid,s.id);return true;
        }
      }
      return false;
    }
    for(const c of clientsAt)if(!matched.has(c.id)) {
      if(!match(c.id,new Set(),false)&&!match(c.id,new Set(),true))
        uncovered.push({clientId:c.id,clientCode:c.displayCode,startTime:t});
    }
    for(const [cid,sid] of matched) {
      const type=event.get(cid+"|"+t),breakHere=reservations.get(sid)===t;
      assigned.push({staffId:sid,clientId:cid,startTime:t,assignmentType:breakHere
        ? (type==="NAP"?"BREAK_NAP":type==="SPEECH"?"BREAK_SPEECH":"CLIENT_1_TO_1")
        : (type==="SPEECH"?"SPEECH":"CLIENT_1_TO_1")});
      last.set(cid,sid);load.set(sid,(load.get(sid)??0)+1);
    }
    for(const [sid,when] of reservations)if(when===t&&!occupied.has(sid))assigned.push({staffId:sid,startTime:t,assignmentType:"BREAK"});
  }
  const complete=uncovered.length===0&&noBreak.length===0;
  return {success:complete,assignments:assigned,uncoveredRequirements:uncovered,unplacedBreakStaffIds:noBreak,
    failureCode:complete?undefined:(noBreak.length?"NO_BREAK_WINDOW":"INSUFFICIENT_STAFF_COVERAGE")};
}
