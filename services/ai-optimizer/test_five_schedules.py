"""Five actual generation scenarios; requires OR-Tools in GitHub Actions."""
import unittest
from solver import solve
def person(i, times):
    return {"id":f"s{i}","availableSlots":times,"serviceSetting":"IN_CENTER"}
def client(i,times,**more):
    return {"id":f"c{i}","displayCode":f"C{i}","attendanceSlots":times,
        "staffRelationships":{},**more}
def run(staff,clients,absent=()):
    return solve({"timeLimitSeconds":20,"input":{"staff":staff,"clients":clients,
        "callOutStaffIds":list(absent),"referenceAssignments":[],
        "rules":{"slotLengthMinutes":30}}})
def grid(start=8,end=16):
    return [f"{m//60:02}:{m%60:02}" for m in range(start*60,end*60,30)]
class FiveScenarios(unittest.TestCase):
    def check_complete(self,result):
        self.assertTrue(result["success"],result)
        self.assertEqual(result["metrics"]["uncoveredClientSlots"],0)
    def test_01_standard_20_clients_26_staff(self):
        t=grid()
        self.check_complete(run([person(i,t) for i in range(26)],
                                [client(i,t) for i in range(20)]))
    def test_02_staggered_shifts_and_arrivals(self):
        day=grid(); early=grid(8,14); late=grid(10,16)
        people=[person(i,early if i<13 else late) for i in range(26)]
        clients=[client(i,early if i<10 else late) for i in range(20)]
        self.check_complete(run(people,clients))
    def test_03_nap_and_speech_with_linked_break(self):
        t=grid(10,15)
        people=[person(i,t) for i in range(26)]
        clients=[client(i,t,**({"napWindow":{"startTime":"12:00","endTime":"13:00"}} if i<10
                   else {"speechStartTime":"12:30"})) for i in range(20)]
        result=run(people,clients)
        self.check_complete(result)
        self.assertEqual(sum(a["assignmentType"] in ("NAP","BREAK_NAP") for a in result["assignments"]),10)
        self.assertEqual(sum(a["assignmentType"] in ("SPEECH","BREAK_SPEECH") for a in result["assignments"]),10)
    def test_04_two_callouts_still_feasible(self):
        t=grid()
        result=run([person(i,t) for i in range(26)],[client(i,t) for i in range(20)],
                   absent=("s24","s25"))
        self.check_complete(result)
    def test_05_shortage_needs_human_decision(self):
        t=grid()
        result=run([person(i,t) for i in range(8)],[client(i,t) for i in range(20)])
        self.assertFalse(result["success"],result)
        self.assertEqual(result.get("failureCode"),"INSUFFICIENT_STAFF_COVERAGE")
        self.assertGreater(result["metrics"]["uncoveredClientSlots"],0)
        self.assertIn("Human scheduling decision needed",result["message"])
if __name__=="__main__":unittest.main()
