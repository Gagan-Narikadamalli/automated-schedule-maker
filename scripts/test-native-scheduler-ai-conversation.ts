import assert from "node:assert/strict";

import {
  applyNativeOverrideApproval,
  describeNativePendingAction,
  isNativeCancellation,
  isNativeConfirmation,
  nativePlanNeedsConfirmation,
  reviseNativePendingAction,
} from "../src/features/ai/schedulerNativeConversation";
import {
  planNativeSchedulerAction,
  type NativeSchedulerPlan,
} from "../src/features/ai/schedulerNativeAi";

assert.equal(isNativeConfirmation("yes"), true);
assert.equal(isNativeConfirmation("Yes, please."), true);
assert.equal(isNativeConfirmation("go ahead"), true);
assert.equal(isNativeConfirmation("proceed"), true);
assert.equal(isNativeConfirmation("maybe"), false);
assert.equal(isNativeCancellation("cancel"), true);
assert.equal(isNativeCancellation("don't proceed"), true);
assert.equal(isNativeCancellation("nope"), true);
assert.equal(isNativeCancellation("yes"), false);

const writes = [
  "generate the schedule",
  "fix the schedule",
  "Ania called out from 9 am to 2 pm",
  "give Danna a break at 1 pm",
  "replace all Ania blocks with Areyana",
  "apply schedule template Monday Standard",
];
for (const prompt of writes) {
  assert.equal(
    nativePlanNeedsConfirmation(planNativeSchedulerAction({
      message: prompt,
      history: [],
      writeToolsEnabled: true,
    })),
    true,
    prompt
  );
}

const reads = [
  "who is Ania with from 8 am to 2 pm",
  "who is covering CaMe at 10 am",
  "who is free from 12 pm to 1 pm",
  "what is still unplaced",
  "check the schedule for conflicts",
  "show client nap and speech requirements",
  "what normally happens on Mondays",
];
for (const prompt of reads) {
  assert.equal(
    nativePlanNeedsConfirmation(planNativeSchedulerAction({
      message: prompt,
      history: [],
      writeToolsEnabled: true,
    })),
    false,
    prompt
  );
}

const breakPlan = planNativeSchedulerAction({
  message: "give Danna a break at 1 pm",
  history: [],
  writeToolsEnabled: true,
});
const pending = {
  intent: breakPlan.intent,
  toolName: breakPlan.toolName,
  input: breakPlan.input,
  stage: "USER_CONFIRMATION" as const,
};
const revised = reviseNativePendingAction(pending, "actually make it 2 pm instead");
assert.ok(revised);
assert.equal(
  ((revised!.input.changes as Array<Record<string, unknown>>)[0]).startTime,
  "14:00"
);
assert.equal(reviseNativePendingAction(pending, "what about tomorrow?"), null);

const replacementPlan = planNativeSchedulerAction({
  message: "replace all Ania blocks with Areyana",
  history: [],
  writeToolsEnabled: true,
});
const replacementPending = {
  intent: replacementPlan.intent,
  toolName: replacementPlan.toolName,
  input: replacementPlan.input,
  stage: "USER_CONFIRMATION" as const,
};
const override = applyNativeOverrideApproval(replacementPending, {
  requiresOccupiedReplacementConfirmation: true,
  confirmationType: "OCCUPIED_TARGET",
});
assert.equal(override.input.allowOccupiedReplacement, true);
assert.equal(override.input.allowLockedOverride, false);
assert.equal(override.stage, "OVERRIDE_CONFIRMATION");

const lockedOverride = applyNativeOverrideApproval(replacementPending, {
  requiresLockedOverride: true,
  confirmationType: "LOCKED_OR_MANUAL",
});
assert.equal(lockedOverride.input.allowLockedOverride, true);

const preview = describeNativePendingAction(
  breakPlan as NativeSchedulerPlan,
  "2026-10-08"
);
assert.match(preview, /Danna/);
assert.match(preview, /13:00/);
assert.match(preview, /2026-10-08/);

const historical = planNativeSchedulerAction({
  message: "what do we usually do for breaks on Mondays?",
  history: [],
  writeToolsEnabled: true,
});
assert.equal(historical.intent, "HISTORICAL");
assert.equal(historical.toolName, "__native_history__");

const historicalVariants = [
  "what happened historically with CaMe?",
  "show previous scheduling patterns",
  "what was normally done for this client",
  "use past schedules to tell me the usual pairing",
  "what did we typically do last year",
];
for (const prompt of historicalVariants) {
  assert.equal(
    planNativeSchedulerAction({
      message: prompt,
      history: [],
      writeToolsEnabled: true,
    }).intent,
    "HISTORICAL",
    prompt
  );
}

console.log("Native Scheduler AI conversation/confirmation tests passed.");
