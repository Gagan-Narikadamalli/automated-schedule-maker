import assert from "node:assert/strict";
import { selectThirtyMinuteNapSlots } from "../src/features/scheduler/engine/napWindowPlacement";

const windowSlots = ["12:00", "12:30", "13:00", "13:30"];

const chooseLast = selectThirtyMinuteNapSlots(windowSlots, 30, [
  {
    role: "BT",
    availableSlots: ["14:00"],
    hardRestricted: false,
  },
]);
assert.deepEqual(
  chooseLast,
  ["13:30"],
  "Choose the last 30 minutes when the outside boundary has eligible BT availability."
);

const chooseFirst = selectThirtyMinuteNapSlots(windowSlots, 30, [
  {
    role: "RBT",
    availableSlots: ["11:30"],
    hardRestricted: false,
  },
]);
assert.deepEqual(
  chooseFirst,
  ["12:00"],
  "Choose the first 30 minutes when the earlier outside boundary has eligible RBT availability."
);

const preferBtOverManager = selectThirtyMinuteNapSlots(windowSlots, 30, [
  {
    role: "OFFICE_MANAGER",
    availableSlots: ["11:30"],
    hardRestricted: false,
  },
  {
    role: "BT",
    availableSlots: ["14:00"],
    hardRestricted: false,
  },
]);
assert.deepEqual(
  preferBtOverManager,
  ["13:30"],
  "Prefer the nap edge that can align with BT coverage before using manager availability."
);

const ignoreRestrictedBt = selectThirtyMinuteNapSlots(windowSlots, 30, [
  {
    role: "BT",
    availableSlots: ["14:00"],
    hardRestricted: true,
  },
]);
assert.deepEqual(
  ignoreRestrictedBt,
  ["12:00"],
  "A hard-restricted BT must not influence flexible nap placement."
);

const shortWindow = selectThirtyMinuteNapSlots(
  ["12:00", "12:30"],
  30,
  []
);
assert.deepEqual(
  shortWindow,
  ["12:00"],
  "When first and last are equally suitable, use the first 30-minute slot."
);

const fifteenMinuteSlots = selectThirtyMinuteNapSlots(
  ["12:00", "12:15", "12:30", "12:45"],
  15,
  []
);
assert.deepEqual(
  fifteenMinuteSlots,
  ["12:00", "12:15"],
  "A 30-minute nap must occupy exactly two 15-minute scheduler slots."
);

console.log("Flexible 30-minute nap window tests passed.");
