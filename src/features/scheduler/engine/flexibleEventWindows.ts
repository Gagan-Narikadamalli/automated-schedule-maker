import { getEndTimeForSlot, getEventStartSlotsInsideTimeRange } from "./dateUtils";

export type FlexibleEventWindow = {
  key: string;
  startTime: string;
  endTime: string;
  priority?: number;
  allowedSlots?: string[];
};

export type FlexibleEventDurationRule = {
  enabled: boolean;
  durationMinutes: number;
  slotLengthMinutes: number;
};

function safeSlotCount(
  minutes: number,
  slotLengthMinutes: number
): number {
  if (!Number.isFinite(minutes) || minutes <= 0 || slotLengthMinutes <= 0) {
    return 1;
  }

  return Math.max(Math.round(minutes / slotLengthMinutes), 1);
}

/**
 * A configured event start/end time is a placement WINDOW, not the event
 * duration. The event window end is an inclusive allowed START:
 * a 13:00–14:00 window permits the 14:00 start finishing at 14:30.
 * All occupied slots still need client/staff attendance. Overlapping windows are staggered
 * when possible so nap/speech time can also create useful staff-break capacity.
 *
 * When disabled, the automatic scheduler ignores the window completely.
 */
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
    const allowedSlotSet = window.allowedSlots
      ? new Set(window.allowedSlots)
      : null;
    const availableSlots = getEventStartSlotsInsideTimeRange(
      window.startTime,
      window.endTime
    ).filter(
      (slot) => !allowedSlotSet || allowedSlotSet.has(slot)
    );

    if (!rule.enabled || availableSlots.length === 0) {
      resolved.set(window.key, []);
      continue;
    }

    const durationSlots = safeSlotCount(rule.durationMinutes, rule.slotLengthMinutes);
    if (availableSlots.length < durationSlots) {
      resolved.set(window.key, []);
      continue;
    }

    let bestSlots = availableSlots.slice(0, durationSlots);
    let bestScore = Number.POSITIVE_INFINITY;

    for (
      let startIndex = 0;
      startIndex + durationSlots <= availableSlots.length;
      startIndex += 1
    ) {
      const candidate = availableSlots.slice(
        startIndex,
        startIndex + durationSlots
      );
      // Missing middle attendance slots must never produce a discontinuous event.
      if (candidate.some((slot,index)=>index>0 &&
        getEndTimeForSlot(candidate[index-1])!==slot)) continue;
      const totalOverlap = candidate.reduce(
        (sum, slot) => sum + (slotLoad.get(slot) ?? 0),
        0
      );
      const peakOverlap = candidate.reduce(
        (maximum, slot) => Math.max(maximum, slotLoad.get(slot) ?? 0),
        0
      );

      // First avoid stacking flexible events on the same half-hour. When two
      // placements are otherwise equally good, choose the earlier one.
      const score =
        peakOverlap * 1_000 +
        totalOverlap * 200 +
        startIndex;

      if (score < bestScore) {
        bestScore = score;
        bestSlots = candidate;
      }
    }

    if (!Number.isFinite(bestScore)) {
      resolved.set(window.key, []);
      continue;
    }
    resolved.set(window.key, bestSlots);

    for (const slot of bestSlots) {
      slotLoad.set(slot, (slotLoad.get(slot) ?? 0) + 1);
    }
  }

  return resolved;
}
