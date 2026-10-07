import assert from "node:assert/strict";

import { planNativeSchedulerAction } from "../src/features/ai/schedulerNativeAi";
import { expandNativeFollowUp } from "../src/features/ai/schedulerNativeFollowUp";
import {
  ensureSchedulerConversationClosing,
  schedulerAnswerNeedsFollowUp,
} from "../src/features/ai/schedulerConversationLifecycle";
import type { SchedulerAiHistoryMessage } from "../src/features/ai/types";

const date = "2026-10-07";
function plan(message: string, history: SchedulerAiHistoryMessage[]) {
  const expanded = expandNativeFollowUp(message, history);
  return {
    expanded,
    result: planNativeSchedulerAction({
      message: expanded,
      date,
      history,
      writeToolsEnabled: true,
    }),
  };
}

let value = plan("Ca Cr and code anything you like and then today", [
  { role: "user", text: "create a new client named CaCr" },
  {
    role: "assistant",
    text:
      "Creating a client requires the full name, display code, start date, and regular attendance days/hours (for example Monday-Friday from 9 AM to 3 PM).",
  },
]);
assert.equal(value.result.intent, "CLARIFICATION");

const clientReadyHistory: SchedulerAiHistoryMessage[] = [
  { role: "user", text: "create a new client named CaCr" },
  {
    role: "assistant",
    text:
      "Creating a client requires the full name, display code, start date, and regular attendance days/hours (for example Monday-Friday from 9 AM to 3 PM).",
  },
  {
    role: "user",
    text: "Ca Cr and code anything you like and then today",
  },
  {
    role: "assistant",
    text:
      "Creating a client requires the full name, display code, start date, and regular attendance days/hours (for example Monday-Friday from 9 AM to 3 PM).",
  },
];

value = plan(
  "weekdays from 9 am to 3 pm\n\n[SCHEDULER TIME NORMALIZATION: The user's intended time range was deterministically parsed as 9:00 AM–3:00 PM (09:00-15:00). Use these exact times for scheduler lookups and tool calls.]",
  clientReadyHistory
);
assert.equal(value.result.intent, "CLIENT_MANAGEMENT");
assert.equal(value.result.input.fullName, "Ca Cr");
assert.equal(value.result.input.displayCode, "CaCr");
assert.equal(value.result.input.startDate, date);
assert.deepEqual(value.result.input.attendancePatterns, [
  {
    name: "Regular attendance",
    days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    startTime: "09:00",
    endTime: "15:00",
  },
]);

value = plan("today", [
  { role: "user", text: "create a new staff member" },
  {
    role: "assistant",
    text:
      "Creating a staff member requires the full name, role (BT/RBT/INTERN/BCBA/OFFICE_MANAGER/OTHER), full-time or part-time status, start date, and regular working days/hours (for example Monday-Friday from 8 AM to 4 PM).",
  },
  { role: "user", text: "Ania Regias" },
  {
    role: "assistant",
    text:
      "Creating a staff member requires the full name, role (BT/RBT/INTERN/BCBA/OFFICE_MANAGER/OTHER), full-time or part-time status, start date, and regular working days/hours (for example Monday-Friday from 8 AM to 4 PM).",
  },
  { role: "user", text: "BT" },
  {
    role: "assistant",
    text:
      "Creating a staff member requires the full name, role (BT/RBT/INTERN/BCBA/OFFICE_MANAGER/OTHER), full-time or part-time status, start date, and regular working days/hours (for example Monday-Friday from 8 AM to 4 PM).",
  },
  { role: "user", text: "full-0time" },
  {
    role: "assistant",
    text:
      "Creating a staff member requires the full name, role (BT/RBT/INTERN/BCBA/OFFICE_MANAGER/OTHER), full-time or part-time status, start date, and regular working days/hours (for example Monday-Friday from 8 AM to 4 PM).",
  },
]);
assert.equal(value.result.intent, "CLARIFICATION");

const staffReadyHistory: SchedulerAiHistoryMessage[] = [
  { role: "user", text: "create a new staff member" },
  {
    role: "assistant",
    text:
      "Creating a staff member requires the full name, role (BT/RBT/INTERN/BCBA/OFFICE_MANAGER/OTHER), full-time or part-time status, start date, and regular working days/hours (for example Monday-Friday from 8 AM to 4 PM).",
  },
  { role: "user", text: "Ania Regias" },
  {
    role: "assistant",
    text:
      "Creating a staff member requires the full name, role (BT/RBT/INTERN/BCBA/OFFICE_MANAGER/OTHER), full-time or part-time status, start date, and regular working days/hours (for example Monday-Friday from 8 AM to 4 PM).",
  },
  { role: "user", text: "BT" },
  {
    role: "assistant",
    text:
      "Creating a staff member requires the full name, role (BT/RBT/INTERN/BCBA/OFFICE_MANAGER/OTHER), full-time or part-time status, start date, and regular working days/hours (for example Monday-Friday from 8 AM to 4 PM).",
  },
  { role: "user", text: "full-0time" },
  {
    role: "assistant",
    text:
      "Creating a staff member requires the full name, role (BT/RBT/INTERN/BCBA/OFFICE_MANAGER/OTHER), full-time or part-time status, start date, and regular working days/hours (for example Monday-Friday from 8 AM to 4 PM).",
  },
  { role: "user", text: "today" },
  {
    role: "assistant",
    text:
      "Creating a staff member requires the full name, role (BT/RBT/INTERN/BCBA/OFFICE_MANAGER/OTHER), full-time or part-time status, start date, and regular working days/hours (for example Monday-Friday from 8 AM to 4 PM).",
  },
];

