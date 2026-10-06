import { jsonSchema, tool } from "ai";

import { PUT as updateScheduleBatch } from "@/app/api/schedule/batch/route";
import {
  PATCH as resolveUnplacedAssignment,
  POST as createUnplacedAssignment,
} from "@/app/api/unplaced/route";
import { connectToDatabase } from "@/lib/db";
import { Client } from "@/models/Client";
import { ScheduleAssignment } from "@/models/ScheduleAssignment";
import { Staff } from "@/models/Staff";
import { UnplacedAssignment } from "@/models/UnplacedAssignment";

import type { SchedulerAiContext } from "./types";

type JsonRecord = Record<string, any>;

type ReplacementInput = {
  entityType: "STAFF" | "CLIENT";
  source: string;
  replacement: string;
  startTime?: string;
  endTime?: string;
  allowLockedOverride?: boolean;
  allowRuleOverride?: boolean;
};

type PlaceUnplacedInput = {
  unplacedId?: string;
  client?: string;
  originalStartTime?: string;
  staff: string;
  startTime: string;
  allowLockedOverride?: boolean;
  allowRuleOverride?: boolean;
};

type BatchChange = {
  staffId: string;
  startTime: string;
  assignmentType:
    | "CLIENT_1_TO_1"
    | "BREAK"
    | "BREAK_NAP"
    | "BREAK_SPEECH"
    | "NAP"
    | "SPEECH"
    | "UNAVAILABLE"
    | "OPEN"
    | "EMPTY";
  text?: string;
  clientId?: string | null;
};

const replaceSchema = jsonSchema<ReplacementInput>({
  type: "object",
  properties: {
    entityType: {
      type: "string",
      enum: ["STAFF", "CLIENT"],
      description:
        "STAFF moves/replaces all saved blocks from one staff member to another. CLIENT replaces a client's saved 1:1 blocks with another client and swaps same-time coverage when both clients are already scheduled.",
    },
    source: {
      type: "string",
      description: "Source staff name or source client display code/name.",
    },
    replacement: {
      type: "string",
      description: "Replacement staff name or replacement client display code/name.",
    },
    startTime: {
      type: "string",
      description: "Optional inclusive HH:MM lower bound. Omit to replace all matching blocks for the day.",
    },
    endTime: {
      type: "string",
      description: "Optional exclusive HH:MM upper bound. Omit to replace all matching blocks for the day.",
    },
    allowLockedOverride: {
      type: "boolean",
      description: "Set true only after the user explicitly approves overriding locked/manual cells.",
    },
    allowRuleOverride: {
      type: "boolean",
      description: "Set true only after the user explicitly approves the exact scheduler-rule conflicts returned by the first attempt.",
    },
  },
  required: ["entityType", "source", "replacement"],
  additionalProperties: false,
});

