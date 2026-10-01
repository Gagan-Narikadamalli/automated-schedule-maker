import {
  getSlotsInsideTimeRange,
  patternMatchesDate,
} from "@/features/scheduler/engine/dateUtils";
import type {
  SchedulerAssignment,
  SchedulerClient,
  SchedulerInput,
  SchedulerRules,
  SchedulerStaff,
  ServiceSetting,
  StaffRelationship,
  SupportLevel,
} from "@/features/scheduler/engine/types";
import { connectToDatabase } from "@/lib/db";
import { CallOut } from "@/models/CallOut";
import { Client } from "@/models/Client";
import { ScheduleAssignment } from "@/models/ScheduleAssignment";
import { SchedulingRules } from "@/models/SchedulingRules";
import { SpeechSession } from "@/models/SpeechSession";
import { Staff } from "@/models/Staff";

type DatabaseRecord = Record<string, any>;

type ExtendedSchedulerRules = SchedulerRules & {
  breakWindowStart: string;
  breakWindowEnd: string;
  defaultBreakMinutes: number;
};

export type DaySchedulerData = {
  input: SchedulerInput;
  extendedRules: ExtendedSchedulerRules;
  staff: SchedulerStaff[];
  clients: SchedulerClient[];
  partialCallOuts: Array<{
    staffId: string;
    startTime: string;
    endTime: string;
  }>;
};

function isDateInsideActiveRange(
  requestedDateText: string,
  startDateValue: unknown,
  endDateValue: unknown
): boolean {
  const requestedDate = new Date(`${requestedDateText}T12:00:00`);
  const startDate = new Date(String(startDateValue));
  const endDate = endDateValue ? new Date(String(endDateValue)) : null;

  if (
    Number.isNaN(requestedDate.getTime()) ||
    Number.isNaN(startDate.getTime())
  ) {
    return false;
  }

  startDate.setHours(0, 0, 0, 0);

  if (endDate) {
    endDate.setHours(23, 59, 59, 999);
  }

  return (
    requestedDate.getTime() >= startDate.getTime() &&
    requestedDate.getTime() <=
      (endDate?.getTime() ?? Number.POSITIVE_INFINITY)
  );
}

function getPatternSlots(
  patterns: DatabaseRecord[] | undefined,
  date: string
): string[] {
  const slots = new Set<string>();

  for (const pattern of patterns ?? []) {
    const days = Array.isArray(pattern.days)
      ? pattern.days.map((day: unknown) => String(day))
      : [];
    const startTime = String(pattern.startTime ?? "");
    const endTime = String(pattern.endTime ?? "");

    if (!startTime || !endTime || !patternMatchesDate(days, date)) {
      continue;
    }

    for (const slot of getSlotsInsideTimeRange(startTime, endTime)) {
      slots.add(slot);
    }
  }

  return [...slots].sort();
}

function removeBlockedSlots(
  slots: string[],
  ranges: Array<{ startTime: string; endTime: string }>
): string[] {
  return slots.filter((slot) => {
    return !ranges.some((range) => {
      return slot >= range.startTime && slot < range.endTime;
    });
  });
}

function getDefaultRules(): ExtendedSchedulerRules {
  return {
    maximumClientsPerTechPerDay: 6,
    maximumTechsPerClientPerDay: 4,
    preferSameTeam: true,
    preferStaffContinuity: true,
    slotLengthMinutes: 30,
    breakWindowStart: "11:00",
    breakWindowEnd: "14:00",
    defaultBreakMinutes: 30,
  };
}

function mapRules(document: DatabaseRecord | null): ExtendedSchedulerRules {
  const defaults = getDefaultRules();

  if (!document) {
    return defaults;
  }

  return {
    maximumClientsPerTechPerDay: Number(
      document.maximumClientsPerTechPerDay ??
        defaults.maximumClientsPerTechPerDay
    ),
    maximumTechsPerClientPerDay: Number(
      document.maximumTechsPerClientPerDay ??
        defaults.maximumTechsPerClientPerDay
    ),
    preferSameTeam: Boolean(
      document.preferSameTeam ?? defaults.preferSameTeam
    ),
    preferStaffContinuity: Boolean(
      document.preferStaffContinuity ?? defaults.preferStaffContinuity
    ),
    slotLengthMinutes: Number(
      document.slotLengthMinutes ?? defaults.slotLengthMinutes
    ),
    breakWindowStart: String(
      document.breakWindowStart ?? defaults.breakWindowStart
    ),
    breakWindowEnd: String(
      document.breakWindowEnd ?? defaults.breakWindowEnd
    ),
    defaultBreakMinutes: Number(
      document.defaultBreakMinutes ?? defaults.defaultBreakMinutes
    ),
  };
}

