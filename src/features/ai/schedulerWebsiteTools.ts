import { jsonSchema, tool } from "ai";

import { POST as saveClientAttendance, DELETE as deleteClientAttendance, GET as getClientAttendance } from "@/app/api/client-attendance/route";
import { POST as createClient } from "@/app/api/clients/route";
import { PATCH as updateClient } from "@/app/api/clients/[id]/route";
import { POST as createNapSession, DELETE as deleteNapSession, GET as getNapSessions } from "@/app/api/nap-sessions/route";
import { GET as getSchedulingRules, PUT as updateSchedulingRules } from "@/app/api/scheduling-rules/route";
import { POST as createSpeechSession, DELETE as deleteSpeechSession, GET as getSpeechSessions } from "@/app/api/speech-sessions/route";
import { POST as createStaff } from "@/app/api/staff/route";
import { PATCH as updateStaff } from "@/app/api/staff/[id]/route";
import { GET as getSupervision, POST as saveSupervision } from "@/app/api/supervision/route";
import { POST as createTeam } from "@/app/api/teams/route";
import { PATCH as updateTeam } from "@/app/api/teams/[id]/route";
import { connectToDatabase } from "@/lib/db";
import { Client } from "@/models/Client";
import { ClientAttendanceException } from "@/models/ClientAttendanceException";
import { NapSession } from "@/models/NapSession";
import { SpeechSession } from "@/models/SpeechSession";
import { Staff } from "@/models/Staff";
import { Team } from "@/models/Team";

import type { SchedulerAiContext } from "./types";

type JsonRecord = Record<string, any>;
type RouteHandler = (request: Request) => Promise<Response>;

type TimePattern = {
  name: string;
  days: string[];
  startTime: string;
  endTime: string;
};

type ShiftPattern = TimePattern;

type StaffInput = {
  action: "CREATE" | "UPDATE" | "ARCHIVE";
  staff?: string;
  fullName?: string;
  startDate?: string;
  endDate?: string | null;
  role?: "BT" | "RBT" | "INTERN" | "BCBA" | "OFFICE_MANAGER" | "OTHER";
  employeeType?: "FULL_TIME" | "PART_TIME";
  team?: string | null;
  color?: string;
  serviceSetting?: "IN_CENTER" | "IN_HOME" | "BOTH";
  minimumWeeklyHours?: number;
  targetWeeklyHours?: number;
  maximumWeeklyHours?: number;
  shiftPatterns?: ShiftPattern[];
};

type ClientInput = {
  action: "CREATE" | "UPDATE" | "ARCHIVE";
  client?: string;
  fullName?: string;
  displayCode?: string;
  startDate?: string;
  endDate?: string | null;
  team?: string | null;
  color?: string;
  serviceSetting?: "IN_CENTER" | "IN_HOME" | "BOTH";
  supportLevel?: "STANDARD" | "ONE_TO_ONE" | "ROTATION" | "HIGH_SUPPORT";
  maxConsecutiveBlocksWithSameStaff?: number | null;
  desiredDifferentStaffPerDay?: number | null;
  insurancePlan?: string;
  assignedBcba?: string | null;
  assignedInterns?: string[];
  attendancePatterns?: TimePattern[];
  napPatterns?: TimePattern[];
  staffRelationships?: Array<{
    staff: string;
    relationship: "PREFERRED" | "ALLOWED" | "HARD_RESTRICTION";
  }>;
};

type TeamInput = {
  action: "CREATE" | "UPDATE" | "ARCHIVE";
  team?: string;
  name?: string;
  color?: string;
};

type EventInput = {
  action: "ADD" | "REMOVE";
  eventType: "NAP" | "SPEECH";
  client?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  priorityCategory?: "YOUNGER" | "OLDER";
  recurringSeriesId?: string;
  seriesStartDate?: string;
  seriesEndDate?: string;
  daysOfWeek?: string[];
  sessionId?: string;
  note?: string;
};

type AttendanceInput = {
  action: "ADD" | "REMOVE";
  client: string;
  changeType?: "CALL_OUT" | "CALL_IN";
  startTime?: string;
  endTime?: string;
  note?: string;
  exceptionId?: string;
};

type SupervisionInput = {
  staff: string;
  supervisor?: string | null;
  month?: string;
  serviceHours: number;
  supervisionHours: number;
  note?: string;
};

