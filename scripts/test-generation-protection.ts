import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  AUTO_REPLACEABLE_ASSIGNMENT_FILTER,
  shouldKeepExistingAssignment,
} from "../src/features/scheduler/server/schedulePersistencePolicy";
import type { SchedulerAssignment } from "../src/features/scheduler/engine/types";

function assignment(
  overrides: Partial<SchedulerAssignment> = {}
): SchedulerAssignment {
  return {
    id: "assignment",
    staffId: "staff",
    clientId: "client",
    startTime: "10:00",
    assignmentType: "CLIENT_1_TO_1",
    source: "AUTO",
    locked: false,
    ...overrides,
  };
}

assert.equal(
  shouldKeepExistingAssignment(assignment({ locked: true })),
  true,
  "Locked automatic assignments must survive fresh generation."
);
assert.equal(
  shouldKeepExistingAssignment(assignment({ source: "MANUAL" })),
  true,
  "Manual assignments must survive fresh generation."
);
assert.equal(
  shouldKeepExistingAssignment(
    assignment({ assignmentType: "SPEECH" })
  ),
  true,
  "Fixed speech events must survive fresh generation."
);
assert.equal(
  shouldKeepExistingAssignment(
    assignment({ assignmentType: "UNAVAILABLE" })
  ),
  true,
  "Unavailable boundary blocks must survive fresh generation."
);
assert.equal(
  shouldKeepExistingAssignment(
    assignment({ assignmentType: "BREAK" })
  ),
  false,
  "Automatic breaks must be recalculated after coverage."
);
assert.equal(
  shouldKeepExistingAssignment(assignment()),
  false,
  "Unlocked automatic client assignments must be regenerated."
);

assert.deepEqual(AUTO_REPLACEABLE_ASSIGNMENT_FILTER, {
  locked: { $ne: true },
  manuallyOverridden: { $ne: true },
  source: { $in: ["AUTO", "TEMPLATE", "COPIED"] },
});

const root = process.cwd();
for (const relativePath of [
  "src/app/api/schedule/generate/route.ts",
  "src/app/api/schedule/generate-range/route.ts",
]) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  assert.match(
    source,
    /shouldKeepExistingAssignment/,
    `${relativePath} must use the shared protected-assignment policy.`
  );
  assert.match(
    source,
    /AUTO_REPLACEABLE_ASSIGNMENT_FILTER/,
    `${relativePath} must use the safe replacement filter.`
  );
  assert.match(
    source,
    /assignment\.source === "AUTO" && !assignment\.locked/,
    `${relativePath} must persist only unlocked automatic assignments.`
  );
}

console.log("Daily and weekly protected-assignment tests passed.");