function normalizeServiceSetting(value: unknown): ServiceSetting {
  if (value === "IN_HOME" || value === "BOTH") {
    return value;
  }

  return "IN_CENTER";
}

function normalizeSupportLevel(value: unknown): SupportLevel {
  if (
    value === "STANDARD" ||
    value === "ROTATION" ||
    value === "HIGH_SUPPORT"
  ) {
    return value;
  }

  return "ONE_TO_ONE";
}

function defaultRotationRules(supportLevel: SupportLevel) {
  if (supportLevel === "HIGH_SUPPORT") {
    return {
      maxConsecutiveBlocksWithSameStaff: 2,
      desiredDifferentStaffPerDay: 3,
    };
  }

  if (supportLevel === "ROTATION") {
    return {
      maxConsecutiveBlocksWithSameStaff: 4,
      desiredDifferentStaffPerDay: 2,
    };
  }

  return {
    maxConsecutiveBlocksWithSameStaff: 0,
    desiredDifferentStaffPerDay: 1,
  };
}

function mapStaff(
  staffDocuments: DatabaseRecord[],
  callOuts: DaySchedulerData["partialCallOuts"],
  date: string
): SchedulerStaff[] {
  return staffDocuments
    .filter((staffMember) => {
      return isDateInsideActiveRange(
        date,
        staffMember.startDate,
        staffMember.endDate
      );
    })
    .map((staffMember) => {
      const staffId = String(staffMember._id);
      const unavailableRanges = callOuts
        .filter((callOut) => callOut.staffId === staffId)
        .map((callOut) => ({
          startTime: callOut.startTime,
          endTime: callOut.endTime,
        }));

      const normalAvailableSlots = getPatternSlots(
        staffMember.shiftPatterns,
        date
      );

      return {
        id: staffId,
        name: String(staffMember.fullName ?? ""),
        teamId: staffMember.teamId
          ? String(staffMember.teamId)
          : undefined,
        serviceSetting: normalizeServiceSetting(staffMember.serviceSetting),
        availableSlots: removeBlockedSlots(
          normalAvailableSlots,
          unavailableRanges
        ),
      };
    });
}

function mapClients(
  clientDocuments: DatabaseRecord[],
  speechSessions: DatabaseRecord[],
  date: string
): SchedulerClient[] {
  return clientDocuments
    .filter((client) => {
      return isDateInsideActiveRange(
        date,
        client.startDate,
        client.endDate
      );
    })
    .map((client) => {
      const clientId = String(client._id);
      const attendanceSlots = getPatternSlots(
        client.attendancePatterns,
        date
      );

      const napRanges = (client.napPatterns ?? [])
        .filter((pattern: DatabaseRecord) => {
          const days = Array.isArray(pattern.days)
            ? pattern.days.map((day: unknown) => String(day))
            : [];

          return patternMatchesDate(days, date);
        })
        .filter((pattern: DatabaseRecord) => {
          return Boolean(pattern.startTime && pattern.endTime);
        })
        .map((pattern: DatabaseRecord) => ({
          startTime: String(pattern.startTime),
          endTime: String(pattern.endTime),
        }));

      const speechRanges = speechSessions
        .filter((session) => String(session.clientId) === clientId)
        .map((session) => ({
          startTime: String(session.startTime),
          endTime: String(session.endTime),
        }));

      const staffRelationships: Record<string, StaffRelationship> = {};

      for (const relationship of client.staffRelationships ?? []) {
        if (!relationship.staffId || !relationship.relationship) {
          continue;
        }

        const relationshipValue = String(relationship.relationship);

        if (
          relationshipValue === "PREFERRED" ||
          relationshipValue === "ALLOWED" ||
          relationshipValue === "HARD_RESTRICTION"
        ) {
          staffRelationships[String(relationship.staffId)] =
            relationshipValue;
        }
      }

      const supportLevel = normalizeSupportLevel(client.supportLevel);
      const defaults = defaultRotationRules(supportLevel);
      const configuredMaxConsecutive = Number(
        client.maxConsecutiveBlocksWithSameStaff ??
          defaults.maxConsecutiveBlocksWithSameStaff
      );
      const configuredDesiredDifferentStaff = Number(
        client.desiredDifferentStaffPerDay ??
          defaults.desiredDifferentStaffPerDay
      );

      return {
        id: clientId,
        displayCode: String(client.displayCode ?? ""),
        teamId: client.teamId ? String(client.teamId) : undefined,
        serviceSetting: normalizeServiceSetting(client.serviceSetting),
        supportLevel,
        requiredSlots: removeBlockedSlots(attendanceSlots, [
          ...napRanges,
          ...speechRanges,
        ]),
        staffRelationships,
        maxConsecutiveBlocksWithSameStaff:
          configuredMaxConsecutive > 0
            ? configuredMaxConsecutive
            : undefined,
        desiredDifferentStaffPerDay: Math.max(
          configuredDesiredDifferentStaff,
          1
        ),
      };
    });
}