type ConfigurationInput = {
  area: "PEOPLE" | "TEAMS" | "RULES" | "EVENTS" | "ATTENDANCE" | "SUPERVISION";
  month?: string;
};

const timePatternSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    days: { type: "array", items: { type: "string" } },
    startTime: { type: "string" },
    endTime: { type: "string" },
  },
  required: ["name", "days", "startTime", "endTime"],
  additionalProperties: false,
} as const;

const staffSchema = jsonSchema<StaffInput>({
  type: "object",
  properties: {
    action: { type: "string", enum: ["CREATE", "UPDATE", "ARCHIVE"] },
    staff: { type: "string", description: "Existing staff ID or unique staff name for UPDATE/ARCHIVE." },
    fullName: { type: "string" },
    startDate: { type: "string", description: "YYYY-MM-DD" },
    endDate: { type: ["string", "null"] },
    role: { type: "string", enum: ["BT", "RBT", "INTERN", "BCBA", "OFFICE_MANAGER", "OTHER"] },
    employeeType: { type: "string", enum: ["FULL_TIME", "PART_TIME"] },
    team: { type: ["string", "null"], description: "Team ID or unique team name." },
    color: { type: "string" },
    serviceSetting: { type: "string", enum: ["IN_CENTER", "IN_HOME", "BOTH"] },
    minimumWeeklyHours: { type: "number" },
    targetWeeklyHours: { type: "number" },
    maximumWeeklyHours: { type: "number" },
    shiftPatterns: { type: "array", items: timePatternSchema },
  },
  required: ["action"],
  additionalProperties: false,
});

const clientSchema = jsonSchema<ClientInput>({
  type: "object",
  properties: {
    action: { type: "string", enum: ["CREATE", "UPDATE", "ARCHIVE"] },
    client: { type: "string", description: "Existing client ID, display code, or exact client name for UPDATE/ARCHIVE." },
    fullName: { type: "string" },
    displayCode: { type: "string" },
    startDate: { type: "string" },
    endDate: { type: ["string", "null"] },
    team: { type: ["string", "null"], description: "Team ID or unique team name." },
    color: { type: "string" },
    serviceSetting: { type: "string", enum: ["IN_CENTER", "IN_HOME", "BOTH"] },
    supportLevel: { type: "string", enum: ["STANDARD", "ONE_TO_ONE", "ROTATION", "HIGH_SUPPORT"] },
    maxConsecutiveBlocksWithSameStaff: { type: ["number", "null"] },
    desiredDifferentStaffPerDay: { type: ["number", "null"] },
    insurancePlan: { type: "string" },
    assignedBcba: { type: ["string", "null"], description: "BCBA ID or unique name." },
    assignedInterns: { type: "array", items: { type: "string" } },
    attendancePatterns: { type: "array", items: timePatternSchema },
    napPatterns: { type: "array", items: timePatternSchema },
    staffRelationships: {
      type: "array",
      items: {
        type: "object",
        properties: {
          staff: { type: "string" },
          relationship: { type: "string", enum: ["PREFERRED", "ALLOWED", "HARD_RESTRICTION"] },
        },
        required: ["staff", "relationship"],
        additionalProperties: false,
      },
    },
  },
  required: ["action"],
  additionalProperties: false,
});

const teamSchema = jsonSchema<TeamInput>({
  type: "object",
  properties: {
    action: { type: "string", enum: ["CREATE", "UPDATE", "ARCHIVE"] },
    team: { type: "string", description: "Existing team ID or unique team name for UPDATE/ARCHIVE." },
    name: { type: "string" },
    color: { type: "string" },
  },
  required: ["action"],
  additionalProperties: false,
});

const eventSchema = jsonSchema<EventInput>({
  type: "object",
  properties: {
    action: { type: "string", enum: ["ADD", "REMOVE"] },
    eventType: { type: "string", enum: ["NAP", "SPEECH"] },
    client: { type: "string", description: "Client ID, display code, or exact name." },
    date: { type: "string", description: "Single YYYY-MM-DD date. Defaults to the selected scheduler date." },
    startTime: { type: "string" },
    endTime: { type: "string" },
    priorityCategory: { type: "string", enum: ["YOUNGER", "OLDER"] },
    recurringSeriesId: { type: "string" },
    seriesStartDate: { type: "string" },
    seriesEndDate: { type: "string" },
    daysOfWeek: { type: "array", items: { type: "string" } },
    sessionId: { type: "string" },
    note: { type: "string" },
  },
  required: ["action", "eventType"],
  additionalProperties: false,
});

