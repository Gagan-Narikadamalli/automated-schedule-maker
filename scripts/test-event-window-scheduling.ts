import assert from "node:assert/strict";

import { resolveFlexibleEventWindows } from "../src/features/scheduler/engine/flexibleEventWindows";

const staggered = resolveFlexibleEventWindows(
  [
    {
      key: "client-a",
      startTime: "12:00",
      endTime: "13:00",
    },
    {
      key: "client-b",
      startTime: "12:30",
      endTime: "13:30",
    },
  ],
  {
    enabled: true,
    durationMinutes: 30,
    slotLengthMinutes: 30,
  }
);

assert.deepEqual(
  staggered.get("client-a"),
  ["12:00"],
  "The first 12:00-1:00 window should use one 30-minute event block."
);
assert.deepEqual(
  staggered.get("client-b"),
  ["12:30"],
  "The overlapping 12:30-1:30 window should use the next open 30-minute block."
);

const disabled = resolveFlexibleEventWindows(
  [
    {
      key: "ignored",
      startTime: "12:00",
      endTime: "13:00",
    },
  ],
  {
    enabled: false,
    durationMinutes: 30,
    slotLengthMinutes: 30,
  }
);

assert.deepEqual(
  disabled.get("ignored"),
  [],
  "Disabled automatic event windows must not remove client coverage."
);

const oneHourEvent = resolveFlexibleEventWindows(
  [
    {
      key: "one-hour",
      startTime: "12:00",
      endTime: "13:30",
    },
  ],
  {
    enabled: true,
    durationMinutes: 60,
    slotLengthMinutes: 30,
  }
);

assert.deepEqual(
  oneHourEvent.get("one-hour"),
  ["12:00", "12:30"],
  "A configurable one-hour event should occupy two contiguous 30-minute blocks inside its window."
);

console.log("Event-window scheduling tests passed.");

import { getEventStartSlotsInsideTimeRange, getSlotsInsideTimeRange } from "../src/features/scheduler/engine/dateUtils";

assert.deepEqual(
  getEventStartSlotsInsideTimeRange("13:00","14:00"),
  ["13:00","13:30","14:00"],
  "Nap 13:00–14:00 permits starts at 13:00,13:30,14:00"
);
assert.deepEqual(
  getSlotsInsideTimeRange("13:00","14:00"),
  ["13:00","13:30"],
  "Shift attendance uses the end-exclusive convention"
);
const endpoint=resolveFlexibleEventWindows([
  {key:"early",startTime:"13:00",endTime:"13:00"},
  {key:"middle",startTime:"13:30",endTime:"13:30"},
  {key:"last",startTime:"13:00",endTime:"14:00"},
],{enabled:true,durationMinutes:30,slotLengthMinutes:30});
assert.deepEqual(endpoint.get("last"),["14:00"],
  "After 13:00 and 13:30 are taken, 14:00–14:30 is the remaining nap");
const boundary=resolveFlexibleEventWindows([
  {key:"boundary",startTime:"13:00",endTime:"14:00",allowedSlots:["14:00"]}
],{enabled:true,durationMinutes:30,slotLengthMinutes:30});
assert.deepEqual(boundary.get("boundary"),["14:00"],
  "2:00 PM must be a legal start when client available for 2:00–2:30");
