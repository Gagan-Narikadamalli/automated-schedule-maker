import type {
  SchedulerAssignment,
  SchedulerClient,
  SchedulerStaff,
} from "../engine/types";

export type LivingstonWorkbookTrialSummary = {
  sourceWorkbook: string;
  sourceWeekStart: string;
  sourceWeekEnd: string;
  recentStaffNames: string[];
  recentClientCodes: string[];
  templateAvailabilityNotes: Array<{
    staffName: string;
    note: string;
  }>;
  strongPairingObservationCount: number;
  repeatedExactSlotObservationCount: number;
  breakObservationCount: number;
};

type PairingObservation = {
  staffName: string;
  clientCode: string;
  occurrences: number;
};

type ExactSlotObservation = PairingObservation & {
  startTime: string;
};

type BreakObservation = {
  staffName: string;
  startTime: string;
  assignmentType: "BREAK";
  occurrences: number;
};

export const LIVINGSTON_RECENT_WEEK_STAFF = [
  "Adian",
  "Anias",
  "Areyana",
  "Ariana",
  "Bella (wil)",
  "Danna",
  "Devonyah",
  "Dezz",
  "Izzy",
  "Jalani",
  "Julius",
  "Juwell",
  "Keila",
  "Lamya",
  "Latoya",
  "Lauren",
  "Laurine",
  "Lexus",
  "Marisol",
  "Mel",
  "Melanie",
  "Olivia",
  "Sakile",
  "Shreya",
  "Siobhan",
  "Stephanie",
  "Suzzy",
  "Zahnya",
];

export const LIVINGSTON_RECENT_WEEK_CLIENTS = [
  "AVYa",
  "AdZh",
  "AmAb",
  "CaCr",
  "CaGr",
  "CaMe",
  "Eera",
  "ElNg",
  "EyNa",
  "IsMo",
  "JeMa",
  "JiMa",
  "LiSh",
  "LuRa",
  "MaHa",
  "MiSm",
  "ReMa",
  "StAb",
  "ZiBo",
];

// The workbook's TEM sheet is a roster/availability template. Only names that
// also appeared in the recent trial week are retained here so old staff are not
// accidentally reintroduced into scheduling decisions.
export const LIVINGSTON_TEMPLATE_AVAILABILITY_NOTES = [
  { staffName: "Ariana", note: "Monday off" },
  { staffName: "Juwell", note: "Wednesday until 4:00 PM" },
  { staffName: "Keila", note: "Monday until 4:00 PM" },
  { staffName: "Olivia", note: "Friday off" },
  { staffName: "Sakile", note: "Wednesday from 12:30 PM" },
];

