import { jsonSchema, tool } from "ai";

import { calculateSchedulerReadiness } from "@/features/scheduler/engine/preflight";
import { buildDaySchedulerInput } from "@/features/scheduler/server/buildDaySchedulerInput";
import { connectToDatabase } from "@/lib/db";
import { ScheduleAssignment } from "@/models/ScheduleAssignment";
import { UnplacedAssignment } from "@/models/UnplacedAssignment";

import type { SchedulerAiContext } from "./types";

type DatabaseRecord = Record<string, any>;

type ScheduleLookupInput = {
  staffName?: string;
  clientCode?: string;
  startTime?: string;
  endTime?: string;
  includeBreaks?: boolean;
  includeFreeStaff?: boolean;
};

type EnrichedAssignment = {
  staffId: string | null;
  staffName: string | null;
  clientId: string | null;
  clientCode: string | null;
  startTime: string;
  endTime: string;
  assignmentType: string;
  source: string;
  locked: boolean;
  manuallyOverridden: boolean;
};

const noInputSchema = jsonSchema<Record<string, never>>({
  type: "object",
  properties: {},
  additionalProperties: false,
});

const scheduleLookupSchema = jsonSchema<ScheduleLookupInput>({
  type: "object",
  properties: {
    staffName: {
      type: "string",
      description:
        "Optional staff name from the user's question, for example Anias or Areyana. Partial/case-insensitive matching is supported.",
    },
    clientCode: {
      type: "string",
      description:
        "Optional client display code from the user's question, for example CaMe or MiSm. Partial/case-insensitive matching is supported.",
    },
    startTime: {
      type: "string",
      description: "Optional range start in 24-hour HH:MM format, for example 08:00.",
    },
    endTime: {
      type: "string",
      description: "Optional range end in 24-hour HH:MM format, for example 14:00.",
    },
    includeBreaks: {
      type: "boolean",
      description: "Include Break, Break/Nap, Break/Speech, Nap, and Speech segments. Defaults to true.",
    },
    includeFreeStaff: {
      type: "boolean",
      description:
        "Also calculate which staff are available but unassigned during the requested time range. Use for questions such as who is free/available.",
    },
  },
  additionalProperties: false,
});

const BREAK_TYPES = new Set(["BREAK", "BREAK_NAP", "BREAK_SPEECH"]);
const NON_CLIENT_TYPES = new Set([
  "BREAK",
  "BREAK_NAP",
  "BREAK_SPEECH",
  "NAP",
  "SPEECH",
  "UNAVAILABLE",
  "OPEN",
]);

function idFrom(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "object" && "_id" in (value as Record<string, unknown>)) {
    const id = (value as Record<string, unknown>)._id;
    return id ? String(id) : null;
  }
  return String(value);
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function overlapsRange(
  assignment: { startTime: string; endTime: string },
  startTime?: string,
  endTime?: string
): boolean {
  if (startTime && assignment.endTime <= startTime) return false;
  if (endTime && assignment.startTime >= endTime) return false;
  return true;
}

