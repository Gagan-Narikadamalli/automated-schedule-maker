import {
  getDayKeys,
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
  StaffRole,
  SupportLevel,
} from "@/features/scheduler/engine/types";
import { connectToDatabase } from "@/lib/db";
import { CallOut } from "@/models/CallOut";
import { Client } from "@/models/Client";
import { ScheduleAssignment } from "@/models/ScheduleAssignment";
import { ScheduleTemplate } from "@/models/ScheduleTemplate";
import { SchedulingRules } from "@/models/SchedulingRules";
import { SpeechSession } from "@/models/SpeechSession";
import { Staff } from "@/models/Staff";

type DatabaseRecord = Record<string, any>;
type TimeRange = {
  startTime: string;
  endTime: string;
};

export type ExtendedSchedulerRules = SchedulerRules & {
  breakWindowStart: string;
  breakWindowEnd: string;
  breakSchedulingEnabled: boolean;
  defaultBreakMinutes: number;
  breakEligibilityHours: number;
  scheduleStartTime: string;
  scheduleEndTime: string;
  fullTimeMinimumWeeklyHours: number;
  fullTimeMaximumWeeklyHours: number;
  partTimeMinimumWeeklyHours: number;
  partTimeMaximumWeeklyHours: number;
  napDurationRulesEnabled: boolean;
  napMinimumMinutes: number;
  napPreferredMinutes: number;
  napMaximumMinutes: number;
  speechDurationRulesEnabled: boolean;
  speechMinimumMinutes: number;
  speechPreferredMinutes: number;
  speechMaximumMinutes: number;
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
  autoTemplateName: string | null;
  previousReferenceDate: string | null;
  historicalReferenceDates: string[];
};

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getWeekStart(dateText: string): string {
  const date = new Date(`${dateText}T12:00:00`);
  const day = date.getDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - daysSinceMonday);
  return formatLocalDate(date);
}

