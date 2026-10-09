import assert from "node:assert/strict";
import { scoreWeekdayTemplate, selectBestWeekdayTemplate } from "../src/features/scheduler/server/selectBestWeekdayTemplate";

const times = ["08:00", "08:30", "09:00", "09:30"];
const mk = (name: string, mapping: Array<[string, string]>, napClient?: string) => ({
  _id: name,
  name,
  assignments: mapping.flatMap(([staffId,clientId]) => times.map(startTime =>
    ({ staffId, clientId, startTime, assignmentType: "CLIENT_1_TO_1" })
  )),
  clientNapSlots: napClient ? [{clientId:napClient,startTime:"12:00"}] : [],
});
const a = mk("Wednesday alternate A", [["s1","c1"],["s2","c2"]], "c1");
const b = mk("Wednesday alternate B", [["s3","c3"],["s4","c4"]], "c3");
const roster = (staffIds:string[],clientIds:string[]) => ({
  staff: staffIds.map(id=>({id,availableSlots:times})),
  clients: clientIds.map(id=>({id,requiredSlots:times})),
});
for (const day of ["Monday","Tuesday","Wednesday","Thursday","Friday"]) {
  const first = roster(["s1","s2"],["c1","c2"]);
  const second = roster(["s3","s4"],["c3","c4"]);
  assert.equal(selectBestWeekdayTemplate([b,a],first.staff,first.clients)?.name,a.name,day+" picks A even if B first");
  assert.equal(selectBestWeekdayTemplate([a,b],second.staff,second.clients)?.name,b.name,day+" picks B with different roster");
}
const partial = roster(["s1","s3"],["c1","c3"]);
assert.equal(scoreWeekdayTemplate(a,partial.staff,partial.clients).matchingBlocks,4);
assert.equal(scoreWeekdayTemplate(b,partial.staff,partial.clients).matchingBlocks,4);
assert.equal(selectBestWeekdayTemplate([b,a],partial.staff,partial.clients)?.name,a.name,"stable tie resolution");
assert.equal(selectBestWeekdayTemplate([{...a,learningOnly:true},b],roster(["s1","s2"],["c1","c2"]).staff,roster(["s1","s2"],["c1","c2"]).clients)?.name,b.name);
assert.equal(selectBestWeekdayTemplate([],[],[]),null);
const callOut = roster(["s1"],["c1","c2"]);
assert.equal(scoreWeekdayTemplate(a,callOut.staff,callOut.clients).matchingBlocks,4);
console.log("Best-fit multiple weekday-template selection tests passed (five weekdays, alternate rosters, absence, tie, learning-only).");
