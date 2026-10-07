import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { resolveSchedulerAiProvider } from "../src/features/ai/schedulerNativeAi";

assert.equal(resolveSchedulerAiProvider("native"), "native");
assert.equal(resolveSchedulerAiProvider("NATIVE"), "native");
assert.equal(resolveSchedulerAiProvider("gateway"), "gateway");
assert.equal(resolveSchedulerAiProvider("unknown"), "gateway");

const route = fs.readFileSync(
  path.join(process.cwd(), "src/app/api/ai/routeBase.ts"),
  "utf8"
);
assert.match(route, /body\.provider \?\? process\.env\.SCHEDULER_AI_PROVIDER/);
assert.match(route, /DEFAULT_SCHEDULER_AI_PAID_MODEL = "openai\/gpt-5\.6-sol"/);
assert.match(route, /reasoning: "high"/);
assert.match(route, /thinkingLevel = aiProvider === "native" \? "low" : "high"/);

const assistant = fs.readFileSync(
  path.join(process.cwd(), "src/components/ScheduleAssistant.tsx"),
  "utf8"
);
assert.match(assistant, /Free AI/);
assert.match(assistant, /Paid AI/);
assert.match(assistant, /provider,/);
assert.match(assistant, /changeProvider\("native"\)/);
assert.match(assistant, /changeProvider\("gateway"\)/);
assert.match(assistant, /provider === "native"/);

console.log("Scheduler AI Free/Paid provider mode tests passed.");
