import { getSlotsInsideTimeRange, patternMatchesDate } from "@/features/scheduler/engine/dateUtils";
import type {
  SchedulerAssignment,
  SchedulerClient,
  SchedulerInput,
  SchedulerRules,
  SchedulerStaff,
  StaffRelationship,
} from "@/features/scheduler/engine/types";
import { connectToDatabase } from "@/lib/db";
import { CallOut } from "@/models/CallOut";
import { Client } from "@/models/Client";
import { ScheduleAssignment } from "@/models/ScheduleAssignment";
import { SchedulingRules } from "@/models/SchedulingRules";
import { SpeechSession } from "@/models/SpeechSession";
import { Staff } from "@/models/Staff";

type PatternRecord = {
  days?: string[];
  startTime?: string;
  endTime?: string;
};

type RelationshipRecord = {
  staffId?: unknown;
  relationship?: StaffRelationship;
};

type LeanStaff = {
  _id: unknown;
  teamId?: unknown;
  fullName: string;
  startDate: Date;
  endDate?: Date | null;
  maximumWeeklyHours?: number;
  shiftPatterns?: PatternRecord[];
};

type LeanClient = {
  _id: unknown;
  teamId?: unknown;
  displayCode: string;
  startDate: Date;
  endDate?: Date | null;
  attendancePatterns?: PatternRecord[];
  napPatterns?: PatternRecord[];
  staffRelationships?: RelationshipRecord[];
};

type LeanCallOut = {
  staffId: unknown;
  startTime: string;
  endTime: string;
};

type LeanSpeechSession = {
  clientId: unknown;
  startTime: string;
  endTime: string;
};

type LeanAssignment = {
  _id: unknown;
  staffId: unknown;
  clientId?: unknown;
  startTime: string;
  assignmentType: SchedulerAssignment["assignmentType"];
  source: SchedulerAssignment["source"];
  locked: boolean;
  manuallyOverridden?: boolean;
  note?: string;
};

function dateIsWithinRecordRange(
  date: string,
  startDate: Date,
  endDate?: Date | null
): boolean {
  const requestedDate = new Date(`${date}T12:00:00`);
  const normalizedStart = new Date(startDate);
  const normalizedEnd = endDate ? new Date(endDate) : null;

  normalizedStart.setHours(0, 0, 0, 0);

  if (normalizedEnd) {
    normalizedEnd.setHours(23, 59, 59, 999);
  }

  return (
    requestedDate >= normalizedStart &&
    (!normalizedEnd || requestedDate <= normalizedEnd)
  );
}

function slotsForPatterns(
  patterns: PatternRecord[] | undefined,
  date: string
): string[] {
  const slots = new Set<string>();

  for (const pattern of patterns ?? []) {
    if (
      !pattern.startTime ||
      !pattern.endTime ||
      !patternMatchesDate(pattern.days, date)
    ) {
      continue;
    }

    for (const slot of getSlotsInsideTimeRange(
      pattern.startTime,
      pattern.endTime
    )) {
      slots.add(slot);
    }
  }

  return [...slots].sort();
}

function removeSlotsInsideRanges(
  slots: string[],
  ranges: Array<{ startTime: string; endTime: string }>
): string[] {
  return slots.filter(
    (slot) =>
      !ranges.some(
        (range) => slot >= range.startTime && slot < range.endTime
      )
  );
}

