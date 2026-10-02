import { POST as copyScheduleDay } from "@/app/api/schedule/copy/route";
import { POST as generateScheduleDay } from "@/app/api/schedule/generate/route";
import { POST as previewScheduleDay } from "@/app/api/schedule/preview/route";
import { POST as repairScheduleDay } from "@/app/api/schedule/repair/route";
import { connectToDatabase } from "@/lib/db";
import { CallOut } from "@/models/CallOut";
import { Client } from "@/models/Client";
import { Location } from "@/models/Location";
import { ScheduleAssignment } from "@/models/ScheduleAssignment";
import { ScheduleTemplate } from "@/models/ScheduleTemplate";
import { SpeechSession } from "@/models/SpeechSession";
import { Staff } from "@/models/Staff";
import { Team } from "@/models/Team";
import { TrialDataset } from "@/models/TrialDataset";
import { UnplacedAssignment } from "@/models/UnplacedAssignment";

import {
  LIVINGSTON_TRIAL_CLIENTS,
  LIVINGSTON_TRIAL_DATASET_KEY,
  LIVINGSTON_TRIAL_DATES,
  LIVINGSTON_TRIAL_END_DATE,
  LIVINGSTON_TRIAL_SPEECH,
  LIVINGSTON_TRIAL_STAFF,
  LIVINGSTON_TRIAL_START_DATE,
  LIVINGSTON_TRIAL_TEAMS,
} from "./livingstonTrialConfig";

type JsonRecord = Record<string, unknown>;

type TrialRunResult = {
  locationId: string;
  locationName: string;
  datasetKey: string;
  dates: typeof LIVINGSTON_TRIAL_DATES;
  created: {
    teams: number;
    staff: number;
    clients: number;
    speechSessions: number;
    callOuts: number;
    templates: number;
  };
  previews: Record<string, JsonRecord>;
  generations: Record<string, JsonRecord>;
  repair: JsonRecord;
  copyDay: JsonRecord;
};

function asId(value: unknown): string {
  return String(value ?? "");
}