// Strong staff/client pairings observed during the recent Livingston trial week
// (Sep 28 through Oct 2, 2026). Lower-frequency pairings are intentionally not
// embedded so the scheduler learns a helpful tendency without overfitting every
// one-off manual adjustment in the spreadsheet.
const PAIRING_OBSERVATIONS: PairingObservation[] = [
  { staffName: "Keila", clientCode: "MiSm", occurrences: 38 },
  { staffName: "Marisol", clientCode: "StAb", occurrences: 35 },
  { staffName: "Siobhan", clientCode: "AmAb", occurrences: 32 },
  { staffName: "Jalani", clientCode: "MiSm", occurrences: 29 },
  { staffName: "Lamya", clientCode: "MaHa", occurrences: 29 },
  { staffName: "Areyana", clientCode: "CaGr", occurrences: 26 },
  { staffName: "Devonyah", clientCode: "ZiBo", occurrences: 24 },
  { staffName: "Jalani", clientCode: "IsMo", occurrences: 23 },
  { staffName: "Danna", clientCode: "CaGr", occurrences: 22 },
  { staffName: "Keila", clientCode: "JiMa", occurrences: 22 },
  { staffName: "Areyana", clientCode: "MaHa", occurrences: 22 },
  { staffName: "Juwell", clientCode: "ZiBo", occurrences: 22 },
  { staffName: "Jalani", clientCode: "JeMa", occurrences: 20 },
  { staffName: "Bella (wil)", clientCode: "ReMa", occurrences: 19 },
  { staffName: "Juwell", clientCode: "IsMo", occurrences: 18 },
  { staffName: "Latoya", clientCode: "EyNa", occurrences: 17 },
  { staffName: "Anias", clientCode: "CaMe", occurrences: 16 },
  { staffName: "Lamya", clientCode: "EyNa", occurrences: 16 },
  { staffName: "Olivia", clientCode: "IsMo", occurrences: 15 },
  { staffName: "Lamya", clientCode: "LuRa", occurrences: 15 },
  { staffName: "Izzy", clientCode: "LuRa", occurrences: 14 },
  { staffName: "Izzy", clientCode: "IsMo", occurrences: 14 },
  { staffName: "Stephanie", clientCode: "ReMa", occurrences: 13 },
  { staffName: "Devonyah", clientCode: "JeMa", occurrences: 13 },
  { staffName: "Latoya", clientCode: "JeMa", occurrences: 13 },
  { staffName: "Stephanie", clientCode: "JiMa", occurrences: 12 },
  { staffName: "Anias", clientCode: "JeMa", occurrences: 12 },
  { staffName: "Siobhan", clientCode: "StAb", occurrences: 12 },
  { staffName: "Lauren", clientCode: "AmAb", occurrences: 11 },
  { staffName: "Marisol", clientCode: "ElNg", occurrences: 11 },
  { staffName: "Devonyah", clientCode: "CaMe", occurrences: 11 },
  { staffName: "Lauren", clientCode: "EyNa", occurrences: 10 },
  { staffName: "Anias", clientCode: "JiMa", occurrences: 10 },
  { staffName: "Bella (wil)", clientCode: "Eera", occurrences: 10 },
  { staffName: "Juwell", clientCode: "ReMa", occurrences: 10 },
  { staffName: "Danna", clientCode: "JeMa", occurrences: 10 },
  { staffName: "Stephanie", clientCode: "ElNg", occurrences: 10 },
  { staffName: "Juwell", clientCode: "JiMa", occurrences: 10 },
  { staffName: "Juwell", clientCode: "CaMe", occurrences: 9 },
  { staffName: "Marisol", clientCode: "CaMe", occurrences: 9 },
  { staffName: "Anias", clientCode: "LuRa", occurrences: 8 },
  { staffName: "Devonyah", clientCode: "JiMa", occurrences: 8 },
  { staffName: "Siobhan", clientCode: "CaMe", occurrences: 8 },
  { staffName: "Anias", clientCode: "ReMa", occurrences: 8 },
  { staffName: "Bella (wil)", clientCode: "ZiBo", occurrences: 8 },
  { staffName: "Izzy", clientCode: "JiMa", occurrences: 8 },
  { staffName: "Marisol", clientCode: "LuRa", occurrences: 8 },
  { staffName: "Devonyah", clientCode: "LuRa", occurrences: 8 },
  { staffName: "Jalani", clientCode: "CaCr", occurrences: 8 },
  { staffName: "Olivia", clientCode: "ZiBo", occurrences: 8 },
  { staffName: "Izzy", clientCode: "MaHa", occurrences: 8 },
];

