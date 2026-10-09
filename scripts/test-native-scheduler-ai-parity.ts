import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  NATIVE_SCHEDULER_SUPPORTED_TOOLS,
  planNativeSchedulerAction,
} from "../src/features/ai/schedulerNativeAi";
import { nativePlanNeedsConfirmation } from "../src/features/ai/schedulerNativeConversation";

const toolFiles = [
  "src/features/ai/schedulerTools.ts",
  "src/features/ai/schedulerWriteTools.ts",
  "src/features/ai/schedulerBulkTools.ts",
  "src/features/ai/schedulerWebsiteTools.ts",
  "src/features/ai/schedulerAdvisoryTools.ts",
];

const paidTools = new Set<string>();
for (const relative of toolFiles) {
  const source = fs.readFileSync(path.join(process.cwd(), relative), "utf8");
  for (const match of source.matchAll(/^\s{4}([a-zA-Z0-9_]+): tool\(/gm)) {
    paidTools.add(match[1]);
  }
}

const nativeTools = new Set<string>(NATIVE_SCHEDULER_SUPPORTED_TOOLS);
// Paid AI can have supplemental reasoning/read tools without coupling them to
// the native scheduler. All core native operations must remain supported by Paid AI.
const supplementalPaidTools = new Set(["analyze_workbook_patterns"]);
assert.deepEqual(
  [...nativeTools].sort(),
  [...paidTools].filter(toolName => !supplementalPaidTools.has(toolName)).sort(),
  "Core native scheduler tools must be available in Paid AI; paid-only analysis stays independent."
);

function plan(message: string, date = "2026-10-08") {
  return planNativeSchedulerAction({
    message,
    date,
    history: [],
    writeToolsEnabled: true,
  });
}

const copy = plan("copy schedule from 2026-10-05");
assert.equal(copy.intent, "COPY_DAY");
assert.equal(copy.toolName, "copy_schedule_day");
assert.equal(copy.input.sourceDate, "2026-10-05");
assert.equal(nativePlanNeedsConfirmation(copy), true);

const yesterday = plan("copy yesterday's schedule");
assert.equal(yesterday.intent, "COPY_DAY");
assert.equal(yesterday.input.sourceDate, "2026-10-07");

const analysis = plan("analyze replacing CaMe with ZiBo from 10 am to 12 pm");
assert.equal(analysis.intent, "REPLACEMENT_ANALYSIS");
assert.equal(analysis.toolName, "analyze_client_replacement");
assert.equal(analysis.input.sourceClient, "CaMe");
assert.equal(analysis.input.replacementClient, "ZiBo");
assert.equal(analysis.input.startTime, "10:00");
assert.equal(analysis.input.endTime, "12:00");
assert.equal(nativePlanNeedsConfirmation(analysis), false);

const improvements = plan("what do you recommend to improve coverage and breaks today?");
assert.equal(improvements.intent, "IMPROVEMENTS");
assert.equal(improvements.toolName, "suggest_schedule_improvements");
assert.equal(improvements.input.focus, "ALL");

const breakIdeas = plan("suggest how to fit breaks from 11 am to 2 pm");
assert.equal(breakIdeas.intent, "IMPROVEMENTS");
assert.equal(breakIdeas.input.focus, "BREAKS");
assert.equal(breakIdeas.input.startTime, "11:00");
assert.equal(breakIdeas.input.endTime, "14:00");

const coverageIdeas = plan("recommend how to cover the gaps");
assert.equal(coverageIdeas.intent, "IMPROVEMENTS");
assert.equal(coverageIdeas.input.focus, "COVERAGE");

console.log(
  `Native Scheduler AI parity tests passed (${paidTools.size} paid tools mapped).`
);
