import assert from "node:assert/strict";

import { placeStaffBreaksAfterCoverage } from "../src/features/scheduler/engine/placeStaffBreaks";
import { enrichBreakAssignmentsWithFixedEvents, reserveStaffBreaks } from "../src/features/scheduler/engine/reserveBreaks";
import type {
  SchedulerAssignment,
  SchedulerClient,
  SchedulerRules,
  SchedulerStaff,
} from "../src/features/scheduler/engine/types";

const SLOT = "11:30";

const SCHEDULER_RULES: SchedulerRules = {
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

function createStaff(
  id: string,
  name: string,
  role: SchedulerStaff["role"]
): SchedulerStaff {
  return {
    id,
    name,
    role,
    serviceSetting: "IN_CENTER",
    availableSlots: [SLOT],
  };
}

function createClient(
  id: string,
  staffRelationships: SchedulerClient["staffRelationships"]
): SchedulerClient {
  return {
    id,
    displayCode: id,
    serviceSetting: "IN_CENTER",
    supportLevel: "ONE_TO_ONE",
    requiredSlots: [SLOT],
    napSlots: [],
    speechSlots: [],
    staffRelationships,
  };
}

function testBreakDoesNotRemoveOnlyEligibleTechnician() {
  const staff = [
    createStaff("bt-a", "A Unique BT", "BT"),
    createStaff("bt-b", "B Relief BT", "BT"),
    createStaff("manager", "Clinic Manager", "OFFICE_MANAGER"),
  ];

  const clients = [
    createClient("ClientA", {
      "bt-b": "HARD_RESTRICTION",
      manager: "HARD_RESTRICTION",
    }),
    createClient("ClientB", {
      "bt-a": "HARD_RESTRICTION",
    }),
  ];

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
      historicalBreakPriority: 80,
    },
    schedulerRules: SCHEDULER_RULES,
  });

  assert.equal(
    breaks.length,
    1,
    "Exactly one break should be possible while two clients need coverage."
  );

  assert.equal(
    breaks[0].staffId,
    "bt-b",
    "The scheduler must protect the only technician eligible for ClientA and choose the other BT for break instead."
  );
}

function testNapWindowKeepsAutomaticBreaksPlain() {
  const linkedClient = {
    ...createClient("ClientA", {}),
    napSlots: ["12:00", "12:30", "13:00"],
    requiredSlots: ["11:30", "13:30"],
  };
  const createAssignment = (
    id: string, staffId: string, clientId: string | undefined,
    startTime: string, assignmentType: SchedulerAssignment["assignmentType"]
  ): SchedulerAssignment => ({
    id, staffId, clientId, startTime, assignmentType, source: "AUTO", locked: false,
  });
  const assignments: SchedulerAssignment[] = [
    createAssignment("early", "staff-a", "ClientA", "11:30", "CLIENT_1_TO_1"),
    createAssignment("late", "staff-a", "ClientA", "13:30", "CLIENT_1_TO_1"),
    ...["12:00", "12:30", "13:00"].map((slot) =>
      createAssignment(`nap-break-${slot}`, "staff-a", undefined, slot, "BREAK")
    ),
    createAssignment("other-staff", "staff-b", undefined, "12:30", "BREAK"),
  ];
  const enriched = enrichBreakAssignmentsWithFixedEvents(assignments, [linkedClient], 30);
  for (const slot of ["12:00", "12:30", "13:00"]) {
    assert.ok(enriched.some((item) =>
      item.staffId === "staff-a" && !item.clientId &&
      item.startTime === slot && item.assignmentType === "BREAK"
    ), `Automatic break at ${slot} must stay a plain BREAK even during a nap window`);
  }
}

