import { getDayKeys } from "@/features/scheduler/engine/dateUtils";
import {
  buildHistoricalPatternScores,
  mergeHistoricalPatternScores,
} from "@/features/scheduler/engine/historicalPatterns";
import type {
  SchedulerAssignment,
  SchedulerInput,
} from "@/features/scheduler/engine/types";
import { connectToDatabase } from "@/lib/db";
import { HistoricalScheduleAssignment } from "@/models/HistoricalScheduleAssignment";
import { SchedulingRules } from "@/models/SchedulingRules";

type DatabaseRecord = Record<string, any>;

export type HistoricalTrainingResult = {
  input: SchedulerInput;
  matchedScheduleDayCount: number;
  matchedRecordCount: number;
};

const DEFAULT_HISTORY_DAY_LIMIT = 8;

function takeRecentScheduleDates(
  records: DatabaseRecord[],
  maximumDays: number
): string[] {
  const orderedDates: string[] = [];
  const seenDates = new Set<string>();

  for (const record of records) {
    const scheduleDate = String(record.scheduleDate ?? "");

    if (!scheduleDate || seenDates.has(scheduleDate)) {
      continue;
    }

    seenDates.add(scheduleDate);
    orderedDates.push(scheduleDate);

    if (orderedDates.length >= maximumDays) {
      break;
    }
  }

  return orderedDates;
}

function buildLatestClientReferences(
  records: DatabaseRecord[],
  latestScheduleDate: string | null,
  validStaffIds: Set<string>,
  validClientIds: Set<string>
): SchedulerAssignment[] {
  if (!latestScheduleDate) return [];

  const references: SchedulerAssignment[] = [];

  records.forEach((record, index) => {
    const assignmentType = String(record.assignmentType ?? "");
    const scheduleDate = String(record.scheduleDate ?? "");
    const staffId = record.staffId ? String(record.staffId) : "";
    const clientId = record.clientId ? String(record.clientId) : "";
    const startTime = String(record.startTime ?? "");

    if (
      scheduleDate !== latestScheduleDate ||
      assignmentType !== "CLIENT_1_TO_1" ||
      !validStaffIds.has(staffId) ||
      !validClientIds.has(clientId) ||
      !startTime
    ) {
      return;
    }

    references.push({
      id: `imported-client-${latestScheduleDate}-${index}-${staffId}-${clientId}-${startTime}`,
      staffId,
      clientId,
      startTime,
      assignmentType: "CLIENT_1_TO_1",
      source: "COPIED",
      locked: false,
      note:
        "Exact pairing from the most recent imported same-weekday schedule.",
    });
  });

  return references;
}

function buildBreakReferences(
  records: DatabaseRecord[],
  validStaffIds: Set<string>
): SchedulerAssignment[] {
  const breakReferences: SchedulerAssignment[] = [];

  records.forEach((record, index) => {
    const assignmentType = String(record.assignmentType ?? "");
    const staffId = record.staffId ? String(record.staffId) : "";
    const startTime = String(record.startTime ?? "");

    if (!validStaffIds.has(staffId) || !startTime) {
      return;
    }

    if (
      assignmentType !== "BREAK" &&
      assignmentType !== "BREAK_NAP" &&
      assignmentType !== "BREAK_SPEECH"
    ) {
      return;
    }

    breakReferences.push({
      id: `imported-break-${index}-${staffId}-${startTime}`,
      staffId,
      startTime,
      assignmentType,
      source: "COPIED",
      locked: false,
      note: "Imported historical break pattern.",
    });
  });

  return breakReferences;
}

function historicalRuleValues(rulesDocument: DatabaseRecord | null) {
  return {
    autoUseHistoricalPatterns: Boolean(
      rulesDocument?.autoUseHistoricalPatterns ?? true
    ),
    historicalPairingPriority: Number(
      rulesDocument?.historicalPairingPriority ?? 70
    ),
    historicalSlotPriority: Number(
      rulesDocument?.historicalSlotPriority ?? 90
    ),
    historicalBreakPriority: Number(
      rulesDocument?.historicalBreakPriority ?? 80
    ),
  };
}

