import assert from "node:assert/strict";

import {
  getFullDayCallOutStaffIds,
  getVisibleStaffIndexes,
  isFullDayCallOutWindow,
} from "../src/features/scheduler/callOutVisibility";

assert.equal(isFullDayCallOutWindow("08:00", "20:00"), true);
assert.equal(isFullDayCallOutWindow("08:00", "18:00"), true);
assert.equal(isFullDayCallOutWindow("09:00", "20:00"), false);
assert.equal(isFullDayCallOutWindow("08:00", "13:00"), false);

assert.deepEqual(
  getFullDayCallOutStaffIds([
    { staffId: "a", startTime: "08:00", endTime: "20:00" },
    { staffId: "b", startTime: "11:00", endTime: "14:00" },
    { staffId: "a", startTime: "08:00", endTime: "20:00" },
    { staffId: "c", startTime: "07:30", endTime: "18:00" },
  ]),
  ["a", "c"]
);

assert.deepEqual(
  getVisibleStaffIndexes(["a", "b", "c", "d"], ["b", "d"]),
  [0, 2]
);

assert.deepEqual(
  getVisibleStaffIndexes(["a", "b"], []),
  [0, 1]
);

console.log("Call-out schedule visibility tests passed.");