function testNapBreakForRegularBTWinsOverEmptyGenericSlot() {
  const slots = ["11:00", "11:30", "12:00", "12:30", "13:00"];
  const bt = { ...createStaff("bt", "Regular BT", "BT"), availableSlots: slots };
  const relief = { ...createStaff("relief", "Other BT", "BT"), availableSlots: slots };
  const client = {
    ...createClient("ZiBo", {}),
    requiredSlots: ["11:00", "11:30", "13:00"],
    napSlots: ["12:00", "12:30"],
  };
  const initial: SchedulerAssignment[] = [
    ...["11:00", "11:30", "13:00"].map((startTime) => ({
      id: `coverage-${startTime}`, staffId: "bt", clientId: "ZiBo",
      startTime, assignmentType: "CLIENT_1_TO_1" as const, source: "AUTO" as const, locked: false,
    })),
  ];
  const result = placeStaffBreaksAfterCoverage({
    staff: [bt, relief],
    clients: [client],
    assignments: initial,
    referenceAssignments: [],
    callOutStaffIds: [],
    rules: { breakWindowStart: "11:00", breakWindowEnd: "14:00", defaultBreakMinutes: 30,
      breakEligibilityHours: 0, slotLengthMinutes: 30 },
    schedulerRules: { ...SCHEDULER_RULES, preventSameStaffClientRepeatSameDay: false },
  });
  const btBreaks = result.assignments.filter(
    (a) => a.staffId === "bt" && ["BREAK", "BREAK_NAP", "BREAK_SPEECH"].includes(a.assignmentType)
  );
  assert.equal(btBreaks.length, 1, "BT must get exactly one break");
  assert.equal(btBreaks[0].assignmentType, "BREAK_NAP", "A break taken during the paired client's nap should be represented as a combined event");
  assert.equal(btBreaks[0].clientId, "ZiBo", "The combined break must retain its linked nap client");
  assert.ok(
    ["12:00", "12:30"].includes(btBreaks[0].startTime),
    "The staff break should align with the client's nap window when possible"
  );
  assert.equal(result.assignments.filter(a => a.assignmentType === "CLIENT_1_TO_1" &&
    a.clientId === "ZiBo" && a.staffId === "bt").length, 3,
    "Do not move client to relief when nap already provides the regular BT a break");
}

function testReliefSwapNextToNapIsPreferred() {
  const bt = {
    ...createStaff("bt-nap-adjacent", "BT Nap Adjacent", "BT"),
    availableSlots: ["12:30", "13:00"],
  };
  const manager = {
    ...createStaff("manager-nap-adjacent", "Clinic Manager", "OFFICE_MANAGER"),
    availableSlots: ["12:30", "13:00"],
  };
  const bcba = {
    ...createStaff("bcba-nap-adjacent", "Clinic BCBA", "BCBA"),
    availableSlots: ["12:30", "13:00"],
  };
  const napClient = {
    ...createClient("NapAdjacentClient", {}),
    requiredSlots: ["12:30"],
    napSlots: ["12:00"],
  };
  const otherClient = {
    ...createClient("OtherClient", {}),
    requiredSlots: ["13:00"],
  };
  const initial: SchedulerAssignment[] = [
    {
      id: "nap-adjacent-client-block",
      staffId: bt.id,
      clientId: napClient.id,
      startTime: "12:30",
      assignmentType: "CLIENT_1_TO_1",
      source: "AUTO",
      locked: false,
    },
    {
      id: "other-client-block",
      staffId: bt.id,
      clientId: otherClient.id,
      startTime: "13:00",
      assignmentType: "CLIENT_1_TO_1",
      source: "AUTO",
      locked: false,
    },
  ];

  const result = placeStaffBreaksAfterCoverage({
    staff: [bt, manager, bcba],
    clients: [napClient, otherClient],
    assignments: initial,
    referenceAssignments: [],
    callOutStaffIds: [],
    rules: {
      breakWindowStart: "11:00",
      breakWindowEnd: "14:00",
      defaultBreakMinutes: 30,
      breakEligibilityHours: 0,
      slotLengthMinutes: 30,
    },
    schedulerRules: {
      ...SCHEDULER_RULES,
      preventSameStaffClientRepeatSameDay: false,
    },
  });

  const btBreak = result.assignments.find(
    (assignment) =>
      assignment.staffId === bt.id &&
      ["BREAK", "BREAK_NAP", "BREAK_SPEECH"].includes(assignment.assignmentType)
  );
  assert.equal(btBreak?.assignmentType, "BREAK_NAP", "A break aligned with the nap must retain the combined event type");
  assert.equal(btBreak?.clientId, napClient.id, "The combined break must be linked to the correct client");
  assert.equal(
    btBreak?.startTime,
    "12:30",
    "The break should be placed directly after the client's nap before using a less useful midday client block."
  );
  assert.match(
    btBreak?.note ?? "",
    /nap for NapAdjacentClient \(12:00-12:30\)/,
    "The break should retain the nap alignment that made the adjacent relief swap preferable."
  );
  assert.ok(
    result.assignments.some(
      (assignment) =>
        assignment.staffId === manager.id &&
        assignment.clientId === napClient.id &&
        assignment.startTime === "12:30" &&
        assignment.assignmentType === "CLIENT_1_TO_1"
    ),
    "The manager should take over the adjacent client block so the BT can combine the break with the nap."
  );
}

