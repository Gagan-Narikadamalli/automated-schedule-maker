import { jsonSchema, tool } from "ai";

import { calculateSchedulerReadiness } from "@/features/scheduler/engine/preflight";
import { buildDaySchedulerInput } from "@/features/scheduler/server/buildDaySchedulerInput";
import { connectToDatabase } from "@/lib/db";
import { ScheduleAssignment } from "@/models/ScheduleAssignment";
import { UnplacedAssignment } from "@/models/UnplacedAssignment";

import type { SchedulerAiContext } from "./types";

type DatabaseRecord = Record<string, any>;

const noInputSchema = jsonSchema<Record<string, never>>({
  type: "object",
  properties: {},
  additionalProperties: false,
});

const BREAK_TYPES = new Set(["BREAK", "BREAK_NAP", "BREAK_SPEECH"]);

function idFrom(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "object" && "_id" in (value as Record<string, unknown>)) {
    const id = (value as Record<string, unknown>)._id;
    return id ? String(id) : null;
  }
  return String(value);
}

async function loadAssignments(locationId: string, date: string): Promise<DatabaseRecord[]> {
  await connectToDatabase();
  const records = await ScheduleAssignment.find({ locationId, date })
    .select(
      "staffId clientId startTime endTime assignmentType source locked manuallyOverridden note"
    )
    .sort({ startTime: 1 })
    .lean();
  return records as unknown as DatabaseRecord[];
}