const attendanceSchema = jsonSchema<AttendanceInput>({
  type: "object",
  properties: {
    action: { type: "string", enum: ["ADD", "REMOVE"] },
    client: { type: "string" },
    changeType: { type: "string", enum: ["CALL_OUT", "CALL_IN"] },
    startTime: { type: "string" },
    endTime: { type: "string" },
    note: { type: "string" },
    exceptionId: { type: "string" },
  },
  required: ["action", "client"],
  additionalProperties: false,
});

const rulesSchema = jsonSchema<JsonRecord>({
  type: "object",
  properties: {
    fullTimeMinimumWeeklyHours: { type: "number" },
    fullTimeMaximumWeeklyHours: { type: "number" },
    partTimeMinimumWeeklyHours: { type: "number" },
    partTimeMaximumWeeklyHours: { type: "number" },
    maximumClientsPerTechPerDay: { type: "number" },
    maximumTechsPerClientPerDay: { type: "number" },
    defaultBreakMinutes: { type: "number" },
    breakEligibilityHours: { type: "number" },
    breakWindowStart: { type: "string" },
    breakWindowEnd: { type: "string" },
    scheduleStartTime: { type: "string" },
    scheduleEndTime: { type: "string" },
    preferSameTeam: { type: "boolean" },
    preferStaffContinuity: { type: "boolean" },
    preserveManualOverrides: { type: "boolean" },
    preferredStaffPriority: { type: "number" },
    sameTeamPriority: { type: "number" },
    continuityPriority: { type: "number" },
    rotationPriority: { type: "number" },
    workloadBalancePriority: { type: "number" },
    scheduleStabilityPriority: { type: "number" },
    weekdayTemplatePriority: { type: "number" },
    weeklyHoursPriority: { type: "number" },
    historicalPairingPriority: { type: "number" },
    historicalSlotPriority: { type: "number" },
    historicalBreakPriority: { type: "number" },
    btCoveragePriority: { type: "number" },
    internCoveragePriority: { type: "number" },
    managerCoveragePriority: { type: "number" },
    bcbaCoveragePriority: { type: "number" },
    otherCoveragePriority: { type: "number" },
    autoUseWeekdayTemplate: { type: "boolean" },
    autoUsePreviousWeekdaySchedule: { type: "boolean" },
    autoUseHistoricalPatterns: { type: "boolean" },
    supervisionPlanningTargetPercent: { type: "number" },
  },
  additionalProperties: false,
});

const supervisionSchema = jsonSchema<SupervisionInput>({
  type: "object",
  properties: {
    staff: { type: "string", description: "BT/RBT ID or unique staff name." },
    supervisor: { type: ["string", "null"], description: "BCBA ID or unique name." },
    month: { type: "string", description: "YYYY-MM. Defaults to selected date's month." },
    serviceHours: { type: "number" },
    supervisionHours: { type: "number" },
    note: { type: "string" },
  },
  required: ["staff", "serviceHours", "supervisionHours"],
  additionalProperties: false,
});

