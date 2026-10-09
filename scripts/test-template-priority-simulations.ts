import assert from "node:assert/strict";

import { generateSchedule } from "../src/features/scheduler/engine/generateSchedule";
import type {
  SchedulerAssignment,
  SchedulerClient,
  SchedulerInput,
  SchedulerRules,
  SchedulerStaff,
} from "../src/features/scheduler/engine/types";

const SLOTS = [
  "08:00",
  "08:30",
  "09:00",
  "09:30",
  "10:00",
  "10:30",
  "11:00",
  "11:30",
];

const RULES: SchedulerRules = {
  maximumClientsPerTechPerDay: 3,
  maximumTechsPerClientPerDay: 3,
  minimumClientStaffAssignmentMinutes: 30,
  maximumClientStaffConsecutiveHours: 4,
  preventSameStaffClientRepeatSameDay: false,
  allowSameStaffClientRepeatForCoverageException: true,
  preferSameTeam: true,
  preferStaffContinuity: true,
  humanStyleBlockBalancingEnabled: true,
  preferredClientsPerStaffPerDay: 2,
  preferredStaffPerClientPerDay: 2,
  slotLengthMinutes: 30,
  preferredStaffPriority: 100,
  sameTeamPriority: 40,
  continuityPriority: 200,
  rotationPriority: 60,
  workloadBalancePriority: 0,
  clientHandoffPenaltyPriority: 200,
  staffScheduleCompactnessPriority: 8,
  minimalFixAllowProtectedRelocation: true,
  minimalFixAllowBreakRelocation: true,
  preserveManualOverrides: true,
  breakSchedulingEnabled: true,
  scheduleStabilityPriority: 140,
  weekdayTemplatePriority: 75,
  weeklyHoursPriority: 12,
  btCoveragePriority: 500,
  internCoveragePriority: 300,
  managerCoveragePriority: 125,
  bcbaCoveragePriority: 25,
  otherCoveragePriority: 75,
  autoUseWeekdayTemplate: true,
  autoUsePreviousWeekdaySchedule: true,
  autoUseHistoricalPatterns: true,
  historicalPairingPriority: 70,
  historicalSlotPriority: 90,
  historicalBreakPriority: 80,
};

function staff(
  id: string,
  name: string,
  availableSlots = SLOTS
): SchedulerStaff {
  return {
    id,
    name,
    role: "BT",
    serviceSetting: "IN_CENTER",
    availableSlots,
    targetWeeklyHours: 40,
    maximumWeeklyHours: 40,
    scheduledWeeklyClientHoursBeforeDate: 0,
  };
}

function client(
  id: string,
  code: string,
  requiredSlots = SLOTS
): SchedulerClient {
  return {
    id,
    displayCode: code,
    serviceSetting: "IN_CENTER",
    supportLevel: "ONE_TO_ONE",
    requiredSlots,
    napSlots: [],
    speechSlots: [],
    staffRelationships: {},
  };
}

function templateReference(
  id: string,
  staffId: string,
  clientId: string,
  startTime: string
): SchedulerAssignment {
  return {
    id,
    staffId,
    clientId,
    startTime,
    assignmentType: "CLIENT_1_TO_1",
    source: "TEMPLATE",
    locked: false,
  };
}

function templateForPairings(
  pairings: Array<[string, string]>
): SchedulerAssignment[] {
  const references: SchedulerAssignment[] = [];
  pairings.forEach(([staffId, clientId], pairIndex) => {
    for (const slot of SLOTS) {
      references.push(
        templateReference(
          `template-${pairIndex}-${slot}`,
          staffId,
          clientId,
          slot
        )
      );
    }
  });
  return references;
}

