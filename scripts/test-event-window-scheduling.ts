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
