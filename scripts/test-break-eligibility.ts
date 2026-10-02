import assert from "node:assert/strict";

import { reserveStaffBreaks } from "../src/features/scheduler/engine/reserveBreaks";
import type {
  SchedulerClient,
  SchedulerRules,
  SchedulerStaff,
} from "../src/features/scheduler/engine/types";

const SLOT = "11:30";

const SCHEDULER_RULES: SchedulerRules = {
  maximumClientsPerTechPerDay: 6,
  maximumTechsPerClientPerDay: 4,
  preferSameTeam: true,
  preferStaffContinuity: true,
  slotLengthMinutes: 30,
  preferredStaffPriority: 100,
  sameTeamPriority: 40,
  continuityPriority: 35,
  rotationPriority: 60,
  workloadBalancePriority: 10,
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

function runBreakEligibilityRegressionScenarios() {
  testBreakDoesNotRemoveOnlyEligibleTechnician();
  console.log("Break eligibility regression scenarios passed.");
}

runBreakEligibilityRegressionScenarios();