function mapExistingAssignments(
  assignmentDocuments: DatabaseRecord[]
): SchedulerAssignment[] {
  return assignmentDocuments.map((assignment) => {
    return {
      id: String(assignment._id),
      staffId: String(assignment.staffId),
      clientId: assignment.clientId
        ? String(assignment.clientId)
        : undefined,
      startTime: String(assignment.startTime),
      assignmentType:
        assignment.assignmentType as SchedulerAssignment["assignmentType"],
      source: assignment.source as SchedulerAssignment["source"],
      locked:
        Boolean(assignment.locked) ||
        Boolean(assignment.manuallyOverridden),
      note: assignment.note ? String(assignment.note) : undefined,
    };
  });
}

export async function buildDaySchedulerInput(
  locationId: string,
  date: string
): Promise<DaySchedulerData> {
  await connectToDatabase();

  const [
    rawStaff,
    rawClients,
    rawCallOuts,
    rawSpeechSessions,
    rawAssignments,
    rawRules,
  ] = await Promise.all([
    Staff.find({ locationId, active: true })
      .sort({ fullName: 1 })
      .lean(),
    Client.find({ locationId, active: true })
      .sort({ displayCode: 1 })
      .lean(),
    CallOut.find({ locationId, date }).lean(),
    SpeechSession.find({ locationId, date }).lean(),
    ScheduleAssignment.find({ locationId, date }).lean(),
    SchedulingRules.findOne({ locationId }).lean(),
  ]);

  const staffDocuments = rawStaff as unknown as DatabaseRecord[];
  const clientDocuments = rawClients as unknown as DatabaseRecord[];
  const speechSessions = rawSpeechSessions as unknown as DatabaseRecord[];
  const assignmentDocuments = rawAssignments as unknown as DatabaseRecord[];
  const rulesDocument = rawRules as unknown as DatabaseRecord | null;

  const partialCallOuts = (
    rawCallOuts as unknown as DatabaseRecord[]
  ).map((callOut) => ({
    staffId: String(callOut.staffId),
    startTime: String(callOut.startTime),
    endTime: String(callOut.endTime),
  }));

  const staff = mapStaff(staffDocuments, partialCallOuts, date);
  const clients = mapClients(clientDocuments, speechSessions, date);
  const existingAssignments = mapExistingAssignments(
    assignmentDocuments
  );
  const extendedRules = mapRules(rulesDocument);

  const fullDayCallOutStaffIds = partialCallOuts
    .filter((callOut) => {
      return (
        callOut.startTime <= "08:00" &&
        callOut.endTime >= "18:00"
      );
    })
    .map((callOut) => callOut.staffId);

  const input: SchedulerInput = {
    staff,
    clients,
    existingAssignments,
    callOutStaffIds: fullDayCallOutStaffIds,
    rules: {
      maximumClientsPerTechPerDay:
        extendedRules.maximumClientsPerTechPerDay,
      maximumTechsPerClientPerDay:
        extendedRules.maximumTechsPerClientPerDay,
      preferSameTeam: extendedRules.preferSameTeam,
      preferStaffContinuity:
        extendedRules.preferStaffContinuity,
      slotLengthMinutes: extendedRules.slotLengthMinutes,
    },
  };

  return {
    input,
    extendedRules,
    staff,
    clients,
    partialCallOuts,
  };
}
