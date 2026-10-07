import assert from "node:assert/strict";

import { calculateSchedulerReadiness } from "../src/features/scheduler/engine/preflight";
import type {
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
  availableSlots: string[]
): SchedulerStaff {
  return {
    id,
    name: id,
    role: "BT",
    serviceSetting: "IN_CENTER",
    availableSlots,
  };
}

function createClient(
  id: string,
  requiredSlots: string[]
): SchedulerClient {
  return {
    id,
    displayCode: id,
    serviceSetting: "IN_CENTER",
    supportLevel: "ONE_TO_ONE",
    requiredSlots,
    napSlots: [],
    speechSlots: [],
    staffRelationships: {},
  };
}

function createInput(
  staff: SchedulerStaff[],
  clients: SchedulerClient[]
): SchedulerInput {
  return {
    staff,
    clients,
    existingAssignments: [],
    referenceAssignments: [],
    callOutStaffIds: [],
    rules: DEFAULT_RULES,
  };
}

const READINESS_RULES = {
  breakEligibilityHours: 6,
  defaultBreakMinutes: 30,
  breakWindowStart: "11:00",
  breakWindowEnd: "13:30",
};

function testCompleteBuildForecast() {
  const input = createInput(
    [
      createStaff("staff-1", ["08:00", "08:30"]),
      createStaff("staff-2", ["08:00", "08:30"]),
    ],
    [createClient("client-1", ["08:00", "08:30"])]
  );

  const readiness = calculateSchedulerReadiness(
    input,
    READINESS_RULES
  );

  assert.equal(readiness.buildForecast, "COMPLETE_EXPECTED");
  assert.equal(readiness.maximumConcurrentStaffShortage, 0);
  assert.equal(readiness.estimatedAdditionalStaffNeeded, 0);
}

function testPartialBuildForecastFromConcurrentShortage() {
  const input = createInput(
    [createStaff("staff-1", ["08:00"])],
    [
      createClient("client-1", ["08:00"]),
      createClient("client-2", ["08:00"]),
    ]
  );

  const readiness = calculateSchedulerReadiness(
    input,
    READINESS_RULES
  );

  assert.equal(readiness.buildForecast, "PARTIAL_EXPECTED");
  assert.equal(readiness.maximumConcurrentStaffShortage, 1);
  assert.equal(readiness.estimatedAdditionalStaffNeeded, 1);
  assert.equal(readiness.shortageSlots.length, 1);
}

function testNoClientsForecast() {
  const input = createInput(
    [createStaff("staff-1", ["08:00"])],
    []
  );

  const readiness = calculateSchedulerReadiness(
    input,
    READINESS_RULES
  );

  assert.equal(readiness.buildForecast, "NO_CLIENTS");
  assert.equal(readiness.clientCount, 0);
}

function runPreflightRegressionScenarios() {
  testCompleteBuildForecast();
  testPartialBuildForecastFromConcurrentShortage();
  testNoClientsForecast();

  console.log("Scheduler readiness regression scenarios passed.");
}

runPreflightRegressionScenarios();
