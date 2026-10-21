import type { SchedulerAssignment,SchedulerClient,SchedulerStaff } from "./types";

type ProblemContext={
  problems:string[];
  clients:SchedulerClient[];
  staff:SchedulerStaff[];
  assignments:SchedulerAssignment[];
  calledOutStaffIds:string[];
};
/** Evidence-based manager explanations; never report a missing event as covered. */
export function explainUnmetEventRules(ctx:ProblemContext):string[] {
  const staff=new Map(ctx.staff.map(s=>[s.id,s]));
  const clients=new Map(ctx.clients.map(c=>[c.id,c]));
  const callouts=new Set(ctx.calledOutStaffIds);
  return ctx.problems.map(problem=>{
    const nap=/^Client (.+) missing scheduled Break\/Nap at (\d{2}:\d{2})$/.exec(problem);
    if(nap){
      const client=clients.get(nap[1]);
      if(!client)return problem+": client not present in current roster";
      const eligible=ctx.staff.filter(s=>
        !callouts.has(s.id)&&s.availableSlots.includes(nap[2])&&
        client.staffRelationships[s.id]!=="HARD_RESTRICTION"&&
        (!s.serviceSetting||!client.serviceSetting||s.serviceSetting==="BOTH"||
          client.serviceSetting==="BOTH"||s.serviceSetting===client.serviceSetting));
      if(!eligible.length)return problem+
        ": no eligible therapist is available for that full 30-minute nap slot";
      const free=eligible.filter(s=>!ctx.assignments.some(a=>
        a.staffId===s.id&&a.startTime===nap[2]));
      return problem+(free.length
        ? ": eligible staff exist, but no valid linked single staff break/nap was placed; review break allocation and continuity"
        : ": all eligible therapists have another assignment or break at this time; relief or a different permitted nap start is required");
    }
    const staffBreak=/^Staff (.+) missing required 30-minute break$/.exec(problem);
    if(staffBreak){
      const person=staff.get(staffBreak[1]);
      if(!person)return problem+": therapist missing from current roster";
      const breakStarts=person.availableSlots.filter(t=>t>="11:00"&&t<="14:00");
      const free=breakStarts.filter(t=>!ctx.assignments.some(a=>a.staffId===person.id&&a.startTime===t));
      return problem+(free.length
        ? ": an eligible break start is still empty; the break planner did not reserve it"
        : ": every permitted break start is occupied; manager should review relief therapist availability and protected assignments");
    }
    return problem;
  });
}
