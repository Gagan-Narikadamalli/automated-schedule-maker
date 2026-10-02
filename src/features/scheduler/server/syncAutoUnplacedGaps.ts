import type {
  SchedulerAssignment,
  UncoveredRequirement,
} from "@/features/scheduler/engine/types";
import { UnplacedAssignment } from "@/models/UnplacedAssignment";

type ExistingManualGap = {
  _id?: unknown;
  clientId?: unknown;
  originalStartTime?: unknown;
};

function gapKey(
  clientId: string | undefined,
  startTime: string
): string {
  return `${clientId ?? ""}|${startTime}`;
}

function coveredRequirementKeys(
  assignments: SchedulerAssignment[]
): Set<string> {
  return new Set(
    assignments
      .filter(
        (assignment) =>
          assignment.assignmentType === "CLIENT_1_TO_1" &&
          Boolean(assignment.clientId)
      )
      .map((assignment) =>
        gapKey(
          assignment.clientId,
          assignment.startTime
        )
      )
  );
}

/**
 * Keeps the Unplaced Assignments tray synchronized with the current schedule.
 * Automatic uncovered records are rebuilt from the current scheduler result.
 * Manual displacement records remain until the exact client/time requirement is
 * covered again or the manager explicitly resolves the tray item.
 *
 * The caller must already have an active database connection.
 */
export async function syncAutoUnplacedGaps(
  locationId: string,
  date: string,
  uncoveredRequirements: UncoveredRequirement[],
  currentAssignments: SchedulerAssignment[] = []
): Promise<number> {
  const manualGaps = (await UnplacedAssignment.find({
    locationId,
    date,
    status: "UNPLACED",
    origin: {
      $ne: "AUTO_UNCOVERED",
    },
  })
    .select("_id clientId originalStartTime")
    .lean()) as unknown as ExistingManualGap[];

  const coveredKeys = coveredRequirementKeys(currentAssignments);
  const resolvedManualIds = manualGaps
    .filter((record) =>
      coveredKeys.has(
        gapKey(
          record.clientId ? String(record.clientId) : undefined,
          String(record.originalStartTime ?? "")
        )
      )
    )
    .map((record) => record._id)
    .filter(Boolean);

  if (resolvedManualIds.length > 0) {
    await UnplacedAssignment.updateMany(
      {
        _id: {
          $in: resolvedManualIds,
        },
        status: "UNPLACED",
      },
      {
        $set: {
          status: "RESOLVED",
          resolvedBy: "scheduler-system",
          resolvedAt: new Date(),
        },
      }
    );
  }

  const activeManualGapKeys = new Set(
    manualGaps
      .filter((record) => !resolvedManualIds.includes(record._id))
      .map((record) =>
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
      !activeManualGapKeys.has(
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