function testManagerIsPreferredReliefForBtLunch() {
  const bt = {
    ...createStaff("bt-needs-relief", "BT Needs Relief", "BT"),
    availableSlots: ["12:00"],
  };
  const manager = {
    ...createStaff("manager-first", "Clinic Manager", "OFFICE_MANAGER"),
    availableSlots: ["12:00"],
  };
  const bcba = {
    ...createStaff("bcba-second", "Clinic BCBA", "BCBA"),
    availableSlots: ["12:00"],
  };
  const client = {
    ...createClient("ReliefClient", {}),
    requiredSlots: ["12:00"],
  };
  const initial: SchedulerAssignment[] = [{
    id: "bt-client-block",
    staffId: bt.id,
    clientId: client.id,
    startTime: "12:00",
    assignmentType: "CLIENT_1_TO_1",
    source: "AUTO",
    locked: false,
  }];

  const result = placeStaffBreaksAfterCoverage({
    staff: [bt, bcba, manager],
    clients: [client],
    assignments: initial,
    referenceAssignments: [],
    callOutStaffIds: [],
    rules: {
      breakWindowStart: "11:00",
      breakWindowEnd: "14:00",
      defaultBreakMinutes: 30,
      breakEligibilityHours: 0,
      slotLengthMinutes: 30,
    },
    schedulerRules: {
      ...SCHEDULER_RULES,
      preventSameStaffClientRepeatSameDay: false,
    },
  });

  assert.ok(
    result.assignments.some(
      (assignment) =>
        assignment.staffId === manager.id &&
        assignment.clientId === client.id &&
        assignment.assignmentType === "CLIENT_1_TO_1"
    ),
    "Move the client block to the available manager before using the BCBA for BT lunch relief."
  );
  assert.ok(
    result.assignments.some(
      (assignment) =>
        assignment.staffId === bt.id &&
        ["BREAK", "BREAK_NAP", "BREAK_SPEECH"].includes(assignment.assignmentType) &&
        assignment.startTime === "12:00"
    ),
    "The original BT must receive the break after the manager takes over the client block."
  );
}

