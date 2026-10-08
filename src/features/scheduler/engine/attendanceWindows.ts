import { getSlotsInsideTimeRange } from "./dateUtils";

export type AttendanceWindow = {
  mode: "IN" | "OUT";
  startTime: string;
  endTime: string;
};

/**
 * Date-specific attendance overrides only the chosen interval. A call-in
 * makes otherwise unscheduled slots available; a call-out blocks them.
 */
export function applyAttendanceWindow(
  slots: string[],
  window?: AttendanceWindow
): string[] {
  if (!window) return [...slots];
  const interval = getSlotsInsideTimeRange(window.startTime, window.endTime);
  if (window.mode === "IN") {
    return [...new Set([...slots, ...interval])].sort();
  }
  const blocked = new Set(interval);
  return slots.filter((slot) => !blocked.has(slot));
}
