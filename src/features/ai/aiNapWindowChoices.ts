import { getEventStartSlotsInsideTimeRange } from "@/features/scheduler/engine/dateUtils";
import type { SchedulerInput } from "@/features/scheduler/engine/types";

type SavedNapWindow = {clientId: unknown;startTime: string;endTime: string};

/**
 * The native event pass already applies attendance exceptions and call-outs.
 * Offer the cloud planner only time slots that still belong to that attendance.
 * Fixed 30-minute events yield one choice; flexible saved windows give the
 * model a choice. Never synthesize naps for clients without a saved event.
 */
export function restoreAiNapWindowChoices(
  attendanceAware: SchedulerInput,
  savedWindows: SavedNapWindow[]
): SchedulerInput {
  return {
    ...attendanceAware,
    clients: attendanceAware.clients.map(client => {
      const attendance = new Set([
        ...client.requiredSlots,
        ...client.napSlots,
        ...client.speechSlots,
      ]);
      // No nap was eligible after applying date-specific attendance/configuration.
      if (!client.napSlots.length) {
        return {
          ...client,
          requiredSlots: [...attendance].sort(),
          napSlots: [],
        };
      }
      const eligible = new Set<string>();
      for (const window of savedWindows) {
        if (String(window.clientId) !== client.id ||
            !window.startTime || !window.endTime ||
            window.endTime <= window.startTime) continue;
        for (const slot of getEventStartSlotsInsideTimeRange(window.startTime, window.endTime)) {
          if (attendance.has(slot) && !client.speechSlots.includes(slot)) eligible.add(slot);
        }
      }
      // Do not lose the validated fixed event when older DB sessions cannot
      // be interpreted as windows.
      if (!eligible.size) client.napSlots.forEach(slot => eligible.add(slot));
      return {
        ...client,
        napSlots: [...eligible].sort(),
        requiredSlots: [...attendance].sort(),
      };
    }),
  };
}