const EXACT_SLOT_OBSERVATIONS: ExactSlotObservation[] = [
  { staffName: "Siobhan", clientCode: "AmAb", startTime: "12:30", occurrences: 4 },
  { staffName: "Siobhan", clientCode: "AmAb", startTime: "13:00", occurrences: 4 },
  { staffName: "Siobhan", clientCode: "AmAb", startTime: "13:30", occurrences: 4 },
  { staffName: "Siobhan", clientCode: "AmAb", startTime: "14:00", occurrences: 4 },
  { staffName: "Siobhan", clientCode: "AmAb", startTime: "14:30", occurrences: 4 },
  { staffName: "Siobhan", clientCode: "AmAb", startTime: "15:00", occurrences: 4 },
  { staffName: "Siobhan", clientCode: "AmAb", startTime: "15:30", occurrences: 4 },
  { staffName: "Keila", clientCode: "MiSm", startTime: "08:00", occurrences: 3 },
  { staffName: "Keila", clientCode: "MiSm", startTime: "08:30", occurrences: 3 },
  { staffName: "Keila", clientCode: "MiSm", startTime: "09:00", occurrences: 3 },
  { staffName: "Keila", clientCode: "MiSm", startTime: "09:30", occurrences: 3 },
  { staffName: "Keila", clientCode: "MiSm", startTime: "10:00", occurrences: 3 },
  { staffName: "Keila", clientCode: "MiSm", startTime: "10:30", occurrences: 3 },
  { staffName: "Keila", clientCode: "MiSm", startTime: "11:00", occurrences: 3 },
  { staffName: "Keila", clientCode: "MiSm", startTime: "11:30", occurrences: 3 },
  { staffName: "Lauren", clientCode: "AmAb", startTime: "08:30", occurrences: 3 },
  { staffName: "Julius", clientCode: "AVYa", startTime: "16:30", occurrences: 3 },
  { staffName: "Julius", clientCode: "AVYa", startTime: "17:00", occurrences: 3 },
  { staffName: "Lamya", clientCode: "MaHa", startTime: "08:00", occurrences: 3 },
  { staffName: "Lamya", clientCode: "MaHa", startTime: "08:30", occurrences: 3 },
  { staffName: "Lamya", clientCode: "MaHa", startTime: "09:00", occurrences: 3 },
  { staffName: "Lamya", clientCode: "MaHa", startTime: "09:30", occurrences: 3 },
  { staffName: "Lamya", clientCode: "MaHa", startTime: "10:00", occurrences: 3 },
  { staffName: "Lamya", clientCode: "MaHa", startTime: "10:30", occurrences: 3 },
  { staffName: "Lamya", clientCode: "MaHa", startTime: "11:00", occurrences: 3 },
  { staffName: "Marisol", clientCode: "StAb", startTime: "12:30", occurrences: 3 },
  { staffName: "Marisol", clientCode: "StAb", startTime: "13:00", occurrences: 3 },
  { staffName: "Marisol", clientCode: "StAb", startTime: "13:30", occurrences: 3 },
  { staffName: "Marisol", clientCode: "StAb", startTime: "14:00", occurrences: 3 },
  { staffName: "Marisol", clientCode: "StAb", startTime: "14:30", occurrences: 3 },
  { staffName: "Marisol", clientCode: "StAb", startTime: "15:00", occurrences: 3 },
  { staffName: "Marisol", clientCode: "StAb", startTime: "15:30", occurrences: 3 },
  { staffName: "Jalani", clientCode: "MiSm", startTime: "12:30", occurrences: 3 },
  { staffName: "Jalani", clientCode: "MiSm", startTime: "13:30", occurrences: 3 },
  { staffName: "Jalani", clientCode: "MiSm", startTime: "14:00", occurrences: 3 },
  { staffName: "Jalani", clientCode: "MiSm", startTime: "14:30", occurrences: 3 },
  { staffName: "Jalani", clientCode: "MiSm", startTime: "15:00", occurrences: 3 },
  { staffName: "Jalani", clientCode: "MiSm", startTime: "15:30", occurrences: 3 },
];

