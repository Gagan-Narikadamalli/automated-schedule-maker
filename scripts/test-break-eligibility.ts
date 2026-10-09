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

function testLongNapBreaksPreserveClientRelationship() {
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
      item.staffId === "staff-a" && item.clientId === "ClientA" &&
      item.startTime === slot && item.assignmentType === "BREAK_NAP"
    ), `The entire nap period must retain the correct staff-client relationship at ${slot}`);
  }
  assert.ok(enriched.some((item) =>
    item.staffId === "staff-b" && item.startTime === "12:30" &&
    item.assignmentType === "BREAK" && !item.clientId
  ), "An unrelated staff member's break must not acquire a child's nap");
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
  const btBreaks = result.assignments.filter(a => a.staffId === "bt" &&
    ["BREAK", "BREAK_NAP"].includes(a.assignmentType));
  assert.equal(btBreaks.length, 1, "BT must get exactly one break");
  assert.equal(btBreaks[0].assignmentType, "BREAK_NAP", "Use client's own nap, not an unrelated free break");
  assert.equal(btBreaks[0].clientId, "ZiBo");
  assert.ok(["12:00", "12:30"].includes(btBreaks[0].startTime));
  assert.equal(result.assignments.filter(a => a.assignmentType === "CLIENT_1_TO_1" &&
    a.clientId === "ZiBo" && a.staffId === "bt").length, 3,
    "Do not move client to relief when nap already provides the regular BT a break");
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
  const linked = result.assignments.filter(a=>a.assignmentType==="BREAK_NAP" && a.clientId==="ZiBo");
  for (const time of ["12:00","12:30"]) {
    assert.ok(linked.filter(a=>a.startTime===time).length<=1,
      "A client nap must not be claimed by two simultaneous staff breaks");
  }
}

function runBreakEligibilityRegressionScenarios() {
  testBreakDoesNotRemoveOnlyEligibleTechnician();
  testNapBreakForRegularBTWinsOverEmptyGenericSlot();
  testLongNapBreaksPreserveClientRelationship();
  testClientNapCannotBeClaimedByTwoStaffBreaks();
  console.log("Break eligibility regression scenarios passed.");
}

runBreakEligibilityRegressionScenarios();
