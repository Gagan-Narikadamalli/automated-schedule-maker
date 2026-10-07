import assert from "node:assert/strict";
import {
  resolveSchedulerDateContext,
} from "../src/features/ai/schedulerDateResolution";
import {
  describeNativePendingAction,
  formatNativeDateLabel,
  reviseNativePendingAction,
} from "../src/features/ai/schedulerNativeConversation";
import { planNativeSchedulerAction } from "../src/features/ai/schedulerNativeAi";
import type { SchedulerAiHistoryMessage } from "../src/features/ai/types";

const today = "2026-10-07";

function resolve(
  message: string,
  history: SchedulerAiHistoryMessage[] = [],
  selectedDate = today
) {
  return resolveSchedulerDateContext({
    message,
    selectedDate,
    todayDate: today,
    dateSelectionExplicit: true,
    history,
  });
}

const futureHistory: SchedulerAiHistoryMessage[] = [
  {
    role: "assistant",
    text: "Proposed scheduler change.",
    effectiveDate: "2026-10-20",
  },
];

assert.equal(
  resolve("actually tomorrow instead", futureHistory, "2026-10-20").date,
  "2026-10-21"
);
assert.equal(
  resolve("make it Friday", futureHistory, "2026-10-20").date,
  "2026-10-23"
);

assert.match(
  formatNativeDateLabel("2026-10-08"),
  /Thursday, October 8, 2026 \(2026-10-08\)/
);

const pending = {
  date: "2026-10-08",
  intent: "BULK_REPLACE",
  toolName: "replace_schedule_blocks",
  input: {
    entityType: "STAFF",
    source: "Ania",
    replacement: "Areyana",
    client: "CaMe",
    startTime: "11:00",
    endTime: "11:30",
    allowLockedOverride: false,
    allowRuleOverride: false,
    allowOccupiedReplacement: false,
  },
  stage: "USER_CONFIRMATION" as const,
};

const revised = reviseNativePendingAction(
  pending,
  "actually Friday from 12 pm to 12:30 pm instead",
  "2026-10-09"
);
assert.ok(revised);
assert.equal(revised!.date, "2026-10-09");
assert.equal(revised!.input.startTime, "12:00");
assert.equal(revised!.input.endTime, "12:30");

const preview = describeNativePendingAction(
  { intent: "BULK_REPLACE", input: revised!.input, explanation: "move" },
  revised!.date!
);
assert.match(preview, /Friday, October 9, 2026/);
assert.match(preview, /12:00/);
assert.match(preview, /12:30/);

const copyDate = resolve("copy Monday's schedule to Friday");
assert.equal(copyDate.date, "2026-10-09");

const copyPlan = planNativeSchedulerAction({
  message: "copy Monday's schedule to Friday",
  date: copyDate.date,
  history: [],
  writeToolsEnabled: true,
});
assert.equal(copyPlan.intent, "COPY_DAY");
assert.equal(copyPlan.input.sourceDate, "2026-10-05");

const recurring = planNativeSchedulerAction({
  message:
    "create recurring nap for CaMe every weekday from 12 pm to 1 pm between 2026-10-12 and 2026-10-30",
  date: "2026-10-12",
  history: [],
  writeToolsEnabled: true,
});
assert.equal(recurring.intent, "EVENT_MANAGEMENT");
assert.deepEqual(recurring.input.daysOfWeek, [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
]);
assert.equal(recurring.input.seriesStartDate, "2026-10-12");
assert.equal(recurring.input.seriesEndDate, "2026-10-30");

const badRecurring = planNativeSchedulerAction({
  message:
    "create recurring speech for ZiBo every Monday from 2 pm to 2:30 pm between 2026-10-30 and 2026-10-01",
  date: "2026-10-30",
  history: [],
  writeToolsEnabled: true,
});
assert.equal(badRecurring.intent, "CLARIFICATION");

console.log("Native Scheduler AI date workflow regression tests passed.");