function getPreviousSameWeekdayDates(
  dateText: string,
  count: number
): string[] {
  const date = new Date(`${dateText}T12:00:00`);
  const dates: string[] = [];

  for (let index = 1; index <= count; index += 1) {
    const previousDate = new Date(date);
    previousDate.setDate(previousDate.getDate() - index * 7);
    dates.push(formatLocalDate(previousDate));
  }

  return dates;
}

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
  ranges: TimeRange[]
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
    minimumClientStaffAssignmentMinutes: 30,
    maximumClientStaffConsecutiveHours: 4,
    preventSameStaffClientRepeatSameDay: true,
    allowSameStaffClientRepeatForCoverageException: true,
    preferSameTeam: true,
    preferStaffContinuity: true,
    slotLengthMinutes: 30,
    preferredStaffPriority: 100,
    sameTeamPriority: 40,
    continuityPriority: 35,
    rotationPriority: 60,
    workloadBalancePriority: 10,
    clientHandoffPenaltyPriority: 25,
    staffScheduleCompactnessPriority: 8,
    minimalFixAllowProtectedRelocation: true,
    minimalFixAllowBreakRelocation: true,
    preserveManualOverrides: true,
    scheduleStabilityPriority: 140,
    weekdayTemplatePriority: 75,
    weeklyHoursPriority: 12,
    btCoveragePriority: 500,
    internCoveragePriority: 300,
    managerCoveragePriority: 125,
    bcbaCoveragePriority: 25,
    otherCoveragePriority: 75,
    autoUseWeekdayTemplate: true,
    autoUsePreviousWeekdaySchedule: true,
    breakWindowStart: "11:00",
    breakWindowEnd: "14:00",
    breakSchedulingEnabled: true,
    defaultBreakMinutes: 30,
    breakEligibilityHours: 0,
    scheduleStartTime: "08:00",
    scheduleEndTime: "20:00",
    fullTimeMinimumWeeklyHours: 30,
    fullTimeMaximumWeeklyHours: 40,
    partTimeMinimumWeeklyHours: 0,
    partTimeMaximumWeeklyHours: 29,
    napDurationRulesEnabled: true,
    napMinimumMinutes: 30,
    napPreferredMinutes: 30,
    napMaximumMinutes: 30,
    speechDurationRulesEnabled: true,
    speechMinimumMinutes: 30,
    speechPreferredMinutes: 30,
    speechMaximumMinutes: 30,
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
    minimumClientStaffAssignmentMinutes: Number(
      document.minimumClientStaffAssignmentMinutes ??
        defaults.minimumClientStaffAssignmentMinutes
    ),
    maximumClientStaffConsecutiveHours: Number(
      document.maximumClientStaffConsecutiveHours ??
        defaults.maximumClientStaffConsecutiveHours
    ),
    preventSameStaffClientRepeatSameDay: Boolean(
      document.preventSameStaffClientRepeatSameDay ??
        defaults.preventSameStaffClientRepeatSameDay
    ),
    allowSameStaffClientRepeatForCoverageException: Boolean(
      document.allowSameStaffClientRepeatForCoverageException ??
        defaults.allowSameStaffClientRepeatForCoverageException
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
    preferredStaffPriority: Number(
      document.preferredStaffPriority ?? defaults.preferredStaffPriority
    ),
    sameTeamPriority: Number(
      document.sameTeamPriority ?? defaults.sameTeamPriority
    ),
    continuityPriority: Number(
      document.continuityPriority ?? defaults.continuityPriority
    ),
    rotationPriority: Number(
      document.rotationPriority ?? defaults.rotationPriority
    ),
    workloadBalancePriority: Number(
      document.workloadBalancePriority ?? defaults.workloadBalancePriority
    ),
    clientHandoffPenaltyPriority: Number(
      document.clientHandoffPenaltyPriority ??
        defaults.clientHandoffPenaltyPriority
    ),
    staffScheduleCompactnessPriority: Number(
      document.staffScheduleCompactnessPriority ??
        defaults.staffScheduleCompactnessPriority
    ),
    minimalFixAllowProtectedRelocation: Boolean(
      document.minimalFixAllowProtectedRelocation ??
        defaults.minimalFixAllowProtectedRelocation
    ),
    minimalFixAllowBreakRelocation: Boolean(
      document.minimalFixAllowBreakRelocation ??
        defaults.minimalFixAllowBreakRelocation
    ),
    preserveManualOverrides: Boolean(
      document.preserveManualOverrides ??
        defaults.preserveManualOverrides
    ),
    scheduleStabilityPriority: Number(
      document.scheduleStabilityPriority ?? defaults.scheduleStabilityPriority
    ),
    weekdayTemplatePriority: Number(
      document.weekdayTemplatePriority ?? defaults.weekdayTemplatePriority
    ),
    weeklyHoursPriority: Number(
      document.weeklyHoursPriority ?? defaults.weeklyHoursPriority
    ),
    btCoveragePriority: Number(
      document.btCoveragePriority ?? defaults.btCoveragePriority
    ),
    internCoveragePriority: Number(
      document.internCoveragePriority ?? defaults.internCoveragePriority
    ),
    managerCoveragePriority: Number(
      document.managerCoveragePriority ?? defaults.managerCoveragePriority
    ),
    bcbaCoveragePriority: Number(
      document.bcbaCoveragePriority ?? defaults.bcbaCoveragePriority
    ),
    otherCoveragePriority: Number(
      document.otherCoveragePriority ?? defaults.otherCoveragePriority
    ),
    autoUseWeekdayTemplate: Boolean(
      document.autoUseWeekdayTemplate ?? defaults.autoUseWeekdayTemplate
    ),
    autoUsePreviousWeekdaySchedule: Boolean(
      document.autoUsePreviousWeekdaySchedule ??
        defaults.autoUsePreviousWeekdaySchedule
    ),
    breakWindowStart: String(
      document.breakWindowStart ?? defaults.breakWindowStart
    ),
    breakWindowEnd: String(
      document.breakWindowEnd ?? defaults.breakWindowEnd
    ),
    breakSchedulingEnabled: Boolean(
      document.breakSchedulingEnabled ??
        defaults.breakSchedulingEnabled
    ),
    defaultBreakMinutes: Number(
      document.defaultBreakMinutes ?? defaults.defaultBreakMinutes
    ),
    breakEligibilityHours: Number(
      document.breakEligibilityHours ?? defaults.breakEligibilityHours
    ),
    scheduleStartTime: String(
      document.scheduleStartTime ?? defaults.scheduleStartTime
    ),
    scheduleEndTime: String(
      document.scheduleEndTime ?? defaults.scheduleEndTime
    ),
    fullTimeMinimumWeeklyHours: Number(
      document.fullTimeMinimumWeeklyHours ??
        defaults.fullTimeMinimumWeeklyHours
    ),
    fullTimeMaximumWeeklyHours: Number(
      document.fullTimeMaximumWeeklyHours ??
        defaults.fullTimeMaximumWeeklyHours
    ),
    partTimeMinimumWeeklyHours: Number(
      document.partTimeMinimumWeeklyHours ??
        defaults.partTimeMinimumWeeklyHours
    ),
    partTimeMaximumWeeklyHours: Number(
      document.partTimeMaximumWeeklyHours ??
        defaults.partTimeMaximumWeeklyHours
    ),
    napDurationRulesEnabled: Boolean(
      document.napDurationRulesEnabled ??
        defaults.napDurationRulesEnabled
    ),
    napMinimumMinutes: Number(
      document.napMinimumMinutes ?? defaults.napMinimumMinutes
    ),
    napPreferredMinutes: Number(
      document.napPreferredMinutes ?? defaults.napPreferredMinutes
    ),
    napMaximumMinutes: Number(
      document.napMaximumMinutes ?? defaults.napMaximumMinutes
    ),
    speechDurationRulesEnabled: Boolean(
      document.speechDurationRulesEnabled ??
        defaults.speechDurationRulesEnabled
    ),
    speechMinimumMinutes: Number(
      document.speechMinimumMinutes ?? defaults.speechMinimumMinutes
    ),
    speechPreferredMinutes: Number(
      document.speechPreferredMinutes ?? defaults.speechPreferredMinutes
    ),
    speechMaximumMinutes: Number(
      document.speechMaximumMinutes ?? defaults.speechMaximumMinutes
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

function normalizeStaffRole(value: unknown): StaffRole {
  if (
    value === "BT" ||
    value === "RBT" ||
    value === "INTERN" ||
    value === "OFFICE_MANAGER" ||
    value === "BCBA" ||
    value === "OTHER"
  ) {
    return value;
  }

  return "OTHER";
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

function buildWeeklyClientHoursByStaff(
  assignmentDocuments: DatabaseRecord[],
  slotLengthMinutes: number
): Map<string, number> {
  const hoursByStaff = new Map<string, number>();
  const slotHours = slotLengthMinutes / 60;

  for (const assignment of assignmentDocuments) {
    if (String(assignment.assignmentType) !== "CLIENT_1_TO_1") {
      continue;
    }

    const staffId = String(assignment.staffId ?? "");

    if (!staffId) {
      continue;
    }

    hoursByStaff.set(
      staffId,
      (hoursByStaff.get(staffId) ?? 0) + slotHours
    );
  }

  return hoursByStaff;
}

function mapStaff(
  staffDocuments: DatabaseRecord[],
  callOuts: DaySchedulerData["partialCallOuts"],
  date: string,
  weeklyClientHoursByStaff: Map<string, number>,
  rules: ExtendedSchedulerRules
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
      const unavailableRanges: TimeRange[] = callOuts
        .filter((callOut) => callOut.staffId === staffId)
        .map((callOut) => ({
          startTime: callOut.startTime,
          endTime: callOut.endTime,
        }));

      const normalAvailableSlots = getPatternSlots(
        staffMember.shiftPatterns,
        date
      );
      const availableSlots = removeBlockedSlots(
        normalAvailableSlots,
        unavailableRanges
      );
      const employeeType = String(
        staffMember.employeeType ?? "FULL_TIME"
      );
      const fallbackMinimumWeeklyHours =
        employeeType === "PART_TIME"
          ? rules.partTimeMinimumWeeklyHours
          : rules.fullTimeMinimumWeeklyHours;
      const fallbackMaximumWeeklyHours =
        employeeType === "PART_TIME"
          ? rules.partTimeMaximumWeeklyHours
          : rules.fullTimeMaximumWeeklyHours;
      const configuredMinimumWeeklyHours = Number(
        staffMember.minimumWeeklyHours ?? fallbackMinimumWeeklyHours
      );
      const configuredMaximumWeeklyHours = Number(
        staffMember.maximumWeeklyHours ?? fallbackMaximumWeeklyHours
      );
      const configuredTargetWeeklyHours = Number(
        staffMember.targetWeeklyHours ?? 0
      );

      return {
        id: staffId,
        name: String(staffMember.fullName ?? ""),
        role: normalizeStaffRole(staffMember.role),
        teamId: staffMember.teamId
          ? String(staffMember.teamId)
          : undefined,
        serviceSetting: normalizeServiceSetting(
          staffMember.serviceSetting
        ),
        availableSlots,
        maximumDailyHours:
          (availableSlots.length * rules.slotLengthMinutes) / 60,
        minimumWeeklyHours: Math.max(
          configuredMinimumWeeklyHours,
          0
        ),
        targetWeeklyHours:
          configuredTargetWeeklyHours > 0
            ? configuredTargetWeeklyHours
            : undefined,
        maximumWeeklyHours:
          configuredMaximumWeeklyHours > 0
            ? configuredMaximumWeeklyHours
            : undefined,
        scheduledWeeklyClientHoursBeforeDate:
          weeklyClientHoursByStaff.get(staffId) ?? 0,
      };
    });
}

function mapClients(
  clientDocuments: DatabaseRecord[],
  speechSessions: DatabaseRecord[],
  date: string
): SchedulerClient[] {
  const activeClients = clientDocuments.filter((client) => {
    return isDateInsideActiveRange(
      date,
      client.startDate,
      client.endDate
    );
  });
  const activeClientIds = new Set(
    activeClients.map((client) => String(client._id))
  );

  const speechSlotsByClient = new Map<string, Set<string>>();

  for (const session of speechSessions) {
    const clientId = String(session.clientId ?? "");
    const startTime = String(session.startTime ?? "");

    if (
      !activeClientIds.has(clientId) ||
      !startTime
    ) {
      continue;
    }

    const slots = speechSlotsByClient.get(clientId) ?? new Set<string>();

    // Speech is always a fixed 30-minute appointment. Legacy records that
    // once contained a larger range are intentionally normalized to their
    // first schedule block so Speech cannot consume an entire flexible window.
    slots.add(startTime);
    speechSlotsByClient.set(clientId, slots);
  }

  return activeClients.map((client) => {
    const clientId = String(client._id);
    const attendanceSlots = getPatternSlots(
      client.attendancePatterns,
      date
    );
    const napSlots: string[] = [];
    const speechSlots = [
      ...(speechSlotsByClient.get(clientId) ?? new Set<string>()),
    ].sort();
    const blockedSlots = new Set([...napSlots, ...speechSlots]);
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
      teamId: client.teamId
        ? String(client.teamId)
        : undefined,
      serviceSetting: normalizeServiceSetting(
        client.serviceSetting
      ),
      supportLevel,
      requiredSlots: attendanceSlots.filter(
        (slot) => !blockedSlots.has(slot)
      ),
      napSlots,
      speechSlots,
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
      note: assignment.note
        ? String(assignment.note)
        : undefined,
    };
  });
}

