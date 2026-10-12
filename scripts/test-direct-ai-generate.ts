import assert from "node:assert/strict";
import { constructAiSchedule } from "../src/features/scheduler/engine/constructAiSchedule";
import { scoreCandidate } from "../src/features/scheduler/engine/scoring";
import { enrichBreakAssignmentsWithFixedEvents } from "../src/features/scheduler/engine/reserveBreaks";
import { auditLinkedNapBreakRules } from "../src/features/scheduler/engine/auditLinkedNapBreakRules";
import { pinWorkbookTemplates } from "../src/features/scheduler/engine/pinWorkbookTemplates";
import type { SchedulerAssignment } from "../src/features/scheduler/engine/types";
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

{
  const client = c(1,["11:00","11:30","12:00"],{napSlots:["11:30"]});
  const assignments:SchedulerAssignment[]=[
    {id:"a",staffId:"s1",clientId:"c1",startTime:"11:00",assignmentType:"CLIENT_1_TO_1",source:"AUTO",locked:false},
    {id:"b",staffId:"s1",startTime:"11:30",assignmentType:"BREAK",source:"AUTO",locked:true},
    {id:"c",staffId:"s1",clientId:"c1",startTime:"12:00",assignmentType:"CLIENT_1_TO_1",source:"AUTO",locked:false},
  ];
  const linked=enrichBreakAssignmentsWithFixedEvents(assignments,[client],30);
  assert.equal(linked[1].assignmentType,"BREAK_NAP");
  assert.equal(linked[1].clientId,"c1");
  const again=enrichBreakAssignmentsWithFixedEvents(linked,[client],30);
  assert.equal(again[1].assignmentType,"BREAK_NAP");
  console.log("PASS linked break + nap preserved");
}

{
  const napClient=c(99,["11:00","11:30","12:00"],{napSlots:["11:30"]});
  const item=(id:string,staffId:string,type:"NAP"|"BREAK_NAP"|"BREAK",time="11:30"):SchedulerAssignment=>({
    id,staffId,clientId:type==="BREAK"?undefined:"c99",startTime:time,
    assignmentType:type,source:"AUTO",locked:false
  });
  assert.equal(auditLinkedNapBreakRules([item("a","s1","BREAK_NAP")],[napClient]).length,0);
  assert.ok(auditLinkedNapBreakRules([item("a","s1","NAP")],[napClient]).some(x=>x.includes("Standalone")));
  assert.ok(auditLinkedNapBreakRules([item("a","s1","BREAK_NAP"),item("b","s1","BREAK","12:00")],[napClient]).some(x=>x.includes("multiple breaks")));
  assert.ok(auditLinkedNapBreakRules([item("a","s1","BREAK_NAP"),item("b","s2","BREAK_NAP")],[napClient]).some(x=>x.includes("Duplicate")));
  console.log("PASS shared one-nap/one-break rules for Day and Week");
}

{
  const day=slots(11,14);
  const staff=[s(1,day),s(2,day)];
  const clients=[c(1,day,{napSlots:["12:00"],speechSlots:["13:00"]})];
  const reference=(id:string,staffId:string,time:string,type:"BREAK_NAP"|"BREAK_SPEECH"):SchedulerAssignment=>({
    id,staffId,clientId:"c1",startTime:time,assignmentType:type,source:"TEMPLATE",locked:false,
    note:"Priority 1 saved workbook template: test"
  });
  const input={staff,clients,callOutStaffIds:[],rules:{slotLengthMinutes:30},
    existingAssignments:[],referenceAssignments:[
      reference("nap","s1","12:00","BREAK_NAP"),
      reference("speech","s2","13:00","BREAK_SPEECH"),
    ]} as unknown as SchedulerInput;
  const result=pinWorkbookTemplates(input);
  assert.equal(result.rejected.length,0,JSON.stringify(result.rejected));
  assert.equal(result.pinned.length,2);
  assert.equal(result.pinned[0].clientId,"c1");
  assert.equal(result.pinned[0].assignmentType,"BREAK_NAP");
  assert.equal(result.pinned[1].assignmentType,"BREAK_SPEECH");
  const invalid={...input,referenceAssignments:[reference("wrong","s1","11:30","BREAK_NAP")]};
  assert.equal(pinWorkbookTemplates(invalid).pinned.length,0);
  console.log("PASS template linked nap and speech breaks retain client IDs and reject invalid windows");
}

{
  const day=["11:00","11:30","12:00"];
  const staff=[s(1,day)];
  const clients=[c(1,day,{napSlots:["11:30"]}),c(2,day,{napSlots:[]})];
  const ref=(id:string,clientId:string|undefined,time:string,type:"CLIENT_1_TO_1"|"BREAK_NAP"):SchedulerAssignment=>({
    id,staffId:"s1",clientId,startTime:time,assignmentType:type,source:"TEMPLATE",locked:false,
    note:"Priority 1 saved workbook template: legacy"
  });
  const input={staff,clients,callOutStaffIds:[],rules:{slotLengthMinutes:30},
    existingAssignments:[],referenceAssignments:[
      ref("previous","c1","11:00","CLIENT_1_TO_1"),
      ref("legacy",undefined,"11:30","BREAK_NAP"),
      ref("next","c2","12:00","CLIENT_1_TO_1")
    ]} as unknown as SchedulerInput;
  const resolved=pinWorkbookTemplates(input);
  const nap=resolved.pinned.find(a=>a.startTime==="11:30");
  assert.equal(nap?.assignmentType,"BREAK_NAP");
  assert.equal(nap?.clientId,"c1");
  const unresolved=pinWorkbookTemplates({...input,clients:clients.map(x=>({...x,napSlots:[]}))});
  assert.equal(unresolved.pinned.find(a=>a.startTime==="11:30")?.assignmentType,"BREAK");
  console.log("PASS legacy Break/Nap links adjacent previous client only when a valid nap exists");
}