const BREAK_OBSERVATIONS: BreakObservation[] = [
  { staffName: "Siobhan", startTime: "12:00", assignmentType: "BREAK", occurrences: 4 },
  { staffName: "Keila", startTime: "13:00", assignmentType: "BREAK", occurrences: 4 },
  { staffName: "Jalani", startTime: "13:00", assignmentType: "BREAK", occurrences: 4 },
  { staffName: "Marisol", startTime: "12:00", assignmentType: "BREAK", occurrences: 3 },
  { staffName: "Areyana", startTime: "12:00", assignmentType: "BREAK", occurrences: 3 },
  { staffName: "Stephanie", startTime: "13:00", assignmentType: "BREAK", occurrences: 3 },
  { staffName: "Lamya", startTime: "11:30", assignmentType: "BREAK", occurrences: 2 },
  { staffName: "Ariana", startTime: "12:00", assignmentType: "BREAK", occurrences: 2 },
  { staffName: "Devonyah", startTime: "12:00", assignmentType: "BREAK", occurrences: 2 },
  { staffName: "Bella (wil)", startTime: "12:00", assignmentType: "BREAK", occurrences: 2 },
  { staffName: "Juwell", startTime: "12:30", assignmentType: "BREAK", occurrences: 2 },
  { staffName: "Lauren", startTime: "13:00", assignmentType: "BREAK", occurrences: 2 },
  { staffName: "Juwell", startTime: "11:30", assignmentType: "BREAK", occurrences: 2 },
  { staffName: "Danna", startTime: "13:00", assignmentType: "BREAK", occurrences: 2 },
  { staffName: "Olivia", startTime: "13:00", assignmentType: "BREAK", occurrences: 2 },
  { staffName: "Lamya", startTime: "12:00", assignmentType: "BREAK", occurrences: 2 },
  { staffName: "Latoya", startTime: "13:00", assignmentType: "BREAK", occurrences: 2 },
  { staffName: "Danna", startTime: "12:00", assignmentType: "BREAK", occurrences: 2 },
];

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeClientCode(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function appendRepeatedReference(
  references: SchedulerAssignment[],
  base: Omit<SchedulerAssignment, "id">,
  occurrences: number,
  prefix: string
) {
  for (let index = 0; index < occurrences; index += 1) {
    references.push({
      ...base,
      id: `${prefix}-${index}`,
    });
  }
}

export function isLivingstonLocation(
  locationName: string,
  locationCode: string
): boolean {
  const combined = `${locationName} ${locationCode}`.toLowerCase();
  return combined.includes("livingston");
}

export function buildLivingstonWorkbookTrialReferences(
  staff: SchedulerStaff[],
  clients: SchedulerClient[]
): SchedulerAssignment[] {
  const staffByName = new Map(
    staff.map((staffMember) => [normalizeName(staffMember.name), staffMember])
  );
  const clientByCode = new Map(
    clients.map((client) => [normalizeClientCode(client.displayCode), client])
  );
  const references: SchedulerAssignment[] = [];

  for (const observation of PAIRING_OBSERVATIONS) {
    const staffMember = staffByName.get(normalizeName(observation.staffName));
    const client = clientByCode.get(normalizeClientCode(observation.clientCode));

    if (!staffMember || !client) {
      continue;
    }

    appendRepeatedReference(
      references,
      {
        staffId: staffMember.id,
        clientId: client.id,
        startTime: "00:00",
        assignmentType: "CLIENT_1_TO_1",
        source: "COPIED",
        locked: false,
        note: "Livingston workbook recent-week pairing observation.",
      },
      Math.min(observation.occurrences, 12),
      `workbook-pair-${staffMember.id}-${client.id}`
    );
  }

  for (const observation of EXACT_SLOT_OBSERVATIONS) {
    const staffMember = staffByName.get(normalizeName(observation.staffName));
    const client = clientByCode.get(normalizeClientCode(observation.clientCode));

    if (!staffMember || !client) {
      continue;
    }

    appendRepeatedReference(
      references,
      {
        staffId: staffMember.id,
        clientId: client.id,
        startTime: observation.startTime,
        assignmentType: "CLIENT_1_TO_1",
        source: "COPIED",
        locked: false,
        note: "Livingston workbook repeated exact-slot observation.",
      },
      observation.occurrences,
      `workbook-slot-${staffMember.id}-${client.id}-${observation.startTime}`
    );
  }

  for (const observation of BREAK_OBSERVATIONS) {
    const staffMember = staffByName.get(normalizeName(observation.staffName));

    if (!staffMember) {
      continue;
    }

    appendRepeatedReference(
      references,
      {
        staffId: staffMember.id,
        startTime: observation.startTime,
        assignmentType: observation.assignmentType,
        source: "COPIED",
        locked: false,
        note: "Livingston workbook recent-week break observation.",
      },
      observation.occurrences,
      `workbook-break-${staffMember.id}-${observation.startTime}`
    );
  }

  return references;
}

export function getLivingstonWorkbookTrialSummary(): LivingstonWorkbookTrialSummary {
  return {
    sourceWorkbook: "2026 Livingston Scheduling.xlsx",
    sourceWeekStart: "2026-09-28",
    sourceWeekEnd: "2026-10-02",
    recentStaffNames: [...LIVINGSTON_RECENT_WEEK_STAFF],
    recentClientCodes: [...LIVINGSTON_RECENT_WEEK_CLIENTS],
    templateAvailabilityNotes: [...LIVINGSTON_TEMPLATE_AVAILABILITY_NOTES],
    strongPairingObservationCount: PAIRING_OBSERVATIONS.length,
    repeatedExactSlotObservationCount: EXACT_SLOT_OBSERVATIONS.length,
    breakObservationCount: BREAK_OBSERVATIONS.length,
  };
}
