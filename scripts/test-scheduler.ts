import assert from "node:assert/strict";

import { matchEntityReference } from "../src/features/ai/entityReference";
import { generateSchedule } from "../src/features/scheduler/engine/generateSchedule";
import { buildHistoricalPatternScores } from "../src/features/scheduler/engine/historicalPatterns";
import { reserveStaffBreaks } from "../src/features/scheduler/engine/reserveBreaks";
import type {
  HistoricalPatternScores,
  SchedulerAssignment,
  SchedulerClient,
  SchedulerInput,
  SchedulerRules,
  SchedulerStaff,
} from "../src/features/scheduler/engine/types";

const DEFAULT_RULES: SchedulerRules = {
  maximumClientsPerTechPerDay: 6,
  maximumTechsPerClientPerDay: 4,
  minimumClientStaffAssignmentMinutes: 30,
  maximumClientStaffConsecutiveHours: 4,
  preventSameStaffClientRepeatSameDay: true,
  allowSameStaffClientRepeatForCoverageException: true,
  preferSameTeam: true,
  preferStaffContinuity: true,
  slotLengthMinutes: 30,
  preferredStaffPriority: 100,
  sameTeamPriority: 40,
  continuityPriority: 35,
  rotationPriority: 60,
  workloadBalancePriority: 10,
  clientHandoffPenaltyPriority: 25,
  staffScheduleCompactnessPriority: 8,
  minimalFixAllowProtectedRelocation: true,
  minimalFixAllowBreakRelocation: true,
  preserveManualOverrides: true,
  scheduleStabilityPriority: 140,
  weekdayTemplatePriority: 75,
  weeklyHoursPriority: 12,
  historicalPairingPriority: 70,
  historicalSlotPriority: 90,
  historicalBreakPriority: 80,
  btCoveragePriority: 500,
  internCoveragePriority: 300,
  managerCoveragePriority: 125,
  bcbaCoveragePriority: 25,
  otherCoveragePriority: 75,
  autoUseWeekdayTemplate: true,
  autoUsePreviousWeekdaySchedule: true,
  autoUseHistoricalPatterns: true,
};

function createStaff(
  id: string,
  name: string,
  role: SchedulerStaff["role"],
  availableSlots: string[]
): SchedulerStaff {
  return {
    id,
    name,
    role,
    serviceSetting: "IN_CENTER",
    availableSlots,
    targetWeeklyHours: 40,
    maximumWeeklyHours: 40,
    scheduledWeeklyClientHoursBeforeDate: 0,
  };
}

function createClient(
  id: string,
  displayCode: string,
  requiredSlots: string[],
  overrides: Partial<SchedulerClient> = {}
): SchedulerClient {
  return {
    id,
    displayCode,
    serviceSetting: "IN_CENTER",
    supportLevel: "ONE_TO_ONE",
    requiredSlots,
    napSlots: [],
    speechSlots: [],
    staffRelationships: {},
    ...overrides,
  };
}

function createInput(
  staff: SchedulerStaff[],
  clients: SchedulerClient[],
  existingAssignments: SchedulerAssignment[] = [],
  referenceAssignments: SchedulerAssignment[] = [],
  historicalPatterns?: HistoricalPatternScores
): SchedulerInput {
  return {
    staff,
    clients,
    existingAssignments,
    referenceAssignments,
    historicalPatterns,
    callOutStaffIds: [],
    rules: {
      ...DEFAULT_RULES,
    },
  };
}

function clientAssignments(
  assignments: SchedulerAssignment[]
): SchedulerAssignment[] {
  return assignments.filter(
    (assignment) =>
      assignment.assignmentType === "CLIENT_1_TO_1"
  );
}

function createHistoricalReference(
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
    source: "COPIED",
    locked: false,
  };
}

function createHistoricalBreakReference(
  id: string,
  staffId: string,
  startTime: string
): SchedulerAssignment {
  return {
    id,
    staffId,
    startTime,
    assignmentType: "BREAK",
    source: "COPIED",
    locked: false,
  };
}

