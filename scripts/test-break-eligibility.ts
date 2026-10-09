import assert from "node:assert/strict";

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

function runBreakEligibilityRegressionScenarios() {
  testBreakDoesNotRemoveOnlyEligibleTechnician();
  testLongNapBreaksPreserveClientRelationship();
  console.log("Break eligibility regression scenarios passed.");
}

runBreakEligibilityRegressionScenarios();