function makeInternalRequest(body: JsonRecord): Request {
  return new Request("http://trial-data.internal/action", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function invokeRoute(
  handler: (request: Request) => Promise<Response>,
  body: JsonRecord,
  actionName: string
): Promise<JsonRecord> {
  const response = await handler(makeInternalRequest(body));
  const data = (await response.json()) as JsonRecord;

  if (!response.ok) {
    const errorMessage =
      typeof data.error === "string"
        ? data.error
        : `${actionName} failed with HTTP ${response.status}.`;

    throw new Error(errorMessage);
  }

  return data;
}

async function getLivingstonLocation() {
  const location = await Location.findOne({
    active: true,
    $or: [
      { code: "LIVINGSTON" },
      { name: { $regex: /^livingston$/i } },
    ],
  });

  if (!location) {
    throw new Error("The Livingston clinic location was not found.");
  }

  return location;
}

function buildCopyDayShift(
  shifts: Array<{
    name: string;
    days: string[];
    startTime: string;
    endTime: string;
  }>
) {
  const sourceShift = shifts[shifts.length - 1] ?? shifts[0];

  if (!sourceShift) {
    return null;
  }

  return {
    name: "Trial copy-day availability",
    days: ["THURSDAY"],
    startTime: sourceShift.startTime,
    endTime: sourceShift.endTime,
  };
}

export async function resetLivingstonTrialData() {
  await connectToDatabase();

  const location = await getLivingstonLocation();
  const dataset = await TrialDataset.findOne({
    key: LIVINGSTON_TRIAL_DATASET_KEY,
    locationId: location._id,
  }).lean();

  if (!dataset) {
    return {
      success: true,
      removed: false,
      message: "No tracked Livingston trial dataset is currently installed.",
    };
  }

  const staffIds = dataset.staffIds ?? [];
  const clientIds = dataset.clientIds ?? [];
  const teamIds = dataset.teamIds ?? [];
  const speechSessionIds = dataset.speechSessionIds ?? [];
  const templateIds = dataset.templateIds ?? [];
  const callOutIds = dataset.callOutIds ?? [];

  const dateFilter = {
    $gte: LIVINGSTON_TRIAL_START_DATE,
    $lte: LIVINGSTON_TRIAL_END_DATE,
  };

  const [scheduleResult, unplacedResult] = await Promise.all([
    ScheduleAssignment.deleteMany({
      locationId: location._id,
      date: dateFilter,
    }),
    UnplacedAssignment.deleteMany({
      locationId: location._id,
      date: dateFilter,
    }),
  ]);

  await Promise.all([
    SpeechSession.deleteMany({ _id: { $in: speechSessionIds } }),
    CallOut.deleteMany({ _id: { $in: callOutIds } }),
    ScheduleTemplate.deleteMany({ _id: { $in: templateIds } }),
    Client.deleteMany({ _id: { $in: clientIds } }),
    Staff.deleteMany({ _id: { $in: staffIds } }),
    Team.deleteMany({ _id: { $in: teamIds } }),
  ]);

  await TrialDataset.deleteOne({ _id: dataset._id });

  return {
    success: true,
    removed: true,
    deletedScheduleAssignments: scheduleResult.deletedCount ?? 0,
    deletedUnplacedAssignments: unplacedResult.deletedCount ?? 0,
    deletedStaff: staffIds.length,
    deletedClients: clientIds.length,
    deletedTeams: teamIds.length,
    deletedSpeechSessions: speechSessionIds.length,
    deletedTemplates: templateIds.length,
    deletedCallOuts: callOutIds.length,
  };
}

export async function getLivingstonTrialStatus() {
  await connectToDatabase();

  const location = await getLivingstonLocation();
  const dataset = await TrialDataset.findOne({
    key: LIVINGSTON_TRIAL_DATASET_KEY,
    locationId: location._id,
  })
    .select(
      "key startDate endDate generatedDates staffIds clientIds teamIds speechSessionIds templateIds callOutIds createdAt updatedAt"
    )
    .lean();

  return {
    installed: Boolean(dataset),
    locationId: asId(location._id),
    locationName: String(location.name),
    datasetKey: LIVINGSTON_TRIAL_DATASET_KEY,
    dates: LIVINGSTON_TRIAL_DATES,
    counts: dataset
      ? {
          staff: dataset.staffIds?.length ?? 0,
          clients: dataset.clientIds?.length ?? 0,
          teams: dataset.teamIds?.length ?? 0,
          speechSessions: dataset.speechSessionIds?.length ?? 0,
          templates: dataset.templateIds?.length ?? 0,
          callOuts: dataset.callOutIds?.length ?? 0,
        }
      : null,
    generatedDates: dataset?.generatedDates ?? [],
  };
}

export async function seedAndRunLivingstonTrial(): Promise<TrialRunResult> {
  await connectToDatabase();

  const location = await getLivingstonLocation();
  const locationId = asId(location._id);

  const existingDataset = await TrialDataset.findOne({
    key: LIVINGSTON_TRIAL_DATASET_KEY,
    locationId: location._id,
  });

  if (existingDataset) {
    await resetLivingstonTrialData();
  }

  const trialStaffNames = LIVINGSTON_TRIAL_STAFF.map((staffMember) =>
    staffMember.name
  );
  const trialClientCodes = LIVINGSTON_TRIAL_CLIENTS.map((client) =>
    client.code
  );

  const [existingStaff, existingClients] = await Promise.all([
    Staff.find({
      locationId: location._id,
      active: true,
      fullName: { $in: trialStaffNames },
    })
      .select("fullName")
      .lean(),
    Client.find({
      locationId: location._id,
      active: true,
      displayCode: { $in: trialClientCodes },
    })
      .select("displayCode")
      .lean(),
  ]);

  if (existingStaff.length > 0 || existingClients.length > 0) {
    throw new Error(
      "Livingston already contains staff or client records that use the trial workbook names/codes. The trial seed stopped to avoid overwriting real clinic data."
    );
  }

  const teamByKey = new Map<string, string>();
  const teamIds: string[] = [];

  for (const teamConfig of LIVINGSTON_TRIAL_TEAMS) {
    const team = await Team.create({
      locationId: location._id,
      name: teamConfig.name,
      color: teamConfig.color,
      active: true,
    });

    const teamId = asId(team._id);
    teamByKey.set(teamConfig.key, teamId);
    teamIds.push(teamId);
  }

  const staffIdByName = new Map<string, string>();
  const staffIds: string[] = [];

  for (const staffConfig of LIVINGSTON_TRIAL_STAFF) {
    const copyDayShift = buildCopyDayShift(staffConfig.shifts);
    const shiftPatterns = copyDayShift
      ? [...staffConfig.shifts, copyDayShift]
      : staffConfig.shifts;

    const staffMember = await Staff.create({
      locationId: location._id,
      fullName: staffConfig.name,
      startDate: new Date("2026-09-01T12:00:00.000Z"),
      endDate: null,
      role: staffConfig.role,
      employeeType: staffConfig.employeeType,
      teamId: teamByKey.get(staffConfig.teamKey) ?? null,
      color: staffConfig.color,
      serviceSetting: "IN_CENTER",
      minimumWeeklyHours: staffConfig.minimumWeeklyHours,
      targetWeeklyHours: staffConfig.targetWeeklyHours,
      maximumWeeklyHours: staffConfig.maximumWeeklyHours,
      shiftPatterns,
      active: true,
    });

    const staffId = asId(staffMember._id);
    staffIdByName.set(staffConfig.name, staffId);
    staffIds.push(staffId);
  }

  const bcbaId = staffIdByName.get("Stephanie") ?? null;
  const internId = staffIdByName.get("Bella (wil)") ?? null;
  const clientIdByCode = new Map<string, string>();
  const clientIds: string[] = [];

  for (const clientConfig of LIVINGSTON_TRIAL_CLIENTS) {
    const relationships = clientConfig.preferredStaff
      .map((staffName) => staffIdByName.get(staffName))
      .filter((staffId): staffId is string => Boolean(staffId))
      .map((staffId) => ({
        staffId,
        relationship: "PREFERRED",
      }));

    const client = await Client.create({
      locationId: location._id,
      fullName: clientConfig.fullName,
      displayCode: clientConfig.code,
      startDate: new Date("2026-09-01T12:00:00.000Z"),
      endDate: null,
      teamId: teamByKey.get(clientConfig.teamKey) ?? null,
      color: clientConfig.color,
      serviceSetting: "IN_CENTER",
      supportLevel: clientConfig.supportLevel,
      maxConsecutiveBlocksWithSameStaff:
        clientConfig.maxConsecutiveBlocksWithSameStaff ?? null,
      desiredDifferentStaffPerDay:
        clientConfig.desiredDifferentStaffPerDay ?? null,
      insurancePlan: "TRIAL DATA",
      assignedBcbaId: bcbaId,
      assignedInternIds: internId ? [internId] : [],
      attendancePatterns: [
        {
          name: "Livingston trial attendance",
          days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY"],
          startTime: clientConfig.startTime,
          endTime: clientConfig.endTime,
        },
      ],
      napPatterns: clientConfig.nap
        ? [
            {
              name: "Trial nap",
              days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY"],
              startTime: clientConfig.nap.startTime,
              endTime: clientConfig.nap.endTime,
            },
          ]
        : [],
      staffRelationships: relationships,
      active: true,
    });

    const clientId = asId(client._id);
    clientIdByCode.set(clientConfig.code, clientId);
    clientIds.push(clientId);
  }

  const speechSessionIds: string[] = [];

  for (const speechConfig of LIVINGSTON_TRIAL_SPEECH) {
    const clientId = clientIdByCode.get(speechConfig.clientCode);

    if (!clientId) {
      continue;
    }

    const speechSession = await SpeechSession.create({
      locationId: location._id,
      clientId,
      date: speechConfig.date,
      startTime: speechConfig.startTime,
      endTime: speechConfig.endTime,
      recurringSeriesId: "TRIAL-LIVINGSTON-SPEECH",
      note: speechConfig.note,
    });

    speechSessionIds.push(asId(speechSession._id));
  }

  const previews: Record<string, JsonRecord> = {};
  const generations: Record<string, JsonRecord> = {};
  const generatedDates = [
    LIVINGSTON_TRIAL_DATES.monday,
    LIVINGSTON_TRIAL_DATES.tuesday,
    LIVINGSTON_TRIAL_DATES.wednesday,
  ];

  for (const date of generatedDates) {
    previews[date] = await invokeRoute(
      previewScheduleDay,
      { locationId, date },
      `Preview ${date}`
    );

    generations[date] = await invokeRoute(
      generateScheduleDay,
      { locationId, date },
      `Generate ${date}`
    );
  }

  const callOutStaffId = staffIdByName.get("Keila");
  const callOutIds: string[] = [];

  if (callOutStaffId) {
    const callOut = await CallOut.create({
      locationId: location._id,
      staffId: callOutStaffId,
      date: LIVINGSTON_TRIAL_DATES.tuesday,
      startTime: "09:00",
      endTime: "12:00",
      reason: "TRIAL partial-day call-out",
      note: "Created by the Livingston trial data runner to test Repair Schedule.",
      createdByUserId: "scheduler-system",
    });

    callOutIds.push(asId(callOut._id));
  }

  const repair = await invokeRoute(
    repairScheduleDay,
    {
      locationId,
      date: LIVINGSTON_TRIAL_DATES.tuesday,
    },
    "Repair Tuesday trial schedule"
  );

  const copyDay = await invokeRoute(
    copyScheduleDay,
    {
      locationId,
      sourceDate: LIVINGSTON_TRIAL_DATES.monday,
      targetDate: LIVINGSTON_TRIAL_DATES.copyDay,
    },
    "Copy Monday trial schedule to Thursday"
  );

  const mondayAssignments = await ScheduleAssignment.find({
    locationId: location._id,
    date: LIVINGSTON_TRIAL_DATES.monday,
  })
    .sort({ startTime: 1, staffId: 1 })
    .lean();

  const template = await ScheduleTemplate.create({
    locationId: location._id,
    name: "TRIAL Livingston Monday Workbook Pattern",
    dayOfWeek: "MONDAY",
    assignments: mondayAssignments.map((assignment) => ({
      startTime: assignment.startTime,
      endTime: assignment.endTime,
      staffId: assignment.staffId,
      clientId: assignment.clientId ?? null,
      assignmentType: assignment.assignmentType,
      locked: false,
    })),
    active: true,
  });

  const templateIds = [asId(template._id)];

  await TrialDataset.create({
    key: LIVINGSTON_TRIAL_DATASET_KEY,
    locationId: location._id,
    startDate: LIVINGSTON_TRIAL_START_DATE,
    endDate: LIVINGSTON_TRIAL_END_DATE,
    staffIds,
    clientIds,
    teamIds,
    speechSessionIds,
    templateIds,
    callOutIds,
    generatedDates: [
      ...generatedDates,
      LIVINGSTON_TRIAL_DATES.copyDay,
    ],
    notes:
      "Workbook-inspired Livingston test data. Monday-Wednesday were auto-generated, Tuesday was repaired after a partial-day call-out, and Monday was copied into Thursday for Copy Day testing.",
  });

  return {
    locationId,
    locationName: String(location.name),
    datasetKey: LIVINGSTON_TRIAL_DATASET_KEY,
    dates: LIVINGSTON_TRIAL_DATES,
    created: {
      teams: teamIds.length,
      staff: staffIds.length,
      clients: clientIds.length,
      speechSessions: speechSessionIds.length,
      callOuts: callOutIds.length,
      templates: templateIds.length,
    },
    previews,
    generations,
    repair,
    copyDay,
  };
}