function testClientNapCannotBeClaimedByTwoStaffBreaks() {
  const slots = ["11:30", "12:00", "12:30", "13:00"];
  const staff = ["first", "second"].map(id => ({
    ...createStaff(id, id, "BT"), availableSlots: slots,
  }));
  const client = {
    ...createClient("ZiBo", {}),
    requiredSlots: ["11:30", "13:00"],
    napSlots: ["12:00", "12:30"],
  };
  const initial: SchedulerAssignment[] = [
    { id:"before", staffId:"first", clientId:"ZiBo", startTime:"11:30",
      assignmentType:"CLIENT_1_TO_1", source:"AUTO", locked:false },
    { id:"after", staffId:"second", clientId:"ZiBo", startTime:"13:00",
      assignmentType:"CLIENT_1_TO_1", source:"AUTO", locked:false },
  ];
  const result = placeStaffBreaksAfterCoverage({
    staff, clients:[client], assignments:initial, referenceAssignments:[],
    callOutStaffIds:[],
    rules:{ breakWindowStart:"11:30",breakWindowEnd:"13:00", defaultBreakMinutes:30,
      breakEligibilityHours:0,slotLengthMinutes:30 },
    schedulerRules:{...SCHEDULER_RULES, preventSameStaffClientRepeatSameDay:false},
  });
  const automaticBreaks = result.assignments.filter(
    (a) => ["BREAK", "BREAK_NAP", "BREAK_SPEECH"].includes(a.assignmentType)
  );
  assert.ok(
    automaticBreaks.filter((a) => a.assignmentType === "BREAK_NAP").length <= 1,
    "At most one caregiver break may be combined with a client nap"
  );
  assert.equal(
    automaticBreaks.filter((a) =>
      a.note?.includes("[fixed-event:BREAK_NAP:ZiBo:12:00-13:00]")
    ).length,
    1,
    "Only one caregiver break may be linked to the complete client nap event."
  );
}

function testEnrichmentNeverDuplicatesNapLink() {
  const client = { ...createClient("ZiBo", {}), napSlots: ["12:00"], requiredSlots: ["11:30", "12:30"] };
  const assignments: SchedulerAssignment[] = [
    { id: "before", staffId: "first", clientId: "ZiBo", startTime: "11:30", assignmentType: "CLIENT_1_TO_1", source: "AUTO", locked: false },
    { id: "after", staffId: "second", clientId: "ZiBo", startTime: "12:30", assignmentType: "CLIENT_1_TO_1", source: "AUTO", locked: false },
    { id: "break-first", staffId: "first", startTime: "12:00", assignmentType: "BREAK", source: "AUTO", locked: false },
    { id: "break-second", staffId: "second", startTime: "12:00", assignmentType: "BREAK", source: "AUTO", locked: false },
  ];
  const enriched = enrichBreakAssignmentsWithFixedEvents(assignments, [client], 30);
  assert.equal(
    enriched.filter(
      (a) => a.assignmentType === "BREAK" && a.startTime === "12:00"
    ).length,
    2,
    "Both staff breaks remain plain BREAK records"
  );
  assert.ok(
    enriched.every(
      (a) =>
        a.assignmentType !== "BREAK_NAP" &&
        a.assignmentType !== "BREAK_SPEECH"
    ),
    "Automatic enrichment must not create combined break/nap or break/speech records"
  );
}

function testBtMayStartLunchAtTwoPm() {
  const bt = {
    ...createStaff("bt-two-pm", "BT Two PM", "BT"),
    availableSlots: ["14:00"],
  };
  const result = placeStaffBreaksAfterCoverage({
    staff: [bt],
    clients: [],
    assignments: [],
    referenceAssignments: [],
    callOutStaffIds: [],
    rules: {
      breakWindowStart: "11:00",
      breakWindowEnd: "14:00",
      defaultBreakMinutes: 30,
      breakEligibilityHours: 0,
      slotLengthMinutes: 30,
    },
    schedulerRules: SCHEDULER_RULES,
  });
  assert.ok(
    result.assignments.some(
      (assignment) =>
        assignment.staffId === bt.id &&
        assignment.assignmentType === "BREAK" &&
        assignment.startTime === "14:00"
    ),
    "A BT may start a 30-minute lunch at 2:00 PM and finish at 2:30 PM."
  );
}

