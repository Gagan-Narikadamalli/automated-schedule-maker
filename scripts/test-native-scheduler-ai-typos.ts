import assert from "node:assert/strict";

import { matchEntityReference } from "../src/features/ai/entityReference";
import {
  extractNativeTimeRange,
  planNativeSchedulerAction,
} from "../src/features/ai/schedulerNativeAi";
import { normalizeNativeCommandTypos } from "../src/features/ai/schedulerNativeText";

assert.equal(normalizeNativeCommandTypos("replcae clinet instaed"), "replace client instead");
assert.match(normalizeNativeCommandTypos("form 11 to 11 30"), /from 11 to 11 30/i);

assert.deepEqual(extractNativeTimeRange("from 11 to 11 30"), {
  startTime: "11:00",
  endTime: "11:30",
});

const exact = planNativeSchedulerAction({
  message: "replace CaMe client with areyana instead of anias from 11 to 11 30",
  date: "2026-10-08",
  history: [],
  writeToolsEnabled: true,
});
assert.equal(exact.intent, "BULK_REPLACE");
assert.equal(exact.toolName, "replace_schedule_blocks");
assert.equal(exact.input.entityType, "STAFF");
assert.equal(exact.input.client, "CaMe");
assert.equal(exact.input.source, "anias");
assert.equal(exact.input.replacement, "areyana");
assert.equal(exact.input.startTime, "11:00");
assert.equal(exact.input.endTime, "11:30");
assert.equal(exact.input.allowLockedOverride, false);
assert.equal(exact.input.allowRuleOverride, false);
assert.equal(exact.input.allowOccupiedReplacement, false);

const typo = planNativeSchedulerAction({
  message: "replcae CaMe clinet with areyanna instaed of anias form 11 to 11 30",
  date: "2026-10-08",
  history: [],
  writeToolsEnabled: true,
});
assert.equal(typo.intent, "BULK_REPLACE");
assert.equal(typo.input.client, "CaMe");
assert.equal(typo.input.source, "anias");
assert.equal(typo.input.replacement, "areyanna");
assert.equal(typo.input.startTime, "11:00");
assert.equal(typo.input.endTime, "11:30");

const staffCandidates = [
  { record: { id: "1", name: "Ania" }, labels: ["Ania"] },
  { record: { id: "2", name: "Areyana" }, labels: ["Areyana"] },
];
const ania = matchEntityReference("anias", staffCandidates);
assert.equal(ania.status, "MATCH");
if (ania.status === "MATCH") assert.equal(ania.record.name, "Ania");

const areyana = matchEntityReference("areyanna", staffCandidates);
assert.equal(areyana.status, "MATCH");
if (areyana.status === "MATCH") assert.equal(areyana.record.name, "Areyana");

const clients = [
  { record: { id: "c1", code: "CaMe" }, labels: ["CaMe"] },
  { record: { id: "c2", code: "ZiBo" }, labels: ["ZiBo"] },
];
const came = matchEntityReference("Cmae", clients);
assert.equal(came.status, "MATCH");
if (came.status === "MATCH") assert.equal(came.record.code, "CaMe");

console.log("Native Scheduler AI typo/entity replacement tests passed.");