const configurationSchema = jsonSchema<ConfigurationInput>({
  type: "object",
  properties: {
    area: { type: "string", enum: ["PEOPLE", "TEAMS", "RULES", "EVENTS", "ATTENDANCE", "SUPERVISION"] },
    month: { type: "string" },
  },
  required: ["area"],
  additionalProperties: false,
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isObjectId(value: string): boolean {
  return /^[a-f0-9]{24}$/i.test(value);
}

async function invokeJson(handler: RouteHandler, method: string, body?: JsonRecord, url = "http://scheduler-ai.internal/"): Promise<JsonRecord> {
  const response = await handler(
    new Request(url, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
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

async function resolveStaff(locationId: string, reference: string, roles?: string[]): Promise<JsonRecord> {
  await connectToDatabase();
  const value = reference.trim();
  if (!value) throw new Error("A staff reference is required.");
  const base: JsonRecord = { locationId, active: true, ...(roles?.length ? { role: { $in: roles } } : {}) };
  if (isObjectId(value)) {
    const found = await Staff.findOne({ ...base, _id: value }).lean();
    if (found) return found as unknown as JsonRecord;
  }
  const exact = await Staff.find({ ...base, fullName: { $regex: `^${escapeRegex(value)}$`, $options: "i" } }).limit(2).lean();
  if (exact.length === 1) return exact[0] as unknown as JsonRecord;
  const partial = await Staff.find({ ...base, fullName: { $regex: escapeRegex(value), $options: "i" } }).limit(3).lean();
  if (partial.length === 1) return partial[0] as unknown as JsonRecord;
  if (partial.length > 1 || exact.length > 1) throw new Error(`Staff reference "${value}" is ambiguous. Use the full staff name.`);
  throw new Error(`No active staff member matched "${value}" at this clinic.`);
}

async function resolveClient(locationId: string, reference: string): Promise<JsonRecord> {
  await connectToDatabase();
  const value = reference.trim();
  if (!value) throw new Error("A client reference is required.");
  if (isObjectId(value)) {
    const found = await Client.findOne({ _id: value, locationId, active: true }).lean();
    if (found) return found as unknown as JsonRecord;
  }
  const byCode = await Client.find({ locationId, active: true, displayCode: { $regex: `^${escapeRegex(value)}$`, $options: "i" } }).limit(2).lean();
  if (byCode.length === 1) return byCode[0] as unknown as JsonRecord;
  const byName = await Client.find({ locationId, active: true, fullName: { $regex: `^${escapeRegex(value)}$`, $options: "i" } }).limit(2).lean();
  if (byName.length === 1) return byName[0] as unknown as JsonRecord;
  throw new Error(`No unique active client matched "${value}". Use the client display code or exact name.`);
}

async function resolveTeam(locationId: string, reference: string): Promise<JsonRecord> {
  await connectToDatabase();
  const value = reference.trim();
  if (!value) throw new Error("A team reference is required.");
  if (isObjectId(value)) {
    const found = await Team.findOne({ _id: value, locationId, active: true }).lean();
    if (found) return found as unknown as JsonRecord;
  }
  const found = await Team.find({ locationId, active: true, name: { $regex: `^${escapeRegex(value)}$`, $options: "i" } }).limit(2).lean();
  if (found.length === 1) return found[0] as unknown as JsonRecord;
  throw new Error(`No unique active team matched "${value}".`);
}

async function optionalTeamId(locationId: string, reference: string | null | undefined): Promise<string | null | undefined> {
  if (reference === undefined) return undefined;
  if (reference === null || reference.trim() === "") return null;
  const team = await resolveTeam(locationId, reference);
  return String(team._id);
}

async function patchDynamic(
  handler: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>,
  id: string,
  body: JsonRecord
): Promise<JsonRecord> {
  const response = await handler(
    new Request("http://scheduler-ai.internal/", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
  let data: JsonRecord = {};
  try {
    data = (await response.json()) as JsonRecord;
  } catch {
    data = {};
  }
  return { ok: response.ok, status: response.status, ...data };
}

export const SCHEDULER_WEBSITE_WRITE_TOOL_NAMES = new Set([
  "manage_staff",
  "manage_client",
  "manage_team",
  "manage_scheduler_event",
  "manage_client_attendance",
  "update_scheduler_rules",
  "save_supervision_record",
]);

export function createSchedulerWebsiteTools(context: SchedulerAiContext) {
  const { locationId, date } = context;

  return {
    get_scheduler_configuration: tool({
      description:
        "Read configuration and operational data from elsewhere in the scheduler website (people profiles, teams, scheduling rules, nap/speech events, client attendance changes, or monthly supervision). Use this when a request concerns scheduler setup rather than just calendar cells.",
      inputSchema: configurationSchema,
      execute: async ({ area, month }) => {
        if (area === "PEOPLE") {
          await connectToDatabase();
          const [staff, clients] = await Promise.all([
            Staff.find({ locationId, active: true }).sort({ fullName: 1 }).lean(),
            Client.find({ locationId, active: true }).sort({ displayCode: 1 }).lean(),
          ]);
          return {
            staff: staff.map((record: any) => ({
              id: String(record._id),
              fullName: record.fullName,
              role: record.role,
              employeeType: record.employeeType,
              teamId: record.teamId ? String(record.teamId) : null,
              serviceSetting: record.serviceSetting,
              minimumWeeklyHours: record.minimumWeeklyHours,
              targetWeeklyHours: record.targetWeeklyHours,
              maximumWeeklyHours: record.maximumWeeklyHours,
              shiftPatterns: record.shiftPatterns ?? [],
            })),
            clients: clients.map((record: any) => ({
              id: String(record._id),
              fullName: record.fullName,
              displayCode: record.displayCode,
              teamId: record.teamId ? String(record.teamId) : null,
              serviceSetting: record.serviceSetting,
              supportLevel: record.supportLevel,
              maxConsecutiveBlocksWithSameStaff: record.maxConsecutiveBlocksWithSameStaff ?? null,
              desiredDifferentStaffPerDay: record.desiredDifferentStaffPerDay ?? null,
              attendancePatterns: record.attendancePatterns ?? [],
              napPatterns: record.napPatterns ?? [],
              staffRelationships: record.staffRelationships ?? [],
            })),
          };
        }
        if (area === "TEAMS") {
          await connectToDatabase();
          const teams = await Team.find({ locationId, active: true }).sort({ name: 1 }).lean();
          return { teams: teams.map((record: any) => ({ id: String(record._id), name: record.name, color: record.color })) };
        }
        if (area === "RULES") {
          return invokeJson(getSchedulingRules, "GET", undefined, `http://scheduler-ai.internal/api/scheduling-rules?locationId=${encodeURIComponent(locationId)}`);
        }
        if (area === "EVENTS") {
          const [nap, speech] = await Promise.all([
            invokeJson(getNapSessions, "GET", undefined, `http://scheduler-ai.internal/api/nap-sessions?locationId=${encodeURIComponent(locationId)}&date=${encodeURIComponent(date)}`),
            invokeJson(getSpeechSessions, "GET", undefined, `http://scheduler-ai.internal/api/speech-sessions?locationId=${encodeURIComponent(locationId)}&date=${encodeURIComponent(date)}`),
          ]);
          return { napSessions: nap.napSessions ?? [], speechSessions: speech.speechSessions ?? [] };
        }
        if (area === "ATTENDANCE") {
          return invokeJson(getClientAttendance, "GET", undefined, `http://scheduler-ai.internal/api/client-attendance?locationId=${encodeURIComponent(locationId)}&date=${encodeURIComponent(date)}`);
        }
        const targetMonth = month?.trim() || date.slice(0, 7);
        return invokeJson(getSupervision, "GET", undefined, `http://scheduler-ai.internal/api/supervision?locationId=${encodeURIComponent(locationId)}&month=${encodeURIComponent(targetMonth)}`);
      },
    }),

    manage_staff: tool({
      description:
        "Create, update, or archive a staff profile used by the scheduler. Use normal names; this tool resolves existing staff and teams safely. Do not invent missing required profile fields when creating a person.",
      inputSchema: staffSchema,
      execute: async (input) => {
        const teamId = await optionalTeamId(locationId, input.team);
        if (input.action === "CREATE") {
          if (!input.fullName || !input.startDate || !input.role || !input.employeeType) {
            return { ok: false, error: "Creating staff requires fullName, startDate, role, and employeeType." };
          }
          return invokeJson(createStaff, "POST", {
            locationId,
            fullName: input.fullName,
            startDate: input.startDate,
            endDate: input.endDate,
            role: input.role,
            employeeType: input.employeeType,
            ...(teamId !== undefined ? { teamId } : {}),
            color: input.color,
            serviceSetting: input.serviceSetting,
            minimumWeeklyHours: input.minimumWeeklyHours,
            targetWeeklyHours: input.targetWeeklyHours,
            maximumWeeklyHours: input.maximumWeeklyHours,
            shiftPatterns: input.shiftPatterns,
          });
        }
        if (!input.staff) return { ok: false, error: "UPDATE/ARCHIVE requires a staff reference." };
        const staff = await resolveStaff(locationId, input.staff);
        if (input.action === "ARCHIVE") {
          return patchDynamic(updateStaff, String(staff._id), { active: false });
        }
        const body: JsonRecord = {};
        for (const key of ["fullName", "startDate", "endDate", "role", "employeeType", "color", "serviceSetting", "minimumWeeklyHours", "targetWeeklyHours", "maximumWeeklyHours", "shiftPatterns"] as const) {
          if (input[key] !== undefined) body[key] = input[key];
        }
        if (teamId !== undefined) body.teamId = teamId;
        return patchDynamic(updateStaff, String(staff._id), body);
      },
    }),

    manage_client: tool({
      description:
        "Create, update, or archive a scheduler client profile, including attendance patterns, nap patterns, support/rotation settings, BCBA/intern assignments, and staff relationships. Resolve people/teams by name instead of inventing IDs.",
      inputSchema: clientSchema,
      execute: async (input) => {
        const teamId = await optionalTeamId(locationId, input.team);
        const assignedBcbaId = input.assignedBcba === undefined
          ? undefined
          : input.assignedBcba === null || input.assignedBcba.trim() === ""
            ? null
            : String((await resolveStaff(locationId, input.assignedBcba, ["BCBA"]))._id);
        const assignedInternIds = input.assignedInterns === undefined
          ? undefined
          : await Promise.all(input.assignedInterns.map(async (name) => String((await resolveStaff(locationId, name, ["INTERN"]))._id)));
        const staffRelationships = input.staffRelationships === undefined
          ? undefined
          : await Promise.all(input.staffRelationships.map(async (entry) => ({
              staffId: String((await resolveStaff(locationId, entry.staff))._id),
              relationship: entry.relationship,
            })));

        if (input.action === "CREATE") {
          if (!input.fullName || !input.displayCode || !input.startDate) {
            return { ok: false, error: "Creating a client requires fullName, displayCode, and startDate." };
          }
          return invokeJson(createClient, "POST", {
            locationId,
            fullName: input.fullName,
            displayCode: input.displayCode,
            startDate: input.startDate,
            endDate: input.endDate,
            ...(teamId !== undefined ? { teamId } : {}),
            color: input.color,
            serviceSetting: input.serviceSetting,
            supportLevel: input.supportLevel,
            maxConsecutiveBlocksWithSameStaff: input.maxConsecutiveBlocksWithSameStaff,
            desiredDifferentStaffPerDay: input.desiredDifferentStaffPerDay,
            insurancePlan: input.insurancePlan,
            ...(assignedBcbaId !== undefined ? { assignedBcbaId } : {}),
            ...(assignedInternIds !== undefined ? { assignedInternIds } : {}),
            attendancePatterns: input.attendancePatterns,
            napPatterns: input.napPatterns,
            ...(staffRelationships !== undefined ? { staffRelationships } : {}),
          });
        }
        if (!input.client) return { ok: false, error: "UPDATE/ARCHIVE requires a client reference." };
        const client = await resolveClient(locationId, input.client);
        if (input.action === "ARCHIVE") {
          return patchDynamic(updateClient, String(client._id), { active: false });
        }
        const body: JsonRecord = {};
        for (const key of ["fullName", "displayCode", "startDate", "endDate", "color", "serviceSetting", "supportLevel", "maxConsecutiveBlocksWithSameStaff", "desiredDifferentStaffPerDay", "insurancePlan", "attendancePatterns", "napPatterns"] as const) {
          if (input[key] !== undefined) body[key] = input[key];
        }
        if (teamId !== undefined) body.teamId = teamId;
        if (assignedBcbaId !== undefined) body.assignedBcbaId = assignedBcbaId;
        if (assignedInternIds !== undefined) body.assignedInternIds = assignedInternIds;
        if (staffRelationships !== undefined) body.staffRelationships = staffRelationships;
        return patchDynamic(updateClient, String(client._id), body);
      },
    }),

    manage_team: tool({
      description: "Create, rename/recolor, or archive a scheduler team.",
      inputSchema: teamSchema,
      execute: async (input) => {
        if (input.action === "CREATE") {
          if (!input.name) return { ok: false, error: "Creating a team requires a name." };
          return invokeJson(createTeam, "POST", { locationId, name: input.name, color: input.color });
        }
        if (!input.team) return { ok: false, error: "UPDATE/ARCHIVE requires a team reference." };
        const team = await resolveTeam(locationId, input.team);
        if (input.action === "ARCHIVE") {
          return patchDynamic(updateTeam, String(team._id), { active: false });
        }
        const body: JsonRecord = {};
        if (input.name !== undefined) body.name = input.name;
        if (input.color !== undefined) body.color = input.color;
        return patchDynamic(updateTeam, String(team._id), body);
      },
    }),

    manage_scheduler_event: tool({
      description:
        "Add or remove nap/speech scheduler events for a client. Supports a single selected date or a recurring weekday series. For removal, you may provide a session/series ID or identify the client/time so the tool can resolve the saved event.",
      inputSchema: eventSchema,
      execute: async (input) => {
        if (input.action === "ADD") {
          if (!input.client || !input.startTime || !input.endTime) {
            return { ok: false, error: "Adding a nap/speech event requires client, startTime, and endTime." };
          }
          const client = await resolveClient(locationId, input.client);
          const body = {
            locationId,
            clientId: String(client._id),
            date: input.date || date,
            startTime: input.startTime,
            endTime: input.endTime,
            priorityCategory: input.priorityCategory,
            recurringSeriesId: input.recurringSeriesId,
            seriesStartDate: input.seriesStartDate,
            seriesEndDate: input.seriesEndDate,
            daysOfWeek: input.daysOfWeek,
            note: input.note,
          };
          return input.eventType === "NAP"
            ? invokeJson(createNapSession, "POST", body)
            : invokeJson(createSpeechSession, "POST", body);
        }

        let sessionId = input.sessionId?.trim() || "";
        let recurringSeriesId = input.recurringSeriesId?.trim() || "";
        if (!sessionId && !recurringSeriesId) {
          if (!input.client) return { ok: false, error: "Removing an event requires session/series ID or a client reference." };
          const client = await resolveClient(locationId, input.client);
          await connectToDatabase();
          const Model = input.eventType === "NAP" ? NapSession : SpeechSession;
          const query: JsonRecord = { locationId, clientId: String(client._id), date: input.date || date };
          if (input.startTime) query.startTime = input.startTime;
          if (input.endTime) query.endTime = input.endTime;
          const matches = await Model.find(query).limit(3).lean();
          if (matches.length !== 1) {
            return { ok: false, error: matches.length === 0 ? "No matching saved event was found." : "Multiple events match. Specify the start/end time or series ID." };
          }
          sessionId = String((matches[0] as any)._id);
        }
        const body = { locationId, ...(recurringSeriesId ? { recurringSeriesId } : { sessionId }) };
        return input.eventType === "NAP"
          ? invokeJson(deleteNapSession, "DELETE", body)
          : invokeJson(deleteSpeechSession, "DELETE", body);
      },
    }),

    manage_client_attendance: tool({
      description:
        "Add/update or remove a client's day-specific call-out/call-in attendance change for the selected date. This changes client attendance inputs used by schedule generation.",
      inputSchema: attendanceSchema,
      execute: async (input) => {
        const client = await resolveClient(locationId, input.client);
        if (input.action === "ADD") {
          return invokeJson(saveClientAttendance, "POST", {
            locationId,
            clientId: String(client._id),
            date,
            changeType: input.changeType || "CALL_OUT",
            startTime: input.startTime,
            endTime: input.endTime,
            note: input.note || "Recorded by Scheduler AI",
          });
        }
        let exceptionId = input.exceptionId?.trim() || "";
        if (!exceptionId) {
          await connectToDatabase();
          const existing = await ClientAttendanceException.findOne({ locationId, clientId: String(client._id), date }).lean();
          if (!existing) return { ok: true, removed: false, message: "No client attendance change existed for the selected date." };
          exceptionId = String((existing as any)._id);
        }
        return invokeJson(deleteClientAttendance, "DELETE", { locationId, exceptionId });
      },
    }),

    update_scheduler_rules: tool({
      description:
        "Update clinic-wide automatic scheduler rules and priorities such as break window/eligibility, weekly hour ranges, rotation/continuity priorities, schedule hours, role coverage priorities, historical/template preferences, and supervision target. Only send fields the user actually wants changed.",
      inputSchema: rulesSchema,
      execute: async (changes) => invokeJson(updateSchedulingRules, "PUT", { locationId, ...changes }),
    }),

    save_supervision_record: tool({
      description:
        "Save monthly supervision planning data for a BT/RBT, including service hours, supervision hours, optional BCBA supervisor, and note.",
      inputSchema: supervisionSchema,
      execute: async (input) => {
        const staff = await resolveStaff(locationId, input.staff, ["BT", "RBT"]);
        const supervisorStaffId = input.supervisor === undefined || input.supervisor === null || input.supervisor.trim() === ""
          ? null
          : String((await resolveStaff(locationId, input.supervisor, ["BCBA"]))._id);
        return invokeJson(saveSupervision, "POST", {
          locationId,
          staffId: String(staff._id),
          supervisorStaffId,
          month: input.month || date.slice(0, 7),
          serviceHours: input.serviceHours,
          supervisionHours: input.supervisionHours,
          note: input.note,
        });
      },
    }),
  };
}