export function createSchedulerReadOnlyTools(context: SchedulerAiContext) {
  const { locationId, date } = context;

  return {
    get_day_schedule: tool({
      description:
        "Read the saved assignments for the currently selected scheduler location and date. Use this before answering questions about who is assigned, breaks, locked/manual blocks, naps, speech, or the day's current state.",
      inputSchema: noInputSchema,
      execute: async () => {
        const [dayData, assignments] = await Promise.all([
          buildDaySchedulerInput(locationId, date),
          loadAssignments(locationId, date),
        ]);

        const staffNames = new Map(dayData.staff.map((member) => [member.id, member.name]));
        const clientCodes = new Map(
          dayData.clients.map((client) => [client.id, client.displayCode])
        );

        return {
          locationId,
          date,
          requiredClientSlots: dayData.clients.reduce(
            (total, client) => total + client.requiredSlots.length,
            0
          ),
          assignmentCount: assignments.length,
          assignments: assignments.map((assignment) => {
            const staffId = idFrom(assignment.staffId);
            const clientId = idFrom(assignment.clientId);
            return {
              staffId,
              staffName: staffId ? staffNames.get(staffId) ?? "Unknown staff" : null,
              clientCode: clientId ? clientCodes.get(clientId) ?? null : null,
              startTime: String(assignment.startTime ?? ""),
              endTime: String(assignment.endTime ?? ""),
              assignmentType: String(assignment.assignmentType ?? ""),
              source: String(assignment.source ?? ""),
              locked: assignment.locked === true,
              manuallyOverridden: assignment.manuallyOverridden === true,
            };
          }),
        };
      },
    }),

    get_staff: tool({
      description:
        "Read active scheduler staff, their availability, current scheduled client workload, and required-break status for the selected day. Use this for questions such as who is available or who is missing a break.",
      inputSchema: noInputSchema,
      execute: async () => {
        const [dayData, assignments] = await Promise.all([
          buildDaySchedulerInput(locationId, date),
          loadAssignments(locationId, date),
        ]);

        const assignmentsByStaff = new Map<string, DatabaseRecord[]>();
        for (const assignment of assignments) {
          const staffId = idFrom(assignment.staffId);
          if (!staffId) continue;
          const current = assignmentsByStaff.get(staffId) ?? [];
          current.push(assignment);
          assignmentsByStaff.set(staffId, current);
        }

        return {
          locationId,
          date,
          breakEligibilityHours: dayData.extendedRules.breakEligibilityHours,
          staff: dayData.staff.map((member) => {
            const scheduled = assignmentsByStaff.get(member.id) ?? [];
            const breakSlots = scheduled
              .filter((assignment) => BREAK_TYPES.has(String(assignment.assignmentType)))
              .map((assignment) => String(assignment.startTime));
            const clientSlots = scheduled.filter(
              (assignment) => assignment.assignmentType === "CLIENT_1_TO_1"
            ).length;
            const availableHours =
              (member.availableSlots.length * dayData.extendedRules.slotLengthMinutes) / 60;
            const breakEligible =
              availableHours >= dayData.extendedRules.breakEligibilityHours;

            return {
              id: member.id,
              name: member.name,
              role: member.role,
              teamId: member.teamId ?? null,
              availableSlots: member.availableSlots,
              availableHours,
              clientHours:
                (clientSlots * dayData.extendedRules.slotLengthMinutes) / 60,
              breakEligible,
              breakSlots,
              breakStatus: breakEligible
                ? breakSlots.length === 0
                  ? "MISSING_BREAK"
                  : breakSlots.length > 1
                    ? "MULTIPLE_BREAKS"
                    : "HAS_BREAK"
                : "NOT_ELIGIBLE",
              calledOut: dayData.input.callOutStaffIds.includes(member.id),
            };
          }),
        };
      },
    }),

    get_clients: tool({
      description:
        "Read scheduler-relevant client requirements for the selected day using client display codes only. Use this for coverage, nap, speech, support-level, and required-time questions.",
      inputSchema: noInputSchema,
      execute: async () => {
        const dayData = await buildDaySchedulerInput(locationId, date);
        return {
          locationId,
          date,
          clients: dayData.clients.map((client) => ({
            id: client.id,
            displayCode: client.displayCode,
            teamId: client.teamId ?? null,
            supportLevel: client.supportLevel ?? null,
            requiredSlots: client.requiredSlots,
            napSlots: client.napSlots,
            speechSlots: client.speechSlots,
            maxConsecutiveBlocksWithSameStaff:
              client.maxConsecutiveBlocksWithSameStaff ?? null,
            desiredDifferentStaffPerDay: client.desiredDifferentStaffPerDay ?? null,
          })),
        };
      },
    }),

    get_unplaced_assignments: tool({
      description:
        "Read unresolved assignments in the scheduler's Unplaced tray for the selected day. Use this whenever the user asks what still needs scheduling or why a day is incomplete.",
      inputSchema: noInputSchema,
      execute: async () => {
        await connectToDatabase();
        const records = (await UnplacedAssignment.find({
          locationId,
          date,
          status: "UNPLACED",
        })
          .populate("clientId", "displayCode")
          .select("clientId displayText originalStaffId originalStartTime reason origin")
          .sort({ originalStartTime: 1, createdAt: 1 })
          .lean()) as unknown as DatabaseRecord[];

        return {
          locationId,
          date,
          count: records.length,
          unplacedAssignments: records.map((record) => {
            const populatedClient =
              record.clientId && typeof record.clientId === "object"
                ? (record.clientId as DatabaseRecord)
                : null;
            return {
              id: String(record._id),
              clientCode: populatedClient?.displayCode
                ? String(populatedClient.displayCode)
                : null,
              displayText: String(record.displayText ?? "Needs scheduling"),
              originalStartTime: String(record.originalStartTime ?? ""),
              reason: String(record.reason ?? "Coverage is missing."),
              origin: String(record.origin ?? ""),
            };
          }),
        };
      },
    }),

    check_schedule: tool({
      description:
        "Run a read-only health check for the selected schedule. It reports scheduler readiness, uncovered required client blocks, break problems, locked/manual block counts, and unresolved unplaced work. Use this for validation, conflict, incomplete-day, or general schedule-health questions.",
      inputSchema: noInputSchema,
      execute: async () => {
        const [dayData, assignments] = await Promise.all([
          buildDaySchedulerInput(locationId, date),
          loadAssignments(locationId, date),
        ]);

        await connectToDatabase();
        const unplacedCount = await UnplacedAssignment.countDocuments({
          locationId,
          date,
          status: "UNPLACED",
        });

        const readiness = calculateSchedulerReadiness(
          dayData.input,
          dayData.extendedRules
        );
        const clientCodes = new Map(
          dayData.clients.map((client) => [client.id, client.displayCode])
        );
        const requiredKeys = new Set<string>();
        for (const client of dayData.clients) {
          for (const startTime of client.requiredSlots) {
            requiredKeys.add(`${client.id}:${startTime}`);
          }
        }

        const coveredKeys = new Set<string>();
        const breaksByStaff = new Map<string, string[]>();
        let lockedOrManualBlocks = 0;

        for (const assignment of assignments) {
          const staffId = idFrom(assignment.staffId);
          const clientId = idFrom(assignment.clientId);
          const assignmentType = String(assignment.assignmentType ?? "");
          const startTime = String(assignment.startTime ?? "");

          if (assignmentType === "CLIENT_1_TO_1" && clientId) {
            coveredKeys.add(`${clientId}:${startTime}`);
          }
          if (staffId && BREAK_TYPES.has(assignmentType)) {
            const current = breaksByStaff.get(staffId) ?? [];
            current.push(startTime);
            breaksByStaff.set(staffId, current);
          }
          if (
            assignment.locked === true ||
            assignment.manuallyOverridden === true ||
            assignment.source === "MANUAL"
          ) {
            lockedOrManualBlocks += 1;
          }
        }

        const uncoveredRequirements: Array<{
          clientCode: string;
          startTime: string;
        }> = [];
        for (const key of requiredKeys) {
          if (coveredKeys.has(key)) continue;
          const separator = key.lastIndexOf(":");
          const clientId = key.slice(0, separator);
          const startTime = key.slice(separator + 1);
          uncoveredRequirements.push({
            clientCode: clientCodes.get(clientId) ?? "Unknown client",
            startTime,
          });
        }

        const staffBreakProblems = dayData.staff.flatMap((member) => {
          const availableHours =
            (member.availableSlots.length * dayData.extendedRules.slotLengthMinutes) / 60;
          const breakEligible =
            availableHours >= dayData.extendedRules.breakEligibilityHours;
          if (!breakEligible) return [];
          const breakSlots = breaksByStaff.get(member.id) ?? [];
          if (breakSlots.length === 1) return [];
          return [
            {
              staffId: member.id,
              staffName: member.name,
              issue: breakSlots.length === 0 ? "MISSING_BREAK" : "MULTIPLE_BREAKS",
              breakSlots,
            },
          ];
        });

        return {
          locationId,
          date,
          readiness,
          requiredClientSlots: requiredKeys.size,
          coveredClientSlots: requiredKeys.size - uncoveredRequirements.length,
          uncoveredClientSlots: uncoveredRequirements.length,
          uncoveredRequirements,
          staffBreakProblems,
          unplacedCount,
          lockedOrManualBlocks,
          callOutStaffIds: dayData.input.callOutStaffIds,
        };
      },
    }),
  };
}
