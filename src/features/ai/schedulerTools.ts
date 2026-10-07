import { jsonSchema, tool } from "./schedulerToolDefinition";

import { calculateSchedulerReadiness } from "@/features/scheduler/engine/preflight";
import { buildDaySchedulerInput } from "@/features/scheduler/server/buildDaySchedulerInput";
import { connectToDatabase } from "@/lib/db";
import { Client } from "@/models/Client";
import { ScheduleAssignment } from "@/models/ScheduleAssignment";
import { Staff } from "@/models/Staff";
import { UnplacedAssignment } from "@/models/UnplacedAssignment";

import { matchEntityReference } from "./entityReference";
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

function dateText(value: unknown): string | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function profileRangeText(record: DatabaseRecord): string {
  const start = dateText(record.startDate);
  const end = dateText(record.endDate);
  if (start && end) return "active " + start + " through " + end;
  if (start) return "active starting " + start;
  return "active date range is not configured";
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
        "Answer detailed questions about the selected day's schedule by staff name, client display code or client full name, and/or time range. Profile matching is separate from selected-day eligibility so the tool can explain when a real staff/client profile exists but is not schedulable on that date.",
      inputSchema: scheduleLookupSchema,
      execute: async (input) => {
        await connectToDatabase();

        const [dayData, assignments, rawStaffProfiles, rawClientProfiles] =
          await Promise.all([
            buildDaySchedulerInput(locationId, date),
            loadAssignments(locationId, date),
            Staff.find({ locationId, active: true })
              .select("_id fullName role startDate endDate shiftPatterns")
              .sort({ fullName: 1 })
              .lean(),
            Client.find({ locationId, active: true })
              .select(
                "_id fullName displayCode startDate endDate attendancePatterns"
              )
              .sort({ displayCode: 1 })
              .lean(),
          ]);

        const staffProfiles =
          rawStaffProfiles as unknown as DatabaseRecord[];
        const clientProfiles =
          rawClientProfiles as unknown as DatabaseRecord[];

        const staffNames = new Map(
          staffProfiles.map((record) => [
            String(record._id),
            String(record.fullName ?? ""),
          ])
        );
        const clientCodes = new Map(
          clientProfiles.map((record) => [
            String(record._id),
            String(record.displayCode ?? ""),
          ])
        );
        const enriched = enrichAssignments(
          assignments,
          staffNames,
          clientCodes
        );

        const dayStaffById = new Map(
          dayData.staff.map((member) => [member.id, member])
        );
        const dayClientById = new Map(
          dayData.clients.map((client) => [client.id, client])
        );
        const requiredClientSlots = dayData.clients.reduce(
          (total, client) => total + client.requiredSlots.length,
          0
        );

        let resolvedStaffId: string | null = null;
        let resolvedStaffName: string | null = null;
        let resolvedStaffProfile: DatabaseRecord | null = null;
        let staffMatches: Array<{ id: string; name: string }> = [];

        if (input.staffName?.trim()) {
          const matched = matchEntityReference(
            input.staffName,
            staffProfiles.map((record) => ({
              record,
              labels: [String(record.fullName ?? "")],
            }))
          );

          if (matched.status === "MATCH") {
            resolvedStaffProfile = matched.record;
            resolvedStaffId = String(matched.record._id);
            resolvedStaffName = String(matched.record.fullName ?? "");
            staffMatches = [
              { id: resolvedStaffId, name: resolvedStaffName },
            ];
          } else if (matched.status === "AMBIGUOUS") {
            staffMatches = matched.records.map((record) => ({
              id: String(record._id),
              name: String(record.fullName ?? ""),
            }));
            return {
              locationId,
              date,
              scheduleAvailable: assignments.length > 0,
              assignmentCount: assignments.length,
              requiredClientSlots,
              needsClarification: true,
              staffQuery: input.staffName,
              staffMatches,
              message:
                'More than one active staff profile matched "' +
                input.staffName +
                '".',
            };
          } else {
            return {
              locationId,
              date,
              scheduleAvailable: assignments.length > 0,
              assignmentCount: assignments.length,
              requiredClientSlots,
              needsClarification: true,
              staffQuery: input.staffName,
              staffMatches: [],
              suggestions: matched.suggestions,
              message:
                'No active staff profile matched "' +
                input.staffName +
                '"' +
                (matched.suggestions.length
                  ? ". Did you mean " + matched.suggestions.join(", ") + "?"
                  : "."),
            };
          }
        }

        let resolvedClientId: string | null = null;
        let resolvedClientCode: string | null = null;
        let resolvedClientName: string | null = null;
        let resolvedClientProfile: DatabaseRecord | null = null;
        let clientMatches: Array<{
          id: string;
          displayCode: string;
          fullName: string;
        }> = [];

        if (input.clientCode?.trim()) {
          const matched = matchEntityReference(
            input.clientCode,
            clientProfiles.map((record) => ({
              record,
              labels: [
                String(record.displayCode ?? ""),
                String(record.fullName ?? ""),
              ],
            }))
          );

          if (matched.status === "MATCH") {
            resolvedClientProfile = matched.record;
            resolvedClientId = String(matched.record._id);
            resolvedClientCode = String(matched.record.displayCode ?? "");
            resolvedClientName = String(matched.record.fullName ?? "");
            clientMatches = [
              {
                id: resolvedClientId,
                displayCode: resolvedClientCode,
                fullName: resolvedClientName,
              },
            ];
          } else if (matched.status === "AMBIGUOUS") {
            clientMatches = matched.records.map((record) => ({
              id: String(record._id),
              displayCode: String(record.displayCode ?? ""),
              fullName: String(record.fullName ?? ""),
            }));
            return {
              locationId,
              date,
              scheduleAvailable: assignments.length > 0,
              assignmentCount: assignments.length,
              requiredClientSlots,
              needsClarification: true,
              clientQuery: input.clientCode,
              clientMatches,
              message:
                'More than one active client profile matched "' +
                input.clientCode +
                '".',
            };
          } else {
            return {
              locationId,
              date,
              scheduleAvailable: assignments.length > 0,
              assignmentCount: assignments.length,
              requiredClientSlots,
              needsClarification: true,
              clientQuery: input.clientCode,
              clientMatches: [],
              suggestions: matched.suggestions,
              message:
                'No active client profile matched "' +
                input.clientCode +
                '"' +
                (matched.suggestions.length
                  ? ". Did you mean " + matched.suggestions.join(", ") + "?"
                  : "."),
            };
          }
        }

        if (
          resolvedStaffId &&
          resolvedStaffProfile &&
          !dayStaffById.has(resolvedStaffId)
        ) {
          return {
            locationId,
            date,
            scheduleAvailable: assignments.length > 0,
            assignmentCount: assignments.length,
            requiredClientSlots,
            needsClarification: false,
            profileFound: true,
            profileType: "STAFF",
            resolvedStaffName,
            profileStatus: "OUTSIDE_SELECTED_DATE",
            message:
              "Staff profile " +
              resolvedStaffName +
              " exists, but it is not active on " +
              date +
              " (" +
              profileRangeText(resolvedStaffProfile) +
              ").",
          };
        }

        if (
          resolvedClientId &&
          resolvedClientProfile &&
          !dayClientById.has(resolvedClientId)
        ) {
          return {
            locationId,
            date,
            scheduleAvailable: assignments.length > 0,
            assignmentCount: assignments.length,
            requiredClientSlots,
            needsClarification: false,
            profileFound: true,
            profileType: "CLIENT",
            resolvedClientCode,
            resolvedClientName,
            profileStatus: "OUTSIDE_SELECTED_DATE",
            message:
              "Client profile " +
              resolvedClientCode +
              " (" +
              resolvedClientName +
              ") exists, but it is not active on " +
              date +
              " (" +
              profileRangeText(resolvedClientProfile) +
              ").",
          };
        }

        const includeBreaks = input.includeBreaks !== false;
        const filtered = enriched.filter((assignment) => {
          if (
            resolvedStaffId &&
            assignment.staffId !== resolvedStaffId
          ) {
            return false;
          }
          if (
            resolvedClientId &&
            assignment.clientId !== resolvedClientId
          ) {
            return false;
          }
          if (
            !overlapsRange(
              assignment,
              input.startTime,
              input.endTime
            )
          ) {
            return false;
          }
          if (
            !includeBreaks &&
            NON_CLIENT_TYPES.has(assignment.assignmentType)
          ) {
            return false;
          }
          return true;
        });

        const selectedDayStaff = resolvedStaffId
          ? dayStaffById.get(resolvedStaffId)
          : null;
        const selectedDayClient = resolvedClientId
          ? dayClientById.get(resolvedClientId)
          : null;

        let statusMessage: string | null = null;
        let profileStatus: string | null = null;

        if (
          selectedDayStaff &&
          selectedDayStaff.availableSlots.length === 0 &&
          filtered.length === 0
        ) {
          const calledOut =
            dayData.input.callOutStaffIds.includes(selectedDayStaff.id);
          profileStatus = calledOut
            ? "CALLED_OUT"
            : "NO_WORKING_SHIFT";
          statusMessage = calledOut
            ? "Staff profile " +
              selectedDayStaff.name +
              " exists and is active for " +
              date +
              ", but the staff member is called out for the full scheduler day."
            : "Staff profile " +
              selectedDayStaff.name +
              " exists and is active for " +
              date +
              ", but no working shift/availability applies on that day.";
        }

        if (
          selectedDayClient &&
          selectedDayClient.requiredSlots.length === 0 &&
          filtered.length === 0
        ) {
          profileStatus = "NO_ATTENDANCE_REQUIREMENT";
          statusMessage =
            "Client profile " +
            selectedDayClient.displayCode +
            (resolvedClientName
              ? " (" + resolvedClientName + ")"
              : "") +
            " exists and is active for " +
            date +
            ", but it has no 1:1 attendance/coverage requirement on that day.";
        }

        if (assignments.length === 0 && !statusMessage) {
          statusMessage =
            "The schedule has not been generated for " + date + ".";
        }

        const result: Record<string, unknown> = {
          locationId,
          date,
          scheduleAvailable: assignments.length > 0,
          assignmentCount: assignments.length,
          requiredClientSlots,
          needsClarification: false,
          profileFound: Boolean(
            resolvedStaffProfile || resolvedClientProfile
          ),
          profileStatus,
          resolvedStaffName,
          resolvedClientCode,
          resolvedClientName,
          requestedRange: {
            startTime: input.startTime ?? null,
            endTime: input.endTime ?? null,
          },
          count: filtered.length,
          segments: mergeSegments(filtered),
          assignments: filtered,
          message: statusMessage,
        };

        if (input.includeFreeStaff) {
          const allAvailableSlots = Array.from(
            new Set(
              dayData.staff.flatMap(
                (member) => member.availableSlots
              )
            )
          ).sort();
          const rangeSlots = new Set(
            allAvailableSlots.filter((slot) => {
              if (
                input.startTime &&
                slot < input.startTime
              ) {
                return false;
              }
              if (
                input.endTime &&
                slot >= input.endTime
              ) {
                return false;
              }
              return true;
            })
          );
          result.freeStaff = dayData.staff.map((member) => {
            const scheduledSlots = new Set(
              enriched
                .filter(
                  (assignment) =>
                    assignment.staffId === member.id
                )
                .map(
                  (assignment) => assignment.startTime
                )
            );
            const freeSlots = member.availableSlots.filter(
              (slot) =>
                rangeSlots.has(slot) &&
                !scheduledSlots.has(slot)
            );
            const requestedAvailableSlots =
              member.availableSlots.filter((slot) =>
                rangeSlots.has(slot)
              );
            return {
              id: member.id,
              name: member.name,
              freeSlots,
              freeForEntireRequestedRange:
                rangeSlots.size > 0 &&
                requestedAvailableSlots.length ===
                  rangeSlots.size &&
                freeSlots.length === rangeSlots.size,
            };
          });
        }

        return result;
      },
    }),

    get_day_schedule: tool({
      description:
        "Read all saved assignments for the currently selected scheduler location and date and report whether a generated schedule is available. Use this for broad day questions, comparisons, locked/manual blocks, naps, speech, or when lookup_schedule is too narrow.",
      inputSchema: noInputSchema,
      execute: async () => {
        const [dayData, assignments, savedDates] = await Promise.all([
          buildDaySchedulerInput(locationId, date),
          loadAssignments(locationId, date),
          ScheduleAssignment.distinct("date", { locationId }),
        ]);

        const recentSavedScheduleDates = (savedDates as string[])
          .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
          .sort((left, right) => right.localeCompare(left))
          .slice(0, 8);

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
          recentSavedScheduleDates,
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
        const [dayData, assignments, activeProfileCount, totalProfileCount] =
          await Promise.all([
            buildDaySchedulerInput(locationId, date),
            loadAssignments(locationId, date),
            Staff.countDocuments({ locationId, active: true }),
            Staff.countDocuments({ locationId }),
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
          totalProfileCount,
          activeProfileCount,
          activeOnSelectedDateCount: dayData.staff.length,
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
