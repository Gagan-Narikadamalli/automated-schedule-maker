import assert from "node:assert/strict";

import { expandNativeFollowUp } from "../src/features/ai/schedulerNativeFollowUp";
import { planNativeSchedulerAction } from "../src/features/ai/schedulerNativeAi";
import type { SchedulerAiHistoryMessage } from "../src/features/ai/types";

function history(user: string): SchedulerAiHistoryMessage[] {
  return [
    { role: "user", text: user },
    { role: "assistant", text: "Scheduler response." },
  ];
}

const tomorrow = expandNativeFollowUp(
  "what about tomorrow?",
  history("who is Ania with from 8 am to 2 pm today?")
);
assert.match(tomorrow, /who is Ania with/i);
assert.match(tomorrow, /tomorrow/i);
const tomorrowPlan = planNativeSchedulerAction({
  message: tomorrow,
  date: "2026-10-08",
  history: [],
  writeToolsEnabled: true,
});
assert.equal(tomorrowPlan.intent, "STAFF_LOOKUP");
assert.equal(tomorrowPlan.input.staffName, "Ania");

const sameStaff = expandNativeFollowUp(
  "same for Danna",
  history("show Ania's schedule")
);
assert.equal(sameStaff, "show Danna's schedule");
assert.equal(
  planNativeSchedulerAction({
    message: sameStaff,
    date: "2026-10-08",
    history: [],
    writeToolsEnabled: true,
  }).input.staffName,
  "Danna"
);

const sameClient = expandNativeFollowUp(
  "what about ZiBo?",
  history("who is covering CaMe at 10 am?")
);
assert.match(sameClient, /covering ZiBo/i);
const clientPlan = planNativeSchedulerAction({
  message: sameClient,
  date: "2026-10-08",
  history: [],
  writeToolsEnabled: true,
});
assert.equal(clientPlan.intent, "CLIENT_LOOKUP");
assert.equal(clientPlan.input.clientCode, "ZiBo");
assert.equal(clientPlan.input.startTime, "10:00");

const newTime = expandNativeFollowUp(
  "and at 2 pm?",
  history("who is covering CaMe at 10 am?")
);
assert.match(newTime, /CaMe/i);
assert.match(newTime, /at 2 pm/i);
const timePlan = planNativeSchedulerAction({
  message: newTime,
  date: "2026-10-08",
  history: [],
  writeToolsEnabled: true,
});
assert.equal(timePlan.input.clientCode, "CaMe");
assert.equal(timePlan.input.startTime, "14:00");

const newRange = expandNativeFollowUp(
  "from 1 pm to 3 pm",
  history("who is Ania with from 8 am to 2 pm?")
);
const rangePlan = planNativeSchedulerAction({
  message: newRange,
  date: "2026-10-08",
  history: [],
  writeToolsEnabled: true,
});
assert.equal(rangePlan.input.staffName, "Ania");
assert.equal(rangePlan.input.startTime, "13:00");
assert.equal(rangePlan.input.endTime, "15:00");

assert.equal(
  expandNativeFollowUp("show teams", history("who is Ania with today?")),
  "show teams"
);


const staffCreateHistory: SchedulerAiHistoryMessage[] = [
  { role: "user", text: "create a new staff member named anias" },
  {
    role: "assistant",
    text:
      "Creating a staff member requires the full name, role (BT/RBT/INTERN/BCBA/OFFICE_MANAGER/OTHER), full-time or part-time status, start date, and regular working days/hours (for example Monday-Friday from 8 AM to 4 PM).",
  },
];

const staffCreateContinuation = expandNativeFollowUp(
  "anias regias ,bt,full-0time,today",
  staffCreateHistory
);
assert.match(staffCreateContinuation, /create a new staff member anias regias/i);
assert.match(staffCreateContinuation, /bt/i);
assert.match(staffCreateContinuation, /full-time/i);
assert.match(staffCreateContinuation, /starting today/i);

const incompleteStaffCreatePlan = planNativeSchedulerAction({
  message: staffCreateContinuation,
  date: "2026-10-07",
  history: staffCreateHistory,
  writeToolsEnabled: true,
});
assert.equal(incompleteStaffCreatePlan.intent, "CLARIFICATION");

const staffAvailabilityHistory: SchedulerAiHistoryMessage[] = [
  ...staffCreateHistory,
  { role: "user", text: "anias regias ,bt,full-0time,today" },
  {
    role: "assistant",
    text:
      "Creating a staff member requires the full name, role (BT/RBT/INTERN/BCBA/OFFICE_MANAGER/OTHER), full-time or part-time status, start date, and regular working days/hours (for example Monday-Friday from 8 AM to 4 PM).",
  },
];

const completedStaffCreate = expandNativeFollowUp(
  "weekdays from 8 am to 5 pm",
  staffAvailabilityHistory
);
const staffCreatePlan = planNativeSchedulerAction({
  message: completedStaffCreate,
  date: "2026-10-07",
  history: staffAvailabilityHistory,
  writeToolsEnabled: true,
});
assert.equal(staffCreatePlan.intent, "STAFF_MANAGEMENT");
assert.equal(staffCreatePlan.toolName, "manage_staff");
assert.equal(staffCreatePlan.input.action, "CREATE");
assert.equal(staffCreatePlan.input.fullName, "anias regias");
assert.equal(staffCreatePlan.input.role, "BT");
assert.equal(staffCreatePlan.input.employeeType, "FULL_TIME");
assert.equal(staffCreatePlan.input.startDate, "2026-10-07");
assert.deepEqual(staffCreatePlan.input.shiftPatterns, [
  {
    name: "Regular schedule",
    days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    startTime: "08:00",
    endTime: "17:00",
  },
]);

const clientCreateHistory: SchedulerAiHistoryMessage[] = [
  { role: "user", text: "create a new client" },
  {
    role: "assistant",
    text:
      "Creating a client requires the full name, display code, start date, and regular attendance days/hours (for example Monday-Friday from 9 AM to 3 PM).",
  },
];

const clientCreateContinuation = expandNativeFollowUp(
  "John Smith,JoSm,today",
  clientCreateHistory
);
const incompleteClientCreatePlan = planNativeSchedulerAction({
  message: clientCreateContinuation,
  date: "2026-10-07",
  history: clientCreateHistory,
  writeToolsEnabled: true,
});
assert.equal(incompleteClientCreatePlan.intent, "CLARIFICATION");

const clientAttendanceHistory: SchedulerAiHistoryMessage[] = [
  ...clientCreateHistory,
  { role: "user", text: "John Smith,JoSm,today" },
  {
    role: "assistant",
    text:
      "Creating a client requires the full name, display code, start date, and regular attendance days/hours (for example Monday-Friday from 9 AM to 3 PM).",
  },
];

const completedClientCreate = expandNativeFollowUp(
  "weekdays from 9 am to 3 pm",
  clientAttendanceHistory
);
const clientCreatePlan = planNativeSchedulerAction({
  message: completedClientCreate,
  date: "2026-10-07",
  history: clientAttendanceHistory,
  writeToolsEnabled: true,
});
assert.equal(clientCreatePlan.intent, "CLIENT_MANAGEMENT");
assert.equal(clientCreatePlan.input.fullName, "John Smith");
assert.equal(clientCreatePlan.input.displayCode, "JoSm");
assert.equal(clientCreatePlan.input.startDate, "2026-10-07");
assert.deepEqual(clientCreatePlan.input.attendancePatterns, [
  {
    name: "Regular attendance",
    days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    startTime: "09:00",
    endTime: "15:00",
  },
]);

console.log("Native Scheduler AI follow-up conversation tests passed.");
