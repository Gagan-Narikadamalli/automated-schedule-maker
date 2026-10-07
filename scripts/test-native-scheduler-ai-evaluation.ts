import assert from "node:assert/strict";

import { evaluateNativeShadowPlan } from "../src/features/ai/schedulerNativeEvaluation";
import { planNativeSchedulerAction } from "../src/features/ai/schedulerNativeAi";

const lookup = planNativeSchedulerAction({
  message: "who is covering CaMe at 10 am",
  date: "2026-10-08",
  history: [],
  writeToolsEnabled: true,
});
const agreement = evaluateNativeShadowPlan(lookup, ["lookup_schedule"]);
assert.equal(agreement.nativeAgreement, true);
assert.equal(agreement.nativeTool, "lookup_schedule");
assert.equal(agreement.nativeIntent, "CLIENT_LOOKUP");
assert.ok(agreement.nativeConfidence > 0.9);

const disagreement = evaluateNativeShadowPlan(lookup, ["get_day_schedule"]);
assert.equal(disagreement.nativeAgreement, false);

const historyPlan = planNativeSchedulerAction({
  message: "what normally happens on Mondays",
  date: "2026-10-12",
  history: [],
  writeToolsEnabled: true,
});
const nonComparable = evaluateNativeShadowPlan(historyPlan, []);
assert.equal(nonComparable.nativeAgreement, null);
assert.equal(nonComparable.nativeTool, "__native_history__");

const clarification = planNativeSchedulerAction({
  message: "create staff Jane",
  date: "2026-10-08",
  history: [],
  writeToolsEnabled: true,
});
assert.equal(
  evaluateNativeShadowPlan(clarification, []).nativeAgreement,
  null
);

console.log("Native Scheduler AI shadow evaluation tests passed.");
