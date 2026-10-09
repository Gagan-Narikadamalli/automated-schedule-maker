import assert from "node:assert/strict";
import { synchronizeTemplateNaps } from "../src/features/templates/templateNapLinks";

const base = [
  { staffId: "s1", clientId: "c1", startTime: "11:30", endTime: "12:00", assignmentType: "CLIENT_1_TO_1", locked: false },
  { staffId: "s1", clientId: "c1", startTime: "12:30", endTime: "13:00", assignmentType: "CLIENT_1_TO_1", locked: false },
];
const result = synchronizeTemplateNaps(base, [{ clientId: "c1", startTime: "12:00" }]);
assert.equal(result.warnings.length, 0);
assert.ok(!result.assignments.some(a => a.startTime === "12:00" && a.assignmentType === "BREAK_NAP"), "nap-only must not silently create staff breaks");
assert.equal(result.naps.length, 1);
const conflict = synchronizeTemplateNaps([...base, { staffId: "s1", clientId: "c2", startTime: "12:00", endTime: "12:30", assignmentType: "CLIENT_1_TO_1", locked: false }], [{ clientId: "c1", startTime: "12:00" }]);
assert.equal(conflict.warnings.length, 0, "an occupied staff cell is not overwritten or considered a conflict just because a different child naps");
assert.ok(!conflict.assignments.some(a => a.staffId === "s1" && a.startTime === "12:00" && a.assignmentType === "BREAK_NAP"));
const manuallyLinked = synchronizeTemplateNaps([{ staffId: "s2", clientId: "c2", startTime: "12:00", endTime: "12:30", assignmentType: "BREAK_NAP", locked: false }], []);
assert.deepEqual(manuallyLinked.naps, [{ clientId: "c2", startTime: "12:00" }]);
assert.equal(manuallyLinked.warnings.length, 0);
const longNap = synchronizeTemplateNaps(
  [
    { staffId: "s1", clientId: "c1", startTime: "11:30", endTime: "12:00", assignmentType: "CLIENT_1_TO_1", locked: false },
    { staffId: "s1", clientId: "c1", startTime: "13:00", endTime: "13:30", assignmentType: "CLIENT_1_TO_1", locked: false },
  ],
  [{ clientId: "c1", startTime: "12:00" }, { clientId: "c1", startTime: "12:30" }]
);
assert.equal(longNap.warnings.length, 0);
assert.equal(longNap.assignments.filter(a => a.assignmentType === "BREAK_NAP" && a.staffId === "s1").length, 0, "nap range alone does not force a staff break");
console.log("Template nap/staff break synchronization tests passed.");
