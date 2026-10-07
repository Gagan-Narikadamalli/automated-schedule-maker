import { jsonSchema, tool } from "./schedulerToolDefinition";

import { PUT as updateScheduleBatch } from "@/app/api/schedule/batch/route";
import { POST as copyScheduleDay } from "@/app/api/schedule/copy/route";
import { POST as generateScheduleDay } from "@/app/api/schedule/generate/route";
import { POST as generateScheduleRange } from "@/app/api/schedule/generate-range/route";
import { POST as repairScheduleDay } from "@/app/api/schedule/repair/route";
import { POST as saveCallOut } from "@/app/api/call-outs/route";
import { PATCH as resolveUnplacedAssignment, POST as createUnplacedAssignment } from "@/app/api/unplaced/route";
import { writeAuditLog } from "@/lib/api/audit";
import { connectToDatabase } from "@/lib/db";
import { CallOut } from "@/models/CallOut";
import { Client } from "@/models/Client";
import { ScheduleAssignment } from "@/models/ScheduleAssignment";
import { Staff } from "@/models/Staff";

import { matchEntityReference } from "./entityReference";
import type { SchedulerAiContext } from "./types";

type JsonRecord = Record<string, any>;

type GenerateInput = {
  scope: "DAY" | "WORK_WEEK";
};

type CopyInput = {
  sourceDate: string;
};

type RepairInput = Record<string, never>;

type CallOutInput = {
  action: "ADD" | "REMOVE";
  staff: string;
  startTime?: string;
  endTime?: string;
  reason?: string;
  note?: string;
};

type CellEdit = {
  action: "SET" | "CLEAR";
  staff: string;
  startTime: string;
  assignmentType?:
    | "CLIENT_1_TO_1"
    | "BREAK"
    | "BREAK_NAP"
    | "BREAK_SPEECH"
    | "NAP"
    | "SPEECH"
    | "UNAVAILABLE"
    | "OPEN";
  client?: string;
  text?: string;
  unplacedId?: string;
};

type EditCellsInput = {
  changes: CellEdit[];
  allowLockedOverride?: boolean;
  allowRuleOverride?: boolean;
};

const generateSchema = jsonSchema<GenerateInput>({
  type: "object",
  properties: {
    scope: {
      type: "string",
      enum: ["DAY", "WORK_WEEK"],
      description: "Generate only the selected day or the Monday-Friday work week containing the selected date.",
    },
  },
  required: ["scope"],
  additionalProperties: false,
});

const copySchema = jsonSchema<CopyInput>({
  type: "object",
  properties: {
    sourceDate: {
      type: "string",
      description: "YYYY-MM-DD source date to copy into the currently selected date.",
    },
  },
  required: ["sourceDate"],
  additionalProperties: false,
});

const noInputSchema = jsonSchema<RepairInput>({
  type: "object",
  properties: {},
  additionalProperties: false,
});

const callOutSchema = jsonSchema<CallOutInput>({
  type: "object",
  properties: {
    action: { type: "string", enum: ["ADD", "REMOVE"] },
    staff: {
      type: "string",
      description: "Staff ID or staff name. Exact names are preferred, but a unique partial name is accepted.",
    },
    startTime: { type: "string", description: "Optional HH:MM call-out start; defaults to 08:00." },
    endTime: { type: "string", description: "Optional HH:MM call-out end; defaults to 20:00." },
    reason: { type: "string" },
    note: { type: "string" },
  },
  required: ["action", "staff"],
  additionalProperties: false,
});

