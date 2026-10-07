import { getSlotsInsideTimeRange } from "./dateUtils";

export type FlexibleEventWindow = {
  key: string;
  startTime: string;
  endTime: string;
  priority?: number;
};

export type FlexibleEventDurationRule = {
  enabled: boolean;
  minimumMinutes: number;
  preferredMinutes: number;
  maximumMinutes: number;
  slotLengthMinutes: number;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function safeSlotCount(
  minutes: number,
  slotLengthMinutes: number,
  fallback: number
): number {
  if (!Number.isFinite(minutes) || minutes <= 0 || slotLengthMinutes <= 0) {
    return fallback;
  }

  return Math.max(Math.round(minutes / slotLengthMinutes), 1);
}

export function resolveFlexibleEventWindows(
  windows: FlexibleEventWindow[],
  rule: FlexibleEventDurationRule
): Map<string, string[]> {
  const resolved = new Map<string, string[]>();
  const slotLoad = new Map<string, number>();

  const orderedWindows = [...windows].sort((left, right) => {
    const priorityDifference = (left.priority ?? 100) - (right.priority ?? 100);

    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    const endDifference = left.endTime.localeCompare(right.endTime);

    if (endDifference !== 0) {
      return endDifference;
    }

    const startDifference = left.startTime.localeCompare(right.startTime);

    if (startDifference !== 0) {
      return startDifference;
    }

    return left.key.localeCompare(right.key);
  });

  for (const window of orderedWindows) {
    const availableSlots = getSlotsInsideTimeRange(
      window.startTime,
      window.endTime
    );

    if (availableSlots.length === 0) {
      resolved.set(window.key, []);
      continue;
    }

    if (!rule.enabled) {
      resolved.set(window.key, availableSlots);
      for (const slot of availableSlots) {
        slotLoad.set(slot, (slotLoad.get(slot) ?? 0) + 1);
      }
      continue;
    }

    const slotLengthMinutes = Math.max(rule.slotLengthMinutes, 1);
    const minimumSlots = clamp(
      safeSlotCount(rule.minimumMinutes, slotLengthMinutes, 1),
      1,
      availableSlots.length
    );
    const maximumSlots = clamp(
      safeSlotCount(
        rule.maximumMinutes,
        slotLengthMinutes,
        availableSlots.length
      ),
      minimumSlots,
      availableSlots.length
    );
    const preferredSlots = clamp(
      safeSlotCount(rule.preferredMinutes, slotLengthMinutes, minimumSlots),
      minimumSlots,
      maximumSlots
    );

    let bestSlots = availableSlots.slice(0, preferredSlots);
    let bestScore = Number.POSITIVE_INFINITY;

    for (
      let durationSlots = minimumSlots;
      durationSlots <= maximumSlots;
      durationSlots += 1
    ) {
      for (
        let startIndex = 0;
        startIndex + durationSlots <= availableSlots.length;
        startIndex += 1
      ) {
        const candidate = availableSlots.slice(
          startIndex,
          startIndex + durationSlots
        );
        const totalOverlap = candidate.reduce(
          (sum, slot) => sum + (slotLoad.get(slot) ?? 0),
          0
        );
        const peakOverlap = candidate.reduce(
          (maximum, slot) => Math.max(maximum, slotLoad.get(slot) ?? 0),
          0
        );
        const durationDeviation = Math.abs(
          durationSlots - preferredSlots
        );

        // Avoid stacking flexible events on the same half-hour when another
        // valid placement exists. After that, stay as close as possible to the
        // configured preferred duration and use the earliest valid slot.
        const score =
          peakOverlap * 1_000 +
          totalOverlap * 200 +
          durationDeviation * 25 +
          startIndex;

        if (score < bestScore) {
          bestScore = score;
          bestSlots = candidate;
        }
      }
    }

    resolved.set(window.key, bestSlots);

    for (const slot of bestSlots) {
      slotLoad.set(slot, (slotLoad.get(slot) ?? 0) + 1);
    }
  }

  return resolved;
}
