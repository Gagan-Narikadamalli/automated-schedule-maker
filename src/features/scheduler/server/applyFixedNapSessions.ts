import { selectBestWeekdayTemplate } from "@/features/scheduler/server/selectBestWeekdayTemplate";
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
import { ScheduleTemplate } from "@/models/ScheduleTemplate";

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

  const weekday = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"][new Date(`${date}T12:00:00Z`).getUTCDay()];
  const [rawSessions, rawAttendanceChanges, rawOverrides, rawTemplates] = await Promise.all([
    NapSession.find({ locationId, date })
      .sort({ priorityCategory: 1, startTime: 1 })
      .lean(),
    ClientAttendanceException.find({ locationId, date })
      .sort({ startTime: 1 })
      .lean(),
    AttendanceOverride.find({ locationId, date, personType: "client" }).lean(),
    ScheduleTemplate.find({ locationId, dayOfWeek: weekday, active: true, learningOnly: false }).sort({ updatedAt: -1, createdAt: -1 }).lean(),
  ]);

  const sessions = rawSessions as unknown as DatabaseRecord[];
  // Manually linked BREAK_NAP assignments are client-specific nap evidence.
  // Do not infer a client's nap from an unlinked generic staff break.
  const manualNapSlots = new Map<string, Set<string>>();
  for (const assignment of input.existingAssignments) {
    if (!["BREAK_NAP", "NAP"].includes(assignment.assignmentType) || !assignment.clientId) continue;
    const slots = manualNapSlots.get(assignment.clientId) ?? new Set<string>();
    slots.add(assignment.startTime);
    manualNapSlots.set(assignment.clientId, slots);
  }

  const primaryTemplate = selectBestWeekdayTemplate(rawTemplates as unknown as DatabaseRecord[], input.staff, input.clients);
  const templateNapSlots = new Map<string, Set<string>>();
  if (input.rules.autoUseWeekdayTemplate && primaryTemplate) {
    // New client-view nap cells and older imported NAP/BREAK_NAP assignment
    // records describe the same client-specific event.
    const templateNapRecords = [
      ...(Array.isArray(primaryTemplate.clientNapSlots) ? primaryTemplate.clientNapSlots : []),
      ...(Array.isArray(primaryTemplate.assignments)
        ? (primaryTemplate.assignments as DatabaseRecord[]).filter((row) =>
          (row.assignmentType === "NAP" || row.assignmentType === "BREAK_NAP") && Boolean(row.clientId))
        : []),
    ] as DatabaseRecord[];
    for (const record of templateNapRecords) {
      const clientId = String(record.clientId ?? "");
      const slot = String(record.startTime ?? "");
      if (!clientId || !/^\d{2}:\d{2}$/.test(slot)) continue;
      const slots = templateNapSlots.get(clientId) ?? new Set<string>();
      slots.add(slot);
      templateNapSlots.set(clientId, slots);
    }
  }
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

    if (clientSessions.length > 0 || (manualNapSlots.get(client.id)?.size ?? 0) > 0 || (templateNapSlots.get(client.id)?.size ?? 0) > 0) {
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
      ...new Set([
        ...(napSlotsByClient.get(client.id) ?? new Set<string>()),
        ...(clientSessions.length === 0 ? (manualNapSlots.get(client.id) ?? templateNapSlots.get(client.id) ?? new Set<string>()) : []),
      ]),
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