function mergeSegments(assignments: EnrichedAssignment[]) {
  const sorted = [...assignments].sort((left, right) => {
    const staffCompare = (left.staffName ?? "").localeCompare(right.staffName ?? "");
    if (staffCompare !== 0) return staffCompare;
    const clientCompare = (left.clientCode ?? "").localeCompare(right.clientCode ?? "");
    if (clientCompare !== 0) return clientCompare;
    const typeCompare = left.assignmentType.localeCompare(right.assignmentType);
    if (typeCompare !== 0) return typeCompare;
    return left.startTime.localeCompare(right.startTime);
  });

  const segments: Array<{
    staffName: string | null;
    clientCode: string | null;
    assignmentType: string;
    startTime: string;
    endTime: string;
  }> = [];

  for (const assignment of sorted) {
    const previous = segments.at(-1);
    if (
      previous &&
      previous.staffName === assignment.staffName &&
      previous.clientCode === assignment.clientCode &&
      previous.assignmentType === assignment.assignmentType &&
      previous.endTime === assignment.startTime
    ) {
      previous.endTime = assignment.endTime;
      continue;
    }
    segments.push({
      staffName: assignment.staffName,
      clientCode: assignment.clientCode,
      assignmentType: assignment.assignmentType,
      startTime: assignment.startTime,
      endTime: assignment.endTime,
    });
  }

  return segments;
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

function enrichAssignments(
  assignments: DatabaseRecord[],
  staffNames: Map<string, string>,
  clientCodes: Map<string, string>
): EnrichedAssignment[] {
  return assignments.map((assignment) => {
    const staffId = idFrom(assignment.staffId);
    const clientId = idFrom(assignment.clientId);
    return {
      staffId,
      staffName: staffId ? staffNames.get(staffId) ?? "Unknown staff" : null,
      clientId,
      clientCode: clientId ? clientCodes.get(clientId) ?? null : null,
      startTime: String(assignment.startTime ?? ""),
      endTime: String(assignment.endTime ?? ""),
      assignmentType: String(assignment.assignmentType ?? ""),
      source: String(assignment.source ?? ""),
      locked: assignment.locked === true,
      manuallyOverridden: assignment.manuallyOverridden === true,
    };
  });
}

export function createSchedulerReadOnlyTools(context: SchedulerAiContext) {
  const { locationId, date } = context;

  return {
    lookup_schedule: tool({
      description:
        "Answer detailed conversational questions about the selected day's generated schedule by staff name, client code, and/or time range. Prefer this for questions such as: who is Anias with from 8 to 2, what clients does Areyana have, who is covering CaMe at 10, when is Danna on break, what is JeMa's coverage, or who is free between 12 and 1. It explicitly reports whether a schedule exists for that date, returns merged human-friendly schedule segments, and only calculates free staff when a generated schedule is available.",
      inputSchema: scheduleLookupSchema,
      execute: async (input) => {
        const [dayData, assignments] = await Promise.all([
          buildDaySchedulerInput(locationId, date),
          loadAssignments(locationId, date),
        ]);
        const staffNames = new Map(dayData.staff.map((member) => [member.id, member.name]));
        const clientCodes = new Map(dayData.clients.map((client) => [client.id, client.displayCode]));
        const enriched = enrichAssignments(assignments, staffNames, clientCodes);
        const requiredClientSlots = dayData.clients.reduce(
          (total, client) => total + client.requiredSlots.length,
          0
        );

        let resolvedStaffId: string | null = null;
        let resolvedStaffName: string | null = null;
        let staffMatches: Array<{ id: string; name: string }> = [];
        if (input.staffName?.trim()) {
          const target = normalize(input.staffName);
          staffMatches = dayData.staff
            .filter((member) => {
              const candidate = normalize(member.name);
              return candidate === target || candidate.includes(target) || target.includes(candidate);
            })
            .map((member) => ({ id: member.id, name: member.name }));
          if (staffMatches.length === 1) {
            resolvedStaffId = staffMatches[0].id;
            resolvedStaffName = staffMatches[0].name;
          }
        }

        let resolvedClientId: string | null = null;
        let resolvedClientCode: string | null = null;
        let clientMatches: Array<{ id: string; displayCode: string }> = [];
        if (input.clientCode?.trim()) {
          const target = normalize(input.clientCode);
          clientMatches = dayData.clients
            .filter((client) => {
              const candidate = normalize(client.displayCode);
              return candidate === target || candidate.includes(target) || target.includes(candidate);
            })
            .map((client) => ({ id: client.id, displayCode: client.displayCode }));
          if (clientMatches.length === 1) {
            resolvedClientId = clientMatches[0].id;
            resolvedClientCode = clientMatches[0].displayCode;
          }
        }

        const ambiguousStaff = Boolean(input.staffName?.trim()) && staffMatches.length !== 1;
        const ambiguousClient = Boolean(input.clientCode?.trim()) && clientMatches.length !== 1;
        if (ambiguousStaff || ambiguousClient) {
          return {
            locationId,
            date,
            scheduleAvailable: assignments.length > 0,
            assignmentCount: assignments.length,
            requiredClientSlots,
            needsClarification: true,
            staffQuery: input.staffName ?? null,
            staffMatches,
            clientQuery: input.clientCode ?? null,
            clientMatches,
            message: ambiguousStaff
              ? staffMatches.length === 0
                ? `No active staff matched ${input.staffName}.`
                : `More than one staff member matched ${input.staffName}.`
              : clientMatches.length === 0
                ? `No client matched ${input.clientCode}.`
                : `More than one client matched ${input.clientCode}.`,
          };
        }

        if (assignments.length === 0) {
          return {
            locationId,
            date,
            scheduleAvailable: false,
            assignmentCount: 0,
            requiredClientSlots,
            needsClarification: false,
            resolvedStaffName,
            resolvedClientCode,
            requestedRange: {
              startTime: input.startTime ?? null,
              endTime: input.endTime ?? null,
            },
            count: 0,
            segments: [],
            assignments: [],
            freeStaff: [],
            message: `The schedule has not been generated for ${date}.`,
          };
        }

        const includeBreaks = input.includeBreaks !== false;
        const filtered = enriched.filter((assignment) => {
          if (resolvedStaffId && assignment.staffId !== resolvedStaffId) return false;
          if (resolvedClientId && assignment.clientId !== resolvedClientId) return false;
          if (!overlapsRange(assignment, input.startTime, input.endTime)) return false;
          if (!includeBreaks && NON_CLIENT_TYPES.has(assignment.assignmentType)) return false;
          return true;
        });

        const result: Record<string, unknown> = {
          locationId,
          date,
          scheduleAvailable: true,
          assignmentCount: assignments.length,
          requiredClientSlots,
          needsClarification: false,
          resolvedStaffName,
          resolvedClientCode,
          requestedRange: {
            startTime: input.startTime ?? null,
            endTime: input.endTime ?? null,
          },
          count: filtered.length,
          segments: mergeSegments(filtered),
          assignments: filtered,
        };

        if (input.includeFreeStaff) {
          const allAvailableSlots = Array.from(
            new Set(dayData.staff.flatMap((member) => member.availableSlots))
          ).sort();
          const rangeSlots = new Set(
            allAvailableSlots.filter((slot) => {
              if (input.startTime && slot < input.startTime) return false;
              if (input.endTime && slot >= input.endTime) return false;
              return true;
            })
          );
          const freeStaff = dayData.staff.map((member) => {
            const scheduledSlots = new Set(
              enriched
                .filter((assignment) => assignment.staffId === member.id)
                .map((assignment) => assignment.startTime)
            );
            const freeSlots = member.availableSlots.filter(
              (slot) => rangeSlots.has(slot) && !scheduledSlots.has(slot)
            );
            const requestedAvailableSlots = member.availableSlots.filter((slot) => rangeSlots.has(slot));
            return {
              id: member.id,
              name: member.name,
              freeSlots,
              freeForEntireRequestedRange:
                rangeSlots.size > 0 &&
                requestedAvailableSlots.length === rangeSlots.size &&
                freeSlots.length === rangeSlots.size,
            };
          });
          result.freeStaff = freeStaff;
        }

        return result;
      },
    }),

    get_day_schedule: tool({
      description:
        "Read all saved assignments for the currently selected scheduler location and date and report whether a generated schedule is available. Use this for broad day questions, comparisons, locked/manual blocks, naps, speech, or when lookup_schedule is too narrow.",
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
        const enriched = enrichAssignments(assignments, staffNames, clientCodes);

        return {
          locationId,
          date,
          scheduleAvailable: assignments.length > 0,
          requiredClientSlots: dayData.clients.reduce(
            (total, client) => total + client.requiredSlots.length,
            0
          ),
          assignmentCount: assignments.length,
          assignments: enriched,
          segments: mergeSegments(enriched),
        };
      },
    }),

    get_staff: tool({
      description:
        "Read active scheduler staff, their availability, current scheduled client workload, and required-break status for the selected day. Use this for questions such as who is available, who is called out, workload, or who is missing a break. For time-slot availability on the generated calendar, prefer lookup_schedule with includeFreeStaff=true.",
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
          scheduleAvailable: assignments.length > 0,
          assignmentCount: assignments.length,
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
          scheduleAvailable: assignments.length > 0,
          assignmentCount: assignments.length,
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