function testRoleCoverageOrder() {
  const staff = [
    createStaff("bt-1", "Primary BT", "BT", ["08:00"]),
    createStaff("intern-1", "Intern", "INTERN", ["08:00"]),
    createStaff(
      "manager-1",
      "Manager",
      "OFFICE_MANAGER",
      ["08:00"]
    ),
    createStaff("bcba-1", "BCBA", "BCBA", ["08:00"]),
  ];
  const client = createClient("client-1", "AA", ["08:00"], {
    staffRelationships: {
      "bcba-1": "PREFERRED",
    },
  });

  const result = generateSchedule(createInput(staff, [client]));
  const assignment = clientAssignments(result.assignments)[0];

  assert.equal(
    assignment.staffId,
    "bt-1",
    "BT should cover the client before intern, manager, or BCBA with default clinic priorities."
  );
}

function testHistoricalPreferenceCannotJumpRoleTier() {
  const staff = [
    createStaff("bt-1", "Primary BT", "BT", ["08:00"]),
    createStaff("intern-1", "Intern", "INTERN", ["08:00"]),
  ];
  const client = createClient("client-1", "AA", ["08:00"]);
  const history = Array.from({ length: 8 }, (_, index) =>
    createHistoricalReference(
      `history-${index}`,
      "intern-1",
      "client-1",
      "08:00"
    )
  );

  const result = generateSchedule(
    createInput(staff, [client], [], history)
  );
  const assignment = clientAssignments(result.assignments)[0];

  assert.equal(
    assignment.staffId,
    "bt-1",
    "Historical patterns should guide matching inside a role tier, but should not cause an intern to replace an available BT."
  );
}

function testHistoricalSameWeekdayPatternGuidesMatching() {
  const staff = [
    createStaff("bt-1", "BT One", "BT", ["08:00"]),
    createStaff("bt-2", "BT Two", "BT", ["08:00"]),
  ];
  const client = createClient("client-1", "AA", ["08:00"]);
  const history = [
    createHistoricalReference(
      "history-1",
      "bt-2",
      "client-1",
      "08:00"
    ),
    createHistoricalReference(
      "history-2",
      "bt-2",
      "client-1",
      "08:00"
    ),
    createHistoricalReference(
      "history-3",
      "bt-2",
      "client-1",
      "08:00"
    ),
  ];

  const result = generateSchedule(
    createInput(staff, [client], [], history)
  );
  const assignment = clientAssignments(result.assignments)[0];

  assert.equal(
    assignment.staffId,
    "bt-2",
    "Repeated same-weekday history should teach the scheduler to reuse a stable staff/client pattern when no harder rule conflicts."
  );
}

function testImportedHistoricalPatternGuidesMatching() {
  const staff = [
    createStaff("bt-1", "BT One", "BT", ["08:00"]),
    createStaff("bt-2", "BT Two", "BT", ["08:00"]),
  ];
  const client = createClient("client-1", "AA", ["08:00"]);
  const historicalPatterns = buildHistoricalPatternScores([
    {
      scheduleDate: "2026-09-07",
      staffId: "bt-2",
      clientId: "client-1",
      startTime: "08:00",
      assignmentType: "CLIENT_1_TO_1",
    },
    {
      scheduleDate: "2026-09-14",
      staffId: "bt-2",
      clientId: "client-1",
      startTime: "08:00",
      assignmentType: "CLIENT_1_TO_1",
    },
    {
      scheduleDate: "2026-09-21",
      staffId: "bt-2",
      clientId: "client-1",
      startTime: "08:00",
      assignmentType: "CLIENT_1_TO_1",
    },
    {
      scheduleDate: "2026-09-28",
      staffId: "bt-2",
      clientId: "client-1",
      startTime: "08:00",
      assignmentType: "CLIENT_1_TO_1",
    },
  ]);

  const result = generateSchedule(
    createInput(
      staff,
      [client],
      [],
      [],
      historicalPatterns
    )
  );
  const assignment = clientAssignments(result.assignments)[0];

  assert.equal(
    assignment.staffId,
    "bt-2",
    "Imported Excel history should guide same-role matching when the repeated pairing is valid."
  );
}

