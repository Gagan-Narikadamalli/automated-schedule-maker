import { mergeHistoricalPatternScores } from "@/features/scheduler/engine/historicalPatterns";
import type {
  HistoricalPatternScores,
  SchedulerAssignment,
  SchedulerInput,
} from "@/features/scheduler/engine/types";
import {
  buildLivingstonWorkbookTrialReferences,
  getLivingstonWorkbookTrialSummary,
  isLivingstonLocation,
} from "@/features/scheduler/training/livingstonWorkbookTrial";
import { connectToDatabase } from "@/lib/db";
import { Location } from "@/models/Location";
import { SchedulingRules } from "@/models/SchedulingRules";

type LocationRecord = {
  name?: string;
  code?: string;
};

type HistoricalRuleRecord = {
  autoUseHistoricalPatterns?: boolean;
};

export type LivingstonWorkbookTrainingResult = {
  input: SchedulerInput;
  applied: boolean;
  referenceCount: number;
  sourceWeekStart: string | null;
  sourceWeekEnd: string | null;
};

function referenceIsUsable(
  reference: SchedulerAssignment,
  input: SchedulerInput
): boolean {
  const staffMember = input.staff.find(
    (candidate) => candidate.id === reference.staffId
  );

  if (!staffMember) {
    return false;
  }

  if (
    reference.startTime !== "00:00" &&
    !staffMember.availableSlots.includes(reference.startTime)
  ) {
    return false;
  }

  if (reference.assignmentType !== "CLIENT_1_TO_1") {
    return true;
  }

  if (!reference.clientId) {
    return false;
  }

  const client = input.clients.find(
    (candidate) => candidate.id === reference.clientId
  );

  if (!client) {
    return false;
  }

  if (reference.startTime === "00:00") {
    return true;
  }

  return client.requiredSlots.includes(reference.startTime);
}

function increment(
  target: Record<string, number>,
  key: string
) {
  target[key] = (target[key] ?? 0) + 1;
}

function normalizeByLargestCount(
  counts: Record<string, number>
): Record<string, number> {
  const largestCount = Math.max(
    0,
    ...Object.values(counts)
  );

  if (largestCount <= 0) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(counts).map(([key, value]) => [
      key,
      Math.min(value / largestCount, 1),
    ])
  );
}

function buildWorkbookPatternScores(
  references: SchedulerAssignment[]
): HistoricalPatternScores {
  const pairingCounts: Record<string, number> = {};
  const exactSlotCounts: Record<string, number> = {};
  const breakSlotCounts: Record<string, number> = {};

  for (const reference of references) {
    if (
      reference.assignmentType === "CLIENT_1_TO_1" &&
      reference.clientId
    ) {
      if (reference.startTime === "00:00") {
        increment(
          pairingCounts,
          `${reference.staffId}|${reference.clientId}`
        );
      } else {
        increment(
          exactSlotCounts,
          `${reference.staffId}|${reference.clientId}|${reference.startTime}`
        );
      }

      continue;
    }

    if (
      reference.assignmentType === "BREAK" ||
      reference.assignmentType === "BREAK_NAP" ||
      reference.assignmentType === "BREAK_SPEECH"
    ) {
      increment(
        breakSlotCounts,
        `${reference.staffId}|${reference.startTime}`
      );
    }
  }

  return {
    sampleCount: references.length,
    scheduleDayCount: 5,
    pairingScores: normalizeByLargestCount(pairingCounts),
    exactSlotScores: normalizeByLargestCount(exactSlotCounts),
    breakSlotScores: normalizeByLargestCount(breakSlotCounts),
  };
}

export async function applyLivingstonWorkbookTrial(
  locationId: string,
  input: SchedulerInput
): Promise<LivingstonWorkbookTrainingResult> {
  if (input.rules.autoUseHistoricalPatterns === false) {
    return {
      input,
      applied: false,
      referenceCount: 0,
      sourceWeekStart: null,
      sourceWeekEnd: null,
    };
  }

  await connectToDatabase();

  const [locationResult, ruleResult] = await Promise.all([
    Location.findById(locationId)
      .select("name code")
      .lean(),
    SchedulingRules.findOne({ locationId })
      .select("autoUseHistoricalPatterns")
      .lean(),
  ]);

  const historicalRule = ruleResult && !Array.isArray(ruleResult)
    ? (ruleResult as unknown as HistoricalRuleRecord)
    : null;

  if (historicalRule?.autoUseHistoricalPatterns === false) {
    return {
      input: {
        ...input,
        rules: {
          ...input.rules,
          autoUseHistoricalPatterns: false,
        },
      },
      applied: false,
      referenceCount: 0,
      sourceWeekStart: null,
      sourceWeekEnd: null,
    };
  }

  if (!locationResult || Array.isArray(locationResult)) {
    return {
      input,
      applied: false,
      referenceCount: 0,
      sourceWeekStart: null,
      sourceWeekEnd: null,
    };
  }

  const location = locationResult as unknown as LocationRecord;

  if (
    !isLivingstonLocation(
      String(location.name ?? ""),
      String(location.code ?? "")
    )
  ) {
    return {
      input,
      applied: false,
      referenceCount: 0,
      sourceWeekStart: null,
      sourceWeekEnd: null,
    };
  }

  const trialReferences = buildLivingstonWorkbookTrialReferences(
    input.staff,
    input.clients
  ).filter((reference) => referenceIsUsable(reference, input));

  if (trialReferences.length === 0) {
    return {
      input,
      applied: false,
      referenceCount: 0,
      sourceWeekStart: null,
      sourceWeekEnd: null,
    };
  }

  const workbookPatterns = buildWorkbookPatternScores(
    trialReferences
  );
  const breakReferences = trialReferences.filter(
    (reference) =>
      reference.assignmentType === "BREAK" ||
      reference.assignmentType === "BREAK_NAP" ||
      reference.assignmentType === "BREAK_SPEECH"
  );
  const summary = getLivingstonWorkbookTrialSummary();

  return {
    input: {
      ...input,
      // Break references are retained because break planning ranks only safe
      // break slots. Client pairing/slot observations are represented through
      // HistoricalPatternScores so the Clinic Settings history priorities apply.
      referenceAssignments: [
        ...input.referenceAssignments,
        ...breakReferences,
      ],
      historicalPatterns: mergeHistoricalPatternScores(
        input.historicalPatterns,
        workbookPatterns
      ),
      rules: {
        ...input.rules,
        autoUseHistoricalPatterns: true,
      },
    },
    applied: true,
    referenceCount: trialReferences.length,
    sourceWeekStart: summary.sourceWeekStart,
    sourceWeekEnd: summary.sourceWeekEnd,
  };
}
