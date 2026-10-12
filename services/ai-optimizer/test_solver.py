import unittest
from solver import solve
from event_policy import nap_options
def st(i,slots):
    return {"id":i,"availableSlots":slots,"serviceSetting":"IN_CENTER"}
def cl(i,slots,**extra):
    return {"id":i,"displayCode":i,"attendanceSlots":slots,"staffRelationships":{},**extra}
def req(staff,clients):
    return {"input":{"staff":staff,"clients":clients,
        "callOutStaffIds":[],"referenceAssignments":[],
        "rules":{"slotLengthMinutes":30}},"timeLimitSeconds":10}
class SolverTests(unittest.TestCase):
    def test_nap_window_half_hour(self):
        self.assertEqual(nap_options(cl("c",["12:00","12:30"],napWindow={"startTime":"12:00","endTime":"13:00"})),["12:00","12:30"])
    def test_break_and_nap_without_double_booking(self):
        slots=["11:00","11:30","12:00","12:30"]
        result=solve(req([st("s1",slots)],[cl("c1",slots,napWindow={"startTime":"12:00","endTime":"13:00"})]))
        self.assertTrue(result["success"],result)
        self.assertEqual(result["metrics"]["uncoveredClientSlots"],0)
        self.assertEqual(sum(a["assignmentType"].startswith("BREAK") for a in result["assignments"]),1)
        self.assertEqual(sum(a["assignmentType"] in ("NAP","BREAK_NAP") for a in result["assignments"]),1)
        self.assertEqual(len({(a["staffId"],a["startTime"]) for a in result["assignments"]}),len(result["assignments"]))
    def test_callout_without_available_break_is_infeasible(self):
        result=solve(req([st("s1",["08:00"])],[]))
        self.assertFalse(result["success"])
        self.assertEqual(result["solverStatus"],"INFEASIBLE")
    def test_twenty_clients_twenty_six_staff(self):
        slots=[f"{h:02}:00" for h in range(11,14)]+[f"{h:02}:30" for h in range(11,14)]
        people=[st(f"s{i}",slots) for i in range(26)]
        clients=[cl(f"c{i}",slots) for i in range(20)]
        result=solve(req(people,clients))
        self.assertTrue(result["success"],result)
        self.assertEqual(result["metrics"]["uncoveredClientSlots"],0)
        self.assertEqual(sum(a["assignmentType"].startswith("BREAK") for a in result["assignments"]),26)
if __name__=="__main__":unittest.main()
