import assert from "node:assert/strict";

import { planNativeSchedulerAction } from "../src/features/ai/schedulerNativeAi";
import { nativePlanNeedsConfirmation } from "../src/features/ai/schedulerNativeConversation";

function plan(message: string, date = "2026-10-08") {
  return planNativeSchedulerAction({
    message,
    date,
    history: [],
    writeToolsEnabled: true,
  });
}

const incompleteStaffNoShift = plan(
  "create staff Jane Smith as RBT full time starting 2026-10-15"
);
assert.equal(incompleteStaffNoShift.intent, "CLARIFICATION");
assert.equal(nativePlanNeedsConfirmation(incompleteStaffNoShift), false);

const createStaff = plan(
  "create staff Jane Smith as RBT full time starting 2026-10-15 weekdays from 8 am to 4 pm"
);
assert.equal(createStaff.intent, "STAFF_MANAGEMENT");
assert.equal(createStaff.toolName, "manage_staff");
assert.deepEqual(createStaff.input, {
  action: "CREATE",
  fullName: "Jane Smith",
  role: "RBT",
  employeeType: "FULL_TIME",
  startDate: "2026-10-15",
  shiftPatterns: [
    {
      name: "Regular schedule",
      days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
      startTime: "08:00",
      endTime: "16:00",
    },
  ],
});
assert.equal(nativePlanNeedsConfirmation(createStaff), true);

const incompleteStaff = plan("create staff Jane Smith");
assert.equal(incompleteStaff.intent, "CLARIFICATION");
assert.equal(nativePlanNeedsConfirmation(incompleteStaff), false);

const archiveStaff = plan("archive staff Jane Smith");
assert.equal(archiveStaff.input.action, "ARCHIVE");
assert.equal(archiveStaff.input.staff, "Jane Smith");

const role = plan("change Jane Smith's role to BCBA");
assert.equal(role.input.role, "BCBA");

const hours = plan("set Jane Smith's target weekly hours to 35");
assert.equal(hours.input.targetWeeklyHours, 35);

const availability = plan(
  "Jane Smith works Monday to Friday from 8 am to 5 pm"
);
assert.equal(availability.intent, "STAFF_MANAGEMENT");
assert.equal(availability.input.action, "UPDATE");
assert.equal(availability.input.staff, "Jane Smith");
assert.deepEqual(availability.input.shiftPatterns, [
  {
    name: "Regular schedule",
    days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    startTime: "08:00",
    endTime: "17:00",
  },
]);

const incompleteClientNoAttendance = plan(
  "create client Liam Jones code LiJo starting 2026-10-20"
);
assert.equal(incompleteClientNoAttendance.intent, "CLARIFICATION");

const createClient = plan(
  "create client Liam Jones code LiJo starting 2026-10-20 weekdays from 9 am to 3 pm"
);
assert.equal(createClient.intent, "CLIENT_MANAGEMENT");
assert.equal(createClient.input.fullName, "Liam Jones");
assert.equal(createClient.input.displayCode, "LiJo");
assert.equal(createClient.input.startDate, "2026-10-20");
assert.deepEqual(createClient.input.attendancePatterns, [
  {
    name: "Regular attendance",
    days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    startTime: "09:00",
    endTime: "15:00",
  },
]);

const clientAttendance = plan(
  "CaMe attends Monday to Friday from 9 am to 3 pm"
);
assert.equal(clientAttendance.intent, "CLIENT_MANAGEMENT");
assert.equal(clientAttendance.input.action, "UPDATE");
assert.equal(clientAttendance.input.client, "CaMe");
assert.deepEqual(clientAttendance.input.attendancePatterns, [
  {
    name: "Regular attendance",
    days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    startTime: "09:00",
    endTime: "15:00",
  },
]);

const archiveClient = plan("archive client CaMe");
assert.equal(archiveClient.input.action, "ARCHIVE");
assert.equal(archiveClient.input.client, "CaMe");

