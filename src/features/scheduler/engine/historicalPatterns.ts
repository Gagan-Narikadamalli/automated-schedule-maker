import type { HistoricalPatternScores } from "./types";

export type HistoricalPatternRecord = {
  scheduleDate: string;
  staffId?: string | null;
  clientId?: string | null;
  startTime: string;
  assignmentType:
    | "CLIENT_1_TO_1"
    | "BREAK"
    | "BREAK_NAP"
    | "BREAK_SPEECH"
    | "NAP"
    | "SPEECH";
};

function pairKey(staffId: string, clientId: string): string {
  return `${staffId}|${clientId}`;
}

function exactSlotKey(
  staffId: string,
  clientId: string,
  startTime: string
): string {
  return `${staffId}|${clientId}|${startTime}`;
}

function breakSlotKey(staffId: string, startTime: string): string {
  return `${staffId}|${startTime}`;
}

function increment(
  target: Record<string, number>,
  key: string,
  amount = 1
) {
  target[key] = (target[key] ?? 0) + amount;
}

function normalizeCounts(
  counts: Record<string, number>,
  scheduleDayCount: number
): Record<string, number> {
  if (scheduleDayCount <= 0) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(counts).map(([key, count]) => [
      key,
      Math.min(count / scheduleDayCount, 1),
    ])
  );
}

function mergeScoreMaps(
  left: Record<string, number>,
  right: Record<string, number>
): Record<string, number> {
  const result: Record<string, number> = {
    ...left,
  };

  for (const [key, value] of Object.entries(right)) {
    result[key] = Math.max(result[key] ?? 0, value);
  }

  return result;
}

export function buildHistoricalPatternScores(
  records: HistoricalPatternRecord[]
): HistoricalPatternScores {
  const scheduleDates = new Set<string>();
  const pairingCounts: Record<string, number> = {};
  const exactSlotCounts: Record<string, number> = {};
  const breakSlotCounts: Record<string, number> = {};

  for (const record of records) {
    if (record.scheduleDate) {
      scheduleDates.add(record.scheduleDate);
    }

    const staffId = record.staffId?.trim() ?? "";
    const clientId = record.clientId?.trim() ?? "";

    if (
      record.assignmentType === "CLIENT_1_TO_1" &&
      staffId &&
      clientId
    ) {
      increment(pairingCounts, pairKey(staffId, clientId));
      increment(
        exactSlotCounts,
        exactSlotKey(staffId, clientId, record.startTime)
      );
      continue;
    }

    if (
      staffId &&
      (record.assignmentType === "BREAK" ||
        record.assignmentType === "BREAK_NAP" ||
        record.assignmentType === "BREAK_SPEECH")
    ) {
      increment(
        breakSlotCounts,
        breakSlotKey(staffId, record.startTime)
      );
    }
  }

  const scheduleDayCount = scheduleDates.size;

  return {
    sampleCount: records.length,
    scheduleDayCount,
    pairingScores: normalizeCounts(pairingCounts, scheduleDayCount),
    exactSlotScores: normalizeCounts(exactSlotCounts, scheduleDayCount),
    breakSlotScores: normalizeCounts(breakSlotCounts, scheduleDayCount),
  };
}

/**
 * Combines independent pattern sources without double-counting the same signal.
 * For a staff/client/time key, the strongest observed normalized frequency wins.
 * This lets workbook trial observations and newer MongoDB history complement each
 * other while keeping every pattern score inside the expected 0..1 range.
 */
export function mergeHistoricalPatternScores(
  left: HistoricalPatternScores | undefined,
  right: HistoricalPatternScores | undefined
): HistoricalPatternScores | undefined {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return {
    sampleCount: left.sampleCount + right.sampleCount,
    scheduleDayCount: left.scheduleDayCount + right.scheduleDayCount,
    pairingScores: mergeScoreMaps(
      left.pairingScores,
      right.pairingScores
    ),
    exactSlotScores: mergeScoreMaps(
      left.exactSlotScores,
      right.exactSlotScores
    ),
    breakSlotScores: mergeScoreMaps(
      left.breakSlotScores,
      right.breakSlotScores
    ),
  };
}

export function getHistoricalPairingScore(
  historicalPatterns: HistoricalPatternScores | undefined,
  staffId: string,
  clientId: string
): number {
  return historicalPatterns?.pairingScores[pairKey(staffId, clientId)] ?? 0;
}

export function getHistoricalExactSlotScore(
  historicalPatterns: HistoricalPatternScores | undefined,
  staffId: string,
  clientId: string,
  startTime: string
): number {
  return (
    historicalPatterns?.exactSlotScores[
      exactSlotKey(staffId, clientId, startTime)
    ] ?? 0
  );
}

export function getHistoricalBreakSlotScore(
  historicalPatterns: HistoricalPatternScores | undefined,
  staffId: string,
  startTime: string
): number {
  return (
    historicalPatterns?.breakSlotScores[breakSlotKey(staffId, startTime)] ?? 0
  );
}
