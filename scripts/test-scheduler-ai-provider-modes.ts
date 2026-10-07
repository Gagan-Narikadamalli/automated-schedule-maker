import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function resolveProjectImport(
  importer: string,
  specifier: string
): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = path.join(root, "src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(path.join(root, importer)), specifier);
  } else {
    return null;
  }

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.relative(root, candidate).replaceAll("\\", "/");
    }
  }
  return null;
}

function transitiveImports(entry: string): {
  files: Set<string>;
  packages: Set<string>;
} {
  const files = new Set<string>();
  const packages = new Set<string>();
  const pending = [entry];
  const pattern =
    /(?:import|export)\s+(?:type\s+)?(?:[^"'\n]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (files.has(current)) continue;
    files.add(current);

    const text = source(current);
    for (const match of text.matchAll(pattern)) {
      const specifier = match[1] || match[2];
      const resolved = resolveProjectImport(current, specifier);
      if (resolved) {
        pending.push(resolved);
      } else if (!specifier.startsWith("node:")) {
        packages.add(specifier);
      }
    }
  }

  return { files, packages };
}

const nativeEntry = "src/app/api/ai/native/route.ts";
const paidEntry = "src/app/api/ai/paid/route.ts";
assert.equal(fs.existsSync(path.join(root, nativeEntry)), true);
assert.equal(fs.existsSync(path.join(root, paidEntry)), true);

const nativeGraph = transitiveImports(nativeEntry);
assert.equal(
  nativeGraph.packages.has("ai"),
  false,
  "Native Scheduler AI must not import the paid AI SDK."
);
for (const forbidden of [
  "src/app/api/ai/routeBase.ts",
  "src/app/api/ai/paid/route.ts",
  "src/features/ai/schedulerPaidToolAdapter.ts",
  "src/features/ai/schedulerPrompt.ts",
]) {
  assert.equal(
    nativeGraph.files.has(forbidden),
    false,
    `Native Scheduler AI must stay independent of ${forbidden}.`
  );
}

for (const sharedToolFile of [
  "src/features/ai/schedulerTools.ts",
  "src/features/ai/schedulerWriteTools.ts",
  "src/features/ai/schedulerBulkTools.ts",
  "src/features/ai/schedulerWebsiteTools.ts",
  "src/features/ai/schedulerAdvisoryTools.ts",
]) {
  const text = source(sharedToolFile);
  assert.doesNotMatch(
    text,
    /from\s+["']ai["']/,
    `${sharedToolFile} must remain provider-neutral.`
  );
  assert.match(text, /schedulerToolDefinition/);
}

const paidBase = source("src/app/api/ai/routeBase.ts");
assert.match(
  paidBase,
  /DEFAULT_SCHEDULER_AI_PAID_MODEL = "openai\/gpt-5\.6-sol"/
);
assert.match(paidBase, /reasoning: "high"/);
assert.match(paidBase, /adaptSchedulerToolsForPaid/);
assert.doesNotMatch(paidBase, /schedulerNativeAi/);
assert.doesNotMatch(paidBase, /schedulerNativeEvaluation/);
assert.doesNotMatch(paidBase, /schedulerNativeFollowUp/);

const assistant = source("src/components/ScheduleAssistant.tsx");
assert.match(
  assistant,
  /provider === "native" \? "\/api\/ai\/native" : "\/api\/ai\/paid"/
);
assert.match(assistant, /changeProvider\("native"\)/);
assert.match(assistant, /changeProvider\("gateway"\)/);
assert.match(assistant, /Free AI/);
assert.match(assistant, /Paid AI/);

const nativeRoute = source(nativeEntry);
assert.match(nativeRoute, /provider: "native"/);
assert.match(nativeRoute, /thinkingLevel: "low"/);
assert.doesNotMatch(nativeRoute, /ToolLoopAgent|generateText|AI_GATEWAY|openai\//i);

console.log(
  `Scheduler AI isolation tests passed (Native graph: ${nativeGraph.files.size} project files, no paid AI SDK dependency).`
);