function testPartialBuildKeepsSafeCoverage() {
  const staff = [
    createStaff("bt-1", "BT One", "BT", ["08:00"]),
    createStaff("bt-2", "BT Two", "BT", ["08:00"]),
  ];
  const clients = [
    createClient("client-1", "AA", ["08:00"]),
    createClient("client-2", "BB", ["08:00"]),
    createClient("client-3", "CC", ["08:00"]),
  ];

  const result = generateSchedule(createInput(staff, clients));

  assert.equal(
    result.metrics.coveredClientSlots,
    2,
    "The scheduler should keep the two client blocks it can safely cover."
  );
  assert.equal(
    result.metrics.uncoveredClientSlots,
    1,
    "The impossible third client block should remain uncovered for manager completion."
  );
  assert.equal(
    result.uncoveredRequirements.length,
    1,
    "The remaining uncovered block should be reported explicitly."
  );
}

function testManualAssignmentsStayProtected() {
  const staff = [
    createStaff("bt-1", "BT One", "BT", ["08:00"]),
    createStaff("bt-2", "BT Two", "BT", ["08:00"]),
  ];
  const clients = [
    createClient("client-1", "AA", ["08:00"]),
    createClient("client-2", "BB", ["08:00"]),
  ];
  const manualAssignment: SchedulerAssignment = {
    id: "manual-1",
    staffId: "bt-2",
    clientId: "client-1",
    startTime: "08:00",
    assignmentType: "CLIENT_1_TO_1",
    source: "MANUAL",
    locked: true,
  };

  const result = generateSchedule(
    createInput(staff, clients, [manualAssignment])
  );
  const preserved = result.assignments.find(
    (assignment) => assignment.id === "manual-1"
  );

  assert.ok(
    preserved,
    "A locked manager assignment should survive automatic generation."
  );
  assert.equal(
    preserved.staffId,
    "bt-2",
    "The automatic scheduler must not move a locked manager assignment."
  );
}

function testManualAssignmentsCanBeRebuiltWhenPreservationIsOff() {
  const staff = [
    createStaff("bt-1", "BT One", "BT", ["08:00"]),
    createStaff("bt-2", "BT Two", "BT", ["08:00"]),
  ];
  const clients = [
    createClient("client-1", "AA", ["08:00"]),
  ];
  const manualAssignment: SchedulerAssignment = {
    id: "manual-rebuild",
    staffId: "bt-2",
    clientId: "client-1",
    startTime: "08:00",
    assignmentType: "CLIENT_1_TO_1",
    source: "MANUAL",
    locked: true,
  };
  const input = createInput(staff, clients, [manualAssignment]);
  input.rules.preserveManualOverrides = false;

  const result = generateSchedule(input);

  assert.equal(
    result.assignments.some(
      (assignment) => assignment.id === "manual-rebuild"
    ),
    false,
    "When manual preservation is disabled, Generate may rebuild a manager-entered client assignment."
  );
  assert.equal(
    result.metrics.coveredClientSlots,
    1,
    "Rebuilding manual client cells must still preserve required client coverage."
  );
}

function testHandoffPenaltyPrefersNeighboringClientContinuity() {
  const staff = [
    createStaff("bt-1", "BT One", "BT", ["08:00", "08:30"]),
    createStaff("bt-2", "BT Two", "BT", ["08:30"]),
  ];
  const client = createClient("client-1", "AA", ["08:00", "08:30"]);
  const existing: SchedulerAssignment[] = [
    {
      id: "manual-aa-0800",
      staffId: "bt-1",
      clientId: "client-1",
      startTime: "08:00",
      assignmentType: "CLIENT_1_TO_1",
      source: "MANUAL",
      locked: true,
    },
  ];
  const input = createInput(staff, [client], existing);
  input.rules.preferStaffContinuity = false;
  input.rules.continuityPriority = 0;
  input.rules.workloadBalancePriority = 0;
  input.rules.staffScheduleCompactnessPriority = 0;
  input.rules.clientHandoffPenaltyPriority = 100;

  const result = generateSchedule(input);
  const atEightThirty = clientAssignments(result.assignments).find(
    (assignment) =>
      assignment.clientId === "client-1" &&
      assignment.startTime === "08:30"
  );

  assert.equal(
    atEightThirty?.staffId,
    "bt-1",
    "A strong handoff-reduction preference should avoid an unnecessary staff change between neighboring blocks."
  );
}