function mapReferenceAssignments(
  records: DatabaseRecord[],
  source: "TEMPLATE" | "COPIED",
  staff: SchedulerStaff[],
  clients: SchedulerClient[],
  label: string
): SchedulerAssignment[] {
  const staffById = new Map(
    staff.map((staffMember) => [staffMember.id, staffMember])
  );
  const clientById = new Map(
    clients.map((client) => [client.id, client])
  );
  const references: SchedulerAssignment[] = [];

  records.forEach((assignment, index) => {
    const assignmentType = String(
      assignment.assignmentType ?? ""
    ) as SchedulerAssignment["assignmentType"];
    const staffId = String(assignment.staffId ?? "");
    const clientId = assignment.clientId
      ? String(assignment.clientId)
      : undefined;
    const startTime = String(assignment.startTime ?? "");
    const staffMember = staffById.get(staffId);

    if (!staffMember || !startTime) {
      return;
    }

    if (!staffMember.availableSlots.includes(startTime)) {
      return;
    }

    if (assignmentType === "CLIENT_1_TO_1") {
      const client = clientId
        ? clientById.get(clientId)
        : undefined;

      if (!client || !client.requiredSlots.includes(startTime)) {
        return;
      }
    } else if (
      assignmentType !== "BREAK" &&
      assignmentType !== "BREAK_NAP" &&
      assignmentType !== "BREAK_SPEECH"
    ) {
      return;
    }

    references.push({
      id: `${source.toLowerCase()}-${index}-${staffId}-${startTime}`,
      staffId,
      clientId,
      startTime,
      assignmentType,
      source,
      locked: false,
      note: label,
    });
  });

  return references;
}