function runScenario({
  name,
  staffRows,
  clientRows,
  template,
}: {
  name: string;
  staffRows: SchedulerStaff[];
  clientRows: SchedulerClient[];
  template: SchedulerAssignment[];
}) {
  const input: SchedulerInput = {
    staff: staffRows,
    clients: clientRows,
    existingAssignments: [],
    referenceAssignments: template,
    callOutStaffIds: staffRows
      .filter((member) => member.availableSlots.length === 0)
      .map((member) => member.id),
    rules: { ...RULES },
  };

  const result = generateSchedule(input);
  const actual = new Set(
    result.assignments
      .filter(
        (assignment) =>
          assignment.assignmentType === "CLIENT_1_TO_1" &&
          assignment.clientId
      )
      .map(
        (assignment) =>
          `${assignment.staffId}|${assignment.clientId}|${assignment.startTime}`
      )
  );

  const availableStaffIds = new Set(
    staffRows
      .filter((member) => member.availableSlots.length > 0)
      .map((member) => member.id)
  );
  const activeClientSlots = new Set(
    clientRows.flatMap((record) =>
      record.requiredSlots.map((slot) => `${record.id}|${slot}`)
    )
  );

  const feasibleTemplate = template.filter(
    (reference) =>
      Boolean(reference.clientId) &&
      availableStaffIds.has(reference.staffId) &&
      activeClientSlots.has(
        `${reference.clientId as string}|${reference.startTime}`
      )
  );

  const matched = feasibleTemplate.filter((reference) =>
    actual.has(
      `${reference.staffId}|${reference.clientId}|${reference.startTime}`
    )
  ).length;

  const matchPercent =
    feasibleTemplate.length === 0
      ? 100
      : (matched / feasibleTemplate.length) * 100;

  return {
    name,
    matchPercent,
    matched,
    feasible: feasibleTemplate.length,
    coveragePercent: result.metrics.coveragePercent,
    uncovered: result.metrics.uncoveredClientSlots,
    assignments: result.assignments,
  };
}

const baseStaff = [
  staff("s1", "Anias"),
  staff("s2", "Areyana"),
  staff("s3", "Dezz"),
  staff("s4", "Izzy"),
];

const baseClients = [
  client("c1", "MaHa"),
  client("c2", "ZiBo"),
  client("c3", "ReMa"),
  client("c4", "JoBr"),
];

const weekdayPairings: Record<string, Array<[string, string]>> = {
  MONDAY: [
    ["s1", "c1"],
    ["s2", "c2"],
    ["s3", "c3"],
    ["s4", "c4"],
  ],
  TUESDAY: [
    ["s1", "c2"],
    ["s2", "c1"],
    ["s3", "c4"],
    ["s4", "c3"],
  ],
  WEDNESDAY: [
    ["s1", "c1"],
    ["s2", "c3"],
    ["s3", "c4"],
    ["s4", "c2"],
  ],
  THURSDAY: [
    ["s1", "c4"],
    ["s2", "c2"],
    ["s3", "c1"],
    ["s4", "c3"],
  ],
  FRIDAY: [
    ["s1", "c3"],
    ["s2", "c4"],
    ["s3", "c2"],
    ["s4", "c1"],
  ],
};

const reports = Object.entries(weekdayPairings).map(
  ([day, pairings]) =>
    runScenario({
      name: `${day} exact-template baseline`,
      staffRows: baseStaff,
      clientRows: baseClients,
      template: templateForPairings(pairings),
    })
);

for (const report of reports) {
  assert.equal(report.coveragePercent, 100);
  assert.equal(
    report.matchPercent,
    100,
    `${report.name} should reproduce all valid exact template pairings.`
  );
}

// Staff call-out: keep every still-valid template pairing unchanged first;
// only the called-out staff member's client should need fallback coverage.
const oneStaffOut = runScenario({
  name: "WEDNESDAY one staff call-out",
  staffRows: [
    staff("s1", "Anias", []),
    staff("s2", "Areyana"),
    staff("s3", "Dezz"),
    staff("s4", "Izzy"),
    staff("relief", "Relief"),
  ],
  clientRows: baseClients,
  template: templateForPairings(weekdayPairings.WEDNESDAY),
});
assert.equal(oneStaffOut.matchPercent, 100);
assert.equal(oneStaffOut.coveragePercent, 100);

