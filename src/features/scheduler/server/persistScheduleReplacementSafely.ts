import { ScheduleAssignment } from "@/models/ScheduleAssignment";

type ReplacementAssignment = {
  locationId: string;
  date: string;
  startTime: string;
  staffId: string;
  [key: string]: unknown;
};

type ReplaceableFilter = Record<string, unknown>;

function assignmentKey(staffId: unknown, startTime: unknown): string {
  return `${String(staffId)}::${String(startTime)}`;
}

export async function persistScheduleReplacementSafely(args: {
  locationId: string;
  date: string;
  replacements: ReplacementAssignment[];
  replaceableFilter: ReplaceableFilter;
  blockEmptyReplacement?: boolean;
}) {
  const baseFilter = {
    locationId: args.locationId,
    date: args.date,
    ...args.replaceableFilter,
  };

  const previous = (await ScheduleAssignment.find(baseFilter)
    .select("_id staffId startTime")
    .lean()) as unknown as Array<{
    _id: unknown;
    staffId: unknown;
    startTime: unknown;
  }>;

  if (
    args.blockEmptyReplacement !== false &&
    previous.length > 0 &&
    args.replacements.length === 0
  ) {
    return {
      applied: false,
      blockedEmptyReplacement: true,
      preservedCount: previous.length,
      upsertedCount: 0,
      removedStaleCount: 0,
    };
  }

  if (args.replacements.length > 0) {
    const operations = args.replacements.map((assignment) => ({
      updateOne: {
        filter: {
          locationId: args.locationId,
          date: args.date,
          staffId: assignment.staffId,
          startTime: assignment.startTime,
          ...args.replaceableFilter,
        },
        update: {
          $set: assignment,
        },
        upsert: true,
      },
    }));

    // New/replacement blocks are written before stale blocks are removed.
    // If this fails, the old saved schedule remains present.
    await ScheduleAssignment.bulkWrite(operations, { ordered: true });
  }

  const replacementKeys = new Set(
    args.replacements.map((assignment) =>
      assignmentKey(assignment.staffId, assignment.startTime)
    )
  );
  const staleIds = previous
    .filter(
      (assignment) =>
        !replacementKeys.has(
          assignmentKey(assignment.staffId, assignment.startTime)
        )
    )
    .map((assignment) => assignment._id);

  if (staleIds.length > 0) {
    await ScheduleAssignment.deleteMany({
      _id: { $in: staleIds },
      locationId: args.locationId,
      date: args.date,
    });
  }

  return {
    applied: true,
    blockedEmptyReplacement: false,
    preservedCount: previous.length - staleIds.length,
    upsertedCount: args.replacements.length,
    removedStaleCount: staleIds.length,
  };
}
