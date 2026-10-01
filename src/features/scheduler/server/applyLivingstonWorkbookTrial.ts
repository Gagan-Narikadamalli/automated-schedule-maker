import type {
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

type LocationRecord = {
  name?: string;
  code?: string;
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

  const locationResult = await Location.findById(locationId)
    .select("name code")
    .lean();

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

  const summary = getLivingstonWorkbookTrialSummary();

  return {
    input: {
      ...input,
      referenceAssignments: [
        ...input.referenceAssignments,
        ...trialReferences,
      ],
    },
    applied: true,
    referenceCount: trialReferences.length,
    sourceWeekStart: summary.sourceWeekStart,
    sourceWeekEnd: summary.sourceWeekEnd,
  };
}
