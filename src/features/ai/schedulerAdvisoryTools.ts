import { jsonSchema, tool } from "ai";

import { buildDaySchedulerInput } from "@/features/scheduler/server/buildDaySchedulerInput";
import { connectToDatabase } from "@/lib/db";
import { Client } from "@/models/Client";
import { ScheduleAssignment } from "@/models/ScheduleAssignment";

import { matchEntityReference } from "./entityReference";
import type { SchedulerAiContext } from "./types";

type JsonRecord = Record<string, any>;

type ReplacementInput = {
  sourceClient: string;
  replacementClient: string;
  startTime?: string;
  endTime?: string;
};

type SuggestionInput = {
  focus?: "ALL" | "COVERAGE" | "BREAKS";
  startTime?: string;
  endTime?: string;
};

const replacementSchema = jsonSchema<ReplacementInput>({
  type: "object",
  properties: {
    sourceClient: {
      type: "string",
      description: "The client currently shown in schedule cells, using display code or unique name.",
    },
    replacementClient: {
      type: "string",
      description: "The client the user wants to put into those schedule cells, using display code or unique name.",
    },
    startTime: {
      type: "string",
      description: "Optional HH:MM lower bound for the replacement analysis.",
    },
    endTime: {
      type: "string",
      description: "Optional HH:MM upper bound for the replacement analysis.",
    },
  },
  required: ["sourceClient", "replacementClient"],
  additionalProperties: false,
});