const editCellsSchema = jsonSchema<EditCellsInput>({
  type: "object",
  properties: {
    changes: {
      type: "array",
      minItems: 1,
      maxItems: 40,
      items: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["SET", "CLEAR"] },
          staff: { type: "string", description: "Staff ID or unique staff name." },
          startTime: { type: "string", description: "HH:MM 30-minute schedule slot." },
          assignmentType: {
            type: "string",
            enum: [
              "CLIENT_1_TO_1",
              "BREAK",
              "BREAK_NAP",
              "BREAK_SPEECH",
              "NAP",
              "SPEECH",
              "UNAVAILABLE",
              "OPEN",
            ],
          },
          client: {
            type: "string",
            description: "Client ID, display code, or unique client name. Required for CLIENT_1_TO_1.",
          },
          text: { type: "string", description: "Short audit/note text describing the intended cell content." },
          unplacedId: {
            type: "string",
            description: "Optional unresolved tray record ID to mark resolved after this placement succeeds.",
          },
        },
        required: ["action", "staff", "startTime"],
        additionalProperties: false,
      },
    },
    allowLockedOverride: {
      type: "boolean",
      description: "Only true when the user explicitly asked to replace/delete a locked or manual cell.",
    },
    allowRuleOverride: {
      type: "boolean",
      description: "Only true when the user explicitly asked to override scheduler conflicts. Never bypass invalid clients.",
    },
  },
  required: ["changes"],
  additionalProperties: false,
});

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getWorkWeek(dateText: string): { startDate: string; endDate: string } {
  const date = new Date(`${dateText}T12:00:00`);
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + offset);
  const startDate = formatLocalDate(date);
  const end = new Date(date);
  end.setDate(end.getDate() + 4);
  return { startDate, endDate: formatLocalDate(end) };
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
  return {
    ok: response.ok,
    status: response.status,
    ...data,
  };
}

async function resolveStaff(locationId: string, reference: string): Promise<JsonRecord> {
  await connectToDatabase();
  const value = reference.trim();
  if (!value) throw new Error("A staff member is required.");

  if (/^[a-f0-9]{24}$/i.test(value)) {
    const byId = await Staff.findOne({ _id: value, locationId, active: true })
      .select("_id fullName role")
      .lean();
    if (byId) return byId as unknown as JsonRecord;
  }

  const candidates = (await Staff.find({ locationId, active: true })
    .select("_id fullName role")
    .limit(250)
    .lean()) as unknown as JsonRecord[];
  const matched = matchEntityReference(
    value,
    candidates.map((record) => ({
      record,
      labels: [String(record.fullName ?? "")],
    }))
  );

  if (matched.status === "MATCH") return matched.record;
  if (matched.status === "AMBIGUOUS") {
    throw new Error(
      `Staff reference "${value}" is ambiguous. Did you mean ${matched.suggestions.join(", ")}?`
    );
  }

  throw new Error(
    matched.suggestions.length > 0
      ? `No active staff member matched "${value}". Did you mean ${matched.suggestions.join(", ")}?`
      : `No active staff member matched "${value}" at this clinic.`
  );
}

