import assert from "node:assert/strict";
import { calculateCappedWeeklyStaffHours } from "../src/features/overview/overviewCalculations";

const total = calculateCappedWeeklyStaffHours([
  { scheduledHours: 45 },
  { scheduledHours: 35 },
  { scheduledHours: 20 },
  { scheduledHours: -2 },
]);

assert.equal(
  total,
  95,
  "Weekly overview must cap 45 hours to 40, retain 35 and 20, and ignore negative values."
);

console.log("Weekly overview 40-hour staff cap tests passed.");