function getDefaultRules(): SchedulerRules & {
  breakWindowStart: string;
  breakWindowEnd: string;
  defaultBreakMinutes: number;
} {
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

export type DaySchedulerData = {
  input: SchedulerInput;
  extendedRules: SchedulerRules & {
    breakWindowStart: string;
    breakWindowEnd: string;
    defaultBreakMinutes: number;
  };
  staff: SchedulerStaff[];
  clients: SchedulerClient[];
  partialCallOuts: LeanCallOut[];
};

export async function buildDaySchedulerInput(
  locationId: string,
  date: string
): Promise<DaySchedulerData> {
  await connectToDatabase();

  const [
    staffDocuments,
    clientDocuments,
    callOutDocuments,
    speechDocuments,
    assignmentDocuments,
    rulesDocument,
  ] = await Promise.all([
    Staff.find({ locationId, active: true }).sort({ fullName: 1 }).lean(),
    Client.find({ locationId, active: true }).sort({ displayCode: 1 }).lean(),
    CallOut.find({ locationId, date }).lean(),
    SpeechSession.find({ locationId, date }).lean(),
    ScheduleAssignment.find({ locationId, date }).lean(),
    SchedulingRules.findOne({ locationId }).lean(),
  ]);

  const callOuts = callOutDocuments as unknown as LeanCallOut[];
  const speechSessions = speechDocuments as unknown as LeanSpeechSession[];

  const staff: SchedulerStaff[] = (
    staffDocuments as unknown as LeanStaff[]
  )
    .filter((staffMember) =>
      dateIsWithinRecordRange(
        date,
        staffMember.startDate,
        staffMember.endDate
      )
    )
    .map((staffMember) => {
      const staffId = String(staffMember._id);
      const unavailableRanges = callOuts
        .filter((callOut) => String(callOut.staffId) === staffId)
        .map((callOut) => ({
          startTime: callOut.startTime,
          endTime: callOut.endTime,
        }));

      const availableSlots = removeSlotsInsideRanges(
        slotsForPatterns(staffMember.shiftPatterns, date),
        unavailableRanges
      );

      return {
        id: staffId,
        name: staffMember.fullName,
        teamId: staffMember.teamId ? String(staffMember.teamId) : undefined,
        availableSlots,
      };
    });

  const clients: SchedulerClient[] = (
    clientDocuments as unknown as LeanClient[]
  )
    .filter((client) =>
      dateIsWithinRecordRange(date, client.startDate, client.endDate)
    )
    .map((client) => {
      const clientId = String(client._id);
      const napRanges = (client.napPatterns ?? [])
        .filter((pattern) => patternMatchesDate(pattern.days, date))
        .filter(
          (pattern): pattern is PatternRecord & {
            startTime: string;
            endTime: string;
          } => Boolean(pattern.startTime && pattern.endTime)
        )
        .map((pattern) => ({
          startTime: pattern.startTime,
          endTime: pattern.endTime,
        }));

      const speechRanges = speechSessions
        .filter((session) => String(session.clientId) === clientId)
        .map((session) => ({
          startTime: session.startTime,
          endTime: session.endTime,
        }));

      const requiredSlots = removeSlotsInsideRanges(
        slotsForPatterns(client.attendancePatterns, date),
        [...napRanges, ...speechRanges]
      );

      const staffRelationships: Record<string, StaffRelationship> = {};

      for (const relationship of client.staffRelationships ?? []) {
        if (!relationship.staffId || !relationship.relationship) {
          continue;
        }

        staffRelationships[String(relationship.staffId)] =
          relationship.relationship;
      }

      return {
        id: clientId,
        displayCode: client.displayCode,
        teamId: client.teamId ? String(client.teamId) : undefined,
        requiredSlots,
        staffRelationships,
      };
    });

  const existingAssignments: SchedulerAssignment[] = (
    assignmentDocuments as unknown as LeanAssignment[]
  ).map((assignment) => ({
    id: String(assignment._id),
    staffId: String(assignment.staffId),
    clientId: assignment.clientId
      ? String(assignment.clientId)
      : undefined,
    startTime: assignment.startTime,
    assignmentType: assignment.assignmentType,
    source: assignment.source,
    locked: assignment.locked || Boolean(assignment.manuallyOverridden),
    note: assignment.note,
  }));

  const defaultRules = getDefaultRules();
  const extendedRules = {
    ...defaultRules,
    ...(rulesDocument
      ? {
          maximumClientsPerTechPerDay:
            rulesDocument.maximumClientsPerTechPerDay,
          maximumTechsPerClientPerDay:
            rulesDocument.maximumTechsPerClientPerDay,
          preferSameTeam: rulesDocument.preferSameTeam,
          preferStaffContinuity: rulesDocument.preferStaffContinuity,
          slotLengthMinutes: rulesDocument.slotLengthMinutes,
          breakWindowStart: rulesDocument.breakWindowStart,
          breakWindowEnd: rulesDocument.breakWindowEnd,
          defaultBreakMinutes: rulesDocument.defaultBreakMinutes,
        }
      : {}),
  };

  const fullDayCallOutStaffIds = callOuts
    .filter(
      (callOut) =>
        callOut.startTime <= "08:00" && callOut.endTime >= "18:00"
    )
    .map((callOut) => String(callOut.staffId));

  return {
    input: {
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
        preferStaffContinuity: extendedRules.preferStaffContinuity,
        slotLengthMinutes: extendedRules.slotLengthMinutes,
      },
    },
    extendedRules,
    staff,
    clients,
    partialCallOuts: callOuts,
  };
}
