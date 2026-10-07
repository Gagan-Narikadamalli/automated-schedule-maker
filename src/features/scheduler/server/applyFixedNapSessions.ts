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

  const fixedNapWindows = sessions
    .filter((session) => {
      const startTime = String(session.startTime ?? "");
      const endTime = String(session.endTime ?? "");
      return Boolean(startTime && endTime && endTime > startTime);
    })
    .map((session, index) => ({
      key: `fixed-nap-${String(session._id ?? index)}`,
      clientId: String(session.clientId ?? ""),
      startTime: String(session.startTime),
      endTime: String(session.endTime),
      priority:
        String(session.priorityCategory ?? "OLDER") === "YOUNGER"
          ? 0
          : 10,
    }));

  const resolvedFixedNapSlots = resolveFlexibleEventWindows(
    fixedNapWindows,
    {
      enabled: input.rules.napDurationRulesEnabled ?? true,
      durationMinutes: input.rules.napPreferredMinutes ?? 30,
      slotLengthMinutes: input.rules.slotLengthMinutes,
    }
  );
  const fixedNapSlotsByClient = new Map<string, Set<string>>();

  for (const window of fixedNapWindows) {
    if (!window.clientId) continue;
    const slots = fixedNapSlotsByClient.get(window.clientId) ?? new Set<string>();

    for (const slot of resolvedFixedNapSlots.get(window.key) ?? []) {
      slots.add(slot);
    }

    fixedNapSlotsByClient.set(window.clientId, slots);
  }

  const clients = input.clients.map((client) => {
    const clientSessions = sessionsByClient.get(client.id) ?? [];
    const clientAttendanceChanges = attendanceChangesByClient.get(client.id) ?? [];
    let nextClient = { ...client };

    if (clientSessions.length > 0) {
      const fixedNapSlots =
        fixedNapSlotsByClient.get(client.id) ?? new Set<string>();
      const priorityCategory: NapPriorityCategory =
        clientSessions.some(
          (session) =>
            String(session.priorityCategory ?? "OLDER") === "YOUNGER"
        )
          ? "YOUNGER"
          : "OLDER";

      if (fixedNapSlots.size > 0) {
        const restoredCoverage = new Set([
          ...nextClient.requiredSlots,
          ...nextClient.napSlots,
        ]);

        for (const speechSlot of nextClient.speechSlots) {
          restoredCoverage.delete(speechSlot);
        }
        for (const napSlot of fixedNapSlots) {
          restoredCoverage.delete(napSlot);
        }

        nextClient = {
          ...nextClient,
          requiredSlots: [...restoredCoverage].sort(),
          napSlots: [...fixedNapSlots].sort(),
          napPriorityCategory: priorityCategory,
        };
      }
    }

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

  const affectedClientIds = new Set([
    ...sessionsByClient.keys(),
    ...attendanceChangesByClient.keys(),
  ]);

  return {
    input: {
      ...input,
      clients,
    },
    applied: sessions.length > 0 || attendanceChanges.length > 0,
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
