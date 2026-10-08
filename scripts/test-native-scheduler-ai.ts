import assert from "node:assert/strict";

import {
  extractNativeTimeRange,
  planNativeSchedulerAction,
} from "../src/features/ai/schedulerNativeAi";

function plan(message: string) {
  return planNativeSchedulerAction({
    message,
    history: [],
    writeToolsEnabled: true,
  });
}

assert.deepEqual(extractNativeTimeRange("from 9 am to 2 pm"), {
  startTime: "09:00",
  endTime: "14:00",
});
assert.deepEqual(extractNativeTimeRange("at 1:30 pm"), {
  startTime: "13:30",
});
assert.deepEqual(
  extractNativeTimeRange(
    "move it\n\n[SCHEDULER TIME NORMALIZATION: parsed as 10:30-11:30 (10:30-11:30)]"
  ),
  { startTime: "10:30", endTime: "11:30" }
);

assert.equal(plan("generate the schedule for today").toolName, "generate_schedule");
assert.deepEqual(plan("generate the work week schedule").input, { scope: "WORK_WEEK" });
assert.equal(plan("fix the schedule").toolName, "repair_schedule");
assert.equal(plan("minimal fix the schedule").toolName, "repair_schedule");

const callOut = plan("Ania called out from 9 am to 2 pm");
assert.equal(callOut.toolName, "record_call_out");
assert.equal(callOut.input.action, "ADD");
assert.equal(callOut.input.staff, "Ania");
assert.equal(callOut.input.startTime, "09:00");
assert.equal(callOut.input.endTime, "14:00");

const removeCallOut = plan("remove call out for Ania");
assert.equal(removeCallOut.toolName, "record_call_out");
assert.equal(removeCallOut.input.action, "REMOVE");

const addBreak = plan("give Danna a break at 1 pm");
assert.equal(addBreak.toolName, "edit_schedule_cells");
assert.deepEqual((addBreak.input.changes as any[])[0], {
  action: "SET",
  staff: "Danna",
  startTime: "13:00",
  assignmentType: "BREAK",
  text: "Break",
});

const clearBreak = plan("remove Danna's break at 1 pm");
assert.equal(clearBreak.toolName, "edit_schedule_cells");
assert.deepEqual((clearBreak.input.changes as any[])[0], {
  action: "CLEAR",
  staff: "Danna",
  startTime: "13:00",
});

const replaceStaff = plan("replace all Ania blocks with Areyana");
assert.equal(replaceStaff.toolName, "replace_schedule_blocks");
assert.equal(replaceStaff.input.entityType, "STAFF");
assert.equal(replaceStaff.input.source, "Ania");
assert.equal(replaceStaff.input.replacement, "Areyana");
assert.equal(replaceStaff.input.allowLockedOverride, false);
assert.equal(replaceStaff.input.allowRuleOverride, false);
assert.equal(replaceStaff.input.allowOccupiedReplacement, false);

const replaceClient = plan("replace client CaMe with ZiBo");
assert.equal(replaceClient.toolName, "replace_schedule_blocks");
assert.equal(replaceClient.input.entityType, "CLIENT");
assert.equal(replaceClient.input.source, "CaMe");
assert.equal(replaceClient.input.replacement, "ZiBo");

assert.deepEqual(plan("show schedule templates").input, { action: "LIST" });
const template = plan("apply schedule template Monday Standard");
assert.equal(template.toolName, "manage_schedule_template");
assert.equal(template.input.action, "APPLY");
assert.equal(template.input.template, "Monday Standard");

const staffLookup = plan("who is Ania with from 8 am to 2 pm");
assert.equal(staffLookup.toolName, "lookup_schedule");
assert.equal(staffLookup.input.staffName, "Ania");
assert.equal(staffLookup.input.startTime, "08:00");
assert.equal(staffLookup.input.endTime, "14:00");

const naturalStaffClientLookup = plan(
  "On October 6th for Anias who is the client?"
);
assert.equal(naturalStaffClientLookup.intent, "STAFF_LOOKUP");
assert.equal(naturalStaffClientLookup.toolName, "lookup_schedule");
assert.equal(naturalStaffClientLookup.input.staffName, "Anias");

const clientLookup = plan("who is covering CaMe at 10 am");
assert.equal(clientLookup.toolName, "lookup_schedule");
assert.equal(clientLookup.input.clientCode, "CaMe");
assert.equal(clientLookup.input.startTime, "10:00");

const freeStaff = plan("who is free from 12 pm to 1 pm");
assert.equal(freeStaff.toolName, "lookup_schedule");
assert.equal(freeStaff.input.includeFreeStaff, true);
assert.equal(freeStaff.input.startTime, "12:00");
assert.equal(freeStaff.input.endTime, "13:00");

assert.equal(plan("what is still unplaced?").toolName, "get_unplaced_assignments");
assert.equal(plan("check the schedule for conflicts").toolName, "check_schedule");
assert.equal(plan("which staff are missing breaks?").toolName, "get_staff");
assert.equal(plan("show client nap and speech requirements").toolName, "get_clients");
assert.equal(plan("what is happening on this schedule?").toolName, "get_day_schedule");

const comprehensiveHealth = plan(
  "Check the schedule and tell me whether there is uncovered coverage, unplaced work, or staff missing breaks."
);
assert.equal(comprehensiveHealth.intent, "HEALTH");
assert.equal(comprehensiveHealth.toolName, "check_schedule");

const continuity = plan("why is the schedule jumbled and how can we make the client blocks smoother?");
assert.equal(continuity.intent, "IMPROVEMENTS");
assert.equal(continuity.toolName, "suggest_schedule_improvements");
assert.equal(continuity.input.focus, "CONTINUITY");

console.log("Native Scheduler AI intent tests passed.");