function testCompactnessPrefersAdjacentStaffWork() {
  const staff = [
    createStaff("bt-1", "BT One", "BT", ["08:00", "08:30"]),
    createStaff("bt-2", "BT Two", "BT", ["08:30"]),
  ];
  const clients = [
    createClient("client-a", "AA", ["08:00"]),
    createClient("client-b", "BB", ["08:30"]),
  ];
  const existing: SchedulerAssignment[] = [
    {
      id: "manual-aa",
      staffId: "bt-1",
      clientId: "client-a",
      startTime: "08:00",
      assignmentType: "CLIENT_1_TO_1",
      source: "MANUAL",
      locked: true,
    },
  ];
  const input = createInput(staff, clients, existing);
  input.rules.workloadBalancePriority = 0;
  input.rules.clientHandoffPenaltyPriority = 0;
  input.rules.staffScheduleCompactnessPriority = 100;

  const result = generateSchedule(input);
  const clientB = clientAssignments(result.assignments).find(
    (assignment) =>
      assignment.clientId === "client-b" &&
      assignment.startTime === "08:30"
  );

  assert.equal(
    clientB?.staffId,
    "bt-1",
    "Compactness priority should prefer adjacent work over creating an avoidable isolated staff gap."
  );
}

function testAiEntityMatchingIgnoresCaseSpacingAndSmallTypos() {
  const areyana = { id: "1", name: "Areyana" };
  const anias = { id: "2", name: "Anias" };
  const candidates = [
    { record: areyana, labels: ["Areyana"] },
    { record: anias, labels: ["Anias"] },
  ];

  const mixedCase = matchEntityReference("aReYaNa", candidates);
  assert.equal(mixedCase.status, "MATCH");
  if (mixedCase.status === "MATCH") {
    assert.equal(mixedCase.record.id, "1");
  }

  const punctuation = matchEntityReference("Are-yana", candidates);
  assert.equal(punctuation.status, "MATCH");
  if (punctuation.status === "MATCH") {
    assert.equal(punctuation.record.id, "1");
  }

  const typo = matchEntityReference("Areyanna", candidates);
  assert.equal(typo.status, "MATCH");
  if (typo.status === "MATCH") {
    assert.equal(typo.record.id, "1");
    assert.equal(typo.fuzzy, true);
  }
}

function testHigherSupportClientRotates() {
  const slots = ["08:00", "08:30", "09:00", "09:30"];
  const staff = [
    createStaff("bt-1", "BT One", "BT", slots),
    createStaff("bt-2", "BT Two", "BT", slots),
    createStaff("bt-3", "BT Three", "BT", slots),
  ];
  const client = createClient("client-1", "HS", slots, {
    supportLevel: "HIGH_SUPPORT",
    maxConsecutiveBlocksWithSameStaff: 2,
    desiredDifferentStaffPerDay: 3,
  });

  const result = generateSchedule(createInput(staff, [client]));
  const usedStaffIds = new Set(
    clientAssignments(result.assignments).map(
      (assignment) => assignment.staffId
    )
  );

  assert.ok(
    usedStaffIds.size >= 2,
    "A higher-support client should rotate across more than one eligible staff member."
  );
}

function testWeeklyMaximumIsHardLimit() {
  const staffMember = createStaff(
    "bt-1",
    "BT One",
    "BT",
    ["08:00"]
  );
  staffMember.maximumWeeklyHours = 40;
  staffMember.scheduledWeeklyClientHoursBeforeDate = 40;

  const client = createClient("client-1", "AA", ["08:00"]);

  const result = generateSchedule(
    createInput([staffMember], [client])
  );

  assert.equal(
    result.metrics.coveredClientSlots,
    0,
    "Automatic generation should not push staff over the configured weekly maximum."
  );
  assert.equal(
    result.metrics.uncoveredClientSlots,
    1,
    "Coverage should remain visibly uncovered when the only staff member is already at the weekly maximum."
  );
}

