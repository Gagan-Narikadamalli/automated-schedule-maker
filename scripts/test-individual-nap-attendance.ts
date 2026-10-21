import assert from "node:assert/strict";
import { getEligibleClientNapStarts, isClientActiveOnDate } from "../src/features/fixed-events/napAttendanceEligibility";

const selectedDates=["2026-10-12","2026-10-13","2026-10-14","2026-10-15","2026-10-16"];
const attendees={
  c1:{startDate:"2026-10-01",attendancePatterns:[
    {days:["MONDAY","WEDNESDAY","FRIDAY"],startTime:"09:00",endTime:"16:00"}]},
  c2:{startDate:"2026-10-01",attendancePatterns:[
    {days:["TUESDAY","THURSDAY"],startTime:"09:00",endTime:"16:00"}]},
  c3:{startDate:"2026-10-01",attendancePatterns:[
    {days:["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY"],startTime:"08:30",endTime:"16:00"}]},
};
const expected={
  c1:["2026-10-12","2026-10-14","2026-10-16"],
  c2:["2026-10-13","2026-10-15"],
  c3:selectedDates
};
for(const [id,client] of Object.entries(attendees)) {
  const dates=selectedDates.filter(date=>getEligibleClientNapStarts(client,date,"13:00","14:00").length>0);
  assert.deepEqual(dates,expected[id as keyof typeof expected],
    `Selected recurring weekdays must be filtered by individual attendance: ${id}`);
}
const halfDay={attendancePatterns:[{days:["MONDAY"],startTime:"08:30",endTime:"12:00"}]};
assert.deepEqual(getEligibleClientNapStarts(halfDay,"2026-10-12","11:30","12:00"),["11:30"],
  "An inclusive nap end at 12:00 cannot start without 12:00–12:30 attendance");
assert.deepEqual(getEligibleClientNapStarts(halfDay,"2026-10-12","13:00","14:00"),[],
  "Being present earlier in the day is insufficient for the nap slot");
const tuesday={attendancePatterns:[{days:["MONDAY"],startTime:"08:30",endTime:"15:00"}]};
assert.deepEqual(getEligibleClientNapStarts(tuesday,"2026-10-13","13:00","14:00"),[],
  "No nap on a day the child is not ordinarily scheduled");
assert.deepEqual(getEligibleClientNapStarts(tuesday,"2026-10-13","13:00","14:00",[
 {changeType:"CALL_IN",startTime:"13:00",endTime:"14:30"}
]),["13:00","13:30","14:00"],
  "A date-specific call-in makes actual attendance eligible for nap");
assert.deepEqual(getEligibleClientNapStarts(attendees.c3,"2026-10-14","13:00","14:00",[
 {changeType:"CALL_OUT",startTime:"13:00",endTime:"14:30"}
]),[],"A partial call-out covering the nap window cancels the nap opportunity");
assert.deepEqual(getEligibleClientNapStarts(attendees.c3,"2026-10-14","13:00","14:00",[],{
 mode:"OUT",startTime:"13:00",endTime:"14:30"
}),[],"Manager attendance overrides must take precedence");
assert.deepEqual(getEligibleClientNapStarts(tuesday,"2026-10-13","13:00","14:00",[],{
 mode:"IN",startTime:"13:30",endTime:"14:30"
}),["13:30","14:00"],"A manager call-in on an otherwise unscheduled day permits the nap");
assert.deepEqual(getEligibleClientNapStarts(attendees.c3,"2026-10-14","13:00","14:00",[
 {changeType:"CALL_IN",startTime:"13:00",endTime:"14:30"}
],{mode:"OUT",startTime:"13:00",endTime:"14:30"}),[],
  "A later manager call-out overrides an older call-in");
assert.equal(isClientActiveOnDate({
 startDate:"2026-10-14",endDate:"2026-10-15",attendancePatterns:attendees.c3.attendancePatterns,
},"2026-10-13"),false);
assert.equal(isClientActiveOnDate({
 startDate:"2026-10-14",endDate:"2026-10-15",attendancePatterns:attendees.c3.attendancePatterns,
},"2026-10-14"),true);
assert.deepEqual(getEligibleClientNapStarts({
 ...attendees.c3,startDate:"2026-10-17"
},"2026-10-15","13:00","14:00"),[],"Do not schedule naps before a child's active date");
console.log("PASS individual nap dates: 3 attendance patterns, weekday filtering, half-day shifts, inclusive end, call-outs, call-ins, overrides and active dates.");