const twoStaffOut = runScenario({
  name: "WEDNESDAY two staff call-outs",
  staffRows: [
    staff("s1", "Anias", []),
    staff("s2", "Areyana", []),
    staff("s3", "Dezz"),
    staff("s4", "Izzy"),
    staff("relief-a", "Relief A"),
    staff("relief-b", "Relief B"),
  ],
  clientRows: baseClients,
  template: templateForPairings(weekdayPairings.WEDNESDAY),
});
assert.equal(twoStaffOut.matchPercent, 100);
assert.equal(twoStaffOut.coveragePercent, 100);

// Client call-out: existing client/staff matches must stay unchanged. The
// staff whose template client is absent should not displace a still-valid pair.
const oneClientOut = runScenario({
  name: "WEDNESDAY one client call-out",
  staffRows: baseStaff,
  clientRows: baseClients.filter((record) => record.id !== "c1"),
  template: templateForPairings(weekdayPairings.WEDNESDAY),
});
assert.equal(oneClientOut.matchPercent, 100);
assert.equal(oneClientOut.coveragePercent, 100);

const twoClientsOut = runScenario({
  name: "WEDNESDAY two client call-outs",
  staffRows: baseStaff,
  clientRows: baseClients.filter(
    (record) => record.id !== "c1" && record.id !== "c4"
  ),
  template: templateForPairings(weekdayPairings.WEDNESDAY),
});
assert.equal(twoClientsOut.matchPercent, 100);
assert.equal(twoClientsOut.coveragePercent, 100);

// Date-scoped simulation matrix: three successive workweeks with the same
// imported-style weekday template, plus realistic attendance variations.
// These fixtures are synthetic, not a claim of access to the clinic MongoDB.
function dateForDay(week: number, offset: number): string {
  const start = new Date("2026-10-05T12:00:00Z");
  start.setUTCDate(start.getUTCDate() + week * 7 + offset);
  return start.toISOString().slice(0, 10);
}
const datedReports = Array.from({ length: 3 }, (_, week) =>
  Object.entries(weekdayPairings).map(([day, pairings], offset) => {
    const date = dateForDay(week, offset);
    const staffRows = baseStaff.map((member) => ({
      ...member,
      availableSlots: [...member.availableSlots],
    }));
    const clientRows = baseClients.map((member) => ({
      ...member,
      requiredSlots: [...member.requiredSlots],
    }));
    if (week === 1 && offset === 2) {
      staffRows[0].availableSlots = [];
      staffRows.push(staff("relief-w2", "Available Relief"));
    }
    if (week === 2 && offset === 3) {
      clientRows.splice(1, 1);
    }
    return runScenario({
      name: `${date} (${day}) workbook-style reference`,
      staffRows,
      clientRows,
      template: templateForPairings(pairings),
    });
  })
).flat();

for (const report of datedReports) {
  assert.equal(report.coveragePercent, 100, `${report.name}: coverage must remain complete`);
  assert.equal(report.matchPercent, 100, `${report.name}: feasible template pairings must be retained`);
  const slotStaff = new Set<string>();
  const slotClient = new Set<string>();
  for (const assignment of report.assignments.filter(a => a.assignmentType === "CLIENT_1_TO_1")) {
    const staffKey = `${assignment.staffId}|${assignment.startTime}`;
    const clientKey = `${assignment.clientId}|${assignment.startTime}`;
    assert.ok(!slotStaff.has(staffKey), `${report.name}: double-booked staff ${staffKey}`);
    assert.ok(!slotClient.has(clientKey), `${report.name}: double-booked client ${clientKey}`);
    slotStaff.add(staffKey);
    slotClient.add(clientKey);
  }
}

const allReports = [
  ...reports,
  ...datedReports,
  oneStaffOut,
  twoStaffOut,
  oneClientOut,
  twoClientsOut,
];

console.table(
  allReports.map((report) => ({
    scenario: report.name,
    templateMatch: `${report.matchPercent.toFixed(1)}%`,
    coverage: `${report.coveragePercent.toFixed(1)}%`,
    feasibleTemplateBlocks: report.feasible,
    matchedTemplateBlocks: report.matched,
    uncoveredBlocks: report.uncovered,
  }))
);

console.log(
  "Template-first regression passed: five weekdays, 15 dated scenarios over 3 weeks (including staff/client absence), plus 4 additional call-out simulations."
);
