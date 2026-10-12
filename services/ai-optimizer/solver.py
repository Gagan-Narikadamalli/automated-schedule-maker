"""Deterministic 30-minute CP-SAT scheduling for AI Generate.

Requires OR-Tools. Events count as supervised client cells. A break taken
during a supervised event yields a single BREAK_NAP or BREAK_SPEECH cell.
"""
from collections import defaultdict
from ortools.sat.python import cp_model
from event_policy import minute, nap_options, speech_options, compatible

def solve(payload):
    data=payload["input"]; rules=data.get("rules") or {}
    if int(rules.get("slotLengthMinutes",30))!=30:
        raise ValueError("AI optimizer requires 30-minute scheduling slots")
    absent=set(data.get("callOutStaffIds") or [])
    staff=sorted((s for s in data["staff"] if s["id"] not in absent and s.get("availableSlots")),key=lambda s:s["id"])
    clients=sorted(data["clients"],key=lambda c:c["id"])
    if len(staff)>100 or len(clients)>100: raise ValueError("Roster limit exceeded")
    for s in staff:
        for t in s["availableSlots"]: minute(t)
    for c in clients:
        for t in c.get("attendanceSlots",c.get("requiredSlots",[])): minute(t)
    model=cp_model.CpModel()
    occupied_staff=defaultdict(list)
    occupied_client=defaultdict(list)
    cover={}; events={}; breaks={}; pair_links={}
    avail={s["id"]:set(s["availableSlots"]) for s in staff}
    attend={c["id"]:set(c.get("attendanceSlots",c.get("requiredSlots",[]))) for c in clients}
    # Exactly one break, duration 30, start 11:00 through 13:30.
    for s in staff:
        sid=s["id"]; options=[]
        for t in sorted(avail[sid]):
            if 660<=minute(t)<=810:
                v=model.NewBoolVar(f"break_{sid}_{t}")
                breaks[sid,t]=v; options.append(v)
                occupied_staff[sid,t].append(v)
        if not options:
            return {"success":False,"assignments":[],"solverStatus":"INFEASIBLE","hardViolations":[f"NO_BREAK_WINDOW:{sid}"]}
        model.Add(sum(options)==1)
    for c in clients:
        cid=c["id"]
        for kind,possible in (("NAP",nap_options(c)),("SPEECH",speech_options(c))):
            if not possible: continue
            choices=[]
            for t in possible:
                if t not in attend[cid]: continue
                for s in staff:
                    sid=s["id"]
                    if t not in avail[sid] or not compatible(s,c): continue
                    v=model.NewBoolVar(f"{kind}_{sid}_{cid}_{t}")
                    events[sid,cid,t,kind]=v;choices.append(v)
                    occupied_staff[sid,t].append(v)
                    occupied_client[cid,t].append(v)
            if not choices:
                return {"success":False,"assignments":[],"solverStatus":"INFEASIBLE","hardViolations":[f"NO_{kind}_SUPERVISION:{cid}"]}
            model.Add(sum(choices)==1)
        for t in sorted(attend[cid]):
            for s in staff:
                sid=s["id"]
                if t not in avail[sid] or not compatible(s,c): continue
                v=model.NewBoolVar(f"cover_{sid}_{cid}_{t}")
                cover[sid,cid,t]=v
                occupied_staff[sid,t].append(v)
                occupied_client[cid,t].append(v)
    links_by_staff=defaultdict(list)
    for (sid,cid,t,kind),v in events.items():
        b=breaks.get((sid,t))
        if b is None: continue
        both=model.NewBoolVar(f"linked_{sid}_{cid}_{kind}_{t}")
        model.Add(both<=v);model.Add(both<=b);model.Add(both>=v+b-1)
        pair_links[sid,cid,t,kind]=both
        links_by_staff[sid,t].append(both)
    for key,vars_ in occupied_staff.items():
        model.Add(sum(vars_)-sum(links_by_staff[key])<=1)
    for vars_ in occupied_client.values():
        model.Add(sum(vars_)<=1)
    # Maximum service-hour constraints.
    for s in staff:
        sid=s["id"]
        service=sum(v for (ss,_,_),v in cover.items() if ss==sid)
        if s.get("maximumDailyHours") is not None:
            model.Add(service<=int(float(s["maximumDailyHours"])*2))
        if s.get("maximumWeeklyHours") is not None:
            available=max(0,float(s["maximumWeeklyHours"])-float(s.get("scheduledWeeklyClientHoursBeforeDate") or 0))
            model.Add(service<=int(available*2))
    # Reward real coverage; templates and continuity cannot override hard rules.
    primary=set()
    for a in data.get("referenceAssignments",[]):
        if a.get("assignmentType")=="CLIENT_1_TO_1" and str(a.get("note","")).startswith("Priority 1"):
            primary.add((a.get("staffId"),a.get("clientId"),a.get("startTime")))
    start_vars=[]
    for (sid,cid,t),v in cover.items():
        previous=minute(t)-30
        prior=cover.get((sid,cid,f"{previous//60:02}:{previous%60:02}")) if previous>=0 else None
        if prior is None:start_vars.append(v)
        else:
            z=model.NewBoolVar(f"handoff_{sid}_{cid}_{t}")
            model.Add(z>=v-prior);model.Add(z<=v);model.Add(z<=1-prior)
            start_vars.append(z)
    model.Maximize(100000*sum(cover.values())+20*sum(pair_links.values())+
                   sum(5*v for k,v in cover.items() if k in primary)-sum(start_vars))
    solver=cp_model.CpSolver()
    solver.parameters.max_time_in_seconds=min(45.0,max(1.0,float(payload.get("timeLimitSeconds",20))))
    solver.parameters.num_search_workers=1
    solver.parameters.random_seed=17
    status=solver.Solve(model)
    if status not in (cp_model.FEASIBLE,cp_model.OPTIMAL):
        return {"success":False,"assignments":[],"solverStatus":solver.StatusName(status),"hardViolations":["NO_FEASIBLE_ASSIGNMENT"]}
    rows=[];break_cells={(sid,t) for (sid,t),v in breaks.items() if solver.Value(v)}
    for (sid,cid,t),v in sorted(cover.items()):
        if solver.Value(v):
            rows.append({"staffId":sid,"clientId":cid,"startTime":t,"assignmentType":"CLIENT_1_TO_1"})
    for (sid,cid,t,kind),v in sorted(events.items()):
        if solver.Value(v):
            linked=(sid,t) in break_cells
            rows.append({"staffId":sid,"clientId":cid,"startTime":t,"assignmentType":f"BREAK_{kind}" if linked else kind})
            if linked:break_cells.remove((sid,t))
    for sid,t in sorted(break_cells):
        rows.append({"staffId":sid,"startTime":t,"assignmentType":"BREAK"})
    rows.sort(key=lambda r:(r["startTime"],r["staffId"],r.get("clientId","")))
    seen_staff=set();seen_client=set();actual_breaks=defaultdict(int)
    for a in rows:
        s=(a["staffId"],a["startTime"])
        if s in seen_staff:raise RuntimeError("STAFF_DOUBLE_BOOKED")
        seen_staff.add(s)
        if a.get("clientId"):
            c=(a["clientId"],a["startTime"])
            if c in seen_client:raise RuntimeError("CLIENT_DOUBLE_BOOKED")
            seen_client.add(c)
        if a["assignmentType"].startswith("BREAK"):actual_breaks[a["staffId"]]+=1
    if any(actual_breaks[s["id"]]!=1 for s in staff):
        raise RuntimeError("BREAK_COUNT_INCORRECT")
    expected=sum(len(slots) for slots in attend.values())
    missing=[{"clientId":c["id"],"clientCode":c.get("displayCode",c["id"]),"startTime":t}
             for c in clients for t in sorted(attend[c["id"]]) if (c["id"],t) not in seen_client]
    covered=expected-len(missing)
    return {"success":True,"completeCoverage":not missing,"solverStatus":solver.StatusName(status),
            "assignments":rows,"uncoveredRequirements":missing,"hardViolations":[],
            "metrics":{"requiredClientSlots":expected,"coveredClientSlots":covered,
                       "uncoveredClientSlots":len(missing),
                       "coveragePercent":100*covered/expected if expected else 100},
            "explanation":f"{covered}/{expected} supervised client slots; {len(staff)} staff breaks. "
                          + (f"{len(missing)} slots need additional eligible staff." if missing else "Complete client supervision.")}