function testTemplateReferenceGuidesStableMatching() {
  const staff = [
    createStaff("bt-1", "BT One", "BT", ["08:00"]),
    createStaff("bt-2", "BT Two", "BT", ["08:00"]),
  ];
  const client = createClient("client-1", "AA", ["08:00"]);
  const reference: SchedulerAssignment = {
    id: "template-reference",
    staffId: "bt-2",
    clientId: "client-1",
    startTime: "08:00",
    assignmentType: "CLIENT_1_TO_1",
    source: "TEMPLATE",
    locked: false,
  };

  const result = generateSchedule(
    createInput(staff, [client], [], [reference])
  );
  const assignment = clientAssignments(result.assignments)[0];

  assert.equal(
    assignment.staffId,
    "bt-2",
    "A valid weekday template should guide the scheduler when no harder rule conflicts with it."
  );
}

function testBreakPlanningUsesReliefCapacity() {
  const slots = ["11:00"];
  const staff = [
    createStaff("bt-1", "BT One", "BT", slots),
    createStaff("bt-2", "BT Two", "BT", slots),
    createStaff(
      "manager-1",
      "Manager",
      "OFFICE_MANAGER",
      slots
    ),
  ];
  const clients = [
    createClient("client-1", "AA", slots),
    createClient("client-2", "BB", slots),
  ];
  const input = createInput(staff, clients);

  const breaks = reserveStaffBreaks({
    staff,
    clients,
    existingAssignments: [],
    referenceAssignments: [],
    callOutStaffIds: [],
    rules: {
      breakWindowStart: "11:00",
      breakWindowEnd: "13:30",
      defaultBreakMinutes: 30,
      breakEligibilityHours: 0,
      slotLengthMinutes: 30,
    },
  });

  assert.equal(
    breaks.length,
    1,
    "Only one simultaneous break should be reserved when three staff must cover two clients."
  );
  assert.equal(
    breaks[0].staffId,
    "bt-1",
    "Frontline staff should be offered the break before the manager relief tier."
  );

  const result = generateSchedule({
    ...input,
    existingAssignments: breaks,
  });

  assert.equal(
    result.metrics.uncoveredClientSlots,
    0,
    "The manager should remain available as relief so both clients stay covered during the BT break."
  );
}

function testRepeatedBreakHistoryGuidesPlacement() {
  const slots = ["11:30", "12:00", "12:30"];
  const staff = [
    createStaff("bt-1", "BT One", "BT", slots),
    createStaff("bt-2", "BT Two", "BT", slots),
    createStaff(
      "manager-1",
      "Manager",
      "OFFICE_MANAGER",
      slots
    ),
  ];
  const clients = [createClient("client-1", "AA", slots)];
  const history = [
    createHistoricalBreakReference("break-1", "bt-1", "12:00"),
    createHistoricalBreakReference("break-2", "bt-1", "12:00"),
    createHistoricalBreakReference("break-3", "bt-1", "12:00"),
  ];

  const breaks = reserveStaffBreaks({
    staff,
    clients,
    existingAssignments: [],
    referenceAssignments: history,
    callOutStaffIds: [],
    rules: {
      breakWindowStart: "11:00",
      breakWindowEnd: "13:30",
      defaultBreakMinutes: 30,
      breakEligibilityHours: 0,
      slotLengthMinutes: 30,
    },
  });

  const btOneBreak = breaks.find(
    (assignment) => assignment.staffId === "bt-1"
  );

  assert.equal(
    btOneBreak?.startTime,
    "12:00",
    "Repeated prior break timing should guide break placement when capacity is equally safe."
  );
}