export async function applyHistoricalTraining(
  locationId: string,
  date: string,
  input: SchedulerInput
): Promise<HistoricalTrainingResult> {
  await connectToDatabase();

  const dayOfWeek = getDayKeys(date)[0] ?? "";

  if (!dayOfWeek) {
    return {
      input,
      matchedScheduleDayCount: 0,
      matchedRecordCount: 0,
    };
  }

  const [rawRecords, rawRules] = await Promise.all([
    HistoricalScheduleAssignment.find({
      locationId,
      dayOfWeek,
      scheduleDate: {
        $lt: date,
      },
    })
      .sort({ scheduleDate: -1, startTime: 1 })
      .limit(5000)
      .lean(),
    SchedulingRules.findOne({ locationId })
      .select(
        "autoUseHistoricalPatterns historicalPairingPriority historicalSlotPriority historicalBreakPriority"
      )
      .lean(),
  ]);

  const records = rawRecords as unknown as DatabaseRecord[];
  const rulesDocument = rawRules as unknown as DatabaseRecord | null;
  const ruleValues = historicalRuleValues(rulesDocument);

  const inputWithHistoricalRules: SchedulerInput = {
    ...input,
    rules: {
      ...input.rules,
      ...ruleValues,
    },
  };

  if (!ruleValues.autoUseHistoricalPatterns || records.length === 0) {
    return {
      input: inputWithHistoricalRules,
      matchedScheduleDayCount: 0,
      matchedRecordCount: 0,
    };
  }

  const recentScheduleDates = takeRecentScheduleDates(
    records,
    DEFAULT_HISTORY_DAY_LIMIT
  );
  const recentDateSet = new Set(recentScheduleDates);
  const currentStaffIds = new Set(
    input.staff.map((staffMember) => staffMember.id)
  );
  const currentClientIds = new Set(
    input.clients.map((client) => client.id)
  );

  const matchedRecords = records.filter((record) => {
    const scheduleDate = String(record.scheduleDate ?? "");
    const staffId = record.staffId ? String(record.staffId) : "";
    const clientId = record.clientId ? String(record.clientId) : "";
    const assignmentType = String(record.assignmentType ?? "");

    if (!recentDateSet.has(scheduleDate) || !currentStaffIds.has(staffId)) {
      return false;
    }

    if (assignmentType === "CLIENT_1_TO_1") {
      return Boolean(clientId) && currentClientIds.has(clientId);
    }

    return (
      assignmentType === "BREAK" ||
      assignmentType === "BREAK_NAP" ||
      assignmentType === "BREAK_SPEECH"
    );
  });

  const importedHistoricalPatterns = buildHistoricalPatternScores(
    matchedRecords.map((record) => ({
      scheduleDate: String(record.scheduleDate ?? ""),
      staffId: record.staffId ? String(record.staffId) : null,
      clientId: record.clientId ? String(record.clientId) : null,
      startTime: String(record.startTime ?? ""),
      assignmentType: String(
        record.assignmentType ?? "CLIENT_1_TO_1"
      ) as
        | "CLIENT_1_TO_1"
        | "BREAK"
        | "BREAK_NAP"
        | "BREAK_SPEECH"
        | "NAP"
        | "SPEECH",
    }))
  );

  const latestImportedScheduleDate =
    recentScheduleDates[0] ?? null;
  const clientReferences = buildLatestClientReferences(
    matchedRecords,
    latestImportedScheduleDate,
    currentStaffIds,
    currentClientIds
  );
  const breakReferences = buildBreakReferences(
    matchedRecords.filter(
      (record) =>
        String(record.scheduleDate ?? "") ===
        latestImportedScheduleDate
    ),
    currentStaffIds
  );

  return {
    input: {
      ...inputWithHistoricalRules,
      referenceAssignments: [
        ...input.referenceAssignments,
        ...clientReferences,
        ...breakReferences,
      ],
      historicalPatterns: mergeHistoricalPatternScores(
        input.historicalPatterns,
        importedHistoricalPatterns
      ),
    },
    matchedScheduleDayCount: importedHistoricalPatterns.scheduleDayCount,
    matchedRecordCount: importedHistoricalPatterns.sampleCount,
  };
}
