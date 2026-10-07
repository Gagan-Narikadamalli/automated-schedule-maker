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

console.log("Native Scheduler AI follow-up conversation tests passed.");