function halfHourSlots(startHour: number, count: number): string[] {
  const slots: string[] = [];
  let minutes = startHour * 60;

  for (let index = 0; index < count; index += 1) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    slots.push(
      `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
    );
    minutes += 30;
  }

  return slots;
}

function testGlobalMaximumForcesClientStaffRotation() {
  const slots = halfHourSlots(8, 9);
  const staff = [
    createStaff("bt-a", "A Staff", "BT", slots),
    createStaff("bt-b", "B Staff", "BT", slots),
  ];
  const client = createClient("client-long", "LONG", slots);
  const input = createInput(staff, [client]);
  input.rules.maximumClientStaffConsecutiveHours = 4;

  const result = generateSchedule(input);
  const assigned = clientAssignments(result.assignments).filter(
    (assignment) => assignment.clientId === "client-long"
  );
  const aAssignments = assigned.filter(
    (assignment) => assignment.staffId === "bt-a"
  );
  const bAssignments = assigned.filter(
    (assignment) => assignment.staffId === "bt-b"
  );

  assert.equal(
    result.metrics.uncoveredClientSlots,
    0,
    "A second eligible staff member should take over when the first reaches the four-hour continuous maximum."
  );
  assert.equal(
    aAssignments.length,
    8,
    "The first staff/client run must stop at eight 30-minute blocks (four hours)."
  );
  assert.equal(
    bAssignments.length,
    1,
    "The next eligible staff member should cover the remaining block after rotation."
  );
}

function testSamePairDoesNotReturnAfterGap() {
  const slots = ["08:00", "08:30", "09:00"];
  const staff = [
    createStaff("bt-a", "A Staff", "BT", slots),
    createStaff("bt-b", "B Staff", "BT", slots),
  ];
  const client = createClient("client-gap", "GAP", slots);
  const existing: SchedulerAssignment[] = [
    {
      id: "manual-a-0800",
      staffId: "bt-a",
      clientId: "client-gap",
      startTime: "08:00",
      assignmentType: "CLIENT_1_TO_1",
      source: "MANUAL",
      locked: true,
    },
    {
      id: "manual-b-0830",
      staffId: "bt-b",
      clientId: "client-gap",
      startTime: "08:30",
      assignmentType: "CLIENT_1_TO_1",
      source: "MANUAL",
      locked: true,
    },
  ];
  const input = createInput(staff, [client], existing);
  input.rules.preventSameStaffClientRepeatSameDay = true;

  const result = generateSchedule(input);
  const atNine = clientAssignments(result.assignments).find(
    (assignment) =>
      assignment.clientId === "client-gap" &&
      assignment.startTime === "09:00"
  );

  assert.equal(
    atNine?.staffId,
    "bt-b",
    "After A's client block ends and B takes over, Auto Generate must not bring A back later the same day."
  );
}

function testConfigurableMinimumContinuousPairing() {
  const slots = halfHourSlots(8, 10);
  const staff = [
    createStaff("bt-a", "A Staff", "BT", slots),
    createStaff("bt-b", "B Staff", "BT", slots),
  ];
  const client = createClient("client-min", "MIN", slots);
  const input = createInput(staff, [client]);
  input.rules.minimumClientStaffAssignmentMinutes = 60;
  input.rules.maximumClientStaffConsecutiveHours = 4;

  const result = generateSchedule(input);
  const assigned = clientAssignments(result.assignments).filter(
    (assignment) => assignment.clientId === "client-min"
  );
  const byStaff = new Map<string, number>();
  for (const assignment of assigned) {
    byStaff.set(
      assignment.staffId,
      (byStaff.get(assignment.staffId) ?? 0) + 1
    );
  }

  assert.equal(
    result.metrics.uncoveredClientSlots,
    0,
    "Ten half-hour client blocks should remain fully covered with a 60-minute minimum and a four-hour maximum when two staff are available."
  );
  assert.ok(
    [...byStaff.values()].every((count) => count >= 2),
    "Every automatically started client/staff pairing must contain at least two consecutive 30-minute blocks when the minimum is 60 minutes."
  );
}

function testNonRepeatSwapWinsBeforeRepeatFallback() {
  const staff = [
    createStaff("bt-x", "A Staff", "BT", ["10:00"]),
    createStaff("bt-y", "Repeat Staff", "BT", ["08:00", "10:00"]),
    createStaff("bt-z", "Z Staff", "BT", ["10:00"]),
  ];
  const clientA = createClient(
    "client-a",
    "ZZ",
    ["08:00", "10:00"],
    {
      staffRelationships: {
        "bt-z": "HARD_RESTRICTION",
      },
    }
  );
  const clientB = createClient(
    "client-b",
    "AA",
    ["10:00"]
  );
  const existing: SchedulerAssignment[] = [
    {
      id: "manual-repeat-history",
      staffId: "bt-y",
      clientId: "client-a",
      startTime: "08:00",
      assignmentType: "CLIENT_1_TO_1",
      source: "MANUAL",
      locked: true,
    },
  ];
  const input = createInput(staff, [clientA, clientB], existing);
  input.rules.preventSameStaffClientRepeatSameDay = true;
  input.rules.allowSameStaffClientRepeatForCoverageException = true;

  const result = generateSchedule(input);
  const atTenForClientA = clientAssignments(result.assignments).find(
    (assignment) =>
      assignment.clientId === "client-a" &&
      assignment.startTime === "10:00"
  );
  const pairReuseWarning = result.warnings.find(
    (warning) => warning.code === "PAIR_REUSE_EXCEPTION"
  );

  assert.equal(
    atTenForClientA?.staffId,
    "bt-x",
    "The scheduler should first use a normal non-repeat swap instead of immediately reusing Repeat Staff with the same client."
  );
  assert.equal(
    pairReuseWarning,
    undefined,
    "A same-day repeat exception must not be used while a valid non-repeat swap can cover the remaining client."
  );
}

function testRepeatFallbackCoversOnlyAfterNormalPassFails() {
  const staff = [
    createStaff("bt-only", "Only Staff", "BT", ["08:00", "10:00"]),
  ];
  const client = createClient(
    "client-repeat-last-resort",
    "LAST",
    ["08:00", "10:00"]
  );
  const existing: SchedulerAssignment[] = [
    {
      id: "manual-first-session",
      staffId: "bt-only",
      clientId: "client-repeat-last-resort",
      startTime: "08:00",
      assignmentType: "CLIENT_1_TO_1",
      source: "MANUAL",
      locked: true,
    },
  ];
  const input = createInput(staff, [client], existing);
  input.rules.preventSameStaffClientRepeatSameDay = true;
  input.rules.allowSameStaffClientRepeatForCoverageException = true;

  const result = generateSchedule(input);
  const repeatedAssignment = clientAssignments(result.assignments).find(
    (assignment) =>
      assignment.clientId === "client-repeat-last-resort" &&
      assignment.startTime === "10:00"
  );

  assert.equal(
    repeatedAssignment?.staffId,
    "bt-only",
    "When no different eligible staff member or non-repeat repair exists, the final fallback may reuse the earlier staff/client pair."
  );
  assert.ok(
    result.warnings.some(
      (warning) => warning.code === "PAIR_REUSE_EXCEPTION"
    ),
    "A last-resort same-day repeat must be explicitly reported as a coverage exception."
  );
}

function runSchedulerRegressionScenarios() {
  testRoleCoverageOrder();
  testHistoricalPreferenceCannotJumpRoleTier();
  testHistoricalSameWeekdayPatternGuidesMatching();
  testImportedHistoricalPatternGuidesMatching();
  testPartialBuildKeepsSafeCoverage();
  testManualAssignmentsStayProtected();
  testManualAssignmentsCanBeRebuiltWhenPreservationIsOff();
  testHandoffPenaltyPrefersNeighboringClientContinuity();
  testCompactnessPrefersAdjacentStaffWork();
  testAiEntityMatchingIgnoresCaseSpacingAndSmallTypos();
  testHigherSupportClientRotates();
  testWeeklyMaximumIsHardLimit();
  testTemplateReferenceGuidesStableMatching();
  testBreakPlanningUsesReliefCapacity();
  testRepeatedBreakHistoryGuidesPlacement();
  testGlobalMaximumForcesClientStaffRotation();
  testSamePairDoesNotReturnAfterGap();
  testConfigurableMinimumContinuousPairing();
  testNonRepeatSwapWinsBeforeRepeatFallback();
  testRepeatFallbackCoversOnlyAfterNormalPassFails();

  console.log("Automatic scheduler regression scenarios passed.");
}

runSchedulerRegressionScenarios();