const placeUnplacedSchema = jsonSchema<PlaceUnplacedInput>({
  type: "object",
  properties: {
    unplacedId: {
      type: "string",
      description: "Exact unresolved Unplaced assignment ID when it is known from date context or a prior tool result.",
    },
    client: {
      type: "string",
      description: "Client display code/name when unplacedId is not supplied.",
    },
    originalStartTime: {
      type: "string",
      description: "Optional original HH:MM time used to disambiguate multiple Unplaced records for the same client.",
    },
    staff: {
      type: "string",
      description: "Target staff name or ID.",
    },
    startTime: {
      type: "string",
      description: "Target HH:MM 30-minute schedule slot.",
    },
    allowLockedOverride: {
      type: "boolean",
      description: "Set true only after explicit user approval to replace a protected target cell.",
    },
    allowRuleOverride: {
      type: "boolean",
      description: "Set true only after explicit user approval of returned scheduler conflicts.",
    },
  },
  required: ["staff", "startTime"],
  additionalProperties: false,
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function idFrom(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "object" && "_id" in (value as JsonRecord)) {
    const id = (value as JsonRecord)._id;
    return id ? String(id) : null;
  }
  return String(value);
}

function withinRange(startTime: string, start?: string, end?: string): boolean {
  if (start && startTime < start) return false;
  if (end && startTime >= end) return false;
  return true;
}

function isProtected(record: JsonRecord | null | undefined): boolean {
  return Boolean(
    record &&
      (record.locked === true ||
        record.manuallyOverridden === true ||
        record.source === "MANUAL")
  );
}

function assignmentType(record: JsonRecord): BatchChange["assignmentType"] {
  const type = String(record.assignmentType ?? "OPEN") as BatchChange["assignmentType"];
  return type;
}

async function invokeJson(
  handler: (request: Request) => Promise<Response>,
  method: "POST" | "PUT" | "PATCH",
  body: JsonRecord
): Promise<JsonRecord> {
  const response = await handler(
    new Request("http://scheduler-ai.internal/", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  let data: JsonRecord = {};
  try {
    data = (await response.json()) as JsonRecord;
  } catch {
    data = {};
  }
  return { ok: response.ok, status: response.status, ...data };
}

async function resolveStaff(locationId: string, reference: string): Promise<JsonRecord> {
  await connectToDatabase();
  const value = reference.trim();
  if (!value) throw new Error("A staff reference is required.");

  if (/^[a-f0-9]{24}$/i.test(value)) {
    const byId = await Staff.findOne({ _id: value, locationId, active: true })
      .select("_id fullName role")
      .lean();
    if (byId) return byId as unknown as JsonRecord;
  }

  const exact = await Staff.find({
    locationId,
    active: true,
    fullName: { $regex: `^${escapeRegex(value)}$`, $options: "i" },
  })
    .select("_id fullName role")
    .limit(2)
    .lean();
  if (exact.length === 1) return exact[0] as unknown as JsonRecord;

  const partial = await Staff.find({
    locationId,
    active: true,
    fullName: { $regex: escapeRegex(value), $options: "i" },
  })
    .select("_id fullName role")
    .limit(3)
    .lean();
  if (partial.length === 1) return partial[0] as unknown as JsonRecord;
  if (partial.length > 1 || exact.length > 1) {
    throw new Error(`Staff reference "${value}" is ambiguous. Use the full staff name.`);
  }
  throw new Error(`No active staff member matched "${value}" at this clinic.`);
}

async function resolveClient(locationId: string, reference: string): Promise<JsonRecord> {
  await connectToDatabase();
  const value = reference.trim();
  if (!value) throw new Error("A client reference is required.");

  if (/^[a-f0-9]{24}$/i.test(value)) {
    const byId = await Client.findOne({ _id: value, locationId, active: true })
      .select("_id displayCode fullName")
      .lean();
    if (byId) return byId as unknown as JsonRecord;
  }

  const byCode = await Client.find({
    locationId,
    active: true,
    displayCode: { $regex: `^${escapeRegex(value)}$`, $options: "i" },
  })
    .select("_id displayCode fullName")
    .limit(2)
    .lean();
  if (byCode.length === 1) return byCode[0] as unknown as JsonRecord;

  const byName = await Client.find({
    locationId,
    active: true,
    fullName: { $regex: `^${escapeRegex(value)}$`, $options: "i" },
  })
    .select("_id displayCode fullName")
    .limit(2)
    .lean();
  if (byName.length === 1) return byName[0] as unknown as JsonRecord;

  const partial = await Client.find({
    locationId,
    active: true,
    $or: [
      { displayCode: { $regex: escapeRegex(value), $options: "i" } },
      { fullName: { $regex: escapeRegex(value), $options: "i" } },
    ],
  })
    .select("_id displayCode fullName")
    .limit(3)
    .lean();
  if (partial.length === 1) return partial[0] as unknown as JsonRecord;
  if (partial.length > 1 || byCode.length > 1 || byName.length > 1) {
    throw new Error(`Client reference "${value}" is ambiguous. Use the display code.`);
  }
  throw new Error(`No active client matched "${value}" at this clinic.`);
}

async function loadAssignments(locationId: string, date: string): Promise<JsonRecord[]> {
  await connectToDatabase();
  return (await ScheduleAssignment.find({ locationId, date })
    .select(
      "staffId clientId startTime endTime assignmentType source locked manuallyOverridden note"
    )
    .sort({ startTime: 1 })
    .lean()) as unknown as JsonRecord[];
}

async function createUnplaced(
  locationId: string,
  date: string,
  clientId: string,
  clientCode: string,
  originalStaffId: string,
  originalStartTime: string,
  reason: string
): Promise<JsonRecord> {
  return invokeJson(createUnplacedAssignment, "POST", {
    locationId,
    date,
    clientId,
    displayText: `${clientCode} 1:1`,
    originalStaffId,
    originalStartTime,
    reason,
  });
}

function protectedResult(records: JsonRecord[], staffNames: Map<string, string>) {
  return {
    ok: false,
    requiresConfirmation: true,
    confirmationType: "LOCKED_OR_MANUAL",
    protectedCells: records.map((record) => ({
      staffId: idFrom(record.staffId),
      staffName: staffNames.get(idFrom(record.staffId) ?? "") ?? "Unknown staff",
      startTime: String(record.startTime ?? ""),
      assignmentType: String(record.assignmentType ?? ""),
    })),
    message:
      "One or more affected cells are locked/manual. Ask the user for explicit override permission before retrying with allowLockedOverride=true.",
  };
}

export const SCHEDULER_BULK_WRITE_TOOL_NAMES = new Set([
  "replace_schedule_blocks",
  "place_unplaced_assignment",
]);

export function createSchedulerBulkTools(context: SchedulerAiContext) {
  const { locationId, date } = context;

  return {
    replace_schedule_blocks: tool({
      description:
        "Deterministically replace MANY saved schedule blocks on the selected date. Use entityType=STAFF for requests like 'replace all Anias blocks with Areyana'. Use entityType=CLIENT for requests like 'replace CaMe with ZiBo everywhere/all blocks'. CLIENT replacement swaps same-time CaMe/ZiBo coverage when both already have coverage; source-only replaced cells leave the displaced source client in Unplaced. STAFF replacement moves every matching source block to the replacement staff at the same time and leaves any displaced target-client blocks in Unplaced. The first attempt must keep override flags false. If protected/rule conflicts are returned, ask the user before retrying with the needed override flag.",
      inputSchema: replaceSchema,
      execute: async ({
        entityType,
        source,
        replacement,
        startTime,
        endTime,
        allowLockedOverride = false,
        allowRuleOverride = false,
      }) => {
        if (source.trim().toLowerCase() === replacement.trim().toLowerCase()) {
          return { ok: false, error: "Source and replacement must be different." };
        }

        const assignments = await loadAssignments(locationId, date);
        if (assignments.length === 0) {
          return {
            ok: false,
            scheduleAvailable: false,
            date,
            error: `The schedule for ${date} has not been generated yet.`,
          };
        }

        const activeStaff = (await Staff.find({ locationId, active: true })
          .select("_id fullName")
          .lean()) as unknown as JsonRecord[];
        const staffNames = new Map(
          activeStaff.map((member) => [String(member._id), String(member.fullName)])
        );

        const changes: BatchChange[] = [];
        const protectedCells: JsonRecord[] = [];
        const unplacedAfterWrite: Array<{
          clientId: string;
          clientCode: string;
          staffId: string;
          startTime: string;
          reason: string;
        }> = [];
        const swapped: JsonRecord[] = [];
        const replaced: JsonRecord[] = [];
        const overwrittenActivities: JsonRecord[] = [];

        if (entityType === "STAFF") {
          const [sourceStaff, replacementStaff] = await Promise.all([
            resolveStaff(locationId, source),
            resolveStaff(locationId, replacement),
          ]);
          const sourceStaffId = String(sourceStaff._id);
          const replacementStaffId = String(replacementStaff._id);
          if (sourceStaffId === replacementStaffId) {
            return { ok: false, error: "Source and replacement staff are the same person." };
          }

          const sourceAssignments = assignments.filter(
            (record) =>
              idFrom(record.staffId) === sourceStaffId &&
              withinRange(String(record.startTime ?? ""), startTime, endTime)
          );
          if (sourceAssignments.length === 0) {
            return {
              ok: true,
              date,
              changed: false,
              source: String(sourceStaff.fullName),
              replacement: String(replacementStaff.fullName),
              message: "No matching source staff blocks were found in the requested range.",
            };
          }

          for (const sourceAssignment of sourceAssignments) {
            const slot = String(sourceAssignment.startTime);
            const targetAssignment = assignments.find(
              (record) =>
                idFrom(record.staffId) === replacementStaffId &&
                String(record.startTime) === slot
            );
            if (isProtected(sourceAssignment)) protectedCells.push(sourceAssignment);
            if (isProtected(targetAssignment)) protectedCells.push(targetAssignment as JsonRecord);

            changes.push({
              staffId: sourceStaffId,
              startTime: slot,
              assignmentType: "EMPTY",
              text: "Moved by Scheduler AI bulk staff replacement",
            });
            changes.push({
              staffId: replacementStaffId,
              startTime: slot,
              assignmentType: assignmentType(sourceAssignment),
              clientId: idFrom(sourceAssignment.clientId),
              text:
                String(sourceAssignment.note ?? "").trim() ||
                "Moved by Scheduler AI bulk staff replacement",
            });

            const targetClientId = idFrom(targetAssignment?.clientId);
            const sourceClientId = idFrom(sourceAssignment.clientId);
            if (
              targetAssignment?.assignmentType === "CLIENT_1_TO_1" &&
              targetClientId &&
              targetClientId !== sourceClientId
            ) {
              const targetClient = await Client.findById(targetClientId)
                .select("displayCode")
                .lean();
              unplacedAfterWrite.push({
                clientId: targetClientId,
                clientCode: targetClient
                  ? String((targetClient as unknown as JsonRecord).displayCode ?? "Client")
                  : "Client",
                staffId: replacementStaffId,
                startTime: slot,
                reason: `Displaced when all ${String(sourceStaff.fullName)} blocks were moved to ${String(replacementStaff.fullName)}.`,
              });
            } else if (targetAssignment && targetAssignment.assignmentType !== "CLIENT_1_TO_1") {
              overwrittenActivities.push({
                startTime: slot,
                assignmentType: String(targetAssignment.assignmentType),
              });
            }
            replaced.push({
              startTime: slot,
              fromStaff: String(sourceStaff.fullName),
              toStaff: String(replacementStaff.fullName),
              assignmentType: String(sourceAssignment.assignmentType),
            });
          }

          if (protectedCells.length > 0 && !allowLockedOverride) {
            return protectedResult(protectedCells, staffNames);
          }
        } else {
          const [sourceClient, replacementClient] = await Promise.all([
            resolveClient(locationId, source),
            resolveClient(locationId, replacement),
          ]);
          const sourceClientId = String(sourceClient._id);
          const replacementClientId = String(replacementClient._id);
          if (sourceClientId === replacementClientId) {
            return { ok: false, error: "Source and replacement clients are the same client." };
          }

          const sourceAssignments = assignments.filter(
            (record) =>
              record.assignmentType === "CLIENT_1_TO_1" &&
              idFrom(record.clientId) === sourceClientId &&
              withinRange(String(record.startTime ?? ""), startTime, endTime)
          );
          if (sourceAssignments.length === 0) {
            return {
              ok: true,
              date,
              changed: false,
              source: String(sourceClient.displayCode),
              replacement: String(replacementClient.displayCode),
              message: "No matching source client blocks were found in the requested range.",
            };
          }

          for (const sourceAssignment of sourceAssignments) {
            const slot = String(sourceAssignment.startTime);
            const sourceStaffId = idFrom(sourceAssignment.staffId);
            if (!sourceStaffId) continue;
            const replacementAssignment = assignments.find(
              (record) =>
                record.assignmentType === "CLIENT_1_TO_1" &&
                idFrom(record.clientId) === replacementClientId &&
                String(record.startTime) === slot
            );

            if (isProtected(sourceAssignment)) protectedCells.push(sourceAssignment);
            if (isProtected(replacementAssignment)) {
              protectedCells.push(replacementAssignment as JsonRecord);
            }

            if (replacementAssignment) {
              const replacementStaffId = idFrom(replacementAssignment.staffId);
              if (!replacementStaffId || replacementStaffId === sourceStaffId) continue;

              changes.push({
                staffId: sourceStaffId,
                startTime: slot,
                assignmentType: "EMPTY",
                text: "Preparing Scheduler AI client swap",
              });
              changes.push({
                staffId: replacementStaffId,
                startTime: slot,
                assignmentType: "EMPTY",
                text: "Preparing Scheduler AI client swap",
              });
              changes.push({
                staffId: sourceStaffId,
                startTime: slot,
                assignmentType: "CLIENT_1_TO_1",
                clientId: replacementClientId,
                text: `${String(replacementClient.displayCode)} 1:1`,
              });
              changes.push({
                staffId: replacementStaffId,
                startTime: slot,
                assignmentType: "CLIENT_1_TO_1",
                clientId: sourceClientId,
                text: `${String(sourceClient.displayCode)} 1:1`,
              });
              swapped.push({
                startTime: slot,
                sourceClient: String(sourceClient.displayCode),
                replacementClient: String(replacementClient.displayCode),
                sourceStaff: staffNames.get(sourceStaffId) ?? sourceStaffId,
                replacementStaff:
                  staffNames.get(replacementStaffId) ?? replacementStaffId,
              });
            } else {
              changes.push({
                staffId: sourceStaffId,
                startTime: slot,
                assignmentType: "CLIENT_1_TO_1",
                clientId: replacementClientId,
                text: `${String(replacementClient.displayCode)} 1:1`,
              });
              unplacedAfterWrite.push({
                clientId: sourceClientId,
                clientCode: String(sourceClient.displayCode),
                staffId: sourceStaffId,
                startTime: slot,
                reason: `Displaced when ${String(sourceClient.displayCode)} was replaced by ${String(replacementClient.displayCode)}.`,
              });
              replaced.push({
                startTime: slot,
                staffName: staffNames.get(sourceStaffId) ?? sourceStaffId,
                sourceClient: String(sourceClient.displayCode),
                replacementClient: String(replacementClient.displayCode),
                sourceMovedToUnplaced: true,
              });
            }
          }

          if (protectedCells.length > 0 && !allowLockedOverride) {
            return protectedResult(protectedCells, staffNames);
          }
        }

        if (changes.length === 0) {
          return { ok: true, date, changed: false, message: "No replaceable blocks were found." };
        }
        if (changes.length > 120) {
          return {
            ok: false,
            error:
              "This replacement expands to more than 120 cell operations. Narrow the time range or split it into two requests.",
          };
        }

        const batchResult = await invokeJson(updateScheduleBatch, "PUT", {
          locationId,
          date,
          changes,
          force: allowRuleOverride,
        });
        if (!batchResult.ok) {
          return {
            ...batchResult,
            date,
            requiresConfirmation:
              batchResult.requiresConfirmation === true || batchResult.status === 409,
            plannedChanges: changes.length,
            swapped,
            replaced,
          };
        }

        const unplacedCreated: JsonRecord[] = [];
        for (const item of unplacedAfterWrite) {
          const created = await createUnplaced(
            locationId,
            date,
            item.clientId,
            item.clientCode,
            item.staffId,
            item.startTime,
            item.reason
          );
          if (created.ok && created.unplacedAssignment) {
            unplacedCreated.push(created.unplacedAssignment as JsonRecord);
          }
        }

        return {
          ok: true,
          changed: true,
          date,
          updatedCellOperations: changes.length,
          replaced,
          swapped,
          unplacedCreated,
          overwrittenActivities,
          forcedRuleOverride: allowRuleOverride,
          lockedOverrideApproved: allowLockedOverride,
          message:
            unplacedCreated.length > 0
              ? `Replacement completed. ${unplacedCreated.length} displaced client block(s) were moved to Unplaced.`
              : "Replacement completed without leaving displaced client coverage in Unplaced.",
        };
      },
    }),

    place_unplaced_assignment: tool({
      description:
        "Place one unresolved Unplaced client assignment into a requested staff/time cell and mark that Unplaced record resolved. Use this when the user follows up with directions such as 'put that unassigned CaMe block with Areyana at 2:00'. If the target cell is occupied by a different client, that displaced client is preserved as a new Unplaced record. First attempt with override flags false; ask permission if a protected/rule conflict is returned.",
      inputSchema: placeUnplacedSchema,
      execute: async ({
        unplacedId,
        client,
        originalStartTime,
        staff,
        startTime,
        allowLockedOverride = false,
        allowRuleOverride = false,
      }) => {
        await connectToDatabase();
        let matches: JsonRecord[] = [];

        if (unplacedId) {
          const exact = await UnplacedAssignment.find({
            _id: unplacedId,
            locationId,
            date,
            status: "UNPLACED",
          })
            .populate("clientId", "displayCode fullName")
            .limit(2)
            .lean();
          matches = exact as unknown as JsonRecord[];
        } else if (client) {
          const clientProfile = await resolveClient(locationId, client);
          const query: JsonRecord = {
            locationId,
            date,
            status: "UNPLACED",
            clientId: clientProfile._id,
          };
          if (originalStartTime) query.originalStartTime = originalStartTime;
          const found = await UnplacedAssignment.find(query)
            .populate("clientId", "displayCode fullName")
            .sort({ originalStartTime: 1, createdAt: 1 })
            .limit(4)
            .lean();
          matches = found as unknown as JsonRecord[];
        }

        if (matches.length === 0) {
          return {
            ok: false,
            error: "No matching unresolved Unplaced assignment was found for this date.",
          };
        }
        if (matches.length > 1) {
          return {
            ok: false,
            requiresClarification: true,
            message:
              "More than one matching Unplaced assignment exists. Ask which original time to place.",
            matches: matches.map((record) => ({
              id: String(record._id),
              clientCode:
                record.clientId && typeof record.clientId === "object"
                  ? String((record.clientId as JsonRecord).displayCode ?? "Client")
                  : null,
              originalStartTime: String(record.originalStartTime ?? ""),
            })),
          };
        }

        const record = matches[0];
        const targetStaff = await resolveStaff(locationId, staff);
        const targetStaffId = String(targetStaff._id);
        const clientId = idFrom(record.clientId);
        if (!clientId) {
          return { ok: false, error: "The Unplaced record no longer has a valid client." };
        }
        const clientProfile = await Client.findById(clientId)
          .select("displayCode")
          .lean();
        const clientCode = clientProfile
          ? String((clientProfile as unknown as JsonRecord).displayCode ?? "Client")
          : "Client";

        const existingResult = await ScheduleAssignment.findOne({
          locationId,
          date,
          staffId: targetStaffId,
          startTime,
        }).lean();
        const existing = existingResult
          ? (existingResult as unknown as JsonRecord)
          : null;

        if (isProtected(existing) && !allowLockedOverride) {
          return protectedResult(
            [existing as JsonRecord],
            new Map([[targetStaffId, String(targetStaff.fullName)]])
          );
        }

        const batchResult = await invokeJson(updateScheduleBatch, "PUT", {
          locationId,
          date,
          force: allowRuleOverride,
          changes: [
            {
              staffId: targetStaffId,
              startTime,
              assignmentType: "CLIENT_1_TO_1",
              clientId,
              text: `${clientCode} 1:1`,
            },
          ],
        });
        if (!batchResult.ok) {
          return {
            ...batchResult,
            date,
            requiresConfirmation:
              batchResult.requiresConfirmation === true || batchResult.status === 409,
          };
        }

        let displacedToUnplaced: JsonRecord | null = null;
        const displacedClientId = idFrom(existing?.clientId);
        if (
          existing?.assignmentType === "CLIENT_1_TO_1" &&
          displacedClientId &&
          displacedClientId !== clientId
        ) {
          const displacedClient = await Client.findById(displacedClientId)
            .select("displayCode")
            .lean();
          const displacedCode = displacedClient
            ? String((displacedClient as unknown as JsonRecord).displayCode ?? "Client")
            : "Client";
          const created = await createUnplaced(
            locationId,
            date,
            displacedClientId,
            displacedCode,
            targetStaffId,
            startTime,
            `Displaced when Unplaced ${clientCode} was placed with ${String(targetStaff.fullName)}.`
          );
          displacedToUnplaced = created.unplacedAssignment ?? null;
        }

        const resolved = await invokeJson(resolveUnplacedAssignment, "PATCH", {
          locationId,
          unplacedId: String(record._id),
        });

        return {
          ok: true,
          changed: true,
          date,
          placed: {
            unplacedId: String(record._id),
            clientCode,
            staffName: String(targetStaff.fullName),
            startTime,
          },
          resolvedUnplaced: resolved.ok || resolved.status === 404,
          displacedToUnplaced,
          forcedRuleOverride: allowRuleOverride,
          lockedOverrideApproved: allowLockedOverride,
        };
      },
    }),
  };
}
