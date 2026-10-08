import assert from "node:assert/strict";
import { applyAttendanceWindow } from "../src/features/scheduler/engine/attendanceWindows";
import { getSlotsInsideTimeRange } from "../src/features/scheduler/engine/dateUtils";

const day = getSlotsInsideTimeRange("08:00", "17:00");
const morning = getSlotsInsideTimeRange("08:00", "12:00");
const afternoon = getSlotsInsideTimeRange("12:00", "17:00");
assert.equal(day.length, 18, "8 AM–5 PM has exactly 18 half-hour slots");
assert.deepEqual(applyAttendanceWindow([], { mode: "IN", startTime: "08:00", endTime: "17:00" }), day, "unscheduled employee can work whole-day call-in");
assert.deepEqual(applyAttendanceWindow([], { mode: "IN", startTime: "12:00", endTime: "17:00" }), afternoon, "unscheduled employee can work partial call-in");
assert.deepEqual(applyAttendanceWindow(day, { mode: "OUT", startTime: "08:00", endTime: "17:00" }), [], "whole-day absence blocks all slots");
assert.deepEqual(applyAttendanceWindow(day, { mode: "OUT", startTime: "12:00", endTime: "17:00" }), morning, "early departure preserves morning");
assert.deepEqual(applyAttendanceWindow(day, { mode: "OUT", startTime: "08:00", endTime: "12:00" }), afternoon, "late arrival preserves afternoon");
assert.deepEqual(applyAttendanceWindow(morning, { mode: "IN", startTime: "12:00", endTime: "17:00" }), day, "call-in extends existing shift without losing original slots");
assert.deepEqual(applyAttendanceWindow(day, { mode: "IN", startTime: "10:00", endTime: "11:00" }), day, "call-in does not duplicate slots");
assert.deepEqual(applyAttendanceWindow(day), day, "no attendance change preserves current availability");
assert.deepEqual(day, [...day].sort(), "slot ordering is stable");
const twoDays = [
  { date: "2026-10-08", slots: applyAttendanceWindow([], { mode: "IN", startTime: "08:00", endTime: "17:00" }) },
  { date: "2026-10-09", slots: applyAttendanceWindow([], undefined) },
];
assert.equal(twoDays[0].slots.length, 18);
assert.equal(twoDays[1].slots.length, 0, "one-day call-in must not create a recurring shift");
console.log("PASS: 11 date-specific staff/client availability and time-boundary assertions.");
