import type { UncoveredRequirement } from "@/features/scheduler/engine/types";
import { UnplacedAssignment } from "@/models/UnplacedAssignment";

type ExistingManualGap = {
  clientId?: unknown;
  originalStartTime?: unknown;
};

function gapKey(
  clientId: string | undefined,
  startTime: string
): string {
  return `${clientId ?? ""}|${startTime}`;
}

/**
 * Keeps the Unplaced Assignments tray synchronized with the current automatic
 * scheduler gaps for one date. Manual displacement records are never deleted.
 *
 * The caller must already have an active database connection.
 */
export async function syncAutoUnplacedGaps(
  locationId: string,
  date: string,
  uncoveredRequirements: UncoveredRequirement[]
): Promise<number> {
  const manualGaps = (await UnplacedAssignment.find({
    locationId,
    date,
    status: "UNPLACED",
    origin: {
      $ne: "AUTO_UNCOVERED",
    },
  })
    .select("clientId originalStartTime")
    .lean()) as unknown as ExistingManualGap[];

  const manualGapKeys = new Set(
    manualGaps.map((record) =>
      gapKey(
        record.clientId ? String(record.clientId) : undefined,
        String(record.originalStartTime ?? "")
      )
    )
  );

  await UnplacedAssignment.deleteMany({
    locationId,
    date,
    status: "UNPLACED",
    origin: "AUTO_UNCOVERED",
  });

  const gapsToCreate = uncoveredRequirements.filter(
    (requirement) =>
      !manualGapKeys.has(
        gapKey(requirement.clientId, requirement.startTime)
      )
  );

  if (gapsToCreate.length === 0) {
    return 0;
  }

  await UnplacedAssignment.insertMany(
    gapsToCreate.map((requirement) => ({
      locationId,
      date,
      clientId: requirement.clientId,
      displayText: `${requirement.clientCode} 1:1`,
      originalStaffId: null,
      originalStartTime: requirement.startTime,
      reason:
        "Automatic scheduler could not safely cover this required client block. Manager placement is required.",
      origin: "AUTO_UNCOVERED",
      status: "UNPLACED",
      createdBy: "scheduler-system",
    }))
  );

  return gapsToCreate.length;
}