const suggestionSchema = jsonSchema<SuggestionInput>({
  type: "object",
  properties: {
    focus: {
      type: "string",
      enum: ["ALL", "COVERAGE", "BREAKS"],
      description: "Whether to focus suggestions on coverage, breaks, or both. Defaults to ALL.",
    },
    startTime: {
      type: "string",
      description: "Optional HH:MM lower bound for suggestions.",
    },
    endTime: {
      type: "string",
      description: "Optional HH:MM upper bound for suggestions.",
    },
  },
  additionalProperties: false,
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function idFrom(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "object" && "_id" in (value as Record<string, unknown>)) {
    const id = (value as Record<string, unknown>)._id;
    return id ? String(id) : null;
  }
  return String(value);
}

function withinRange(startTime: string, start?: string, end?: string): boolean {
  if (start && startTime < start) return false;
  if (end && startTime >= end) return false;
  return true;
}

async function resolveClient(locationId: string, reference: string): Promise<JsonRecord> {
  await connectToDatabase();
  const value = reference.trim();
  if (!value) throw new Error("A client reference is required.");

  const candidates = (await Client.find({ locationId, active: true })
    .select("_id displayCode fullName")
    .limit(500)
    .lean()) as unknown as JsonRecord[];
  const matched = matchEntityReference(
    value,
    candidates.map((record) => ({
      record,
      labels: [
        String(record.displayCode ?? ""),
        String(record.fullName ?? ""),
      ],
    }))
  );

  if (matched.status === "MATCH") return matched.record;
  if (matched.status === "AMBIGUOUS") {
    throw new Error(
      `Client reference "${value}" is ambiguous. Did you mean ${matched.suggestions.join(", ")}?`
    );
  }

  throw new Error(
    matched.suggestions.length > 0
      ? `No active client matched "${value}". Did you mean ${matched.suggestions.join(", ")}?`
      : `No active client matched "${value}" at this clinic.`
  );
}

async function loadAssignments(locationId: string, date: string): Promise<JsonRecord[]> {
  await connectToDatabase();
  return (await ScheduleAssignment.find({ locationId, date })
    .select("staffId clientId startTime endTime assignmentType source locked manuallyOverridden")
    .sort({ startTime: 1 })
    .lean()) as unknown as JsonRecord[];
}

function assignmentMap(assignments: JsonRecord[]) {
  return new Map(
    assignments
      .filter((assignment) => assignment.staffId && assignment.startTime)
      .map((assignment) => [
        `${idFrom(assignment.staffId)}:${String(assignment.startTime)}`,
        assignment,
      ])
  );
}

function assignmentForClientAt(
  assignments: JsonRecord[],
  clientId: string,
  startTime: string
): JsonRecord | null {
  return (
    assignments.find(
      (assignment) =>
        assignment.assignmentType === "CLIENT_1_TO_1" &&
        idFrom(assignment.clientId) === clientId &&
        String(assignment.startTime) === startTime
    ) ?? null
  );
}

function clientCodeMap(dayData: Awaited<ReturnType<typeof buildDaySchedulerInput>>) {
  return new Map(dayData.clients.map((client) => [client.id, client.displayCode]));
}

function staffNameMap(dayData: Awaited<ReturnType<typeof buildDaySchedulerInput>>) {
  return new Map(dayData.staff.map((member) => [member.id, member.name]));
}

function uncoveredRequirements(
  dayData: Awaited<ReturnType<typeof buildDaySchedulerInput>>,
  assignments: JsonRecord[],
  startTime?: string,
  endTime?: string
) {
  const covered = new Set(
    assignments
      .filter((assignment) => assignment.assignmentType === "CLIENT_1_TO_1")
      .map(
        (assignment) =>
          `${idFrom(assignment.clientId)}:${String(assignment.startTime ?? "")}`
      )
  );

  return dayData.clients.flatMap((client) =>
    client.requiredSlots
      .filter((slot) => withinRange(slot, startTime, endTime))
      .filter((slot) => !covered.has(`${client.id}:${slot}`))
      .map((slot) => ({ client, startTime: slot }))
  );
}

function relationshipIsHardRestricted(
  client: Awaited<ReturnType<typeof buildDaySchedulerInput>>["clients"][number],
  staffId: string
): boolean {
  return client.staffRelationships?.[staffId] === "HARD_RESTRICTION";
}

function availableUnassignedStaff(
  dayData: Awaited<ReturnType<typeof buildDaySchedulerInput>>,
  assignmentsByCell: Map<string, JsonRecord>,
  startTime: string,
  client: Awaited<ReturnType<typeof buildDaySchedulerInput>>["clients"][number]
) {
  return dayData.staff.filter((member) => {
    if (dayData.input.callOutStaffIds.includes(member.id)) return false;
    if (!member.availableSlots.includes(startTime)) return false;
    if (assignmentsByCell.has(`${member.id}:${startTime}`)) return false;
    if (relationshipIsHardRestricted(client, member.id)) return false;
    return true;
  });
}

function breakTypes(type: unknown): boolean {
  return ["BREAK", "BREAK_NAP", "BREAK_SPEECH"].includes(String(type ?? ""));
}

export function createSchedulerAdvisoryTools(context: SchedulerAiContext) {
  const { locationId, date } = context;

  return {
    analyze_client_replacement: tool({
      description:
        "Analyze a requested client-for-client replacement before making any schedule edit. It compares both clients' day requirements and saved coverage, returns only directly replaceable source slots, explains blocked slots, and reports that replacing a source client's block may uncover that source client. Use this BEFORE any request like replace CaMe with ZiBo. Do not edit in the same turn unless the user already confirmed a previously presented replacement plan.",
      inputSchema: replacementSchema,
      execute: async ({ sourceClient, replacementClient, startTime, endTime }) => {
        const [sourceProfile, replacementProfile, dayData, assignments] = await Promise.all([
          resolveClient(locationId, sourceClient),
          resolveClient(locationId, replacementClient),
          buildDaySchedulerInput(locationId, date),
          loadAssignments(locationId, date),
        ]);

        const sourceId = String(sourceProfile._id);
        const replacementId = String(replacementProfile._id);
        const sourceDay = dayData.clients.find((client) => client.id === sourceId);
        const replacementDay = dayData.clients.find((client) => client.id === replacementId);

        if (!sourceDay || !replacementDay) {
          return {
            ok: false,
            date,
            error: "Both clients must be active/attending on the selected date before a replacement can be analyzed.",
          };
        }

        const staffNames = staffNameMap(dayData);
        const sourceAssignments = assignments.filter(
          (assignment) =>
            assignment.assignmentType === "CLIENT_1_TO_1" &&
            idFrom(assignment.clientId) === sourceId &&
            withinRange(String(assignment.startTime ?? ""), startTime, endTime)
        );

        const replacementRequired = new Set(replacementDay.requiredSlots);
        const sourceRequired = new Set(sourceDay.requiredSlots);
        const replaceable: JsonRecord[] = [];
        const blocked: JsonRecord[] = [];

        for (const assignment of sourceAssignments) {
          const slot = String(assignment.startTime ?? "");
          const staffId = idFrom(assignment.staffId);
          const staffName = staffId ? staffNames.get(staffId) ?? "Unknown staff" : "Unknown staff";
          const existingReplacement = assignmentForClientAt(assignments, replacementId, slot);

          if (!replacementRequired.has(slot)) {
            blocked.push({
              startTime: slot,
              staffName,
              reason: `${String(replacementProfile.displayCode)} does not require 1:1 coverage at this time (outside attendance or in a fixed event).`,
            });
            continue;
          }
          if (existingReplacement) {
            blocked.push({
              startTime: slot,
              staffName,
              reason: `${String(replacementProfile.displayCode)} already has coverage at this time.`,
            });
            continue;
          }
          if (staffId && relationshipIsHardRestricted(replacementDay, staffId)) {
            blocked.push({
              startTime: slot,
              staffName,
              reason: `${staffName} has a hard restriction with ${String(replacementProfile.displayCode)}.`,
            });
            continue;
          }

          replaceable.push({
            startTime: slot,
            endTime: String(assignment.endTime ?? ""),
            staffId,
            staffName,
            sourceClient: String(sourceProfile.displayCode),
            replacementClient: String(replacementProfile.displayCode),
            sourceWillBecomeUncovered: sourceRequired.has(slot),
            protectedCell:
              assignment.locked === true ||
              assignment.manuallyOverridden === true ||
              assignment.source === "MANUAL",
          });
        }

        return {
          ok: true,
          date,
          sourceClient: String(sourceProfile.displayCode),
          replacementClient: String(replacementProfile.displayCode),
          scheduleAvailable: assignments.length > 0,
          sourceCoverageSlotsChecked: sourceAssignments.length,
          replaceable,
          blocked,
          requiresUserConfirmation: replaceable.length > 0,
          warning:
            replaceable.some((slot) => slot.sourceWillBecomeUncovered === true)
              ? `Replacing these cells removes ${String(sourceProfile.displayCode)} from those same staff/time cells, so any required source coverage must be covered elsewhere or left Unplaced.`
              : null,
        };
      },
    }),

    suggest_schedule_improvements: tool({
      description:
        "Analyze the selected day and propose practical coverage and break improvements using broad scheduling judgment. Suggestions are advisory and may ignore soft clinic optimization preferences, but they do not pretend a change is valid. Actual edits must still go through scheduler tools, which enforce availability, attendance, restrictions, protected cells, and conflicts. Use when the user asks what the AI recommends, how to cover gaps, or how to fit breaks.",
      inputSchema: suggestionSchema,
      execute: async ({ focus = "ALL", startTime, endTime }) => {
        const [dayData, assignments] = await Promise.all([
          buildDaySchedulerInput(locationId, date),
          loadAssignments(locationId, date),
        ]);
        const byCell = assignmentMap(assignments);
        const staffNames = staffNameMap(dayData);
        const clientCodes = clientCodeMap(dayData);
        const uncovered = uncoveredRequirements(dayData, assignments, startTime, endTime);
        const coverageSuggestions: JsonRecord[] = [];

        if (focus !== "BREAKS") {
          for (const gap of uncovered) {
            const direct = availableUnassignedStaff(
              dayData,
              byCell,
              gap.startTime,
              gap.client
            );
            if (direct.length > 0) {
              coverageSuggestions.push({
                kind: "DIRECT_COVERAGE",
                clientCode: gap.client.displayCode,
                startTime: gap.startTime,
                recommendedStaff: direct.slice(0, 4).map((member) => member.name),
                rationale: "These staff are available and currently unassigned at this time. Soft optimization preferences were not required for this recommendation.",
              });
              continue;
            }

            const chainOptions: JsonRecord[] = [];
            for (const member of dayData.staff) {
              if (dayData.input.callOutStaffIds.includes(member.id)) continue;
              if (!member.availableSlots.includes(gap.startTime)) continue;
              if (relationshipIsHardRestricted(gap.client, member.id)) continue;

              const current = byCell.get(`${member.id}:${gap.startTime}`);
              if (!current || current.assignmentType !== "CLIENT_1_TO_1") continue;
              const currentClientId = idFrom(current.clientId);
              const currentClient = dayData.clients.find((client) => client.id === currentClientId);
              if (!currentClient) continue;

              const alternatives = availableUnassignedStaff(
                dayData,
                byCell,
                gap.startTime,
                currentClient
              ).filter((alternate) => alternate.id !== member.id);
              if (alternatives.length === 0) continue;

              chainOptions.push({
                moveClient: currentClient.displayCode,
                fromStaff: member.name,
                toStaff: alternatives[0].name,
                thenCoverClient: gap.client.displayCode,
                withStaff: member.name,
                startTime: gap.startTime,
              });
            }

            coverageSuggestions.push({
              kind: chainOptions.length > 0 ? "REASSIGNMENT_CHAIN" : "NO_SIMPLE_OPTION",
              clientCode: gap.client.displayCode,
              startTime: gap.startTime,
              options: chainOptions.slice(0, 4),
              rationale:
                chainOptions.length > 0
                  ? "No staff is completely free, but these two-step reassignments could preserve the currently covered client while filling the uncovered client."
                  : "No simple direct or two-step coverage option was found from the current availability and assignments.",
            });
          }
        }

        const breakSuggestions: JsonRecord[] = [];
        if (focus !== "COVERAGE") {
          const slotMinutes = dayData.extendedRules.slotLengthMinutes;
          const breakStart = dayData.extendedRules.breakWindowStart ?? "11:00";
          const breakEnd = dayData.extendedRules.breakWindowEnd ?? "14:00";

          for (const member of dayData.staff) {
            const availableHours = (member.availableSlots.length * slotMinutes) / 60;
            if (availableHours < dayData.extendedRules.breakEligibilityHours) continue;

            const memberAssignments = assignments.filter(
              (assignment) => idFrom(assignment.staffId) === member.id
            );
            if (memberAssignments.some((assignment) => breakTypes(assignment.assignmentType))) {
              continue;
            }

            const freeBreakSlots = member.availableSlots.filter(
              (slot) =>
                slot >= breakStart &&
                slot < breakEnd &&
                withinRange(slot, startTime, endTime) &&
                !byCell.has(`${member.id}:${slot}`)
            );
            if (freeBreakSlots.length > 0) {
              breakSuggestions.push({
                kind: "DIRECT_BREAK",
                staffName: member.name,
                startTime: freeBreakSlots[0],
                recommendation: `Add a ${slotMinutes}-minute break for ${member.name} at ${freeBreakSlots[0]}.`,
              });
              continue;
            }

            const replacementOptions: JsonRecord[] = [];
            for (const slot of member.availableSlots.filter(
              (candidate) =>
                candidate >= breakStart &&
                candidate < breakEnd &&
                withinRange(candidate, startTime, endTime)
            )) {
              const current = byCell.get(`${member.id}:${slot}`);
              if (!current || current.assignmentType !== "CLIENT_1_TO_1") continue;
              const currentClientId = idFrom(current.clientId);
              const currentClient = dayData.clients.find((client) => client.id === currentClientId);
              if (!currentClient) continue;

              const alternate = availableUnassignedStaff(
                dayData,
                byCell,
                slot,
                currentClient
              )[0];
              if (!alternate) continue;

              replacementOptions.push({
                startTime: slot,
                clientCode: clientCodes.get(currentClient.id) ?? currentClient.displayCode,
                moveFrom: member.name,
                moveTo: alternate.name,
                thenGiveBreakTo: member.name,
              });
            }

            breakSuggestions.push({
              kind: replacementOptions.length > 0 ? "REASSIGN_FOR_BREAK" : "NO_SIMPLE_BREAK_SLOT",
              staffName: member.name,
              options: replacementOptions.slice(0, 4),
              rationale:
                replacementOptions.length > 0
                  ? "The staff member has no free break-window slot, but these client handoffs could create one while keeping the client covered."
                  : "No simple free slot or one-step handoff was found for a break in the current break window.",
            });
          }
        }

        return {
          date,
          scheduleAvailable: assignments.length > 0,
          advisoryOnly: true,
          advisoryPolicy:
            "Recommendations use broad scheduling judgment and do not require every soft clinic optimization preference. Any actual edit must still be validated by the scheduler write tools. If validation reports an overridable conflict, the user must explicitly approve the override before retrying.",
          uncoveredCount: uncovered.length,
          coverageSuggestions,
          breakSuggestions,
        };
      },
    }),
  };
}
