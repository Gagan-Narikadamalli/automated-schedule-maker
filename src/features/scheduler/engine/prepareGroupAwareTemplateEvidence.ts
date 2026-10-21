import type { SchedulerAssignment,SchedulerInput } from "./types";

export type GroupAwareTemplateEvidence={
  references:SchedulerAssignment[];
  groupedCoverageReferences:SchedulerAssignment[];
  historicalBreakHints:SchedulerAssignment[];
  ignoredIsolatedCoverageCells:number;
  retainedGroupedCoverageCells:number;
};

/**
 * Rebuild-day AUTO GENERATE evidence policy (not Repair, not AI Generate).
 * Same-weekday templates are useful when an actual contiguous staff/client
 * run appears. An isolated 30-minute historical pairing is not sufficient
 * evidence to pin a staff/client cell and interrupt today's long runs.
 *
 * Template BREAK_NAP / BREAK_SPEECH say when an employee tended to take a
 * break; they DO NOT establish that today's child is taking a nap/speech then.
 * Today's dated fixed events and available staff decide any linking later.
 */
export function prepareGroupAwareTemplateEvidence(
  input:Pick<SchedulerInput,"referenceAssignments"|"rules">
):GroupAwareTemplateEvidence{
  const references=input.referenceAssignments;
  const step=input.rules.slotLengthMinutes||30;
  const index=new Map<string,SchedulerAssignment[]>();
  const passThrough:SchedulerAssignment[]=[];
  const historicalBreakHints:SchedulerAssignment[]=[];
  for(const a of references){
    if(["BREAK","BREAK_NAP","BREAK_SPEECH"].includes(a.assignmentType)){
      if(a.source==="TEMPLATE"||a.source==="COPIED"){
        historicalBreakHints.push({
          ...a,clientId:undefined,assignmentType:"BREAK",locked:false,
          note:"Historical staff break-time preference only. Current client naps/speech and continuity determine any linked event."
        });
      } else passThrough.push(a);
      continue;
    }
    if(a.assignmentType==="CLIENT_1_TO_1"&&a.clientId&&
       (a.source==="TEMPLATE"||a.source==="COPIED")){
      // Separate workbook source layers: a singleton in one historical week
      // cannot be merged with a different week's half-hour at the next time.
      const layer=a.source==="TEMPLATE"
        ? a.note?.startsWith("Priority 1")?"P1":a.note?.startsWith("Priority 2")?"P2":"OTHER"
        : "PREVIOUS";
      const key=[a.source,layer,a.staffId,a.clientId].join("|");
      index.set(key,[...(index.get(key)??[]),a]);
      continue;
    }
    passThrough.push(a);
  }
  const grouped:SchedulerAssignment[]=[];
  let ignored=0;
  const timeToMinute=(time:string)=>{
    const [h,m]=time.split(":").map(Number);
    return h*60+m;
  };
  for(const candidates of index.values()){
    const ordered=[...candidates].sort((a,b)=>a.startTime.localeCompare(b.startTime));
    const commit=(run:SchedulerAssignment[])=>{
      if(run.length>=2)grouped.push(...run);
      else ignored+=run.length;
    };
    let run:SchedulerAssignment[]=[];
    for(const cell of ordered){
      const prior=run[run.length-1];
      if(prior&&timeToMinute(cell.startTime)-timeToMinute(prior.startTime)!==step){
        commit(run);run=[];
      }
      run.push(cell);
    }
    if(run.length)commit(run);
  }
  const groupedIds=new Set(grouped.map(a=>a.id));
  // Preserve original layer priority order for pinWorkbookTemplates, which
  // gives priority-1 workbook blocks precedence over priority-2 fallback.
  const kept=references.filter(a=>groupedIds.has(a.id));
  const ref=[...kept,...passThrough,...historicalBreakHints];
  return {
    references:ref,
    groupedCoverageReferences:kept,
    historicalBreakHints,
    ignoredIsolatedCoverageCells:ignored,
    retainedGroupedCoverageCells:kept.length
  };
}