{
  const slot=["11:00","11:30","12:00"];
  const staff=[s(1,slot)];
  const blocked=c(1,slot,{napSlots:["11:30"],staffRelationships:{s1:"HARD_RESTRICTION"}});
  const template={staff,clients:[blocked],callOutStaffIds:[],
    rules:{slotLengthMinutes:30},existingAssignments:[],
    referenceAssignments:[{id:"linked",staffId:"s1",clientId:"c1",startTime:"11:30",
      assignmentType:"BREAK_NAP",source:"TEMPLATE",locked:false,
      note:"Priority 1 saved workbook template: restricted"}]
  } as unknown as SchedulerInput;
  const denied=pinWorkbookTemplates(template);
  assert.equal(denied.pinned.length,0);
  assert.ok(denied.rejected.some(x=>x.reason.includes("restriction")));
  const conflict:SchedulerAssignment[]=[
    {id:"nap",staffId:"s1",clientId:"c1",startTime:"11:30",assignmentType:"BREAK_NAP",source:"AUTO",locked:true},
    {id:"duplicate",staffId:"s2",clientId:"c1",startTime:"11:30",assignmentType:"CLIENT_1_TO_1",source:"AUTO",locked:false}
  ];
  assert.ok(auditLinkedNapBreakRules(conflict,[blocked]).some(x=>x.includes("Client double-booked")));
  console.log("PASS template restrictions and duplicate client supervision audit");
}

{
  const staff=Array.from({length:26},(_,i)=>s(i,slots(8,16)));
  const clients=Array.from({length:20},(_,i)=>c(i,slots(8,16)));
  const input={staff,clients,callOutStaffIds:[],rules:{slotLengthMinutes:30},
    existingAssignments:[],referenceAssignments:[]} as unknown as SchedulerInput;
  const result=constructAiSchedule(input);
  assert.equal(result.uncoveredRequirements.length,0);
  let shortRuns=0,handOffs=0;
  for(const client of clients){
    const ordered=result.assignments.filter(a=>a.clientId===client.id && a.assignmentType==="CLIENT_1_TO_1")
      .sort((a,b)=>a.startTime.localeCompare(b.startTime));
    for(let i=1;i<ordered.length;i++){
      if(ordered[i-1].staffId!==ordered[i].staffId) {
        handOffs++;
        if(i===1 || i===ordered.length-1)shortRuns++;
      }
    }
  }
  assert.ok(handOffs<=40,`Too many fragmented handoffs: ${handOffs}`);
  assert.ok(shortRuns<=20,`Too many short client runs: ${shortRuns}`);
  console.log(`PASS AI contiguous client runs: handoffs=${handOffs}, short-run edges=${shortRuns}`);
}

{
  const times=slots(8,12);
  const staff=[{...s(1,times),teamId:"red"},{...s(2,times),teamId:"blue"}];
  const clients=[{...c(1,times),teamId:"blue",staffRelationships:{s1:"ALLOWED" as const,s2:"PREFERRED" as const}}];
  const rules={slotLengthMinutes:30,preferSameTeam:true,sameTeamPriority:80,preferredStaffPriority:90,
    btCoveragePriority:0,continuityPriority:0,rotationPriority:0,clientHandoffPenaltyPriority:0,
    staffScheduleCompactnessPriority:0,workloadBalancePriority:0,weeklyHoursPriority:0,
    scheduleStabilityPriority:0,weekdayTemplatePriority:0,
    autoUseHistoricalPatterns:false,preferStaffContinuity:true
  } as SchedulerInput["rules"];
  const input={staff,clients,callOutStaffIds:[],rules,existingAssignments:[],referenceAssignments:[]} as SchedulerInput;
  const ai=constructAiSchedule(input);
  const first=ai.assignments.find(a=>a.clientId==="c1"&&a.startTime==="08:00");
  assert.equal(first?.staffId,"s2","AI Generate must prefer the same-team preferred staff");
  const preferred=scoreCandidate({staffMember:staff[1],client:clients[0],startTime:"08:00",
    assignments:[],referenceAssignments:[],rules});
  const unmatched=scoreCandidate({staffMember:staff[0],client:clients[0],startTime:"08:00",
    assignments:[],referenceAssignments:[],rules});
  assert.ok(preferred>unmatched,"Auto Generate Day/Week scoring must favor preferred same-team staff");
  const restricted={...clients[0],staffRelationships:{s2:"HARD_RESTRICTION" as const}};
  const blocked=constructAiSchedule({...input,clients:[restricted]});
  assert.ok(!blocked.assignments.some(a=>a.clientId==="c1"&&a.staffId==="s2"),
    "AI hard restrictions must remain enforced");
  console.log("PASS AI and Auto Day/Week same-team preference with hard restriction");
}