async function resolveClient(locationId: string, reference: string): Promise<JsonRecord> {
  await connectToDatabase();
  const value = reference.trim();
  if (!value) throw new Error("A client is required for a 1:1 assignment.");

  if (/^[a-f0-9]{24}$/i.test(value)) {
    const byId = await Client.findOne({ _id: value, locationId, active: true })
      .select("_id displayCode fullName")
      .lean();
    if (byId) return byId as unknown as JsonRecord;
  }

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

function assignmentClientId(record: JsonRecord | null | undefined): string | null {
  return record?.clientId ? String(record.clientId) : null;
}

function assignmentIsProtected(record: JsonRecord | null | undefined): boolean {
  if (!record) return false;
  return (
    record.locked === true ||
    record.manuallyOverridden === true ||
    record.source === "MANUAL"
  );
}

export const SCHEDULER_WRITE_TOOL_NAMES = new Set([
  "generate_schedule",
  "repair_schedule",
  "copy_schedule_day",
  "record_call_out",
  "edit_schedule_cells",
]);

export function createSchedulerWriteTools(context: SchedulerAiContext) {
  const { locationId, date, userId } = context;

  return {
    generate_schedule: tool({
      description:
        "Generate the selected day or its Monday-Friday work week using the existing deterministic scheduler engine. Manual/locked assignments are preserved by the scheduler. Use when the user asks to generate, regenerate, auto-fill, build, or optimize the schedule.",
      inputSchema: generateSchema,
      execute: async ({ scope }) => {
        if (scope === "WORK_WEEK") {
          const { startDate, endDate } = getWorkWeek(date);
          return invokeJson(generateScheduleRange, "POST", {
            locationId,
            startDate,
            endDate,
          });
        }
        return invokeJson(generateScheduleDay, "POST", { locationId, date });
      },
    }),

    repair_schedule: tool({
      description:
        "Run the autonomous Minimal Fix for the selected date. Use for requests such as 'fix the schedule', 'cover the uncovered blocks', or 'make sure all clients are covered'. Existing Unplaced assignments are first priority, then other uncovered client requirements. It preserves working assignments when possible, but the user's Minimal Fix request authorizes the smallest necessary automatic relocation/override of existing schedule blocks, including protected/manual client blocks, and then it recalculates eligible staff breaks. It does not ask for a separate override confirmation. Hard eligibility/attendance/restriction constraints still apply. Staff call-out recording uses its own targeted repair path.",
      inputSchema: noInputSchema,
      execute: async () =>
        invokeJson(repairScheduleDay, "POST", {
          locationId,
          date,
          mode: "COVERAGE",
        }),
    }),

    copy_schedule_day: tool({
      description:
        "Copy another saved schedule day into the selected date and revalidate it against the selected date's staff/client constraints. Manual target-date assignments remain protected.",
      inputSchema: copySchema,
      execute: async ({ sourceDate }) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate)) {
          return { ok: false, error: "Source date must use YYYY-MM-DD format." };
        }
        return invokeJson(copyScheduleDay, "POST", {
          locationId,
          sourceDate,
          targetDate: date,
        });
      },
    }),

    record_call_out: tool({
      description:
        "Add/update or remove a staff call-out for the selected date. Adding a call-out automatically runs targeted repair. Removing a call-out regenerates the selected day so coverage can be restored while preserving manual/locked cells.",
      inputSchema: callOutSchema,
      execute: async ({ action, staff, startTime, endTime, reason, note }) => {
        const staffMember = await resolveStaff(locationId, staff);
        const staffId = String(staffMember._id);
        const staffName = String(staffMember.fullName ?? staff);

        if (action === "ADD") {
          const saved = await invokeJson(saveCallOut, "POST", {
            locationId,
            staffId,
            date,
            startTime: startTime || "08:00",
            endTime: endTime || "20:00",
            reason: reason?.trim() || "Call out",
            note: note?.trim() || "Recorded by Scheduler AI",
          });
          if (!saved.ok) return saved;
          const repair = await invokeJson(repairScheduleDay, "POST", {
            locationId,
            date,
          });
          return {
            ok: repair.ok,
            action: "ADD",
            staffId,
            staffName,
            callOut: saved.callOut ?? null,
            repair,
          };
        }

        await connectToDatabase();
        const existing = await CallOut.findOne({ locationId, date, staffId }).lean();
        if (!existing) {
          return {
            ok: true,
            action: "REMOVE",
            staffId,
            staffName,
            removed: false,
            message: "No saved call-out existed for this staff member on the selected date.",
          };
        }

        await CallOut.deleteMany({ locationId, date, staffId });
        await writeAuditLog({
          locationId,
          userId,
          action: "DELETE",
          entityType: "CALL_OUT",
          entityId: String((existing as JsonRecord)._id),
          summary: `Scheduler AI removed the call-out for ${staffName} on ${date}.`,
          before: existing as unknown as JsonRecord,
          after: null,
        });
        const regenerated = await invokeJson(generateScheduleDay, "POST", {
          locationId,
          date,
        });
        return {
          ok: regenerated.ok,
          action: "REMOVE",
          staffId,
          staffName,
          removed: true,
          regenerated,
        };
      },
    }),

    edit_schedule_cells: tool({
      description:
        "Set, move, replace, or clear one or more 30-minute schedule cells on the selected date. Staff and clients may be referenced by IDs or human-readable names/codes. By default this refuses to alter locked/manual cells and refuses scheduler-rule conflicts. Only enable override flags when the user explicitly asked for that override.",
      inputSchema: editCellsSchema,
      execute: async ({ changes, allowLockedOverride = false, allowRuleOverride = false }) => {
        if (!Array.isArray(changes) || changes.length === 0 || changes.length > 40) {
          return { ok: false, error: "Between 1 and 40 schedule cell changes are required." };
        }

        const normalized: Array<{
          input: CellEdit;
          staffId: string;
          staffName: string;
          startTime: string;
          assignmentType: string;
          clientId: string | null;
          clientCode: string | null;
          text: string;
        }> = [];

        for (const change of changes) {
          if (!/^\d{2}:\d{2}$/.test(change.startTime)) {
            return { ok: false, error: `Invalid start time ${change.startTime}. Use HH:MM.` };
          }
          const staffMember = await resolveStaff(locationId, change.staff);
          const assignmentType = change.action === "CLEAR" ? "EMPTY" : change.assignmentType;
          if (!assignmentType) {
            return { ok: false, error: "SET changes require assignmentType." };
          }

          let clientId: string | null = null;
          let clientCode: string | null = null;
          if (assignmentType === "CLIENT_1_TO_1") {
            if (!change.client?.trim()) {
              return { ok: false, error: "CLIENT_1_TO_1 changes require a client reference." };
            }
            const client = await resolveClient(locationId, change.client);
            clientId = String(client._id);
            clientCode = String(client.displayCode ?? "");
          }

          normalized.push({
            input: change,
            staffId: String(staffMember._id),
            staffName: String(staffMember.fullName ?? change.staff),
            startTime: change.startTime,
            assignmentType,
            clientId,
            clientCode,
            text:
              change.text?.trim() ||
              (assignmentType === "CLIENT_1_TO_1" && clientCode
                ? `${clientCode} 1:1`
                : assignmentType === "EMPTY"
                  ? ""
                  : assignmentType.replaceAll("_", " ")),
          });
        }

        await connectToDatabase();
        const existingRecords = (await ScheduleAssignment.find({
          locationId,
          date,
          $or: normalized.map((change) => ({
            staffId: change.staffId,
            startTime: change.startTime,
          })),
        }).lean()) as unknown as JsonRecord[];
        const existingByCell = new Map(
          existingRecords.map((record) => [
            `${String(record.staffId)}:${String(record.startTime)}`,
            record,
          ])
        );

        const protectedConflicts = normalized.flatMap((change) => {
          const existing = existingByCell.get(`${change.staffId}:${change.startTime}`);
          if (!assignmentIsProtected(existing)) return [];
          const existingClientId = assignmentClientId(existing);
          const sameContent =
            existing?.assignmentType === change.assignmentType &&
            existingClientId === change.clientId;
          if (sameContent) return [];
          return [
            {
              staffName: change.staffName,
              startTime: change.startTime,
              assignmentType: String(existing?.assignmentType ?? ""),
            },
          ];
        });

        if (protectedConflicts.length > 0 && !allowLockedOverride) {
          return {
            ok: false,
            requiresLockedOverride: true,
            error:
              "The requested change touches locked/manual schedule cells. The user must explicitly ask to override those protected cells.",
            protectedConflicts,
          };
        }

        const result = await invokeJson(updateScheduleBatch, "PUT", {
          locationId,
          date,
          force: allowRuleOverride,
          changes: normalized.map((change) => ({
            staffId: change.staffId,
            startTime: change.startTime,
            assignmentType: change.assignmentType,
            text: change.text,
            clientId: change.clientId,
          })),
        });

        if (!result.ok) return result;

        const placedClientIds = new Set(
          normalized
            .filter((change) => change.assignmentType === "CLIENT_1_TO_1" && change.clientId)
            .map((change) => change.clientId as string)
        );

        for (const change of normalized) {
          const existing = existingByCell.get(`${change.staffId}:${change.startTime}`);
          const displacedClientId =
            existing?.assignmentType === "CLIENT_1_TO_1"
              ? assignmentClientId(existing)
              : null;
          const sameClientRemains =
            change.assignmentType === "CLIENT_1_TO_1" &&
            change.clientId === displacedClientId;

          if (
            displacedClientId &&
            !sameClientRemains &&
            !placedClientIds.has(displacedClientId)
          ) {
            const displacedClient = await Client.findById(displacedClientId)
              .select("displayCode")
              .lean();
            const displayCode = displacedClient
              ? String((displacedClient as unknown as JsonRecord).displayCode ?? "Client")
              : "Client";
            await invokeJson(createUnplacedAssignment, "POST", {
              locationId,
              date,
              clientId: displacedClientId,
              displayText: `${displayCode} 1:1`,
              originalStaffId: change.staffId,
              originalStartTime: change.startTime,
              reason: "Displaced by an autonomous Scheduler AI change.",
            });
          }

          if (change.input.unplacedId) {
            await invokeJson(resolveUnplacedAssignment, "PATCH", {
              locationId,
              unplacedId: change.input.unplacedId,
            });
          }
        }

        return {
          ...result,
          changedCells: normalized.map((change) => ({
            staffId: change.staffId,
            staffName: change.staffName,
            startTime: change.startTime,
            assignmentType: change.assignmentType,
            clientCode: change.clientCode,
          })),
        };
      },
    }),
  };
}
