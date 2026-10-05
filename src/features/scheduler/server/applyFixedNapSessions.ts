import { getSlotsInsideTimeRange } from "@/features/scheduler/engine/dateUtils";
import type {
  NapPriorityCategory,
  SchedulerInput,
} from "@/features/scheduler/engine/types";
import { connectToDatabase } from "@/lib/db";
import { NapSession } from "@/models/NapSession";

type DatabaseRecord = Record<string, any>;

export type FixedNapApplicationResult = {
  input: SchedulerInput;
  applied: boolean;
  sessionCount: number;
  clientCount: number;
};

export async function applyFixedNapSessions(
  locationId: string,
  date: string,
  input: SchedulerInput
): Promise<FixedNapApplicationResult> {
  await connectToDatabase();

  const rawSessions = await NapSession.find({ locationId, date })
    .sort({ priorityCategory: 1, startTime: 1 })
    .lean();
  const sessions = rawSessions as unknown as DatabaseRecord[];

  if (sessions.length === 0) {
    return {
      input,
      applied: false,
      sessionCount: 0,
      clientCount: 0,
    };
  }

  const sessionsByClient = new Map<string, DatabaseRecord[]>();

  for (const session of sessions) {
    const clientId = String(session.clientId ?? "");

    if (!clientId) {
      continue;
    }

    sessionsByClient.set(clientId, [
      ...(sessionsByClient.get(clientId) ?? []),
      session,
    ]);
  }

  const clients = input.clients.map((client) => {
    const clientSessions = sessionsByClient.get(client.id);

    if (!clientSessions || clientSessions.length === 0) {
      return client;
    }

    const fixedNapSlots = new Set<string>();
    let priorityCategory: NapPriorityCategory = "OLDER";

    for (const session of clientSessions) {
      const startTime = String(session.startTime ?? "");
      const endTime = String(session.endTime ?? "");

      if (!startTime || !endTime || endTime <= startTime) {
        continue;
      }

      if (String(session.priorityCategory ?? "OLDER") === "YOUNGER") {
        priorityCategory = "YOUNGER";
      }

      for (const slot of getSlotsInsideTimeRange(startTime, endTime)) {
        fixedNapSlots.add(slot);
      }
    }

    if (fixedNapSlots.size === 0) {
      return client;
    }

    // buildDaySchedulerInput may already have removed a repeating client nap
    // pattern. A saved fixed nap event replaces that pattern for this date, so
    // put those old nap slots back into required coverage first and then remove
    // only the manager-selected fixed nap slots. Speech remains protected.
    const restoredCoverage = new Set([
      ...client.requiredSlots,
      ...client.napSlots,
    ]);

    for (const speechSlot of client.speechSlots) {
      restoredCoverage.delete(speechSlot);
    }

    for (const napSlot of fixedNapSlots) {
      restoredCoverage.delete(napSlot);
    }

    return {
      ...client,
      requiredSlots: [...restoredCoverage].sort(),
      napSlots: [...fixedNapSlots].sort(),
      napPriorityCategory: priorityCategory,
    };
  });

  return {
    input: {
      ...input,
      clients,
    },
    applied: true,
    sessionCount: sessions.length,
    clientCount: sessionsByClient.size,
  };
}
