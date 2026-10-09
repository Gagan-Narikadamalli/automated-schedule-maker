import { getSlotsInsideTimeRange } from "@/features/scheduler/engine/dateUtils";
import { resolveFlexibleEventWindows } from "@/features/scheduler/engine/flexibleEventWindows";
import type {
  NapPriorityCategory,
  SchedulerInput,
} from "@/features/scheduler/engine/types";
import { connectToDatabase } from "@/lib/db";
import { ClientAttendanceException } from "@/models/ClientAttendanceException";
import { AttendanceOverride } from "@/models/AttendanceOverride";
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
  input: SchedulerInput,
  options: { ignoreNapSessions?: boolean } = {}
): Promise<FixedNapApplicationResult> {
  await connectToDatabase();

  const [rawSessions, rawAttendanceChanges, rawOverrides] = await Promise.all([
    NapSession.find({ locationId, date })
      .sort({ priorityCategory: 1, startTime: 1 }).lean(),
    ClientAttendanceException.find({ locationId, date })
      .sort({ startTime: 1 }).lean(),
    AttendanceOverride.find({ locationId, date, personType: "client" }).lean(),
  ]);
  // Only explicit Nap events can pause client coverage. Templates, profile
  // patterns, linked staff breaks, and default windows must never invent naps.
  const sessions = options.ignoreNapSessions ? [] : rawSessions as unknown as DatabaseRecord[];
  const attendanceChanges = rawAttendanceChanges as unknown as DatabaseRecord[];
  const clientOverrides = new Map((rawOverrides as unknown as DatabaseRecord[]).map((entry) => [String(entry.personId), entry]));
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

  // Every eligible nap window must originate in a saved Nap event for
  // this exact date. Clients without an event receive no nap slots.
  const napWindows = input.clients.flatMap((client) =>
    (sessionsByClient.get(client.id) ?? [])
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
        allowedSlots: [...client.requiredSlots],
        priority: String(session.priorityCategory ?? "OLDER") === "YOUNGER" ? 10 : 20,
      }))
  );

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
    const napSlots = [...(napSlotsByClient.get(client.id) ?? new Set<string>())].sort();

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

    // A new date-specific call-in/out is the final attendance authority.
    // Apply after legacy client attendance exceptions and nap resolution.
    const override = clientOverrides.get(client.id);
    if (override) {
      const changedSlots = new Set(getSlotsInsideTimeRange(String(override.startTime), String(override.endTime)));
      if (override.mode === "OUT") {
        nextClient = {
          ...nextClient,
          requiredSlots: nextClient.requiredSlots.filter((slot) => !changedSlots.has(slot)),
          napSlots: nextClient.napSlots.filter((slot) => !changedSlots.has(slot)),
          speechSlots: nextClient.speechSlots.filter((slot) => !changedSlots.has(slot)),
        };
      } else if (override.mode === "IN") {
        const required = new Set(nextClient.requiredSlots);
        for (const slot of changedSlots) {
          if (!nextClient.napSlots.includes(slot) && !nextClient.speechSlots.includes(slot)) required.add(slot);
        }
        nextClient = { ...nextClient, requiredSlots: [...required].sort() };
      }
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