const support = plan("set client CaMe support level to high support");
assert.equal(support.input.supportLevel, "HIGH_SUPPORT");

const teamCreate = plan("create team Blue Team color #AABBCC");
assert.equal(teamCreate.intent, "TEAM_MANAGEMENT");
assert.equal(teamCreate.input.name, "Blue Team");
assert.equal(teamCreate.input.color, "#AABBCC");

const teamRename = plan("rename team Blue Team to Green Team");
assert.equal(teamRename.input.action, "UPDATE");
assert.equal(teamRename.input.team, "Blue Team");
assert.equal(teamRename.input.name, "Green Team");

const teamArchive = plan("archive team Green Team");
assert.equal(teamArchive.input.action, "ARCHIVE");

const nap = plan("add nap for CaMe from 12 pm to 1 pm");
assert.equal(nap.intent, "EVENT_MANAGEMENT");
assert.equal(nap.input.eventType, "NAP");
assert.equal(nap.input.client, "CaMe");
assert.equal(nap.input.startTime, "12:00");
assert.equal(nap.input.endTime, "13:00");

const speech = plan("schedule speech for ZiBo from 2 pm to 2:30 pm");
assert.equal(speech.input.eventType, "SPEECH");
assert.equal(speech.input.startTime, "14:00");
assert.equal(speech.input.endTime, "14:30");

const clientOut = plan("client CaMe called out from 9 am to 2 pm");
assert.equal(clientOut.intent, "ATTENDANCE");
assert.equal(clientOut.toolName, "manage_client_attendance");
assert.equal(clientOut.input.client, "CaMe");
assert.equal(clientOut.input.changeType, "CALL_OUT");

const breakWindow = plan("set break window from 11 am to 2 pm");
assert.equal(breakWindow.intent, "RULES");
assert.equal(breakWindow.input.breakWindowStart, "11:00");
assert.equal(breakWindow.input.breakWindowEnd, "14:00");

const historicalOn = plan("turn historical patterns on");
assert.equal(historicalOn.intent, "RULES");
assert.equal(historicalOn.input.autoUseHistoricalPatterns, true);

const historicalOff = plan("turn historical patterns off");
assert.equal(historicalOff.input.autoUseHistoricalPatterns, false);

const templateCreate = plan("save template Monday Base from schedule on 2026-10-05");
assert.equal(templateCreate.intent, "TEMPLATE");
assert.equal(templateCreate.input.action, "CREATE");
assert.equal(templateCreate.input.name, "Monday Base");
assert.equal(templateCreate.input.sourceDate, "2026-10-05");

const templateArchive = plan("archive schedule template Monday Base");
assert.equal(templateArchive.input.action, "ARCHIVE");
assert.equal(templateArchive.input.template, "Monday Base");

const place = plan("place unplaced CaMe with Areyana at 2 pm");
assert.equal(place.intent, "UNPLACED_PLACE");
assert.equal(place.input.client, "CaMe");
assert.equal(place.input.staff, "Areyana");
assert.equal(place.input.startTime, "14:00");

const teams = plan("show teams");
assert.equal(teams.intent, "CONFIGURATION");
assert.equal(teams.input.area, "TEAMS");
assert.equal(nativePlanNeedsConfirmation(teams), false);

const people = plan("show staff profiles");
assert.equal(people.input.area, "PEOPLE");

const rules = plan("show scheduler rules");
assert.equal(rules.input.area, "RULES");

const events = plan("show nap events");
assert.equal(events.input.area, "EVENTS");

const attendance = plan("show client attendance");
assert.equal(attendance.input.area, "ATTENDANCE");

const supervisionRead = plan("show supervision for 2026-10");
assert.equal(supervisionRead.input.area, "SUPERVISION");
assert.equal(supervisionRead.input.month, "2026-10");

const unknown = plan("please do a banana thing with staff");
assert.equal(unknown.intent, "CLARIFICATION");
assert.equal(unknown.input.message, "I am unable to understand your request.");

console.log("Native Scheduler AI management tests passed.");
