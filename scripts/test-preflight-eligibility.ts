import assert from "node:assert/strict";

import { calculateSchedulerReadiness } from "../src/features/scheduler/engine/preflight";
import type {
  SchedulerClient,
  SchedulerInput,
  SchedulerRules,
  SchedulerStaff,
} from "../src/features/scheduler/engine/types";

const SLOT = "10:00";

const RULES: SchedulerRules = {
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

function staff(id: string): SchedulerStaff {
  return {
    id,
    name: id,
    role: "BT",
    serviceSetting: "IN_CENTER",
    availableSlots: [SLOT],
  };
}

function client(
  id: string,
  relationships: SchedulerClient["staffRelationships"]
): SchedulerClient {
  return {
    id,
    displayCode: id,
    serviceSetting: "IN_CENTER",
    supportLevel: "ONE_TO_ONE",
    requiredSlots: [SLOT],
    napSlots: [],
    speechSlots: [],
    staffRelationships: relationships,
  };
}

function testHeadcountCanStillBeConstraintShortage() {
  const input: SchedulerInput = {
    staff: [staff("staff-a"), staff("staff-b")],
    clients: [
      client("client-a", {
        "staff-b": "HARD_RESTRICTION",
      }),
      client("client-b", {
        "staff-b": "HARD_RESTRICTION",
      }),
    ],
    existingAssignments: [],
    referenceAssignments: [],
    callOutStaffIds: [],
    rules: RULES,
  };

  const readiness = calculateSchedulerReadiness(input, {
    breakEligibilityHours: 6,
    defaultBreakMinutes: 30,
    breakWindowStart: "11:00",
    breakWindowEnd: "13:30",
  });

  assert.equal(
    readiness.slotCapacity[0].staffAvailable,
    2,
    "The raw headcount should still report both available staff members."
  );

  assert.equal(
    readiness.slotCapacity[0].assignableClientCount,
    1,
    "Only one client can actually be matched because both clients depend on the same eligible technician."
  );

  assert.equal(
    readiness.slotCapacity[0].difference,
    -1,
    "Readiness should expose the hidden one-person eligibility shortage."
  );

  assert.equal(readiness.buildForecast, "PARTIAL_EXPECTED");
  assert.equal(readiness.maximumConcurrentStaffShortage, 1);
}

function runPreflightEligibilityRegressionScenarios() {
  testHeadcountCanStillBeConstraintShortage();
  console.log("Eligibility-aware readiness regression scenarios passed.");
}

runPreflightEligibilityRegressionScenarios();
