"""Independent event policy: one 30-minute nap in a configurable window."""
def minute(t):
    h,m=map(int,t.split(':'))
    if not 0<=h<24 or m not in (0,30): raise ValueError("30-minute HH:MM required")
    return h*60+m
def nap_options(client):
    fixed=client.get("napStartTime")
    window=client.get("napWindow")
    if window:
        a=minute(window["startTime"]); b=minute(window["endTime"])
        if b-a<30: raise ValueError("Nap window shorter than 30 minutes")
        options=[f"{v//60:02}:{v%60:02}" for v in range(a,b,30)]
    else:
        options=list(client.get("napSlots") or [])
    if fixed:
        if options and fixed not in options: raise ValueError("Fixed nap outside window")
        return [fixed]
    return options
def speech_options(client):
    slots=list(client.get("speechSlots") or [])
    fixed=client.get("speechStartTime")
    if fixed: return [fixed]
    if len(slots)>1: raise ValueError("Speech must be fixed to one 30-minute slot")
    return slots
def compatible(staff,client):
    if (client.get("staffRelationships") or {}).get(staff["id"])=="HARD_RESTRICTION": return False
    a=staff.get("serviceSetting"); b=client.get("serviceSetting")
    return not (a and b and a!="BOTH" and b!="BOTH" and a!=b)
