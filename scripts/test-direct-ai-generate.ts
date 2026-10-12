import assert from "node:assert/strict";
import { constructAiSchedule } from "../src/features/scheduler/engine/constructAiSchedule";
import type { SchedulerInput, SchedulerClient, SchedulerStaff } from "../src/features/scheduler/engine/types";
const slots=(start=8,end=16)=>Array.from({length:(end-start)*2},(_,i)=>{
  const m=start*60+i*30;return `${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
});
const s=(n:number,t:string[]):SchedulerStaff=>({id:`s${n}`,name:`Staff ${n}`,role:"BT",availableSlots:t});
const c=(n:number,t:string[],extras:Partial<SchedulerClient>={}):SchedulerClient=>({
  id:`c${n}`,displayCode:`C${n}`,requiredSlots:t,napSlots:[],speechSlots:[],staffRelationships:{},...extras
});
function check(name:string,staff:SchedulerStaff[],clients:SchedulerClient[],callOutStaffIds:string[],expected:boolean){
  const input={staff,clients,callOutStaffIds,rules:{slotLengthMinutes:30},existingAssignments:[],referenceAssignments:[]} as unknown as SchedulerInput;
  const result=constructAiSchedule(input);
  assert.equal(result.success,expected,`${name}: ${JSON.stringify(result.uncoveredRequirements.slice(0,3))}`);
  const occupied=new Set<string>(),covered=new Set<string>(),breaks=new Map<string,number>();
  for(const a of result.assignments){
    const key=`${a.staffId}|${a.startTime}`;
    assert.ok(!occupied.has(key),`${name}: double-booking ${key}`);occupied.add(key);
    if(a.clientId){const ck=`${a.clientId}|${a.startTime}`;assert.ok(!covered.has(ck));covered.add(ck);}
    if(a.assignmentType.startsWith("BREAK")){
      breaks.set(a.staffId,(breaks.get(a.staffId)??0)+1);
      const [h,m]=a.startTime.split(":").map(Number);
      assert.ok(h*60+m>=660 && h*60+m<840,`${name}: break outside 11-14`);
    }
  }
  for(const p of staff.filter(p=>!callOutStaffIds.includes(p.id)))assert.equal(breaks.get(p.id),1,`${name}: break ${p.id}`);
  if(expected)assert.equal(result.uncoveredRequirements.length,0);
  if(name==="naps and speech") {
    for(let i=0;i<20;i++){
      const ev=result.assignments.filter(a=>a.clientId===`c${i}`);
      if(i<10){
        assert.equal(ev.filter(a=>a.assignmentType==="NAP"||a.assignmentType==="BREAK_NAP").length,1);
        assert.ok(ev.some(a=>a.startTime==="12:00"||a.startTime==="12:30"));
        assert.equal(ev.filter(a=>(a.startTime==="12:00"||a.startTime==="12:30")).length,2);
      } else assert.equal(ev.filter(a=>a.startTime==="12:30" && (a.assignmentType==="SPEECH"||a.assignmentType==="BREAK_SPEECH")).length,1);
    }
  }
  if(!expected)assert.ok(result.uncoveredRequirements.length>0);
  console.log(`PASS ${name}: covered=${covered.size}; breaks=${[...breaks.values()].reduce((a,b)=>a+b,0)}; missing=${result.uncoveredRequirements.length}`);
}
check("20 clients and 26 staff",
  Array.from({length:26},(_,i)=>s(i,slots())),
  Array.from({length:20},(_,i)=>c(i,slots())),[],true);
check("staggered availability",
  Array.from({length:26},(_,i)=>s(i,i<13?slots(8,14):slots(10,16))),
  Array.from({length:20},(_,i)=>c(i,i<10?slots(8,14):slots(10,16))),[],true);
check("naps and speech",
  Array.from({length:26},(_,i)=>s(i,slots(10,15))),
  Array.from({length:20},(_,i)=>c(i,slots(10,15),i<10?
    {napSlots:["12:00","12:30"]}:{speechSlots:["12:30"]})),[],true);
check("two staff callouts",Array.from({length:26},(_,i)=>s(i,slots())),
  Array.from({length:20},(_,i)=>c(i,slots())),["s24","s25"],true);
check("insufficient staffing",Array.from({length:8},(_,i)=>s(i,slots())),
  Array.from({length:20},(_,i)=>c(i,slots())),[],false);
