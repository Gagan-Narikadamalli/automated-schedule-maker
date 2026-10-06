import { calculateSchedulerReadiness } from "@/features/scheduler/engine/preflight";
import { buildDaySchedulerInput } from "@/features/scheduler/server/buildDaySchedulerInput";
import { connectToDatabase } from "@/lib/db";
import { ScheduleAssignment } from "@/models/ScheduleAssignment";
import { UnplacedAssignment } from "@/models/UnplacedAssignment";

import type { SchedulerAiContext } from "./types";

type DatabaseRecord = Record<string, any>;

type DateContextSegment = {
  staffId: string | null;
  staffName: string | null;
  clientId: string | null;
  clientCode: string | null;
  assignmentType: string;
  startTime: string;
  endTime: string;
  locked: boolean;
  manuallyOverridden: boolean;
};

function idFrom(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "object" && "_id" in (value as Record<string, unknown>)) {
    const id = (value as Record<string, unknown>)._id;
    return id ? String(id) : null;
  }
  return String(value);
}

function mergeSegments(assignments: DateContextSegment[]) {
  const sorted = [...assignments].sort((left, right) => {
    const staffCompare = (left.staffName ?? "").localeCompare(right.staffName ?? "");
    if (staffCompare !== 0) return staffCompare;
    const clientCompare = (left.clientCode ?? "").localeCompare(right.clientCode ?? "");
    if (clientCompare !== 0) return clientCompare;
    const typeCompare = left.assignmentType.localeCompare(right.assignmentType);
    if (typeCompare !== 0) return typeCompare;
    return left.startTime.localeCompare(right.startTime);
  });

  const merged: DateContextSegment[] = [];
  for (const assignment of sorted) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.staffId === assignment.staffId &&
      previous.clientId === assignment.clientId &&
      previous.assignmentType === assignment.assignmentType &&
      previous.endTime === assignment.startTime &&
      previous.locked === assignment.locked &&
      previous.manuallyOverridden === assignment.manuallyOverridden
    ) {
      previous.endTime = assignment.endTime;
      continue;
    }
    merged.push({ ...assignment });
  }
  return merged;
}