value = plan(
  "weekdays from 8 am to 5 pm\n\n[SCHEDULER TIME NORMALIZATION: The user's intended time range was deterministically parsed as 8:00 AM–5:00 PM (08:00-17:00). Use these exact times for scheduler lookups and tool calls.]",
  staffReadyHistory
);
assert.equal(value.result.intent, "STAFF_MANAGEMENT");
assert.equal(value.result.input.fullName, "Ania Regias");
assert.equal(value.result.input.role, "BT");
assert.equal(value.result.input.employeeType, "FULL_TIME");
assert.equal(value.result.input.startDate, date);
assert.deepEqual(value.result.input.shiftPatterns, [
  {
    name: "Regular schedule",
    days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    startTime: "08:00",
    endTime: "17:00",
  },
]);

value = plan("Monday Base", [
  { role: "user", text: "apply template" },
  { role: "assistant", text: "A schedule template change requires the template name. Applying a template uses the currently selected date unless you specify another target date." },
]);
assert.equal(value.result.intent, "TEMPLATE");
assert.equal(value.result.input.action, "APPLY");

value = plan("12 pm to 1 pm", [
  { role: "user", text: "add nap" },
  { role: "assistant", text: "Nap event changes require a client reference." },
  { role: "user", text: "CaMe" },
  { role: "assistant", text: "Adding a nap event requires both a start time and end time." },
]);
assert.equal(value.result.intent, "EVENT_MANAGEMENT");
assert.equal(value.result.input.client, "CaMe");

value = plan("1 pm", [
  { role: "user", text: "move break" },
  { role: "assistant", text: "A break change requires the staff member and start time." },
  { role: "user", text: "Ania" },
  { role: "assistant", text: "A break change requires the staff member and start time." },
]);
assert.equal(value.result.intent, "BREAK_EDIT");
assert.equal(
  (value.result.input.changes as Array<Record<string, unknown>>)[0]?.staff,
  "Ania"
);

value = plan("2 pm", [
  { role: "user", text: "place unplaced CaMe" },
  { role: "assistant", text: "Placing an Unplaced assignment requires the client, staff member, and start time." },
  { role: "user", text: "Areyana" },
  { role: "assistant", text: "Placing an Unplaced assignment requires the client, staff member, and start time." },
]);
assert.equal(value.result.intent, "UNPLACED_PLACE");
assert.equal(value.result.input.staff, "Areyana");

value = plan("call out", [
  { role: "user", text: "record client attendance" },
  { role: "assistant", text: "A client attendance change requires the client reference and whether it is a call-out or call-in. A time range is optional for a full-day change." },
  { role: "user", text: "CaMe" },
  { role: "assistant", text: "A client attendance change requires the client reference and whether it is a call-out or call-in. A time range is optional for a full-day change." },
]);
assert.equal(value.result.intent, "ATTENDANCE");
assert.equal(value.result.input.client, "CaMe");

value = plan("Monday", [
  { role: "user", text: "copy schedule" },
  { role: "assistant", text: "Copying a schedule requires the source day or date. The currently selected date will be the target." },
]);
assert.equal(value.result.intent, "COPY_DAY");

value = plan("6 hours", [
  { role: "user", text: "set break eligibility" },
  { role: "assistant", text: "This scheduler rule change is missing its value or time range. Please provide the exact value you want to use." },
]);
assert.equal(value.result.intent, "RULES");
assert.equal(value.result.input.breakEligibilityHours, 6);

value = plan("11 am to 11:30 am", [
  { role: "user", text: "replace CaMe client with Areyana instead of Ania" },
  { role: "assistant", text: "This client/staff replacement needs a start time (and optionally an end time) so I can change only the intended schedule block." },
]);
assert.equal(value.result.intent, "BULK_REPLACE");
assert.equal(value.result.input.startTime, "11:00");
assert.equal(value.result.input.endTime, "11:30");

value = plan("show teams", [
  { role: "user", text: "create a new staff member" },
  { role: "assistant", text: "Creating a staff member requires the full name, role (BT/RBT/INTERN/BCBA/OFFICE_MANAGER/OTHER), full-time or part-time status, and start date." },
]);
assert.equal(value.expanded, "show teams");
assert.equal(value.result.intent, "CONFIGURATION");

for (const reply of [
  "Creating a team requires a team name.",
  "Adding a nap event requires both a start time and end time.",
  "A staff call-out change requires the staff member.",
  "A client attendance change requires the client reference and whether it is a call-out or call-in.",
  "Copying a schedule requires the source day or date.",
  "A schedule template change requires the template name.",
  "This scheduler rule change is missing its value or time range. Please provide the exact value you want to use.",
  "This client/staff replacement needs a start time.",
]) {
  assert.equal(schedulerAnswerNeedsFollowUp(reply), true);
  assert.equal(
    ensureSchedulerConversationClosing(reply).includes(
      "Is there anything else you'd like me to do?"
    ),
    false
  );
}


const unknown = planNativeSchedulerAction({
  message: "flibberty wobble this thing please",
  date,
  history: [],
  writeToolsEnabled: true,
});
assert.equal(unknown.intent, "CLARIFICATION");
assert.equal(unknown.toolName, "__native_clarification__");
assert.equal(unknown.input.message, "I am unable to understand your request.");
assert.equal(
  ensureSchedulerConversationClosing("I am unable to understand your request."),
  "I am unable to understand your request."
);

console.log("Native Scheduler AI generalized clarification tests passed.");
