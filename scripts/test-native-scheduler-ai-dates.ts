import assert from "node:assert/strict";

import { resolveSchedulerDateContext } from "../src/features/ai/schedulerDateResolution";
import { planNativeSchedulerAction } from "../src/features/ai/schedulerNativeAi";
import type { SchedulerAiHistoryMessage } from "../src/features/ai/types";

const today = "2026-10-07";

function resolve(
  message: string,
  selectedDate = today,
  history: SchedulerAiHistoryMessage[] = [],
  dateSelectionExplicit = false
) {
  return resolveSchedulerDateContext({
    message,
    selectedDate,
    todayDate: today,
    dateSelectionExplicit,
    history,
  });
}

assert.equal(resolve("change it tomorrow").date, "2026-10-08");
assert.equal(resolve("change it Friday").date, "2026-10-09");
assert.equal(resolve("change it Tuesday").date, "2026-10-13");
assert.equal(resolve("change it this Tuesday").date, "2026-10-06");
assert.equal(resolve("change it next Friday").date, "2026-10-16");
assert.equal(resolve("change it last Friday").date, "2026-10-02");
assert.equal(resolve("generate next week schedule").date, "2026-10-12");
assert.equal(resolve("generate this week schedule").date, "2026-10-05");

const futureHistory: SchedulerAiHistoryMessage[] = [
  {
    role: "assistant",
    text: "Schedule results for 2026-10-20.",
    effectiveDate: "2026-10-20",
  },
];
assert.equal(
  resolve("what about tomorrow?", today, futureHistory).date,
  "2026-10-21"
);
assert.equal(
  resolve("same for Friday?", today, futureHistory).date,
  "2026-10-23"
);
assert.equal(
  resolve("and at 2 pm?", today, futureHistory).date,
  "2026-10-20"
);

const copy = resolve(
  "copy the schedule from 2026-10-05 to 2026-10-08"
);
assert.equal(copy.date, "2026-10-08");
assert.equal(copy.source, "EXPLICIT_DATE");

const copySelected = resolve(
  "copy yesterday's schedule",
  "2026-10-08",
  [],
  true
);
assert.equal(copySelected.date, "2026-10-08");

const copyPlan = planNativeSchedulerAction({
  message: "copy the schedule from 2026-10-05 to 2026-10-08",
  date: copy.date,
  history: [],
  writeToolsEnabled: true,
});
assert.equal(copyPlan.intent, "COPY_DAY");
assert.equal(copyPlan.input.sourceDate, "2026-10-05");

const template = planNativeSchedulerAction({
  message: "apply schedule template Monday Standard to 2026-10-09",
  date: "2026-10-09",
  history: [],
  writeToolsEnabled: true,
});
assert.equal(template.intent, "TEMPLATE");
assert.equal(template.input.action, "APPLY");
assert.equal(template.input.template, "Monday Standard");

const invalid = resolve("move CaMe on 2026-02-30");
assert.match(invalid.error || "", /not a valid calendar date/i);

assert.equal(
  resolve("who is free?", "2026-10-15", [], true).date,
  "2026-10-15"
);

console.log("Native Scheduler AI date-resolution tests passed.");