export async function buildDaySchedulerInput(
  locationId: string,
  date: string
): Promise<DaySchedulerData> {
  await connectToDatabase();

  const dayOfWeek = getDayKeys(date)[0] ?? "";
  const weekStart = getWeekStart(date);
  const previousSameWeekdayDates = getPreviousSameWeekdayDates(
    date,
    8
  );

  const [
    rawStaff,
    rawClients,
    rawCallOuts,
    rawSpeechSessions,
    rawAssignments,
    rawRules,
    rawTemplate,
    rawPreviousWeekdayAssignments,
    rawEarlierWeekAssignments,
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
    dayOfWeek
      ? ScheduleTemplate.findOne({
          locationId,
          dayOfWeek,
          active: true,
        })
          .sort({ updatedAt: -1 })
          .lean()
      : Promise.resolve(null),
    ScheduleAssignment.find({
      locationId,
      date: {
        $in: previousSameWeekdayDates,
      },
    })
      .sort({ date: -1, startTime: 1 })
      .lean(),
    ScheduleAssignment.find({
      locationId,
      date: {
        $gte: weekStart,
        $lt: date,
      },
      assignmentType: "CLIENT_1_TO_1",
    }).lean(),
  ]);

  const staffDocuments = rawStaff as unknown as DatabaseRecord[];
  const clientDocuments = rawClients as unknown as DatabaseRecord[];
  const speechSessions = rawSpeechSessions as unknown as DatabaseRecord[];
  const assignmentDocuments = rawAssignments as unknown as DatabaseRecord[];
  const rulesDocument = rawRules as unknown as DatabaseRecord | null;
  const templateDocument = rawTemplate as unknown as DatabaseRecord | null;
  const previousWeekdayAssignments =
    rawPreviousWeekdayAssignments as unknown as DatabaseRecord[];
  const earlierWeekAssignments =
    rawEarlierWeekAssignments as unknown as DatabaseRecord[];
  const extendedRules = mapRules(rulesDocument);

  const partialCallOuts = (
    rawCallOuts as unknown as DatabaseRecord[]
  ).map((callOut) => ({
    staffId: String(callOut.staffId),
    startTime: String(callOut.startTime),
    endTime: String(callOut.endTime),
  }));

  const weeklyClientHoursByStaff = buildWeeklyClientHoursByStaff(
    earlierWeekAssignments,
    extendedRules.slotLengthMinutes
  );
  const staff = mapStaff(
    staffDocuments,
    partialCallOuts,
    date,
    weeklyClientHoursByStaff,
    extendedRules
  );
  const clients = mapClients(
    clientDocuments,
    speechSessions,
    date
  );
  const existingAssignments = mapExistingAssignments(
    assignmentDocuments
  );

  const templateReferences =
    extendedRules.autoUseWeekdayTemplate && templateDocument
      ? mapReferenceAssignments(
          templateDocument.assignments ?? [],
          "TEMPLATE",
          staff,
          clients,
          `Reference from weekday template ${String(
            templateDocument.name ?? ""
          )}.`
        )
      : [];

  const historicalReferenceDates = [
    ...new Set(
      previousWeekdayAssignments
        .map((assignment) => String(assignment.date ?? ""))
        .filter(Boolean)
    ),
  ];
  const latestPreviousReferenceDate =
    extendedRules.autoUsePreviousWeekdaySchedule &&
    historicalReferenceDates.length > 0
      ? historicalReferenceDates[0]
      : null;
  const previousScheduleReferences =
    extendedRules.autoUsePreviousWeekdaySchedule
      ? mapReferenceAssignments(
          previousWeekdayAssignments,
          "COPIED",
          staff,
          clients,
          `Historical reference from the previous ${Math.min(
            historicalReferenceDates.length,
            8
          )} ${dayOfWeek.toLowerCase()} schedule(s).`
        )
      : [];

  const fullDayCallOutStaffIds = partialCallOuts
    .filter((callOut) => {
      return (
        callOut.startTime <= extendedRules.scheduleStartTime &&
        callOut.endTime >= extendedRules.scheduleEndTime
      );
    })
    .map((callOut) => callOut.staffId);

  const input: SchedulerInput = {
    staff,
    clients,
    existingAssignments,
    referenceAssignments: [
      ...existingAssignments.filter(
        (assignment) =>
          assignment.assignmentType === "CLIENT_1_TO_1" ||
          assignment.assignmentType === "BREAK" ||
          assignment.assignmentType === "BREAK_NAP" ||
          assignment.assignmentType === "BREAK_SPEECH"
      ),
      ...templateReferences,
      ...previousScheduleReferences,
    ],
    callOutStaffIds: fullDayCallOutStaffIds,
    rules: {
      maximumClientsPerTechPerDay:
        extendedRules.maximumClientsPerTechPerDay,
      maximumTechsPerClientPerDay:
        extendedRules.maximumTechsPerClientPerDay,
      minimumClientStaffAssignmentMinutes:
        extendedRules.minimumClientStaffAssignmentMinutes,
      maximumClientStaffConsecutiveHours:
        extendedRules.maximumClientStaffConsecutiveHours,
      preventSameStaffClientRepeatSameDay:
        extendedRules.preventSameStaffClientRepeatSameDay,
      allowSameStaffClientRepeatForCoverageException:
        extendedRules.allowSameStaffClientRepeatForCoverageException,
      preferSameTeam:
        extendedRules.preferSameTeam,
      preferStaffContinuity:
        extendedRules.preferStaffContinuity,
      slotLengthMinutes:
        extendedRules.slotLengthMinutes,
      preferredStaffPriority:
        extendedRules.preferredStaffPriority,
      sameTeamPriority:
        extendedRules.sameTeamPriority,
      continuityPriority:
        extendedRules.continuityPriority,
      rotationPriority:
        extendedRules.rotationPriority,
      workloadBalancePriority:
        extendedRules.workloadBalancePriority,
      clientHandoffPenaltyPriority:
        extendedRules.clientHandoffPenaltyPriority,
      staffScheduleCompactnessPriority:
        extendedRules.staffScheduleCompactnessPriority,
      minimalFixAllowProtectedRelocation:
        extendedRules.minimalFixAllowProtectedRelocation,
      minimalFixAllowBreakRelocation:
        extendedRules.minimalFixAllowBreakRelocation,
      preserveManualOverrides:
        extendedRules.preserveManualOverrides,
      scheduleStabilityPriority:
        extendedRules.scheduleStabilityPriority,
      weekdayTemplatePriority:
        extendedRules.weekdayTemplatePriority,
      weeklyHoursPriority:
        extendedRules.weeklyHoursPriority,
      btCoveragePriority:
        extendedRules.btCoveragePriority,
      internCoveragePriority:
        extendedRules.internCoveragePriority,
      managerCoveragePriority:
        extendedRules.managerCoveragePriority,
      bcbaCoveragePriority:
        extendedRules.bcbaCoveragePriority,
      otherCoveragePriority:
        extendedRules.otherCoveragePriority,
      autoUseWeekdayTemplate:
        extendedRules.autoUseWeekdayTemplate,
      autoUsePreviousWeekdaySchedule:
        extendedRules.autoUsePreviousWeekdaySchedule,
    },
  };

  return {
    input,
    extendedRules,
    staff,
    clients,
    partialCallOuts,
    autoTemplateName:
      extendedRules.autoUseWeekdayTemplate && templateDocument
        ? String(templateDocument.name ?? "") || null
        : null,
    previousReferenceDate: latestPreviousReferenceDate,
    historicalReferenceDates:
      extendedRules.autoUsePreviousWeekdaySchedule
        ? historicalReferenceDates
        : [],
  };
}