export async function buildSchedulerDateContextSnapshot(context: SchedulerAiContext) {
  const { locationId, date } = context;
  const dayData = await buildDaySchedulerInput(locationId, date);

  await connectToDatabase();
  const [assignmentRecords, unplacedRecords] = await Promise.all([
    ScheduleAssignment.find({ locationId, date })
      .select(
        "staffId clientId startTime endTime assignmentType source locked manuallyOverridden note"
      )
      .sort({ startTime: 1 })
      .lean(),
    UnplacedAssignment.find({
      locationId,
      date,
      status: "UNPLACED",
    })
      .populate("clientId", "displayCode")
      .select("clientId displayText originalStaffId originalStartTime reason origin")
      .sort({ originalStartTime: 1, createdAt: 1 })
      .lean(),
  ]);

  const assignments = assignmentRecords as unknown as DatabaseRecord[];
  const unplaced = unplacedRecords as unknown as DatabaseRecord[];
  const staffNames = new Map(dayData.staff.map((member) => [member.id, member.name]));
  const clientCodes = new Map(
    dayData.clients.map((client) => [client.id, client.displayCode])
  );

  const enrichedAssignments: DateContextSegment[] = assignments.map((assignment) => {
    const staffId = idFrom(assignment.staffId);
    const clientId = idFrom(assignment.clientId);
    return {
      staffId,
      staffName: staffId ? staffNames.get(staffId) ?? "Unknown staff" : null,
      clientId,
      clientCode: clientId ? clientCodes.get(clientId) ?? null : null,
      assignmentType: String(assignment.assignmentType ?? ""),
      startTime: String(assignment.startTime ?? ""),
      endTime: String(assignment.endTime ?? ""),
      locked: assignment.locked === true,
      manuallyOverridden: assignment.manuallyOverridden === true,
    };
  });

  const mergedAssignments = mergeSegments(enrichedAssignments);
  const assignmentsByStaff = new Map<string, DateContextSegment[]>();
  const assignmentsByClient = new Map<string, DateContextSegment[]>();
  for (const assignment of enrichedAssignments) {
    if (assignment.staffId) {
      const current = assignmentsByStaff.get(assignment.staffId) ?? [];
      current.push(assignment);
      assignmentsByStaff.set(assignment.staffId, current);
    }
    if (assignment.clientId) {
      const current = assignmentsByClient.get(assignment.clientId) ?? [];
      current.push(assignment);
      assignmentsByClient.set(assignment.clientId, current);
    }
  }

  const requiredKeys = new Set<string>();
  for (const client of dayData.clients) {
    for (const startTime of client.requiredSlots) {
      requiredKeys.add(`${client.id}:${startTime}`);
    }
  }

  const coveredKeys = new Set<string>();
  for (const assignment of enrichedAssignments) {
    if (
      assignment.assignmentType === "CLIENT_1_TO_1" &&
      assignment.clientId
    ) {
      coveredKeys.add(`${assignment.clientId}:${assignment.startTime}`);
    }
  }

  const uncoveredRequirements: Array<{ clientCode: string; startTime: string }> = [];
  for (const key of requiredKeys) {
    if (coveredKeys.has(key)) continue;
    const separator = key.lastIndexOf(":");
    const clientId = key.slice(0, separator);
    const startTime = key.slice(separator + 1);
    uncoveredRequirements.push({
      clientCode: clientCodes.get(clientId) ?? "Unknown client",
      startTime,
    });
  }

  const scheduleAvailable = assignments.length > 0;
  const slotLengthMinutes = dayData.extendedRules.slotLengthMinutes;

  return {
    locationId,
    locationName: context.locationName ?? "Clinic",
    date,
    scheduleAvailable,
    scheduleMessage: scheduleAvailable
      ? `A saved/generated schedule is available for ${date}.`
      : `The schedule has not been generated for ${date}.`,
    readiness: calculateSchedulerReadiness(dayData.input, dayData.extendedRules),
    rules: {
      slotLengthMinutes,
      breakEligibilityHours: dayData.extendedRules.breakEligibilityHours,
      breakWindowStart: dayData.extendedRules.breakWindowStart ?? null,
      breakWindowEnd: dayData.extendedRules.breakWindowEnd ?? null,
    },
    summary: {
      staffCount: dayData.staff.length,
      clientCount: dayData.clients.length,
      assignmentCount: assignments.length,
      requiredClientSlots: requiredKeys.size,
      coveredClientSlots: requiredKeys.size - uncoveredRequirements.length,
      uncoveredClientSlots: uncoveredRequirements.length,
      unplacedCount: unplaced.length,
      calledOutStaffCount: dayData.input.callOutStaffIds.length,
    },
    staff: dayData.staff.map((member) => {
      const staffAssignments = assignmentsByStaff.get(member.id) ?? [];
      const scheduledSlots = new Set(staffAssignments.map((assignment) => assignment.startTime));
      const breakAssignments = staffAssignments.filter((assignment) =>
        ["BREAK", "BREAK_NAP", "BREAK_SPEECH"].includes(assignment.assignmentType)
      );
      const freeSlots = scheduleAvailable
        ? member.availableSlots.filter((slot) => !scheduledSlots.has(slot))
        : [];
      return {
        id: member.id,
        name: member.name,
        role: member.role,
        teamId: member.teamId ?? null,
        calledOut: dayData.input.callOutStaffIds.includes(member.id),
        availableSlots: member.availableSlots,
        availableHours: (member.availableSlots.length * slotLengthMinutes) / 60,
        freeSlots,
        breaks: mergeSegments(breakAssignments),
        schedule: mergeSegments(staffAssignments),
      };
    }),
    clients: dayData.clients.map((client) => ({
      id: client.id,
      displayCode: client.displayCode,
      teamId: client.teamId ?? null,
      supportLevel: client.supportLevel ?? null,
      requiredSlots: client.requiredSlots,
      napSlots: client.napSlots,
      speechSlots: client.speechSlots,
      coverage: mergeSegments(assignmentsByClient.get(client.id) ?? []),
    })),
    assignments: mergedAssignments,
    uncoveredRequirements,
    unplacedAssignments: unplaced.map((record) => {
      const populatedClient =
        record.clientId && typeof record.clientId === "object"
          ? (record.clientId as DatabaseRecord)
          : null;
      return {
        id: String(record._id),
        clientCode: populatedClient?.displayCode
          ? String(populatedClient.displayCode)
          : null,
        displayText: String(record.displayText ?? "Needs scheduling"),
        originalStartTime: String(record.originalStartTime ?? ""),
        reason: String(record.reason ?? "Coverage is missing."),
        origin: String(record.origin ?? ""),
      };
    }),
  };
}
