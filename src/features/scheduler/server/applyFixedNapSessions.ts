import { getSlotsInsideTimeRange } from "@/features/scheduler/engine/dateUtils";
import { resolveFlexibleEventWindows } from "@/features/scheduler/engine/flexibleEventWindows";
import type {
  NapPriorityCategory,
  SchedulerInput,
} from "@/features/scheduler/engine/types";
import { connectToDatabase } from "@/lib/db";
import { ClientAttendanceException } from "@/models/ClientAttendanceException";
import { NapSession } from "@/models/NapSession";

type DatabaseRecord = Record<string, any>;

const DEFAULT_NAP_WINDOW_START = "11:30";
const DEFAULT_NAP_WINDOW_END = "14:00";

export type FixedNapApplicationResult = {
  input: SchedulerInput;
  applied: boolean;
  sessionCount: number;
  clientCount: number;
  attendanceChangeCount: number;
  callOutCount: number;
  callInCount: number;
};

export async function applyFixedNapSessions(
  locationId: string,
  date: string,
  input: SchedulerInput
): Promise<FixedNapApplicationResult> {
  await connectToDatabase();

  const [rawSessions, rawAttendanceChanges] = await Promise.all([
    NapSession.find({ locationId, date })
      .sort({ priorityCategory: 1, startTime: 1 })
      .lean(),
    ClientAttendanceException.find({ locationId, date })
      .sort({ startTime: 1 })
      .lean(),
  ]);

  const sessions = rawSessions as unknown as DatabaseRecord[];
  const attendanceChanges = rawAttendanceChanges as unknown as DatabaseRecord[];
  const sessionsByClient = new Map<string, DatabaseRecord[]>();
  const attendanceChangesByClient = new Map<string, DatabaseRecord[]>();

  for (const session of sessions) {
    const clientId = String(session.clientId ?? "");
    if (!clientId) continue;
    sessionsByClient.set(clientId, [
      ...(sessionsByClient.get(clientId) ?? []),
      session,
    ]);
  }

  for (const change of attendanceChanges) {
    const clientId = String(change.clientId ?? "");
    if (!clientId) continue;
    attendanceChangesByClient.set(clientId, [
      ...(attendanceChangesByClient.get(clientId) ?? []),
      change,
    ]);
  }

  /**
   * Speech is already removed from requiredSlots by buildDaySchedulerInput.
   * Nap is therefore resolved second. A saved Nap special event narrows a
   * child's placement window; when no special Nap event exists, every client
   * who is actually present during the clinic nap period receives one default
   * flexible nap window from 11:30 AM-2:00 PM.
   *
   * The actual duration still comes from Clinic Settings (normally 30 minutes).
   */
  const napWindows = input.clients.flatMap((client) => {
    const clientSessions = sessionsByClient.get(client.id) ?? [];
    const allowedSlots = [...client.requiredSlots];

    if (clientSessions.length > 0) {
      return clientSessions
        .filter((session) => {
          const startTime = String(session.startTime ?? "");
          const endTime = String(session.endTime ?? "");
          return Boolean(startTime && endTime && endTime > startTime);
        })
        .map((session, index) => ({
          key: `fixed-nap-${String(session._id ?? index)}`,
          clientId: client.id,
          startTime: String(session.startTime),
          endTime: String(session.endTime),
          allowedSlots,
          priority:
            String(session.priorityCategory ?? "OLDER") === "YOUNGER"
              ? 10
              : 20,
        }));
    }

    return [
      {
        key: `default-nap-${client.id}`,
        clientId: client.id,
        startTime: DEFAULT_NAP_WINDOW_START,
        endTime: DEFAULT_NAP_WINDOW_END,
        allowedSlots,
        priority: 30,
      },
    ];
  });

  const resolvedNapSlots = resolveFlexibleEventWindows(napWindows, {
    enabled: input.rules.napDurationRulesEnabled ?? true,
    durationMinutes: input.rules.napPreferredMinutes ?? 30,
    slotLengthMinutes: input.rules.slotLengthMinutes,
  });

  const napSlotsByClient = new Map<string, Set<string>>();

  for (const window of napWindows) {
    const slots =
      napSlotsByClient.get(window.clientId) ?? new Set<string>();

    for (const slot of resolvedNapSlots.get(window.key) ?? []) {
      slots.add(slot);
    }

    napSlotsByClient.set(window.clientId, slots);
  }

  const clients = input.clients.map((client) => {
    const clientSessions = sessionsByClient.get(client.id) ?? [];
    const clientAttendanceChanges =
      attendanceChangesByClient.get(client.id) ?? [];
    const napSlots = [
      ...(napSlotsByClient.get(client.id) ?? new Set<string>()),
    ].sort();

    const priorityCategory: NapPriorityCategory =
      clientSessions.some(
        (session) =>
          String(session.priorityCategory ?? "OLDER") === "YOUNGER"
      )
        ? "YOUNGER"
        : "OLDER";

    const restoredCoverage = new Set([
      ...client.requiredSlots,
      ...client.napSlots,
    ]);

    for (const speechSlot of client.speechSlots) {
      restoredCoverage.delete(speechSlot);
    }

    for (const napSlot of napSlots) {
      restoredCoverage.delete(napSlot);
    }

    let nextClient = {
      ...client,
      requiredSlots: [...restoredCoverage].sort(),
      napSlots,
      napPriorityCategory: priorityCategory,
    };

    if (clientAttendanceChanges.length > 0) {
      const requiredSlots = new Set(nextClient.requiredSlots);

      for (const change of clientAttendanceChanges) {
        const startTime = String(change.startTime ?? "");
        const endTime = String(change.endTime ?? "");
        if (!startTime || !endTime || endTime <= startTime) continue;

        const changeSlots = getSlotsInsideTimeRange(startTime, endTime);

        if (String(change.changeType) === "CALL_IN") {
          for (const slot of changeSlots) {
            if (
              !nextClient.napSlots.includes(slot) &&
              !nextClient.speechSlots.includes(slot)
            ) {
              requiredSlots.add(slot);
            }
          }
        } else {
          for (const slot of changeSlots) {
            requiredSlots.delete(slot);
          }
        }
      }

      nextClient = {
        ...nextClient,
        requiredSlots: [...requiredSlots].sort(),
      };
    }

    return nextClient;
  });

  const napClientIds = new Set(
    clients
      .filter((client) => client.napSlots.length > 0)
      .map((client) => client.id)
  );
  const affectedClientIds = new Set([
    ...napClientIds,
    ...attendanceChangesByClient.keys(),
  ]);

  return {
    input: {
      ...input,
      clients,
    },
    applied:
      napClientIds.size > 0 || attendanceChanges.length > 0,
    sessionCount: sessions.length,
    clientCount: affectedClientIds.size,
    attendanceChangeCount: attendanceChanges.length,
    callOutCount: attendanceChanges.filter(
      (change) => String(change.changeType) !== "CALL_IN"
    ).length,
    callInCount: attendanceChanges.filter(
      (change) => String(change.changeType) === "CALL_IN"
    ).length,
  };
}
