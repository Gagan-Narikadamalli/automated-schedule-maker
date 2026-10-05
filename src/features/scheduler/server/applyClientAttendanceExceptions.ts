import { getSlotsInsideTimeRange } from "@/features/scheduler/engine/dateUtils";
import type { SchedulerInput } from "@/features/scheduler/engine/types";
import { connectToDatabase } from "@/lib/db";
import { ClientAttendanceException } from "@/models/ClientAttendanceException";

type DatabaseRecord = Record<string, any>;

export type ClientAttendanceApplicationResult = {
  input: SchedulerInput;
  applied: boolean;
  changeCount: number;
  callOutCount: number;
  callInCount: number;
};

export async function applyClientAttendanceExceptions(
  locationId: string,
  date: string,
  input: SchedulerInput
): Promise<ClientAttendanceApplicationResult> {
  await connectToDatabase();

  const rawChanges = await ClientAttendanceException.find({ locationId, date }).lean();
  const changes = rawChanges as unknown as DatabaseRecord[];

  if (changes.length === 0) {
    return { input, applied: false, changeCount: 0, callOutCount: 0, callInCount: 0 };
  }

  const changesByClient = new Map<string, DatabaseRecord[]>();
  for (const change of changes) {
    const clientId = String(change.clientId ?? "");
    if (!clientId) continue;
    changesByClient.set(clientId, [...(changesByClient.get(clientId) ?? []), change]);
  }

  const clients = input.clients.map((client) => {
    const clientChanges = changesByClient.get(client.id);
    if (!clientChanges?.length) return client;

    const requiredSlots = new Set(client.requiredSlots);

    for (const change of clientChanges) {
      const startTime = String(change.startTime ?? "");
      const endTime = String(change.endTime ?? "");
      if (!startTime || !endTime || endTime <= startTime) continue;

      const changeSlots = getSlotsInsideTimeRange(startTime, endTime);
      if (String(change.changeType) === "CALL_IN") {
        for (const slot of changeSlots) {
          if (!client.napSlots.includes(slot) && !client.speechSlots.includes(slot)) {
            requiredSlots.add(slot);
          }
        }
      } else {
        for (const slot of changeSlots) requiredSlots.delete(slot);
      }
    }

    return { ...client, requiredSlots: [...requiredSlots].sort() };
  });

  return {
    input: { ...input, clients },
    applied: true,
    changeCount: changes.length,
    callOutCount: changes.filter((change) => String(change.changeType) !== "CALL_IN").length,
    callInCount: changes.filter((change) => String(change.changeType) === "CALL_IN").length,
  };
}