function testNonBtReliefStaffBreaksOutsideBtLunchWhenPossible() {
  const bt = {
    ...createStaff("bt-lunch", "BT Lunch", "BT"),
    availableSlots: [
      "11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00",
    ],
  };
  const manager = {
    ...createStaff("manager-relief", "Manager Relief", "OFFICE_MANAGER"),
    availableSlots: [
      "10:00", "10:30", "11:00", "11:30", "12:00", "12:30",
      "13:00", "13:30", "14:00", "14:30", "15:00",
    ],
  };
  const result = placeStaffBreaksAfterCoverage({
    staff: [manager, bt],
    clients: [],
    assignments: [],
    referenceAssignments: [],
    callOutStaffIds: [],
    rules: {
      breakWindowStart: "11:00",
      breakWindowEnd: "14:00",
      defaultBreakMinutes: 30,
      breakEligibilityHours: 0,
      slotLengthMinutes: 30,
    },
    schedulerRules: SCHEDULER_RULES,
  });
  const btBreak = result.assignments.find(
    (assignment) =>
      assignment.staffId === bt.id && assignment.assignmentType === "BREAK"
  );
  const managerBreak = result.assignments.find(
    (assignment) =>
      assignment.staffId === manager.id &&
      assignment.assignmentType === "BREAK"
  );
  assert.ok(btBreak, "BT should receive a lunch break.");
  assert.ok(managerBreak, "Manager should still receive a break.");
  assert.ok(
    btBreak.startTime >= "11:00" && btBreak.startTime <= "14:00",
    "BT lunch must start between 11:00 AM and 2:00 PM."
  );
  assert.ok(
    managerBreak.startTime < "11:00" || managerBreak.startTime > "14:00",
    "Manager break should be outside BT lunch when a suitable alternative exists."
  );
}

function testCaregiverCanTakeBreakInMiddleOfLongNap() {
  const bt = {
    ...createStaff("nap-caregiver", "Nap Caregiver", "BT"),
    availableSlots: ["12:30"],
  };
  const client = {
    ...createClient("LongNapClient", {}),
    requiredSlots: ["11:30", "14:00"],
    napSlots: ["12:00", "12:30", "13:00", "13:30"],
  };
  const assignments: SchedulerAssignment[] = [
    {
      id: "before-long-nap",
      staffId: bt.id,
      clientId: client.id,
      startTime: "11:30",
      assignmentType: "CLIENT_1_TO_1",
      source: "AUTO",
      locked: false,
    },
    {
      id: "after-long-nap",
      staffId: bt.id,
      clientId: client.id,
      startTime: "14:00",
      assignmentType: "CLIENT_1_TO_1",
      source: "AUTO",
      locked: false,
    },
  ];
  const result = placeStaffBreaksAfterCoverage({
    staff: [bt],
    clients: [client],
    assignments,
    referenceAssignments: [],
    callOutStaffIds: [],
    rules: {
      breakWindowStart: "11:00",
      breakWindowEnd: "14:00",
      defaultBreakMinutes: 30,
      breakEligibilityHours: 0,
      slotLengthMinutes: 30,
    },
    schedulerRules: SCHEDULER_RULES,
  });
  const napBreak = result.assignments.find(
    (assignment) =>
      assignment.staffId === bt.id &&
      assignment.assignmentType === "BREAK" &&
      assignment.startTime === "12:30"
  );
  assert.ok(
    napBreak,
    "The caregiver should be able to take a break in the middle of a multi-hour nap when assigned at its boundaries."
  );
  assert.equal(napBreak.clientId, undefined);
  assert.match(napBreak.note ?? "", /nap for LongNapClient/);
}

function runBreakEligibilityRegressionScenarios() {
  testBreakDoesNotRemoveOnlyEligibleTechnician();
  testNapBreakForRegularBTWinsOverEmptyGenericSlot();
  testReliefSwapNextToNapIsPreferred();
  testManagerIsPreferredReliefForBtLunch();
  testNapWindowKeepsAutomaticBreaksPlain();
  testClientNapCannotBeClaimedByTwoStaffBreaks();
  testEnrichmentNeverDuplicatesNapLink();
  testBtMayStartLunchAtTwoPm();
  testNonBtReliefStaffBreaksOutsideBtLunchWhenPossible();
  testCaregiverCanTakeBreakInMiddleOfLongNap();
  console.log("Break eligibility regression scenarios passed.");
}

runBreakEligibilityRegressionScenarios();
